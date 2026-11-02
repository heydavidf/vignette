// The phone version in the edit step (docs/LOOP4_MOBILE_EXPORT_SPEC.md): the
// Phone version toggle with its Shape pair and size strip, the region box
// over the preview's screen picture (region.js), the phone preview plate
// (the phone version's poster), the second render, Download phone MP4's file,
// and its upload once the link works. editor.js calls in at each of those
// moments; the vertical frame is layouts.js's mobile(), drawn by render.js.
// The test hooks are listed at the top of region.js.
import { renderLayout, grabLayout } from './render.js';
import { probe } from './media.js';
import { fitRect, layoutOf } from './layouts.js';
import { attachRegion } from './region.js';
import { uploadPhone } from './upload.js';
import { showGateAgain } from './auth.js';
import { say, busy } from './ui.js';

const POSTER_W = 540; // the phone poster, 540x960
const $ = (id) => document.getElementById(id);
const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * @param {object} o
 * @param {object} o.S          the editor's state (video, camera, mobile, job)
 * @param {object} o.layout     the layout tools (layout-tools.js)
 * @param {Element} o.gate      the password gate, for a 401
 * @param {(fraction: number) => void} o.setProgress  the render's progress bar
 * @param {(blob: Blob) => string} o.objectUrl         an object URL released with the recording
 * @param {(on: boolean) => void} o.onKeeping           the upload after the link starts or stops
 */
export function attachPhone({ S, layout, gate, setProgress, objectUrl, onKeeping }) {
  const ui = {
    tools: $('phoneTools'), on: $('phoneOn'), set: $('regionSet'), area: $('regionArea'), box: $('regionBox'),
    plate: $('phonePlate'), download: $('downloadPhone'), msg: $('phoneMsg'), retry: $('retryPhone'),
    uploadMsg: $('uploadMsg'), progress: $('progress'), rawMsg: $('rawMsg'),
  };
  // The phone message sits under Upload's until the link is made, then with the link, above the originals'.
  const box = (el) => el.closest('.msg');
  const moveMsg = (linked) => (linked ? box(ui.rawMsg).before(box(ui.msg), ui.retry) : box(ui.uploadMsg).after(box(ui.msg), ui.retry));
  const region = attachRegion({
    area: ui.area, box: ui.box, sizes: document.querySelectorAll('input[name=regionSize]'), shapes: document.querySelectorAll('input[name=regionShape]'),
  });
  const img = Object.assign(document.createElement('img'), { id: 'phoneImg', alt: 'Phone version' });
  const plateGlyph = ui.plate.firstElementChild;
  let screen = null, poster = null, timer = null, token = 0, lastTime = 0;
  const listeners = [];

  const on = () => !!screen && !ui.tools.hidden && ui.on.checked;
  // What the phone file is made of now; `key` changes whenever the file would.
  function settings() {
    const lay = layout.get();
    const camera = S.camera && layoutOf(lay.id).needsCamera ? S.camera : null; // Screen only and Padded leave the camera out
    const colour = !camera && lay.id === 'padded' ? lay.colour : null;
    const box = region.box();
    const variant = region.get().shape;
    const key = `${variant} ${['x', 'y', 'w', 'h'].map((k) => box[k].toFixed(4)).join(',')} ${camera ? 'camera' : colour || 'black'}`;
    return { camera, colour, box, variant, key };
  }

  // Where the screen picture sits in the preview's frame, as shares of it.
  function pictureBox() {
    const g = layout.geometry();
    const r = fitRect(g.screen, screen.width, screen.height, g.screen.fit);
    return { x: r.dx / g.W, y: r.dy / g.H, w: r.dw / g.W, h: r.dh / g.H };
  }

  // Shows the toggle (not in Camera only, where there is no screen: there the phone version is suspended,
  // not turned off, and comes back with a layout that has a screen) and, while it is on, the rest.
  function show() {
    const offered = !!screen && layout.get().id !== 'camera';
    ui.tools.hidden = !offered;
    const live = on();
    ui.set.hidden = ui.area.hidden = ui.plate.hidden = ui.download.hidden = !live;
    layout.setFramed(live);
    if (live) region.place(pictureBox());
  }
  function changed() {
    show();
    if (on()) schedule(lastTime);
    listeners.forEach((fn) => fn());
  }
  ui.on.addEventListener('change', () => { say(ui.msg, ''); changed(); });
  region.onChange(changed);
  layout.onChange(changed);

  // ---------- The poster (the phone preview plate) ----------
  async function grab(time) {
    const t = ++token;
    const want = settings();
    const look = `${want.key} ${time.toFixed(3)}`;
    if (poster?.look === look) return poster.blob;
    const blob = await grabLayout({
      screen: S.video.blob, camera: want.camera?.blob, cameraOffset: want.camera?.offset, time,
      layout: 'mobile', region: want.box, variant: want.variant, colour: want.colour, width: POSTER_W,
    });
    if (t !== token || !S.video) return poster?.blob;
    poster = { blob, look };
    img.src = objectUrl(blob);
    if (!img.isConnected) ui.plate.replaceChildren(img);
    return blob;
  }
  // Refreshes the plate shortly, at the thumbnail's time.
  function schedule(time) {
    lastTime = time;
    clearTimeout(timer);
    if (on()) timer = setTimeout(() => grab(time).catch(() => {}), 300);
  }

  // ---------- The render ----------
  // The phone file for the kept ranges (keyed by keptKey), rendered after the
  // landscape one; null while the toggle is off. A render that fails turns
  // the toggle off (struck) and says so: the landscape upload goes on without it.
  async function ensure(ranges, keptKey, note) {
    if (!on()) return null;
    const want = settings();
    const key = `${keptKey} ${want.key}`;
    if (S.mobile?.key === key) return S.mobile;
    say(ui.uploadMsg, 'Rendering the phone version...', 'note');
    setProgress(0);
    ui.progress.hidden = false;
    const t0 = performance.now();
    try {
      const blob = await renderLayout({
        screen: S.video.blob, camera: want.camera?.blob, cameraOffset: want.camera?.offset, ranges,
        layout: 'mobile', region: want.box, variant: want.variant, colour: want.colour, onProgress: setProgress,
      });
      const secs = (performance.now() - t0) / 1000;
      const { width, height } = await probe(blob);
      const length = ranges.reduce((n, r) => n + r.end - r.start, 0);
      S.mobile = { key, blob, width, height, region: want.box, variant: want.variant };
      note('phone version', `${width}x${height}, ${want.variant}, ${fmtMB(blob.size)}, rendered at ${(length / secs).toFixed(1)} s of video per second`);
      say(ui.uploadMsg, '');
      return S.mobile;
    } catch (err) {
      S.mobile = null;
      ui.on.checked = false;
      changed();
      say(ui.uploadMsg, '');
      say(ui.msg, `Could not render the phone version (${err.message}). Upload and Download MP4 go on without it.`);
      note('phone version', `failed: ${err.message}`);
      return null;
    } finally {
      ui.progress.hidden = true;
    }
  }

  // ---------- The upload, once the link works ----------
  // Sends the phone file and its poster; a failure never touches the link, and Retry sends only what is missing.
  async function keep(job, note) {
    if (!job?.mobile || !S.mobile) return;
    moveMsg(true);
    onKeeping(true);
    ui.retry.disabled = true;
    busy(ui.retry, true);
    const t0 = performance.now();
    try {
      const pic = await grab(lastTime).catch(() => null); // a missing poster should not block the file
      await uploadPhone({
        job, blob: S.mobile.blob, poster: pic,
        onProgress: (sent, all) => say(ui.msg, `Sending the phone version: ${fmtMB(sent)} of ${fmtMB(all)}...`, 'note'),
      });
      ui.retry.hidden = true;
      say(ui.msg, 'Phone version kept: phones that open the link play it.', 'note');
      note('phone version kept', `${fmtMB(S.mobile.blob.size)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      if (err.status === 401) showGateAgain(gate, 'The server did not accept the password. Enter it again, then click Retry.');
      const reason = err.status ? err.message : 'the connection to the server dropped';
      say(ui.msg, `Phone version not kept: the vertical file was not stored (${reason}). The link works without it. Retry sends only what is missing.`);
      ui.retry.hidden = false;
      note('phone version kept', `no: ${reason}`);
    } finally {
      busy(ui.retry, false);
      ui.retry.disabled = false;
      onKeeping(false);
    }
  }

  return {
    // A recording opened: its screen's size, and the uploaded phone version's settings in again mode.
    open(screenSize, stored = null) {
      screen = screenSize;
      poster = null;
      region.open(screen.width, screen.height, stored);
      ui.on.checked = !!stored?.region;
      ui.plate.replaceChildren(plateGlyph);
      ui.retry.hidden = true;
      say(ui.msg, '');
      moveMsg(false);
      show();
    },
    close() {
      clearTimeout(timer);
      screen = poster = null;
      ui.on.checked = false;
      ui.tools.hidden = true;
      show();
    },
    on, ensure, keep, schedule,
    // Holds the toggle, the strips and the box still (rendering, uploading, linked).
    hold(held) { ui.tools.inert = ui.box.inert = held; },
    // Runs fn() after the toggle, the region or anything the phone file depends on changes.
    onChange(fn) { listeners.push(fn); },
    hooks: {
      get on() { return on(); },
      get offered() { return !!screen && !ui.tools.hidden; },
      get region() { return region.get(); },
      get box() { return screen ? region.box() : null; },
      get shape() { return region.get().shape; },
      get size() { return region.get().size; },
      set({ on: next, ...r } = {}) {
        if (typeof next === 'boolean' && next !== ui.on.checked && !ui.tools.hidden) { ui.on.checked = next; say(ui.msg, ''); changed(); }
        region.set(r);
      },
      get exported() { return S.mobile && { width: S.mobile.width, height: S.mobile.height, size: S.mobile.blob.size }; },
      get poster() { return poster && img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null; },
    },
  };
}
