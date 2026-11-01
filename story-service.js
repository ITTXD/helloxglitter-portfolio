/**
 * story-service.js
 *
 * Cloud storage for storefront Story Highlights, shared by server.js and
 * api/[...path].js. Highlights used to live only in the admin's browser
 * (localStorage + IndexedDB), so customers never saw them.
 *
 * Media files are stored in Firestore as base64 chunks (each well under the
 * 1 MiB document limit) and served back with HTTP Range support so videos can
 * stream and autoplay on phones. Responses are capped below Vercel's 4.5 MB
 * function response limit; browsers fetch the rest with further Range requests.
 *
 * Routes:
 *   GET    /api/stories              public  → { stories, updated_at }
 *   PUT    /api/stories              admin   ← { stories }
 *   POST   /api/story-media          admin   ← { media_id, index, count, mime, data }
 *   GET    /api/story-media/:id      public  → file bytes (Range aware)
 *   DELETE /api/story-media/:id      admin
 */
'use strict';

// Media lives in `settings` under a prefix: the live Firestore rules reject writes to
// new collections (PERMISSION_DENIED), but `settings` is writable.
const MEDIA_COLLECTION = 'settings';
const MEDIA_PREFIX = 'story_media__';
function metaKey(id) { return MEDIA_PREFIX + id; }
const SETTINGS_ID = 'stories';
const CHUNK_BYTES = 600 * 1024;          // binary bytes per Firestore chunk document
const MAX_CHUNKS = 60;                   // ~35 MB per file
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_STORIES = 40;
const MAX_ITEMS = 60;
const ID_RE = /^[a-z0-9][a-z0-9_-]{7,63}$/i;
const MIME_RE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|font\/(woff2|woff|ttf|otf))$/;

function chunkId(id, i) { return metaKey(id) + '__' + i; }

function cleanRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const id = String(ref.media_id || '');
  if (!ID_RE.test(id)) {
    // Plain links (site images or https) are kept as-is.
    const url = String(ref.url || '');
    if (url.length > 500 || !/^(\/(?!\/)|https:\/\/)/.test(url)) return null;
    return { url, type: ref.type === 'video' ? 'video' : 'image' };
  }
  return {
    media_id: id,
    type: ref.type === 'video' ? 'video' : 'image',
    duration: Math.max(0, Math.min(600, Number(ref.duration) || 0)),
  };
}

function cleanStories(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_STORIES).map(st => ({
    name: String((st && st.name) || 'Highlight').slice(0, 60),
    cover: cleanRef(st && st.cover),
    media: (Array.isArray(st && st.media) ? st.media : []).slice(0, MAX_ITEMS).map(cleanRef).filter(Boolean),
  }));
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { invalid: true };
  // Serve at most MAX_RESPONSE_BYTES; the browser asks again for the rest.
  return { start, end: Math.min(end, start + MAX_RESPONSE_BYTES - 1) };
}

async function readBytes(store, id, meta, start, end) {
  const first = Math.floor(start / CHUNK_BYTES), last = Math.floor(end / CHUNK_BYTES);
  const parts = [];
  for (let i = first; i <= last; i++) {
    const chunk = await store.get(MEDIA_COLLECTION, chunkId(id, i));
    if (!chunk || typeof chunk.data !== 'string') throw new Error('missing chunk ' + i);
    parts.push(Buffer.from(chunk.data, 'base64'));
  }
  const buf = Buffer.concat(parts);
  const offset = first * CHUNK_BYTES;
  return buf.subarray(start - offset, end - offset + 1);
}

/**
 * @param ctx { isAdmin(req), readBody(req), sendJson(res, code, body), store: { get, set, del } }
 * @returns {Promise<boolean>} true when the request was handled
 */
async function handleStoryApi(req, res, pathname, method, ctx) {
  const { store, sendJson } = ctx;

  if (pathname === '/api/stories' && method === 'GET') {
    const doc = await store.get('settings', SETTINGS_ID);
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, { stories: (doc && Array.isArray(doc.stories)) ? doc.stories : [], updated_at: (doc && doc.updated_at) || null });
    return true;
  }

  if (pathname === '/api/stories' && method === 'PUT') {
    if (!ctx.isAdmin(req)) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }
    const body = await ctx.readBody(req);
    const stories = cleanStories(body && body.stories);
    if (!stories) { sendJson(res, 400, { error: 'ข้อมูล Highlight ไม่ถูกต้อง' }); return true; }
    const doc = { stories, updated_at: new Date().toISOString() };
    await store.set('settings', SETTINGS_ID, doc);
    sendJson(res, 200, { success: true, ...doc });
    return true;
  }

  if (pathname === '/api/story-media' && method === 'POST') {
    if (!ctx.isAdmin(req)) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }
    const body = await ctx.readBody(req);
    const id = String(body.media_id || '');
    const index = Number(body.index), count = Number(body.count);
    const mime = String(body.mime || '');
    const data = typeof body.data === 'string' ? body.data : '';
    const bytes = Buffer.byteLength(data, 'base64');
    if (!ID_RE.test(id) || !MIME_RE.test(mime) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS
      || !Number.isInteger(index) || index < 0 || index >= count || !data || bytes > CHUNK_BYTES) {
      sendJson(res, 400, { error: 'ไฟล์ไม่ถูกต้องหรือใหญ่เกินไป' });
      return true;
    }
    await store.set(MEDIA_COLLECTION, chunkId(id, index), { data });
    if (index === count - 1) {
      const size = (count - 1) * CHUNK_BYTES + bytes;
      await store.set(MEDIA_COLLECTION, metaKey(id), { mime, chunks: count, size, created_at: new Date().toISOString() });
    }
    sendJson(res, 200, { success: true, media_id: id, url: '/api/story-media/' + id });
    return true;
  }

  if (pathname.startsWith('/api/story-media/') && (method === 'GET' || method === 'HEAD' || method === 'DELETE')) {
    const id = decodeURIComponent(pathname.slice('/api/story-media/'.length));
    if (!ID_RE.test(id)) { sendJson(res, 404, { error: 'Not found' }); return true; }
    const meta = await store.get(MEDIA_COLLECTION, metaKey(id));

    if (method === 'DELETE') {
      if (!ctx.isAdmin(req)) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }
      if (meta) {
        for (let i = 0; i < (Number(meta.chunks) || 0); i++) await store.del(MEDIA_COLLECTION, chunkId(id, i));
        await store.del(MEDIA_COLLECTION, metaKey(id));
      }
      sendJson(res, 200, { success: true });
      return true;
    }

    if (!meta || !(meta.size > 0)) { sendJson(res, 404, { error: 'Not found' }); return true; }
    const size = Number(meta.size);
    const headers = {
      'Content-Type': meta.mime,
      'Accept-Ranges': 'bytes',
      // A media id never changes content, so it can be cached forever.
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    };
    let range = parseRange(req.headers.range, size);
    if (range && range.invalid) {
      res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + size });
      res.end();
      return true;
    }
    // Large files without a Range request (rare: browsers range-request video)
    // still get a partial response so the function stays under its size limit.
    if (!range && size > MAX_RESPONSE_BYTES) range = { start: 0, end: MAX_RESPONSE_BYTES - 1 };
    const start = range ? range.start : 0, end = range ? range.end : size - 1;
    const bytes = method === 'HEAD' ? null : await readBytes(store, id, meta, start, end);
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size } : {}),
    });
    res.end(bytes || undefined);
    return true;
  }

  return false;
}

module.exports = { handleStoryApi, cleanStories, parseRange, CHUNK_BYTES, MAX_CHUNKS, MAX_RESPONSE_BYTES };
