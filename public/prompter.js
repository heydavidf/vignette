// The script: notes to read while recording. Step 1's Script toggle shows a
// plain text box; the self-view window (selfview.js) shows the text in a
// panel under the picture that scrolls slowly on its own, a teleprompter.
// The text stays in this browser tab (sessionStorage) and is never uploaded.

const KEY = 'vignette.script';
export const SPEEDS = [0.5, 1, 1.5, 2];
const LINE_SECONDS = 2.5;  // at 1x, one line every 2.5 s
const HAND_PAUSE = 3000;   // ms the auto-scroll waits after a hand scroll

function load() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}
function save(text) {
  try { if (text) sessionStorage.setItem(KEY, text); else sessionStorage.removeItem(KEY); } catch { /* storage blocked: kept on the page only */ }
}

/**
 * Step 1: the Script toggle, the row it shows and the text box in it. A
 * reload in the same tab brings the text back, with the toggle on. The row
 * hides while recording (setRecording), so step 1 shrinks to a done sign.
 * @returns {{text: () => string, setRecording: (on: boolean) => void}}
 *   text(): the script to show while recording, '' for none
 */
export function attachInput({ toggle, row, input }) {
  let recording = false;
  const showRow = () => { row.hidden = !toggle.checked || recording; };
  input.value = load();
  toggle.checked = !!input.value.trim();
  showRow();
  toggle.addEventListener('change', () => {
    showRow();
    if (toggle.checked) input.focus();
  });
  input.addEventListener('input', () => save(input.value));
  return {
    text: () => (toggle.checked && input.value.trim() ? input.value : ''),
    setRecording(on) { recording = on; showRow(); },
  };
}

/**
 * The window's panel: shows `script` in `text` (a scrolling element) and
 * scrolls it while recording. Wheel, drag or keys scroll it by hand and
 * hold the auto-scroll for 3 s. Under reduced motion it starts paused.
 * els: {text, slower, pause, faster, speed, pauseUse}; icons: the sprite URL.
 * place: {pos, i, paused}, the scroll place, speed and pause, kept by the
 * caller so a reopened window carries on where the last one was ({} to start).
 * @returns {{tick: (now: number, live: boolean) => void, state: () => object}}
 */
export function panel(els, script, win, icons, place = {}) {
  const { text, slower, pause, faster, speed, pauseUse } = els;
  text.textContent = script;
  // Reduced motion is read on the page (the same setting the window has): the window is filled straight away,
  // possibly before its own media settings are in place.
  if (place.i === undefined) Object.assign(place, { pos: 0, i: 1, paused: matchMedia('(prefers-reduced-motion: reduce)').matches });
  const p = place;
  // This window only: what the panel last set, the last tick, the hand-scroll hold, and putting a kept place back
  // (tried each tick until the text is laid out far enough, for at most 2 s).
  const w = { set: 0, last: 0, handUntil: 0, restore: p.pos > 0 ? performance.now() + 2000 : 0 };
  const hold = () => { w.handUntil = performance.now() + HAND_PAUSE; };

  const show = () => {
    speed.textContent = `${SPEEDS[p.i]}x`;
    slower.disabled = p.i === 0;
    faster.disabled = p.i === SPEEDS.length - 1;
    pauseUse.setAttribute('href', `${icons}#i-${p.paused ? 'play' : 'pause'}`);
    pause.setAttribute('aria-label', p.paused ? 'Scroll the script' : 'Pause the script');
    pause.title = pause.getAttribute('aria-label');
    pause.setAttribute('aria-pressed', String(p.paused));
  };
  slower.addEventListener('click', () => { p.i = Math.max(0, p.i - 1); show(); });
  faster.addEventListener('click', () => { p.i = Math.min(SPEEDS.length - 1, p.i + 1); show(); });
  pause.addEventListener('click', () => { p.paused = !p.paused; show(); });

  // By hand: the wheel and keys scroll it natively; a drag moves it too.
  text.addEventListener('wheel', hold, { passive: true });
  text.addEventListener('keydown', hold);
  text.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const y0 = e.clientY, top0 = text.scrollTop;
    text.setPointerCapture(e.pointerId);
    const move = (ev) => { text.scrollTop = top0 - (ev.clientY - y0); hold(); };
    const end = () => {
      text.removeEventListener('pointermove', move);
      text.removeEventListener('pointerup', end);
      text.removeEventListener('pointercancel', end);
    };
    text.addEventListener('pointermove', move);
    text.addEventListener('pointerup', end);
    text.addEventListener('pointercancel', end);
    hold();
  });
  show();

  return {
    // One step of the auto-scroll, from the recorder's ticker. Distance comes
    // from the time since the last step, so a slow tick does not slow it.
    tick(now, live) {
      const dt = w.last ? Math.min(now - w.last, 1000) : 0;
      w.last = now;
      if (w.restore) {
        text.scrollTop = p.pos;
        if (Math.abs(text.scrollTop - p.pos) > 1 && now < w.restore) return; // not laid out that far yet
        w.restore = 0;
        p.pos = w.set = text.scrollTop;
      }
      // Moved by something other than this (the scrollbar, keys, a resize): follow it.
      if (Math.abs(text.scrollTop - w.set) > 1) { p.pos = w.set = text.scrollTop; hold(); }
      if (!live || p.paused || now < w.handUntil) return;
      const line = parseFloat(win.getComputedStyle(text).lineHeight) || 24;
      const end = Math.max(0, text.scrollHeight - text.clientHeight);
      p.pos = Math.min(end, p.pos + (line / LINE_SECONDS) * SPEEDS[p.i] * (dt / 1000));
      text.scrollTop = p.pos;
      w.set = text.scrollTop;
    },
    state: () => ({ shown: true, paused: p.paused, speed: SPEEDS[p.i], scrollTop: text.scrollTop, length: script.length }),
  };
}
