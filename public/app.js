// Data loaded from /data/patterns.js
var activeSize = 'all';
var picked = {}; // { name: qty }

function generateOrderId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var rand = '';
  for (var i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  var d = new Date();
  var ds = d.getFullYear().toString()
    + ('0' + (d.getMonth() + 1)).slice(-2)
    + ('0' + d.getDate()).slice(-2);
  return 'HXG-' + ds + '-' + rand;
}

function getList() {
  if (activeSize === 'all') return ALL_PATTERNS;
  return ALL_PATTERNS.filter(function(p) { return p.sizeKey === activeSize; });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  if (!s) return '';
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function pickedCount() {
  var c = 0; for (var k in picked) c++; return c;
}

function totalBags() {
  var t = 0; for (var k in picked) t += picked[k]; return t;
}

// ==================== IMAGE LIGHTBOX ====================
var _lbScale = 1, _lbX = 0, _lbY = 0;
var _lbStartDist = 0, _lbStartScale = 1;
var _lbDragging = false, _lbLastX = 0, _lbLastY = 0;

function openImgLightbox(src) {
  var el = document.getElementById('imgLightbox');
  var img = document.getElementById('imgLbImg');
  img.src = src;
  _lbScale = 1; _lbX = 0; _lbY = 0;
  updateLbTransform();
  el.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeImgLightbox(e) {
  if (e && e.target !== document.getElementById('imgLightbox') && e.target.tagName !== 'BUTTON' && !e.target.closest('.img-lb-close')) return;
  document.getElementById('imgLightbox').classList.remove('show');
  document.body.style.overflow = '';
}

function updateLbTransform() {
  document.getElementById('imgLbWrap').style.transform = 'translate(' + _lbX + 'px,' + _lbY + 'px) scale(' + _lbScale + ')';
}

function getTouchDist(t1, t2) {
  var dx = t1.clientX - t2.clientX;
  var dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

(function() {
  var wrap;
  document.addEventListener('DOMContentLoaded', function() {
    wrap = document.getElementById('imgLbWrap');

    wrap.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        _lbStartDist = getTouchDist(e.touches[0], e.touches[1]);
        _lbStartScale = _lbScale;
      } else if (e.touches.length === 1 && _lbScale > 1) {
        _lbDragging = true;
        _lbLastX = e.touches[0].clientX;
        _lbLastY = e.touches[0].clientY;
      }
    }, { passive: false });

    wrap.addEventListener('touchmove', function(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var dist = getTouchDist(e.touches[0], e.touches[1]);
        _lbScale = Math.min(Math.max(_lbStartScale * (dist / _lbStartDist), 1), 4);
        if (_lbScale === 1) { _lbX = 0; _lbY = 0; }
        updateLbTransform();
      } else if (e.touches.length === 1 && _lbDragging) {
        e.preventDefault();
        var dx = e.touches[0].clientX - _lbLastX;
        var dy = e.touches[0].clientY - _lbLastY;
        _lbLastX = e.touches[0].clientX;
        _lbLastY = e.touches[0].clientY;
        _lbX += dx;
        _lbY += dy;
        updateLbTransform();
      }
    }, { passive: false });

    wrap.addEventListener('touchend', function(e) {
      _lbDragging = false;
      if (e.touches.length < 2 && _lbScale <= 1.05) {
        _lbScale = 1; _lbX = 0; _lbY = 0;
        updateLbTransform();
      }
    });

    // Double tap to zoom
    var lastTap = 0;
    wrap.addEventListener('touchend', function(e) {
      if (e.touches.length !== 0) return;
      var now = Date.now();
      if (now - lastTap < 300) {
        if (_lbScale > 1) { _lbScale = 1; _lbX = 0; _lbY = 0; }
        else { _lbScale = 2.5; }
        updateLbTransform();
      }
      lastTap = now;
    });
  });
})();

function buildGallery() {
  var list = getList();
  var html = '';
  list.forEach(function(p) {
    var q = picked[p.name] || 0;
    var isPicked = q > 0;
    var attrName = escAttr(p.name);
    html += '<div class="gcard' + (isPicked ? ' picked' : '') + '" onclick="togglePattern(\'' + attrName + '\')">'
      + '<img class="gimg" src="' + p.img + '" alt="' + escHtml(p.name) + '" />'
      + '<div class="gzoom" onclick="event.stopPropagation();openImgLightbox(\'' + p.img.replace(/'/g, "\\'") + '\')"><i class="ti ti-zoom-in"></i></div>'
      + '<div class="glabel">'
      + '<div class="gname">' + escHtml(p.name) + '</div>'
      + '<div class="gsize">' + escHtml(p.size) + '</div>'
      + '<div class="gprice">' + p.priceOrig.toLocaleString() + ' ฿</div>'
      + '</div>'
      + '<div class="gcheck"><i class="ti ti-check"></i></div>';
    if (isPicked) {
      html += '<div class="gqty" onclick="event.stopPropagation()">'
        + '<button class="gqbtn" onclick="event.stopPropagation();changeQty(\'' + attrName + '\',-1)">−</button>'
        + '<span class="gqnum">' + q + '</span>'
        + '<button class="gqbtn" onclick="event.stopPropagation();changeQty(\'' + attrName + '\',1)">+</button>'
        + '</div>';
    }
    html += '</div>';
  });
  document.getElementById('gallery').innerHTML = html;
  // Stagger entrance animation
  if (!window._galleryLoaded) {
    var cards = document.querySelectorAll('.gcard');
    cards.forEach(function(c, i) {
      c.style.animationDelay = (i * 0.04) + 's';
    });
    window._galleryLoaded = true;
    setTimeout(function() {
      var g = document.getElementById('gallery');
      if (g) g.classList.add('loaded');
    }, 800);
  }
}

function updateSelectedBar() {
  var names = Object.keys(picked);
  var count = names.length;
  document.getElementById('sbCount').textContent = count + ' ลาย';
  document.getElementById('sbClear').style.display = count > 0 ? 'inline' : 'none';
  var chips = document.getElementById('sbChips');
  if (count === 0) {
    chips.innerHTML = '<span class="sb-empty">ยังไม่ได้เลือกลาย กดที่รูปเพื่อเลือกได้เลยค่ะ</span>';
  } else {
    chips.innerHTML = names.map(function(n) {
      var attrName = escAttr(n);
      return '<span class="sb-chip">' + escHtml(n) + ' ×' + picked[n] + '<span class="rm" onclick="removePattern(\'' + attrName + '\')">✕</span></span>';
    }).join('');
  }
  updateSummary();
}

function updateSummary() {
  var el = document.getElementById('sumItems');
  var tb = totalBags();
  var names = Object.keys(picked);
  if (names.length === 0) {
    el.innerHTML = '<div class="sum-empty">เลือกลายเพื่อดูยอดรวมค่ะ</div>';
    return;
  }

  var pricing = computePromoPrice(picked);
  var html = '';

  names.forEach(function(name) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    var q = picked[name];
    var lineTotal = p ? p.priceOrig * q : 0;
    html += '<div class="sum-row"><span>' + escHtml(name) + ' × ' + q + '</span><span>' + lineTotal.toLocaleString() + ' ฿</span></div>';
  });

  html += '<hr class="sum-divider">';

  html += '<div class="sum-total"><span>จำนวนทั้งงหมด</span><span>' + tb + ' ใบ</span></div>';

  var addrEl = document.getElementById('faddress') || document.getElementById('finfo');
  var addr = (addrEl ? addrEl.value : '').trim();
  var shipping = getShippingCost(addr, tb);
  var shippingLabel = shipping === 0 ? 'ค่าจัดส่ง' : (isRemoteArea(addr) ? 'ค่าจัดส่ง (พื้นที่ห่างไกล)' : 'ค่าจัดส่ง');
  html += '<div class="sum-total"><span>' + shippingLabel + '</span><span>' + (shipping === 0 ? 'ฟรี' : shipping + ' ฿') + '</span></div>';

  var grandTotal = pricing.promo + shipping;
  html += '<div class="sum-total" style="color:#d45a8a;font-size:16px;font-weight:800"><span>ยอดรวมทั้งหมด</span><span>' + grandTotal.toLocaleString() + ' ฿</span></div>';

  var szGroups = {};
  names.forEach(function(name) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    if (!p) return;
    if (!szGroups[p.sizeKey]) szGroups[p.sizeKey] = 0;
    szGroups[p.sizeKey] += picked[name];
  });
  var notes = [];
  for (var sk in szGroups) {
    var n = getPromoNote(sk, szGroups[sk]);
    if (n) notes.push(n);
  }
  if (notes.length > 0) {
    html += '<div class="sum-note"><i class="ti ti-gift"></i> ' + notes.join('<br>') + '</div>';
  } else if (tb > 0 && tb < 3) {
    html += '<div class="sum-warn"><i class="ti ti-info-circle"></i> เลือก 3 ใบขึ้นไปเพื่อรับของแถมและส่งฟรีค่ะ!</div>';
  }

  el.innerHTML = html;
}

function togglePattern(name) {
  if (picked[name]) {
    delete picked[name];
  } else {
    var pat = getPatternByName(name);
    if (pat && pat.sizeKey === 'maxi') {
      document.getElementById('maxiPopup').classList.add('show');
    }
    picked[name] = 1;
  }
  buildGallery();
  updateSelectedBar();
}

function closeMaxiPopup(e) {
  if (e && e.target !== document.getElementById('maxiPopup')) return;
  document.getElementById('maxiPopup').classList.remove('show');
}

function changeQty(name, delta) {
  if (!picked[name]) return;
  var newQty = picked[name] + delta;
  if (newQty <= 0) {
    delete picked[name];
  } else {
    picked[name] = newQty;
  }
  buildGallery();
  updateSelectedBar();
}

function removePattern(name) {
  delete picked[name];
  buildGallery();
  updateSelectedBar();
}

function clearAll() {
  picked = {};
  buildGallery();
  updateSelectedBar();
}

// ==================== PAGE SYSTEM ====================
function showPage(page) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(function(l) {
    l.classList.toggle('active', l.dataset.page === page);
  });
  window.scrollTo(0, 0);
  if (page === 'tracking') {
    document.getElementById('tr-all-orders').innerHTML = '';
    document.getElementById('tr-result').innerHTML = '';
    document.getElementById('tr-result').classList.remove('show');
    document.getElementById('tr-phone').value = '';
  }
  if (page === 'wallpaper') { wpBuildGallery(); wpUpdateSelectedBar(); }
  if (page === 'sticker') { stickerBuildGallery(); stickerUpdateSelectedBar(); fetchStickersFromApi(); }
  var targetPage = document.getElementById('page-' + page);
  targetPage.querySelectorAll('.reveal:not(.visible)').forEach(function(el) { el.classList.add('visible'); });
}

// ==================== ORDER ID GENERATOR ====================
function genOrderId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var rand = '';
  for (var i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  var d = new Date();
  var ds = d.getFullYear().toString()
    + ('0' + (d.getMonth() + 1)).slice(-2)
    + ('0' + d.getDate()).slice(-2);
  return 'HXG-' + ds + '-' + rand;
}

// ==================== SAVE ORDER TO LOCALSTORAGE ====================
function saveOrder(order) {
  var orders = JSON.parse(localStorage.getItem('hxg_orders') || '[]');
  orders.unshift(order);
  localStorage.setItem('hxg_orders', JSON.stringify(orders));
}

// ==================== PROMO PRICING ====================
// PROMO_NORMAL, PROMO_LARGE, PROMO_EASY loaded from /data/patterns.js

function getPromoTier(sizeKey, totalBags) {
  var tiers = sizeKey === 'normal' ? PROMO_NORMAL : sizeKey === 'large' ? PROMO_LARGE : PROMO_EASY;
  if (totalBags >= 3) return tiers[2];
  if (totalBags >= 2) return tiers[1];
  if (totalBags >= 1) return tiers[0];
  return null;
}

// computePromoPrice loaded from /data/patterns.js

function getPromoNote(sizeKey, totalBags) {
  if (totalBags < 2) return '';
  var notes = {
    normal: { 2: '+ Griptok + พวงกุญแจ', 3: '🚚 ส่งฟรี + Griptok + พวงกุญแจ + กระเป๋าหูรูดสุ่มลาย 1 ใบ' },
    large:  { 2: '+ Griptok 1 + พวงกุญแจ 1', 3: '🚚 ส่งฟรี + Griptok 2 + พวงกุญแจ 2 + กระเป๋าหูรูดสุ่มลาย 2 ใบ' },
    easy:   { 2: '+ Griptok + พวงกุญแจ', 3: '🚚 ส่งฟรี + Griptok + พวงกุญแจ + กระเป๋าหูรูดสุ่มลาย 1 ใบ' },
    maxi:   { 1: 'แถม Keychain 1', 2: '+ Griptok + พวงกุญแจ 2 + กระเป๋าหูรูดสุ่มลาย 1 ใบ' }
  };
  var tier = totalBags >= 3 ? 3 : totalBags >= 2 ? 2 : 0;
  return tier ? (notes[sizeKey] || {})[tier] || '' : '';
}

// ==================== COMPUTE PRICE (fallback) ====================
function computePrice(patterns, patternQtys) {
  var result = computePromoPrice(patternQtys);
  return result.promo;
}

// ==================== SUBMIT ORDER ====================
function doSubmit() {
  var nameEl = document.getElementById('fname');
  var phoneEl = document.getElementById('fphone');
  var addrEl = document.getElementById('faddress');

  var name = nameEl ? nameEl.value.trim() : '';
  var phone = phoneEl ? phoneEl.value.trim() : '';
  var addr = addrEl ? addrEl.value.trim() : '';

  // Fallback if finfo is present
  if (!name && !phone && !addr && document.getElementById('finfo')) {
    var rawInfo = document.getElementById('finfo').value.trim();
    var lines = rawInfo.split('\n');
    name = lines[0] || '';
    phone = lines.length > 1 ? lines[1] : '';
    addr = lines.length > 2 ? lines.slice(2).join('\n') : '';
  }

  var note = document.getElementById('fnote').value.trim();
  var err = document.getElementById('errMsg');
  var names = Object.keys(picked);

  if (names.length === 0) {
    err.style.display = 'block';
    err.textContent = 'กรุณาเลือกลายอย่างน้อย 1 ลายนะคะ';
    return;
  }

  if (!name) {
    err.style.display = 'block';
    err.textContent = 'กรุณากรอกชื่อ-นามสกุลนะคะ';
    return;
  }

  if (!phone) {
    err.style.display = 'block';
    err.textContent = 'กรุณากรอกเบอร์โทรศัพท์นะคะ';
    return;
  }

  var digits = phone.replace(/[^0-9]/g, '');
  var phonePattern = /^0[689]\d{8}$/;
  if (!phonePattern.test(digits)) {
    err.style.display = 'block';
    err.textContent = 'กรุณากรอกเบอร์โทรศัพท์เป็นตัวเลข 10 หลักติดกันเท่านั้นนะคะ (เช่น 0812345678 ไม่ต้องใส่ขีด)';
    return;
  }
  phone = digits;

  if (!addr) {
    err.style.display = 'block';
    err.textContent = 'กรุณากรอกที่อยู่จัดส่งให้ครบถ้วนนะคะ';
    return;
  }

  err.style.display = 'none';

  var combinedInfo = name + '\n' + phone + '\n' + addr;
  var tb = totalBags();
  var pricing = computePromoPrice(picked);
  var isRemote = isRemoteArea(addr);
  var shippingCost = tb >= 3 ? 0 : (isRemote ? REMOTE_SHIPPING : BASE_SHIPPING);

  showConfirm({
    customer_name: name,
    customer_phone: phone,
    customer_address: addr,
    customer_info: combinedInfo,
    patterns: names,
    pattern_qtys: Object.assign({}, picked),
    total_bags: tb,
    original_price: pricing.original,
    total_price: pricing.promo,
    shipping_cost: shippingCost,
    is_remote: isRemote,
    note: note,
  });
}

function showConfirm(data) {
  var items = data.patterns.map(function(n) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === n; });
    var q = data.pattern_qtys[n] || 1;
    return '<div class="modal-pattern"><span>' + escHtml(n) + ' × ' + q + '</span><span>' + (p ? p.priceOrig * q + ' ฿' : '—') + '</span></div>';
  }).join('');

  var html = '<div class="modal-row"><span class="modal-row-label">ลายที่เลือก</span><span class="modal-row-val">' + data.patterns.length + ' ลาย</span></div>'
    + '<div class="modal-patterns">' + items + '</div>'
    + '<div class="modal-row"><span class="modal-row-label">จำนวนทั้งหมด</span><span class="modal-row-val">' + data.total_bags + ' ใบ</span></div>';

  var shippingLabel = data.is_remote && data.shipping_cost > 0 ? 'ค่าจัดส่ง (พื้นที่ห่างไกล)' : 'ค่าจัดส่ง';
  html += '<div class="modal-row"><span class="modal-row-label">' + shippingLabel + '</span><span class="modal-row-val">' + (data.shipping_cost === 0 ? 'ฟรี' : data.shipping_cost + ' ฿') + '</span></div>';
  html += '<div class="modal-row"><span class="modal-row-label">ยอดรวม</span><span class="modal-row-val price">' + (data.total_price + data.shipping_cost).toLocaleString() + ' ฿</span></div>';

  var custHtml = (data.customer_name ? '<div style="font-weight:700;color:#c04070">👤 ' + escHtml(data.customer_name) + '</div>' : '')
    + (data.customer_phone ? '<div style="font-weight:600;color:#605060;margin-top:2px">📞 ' + escHtml(data.customer_phone) + '</div>' : '')
    + (data.customer_address ? '<div style="color:#706070;margin-top:4px">📍 ' + escHtml(data.customer_address).replace(/\n/g, '<br>') + '</div>' : '<div style="color:#706070">' + escHtml(data.customer_info || '').replace(/\n/g, '<br>') + '</div>');

  html += '<div class="modal-customer">' + custHtml + '</div>';

  if (data.note) {
    html += '<div style="font-size:12px;color:#a09098;margin-top:6px">📝 ' + escHtml(data.note) + '</div>';
  }

  document.getElementById('confirmBody').innerHTML = html;
  document.getElementById('confirmModal').classList.remove('hidden');
  window._pendingOrder = data;
}

function closeConfirm(e) {
  if (e && e.target !== document.getElementById('confirmModal')) return;
  document.getElementById('confirmModal').classList.add('hidden');
  window._pendingOrder = null;
}

function submitOrder() {
  var data = window._pendingOrder;
  if (!data) return;

  document.getElementById('confirmModal').classList.add('hidden');

  var order = Object.assign({}, data);
  order.id = generateOrderId();
  order.status = 0;
  order.created_at = new Date().toISOString();
  window._pendingOrderData = order;

  renderThankYou(order);
  showPage('thankyou');
  window._pendingOrder = null;
}

// ==================== RENDER THANK YOU ====================

function renderThankYou(order) {
  var pq = order.pattern_qtys || {};
  var items = order.patterns.map(function(name) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    var q = pq[name] || order.qty || 1;
    var price = p ? p.priceOrig * q : 0;
    var img = p ? '<img class="tr-img-thumb" src="' + p.img + '" alt="' + escHtml(name) + '">' : '';
    return '<div class="ty-item">' + img + '<span class="ty-item-name">' + escHtml(name) + ' × ' + q + '</span><span>' + price.toLocaleString() + ' ฿</span></div>';
  }).join('');

  var d = new Date(order.created_at);
  var dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  var freebieHtml = '';
  var szGroups = {};
  (order.patterns || []).forEach(function(name) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    if (!p) return;
    var q = pq[name] || order.qty || 1;
    if (!szGroups[p.sizeKey]) szGroups[p.sizeKey] = 0;
    szGroups[p.sizeKey] += q;
  });
  var fbNotes = [];
  for (var sk in szGroups) {
    var n = getPromoNote(sk, szGroups[sk]);
    if (n) fbNotes.push(n);
  }
  if (fbNotes.length > 0) {
    freebieHtml = '<div class="sum-note" style="margin:8px 0 0;font-size:16px;display:block;line-height:1.6"><i class="ti ti-gift"></i> ' + fbNotes.join('<br>') + '</div>';
  }

  var html = '<div class="ty-card">'
    + '<div class="ty-gif"><img src="images/barbie.gif" alt="Thank you" style="width:100%;max-width:350px;border-radius:16px;margin:0 auto 20px;display:block;box-shadow:0 8px 30px rgba(212,90,138,0.25)"></div>'
    + '<div class="ty-icon"><i class="ti ti-circle-check"></i></div>'
    + '<div class="ty-title">รอยืนยันสลิป 🎀</div>'
    + '<div class="ty-sub"></div>'
    + '<div class="ty-orderid"><div class="ty-orderid-label">รหัสออเดอร์ของคุณ</div><div class="ty-orderid-val">' + order.id + '</div></div>'
    + '<div class="ty-items">'
    + '<div class="sum-title" style="margin-bottom:10px;">สรุปที่สั่ง</div>'
    + items
    + freebieHtml
    + '<hr class="sum-divider">';

  var shippingCost = (order.shipping_cost != null ? order.shipping_cost : BASE_SHIPPING);
  if (order.total_bags >= 3) shippingCost = 0;
  var grandTotal = order.total_price + shippingCost;
  var shippingLabel = order.is_remote && shippingCost > 0 ? 'ค่าจัดส่ง (พื้นที่ห่างไกล)' : 'ค่าจัดส่ง';
  html += '<div class="ty-total-row"><span>ยอดสินค้า</span><span>' + order.total_price.toLocaleString() + ' ฿</span></div>'
    + '<div class="ty-total-row"><span>' + shippingLabel + '</span><span>' + (shippingCost === 0 ? 'ฟรี' : shippingCost + ' ฿') + '</span></div>'
    + '<div class="ty-total-row" style="font-weight:800;color:#d45a8a"><span>ยอดรวมทั้งหมด</span><span>' + grandTotal.toLocaleString() + ' ฿</span></div>'
    + '<div class="ty-total-row"><span>จำนวน</span><span>' + order.total_bags + ' ใบ</span></div>'
    + '</div>'
    + '<div style="text-align:center;margin:20px 0;padding:20px;background:linear-gradient(135deg,#fff0f5,#f8f0ff);border-radius:16px;border:1.5px solid #f0d0e0">'
    + '<div style="font-size:14px;font-weight:800;color:#c04878;margin-bottom:12px">ชำระเงิน</div>'
    + '<img src="images/qrcode.jpeg" style="width:100%;max-width:300px;border-radius:12px;border:2px solid #f0d0e0;margin-bottom:16px" alt="QR Code">'
    + '<div style="font-size:16px;font-weight:800;color:#d45a8a;margin-bottom:8px">‎‎𐙚♡︎ thankyou ⌗ ‎♡°✧‧₊˚</div>'
    + '<div style="font-size:14px;color:#555;margin-bottom:4px">𓇼 <strong>749-2439-414</strong> 𝙺𝚋𝚊𝚗𝚔</div>'
    + '<button onclick="copyAccount()" id="copyBtn" style="background:#d45a8a;color:white;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;margin:10px 0;transition:all .15s">📋 กดคัดลอกเลขบัญชี</button>'
    + '<div style="font-size:13px;color:#555">°•🎨⋆.˚ Name <strong>Nichakarn E.</strong></div>'
    + '<div style="font-size:11px;color:#a09098;margin-top:10px">ติดตามผ่านทางแชทไลน์@ได้เลยค่ะ</div>'
    + '</div>'
    + '<div style="font-size:12px;color:#c08090;margin-bottom:12px;">สั่งเมื่อ: ' + dateStr + '</div>'
    + '<div class="slip-section" id="slipSection">'
    + '<div class="badge-group" style="display:flex;justify-content:center;gap:8px;margin-bottom:12px;">'
    + '<span style="background:#e8fce8;color:#208020;border:1px solid #a0d8a0;font-size:11px;font-weight:800;padding:4px 12px;border-radius:99px;display:inline-flex;align-items:center;gap:5px;"><span>⚡</span> EasySlip API v2</span>'
    + '<span style="background:#f0e8ff;color:#6040a0;border:1px solid #d0b8f0;font-size:11px;font-weight:800;padding:4px 12px;border-radius:99px;display:inline-flex;align-items:center;gap:5px;"><span>🔒</span> ตรวจสอบสลิปอัตโนมัติ</span>'
    + '</div>'
    + '<div class="slip-title"><i class="ti ti-upload"></i> อัปโหลดสลิปโอนเงิน</div>'
    + '<div class="slip-desc">แนบรูปสลิปธนาคารเพื่อตรวจสอบยอดเงิน ผู้โอน-ผู้รับ และยืนยันออเดอร์ค่ะ</div>'
    + '<div class="slip-drop" id="slipDrop" onclick="document.getElementById(\'slipInput\').click()" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="event.preventDefault();this.classList.remove(\'dragover\');handleSlipFile(event.dataTransfer.files[0])">'
    + '<div style="font-size:38px;margin-bottom:8px">🧾</div>'
    + '<div style="font-size:14px;font-weight:700;color:#c04878">ลากรูปสลิปมาวางตรงนี้ หรือ <strong style="color:#d45a8a">แตะเพื่อเลือกรูป</strong></div>'
    + '<div style="font-size:11px;color:#a09098;margin-top:4px">(รองรับ JPG, PNG, WEBP ไม่เกิน 5 MB)</div>'
    + '</div>'
    + '<input type="file" id="slipInput" accept="image/*" style="display:none" onchange="handleSlipFile(this.files[0])"/>'
    + '<div class="slip-preview hidden" id="slipPreview">'
    + '<div style="position:relative;display:inline-block;max-width:100%;">'
    + '<img id="slipPreviewImg" src="" alt="สลีป" style="max-height:300px;border-radius:12px;border:2px solid #f0d0e0;"/>'
    + '<button type="button" onclick="cancelSlip()" title="ลบรูป" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .2s;">✕</button>'
    + '</div>'
    + '<div class="slip-actions" style="margin-top:12px;">'
    + '<button class="slip-btn slip-btn-cancel" onclick="cancelSlip()"><i class="ti ti-x"></i> เปลี่ยนรูป</button>'
    + '<button class="slip-btn slip-btn-upload" id="slipUploadBtn" onclick="confirmOrder(\'' + escAttr(order.id) + '\')"><i class="ti ti-circle-check"></i> ตรวจสอบสลิป & ยืนยันการสั่งซื้อ</button>'
    + '</div>'
    + '</div>'
    + '<div class="hidden" id="slipVerifyResult"></div>'
    + '<div class="slip-done hidden" id="slipDone"><i class="ti ti-circle-check"></i> ตรวจสอบสลิปและยืนยันการสั่งซื้อสำเร็จแล้วค่ะ! 🎉</div>'
    + '<div class="slip-err hidden" id="slipErr"></div>'
    + '</div>'
    + '<button class="ty-btn-out" onclick="resetAndOrder()"><i class="ti ti-shopping-cart"></i> สั่งซื้ออีกครั้ง</button>'
    + '</div>';

  document.getElementById('ty-content').innerHTML = html;
  window._currentOrderId = order.id;
}

function resetAndOrder() {
  picked = {};
  if (document.getElementById('fname')) document.getElementById('fname').value = '';
  if (document.getElementById('fphone')) document.getElementById('fphone').value = '';
  if (document.getElementById('faddress')) document.getElementById('faddress').value = '';
  if (document.getElementById('fnote')) document.getElementById('fnote').value = '';
  if (document.getElementById('finfo')) document.getElementById('finfo').value = '';
  buildGallery();
  updateSelectedBar();
  showPage('preorder');
  showWelcomePopup();
}

// ==================== TRACKING ====================
function trackSearch() {
  var phoneVal = document.getElementById('tr-phone').value.trim();
  var resultEl = document.getElementById('tr-result');

  if (!phoneVal) { resultEl.innerHTML = ''; resultEl.classList.remove('show'); return; }

  resultEl.innerHTML = '<div style="text-align:center;padding:20px;color:#a08090"><i class="ti ti-loader" style="font-size:24px;animation:spin 1s linear infinite"></i><br>กำลังค้นหา...</div>';
  resultEl.classList.add('show');

  fetch('/api/track/phone/' + encodeURIComponent(phoneVal))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error || !data.orders || data.orders.length === 0) {
        resultEl.innerHTML = '<div class="tr-not-found"><i class="ti ti-mood-sad"></i><br>ไม่พบออเดอร์จากเบอร์นี้ค่ะ</div>';
        resultEl.classList.add('show');
        return;
      }
      resultEl.innerHTML = data.orders.map(renderOrderCard).join('');
      resultEl.classList.add('show');
    })
    .catch(function() {
      resultEl.innerHTML = '<div class="tr-not-found"><i class="ti ti-mood-sad"></i><br>เกิดข้อผิดพลาด กรุณาลองใหม่</div>';
      resultEl.classList.add('show');
    });
}

function loadAllOrders() {
  var el = document.getElementById('tr-all-orders');
  el.innerHTML = '<div class="tr-card tr-empty-state"><div class="tr-empty-icon"><i class="ti ti-search"></i></div><div class="tr-empty-title">กรอกเบอร์โทรศัพท์หรือรหัสออเดอร์เพื่อค้นหา</div></div>';
}

var STATUS_CLASS = ['s0', 's1', 's2', 's3'];

function renderOrderCard(order) {
  var statuses = ['รอยืนยัน', 'ยืนยันแล้ว', 'กำลังผลิต', 'จัดส่งแล้ว'];
  var statusIcons = ['ti-clock', 'ti-circle-check', 'ti-tool', 'ti-truck'];
  var d = new Date(order.created_at);
  var dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });

  var tlHtml = statuses.map(function(s, i) {
    var isDone = i < order.status;
    var isCurrent = i === order.status;
    var dotClass = isDone ? 'done' : (isCurrent ? 'current' : '');
    return '<div class="tr-tl-step">'
      + '<div class="tr-tl-dot-col"><div class="tr-tl-dot ' + dotClass + '"></div>' + (i < statuses.length - 1 ? '<div class="tr-tl-line"></div>' : '') + '</div>'
      + '<div class="tr-tl-text"><div class="tr-tl-label">' + s + '</div></div>'
      + '</div>';
  }).join('');

  var pq = order.pattern_qtys || {};
  var itemsHtml = (order.patterns || []).map(function(name) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; })
      || (typeof getStickerByName === 'function' ? getStickerByName(name) : null)
      || (typeof WP_PATTERNS !== 'undefined' ? WP_PATTERNS.find(function(x) { return x.name === name; }) : null);
    var img = p && p.img ? '<img class="tr-img-thumb" src="' + p.img + '" alt="' + escHtml(name) + '">' : '<div class="tr-img-thumb" style="background:#fadadd;"></div>';
    var q = pq[name] || order.qty || 1;
    var unitPrice = p ? (p.priceOrig || p.price || 0) : 0;
    var price = unitPrice * q;
    var unitLabel = order.type === 'sticker' ? 'ชุด' : order.type === 'wallpaper' ? 'ลาย' : 'ใบ';
    return '<div class="tr-item-row">' + img + '<div><div class="tr-item-name">' + escHtml(name) + '</div><div class="tr-item-size">×' + q + ' ' + unitLabel + '</div></div><div class="tr-item-price">' + (price ? price.toLocaleString() + ' ฿' : '') + '</div></div>';
  }).join('');

  var unitLabel = order.type === 'sticker' ? 'ชุด' : order.type === 'wallpaper' ? 'ลาย' : 'ใบ';
  var html = '<div class="tr-order-card" style="margin-bottom:12px;">'
    + '<div class="tr-order-head"><span class="tr-order-id"><i class="ti ti-tag"></i> ' + order.id + '</span><span class="tr-status-badge ' + STATUS_CLASS[order.status] + '"><i class="ti ' + statusIcons[order.status] + '"></i> ' + statuses[order.status] + '</span></div>'
    + '<div class="tr-timeline">' + tlHtml + '</div>'
    + '<div style="font-size:12px;font-weight:800;color:#c04878;margin-bottom:8px;">สินค้าที่สั่ง</div>'
    + itemsHtml
    + '<div class="tr-detail-row"><span class="tr-detail-label">ยอดสินค้า</span><span class="tr-detail-val">' + (order.total_price || 0).toLocaleString() + ' ฿</span></div>'
    + '<div class="tr-detail-row"><span class="tr-detail-label">ค่าจัดส่ง' + (order.is_remote && order.total_bags < 3 ? ' (พื้นที่ห่างไกล)' : '') + '</span><span class="tr-detail-val">' + (order.total_bags >= 3 ? 'ฟรี' : ((order.shipping_cost != null ? order.shipping_cost : 50) + ' ฿')) + '</span></div>'
    + '<div class="tr-detail-row"><span class="tr-detail-label">ยอดรวมทั้งหมด</span><span class="tr-detail-val" style="font-weight:800;color:#d45a8a">' + ((order.total_price || 0) + (order.total_bags >= 3 ? 0 : (order.shipping_cost != null ? order.shipping_cost : 50))).toLocaleString() + ' ฿</span></div>'
    + '<div class="tr-detail-row"><span class="tr-detail-label">จำนวน</span><span class="tr-detail-val">' + (order.total_bags || 0) + ' ' + unitLabel + '</span></div>'
    + '<div class="tr-detail-row"><span class="tr-detail-label">สั่งเมื่อ</span><span class="tr-detail-val">' + dateStr + '</span></div>';

  var contactDisplay = (order.customer_name ? '<strong>' + escHtml(order.customer_name) + '</strong><br>' : '')
    + (order.customer_phone ? '📞 ' + escHtml(order.customer_phone) + '<br>' : '')
    + (order.customer_address ? '📍 ' + escHtml(order.customer_address).replace(/\n/g, '<br>') : (order.customer_info || '').replace(/\n/g, '<br>'));

  return html + '<div class="tr-detail-row"><span class="tr-detail-label">ข้อมูลติดต่อ</span><span class="tr-detail-val" style="max-width:65%;text-align:right;word-break:break-word;">' + contactDisplay + '</span></div>'
    + '<div style="margin-top:14px;padding-top:14px;border-top:1.5px dashed #f5c8d8">'
    + '<div style="font-size:12px;font-weight:800;color:#c04878;margin-bottom:8px;"><i class="ti ti-truck"></i> สถานะจัดส่ง</div>'
    + (order.tracking_number
      ? '<div class="tr-detail-row"><span class="tr-detail-label">📦 เลข tracking</span><span class="tr-detail-val" style="color:#30a030;font-weight:700;display:flex;align-items:center;gap:6px;">'
        + (order.tracking_carrier ? '<span style="background:#f0e0ff;color:#6040a0;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap;">' + escHtml(order.tracking_carrier) + '</span> ' : '')
        + escHtml(order.tracking_number)
        + ' <button class="copyBtn" id="cp-' + order.id + '" onclick="copyTracking(\'' + escAttr(order.tracking_number) + '\', \'cp-' + order.id + '\')" style="background:#d45a8a;color:white;border:none;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:3px;"><i class="ti ti-copy"></i> คัดลอก</button></span></div>'
      : '<div class="tr-detail-row"><span class="tr-detail-label">📦 เลข tracking</span><span class="tr-detail-val" style="color:#c0b0b8;font-style:italic">ยังไม่มี — รอแอดมินใส่เลขให้นะคะ</span></div>')
    + '</div>'
    + '</div>';
}

// ==================== SLIP UPLOAD ====================
function handleSlipFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('ไฟล์รูปต้องไม่เกิน 5 MB ค่ะ');
    return;
  }
  window._slipFile = file;
  // Compress image to reduce memory before storing base64
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      // Use original file base64 to prevent QR code blurring
      window._slipData = e.target.result;
      document.getElementById('slipPreviewImg').src = window._slipData;
      document.getElementById('slipDrop').classList.add('hidden');
      document.getElementById('slipPreview').classList.remove('hidden');

      // Auto verify slip after uploading
      var btn = document.getElementById('slipUploadBtn');
      if (btn) {
        btn.click();
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function cancelSlip() {
  window._slipData = null;
  window._slipFile = null;
  document.getElementById('slipInput').value = '';
  document.getElementById('slipPreview').classList.add('hidden');
  document.getElementById('slipDrop').classList.remove('hidden');
  document.getElementById('slipDone').classList.add('hidden');
  document.getElementById('slipDone').style.color = '';
  document.getElementById('slipErr').classList.add('hidden');
  document.getElementById('slipVerifyResult').classList.add('hidden');
  document.getElementById('slipVerifyResult').innerHTML = '';
  var btn = document.getElementById('slipUploadBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> ยืนยันการสั่งซื้อ';
  }
}

// ==================== SLIP VERIFY RESULT BUILDER ====================
function buildVerifyResultCard(order, isSuccess, errorMsg, expectedAmountOverride) {
  var sObj = order.sender || {};
  var senderName = order.slip_sender_name || order.senderName || (typeof sObj === 'string' ? sObj : (sObj.name || (sObj.account && sObj.account.name && (sObj.account.name.th || sObj.account.name.en || sObj.account.name)))) || '';
  var senderBank = order.slip_bank || order.senderBank || (typeof sObj === 'object' && sObj.bank ? (sObj.bank.name || sObj.bank.short || sObj.bank) : '') || '';
  var senderAcc = order.senderAccount || (typeof sObj === 'object' && sObj.account ? (sObj.account.bank ? sObj.account.bank.account : sObj.account.account) : '') || '';

  var sParts = [];
  if (senderName && senderName !== '—') sParts.push(senderName);
  if (senderBank && senderBank !== '—' && senderBank !== senderName) sParts.push(senderBank);
  if (senderAcc && senderAcc !== '—') sParts.push('(' + senderAcc + ')');
  var senderDisplay = sParts.length > 0 ? sParts.join(' • ') : '—';

  var rObj = order.receiver || {};
  var receiverName = order.slip_receiver_name || order.receiverName || (typeof rObj === 'string' ? rObj : (rObj.name || (rObj.account && rObj.account.name && (rObj.account.name.th || rObj.account.name.en || rObj.account.name)))) || 'บจก. helloxglitter / นิชากานต์ เอี่ยมสอาด';
  var receiverBank = order.slip_receiver_bank || order.receiverBank || (typeof rObj === 'object' && rObj.bank ? (rObj.bank.name || rObj.bank.short || rObj.bank) : '') || 'ธนาคารกสิกรไทย (KBANK)';
  var receiverAcc = order.receiverAccount || (typeof rObj === 'object' && rObj.account ? (rObj.account.bank ? rObj.account.bank.account : rObj.account.account) : '') || '';

  var rParts = [];
  if (receiverName && receiverName !== '—') rParts.push(receiverName);
  if (receiverBank && receiverBank !== '—' && receiverBank !== receiverName) rParts.push(receiverBank);
  if (receiverAcc && receiverAcc !== '—') rParts.push('(' + receiverAcc + ')');
  var receiverDisplay = rParts.length > 0 ? rParts.join(' • ') : 'บจก. helloxglitter / นิชากานต์ เอี่ยมสอาด • ธนาคารกสิกรไทย (KBANK)';

  var transRef = order.slip_trans_ref || order.transRef || '—';
  var rawAmount = (order.slip_amount != null ? order.slip_amount : (order.amount != null ? order.amount : null));
  var amount = rawAmount != null ? Number(rawAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  
  var expectedAmount = expectedAmountOverride;
  if (expectedAmount == null) {
    expectedAmount = (order.total_price || 0) + (order.shipping_cost != null ? order.shipping_cost : 0);
    if (order.total_bags >= 3 && !order.is_remote) expectedAmount = order.total_price || 0;
  }

  var dateStr = '—';
  if (order.slip_date || order.date || order.slip_uploaded_at || order.created_at) {
    try {
      var d = new Date(order.slip_date || order.date || order.slip_uploaded_at || order.created_at);
      dateStr = d.toLocaleString('th-TH');
    } catch(e) { dateStr = '—'; }
  }

  var isDup = (order.is_duplicate === true || order.isDuplicate === true);
  var dupBadge = isDup
    ? '<span class="sv-row-val sv-mismatch">⚠️ สลิปซ้ำ (เคยใช้ในระบบแล้ว)<span class="sv-row-badge sv-badge-fail">ไม่อนุมัติ</span></span>'
    : '<span class="sv-row-val sv-match">✓ สลิปใหม่ ไม่เคยใช้งาน<span class="sv-row-badge sv-badge-ok">✅ ผ่าน</span></span>';

  if (isSuccess) {
    var amountHtml;
    if (amount != null) {
      var amountMatch = Math.abs(Number(rawAmount) - expectedAmount) < 0.01;
      amountHtml = '<span class="sv-row-val ' + (amountMatch ? 'sv-match' : 'sv-mismatch') + '" style="font-size:15px;font-weight:800">' + amount + ' ฿<span class="sv-row-badge ' + (amountMatch ? 'sv-badge-ok' : 'sv-badge-fail') + '">' + (amountMatch ? '✅ ตรงกับยอดสั่งซื้อ' : '⚠️ ไม่ตรงยอดสั่งซื้อ') + '</span></span>';
    } else {
      amountHtml = '<span class="sv-row-val" style="color:#a09098;font-style:italic">ไม่สามารถอ่านยอดได้</span>';
    }

    return '<div class="slip-verify-card sv-success">'
      + '<div class="sv-header">'
      + '<div class="sv-header-icon"><i class="ti ti-circle-check"></i></div>'
      + '<div class="sv-header-text">'
      + '<div class="sv-header-title">ตรวจสอบสลิปสำเร็จ (ของจริง 100%)</div>'
      + '<div class="sv-header-sub">ตรวจสอบผ่านระบบ EasySlip เรียบร้อยแล้วค่ะ</div>'
      + '</div>'
      + '</div>'
      + '<div class="sv-rows">'
      + '<div class="sv-row"><span class="sv-row-icon">💰</span><span class="sv-row-label">ยอดเงินที่โอน</span>' + amountHtml + '</div>'
      + '<div class="sv-row"><span class="sv-row-icon">⚡</span><span class="sv-row-label">สถานะสลิปซ้ำ</span>' + dupBadge + '</div>'
      + '<div class="sv-row"><span class="sv-row-icon">👤</span><span class="sv-row-label">ผู้โอน (Sender)</span><span class="sv-row-val" style="font-weight:600">' + escHtml(senderDisplay) + '</span></div>'
      + '<div class="sv-row"><span class="sv-row-icon">📥</span><span class="sv-row-label">ผู้รับเงิน (Receiver)</span><span class="sv-row-val" style="font-weight:600">' + escHtml(receiverDisplay) + '</span></div>'
      + '</div>'
      + '</div>';
  } else {
    // FAILED — show error card with 4 detected fields
    var failAmountHtml;
    if (amount != null) {
      failAmountHtml = '<span class="sv-row-val sv-mismatch" style="font-size:15px;font-weight:800">' + amount + ' ฿<span class="sv-row-badge sv-badge-fail">⚠️ ยอดที่ต้องจ่าย: ' + Number(expectedAmount).toLocaleString() + ' ฿</span></span>';
    } else {
      failAmountHtml = '<span class="sv-row-val sv-mismatch">ไม่สามารถอ่านยอดเงินได้</span>';
    }

    return '<div class="slip-verify-card sv-error">'
      + '<div class="sv-header">'
      + '<div class="sv-header-icon"><i class="ti ti-alert-circle"></i></div>'
      + '<div class="sv-header-text">'
      + '<div class="sv-header-title">ตรวจสอบสลิปไม่ผ่าน</div>'
      + '<div class="sv-header-sub">' + escHtml(errorMsg || 'ข้อมูลในสลิปไม่ตรงตามเงื่อนไข') + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="sv-rows">'
      + '<div class="sv-row"><span class="sv-row-icon">💰</span><span class="sv-row-label">ยอดในสลิป</span>' + failAmountHtml + '</div>'
      + '<div class="sv-row"><span class="sv-row-icon">⚡</span><span class="sv-row-label">สถานะสลิปซ้ำ</span>' + dupBadge + '</div>'
      + '<div class="sv-row"><span class="sv-row-icon">👤</span><span class="sv-row-label">ผู้โอน (Sender)</span><span class="sv-row-val" style="font-weight:600">' + escHtml(senderDisplay) + '</span></div>'
      + '<div class="sv-row"><span class="sv-row-icon">📥</span><span class="sv-row-label">ผู้รับเงิน (Receiver)</span><span class="sv-row-val" style="font-weight:600">' + escHtml(receiverDisplay) + '</span></div>'
      + '</div>'
      + '</div>';
  }
}

function confirmOrder(orderId) {
  if (!window._slipData) return;
  if (!window._slipFile) { alert('กรุณาเลือกรูปสลีปใหม่'); return; }
  var btn = document.getElementById('slipUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> กำลังตรวจสอบสลิป...';
  document.getElementById('slipErr').classList.add('hidden');
  document.getElementById('slipVerifyResult').classList.add('hidden');
  document.getElementById('slipVerifyResult').innerHTML = '';

  var orderData = window._pendingOrderData;
  if (!orderData) {
    document.getElementById('slipErr').textContent = 'ข้อมูลออเดอร์หายไป กรุณาสั่งซื้อใหม่';
    document.getElementById('slipErr').classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> ยืนยันการสั่งซื้อ';
    return;
  }

  fetch('/api/orders/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order: orderData,
      slip_data: window._slipData,
    }),
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        document.getElementById('slipErr').textContent = data.error;
        document.getElementById('slipErr').classList.remove('hidden');

        var expAmt = (orderData.total_price || 0) + (orderData.shipping_cost != null ? orderData.shipping_cost : 0);
        if (orderData.total_bags >= 3 && !orderData.is_remote) expAmt = orderData.total_price || 0;

        var errCard = buildVerifyResultCard(data.verifyDetails || {}, false, data.error, expAmt);
        document.getElementById('slipVerifyResult').innerHTML = errCard;
        document.getElementById('slipVerifyResult').classList.remove('hidden');

        document.getElementById('slipPreview').classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-circle-check"></i> ตรวจสอบสลิป & ยืนยันการสั่งซื้ออีกครั้ง';
        return;
      }

      // SUCCESS — show verification result card
      document.getElementById('slipPreview').classList.add('hidden');
      document.getElementById('slipDrop').classList.add('hidden');
      saveOrder(data.order);

      // Build and show verification result
      var verifyHtml = buildVerifyResultCard(data.order, true);
      document.getElementById('slipVerifyResult').innerHTML = verifyHtml;
      document.getElementById('slipVerifyResult').classList.remove('hidden');

      document.getElementById('slipDone').innerHTML = '<i class="ti ti-circle-check"></i> ตรวจสอบสลิปและยืนยันการสั่งซื้อสำเร็จแล้วค่ะ! 🎉';
      document.getElementById('slipDone').classList.remove('hidden');
      document.getElementById('slipDone').style.color = '#30a030';
      window._slipData = null;
      window._slipFile = null;
      window._pendingOrderData = null;
    })
    .catch(function(err) {
      document.getElementById('slipErr').textContent = 'เกิดข้อผิดพลาด: ' + err.message;
      document.getElementById('slipErr').classList.remove('hidden');
      document.getElementById('slipPreview').classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-circle-check"></i> ยืนยันการสั่งซื้อ';
    });
}


// ==================== COPY ACCOUNT ====================
function copyAccount() {
  var account = '749-2439-414';
  var btn = document.getElementById('copyBtn');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(account).then(function() {
      btn.textContent = '✅ คัดลอกแล้ว!';
      btn.style.background = '#30a030';
      setTimeout(function() {
        btn.textContent = '📋 กดคัดลอกเลขบัญชี';
        btn.style.background = '#d45a8a';
      }, 2000);
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = account;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✅ คัดลอกแล้ว!';
    btn.style.background = '#30a030';
    setTimeout(function() {
      btn.textContent = '📋 กดคัดลอกเลขบัญชี';
      btn.style.background = '#d45a8a';
    }, 2000);
  }
}

function copyTracking(trackNum, btnId) {
  var btn = document.getElementById(btnId);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(trackNum).then(function() {
      btn.innerHTML = '<i class="ti ti-check"></i> คัดลอกแล้ว';
      setTimeout(function() { btn.innerHTML = '<i class="ti ti-copy"></i> คัดลอก'; }, 2000);
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = trackNum;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.innerHTML = '<i class="ti ti-check"></i> คัดลอกแล้ว';
    setTimeout(function() { btn.innerHTML = '<i class="ti ti-copy"></i> คัดลอก'; }, 2000);
  }
}

// ==================== MUSIC PLAYER ====================
function toggleMusic() {
  var player = document.getElementById('musicPlayer');
  var btn = document.getElementById('musicBtn');
  if (player.classList.contains('hidden')) {
    player.classList.remove('hidden');
    btn.style.display = 'none';
  } else {
    player.classList.add('hidden');
    btn.style.display = 'flex';
  }
}

function autoPlayMusic() {
  var audio = document.getElementById('bgMusic');
  if (!audio) return;
  var btn = document.getElementById('mcPlayBtn');
  audio.volume = 0.3;
  var playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.then(function() {
      btn.innerHTML = '<i class="ti ti-player-stop"></i>';
    }).catch(function() {});
  }
}

function musicPlay() {
  var audio = document.getElementById('bgMusic');
  if (!audio) return;
  var btn = document.getElementById('mcPlayBtn');
  audio.volume = parseFloat(document.getElementById('mcVolume').value);
  if (audio.paused) {
    audio.play();
    btn.innerHTML = '<i class="ti ti-player-stop"></i>';
  } else {
    audio.pause();
    btn.innerHTML = '<i class="ti ti-player-play"></i>';
  }
}

function musicPause() {
  var audio = document.getElementById('bgMusic');
  if (audio) audio.pause();
}

function musicVolume(val) {
  var audio = document.getElementById('bgMusic');
  if (audio) audio.volume = parseFloat(val);
}

// ==================== WELCOME POPUP ====================
function selectPage(page) {
  document.getElementById('welcomePopup').classList.add('hidden');
  if (page === 'checklink') { window.location.href = '/checklink/'; return; }
  showPage(page);
}

function showWelcomePopup() {
  document.getElementById('welcomePopup').classList.remove('hidden');
}

// ==================== STICKER PAGE ====================
var stickerPicked = {}; // { name: qty }
window._stickerSlipData = null;
window._stickerSlipFile = null;

function fetchStickersFromApi() {
  return fetch('/api/stickers')
    .then(function(res) {
      if (!res.ok) throw new Error('API status ' + res.status);
      return res.json();
    })
    .then(function(data) {
      if (data && data.stickers && Array.isArray(data.stickers) && data.stickers.length > 0) {
        window.STICKER_PATTERNS = data.stickers;
        stickerBuildGallery();
        stickerUpdateSelectedBar();
      }
    })
    .catch(function(err) {
      console.warn('[Sticker] Using default sticker list:', err);
    });
}

function stickerBuildGallery() {
  var gallery = document.getElementById('stickerGallery');
  var patterns = (typeof window !== 'undefined' && window.STICKER_PATTERNS) || (typeof STICKER_PATTERNS !== 'undefined' ? STICKER_PATTERNS : []);
  if (!gallery || !patterns.length) return;
  gallery.innerHTML = patterns.map(function(p) {
    var isPicked = !!stickerPicked[p.name];
    var q = stickerPicked[p.name] || 0;
    var attrName = escAttr(p.name);
    var imgSrc = p.img || '';
    var safeImg = imgSrc.replace(/'/g, "\\'");
    var h = '<div class="gcard' + (isPicked ? ' picked' : '') + '" onclick="stickerTogglePattern(\'' + attrName + '\')">';
    if (imgSrc) {
      h += '<img class="gimg" src="' + escHtml(imgSrc) + '" alt="' + escHtml(p.name) + '" loading="lazy"/>';
      h += '<div class="gzoom" onclick="event.stopPropagation();openImgLightbox(\'' + safeImg + '\')"><i class="ti ti-zoom-in"></i></div>';
    } else {
      h += '<div class="gimg" style="display:flex;align-items:center;justify-content:center;background:#fff0f6;color:#e05a8f;font-size:28px;"><i class="ti ti-star"></i></div>';
    }
    h += '<div class="glabel">'
      + '<div class="gname">' + escHtml(p.name) + '</div>'
      + '<div class="gprice">' + (p.price || 69) + ' ฿</div>'
      + '</div>'
      + '<div class="gcheck"><i class="ti ti-check"></i></div>';
    if (isPicked) {
      h += '<div class="gqty" onclick="event.stopPropagation()">'
        + '<button class="gqbtn" onclick="event.stopPropagation();stickerChangeQty(\'' + attrName + '\',-1)">−</button>'
        + '<span class="gqnum">' + q + '</span>'
        + '<button class="gqbtn" onclick="event.stopPropagation();stickerChangeQty(\'' + attrName + '\',1)">+</button>'
        + '</div>';
    }
    h += '</div>';
    return h;
  }).join('');
  
  if (!window._stickerGalleryLoaded) {
    var cards = gallery.querySelectorAll('.gcard');
    cards.forEach(function(c, i) {
      c.style.animationDelay = (i * 0.04) + 's';
    });
    window._stickerGalleryLoaded = true;
    setTimeout(function() {
      if (gallery) gallery.classList.add('loaded');
    }, 800);
  }
}

function stickerUpdateSelectedBar() {
  var countEl = document.getElementById('stickerCount');
  var chipsEl = document.getElementById('stickerChips');
  var clearEl = document.getElementById('stickerClear');
  if (!countEl || !chipsEl) return;

  var names = Object.keys(stickerPicked);
  var total = 0;
  names.forEach(function(n) { total += stickerPicked[n]; });

  countEl.textContent = total + ' แผง';
  clearEl.style.display = names.length > 0 ? 'inline' : 'none';

  if (names.length === 0) {
    chipsEl.innerHTML = '<span class="sb-empty">ยังไม่ได้เลือกลาย กดที่รูปเพื่อเลือกได้เลยค่ะ</span>';
  } else {
    chipsEl.innerHTML = names.map(function(n) {
      var attrName = escAttr(n);
      return '<span class="sb-chip">' + escHtml(n) + ' ×' + stickerPicked[n] + '<span class="rm" onclick="stickerRemovePattern(\'' + attrName + '\')">✕</span></span>';
    }).join('');
  }
  stickerUpdateSummary();
}

function stickerUpdateSummary() {
  var el = document.getElementById('stickerSumItems');
  if (!el || typeof computeStickerPrice === 'undefined') return;
  var names = Object.keys(stickerPicked);
  if (names.length === 0) {
    el.innerHTML = '<div class="sum-empty">เลือกลายสติกเกอร์เพื่อดูยอดรวมค่ะ</div>';
    return;
  }
  var pricing = computeStickerPrice(stickerPicked);
  var html = '';
  names.forEach(function(n) {
    var q = stickerPicked[n];
    var p = getStickerByName(n);
    var itemPrice = p ? p.price * q : 69 * q;
    html += '<div class="sum-row"><span>' + escHtml(n) + ' × ' + q + '</span><span>' + itemPrice.toLocaleString() + ' ฿</span></div>';
  });
  html += '<hr class="sum-divider">';
  html += '<div class="sum-total"><span>จำนวนทั้งหมด</span><span>' + pricing.count + ' แผง</span></div>';
  html += '<div class="sum-total"><span>ค่าจัดส่ง' + (pricing.count >= 3 ? ' (โปรโมชั่นฟรีค่าส่ง)' : '') + '</span><span>' + (pricing.shipping === 0 ? 'ฟรี' : pricing.shipping + ' ฿') + '</span></div>';
  html += '<div class="sum-total" style="color:#4080b0;font-size:16px;font-weight:800"><span>ยอดรวมทั้งหมด</span><span>' + pricing.grandTotal.toLocaleString() + ' ฿</span></div>';
  el.innerHTML = html;
}

function stickerTogglePattern(name) {
  if (stickerPicked[name]) delete stickerPicked[name];
  else stickerPicked[name] = 1;
  stickerBuildGallery();
  stickerUpdateSelectedBar();
}

function stickerChangeQty(name, delta) {
  if (!stickerPicked[name]) return;
  var newQty = stickerPicked[name] + delta;
  if (newQty <= 0) delete stickerPicked[name];
  else stickerPicked[name] = newQty;
  stickerBuildGallery();
  stickerUpdateSelectedBar();
}

function stickerRemovePattern(name) {
  delete stickerPicked[name];
  stickerBuildGallery();
  stickerUpdateSelectedBar();
}

function stickerClearAll() {
  stickerPicked = {};
  stickerBuildGallery();
  stickerUpdateSelectedBar();
}

function stickerHandleSlip(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น'); return; }
  if (file.size > 5 * 1024 * 1024) { alert('ไฟล์รูปต้องไม่เกิน 5 MB ค่ะ'); return; }
  window._stickerSlipFile = file;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxW = 800;
      var w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      window._stickerSlipData = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById('stickerSlipPreviewImg').src = window._stickerSlipData;
      document.getElementById('stickerSlipDrop').classList.add('hidden');
      document.getElementById('stickerSlipPreview').classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function stickerCancelSlip() {
  window._stickerSlipData = null;
  window._stickerSlipFile = null;
  var inp = document.getElementById('stickerSlipInput');
  if (inp) inp.value = '';
  document.getElementById('stickerSlipPreview').classList.add('hidden');
  document.getElementById('stickerSlipDrop').classList.remove('hidden');
}

function stickerDoSubmit() {
  var name = (document.getElementById('stickerFname') ? document.getElementById('stickerFname').value : '').trim();
  var phone = (document.getElementById('stickerFphone') ? document.getElementById('stickerFphone').value : '').trim();
  var addr = (document.getElementById('stickerFaddress') ? document.getElementById('stickerFaddress').value : '').trim();
  var note = (document.getElementById('stickerFnote') ? document.getElementById('stickerFnote').value : '').trim();
  var err = document.getElementById('stickerErrMsg');
  var names = Object.keys(stickerPicked);

  if (names.length === 0) { err.style.display = 'block'; err.textContent = 'กรุณาเลือกลายสติกเกอร์อย่างน้อย 1 ลายนะคะ'; return; }
  if (!name) { err.style.display = 'block'; err.textContent = 'กรุณากรอกชื่อ-นามสกุลนะคะ'; return; }
  if (!phone) { err.style.display = 'block'; err.textContent = 'กรุณากรอกเบอร์โทรศัพท์นะคะ'; return; }

  var digits = phone.replace(/[^0-9]/g, '');
  var phonePattern = /^0[689]\d{8}$/;
  if (!phonePattern.test(digits)) {
    err.style.display = 'block';
    err.textContent = 'กรุณากรอกเบอร์โทรศัพท์เป็นตัวเลข 10 หลักติดกันเท่านั้นนะคะ (เช่น 0812345678 ไม่ต้องใส่ขีด)';
    return;
  }
  phone = digits;
  if (!addr) { err.style.display = 'block'; err.textContent = 'กรุณากรอกที่อยู่จัดส่งให้ครบถ้วนนะคะ'; return; }
  if (!window._stickerSlipData) { err.style.display = 'block'; err.textContent = 'กรุณาแนบสลีปการโอนเงินนะคะ'; return; }

  err.style.display = 'none';
  var pricing = computeStickerPrice(stickerPicked);
  var combinedInfo = name + '\n' + phone + '\n' + addr;

  var btn = document.getElementById('stickerSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> กำลังตรวจสอบสลิป...';

  var orderPayload = {
    customer_name: name,
    customer_phone: phone,
    customer_address: addr,
    customer_info: combinedInfo,
    note: note,
    patterns: names,
    pattern_qtys: Object.assign({}, stickerPicked),
    qty: pricing.count,
    total_bags: pricing.count,
    total_price: pricing.total,
    shipping_cost: pricing.shipping
  };

  fetch('/api/sticker/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order: orderPayload,
      slip_data: window._stickerSlipData
    })
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        err.style.display = 'block';
        err.textContent = data.error;
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-heart"></i> ตกลงการสั่งซื้อ ✓';
        return;
      }
      document.getElementById('stickerFormCard').style.display = 'none';
      document.getElementById('stickerSuccessBox').classList.remove('hidden');
      document.getElementById('stickerSuccessBox').classList.add('show');
      if (data.order && data.order.id) {
        document.getElementById('stickerOrderIdBox').style.display = 'block';
        document.getElementById('stickerOrderIdVal').textContent = data.order.id;
      }
      var vrEl = document.getElementById('stickerSlipVerifyResult');
      if (vrEl && data.order) {
        vrEl.innerHTML = buildVerifyResultCard(data.order, true);
      }
      window._stickerSlipData = null;
      window._stickerSlipFile = null;
    })
    .catch(function(e) {
      alert('เกิดข้อผิดพลาด: ' + e.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-heart"></i> ตกลงการสั่งซื้อ ✓';
    });
}

// ==================== WALLPAPER PAGE ====================
var wpPicked = {}; // { name: qty }

function wpBuildGallery() {
  var q = wpPicked['Wallpaper'] || 0;
  var card = document.getElementById('wpCard');
  var qtyBox = document.getElementById('wpCardQty');
  var qtyNum = document.getElementById('wpCardQtyNum');
  if (q > 0) {
    card.classList.add('picked');
    qtyNum.textContent = q;
  } else {
    card.classList.remove('picked');
  }
}

function wpUpdateSelectedBar() {
  wpUpdateSummary();
}

function wpUpdateSummary() {
  var el = document.getElementById('wpSumItems');
  var q = wpPicked['Wallpaper'] || 0;
  if (q === 0) {
    el.innerHTML = '<div class="sum-empty">เลือกลายเพื่อดูยอดรวมค่ะ</div>';
    return;
  }
  var total = q * 99;
  var html = '<div class="sum-row"><span>Wallpaper × ' + q + '</span><span>' + total.toLocaleString() + ' ฿</span></div>';
  html += '<hr class="sum-divider">';
  html += '<div class="sum-row"><span>ค่าจัดส่ง</span><span>ฟรี</span></div>';
  html += '<div class="sum-total" style="color:#7c3aed;font-size:16px;font-weight:800"><span>ยอดรวมทั้งหมด</span><span>' + total.toLocaleString() + ' ฿</span></div>';
  el.innerHTML = html;
}

function wpTogglePattern(name) {
  if (wpPicked[name]) {
    delete wpPicked[name];
  } else {
    wpPicked[name] = 1;
  }
  wpBuildGallery();
  wpUpdateSelectedBar();
}

function wpChangeQty(name, delta) {
  if (!wpPicked[name]) return;
  var newQty = wpPicked[name] + delta;
  if (newQty <= 0) {
    delete wpPicked[name];
  } else {
    wpPicked[name] = newQty;
  }
  wpBuildGallery();
  wpUpdateSelectedBar();
}

function wpRemovePattern(name) {
  delete wpPicked[name];
  wpBuildGallery();
  wpUpdateSelectedBar();
}

function wpClearAll() {
  wpPicked = {};
  wpBuildGallery();
  wpUpdateSelectedBar();
}

function copyBank() {
  navigator.clipboard.writeText('749-2439-414').then(function() {
    var btn = event.target;
    var orig = btn.textContent;
    btn.textContent = '✅ คัดลอกแล้ว';
    setTimeout(function() { btn.textContent = orig; }, 2000);
  }).catch(function() {
    alert('คัดลอก: 749-2439-414');
  });
}

function wpHandleSlip(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น'); return; }
  if (file.size > 5 * 1024 * 1024) { alert('ไฟล์รูปต้องไม่เกิน 5 MB ค่ะ'); return; }
  window._wpSlipFile = file;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxW = 800;
      var w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      window._wpSlipData = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById('wpSlipPreviewImg').src = window._wpSlipData;
      document.getElementById('wpSlipDrop').classList.add('hidden');
      document.getElementById('wpSlipPreview').classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function wpCancelSlip() {
  window._wpSlipData = null;
  window._wpSlipFile = null;
  document.getElementById('wpSlipInput').value = '';
  document.getElementById('wpSlipPreview').classList.add('hidden');
  document.getElementById('wpSlipDrop').classList.remove('hidden');
}

function wpDoSubmit() {
  var email = document.getElementById('wpfemail').value.trim();
  var note = document.getElementById('wpfnote').value.trim();
  var err = document.getElementById('wpErrMsg');
  var names = Object.keys(wpPicked);
  if (!email) { err.style.display = 'block'; err.textContent = 'กรุณากรอก E-mail นะคะ'; return; }
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { err.style.display = 'block'; err.textContent = 'รูปแบบ E-mail ไม่ถูกต้องนะคะ'; return; }
  if (names.length === 0) { err.style.display = 'block'; err.textContent = 'กรุณาเลือก wallpaper อย่างน้อย 1 อันนะคะ'; return; }
  if (!window._wpSlipData) { err.style.display = 'block'; err.textContent = 'กรุณาแนบสลีปการโอนเงินนะคะ'; return; }
  err.style.display = 'none';

  var totalItems = 0;
  names.forEach(function(n) { totalItems += wpPicked[n]; });
  var totalPrice = totalItems * 99;

  var btn = document.getElementById('wpSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> กำลังส่ง...';

  fetch('/api/wallpaper/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_info: email,
      email: email,
      note: note,
      patterns: names,
      pattern_qtys: Object.assign({}, wpPicked),
      total_bags: totalItems,
      total_price: totalPrice,
      slip_data: window._wpSlipData
    }),
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { err.style.display = 'block'; err.textContent = data.error; btn.disabled = false; btn.innerHTML = '<i class="ti ti-heart"></i> ตกลงการสั่งซื้อ ✓'; return; }
      document.getElementById('wpFormCard').style.display = 'none';
      document.getElementById('wpSuccessBox').classList.remove('hidden');
      document.getElementById('wpSuccessBox').classList.add('show');
      document.getElementById('wpOrderIdBox').style.display = 'block';
      document.getElementById('wpOrderIdVal').textContent = data.order.id;
      window._wpSlipData = null; window._wpSlipFile = null;
    })
    .catch(function(e) {
      alert('เกิดข้อผิดพลาด: ' + e.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-heart"></i> ตกลงการสั่งซื้อ ✓';
    });
}

function wpCheckDownload() {
  var email = document.getElementById('wpCheckEmail').value.trim();
  var err = document.getElementById('wpCheckErr');
  var result = document.getElementById('wpCheckResult');
  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    err.style.display = 'block'; err.textContent = 'กรุณากรอก E-mail ให้ถูกต้อง'; return;
  }
  err.style.display = 'none';
  var btn = document.getElementById('wpCheckBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> กำลังเช็ค...';

  fetch('/api/wallpaper/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email }),
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-search"></i> เช็คลิงก์ดาวน์โหลด';
      result.style.display = 'block';
      if (data.confirmed && data.download_link) {
        result.innerHTML = '<div class="wp-check-ok"><div class="wp-check-msg">' + escHtml(data.message) + '</div><a class="wp-check-link" href="' + escHtml(data.download_link) + '" target="_blank"><i class="ti ti-download"></i> ดาวน์โหลด Wallpaper</a></div>';
      } else if (data.confirmed && !data.download_link) {
        result.innerHTML = '<div class="wp-check-ok"><div class="wp-check-msg">✅ ' + escHtml(data.message) + '</div><div style="font-size:13px;color:#8070a0;margin-top:8px">กำลังรอ link ดาวน์โหลดจากทางร้านนะคะ ติดตามได้ที่หน้านี้ค่ะ 🎀</div></div>';
      } else if (data.found && !data.confirmed) {
        result.innerHTML = '<div class="wp-check-waiting"><div class="wp-check-msg">⏳ ' + escHtml(data.message) + '</div></div>';
      } else {
        result.innerHTML = '<div class="wp-check-fail"><div class="wp-check-msg">❌ ' + escHtml(data.message) + '</div></div>';
      }
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-search"></i> เช็คลิงก์ดาวน์โหลด';
      err.style.display = 'block'; err.textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    });
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', function() {
  showWelcomePopup();
  autoPlayMusic();
  document.getElementById('promoTabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.ptab');
    if (!tab) return;
    document.querySelectorAll('.ptab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.promo-panel').forEach(function(p) { p.classList.remove('show'); });
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('show');
  });

  document.getElementById('sizeTabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.stab');
    if (!tab) return;
    document.querySelectorAll('.stab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    activeSize = tab.dataset.size;
    buildGallery();
  });

  var fAddr = document.getElementById('faddress');
  if (fAddr) fAddr.addEventListener('input', function() {
    if (Object.keys(picked).length > 0) updateSummary();
  });
  var fInfo = document.getElementById('finfo');
  if (fInfo) fInfo.addEventListener('input', function() {
    if (Object.keys(picked).length > 0) updateSummary();
  });

  var wpNoteEl = document.getElementById('wpfnote');
  if (wpNoteEl) wpNoteEl.addEventListener('input', function() {
    if (Object.keys(wpPicked).length > 0) wpUpdateSummary();
  });

  buildGallery();
  updateSelectedBar();
  stickerBuildGallery();
  stickerUpdateSelectedBar();
  fetchStickersFromApi();

  // Scroll reveal with Intersection Observer (skip elements that already have entrance animations)
  var revealEls = document.querySelectorAll('.promo-wrap,.sec,.form-card,.tr-card,.ty-card');
  revealEls.forEach(function(el) { el.classList.add('reveal'); });
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function(el) { observer.observe(el); });
  } else {
    revealEls.forEach(function(el) { el.classList.add('visible'); });
  }
});
