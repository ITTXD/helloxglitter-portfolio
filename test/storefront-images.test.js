/**
 * Pictures pasted into the storefront settings are moved to the media store, so the
 * settings document stays under Firestore's 1 MiB limit.
 * Run with: node test/storefront-images.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { offloadDataImages } = require('../story-service');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}
function memStore() {
  const data = new Map();
  return { data, get: async (c, id) => data.get(c + '/' + id) || null, set: async (c, id, v) => { data.set(c + '/' + id, v); } };
}
const big = 'data:image/jpeg;base64,' + Buffer.alloc(300 * 1024, 7).toString('base64');
const small = 'data:image/png;base64,iVBORw0KGgo=';

(async () => {
  await test('large inline pictures become media links, everything else is untouched', async () => {
    const store = memStore();
    const sf = { preview_cards: [{ name: 'A', image_url: big }, { name: 'B', image_url: small }], categories: [{ id: 'c1', cover_url: big }], note: 'hi' };
    await offloadDataImages(store, sf);
    assert.match(sf.preview_cards[0].image_url, /^\/api\/story-media\/img[0-9a-f]{30}$/);
    assert.strictEqual(sf.preview_cards[1].image_url, small);
    assert.strictEqual(sf.categories[0].cover_url, sf.preview_cards[0].image_url, 'same picture, same link');
    assert.strictEqual(sf.note, 'hi');
    assert.ok(JSON.stringify(sf).length < 2000);
  });

  await test('the stored picture is written once and can be read back', async () => {
    const store = memStore();
    const a = { x: big }, b = { y: big };
    await offloadDataImages(store, a);
    const writes = store.data.size;
    await offloadDataImages(store, b);
    assert.strictEqual(store.data.size, writes);
    const id = a.x.split('/').pop();
    const meta = await store.get('settings', 'story_media__' + id);
    assert.strictEqual(meta.mime, 'image/jpeg');
    assert.strictEqual(meta.size, 300 * 1024);
    const chunk = await store.get('settings', 'story_media__' + id + '__0');
    assert.strictEqual(Buffer.from(chunk.data, 'base64').length, 300 * 1024);
  });

  await test('every storefront settings write in both servers goes through offloadDataImages', () => {
    for (const [file, re] of [['../server.js', /fsSetDoc\('settings', 'storefront', ([^\n]*)/g], ['../api/[...path].js', /setDoc\(doc\(db, 'settings', 'storefront'\), ([^\n]*)/g]]) {
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const calls = [...src.matchAll(re)];
      assert.ok(calls.length >= 8, file + ' writes found: ' + calls.length);
      calls.forEach(m => assert.ok(m[1].startsWith('await storyService.offloadDataImages(storyStore,'), file + ': ' + m[0].slice(0, 80)));
    }
  });

  console.log('\n  RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
