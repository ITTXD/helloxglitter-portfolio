# Glossary

Canonical terminology and concepts for helloxglitter preorder system.

---

### Storefront (หน้าร้าน)
The customer-facing application served at `/` ([`public/index.html`](file:///Users/ittxd/Desktop/preorderbags/public/index.html)). Allows customers to browse products (bags, stickers, wallpapers), place pre-orders, redeem coupons, upload payment slips, and track their order status.

### Standalone Admin (ระบบหลังบ้านหลัก)
The dedicated operational management portal at [`/admin/`](file:///Users/ittxd/Desktop/preorderbags/public/admin/index.html) ([`public/admin/admin.js`](file:///Users/ittxd/Desktop/preorderbags/public/admin/admin.js)). Authenticated via `/api/login` and responsible for order fulfillment, slip verification, status transitions, shipping label printing, and coupon campaign configuration.

### In-Page Admin / Storefront CMS (แอดมินฝังในหน้าร้าน)
The in-storefront administration interface embedded directly within [`public/index.html`](file:///Users/ittxd/Desktop/preorderbags/public/index.html) (`#page-admin` and `body.admin-mode`). Originally built by the designer as a prototype with local storage for visual page adjustments (banner sliders, notice cards, story highlights, section reordering).

### Admin Session (เซสชันผู้ดูแลระบบ)
The secure authenticated session governed by the backend via HTTP-only cookie `admin_session` matching `SESSION_SECRET`. Grants access to privileged `/api/*` endpoints.

### Order Status (สถานะออเดอร์)
The lifecycle stages of a customer order:
- `0`: รอยืนยัน (Pending Verification / Yellow)
- `1`: ยืนยันแล้ว (Confirmed / Blue)
- `2`: กำลังผลิต (In Production / Purple)
- `3`: จัดส่งแล้ว (Shipped / Green)

### Storefront Settings (การตั้งค่าหน้าร้าน CMS)
Global visual and operational content for the storefront stored in Firestore collection `settings` under document `storefront`. Contains banner carousel images, announcement notices, and story highlights shared across all customer devices.

### Dual-Password Authentication (การยืนยันตัวตนแบบสองรหัส)
The unified authentication policy permitting either the quick mobile PIN (`333999`) or the master administrative password (`helloxglitter`) to establish an official, authenticated `Admin Session` with the server.
