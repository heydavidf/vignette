# Vignette contributor guide

Vignette is an open-source screen recorder that runs entirely in the browser: a web page records the screen and, with the webcam on, the camera as a second file (plus the microphone), trims and cuts in the browser, renders the webcam bubble in at export, uploads to the owner's own Cloudflare storage, and serves share links. One Cloudflare Worker serves the static files, the owner API, the share page and the media. There is no framework, no bundler and no build step. The README owns installation and the public capability claims; this file is the map for people and agents changing the code.

## Where things live

- `worker/index.js`: the server. Routes, the owner-password check, D1 rows, R2 uploads in parts (the rendered video and, with `?track=screen|camera`, the two originals), media streaming with Range support, the owner-only originals route. `worker/share-page.js`: the share page and not-found HTML and their Content Security Policy.
- `public/index.html` and its modules, the recorder page:
  - `recorder.js`: capture, the live preview canvas (preview only, not recorded), the record step.
  - `tracks.js`: the two recorders (screen with the sound, camera alone), the camera's start offset, camera loss, peak memory, and keeping the camera preview in step with the screen in the edit step.
  - `bubble.js`: the one stored bubble place, its views (recorder well, edit player) and the drawing shared by the live preview and the renderer.
  - `editor.js`: the edit and upload steps. `media.js`: Mediabunny helpers (re-package, probe, trim copy path, thumbnails). `cuts.js`: mid-section cuts and their re-encode. `render.js`: the two-input renderer (screen plus camera bubble, every export when a camera track exists).
  - `upload.js`: chunked upload with retries, for the video and the originals. `auth.js`: the password gate. `ui.js`: shared helpers.
- `public/library.html`, `public/library.js`: the owner's list of recordings.
- `public/tokens.css`, `public/app.css`, `public/library.css`, `public/share.css`, `public/icons.svg`: the visual system. `DESIGN.md` is its written authority; `.impeccable/design.json` is the machine-readable sidecar.
- `public/vendor/`: Mediabunny (MPL 2.0) and Fira Sans (OFL), vendored unmodified. Never edit these; replace the file and its version in the file name.
- `schema.sql`: the one database table, complete, for new installs. `migrations/`: updates for databases made by an older version, applied by `scripts/migrate.mjs` (`npm run db:migrate`, `db:migrate:local`), which runs only the `ADD COLUMN` statements whose column is missing; a change to the table goes in both places. `wrangler.toml`: bindings and the upload size cap; it ships with a placeholder `database_id`. The npm scripts run wrangler through `scripts/wrangler.mjs`, which uses an ignored `wrangler.local.toml` instead when one exists (unless a `--config` is given; `test/wrangler-args.test.mjs` tests that choice), so a maintainer can keep a real id out of the tree.
- `test/e2e.mjs`: the Playwright end-to-end suite. It starts its own `wrangler dev` servers with throwaway databases (one made by `schema.sql` plus the update, one in the 0.1 shape) and fake camera and screen, so it needs no Cloudflare account. `test/cuts-step.mjs` and `test/cuts-scenario.mjs` are the cuts steps it runs; the second was written independently of the feature's builder, as rule 5 below asks. `test/tracks-step.mjs` covers two tracks and the originals; `test/tracks-scenario.mjs` is the independent scenario test for two tracks (camera refused, camera lost, bubble past the edges, a 60 s recording, originals failing), written by a different agent as rule 5 asks; `test/migrate-step.mjs` the database update.
- `docs/MVP_SPEC.md`, `docs/CUTS_SPEC.md` and `docs/LOOP1_TWO_TRACKS_SPEC.md`: what each version or loop is. `docs/BACKLOG.md`: what it is not, yet. `PRODUCT.md`: product truth for design work.
- `spike/`: the original feasibility proof. Kept for reference, not served, not tested by CI.

## Checks

Run from the repository root. You need Node 22 or newer and Git. Before the first `npm test`, run `npx playwright install chromium` once; without it the suite stops with "Executable doesn't exist".

```sh
npm ci --ignore-scripts
for f in worker/*.js public/*.js scripts/*.mjs test/*.mjs; do node --check "$f"; done
npm test                      # must end with E2E OK
BACKGROUND=1 npm test         # the same suite with the tab hidden while recording
npm audit --audit-level=high
node --test test/tripwire.test.mjs test/wrangler-args.test.mjs   # the tripwire's and the wrangler wrapper's own tests
bash .github/tripwire.sh origin/main   # compare against the branch you will merge into
```

CI (`.github/workflows/checks.yml`) runs the same commands plus gitleaks on every push to `main`, on pull requests and weekly. CI does not run `actionlint` or `zizmor`; run them yourself when you change it.

## Working rules

1. A bug fix ships with a committed test in `test/e2e.mjs` that fails on the old code and passes on the new. A one-off check in a temporary folder does not count.
2. Run every check above before saying a change is done, and quote the output.
3. Do not silence a check to get green: no skipped steps, no disabled rules. The tripwire fails the build unless the line says `tripwire-allow` with a reason.
4. Stop any server you started. Leave no stray files (caches, scratch databases, screenshots) in the repository folder.
5. For non-trivial changes, a different agent writes an independent scenario test before the change is accepted.

## Change constraints

- No framework, no bundler, no TypeScript, no runtime CDN or external request. Fonts and libraries are vendored. Keep every file under about 500 lines; split rather than grow.
- The visual system is decided: follow `DESIGN.md` for colours, type, the band grammar and the pictogram-square controls. Do not add colours, sizes or a light theme without updating it.
- The share page keeps its nonce-based Content Security Policy; new styles go in `public/share.css`, not inline.
- Every `/api` route stays behind the owner check. Ids and tracks are validated before they reach R2 keys or SQL. Titles are escaped everywhere they are rendered. The originals (`raw/` in R2) are served only by the owner route, never by `/media`, `/thumb` or the share page.
- Without a camera track, trim must stay the copy path (no re-encode) and cuts re-encode. With one, every export renders (`render.js`). Measure before changing any of these.
- Chrome and Edge first. Safari and Firefox must load without errors even where recording is limited.
- No em-dashes or en-dashes in code comments, UI text or documentation.
- Record every user-visible change in `CHANGELOG.md`.
