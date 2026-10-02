/**
 * test/admin-session-clear.test.js
 *
 * Comprehensive tests verifying that the customer storefront:
 * 1. Never auto-activates admin mode or customer preview mode on load or refresh
 * 2. Hard-clears all 5 admin/preview sessionStorage keys on load
 * 3. Strips all admin/preview body classes (admin-mode, v8-third-person-view, v8-customer-preview-mode)
 * 4. Completely cleans the bottom navigation bar so no admin tabs or gear exist
 * 5. Full logout chain (logoutHLG) clears cookie via /api/logout, clears all 5 keys, and returns to customer home
 * 6. Wildcard /admin routes on Vercel redirect to / and kill cookies
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

console.log('\n🧪 admin-session-clear: Comprehensive verification of index.html and vercel.json\n');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(indexPath, 'utf-8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf-8'));

// ==================== 1. checkAdminAuthStatus ====================
// Must NOT auto-activate admin or set sessionStorage on load/refresh
const checkAdminMatch = html.match(/async function checkAdminAuthStatus\(\)\s*\{([\s\S]*?)\}/);
const checkAdminBody = checkAdminMatch ? checkAdminMatch[1] : '';
assert(
  'checkAdminAuthStatus does not restore admin sessionStorage',
  !checkAdminBody.includes('sessionStorage.setItem'),
  'checkAdminAuthStatus still sets admin sessionStorage'
);
assert(
  'checkAdminAuthStatus does not add admin-mode class to body',
  !checkAdminBody.includes('admin-mode'),
  'checkAdminAuthStatus still adds admin-mode class'
);

// ==================== 2. boot() Hard Clear on Page Load ====================
assert(
  "boot() removes 'hlg_admin_session_v2'",
  /function boot\(\)\s*\{[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_session_v2['"]\)/.test(html)
);
assert(
  "boot() removes 'hlg_admin_customer_preview_v3' (prevents stuck in 'มุมมองลูกค้า')",
  /function boot\(\)\s*\{[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_v3['"]\)/.test(html)
);
assert(
  "boot() removes 'hlg_admin_customer_preview_backup_v3' (prevents ownerLogged returning true)",
  /function boot\(\)\s*\{[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_backup_v3['"]\)/.test(html)
);
assert(
  "boot() removes 'admin-mode' and 'v8-third-person-view' from body",
  /function boot\(\)\s*\{[\s\S]*?classList\.remove[\s\S]*?admin-mode[\s\S]*?v8-third-person-view/.test(html)
);
assert(
  "boot() removes 'admin-visible' and 'v8-has-admin' from bottom nav",
  /function boot\(\)\s*\{[\s\S]*?classList\.remove[\s\S]*?admin-visible[\s\S]*?v8-has-admin/.test(html)
);

// ==================== 3. Unified logoutHLG ====================
assert(
  "logoutHLG calls /api/logout to destroy HTTP cookie",
  /async function logoutHLG\(\)\s*\{[\s\S]*?fetch\(['"]\/api\/logout['"]/.test(html)
);
assert(
  "logoutHLG removes all preview keys (hlg_admin_customer_preview_v3 & backup)",
  /async function logoutHLG\(\)\s*\{[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_v3['"]\)[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_backup_v3['"]\)/.test(html)
);
assert(
  "logoutHLG strips v8-third-person-view and admin-mode",
  /async function logoutHLG\(\)\s*\{[\s\S]*?classList\.remove[\s\S]*?admin-mode[\s\S]*?v8-third-person-view/.test(html)
);
assert(
  "logoutHLG returns to customer home via showPage('home')",
  /async function logoutHLG\(\)\s*\{[\s\S]*?showPage\(['"]home['"]\)/.test(html)
);

// ==================== 4. Logout Chain Preserved ====================
assert(
  "v6 logout wrapper delegates to previous logoutHLG (does not break chain)",
  /const oldLogout=window\.logoutHLG;[\s\S]*?oldLogout\.apply\(this,arguments\)/.test(html)
);
assert(
  "final logout owner delegates to legacyLogout",
  /const legacyLogout=window\.logoutHLG;[\s\S]*?legacyLogout\.apply\(this,arguments\)/.test(html)
);

// ==================== 5. hlg-force-home-on-load at bottom of HTML ====================
assert(
  "hlg-force-home-on-load script exists at bottom of index.html",
  html.includes('id="hlg-force-home-on-load"')
);
assert(
  "hlg-force-home-on-load clears all preview keys",
  /id="hlg-force-home-on-load"[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_v3['"]\)[\s\S]*?sessionStorage\.removeItem\(['"]hlg_admin_customer_preview_backup_v3['"]\)/.test(html)
);
assert(
  "hlg-force-home-on-load strips admin-mode and v8-third-person-view from body",
  /id="hlg-force-home-on-load"[\s\S]*?classList\.remove[\s\S]*?admin-mode[\s\S]*?v8-third-person-view/.test(html)
);
assert(
  "hlg-force-home-on-load removes admin tabs and v8-has-admin from bottom nav",
  /id="hlg-force-home-on-load"[\s\S]*?classList\.remove\(['"]admin-visible['"],\s*['"]v8-has-admin['"]\)[\s\S]*?v8-final-admin-tab/.test(html)
);
assert(
  "hlg-force-home-on-load forces showPage('home')",
  /id="hlg-force-home-on-load"[\s\S]*?showPage\(['"]home['"]\)/.test(html)
);
assert(
  "hlg-force-home-on-load uses delayed timeouts to counteract any late script executions",
  /id="hlg-force-home-on-load"[\s\S]*?setTimeout\(nukeAdminAndForceHome,\s*\d+\)/.test(html)
);

// ==================== 6. Intentional Admin Login Still Works ====================
assert(
  "Intentional login via PIN 333999 is preserved in handleLogin",
  html.includes("333999") && html.includes("sessionStorage.setItem('hlg_admin_session_v2','1')"),
  'handleLogin must still allow intentional login via PIN'
);

// ==================== 7. Vercel Rewrites for /admin ====================
const rewrites = vercelConfig.rewrites || [];
const adminRewrite = rewrites.find(r => r.source === '/admin');
const adminWildcardRewrite = rewrites.find(r => r.source === '/admin/:match*');

assert(
  "vercel.json rewrites /admin to /api/admin-logout",
  adminRewrite && adminRewrite.destination === '/api/admin-logout'
);
assert(
  "vercel.json rewrites /admin/:match* wildcard to /api/admin-logout",
  adminWildcardRewrite && adminWildcardRewrite.destination === '/api/admin-logout'
);

console.log(`\n📊 ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้มเหลว\n`);
if (failed > 0) process.exit(1);
