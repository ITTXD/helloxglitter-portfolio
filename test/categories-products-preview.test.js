/**
 * TDD Test Suite: Dynamic Categories, Custom Products, and Home Preview Cards
 *
 * Verifies:
 * 1. Backend API /api/categories: GET (public), POST/PUT/DELETE (admin required).
 * 2. Backend API /api/products: GET (public), POST/PUT/DELETE (admin required).
 * 3. Storefront settings sync: GET/PUT /api/settings/storefront includes categories, custom_products, and preview_cards.
 * 4. Parity with api/[...path].js.
 * 5. Admin portal (public/admin/): UI components for Category Management, Dynamic Product Form, and Preview Cards.
 * 6. Storefront (public/index.html): Category page rendering, Cart integration, and Home Preview Card generation.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-categories-products-9999';

const serverHandler = require('../server');
const ROOT = path.join(__dirname, '..');

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
  console.log('  TEST: Categories, Products & Preview');
  console.log('========================================\n');

  console.log('── 1. CATEGORIES BACKEND API (/api/categories) ──');

  await asyncTest('GET /api/categories returns default categories', async () => {
    const req = createReq('GET', '/api/categories');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.categories));
    const ids = data.categories.map(c => c.id);
    assert.ok(ids.includes('bag'), 'should include bag category');
    assert.ok(ids.includes('sticker'), 'should include sticker category');
    assert.ok(ids.includes('wallpaper'), 'should include wallpaper category');
  });

  await asyncTest('POST /api/categories rejects unauthenticated request with 401', async () => {
    const req = createReq('POST', '/api/categories', { name: 'พวงกุญแจ' });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 401);
  });

  let createdCatId = null;
  await asyncTest('POST /api/categories creates new category for admin', async () => {
    const payload = {
      name: 'พวงกุญแจอะคริลิค',
      description: 'พวงกุญแจน้องกลิตเตอร์สุดน่ารัก',
      cover_url: 'https://example.com/keychain-cover.jpg',
      show_on_home: true
    };
    const req = createReq('POST', '/api/categories', payload, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.category);
    assert.strictEqual(data.category.name, 'พวงกุญแจอะคริลิค');
    assert.ok(data.category.id);
    createdCatId = data.category.id;
  });

  await asyncTest('PUT /api/categories/:id updates category details', async () => {
    const req = createReq('PUT', `/api/categories/${createdCatId}`, {
      name: 'พวงกุญแจอะคริลิค (อัปเดต)',
      description: 'คอลเลกชันใหม่ล่าสุด'
    }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.category.name, 'พวงกุญแจอะคริลิค (อัปเดต)');
  });

  console.log('\n── 2. PRODUCTS BACKEND API (/api/products) ──');

  await asyncTest('POST /api/products rejects unauthenticated with 401', async () => {
    const req = createReq('POST', '/api/products', { name: 'พวงกุญแจกระต่าย', price: 99 });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 401);
  });

  let createdProdId = null;
  await asyncTest('POST /api/products creates product linked to category', async () => {
    const payload = {
      category_id: createdCatId,
      name: 'พวงกุญแจกระต่ายชมพู',
      price: 129,
      description: 'งานอะคริลิค 2 ด้าน เคลือบกลิตเตอร์วิบวับ',
      image_url: 'https://example.com/keychain-bunny.jpg'
    };
    const req = createReq('POST', '/api/products', payload, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.product);
    assert.strictEqual(data.product.name, 'พวงกุญแจกระต่ายชมพู');
    assert.strictEqual(data.product.price, 129);
    assert.strictEqual(data.product.category_id, createdCatId);
    createdProdId = data.product.id;
  });

  await asyncTest('GET /api/products returns created product', async () => {
    const req = createReq('GET', '/api/products');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    const found = data.products.find(p => p.id === createdProdId);
    assert.ok(found, 'created product should be in list');
    assert.strictEqual(found.name, 'พวงกุญแจกระต่ายชมพู');
  });

  await asyncTest('PUT /api/products/:id updates price and name', async () => {
    const req = createReq('PUT', `/api/products/${createdProdId}`, {
      price: 119,
      name: 'พวงกุญแจกระต่ายชมพู (Sale)'
    }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.product.price, 119);
    assert.strictEqual(data.product.name, 'พวงกุญแจกระต่ายชมพู (Sale)');
  });

  console.log('\n── 3. PREVIEW CARDS & STOREFRONT SETTINGS PERSISTENCE ──');

  await asyncTest('GET /api/settings/storefront includes categories, custom_products, and preview_cards', async () => {
    const req = createReq('GET', '/api/settings/storefront');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.settings.categories), 'settings.categories must be array');
    assert.ok(Array.isArray(data.settings.custom_products), 'settings.custom_products must be array');
    assert.ok(Array.isArray(data.settings.preview_cards), 'settings.preview_cards must be array');
  });

  await asyncTest('PUT /api/settings/storefront updates preview_cards without data loss', async () => {
    const newCards = [
      { name: 'กระเป๋าผ้า HLG', sub: 'ลายใหม่เพียบ ♡', target: 'preorder', image_url: '' },
      { name: 'พวงกุญแจอะคริลิค', sub: 'วิบวับน่ารัก', target: createdCatId, image_url: '' }
    ];
    const req = createReq('PUT', '/api/settings/storefront', { preview_cards: newCards }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.settings.preview_cards.length, 2);
    assert.strictEqual(data.settings.preview_cards[1].name, 'พวงกุญแจอะคริลิค');
  });

  console.log('\n── 4. DELETION FLOW (CLEANUP) ──');

  await asyncTest('DELETE /api/products/:id deletes product', async () => {
    const req = createReq('DELETE', `/api/products/${createdProdId}`, null, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  await asyncTest('DELETE /api/categories/:id deletes category', async () => {
    const req = createReq('DELETE', `/api/categories/${createdCatId}`, null, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  console.log('\n── 5. FRONTEND ADMIN & STOREFRONT UI MARKUP CHECKS ──');

  const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

  test('admin index.html contains category and preview management containers', () => {
    assert.ok(
      adminHtml.includes('id="categoryManagerContainer"') || adminJs.includes('categoryManagerContainer'),
      'admin portal must contain category manager container'
    );
    assert.ok(
      adminHtml.includes('id="previewManagerContainer"') || adminJs.includes('previewManagerContainer'),
      'admin portal must contain preview cards manager container'
    );
  });

  test('admin.js contains category creation and dynamic dropdown logic', () => {
    assert.ok(
      adminJs.includes('saveCategory') || adminJs.includes('renderCategoryManager'),
      'admin.js must provide category management logic'
    );
    assert.ok(
      adminJs.includes('/api/categories'),
      'admin.js must interact with /api/categories'
    );
  });

  test('index.html storefront integrates dynamic category pages and preview cards', () => {
    assert.ok(
      indexHtml.includes('/api/categories') || indexHtml.includes('hlg_categories_v2') || indexHtml.includes('preview_cards'),
      'storefront must load categories and preview cards'
    );
  });

  test('storefront hydrates categories, custom products, and preview cards from cloud', () => {
    assert.ok(
      indexHtml.includes("localStorage.setItem('hlg_categories_v2'"),
      'storefront must hydrate hlg_categories_v2'
    );
    assert.ok(
      indexHtml.includes("localStorage.setItem('hlg_custom_products_v1'"),
      'storefront must hydrate hlg_custom_products_v1'
    );
    assert.ok(
      indexHtml.includes("localStorage.setItem('hlg_preview_cards_v2'"),
      'storefront must hydrate hlg_preview_cards_v2'
    );
  });

  test('v8-inline-preview-editor-js prevents freezing with try-finally and includes custom categories', () => {
    assert.ok(
      indexHtml.includes('rendering=false;') && indexHtml.includes('finally'),
      'renderInline must use try...finally to prevent state freezing'
    );
    assert.ok(
      indexHtml.includes('hlg_categories_v2') && indexHtml.includes('targetOptions'),
      'targetOptions must read custom categories from hlg_categories_v2'
    );
    assert.ok(
      indexHtml.includes('/api/preview-cards'),
      'storefront inline preview editor must sync changes to /api/preview-cards'
    );
  });

  test('storefront exposes hlgEnsureCategoryPage and hlgAddCustomProductToCart', () => {
    assert.ok(
      indexHtml.includes('window.hlgEnsureCategoryPage'),
      'storefront must expose window.hlgEnsureCategoryPage'
    );
    assert.ok(
      indexHtml.includes('window.hlgAddCustomProductToCart'),
      'storefront must expose window.hlgAddCustomProductToCart'
    );
    assert.ok(
      indexHtml.includes('hlgEnsureCategoryPage(page)'),
      'showPage must call hlgEnsureCategoryPage for dynamic categories'
    );
  });

  test('storefront load() auto-merges custom categories into home preview cards', () => {
    assert.ok(
      indexHtml.includes("localStorage.getItem('hlg_categories_v2')"),
      'load() must read hlg_categories_v2 to merge custom categories'
    );
    assert.ok(
      indexHtml.includes("builtinTargets"),
      'load() must recognize builtin targets and merge custom categories'
    );
  });

  test('storefront customer preview card click opens target category page', () => {
    assert.ok(
      indexHtml.includes("openCard(i)") || indexHtml.includes("window.v8GoRecommended(i)"),
      'card.onclick must trigger openCard'
    );
    assert.ok(
      indexHtml.includes("window.hlgEnsureCategoryPage(targetPage)"),
      'openCard must call hlgEnsureCategoryPage for custom category pages'
    );
  });

  test('admin portal category list displays home visibility badge and storefront preview link', () => {
    assert.ok(
      adminJs.includes("แสดงบนหน้าแรก 💗"),
      'admin.js must display home visibility status badge'
    );
    assert.ok(
      adminJs.includes("ดูหน้าร้าน ↗"),
      'admin.js must provide direct link to preview category page on storefront'
    );
  });

  console.log(`\n========================================`);
  console.log(`  Results: ${PASSED} passed, ${FAILED} failed`);
  console.log(`========================================\n`);

  if (FAILED > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
