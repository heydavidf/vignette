# Changelog

Notable changes to Vignette. Versions follow [Semantic Versioning](https://semver.org/); each release is a Git tag and a GitHub Release.

## 0.1.0 (unreleased, proposed)

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
