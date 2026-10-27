// The export renderer for recordings with a camera track. The screen file
// and the camera file are decoded side by side; every output frame is drawn
// on a canvas the size of the screen, with the bubble where the edit step
// left it (bubble.js paints it exactly as the live preview does), and
// encoded again; the sound is the screen file's. The kept ranges (trim and
// cuts) decide which stretches are read, as the cuts re-encode does.
//
// Time: the output runs on a 30 fps grid. For the output frame at screen
// time t, the screen picture is the screen frame showing at t and the
// camera picture is the camera frame showing at t - cameraOffset: the one
// with the largest timestamp at or before it. Where the camera has no newer
// frame (it was unplugged, or stalled) the last one is held; before its
// first frame (the few milliseconds the camera started late) the first is
// used; a camera that never produced a frame means no bubble.
import {
  Output, BufferTarget, Mp4OutputFormat, Quality, VideoSample,
  VideoSampleSink, AudioSampleSink, VideoSampleSource, AudioSampleSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from './vendor/mediabunny-1.61.6.min.mjs';
import { openInput, frameAt, toJpeg } from './media.js';
import { paint } from './bubble.js';
import { heap } from './tracks.js';

const FPS = 30;
const MAX_W = 1920, MAX_H = 1080;
const EPS = 0.001;

// Walks a sample iterator in time order and answers "which frame is showing
// at t". A frame stays until a later one is due, so a gap repeats the last.
function follower(iterator) {
  let held = null, next, started = false;
  const pull = async () => { const r = await iterator.next(); return r.done ? null : r.value; };
  return {
    async at(t) {
      if (!started) { next = await pull(); started = true; }
      while (next && next.timestamp <= t + EPS) { held?.close(); held = next; next = await pull(); }
      return held ?? next;
    },
    async close() { held?.close(); next?.close(); await iterator.return?.(); },
  };
}

// The output size: the screen's own picture, capped at 1080p, even on both sides (H.264 wants that).
function outputSize(track) {
  const scale = Math.min(1, MAX_W / track.displayWidth, MAX_H / track.displayHeight);
  return { W: Math.max(2, Math.round(track.displayWidth * scale) & ~1), H: Math.max(2, Math.round(track.displayHeight * scale) & ~1) };
}

/**
 * Renders the screen with the camera bubble. Returns an MP4 Blob.
 * @param {object} o
 * @param {Blob} o.screen         re-packaged screen MP4 (video and the sound)
 * @param {Blob} o.camera         re-packaged camera MP4 (video only)
 * @param {number} o.cameraOffset seconds the camera started after the screen
 * @param {{start: number, end: number}[]} o.ranges  stretches of the screen to keep, in order
 * @param {{x: number, y: number, size: string}} o.bubble  where the bubble goes
 * @param {(fraction: number) => void} [o.onProgress]
 */
export async function renderComposite({ screen, camera, cameraOffset = 0, ranges, bubble, onProgress }) {
  const sIn = openInput(screen), cIn = openInput(camera);
  let output = null;
  const open = [];
  try {
    const sTrack = await sIn.getPrimaryVideoTrack();
    if (!sTrack) throw new Error('the screen recording has no video track');
    const aTrack = await sIn.getPrimaryAudioTrack(); // null when recorded without sound
    const cTrack = await cIn.getPrimaryVideoTrack(); // null: no bubble
    const { W, H } = outputSize(sTrack);
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!videoCodec) throw new Error('this browser cannot encode video');
    const audioCodec = aTrack && await getFirstEncodableAudioCodec(['aac', 'opus']);
    if (aTrack && !audioCodec) throw new Error('this browser cannot encode audio');

    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const vSrc = new VideoSampleSource({ codec: videoCodec, quality: new Quality({ bitrate: 5e6 }) });
    output.addVideoTrack(vSrc, { frameRate: FPS });
    const aSrc = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: 128e3 }) }) : null;
    if (aSrc) output.addAudioTrack(aSrc);
    await output.start();

    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { alpha: false });
    const sSink = new VideoSampleSink(sTrack);
    const cSink = cTrack ? new VideoSampleSink(cTrack) : null;
    const aSink = aSrc ? new AudioSampleSink(aTrack) : null;
    const slotsOf = ({ start, end }) => Math.max(1, Math.round((end - start) * FPS));
    const total = ranges.reduce((n, r) => n + slotsOf(r), 0);
    let startSlot = 0, done = 0, audioEnd = 0;

    for (const range of ranges) {
      const { start: s, end: e } = range;
      const slots = slotsOf(range);
      const scr = follower(sSink.samples(s, e));
      const cam = cSink ? follower(cSink.samples(s - cameraOffset, e - cameraOffset)) : null;
      open.push(scr, cam);
      for (let k = 0; k < slots; k++) {
        const t = s + k / FPS;
        const sf = await scr.at(t);
        const cf = cam && await cam.at(t - cameraOffset);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        // 'contain' keeps the picture's shape if a shared window changed size mid-recording.
        if (sf) sf.drawWithFit(ctx, { fit: 'contain' });
        if (cf) paint(ctx, bubble, W, H, cf.displayWidth, cf.displayHeight, (...a) => cf.draw(ctx, ...a));
        const frame = new VideoSample(canvas, { timestamp: (startSlot + k) / FPS, duration: 1 / FPS });
        try {
          await vSrc.add(frame, { keyFrame: k === 0 }); // a keyframe where each range begins
        } finally {
          frame.close();
        }
        onProgress?.(Math.min(1, ++done / total));
        if (done % FPS === 0) heap.sample();
      }
      await scr.close();
      await cam?.close();
      open.length = 0;
      if (aSink) {
        const offset = startSlot / FPS;
        for await (const sample of aSink.samples(s, e)) {
          try {
            // Whole audio frames only, as in cuts.js: one that starts inside
            // the range is kept even if it runs a few ms past the end.
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
    heap.sample();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } catch (err) {
    for (const f of open) await f?.close().catch(() => {});
    await output?.cancel().catch(() => {});
    throw err;
  } finally {
    sIn.dispose();
    cIn.dispose();
  }
}

// A JPEG of the composite at screen time `time`: the screen frame with the
// bubble painted on it, `width` pixels wide. Used for the thumbnail, so the
// share page's poster shows the bubble where the video does.
export async function grabComposite({ screen, camera, cameraOffset = 0, time, bubble, width = 640 }) {
  const picture = await frameAt(screen, time, width);
  if (!picture) throw new Error('Could not decode a frame for the thumbnail.');
  const face = camera ? await frameAt(camera, Math.max(0, time - cameraOffset), 480).catch(() => null) : null;
  if (face) {
    const ctx = picture.getContext('2d');
    paint(ctx, bubble, picture.width, picture.height, face.width, face.height, (...a) => ctx.drawImage(face, ...a));
  }
  return toJpeg(picture);
}
