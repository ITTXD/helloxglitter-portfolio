/**
 * Unit & Integration Test Suite for EasySlip v2 Verification
 */
const assert = require('assert');
const {
  cleanBase64,
  formatEasySlipErrorMessage,
  verifySlipWithEasySlip,
} = require('../slip-verify');

async function runTests() {
  console.log('========================================');
  console.log('  TEST: EasySlip v2 Verification Module');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  // ── 1. BASE64 CLEANING ──
  console.log('── 1. BASE64 CLEANING ──');
  test('cleanBase64 removes data:image/jpeg;base64, prefix', () => {
    const res = cleanBase64('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    assert.strictEqual(res, '/9j/4AAQSkZJRg==');
  });

  test('cleanBase64 removes data:image/png;base64, prefix', () => {
    const res = cleanBase64('data:image/png;base64,iVBORw0KGgo=');
    assert.strictEqual(res, 'iVBORw0KGgo=');
  });

  test('cleanBase64 returns raw base64 untouched', () => {
    const res = cleanBase64('plainBase64String123');
    assert.strictEqual(res, 'plainBase64String123');
  });

  test('cleanBase64 handles null/empty/undefined', () => {
    assert.strictEqual(cleanBase64(null), '');
    assert.strictEqual(cleanBase64(''), '');
    assert.strictEqual(cleanBase64(undefined), '');
  });

  // ── 2. ERROR MESSAGE FORMATTING ──
  console.log('\n── 2. ERROR MESSAGE TRANSLATION ──');
  test('formatEasySlipErrorMessage handles 401 unauthorized', () => {
    const msg = formatEasySlipErrorMessage(401, {}, 590);
    assert.match(msg, /EASYSLIP_API_KEY/);
  });

  test('formatEasySlipErrorMessage handles 429 quota', () => {
    const msg = formatEasySlipErrorMessage(429, {}, 590);
    assert.match(msg, /โควต้า/);
  });

  test('formatEasySlipErrorMessage translates duplicate messages', () => {
    const msg = formatEasySlipErrorMessage(400, { message: 'Duplicate transaction detected' }, 590);
    assert.match(msg, /สลิปนี้เคยถูกใช้งานไปแล้ว/);
  });

  test('formatEasySlipErrorMessage translates amount mismatch', () => {
    const msg = formatEasySlipErrorMessage(400, { message: 'matchAmount does not match slip amount' }, 590);
    assert.match(msg, /ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ/);
    assert.match(msg, /590/);
  });

  test('formatEasySlipErrorMessage translates receiver mismatch', () => {
    const msg = formatEasySlipErrorMessage(400, { message: 'Receiver account mismatch' }, 590);
    assert.match(msg, /บัญชีผู้รับเงิน/);
  });

  test('formatEasySlipErrorMessage translates unreadable QR code', () => {
    const msg = formatEasySlipErrorMessage(400, { message: 'QR Code not found in image' }, 590);
    assert.match(msg, /QR Code/);
  });

  // ── 3. VERIFY SLIP WITH EASYSLIP ──
  console.log('\n── 3. VERIFY SLIP FUNCTION ──');

  await asyncTest('verifySlipWithEasySlip fails if EASYSLIP_API_KEY is missing', async () => {
    const origKey = process.env.EASYSLIP_API_KEY;
    process.env.EASYSLIP_API_KEY = '';
    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /EASYSLIP_API_KEY/);
    process.env.EASYSLIP_API_KEY = origKey;
  });

  await asyncTest('verifySlipWithEasySlip fails on empty slip data', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const res = await verifySlipWithEasySlip({
      slipData: '',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /ไม่พบข้อมูลรูปภาพ/);
  });

  await asyncTest('verifySlipWithEasySlip handles network errors gracefully', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('Connection refused'); };

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /ไม่สามารถเชื่อมต่อ/);

    global.fetch = origFetch;
  });

  await asyncTest('verifySlipWithEasySlip returns formatted error when API returns 400', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: 400, message: 'Invalid slip image or QR not found' }),
    });

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /QR Code/);

    global.fetch = origFetch;
  });

  await asyncTest('verifySlipWithEasySlip rejects if amount does not match', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'TRANS-123456',
          date: new Date().toISOString(),
          amount: { amount: 1.00 }, // Transferred 1 baht instead of 590
          receiver: { account: { name: { th: 'ณิชกานต์' } } }
        },
      }),
    });

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /ยอดเงินในสลิป/);

    global.fetch = origFetch;
  });

  await asyncTest('verifySlipWithEasySlip succeeds with valid slip and amount', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'TRANS-VALID-999',
          date: '2026-08-16T20:30:00.000Z',
          amount: { amount: 590.00 },
          sender: {
            bank: { short: 'KBANK' },
            account: { name: { th: 'ลูกค้า ทดสอบ' } }
          },
          receiver: {
            bank: { short: 'KBANK' },
            account: { name: { th: 'ณิชกานต์' } }
          }
        },
      }),
    });

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 590,
      orderId: 'HXG-TEST-001',
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.transRef, 'TRANS-VALID-999');
    assert.strictEqual(res.amount, 590);
    assert.strictEqual(res.senderName, 'ลูกค้า ทดสอบ');
    assert.strictEqual(res.senderBank, 'KBANK');

    global.fetch = origFetch;
  });

  await asyncTest('verifySlipWithEasySlip rejects when amount is missing from slip', async () => {
    process.env.EASYSLIP_API_KEY = 'test-key';
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        data: {
          transRef: 'TRANS-NOAMOUNT',
          date: new Date().toISOString(),
          // amount is missing entirely
          sender: { bank: { short: 'SCB' }, account: { name: { th: 'ทดสอบ' } } },
          receiver: { account: { name: { th: 'ณิชกานต์' } } },
        },
      }),
    });

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mock',
      expectedAmount: 750,
      orderId: 'HXG-TEST-003',
    });
    assert.strictEqual(res.success, false);
    assert.match(res.error, /ไม่สามารถอ่านยอดเงิน/);

    global.fetch = origFetch;
  });

  // ── 4. MOCK SLIP SECURITY GATING ──
  console.log('\n── 4. MOCK SLIP SECURITY GATING ──');

  await asyncTest('verifySlipWithEasySlip does NOT bypass with mockslip when ALLOW_MOCK_SLIP is unset (even with unset NODE_ENV)', async () => {
    const origAllow = process.env.ALLOW_MOCK_SLIP;
    const origNodeEnv = process.env.NODE_ENV;
    const origKey = process.env.EASYSLIP_API_KEY;
    delete process.env.ALLOW_MOCK_SLIP;
    delete process.env.NODE_ENV;
    process.env.EASYSLIP_API_KEY = 'test-key';

    const origFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return {
        ok: false,
        status: 400,
        json: async () => ({ status: 400, message: 'Invalid slip' }),
      };
    };

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mockslip123',
      expectedAmount: 590,
      orderId: 'HXG-SECURITY-01',
    });

    // Should NOT have returned a mock bypass success; it must have called fetch
    assert.strictEqual(fetchCalled, true, 'Real fetch must be called instead of mock bypass');
    assert.strictEqual(res.success, false, 'Must not auto-approve mock slip');

    global.fetch = origFetch;
    process.env.ALLOW_MOCK_SLIP = origAllow;
    process.env.NODE_ENV = origNodeEnv;
    process.env.EASYSLIP_API_KEY = origKey;
  });

  await asyncTest('verifySlipWithEasySlip allows mockslip only when ALLOW_MOCK_SLIP=true', async () => {
    const origAllow = process.env.ALLOW_MOCK_SLIP;
    process.env.ALLOW_MOCK_SLIP = 'true';

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mockslip123',
      expectedAmount: 590,
      orderId: 'HXG-MOCK-02',
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.transRef.startsWith('MOCK-TRANS-'));
    assert.strictEqual(res.amount, 590);

    process.env.ALLOW_MOCK_SLIP = origAllow;
  });

  await asyncTest('verifySlipWithEasySlip strictly forbids mockslip in NODE_ENV=production even if ALLOW_MOCK_SLIP=true', async () => {
    const origAllow = process.env.ALLOW_MOCK_SLIP;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_MOCK_SLIP = 'true';
    process.env.NODE_ENV = 'production';

    const origFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return {
        ok: false,
        status: 400,
        json: async () => ({ status: 400, message: 'Invalid slip' }),
      };
    };

    const res = await verifySlipWithEasySlip({
      slipData: 'data:image/jpeg;base64,mockslip123',
      expectedAmount: 590,
      orderId: 'HXG-PROD-MOCK',
    });

    assert.strictEqual(fetchCalled, true, 'Fetch must be called; mock slip must not bypass in production');
    assert.strictEqual(res.success, false, 'Must not approve mock slip in production');

    global.fetch = origFetch;
    process.env.ALLOW_MOCK_SLIP = origAllow;
    process.env.NODE_ENV = origNodeEnv;
  });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
