/**
 * TDD Suite for Ticket 04 — Isolate Storefront CMS Mode
 *
 * On the storefront, `body.admin-mode` is the switch that reveals the Visual
 * CMS tools (text editor, section visibility, highlight stories, banners).
 * It must be driven by one canonical, leak-proof predicate — never by a DOM
 * heuristic that can stick for customers.
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

console.log('========================================');
console.log('  TEST: Storefront CMS Mode Isolation (Ticket 04)');
console.log('========================================\n');

console.log('── 1. ONE CANONICAL, LEAK-PROOF admin-mode SWITCH ──');

test('storefront defines a single canonical admin-mode sync helper', () => {
  const defs = storefront.match(/window\.hlgAdminModeSync\s*=\s*function/g) || [];
  assert.strictEqual(defs.length, 1, `expected exactly 1 definition, found ${defs.length}`);
});

test('the helper keys off the real admin session and treats previews as non-admin', () => {
  assert.ok(
    storefront.includes("sessionStorage.getItem('hlg_admin_session_v2')==='1'"),
    'helper should read the canonical admin session key'
  );
  assert.ok(
    storefront.includes("v8-third-person-view"),
    'helper should exclude the customer-preview (third-person) view'
  );
});

test('admin-mode is never enabled by a DOM text heuristic', () => {
  assert.ok(
    !storefront.includes("if(adminVisible) document.body.classList.add('admin-mode')"),
    'the leaky heuristic writer must be gone (it can stick for customers)'
  );
  assert.ok(
    !/adminVisible/.test(storefront.split('hlgAdminModeSync')[1] || ''),
    'no heuristic should sit inside the canonical sync implementation'
  );
});

test('every syncAdminClass implementation delegates to the canonical helper', () => {
  assert.ok(
    storefront.includes('function syncAdminClass(){window.hlgAdminModeSync()}'),
    'the event-driven sync should call the canonical helper'
  );
  assert.ok(
    storefront.includes('if(window.hlgAdminModeSync) return window.hlgAdminModeSync();'),
    'the other sync implementation should defer to the canonical helper'
  );
});

console.log('\n── 2. THE CLASS STILL GATES ONLY VISUAL CMS TOOLS ──');

test('visibility toggler is gated by admin-mode', () => {
  assert.ok(
    storefront.includes('body:not(.admin-mode) .hlg-section-close'),
    'section close buttons should only show for admins'
  );
  assert.ok(storefront.includes('hlg-section-cover'), 'section cover should exist');
});

test('highlight story admin UI is gated by admin-mode', () => {
  assert.ok(
    storefront.includes('body:not(.admin-mode) .v8-story-admin-only{display:none!important}'),
    'story admin-only controls should be hidden without admin-mode'
  );
});

test('banner admin tools are gated by admin-mode', () => {
  assert.ok(
    storefront.includes('body.admin-mode .v8-banner-admin-tools'),
    'banner admin tools should only show in admin-mode'
  );
});

test('text editor and visibility toggler scripts are present and admin-checked', () => {
  assert.ok(storefront.includes('id="hlg-inline-copy-editor-js"'), 'text editor script present');
  assert.ok(storefront.includes('id="hlg-section-visibility-js"'), 'visibility toggler script present');
  assert.ok(storefront.includes("hlg_admin_session_v2") && storefront.includes('hlgTextControl'));
  assert.ok(storefront.includes('hlg-admin-visible'), 'visibility admin marker present');
});

console.log('\n── 3. MIGRATED ADMIN PANELS STAY OUT (regression) ──');

test('no migrated admin panels are created on the storefront', () => {
  for (const id of ['adminPanel-products', 'adminPanel-tiers', 'adminPanel-fonts', 'adminPanel-pricing']) {
    assert.ok(
      !storefront.includes(`id='${id}'`) && !storefront.includes(`id="${id}"`),
      `storefront should not create #${id}`
    );
  }
});

test('storefront no longer wires migrated admin tabs', () => {
  for (const tab of ['products', 'tiers', 'fonts', 'pricing', 'coupons']) {
    assert.ok(
      !storefront.includes(`switchAdminTab('${tab}'`),
      `storefront should not wire switchAdminTab('${tab}')`
    );
  }
});

console.log('\n========================================');
console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
console.log('========================================');

if (FAILED > 0) {
  process.exit(1);
}
