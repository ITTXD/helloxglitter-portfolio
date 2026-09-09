/**
 * Tests for patterns.js — full pricing, shipping, remote area detection
 */

// Load patterns.js via vm so `var` declarations become accessible
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'data', 'patterns.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { computePromoPrice, isRemoteArea, getShippingCost, getPatternByName,
  ALL_PATTERNS, NORMAL_PATTERNS, LARGE_PATTERNS, EASY_PATTERNS, MAXI_PATTERNS,
  STATUS_LABELS,
  STICKER_PATTERNS, STICKER_PRICE, STICKER_SHIPPING, STICKER_FREE_SHIPPING_QTY,
  computeStickerPrice, getStickerByName } = sandbox;

describe('computePromoPrice (full prices, no discounts)', () => {
  describe('normal patterns (399 THB each)', () => {
    test('1 normal bag = 399', () => {
      const result = computePromoPrice({ 'Merilah Pink': 1 });
      expect(result.promo).toBe(399);
      expect(result.original).toBe(399);
      expect(result.savings).toBe(0);
    });

    test('2 normal bags = 798', () => {
      const result = computePromoPrice({ 'Merilah Pink': 1, 'Merilah Blue': 1 });
      expect(result.promo).toBe(798);
      expect(result.original).toBe(798);
      expect(result.savings).toBe(0);
    });

    test('3 normal bags = 1197', () => {
      const result = computePromoPrice({
        'Merilah Pink': 1, 'Merilah Blue': 1, 'Tea Party (pink)': 1
      });
      expect(result.promo).toBe(1197);
      expect(result.original).toBe(1197);
      expect(result.savings).toBe(0);
    });

    test('4 normal bags = 1596', () => {
      const result = computePromoPrice({
        'Merilah Pink': 2, 'Merilah Blue': 1, 'Tea Party (pink)': 1
      });
      expect(result.promo).toBe(1596);
      expect(result.original).toBe(1596);
    });

    test('5 normal bags = 1995', () => {
      const result = computePromoPrice({
        'Merilah Pink': 2, 'Merilah Blue': 2, 'Tea Party (pink)': 1
      });
      expect(result.promo).toBe(1995);
      expect(result.original).toBe(1995);
    });

    test('6 normal bags = 2394', () => {
      const result = computePromoPrice({
        'Merilah Pink': 2, 'Merilah Blue': 2, 'Tea Party (pink)': 2
      });
      expect(result.promo).toBe(2394);
      expect(result.original).toBe(2394);
    });

    test('same pattern with qty > 1', () => {
      const result = computePromoPrice({ 'Merilah Pink': 3 });
      expect(result.promo).toBe(1197);
      expect(result.original).toBe(1197);
    });
  });

  describe('large patterns (499 THB each)', () => {
    test('1 large bag = 499', () => {
      const result = computePromoPrice({ 'Magic Pegasus': 1 });
      expect(result.promo).toBe(499);
      expect(result.original).toBe(499);
      expect(result.savings).toBe(0);
    });

    test('2 large bags = 998', () => {
      const result = computePromoPrice({ 'Magic Pegasus': 1, "Cupid's Odette": 1 });
      expect(result.promo).toBe(998);
      expect(result.original).toBe(998);
      expect(result.savings).toBe(0);
    });

    test('3 large bags = 1497', () => {
      const result = computePromoPrice({
        'Magic Pegasus': 1, "Cupid's Odette": 1, 'Lady Pink': 1
      });
      expect(result.promo).toBe(1497);
      expect(result.original).toBe(1497);
    });
  });

  describe('easy patterns (425 THB each)', () => {
    test('1 easy bag = 425', () => {
      const result = computePromoPrice({ "Diary's MARIE (mint)": 1 });
      expect(result.promo).toBe(425);
      expect(result.original).toBe(425);
    });

    test('2 easy bags = 850', () => {
      const result = computePromoPrice({
        "Diary's MARIE (mint)": 1, "Diary's MARIE (purple)": 1
      });
      expect(result.promo).toBe(850);
      expect(result.original).toBe(850);
    });
  });

  describe('mixed size patterns', () => {
    test('normal + large are summed at full price', () => {
      const result = computePromoPrice({ 'Merilah Pink': 1, 'Magic Pegasus': 1 });
      expect(result.promo).toBe(898);
      expect(result.original).toBe(898);
    });

    test('all four sizes mixed', () => {
      const result = computePromoPrice({
        'Merilah Pink': 1, 'Magic Pegasus': 1, "Diary's MARIE (mint)": 1, 'Diary\'s Musketeers': 1
      });
      expect(result.promo).toBe(1873); // 399 + 499 + 425 + 550
      expect(result.original).toBe(1873);
    });
  });

  describe('maxi patterns (550 THB each)', () => {
    test('1 maxi bag = 550', () => {
      const result = computePromoPrice({ 'Diary\'s Musketeers': 1 });
      expect(result.promo).toBe(550);
      expect(result.original).toBe(550);
      expect(result.savings).toBe(0);
    });

    test('2 maxi bags = 1100', () => {
      const result = computePromoPrice({ 'Diary\'s Musketeers': 2 });
      expect(result.promo).toBe(1100);
      expect(result.original).toBe(1100);
      expect(result.savings).toBe(0);
    });

    test('3 maxi bags = 1650', () => {
      const result = computePromoPrice({ 'Diary\'s Musketeers': 3 });
      expect(result.promo).toBe(1650);
      expect(result.original).toBe(1650);
    });
  });

  describe('edge cases', () => {
    test('empty object returns 0', () => {
      const result = computePromoPrice({});
      expect(result.promo).toBe(0);
      expect(result.original).toBe(0);
      expect(result.savings).toBe(0);
    });

    test('unknown pattern name is skipped', () => {
      const result = computePromoPrice({ 'Nonexistent Pattern': 1 });
      expect(result.promo).toBe(0);
      expect(result.original).toBe(0);
    });

    test('large qty of single pattern', () => {
      const result = computePromoPrice({ 'Merilah Pink': 10 });
      expect(result.promo).toBe(3990);
      expect(result.original).toBe(3990);
    });
  });
});

describe('isRemoteArea', () => {
  const remoteTests = [
    'ยะลา', 'ปัตตานี', 'นราธิวาส', 'ระนอง', 'แม่ฮ่องสอน',
    'ตราด', 'เกาะกูด', 'เกาะช้าง', 'กระบี่', 'เกาะลันตา',
    'ภูเก็ต', 'เกาะสมุย', 'ชุมพร', 'สตูล', 'พังงา', 'ตรัง',
    'น่าน', 'แพร่', 'อุตรดิตถ์',
  ];
  remoteTests.forEach(province => {
    test(`returns true for ${province}`, () => {
      expect(isRemoteArea(province)).toBe(true);
      expect(isRemoteArea(`บ้าน ${province}`)).toBe(true);
    });
  });

  test('returns false for กรุงเทพ', () => {
    expect(isRemoteArea('กรุงเทพ')).toBe(false);
  });
  test('returns false for เชียงใหม่', () => {
    expect(isRemoteArea('เชียงใหม่')).toBe(false);
  });
  test('returns false for null', () => {
    expect(isRemoteArea(null)).toBe(false);
  });
  test('returns false for empty string', () => {
    expect(isRemoteArea('')).toBe(false);
  });
  test('returns false for undefined', () => {
    expect(isRemoteArea(undefined)).toBe(false);
  });
  test('detects island names like เกาะสมุย', () => {
    expect(isRemoteArea('เกาะสมุย')).toBe(true);
  });
});

describe('getShippingCost', () => {
  test('free shipping for any bags in normal area', () => {
    expect(getShippingCost('กรุงเทพ', 1)).toBe(0);
    expect(getShippingCost('กรุงเทพ', 2)).toBe(0);
    expect(getShippingCost('กรุงเทพ', 3)).toBe(0);
    expect(getShippingCost('กรุงเทพ', 5)).toBe(0);
  });
  test('40 THB for remote area', () => {
    expect(getShippingCost('ภูเก็ต', 1)).toBe(40);
    expect(getShippingCost('ยะลา', 2)).toBe(40);
    expect(getShippingCost('ภูเก็ต', 3)).toBe(40);
    expect(getShippingCost('ยะลา', 5)).toBe(40);
  });
  test('0 THB when address is null (normal area free shipping)', () => {
    expect(getShippingCost(null, 1)).toBe(0);
  });
  test('0 THB when address is empty (normal area free shipping)', () => {
    expect(getShippingCost('', 1)).toBe(0);
  });
  test('0 THB when totalBags is 0', () => {
    expect(getShippingCost('ภูเก็ต', 0)).toBe(0);
    expect(getShippingCost('กรุงเทพ', 0)).toBe(0);
  });
});

describe('getPatternByName', () => {
  test('finds normal pattern', () => {
    const p = getPatternByName('Merilah Pink');
    expect(p).toBeDefined();
    expect(p.priceOrig).toBe(399);
    expect(p.sizeKey).toBe('normal');
  });
  test('finds large pattern', () => {
    const p = getPatternByName('Magic Pegasus');
    expect(p).toBeDefined();
    expect(p.priceOrig).toBe(499);
    expect(p.sizeKey).toBe('large');
  });
  test('finds easy pattern', () => {
    const p = getPatternByName("Diary's MARIE (mint)");
    expect(p).toBeDefined();
    expect(p.priceOrig).toBe(425);
    expect(p.sizeKey).toBe('easy');
  });
  test('returns undefined for nonexistent', () => {
    expect(getPatternByName('Not Real')).toBeUndefined();
  });
  test('returns undefined for null', () => {
    expect(getPatternByName(null)).toBeUndefined();
  });
});

describe('ALL_PATTERNS', () => {
  test('has correct count (36+7+2+1=46)', () => {
    expect(ALL_PATTERNS.length).toBe(46);
  });
  test('NORMAL_PATTERNS has 36 items', () => {
    expect(NORMAL_PATTERNS.length).toBe(36);
  });
  test('LARGE_PATTERNS has 7 items', () => {
    expect(LARGE_PATTERNS.length).toBe(7);
  });
  test('EASY_PATTERNS has 2 items', () => {
    expect(EASY_PATTERNS.length).toBe(2);
  });
  test('MAXI_PATTERNS has 1 item', () => {
    expect(MAXI_PATTERNS.length).toBe(1);
  });
  test('all patterns have required fields', () => {
    ALL_PATTERNS.forEach(p => {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('size');
      expect(p).toHaveProperty('sizeKey');
      expect(p).toHaveProperty('priceOrig');
      expect(p).toHaveProperty('img');
      expect(p.priceOrig).toBeGreaterThan(0);
    });
  });
  test('no duplicate names', () => {
    const names = ALL_PATTERNS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('STATUS_LABELS', () => {
  test('has 4 labels', () => {
    expect(STATUS_LABELS.length).toBe(4);
  });
  test('labels are correct', () => {
    expect(STATUS_LABELS).toEqual(['รอยืนยัน', 'ยืนยันแล้ว', 'กำลังผลิต', 'จัดส่งแล้ว']);
  });
});

describe('STICKER_PATTERNS', () => {
  test('has required fields', () => {
    STICKER_PATTERNS.forEach(p => {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('img');
      expect(p).toHaveProperty('price');
      expect(p.price).toBeGreaterThan(0);
    });
  });
  test('all prices are 69', () => {
    STICKER_PATTERNS.forEach(p => {
      expect(p.price).toBe(69);
    });
  });
  test('no duplicate names', () => {
    const names = STICKER_PATTERNS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
  test('has at least 1 pattern', () => {
    expect(STICKER_PATTERNS.length).toBeGreaterThanOrEqual(1);
  });
});

describe('STICKER constants', () => {
  test('STICKER_PRICE is 69', () => {
    expect(STICKER_PRICE).toBe(69);
  });
  test('STICKER_SHIPPING is 50', () => {
    expect(STICKER_SHIPPING).toBe(50);
  });
  test('STICKER_FREE_SHIPPING_QTY is 3', () => {
    expect(STICKER_FREE_SHIPPING_QTY).toBe(3);
  });
});

describe('computeStickerPrice', () => {
  test('1 sticker = 69 + shipping 50', () => {
    const result = computeStickerPrice({ 'Sticker A': 1 });
    expect(result.total).toBe(69);
    expect(result.shipping).toBe(50);
    expect(result.grandTotal).toBe(119);
  });
  test('2 stickers = 138 + shipping 50', () => {
    const result = computeStickerPrice({ 'Sticker A': 1, 'Sticker B': 1 });
    expect(result.total).toBe(138);
    expect(result.shipping).toBe(50);
    expect(result.grandTotal).toBe(188);
  });
  test('3 stickers = 207 + free shipping', () => {
    const result = computeStickerPrice({ 'Sticker A': 1, 'Sticker B': 1, 'Sticker C': 1 });
    expect(result.total).toBe(207);
    expect(result.shipping).toBe(0);
    expect(result.grandTotal).toBe(207);
  });
  test('same pattern qty > 1', () => {
    const result = computeStickerPrice({ 'Sticker A': 3 });
    expect(result.total).toBe(207);
    expect(result.shipping).toBe(0);
  });
  test('empty = 0', () => {
    const result = computeStickerPrice({});
    expect(result.total).toBe(0);
    expect(result.shipping).toBe(50);
    expect(result.grandTotal).toBe(50);
  });
  test('5 stickers = 345 + free shipping', () => {
    const result = computeStickerPrice({ 'Sticker A': 2, 'Sticker B': 3 });
    expect(result.total).toBe(345);
    expect(result.shipping).toBe(0);
    expect(result.grandTotal).toBe(345);
  });
});

describe('getStickerByName', () => {
  test('finds sticker pattern', () => {
    const p = getStickerByName('Magic Pegasus');
    expect(p).toBeDefined();
    expect(p.price).toBe(69);
  });
  test('returns undefined for nonexistent', () => {
    expect(getStickerByName('Not Real')).toBeUndefined();
  });
  test('returns undefined for null', () => {
    expect(getStickerByName(null)).toBeUndefined();
  });
});
