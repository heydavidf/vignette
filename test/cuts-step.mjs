// Step 3c of the end-to-end suite (run from e2e.mjs): mid-section cuts.
// Records 8 s, trims to 1 s to 7 s, cuts 3 s to 5 s with the buttons, checks
// the list, the clip length, the preview skipping the cut, the re-encoded
// export, the fallback when a re-encode fails, Remove, and cuts joining.
export const CUTS_STEP = '3c. Cut out the middle: record 8 s, trim to 1 s to 7 s, cut 3 s to 5 s, preview, export, remove';

export async function cutsStep(page, { record, assert, ok }) {
  await record(page, 8);
  await page.waitForFunction(() => document.getElementById('preview').readyState >= 1);
  const seekTo = (t) => page.evaluate((s) => { document.getElementById('preview').currentTime = s; }, t);
  const clipLength = () => page.evaluate(() => {
    const [, m, s] = /(\d+):([\d.]+)/.exec(document.getElementById('trimLength').textContent);
    return Number(m) * 60 + Number(s);
  });
  await seekTo(1);
  await page.click('#setStart');
  await seekTo(7);
  await page.click('#setEnd');
  await seekTo(3);
  await page.click('#cutFrom');
  await seekTo(5);
  await page.click('#cutTo');
  const rows = await page.locator('#cutList li').allTextContents();
  assert(rows.length === 1 && /^Cut 1\s+0:03\.0 to 0:05\.0\s+\(2\.0 s\)/.test(rows[0]), `cut list shows ${JSON.stringify(rows)}`);
  const withCut = await clipLength();
  assert(Math.abs(withCut - 4) < 0.05, `clip length reads ${withCut} s with the cut, expected 4.0`);
  // Playing from 2.5 s skips the cut: past 5 s within a second of play, never inside it.
  const jump = await page.evaluate(async () => {
    const v = document.getElementById('preview');
    v.currentTime = 2.5;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const seen = [];
    const log = () => seen.push(v.currentTime);
    v.addEventListener('timeupdate', log);
    await v.play();
    // Timed from the first frame shown: headless Chromium takes about 0.2 s to start presenting.
    await new Promise((r) => v.requestVideoFrameCallback(r));
    const t0 = performance.now();
    while (v.currentTime <= 5 && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    const ms = performance.now() - t0;
    v.pause();
    v.removeEventListener('timeupdate', log);
    return { ms, at: v.currentTime, inside: seen.filter((t) => t > 3.2 && t < 4.95) };
  });
  assert(jump.at > 5 && jump.ms < 1000, `preview reached ${jump.at.toFixed(2)} s after ${jump.ms.toFixed(0)} ms of play`);
  assert(jump.inside.length === 0, `preview played inside the cut at ${jump.inside.join(', ')} s`);
  // Export: the progress text says what happens, and the file is the clip without the cut.
  await page.evaluate(() => {
    const msg = document.getElementById('uploadMsg');
    window.__uploadMsgs = [];
    new MutationObserver(() => window.__uploadMsgs.push(msg.textContent)).observe(msg, { childList: true, characterData: true, subtree: true });
  });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  assert(download.suggestedFilename().endsWith('.mp4'), `download is called ${download.suggestedFilename()}`);
  const said = await page.evaluate(() => window.__uploadMsgs);
  assert(said.includes('Re-encoding 1 cut...'), `progress text was ${JSON.stringify(said)}`);
  const cutOut = await page.evaluate(async () => {
    const mb = await import('/vendor/mediabunny-1.61.6.min.mjs');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(window.__vignette.editor.exported.blob) });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const frame = video && await new mb.CanvasSink(video, { width: 320 }).getCanvas(1);
    let lit = 0;
    if (frame) {
      const c = new OffscreenCanvas(frame.canvas.width, frame.canvas.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(frame.canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.length; i += 4) if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 48) lit++;
      lit /= data.length / 4;
    }
    return {
      duration: await input.computeDuration(), lit,
      video: video && await video.getCodecParameterString(), audio: audio && await audio.getCodecParameterString(),
    };
  });
  assert(Math.abs(cutOut.duration - 4) < 0.3, `exported ${cutOut.duration} s, expected 4.0 s`);
  assert(cutOut.video && cutOut.audio, `exported tracks: video ${cutOut.video}, audio ${cutOut.audio}`);
  assert(cutOut.lit > 0.01, `the frame at 1 s is black (${(cutOut.lit * 100).toFixed(2)}% of pixels lit)`);
  await page.getByRole('button', { name: 'Remove cut 1, 0:03.0 to 0:05.0' }).click();
  await page.waitForSelector('#cutList', { state: 'hidden' });
  const restored = await clipLength();
  assert(Math.abs(restored - 6) < 0.05, `clip length reads ${restored} s after Remove, expected 6.0`);
  assert(await page.evaluate(() => document.activeElement.id === 'cutFrom'), 'focus was lost after Remove');
  // A failed re-encode says so, and Download then gives the trim alone; changing the cuts tries again.
  const exportedLength = () => page.evaluate(async () => {
    const mb = await import('/vendor/mediabunny-1.61.6.min.mjs');
    return new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(window.__vignette.editor.exported.blob) }).computeDuration();
  });
  const addCut = async (a, b) => { await seekTo(a); await page.click('#cutFrom'); await seekTo(b); await page.click('#cutTo'); };
  await page.evaluate(() => { window.__audioEncoder = window.AudioEncoder; window.AudioEncoder = undefined; });
  await addCut(2, 4);
  await page.click('#download');
  await page.waitForFunction(() => /^Could not re-encode the cuts/.test(document.getElementById('uploadMsg').textContent), null, { timeout: 60_000 });
  await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('#download')]);
  const trimOnly = await exportedLength();
  assert(Math.abs(trimOnly - 6) < 0.3, `after a failed re-encode the export is ${trimOnly} s, expected the 6 s trim`);
  await page.evaluate(() => { window.AudioEncoder = window.__audioEncoder; window.__uploadMsgs = []; });
  await page.getByRole('button', { name: /^Remove cut 1/ }).click();
  await addCut(2, 4);
  await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  const retried = await exportedLength();
  assert(Math.abs(retried - 4) < 0.3 && (await page.evaluate(() => window.__uploadMsgs)).includes('Re-encoding 1 cut...'),
    `changing the cuts did not re-encode again (${retried} s)`);
  // Cuts that overlap or touch join into one row, renumbered, counted once everywhere.
  const oneRow = async (span, length, name) => {
    const list = await page.locator('#cutList li').allTextContents();
    const now = await clipLength();
    assert(list.length === 1 && list[0].startsWith(`Cut 1 ${span}`) && Math.abs(now - length) < 0.05,
      `${name}: list ${JSON.stringify(list)}, clip length ${now} s; expected one row "${span}" and ${length} s`);
  };
  await addCut(2.5, 3.5);
  await oneRow('0:02.0 to 0:04.0 (2.0 s)', 4, 'a cut inside a cut');
  await addCut(3.5, 4.5);
  await oneRow('0:02.0 to 0:04.5 (2.5 s)', 3.5, 'an overlapping cut');
  await addCut(5.5, 6.5);
  assert((await page.locator('#cutList li').count()) === 2, 'a separate cut did not get its own row');
  await addCut(4.5, 5.5); // touches both
  await oneRow('0:02.0 to 0:06.5 (4.5 s)', 1.5, 'a cut touching two others');
  const joinedNote = await page.textContent('#cutMsg');
  assert(/meets 2 others, so they are joined: Cut 1 is now 0:02\.0 to 0:06\.5/.test(joinedNote), `join note reads "${joinedNote}"`);
  await page.evaluate(() => { window.__uploadMsgs = []; });
  await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  const joined = await exportedLength();
  assert(Math.abs(joined - 1.5) < 0.3 && (await page.evaluate(() => window.__uploadMsgs)).includes('Re-encoding 1 cut...'),
    `joined cuts exported ${joined} s with progress ${JSON.stringify(await page.evaluate(() => window.__uploadMsgs))}`);
  await page.getByRole('button', { name: 'Remove cut 1, 0:02.0 to 0:06.5' }).click();
  await page.waitForSelector('#cutList', { state: 'hidden' });
  assert(Math.abs((await clipLength()) - 6) < 0.05, 'Remove on the joined row did not restore the clip length');
  ok(`one row "${rows[0].slice(0, 30)}", clip ${withCut.toFixed(1)} s; preview went 2.5 s to ${jump.at.toFixed(2)} s in ${jump.ms.toFixed(0)} ms; `
    + `exported ${cutOut.duration.toFixed(2)} s (${cutOut.video}, ${cutOut.audio}), ${(cutOut.lit * 100).toFixed(0)}% lit at 1 s; Remove gives ${restored.toFixed(1)} s; `
    + `a failed re-encode falls back to the ${trimOnly.toFixed(1)} s trim, and changing the cuts re-encodes again; `
    + `inside, overlapping and touching cuts join into one row (${joined.toFixed(2)} s exported, "Re-encoding 1 cut"), and Remove clears it`);
}
