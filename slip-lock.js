/**
 * Slip Concurrency & Deduplication Lock Service
 * Prevents race conditions during bank transfer slip verification on both local Node.js and Serverless (Vercel).
 */
const crypto = require('crypto');

// In-memory fallback stores for local testing / mock development without Firestore
const memoryLocks = new Map();
const memoryUsedTransRefs = new Map();

function cleanBase64(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return '';
  const idx = base64Str.indexOf(';base64,');
  if (idx !== -1) {
    return base64Str.slice(idx + 8);
  }
  return base64Str.trim();
}

/**
 * Generate a deterministic SHA-256 lock key based on amount and slip content
 */
function getSlipLockKey(slipData, amount) {
  if (!slipData) return '';
  const cleaned = cleanBase64(slipData);
  if (!cleaned) return '';
  const hash = crypto.createHash('sha256').update(cleaned).digest('hex');
  return `${amount || 0}_${hash}`;
}

/**
 * Acquire a distributed lock for in-flight slip verification
 * @param {object} params
 * @param {object|null} params.db - Firestore instance
 * @param {string} params.slipData - Base64 or image data
 * @param {number} params.amount - Total amount
 * @param {number} [params.ttlMs=60000] - Lock expiration in milliseconds
 * @returns {Promise<{ acquired: boolean, lockKey: string, reason?: string }>}
 */
async function acquireSlipLock({ db, slipData, amount, ttlMs = 60000 }) {
  const lockKey = getSlipLockKey(slipData, amount);
  if (!lockKey) {
    return { acquired: true, lockKey: '' };
  }

  const now = Date.now();

  // 1. Firestore mode (Serverless & Production)
  if (db) {
    try {
      const { doc, getDoc, setDoc } = require('firebase/firestore');
      const lockRef = doc(db, 'slip_locks', lockKey);
      const snap = await getDoc(lockRef);

      if (snap.exists()) {
        const data = snap.data();
        const elapsed = now - (data.created_at || 0);
        if (elapsed < ttlMs) {
          return { acquired: false, lockKey, reason: 'in_flight' };
        }
      }

      // Lock is either new or expired -> acquire it
      await setDoc(lockRef, {
        lock_key: lockKey,
        amount: Number(amount || 0),
        created_at: now,
      });

      return { acquired: true, lockKey };
    } catch (err) {
      console.warn('[SLIP-LOCK] Firestore acquire error, falling back to memory:', err.message);
    }
  }

  // 2. In-memory fallback mode (Local Dev / Tests / Firestore error)
  if (memoryLocks.has(lockKey)) {
    const lockTime = memoryLocks.get(lockKey);
    if (now - lockTime < ttlMs) {
      return { acquired: false, lockKey, reason: 'in_flight' };
    }
  }

  memoryLocks.set(lockKey, now);
  return { acquired: true, lockKey };
}

/**
 * Release an acquired slip verification lock
 */
async function releaseSlipLock({ db, lockKey }) {
  if (!lockKey) return;

  // 1. Firestore mode
  if (db) {
    try {
      const { doc, deleteDoc } = require('firebase/firestore');
      const lockRef = doc(db, 'slip_locks', lockKey);
      await deleteDoc(lockRef);
    } catch (err) {
      console.warn('[SLIP-LOCK] Firestore release error:', err.message);
    }
  }

  // 2. Memory store
  memoryLocks.delete(lockKey);
}

/**
 * Check if a bank transaction reference (transRef) has already been used across all order collections
 */
async function isTransRefUsed({ db, transRef }) {
  if (!transRef) return false;
  const cleanRef = String(transRef).trim();
  if (!cleanRef) return false;

  // 1. Firestore mode
  if (db) {
    try {
      const { doc, getDoc, collection, query, where, limit, getDocs } = require('firebase/firestore');

      // Fast primary-key lookup in used_trans_refs collection
      const docRef = doc(db, 'used_trans_refs', cleanRef);
      const snap = await getDoc(docRef);
      if (snap.exists()) return true;

      // Fallback query across legacy orders saved before used_trans_refs was introduced
      const collectionsToCheck = ['orders', 'sticker_orders', 'wallpaper_orders'];
      for (const colName of collectionsToCheck) {
        const q = query(
          collection(db, colName),
          where('slip_trans_ref', '==', cleanRef),
          limit(1)
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) return true;
      }

      return false;
    } catch (err) {
      console.error('[SLIP-LOCK] Firestore isTransRefUsed error:', err.message);
      return false;
    }
  }

  // 2. Memory store
  return memoryUsedTransRefs.has(cleanRef);
}

/**
 * Mark a bank transaction reference (transRef) as used
 */
async function markTransRefUsed({ db, transRef, orderId, orderType = 'bag', amount = 0 }) {
  if (!transRef) return;
  const cleanRef = String(transRef).trim();
  if (!cleanRef) return;

  const record = {
    trans_ref: cleanRef,
    order_id: orderId || '',
    order_type: orderType || 'bag',
    amount: Number(amount || 0),
    created_at: new Date().toISOString(),
  };

  // 1. Firestore mode
  if (db) {
    try {
      const { doc, setDoc } = require('firebase/firestore');
      await setDoc(doc(db, 'used_trans_refs', cleanRef), record);
    } catch (err) {
      console.error('[SLIP-LOCK] Firestore markTransRefUsed error:', err.message);
    }
  }

  // 2. Memory store
  memoryUsedTransRefs.set(cleanRef, record);
}

/**
 * Clear in-memory state (useful for unit testing)
 */
function _clearMemoryState() {
  memoryLocks.clear();
  memoryUsedTransRefs.clear();
}

module.exports = {
  getSlipLockKey,
  acquireSlipLock,
  releaseSlipLock,
  isTransRefUsed,
  markTransRefUsed,
  _clearMemoryState,
};
