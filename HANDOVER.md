# 🔄 Admin Unification Handover

**Goal:** The user requested to merge the storefront inline admin (`public/index.html`) with the true standalone admin portal (`/admin/`). We broke this down into 5 tickets in `.scratch/unify-admin/issues/`.

## ✅ What's Done
- Fixed the flickering issues with the highlight story editor and the login modal infinite loops.
- Generated the 5 tickets (`01` to `05`) for the unification process.
- **Ticket 01 (Unify Order Management)** is **DONE**:
  - Upgraded `/admin/index.html` and `public/admin/admin.js` to support `FAST TRACK`, 5-step status, and copied the "Copy Customer Info" functionality.
  - Removed `v8QueueDashboard` and the "จัดการคิว" (Orders) tab from `public/index.html`.
  - Replaced the tab with a `Full Admin Portal ↗` link in the storefront admin menu.

## 🚧 What's Currently In Progress (Ticket 02)
- Added `Products & Promos` tab and `viewProducts` placeholder in `public/admin/index.html`.
- Migrated the admin UI portion of `hlg-product-manager-js` (creating bags/stickers and uploading images to IndexedDB) into `public/admin/admin.js` (lines 750+).
- Hooked up `switchView('products')` to `hydrateProducts().then(renderProductsView)`.

## 🚀 What's Next
The user wants to continue with **Ticket 02 (Extract Product & Promo Management)**.

### Instructions for Next Agent:
1. **Finish Migrating Product Manager:** 
   - `hlg-product-manager-js` inside `public/index.html` still has the `render()` function that injects the admin form. You must strip out the admin-rendering logic (`render()`, `editRow()`, `deleteRow()`, `save()`, `visibility()`) from `public/index.html`'s script tag, because it is now handled by `/admin/admin.js`.
   - Ensure the storefront script ONLY retains `hydrate()`, `sync()`, `read()`, and `media()` so customers can still see the added products on the storefront.
2. **Migrate Tier Pricing Manager:**
   - Migrate `adminPanel-pricing` UI logic (from `hlg-tier-font-js`) into `public/admin/admin.js` similarly.
   - Remove the old `adminPanel-pricing` form from `public/index.html`.
3. Verify `/api/settings/storefront` is correctly saving configurations.
4. Run tests, commit, mark Ticket 02 as DONE, and proceed to Ticket 03!

---

## 🎟️ Ticket 03 (Extract Coupon Management)
**Goal:** Move the storefront's coupon generator and manager (`adminPanel-coupons`) into the `/admin/` portal.
**Details:**
Currently, `v8-coupon-admin` injects a heavy admin panel into `public/index.html` (around line 16088).
1. Create a "Coupons" tab in `/admin/index.html` (e.g., `<button class="topbar-tab" data-view="coupons" onclick="switchView('coupons')">...`).
2. Create `<div id="viewCoupons" class="admin-view hidden">` inside `/admin/index.html`.
3. Migrate the coupon generation and management logic from `v8-coupon-admin` to `public/admin/admin.js`.
4. The storefront still needs the API call to claim/validate coupons (`/api/coupons/validate`), so do NOT delete customer-facing logic! Only move the UI for generating and viewing coupons.
5. Delete the admin HTML/JS for coupons from `public/index.html`.
