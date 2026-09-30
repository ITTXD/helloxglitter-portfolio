# 01: Unify Order Management (Move Storefront Queue to /admin/)

**What to build:** Takes the advanced features from the storefront's `v8QueueDashboard` (Flash/SPX tracking, FAST TRACK, print labels, status steps) and merges them into the real `/admin/` portal. The storefront will no longer render the heavy order table, but will have a button linking to the `/admin/` portal.

**Blocked by:** None (can start immediately).

**Status:** DONE

- [x] Ensure `/admin/` order table supports carrier selection (Flash/SPX/J&T) and tracking number input
- [x] Ensure `/admin/` order table supports FAST TRACK badge
- [x] Ensure `/admin/` order table supports setting 5-step status
- [x] Remove `v8QueueDashboard` from `public/index.html` and replace it with a button that redirects to `/admin/orders`
