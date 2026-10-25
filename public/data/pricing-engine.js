// ============================================================================
// HLG Shared Pricing Engine
// ============================================================================
// UMD module: usable from both the storefront browser code and Node/server code.
//
// The server is the source of truth for the final amount. The browser may use
// the same engine to render a preview, but must never be trusted to supply
// prices to the server.
//
// Money is represented as integer baht. Product/catalog prices come from
// trusted data (code defaults + Firestore custom products); cart item prices
// supplied by a browser are intentionally ignored.
// ============================================================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HLGPricing = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var MAX_QTY = 999;
  var SIZE_NAMES = {
    normal: 'Normal',
    large: 'Large',
    easy: 'Easy Bag',
    maxi: 'Maxi'
  };
  var SHIPPING_DEFAULTS = { base: 40, extra: 25, rules: [] };
  var TIER_DEFAULTS = {
    enabled: false,
    name: 'โปรตามจำนวนชิ้น',
    types: ['bag'],
    start: '',
    end: '',
    tiers: {
      1: { price: null, gifts: '' },
      2: { price: null, gifts: '' },
      3: { price: null, gifts: '' }
    },
    sizeGifts: {},
    freeFrom: 0,
    coverRemote: false,
    selectedGroups: [],
    excludedSkus: [],
    productRules: {},
    groupPercent: {},
    groupModes: {}
  };

  function pricingError(code, message, details) {
    var err = new Error(message);
    err.code = code;
    err.details = details || null;
    return err;
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function roundMoney(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n));
  }

  function positiveQty(value, maxQty) {
    var n = Number(value);
    var limit = Number.isFinite(Number(maxQty)) ? Math.floor(Number(maxQty)) : MAX_QTY;
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
      throw pricingError('INVALID_QTY', 'จำนวนสินค้าต้องเป็นจำนวนเต็มมากกว่า 0', { qty: value });
    }
    if (n > limit) {
      throw pricingError('INVALID_QTY', 'จำนวนสินค้าเกินกำหนด', { qty: value, max: limit });
    }
    return n;
  }

  function safeStringArray(value) {
    return Array.isArray(value) ? value.map(function (x) { return text(x); }) : [];
  }

  function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  // --------------------------------------------------------------------------
  // SKU helpers
  // --------------------------------------------------------------------------

  // Canonical SKU used by the tier editor and tier rules.
  //   custom|{categoryId}|{productId}
  //   bag|{name}|{variant}
  //   sticker|{name}|
  //   wallpaper|{name}|{variant}
  function canonicalSku(item) {
    var x = item || {};
    var type = text(x.type || (x.categoryId || x.category_id || x.productId || x.product_id ? 'custom' : 'bag'));
    if (type === 'custom') {
      return 'custom|' + text(x.categoryId || x.category_id) + '|' + text(x.productId || x.product_id || x.id);
    }
    return type + '|' + text(x.name) + '|' + text(x.variant == null ? x.size : x.variant);
  }

  // Legacy single-item pricing keys used by the old `hlgPriceFor` helper.
  // Kept so existing `hlg_pricing_v1` data can still be read during migration.
  function legacySku(item) {
    var x = item || {};
    var type = text(x.type || (x.categoryId || x.category_id || x.productId || x.product_id ? 'custom' : 'bag'));
    return JSON.stringify([type, text(x.name), text(x.variant == null ? x.size : x.variant)]);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  // --------------------------------------------------------------------------
  // Dates (admin stores Thai local time, e.g. 2026-09-09T23:59)
  // --------------------------------------------------------------------------

  function parseBangkokDate(value) {
    var raw = text(value).trim();
    if (!raw) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(raw + 'T00:00:00+07:00');
    raw = raw.replace(' ', 'T');
    if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) return Date.parse(raw);
    return Date.parse(raw + '+07:00');
  }

  function isActive(rule, now) {
    if (!rule || rule.enabled === false) return false;
    var ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    var hasStart = text(rule.start).trim() !== '';
    var hasEnd = text(rule.end).trim() !== '';
    var start = hasStart ? parseBangkokDate(rule.start) : NaN;
    var end = hasEnd ? parseBangkokDate(rule.end) : NaN;
    if (hasStart && !Number.isFinite(start)) return false;
    if (hasEnd && !Number.isFinite(end)) return false;
    return (!hasStart || ts >= start) && (!hasEnd || ts <= end);
  }

  // --------------------------------------------------------------------------
  // Catalog
  // --------------------------------------------------------------------------

  function normalizeProduct(raw, categoryName) {
    var x = raw || {};
    var categoryId = text(x.categoryId || x.category_id || x.type || 'bag');
    var type;
    if (categoryId === 'bag' || categoryId === 'sticker' || categoryId === 'wallpaper') {
      type = categoryId;
    } else {
      type = 'custom';
    }
    var variant = '';
    if (type === 'bag') variant = text(x.variant == null ? (x.size || '') : x.variant);
    else if (type === 'wallpaper') variant = text(x.variant || 'Digital Download');
    else if (type === 'custom') variant = text(x.variant || x.size || categoryName || categoryId);

    var product = {
      type: type,
      name: text(x.name),
      variant: variant,
      sizeKey: type === 'bag' ? text(x.sizeKey || x.size_key || '') : '',
      price: roundMoney(x.price == null ? x.priceOrig : x.price),
      categoryId: type === 'custom' ? categoryId : type,
      productId: text(x.productId || x.product_id || x.id || ''),
      image: text(x.image || x.img || x.image_url || x.imageUrl || ''),
      downloadUrl: text(x.download_url || x.downloadLink || ''),
      raw: x
    };
    product.sku = text(x.sku || canonicalSku(product));
    product.aliases = [];
    if (product.productId) {
      var customAlias = 'custom|' + product.categoryId + '|' + product.productId;
      if (customAlias !== product.sku) product.aliases.push(customAlias);
    }
    if (Array.isArray(x.aliases)) {
      x.aliases.forEach(function (alias) {
        var value = text(alias);
        if (value && value !== product.sku && product.aliases.indexOf(value) < 0) product.aliases.push(value);
      });
    }
    return product;
  }

  function productSkuKeys(product) {
    return [product.sku].concat(Array.isArray(product.aliases) ? product.aliases : []);
  }

  function createCatalog(input) {
    input = input || {};
    var items = [];
    var categories = new Map();
    var categoryList = Array.isArray(input.categories) ? input.categories : [];

    categoryList.forEach(function (c) {
      if (c && c.id) categories.set(text(c.id), text(c.name || c.id));
    });

    function add(product) {
      if (product && product.name) items.push(product);
    }

    (Array.isArray(input.patterns) ? input.patterns : []).forEach(function (x) {
      add(normalizeProduct({
        type: 'bag',
        name: x.name,
        variant: x.variant == null ? x.size : x.variant,
        sizeKey: x.sizeKey || x.size_key,
        price: x.price == null ? x.priceOrig : x.price,
        productId: x.productId || x._hlgCustomId || '',
        image: x.image || x.img,
        raw: x
      }));
    });

    (Array.isArray(input.stickers) ? input.stickers : []).forEach(function (x) {
      add(normalizeProduct({
        type: 'sticker',
        name: x.name,
        variant: '',
        price: x.price,
        productId: x.productId || x._hlgCustomId || '',
        image: x.image || x.img,
        raw: x
      }));
    });

    (Array.isArray(input.wallpapers) ? input.wallpapers : []).forEach(function (x) {
      add(normalizeProduct({
        type: 'wallpaper',
        name: x.name,
        variant: x.variant || 'Digital Download',
        price: x.price,
        productId: x.productId || x.id || '',
        image: x.image || x.img,
        downloadUrl: x.download_url || x.downloadUrl,
        raw: x
      }));
    });

    if (Array.isArray(input.customProducts)) {
      input.customProducts.forEach(function (x) {
        var catId = text(x.category_id || x.type || 'bag');
        add(normalizeProduct({
          type: catId,
          categoryId: catId,
          name: x.name,
          size: x.size,
          variant: x.variant,
          sizeKey: x.size_key || x.sizeKey,
          price: x.price,
          id: x.id,
          image: x.image_url || x.imageUrl,
          download_url: x.download_url || x.downloadLink,
          raw: x
        }, categories.get(catId) || catId));
      });
    }

    if (Array.isArray(input.items)) {
      input.items.forEach(function (x) {
        add(normalizeProduct(x, categories.get(text(x.categoryId || x.category_id)) || ''));
      });
    }

    if (input.includeDefaultWallpaper !== false) {
      add(normalizeProduct({
        type: 'wallpaper',
        name: 'Wallpaper Special Set',
        variant: 'Digital Download',
        price: 99,
        categoryId: 'wallpaper'
      }));
    }

    var bySku = new Map();
    var byAnySku = new Map();
    var byLegacy = new Map();
    var byProductId = new Map();
    var duplicates = [];
    items.forEach(function (product) {
      if (bySku.has(product.sku)) duplicates.push(product.sku);
      bySku.set(product.sku, product);
      productSkuKeys(product).forEach(function (sku) {
        if (byAnySku.has(sku) && byAnySku.get(sku) !== product) duplicates.push(sku);
        byAnySku.set(sku, product);
      });
      // Legacy JSON-array SKUs (`["bag","name","variant"]`) are only unique for
      // built-in categories. Custom products use the canonical custom|... SKU.
      if (product.type !== 'custom') byLegacy.set(legacySku(product), product);
      if (product.productId) byProductId.set(product.productId, product);
    });

    function lookup(item) {
      if (!item) return null;
      var productId = text(item.productId || item.product_id || item.id || '');
      if (productId && byProductId.has(productId)) return byProductId.get(productId);
      var sku = text(item.sku || '');
      if (sku && byAnySku.has(sku)) return byAnySku.get(sku);
      if (sku && byLegacy.has(sku)) return byLegacy.get(sku);
      var canonical = canonicalSku(item);
      if (byAnySku.has(canonical)) return byAnySku.get(canonical);
      var legacy = legacySku(item);
      if (byLegacy.has(legacy)) return byLegacy.get(legacy);
      return null;
    }

    function sizeKeyFor(name, variant) {
      var p = bySku.get(canonicalSku({ type: 'bag', name: name, variant: variant }));
      return p ? p.sizeKey : '';
    }

    return {
      version: VERSION,
      items: items,
      bySku: bySku,
      byAnySku: byAnySku,
      byProductId: byProductId,
      duplicates: duplicates,
      lookup: lookup,
      sizeKeyFor: sizeKeyFor
    };
  }

  function ensureCatalog(input) {
    if (input && input.bySku instanceof Map && typeof input.lookup === 'function') return input;
    return createCatalog(input || {});
  }

  // --------------------------------------------------------------------------
  // Single-item pricing (base override + one active promo)
  // --------------------------------------------------------------------------

  function normalizePricing(input) {
    var v = safeObject(input);
    return {
      base: safeObject(v.base),
      promos: Array.isArray(v.promos) ? v.promos : []
    };
  }

  function baseOverrideFor(product, config) {
    var keys = productSkuKeys(product);
    var legacy = legacySku(product);
    var base = config.base || {};
    var value;
    for (var i = 0; i < keys.length; i++) {
      if (hasOwn(base, keys[i])) {
        value = base[keys[i]];
        break;
      }
    }
    if (value === undefined && hasOwn(base, legacy)) value = base[legacy];
    if (value === undefined) return null;
    var n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0) return n;
    return null;
  }

  function promoScore(promo, product) {
    var target = text(promo && promo.target);
    var keys = productSkuKeys(product);
    var legacy = legacySku(product);
    var skus = safeStringArray(promo && promo.skus);
    function matches(key) {
      return skus.indexOf(key) >= 0;
    }
    if (target === 'all') return 0.5;
    if (target === 'selected' && (keys.some(matches) || matches(legacy))) return 2.5;
    if (target === 'type:' + product.type) return 1;
    if (target === 'size:' + product.sizeKey && product.sizeKey) return 2;
    if (target.indexOf('sku:') === 0) {
      var requested = target.slice(4);
      if (keys.indexOf(requested) >= 0 || requested === legacy) return 3;
    }
    return 0;
  }

  function resolveItemPrice(product, pricing, now) {
    var config = normalizePricing(pricing);
    var regular = baseOverrideFor(product, config);
    if (regular == null) regular = roundMoney(product.price);

    var matches = config.promos
      .filter(function (promo) { return isActive(promo, now) && promoScore(promo, product) > 0; })
      .sort(function (a, b) {
        return promoScore(b, product) - promoScore(a, product) ||
          (Number(b.updated) || 0) - (Number(a.updated) || 0);
      });

    var promo = matches[0] || null;
    if (!promo) return { base: regular, price: regular, promo: null };

    var amount = Number(promo.value) || 0;
    var next;
    if (promo.mode === 'fixed') next = roundMoney(amount);
    else if (promo.mode === 'percent') next = roundMoney(regular * (1 - amount / 100));
    else next = roundMoney(regular - amount);

    next = Math.min(regular, next);
    return { base: regular, price: next, promo: next < regular ? promo : null };
  }

  // --------------------------------------------------------------------------
  // Shipping
  // --------------------------------------------------------------------------

  function normalizeShipping(input) {
    var v = safeObject(input);
    return {
      base: Number.isSafeInteger(Number(v.base)) ? Number(v.base) : SHIPPING_DEFAULTS.base,
      extra: Number.isSafeInteger(Number(v.extra)) ? Number(v.extra) : SHIPPING_DEFAULTS.extra,
      rules: Array.isArray(v.rules) ? v.rules : SHIPPING_DEFAULTS.rules
    };
  }

  function isDigitalItem(item) {
    return item && (item.type === 'wallpaper' || item.categoryId === 'wallpaper');
  }

  function shippingQuote(address, items, config) {
    var v = normalizeShipping(config);
    var list = Array.isArray(items) ? items : [];
    if (!list.length || list.every(isDigitalItem)) {
      return { base: 0, extra: 0, total: 0, remote: false, rule: null, pending: false };
    }

    var addr = text(address).replace(/\s+/g, ' ').toLowerCase();
    var codes = [];
    var codeRe = /(^|\D)(\d{5})(?!\d)/g;
    var match;
    while ((match = codeRe.exec(addr)) !== null) {
      if (codes.indexOf(match[2]) < 0) codes.push(match[2]);
    }

    if (!addr.trim() || !codes.length) {
      return { base: v.base, extra: 0, total: 0, remote: false, rule: null, pending: true };
    }

    var rule = v.rules.find(function (r) {
      if (!r || r.enabled === false) return false;
      if (r.postcode) return codes.indexOf(text(r.postcode)) >= 0;
      if (!r.province) return false;
      if (addr.indexOf(text(r.province).toLowerCase()) < 0) return false;
      if (!r.district) return true;
      return text(r.district).split(',').some(function (district) {
        var d = district.trim().toLowerCase();
        return d && addr.indexOf(d) >= 0;
      });
    }) || null;

    var remote = !!rule;
    return {
      base: v.base,
      extra: remote ? v.extra : 0,
      total: v.base + (remote ? v.extra : 0),
      remote: remote,
      rule: rule,
      pending: false
    };
  }

  // --------------------------------------------------------------------------
  // Tier promotion / gifts / free shipping
  // --------------------------------------------------------------------------

  function normalizeTier(input) {
    var v = safeObject(input);
    var productRules = safeObject(v.productRules);
    var selectedGroups = safeStringArray(v.selectedGroups);
    var enabled = !!v.enabled && (Object.keys(productRules).length > 0 || selectedGroups.length > 0);
    var tiers = Object.assign({}, TIER_DEFAULTS.tiers, safeObject(v.tiers));
    var next = Object.assign({}, TIER_DEFAULTS, v, {
      enabled: enabled,
      tiers: tiers,
      sizeGifts: safeObject(v.sizeGifts),
      selectedGroups: selectedGroups,
      excludedSkus: safeStringArray(v.excludedSkus),
      productRules: productRules,
      groupPercent: safeObject(v.groupPercent),
      groupModes: safeObject(v.groupModes)
    });
    next.freeFrom = Number(next.freeFrom) || 0;
    next.coverRemote = next.coverRemote === true;
    return next;
  }

  function groupKey(item) {
    return item.type === 'custom'
      ? text(item.categoryId || 'custom')
      : text(item.type || 'other');
  }

  function tierSelected(config, item) {
    var keys = productSkuKeys(item);
    var legacy = item.legacySku || legacySku(item);
    if (config.excludedSkus.indexOf(legacy) >= 0 || keys.some(function (key) { return config.excludedSkus.indexOf(key) >= 0; })) return false;
    if (config.selectedGroups.indexOf(groupKey(item)) >= 0) return true;
    return keys.some(function (key) { return hasOwn(config.productRules, key); }) || hasOwn(config.productRules, legacy);
  }

  function tierRuleValue(rules, item, level) {
    var keys = productSkuKeys(item);
    for (var i = 0; i < keys.length; i++) {
      if (!hasOwn(rules, keys[i])) continue;
      var value = rules[keys[i]] && rules[keys[i]][level];
      if (value !== null && value !== '' && value !== undefined) return Number(value);
    }
    var legacy = item.legacySku || legacySku(item);
    if (hasOwn(rules, legacy)) {
      var legacyValue = rules[legacy] && rules[legacy][level];
      if (legacyValue !== null && legacyValue !== '' && legacyValue !== undefined) return Number(legacyValue);
    }
    return null;
  }

  function tierLevelPrice(config, item, level) {
    var fixed = tierRuleValue(config.productRules, item, level);
    if (fixed !== null && Number.isFinite(fixed) && fixed >= 0) return roundMoney(fixed);

    var group = groupKey(item);
    var percentRules = config.groupPercent[group];
    var value = percentRules ? percentRules[level] : null;
    if (value === null || value === '' || value === undefined) return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    var base = Math.max(0, Number(item.unitPrice) || 0);
    var mode = (config.groupModes[group] && config.groupModes[group][level]) || 'percent';
    return mode === 'amount'
      ? roundMoney(base - n)
      : roundMoney(base * (1 - n / 100));
  }

  function tierNone(original, rawShipping, lines) {
    return {
      name: '',
      quantity: 0,
      level: 0,
      discount: 0,
      gifts: '',
      subtotal: original,
      shipping: rawShipping,
      freeShipping: false,
      snapshot: null,
      lines: lines || []
    };
  }

  function tierQuote(items, address, options) {
    options = options || {};
    var list = Array.isArray(items) ? items : [];
    var config = normalizeTier(options.tier);
    var original = list.reduce(function (sum, item) {
      return sum + Math.max(0, Number(item.unitPrice) || 0) * positiveQty(item.qty);
    }, 0);
    var rawShipping = options.shipping === false
      ? { base: 0, extra: 0, total: 0, remote: false, rule: null, pending: false }
      : shippingQuote(address, list, options.shipping);

    // Always return per-line pre-tier totals. Coupons and order snapshots need
    // this even when no tier promotion is active.
    var lines = list.map(function (item) {
      var qty = positiveQty(item.qty);
      var current = Math.max(0, Number(item.unitPrice) || 0);
      return {
        sku: item.sku,
        type: item.type,
        categoryId: item.categoryId,
        qty: qty,
        before: current * qty,
        after: current * qty,
        saving: 0,
        tierUnitPrice: null
      };
    });
    var none = tierNone(original, rawShipping, lines);

    if (!isActive(config, options.now)) return none;

    var eligible = list.filter(function (item) { return tierSelected(config, item); });
    var count = eligible.reduce(function (sum, item) { return sum + positiveQty(item.qty); }, 0);
    if (!count) return none;

    var level = Math.min(3, count);
    var rule = config.tiers[level] || {};
    var discount = 0;
    var discountLines = [];

    list.forEach(function (item, index) {
      var qty = positiveQty(item.qty);
      var current = Math.max(0, Number(item.unitPrice) || 0);
      var isEligible = eligible.indexOf(item) >= 0;
      var special = isEligible ? tierLevelPrice(config, item, level) : null;
      var saving = 0;
      var after = current * qty;
      var line = lines[index];

      if (special !== null && Number.isFinite(special) && special >= 0) {
        saving = Math.max(0, current - special) * qty;
        after = Math.max(0, current * qty - saving);
        discount += saving;
        line.tierUnitPrice = special;
        if (saving) {
          discountLines.push({
            name: text(item.name || 'สินค้า'),
            variant: text(item.variant || ''),
            qty: qty,
            before: current,
            after: Math.min(current, special),
            saving: saving
          });
        }
      }

      line.after = after;
      line.saving = saving;
    });

    discount = Math.min(discount, original);
    var freeShipping = Number(config.freeFrom) > 0 &&
      count >= Number(config.freeFrom) &&
      list.some(function (item) { return !isDigitalItem(item); });
    var shipping = Object.assign({}, rawShipping);
    if (freeShipping && !shipping.pending) {
      shipping.total = shipping.remote && config.coverRemote !== true
        ? Number(shipping.extra) || 0
        : 0;
      shipping.freeShipping = true;
    }

    var sizeCounts = {};
    eligible.forEach(function (item) {
      if (item.type !== 'bag') return;
      var size = text(item.sizeKey);
      if (!size) return;
      sizeCounts[size] = (sizeCounts[size] || 0) + positiveQty(item.qty);
    });

    var sizeGifts = Object.keys(sizeCounts).map(function (size) {
      var gift = text((config.sizeGifts[size] || {})[Math.min(3, sizeCounts[size])]).trim();
      return gift ? (SIZE_NAMES[size] || size) + ': ' + gift : '';
    }).filter(Boolean);

    var gifts = sizeGifts.length ? sizeGifts.join(' · ') : text(rule.gifts).trim();
    var name = text(config.name || TIER_DEFAULTS.name);

    return {
      name: name,
      quantity: count,
      level: level,
      discount: discount,
      gifts: gifts,
      subtotal: Math.max(0, original - discount),
      shipping: shipping,
      freeShipping: freeShipping,
      snapshot: {
        name: name,
        quantity: count,
        level: level,
        discount: discount,
        discountLines: discountLines,
        gifts: gifts,
        freeShipping: freeShipping,
        remoteSurcharge: freeShipping && shipping.remote ? shipping.total : 0
      },
      lines: lines
    };
  }

  // --------------------------------------------------------------------------
  // Coupons (status/ownership is still validated by coupon-service on server)
  // --------------------------------------------------------------------------

  function normalizeCoupon(coupon) {
    if (!coupon) return null;
    return {
      code: text(coupon.code),
      discount_amount: roundMoney(coupon.discount_amount == null ? coupon.discount : coupon.discount_amount),
      redeem_category: text(coupon.redeem_category || coupon.redeemCategory || 'all').toLowerCase()
    };
  }

  function itemMatchesCouponCategory(item, category) {
    var cat = text(category || 'all').toLowerCase();
    if (!cat || cat === 'all') return true;
    if (cat === 'bag') return item.type === 'bag';
    if (cat === 'sticker') return item.type === 'sticker';
    if (cat === 'wallpaper') return isDigitalItem(item);
    return item.type === cat || item.categoryId === cat;
  }

  function couponQuote(items, tier, coupon) {
    var info = normalizeCoupon(coupon);
    if (!info || info.discount_amount <= 0) {
      return { coupon: info, discount: 0, eligible_subtotal: 0 };
    }
    var subtotal = Math.max(0, Number(tier && tier.subtotal) || 0);
    var eligible = 0;
    (tier && tier.lines ? tier.lines : []).forEach(function (line) {
      if (itemMatchesCouponCategory(line, info.redeem_category)) eligible += Math.max(0, Number(line.after) || 0);
    });
    var discount = Math.min(info.discount_amount, eligible, subtotal);
    return { coupon: info, discount: roundMoney(discount), eligible_subtotal: roundMoney(eligible) };
  }

  // --------------------------------------------------------------------------
  // Main quote
  // --------------------------------------------------------------------------

  function resolveLine(item, catalog, pricing, now, maxQty) {
    var product = catalog.lookup(item);
    if (!product) {
      throw pricingError('UNKNOWN_ITEM', 'ไม่พบสินค้าใน catalog', {
        sku: text(item && (item.sku || canonicalSku(item))),
        name: text(item && item.name)
      });
    }
    var qty = positiveQty(item.qty, maxQty);
    var resolved = resolveItemPrice(product, pricing, now);
    return {
      sku: product.sku,
      aliases: product.aliases,
      legacySku: legacySku(product),
      type: product.type,
      name: product.name,
      variant: product.variant,
      sizeKey: product.sizeKey,
      categoryId: product.categoryId,
      productId: product.productId,
      qty: qty,
      basePrice: resolved.base,
      unitPrice: resolved.price,
      lineSubtotal: resolved.price * qty,
      promo: resolved.promo,
      product: product
    };
  }

  function computeQuote(input) {
    input = input || {};
    var now = input.now == null ? Date.now() : input.now;
    var catalog = ensureCatalog(input.catalog);
    var pricing = normalizePricing(input.pricing);
    var tierConfig = input.tier;
    var shippingConfig = input.shipping;
    var rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) throw pricingError('EMPTY_CART', 'ไม่มีสินค้าในตะกร้า');
    var maxQty = input.maxQty == null ? MAX_QTY : input.maxQty;

    var resolved = rawItems.map(function (item) {
      return resolveLine(item, catalog, pricing, now, maxQty);
    });

    var itemDiscount = resolved.reduce(function (sum, item) {
      return sum + Math.max(0, item.basePrice - item.unitPrice) * item.qty;
    }, 0);

    var tier = tierQuote(resolved, input.address, {
      tier: tierConfig,
      shipping: shippingConfig,
      now: now
    });
    var coupon = couponQuote(resolved, tier, input.coupon);

    var subtotal = Math.max(0, Number(tier.subtotal) || 0);
    var totalBeforeShipping = Math.max(0, subtotal - coupon.discount);
    var shippingCost = Math.max(0, Number(tier.shipping && tier.shipping.total) || 0);
    var grandTotal = totalBeforeShipping + shippingCost;

    var tierByIndex = tier.lines || [];
    var items = resolved.map(function (item, index) {
      var line = tierByIndex[index] || { after: item.lineSubtotal, saving: 0, tierUnitPrice: null };
      return {
        sku: item.sku,
        legacySku: item.legacySku,
        type: item.type,
        name: item.name,
        variant: item.variant,
        sizeKey: item.sizeKey,
        categoryId: item.categoryId,
        productId: item.productId,
        qty: item.qty,
        base_price: item.basePrice,
        unit_price: item.unitPrice,
        line_subtotal: item.lineSubtotal,
        promo: item.promo ? {
          id: text(item.promo.id),
          label: text(item.promo.label),
          target: text(item.promo.target),
          mode: text(item.promo.mode),
          value: Number(item.promo.value) || 0
        } : null,
        tier_unit_price: line.tierUnitPrice,
        tier_saving: roundMoney(line.saving),
        line_total: roundMoney(line.after)
      };
    });

    return {
      version: VERSION,
      currency: 'THB',
      items: items,
      item_discount: roundMoney(itemDiscount),
      tier: tier,
      tier_discount: roundMoney(tier.discount),
      subtotal: subtotal,
      coupon: coupon.coupon ? {
        code: coupon.coupon.code,
        redeem_category: coupon.coupon.redeem_category,
        eligible_subtotal: coupon.eligible_subtotal
      } : null,
      coupon_discount: coupon.discount,
      total_before_shipping: roundMoney(totalBeforeShipping),
      shipping: tier.shipping,
      shipping_cost: roundMoney(shippingCost),
      grand_total: roundMoney(grandTotal),
      free_shipping: !!tier.freeShipping,
      gifts: tier.gifts,
      discount_total: roundMoney(itemDiscount + tier.discount + coupon.discount),
      snapshot: {
        engine_version: VERSION,
        tier: tier.snapshot,
        shipping: {
          base: tier.shipping.base,
          extra: tier.shipping.extra,
          total: tier.shipping.total,
          remote: tier.shipping.remote,
          rule: tier.shipping.rule,
          freeShipping: !!tier.shipping.freeShipping
        },
        coupon: coupon.coupon ? {
          code: coupon.coupon.code,
          discount: coupon.discount,
          eligible_subtotal: coupon.eligible_subtotal
        } : null
      }
    };
  }

  return {
    VERSION: VERSION,
    MAX_QTY: MAX_QTY,
    canonicalSku: canonicalSku,
    legacySku: legacySku,
    parseBangkokDate: parseBangkokDate,
    isActive: isActive,
    createCatalog: createCatalog,
    resolveItemPrice: resolveItemPrice,
    shippingQuote: shippingQuote,
    tierQuote: tierQuote,
    computeQuote: computeQuote
  };
});
