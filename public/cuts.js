// Mid-section cuts on the edit step: marking stretches to take out, drawing
// them on the trim bar, skipping them in the preview, and the re-encode that
// removes them. A trim alone stays the fast copy path in editor.js; a cut
// needs new keyframes where the pieces join, so the kept stretches are
// decoded and encoded again, back to back.
import {
  Input, Output, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, Quality,
  VideoSampleSink, AudioSampleSink, VideoSampleSource, AudioSampleSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from './vendor/mediabunny-1.61.6.min.mjs';
import { say, icon, fmtTime } from './ui.js';

export const MIN_CUT = 0.3; // seconds; shorter cuts are refused
const FPS = 30;             // the re-encoded video's frame rate (the recorder's too)
const EPS = 0.001;
const TOUCH = 1 / FPS;      // cuts closer than one frame count as touching

// ---------- Ranges ----------

// The stretches of start..end left once `cuts` are taken out, in order.
// Cuts are clipped to the clip; overlapping cuts merge.
export function keptRanges(start, end, cuts) {
  const inside = cuts
    .map((c) => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const kept = [];
  let from = start;
  for (const c of inside) {
    if (c.start - from > EPS) kept.push({ start: from, end: c.start });
    from = Math.max(from, c.end);
  }
  if (end - from > EPS) kept.push({ start: from, end });
  return kept;
}

export const totalLength = (ranges) => ranges.reduce((sum, r) => sum + r.end - r.start, 0);

// ---------- Re-encode ----------

// Decodes each kept range of `blob` and encodes it again after the previous
// one, so the cuts are gone and the timeline runs from 0 without gaps.
// Video and audio are fed range by range, so neither track runs far ahead
// of the other. Every decoded sample is closed as soon as it is encoded.
// onProgress(fraction) follows the video frames. Returns an MP4 Blob.
export async function reencodeRanges(blob, ranges, onProgress) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  let output = null;
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('the recording has no video track');
    const audioTrack = await input.getPrimaryAudioTrack(); // null when recorded without sound

    // H.264 and AAC play everywhere; the others are for browsers that cannot encode them.
    const size = { width: videoTrack.codedWidth, height: videoTrack.codedHeight };
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], size);
    if (!videoCodec) throw new Error('this browser cannot encode video');
    const audioCodec = audioTrack && await getFirstEncodableAudioCodec(['aac', 'opus']);
    if (audioTrack && !audioCodec) throw new Error('this browser cannot encode audio');

    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    // 'contain' keeps going if a shared window changed size mid-recording.
    const vSrc = new VideoSampleSource({ codec: videoCodec, quality: new Quality({ bitrate: 5e6 }), sizeChangeBehavior: 'contain' });
    output.addVideoTrack(vSrc, { frameRate: FPS });
    const aSrc = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: 128e3 }) }) : null;
    if (aSrc) output.addAudioTrack(aSrc);
    await output.start();

    const vSink = new VideoSampleSink(videoTrack);
    const aSink = aSrc ? new AudioSampleSink(audioTrack) : null;
    // Output frames sit on a 1/FPS grid. Each range gets a whole number of
    // slots, and video and audio share its start, so nothing drifts however
    // many cuts there are.
    const expected = Math.max(1, totalLength(ranges) * FPS);
    let startSlot = 0;   // where the current range starts in the output, in frames
    let lastSlot = -1;   // the last slot filled
    let frames = 0;      // video samples seen, for progress
    let audioEnd = 0;    // end of the last audio sample written
    for (const { start: s, end: e } of ranges) {
      const slots = Math.max(1, Math.round((e - s) * FPS));
      const offset = startSlot / FPS;
      let first = true;
      for await (const sample of vSink.samples(s, e)) {
        try {
          if (sample.timestamp >= e) continue;
          // The range's first frame fills its first slot even if it began
          // earlier (a still screen can hold one frame for seconds). A frame
          // sharing a slot, or rounding past the range's last one, is dropped.
          const slot = first ? startSlot : startSlot + Math.round((sample.timestamp - s) * FPS);
          if (slot <= lastSlot || slot >= startSlot + slots) continue;
          sample.setTimestamp(slot / FPS);
          sample.setDuration(1 / FPS);
          await vSrc.add(sample, { keyFrame: first }); // a keyframe where each range begins
          first = false;
          lastSlot = slot;
        } finally {
          sample.close();
          onProgress?.(Math.min(1, ++frames / expected));
        }
      }
      if (aSink) {
        for await (const sample of aSink.samples(s, e)) {
          try {
            // Whole audio frames only (about 20 ms each): one that starts inside
            // the range is kept even if it runs a few ms past the end. That
            // overlap is accepted for now; the max() keeps timestamps rising.
            if (sample.timestamp < s || sample.timestamp >= e) continue;
            const t = Math.max(audioEnd, offset + sample.timestamp - s);
            sample.setTimestamp(t);
            await aSrc.add(sample);
            audioEnd = t + sample.duration;
          } finally {
            sample.close();
          }
        }
      }
      startSlot += slots;
    }
    vSrc.close();
    aSrc?.close();
    await output.finalize();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } catch (err) {
    await output?.cancel().catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}

// ---------- The cut controls ----------

// Wires Cut from here / Cut to here, the cut list, the marks on the trim bar
// and cut skipping in the preview. getTrim() returns {start, end};
// getDuration() the recording's length; onChange() runs after any change.
export function initCuts({ preview, marks, list, from, to, msg, getTrim, getDuration, minClip, onChange }) {
  let cuts = [];      // {start, end} in recording time, sorted, never overlapping or touching
  let pending = null; // where a cut being marked starts

  const share = (t) => (getDuration() ? Math.min(1, Math.max(0, t / getDuration())) : 0).toFixed(4);

  function render() {
    // On the bar: each cut as a struck stretch, plus a tick where a new cut starts.
    marks.replaceChildren(...cuts.map((c) => {
      const el = Object.assign(document.createElement('span'), { className: 'trim-cut' });
      el.style.setProperty('--ca', share(c.start));
      el.style.setProperty('--cb', share(c.end));
      return el;
    }));
    if (pending !== null) {
      const tick = Object.assign(document.createElement('span'), { className: 'trim-mark' });
      tick.style.setProperty('--ca', share(pending));
      marks.append(tick);
    }
    // The list: "Cut 1  0:12.4 to 0:18.0  (5.6 s)" and a Remove square.
    list.replaceChildren(...cuts.map((c, i) => {
      const span = `${fmtTime(c.start)} to ${fmtTime(c.end)}`;
      const row = Object.assign(document.createElement('li'), { className: 'cut-row' });
      const name = Object.assign(document.createElement('span'), { className: 'cut-name', textContent: `Cut ${i + 1}` });
      const times = Object.assign(document.createElement('span'), { className: 'cut-span', textContent: span });
      const len = Object.assign(document.createElement('span'), { className: 'cut-len', textContent: `(${(c.end - c.start).toFixed(1)} s)` });
      const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'act act--quiet cut-remove' });
      const sq = Object.assign(document.createElement('span'), { className: 'sq' });
      sq.append(icon('trash'));
      const label = Object.assign(document.createElement('span'), { className: 'act-label', textContent: 'Remove' });
      label.append(Object.assign(document.createElement('span'), { className: 'vh', textContent: ` cut ${i + 1}, ${span}` }));
      remove.append(sq, label);
      remove.addEventListener('click', () => removeCut(i));
      row.append(name, ' ', times, ' ', len, remove);
      return row;
    }));
    list.hidden = cuts.length === 0;
    to.disabled = pending === null;
  }

  function changed() { render(); onChange(); }

  function markFrom() {
    const t = preview.currentTime;
    const { start, end } = getTrim();
    if (t < start - EPS || t > end + EPS) {
      say(msg, `A cut goes inside the clip. Move the player between ${fmtTime(start)} and ${fmtTime(end)}, then click Cut from here.`);
      return;
    }
    pending = t;
    say(msg, `Cut starts at ${fmtTime(t)}. Move the player to where it ends, then click Cut to here.`, 'note');
    render();
  }

  function markTo() {
    if (pending === null) return;
    const t = preview.currentTime;
    const { start, end } = getTrim();
    const cut = { start: Math.min(pending, t), end: Math.max(pending, t) };
    if (cut.end - cut.start < MIN_CUT - EPS) {
      say(msg, `A cut must be at least ${MIN_CUT} s long. Move the player further from ${fmtTime(pending)}, then click Cut to here.`);
      return;
    }
    if (cut.start < start - EPS || cut.end > end + EPS) {
      say(msg, `A cut must lie inside the clip, between ${fmtTime(start)} and ${fmtTime(end)}. Move the player, then click Cut to here.`);
      return;
    }
    // A cut that overlaps or touches others joins them, so each row is one stretch removed.
    const touches = (c) => c.start <= cut.end + TOUCH && c.end >= cut.start - TOUCH;
    const joined = cuts.filter(touches);
    const merged = joined.reduce((m, c) => ({ start: Math.min(m.start, c.start), end: Math.max(m.end, c.end) }), cut);
    const next = [...cuts.filter((c) => !touches(c)), merged].sort((a, b) => a.start - b.start);
    if (totalLength(keptRanges(start, end, next)) < minClip - EPS) {
      say(msg, `That cut would leave less than ${minClip} s of video. Make it shorter.`);
      return;
    }
    cuts = next;
    pending = null;
    say(msg, joined.length
      ? `That cut meets ${joined.length === 1 ? 'another' : `${joined.length} others`}, so they are joined: Cut ${next.indexOf(merged) + 1} is now ${fmtTime(merged.start)} to ${fmtTime(merged.end)}.`
      : '', 'note');
    changed();
  }

  function removeCut(i) {
    cuts = cuts.filter((_, j) => j !== i);
    say(msg, '');
    changed();
    // The pressed button is gone; keep keyboard focus in the list, or go back to Cut from here.
    const buttons = list.querySelectorAll('button');
    (buttons[Math.min(i, buttons.length - 1)] || from).focus();
  }

  // Preview: while playing, entering a cut jumps to its end, so you hear the
  // result before exporting. Paused seeks are left alone: that is how you mark.
  function skip() {
    if (preview.paused || preview.seeking) return;
    let t = preview.currentTime;
    const startAt = t;
    for (let c; (c = cuts.find((x) => t >= x.start && t < x.end - 0.01));) t = c.end;
    if (t !== startAt) preview.currentTime = t;
  }
  let frameCb = 0;
  function watch() {
    skip();
    if (!preview.paused && preview.requestVideoFrameCallback) frameCb = preview.requestVideoFrameCallback(watch);
  }
  preview.addEventListener('play', () => { if (frameCb) preview.cancelVideoFrameCallback(frameCb); watch(); });
  preview.addEventListener('timeupdate', skip); // the fallback where frame callbacks are missing

  from.addEventListener('click', markFrom);
  to.addEventListener('click', markTo);
  render();

  return {
    get cuts() { return cuts; },
    // Cuts that take something out of start..end (for "Re-encoding 2 cuts").
    countIn: (start, end) => cuts.filter((c) => c.end > start + EPS && c.start < end - EPS).length,
    reset() { cuts = []; pending = null; say(msg, ''); render(); },
  };
}
