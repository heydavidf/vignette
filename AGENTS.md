# Vignette contributor guide

Vignette is an open-source screen recorder that runs entirely in the browser: a web page records the screen (with an optional webcam bubble and microphone), trims and cuts in the browser, uploads to the owner's own Cloudflare storage, and serves share links. One Cloudflare Worker serves the static files, the owner API, the share page and the media. There is no framework, no bundler and no build step. The README owns installation and the public capability claims; this file is the map for people and agents changing the code.

## Where things live

- `worker/index.js`: the server. Routes, the owner-password check, D1 rows, R2 uploads in parts, media streaming with Range support, the share page template and its Content Security Policy.
- `public/index.html`, `public/recorder.js`, `public/bubble.js`, `public/editor.js`, `public/cuts.js`, `public/upload.js`, `public/auth.js`, `public/ui.js`: the recorder page. Capture and compositing, the draggable bubble, re-packaging and trim, mid-section cuts with their re-encode, chunked upload with retries, the password gate.
- `public/library.html`, `public/library.js`: the owner's list of recordings.
- `public/tokens.css`, `public/app.css`, `public/library.css`, `public/share.css`, `public/icons.svg`: the visual system. `DESIGN.md` is its written authority; `.impeccable/design.json` is the machine-readable sidecar.
- `public/vendor/`: Mediabunny (MPL 2.0) and Fira Sans (OFL), vendored unmodified. Never edit these; replace the file and its version in the file name.
- `schema.sql`: the one database table. `wrangler.toml`: bindings and the upload size cap; it ships with a placeholder `database_id`. The npm scripts run wrangler through `scripts/wrangler.mjs`, which uses an ignored `wrangler.local.toml` instead when one exists, so a maintainer can keep a real id out of the tree.
- `test/e2e.mjs`: the Playwright end-to-end suite. It starts its own `wrangler dev` with a throwaway database and fake camera and screen, so it needs no Cloudflare account. `test/cuts-step.mjs` and `test/cuts-scenario.mjs` are the cuts steps it runs; the second was written independently of the feature's builder, as rule 5 below asks.
- `docs/MVP_SPEC.md` and `docs/CUTS_SPEC.md`: what each version is. `docs/BACKLOG.md`: what it is not, yet. `PRODUCT.md`: product truth for design work.
- `spike/`: the original feasibility proof. Kept for reference, not served, not tested by CI.

## Checks

Run from the repository root. You need Node 22 or newer and Git. Before the first `npm test`, run `npx playwright install chromium` once; without it the suite stops with "Executable doesn't exist".

```sh
npm ci --ignore-scripts
for f in worker/index.js public/*.js test/*.mjs; do node --check "$f"; done
npm test                      # must end with E2E OK
BACKGROUND=1 npm test         # the same suite with the tab hidden while recording
npm audit --audit-level=high
node --test test/tripwire.test.mjs   # the tripwire's own tests
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
- Every `/api` route stays behind the owner check. Ids are validated before they reach R2 keys or SQL. Titles are escaped everywhere they are rendered.
- Trim must stay the copy path (no re-encode); cuts re-encode. Measure before changing either.
- Chrome and Edge first. Safari and Firefox must load without errors even where recording is limited.
- No em-dashes or en-dashes in code comments, UI text or documentation.
- Record every user-visible change in `CHANGELOG.md`.
