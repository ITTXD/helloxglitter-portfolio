# 04: Isolate Storefront CMS Mode

**What to build:** The storefront will retain ONLY the "Visual CMS" tools (editing text on the page, hiding/showing sections, editing Highlight Stories, editing Banners). These scripts will be lazy-loaded or strictly separated so they don't impact customer load times, and the "Admin Mode" on the storefront becomes purely a "Page Builder/CMS Mode".

**Blocked by:** 01-unify-order-management, 02-extract-product-management, 03-extract-coupon-management

**Status:** ready-for-agent

- [ ] Clean up `admin-mode` CSS class logic so it only triggers Visual CMS tools
- [ ] Ensure Highlight Story editor opens smoothly
- [ ] Ensure text editor and visibility toggler work
