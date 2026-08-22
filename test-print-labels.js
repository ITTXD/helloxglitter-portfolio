const BASE = 'https://helloxglitter-preorder.vercel.app';
const COOKIE = [];
const TEST_IDS = [];

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...opts.headers, cookie: COOKIE.join('; ') },
    redirect: 'manual'
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  sc.forEach(c => COOKIE.push(c.split(';')[0]));
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

let PASSED = 0;
let FAILED = 0;
function pass(msg) { PASSED++; console.log(`  ✅ ${msg}`); }
function fail(msg, err) { FAILED++; console.log(`  ❌ ${msg}`, err || ''); }

async function cleanup() {
  if (TEST_IDS.length === 0) return;
  console.log('\n── CLEANUP ──');
  for (const docId of TEST_IDS) {
    await req(`/api/orders/${encodeURIComponent(docId)}`, { method: 'DELETE' });
  }
  pass(`Deleted ${TEST_IDS.length} test orders`);
}

async function test() {
  console.log('========================================');
  console.log('  TEST: Print Labels + printed_at');
  console.log('========================================\n');

  // 1. Login
  console.log('── 1. LOGIN ──');
  const login = await req('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'helloxglitter' })
  });
  login.data.success ? pass('Login OK') : fail('Login failed', JSON.stringify(login.data));

  // 2. Create test orders
  console.log('\n── 2. CREATE TEST ORDERS ──');
  const testOrders = [
    {
      customer_info: 'เทส Castle Pink\n0891111111\n123 ถนนทดสอบ กรุงเทพฯ 10100',
      patterns: ['Castle Pink', 'Blair'],
      pattern_qtys: { 'Castle Pink': 2, 'Blair': 1 },
      total_bags: 3, total_price: 750, original_price: 1197, savings: 447, shipping_cost: 0
    },
    {
      customer_info: 'เทส Castle Pink คนที่ 2\n0892222222\n456 ถนนเทส นนทบุรี 11000',
      patterns: ['Castle Pink', 'Floral Cottage'],
      pattern_qtys: { 'Castle Pink': 1, 'Floral Cottage': 1 },
      total_bags: 2, total_price: 559, original_price: 798, savings: 239, shipping_cost: 50
    },
    {
      customer_info: 'เทส Blair คนเดียว\n0893333333\n789 ถนนยูนิคอร์น เชียงใหม่ 50000',
      patterns: ['Blair'],
      pattern_qtys: { 'Blair': 1 },
      total_bags: 1, total_price: 299, original_price: 399, savings: 100, shipping_cost: 50
    }
  ];

  for (const order of testOrders) {
    const res = await req('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
    if (res.data.order) {
      TEST_IDS.push(res.data.order._docId);
      pass(`Created order ${res.data.order.id} (docId: ${res.data.order._docId})`);
    } else {
      fail('Create order failed', JSON.stringify(res.data));
    }
  }

  // 3. Set all to status=1 (confirmed)
  console.log('\n── 3. CONFIRM ORDERS ──');
  for (const docId of TEST_IDS) {
    const res = await req(`/api/orders/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 1 })
    });
    res.data.status === 1 ? pass(`Confirmed ${docId}`) : fail(`Confirm failed ${docId}`);
  }

  // 4. GET orders → verify grouping logic
  console.log('\n── 4. VERIFY GROUPING ──');
  const listRes = await req('/api/orders');
  const orders = listRes.data;
  const testOrdersOnly = orders.filter(o => TEST_IDS.includes(o._docId));

  // Count patterns
  const patternCounts = {};
  testOrdersOnly.forEach(o => {
    (o.patterns || []).forEach(name => {
      const qty = (o.pattern_qtys || {})[name] || o.qty || 1;
      patternCounts[name] = (patternCounts[name] || 0) + qty;
    });
  });

  console.log('  Pattern counts:', patternCounts);
  patternCounts['Castle Pink'] === 3 ? pass('Castle Pink total = 3') : fail(`Castle Pink expected 3, got ${patternCounts['Castle Pink']}`);
  patternCounts['Blair'] === 2 ? pass('Blair total = 2') : fail(`Blair expected 2, got ${patternCounts['Blair']}`);
  patternCounts['Floral Cottage'] === 1 ? pass('Floral Cottage total = 1') : fail(`Floral Cottage expected 1, got ${patternCounts['Floral Cottage']}`);

  // Sort by total desc
  const sorted = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
  console.log('  Sorted:', sorted);
  sorted[0][0] === 'Castle Pink' ? pass('Sort: Castle Pink is first (most ordered)') : fail('Sort wrong');

  // 5. PUT printed_at
  console.log('\n── 5. MARK PRINTED ──');
  const now = new Date().toISOString();
  for (const docId of TEST_IDS) {
    const res = await req(`/api/orders/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printed_at: now })
    });
    res.data.printed_at ? pass(`printed_at set for ${docId}`) : fail(`printed_at not set for ${docId}`);
  }

  // 6. Verify printed_at persists
  console.log('\n── 6. VERIFY PRINTED_AT ──');
  const listRes2 = await req('/api/orders');
  const orders2 = listRes2.data;
  const testOrders2 = orders2.filter(o => TEST_IDS.includes(o._docId));
  const allPrinted = testOrders2.every(o => o.printed_at);
  allPrinted ? pass('All orders have printed_at') : fail('Some orders missing printed_at');

  // 7. Re-print test (printed_at should update)
  console.log('\n── 7. RE-PRINT TEST ──');
  const later = new Date(Date.now() + 60000).toISOString();
  await req(`/api/orders/${encodeURIComponent(TEST_IDS[0])}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printed_at: later })
  });
  const listRes3 = await req('/api/orders');
  const updatedOrder = listRes3.data.find(o => o._docId === TEST_IDS[0]);
  updatedOrder.printed_at === later ? pass('Re-print updated printed_at') : fail('Re-print failed');

  // 8. Verify status still 1
  console.log('\n── 8. VERIFY STATUS UNCHANGED ──');
  const listRes4 = await req('/api/orders');
  const statusOk = listRes4.data.filter(o => TEST_IDS.includes(o._docId)).every(o => o.status === 1);
  statusOk ? pass('All orders still status=1') : fail('Status changed unexpectedly');

  // Cleanup
  await cleanup();

  // Results
  const TOTAL = PASSED + FAILED;
  console.log('\n========================================');
  console.log(`  RESULTS: ${PASSED} / ${TOTAL} passed`);
  console.log('========================================');
  if (FAILED === 0) {
    console.log('🎉 ALL TESTS PASSED!');
    process.exit(0);
  } else {
    console.log(`⚠️  ${FAILED} TEST(S) FAILED`);
    process.exit(1);
  }
}

test().catch(err => {
  console.error('Fatal:', err);
  cleanup().finally(() => process.exit(1));
});
