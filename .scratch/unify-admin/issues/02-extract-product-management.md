# 02: Extract Product & Promo Management

**What to build:** Moves the storefront's `adminPanel-products` and `adminPanel-tiers` (Product listing, Add Bag/Sticker, Tiered pricing, Free shipping rules) into a dedicated tab in the `/admin/` portal, keeping the business logic out of the customer-facing HTML.

**Blocked by:** None (can start immediately).

**Status:** DONE

## What shipped
- [x] Create a "Products & Promos" tab in `/admin/index.html` (products, tier promo, single-item pricing, font — four sections)
- [x] Migrate `hlg-product-manager` logic to `/admin/` (was already moved; bugs fixed below)
- [x] Migrate `hlg-tier-font-js` logic to `/admin/` (`hlgRenderTiers` + `hlgRenderFonts`)
- [x] Migrate `hlg-pricing-js` editor to `/admin/` (`hlgRenderPricing`) — the handover's `adminPanel-pricing`
- [x] Verify API endpoints for settings are called correctly
- [x] Remove these admin panels from `public/index.html`

## Bugs found & fixed along the way
1. **IndexedDB mismatch (data loss for images).** `admin.js` opened `hlg_custom_font_v1`/`media` (the *font* DB) instead of the storefront's `hlg_product_media_v1`/`images`, so images uploaded in `/admin/` were invisible on the storefront. Now matches.
2. **Destructive settings write.** Product save/delete called `PUT /api/settings/storefront` with `{ products }`. That endpoint whitelists `{banners, notices, stories}` and rebuilds the doc, so it **wiped banners/notices/stories** and discarded `products`. Those calls are removed. → *Check the live Firestore `settings/storefront` doc for already-lost banners/notices.*
3. **`admin.js` did not parse.** `copyCustomerInfo` had a literal newline inside a `join("…")` string (pre-existing from ticket 01). Fixed.
4. **Broken anchors.** Shipping and coupon admin scripts anchored on `#adminPanel-pricing` / `#adminPanel-tiers`; both now anchor on `#adminPanel-store` so their tabs still appear.

## Source of truth (decided with user)
Products/promos/fonts stay **local-only** (same-origin `localStorage` + IndexedDB). Cloud sync is a separate future ticket — uploading IndexedDB blobs across devices is out of scope here.

## Deferred to ticket 05 (Deep Clean)
The storefront still contains the now-unreachable editor bodies (`renderTiers`, `saveTier`, `renderFonts`, and the pricing `renderAdmin`/`options`/`preview`/`savePromo`/`renderBase`) plus their now-dead CSS. Their panels and all callers/triggers are gone, so they never run. Ticket 05 should delete them.

## Tests
`test/admin-product-promo-migration.test.js` locks the shared-key contract, the removed destructive write, the removed storefront panels, the retained customer engines, and the admin entry points. Added to `npm test`.
