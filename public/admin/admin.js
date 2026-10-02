// ==================== STATE ====================
var allOrders = [];
var filteredOrders = [];
var currentFilter = 'all';
var currentDateFilter = 'all';
var currentTrackingDateFilter = 'all';
var currentModalOrder = null;
var deleteTargetId = null;

// Uses shared: ALL_PATTERNS, STATUS_LABELS, STATUS_ICONS, computePromoPrice(), isRemoteArea(), getShippingCost(), getPatternByName()

// ==================== TOAST ====================
function showToast(type, msg) {
  var c = document.getElementById('toastContainer');
  var icons = { success: 'ti-circle-check', error: 'ti-alert-circle', warn: 'ti-alert-triangle' };
  var t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML = '<i class="ti ' + (icons[type] || 'ti-info-circle') + '"></i> ' + escapeHtml(msg);
  c.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
}

// ==================== LOADING ====================
function showTableLoading() {
  document.getElementById('orderTableBody').innerHTML = '<tr><td colspan="8"><div class="loading-row"><i class="ti ti-loader"></i><div>กำลังโหลด...</div></div></td></tr>';
  document.getElementById('emptyState').style.display = 'none';
}

// ==================== AUTH ====================
function checkAuth() {
  fetch('/api/check-auth', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.authenticated) { showDashboard(); }
      else { showLogin(); }
    })
    .catch(function() { showLogin(); });
}

function showLogin() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('dashboardPage').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('dashboardPage').classList.remove('hidden');
  loadStats();
  loadOrders();
}

function doLogin(e) {
  e.preventDefault();
  var pw = document.getElementById('loginPassword').value;
  var errEl = document.getElementById('loginErr');
  errEl.textContent = '';

  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) { showDashboard(); }
      else { errEl.textContent = data.error || 'รหัสผ่านไม่ถูกต้อง'; }
    })
    .catch(function() { errEl.textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่'; });
  return false;
}

function doLogout() {
  fetch('/api/logout', { method: 'POST' }).then(function() { showLogin(); });
}

// ==================== STATS ====================
function loadStats() {
  fetch('/api/stats', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(s) {
      document.getElementById('statTotal').textContent = s.total_orders;
      document.getElementById('statPending').textContent = s.by_status['0'] || 0;
      document.getElementById('statRevenue').textContent = (s.total_revenue || 0).toLocaleString() + ' ฿';
      document.getElementById('statBags').textContent = s.total_bags;
    })
    .catch(function() {
      document.getElementById('statTotal').textContent = '!';
      document.getElementById('statPending').textContent = '!';
      document.getElementById('statRevenue').textContent = '!';
      document.getElementById('statBags').textContent = '!';
      showToast('error', 'โหลดสถิติไม่สำเร็จ');
    });
}

// ==================== ORDERS ====================
function loadOrders() {
  showTableLoading();
  fetch('/api/orders', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!Array.isArray(data)) {
        showToast('error', 'ข้อมูลออเดอร์ไม่ถูกต้อง');
        return;
      }
      allOrders = data;
      updateFilterBadges();
      filterOrders();
      renderProductSummary();
    })
    .catch(function() {
      showToast('error', 'โหลดออเดอร์ไม่สำเร็จ');
      document.getElementById('orderTableBody').innerHTML = '';
      document.getElementById('emptyState').style.display = 'block';
      document.getElementById('emptyState').querySelector('div').textContent = 'โหลดข้อมูลไม่สำเร็จ — ลองอีกครั้ง';
    });
}

function refreshData() {
  var btn = document.getElementById('refreshBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('spinning');
  loadStats();

  fetch('/api/orders', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (Array.isArray(data)) {
        allOrders = data;
        updateFilterBadges();
        filterOrders();
        showToast('success', 'รีเฟรชเรียบร้อย');
      }
    })
    .catch(function() {
      showToast('error', 'รีเฟรชไม่สำเร็จ');
    })
    .finally(function() {
      btn.disabled = false;
      btn.classList.remove('spinning');
    });
}

// ==================== FILTER ====================
function updateFilterBadges() {
  var dateFiltered = allOrders.filter(function(o) { return isWithinDateRange(o.created_at, currentDateFilter); });
  var counts = { all: dateFiltered.length, 0: 0, 1: 0, 2: 0, 3: 0 };
  dateFiltered.forEach(function(o) {
    if (counts[o.status] !== undefined) counts[o.status]++;
  });
  document.querySelectorAll('.ftab').forEach(function(tab) {
    var f = tab.dataset.filter;
    var badge = tab.querySelector('.ftab-count');
    if (badge) badge.textContent = counts[f] || 0;
  });
}

function switchDateOrderFilter(filter) {
  currentDateFilter = filter;
  document.querySelectorAll('.dftab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.dfilter === filter);
  });
  updateFilterBadges();
  filterOrders();
}

function isWithinDateRange(created_at, filter) {
  if (filter === 'all') return true;
  if (!created_at) return false;
  var d = new Date(created_at);
  var cutoff19 = new Date('2026-06-20T00:00:00');
  var cutoff20 = new Date('2026-06-20T00:00:00');
  var cutoff26 = new Date('2026-06-26T00:00:00');
  if (filter === 'upto19') return d < cutoff19;
  if (filter === '20to25') return d >= cutoff20 && d < cutoff26;
  if (filter === 'after25') return d >= cutoff26;
  return true;
}

function filterOrders() {
  var search = (document.getElementById('searchInput').value || '').toLowerCase().trim();

  filteredOrders = allOrders.filter(function(o) {
    if (currentFilter !== 'all' && String(o.status) !== currentFilter) return false;
    if (!isWithinDateRange(o.created_at, currentDateFilter)) return false;
    if (search) {
      var id = (o.id || '').toLowerCase();
      var name = (o.customer_name || '').toLowerCase();
      var phone = (o.customer_phone || '').toLowerCase();
      var addr = (o.customer_address || '').toLowerCase();
      var info = (o.customer_info || '').toLowerCase();
      var note = (o.note || '').toLowerCase();
      var tracking = (o.tracking_number || '').toLowerCase();
      if (!id.includes(search) && !name.includes(search) && !phone.includes(search) && !addr.includes(search) && !info.includes(search) && !note.includes(search) && !tracking.includes(search)) return false;
    }
    return true;
  });

  renderTable();
}

// ==================== PRODUCT SUMMARY ====================
var _priceMap = null;
function getPriceMap() {
  if (_priceMap) return _priceMap;
  _priceMap = {};
  ALL_PATTERNS.forEach(function(p) { _priceMap[p.name] = p.priceOrig; });
  WP_PATTERNS.forEach(function(p) { _priceMap[p.name] = p.price; });
  if (typeof STICKER_PATTERNS !== 'undefined') {
    STICKER_PATTERNS.forEach(function(p) { _priceMap[p.name] = p.price || (typeof STICKER_PRICE !== 'undefined' ? STICKER_PRICE : 69); });
  }
  // backward compat: old wallpaper name
  _priceMap['Merilah Pink WP'] = WP_PATTERNS[0] ? WP_PATTERNS[0].price : 99;
  return _priceMap;
}

function renderProductSummary() {
  var el = document.getElementById('productSummary');
  var priceMap = getPriceMap();
  var wallpapers = {};
  var stickers = {};
  var bags = {};

  allOrders.forEach(function(o) {
    var qtys = o.pattern_qtys || {};
    var names = o.patterns || [];
    var customer = (o.customer_info || '').split('\n')[0] || '-';
    names.forEach(function(name) {
      var qty = qtys[name] || o.qty || 1;
      var price = priceMap[name] || (o.type === 'sticker' ? (typeof STICKER_PRICE !== 'undefined' ? STICKER_PRICE : 69) : 0);
      var obj = { qty: qty, price: price, customer: customer, orderId: o.id, email: o.email || '' };
      if (o.type === 'wallpaper') {
        if (!wallpapers[name]) wallpapers[name] = { total: 0, totalPrice: 0, buyers: [] };
        wallpapers[name].total += qty;
        wallpapers[name].totalPrice += qty * price;
        wallpapers[name].buyers.push(obj);
      } else if (o.type === 'sticker') {
        if (!stickers[name]) stickers[name] = { total: 0, totalPrice: 0, buyers: [] };
        stickers[name].total += qty;
        stickers[name].totalPrice += qty * price;
        stickers[name].buyers.push(obj);
      } else {
        if (!bags[name]) bags[name] = { total: 0, totalPrice: 0, buyers: [] };
        bags[name].total += qty;
        bags[name].totalPrice += qty * price;
        bags[name].buyers.push(obj);
      }
    });
  });

  var html = '';
  var hasWallpaper = Object.keys(wallpapers).length > 0;
  var hasStickers = Object.keys(stickers).length > 0;
  var hasBags = Object.keys(bags).length > 0;

  function renderGroup(title, icon, data) {
    var names = Object.keys(data).sort(function(a, b) { return data[b].total - data[a].total; });
    var h = '<div class="summary-group"><div class="summary-group-title"><i class="ti ' + icon + '"></i> ' + title + ' <span class="sum-badge">' + names.length + ' ลาย</span></div>';
    var grandTotal = 0, grandPrice = 0;
    names.forEach(function(name) {
      var d = data[name];
      grandTotal += d.total;
      grandPrice += d.totalPrice;
      h += '<div class="sum-item" onclick="toggleBuyers(this)">';
      h += '<div class="sum-item-head">';
      h += '<span class="sum-item-name">' + escapeHtml(name) + '</span>';
      h += '<span class="sum-item-price">' + (d.totalPrice || '').toLocaleString() + ' ฿</span>';
      h += '<span class="sum-item-qty">' + d.total + '</span>';
      h += '<i class="ti ti-chevron-down sum-arrow"></i>';
      h += '</div>';
      h += '<div class="sum-buyers">';
      d.buyers.forEach(function(b) {
        h += '<div class="sum-buyer"><span class="sum-buyer-cust">' + escapeHtml(b.customer) + '</span><span class="sum-buyer-price">' + (b.price || '').toLocaleString() + '฿</span><span class="sum-buyer-qty">' + b.qty + '</span></div>';
      });
      h += '</div>';
      h += '</div>';
    });
    h += '<div class="sum-item sum-grand"><span class="sum-item-name">รวมทั้งหมด</span><span class="sum-item-price">' + grandPrice.toLocaleString() + ' ฿</span><span class="sum-item-qty">' + grandTotal + '</span></div>';
    h += '</div>';
    return h;
  }

  if (hasWallpaper) html += renderGroup('Wallpaper', 'ti-brush', wallpapers);
  if (hasStickers) html += renderGroup('สติกเกอร์', 'ti-star', stickers);
  if (hasBags) html += renderGroup('กระเป๋า', 'ti-shopping-bag', bags);
  if (!html) html = '<div class="summary-empty">ยังไม่มีข้อมูลสินค้า</div>';

  el.innerHTML = html;
}

// ==================== TABLE ====================
function renderTable() {
  var tbody = document.getElementById('orderTableBody');
  var empty = document.getElementById('emptyState');

  if (filteredOrders.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('div').textContent = allOrders.length === 0 ? 'ยังไม่มีออเดอร์' : 'ไม่พบออเดอร์ที่ตรงกับเงื่อนไข';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filteredOrders.map(function(o) {
    var d = new Date(o.created_at);
    var dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    var patterns = (o.patterns || []).join(', ');
    if (patterns.length > 40) patterns = patterns.substring(0, 40) + '...';

    var grandTotal = (o.total_price || 0) + (o.shipping_cost != null ? o.shipping_cost : 0);

    var statusOptions = '';
    if (o.type === 'wallpaper') {
      statusOptions = '<option value="0"' + (o.status === 0 ? ' selected' : '') + '>รอยืนยัน</option><option value="1"' + (o.status === 1 ? ' selected' : '') + '>ยืนยันแล้ว</option>';
    } else {
      for (var i = 0; i < STATUS_LABELS.length; i++) {
        statusOptions += '<option value="' + i + '"' + (o.status === i ? ' selected' : '') + '>' + STATUS_LABELS[i] + '</option>';
      }
    }

    var custName = o.customer_name || (o.customer_info || '').split('\n')[0] || '-';
    var custPhone = o.customer_phone || (o.customer_info || '').split('\n')[1] || '';
    var custDisplay = escapeHtml(custName) + (custPhone ? '<div style="font-size:11px;color:#807078">📞 ' + escapeHtml(custPhone) + '</div>' : '');

    return '<tr class="order-row' + (o.type === 'wallpaper' ? ' order-wallpaper' : '') + '" onclick="openOrder(\'' + escapeHtmlAttr(o.id) + '\')">'
      + '<td class="order-id">' + escapeHtml(o.id) + (o.slip_data ? ' <i class="ti ti-receipt" style="color:#30a030;font-size:11px" title="มีสลีป"></i>' : '') + (o.fast_track ? '<br><span style="color:#8c30d8;font-size:10px;font-weight:800;background:#f3e8fc;padding:2px 4px;border-radius:4px">⚡ FAST TRACK</span>' : '') + '</td>'
      + '<td class="order-customer">' + custDisplay + '</td>'
      + '<td class="order-patterns">' + escapeHtml(patterns) + '</td>'
      + '<td class="order-qty">' + (o.total_bags || 0) + '</td>'
      + '<td class="order-price">' + grandTotal.toLocaleString() + ' ฿</td>'
      + '<td class="order-tracking" style="font-size:11px;color:#807078">' + escapeHtml(o.tracking_number || '') + '</td>'
      + '<td onclick="event.stopPropagation()"><select class="status-select s' + o.status + '" data-docid="' + escapeHtmlAttr(o._docId) + '" data-orderid="' + escapeHtmlAttr(o.id) + '" onchange="inlineChangeStatus(this)">' + statusOptions + '</select></td>'
      + '<td class="order-date">' + dateStr + '</td>'
      + '<td><i class="ti ti-chevron-right" style="color:#c0b0b8"></i></td>'
      + '</tr>';
  }).join('');
}

function inlineChangeStatus(sel) {
  var newStatus = parseInt(sel.value);
  var docId = sel.dataset.docid;
  var orderId = sel.dataset.orderid;
  var origStatus = sel.parentElement.querySelector('.order-id') ? allOrders.find(function(o) { return o._docId === docId; }).status : -1;

  sel.disabled = true;
  sel.className = 'status-select s' + newStatus + ' saving';

  fetch('/api/orders/' + encodeURIComponent(docId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status: newStatus }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        showToast('error', 'เปลี่ยนสถานะไม่สำเร็จ: ' + data.error);
        var order = allOrders.find(function(o) { return o._docId === docId; });
        if (order) { sel.value = order.status; sel.className = 'status-select s' + order.status; }
        return;
      }
      var order = allOrders.find(function(o) { return o._docId === docId; });
      if (order) order.status = newStatus;
      sel.className = 'status-select s' + newStatus;
      showToast('success', orderId + ' → ' + STATUS_LABELS[newStatus]);
      loadStats();
    })
    .catch(function() {
      showToast('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      var order = allOrders.find(function(o) { return o._docId === docId; });
      if (order) { sel.value = order.status; sel.className = 'status-select s' + order.status; }
    })
    .finally(function() {
      sel.disabled = false;
    });
}

// ==================== MODAL ====================
function openOrder(id) {
  var order = allOrders.find(function(o) { return o.id === id; });
  if (!order) return;
  currentModalOrder = order;

  document.getElementById('modalOrderId').textContent = order.id;

  var html = '';

  // Status
  html += '<div class="m-section">';
  html += '<div class="m-section-title">สถานะ</div>';
  html += '<div class="m-status-row">';
  if (order.type === 'wallpaper') {
    html += '<button class="m-status-btn s0' + (order.status === 0 ? ' active' : '') + '" onclick="changeStatus(0)"><i class="ti ti-clock"></i> รอยืนยัน</button>';
    html += '<button class="m-status-btn s1' + (order.status === 1 ? ' active' : '') + '" onclick="changeStatus(1)"><i class="ti ti-circle-check"></i> ยืนยันแล้ว</button>';
  } else {
    for (var i = 0; i < STATUS_LABELS.length; i++) {
      html += '<button class="m-status-btn s' + i + (order.status === i ? ' active' : '') + '" onclick="changeStatus(' + i + ')"><i class="ti ' + STATUS_ICONS[i] + '"></i> ' + STATUS_LABELS[i] + '</button>';
    }
  }
  html += '</div></div>';

  // Customer Info (editable separated fields)
  var cName = order.customer_name || (order.customer_info || '').split('\n')[0] || '';
  var cPhone = order.customer_phone || (order.customer_info || '').split('\n')[1] || '';
  var cAddress = order.customer_address || ((order.customer_info || '').split('\n').slice(2).join('\n')) || '';

  html += '<div class="m-section">';
  html += '<div class="m-section-title" style="display:flex;justify-content:space-between;align-items:center;">ข้อมูลลูกค้า <button type="button" style="border:1px solid #ecc9d6;background:#fff5f9;color:#c04878;border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer;font-weight:700" onclick="copyCustomerInfo(\'' + escapeHtmlAttr(cName) + '\', \'' + escapeHtmlAttr(cPhone) + '\', \'' + escapeHtmlAttr(cAddress) + '\')"><i class="ti ti-copy"></i> คัดลอก</button></div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">ชื่อ-นามสกุล</label><input type="text" class="m-note-input" id="modalCustName" value="' + escapeHtmlAttr(cName) + '" placeholder="ชื่อ-นามสกุล" style="padding:7px 10px;"/></div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">เบอร์โทรศัพท์</label><input type="tel" class="m-note-input" id="modalCustPhone" value="' + escapeHtmlAttr(cPhone) + '" placeholder="เบอร์โทรศัพท์" style="padding:7px 10px;"/></div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">ที่อยู่จัดส่ง</label><textarea class="m-note-input" id="modalCustAddress" rows="3" placeholder="ที่อยู่จัดส่ง">' + escapeHtml(cAddress) + '</textarea></div>';
  if (order.email) {
    html += '<div class="m-customer" style="margin-top:8px"><strong>Gmail:</strong> ' + escapeHtml(order.email) + '</div>';
  }
  html += '<div style="margin-top:12px"><label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:#8c30d8;cursor:pointer"><input type="checkbox" id="modalFastTrack" ' + (order.fast_track ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#8c30d8"/> ⚡ ออเดอร์ด่วน (FAST TRACK)</label></div>';
  html += '</div>';

  // Patterns with images and promo pricing
  html += '<div class="m-section">';
  html += '<div class="m-section-title">สินค้าที่สั่ง</div>';
  html += '<div class="m-patterns">';

  var pq = order.pattern_qtys || {};
  var promo = computePromoPrice(pq);
  var groups = {};
  (order.patterns || []).forEach(function(name) {
    var pat = getPatternByName(name)
      || (typeof getStickerByName === 'function' ? getStickerByName(name) : null)
      || (typeof WP_PATTERNS !== 'undefined' ? WP_PATTERNS.find(function(x) { return x.name === name; }) : null);
    var sizeKey = pat ? (pat.sizeKey || (order.type === 'sticker' ? 'sticker' : order.type === 'wallpaper' ? 'wallpaper' : 'normal')) : 'normal';
    if (!groups[sizeKey]) groups[sizeKey] = [];
    groups[sizeKey].push({ name: name, qty: pq[name] || order.qty || 1, pat: pat });
  });

  for (var sk in groups) {
    var sizeLabel = sk === 'normal' ? 'Normal' : sk === 'large' ? 'Large' : sk === 'easy' ? 'Easy' : sk === 'maxi' ? 'Maxi' : sk === 'sticker' ? 'Sticker' : sk === 'wallpaper' ? 'Wallpaper' : sk;
    html += '<div class="m-pattern-group-label">' + sizeLabel + '</div>';
    groups[sk].forEach(function(item) {
      var img = item.pat ? item.pat.img : '';
      html += '<div class="m-pattern-item">';
      if (img) html += '<img class="m-pattern-img" src="' + escapeHtmlAttr(img) + '" alt="" onclick="event.stopPropagation();openLightbox(\'' + escapeHtmlAttr(img) + '\')"/>';
      html += '<span class="m-pattern-name">' + escapeHtml(item.name) + ' × ' + item.qty + '</span>';
      var itemPrice = item.pat ? ((item.pat.priceOrig || item.pat.price || (order.type === 'sticker' ? 69 : 0)) * item.qty) : '-';
      html += '<span class="m-pattern-price">' + (typeof itemPrice === 'number' ? itemPrice.toLocaleString() + ' ฿' : itemPrice) + '</span>';
      html += '</div>';
    });
  }
  html += '</div></div>';

  // Summary
  html += '<div class="m-section">';
  html += '<div class="m-section-title">สรุป</div>';
  html += '<div class="m-row"><span class="m-row-label">จำนวนทั้งหมด</span><span class="m-row-val">' + (order.total_bags || 0) + ' ใบ</span></div>';
  html += '<div class="m-row"><span class="m-row-label">ยอดสินค้า</span><span class="m-row-val">' + (order.total_price || 0).toLocaleString() + ' ฿</span></div>';
  var shippingCost = order.shipping_cost != null ? order.shipping_cost : 0;
  var shippingLabel = shippingCost === 0 ? 'ค่าจัดส่ง (ฟรี)' : (order.is_remote ? 'ค่าจัดส่ง (พื้นที่ห่างไกล)' : 'ค่าจัดส่ง');
  html += '<div class="m-row"><span class="m-row-label">' + shippingLabel + '</span><span class="m-row-val">' + shippingCost + ' ฿</span></div>';
  var grandTotal = (order.total_price || 0) + shippingCost;
  html += '<div class="m-row"><span class="m-row-label">ยอดรวมทั้งหมด</span><span class="m-row-val" style="color:#d45a8a;font-size:16px;">' + grandTotal.toLocaleString() + ' ฿</span></div>';
  var d2 = new Date(order.created_at);
  var localISO = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  html += '<div class="m-row"><span class="m-row-label">สั่งเมื่อ</span><span class="m-row-val"><input type="datetime-local" id="modalCreatedAt" value="' + localISO + '" style="border:1.5px solid #f5d0de;border-radius:8px;padding:5px 10px;font-size:13px;font-family:inherit;color:#333;background:#fffafc;outline:none;"/></span></div>';
  html += '<div class="m-row"><span class="m-row-label">เลขพัสดุ</span><span class="m-row-val"><input type="text" id="modalTracking" placeholder="ใส่เลขพัสดุ..." value="' + escapeHtmlAttr(order.tracking_number || '') + '" style="width:100%;border:1.5px solid #d0e0d8;border-radius:8px;padding:6px 12px;font-size:13px;font-family:inherit;color:#333;background:#f8fcf8;outline:none;box-sizing:border-box"/></span></div>';
  html += '</div>';

  // Note
  html += '<div class="m-section">';
  html += '<div class="m-section-title">หมายเหตุ</div>';
  html += '<textarea class="m-note-input" id="modalNote" placeholder="ใส่หมายเหตุ...">' + escapeHtml(order.note || '') + '</textarea>';
  html += '</div>';

  // Download Link (for wallpaper orders)
  html += '<div class="m-section">';
  html += '<div class="m-section-title">🔗 Link ดาวน์โหลด Wallpaper</div>';
  html += '<input class="m-note-input" id="modalDownloadLink" placeholder="วาง Google Drive link ตรงนี้..." value="' + escapeHtmlAttr(order.download_link || '') + '" style="width:100%;border:1.5px solid #d0c0e8;border-radius:10px;padding:10px 13px;font-size:13px;font-family:inherit;color:#333;background:#fffafc;outline:none;box-sizing:border-box"/>';
  html += '</div>';

  // Slip
  if (order.slip_data) {
    html += '<div class="m-section">';
    html += '<div class="m-section-title">สลีปโอนเงิน</div>';
    html += '<img class="slip-admin-img" src="' + order.slip_data + '" alt="สลีป" onclick="window.open(\'' + order.slip_data + '\',\'_blank\')"/>';
    if (order.slip_uploaded_at) {
      var slipDate = new Date(order.slip_uploaded_at);
      html += '<div style="font-size:11px;color:#a09098;margin-top:6px">อัปโหลดเมื่อ: ' + slipDate.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>';
    }
    html += '</div>';
  }

  // Actions
  html += '<div class="m-actions">';
  html += '<button class="m-action-btn m-action-delete" onclick="confirmDelete(\'' + escapeHtmlAttr(order._docId) + '\',\'' + escapeHtmlAttr(order.id) + '\')"><i class="ti ti-trash"></i> ลบ</button>';
  html += '<button class="m-action-btn m-action-save" onclick="saveOrder()"><i class="ti ti-check"></i> บันทึก</button>';
  html += '</div>';

  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('orderModal').classList.remove('hidden');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('orderModal')) return;
  document.getElementById('orderModal').classList.add('hidden');
  currentModalOrder = null;
}

function changeStatus(status) {
  if (!currentModalOrder) return;
  currentModalOrder.status = status;

  document.querySelectorAll('.m-status-btn').forEach(function(btn) { btn.classList.remove('active'); });
  document.querySelector('.m-status-btn.s' + status).classList.add('active');
}

function saveOrder() {
  if (!currentModalOrder) return;
  var note = document.getElementById('modalNote').value;
  var downloadLink = document.getElementById('modalDownloadLink').value.trim();
  var btn = document.querySelector('.m-action-save');
  btn.disabled = true;
  var custName = document.getElementById('modalCustName') ? document.getElementById('modalCustName').value.trim() : '';
  var custPhone = document.getElementById('modalCustPhone') ? document.getElementById('modalCustPhone').value.trim() : '';
  var custAddress = document.getElementById('modalCustAddress') ? document.getElementById('modalCustAddress').value.trim() : '';
  var customerInfo = [custName, custPhone, custAddress].filter(Boolean).join('\n');

  var createdAtInput = document.getElementById('modalCreatedAt');
  var createdAtISO = createdAtInput && createdAtInput.value ? new Date(createdAtInput.value).toISOString() : currentModalOrder.created_at;
  var trackingInput = document.getElementById('modalTracking');
  var trackingNumber = trackingInput ? trackingInput.value.trim() : '';
  var fastTrack = document.getElementById('modalFastTrack') ? document.getElementById('modalFastTrack').checked : false;
  var body = {
    status: currentModalOrder.status,
    note: note,
    customer_name: custName,
    customer_phone: custPhone,
    customer_address: custAddress,
    fast_track: fastTrack,
    customer_info: customerInfo,
    created_at: createdAtISO,
    tracking_number: trackingNumber
  };
  if (downloadLink !== undefined) body.download_link = downloadLink;

  fetch('/api/orders/' + encodeURIComponent(currentModalOrder._docId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { showToast('error', data.error); return; }
      showToast('success', 'บันทึกออเดอร์ ' + currentModalOrder.id + ' เรียบร้อย');
      closeModal();
      loadOrders();
      loadStats();
    })
    .catch(function() {
      showToast('error', 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    })
    .finally(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i> บันทึก';
    });
}

// ==================== DELETE ====================
function confirmDelete(docId, orderId) {
  deleteTargetId = docId;
  document.getElementById('deleteModalMsg').textContent = 'ต้องการลบออเดอร์ ' + orderId + ' จริงหรือไม่?';
  document.getElementById('deleteConfirmBtn').onclick = doDelete;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.add('hidden');
  deleteTargetId = null;
}

function doDelete() {
  var id = deleteTargetId;
  if (!id) return;
  var btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> กำลังลบ...';

  fetch('/api/orders/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        showToast('error', 'ลบไม่สำเร็จ: ' + data.error);
        return;
      }
      showToast('success', 'ลบออเดอร์เรียบร้อย');
      closeDeleteModal();
      closeModal();
      loadOrders();
      loadStats();
    })
    .catch(function(err) {
      console.error('Delete error:', err);
      showToast('error', 'ลบไม่สำเร็จ กรุณาลองใหม่');
    })
    .finally(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-trash"></i> ลบ';
    });
}

// ==================== LIGHTBOX ====================
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLightbox();
});

// ==================== ADMIN VIEWS ====================
function switchView(view) {
  document.querySelectorAll('.topbar-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.view === view);
  });
  document.getElementById('viewOrders').classList.toggle('hidden', view !== 'orders');
  var vp = document.getElementById('viewProducts'); if (vp) vp.classList.toggle('hidden', view !== 'products');
  document.getElementById('viewSummary').classList.toggle('hidden', view !== 'summary');
  document.getElementById('viewPrint').classList.toggle('hidden', view !== 'print');
  document.getElementById('viewTracking').classList.toggle('hidden', view !== 'tracking');
  if (view === 'products') {
    hydrateProducts().then(function() {
      renderCategoryManager();
      renderProductsView();
      renderPreviewManager();
      if (typeof window.hlgRenderTiers === 'function') window.hlgRenderTiers();
      if (typeof window.hlgRenderPricing === 'function') window.hlgRenderPricing();
      if (typeof window.hlgRenderFonts === 'function') window.hlgRenderFonts();
    });
  }
  var vc = document.getElementById('viewCoupons');
  if (vc) vc.classList.toggle('hidden', view !== 'coupons');
  if (view === 'coupons') { if (typeof window.hlgRenderCoupons === 'function') window.hlgRenderCoupons(); }
  var vs = document.getElementById('viewStock');
  if (vs) vs.classList.toggle('hidden', view !== 'stock');
  if (view === 'stock') { if (typeof window.hlgRenderStock === 'function') window.hlgRenderStock(); }
  var vr = document.getElementById('viewReceipt');
  if (vr) vr.classList.toggle('hidden', view !== 'receipt');
  if (view === 'receipt') { if (typeof window.hlgRenderReceipt === 'function') window.hlgRenderReceipt(); }
  if (view === 'summary') renderProductSummary();
  if (view === 'print') renderPrintTable();
  if (view === 'tracking') renderTrackingView();
}

// ==================== TRACKING INPUT VIEW ====================
function isWithinTrackingDateRange(created_at, filter) {
  if (filter === 'all') return true;
  if (!created_at) return false;
  var d = new Date(created_at);
  var cutoff19 = new Date('2026-06-19T00:00:00');
  var cutoff20 = new Date('2026-06-20T00:00:00');
  var cutoff24 = new Date('2026-06-24T00:00:00');
  var cutoff26 = new Date('2026-06-26T00:00:00');
  if (filter === 'before19') return d < cutoff19;
  if (filter === 'upto19') return d >= cutoff19 && d < cutoff20;
  if (filter === '20to23') return d >= cutoff20 && d < cutoff24;
  if (filter === '20to25') return d >= cutoff20 && d < cutoff26;
  if (filter === 'after23') return d >= cutoff24;
  if (filter === 'after25') return d >= cutoff26;
  return true;
}

function switchTrackingDateFilter(filter) {
  currentTrackingDateFilter = filter;
  document.querySelectorAll('#trackingDateTabs .dftab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.tfilter === filter);
  });
  renderTrackingView();
}

function renderTrackingView() {
  var list = document.getElementById('trackingList');
  var search = (document.getElementById('trackingSearch').value || '').toLowerCase().trim();
  var orders = allOrders.slice().filter(function(o) {
    return isWithinTrackingDateRange(o.created_at, currentTrackingDateFilter);
  }).sort(function(a, b) {
    return new Date(a.created_at) - new Date(b.created_at);
  });
  if (search) {
    orders = orders.filter(function(o) {
      var id = (o.id || '').toLowerCase();
      var name = (o.customer_info || '').toLowerCase();
      return id.includes(search) || name.includes(search);
    });
  }
  if (orders.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#a09098"><i class="ti ti-inbox" style="font-size:32px;display:block;margin-bottom:8px"></i>ไม่พบออเดอร์</div>';
    return;
  }
  list.innerHTML = orders.map(function(o) {
    var custFirst = (o.customer_info || '').split('\n')[0] || '-';
    var patterns = (o.patterns || []).join(', ');
    if (patterns.length > 30) patterns = patterns.substring(0, 30) + '...';
    var statusLabel = STATUS_LABELS[o.status] || 'ไม่ทราบ';
    var d = new Date(o.created_at);
    var dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    var saved = o.tracking_number ? ' saved' : '';
    return '<div class="track-row' + saved + '">'
      + '<div class="track-row-top">'
      + '<div class="track-info">'
      + '<div class="track-id">' + escapeHtml(o.id) + '</div>'
      + '<div class="track-cust">' + escapeHtml(custFirst) + '</div>'
      + '<div class="track-date">' + dateStr + '</div>'
      + '<div class="track-patterns">' + escapeHtml(patterns) + '</div>'
      + '</div>'
      + '<div class="track-inputs">'
      + '<input class="track-carrier-select" data-docid="' + escapeHtmlAttr(o._docId) + '" data-orderid="' + escapeHtmlAttr(o.id) + '" list="carrierOptions" placeholder="Flash/Shopee" value="' + escapeHtmlAttr(o.tracking_carrier || '') + '"/>'
      + '<input class="track-num-input" data-docid="' + escapeHtmlAttr(o._docId) + '" data-orderid="' + escapeHtmlAttr(o.id) + '" placeholder="ใส่เลขพัสดุ..." value="' + escapeHtmlAttr(o.tracking_number || '') + '"/>'
      + '<button class="track-save-btn" onclick="saveTracking(this)" data-docid="' + escapeHtmlAttr(o._docId) + '" data-orderid="' + escapeHtmlAttr(o.id) + '"><i class="ti ti-check"></i></button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function saveTracking(btn) {
  var docId = btn.dataset.docid;
  var orderId = btn.dataset.orderid;
  var row = btn.closest('.track-row');
  var numInput = row.querySelector('.track-num-input');
  var carrierInput = row.querySelector('.track-carrier-select');
  var trackingNumber = numInput.value.trim();
  var carrier = carrierInput.value.trim();
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i>';
  fetch('/api/orders/' + encodeURIComponent(docId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tracking_number: trackingNumber, tracking_carrier: carrier }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { showToast('error', data.error); return; }
      row.classList.add('saved');
      showToast('success', 'บันทึกเลข ' + orderId + ' เรียบร้อย');
      var idx = allOrders.findIndex(function(o) { return o._docId === docId; });
      if (idx !== -1) {
        allOrders[idx].tracking_number = trackingNumber;
        allOrders[idx].tracking_carrier = carrier;
      }
    })
    .catch(function() { showToast('error', 'บันทึกไม่สำเร็จ'); })
    .finally(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-check"></i>';
    });
}

// ==================== PRINT LABELS ====================
var printSelectedOrders = {};

function renderPrintTable() {
  var tbody = document.getElementById('printTableBody');
  var empty = document.getElementById('printEmptyState');
  var confirmedOrders = allOrders.filter(function(o) { return o.status >= 1 && o.type !== 'wallpaper'; });

  if (confirmedOrders.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Group by pattern
  var groups = {};
  confirmedOrders.forEach(function(o) {
    var pq = o.pattern_qtys || {};
    (o.patterns || []).forEach(function(name) {
      if (!groups[name]) groups[name] = { total: 0, orders: [] };
      var qty = pq[name] || o.qty || 1;
      groups[name].total += qty;
      groups[name].orders.push({ order: o, qty: qty });
    });
  });

  // Sort by total desc
  var sortedNames = Object.keys(groups).sort(function(a, b) { return groups[b].total - groups[a].total; });

  var html = '';
  sortedNames.forEach(function(name) {
    var g = groups[name];
    var allPrinted = g.orders.every(function(item) { return item.order.printed_at; });
    var badgeClass = allPrinted ? ' print-group-badge-done' : '';
    var badgeText = allPrinted ? '✅ พิมพ์แล้ว' : '';

    html += '<tr class="print-group-row">';
    html += '<td class="print-td-check"><input type="checkbox" data-group="' + escapeHtmlAttr(name) + '" onchange="printToggleGroup(\'' + escapeHtmlAttr(name) + '\', this.checked)"/></td>';
    html += '<td class="print-group-name"><span class="print-group-icon"><i class="ti ti-photo"></i></span> ' + escapeHtml(name) + '</td>';
    html += '<td class="print-group-qty">' + g.total + ' ใบ</td>';
    html += '<td><span class="print-group-badge' + badgeClass + '">' + badgeText + '</span></td>';
    html += '</tr>';

    g.orders.forEach(function(item) {
      var o = item.order;
      var checked = printSelectedOrders[o._docId] ? ' checked' : '';
      var rowClass = printSelectedOrders[o._docId] ? ' print-selected' : '';
      if (o.printed_at) rowClass += ' print-already-done';
      var customer = (o.customer_info || '').split('\n')[0] || '-';
      html += '<tr class="print-item-row' + rowClass + '" data-docid="' + escapeHtmlAttr(o._docId) + '" data-group="' + escapeHtmlAttr(name) + '">';
      html += '<td class="print-td-check"><input type="checkbox"' + checked + ' onchange="printToggleOrder(\'' + escapeHtmlAttr(o._docId) + '\', this.checked, this)"/></td>';
      html += '<td class="print-item-customer">' + escapeHtml(customer) + ' × ' + item.qty + '</td>';
      html += '<td></td>';
      html += '<td>' + (o.printed_at ? '<span class="print-item-badge">printed</span>' : '') + '</td>';
      html += '</tr>';
    });
  });

  tbody.innerHTML = html;
}

function printToggleGroup(groupName, checked) {
  var rows = document.querySelectorAll('#printTableBody tr[data-group="' + CSS.escape(groupName) + '"].print-item-row');
  rows.forEach(function(row) {
    var cb = row.querySelector('input[type="checkbox"]');
    var docId = row.dataset.docid;
    if (cb && docId) {
      cb.checked = checked;
      if (checked) { printSelectedOrders[docId] = true; }
      else { delete printSelectedOrders[docId]; }
      row.classList.toggle('print-selected', checked);
    }
  });
  printUpdateCount();
}

function printToggleOrder(docId, checked, checkbox) {
  if (checked) { printSelectedOrders[docId] = true; }
  else { delete printSelectedOrders[docId]; }
  var row = checkbox.closest('tr');
  if (row) row.classList.toggle('print-selected', checked);
  printUpdateCount();
}

function printToggleAll(checked) {
  var checkboxes = document.querySelectorAll('#printTableBody input[type="checkbox"]');
  checkboxes.forEach(function(cb) {
    cb.checked = checked;
    var row = cb.closest('tr');
    var docId = row ? row.dataset.docid : null;
    if (docId) {
      if (checked) printSelectedOrders[docId] = true;
      else delete printSelectedOrders[docId];
      if (row) row.classList.toggle('print-selected', checked);
    }
  });
  printUpdateCount();
}

function printSelectAll() {
  var checkboxes = document.querySelectorAll('#printTableBody input[type="checkbox"]');
  checkboxes.forEach(function(cb) {
    cb.checked = true;
    var row = cb.closest('tr');
    var docId = row ? row.dataset.docid : null;
    if (docId) {
      printSelectedOrders[docId] = true;
      if (row) row.classList.add('print-selected');
    }
  });
  document.getElementById('printCheckAll').checked = true;
  printUpdateCount();
}

function printDeselectAll() {
  printSelectedOrders = {};
  var checkboxes = document.querySelectorAll('#printTableBody input[type="checkbox"]');
  checkboxes.forEach(function(cb) {
    cb.checked = false;
    var row = cb.closest('tr');
    if (row) row.classList.remove('print-selected');
  });
  document.getElementById('printCheckAll').checked = false;
  printUpdateCount();
}

function printUpdateCount() {
  var count = Object.keys(printSelectedOrders).length;
  document.getElementById('printSelectedCount').textContent = count;
  document.getElementById('printBtn').disabled = count === 0;
}

function buildLabelHTML(order) {
  var lines = (order.customer_info || '').split('\n');
  var customerName = order.customer_name || lines[0] || '';
  var phone = order.customer_phone || (lines.length > 1 ? lines[1] : '');
  var address = order.customer_address || (lines.length > 2 ? lines.slice(2).join('\n') : '');

  var pq = order.pattern_qtys || {};
  var patternList = (order.patterns || []).map(function(name) {
    var qty = pq[name] || order.qty || 1;
    return escapeHtml(name) + ' × ' + qty;
  }).join('  ·  ');

  var d = new Date(order.created_at);
  var dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  var note = order.note || '';

  return '<div class="ship-label">'
    + '<div class="ship-label-header">'
    + '<div class="ship-label-brand">hello<span>x</span>glitter</div>'
    + '<div class="ship-label-id">' + escapeHtml(order.id) + '</div>'
    + '</div>'
    + '<div class="ship-label-body">'
    + '<div class="ship-label-customer"><strong>ถึง:</strong> ' + escapeHtml(customerName) + '</div>'
    + (phone ? '<div class="ship-label-customer" style="font-size:12px;color:#666;font-weight:600">📞 ' + escapeHtml(phone) + '</div>' : '')
    + (address ? '<div class="ship-label-address">' + escapeHtml(address) + '</div>' : '')
    + '<div class="ship-label-patterns">'
    + '<div class="ship-label-patterns-title">สินค้า</div>'
    + '<div class="ship-label-patterns-list">' + patternList + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="ship-label-footer">'
    + '<div class="ship-label-date">' + dateStr + '</div>'
    + (note ? '<div class="ship-label-note">📌 ' + escapeHtml(note) + '</div>' : '')
    + '</div>'
    + '</div>';
}

async function generateLabelsPDF() {
  var ids = Object.keys(printSelectedOrders);
  if (ids.length === 0) return;

  var btn = document.getElementById('printBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> กำลังสร้าง PDF...';

  try {
    var container = document.getElementById('labelContainer');
    container.innerHTML = '';

    var orders = ids.map(function(docId) {
      return allOrders.find(function(o) { return o._docId === docId; });
    }).filter(Boolean);

    var { jsPDF } = window.jspdf;
    var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [150, 100] });

    for (var i = 0; i < orders.length; i++) {
      var labelDiv = document.createElement('div');
      labelDiv.innerHTML = buildLabelHTML(orders[i]);
      labelDiv.style.position = 'absolute';
      labelDiv.style.left = '0';
      labelDiv.style.top = '0';
      container.appendChild(labelDiv);

      await new Promise(function(r) { setTimeout(r, 100); });

      var canvas = await html2canvas(labelDiv, { scale: 3, useCORS: true, logging: false });
      var imgData = canvas.toDataURL('image/jpeg', 0.95);

      if (i > 0) pdf.addPage([150, 100], 'landscape');
      pdf.addImage(imgData, 'JPEG', 0, 0, 150, 100);

      container.removeChild(labelDiv);
    }

    pdf.save('helloxglitter-labels-' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast('success', 'สร้าง PDF เรียบร้อย (' + orders.length + ' ใบ)');

    // Mark as printed
    await markPrinted(ids);
    renderPrintTable();
  } catch (err) {
    console.error('PDF error:', err);
    showToast('error', 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    btn.disabled = false;
    printUpdateCount();
    btn.innerHTML = '<i class="ti ti-printer"></i> พิมพ์ที่เลือก (<span id="printSelectedCount">' + Object.keys(printSelectedOrders).length + '</span>)';
  }
}

async function markPrinted(docIds) {
  var now = new Date().toISOString();
  for (var i = 0; i < docIds.length; i++) {
    var docId = docIds[i];
    var order = allOrders.find(function(o) { return o._docId === docId; });
    if (order) order.printed_at = now;
    try {
      await fetch('/api/orders/' + encodeURIComponent(docId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ printed_at: now })
      });
    } catch (e) {
      console.error('Mark printed failed:', docId, e);
    }
  }
  printSelectedOrders = {};
  printUpdateCount();
}

// ==================== HELPERS ====================
function toggleBuyers(el) { el.classList.toggle('open'); }

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', function() {
  checkAuth();

  // Filter tabs
  document.getElementById('filterTabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.ftab');
    if (!tab) return;
    document.querySelectorAll('.ftab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    filterOrders();
  });

  document.getElementById('filterDateTabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.dftab');
    if (!tab) return;
    switchDateOrderFilter(tab.dataset.dfilter);
  });
});
function copyCustomerInfo(name, phone, address) {
  var text = [name, phone, address].filter(Boolean).join("\n");
  navigator.clipboard.writeText(text).then(function() {
    showToast("คัดลอกข้อมูลลูกค้าแล้ว");
  });
}

/* =========================================================
   PRODUCTS & PROMOS (MIGRATED FROM STOREFRONT)
   ========================================================= */

const PRODUCT_KEY = "hlg_custom_products_v1";
// Must match the storefront product manager (public/index.html) so images written
// from /admin/ are visible to customers and vice versa.
const PRODUCT_DB = "hlg_product_media_v1", PRODUCT_STORE = "images";
const CATEGORY_KEY = "hlg_categories_v2";
const PREVIEW_KEY = "hlg_preview_cards_v2";

let adminCategories = [];
let customProducts = [];
let adminPreviewCards = [];
let customProductImageUrls = [];

function openProductDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(Error("เบราว์เซอร์นี้ไม่รองรับพื้นที่เก็บรูป")); return; }
    const q = indexedDB.open(PRODUCT_DB, 1);
    q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains(PRODUCT_STORE)) q.result.createObjectStore(PRODUCT_STORE); };
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error || Error("เปิดพื้นที่รูปไม่สำเร็จ"));
  });
}

async function productMedia(key, blob) {
  const db = await openProductDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(PRODUCT_STORE, blob === undefined ? "readonly" : "readwrite");
      const store = t.objectStore(PRODUCT_STORE);
      const q = blob === undefined ? store.get(key) : blob === null ? store.delete(key) : store.put(blob, key);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error || Error("บันทึกรูปไม่สำเร็จ"));
    });
  } finally {
    db.close();
  }
}

async function fetchCategories() {
  try {
    const res = await fetch('/api/categories', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories)) {
        adminCategories = data.categories;
        localStorage.setItem(CATEGORY_KEY, JSON.stringify(adminCategories));
        return adminCategories;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch categories from API:', err);
  }
  try {
    const cached = JSON.parse(localStorage.getItem(CATEGORY_KEY) || '[]');
    if (Array.isArray(cached) && cached.length > 0) adminCategories = cached;
  } catch (e) {}
  if (!adminCategories.length) {
    adminCategories = [
      { id: 'bag', name: 'กระเป๋าผ้า', description: 'กระเป๋าผ้าลายน่ารัก 4 ไซส์ 46 ลาย', is_builtin: true, show_on_home: true },
      { id: 'sticker', name: 'Sticker', description: 'สติกเกอร์ไดคัทสุดคิ้วท์', is_builtin: true, show_on_home: true },
      { id: 'wallpaper', name: 'Wallpaper', description: 'Digital item วอลเปเปอร์มือถือ', is_builtin: true, show_on_home: true }
    ];
  }
  return adminCategories;
}

async function fetchCustomProducts() {
  try {
    const res = await fetch('/api/products', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.products)) {
        customProducts = data.products;
        localStorage.setItem(PRODUCT_KEY, JSON.stringify(customProducts));
        return customProducts;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch products from API:', err);
  }
  try {
    const cached = JSON.parse(localStorage.getItem(PRODUCT_KEY) || '[]');
    if (Array.isArray(cached)) customProducts = cached;
  } catch (e) {}
  return customProducts;
}

async function fetchPreviewCards() {
  try {
    const res = await fetch('/api/preview-cards', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.preview_cards)) {
        adminPreviewCards = data.preview_cards;
        localStorage.setItem(PREVIEW_KEY, JSON.stringify(adminPreviewCards));
        return adminPreviewCards;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch preview cards from API:', err);
  }
  try {
    const cached = JSON.parse(localStorage.getItem(PREVIEW_KEY) || '[]');
    if (Array.isArray(cached) && cached.length > 0) adminPreviewCards = cached;
  } catch (e) {}
  if (!adminPreviewCards.length) {
    adminPreviewCards = [
      { target: 'preorder', name: 'กระเป๋าผ้า HLG', sub: 'เลือกลายที่ชอบได้เลย ♡', image_url: '' },
      { target: 'wallpaper', name: 'Wallpaper Collection', sub: 'Digital item', image_url: '' },
      { target: 'sticker', name: 'Sticker Collection', sub: 'ดูคอลเลกชันล่าสุด', image_url: '' }
    ];
  }
  return adminPreviewCards;
}

async function hydrateProducts() {
  for (const u of customProductImageUrls) {
    try { URL.revokeObjectURL(u); } catch(e){}
  }
  customProductImageUrls = [];

  await Promise.all([
    fetchCategories(),
    fetchCustomProducts(),
    fetchPreviewCards()
  ]);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('อ่านรูปภาพไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

/* ==================== 1. CATEGORY MANAGER ==================== */
function renderCategoryManager() {
  const container = document.getElementById("categoryManagerContainer");
  if (!container) return;

  container.innerHTML = `
    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 8px;color:#a83e6a">สร้าง / แก้ไขหมวดหมู่สินค้า</h3>
      <p style="font-size:12px;color:#866d79;margin:0 0 14px;line-height:1.6">
        สร้างหมวดหมู่ใหม่เพื่อเปิดหน้ารวมสินค้าของหมวดนั้น และเลือกให้แสดงเป็นการ์ดพรีวิวบนหน้าแรกอัตโนมัติได้
      </p>
      <form id="hlgCatForm">
        <input type="hidden" id="hlgCatEditId">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;">
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            ชื่อหมวดหมู่ <span style="color:#d45a8a">*</span>
            <input id="hlgCatName" required maxlength="90" placeholder="เช่น พวงกุญแจ, กระเป๋าเป้, GripTok" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            คำอธิบายสั้น ๆ
            <input id="hlgCatDesc" maxlength="150" placeholder="เช่น สินค้าน่ารัก งานอะคริลิคเคลือบกลิตเตอร์" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            อัปโหลดรูปหน้าปกหมวด
            <input id="hlgCatCoverFile" type="file" accept="image/*" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            หรือใส่ลิงก์รูป HTTPS
            <input id="hlgCatCoverUrl" type="url" placeholder="https://..." style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
        </div>
        <div style="margin:12px 0 6px">
          <label style="font-size:13px;color:#765461;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="hlgCatShowHome" checked style="width:16px;height:16px">
            สร้างการ์ดพรีวิวบนหน้าแรก (กลุ่มที่แนะนำ 💗) อัตโนมัติ
          </label>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button type="submit" id="hlgCatSaveBtn" style="border:0;border-radius:10px;padding:10px 18px;background:#bc4b7b;color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">
            บันทึกหมวดหมู่
          </button>
          <button type="button" id="hlgCatCancelBtn" style="border:0;border-radius:10px;padding:10px 14px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:13px;cursor:pointer;">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>

    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 12px;color:#a83e6a">หมวดหมู่ทั้งหมดในระบบ</h3>
      <div id="hlgCategoryList"></div>
    </div>
  `;

  document.getElementById("hlgCatForm").onsubmit = saveCategory;
  document.getElementById("hlgCatCancelBtn").onclick = resetCategoryForm;
  renderCategoryList();
}

function renderCategoryList() {
  const container = document.getElementById("hlgCategoryList");
  if (!container) return;
  container.innerHTML = "";

  if (!adminCategories.length) {
    container.textContent = "ยังไม่มีหมวดหมู่";
    return;
  }

  adminCategories.forEach(c => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;align-items:center;border-top:1px solid #f4dfeb;padding:12px 0;";

    const img = document.createElement("img");
    img.src = c.cover_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E🎀%3C/text%3E%3C/svg%3E";
    img.alt = c.name;
    img.style.cssText = "width:50px;height:50px;object-fit:cover;border-radius:10px;background:#fff2f8;border:1px solid #f4dce7;";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";

    const nameEl = document.createElement("b");
    nameEl.textContent = c.name;
    nameEl.style.cssText = "color:#7b3c58;font-size:14px;";

    const idBadge = document.createElement("span");
    idBadge.textContent = "ID: " + c.id;
    idBadge.style.cssText = "font-size:10px;padding:2px 6px;border-radius:6px;background:#fceaf1;color:#b24775;";

    titleRow.append(nameEl, idBadge);

    if (c.is_builtin) {
      const builtinBadge = document.createElement("span");
      builtinBadge.textContent = "หมวดหลัก";
      builtinBadge.style.cssText = "font-size:10px;padding:2px 6px;border-radius:6px;background:#f0e6ff;color:#7c3aed;";
      titleRow.append(builtinBadge);
    }

    const descEl = document.createElement("small");
    const count = customProducts.filter(p => (p.category_id || p.type) === c.id).length;
    descEl.textContent = (c.description || "ไม่มีคำอธิบาย") + " · มี " + count + " สินค้า";
    descEl.style.cssText = "display:block;color:#927888;font-size:12px;margin-top:3px;";

    info.append(titleRow, descEl);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;align-items:center;";

    const editBtn = document.createElement("button");
    editBtn.textContent = "แก้ไข";
    editBtn.type = "button";
    editBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:12px;cursor:pointer;";
    editBtn.onclick = () => editCategoryRow(c.id);
    actions.append(editBtn);

    if (!c.is_builtin) {
      const delBtn = document.createElement("button");
      delBtn.textContent = "ลบ";
      delBtn.type = "button";
      delBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fff0f5;color:#c53063;font:inherit;font-size:12px;cursor:pointer;";
      delBtn.onclick = () => deleteCategory(c.id);
      actions.append(delBtn);
    }

    row.append(img, info, actions);
    container.append(row);
  });
}

function editCategoryRow(id) {
  const c = adminCategories.find(x => x.id === id);
  if (!c) return;
  document.getElementById("hlgCatEditId").value = c.id;
  document.getElementById("hlgCatName").value = c.name;
  document.getElementById("hlgCatDesc").value = c.description || "";
  document.getElementById("hlgCatCoverUrl").value = c.cover_url || "";
  document.getElementById("hlgCatShowHome").checked = c.show_on_home !== false;
  document.getElementById("hlgCatSaveBtn").textContent = "อัปเดตหมวดหมู่";
  document.getElementById("hlgCatForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetCategoryForm() {
  document.getElementById("hlgCatEditId").value = "";
  document.getElementById("hlgCatName").value = "";
  document.getElementById("hlgCatDesc").value = "";
  document.getElementById("hlgCatCoverFile").value = "";
  document.getElementById("hlgCatCoverUrl").value = "";
  document.getElementById("hlgCatShowHome").checked = true;
  document.getElementById("hlgCatSaveBtn").textContent = "บันทึกหมวดหมู่";
}

async function saveCategory(e) {
  e.preventDefault();
  const id = document.getElementById("hlgCatEditId").value;
  const name = document.getElementById("hlgCatName").value.trim();
  const description = document.getElementById("hlgCatDesc").value.trim();
  const coverUrlInput = document.getElementById("hlgCatCoverUrl").value.trim();
  const showOnHome = document.getElementById("hlgCatShowHome").checked;
  const file = document.getElementById("hlgCatCoverFile").files[0];

  if (!name) { showToast("กรุณากรอกชื่อหมวดหมู่"); return; }

  let cover_url = coverUrlInput;
  if (file) {
    try {
      cover_url = await fileToBase64(file);
    } catch (err) {
      showToast("อ่านไฟล์รูปภาพไม่สำเร็จ");
      return;
    }
  }

  const btn = document.getElementById("hlgCatSaveBtn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const url = id ? `/api/categories/${encodeURIComponent(id)}` : '/api/categories';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, description, cover_url, show_on_home: showOnHome })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw Error(data.error || 'บันทึกหมวดหมู่ไม่สำเร็จ');
    }

    await hydrateProducts();
    resetCategoryForm();
    renderCategoryManager();
    renderProductsView();
    renderPreviewManager();
    showToast("success", id ? "อัปเดตหมวดหมู่เรียบร้อยแล้ว ✓" : "สร้างหมวดหมู่ใหม่แล้ว ♡");
  } catch (err) {
    console.error(err);
    showToast("error", err.message || "บันทึกหมวดหมู่ไม่สำเร็จ");
  } finally {
    btn.disabled = false;
    btn.textContent = id ? "อัปเดตหมวดหมู่" : "บันทึกหมวดหมู่";
  }
}

async function deleteCategory(id) {
  const c = adminCategories.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`ลบหมวดหมู่ "${c.name}" ใช่ไหมคะ? (สินค้าในหมวดนี้และการ์ดพรีวิวจะถูกลบไปด้วย)`)) return;

  try {
    const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'ลบไม่สำเร็จ');

    await hydrateProducts();
    renderCategoryManager();
    renderProductsView();
    renderPreviewManager();
    showToast("success", "ลบหมวดหมู่เรียบร้อยแล้ว ✓");
  } catch (err) {
    showToast("error", err.message || "ลบหมวดหมู่ไม่สำเร็จ");
  }
}

/* ==================== 2. DYNAMIC PRODUCT MANAGER ==================== */
function renderProductsView() {
  const p = document.getElementById("productManagerContainer");
  if (!p) return;

  const categoryOptions = adminCategories.map(c => {
    const icon = c.id === 'bag' ? '👜' : c.id === 'sticker' ? '✨' : c.id === 'wallpaper' ? '🎨' : '🎀';
    return `<option value="${c.id}">${icon} ${esc(c.name)}</option>`;
  }).join('');

  p.innerHTML = `
    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 12px;color:#a83e6a">เพิ่ม / แก้ไขสินค้า</h3>
      <form id="hlgProductForm">
        <input type="hidden" id="hlgEditId">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            หมวดหมู่สินค้า <span style="color:#d45a8a">*</span>
            <select id="hlgType" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
              ${categoryOptions}
            </select>
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            ชื่อสินค้า <span style="color:#d45a8a">*</span>
            <input id="hlgName" required maxlength="90" placeholder="เช่น กระเป๋าลายดาว, พวงกุญแจโบว์ชมพู" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label id="hlgSizeWrap" style="display:block;font-size:13px;color:#765461;font-weight:600">
            ขนาดกระเป๋า
            <select id="hlgSize" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
              <option value="normal">Normal · 15×16"</option>
              <option value="large">Large · 15.5×4×16"</option>
              <option value="easy">Easy Bag · 10.5×5×14"</option>
              <option value="maxi">Maxi · 18×20"</option>
            </select>
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            ราคา (บาท) <span style="color:#d45a8a">*</span>
            <input id="hlgPrice" type="number" min="0" max="999999" step="1" required placeholder="เช่น 69" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            คำอธิบายสั้น ๆ
            <input id="hlgProdDesc" maxlength="150" placeholder="เช่น ไซส์กะทัดรัด จุของได้เยอะ" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            อัปโหลดรูปสินค้า
            <input id="hlgImageFile" type="file" accept="image/*" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            หรือใส่ลิงก์รูป HTTPS
            <input id="hlgImageUrl" type="url" placeholder="https://..." style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
        </div>
        <p style="font-size:12px;color:#866d79;margin-top:8px">รูปและข้อมูลสินค้าจะบันทึกขึ้นฐานข้อมูลออนไลน์ ทุกเครื่องและลูกค้าจะเห็นพร้อมกันทันที</p>
        <div style="margin-top:12px">
          <button type="submit" id="hlgProductSave" style="border:0;border-radius:10px;padding:10px 18px;background:#bc4b7b;color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">บันทึกสินค้า</button>
          <button type="button" class="hlg-cancel" id="hlgProductCancel" style="border:0;border-radius:10px;padding:10px 14px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:13px;cursor:pointer;margin-left:8px;">ยกเลิกแก้ไข</button>
        </div>
      </form>
    </div>
    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 12px;color:#a83e6a">สินค้าที่เพิ่มเองทั้งหมด</h3>
      <div id="hlgProductRows"></div>
    </div>
  `;

  document.getElementById("hlgType").onchange = function() {
    const isBag = this.value === "bag";
    document.getElementById("hlgSizeWrap").style.display = isBag ? "" : "none";
  };
  document.getElementById("hlgProductForm").onsubmit = saveProduct;
  document.getElementById("hlgProductCancel").onclick = resetProductForm;
  renderProductList();
}

function renderProductList() {
  const p = document.getElementById("hlgProductRows");
  if (!p) return;
  p.innerHTML = "";
  if (!customProducts.length) {
    p.textContent = "ยังไม่มีสินค้าที่เพิ่มเอง";
    return;
  }

  customProducts.forEach(x => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;gap:12px;align-items:center;border-top:1px solid #f4dfeb;padding:11px 0;";

    const img = document.createElement("img");
    img.src = x.image_url || x.imageUrl || x._img || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='52' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E🛍️%3C/text%3E%3C/svg%3E";
    img.alt = x.name;
    img.style.cssText = "width:52px;height:52px;object-fit:cover;border-radius:9px;background:#f8edf2;border:1px solid #f2d7e4";

    const label = document.createElement("span");
    label.style.cssText = "flex:1;font-size:13px;";

    const b = document.createElement("b");
    b.textContent = x.name;
    b.style.cssText = "color:#7b3c58;";

    const catId = x.category_id || x.type || 'other';
    const cat = adminCategories.find(c => c.id === catId);
    const catName = cat ? cat.name : catId;

    const small = document.createElement("small");
    const subText = (catId === "bag" && x.size ? x.size + " · " : "") + catName + " · " + Number(x.price).toLocaleString() + " ฿";
    small.textContent = subText;
    small.style.cssText = "display:block;color:#927888;margin-top:3px";

    label.append(b, small);

    const editBtn = document.createElement("button");
    editBtn.textContent = "แก้ไข";
    editBtn.type = "button";
    editBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:12px;cursor:pointer;";
    editBtn.onclick = () => editProductRow(x.id);

    const delBtn = document.createElement("button");
    delBtn.textContent = "ลบ";
    delBtn.type = "button";
    delBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fff0f5;color:#c53063;font:inherit;font-size:12px;cursor:pointer;margin-left:6px;";
    delBtn.onclick = () => deleteProductRow(x.id);

    el.append(img, label, editBtn, delBtn);
    p.append(el);
  });
}

function editProductRow(id) {
  const x = customProducts.find(r => r.id === id);
  if (!x) return;
  document.getElementById("hlgEditId").value = x.id;
  document.getElementById("hlgType").value = x.category_id || x.type || "bag";
  document.getElementById("hlgName").value = x.name;
  document.getElementById("hlgSize").value = x.sizeKey || x.size_key || "normal";
  document.getElementById("hlgPrice").value = x.price;
  document.getElementById("hlgProdDesc").value = x.description || "";
  document.getElementById("hlgImageUrl").value = x.image_url || x.imageUrl || "";
  document.getElementById("hlgImageFile").value = "";

  const isBag = (x.category_id || x.type) === "bag";
  document.getElementById("hlgSizeWrap").style.display = isBag ? "" : "none";
  document.getElementById("hlgProductSave").textContent = "อัปเดตสินค้า";
  document.getElementById("hlgProductForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
  document.getElementById("hlgEditId").value = "";
  document.getElementById("hlgName").value = "";
  document.getElementById("hlgPrice").value = "";
  document.getElementById("hlgProdDesc").value = "";
  document.getElementById("hlgImageUrl").value = "";
  document.getElementById("hlgImageFile").value = "";
  document.getElementById("hlgProductSave").textContent = "บันทึกสินค้า";
  const isBag = document.getElementById("hlgType").value === "bag";
  document.getElementById("hlgSizeWrap").style.display = isBag ? "" : "none";
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById("hlgEditId").value;
  const category_id = document.getElementById("hlgType").value;
  const name = document.getElementById("hlgName").value.trim();
  const price = Number(document.getElementById("hlgPrice").value);
  const sizeKey = document.getElementById("hlgSize").value;
  const description = document.getElementById("hlgProdDesc").value.trim();
  const file = document.getElementById("hlgImageFile").files[0];
  const imageUrlInput = document.getElementById("hlgImageUrl").value.trim();

  if (!name || isNaN(price) || price < 0) { showToast("กรอกชื่อและราคาที่ถูกต้อง"); return; }

  let image_url = imageUrlInput;
  if (file) {
    try {
      image_url = await fileToBase64(file);
    } catch (err) {
      showToast("อ่านไฟล์รูปภาพไม่สำเร็จ");
      return;
    }
  }

  const sizeMap = { normal: 'Normal · 15×16"', large: 'Large · 15.5×4×16"', easy: 'Easy Bag · 10.5×5×14"', maxi: 'Maxi · 18×20"' };
  const payload = {
    category_id,
    type: category_id,
    name,
    price,
    description,
    image_url,
    size_key: category_id === 'bag' ? sizeKey : '',
    sizeKey: category_id === 'bag' ? sizeKey : '',
    size: category_id === 'bag' ? sizeMap[sizeKey] : ''
  };

  const button = document.getElementById("hlgProductSave");
  button.disabled = true;
  button.textContent = "กำลังบันทึก...";

  try {
    const url = id ? `/api/products/${encodeURIComponent(id)}` : '/api/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'บันทึกสินค้าไม่สำเร็จ');

    await hydrateProducts();
    resetProductForm();
    renderProductsView();
    showToast("success", id ? "อัปเดตสินค้าเรียบร้อยแล้ว ✓" : "บันทึกสินค้าแล้ว ♡");
  } catch (err) {
    console.error(err);
    showToast("error", err.message || "บันทึกสินค้าไม่สำเร็จ");
  } finally {
    button.disabled = false;
    button.textContent = id ? "อัปเดตสินค้า" : "บันทึกสินค้า";
  }
}

async function deleteProductRow(id) {
  const x = customProducts.find(r => r.id === id);
  if (!x || !confirm(`ลบสินค้า "${x.name}" ใช่ไหมคะ?`)) return;

  try {
    const res = await fetch(`/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'ลบไม่สำเร็จ');

    await hydrateProducts();
    renderProductsView();
    showToast("success", "ลบสินค้าแล้ว ✓");
  } catch (err) {
    showToast("error", err.message || "ลบสินค้าไม่สำเร็จ");
  }
}

/* ==================== 3. HOME PREVIEW CARDS MANAGER ==================== */
function renderPreviewManager() {
  const container = document.getElementById("previewManagerContainer");
  if (!container) return;

  const targetOptions = [
    ['preorder', 'กระเป๋าผ้า (Pre-order)'],
    ['wallpaper', 'Wallpaper Collection'],
    ['sticker', 'Sticker Collection'],
    ...adminCategories.filter(c => !['bag','sticker','wallpaper'].includes(c.id)).map(c => [c.id, 'หมวด: ' + c.name]),
    ['cart', 'ตะกร้าของฉัน'],
    ['tracking', 'ติดตามคิว / พัสดุ'],
    ['home', 'หน้าหลัก'],
    ['external', 'ลิงก์ภายนอก']
  ].map(x => `<option value="${x[0]}">${x[1]}</option>`).join('');

  container.innerHTML = `
    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 8px;color:#a83e6a">การ์ดพรีวิวบนหน้าแรก (กลุ่มที่แนะนำ 💗)</h3>
      <p style="font-size:12px;color:#866d79;margin:0 0 14px;line-height:1.6">
        การ์ดเหล่านี้จะแสดงบนหน้าแรกของลูกค้าทันที สามารถเพิ่ม แก้ไข ย้ายลำดับ หรือเชื่อมไปยังหมวดสินค้าใดก็ได้
      </p>

      <form id="hlgPreviewForm">
        <input type="hidden" id="hlgPvIndex" value="-1">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            ชื่อการ์ดพรีวิว <span style="color:#d45a8a">*</span>
            <input id="hlgPvName" required maxlength="70" placeholder="เช่น กระเป๋าผ้า HLG" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            ข้อความรอง
            <input id="hlgPvSub" maxlength="90" placeholder="เช่น เลือกลายที่ชอบได้เลย ♡" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            เมื่อกดแล้วไปที่ <span style="color:#d45a8a">*</span>
            <select id="hlgPvTarget" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
              ${targetOptions}
            </select>
          </label>
          <label id="hlgPvUrlWrap" style="display:none;font-size:13px;color:#765461;font-weight:600">
            URL ภายนอก
            <input id="hlgPvUrl" type="url" placeholder="https://..." style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            อัปโหลดรูปพรีวิว
            <input id="hlgPvFile" type="file" accept="image/*" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
          <label style="display:block;font-size:13px;color:#765461;font-weight:600">
            หรือใส่ลิงก์รูป HTTPS
            <input id="hlgPvImageUrl" type="url" placeholder="https://..." style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #e8c7d5;border-radius:10px;font:inherit;background:#fff">
          </label>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button type="submit" id="hlgPvSaveBtn" style="border:0;border-radius:10px;padding:10px 18px;background:#bc4b7b;color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">
            บันทึกการ์ดพรีวิว
          </button>
          <button type="button" id="hlgPvCancelBtn" style="border:0;border-radius:10px;padding:10px 14px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:13px;cursor:pointer;">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>

    <div style="background:#fff;border:1px solid #f2d5e1;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 6px 18px #b84b7b12;">
      <h3 style="margin:0 0 12px;color:#a83e6a">รายการการ์ดพรีวิวปัจจุบัน</h3>
      <div id="hlgPreviewList"></div>
    </div>
  `;

  document.getElementById("hlgPvTarget").onchange = function() {
    document.getElementById("hlgPvUrlWrap").style.display = this.value === "external" ? "" : "none";
  };
  document.getElementById("hlgPreviewForm").onsubmit = savePreviewCard;
  document.getElementById("hlgPvCancelBtn").onclick = resetPreviewForm;
  renderPreviewList();
}

function renderPreviewList() {
  const container = document.getElementById("hlgPreviewList");
  if (!container) return;
  container.innerHTML = "";

  if (!adminPreviewCards.length) {
    container.textContent = "ยังไม่มีการ์ดพรีวิว";
    return;
  }

  adminPreviewCards.forEach((card, idx) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;align-items:center;border-top:1px solid #f4dfeb;padding:12px 0;";

    const img = document.createElement("img");
    img.src = card.image_url || card.imageUrl || card.src || card.legacySrc || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='50' height='50' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E💗%3C/text%3E%3C/svg%3E";
    img.alt = card.name;
    img.style.cssText = "width:50px;height:50px;object-fit:cover;border-radius:10px;background:#fff2f8;border:1px solid #f4dce7;";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const nameEl = document.createElement("b");
    nameEl.textContent = card.name;
    nameEl.style.cssText = "color:#7b3c58;font-size:14px;";

    const targetBadge = document.createElement("span");
    targetBadge.textContent = "→ " + card.target;
    targetBadge.style.cssText = "font-size:10px;padding:2px 6px;border-radius:6px;background:#fceaf1;color:#b24775;";

    titleRow.append(nameEl, targetBadge);

    const subEl = document.createElement("small");
    subEl.textContent = card.sub || "ไม่มีข้อความรอง";
    subEl.style.cssText = "display:block;color:#927888;font-size:12px;margin-top:3px;";

    info.append(titleRow, subEl);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;align-items:center;";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.type = "button";
    upBtn.title = "เลื่อนขึ้น";
    upBtn.style.cssText = "border:0;border-radius:8px;padding:6px 10px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:12px;cursor:pointer;";
    upBtn.onclick = () => movePreviewCard(idx, -1);

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.type = "button";
    downBtn.title = "เลื่อนลง";
    downBtn.style.cssText = "border:0;border-radius:8px;padding:6px 10px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:12px;cursor:pointer;";
    downBtn.onclick = () => movePreviewCard(idx, 1);

    const editBtn = document.createElement("button");
    editBtn.textContent = "แก้ไข";
    editBtn.type = "button";
    editBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fceaf1;color:#a83e6a;font:inherit;font-size:12px;cursor:pointer;";
    editBtn.onclick = () => editPreviewCard(idx);

    const delBtn = document.createElement("button");
    delBtn.textContent = "ลบ";
    delBtn.type = "button";
    delBtn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;background:#fff0f5;color:#c53063;font:inherit;font-size:12px;cursor:pointer;";
    delBtn.onclick = () => deletePreviewCard(idx);

    actions.append(upBtn, downBtn, editBtn, delBtn);
    row.append(img, info, actions);
    container.append(row);
  });
}

function editPreviewCard(idx) {
  const card = adminPreviewCards[idx];
  if (!card) return;
  document.getElementById("hlgPvIndex").value = idx;
  document.getElementById("hlgPvName").value = card.name;
  document.getElementById("hlgPvSub").value = card.sub || "";
  document.getElementById("hlgPvTarget").value = card.target || "preorder";
  document.getElementById("hlgPvUrl").value = card.url || "";
  document.getElementById("hlgPvImageUrl").value = card.image_url || card.imageUrl || card.src || "";
  document.getElementById("hlgPvUrlWrap").style.display = card.target === "external" ? "" : "none";
  document.getElementById("hlgPvSaveBtn").textContent = "อัปเดตการ์ดพรีวิว";
  document.getElementById("hlgPreviewForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetPreviewForm() {
  document.getElementById("hlgPvIndex").value = "-1";
  document.getElementById("hlgPvName").value = "";
  document.getElementById("hlgPvSub").value = "";
  document.getElementById("hlgPvUrl").value = "";
  document.getElementById("hlgPvImageUrl").value = "";
  document.getElementById("hlgPvFile").value = "";
  document.getElementById("hlgPvUrlWrap").style.display = "none";
  document.getElementById("hlgPvSaveBtn").textContent = "บันทึกการ์ดพรีวิว";
}

async function savePreviewCard(e) {
  e.preventDefault();
  const idx = Number(document.getElementById("hlgPvIndex").value);
  const name = document.getElementById("hlgPvName").value.trim();
  const sub = document.getElementById("hlgPvSub").value.trim();
  const target = document.getElementById("hlgPvTarget").value;
  const url = document.getElementById("hlgPvUrl").value.trim();
  const imageUrlInput = document.getElementById("hlgPvImageUrl").value.trim();
  const file = document.getElementById("hlgPvFile").files[0];

  if (!name) { showToast("กรุณากรอกชื่อการ์ดพรีวิว"); return; }

  let image_url = imageUrlInput;
  if (file) {
    try {
      image_url = await fileToBase64(file);
    } catch (err) {
      showToast("อ่านไฟล์รูปภาพไม่สำเร็จ");
      return;
    }
  }

  const updatedCards = adminPreviewCards.slice();
  const cardData = {
    name,
    sub,
    target,
    url: target === 'external' ? url : '',
    image_url: image_url || (idx >= 0 ? (updatedCards[idx].image_url || updatedCards[idx].imageUrl || '') : '')
  };

  if (idx >= 0 && idx < updatedCards.length) {
    updatedCards[idx] = cardData;
  } else {
    updatedCards.push(cardData);
  }

  const btn = document.getElementById("hlgPvSaveBtn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const res = await fetch('/api/preview-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preview_cards: updatedCards })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'บันทึกการ์ดไม่สำเร็จ');

    adminPreviewCards = updatedCards;
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(adminPreviewCards));
    resetPreviewForm();
    renderPreviewManager();
    showToast("success", "บันทึกการ์ดพรีวิวเรียบร้อยแล้ว ♡");
  } catch (err) {
    showToast("error", err.message || "บันทึกการ์ดพรีวิวไม่สำเร็จ");
  } finally {
    btn.disabled = false;
    btn.textContent = idx >= 0 ? "อัปเดตการ์ดพรีวิว" : "บันทึกการ์ดพรีวิว";
  }
}

async function movePreviewCard(idx, delta) {
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= adminPreviewCards.length) return;
  const updated = adminPreviewCards.slice();
  const temp = updated[idx];
  updated[idx] = updated[targetIdx];
  updated[targetIdx] = temp;

  try {
    const res = await fetch('/api/preview-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preview_cards: updated })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'ย้ายลำดับไม่สำเร็จ');
    adminPreviewCards = updated;
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(adminPreviewCards));
    renderPreviewManager();
  } catch (err) {
    showToast("error", err.message || "ย้ายลำดับไม่สำเร็จ");
  }
}

async function deletePreviewCard(idx) {
  const card = adminPreviewCards[idx];
  if (!card || !confirm(`ลบการ์ดพรีวิว "${card.name}" ใช่ไหมคะ?`)) return;

  const updated = adminPreviewCards.filter((_, i) => i !== idx);
  try {
    const res = await fetch('/api/preview-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preview_cards: updated })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw Error(data.error || 'ลบไม่สำเร็จ');

    adminPreviewCards = updated;
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(adminPreviewCards));
    renderPreviewManager();
    showToast("success", "ลบการ์ดพรีวิวแล้ว ✓");
  } catch (err) {
    showToast("error", err.message || "ลบการ์ดไม่สำเร็จ");
  }
}

/* =========================================================
   PRODUCT & PROMO EDITORS (MIGRATED FROM STOREFRONT)
   The storefront keeps only the customer-facing engines
   (price/tier quote + font application). All editing UI lives
   here. Both sides share the same origin, so localStorage and
   IndexedDB keys below MUST stay in sync with public/index.html:
     products  : hlg_custom_products_v1 / hlg_product_media_v1
     promo     : hlg_quantity_promo_v1
     pricing   : hlg_pricing_v1
     font      : hlg_font_settings_v1 / hlg_custom_font_v1
   ========================================================= */
(function() {
  'use strict';

  var $ = function(s) { return document.querySelector(s); };
  var esc = function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function adminToast(msg) { try { showToast('success', msg); } catch (e) {} }

  // ---------------- shared product catalog ----------------
  function readCustomProducts() {
    try {
      var x = JSON.parse(localStorage.getItem('hlg_custom_products_v1') || '[]');
      return Array.isArray(x) ? x.filter(function(y) { return y && y.id; }) : [];
    } catch (e) { return []; }
  }
  function sku(x) {
    if (x.type === 'custom') return 'custom|' + String(x.categoryId || '') + '|' + String(x.productId || '');
    return String(x.type || '') + '|' + String(x.name || '') + '|' + String(x.variant || '');
  }
  function catalog() {
    var a = [];
    try {
      if (typeof ALL_PATTERNS !== 'undefined') ALL_PATTERNS.forEach(function(x) { if (x._hlgCustomId) return; a.push({ type: 'bag', name: x.name, variant: x.size || '', sizeKey: x.sizeKey, price: Number(x.priceOrig) || 0, image: x.img || '' }); });
    } catch (e) {}
    try {
      if (typeof STICKER_PATTERNS !== 'undefined') STICKER_PATTERNS.forEach(function(x) { if (x._hlgCustomId) return; a.push({ type: 'sticker', name: x.name, variant: '', price: Number(x.price) || 0, image: x.img || '' }); });
    } catch (e) {}
    readCustomProducts().forEach(function(x) {
      var catId = x.category_id || x.type || 'other';
      if (catId === 'bag') {
        a.push({ type: 'bag', name: x.name, variant: x.size || '', sizeKey: x.sizeKey, price: Number(x.price) || 0, image: x.image_url || x.imageUrl || '' });
      } else if (catId === 'sticker') {
        a.push({ type: 'sticker', name: x.name, variant: '', price: Number(x.price) || 0, image: x.image_url || x.imageUrl || '' });
      } else {
        var foundCat = (typeof adminCategories !== 'undefined' ? adminCategories : []).find(function(c) { return c.id === catId; });
        a.push({ type: 'custom', categoryId: catId, productId: x.id, name: x.name, variant: (foundCat ? foundCat.name : catId), price: Number(x.price) || 0, image: x.image_url || x.imageUrl || '' });
      }
    });
    a.push({ type: 'wallpaper', name: 'Wallpaper Special Set', variant: 'Digital Download', price: 99 });
    try { a.push.apply(a, window.hlgCollectionProducts ? window.hlgCollectionProducts() : []); } catch (e) {}
    return a;
  }
  function groupKey(x) { return x.type === 'custom' ? String(x.categoryId || 'custom') : String(x.type || 'other'); }
  function groupLabel(key, rows) {
    if (key === 'bag') return '👜 กระเป๋า';
    if (key === 'sticker') return '✨ Sticker';
    if (key === 'wallpaper') return '🎨 Wallpaper';
    var foundCat = (typeof adminCategories !== 'undefined' ? adminCategories : []).find(function(c) { return c.id === key; });
    if (foundCat) return '🎀 ' + foundCat.name;
    return '♡ ' + ((rows[0] && rows[0].variant) || 'สินค้าอื่น ๆ');
  }

  /* ================= TIER PROMO EDITOR ================= */
  var TIER_KEY = 'hlg_quantity_promo_v1';
  function tierDefaults() {
    return { enabled: false, name: 'โปรตามจำนวนชิ้น', types: ['bag'], start: '', end: '', tiers: { 1: { price: null, gifts: '' }, 2: { price: null, gifts: '' }, 3: { price: null, gifts: '' } }, freeFrom: 0, coverRemote: false };
  }
  function readTier() {
    try {
      var v = JSON.parse(localStorage.getItem(TIER_KEY) || 'null');
      if (!(v && typeof v === 'object' && !Array.isArray(v))) return tierDefaults();
      var out = Object.assign({}, tierDefaults(), v);
      out.enabled = !!v.enabled && ((!!v.productRules && Object.keys(v.productRules).length > 0) || (Array.isArray(v.selectedGroups) && v.selectedGroups.length > 0));
      out.needsProductPrices = !!v.enabled && !v.productRules && !v.selectedGroups;
      out.tiers = Object.assign({}, tierDefaults().tiers, v.tiers || {});
      return out;
    } catch (e) { return tierDefaults(); }
  }
  function selectedIn(v, x) {
    var key = sku(x);
    if ((v.excludedSkus || []).indexOf(key) >= 0) return false;
    return (v.selectedGroups || []).indexOf(groupKey(x)) >= 0 ||
      !!(v.productRules && Object.prototype.hasOwnProperty.call(v.productRules, key));
  }

  var tierDraft = null;

  function renderTiers() {
    var p = $('#tierManagerContainer');
    if (!p) return;
    var v = readTier(), products = catalog(), groups = new Map();
    for (var i = 0; i < products.length; i++) {
      var gk = groupKey(products[i]);
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(products[i]);
    }
    tierDraft = {
      groups: new Set(v.selectedGroups || []),
      excluded: new Set(v.excludedSkus || []),
      rules: Object.assign({}, v.productRules || {}),
      percent: JSON.parse(JSON.stringify(v.groupPercent || {})),
      modes: JSON.parse(JSON.stringify(v.groupModes || {})),
      products: products,
      grouped: groups
    };
    p.innerHTML = `<div class="hlg-config"><h3>โปรตามจำนวน / ของแถม</h3><p><b>แท็บนี้:</b> ตั้งราคาเมื่อซื้อครบ 1/2/3 ชิ้น ของแถม และส่งฟรี หากต้องการให้ลูกค้าเห็นโปร เลือกหมวดที่ร่วมโปรแล้วกด “บันทึกและเปิดโปร” ส่วนป้ายลดราคาชิ้นเดียวอยู่ในแท็บ “ลดราคาชิ้นเดียว”</p>${v.needsProductPrices ? '<p style="color:#a42f62">โปรแบบเก่าพักไว้ก่อน เลือกสินค้าและบันทึกใหม่ค่ะ</p>' : ''}<p>กด “เลือกทั้งหมวด” ได้ทันที หรือเปิดหมวดแล้วค้นหาชื่อเพื่อเลือกเฉพาะบางสินค้า หากเลือกทั้งหมวดแล้ว ก็ยกเว้นบางชิ้นได้โดยเอาติ๊กออก</p><p>ข้อมูลโปรในไฟล์นี้เก็บอยู่บนเบราว์เซอร์เครื่องนี้ หากต้องการให้ลูกค้าทุกเครื่องเห็นโปรเดียวกัน ต้องเชื่อมฐานข้อมูลออนไลน์ก่อนค่ะ</p><label><input id="hltEnabled" type="checkbox" ${v.enabled ? 'checked' : ''}> เปิดใช้โปรนี้</label><div class="hlg-grid"><label>ชื่อโปร<input id="hltName" maxlength="70" value="${esc(v.name)}"></label><label>เริ่ม (เวลาไทย)<input id="hltStart" type="datetime-local" value="${esc(v.start)}"></label><label>สิ้นสุด (เวลาไทย)<input id="hltEnd" type="datetime-local" value="${esc(v.end)}"></label></div><h3>สินค้าในโปร</h3><p>เลือกทั้งหมวดแล้วตั้งส่วนลดเป็น % หรือบาทต่อชิ้น โดยคิดจากราคาของสินค้าแต่ละชิ้น หรือเปิดรายการสินค้าเพื่อตั้งราคาเป็นบาท/ชิ้นเฉพาะตัว</p><div id="hltGroups"></div><h3>ของแถมและส่งฟรี</h3>${[1, 2, 3].map(function(n) { return `<label>ซื้อครบ ${n}${n === 3 ? ' ชิ้นขึ้นไป' : ' ชิ้น'} ได้ของแถมอะไร<input id="hltGift${n}" maxlength="180" value="${esc((v.tiers[n] || {}).gifts || '')}" placeholder="เว้นว่างหากไม่มี"></label>`; }).join('')}<div class="hlg-grid"><label>ส่งฟรีเมื่อซื้อครบ<select id="hltFree"><option value="0" ${!v.freeFrom ? 'selected' : ''}>ไม่ส่งฟรี</option>${[1, 2, 3].map(function(n) { return `<option value="${n}" ${Number(v.freeFrom) === n ? 'selected' : ''}>${n} ชิ้นขึ้นไป</option>`; }).join('')}</select></label><label><input id="hltRemote" type="checkbox" ${v.coverRemote ? 'checked' : ''}> ส่งฟรีรวมพื้นที่ห่างไกลด้วย</label></div><p>ช่องราคาสินค้าที่ระบุเป็นบาทจะใช้แทนส่วนลด % ของหมวดนั้น ราคาจริงจะไม่สูงกว่าราคาปัจจุบันในตะกร้า</p><button id="hltSave">บันทึกและเปิดโปร</button><button id="hltDisable" type="button">ปิดโปร</button><div id="hlgTierNote"></div></div>`;
    var root = $('#hltGroups');
    var bagGifts = document.createElement('div');
    bagGifts.className = 'hlg-tier-card';
    bagGifts.innerHTML = '<h4>🎁 ของแถมแยกตามขนาดกระเป๋า</h4><p>ใส่ข้อความที่ต้องการให้ขึ้นเป็นบล็อกใต้ราคาแต่ละขนาด หากเว้นว่างจะใช้ข้อความของแถมรวมด้านล่าง และจะขึ้นในใบสรุปออเดอร์ด้วย</p>' + Object.entries({ normal: 'Normal', large: 'Large', easy: 'Easy Bag', maxi: 'Maxi' }).map(function(pair) {
      var key = pair[0], name = pair[1];
      return '<h4>' + name + '</h4><div class="hlg-grid">' + [1, 2, 3].map(function(n) {
        return '<label>' + n + (n === 3 ? '+' : '') + ' ใบ<input id="hltSizeGift-' + key + '-' + n + '" maxlength="180" value="' + esc((v.sizeGifts && v.sizeGifts[key] && v.sizeGifts[key][n]) || '') + '" placeholder="เช่น Griptok + พวงกุญแจ"></label>';
      }).join('') + '</div>';
    }).join('');
    root.after(bagGifts);
    groups.forEach(function(rows, key) {
      var box = document.createElement('div');
      box.className = 'hlg-tier-card';
      box.dataset.group = key;
      var label = document.createElement('label');
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'hlt-all';
      check.checked = tierDraft.groups.has(key);
      check.onchange = function() {
        if (check.checked) { tierDraft.groups.add(key); rows.forEach(function(x) { tierDraft.excluded.delete(sku(x)); }); }
        else tierDraft.groups.delete(key);
        updateGroup(key);
      };
      label.append(check, document.createTextNode(' เลือกทั้งหมวด ' + groupLabel(key, rows) + ' (' + rows.length + ' รายการ)'));
      var count = document.createElement('small');
      count.className = 'hlt-count';
      count.style.marginLeft = '8px';
      var percent = document.createElement('div');
      percent.className = 'hlg-grid';
      [1, 2, 3].forEach(function(n) {
        var field = document.createElement('label');
        field.textContent = 'ครบ ' + n + (n === 3 ? ' ชิ้นขึ้นไป' : ' ชิ้น') + ' · ลด';
        var mode = document.createElement('select');
        mode.innerHTML = '<option value="percent">เปอร์เซ็นต์ (%)</option><option value="amount">บาทต่อชิ้น (฿)</option>';
        mode.value = (tierDraft.modes[key] && tierDraft.modes[key][n]) || 'percent';
        var input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '1'; input.placeholder = 'ไม่ลด';
        input.value = (tierDraft.percent[key] && tierDraft.percent[key][n] != null) ? tierDraft.percent[key][n] : '';
        var updateMode = function() {
          tierDraft.modes[key] = tierDraft.modes[key] || {};
          tierDraft.modes[key][n] = mode.value;
          input.max = mode.value === 'percent' ? '100' : '';
          input.title = mode.value === 'percent' ? 'ส่วนลดเปอร์เซ็นต์จากราคาของแต่ละชิ้น' : 'ส่วนลดบาทต่อชิ้นจากราคาของแต่ละชิ้น';
        };
        mode.onchange = updateMode; updateMode();
        input.oninput = function() {
          tierDraft.percent[key] = tierDraft.percent[key] || {};
          tierDraft.percent[key][n] = input.value.trim() === '' ? null : Number(input.value);
        };
        field.append(mode, input);
        percent.append(field);
      });
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = 'ดู / เลือกสินค้าบางตัว';
      toggle.style.margin = '8px 0';
      var listing = document.createElement('div');
      listing.hidden = true;
      var query = '', limit = 80;
      var search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'ค้นหาชื่อสินค้าในหมวดนี้';
      search.oninput = function() { query = search.value.toLowerCase().trim(); limit = 80; renderList(); };
      var body = document.createElement('div');
      var more = document.createElement('button');
      more.type = 'button';
      more.textContent = 'แสดงเพิ่มอีก 80 รายการ';
      more.onclick = function() { limit += 80; renderList(); };
      listing.append(search, body, more);
      toggle.onclick = function() { listing.hidden = !listing.hidden; if (!listing.hidden) renderList(); };
      function renderList() {
        body.replaceChildren();
        var matches = rows.filter(function(x) { return (x.name + ' ' + x.variant).toLowerCase().indexOf(query) >= 0; });
        var visible = matches.slice(0, limit);
        visible.forEach(function(x) {
          var id = sku(x);
          var line = document.createElement('div');
          line.className = 'hlt-product-line';
          line.dataset.sku = id;
          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = selectedIn({ selectedGroups: Array.from(tierDraft.groups), excludedSkus: Array.from(tierDraft.excluded), productRules: tierDraft.rules }, x);
          var name = document.createElement('span');
          name.textContent = x.name + ' ' + (x.variant || '') + ' · ' + Number(x.price).toLocaleString() + ' ฿';
          checkbox.onchange = function() {
            if (tierDraft.groups.has(key)) {
              if (checkbox.checked) tierDraft.excluded.delete(id); else tierDraft.excluded.add(id);
            } else if (checkbox.checked) tierDraft.rules[id] = tierDraft.rules[id] || {};
            else delete tierDraft.rules[id];
            updateGroup(key);
          };
          line.append(checkbox, name);
          [1, 2, 3].forEach(function(n) {
            var input = document.createElement('input');
            input.type = 'number'; input.min = '0'; input.max = String(Number(x.price)); input.step = '1';
            input.placeholder = n + (n === 3 ? '+' : '') + ' ชิ้น';
            input.title = 'ราคาต่อชิ้นเมื่อซื้อครบ ' + n + ' ชิ้น';
            input.value = (tierDraft.rules[id] && tierDraft.rules[id][n] != null) ? tierDraft.rules[id][n] : '';
            input.onchange = function() {
              tierDraft.rules[id] = tierDraft.rules[id] || {};
              tierDraft.rules[id][n] = input.value.trim() === '' ? null : Number(input.value);
              tierDraft.excluded.delete(id);
              checkbox.checked = true;
              updateGroup(key);
            };
            line.append(input);
          });
          body.append(line);
        });
        more.hidden = matches.length <= limit;
        var info = document.createElement('div');
        info.style.fontSize = '12px';
        info.textContent = 'แสดง ' + visible.length + ' จาก ' + matches.length + ' รายการ';
        body.prepend(info);
      }
      function updateGroup(key2) {
        var box2 = Array.from(root.children).find(function(x) { return x.dataset.group === key2; });
        var rows2 = groups.get(key2) || [];
        if (!box2) return;
        var n = rows2.filter(function(x) { return selectedIn({ selectedGroups: Array.from(tierDraft.groups), excludedSkus: Array.from(tierDraft.excluded), productRules: tierDraft.rules }, x); }).length;
        var chk = box2.querySelector('.hlt-all');
        chk.checked = tierDraft.groups.has(key2);
        chk.indeterminate = n > 0 && n < rows2.length;
        box2.querySelector('.hlt-count').textContent = 'เลือก ' + n + '/' + rows2.length;
        if (!box2.lastChild.hidden) box2.querySelectorAll('.hlt-product-line').forEach(function(line) {
          var input = line.querySelector('input[type=checkbox]');
          if (input) {
            var x = rows2.find(function(y) { return sku(y) === line.dataset.sku; });
            if (x) input.checked = selectedIn({ selectedGroups: Array.from(tierDraft.groups), excludedSkus: Array.from(tierDraft.excluded), productRules: tierDraft.rules }, x);
          }
        });
      }
      box.append(label, count, percent, toggle, listing);
      root.append(box);
    });
    Array.from(groups.keys()).forEach(function(key) {
      var box2 = Array.from(root.children).find(function(x) { return x.dataset.group === key; });
      var rows2 = groups.get(key) || [];
      if (!box2) return;
      var n = rows2.filter(function(x) { return selectedIn({ selectedGroups: Array.from(tierDraft.groups), excludedSkus: Array.from(tierDraft.excluded), productRules: tierDraft.rules }, x); }).length;
      var chk = box2.querySelector('.hlt-all');
      chk.checked = tierDraft.groups.has(key);
      chk.indeterminate = n > 0 && n < rows2.length;
      box2.querySelector('.hlt-count').textContent = 'เลือก ' + n + '/' + rows2.length;
    });
    $('#hltSave').onclick = function() { $('#hltEnabled').checked = true; saveTier(); };
    $('#hltDisable').onclick = function() { $('#hltEnabled').checked = false; saveTier(); };
    tierPreview();
  }

  function tierPreview() {
    var note = $('#hlgTierNote');
    if (note) note.textContent = 'หมวดที่เลือกทั้งหมดเก็บเป็นกติกาเดียว จึงใช้ได้แม้มีสินค้าเป็นพันรายการ โดยไม่ต้องติ๊กและบันทึกทีละชิ้น';
  }

  function saveTier() {
    if (!tierDraft) return;
    var start = $('#hltStart').value, end = $('#hltEnd').value;
    if (start && end && start > end) { alert('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'); return; }
    var productRules = {};
    Object.keys(tierDraft.rules).forEach(function(id) {
      var x = tierDraft.products.find(function(pp) { return sku(pp) === id; });
      if (!x) return;
      var r = tierDraft.rules[id];
      var prices = {};
      for (var n = 1; n <= 3; n++) {
        var value = r[n];
        if (value !== null && value !== '' && value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > Number(x.price))) { alert('ตรวจราคา ' + x.name + ' ขั้น ' + n + ' อีกครั้งค่ะ'); return; }
        prices[n] = (value === null || value === '' || value === undefined) ? null : Number(value);
      }
      productRules[id] = prices;
    });
    var groupPercent = {};
    Object.keys(tierDraft.percent).forEach(function(group) {
      groupPercent[group] = {};
      var r = tierDraft.percent[group];
      for (var n = 1; n <= 3; n++) {
        var value = r[n];
        if (value !== null && value !== '' && value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || ((tierDraft.modes[group] || {})[n] !== 'amount' && Number(value) > 100))) { alert('ส่วนลดต้องเป็นจำนวนเต็มไม่ติดลบ และเปอร์เซ็นต์ไม่เกิน 100'); return; }
        groupPercent[group][n] = (value === null || value === '' || value === undefined) ? null : Number(value);
      }
    });
    var selectedGroups = Array.from(tierDraft.groups), excludedSkus = Array.from(tierDraft.excluded);
    if ($('#hltEnabled').checked && !selectedGroups.length && !Object.keys(productRules).length) { alert('เลือกสินค้าหรือหมวดที่ร่วมโปรก่อนค่ะ'); return; }
    var tiers = {};
    for (var n = 1; n <= 3; n++) tiers[n] = { price: null, gifts: $('#hltGift' + n).value.trim() };
    var sizeGifts = {};
    ['normal', 'large', 'easy', 'maxi'].forEach(function(size) {
      sizeGifts[size] = {};
      for (var k = 1; k <= 3; k++) {
        var el = $('#hltSizeGift-' + size + '-' + k);
        sizeGifts[size][k] = (el && el.value.trim()) || '';
      }
    });
    var out = {
      enabled: $('#hltEnabled').checked,
      name: $('#hltName').value.trim() || 'โปรตามจำนวนชิ้น',
      types: [], start: start, end: end, tiers: tiers, sizeGifts: sizeGifts,
      selectedGroups: selectedGroups, excludedSkus: excludedSkus,
      productRules: productRules, groupPercent: groupPercent,
      groupModes: tierDraft.modes, freeFrom: Number($('#hltFree').value), coverRemote: $('#hltRemote').checked
    };
    try {
      localStorage.setItem(TIER_KEY, JSON.stringify(out));
      if (typeof window.renderUnifiedCart === 'function' && $('#page-cart') && $('#page-cart').classList.contains('active')) window.renderUnifiedCart();
      if (typeof window.renderPromoWrap === 'function') window.renderPromoWrap();
      if (typeof window.buildGallery === 'function') window.buildGallery();
      if (typeof window.stickerBuildGallery === 'function') window.stickerBuildGallery();
      if (window.hlgRefreshCollections) window.hlgRefreshCollections();
      if (window.hlgDecorateTierGalleries) window.hlgDecorateTierGalleries();
      adminToast(out.enabled ? 'บันทึกและเปิดโปรแล้ว ✓' : 'ปิดโปรแล้ว ✓');
      renderTiers();
    } catch (e) {
      console.error(e);
      alert('บันทึกไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็มค่ะ');
    }
  }

  /* ================= SINGLE-ITEM PRICE EDITOR ================= */
  var PRICING_KEY = 'hlg_pricing_v1';
  function roundP(n) { return Math.max(0, Math.round(Number(n) || 0)); }
  function priceCatalog() {
    var p = [];
    try { if (typeof ALL_PATTERNS !== 'undefined') ALL_PATTERNS.forEach(function(x) { if (x._hlgCustomId) return; p.push({ type: 'bag', name: x.name, variant: x.size || '', sizeKey: x.sizeKey, original: Number(x.priceOrig) || 0 }); }); } catch (e) {}
    try { if (typeof STICKER_PATTERNS !== 'undefined') STICKER_PATTERNS.forEach(function(x) { if (x._hlgCustomId) return; p.push({ type: 'sticker', name: x.name, variant: '', original: Number(x.price) || 0 }); }); } catch (e) {}
    readCustomProducts().forEach(function(x) {
      if (x.type === 'bag') p.push({ type: 'bag', name: x.name, variant: x.size || '', sizeKey: x.sizeKey, original: Number(x.price) || 0 });
      else p.push({ type: 'sticker', name: x.name, variant: '', original: Number(x.price) || 0 });
    });
    p.push({ type: 'wallpaper', name: 'Wallpaper Special Set', variant: 'Digital Download', original: 99 });
    return p;
  }
  function loadPricing() {
    try { var v = JSON.parse(localStorage.getItem(PRICING_KEY) || '{}'); return { base: v.base || {}, promos: Array.isArray(v.promos) ? v.promos : [] }; }
    catch (e) { return { base: {}, promos: [] }; }
  }
  function savePricing(v) { localStorage.setItem(PRICING_KEY, JSON.stringify(v)); }
  function lookupP(x) { var k = sku(x); return priceCatalog().find(function(p) { return sku(p) === k; }); }
  function baseP(x, v) {
    v = v || loadPricing();
    var p = lookupP(x), key = sku(x), override = v.base[key];
    return (Number.isSafeInteger(override) && override >= 0) ? override : roundP(p ? p.original : (x._basePrice || x.price || 0));
  }
  function activeP(p, now) {
    if (p.enabled === false) return false;
    now = now || Date.now();
    var start = p.start ? Date.parse(p.start + '+07:00') : NaN, end = p.end ? Date.parse(p.end + '+07:00') : NaN;
    return (!p.start || (Number.isFinite(start) && now >= start)) && (!p.end || (Number.isFinite(end) && now <= end));
  }
  function scoreP(p, x) {
    if (p.target === 'all') return 0.5;
    if (p.target === 'selected' && Array.isArray(p.skus) && p.skus.indexOf(sku(x)) >= 0) return 2.5;
    if (p.target === 'type:' + x.type) return 1;
    var l = lookupP(x);
    if (p.target === 'size:' + (l && l.sizeKey)) return 2;
    if (p.target === 'sku:' + sku(x)) return 3;
    return 0;
  }
  function optionsP() {
    var a = [['all', 'สินค้าทุกชิ้น'], ['type:bag', 'กระเป๋าทุกลาย'], ['size:normal', 'กระเป๋า Normal ทุกลาย'], ['size:large', 'กระเป๋า Large ทุกลาย'], ['size:easy', 'กระเป๋า Easy Bag ทุกลาย'], ['size:maxi', 'กระเป๋า Maxi ทุกลาย'], ['type:sticker', 'สติกเกอร์ทั้งหมด'], ['type:wallpaper', 'Wallpaper']];
    priceCatalog().forEach(function(x) { a.push(['sku:' + sku(x), x.name + (x.variant ? ' · ' + x.variant : '')]); });
    return a;
  }
  function fmtP(t) { return t ? t.slice(0, 16) : ''; }
  var editing = -1;

  function pricePreview() {
    var val = document.getElementById('hpValue'), out = document.getElementById('hpPreview');
    if (!val || !out) return;
    var amount = Number(val.value);
    var mode = (document.getElementById('hpMode') || {}).value;
    var target = (document.getElementById('hpTarget') || {}).value;
    var skus = Array.prototype.slice.call(document.querySelectorAll('#hpSkuRows input:checked')).map(function(e) { return e.value; });
    var example = priceCatalog().find(function(x) { return scoreP({ target: target, skus: skus }, x) > 0; });
    if (!val.value || !example) { out.textContent = 'เลือกสินค้าและใส่ตัวเลขเพื่อดูตัวอย่าง'; return; }
    var p = baseP(example);
    var n = mode === 'fixed' ? amount : mode === 'percent' ? p * (1 - amount / 100) : p - amount;
    out.textContent = 'ตัวอย่าง ' + example.name + ': ' + p + ' ฿ → ' + roundP(n) + ' ฿ / ชิ้น';
  }

  function validDateP(v) { return !v || /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) && Number.isFinite(Date.parse(v + '+07:00')); }

  function savePromoP() {
    var root = document.getElementById('pricingManagerContainer');
    var target = root.querySelector('#hpTarget').value, mode = root.querySelector('#hpMode').value;
    var raw = root.querySelector('#hpValue').value.trim(), value = Number(raw);
    var start = root.querySelector('#hpStart').value, end = root.querySelector('#hpEnd').value;
    if (!raw || !Number.isSafeInteger(value) || value < 0 || (mode === 'percent' && value > 100)) { adminToast('กรุณาใส่ราคา/ส่วนลดเป็นจำนวนเต็มที่ถูกต้อง'); return; }
    if (!validDateP(start) || !validDateP(end) || (start && end && start > end)) { adminToast('ตรวจช่วงวันเริ่มและวันสิ้นสุดโปรอีกครั้งค่ะ'); return; }
    var skus = target === 'selected' ? Array.prototype.slice.call(root.querySelectorAll('#hpSkuRows input:checked')).map(function(x) { return x.value; }) : [];
    if (target === 'selected' && !skus.length) { adminToast('เลือกสินค้าอย่างน้อย 1 ชิ้นค่ะ'); return; }
    var p = { skus: skus, id: editing >= 0 ? (loadPricing().promos[editing] || {}).id : 'promo_' + Date.now(), target: target, mode: mode, value: value, start: start, end: end, label: root.querySelector('#hpLabel').value.trim() || 'กำลังลดราคา ♡', enabled: true, updated: Date.now() };
    var v = loadPricing();
    if (editing >= 0 && v.promos[editing]) v.promos[editing] = p; else v.promos.push(p);
    editing = -1;
    savePricing(v);
    renderPricing();
    adminToast('บันทึกโปรโมชันแล้ว ✓');
  }

  function renderBaseP() {
    var root = document.getElementById('hpBaseRows');
    if (!root) return;
    var q = ((document.getElementById('hpSearch') || {}).value || '').toLowerCase(), v = loadPricing();
    root.innerHTML = priceCatalog().filter(function(x) { return (x.name + ' ' + x.variant).toLowerCase().indexOf(q) >= 0; }).map(function(x) {
      var k = sku(x);
      return `<div class="hp-row" data-key="${esc(k)}"><div><b>${esc(x.name)}</b><small>${esc(x.variant)} · ราคาเดิม ${x.original} ฿</small></div><input type="number" min="0" step="1" inputmode="numeric" aria-label="ราคาปกติ ${esc(x.name)}" value="${v.base[k] != null ? v.base[k] : x.original}"><button type="button">บันทึกราคา</button></div>`;
    }).join('');
    root.querySelectorAll('.hp-row button').forEach(function(b) {
      b.onclick = function() {
        var row = b.closest('.hp-row'), raw = row.querySelector('input').value.trim(), n = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) { adminToast('กรุณาใส่ราคาตั้งแต่ 0 บาทขึ้นไป'); return; }
        var v = loadPricing();
        v.base[row.dataset.key] = n;
        savePricing(v);
        renderBaseP();
        adminToast('บันทึกราคาปกติแล้ว ✓');
      };
    });
  }

  function renderPricing() {
    var root = document.getElementById('pricingManagerContainer');
    if (!root) return;
    var v = loadPricing(), opts = optionsP();
    root.innerHTML = `<div class="hp-intro"><h3>ลดราคาชิ้นเดียว ♡</h3><p><b>แท็บนี้:</b> ลดราคาแต่ละสินค้า เช่น จาก 399 เหลือ 299 บาท พร้อมป้ายลดราคา ส่วนแท็บ “โปรตามจำนวน / ของแถม” ใช้ตั้งราคาเมื่อซื้อครบ 1/2/3 ชิ้น ของแถม และส่งฟรี ทั้งสองแบบเปิดพร้อมกันได้ โดยโปรจำนวนจะคิดจากราคาที่ลูกค้าเห็นในตะกร้า</p><p>ตั้งราคาปกติด้านล่าง แล้วสร้างโปรโดยเลือกว่าใช้กับสินค้าชิ้นเดียว กระเป๋าไซส์หนึ่ง หรือสินค้าทั้งหมวด เลือก “ลดเหลือราคา” ได้ทันที เช่น Normal จาก 399 เหลือ 299 บาท ตั้งวันเริ่มและวันสิ้นสุดตามเวลาไทยได้ หากไม่ใส่วันจะเริ่มทันทีหรือใช้จนกว่าจะปิดโปร</p><p>ขณะนี้ข้อมูลโปรเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น ต้องเชื่อมฐานข้อมูลออนไลน์ก่อน ลูกค้าคนละเครื่องจึงจะเห็นโปรเดียวกัน</p></div>
 <div class="hp-section"><h3>＋ สร้างโปร</h3><div class="hp-grid">
 <label>ใช้กับสินค้า<select id="hpTarget">${opts.map(function(o) { return `<option value="${esc(o[0])}">${esc(o[1])}</option>`; }).join('')}<option value="selected">เฉพาะสินค้าที่เลือก...</option></select></label>
 <div class="hp-selected" id="hpSelected" hidden><b>เลือกสินค้าที่ร่วมโปร</b><div id="hpSkuRows"></div></div><label>วิธีลด<select id="hpMode"><option value="fixed">ลดเหลือราคา (บาท/ชิ้น)</option><option value="amount">ลดจำนวนเงิน (บาท/ชิ้น)</option><option value="percent">ลดเปอร์เซ็นต์ (%)</option></select></label>
 <label>ตัวเลขราคา / ส่วนลด<input id="hpValue" type="number" min="0" step="1" inputmode="numeric" placeholder="เช่น 299"></label>
 <label>ข้อความป้ายโปร<input id="hpLabel" type="text" maxlength="60" placeholder="เช่น กระเป๋ากำลังลด ♡"></label>
 <label>เริ่ม (เวลาไทย; เว้นว่าง = เริ่มทันที)<input id="hpStart" type="datetime-local"></label>
 <label>สิ้นสุด (เวลาไทย; เว้นว่าง = ปิดเอง)<input id="hpEnd" type="datetime-local"></label></div>
 <div class="hp-preview" id="hpPreview"></div><button type="button" class="hp-save" id="hpSave">บันทึกโปรโมชัน</button></div>
 <div class="hp-section"><h3>โปรที่สร้างไว้</h3><div id="hpPromoList">${v.promos.length ? v.promos.map(function(p, i) {
      var label = opts.find(function(x) { return x[0] === p.target; });
      var targetName = p.target === 'selected' ? 'สินค้าที่เลือก ' + (p.skus || []).length + ' ชิ้น' : (label ? label[1] : 'สินค้า');
      return `<div class="hp-promo"><b>${esc(targetName || 'สินค้า')} · ${esc(p.label || 'โปรโมชัน')}</b><small>${p.mode === 'fixed' ? 'เหลือ ' + p.value + ' ฿' : p.mode === 'percent' ? 'ลด ' + p.value + '%' : 'ลด ' + p.value + ' ฿'} / ชิ้น · ${p.start ? esc(p.start.replace('T', ' ')) : 'เริ่มทันที'} – ${p.end ? esc(p.end.replace('T', ' ')) : 'ไม่กำหนดวันจบ'} · ${p.enabled === false ? 'ปิดอยู่' : activeP(p) ? 'กำลังแสดง' : 'รอเวลา / หมดเวลา'}</small><div class="hp-actions"><button type="button" data-action="toggle" data-i="${i}">${p.enabled === false ? 'เปิดโปร' : 'ปิดโปร'}</button><button type="button" data-action="edit" data-i="${i}">แก้ไข</button><button type="button" data-action="delete" data-i="${i}">ลบ</button></div></div>`;
    }).join('') : 'ยังไม่มีโปรโมชันค่ะ'}</div></div>
 <div class="hp-section"><h3>ราคาปกติของสินค้า</h3><p>ค้นหาแล้วใส่ราคาปกติใหม่ต่อชิ้น กดบันทึก ระบบจะใช้ราคานี้เมื่อไม่มีโปร</p><input id="hpSearch" type="search" placeholder="ค้นหาสินค้าหรือลาย..."><div id="hpBaseRows"></div></div>`;
    root.querySelector('#hpSkuRows').innerHTML = priceCatalog().map(function(x) { return `<label class="hp-sku"><input type="checkbox" value="${esc(sku(x))}"><span>${esc(x.name)} ${esc(x.variant)}</span></label>`; }).join('');
    root.querySelector('#hpTarget').addEventListener('change', function() { root.querySelector('#hpSelected').hidden = root.querySelector('#hpTarget').value !== 'selected'; });
    ['hpTarget', 'hpMode', 'hpValue', 'hpStart', 'hpEnd'].forEach(function(id) { root.querySelector('#' + id).addEventListener('input', pricePreview); });
    root.querySelector('#hpSave').onclick = savePromoP;
    root.querySelector('#hpSearch').addEventListener('input', renderBaseP);
    root.querySelectorAll('[data-action]').forEach(function(b) {
      b.onclick = function() {
        var i = Number(b.dataset.i), vv = loadPricing(), p = vv.promos[i];
        if (!p) return;
        if (b.dataset.action === 'delete') { if (!confirm('ลบโปรโมชันนี้ใช่ไหมคะ?')) return; vv.promos.splice(i, 1); }
        if (b.dataset.action === 'toggle') p.enabled = p.enabled === false;
        if (b.dataset.action === 'edit') {
          editing = i;
          root.querySelector('#hpTarget').value = p.target;
          root.querySelector('#hpSelected').hidden = p.target !== 'selected';
          root.querySelectorAll('#hpSkuRows input').forEach(function(e) { e.checked = (p.skus || []).indexOf(e.value) >= 0; });
          root.querySelector('#hpMode').value = p.mode;
          root.querySelector('#hpValue').value = p.value;
          root.querySelector('#hpLabel').value = p.label || '';
          root.querySelector('#hpStart').value = fmtP(p.start);
          root.querySelector('#hpEnd').value = fmtP(p.end);
          root.querySelector('#hpSave').textContent = 'บันทึกการแก้ไขโปร';
          pricePreview();
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        savePricing(vv);
        renderPricing();
      };
    });
    renderBaseP();
    pricePreview();
  }

  /* ================= FONT EDITOR ================= */
  var FONT_KEY = 'hlg_font_settings_v1', FONT_DB = 'hlg_custom_font_v1';
  function fontSettings() {
    try { var x = JSON.parse(localStorage.getItem(FONT_KEY) || '{}'); return (x && typeof x === 'object') ? x : {}; }
    catch (e) { return {}; }
  }
  function fontDB() {
    return new Promise(function(resolve, reject) {
      var q = indexedDB.open(FONT_DB, 1);
      q.onupgradeneeded = function() { if (!q.result.objectStoreNames.contains('font')) q.result.createObjectStore('font'); };
      q.onsuccess = function() { resolve(q.result); };
      q.onerror = function() { reject(q.error); };
    });
  }
  async function fontBlob(blob) {
    var db = await fontDB();
    try {
      return await new Promise(function(resolve, reject) {
        var st = db.transaction('font', blob === undefined ? 'readonly' : 'readwrite').objectStore('font');
        var q = blob === undefined ? st.get('current') : st.put(blob, 'current');
        q.onsuccess = function() { resolve(q.result); };
        q.onerror = function() { reject(q.error); };
      });
    } finally { db.close(); }
  }
  var fontUrl = '';
  async function applyFont() {
    var v = fontSettings();
    var family = ['Opun', 'Tahoma', 'Arial', 'system'].indexOf(v.family) >= 0 ? v.family : 'Opun';
    var face = '';
    if (family === 'Opun') face = "'Opun',Tahoma,sans-serif";
    else if (family === 'system') face = 'system-ui,sans-serif';
    else face = family + ',sans-serif';
    if (fontUrl) { URL.revokeObjectURL(fontUrl); fontUrl = ''; }
    if (v.family === 'custom') {
      try {
        var blob = await fontBlob();
        if (blob) {
          fontUrl = URL.createObjectURL(blob);
          var style = $('#hlgCustomFontFace');
          if (!style) { style = document.createElement('style'); style.id = 'hlgCustomFontFace'; document.head.append(style); }
          style.textContent = "@font-face{font-family:'HLG Custom';src:url('" + fontUrl + "')}";
          face = "'HLG Custom',Tahoma,sans-serif";
        }
      } catch (e) { console.warn('Custom font unavailable', e); }
    }
    document.documentElement.style.setProperty('--hlg-shop-font', face);
    document.documentElement.style.setProperty('--hlg-font', face);
    document.documentElement.style.setProperty('--hlg-shop-body-weight', String([300, 400, 500].indexOf(Number(v.body)) >= 0 ? v.body : 400));
    document.documentElement.style.setProperty('--hlg-shop-head-weight', String([400, 500, 600, 700].indexOf(Number(v.head)) >= 0 ? v.head : 500));
  }

  function renderFonts() {
    var p = $('#fontManagerContainer');
    if (!p) return;
    var v = fontSettings();
    p.innerHTML = `<div class="hlg-config"><h3>ฟอนต์ทั้งเว็บไซต์</h3><p>เปลี่ยนชนิดฟอนต์และน้ำหนักข้อความทั่วไปกับข้อความเน้นได้ ลองดูตัวอย่างก่อนบันทึก</p><div class="hlg-grid"><label>ฟอนต์<select id="hlfFamily"><option value="Opun">Opun</option><option value="Tahoma">Tahoma</option><option value="Arial">Arial</option><option value="system">ฟอนต์ระบบ</option><option value="custom">อัปโหลดฟอนต์เอง</option></select></label><label>อัปโหลด .ttf, .otf หรือ .woff2 (สูงสุด 5 MB)<input id="hlfFile" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff2"></label><label>ข้อความทั่วไป<select id="hlfBody"><option value="300">บาง</option><option value="400">ปกติ</option><option value="500">กลาง</option></select></label><label>หัวข้อและปุ่ม<select id="hlfHead"><option value="400">ปกติ</option><option value="500">กลาง</option><option value="600">หนาเล็กน้อย</option><option value="700">หนา</option></select></label></div><div class="hlg-font-preview" id="hlfPreview">ตัวอย่างข้อความ: สินค้าน่ารักจาก helloxglitter ♡<br><strong>หัวข้อสำคัญ · โปรโมชันพิเศษ</strong></div><button id="hlfSave">บันทึกฟอนต์</button><p>ฟอนต์ที่อัปโหลดเก็บในเบราว์เซอร์เครื่องนี้ หากต้องการให้ลูกค้าทุกเครื่องเห็นเหมือนกันต้องนำไฟล์ฟอนต์ขึ้นพื้นที่โฮสต์เว็บ</p></div>`;
    $('#hlfFamily').value = v.family || 'Opun';
    $('#hlfBody').value = String(v.body || 400);
    $('#hlfHead').value = String(v.head || 500);
    function sample() {
      var f = $('#hlfFamily').value;
      $('#hlfPreview').style.fontFamily = f === 'custom' ? "'HLG Custom',sans-serif" : f === 'system' ? 'system-ui,sans-serif' : f + ',sans-serif';
      $('#hlfPreview').style.fontWeight = $('#hlfBody').value;
      $('#hlfPreview').querySelector('strong').style.fontWeight = $('#hlfHead').value;
    }
    ['hlfFamily', 'hlfBody', 'hlfHead'].forEach(function(id) { $('#' + id).onchange = sample; });
    $('#hlfSave').onclick = async function() {
      var file = $('#hlfFile').files[0];
      if (file && (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 5 * 1024 * 1024)) { alert('ใช้ไฟล์ฟอนต์ .ttf, .otf, .woff หรือ .woff2 ไม่เกิน 5 MB'); return; }
      var setting = { family: $('#hlfFamily').value, body: Number($('#hlfBody').value), head: Number($('#hlfHead').value) };
      try {
        if (file) { await fontBlob(file); setting.family = 'custom'; }
        else if (setting.family === 'custom' && !(await fontBlob())) { alert('กรุณาอัปโหลดไฟล์ฟอนต์ก่อนค่ะ'); return; }
        localStorage.setItem(FONT_KEY, JSON.stringify(setting));
        await applyFont();
        adminToast('บันทึกฟอนต์แล้ว ✓');
        renderFonts();
      } catch (e) {
        console.error(e);
        alert('บันทึกฟอนต์ไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม');
      }
    };
    sample();
  }

  /* ================= COUPON CAMPAIGN EDITOR ================= */
  var COUPON_KEY = 'hlg_coupon_campaign_draft_v1';
  var COUPON_DEFAULTS = {
    title: 'ซื้อ Sticker รับคูปองกระเป๋า',
    thresholdSatang: 30090,
    discountSatang: 10000,
    expiresAt: '2026-12-31T23:59',
    earnCategory: 'sticker',
    redeemCategory: 'bag',
    maxUses: 1
  };
  function couponBaht(n) {
    return (Number(n || 0) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function couponSatang(raw) {
    var v = String(raw || '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(v)) return null;
    var parts = v.split('.');
    var decimal = parts[1] || '';
    var amount = Number(parts[0]) * 100 + Number(decimal.padEnd(2, '0'));
    return Number.isSafeInteger(amount) ? amount : null;
  }
  function couponWarn(msg) { try { showToast('warn', msg); } catch (e) {} }

  async function fetchCouponCampaign() {
    try {
      var res = await fetch('/api/coupons/campaign', { credentials: 'include' });
      if (res.ok) {
        var data = await res.json();
        if (data.campaign) {
          localStorage.setItem(COUPON_KEY, JSON.stringify(data.campaign));
          return data.campaign;
        }
      }
    } catch (e) {}
    try {
      var local = JSON.parse(localStorage.getItem(COUPON_KEY) || 'null');
      if (local && typeof local === 'object') return Object.assign({}, COUPON_DEFAULTS, local);
    } catch (e) {}
    return Object.assign({}, COUPON_DEFAULTS);
  }

  function renderCoupons() {
    var panel = $('#couponManagerContainer');
    if (!panel) return;
    panel.innerHTML = '<p style="color:#807078">กำลังโหลดกติกาคูปอง…</p>';
    fetchCouponCampaign().then(function(v) {
      paintCoupons(panel, v);
    }).catch(function() {
      paintCoupons(panel, Object.assign({}, COUPON_DEFAULTS));
    });
  }

  function paintCoupons(panel, v) {
    panel.innerHTML = `<div class="hlg-coupon-admin">
    <h3>🎟️ ตั้งกติกาแคมเปญคูปอง (เชื่อมฐานข้อมูลกลาง)</h3>
    <p>เงื่อนไขระบบ: ลูกค้าซื้อสินค้าหมวด Sticker ครบยอดที่กำหนด เมื่อร้านยืนยันการชำระเงินแล้ว ระบบจะออกคูปองส่วนลดสำหรับสั่งซื้อกระเป๋า 1 ใบต่อออเดอร์ ผูกกับบัญชี LINE ของลูกค้าโดยอัตโนมัติ</p>
    <div class="hlg-coupon-grid">
      <label>ชื่อโปรโมชัน<input id="hcTitle" maxlength="90"></label>
      <label>ซื้อ Sticker ครบยอด (บาท หลังหักส่วนลด ก่อนค่าส่ง)<input id="hcThreshold" type="text" inputmode="decimal" placeholder="300.90"></label>
      <label>มูลค่าคูปองส่วนลด (บาท)<input id="hcDiscount" type="text" inputmode="decimal" placeholder="100.00"></label>
      <label>วันและเวลาหมดอายุ (เวลาไทย)<input id="hcExpiry" type="datetime-local"></label>
      <label>ใช้กับหมวดหมู่สินค้า<select id="hcCategory"><option value="bag">กระเป๋า (Bag)</option><option value="sticker">สติกเกอร์ (Sticker)</option><option value="wallpaper">วอลเปเปอร์ (Wallpaper)</option><option value="all">ใช้ได้กับสินค้าทุกหมวดหมู่ (All)</option></select></label>
      <label>จำนวนครั้งที่ใช้ได้ต่อคูปอง<select id="hcUses"><option value="1">ใช้ได้ครั้งเดียว (Single-use)</option></select></label>
    </div>
    <div id="hcPreview" class="hlg-coupon-preview"></div>
    <div id="hcStatusBanner" class="hlg-coupon-status" style="background:#eaf8ef;color:#187342;border:1px solid #bce6cc">
      ✅ เชื่อมต่อระบบแจกคูปองออนไลน์แล้ว · ฐานข้อมูลกลางพร้อมทำงาน
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
      <button id="hcSave" type="button" style="background:#bd4d7c;color:#fff">💾 บันทึกกติกาลงระบบ</button>
      <span id="hcSaveMsg" style="font-size:12px;color:#a84371"></span>
    </div>
  </div>`;

    $('#hcTitle').value = v.title || COUPON_DEFAULTS.title;
    $('#hcThreshold').value = couponBaht(v.thresholdSatang || v.threshold_satang);
    $('#hcDiscount').value = couponBaht(v.discountSatang || v.discount_satang);
    $('#hcExpiry').value = (v.expiresAt || v.expires_at || COUPON_DEFAULTS.expiresAt).slice(0, 16);
    $('#hcCategory').value = v.redeemCategory || v.redeem_category || 'bag';

    var update = function() {
      var threshold = couponSatang($('#hcThreshold').value), discount = couponSatang($('#hcDiscount').value);
      var title = $('#hcTitle').value.trim() || COUPON_DEFAULTS.title;
      var catNames = {'bag':'กระเป๋า','sticker':'สติกเกอร์','wallpaper':'วอลเปเปอร์','all':'ทุกหมวดหมู่'};
      var catName = catNames[$('#hcCategory').value] || $('#hcCategory').value;
      $('#hcPreview').textContent = threshold === null || discount === null
        ? 'กรอกจำนวนเงินเป็นบาท ทศนิยมได้ไม่เกิน 2 ตำแหน่ง'
        : `${title} ♡ ซื้อ Sticker ครบ ${couponBaht(threshold)} ฿ รับส่วนลด ${couponBaht(discount)} ฿ ใช้กับ${catName} 1 ครั้ง หมดอายุ ${$('#hcExpiry').value.replace('T', ' ')} น. (เวลาไทย)`;
    };
    ['hcTitle', 'hcThreshold', 'hcDiscount', 'hcExpiry', 'hcCategory'].forEach(function(id) { var el = $('#' + id); if (el) el.addEventListener('input', update); });
    update();

    $('#hcSave').onclick = async function() {
      var thresholdSatang = couponSatang($('#hcThreshold').value);
      var discountSatang = couponSatang($('#hcDiscount').value);
      var expiresAt = $('#hcExpiry').value;
      if (thresholdSatang === null || thresholdSatang < 1 || discountSatang === null || discountSatang < 1) { couponWarn('ตรวจยอดซื้อและมูลค่าส่วนลดอีกครั้งค่ะ'); return; }
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt + '+07:00'))) { couponWarn('กรุณาเลือกวันหมดอายุที่ถูกต้อง'); return; }
      var payload = {
        title: $('#hcTitle').value.trim().slice(0, 90) || COUPON_DEFAULTS.title,
        thresholdSatang: thresholdSatang,
        discountSatang: discountSatang,
        expiresAt: expiresAt,
        earnCategory: 'sticker',
        redeemCategory: $('#hcCategory').value,
        maxUses: 1
      };
      var saveBtn = $('#hcSave'), saveMsg = $('#hcSaveMsg');
      saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก…';
      try {
        var res = await fetch('/api/coupons/campaign', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign: payload })
        });
        var data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
        localStorage.setItem(COUPON_KEY, JSON.stringify(data.campaign || payload));
        saveMsg.textContent = '✓ บันทึกกติกาลงฐานข้อมูลกลางสำเร็จแล้ว';
        adminToast('บันทึกกติกาคูปองออนไลน์แล้ว ✓');
        setTimeout(function() { if (saveMsg) saveMsg.textContent = ''; }, 4000);
      } catch (err) {
        localStorage.setItem(COUPON_KEY, JSON.stringify(payload));
        saveMsg.textContent = '(บันทึกในเบราว์เซอร์: ' + err.message + ')';
        adminToast('บันทึกกติกาในเครื่องแล้ว ♡');
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = '💾 บันทึกกติกาลงระบบ';
      }
    };
  }

  /* ================= STOCK EDITOR ================= */
  // Inventory lives in localStorage, shared with the storefront on the same origin.
  // The key encoding and the order source below MUST match the storefront stock guard
  // in public/index.html exactly — otherwise the editor writes rows the guard never finds.
  var STOCK_KEY = 'hlg_inventory_v1';
  var STOCK_ORDERS_DB = 'HLG_ORDERS_DB_V1';
  var STOCK_ORDERS_LS = 'hlg_orders_v2';
  var stockOrderCache = null;
  function stockKey(x) {
    // Same shape as the storefront: JSON array [type, name, variant].
    return JSON.stringify([String(x.type || 'bag'), String(x.name || ''), String(x.variant || '')]);
  }
  function stockLoad() {
    try { var x = JSON.parse(localStorage.getItem(STOCK_KEY) || '{}'); return (x && typeof x === 'object') ? x : {}; }
    catch (e) { return {}; }
  }
  function stockLocalOrders() {
    if (stockOrderCache) return stockOrderCache;
    try { var a = JSON.parse(localStorage.getItem(STOCK_ORDERS_LS) || '[]'); if (Array.isArray(a)) { stockOrderCache = a; return a; } }
    catch (e) {}
    return [];
  }
  // The storefront keeps orders in IndexedDB (HLG_ORDERS_DB_V1 / state / 'orders').
  // Never create that database here: opening a missing DB with a version would make
  // the storefront's own open() skip its upgrade step and break its store.
  function stockReadOrders(force) {
    return new Promise(function(resolve) {
      if (force) stockOrderCache = null;
      var fallback = function() { resolve(stockLocalOrders()); };
      if (stockOrderCache || !indexedDB.databases) { fallback(); return; }
      indexedDB.databases().then(function(list) {
        if (!list || !list.some(function(d) { return d && d.name === STOCK_ORDERS_DB; })) { fallback(); return; }
        var req = indexedDB.open(STOCK_ORDERS_DB);
        req.onsuccess = function() {
          var db = req.result;
          try {
            var get = db.transaction('state', 'readonly').objectStore('state').get('orders');
            get.onsuccess = function() { db.close(); stockOrderCache = Array.isArray(get.result) ? get.result : stockLocalOrders(); resolve(stockOrderCache); };
            get.onerror = function() { db.close(); fallback(); };
          } catch (e) { db.close(); fallback(); }
        };
        req.onerror = fallback;
        req.onblocked = fallback;
      }).catch(fallback);
    });
  }
  function stockUsed(k, row) {
    var baseline = new Set(row.baseline || []);
    return stockLocalOrders().filter(function(o) { return !baseline.has(String(o.id)); }).reduce(function(n, o) {
      return n + (o.items || []).reduce(function(a, x) { return a + (stockKey(x) === k ? Math.max(0, Number(x.qty) || 0) : 0); }, 0);
    }, 0);
  }
  function stockRemaining(x) {
    var row = stockLoad()[stockKey(x)];
    return (row && row.managed) ? Math.max(0, Number(row.qty || 0) - stockUsed(stockKey(x), row)) : null;
  }
  function stockCatalog() {
    var m = new Map();
    catalog().forEach(function(x) { m.set(stockKey(x), { type: x.type, name: x.name, variant: x.variant || '' }); });
    Object.keys(stockLoad()).forEach(function(k) {
      try { var a = JSON.parse(k); if (Array.isArray(a) && a.length === 3) m.set(stockKey({ type: a[0], name: a[1], variant: a[2] }), { type: a[0], name: a[1], variant: a[2] }); } catch (e) {}
    });
    stockLocalOrders().forEach(function(o) {
      (o.items || []).forEach(function(x) { if (x.name) m.set(stockKey(x), { type: x.type || 'bag', name: x.name, variant: x.variant || '' }); });
    });
    return Array.from(m.values());
  }
  function stockPaint() {
    var root = $('#hlgStockList');
    if (!root) return;
    var q = (($('#hlgStockSearch') || {}).value || '').toLowerCase();
    var cfg = stockLoad();
    var xs = stockCatalog().filter(function(x) { return (x.name + ' ' + x.variant).toLowerCase().indexOf(q) >= 0; });
    root.innerHTML = xs.map(function(x) {
      var k = stockKey(x), r = cfg[k] || {}, left = stockRemaining(x);
      var label = r.managed ? (left === 0 ? 'หมด' : left <= 5 ? 'ใกล้หมด' : 'พร้อมขาย') : 'ไม่จำกัด';
      return '<div class="hlg-stock-card" data-stock-key="' + esc(k) + '"><div><b>' + esc(x.name) + '</b><small>' + esc(x.variant || x.type) + '</small></div>'
        + '<label><input type="checkbox" class="hlg-stock-manage" ' + (r.managed ? 'checked' : '') + '> จำกัดจำนวน</label>'
        + '<div><input class="hlg-stock-input" type="number" min="0" step="1" inputmode="numeric" value="' + (r.managed ? esc(left) : '') + '" placeholder="จำนวน" aria-label="จำนวน ' + esc(x.name) + '">'
        + '<div class="hlg-stock-qty ' + (left === null ? 'hlg-stock-off' : left <= 5 ? 'hlg-stock-low' : '') + '">' + label + (left === null ? '' : ' · ' + left + ' ชิ้น') + '</div></div>'
        + '<button type="button" class="hlg-stock-save">บันทึก</button></div>';
    }).join('') || '<div class="hlg-stock-intro">ไม่พบสินค้าค่ะ</div>';
    root.querySelectorAll('.hlg-stock-save').forEach(function(b) {
      b.onclick = function() {
        var card = b.closest('[data-stock-key]'), k = card.dataset.stockKey;
        var managed = card.querySelector('.hlg-stock-manage').checked;
        var input = card.querySelector('.hlg-stock-input'), val = input.value.trim();
        if (managed && (!/^\d+$/.test(val) || !Number.isSafeInteger(Number(val)))) { input.focus(); adminToast('กรุณาใส่จำนวนเต็มตั้งแต่ 0 ขึ้นไป'); return; }
        var next = stockLoad();
        next[k] = { managed: managed, qty: managed ? Number(val) : 0, baseline: stockLocalOrders().map(function(o) { return String(o.id); }) };
        try { localStorage.setItem(STOCK_KEY, JSON.stringify(next)); stockPaint(); adminToast('บันทึกสต็อกแล้ว ✓'); }
        catch (e) { adminToast('บันทึกสต็อกไม่สำเร็จ'); }
      };
    });
  }
  function renderStock(force) {
    var root = $('#stockManagerContainer');
    if (!root) return;
    if (!$('#hlgStockList')) {
      root.innerHTML = '<div class="hlg-stock-intro"><b>สต็อกสินค้า ♡</b><br>เปิดดูแลสต็อกเฉพาะสินค้าที่พร้อมส่งได้ แยกตามลายและขนาด ส่วนสินค้าพรีออเดอร์หรือดิจิทัลปล่อยเป็น “ไม่จำกัด” ได้<br>ช่องจำนวนคือจำนวนที่มีพร้อมขาย ณ ตอนที่กดบันทึก ออเดอร์ใหม่จะหักออก และเมื่อลบออเดอร์นั้น จำนวนจะคืนให้อัตโนมัติ</div>'
        + '<div class="hlg-stock-toolbar"><input id="hlgStockSearch" type="search" placeholder="ค้นหาชื่อสินค้า / ขนาด" aria-label="ค้นหาสต็อก"><button type="button" id="hlgStockRefresh">รีเฟรช</button></div>'
        + '<div id="hlgStockList"></div>';
      $('#hlgStockSearch').addEventListener('input', stockPaint);
      $('#hlgStockRefresh').addEventListener('click', function() { renderStock(true); });
    }
    stockReadOrders(!!force).then(function() { stockPaint(); });
  }

  /* ================= RECEIPT / THANK-YOU EDITOR ================= */
  var RECEIPT_KEY = 'hlg_receipt_design_v1', RECEIPT_DB = 'HLG_RECEIPT_ASSETS_V1';
  function receiptSettings() {
    try { var v = JSON.parse(localStorage.getItem(RECEIPT_KEY) || 'null'); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function receiptDb() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(RECEIPT_DB, 1);
      req.onupgradeneeded = function() { if (!req.result.objectStoreNames.contains('assets')) req.result.createObjectStore('assets'); };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }
  async function receiptStoreGif(file) {
    var db = await receiptDb();
    try {
      await new Promise(function(resolve, reject) {
        var tx = db.transaction('assets', 'readwrite');
        tx.objectStore('assets').put(file, 'thankyou');
        tx.oncomplete = resolve;
        tx.onerror = function() { reject(tx.error); };
      });
    } finally { db.close(); }
  }
  async function receiptGifSource() {
    var value = receiptSettings().gif;
    if (value !== 'db:thankyou') return /^(data:image\/gif;base64,|https:\/\/)/i.test(value) ? value : '';
    try {
      var db = await receiptDb();
      var blob = await new Promise(function(resolve, reject) {
        var req = db.transaction('assets', 'readonly').objectStore('assets').get('thankyou');
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
      db.close();
      if (!blob) return '';
      return await new Promise(function(resolve, reject) {
        var r = new FileReader();
        r.onload = function() { resolve(r.result); };
        r.onerror = function() { reject(r.error); };
        r.readAsDataURL(blob);
      });
    } catch (e) { return ''; }
  }
  function renderReceipt() {
    var p = $('#receiptManagerContainer');
    if (!p) return;
    var v = receiptSettings();
    p.innerHTML = `<div class="hrx-admin"><h3>ตกแต่งหน้าหลังสั่งซื้อ</h3><label>หัวข้อ<input id="hrxTitle" maxlength="80" value="${esc(v.title || '')}"></label><label>คำขอบคุณ<textarea id="hrxThanks" maxlength="350">${esc(v.thanks || '')}</textarea></label><label>ลิงก์ GIF (https://)<input id="hrxGifUrl" type="url" placeholder="https://example.com/thank-you.gif" value="${esc(/^https:\/\//.test(v.gif || '') ? v.gif : '')}"></label><label>หรืออัปโหลด GIF ไม่เกิน 8 MB<input id="hrxGifFile" type="file" accept="image/gif"></label><img id="hrxGifPreview" class="hrx-gif-preview" alt="ตัวอย่าง GIF" hidden><div id="hrxGifStatus" class="hrx-mini">${v.gif ? 'กำลังโหลดตัวอย่าง GIF…' : 'ยังไม่ได้ใส่ GIF'}</div><button class="primary" id="hrxSaveDesign" type="button">บันทึกหน้าขอบคุณ</button><button id="hrxRemoveGif" type="button">ลบ GIF</button><p class="hrx-mini">GIF จะแสดงบนหน้าขอบคุณและในใบสรุปคำสั่งซื้อที่ดาวน์โหลดจากเบราว์เซอร์นี้</p></div>`;
    if (v.gif) receiptGifSource().then(function(src) {
      if (!p.isConnected) return;
      var im = p.querySelector('#hrxGifPreview'), status = p.querySelector('#hrxGifStatus');
      if (src) { im.src = src; im.hidden = false; status.textContent = 'ตัวอย่าง GIF ที่ใช้อยู่'; }
      else status.textContent = 'ไม่พบไฟล์ GIF กรุณาอัปโหลดอีกครั้ง';
    });
    var value = function() { return { title: p.querySelector('#hrxTitle').value.trim() || 'ขอบคุณค่ะ ♡', thanks: p.querySelector('#hrxThanks').value.trim() }; };
    p.querySelector('#hrxSaveDesign').onclick = function() {
      var url = p.querySelector('#hrxGifUrl').value.trim(), gif = url || receiptSettings().gif;
      if (gif && !/^https:\/\//i.test(gif) && gif !== 'db:thankyou' && !gif.startsWith('data:image/gif;base64,')) { adminToast('ใช้ลิงก์ GIF แบบ https:// ค่ะ'); return; }
      try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(Object.assign({}, value(), { gif: gif }))); renderReceipt(); adminToast('บันทึกหน้าขอบคุณแล้ว ♡'); }
      catch (e) { adminToast('บันทึกไม่สำเร็จ พื้นที่เบราว์เซอร์เต็มค่ะ'); }
    };
    p.querySelector('#hrxRemoveGif').onclick = function() {
      try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(Object.assign({}, value(), { gif: '' }))); renderReceipt(); adminToast('ลบ GIF แล้ว'); }
      catch (e) { adminToast('บันทึกไม่สำเร็จค่ะ'); }
    };
    p.querySelector('#hrxGifFile').onchange = async function(e) {
      var f = e.target.files[0];
      if (!f) return;
      if (f.type !== 'image/gif' || f.size > 8 * 1024 * 1024) { adminToast('ใช้ไฟล์ GIF ขนาดไม่เกิน 8 MB ค่ะ'); return; }
      var status = p.querySelector('#hrxGifStatus');
      status.textContent = 'กำลังบันทึก GIF…';
      try {
        await receiptStoreGif(f);
        localStorage.setItem(RECEIPT_KEY, JSON.stringify(Object.assign({}, value(), { gif: 'db:thankyou' })));
        var preview = await receiptGifSource();
        if (!preview.startsWith('data:image/gif;base64,')) throw Error('GIF readback failed');
        renderReceipt();
        adminToast('อัปโหลด GIF และตรวจตัวอย่างแล้ว ♡');
      } catch (error) {
        console.error('GIF save failed', error);
        status.textContent = 'บันทึก GIF ไม่สำเร็จ กรุณาลองใหม่หรือใช้ลิงก์ GIF';
        adminToast('บันทึก GIF ไม่สำเร็จค่ะ');
      }
    };
  }

  window.hlgRenderTiers = renderTiers;
  window.hlgRenderPricing = renderPricing;
  window.hlgRenderFonts = renderFonts;
  window.hlgRenderCoupons = renderCoupons;
  window.hlgRenderStock = renderStock;
  window.hlgRenderReceipt = renderReceipt;
  window.hlgApplyAdminFont = applyFont;

  // Apply the shop font inside the admin portal too (same variable names).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { applyFont(); }, { once: true });
  else applyFont();
})();

