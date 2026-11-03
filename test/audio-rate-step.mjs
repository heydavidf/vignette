// Step 3r of the end-to-end suite (run from e2e.mjs): sound recorded at 24 kHz,
// as a Bluetooth headset's microphone makes it (AirPods on a Mac). Browsers
// encode AAC at 44.1 and 48 kHz only, so the bubble render failed on such a
// recording with "This specific encoder configuration (mp4a.40.29, 128000 bps,
// 2 channels, 24000 Hz) is not supported" until public/audio.js resampled it.
// Here every AudioContext in the page runs at 24 kHz; the recording must come
// out at 24 kHz (rebuilt so on Linux, see soundAt), and the Bubble render and a
// Screen only cut at 48 kHz, as long as the clip and with the sound still in it.
export const AUDIO_RATE_STEP = '3r. Sound at 24 kHz, as from a headset microphone: the bubble render and a cut re-encode it at 48 kHz, as long as the clip and audible';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';

// Runs before the page's scripts: AudioContext defaults to 24 kHz, as on a Mac
// whose sound goes through a Bluetooth headset with its microphone in use.
function headsetRate() {
  const Real = window.AudioContext;
  window.AudioContext = class extends Real { constructor(options = {}) { super({ sampleRate: 24000, ...options }); } };
}

// Runs in the page: makes the edit step's screen recording carry its sound at `rate`. Chromium on macOS
// records AAC at the AudioContext's rate, so a 24 kHz context gives 24 kHz already. Chromium on Linux has no
// AAC encoder and records Opus, which always decodes at 48 kHz, so there the recording is rebuilt with its
// video copied and its sound as 16-bit PCM at `rate`, and the edit step is given that file. The headset bug
// cannot happen with Opus, but the render and the cuts still meet sound at `rate` and must resample it.
// Shared with audio-rate-scenario.mjs. Returns the sound's codec and rate, and whether it was rebuilt.
export async function soundAt({ mb, rate }) {
  const M = await import(mb);
  const video = window.__vignette.editor.video;
  const track = async (blob) => {
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
    try { const t = await input.getPrimaryAudioTrack(); return t && { codec: await t.getCodecParameterString(), rate: t.sampleRate }; } finally { input.dispose(); }
  };
  const recorded = await track(video.blob);
  if (!recorded || recorded.rate === rate) return { ...recorded, rebuilt: false };
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(video.blob) });
  const conversion = await M.Conversion.init({ input, output, audio: { codec: 'pcm-s16', sampleRate: rate, forceTranscode: true } });
  if (!conversion.isValid) throw new Error(`could not rebuild the recording's sound at ${rate} Hz: ${conversion.discardedTracks.map((d) => d.reason).join(', ')}`);
  await conversion.execute();
  video.blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  return { ...(await track(video.blob)), rebuilt: true, recorded };
}

// Runs in the page: the sound of the recording or of the export. The track's
// codec and rate, the decoded rate and length, and the loudest sample.
async function sound({ mb, source }) {
  const M = await import(mb);
  const { video, exported } = window.__vignette.editor;
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource((source === 'export' ? exported : video).blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    let peak = 0, frames = 0, rate = 0;
    for await (const s of new M.AudioSampleSink(track).samples()) {
      try {
        rate = s.sampleRate;
        const p = new Float32Array(s.numberOfFrames);
        s.copyTo(p, { planeIndex: 0, format: 'f32-planar' });
        for (const v of p) peak = Math.max(peak, Math.abs(v));
        frames += s.numberOfFrames;
      } finally { s.close(); }
    }
    return { codec: await track.getCodecParameterString(), trackRate: track.sampleRate, rate, seconds: rate ? frames / rate : 0, peak, duration: await input.computeDuration() };
  } finally { input.dispose(); }
}

// Download MP4, until the file arrives or the page says it could not prepare it (then no file comes).
async function exportNow(page) {
  const download = page.waitForEvent('download', { timeout: 120_000 });
  const refused = page.waitForFunction(() => /^Could not/.test(document.getElementById('uploadMsg').textContent), null, { timeout: 120_000 });
  await page.click('#download');
  await Promise.race([download, refused]);
  download.catch(() => {}); refused.catch(() => {});
  await page.waitForFunction(() => !document.getElementById('download').disabled);
  return page.evaluate(() => ({ how: window.__vignette.details.export, said: document.getElementById('uploadMsg').textContent }));
}

export async function audioRateStep(browser, { base, login, pageHooks, watch, record, assert, ok }) {
  const context = await browser.newContext();
  try {
    await context.addInitScript(pageHooks);
    await context.addInitScript(headsetRate);
    const page = watch(await context.newPage(), 'headset recorder');
    await login(page, base);
    await page.waitForSelector('#app:not([hidden])');
    await page.check('#cam');
    await page.check('#mic');
    await record(page, 4);
    const made = await page.evaluate(soundAt, { mb: MB, rate: 24000 });
    const raw = await page.evaluate(sound, { mb: MB, source: 'video' });
    assert(raw && raw.rate === 24000 && raw.peak > 0.05, `the recording's sound is ${JSON.stringify(raw)}; expected 24 kHz with sound in it, standing for a headset`);
    const fine = (s, length, name) => {
      assert(s && s.rate === 48000 && s.trackRate === 48000 && /^(mp4a\.40\.2|opus)$/.test(s.codec), `${name}: the sound is ${JSON.stringify(s)}, expected 48 kHz AAC-LC (or Opus where AAC cannot be encoded)`);
      assert(Math.abs(s.seconds - length) < 0.3 && Math.abs(s.duration - length) < 0.3, `${name}: ${s.seconds.toFixed(2)} s of sound in a ${s.duration.toFixed(2)} s file, expected ${length.toFixed(2)} s`);
      assert(s.peak > raw.peak * 0.5, `${name}: the loudest sample is ${s.peak.toFixed(3)}, the recording's ${raw.peak.toFixed(3)}`);
    };
    // Bubble, the default with the webcam on: rendered, not the fallback.
    const bubble = await exportNow(page);
    assert(/rendered with the bubble/.test(bubble.how) && !/Could not/.test(bubble.said), `the bubble export says "${bubble.how}", "${bubble.said}"`);
    const rendered = await page.evaluate(sound, { mb: MB, source: 'export' });
    fine(rendered, raw.duration, 'Bubble');
    // Screen only with a 1 s cut: re-encoded by cuts.js.
    await page.locator('#layoutTools label[title="Screen only"]').click();
    const seek = (t) => page.evaluate((s) => { document.getElementById('preview').currentTime = s; }, t);
    await seek(1); await page.click('#cutFrom');
    await seek(2); await page.click('#cutTo');
    const cut = await exportNow(page);
    assert(/re-encoded 1 cut/.test(cut.how) && !/Could not/.test(cut.said), `Screen only with a cut says "${cut.how}", "${cut.said}"`);
    const reencoded = await page.evaluate(sound, { mb: MB, source: 'export' });
    fine(reencoded, raw.duration - 1, 'Screen only with a cut');
    ok(`${made.rebuilt ? `recorded ${made.recorded.codec} at ${made.recorded.rate} Hz, rebuilt as` : 'recorded'} ${raw.codec} at ${raw.rate} Hz (${raw.duration.toFixed(2)} s, peak ${raw.peak.toFixed(2)}); the bubble render gave ${rendered.codec} at ${rendered.rate} Hz, `
      + `${rendered.seconds.toFixed(2)} s, peak ${rendered.peak.toFixed(2)}; Screen only with a 1 s cut gave ${reencoded.codec} at ${reencoded.rate} Hz, ${reencoded.seconds.toFixed(2)} s, peak ${reencoded.peak.toFixed(2)}`);
  } finally {
    await context.close();
  }
}
