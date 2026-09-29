/**
 * EasySlip API v2 Verification Module
 * Validates bank transfer slips against EasySlip API and checks for duplicates in Firestore.
 */

function cleanBase64(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return '';
  const idx = base64Str.indexOf(';base64,');
  if (idx !== -1) {
    return base64Str.slice(idx + 8);
  }
  return base64Str.trim();
}

/**
 * Check if the transaction reference already exists in Firestore
 * @param {object} db - Firestore instance
 * @param {string} transRef - Bank transaction reference ID
 */
async function checkDuplicateTransRef(db, transRef) {
  if (!db || !transRef) return false;
  try {
    const { collection, getDocs, query, where, limit } = require('firebase/firestore');

    // 1. Check in 'orders' collection
    const q1 = query(
      collection(db, 'orders'),
      where('slip_trans_ref', '==', transRef),
      limit(1)
    );
    const snap1 = await getDocs(q1);
    if (!snap1.empty) return true;

    // 2. Check in 'sticker_orders' collection
    const q2 = query(
      collection(db, 'sticker_orders'),
      where('slip_trans_ref', '==', transRef),
      limit(1)
    );
    const snap2 = await getDocs(q2);
    if (!snap2.empty) return true;

    return false;
  } catch (err) {
    console.error('[SLIP] Duplicate check error:', err.message);
    return false;
  }
}

function extractAmountFromData(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string' && !isNaN(Number(obj)) && Number(obj) > 0) return Number(obj);

  const keys = ['amount', 'amountInSlip', 'totalAmount', 'total', 'grandTotal', 'paidAmount', 'value'];
  for (const k of keys) {
    if (obj[k] != null) {
      if (typeof obj[k] === 'number') return obj[k];
      if (typeof obj[k] === 'string' && !isNaN(Number(obj[k]))) return Number(obj[k]);
      if (typeof obj[k] === 'object') {
        if (obj[k].amount != null && !isNaN(Number(obj[k].amount))) return Number(obj[k].amount);
        if (obj[k].value != null && !isNaN(Number(obj[k].value))) return Number(obj[k].value);
        if (obj[k].local && obj[k].local.amount != null && !isNaN(Number(obj[k].local.amount))) return Number(obj[k].local.amount);
      }
    }
  }

  if (obj.data) {
    const res = extractAmountFromData(obj.data);
    if (res != null) return res;
  }
  if (obj.rawSlip) {
    const res = extractAmountFromData(obj.rawSlip);
    if (res != null) return res;
  }

  // Fallback: check EMVCo QR code string tag 54 (transaction amount)
  const payloadStr = obj.payload || (obj.data && obj.data.payload);
  if (payloadStr && typeof payloadStr === 'string') {
    const tag54Idx = payloadStr.indexOf('54');
    if (tag54Idx !== -1 && tag54Idx + 4 < payloadStr.length) {
      const len = parseInt(payloadStr.substr(tag54Idx + 2, 2), 10);
      if (!isNaN(len) && len > 0 && tag54Idx + 4 + len <= payloadStr.length) {
        const valStr = payloadStr.substr(tag54Idx + 4, len);
        const val = parseFloat(valStr);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }

  return null;
}

function extractSenderReceiverInfo(json) {
  const slip = (json && json.data && json.data.rawSlip) || (json && json.rawSlip) || (json && json.data) || json || {};
  const senderObj = slip.sender || (json && json.sender) || {};
  const receiverObj = slip.receiver || (json && json.receiver) || {};

  function parseEntity(ent) {
    if (!ent) return { bank: '', name: '', account: '' };
    let bank = '';
    if (ent.bank) {
      if (typeof ent.bank === 'string') bank = ent.bank;
      else bank = ent.bank.name || ent.bank.short || ent.bank.id || '';
    }
    let name = '';
    if (ent.account && ent.account.name) {
      if (typeof ent.account.name === 'string') name = ent.account.name;
      else name = ent.account.name.th || ent.account.name.en || '';
    } else if (ent.name) {
      if (typeof ent.name === 'string') name = ent.name;
      else name = ent.name.th || ent.name.en || '';
    } else if (typeof ent === 'string') {
      name = ent;
    }
    let account = '';
    if (ent.account) {
      if (ent.account.bank && ent.account.bank.account) account = ent.account.bank.account;
      else if (ent.account.account) account = ent.account.account;
    }
    return { bank, name, account };
  }

  return {
    sender: parseEntity(senderObj),
    receiver: parseEntity(receiverObj)
  };
}

/**
 * Friendly error message translation for EasySlip responses
 */
function formatEasySlipErrorMessage(status, data, expectedAmount) {
  if (status === 401) {
    return 'EasySlip API Key ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า EASYSLIP_API_KEY';
  }
  if (status === 429) {
    return 'เกินโควต้าการตรวจสอบสลิป กรุณาติดต่อผู้ดูแลระบบ';
  }

  let rawMsg = '';
  if (data) {
    if (data.error && typeof data.error.message === 'string') rawMsg = data.error.message;
    else if (data.error && typeof data.error === 'string') rawMsg = data.error;
    else if (typeof data.message === 'string') rawMsg = data.message;
    else if (typeof data === 'string') rawMsg = data;
    else if (data.message && typeof data.message === 'object') rawMsg = JSON.stringify(data.message);
    else if (data.error && typeof data.error === 'object') rawMsg = JSON.stringify(data.error);
  }
  const lowerMsg = String(rawMsg || '').toLowerCase();

  if (lowerMsg.includes('duplicate') || lowerMsg.includes('already verified') || lowerMsg.includes('ซ้ำ')) {
    return 'สลิปนี้เคยถูกใช้งานไปแล้วค่ะ กรุณาใช้สลีปใหม่';
  }
  if (lowerMsg.includes('amount') || lowerMsg.includes('ยอดเงิน')) {
    return expectedAmount != null
      ? `ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ (${Number(expectedAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿)`
      : 'ยอดเงินในสลิปไม่ตรงกับยอดสั่งซื้อค่ะ';
  }
  if (lowerMsg.includes('receiver') || lowerMsg.includes('account') || lowerMsg.includes('บัญชี')) {
    return 'บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของทางร้านค่ะ';
  }
  if (lowerMsg.includes('not found') || lowerMsg.includes('qr') || lowerMsg.includes('invalid') || lowerMsg.includes('decode') || lowerMsg.includes('read') || lowerMsg.includes('unable')) {
    return 'ไม่สามารถอ่านข้อมูล QR Code ในสลิปได้ กรุณาใช้รูปสลิปที่มี QR Code ชัดเจนค่ะ';
  }

  return rawMsg || 'การตรวจสอบสลิปไม่ผ่าน กรุณาตรวจสอบรูปสลิปอีกครั้งค่ะ';
}

/**
 * Verify slip with EasySlip API v2
 * @param {object} params
 * @param {string} params.slipData - Base64 image or data URL of the slip
 * @param {number} params.expectedAmount - Total amount expected for the order
 * @param {string} params.orderId - Order reference code
 * @param {object} [params.db] - Firestore instance for duplicate checking
 * @returns {Promise<{ success: boolean, error?: string, slipData?: object }>}
 */
async function verifySlipWithEasySlip({ slipData, expectedAmount, orderId, db }) {
  // Support mock slips for automated testing and local dev when enabled or in non-production
  if (
    process.env.ALLOW_MOCK_SLIP === 'true' ||
    process.env.ALLOW_MOCK_SLIP === '1' ||
    (process.env.NODE_ENV !== 'production' && typeof slipData === 'string' && (slipData.includes('mockslip') || slipData.includes('MOCK_SLIP')))
  ) {
    const mockAmount = expectedAmount != null ? Number(expectedAmount) : 0;
    return {
      success: true,
      transRef: 'MOCK-TRANS-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      amount: mockAmount,
      expectedAmount: mockAmount,
      date: new Date().toISOString(),
      senderBank: 'KBANK',
      senderName: 'ลูกค้า ทดสอบ',
      senderAccount: 'xxx-x-x1234-x',
      receiverBank: 'KBANK',
      receiverName: 'ณิชกานต์',
      receiverAccount: 'xxx-x-x5678-x',
      isDuplicate: false,
      raw: { mock: true },
    };
  }

  const apiKey = process.env.EASYSLIP_API_KEY !== undefined ? process.env.EASYSLIP_API_KEY : '';
  if (!apiKey) {
    console.error('[SLIP] EASYSLIP_API_KEY is not set in environment');
    return {
      success: false,
      error: 'ระบบตรวจสอบสลิปยังไม่ได้ตั้งค่า EASYSLIP_API_KEY กรุณาติดต่อผู้ดูแลระบบ',
    };
  }

  const rawBase64 = cleanBase64(slipData);
  if (!rawBase64) {
    return {
      success: false,
      error: 'ไม่พบข้อมูลรูปภาพสลีป กรุณาอัปโหลดสลีปใหม่อีกครั้งค่ะ',
    };
  }

  const payload = {
    base64: rawBase64,
    checkDuplicate: true,
  };

  if (expectedAmount != null && expectedAmount > 0) {
    payload.matchAmount = Number(expectedAmount);
  }

  let response;
  let json;
  try {
    response = await fetch('https://api.easyslip.com/v2/verify/bank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    json = await response.json().catch(() => ({}));
    console.log('\n================== [EASYSLIP API RESPONSE] ==================');
    console.log(`HTTP Status: ${response.status}`);
    console.log(JSON.stringify(json, null, 2));
    console.log('=============================================================\n');
  } catch (netErr) {
    console.error('[SLIP] EasySlip API connection error:', netErr.message);
    return {
      success: false,
      error: 'ไม่สามารถเชื่อมต่อกับระบบตรวจสอบสลิปได้ กรุณาลองใหม่อีกครั้ง (' + netErr.message + ')',
    };
  }

  // EasySlip responds with HTTP 200 on success
  if (!response.ok || (json && json.status && json.status !== 200 && json.status !== '200')) {
    const errorMsg = formatEasySlipErrorMessage(response.status, json, expectedAmount);
    return {
      success: false,
      error: errorMsg,
      raw: json,
    };
  }

  const slipResult = json.data || json || {};
  const transRef = slipResult.transRef || slipResult.transactionRef || slipResult.ref || '';

  // Extract amount with universal extractor
  const actualAmount = extractAmountFromData(json);

  const { sender: sInfo, receiver: rInfo } = extractSenderReceiverInfo(json);
  const senderBank = sInfo.bank;
  const senderName = sInfo.name;
  const senderAccount = sInfo.account;

  const receiverBank = rInfo.bank;
  const receiverName = rInfo.name;
  const receiverAccount = rInfo.account;

  // 1. Check for duplicate in EasySlip or in our own Firestore database
  let isLocalDuplicate = false;
  if (transRef && db) {
    isLocalDuplicate = await checkDuplicateTransRef(db, transRef);
  }
  const isDuplicate = isLocalDuplicate || slipResult.isDuplicate === true || json.isDuplicate === true || (json.data && json.data.isDuplicate === true);

  if (isDuplicate) {
    return {
      success: false,
      error: 'สลิปนี้เคยถูกใช้งานไปแล้วค่ะ (ตรวจพบสลิปซ้ำ) กรุณาใช้สลีปใหม่',
      transRef: transRef,
      amount: actualAmount,
      expectedAmount: expectedAmount,
      date: slipResult.date || slipResult.dateTime || new Date().toISOString(),
      senderBank: senderBank,
      senderName: senderName,
      senderAccount: senderAccount,
      receiverBank: receiverBank,
      receiverName: receiverName,
      receiverAccount: receiverAccount,
      isDuplicate: true,
      raw: slipResult,
    };
  }

  // 2. Check Receiver Name
  if (receiverName) {
    const rName = receiverName.toLowerCase();
    const isMatch = rName.includes('ณิชกานต์') || rName.includes('นิชากานต์') || rName.includes('เอติญัติ');
    if (!isMatch) {
      return {
        success: false,
        error: `ชื่อผู้รับเงินไม่ตรงกับบัญชีของทางร้านค่ะ (พบชื่อ: ${receiverName})`,
        transRef: transRef,
        amount: actualAmount,
        expectedAmount: expectedAmount,
        date: slipResult.date || slipResult.dateTime || new Date().toISOString(),
        senderBank: senderBank,
        senderName: senderName,
        senderAccount: senderAccount,
        receiverBank: receiverBank,
        receiverName: receiverName,
        receiverAccount: receiverAccount,
        isDuplicate: isDuplicate,
        raw: slipResult,
      };
    }
  }

  // 3. Double check amount match on our end
  if (expectedAmount != null && expectedAmount > 0) {
    if (actualAmount == null || isNaN(actualAmount)) {
      return {
        success: false,
        error: 'ไม่สามารถอ่านยอดเงินจากสลิปได้ กรุณาใช้รูปสลิปที่ชัดเจนกว่านี้ค่ะ',
        transRef: transRef,
        amount: null,
        expectedAmount: expectedAmount,
        date: slipResult.date || slipResult.dateTime || new Date().toISOString(),
        senderBank: senderBank,
        senderName: senderName,
        senderAccount: senderAccount,
        receiverBank: receiverBank,
        receiverName: receiverName,
        receiverAccount: receiverAccount,
        isDuplicate: isDuplicate,
        raw: slipResult,
      };
    }
    if (Math.abs(actualAmount - Number(expectedAmount)) > 0.01) {
      return {
        success: false,
        error: `ยอดเงินในสลิป (${actualAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿) ไม่ตรงกับยอดสั่งซื้อ (${Number(expectedAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿)`,
        transRef: transRef,
        amount: actualAmount,
        expectedAmount: expectedAmount,
        date: slipResult.date || slipResult.dateTime || new Date().toISOString(),
        senderBank: senderBank,
        senderName: senderName,
        senderAccount: senderAccount,
        receiverBank: receiverBank,
        receiverName: receiverName,
        receiverAccount: receiverAccount,
        isDuplicate: isDuplicate,
        raw: slipResult,
      };
    }
  }

  return {
    success: true,
    transRef: transRef,
    amount: actualAmount,
    expectedAmount: expectedAmount,
    date: slipResult.date || slipResult.dateTime || new Date().toISOString(),
    senderBank: senderBank,
    senderName: senderName,
    senderAccount: senderAccount,
    receiverBank: receiverBank,
    receiverName: receiverName,
    receiverAccount: receiverAccount,
    isDuplicate: false,
    raw: slipResult,
  };
}

module.exports = {
  cleanBase64,
  checkDuplicateTransRef,
  formatEasySlipErrorMessage,
  verifySlipWithEasySlip,
};
