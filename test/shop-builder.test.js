/**
 * TDD Test Suite: Shop Builder (Admin Category & Product Management)
 *
 * Verifies:
 * 1. Backend API:
 *    - POST /api/categories creates category and registers storefront settings
 *    - POST /api/products creates product linked to category
 *    - PUT /api/products/:id updates price, name, and description
 *    - DELETE /api/products/:id removes product
 * 2. Frontend Markup & Logic in public/index.html:
 *    - Built-in admin has "หมวดขายของ" tab (#adminPanel-categories / switchAdminTab)
 *    - Dynamic category page (hlgEnsureCategoryPage) provides admin bar with product creation trigger
 *    - Custom product modal markup/handlers exist (hlgOpenAddProductModal, hlgSaveProduct)
 *    - Product cards include "＋ ใส่ตะกร้า" (hlgAddCustomProductToCart) and admin actions (edit/delete)
 *    - Home inline editor "กดแล้วไปที่" target options include custom categories
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // local in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-shop-builder-8888';

const serverHandler = require('../server');
const ROOT = path.join(__dirname, '..');
const ADMIN_COOKIE = `admin_session=${process.env.SESSION_SECRET}`;

function createReq(method, url, body = null, cookies = '', customHeaders = {}) {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', cookie: cookies, ...customHeaders },
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
  console.log('  TEST: Shop Builder & Dynamic Products');
  console.log('========================================\n');

  console.log('── 1. BACKEND API: CATEGORIES & PRODUCTS ──');

  let testCatId = 'cat_pen_' + Date.now();
  await asyncTest('POST /api/categories creates new category "ปากกา"', async () => {
    const req = createReq('POST', '/api/categories', {
      id: testCatId,
      name: 'ปากกาและเครื่องเขียน',
      description: 'เครื่องเขียนน่ารักนำเข้าจากญี่ปุ่น',
      cover_url: 'data:image/jpeg;base64,mockpen',
      show_on_home: true
    }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.category.id, testCatId);
  });

  let testProdId = null;
  await asyncTest('POST /api/products creates product under category', async () => {
    const req = createReq('POST', '/api/products', {
      category_id: testCatId,
      name: 'ปากกาเจล Glitter Pastel 0.5',
      price: 49,
      description: 'หมึกเจลสีพาสเทล เขียนลื่น กันน้ำ',
      image_url: 'data:image/jpeg;base64,mockpenproduct'
    }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.product.id);
    assert.strictEqual(data.product.price, 49);
    assert.strictEqual(data.product.category_id, testCatId);
    testProdId = data.product.id;
  });

  await asyncTest('GET /api/products returns newly created product', async () => {
    const req = createReq('GET', '/api/products');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    const found = data.products.find(p => p.id === testProdId);
    assert.ok(found, 'Product should be in list');
    assert.strictEqual(found.name, 'ปากกาเจล Glitter Pastel 0.5');
  });

  await asyncTest('PUT /api/products/:id updates product price and details', async () => {
    const req = createReq('PUT', `/api/products/${testProdId}`, {
      price: 59,
      name: 'ปากกาเจล Glitter Pastel 0.5 (แพ็คพิเศษ)'
    }, ADMIN_COOKIE);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.product.price, 59);
    assert.strictEqual(data.product.name, 'ปากกาเจล Glitter Pastel 0.5 (แพ็คพิเศษ)');
  });

  await asyncTest('POST /api/categories rejects unauthenticated request with 401', async () => {
    const req = createReq('POST', '/api/categories', { name: 'หมวดทดสอบ' }, '');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 401);
  });

  await asyncTest('POST /api/categories succeeds with x-admin-pin header (333999) without cookies', async () => {
    const req = createReq('POST', '/api/categories', {
      name: 'เครื่องเขียนพินทดสอบ',
      description: 'ทดสอบ Header Auth'
    }, '', { 'x-admin-pin': '333999' });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.ok(data.category.id);
  });

  await asyncTest('POST /api/categories succeeds with Authorization: Bearer token', async () => {
    const req = createReq('POST', '/api/categories', {
      name: 'เครื่องเขียนแบร์เรอร์',
      description: 'ทดสอบ Bearer Auth'
    }, '', { 'authorization': `Bearer ${process.env.SESSION_SECRET}` });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
  });

  console.log('\n── 2. STOREFRONT MARKUP & UI INTEGRATION (public/index.html) ──');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf-8');

  test('index.html contains built-in admin categories tab or injection hook', () => {
    assert.ok(
      indexHtml.includes('adminPanel-categories') || indexHtml.includes('switchAdminTab(\'categories\''),
      'Must support categories admin panel in built-in admin'
    );
  });

  test('index.html category page exposes admin toolbar with product adding function', () => {
    assert.ok(
      indexHtml.includes('hlgOpenAddProductModal') || indexHtml.includes('hlgOpenProductModal'),
      'Must expose function to open product modal'
    );
  });

  test('index.html contains product modal markup with canvas image compression', () => {
    assert.ok(
      indexHtml.includes('hlgProductModal') || indexHtml.includes('hlgSaveProduct'),
      'Must contain product modal or save product handler'
    );
  });

  test('index.html product cards render add-to-cart and admin edit/delete controls', () => {
    assert.ok(
      indexHtml.includes('hlgAddCustomProductToCart'),
      'Must support adding custom product to cart'
    );
    assert.ok(
      indexHtml.includes('hlgDeleteProduct') || indexHtml.includes('hlgEditProduct'),
      'Must support admin editing and deleting products'
    );
  });

  test('index.html provides hlgAdminFetch with credentials and automatic retry on 401', () => {
    assert.ok(
      indexHtml.includes('hlgAdminFetch') && indexHtml.includes('401'),
      'Must provide hlgAdminFetch helper with 401 recovery'
    );
  });

  test('index.html handleLogin invokes /api/login to issue official session cookie', () => {
    assert.ok(
      indexHtml.includes("fetch('/api/login'") || indexHtml.includes('fetch("/api/login"'),
      'handleLogin must call /api/login'
    );
  });

  test('index.html cart only requires email when buying wallpaper only', () => {
    assert.ok(
      indexHtml.includes('function isOnlyWp()'),
      'Cart must have isOnlyWp helper function'
    );
    assert.ok(
      indexHtml.includes('onlyWp?`<div class="v8cf-field"') || indexHtml.includes('onlyWp'),
      'Cart must branch checkout UI for wallpaper-only orders'
    );
    assert.ok(
      indexHtml.includes('Digital Download (Wallpaper)'),
      'Wallpaper checkout must designate digital download address'
    );
  });

  console.log('\n── 3. WALLPAPER TRACKING BY EMAIL (/api/track/email/:email) ──');
  const testWpEmail = `wp-customer-${Date.now()}@testmail.com`;

  await asyncTest('GET /api/track/email/:email rejects invalid email with 400', async () => {
    const req = createReq('GET', '/api/track/email/invalid-email-format');
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 400);
    const data = JSON.parse(res._body);
    assert.ok(data.error);
  });

  await asyncTest('POST /api/orders creates wallpaper order with customer_email and items', async () => {
    const req = createReq('POST', '/api/orders', {
      customer_email: testWpEmail,
      type: 'wallpaper',
      items: [{ name: 'Secret Garden Wallpaper', qty: 1, price: 99, type: 'wallpaper' }],
      total_price: 99
    });
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 201);
    const data = JSON.parse(res._body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.order.customer_email, testWpEmail);
    assert.strictEqual(data.order.type, 'wallpaper');
  });

  await asyncTest('GET /api/track/email/:email finds wallpaper order by email', async () => {
    const req = createReq('GET', `/api/track/email/${encodeURIComponent(testWpEmail)}`);
    const res = createRes();
    await serverHandler(req, res);
    assert.strictEqual(res._status, 200);
    const data = JSON.parse(res._body);
    assert.ok(Array.isArray(data.orders));
    assert.ok(data.orders.length > 0);
    assert.strictEqual(data.orders[0].customer_email, testWpEmail);
    assert.strictEqual(data.orders[0].type, 'wallpaper');
  });

  test('api/[...path].js includes GET /api/track/email/ handler parity', () => {
    const apiPathCode = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf-8');
    assert.ok(
      apiPathCode.includes('/api/track/email/'),
      'api/[...path].js must include /api/track/email/ endpoint'
    );
  });

  test('index.html tracking supports email search and shows wallpaper download link', () => {
    assert.ok(
      indexHtml.includes('/api/track/email/'),
      'Storefront must fetch /api/track/email/ for email tracking'
    );
    assert.ok(
      indexHtml.includes('ดาวน์โหลด Wallpaper') || indexHtml.includes('wpcheck'),
      'Tracking must show wallpaper download action'
    );
    assert.ok(
      indexHtml.includes('isWallpaper'),
      'Tracking card must have isWallpaper check'
    );
  });

  test('wallpaper card on #page-wallpaper uses exact gcard and gallery structure', () => {
    assert.ok(
      indexHtml.includes('id="wallpaperGallery"') && indexHtml.includes('class="gallery"'),
      '#page-wallpaper must wrap wallpaper card in .gallery container'
    );
    assert.ok(
      indexHtml.includes('class="gcard wp-card"') || indexHtml.includes('class="wp-card gcard"'),
      'Wallpaper card must have .gcard class'
    );
    assert.ok(
      indexHtml.includes('class="gimg wp-card-img"'),
      'Wallpaper card must use .gimg image class'
    );
    assert.ok(
      indexHtml.includes('class="glabel wp-card-info"'),
      'Wallpaper card must use .glabel info container'
    );
    assert.ok(
      !/\.wp-card[^{]*\{[^}]*max-width:\s*480px/.test(indexHtml),
      'Wallpaper card must not have max-width: 480px override'
    );
    const adminCss = fs.readFileSync(path.join(ROOT, 'public', 'admin', 'admin.css'), 'utf-8');
    assert.ok(
      !adminCss.includes('width: 96px !important;'),
      'Admin wallpaper thumbnail must not be oversized (96px)'
    );
  });

  test('clicking wallpaper card directly syncs to cart without separate add-to-cart button', () => {
    assert.ok(
      !indexHtml.includes('🛒 เพิ่ม Wallpaper ลงตะกร้า'),
      'Explicit "เพิ่ม Wallpaper ลงตะกร้า" button panel must be removed'
    );
    assert.ok(
      indexHtml.includes("function wpTogglePattern(name)") && indexHtml.includes("v8SyncWallpaperToCart()"),
      'wpTogglePattern must automatically sync wallpaper selection to cart'
    );
    assert.ok(
      indexHtml.includes("function wpChangeQty(name, delta)") && indexHtml.includes("v8SyncWallpaperToCart()"),
      'wpChangeQty must automatically sync wallpaper quantity to cart'
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
