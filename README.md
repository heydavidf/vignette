# Vignette

Vignette is an open-source screen recorder that runs entirely in the browser. Open a web page, record your screen (with an optional webcam bubble and microphone), trim the start and end, cut out the middle bits you do not want, put the webcam bubble where you want it, give it a title, and get a share link. It runs on your own free Cloudflare account, so your videos stay yours. Three design values guide it:

1. **Small.** No framework, no bundler, no build step. A curious developer can read all of it in an afternoon.
2. **Nothing to install, nothing to sign up for** for the person recording, beyond the password of your own Vignette.
3. **Chrome and Edge first.** Safari and Firefox should not crash, but may be worse.

## Install and run it on your computer first

You need [Node.js](https://nodejs.org/) 22 or newer and a copy of this folder. To get the folder, either run `git clone https://github.com/heydavidf/vignette.git`, or on the GitHub page click **Code**, then **Download ZIP**, and unzip it. Open a terminal in the folder and run each block in order.

Install the two tools Vignette uses (Wrangler for Cloudflare, Playwright for tests):

```
npm install
```

Create the local settings file (the local password is `dev`), the local database, and start the local server:

```
cp .dev.vars.example .dev.vars
npm run db:init:local
npm run dev
```

Open http://localhost:8787 in Chrome or Edge, enter the password `dev`, and record something (see "Record your first video" below). Everything works, including upload and the share link, but the link only opens on your own computer: the storage and database are local stand-ins that Wrangler runs for you. Press Ctrl+C in the terminal to stop the server.

When you are happy with it, put it online.

## Put it online on Cloudflare in ten minutes

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). Vignette is built for Cloudflare's Workers, R2 storage and D1 database, which is why one free account and no storage keys are enough. If you want to host it somewhere else instead, that is possible but not a configuration change: fork the repository and have your coding agent (or you) replace the Cloudflare pieces in `worker/index.js` (the R2 and D1 bindings) with your host's storage and database. `AGENTS.md` describes where everything lives.

Log in to Cloudflare. A browser window opens; click Allow:

```
npx wrangler login
```

Create the storage bucket that holds your videos. The first time, Cloudflare may ask you to turn on R2 in the dashboard (R2 Object Storage, then Get started); this can ask for a payment card even though the free tier costs nothing:

```
npx wrangler r2 bucket create vignette-media
```

Create the database that holds titles and dates:

```
npx wrangler d1 create vignette
```

It prints a `database_id` that looks like `0f2b1c9e-...`. Open `wrangler.toml` in a text editor, replace `REPLACE_WITH_YOUR_D1_ID` with that id, and save. Nothing else in the file needs to change.

Create the table inside the database. When it asks "Ok to proceed?", answer yes:

```
npm run db:init
```

Choose your owner password. You type it once per browser to record and to see your library; people watching your links never need it. Pick a long one (a few random words), because the server does not limit guesses:

```
npx wrangler secret put VIGNETTE_PASSWORD
```

Nothing appears on screen as you type the password; that is normal, so type it and press Enter. If it asks whether to create a new Worker called `vignette`, answer Yes. You can also set it later in the Cloudflare dashboard (Workers, vignette, Settings, Variables and Secrets, add a secret named `VIGNETTE_PASSWORD`), which keeps the password out of your terminal history.

Put Vignette online:

```
npm run deploy
```

The first time, it asks you to register a free `workers.dev` subdomain and choose a name for it; that name becomes part of your address. If it says the name is unavailable, open the Cloudflare dashboard, go to Workers & Pages, set **Your subdomain** on the right, and run `npm run deploy` again. It then prints your address, something like `https://vignette.your-name.workers.dev`. That is your Vignette. Bookmark it.

Optional: open `worker/share-page.js` and change `REPO_URL` near the top to your own fork, so the "Recorded with Vignette" link on share pages points there. Run `npm run deploy` again after any change.

## Update an existing Vignette

If your Vignette was set up before version 0.2, its database needs one update, once. Get the new code (`git pull`, or download the ZIP again and keep your `wrangler.toml` with your `database_id`), then run:

```
npm install
npm run db:migrate
npm run deploy
```

`npm run db:migrate` adds the new columns to your Cloudflare database and says what it added; run again, it says "already applied" and changes nothing. Until it has run, your share links keep working, but the recorder and the library show "Run: npm run db:migrate". The same for your local database is `npm run db:migrate:local`. A new install does not need it: `npm run db:init` already makes the full table.

## Ask your agent

If you use a coding agent (Claude Code, Codex, Grok or similar), you can paste this to have it walk you through the setup:

> Read README.md and AGENTS.md in this repository. Help me set up my own Vignette: first "Install and run it on your computer first", then "Put it online on Cloudflare in ten minutes", step by step. Run `npm install` and explain each step, but stop before `npx wrangler login`, `npx wrangler secret put` and `npm run deploy` and let me run those myself, since they use my Cloudflare account. Do not change any file except the `database_id` line in wrangler.toml. When it is deployed, tell me how to record my first video.

To change the code rather than install it, `AGENTS.md` has the file map, the checks to run and the working rules.

## Record your first video

1. Open your Vignette address in Chrome or Edge and enter your password.
2. Leave **Webcam bubble** and **Microphone** ticked (or untick them), then click **Share screen** and pick a tab, window or your whole screen. Chrome asks for permission each time.
3. Click **Start recording**. After a 3-2-1 countdown, it records. Click **Stop** when you are done. Clicking "Stop sharing" in Chrome's bar also stops the recording.
4. Trim the start and end with the sliders, or play to a moment and click **Set start here** / **Set end here**. To take out a stretch from the middle, play or pause where it starts and click **Cut from here**, then move to where it ends and click **Cut to here**. Cuts show struck through on the bar, the preview skips them, and **Remove** puts one back. If the webcam was on, its bubble plays over the preview: drag it (or select it and use the arrow keys) and pick its size under the player. **Full screen** there shows the picture with the bubble, as the video will. Where you leave the bubble is where it is in the video; dragging it while recording only sets where it starts. Once uploaded, the clip and the bubble are fixed: the link keeps them. Change the title if you like, and click **Use current frame** to pick the thumbnail.
5. Click **Upload and get link**. When it finishes, click **Copy** and paste the link anywhere. **Download MP4** saves the edited file to your computer at any time, upload or not. With the webcam on, the originals (the screen and the camera as recorded, before the bubble was drawn in) are uploaded after the link is ready and kept with the video, so a later version can lay them out again; the library marks those recordings "Originals kept". Keep the tab open until it says so.

Your recordings are listed at `/library`, where you can copy links, open or delete them.

### While you record

Clicking **Start recording** opens a small floating window that stays on top of your other apps, so you can work anywhere and still see what is being recorded. It shows the countdown, then the picture (with your webcam bubble, or the camera alone: two squares switch between them), a red dot, the time, and a Stop square that stops the recording like Stop on the page. The window closes when the recording stops. Closing it yourself does not stop the recording; **Show window** on the page opens it again. If you share your whole screen, the window is part of the picture, so it opens on the camera alone and says so: move it to another screen, or share a window instead. To read from notes, turn on **Script** in step 1 and type or paste them: the window shows them in a panel under the picture that scrolls slowly, with squares to slow down, pause and speed up, and the wheel or a drag to scroll by hand. The script stays in that browser tab and is never uploaded. Browsers without this kind of window (Safari today, not yet tested) get a picture-in-picture video instead, with the time on a strip under the picture and no Stop or script; Details says which one was used.

## Limits and honesty

- **Chrome and Edge first.** Safari and Firefox may work partly; they are not tested yet.
- **The floating window is Chrome and Edge only** (Document Picture-in-Picture). Browsers with only classic picture-in-picture (Safari should be one; not tested yet) get a picture-in-picture video instead, with no Stop or script in it. Firefox has neither, so nothing floats there.
- **Permission prompt every time.** Browsers ask before each screen share. That is a browser rule, not a Vignette choice.
- **1080p at 30 frames per second is the ceiling.** Bigger screens are scaled down to fit.
- **Cuts re-encode the video.** Trimming the ends copies the recording as it is (Mediabunny re-encodes only when a trim point does not fall on a keyframe). Cutting out the middle makes the browser encode the video again (H.264 at 5 Mbps), which takes a moment and needs memory for both copies. Each join can carry up to about 20 ms of extra sound. No zoom effects or captions yet (see `docs/BACKLOG.md`).
- **With the webcam on, every export renders.** The screen and the camera are recorded as two files and the bubble is drawn in when you download or upload: the browser decodes both and encodes the video again (H.264 at 5 Mbps). On an Apple M1 Max this ran at 7.2 seconds of video per second (Chrome's test build, a 60 second recording of a simple test picture) for a 1080p screen with a 720p camera, so a one minute recording takes about 8 seconds to export. Without the webcam a trim still copies.
- **With the webcam on, the originals are kept too.** Each recording then stores the rendered video plus the screen and camera as recorded, roughly twice the space. The originals are the whole recording: whatever you trimmed or cut out of the video is still in them. Only you (with the owner password) can fetch them, and deleting the video deletes them.
- **One owner.** A single password protects recording and the library. There are no accounts.
- **Links are unlisted, not private.** Anyone who has a link can watch and download that video. Links are random and cannot be guessed, but they can be forwarded.
- **The recording lives in browser memory until uploaded.** Do not close the tab before you upload or download. With the webcam on, the browser holds both originals and the rendered video. Measured from outside the browser (the process list sampled every two seconds, on an Apple M1 Max with Chrome's test build) during the test suite's 60 second recording (1080p screen, 720p camera), Chrome's renderer process for the page used about 757 MB while recording, flat from 16 seconds on, and about 1.04 GB while preparing and rendering (one run; the renderer process only, not Chrome's GPU and browser processes, which took the total to about 1.2 GB while recording and 1.4 GB while rendering). The "peak memory" line in Details is only the JavaScript heap (48 MB for the same recording), not that whole footprint: the video data sits outside it. Very long recordings (well over an hour) may not fit.
- **Updating from 0.1 needs one database command,** `npm run db:migrate` (see "Update an existing Vignette").

## Costs

Everything fits in Cloudflare's free tiers for personal use (numbers as of writing; check Cloudflare's pricing pages for current ones):

- **Workers** (the app): 100,000 requests a day.
- **R2** (the videos): 10 GB stored, 1 million uploads and 10 million reads a month, and no charge for people watching (no egress fees).
- **D1** (the list of videos): 5 GB, 5 million rows read and 100,000 rows written a day.

Videos are capped at 5 Mbit/s, which is at most about 38 MB per minute; screen recordings are usually much smaller. With the webcam on, the kept originals add the screen (up to 5 Mbit/s) and the camera (up to 2.5 Mbit/s), so a minute takes at most about 94 MB. So 10 GB holds at least an hour and a half of webcam recordings, or four hours without the webcam. Beyond the free tier, R2 storage costs about $0.015 per GB per month.

## Development

The local server from "Install and run it on your computer first" (`npm run dev`) is the development server too; it reloads when files change.

Run the end-to-end test (it starts its own `wrangler dev` with a throwaway database, so `npm run dev` can stay running):

```
npx playwright install chromium   # once
npm test
```

It prints `E2E OK` when everything passes. `HEADED=1 npm test` shows the browser; `DEBUG=1 npm test` prints the server log on failure. `BACKGROUND=1 npm test` keeps Chrome's background throttling switched on. Playwright's Chromium never actually hides a tab, so every run also imitates that throttling on the page's own timers while the recorder sits behind another tab, and checks that the webcam bubble still draws above 20 frames per second.

Where things live:

- `wrangler.toml`: Cloudflare config (static files, R2 bucket `MEDIA`, D1 database `DB`, upload size limit, and a rule that lets the Worker import `icons.svg` as text).
- `schema.sql`: the one database table, for new installs. `migrations/` and `scripts/migrate.mjs`: the update for databases made by an older version (`npm run db:migrate`).
- `worker/index.js`: the server. Owner API (including the originals), media streaming with Range support. `worker/share-page.js`: the share page (styled by `public/share.css`).
- `public/index.html`: the recorder page (record, edit, upload).
- `public/recorder.js`: screen, webcam and mic capture, the live preview, the steps' state.
- `public/tracks.js`: the two recorders (screen with the sound, camera alone) and keeping the camera in step with the screen in the edit preview.
- `public/bubble.js`: the webcam bubble you drag over the live preview and over the edit step's player; one stored place for both.
- `public/selfview.js`, `public/selfview.css`: the floating window shown while recording (picture, time, Stop, view toggle) and its picture-in-picture stand-in. `public/prompter.js`: the script toggle and the window's scrolling script panel.
- `public/editor.js`: the edit and upload steps. `public/media.js`: re-packaging, trimming, probing and thumbnails with Mediabunny.
- `public/render.js`: the export with the webcam on: the screen and the camera decoded side by side and the bubble drawn into every frame.
- `public/cuts.js`: mid-section cuts: the cut controls, cut skipping in the preview, and the re-encode that removes them.
- `public/upload.js`: the chunked upload client with retries, for the video and the originals.
- `public/auth.js`: the owner password form and API calls.
- `public/ui.js`: small shared helpers for messages, pictograms and loading states.
- `public/library.html`, `public/library.js`: the list of recordings.
- `public/tokens.css`: the font, colours, type sizes and shared controls used by every page. `public/app.css`, `public/library.css` and `public/share.css` style each page.
- `public/icons.svg`: the pictograms, one SVG sprite.
- `public/vendor/fonts/`: Fira Sans (SIL Open Font License, licence file beside the fonts), served from this site.
- `public/vendor/mediabunny-1.61.6.min.mjs`: the media library, vendored unmodified.
- `test/e2e.mjs`: the Playwright end-to-end test. `test/cuts-step.mjs`, `test/cuts-scenario.mjs`, `test/tracks-step.mjs`, `test/tracks-scenario.mjs` and `test/migrate-step.mjs` are steps it runs.
- `docs/MVP_SPEC.md`: what v0.1 is. `docs/CUTS_SPEC.md` and `docs/LOOP1_TWO_TRACKS_SPEC.md`: what was added since. `docs/BACKLOG.md`: what it is not, yet.
- `spike/`: the original proof of concept, kept for reference and not served.

## Licence

Vignette is MIT licensed (see `LICENSE`).

It includes [Mediabunny](https://mediabunny.dev/) 1.61.6 in `public/vendor/`, which is licensed under the Mozilla Public License 2.0 (`public/vendor/LICENSE-Mediabunny.txt`). It is vendored unmodified; its source is at [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny). The interface font is [Fira Sans](https://github.com/mozilla/Fira) under the SIL Open Font License 1.1 (`public/vendor/fonts/LICENSE-FiraSans.txt`).
