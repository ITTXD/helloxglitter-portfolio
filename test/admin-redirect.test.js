/**
 * test/admin-redirect.test.js
 *
 * ทดสอบว่า api/admin-logout.js:
 * 1. ส่ง status 302
 * 2. Location header ชี้ไปที่ /
 * 3. Set-Cookie ล้าง admin_session ออก (Max-Age=0)
 * 4. Cache-Control เป็น no-store
 */

'use strict';

const adminLogout = require('../api/admin-logout');

function makeRes() {
  const headers = {};
  let statusCode = null;
  let ended = false;

  return {
    writeHead(code, hdrs) {
      statusCode = code;
      Object.assign(headers, hdrs || {});
    },
    end() { ended = true; },
    _status: () => statusCode,
    _headers: () => headers,
    _ended: () => ended,
  };
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

console.log('\n🧪 admin-redirect: ทดสอบ api/admin-logout.js\n');

// ---- Test 1: GET /admin/ (no cookie) ----
{
  const req = { method: 'GET', url: '/admin/', headers: {} };
  const res = makeRes();
  adminLogout(req, res);

  assert('status 302', res._status() === 302, `got ${res._status()}`);
  assert('Location: /', res._headers()['Location'] === '/', `got "${res._headers()['Location']}"`);
  assert(
    'Set-Cookie clears admin_session',
    (res._headers()['Set-Cookie'] || '').includes('admin_session=;'),
    `got "${res._headers()['Set-Cookie']}"`
  );
  assert(
    'Set-Cookie has Max-Age=0',
    (res._headers()['Set-Cookie'] || '').includes('Max-Age=0'),
    `got "${res._headers()['Set-Cookie']}"`
  );
  assert('Cache-Control: no-store', res._headers()['Cache-Control'] === 'no-store', `got "${res._headers()['Cache-Control']}"`);
  assert('res.end() was called', res._ended());
}

// ---- Test 2: GET /admin (without trailing slash) ----
{
  const req = { method: 'GET', url: '/admin', headers: { cookie: 'admin_session=secret123' } };
  const res = makeRes();
  adminLogout(req, res);

  assert('[no-slash] status 302', res._status() === 302, `got ${res._status()}`);
  assert('[no-slash] Location: /', res._headers()['Location'] === '/', `got "${res._headers()['Location']}"`);
  assert(
    '[no-slash] Set-Cookie clears admin_session',
    (res._headers()['Set-Cookie'] || '').includes('admin_session=;'),
    `got "${res._headers()['Set-Cookie']}"`
  );
}

// ---- Test 3: POST /admin/ (edge case — should still clear and redirect) ----
{
  const req = { method: 'POST', url: '/admin/', headers: { cookie: 'admin_session=secret123' } };
  const res = makeRes();
  adminLogout(req, res);

  assert('[POST] still clears session and redirects', res._status() === 302 && res._headers()['Location'] === '/', `status=${res._status()} loc="${res._headers()['Location']}"`);
}

console.log(`\n📊 ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้มเหลว\n`);
if (failed > 0) process.exit(1);
