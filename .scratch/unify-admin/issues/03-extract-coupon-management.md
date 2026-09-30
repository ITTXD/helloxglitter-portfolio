# 03: Extract Coupon Management

**What to build:** Moves the storefront's coupon generator and manager (`adminPanel-coupons`) into the `/admin/` portal.

**Blocked by:** None (can start immediately).

**Status:** DONE (with one checkbox reworded — see notes)

## What shipped
- [x] Create a "Coupons" tab in `/admin/index.html` (`data-view="coupons"`, `#viewCoupons`, `#couponManagerContainer`)
- [x] Migrate the coupon campaign rules editor to `/admin/` (`window.hlgRenderCoupons` in `public/admin/admin.js`)
- [~] Verify coupon generation and copying works in the new portal — **reworded:** the storefront coupon admin only ever *edited campaign rules*. Coupon *generation* is server-side (`issueCouponForStickerOrder`) and *copying* is the customer wallet's "คัดลอกโค้ด" button. The `/admin/` tab edits rules only; there was nothing else to move.
- [x] Remove coupon admin HTML/JS from `public/index.html` (panel + tab + `switchAdminTab` hook + boot wiring)

## Details
- The editor now saves with the admin **session cookie** (`credentials: 'include'`) — the old client sent `admin_password` from `sessionStorage`, which the `/admin/` portal does not use.
- Storefront keeps everything customer-facing: wallet (`openCoupons`), LINE login (`openAccount`/`logoutLine`/`initLineLiff`), `applyCouponToCart`, `getAppliedCoupon`, `clearAppliedCoupon`, `validateCouponCode`, `handleApplyCouponFromInput` and the cart coupon box.
- Shared key `hlg_coupon_campaign_draft_v1` used on both sides.

## Deferred to ticket 05 (Deep Clean)
- `__removedCouponAdmin` (inert dead body, `return;` at the top) and the dead CSS block `#adminPanel-coupons{…}` / `.hlg-coupon-admin`/`-grid`/`-preview`/`-status` in `public/index.html`.

## Tests
`test/admin-coupon-migration.test.js` locks: admin tab/view/entry-point, cookie (not password) auth, the campaign POST, removal of the storefront panel + tab hook, and retention of every customer coupon path + styles. Added to `npm test`.
