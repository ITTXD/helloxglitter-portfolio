# 0002. Shopee Order Registration and Unified Phone Tracking

To allow customers purchasing on Shopee to track custom preorder queues alongside web storefront customers, we introduced a Shopee Order Registration system with phone-based lookup and unified queue numbers.

1. **Shopee Order Registration Flow**: Accessible directly from the mobile hamburger menu via an orange Shopee button. Captures customer name, delivery address, phone number, Shopee Order SN, and optional customer note.
2. **Shopee Order SN Validation and Collision Policy**: Shopee Order SN is validated to 14–20 alphanumeric characters (`^[A-Za-z0-9]{14,20}$`). If an order SN already exists in the system, updating is only permitted if the submitted phone number matches the registered phone number; submissions with mismatched phone numbers are rejected to prevent unauthorized overwrites.
3. **Unified Queue Counter and Initial Status**: Registered Shopee orders start directly at status `1` (ยืนยันคิวแล้ว) with a sequential `HLG-XXX` queue number so internal production follows a single, uninterrupted queue.
4. **Dual Sync & Public Phone Tracking**: Orders are posted to `POST /api/orders/shopee` (Firestore `orders` collection) and cached in client `hlgOrderStore`. Tracking by customer phone on `#page-tracking` and `GET /api/track/phone/:phone` displays Shopee orders with a prominent `[Shopee]` badge, status timeline, and parcel tracking carrier/number.
5. **Admin Portal Channel Filtering**: Standalone and in-page admin order lists highlight Shopee orders with `[Shopee]` badges and include channel filters `[ ทั้งหมด | เว็บไซต์ | Shopee ]`.
