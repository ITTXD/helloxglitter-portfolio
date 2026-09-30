/**
 * TDD Suite — Move Stock + Receipt admin editors to the /admin/ portal.
 *
 * Both panels must leave the customer-facing HTML, but the customer-facing
 * behaviour they support (stock guard at checkout, receipt/summary download
 * and slip upload) must stay on the storefront. Same-origin storage keys and
 * IndexedDB names must line up on both sides.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const storefront = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');

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
  }
}

console.log('========================================');
console.log('  TEST: Stock & Receipt Migration');
console.log('========================================\n');

console.log('── 1. STOCK: ADMIN LEAVES, CUSTOMER GUARD STAYS ──');

test('storefront no longer creates the stock admin panel', () => {
  assert.ok(
    !storefront.includes("id='adminPanel-stock'") && !storefront.includes('id="adminPanel-stock"'),
    'storefront should not create #adminPanel-stock'
  );
  assert.ok(!storefront.includes("switchAdminTab('stock'"), 'storefront should not wire a stock admin tab');
});

test('storefront keeps the customer stock guard', () => {
  assert.ok(storefront.includes('window.hlgStockRemaining=remaining'), 'storefront keeps hlgStockRemaining');
  assert.ok(storefront.includes('window.v8ConfirmUnifiedOrder'), 'storefront keeps the checkout stock guard');
});

test('admin portal owns the stock editor', () => {
  assert.ok(adminHtml.includes('data-view="stock"'), 'topbar should have data-view="stock"');
  assert.ok(adminHtml.includes("switchView('stock')"), 'topbar should call switchView(stock)');
  assert.ok(adminHtml.includes('id="viewStock"'), 'should define #viewStock');
  assert.ok(adminHtml.includes('id="stockManagerContainer"'), 'should define #stockManagerContainer');
  assert.ok(adminJs.includes('window.hlgRenderStock'), 'admin.js should expose hlgRenderStock');
  assert.ok(adminJs.includes("view === 'stock'"), 'switchView should handle the stock view');
});

test('stock inventory key matches on both sides', () => {
  assert.ok(storefront.includes('hlg_inventory_v1'), 'storefront references the inventory key');
  assert.ok(adminJs.includes('hlg_inventory_v1'), 'admin.js references the inventory key');
});

test('stock row key encoding is identical on both sides', () => {
  const keyShape = /JSON\.stringify\(\[String\(x\.type\|\|'bag'\),String\(x\.name\|\|''\),String\(x\.variant\|\|''\)\]\)/;
  assert.ok(keyShape.test(storefront.replace(/\s+/g, '')), 'storefront stock key shape');
  assert.ok(keyShape.test(adminJs.replace(/\s+/g, '')), 'admin.js must use the same stock key shape');
  const stockSection = adminJs.slice(adminJs.indexOf('STOCK EDITOR'), adminJs.indexOf('RECEIPT / THANK-YOU EDITOR'));
  assert.ok(!/sku\(/.test(stockSection), 'stock editor must not key inventory with the product-manager sku()');
});

test('stock editor counts the same order source as the customer guard', () => {
  assert.ok(adminJs.includes('HLG_ORDERS_DB_V1'), 'admin.js should read the storefront order DB');
  assert.ok(adminJs.includes('hlg_orders_v2'), 'admin.js should fall back to the localStorage orders key');
  assert.ok(/indexedDB\.databases/.test(adminJs), 'must not create the order DB if it is missing');
});

console.log('\n── 2. RECEIPT: ADMIN LEAVES, CUSTOMER FLOW STAYS ──');

test('storefront no longer creates the receipt admin panel', () => {
  assert.ok(
    !storefront.includes("id='adminPanel-receipt'") && !storefront.includes('id="adminPanel-receipt"'),
    'storefront should not create #adminPanel-receipt'
  );
  assert.ok(!storefront.includes("switchAdminTab('receipt'"), 'storefront should not wire a receipt admin tab');
});

test('storefront keeps the customer receipt + slip flow', () => {
  for (const hook of [
    'window.hrxDownload',
    'window.hrxPostSlip',
    'window.hrxConfirmPayment',
    'window.hrxCopyBank',
    'function renderDone',
    'function receiptMarkup'
  ]) {
    assert.ok(storefront.includes(hook), `storefront should keep ${hook}`);
  }
});

test('admin portal owns the receipt design editor', () => {
  assert.ok(adminHtml.includes('data-view="receipt"'), 'topbar should have data-view="receipt"');
  assert.ok(adminHtml.includes("switchView('receipt')"), 'topbar should call switchView(receipt)');
  assert.ok(adminHtml.includes('id="viewReceipt"'), 'should define #viewReceipt');
  assert.ok(adminHtml.includes('id="receiptManagerContainer"'), 'should define #receiptManagerContainer');
  assert.ok(adminJs.includes('window.hlgRenderReceipt'), 'admin.js should expose hlgRenderReceipt');
  assert.ok(adminJs.includes("view === 'receipt'"), 'switchView should handle the receipt view');
});

test('receipt settings key and asset DB match on both sides', () => {
  assert.ok(storefront.includes('hlg_receipt_design_v1'), 'storefront references the receipt settings key');
  assert.ok(adminJs.includes('hlg_receipt_design_v1'), 'admin.js references the receipt settings key');
  assert.ok(storefront.includes('HLG_RECEIPT_ASSETS_V1'), 'storefront references the asset DB');
  assert.ok(adminJs.includes('HLG_RECEIPT_ASSETS_V1'), 'admin.js references the asset DB');
});

console.log('\n========================================');
console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED > 0) {
  process.exit(1);
}
