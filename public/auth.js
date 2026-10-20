// Owner password handling, shared by the recorder and the library.
// The password is kept in localStorage so the owner types it once per browser.
// Every storage call is wrapped: private windows or blocked storage must not
// break the page. A copy is also kept in memory, so the page keeps working
// for this visit even when storage is blocked.
import { say, busy } from './ui.js';

const KEY = 'vignette.password';
let memoryCopy = '';

export function getPassword() {
  try { return localStorage.getItem(KEY) || memoryCopy; } catch { return memoryCopy; }
}

export function setPassword(password) {
  memoryCopy = password;
  try { localStorage.setItem(KEY, password); } catch { /* storage unavailable */ }
}

export function clearPassword() {
  memoryCopy = '';
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// fetch() against the owner API with the password attached. Throws ApiError
// for non-2xx responses, carrying the server's {error} message.
// The password is URL-encoded because HTTP headers only carry Latin-1:
// "ö" or an emoji would otherwise make fetch() throw. The Worker decodes it.
export async function api(path, { method = 'GET', body, password = getPassword(), headers = {} } = {}) {
  const init = { method, headers: { authorization: `Bearer ${encodeURIComponent(password)}`, ...headers } };
  if (body !== undefined) {
    const isJson = !(body instanceof Blob) && !(body instanceof ArrayBuffer);
    init.body = isJson ? JSON.stringify(body) : body;
    if (isJson) init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

// Returns {result: 'ok' | 'wrong' | 'error', message}. `message` is the
// server's own explanation when there is one (for example, a missing secret).
export async function checkPassword(password) {
  try {
    await api('/api/videos', { password });
    return { result: 'ok' };
  } catch (err) {
    if (err.status === 401) return { result: 'wrong' };
    if (err.status) return { result: 'error', message: `The server reported a problem: ${err.message}` };
    return { result: 'error', message: 'Could not reach the server. Check your connection and try again.' };
  }
}

// Wires up the password form in `gate` (a <form> with an input[type=password],
// a submit button and an element with class "error" inside a "msg" panel).
// Calls onReady() whenever a working
// password is stored: on load, and again if the gate had to be shown later.
// A stored password is re-checked on every load.
export async function requirePassword(gate, onReady) {
  const input = gate.querySelector('input[type=password]');
  const submit = gate.querySelector('button[type=submit]');
  const error = gate.querySelector('.error');
  const ready = () => { gate.hidden = true; onReady(); };

  gate.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = input.value;
    say(error, '');
    busy(submit, true);
    const { result, message } = await checkPassword(password);
    busy(submit, false);
    if (result === 'ok') {
      setPassword(password);
      input.value = '';
      ready();
    } else {
      say(error, result === 'wrong' ? 'That password is not right. Check it and try again.' : message);
      input.select();
    }
  });

  const stored = getPassword();
  if (stored) {
    const { result, message } = await checkPassword(stored);
    if (result === 'ok') return ready();
    if (result === 'wrong') clearPassword();
    else say(error, message);
  }
  gate.hidden = false;
  input.focus();
}

// Shows the gate again after the server rejects a stored password (for
// example, the owner changed it). The next successful submit hides it.
export function showGateAgain(gate, message) {
  clearPassword();
  gate.hidden = false;
  say(gate.querySelector('.error'), message);
  gate.querySelector('input[type=password]').focus();
}
