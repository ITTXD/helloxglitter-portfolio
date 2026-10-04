# PLAN: Shop Builder — แอดมินสร้าง "ร้าน/หมวดขายของ" ใหม่ได้เอง

Branch: `feat/shop-builder`

## SCOPE (อัปเดตตามที่ผู้ใช้สั่ง)
- **แก้เฉพาะหน้า admin ที่ติดมากับเว็บ = `/admin/`** (`public/admin/index.html`, `admin.js`, `admin.css`) + API ฝั่ง `server.js`
  ซึ่งเป็นที่ที่เพิ่มหมวดหมู่/สินค้าได้อยู่แล้ว (`admin.js` ~L1137 categories, ~L1165 products)
- **ห้ามแก้หน้าลูกค้า** (`public/index.html`, `public/app.js`) — หน้าลูกค้าดีอยู่แล้ว
  หน้าลูกค้าเดิมอ่าน `/api/categories` + `/api/products` อยู่แล้ว จึงต้องรักษา **รูปแบบข้อมูลเดิมให้เข้ากันได้** (เพิ่มฟิลด์ได้ ห้ามเปลี่ยน/ลบฟิลด์เดิม)
- ข้อ P3 (UI ลูกค้า) และ P5 (Home cards/cleanup) **ตัดออกจากงานนี้** จนกว่าผู้ใช้จะสั่ง

## เป้าหมาย
ในหน้า admin มีแท็บ **"ขายของ"** กด **＋** เพื่อสร้างร้านใหม่ (เช่น พวงกุญแจ, เสื้อ) แล้วเพิ่มสินค้าได้:
ชื่อ, ราคา, **หลายรูป**, คำอธิบาย, ตัวเลือก (ไซส์/สี) หน้าลูกค้าต้องหน้าตาเหมือนหน้าซื้อกระเป๋า
(`#page-preorder`) กดใส่ตะกร้าแล้วสั่งซื้อ + ตรวจสลีป + เข้า /admin queue ได้เหมือนเดิม

## สิ่งที่มีอยู่แล้ว (ต่อยอด ไม่เขียนใหม่)
| ส่วน | ที่อยู่ | สถานะ |
|---|---|---|
| หมวด `categories[]` | `GET/POST/PUT/DELETE /api/categories` (server.js ~L446) | ใช้ได้ |
| สินค้า `custom_products[]` | `/api/products` (server.js ~L590) | ใช้ได้ แต่รูปเดียว, `image_url` เป็น base64 |
| หน้าหมวดอัตโนมัติ | `hlgEnsureCategoryPage` (index.html ~L16539) | การ์ดกริดธรรมดา ไม่เหมือนหน้ากระเป๋า |
| ใส่ตะกร้า | `hlgAddCustomProductToCart` | ใช้ได้ (type `custom`) |
| ฟอร์มแอดมิน | `public/admin/admin.js` | ต้องเช็คว่ามีแท็บสินค้าแล้วหรือยัง |

## ช่องว่างที่ต้องทำ
1. **รูป**: เก็บ base64 ในเอกสารเดียว (`settings/storefront`, จำกัด 1 MiB) → ต้องย้ายเป็นไฟล์ (Storage/Blob) เก็บแค่ URL; รองรับหลายรูป (`images[]`)
2. **Data model**: ทุกอย่างอยู่ในเอกสารเดียวและ read-modify-write ชนกันได้ → แยก collection `shops/{id}` และ `shop_products/{id}`
3. **UI ลูกค้า**: ทำ template หน้าร้านให้เหมือน `#page-preorder` (hero, ตัวเลือก, แกลเลอรี, ปุ่มใส่ตะกร้า)
4. **Admin**: แท็บ "ขายของ" → รายการร้าน → ＋ เพิ่มร้าน → ＋ เพิ่มสินค้า (ชื่อ/ราคา/รูปหลายรูป/ตัวเลือก/เปิด-ปิดขาย)
5. **Checkout**: ยืนยันว่า item `type:custom` ผ่านราคา/โปรโมชัน/คูปอง/ค่าส่งและ `POST /api/orders` ถูกต้อง (server ต้องคำนวณราคาจาก DB ไม่เชื่อ client)
6. **Home preview**: การ์ดร้านบนหน้าแรกสร้างจากร้านอัตโนมัติ (ผูก id ไม่ใช้ index)

## Data model (เป้าหมาย)
```
shops/{shopId}          { name, slug, description, coverUrl, active, sort, createdAt }
shop_products/{pid}     { shopId, name, price, images[], description, options[{label,values[]}], active, sort }
```
Migration: อ่าน `settings/storefront.categories` + `custom_products` แล้วแปลงเป็น 2 collection ข้างบน (script ครั้งเดียว, ไม่ลบของเดิมจนกว่าจะยืนยัน)

## Phases (ทำทีละ PR/commit เล็ก ทดสอบได้ทุกขั้น)
- **P0 — ทดสอบก่อน (tdd)**: เขียนเทสต์ API สำหรับ shops/products (สร้าง/แก้/ลบ/ต้องเป็นแอดมิน/validate ราคา)
- **P1 — Backend**: collection ใหม่ + endpoints + upload รูป + migration script
- **P2 — Admin UI**: แท็บ "ขายของ", ฟอร์มเพิ่มร้าน/สินค้า, อัปโหลดหลายรูป, preview สด
- ~~**P3 — Storefront UI**: template หน้าร้านเหมือนหน้ากระเป๋า, หน้าสินค้า, ใส่ตะกร้า~~ (นอกขอบเขต)
- **P4 — Checkout/Order**: server คำนวณราคาจาก DB, เก็บ items ใน order, แสดงใน /admin queue
- ~~**P5 — Home cards + cleanup**: การ์ดร้านบน Home อัตโนมัติ, ลบโค้ดตาย preview (`v8-preview-stable-system`)~~ (นอกขอบเขต)
- **P6 — Deploy**: `npm test`, preview deploy บน Vercel, ตรวจมือถือ, แล้ว promote + alias

## ความเสี่ยง
- `public/index.html` 17,900 บรรทัด มีโค้ดซ้อนหลายชั้น → เพิ่มเป็นไฟล์/โมดูลแยก (`public/shop/*.js`) แทนการแทรกใน index.html เพิ่ม
- รูปใหญ่ทำ Firestore เกินลิมิต → บีบรูปฝั่ง client (≤1000px) + เก็บเป็นไฟล์
- ราคาจาก client ปลอมได้ → server ต้อง recompute (เหมือน fix `fa2d085`)

## คำถามที่ต้องตัดสินใจ
1. เก็บรูปที่ไหน: Firebase Storage หรือ Vercel Blob?
2. สินค้ามีตัวเลือก (ไซส์/สี) ไหม หรือราคาเดียว?
3. สินค้าพรีออเดอร์แบบกระเป๋า (มีคิว/ล็อตผลิต) หรือพร้อมส่ง (มีสต็อก)?
4. หน้า admin ที่ทำ: ใน `index.html` (admin built-in) หรือ `/admin/` (Full Portal) หรือทั้งสอง?
