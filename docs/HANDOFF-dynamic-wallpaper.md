# Handoff: Dynamic Wallpaper (admin เพิ่ม wallpaper + ลิงก์ดาวน์โหลดเอง)

Repo: /Users/ittxd/Desktop/preorderbags (branch main, HEAD a71241b + uncommitted changes)
Rules: ต้องทำ `server.js` และ `api/[...path].js` ให้ตรงกัน (parity) / ห้ามทำให้ order เดิมพัง / การ์ด wallpaper ต้องใช้โครง `.gcard` ใน `.gallery` / ทำตามวินัย /implement (ทีละขั้น + ทดสอบ) / `npm test` ต้องผ่านทั้งหมด (21 suites)

## เป้าหมาย
1. Admin เพิ่ม/แก้ wallpaper ใหม่ได้เอง (ชื่อ, ราคา, รูป, **ลิงก์ดาวน์โหลด** `download_url`) ไม่ต้องแก้โค้ด
2. จุดเพิ่ม: (a) หน้า Admin หมวดหมู่ แถว wallpaper ปุ่ม `＋ เพิ่มสินค้า`, (b) Admin product manager เลือกหมวด Wallpaper แล้วเห็นช่องลิงก์, (c) หน้าร้าน `#page-wallpaper` ถ้า login admin มีปุ่ม `＋ เพิ่ม Wallpaper ใหม่`
3. หน้าร้านแสดง wallpaper ทุกอัน (จาก `custom_products`, fallback "Wallpaper Special Set" 99฿) กดการ์ด = เข้าตะกร้าทันที
4. ลูกค้าสั่งซื้อ -> order เก็บ `download_links:[{name,url}]` -> เช็คอีเมลที่ `#page-wpcheck` (`/api/wallpaper/check`) ได้ลิงก์ของที่ซื้อจริง

## ทำเสร็จแล้ว (ยังไม่ commit, ยังไม่ได้รัน npm test หลังแก้)
- `server.js` + `api/[...path].js`:
  - POST/PUT `/api/products` รับ/เก็บ `download_url` (รับ `download_link` ด้วย)
  - `/api/wallpaper/order`: ค้นลิงก์จาก custom_products ตามชื่อ pattern เก็บ `download_link`, `download_links`, `customer_email`
  - `/api/wallpaper/check`: หา order ที่เป็น wallpaper (type หรือ items) จับคู่อีเมล, รวมลิงก์จาก `download_links`/items/patterns, คืน `download_links` + `download_link` (fallback Drive เดิม)
  - `/api/orders/confirm` (ตะกร้ารวม): สร้าง `download_links` จาก items (ใช้ `it.download_url` หรือ lookup ด้วย id/name), เก็บ `email`/`customer_email`
  - `/api/track/email/:email` และ `/api/track/:id` คืน `download_link(s)`
- `public/admin/admin.js`: ปุ่ม `＋ เพิ่มสินค้า` ในแถวหมวด, ช่อง `#hlgDownloadUrl` (wrap `#hlgDownloadWrap` โชว์เฉพาะ wallpaper), เซฟ/แก้/รีเซ็ต/badge "มีลิงก์โหลด"
- `public/app.js`: `wpCheckDownload` แสดงปุ่มดาวน์โหลดทุกลิงก์
- `public/index.html`:
  - เพิ่ม `#wpAdminBar` ใน `#page-wallpaper`
  - เขียนใหม่ `renderWallpaperGallery()`, `wpTogglePattern`, `wpChangeQty`, `wpUpdateSummary`, `wpCheckDownload` (เรียก API จริง) -- ใน section "10. WALLPAPER INTERACTION" (~บรรทัด 7849)

## ยังเหลือ (สำคัญ)
1. **`renderWallpaperGallery()` ยังไม่ถูกเรียกที่ไหนเลย** และ `<div id="wallpaperGallery">` ยังมีการ์ด static เดิม (`#wpCard`) อยู่ -> ต้องเรียกตอน showPage('wallpaper'), หลัง hydrate custom products, หลังเซฟ/ลบสินค้า (`hlgSyncCustomProducts`/`hlgSaveProduct`/`hlgDeleteProduct`), และตอน login admin
2. **Modal หน้าร้าน `hlgProductModal`** (index.html ~16841, `hlgOpenAddProductModal`, `hlgSaveProduct` ~17060): ยังไม่มีช่องลิงก์ดาวน์โหลด -> เพิ่ม input `#hlgProdModalDownload` (โชว์เมื่อ catId==='wallpaper'), เติมค่าตอนแก้ไข, ส่ง `download_url` ใน payload
3. **Cart sync**: `syncWallpaper` (index.html ~9965, `window.v8SyncWallpaperToCart`) ยังรองรับแค่การ์ดเดียว `#wpCard`/`wpPicked.Wallpaper` -> ต้องวนทุก `.wp-card.picked` ใน `#wallpaperGallery` แล้ว push `{type:'wallpaper', id, name, price, qty, image, download_url, requiresEmail:true}` (กรอง wallpaper เดิมออกก่อน); listener คลิกที่ผูกกับ `#wpCard` ต้องเปลี่ยนเป็น `.wp-card`
4. **ตะกร้ารวม** `v8ConfirmUnifiedOrder` (index.html ~8941): map items ให้ส่ง `id`, `download_url` ด้วย (ตอนนี้ส่งแค่ name/variant/qty/price/image/type); มี flow อื่น (`hrxPostSlip`/`/api/orders/confirm` ~15016) ที่ส่ง `items` ต่อ ตรวจว่า field ไม่หาย
5. หน้า tracking ในหน้าร้าน: แสดงปุ่มลิงก์จาก `download_links` (ดู `isWallpaper` ใน index.html)
6. Tests: เพิ่มใน `test/shop-builder.test.js` — POST product พร้อม `download_url`, สร้าง wallpaper order แล้ว `/api/wallpaper/check` ได้ลิงก์ของสินค้านั้น, markup มี `hlgDownloadUrl`/`wpAdminBar`/`renderWallpaperGallery`; อัปเดต test เดิมที่เช็ค `class="gcard wp-card"` (การ์ดถูก render ด้วย JS แล้ว อาจต้องปรับ assertion)
7. รัน `npm test` (ต้องผ่านหมด) -> ทดสอบมือบน local (`node server.js`) -> commit -> `git push origin main` -> `npx vercel --prod --yes` (+ alias helloxglitterstore.vercel.app / helloxglitter-preorder.vercel.app)

## ข้อควรระวัง
- แก้ index.html ใช้ line เปลี่ยนบ่อย (ไฟล์ ~18.7k บรรทัด, CRLF) -> grep หาตำแหน่งก่อนแก้
- `esc()` ใน index.html ใช้ escape HTML; ห้ามเอา id ที่มี `'` ลง onclick โดยไม่ escape
- ค่า fallback ลิงก์ Drive เดิม: https://drive.google.com/drive/folders/1xhovSRun2q6O4g7S_wDKwuHuETZVk10-?usp=sharing
