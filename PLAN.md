# helloxglitter Pre-order — แผนพัฒนาหลังบ้าน

## สถาปัตยกรรม

```
preorderbags/
├── public/
│   ├── index.html              ← หน้าลูกค้า (เดิม)
│   ├── app.js                  ← แก้: สั่งซื้อผ่าน API
│   ├── style.css               ← (เดิม)
│   ├── images/                 ← (เดิม)
│   └── admin/
│       ├── index.html          ← หน้า login + dashboard หลังบ้าน
│       ├── admin.css           ← style หลังบ้าน
│       └── admin.js            ← logic หลังบ้าน
├── server.js                   ← แก้: เพิ่ม API routes + Firebase
├── .env                        ← Firebase config + admin password
├── .env.example                ← ตัวอย่าง config
├── .gitignore
├── PLAN.md                     ← ไฟล์นี้
├── package.json
└── node_modules/
```

---

## API Routes

| Route                | Method | หน้าที่                                    | Auth |
|----------------------|--------|--------------------------------------------|------|
| `POST /api/orders`   | POST   | ลูกค้าสั่งซื้อ → บันทึกลง Firestore        | ไม่ต้อง |
| `GET /api/orders`    | GET    | ดึงออเดอร์ทั้งหมด (เรียงล่าสุดก่อน)         | ต้อง |
| `GET /api/orders/:id`| GET    | ดึงออเดอร์ตัวเดียว                          | ต้อง |
| `PUT /api/orders/:id`| PUT    | แก้ไขออเดอร์ (สถานะ, ข้อมูล)                | ต้อง |
| `DELETE /api/orders/:id`| DELETE | ลบออเดอร์                               | ต้อง |
| `POST /api/login`    | POST   | เข้าสู่ระบบ → ส่ง cookie กลับ              | ไม่ต้อง |
| `POST /api/logout`   | POST   | ออกจากระบบ → ลบ cookie                    | ไม่ต้อง |
| `GET /api/stats`     | GET    | สรุปยอดขาย                                  | ต้อง |

---

## สถานะออเดอร์

| ค่า | สถานะ       | สี     |
|-----|-------------|--------|
| 0   | รอยืนยัน    | เหลือง  |
| 1   | ยืนยันแล้ว  | ฟ้า    |
| 2   | กำลังผลิต   | ม่วง   |
| 3   | จัดส่งแล้ว  | เขียว   |

---

## ข้อมูลใน Firestore

**Collection: `orders`**

```json
{
  "id": "HXG-20260614-A1B2",
  "created_at": "2026-06-14T10:30:00.000Z",
  "customer_info": "ชื่อ-นามสกุล\nเบอร์\nที่อยู่",
  "patterns": ["Merilah Pink", "Blair"],
  "qty": 2,
  "total_bags": 4,
  "total_price": 1596,
  "status": 0,
  "note": "หมายเหตุ"
}
```

---

## สิ่งที่ต้อง Setup เอง (Firebase)

1. สร้าง Firebase project ที่ [console.firebase.google.com](https://console.firebase.google.com)
2. เปิด Firestore Database
3. สร้าง Service Account key (JSON) → /download
4. สร้างไฟล์ `.env` จาก `.env.example` แล้วใส่ค่าจริง
5. รัน `npm install`

---

## Phase 1: Setup

- [x] สร้าง PLAN.md
- [ ] `npm install firebase-admin dotenv`
- [ ] สร้าง `.env.example`
- [ ] สร้าง `.gitignore`

## Phase 2: Backend (server.js)

- [ ] Firebase Admin init จาก env vars
- [ ] `POST /api/orders` — บันทึกออเดอร์ใหม่
- [ ] `GET /api/orders` — ดึงทุกออเดอร์ (ต้อง login)
- [ ] `GET /api/orders/:id` — ดึงออเดอร์ตัวเดียว
- [ ] `PUT /api/orders/:id` — แก้ไขสถานะ/ข้อมูล
- [ ] `DELETE /api/orders/:id` — ลบออเดอร์
- [ ] `POST /api/login` — เช็ครหัสผ่าน → ส่ง cookie
- [ ] `POST /api/logout` — ออกจากระบบ
- [ ] `GET /api/stats` — สรุปยอดขาย

## Phase 3: แก้หน้าลูกค้า

- [ ] แก้ `app.js` — `doSubmit()` ส่ง POST ไป `/api/orders`
- [ ] แก้ tracking — ดึงข้อมูลจาก API

## Phase 4: หน้าหลังบ้าน

- [ ] สร้าง `public/admin/index.html` — login + dashboard
- [ ] สร้าง `public/admin/admin.css`
- [ ] สร้าง `public/admin/admin.js`
