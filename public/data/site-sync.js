// ============================================================================
// Shop settings sync (storefront + /admin/)
// ============================================================================
// Many admin editors save to localStorage only, so their changes never reached
// customers. This script:
//   - pushes those keys to /api/site-settings whenever an admin saves them
//     (it wraps localStorage.setItem, so every existing editor is covered),
//   - pulls newer values for every visitor and reloads the page once so all
//     scripts start from the shop's real settings,
//   - uploads big embedded images to /api/story-media first, and exposes
//     window.hlgUploadMedia(blob) for editors that keep files elsewhere.
// Keep SYNC_KEYS in step with /site-settings.js.
// ============================================================================
(function () {
  'use strict';

  var SYNC_KEYS = [
    'hlg_inventory_v1', 'hlg_receipt_design_v1', 'hlg_font_settings_v1', 'hlg_payment_thanks_v1',
    'hlg_tracking_global_update_v1', 'hlg_tracking_global_update_style_v1', 'hlg_queue_status_names_v1',
    'hlg_queue_copy_v1', 'hlg_social_links_v1', 'hlg_social_names_v1', 'hlg_site_settings_v1',
    'hlg_badges_v1', 'hlg_section_visibility_v1', 'hlg_box_layout_v1', 'hlg_page_blocks_v3',
    'hlg_page_glass_boxes_v1', 'hlg_visual_link_menu_v1', 'hlg_v8_store_links', 'hlg_v6_inline_text',
    'hlg_public_copy_v1', 'hlg_v6_home_products', 'hlg_collections_v1'
  ];
  var SYNC = {};
  SYNC_KEYS.forEach(function (k) { SYNC[k] = true; });
  var VERSIONS_KEY = 'hlg_site_sync_versions_v1';
  var RELOADED_KEY = 'hlg_site_sync_reloaded_v1';
  var CHUNK = 600 * 1024;
  var BIG_IMAGE = 40 * 1024; // embedded images bigger than this are uploaded

  var ls;
  try { ls = window.localStorage; } catch (e) { return; }
  var origSet = Storage.prototype.setItem;
  var origRemove = Storage.prototype.removeItem;
  var applying = false;

  function adminContext() {
    if (location.pathname.indexOf('/admin') === 0) return true;
    try { return sessionStorage.getItem('hlg_admin_session_v2') === '1'; } catch (e) { return false; }
  }
  function readVersions() {
    try { return JSON.parse(ls.getItem(VERSIONS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeVersions(v) { try { origSet.call(ls, VERSIONS_KEY, JSON.stringify(v)); } catch (e) {} }
  function toast(msg) { try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (e) {} }

  // ---------- media upload (same chunked API as Story Highlights) ----------
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function guessMime(blob) {
    if (blob.type) return blob.type;
    var name = (blob.name || '').toLowerCase();
    if (/\.woff2$/.test(name)) return 'font/woff2';
    if (/\.woff$/.test(name)) return 'font/woff';
    if (/\.otf$/.test(name)) return 'font/otf';
    if (/\.ttf$/.test(name)) return 'font/ttf';
    return 'application/octet-stream';
  }
  // Uploads a file and returns its absolute URL (https on the live site).
  async function uploadMedia(blob) {
    var mime = guessMime(blob);
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var count = Math.max(1, Math.ceil(bytes.length / CHUNK));
    if (count > 60) throw new Error('ไฟล์ใหญ่เกินไป (ไม่เกิน 35 MB)');
    var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    for (var i = 0; i < count; i++) {
      var r = await fetch('/api/story-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ media_id: id, index: i, count: count, mime: mime, data: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) })
      });
      if (!r.ok) {
        var j = await r.json().catch(function () { return {}; });
        throw new Error(j.error || ('อัปโหลดไฟล์ไม่สำเร็จ (' + r.status + ')'));
      }
    }
    return location.origin + '/api/story-media/' + id;
  }
  window.hlgUploadMedia = uploadMedia;

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/data:(.*?);/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  // Replace large data:image URLs inside a stored value with uploaded media URLs.
  async function offloadImages(value) {
    if (!value || value.indexOf('data:image/') < 0) return value;
    var re = /data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/g;
    var found = value.match(re) || [];
    var out = value;
    for (var i = 0; i < found.length; i++) {
      if (found[i].length < BIG_IMAGE) continue;
      var url = await uploadMedia(dataUrlToBlob(found[i]));
      out = out.split(found[i]).join(url);
    }
    return out;
  }

  // ---------- push (admin) ----------
  var pending = {};
  var timer = null;
  function queue(key) {
    pending[key] = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }
  async function flush() {
    var keys = Object.keys(pending);
    pending = {};
    if (!keys.length) return;
    try {
      var values = {};
      for (var i = 0; i < keys.length; i++) {
        var raw = ls.getItem(keys[i]);
        values[keys[i]] = raw === null ? null : await offloadImages(raw);
      }
      var r = await fetch('/api/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ values: values })
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      var v = readVersions();
      Object.keys(data.versions || {}).forEach(function (k) { v[k] = data.versions[k]; });
      writeVersions(v);
    } catch (err) {
      console.warn('[site-sync] save failed', err);
      toast('บันทึกขึ้นระบบไม่สำเร็จ: ' + err.message);
      keys.forEach(function (k) { pending[k] = true; });
      clearTimeout(timer);
      timer = setTimeout(flush, 15000);
    }
  }
  Storage.prototype.setItem = function (key, value) {
    origSet.call(this, key, value);
    if (this === ls && SYNC[key] && !applying && adminContext()) queue(key);
  };
  Storage.prototype.removeItem = function (key) {
    origRemove.call(this, key);
    if (this === ls && SYNC[key] && !applying && adminContext()) queue(key);
  };

  // ---------- pull (everyone) ----------
  async function pull() {
    var data;
    try {
      var r = await fetch('/api/site-settings', { cache: 'no-store' });
      if (!r.ok) return;
      data = await r.json();
    } catch (e) { return; }
    var values = data.values || {};
    var serverVersions = data.versions || {};
    var local = readVersions();
    var changed = [];
    applying = true;
    try {
      Object.keys(serverVersions).forEach(function (k) {
        if (!SYNC[k] || (Number(local[k]) || 0) >= Number(serverVersions[k])) return;
        var value = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
        if (value === null) { if (ls.getItem(k) !== null) { origRemove.call(ls, k); changed.push(k); } }
        else if (ls.getItem(k) !== value) { origSet.call(ls, k, value); changed.push(k); }
        local[k] = serverVersions[k];
      });
    } finally { applying = false; }
    writeVersions(local);

    // An admin's existing browser-only settings go up once, the first time.
    if (adminContext()) {
      SYNC_KEYS.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(serverVersions, k) && ls.getItem(k) !== null) queue(k);
      });
    }

    if (!changed.length) return;
    try { window.dispatchEvent(new CustomEvent('hlg:site-settings', { detail: { keys: changed } })); } catch (e) {}
    // Scripts already read the old values; reload once so the page shows the shop's settings.
    var sig = changed.sort().join(',') + '@' + changed.map(function (k) { return serverVersions[k]; }).join(',');
    var already;
    try { already = sessionStorage.getItem(RELOADED_KEY); } catch (e) {}
    if (already === sig) return;
    try { sessionStorage.setItem(RELOADED_KEY, sig); } catch (e) {}
    location.reload();
  }
  pull();
})();
