/**
 * TDD Suite — Lazy-load the storefront Visual CMS editors.
 *
 * The CMS editor scripts must not parse/execute for customers. They stay in the
 * markup as inert `type="text/x-hlg-admin-script"` blocks and are only injected
 * when a real admin session is present (on load, or right after login).
 *
 * Safety: scripts that ALSO render customer-facing content must never be deferred.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const storefront = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

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

// Match a script tag by id and report whether it is deferred.
function scriptTag(id) {
  const re = new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>`, 'i');
  const m = storefront.match(re);
  return m ? m[0] : null;
}
const isDeferred = (id) => {
  const tag = scriptTag(id);
  return !!tag && /type\s*=\s*["']text\/x-hlg-admin-script["']/.test(tag);
};

console.log('========================================');
console.log('  TEST: CMS Lazy-load');
console.log('========================================\n');

console.log('── 1. LOADER ──');

test('storefront defines a lazy loader + injection API', () => {
  assert.ok(
    storefront.includes('window.hlgLoadAdminScripts'),
    'should expose window.hlgLoadAdminScripts'
  );
  assert.ok(
    storefront.includes('text/x-hlg-admin-script'),
    'loader should target deferred blocks'
  );
});

test('loader only injects when a real admin session is present', () => {
  const marker = 'window.hlgLoadAdminScripts';
  const idx = storefront.indexOf(marker);
  assert.ok(idx > -1);
  const window = storefront.slice(Math.max(0, idx - 1500), idx + 1500);
  assert.ok(
    /hlg_admin_session_v2/.test(window),
    'loader must read the real admin session key'
  );
  assert.ok(
    /v8-customer-preview-mode|v8-third-person-view/.test(window),
    'loader must treat customer-preview as non-admin'
  );
});

test('admin login (without reload) also loads the scripts', () => {
  const syncIdx = storefront.indexOf('window.hlgAdminModeSync=function');
  assert.ok(syncIdx > -1, 'hlgAdminModeSync should exist');
  const body = storefront.slice(syncIdx, syncIdx + 900);
  assert.ok(
    /hlgLoadAdminScripts/.test(body),
    'the canonical admin-mode writer should trigger the lazy loader'
  );
});

console.log('\n── 2. DEFERRED CMS SCRIPTS ──');

for (const id of ['hlg-inline-copy-editor-js', 'hlg-section-visibility-js']) {
  test(`${id} is deferred (inert for customers)`, () => {
    assert.ok(scriptTag(id), `${id} script block should still exist`);
    assert.ok(isDeferred(id), `${id} should carry type="text/x-hlg-admin-script"`);
  });
}

console.log('\n── 3. SHARED SCRIPTS MUST NOT BE DEFERRED ──');

for (const id of [
  'v8-story-clean-manager',
  'v8-banner-inline-story-clean-js',
  'v8-inline-preview-editor-js',
  'v8-story-final-manager'
]) {
  test(`${id} stays executable (renders customer content)`, () => {
    const tag = scriptTag(id);
    if (!tag) return; // already removed by another ticket — fine
    assert.ok(!isDeferred(id), `${id} must not be deferred: it also renders for customers`);
  });
}

console.log('\n── 4. DEFERRED BLOCKS STILL PARSE ──');

test('every deferred block is valid JavaScript', () => {
  const re = /<script\b[^>]*type=["']text\/x-hlg-admin-script["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(storefront))) {
    n++;
    // eslint-disable-next-line no-new-func
    new Function(m[1]);
  }
  assert.ok(n >= 1, 'expected at least one deferred block');
});

console.log('\n========================================');
console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED > 0) {
  process.exit(1);
}
