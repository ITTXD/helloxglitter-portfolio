/**
 * test/admin-session-clear.test.js
 *
 * ทดสอบพฤติกรรม admin session ใน index.html:
 * - boot() ต้องเรียก sessionStorage.removeItem('hlg_admin_session_v2')
 * - หลัง boot() แม้ sessionStorage มี session อยู่ก็ต้องถูกล้าง
 */

'use strict';

const fs = require('fs');
const path = require('path');

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

console.log('\n🧪 admin-session-clear: ตรวจสอบ index.html\n');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(indexPath, 'utf-8');

// 1. boot() ต้องมีการ removeItem session key
assert(
  "boot() มี sessionStorage.removeItem('hlg_admin_session_v2')",
  /function boot\(\)\s*\{[\s\S]{0,300}sessionStorage\.removeItem\('hlg_admin_session_v2'\)/.test(html),
  'ไม่พบการ clear session ใน boot()'
);

// 2. ต้องอยู่ก่อน syncAdminClass() หรือ ensureBack()
const bootMatch = html.match(/function boot\(\)\s*\{([\s\S]*?)\}/);
if (bootMatch) {
  const bootBody = bootMatch[1];
  const removeIdx = bootBody.indexOf("sessionStorage.removeItem('hlg_admin_session_v2')");
  const syncIdx = bootBody.indexOf('syncAdminClass');
  assert(
    'removeItem อยู่ก่อน syncAdminClass() ใน boot()',
    removeIdx !== -1 && (syncIdx === -1 || removeIdx < syncIdx),
    `removeIdx=${removeIdx}, syncIdx=${syncIdx}`
  );
} else {
  assert('พบ boot() function', false, 'ไม่พบ function boot()');
}

// 3. ยังมี DOMContentLoaded boot อยู่
assert(
  "DOMContentLoaded listener ยังเรียก boot อยู่",
  html.includes("addEventListener('DOMContentLoaded',boot)"),
  'ไม่พบ DOMContentLoaded boot'
);

// 4. ยังมี login function ที่ set session ไว้ (เพื่อยืนยันว่าไม่ได้ลบทิ้ง)
assert(
  "handleLogin ยังมี sessionStorage.setItem('hlg_admin_session_v2','1')",
  html.includes("sessionStorage.setItem('hlg_admin_session_v2','1')"),
  'ไม่พบ handleLogin set session'
);

console.log(`\n📊 ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้มเหลว\n`);
if (failed > 0) process.exit(1);
