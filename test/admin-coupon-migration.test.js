/**
 * TDD Suite for Ticket 03 — Extract Coupon Management
 *
 * The storefront must keep every customer-facing coupon path (wallet, LINE
 * login, apply/validate, cart box) while the campaign *editor* moves to the
 * `/admin/` portal.
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
console.log('  TEST: Coupon Management Migration (Ticket 03)');
console.log('========================================\n');

console.log('── 1. ADMIN PORTAL OWNS THE COUPON EDITOR ──');

test('admin portal has a Coupons tab and view', () => {
  assert.ok(adminHtml.includes('data-view="coupons"'), 'topbar should have data-view="coupons"');
  assert.ok(adminHtml.includes("switchView('coupons')"), 'topbar should call switchView(coupons)');
  assert.ok(adminHtml.includes('id="viewCoupons"'), 'should define #viewCoupons');
  assert.ok(adminHtml.includes('id="couponManagerContainer"'), 'should define #couponManagerContainer');
});

test('admin portal exposes and wires the coupon editor', () => {
  assert.ok(adminJs.includes('window.hlgRenderCoupons'), 'admin.js should expose hlgRenderCoupons');
  assert.ok(adminJs.includes("view === 'coupons'"), 'switchView should handle the coupons view');
  assert.ok(adminJs.includes('hlgRenderCoupons'), 'switchView should call hlgRenderCoupons');
});

test('admin coupon editor saves to the shared campaign endpoint', () => {
  assert.ok(adminJs.includes('/api/coupons/campaign'), 'admin.js should POST the campaign');
  assert.ok(adminJs.includes("method: 'POST'") || adminJs.includes('method:"POST"') || adminJs.includes("method: \"POST\"") || /method:\s*['"]POST['"]/.test(adminJs), 'should use POST');
  assert.ok(adminJs.includes('credentials'), 'admin requests should send credentials');
});

test('admin coupon editor authenticates via session cookie, not admin_password', () => {
  assert.ok(!adminJs.includes('hlg_admin_pwd'), 'admin.js must not send the storefront admin password');
  assert.ok(!adminJs.includes('admin_password'), 'admin.js must not use the admin_password fallback');
});

console.log('\n── 2. STOREFRONT NO LONGER OWNS THE COUPON EDITOR ──');

test('storefront does not create or wire the coupon admin panel', () => {
  assert.ok(
    !storefront.includes("id='adminPanel-coupons'") && !storefront.includes('id="adminPanel-coupons"'),
    'storefront should not create #adminPanel-coupons'
  );
  assert.ok(
    !storefront.includes("switchAdminTab('coupons'"),
    'storefront should not wire switchAdminTab(coupons)'
  );
  assert.ok(
    !storefront.includes("adminTab='coupons'") && !storefront.includes('adminTab="coupons"'),
    'storefront should not create a coupons admin tab'
  );
});

console.log('\n── 3. STOREFRONT KEEPS CUSTOMER COUPON BEHAVIOUR ──');

test('storefront keeps the coupon wallet + LINE login', () => {
  for (const hook of [
    'window.openCoupons=',
    'window.openLineAccount=',
    'window.logoutLine=',
    'function initLineLiff'
  ]) {
    assert.ok(storefront.includes(hook), `storefront should keep ${hook}`);
  }
});

test('storefront keeps apply / validate / claim coupon logic', () => {
  for (const hook of [
    'window.applyCouponToCart=',
    'window.getAppliedCoupon=',
    'window.clearAppliedCoupon=',
    'window.validateCouponCode=',
    'window.handleApplyCouponFromInput=',
    '/api/coupons/validate',
    '/api/coupons/my-coupons',
    '/api/coupons/claim'
  ]) {
    assert.ok(storefront.includes(hook), `storefront should keep ${hook}`);
  }
});

test('storefront keeps customer-facing coupon styling', () => {
  for (const cls of ['.hlg-coupon-item', '.hlg-coupon-code-pill', '.v8-coupon-checkout-box', '.hlg-claim-box']) {
    assert.ok(storefront.includes(cls), `storefront should keep ${cls}`);
  }
});

console.log('\n── 4. SHARED CONTRACT ──');

test('coupon campaign draft key matches on both sides', () => {
  const KEY = 'hlg_coupon_campaign_draft_v1';
  assert.ok(storefront.includes(KEY), 'storefront should reference ' + KEY);
  assert.ok(adminJs.includes(KEY), 'admin.js should reference ' + KEY);
});

console.log('\n========================================');
console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED > 0) {
  process.exit(1);
}
