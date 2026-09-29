/**
 * Automated Test: LINE Official Account Messaging & LIFF Integration
 * Run with: node test/line-oa.test.js
 */

const assert = require('assert');
const lineService = require('../line-service');

async function runLineTests() {
  console.log('\n========================================');
  console.log('  TEST: LINE Official Account Integration');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Missing Token Handling
  await test('pushLineMessage skips gracefully when token is missing', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const res = await lineService.pushLineMessage('U1234567890abcdef', { type: 'text', text: 'hello' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.reason, 'LINE_CHANNEL_ACCESS_TOKEN missing');
  });

  // 2. Invalid User ID Format
  await test('pushLineMessage rejects invalid LINE User ID', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const res = await lineService.pushLineMessage('INVALID_ID', { type: 'text', text: 'hello' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.reason, 'Invalid LINE user ID');
  });

  // 3. Flex Coupon Template Generation
  await test('sendCouponFlexMessage builds correct Flex Message payload', async () => {
    let capturedPayload = null;
    const https = require('https');
    const origRequest = https.request;

    https.request = (url, opts, callback) => {
      return {
        write: (data) => { capturedPayload = JSON.parse(data); },
        end: () => {
          callback({
            statusCode: 200,
            on: (event, handler) => {
              if (event === 'end') handler();
            }
          });
        },
        on: () => {}
      };
    };

    try {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-access-token';
      const mockCoupon = {
        code: 'HXG-CPN-TEST99',
        discount_amount: 100,
        expires_at: '2026-12-31T23:59:00Z'
      };

      const res = await lineService.sendCouponFlexMessage('U12345678901234567890123456789012', mockCoupon);
      assert.strictEqual(res.success, true);
      assert(capturedPayload, 'Payload must be sent');
      assert.strictEqual(capturedPayload.to, 'U12345678901234567890123456789012');
      assert.strictEqual(capturedPayload.messages[0].type, 'flex');
      assert(capturedPayload.messages[0].altText.includes('HXG-CPN-TEST99'));
      assert.strictEqual(capturedPayload.messages[0].contents.body.contents[0].contents[1].text, 'HXG-CPN-TEST99');
    } finally {
      https.request = origRequest;
    }
  });

  // 4. Order Receipt Template Generation
  await test('sendOrderReceiptFlexMessage builds correct receipt payload', async () => {
    let capturedPayload = null;
    const https = require('https');
    const origRequest = https.request;

    https.request = (url, opts, callback) => {
      return {
        write: (data) => { capturedPayload = JSON.parse(data); },
        end: () => {
          callback({
            statusCode: 200,
            on: (event, handler) => {
              if (event === 'end') handler();
            }
          });
        },
        on: () => {}
      };
    };

    try {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'mock-access-token';
      const mockOrder = {
        id: 'HXG-2026-9999',
        total_price: 199,
        created_at: new Date().toISOString()
      };

      const res = await lineService.sendOrderReceiptFlexMessage('U12345678901234567890123456789012', mockOrder);
      assert.strictEqual(res.success, true);
      assert(capturedPayload, 'Payload must be sent');
      assert.strictEqual(capturedPayload.to, 'U12345678901234567890123456789012');
      assert(capturedPayload.messages[0].altText.includes('HXG-2026-9999'));
    } finally {
      https.request = origRequest;
    }
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runLineTests().catch(err => {
  console.error('Fatal error during LINE tests:', err);
  process.exit(1);
});
