/**
 * Test concurrency lock & deduplication for slip verification
 */
const assert = require('assert');
const {
  getSlipLockKey,
  acquireSlipLock,
  releaseSlipLock,
  isTransRefUsed,
  markTransRefUsed,
  _clearMemoryState,
} = require('../slip-lock');

async function simulateVerificationRequest(slipData, amount, delayMs = 50, db = null) {
  const lockRes = await acquireSlipLock({ db, slipData, amount });
  if (!lockRes.acquired) {
    return { status: 429, error: 'สลิปนี้กำลังอยู่ระหว่างการตรวจสอบ กรุณารอสักครู่นะคะ' };
  }

  try {
    // Simulate async EasySlip network call
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { status: 200, success: true, lockKey: lockRes.lockKey };
  } finally {
    await releaseSlipLock({ db, lockKey: lockRes.lockKey });
  }
}

async function runTests() {
  console.log('========================================');
  console.log('  TEST: Concurrency & In-Flight Lock (slip-lock.js)');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    _clearMemoryState();
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
    _clearMemoryState();
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  test('getSlipLockKey creates consistent SHA-256 key from slip and amount', () => {
    const key1 = getSlipLockKey('data:image/png;base64,ABCDEF123456', 500);
    const key2 = getSlipLockKey('data:image/png;base64,ABCDEF123456', 500);
    assert.strictEqual(key1, key2);
    assert.strictEqual(typeof key1, 'string');
    assert.match(key1, /^500_[a-f0-9]{64}$/);
  });

  test('getSlipLockKey strips base64 data URL prefix correctly', () => {
    const keyWithPrefix = getSlipLockKey('data:image/jpeg;base64,QUJDREVGMTIzNDU2', 790);
    const keyRaw = getSlipLockKey('QUJDREVGMTIzNDU2', 790);
    assert.strictEqual(keyWithPrefix, keyRaw);
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
    const lockRes = await acquireSlipLock({ db: null, slipData: 'slip-fail-test', amount: 300 });
    assert.strictEqual(lockRes.acquired, true);

    try {
      try {
        throw new Error('EasySlip network crash');
      } finally {
        await releaseSlipLock({ db: null, lockKey: lockRes.lockKey });
      }
    } catch (err) {
      assert.strictEqual(err.message, 'EasySlip network crash');
    }

    // Should be able to acquire again immediately
    const retryLock = await acquireSlipLock({ db: null, slipData: 'slip-fail-test', amount: 300 });
    assert.strictEqual(retryLock.acquired, true);
    await releaseSlipLock({ db: null, lockKey: retryLock.lockKey });
  });

  await asyncTest('Lock auto-expires after TTL without deadlock', async () => {
    // Acquire lock with short TTL (50ms)
    const lock1 = await acquireSlipLock({ db: null, slipData: 'slip-ttl-test', amount: 500, ttlMs: 50 });
    assert.strictEqual(lock1.acquired, true);

    // Immediate attempt is rejected
    const lockImmediate = await acquireSlipLock({ db: null, slipData: 'slip-ttl-test', amount: 500, ttlMs: 50 });
    assert.strictEqual(lockImmediate.acquired, false);

    // Wait 60ms for TTL to expire
    await new Promise(r => setTimeout(r, 60));

    // Attempt after TTL expiry succeeds
    const lockAfterTtl = await acquireSlipLock({ db: null, slipData: 'slip-ttl-test', amount: 500, ttlMs: 50 });
    assert.strictEqual(lockAfterTtl.acquired, true);
    await releaseSlipLock({ db: null, lockKey: lockAfterTtl.lockKey });
  });

  await asyncTest('TransRef tracking prevents duplicate order usage', async () => {
    const transRef = 'BANK_REF_998877';

    // Initially unused
    const beforeUsed = await isTransRefUsed({ db: null, transRef });
    assert.strictEqual(beforeUsed, false);

    // Mark as used
    await markTransRefUsed({
      db: null,
      transRef,
      orderId: 'HXG-2026-TEST',
      orderType: 'bag',
      amount: 1590,
    });

    // Now detected as duplicate
    const afterUsed = await isTransRefUsed({ db: null, transRef });
    assert.strictEqual(afterUsed, true);
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
