# 🧾 EasySlip Verification Tester (Node.js + Express)

โปรเจกต์ทดสอบระบบเช็คสลิปโอนเงินธนาคาร **EasySlip API (v2)** ด้วย **Node.js, Express และ Vanilla HTML/CSS/JS** สวยงาม เข้าใจง่าย พร้อมใช้งานทันที

---

## 📁 โครงสร้างโปรเจกต์
```
.
├── server.js          # Node.js Express Backend (จัดการรับไฟล์, Base64 และยิง EasySlip API)
├── index.html         # หน้าเว็บ UI สำหรับทดสอบสลิป (Drag & Drop + JSON Inspector)
├── package.json       # Node.js dependencies (express, cors, multer, dotenv)
├── .env               # ไฟล์เก็บการตั้งค่า เช่น EASYSLIP_API_KEY, PORT
├── .env.example       # ตัวอย่างไฟล์ config
└── README.md
```

---

## ⚡ เริ่มต้นใช้งานอย่างรวดเร็ว (Quick Start)

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. ตั้งค่า API Key (ไม่บังคับ - ใส่บนหน้าเว็บแทนได้)
เปิดไฟล์ `.env` แล้วใส่ EasySlip API Key:
```env
PORT=3000
EASYSLIP_API_KEY=your_easyslip_api_key_here
```

### 3. รัน Server
```bash
npm start
# หรือโหมด dev เพื่อ hot-reload
npm run dev
```

### 4. เปิดเบราว์เซอร์
เข้าไปที่: **`http://localhost:3000`**

---

## 🌟 ฟีเจอร์เด่น
- 🟢 **ไม่ต้องมี API Key ก็ลองได้**: มีปุ่ม **"ใช้โหมดจำลอง (Mock Demo)"** ให้กดดู Flow การทำงานและตัวอย่าง JSON ได้ทันที
- 🖼️ **รองรับ Upload หลากหลาย**: ลากไฟล์มาวาง (Drag & Drop), อัปโหลดไฟล์รูป หรือเลือกจากเครื่อง
- 🛡️ **ปลอดภัยด้วย Backend Proxy**: ยิงผ่าน Node.js Server ช่วยซ่อน API Key และตัดปัญหา Browser CORS 100%
- 📊 **แจกแจงข้อมูลครบถ้วน**:
  - ยอดเงินโอนจริง
  - สถานะสลิปซ้ำ (`isDuplicate`)
  - ข้อมูลผู้โอน (ธนาคาร, ชื่อบัญชี)
  - ข้อมูลผู้รับ (ธนาคาร, พร้อมเพย์/เลขบัญชี, ชื่อบัญชี)
  - วันที่และเวลาทำรายการ
  - รหัสธุรกรรม (TransRef / Payload)
  - แท็บดู **Raw JSON** สำหรับ Developer

---

## 🔌 API Endpoints ภายใน Node.js Server
- `POST /api/verify` : รับรูปสลิป (`file` multipart หรือ `base64` json) และยิงตรวจกับ EasySlip API v2
- `POST /api/mock` : จำลองผลลัพธ์การตรวจสอบสลิป
- `GET /api/status` : เช็คสถานะเซิร์ฟเวอร์และการเชื่อมต่อ `.env`
