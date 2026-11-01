/**
 * Story Highlights cloud storage: chunked upload, Range serving, admin guard.
 * Run with: node test/story-service.test.js
 */
'use strict';

const assert = require('assert');
const { handleStoryApi, parseRange, cleanStories, CHUNK_BYTES, MAX_RESPONSE_BYTES } = require('../story-service');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}

function memStore() {
  const data = new Map();
  return {
    data,
    get: async (c, id) => data.get(c + '/' + id) || null,
    set: async (c, id, v) => { data.set(c + '/' + id, v); },
    del: async (c, id) => { data.delete(c + '/' + id); },
  };
}
function makeRes() {
  const res = { status: 0, headers: {}, body: null, json: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, h) => { res.status = code; Object.assign(res.headers, h || {}); };
  res.end = b => { res.body = b || null; };
  return res;
}
function ctx(store, admin) {
  return {
    store,
    isAdmin: () => admin,
    readBody: async req => req.body,
    sendJson: (res, code, body) => { res.status = code; res.json = body; },
  };
}
async function call(store, admin, method, path, body, headers) {
  const res = makeRes();
  const handled = await handleStoryApi({ body, headers: headers || {} }, res, path, method, ctx(store, admin));
  return { handled, res };
}
async function upload(store, id, buf, mime) {
  const count = Math.ceil(buf.length / CHUNK_BYTES);
  for (let i = 0; i < count; i++) {
    const { res } = await call(store, true, 'POST', '/api/story-media', {
      media_id: id, index: i, count, mime, data: buf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64'),
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  }
}

(async () => {
  await test('range parsing clamps to the file and to the response cap', () => {
    assert.deepStrictEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepStrictEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepStrictEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.deepStrictEqual(parseRange('bytes=0-', 10 * MAX_RESPONSE_BYTES), { start: 0, end: MAX_RESPONSE_BYTES - 1 });
    assert.deepStrictEqual(parseRange('bytes=2000-', 1000), { invalid: true });
    assert.strictEqual(parseRange('', 1000), null);
  });

  await test('story list keeps media ids and safe links only', () => {
    const out = cleanStories([{ name: 'Reviews', cover: { media_id: 'mabcdefgh1', type: 'image' },
      media: [{ media_id: 'mabcdefgh2', type: 'video', duration: 12 }, { url: 'blob:x' }, { url: '/images/a.jpg' }, { url: 'javascript:alert(1)' }] }]);
    assert.deepStrictEqual(out[0].media, [{ media_id: 'mabcdefgh2', type: 'video', duration: 12 }, { url: '/images/a.jpg', type: 'image' }]);
  });

  await test('only admins can write stories or media', async () => {
    const store = memStore();
    assert.strictEqual((await call(store, false, 'PUT', '/api/stories', { stories: [] })).res.status, 401);
    assert.strictEqual((await call(store, false, 'POST', '/api/story-media', {})).res.status, 401);
    assert.strictEqual((await call(store, false, 'DELETE', '/api/story-media/mabcdefgh1')).res.status, 401);
  });

  await test('customers read what the admin published', async () => {
    const store = memStore();
    const before = await call(store, false, 'GET', '/api/stories');
    assert.deepStrictEqual(before.res.json, { stories: [], updated_at: null });
    await call(store, true, 'PUT', '/api/stories', { stories: [{ name: 'Reviews', cover: { media_id: 'mabcdefgh1' }, media: [] }] });
    const after = await call(store, false, 'GET', '/api/stories');
    assert.strictEqual(after.res.json.stories[0].name, 'Reviews');
    assert.ok(after.res.json.updated_at);
  });

  await test('a multi-chunk upload is served back whole and by range', async () => {
    const store = memStore();
    const buf = Buffer.alloc(CHUNK_BYTES * 2 + 1234);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
    await upload(store, 'mvideo00001', buf, 'video/mp4');

    const whole = await call(store, false, 'GET', '/api/story-media/mvideo00001');
    assert.strictEqual(whole.res.status, 200);
    assert.strictEqual(whole.res.headers['Content-Type'], 'video/mp4');
    assert.ok(Buffer.compare(whole.res.body, buf) === 0);

    const start = CHUNK_BYTES - 10, end = CHUNK_BYTES + 10;
    const part = await call(store, false, 'GET', '/api/story-media/mvideo00001', null, { range: `bytes=${start}-${end}` });
    assert.strictEqual(part.res.status, 206);
    assert.strictEqual(part.res.headers['Content-Range'], `bytes ${start}-${end}/${buf.length}`);
    assert.ok(Buffer.compare(part.res.body, buf.subarray(start, end + 1)) === 0);
  });

  await test('rejects oversize chunks and unknown file types', async () => {
    const store = memStore();
    const big = Buffer.alloc(CHUNK_BYTES + 1).toString('base64');
    assert.strictEqual((await call(store, true, 'POST', '/api/story-media', { media_id: 'mabcdefgh1', index: 0, count: 1, mime: 'image/jpeg', data: big })).res.status, 400);
    assert.strictEqual((await call(store, true, 'POST', '/api/story-media', { media_id: 'mabcdefgh1', index: 0, count: 1, mime: 'text/html', data: 'aGk=' })).res.status, 400);
  });

  await test('deleting media removes every chunk', async () => {
    const store = memStore();
    await upload(store, 'mimage00001', Buffer.alloc(CHUNK_BYTES + 5, 7), 'image/jpeg');
    await call(store, true, 'DELETE', '/api/story-media/mimage00001');
    assert.strictEqual(store.data.size, 0);
    assert.strictEqual((await call(store, false, 'GET', '/api/story-media/mimage00001')).res.status, 404);
  });

  await test('other routes are left to the main handler', async () => {
    assert.strictEqual((await call(memStore(), true, 'GET', '/api/orders')).handled, false);
  });

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
