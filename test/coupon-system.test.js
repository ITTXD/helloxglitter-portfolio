/**
 * Comprehensive Automated Test Suite for LINE Coupon Campaign System
 * Run with: node test/coupon-system.test.js
 */

const assert = require('assert');

process.env.VERCEL = '1';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_STORAGE_BUCKET = 'test.appspot.com';
process.env.FIREBASE_MESSAGING_SENDER_ID = '123';
process.env.FIREBASE_APP_ID = '1:123:web:abc';
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret';
process.env.EASYSLIP_API_KEY = 'test-easyslip-key';

// Mock global fetch for EasySlip verification
global.fetch = async (url, opts) => {
  if (url.includes('easyslip.com')) {
    const body = JSON.parse(opts.body || '{}');
    if (body.image === 'INVALID_SLIP') {
      return {
        ok: false,
        status: 400,
        json: async () => ({ status: 400, message: 'Invalid slip' })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'MOCK-CPN-TRANS-' + Math.random().toString(36).slice(2, 8),
          date: new Date().toISOString(),
          amount: { amount: body.matchAmount || 345 },
          receiver: { account: { name: { th: 'ณิชกานต์' } } },
          sender: { bank: { short: 'KBANK' }, account: { name: { th: 'ลูกค้า ทดสอบ' } } }
        }
      })
    };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

// Mock in-memory collections
const inMemoryStore = {
  orders: {},
  coupons: {},
  settings: {},
};

const Module = require('module');
const origRequire = Module.prototype.require;

Module.prototype.require = function(request) {
  if (request === 'firebase/app') {
    return { initializeApp: () => ({ _mockApp: true }) };
  }
  if (request === 'firebase/firestore') {
    return {
      getFirestore: () => ({ _mockDb: true }),
      collection: (db, name) => ({ _colName: name }),
      addDoc: async (colRef, data) => {
        const id = 'mock-' + Math.random().toString(36).slice(2, 8);
        const col = inMemoryStore[colRef._colName] || inMemoryStore.orders;
        col[id] = { ...data };
        return { id };
      },
      getDocs: async (q) => {
        const colName = q.col ? q.col._colName : 'orders';
        const col = inMemoryStore[colName] || inMemoryStore.orders;
        let list = Object.keys(col).map(id => ({
          id,
          data: () => col[id]
        }));
        if (q && q.clauses) {
          const whereClause = q.clauses.find(c => c && c.field);
          if (whereClause) {
            list = list.filter(item => {
              const d = item.data();
              return d && d[whereClause.field] === whereClause.val;
            });
          }
        }
        return {
          empty: list.length === 0,
          docs: list,
          forEach: (cb) => list.forEach(cb)
        };
      },
      getDoc: async (docRef) => {
        const colName = docRef._col || 'orders';
        const col = inMemoryStore[colName] || inMemoryStore.orders;
        const id = docRef._id;
        const data = col[id];
        return {
          exists: () => !!data,
          id,
          data: () => data || null
        };
      },
      setDoc: async (docRef, data) => {
        const colName = docRef._col || 'settings';
        if (!inMemoryStore[colName]) inMemoryStore[colName] = {};
        inMemoryStore[colName][docRef._id] = { ...inMemoryStore[colName][docRef._id], ...data };
      },
      updateDoc: async (docRef, data) => {
        const colName = docRef._col || 'coupons';
        const col = inMemoryStore[colName] || inMemoryStore.orders;
        const id = docRef._id;
        if (col[id]) Object.assign(col[id], data);
      },
      deleteDoc: async (docRef) => {
        const colName = docRef._col || 'orders';
        const col = inMemoryStore[colName] || inMemoryStore.orders;
        delete col[docRef._id];
      },
      doc: (db, col, id) => ({ _col: col, _id: id }),
      query: (col, ...clauses) => ({ col, clauses }),
      orderBy: () => ({}),
      where: (field, op, val) => ({ field, op, val }),
      limit: () => ({})
    };
  }
  return origRequire.apply(this, arguments);
};

const serverHandler = require('../server');
const couponService = require('../coupon-service');

function createReq(method, url, body = null, cookies = '') {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', cookie: cookies },
    on: (event, cb) => {
      if (event === 'data' && body) cb(JSON.stringify(body));
      if (event === 'end') cb();
    }
  };
}

function createRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: '',
    writeHead: (status, headers = {}) => {
      res._status = status;
      res._headers = { ...res._headers, ...headers };
    },
    end: (chunk) => {
      if (chunk) res._body += chunk;
    }
  };
  return res;
}

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${desc}:`, err.message);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${desc}:`, err.message);
    failed++;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('  TEST: LINE Coupon Campaign System');
  console.log('========================================\n');

  // Reset stores
  couponService.inMemoryStore.coupons.clear();
  couponService.inMemoryStore.campaign = { ...couponService.DEFAULT_COUPON_CAMPAIGN };

  console.log('── 1. CAMPAIGN CONFIGURATION (ADMIN & PUBLIC) ──');
  await itAsync('GET /api/coupons/campaign returns active campaign config', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/coupons/campaign'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.campaign.threshold_amount, 300.90);
    assert.strictEqual(data.campaign.discount_amount, 100.00);
  });

  await itAsync('POST /api/coupons/campaign rejects non-admin with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/coupons/campaign', { title: 'New Promo' }), res);
    assert.strictEqual(res._status, 401);
  });

  await itAsync('POST /api/coupons/campaign updates campaign when admin authenticated', async () => {
    const res = createRes();
    const adminCookie = 'admin_session=test-secret';
    await serverHandler(createReq('POST', '/api/coupons/campaign', {
      title: 'ซื้อ Sticker ครบ 250 รับส่วนลด 50',
      thresholdSatang: 25000,
      discountSatang: 5000,
      expiresAt: '2026-12-31T23:59:00+07:00'
    }, adminCookie), res);

    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.campaign.threshold_amount, 250.00);
    assert.strictEqual(data.campaign.discount_amount, 50.00);
    assert.strictEqual(data.campaign.title, 'ซื้อ Sticker ครบ 250 รับส่วนลด 50');
  });

  // Revert campaign to default 300.90 / 100
  couponService.inMemoryStore.campaign = { ...couponService.DEFAULT_COUPON_CAMPAIGN };
  if (inMemoryStore.settings) {
    inMemoryStore.settings['coupon_campaign'] = { ...couponService.DEFAULT_COUPON_CAMPAIGN };
  }

  console.log('\n── 2. LINE AUTHENTICATION & PROFILE ──');
  await itAsync('POST /api/auth/line/verify sets LINE user session and cookie', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/auth/line/verify', {
      line_user_id: 'U_LINE_TEST_1',
      line_display_name: 'คุณสมชาย',
      line_picture_url: 'https://example.com/profile.jpg'
    }), res);

    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.line_user_id, 'U_LINE_TEST_1');
    assert.strictEqual(data.user.line_display_name, 'คุณสมชาย');
    assert(res._headers['Set-Cookie']);
  });

  await itAsync('GET /api/auth/line/me returns current session info', async () => {
    const res = createRes();
    const cookie = 'line_user_id=U_LINE_TEST_1; line_display_name=%E0%B8%84%E0%B8%B8%E0%B8%93%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2';
    await serverHandler(createReq('GET', '/api/auth/line/me', null, cookie), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.authenticated, true);
    assert.strictEqual(data.user.line_user_id, 'U_LINE_TEST_1');
  });

  console.log('\n── 3. COUPON ISSUANCE ON STICKER ORDERS ──');
  await itAsync('Sticker order under threshold (138 THB < 300.90 THB) does NOT issue coupon', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/sticker/order', {
      order: {
        customer_name: 'ลูกค้า สติกเกอร์',
        customer_phone: '0812345678',
        customer_address: 'กทม 10110',
        patterns: [{ name: 'Sticker 1', price: 69, qty: 2 }],
        total_price: 138,
        shipping_cost: 50
      },
      slip_data: 'data:image/jpeg;base64,MOCK_SLIP',
      line_user_id: 'U_LINE_TEST_1'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.coupon, null);
    assert.strictEqual(data.order.coupon_issued, false);
  });

  let issuedCouponCode = '';
  await itAsync('Sticker order >= threshold (345 THB >= 300.90 THB) issues single-use coupon to LINE account', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/sticker/order', {
      order: {
        customer_name: 'ลูกค้า สติกเกอร์',
        customer_phone: '0812345678',
        customer_address: 'กทม 10110',
        patterns: [{ name: 'Sticker Pack', price: 69, qty: 5 }],
        total_price: 345,
        shipping_cost: 50
      },
      slip_data: 'data:image/jpeg;base64,MOCK_SLIP_QUALIFY',
      line_user_id: 'U_LINE_TEST_1',
      line_display_name: 'คุณสมชาย'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert(data.coupon);
    assert(data.coupon.code.startsWith('HXG-CPN-'));
    assert.strictEqual(data.coupon.discount_amount, 100);
    assert.strictEqual(data.coupon.line_user_id, 'U_LINE_TEST_1');
    assert.strictEqual(data.order.coupon_issued, true);
    assert.strictEqual(data.order.coupon_code, data.coupon.code);
    issuedCouponCode = data.coupon.code;
  });

  await itAsync('GET /api/coupons/my-coupons displays the active coupon in wallet', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/coupons/my-coupons?line_user_id=U_LINE_TEST_1'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.coupons.length, 1);
    assert.strictEqual(data.coupons[0].code, issuedCouponCode);
    assert.strictEqual(data.coupons[0].status, 'active');
  });

  console.log('\n── 4. COUPON VALIDATION & REDEMPTION ON BAG PREORDER ──');
  await itAsync('POST /api/coupons/validate returns 100 THB discount for valid coupon', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/coupons/validate', {
      code: issuedCouponCode,
      line_user_id: 'U_LINE_TEST_1',
      items: [{ type: 'bag', name: 'Merilah Pink', price: 399, qty: 1 }],
      subtotal: 399
    }), res);

    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.discount_amount, 100);
  });

  await itAsync('POST /api/coupons/validate rejects if belonging to different LINE user', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/coupons/validate', {
      code: issuedCouponCode,
      line_user_id: 'U_OTHER_USER',
      items: [{ type: 'bag', name: 'Merilah Pink', price: 399, qty: 1 }],
      subtotal: 399
    }), res);

    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert(data.error.includes('ผูกกับบัญชี LINE อื่น'));
  });

  await itAsync('POST /api/orders/confirm applies coupon discount and marks coupon as used', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders/confirm', {
      order: {
        customer_name: 'คุณกระเป๋า',
        customer_phone: '0891234567',
        customer_address: 'กรุงเทพ 10110',
        patterns: [{ type: 'bag', name: 'Blair', price: 399, qty: 1 }],
        total_price: 399,
        coupon_code: issuedCouponCode,
        line_user_id: 'U_LINE_TEST_1'
      },
      slip_data: 'data:image/jpeg;base64,MOCK_SLIP_BAG'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    // 399 - 100 = 299 THB
    assert.strictEqual(data.order.total_price, 299);
    assert.strictEqual(data.order.coupon_code, issuedCouponCode);
    assert.strictEqual(data.order.coupon_discount, 100);

    // Verify coupon is now 'used'
    const couponObj = await couponService.findCouponByCode(null, issuedCouponCode);
    assert.strictEqual(couponObj.status, 'used');
    assert.strictEqual(couponObj.used_in_order_id, data.order.id);
  });

  await itAsync('Second attempt to redeem the used coupon is rejected (single-use enforced)', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders/confirm', {
      order: {
        customer_name: 'คุณกระเป๋า',
        customer_phone: '0891234567',
        customer_address: 'กรุงเทพ 10110',
        patterns: [{ type: 'bag', name: 'Blair', price: 399, qty: 1 }],
        total_price: 399,
        coupon_code: issuedCouponCode,
        line_user_id: 'U_LINE_TEST_1'
      },
      slip_data: 'data:image/jpeg;base64,MOCK_SLIP_BAG_2'
    }), res);

    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert(data.error.includes('ถูกใช้ไปแล้ว'));
  });

  console.log('\n── 5. EDGE CASES & POST-PURCHASE CLAIM ──');
  await itAsync('Expired coupon is rejected by validate API', async () => {
    const expiredCoupon = await couponService.issueCouponForStickerOrder({
      db: null,
      orderId: 'HXG-EXP-ORDER-1',
      lineUserId: 'U_LINE_TEST_1',
    });
    expiredCoupon.expires_at = '2020-01-01T00:00:00Z'; // past
    couponService.inMemoryStore.coupons.set(expiredCoupon.code, expiredCoupon);

    const res = createRes();
    await serverHandler(createReq('POST', '/api/coupons/validate', {
      code: expiredCoupon.code,
      line_user_id: 'U_LINE_TEST_1',
      items: [{ type: 'bag', name: 'Blair', price: 399, qty: 1 }],
      subtotal: 399
    }), res);

    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert(data.error.includes('หมดอายุ'));
  });

  await itAsync('Cart without Bag is rejected for Bag-exclusive coupon', async () => {
    const freshCoupon = await couponService.issueCouponForStickerOrder({
      db: null,
      orderId: 'HXG-STK-BAG-ONLY',
      lineUserId: 'U_LINE_TEST_1',
    });

    const res = createRes();
    await serverHandler(createReq('POST', '/api/coupons/validate', {
      code: freshCoupon.code,
      line_user_id: 'U_LINE_TEST_1',
      items: [{ type: 'sticker', name: 'Sticker 1', price: 69, qty: 1 }],
      subtotal: 69
    }), res);

    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert(data.error.includes('หมวดกระเป๋าผ้า'));
  });

  await itAsync('POST /api/orders (standard order) also accepts and locks coupon', async () => {
    const freshCoupon = await couponService.issueCouponForStickerOrder({
      db: null,
      orderId: 'HXG-STK-FOR-STD-ORDER',
      lineUserId: 'U_LINE_TEST_1',
    });

    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders', {
      customer_name: 'คุณกระเป๋า Standard',
      customer_phone: '0891234567',
      customer_address: 'กรุงเทพ 10110',
      patterns: [{ type: 'bag', name: 'Blair', price: 399, qty: 1 }],
      total_price: 399,
      coupon_code: freshCoupon.code,
      line_user_id: 'U_LINE_TEST_1'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.order.total_price, 299);
    assert.strictEqual(data.order.coupon_code, freshCoupon.code);

    // Verify it is now used
    const c = await couponService.findCouponByCode(null, freshCoupon.code);
    assert.strictEqual(c.status, 'used');
  });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
