# Vignette MVP v0.1 build spec

Historical record of the first build (2026-10-19). Mid-section cuts were added afterwards (`CUTS_SPEC.md`), and the styling section was superseded by `DESIGN.md`. Where this file and the code differ, the code and `README.md` are right.

Owner: David Finnegan. This file is the single source of truth for what v0.1 is. If something is not in here, it is not in v0.1 (put it in `docs/BACKLOG.md`).

## What Vignette is

An open-source screen recorder that runs entirely in the browser. Open a web page, record your screen (optionally with a webcam bubble and microphone), trim the start and end, give it a title, upload, get a share link. Self-hosted on one free Cloudflare account in about ten minutes. MIT licence.

Design values, in priority order:
1. **Small.** A curious developer reads the whole codebase in an afternoon. No framework, no bundler, no TypeScript, no build step. Plain ES modules served as static files.
2. **Nothing to install, nothing to sign up for** for the person recording, beyond the owner password of their own instance.
3. **Chrome and Edge first.** Safari and Firefox must not crash, but may be worse.

Clean-room rule: do not read or copy code from Cap (AGPL) or Screenity (GPL).

## Proven already (reuse from `spike/`)

`spike/spike.js` proves the recording path. Reuse its logic, not its UI:
- `getDisplayMedia` + optional `getUserMedia` for webcam and mic.
- **No webcam:** record the screen track directly, no canvas. **With webcam:** composite on a canvas capped at 1920x1080 (a full Retina capture overloads the page and gives black video; this was found on David's Mac).
- Mix mic + tab audio with `AudioContext` into one audio track.
- MIME preference: `video/mp4;codecs=avc1,mp4a.40.2` → `video/mp4;codecs=avc1` → `video/mp4` → WebM fallbacks. Never hard-code an H.264 level.
- MediaRecorder writes a wrong duration header. Always re-package with Mediabunny before preview or upload.
- Trim with Mediabunny `Conversion.init({ input, output, trim: { start, end } })`, `Mp4OutputFormat({ fastStart: 'in-memory' })`, `BufferTarget`.
- Vendored library: `spike/vendor/mediabunny-1.61.6.min.mjs` (MPL 2.0). Copy it to `public/vendor/`, unmodified.

## Architecture

One Cloudflare Worker serves everything: static files from `public/` (Workers Static Assets), an API, the share page, and media streaming from R2. Metadata in D1.

```
vignette/
  README.md            setup in ten minutes, usage, limits, licence notes
  LICENSE              MIT
  package.json         scripts: dev, deploy, db:init, test
  wrangler.toml        assets, R2 binding MEDIA, D1 binding DB
  schema.sql           D1 schema
  worker/index.js      router + handlers (one file, under ~400 lines)
  public/
    index.html         recorder + editor + upload (the main app)
    library.html       owner's list of recordings
    app.css
    recorder.js        capture, compose, MediaRecorder (from spike)
    editor.js          Mediabunny remux, trim, thumbnail
    upload.js          chunked upload client
    library.js
    auth.js            owner password handling
    vendor/mediabunny-1.61.6.min.mjs
  test/e2e.mjs         Playwright end-to-end test against `wrangler dev`
  docs/MVP_SPEC.md     this file
  docs/BACKLOG.md      everything deferred
  spike/               kept as the original proof; not served
```

### wrangler.toml

```toml
name = "vignette"
main = "worker/index.js"
compatibility_date = "2026-10-01"

[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "none"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "vignette-media"

[[d1_databases]]
binding = "DB"
database_name = "vignette"
database_id = "REPLACE_WITH_YOUR_D1_ID"

[vars]
MAX_UPLOAD_MB = "2000"
```

Secret (not in the file): `VIGNETTE_PASSWORD`, set with `npx wrangler secret put VIGNETTE_PASSWORD`. For local dev, `.dev.vars` with `VIGNETTE_PASSWORD=dev` (gitignored; commit `.dev.vars.example`).

### schema.sql

```sql
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration REAL NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading',
  upload_id TEXT,
  created_at INTEGER NOT NULL
);
```

R2 keys: `videos/<id>.mp4`, `thumbs/<id>.jpg`.

### Auth

Single owner. Every `/api/*` route except the viewer routes requires header `Authorization: Bearer <VIGNETTE_PASSWORD>`. Compare with a constant-time check. The recorder and library pages ask for the password once and keep it in `localStorage` (wrapped in try/catch). Share pages and media are public; ids are unguessable (16 chars from `crypto.getRandomValues`, alphabet `a-z0-9`).

### API

| Method, path | Auth | Does |
|---|---|---|
| `POST /api/videos` | owner | Body `{title, duration, size, mime, width, height}`. Creates the D1 row with status `uploading`. If `size` > 20 MiB, starts an R2 multipart upload and stores `upload_id`. Returns `{id, multipart: bool, partSize: 20971520}`. Rejects size over `MAX_UPLOAD_MB`. |
| `PUT /api/videos/:id/blob` | owner | Single-shot upload for files up to 20 MiB. Body is the MP4. `MEDIA.put`. |
| `PUT /api/videos/:id/parts/:n` | owner | Multipart part `n` (1-based). Body is the chunk. Uses `MEDIA.resumeMultipartUpload(key, upload_id).uploadPart(n, body)`. Returns `{partNumber, etag}`. |
| `POST /api/videos/:id/complete` | owner | Body `{parts: [{partNumber, etag}]}` for multipart, or `{}` for single-shot. Completes the multipart, sets status `ready`. |
| `PUT /api/videos/:id/thumb` | owner | JPEG body, stored at `thumbs/<id>.jpg`. |
| `GET /api/videos` | owner | List, newest first: id, title, duration, size, created_at, status. |
| `DELETE /api/videos/:id` | owner | Deletes R2 objects (video, thumb; abort multipart if still uploading) and the row. |
| `GET /v/:id` | public | Share page (HTML rendered by the Worker). 404 page if missing or not ready. |
| `GET /media/:id` | public | Streams the MP4 from R2 with **Range support** (206, `Content-Range`, `Accept-Ranges: bytes`, `Content-Type: video/mp4`, `Cache-Control: private, max-age=3600`). Without Range, 200 with full body. |
| `GET /thumb/:id` | public | JPEG from R2, or 404. |

Static files: everything else falls through to `ASSETS.fetch(request)`. `/` serves `index.html`, `/library` serves `library.html`.

All errors are JSON `{error: "message"}` with a sensible status. Unauthorised is 401.

### Share page (`GET /v/:id`)

Rendered by the Worker from a template string in `worker/index.js`. Contains:
- `<title>` = video title, Open Graph tags (`og:title`, `og:type=video.other`, `og:image` = thumb URL, `og:video` = media URL, `og:description` = duration and date).
- A `<video controls playsinline preload="metadata" poster="/thumb/:id" src="/media/:id">` that fills the width, max 1280px, centred.
- Title, duration (m:ss), date, a **Copy link** button, a **Download** link.
- A small footer "Recorded with Vignette" linking to the GitHub repo URL placeholder.
- Minimal CSS. No external requests. (Styling superseded on 2026-10-19; see Styling below.)

### Recorder app (`public/index.html`)

Steps on one page, revealed in order:

1. **Set up.** Buttons: Share screen. Checkboxes: Webcam bubble, Microphone. Shows what is shared.
2. **Record.** Start, Stop, timer. Live preview canvas (only when webcam is on; when off, show the screen video element directly at reduced size). A 3-2-1 countdown before recording starts.
3. **Edit.** Preview player of the re-packaged recording. Two trim sliders (start, end) with time labels and a "Set start here / Set end here" button pair that reads the current player time. A title field (default "Recording <date> <time>"). A thumbnail picker: button "Use current frame" grabs a 640px-wide JPEG from the player's current time via Mediabunny `CanvasSink`; default is the frame at 1 second into the trimmed range.
4. **Upload.** Button "Upload and get link". Progress bar (bytes). On success: share link shown in a read-only input with Copy, and "Open" link. Also a "Download MP4" link for the trimmed file, so the tool is useful even with no backend.

Password: on first load of `/` or `/library`, if no stored password, show a small form. Verify by calling `GET /api/videos`. Wrong password shows an inline message.

Keep the spike's **Findings** idea as a collapsible "Details" section at the bottom that prints: codec used, capture size, canvas on/off and fps, MB per minute, export time. This is what makes bug reports useful.

Error states that must be handled: user cancels the share picker; webcam or mic denied (continue without, say so); user stops sharing from Chrome's bar (auto-stop recording); export fails; upload fails mid-way (show retry which re-uploads failed parts only); password wrong.

### Upload client (`public/upload.js`)

`uploadVideo({blob, title, duration, width, height, password, onProgress})`:
1. `POST /api/videos`.
2. If not multipart: `PUT .../blob`. Else slice into `partSize` chunks, upload sequentially with `PUT .../parts/:n` (retry each part up to 3 times with backoff), collect etags.
3. `POST .../complete`.
4. `PUT .../thumb` with the JPEG.
Returns `{id, url}` where `url = location.origin + '/v/' + id`.

Progress is bytes uploaded over total. Use `fetch` with the Blob slice as body (no XHR).

### Library (`public/library.html`)

Table of recordings: thumbnail, title, duration, size, date, status, Copy link, Open, Delete (confirm with a plain inline "Delete? Yes / No", no `window.confirm`). Empty state text. Link back to the recorder.

### Styling

One `app.css`. System font stack, dark theme with `prefers-color-scheme` light variant, one accent colour, 16px gutters, works at phone width (the share page especially). No icon fonts, no external fonts, no CDN. Buttons large enough to hit. Nothing fancy; clarity over decoration.

Superseded on 2026-10-19: David chose a new visual direction (one vendored font, Fira Sans; a single colour scheme; sign bands for the three steps). The surface brief is `.impeccable/surfaces/public-index-html.md`. The rules that still hold: no icon fonts, no external fonts, no CDN, buttons large enough to hit, 16px gutters at phone width.

## Tests (`test/e2e.mjs`)

Playwright against `wrangler dev` (local R2 and D1 emulation; the test starts and stops `wrangler dev` itself, or documents that it must be running on port 8787). Chromium flags from the spike for fake media and tab capture. Steps:

1. Open `/`, enter password `dev`, confirm the recorder shows.
2. Share, record 4 s, stop. Assert the edit step appears and parsed duration is about 4 s.
3. Trim 1 s off each end, set title "E2E test", upload.
4. Assert a share URL appears. Fetch `/v/<id>`: 200, contains the title and the `og:image` tag.
5. Fetch `/media/<id>` with `Range: bytes=0-99`: 206, `Content-Range` present, body 100 bytes. Fetch without Range: 200, size matches the row.
6. Open `/v/<id>` in the browser and wait for the video element's `readyState >= 1` and `duration > 1`.
7. `/library` lists the recording; delete it; `/v/<id>` is now 404.
8. Multipart path: upload a synthetic 45 MB blob through `upload.js` directly in the page (`page.evaluate`), check it completes with 3 parts and streams back.
9. Wrong password gets 401 and the inline message.

Print `E2E OK` at the end, exit non-zero on failure. The spike's `smoke.mjs` stays as is.

## README outline

1. One paragraph: what it is, the three design values, screenshot placeholder.
2. **Set up in ten minutes:** `npm install`, `npx wrangler login`, create bucket, create D1 (paste id into wrangler.toml), `npm run db:init`, set password secret, `npm run deploy`. Each as a copy-paste block with one sentence of what it does.
3. **Record your first video.**
4. **Limits and honesty:** Chrome/Edge first; permission prompt each time; 1080p30 ceiling; no zoom effects or captions; single owner; unlisted links, not private.
5. **Costs:** free tier numbers.
6. **Development:** `npm run dev`, `npm test`, where things live (one line per file).
7. **Licence:** MIT; Mediabunny is MPL 2.0, vendored unmodified.

## Definition of done for v0.1

- `npm test` passes (E2E OK) on this Mac.
- `npm run dev` then a manual recording in David's Chrome works with and without webcam, upload completes, share link plays and seeks.
- README setup steps are literally followable by a non-technical person.
- No file over ~500 lines; no dependency beyond `wrangler` and `playwright` (dev).
- `docs/BACKLOG.md` lists what was deferred (at least: mid-section cuts, per-video password, multi-user, Safari/Firefox polish, worker-based compositor, Deploy-to-Cloudflare button, captions, zoom effects).
