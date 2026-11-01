/**
 * Admin page helpers that broke whole panels when given numbers.
 * Run with: node test/admin-helpers.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/admin/admin.js'), 'utf8');
function grab(name) {
  const m = src.match(new RegExp('^function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert.ok(m, name + ' not found');
  return m[0];
}
let clipboardWritten = null;
let execCopied = null;
let toasts = [];
let modalInputs = {};
const ctx = {
  allOrders: [],
  currentModalOrder: null,
  setTimeout: () => 1,
  clearTimeout: () => {},
  showToast: (type, msg) => { toasts.push({ type, msg }); },
  window: { isSecureContext: true },
  navigator: {
    clipboard: {
      writeText: (t) => { clipboardWritten = t; return Promise.resolve(); }
    }
  },
  document: {
    body: { appendChild: () => {} },
    getElementById: (id) => modalInputs[id] || null,
    createElement: () => ({
      value: '',
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      setSelectionRange: () => {},
      remove: () => {}
    }),
    execCommand: function(cmd) {
      if (cmd === 'copy') return true;
      return false;
    }
  }
};
vm.createContext(ctx);
vm.runInContext(
  grab('escapeHtml')
  + grab('escapeHtmlAttr')
  + grab('cleanPhoneValue')
  + grab('findThaiPhone')
  + grab('extractOrderCustomer')
  + grab('formatCustomerCopyText')
  + grab('fallbackCopyText')
  + grab('copyTextToClipboard')
  + grab('flashCopyButton')
  + grab('copyCustomerInfo')
  + grab('copyOrderAddress'),
  ctx
);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}

async function asyncTest(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.error('  ❌ ' + name + ': ' + err.message); }
}

test('escapeHtml accepts numbers (the Cloud pricing card passes its version number)', () => {
  assert.strictEqual(ctx.escapeHtml(3), '3');
  assert.strictEqual(ctx.escapeHtml(0), '0');
  assert.strictEqual(ctx.escapeHtmlAttr(12), '12');
});

test('escapeHtml still escapes markup and treats missing values as empty', () => {
  assert.strictEqual(ctx.escapeHtml('<b>"a"&</b>'), '&lt;b&gt;&quot;a&quot;&amp;&lt;/b&gt;');
  assert.strictEqual(ctx.escapeHtml(null), '');
  assert.strictEqual(ctx.escapeHtml(undefined), '');
  assert.strictEqual(ctx.escapeHtmlAttr("it's"), 'it&#39;s');
});

test('no admin code calls an esc() that is not defined in its own scope', () => {
  // renderProductsView used a bare esc(); it crashed and hid every section after the categories.
  const body = src.match(/^function renderProductsView\(\) \{[\s\S]*?^\}/m)[0];
  assert.ok(!/[^a-zA-Z_.]esc\(/.test(body), 'renderProductsView must use escapeHtml');
});

test('the print button restores its counter before updating it', () => {
  const fn = src.match(/^async function generateLabelsPDF\(\) \{[\s\S]*?^\}/m)[0];
  const code = fn.slice(fn.lastIndexOf('finally')).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(code.indexOf('btn.innerHTML') < code.indexOf('printUpdateCount();'));
});

test('openOrder copy button does not inline multiline address strings into onclick', () => {
  const openOrderFn = src.match(/^function openOrder\(id\) \{[\s\S]*?^\}/m)[0];
  assert.ok(openOrderFn.includes('onclick="copyCustomerInfo(this)"'), 'modal copy button must pass button ref without raw string interpolation');
  assert.ok(!openOrderFn.includes('copyCustomerInfo(\\\''), 'modal copy button must not interpolate unescaped multiline strings');
});

test('extractOrderCustomer and formatCustomerCopyText always include phone without duplicating name', () => {
  // Storefront checkout shape where customer_address starts with customer_name
  const o1 = {
    customer_name: 'สมหญิง ใจดี',
    customer_phone: '0891234567',
    customer_address: 'สมหญิง ใจดี\n123/45 ถนนสุขุมวิท\nกรุงเทพฯ 10110'
  };
  const c1 = ctx.extractOrderCustomer(o1);
  assert.strictEqual(
    ctx.formatCustomerCopyText(c1.name, c1.phone, c1.address),
    'สมหญิง ใจดี\n0891234567\n123/45 ถนนสุขุมวิท\nกรุงเทพฯ 10110'
  );

  // recipient_info shape where phone is on the last line of multiline address
  const o2 = {
    customer_phone: '-',
    recipient_info: 'คุณมานี มีนา\n88/9 ซอยลาดพร้าว 15\nจตุจักร กทม. 10900\n081-234-5678'
  };
  const c2 = ctx.extractOrderCustomer(o2);
  assert.strictEqual(c2.phone, '081-234-5678');
  assert.strictEqual(
    ctx.formatCustomerCopyText(c2.name, c2.phone, c2.address),
    'คุณมานี มีนา\n081-234-5678\n88/9 ซอยลาดพร้าว 15\nจตุจักร กทม. 10900'
  );
});

(async () => {
  await asyncTest('copyCustomerInfo reads live modal inputs, copies phone + address, and calls 2-arg showToast', async () => {
    clipboardWritten = null;
    toasts = [];
    modalInputs = {
      modalCustName: { value: "คุณแพรว 'P'" },
      modalCustPhone: { value: '0958887766' },
      modalCustAddress: { value: "คุณแพรว 'P'\n99/1 ต.รูสะมิแล\nจ.ปัตตานี 94000" }
    };
    const ok = await ctx.copyCustomerInfo({ nodeType: 1, dataset: {}, innerHTML: 'คัดลอก', style: {} });
    assert.strictEqual(ok, true);
    assert.strictEqual(clipboardWritten, "คุณแพรว 'P'\n0958887766\n99/1 ต.รูสะมิแล\nจ.ปัตตานี 94000");
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0].type, 'success');
    assert.ok(toasts[0].msg.includes('เบอร์โทร'), 'toast message must be defined and mention phone');
  });

  await asyncTest('copyOrderAddress falls back to execCommand when clipboard.writeText rejects', async () => {
    toasts = [];
    let lastTaValue = null;
    ctx.navigator.clipboard.writeText = () => Promise.reject(new Error('NotAllowedError'));
    ctx.document.createElement = () => {
      const ta = {
        value: '',
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => { lastTaValue = ta.value; },
        setSelectionRange: () => {},
        remove: () => {}
      };
      return ta;
    };
    ctx.allOrders = [{
      _docId: 'doc-123',
      id: 'HXG-20261102-ABCD',
      customer_name: 'ลูกค้าทดสอบ',
      customer_phone: '0865554433',
      customer_address: '55 ถ.ติวานนท์ นนทบุรี 11000'
    }];
    const btn = {
      nodeType: 1,
      dataset: {},
      innerHTML: 'คัดลอก',
      style: {},
      getAttribute: (k) => (k === 'data-doc-id' ? 'doc-123' : 'HXG-20261102-ABCD')
    };
    const ok = await ctx.copyOrderAddress(btn);
    assert.strictEqual(ok, true);
    assert.strictEqual(lastTaValue, 'ลูกค้าทดสอบ\n0865554433\n55 ถ.ติวานนท์ นนทบุรี 11000');
    assert.strictEqual(toasts[0].type, 'success');
  });

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
