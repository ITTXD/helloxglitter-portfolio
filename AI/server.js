require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Embedded EasySlip API Key
const DEFAULT_API_KEY = process.env.EASYSLIP_API_KEY || '';

// Multer storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    hasApiKey: Boolean(DEFAULT_API_KEY)
  });
});

// Verify slip endpoint
app.post('/api/verify', upload.single('file'), async (req, res) => {
  try {
    const apiKey = DEFAULT_API_KEY;
    const checkDuplicate = req.body.checkDuplicate === 'true' || req.body.checkDuplicate === true;

    let base64Image = req.body.base64;

    if (req.file) {
      base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    if (!base64Image) {
      return res.status(400).json({
        status: 400,
        message: 'กรุณาอัปโหลดรูปภาพสลิป'
      });
    }

    console.log(`[EasySlip] กำลังส่งสลิปไปตรวจสอบที่ EasySlip API v2 (checkDuplicate: ${checkDuplicate})...`);

    const response = await fetch('https://api.easyslip.com/v2/verify/bank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base64: base64Image,
        checkDuplicate: checkDuplicate
      })
    });

    const result = await response.json();
    console.log(`[EasySlip] Response Status: ${response.status}`, JSON.stringify(result));

    return res.status(response.status).json(result);
  } catch (error) {
    console.error('[EasySlip] Error:', error);
    return res.status(500).json({
      status: 500,
      message: 'เกิดข้อผิดพลาดในการเชื่อมต่อไปยัง EasySlip: ' + error.message,
      error: error.message
    });
  }
});

// Mock endpoint for demo testing
app.post('/api/mock', (req, res) => {
  setTimeout(() => {
    res.json({
      status: 200,
      message: "success",
      data: {
        payload: "0004000001010301402251000185934651323389020953037645802TH",
        transRef: `MOCK_${Date.now()}`,
        date: new Date().toISOString(),
        amount: {
          amount: 500.00,
          local: {
            amount: 500.00,
            currency: "THB"
          }
        },
        sender: {
          bank: {
            id: "004",
            name: "ธนาคารกสิกรไทย (KBANK)",
            short: "KBANK"
          },
          account: {
            name: {
              th: "นาย สมชาย สายเปย์",
              en: "MR. SOMCHAI SAIPAY"
            },
            bank: {
              type: "BANK_ACCOUNT",
              account: "xxx-x-x1234-x"
            }
          }
        },
        receiver: {
          bank: {
            id: "014",
            name: "ธนาคารไทยพาณิชย์ (SCB)",
            short: "SCB"
          },
          account: {
            name: {
              th: "บจก. ร้านค้าใจดี ออนไลน์",
              en: "JAIDEE ONLINE SHOP CO., LTD."
            },
            bank: {
              type: "PROMPTPAY",
              account: "081-xxx-9999"
            }
          }
        },
        isDuplicate: false
      }
    });
  }, 400);
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 EasySlip Tester Server is running on port ${PORT}!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`🔑 EasySlip API Key is automatically embedded.`);
  console.log(`======================================================\n`);
});
