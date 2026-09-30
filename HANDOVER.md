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

Products/promos stay **local-only** for now (decided with user). Cloud sync is a separate future ticket.

- **Ticket 03 (Extract Coupon Management)** — DONE.
  - `/admin/` gained a **คูปอง** tab (`data-view="coupons"` → `#viewCoupons` → `window.hlgRenderCoupons`).
  - Saves with the admin **session cookie** (the old client used `sessionStorage` `admin_password`, which `/admin/` doesn't have).
  - Storefront keeps the whole customer path: wallet, LINE login, apply/validate/claim and the cart coupon box.
  - ⚠️ Ticket wording fixed: the storefront never *generated* or *copied* coupons from its admin panel — generation is server-side and copying is a customer-wallet button. The portal edits **rules only**.

- **Ticket 04 (Isolate Storefront CMS Mode)** — PARTIAL.
  - `body.admin-mode` now has **one canonical, leak-proof writer**: `window.hlgAdminModeSync()` (real admin session + preview exclusion). The old `v8-link-back-patch` DOM-text heuristic that could leave `admin-mode` stuck on for customers is gone; `v8-final-controls.syncAdminClass()` delegates to the same helper.
  - **Still open:** (1) true lazy-loading of the CMS scripts was not implemented — they are strictly separated and fully admin-gated but still load for every customer; (2) non-CMS admin panels (shipping, collections, stock, box controls, receipt, store tools, payment-thanks) still show in `admin-mode`; (3) no browser verification — the three overlapping story-manager scripts were left untouched.

## 🚀 What's Next
**Ticket 05 (Deep Clean index.html)** — the only ticket left. See `.scratch/unify-admin/issues/05-deep-clean-index.md`. It also owns the orphaned editor bodies and dead CSS listed below, plus the deferred items from ticket 04.

### Cleanup owed to Ticket 05 (not blocking)
The storefront still contains unreachable editor bodies and their dead CSS:
- `renderTiers`, `saveTier`, `renderFonts`, pricing `renderAdmin`/`options`/`preview`/`savePromo`/`renderBase` (ticket 02)
- `__removedCouponAdmin` (ticket 03, inert via `return;`) plus `#adminPanel-coupons` / `.hlg-coupon-admin` CSS
- Ticket 04 leftovers: lazy-load the CMS scripts, and remove/relocate the remaining non-CMS admin panels (shipping, collections, stock, box controls, receipt, store tools, payment-thanks).
Their panels, triggers and callers are gone, so none of them run — Ticket 05 deletes them.

## 🧪 Verification
- `npm test` (all suites green) including `test/admin-product-promo-migration.test.js`, `test/admin-coupon-migration.test.js` and `test/admin-cms-mode.test.js`.
- All 81 inline scripts in `public/index.html` parse; `node --check public/admin/admin.js` passes.
- Not verified in a real browser (no Chrome available in this environment) — do a manual pass on `/admin/` Products & Promos and the storefront gallery/cart before deploy.
