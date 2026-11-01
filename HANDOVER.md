# 🔄 Admin Unification Handover

**Goal:** Merge the storefront inline admin (`public/index.html`) with the standalone admin portal (`/admin/`). Broken down into 5 tickets in `.scratch/unify-admin/issues/`.

## ✅ What's Done
- Fixed flickering in the highlight story editor and login-modal infinite loops.
- **Ticket 01 (Unify Order Management)** — DONE.
- **Ticket 02 (Extract Product & Promo Management)** — DONE.
  - `/admin/` now owns four editors under the **Products & Promos** tab:
    - Products (bags / stickers) — `#productManagerContainer`
    - Tier promo / free shipping — `#tierManagerContainer` (`window.hlgRenderTiers`)
    - Single-item pricing — `#pricingManagerContainer` (`window.hlgRenderPricing`)
    - Site font — `#fontManagerContainer` (`window.hlgRenderFonts`)
  - Editors live in `public/admin/admin.js` (one IIFE at the end); styles added to `public/admin/index.html`.
  - Storefront keeps only the customer-facing engines: product `read/hydrate/sync/media/decorateSticker`, and the `hlgTierQuote` / `hlgPriceFor` / `getPromoNote` / `renderPromoWrap` hooks.
  - Panels and all `switchAdminTab` triggers for the migrated editors are removed from the storefront.

### 🐞 Bugs found & fixed during Ticket 02
1. Product images used the **wrong IndexedDB** in `admin.js` (`hlg_custom_font_v1`/`media`) → now `hlg_product_media_v1`/`images`, matching the storefront.
2. Product save/delete **wiped storefront banners/notices/stories**: it PUT `{products}` to `/api/settings/storefront`, which whitelists only `{banners,notices,stories}`. Calls removed. ⚠️ **Check the live Firestore `settings/storefront` doc — banners/notices may already be lost.**
3. `public/admin/admin.js` had a **syntax error** (literal newline in `join("…")`) and did not parse — fixed.
4. Shipping + coupon admin tabs anchored on the removed pricing/tier panels; re-anchored to `#adminPanel-store`.

### 🔑 Storage contract (both sides same origin — keep in sync)
| Data | Key |
|---|---|
| Products | `hlg_custom_products_v1` (IndexedDB `hlg_product_media_v1` / `images`) |
| Tier promo | `hlg_quantity_promo_v1` |
| Single-item pricing | `hlg_pricing_v1` |
| Font | `hlg_font_settings_v1` (IndexedDB `hlg_custom_font_v1` / `font`) |
| Stock | `hlg_inventory_v1` — key is the same JSON array the storefront guard uses: `JSON.stringify([type||'bag', name, variant])` |
| Orders (stock math) | IndexedDB `HLG_ORDERS_DB_V1` / `state` / `'orders'`, fallback localStorage `hlg_orders_v2` |
| Receipt design | `hlg_receipt_design_v1` (GIF blob in IndexedDB `HLG_RECEIPT_ASSETS_V1` / `assets` / `'thankyou'`) |
| Published pricing config | Firestore `settings/pricing` + `pricing_config_history/{version}` |
| Local cloud-config meta | `hlg_pricing_cloud_version_v1`, `hlg_pricing_cloud_updated_at_v1` |
| Disable hydration on a device | `hlg_pricing_cloud_optout_v1=1` |
| Quotes (P2) | Firestore `quotes/{quote_id}` (token/owner/address hashes + `expires_at_ts`); local API uses memory |
| Quote shadow log | `hlg_quote_shadow_log_v1` (last 50, no coupon code/token) |
| Quote rollout flag | `settings/pricing.features.quote_preview` |
| Manual quote group override | `?hlg_group=...` or `hlg_pricing_group_v1` |

> **P1 pricing update (2026-10-25):** pricing, tier promo and shipping now have a published
> Cloud source of truth. The editors in `/admin/` still save the local keys above first; press
> **“เผยแพร่ขึ้น Cloud”** in the *ราคากลางบน Cloud* card to make them live. The storefront loads
> `/data/pricing-cloud.js`, hydrates the three local keys from `GET /api/pricing/config`, then
> reloads once. Admin sessions skip hydration (use `?hlg_cloud=1` to force a preview).
>
> Dynamic products added through `/api/products` are Cloud-backed and included in the server
> catalog. Products that exist only in `hlg_collections_v1` remain local-only and are **not** in
> the server catalog yet. Checkout/order totals are still client-supplied until P3.

> **P2 quote update (2026-10-26):** `POST /api/quotes` now returns a server quote computed by
> the same `HLGPricing` engine as the browser. The storefront loads
> `/data/pricing-quote.js` after cloud hydration and (when enabled) fetches
> `/api/pricing/catalog`, asks for a quote, and compares the two. Default rollout is
> `{ enabled:true, mode:'shadow', groups:['all'] }`; shadow mode only logs to
> `hlg_quote_shadow_log_v1`. Set `mode:'active'` in the admin *ราคากลางบน Cloud* card to show the
> **“ราคายืนยันจากระบบ”** panel for the selected groups.
>
> - Quote TTL is **30 minutes**, enforced by `quote-service.js` (`410` when expired). The browser
>   automatically requests a fresh quote; expired quotes never block a new `POST /api/quotes`.
> - The quote token itself is never stored — only its SHA-256 hash. The document also stores hashes of the address and LINE user (never the raw address or LINE ID). There is no public quote-read route yet.
> - Limits: 50 items, qty 1–999/line, 999 units total, address 2,000 chars. Rate limit is
>   **30/minute per process per hashed IP** (not distributed across serverless instances).
> - Production writes `quotes/{quote_id}` with `expires_at_ts`. To clean up old docs, create a
>   Firestore TTL policy on collection **quotes**, field **expires_at_ts** (Firebase Console →
>   Firestore → TTL, or `gcloud firestore fields ttls update expires_at_ts --collection-group=quotes --enable-ttl`).
>   Until then, app-level expiry still rejects old quotes but documents remain.
> - The feature flag controls **storefront** shadow/active behavior only; `/api/quotes` remains
>   callable. Force on/off per device with `?hlg_quote=1` / `?hlg_quote=0`; add
>   `?hlg_quote_debug=1` to show comparison details in shadow mode.
>
> **P2 is preview-only.** `/api/orders`, `/api/orders/confirm`, slip verification, and
> sticker/wallpaper orders still trust client totals until P3. `line_id_token` is not verified;
> body `line_user_id` is an unauthenticated fallback. Rate limiting and quote cleanup are not
> distributed/automatic. Do a real-browser pass and check the shadow log before enabling
> `mode:'active'` for customers.

- **Ticket 03 (Extract Coupon Management)** — DONE.
  - `/admin/` gained a **คูปอง** tab (`data-view="coupons"` → `#viewCoupons` → `window.hlgRenderCoupons`).
  - Saves with the admin **session cookie** (the old client used `sessionStorage` `admin_password`, which `/admin/` doesn't have).
  - Storefront keeps the whole customer path: wallet, LINE login, apply/validate/claim and the cart coupon box.
  - ⚠️ Ticket wording fixed: the storefront never *generated* or *copied* coupons from its admin panel — generation is server-side and copying is a customer-wallet button. The portal edits **rules only**.

- **Ticket 04 (Isolate Storefront CMS Mode)** — PARTIAL.
  - `body.admin-mode` now has **one canonical, leak-proof writer**: `window.hlgAdminModeSync()` (real admin session + preview exclusion). The old `v8-link-back-patch` DOM-text heuristic that could leave `admin-mode` stuck on for customers is gone; `v8-final-controls.syncAdminClass()` delegates to the same helper.
  - **Lazy-load shipped:** the Visual CMS editor scripts are inert (`type="text/x-hlg-admin-script"`) and injected by `window.hlgLoadAdminScripts()` only for a real admin session (on load, on `pageshow`, and from `hlgAdminModeSync` so login-without-reload works). Deferred today: `hlg-inline-copy-editor-js`, `hlg-section-visibility-js`. Not deferrable yet: the story/banner/preview scripts, because the *same* files also render customer content — splitting render from edit is Ticket 05 work.
  - **Stock + Receipt swept into `/admin/`:** new **สต็อก** (`#viewStock`, `window.hlgRenderStock`) and **ใบสรุป / ขอบคุณ** (`#viewReceipt`, `window.hlgRenderReceipt`) tabs; their storefront panels, tabs, wires and dead `#adminPanel-stock` CSS are gone. Customer guards stay: `window.hlgStockRemaining` + the checkout stock guard, and the whole receipt/slip/confirm flow.
  - **Still open:** (1) non-CMS admin panels (shipping, collections, box controls, store tools, payment-thanks) still show in `admin-mode`; (2) the story/banner/preview editors cannot be deferred until render and edit are split; (3) no browser verification — the three overlapping story-manager scripts were left untouched.

## 🚀 What's Next
**Ticket 05 (Deep Clean index.html)** — the only ticket left. See `.scratch/unify-admin/issues/05-deep-clean-index.md`. It also owns the orphaned editor bodies and dead CSS listed below, plus the deferred items from ticket 04.

### Cleanup owed to Ticket 05 (not blocking)
The storefront still contains unreachable editor bodies and their dead CSS:
- `renderTiers`, `saveTier`, `renderFonts`, pricing `renderAdmin`/`options`/`preview`/`savePromo`/`renderBase` (ticket 02)
- `__removedCouponAdmin` (ticket 03, inert via `return;`) plus `#adminPanel-coupons` / `.hlg-coupon-admin` CSS
- Ticket 04 leftovers: split render from edit for the story/banner/preview scripts so they can be deferred, and remove/relocate the remaining non-CMS admin panels (shipping, collections, box controls, store tools, payment-thanks).
Their panels, triggers and callers are gone, so none of them run — Ticket 05 deletes them.

## 🧪 Verification
- `npm test` (all suites green) including `test/admin-product-promo-migration.test.js`, `test/admin-coupon-migration.test.js`, `test/admin-cms-mode.test.js`, `test/admin-stock-receipt-migration.test.js`, `test/admin-cms-lazy-load.test.js`, `test/pricing-engine.test.js`, `test/pricing-cloud.test.js` and `test/pricing-quote.test.js` (34/34).
- All inline scripts in `public/index.html` parse (81 executable + 2 inert admin blocks); the three
  deferred pricing scripts also pass `node --check`; `node --check public/admin/admin.js` passes.
- P2 syntax checks: `node --check quote-service.js`, `pricing-config.js`, `server.js`, `api/[...path].js`, `public/data/pricing-quote.js`, `public/data/pricing-engine.js`.
- Not verified in a real browser (no Chrome available in this environment) — do a manual pass on `/admin/` Products & Promos, the storefront gallery/cart (shadow then active), and expiry/error states before enabling customers.
- Firestore TTL policy on `quotes.expires_at_ts` is **not configured** in this repo/environment; see the P2 note above.
