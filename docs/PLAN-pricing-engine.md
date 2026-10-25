# PLAN: Shared Pricing Engine + Server-Authoritative Checkout

Branch: `feat/shared-pricing-engine`
Last updated: 2026-10-25
Status: **P1 complete — trusted catalog + published Cloud pricing config are live; checkout is still not wired to the server quote yet**

---

## 0. Executive summary

เป้าหมายคือทำให้ **server เป็นแหล่งความจริงของราคา** ส่วน browser ทำหน้าที่แสดงผลเท่านั้น
โดยใช้ **engine กลางตัวเดียว** คำนวณ:

- ราคาปกติ / ราคาที่แอดมิน override
- โปรลดราคาสินค้าชิ้นเดียว
- โปรตามจำนวนชิ้น (tier)
- ของแถมตามจำนวน / ตามไซส์
- ส่งฟรี / ค่าส่งพื้นที่ห่างไกล
- คูปอง (ส่วนลดตามหมวด)
- ยอดรวมสุดท้าย

P0 ทำ engine กลาง + test
P1 ทำ trusted catalog, pricing config บน Cloud, admin publish/history/restore และ storefront hydration
ยังไม่เปลี่ยน flow ขายจริง: `/api/orders`, การตรวจสลิป, sticker/wallpaper ยังเชื่อยอดจาก client จนกว่าจะถึง P2/P3


---

## 1. ปัญหาที่ต้องแก้

### 1.1 ช่องโหว่ราคา (ต้องแก้ก่อน)

ตอนนี้ API หลายตัวเชื่อยอดเงินที่ client ส่งมา:

| Endpoint | สิ่งที่ client ควบคุมได้ในปัจจุบัน |
|---|---|
| `POST /api/orders` | `total_price`, `original_price`, `shipping_cost`, `savings`, `coupon_discount` |
| `POST /api/orders/confirm` | `original_price`, `total_price`, `shipping_cost`, `coupon_discount` |
| `POST /api/orders/verify-slip` | `amount` ที่ใช้ตรวจสลิป |
| `POST /api/sticker/order` | `total_price`, `shipping_cost` |
| `POST /api/wallpaper/order` | `total_price` (default 99) |

ผลคือผู้ใช้ที่แก้ JavaScript / ยิง API ตรงสามารถ:

- ตั้งราคาสินค้าเอง
- ลดค่าส่งเอง
- ใช้คูปองผิดหมวด หรือใช้ส่วนลดเกินยอดสินค้า
- สร้างออเดอร์ที่ยอดชำระไม่ตรงกับราคาจริง
- ตรวจสลิปด้วยยอดที่ตัวเองตั้ง

### 1.2 ปัญหาความถูกต้องของยอด

- `total_price` ถูกใช้ต่างความหมายในแต่ละ flow
  - บางที่หมายถึงยอดสินค้าหลังส่วนลด (ยังไม่รวมค่าส่ง)
  - บางที่หมายถึงยอดรวมที่มีค่าส่งแล้ว
- `hlgTierQuote` ฝั่ง browser คิดจากราคาใน cart ที่ client แก้ได้
- คูปองถูก mark เป็น `used` ตอนสร้าง draft `/api/orders` ก่อนลูกค้าจ่ายเงินจริง
  ถ้าลูกค้าปิดหน้า / สลิปไม่ผ่าน / ออเดอร์ถูกยกเลิก คูปองจะถูกกินไปแล้ว
- `validateCouponForCheckout` คิดส่วนลดจาก subtotal ทั้งตะกร้า ไม่ได้จำกัดเฉพาะหมวดที่คูปองใช้ได้
- `markCouponAsUsed` ไม่ได้ทำแบบ transactional กับ order creation จึงเกิด race ได้
- ราคา/โปร/สินค้าที่แอดมินสร้างบางส่วนยังอยู่แค่ `localStorage` เครื่องแอดมิน
  ลูกค้าคนละเครื่องจึงเห็นไม่ตรงกัน และ server มองไม่เห็น

### 1.3 ปัญหา SKU

มี 2 รูปแบบที่ใช้พร้อมกัน:

- Storefront เดิมใช้ `JSON.stringify([type, name, variant])`
- Admin / tier / stock ใช้ `type|name|variant` หรือ `custom|categoryId|productId`

engine กลางใช้ **canonical pipe format** เป็นหลัก และอ่าน legacy JSON key ได้ระหว่าง migration

---

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย

### เป้าหมาย

1. Server คำนวณราคาและส่วนลดทั้งหมดจากข้อมูลที่เชื่อถือได้
2. Browser ใช้ engine ตัวเดียวกับ server เพื่อ preview ได้ตรงกัน
3. API ไม่รับราคา/ยอดเงิน/ส่วนลดจาก client
4. คูปองถูกจองตอนสร้าง pending order และถูกใช้จริงตอนยืนยันเท่านั้น
5. เก็บ pricing snapshot ต่อออเดอร์เพื่อตรวจย้อนหลังได้
6. เปลี่ยนทีละ phase โดยยังขายได้และ rollback ได้

### ไม่ใช่เป้าหมายในรอบนี้

- ไม่ migrate เป็น React
- ไม่เปลี่ยนหน้าตา checkout / cart ใน P0
- ไม่สร้างระบบบัญชี/ภาษี/ใบกำกับเต็มรูปแบบ
- ไม่แก้ระบบสต็อกทั้งระบบ ยกเว้นจุดที่เกี่ยวกับการจองออเดอร์

---

## 3. หลักการออกแบบ

1. **Server is the source of truth** — client ส่งได้แค่ `sku` + `qty` + ข้อมูลลูกค้า + ที่อยู่ + โค้ดคูปอง
2. **One engine, two runtimes** — ไฟล์เดียวโหลดได้ทั้ง browser (`window.HLGPricing`) และ Node (`require`)
3. **Prices are resolved, never accepted** — ราคามาจาก catalog/config ที่ server โหลดเอง
4. **Money is integer baht** — ปัดเศษด้วย `Math.round` และ clamp ไม่ให้ติดลบ
5. **Quote first, order second** — server ออก quote มี TTL แล้วค่อยสร้าง order จาก quote
6. **Snapshot everything** — เก็บราคา/โปร/ค่าส่ง/คูปองที่ใช้จริงไว้ใน order
7. **Strict input validation** — จำนวนต้องเป็นจำนวนเต็มบวก, จำกัดจำนวนรายการ, จำกัด qty
8. **No silent client fallback** — ถ้า server คำนวณไม่ได้ ต้อง reject ไม่ใช่ใช้ยอด client

---

## 4. P0 + P1 ที่ทำเสร็จแล้วใน branch นี้

### 4.1 ไฟล์ใหม่ (P0)

| ไฟล์ | หน้าที่ |
|---|---|
| `public/data/pricing-engine.js` | Shared UMD pricing engine |
| `test/pricing-engine.test.js` | Unit tests 26 เคส |
| `docs/PLAN-pricing-engine.md` | แผนนี้ |

### 4.2 Engine exports

```js
HLGPricing.VERSION
HLGPricing.MAX_QTY
HLGPricing.canonicalSku(item)
HLGPricing.legacySku(item)
HLGPricing.parseBangkokDate(value)
HLGPricing.isActive(rule, now)
HLGPricing.createCatalog(input)
HLGPricing.resolveItemPrice(product, pricing, now)
HLGPricing.shippingQuote(address, items, shippingConfig)
HLGPricing.tierQuote(items, address, options)
HLGPricing.computeQuote(input)
```

### 4.3 Runtime

Browser:

```html
<script src="/data/pricing-engine.js"></script>
<script>
  const quote = HLGPricing.computeQuote({
    items,
    catalog,
    pricing,
    tier,
    shipping,
    coupon,
    address
  });
</script>
```

Node / server:

```js
const pricing = require('../public/data/pricing-engine.js');

const quote = pricing.computeQuote({
  items,
  catalog,
  pricing,
  tier,
  shipping,
  coupon,
  address,
  now: Date.now()
});
```

> P0 ยังไม่ได้ใส่ `<script>` ใน storefront และยังไม่ได้เรียก engine จาก API
> เพื่อไม่ให้ยอดที่ลูกค้าเห็นเปลี่ยนก่อน server พร้อม

### 4.4 Input ของ `computeQuote`

```js
{
  items: [
    {
      sku: 'bag|Merilah|15 × 16 inch', // หรือ type/name/variant, หรือ productId
      qty: 2
    }
  ],
  catalog,      // จาก HLGPricing.createCatalog(...) หรือ raw input
  pricing,      // { base, promos }
  tier,         // hlg_quantity_promo_v1
  shipping,     // hlg_shipping_v1
  coupon,       // { code, discount_amount, redeem_category }
  address: '...',
  now: Date.now(), // server ควรกำหนดเอง ไม่รับจาก client
  maxQty: 999      // server กำหนดเอง
}
```

**ราคาใน item จะถูกเมินเสมอ** แม้ client จะส่ง `price`, `base_price`, `unit_price` มา

### 4.5 Output หลัก

```js
{
  version: 1,
  currency: 'THB',
  items: [{
    sku, type, name, variant, qty,
    base_price,
    unit_price,
    line_subtotal,
    promo,
    tier_unit_price,
    tier_saving,
    line_total
  }],
  item_discount,
  tier: {
    name, quantity, level, discount, gifts,
    subtotal, shipping, freeShipping, snapshot
  },
  tier_discount,
  subtotal,             // ยอดสินค้าหลัง item promo + tier ก่อนคูปอง
  coupon: { code, redeem_category, eligible_subtotal },
  coupon_discount,
  total_before_shipping,
  shipping: { base, extra, total, remote, rule, pending, freeShipping },
  shipping_cost,
  grand_total,
  free_shipping,
  gifts,
  discount_total,
  snapshot
}
```

### 4.6 Test ที่ผ่านแล้ว

รัน:

```bash
node --check public/data/pricing-engine.js
node test/pricing-engine.test.js
```

ครอบคลุม:

- canonical / legacy SKU
- catalog จาก built-in + sticker + custom product
- custom wallpaper ค้นด้วย `id` และอ่าน alias `custom|wallpaper|productId`
- base override ทั้ง canonical และ legacy JSON key
- promo priority: `sku` > `selected` / `size` > `type` > `all`
- promo mode: fixed / percent / amount
- ช่วงเวลาแบบเวลาไทย (+07:00)
- shipping base / remote / pending / wallpaper-only
- tier percent, product rule, gift ตามไซส์, free shipping + remote surcharge
- การนับจำนวนเฉพาะกลุ่มที่เลือกและ exclude SKU
- coupon ตามหมวด + cap ยอด
- การเพิกเฉยราคาที่ client ส่งมา
- custom cart line ที่ส่ง `type:'custom'` + `productId` ถูก resolve กลับเป็นกลุ่ม bag ได้
- client ตั้ง `maxQty` ใน cart line เพื่อขยาย limit ไม่ได้
- invalid item / invalid qty / empty cart
- UMD โหลดได้ทั้ง browser-like VM และ Node

### 4.7 P0 Acceptance

- [x] engine ไฟล์เดียวใช้ได้ทั้ง browser และ Node
- [x] ไม่มีสูตรราคาซ้ำใน engine
- [x] ราคา client ถูก ignore
- [x] legacy pricing key อ่านได้
- [x] test ผ่าน 26/26
- [x] ยังไม่เปลี่ยน behavior การขายจริง
- [x] ยังไม่ wire เข้า checkout (ตั้งใจ)

### 4.8 P1 — Trusted catalog + published pricing config (เสร็จแล้ว)

#### ไฟล์ที่เพิ่ม/แก้

| ไฟล์ | หน้าที่ |
|---|---|
| `pricing-config.js` | validation, cache, publish/history/restore, trusted catalog builder |
| `public/data/pricing-cloud.js` | storefront hydration จาก published config |
| `test/pricing-cloud.test.js` | P1 tests 32 เคส |
| `server.js` | local API + in-memory/Firestore adapter + serialized publish queue |
| `api/[...path].js` | production API + Firestore transaction publish |
| `public/data/patterns.js` | เพิ่ม inert CommonJS export ให้ Node ใช้ built-in catalog |
| `public/admin/admin.js` | cloud publish/pull/history/restore panel |
| `public/admin/index.html` | container + styles สำหรับ cloud panel |
| `public/index.html` | โหลด `/data/pricing-cloud.js` หนึ่งครั้งด้วย `defer` |

#### Storage

- `settings/pricing` — config ปัจจุบัน `{schema_version, version, pricing, tier, shipping, updated_at, updated_by, published_at}`
- `pricing_config_history/{version}` — snapshot เต็มของทุกเวอร์ชันที่เผยแพร่ พร้อม `restored_from` ถ้าเป็นการย้อนกลับ
- `settings/storefront.custom_products` + `settings/storefront.categories` — แหล่งสินค้า/หมวดที่แอดมินเพิ่มเอง
- ไม่เก็บ secret ใด ๆ ใน `settings/pricing`

#### Endpoints ที่ใช้จริง

```
GET /api/pricing/config            (public)
→ {
    success: true,
    schema_version: 1,
    version: 3,
    published: true,
    pricing: { base, promos },
    tier, shipping,
    updated_at, updated_by, published_at
  }
```

```
PUT /api/pricing/config            (admin)
body: { version, pricing, tier, shipping }
→ { success: true, ...config ที่ publish แล้ว }

400 INVALID_CONFIG      → { success:false, code, error, details:[{field,message}] }
401                     → Unauthorized
409 VERSION_CONFLICT    → { success:false, code, error, current_version }
```

```
GET /api/pricing/config/history?limit=15   (admin, default 20, max 50)
→ { success:true, history:[{
      version, updated_at, updated_by, published_at, restored_from,
      summary: {
        base_prices, promos, tier_enabled,
        tier_selected_groups, tier_product_rules,
        shipping_base, shipping_extra, shipping_rules
      }
    }] }
```

```
POST /api/pricing/config/restore           (admin)
body: { version, current_version }
→ { success:true, restored:true, ...config เวอร์ชันใหม่ }
```

- restore ไม่เขียนทับ history เดิม แต่ publish ค่าเก่าเป็นเวอร์ชันใหม่
- ถ้า `current_version` ไม่ตรงกับ Cloud → `409 VERSION_CONFLICT` เหมือน publish

```
GET /api/pricing/catalog           (public)
→ {
    success: true,
    schema_version: 1,
    catalog_version: 1,
    pricing_version: 3,
    generated_at,
    categories: [...],
    count,
    duplicates: [],
    items: [{
      sku, legacy_sku, aliases, type, name, variant,
      size_key, category_id, product_id, image, download_url,
      catalog_price, base_price, price, promo
    }]
  }
```

- `catalog_price` = ราคาปกติจาก catalog
- `base_price` = ราคาหลัง base override (ถ้ามี)
- `price` = ราคาหลัง promo ชิ้นเดียว (ถ้ามี)
- ถ้า catalog จริงมี SKU ซ้ำ → `409 DUPLICATE_SKU` พร้อม `details.duplicates`

#### Validation / concurrency / cache

- ราคาเป็นจำนวนเต็ม 0–1,000,000; promo percent 0–100; shipping postcode ต้องเป็นเลข 5 หลัก
- ตรวจช่วงวันที่แบบเวลาไทย, `selected` promo ต้องมี SKU, ปฏิเสธ `__proto__` / `prototype` / `constructor`
- จำกัดจำนวน base prices, promos, shipping rules, SKU ต่อรายการ
- `version` เป็น optimistic concurrency: publish ต้องส่งเวอร์ชันที่อ่านล่าสุด
- `server.js` ใช้ promise queue กัน publish พร้อมกันใน process เดียว
- `api/[...path].js` ใช้ Firestore transaction อ่าน version + เขียน config + history พร้อมกัน
- config cache 60 วินาทีต่อ process; publish/restore ล้าง cache ของ instance นั้น
- instance อื่นอาจเห็นค่าเก่าได้ไม่เกิน 60 วินาที (ยอมรับได้ใน P1)

#### Admin flow

- แท็บ **สินค้าและโปรโมชั่น** มีการ์ด **“ราคากลางบน Cloud”**
- **เผยแพร่ขึ้น Cloud** ส่ง pricing/tier/shipping จากเครื่องนี้ + `version` ที่โหลดมา
- ถ้าส่วนไหนยังไม่มีในเครื่อง จะใช้ค่าจาก Cloud ที่โหลดมาล่าสุด ไม่ส่ง default ว่างทับ
- **ดึงจาก Cloud** เขียนทับ `hlg_pricing_v1`, `hlg_quantity_promo_v1`, `hlg_shipping_v1` แล้ว re-render editor
- **ประวัติเวอร์ชัน** แสดง summary และปุ่มย้อนกลับ
- editor เดิมยังบันทึก localStorage ก่อน; ต้องกดเผยแพร่ขึ้น Cloud เพื่อให้ลูกค้าเห็น
- `x-admin-user` เป็น optional actor label; ถ้าไม่ส่งจะเป็น `admin`

#### Storefront hydration

- `pricing-cloud.js` โหลดครั้งเดียวจาก `index.html`
- ข้าม admin session (`hlg_admin_session_v2=1` ใน localStorage/sessionStorage) เพื่อไม่ทับ draft ในเครื่องแอดมิน
- `?hlg_cloud=1` บังคับ preview บน admin session ได้
- `hlg_pricing_cloud_optout_v1=1` ปิด hydration บนเครื่องนั้น
- รับเฉพาะ config ที่ published แล้ว (`version > 0`)
- เปรียบเทียบ JSONแบบ stable key order; ถ้าเท่ากันไม่เขียนซ้ำ
- ถ้าเปลี่ยน: เขียน 3 keys + `hlg_shipping_flash_image_20260928_v1=1` + meta version แล้ว reload หนึ่งครั้งต่อเวอร์ชัน
- แสดงผลเฉพาะฝั่ง browser; ยังไม่ใช่การป้องกันการแก้ราคา

#### Test

```bash
node test/pricing-cloud.test.js   # 32/32
```

ครอบคลุม:

- Node import ของ `patterns.js` และจำนวน 46 bag + 10 sticker
- default config, validation, dangerous key, invalid price/percent/postcode
- publish v1, stale publish conflict, history summary, restore เป็นเวอร์ชันใหม่
- catalog 57 built-ins, custom bag alias `custom|bag|productId`, base override, duplicate SKU
- server endpoints: public config, auth, invalid 400, publish, conflict 409, history, restore, custom product catalog, duplicate 409
- storefront hydration: เขียน keys, reload ครั้งเดียว, second load ไม่ reload, key-order stable, unpublished, admin skip, force, opt-out
- admin UI strings, script inclusion, server/Vercel route parity

#### Acceptance

- [x] server สร้าง trusted catalog จาก built-in + Firestore custom products ได้
- [x] admin publish แล้ว config อยู่บน Cloud และมี version
- [x] client publish version เก่าไม่ได้ (409)
- [x] history + restore ทำงาน และ restore สร้าง version ใหม่
- [x] storefront เครื่องอื่นโหลด published config มาใช้ได้
- [x] duplicate SKU / invalid price ถูก reject
- [x] config ไม่มี secret
- [x] ไม่มีราคา/โปรจาก client ใน request ของ pricing endpoints
- [ ] ยังไม่มีการใช้ catalog/config นี้ใน `/api/quotes` หรือ `/api/orders` (P2/P3)

#### Known limitations (P1)

- **ช่องโหว่ราคายังอยู่**: checkout/order/slip/sticker/wallpaper ยังเชื่อยอดจาก client จนถึง P3
- สินค้าที่อยู่ใน `hlg_collections_v1` (local-only) ยังไม่ถูกใส่ใน server catalog
- ยังไม่มีสคริปต์ migrate localStorage → Firestore แบบอัตโนมัติ; ใช้ publish จากหน้า admin
- version guard กัน publish ซ้อนจากสองเครื่อง แต่ไม่ detect ว่า local editor เก่ากว่า Cloud หลังมีคนอื่น publish; ควรเทียบตัวเลข local/Cloud ก่อน publish และระวังการ publish ค่าว่างทับราคาที่มีอยู่
- cache 60 วินาทีต่อ instance; หลัง publish เครื่องอื่นอาจเห็นค่าเก่าชั่วคราว
- hydration ครั้งแรกอาจ reload หนึ่งครั้ง ทำให้หน้าวาบหรือข้อมูลที่เพิ่งกรอกหาย; เป็นข้อจำกัดของ P1
- `?hlg_cloud=1` บน admin session จะเขียน config จาก Cloud ทับ local keys (เหมือนกด “ดึงจาก Cloud”); ควรสำรอง draft ก่อนถ้าไม่ต้องการให้หาย
- history เก็บ snapshot เต็มทุกเวอร์ชัน ยังไม่มี retention/pruning
- admin actor เป็น label จาก header/localStorage ไม่ใช่ identity ที่ตรวจสอบจาก server
- ยังไม่ทดสอบใน browser จริง; test เป็น Node/VM + static checks

---

## 5. Target architecture

```
┌──────────────────────────────┐
│ Browser                      │
│                              │
│ cart (sku + qty)             │
│        │                     │
│        ├── preview ──────────┼──> HLGPricing.computeQuote(...)
│        │                     │      (ใช้ config/catalog จาก server)
│        ▼                     │
│ POST /api/quotes             │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Server                       │
│                              │
│ 1. auth / rate limit         │
│ 2. load catalog + config     │
│ 3. validate coupon ownership │
│ 4. HLGPricing.computeQuote   │
│ 5. save quote (TTL 30 min)   │
└────────┬─────────────────────┘
         │ quote_id + totals
         ▼
┌──────────────────────────────┐
│ Browser                      │
│ แสดงยอดจาก server เท่านั้น    │
│ POST /api/orders             │
│   { quote_id, customer, ... }│
└────────┬─────────────────────┘
         ▼
┌──────────────────────────────┐
│ Server                       │
│ 1. โหลด quote                │
│ 2. ตรวจ TTL / used / owner   │
│ 3. ตรวจ stock                │
│ 4. reserve coupon            │
│ 5. สร้าง pending order       │
│    ด้วยยอดจาก quote          │
│ 6. mark quote used           │
└────────┬─────────────────────┘
         ▼
   ลูกค้าแนบสลิป
         │
         ▼
┌──────────────────────────────┐
│ POST /api/orders/verify-slip │
│ ใช้ grand_total จาก order    │
│ ไม่ใช้ amount จาก client     │
└────────┬─────────────────────┘
         ▼
┌──────────────────────────────┐
│ POST /api/orders/confirm     │
│ ใช้ยอดที่เก็บใน order        │
│ mark coupon used จริง        │
└──────────────────────────────┘
```

### Trusted vs untrusted

| ข้อมูล | แหล่งที่เชื่อถือ |
|---|---|
| ราคาสินค้า | server catalog |
| base override / promos | server pricing config |
| tier / shipping | server pricing config |
| coupon discount | coupon record + server engine |
| จำนวนสินค้า | client ส่งได้ แต่ server validate |
| ที่อยู่ | client ส่งได้ แต่ server ใช้คำนวณ shipping |
| ยอดเงิน | server เท่านั้น |
| เวลาที่ใช้คิดโปร | server time เท่านั้น |

---

## 6. Shared engine contract

### 6.1 Catalog

`createCatalog()` รับข้อมูล:

```js
{
  patterns,          // ALL_PATTERNS (bag)
  stickers,          // STICKER_PATTERNS
  wallpapers,        // optional
  customProducts,    // Firestore custom products
  categories,        // [{ id, name }]
  includeDefaultWallpaper: true
}
```

กฎ:

- built-in bag ใช้ `bag|name|variant`
- sticker ใช้ `sticker|name|`
- wallpaper ใช้ `wallpaper|name|variant`
- custom หมวดอื่นใช้ `custom|categoryId|productId`
- custom หมวด bag/sticker ใช้ type `bag` / `sticker` ตามสินค้าเดิม
- สินค้าที่มี `productId` จะมี alias `custom|categoryId|productId` เพื่อรองรับ SKU ที่แอดมินเคยสร้างไว้
- ค้นหาสินค้าได้จาก `sku`, `productId`, `id` หรือ legacy JSON key
- ห้ามมี SKU ซ้ำกันใน catalog จริง — `pricing-config.buildCatalog()` ตรวจและคืน `DUPLICATE_SKU` (P1 ทำแล้ว)
- ระหว่าง migrate อ่าน legacy JSON key ได้ แต่เขียนใหม่ให้เป็น canonical

### 6.2 Single-item promo

ลำดับความสำคัญ:

1. `target: "sku:<sku>"` (3)
2. `target: "selected"` ที่มี SKU ตรง (2.5)
3. `target: "size:<sizeKey>"` (2)
4. `target: "type:<type>"` (1)
5. `target: "all"` (0.5)

ถ้าคะแนนเท่ากันใช้ `updated` ล่าสุด
รองรับ `mode`: `fixed`, `percent`, `amount`
ราคาไม่เกินราคาปกติ และไม่ติดลบ

### 6.3 Tier

- นับเฉพาะสินค้าที่อยู่ใน `selectedGroups` หรือมี `productRules`
- `excludedSkus` ถูกตัดออก
- level = `min(3, จำนวนชิ้นที่ร่วมโปร)`
- ราคาพิเศษต่อชิ้น:
  1. `productRules[sku][level]` ถ้ามี
  2. `groupPercent[group][level]` + `groupModes[group][level]`
- ของแถม:
  - ถ้ามี `sizeGifts[size][min(3,จำนวนชิ้นของไซส์)]` ใช้ก่อน
  - ถ้าไม่มี ใช้ `tiers[level].gifts`
- ส่งฟรีเมื่อ `freeFrom > 0` และจำนวนชิ้นรวมถึง threshold และมีสินค้าที่ไม่ใช่ digital
- ถ้าเป็นพื้นที่ห่างไกล:
  - `coverRemote: true` → ส่งฟรีเต็ม
  - `coverRemote: false` → ลูกค้าจ่ายเฉพาะ `extra`

### 6.4 Shipping

- ไม่มีสินค้า หรือมีแต่ wallpaper → ค่าส่ง 0
- ที่อยู่ยังไม่มีรหัสไปรษณีย์ 5 หลัก → `pending: true`, total 0
- รหัสไปรษณีย์ตรง rule → `remote: true`, `total = base + extra`
- ไม่ตรง → `total = base`
- rule ที่ `enabled: false` ไม่ถูกใช้
- district ที่คั่นด้วย comma ตรวจแบบ any-match

### 6.5 Coupon

Engine คำนวณเฉพาะ **ส่วนลด** จาก coupon record ที่ผ่าน validation แล้ว:

```js
couponQuote(items, tier, {
  code,
  discount_amount,
  redeem_category
})
```

- `redeem_category = all` → ใช้ได้กับทุกสินค้า
- `bag`, `sticker`, `wallpaper` → เฉพาะประเภทนั้น
- eligible subtotal = ยอดหลัง tier ของสินค้าที่เข้าเงื่อนไข
- discount = `min(discount_amount, eligible_subtotal, subtotal)`
- การตรวจสถานะ/เจ้าของ/วันหมดอายุ/coupon used ยังเป็นหน้าที่ `coupon-service.js`

> P3 ต้องย้ายการ mark used ไปตอน confirm และทำ reservation ตอนสร้าง order

### 6.6 Error codes

| Code | ความหมาย |
|---|---|
| `EMPTY_CART` | ไม่มีสินค้า |
| `UNKNOWN_ITEM` | SKU/สินค้าไม่อยู่ใน catalog |
| `INVALID_QTY` | qty ไม่ใช่จำนวนเต็มบวก หรือเกิน max |
| `DUPLICATE_SKU` | (P1) catalog มี SKU ซ้ำ |
| `QUOTE_EXPIRED` | (P2) quote เกิน TTL |
| `QUOTE_USED` | (P2/P3) quote ถูกใช้แล้ว |
| `COUPON_NOT_ELIGIBLE` | (P3) คูปองใช้กับตะกร้านี้ไม่ได้ |

---

## 7. API contracts

> 7.1 และ 7.2 เป็นสัญญาที่ implement แล้วใน P1 (ดู response เต็มใน §4.8)

### 7.1 Pricing config (P1 — implemented)

```
GET /api/pricing/config
→ {
    success: true,
    schema_version: 1,
    version,
    published,
    pricing: { base, promos },
    tier,
    shipping,
    updated_at, updated_by, published_at
  }
```

```
PUT /api/pricing/config        (admin only)
body: {
  version,                    // optimistic concurrency
  pricing, tier, shipping
}
→ { success: true, ...config ที่ publish แล้ว }
```

- เก็บใน Firestore `settings/pricing`
- history เก็บที่ `pricing_config_history/{version}` (snapshot เต็ม)
- admin session cookie + role check
- validate schema ก่อน save; invalid → `400 INVALID_CONFIG`
- stale version → `409 VERSION_CONFLICT` + `current_version`
- cache ฝั่ง server 60 วินาที; publish/restore invalidate cache
- `server.js` serialized queue; production ใช้ Firestore transaction

### 7.2 Server catalog (P1 — implemented)

```
GET /api/pricing/catalog
→ {
    success: true,
    schema_version: 1,
    catalog_version: 1,
    pricing_version,
    generated_at,
    categories: [...],
    count,
    duplicates: [],
    items: [{
      sku, legacy_sku, aliases, type, name, variant,
      size_key, category_id, product_id, image, download_url,
      catalog_price, base_price, price, promo
    }]
  }
```

- server สร้าง catalog จาก built-in patterns/stickers/wallpaper + `settings/storefront.custom_products` เอง
- ไม่รับ catalog จาก client ใน `/api/quotes` หรือ `/api/orders`
- SKU ซ้ำ → `409 DUPLICATE_SKU` + `details.duplicates`
- ยังไม่รวมสินค้าที่อยู่แค่ `hlg_collections_v1` (local-only)

### 7.3 Quote (P2)

```
POST /api/quotes
body: {
  items: [{ sku, qty }],
  coupon_code?: string,
  address: string,
  line_user_id?: string,
  line_id_token?: string
}
→ {
  quote_id,
  expires_at,
  currency: 'THB',
  items: [...],
  item_discount,
  tier_discount,
  coupon_discount,
  subtotal,
  shipping_cost,
  grand_total,
  free_shipping,
  gifts,
  pricing_version,
  quote_token
}
```

Server:

1. validate schema / จำนวนรายการ / qty
2. โหลด catalog + pricing config
3. resolve coupon (ถ้ามี) จาก code + LINE identity
4. เรียก `computeQuote`
5. เก็บ quote doc:
   - `quote_id`
   - `items`
   - `totals`
   - `pricing_snapshot`
   - `coupon_code` / `coupon_id`
   - `line_user_id`
   - `created_at`, `expires_at`
   - `used_at: null`
   - `address_hash`
6. return `quote_id` + totals

TTL แนะนำ: **30 นาที**

### 7.4 Create order (P3)

```
POST /api/orders
body: {
  quote_id,
  customer: { name, phone, address, email?, line_user_id? },
  note?,
  payment_method?
}
```

ห้ามรับ:

- `original_price`
- `total_price`
- `shipping_cost`
- `coupon_discount`
- `savings`
- `items[].price`
- `items[].unit_price`

Server:

1. โหลด quote
2. ตรวจ `used_at`, `expires_at`, owner (LINE)
3. ตรวจ stock
4. ตรวจ coupon ซ้ำ
5. reserve coupon
6. สร้าง pending order ด้วยยอดจาก quote
7. mark quote `used_at`
8. return order id + server totals

### 7.5 Verify slip (P3)

```
POST /api/orders/verify-slip
body: {
  order_id,
  slip_data
}
```

Server:

- โหลด order
- ใช้ `order.grand_total` เป็น `expectedAmount`
- **ไม่ใช้ `body.amount`**
- ตรวจสลิปด้วย EasySlip
- ออก verify token ที่ผูกกับ order + amount + slip hash

### 7.6 Confirm order (P3)

```
POST /api/orders/confirm
body: {
  order_id,
  slip_data,
  verify_token?
}
```

Server:

- โหลด order จาก `order_id`
- ใช้ยอดที่เก็บใน order เท่านั้น
- ตรวจ verify token / EasySlip
- mark coupon เป็น used จริง
- เปลี่ยนสถานะเป็นยืนยันคิว
- idempotent: เรียกซ้ำต้องไม่สร้าง order ซ้ำ / ไม่ตัดสต็อกซ้ำ

### 7.7 Sticker / wallpaper

ใช้หลักเดียวกัน:

- สติกเกอร์: server คำนวณราคาจาก sticker catalog + shipping rule
- wallpaper: server กำหนดราคาจาก config (default 99) ไม่รับ `total_price`
- digital wallpaper: ค่าส่ง 0
- ถ้าสั่งรวมใน cart ปกติ ให้เข้า `/api/quotes` แทน endpoint แยก

---

## 8. Data model

### 8.1 Pricing config

`settings/pricing` (หรือ `pricing_config/current`):

```js
{
  version: 12,
  pricing: {
    base: {
      'bag|Merilah|15 × 16 inch': 399
    },
    promos: [
      {
        id, label, target, skus, mode, value,
        start, end, enabled, updated
      }
    ]
  },
  tier: {
    enabled, name, start, end,
    tiers: { 1: { gifts }, 2: { gifts }, 3: { gifts } },
    sizeGifts,
    selectedGroups,
    excludedSkus,
    productRules,
    groupPercent,
    groupModes,
    freeFrom,
    coverRemote
  },
  shipping: {
    base, extra, rules: [{ postcode, province, district, enabled }]
  },
  updated_at,
  updated_by
}
```

### 8.2 Quote

`quotes/{quote_id}`:

```js
{
  quote_id,
  created_at,
  expires_at,
  used_at,
  line_user_id,
  address,
  items: [{ sku, qty }],
  totals: {
    item_discount,
    tier_discount,
    coupon_discount,
    subtotal,
    shipping_cost,
    grand_total
  },
  coupon_code,
  coupon_id,
  pricing_version,
  pricing_snapshot,
  quote_token_hash
}
```

### 8.3 Order — canonical money fields

แนะนำให้ใช้ชื่อเหล่านี้เป็นหลัก:

| Field | ความหมาย |
|---|---|
| `subtotal` | ยอดสินค้าหลัง item promo + tier ก่อนคูปอง |
| `coupon_discount` | ส่วนลดคูปอง |
| `total_before_shipping` | `subtotal - coupon_discount` |
| `shipping_cost` | ค่าส่ง |
| `grand_total` | `total_before_shipping + shipping_cost` |
| `pricing_version` | version ของ config ที่ใช้ |
| `pricing_snapshot` | snapshot ที่ใช้ตรวจย้อนหลัง |
| `quote_id` | quote ต้นทาง |

Compatibility:

- `total_price` เดิมมีความหมายไม่ตรงกันในหลาย flow
- ช่วง migration ให้เขียน **ทั้ง** `grand_total` และ `total_price`
- กำหนด `total_price = grand_total` สำหรับออเดอร์ใหม่
- ออเดอร์เก่าที่ `total_price` ไม่รวมค่าส่งให้อ่านผ่าน helper แยก
- ห้ามเปลี่ยนความหมายเงียบ ๆ โดยไม่ migrate report/admin

### 8.4 Coupon reservation

เพิ่ม field ใน coupon:

```js
{
  status: 'available' | 'reserved' | 'used' | 'expired' | 'cancelled',
  reserved_by_order_id,
  reserved_until,
  used_in_order_id,
  used_at
}
```

Flow:

1. `/api/quotes` → ตรวจว่าคูปองใช้ได้ แต่ยังไม่จอง
2. `/api/orders` → reserve ด้วย transaction
3. `/api/orders/confirm` → mark used
4. order cancelled / expired → release
5. job หรือ lazy check ปล่อย reservation ที่หมดอายุ

---

## 9. Phases

### P0 — Shared engine foundation (เสร็จแล้ว)

- [x] UMD engine
- [x] catalog + promo + tier + shipping + coupon
- [x] unit tests
- [x] plan document
- [x] ยังไม่ wire เข้า production flow

**Acceptance:** test ผ่าน, ราคา client ถูก ignore, ไม่กระทบยอดขายจริง

### P1 — Trusted catalog + pricing config บน server (เสร็จแล้ว)

งาน:

- [x] ทำ `patterns.js` ให้ server import ได้ (inert CommonJS export)
- [x] สร้าง server catalog loader:
  - [x] built-in patterns
  - [x] stickers
  - [x] wallpaper
  - [x] custom products จาก `settings/storefront.custom_products`
  - [x] categories
- [x] เพิ่ม schema validation ของ pricing/tier/shipping
- [x] เพิ่ม Firestore config doc + version (`settings/pricing`)
- [x] เพิ่ม admin API สำหรับ publish/read/history/restore
- [x] เพิ่ม admin UI cloud panel (publish / pull / history / restore)
- [ ] migration script อัตโนมัติ localStorage → Firestore (ใช้ publish จาก admin แทน)
- [x] cache config ฝั่ง server 60 วินาที
- [x] เพิ่ม duplicate SKU / invalid price validation
- [x] storefront hydration จาก published config
- [ ] ใช้ catalog/config ใน quote/order (P2/P3)

**Acceptance:**

- [x] server สร้าง catalog ได้เหมือน storefront (57 built-ins + custom products)
- [x] admin publish แล้วลูกค้าคนละเครื่องเห็น config เดียวกันหลัง hydration
- [x] config version bump, history และ rollback ได้
- [x] ไม่มีราคา/โปรจาก client ใน request ของ pricing endpoints
- [ ] ยอด checkout ยังไม่ถูกบังคับจาก server (P3)
- [x] test `test/pricing-cloud.test.js` ผ่าน 32/32

> หมายเหตุ: P1 ยังไม่ปิดช่องโหว่ราคาใน checkout และยังไม่รวม collection products ที่อยู่เฉพาะ localStorage

### P2 — Quote API + browser preview

งาน:

1. เพิ่ม `POST /api/quotes`
2. เก็บ quote doc + TTL
3. ให้ browser เรียก quote เพื่อแสดงยอด
4. ระหว่างเปลี่ยนผ่าน ทำ shadow mode:
   - คำนวณฝั่ง browser ด้วย engine
   - เทียบกับ server quote
   - log ความต่าง (sku, config version, ยอด)
5. feature flag เปิดใช้ quote ทีละกลุ่ม
6. แสดงข้อความ "ราคายืนยันจากระบบ" / quote หมดอายุ
7. rate limit + max items

**Acceptance:**

- server quote กับ browser preview ตรงกันใน fixture เดียวกัน
- ไม่มี quote ที่ราคาติดลบ
- quote หมดอายุแล้วขอใหม่ได้
- ยังใช้ flow order เดิมได้ระหว่าง flag ปิด

### P3 — Server-authoritative order + coupon reservation

งาน:

1. เปลี่ยน `/api/orders` ให้รับ `quote_id` และใช้ยอดจาก quote
2. ตัดการอ่าน `original_price`, `total_price`, `shipping_cost` จาก client
3. ตัดการอ่าน `amount` จาก client ใน `/api/orders/verify-slip`
4. เปลี่ยน `/api/orders/confirm` ให้ใช้ยอดจาก order
5. ทำ coupon reserve/use/release ด้วย transaction
6. ทำ stock reservation / idempotency
7. เก็บ `pricing_snapshot` + `quote_id` ใน order
8. แก้ sticker / wallpaper endpoints
9. compatibility: เขียน `total_price = grand_total` สำหรับ order ใหม่
10. admin/report อ่าน `grand_total` ก่อน แล้ว fallback `total_price`

**Acceptance:**

- ยิง API ด้วยราคาปลอมแล้ว server ยังคิดราคาจริง
- สลิปยอดไม่ตรงถูก reject
- coupon ใช้ซ้ำไม่ได้ และไม่ถูกกินตอน draft
- confirm ซ้ำไม่สร้าง order ซ้ำ
- order เก่าอ่านได้

### P4 — Cleanup + rollout

งาน:

1. ลบโค้ดคำนวณราคาซ้ำใน `public/index.html`
2. ลบ legacy JSON SKU write path
3. ลบ localStorage pricing config ที่ไม่ใช้
4. เพิ่ม dashboard/log: quote mismatch, expired, coupon conflicts
5. เพิ่ม admin audit log
6. เพิ่ม integration tests + e2e
7. deploy preview → ตรวจมือถือ → promote
8. อัปเดต `HANDOVER.md` / docs

---

## 10. Migration plan

### 10.1 SKU

1. อ่านได้ทั้ง canonical และ legacy JSON
2. เขียนใหม่เป็น canonical
3. migration script แปลง `hlg_pricing_v1.base` และ promo `skus`
4. เก็บ legacy อ่านอย่างน้อย 1 release
5. เพิ่ม test ว่า key เก่ายังใช้ได้
6. หลังยืนยันแล้วลบ legacy path

### 10.2 Pricing config (P1 ทำแล้ว)

1. [x] admin โหลดค่าจาก `hlg_pricing_v1`, `hlg_quantity_promo_v1`, `hlg_shipping_v1` แล้ว publish ผ่าน cloud panel
2. [x] validate ด้วย schema ฝั่ง server
3. [x] เขียนลง Firestore `settings/pricing` เป็น version 1 (ครั้งแรกที่ publish)
4. [x] เปิดให้ storefront hydrate จาก cloud
5. [x] admin ยังเขียน local ได้ แต่ต้องกด publish
6. [x] cloud เป็นแหล่งความจริง; local เป็น cache/สำรอง
7. [ ] ปิด local write และลบภายหลัง (P4)
8. [ ] สคริปต์ import อัตโนมัติจากเครื่องแอดมิน (ยังใช้ publish/pull ใน UI)

### 10.3 Order totals

1. เพิ่ม `grand_total` ใน order ใหม่
2. เขียน `total_price = grand_total` ( semantics ใหม่ )
3. order เก่า: helper `orderGrandTotal(order)`:
   - ถ้ามี `grand_total` ใช้เลย
   - ถ้าไม่มี ใช้ `total_price + shipping_cost` ตาม flow ที่ถูกต้อง
4. report/admin ใช้ helper เดียวกัน
5. ห้ามให้ client ส่ง `total_price` อีกหลัง P3

### 10.4 Coupon

1. เพิ่ม field reservation
2. `/api/quotes` ยังไม่ mark used
3. `/api/orders` reserve
4. `/api/orders/confirm` mark used
5. order cancelled → release
6. เพิ่ม test race: 2 requests พร้อมกันต้องสำเร็จเพียง 1
7. ของเก่าที่ mark used ไปแล้วให้ถือว่า used ตามเดิม

### 10.5 Rollout / rollback

แนะนำ feature flags:

- `pricing_quote_enabled`
- `pricing_server_authoritative`
- `coupon_reservation_enabled`

ลำดับ:

1. deploy P0 (ไม่มี behavior change)
2. P1 config cloud + admin publish (ทำแล้ว)
3. P2 quote shadow mode
4. เปิด quote สำหรับ % ผู้ใช้
5. P3 order server-authoritative
6. เปิด 100%
7. cleanup

Rollback:

- ปิด flag กลับไป flow เดิม
- quote/order ใหม่ยังอ่านได้
- config version เก่ายังอยู่ใน Firestore
- ไม่ลบ legacy path ก่อนครบ 1 release

---

## 11. Security checklist

- [ ] `/api/orders` ไม่รับราคา/ยอดเงินจาก client
- [ ] `/api/orders/confirm` ไม่รับราคา/ยอดเงินจาก client
- [ ] `/api/orders/verify-slip` ใช้ยอดจาก order
- [ ] `/api/sticker/order` และ `/api/wallpaper/order` ใช้ราคาจาก server
- [x] server โหลด catalog/config เอง ไม่รับจาก request (P1 endpoints)
- [x] pricing config ถูก validate + sanitize ก่อน save และปฏิเสธ dangerous keys
- [x] public อ่าน pricing config ได้อย่างเดียว; publish/history/restore ต้องเป็น admin
- [ ] จำกัดขนาด request body / rate limit ของ admin config endpoint
- [ ] validate qty เป็นจำนวนเต็มบวก + max
- [ ] จำกัดจำนวน items ต่อ quote/order
- [ ] rate limit `/api/quotes`
- [ ] ตรวจ coupon ownership + status + expiry + category
- [ ] coupon reservation ทำใน transaction
- [ ] quote มี TTL + used flag + owner binding
- [ ] verify token ผูก order + amount + slip hash
- [ ] admin API ต้องมี session + role (P1 ใช้ session cookie; ยังไม่มี role แยก)
- [ ] Firestore rules ไม่อนุญาตให้ client เขียน order/quotes/config โดยตรง
- [ ] log ไม่เก็บข้อมูลบัตร/สลิปเต็ม
- [ ] ไม่ log token/coupon code แบบละเอียดเกินจำเป็น

---

## 12. Test plan

### Unit (มีแล้วใน P0)

- engine: catalog, promo, tier, shipping, coupon, invalid input, UMD
- fixture เดียวกันต้องให้ผลเท่ากันทั้ง browser และ Node

### Integration (P1 — มีแล้ว)

- `pricing-config.js`: default, validation, dangerous keys, invalid price/percent/postcode
- publish v1, stale conflict, history summary, restore เป็น version ใหม่
- trusted catalog: 57 built-ins, custom alias, base override, duplicate SKU
- server endpoints: public config, admin auth, invalid 400, publish, conflict 409, history, restore
- custom product จาก `/api/products` ปรากฏใน `/api/pricing/catalog`
- storefront hydration: เขียน keys, reload ครั้งเดียว, stable key order, admin skip, force, opt-out
- static parity ระหว่าง `server.js`, `api/[...path].js`, admin UI และ storefront script

รัน: `node test/pricing-cloud.test.js` (32/32)

### Integration (P2/P3)

- `POST /api/quotes` ด้วย SKU จริง → ได้ยอดถูก
- client ส่ง `price` / `total_price` / `discount` → server ignore
- quote หมดอายุ → 400/409
- quote ถูกใช้แล้ว → 409
- quote ของ LINE อื่น → 403
- coupon ผิดหมวด → 400
- coupon ใช้ซ้ำ → 409
- coupon race 2 request → สำเร็จ 1
- stock ไม่พอ → reject ก่อนสร้าง order
- shipping pending → ไม่คิดค่าส่งจนมีที่อยู่
- wallpaper-only → ค่าส่ง 0
- remote + tier free shipping → จ่ายเฉพาะ extra
- slip amount ไม่ตรง grand_total → reject
- verify token ปลอม/หมดอายุ → reject
- confirm ซ้ำ → idempotent
- order เก่าไม่มี `grand_total` → อ่านได้
- report/admin totals ตรงกับ order

### Parity

- fixture กลาง: cart + config + coupon
- รัน `computeQuote` ฝั่ง browser (VM) และ Node
- assert output เท่ากันทุก field ที่เกี่ยวกับเงิน

### E2E

- เลือกสินค้า → ใส่ตะกร้า → quote → กรอกที่อยู่ → สร้าง order → แนบสลิป → confirm
- coupon จาก LINE wallet
- sticker / wallpaper
- mobile viewport

---

## 13. Open decisions

1. **Quote storage**
   - Firestore quote doc (แนะนำ: ตรวจย้อนหลัง/ใช้งานง่าย)
   - หรือ HMAC signed quote (เบากว่า แต่ไม่เก็บ audit)
2. **Quote TTL**
   - แนะนำ 30 นาที
   - ต้องตัดสินว่าถ้าหมดอายุระหว่างลูกค้ากรอกที่อยู่ จะต่ออายุอัตโนมัติหรือให้ขอใหม่
3. **Stock reservation**
   - จองตอน quote หรือตอน order
   - แนะนำจองตอน order เพื่อไม่ให้ quote ที่ถูกทิ้งกินสต็อก
4. **Coupon reservation**
   - แนะนำ reserve ตอน order, used ตอน confirm
   - ต้องกำหนดเวลา release เมื่อไม่จ่าย
5. **`total_price` semantics**
   - แนะนำ `total_price = grand_total` สำหรับ order ใหม่
   - ต้อง migrate report/admin พร้อมกัน
6. **Shipping address**
   - เก็บเป็น string อย่างเดียว หรือแยก `postcode`, `province`, `district`
   - แนะนำแยก field เพื่อลดการ parse ข้อความ
7. **Digital wallpaper**
   - ส่งลิงก์ตอน confirm หรือหลังชำระ
   - ต้องผูก order + สิทธิ์ดาวน์โหลด
8. **Custom product prices**
   - ต้อง sync ขึ้น Firestore ก่อน P1 จึงจะให้ server คำนวณได้
   - ต้องตัดสินว่าใช้ collection ใหม่ (`shop_products`) หรือ `settings/storefront.custom_products` ก่อน
9. **Rounding**
   - ตอนนี้ใช้ integer baht + `Math.round`
   - ถ้าอนาคตมีทศนิยม ต้องเปลี่ยนเป็น satang ทั้งระบบ
10. **React**
    - ยังไม่ทำในรอบนี้

---

## 14. Related files

| ไฟล์ | บทบาท |
|---|---|
| `public/data/pricing-engine.js` | shared engine (P0) |
| `test/pricing-engine.test.js` | engine tests (P0) |
| `pricing-config.js` | config validation/cache/publish/history/restore + trusted catalog (P1) |
| `test/pricing-cloud.test.js` | P1 config/catalog/hydration/API tests |
| `public/data/pricing-cloud.js` | storefront hydration จาก published config (P1) |
| `public/index.html` | storefront pricing/checkout/slip flow + hydration script |
| `api/[...path].js` | production API (Vercel) + transactional publish |
| `server.js` | local API — ต้อง keep parity กับ `api/[...path].js` |
| `coupon-service.js` | coupon validation / mark used |
| `public/admin/admin.js` | admin pricing/tier/shipping editors + cloud panel |
| `public/admin/index.html` | admin containers/styles รวม cloud panel |
| `public/data/patterns.js` | built-in catalog + legacy promo/shipping constants; Node export |
| `HANDOVER.md` | admin unification notes; pricing config now Cloud-backed |
| `docs/PLAN-shop-builder.md` | future shop/product plan; also requires server pricing |

---

## 15. Next step

ขั้นถัดไปที่แนะนำ: **P2 — Quote API + browser preview**

ลำดับย่อย:

1. ออกแบบ schema ของ quote doc + TTL + owner binding
2. เพิ่ม `POST /api/quotes` โดยโหลด catalog/config จาก P1
3. ให้ browser เรียก quote แทนการคำนวณยอดสุดท้ายเอง (เริ่มแบบ shadow mode)
4. log ความต่างระหว่าง browser preview กับ server quote
5. เพิ่ม rate limit / max items
6. ค่อยเปลี่ยน `/api/orders` ใน P3 เมื่อ quote นิ่งแล้ว

ก่อนเริ่ม P2 ควรตรวจสองเรื่อง:

- deploy P1 preview และกด publish config จริงจาก `/admin/` หนึ่งครั้ง
- ตรวจว่า collection products ที่ยัง local-only ต้องย้ายขึ้น Firestore หรือยอมรับว่า quote ยังไม่รองรับ
