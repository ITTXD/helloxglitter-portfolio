/**
 * P2 tests: server quote API, quote storage/TTL, coupon validation, rate limit,
 * browser shadow mode, and browser/server engine parity.
 *
 * Run with: node test/pricing-quote.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = '';
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-pricing-quote-9999';

const pricingConfig = require('../pricing-config.js');
const quoteService = require('../quote-service.js');
const couponService = require('../coupon-service.js');
const HLGPricing = require('../public/data/pricing-engine.js');
const serverHandler = require('../server');

const ROOT = path.join(__dirname, '..');
const ADMIN_COOKIE = `admin_session=${process.env.SESSION_SECRET}`;
const BAG_SKU = 'bag|Merilah Pink|15 × 16 inch';
const BAG_LEGACY = '["bag","Merilah Pink","15 × 16 inch"]';
const ADDRESS = 'สมหญิง ใจดี\n99/12 ถนนทดสอบ\nกรุงเทพฯ 10240';

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function basePublishBody(version) {
  return {
    version: version,
    pricing: {
      base: { [BAG_SKU]: 299 },
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

function createMemoryStore() {
  let current = null;
  const history = new Map();
  let queue = Promise.resolve();
  return {
    cacheKey: 'pricing-quote-test-' + Math.random().toString(36).slice(2),
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

function createQuoteStore() {
  const map = new Map();
  return {
    async saveQuote(doc) {
      map.set(doc.quote_id, clone(doc));
      return clone(doc);
    },
    async getQuote(quoteId) {
      return clone(map.get(quoteId) || null);
    },
    _map: map
  };
}

function quoteConfig() {
  const config = pricingConfig.defaultConfig();
  config.version = 7;
  config.published = true;
  config.pricing = { base: { [BAG_SKU]: 299 }, promos: [] };
  config.shipping = {
    base: 40,
    extra: 25,
    rules: [{ postcode: '10240', province: '', district: '', enabled: true }]
  };
  config.features = {
    quote_preview: { enabled: true, mode: 'shadow', groups: ['all'] }
  };
  return config;
}

function quoteContext(config) {
  return pricingConfig.buildCatalogContext(config, {});
}

async function issueFixture(options) {
  const opts = options || {};
  const config = opts.config || quoteConfig();
  const context = quoteContext(config);
  const store = opts.store || createQuoteStore();
  const result = await quoteService.issueQuote({
    body: opts.body || {
      items: [{ sku: BAG_SKU, qty: 2, price: 1 }],
      address: ADDRESS
    },
    config: config,
    pricing: context.pricing,
    tier: config.tier,
    shipping: config.shipping,
    catalog: context.engine,
    store: store,
    couponValidator: opts.couponValidator,
    lineUserId: opts.lineUserId,
    now: opts.now == null ? Date.UTC(2026, 9, 25, 10, 0, 0) : opts.now
  });
  return Object.assign({ store: store, config: config, context: context }, result);
}

function createReq(method, url, body, cookies) {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', cookie: cookies || '', 'x-forwarded-for': '203.0.113.50' },
    socket: { remoteAddress: '127.0.0.1' },
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
      res._headers = Object.assign({}, res._headers, headers || {});
    },
    setHeader: (key, value) => { res._headers[key] = value; },
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
  return { status: res._status, data: data, body: res._body, headers: res._headers };
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

function createFakeQuoteDom(address) {
  let inserted = null;
  const pageCart = { classList: { contains(name) { return name === 'active'; } } };
  const card = { insertAdjacentHTML() {} };
  const totalRow = {
    closest() { return card; },
    insertAdjacentElement(position, node) { inserted = node; }
  };
  const content = {
    querySelector(selector) { return selector === '.v8cf-row.total' ? totalRow : null; }
  };
  const addressEl = { value: address || '' };
  const document = {
    head: { appendChild() {} },
    body: { classList: { contains() { return false; } } },
    getElementById(id) {
      if (id === 'page-cart') return pageCart;
      if (id === 'v8CartContent') return content;
      if (id === 'v8cfAddr1') return addressEl;
      if (id === 'hlgQuotePreviewPanel') return inserted;
      return null;
    },
    querySelector() { return null; },
    addEventListener() {},
    createElement(tag) {
      if (tag === 'div') {
        return {
          _html: '',
          set innerHTML(value) {
            this._html = value;
            this.firstChild = { id: 'hlgQuotePreviewPanel', _html: value, remove() {} };
          },
          get innerHTML() { return this._html; }
        };
      }
      return { id: '', textContent: '', appendChild() {} };
    }
  };
  return { document, addressEl, getInserted() { return inserted; } };
}

function loadBrowserQuoteScript(options) {
  const opts = options || {};
  const code = fs.readFileSync(path.join(ROOT, 'public/data/pricing-quote.js'), 'utf8');
  const local = opts.localStorage || makeStorage();
  const session = makeStorage();
  const timers = [];
  const defaultDocument = {
    body: { classList: { contains() { return false; } } },
    getElementById() { return null; }
  };
  const window = {
    __HLG_QUOTE_NO_AUTO__: opts.auto !== true,
    HLGPricing: HLGPricing,
    localStorage: local,
    sessionStorage: session,
    location: { search: opts.search || '' },
    document: opts.document || defaultDocument,
    setTimeout(fn, ms) {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cancelled = true;
    },
    fetch: opts.fetch,
    AbortController: opts.AbortController,
    console: { info() {}, warn() {}, log() {} }
  };
  if (opts.lineUser) {
    window.getLineUser = function () { return opts.lineUser; };
  }
  window.window = window;
  vm.createContext(window);
  vm.runInContext(code, window, { filename: 'pricing-quote.js' });
  return { window, local, session, api: window.hlgQuotePreview, timers };
}

function createBrowserFetchState(config, context) {
  const calls = [];
  const quoteStore = createQuoteStore();
  let serverQuote = null;

  function response(data, status) {
    return Promise.resolve({
      ok: (status || 200) < 400,
      status: status || 200,
      json() { return Promise.resolve(clone(data)); }
    });
  }

  async function fetch(url, options) {
    const method = (options && options.method) || 'GET';
    calls.push({ url, method, body: options && options.body });
    if (url === '/api/pricing/config' && method === 'GET') {
      return response(Object.assign({ success: true }, config));
    }
    if (url === '/api/pricing/catalog' && method === 'GET') {
      return response(Object.assign({ success: true }, context.catalog));
    }
    if (url === '/api/quotes' && method === 'POST') {
      const body = JSON.parse(options.body);
      const issued = await quoteService.issueQuote({
        body: body,
        config: config,
        pricing: context.pricing,
        tier: config.tier,
        shipping: config.shipping,
        catalog: context.engine,
        store: quoteStore,
        lineUserId: body.line_user_id,
        now: Date.now()
      });
      serverQuote = issued.response;
      return response(issued.response);
    }
    return response({ success: false, error: 'not found' }, 404);
  }

  return {
    fetch,
    calls,
    getServerQuote() { return serverQuote; },
    quoteStore
  };
}

async function run() {
  console.log('========================================');
  console.log('  TEST: Quote API + Browser Shadow Mode');
  console.log('========================================\n');

  console.log('── 1. FEATURE CONFIG ──');

  await test('default config enables shadow quote preview for all groups', async () => {
    const config = pricingConfig.defaultConfig();
    assert.deepStrictEqual(config.features.quote_preview, {
      enabled: true,
      mode: 'shadow',
      groups: ['all']
    });
  });

  await test('feature config is sanitized, localized, and invalid modes are rejected', async () => {
    const body = basePublishBody(0);
    body.features = {
      quote_preview: { enabled: 'yes', mode: 'active', groups: ['public', 'public', 'line:U123'] }
    };
    const sanitized = pricingConfig.sanitizeConfigInput(body, { requireSections: true });
    assert.strictEqual(sanitized.ok, false);
    assert.ok(sanitized.errors.some((entry) => entry.field === 'features.quote_preview.enabled'));

    const valid = basePublishBody(0);
    valid.features = {
      quote_preview: { enabled: false, mode: 'active', groups: ['public', 'public', 'line:U123'] }
    };
    const ok = pricingConfig.sanitizeConfigInput(valid, { requireSections: true });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok.errors));
    assert.strictEqual(ok.value.features.quote_preview.enabled, false);
    assert.strictEqual(ok.value.features.quote_preview.mode, 'active');
    assert.deepStrictEqual(ok.value.features.quote_preview.groups, ['public', 'line:U123']);

    const badMode = basePublishBody(0);
    badMode.features = { quote_preview: { enabled: true, mode: 'live' } };
    assert.strictEqual(pricingConfig.sanitizeConfigInput(badMode, { requireSections: true }).ok, false);
  });

  const configStore = createMemoryStore();
  await test('publishing without features preserves the current rollout flag', async () => {
    const v1 = await pricingConfig.publishConfig(configStore, basePublishBody(0), 'tester');
    assert.strictEqual(v1.version, 1);
    assert.strictEqual(v1.features.quote_preview.enabled, true);

    const v2Body = basePublishBody(1);
    v2Body.features = {
      quote_preview: { enabled: false, mode: 'active', groups: ['admin', 'line:U999'] }
    };
    const v2 = await pricingConfig.publishConfig(configStore, v2Body, 'tester');
    assert.strictEqual(v2.version, 2);
    assert.strictEqual(v2.features.quote_preview.enabled, false);

    const v3 = await pricingConfig.publishConfig(configStore, basePublishBody(2), 'tester');
    assert.strictEqual(v3.version, 3);
    assert.strictEqual(v3.features.quote_preview.enabled, false);
    assert.strictEqual(v3.features.quote_preview.mode, 'active');
    assert.deepStrictEqual(v3.features.quote_preview.groups, ['admin', 'line:U999']);

    const loaded = await pricingConfig.loadConfig(configStore, { force: true });
    assert.strictEqual(loaded.features.quote_preview.enabled, false);
  });

  await test('history summaries include quote preview rollout state', async () => {
    const rows = await pricingConfig.listHistory(configStore, 10);
    assert.strictEqual(rows[0].version, 3);
    assert.strictEqual(rows[0].summary.quote_preview_enabled, false);
    assert.strictEqual(rows[0].summary.quote_preview_mode, 'active');
  });

  await test('restoring an old pricing version preserves the current quote rollout', async () => {
    const restored = await pricingConfig.restoreConfig(configStore, { version: 1, current_version: 3 }, 'tester');
    assert.strictEqual(restored.version, 4);
    assert.strictEqual(restored.pricing.base[BAG_SKU], 299);
    assert.strictEqual(restored.features.quote_preview.enabled, false);
    assert.strictEqual(restored.features.quote_preview.mode, 'active');
    assert.deepStrictEqual(restored.features.quote_preview.groups, ['admin', 'line:U999']);
  });

  console.log('\n── 2. CATALOG CONTEXT ──');

  await test('buildCatalogContext exposes the trusted engine and public catalog together', async () => {
    const config = quoteConfig();
    const context = quoteContext(config);
    assert.strictEqual(context.catalog.count, 57);
    assert.strictEqual(context.engine.items.length, 57);
    assert.strictEqual(context.engine.lookup({ sku: BAG_SKU }).sku, BAG_SKU);
    assert.strictEqual(context.pricing.base[BAG_SKU], 299);
  });

  console.log('\n── 3. QUOTE SERVICE + TTL + COUPON ──');

  await test('server quote is computed from catalog prices and ignores client price fields', async () => {
    const result = await issueFixture();
    const response = result.response;
    assert.strictEqual(response.success, true);
    assert.ok(response.quote_id.indexOf('q_') === 0);
    assert.strictEqual(response.quote_token.length, 64);
    assert.strictEqual(response.pricing_version, 7);
    assert.strictEqual(response.item_discount, 0);
    assert.strictEqual(response.subtotal, 598);
    assert.strictEqual(response.shipping_cost, 65);
    assert.strictEqual(response.grand_total, 663);
    assert.strictEqual(response.items[0].unit_price, 299);
    assert.strictEqual(response.items[0].qty, 2);
  });

  await test('quote doc stores hashes, canonical items, snapshots, TTL, and used_at:null', async () => {
    const result = await issueFixture();
    const doc = result.doc;
    assert.strictEqual(doc.used_at, null);
    assert.strictEqual(doc.status, 'open');
    assert.deepStrictEqual(doc.requested_items, [{ sku: BAG_SKU, qty: 2 }]);
    assert.strictEqual(doc.quote_token_hash.length, 64);
    assert.notStrictEqual(doc.quote_token_hash, result.response.quote_token);
    assert.strictEqual(doc.expires_at_ms - Date.parse(doc.created_at), quoteService.QUOTE_TTL_MS);
    assert.ok(doc.address_hash.length === 64);
    assert.strictEqual(doc.address, undefined);
    assert.strictEqual(doc.line_user_id, undefined);
    assert.strictEqual(doc.line_display_name, undefined);
    assert.strictEqual(doc.line_user_hash, null);
    assert.strictEqual(doc.pricing_snapshot.pricing_version, 7);
    assert.ok(doc.pricing_snapshot.config_hash.length === 64);
    assert.strictEqual(doc.pricing_snapshot.item_prices[0].unit_price, 299);
    assert.strictEqual(doc.totals.grand_total, 663);
    assert.strictEqual(doc.grand_total, 663);
  });

  await test('quote token and LINE owner are verified, and used quotes are rejected', async () => {
    const result = await issueFixture({ lineUserId: 'U_P2_OWNER' });
    assert.ok(result.doc.line_user_hash.length === 64);
    assert.strictEqual(result.doc.line_user_id, undefined);
    const now = Date.parse(result.doc.created_at);
    const found = await quoteService.getQuote({
      store: result.store,
      quoteId: result.doc.quote_id,
      token: result.response.quote_token,
      lineUserId: 'U_P2_OWNER',
      now: now
    });
    assert.strictEqual(found.quote_id, result.doc.quote_id);

    await assert.rejects(
      quoteService.getQuote({ store: result.store, quoteId: result.doc.quote_id, token: 'bad-token', now: now }),
      (err) => err.code === 'QUOTE_TOKEN_MISMATCH'
    );
    await assert.rejects(
      quoteService.getQuote({
        store: result.store,
        quoteId: result.doc.quote_id,
        token: result.response.quote_token,
        lineUserId: 'U_OTHER',
        now: now
      }),
      (err) => err.code === 'QUOTE_OWNER_MISMATCH'
    );

    const used = clone(result.doc);
    used.used_at = new Date().toISOString();
    used.status = 'used';
    await result.store.saveQuote(used);
    await assert.rejects(
      quoteService.getQuote({ store: result.store, quoteId: used.quote_id, token: result.response.quote_token }),
      (err) => err.code === 'QUOTE_USED'
    );
  });

  await test('an expired quote cannot be read, but the same request can be re-quoted', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    const result = await issueFixture({ now: now });
    assert.strictEqual(quoteService.isQuoteExpired(result.doc, now + quoteService.QUOTE_TTL_MS - 1), false);
    assert.strictEqual(quoteService.isQuoteExpired(result.doc, now + quoteService.QUOTE_TTL_MS), true);
    await assert.rejects(
      quoteService.getQuote({
        store: result.store,
        quoteId: result.doc.quote_id,
        token: result.response.quote_token,
        now: now + quoteService.QUOTE_TTL_MS + 1
      }),
      (err) => err.code === 'QUOTE_EXPIRED'
    );

    const reissued = await issueFixture({ now: now + quoteService.QUOTE_TTL_MS + 1, store: result.store });
    assert.notStrictEqual(reissued.doc.quote_id, result.doc.quote_id);
    assert.strictEqual(reissued.response.grand_total, result.response.grand_total);
    assert.strictEqual(quoteService.isQuoteExpired(reissued.doc, now + quoteService.QUOTE_TTL_MS + 2), false);
  });

  await test('coupon validation uses the server-computed subtotal, caps discounts, and never goes negative', async () => {
    let seen = null;
    const withCoupon = await issueFixture({
      body: {
        items: [{ sku: BAG_SKU, qty: 2 }],
        address: ADDRESS,
        coupon_code: 'HXG-CPN-P2'
      },
      couponValidator: async (input) => {
        seen = input;
        return {
          valid: true,
          coupon: {
            code: 'HXG-CPN-P2',
            discount_amount: 700,
            redeem_category: 'bag',
            line_user_id: 'U_P2_OWNER'
          }
        };
      },
      lineUserId: 'U_P2_OWNER'
    });
    assert.ok(seen);
    assert.strictEqual(seen.subtotal, 598);
    assert.strictEqual(seen.items[0].type, 'bag');
    assert.strictEqual(withCoupon.response.coupon_discount, 598);
    assert.strictEqual(withCoupon.response.grand_total, 65);
    assert.ok(withCoupon.response.grand_total >= 0);
    assert.strictEqual(withCoupon.response.coupon.code, 'HXG-CPN-P2');

    await assert.rejects(
      issueFixture({ couponValidator: async () => ({ valid: false, error: 'คูปองหมดอายุ' }), body: { items: [{ sku: BAG_SKU, qty: 1 }], address: '', coupon_code: 'BAD' } }),
      (err) => err.code === 'COUPON_NOT_ELIGIBLE' && err.message === 'คูปองหมดอายุ'
    );
  });

  await test('coupon service failures are wrapped without leaking internal errors', async () => {
    await assert.rejects(
      issueFixture({
        body: { items: [{ sku: BAG_SKU, qty: 1 }], address: ADDRESS, coupon_code: 'DB-DOWN' },
        couponValidator: async () => { throw new Error('firestore secret detail'); }
      }),
      (err) => err.code === 'QUOTE_SERVICE_UNAVAILABLE' && !err.message.includes('secret')
    );

    const mapped = quoteService.httpError(Object.assign(new Error('firestore secret detail'), {
      code: 'QUOTE_SERVICE_UNAVAILABLE',
      details: { secret: true }
    }));
    assert.strictEqual(mapped.status, 500);
    assert.strictEqual(mapped.body.code, 'QUOTE_SERVICE_UNAVAILABLE');
    assert.ok(!mapped.body.error.includes('secret'));
    assert.strictEqual(mapped.body.details, undefined);

    const unknown = quoteService.httpError(Object.assign(new Error('provider internals'), {
      code: 'PERMISSION_DENIED'
    }));
    assert.strictEqual(unknown.status, 500);
    assert.strictEqual(unknown.body.code, 'QUOTE_ERROR');
    assert.ok(!unknown.body.error.includes('provider internals'));
  });

  await test('quote input limits and duplicate aliases are rejected', async () => {
    const config = quoteConfig();
    const context = quoteContext(config);
    const store = createQuoteStore();
    const base = {
      config,
      pricing: context.pricing,
      tier: config.tier,
      shipping: config.shipping,
      catalog: context.engine,
      store,
      now: Date.UTC(2026, 9, 25, 10, 0, 0)
    };

    await assert.rejects(
      quoteService.issueQuote(Object.assign({ body: { items: [{ sku: BAG_SKU, qty: 0 }], address: '' } }, base)),
      (err) => err.code === 'INVALID_QTY'
    );
    await assert.rejects(
      quoteService.issueQuote(Object.assign({ body: { items: [{ sku: 'does-not-exist', qty: 1 }], address: '' } }, base)),
      (err) => err.code === 'UNKNOWN_ITEM'
    );
    await assert.rejects(
      quoteService.issueQuote(Object.assign({ body: { items: [{ sku: BAG_SKU, qty: 1 }, { sku: BAG_LEGACY, qty: 1 }], address: '' } }, base)),
      (err) => err.code === 'DUPLICATE_ITEM'
    );
    await assert.rejects(
      quoteService.issueQuote(Object.assign({ body: { items: [{ sku: BAG_SKU, qty: 1000 }], address: '' } }, base)),
      (err) => err.code === 'INVALID_QTY'
    );
    await assert.rejects(
      quoteService.issueQuote(Object.assign({
        body: { items: Array.from({ length: quoteService.MAX_ITEMS + 1 }, () => ({ sku: BAG_SKU, qty: 1 })), address: '' }
      }, base)),
      (err) => err.code === 'TOO_MANY_ITEMS'
    );
    await assert.rejects(
      quoteService.issueQuote(Object.assign({ body: { items: [{ sku: BAG_SKU, qty: 1 }], address: 'x'.repeat(quoteService.MAX_ADDRESS_LENGTH + 1) } }, base)),
      (err) => err.code === 'INVALID_ADDRESS'
    );
  });

  await test('per-process rate limiter blocks, reports retry_after, and resets after the window', async () => {
    const limiter = quoteService.createRateLimiter({ max: 2, windowMs: 1000 });
    assert.strictEqual(limiter.check('ip:test', 1000).allowed, true);
    assert.strictEqual(limiter.check('ip:test', 1100).remaining, 0);
    const blocked = limiter.check('ip:test', 1200);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.retry_after, 1);
    assert.strictEqual(limiter.check('ip:other', 1200).allowed, true);
    assert.strictEqual(limiter.check('ip:test', 2001).allowed, true);
    assert.notStrictEqual(quoteService.clientKey(createReq('POST', '/api/quotes')), '');
  });

  console.log('\n── 4. SERVER API ──');

  await test('GET /api/pricing/config exposes feature flags', async () => {
    const res = await callApi('GET', '/api/pricing/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.features.quote_preview.enabled, true);
    assert.strictEqual(res.data.features.quote_preview.mode, 'shadow');
  });

  await test('admin publishes pricing without wiping feature flags', async () => {
    const res = await callApi('PUT', '/api/pricing/config', basePublishBody(0), ADMIN_COOKIE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.version, 1);
    assert.strictEqual(res.data.features.quote_preview.enabled, true);
  });

  let apiQuote = null;
  await test('POST /api/quotes returns a server quote and stores only its token hash', async () => {
    const res = await callApi('POST', '/api/quotes', {
      items: [{ sku: BAG_SKU, qty: 2, price: 1 }],
      address: ADDRESS
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.subtotal, 598);
    assert.strictEqual(res.data.shipping_cost, 65);
    assert.strictEqual(res.data.grand_total, 663);
    assert.strictEqual(res.data.quote_token.length, 64);
    assert.strictEqual(res.headers['Cache-Control'], 'no-store');
    apiQuote = res.data;

    const stored = serverHandler._localMemStore.quotes.find((quote) => quote.quote_id === res.data.quote_id);
    assert.ok(stored);
    assert.strictEqual(stored.quote_token_hash.length, 64);
    assert.ok(!Object.prototype.hasOwnProperty.call(stored, 'quote_token'));
    assert.strictEqual(stored.used_at, null);
    assert.strictEqual(stored.totals.grand_total, 663);
  });

  await test('server quote and a browser engine quote from GET /api/pricing/catalog match', async () => {
    const configRes = await callApi('GET', '/api/pricing/config');
    const catalogRes = await callApi('GET', '/api/pricing/catalog');
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(catalogRes.status, 200);
    const config = configRes.data;
    const harness = loadBrowserQuoteScript();
    const browserEngine = harness.api._test.catalogFromApi(catalogRes.data);
    const mapped = harness.api._test.mapCartItems([
      { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2 }
    ], browserEngine);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(mapped.items)), [{ sku: BAG_SKU, qty: 2 }]);
    const browser = harness.api._test.buildBrowserQuote(
      config,
      browserEngine,
      mapped.items,
      ADDRESS,
      null
    );
    assert.strictEqual(browser.grand_total, apiQuote.grand_total);
    assert.strictEqual(browser.subtotal, apiQuote.subtotal);
    assert.strictEqual(browser.shipping_cost, apiQuote.shipping_cost);
  });

  await test('API coupon quote validates the owner and applies the discount', async () => {
    couponService.inMemoryStore.coupons.set('HXG-CPN-P2API', {
      code: 'HXG-CPN-P2API',
      title: 'ทดสอบ P2',
      line_user_id: 'U_P2_API',
      discount_amount: 100,
      redeem_category: 'bag',
      status: 'active',
      expires_at: '2099-12-31T23:59:00+07:00',
      used_at: null
    });

    const ok = await callApi('POST', '/api/quotes', {
      items: [{ sku: BAG_SKU, qty: 2 }],
      address: ADDRESS,
      coupon_code: 'HXG-CPN-P2API',
      line_user_id: 'U_P2_API'
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.data.coupon_discount, 100);
    assert.strictEqual(ok.data.grand_total, 563);
    assert.strictEqual(ok.data.coupon.code, 'HXG-CPN-P2API');

    const denied = await callApi('POST', '/api/quotes', {
      items: [{ sku: BAG_SKU, qty: 2 }],
      address: ADDRESS,
      coupon_code: 'HXG-CPN-P2API',
      line_user_id: 'U_SOMEONE_ELSE'
    });
    assert.strictEqual(denied.status, 400);
    assert.strictEqual(denied.data.code, 'COUPON_NOT_ELIGIBLE');
  });

  await test('API rejects invalid carts and unknown SKUs without negative totals', async () => {
    const unknown = await callApi('POST', '/api/quotes', {
      items: [{ sku: 'not-in-catalog', qty: 1 }],
      address: ''
    });
    assert.strictEqual(unknown.status, 400);
    assert.strictEqual(unknown.data.code, 'UNKNOWN_ITEM');

    const empty = await callApi('POST', '/api/quotes', { items: [], address: '' });
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(empty.data.code, 'EMPTY_CART');

    const badQty = await callApi('POST', '/api/quotes', {
      items: [{ sku: BAG_SKU, qty: 0 }],
      address: ''
    });
    assert.strictEqual(badQty.status, 400);
    assert.strictEqual(badQty.data.code, 'INVALID_QTY');
  });

  await test('quote API still works when the browser feature flag is off', async () => {
    const current = await callApi('GET', '/api/pricing/config');
    const body = basePublishBody(current.data.version);
    body.features = { quote_preview: { enabled: false, mode: 'shadow', groups: [] } };
    const published = await callApi('PUT', '/api/pricing/config', body, ADMIN_COOKIE);
    assert.strictEqual(published.status, 200);
    assert.strictEqual(published.data.features.quote_preview.enabled, false);

    const quote = await callApi('POST', '/api/quotes', {
      items: [{ sku: BAG_SKU, qty: 1 }],
      address: ADDRESS
    });
    assert.strictEqual(quote.status, 200);
    assert.ok(quote.data.grand_total > 0);
  });

  console.log('\n── 5. BROWSER SHADOW MODE ──');

  await test('storefront loads the shared engine before the quote shadow script', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    const engineAt = html.indexOf('/data/pricing-engine.js');
    const cloudAt = html.indexOf('/data/pricing-cloud.js');
    const quoteAt = html.indexOf('/data/pricing-quote.js');
    assert.ok(engineAt >= 0);
    assert.ok(cloudAt > engineAt);
    assert.ok(quoteAt > cloudAt);
    assert.strictEqual((html.match(/\/data\/pricing-quote\.js/g) || []).length, 1);
  });

  await test('feature decision supports all/public/admin/line/custom groups and query overrides', async () => {
    const harness = loadBrowserQuoteScript({ lineUser: { line_user_id: 'U_ABC' } });
    const decide = harness.api._test.decideFeature;
    const feature = { enabled: true, mode: 'shadow', groups: ['all'] };
    assert.strictEqual(decide(feature, 'public', '').enabled, true);
    assert.strictEqual(decide(feature, 'admin', '').enabled, true);

    const publicOnly = { enabled: true, mode: 'shadow', groups: ['public'] };
    assert.strictEqual(decide(publicOnly, 'public', '').enabled, true);
    assert.strictEqual(decide(publicOnly, 'admin', '').enabled, false);

    const lineOnly = { enabled: true, mode: 'active', groups: ['line'] };
    assert.strictEqual(decide(lineOnly, 'line:U_ABC', '').enabled, true);
    assert.strictEqual(decide(lineOnly, 'public', '').enabled, false);
    assert.strictEqual(decide(lineOnly, 'line:U_ABC', '').mode, 'active');

    const custom = { enabled: true, mode: 'shadow', groups: ['beta'] };
    assert.strictEqual(decide(custom, 'beta', '').enabled, true);
    assert.strictEqual(decide(custom, 'public', '1').enabled, true);
    assert.strictEqual(decide(feature, 'public', '0').enabled, false);
    assert.strictEqual(decide({ enabled: false, groups: ['all'] }, 'public', '1').enabled, true);
  });

  await test('browser cart mapper uses canonical SKUs, aggregates duplicates, and leaves unsupported products alone', async () => {
    const harness = loadBrowserQuoteScript();
    const config = quoteConfig();
    const context = quoteContext(config);
    const engine = harness.api._test.catalogFromApi(context.catalog);
    const mapped = harness.api._test.mapCartItems([
      { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 1, price: 1 },
      { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2, price: 999 },
      { type: 'bag', name: 'Local Only Collection Bag', variant: 'Large', qty: 1 }
    ], engine);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(mapped.items)), [{ sku: BAG_SKU, qty: 3 }]);
    assert.strictEqual(mapped.unresolved.length, 1);
    assert.strictEqual(mapped.unresolved[0].name, 'Local Only Collection Bag');

    const invalid = harness.api._test.mapCartItems([
      { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 0 }
    ], engine);
    assert.strictEqual(invalid.invalid.length, 1);
  });

  await test('browser/server parity also holds with a base override and percent promo', async () => {
    const config = quoteConfig();
    config.pricing.promos = [{
      id: 'p2-promo',
      label: 'P2 50%',
      target: 'sku:' + BAG_SKU,
      mode: 'percent',
      value: 50,
      enabled: true,
      updated: 1
    }];
    const context = quoteContext(config);
    const harness = loadBrowserQuoteScript();
    const browserEngine = harness.api._test.catalogFromApi(context.catalog);
    const mapped = harness.api._test.mapCartItems([
      { type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2 }
    ], browserEngine);
    const browser = harness.api._test.buildBrowserQuote(config, browserEngine, mapped.items, ADDRESS, null);
    const server = await issueFixture({ config: config });
    assert.strictEqual(browser.items[0].base_price, 299);
    assert.strictEqual(browser.items[0].unit_price, 150);
    assert.strictEqual(browser.grand_total, server.response.grand_total);
    assert.strictEqual(browser.items[0].line_total, server.response.items[0].line_total);
  });

  await test('browser/server parity also holds for Cloud custom products', async () => {
    const config = quoteConfig();
    const context = pricingConfig.buildCatalogContext(config, {
      customProducts: [{
        id: 'prod_p2_custom',
        category_id: 'bag',
        name: 'P2 Cloud Tote',
        size: '15 × 16 inch',
        size_key: 'normal',
        price: 389
      }]
    });
    const harness = loadBrowserQuoteScript();
    const engine = harness.api._test.catalogFromApi(context.catalog);
    const mapped = harness.api._test.mapCartItems([
      { type: 'bag', name: 'P2 Cloud Tote', variant: '15 × 16 inch', qty: 2, productId: 'prod_p2_custom', price: 1 }
    ], engine);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(mapped.items)), [{ sku: 'bag|P2 Cloud Tote|15 × 16 inch', qty: 2 }]);
    const browser = harness.api._test.buildBrowserQuote(config, engine, mapped.items, '', null);
    const server = HLGPricing.computeQuote({
      catalog: context.engine,
      pricing: config.pricing,
      tier: config.tier,
      shipping: config.shipping,
      items: mapped.items,
      coupon: null,
      address: '',
      now: Date.now()
    });
    assert.strictEqual(browser.grand_total, server.grand_total);
    assert.strictEqual(browser.items[0].line_total, server.items[0].line_total);
  });

  await test('quote comparison detects mismatches across totals and line items', async () => {
    const harness = loadBrowserQuoteScript();
    const compare = harness.api._test.compareQuotes;
    const base = {
      item_discount: 0,
      tier_discount: 50,
      coupon_discount: 100,
      subtotal: 550,
      total_before_shipping: 450,
      shipping_cost: 40,
      grand_total: 490,
      items: [{ sku: BAG_SKU, qty: 2, line_total: 550 }]
    };
    const match = compare(base, clone(base));
    assert.strictEqual(match.match, true);

    const server = clone(base);
    server.grand_total = 999;
    server.shipping_cost = 65;
    server.items[0].line_total = 600;
    const mismatch = compare(base, server);
    assert.strictEqual(mismatch.match, false);
    assert.strictEqual(mismatch.differences.grand_total.browser, 490);
    assert.strictEqual(mismatch.differences.grand_total.server, 999);
    assert.strictEqual(mismatch.differences['items.0.line_total'].server, 600);
  });

  await test('expiry helper handles API timestamps and auto-requote is non-blocking', async () => {
    const harness = loadBrowserQuoteScript();
    const isExpired = harness.api._test.isExpired;
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    assert.strictEqual(isExpired({ expires_at: new Date(now + 1000).toISOString() }, now), false);
    assert.strictEqual(isExpired({ expires_at: new Date(now - 1000).toISOString() }, now), true);
    assert.strictEqual(isExpired({ expires_at_ms: now + 1 }, now), false);
    assert.strictEqual(isExpired(null, now), true);
  });

  await test('active browser mode calls the quote API, matches the server, renders the confirmed panel, and logs', async () => {
    const config = quoteConfig();
    config.features = { quote_preview: { enabled: true, mode: 'active', groups: ['all'] } };
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2, price: 1 }
    ]));
    local.setItem('hlg_cart_selection_final_v1', JSON.stringify({ 'line-1': true }));
    const dom = createFakeQuoteDom(ADDRESS);
    const fetchState = createBrowserFetchState(config, context);
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      fetch: fetchState.fetch
    });

    await harness.api.refresh({ force: true });

    const state = harness.api.getState();
    assert.strictEqual(state.status, 'confirmed');
    assert.strictEqual(state.mode, 'active');
    assert.strictEqual(state.config.features.quote_preview.mode, 'active');
    assert.strictEqual(state.mismatch.match, true);
    assert.strictEqual(state.quote.grand_total, fetchState.getServerQuote().grand_total);
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/quotes').length, 1);
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/pricing/catalog').length, 1);

    const inserted = dom.getInserted();
    assert.ok(inserted);
    assert.ok(inserted._html.includes('ราคายืนยันจากระบบ'));
    assert.ok(inserted._html.includes(String(state.quote.grand_total)));
    const logs = harness.api.logs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].match, true);
    assert.strictEqual(logs[0].quote_id, state.quote.quote_id);
    assert.strictEqual(logs[0].has_coupon, false);
  });

  await test('an unchanged confirmed quote is reused without another API write', async () => {
    const config = quoteConfig();
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2 }
    ]));
    local.setItem('hlg_cart_selection_final_v1', JSON.stringify({ 'line-1': true }));
    const dom = createFakeQuoteDom(ADDRESS);
    const fetchState = createBrowserFetchState(config, context);
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      fetch: fetchState.fetch
    });

    await harness.api.refresh({ force: true });
    const first = harness.api.getState();
    assert.strictEqual(first.status, 'confirmed');
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/quotes').length, 1);

    await harness.api.refresh();
    const reused = harness.api.getState();
    assert.strictEqual(reused.status, 'confirmed');
    assert.strictEqual(reused.quote.quote_id, first.quote.quote_id);
    assert.strictEqual(reused.mismatch.match, true);
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/quotes').length, 1);

    await harness.api.refresh({ force: true });
    const forced = harness.api.getState();
    assert.strictEqual(forced.status, 'confirmed');
    assert.notStrictEqual(forced.quote.quote_id, first.quote.quote_id);
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/quotes').length, 2);
  });

  await test('malformed quote responses are rejected instead of rendering zero totals', async () => {
    const config = quoteConfig();
    config.features = { quote_preview: { enabled: true, mode: 'active', groups: ['all'] } };
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2 }
    ]));
    const dom = createFakeQuoteDom(ADDRESS);
    function jsonResponse(data) {
      return Promise.resolve({ ok: true, status: 200, json() { return Promise.resolve(data); } });
    }
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      fetch(url, options) {
        if (url === '/api/pricing/config') return jsonResponse(Object.assign({ success: true }, config));
        if (url === '/api/pricing/catalog') return jsonResponse(Object.assign({ success: true }, context.catalog));
        if (url === '/api/quotes') return jsonResponse({ success: true });
        return jsonResponse({ success: false });
      }
    });

    await harness.api.refresh({ force: true });

    const state = harness.api.getState();
    assert.strictEqual(state.status, 'error');
    assert.strictEqual(state.errorCode, 'INVALID_QUOTE_RESPONSE');
    assert.strictEqual(state.quote, null);
    assert.ok(dom.getInserted()._html.includes('ยังตรวจสอบราคากับระบบไม่ได้'));
  });

  await test('a timed-out quote request shows an error instead of staying in loading', async () => {
    const config = quoteConfig();
    config.features = { quote_preview: { enabled: true, mode: 'active', groups: ['all'] } };
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2 }
    ]));
    const dom = createFakeQuoteDom(ADDRESS);
    let quoteStarted;
    const started = new Promise((resolve) => { quoteStarted = resolve; });
    function FakeAbortController() {
      this.signal = {
        aborted: false,
        listeners: [],
        addEventListener(type, fn) {
          if (type === 'abort') this.listeners.push(fn);
        }
      };
      this.abort = () => {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.listeners.forEach((fn) => fn());
      };
    }
    function jsonResponse(data) {
      return Promise.resolve({ ok: true, status: 200, json() { return Promise.resolve(data); } });
    }
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      AbortController: FakeAbortController,
      fetch(url, options) {
        if (url === '/api/pricing/config') return jsonResponse(Object.assign({ success: true }, config));
        if (url === '/api/pricing/catalog') return jsonResponse(Object.assign({ success: true }, context.catalog));
        if (url === '/api/quotes') {
          quoteStarted();
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        return jsonResponse({ success: false });
      }
    });

    const pending = harness.api.refresh({ force: true });
    await started;
    const timeout = harness.timers.find((timer) => timer.ms === 12000 && !timer.cancelled);
    assert.ok(timeout, 'quote request should have a timeout timer');
    timeout.fn();
    await pending;

    const state = harness.api.getState();
    assert.strictEqual(state.status, 'error');
    assert.strictEqual(state.errorCode, 'QUOTE_TIMEOUT');
    assert.strictEqual(state.quote, null);
    assert.ok(dom.getInserted()._html.includes('ใช้เวลานานเกินไป'));
  });

  await test('shadow browser mode compares and logs without rendering a customer panel', async () => {
    const config = quoteConfig();
    config.features = { quote_preview: { enabled: true, mode: 'shadow', groups: ['all'] } };
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2, price: 1 }
    ]));
    local.setItem('hlg_cart_selection_final_v1', JSON.stringify({ 'line-1': true }));
    const dom = createFakeQuoteDom(ADDRESS);
    const fetchState = createBrowserFetchState(config, context);
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      fetch: fetchState.fetch
    });

    await harness.api.refresh({ force: true });

    const state = harness.api.getState();
    assert.strictEqual(state.status, 'confirmed');
    assert.strictEqual(state.mismatch.match, true);
    assert.strictEqual(dom.getInserted(), null);
    assert.strictEqual(harness.api.logs().length, 1);
    assert.strictEqual(harness.api.logs()[0].match, true);
  });

  await test('feature flag off fetches only public config; no catalog, quote request, or panel', async () => {
    const config = quoteConfig();
    config.features = { quote_preview: { enabled: false, mode: 'active', groups: ['all'] } };
    const context = quoteContext(config);
    const local = makeStorage();
    local.setItem('hlg_unified_cart_v1', JSON.stringify([
      { _cartId: 'line-1', type: 'bag', name: 'Merilah Pink', variant: '15 × 16 inch', qty: 2, price: 1 }
    ]));
    const dom = createFakeQuoteDom(ADDRESS);
    const fetchState = createBrowserFetchState(config, context);
    const harness = loadBrowserQuoteScript({
      document: dom.document,
      localStorage: local,
      fetch: fetchState.fetch
    });

    await harness.api.refresh({ force: true });

    const state = harness.api.getState();
    assert.strictEqual(state.status, 'disabled');
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/pricing/catalog').length, 0);
    assert.strictEqual(fetchState.calls.filter((call) => call.url === '/api/quotes').length, 0);
    assert.strictEqual(dom.getInserted(), null);
    assert.strictEqual(harness.api.logs().length, 0);
  });

  console.log('\n========================================');
  console.log(`  PASSED: ${PASSED}`);
  if (FAILED) console.log(`  FAILED: ${FAILED}`);
  console.log('========================================');

  process.exitCode = FAILED ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
