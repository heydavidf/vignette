// The public share page and the "Video not found" page: HTML only. The Worker
// (index.js) looks the row up and hands it here with a fresh nonce.
//
// A recording with a phone version (a vertical file, row.mobile ready) has
// two files. The page plays the phone version to a portrait phone (viewport
// at most 900px wide and taller than wide, decided by a script right after
// the player, before the first paint) and the landscape file otherwise,
// with a Phone / Full switch under the player that keeps the playing time;
// the choice is remembered for the page (sessionStorage). Download offers
// both. Open Graph keeps the landscape file and thumbnail.

// The pictogram sprite, inlined into share pages so they need no extra
// request (wrangler.toml imports .svg files as text).
import ICONS from '../public/icons.svg';

// Shown in the share page footer. Change it to your fork's URL.
const REPO_URL = 'https://github.com/heydavidf/vignette';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// The parts every Vignette page shares: fonts, styles, the header strip.
const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B0B0B">
<meta name="robots" content="noindex">
<link rel="preload" href="/vendor/fonts/fira-sans-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/share.css">`;
const TOP = `<header class="top"><div class="wrap top-row"><span class="brand">Vignette</span></div></header>`;
const FOOT = `<footer class="foot"><div class="wrap">Recorded with <a href="${REPO_URL}">Vignette</a></div></footer>`;
const glyph = (name) => `<svg class="glyph" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// The phone version's record when its file is complete, else null; only its numbers reach the page.
function readyMobile(row) {
  let m = null;
  try { m = JSON.parse(row.mobile || 'null'); } catch { return null; }
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  return m?.ready && n(m.width) && n(m.height) && n(m.size) ? { size: m.size, width: m.width, height: m.height } : null;
}

// Picks the version before the first paint (sessionStorage first, then the
// viewport) and defines setView(), which the switch calls: it swaps the
// source, poster, size and shape and carries the time (and playing) over.
const CHOOSE = `const player = document.getElementById('player'), views = player.dataset;
const viewKey = 'vignette.view.' + views.id;
function setView(next) {
  const f = (k) => views[next + k];
  const time = player.currentTime, playing = !player.paused && !player.ended, had = player.hasAttribute('src');
  player.poster = f('Poster'); player.width = +f('W'); player.height = +f('H');
  player.style.setProperty('--ar', f('W') / f('H'));
  player.src = f('Src');
  player.dataset.view = next;
  if (had && time > 0) player.addEventListener('loadedmetadata', () => { player.currentTime = time; if (playing) player.play().catch(() => {}); }, { once: true });
  for (const b of document.querySelectorAll('[data-view-to]')) b.setAttribute('aria-pressed', String(b.dataset.viewTo === next));
  const size = document.getElementById('size');
  if (size) size.textContent = f('Size');
}
let chosen = null;
try { chosen = sessionStorage.getItem(viewKey); } catch { /* storage blocked: decide by the screen */ }
setView(chosen === 'phone' || chosen === 'full' ? chosen : (matchMedia('(max-width: 900px) and (orientation: portrait)').matches ? 'phone' : 'full'));`;

// The switch, once the rest of the page is there: shown, and remembering the choice.
const SWITCH = `const switcher = document.getElementById('views');
switcher.hidden = false;
document.getElementById('size').textContent = views[player.dataset.view + 'Size'];
for (const b of switcher.querySelectorAll('[data-view-to]')) {
  b.setAttribute('aria-pressed', String(b.dataset.viewTo === player.dataset.view));
  b.addEventListener('click', () => {
    setView(b.dataset.viewTo);
    try { sessionStorage.setItem(viewKey, b.dataset.viewTo); } catch { /* storage blocked: for this view only */ }
  });
}`;

// The share page for a ready row. `origin` is the page's own origin; `nonce` allows its one script.
export function sharePageResponse(row, origin, nonce) {
  const id = row.id;
  const site = escapeHtml(origin);
  const title = escapeHtml(row.title);
  const date = new Date(row.created_at);
  const isoDate = date.toISOString().slice(0, 10);
  const duration = fmtDuration(row.duration);
  const description = escapeHtml(`${duration} video, recorded ${isoDate}`);
  const fileName = escapeHtml(fileNameOf(row.title));
  const size = row.width && row.height
    ? `<meta property="og:video:width" content="${row.width}">\n<meta property="og:video:height" content="${row.height}">`
    : '';
  // Width and height give the player its shape before the video loads.
  const dims = row.width && row.height ? ` width="${row.width}" height="${row.height}"` : '';
  // The version, from the file's size: a recording rendered again (same link,
  // new file) gets new media and thumbnail addresses, so no browser mixes a
  // cached part of the old file with the new one. The routes ignore it.
  const v = `v=${Number(row.size).toString(36)}`;
  const mobile = readyMobile(row);
  const pv = mobile && `v=${Number(mobile.size).toString(36)}`;
  const plain = `<video controls playsinline preload="metadata"${dims} poster="/thumb/${id}?${v}" src="/media/${id}?${v}"></video>`;
  // With a phone version the player starts without a source; the script after it picks one. Without
  // JavaScript the landscape player in <noscript> shows instead (an empty player is hidden by share.css).
  const player = !mobile ? plain : `<video id="player" controls playsinline preload="metadata" data-id="${id}"
 data-phone-src="/media/${id}/mobile?${pv}" data-phone-poster="/thumb/${id}/mobile?${pv}" data-phone-w="${mobile.width}" data-phone-h="${mobile.height}" data-phone-size="${fmtSize(mobile.size)}"
 data-full-src="/media/${id}?${v}" data-full-poster="/thumb/${id}?${v}" data-full-w="${row.width || 16}" data-full-h="${row.height || 9}" data-full-size="${fmtSize(row.size)}"></video>
<noscript>${plain}</noscript>
<script nonce="${nonce}">
${CHOOSE}
</script>`;
  const views = mobile ? `<div id="views" class="views" role="group" aria-label="Version" hidden>
<button type="button" class="act act--quiet" data-view-to="phone"><span class="sq">${glyph('phone')}</span><span class="act-label">Phone</span></button>
<button type="button" class="act act--quiet" data-view-to="full"><span class="sq">${glyph('reg-wide')}</span><span class="act-label">Full</span></button>
</div>` : '';
  const phoneDownload = mobile
    ? `
<a class="act" href="/media/${id}/mobile?${pv}" download="${escapeHtml(fileNameOf(row.title).replace(/\.mp4$/, ' (phone).mp4'))}"><span class="sq">${glyph('download')}</span><span class="act-label">Download phone version</span></a>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:type" content="video.other">
<meta property="og:url" content="${site}/v/${id}">
<meta property="og:image" content="${site}/thumb/${id}?${v}">
<meta property="og:video" content="${site}/media/${id}?${v}">
<meta property="og:video:type" content="video/mp4">
${size}
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
${ICONS}
${TOP}
<main>
<section class="band on-band"><div class="wrap title-band">
<h1>${title}</h1>
<p class="runtime"><span class="vh">Runtime </span>${duration}</p>
</div></section>
<section class="well on-grey"><div class="wrap">
<div class="screen">${player}</div>
${views}
<div class="share-row">
<div class="share-acts">
<button type="button" id="copy" class="act"><span class="sq">${glyph('copy')}</span><span class="act-label">Copy link</span></button>
<a class="act" href="/media/${id}?${v}" download="${fileName}"><span class="sq">${glyph('download')}</span><span class="act-label">Download</span></a>${phoneDownload}
</div>
<p class="facts"><time datetime="${date.toISOString()}">${isoDate}</time><span id="size">${fmtSize(row.size)}</span></p>
</div>
<p id="copied" role="status"></p>
</div></section>
</main>
${FOOT}
<script nonce="${nonce}">
const t = document.querySelector('time');
t.textContent = new Date(t.dateTime).toLocaleDateString(undefined, { dateStyle: 'medium' });
const v = document.querySelector('video');
if (v.width && v.height) v.style.setProperty('--ar', v.width / v.height);
const label = document.querySelector('#copy .act-label');
document.getElementById('copy').addEventListener('click', async () => {
  const out = document.getElementById('copied');
  try { await navigator.clipboard.writeText(location.href); label.textContent = 'Copied'; out.textContent = 'Link copied. Paste it anywhere.'; }
  catch { out.textContent = 'Copy failed. Copy the address bar instead.'; }
  setTimeout(() => { label.textContent = 'Copy link'; }, 2000);
});${mobile ? `
${SWITCH}` : ''}
</script>
</body>
</html>`;
  return htmlPage(html, 200, nonce);
}

// The download's file name: the title without characters file systems refuse.
function fileNameOf(title) {
  return (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'vignette') + '.mp4';
}

export function notFoundResponse() {
  return htmlPage(`<!doctype html>
<html lang="en">
<head>${HEAD}<title>Video not found</title></head>
<body>${ICONS}${TOP}
<main class="wrap nf"><div class="msg" data-tone="error">${glyph('warning')}<div>
<h1>Video not found</h1>
<p>This link may be wrong, or the video was deleted. Ask the person who sent it for a new link.</p>
</div></div></main>
${FOOT}</body></html>`, 404);
}

function htmlPage(html, status, nonce) {
  // The share page makes no external requests; the policy enforces that.
  // Styles and fonts come from this Worker's own static files.
  const base = "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const csp = nonce ? `${base}; media-src 'self'; script-src 'nonce-${nonce}'` : base;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp },
  });
}
