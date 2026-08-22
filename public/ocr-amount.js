/**
 * OCR amount extraction from slip image using Tesseract.js
 */
async function ocrAmountFromFile(file) {
  var dataUrl = await compressImage(file, 800);

  var result = await Tesseract.recognize(dataUrl, 'tha+eng', {
    logger: function(m) {
      if (m.status === 'recognizing text') {
        var pct = Math.round(m.progress * 100);
        var el = document.getElementById('slipOcrPct');
        if (el) el.textContent = pct + '%';
      }
    }
  });

  var text = result.data.text || '';
  return extractAmount(text);
}

function compressImage(file, maxW) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function() { reject(new Error('ไม่สามารถโหลดรูปได้')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
    reader.readAsDataURL(file);
  });
}

function extractAmount(text) {
  var t = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  console.log('[OCR] Raw text:', t);

  // Method 1: Find number after "บาท" or "Baht"
  var afterBaht = t.match(/(?:บาท|Baht|baht)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i);
  if (afterBaht) {
    var val = parseFloat(afterBaht[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0) {
      console.log('[OCR] Found after บาท:', val);
      return val;
    }
  }

  // Method 2: Find number before "บาท"
  var beforeBaht = t.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:บาท|Baht|baht)/i);
  if (beforeBaht) {
    var val2 = parseFloat(beforeBaht[1].replace(/,/g, ''));
    if (!isNaN(val2) && val2 > 0) {
      console.log('[OCR] Found before บาท:', val2);
      return val2;
    }
  }

  // Method 3: Find number after "฿" symbol
  var afterBathSymbol = t.match(/฿\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (afterBathSymbol) {
    var val3 = parseFloat(afterBathSymbol[1].replace(/,/g, ''));
    if (!isNaN(val3) && val3 > 0) {
      console.log('[OCR] Found after ฿:', val3);
      return val3;
    }
  }

  // Method 4: Find number after keywords like "จำนวน", "เงิน", "ยอด"
  var afterKeyword = t.match(/(?:จำนวน|เงิน|ยอด| amount|total)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i);
  if (afterKeyword) {
    var val4 = parseFloat(afterKeyword[1].replace(/,/g, ''));
    if (!isNaN(val4) && val4 > 0) {
      console.log('[OCR] Found after keyword:', val4);
      return val4;
    }
  }

  // Method 5: Fallback - find largest number that looks like money
  var matches = t.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g);
  if (!matches || matches.length === 0) return null;

  var amounts = matches
    .map(function(m) { return parseFloat(m.replace(/,/g, '')); })
    .filter(function(n) { return !isNaN(n) && n > 0 && n < 1000000; });

  if (amounts.length === 0) return null;

  // Pick most frequent, or largest
  var freq = {};
  amounts.forEach(function(a) { freq[a] = (freq[a] || 0) + 1; });
  var sorted = Object.keys(freq).sort(function(a, b) {
    if (freq[b] !== freq[a]) return freq[b] - freq[a];
    return parseFloat(b) - parseFloat(a);
  });

  console.log('[OCR] Fallback amount:', sorted[0]);
  return parseFloat(sorted[0]);
}
