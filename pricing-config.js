// ============================================================================
// HLG Pricing Config Service
// ============================================================================
// Shared server-side helpers for the trusted pricing catalog and the published
// Firestore pricing config. Both `server.js` and `api/[...path].js` use this
// module so the local development server and production API stay in parity.
//
// The service is storage-agnostic. A store adapter must provide:
//   cacheKey?        optional string; enables the in-process config cache
//   loadConfigDoc()  -> Promise<object|null>
//   publish(expectedVersion, configDoc, historyDoc) -> Promise<object>
//   getHistory(version) -> Promise<object|null>
//   listHistory(limit) -> Promise<object[]>
//
// Store.publish MUST reject with an error whose code is VERSION_CONFLICT when
// the currently stored version differs from expectedVersion.
// ============================================================================
'use strict';

const HLGPricing = require('./public/data/pricing-engine.js');
const patterns = require('./public/data/patterns.js');

const SCHEMA_VERSION = 1;
const CONFIG_CACHE_TTL_MS = 60 * 1000;
const MAX_BASE_PRICES = 10000;
const MAX_PROMOS = 500;
const MAX_RULES = 5000;
const MAX_SKUS = 10000;
const MAX_TEXT = 500;

const BUILTIN_CATEGORIES = [
  { id: 'bag', name: 'กระเป๋าผ้า', description: 'กระเป๋าผ้าลายน่ารัก 4 ไซส์ 46 ลาย', is_builtin: true, show_on_home: true },
  { id: 'sticker', name: 'Sticker', description: 'สติกเกอร์ไดคัทสุดคิ้วท์', is_builtin: true, show_on_home: true },
  { id: 'wallpaper', name: 'Wallpaper', description: 'Digital item วอลเปเปอร์มือถือ', is_builtin: true, show_on_home: true }
];

const DEFAULT_SHIPPING = Object.freeze({ base: 40, extra: 25, rules: [] });
const DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];

const configCache = new Map();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function configError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details || null;
  return err;
}

function text(value, max) {
  const out = value == null ? '' : String(value).trim();
  return max ? out.slice(0, max) : out;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function isDangerousKey(key) {
  return DANGEROUS_KEYS.indexOf(String(key)) >= 0;
}

function toSafeInteger(value) {
  if (typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function safeVersion(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function pushError(errors, field, message) {
  errors.push({ field: field, message: message });
}

function objectField(raw, key, path, errors) {
  if (raw[key] == null) return {};
  if (!isObject(raw[key])) {
    pushError(errors, path + '.' + key, 'ต้องเป็น object');
    return {};
  }
  return raw[key];
}

function sanitizeStringArray(value, field, errors, options) {
  const opts = options || {};
  if (value == null) return [];
  if (!Array.isArray(value)) {
    pushError(errors, field, 'ต้องเป็นรายการ');
    return [];
  }
  const max = opts.max || MAX_SKUS;
  if (value.length > max) {
    pushError(errors, field, 'มีรายการมากเกินกำหนด (' + max + ')');
    return [];
  }
  const out = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      pushError(errors, field + '[' + i + ']', 'ต้องเป็นข้อความ');
      continue;
    }
    const item = text(value[i], opts.maxLength || MAX_TEXT);
    if (!item && !opts.allowEmpty) {
      pushError(errors, field + '[' + i + ']', 'ต้องไม่ว่าง');
      continue;
    }
    if (item && out.indexOf(item) < 0) out.push(item);
  }
  return out;
}

function sanitizeDate(value, field, errors) {
  const raw = text(value, 64);
  if (!raw) return '';
  if (!Number.isFinite(HLGPricing.parseBangkokDate(raw))) {
    pushError(errors, field, 'รูปแบบวันที่ไม่ถูกต้อง');
    return '';
  }
  return raw;
}

function validateDateRange(start, end, field, errors) {
  if (!start || !end) return;
  if (HLGPricing.parseBangkokDate(start) > HLGPricing.parseBangkokDate(end)) {
    pushError(errors, field, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
  }
}

function sanitizeInteger(value, field, errors, options) {
  const opts = options || {};
  if (value == null || value === '') {
    if (opts.allowNull !== false) return null;
    pushError(errors, field, 'ต้องระบุตัวเลข');
    return null;
  }
  const n = toSafeInteger(value);
  const min = opts.min == null ? 0 : opts.min;
  const max = opts.max == null ? 1000000 : opts.max;
  if (n == null || n < min || n > max) {
    pushError(errors, field, 'ต้องเป็นจำนวนเต็มระหว่าง ' + min + ' ถึง ' + max);
    return null;
  }
  return n;
}

function sanitizePercent(value, field, errors) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') {
    pushError(errors, field, 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 0 ถึง 100');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    pushError(errors, field, 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 0 ถึง 100');
    return null;
  }
  return n;
}

function sanitizeAmount(value, field, errors) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') {
    pushError(errors, field, 'จำนวนเงินไม่ถูกต้อง');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) {
    pushError(errors, field, 'จำนวนเงินไม่ถูกต้อง');
    return null;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultTier() {
  return {
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
}

function defaultFeatures() {
  return {
    quote_preview: {
      // Shadow mode is intentionally the safe default: the browser computes a
      // local preview from the same shared engine and compares it with the
      // server quote, but checkout still uses the legacy path until P3.
      enabled: true,
      mode: 'shadow',
      groups: ['all']
    }
  };
}

function defaultConfig() {
  return {
    schema_version: SCHEMA_VERSION,
    version: 0,
    published: false,
    pricing: { base: {}, promos: [] },
    tier: defaultTier(),
    shipping: { base: DEFAULT_SHIPPING.base, extra: DEFAULT_SHIPPING.extra, rules: [] },
    features: defaultFeatures(),
    updated_at: null,
    updated_by: null,
    published_at: null
  };
}

// ---------------------------------------------------------------------------
// Validation / sanitization
// ---------------------------------------------------------------------------

function sanitizePricing(input, errors, path) {
  const raw = isObject(input) ? input : {};
  const out = { base: {}, promos: [] };

  if (input != null && !isObject(input)) pushError(errors, path, 'ต้องเป็น object');

  const base = raw.base;
  if (base != null && !isObject(base)) pushError(errors, path + '.base', 'ต้องเป็น object');
  if (isObject(base)) {
    const keys = Object.keys(base);
    if (keys.length > MAX_BASE_PRICES) {
      pushError(errors, path + '.base', 'มีรายการราคามากเกินกำหนด (' + MAX_BASE_PRICES + ')');
    } else {
      keys.forEach(function (key) {
        if (isDangerousKey(key)) {
          pushError(errors, path + '.base', 'ชื่อ SKU ไม่ปลอดภัย');
          return;
        }
        if (!key || key.length > 500) {
          pushError(errors, path + '.base', 'ชื่อ SKU ต้องยาวไม่เกิน 500 ตัวอักษร');
          return;
        }
        if (base[key] == null || base[key] === '') return;
        const n = toSafeInteger(base[key]);
        if (n == null || n < 0 || n > 1000000) {
          pushError(errors, path + '.base[' + key + ']', 'ราคาต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 1,000,000');
          return;
        }
        out.base[key] = n;
      });
    }
  }

  if (raw.promos != null && !Array.isArray(raw.promos)) {
    pushError(errors, path + '.promos', 'ต้องเป็นรายการ');
  }
  const promos = Array.isArray(raw.promos) ? raw.promos : [];
  if (promos.length > MAX_PROMOS) {
    pushError(errors, path + '.promos', 'มีโปรโมชันมากเกินกำหนด (' + MAX_PROMOS + ')');
  } else {
    promos.forEach(function (promo, index) {
      const field = path + '.promos[' + index + ']';
      if (!isObject(promo)) {
        pushError(errors, field, 'ต้องเป็น object');
        return;
      }
      const id = text(promo.id, 120) || 'promo_' + (index + 1);
      const target = text(promo.target, 500);
      if (!/^(all|selected|type:[A-Za-z0-9_-]+|size:[A-Za-z0-9_-]+|sku:.+)$/.test(target)) {
        pushError(errors, field + '.target', 'เป้าหมายโปรไม่ถูกต้อง');
      }
      const mode = text(promo.mode, 20);
      if (['fixed', 'percent', 'amount'].indexOf(mode) < 0) {
        pushError(errors, field + '.mode', 'วิธีลดไม่ถูกต้อง');
      }
      let value = 0;
      if (mode === 'percent') value = sanitizePercent(promo.value, field + '.value', errors) || 0;
      else value = sanitizeInteger(promo.value, field + '.value', errors, { min: 0, max: 1000000, allowNull: false }) || 0;

      const start = sanitizeDate(promo.start, field + '.start', errors);
      const end = sanitizeDate(promo.end, field + '.end', errors);
      validateDateRange(start, end, field, errors);

      const skus = sanitizeStringArray(promo.skus, field + '.skus', errors, { max: MAX_SKUS, maxLength: 500 });
      if (target === 'selected' && !skus.length) {
        pushError(errors, field + '.skus', 'โปรเฉพาะสินค้าต้องเลือกสินค้าอย่างน้อย 1 ชิ้น');
      }

      out.promos.push({
        id: id,
        target: target,
        mode: mode,
        value: value,
        skus: target === 'selected' ? skus : [],
        label: text(promo.label, 200),
        start: start,
        end: end,
        enabled: promo.enabled !== false,
        updated: Number.isFinite(Number(promo.updated)) ? Number(promo.updated) : 0
      });
    });
  }

  return out;
}

function sanitizeTier(input, errors, path) {
  const raw = isObject(input) ? input : {};
  if (input != null && !isObject(input)) pushError(errors, path, 'ต้องเป็น object');

  const out = defaultTier();
  out.enabled = raw.enabled === true;
  out.name = text(raw.name, 120) || out.name;
  out.types = sanitizeStringArray(raw.types, path + '.types', errors, { max: 50, maxLength: 80 });
  if (!out.types.length) out.types = ['bag'];
  out.start = sanitizeDate(raw.start, path + '.start', errors);
  out.end = sanitizeDate(raw.end, path + '.end', errors);
  validateDateRange(out.start, out.end, path, errors);

  const tiers = objectField(raw, 'tiers', path, errors);
  [1, 2, 3].forEach(function (level) {
    const item = isObject(tiers[level]) ? tiers[level] : {};
    out.tiers[level] = {
      price: sanitizeInteger(item.price, path + '.tiers.' + level + '.price', errors, { min: 0, max: 1000000 }),
      gifts: text(item.gifts, 300)
    };
  });

  const sizeGifts = objectField(raw, 'sizeGifts', path, errors);
  const sizeGiftKeys = Object.keys(sizeGifts);
  if (sizeGiftKeys.length > 50) {
    pushError(errors, path + '.sizeGifts', 'มีของแถวตามไซส์มากเกินกำหนด (50)');
  } else {
    sizeGiftKeys.forEach(function (sizeKey) {
      if (isDangerousKey(sizeKey)) return;
      if (!sizeKey || sizeKey.length > 50) {
        pushError(errors, path + '.sizeGifts', 'ชื่อไซส์ต้องยาวไม่เกิน 50 ตัวอักษร');
        return;
      }
      const entry = isObject(sizeGifts[sizeKey]) ? sizeGifts[sizeKey] : {};
      out.sizeGifts[sizeKey] = {};
      [1, 2, 3].forEach(function (level) {
        out.sizeGifts[sizeKey][level] = text(entry[level], 300);
      });
    });
  }

  out.selectedGroups = sanitizeStringArray(raw.selectedGroups, path + '.selectedGroups', errors, { max: 200, maxLength: 100 });
  out.excludedSkus = sanitizeStringArray(raw.excludedSkus, path + '.excludedSkus', errors, { max: MAX_SKUS, maxLength: 500 });

  const productRules = objectField(raw, 'productRules', path, errors);
  const ruleKeys = Object.keys(productRules);
  if (ruleKeys.length > MAX_SKUS) {
    pushError(errors, path + '.productRules', 'มีกฎสินค้ามากเกินกำหนด');
  } else {
    ruleKeys.forEach(function (skuKey) {
      if (isDangerousKey(skuKey)) return;
      if (!skuKey || skuKey.length > 500) {
        pushError(errors, path + '.productRules', 'ชื่อ SKU ต้องยาวไม่เกิน 500 ตัวอักษร');
        return;
      }
      const rule = isObject(productRules[skuKey]) ? productRules[skuKey] : {};
      const entry = {};
      [1, 2, 3].forEach(function (level) {
        entry[level] = sanitizeInteger(rule[level], path + '.productRules[' + skuKey + '].' + level, errors, { min: 0, max: 1000000 });
      });
      out.productRules[skuKey] = entry;
    });
  }

  const groupModes = objectField(raw, 'groupModes', path, errors);
  const groupPercent = objectField(raw, 'groupPercent', path, errors);
  const groupKeys = Object.keys(groupPercent).concat(Object.keys(groupModes).filter(function (key) {
    return !hasOwn(groupPercent, key);
  }));
  if (groupKeys.length > 500) {
    pushError(errors, path + '.groupPercent', 'มีกลุ่มโปรโมชันมากเกินกำหนด (500)');
  } else {
    groupKeys.forEach(function (groupKey) {
      if (isDangerousKey(groupKey)) return;
      if (!groupKey || groupKey.length > 100) {
        pushError(errors, path + '.groupPercent', 'ชื่อกลุ่มต้องยาวไม่เกิน 100 ตัวอักษร');
        return;
      }
      const modes = isObject(groupModes[groupKey]) ? groupModes[groupKey] : {};
      const values = isObject(groupPercent[groupKey]) ? groupPercent[groupKey] : {};
      out.groupModes[groupKey] = {};
      out.groupPercent[groupKey] = {};
      [1, 2, 3].forEach(function (level) {
        const mode = modes[level] === 'amount' ? 'amount' : 'percent';
        out.groupModes[groupKey][level] = mode;
        out.groupPercent[groupKey][level] = mode === 'percent'
          ? sanitizePercent(values[level], path + '.groupPercent[' + groupKey + '].' + level, errors)
          : sanitizeAmount(values[level], path + '.groupPercent[' + groupKey + '].' + level, errors);
      });
    });
  }

  out.freeFrom = sanitizeInteger(raw.freeFrom, path + '.freeFrom', errors, { min: 0, max: 999 }) || 0;
  out.coverRemote = raw.coverRemote === true;
  return out;
}

function sanitizeShipping(input, errors, path) {
  const raw = isObject(input) ? input : {};
  if (input != null && !isObject(input)) pushError(errors, path, 'ต้องเป็น object');

  const out = {
    base: sanitizeInteger(raw.base, path + '.base', errors, { min: 0, max: 1000000 }),
    extra: sanitizeInteger(raw.extra, path + '.extra', errors, { min: 0, max: 1000000 }),
    rules: []
  };
  if (out.base == null) out.base = DEFAULT_SHIPPING.base;
  if (out.extra == null) out.extra = DEFAULT_SHIPPING.extra;

  if (raw.rules != null && !Array.isArray(raw.rules)) {
    pushError(errors, path + '.rules', 'ต้องเป็นรายการ');
  }
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rules.length > MAX_RULES) {
    pushError(errors, path + '.rules', 'มีกฎค่าส่งมากเกินกำหนด (' + MAX_RULES + ')');
  } else {
    rules.forEach(function (rule, index) {
      const field = path + '.rules[' + index + ']';
      if (!isObject(rule)) {
        pushError(errors, field, 'ต้องเป็น object');
        return;
      }
      const postcode = text(rule.postcode, 20);
      const province = text(rule.province, 100);
      const district = text(rule.district, 200);
      if (!postcode && !province) {
        pushError(errors, field, 'ต้องมีรหัสไปรษณีย์หรือจังหวัด');
        return;
      }
      if (postcode && !/^\d{5}$/.test(postcode)) {
        pushError(errors, field + '.postcode', 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก');
        return;
      }
      out.rules.push({
        postcode: postcode,
        province: province,
        district: district,
        enabled: rule.enabled !== false
      });
    });
  }
  return out;
}

function sanitizeFeatures(input, errors, path) {
  const out = defaultFeatures();
  if (input == null) return out;
  if (!isObject(input)) {
    pushError(errors, path, 'ต้องเป็น object');
    return out;
  }

  const raw = input.quote_preview;
  if (raw == null) return out;
  if (!isObject(raw)) {
    pushError(errors, path + '.quote_preview', 'ต้องเป็น object');
    return out;
  }

  if (raw.enabled != null && typeof raw.enabled !== 'boolean') {
    pushError(errors, path + '.quote_preview.enabled', 'ต้องเป็น true หรือ false');
  }
  out.quote_preview.enabled = raw.enabled === true;

  if (raw.mode != null && raw.mode !== 'shadow' && raw.mode !== 'active') {
    pushError(errors, path + '.quote_preview.mode', 'โหมดต้องเป็น shadow หรือ active');
  }
  out.quote_preview.mode = raw.mode === 'active' ? 'active' : 'shadow';

  if (hasOwn(raw, 'groups')) {
    out.quote_preview.groups = sanitizeStringArray(
      raw.groups,
      path + '.quote_preview.groups',
      errors,
      { max: 100, maxLength: 100 }
    );
  }
  return out;
}

function sanitizeConfigInput(input, options) {
  const opts = options || {};
  const errors = [];
  const raw = isObject(input) ? input : {};
  if (input != null && !isObject(input)) pushError(errors, '', 'ข้อมูล config ต้องเป็น object');

  if (opts.requireSections) {
    ['pricing', 'tier', 'shipping'].forEach(function (section) {
      if (!isObject(raw[section])) pushError(errors, section, 'ต้องระบุ ' + section);
    });
  }

  const value = {
    pricing: sanitizePricing(raw.pricing, errors, 'pricing'),
    tier: sanitizeTier(raw.tier, errors, 'tier'),
    shipping: sanitizeShipping(raw.shipping, errors, 'shipping'),
    features: sanitizeFeatures(raw.features, errors, 'features')
  };
  return { ok: errors.length === 0, errors: errors, value: value };
}

// ---------------------------------------------------------------------------
// Config load / cache
// ---------------------------------------------------------------------------

function normalizeStoredConfig(raw) {
  if (raw == null) return defaultConfig();

  const errors = [];
  if (!isObject(raw)) throw configError('INVALID_STORED_CONFIG', 'ข้อมูล pricing config บน Cloud ไม่ถูกต้อง');
  const version = raw.version == null ? 0 : safeVersion(raw.version);
  if (version == null) errors.push({ field: 'version', message: 'version ต้องเป็นจำนวนเต็มตั้งแต่ 0' });
  const sections = sanitizeConfigInput(raw, { requireSections: false });
  errors.push.apply(errors, sections.errors);
  if (errors.length) {
    throw configError('INVALID_STORED_CONFIG', 'ข้อมูล pricing config บน Cloud ไม่ผ่านการตรวจสอบ', errors);
  }

  return {
    schema_version: safeVersion(raw.schema_version) || SCHEMA_VERSION,
    version: version,
    published: version > 0,
    pricing: sections.value.pricing,
    tier: sections.value.tier,
    shipping: sections.value.shipping,
    features: sections.value.features,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
    updated_by: typeof raw.updated_by === 'string' ? raw.updated_by.slice(0, 120) : null,
    published_at: typeof raw.published_at === 'string' ? raw.published_at : null
  };
}

function cacheGet(store) {
  const key = store && store.cacheKey;
  if (!key) return null;
  const entry = configCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CONFIG_CACHE_TTL_MS) {
    configCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(store, value) {
  const key = store && store.cacheKey;
  if (!key) return;
  configCache.set(key, { at: Date.now(), value: clone(value) });
}

function invalidateConfigCache(store) {
  const key = store && store.cacheKey;
  if (key) configCache.delete(key);
}

function clearAllConfigCache() {
  configCache.clear();
}

async function loadConfig(store, options) {
  if (!store || typeof store.loadConfigDoc !== 'function') {
    throw configError('STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บ pricing config');
  }
  const opts = options || {};
  if (!opts.force) {
    const cached = cacheGet(store);
    if (cached) return clone(cached);
  }
  const raw = await store.loadConfigDoc();
  const config = normalizeStoredConfig(raw);
  cacheSet(store, config);
  return clone(config);
}

// ---------------------------------------------------------------------------
// Publish / restore / history
// ---------------------------------------------------------------------------

function actorText(actor) {
  return text(actor, 120) || 'admin';
}

function summarizeConfig(config) {
  const pricing = isObject(config && config.pricing) ? config.pricing : {};
  const tier = isObject(config && config.tier) ? config.tier : {};
  const shipping = isObject(config && config.shipping) ? config.shipping : {};
  return {
    base_prices: isObject(pricing.base) ? Object.keys(pricing.base).length : 0,
    promos: Array.isArray(pricing.promos) ? pricing.promos.length : 0,
    tier_enabled: tier.enabled === true,
    tier_selected_groups: Array.isArray(tier.selectedGroups) ? tier.selectedGroups.length : 0,
    tier_product_rules: isObject(tier.productRules) ? Object.keys(tier.productRules).length : 0,
    shipping_base: safeVersion(shipping.base) || 0,
    shipping_extra: safeVersion(shipping.extra) || 0,
    shipping_rules: Array.isArray(shipping.rules) ? shipping.rules.length : 0,
    quote_preview_enabled: !!(config && config.features && config.features.quote_preview && config.features.quote_preview.enabled),
    quote_preview_mode: config && config.features && config.features.quote_preview
      ? config.features.quote_preview.mode
      : 'shadow'
  };
}

async function publishConfig(store, input, actor) {
  if (!store || typeof store.publish !== 'function') {
    throw configError('STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บ pricing config');
  }
  const body = isObject(input) ? input : {};
  const expectedVersion = safeVersion(body.version);
  if (expectedVersion == null) {
    throw configError('INVALID_CONFIG', 'ต้องระบุ version ปัจจุบันก่อนเผยแพร่', [
      { field: 'version', message: 'version ต้องเป็นจำนวนเต็มตั้งแต่ 0' }
    ]);
  }
  const sections = sanitizeConfigInput(body, { requireSections: true });
  if (!sections.ok) {
    throw configError('INVALID_CONFIG', 'ข้อมูล pricing config ไม่ผ่านการตรวจสอบ', sections.errors);
  }

  // Older admin clients publish only pricing/tier/shipping. Preserve the
  // current rollout flags instead of resetting them on every pricing publish.
  let features = sections.value.features;
  if (body.features == null) {
    try {
      const current = await loadConfig(store);
      features = current && current.features ? current.features : defaultFeatures();
    } catch (err) {
      features = defaultFeatures();
    }
  }

  const now = new Date().toISOString();
  const nextVersion = expectedVersion + 1;
  if (!Number.isSafeInteger(nextVersion)) {
    throw configError('INVALID_CONFIG', 'version เกินกำหนด');
  }
  const baseDoc = {
    schema_version: SCHEMA_VERSION,
    version: nextVersion,
    pricing: sections.value.pricing,
    tier: sections.value.tier,
    shipping: sections.value.shipping,
    features: features,
    updated_at: now,
    updated_by: actorText(actor),
    published_at: now
  };
  const historyDoc = Object.assign({}, clone(baseDoc), {
    restored_from: body.restored_from ? safeVersion(body.restored_from) : null
  });

  let saved;
  try {
    saved = await store.publish(expectedVersion, baseDoc, historyDoc);
  } catch (err) {
    if (err && err.code === 'VERSION_CONFLICT') throw err;
    throw configError('PUBLISH_FAILED', 'บันทึก pricing config ไม่สำเร็จ', err && err.message ? { message: err.message } : null);
  }
  invalidateConfigCache(store);
  return clone(saved || baseDoc);
}

async function restoreConfig(store, input, actor) {
  if (!store || typeof store.getHistory !== 'function') {
    throw configError('STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บ pricing config');
  }
  const body = isObject(input) ? input : {};
  const sourceVersion = safeVersion(body.version);
  const expectedVersion = safeVersion(body.current_version);
  if (sourceVersion == null || sourceVersion < 1) {
    throw configError('INVALID_CONFIG', 'ต้องระบุ version ที่ต้องการย้อนกลับ', [
      { field: 'version', message: 'version ต้องเป็นจำนวนเต็มตั้งแต่ 1' }
    ]);
  }
  if (expectedVersion == null) {
    throw configError('INVALID_CONFIG', 'ต้องระบุ current_version', [
      { field: 'current_version', message: 'current_version ต้องเป็นจำนวนเต็มตั้งแต่ 0' }
    ]);
  }
  const history = await store.getHistory(sourceVersion);
  if (!history) {
    throw configError('HISTORY_NOT_FOUND', 'ไม่พบประวัติเวอร์ชันที่ต้องการ');
  }
  const sections = sanitizeConfigInput(history, { requireSections: false });
  if (!sections.ok) {
    throw configError('INVALID_STORED_CONFIG', 'ประวัติเวอร์ชันนี้ไม่ผ่านการตรวจสอบ', sections.errors);
  }
  return publishConfig(store, {
    version: expectedVersion,
    pricing: sections.value.pricing,
    tier: sections.value.tier,
    shipping: sections.value.shipping,
    restored_from: sourceVersion
  }, actor);
}

async function listHistory(store, limit) {
  if (!store || typeof store.listHistory !== 'function') {
    throw configError('STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บ pricing config');
  }
  const max = Math.min(50, Math.max(1, Number(limit) || 20));
  const rows = await store.listHistory(max);
  return (Array.isArray(rows) ? rows : []).map(function (row) {
    const config = normalizeStoredConfig(row);
    return {
      version: config.version,
      updated_at: config.updated_at,
      updated_by: config.updated_by,
      published_at: config.published_at,
      restored_from: row && row.restored_from ? safeVersion(row.restored_from) : null,
      summary: summarizeConfig(config)
    };
  });
}

// ---------------------------------------------------------------------------
// Trusted catalog
// ---------------------------------------------------------------------------

function mergeCategories(customCategories) {
  const out = clone(BUILTIN_CATEGORIES);
  (Array.isArray(customCategories) ? customCategories : []).forEach(function (category) {
    if (!isObject(category) || !category.id) return;
    if (out.some(function (x) { return x.id === category.id; })) return;
    out.push({
      id: text(category.id, 100),
      name: text(category.name || category.id, 200),
      description: text(category.description, 500),
      is_builtin: false,
      show_on_home: category.show_on_home !== false
    });
  });
  return out;
}

function buildCatalogContext(config, source, options) {
  const opts = options || {};
  const customProducts = Array.isArray(source && source.customProducts) ? source.customProducts : [];
  const categories = mergeCategories(source && source.categories);
  const engineCatalog = HLGPricing.createCatalog({
    patterns: patterns.ALL_PATTERNS,
    stickers: patterns.STICKER_PATTERNS,
    customProducts: customProducts,
    categories: categories,
    includeDefaultWallpaper: true
  });
  const duplicates = Array.from(new Set(engineCatalog.duplicates || []));
  if (duplicates.length) {
    throw configError('DUPLICATE_SKU', 'พบ SKU ซ้ำใน catalog', { duplicates: duplicates });
  }

  const pricing = isObject(config && config.pricing) ? config.pricing : { base: {}, promos: [] };
  const now = opts.now == null ? Date.now() : opts.now;
  const items = engineCatalog.items.map(function (product) {
    const resolved = HLGPricing.resolveItemPrice(product, pricing, now);
    return {
      sku: product.sku,
      legacy_sku: HLGPricing.legacySku(product),
      aliases: product.aliases.slice(),
      type: product.type,
      name: product.name,
      variant: product.variant,
      size_key: product.sizeKey,
      category_id: product.categoryId,
      product_id: product.productId,
      image: product.image,
      download_url: product.downloadUrl,
      catalog_price: product.price,
      base_price: resolved.base,
      price: resolved.price,
      promo: resolved.promo ? {
        id: text(resolved.promo.id),
        label: text(resolved.promo.label),
        target: text(resolved.promo.target),
        mode: text(resolved.promo.mode),
        value: Number(resolved.promo.value) || 0
      } : null
    };
  });

  return {
    engine: engineCatalog,
    pricing: pricing,
    now: now,
    catalog: {
      schema_version: SCHEMA_VERSION,
      catalog_version: HLGPricing.VERSION,
      pricing_version: config && config.version ? Number(config.version) : 0,
      generated_at: new Date().toISOString(),
      categories: categories,
      count: items.length,
      duplicates: [],
      items: items
    }
  };
}

function buildCatalog(config, source, options) {
  return buildCatalogContext(config, source, options).catalog;
}

function httpError(err) {
  const code = (err && err.code) || 'PRICING_ERROR';
  let status = 500;
  if (code === 'INVALID_CONFIG') status = 400;
  else if (code === 'VERSION_CONFLICT' || code === 'DUPLICATE_SKU') status = 409;
  else if (code === 'HISTORY_NOT_FOUND') status = 404;
  const body = {
    success: false,
    error: (err && err.message) || 'เกิดข้อผิดพลาดเกี่ยวกับข้อมูลราคา',
    code: code
  };
  if (err && err.details) body.details = err.details;
  if (code === 'VERSION_CONFLICT' && err && err.current_version != null) {
    body.current_version = err.current_version;
  }
  return { status: status, body: body };
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  CONFIG_CACHE_TTL_MS: CONFIG_CACHE_TTL_MS,
  BUILTIN_CATEGORIES: BUILTIN_CATEGORIES,
  DEFAULT_SHIPPING: DEFAULT_SHIPPING,
  defaultConfig: defaultConfig,
  defaultTier: defaultTier,
  defaultFeatures: defaultFeatures,
  normalizeStoredConfig: normalizeStoredConfig,
  sanitizeConfigInput: sanitizeConfigInput,
  sanitizeFeatures: sanitizeFeatures,
  loadConfig: loadConfig,
  publishConfig: publishConfig,
  restoreConfig: restoreConfig,
  listHistory: listHistory,
  buildCatalog: buildCatalog,
  buildCatalogContext: buildCatalogContext,
  mergeCategories: mergeCategories,
  summarizeConfig: summarizeConfig,
  invalidateConfigCache: invalidateConfigCache,
  clearAllConfigCache: clearAllConfigCache,
  configError: configError,
  httpError: httpError
};
