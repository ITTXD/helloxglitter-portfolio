/**
 * coupon-service.js
 * Centralized coupon logic for helloxglitter
 * Handles:
 * 1. Coupon campaign settings (threshold, discount, expiry)
 * 2. Coupon issuance upon verified Sticker orders (tied to LINE User ID)
 * 3. Coupon validation & single-use redemption on Bag preorders
 * 4. LINE authentication / sandbox verification
 */

const DEFAULT_COUPON_CAMPAIGN = {
  id: 'coupon_campaign',
  title: 'ซื้อ Sticker รับคูปองกระเป๋า',
  threshold_amount: 300.90,
  threshold_satang: 30090,
  discount_amount: 100.00,
  discount_satang: 10000,
  earn_category: 'sticker',
  redeem_category: 'bag',
  max_uses: 1,
  expires_at: '2026-12-31T23:59:00+07:00',
  active: true,
};

// In-memory store for fallback / testing when Firestore is not configured
const inMemoryStore = {
  campaign: { ...DEFAULT_COUPON_CAMPAIGN },
  coupons: new Map(), // code -> coupon object
};

function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return 'HXG-CPN-' + rand;
}

/**
 * Get active coupon campaign configuration
 */
async function getCouponCampaign(db) {
  if (!db) {
    return { ...inMemoryStore.campaign };
  }
  try {
    const { doc, getDoc } = require('firebase/firestore');
    const docRef = doc(db, 'settings', 'coupon_campaign');
    const snap = await getDoc(docRef);
    if (snap && snap.exists && snap.exists()) {
      return { id: snap.id, ...DEFAULT_COUPON_CAMPAIGN, ...snap.data() };
    }
  } catch (err) {
    console.warn('[COUPON] Failed to get campaign from Firestore, using memory fallback:', err.message);
  }
  return { ...inMemoryStore.campaign };
}

/**
 * Save/update coupon campaign configuration (Admin only)
 */
async function saveCouponCampaign(db, data) {
  let thresholdSatang = data.thresholdSatang ?? data.threshold_satang;
  if (thresholdSatang === undefined && (data.threshold_amount !== undefined || data.thresholdAmount !== undefined)) {
    thresholdSatang = Math.round(Number(data.threshold_amount ?? data.thresholdAmount) * 100);
  } else {
    thresholdSatang = Number(thresholdSatang);
  }

  let discountSatang = data.discountSatang ?? data.discount_satang;
  if (discountSatang === undefined && (data.discount_amount !== undefined || data.discountAmount !== undefined)) {
    discountSatang = Math.round(Number(data.discount_amount ?? data.discountAmount) * 100);
  } else {
    discountSatang = Number(discountSatang);
  }

  if (!Number.isFinite(thresholdSatang) || thresholdSatang < 0) {
    throw new Error('ยอดซื้อขั้นต่ำไม่ถูกต้อง');
  }
  if (!Number.isFinite(discountSatang) || discountSatang <= 0) {
    throw new Error('มูลค่าส่วนลดไม่ถูกต้อง');
  }

  const expiresAt = data.expiresAt || data.expires_at || DEFAULT_COUPON_CAMPAIGN.expires_at;

  const campaign = {
    id: 'coupon_campaign',
    title: (data.title || DEFAULT_COUPON_CAMPAIGN.title).trim().slice(0, 90),
    threshold_satang: thresholdSatang,
    threshold_amount: Number((thresholdSatang / 100).toFixed(2)),
    discount_satang: discountSatang,
    discount_amount: Number((discountSatang / 100).toFixed(2)),
    earn_category: data.earnCategory || data.earn_category || 'sticker',
    redeem_category: data.redeemCategory || data.redeem_category || 'bag',
    max_uses: 1,
    expires_at: expiresAt,
    active: data.active !== false,
    updated_at: new Date().toISOString(),
  };

  inMemoryStore.campaign = { ...campaign };

  if (db) {
    try {
      const { doc, setDoc } = require('firebase/firestore');
      const docRef = doc(db, 'settings', 'coupon_campaign');
      await setDoc(docRef, campaign, { merge: true });
    } catch (err) {
      console.warn('[COUPON] Failed to save campaign to Firestore, saved in memory:', err.message);
    }
  }

  return campaign;
}

/**
 * Find coupon by code
 */
async function findCouponByCode(db, code) {
  if (!code) return null;
  const cleanCode = String(code).trim().toUpperCase();

  // Check memory store
  if (inMemoryStore.coupons.has(cleanCode)) {
    return { ...inMemoryStore.coupons.get(cleanCode) };
  }

  if (db) {
    try {
      const { collection, getDocs, query, where, limit } = require('firebase/firestore');
      const q = query(collection(db, 'coupons'), where('code', '==', cleanCode), limit(1));
      const snap = await getDocs(q);
      if (snap && !snap.empty) {
        const d = snap.docs[0];
        const c = { _docId: d.id, ...d.data() };
        inMemoryStore.coupons.set(cleanCode, c);
        return c;
      }
    } catch (err) {
      console.warn('[COUPON] Failed to find coupon in Firestore:', err.message);
    }
  }

  return null;
}

/**
 * Find coupons belonging to a specific LINE user ID
 */
async function findCouponsByLineUser(db, lineUserId) {
  if (!lineUserId) return [];
  const cleanId = String(lineUserId).trim();
  const results = [];

  // Query memory
  for (const c of inMemoryStore.coupons.values()) {
    if (c.line_user_id === cleanId) {
      results.push({ ...c });
    }
  }

  if (db) {
    try {
      const { collection, getDocs, query, where } = require('firebase/firestore');
      const q = query(collection(db, 'coupons'), where('line_user_id', '==', cleanId));
      const snap = await getDocs(q);
      if (snap && snap.docs) {
        snap.forEach(d => {
          const item = { _docId: d.id, ...d.data() };
          if (!results.some(r => r.code === item.code)) {
            results.push(item);
            inMemoryStore.coupons.set(item.code, item);
          }
        });
      }
    } catch (err) {
      console.warn('[COUPON] Failed to query coupons from Firestore:', err.message);
    }
  }

  // Check expired status dynamically
  const now = new Date();
  return results.map(c => {
    if (c.status === 'active' && c.expires_at && new Date(c.expires_at) < now) {
      return { ...c, status: 'expired' };
    }
    return c;
  }).sort((a, b) => new Date(b.earned_at || 0) - new Date(a.earned_at || 0));
}

/**
 * Issue a single-use coupon for a qualifying Sticker order
 */
async function issueCouponForStickerOrder({ db, orderId, lineUserId, lineDisplayName, linePictureUrl }) {
  if (!orderId) throw new Error('orderId is required');

  const campaign = await getCouponCampaign(db);
  if (!campaign.active) {
    return null;
  }

  // Idempotency: Check if a coupon was already earned from this order
  for (const c of inMemoryStore.coupons.values()) {
    if (c.earned_from_order_id === orderId) {
      return c; // already issued
    }
  }

  if (db) {
    try {
      const { collection, getDocs, query, where, limit } = require('firebase/firestore');
      const q = query(collection(db, 'coupons'), where('earned_from_order_id', '==', orderId), limit(1));
      const snap = await getDocs(q);
      if (snap && !snap.empty) {
        const d = snap.docs[0];
        const existing = { _docId: d.id, ...d.data() };
        inMemoryStore.coupons.set(existing.code, existing);
        return existing;
      }
    } catch (err) {
      console.warn('[COUPON] Failed to check existing coupon in Firestore:', err.message);
    }
  }

  const code = generateCouponCode();
  const coupon = {
    code: code,
    campaign_id: campaign.id,
    title: campaign.title,
    line_user_id: lineUserId ? String(lineUserId).trim() : null,
    line_display_name: lineDisplayName ? String(lineDisplayName).trim() : 'ลูกค้า LINE',
    line_picture_url: linePictureUrl || '',
    discount_amount: campaign.discount_amount,
    discount_satang: campaign.discount_satang,
    redeem_category: campaign.redeem_category || 'bag',
    status: 'active',
    earned_from_order_id: orderId,
    earned_at: new Date().toISOString(),
    expires_at: campaign.expires_at,
    used_in_order_id: null,
    used_at: null,
  };

  inMemoryStore.coupons.set(code, coupon);

  if (db) {
    try {
      const { collection, addDoc } = require('firebase/firestore');
      const ref = await addDoc(collection(db, 'coupons'), coupon);
      coupon._docId = ref.id;
    } catch (err) {
      console.warn('[COUPON] Failed to save coupon in Firestore, kept in memory:', err.message);
    }
  }

  return coupon;
}

/**
 * Validate a coupon for checkout
 */
async function validateCouponForCheckout({ db, code, lineUserId, items, subtotal }) {
  if (!code) {
    return { valid: false, error: 'กรุณาระบุรหัสคูปอง' };
  }

  const coupon = await findCouponByCode(db, code);
  if (!coupon) {
    return { valid: false, error: 'ไม่พบคูปองนี้ในระบบ' };
  }

  // Check ownership if coupon is tied to a specific LINE account
  if (coupon.line_user_id) {
    if (!lineUserId || String(lineUserId).trim() !== coupon.line_user_id) {
      return { valid: false, error: 'คูปองนี้ผูกกับบัญชี LINE อื่น ไม่สามารถใช้ได้ค่ะ' };
    }
  }

  // Check status
  if (coupon.status === 'used') {
    return { valid: false, error: 'คูปองนี้ถูกใช้ไปแล้วค่ะ' };
  }

  // Check expiry
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { valid: false, error: 'คูปองนี้หมดอายุการใช้งานแล้วค่ะ' };
  }

  // Check eligible category
  if (coupon.redeem_category && coupon.redeem_category !== 'all') {
    const hasCategory = Array.isArray(items) && items.some(item => {
      let type = '';
      let name = '';
      if (typeof item === 'string') {
        name = item.toLowerCase();
      } else if (item && typeof item === 'object') {
        type = (item.type || item.category || '').toLowerCase();
        name = (item.name || item.title || '').toLowerCase();
      }
      
      if (coupon.redeem_category === 'bag') {
        return type === 'bag' || (!type && !name.includes('sticker') && !name.includes('wallpaper'));
      }
      if (coupon.redeem_category === 'sticker') {
        return type === 'sticker' || name.includes('sticker') || name.includes('สติ๊กเกอร์') || name.includes('สติกเกอร์');
      }
      if (coupon.redeem_category === 'wallpaper') {
        return type === 'wallpaper' || name.includes('wallpaper') || name.includes('วอลเปเปอร์');
      }
      return false;
    });

    if (!hasCategory && items && items.length > 0) {
      const categoryNames = {
        'bag': 'กระเป๋าผ้า',
        'sticker': 'สติกเกอร์',
        'wallpaper': 'วอลเปเปอร์'
      };
      const catName = categoryNames[coupon.redeem_category] || coupon.redeem_category;
      return { valid: false, error: `คูปองนี้ใช้ได้เฉพาะสินค้าหมวด${catName}เท่านั้นค่ะ` };
    }
  }

  const discountAmount = Math.min(Number(coupon.discount_amount) || 0, Math.max(0, Number(subtotal) || 0));

  return {
    valid: true,
    coupon: coupon,
    discount_amount: discountAmount,
    discount_satang: discountAmount * 100,
  };
}

/**
 * Mark coupon as used in an order (Single-use lock)
 */
async function markCouponAsUsed(db, code, orderId) {
  const coupon = await findCouponByCode(db, code);
  if (!coupon) {
    throw new Error('Coupon not found');
  }

  coupon.status = 'used';
  coupon.used_in_order_id = orderId;
  coupon.used_at = new Date().toISOString();

  inMemoryStore.coupons.set(coupon.code, coupon);

  if (db) {
    try {
      const { doc, updateDoc, collection, getDocs, query, where, limit } = require('firebase/firestore');
      let docId = coupon._docId;
      if (!docId) {
        const q = query(collection(db, 'coupons'), where('code', '==', coupon.code), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) docId = snap.docs[0].id;
      }
      if (docId) {
        await updateDoc(doc(db, 'coupons', docId), {
          status: 'used',
          used_in_order_id: orderId,
          used_at: coupon.used_at,
        });
      }
    } catch (err) {
      console.warn('[COUPON] Failed to update coupon in Firestore:', err.message);
    }
  }

  return coupon;
}

/**
 * Verify or mock LINE User session
 */
function parseLineUserFromRequest(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });

  if (cookies.line_user_id) {
    return {
      line_user_id: cookies.line_user_id,
      line_display_name: cookies.line_display_name || 'ลูกค้า LINE',
      line_picture_url: cookies.line_picture_url || '',
    };
  }
  return null;
}

module.exports = {
  DEFAULT_COUPON_CAMPAIGN,
  inMemoryStore,
  generateCouponCode,
  getCouponCampaign,
  saveCouponCampaign,
  findCouponByCode,
  findCouponsByLineUser,
  issueCouponForStickerOrder,
  validateCouponForCheckout,
  markCouponAsUsed,
  parseLineUserFromRequest,
};
