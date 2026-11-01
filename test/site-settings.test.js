/**
 * Shop settings sync: admin-only writes, allow-list, size limits, stock usage.
 * Run with: node test/site-settings.test.js
 */
'use strict';

const assert = require('assert');
const { handleSiteSettingsApi, stockUsed, stockKey, SYNC_KEYS } = require('../site-settings');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}
function memStore() {
  const data = new Map();
  return { data, get: async (c, id) => data.get(c + '/' + id) || null, set: async (c, id, v) => { data.set(c + '/' + id, v); } };
}
async function call(store, admin, method, body) {
  const res = { status: 0, json: null, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  const handled = await handleSiteSettingsApi({ body }, res, '/api/site-settings', method, {
    store, isAdmin: () => admin, readBody: async r => r.body,
    sendJson: (r, code, b) => { r.status = code; r.json = b; },
  });
  return { handled, res };
}

(async () => {
  await test('client and server agree on which keys sync', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../public/data/site-sync.js'), 'utf8');
    const m = src.match(/var SYNC_KEYS = \[([\s\S]*?)\];/);
    const clientKeys = m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    assert.deepStrictEqual(clientKeys.slice().sort(), SYNC_KEYS.slice().sort());
  });

  await test('only admins can save, everyone can read', async () => {
    const store = memStore();
    assert.strictEqual((await call(store, false, 'PUT', { values: { hlg_inventory_v1: '{}' } })).res.status, 401);
    await call(store, true, 'PUT', { values: { hlg_tracking_global_update_v1: 'ส่ง 10 พ.ย.' } });
    const read = await call(store, false, 'GET');
    assert.strictEqual(read.res.json.values.hlg_tracking_global_update_v1, 'ส่ง 10 พ.ย.');
    assert.ok(read.res.json.versions.hlg_tracking_global_update_v1 > 0);
  });

  await test('unknown keys and oversize values are refused', async () => {
    const store = memStore();
    assert.strictEqual((await call(store, true, 'PUT', { values: { hlg_unified_cart_v1: '[]' } })).res.status, 400);
    assert.strictEqual((await call(store, true, 'PUT', { values: { hlg_v6_inline_text: 'x'.repeat(210 * 1024) } })).res.status, 413);
  });

  await test('a null value removes the setting', async () => {
    const store = memStore();
    await call(store, true, 'PUT', { values: { hlg_badges_v1: '[1]' } });
    await call(store, true, 'PUT', { values: { hlg_badges_v1: null } });
    const read = await call(store, false, 'GET');
    assert.strictEqual(read.res.json.values.hlg_badges_v1, undefined);
    assert.ok(read.res.json.versions.hlg_badges_v1 > 0, 'removal is versioned so other browsers drop it too');
  });

  await test('stock used counts every live order except the baseline', () => {
    const k = stockKey({ type: 'bag', name: 'Lady Pink', variant: 'L' });
    const inventory = JSON.stringify({ [k]: { managed: true, qty: 3, baseline: ['OLD'] }, other: { managed: false } });
    const orders = [
      { id: 'OLD', items: [{ type: 'bag', name: 'Lady Pink', variant: 'L', qty: 5 }] },
      { id: 'A', items: [{ type: 'bag', name: 'Lady Pink', variant: 'L', qty: 1 }, { type: 'bag', name: 'Odette', qty: 9 }] },
      { id: 'B', items: [{ type: 'bag', name: 'Lady Pink', variant: 'L', qty: 2 }] },
    ];
    assert.deepStrictEqual(stockUsed(inventory, orders), { [k]: 3 });
  });

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
