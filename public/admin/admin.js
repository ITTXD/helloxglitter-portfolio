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
  // backward compat: old wallpaper name
  _priceMap['Merilah Pink WP'] = WP_PATTERNS[0] ? WP_PATTERNS[0].price : 99;
  return _priceMap;
}

function renderProductSummary() {
  var el = document.getElementById('productSummary');
  var priceMap = getPriceMap();
  var wallpapers = {};
  var bags = {};

  allOrders.forEach(function(o) {
    var qtys = o.pattern_qtys || {};
    var names = o.patterns || [];
    var customer = (o.customer_info || '').split('\n')[0] || '-';
    names.forEach(function(name) {
      var qty = qtys[name] || o.qty || 1;
      var price = priceMap[name] || 0;
      var obj = { qty: qty, price: price, customer: customer, orderId: o.id, email: o.email || '' };
      if (o.type === 'wallpaper') {
        if (!wallpapers[name]) wallpapers[name] = { total: 0, totalPrice: 0, buyers: [] };
        wallpapers[name].total += qty;
        wallpapers[name].totalPrice += qty * price;
        wallpapers[name].buyers.push(obj);
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
      + '<td class="order-id">' + escapeHtml(o.id) + (o.slip_data ? ' <i class="ti ti-receipt" style="color:#30a030;font-size:11px" title="มีสลีป"></i>' : '') + '</td>'
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
  html += '<div class="m-section-title">ข้อมูลลูกค้า</div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">ชื่อ-นามสกุล</label><input type="text" class="m-note-input" id="modalCustName" value="' + escapeHtmlAttr(cName) + '" placeholder="ชื่อ-นามสกุล" style="padding:7px 10px;"/></div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">เบอร์โทรศัพท์</label><input type="tel" class="m-note-input" id="modalCustPhone" value="' + escapeHtmlAttr(cPhone) + '" placeholder="เบอร์โทรศัพท์" style="padding:7px 10px;"/></div>';
  html += '<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:700;color:#c04878;display:block;margin-bottom:3px">ที่อยู่จัดส่ง</label><textarea class="m-note-input" id="modalCustAddress" rows="3" placeholder="ที่อยู่จัดส่ง">' + escapeHtml(cAddress) + '</textarea></div>';
  if (order.email) {
    html += '<div class="m-customer" style="margin-top:8px"><strong>Gmail:</strong> ' + escapeHtml(order.email) + '</div>';
  }
  html += '</div>';

  // Patterns with images and promo pricing
  html += '<div class="m-section">';
  html += '<div class="m-section-title">สินค้าที่สั่ง</div>';
  html += '<div class="m-patterns">';

  var pq = order.pattern_qtys || {};
  var promo = computePromoPrice(pq);
  var groups = {};
  (order.patterns || []).forEach(function(name) {
    var pat = getPatternByName(name);
    var sizeKey = pat ? pat.sizeKey : 'normal';
    if (!groups[sizeKey]) groups[sizeKey] = [];
    groups[sizeKey].push({ name: name, qty: pq[name] || order.qty || 1, pat: pat });
  });

  for (var sk in groups) {
    var sizeLabel = sk === 'normal' ? 'Normal' : sk === 'large' ? 'Large' : 'Easy';
    html += '<div class="m-pattern-group-label">' + sizeLabel + '</div>';
    groups[sk].forEach(function(item) {
      var img = item.pat ? item.pat.img : '';
      html += '<div class="m-pattern-item">';
      if (img) html += '<img class="m-pattern-img" src="' + escapeHtmlAttr(img) + '" alt="" onclick="event.stopPropagation();openLightbox(\'' + escapeHtmlAttr(img) + '\')"/>';
      html += '<span class="m-pattern-name">' + escapeHtml(item.name) + ' × ' + item.qty + '</span>';
      html += '<span class="m-pattern-price">' + (item.pat ? (item.pat.priceOrig * item.qty).toLocaleString() : '-') + ' ฿</span>';
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
  var body = {
    status: currentModalOrder.status,
    note: note,
    customer_name: custName,
    customer_phone: custPhone,
    customer_address: custAddress,
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
  document.getElementById('viewSummary').classList.toggle('hidden', view !== 'summary');
  document.getElementById('viewPrint').classList.toggle('hidden', view !== 'print');
  document.getElementById('viewTracking').classList.toggle('hidden', view !== 'tracking');
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
