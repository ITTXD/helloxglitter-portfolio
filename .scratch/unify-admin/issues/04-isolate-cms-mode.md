# 04: Isolate Storefront CMS Mode

**What to build:** The storefront will retain ONLY the "Visual CMS" tools (editing text on the page, hiding/showing sections, editing Highlight Stories, editing Banners). These scripts will be lazy-loaded or strictly separated so they don't impact customer load times, and the "Admin Mode" on the storefront becomes purely a "Page Builder/CMS Mode".

**Blocked by:** 01-unify-order-management, 02-extract-product-management, 03-extract-coupon-management

**Status:** PARTIAL — the class is now leak-proof; lazy-loading and the remaining non-CMS panels are still open.

- [x] Clean up `admin-mode` CSS class logic so it only triggers Visual CMS tools
- [~] Ensure Highlight Story editor opens smoothly
- [~] Ensure text editor and visibility toggler work

## What shipped
- `body.admin-mode` now has **one canonical, leak-proof writer**: `window.hlgAdminModeSync()`.
  - It reads the real admin session (`sessionStorage['hlg_admin_session_v2']`) and treats the
    customer-preview views (`v8-third-person-view`, `v8-customer-preview-mode`) as non-admin.
  - The old `v8-link-back-patch` heuristic (`if(adminVisible) … classList.add('admin-mode')`) is
    **gone** — it matched on "ออกจากระบบ" button text and could leave `admin-mode` stuck on for customers.
  - `v8-final-controls.syncAdminClass()` delegates to the same helper, so the class has one source of truth.

## Still open (honest gaps)
1. **Lazy-loading was NOT implemented.** The CMS scripts are *strictly separated* (discrete `hlg-*` blocks, fully admin-gated, so they render nothing for customers) but they still parse and execute on every page load.
2. **The premise isn't fully true yet.** Non-CMS admin panels still live on the storefront and still show in `admin-mode`: shipping (`hlg-shipping-js`), collections (`hlg-collections-js`), stock (`hlg-stock-admin-js`), box controls (`hlg-box-controls-js`), receipt (`hlg-receipt-experience-js`), store tools / badges / payment (`hlg-store-tools-js`), payment-thanks (`hlg-payment-thanks-js`). Tickets 01–03 did not move them.
3. **No browser verification.** "Opens smoothly" / "works" are asserted structurally only. The three overlapping story-manager scripts (`v8-story-final-manager`, `v8-story-clean-manager`, `v8-story-delete-all-fix`) remove one another's modals — a likely cause of jank that was left untouched.

## Tests
`test/admin-cms-mode.test.js` asserts: exactly one canonical helper, no DOM-heuristic writer, both `syncAdminClass()` implementations delegate, and that the visibility / story / banner CMS gates plus the text-editor markers survive. Added to `npm test`.
