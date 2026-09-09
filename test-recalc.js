 var assert = require('assert');
// ==================== DATA (same as recalc-orders.js) ====================
var ALL_PATTERNS = [
  { name: 'Merilah Pink', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Blair', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Magic Pegasus', sizeKey: 'large', priceOrig: 499 },
  { name: "Diary's MARIE (mint)", sizeKey: 'easy', priceOrig: 425 },
  { name: "Diary's MARIE (purple)", sizeKey: 'easy', priceOrig: 425 },
];

var PROMO_NORMAL = [{ bags: 1, price: 299 }, { bags: 2, price: 559 }, { bags: 3, price: 750 }];
var PROMO_LARGE  = [{ bags: 1, price: 449 }, { bags: 2, price: 699 }, { bags: 3, price: 990 }];
var PROMO_EASY   = [{ bags: 1, price: 355 }, { bags: 2, price: 630 }, { bags: 3, price: 800 }];

var BASE_SHIPPING = 0;
var REMOTE_SHIPPING = 40;
var REMOTE_PROVINCES = [
  'ยะลา','ปัตตานี','นราธิวาส','ระนอง','แม่ฮ่องสอน',
];

// ==================== FUNCTIONS ====================
function computePromoPrice(patternQtys) {
  var groups = {};
  for (var name in patternQtys) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    if (!p) continue;
    if (!groups[p.sizeKey]) groups[p.sizeKey] = { totalBags: 0, origTotal: 0 };
    groups[p.sizeKey].totalBags += patternQtys[name];
    groups[p.sizeKey].origTotal += p.priceOrig * patternQtys[name];
  }

  var totalOrig = 0;
  var totalPromo = 0;

  for (var sk in groups) {
    var g = groups[sk];
    totalOrig += g.origTotal;
    var tiers = sk === 'normal' ? PROMO_NORMAL : sk === 'large' ? PROMO_LARGE : PROMO_EASY;
    var promo = 0;

    var remaining = g.totalBags;
    while (remaining > 0) {
      if (remaining >= 3) { promo += tiers[2].price; remaining -= 3; }
      else if (remaining === 2) { promo += tiers[1].price; remaining -= 2; }
      else { promo += tiers[0].price; remaining -= 1; }
    }

    totalPromo += promo;
  }

  return { original: totalOrig, promo: totalPromo, savings: totalOrig - totalPromo };
}

function isRemoteArea(address) {
  if (!address) return false;
  var addr = address.toLowerCase();
  for (var i = 0; i < REMOTE_PROVINCES.length; i++) {
    if (addr.indexOf(REMOTE_PROVINCES[i]) !== -1) return true;
  }
  return false;
}

function calcShipping(address, totalBags) {
  if (!totalBags || totalBags <= 0) return 0;
  return isRemoteArea(address) ? REMOTE_SHIPPING : BASE_SHIPPING;
}

function simulateOrderUpdate(order) {
  var patternQtys = order.pattern_qtys || {};
  if (Object.keys(patternQtys).length === 0) {
    (order.patterns || []).forEach(function(name) {
      patternQtys[name] = order.qty || 1;
    });
  }

  var result = computePromoPrice(patternQtys);
  var totalBags = Object.values(patternQtys).reduce(function(sum, q) { return sum + q; }, 0);
  var shippingCost = calcShipping(order.customer_info, totalBags);

  return {
    total_price: result.promo,
    original_price: result.original,
    savings: result.savings,
    shipping_cost: shippingCost,
    is_remote: isRemoteArea(order.customer_info),
  };
}

// ==================== TESTS ====================
var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('\x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    failed++;
    console.log('\x1b[31m✗\x1b[0m ' + name);
    console.log('  ' + e.message);
  }
}

// ==================== RECALC FROM pattern_qtys ====================
console.log('\n--- RECALC FROM pattern_qtys ---');

test('Order with pattern_qtys: 4 Normal', function() {
  var order = {
    patterns: ['Merilah Pink', 'Blair'],
    pattern_qtys: { 'Merilah Pink': 3, 'Blair': 1 },
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 750 + 299); // 1049
  assert.strictEqual(result.original_price, 399 * 4); // 1596
  assert.strictEqual(result.savings, 1596 - 1049); // 547
  assert.strictEqual(result.shipping_cost, 0); // 3+ bags = free
});

test('Order with pattern_qtys: 2 Large + 1 Easy', function() {
  var order = {
    patterns: ['Magic Pegasus', "Diary's MARIE (mint)"],
    pattern_qtys: { 'Magic Pegasus': 2, "Diary's MARIE (mint)": 1 },
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };



  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 699 + 355); // 1054
  assert.strictEqual(result.original_price, 499 * 2 + 425); // 1423
  assert.strictEqual(result.shipping_cost, 0); // 3 total bags = free
});

test('Order with pattern_qtys: 5 Normal (3+2)', function() {
  var order = {
    patterns: ['Merilah Pink'],
    pattern_qtys: { 'Merilah Pink': 5 },
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 750 + 559); // 1309
  assert.strictEqual(result.original_price, 399 * 5); // 1995
});

// ==================== RECALC FROM patterns (fallback) ====================
console.log('\n--- RECALC FROM patterns (fallback, no pattern_qtys) ---');

test('Order without pattern_qtys: 3 Normal', function() {
  var order = {
    patterns: ['Merilah Pink', 'Merilah Pink', 'Merilah Pink'],
    qty: 3,
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 750); // 3 bags promo
  assert.strictEqual(result.original_price, 399 * 3); // 1197
});

test('Order without pattern_qtys: 2 Large', function() {
  var order = {
    patterns: ['Magic Pegasus', 'Magic Pegasus'],
    qty: 2,
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 699);
  assert.strictEqual(result.original_price, 499 * 2); // 998
});

// ==================== SHIPPING RECALC ====================
console.log('\n--- SHIPPING RECALC ---');

test('Normal address: 1 bag → free shipping (0)', function() {
  var order = {
    patterns: ['Merilah Pink'],
    pattern_qtys: { 'Merilah Pink': 1 },
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.shipping_cost, 0);
  assert.strictEqual(result.is_remote, false);
});

test('Normal address: 2 bags → free shipping (0)', function() {
  var order = {
    patterns: ['Merilah Pink', 'Blair'],
    pattern_qtys: { 'Merilah Pink': 1, 'Blair': 1 },
    customer_info: 'Test\n081-234-5678\nกรุงเทพ',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.shipping_cost, 0);
  assert.strictEqual(result.is_remote, false);
});

test('Remote address (ปัตตานี): 1 bag → shipping 40', function() {
  var order = {
    patterns: ['Merilah Pink'],
    pattern_qtys: { 'Merilah Pink': 1 },
    customer_info: 'Test\n081-234-5678\nปัตตานี',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.shipping_cost, 40);
  assert.strictEqual(result.is_remote, true);
});

test('Remote address (ยะลา): 3 bags → shipping 40', function() {
  var order = {
    patterns: ['Merilah Pink', 'Merilah Pink', 'Merilah Pink'],
    pattern_qtys: { 'Merilah Pink': 3 },
    customer_info: 'Test\n081-234-5678\nยะลา',
  };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.shipping_cost, 40);
  assert.strictEqual(result.is_remote, true);
});

// ==================== EDGE CASES ====================
console.log('\n--- EDGE CASES ---');

test('Empty order', function() {
  var order = { patterns: [], pattern_qtys: {}, customer_info: '' };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 0);
  assert.strictEqual(result.original_price, 0);
  assert.strictEqual(result.savings, 0);
});

test('Unknown pattern', function() {
  var order = { patterns: ['Unknown'], pattern_qtys: { 'Unknown': 3 }, customer_info: '' };
  var result = simulateOrderUpdate(order);
  assert.strictEqual(result.total_price, 0);
  assert.strictEqual(result.original_price, 0);
});

// ==================== SUMMARY ====================
console.log('\n' + '='.repeat(40));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
