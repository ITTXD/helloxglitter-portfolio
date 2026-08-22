/**
 * Tests for OCR amount extraction logic
 * Pure function tests — no Tesseract/Canvas needed
 */

function extractAmount(text) {
  var t = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  var afterBaht = t.match(/(?:บาท|Baht|baht)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i);
  if (afterBaht) {
    var val = parseFloat(afterBaht[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0) return val;
  }

  var beforeBaht = t.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:บาท|Baht|baht)/i);
  if (beforeBaht) {
    var val2 = parseFloat(beforeBaht[1].replace(/,/g, ''));
    if (!isNaN(val2) && val2 > 0) return val2;
  }

  var afterBathSymbol = t.match(/฿\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (afterBathSymbol) {
    var val3 = parseFloat(afterBathSymbol[1].replace(/,/g, ''));
    if (!isNaN(val3) && val3 > 0) return val3;
  }

  var afterKeyword = t.match(/(?:จำนวน|เงิน|ยอด| amount|total)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i);
  if (afterKeyword) {
    var val4 = parseFloat(afterKeyword[1].replace(/,/g, ''));
    if (!isNaN(val4) && val4 > 0) return val4;
  }

  var matches = t.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g);
  if (!matches || matches.length === 0) return null;

  var amounts = matches
    .map(function(m) { return parseFloat(m.replace(/,/g, '')); })
    .filter(function(n) { return !isNaN(n) && n > 0 && n < 1000000; });

  if (amounts.length === 0) return null;

  var freq = {};
  amounts.forEach(function(a) { freq[a] = (freq[a] || 0) + 1; });
  var sorted = Object.keys(freq).sort(function(a, b) {
    if (freq[b] !== freq[a]) return freq[b] - freq[a];
    return parseFloat(b) - parseFloat(a);
  });

  return parseFloat(sorted[0]);
}

describe('extractAmount — Method 1: after บาท', () => {
  test('after บาท with colon', () => {
    expect(extractAmount('จำนวนเงิน บาท: 299.00')).toBe(299);
  });
  test('after บาท without colon', () => {
    expect(extractAmount('โอนเงิน 350 บาท')).toBe(350);
  });
  test('after Baht', () => {
    expect(extractAmount('Transfer 500 Baht')).toBe(500);
  });
  test('after baht', () => {
    expect(extractAmount('amount 1,299.50 baht')).toBe(1299.5);
  });
  test('comma-separated thousands after บาท', () => {
    expect(extractAmount(' บาท: 1,500.00')).toBe(1500);
  });
  test('Baht with colon', () => {
    expect(extractAmount('Total Baht: 2,000')).toBe(2000);
  });
});

describe('extractAmount — Method 2: before บาท', () => {
  test('before บาท', () => {
    expect(extractAmount('299 บาท')).toBe(299);
  });
  test('before Baht', () => {
    expect(extractAmount('450 Baht')).toBe(450);
  });
  test('comma before บาท', () => {
    expect(extractAmount('1,299 บาท')).toBe(1299);
  });
  test('decimal before บาท', () => {
    expect(extractAmount('299.50 บาท')).toBe(299.5);
  });
});

describe('extractAmount — Method 3: after ฿', () => {
  test('after ฿', () => {
    expect(extractAmount('฿299')).toBe(299);
  });
  test('after ฿ with space', () => {
    expect(extractAmount('฿ 350')).toBe(350);
  });
  test('comma after ฿', () => {
    expect(extractAmount('฿1,500')).toBe(1500);
  });
  test('decimal after ฿', () => {
    expect(extractAmount('฿ 299.50')).toBe(299.5);
  });
});

describe('extractAmount — Method 4: after keywords', () => {
  test('after จำนวน', () => {
    expect(extractAmount('จำนวน 299')).toBe(299);
  });
  test('after เงิน', () => {
    expect(extractAmount('เงิน 350')).toBe(350);
  });
  test('after ยอด', () => {
    expect(extractAmount('ยอด 1,000')).toBe(1000);
  });
  test('after "amount"', () => {
    expect(extractAmount('amount: 500')).toBe(500);
  });
  test('after "total"', () => {
    expect(extractAmount('total 750')).toBe(750);
  });
  test('after keyword with colon', () => {
    expect(extractAmount('ยอด: 1,299')).toBe(1299);
  });
});

describe('extractAmount — Method 5: fallback', () => {
  test('picks most frequent number', () => {
    expect(extractAmount('299 299 299 500')).toBe(299);
  });
  test('picks largest when frequencies equal', () => {
    expect(extractAmount('299 500')).toBe(500);
  });
  test('single number', () => {
    expect(extractAmount('299')).toBe(299);
  });
  test('filters out numbers >= 1000000', () => {
    expect(extractAmount('1000000 299')).toBe(299);
  });
  test('filters out zero', () => {
    expect(extractAmount('0 299')).toBe(299);
  });
});

describe('extractAmount — real-world slip patterns', () => {
  test('Thai bank slip format 1', () => {
    expect(extractAmount('ธนาคารกสิกรไทย โอนเงินสำเร็จ จำนวนเงิน 299.00 บาท')).toBe(299);
  });
  test('Thai bank slip format 2', () => {
    expect(extractAmount('พร้อมเพย์ ยอดเงิน: 1,299 บาท สำเร็จ')).toBe(1299);
  });
  test('Thai bank slip format 3', () => {
    expect(extractAmount('转账成功 ฿500.00')).toBe(500);
  });
  test('Thai bank slip format 4', () => {
    expect(extractAmount('SUCCESS amount: 750 THB')).toBe(750);
  });
  test('Thai bank slip format 5 — only numbers', () => {
    expect(extractAmount('299 08:30 HXG Transfer')).toBe(299);
  });
});

describe('extractAmount — edge cases', () => {
  test('empty string returns null', () => {
    expect(extractAmount('')).toBeNull();
  });
  test('only text returns null', () => {
    expect(extractAmount('โอนเงินสำเร็จ')).toBeNull();
  });
  test('newline characters handled', () => {
    expect(extractAmount('จำนวนเงิน\n299\nบาท')).toBe(299);
  });
  test('multiple spaces handled', () => {
    expect(extractAmount('299   บาท')).toBe(299);
  });
  test('very small amount', () => {
    expect(extractAmount('1 บาท')).toBe(1);
  });
  test('large amount', () => {
    expect(extractAmount('99,999 บาท')).toBe(99999);
  });
});
