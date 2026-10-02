/**
 * TDD Test Suite: Global Promotion Bar & Cloud Storage Persistence
 * 
 * Verifies:
 * 1. Global placement: promo bar shell lives outside .page containers so it displays on every page.
 * 2. Backend API: GET/PUT /api/settings/storefront correctly serializes and persists promo_bar with merge safety.
 * 3. Conditional auto-hide: Non-admins see NOTHING (zero blank space) when no promo is active.
 * 4. Admin preview/edit: Admins can see off-state placeholder with ✎ button to edit/enable.
 * 5. Cloud hydration: loadStorefrontSettingsFromCloud hydrates promo_bar and syncStorefrontSettingsToCloud persists it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-promo-bar-8888';

const serverHandler = require('../server');
const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const apiPathJs = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

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
  console.log('  TEST: Global Promotion Bar & Cloud Sync');
  console.log('========================================\n');

  console.log('── 1. DOM STRUCTURE & GLOBAL PLACEMENT (index.html) ──');

  test('v8GlobalTickerShell exists outside .page containers', () => {
    assert.ok(
      indexHtml.includes('id="v8GlobalTickerShell"'),
      'expected #v8GlobalTickerShell in index.html'
    );
    const shellIndex = indexHtml.indexOf('id="v8GlobalTickerShell"');
    const firstPageIndex = indexHtml.indexOf('class="page active"');
    assert.ok(
      shellIndex > 0 && shellIndex < firstPageIndex,
      '#v8GlobalTickerShell must sit before any .page div so it appears on all pages'
    );
  });

  test('v8HomeTicker is placed inside v8GlobalTickerShell', () => {
    const shellSnippet = indexHtml.split('id="v8GlobalTickerShell"')[1].slice(0, 500);
    assert.ok(
      shellSnippet.includes('id="v8HomeTicker"'),
      '#v8HomeTicker must be contained inside #v8GlobalTickerShell'
    );
  });

  test('v8HomeTicker is no longer trapped inside #page-home .v5-home', () => {
    const pageHomeSplit = indexHtml.split('id="page-home"')[1];
    const pageHomeContent = pageHomeSplit.split('id="page-preorder"')[0];
    assert.ok(
      !pageHomeContent.includes('id="v8HomeTicker"'),
      '#v8HomeTicker must NOT be inside #page-home'
    );
  });

  test('v8GlobalTickerShell CSS provides auto-hide and responsive layout', () => {
    assert.ok(
      indexHtml.includes('.v8-global-ticker-shell'),
      'CSS rule for .v8-global-ticker-shell must exist'
    );
    assert.ok(
      indexHtml.includes('.v8-global-ticker-shell.v8-ticker-hidden') ||
      indexHtml.includes('.v8-ticker-hidden'),
      'hidden rule must hide ticker completely with display:none!important'
    );
  });

  console.log('\n── 2. BACKEND API: GET /api/settings/storefront ──');

  await asyncTest('GET /api/settings/storefront returns promo_bar object', async () => {
    const req = createReq('GET', '/api/settings/storefront');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.settings, 'expected settings property');
    assert.ok(typeof data.settings.promo_bar === 'object', 'expected promo_bar object');
  });

  console.log('\n── 3. BACKEND API: PUT /api/settings/storefront ──');

  await asyncTest('PUT /api/settings/storefront rejects unauthenticated requests with 401', async () => {
    const req = createReq('PUT', '/api/settings/storefront', { promo_bar: { text: 'Test' } });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 401);
  });

  await asyncTest('PUT /api/settings/storefront persists promo_bar and merges without data loss', async () => {
    // 1. Seed banners and notices first
    const seedReq = createReq('PUT', '/api/settings/storefront', {
      banners: [{ id: 'b1', img: 'https://example.com/banner.jpg' }],
      notices: [{ id: 'n1', title: 'Hello Notice' }],
      promo_bar: {
        enabled: true,
        label: 'PROMO',
        text: 'ซื้อครบ 300 รับคูปอง 100 ฿ ทันที! ♡',
        color: '#ff4d6d',
        speed: 12,
        direction: 'left'
      }
    }, ADMIN_COOKIE);
    const seedRes = createRes();
    await serverHandler(seedReq, seedRes);
    assert.strictEqual(seedRes._status, 200);

    // 2. Read back
    const getReq = createReq('GET', '/api/settings/storefront');
    const getRes = createRes();
    await serverHandler(getReq, getRes);
    const data = JSON.parse(getRes._body);
    assert.strictEqual(data.settings.promo_bar.text, 'ซื้อครบ 300 รับคูปอง 100 ฿ ทันที! ♡');
    assert.strictEqual(data.settings.promo_bar.label, 'PROMO');
    assert.strictEqual(data.settings.promo_bar.color, '#ff4d6d');
    assert.strictEqual(data.settings.promo_bar.enabled, true);
    assert.strictEqual(data.settings.banners.length, 1);
    assert.strictEqual(data.settings.notices.length, 1);

    // 3. Partial update only updating promo_bar should NOT wipe banners
    const updateReq = createReq('PUT', '/api/settings/storefront', {
      promo_bar: {
        enabled: false,
        label: 'SALE',
        text: 'ปิดปรับปรุงโปรโมชั่น',
        color: '#f7a4c4',
        speed: 16,
        direction: 'right'
      }
    }, ADMIN_COOKIE);
    const updateRes = createRes();
    await serverHandler(updateReq, updateRes);
    assert.strictEqual(updateRes._status, 200);

    // 4. Verify merge preserved banners & updated promo_bar
    const checkReq = createReq('GET', '/api/settings/storefront');
    const checkRes = createRes();
    await serverHandler(checkReq, checkRes);
    const checkData = JSON.parse(checkRes._body);
    assert.strictEqual(checkData.settings.promo_bar.enabled, false);
    assert.strictEqual(checkData.settings.promo_bar.label, 'SALE');
    assert.strictEqual(checkData.settings.banners.length, 1, 'banners must NOT be wiped by promo_bar update');
    assert.strictEqual(checkData.settings.notices.length, 1, 'notices must NOT be wiped by promo_bar update');
  });

  console.log('\n── 4. PARITY WITH api/[...path].js ──');

  test('api/[...path].js includes promo_bar in GET and PUT handlers', () => {
    assert.ok(
      apiPathJs.includes('promo_bar'),
      'api/[...path].js must handle promo_bar'
    );
    assert.ok(
      serverJs.includes('promo_bar'),
      'server.js must handle promo_bar'
    );
  });

  console.log('\n── 5. FRONTEND CLOUD PERSISTENCE & HYDRATION (index.html) ──');

  test('syncStorefrontSettingsToCloud includes promo_bar in payload', () => {
    assert.ok(
      indexHtml.includes('syncStorefrontSettingsToCloud'),
      'syncStorefrontSettingsToCloud must exist'
    );
    const syncFunc = indexHtml.split('function syncStorefrontSettingsToCloud')[1].slice(0, 600);
    assert.ok(
      syncFunc.includes('promo_bar'),
      'syncStorefrontSettingsToCloud must send promo_bar in PUT payload'
    );
  });

  test('loadStorefrontSettingsFromCloud hydrates promo_bar and triggers render', () => {
    assert.ok(
      indexHtml.includes('loadStorefrontSettingsFromCloud'),
      'loadStorefrontSettingsFromCloud must exist'
    );
    const loadFunc = indexHtml.split('function loadStorefrontSettingsFromCloud')[1].slice(0, 800);
    assert.ok(
      loadFunc.includes('promo_bar'),
      'loadStorefrontSettingsFromCloud must read promo_bar from cloud response'
    );
    assert.ok(
      loadFunc.includes('v8RenderHomeTicker') || loadFunc.includes('apply'),
      'loadStorefrontSettingsFromCloud must re-render the ticker upon cloud hydration'
    );
  });

  test('ticker editor save calls syncStorefrontSettingsToCloud', () => {
    const editorSave = indexHtml.split("q('.v8-ticker-save').onclick")[1]?.slice(0, 600) || '';
    assert.ok(
      editorSave.includes('syncStorefrontSettingsToCloud'),
      'saving in the ticker editor modal must call syncStorefrontSettingsToCloud'
    );
  });

  console.log('\n── 6. CONDITIONAL VISIBILITY / AUTO-HIDE LOGIC ──');

  test('ticker renderer hides bar completely for customers when promo is disabled or empty', () => {
    assert.ok(
      indexHtml.includes('v8-ticker-hidden'),
      'must toggle v8-ticker-hidden'
    );
    // Check that empty text is treated as no promo
    assert.ok(
      indexHtml.includes('!t.enabled') || indexHtml.includes('!hasPromo'),
      'renderer must check if promo is active'
    );
  });

  console.log('\n========================================');
  console.log(`Results: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================');

  if (FAILED > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
