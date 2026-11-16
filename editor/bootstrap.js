/* Embedded editor controller. Only the SAHM-LAB branch loads this module. */
(function (w) {
  'use strict';
  var state = { enabled: false, selected: null, before: null, history: null, hover: null, saved: false, lastSession: null };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function app() { return document.getElementById('app'); }
  function getById(id) {
    var nodes = app().querySelectorAll('[data-sahm-editor-id]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-sahm-editor-id') === id) return nodes[i];
    return null;
  }
  function status(message, type) { var el = document.getElementById('sahm-editor-status'); if (el) { el.textContent = message; el.className = 'se-status' + (type ? ' ' + type : ''); } }
  function record(type, el, details, undo, redo) {
    var meta = w.SahmEditorCore.identify(el), op = Object.assign({ type: type, elementId: meta.id, screen: meta.screen, source: meta, timestamp: new Date().toISOString() }, details || {});
    state.history.push(op, undo, redo); state.saved = false; render();
  }
  function renderSessions(items) {
    var box = document.getElementById('se-session-list'); if (!box) return;
    box.innerHTML = items.slice(0, 8).map(function (item) {
      return '<div class="se-session-item"><span><b>' + esc(item.id) + '</b><small>' + esc(item.createdAt) + '</small></span><button type="button" data-session-export="' + esc(item.id) + '">تصدير</button></div>';
    }).join('') || '<div class="se-empty">لا توجد جلسات محفوظة بعد.</div>';
  }
  function render() {
    if (!state.enabled) return;
    var selected = state.selected, history = state.history;
    var html = '<div class="se-panel-head"><div><b>محرر سهم المرئي</b><small>بيئة العمل المستقلة · SAHM-LAB</small></div><button type="button" data-se-action="exit" aria-label="إغلاق">×</button></div>';
    html += '<div class="se-toolbar"><button data-se-action="undo" ' + (!history.canUndo() ? 'disabled' : '') + '>تراجع</button><button data-se-action="redo" ' + (!history.canRedo() ? 'disabled' : '') + '>إعادة</button><button data-se-action="duplicate" ' + (!selected ? 'disabled' : '') + '>نسخ</button><button data-se-action="delete" ' + (!selected ? 'disabled' : '') + '>حذف</button></div>';
    html += '<div class="se-add-row"><select id="se-add-kind"><option value="text">نص</option><option value="heading">عنوان</option><option value="button">زر</option><option value="card">بطاقة</option><option value="image">صورة</option><option value="divider">فاصل</option></select><button data-se-action="add">إضافة عنصر</button></div>';
    html += '<div class="se-tabs"><button class="active" data-se-tab="layers">العناصر</button><button data-se-tab="inspector">الخصائص</button><button data-se-tab="sessions">الجلسات</button></div>';
    html += '<div class="se-content"><section id="se-layers">' + w.SahmEditorLayers.render(app(), selected) + '</section><section id="se-inspector" hidden>' + w.SahmEditorInspector.render(selected) + '</section><section id="se-sessions" hidden><div class="se-empty">الجلسات محفوظة على هذا الجهاز. صدّر ملف JSON لاستيراده وتحليل عملياته لاحقاً.</div><div id="se-session-list"></div></section></div>';
    html += '<div class="se-save-row"><label><input id="se-confirm-static-text" type="checkbox"> أؤكد أن النص الذي أحرره ثابت وليس بيانات مستخدم</label><button data-se-action="save">حفظ الجلسة</button><button data-se-action="export" ' + (!state.saved ? 'disabled' : '') + '>تصدير JSON</button></div><div id="sahm-editor-status" class="se-status">حدد أي عنصر لبدء التحرير.</div>';
    document.getElementById('sahm-editor-panel').innerHTML = html;
  }
  function select(el) {
    if (!el || el === app() || w.SahmEditorCore.isEditorNode(el)) return;
    if (state.selected) state.selected.classList.remove('se-selected');
    state.selected = el; w.SahmEditorCore.identify(el); el.classList.add('se-selected'); render();
  }
  function setStyle(el, prop, value) {
    var before = el.style.getPropertyValue(prop), after = String(value || '').trim();
    if (before === after) return;
    function apply(v) { if (v) el.style.setProperty(prop, v); else el.style.removeProperty(prop); }
    apply(after);
    record('style.set', el, { property: prop, before: before, after: after }, function () { apply(before); }, function () { apply(after); });
  }
  function setText(el, value) {
    var before = el.textContent || '', after = String(value == null ? '' : value);
    if (before === after) return;
    function apply(v) { el.textContent = v; }
    apply(after); record('text.set', el, { before: before, after: after }, function () { apply(before); }, function () { apply(after); });
  }
  function setAttribute(el, name, value) {
    var before = el.getAttribute(name), after = String(value || '');
    if (before === after) return;
    function apply(v) { if (v === null || v === '') el.removeAttribute(name); else el.setAttribute(name, v); }
    apply(after); record('attribute.set', el, { attribute: name, before: before, after: after }, function () { apply(before); }, function () { apply(after); });
  }
  function addElement(kind) {
    var parent = state.selected && state.selected.isConnected ? state.selected : document.getElementById('screen'), el;
    if (kind === 'heading') { el = document.createElement('h3'); el.textContent = 'عنوان جديد'; }
    else if (kind === 'button') { el = document.createElement('button'); el.type = 'button'; el.className = 'btn outline'; el.textContent = 'زر جديد'; el.setAttribute('data-editor-pending-action','true'); }
    else if (kind === 'card') { el = document.createElement('section'); el.className = 'card'; el.textContent = 'بطاقة جديدة'; }
    else if (kind === 'image') { el = document.createElement('img'); el.alt = 'صورة جديدة'; el.style.maxWidth = '100%'; }
    else if (kind === 'divider') el = document.createElement('hr');
    else { el = document.createElement('p'); el.textContent = 'نص جديد'; }
    el.setAttribute('data-sahm-editor-new','true'); parent.appendChild(el);
    var next = el.nextSibling;
    record('element.add', el, { html: el.outerHTML, parent: w.SahmEditorCore.identify(parent) },
      function () { if (el.parentNode) el.parentNode.removeChild(el); }, function () { parent.insertBefore(el, next); });
    select(el);
    status(kind === 'button' ? 'أضيف زر بلا وظيفة؛ سيُربط سلوكه عند استيراد التغييرات.' : 'أضيف العنصر إلى المعاينة.', 'success');
  }
  function duplicate() {
    var source = state.selected; if (!source || !source.parentNode) return;
    var clone = source.cloneNode(true);
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('[id]'))).forEach(function (el) { el.removeAttribute('id'); });
    clone.setAttribute('data-sahm-editor-new','true');
    source.parentNode.insertBefore(clone, source.nextSibling);
    var parent = source.parentNode, next = clone.nextSibling;
    record('element.duplicate', clone, { original: w.SahmEditorCore.identify(source), html: clone.outerHTML },
      function () { if (clone.parentNode) clone.parentNode.removeChild(clone); }, function () { parent.insertBefore(clone, next); });
    select(clone); status('نُسخت البنية. تحقق من عدم تكرار المعرفات والوظائف قبل الاستيراد.', 'success');
  }
  function removeSelected() {
    var el = state.selected; if (!el || !el.parentNode || ['app','screen','topbar','bottomnav','modal-root','toast'].includes(el.id)) return;
    var parent = el.parentNode, next = el.nextSibling, meta = w.SahmEditorCore.identify(el), html = el.outerHTML;
    parent.removeChild(el); state.selected = null;
    state.history.push({ type: 'element.remove', elementId: meta.id, screen: meta.screen, source: meta, html: html, timestamp: new Date().toISOString() },
      function () { parent.insertBefore(el, next); }, function () { if (el.parentNode) el.parentNode.removeChild(el); });
    state.saved = false; render(); status('حُذف العنصر من المعاينة. يمكن التراجع.', 'success');
  }
  function reorder(el, before) {
    if (!el || !before || el === before || el.parentNode !== before.parentNode) return;
    var parent = el.parentNode, oldNext = el.nextSibling;
    if (oldNext === before) return;
    parent.insertBefore(el, before); var newNext = el.nextSibling;
    record('element.reorder', el, { parent: w.SahmEditorCore.identify(parent), beforeElement: w.SahmEditorCore.identify(before) },
      function () { parent.insertBefore(el, oldNext); }, function () { parent.insertBefore(el, newNext); });
  }
  function save() {
    var ops = state.history.serialize(), session = w.SahmEditorCore.createSession(state.before, ops);
    w.SahmEditorCore.saveSession(session).then(async function (result) {
      state.saved = true; state.lastSession = session; render();
      var message = 'حُفظت الجلسة محلياً في ' + result.storage + '.';
      try {
        if (w.SahmEditorSync) {
          var syncState = await w.SahmEditorSync.status();
          if (syncState.sessionSyncConfigured) {
            var remote = await w.SahmEditorSync.save(session);
            state.lastSession = Object.assign({}, session, { status: 'synced', server: { branch: remote.branch, path: remote.path, commit: remote.commit } });
            message = 'حُفظت الجلسة محلياً ومزامنتها إلى ' + remote.branch + ' (' + String(remote.commit || '').slice(0, 7) + ').';
          } else {
            message += ' المزامنة إلى GitHub تنتظر إعداد أسرار الخادم وقائمة المحررين المصرح لهم.';
          }
        } else {
          message += ' لم يتم نشر وسيط GitHub بعد.';
        }
      } catch (error) {
        message += ' تعذرت المزامنة إلى الفرع: ' + error.message + '؛ بقيت النسخة المحلية محفوظة.';
      }
      render(); status(message, state.lastSession.status === 'synced' ? 'success' : '');
      w.SahmEditorCore.listSessions().then(renderSessions);
    }).catch(function (e) { status('تعذر حفظ الجلسة: ' + e.message, 'error'); });
  }
  function bindPanel() {
    var panel = document.getElementById('sahm-editor-panel');
    panel.addEventListener('click', function (event) {
      var action = event.target.closest('[data-se-action]');
      if (action) {
        var name = action.getAttribute('data-se-action');
        if (name === 'undo') state.history.undo();
        else if (name === 'redo') state.history.redo();
        else if (name === 'duplicate') duplicate();
        else if (name === 'delete') removeSelected();
        else if (name === 'add') addElement(document.getElementById('se-add-kind').value);
        else if (name === 'save') save();
        else if (name === 'export') { if (state.lastSession) w.SahmEditorCore.download(state.lastSession); else w.SahmEditorCore.listSessions().then(function (a) { if (a[0]) w.SahmEditorCore.download(a[0]); }); }
        else if (name === 'exit') toggle(false);
        return;
      }
      var pick = event.target.closest('[data-layer-pick]');
      if (pick) { var el = getById(pick.getAttribute('data-layer-pick')); if (el) select(el); return; }
      var tab = event.target.closest('[data-se-tab]');
      if (tab) {
        panel.querySelectorAll('[data-se-tab]').forEach(function (b) { b.classList.toggle('active', b === tab); });
        ['layers','inspector','sessions'].forEach(function (k) { document.getElementById('se-' + k).hidden = k !== tab.getAttribute('data-se-tab'); });
        if (tab.getAttribute('data-se-tab') === 'sessions') w.SahmEditorCore.listSessions().then(renderSessions);
        return;
      }
      var exp = event.target.closest('[data-session-export]');
      if (exp) w.SahmEditorCore.listSessions().then(function (a) { var s = a.find(function (x) { return x.id === exp.getAttribute('data-session-export'); }); if (s) w.SahmEditorCore.download(s); });
    });
    panel.addEventListener('change', function (event) {
      var input = event.target;
      if (input.matches('[data-style]') && state.selected) setStyle(state.selected, input.getAttribute('data-style'), input.value);
      else if (input.matches('[data-text-edit]') && state.selected) {
        var confirm = document.getElementById('se-confirm-static-text');
        if (!confirm || !confirm.checked) { status('أكد أولاً أن النص ثابت وليس بيانات مستخدم.', 'error'); input.value = state.selected.textContent || ''; return; }
        setText(state.selected, input.value);
      } else if (input.matches('[data-attr]') && state.selected) setAttribute(state.selected, input.getAttribute('data-attr'), input.value);
    });
    panel.addEventListener('dragstart', function (event) { var li = event.target.closest('[data-layer-id]'); if (li) { event.dataTransfer.setData('text/plain', li.getAttribute('data-layer-id')); event.dataTransfer.effectAllowed = 'move'; } });
    panel.addEventListener('dragover', function (event) { if (event.target.closest('[data-layer-id]')) event.preventDefault(); });
    panel.addEventListener('drop', function (event) {
      var li = event.target.closest('[data-layer-id]'); if (!li) return; event.preventDefault();
      var el = getById(event.dataTransfer.getData('text/plain')), before = getById(li.getAttribute('data-layer-id'));
      if (el && before && el.parentNode === before.parentNode) { reorder(el, before); render(); }
      else status('إعادة الترتيب تعمل حالياً بين العناصر الشقيقة داخل الحاوية نفسها.', 'error');
    });
  }
  function appClick(event) {
    if (!state.enabled || w.SahmEditorCore.isEditorNode(event.target)) return;
    var el = event.target.closest('#app *'); if (!el) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); select(el);
  }
  function hover(event) {
    if (!state.enabled || w.SahmEditorCore.isEditorNode(event.target)) return;
    var el = event.target.closest('#app *'); if (!el) return;
    if (state.hover && state.hover !== state.selected) state.hover.classList.remove('se-hover');
    state.hover = el; if (el !== state.selected) el.classList.add('se-hover');
  }
  function keys(event) {
    if (!state.enabled) return;
    if (event.key === 'Escape') { toggle(false); event.preventDefault(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? state.history.redo() : state.history.undo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); state.history.redo(); }
  }
  function canShow() {
    var s = w.SahmEditorCore.screen();
    return s && !['welcome','register','account-login','profile-setup','reset-password','logged-out','unknown'].includes(s);
  }
  function toggle(on) {
    state.enabled = !!on;
    var panel = document.getElementById('sahm-editor-panel'), button = document.getElementById('sahm-editor-toggle');
    if (state.enabled) {
      state.before = w.SahmEditorCore.capture(); state.history = w.SahmEditorCore.history(render);
      state.selected = null; state.saved = false; document.body.classList.add('sahm-editor-active');
      panel.hidden = false; button.hidden = true; render();
      document.addEventListener('click', appClick, true); document.addEventListener('pointerover', hover, true); document.addEventListener('keydown', keys, true);
    } else {
      document.removeEventListener('click', appClick, true); document.removeEventListener('pointerover', hover, true); document.removeEventListener('keydown', keys, true);
      document.body.classList.remove('sahm-editor-active'); panel.hidden = true; button.hidden = !canShow();
      if (state.selected) state.selected.classList.remove('se-selected'); if (state.hover) state.hover.classList.remove('se-hover');
      state.selected = null; state.hover = null;
    }
  }
  function init() {
    if (!app() || document.getElementById('sahm-editor-toggle')) return;
    var button = document.createElement('button'); button.id = 'sahm-editor-toggle'; button.type = 'button'; button.textContent = 'تحرير الواجهة';
    button.setAttribute('data-sahm-editor-ui','true'); button.setAttribute('aria-pressed','false');
    button.addEventListener('click', function () { toggle(!state.enabled); });
    var panel = document.createElement('aside'); panel.id = 'sahm-editor-panel'; panel.setAttribute('data-sahm-editor-ui','true'); panel.hidden = true;
    document.body.append(button, panel);
    bindPanel();
    function visibility() { button.hidden = !canShow() || state.enabled; if (!canShow() && state.enabled) toggle(false); }
    visibility(); w.addEventListener('popstate', visibility);
    var screen = document.getElementById('screen'); if (screen && w.MutationObserver) new MutationObserver(visibility).observe(screen, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);