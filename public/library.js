// Library page: the owner's register of recordings, with copy, open and delete.
import { api, requirePassword, showGateAgain } from './auth.js';
import { say, icon } from './ui.js';

const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), app: $('app'), status: $('status'), loadMsg: $('loadMsg'), empty: $('empty'),
  table: $('table'), rows: $('rows'), count: $('count'), newRec: $('newRec'), announce: $('announce'),
};

const fmtDuration = (s) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
const fmtSize = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shareUrl = (id) => `${location.origin}/v/${id}`;

// Small DOM helper: el('td', {className: 'x'}, child, 'text', ...)
function el(tag, { dataset, ...props } = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  Object.assign(node.dataset, dataset); // dataset itself is read-only
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// A pictogram square with its word. The word is the accessible name; wide
// screens hide it visually (it shows as the tooltip), the stacked phone
// layout shows it beside the pictogram.
function square(glyph, label, tag = 'button', props = {}) {
  const node = el(tag, { className: 'sqbtn', title: label, ...props },
    el('span', { className: 'sqbtn-sq' }, icon(glyph)), el('span', { className: 'sqbtn-word', textContent: label }));
  if (tag === 'button') node.type = 'button';
  return node;
}
const setSquare = (node, glyph, label) => {
  node.title = node.lastChild.textContent = label;
  node.firstChild.replaceChildren(icon(glyph));
};

function tell(text) { ui.announce.textContent = text; }

async function load() {
  ui.status.hidden = false;
  say(ui.loadMsg, '');
  let videos;
  try {
    ({ videos } = await api('/api/videos'));
  } catch (err) {
    ui.status.hidden = true;
    if (err.status === 401) return showGateAgain(ui.gate, 'The server did not accept the password. Enter it again.');
    say(ui.loadMsg, `Could not load your recordings (${err.message}). Reload the page to try again.`);
    return;
  }
  ui.status.hidden = true;
  ui.rows.replaceChildren(...videos.map(row));
  updateCount();
}

function updateCount() {
  const n = ui.rows.children.length;
  ui.empty.hidden = n > 0;
  ui.table.hidden = ui.newRec.hidden = n === 0;
  ui.count.textContent = n ? `${n} recording${n === 1 ? '' : 's'}, newest first.` : 'Nothing here yet.';
}

function row(v) {
  const ready = v.status === 'ready';
  const plate = el('span', { className: 'reg-img' });
  const thumb = el('img', { src: `/thumb/${v.id}`, alt: '', loading: 'lazy', width: 160, height: 90 });
  thumb.addEventListener('error', () => { thumb.remove(); plate.append(icon('frame')); });
  plate.append(thumb);
  const title = ready ? el('a', { href: `/v/${v.id}`, textContent: v.title, title: v.title }) : el('span', { textContent: v.title, title: v.title });

  const actions = el('div', { className: 'reg-acts' });
  const showActions = () => {
    actions.replaceChildren();
    if (ready) {
      const copy = square('copy', 'Copy link');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareUrl(v.id));
          setSquare(copy, 'check', 'Copied');
          tell('Link copied.');
        } catch {
          tell('Copy failed. Open it and copy the address instead.');
        }
        setTimeout(() => setSquare(copy, 'copy', 'Copy link'), 1500);
      });
      actions.append(copy, square('arrow-out', 'Open', 'a', { href: `/v/${v.id}`, target: '_blank', rel: 'noopener' }));
    }
    const del = square('trash', 'Delete');
    del.addEventListener('click', confirmDelete);
    actions.append(del);
  };

  // Inline confirmation instead of window.confirm, which blocks the page.
  const confirmDelete = () => {
    const yes = el('button', { type: 'button', className: 'word word--solid', textContent: 'Yes' });
    const no = el('button', { type: 'button', className: 'word', textContent: 'No' });
    no.addEventListener('click', () => { showActions(); actions.lastChild.focus(); });
    yes.addEventListener('click', async () => {
      yes.disabled = no.disabled = true;
      yes.setAttribute('aria-busy', 'true');
      try {
        await api(`/api/videos/${v.id}`, { method: 'DELETE' });
        tr.remove();
        updateCount();
        tell(`Deleted ${v.title}.`);
      } catch (err) {
        actions.replaceChildren(el('span', { className: 'reg-err', textContent: `Delete failed (${err.message}). Try again.` }));
        setTimeout(showActions, 3000);
      }
    });
    actions.replaceChildren(el('span', { className: 'confirm', textContent: 'Delete?' }), yes, no);
    no.focus(); // the safe answer gets the keyboard
  };
  showActions();

  const created = new Date(v.created_at);
  const tr = el('tr', { dataset: { id: v.id } },
    el('td', { className: 'reg-thumb' }, plate),
    el('td', { className: 'reg-title' }, title),
    el('td', { className: 'reg-run r' }, fmtDuration(v.duration)),
    // "Originals kept": the screen and camera as recorded are stored too (see README).
    el('td', { className: 'reg-size r' }, el('span', { className: 'reg-sz' }, fmtSize(v.size), v.has_raw ? el('span', { className: 'reg-raw', textContent: 'Originals kept' }) : null)),
    el('td', { className: 'reg-date' }, el('time', { dateTime: created.toISOString(), textContent: fmtDate(v.created_at) })),
    el('td', { className: 'reg-status' }, el('span', { className: `status ${v.status}`, textContent: ready ? 'Ready' : 'Uploading' })),
    el('td', { className: 'reg-actions' }, actions),
  );
  return tr;
}

// Runs on load and again if the password has to be re-entered after a 401.
requirePassword(ui.gate, () => { ui.app.hidden = false; load(); });
