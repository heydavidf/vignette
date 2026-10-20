// Small helpers shared by the recorder, the editor and the library.

// Puts `text` in a message <p>. Its wrapper (an element with class "msg")
// is shown or hidden with it. tone "error" draws the black warning panel;
// "note" is plain text.
export function say(el, text, tone = 'error') {
  el.textContent = text;
  const box = el.closest('.msg') || el;
  box.hidden = !text;
  box.dataset.tone = tone;
}

// A time in seconds as m:ss.s, for the trim and cut readouts.
export const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// An inline pictogram from /icons.svg, hidden from screen readers.
export function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

// Marks a button as working (the loading state) or done.
export function busy(button, on) {
  if (on) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}
