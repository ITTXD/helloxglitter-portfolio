/**
 * Test concurrency lock for slip verification
 */
const assert = require('assert');

// Simulate the in-flight lock mechanism used in server.js & api/index.js
const inFlightSlipVerifications = new Set();
function getSlipLockKey(slipData, amount) {
  if (!slipData) return '';
  const snippet = slipData.length > 200 ? slipData.slice(-200) : slipData;
  return `${amount || 0}_${snippet}`;
}

async function simulateVerificationRequest(slipData, amount, delayMs = 50) {
  const lockKey = getSlipLockKey(slipData, amount);
  if (lockKey && inFlightSlipVerifications.has(lockKey)) {
    return { status: 429, error: 'สลิปนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่นะคะ' };
  }
  if (lockKey) inFlightSlipVerifications.add(lockKey);

  try {
    // Simulate async EasySlip network call
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { status: 200, success: true };
  } finally {
    if (lockKey) inFlightSlipVerifications.delete(lockKey);
  }
}

async function runTests() {
  console.log('========================================');
  console.log('  TEST: Concurrency & In-Flight Lock');
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

  test('getSlipLockKey creates consistent key from slip and amount', () => {
    const key1 = getSlipLockKey('data:image/png;base64,ABCDEF123456', 500);
    const key2 = getSlipLockKey('data:image/png;base64,ABCDEF123456', 500);
    assert.strictEqual(key1, key2);
    assert.strictEqual(key1, '500_data:image/png;base64,ABCDEF123456');
  });

  test('getSlipLockKey handles null or empty slipData', () => {
    assert.strictEqual(getSlipLockKey(null, 500), '');
    assert.strictEqual(getSlipLockKey('', 500), '');
  });

  await asyncTest('Sequential requests succeed without blocking', async () => {
    const res1 = await simulateVerificationRequest('slip-12345', 500, 10);
    assert.strictEqual(res1.status, 200);

    const res2 = await simulateVerificationRequest('slip-12345', 500, 10);
    assert.strictEqual(res2.status, 200);
  });

  await asyncTest('Simultaneous concurrent requests reject duplicate with 429', async () => {
    // Fire two identical requests concurrently
    const [res1, res2] = await Promise.all([
      simulateVerificationRequest('slip-duplicate-test', 990, 50),
      simulateVerificationRequest('slip-duplicate-test', 990, 50),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [200, 429], 'One should succeed (200) and the other should be rejected (429)');
  });

  await asyncTest('Different slips in parallel both succeed', async () => {
    const [resA, resB] = await Promise.all([
      simulateVerificationRequest('slip-user-A', 500, 30),
      simulateVerificationRequest('slip-user-B', 500, 30),
    ]);

    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
  });

  await asyncTest('Lock is cleaned up after request failure/error', async () => {
    async function failingRequest() {
      const lockKey = getSlipLockKey('slip-fail-test', 300);
      inFlightSlipVerifications.add(lockKey);
      try {
        throw new Error('EasySlip network crash');
      } finally {
        inFlightSlipVerifications.delete(lockKey);
      }
    }

    await assert.rejects(failingRequest, /EasySlip network crash/);
    assert.strictEqual(inFlightSlipVerifications.has(getSlipLockKey('slip-fail-test', 300)), false);
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
