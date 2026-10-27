# Loop 1: two tracks (build spec)

Branch `v0.2-tracks-layouts`. Record the screen and the camera as separate streams, keep both, and make the webcam bubble an editing decision. Nothing the viewer sees changes yet; the share page still plays one MP4. This is the foundation for layouts and mobile export (`BUILD_PLAN_v0.2.md` in the owner's workspace; the plan's decisions: raw files kept by default, one layout per recording).

## What changes for the user

- Recording looks the same: Share screen, webcam and microphone toggles, the live bubble in the preview, 3-2-1, Stop. The bubble can still be dragged while recording; that sets the starting position for the editor.
- After Stop, the edit step shows the composite (screen with the camera bubble) and the bubble is draggable and resizable **there**, with the same three sizes. Wherever it is when the user exports or uploads is where it lands in the file.
- Export and upload take a little longer when the camera was on, because the composite is now rendered at export time (hardware encode, about the speed of a cut). The progress text says "Rendering".
- The originals (screen and camera as recorded) are uploaded too and kept. The library gets a small "originals kept" mark on the row; nothing else.

## Recording (`public/recorder.js`, new `public/tracks.js` if it keeps files under 500 lines)

- Two `MediaRecorder`s started back to back in the same tick: **screen** (the raw screen video track plus the mixed audio track, exactly the current webcam-off path) and **camera** (the raw camera video track only, no audio). Same MIME preference as today for each. Record `cameraOffset = cameraStart - screenStart` in seconds from `performance.now()` at each `start()` call.
- The live composite canvas is still drawn (via the Worker ticker) for the preview and for the floating window in loop 2, but it is **no longer captured**. `canvas.captureStream` goes away.
- With the webcam off: one recorder, unchanged behaviour, no camera blob.
- After Stop: both blobs are re-packaged with Mediabunny as today (duration fix). Details panel reports both sizes, the offset, and peak memory.
- Camera lost mid-recording (unplugged or permission revoked): keep recording the screen; the camera blob ends early; the renderer holds the last camera frame until the end (or shows nothing if the camera never produced a frame). Say so in the Details panel.

## Editing (`public/editor.js`, `public/bubble.js`)

- The preview is no longer one video: the screen recording plays in the existing preview element, and the camera recording plays in a second, muted video element clipped into the bubble, positioned by `bubble.js` over the preview. Keep them in step: on play, pause, seek and `timeupdate` of the screen video, set `camera.currentTime = screen.currentTime - cameraOffset` when they drift by more than 80 ms, and mirror play and pause. Trim and cuts apply to the screen timeline as now; the camera follows.
- The bubble controls (drag, three sizes, keyboard nudge) move into the edit step; the recorder keeps its live bubble but the editor's position is what counts. Both read and write the same stored position (normalised, as today).
- No layout chooser yet (loop 3); the only layout is bubble, which also means "no camera" when the camera was off.

## Rendering (`public/render.js`, extracted from the two-input parts of `public/cuts.js`)

- One renderer for every export when a camera track exists: decode screen and camera with Mediabunny sample sinks, draw each output frame on a canvas of the screen's size (bubble drawn with the stored position, size and shape, mirroring the live composite exactly), encode with the sample sources, copy the audio from the screen track. Kept ranges (trim and cuts) drive which frames are read, as the cuts renderer does now. The camera frame used for each output frame is the one with the largest timestamp at or before `t - cameraOffset`; a missing camera frame holds the previous one.
- Without a camera track: today's behaviour is untouched (copy path for trim, re-encode only for cuts).
- Performance target: at least four seconds of video per second for 1080p30 screen plus 720p camera on this Mac; report the measured figure in the Details panel and the report.

## Storage and API (`worker/index.js`, `schema.sql`, new `migrations/`)

- R2 keys: `videos/<id>.mp4` (rendered, served publicly as now), `raw/<id>-screen.mp4`, `raw/<id>-camera.mp4` (owner only, never served by `/media`).
- D1: add columns `camera_offset REAL`, `has_raw INTEGER NOT NULL DEFAULT 0`, `layout TEXT NOT NULL DEFAULT 'bubble'`, `bubble TEXT` (JSON `{x, y, size}`). `schema.sql` creates the full table for fresh installs. `migrations/0002-two-tracks.sql` holds the `ALTER TABLE ... ADD COLUMN` statements for existing installs; `npm run db:migrate` (through `scripts/wrangler.mjs`) applies it remotely, `db:migrate:local` locally. The README's upgrade note says existing instances run it once. The Worker must give a clear 500 message if the columns are missing ("Run: npm run db:migrate").
- Upload order from the client: rendered video first (single-shot or multipart as today), `complete` marks the row `ready` so the link works, then the thumbnail, then the two raw files through the same single-shot-or-multipart machinery, selected by a `track` parameter: `PUT /api/videos/:id/blob?track=screen`, `PUT /api/videos/:id/parts/:n?track=camera`, `POST /api/videos/:id/complete?track=screen`, each owner-only, each validating `track` against `video|screen|camera`. When both raw completes succeed, `has_raw` becomes 1. A raw upload failure never breaks the share link; the UI shows "Originals not kept" with Retry.
- New owner-only route `GET /api/videos/:id/raw/:track` streams a raw file (loop 3 needs it for re-rendering); 404 unless the row has `has_raw` and the object exists. `/media/:id` and `/thumb/:id` are unchanged and never serve raw keys.
- `DELETE` removes all four objects (video, thumb, two raw) and aborts any open multipart on any of them.
- `GET /api/videos` includes `has_raw`; the library shows the mark.

## Tests

`test/e2e.mjs` (builder):
- Two-track recording: with the webcam on, after Stop the page exposes two blobs and a small non-negative offset (`window.__vignette.tracks`); with the webcam off, one blob and no camera.
- Bubble moved in the editor (not while recording) lands in the render: drag it to the top right, export, decode frames at two times and assert the bright bubble region is top right (brightness sampling as step 3b does today).
- Upload with the camera on: share page plays; the row has `has_raw` 1; `GET /api/videos/:id/raw/camera` with the password returns the camera file and without the password 401; `/media/raw/...` and any public path to raw keys is 404.
- Delete removes everything: afterwards the raw route is 404 and the share page is 404.
- Migration: on a fresh local database `npm run db:init:local` then `npm run db:migrate:local` both succeed, and running the migration twice gives the clear "already applied" outcome (or is idempotent).
- Existing steps stay green, including `BACKGROUND=1`.

Independent scenario test (a different agent, repo rule 5): camera permission denied after the screen is shared; camera stream ending mid-recording; a recording with the camera on but the bubble dragged off every edge; a 60 s recording's peak memory; raw upload failure injected (route blocked) leaving the share link working and the row `has_raw` 0 with Retry visible.

## Docs

README: the edit step now says where the bubble is set; limits section updated for memory (two originals in browser memory) and for the new upgrade step; "originals kept" explained in one sentence. AGENTS.md file map (`tracks.js`, `render.js`, `migrations/`). CHANGELOG under "Unreleased". DESIGN.md only if a new control type appears (the bubble controls are existing pictogram squares moved to the edit band).

## Done when

- `npm test` and `BACKGROUND=1 npm test` print E2E OK with the new steps; the independent scenario test passes; the security review of the Worker diff has no finding at threshold; the finish review of the edit step says ship.
- David records with the bubble on, moves it after stopping, uploads, and the share page shows it where he put it; the library shows "originals kept".
- Measured render speed and peak memory are written into the README limits and the loop report.
