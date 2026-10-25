/**
 * Shared pricing engine tests.
 * Run with: node test/pricing-engine.test.js
 *
 * The engine is intentionally strict about input: prices always come from the
 * trusted catalog/config, never from the cart item supplied by the browser.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HLGPricing = require('../public/data/pricing-engine.js');

let PASSED = 0;
let FAILED = 0;

function test(name, fn) {
  try {
    fn();
    PASSED++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    FAILED++;
    console.error(`  ❌ ${name}:`, err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

function near(actual, expected, message) {
  assert.strictEqual(actual, expected, message);
}

function makeCatalog(options) {
  return HLGPricing.createCatalog(Object.assign({
    patterns: [
      { name: 'Merilah', size: '15 × 16 inch', sizeKey: 'normal', priceOrig: 399 },
      { name: 'Merilah', size: '18 × 20 inch', sizeKey: 'large', priceOrig: 499 },
      { name: 'Easy', size: '18 × 18 inch', sizeKey: 'easy', priceOrig: 459 }
    ],
    stickers: [{ name: 'Sticker A', price: 59 }],
    includeDefaultWallpaper: false
  }, options || {}));
}

function quote(items, overrides) {
  return HLGPricing.computeQuote(Object.assign({
    catalog: makeCatalog(),
    pricing: { base: {}, promos: [] },
    tier: {},
    shipping: { base: 40, extra: 25, rules: [] },
    address: '99 ถนนทดสอบ เขตบางรัก กรุงเทพ 10500',
    now: Date.parse('2026-10-25T12:00:00+07:00'),
    items: items
  }, overrides || {}));
}

console.log('========================================');
console.log('  TEST: Shared Pricing Engine');
console.log('========================================\n');

console.log('── 1. SKU + CATALOG ──');

test('canonical and legacy SKU formats match the existing client', () => {
  assert.strictEqual(
    HLGPricing.canonicalSku({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' }),
    'bag|Merilah|15 × 16 inch'
  );
  assert.strictEqual(
    HLGPricing.canonicalSku({ type: 'custom', categoryId: 'cat-1', productId: 'prod-9' }),
    'custom|cat-1|prod-9'
  );
  assert.strictEqual(
    HLGPricing.legacySku({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' }),
    JSON.stringify(['bag', 'Merilah', '15 × 16 inch'])
  );
});

test('catalog resolves built-in, sticker and custom products', () => {
  const catalog = makeCatalog({
    categories: [{ id: 'cat-1', name: 'Crossbody' }],
    customProducts: [
      { id: 'cust-bag', category_id: 'bag', name: 'Custom Bag', size: '20 × 20 inch', size_key: 'large', price: 690 }
    ]
  });

  assert.ok(catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' }));
  assert.ok(catalog.lookup({ type: 'sticker', name: 'Sticker A', variant: '' }));
  assert.strictEqual(
    catalog.lookup({ type: 'custom', categoryId: 'cat-1', productId: 'cust-bag' }).sku,
    'bag|Custom Bag|20 × 20 inch'
  );
});

test('custom wallpaper can be looked up by id and keeps the admin custom SKU as an alias', () => {
  const catalog = makeCatalog({
    customProducts: [
      {
        id: 'wp-1',
        category_id: 'wallpaper',
        name: 'Custom Wallpaper',
        price: 149,
        download_url: 'https://example.com/wp'
      }
    ]
  });
  const product = catalog.lookup({ type: 'wallpaper', id: 'wp-1', name: 'Custom Wallpaper', variant: 'Digital Download' });
  assert.ok(product);
  assert.strictEqual(product.sku, 'wallpaper|Custom Wallpaper|Digital Download');
  assert.ok(product.aliases.includes('custom|wallpaper|wp-1'));

  const priced = HLGPricing.resolveItemPrice(product, {
    base: { 'custom|wallpaper|wp-1': 120 },
    promos: [{ id: 'wp', label: 'wp', target: 'sku:custom|wallpaper|wp-1', mode: 'fixed', value: 99 }]
  });
  assert.strictEqual(priced.base, 120);
  assert.strictEqual(priced.price, 99);
  assert.strictEqual(priced.promo.id, 'wp');
});

console.log('\n── 2. SINGLE-ITEM PRICING ──');

test('canonical base override wins over catalog price', () => {
  const catalog = makeCatalog();
  const result = HLGPricing.resolveItemPrice(
    catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' }),
    { base: { 'bag|Merilah|15 × 16 inch': 350 }, promos: [] }
  );
  assert.strictEqual(result.base, 350);
  assert.strictEqual(result.price, 350);
});

test('legacy JSON SKU can resolve a built-in catalog product', () => {
  const catalog = makeCatalog();
  const legacy = HLGPricing.legacySku({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' });
  const product = catalog.lookup({ sku: legacy });
  assert.ok(product);
  assert.strictEqual(product.sku, 'bag|Merilah|15 × 16 inch');
});

test('legacy JSON base override is still readable during migration', () => {
  const catalog = makeCatalog();
  const legacy = HLGPricing.legacySku({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' });
  const result = HLGPricing.resolveItemPrice(
    catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' }),
    { base: { [legacy]: 360 }, promos: [] }
  );
  assert.strictEqual(result.price, 360);
});

test('promo priority follows sku > selected/size > type > all', () => {
  const catalog = makeCatalog();
  const product = catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' });
  const result = HLGPricing.resolveItemPrice(product, {
    base: {},
    promos: [
      { id: 'all', label: 'all', target: 'all', mode: 'amount', value: 10, updated: 9 },
      { id: 'type', label: 'type', target: 'type:bag', mode: 'amount', value: 20, updated: 8 },
      { id: 'size', label: 'size', target: 'size:normal', mode: 'amount', value: 30, updated: 7 },
      { id: 'selected', label: 'selected', target: 'selected', skus: [product.sku], mode: 'amount', value: 40, updated: 6 },
      { id: 'sku', label: 'sku', target: 'sku:' + product.sku, mode: 'amount', value: 50, updated: 5 }
    ]
  });
  assert.strictEqual(result.price, 349);
  assert.strictEqual(result.promo.id, 'sku');
});

test('fixed, percent and amount promo modes are supported', () => {
  const catalog = makeCatalog();
  const product = catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' });

  const fixed = HLGPricing.resolveItemPrice(product, {
    promos: [{ id: 'f', target: 'all', mode: 'fixed', value: 299 }]
  });
  assert.strictEqual(fixed.price, 299);

  const percent = HLGPricing.resolveItemPrice(product, {
    promos: [{ id: 'p', target: 'all', mode: 'percent', value: 10 }]
  });
  assert.strictEqual(percent.price, 359);

  const amount = HLGPricing.resolveItemPrice(product, {
    promos: [{ id: 'a', target: 'all', mode: 'amount', value: 50 }]
  });
  assert.strictEqual(amount.price, 349);
});

test('inactive promos are ignored', () => {
  const catalog = makeCatalog();
  const product = catalog.lookup({ type: 'bag', name: 'Merilah', variant: '15 × 16 inch' });
  const result = HLGPricing.resolveItemPrice(product, {
    promos: [{
      id: 'future',
      target: 'sku:' + product.sku,
      mode: 'fixed',
      value: 1,
      start: '2026-10-26T00:00',
      end: '2026-12-31T23:59'
    }]
  }, Date.parse('2026-10-25T12:00:00+07:00'));
  assert.strictEqual(result.price, 399);
  assert.strictEqual(result.promo, null);
});

test('Thai local dates are interpreted as Asia/Bangkok (+07:00)', () => {
  assert.strictEqual(
    HLGPricing.parseBangkokDate('2026-10-25T12:00'),
    Date.parse('2026-10-25T12:00:00+07:00')
  );
  assert.strictEqual(
    HLGPricing.isActive({ start: '2026-10-25T00:00', end: '2026-10-25T23:59' },
      Date.parse('2026-10-25T12:00:00+07:00')),
    true
  );
});

console.log('\n── 3. SHIPPING ──');

test('empty address is pending, not free', () => {
  const result = HLGPricing.shippingQuote('', [{ type: 'bag' }], { base: 40, extra: 25, rules: [] });
  assert.strictEqual(result.pending, true);
  assert.strictEqual(result.total, 0);
});

test('normal postcode uses base shipping', () => {
  const result = HLGPricing.shippingQuote('99 ถนนทดสอบ 10500', [{ type: 'bag' }], {
    base: 40, extra: 25, rules: []
  });
  assert.strictEqual(result.total, 40);
  assert.strictEqual(result.remote, false);
});

test('remote postcode adds the surcharge', () => {
  const result = HLGPricing.shippingQuote('1 หมู่ 2 58130', [{ type: 'bag' }], {
    base: 40, extra: 25, rules: [{ postcode: '58130' }]
  });
  assert.strictEqual(result.total, 65);
  assert.strictEqual(result.remote, true);
  assert.strictEqual(result.rule.postcode, '58130');
});

test('wallpaper-only carts have no shipping', () => {
  const catalog = HLGPricing.createCatalog({ includeDefaultWallpaper: true });
  const result = HLGPricing.shippingQuote('10500', [catalog.lookup({ type: 'wallpaper', name: 'Wallpaper Special Set', variant: 'Digital Download' })], {
    base: 40, extra: 25, rules: []
  });
  assert.strictEqual(result.total, 0);
});

console.log('\n── 4. TIER PROMOTION ──');

test('tier percent discount, gifts and free shipping compose correctly', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 2 },
    { type: 'bag', name: 'Merilah', variant: '18 × 20 inch', qty: 1 }
  ], {
    tier: {
      enabled: true,
      name: 'โปร 2 ชิ้นขึ้นไป',
      selectedGroups: ['bag'],
      groupPercent: { bag: { 1: 0, 2: 10, 3: 15 } },
      groupModes: { bag: { 1: 'percent', 2: 'percent', 3: 'percent' } },
      tiers: { 1: { gifts: 'gift1' }, 2: { gifts: 'gift2' }, 3: { gifts: 'gift3' } },
      sizeGifts: { normal: { 1: 'Normal Gift 1', 2: 'Normal Gift 2' } },
      freeFrom: 2
    }
  });

  assert.strictEqual(result.tier.quantity, 3);
  assert.strictEqual(result.tier.level, 3);
  assert.strictEqual(result.tier.discount, 195);
  assert.strictEqual(result.subtotal, 1102);
  assert.strictEqual(result.shipping_cost, 0);
  assert.strictEqual(result.grand_total, 1102);
  assert.strictEqual(result.free_shipping, true);
  assert.strictEqual(result.tier.gifts, 'Normal: Normal Gift 2');
});

test('tier product rules override group percentages', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 2 }
  ], {
    tier: {
      enabled: true,
      selectedGroups: ['bag'],
      groupPercent: { bag: { 1: 0, 2: 10, 3: 15 } },
      groupModes: { bag: { 2: 'percent' } },
      productRules: {
        'bag|Merilah|15 × 16 inch': { 1: 299, 2: 299, 3: 299 }
      }
    }
  });
  assert.strictEqual(result.items[0].tier_unit_price, 299);
  assert.strictEqual(result.tier.discount, 200);
  assert.strictEqual(result.subtotal, 598);
});

test('free shipping covers remote surcharge only when configured', () => {
  const base = {
    items: [{ type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 2 }],
    address: '1 หมู่ 2 58130',
    shipping: { base: 40, extra: 25, rules: [{ postcode: '58130' }] },
    tier: {
      enabled: true,
      selectedGroups: ['bag'],
      groupPercent: { bag: { 2: 0 } },
      freeFrom: 2,
      coverRemote: false
    }
  };
  const uncovered = quote(base.items, { address: base.address, shipping: base.shipping, tier: base.tier });
  assert.strictEqual(uncovered.shipping.total, 25);

  const covered = quote(base.items, {
    address: base.address,
    shipping: base.shipping,
    tier: Object.assign({}, base.tier, { coverRemote: true })
  });
  assert.strictEqual(covered.shipping.total, 0);
});

test('tier quantity counts only selected groups and excludes SKUs', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 1 },
    { type: 'bag', name: 'Easy', variant: '18 × 18 inch', qty: 2 },
    { type: 'sticker', name: 'Sticker A', variant: '', qty: 3 }
  ], {
    tier: {
      enabled: true,
      selectedGroups: ['bag'],
      excludedSkus: ['bag|Easy|18 × 18 inch'],
      groupPercent: { bag: { 2: 10 } },
      groupModes: { bag: { 2: 'percent' } }
    }
  });
  assert.strictEqual(result.tier.quantity, 1);
  assert.strictEqual(result.tier.discount, 0);
});

test('custom cart lines resolve through productId and join their admin group', () => {
  const catalog = makeCatalog({
    customProducts: [
      { id: 'cust-bag', category_id: 'bag', name: 'Custom Bag', size: '20 × 20 inch', size_key: 'large', price: 690 }
    ]
  });
  const result = quote([
    {
      type: 'custom',
      categoryId: 'bag',
      productId: 'cust-bag',
      name: 'Custom Bag',
      variant: '20 × 20 inch',
      qty: 2,
      price: 1
    }
  ], {
    catalog,
    tier: {
      enabled: true,
      selectedGroups: ['bag'],
      groupPercent: { bag: { 2: 10 } },
      groupModes: { bag: { 2: 'percent' } }
    }
  });

  assert.strictEqual(result.items[0].sku, 'bag|Custom Bag|20 × 20 inch');
  assert.strictEqual(result.items[0].unit_price, 690);
  assert.strictEqual(result.items[0].tier_unit_price, 621);
  assert.strictEqual(result.tier.discount, 138);
  assert.strictEqual(result.subtotal, 1242);
});

console.log('\n── 5. COUPON + COMPOSITION ──');

test('coupon applies only to its redeem category and is capped', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 1 },
    { type: 'sticker', name: 'Sticker A', variant: '', qty: 1 }
  ], {
    coupon: { code: 'BAG100', discount_amount: 100, redeem_category: 'bag' }
  });
  assert.strictEqual(result.coupon.eligible_subtotal, 399);
  assert.strictEqual(result.coupon_discount, 100);
  assert.strictEqual(result.grand_total, 398);

  const capped = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 1 },
    { type: 'sticker', name: 'Sticker A', variant: '', qty: 1 }
  ], {
    coupon: { code: 'BAG999', discount_amount: 9999, redeem_category: 'bag' }
  });
  assert.strictEqual(capped.coupon_discount, 399);
  assert.strictEqual(capped.grand_total, 99);
});

test('server ignores any client-supplied price fields', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 1, price: 1, base_price: 1, unit_price: 1 }
  ]);
  assert.strictEqual(result.items[0].base_price, 399);
  assert.strictEqual(result.items[0].unit_price, 399);
  assert.strictEqual(result.grand_total, 439);
});

test('quote composes single-item promo + tier + coupon + shipping', () => {
  const result = quote([
    { type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 2 },
    { type: 'sticker', name: 'Sticker A', variant: '', qty: 1 }
  ], {
    pricing: {
      promos: [{ id: 'bag10', target: 'type:bag', mode: 'percent', value: 10 }]
    },
    tier: {
      enabled: true,
      selectedGroups: ['bag'],
      groupPercent: { bag: { 2: 5 } },
      groupModes: { bag: { 2: 'percent' } }
    },
    coupon: { code: 'ALL50', discount_amount: 50, redeem_category: 'all' }
  });

  assert.strictEqual(result.item_discount, 80);
  assert.strictEqual(result.subtotal, 741);
  assert.strictEqual(result.tier_discount, 36);
  assert.strictEqual(result.coupon_discount, 50);
  assert.strictEqual(result.shipping_cost, 40);
  assert.strictEqual(result.grand_total, 731);
  assert.strictEqual(result.discount_total, 166);
});

console.log('\n── 6. INVALID INPUT ──');

test('unknown products are rejected', () => {
  assert.throws(
    () => quote([{ type: 'bag', name: 'Unknown Bag', variant: 'x', qty: 1 }]),
    (err) => err.code === 'UNKNOWN_ITEM'
  );
});

test('invalid quantities are rejected', () => {
  assert.throws(
    () => quote([{ type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 0 }]),
    (err) => err.code === 'INVALID_QTY'
  );
  assert.throws(
    () => quote([{ type: 'bag', name: 'Merilah', variant: '15 × 16 inch', qty: 1.5 }]),
    (err) => err.code === 'INVALID_QTY'
  );
});

test('clients cannot raise the quantity limit from a cart line', () => {
  assert.throws(
    () => quote([{
      type: 'bag',
      name: 'Merilah',
      variant: '15 × 16 inch',
      qty: 1000,
      maxQty: 999999
    }]),
    (err) => err.code === 'INVALID_QTY'
  );
});

test('empty carts are rejected for server quotes', () => {
  assert.throws(() => quote([]), (err) => err.code === 'EMPTY_CART');
});

console.log('\n── 7. UMD / BROWSER PARITY ──');

test('the same file exposes window.HLGPricing in a browser-like VM', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/data/pricing-engine.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.ok(context.HLGPricing, 'global HLGPricing should exist');
  assert.strictEqual(
    typeof context.HLGPricing.computeQuote,
    'function',
    'browser global should expose computeQuote'
  );
  assert.strictEqual(
    context.HLGPricing.canonicalSku({ type: 'bag', name: 'A', variant: 'B' }),
    'bag|A|B'
  );
});

console.log('\n========================================');
console.log(`  RESULT: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED) process.exit(1);
