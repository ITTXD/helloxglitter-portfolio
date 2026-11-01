// ============================================================================
// Storefront cloud pricing hydration
// ============================================================================
// Reads the published pricing config from the server and mirrors it into the
// three legacy localStorage keys used by the existing storefront UI. If the
// values changed, the page reloads once so every pricing script starts from the
// same config. Admin sessions are skipped by default to protect local drafts;
// use `?hlg_cloud=1` to force a preview, or set
// `hlg_pricing_cloud_optout_v1=1` to disable hydration on a device.
// ============================================================================
(function (root) {
  'use strict';

  var KEYS = {
    pricing: 'hlg_pricing_v1',
    tier: 'hlg_quantity_promo_v1',
    shipping: 'hlg_shipping_v1'
  };
  var SHIPPING_MIGRATION_KEY = 'hlg_shipping_flash_image_20260928_v1';
  var VERSION_KEY = 'hlg_pricing_cloud_version_v1';
  var UPDATED_KEY = 'hlg_pricing_cloud_updated_at_v1';
  var SYNCED_KEY = 'hlg_pricing_cloud_synced_at_v1';
  var OPT_OUT_KEY = 'hlg_pricing_cloud_optout_v1';

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

  function isAdminSession() {
    try {
      if (root.localStorage && root.localStorage.getItem('hlg_admin_session_v2') === '1') return true;
      if (root.sessionStorage && root.sessionStorage.getItem('hlg_admin_session_v2') === '1') return true;
      if (root.document && root.document.body && root.document.body.classList.contains('admin-mode')) return true;
    } catch (e) {}
    return false;
  }

  function forceRequested() {
    try {
      return /[?&]hlg_cloud=1(?:&|$)/.test(root.location && root.location.search || '');
    } catch (e) {
      return false;
    }
  }

  function stableJSON(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJSON(value[key]);
    }).join(',') + '}';
  }

  function localJSON(key) {
    var raw = safeGet(root.localStorage, key);
    if (raw == null) return null;
    try { return stableJSON(JSON.parse(raw)); } catch (e) { return null; }
  }

  function sectionsFrom(data) {
    return {
      pricing: data && data.pricing && typeof data.pricing === 'object' ? data.pricing : { base: {}, promos: [] },
      tier: data && data.tier && typeof data.tier === 'object' ? data.tier : {},
      shipping: data && data.shipping && typeof data.shipping === 'object' ? data.shipping : { base: 40, extra: 25, rules: [] }
    };
  }

  function writeMeta(data) {
    safeSet(root.localStorage, VERSION_KEY, String(data.version));
    safeSet(root.localStorage, UPDATED_KEY, data.updated_at || '');
    safeSet(root.localStorage, SYNCED_KEY, new Date().toISOString());
  }

  function refreshUI() {
    var names = [
      'renderUnifiedCart',
      'renderPromoWrap',
      'buildGallery',
      'stickerBuildGallery',
      'hlgRefreshCollections',
      'hlgDecorateTierGalleries',
      'hlgRefreshPreviewCards'
    ];
    function run() {
      names.forEach(function (name) {
        try {
          if (typeof root[name] === 'function') root[name]();
        } catch (e) {}
      });
      try {
        root.dispatchEvent(new CustomEvent('hlg:pricing-cloud-applied', {
          detail: { version: Number(safeGet(root.localStorage, VERSION_KEY)) || 0 }
        }));
      } catch (e) {}
    }
    if (typeof root.setTimeout === 'function') root.setTimeout(run, 0);
    else run();
  }

  function applyConfig(data, options) {
    var opts = options || {};
    var version = Number(data && data.version);
    if (!data || data.success === false) return { applied: false, changed: false, reason: 'no-config' };
    if (!(version > 0) || data.published === false) {
      return { applied: false, changed: false, reason: 'not-published' };
    }
    if (!opts.force && isAdminSession()) return { applied: false, changed: false, reason: 'admin-session' };

    var sections = sectionsFrom(data);
    var payloads = {
      pricing: stableJSON(sections.pricing),
      tier: stableJSON(sections.tier),
      shipping: stableJSON(sections.shipping)
    };
    var changed = false;
    Object.keys(KEYS).forEach(function (name) {
      if (localJSON(KEYS[name]) !== payloads[name]) changed = true;
    });

    if (!changed) {
      writeMeta(data);
      safeSet(root.localStorage, SHIPPING_MIGRATION_KEY, '1');
      return { applied: true, changed: false, reload: false, version: version };
    }

    var wrote = true;
    Object.keys(KEYS).forEach(function (name) {
      if (!safeSet(root.localStorage, KEYS[name], payloads[name])) wrote = false;
    });
    if (!wrote) return { applied: false, changed: false, reason: 'storage-error', version: version };

    safeSet(root.localStorage, SHIPPING_MIGRATION_KEY, '1');
    writeMeta(data);

    if (opts.reload === false) {
      return { applied: true, changed: true, reload: false, version: version };
    }

    var guardKey = 'hlg_cloud_reload_' + version;
    if (safeGet(root.sessionStorage, guardKey) === '1') {
      return { applied: true, changed: true, reload: false, version: version };
    }
    if (!safeSet(root.sessionStorage, guardKey, '1')) {
      return { applied: true, changed: true, reload: false, version: version };
    }
    return { applied: true, changed: true, reload: true, version: version };
  }

  function sync(options) {
    var opts = options || {};
    if (safeGet(root.localStorage, OPT_OUT_KEY) === '1') {
      return Promise.resolve({ applied: false, changed: false, reason: 'opt-out' });
    }
    if (typeof root.fetch !== 'function') {
      return Promise.resolve({ applied: false, changed: false, reason: 'no-fetch' });
    }
    return root.fetch('/api/pricing/config', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        var result = applyConfig(data, { force: forceRequested() || opts.force === true, reload: opts.reload !== false });
        if (result.reload && root.location && typeof root.location.reload === 'function') {
          root.location.reload();
        } else if (result.applied && result.changed) {
          refreshUI();
        }
        return result;
      })
      .catch(function (err) {
        try { console.warn('Pricing cloud sync failed:', err); } catch (e) {}
        return { applied: false, changed: false, reason: 'fetch-error' };
      });
  }

  root.hlgPricingCloud = {
    KEYS: KEYS,
    VERSION_KEY: VERSION_KEY,
    applyConfig: applyConfig,
    sync: sync
  };

  if (!root.__HLG_PRICING_CLOUD_NO_AUTO__) sync();
})(typeof window !== 'undefined' ? window : globalThis);
