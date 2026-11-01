// ============================================================================
// HLG Quote Service
// ============================================================================
// Server-side quote creation. The browser may calculate a preview with the same
// shared engine, but only this service is allowed to produce a quote that can
// later be used by checkout (P3).
//
// Storage is injected through a small adapter:
//   saveQuote(doc)         -> Promise
//   getQuote(quote_id)     -> Promise<doc|null>
// ============================================================================
'use strict';

const crypto = require('crypto');
const HLGPricing = require('./public/data/pricing-engine.js');

const QUOTE_VERSION = 1;
const QUOTE_TTL_MS = 30 * 60 * 1000;
const MAX_ITEMS = 50;
const MAX_TOTAL_QTY = 999;
const MAX_SKU_LENGTH = 500;
const MAX_ADDRESS_LENGTH = 2000;
const MAX_COUPON_CODE_LENGTH = 120;
const MAX_LINE_USER_ID_LENGTH = 100;

function quoteError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details || null;
  return err;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return value == null ? '' : String(value);
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function normalizeNow(value) {
  if (value == null) return Date.now();
  const n = Number(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(n) || n < 0) throw quoteError('INVALID_QUOTE_INPUT', 'เวลาที่ใช้สร้าง quote ไม่ถูกต้อง');
  return n;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateQuoteId() {
  return 'q_' + Date.now().toString(36) + '_' + randomHex(10);
}

function generateQuoteToken() {
  return randomHex(32);
}

function safeEqualHex(left, right) {
  const a = Buffer.from(text(left), 'utf8');
  const b = Buffer.from(text(right), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

function verifyQuoteToken(doc, token) {
  if (!doc || !doc.quote_token_hash || !token) return false;
  return safeEqualHex(doc.quote_token_hash, sha256(token));
}

function normalizeLineUserId(value) {
  const id = text(value).trim();
  if (id.length > MAX_LINE_USER_ID_LENGTH) {
    throw quoteError('INVALID_QUOTE_INPUT', 'LINE User ID ยาวเกินกำหนด');
  }
  return id;
}

function normalizeAddress(value) {
  if (value == null) return '';
  let address = '';
  if (typeof value === 'string') {
    address = value;
  } else if (isObject(value)) {
    const parts = [
      value.address,
      value.address1,
      value.address2,
      value.district,
      value.amphoe,
      value.province,
      value.postcode,
      value.text
    ].map(function (part) { return text(part).trim(); }).filter(Boolean);
    address = parts.join('\n');
  } else {
    throw quoteError('INVALID_ADDRESS', 'ที่อยู่จัดส่งไม่ถูกต้อง');
  }
  address = address.trim();
  if (address.length > MAX_ADDRESS_LENGTH) {
    throw quoteError('INVALID_ADDRESS', 'ที่อยู่จัดส่งยาวเกินกำหนด (' + MAX_ADDRESS_LENGTH + ' ตัวอักษร)');
  }
  return address;
}

function normalizeCouponCode(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    throw quoteError('INVALID_QUOTE_INPUT', 'รหัสคูปองต้องเป็นข้อความ');
  }
  const code = value.trim();
  if (code.length > MAX_COUPON_CODE_LENGTH) {
    throw quoteError('INVALID_QUOTE_INPUT', 'รหัสคูปองยาวเกินกำหนด');
  }
  return code;
}

function normalizeItems(input, catalog) {
  if (!Array.isArray(input)) {
    throw quoteError('INVALID_QUOTE_INPUT', 'รายการสินค้าต้องเป็น array');
  }
  if (!input.length) throw quoteError('EMPTY_CART', 'ไม่มีสินค้าในตะกร้า');
  if (input.length > MAX_ITEMS) {
    throw quoteError('TOO_MANY_ITEMS', 'จำนวนรายการสินค้าเกินกำหนด', { max_items: MAX_ITEMS });
  }
  if (!catalog || typeof catalog.lookup !== 'function') {
    throw quoteError('QUOTE_SERVICE_UNAVAILABLE', 'ยังโหลด catalog ฝั่งเซิร์ฟเวอร์ไม่ได้');
  }

  const seen = new Set();
  const out = [];
  let totalQty = 0;

  input.forEach(function (raw, index) {
    if (!isObject(raw)) {
      throw quoteError('INVALID_QUOTE_INPUT', 'รายการสินค้าไม่ถูกต้อง', { index: index });
    }
    const sku = text(raw.sku).trim();
    if (!sku || sku.length > MAX_SKU_LENGTH) {
      throw quoteError('INVALID_QUOTE_INPUT', 'SKU ต้องไม่ว่างและยาวไม่เกิน ' + MAX_SKU_LENGTH + ' ตัวอักษร', { index: index });
    }
    const qty = Number(raw.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw quoteError('INVALID_QTY', 'จำนวนสินค้าต้องเป็นจำนวนเต็มมากกว่า 0', { index: index, qty: raw.qty });
    }
    if (qty > HLGPricing.MAX_QTY) {
      throw quoteError('INVALID_QTY', 'จำนวนสินค้าเกินกำหนด', { index: index, qty: qty, max: HLGPricing.MAX_QTY });
    }

    const product = catalog.lookup({ sku: sku });
    if (!product) {
      throw quoteError('UNKNOWN_ITEM', 'ไม่พบสินค้าใน catalog', { index: index, sku: sku });
    }
    if (seen.has(product.sku)) {
      throw quoteError('DUPLICATE_ITEM', 'มีสินค้าซ้ำในรายการ กรุณารวมจำนวนก่อนสร้าง quote', { index: index, sku: product.sku });
    }
    seen.add(product.sku);
    totalQty += qty;
    const entry = { sku: product.sku, qty: qty };
    if (raw.sponge === true) entry.sponge = true;
    out.push(entry);
  });

  if (totalQty > MAX_TOTAL_QTY) {
    throw quoteError('TOO_MANY_UNITS', 'จำนวนสินค้ารวมเกินกำหนด', { max_total_qty: MAX_TOTAL_QTY, total_qty: totalQty });
  }
  return out;
}

function totalsFromQuote(quote) {
  const subtotal = roundMoney(quote.subtotal);
  const itemDiscount = roundMoney(quote.item_discount);
  const tierDiscount = roundMoney(quote.tier_discount);
  const couponDiscount = roundMoney(quote.coupon_discount);
  const totalBeforeShipping = Math.max(0, roundMoney(quote.total_before_shipping));
  const shippingCost = roundMoney(quote.shipping_cost);
  const grandTotal = Math.max(0, roundMoney(quote.grand_total));
  return {
    item_discount: itemDiscount,
    tier_discount: tierDiscount,
    coupon_discount: couponDiscount,
    subtotal: subtotal,
    total_before_shipping: totalBeforeShipping,
    shipping_cost: shippingCost,
    grand_total: grandTotal,
    discount_total: roundMoney(itemDiscount + tierDiscount + couponDiscount)
  };
}

function pricingConfigHash(config, pricing, tier, shipping) {
  return sha256(JSON.stringify({
    version: Number(config && config.version) || 0,
    pricing: pricing || {},
    tier: tier || {},
    shipping: shipping || {}
  }));
}

function responseForQuote(quote, doc, token) {
  const totals = totalsFromQuote(quote);
  const tier = quote.tier || {};
  const coupon = quote.coupon || null;
  return {
    success: true,
    quote_id: doc.quote_id,
    quote_version: QUOTE_VERSION,
    expires_at: doc.expires_at,
    expires_in: Math.max(0, Math.floor((doc.expires_at_ms - (Date.parse(doc.created_at) || Date.now())) / 1000)),
    currency: quote.currency || 'THB',
    items: quote.items || [],
    item_discount: totals.item_discount,
    tier: {
      name: text(tier.name),
      quantity: Number(tier.quantity) || 0,
      level: Number(tier.level) || 0,
      discount: totals.tier_discount,
      gifts: text(tier.gifts || quote.gifts),
      free_shipping: !!quote.free_shipping
    },
    tier_discount: totals.tier_discount,
    coupon: coupon ? {
      code: text(coupon.code),
      redeem_category: text(coupon.redeem_category),
      eligible_subtotal: roundMoney(coupon.eligible_subtotal),
      discount: totals.coupon_discount
    } : null,
    coupon_discount: totals.coupon_discount,
    subtotal: totals.subtotal,
    total_before_shipping: totals.total_before_shipping,
    shipping: quote.shipping || {
      base: 0,
      extra: 0,
      total: totals.shipping_cost,
      remote: false,
      pending: false,
      rule: null,
      freeShipping: !!quote.free_shipping
    },
    shipping_cost: totals.shipping_cost,
    grand_total: totals.grand_total,
    free_shipping: !!quote.free_shipping,
    gifts: text(quote.gifts),
    discount_total: totals.discount_total,
    pricing_version: Number(doc.pricing_version) || 0,
    quote_token: token
  };
}

async function issueQuote(options) {
  const opts = options || {};
  const body = opts.body;
  if (!isObject(body)) {
    throw quoteError('INVALID_QUOTE_INPUT', 'ข้อมูล quote ไม่ถูกต้อง');
  }
  if (!opts.store || typeof opts.store.saveQuote !== 'function') {
    throw quoteError('QUOTE_STORAGE_FAILED', 'ยังไม่ได้ตั้งค่าที่เก็บ quote');
  }

  const now = normalizeNow(opts.now);
  const config = isObject(opts.config) ? opts.config : {};
  const pricing = isObject(opts.pricing) ? opts.pricing : (config.pricing || { base: {}, promos: [] });
  const tier = opts.tier == null ? config.tier : opts.tier;
  const shipping = opts.shipping == null ? config.shipping : opts.shipping;
  const address = normalizeAddress(body.address);
  const lineUserId = normalizeLineUserId(opts.lineUserId || body.line_user_id);
  const couponCode = normalizeCouponCode(body.coupon_code);
  const requestedItems = normalizeItems(body.items, opts.catalog);

  let baseQuote;
  try {
    baseQuote = HLGPricing.computeQuote({
      catalog: opts.catalog,
      pricing: pricing,
      tier: tier,
      shipping: shipping,
      items: requestedItems,
      address: address,
      now: now
    });
  } catch (err) {
    throw mapPricingError(err);
  }

  let couponRecord = null;
  if (couponCode) {
    if (typeof opts.couponValidator !== 'function') {
      throw quoteError('QUOTE_SERVICE_UNAVAILABLE', 'ยังตรวจสอบคูปองฝั่งเซิร์ฟเวอร์ไม่ได้');
    }
    let validation;
    try {
      validation = await opts.couponValidator({
        db: opts.db,
        code: couponCode,
        lineUserId: lineUserId,
        items: baseQuote.items,
        subtotal: baseQuote.subtotal,
        now: now
      });
    } catch (err) {
      throw quoteError('QUOTE_SERVICE_UNAVAILABLE', 'ตรวจสอบคูปองกับระบบไม่สำเร็จ กรุณาลองใหม่');
    }
    if (!validation || validation.valid !== true) {
      throw quoteError(
        'COUPON_NOT_ELIGIBLE',
        (validation && validation.error) || 'คูปองนี้ใช้กับตะกร้านี้ไม่ได้',
        { coupon_code: couponCode }
      );
    }
    couponRecord = validation.coupon || null;
    if (!couponRecord) {
      throw quoteError('QUOTE_SERVICE_UNAVAILABLE', 'ไม่พบข้อมูลคูปองที่ผ่านการตรวจสอบ');
    }
  }

  let quote;
  try {
    quote = HLGPricing.computeQuote({
      catalog: opts.catalog,
      pricing: pricing,
      tier: tier,
      shipping: shipping,
      items: requestedItems,
      coupon: couponRecord,
      address: address,
      now: now
    });
  } catch (err) {
    throw mapPricingError(err);
  }

  const totals = totalsFromQuote(quote);
  const quoteId = generateQuoteId();
  const token = generateQuoteToken();
  const expiresAtMs = now + QUOTE_TTL_MS;
  const configHash = pricingConfigHash(config, pricing, tier, shipping);
  const couponSummary = quote.coupon ? {
    code: text(quote.coupon.code).toUpperCase(),
    redeem_category: text(quote.coupon.redeem_category),
    eligible_subtotal: roundMoney(quote.coupon.eligible_subtotal),
    discount: totals.coupon_discount
  } : null;

  const doc = {
    schema_version: QUOTE_VERSION,
    quote_id: quoteId,
    quote_token_hash: sha256(token),
    status: 'open',
    used_at: null,
    used_in_order_id: null,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_at_ms: expiresAtMs,
    currency: quote.currency || 'THB',
    // Keep the quote document free of raw address/profile data. P3 can bind an
    // order to the quote by hashing the submitted address/LINE ID again.
    line_user_hash: lineUserId ? sha256('line:' + lineUserId) : null,
    address_hash: address ? sha256(address) : null,
    request_hash: sha256(JSON.stringify({ items: requestedItems, address: address, coupon_code: couponCode })),
    requested_items: clone(requestedItems),
    items: clone(quote.items || []),
    totals: clone(totals),
    item_discount: totals.item_discount,
    tier_discount: totals.tier_discount,
    coupon_discount: totals.coupon_discount,
    subtotal: totals.subtotal,
    total_before_shipping: totals.total_before_shipping,
    shipping_cost: totals.shipping_cost,
    grand_total: totals.grand_total,
    free_shipping: !!quote.free_shipping,
    gifts: text(quote.gifts),
    coupon_code: couponSummary ? couponSummary.code : null,
    coupon_id: couponRecord ? (couponRecord._docId || couponRecord.id || null) : null,
    coupon: couponSummary,
    pricing_version: Number(config.version) || 0,
    pricing_snapshot: {
      engine_version: HLGPricing.VERSION,
      pricing_version: Number(config.version) || 0,
      config_hash: configHash,
      tier: clone(quote.snapshot && quote.snapshot.tier || null),
      shipping: clone(quote.snapshot && quote.snapshot.shipping || null),
      coupon: clone(quote.snapshot && quote.snapshot.coupon || null),
      item_prices: (quote.items || []).map(function (item) {
        return {
          sku: item.sku,
          qty: item.qty,
          base_price: item.base_price,
          unit_price: item.unit_price,
          tier_unit_price: item.tier_unit_price,
          line_total: item.line_total
        };
      })
    }
  };

  try {
    const saved = await opts.store.saveQuote(doc);
    if (saved && saved.quote_id) doc.quote_id = saved.quote_id;
  } catch (err) {
    // Do not echo storage/backend details to the client. The API layer logs
    // the error code; production diagnostics belong in server logs.
    throw quoteError('QUOTE_STORAGE_FAILED', 'บันทึก quote ไม่สำเร็จ');
  }

  return {
    response: responseForQuote(quote, doc, token),
    doc: doc
  };
}

function mapPricingError(err) {
  if (!err) return quoteError('QUOTE_ERROR', 'สร้าง quote ไม่สำเร็จ');
  if (err.code === 'EMPTY_CART' || err.code === 'UNKNOWN_ITEM' || err.code === 'INVALID_QTY') return err;
  return quoteError('QUOTE_ERROR', err.message || 'สร้าง quote ไม่สำเร็จ');
}

function isQuoteExpired(doc, now) {
  if (!doc) return true;
  const at = now == null ? Date.now() : normalizeNow(now);
  const expires = Number(doc.expires_at_ms);
  if (Number.isFinite(expires)) return expires <= at;
  const parsed = Date.parse(doc.expires_at || '');
  return !Number.isFinite(parsed) || parsed <= at;
}

async function getQuote(options) {
  const opts = options || {};
  if (!opts.store || typeof opts.store.getQuote !== 'function') {
    throw quoteError('QUOTE_STORAGE_FAILED', 'ยังไม่ได้ตั้งค่าที่เก็บ quote');
  }
  const quoteId = text(opts.quoteId).trim();
  if (!quoteId) throw quoteError('INVALID_QUOTE_INPUT', 'ต้องระบุ quote_id');
  const doc = await opts.store.getQuote(quoteId);
  if (!doc || doc.quote_id && doc.quote_id !== quoteId) {
    throw quoteError('QUOTE_NOT_FOUND', 'ไม่พบ quote นี้');
  }

  if (opts.token != null) {
    if (!verifyQuoteToken(doc, opts.token)) {
      throw quoteError('QUOTE_TOKEN_MISMATCH', 'quote token ไม่ถูกต้อง');
    }
  } else if (opts.requireToken === true) {
    throw quoteError('QUOTE_TOKEN_REQUIRED', 'ต้องระบุ quote token');
  }

  const lineUserId = normalizeLineUserId(opts.lineUserId);
  if (lineUserId) {
    const incomingLineHash = sha256('line:' + lineUserId);
    if (doc.line_user_hash) {
      if (!safeEqualHex(incomingLineHash, doc.line_user_hash)) {
        throw quoteError('QUOTE_OWNER_MISMATCH', 'quote นี้ผูกกับบัญชี LINE อื่น');
      }
    } else if (doc.line_user_id && lineUserId !== doc.line_user_id) {
      // Backward compatibility for quotes created before owner hashes.
      throw quoteError('QUOTE_OWNER_MISMATCH', 'quote นี้ผูกกับบัญชี LINE อื่น');
    }
  }
  if (doc.used_at || doc.status === 'used') {
    throw quoteError('QUOTE_USED', 'quote นี้ถูกใช้แล้ว');
  }
  if (isQuoteExpired(doc, opts.now)) {
    throw quoteError('QUOTE_EXPIRED', 'quote นี้หมดอายุแล้ว กรุณาสร้าง quote ใหม่');
  }
  return doc;
}

function clientKey(req) {
  const forwarded = req && req.headers && req.headers['x-forwarded-for'];
  const raw = forwarded
    ? String(forwarded).split(',')[0].trim()
    : text(req && ((req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress))).trim();
  return 'ip:' + sha256(raw || 'unknown').slice(0, 24);
}

function createRateLimiter(options) {
  const opts = options || {};
  const max = Math.max(1, Math.floor(Number(opts.max) || 30));
  const windowMs = Math.max(1000, Math.floor(Number(opts.windowMs) || 60 * 1000));
  const buckets = new Map();

  function prune(now) {
    if (buckets.size < 20000) return;
    buckets.forEach(function (bucket, key) {
      if (bucket.reset_at <= now) buckets.delete(key);
    });
    if (buckets.size > 25000) buckets.clear();
  }

  return {
    max: max,
    windowMs: windowMs,
    check(key, now) {
      const at = now == null ? Date.now() : Number(now);
      prune(at);
      const bucketKey = text(key) || 'unknown';
      let bucket = buckets.get(bucketKey);
      if (!bucket || bucket.reset_at <= at) {
        bucket = { count: 0, reset_at: at + windowMs };
        buckets.set(bucketKey, bucket);
      }
      if (bucket.count >= max) {
        return {
          allowed: false,
          limit: max,
          remaining: 0,
          retry_after: Math.max(0, Math.ceil((bucket.reset_at - at) / 1000)),
          reset_at: bucket.reset_at
        };
      }
      bucket.count += 1;
      return {
        allowed: true,
        limit: max,
        remaining: Math.max(0, max - bucket.count),
        retry_after: 0,
        reset_at: bucket.reset_at
      };
    },
    reset() {
      buckets.clear();
    }
  };
}

function httpError(err) {
  const rawCode = (err && err.code) || '';
  const allowedCodes = [
    'INVALID_QUOTE_INPUT', 'EMPTY_CART', 'UNKNOWN_ITEM', 'INVALID_QTY',
    'DUPLICATE_ITEM', 'TOO_MANY_ITEMS', 'TOO_MANY_UNITS', 'INVALID_ADDRESS',
    'COUPON_NOT_ELIGIBLE', 'QUOTE_NOT_FOUND', 'QUOTE_EXPIRED', 'QUOTE_USED',
    'QUOTE_TOKEN_MISMATCH', 'QUOTE_OWNER_MISMATCH', 'QUOTE_TOKEN_REQUIRED',
    'RATE_LIMITED', 'QUOTE_STORAGE_FAILED', 'QUOTE_SERVICE_UNAVAILABLE',
    'QUOTE_ERROR'
  ];
  const code = allowedCodes.indexOf(rawCode) >= 0 ? rawCode : 'QUOTE_ERROR';
  let status = 500;
  if ([
    'INVALID_QUOTE_INPUT', 'EMPTY_CART', 'UNKNOWN_ITEM', 'INVALID_QTY',
    'DUPLICATE_ITEM', 'TOO_MANY_ITEMS', 'TOO_MANY_UNITS', 'INVALID_ADDRESS',
    'COUPON_NOT_ELIGIBLE'
  ].indexOf(code) >= 0) status = 400;
  else if (code === 'QUOTE_NOT_FOUND') status = 404;
  else if (code === 'QUOTE_EXPIRED') status = 410;
  else if (code === 'QUOTE_USED') status = 409;
  else if (code === 'QUOTE_TOKEN_MISMATCH' || code === 'QUOTE_OWNER_MISMATCH') status = 403;
  else if (code === 'QUOTE_TOKEN_REQUIRED') status = 401;
  else if (code === 'RATE_LIMITED') status = 429;
  else if (code === 'QUOTE_STORAGE_FAILED' || code === 'QUOTE_SERVICE_UNAVAILABLE') status = 500;

  const body = {
    success: false,
    // Never echo storage/DB/provider messages from a server failure.
    error: status >= 500
      ? 'ระบบตรวจสอบราคาขัดข้อง กรุณาลองใหม่'
      : ((err && err.message) || 'สร้าง quote ไม่สำเร็จ'),
    code: code
  };
  if (err && err.details && status < 500) body.details = err.details;
  if (code === 'RATE_LIMITED' && err && err.retry_after != null) body.retry_after = err.retry_after;
  return { status: status, body: body };
}

module.exports = {
  QUOTE_VERSION: QUOTE_VERSION,
  QUOTE_TTL_MS: QUOTE_TTL_MS,
  MAX_ITEMS: MAX_ITEMS,
  MAX_TOTAL_QTY: MAX_TOTAL_QTY,
  MAX_ADDRESS_LENGTH: MAX_ADDRESS_LENGTH,
  issueQuote: issueQuote,
  getQuote: getQuote,
  isQuoteExpired: isQuoteExpired,
  verifyQuoteToken: verifyQuoteToken,
  clientKey: clientKey,
  createRateLimiter: createRateLimiter,
  quoteError: quoteError,
  httpError: httpError
};
