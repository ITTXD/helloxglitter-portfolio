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

## 🚀 What's Next
Continue with **Ticket 03 (Extract Coupon Management)**. See `.scratch/unify-admin/issues/03-extract-coupon-management.md`.
`v8-coupon-admin` injects the coupon panel around line ~16190 and already anchors on `#adminPanel-store`; migrate its generator/manager UI to a "Coupons" tab in `/admin/`, keeping customer claim/validate logic on the storefront.

### Cleanup owed to Ticket 05 (not blocking)
The storefront still contains unreachable editor bodies (`renderTiers`, `saveTier`, `renderFonts`, pricing `renderAdmin`/`options`/`preview`/`savePromo`/`renderBase`) and their dead CSS. Their panels and all callers are gone, so they never run — Ticket 05 deletes them.

## 🧪 Verification
- `npm test` (all suites green) including the new `test/admin-product-promo-migration.test.js`.
- All 81 inline scripts in `public/index.html` parse; `node --check public/admin/admin.js` passes.
- Not verified in a real browser (no Chrome available in this environment) — do a manual pass on `/admin/` Products & Promos and the storefront gallery/cart before deploy.
