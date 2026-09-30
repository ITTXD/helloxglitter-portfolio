/**
 * TDD Suite for Ticket 02 — Extract Product & Promo Management
 *
 * Guards the migration contract between the storefront (public/index.html)
 * and the standalone admin portal (public/admin/*). These are structural
 * assertions: both sides share one origin, so their localStorage keys and
 * IndexedDB names must match, and the storefront must no longer own the
 * editing UI.
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
console.log('  TEST: Product & Promo Migration (Ticket 02)');
console.log('========================================\n');

console.log('── 1. SHARED STORAGE CONTRACT (same origin) ──');

test('product IndexedDB name/store match the storefront', () => {
  // Storefront product manager registers hlg_product_media_v1 / images.
  assert.ok(
    storefront.includes("DB='hlg_product_media_v1',STORE='images'"),
    'storefront product manager should use hlg_product_media_v1/images'
  );
  // The admin portal must target the exact same database and object store.
  assert.ok(
    adminJs.includes('"hlg_product_media_v1"'),
    'admin.js should open hlg_product_media_v1'
  );
  assert.ok(
    adminJs.includes('"images"'),
    'admin.js should use the "images" object store'
  );
  assert.ok(
    !adminJs.includes('PRODUCT_DB = "hlg_custom_font_v1"'),
    'admin.js must not reuse the font database for product images'
  );
});

test('promo / pricing / font localStorage keys match', () => {
  for (const key of ['hlg_quantity_promo_v1', 'hlg_pricing_v1', 'hlg_font_settings_v1']) {
    assert.ok(storefront.includes(key), `storefront should reference ${key}`);
    assert.ok(adminJs.includes(key), `admin.js should reference ${key}`);
  }
});

test('product localStorage key matches', () => {
  assert.ok(storefront.includes("hlg_custom_products_v1"));
  assert.ok(adminJs.includes("hlg_custom_products_v1"));
});

console.log('\n── 2. NO DESTRUCTIVE STOREFRONT-SETTINGS WRITES ──');

test('admin.js never PUTs { products } to /api/settings/storefront', () => {
  // That endpoint whitelists banners/notices/stories and would wipe them.
  assert.ok(
    !/products\s*:\s*updated/.test(adminJs),
    'admin.js must not send a products payload to the storefront settings endpoint'
  );
  assert.ok(
    !(adminJs.includes('/api/settings/storefront') && adminJs.includes('products: updated')),
    'product save must not call the storefront settings endpoint'
  );
});

console.log('\n── 3. STOREFRONT NO LONGER OWNS ADMIN EDITING UI ──');

test('storefront does not create the migrated admin panels', () => {
  for (const id of ['adminPanel-products', 'adminPanel-tiers', 'adminPanel-fonts', 'adminPanel-pricing']) {
    assert.ok(
      !storefront.includes(`id='${id}'`) && !storefront.includes(`id="${id}"`),
      `storefront should not create #${id}`
    );
  }
});

test('storefront does not wire admin tabs for migrated editors', () => {
  for (const tab of ['products', 'tiers', 'fonts', 'pricing']) {
    assert.ok(
      !storefront.includes(`switchAdminTab('${tab}')`) &&
        !storefront.includes(`switchAdminTab('${tab}',`),
      `storefront should not create a switchAdminTab('${tab}') trigger`
    );
  }
});

test('storefront keeps the customer-facing product engine', () => {
  for (const fn of ['function hydrate()', 'function sync()', 'function decorateSticker()', 'function read()']) {
    assert.ok(storefront.includes(fn), `storefront should keep ${fn}`);
  }
});

test('storefront keeps the customer-facing price engines', () => {
  for (const hook of [
    'window.hlgTierQuote=quote',
    'window.hlgTierProductInfo=function',
    'window.hlgPriceFor=resolve',
    'window.getPromoNote=function',
    'window.renderPromoWrap=function'
  ]) {
    assert.ok(storefront.includes(hook), `storefront should keep ${hook}`);
  }
});

console.log('\n── 4. ADMIN PORTAL OWNS THE EDITORS ──');

test('admin portal exposes the migrated editor entry points', () => {
  for (const fn of ['window.hlgRenderTiers = renderTiers', 'window.hlgRenderPricing = renderPricing', 'window.hlgRenderFonts = renderFonts']) {
    assert.ok(adminJs.includes(fn), `admin.js should expose ${fn}`);
  }
});

test('admin portal renders migrated editors in the products view', () => {
  for (const id of ['tierManagerContainer', 'pricingManagerContainer', 'fontManagerContainer']) {
    assert.ok(adminHtml.includes(`id="${id}"`), `admin portal should contain #${id}`);
  }
  assert.ok(adminHtml.includes("switchView('products')"), 'admin portal should keep the products tab');
});

test('admin portal wires the migrated editors into switchView', () => {
  assert.ok(adminJs.includes('window.hlgRenderTiers'), 'switchView should call hlgRenderTiers');
  assert.ok(adminJs.includes('window.hlgRenderPricing'), 'switchView should call hlgRenderPricing');
  assert.ok(adminJs.includes('window.hlgRenderFonts'), 'switchView should call hlgRenderFonts');
});

test('dependent storefront admin tabs no longer anchor on removed panels', () => {
  assert.ok(
    !storefront.includes("anchor=$('#adminPanel-tiers')||$('#adminPanel-pricing')"),
    'coupon tab must not anchor on the removed tier/pricing panels'
  );
  assert.ok(
    !storefront.includes("panel=document.getElementById('adminPanel-pricing')"),
    'shipping tab must not anchor on the removed pricing panel'
  );
});

console.log('\n========================================');
console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED > 0) {
  process.exit(1);
}
