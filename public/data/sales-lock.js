/**
 * sales-lock.js
 *
 * "ล็อกการขาย" — rules the admin sets to stop customers ordering something for a
 * while (the whole shop, every bag, one bag size, stickers, wallpaper, or hand-picked
 * items), optionally only between a start and an end time.
 *
 * One file, two homes: the server requires this copy, the storefront and /admin/
 * load the identical copy at public/data/sales-lock.js (a test keeps them equal).
 *
 * Stored as the site setting hlg_sales_lock_v1:
 *   { rules: [{ id, target, skus?, message, enabled, start, end, updated }] }
 *   target: 'all' | 'type:<type>' | 'size:<normal|large|easy|maxi>' | 'selected'
 *   skus:   JSON [type, name, variant] strings, the same key the stock editor uses
 *   start/end: 'YYYY-MM-DDTHH:mm' in Thai time, '' = no bound
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.hlgSalesLockCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'hlg_sales_lock_v1';
  var DEFAULT_MESSAGE = 'ปิดรับออเดอร์ชั่วคราวค่ะ';
  // Bag items carry their size as the variant text; the built-in sizes map to these keys.
  var SIZE_KEYS = {
    '15 × 16 inch': 'normal',
    '15.5 × 4 × 16 inch': 'large',
    '10.5 × 5 × 14 inch': 'easy',
    '13.5 × 6 × 17 inch': 'maxi'
  };

  function sku(x) {
    return JSON.stringify([String(x.type || 'bag'), String(x.name || ''), String(x.variant || '')]);
  }

  function parse(raw) {
    var v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (e) { v = null; } }
    var rules = v && Array.isArray(v.rules) ? v.rules.filter(function (r) { return r && typeof r === 'object' && typeof r.target === 'string'; }) : [];
    return { rules: rules };
  }

  function active(rule, now) {
    if (!rule || rule.enabled === false) return false;
    var t = now === undefined ? Date.now() : now;
    var start = rule.start ? Date.parse(rule.start + '+07:00') : NaN;
    var end = rule.end ? Date.parse(rule.end + '+07:00') : NaN;
    // A bound that cannot be read never unlocks by accident: bad start = already started, bad end = no end.
    if (rule.start && Number.isFinite(start) && t < start) return false;
    if (rule.end && Number.isFinite(end) && t > end) return false;
    return true;
  }

  function sizeKeyOf(item) {
    return item.sizeKey || SIZE_KEYS[String(item.variant || '').trim()] || '';
  }

  function matches(rule, item) {
    var type = String(item.type || 'bag');
    if (rule.target === 'all') return true;
    if (rule.target === 'selected') {
      if (!Array.isArray(rule.skus)) return false;
      // Items of a shop-made category carry the category name as variant in the cart but not
      // on their cards, so the picker stores them without one: match on type + name.
      return rule.skus.indexOf(sku(item)) >= 0 || (type === 'custom' && rule.skus.indexOf(sku({ type: type, name: item.name, variant: '' })) >= 0);
    }
    if (rule.target === 'type:' + type) return true;
    if (rule.target.indexOf('size:') === 0) return type === 'bag' && rule.target === 'size:' + sizeKeyOf(item);
    return false;
  }

  /** The rule that locks this item right now, or null. */
  function lockFor(item, cfg, now) {
    var rules = parse(cfg).rules;
    for (var i = 0; i < rules.length; i++) {
      if (active(rules[i], now) && matches(rules[i], item)) return rules[i];
    }
    return null;
  }

  function message(rule) {
    return String((rule && rule.message) || '').trim() || DEFAULT_MESSAGE;
  }

  /** First locked item among `items`: { item, rule, text } or null. */
  function problem(items, cfg, now) {
    var list = Array.isArray(items) ? items : [];
    var parsed = parse(cfg);
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== 'object') continue;
      var rule = lockFor(list[i], parsed, now);
      if (rule) {
        var name = String(list[i].name || '').trim();
        return { item: list[i], rule: rule, text: (rule.target === 'all' || !name ? '' : name + ': ') + message(rule) };
      }
    }
    return null;
  }

  return { KEY: KEY, DEFAULT_MESSAGE: DEFAULT_MESSAGE, SIZE_KEYS: SIZE_KEYS, sku: sku, parse: parse, active: active, matches: matches, lockFor: lockFor, message: message, problem: problem };
});
