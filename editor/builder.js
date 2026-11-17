/* Independent responsive screen builder. New screens never inherit rendered app styles. */
(function (w, d) {
  'use strict';
  var STORAGE_KEY = 'sahm.adaptive-screen-builder.v1';
  var VIEWPORTS = {
    small: { label: 'هاتف صغير', width: 320, height: 640 },
    medium: { label: 'هاتف متوسط', width: 360, height: 800 },
    large: { label: 'هاتف كبير', width: 430, height: 932 },
    tablet: { label: 'جهاز لوحي', width: 768, height: 1024 }
  };
  var TYPES = [
    ['container', 'حاوية', 'حاوية'],
    ['card', 'بطاقة', 'بطاقة جديدة'],
    ['heading', 'عنوان', 'عنوان جديد'],
    ['text', 'نص', 'اكتب النص هنا'],
    ['button', 'زر', 'زر جديد'],
    ['image', 'صورة', ''],
    ['divider', 'فاصل', '']
  ];
  var state = {
    open: false, screen: null, root: null, canvas: null, device: null, wrap: null, stage: null,
    panel: null, panelBody: null, selected: null, viewport: 'medium', tab: 'add',
    undo: [], redo: [], pendingEdit: null, resizeObserver: null
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function typeInfo(type) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === type) return TYPES[i];
    return TYPES[0];
  }
  function isContainer(node) { return !!node && (node.type === 'container' || node.type === 'card'); }
  function makeScreen() {
    var now = new Date().toISOString();
    return {
      schemaVersion: 1, id: id('SAHM-SCREEN'), title: 'شاشة جديدة', createdAt: now, updatedAt: now,
      source: 'adaptive-builder', layout: { mode: 'stack', gap: 14 }, elements: []
    };
  }
  function makeNode(type) {
    var info = typeInfo(type), value = info[2];
    return {
      id: id('element'), type: info[0], text: value, src: '',
      layout: {
        width: (type === 'card' || type === 'container' || type === 'image' || type === 'divider') ? 'full' : 'auto',
        align: (type === 'card' || type === 'container' || type === 'image' || type === 'divider') ? 'stretch' : 'start',
        mode: 'stack', gap: 12, fontScale: 1
      },
      children: []
    };
  }
  function findNode(idValue, list) {
    list = list || (state.screen && state.screen.elements) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === idValue) return list[i];
      var nested = findNode(idValue, list[i].children || []);
      if (nested) return nested;
    }
    return null;
  }
  function findParent(idValue, list, parent) {
    list = list || (state.screen && state.screen.elements) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === idValue) return { list: list, parent: parent || null, index: i, node: list[i] };
      var nested = findParent(idValue, list[i].children || [], list[i]);
      if (nested) return nested;
    }
    return null;
  }
  function saveActive() {
    if (!state.screen) return;
    state.screen.updatedAt = new Date().toISOString();
    try { w.localStorage.setItem(STORAGE_KEY + '.active', JSON.stringify(state.screen)); }
    catch (_) { setStatus('تعذر الحفظ التلقائي في مساحة التخزين؛ صدّر ملف JSON للاحتفاظ بالعمل.', 'error'); }
  }
  function loadActive() {
    try {
      var raw = w.localStorage.getItem(STORAGE_KEY + '.active');
      if (!raw) return null;
      var value = JSON.parse(raw);
      return value && value.schemaVersion === 1 && Array.isArray(value.elements) ? value : null;
    } catch (_) { return null; }
  }
  function savedScreens() {
    try {
      var list = JSON.parse(w.localStorage.getItem(STORAGE_KEY + '.list') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }
  function setStatus(message, kind) {
    var el = state.root && state.root.querySelector('[data-bb-status]');
    if (el) { el.textContent = message; el.className = 'seb-status' + (kind ? ' ' + kind : ''); }
  }
  function checkpoint(before) {
    state.undo.push(before || copy(state.screen));
    if (state.undo.length > 60) state.undo.shift();
    state.redo = [];
    saveActive();
  }
  function commitPendingEdit() {
    if (!state.pendingEdit || !state.screen) return;
    var before = state.pendingEdit;
    state.pendingEdit = null;
    if (JSON.stringify(before) !== JSON.stringify(state.screen)) {
      state.undo.push(before);
      if (state.undo.length > 60) state.undo.shift();
      state.redo = [];
      saveActive();
    }
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(copy(state.screen));
    state.screen = state.undo.pop();
    state.selected = state.selected && findNode(state.selected) ? state.selected : null;
    renderAll();
    saveActive();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(copy(state.screen));
    state.screen = state.redo.pop();
    state.selected = state.selected && findNode(state.selected) ? state.selected : null;
    renderAll();
    saveActive();
  }
  function add(type) {
    var node = makeNode(type), selected = state.selected && findNode(state.selected);
    var target = selected && isContainer(selected) ? selected.children : null;
    if (!target && selected) {
      var location = findParent(selected.id);
      target = location && location.list;
    }
    if (!target) target = state.screen.elements;
    checkpoint();
    target.push(node);
    state.selected = node.id;
    state.tab = 'properties';
    renderAll();
    setStatus('أضيف العنصر بإعدادات تكيفية جديدة، دون وراثة أبعاد الشاشة الحالية.', 'success');
  }
  function removeSelected() {
    var location = state.selected && findParent(state.selected);
    if (!location) return;
    checkpoint();
    location.list.splice(location.index, 1);
    state.selected = null;
    renderAll();
    setStatus('حُذف العنصر. يمكنك التراجع عن العملية.', 'success');
  }
  function moveSelected(direction) {
    var location = state.selected && findParent(state.selected);
    if (!location) return;
    var next = location.index + direction;
    if (next < 0 || next >= location.list.length) return;
    checkpoint();
    var item = location.list.splice(location.index, 1)[0];
    location.list.splice(next, 0, item);
    renderAll();
  }
  function currentLayout(node) {
    return Object.assign({ width: 'auto', align: 'start', mode: 'stack', gap: 12, fontScale: 1 }, node && node.layout || {});
  }
  function inlineStyle(node) {
    var layout = currentLayout(node), rules = ['--seb-gap:' + Math.max(0, Math.min(48, Number(layout.gap) || 0)) + 'px', '--seb-font-scale:' + Math.max(.75, Math.min(1.5, Number(layout.fontScale) || 1))];
    if (layout.width === 'full') rules.push('width:100%');
    else if (layout.width === 'fit') rules.push('width:fit-content;max-width:100%');
    else rules.push('width:auto;max-width:100%');
    if (layout.align === 'center') rules.push('align-self:center');
    else if (layout.align === 'end') rules.push('align-self:flex-end');
    else if (layout.align === 'stretch') rules.push('align-self:stretch');
    else rules.push('align-self:flex-start');
    return rules.join(';');
  }
  function nodeMarkup(node) {
    var selected = state.selected === node.id ? ' is-selected' : '';
    var style = inlineStyle(node), label = esc(node.text || typeInfo(node.type)[1]);
    var children = (node.children || []).map(nodeMarkup).join('');
    var cls = 'seb-node seb-' + node.type + selected;
    var attrs = ' class="' + cls + '" data-builder-node="' + esc(node.id) + '" style="' + esc(style) + '"';
    if (node.type === 'heading') return '<h2' + attrs + '>' + label + '</h2>';
    if (node.type === 'text') return '<p' + attrs + '>' + label + '</p>';
    if (node.type === 'button') return '<button type="button"' + attrs + '>' + label + '</button>';
    if (node.type === 'divider') return '<hr' + attrs + '>';
    if (node.type === 'image') {
      var src = safeImageUrl(node.src);
      return src ? '<div' + attrs + '><img src="' + esc(src) + '" alt="' + label + '"></div>' :
        '<div' + attrs + '><div class="seb-image-placeholder">صورة تجريبية<br><small>أضف رابط الصورة من الخصائص</small></div></div>';
    }
    if (node.type === 'card') return '<section' + attrs + '><div class="seb-card-title">' + label + '</div><div class="seb-children" data-layout="' + esc(currentLayout(node).mode) + '" style="--seb-gap:' + currentLayout(node).gap + 'px">' + children + '</div></section>';
    return '<section' + attrs + '><div class="seb-children" data-layout="' + esc(currentLayout(node).mode) + '" style="--seb-gap:' + currentLayout(node).gap + 'px">' + children + '</div></section>';
  }
  function safeImageUrl(value) {
    var url = String(value || '').trim();
    if (/^(https?:\/\/|\/(?!\/)|blob:)/i.test(url)) return url;
    return '';
  }
  function renderCanvas() {
    if (!state.canvas || !state.screen) return;
    state.canvas.innerHTML = state.screen.elements.map(nodeMarkup).join('') ||
      '<div class="seb-empty-canvas"><span>＋</span><b>ابدأ ببناء الشاشة</b><small>أضف عنواناً أو بطاقة أو حاوية، وستتولى الأداة ضبط التخطيط تلقائياً.</small></div>';
    var viewport = VIEWPORTS[state.viewport] || VIEWPORTS.medium;
    state.device.style.width = viewport.width + 'px';
    state.device.style.height = viewport.height + 'px';
    state.device.dataset.viewport = state.viewport;
    fitDevice();
  }
  function layerMarkup(list, depth) {
    return list.map(function (node) {
      var active = state.selected === node.id ? ' active' : '';
      var row = '<li><button type="button" class="seb-layer' + active + '" data-bb-select="' + esc(node.id) + '" style="padding-right:' + (10 + depth * 14) + 'px"><span>' +
        esc(typeInfo(node.type)[1]) + '</span><b>' + esc(node.text || typeInfo(node.type)[1]) + '</b><small>' + (node.children && node.children.length ? node.children.length + ' عناصر' : '') + '</small></button>';
      if (node.children && node.children.length) row += '<ul>' + layerMarkup(node.children, depth + 1) + '</ul>';
      return row + '</li>';
    }).join('');
  }
  function propertiesMarkup(node) {
    if (!node) return '<div class="seb-empty-panel">حدد عنصراً من المعاينة أو قائمة الطبقات لعرض خصائصه.</div>';
    var layout = currentLayout(node), textField = node.type !== 'image' && node.type !== 'divider' && node.type !== 'container';
    var h = '<div class="seb-property-target"><b>' + esc(typeInfo(node.type)[1]) + '</b><small>' + esc(node.id) + '</small></div>';
    if (textField) h += '<label class="seb-field"><span>المحتوى</span><textarea rows="2" data-bb-field="text">' + esc(node.text || '') + '</textarea></label>';
    h += '<div class="seb-field-grid"><label class="seb-field"><span>العرض</span><select data-bb-field="width">' +
      [['auto','تلقائي حسب المحتوى'],['full','ملء عرض الحاوية'],['fit','حسب المحتوى']].map(function (option) { return '<option value="' + option[0] + '"' + (layout.width === option[0] ? ' selected' : '') + '>' + option[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="seb-field"><span>المحاذاة</span><select data-bb-field="align">' +
      [['start','البداية'],['center','الوسط'],['end','النهاية'],['stretch','تمديد']].map(function (option) { return '<option value="' + option[0] + '"' + (layout.align === option[0] ? ' selected' : '') + '>' + option[1] + '</option>'; }).join('') + '</select></label></div>';
    if (isContainer(node)) {
      h += '<div class="seb-field-grid"><label class="seb-field"><span>ترتيب المحتوى</span><select data-bb-field="mode">' +
        [['stack','عمودي'],['grid','شبكة متجاوبة'],['row','أفقي مع التفاف']].map(function (option) { return '<option value="' + option[0] + '"' + (layout.mode === option[0] ? ' selected' : '') + '>' + option[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="seb-field"><span>المسافة بين العناصر</span><input type="range" min="0" max="32" step="1" value="' + layout.gap + '" data-bb-field="gap"></label></div>';
    }
    if (node.type === 'heading' || node.type === 'text' || node.type === 'button') {
      h += '<label class="seb-field"><span>مقياس النص</span><input type="range" min=".8" max="1.4" step=".05" value="' + layout.fontScale + '" data-bb-field="fontScale"></label>';
    }
    if (node.type === 'image') h += '<label class="seb-field"><span>رابط الصورة</span><input type="url" value="' + esc(node.src || '') + '" data-bb-field="src" placeholder="https://..."></label>';
    h += '<div class="seb-property-actions"><button type="button" data-bb-move="-1">تحريك للأعلى</button><button type="button" data-bb-move="1">تحريك للأسفل</button><button type="button" class="danger" data-bb-remove>حذف العنصر</button></div>';
    h += '<p class="seb-hint">تُعدّل هذه الخصائص داخل المنشئ فقط. لا تُستخدم أبعاد الشاشات القديمة أو أنماطها الافتراضية.</p>';
    return h;
  }
  function renderPanel() {
    if (!state.panel) return;
    var tabs = [['add','إضافة عناصر'],['properties','خصائص العنصر'],['layers','طبقات الشاشة']];
    var html = '<div class="seb-tabs">' + tabs.map(function (tab) {
      return '<button type="button" data-bb-tab="' + tab[0] + '"' + (state.tab === tab[0] ? ' class="active"' : '') + '>' + tab[1] + '</button>';
    }).join('') + '</div>';
    if (state.tab === 'add') {
      html += '<div class="seb-add-grid">' + TYPES.map(function (type) {
        return '<button type="button" data-bb-add="' + type[0] + '"><b>' + esc(type[1]) + '</b><small>' + (type[0] === 'container' || type[0] === 'card' ? 'تحتوي عناصر أخرى' : 'حجم تكيفي تلقائي') + '</small></button>';
      }).join('') + '</div><p class="seb-hint">يُضاف العنصر داخل الحاوية المحددة، أو إلى الشاشة إذا لم تحدد حاوية.</p>';
    } else if (state.tab === 'properties') {
      html += propertiesMarkup(state.selected && findNode(state.selected));
    } else {
      html += '<div class="seb-layer-help">اضغط على عنصر لتحديده. استخدم الأسهم من خصائص العنصر لتغيير ترتيبه.</div>' +
        (state.screen.elements.length ? '<ul class="seb-layer-tree">' + layerMarkup(state.screen.elements, 0) + '</ul>' : '<div class="seb-empty-panel">لا توجد عناصر بعد.</div>');
    }
    state.panel.innerHTML = html;
  }
  function renderHeader() {
    var name = state.root.querySelector('[data-bb-title]');
    if (name && d.activeElement !== name) name.value = state.screen.title || 'شاشة جديدة';
    var undoButton = state.root.querySelector('[data-bb-undo]');
    var redoButton = state.root.querySelector('[data-bb-redo]');
    if (undoButton) undoButton.disabled = !state.undo.length;
    if (redoButton) redoButton.disabled = !state.redo.length;
    state.root.querySelectorAll('[data-bb-viewport]').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-bb-viewport') === state.viewport);
    });
    var select = state.root.querySelector('[data-bb-saved]');
    if (select) {
      var list = savedScreens();
      select.innerHTML = '<option value="">شاشاتي المحفوظة</option>' + list.map(function (screen) {
        return '<option value="' + esc(screen.id) + '"' + (screen.id === state.screen.id ? ' selected' : '') + '>' + esc(screen.title || 'شاشة دون اسم') + '</option>';
      }).join('');
    }
  }
  function renderAll() {
    renderHeader();
    renderCanvas();
    renderPanel();
  }
  function fitDevice() {
    if (!state.stage || !state.device || !state.wrap) return;
    var profile = VIEWPORTS[state.viewport] || VIEWPORTS.medium;
    var availableW = Math.max(120, state.stage.clientWidth - 24);
    var availableH = Math.max(160, state.stage.clientHeight - 24);
    var scale = Math.min(availableW / profile.width, availableH / profile.height, 1);
    scale = Math.max(.18, scale || .18);
    state.device.style.transform = 'scale(' + scale + ')';
    state.wrap.style.width = Math.round(profile.width * scale) + 'px';
    state.wrap.style.height = Math.round(profile.height * scale) + 'px';
    state.device.style.width = profile.width + 'px';
    state.device.style.height = profile.height + 'px';
  }
  function renderUI() {
    var root = d.createElement('div');
    root.className = 'seb-overlay';
    root.setAttribute('data-sahm-editor-ui', 'true');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'منشئ الشاشات التكيفية');
    root.innerHTML =
      '<header class="seb-header">' +
        '<div class="seb-brand"><b>منشئ الشاشات</b><small>تخطيط تكيفي جديد</small></div>' +
        '<input type="text" data-bb-title aria-label="اسم الشاشة" maxlength="60" placeholder="اسم الشاشة">' +
        '<div class="seb-actions"><button type="button" data-bb-new>جديد</button><button type="button" data-bb-save>حفظ</button><button type="button" data-bb-export>تصدير HTML</button><button type="button" data-bb-close aria-label="إغلاق">×</button></div>' +
      '</header>' +
      '<div class="seb-device-bar"><select data-bb-saved aria-label="الشاشات المحفوظة"><option value="">شاشاتي المحفوظة</option></select>' +
        '<div class="seb-device-options">' +
          '<button type="button" data-bb-viewport="small">320</button><button type="button" data-bb-viewport="medium">360</button>' +
          '<button type="button" data-bb-viewport="large">430</button><button type="button" data-bb-viewport="tablet">لوحي</button>' +
        '</div><span data-bb-size>360 × 800</span>' +
      '</div>' +
      '<main class="seb-workspace"><section class="seb-stage" data-bb-stage>' +
        '<div class="seb-device-wrap" data-bb-wrap><div class="seb-device" data-bb-device>' +
          '<div class="seb-device-status"><span>9:41</span><i></i><span>● ● ●</span></div>' +
          '<main class="seb-device-scroll"><div class="seb-screen-canvas" data-bb-canvas></div></main>' +
        '</div></div>' +
      '</section><aside class="seb-inspector"><div class="seb-panel" data-bb-panel></div><div class="seb-status" data-bb-status>أضف العناصر وراقب تكيفها مع أحجام الشاشات.</div></aside></main>';
    d.body.appendChild(root);
    state.root = root;
    state.canvas = root.querySelector('[data-bb-canvas]');
    state.device = root.querySelector('[data-bb-device]');
    state.wrap = root.querySelector('[data-bb-wrap]');
    state.stage = root.querySelector('[data-bb-stage]');
    state.panel = root.querySelector('[data-bb-panel]');
    root.querySelector('[data-bb-size]').textContent = VIEWPORTS[state.viewport].width + ' × ' + VIEWPORTS[state.viewport].height;
    if (w.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(fitDevice);
      state.resizeObserver.observe(state.stage);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('keydown', onKeyDown);
    d.addEventListener('keydown', onDocumentKeyDown, true);
    d.body.classList.add('seb-open');
    renderAll();
    w.requestAnimationFrame(fitDevice);
  }
  function onFocusIn(event) {
    if (event.target && event.target.hasAttribute('data-bb-field') && !state.pendingEdit) state.pendingEdit = copy(state.screen);
  }
  function applyField(input) {
    var node = state.selected && findNode(state.selected);
    if (!node) return;
    var key = input.getAttribute('data-bb-field'), value = input.value, layout = currentLayout(node);
    if (key === 'text') node.text = value;
    else if (key === 'src') node.src = value;
    else if (key === 'width') layout.width = value;
    else if (key === 'align') layout.align = value;
    else if (key === 'mode') layout.mode = value;
    else if (key === 'gap') layout.gap = Math.max(0, Math.min(32, Number(value) || 0));
    else if (key === 'fontScale') layout.fontScale = Math.max(.8, Math.min(1.4, Number(value) || 1));
    node.layout = layout;
    renderCanvas();
  }
  function onInput(event) {
    if (event.target && event.target.hasAttribute('data-bb-field')) applyField(event.target);
  }
  function onChange(event) {
    var input = event.target;
    if (input && input.hasAttribute('data-bb-field')) {
      if (!state.pendingEdit) state.pendingEdit = copy(state.screen);
      applyField(input);
      commitPendingEdit();
      renderPanel();
      saveActive();
      return;
    }
    if (input && input.hasAttribute('data-bb-title')) {
      if (!state.pendingEdit) state.pendingEdit = copy(state.screen);
      state.screen.title = String(input.value || 'شاشة جديدة').trim().slice(0, 60) || 'شاشة جديدة';
      commitPendingEdit();
      renderHeader();
      saveActive();
      return;
    }
    if (input && input.hasAttribute('data-bb-saved')) {
      var item = savedScreens().find(function (screen) { return screen.id === input.value; });
      if (item) {
        state.screen = copy(item); state.selected = null; state.undo = []; state.redo = [];
        saveActive(); renderAll();
      }
    }
  }
  function onKeyDown(event) {
    if (event.target && event.target.hasAttribute('data-bb-title') && event.key === 'Enter') {
      event.preventDefault(); event.target.blur();
    }
  }
  function onDocumentKeyDown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }
  function onClick(event) {
    var target = event.target.closest('button,select,[data-builder-node]');
    if (!target || !state.root.contains(target)) return;
    var addButton = target.closest('[data-bb-add]');
    if (addButton) { add(addButton.getAttribute('data-bb-add')); return; }
    var tab = target.closest('[data-bb-tab]');
    if (tab) { state.tab = tab.getAttribute('data-bb-tab'); renderPanel(); return; }
    var viewport = target.closest('[data-bb-viewport]');
    if (viewport) {
      state.viewport = viewport.getAttribute('data-bb-viewport');
      state.root.querySelector('[data-bb-size]').textContent = VIEWPORTS[state.viewport].width + ' × ' + VIEWPORTS[state.viewport].height;
      renderHeader(); renderCanvas(); return;
    }
    var node = target.closest('[data-builder-node]');
    if (node) {
      state.selected = node.getAttribute('data-builder-node');
      state.tab = 'properties'; renderCanvas(); renderPanel(); return;
    }
    var layer = target.closest('[data-bb-select]');
    if (layer) { state.selected = layer.getAttribute('data-bb-select'); state.tab = 'properties'; renderAll(); return; }
    if (target.hasAttribute('data-bb-undo')) { undo(); return; }
    if (target.hasAttribute('data-bb-redo')) { redo(); return; }
    if (target.hasAttribute('data-bb-remove')) { removeSelected(); return; }
    if (target.hasAttribute('data-bb-move')) { moveSelected(Number(target.getAttribute('data-bb-move'))); return; }
    if (target.hasAttribute('data-bb-new')) {
      if (w.confirm('إنشاء شاشة جديدة؟ احفظ الشاشة الحالية أولاً إذا كنت تريد الاحتفاظ بها.')) {
        state.screen = makeScreen(); state.selected = null; state.undo = []; state.redo = []; state.tab = 'add'; saveActive(); renderAll();
      }
      return;
    }
    if (target.hasAttribute('data-bb-save')) { saveScreen(); return; }
    if (target.hasAttribute('data-bb-export')) { download(exportHtml(), slug(state.screen.title) + '.html', 'text/html;charset=utf-8'); setStatus('تم تجهيز ملف HTML مستقل للمعاينة. لا يربط وظائف التطبيق أو بياناته.', 'success'); return; }
    if (target.hasAttribute('data-bb-close')) { close(); return; }
  }
  function slug(value) {
    return String(value || 'sahm-screen').trim().replace(/[^\u0600-\u06FF\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'sahm-screen';
  }
  function saveScreen() {
    var screen = copy(state.screen), list = savedScreens().filter(function (item) { return item.id !== screen.id; });
    screen.title = String(screen.title || 'شاشة جديدة').trim() || 'شاشة جديدة';
    screen.updatedAt = new Date().toISOString();
    list.unshift(screen);
    list = list.slice(0, 20);
    try {
      w.localStorage.setItem(STORAGE_KEY + '.list', JSON.stringify(list));
      w.localStorage.setItem(STORAGE_KEY + '.active', JSON.stringify(screen));
      state.screen = screen;
      renderHeader();
      setStatus('حُفظت الشاشة محلياً في هذا المتصفح. صدّر HTML للاحتفاظ بنسخة قابلة للعرض.', 'success');
    } catch (_) {
      setStatus('تعذر حفظ الشاشة محلياً. صدّر ملف HTML قبل إغلاق الأداة.', 'error');
    }
  }
  function download(content, filename, type) {
    var blob = new Blob([content], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob), link = d.createElement('a');
    link.href = url; link.download = filename; link.click();
    w.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function exportHtml() {
    var css = [
      '*{box-sizing:border-box}',
      'html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;color:#172338;background:#f4f6fa;direction:rtl}',
      '.seb-screen-canvas{container-type:inline-size;width:100%;max-width:100%;min-height:100vh;padding:clamp(16px,4cqi,24px);display:flex;flex-direction:column;align-items:stretch;gap:14px}',
      '.seb-node{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}',
      '.seb-heading{font-size:calc(clamp(21px,5.6cqi,28px)*var(--seb-font-scale,1));line-height:1.35;font-weight:700;margin:0}',
      '.seb-text{font-size:calc(clamp(14px,3.8cqi,16px)*var(--seb-font-scale,1));line-height:1.75;margin:0}',
      '.seb-button{min-height:44px;padding:10px 18px;border:0;border-radius:10px;background:#3158d6;color:#fff;font:600 calc(14px*var(--seb-font-scale,1))/1.4 inherit;cursor:pointer;white-space:normal}',
      '.seb-card{width:100%;padding:16px;border:1px solid #e1e7ef;border-radius:15px;background:#fff;box-shadow:0 4px 16px #1723380d;display:flex;flex-direction:column;gap:10px}',
      '.seb-card-title{font-size:16px;font-weight:700;line-height:1.5}',
      '.seb-container{width:100%;display:flex;flex-direction:column;min-width:0}',
      '.seb-children{display:flex;flex-direction:column;gap:var(--seb-gap,12px);min-width:0}',
      '.seb-children[data-layout=grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}',
      '.seb-children[data-layout=row]{display:flex;flex-direction:row;flex-wrap:wrap;align-items:stretch}',
      '.seb-children[data-layout=row]>.seb-node{flex:1 1 min(100%,220px)}',
      '.seb-image img{display:block;width:100%;height:auto;max-width:100%;object-fit:contain;border-radius:10px}',
      '.seb-divider{width:100%;border:0;border-top:1px solid #dce3ec;margin:6px 0}',
      '@media(max-width:360px){.seb-screen-canvas{padding:14px;gap:12px}.seb-card{padding:13px}}'
    ].join('');
    var markup = state.screen.elements.map(function (node) { return exportNode(node); }).join('');
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>' +
      esc(state.screen.title || 'شاشة سهم') + '</title><style>' + css + '</style></head><body><main class="seb-screen-canvas">' + markup + '</main></body></html>';
  }
  function exportNode(node) {
    var layout = currentLayout(node), style = inlineStyle(node), content = esc(node.text || '');
    var children = (node.children || []).map(exportNode).join('');
    if (node.type === 'heading') return '<h2 class="seb-node seb-heading" style="' + esc(style) + '">' + content + '</h2>';
    if (node.type === 'text') return '<p class="seb-node seb-text" style="' + esc(style) + '">' + content + '</p>';
    if (node.type === 'button') return '<button type="button" class="seb-node seb-button" style="' + esc(style) + '">' + content + '</button>';
    if (node.type === 'divider') return '<hr class="seb-node seb-divider" style="' + esc(style) + '">';
    if (node.type === 'image') {
      var src = safeImageUrl(node.src);
      return src ? '<div class="seb-node seb-image" style="' + esc(style) + '"><img src="' + esc(src) + '" alt=""></div>' : '';
    }
    if (node.type === 'card') return '<section class="seb-node seb-card" style="' + esc(style) + '"><div class="seb-card-title">' + content + '</div><div class="seb-children" data-layout="' + esc(layout.mode) + '" style="--seb-gap:' + layout.gap + 'px">' + children + '</div></section>';
    return '<section class="seb-node seb-container" style="' + esc(style) + '"><div class="seb-children" data-layout="' + esc(layout.mode) + '" style="--seb-gap:' + layout.gap + 'px">' + children + '</div></section>';
  }
  function open() {
    if (state.open) return;
    state.open = true;
    state.screen = loadActive() || makeScreen();
    state.selected = null; state.undo = []; state.redo = []; state.tab = 'add'; state.viewport = 'medium';
    renderUI();
  }
  function close() {
    if (!state.open) return;
    commitPendingEdit();
    saveActive();
    if (state.resizeObserver) { state.resizeObserver.disconnect(); state.resizeObserver = null; }
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    d.removeEventListener('keydown', onDocumentKeyDown, true);
    d.body.classList.remove('seb-open');
    state.open = false; state.root = state.canvas = state.device = state.wrap = state.stage = state.panel = state.panelBody = null;
  }
  function isOpen() { return state.open; }
  w.SahmScreenBuilder = { open: open, close: close, isOpen: isOpen, exportHtml: exportHtml };
})(window, document);
