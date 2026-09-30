/**
 * Comprehensive Test Suite for Customer Info Separation & Phone Search
 */
const assert = require('assert');

// Must set VERCEL before requiring server
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
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'MOCK-TRANS-' + Math.random().toString(36).slice(2, 8),
          date: new Date().toISOString(),
          amount: { amount: body.matchAmount || 207 },
          receiver: { account: { name: { th: 'ณิชกานต์' } } }
        }
      })
    };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

// Mock Firestore in-memory
const inMemoryOrders = {};
const inMemoryStickers = {};

function createMockDb() {
  return {
    orders: inMemoryOrders,
    sticker_orders: inMemoryStickers
  };
}

// Intercept require to mock firebase
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
        const col = inMemoryOrders;
        col[id] = { ...data };
        return { id };
      },
      getDocs: async (q) => {
        let list = Object.keys(inMemoryOrders).map(id => ({
          id,
          data: () => inMemoryOrders[id]
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
        const id = docRef._id;
        const data = inMemoryOrders[id];
        return {
          exists: () => !!data,
          id,
          data: () => data || null
        };
      },
      updateDoc: async (docRef, data) => {
        const id = docRef._id;
        if (inMemoryOrders[id]) {
          Object.assign(inMemoryOrders[id], data);
        }
      },
      setDoc: async (docRef, data) => {
        const id = docRef._id;
        inMemoryOrders[id] = { ...data };
      },
      deleteDoc: async (docRef) => {
        delete inMemoryOrders[docRef._id];
      },
      doc: (db, col, id) => ({ _id: id }),
      query: (col, ...clauses) => ({ col, clauses }),
      orderBy: () => ({}),
      where: (field, op, val) => ({ field, op, val }),
      limit: () => ({})
    };
  }
  return origRequire.apply(this, arguments);
};

const serverHandler = require('../server');
process.env.EASYSLIP_API_KEY = 'test-easyslip-key';

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
  console.log('  TEST: Customer Info Separation & API');
  console.log('========================================\n');

  console.log('── 1. ORDER CREATION WITH SEPARATE FIELDS ──');

  await asyncTest('POST /api/orders with separate customer_name, customer_phone, customer_address', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders', {
      customer_name: 'สมหญิง รักสวย',
      customer_phone: '089-123-4567',
      customer_address: '123/45 ถนนสุขุมวิท กรุงเทพฯ 10110',
      patterns: ['Merilah Pink'],
      pattern_qtys: { 'Merilah Pink': 1 },
      total_bags: 1,
      total_price: 399
    }), res);

    assert.strictEqual(res._status, 201, `Expected 201, got ${res._status}`);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.order.customer_name, 'สมหญิง รักสวย');
    assert.strictEqual(data.order.customer_phone, '089-123-4567');
    assert.strictEqual(data.order.customer_address, '123/45 ถนนสุขุมวิท กรุงเทพฯ 10110');
    assert.strictEqual(data.order.customer_info, 'สมหญิง รักสวย\n089-123-4567\n123/45 ถนนสุขุมวิท กรุงเทพฯ 10110');
  });

  console.log('\n── 2. ORDER CREATION WITH LEGACY CUSTOMER_INFO (BACKWARD COMPAT) ──');

  await asyncTest('POST /api/orders with legacy customer_info splits into fields', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders', {
      customer_info: 'สมชาย ใจดี\n0819876543\n456 หมู่ 7 เชียงใหม่ 50000',
      patterns: ['Blair'],
      pattern_qtys: { 'Blair': 2 },
      total_bags: 2,
      total_price: 798
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.order.customer_name, 'สมชาย ใจดี');
    assert.strictEqual(data.order.customer_phone, '0819876543');
    assert.strictEqual(data.order.customer_address, '456 หมู่ 7 เชียงใหม่ 50000');
    assert.strictEqual(data.order.customer_info, 'สมชาย ใจดี\n0819876543\n456 หมู่ 7 เชียงใหม่ 50000');
  });

  console.log('\n── 3. PHONE TRACKING SEARCH ──');

  await asyncTest('GET /api/track/phone/:phone finds order by clean digits', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/track/phone/0891234567'), res);
    assert.strictEqual(res._status, 200, `Expected 200, got ${res._status}`);
    const data = JSON.parse(res._body);
    assert.strictEqual(Array.isArray(data.orders), true);
    assert.strictEqual(data.orders.length >= 1, true);
    assert.strictEqual(data.orders[0].customer_name, 'สมหญิง รักสวย');
    assert.strictEqual(data.orders[0].customer_phone, '089-123-4567');
  });

  await asyncTest('GET /api/track/phone/:phone finds order when searching with dashes', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/track/phone/089-123-4567'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.orders.length >= 1, true);
    assert.strictEqual(data.orders[0].customer_name, 'สมหญิง รักสวย');
  });

  await asyncTest('GET /api/track/phone/:phone finds legacy order with phone in customer_info', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/track/phone/081-987-6543'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.orders.length >= 1, true);
    assert.strictEqual(data.orders[0].customer_name, 'สมชาย ใจดี');
  });

  await asyncTest('GET /api/track/phone/:phone returns 404 for unknown number', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/track/phone/0800000000'), res);
    assert.strictEqual(res._status, 404);
  });

  console.log('\n── 4. ORDER UPDATE (PUT) WITH SEPARATE FIELDS ──');

  await asyncTest('PUT /api/orders/:id updates separate fields and syncs customer_info', async () => {
    const docId = Object.keys(inMemoryOrders)[0];
    const res = createRes();
    await serverHandler(createReq('PUT', `/api/orders/${docId}`, {
      customer_name: 'สมหญิง แก้ไขชื่อ',
      customer_phone: '089-999-8888',
      customer_address: 'ที่อยู่ใหม่ 999 กทม.'
    }, 'admin_session=test-secret'), res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(inMemoryOrders[docId].customer_name, 'สมหญิง แก้ไขชื่อ');
    assert.strictEqual(inMemoryOrders[docId].customer_phone, '089-999-8888');
    assert.strictEqual(inMemoryOrders[docId].customer_address, 'ที่อยู่ใหม่ 999 กทม.');
    assert.strictEqual(inMemoryOrders[docId].customer_info, 'สมหญิง แก้ไขชื่อ\n089-999-8888\nที่อยู่ใหม่ 999 กทม.');
  });

  console.log('\n── 5. STICKER ORDER CREATION ──');

  await asyncTest('POST /api/sticker/order with separate customer fields', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/sticker/order', {
      order: {
        customer_name: 'น้องส้ม สติกเกอร์',
        customer_phone: '086-555-4433',
        customer_address: 'บ้านเลขที่ 55 นนทบุรี',
        patterns: ['Sticker Set A'],
        pattern_qtys: { 'Sticker Set A': 3 },
        total_price: 207,
        shipping_cost: 0
      },
      slip_data: 'data:image/jpeg;base64,mockslip'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.order.customer_name, 'น้องส้ม สติกเกอร์');
    assert.strictEqual(data.order.customer_phone, '086-555-4433');
    assert.strictEqual(data.order.customer_address, 'บ้านเลขที่ 55 นนทบุรี');
    assert.strictEqual(data.order.customer_info, 'น้องส้ม สติกเกอร์\n086-555-4433\nบ้านเลขที่ 55 นนทบุรี');
    assert.strictEqual(data.order.slip_verified, true);
  });

  console.log('\n── 6. ORDERS CONFIRM WITH SLIP ──');

  await asyncTest('POST /api/orders/confirm with separate fields + slip', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/orders/confirm', {
      order: {
        customer_name: 'คุณพรทิพย์',
        customer_phone: '095-888-7766',
        customer_address: '99/1 ต.รูสะมิแล อ.เมือง จ.ปัตตานี 94000',
        patterns: ['Merilah Pink', 'Blair'],
        pattern_qtys: { 'Merilah Pink': 1, 'Blair': 1 },
        total_bags: 2,
        total_price: 798,
        shipping_cost: 65,
        is_remote: true
      },
      slip_data: 'data:image/jpeg;base64,mockslip2'
    }), res);

    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.order.customer_name, 'คุณพรทิพย์');
    assert.strictEqual(data.order.customer_phone, '095-888-7766');
    assert.strictEqual(data.order.customer_address, '99/1 ต.รูสะมิแล อ.เมือง จ.ปัตตานี 94000');
    assert.strictEqual(data.order.is_remote, true);
    assert.strictEqual(data.order.status, 1);
  });

  console.log('\n── 7. GET /api/track/:id WITH SEPARATE FIELDS ──');

  await asyncTest('GET /api/track/:id returns customer fields', async () => {
    const docId = Object.keys(inMemoryOrders)[0];
    const orderId = inMemoryOrders[docId].id;
    const res = createRes();
    await serverHandler(createReq('GET', `/api/track/${orderId}`), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.id, orderId);
    assert.strictEqual(data.status >= 0, true);
  });

  console.log('\n========================================');
  console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================');

  if (FAILED > 0) {
    process.exit(1);
  }
}

runTests();
