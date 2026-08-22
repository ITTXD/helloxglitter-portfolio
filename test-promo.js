var assert = require('assert');

// Mock ALL_PATTERNS
var ALL_PATTERNS = [
  { name: 'Merilah Pink', size: '15 × 16 inch', sizeKey: 'normal', priceOrig: 399, img: 'images/normal-01.jpg' },
  { name: 'Blair', size: '15 × 16 inch', sizeKey: 'normal', priceOrig: 399, img: 'images/normal-09.jpg' },
  { name: 'Magic Pegasus', size: '15.5 × 4 × 16 inch', sizeKey: 'large', priceOrig: 499, img: 'images/large-01.jpg' },
  { name: "Diary's MARIE (mint)", size: '10.5 × 5 × 14 inch', sizeKey: 'easy', priceOrig: 425, img: 'images/easy-01.jpg' },
  { name: "Diary's MARIE (purple)", size: '10.5 × 5 × 14 inch', sizeKey: 'easy', priceOrig: 425, img: 'images/easy-02.jpg' },
];

// Load promo pricing from app.js (inline)
var PROMO_NORMAL = [{ bags: 1, price: 299 }, { bags: 2, price: 559 }, { bags: 3, price: 750 }];
var PROMO_LARGE  = [{ bags: 1, price: 449 }, { bags: 2, price: 699 }, { bags: 3, price: 990 }];
var PROMO_EASY   = [{ bags: 1, price: 355 }, { bags: 2, price: 630 }, { bags: 3, price: 800 }];

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
  var promoDetails = {};

  for (var sk in groups) {
    var g = groups[sk];
    totalOrig += g.origTotal;
    var tiers = sk === 'normal' ? PROMO_NORMAL : sk === 'large' ? PROMO_LARGE : PROMO_EASY;
    var perBagOrig = sk === 'normal' ? 399 : sk === 'large' ? 499 : 425;
    var promo = 0;

    var remaining = g.totalBags;
    while (remaining > 0) {
      if (remaining >= 3) {
        promo += tiers[2].price;
        remaining -= 3;
      } else if (remaining === 2) {
        promo += tiers[1].price;
        remaining -= 2;
      } else {
        promo += tiers[0].price;
        remaining -= 1;
      }
    }

    totalPromo += promo;
    promoDetails[sk] = { orig: g.origTotal, promo: promo, tier: tiers[Math.min(g.totalBags, 3) - 1] };
  }

  return { original: totalOrig, promo: totalPromo, savings: totalOrig - totalPromo, details: promoDetails };
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

// ==================== NORMAL BAGS ====================
console.log('\n--- NORMAL BAGS (orig: 399, promo: 1=299, 2=559, 3=750) ---');

test('Normal 1 bag', function() {
  var r = computePromoPrice({ 'Merilah Pink': 1 });
  assert.strictEqual(r.promo, 299);
  assert.strictEqual(r.original, 399);
});

test('Normal 2 bags', function() {
  var r = computePromoPrice({ 'Merilah Pink': 2 });
  assert.strictEqual(r.promo, 559);
  assert.strictEqual(r.original, 798);
});

test('Normal 3 bags', function() {
  var r = computePromoPrice({ 'Merilah Pink': 3 });
  assert.strictEqual(r.promo, 750);
  assert.strictEqual(r.original, 1197);
});

test('Normal 4 bags = 3+1', function() {
  var r = computePromoPrice({ 'Merilah Pink': 4 });
  assert.strictEqual(r.promo, 750 + 299); // 1049
  assert.strictEqual(r.original, 399 * 4); // 1596
});

test('Normal 5 bags = 3+2', function() {
  var r = computePromoPrice({ 'Merilah Pink': 5 });
  assert.strictEqual(r.promo, 750 + 559); // 1309
  assert.strictEqual(r.original, 399 * 5); // 1995
});

test('Normal 6 bags = 3+3', function() {
  var r = computePromoPrice({ 'Merilah Pink': 6 });
  assert.strictEqual(r.promo, 750 + 750); // 1500
  assert.strictEqual(r.original, 399 * 6); // 2394
});

test('Normal 7 bags = 3+3+1', function() {
  var r = computePromoPrice({ 'Merilah Pink': 7 });
  assert.strictEqual(r.promo, 750 + 750 + 299); // 1799
  assert.strictEqual(r.original, 399 * 7); // 2793
});

test('Normal 8 bags = 3+3+2', function() {
  var r = computePromoPrice({ 'Merilah Pink': 8 });
  assert.strictEqual(r.promo, 750 + 750 + 559); // 2059
  assert.strictEqual(r.original, 399 * 8); // 3192
});

test('Normal 9 bags = 3+3+3', function() {
  var r = computePromoPrice({ 'Merilah Pink': 9 });
  assert.strictEqual(r.promo, 750 + 750 + 750); // 2250
  assert.strictEqual(r.original, 399 * 9); // 3591
});

// ==================== LARGE BAGS ====================
console.log('\n--- LARGE BAGS (orig: 499, promo: 1=449, 2=699, 3=990) ---');

test('Large 1 bag', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 1 });
  assert.strictEqual(r.promo, 449);
  assert.strictEqual(r.original, 499);
});

test('Large 2 bags', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 2 });
  assert.strictEqual(r.promo, 699);
  assert.strictEqual(r.original, 998);
});

test('Large 3 bags', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 3 });
  assert.strictEqual(r.promo, 990);
  assert.strictEqual(r.original, 1497);
});

test('Large 4 bags = 3+1', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 4 });
  assert.strictEqual(r.promo, 990 + 449); // 1439
  assert.strictEqual(r.original, 499 * 4); // 1996
});

test('Large 5 bags = 3+2', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 5 });
  assert.strictEqual(r.promo, 990 + 699); // 1689
  assert.strictEqual(r.original, 499 * 5); // 2495
});

test('Large 6 bags = 3+3', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 6 });
  assert.strictEqual(r.promo, 990 + 990); // 1980
  assert.strictEqual(r.original, 499 * 6); // 2994
});

// ==================== EASY BAGS ====================
console.log('\n--- EASY BAGS (orig: 425, promo: 1=355, 2=630, 3=800) ---');

test('Easy 1 bag', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 1 });
  assert.strictEqual(r.promo, 355);
  assert.strictEqual(r.original, 425);
});

test('Easy 2 bags', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 2 });
  assert.strictEqual(r.promo, 630);
  assert.strictEqual(r.original, 850);
});

test('Easy 3 bags', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 3 });
  assert.strictEqual(r.promo, 800);
  assert.strictEqual(r.original, 1275);
});

test('Easy 4 bags = 3+1', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 4 });
  assert.strictEqual(r.promo, 800 + 355); // 1155
  assert.strictEqual(r.original, 425 * 4); // 1700
});

test('Easy 5 bags = 3+2', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 5 });
  assert.strictEqual(r.promo, 800 + 630); // 1430
  assert.strictEqual(r.original, 425 * 5); // 2125
});

// ==================== MIXED SIZES ====================
console.log('\n--- MIXED SIZES ---');

test('1 Normal + 1 Large = separate promos', function() {
  var r = computePromoPrice({ 'Merilah Pink': 1, 'Magic Pegasus': 1 });
  assert.strictEqual(r.promo, 299 + 449); // 748
  assert.strictEqual(r.original, 399 + 499); // 898
});

test('2 Normal + 1 Large = mixed tiers', function() {
  var r = computePromoPrice({ 'Merilah Pink': 2, 'Magic Pegasus': 1 });
  assert.strictEqual(r.promo, 559 + 449); // 1008
  assert.strictEqual(r.original, 798 + 499); // 1297
});

test('3 Normal + 2 Large = 3+2 per group', function() {
  var r = computePromoPrice({ 'Merilah Pink': 3, 'Magic Pegasus': 2 });
  assert.strictEqual(r.promo, 750 + 699); // 1449
  assert.strictEqual(r.original, 1197 + 998); // 2195
});

test('4 Normal + 3 Large = (3+1) + 3', function() {
  var r = computePromoPrice({ 'Merilah Pink': 4, 'Magic Pegasus': 3 });
  assert.strictEqual(r.promo, (750 + 299) + 990); // 2039
  assert.strictEqual(r.original, 1596 + 1497); // 3093
});

// ==================== EDGE CASES ====================
console.log('\n--- EDGE CASES ---');

test('Empty order', function() {
  var r = computePromoPrice({});
  assert.strictEqual(r.promo, 0);
  assert.strictEqual(r.original, 0);
  assert.strictEqual(r.savings, 0);
});

test('Unknown pattern', function() {
  var r = computePromoPrice({ 'Unknown Pattern': 3 });
  assert.strictEqual(r.promo, 0);
  assert.strictEqual(r.original, 0);
});

// ==================== SAVINGS ====================
console.log('\n--- SAVINGS ---');

test('Normal 3 bags savings', function() {
  var r = computePromoPrice({ 'Merilah Pink': 3 });
  assert.strictEqual(r.savings, 1197 - 750); // 447
});

test('Large 3 bags savings', function() {
  var r = computePromoPrice({ 'Magic Pegasus': 3 });
  assert.strictEqual(r.savings, 1497 - 990); // 507
});

test('Easy 3 bags savings', function() {
  var r = computePromoPrice({ "Diary's MARIE (mint)": 3 });
  assert.strictEqual(r.savings, 1275 - 800); // 475
});

// ==================== SUMMARY ====================
console.log('\n' + '='.repeat(40));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
