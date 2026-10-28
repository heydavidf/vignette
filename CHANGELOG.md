# Changelog

Notable changes to Vignette. Versions follow [Semantic Versioning](https://semver.org/); each release is a Git tag and a GitHub Release.

## Unreleased

### Two tracks

- With the webcam on, the screen and the camera are now recorded as two separate files. The bubble is no longer burned in while recording: it is drawn in when you export or upload, wherever you leave it in the edit step.
- The edit step shows the bubble over the player, playing the camera in step with the screen. Drag it, select it and nudge it with the arrow keys, or pick its size there; **Full screen** shows the picture with the bubble (the player's own full screen and picture in picture are off then, since they would show the screen alone). Dragging it while recording still works and sets where it starts. While the video renders or uploads, and once the link is made, the bubble, the trim and the cuts hold still, because the link keeps them.
- Export and upload with the camera on render the video (decode both files, draw each frame, encode again as H.264 through the browser's encoder), so they take a little longer; the progress text says "Rendering the video..." and the bar shows its percent. Without the camera nothing changes: a trim still copies.
- The thumbnail shows the bubble where the video does.
- After the link works, the originals (the screen and the camera as recorded) are uploaded too and kept with the video, for re-rendering in a later version. They contain everything that was trimmed or cut out. If that fails the link still works, the page says "Originals not kept" and what is missing, and Retry sends only that. The library marks such recordings "Originals kept". Delete removes them with the video.
- The webcam is captured at up to 1280x720 (was 640x480), since its file is kept.
- If the camera is unplugged or its permission taken back mid-recording, the screen keeps recording and the bubble holds the camera's last frame; the Details panel says when it happened.
- The Details panel reports both file sizes, how much later the camera started and the render speed, plus the peak JavaScript heap. That heap is not the page's whole memory use: measured from outside on an Apple M1 Max (one run, renderer process only), a 60 second recording took about 757 MB, and about 1.04 GB while preparing and rendering (see README limits).

### Floating self-view window

- **Start recording** opens a small window that stays on top of other apps: 3-2-1 (the same split-flap flip as the page), then the picture being recorded, a red dot, the time and a Stop square that works like Stop on the page. Two squares switch the picture between the screen with the bubble and the camera alone. The window closes when the recording stops.
- Closing the window by hand keeps the recording going; **Show window** in step 2 opens it again, with the script where it was (same place, speed and pause). Stop in the window is off during the countdown, as on the page.
- Sharing the whole screen puts the window in the recording, so it then opens on the camera alone, and the window (under its controls) and the page say: "This window is in the recording. Move it to another screen, or share a window instead." The other view is still a click away.
- With the webcam off the window shows the screen; the camera-only square is off.
- New **Script** toggle in step 1: a text box for notes to read while recording, under the toggles (above Share screen on phones). The window shows them under the picture, scrolling slowly (one line every 2.5 s), with squares for slower, pause and faster (0.5x to 2x); the wheel or a drag scrolls by hand and holds the scroll for 3 s. With reduced motion it starts paused. The text stays in the browser tab (sessionStorage) and is never uploaded.
- The window is Document Picture-in-Picture (Chrome and Edge). Browsers without it but with classic picture-in-picture get a video of the picture with the dot and the time on a black strip under it (no Stop, no script); others get nothing. If the browser refuses the window, the recording goes on without it. Details says which was used.
- New pictograms: script, pause, minus, plus, window.

### Server and setup

- New owner-only route `GET /api/videos/:id/raw/screen|camera` (with Range support) for the originals. They are stored under `raw/` in R2 and never served by `/media` or any public path. Uploads take `?track=screen|camera` on the existing blob, parts and complete routes.
- **Upgrade step for existing installs:** run `npm run db:migrate` once (`db:migrate:local` for the local database). It adds the new columns and says "already applied" if run again. Until it runs, share links keep working and the owner pages say what to run.
- `scripts/wrangler.mjs` keeps a `--config` (or `-c`) given on the command line instead of adding `wrangler.local.toml`.
- Creating a video aborts the multipart uploads it opened in R2 if its database row cannot be written (for example on a 0.1 database before the update), so no parts are left behind.
- The share page's HTML moved to `worker/share-page.js`; the Mediabunny helpers to `public/media.js`.

## 0.1.0 (2026-10-21)

The first public version: an open-source screen recorder that runs entirely in the browser and self-hosts on a free Cloudflare account.

### Recording

- Record a screen, window or tab in Chrome or Edge, with an optional webcam bubble and microphone. Tab audio and the microphone are mixed into one track.
- The webcam bubble can be dragged anywhere in the preview, before or during a recording, in three sizes. The recording draws it where you placed it.
- With the bubble off, the screen stream is recorded directly. With it on, compositing runs on a canvas capped at 1080p, driven from a Worker timer so a background tab keeps 30 frames per second.
- A 3-2-1 countdown before recording starts; stopping the share from the browser's own bar also stops the recording.

### Editing

- Trim the start and end without re-encoding.
- Cut out sections from the middle. The kept parts are re-encoded in the browser (H.264 and AAC through WebCodecs) and joined; the preview skips cuts while playing.
- Cuts that overlap or touch join into one cut in the list, with a note saying so; the re-encode message counts the joined cuts.
- Title and thumbnail frame.
- Recordings are re-packaged before preview so they get a correct duration and scrub properly in every player.

### Sharing

- Upload in 20 MB parts to your own Cloudflare R2 bucket through one Worker, with per-part retries.
- Share page with a native player, range requests for seeking, Copy link and Download, Open Graph tags for chat previews.
- Owner library: list, copy, open, delete.
- A single owner password protects recording and the library. Links are unlisted, not private.

### Hardening after the release review

- Share pages refuse framing (`frame-ancestors 'none'`, with `base-uri` and `form-action` locked down), carry a `noindex` tag, and escape the page's own origin in their Open Graph tags. The recorder and library pages refuse framing through `public/_headers`.
- Thumbnails are cached privately for an hour and are only served once the video is ready, the same as the video itself.
- The npm scripts run the pinned wrangler through `scripts/wrangler.mjs`, which uses an ignored `wrangler.local.toml` when one exists. The committed `wrangler.toml` ships with a placeholder database id.
- The tripwire also catches `~/` paths and fails when its base ref is missing; `test/tripwire.test.mjs` covers it and CI runs it on Node 22 and 24.
- Licence texts for Mediabunny (MPL 2.0) and Fira Sans (OFL 1.1) ship beside the vendored files.

### Setup and project

- Self-hosts on one free Cloudflare account: Workers, R2 and D1. No storage keys needed.
- No framework, no bundler, no build step, no runtime CDN. Mediabunny (MPL 2.0) and Fira Sans (OFL) are vendored.
- Playwright end-to-end suite that runs against the local Cloudflare emulator with a fake camera and screen, so contributors need no account.
- Continuous checks on GitHub: syntax, the end-to-end suite (also with the tab hidden), dependency audit, a tripwire for personal paths and silenced checks, and secret scanning.
