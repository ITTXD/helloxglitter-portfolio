/**
 * order-lifecycle.js
 *
 * Shared by server.js (local) and api/[...path].js (Vercel) so both handlers
 * agree on how a storefront bill moves from "awaiting payment" to "paid".
 *
 * - A storefront bill is created unpaid with a 1-hour payment deadline and no
 *   queue number. Queue numbers are only allocated when payment is confirmed,
 *   so expired prank orders never consume one.
 * - Unpaid bills past their deadline are purged and leave a small tombstone so
 *   a late confirmation for the same id is rejected instead of re-created.
 */
'use strict';

const PAYMENT_WINDOW_MS = 60 * 60 * 1000;
const AWAITING = 'awaiting_payment';
const PAID = 'paid';
const EXPIRED_COLLECTION = 'expired_orders';

function paymentDeadline(now) {
  return new Date((now == null ? Date.now() : now) + PAYMENT_WINDOW_MS).toISOString();
}

function isAwaitingPayment(order) {
  return !!order && order.payment_state === AWAITING && !order.slip_verified;
}

function isExpired(order, now) {
  if (!isAwaitingPayment(order)) return false;
  const deadline = Date.parse(order.payment_deadline || '');
  return Number.isFinite(deadline) && deadline <= (now == null ? Date.now() : now);
}

// Paid orders are the only ones that count as real orders (stats, labels, sales).
// Orders created before payment_state existed are treated as paid once confirmed.
function isPaid(order) {
  if (!order) return false;
  if (order.payment_state === PAID || order.slip_verified) return true;
  if (order.payment_state === AWAITING) return false;
  return order.channel === 'shopee' || !!order.shopee_order_sn || Number(order.status) >= 1;
}

function deriveOrderType(items, fallback) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length && list.every(x => x.type === 'wallpaper')) return 'wallpaper';
  if (list.length && list.every(x => x.type === 'sticker')) return 'sticker';
  if (list.some(x => x.type === 'bag')) return 'bag';
  return fallback || 'bag';
}

function hasWallpaper(order) {
  if (!order) return false;
  if (order.type === 'wallpaper') return true;
  return Array.isArray(order.items) && order.items.some(x => x && x.type === 'wallpaper');
}

function queueNumber(value) {
  const m = String(value || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

function maxQueueNumber(orders) {
  return (orders || []).reduce((max, o) => Math.max(max, queueNumber(o && o.queue_no)), 0);
}

// The counter only ever moves forward, but a scan of existing orders can push it
// ahead (e.g. queue numbers typed by an admin or created before the counter).
function nextQueueNumber(scanMax, counterLast) {
  return Math.max(Number(scanMax) || 0, Number(counterLast) || 0) + 1;
}

function formatQueueNo(n) {
  return 'HLG-' + String(n).padStart(3, '0');
}

/**
 * Remove expired unpaid bills.
 * @param {object[]} orders  every order record (must carry _docId)
 * @param {object} store     { remove(order), tombstone(order) }
 * @returns {Promise<object[]>} the orders that are still live
 */
async function purgeExpired(orders, store, now) {
  const live = [];
  for (const order of orders || []) {
    if (!isExpired(order, now)) { live.push(order); continue; }
    try {
      await store.tombstone(order);
      await store.remove(order);
    } catch (err) {
      console.warn('[orders] purge expired bill failed:', order && order.id, err.message);
      live.push(order);
    }
  }
  return live;
}

module.exports = {
  PAYMENT_WINDOW_MS,
  AWAITING,
  PAID,
  EXPIRED_COLLECTION,
  paymentDeadline,
  isAwaitingPayment,
  isExpired,
  isPaid,
  deriveOrderType,
  hasWallpaper,
  maxQueueNumber,
  nextQueueNumber,
  formatQueueNo,
  purgeExpired,
};
