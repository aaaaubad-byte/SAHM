/* Independent visual property inspector. */
(function (w) {
  'use strict';
  var PROPS = [['color','لون النص'],['background-color','لون الخلفية'],['font-family','الخط'],['font-size','حجم الخط'],['font-weight','سماكة الخط'],['line-height','ارتفاع السطر'],['width','العرض'],['height','الارتفاع'],['padding','الحشوة'],['margin','الهامش'],['gap','المسافة بين العناصر'],['border-radius','استدارة الزوايا'],['text-align','محاذاة النص'],['display','طريقة العرض'],['flex-direction','اتجاه العناصر'],['align-items','محاذاة العناصر'],['justify-content','توزيع العناصر'],['grid-template-columns','أعمدة الشبكة'],['opacity','الشفافية']];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function render(el) {
    if (!el) return '<div class="se-empty">حدد عنصراً من مساحة التطبيق أو شجرة العناصر.</div>';
    var meta = w.SahmEditorCore.identify(el), cs = w.getComputedStyle(el);
    var html = '<div class="se-target"><strong>' + esc(meta.tag.toUpperCase()) + '</strong><small>' + esc(meta.id) + '</small></div><div class="se-fields">';
    PROPS.forEach(function (p) { html += '<label class="se-field"><span>' + esc(p[1]) + '</span><input type="text" data-style="' + esc(p[0]) + '" value="' + esc(cs.getPropertyValue(p[0])) + '" autocomplete="off"></label>'; });
    html += '</div>';
    if (!el.children.length && !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName)) {
      html += '<label class="se-field se-text-field"><span>النص الظاهر</span><textarea data-text-edit rows="3">' + esc(el.textContent || '') + '</textarea><small>يلزم تأكيد أن النص ثابت وليس بيانات مستخدم قبل حفظه في سجل التعديلات.</small></label>';
    }
    if (el.tagName === 'IMG') {
      html += '<label class="se-field"><span>مصدر الصورة</span><input type="url" data-attr="src" value="' + esc(el.getAttribute('src') || '') + '"></label>';
      html += '<label class="se-field"><span>النص البديل</span><input type="text" data-attr="alt" value="' + esc(el.getAttribute('alt') || '') + '"></label>';
    }
    html += '<div class="se-source"><span>ملف المصدر</span><code>Sahm_Preview_ROLE_SEPARATION.html</code><span>مرجع العنصر</span><code>' + esc(meta.selector) + '</code></div>';
    return html;
  }
  w.SahmEditorInspector = { render: render };
})(window);