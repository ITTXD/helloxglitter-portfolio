/**
 * TDD Suite for Admin Unification & Storefront CMS
 */
const assert = require('assert');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // run with in-memory store for isolation
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-unification-1234';

const serverHandler = require('../server');

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
  console.log('  TEST: Admin Unification & Storefront CMS');
  console.log('========================================\n');

  console.log('── 1. DUAL-PASSWORD AUTHENTICATION (POST /api/login) ──');

  await asyncTest('POST /api/login succeeds with master password (helloxglitter)', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/login', { password: 'helloxglitter' }), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(res._headers['Set-Cookie']);
    assert.ok(res._headers['Set-Cookie'].includes('admin_session='));
  });

  await asyncTest('POST /api/login succeeds with quick mobile PIN (333999)', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/login', { password: '333999' }), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(res._headers['Set-Cookie']);
    assert.ok(res._headers['Set-Cookie'].includes('admin_session='));
  });

  await asyncTest('POST /api/login rejects wrong password with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('POST', '/api/login', { password: 'wrongpassword' }), res);
    assert.strictEqual(res._status, 401);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.error, 'รหัสผ่านไม่ถูกต้อง');
  });

  console.log('\n── 2. STOREFRONT SETTINGS CMS (GET & PUT /api/settings/storefront) ──');

  await asyncTest('GET /api/settings/storefront returns default settings (Public)', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/settings/storefront'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.settings);
    assert.ok(Array.isArray(data.settings.banners));
    assert.ok(Array.isArray(data.settings.notices));
    assert.ok(Array.isArray(data.settings.stories));
  });

  await asyncTest('PUT /api/settings/storefront rejects non-admin with 401', async () => {
    const res = createRes();
    await serverHandler(createReq('PUT', '/api/settings/storefront', { banners: ['new-banner.jpg'] }), res);
    assert.strictEqual(res._status, 401);
  });

  await asyncTest('PUT /api/settings/storefront saves settings when authenticated as admin', async () => {
    const res = createRes();
    const payload = {
      banners: ['banner1.png', 'banner2.png'],
      notices: [{ id: 'n1', title: 'ประกาศรอบใหม่', body: 'เริ่มส่งวันจันทร์' }],
      stories: [{ id: 's1', title: 'Highlight' }]
    };
    await serverHandler(createReq('PUT', '/api/settings/storefront', payload, 'admin_session=test-secret-unification-1234'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  await asyncTest('GET /api/settings/storefront returns updated settings after save', async () => {
    const res = createRes();
    await serverHandler(createReq('GET', '/api/settings/storefront'), res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.deepStrictEqual(data.settings.banners, ['banner1.png', 'banner2.png']);
    assert.strictEqual(data.settings.notices[0].title, 'ประกาศรอบใหม่');
  });

  console.log('\n========================================');
  console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================');

  if (FAILED > 0) {
    process.exit(1);
  }
}

runTests();
