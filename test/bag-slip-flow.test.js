/**
 * TDD Suite: Bag Slip Verification & Admin Firestore Persistence Flow
 * 
 * Tests:
 * 1. POST /api/orders/verify-slip (Green button endpoint)
 *    - Rejects missing slip data
 *    - Verifies slip against EasySlip
 *    - Returns signed verify_token on success
 * 2. POST /api/orders/confirm (Save to Firestore for /admin)
 *    - Uses verify_token or verifies slip
 *    - Allocates sequential queue_no (HLG-XXX)
 *    - Persists order in Firestore 'orders' collection
 *    - Sets status: 1 (confirmed), slip_verified: true
 *    - Order is immediately visible in GET /api/orders (admin endpoint)
 */
const assert = require('assert');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-bag-flow-9999';
process.env.ALLOW_MOCK_SLIP = 'true';
process.env.NODE_ENV = 'test';

const serverHandler = require('../server');

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
    _body: null,
    writeHead: (status, headers) => {
      res._status = status;
      res._headers = { ...res._headers, ...headers };
    },
    end: (body) => {
      res._body = body;
    }
  };
  return res;
}

let PASSED = 0;
let FAILED = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    PASSED++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    FAILED++;
    console.error(`  ❌ ${name}:`, err.message);
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('  TEST: Bag Slip Verification & Firestore /admin Flow');
  console.log('========================================================\n');

  console.log('── 1. POST /api/orders/verify-slip (Green Check Button) ──');

  await asyncTest('POST /api/orders/verify-slip rejects missing slip_data with 400', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders/verify-slip', { amount: 590, order_id: 'HXG-TEST-01' }), res);
    assert.strictEqual(res._status, 400);
    const body = JSON.parse(res._body);
    assert.match(body.error, /สลิป/);
  });

  let validVerifyToken = null;
  let validVerifyDetails = null;

  await asyncTest('POST /api/orders/verify-slip successfully verifies mock slip and returns token', async () => {
    const res = createRes();
    const payload = {
      slip_data: 'data:image/jpeg;base64,mockslip_bag_order_123',
      amount: 590,
      order_id: 'HXG-TEST-BAG-01'
    };
    await serverHandler(createReq('POST', '/api/orders/verify-slip', payload), res);
    assert.strictEqual(res._status, 200);
    const body = JSON.parse(res._body);
    assert.strictEqual(body.success, true);
    assert.ok(body.verify_token, 'Must return signed verify_token');
    assert.ok(body.verifyDetails, 'Must return verifyDetails');
    assert.strictEqual(body.verifyDetails.amount, 590);
    validVerifyToken = body.verify_token;
    validVerifyDetails = body.verifyDetails;
  });

  console.log('\n── 2. POST /api/orders/confirm (Persistence & Queue Generation) ──');

  let confirmedOrderId = 'HXG-TEST-BAG-01';
  let assignedQueueNo = null;

  await asyncTest('POST /api/orders/confirm saves bag order to Firestore with queue_no and status 1', async () => {
    const res = createRes();
    const payload = {
      order: {
        id: confirmedOrderId,
        customer_name: 'คุณณิชาภัทร',
        customer_phone: '0891234567',
        customer_address: '99/1 ซอยอารีย์ พญาไท กทม. 10400',
        items: [
          { name: 'Barbie Tote Bag', variant: 'Pink', qty: 1, price: 590 }
        ],
        total_price: 590,
        shipping_cost: 0
      },
      slip_data: 'data:image/jpeg;base64,mockslip_bag_order_123',
      verify_token: validVerifyToken
    };

    await serverHandler(createReq('POST', '/api/orders/confirm', payload), res);
    assert.strictEqual(res._status, 201);
    const body = JSON.parse(res._body);
    assert.strictEqual(body.success, true);
    assert.ok(body.order, 'Must return saved order');
    assert.strictEqual(body.order.id, confirmedOrderId);
    assert.ok(body.order.queue_no, 'Must assign queue_no');
    assert.match(body.order.queue_no, /^HLG-\d{3}$/, 'queue_no format must be HLG-XXX');
    assert.strictEqual(body.order.status, 1, 'Status must be 1 (confirmed queue)');
    assert.strictEqual(body.order.slip_verified, true, 'slip_verified must be true');
    assert.ok(body.order._docId, 'Must have Firestore _docId');
    assert.deepStrictEqual(body.order.patterns, ['Barbie Tote Bag (Pink)'], 'Auto-derives patterns from items');
    assignedQueueNo = body.order.queue_no;
  });

  await asyncTest('Sequential queue allocation increments properly on next order', async () => {
    const res = createRes();
    const payload = {
      order: {
        id: 'HXG-TEST-BAG-02',
        customer_name: 'คุณวิภาดา',
        customer_phone: '0812223344',
        customer_address: '12/3 ถนนสีลม บางรัก กทม. 10500',
        patterns: ['Gingham Bag'],
        total_price: 490,
        shipping_cost: 0
      },
      slip_data: 'data:image/jpeg;base64,mockslip_bag_order_456'
    };

    await serverHandler(createReq('POST', '/api/orders/confirm', payload), res);
    assert.strictEqual(res._status, 201);
    const body = JSON.parse(res._body);
    assert.strictEqual(body.success, true);
    const prevNum = parseInt(assignedQueueNo.replace('HLG-', ''), 10);
    const nextNum = parseInt(body.order.queue_no.replace('HLG-', ''), 10);
    assert.strictEqual(nextNum, prevNum + 1, 'Next queue_no must increment sequentially');
  });

  console.log('\n── 3. GET /api/orders (Visible in /admin) ──');

  await asyncTest('GET /api/orders returns confirmed bag orders with queue_no, slip, and customer details', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/orders', null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const orders = JSON.parse(res._body);
    assert.ok(Array.isArray(orders));
    
    const foundOrder = orders.find(o => o.id === confirmedOrderId);
    assert.ok(foundOrder, `Order ${confirmedOrderId} must be present in GET /api/orders for /admin`);
    assert.strictEqual(foundOrder.queue_no, assignedQueueNo);
    assert.strictEqual(foundOrder.status, 1);
    assert.strictEqual(foundOrder.slip_verified, true);
    assert.ok(foundOrder.slip_data, 'Slip image data must be present for admin review');
    assert.strictEqual(foundOrder.customer_name, 'คุณณิชาภัทร');
    assert.strictEqual(foundOrder.customer_phone, '0891234567');
  });

  console.log('\n── 4. FRONTEND UI & SCRIPT VERIFICATION (public/index.html) ──');

  await asyncTest('public/index.html includes green slip check button and verified flow', () => {
    const fs = require('fs');
    const html = fs.readFileSync('public/index.html', 'utf8');

    assert.ok(html.includes('id="hrxVerifySlipBtn"'), 'Must have hrxVerifySlipBtn');
    assert.ok(html.includes('#16a34a'), 'Must have green styling #16a34a for slip check button');
    assert.ok(html.includes('window.hrxVerifySlip'), 'Must define window.hrxVerifySlip');
    assert.ok(html.includes('/api/orders/verify-slip'), 'Must call /api/orders/verify-slip');
    assert.ok(html.includes('/api/orders/confirm'), 'Must call /api/orders/confirm');
    assert.ok(html.includes('!o.slip_verified'), 'Must gate confirmation on slip_verified');
    assert.ok(html.includes('hrx-slip-success'), 'Must render slip success box');
  });

  console.log('\n========================================================');
  console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================================\n');

  if (FAILED > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
