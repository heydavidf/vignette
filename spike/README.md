# Vignette spike

A throwaway proof that a plain browser page can do the hard parts of a screen-and-webcam recorder with no install, no account and no server:

1. Record your screen, window or tab, with an optional webcam bubble and microphone.
2. Trim the start and end.
3. Save a seekable MP4.

It is deliberately small (one HTML file, one CSS file, one JS file, one vendored library). It is not the product.

## Run it

```
cd spike
python3 -m http.server 5173
```

Open http://localhost:5173 in Chrome or Edge. Click **Share screen**, pick what to record, click **Start recording**, talk for a bit, click **Stop**. Drag the trim handles, click **Export MP4**, then **Download**. The Findings box at the bottom prints what the browser actually did (which codec, file size per minute, export speed).

Localhost counts as a secure context, so screen sharing works without HTTPS.

## Automated check

```
npm install
npm run smoke
```

Launches headless Chromium with fake camera and microphone, records the page's own tab for 4 seconds, trims one second off each end, exports, and parses the MP4 back to check it has a duration and both tracks. Set `RECORD_SECONDS=30` for a longer take, `HEADED=1` to watch it, or `BACKGROUND=1` to hide the tab while recording. It also decodes a frame from the export and fails if the picture is black.

## What it proves

- Chrome's `MediaRecorder` produces H.264 + AAC MP4 directly (no WebM conversion needed on Chrome 153).
- `MediaRecorder` writes a wrong duration header (0.16 s for a 4 s clip). Parsing the file with Mediabunny recovers the real duration, and the exported MP4 has correct fast-start metadata, so it seeks properly in any player.
- Trimming and remuxing run far faster than realtime in the browser.
- Webcam bubble compositing on a canvas works at 30 fps, as long as the canvas is capped at 1080p. Drawing a full Retina screen onto a same-sized canvas overloads the page and gives black video (found on David's Mac, fixed the same day). With the bubble off, the screen stream is recorded directly with no canvas.

## What it skips on purpose

Upload and sharing, cutting middle sections, titles and thumbnails, Safari and Firefox, any styling beyond the minimum.

## Third-party code

`vendor/mediabunny-1.61.6.min.mjs` is [Mediabunny](https://mediabunny.dev/) (MPL 2.0), pinned and unmodified. Everything else in this folder is MIT (see the repo root).
