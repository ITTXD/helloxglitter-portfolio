/**
 * Order lifecycle: unpaid bills, 1-hour expiry, queue numbers.
 * Run with: node test/order-lifecycle.test.js
 */
'use strict';

const assert = require('assert');
const L = require('../order-lifecycle');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}

(async () => {
  const now = Date.parse('2026-11-01T10:00:00Z');

  await test('a new bill is due exactly one hour later', () => {
    assert.strictEqual(L.paymentDeadline(now), '2026-11-01T11:00:00.000Z');
  });

  await test('only unpaid bills past their deadline are expired', () => {
    const bill = { payment_state: L.AWAITING, payment_deadline: '2026-11-01T09:59:59.000Z' };
    assert.strictEqual(L.isExpired(bill, now), true);
    assert.strictEqual(L.isExpired({ ...bill, payment_deadline: '2026-11-01T10:30:00.000Z' }, now), false);
    assert.strictEqual(L.isExpired({ ...bill, slip_verified: true }, now), false);
    assert.strictEqual(L.isExpired({ ...bill, payment_state: L.PAID }, now), false);
    assert.strictEqual(L.isExpired({ status: 0, created_at: '2020-01-01' }, now), false, 'legacy orders are never purged');
  });

  await test('paid detection keeps legacy and Shopee orders', () => {
    assert.strictEqual(L.isPaid({ payment_state: L.AWAITING }), false);
    assert.strictEqual(L.isPaid({ payment_state: L.PAID }), true);
    assert.strictEqual(L.isPaid({ status: 1 }), true);
    assert.strictEqual(L.isPaid({ status: 0 }), false);
    assert.strictEqual(L.isPaid({ status: 0, channel: 'shopee' }), true);
  });

  await test('order type comes from the items', () => {
    assert.strictEqual(L.deriveOrderType([{ type: 'wallpaper' }]), 'wallpaper');
    assert.strictEqual(L.deriveOrderType([{ type: 'wallpaper' }, { type: 'bag' }]), 'bag');
    assert.strictEqual(L.deriveOrderType([{ type: 'sticker' }]), 'sticker');
    assert.strictEqual(L.deriveOrderType([], 'sticker'), 'sticker');
    assert.strictEqual(L.hasWallpaper({ type: 'bag', items: [{ type: 'wallpaper' }] }), true);
  });

  await test('queue numbers continue from the highest existing one', () => {
    const orders = [{ queue_no: 'HLG-001' }, { queue_no: 'HLG-012' }, { queue_no: '' }, {}];
    assert.strictEqual(L.maxQueueNumber(orders), 12);
    assert.strictEqual(L.formatQueueNo(L.nextQueueNumber(12, 5)), 'HLG-013');
    assert.strictEqual(L.formatQueueNo(L.nextQueueNumber(12, 40)), 'HLG-041');
    assert.strictEqual(L.formatQueueNo(L.nextQueueNumber(0, 0)), 'HLG-001');
  });

  await test('purge removes expired bills, tombstones them, and keeps the rest', async () => {
    const removed = [], tombs = [];
    const store = { remove: async o => removed.push(o.id), tombstone: async o => tombs.push(o.id) };
    const live = await L.purgeExpired([
      { id: 'A', payment_state: L.AWAITING, payment_deadline: '2026-11-01T09:00:00Z' },
      { id: 'B', payment_state: L.AWAITING, payment_deadline: '2026-11-01T10:30:00Z' },
      { id: 'C', payment_state: L.PAID },
    ], store, now);
    assert.deepStrictEqual(live.map(o => o.id), ['B', 'C']);
    assert.deepStrictEqual(removed, ['A']);
    assert.deepStrictEqual(tombs, ['A']);
  });

  await test('a failed delete keeps the order instead of losing it silently', async () => {
    const store = { remove: async () => { throw new Error('offline'); }, tombstone: async () => {} };
    const live = await L.purgeExpired([{ id: 'A', payment_state: L.AWAITING, payment_deadline: '2026-11-01T09:00:00Z' }], store, now);
    assert.strictEqual(live.length, 1);
  });

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
