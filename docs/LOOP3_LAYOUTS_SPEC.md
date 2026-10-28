# Loop 3: layouts (build spec)

Branch `v0.2-tracks-layouts`, on top of loops 1 and 2. A recording with a camera can be composed in more ways than the bubble, chosen in the edit step and rendered at export; and because the originals are kept (loop 1), an uploaded recording can be rendered again in another layout from the library without recording it again. Plan decisions: one layout per recording (per stretch later); raw files kept by default.

## What changes for the user

- The edit step gains a **Layout** strip of pictogram squares above the bubble tools: **Bubble** (today's), **Split** (screen left, camera column right), **Camera only**, **Screen only**, **Padded** (the screen smaller, centred on a plain colour). One choice per recording; the preview shows it at once; the export and the thumbnail follow it. With the webcam off only Screen only and Padded are offered (the others are disabled plates), and Screen only is the default; with the webcam on, Bubble is the default.
- Bubble gains a shape: **round** (today) or **square** (same size, corners at 8% of the diameter, the same near-black ring). The bubble size strip, the drag and the arrow keys stay as they are and show only for Bubble.
- Padded gains a colour: four swatches from the palette (cream, black, grey, vermilion), cream by default.
- The library gets a **Change layout** square on recordings that kept their originals. It opens the recorder with the originals loaded straight into the edit step (steps 1 and 2 read as done, "Rendering again: <title>"); the user picks a layout, trims if they like, and uploads. The link stays the same and keeps working while the new render uploads; when it completes, the share page shows the new version. Recordings without originals (camera off in 0.1, or originals not kept) have no such square.
- Nothing changes while recording: the live preview and the floating window keep showing the bubble.

## Layouts (new `public/layouts.js`; `public/render.js`, `public/bubble.js`)

`layouts.js` owns the list and the geometry, used by the renderer, the preview and the thumbnail so they agree to the pixel. Each layout is `{id, label, glyph, needsCamera, frame(screenW, screenH, cameraW, cameraH) -> {W, H, screen: {x, y, w, h} | null, camera: {x, y, w, h, fit} | null, background}}`:

- **bubble**: frame = screen size (capped at 1080p as now); screen fills it ('contain' on black); the camera is painted by `bubble.js` at the stored place, size and shape (round or square).
- **split**: frame = screen size; screen 'contain' in the left 70% of the width, full height, on black; camera 'cover' in the right 30%, centred, full height; a 2px black rule between is fine (the background is black anyway).
- **camera**: frame = the camera's own size (even on both sides); camera fills it; no screen.
- **screen**: frame = screen size; screen fills it; no camera. With a trim only, the copy path (no re-encode) is used as it is with the camera off today; with cuts, the cuts re-encode.
- **padded**: frame = screen size; screen 'contain' at 86% of the width and height, centred, on the chosen colour; no camera (the bubble is not drawn; a camera is simply unused).

`render.js`: `renderComposite` becomes `renderLayout({layout, bubble, colour, ...})`: one draw function per layout from (screen frame, camera frame) to the canvas, sharing the existing decode, follow, encode and audio code. The camera sink is opened only when the layout needs it. `grabComposite` becomes `grabLayout` with the same inputs, so the thumbnail matches. Performance target unchanged (at least four seconds of video per second at 1080p30 on this Mac); report the figure per layout in the Details panel.

`bubble.js`: `paint()` takes a shape; the stored position gains `shape: 'round' | 'square'` (default round; older stored values without it mean round). The live preview, the self-view window and the renderer all use it.

## Edit step (`public/editor.js`, `public/index.html`, `public/app.css`)

- Layout strip: five pictogram squares in one strip, like the bubble size strip (new glyphs: `i-lay-bubble` (frame with a small circle lower left), `i-lay-split` (frame with a vertical rule at 70%), `i-lay-camera` (the camera glyph in a frame), `i-lay-screen` (a plain frame), `i-lay-padded` (a frame inside a frame)). Label "Layout". The bubble tools (shape, size, Full screen, the note) show only for Bubble; a colour row of four swatches shows only for Padded (swatches are 3rem squares painted in the colour with a 2px black rule; the chosen one gets the selection ring). Shape: two squares (round, square) next to the size strip.
- Preview: `#clip` is laid out by CSS from the layout's geometry (custom properties set from `layouts.js`: the frame's aspect, each picture's box and fit), so the two existing video elements (screen in `#preview`, camera in `#camPreview`) show the layout live without a canvas. Full screen shows the same. The player's controls stay on the strip below. Trim and cuts are unchanged.
- The default thumbnail follows the layout; changing the layout, the shape or the colour refreshes it as moving the bubble does today.
- Export, Download and Upload use the layout. The Details panel notes the layout and the render speed.
- Layout, shape and colour are kept with the recording (D1 `layout`, and `bubble` JSON gains `shape`; the colour is stored in `layout` as `padded:cream` or similar, builder's call, documented in the spec's data section below and in `schema.sql` comments).

## Rendering again from the library (`public/library.js`, `public/recorder.js`, `public/editor.js`, `worker/index.js`)

- Library: a **Change layout** square (glyph `i-lay-split`) on rows with `has_raw`; it links to `/?again=<id>`.
- Recorder page with `?again=<id>`: after the password, fetch `GET /api/videos/:id` (new owner-only route returning the row: id, title, duration, size, status, camera_offset, has_raw, layout, bubble) and the originals from `GET /api/videos/:id/raw/screen` and `/raw/camera` (existing owner-only routes); show a progress line on the step 1 band while they download ("Loading the originals: 48 of 120 MB"); then open the edit step with them exactly as after a recording (bands 1 and 2 done, the title filled in, the stored layout, bubble and colour preselected). Share again is still possible and leaves the again mode. If the originals are missing (404) say so on the band and offer "Record another".
- Upload in again mode replaces the recording instead of creating one: `POST /api/videos/:id/again` (owner only) marks the row `status = 'uploading'`, records the new layout, bubble, duration and size, and opens the video's multipart upload if needed, returning the same shape as `POST /api/videos`; the existing blob, parts, complete and thumb routes then replace `videos/<id>.mp4` and the thumbnail under the same id; `complete` sets `ready` again. Until `complete`, the old object stays in R2 and the share page keeps playing the old version; the library row says "Rendering again" meanwhile. The originals are not re-uploaded (they have not changed). A second `again` on a row already `uploading` is refused with 409 and a plain message.
- `DELETE` is unchanged (it already aborts open multiparts and removes all four objects).
- Security: the new routes are owner-only and validate id, layout (one of the five ids, with the padded colour from the four names), bubble (x, y, size, shape) and sizes as `createVideo` does. The Worker diff gets a fresh security review.

## Data

- D1: `layout TEXT NOT NULL DEFAULT 'bubble'` (exists) now holds `bubble`, `split`, `camera`, `screen`, or `padded:<cream|black|grey|vermilion>`; `bubble TEXT` JSON gains `shape`. No migration needed (the columns exist since loop 1); `schema.sql` comments say so.
- `GET /api/videos` includes `layout`.

## Tests

`test/e2e.mjs` is at 492 lines: before anything else, move the server and browser setup (`startServer`, `stopServers`, `runWrangler`, `freePort`, `pageHooks`, `login`, `record`, `listVideos`, `api`, `create`, `assert`, `step`, `ok`) into `test/harness.mjs` and import it; behaviour unchanged. Then `test/layouts-step.mjs` (builder), wired after 3k:
- Each layout renders with pictures in the expected regions: sample the export at two times (CanvasSink, 640 wide, as `tracks-step.mjs` does) and assert: split has the screen's content left of 70% and the camera's right of it (on Linux CI the fake camera and screen are the same green, so detect the boundary by the black column or by the camera picture's different aspect, not by colour); camera only has the camera's frame size; screen only has no ring anywhere; padded has the colour at the edges (measure the four corners) and the screen inside; bubble square has the ring's corners (the ring differs from round at the corners).
- Screen only with a trim only takes the copy path (export time note says "trim only"); with a cut it re-encodes.
- Webcam off: split and camera plates disabled, Screen only preselected.
- The thumbnail matches the layout (padded: the corners of the thumbnail are the colour).
- Layout, shape and colour are stored (`GET /api/videos` and the row) and come back preselected in again mode.
- Change layout: upload a bubble recording with originals, open `/?again=<id>`, pick Split, upload; the id and share URL are unchanged, the share page plays the new file (its first frame has the split boundary), the thumbnail changed, `has_raw` is still 1, the originals are byte-identical to before, and the old version kept playing while the new one was uploading (fetch `/media/:id` during the upload; it returns the old size). A second `again` while uploading is 409. A row without originals has no Change layout square and `/?again=<id>` says so.
- Existing steps stay green, including `BACKGROUND=1`.

Independent scenario test (a different agent, repo rule 5, `test/layouts-scenario.mjs`): a padded render of a 2560x1440 share (frame capped at 1080p, colour at the edges); split with a portrait camera (cover crop centred); camera only with a camera that stopped mid-recording (held frame); again mode when the raw screen download fails half way (clear message, no row change); again mode with the password wrong (401 handled); delete during an again upload (aborts cleanly, four objects gone); re-render twice in a row (second one replaces the first); a 60 s split render's peak memory and speed.

## Docs

README: the edit step section describes the layouts, the shape, the colour and "Change layout" from the library; the limits section says one layout per recording and that Change layout needs the originals. AGENTS.md file map (`layouts.js`, `harness.mjs`, the two tests). CHANGELOG under "Unreleased". DESIGN.md: the layout strip, the shape squares, the colour swatches, the new glyphs, the library square.

## Decided during the build (deviations from the text above)

Recorded here so the spec and the code agree; the CHANGELOG carries the user-facing versions.

- Files: the edit step's strip, swatches and preview are `public/layout-tools.js` and the again mode's download is `public/again.js`, so `editor.js` and `recorder.js` stay under 500 lines; the Worker's media streaming moved to `worker/media.js` and `HttpError`/`json` to `worker/http.js` for the same reason.
- Preview: the screen video's picture is moved into its box with CSS `object-view-box` (negative insets), which Chrome and Edge have; other browsers show the screen full size in the preview (the export is right everywhere). The player's background under the picture is the layout's (black or the padded colour); the camera's box in Split and Camera only is the bubble element itself, restyled (no ring, cover, not draggable).
- Full screen moved from the bubble tools to the end of the Layout row, since every composed layout needs it; in Screen only it is hidden and the player's own full screen and picture in picture are back (with or without a camera). The note sits under all the tools: the drag help in Bubble, and in every layout the hold-still and link-keeps notes ("bubble" wording in Bubble, "layout" otherwise).
- Split leaves a 2px black rule between the screen's 70% and the camera's column. Camera only is capped at 1080p like the others.
- The square bubble keeps the round one's size and its 3% ring; its corners are rounded at 8% of its width outside the ring and 5% inside it (5.32% of the inner side), so the ring keeps its width all the way round. The live preview, the floating window, the edit step and the render all draw it so.
- Again mode hides step 1's webcam, microphone and script toggles (they are for a new recording); Share again leaves the mode and brings them back.
- In composed layouts the player's controls lose Chrome's dark scrim (`::-webkit-media-controls-panel`), since they sit on their own strip under the picture; checked in Playwright's Chromium and in Google Chrome 156.
- While the video renders or uploads, and once the link is made, the chosen colour swatch keeps its full paint (without the selection ring) while the label and the other swatches fade, as the bubble does, so the inert row still shows the video's colour.
- Data: `layout` holds the five ids with the padded colour as `padded:<colour>`; `bubble` always carries `shape`, and is stored whenever there is a camera, whatever the layout, so it comes back in again mode. `GET /api/videos/:id` also returns `created_at`, `width`, `height` and `again` (1 while a new version uploads); `GET /api/videos` includes `layout` and `again`.
- Again upload: the row is marked `uploading` as specified, but the new version's fields (title, duration, size, width, height, layout, bubble) wait as JSON in `upload_id` and are written onto the row by `complete`, so the share page describes the version it plays until then. The share page, `/media` and `/thumb` serve a row that is `ready`, or `uploading` with such a pending version. The upload is always multipart, even for a small file, because R2 then replaces the object only when it completes (a single-shot PUT would replace it at once). The title from the edit step is part of the new version.
- A second `again` while one uploads is 409 with a plain message, except a retry by the same client (a nonce it sends) after a lost response, which carries on, and an upload left for over an hour, which may be replaced.
- Caching: `/media` and `/thumb` stay `private, max-age=3600`; the share page and the library add the file's size as `?v=` to their addresses, so a recording rendered again never mixes cached ranges of the old file with the new one.
- Again mode loads the originals with `probe` only (they were re-packaged before they were kept). Step 1's note shows the progress and then "Rendering again: <title>"; step 2's note says "The originals, as recorded."; the upload button reads "Upload and replace" and the message after it "Uploaded. The same link now plays this version." A `?again=` value that is not an id says so; a recording without originals, a missing one, a download that fails and one already being rendered again each get their own message with a Record another link.
- Library: the fourth square needs a wider action column (14.5rem), so the register's narrow step applies at 1280px and below and the stacked rows at 1000px and below; where the status column is hidden, a row that is not ready says so under its title, and the date is set at Small size.
- Width and height sent with an upload are stored only when they are whole numbers from 1 to 16384 (new uploads and versions rendered again alike).
- Render speed, measured on an Apple M1 Max with a 20 s 1080p recording and a 720p camera: in Chromium drawing on the GPU (as Chrome does), Bubble 9.4 to 9.9, Split 9.3 to 10.1, Camera only 13.4, Padded 6.3 to 9.9 seconds of video per second. In the test suite's headless shell, which draws in software (SwiftShader), the scaled draws cost more: Bubble 4.3 to 6.2, Split 3.4 to 3.5, Camera only 10.8, Padded 3.7 to 4.2.

## Done when

- `npm test` and `BACKGROUND=1 npm test` print E2E OK with the new steps; the independent scenario test passes; the security review of the Worker diff has no finding at threshold; the finish review of the edit step and the library row says ship.
- David re-renders an old recording as Split without recording it again, and records a new one as Padded with the square bubble off and a colour of his choice.
