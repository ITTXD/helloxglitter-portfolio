// ============================================================================
// HLG Storefront Quote Preview / Shadow Mode (P2)
// ============================================================================
// Loads the published pricing config + trusted server catalog, calculates a
// browser preview with the shared HLGPricing engine, then asks POST /api/quotes
// for the server quote and compares the two.
//
// `features.quote_preview.mode` controls presentation:
//   shadow : compare + log only (default, safe for rollout)
//   active : show a "ราคายืนยันจากระบบ" panel under the cart total
//
// This script never changes v8CFconfirm / order submission. P3 will make the
// server quote authoritative for orders.
// ============================================================================
(function (root) {
  'use strict';

  var VERSION = 1;
  var CONFIG_URL = '/api/pricing/config';
  var CATALOG_URL = '/api/pricing/catalog';
  var QUOTE_URL = '/api/quotes';
  var CART_KEY = 'hlg_unified_cart_v1';
  var SELECTION_KEY = 'hlg_cart_selection_final_v1';
  var GROUP_KEY = 'hlg_pricing_group_v1';
  var LOG_KEY = 'hlg_quote_shadow_log_v1';
  var CONTEXT_TTL_MS = 60 * 1000;
  var DEBOUNCE_MS = 650;
  var EXPIRY_RETRY_MS = 1200;
  var MAX_SHADOW_LOGS = 50;
  var MAX_TIMEOUT_MS = 2147483647;
  var FIELD_LABELS = {
    item_discount: 'ส่วนลดราคาสินค้า',
    tier_discount: 'ส่วนลดโปรจำนวน',
    coupon_discount: 'ส่วนลดคูปอง',
    sponge_total: 'ค่าฟองน้ำ',
    subtotal: 'ยอดหลังโปรจำนวน',
    total_before_shipping: 'ยอดก่อนค่าส่ง',
    shipping_cost: 'ค่าจัดส่ง',
    grand_total: 'ยอดชำระ'
  };

  var state = {
    status: 'idle',
    mode: 'shadow',
    group: 'public',
    feature: null,
    config: null,
    contextAt: 0,
    quote: null,
    browserQuote: null,
    mismatch: null,
    error: null,
    errorCode: '',
    unsupported: [],
    lastSignature: '',
    lastAt: 0,
    seq: 0,
    refreshTimer: null,
    expiryTimer: null,
    controller: null
  };

  var configCache = { data: null, at: 0, promise: null };
  var catalogCache = { data: null, engine: null, publicCatalog: null, at: 0, promise: null, version: null };
  var initialized = false;

  function safeGet(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
  }

  function safeSet(storage, key, value) {
    try {
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function parseJSON(value, fallback) {
    if (value == null || value === '') return fallback;
    try {
      var parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function esc(value) {
    return text(value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function sourceJSON(key, fallback) {
    return parseJSON(safeGet(root.localStorage, key), fallback);
  }

  function queryParam(name) {
    try {
      var search = root.location && root.location.search ? String(root.location.search) : '';
      if (!search) return '';
      var match = new RegExp('[?&]' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^&]*)').exec(search);
      return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
    } catch (e) {
      return '';
    }
  }

  function isAdminSession() {
    try {
      if (root.localStorage && root.localStorage.getItem('hlg_admin_session_v2') === '1') return true;
      if (root.sessionStorage && root.sessionStorage.getItem('hlg_admin_session_v2') === '1') return true;
      if (root.document && root.document.body && root.document.body.classList.contains('admin-mode')) return true;
    } catch (e) {}
    return false;
  }

  function lineUser() {
    try {
      if (typeof root.getLineUser === 'function') {
        var user = root.getLineUser();
        if (user && user.line_user_id) return user;
      }
      var stored = sourceJSON('hlg_line_user_v1', null);
      if (stored && stored.line_user_id) return stored;
    } catch (e) {}
    return null;
  }

  function currentGroup(override) {
    var explicit = text(override || queryParam('hlg_group') || safeGet(root.localStorage, GROUP_KEY)).trim();
    if (explicit) return explicit.slice(0, 100);
    if (isAdminSession()) return 'admin';
    var user = lineUser();
    if (user && user.line_user_id) return 'line:' + text(user.line_user_id).slice(0, 100);
    return 'public';
  }

  // Pure so it can be exercised by the Node test harness.
  function decideFeature(feature, group, force) {
    var out = {
      enabled: false,
      mode: 'shadow',
      group: text(group || 'public'),
      groups: [],
      reason: 'missing'
    };
    if (!feature || typeof feature !== 'object') return out;

    var groups = Array.isArray(feature.groups)
      ? feature.groups.map(function (entry) { return text(entry).trim(); }).filter(Boolean)
      : ['all'];
    var enabled = feature.enabled === true;
    var matched = groups.indexOf('all') >= 0 || groups.indexOf(out.group) >= 0;
    if (out.group.indexOf('line:') === 0 && groups.indexOf('line') >= 0) matched = true;

    if (force === '1') {
      enabled = true;
      matched = true;
    } else if (force === '0') {
      enabled = false;
    }

    out.enabled = !!(enabled && matched);
    out.mode = feature.mode === 'active' ? 'active' : 'shadow';
    out.groups = groups;
    if (!feature.enabled) out.reason = 'disabled';
    else if (!matched) out.reason = 'group-not-enabled';
    else out.reason = 'enabled';
    return out;
  }

  function resolveFeature(config) {
    var feature = config && config.features && config.features.quote_preview;
    return decideFeature(feature, currentGroup(), queryParam('hlg_quote'));
  }

  function fetchJson(url) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return root.fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (response) {
        if (!response || !response.ok) {
          var err = new Error('HTTP ' + (response && response.status ? response.status : 'error'));
          err.status = response && response.status;
          throw err;
        }
        return response.json();
      });
  }

  function loadConfig(force) {
    if (!force && configCache.data && Date.now() - configCache.at < CONTEXT_TTL_MS) {
      return Promise.resolve(configCache.data);
    }
    if (!force && configCache.promise) return configCache.promise;
    configCache.promise = fetchJson(CONFIG_URL)
      .then(function (data) {
        if (!data || data.success === false) throw new Error((data && data.error) || 'โหลด pricing config ไม่สำเร็จ');
        configCache.data = data;
        configCache.at = Date.now();
        return data;
      })
      .catch(function (err) {
        configCache.promise = null;
        throw err;
      });
    return configCache.promise.then(function (data) {
      configCache.promise = null;
      return data;
    }, function (err) {
      configCache.promise = null;
      throw err;
    });
  }

  function catalogFromApi(publicCatalog) {
    if (!root.HLGPricing || typeof root.HLGPricing.createCatalog !== 'function') {
      throw new Error('pricing engine not loaded');
    }
    var items = publicCatalog && Array.isArray(publicCatalog.items) ? publicCatalog.items : [];
    var products = items.map(function (item) {
      return {
        id: item.product_id || undefined,
        sku: item.sku,
        aliases: Array.isArray(item.aliases) ? item.aliases.slice() : [],
        category_id: item.category_id || item.type,
        name: item.name,
        variant: item.variant,
        size_key: item.size_key,
        price: item.catalog_price,
        image: item.image,
        download_url: item.download_url
      };
    });
    return root.HLGPricing.createCatalog({
      items: products,
      categories: publicCatalog && Array.isArray(publicCatalog.categories) ? publicCatalog.categories : [],
      includeDefaultWallpaper: false
    });
  }

  function loadCatalog(force, pricingVersion) {
    if (!force && catalogCache.engine && catalogCache.version === pricingVersion && Date.now() - catalogCache.at < CONTEXT_TTL_MS) {
      return Promise.resolve(catalogCache);
    }
    if (!force && catalogCache.promise) return catalogCache.promise;
    catalogCache.promise = fetchJson(CATALOG_URL)
      .then(function (data) {
        if (!data || data.success === false || !Array.isArray(data.items)) {
          throw new Error((data && data.error) || 'โหลด catalog ไม่สำเร็จ');
        }
        catalogCache.publicCatalog = data;
        catalogCache.engine = catalogFromApi(data);
        catalogCache.version = Number(data.pricing_version) || 0;
        catalogCache.at = Date.now();
        catalogCache.data = data;
        return catalogCache;
      })
      .catch(function (err) {
        catalogCache.promise = null;
        throw err;
      });
    return catalogCache.promise.then(function (value) {
      catalogCache.promise = null;
      return value;
    }, function (err) {
      catalogCache.promise = null;
      throw err;
    });
  }

  function cartSnapshot() {
    var cart = sourceJSON(CART_KEY, []);
    if (!Array.isArray(cart)) return [];
    var selected = sourceJSON(SELECTION_KEY, {});
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) selected = {};
    return cart.filter(function (item) {
      if (!item || typeof item !== 'object') return false;
      if (!item._cartId) return true;
      return selected[item._cartId] !== false;
    });
  }

  function cartAddress() {
    try {
      var el = root.document && root.document.getElementById('v8cfAddr1');
      return el ? text(el.value).trim() : '';
    } catch (e) {
      return '';
    }
  }

  function appliedCoupon() {
    try {
      if (typeof root.getAppliedCoupon === 'function') {
        var value = root.getAppliedCoupon();
        if (value && value.code) return value;
      }
    } catch (e) {}
    return sourceJSON('hlg_applied_coupon_v1', null);
  }

  function mapCartItems(cart, catalog) {
    var items = [];
    var bySku = {};
    var unresolved = [];
    var invalid = [];

    (Array.isArray(cart) ? cart : []).forEach(function (line) {
      var product = catalog.lookup({
        sku: line.sku,
        type: line.type,
        name: line.name,
        variant: line.variant,
        size: line.size,
        productId: line.productId || line.product_id || line.id,
        categoryId: line.categoryId || line.category_id
      });
      if (!product) {
        unresolved.push({
          name: text(line.name),
          variant: text(line.variant),
          type: text(line.type)
        });
        return;
      }
      var qty = Number(line.qty);
      if (!Number.isSafeInteger(qty) || qty <= 0 || qty > root.HLGPricing.MAX_QTY) {
        invalid.push({ sku: product.sku, qty: line.qty });
        return;
      }
      if (!bySku[product.sku]) {
        bySku[product.sku] = { sku: product.sku, qty: 0 };
        items.push(bySku[product.sku]);
      }
      bySku[product.sku].qty += qty;
      if (line.sponge === true && root.HLGPricing.spongeEligible(product)) bySku[product.sku].sponge = true;
    });

    return { items: items, unresolved: unresolved, invalid: invalid };
  }

  function couponForEngine(coupon) {
    if (!coupon || !coupon.code) return null;
    return {
      code: coupon.code,
      discount_amount: Number(coupon.discountBaht) || 0,
      redeem_category: 'bag'
    };
  }

  function buildBrowserQuote(config, catalog, items, address, coupon) {
    if (!root.HLGPricing || typeof root.HLGPricing.computeQuote !== 'function') {
      throw new Error('pricing engine not loaded');
    }
    return root.HLGPricing.computeQuote({
      catalog: catalog,
      pricing: config.pricing,
      tier: config.tier,
      shipping: config.shipping,
      items: items,
      coupon: couponForEngine(coupon),
      address: address,
      now: Date.now()
    });
  }

  function stableJSON(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJSON(value[key]);
    }).join(',') + '}';
  }

  function requestSignature(config, items, address, coupon, mode, lineUserId) {
    return stableJSON({
      pricing_version: Number(config && config.version) || 0,
      mode: mode,
      items: items,
      address: text(address).trim(),
      coupon: coupon && coupon.code ? text(coupon.code).toUpperCase() : '',
      line_user_id: text(lineUserId)
    });
  }

  function compareQuotes(browserQuote, serverQuote) {
    var differences = {};
    Object.keys(FIELD_LABELS).forEach(function (field) {
      var left = Math.round(Number(browserQuote && browserQuote[field]) || 0);
      var right = Math.round(Number(serverQuote && serverQuote[field]) || 0);
      if (left !== right) differences[field] = { browser: left, server: right };
    });

    var leftItems = browserQuote && Array.isArray(browserQuote.items) ? browserQuote.items : [];
    var rightItems = serverQuote && Array.isArray(serverQuote.items) ? serverQuote.items : [];
    if (leftItems.length !== rightItems.length) {
      differences.items = { browser: leftItems.length, server: rightItems.length };
    } else {
      leftItems.forEach(function (item, index) {
        var other = rightItems[index] || {};
        if (text(item.sku) !== text(other.sku)) {
          differences['items.' + index + '.sku'] = { browser: item.sku, server: other.sku };
        }
        if (Number(item.qty) !== Number(other.qty)) {
          differences['items.' + index + '.qty'] = { browser: item.qty, server: other.qty };
        }
        if (Math.round(Number(item.line_total) || 0) !== Math.round(Number(other.line_total) || 0)) {
          differences['items.' + index + '.line_total'] = {
            browser: Math.round(Number(item.line_total) || 0),
            server: Math.round(Number(other.line_total) || 0)
          };
        }
      });
    }

    return {
      match: Object.keys(differences).length === 0,
      differences: differences,
      fields: FIELD_LABELS
    };
  }

  function isExpired(quote, now) {
    var at = now == null ? Date.now() : Number(now);
    if (!quote) return true;
    if (typeof quote === 'number') return quote <= at;
    var expires = Number(quote.expires_at_ms);
    if (Number.isFinite(expires)) return expires <= at;
    var parsed = Date.parse(quote.expires_at || '');
    return !Number.isFinite(parsed) || parsed <= at;
  }

  function pushShadowLog(entry) {
    var logs = sourceJSON(LOG_KEY, []);
    if (!Array.isArray(logs)) logs = [];
    logs.unshift(entry);
    safeSet(root.localStorage, LOG_KEY, JSON.stringify(logs.slice(0, MAX_SHADOW_LOGS)));
  }

  function logComparison(result, context) {
    var entry = {
      at: new Date().toISOString(),
      quote_id: text(context.quote && context.quote.quote_id),
      pricing_version: Number(context.config && context.config.version) || 0,
      item_count: Array.isArray(context.items) ? context.items.length : 0,
      has_coupon: !!(context.coupon && context.coupon.code),
      match: !!result.match,
      differences: result.differences
    };
    pushShadowLog(entry);
    try {
      if (!result.match) {
        console.warn('[HLG quote mismatch]', {
          quote_id: entry.quote_id,
          pricing_version: entry.pricing_version,
          differences: entry.differences
        });
      } else if (queryParam('hlg_quote_debug') === '1') {
        console.info('[HLG quote match]', {
          quote_id: entry.quote_id,
          grand_total: context.quote && context.quote.grand_total
        });
      }
    } catch (e) {}
    state.mismatch = result;
  }

  function ensureStyles() {
    try {
      if (!root.document || root.document.getElementById('hlg-quote-preview-css')) return;
      var style = root.document.createElement('style');
      style.id = 'hlg-quote-preview-css';
      style.textContent = ''
        + '.hlg-quote-preview{border:1px solid #c7e7d7;background:#f4fff9;border-radius:14px;padding:10px 12px;margin-top:10px;color:#32624c;font-size:11px;line-height:1.5}'
        + '.hlg-quote-preview.shadow{border-color:#d8d1e8;background:#faf8ff;color:#64557f}'
        + '.hlg-quote-preview.pending{border-color:#ecd7a8;background:#fffaf0;color:#8a6b2d}'
        + '.hlg-quote-preview.error{border-color:#edbccb;background:#fff5f7;color:#a13c5a}'
        + '.hlg-quote-preview strong{font-size:14px}'
        + '.hlg-quote-preview small{display:block;opacity:.78;font-size:9px;margin-top:2px}'
        + '.hlg-quote-preview button{margin-top:6px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:4px 8px;font:inherit;font-weight:800;cursor:pointer}'
        + '.hlg-quote-preview pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:9px;max-height:140px;overflow:auto}';
      root.document.head.appendChild(style);
    } catch (e) {}
  }

  function isCartVisible() {
    try {
      var page = root.document && root.document.getElementById('page-cart');
      return !!(page && page.classList && page.classList.contains('active'));
    } catch (e) {
      return false;
    }
  }

  function isDebug() {
    return queryParam('hlg_quote_debug') === '1';
  }

  function removePanel() {
    try {
      var existing = root.document && root.document.getElementById('hlgQuotePreviewPanel');
      if (existing) existing.remove();
    } catch (e) {}
  }

  function money(value) {
    var n = Math.round(Number(value) || 0);
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(n); }
  }

  function panelCopy() {
    if (state.status === 'unsupported') {
      return {
        cls: 'error',
        title: 'ยังตรวจสอบราคาบางรายการกับระบบไม่ได้',
        detail: 'สินค้าบางรายการยังไม่ได้อยู่ใน catalog ฝั่งเซิร์ฟเวอร์ — การสั่งซื้อเดิมยังใช้งานได้ปกติ'
      };
    }
    if (state.status === 'expired') {
      return {
        cls: 'pending',
        title: 'ราคาที่ตรวจสอบหมดอายุแล้ว',
        detail: 'กำลังตรวจสอบราคาใหม่อัตโนมัติ...'
      };
    }
    if (state.status === 'rate_limited') {
      return {
        cls: 'pending',
        title: 'ตรวจสอบราคาถี่เกินไป',
        detail: 'ระบบจะลองตรวจใหม่ให้อัตโนมัติอีกครั้ง'
      };
    }
    if (state.status === 'error') {
      return {
        cls: 'error',
        title: 'ยังตรวจสอบราคากับระบบไม่ได้',
        detail: text(state.error) || 'กรุณาลองใหม่อีกครั้ง — การสั่งซื้อเดิมยังใช้งานได้ปกติ'
      };
    }
    if (state.status === 'loading' || state.status === 'confirming') {
      return {
        cls: 'pending',
        title: 'กำลังตรวจสอบราคากับระบบ...',
        detail: 'ยอดสุดท้ายจะยืนยันจากเซิร์ฟเวอร์อีกครั้ง'
      };
    }
    if (state.quote) {
      return {
        cls: 'ok',
        title: '✓ ราคายืนยันจากระบบ',
        detail: 'ยอดรวม ' + money(state.quote.grand_total) + ' ฿'
          + (state.quote.shipping && state.quote.shipping.pending ? ' · รอกรอกที่อยู่เพื่อคำนวณค่าส่ง' : '')
      };
    }
    return {
      cls: 'pending',
      title: 'รอตรวจสอบราคา',
      detail: 'กำลังเตรียมข้อมูลราคาจากเซิร์ฟเวอร์'
    };
  }

  function renderPanel() {
    try {
      var active = !!(state.feature && state.feature.enabled);
      if (!active || !isCartVisible() || (!isDebug() && state.mode !== 'active')) {
        removePanel();
        return;
      }
      if (state.status === 'empty' || state.status === 'disabled') {
        removePanel();
        return;
      }

      var rootEl = root.document.getElementById('v8CartContent');
      if (!rootEl) { removePanel(); return; }
      var totalRow = rootEl.querySelector('.v8cf-row.total');
      var card = totalRow ? totalRow.closest('.v8cf-card') : rootEl.querySelector('.v8cf-card');
      if (!card) { removePanel(); return; }

      var copy = panelCopy();
      var shadow = state.mode !== 'active';
      var debug = isDebug();
      var html = '<div id="hlgQuotePreviewPanel" class="hlg-quote-preview ' + (shadow ? 'shadow ' : '') + esc(copy.cls) + '">'
        + '<div><strong>' + esc(copy.title) + '</strong><small>' + esc(copy.detail) + '</small></div>';

      if (debug && state.mismatch) {
        var summary = (state.mode === 'active' ? 'ACTIVE' : 'SHADOW')
          + (state.mismatch.match ? ' · MATCH' : ' · MISMATCH');
        var detail = state.mismatch.match
          ? 'browser และ server ตรงกัน'
          : Object.keys(state.mismatch.differences).map(function (field) {
            var diff = state.mismatch.differences[field];
            var label = state.mismatch.fields[field] || field;
            var fmt = function (value) { return typeof value === 'number' ? money(value) : text(value); };
            return label + ': browser ' + fmt(diff.browser) + ' / server ' + fmt(diff.server);
          }).join('\n');
        html += '<small style="margin-top:6px">' + esc(summary) + ' · pricing v' + esc(state.config && state.config.version || 0) + '</small>';
        if (detail) html += '<pre>' + esc(detail) + '</pre>';
      }
      if (debug && state.quote) {
        html += '<small>quote ' + esc(state.quote.quote_id || '') + ' · หมดอายุ ' + esc(state.quote.expires_at || '') + '</small>';
      }
      if (state.status === 'error' || state.status === 'rate_limited' || state.status === 'expired') {
        html += '<button type="button" data-hlg-quote-retry>ตรวจใหม่</button>';
      }
      html += '</div>';

      removePanel();
      if (totalRow) totalRow.insertAdjacentElement('afterend', createPanelNode(html));
      else card.insertAdjacentHTML('beforeend', html);

      var retry = root.document.querySelector('#hlgQuotePreviewPanel [data-hlg-quote-retry]');
      if (retry) retry.addEventListener('click', function () { refresh({ force: true }); });
    } catch (e) {}
  }

  function createPanelNode(html) {
    var temp = root.document.createElement('div');
    temp.innerHTML = html;
    return temp.firstChild;
  }

  function clearExpiryTimer() {
    if (state.expiryTimer) {
      try { root.clearTimeout(state.expiryTimer); } catch (e) {}
      state.expiryTimer = null;
    }
  }

  function scheduleExpiry() {
    clearExpiryTimer();
    if (!state.quote) return;
    var expiresAt = Number(state.quote.expires_at_ms);
    if (!Number.isFinite(expiresAt)) expiresAt = Date.parse(state.quote.expires_at || '');
    if (!Number.isFinite(expiresAt)) return;
    var delay = Math.max(0, Math.min(expiresAt - Date.now(), MAX_TIMEOUT_MS));
    state.expiryTimer = root.setTimeout(function () {
      state.expiryTimer = null;
      if (!isExpired(state.quote)) {
        scheduleExpiry();
        return;
      }
      state.status = 'expired';
      renderPanel();
      // Keep the expired message visible for a moment before replacing it with
      // the automatic re-quote loading state.
      if (isCartVisible()) scheduleRefresh(EXPIRY_RETRY_MS);
    }, delay);
  }

  function clearRefreshTimer() {
    if (state.refreshTimer) {
      try { root.clearTimeout(state.refreshTimer); } catch (e) {}
      state.refreshTimer = null;
    }
  }

  function scheduleRefresh(delay) {
    if (!root.document) return;
    clearRefreshTimer();
    state.refreshTimer = root.setTimeout(function () {
      state.refreshTimer = null;
      refresh();
    }, Math.max(0, Number(delay) || 0));
  }

  function abortInflight() {
    if (state.controller) {
      try { state.controller.abort(); } catch (e) {}
      state.controller = null;
    }
  }

  function postQuote(payload, timeoutMs) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    var controller = null;
    var timer = null;
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(payload)
    };
    try {
      if (typeof root.AbortController === 'function') {
        controller = new root.AbortController();
        options.signal = controller.signal;
        state.controller = controller;
        timer = root.setTimeout(function () {
          try { controller.abort(); } catch (e) {}
        }, timeoutMs || 12000);
      }
    } catch (e) {
      controller = null;
    }

    function clean() {
      if (timer) {
        try { root.clearTimeout(timer); } catch (e) {}
      }
      if (state.controller === controller) state.controller = null;
    }

    return root.fetch(QUOTE_URL, options)
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || data.success === false) {
            var err = new Error(data.error || ('HTTP ' + response.status));
            err.code = data.code || '';
            err.status = response.status;
            err.data = data;
            throw err;
          }
          if (!data || data.success !== true || !data.quote_id || !Number.isFinite(Number(data.grand_total))) {
            var invalid = new Error('รูปแบบ quote จากเซิร์ฟเวอร์ไม่ถูกต้อง');
            invalid.code = 'INVALID_QUOTE_RESPONSE';
            invalid.status = response.status;
            invalid.data = data;
            throw invalid;
          }
          return data;
        });
      })
      .then(function (data) { clean(); return data; }, function (err) { clean(); throw err; });
  }

  function contextError(err) {
    state.error = 'โหลดข้อมูลราคาจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่';
    state.errorCode = (err && err.code) || 'CONTEXT_ERROR';
    state.status = 'error';
    state.quote = null;
    state.browserQuote = null;
    state.mismatch = null;
    clearExpiryTimer();
    renderPanel();
  }

  function sendServerQuote(payload, signature, seq, browserQuote, context) {
    state.status = state.quote ? 'confirming' : 'loading';
    renderPanel();
    var promise = postQuote(payload).then(function (data) {
      if (seq !== state.seq) return state;
      state.quote = data;
      state.status = 'confirmed';
      state.lastSignature = signature;
      state.lastAt = Date.now();
      state.error = null;
      state.errorCode = '';
      var comparison = compareQuotes(browserQuote, data);
      logComparison(comparison, {
        quote: data,
        config: context.config,
        items: context.items,
        coupon: context.coupon
      });
      renderPanel();
      scheduleExpiry();
      return state;
    }).catch(function (err) {
      if (seq !== state.seq) return state;
      if (err && err.name === 'AbortError') {
        // A stale abort is filtered by the seq check above; within the same
        // sequence this is the request timeout. Surface it instead of leaving
        // the panel stuck in "checking".
        state.quote = null;
        state.browserQuote = null;
        state.mismatch = null;
        clearExpiryTimer();
        state.error = 'ตรวจสอบราคากับระบบใช้เวลานานเกินไป';
        state.errorCode = 'QUOTE_TIMEOUT';
        state.status = 'error';
        renderPanel();
        return state;
      }
      state.quote = null;
      state.browserQuote = null;
      state.mismatch = null;
      clearExpiryTimer();
      state.error = err && err.code && err.message
        ? err.message
        : 'ตรวจสอบราคากับระบบไม่สำเร็จ กรุณาลองใหม่';
      state.errorCode = (err && err.code) || 'QUOTE_ERROR';
      state.status = state.errorCode === 'RATE_LIMITED' ? 'rate_limited' : 'error';
      renderPanel();
      if (state.status === 'rate_limited') {
        var retry = Number(err && err.data && err.data.retry_after);
        scheduleRefresh((Number.isFinite(retry) && retry > 0 ? retry : 15) * 1000);
      }
      return state;
    });
    return promise;
  }

  function refresh(options) {
    var opts = options || {};
    if (!root.HLGPricing) {
      state.status = 'disabled';
      state.error = 'pricing engine not loaded';
      renderPanel();
      return Promise.resolve(state);
    }
    if (!root.document || (!isCartVisible() && !opts.force)) return Promise.resolve(state);

    clearRefreshTimer();
    var seq = ++state.seq;
    var previousStatus = state.status;
    abortInflight();
    state.status = state.quote ? 'confirming' : 'loading';
    state.error = null;
    state.errorCode = '';
    state.unsupported = [];
    state.mismatch = null;
    renderPanel();

    return loadConfig(opts.force)
      .then(function (config) {
        if (seq !== state.seq) return state;
        state.config = config;
        state.feature = resolveFeature(config);
        state.mode = state.feature.mode;
        state.group = state.feature.group;
        if (!state.feature.enabled) {
          state.status = 'disabled';
          state.quote = null;
          state.browserQuote = null;
          state.mismatch = null;
          clearExpiryTimer();
          renderPanel();
          return state;
        }

        var cart = cartSnapshot();
        if (!cart.length) {
          state.status = 'empty';
          state.quote = null;
          state.browserQuote = null;
          state.mismatch = null;
          clearExpiryTimer();
          renderPanel();
          return state;
        }

        return loadCatalog(opts.force, Number(config.version) || 0).then(function (cache) {
          if (seq !== state.seq) return state;
          var mapped = mapCartItems(cart, cache.engine);
          if (mapped.unresolved.length || mapped.invalid.length) {
            state.status = 'unsupported';
            state.unsupported = mapped.unresolved.concat(mapped.invalid);
            state.quote = null;
            state.browserQuote = null;
            state.mismatch = null;
            clearExpiryTimer();
            renderPanel();
            return state;
          }

          var address = cartAddress();
          var coupon = appliedCoupon();
          var user = lineUser();
          var browserQuote;
          try {
            browserQuote = buildBrowserQuote(config, cache.engine, mapped.items, address, coupon);
          } catch (err) {
            state.status = 'unsupported';
            state.unsupported = [{ error: err && err.message }];
            state.quote = null;
            state.browserQuote = null;
            state.mismatch = null;
            clearExpiryTimer();
            renderPanel();
            return state;
          }

          var signature = requestSignature(
            config,
            mapped.items,
            address,
            coupon,
            state.feature.mode,
            user && user.line_user_id
          );
          state.browserQuote = browserQuote;
          if (!opts.force && previousStatus === 'confirmed' && state.quote
            && state.lastSignature === signature && !isExpired(state.quote)) {
            state.status = 'confirmed';
            state.mismatch = compareQuotes(browserQuote, state.quote);
            renderPanel();
            return state;
          }

          var payload = {
            items: mapped.items.map(function (item) {
              var entry = { sku: item.sku, qty: item.qty };
              if (item.sponge === true) entry.sponge = true;
              return entry;
            }),
            address: address
          };
          if (coupon && coupon.code) payload.coupon_code = coupon.code;
          if (user && user.line_user_id) payload.line_user_id = user.line_user_id;

          return sendServerQuote(payload, signature, seq, browserQuote, {
            config: config,
            items: mapped.items,
            coupon: coupon
          });
        });
      })
      .catch(function (err) {
        if (seq !== state.seq) return state;
        if (err && err.name === 'AbortError') return state;
        contextError(err);
        return state;
      });
  }

  function logs() {
    var value = sourceJSON(LOG_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function clearLogs() {
    try { root.localStorage && root.localStorage.removeItem(LOG_KEY); } catch (e) {}
  }

  function resetContext() {
    configCache.data = null;
    configCache.at = 0;
    configCache.promise = null;
    catalogCache.data = null;
    catalogCache.engine = null;
    catalogCache.publicCatalog = null;
    catalogCache.at = 0;
    catalogCache.promise = null;
    catalogCache.version = null;
  }

  function getState() {
    return {
      status: state.status,
      mode: state.mode,
      group: state.group,
      feature: state.feature,
      config: state.config,
      quote: state.quote,
      browserQuote: state.browserQuote,
      mismatch: state.mismatch,
      error: state.error,
      errorCode: state.errorCode,
      unsupported: state.unsupported,
      lastSignature: state.lastSignature,
      lastAt: state.lastAt
    };
  }

  function wrapCartRender() {
    if (typeof root.renderUnifiedCart !== 'function') return;
    if (root.renderUnifiedCart.__hlgQuoteWrapped) return;
    var original = root.renderUnifiedCart;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      try {
        if (isCartVisible()) scheduleRefresh(80);
      } catch (e) {}
      return result;
    };
    wrapped.__hlgQuoteWrapped = true;
    root.renderUnifiedCart = wrapped;
  }

  function init() {
    if (initialized || !root.document) return;
    initialized = true;
    ensureStyles();
    wrapCartRender();

    root.document.addEventListener('input', function (event) {
      if (event && event.target && event.target.id === 'v8cfAddr1') scheduleRefresh(DEBOUNCE_MS);
    }, true);
    root.document.addEventListener('change', function (event) {
      if (event && event.target && event.target.id === 'v8cfAddr1') scheduleRefresh(DEBOUNCE_MS);
    }, true);

    try {
      root.addEventListener('storage', function (event) {
        if (!event) return;
        if ([CART_KEY, SELECTION_KEY, 'hlg_applied_coupon_v1'].indexOf(event.key) >= 0) {
          scheduleRefresh(DEBOUNCE_MS);
        }
      });
      root.addEventListener('hlg:pricing-cloud-applied', function () {
        resetContext();
        scheduleRefresh(150);
      });
    } catch (e) {}

    if (isCartVisible()) scheduleRefresh(80);
  }

  root.hlgQuotePreview = {
    VERSION: VERSION,
    refresh: refresh,
    scheduleRefresh: scheduleRefresh,
    getState: getState,
    logs: logs,
    clearLogs: clearLogs,
    resetContext: resetContext,
    decideFeature: decideFeature,
    compareQuotes: compareQuotes,
    isExpired: isExpired,
    _test: {
      decideFeature: decideFeature,
      catalogFromApi: catalogFromApi,
      mapCartItems: mapCartItems,
      compareQuotes: compareQuotes,
      isExpired: isExpired,
      buildBrowserQuote: buildBrowserQuote,
      cartSnapshot: cartSnapshot,
      requestSignature: requestSignature,
      stableJSON: stableJSON
    }
  };

  if (!root.__HLG_QUOTE_NO_AUTO__) init();
})(typeof window !== 'undefined' ? window : globalThis);
