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
  const m = src.match(new RegExp('^function ' + name + '\\(s\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert.ok(m, name + ' not found');
  return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab('escapeHtml') + grab('escapeHtmlAttr'), ctx);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
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

console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
