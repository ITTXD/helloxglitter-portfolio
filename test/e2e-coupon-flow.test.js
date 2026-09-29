// ========================================================
// End-to-End Test: Designer HTML & LINE Coupon Integration
// ========================================================
const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let payload = null;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(url, { method, headers: reqHeaders }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data,
          raw: data
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runE2ETests() {
  console.log('\n========================================');
  console.log('  E2E TEST: Complete LINE Coupon Workflow');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch(err) {
      console.error(`  ❌ ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Designer HTML Serving & Integration
  await test('GET /designer serves designer HTML with coupon & LINE elements', async () => {
    const res = await request('GET', '/designer');
    assert.strictEqual(res.status, 200);
    assert(res.raw.includes('id="couponSheet"'), 'Missing #couponSheet in designer HTML');
    assert(res.raw.includes('id="hlg-coupon-campaign-style"'), 'Missing coupon styles');
    assert(res.raw.includes('openLineAccount'), 'Missing openLineAccount function');
    assert(res.raw.includes('openCoupons'), 'Missing openCoupons function');
    assert(res.raw.includes('v8-coupon-checkout-box'), 'Missing cart coupon styling');
    assert(res.raw.includes('hlg-coupon-earned-card'), 'Missing celebration card styling');
  });

  // 2. Admin Campaign API
  await test('GET /api/coupons/campaign returns current campaign rules', async () => {
    const res = await request('GET', '/api/coupons/campaign');
    assert.strictEqual(res.status, 200);
    assert(res.body.success, 'Campaign fetch should succeed');
    assert.strictEqual(res.body.campaign.threshold_amount, 300.9);
    assert.strictEqual(res.body.campaign.discount_amount, 100);
  });

  await test('POST /api/coupons/campaign updates campaign rules with admin password', async () => {
    const res = await request('POST', '/api/coupons/campaign', {
      admin_password: 'helloxglitter',
      campaign: {
        title: 'โปรเปิดร้าน ซื้อ Sticker รับคูปองกระเป๋า',
        threshold_amount: 300.9,
        discount_amount: 100,
        expires_at: '2026-12-31T23:59:00+07:00'
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.campaign.title, 'โปรเปิดร้าน ซื้อ Sticker รับคูปองกระเป๋า');
  });

  // 3. Customer LINE Authentication
  const testLineUserId = 'U_E2E_' + Date.now();
  let cookieHeader = '';

  await test('POST /api/auth/line/verify authenticates LINE customer', async () => {
    const res = await request('POST', '/api/auth/line/verify', {
      line_user_id: testLineUserId,
      line_display_name: 'น้องกริตเตอร์ ทดสอบ'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.line_user_id, testLineUserId);
    assert(res.headers['set-cookie'], 'Must return session cookie');
    cookieHeader = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  });

  // 4. Initial Wallet State
  await test('GET /api/coupons/my-coupons starts empty for new user', async () => {
    const res = await request('GET', `/api/coupons/my-coupons?line_user_id=${testLineUserId}`, null, { Cookie: cookieHeader });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.coupons.length, 0);
  });

  // 5. Sticker Order Qualifying for Coupon
  let earnedCouponCode = '';
  await test('POST /api/sticker/order >= 300.90 THB automatically issues 100 THB coupon', async () => {
    // 5 stickers @ 69 THB = 345 THB (> 300.90 THB)
    const stickerOrderPayload = {
      order: {
        customer_name: 'น้องกริตเตอร์ ทดสอบ',
        customer_phone: '0812345678',
        customer_address: '123/45 ถนนสุขุมวิท พระโขนง คลองเตย กรุงเทพฯ 10110',
        patterns: ['Sticker-01', 'Sticker-02', 'Sticker-03', 'Sticker-04', 'Sticker-05'],
        pattern_qtys: { 'Sticker-01': 1, 'Sticker-02': 1, 'Sticker-03': 1, 'Sticker-04': 1, 'Sticker-05': 1 },
        total_bags: 5,
        total_price: 395, // 345 + 50 ship
        shipping_cost: 50,
      },
      slip_data: 'data:image/jpeg;base64,mockslipsticker395_' + Date.now(),
      line_user_id: testLineUserId
    };

    const res = await request('POST', '/api/sticker/order', stickerOrderPayload);
    assert(res.status === 200 || res.status === 201, 'Status should be 200 or 201, got ' + res.status);
    assert(res.body.order, 'Order must be created');
    assert(res.body.coupon, 'Coupon must be issued in response');
    assert(res.body.coupon.code.startsWith('HXG-CPN-'), 'Coupon code must have prefix HXG-CPN-');
    assert.strictEqual(res.body.coupon.discount_satang, 10000);
    earnedCouponCode = res.body.coupon.code;
  });

  // 6. Wallet Query with Active Coupon
  await test('GET /api/coupons/my-coupons now shows the earned coupon in active status', async () => {
    const res = await request('GET', `/api/coupons/my-coupons?line_user_id=${testLineUserId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.coupons.length, 1);
    assert.strictEqual(res.body.coupons[0].code, earnedCouponCode);
    assert.strictEqual(res.body.coupons[0].status, 'active');
  });

  // 7. Coupon Validation for Bag Purchase
  await test('POST /api/coupons/validate verifies coupon for Bag category', async () => {
    const res = await request('POST', '/api/coupons/validate', {
      coupon_code: earnedCouponCode,
      line_user_id: testLineUserId,
      category: 'bag',
      subtotal_satang: 39900
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.valid, 'Coupon should be valid');
    assert.strictEqual(res.body.discount_satang, 10000);
  });

  // 8. Bag Preorder Checkout with Coupon
  await test('POST /api/orders/confirm applies coupon, discounts expectedAmount, and marks used', async () => {
    // Normal 1 bag (299 THB promo + 0 ship = 299 THB).
    // With 100 THB coupon: total = 199 THB.
    const bagOrderPayload = {
      order: {
        customer_name: 'น้องกริตเตอร์ ทดสอบ',
        customer_phone: '0812345678',
        customer_address: '123/45 สุขุมวิท พระโขนง คลองเตย กรุงเทพฯ 10110',
        patterns: ['Normal Bag #1'],
        pattern_qtys: { 'Normal Bag #1': 1 },
        total_bags: 1,
        original_price: 299,
        coupon_discount: 100,
        total_price: 199, // 299 - 100 coupon
        shipping_cost: 0,
        coupon_code: earnedCouponCode,
        line_user_id: testLineUserId
      },
      slip_data: 'data:image/jpeg;base64,mockslipbag199_' + Date.now(),
      coupon_code: earnedCouponCode,
      line_user_id: testLineUserId
    };

    const res = await request('POST', '/api/orders/confirm', bagOrderPayload);
    assert(res.status === 200 || res.status === 201, 'Status should be 200 or 201, got ' + res.status);
    assert(res.body.order, 'Bag order must be created');
    assert.strictEqual(res.body.order.coupon_code, earnedCouponCode);
    assert.strictEqual(res.body.order.coupon_discount, 100);
    assert.strictEqual(res.body.order.total_price, 199);
  });

  // 9. Single-Use Enforcement
  await test('Reusing the same coupon code is rejected (Double-Spend Prevention)', async () => {
    const res = await request('POST', '/api/coupons/validate', {
      coupon_code: earnedCouponCode,
      line_user_id: testLineUserId,
      category: 'bag',
      subtotal_satang: 39900
    });
    assert.strictEqual(res.status, 400);
    assert(res.body.error.includes('ถูกใช้งาน') || res.body.error.includes('ถูกใช้'), 'Must report coupon is already used');
  });

  // 10. Wallet Query Updates to Used
  await test('GET /api/coupons/my-coupons reflects coupon status as "used"', async () => {
    const res = await request('GET', `/api/coupons/my-coupons?line_user_id=${testLineUserId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.coupons[0].status, 'used');
    assert(res.body.coupons[0].used_in_order_id, 'Must reference the bag order ID');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runE2ETests().catch(err => {
  console.error('Fatal error during E2E tests:', err);
  process.exit(1);
});
