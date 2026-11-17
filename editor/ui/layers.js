/* Readable Arabic layer tree with semantic labels. */
(function (w) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function directText(el) {
    var value = '';
    Array.prototype.forEach.call(el.childNodes || [], function (node) {
      if (node.nodeType === 3) value += ' ' + node.nodeValue;
    });
    return value.replace(/\\s+/g, ' ').trim();
  }
  function typeName(el) {
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'PICTURE') return 'صورة';
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button') return 'زر';
    if (/^H[1-6]$/.test(tag)) return 'عنوان';
    if (/^(P|SPAN|LABEL|SMALL|STRONG|B|EM|A)$/.test(tag)) return tag === 'A' ? 'رابط' : 'نص';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'حقل إدخال';
    if (tag === 'HR') return 'فاصل';
    if (tag === 'SVG') return 'أيقونة';
    if (el.children && el.children.length) return 'حاوية';
    return 'عنصر';
  }
  function label(el) {
    var text = el.getAttribute('aria-label') || el.getAttribute('data-action') || el.getAttribute('data-go') || '';
    if (!text) text = directText(el);
    if (!text && el.children && el.children.length) {
      var child = el.querySelector('h1,h2,h3,h4,h5,h6,button,[aria-label],p,span,label');
      if (child) text = child.getAttribute('aria-label') || directText(child);
    }
    if (!text && el.id) text = el.id.replace(/[-_]+/g, ' ');
    if (!text) text = typeName(el);
    text = text.replace(/\\s+/g, ' ').trim();
    return text.length > 38 ? text.slice(0, 35) + '…' : text;
  }
  function renderNode(el, selected, depth, count) {
    if (!el || w.SahmEditorCore.isEditorNode(el) || /^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName) || el.hidden || el.getAttribute('aria-hidden') === 'true') return '';
    if (++count.value > 650 || depth > 8) return '';
    var meta = w.SahmEditorCore.identify(el), children = '';
    Array.prototype.forEach.call(el.children || [], function (child) { children += renderNode(child, selected, depth + 1, count); });
    var hasChildren = !!children;
    return '<li class="se-layer' + (el === selected ? ' is-selected' : '') + '" draggable="true" data-layer-id="' + esc(meta.id) + '">' +
      '<button type="button" class="se-layer-pick" data-layer-pick="' + esc(meta.id) + '" aria-label="تحديد ' + esc(typeName(el) + ': ' + label(el)) + '">' +
      '<span class="se-layer-type">' + esc(typeName(el)) + '</span><span class="se-layer-name">' + esc(label(el)) + '</span>' +
      (hasChildren ? '<span class="se-layer-count">' + el.children.length + ' عناصر</span>' : '') +
      '<span class="se-layer-grip" aria-hidden="true">⠿</span></button>' +
      (hasChildren ? '<ul>' + children + '</ul>' : '') + '</li>';
  }
  function render(root, selected) {
    var count = { value: 0 }, html = '';
    Array.prototype.forEach.call(root.children || [], function (el) { html += renderNode(el, selected, 0, count); });
    return '<div class="se-layers-help">كل سطر يمثل عنصراً في الشاشة. اضغط عليه لتحديده، واسحب السطر لتغيير ترتيبه داخل الحاوية نفسها.</div>' +
      (html ? '<ul class="se-layer-tree">' + html + '</ul>' : '<div class="se-empty">لا توجد عناصر قابلة للعرض في هذه الشاشة.</div>');
  }
  w.SahmEditorLayers = { render: render };
})(window);
