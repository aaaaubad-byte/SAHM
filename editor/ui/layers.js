/* Independent element tree and same-parent drag/drop. */
(function (w) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function label(el) {
    var text = el.getAttribute('aria-label') || el.getAttribute('data-action') || el.getAttribute('data-go') || el.id || '';
    if (!text && typeof el.className === 'string') text = el.className.trim().split(/\s+/).filter(function (x) { return !/^se-/.test(x); }).slice(0, 2).join('.');
    if (!text) text = el.tagName.toLowerCase();
    return text.length > 32 ? text.slice(0, 29) + '…' : text;
  }
  function renderNode(el, selected, depth, count) {
    if (!el || w.SahmEditorCore.isEditorNode(el) || /^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName) || el.hidden || el.getAttribute('aria-hidden') === 'true') return '';
    if (++count.value > 650 || depth > 8) return '';
    var meta = w.SahmEditorCore.identify(el), children = '';
    Array.prototype.forEach.call(el.children || [], function (child) { children += renderNode(child, selected, depth + 1, count); });
    return '<li class="se-layer' + (el === selected ? ' is-selected' : '') + '" draggable="true" data-layer-id="' + esc(meta.id) + '">' +
      '<button type="button" class="se-layer-pick" data-layer-pick="' + esc(meta.id) + '"><span class="se-layer-tag">' + esc(el.tagName.toLowerCase()) + '</span><span class="se-layer-name">' + esc(label(el)) + '</span>' +
      (children ? '<span class="se-layer-count">' + el.children.length + '</span>' : '') + '</button>' +
      (children ? '<ul>' + children + '</ul>' : '') + '</li>';
  }
  function render(root, selected) {
    var count = { value: 0 }, html = '';
    Array.prototype.forEach.call(root.children || [], function (el) { html += renderNode(el, selected, 0, count); });
    return '<ul class="se-layer-tree">' + html + '</ul>';
  }
  w.SahmEditorLayers = { render: render };
})(window);