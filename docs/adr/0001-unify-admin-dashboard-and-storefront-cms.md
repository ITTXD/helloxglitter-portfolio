# 0001. Unify Standalone Admin and In-Page Storefront CMS

To eliminate split-brain state between the separate `/admin/` portal and the embedded storefront admin (`#page-admin`), we decided to unify authentication and data storage across both surfaces.

1. **Dual-Password Authentication**: The backend `/api/login` endpoint accepts either the master password (`ADMIN_PASSWORD`, default `helloxglitter`) or the quick mobile PIN (`333999`). Both establish an identical HTTP-only `admin_session` cookie so all backend administrative APIs work seamlessly from both interfaces.
2. **Live Order Synchronization**: The In-Page Admin replaces client-side `localStorage` with live calls to `GET /api/orders` and `PUT /api/orders/:id`, ensuring fulfillment and tracking status remain consistent with Firestore.
3. **Cloud-Synced Storefront Settings**: Storefront banners, announcement notices, and story highlights are persisted in Firestore under `settings/storefront` via `GET /api/settings/storefront` and `PUT /api/settings/storefront`, allowing on-the-fly storefront CMS edits to propagate immediately to all users.
