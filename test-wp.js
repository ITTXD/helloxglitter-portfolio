const BASE = 'https://helloxglitter-preorder.vercel.app';
const COOKIE = [];

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

async function test() {
  console.log('=== 1. Login ===');
  const login = await req('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'helloxglitter' })
  });
  console.log('Login:', JSON.stringify(login.data));

  console.log('\n=== 2. สร้าง Wallpaper Order ===');
  const create = await req('/api/wallpaper/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_info: 'Test WP Auto\n0899999999',
      email: 'test@gmail.com',
      patterns: ['Wallpaper'],
      pattern_qtys: { 'Wallpaper': 1 },
      total_bags: 1,
      total_price: 99,
    })
  });
  console.log('Create:', JSON.stringify(create.data, null, 2));
  if (!create.data.order) { console.log('FAILED'); return; }
  const orderId = create.data.order.id;
  const docId = create.data.order._docId;
  console.log('orderId:', orderId, 'docId:', docId);

  console.log('\n=== 3. เช็คเบอร์ (ก่อนยืนยัน) ===');
  const check1 = await req('/api/wallpaper/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0899999999' })
  });
  console.log(JSON.stringify(check1.data, null, 2));

  console.log('\n=== 4. Login + ยืนยันด้วย docId ===');
  // re-login with fresh cookie for auth
  await req('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'helloxglitter' })
  });
  const put1 = await req('/api/orders/' + encodeURIComponent(docId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 1, download_link: 'https://drive.google.com/test123' })
  });
  console.log('PUT docId result:', JSON.stringify(put1.data, null, 2));

  console.log('\n=== 5. เช็คเบอร์ (หลังยืนยัน docId) ===');
  const check2 = await req('/api/wallpaper/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0899999999' })
  });
  console.log(JSON.stringify(check2.data, null, 2));

  console.log('\n=== 6. ลอง PUT ด้วย orderId ===');
  await req('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'helloxglitter' })
  });
  const put2 = await req('/api/orders/' + encodeURIComponent(orderId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 1, download_link: 'https://drive.google.com/test456' })
  });
  console.log('PUT orderId result:', JSON.stringify(put2.data, null, 2));

  console.log('\n=== 7. เช็คเบอร์ (หลังยืนยัน orderId) ===');
  const check3 = await req('/api/wallpaper/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0899999999' })
  });
  console.log(JSON.stringify(check3.data, null, 2));

  console.log('\n=== DONE ===');
}

test().catch(console.error);
