/**
 * site-settings.js
 *
 * Shop settings that the admin edits in the browser but every customer must
 * see (stock, receipt design, fonts, page text, social links, section layout,
 * …). They used to live only in the admin's localStorage, so the changes never
 * reached customers. The admin page now pushes them here and every visitor
 * pulls them (see public/data/site-sync.js).
 *
 * Stored in one Firestore document, settings/site_kv, because the live rules
 * only allow writes to `orders` and `settings`. Values are the raw localStorage
 * strings; large images inside them are uploaded as media first by the client.
 *
 * Routes:
 *   GET /api/site-settings   public → { values: { key: string }, versions: { key: ms } }
 *   PUT /api/site-settings   admin  ← { values: { key: string | null } }
 */
'use strict';

const DOC_ID = 'site_kv';

// Every key a customer-facing page reads that only the admin writes.
const SYNC_KEYS = [
  'hlg_inventory_v1',
  'hlg_receipt_design_v1',
  'hlg_font_settings_v1',
  'hlg_payment_thanks_v1',
  'hlg_tracking_global_update_v1',
  'hlg_tracking_global_update_style_v1',
  'hlg_queue_status_names_v1',
  'hlg_queue_copy_v1',
  'hlg_social_links_v1',
  'hlg_social_names_v1',
  'hlg_site_settings_v1',
  'hlg_badges_v1',
  'hlg_section_visibility_v1',
  'hlg_box_layout_v1',
  'hlg_page_blocks_v3',
  'hlg_page_glass_boxes_v1',
  'hlg_visual_link_menu_v1',
  'hlg_v8_store_links',
  'hlg_v6_inline_text',
  'hlg_public_copy_v1',
  'hlg_v6_home_products',
  'hlg_collections_v1',
];
const ALLOWED = new Set(SYNC_KEYS);
const MAX_VALUE_CHARS = 200 * 1024;
const MAX_TOTAL_CHARS = 900 * 1024; // Firestore documents top out at 1 MiB

function totalSize(values) {
  return Object.keys(values).reduce((n, k) => n + k.length + String(values[k] || '').length, 0);
}

async function readDoc(store) {
  const doc = (await store.get('settings', DOC_ID)) || {};
  return {
    values: doc.values && typeof doc.values === 'object' ? doc.values : {},
    versions: doc.versions && typeof doc.versions === 'object' ? doc.versions : {},
  };
}

/**
 * @param ctx { isAdmin(req), readBody(req), sendJson(res, code, body), store: { get, set } }
 * @returns {Promise<boolean>} true when the request was handled
 */
async function handleSiteSettingsApi(req, res, pathname, method, ctx) {
  if (pathname !== '/api/site-settings') return false;
  const { store, sendJson } = ctx;

  if (method === 'GET') {
    const doc = await readDoc(store);
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, { values: doc.values, versions: doc.versions });
    return true;
  }

  if (method === 'PUT') {
    if (!ctx.isAdmin(req)) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }
    const body = await ctx.readBody(req);
    const incoming = body && typeof body.values === 'object' && body.values ? body.values : null;
    if (!incoming) { sendJson(res, 400, { error: 'ข้อมูลไม่ถูกต้อง' }); return true; }
    const doc = await readDoc(store);
    const now = Date.now();
    const changed = {};
    for (const key of Object.keys(incoming)) {
      if (!ALLOWED.has(key)) { sendJson(res, 400, { error: 'ไม่รองรับการตั้งค่า ' + key }); return true; }
      const value = incoming[key];
      if (value === null) { delete doc.values[key]; }
      else {
        if (typeof value !== 'string') { sendJson(res, 400, { error: 'ข้อมูลไม่ถูกต้อง: ' + key }); return true; }
        if (value.length > MAX_VALUE_CHARS) { sendJson(res, 413, { error: 'ข้อมูลใหญ่เกินไป (' + key + ') กรุณาใช้รูปขนาดเล็กลงค่ะ' }); return true; }
        doc.values[key] = value;
      }
      doc.versions[key] = now;
      changed[key] = now;
    }
    if (totalSize(doc.values) > MAX_TOTAL_CHARS) {
      sendJson(res, 413, { error: 'พื้นที่เก็บการตั้งค่าร้านเต็ม กรุณาลดรูปหรือข้อความที่ใหญ่มากค่ะ' });
      return true;
    }
    await store.set('settings', DOC_ID, { values: doc.values, versions: doc.versions, updated_at: new Date(now).toISOString() });
    sendJson(res, 200, { success: true, versions: changed });
    return true;
  }

  return false;
}

// Stock key used by the storefront guard and the admin stock editor.
function stockKey(item) {
  return JSON.stringify([String(item.type || 'bag'), String(item.name || ''), String(item.variant || '')]);
}

/**
 * Units of each managed stock line taken by live orders (paid and still-unpaid bills
 * reserve stock; expired bills are already purged). Orders listed in a line's
 * baseline existed before the stock was set and do not count.
 */
function stockUsed(inventoryJson, orders) {
  let inventory = {};
  try { inventory = JSON.parse(inventoryJson || '{}') || {}; } catch (e) { inventory = {}; }
  const used = {};
  Object.keys(inventory).forEach(key => {
    const row = inventory[key];
    if (!row || !row.managed) return;
    const baseline = new Set((row.baseline || []).map(String));
    used[key] = (orders || []).reduce((n, o) => {
      if (!o || baseline.has(String(o.id))) return n;
      return n + (Array.isArray(o.items) ? o.items : []).reduce((a, x) => a + (x && stockKey(x) === key ? Math.max(0, Number(x.qty) || 0) : 0), 0);
    }, 0);
  });
  return used;
}

module.exports = { handleSiteSettingsApi, stockUsed, stockKey, SYNC_KEYS, DOC_ID };
