require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const { verifySlipWithEasySlip } = require('./slip-verify');
const {
  DEFAULT_COUPON_CAMPAIGN,
  getCouponCampaign,
  saveCouponCampaign,
  findCouponByCode,
  findCouponsByLineUser,
  issueCouponForStickerOrder,
  validateCouponForCheckout,
  markCouponAsUsed,
  parseLineUserFromRequest,
} = require('./coupon-service');
const { sendCouponFlexMessage, sendOrderReceiptFlexMessage } = require('./line-service');

// In-flight slip verification lock set to prevent concurrent duplicate calls to EasySlip
const inFlightSlipVerifications = new Set();
function getSlipLockKey(slipData, amount) {
  if (!slipData) return '';
  const snippet = slipData.length > 200 ? slipData.slice(-200) : slipData;
  return `${amount || 0}_${snippet}`;
}

// ==================== FIREBASE INIT ====================
let db = null;
if (process.env.FIREBASE_PROJECT_ID) {
  try {
    const { initializeApp } = require('firebase/app');
    const { getFirestore } = require('firebase/firestore');

    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    };

    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    console.log('Firebase connected, project:', process.env.FIREBASE_PROJECT_ID);
  } catch (err) {
    console.warn('Firebase init failed:', err.message);
    console.warn('Server will start but Firestore API calls will fail.');
  }
} else {
  console.log('No FIREBASE_PROJECT_ID configured — running with local in-memory fallback.');
}

// ==================== FIRESTORE HELPERS (WITH MEMORY FALLBACK) ====================
const localMemStore = {
  orders: [],
  settings: {},
  coupons: []
};

async function fsAddDoc(collectionName, data) {
  if (!db) {
    if (!localMemStore[collectionName]) localMemStore[collectionName] = [];
    const docId = data.id || ('MEM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    const record = { _docId: docId, ...data };
    localMemStore[collectionName].unshift(record);
    return { id: docId };
  }
  const { collection, addDoc } = require('firebase/firestore');
  return addDoc(collection(db, collectionName), data);
}

async function fsGetDocs(collectionName, orderField) {
  if (!db) {
    const list = (localMemStore[collectionName] || []).slice();
    if (orderField) {
      list.sort((a, b) => String(b[orderField] || '').localeCompare(String(a[orderField] || '')));
    }
    return list;
  }
  const { collection, getDocs, query, orderBy } = require('firebase/firestore');
  const q = orderField
    ? query(collection(db, collectionName), orderBy(orderField, 'desc'))
    : collection(db, collectionName);
  const snap = await getDocs(q);
  const results = [];
  snap.forEach(d => results.push({ _docId: d.id, ...d.data() }));
  return results;
}

async function fsGetDoc(collectionName, docId) {
  if (!db) {
    const list = localMemStore[collectionName] || [];
    return list.find(x => x._docId === docId || x.id === docId) || null;
  }
  const { doc, getDoc } = require('firebase/firestore');
  const d = await getDoc(doc(db, collectionName, docId));
  return d.exists() ? { _docId: d.id, ...d.data() } : null;
}

async function fsUpdateDoc(collectionName, docId, data) {
  if (!db) {
    const list = localMemStore[collectionName] || [];
    const idx = list.findIndex(x => x._docId === docId || x.id === docId);
    if (idx >= 0) Object.assign(list[idx], data);
    return;
  }
  const { doc, updateDoc } = require('firebase/firestore');
  await updateDoc(doc(db, collectionName, docId), data);
}

async function fsDeleteDoc(collectionName, docId) {
  if (!db) {
    const list = localMemStore[collectionName] || [];
    const idx = list.findIndex(x => x._docId === docId || x.id === docId);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  const { doc, deleteDoc } = require('firebase/firestore');
  await deleteDoc(doc(db, collectionName, docId));
}

async function fsFindByField(collectionName, fieldName, fieldValue) {
  if (!db) {
    const list = localMemStore[collectionName] || [];
    return list.find(x => x[fieldName] === fieldValue) || null;
  }
  const { collection, getDocs, query, where, limit } = require('firebase/firestore');
  const q = query(collection(db, collectionName), where(fieldName, '==', fieldValue), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { _docId: d.id, ...d.data() };
}

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ==================== HELPERS ====================
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const [key, ...val] = c.split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(val.join('='));
  });
  return cookies;
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return cookies.admin_session === SESSION_SECRET;
}

function generateOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  const d = new Date();
  const ds = d.getFullYear().toString()
    + ('0' + (d.getMonth() + 1)).slice(-2)
    + ('0' + d.getDate()).slice(-2);
  return 'HXG-' + ds + '-' + rand;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(body); }
    });
    req.on('error', reject);
  });
}

function extractCustomerFields(data) {
  let name = (data.customer_name || '').trim();
  let phone = (data.customer_phone || '').trim();
  let address = (data.customer_address || '').trim();
  let info = (data.customer_info || '').trim();

  if (!name && !phone && !address && info) {
    const lines = info.split('\n').map(l => l.trim()).filter(Boolean);
    if (!name && lines.length > 0) name = lines[0];
    if (!phone && lines.length > 1) phone = lines[1];
    if (!address && lines.length > 2) address = lines.slice(2).join('\n');
  }

  if (name || phone || address) {
    info = [name, phone, address].filter(Boolean).join('\n');
  }

  return {
    customer_name: name,
    customer_phone: phone,
    customer_address: address,
    customer_info: info,
  };
}

function send404(res) { sendJson(res, 404, { error: 'Not found' }); }
function send401(res) { sendJson(res, 401, { error: 'Unauthorized' }); }
function send500(res, msg) { sendJson(res, 500, { error: msg || 'Server error' }); }

// ==================== API ROUTES ====================
async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // POST /api/login
  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    if (body.password === ADMIN_PASSWORD) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `admin_session=${SESSION_SECRET}; Path=/; HttpOnly; SameSite=Strict`,
      });
      res.end(JSON.stringify({ success: true }));
    } else {
      sendJson(res, 401, { error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    return true;
  }

  // POST /api/logout
  if (pathname === '/api/logout' && method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; Path=/; HttpOnly; Max-Age=0',
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // GET /api/check-auth
  if (pathname === '/api/check-auth' && method === 'GET') {
    sendJson(res, 200, { authenticated: isAdmin(req) });
    return true;
  }

  // ==================== COUPON & LINE ROUTES ====================
  // GET /api/coupons/campaign — ดึงกติกาแคมเปญคูปองปัจจุบัน
  if (pathname === '/api/coupons/campaign' && method === 'GET') {
    const campaign = await getCouponCampaign(db);
    sendJson(res, 200, { success: true, campaign });
    return true;
  }

  // POST /api/coupons/campaign — แอดมินบันทึกกติกาคูปอง
  if (pathname === '/api/coupons/campaign' && method === 'POST') {
    const body = await readBody(req);
    const authed = isAdmin(req) || (ADMIN_PASSWORD && body.admin_password === ADMIN_PASSWORD);
    if (!authed) { send401(res); return true; }
    try {
      const campaign = await saveCouponCampaign(db, body.campaign || body);
      sendJson(res, 200, { success: true, campaign });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'บันทึกกติกาคูปองไม่สำเร็จ' });
    }
    return true;
  }

  // POST /api/auth/line/verify — ยืนยันหรือจำลองการเข้าสู่ระบบ LINE
  if (pathname === '/api/auth/line/verify' && method === 'POST') {
    const body = await readBody(req);
    const lineUserId = (body.line_user_id || body.userId || '').trim();
    const displayName = (body.line_display_name || body.displayName || 'ลูกค้า LINE').trim();
    const pictureUrl = (body.line_picture_url || body.pictureUrl || '').trim();

    if (!lineUserId) {
      sendJson(res, 400, { error: 'กรุณาระบุ LINE User ID' });
      return true;
    }

    const user = {
      line_user_id: lineUserId,
      line_display_name: displayName,
      line_picture_url: pictureUrl,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `line_user_id=${encodeURIComponent(lineUserId)}; Path=/; SameSite=Lax`,
        `line_display_name=${encodeURIComponent(displayName)}; Path=/; SameSite=Lax`,
      ],
    });
    res.end(JSON.stringify({ success: true, user }));
    return true;
  }

  // GET /api/auth/line/me — เช็คสถานะล็อกอิน LINE
  if (pathname === '/api/auth/line/me' && method === 'GET') {
    const user = parseLineUserFromRequest(req);
    sendJson(res, 200, {
      authenticated: !!user,
      user: user || null,
      liff_id: process.env.LINE_LIFF_ID || '2011786627-NobuH2ua',
      bot: {
        basic_id: process.env.LINE_BOT_BASIC_ID || '@328jnfpt',
        display_name: process.env.LINE_BOT_DISPLAY_NAME || 'ผู้ช่วยHelloxglitter',
        line_oa_url: `https://line.me/R/ti/p/${process.env.LINE_BOT_BASIC_ID || '@328jnfpt'}`,
        connected: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
      },
    });
    return true;
  }

  // POST /api/auth/line/logout — ออกจากระบบ LINE
  if (pathname === '/api/auth/line/logout' && method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        'line_user_id=; Path=/; Max-Age=0',
        'line_display_name=; Path=/; Max-Age=0',
      ],
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // GET /api/coupons/my-coupons — ดึงคูปองของลูกค้าตาม LINE User ID
  if (pathname === '/api/coupons/my-coupons' && method === 'GET') {
    const queryUser = url.searchParams ? url.searchParams.get('line_user_id') : null;
    const user = parseLineUserFromRequest(req);
    const lineUserId = queryUser || (user ? user.line_user_id : null);
    if (!lineUserId) {
      sendJson(res, 200, { success: true, coupons: [] });
      return true;
    }
    const coupons = await findCouponsByLineUser(db, lineUserId);
    sendJson(res, 200, { success: true, coupons });
    return true;
  }

  // POST /api/coupons/claim — เคลมคูปองย้อนหลังด้วยเลขออเดอร์สติกเกอร์ที่ชำระแล้ว
  if (pathname === '/api/coupons/claim' && method === 'POST') {
    const body = await readBody(req);
    const orderId = (body.order_id || '').trim();
    const lineUser = parseLineUserFromRequest(req);
    const lineUserId = (body.line_user_id || (lineUser ? lineUser.line_user_id : '')).trim();
    const displayName = body.line_display_name || (lineUser ? lineUser.line_display_name : 'ลูกค้า LINE');

    if (!orderId) { sendJson(res, 400, { error: 'กรุณาระบุเลขออเดอร์' }); return true; }
    if (!lineUserId) { sendJson(res, 400, { error: 'กรุณาเข้าสู่ระบบ LINE ก่อนเคลมคูปอง' }); return true; }

    const order = await fsFindByField('orders', 'id', orderId);
    if (!order) {
      sendJson(res, 404, { error: 'ไม่พบออเดอร์นี้ในระบบ' });
      return true;
    }
    if (order.type !== 'sticker') {
      sendJson(res, 400, { error: 'ออเดอร์นี้ไม่ใช่สินค้าหมวด Sticker' });
      return true;
    }
    if (order.status !== 1) {
      sendJson(res, 400, { error: 'ออเดอร์นี้ยังไม่ได้รับการยืนยันการชำระเงิน' });
      return true;
    }

    const campaign = await getCouponCampaign(db);
    const stickerSpend = Number(order.total_price || 0);
    if (stickerSpend < campaign.threshold_amount) {
      sendJson(res, 400, { error: `ยอดซื้อสติกเกอร์ (${stickerSpend} ฿) ไม่ถึงเกณฑ์ขั้นต่ำ ${campaign.threshold_amount} ฿` });
      return true;
    }

    const coupon = await issueCouponForStickerOrder({
      db,
      orderId,
      lineUserId,
      lineDisplayName: displayName,
    });

    sendJson(res, 200, { success: true, coupon });
    return true;
  }

  // POST /api/coupons/validate — ตรวจสอบความถูกต้องของคูปองก่อนชำระเงิน
  if (pathname === '/api/coupons/validate' && method === 'POST') {
    const body = await readBody(req);
    const code = body.code || body.coupon_code;
    const lineUser = parseLineUserFromRequest(req);
    const lineUserId = body.line_user_id || (lineUser ? lineUser.line_user_id : null);
    const subtotal = Number(body.subtotal != null ? body.subtotal : (body.subtotal_satang != null ? body.subtotal_satang / 100 : 0));
    const items = body.items || (body.category ? [{ type: body.category, price: subtotal }] : []);

    const result = await validateCouponForCheckout({
      db,
      code,
      lineUserId,
      items,
      subtotal,
    });

    if (!result.valid) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, {
      success: true,
      valid: true,
      coupon: {
        code: result.coupon.code,
        title: result.coupon.title,
        discount_amount: result.discount_amount,
        discount_satang: result.discount_satang,
        redeem_category: result.coupon.redeem_category,
        expires_at: result.coupon.expires_at,
      },
      discount_amount: result.discount_amount,
      discount_satang: result.discount_satang,
    });
    return true;
  }

  // POST /api/orders — ลูกค้าสั่งซื้อ (ไม่ต้อง auth)
  if (pathname === '/api/orders' && method === 'POST') {
    const body = await readBody(req);
    const cust = extractCustomerFields(body);
    if (!cust.customer_info || !body.patterns || body.patterns.length === 0) {
      sendJson(res, 400, { error: 'กรุณากรอกข้อมูลให้ครบ' });
      return true;
    }

    // Optional coupon redemption
    const couponCode = (body.coupon_code || '').trim();
    const lineUser = parseLineUserFromRequest(req);
    const lineUserId = (body.line_user_id || (lineUser ? lineUser.line_user_id : '')).trim();

    let couponDiscount = 0;
    let validatedCoupon = null;
    const originalPrice = Number(body.original_price || body.total_price || 0);
    const basePrice = Number(body.total_price || 0);

    if (couponCode) {
      const valResult = await validateCouponForCheckout({
        db,
        code: couponCode,
        lineUserId,
        items: body.patterns || [],
        subtotal: basePrice,
      });
      if (!valResult.valid) {
        sendJson(res, 400, { error: valResult.error });
        return true;
      }
      validatedCoupon = valResult.coupon;
      couponDiscount = valResult.discount_amount;
    }

    const finalTotalPrice = Math.max(0, basePrice - couponDiscount);
    const orderId = generateOrderId();

    const order = {
      id: orderId,
      created_at: new Date().toISOString(),
      customer_name: cust.customer_name,
      customer_phone: cust.customer_phone,
      customer_address: cust.customer_address,
      customer_info: cust.customer_info,
      line_user_id: lineUserId || null,
      patterns: body.patterns,
      pattern_qtys: body.pattern_qtys || null,
      qty: body.qty || 1,
      total_bags: body.total_bags || (body.patterns.length * (body.qty || 1)),
      original_price: originalPrice,
      total_price: finalTotalPrice,
      savings: (body.savings || 0) + couponDiscount,
      coupon_code: validatedCoupon ? validatedCoupon.code : null,
      coupon_discount: couponDiscount,
      shipping_cost: body.shipping_cost != null ? body.shipping_cost : (body.is_remote ? 40 : 0),
      is_remote: body.is_remote || false,
      status: 0,
      note: body.note || '',
      note_status: body.note ? 'on' : 'off',
      tracking_number: '',
      tracking_carrier: '',
    };

    if (validatedCoupon) {
      await markCouponAsUsed(db, validatedCoupon.code, orderId);
    }

    const docRef = await fsAddDoc('orders', order);
    order._docId = docRef.id;
    sendJson(res, 201, { success: true, order });
    return true;
  }

  // POST /api/wallpaper/order — ลูกค้าสั่งซื้อ Wallpaper (ไม่ต้อง auth)
  if (pathname === '/api/wallpaper/order' && method === 'POST') {
    const body = await readBody(req);
    if (!body.customer_info) {
      sendJson(res, 400, { error: 'กรุณากรอกข้อมูลให้ครบ' }); return true;
    }
    if (!body.slip_data) {
      sendJson(res, 400, { error: 'กรุณาแนบสลีปการโอนเงิน' }); return true;
    }
    const orderId = generateOrderId();
    const totalPrice = body.total_price || 99;

    // ตรวจสอบสลิปผ่าน EasySlip API ก่อนบันทึก Database (พร้อมกัน Request ซ้ำซ้อน)
    const lockKey = getSlipLockKey(body.slip_data, totalPrice);
    if (lockKey && inFlightSlipVerifications.has(lockKey)) {
      sendJson(res, 429, { error: 'สลิปนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่นะคะ' });
      return true;
    }
    if (lockKey) inFlightSlipVerifications.add(lockKey);

    let verifyResult;
    try {
      verifyResult = await verifySlipWithEasySlip({
        slipData: body.slip_data,
        expectedAmount: totalPrice,
        orderId: orderId,
        db: db,
      });
    } finally {
      if (lockKey) inFlightSlipVerifications.delete(lockKey);
    }

    if (!verifyResult.success) {
      sendJson(res, 400, { error: verifyResult.error || 'การตรวจสอบสลิปล้มเหลว กรุณาตรวจสอบรูปสลิปอีกครั้ง' });
      return true;
    }

    const patterns = body.patterns || ['Wallpaper'];
    const patternQtys = body.pattern_qtys || null;
    const totalBags = body.total_bags || 1;
    const order = {
      id: orderId,
      created_at: new Date().toISOString(),
      type: 'wallpaper',
      customer_info: body.email || '',
      email: body.email || '',
      patterns: patterns,
      pattern_qtys: patternQtys,
      qty: 1,
      total_bags: totalBags,
      total_price: totalPrice,
      shipping_cost: 0,
      status: 1, // Auto-approve
      note: body.note || '',
      slip_data: body.slip_data || null,
      slip_uploaded_at: body.slip_data ? new Date().toISOString() : null,
      slip_verified: true,
      slip_verified_at: new Date().toISOString(),
      slip_verify_msg: 'ตรวจสอบผ่าน EasySlip สำเร็จ',
      slip_trans_ref: verifyResult.transRef || '',
      slip_bank: verifyResult.senderBank || '',
      slip_sender_name: verifyResult.senderName || '',
      slip_receiver_name: verifyResult.receiverName || '',
      slip_amount: verifyResult.amount != null ? verifyResult.amount : null,
      download_link: null,
      tracking_number: '',
      tracking_carrier: '',
    };
    const docRef = await fsAddDoc('orders', order);
    order._docId = docRef.id;
    sendJson(res, 201, { success: true, order });
    return true;
  }

  // POST /api/wallpaper/check — ลูกค้าเช็ค email เพื่อรับ link (ไม่ต้อง auth)
  if (pathname === '/api/wallpaper/check' && method === 'POST') {
    const body = await readBody(req);
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      sendJson(res, 400, { error: 'กรุณากรอก E-mail ให้ถูกต้อง' }); return true;
    }
    const orders = await fsGetDocs('orders', 'created_at');
    const found = orders.filter(function(o) {
      if (o.type !== 'wallpaper') return false;
      var stored = (o.email || '').trim().toLowerCase();
      return stored === email;
    });
    if (found.length === 0) {
      sendJson(res, 200, { found: false, message: 'ไม่พบออเดอร์ Wallpaper สำหรับเบอร์นี้ค่ะ กรุณาตรวจสอบอีกครั้งนะคะ' });
      return true;
    }
    const confirmed = found.filter(function(o) { return o.status >= 1; });
    if (confirmed.length > 0) {
      sendJson(res, 200, {
        found: true,
      confirmed: true,
      download_link: confirmed[0].download_link || 'https://drive.google.com/drive/folders/1xhovSRun2q6O4g7S_wDKwuHuETZVk10-?usp=sharing',
      order_id: confirmed[0].id,
      message: 'ยืนยันเรียบร้อยแล้วค่ะ! 🎉',
    });
      return true;
    }
    sendJson(res, 200, {
      found: true,
      confirmed: false,
      order_id: found[0].id,
      message: 'พบออเดอร์ของคุณค่ะ แต่อยู่ระหว่างการยืนยัน กรุณารอสักครู่นะคะ 💝',
    });
    return true;
  }

  // GET /api/stickers — อ่านรายชื่อรูปและไฟล์สติกเกอร์จากโฟลเดอร์ sticker
  if (pathname === '/api/stickers' && method === 'GET') {
    try {
      const dirs = [
        path.join(__dirname, 'public', 'sticker'),
        path.join(__dirname, 'Sticker'),
        path.join(process.cwd(), 'public', 'sticker'),
        path.join(process.cwd(), 'Sticker'),
      ];
      let stickerDir = null;
      for (const d of dirs) {
        if (fs.existsSync(d)) {
          stickerDir = d;
          break;
        }
      }

      // Sync from Sticker/ to public/sticker/ if both exist
      const rootSticker = path.join(__dirname, 'Sticker');
      const pubSticker = path.join(__dirname, 'public', 'sticker');
      if (fs.existsSync(rootSticker) && fs.existsSync(pubSticker)) {
        try {
          fs.readdirSync(rootSticker).forEach(f => {
            if (!f.startsWith('.')) {
              const src = path.join(rootSticker, f);
              const dst = path.join(pubSticker, f);
              if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
            }
          });
        } catch (e) {}
      }

      const stickers = [];
      const seenNames = new Set();
      const validExts = ['.png', '.jpg', '.jpeg', '.webp'];

      if (stickerDir) {
        const files = fs.readdirSync(stickerDir);
        files.forEach(file => {
          if (file.startsWith('.')) return;
          const ext = path.extname(file).toLowerCase();
          if (!validExts.includes(ext)) return;

          let name = file.replace(/\.[a-zA-Z0-9]+$/, '');
          name = name.replace(/PNG$/i, '').trim();
          if (name === 'BlackSwan') name = 'Black Swan';
          if (name === 'Swanlake') name = 'Swan Lake';

          if (!seenNames.has(name)) {
            seenNames.add(name);
            stickers.push({
              name: name,
              filename: file,
              img: '/sticker/' + encodeURIComponent(file),
              price: 69,
            });
          }
        });
      }

      // Fallback
      if (stickers.length === 0) {
        const fallbackFiles = [
          'BlackSwan.PNG',
          'Castle purple (Alexa).PNG',
          'Castle purple (Liana)PNG.PNG',
          'Elina (Rainbow Magic).png',
          'Elina Mermaidia.PNG',
          'Nori Mermaidia.PNG',
          'Nutcracker🍬.PNG',
          'Rapunzel (Paint).PNG',
          'Rapunzel (princess).PNG',
          'SwanlakePNG.PNG',
        ];
        fallbackFiles.forEach(file => {
          let name = file.replace(/\.[a-zA-Z0-9]+$/, '').replace(/PNG$/i, '').trim();
          if (name === 'BlackSwan') name = 'Black Swan';
          if (name === 'Swanlake') name = 'Swan Lake';
          stickers.push({
            name: name,
            filename: file,
            img: '/sticker/' + encodeURIComponent(file),
            price: 69,
          });
        });
      }

      stickers.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      sendJson(res, 200, { success: true, count: stickers.length, stickers });
      return true;
    } catch (err) {
      console.error('Error reading stickers:', err);
      sendJson(res, 500, { error: 'Failed to read stickers: ' + err.message });
      return true;
    }
  }



  // POST /api/sticker/order — สร้างออเดอร์สติกเกอร์ + ตรวจสอบสลีปผ่าน EasySlip (ไม่ต้อง auth)
  if (pathname === '/api/sticker/order' && method === 'POST') {
    const body = await readBody(req);
    const orderData = body.order;
    const slipData = body.slip_data;

    if (!orderData || (!orderData.customer_info && !orderData.customer_name) || !orderData.patterns || orderData.patterns.length === 0) {
      sendJson(res, 400, { error: 'ข้อมูลออเดอร์ไม่ครบ' }); return true;
    }
    if (!slipData) {
      sendJson(res, 400, { error: 'กรุณาแนบสลีปการโอนเงิน' }); return true;
    }

    const orderId = generateOrderId();
    const totalPrice = Number(orderData.total_price || 0);
    const shippingCost = Number(orderData.shipping_cost != null ? orderData.shipping_cost : 50);
    const grandTotal = totalPrice + shippingCost;

    // ตรวจสอบสลิปผ่าน EasySlip API ก่อนบันทึก Database (พร้อมกัน Request ซ้ำซ้อน)
    const lockKey = getSlipLockKey(slipData, grandTotal);
    if (lockKey && inFlightSlipVerifications.has(lockKey)) {
      sendJson(res, 429, { error: 'สลิปนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่นะคะ' });
      return true;
    }
    if (lockKey) inFlightSlipVerifications.add(lockKey);

    let verifyResult;
    try {
      verifyResult = await verifySlipWithEasySlip({
        slipData: slipData,
        expectedAmount: grandTotal,
        orderId: orderId,
        db: db,
      });
    } finally {
      if (lockKey) inFlightSlipVerifications.delete(lockKey);
    }

    if (!verifyResult.success) {
      sendJson(res, 400, { error: verifyResult.error || 'การตรวจสอบสลิปล้มเหลว กรุณาตรวจสอบรูปสลิปอีกครั้ง' });
      return true;
    }

    // LINE User check & Coupon campaign issuance
    const lineUser = parseLineUserFromRequest(req);
    const lineUserId = (body.line_user_id || orderData.line_user_id || (lineUser ? lineUser.line_user_id : '')).trim();
    const lineDisplayName = body.line_display_name || orderData.line_display_name || (lineUser ? lineUser.line_display_name : 'ลูกค้า LINE');

    const campaign = await getCouponCampaign(db);
    let issuedCoupon = null;
    if (campaign.active && totalPrice >= campaign.threshold_amount && lineUserId) {
      try {
        issuedCoupon = await issueCouponForStickerOrder({
          db,
          orderId,
          lineUserId,
          lineDisplayName,
        });
        if (issuedCoupon && lineUserId) {
          sendCouponFlexMessage(lineUserId, issuedCoupon).catch(err => {
            console.warn('[LINE OA] Coupon push flex message error:', err.message);
          });
        }
      } catch (cErr) {
        console.warn('[COUPON] Error issuing coupon for sticker order:', cErr.message);
      }
    }

    const cust = extractCustomerFields(orderData);

    const order = {
      id: orderId,
      created_at: new Date().toISOString(),
      type: 'sticker',
      customer_name: cust.customer_name,
      customer_phone: cust.customer_phone,
      customer_address: cust.customer_address,
      customer_info: cust.customer_info,
      line_user_id: lineUserId || null,
      patterns: orderData.patterns,
      pattern_qtys: orderData.pattern_qtys || null,
      qty: orderData.qty || 1,
      total_bags: orderData.total_bags || orderData.patterns.length,
      total_price: totalPrice,
      shipping_cost: shippingCost,
      status: 1,
      coupon_issued: !!issuedCoupon,
      coupon_code: issuedCoupon ? issuedCoupon.code : null,
      coupon_eligible: !issuedCoupon && campaign.active && totalPrice >= campaign.threshold_amount,
      note: orderData.note || '',
      note_status: orderData.note ? 'on' : 'off',
      slip_data: slipData,
      slip_uploaded_at: new Date().toISOString(),
      slip_verified: true,
      slip_verified_at: new Date().toISOString(),
      slip_verify_msg: 'ตรวจสอบผ่าน EasySlip สำเร็จ',
      slip_trans_ref: verifyResult.transRef || '',
      slip_bank: verifyResult.senderBank || '',
      slip_sender_name: verifyResult.senderName || '',
      slip_receiver_name: verifyResult.receiverName || '',
      slip_amount: verifyResult.amount != null ? verifyResult.amount : null,
    };

    const docRef = await fsAddDoc('orders', order);
    order._docId = docRef.id;
    sendJson(res, 201, { success: true, order, coupon: issuedCoupon });
    return true;
  }

  // POST /api/orders/confirm — สร้างออเดอร์ + ตรวจสอบสลีปผ่าน EasySlip (ไม่ต้อง auth)
  if (pathname === '/api/orders/confirm' && method === 'POST') {
    const body = await readBody(req);
    const orderData = body.order;
    const slipData = body.slip_data;

    if (!orderData || (!orderData.customer_info && !orderData.customer_name) || !orderData.patterns || orderData.patterns.length === 0) {
      sendJson(res, 400, { error: 'ข้อมูลออเดอร์ไม่ครบ' }); return true;
    }
    if (!slipData) {
      sendJson(res, 400, { error: 'กรุณาแนบสลีปการโอนเงิน' }); return true;
    }

    const orderId = orderData.id || generateOrderId();
    const clientReportedDiscount = Number(orderData.coupon_discount || body.coupon_discount || 0);
    let basePrice = Number(orderData.original_price || 0);
    if (!basePrice) {
      if (clientReportedDiscount > 0) {
        basePrice = Number(orderData.total_price || 0) + clientReportedDiscount;
      } else {
        basePrice = Number(orderData.total_price || 0);
      }
    }
    const originalPrice = Number(orderData.original_price || basePrice);

    // Optional coupon redemption
    const couponCode = (body.coupon_code || orderData.coupon_code || '').trim();
    const lineUser = parseLineUserFromRequest(req);
    const lineUserId = (body.line_user_id || orderData.line_user_id || (lineUser ? lineUser.line_user_id : '')).trim();

    let couponDiscount = 0;
    let validatedCoupon = null;
    if (couponCode) {
      const valResult = await validateCouponForCheckout({
        db,
        code: couponCode,
        lineUserId,
        items: orderData.patterns || [],
        subtotal: basePrice,
      });
      if (!valResult.valid) {
        sendJson(res, 400, { error: valResult.error });
        return true;
      }
      validatedCoupon = valResult.coupon;
      couponDiscount = valResult.discount_amount;
    }

    const discountedPrice = Math.max(0, basePrice - couponDiscount);
    let shippingCost = orderData.shipping_cost != null ? Number(orderData.shipping_cost) : (orderData.is_remote ? 40 : 0);
    const grandTotal = discountedPrice + shippingCost;

    // ตรวจสอบสลิปผ่าน EasySlip API ก่อนบันทึก Database (พร้อมกัน Request ซ้ำซ้อน)
    const lockKey = getSlipLockKey(slipData, grandTotal);
    if (lockKey && inFlightSlipVerifications.has(lockKey)) {
      sendJson(res, 429, { error: 'สลิปนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่นะคะ' });
      return true;
    }
    if (lockKey) inFlightSlipVerifications.add(lockKey);

    let verifyResult;
    try {
      verifyResult = await verifySlipWithEasySlip({
        slipData: slipData,
        expectedAmount: grandTotal,
        orderId: orderId,
        db: db,
      });
    } finally {
      if (lockKey) inFlightSlipVerifications.delete(lockKey);
    }

    if (!verifyResult.success) {
      sendJson(res, 400, {
        error: verifyResult.error || 'การตรวจสอบสลิปล้มเหลว กรุณาตรวจสอบรูปสลิปอีกครั้ง',
        verifyDetails: verifyResult
      });
      return true;
    }

    const cust = extractCustomerFields(orderData);

    const order = {
      id: orderId,
      created_at: orderData.created_at || new Date().toISOString(),
      customer_name: cust.customer_name,
      customer_phone: cust.customer_phone,
      customer_address: cust.customer_address,
      customer_info: cust.customer_info,
      line_user_id: lineUserId || null,
      patterns: orderData.patterns,
      pattern_qtys: orderData.pattern_qtys || null,
      qty: orderData.qty || 1,
      total_bags: orderData.total_bags || orderData.patterns.length,
      original_price: originalPrice,
      total_price: discountedPrice,
      savings: (orderData.savings || 0) + couponDiscount,
      coupon_code: validatedCoupon ? validatedCoupon.code : null,
      coupon_discount: couponDiscount,
      shipping_cost: shippingCost,
      is_remote: orderData.is_remote || false,
      status: 1,
      note: orderData.note || '',
      note_status: orderData.note ? 'on' : 'off',
      slip_data: slipData,
      slip_uploaded_at: new Date().toISOString(),
      slip_verified: true,
      slip_verified_at: new Date().toISOString(),
      slip_verify_msg: 'ตรวจสอบผ่าน EasySlip สำเร็จ',
      slip_trans_ref: verifyResult.transRef || '',
      slip_bank: verifyResult.senderBank || '',
      slip_sender_name: verifyResult.senderName || '',
      slip_receiver_bank: verifyResult.receiverBank || '',
      slip_receiver_name: verifyResult.receiverName || '',
      slip_amount: verifyResult.amount != null ? verifyResult.amount : null,
      slip_date: verifyResult.date || '',
      tracking_number: '',
      tracking_carrier: '',
    };

    if (validatedCoupon) {
      await markCouponAsUsed(db, validatedCoupon.code, orderId);
    }

    if (lineUserId) {
      sendOrderReceiptFlexMessage(lineUserId, order).catch(err => {
        console.warn('[LINE OA] Order receipt push message error:', err.message);
      });
    }

    const docRef = await fsAddDoc('orders', order);
    order._docId = docRef.id;
    sendJson(res, 201, { success: true, order });
    return true;
  }

  // GET /api/orders — ดึงทุกออเดอร์ (ต้อง auth)
  if (pathname === '/api/orders' && method === 'GET') {
    if (!isAdmin(req)) { send401(res); return true; }
    const orders = await fsGetDocs('orders', 'created_at');
    try {
      const stickers = await fsGetDocs('sticker_orders');
      stickers.forEach(s => {
        if (!orders.some(o => o.id === s.id)) {
          orders.push(s);
        }
      });
    } catch (e) {}
    sendJson(res, 200, orders);
    return true;
  }

  // GET /api/orders/:id
  if (pathname.startsWith('/api/orders/') && method === 'GET') {
    if (!isAdmin(req)) { send401(res); return true; }
    const id = pathname.split('/api/orders/')[1];
    const order = await fsGetDoc('orders', id);
    if (!order) { send404(res); return true; }
    sendJson(res, 200, order);
    return true;
  }

  // PUT /api/orders/:id
  if (pathname.startsWith('/api/orders/') && method === 'PUT') {
    if (!isAdmin(req)) { send401(res); return true; }
    const id = pathname.split('/api/orders/')[1];
    const body = await readBody(req);
    var existing = await fsGetDoc('orders', id);
    var docId = id;
    if (!existing) {
      const byCustom = await fsFindByField('orders', 'id', id);
      if (byCustom) { existing = byCustom; docId = byCustom._docId; }
    }
    if (!existing) { send404(res); return true; }
    if (body.note !== undefined) {
      body.note_status = body.note ? 'on' : 'off';
    }
    if (body.customer_name !== undefined || body.customer_phone !== undefined || body.customer_address !== undefined || body.customer_info !== undefined) {
      const cust = extractCustomerFields({
        customer_name: body.customer_name !== undefined ? body.customer_name : existing.customer_name,
        customer_phone: body.customer_phone !== undefined ? body.customer_phone : existing.customer_phone,
        customer_address: body.customer_address !== undefined ? body.customer_address : existing.customer_address,
        customer_info: body.customer_info !== undefined ? body.customer_info : existing.customer_info,
      });
      body.customer_name = cust.customer_name;
      body.customer_phone = cust.customer_phone;
      body.customer_address = cust.customer_address;
      body.customer_info = cust.customer_info;
    }
    await fsUpdateDoc('orders', docId, body);
    sendJson(res, 200, { success: true });
    return true;
  }

  // DELETE /api/orders/:id
  if (pathname.startsWith('/api/orders/') && method === 'DELETE') {
    if (!isAdmin(req)) { send401(res); return true; }
    const id = pathname.split('/api/orders/')[1];
    var existing = await fsGetDoc('orders', id);
    var docId = id;
    if (!existing) {
      const byCustom = await fsFindByField('orders', 'id', id);
      if (byCustom) { existing = byCustom; docId = byCustom._docId; }
    }
    if (!existing) { send404(res); return true; }
    await fsDeleteDoc('orders', docId);
    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /api/orders/:id/slip — upload slip image (admin)
  if (pathname.startsWith('/api/orders/') && pathname.endsWith('/slip') && method === 'POST') {
    if (!isAdmin(req)) { send401(res); return true; }
    const id = pathname.split('/api/orders/')[1].replace('/slip', '');
    const body = await readBody(req);
    var existing = await fsGetDoc('orders', id);
    var docId = id;
    if (!existing) {
      const byCustom = await fsFindByField('orders', 'id', id);
      if (byCustom) { existing = byCustom; docId = byCustom._docId; }
    }
    if (!existing) { send404(res); return true; }

    if (!body.slip_data) { sendJson(res, 400, { error: 'ไม่มีข้อมูลสลีป' }); return true; }

    const updateData = {
      slip_data: body.slip_data,
      slip_uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 1,
    };

    await fsUpdateDoc('orders', docId, updateData);
    sendJson(res, 200, { success: true, verified: true, message: 'อัปโหลดสลีปสำเร็จ' });
    return true;
  }

  // POST /api/orders/:id/slip-public — customer uploads slip (no auth)
  if (pathname.startsWith('/api/orders/') && pathname.endsWith('/slip-public') && method === 'POST') {
    const id = pathname.split('/api/orders/')[1].replace('/slip-public', '');
    const body = await readBody(req);
    var existing = await fsGetDoc('orders', id);
    var docId = id;
    if (!existing) {
      const byCustom = await fsFindByField('orders', 'id', id);
      if (byCustom) { existing = byCustom; docId = byCustom._docId; }
    }
    if (!existing) { send404(res); return true; }

    if (!body.slip_data) { sendJson(res, 400, { error: 'ไม่มีข้อมูลสลีป' }); return true; }

    const updateData = {
      slip_data: body.slip_data,
      slip_uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 1,
    };

    await fsUpdateDoc('orders', docId, updateData);

    sendJson(res, 200, { success: true, verified: true, message: 'อัปโหลดสลีปสำเร็จ ยืนยันออเดอร์แล้ว!' });
    return true;
  }

  // GET /api/stats
  if (pathname === '/api/stats' && method === 'GET') {
    if (!isAdmin(req)) { send401(res); return true; }
    const orders = await fsGetDocs('orders');
    const stats = {
      total_orders: orders.length,
      total_bags: orders.reduce((s, o) => s + (o.total_bags || 0), 0),
      total_revenue: orders.reduce((s, o) => s + (o.total_price || 0) + (o.shipping_cost != null ? o.shipping_cost : 50), 0),
      total_product_price: orders.reduce((s, o) => s + (o.total_price || 0), 0),
      total_shipping: orders.reduce((s, o) => s + (o.shipping_cost != null ? o.shipping_cost : 50), 0),
      by_status: { 0: 0, 1: 0, 2: 0, 3: 0 },
    };
    orders.forEach(o => { stats.by_status[o.status] = (stats.by_status[o.status] || 0) + 1; });
    sendJson(res, 200, stats);
    return true;
  }

  // GET /api/track/phone/:phone — public, search orders by phone
  if (pathname.startsWith('/api/track/phone/') && method === 'GET') {
    const phone = pathname.split('/api/track/phone/')[1];
    if (!phone) { send404(res); return true; }
    const searchPhone = decodeURIComponent(phone).replace(/\D/g, '');
    if (!searchPhone) {
      sendJson(res, 400, { error: 'กรุณาระบุเบอร์โทรศัพท์ที่ถูกต้อง' });
      return true;
    }
    const allOrders = await fsGetDocs('orders');
    try {
      const stickers = await fsGetDocs('sticker_orders');
      stickers.forEach(s => {
        if (!allOrders.some(o => o.id === s.id)) {
          allOrders.push(s);
        }
      });
    } catch (e) {}
    const found = allOrders.filter(o => {
      // 1. Match direct customer_phone
      if (o.customer_phone) {
        var pClean = o.customer_phone.replace(/\D/g, '');
        if (pClean && (pClean === searchPhone || pClean.endsWith(searchPhone) || searchPhone.endsWith(pClean))) return true;
      }
      // 2. Regex match on customer_info
      var phoneNumbers = (o.customer_info || '').match(/0[689]\d(?:[\ \-\.]?\d){7}(?!\d)/g) || [];
      if (phoneNumbers.some(p => p.replace(/\D/g, '') === searchPhone)) return true;

      // 3. Substring match if clean customer_info contains searchPhone
      var cleanInfo = (o.customer_info || '').replace(/\D/g, '');
      if (cleanInfo.includes(searchPhone) && searchPhone.length >= 9) return true;

      return false;
    });
    if (found.length === 0) {
      sendJson(res, 404, { error: 'ไม่พบออเดอร์จากเบอร์นี้ค่ะ' });
      return true;
    }
    sendJson(res, 200, {
      orders: found.map(o => ({
        id: o.id,
        type: o.type || 'bag',
        status: o.status,
        patterns: o.patterns,
        pattern_qtys: o.pattern_qtys || null,
        qty: o.qty,
        total_bags: o.total_bags,
        total_price: o.total_price,
        created_at: o.created_at,
        note: o.note || '',
        tracking_number: o.tracking_number || '',
        tracking_carrier: o.tracking_carrier || '',
        customer_name: o.customer_name || (o.customer_info || '').split('\n')[0] || '',
        customer_phone: o.customer_phone || (o.customer_info || '').split('\n')[1] || '',
        customer_address: o.customer_address || ((o.customer_info || '').split('\n').slice(2).join('\n')) || '',
        customer_info: o.customer_info || '',
        shipping_cost: o.shipping_cost != null ? o.shipping_cost : 50,
        is_remote: o.is_remote || false,
      })),
    });
    return true;
  }

  // GET /api/track/:id — public, no auth
  if (pathname.startsWith('/api/track/') && method === 'GET') {
    const id = pathname.split('/api/track/')[1];
    if (!id) { send404(res); return true; }
    let order = await fsGetDoc('orders', id);
    if (!order) {
      const byCustom = await fsFindByField('orders', 'id', id);
      if (byCustom) order = byCustom;
    }
    if (!order) {
      try {
        order = await fsGetDoc('sticker_orders', id);
        if (!order) {
          order = await fsFindByField('sticker_orders', 'id', id);
        }
      } catch (e) {}
    }
    if (!order) {
      send404(res);
      return true;
    }
    sendJson(res, 200, {
      id: order.id,
      status: order.status,
      patterns: order.patterns,
      qty: order.qty,
      total_bags: order.total_bags,
      total_price: order.total_price,
      created_at: order.created_at,
      note: order.note || '',
      tracking_number: order.tracking_number || '',
      tracking_carrier: order.tracking_carrier || '',
    });
    return true;
  }

  return false;
}

// ==================== STATIC FILE SERVER ====================
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  urlPath = decodeURIComponent(urlPath);
  if (urlPath === '/admin' || urlPath === '/track' || urlPath === '/checklink') {
    res.writeHead(301, { 'Location': urlPath + '/' });
    res.end();
    return;
  }
  if (urlPath === '/designer' || urlPath === '/designer/') {
    const designerFile = path.join(__dirname, 'From_Designer', 'helloxglitter_v8_order_review_receipt (34).html');
    if (fs.existsSync(designerFile)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      return fs.createReadStream(designerFile).pipe(res);
    }
  }

  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // If path ends with / or has no extension, try index.html
  if (urlPath.endsWith('/') || !path.extname(urlPath)) {
    const tryIndex = path.join(filePath, 'index.html');
    if (fs.existsSync(tryIndex)) filePath = tryIndex;
  }

  if (!fs.existsSync(filePath) && urlPath.toLowerCase().startsWith('/sticker/')) {
    const fn = path.basename(urlPath);
    const trySticker = path.join(PUBLIC_DIR, 'sticker', fn);
    if (fs.existsSync(trySticker)) filePath = trySticker;
    else {
      const tryRoot = path.join(__dirname, 'Sticker', fn);
      if (fs.existsSync(tryRoot)) filePath = tryRoot;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}

// ==================== SERVER ====================
const requestHandler = async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const handled = await handleApi(req, res);
      if (!handled) send404(res);
      return;
    }
    serveStatic(req, res);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
};

if (process.env.VERCEL) {
  module.exports = requestHandler;
} else {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Server running at ${url}`);
    console.log(`Admin panel: ${url}/admin/`);
    exec(`open ${url}`);
  });
}
