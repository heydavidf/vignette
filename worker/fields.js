// What an upload declares, checked before anything reaches SQL or R2: the
// rendered video's fields, the bubble's place, the layout, and the phone
// version. index.js stores what these return; anything else is a 400.
import { HttpError } from './http.js';

const SIZES = ['small', 'medium', 'large'];
const SHAPES = ['round', 'square'];
// The layouts a video can be rendered in (public/layouts.js); padded carries its colour: 'padded:grey'.
const LAYOUTS = ['bubble', 'split', 'camera', 'screen', 'padded'];
const COLOURS = ['cream', 'black', 'grey', 'vermilion'];
const VARIANTS = ['wide', 'square']; // the phone version's top band (public/layouts.js, mobile())

const share = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
// A picture's side: a whole number from 1 to 16384.
const side = (v) => Number.isInteger(v) && v > 0 && v <= 16384;

// Validates the bubble's place as sent by the client: {x, y} shares of the
// frame from 0 to 1, one of the three sizes, and a shape (round when left
// out, as before shapes existed). Stored as JSON, or null.
function bubbleJson(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new HttpError(400, 'bubble must be {x, y, size, shape}');
  const { x, y, size, shape = 'round' } = value;
  if (!share(x) || !share(y) || !SIZES.includes(size) || !SHAPES.includes(shape)) {
    throw new HttpError(400, 'bubble must be {x, y, size, shape} with x and y from 0 to 1, size small, medium or large, shape round or square');
  }
  return JSON.stringify({ x, y, size, shape });
}

// Validates a layout: one of the five, padded with one of its four colours.
function layoutText(value = 'bubble') {
  const [id, colour, ...rest] = typeof value === 'string' ? value.split(':') : [];
  const fine = !rest.length && LAYOUTS.includes(id) && (id === 'padded' ? COLOURS.includes(colour) : colour === undefined);
  if (!fine) throw new HttpError(400, `layout must be ${LAYOUTS.slice(0, 4).join(', ')} or padded:<${COLOURS.join('|')}>`);
  return value;
}

// Checks a declared file size against the upload cap. `name` says which file in the 413's words.
export function checkBytes(env, n, what, name = what === 'size' ? 'Video' : `The ${what} original`) {
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${what} must be a positive number of bytes`);
  if (n > Number(env.MAX_UPLOAD_MB || 2000) * 1024 * 1024) {
    throw new HttpError(413, `${name} is larger than the ${env.MAX_UPLOAD_MB} MB limit`);
  }
}

// What a rendered video declares, validated, for a new upload or a version rendered again.
export function videoFields(env, body) {
  const title = String(body.title ?? '').trim().slice(0, 200) || 'Untitled';
  const duration = Number(body.duration);
  const size = Number(body.size);
  const dim = (v) => (side(v) ? v : null);
  if (!Number.isFinite(duration) || duration < 0) throw new HttpError(400, 'duration must be a number of seconds');
  checkBytes(env, size, 'size');
  return { title, duration, size, width: dim(body.width), height: dim(body.height), layout: layoutText(body.layout), bubble: bubbleJson(body.bubble) };
}

// The phone version an upload declares, or null: {size, width, height,
// region, variant}. The region is the part of the screen it keeps, as shares
// of the screen picture: x, y from 0 to 1, w and h at least 0.1, the whole
// box on the picture. Only these fields are kept.
export function mobileFields(env, value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'mobile must be {size, width, height, region, variant}');
  const { size, width, height, region, variant } = value;
  checkBytes(env, size, 'mobile size', 'The phone version');
  if (!side(width) || !side(height)) throw new HttpError(400, 'mobile width and height must be whole numbers from 1 to 16384');
  if (!VARIANTS.includes(variant)) throw new HttpError(400, 'mobile variant must be wide or square');
  const r = region && typeof region === 'object' ? region : {};
  const EDGE = 1e-6; // shares added up in floating point
  const fine = [r.x, r.y, r.w, r.h].every(share) && r.w >= 0.1 && r.h >= 0.1 && r.x + r.w <= 1 + EDGE && r.y + r.h <= 1 + EDGE;
  if (!fine) throw new HttpError(400, 'mobile region must be {x, y, w, h}: shares from 0 to 1 of the screen, w and h at least 0.1, inside the screen');
  return { size, width, height, region: { x: r.x, y: r.y, w: r.w, h: r.h }, variant };
}
