# 04: Isolate Storefront CMS Mode

**What to build:** The storefront will retain ONLY the "Visual CMS" tools (editing text on the page, hiding/showing sections, editing Highlight Stories, editing Banners). These scripts will be lazy-loaded or strictly separated so they don't impact customer load times, and the "Admin Mode" on the storefront becomes purely a "Page Builder/CMS Mode".

**Blocked by:** 01-unify-order-management, 02-extract-product-management, 03-extract-coupon-management

**Status:** PARTIAL — the class is leak-proof, the admin-only CMS editors are lazy-loaded, and Stock + Receipt are moved into `/admin/`; the shared render/edit scripts and the remaining non-CMS panels are still open.

- [x] Clean up `admin-mode` CSS class logic so it only triggers Visual CMS tools
- [x] Lazy-load the admin-only Visual CMS editor scripts
- [~] Ensure Highlight Story editor opens smoothly
- [~] Ensure text editor and visibility toggler work
- [~] Admin Mode is purely a Page Builder / CMS Mode (non-CMS panels moved out)

## What shipped

### 1. One leak-proof `admin-mode` writer
- `body.admin-mode` now has **one canonical writer**: `window.hlgAdminModeSync()`.
  - Reads the real admin session (`sessionStorage['hlg_admin_session_v2']`) and treats the
    customer-preview views (`v8-third-person-view`, `v8-customer-preview-mode`) as non-admin.
  - The old `v8-link-back-patch` heuristic (`if(adminVisible) … classList.add('admin-mode')`) is
    **gone** — it matched on "ออกจากระบบ" button text and could leave `admin-mode` stuck on for customers.
  - `v8-final-controls.syncAdminClass()` delegates to the same helper.

### 2. Lazy-load for the admin-only CMS editors
- Editor scripts ship as inert blocks: `<script id="…" type="text/x-hlg-admin-script">`. The browser
  never parses or runs them for customers.
- `window.hlgLoadAdminScripts()` (script `hlg-admin-lazy-loader-js`) re-injects each block as a real
  `<script>` **only** for a real admin session, guarded by `dataset.hlgLoaded` so it runs once.
  It fires on `DOMContentLoaded`, on `pageshow`, and from `hlgAdminModeSync()` so a login **without a
  page reload** still loads them.
- Deferred today: `hlg-inline-copy-editor-js` (text editor), `hlg-section-visibility-js`
  (visibility toggler). Both are self-contained IIFEs that only read their own localStorage key, so
  deferring them cannot change customer output.

### 3. Stock + Receipt swept into `/admin/`
- `/admin/` gained two tabs: **สต็อก** (`data-view="stock"` → `#viewStock` → `window.hlgRenderStock`)
  and **ใบสรุป / ขอบคุณ** (`data-view="receipt"` → `#viewReceipt` → `window.hlgRenderReceipt`).
- Storefront side removed: the stock panel/tab/boot wiring + its dead `#adminPanel-stock` CSS, and the
  receipt design editor (`renderAdmin`/`admin()`/`switchAdminTab` hook). The `ensureAdmin()` anchor for
  payment-thanks no longer points at the deleted `#adminPanel-receipt`.
- Customer side kept intact: `window.hlgStockRemaining` + the checkout stock guard, and the whole
  receipt/slip/confirm/download flow (`settings`, `gifSource`, `receiptMarkup`, `renderDone`, `hrx*`).

## Still open (honest gaps)
1. **Only 2 CMS scripts are deferred.** The Highlight Story, banner and preview-card editors cannot be
   deferred yet: the same scripts also render customer content (`v8-story-clean-manager`,
   `v8-banner-inline-story-clean-js`, `v8-inline-preview-editor-js`, `v8-story-final-manager`). Deferring
   them would blank the storefront. Splitting render from edit is Ticket 05 work.
2. **Non-CMS admin panels still live on the storefront and still show in `admin-mode`:** shipping
   (`hlg-shipping-js`), collections (`hlg-collections-js`), box controls (`hlg-box-controls-js`),
   store tools / badges / payment (`hlg-store-tools-js`), payment-thanks (`hlg-payment-thanks-js`),
   queue copy (`hlg-queue-copy-js`). Stock and receipt are the two that moved.
3. **No browser verification.** "Opens smoothly" / "works" are asserted structurally only. The three
   overlapping story-manager scripts (`v8-story-final-manager`, `v8-story-clean-manager`,
   `v8-story-delete-all-fix`) remove one another's modals — a likely cause of jank that was left untouched.

## Tests
- `test/admin-cms-mode.test.js` asserts: exactly one canonical helper, no DOM-heuristic writer, both
  `syncAdminClass()` implementations delegate, and that the visibility / story / banner CMS gates plus
  the text-editor markers survive.
- `test/admin-cms-lazy-load.test.js` asserts: the loader + injection API exist, the loader reads the real
  admin session and excludes customer preview, `hlgAdminModeSync` triggers the loader, the two CMS scripts
  are inert, the four shared render scripts are **not** deferred, and every deferred block still parses.
- `test/admin-stock-receipt-migration.test.js` asserts the Stock/Receipt move, that the customer guards
  stay, and that the stock key encoding + order source match the storefront exactly.

All three are in `npm test`.
