// Streaming one R2 object as video/mp4 with a single Range, for the public
// /media route and the owner's originals route (index.js decides which keys
// each may read).
import { HttpError } from './http.js';

// Parses a single "bytes=a-b" range into an R2 range. Multi-range and
// malformed headers return null, which means "send the whole file".
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (m[2] === '') return { offset };
  const end = Number(m[2]);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

// Streams one R2 object as video/mp4, honouring a single Range.
export async function streamObject(request, env, key, cacheControl, missing) {
  const headers = new Headers({
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    const head = await env.MEDIA.head(key);
    if (!head) throw new HttpError(404, missing);
    headers.set('content-length', String(head.size));
    headers.set('etag', head.httpEtag);
    return new Response(null, { headers });
  }

  const range = parseRange(request.headers.get('range'));
  let object;
  try {
    object = await env.MEDIA.get(key, range ? { range } : {});
  } catch {
    // R2 rejects ranges that start past the end of the file.
    const head = await env.MEDIA.head(key);
    if (!head) throw new HttpError(404, missing);
    throw new HttpError(416, 'Range not satisfiable', { 'content-range': `bytes */${head.size}` });
  }
  if (!object) throw new HttpError(404, missing);
  headers.set('etag', object.httpEtag);

  if (!range) {
    headers.set('content-length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  const size = object.size;
  let start, end;
  if ('suffix' in range) { start = Math.max(0, size - range.suffix); end = size - 1; }
  else { start = range.offset; end = range.length === undefined ? size - 1 : Math.min(size - 1, range.offset + range.length - 1); }
  if (start >= size || end < start) {
    await object.body?.cancel();
    throw new HttpError(416, 'Range not satisfiable', { 'content-range': `bytes */${size}` });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(object.body, { status: 206, headers });
}
