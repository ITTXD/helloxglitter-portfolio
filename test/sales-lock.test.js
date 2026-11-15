/**
 * ล็อกการขาย: which items a rule pauses, time windows, and the server-side refusal.
 * Run with: node test/sales-lock.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lock = require('../sales-lock');
const { salesLockProblem, DOC_ID } = require('../site-settings');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}
const normal = { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch' };
const large = { type: 'bag', name: 'Big One', variant: '15.5 × 4 × 16 inch' };
const sticker = { type: 'sticker', name: 'Bunny', variant: '' };
const cfg = rules => JSON.stringify({ rules });
const storeWith = rules => ({ get: async (c, id) => (c === 'settings' && id === DOC_ID ? { values: { [lock.KEY]: cfg(rules) } } : null) });

(async () => {
  await test('storefront copy is identical to the server copy', () => {
    const a = fs.readFileSync(path.join(__dirname, '../sales-lock.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../public/data/sales-lock.js'), 'utf8');
    assert.strictEqual(a, b);
  });

  await test('no rules, broken JSON and disabled rules lock nothing', () => {
    assert.strictEqual(lock.problem([normal], null), null);
    assert.strictEqual(lock.problem([normal], '{oops'), null);
    assert.strictEqual(lock.problem([normal], cfg([{ target: 'all', enabled: false }])), null);
  });

  await test('type:bag locks every bag but not stickers', () => {
    const c = cfg([{ target: 'type:bag', message: 'ปิดรับกระเป๋า' }]);
    assert.ok(lock.lockFor(normal, c));
    assert.ok(lock.lockFor(large, c));
    assert.strictEqual(lock.lockFor(sticker, c), null);
    assert.strictEqual(lock.problem([sticker, large], c).text, 'Big One: ปิดรับกระเป๋า');
  });

  await test('size rule locks only that bag size', () => {
    const c = cfg([{ target: 'size:large' }]);
    assert.strictEqual(lock.lockFor(normal, c), null);
    assert.ok(lock.lockFor(large, c));
    assert.ok(lock.lockFor({ type: 'bag', name: 'x', variant: '', sizeKey: 'large' }, c));
  });

  await test('selected rule locks only the picked items', () => {
    const c = cfg([{ target: 'selected', skus: [lock.sku(normal)] }]);
    assert.ok(lock.lockFor(normal, c));
    assert.strictEqual(lock.lockFor(large, c), null);
  });

  await test('whole-shop lock uses the default message when none is set', () => {
    assert.strictEqual(lock.problem([sticker], cfg([{ target: 'all' }])).text, lock.DEFAULT_MESSAGE);
  });

  await test('start and end are Thai time and bound the lock', () => {
    const rule = { target: 'all', start: '2026-11-20T10:00', end: '2026-11-21T10:00' };
    const at = s => Date.parse(s + '+07:00');
    assert.strictEqual(lock.active(rule, at('2026-11-20T09:59')), false);
    assert.strictEqual(lock.active(rule, at('2026-11-20T10:00')), true);
    assert.strictEqual(lock.active(rule, at('2026-11-21T10:01')), false);
    assert.strictEqual(lock.active({ target: 'all', end: 'garbage' }, at('2030-01-01T00:00')), true);
  });

  await test('server refuses each request shape that holds a locked item', async () => {
    const store = storeWith([{ target: 'type:bag', message: 'พักรับกระเป๋า' }, { target: 'type:wallpaper' }]);
    assert.strictEqual(await salesLockProblem(store, 'order', { items: [sticker, normal] }), 'Merilah Pink: พักรับกระเป๋า');
    assert.strictEqual(await salesLockProblem(store, 'quote', { items: [sticker] }), '');
    assert.strictEqual(await salesLockProblem(store, 'order', { patterns: ['Merilah Pink (15 × 16 inch)'] }), 'Merilah Pink (15 × 16 inch): พักรับกระเป๋า');
    assert.strictEqual(await salesLockProblem(store, 'sticker', { order: { patterns: ['Bunny'] } }), '');
    assert.ok(await salesLockProblem(store, 'wallpaper', {}));
    assert.strictEqual(await salesLockProblem({ get: async () => null }, 'order', { items: [normal] }), '');
  });

  await test('both servers check every customer order route', () => {
    for (const file of ['../server.js', '../api/[...path].js']) {
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const kind of ['quote', 'order', 'wallpaper', 'sticker']) {
        assert.ok(src.includes("siteSettings.salesLockProblem(storyStore, '" + kind + "', body)"), file + ' ' + kind);
      }
    }
  });

  console.log('\n  RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
