/**
 * Tests for server.js API routes
 */

// Must set VERCEL before requiring server to prevent listen()
process.env.VERCEL = '1';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_STORAGE_BUCKET = 'test.appspot.com';
process.env.FIREBASE_MESSAGING_SENDER_ID = '123';
process.env.FIREBASE_APP_ID = '1:123:web:abc';
process.env.ADMIN_PASSWORD = 'testpass';
process.env.SESSION_SECRET = 'test-session-secret';

// Mock firebase/app — return a truthy object so db is initialized
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({ _initialized: true })),
}));

// Mock firebase/firestore
const mockDocs = {};
let mockCollectionData = [];

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({ _mockDb: true })),
  collection: jest.fn(),
  addDoc: jest.fn(async (col, data) => {
    const id = 'mock-doc-' + Object.keys(mockDocs).length;
    mockDocs[id] = { ...data };
    return { id };
  }),
  getDocs: jest.fn(async () => ({
    empty: mockCollectionData.length === 0,
    docs: mockCollectionData.map((d, i) => ({
      id: d._docId || 'doc-' + i,
      data: () => d,
    })),
    forEach: function(cb) {
      this.docs.forEach(d => cb(d));
    },
  })),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  doc: jest.fn((db, col, id) => ({ _id: id })),
  getDoc: jest.fn(async (ref) => {
    const key = ref._id;
    if (mockDocs[key]) {
      return { exists: () => true, id: key, data: () => mockDocs[key] };
    }
    return { exists: () => false };
  }),
  updateDoc: jest.fn(async (ref, data) => {
    if (mockDocs[ref._id]) Object.assign(mockDocs[ref._id], data);
  }),
  deleteDoc: jest.fn(async (ref) => {
    delete mockDocs[ref._id];
  }),
}));

const handler = require('../server');

function createReq(method, url, body = null, cookies = '') {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', cookie: cookies },
    on: jest.fn((event, cb) => {
      if (event === 'data' && body) cb(JSON.stringify(body));
      if (event === 'end') cb();
    }),
  };
}

function createRes() {
  const res = {
    _status: 200, _headers: {}, _body: null,
    writeHead: jest.fn((status, headers) => { res._status = status; res._headers = { ...res._headers, ...headers }; }),
    end: jest.fn((body) => { res._body = body; }),
  };
  return res;
}

beforeEach(() => {
  Object.keys(mockDocs).forEach(k => delete mockDocs[k]);
  mockCollectionData = [];
});

describe('POST /api/login', () => {
  test('success with correct password', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/login', { password: 'testpass' }), res);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body).success).toBe(true);
    expect(res._headers['Set-Cookie']).toContain('admin_session=');
  });
  test('401 with wrong password', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/login', { password: 'wrong' }), res);
    expect(res._status).toBe(401);
    expect(JSON.parse(res._body).error).toContain('รหัสผ่านไม่ถูกต้อง');
  });
  test('401 with no password', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/login', {}), res);
    expect(res._status).toBe(401);
  });
});

describe('POST /api/logout', () => {
  test('clears session cookie', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/logout'), res);
    expect(res._status).toBe(200);
    expect(res._headers['Set-Cookie']).toContain('Max-Age=0');
  });
});

describe('GET /api/check-auth', () => {
  test('authenticated with valid session', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/check-auth', null, 'admin_session=test-session-secret'), res);
    expect(JSON.parse(res._body).authenticated).toBe(true);
  });
  test('not authenticated without session', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/check-auth'), res);
    expect(JSON.parse(res._body).authenticated).toBe(false);
  });
  test('not authenticated with wrong session', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/check-auth', null, 'admin_session=wrong'), res);
    expect(JSON.parse(res._body).authenticated).toBe(false);
  });
});

describe('POST /api/orders', () => {
  test('creates order with valid data', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test\n099-123-4567',
      patterns: ['Merilah Pink'],
      pattern_qtys: { 'Merilah Pink': 1 },
      total_bags: 1, total_price: 299, shipping_cost: 50,
    }), res);
    expect(res._status).toBe(201);
    const data = JSON.parse(res._body);
    expect(data.success).toBe(true);
    expect(data.order.id).toMatch(/^HXG-\d{8}-[A-Z0-9]{4}$/);
    expect(data.order.status).toBe(0);
  });
  test('400 with missing customer_info', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', { patterns: ['Merilah Pink'] }), res);
    expect(res._status).toBe(400);
  });
  test('400 with empty patterns', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', { customer_info: 'Test', patterns: [] }), res);
    expect(res._status).toBe(400);
  });
  test('400 with null patterns', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', { customer_info: 'Test', patterns: null }), res);
    expect(res._status).toBe(400);
  });
  test('default shipping_cost is 50', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test', patterns: ['Merilah Pink'],
    }), res);
    expect(JSON.parse(res._body).order.shipping_cost).toBe(50);
  });
  test('order ID has no ambiguous chars (I,O,0,1)', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test', patterns: ['Merilah Pink'],
    }), res);
    const suffix = JSON.parse(res._body).order.id.split('-')[2];
    expect(suffix).not.toMatch(/[IO01]/);
  });
  test('note_status = on when note is provided', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test', patterns: ['Merilah Pink'], note: 'กรุณาส่งเร็วๆ',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('on');
  });
  test('note_status = off when note is empty', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test', patterns: ['Merilah Pink'], note: '',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('off');
  });
  test('note_status = off when note is not provided', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders', {
      customer_info: 'Test', patterns: ['Merilah Pink'],
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('off');
  });
});

describe('POST /api/orders/confirm', () => {
  test('creates order + slip in one request', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders/confirm', {
      order: {
        id: 'HXG-TEST-CONFIRM',
        customer_info: 'Test\n099-123-4567',
        patterns: ['Merilah Pink'],
        pattern_qtys: { 'Merilah Pink': 1 },
        total_bags: 1, total_price: 299, shipping_cost: 50,
      },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(res._status).toBe(201);
    const data = JSON.parse(res._body);
    expect(data.success).toBe(true);
    expect(data.order.status).toBe(1);
    expect(data.order.slip_data).toBe('data:image/jpeg;base64,...');
  });

  test('400 without order data', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders/confirm', { slip_data: 'img' }), res);
    expect(res._status).toBe(400);
  });

  test('400 without slip_data', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders/confirm', {
      order: { customer_info: 'Test', patterns: ['Merilah Pink'] },
    }), res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('สลีป');
  });
  test('note_status = on when note is provided', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders/confirm', {
      order: { customer_info: 'Test', patterns: ['Merilah Pink'], note: 'ฝากลายสวยๆ' },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('on');
  });
  test('note_status = off when no note', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/orders/confirm', {
      order: { customer_info: 'Test', patterns: ['Merilah Pink'] },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('off');
  });
});

describe('GET /api/orders (admin)', () => {
  test('401 without auth', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/orders'), res);
    expect(res._status).toBe(401);
  });
  test('returns orders with auth', async () => {
    mockCollectionData = [{ id: 'HXG-001', status: 0 }];
    const res = createRes();
    await handler(createReq('GET', '/api/orders', null, 'admin_session=test-session-secret'), res);
    expect(res._status).toBe(200);
    expect(Array.isArray(JSON.parse(res._body))).toBe(true);
  });
});

describe('GET /api/orders/:id (admin)', () => {
  test('401 without auth', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/orders/some-id'), res);
    expect(res._status).toBe(401);
  });
});

describe('PUT /api/orders/:id', () => {
  test('401 without auth', async () => {
    const res = createRes();
    await handler(createReq('PUT', '/api/orders/some-id', { status: 1 }), res);
    expect(res._status).toBe(401);
  });
  test('note_status = on when note is set via PUT', async () => {
    mockCollectionData = [{ _docId: 'doc-1', id: 'HXG-PUT', note: '', note_status: 'off', status: 0 }];
    mockDocs['doc-1'] = { _docId: 'doc-1', id: 'HXG-PUT', note: '', note_status: 'off', status: 0 };
    const res = createRes();
    await handler(createReq('PUT', '/api/orders/HXG-PUT', { note: 'แก้หมายเหตุ' }, 'admin_session=test-session-secret'), res);
    expect(res._status).toBe(200);
    expect(mockDocs['doc-1'].note_status).toBe('on');
  });
  test('note_status = off when note is cleared via PUT', async () => {
    mockCollectionData = [{ _docId: 'doc-2', id: 'HXG-PUT2', note: 'เก่า', note_status: 'on', status: 0 }];
    mockDocs['doc-2'] = { _docId: 'doc-2', id: 'HXG-PUT2', note: 'เก่า', note_status: 'on', status: 0 };
    const res = createRes();
    await handler(createReq('PUT', '/api/orders/HXG-PUT2', { note: '' }, 'admin_session=test-session-secret'), res);
    expect(res._status).toBe(200);
    expect(mockDocs['doc-2'].note_status).toBe('off');
  });
});

describe('DELETE /api/orders/:id', () => {
  test('401 without auth', async () => {
    const res = createRes();
    await handler(createReq('DELETE', '/api/orders/some-id'), res);
    expect(res._status).toBe(401);
  });
});

describe('POST /api/orders/:id/slip-public', () => {
  test('400 without slip_data', async () => {
    mockCollectionData = [{ _docId: 'doc-1', id: 'HXG-TEST', total_price: 299, shipping_cost: 50, status: 0 }];
    const res = createRes();
    await handler(createReq('POST', '/api/orders/HXG-TEST/slip-public', {}), res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('ไม่มีข้อมูลสลีป');
  });

  test('saves slip and sets status=1 on success', async () => {
    mockCollectionData = [{ _docId: 'doc-1', id: 'HXG-TEST', total_price: 299, shipping_cost: 50, status: 0 }];
    const res = createRes();
    await handler(createReq('POST', '/api/orders/HXG-TEST/slip-public', { slip_data: 'data:image/jpeg;base64,...' }), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.success).toBe(true);
    expect(data.verified).toBe(true);
  });
});

describe('GET /api/stats', () => {
  test('401 without auth', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/stats'), res);
    expect(res._status).toBe(401);
  });
});

describe('GET /api/track/phone/:phone', () => {
  function seedOrder(customerInfo, overrides = {}) {
    mockCollectionData.push({
      id: overrides.id || 'HXG-TEST-0001',
      customer_info: customerInfo,
      status: 3,
      patterns: overrides.patterns || ['Magic Pegasus'],
      qty: 1,
      total_bags: 1,
      total_price: 299,
      created_at: '2026-06-20T00:00:00.000Z',
      note: '',
      tracking_number: overrides.tracking_number || '',
      tracking_carrier: overrides.tracking_carrier || '',
      shipping_cost: 50,
      is_remote: false,
      _docId: overrides.docId || 'doc-' + Math.random(),
      ...overrides,
    });
  }

  test('finds order by exact phone number', async () => {
    seedOrder('John Doe\n123 Main St\nเบอร์ 0867986758');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0867986758'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].id).toBe('HXG-TEST-0001');
  });

  test('does NOT match digits inside address', async () => {
    seedOrder('Jane Doe\n402 ถนนเจริญรัถ10 แขวงคลองต้นไทร กรุงเทพ 10600\nเบอร์ 0891234567');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/10600'), res);
    expect(res._status).toBe(404);
  });

  test('does NOT match partial digits from longer number', async () => {
    seedOrder('Bob Smith\n999 Road\nโทร 08888888888');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0888888888'), res);
    expect(res._status).toBe(404);
  });

  test('finds only orders with matching phone, not all orders', async () => {
    seedOrder('Alice\n100 Main\nเบอร์ 0811111111', { id: 'HXG-ALICE-01' });
    seedOrder('Bob\n200 Oak\nเบอร์ 0822222222', { id: 'HXG-BOB-01' });
    seedOrder('Charlie\n300 Pine\nเบอร์ 0811111111', { id: 'HXG-CHARLIE-01' });
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0811111111'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(2);
    expect(data.orders.map(o => o.id)).toEqual(expect.arrayContaining(['HXG-ALICE-01', 'HXG-CHARLIE-01']));
  });

  test('404 for non-existent phone', async () => {
    seedOrder('Alice\n100 Main\nเบอร์ 0811111111');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0999999999'), res);
    expect(res._status).toBe(404);
    const data = JSON.parse(res._body);
    expect(data.error).toContain('ไม่พบ');
  });

  test('handles phone with dashes in stored data', async () => {
    seedOrder('Test User\n123 Road\n099-123-4567');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0991234567'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(1);
  });

  test('handles phone with spaces in stored data', async () => {
    seedOrder('Test User\n456 Lane\n089 123 4567');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0891234567'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(1);
  });

  test('phone followed by address digits on next line', async () => {
    seedOrder('นายรชตวิทย์ มีชัย\n0614566686 \n65หมู่1ตประจันตคาม อ ปราจีนบุรี 25130');
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0614566686'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(1);
  });

  test('filters by phone from multiple orders with different phones', async () => {
    seedOrder('One\nเบอร์ 0611111111', { id: 'HXG-ONE-01' });
    seedOrder('Two\nเบอร์ 0622222222', { id: 'HXG-TWO-01' });
    seedOrder('Three\nเบอร์ 0633333333', { id: 'HXG-THREE-01' });
    const res = createRes();
    await handler(createReq('GET', '/api/track/phone/0622222222'), res);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].id).toBe('HXG-TWO-01');
  });
});

describe('GET /api/track/:id', () => {
  test('returns 404 for nonexistent order', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/track/NONEXISTENT'), res);
    expect(res._status).toBe(404);
  });
});

describe('static file routing', () => {
  test('/admin redirects to /admin/', async () => {
    const res = createRes();
    await handler(createReq('GET', '/admin'), res);
    expect(res.writeHead).toHaveBeenCalledWith(301, expect.objectContaining({ Location: '/admin/' }));
  });
  test('/track redirects to /track/', async () => {
    const res = createRes();
    await handler(createReq('GET', '/track'), res);
    expect(res.writeHead).toHaveBeenCalledWith(301, expect.objectContaining({ Location: '/track/' }));
  });
});

describe('unknown API routes', () => {
  test('returns 404', async () => {
    const res = createRes();
    await handler(createReq('GET', '/api/unknown'), res);
    expect(res._status).toBe(404);
  });
});

describe('POST /api/sticker/order', () => {
  test('creates sticker order with slip', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: {
        customer_info: 'Test\n099-123-4567\n123 Bangkok',
        patterns: ['Magic Pegasus', 'Sticker 2'],
        pattern_qtys: { 'Magic Pegasus': 1, 'Sticker 2': 1 },
        total_bags: 2, total_price: 138, shipping_cost: 50,
      },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(res._status).toBe(201);
    const data = JSON.parse(res._body);
    expect(data.success).toBe(true);
    expect(data.order.status).toBe(1);
    expect(data.order.type).toBe('sticker');
    expect(data.order.slip_data).toBe('data:image/jpeg;base64,...');
    expect(data.order.id).toMatch(/^HXG-\d{8}-[A-Z0-9]{4}$/);
  });
  test('400 without order data', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', { slip_data: 'img' }), res);
    expect(res._status).toBe(400);
  });
  test('400 without slip_data', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: { customer_info: 'Test', patterns: ['Magic Pegasus'] },
    }), res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body).error).toContain('สลีป');
  });
  test('400 without patterns', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: { customer_info: 'Test' },
      slip_data: 'img',
    }), res);
    expect(res._status).toBe(400);
  });
  test('400 without customer_info', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: { patterns: ['Magic Pegasus'] },
      slip_data: 'img',
    }), res);
    expect(res._status).toBe(400);
  });
  test('note_status = on when note is provided', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: { customer_info: 'Test', patterns: ['Magic Pegasus'], note: 'กรุณาส่งเร็วๆ' },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('on');
  });
  test('note_status = off when no note', async () => {
    const res = createRes();
    await handler(createReq('POST', '/api/sticker/order', {
      order: { customer_info: 'Test', patterns: ['Magic Pegasus'] },
      slip_data: 'data:image/jpeg;base64,...',
    }), res);
    expect(JSON.parse(res._body).order.note_status).toBe('off');
  });
});
