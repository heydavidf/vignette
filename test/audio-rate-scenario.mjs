// Step 3s of the end-to-end suite (run from e2e.mjs): an independent scenario
// test for sound that is not 44.1 or 48 kHz (a Bluetooth headset's microphone
// makes the page's AudioContext 24 kHz; browsers encode AAC at 44.1 and 48 kHz
// only). Each scenario runs in its own browser context with the AudioContext
// forced to a rate. 1: a steady 440 Hz tone at 24 kHz keeps its pitch and has
// no clicks where decoded samples join. 2: 16 kHz (a step of one third). 3: 44.1
// kHz is passed through, not resampled. 4: the phone version at 24 kHz.
// The exports are decoded in the page with Mediabunny and measured.
import { readFile } from 'node:fs/promises';

export const AUDIO_RATE_SCENARIO = '3s. Sound at 24, 16 and 44.1 kHz: a 440 Hz tone keeps its pitch without clicks, 16 kHz renders at 48 kHz, 44.1 kHz passes through, the phone version is 48 kHz';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const SECONDS = 4;
const TONE = 440;

// Init script: every AudioContext the page makes runs at `rate`, and with `tone` the microphone is a steady sine.
function audioHooks({ rate, tone }) {
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(o) { super({ ...o, sampleRate: rate }); }
  };
  if (tone) {
    const md = navigator.mediaDevices, real = md.getUserMedia.bind(md);
    // Chromium's tab capture adds its own sound to the mix: bursts about as loud as 1.0, a quarter of every
    // second (measured on a recording with the microphone off). They would swamp the tone, so the share has no sound.
    const share = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (c) => {
      const stream = await share(c);
      for (const t of stream.getAudioTracks()) { t.stop(); stream.removeTrack(t); }
      return stream;
    };
    md.getUserMedia = async (c) => {
      if (!c?.audio || c.video) return real(c);
      const ctx = new window.AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 440; gain.gain.value = 0.5;
      osc.connect(gain).connect(dest); osc.start();
      return dest.stream;
    };
  }
}

// Runs in the page. Decodes the sound of the MP4 given as base64 and measures it: the rate, the
// duration, the peak, and for the middle of the clip (the first and last 0.5 s skipped, where AAC priming
// and the edge are) the rms, the largest sample-to-sample jump and the pitch by zero crossings.
async function measure({ mb, b64 }) {
  const M = await import(mb);
  const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/mp4' });
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { none: true };
    const sink = new M.AudioSampleSink(track);
    const chunks = []; let rate = 0, first = null, end = 0;
    for await (const s of sink.samples()) {
      rate = s.sampleRate;
      const p = new Float32Array(s.numberOfFrames);
      s.copyTo(p, { planeIndex: 0, format: 'f32-planar' });
      chunks.push(p);
      if (first === null) first = s.timestamp;
      end = s.timestamp + s.duration;
      s.close();
    }
    const x = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { x.set(c, o); o += c.length; }
    let peak = 0; for (const s of x) peak = Math.max(peak, Math.abs(s));
    const a = Math.floor(rate * 0.5), b = x.length - a;
    // Crossings count only after the sound has gone past -0.1 and then +0.1: AAC noise near zero would
    // otherwise add double crossings (measured: 455 Hz for a clean 440 Hz tone, whose spectrum peak is 440).
    let sq = 0, jump = 0, at = 0, cross = 0, firstX = -1, lastX = -1, low = false;
    for (let i = a; i < b; i++) {
      sq += x[i] * x[i];
      if (i > a && Math.abs(x[i] - x[i - 1]) > jump) { jump = Math.abs(x[i] - x[i - 1]); at = i / rate; }
      if (x[i] < -0.1) low = true;
      else if (x[i] > 0.1 && low) { low = false; cross++; if (firstX < 0) firstX = i; lastX = i; }
    }
    const hz = cross > 1 ? ((cross - 1) * rate) / (lastX - firstX) : 0;
    return { rate, first, end, frames: x.length, peak, rms: Math.sqrt(sq / (b - a)), jump, at, hz, duration: end - first };
  } finally { input.dispose(); }
}

// Records SECONDS in a new context with the sound forced to `rate` (and a tone if asked), runs `body`, closes the context.
async function scenario(browser, ctx, { rate, tone = false }, body) {
  const context = await browser.newContext();
  try {
    await context.addInitScript(ctx.pageHooks);
    await context.addInitScript(audioHooks, { rate, tone });
    const page = ctx.watch(await context.newPage(), `audio ${rate}`);
    await ctx.login(page, ctx.base);
    await page.waitForSelector('#app:not([hidden])');
    await ctx.record(page, SECONDS);
    const sound = await page.evaluate(() => window.__vignette.editor.video.duration);
    return await body(page, sound);
  } finally { await context.close(); }
}

// Presses a download button as a person would, then measures the sound of the file that was saved.
// A render that fails shows "Could not render ..." in the page: that fails the scenario at once, with the message.
async function exportAndMeasure(page, button) {
  const saved = page.waitForEvent('download', { timeout: 180_000 });
  const failed = page.waitForFunction(() => /Could not (render|re-encode)[^\n]*/.exec(document.body.innerText)?.[0], null, { timeout: 180_000 }).then((h) => h.jsonValue());
  saved.catch(() => {}); failed.catch(() => {});
  await page.click(button);
  const download = await Promise.race([saved, failed.then((m) => { throw new Error(`the export failed: ${m}`); })]);
  const path = await download.path();
  await page.waitForFunction((b) => !document.querySelector(b).disabled, button);
  return page.evaluate(measure, { mb: MB, b64: (await readFile(path)).toString('base64') });
}

export async function audioRateScenario(browser, ctx) {
  const { assert, ok } = ctx;
  const f = (n, d = 3) => Number(n).toFixed(d);

  // 1. Pitch and joins at 24 kHz. Headless Chromium now and then glitches while recording the synthetic tone
  // (seen: a step of 0.48 in the recording itself, before any render, in 1 run of 20). The render is judged
  // only on a recording whose own largest step is within 1.5 times what the tone allows at 24 kHz; else record again.
  let one = null, glitches = [];
  for (let attempt = 0; attempt < 3 && !one; attempt++) {
    const got = await scenario(browser, ctx, { rate: 24000, tone: true }, async (page, clip) => {
      const layout = await page.evaluate(() => window.__vignette.layout.id);
      assert(layout === 'bubble', `scenario 1: the layout is ${layout}, expected the bubble`);
      const b64 = await page.evaluate(async () => {
        const bytes = new Uint8Array(await window.__vignette.editor.video.blob.arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      });
      const raw = await page.evaluate(measure, { mb: MB, b64 });
      raw.limit = raw.rms * Math.SQRT2 * 2 * Math.PI * TONE / 24000 * 1.5;
      if (raw.jump >= raw.limit) return { glitch: raw };
      return { clip, raw, m: await exportAndMeasure(page, '#download') };
    });
    if (got.glitch) glitches.push(`${f(got.glitch.jump, 3)} at ${f(got.glitch.at)} s`); else one = got;
  }
  assert(one, `scenario 1: the recording itself glitched 3 times (largest steps ${glitches.join(', ')}), so the render could not be judged`);
  const m1 = one.m;
  assert(!m1.none, 'scenario 1: the export has no sound');
  assert(m1.rate === 48000, `scenario 1: 24 kHz tone came out at ${m1.rate} Hz, expected 48000`);
  assert(Math.abs(m1.duration - one.clip) < 0.3, `scenario 1: sound lasts ${f(m1.duration)} s for a ${f(one.clip)} s clip`);
  assert(Math.abs(m1.hz - TONE) < 4, `scenario 1: the tone came out at ${f(m1.hz, 1)} Hz, expected ${TONE}`);
  assert(m1.rms > 0.1, `scenario 1: the tone is nearly silent (rms ${f(m1.rms)})`);
  // A sine of rms r has amplitude r * sqrt(2) and its largest step at 48 kHz is amplitude * 2 pi f / rate.
  // A join with a step in it jumps by a good part of the amplitude; AAC noise adds a little, so allow 1.5 times the ideal step (measured 1.02 times).
  const ideal = m1.rms * Math.SQRT2 * 2 * Math.PI * TONE / 48000;
  assert(m1.jump < ideal * 1.5, `scenario 1: largest sample step ${f(m1.jump, 4)} at ${f(m1.at)} s, a ${TONE} Hz tone of rms ${f(m1.rms)} allows ${f(ideal, 4)} (limit ${f(ideal * 1.5, 4)}); the recording before the render had ${f(one.raw.jump, 4)}`);

  // 2. 16 kHz
  const two = await scenario(browser, ctx, { rate: 16000 }, async (page, clip) => {
    return { clip, m: await exportAndMeasure(page, '#download') };
  });
  assert(!two.m.none && two.m.peak > 0.01, `scenario 2: no sound in the 16 kHz export (peak ${two.m.peak})`);
  assert(two.m.rate === 48000, `scenario 2: 16 kHz sound came out at ${two.m.rate} Hz, expected 48000`);
  assert(Math.abs(two.m.duration - two.clip) < 0.3, `scenario 2: sound lasts ${f(two.m.duration)} s for a ${f(two.clip)} s clip`);

  // 3. 44.1 kHz is not resampled
  const three = await scenario(browser, ctx, { rate: 44100 }, async (page, clip) => {
    return { clip, m: await exportAndMeasure(page, '#download') };
  });
  assert(!three.m.none && three.m.peak > 0.01, `scenario 3: no sound in the 44.1 kHz export (peak ${three.m.peak})`);
  assert(three.m.rate === 44100, `scenario 3: 44.1 kHz sound came out at ${three.m.rate} Hz, expected it kept`);
  assert(Math.abs(three.m.duration - three.clip) < 0.3, `scenario 3: sound lasts ${f(three.m.duration)} s for a ${f(three.clip)} s clip`);

  // 4. The phone version at 24 kHz
  const four = await scenario(browser, ctx, { rate: 24000 }, async (page, clip) => {
    await page.click('#phoneTools .toggle');
    return { clip, m: await exportAndMeasure(page, '#downloadPhone') };
  });
  assert(!four.m.none && four.m.peak > 0.01, `scenario 4: no sound in the phone version (peak ${four.m.peak})`);
  assert(four.m.rate === 48000, `scenario 4: the phone version's sound is ${four.m.rate} Hz, expected 48000`);
  assert(Math.abs(four.m.duration - four.clip) < 0.3, `scenario 4: phone sound lasts ${f(four.m.duration)} s for a ${f(four.clip)} s clip`);

  ok(`24 kHz tone${glitches.length ? ` (after ${glitches.length} glitched recording${glitches.length > 1 ? 's' : ''})` : ''}: ${m1.rate} Hz out, ${f(m1.hz, 1)} Hz pitch, largest step ${f(m1.jump, 4)} (limit ${f(ideal * 1.5, 4)}), ${f(m1.duration)} s of ${f(one.clip)} s; 16 kHz: ${two.m.rate} Hz, ${f(two.m.duration)} s of ${f(two.clip)} s; 44.1 kHz: ${three.m.rate} Hz kept; phone at 24 kHz: ${four.m.rate} Hz, ${f(four.m.duration)} s of ${f(four.clip)} s`);
}
