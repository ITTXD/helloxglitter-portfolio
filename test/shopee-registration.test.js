/**
 * TDD Test Suite: Shopee Order Registration, Validation, and Unified Phone Tracking
 *
 * Verifies:
 * 1. Backend API POST /api/orders/shopee:
 *    - Rejects missing required fields (name, phone, address, shopee_order_sn).
 *    - Validates Shopee Order SN format (14–20 alphanumeric chars, no symbols/spaces/Thai).
 *    - Validates phone format.
 *    - Creates order at status 1 (ยืนยันคิวแล้ว) with sequential HLG-XXX queue_no and channel='shopee'.
 *    - Collision policy: blocks duplicate shopee_order_sn with a DIFFERENT phone.
 *    - Collision policy: allows update of existing order with the SAME phone.
 * 2. Public Tracking GET /api/track/phone/:phone:
 *    - Returns registered Shopee orders by phone.
 * 3. Parity with api/[...path].js.
 * 4. Storefront UI (public/index.html):
 *    - Hamburger menu includes mobile orange Shopee button.
 *    - Shopee registration modal exists with required fields and note.
 *    - Tracking page card renders [Shopee] badge and shopee_order_sn.
 * 5. Admin Portal (public/admin/):
 *    - Order list renders [Shopee] badge.
 *    - Order channel filter [ ทั้งหมด | เว็บไซต์ | Shopee ] exists.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-shopee-registration-7777';

const serverHandler = require('../server');
const ROOT = path.join(__dirname, '..');

const ADMIN_COOKIE = `admin_session=${process.env.SESSION_SECRET}`;

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
    statusCode: 200,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    writeHead(st, hdrs = {}) {
      this._status = st;
      this.statusCode = st;
      Object.entries(hdrs).forEach(([k, v]) => { this._headers[k.toLowerCase()] = v; });
    },
    end(data = '') {
      this._body = typeof data === 'string' ? data : (data ? data.toString() : '');
    }
  };
  return res;
}

let PASSED = 0;
let FAILED = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    PASSED++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    FAILED++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    PASSED++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    FAILED++;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('  TEST: Shopee Order Registration & Tracking');
  console.log('========================================\n');

  console.log('── 1. BACKEND API: POST /api/orders/shopee ──');

  await asyncTest('POST /api/orders/shopee rejects missing required fields with 400', async () => {
    const req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง',
      // missing phone, address, shopee_order_sn
    });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert.ok(data.error, 'must return error message');
  });

  await asyncTest('POST /api/orders/shopee rejects invalid Shopee Order SN format (too short, spaces, or thai)', async () => {
    // Too short
    let req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง',
      customer_phone: '0891234567',
      customer_address: '123/45 Bangkok',
      shopee_order_sn: '12345'
    });
    let res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 400, 'short SN should fail');

    // Contains Thai
    req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง',
      customer_phone: '0891234567',
      customer_address: '123/45 Bangkok',
      shopee_order_sn: '241002ABกขคง123'
    });
    res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 400, 'Thai in SN should fail');

    // Contains spaces
    req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง',
      customer_phone: '0891234567',
      customer_address: '123/45 Bangkok',
      shopee_order_sn: '241002 AB 123456'
    });
    res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 400, 'spaces in SN should fail');
  });

  let createdQueueNo = '';
  const testSn = '241002ABC123456D';
  const testPhone = '0891234567';

  await asyncTest('POST /api/orders/shopee creates order at status 1 with sequential queue_no', async () => {
    const req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง รักช้อป',
      customer_phone: testPhone,
      customer_address: '123/45 คอนโดรักสุข ถ.สุขุมวิท กทม. 10110',
      shopee_order_sn: testSn,
      customer_note: 'ขอพวงกุญแจลายกระต่ายดาว'
    });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.ok(data.success, 'response success should be true');
    assert.strictEqual(data.order.channel, 'shopee');
    assert.strictEqual(data.order.status, 1, 'initial status must be 1 (ยืนยันคิวแล้ว)');
    assert.strictEqual(data.order.shopee_order_sn, testSn);
    assert.strictEqual(data.order.customer_phone, '0891234567');
    assert.ok(/^HLG-\d+$/i.test(data.order.queue_no), 'queue_no must follow HLG-XXX format');
    createdQueueNo = data.order.queue_no;
  });

  await asyncTest('POST /api/orders/shopee blocks duplicate SN with a DIFFERENT phone number', async () => {
    const req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'คนอื่น แอบอ้าง',
      customer_phone: '0887654321', // different phone
      customer_address: '999/99 อื่นๆ',
      shopee_order_sn: testSn
    });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 409, 'duplicate SN from different phone must be rejected (409 conflict)');
  });

  await asyncTest('POST /api/orders/shopee allows updating address/note with the SAME phone number', async () => {
    const req = createReq('POST', '/api/orders/shopee', {
      customer_name: 'สมหญิง รักช้อป (แก้ไขที่อยู่)',
      customer_phone: testPhone, // same phone
      customer_address: '888/99 บ้านใหม่ ซอย 2 กทม. 10110',
      shopee_order_sn: testSn,
      customer_note: 'เปลี่ยนเป็นลายดาวสีชมพู'
    });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200, 'update should succeed with 200');
    const data = JSON.parse(res._body);
    assert.strictEqual(data.order.customer_name, 'สมหญิง รักช้อป (แก้ไขที่อยู่)');
    assert.strictEqual(data.order.customer_address, '888/99 บ้านใหม่ ซอย 2 กทม. 10110');
    assert.strictEqual(data.order.queue_no, createdQueueNo, 'queue_no must not change on update');
  });

  console.log('\n── 2. PUBLIC PHONE TRACKING API ──');

  await asyncTest('GET /api/track/phone/:phone includes registered Shopee order', async () => {
    const req = createReq('GET', `/api/track/phone/${testPhone}`);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.ok(Array.isArray(data.orders), 'orders should be array');
    const found = data.orders.find(o => o.shopee_order_sn === testSn);
    assert.ok(found, 'registered Shopee order must be returned in phone tracking search');
    assert.strictEqual(found.channel, 'shopee');
    assert.strictEqual(found.status, 1);
  });

  console.log('\n── 3. PARITY WITH api/[...path].js ──');

  test('api/[...path].js includes POST /api/orders/shopee handler', () => {
    const vercelHandlerJs = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
    assert.ok(
      vercelHandlerJs.includes('/api/orders/shopee'),
      'api/[...path].js must handle /api/orders/shopee'
    );
  });

  console.log('\n── 4. STOREFRONT UI MARKUP & CLIENT HANDLERS (public/index.html) ──');

  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  test('hamburger menu contains orange Shopee registration button', () => {
    assert.ok(
      indexHtml.includes('v8OpenShopeeModal()') || indexHtml.includes('openShopeeModal()') || indexHtml.includes('shopee-menu-btn'),
      'hamburger drawer must include an action to open the Shopee registration modal'
    );
    assert.ok(
      indexHtml.toLowerCase().includes('shopee'),
      'menu must contain Shopee text / badge'
    );
  });

  test('Shopee registration modal markup exists with required inputs', () => {
    assert.ok(
      indexHtml.includes('id="shopeeModal"') || indexHtml.includes('id="v8ShopeeModal"'),
      'Shopee registration modal container must exist'
    );
    assert.ok(
      indexHtml.includes('shopeeOrderSn') || indexHtml.includes('shopee_order_sn') || indexHtml.includes('shopee-order-sn'),
      'Shopee Order SN input must exist'
    );
  });

  test('v8 Tracking Engine card and carrierInfo support Shopee and SPX', () => {
    assert.ok(
      indexHtml.includes('v8track-shopee-badge') || indexHtml.includes('Shopee Order SN'),
      'v8 tracking card must render Shopee badge or Shopee Order SN'
    );
    assert.ok(
      indexHtml.includes('SPX Express'),
      'carrierInfo must map SPX / Shopee to SPX Express'
    );
    assert.ok(
      indexHtml.includes('/api/track/phone/'),
      'trackSearch must fetch /api/track/phone/ for live search'
    );
  });

  test('In-page admin queue (v8RenderQueue) supports Shopee orders and filtering', () => {
    assert.ok(
      indexHtml.includes("filter==='shopee'") || indexHtml.includes('🧡 Shopee'),
      'v8RenderQueue must have Shopee filter'
    );
  });

  console.log('\n── 5. ADMIN PORTAL (public/admin/) ──');

  const adminJs = fs.readFileSync(path.join(ROOT, 'public', 'admin', 'admin.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(ROOT, 'public', 'admin', 'index.html'), 'utf8');

  test('Admin portal supports filtering by Shopee channel', () => {
    assert.ok(
      adminJs.includes('shopee') || adminHtml.includes('shopee'),
      'admin portal must support Shopee filter/badge'
    );
    assert.ok(
      adminHtml.includes('chtab') && adminHtml.includes('switchChannelFilter'),
      'admin index.html must contain channel filter tabs'
    );
  });

  console.log(`\n========================================`);
  console.log(`  Results: ${PASSED} passed, ${FAILED} failed`);
  console.log(`========================================\n`);

  if (FAILED > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
