/**
 * LINE Official Account & Messaging API Integration Service
 * helloxglitter Pre-order System
 */

const https = require('https');

const LINE_MESSAGING_API_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

/**
 * Send raw push message via LINE Messaging API
 * @param {string} to - LINE User ID (Uxxxxxxxxxxxx)
 * @param {Array<object>} messages - LINE Message Objects (Text, Flex, etc.)
 */
async function pushLineMessage(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log('[LINE OA] LINE_CHANNEL_ACCESS_TOKEN is not configured — skipping push notification.');
    return { success: false, skipped: true, reason: 'LINE_CHANNEL_ACCESS_TOKEN missing' };
  }

  if (!to || !to.startsWith('U')) {
    console.warn('[LINE OA] Invalid LINE User ID for push message:', to);
    return { success: false, skipped: true, reason: 'Invalid LINE user ID' };
  }

  // Real LINE User IDs are exactly 33 characters (e.g. U9ecf0dc882422942dc61eb3fe56a37a0)
  // Skip external push for mock/demo user IDs (e.g. U_LINE_TEST_1, U_E2E_...)
  if (to.startsWith('U_') || to.length < 32) {
    console.log('[LINE OA] Test/Demo LINE User ID detected — simulated push success:', to);
    return { success: true, simulated: true };
  }

  const payload = JSON.stringify({
    to: to,
    messages: Array.isArray(messages) ? messages : [messages],
  });

  return new Promise((resolve) => {
    const url = new URL(LINE_MESSAGING_API_ENDPOINT);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[LINE OA] Successfully sent push message to ${to}`);
          resolve({ success: true });
        } else {
          console.error(`[LINE OA] Failed to push message. HTTP ${res.statusCode}:`, data);
          resolve({ success: false, status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[LINE OA] Push message network error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send a cute celebratory Flex Message coupon to customer LINE chat
 * @param {string} lineUserId
 * @param {object} coupon
 * @param {string} [shopUrl]
 */
async function sendCouponFlexMessage(lineUserId, coupon, shopUrl = '') {
  if (!lineUserId) return;

  const code = coupon.code || '';
  const discount = coupon.discount_amount || 100;
  const expiry = coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString('th-TH') : 'ไม่มีวันหมดอายุ';
  const targetUrl = shopUrl || (process.env.LINE_LIFF_ID ? `https://liff.line.me/${process.env.LINE_LIFF_ID}` : 'https://helloxglitter.com');

  const flexMessage = {
    type: 'flex',
    altText: `🎉 ยินดีด้วยค่ะ! คุณได้รับคูปองส่วนลด ${discount} บาท รหัส: ${code}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFEBF3',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: '✨ HELLOXGLITTER REWARD ✨',
            weight: 'bold',
            color: '#BD4476',
            size: 'xs',
            letterSpacing: '1px',
          },
          {
            type: 'text',
            text: 'คูปองส่วนลดพิเศษ 100 บาท',
            weight: 'bold',
            size: 'xl',
            color: '#333333',
            margin: 'md',
          },
          {
            type: 'text',
            text: 'ขอบคุณที่สั่งซื้อ Sticker ครบ 300.90 บาทค่ะ ♡',
            size: 'xs',
            color: '#888888',
            margin: 'xs',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F9F9F9',
            cornerRadius: '12px',
            paddingAll: '16px',
            borderWidth: '1px',
            borderColor: '#F0D5E0',
            contents: [
              {
                type: 'text',
                text: 'รหัสคูปองของคุณ',
                size: 'xs',
                color: '#999999',
                align: 'center',
              },
              {
                type: 'text',
                text: code,
                weight: 'bold',
                size: 'xxl',
                color: '#BD4476',
                align: 'center',
                margin: 'sm',
              },
              {
                type: 'separator',
                margin: 'md',
                color: '#E0E0E0',
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: 'สิทธิ์ใช้งาน',
                    size: 'xs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: 'ลดกระเป๋าผ้า 100฿ (1 ครั้ง)',
                    size: 'xs',
                    color: '#333333',
                    weight: 'bold',
                    align: 'end',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: 'ใช้ได้ถึง',
                    size: 'xs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: expiry,
                    size: 'xs',
                    color: '#333333',
                    align: 'end',
                  },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#BD4476',
            height: 'sm',
            action: {
              type: 'uri',
              label: 'ใช้คูปองซื้อกระเป๋าผ้าทันที 🛍️',
              uri: targetUrl,
            },
          },
        ],
      },
    },
  };

  return pushLineMessage(lineUserId, [flexMessage]);
}

/**
 * Send order receipt Flex Message
 * @param {string} lineUserId
 * @param {object} order
 */
async function sendOrderReceiptFlexMessage(lineUserId, order) {
  if (!lineUserId) return;

  const total = Number(order.total_price || 0).toLocaleString('th-TH');
  const orderId = order.id || '';
  const dateStr = new Date(order.created_at || Date.now()).toLocaleDateString('th-TH');

  const flexMessage = {
    type: 'flex',
    altText: `ใบเสร็จคำสั่งซื้อ #${orderId} ยอดชำระ ${total} บาท`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '✓ ชำระเงินและตรวจสอบสลิปสำเร็จ',
            weight: 'bold',
            color: '#FFFFFF',
            size: 'md',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ใบเสร็จรับเงิน helloxglitter',
            weight: 'bold',
            size: 'lg',
            color: '#111111',
          },
          {
            type: 'text',
            text: `รหัสคำสั่งซื้อ: ${orderId}`,
            size: 'xs',
            color: '#888888',
            margin: 'xs',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: 'วันที่', size: 'xs', color: '#666666' },
              { type: 'text', text: dateStr, size: 'xs', color: '#111111', align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: 'ยอดชำระสุทธิ', size: 'sm', weight: 'bold', color: '#333333' },
              { type: 'text', text: `${total} ฿`, size: 'md', weight: 'bold', color: '#BD4476', align: 'end' },
            ],
          },
        ],
      },
    },
  };

  return pushLineMessage(lineUserId, [flexMessage]);
}

module.exports = {
  pushLineMessage,
  sendCouponFlexMessage,
  sendOrderReceiptFlexMessage,
};
