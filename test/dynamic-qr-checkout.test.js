const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.VERCEL = '1';
process.env.FIREBASE_PROJECT_ID = '';
process.env.ADMIN_PASSWORD = 'helloxglitter';
process.env.SESSION_SECRET = 'test-secret-qr-checkout-9999';

const serverHandler = require('../server');

// Extract the QR payload & CRC functions from public/index.html to ensure we test the exact implementation
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// Helper to isolate script block
function getScriptContent(scriptId) {
  const marker = `<script id="${scriptId}">`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`Script ${scriptId} not found`);
  const end = html.indexOf('</script>', start);
  return html.substring(start + marker.length, end);
}

const qrScript = getScriptContent('hlg-promptpay-qr-js');

// Create sandbox to extract payload function
const sandbox = {
  window: {},
  document: {
    getElementById: () => null,
    createElement: () => ({ getContext: () => ({ fillStyle: '', fillRect: () => {} }), toDataURL: () => 'data:image/png;base64,mock' })
  },
  console: { error: () => {} }
};

const fn = new Function('window', 'document', 'console', qrScript);
fn(sandbox.window, sandbox.document, sandbox.console);

const payload = sandbox.window.hlgPromptPayload;

console.log('========================================');
console.log('  TEST: Dynamic PromptPay QR Generator');
console.log('========================================\n');

// 1. Tag 01 initiation method test
console.log('── 1. DYNAMIC QR INITIATION METHOD (Tag 01 = 12) ──');
{
  const p = payload('0812345678', 490);
  assert(p.startsWith('000201010212'), 'Payload must start with 000201010212 (Dynamic QR)');
  console.log('  ✅ Payload correctly uses Initiation Method 12 (Dynamic)');
}

// 2. Tag 54 Amount locking test
console.log('\n── 2. TRANSACTION AMOUNT LOCKING (Tag 54) ──');
{
  const p490 = payload('0812345678', 490);
  assert(p490.includes('5406490.00'), 'Payload must include Tag 54 with amount 490.00');
  console.log('  ✅ 490 ฿ locks Tag 54 to "5406490.00"');

  const p1250_50 = payload('0812345678', 1250.5);
  assert(p1250_50.includes('54071250.50'), 'Payload must include Tag 54 with amount 1250.50');
  console.log('  ✅ 1,250.50 ฿ locks Tag 54 to "54071250.50"');

  const pNull = payload('0812345678', null);
  assert(!pNull.includes('540'), 'Payload without amount must not include Tag 54');
  console.log('  ✅ Null amount produces un-locked QR without Tag 54');
}

// 3. ID formats: 10-digit mobile, 13-digit citizen ID, and 15-digit KBank reference
console.log('\n── 3. RECIPIENT IDENTIFIER FORMATS (10, 13, 15 digits) ──');
{
  // 10 digits mobile
  const pMobile = payload('0812345678', 350);
  assert(pMobile.includes('01130066812345678'), '10-digit mobile must use Sub-tag 01 with 0066 prefix');
  console.log('  ✅ 10-digit phone (0812345678) maps to Sub-tag 01 (0066812345678)');

  // 13 digits citizen ID
  const pCitId = payload('1100500123456', 350);
  assert(pCitId.includes('02131100500123456'), '13-digit citizen ID must use Sub-tag 02');
  console.log('  ✅ 13-digit citizen ID maps to Sub-tag 02');

  // 15 digits KBank reference
  const pKBank = payload('004999017222364', 350);
  assert(pKBank.includes('0315004999017222364'), '15-digit KBank reference must use Sub-tag 03');
  console.log('  ✅ 15-digit KBank ref (004999017222364) maps to Sub-tag 03');
}

// 4. CRC16-CCITT Checksum Verification
console.log('\n── 4. CRC16-CCITT VALIDATION ──');
{
  const p = payload('004999017222364', 490);
  const data = p.slice(0, -4);
  const expectedCrc = p.slice(-4);

  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  const calcCrc = crc.toString(16).toUpperCase().padStart(4, '0');
  assert.strictEqual(calcCrc, expectedCrc, 'CRC must match CRC16-CCITT algorithm');
  console.log(`  ✅ CRC checksum "${expectedCrc}" verified 100% mathematically valid`);
}

// 5. Verification that qrcode.jpeg is completely eradicated from payment frame
console.log('\n── 5. CLEAN HTML FRAME & ERADICATION OF qrcode.jpeg ──');
{
  assert(!html.includes('id="hlgReceiptQr" src="https://helloxglitterstore.vercel.app/images/qrcode.jpeg"'),
    '#hlgReceiptQr must NOT have hardcoded qrcode.jpeg src in renderDone');
  assert(!html.includes('id="hlgReceiptQr" src="./images/qrcode.jpeg"'),
    '#hlgReceiptQr must NOT have hardcoded local qrcode.jpeg');
  assert(html.includes('class="hrx-qr-frame"'),
    '.hrx-qr-frame must exist in HTML');
  assert(html.includes('THAI QR PAYMENT · PromptPay'),
    '.hrx-qr-head with THAI QR PAYMENT · PromptPay must exist in HTML');
  assert(html.includes('id="hrxSaveQrBtn"'),
    'Save QR button must exist in HTML frame');
  console.log('  ✅ Hardcoded qrcode.jpeg removed from #hlgReceiptQr');
  console.log('  ✅ Clean Thai QR HTML frame preserved');
  console.log('  ✅ Download/Save QR button available in frame');
}

// 6. Backend API settings test
console.log('\n── 6. BACKEND SETTINGS API & CLOUD PERSISTENCE ──');
(async () => {
  const ADMIN_COOKIE = `admin_session=${process.env.SESSION_SECRET}`;

  function createReq(method, url, body = null, cookies = '') {
    return {
      method,
      url,
      headers: { host: 'localhost:3000', cookie: cookies },
      on: (event, cb) => {
        if (event === 'data' && body) cb(JSON.stringify(body));
        if (event === 'end') cb();
      }
    };
  }

  function createRes() {
    const res = {
      _status: 200,
      _headers: {},
      _body: null,
      writeHead: (status, headers) => {
        res._status = status;
        res._headers = { ...res._headers, ...headers };
      },
      end: (body) => {
        res._body = body;
      }
    };
    return res;
  }

  // GET /api/settings/storefront
  const resGet = createRes();
  await serverHandler(createReq('GET', '/api/settings/storefront'), resGet);
  assert.strictEqual(resGet._status, 200);
  const dataGet = JSON.parse(resGet._body);
  assert(dataGet.success);
  assert(dataGet.settings.payment);
  assert.strictEqual(dataGet.settings.payment.id, '004999017222364');
  assert.strictEqual(dataGet.settings.payment.bank, 'กสิกรไทย');
  assert.strictEqual(dataGet.settings.payment.account, '749-2439-414');
  console.log('  ✅ GET /api/settings/storefront returns default payment settings');

  // PUT /api/settings/storefront with custom promptpay phone
  const resPut = createRes();
  await serverHandler(createReq('PUT', '/api/settings/storefront', {
    payment: {
      id: '0891234567',
      lock: true,
      bank: 'กสิกรไทย',
      account: '749-2439-414',
      holder: 'Nichakarn E.'
    }
  }, ADMIN_COOKIE), resPut);
  assert.strictEqual(resPut._status, 200);
  const dataPut = JSON.parse(resPut._body);
  assert.strictEqual(dataPut.settings.payment.id, '0891234567');
  console.log('  ✅ PUT /api/settings/storefront updates payment settings in cloud storage');

  // Verify parity in api/[...path].js
  const apiPathJs = fs.readFileSync(path.join(__dirname, '../api/[...path].js'), 'utf8');
  assert(apiPathJs.includes("id: '004999017222364'"), 'api/[...path].js has default payment id');
  assert(apiPathJs.includes('payment:'), 'api/[...path].js includes payment in settings');
  console.log('  ✅ api/[...path].js parity verified');

  console.log('\n========================================');
  console.log('Results: All tests passed successfully!');
  console.log('========================================\n');
})();
