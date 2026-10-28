# Vignette backlog

Everything deliberately left out of v0.1. The rule from `MVP_SPEC.md` holds: if it is not in the spec, it goes here first.

## Done
- **Mid-section cuts.** Cut from here / Cut to here on the edit step, cuts drawn struck on the trim bar, a cut list with Remove, and a preview that skips cuts. Export re-encodes only when a cut is inside the clip (Mediabunny sample sinks into H.264 and AAC sample sources, `public/cuts.js`); a trim alone stays the copy path. Spec: `CUTS_SPEC.md`.
- **Two tracks (0.2, loop 1).** The screen and the camera are recorded as separate files, the bubble is placed in the edit step and rendered in at export (`public/render.js`), and the originals are kept in R2 for the owner. Spec: `LOOP1_TWO_TRACKS_SPEC.md`. Layouts and mobile export build on it.
- **Layouts (0.2, loop 3).** Bubble (round or square), Split, Camera only, Screen only and Padded (four colours), chosen in the edit step with a live preview and rendered at export (`public/layouts.js`, `public/render.js`); Change layout in the library renders an uploaded recording again from its originals under the same link. Spec: `LOOP3_LAYOUTS_SPEC.md`.
- **Split `test/e2e.mjs`.** The server and browser setup moved to `test/harness.mjs` (loop 3), so the suite's main file has room for new steps.

## Editing
- **Mobile export** (the 0.2 plan): an export shaped for phones, built on the two tracks and the layouts.
- **Cut follow-ups.** Sample-exact audio at each join (whole audio frames are kept, so a join can carry up to about 20 ms of extra sound), moving a chosen thumbnail when cuts shift it, undo beyond Remove, and showing cuts on the share page.
- **Captions.** Speech-to-text, a caption track in the MP4, and an editor for fixing mistakes.
- **Zoom effects.** Automatic or manual zoom towards the cursor or a region.
- **Blur or redact a region** before upload.

## Recording
- **Off-main-thread preview.** Since two tracks the live canvas is a preview only (the recording no longer depends on it). It is drawn from a Worker timer, which keeps 30 fps in a background tab; moving the drawing itself into a Worker (OffscreenCanvas plus `MediaStreamTrackProcessor`) would also survive a frozen page.
- **Pause and resume** during a recording.
- **Higher than 1080p30** capture.
- **Drawing or pointer highlight** on screen while recording.

## Browsers
- **Safari and Firefox polish.** v0.1 aims for "does not crash" there. Firefox records WebM, which is converted to MP4 in the browser; Safari has gaps in screen capture audio. Both need testing and fixes.
- **Mobile recording.** Phones cannot share their screen from a web page today; v0.1 only plays videos on phones.

## Sharing and access
- **Per-video password** for share links.
- **Multi-user.** v0.1 has a single owner password. Accounts, teams and roles are out.
- **Private links that expire,** or signed media URLs. v0.1 links are unlisted, not private: anyone with the link can watch.
- **View counts and analytics.**
- **Comments and reactions** on the share page.
- **Embeds** (an `/embed/:id` player and oEmbed endpoint).
- **Custom domain** walkthrough in the README.

## Library
- **Rename a video** or replace its thumbnail after upload.
- **Search, sort and folders.**
- **Clean-up job** for uploads abandoned half way (they currently stay as "Uploading" rows until deleted by hand).
- **Single-shot upload racing a delete.** A single-shot `PUT .../blob` (video or original) that is still streaming when the row is deleted can write its file after the delete, leaving an orphan object in R2. Rare (it needs a delete during your own upload); a clean-up job or a check after the write would close it.
- **Render again, stale takeover race:** if a second render-again takes over an abandoned one after an hour and the first then completes, its complete updates no row; the file in R2 is the first's until the second completes. Owner-only, after an hour; not fixed because no test can reach it through the API.

## Setup
- **Deploy-to-Cloudflare button** for a one-click install.
- **Automatic database setup** on first deploy, so `npm run db:init` is not a separate step.

## Engineering
- **Peak memory in the tests is a weak check.** In the suite's headless Chromium `performance.memory.usedJSHeapSize` reads 10,000,000 bytes whatever the page holds (an 88 MB allocation still read 10 MB), so the Details panel's peak memory is always 10 MB there and the 400 MB bounds on it in `tracks-scenario.mjs`, `selfview-scenario.mjs` and the builders' steps cannot fail. `layouts-scenario.mjs` scenario 8 samples the heap through the DevTools protocol instead; move the other checks to that, and remember the video bytes live in Blobs and ArrayBuffers outside the JavaScript heap, so a heap bound says little about a render's real memory (found 2026-10-28 by the loop 3 scenario tester).
- **Transcoding fallback** for very large recordings that do not fit in browser memory (v0.1 keeps the whole recording in memory while editing).
- **Resumable uploads across page reloads** (v0.1 retries within the same page only).
- **Upload progress inside a part** (v0.1 reports progress per 20 MiB part, because it uses `fetch` rather than XHR).

## Added 2026-10-19 (David's direction after the MVP)

- ~~Mid-section cuts.~~ Done before the first release (see Done above).
- **Filler-word removal (um, er, like).** Nice to have, later. Needs a transcript with word timestamps; options in order of cost: (1) the browser's own `SpeechRecognition` (Chrome only, no timestamps, so not enough), (2) Whisper via a small WebGPU model in the browser (transformers.js, ~40 MB download, timestamps available), (3) a Cloudflare Workers AI Whisper call at upload time (costs a little, simplest to build). Then mark filler words on the timeline and cut them with the mid-section cut machinery (`public/cuts.js`).
