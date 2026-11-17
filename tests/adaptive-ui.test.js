'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'editor', 'adaptive', 'ui.js'), 'utf8');

test('adaptive UI is screen-first and hides technical rule editing', () => {
  assert.match(ui, /تكييف الشاشة تلقائياً/);
  assert.match(ui, /حفظ قواعد الشاشة/);
  assert.match(ui, /استعادة التنسيق السابق/);
  assert.match(ui, /حذف العنصر/);
  assert.match(ui, /إضافة إلى الشاشة/);
  assert.match(ui, /إنشاء شاشة جديدة/);
  assert.doesNotMatch(ui, /حفظ القاعدة المشتركة|نطاق الحفظ|semanticRole/);
});
