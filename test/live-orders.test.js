/**
 * TDD Suite: Live Order Actions & Integration
 * Seam 1: Order List Aggregation (GET /api/orders)
 * Seam 2: Order Mutation & Fulfillment (PUT & DELETE /api/orders/:id)
 */
const assert = require('assert');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-live-orders-9999';

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
  console.log('========================================');
  console.log('  TEST: Live Order Actions & Integration');
  console.log('========================================\n');

  console.log('── 1. LIVE ORDER LIST & AGGREGATION (GET /api/orders) ──');

  await asyncTest('GET /api/orders rejects unauthenticated with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/orders'), res);
    assert.strictEqual(res._status, 401);
  });

  // Seed test orders: 1 bag order + 1 sticker order
  let bagOrderId = 'HXG-LIVE-BAG-001';
  let stickerOrderId = 'HXG-LIVE-STK-002';

  await asyncTest('Seed live bag order with slip_data and custom ID', async () => {
    const res = createRes();
    const orderPayload = {
      id: bagOrderId,
      customer_name: 'คุณสมใจ',
      customer_phone: '0812345678',
      customer_address: '123/45 ถนนสุขุมวิท กทม.',
      patterns: ['Swan Lake', 'Midnight Star'],
      total_bags: 2,
      total_price: 559,
      shipping_cost: 0,
      slip_data: 'data:image/jpeg;base64,/9j/testslipdata111',
      slip_verified: true,
      status: 1
    };
    await serverHandler(createReq('POST', '/api/orders', orderPayload, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 201);
  });

  await asyncTest('GET /api/orders returns seeded orders with slips and details (Admin)', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/orders', null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const orders = JSON.parse(res._body);
    assert.ok(Array.isArray(orders));
    const found = orders.find(o => o.id === bagOrderId);
    assert.ok(found, 'Seeded bag order should be present in GET /api/orders');
    assert.strictEqual(found.customer_name, 'คุณสมใจ');
    assert.strictEqual(found.slip_verified, true);
    assert.strictEqual(found.slip_data, 'data:image/jpeg;base64,/9j/testslipdata111');
  });

  console.log('\n── 2. ORDER FULFILLMENT & TRACKING MUTATION (PUT /api/orders/:id) ──');

  await asyncTest('PUT /api/orders/:id rejects unauthenticated with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('PUT', `/api/orders/${bagOrderId}`, { status: 4 }), res);
    assert.strictEqual(res._status, 401);
  });

  await asyncTest('PUT /api/orders/:id updates status and tracking_number by custom ID', async () => {
    const res = createRes();
    const updatePayload = {
      status: 4,
      tracking_number: 'TH0123456789EX',
      tracking_carrier: 'Flash Express',
      admin_note: 'จัดส่งแล้วรอบเช้าค่ะ ♡'
    };
    await serverHandler(createReq('PUT', `/api/orders/${bagOrderId}`, updatePayload, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  await asyncTest('GET /api/orders/:id reflects updated status, tracking, and note', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', `/api/orders/${bagOrderId}`, null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const order = JSON.parse(res._body);
    assert.strictEqual(order.id, bagOrderId);
    assert.strictEqual(order.status, 4);
    assert.strictEqual(order.tracking_number, 'TH0123456789EX');
    assert.strictEqual(order.tracking_carrier, 'Flash Express');
  });

  await asyncTest('PUT /api/orders/:id edits customer name, phone, and address', async () => {
    const res = createRes();
    const updatePayload = {
      customer_name: 'คุณสมใจ (แก้ชื่อ)',
      customer_phone: '0899998888',
      customer_address: '999 คอนโดหรู สีลม กทม.'
    };
    await serverHandler(createReq('PUT', `/api/orders/${bagOrderId}`, updatePayload, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);

    // Verify
    const chkRes = createRes();
    await serverHandler(createReq('GET', `/api/orders/${bagOrderId}`, null, ADMIN_COOKIE), chkRes);
    const order = JSON.parse(chkRes._body);
    assert.strictEqual(order.customer_name, 'คุณสมใจ (แก้ชื่อ)');
    assert.strictEqual(order.customer_phone, '0899998888');
    assert.strictEqual(order.customer_address, '999 คอนโดหรู สีลม กทม.');
  });

  console.log('\n── 3. ORDER DELETION (DELETE /api/orders/:id) ──');

  await asyncTest('DELETE /api/orders/:id rejects unauthenticated with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('DELETE', `/api/orders/${bagOrderId}`), res);
    assert.strictEqual(res._status, 401);
  });

  await asyncTest('DELETE /api/orders/:id deletes order by custom order ID', async () => {
    const res = createRes();
    await serverHandler(createReq('DELETE', `/api/orders/${bagOrderId}`, null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  await asyncTest('GET /api/orders/:id returns 404 after order was deleted', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', `/api/orders/${bagOrderId}`, null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 404);
  });

  console.log('\n── 4. STICKER ORDER AGGREGATION & MUTATION ──');

  await asyncTest('Seed legacy sticker order into sticker_orders collection', async () => {
    if (!serverHandler._localMemStore.sticker_orders) {
      serverHandler._localMemStore.sticker_orders = [];
    }
    serverHandler._localMemStore.sticker_orders.push({
      _docId: 'MEM-STK-001',
      id: stickerOrderId,
      type: 'sticker',
      customer_name: 'น้องกาก้า สติกเกอร์',
      customer_phone: '0855554444',
      customer_address: 'เชียงใหม่',
      total_price: 150,
      patterns: ['Sticker-A'],
      status: 1,
      slip_verified: true,
      created_at: new Date().toISOString()
    });
    assert.strictEqual(serverHandler._localMemStore.sticker_orders.length, 1);
  });

  await asyncTest('GET /api/orders includes sticker_orders collection items', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/orders', null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);
    const orders = JSON.parse(res._body);
    const found = orders.find(o => o.id === stickerOrderId);
    assert.ok(found, 'Sticker order should be merged into orders list');
    assert.strictEqual(found.customer_name, 'น้องกาก้า สติกเกอร์');
  });

  await asyncTest('PUT /api/orders/:id updates status and tracking for sticker_orders item', async () => {
    const res = createRes();
    const updatePayload = {
      status: 4,
      tracking_number: 'KERRY999888777',
      tracking_carrier: 'Kerry Express'
    };
    await serverHandler(createReq('PUT', `/api/orders/${stickerOrderId}`, updatePayload, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);

    const chkRes = createRes();
    await serverHandler(createReq('GET', `/api/orders/${stickerOrderId}`, null, ADMIN_COOKIE), chkRes);
    const order = JSON.parse(chkRes._body);
    assert.strictEqual(order.id, stickerOrderId);
    assert.strictEqual(order.status, 4);
    assert.strictEqual(order.tracking_number, 'KERRY999888777');
    assert.strictEqual(order.tracking_carrier, 'Kerry Express');
  });

  await asyncTest('DELETE /api/orders/:id deletes item from sticker_orders collection', async () => {
    const res = createRes();
    await serverHandler(createReq('DELETE', `/api/orders/${stickerOrderId}`, null, ADMIN_COOKIE), res);
    assert.strictEqual(res._status, 200);

    const chkRes = createRes();
    await serverHandler(createReq('GET', `/api/orders/${stickerOrderId}`, null, ADMIN_COOKIE), chkRes);
    assert.strictEqual(chkRes._status, 404);
  });

  console.log('\n========================================');
  console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================');

  if (FAILED > 0) {
    process.exit(1);
  }
}

runTests();
