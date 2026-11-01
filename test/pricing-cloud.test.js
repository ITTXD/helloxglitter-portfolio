/**
 * P1 tests: trusted pricing config, admin publishing, catalog, and storefront
 * hydration. Run with: node test/pricing-cloud.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = ''; // in-memory fallback
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-pricing-cloud-9999';

const pricingConfig = require('../pricing-config.js');
const patterns = require('../public/data/patterns.js');
const serverHandler = require('../server');
const ROOT = path.join(__dirname, '..');
const ADMIN_COOKIE = `admin_session=${process.env.SESSION_SECRET}`;

let PASSED = 0;
let FAILED = 0;

async function test(name, fn) {
  try {
    await fn();
    PASSED++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    FAILED++;
    console.error(`  ❌ ${name}:`, err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMemoryStore() {
  let current = null;
  const history = new Map();
  let queue = Promise.resolve();
  return {
    cacheKey: 'pricing-test-' + Math.random().toString(36).slice(2),
    async loadConfigDoc() { return clone(current); },
    publish(expectedVersion, configDoc, historyDoc) {
      const run = queue.then(async () => {
        const actual = Number(current && current.version) || 0;
        if (actual !== expectedVersion) {
          const err = new Error('version conflict');
          err.code = 'VERSION_CONFLICT';
          err.current_version = actual;
          throw err;
        }
        current = clone(configDoc);
        history.set(String(configDoc.version), clone(historyDoc));
        return clone(configDoc);
      });
      queue = run.catch(() => {});
      return run;
    },
    async getHistory(version) {
      return clone(history.get(String(version)) || null);
    },
    async listHistory(limit) {
      return Array.from(history.values())
        .sort((a, b) => Number(b.version) - Number(a.version))
        .slice(0, limit)
        .map(clone);
    }
  };
}

function baseBody(version) {
  return {
    version: version,
    pricing: {
      base: { 'bag|Merilah Pink|15 × 16 inch': 299 },
      promos: []
    },
    tier: {
      enabled: false,
      selectedGroups: [],
      productRules: {},
      groupPercent: {},
      groupModes: {}
    },
    shipping: {
      base: 40,
      extra: 25,
      rules: [{ postcode: '10240', province: '', district: '', enabled: true }]
    }
  };
}

function createReq(method, url, body, cookies) {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', cookie: cookies || '' },
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
      res._headers = Object.assign({}, res._headers, headers);
    },
    end: (body) => { res._body = body; }
  };
  return res;
}

async function callApi(method, url, body, cookies) {
  const req = createReq(method, url, body, cookies);
  const res = createRes();
  await serverHandler(req, res);
  let data = null;
  try { data = JSON.parse(res._body); } catch (e) {}
  return { status: res._status, data: data, body: res._body };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    _map: map
  };
}

function loadCloudScript() {
  const code = fs.readFileSync(path.join(ROOT, 'public/data/pricing-cloud.js'), 'utf8');
  const local = makeStorage();
  const session = makeStorage();
  const events = [];
  let reloads = 0;
  let fetches = 0;
  let fetchResponse = null;
  const window = {
    __HLG_PRICING_CLOUD_NO_AUTO__: true,
    localStorage: local,
    sessionStorage: session,
    location: {
      search: '',
      reload() { reloads++; }
    },
    document: { body: { classList: { contains() { return false; } } } },
    setTimeout(fn) { fn(); },
    console: { warn() {}, log() {} },
    CustomEvent: function (type, options) { this.type = type; this.detail = options && options.detail; },
    dispatchEvent(event) { events.push(event); },
    fetch: function (url) {
      fetches++;
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve(fetchResponse); }
      });
    }
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(code, window, { filename: 'pricing-cloud.js' });
  return {
    window,
    local,
    session,
    events,
    cloud: window.hlgPricingCloud,
    reloads() { return reloads; },
    fetches() { return fetches; },
    setFetchResponse(value) { fetchResponse = value; }
  };
}

function cloudPayload(version) {
  return {
    success: true,
    published: true,
    version: version,
    updated_at: '2026-10-25T10:00:00.000Z',
    updated_by: 'admin',
    pricing: {
      base: { 'bag|Merilah Pink|15 × 16 inch': 299 },
      promos: [{ id: 'p1', target: 'type:bag', mode: 'amount', value: 50, skus: [], enabled: true }]
    },
    tier: {
      enabled: false,
      selectedGroups: [],
      productRules: {},
      groupPercent: {},
      groupModes: {}
    },
    shipping: {
      base: 40,
      extra: 25,
      rules: [{ postcode: '10240', province: '', district: '', enabled: true }]
    }
  };
}

async function run() {
  console.log('========================================');
  console.log('  TEST: Pricing Config + Cloud Catalog');
  console.log('========================================\n');

  console.log('── 1. BUILT-IN DATA + CONFIG VALIDATION ──');

  await test('patterns.js can be required from Node without changing browser globals', async () => {
    assert.strictEqual(patterns.ALL_PATTERNS.length, 46);
    assert.strictEqual(patterns.STICKER_PATTERNS.length, 10);
    assert.strictEqual(typeof patterns.getShippingCost, 'function');
  });

  await test('default config is version 0 and uses server defaults', async () => {
    const config = pricingConfig.defaultConfig();
    assert.strictEqual(config.version, 0);
    assert.strictEqual(config.published, false);
    assert.deepStrictEqual(config.pricing, { base: {}, promos: [] });
    assert.strictEqual(config.shipping.base, 40);
    assert.strictEqual(config.shipping.extra, 25);
    assert.strictEqual(config.tier.enabled, false);
  });

  await test('valid config is sanitized and keeps canonical/legacy SKU keys', async () => {
    const body = baseBody(0);
    body.pricing.base['["bag","Merilah Pink","15 × 16 inch"]'] = 279;
    body.pricing.promos.push({
      id: 'p1', target: 'type:bag', mode: 'percent', value: 10,
      skus: [], label: 'ลดกระเป๋า', start: '2026-10-01T00:00', end: '2026-10-31T23:59',
      enabled: true, updated: 123
    });
    const result = pricingConfig.sanitizeConfigInput(body, { requireSections: true });
    assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
    assert.strictEqual(result.value.pricing.base['bag|Merilah Pink|15 × 16 inch'], 299);
    assert.strictEqual(result.value.pricing.base['["bag","Merilah Pink","15 × 16 inch"]'], 279);
    assert.strictEqual(result.value.pricing.promos[0].value, 10);
    assert.strictEqual(result.value.shipping.rules[0].postcode, '10240');
  });

  await test('negative price, >100 percent, empty selected promo and bad postcode are rejected', async () => {
    const negative = baseBody(0);
    negative.pricing.base['bag|X|S'] = -1;
    assert.strictEqual(pricingConfig.sanitizeConfigInput(negative, { requireSections: true }).ok, false);

    const percent = baseBody(0);
    percent.pricing.promos.push({ target: 'all', mode: 'percent', value: 101, skus: [] });
    assert.strictEqual(pricingConfig.sanitizeConfigInput(percent, { requireSections: true }).ok, false);

    const selected = baseBody(0);
    selected.pricing.promos.push({ target: 'selected', mode: 'amount', value: 10, skus: [] });
    assert.strictEqual(pricingConfig.sanitizeConfigInput(selected, { requireSections: true }).ok, false);

    const postcode = baseBody(0);
    postcode.shipping.rules = [{ postcode: '123456', province: '' }];
    assert.strictEqual(pricingConfig.sanitizeConfigInput(postcode, { requireSections: true }).ok, false);
  });

  await test('dangerous object keys cannot become price overrides', async () => {
    const body = baseBody(0);
    body.pricing.base = JSON.parse('{"__proto__":1}');
    const result = pricingConfig.sanitizeConfigInput(body, { requireSections: true });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((x) => x.field.indexOf('base') >= 0));
  });

  console.log('\n── 2. PUBLISH / VERSION CONFLICT / RESTORE ──');

  const store = createMemoryStore();
  await test('loadConfig returns version 0 before first publish', async () => {
    const config = await pricingConfig.loadConfig(store);
    assert.strictEqual(config.version, 0);
    assert.strictEqual(config.published, false);
  });

  await test('publish creates version 1 and writes history', async () => {
    const saved = await pricingConfig.publishConfig(store, baseBody(0), 'tester');
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.pricing.base['bag|Merilah Pink|15 × 16 inch'], 299);
    assert.strictEqual(saved.updated_by, 'tester');
    const loaded = await pricingConfig.loadConfig(store);
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.published, true);
    const history = await pricingConfig.listHistory(store, 10);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].version, 1);
    assert.strictEqual(history[0].summary.shipping_rules, 1);
  });

  await test('stale version is rejected with VERSION_CONFLICT and current version', async () => {
    let error = null;
    try {
      await pricingConfig.publishConfig(store, baseBody(0), 'tester');
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.strictEqual(error.code, 'VERSION_CONFLICT');
    assert.strictEqual(error.current_version, 1);
  });

  await test('publish version 2 then restore version 1 as a new version 3', async () => {
    const changed = baseBody(1);
    changed.pricing.base = { 'bag|Merilah Pink|15 × 16 inch': 259 };
    const v2 = await pricingConfig.publishConfig(store, changed, 'tester');
    assert.strictEqual(v2.version, 2);

    const restored = await pricingConfig.restoreConfig(store, { version: 1, current_version: 2 }, 'tester');
    assert.strictEqual(restored.version, 3);
    assert.strictEqual(restored.pricing.base['bag|Merilah Pink|15 × 16 inch'], 299);

    const history = await pricingConfig.listHistory(store, 10);
    assert.strictEqual(history[0].version, 3);
    assert.strictEqual(history[0].restored_from, 1);
  });

  await test('invalid publish input is rejected before touching storage', async () => {
    let error = null;
    try {
      await pricingConfig.publishConfig(store, { version: 3, pricing: { base: { x: -5 }, promos: [] }, tier: {}, shipping: {} }, 'tester');
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.strictEqual(error.code, 'INVALID_CONFIG');
    assert.ok(Array.isArray(error.details));
  });

  console.log('\n── 3. TRUSTED CATALOG ──');

  await test('catalog includes 46 bags + 10 stickers + 1 wallpaper', async () => {
    const catalog = pricingConfig.buildCatalog(pricingConfig.defaultConfig(), {});
    assert.strictEqual(catalog.count, 57);
    assert.strictEqual(catalog.items.filter((x) => x.type === 'bag').length, 46);
    assert.strictEqual(catalog.items.filter((x) => x.type === 'sticker').length, 10);
    assert.strictEqual(catalog.items.filter((x) => x.type === 'wallpaper').length, 1);
  });

  await test('custom bags get a custom|category|productId alias and resolve prices', async () => {
    const config = pricingConfig.defaultConfig();
    config.pricing.base['bag|Custom Tote|15 × 16 inch'] = 450;
    const catalog = pricingConfig.buildCatalog(config, {
      customProducts: [{ id: 'prod_custom_1', category_id: 'bag', name: 'Custom Tote', size: '15 × 16 inch', size_key: 'normal', price: 399 }]
    });
    const item = catalog.items.find((x) => x.name === 'Custom Tote');
    assert.ok(item);
    assert.strictEqual(item.sku, 'bag|Custom Tote|15 × 16 inch');
    assert.ok(item.aliases.indexOf('custom|bag|prod_custom_1') >= 0);
    assert.strictEqual(item.catalog_price, 399);
    assert.strictEqual(item.price, 450);
  });

  await test('duplicate SKUs in the real catalog are rejected', async () => {
    let error = null;
    try {
      pricingConfig.buildCatalog(pricingConfig.defaultConfig(), {
        customProducts: [{ id: 'dup_1', category_id: 'bag', name: 'Merilah Pink', size: '15 × 16 inch', size_key: 'normal', price: 399 }]
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error);
    assert.strictEqual(error.code, 'DUPLICATE_SKU');
    assert.ok(error.details.duplicates.indexOf('bag|Merilah Pink|15 × 16 inch') >= 0);
  });

  console.log('\n── 4. SERVER API ENDPOINTS ──');

  await test('GET /api/pricing/config is public and starts unpublished', async () => {
    const res = await callApi('GET', '/api/pricing/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.version, 0);
    assert.strictEqual(res.data.published, false);
  });

  await test('PUT /api/pricing/config rejects unauthenticated requests', async () => {
    const res = await callApi('PUT', '/api/pricing/config', baseBody(0));
    assert.strictEqual(res.status, 401);
  });

  await test('PUT /api/pricing/config rejects invalid data with 400 details', async () => {
    const bad = baseBody(0);
    bad.pricing.base['bag|X|S'] = -99;
    const res = await callApi('PUT', '/api/pricing/config', bad, ADMIN_COOKIE);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.code, 'INVALID_CONFIG');
    assert.ok(Array.isArray(res.data.details));
  });

  await test('admin can publish v1 and GET returns it', async () => {
    const res = await callApi('PUT', '/api/pricing/config', baseBody(0), ADMIN_COOKIE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.version, 1);
    const get = await callApi('GET', '/api/pricing/config');
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.data.version, 1);
    assert.strictEqual(get.data.pricing.base['bag|Merilah Pink|15 × 16 inch'], 299);
  });

  await test('stale admin publish returns 409 + current_version', async () => {
    const res = await callApi('PUT', '/api/pricing/config', baseBody(0), ADMIN_COOKIE);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.code, 'VERSION_CONFLICT');
    assert.strictEqual(res.data.current_version, 1);
  });

  await test('GET /api/pricing/config/history requires admin and returns summaries', async () => {
    const denied = await callApi('GET', '/api/pricing/config/history');
    assert.strictEqual(denied.status, 401);
    const res = await callApi('GET', '/api/pricing/config/history?limit=10', null, ADMIN_COOKIE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.history[0].version, 1);
    assert.strictEqual(res.data.history[0].summary.base_prices, 1);
  });

  await test('admin can restore v1 as v2 through the API', async () => {
    const res = await callApi('POST', '/api/pricing/config/restore', { version: 1, current_version: 1 }, ADMIN_COOKIE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.version, 2);
    assert.strictEqual(res.data.restored, true);
    const get = await callApi('GET', '/api/pricing/config');
    assert.strictEqual(get.data.version, 2);
  });

  let customProductId = null;
  await test('POST /api/products adds a trusted custom product to the catalog', async () => {
    const created = await callApi('POST', '/api/products', {
      category_id: 'bag',
      name: 'Cloud Tote',
      price: 389,
      size: '15 × 16 inch',
      size_key: 'normal'
    }, ADMIN_COOKIE);
    assert.strictEqual(created.status, 200);
    customProductId = created.data.product.id;
    const res = await callApi('GET', '/api/pricing/catalog');
    assert.strictEqual(res.status, 200);
    const item = res.data.items.find((x) => x.name === 'Cloud Tote');
    assert.ok(item);
    assert.strictEqual(item.product_id, customProductId);
    assert.ok(item.aliases.indexOf('custom|bag|' + customProductId) >= 0);
    assert.strictEqual(res.data.pricing_version, 2);
  });

  await test('GET /api/pricing/catalog returns 409 when the real catalog has duplicate SKUs', async () => {
    await callApi('POST', '/api/products', {
      category_id: 'bag',
      name: 'Merilah Pink',
      price: 399,
      size: '15 × 16 inch',
      size_key: 'normal'
    }, ADMIN_COOKIE);
    const res = await callApi('GET', '/api/pricing/catalog');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.code, 'DUPLICATE_SKU');
    assert.ok(res.data.details.duplicates.length > 0);
  });

  console.log('\n── 5. STOREFRONT CLOUD HYDRATION ──');

  await test('cloud script writes all three local keys once and reloads', async () => {
    const harness = loadCloudScript();
    const result = harness.cloud.applyConfig(cloudPayload(3), { force: true, reload: true });
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.reload, true);
    const pricing = JSON.parse(harness.local.getItem('hlg_pricing_v1'));
    const tier = JSON.parse(harness.local.getItem('hlg_quantity_promo_v1'));
    const shipping = JSON.parse(harness.local.getItem('hlg_shipping_v1'));
    assert.strictEqual(pricing.base['bag|Merilah Pink|15 × 16 inch'], 299);
    assert.strictEqual(tier.enabled, false);
    assert.strictEqual(shipping.rules[0].postcode, '10240');
    assert.strictEqual(harness.local.getItem('hlg_shipping_flash_image_20260928_v1'), '1');
    assert.strictEqual(harness.local.getItem('hlg_pricing_cloud_version_v1'), '3');
    assert.strictEqual(harness.session.getItem('hlg_cloud_reload_3'), '1');
  });

  await test('second hydration does not rewrite or reload when values are equal', async () => {
    const harness = loadCloudScript();
    harness.cloud.applyConfig(cloudPayload(3), { force: true, reload: true });
    const before = harness.local.getItem('hlg_pricing_v1');
    const result = harness.cloud.applyConfig(cloudPayload(3), { force: true, reload: true });
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.reload, false);
    assert.strictEqual(harness.local.getItem('hlg_pricing_v1'), before);
  });

  await test('object key order does not trigger a second reload', async () => {
    const harness = loadCloudScript();
    harness.cloud.applyConfig(cloudPayload(3), { force: true, reload: true });
    const reordered = cloudPayload(3);
    reordered.shipping = {
      rules: [{ enabled: true, district: '', province: '', postcode: '10240' }],
      extra: 25,
      base: 40
    };
    const result = harness.cloud.applyConfig(reordered, { force: true, reload: true });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.reload, false);
  });

  await test('unpublished config never overwrites local values', async () => {
    const harness = loadCloudScript();
    const result = harness.cloud.applyConfig({
      success: true, published: false, version: 0,
      pricing: { base: {}, promos: [] }, tier: {}, shipping: {}
    }, { force: true, reload: true });
    assert.strictEqual(result.reason, 'not-published');
    assert.strictEqual(harness.local.getItem('hlg_pricing_v1'), null);
  });

  await test('admin sessions are skipped unless the preview flag is forced', async () => {
    const harness = loadCloudScript();
    harness.local.setItem('hlg_admin_session_v2', '1');
    const skipped = harness.cloud.applyConfig(cloudPayload(4), { reload: true });
    assert.strictEqual(skipped.reason, 'admin-session');
    assert.strictEqual(harness.local.getItem('hlg_pricing_v1'), null);
    const forced = harness.cloud.applyConfig(cloudPayload(4), { force: true, reload: true });
    assert.strictEqual(forced.applied, true);
    assert.strictEqual(forced.reload, true);
  });

  await test('sync fetches /api/pricing/config and applies it', async () => {
    const harness = loadCloudScript();
    harness.setFetchResponse(cloudPayload(5));
    await harness.cloud.sync({ force: true, reload: true });
    assert.strictEqual(harness.fetches(), 1);
    assert.strictEqual(harness.local.getItem('hlg_pricing_cloud_version_v1'), '5');
    assert.strictEqual(harness.reloads(), 1);
  });

  await test('opting out disables hydration without fetching', async () => {
    const harness = loadCloudScript();
    harness.local.setItem('hlg_pricing_cloud_optout_v1', '1');
    const result = await harness.cloud.sync({ force: true, reload: true });
    assert.strictEqual(result.reason, 'opt-out');
    assert.strictEqual(harness.fetches(), 0);
  });

  console.log('\n── 6. ADMIN UI + API PARITY ──');

  await test('admin portal contains the cloud pricing manager and wiring', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
    assert.ok(html.includes('cloudPricingManagerContainer'));
    assert.ok(js.includes('hlgRenderCloudPricing'));
    assert.ok(js.includes('/api/pricing/config'));
    assert.ok(js.includes('/api/pricing/config/history'));
    assert.ok(js.includes('/api/pricing/config/restore'));
  });

  await test('storefront loads the hydration script exactly once', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    const matches = html.match(/pricing-cloud\.js/g) || [];
    assert.strictEqual(matches.length, 1);
  });

  await test('server and Vercel API expose the same pricing routes and use the shared service', async () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const api = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
    for (const file of [server, api]) {
      assert.ok(file.includes("'/api/pricing/config'"));
      assert.ok(file.includes("'/api/pricing/config/history'"));
      assert.ok(file.includes("'/api/pricing/config/restore'"));
      assert.ok(file.includes("'/api/pricing/catalog'"));
      assert.ok(file.includes("pricingConfig.publishConfig"));
      assert.ok(file.includes("pricingConfig.restoreConfig"));
      assert.ok(file.includes("pricingConfig.buildCatalog"));
      assert.ok(file.includes("VERSION_CONFLICT"));
    }
    assert.ok(api.includes('runTransaction'));
    assert.ok(api.includes('pricing_config_history'));
  });

  console.log('\n========================================');
  console.log(`  RESULT: ${PASSED} passed, ${FAILED} failed`);
  console.log('========================================');
  if (FAILED > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
