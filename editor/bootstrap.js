/* Embedded editor controller. Only the SAHM-LAB branch loads this module. */
(function (w) {
  'use strict';
  var state = { enabled: false, selected: null, before: null, history: null, hover: null, saved: false, lastSession: null, activeTool: null, dragging: null, panelPosition: null, panelDragging: null, frameDragging: null, frameRaf: 0, selectionObserver: null, suppressClickUntil: 0 };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function app() { return document.getElementById('app'); }
  function preparePreview() {
    var root=app(), parent=root&&root.parentElement;
    if(!root||!parent||state.previewStage)return;
    var stage=document.createElement('div');stage.className='se-preview-stage';
    parent.insertBefore(stage,root);stage.appendChild(root);state.previewStage=stage;
    function fit(){
      if(!stage.isConnected)return;
      var scale=Math.min((stage.parentElement.clientWidth-24)/430,(stage.parentElement.clientHeight-24)/932,1);
      scale=Math.max(.25,scale||.25);
      stage.style.width=(430*scale)+'px';stage.style.height=(932*scale)+'px';
      root.style.setProperty('--se-preview-scale',String(scale));
      root.dataset.sePreviewScale=String(scale);
    }
    state.previewFit=fit;fit();
    if(w.ResizeObserver){state.previewObserver=new ResizeObserver(fit);state.previewObserver.observe(parent);}
    w.addEventListener('resize',fit);
  }
  function restorePreview() {
    var root=app(),stage=state.previewStage;if(!stage)return;
    if(state.previewObserver){state.previewObserver.disconnect();state.previewObserver=null;}
    if(state.previewFit)w.removeEventListener('resize',state.previewFit);
    if(root&&stage.parentElement)stage.parentElement.insertBefore(root,stage);
    if(stage.parentElement)stage.parentElement.removeChild(stage);
    if(root){root.style.removeProperty('--se-preview-scale');delete root.dataset.sePreviewScale;}
    state.previewStage=null;state.previewFit=null;
  }
  function getById(id) {
    var nodes = app().querySelectorAll('[data-sahm-editor-id]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-sahm-editor-id') === id) return nodes[i];
    return null;
  }
  function status(message, type) { var el = document.getElementById('sahm-editor-status'); if (el) { el.textContent = message; el.className = 'se-status' + (type ? ' ' + type : ''); } }
  function scheduleSelectionFrame() {
    if (state.frameRaf || !w.requestAnimationFrame) { updateSelectionFrame(); return; }
    state.frameRaf = w.requestAnimationFrame(function () { state.frameRaf = 0; updateSelectionFrame(); });
  }
  function selectionFrameMarkup() {
    var handles = ['nw','n','ne','e','se','s','sw','w'];
    return '<div class="se-selection-frame" data-se-selection-frame hidden>' +
      handles.map(function (name) { return '<button type="button" class="se-selection-handle se-handle-' + name + '" data-se-handle="' + name + '" aria-label="تغيير الحجم"></button>'; }).join('') +
      '<button type="button" class="se-selection-handle se-handle-move" data-se-handle="move" aria-label="تحريك العنصر">••</button>' +
      '<button type="button" class="se-selection-handle se-handle-rotate" data-se-handle="rotate" aria-label="تدوير العنصر"></button></div>';
  }
  function selectionBreadcrumb(el) {
    var path = [], node = el;
    while (node && node !== app()) { path.unshift(node); node = node.parentElement; }
    path = path.slice(-4);
    return '<div class="se-breadcrumbs">' + path.map(function (item, index) {
      var id = w.SahmEditorCore.identify(item).id;
      var label = item.id ? '#' + item.id : item.tagName.toLowerCase();
      return (index ? '<span class="se-crumb-sep">›</span>' : '') +
        '<button type="button" data-se-select-id="' + esc(id) + '"' + (item === el ? ' aria-current="true"' : '') + '>' + esc(label) + '</button>';
    }).join('') + '</div>';
  }
  function updateTransformControls() {
    var el = state.selected, panel = document.getElementById('sahm-editor-panel');
    if (!el || !panel) return;
    function sync(input, value, unit) {
      if (!input || document.activeElement === input) return;
      input.value = value;
      var wrap = input.closest('.se-slider-control'), readout = wrap && wrap.querySelector('[data-range-value]');
      if (readout) readout.textContent = value + (unit || input.getAttribute('data-unit') || '');
    }
    sync(panel.querySelector('[data-style="width"]'), Math.round(el.offsetWidth || 0), 'px');
    sync(panel.querySelector('[data-style="height"]'), Math.round(el.offsetHeight || 0), 'px');
    sync(panel.querySelector('[data-style="rotate"]'), parseFloat(el.style.rotate) || 0, '°');
    var parts = String(el.style.translate || '0px 0px').trim().split(/\s+/);
    sync(panel.querySelector('[data-position-axis="x"]'), parseFloat(parts[0]) || 0, 'px');
    sync(panel.querySelector('[data-position-axis="y"]'), parseFloat(parts[1]) || 0, 'px');
  }
  function updateSelectionFrame() {
    var frame = document.querySelector('#sahm-editor-panel [data-se-selection-frame]');
    var el = state.selected;
    if (!frame) return;
    if (!state.enabled || !el || !el.isConnected) { frame.hidden = true; return; }
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) { frame.hidden = true; return; }
    frame.hidden = false;
    frame.style.left = Math.round(rect.left) + 'px';
    frame.style.top = Math.round(rect.top) + 'px';
    frame.style.width = Math.max(1, Math.round(rect.width)) + 'px';
    frame.style.height = Math.max(1, Math.round(rect.height)) + 'px';
    updateTransformControls();
  }
  function transformSnapshot(el) {
    return { width: el.style.width, height: el.style.height, translate: el.style.translate, rotate: el.style.rotate };
  }
  function applyTransformSnapshot(el, snapshot) {
    ['width','height','translate','rotate'].forEach(function (key) {
      if (snapshot[key]) el.style.setProperty(key, snapshot[key]);
      else el.style.removeProperty(key);
    });
    scheduleSelectionFrame();
  }
  function liveEdit(input) {
    var el = state.selected;
    if (!el) return;
    if (input.matches('[data-style]')) {
      var prop = input.getAttribute('data-style');
      if (!Object.prototype.hasOwnProperty.call(input, '_seBefore')) {
        input._seBefore = el.style.getPropertyValue(prop);
        input._seEditKind = 'style'; input._seEditProp = prop;
      }
      var value = input.value;
      if (input.hasAttribute('data-zero-auto') && Number(value) === 0) value = '';
      if ((prop === 'width' || prop === 'height') && w.getComputedStyle(el).display === 'inline') {
        if (!Object.prototype.hasOwnProperty.call(input, '_seDisplayBefore')) input._seDisplayBefore = el.style.display || '';
        el.style.display = 'inline-block';
      }
      if (input.hasAttribute('data-shadow-level')) { var level=Number(value)||0; value=level?'0 4px '+level+'px rgba(0,0,0,'+(Math.min(.28,.08+level/150).toFixed(2))+')':''; }
      else if (input.hasAttribute('data-unit-scale')) value=String((Number(value)||0)*Number(input.getAttribute('data-unit-scale')));
      else if (input.getAttribute('data-unit') && value !== '') value += input.getAttribute('data-unit');
      else if ((prop === 'width' || prop === 'height') && input.type === 'number' && value !== '') value += 'px';
      if (prop === 'rotate' && value !== '') value = String(parseFloat(value)||0) + 'deg';
      if (value) el.style.setProperty(prop, value); else el.style.removeProperty(prop);
      input._seAfter = el.style.getPropertyValue(prop);
      var rangeWrap=input.closest('.se-slider-control'), rangeValue=rangeWrap&&rangeWrap.querySelector('[data-range-value]');
      if (rangeValue) rangeValue.textContent=input.value+(input.getAttribute('data-unit')||'');
      if (prop === 'rotate') {
        var readout = input.parentElement && input.parentElement.querySelector('[data-rotate-value]');
        if (readout) readout.textContent = (parseFloat(input.value) || 0) + '°';
      }
    } else if (input.matches('[data-position-axis]')) {
      if (!Object.prototype.hasOwnProperty.call(input, '_seBefore')) {
        input._seBefore = el.style.translate || '';
        input._seEditKind = 'position';
      }
      var parts = String(el.style.translate || '0px 0px').trim().split(/\s+/);
      var x = parseFloat(parts[0]) || 0, y = parseFloat(parts[1]) || 0;
      if (input.getAttribute('data-position-axis') === 'x') x = Number(input.value) || 0;
      else y = Number(input.value) || 0;
      el.style.translate = x + 'px ' + y + 'px';
      input._seAfter = el.style.translate;
      var rangeWrap=input.closest('.se-slider-control'), rangeReadout=rangeWrap&&rangeWrap.querySelector('[data-range-value]');
      if (rangeReadout) rangeReadout.textContent=(input.getAttribute('data-position-axis')==='x'?x:y)+' px';
    } else if (input.matches('[data-attr]')) {
      var attr = input.getAttribute('data-attr');
      if (!Object.prototype.hasOwnProperty.call(input, '_seBefore')) {
        input._seBefore = el.hasAttribute(attr) ? el.getAttribute(attr) : null;
        input._seEditKind = 'attribute'; input._seEditProp = attr;
      }
      if (input.value === '') el.removeAttribute(attr); else el.setAttribute(attr, input.value);
      input._seAfter = el.hasAttribute(attr) ? el.getAttribute(attr) : null;
    } else if (input.matches('[data-text-edit]')) {
      var confirm = document.getElementById('se-confirm-static-text');
      if (!confirm || !confirm.checked) {
        status('أكد أولاً أن النص ثابت وليس بيانات مستخدم.', 'error');
        input.value = editableText(el);
        return;
      }
      var textNode = input._seTextNode || directTextNode(el, true);
      if (!textNode) { status('حدد النص الداخلي نفسه لتعديله دون استبدال بنية الحاوية.', 'error'); return; }
      if (!Object.prototype.hasOwnProperty.call(input, '_seBefore')) {
        input._seBefore = textNode.nodeValue || '';
        input._seTextNode = textNode;
        input._seEditKind = 'text';
      }
      textNode.nodeValue = input.value;
      input._seAfter = textNode.nodeValue;
    }
    scheduleSelectionFrame();
  }
  function commitLiveEdit(input) {
    var el = state.selected;
    if (!el || !Object.prototype.hasOwnProperty.call(input, '_seBefore')) return;
    var kind = input._seEditKind, prop = input._seEditProp, before = input._seBefore, after;
    if (kind === 'style') {
      after = el.style.getPropertyValue(prop);
      var displayBefore = input._seDisplayBefore, displayAfter = el.style.display || '';
      delete input._seBefore; delete input._seEditKind; delete input._seEditProp; delete input._seDisplayBefore;
      if (before === after && (displayBefore === undefined || displayBefore === displayAfter)) return;
      function apply(value) { if (value) el.style.setProperty(prop, value); else el.style.removeProperty(prop); }
      if (displayBefore !== undefined && displayBefore !== displayAfter) {
        var meta = w.SahmEditorCore.identify(el), timestamp = new Date().toISOString();
        var operations = [{type:'style.set',elementId:meta.id,screen:meta.screen,source:meta,timestamp:timestamp,property:prop,before:before,after:after},
          {type:'style.set',elementId:meta.id,screen:meta.screen,source:meta,timestamp:timestamp,property:'display',before:displayBefore,after:displayAfter}];
        state.history.pushGroup(operations,
          function(){apply(before);if(displayBefore)el.style.display=displayBefore;else el.style.removeProperty('display');},
          function(){apply(after);el.style.display=displayAfter;});
        state.saved=false;
      } else {
        if (before === after) return;
        record('style.set', el, { property: prop, before: before, after: after }, function () { apply(before); }, function () { apply(after); });
      }
    } else if (kind === 'position') {
      after = el.style.translate || '';
      delete input._seBefore; delete input._seEditKind;
      if (before === after) return;
      function apply(value) { if (value) el.style.translate = value; else el.style.removeProperty('translate'); }
      record('style.set', el, { property: 'translate', before: before, after: after }, function () { apply(before); }, function () { apply(after); });
    } else if (kind === 'attribute') {
      after = el.hasAttribute(prop) ? el.getAttribute(prop) : null;
      delete input._seBefore; delete input._seEditKind; delete input._seEditProp;
      if (before === after) return;
      function apply(value) { if (value === null || value === '') el.removeAttribute(prop); else el.setAttribute(prop, value); }
      record('attribute.set', el, { attribute: prop, before: before, after: after }, function () { apply(before); }, function () { apply(after); });
    } else if (kind === 'text') {
      var node = input._seTextNode;
      after = node ? node.nodeValue : '';
      delete input._seBefore; delete input._seEditKind; delete input._seTextNode;
      if (before === after) return;
      function apply(value) { if (node) node.nodeValue = value; }
      record('text.set', el, { before: before, after: after }, function () { apply(before); }, function () { apply(after); });
    }
  }
  function record(type, el, details, undo, redo) {
    var meta = w.SahmEditorCore.identify(el), op = Object.assign({ type: type, elementId: meta.id, screen: meta.screen, source: meta, timestamp: new Date().toISOString() }, details || {});
    state.history.push(op, undo, redo); state.saved = false;
  }
  function renderSessions(items) {
    var box = document.getElementById('se-session-list'); if (!box) return;
    box.innerHTML = items.slice(0, 8).map(function (item) {
      return '<div class="se-session-item"><span><b>' + esc(item.id) + '</b><small>' + esc(item.createdAt) + '</small></span><button type="button" data-session-export="' + esc(item.id) + '">تصدير</button></div>';
    }).join('') || '<div class="se-empty">لا توجد جلسات محفوظة بعد.</div>';
  }
  function icon(name) {
    var paths = {
      cursor:'<path d="m5 3 14 12-7 1-3 5z"/>', plus:'<path d="M12 5v14M5 12h14"/>',
      layers:'<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
      undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
      redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/>',
      save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
      history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
      type:'<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
      palette:'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H18a3 3 0 0 0 3-3c0-4.6-4-8.4-9-8.4z"/><path d="M7.5 11h.01M10 7.5h.01M15 8h.01M17 11h.01"/>',
      font:'<path d="M4 20 10 4h4l6 16M7 13h10"/>',
      shadow:'<rect x="4" y="3" width="13" height="13" rx="2"/><path d="M8 20h11a2 2 0 0 0 2-2V8"/>',
      border:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M3 8h18"/>',
      move:'<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/>',
      image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
      crop:'<path d="M6 3v12a3 3 0 0 0 3 3h12M18 21V9a3 3 0 0 0-3-3H3"/>',
      maximize:'<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>',
      rotate:'<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/>',
      click:'<path d="m9 9 5 12 2-5 5-2z"/><path d="M4 4 2 2M10 3V1M3 10H1"/>',
      copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m4 4v7m6-7v7"/>',
      more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      layout:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
      close:'<path d="m18 6-12 12M6 6l12 12"/>',
      check:'<path d="m5 12 4 4L19 6"/>'
    };
    return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.more)+'</svg>';
  }
  function normalizeTool(name) { return ({palette:'color',type:'text',move:'position',plus:'add',history:'sessions',maximize:'size',transform:'size'}[name]||name); }
  function toolButton(name,label,active,action) {
    var isActive=active===true||normalizeTool(name)===state.activeTool;
    return '<button type="button" class="se-tool'+(isActive?' active':'')+'" data-se-tool="'+esc(name)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+icon(name)+'<span>'+esc(label)+'</span></button>';
  }
  function actionButton(name,label) { return '<button type="button" class="se-tool" data-se-action="'+esc(name)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+icon(name)+'<span>'+esc(label)+'</span></button>'; }
  function kindOf(el) {
    if (!el) return 'none';
    if (el.tagName === 'IMG') return 'image';
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return 'button';
    if (/^(H1|H2|H3|H4|P|SPAN|LABEL|SMALL|STRONG|B|EM)$/.test(el.tagName)) return 'text';
    if (el.tagName === 'SVG' || el.querySelector('svg')) return 'icon';
    return 'container';
  }
  function valueOf(el, prop, fallback) {
    var v = el ? w.getComputedStyle(el).getPropertyValue(prop) : '';
    return v && v !== 'none' ? v : fallback;
  }
  function colorHex(value, fallback) {
    var v = String(value || '').trim(), m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) return m[1].length === 3 ? '#' + m[1].split('').map(function (x) { return x + x; }).join('') : v;
    m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!m) return fallback;
    return '#' + [m[1],m[2],m[3]].map(function (x) { return Math.max(0,Math.min(255,Math.round(Number(x)||0))).toString(16).padStart(2,'0'); }).join('');
  }
  function directTextNode(el, create) {
    if (!el) return null;
    for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3 && String(el.childNodes[i].nodeValue || '').trim()) return el.childNodes[i];
    if (create && !el.children.length) { var node = document.createTextNode(''); el.appendChild(node); return node; }
    return null;
  }
  function editableText(el) {
    var node = directTextNode(el, false);
    return node ? node.nodeValue : (!el.children.length ? (el.textContent || '') : '');
  }
  function hasEditableText(el) {
    if (!el || /^(IMG|INPUT|TEXTAREA|SELECT|OPTION|SVG|HR)$/.test(el.tagName)) return false;
    return !!directTextNode(el, false) || (!el.children.length && !!String(el.textContent || '').trim());
  }
  function selectControl(label, prop, current, options, isAttr) {
    var list=options.slice(), found=list.some(function(o){return String(o[0])===String(current);});
    if (!found && current !== undefined && current !== null && String(current) !== '') list.unshift([String(current),String(current)+' (القيمة الحالية)']);
    return '<label class="se-field"><span>' + esc(label) + '</span><select ' + (isAttr ? 'data-attr="' : 'data-style="') + esc(prop) + '">' +
      list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(current) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></label>';
  }
  function sliderControl(label, key, prop, value, min, max, step, unit, extra) {
    var id='se-range-'+key, numeric=Math.max(Number(min),Math.min(Number(max),Number(value)||0));
    return '<div class="se-slider-control"><div class="se-slider-title"><span>'+esc(label)+'</span><b data-range-value="'+id+'">'+numeric+esc(unit||'')+'</b></div><div class="se-slider-row"><button type="button" class="se-step-button" data-range-step="-1" data-range-target="'+id+'" aria-label="تقليل '+esc(label)+'">−</button><input id="'+id+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+numeric+'"'+(prop?' data-style="'+esc(prop)+'"':'')+(unit?' data-unit="'+esc(unit)+'"':'')+(extra||'')+'><button type="button" class="se-step-button" data-range-step="1" data-range-target="'+id+'" aria-label="زيادة '+esc(label)+'">+</button></div></div>';
  }
  function toolPanel() {
    var el=state.selected, kind=kindOf(el), t=normalizeTool(state.activeTool);
    if (!t || t==='select') return '';
    var panelTitles={add:'إضافة عنصر',layers:'طبقات العناصر',sessions:'جلسات التحرير',text:'تحرير النص',color:'الألوان',font:'الخطوط',shadow:'الظلال',border:'الإطار والمسافات',position:'موقع العنصر',size:'الحجم',transform:'الحجم',rotate:'الدوران',layout:'تخطيط الحاوية',image:'إعدادات الصورة',click:'إعدادات العنصر',more:'أدوات إضافية'};
    var panelIcons={add:'plus',layers:'layers',sessions:'history',text:'type',color:'palette',font:'font',shadow:'shadow',border:'border',position:'move',size:'maximize',transform:'maximize',rotate:'rotate',layout:'layout',image:'image',click:'click',more:'more'};
    var panelIcon=panelIcons[t]||'more';
    var h='<section class="se-tool-panel'+(t==='layout'?' se-layout-tool-panel':'')+'"><div class="se-tool-panel-head"><div class="se-tool-panel-title">'+icon(panelIcon)+'<b>'+esc(panelTitles[t]||'أداة التحرير')+'</b></div><button type="button" data-se-tool="select" aria-label="إغلاق">'+icon('close')+'</button></div><div class="se-tool-panel-body">';
    if (t==='add') {
      h+='<div class="se-element-grid">'+[['text','نص','type'],['heading','عنوان','type'],['button','زر','click'],['card','بطاقة','layers'],['image','صورة','image'],['divider','فاصل','border']].map(function(x){return '<button type="button" class="se-element-choice" data-add-kind="'+x[0]+'">'+icon(x[2])+'<span>'+x[1]+'</span></button>';}).join('')+'</div><div class="se-add-note">سيُضاف العنصر إلى الشاشة الحالية ويمكنك تعديله مباشرة.</div>';
    } else if (t==='layers') {
      h+=w.SahmEditorLayers.render(app(),el);
    } else if (t==='sessions') {
      h+='<div class="se-empty">الجلسات المحفوظة محلياً والمتزامنة مع الفرع.</div><div id="se-session-list"></div>';
    } else if (!el) {
      h+='<div class="se-empty">حدد عنصراً من شاشة المعاينة أولاً.</div>';
    } else if (t==='text') {
      h+='<label class="se-field"><span>النص المباشر للعنصر</span><textarea data-text-edit rows="3">'+esc(editableText(el))+'</textarea></label><label class="se-check"><input id="se-confirm-static-text" type="checkbox"> أؤكد أن هذا النص ثابت وليس بيانات مستخدم</label><div class="se-hint">يتم تعديل النص المباشر فقط مع الحفاظ على العناصر الداخلية.</div>';
    } else if (t==='color') {
      var currentTextColor=colorHex(valueOf(el,'color','#182b4d'),'#182b4d');
      var currentBackground=colorHex(valueOf(el,'background-color','rgb(255,255,255)'),'#ffffff');
      h+='<label class="se-field"><span>لون النص الحالي</span><input type="color" data-style="color" value="'+currentTextColor+'"></label><label class="se-field"><span>لون الخلفية الحالي</span><input type="color" data-style="background-color" value="'+currentBackground+'"></label>';
    } else if (t==='font') {
      var fontSize=parseInt(valueOf(el,'font-size','14px'),10)||14;
      var fontWeight=valueOf(el,'font-weight','400'), textAlign=valueOf(el,'text-align','right');
      h+='<label class="se-field"><span>عائلة الخط</span><input data-style="font-family" value="'+esc(valueOf(el,'font-family','IBM Plex Sans Arabic'))+'"></label>'+sliderControl('حجم الخط','font-size','font-size',fontSize,10,48,1,'px')+
        selectControl('سماكة الخط','font-weight',fontWeight,[['300','خفيف'],['400','عادي'],['500','متوسط'],['600','شبه عريض'],['700','عريض'],['800','ثقيل']])+
        selectControl('محاذاة النص','text-align',textAlign,[['right','يمين'],['center','وسط'],['left','يسار'],['justify','ضبط']]);
    } else if (t==='shadow') {
      var shadowComputed=valueOf(el,'box-shadow','none'), shadowMatch=shadowComputed.match(/0px\s+4px\s+([\d.]+)px/) || shadowComputed.match(/0\s+4px\s+([\d.]+)px/);
      var shadowLevel=shadowMatch?Math.round(Number(shadowMatch[1])):(shadowComputed==='none'?0:8);
      h+=sliderControl('قوة الظل','shadow-level','box-shadow',shadowLevel,0,30,1,'',' data-shadow-level');
    } else if (t==='layout') {
      var cs=w.getComputedStyle(el);
      h+='<div class="se-layout-section"><b>طريقة ترتيب المحتوى</b>'+
        selectControl('نظام العرض','display',cs.display,[['block','عنصر عادي'],['flex','Flex'],['inline-flex','Flex ضمن السطر'],['grid','Grid'],['inline-block','كتلة ضمن السطر'],['none','إخفاء العنصر']])+
        selectControl('اتجاه العناصر','flex-direction',cs.flexDirection,[['row','أفقي'],['row-reverse','أفقي معكوس'],['column','عمودي'],['column-reverse','عمودي معكوس']])+
        selectControl('السماح بالالتفاف','flex-wrap',cs.flexWrap,[['nowrap','سطر واحد'],['wrap','التفاف إلى سطر جديد'],['wrap-reverse','التفاف معكوس']])+
        selectControl('محاذاة العناصر','align-items',cs.alignItems,[['stretch','تمديد'],['flex-start','بداية'],['center','وسط'],['flex-end','نهاية'],['baseline','خط الأساس']])+
        selectControl('توزيع العناصر','justify-content',cs.justifyContent,[['flex-start','البداية'],['center','الوسط'],['flex-end','النهاية'],['space-between','مسافة بينية'],['space-around','مسافة حولية'],['space-evenly','مسافات متساوية']])+
        selectControl('التمرير داخل الحاوية','overflow',cs.overflow,[['visible','إظهار المحتوى'],['hidden','إخفاء الزائد'],['auto','تمرير عند الحاجة'],['scroll','تمرير دائماً']])+
        selectControl('التمرير العمودي','overflow-y',cs.overflowY,[['visible','إظهار'],['hidden','إخفاء'],['auto','تلقائي'],['scroll','دائماً']])+
        selectControl('التمرير الأفقي','overflow-x',cs.overflowX,[['visible','إظهار'],['hidden','إخفاء'],['auto','تلقائي'],['scroll','دائماً']])+
        selectControl('أعمدة Grid','grid-template-columns',cs.gridTemplateColumns,[['none','تلقائي'],['1fr','عمود واحد'],['repeat(2,minmax(0,1fr))','عمودان'],['repeat(3,minmax(0,1fr))','3 أعمدة'],['repeat(4,minmax(0,1fr))','4 أعمدة']])+
        selectControl('توزيع الصفوف','align-content',cs.alignContent,[['normal','تلقائي'],['start','البداية'],['center','الوسط'],['end','النهاية'],['space-between','مسافة بينية'],['space-around','مسافة حولية'],['stretch','تمديد']])+
        '</div><div class="se-layout-section"><b>المسافات والأبعاد</b>'+
        sliderControl('المسافة بين العناصر','layout-gap','gap',parseInt(cs.gap,10)||0,0,48,1,'px')+
        sliderControl('ارتفاع الحاوية الأدنى','layout-min-height','min-height',parseInt(cs.minHeight,10)||0,0,700,5,'px')+
        sliderControl('الارتفاع الأقصى','layout-max-height','max-height',cs.maxHeight==='none'?0:(parseInt(cs.maxHeight,10)||0),0,900,10,'px',' data-zero-auto')+
        sliderControl('مرونة التمدد','layout-grow','flex-grow',parseFloat(cs.flexGrow)||0,0,5,.1,'')+
        sliderControl('مرونة الانكماش','layout-shrink','flex-shrink',parseFloat(cs.flexShrink)||1,0,3,.1,'')+
        selectControl('عرض الحاوية','width',cs.width,[['auto','تلقائي'],['100%','عرض كامل'],['fit-content','حسب المحتوى'],['max-content','أكبر محتوى']])+
        selectControl('ارتفاع الحاوية','height',cs.height,[['auto','تلقائي'],['100%','ارتفاع كامل'],['fit-content','حسب المحتوى'],['max-content','أكبر محتوى']])+
        selectControl('أقل عرض','min-width',cs.minWidth,[['0px','صفر'],['100%','عرض كامل'],['auto','تلقائي']])+
        selectControl('أقصى عرض','max-width',cs.maxWidth,[['none','بلا حد'],['100%','عرض كامل'],['fit-content','حسب المحتوى']])+
        '</div><div class="se-hint">تتحكم هذه الإعدادات في ترتيب العناصر داخل الحاوية. اختر «تمرير عند الحاجة» إذا كان المحتوى أطول من المساحة المتاحة.</div>';
    } else if (t==='border') {
      var radius=parseInt(valueOf(el,'border-radius','8px'),10)||0, padding=parseInt(valueOf(el,'padding','0px'),10)||0;
      h+=sliderControl('استدارة الزوايا','radius','border-radius',radius,0,40,1,'px')+sliderControl('المسافة الداخلية','padding','padding',padding,0,40,1,'px');
    } else if (t==='transform' || t==='size') {
      var box=el.getBoundingClientRect(),scale=Number(app().dataset.sePreviewScale)||1;
      var ew=Math.round(el.offsetWidth||box.width/scale),eh=Math.round(el.offsetHeight||box.height/scale);
      var opacity=parseFloat(valueOf(el,'opacity','1')); opacity=Math.max(0,Math.min(1,opacity));
      h+=sliderControl('العرض','width','width',ew,20,430,1,'px')+sliderControl('الارتفاع','height','height',eh,20,900,1,'px')+sliderControl('الشفافية','opacity','opacity',Math.round(opacity*100),0,100,1,'%',' data-unit-scale="0.01"');
    } else if (t==='rotate') {
      var rot=parseFloat(el.style.rotate)||0;
      h+=sliderControl('زاوية الدوران','rotate','rotate',rot,-180,180,1,'°');
    } else if (t==='position') {
      var tr=String(el.style.translate||'0px 0px').split(/\s+/),tx=parseFloat(tr[0])||0,ty=parseFloat(tr[1])||0;
      h+=sliderControl('الموقع الأفقي','position-x','',tx,-180,180,1,'px',' data-position-axis="x"')+sliderControl('الموقع العمودي','position-y','',ty,-240,240,1,'px',' data-position-axis="y"')+'<div class="se-hint">يمكنك أيضاً تحريك العنصر من مقبض التحريك في المعاينة.</div>';
    } else if (t==='image' && kind==='image') {
      var objectFit=valueOf(el,'object-fit','contain');
      h+='<label class="se-field"><span>مصدر الصورة</span><input type="url" data-attr="src" value="'+esc(el.getAttribute('src')||'')+'"></label><label class="se-field"><span>النص البديل</span><input data-attr="alt" value="'+esc(el.getAttribute('alt')||'')+'"></label>'+
        selectControl('طريقة ملاءمة الصورة','object-fit',objectFit,[['contain','احتواء كامل'],['cover','ملء الإطار'],['fill','تمديد'],['none','الحجم الأصلي']]);
    } else if (t==='click') {
      var pointerEvents=valueOf(el,'pointer-events','auto'), cursor=valueOf(el,'cursor','auto');
      h+=selectControl('استقبال النقر','pointer-events',pointerEvents,[['auto','مفعّل'],['none','معطّل']])+
        selectControl('شكل المؤشر','cursor',cursor,[['auto','تلقائي'],['pointer','يد النقر'],['not-allowed','غير مسموح'],['grab','قابل للسحب']])+
        '<label class="se-field"><span>تلميح العنصر</span><input data-attr="title" value="'+esc(el.getAttribute('title')||'')+'"></label>';
      var routes=[['','لا يوجد إجراء'],['home','الرئيسية'],['groups','الجمعيات'],['group-detail','تفاصيل الجمعية'],['create-group','إنشاء جمعية'],['join-group','الانضمام إلى جمعية'],['member-reception','استقبال الأعضاء'],['members','الأعضاء'],['installments','الأقساط'],['draw-room','غرفة القرعة'],['draw-history','نتائج القرعة'],['news','الأخبار'],['chat','المحادثة'],['receipts','سجلات الاستلام'],['invite','دعوة عضو'],['invites','الدعوات'],['join-requests','طلبات الانضمام'],['notifications','الإشعارات'],['profile','الملف الشخصي'],['edit-profile','تعديل الملف'],['settings','الإعدادات'],['audit','سجل العمليات'],['welcome','تسجيل الدخول']];
      if (el.tagName==='A' && !el.hasAttribute('data-go')) {
        h+='<label class="se-field"><span>رابط الوجهة</span><input type="url" data-attr="href" value="'+esc(el.getAttribute('href')||'')+'"></label>'+
          selectControl('طريقة فتح الرابط','target',el.getAttribute('target')||'',[['','في النافذة نفسها'],['_self','في النافذة نفسها'],['_blank','في نافذة جديدة']],true);
      }
      if (el.tagName==='BUTTON') {
        h+=selectControl('نوع الزر','type',el.type||'submit',[['button','زر عادي'],['submit','إرسال نموذج'],['reset','إعادة ضبط']],true)+
          selectControl('حالة الزر','disabled',el.hasAttribute('disabled')?'disabled':'',[['','مفعّل'],['disabled','معطّل']],true);
      }
      if (el.hasAttribute('data-action')) {
        h+='<div class="se-hint">هذا العنصر مرتبط بإجراء داخلي في سهم. حافظ المحرر على هذا الإجراء ولا يسمح باستبداله بوجهة تنقّل.</div>';
      } else if (el.hasAttribute('data-go') || el.tagName==='BUTTON' || el.getAttribute('role')==='button') {
        if (el.closest('form') && el.tagName==='BUTTON' && el.type==='submit') {
          h+='<div class="se-hint">هذا زر إرسال نموذج. غيّر نوعه إلى «زر عادي» قبل تعيين وجهة تنقّل.</div>';
        } else {
          h+=selectControl('الإجراء عند النقر','data-go',el.getAttribute('data-go')||'',routes,true)+
            '<div class="se-hint">تُنفّذ وجهة التنقّل عند إغلاق المحرر واستخدام الشاشة بصورة طبيعية.</div>';
        }
      } else if (el.tagName==='A') {
        h+='<div class="se-hint">يمكنك تغيير رابط هذا العنصر من الحقل أعلاه.</div>';
      } else {
        h+='<div class="se-hint">يمكنك التحكم في استقبال النقر وشكل المؤشر لهذا العنصر.</div>';
      }
    } else if (t==='more') {
      h+='<div class="se-more-actions"><button data-se-action="duplicate">'+icon('copy')+' نسخ العنصر</button><button data-se-action="delete">'+icon('trash')+' حذف العنصر</button><button data-se-tool="layers">'+icon('layers')+' ترتيب الطبقات</button></div>';
    }
    h+='</div></section>'; return h;
  }
  function refreshHistoryControls() {
    if (!state.history) return;
    var undo = document.querySelectorAll('#sahm-editor-panel [data-se-action="undo"]');
    var redo = document.querySelectorAll('#sahm-editor-panel [data-se-action="redo"]');
    Array.prototype.forEach.call(undo, function (button) { button.disabled = !state.history.canUndo(); });
    Array.prototype.forEach.call(redo, function (button) { button.disabled = !state.history.canRedo(); });
  }
  function render() {
    if (!state.enabled) return;
    var selected=state.selected, history=state.history, kind=kindOf(selected);
    var tools=selected ? (
      toolButton('plus','العناصر')+
      (hasEditableText(selected)?toolButton('type','النص'):'')+
      toolButton('palette','اللون')+toolButton('font','الخط')+toolButton('shadow','الظلال')+
      (kind==='container'||selected.children.length?toolButton('layout','التخطيط'):'')+
      toolButton('border','الإطار')+toolButton('maximize','الحجم')+toolButton('move','الموقع')+toolButton('rotate','الدوران')+
      (kind==='image'?toolButton('image','الصورة'):'')+
      ((kind==='button'||selected.tagName==='A'||selected.hasAttribute('data-go'))?toolButton('click','السلوك'):'')+
      toolButton('layers','الطبقات')+toolButton('history','الجلسات')+toolButton('more','المزيد')
    ) : (
      toolButton('cursor','تحديد')+toolButton('plus','العناصر')+toolButton('layers','الطبقات')+
      actionButton('undo','تراجع')+actionButton('redo','إعادة')+toolButton('history','الجلسات')+actionButton('save','حفظ')
    );
    var html='<div class="se-topbar"><div class="se-brand"><b>سهم</b><small>محرر الواجهة</small></div><div class="se-top-actions"><button data-se-action="undo" '+(!history.canUndo()?'disabled':'')+' title="تراجع">'+icon('undo')+'</button><button data-se-action="redo" '+(!history.canRedo()?'disabled':'')+' title="إعادة">'+icon('redo')+'</button><button data-se-action="save" title="حفظ الجلسة">'+icon('save')+'</button><button data-se-action="exit" title="إغلاق المحرر">'+icon('close')+'</button></div></div>';
    html += selectionFrameMarkup();
    html+=toolPanel();
    html+='<div class="se-dock-wrap"><div class="se-context-label">'+(selected?selectionBreadcrumb(selected):'<span>أدوات المحرر</span>')+'</div><nav class="se-dock" aria-label="أدوات التحرير">'+tools+'</nav><div id="sahm-editor-status" class="se-status">حدد عنصراً من المعاينة لعرض أدواته الخاصة.</div></div>';
    document.getElementById('sahm-editor-panel').innerHTML=html;
    applyPanelPosition();
    scheduleSelectionFrame();
    if(state.activeTool==='sessions') w.SahmEditorCore.listSessions().then(renderSessions);
  }
  function applyPanelPosition() {
    var panel=document.querySelector('#sahm-editor-panel .se-tool-panel'),p=state.panelPosition;
    if(!panel||!p)return;
    var maxX=Math.max(8,w.innerWidth-panel.offsetWidth-8),maxY=Math.max(8,w.innerHeight-panel.offsetHeight-8);
    p.x=Math.max(8,Math.min(p.x,maxX));p.y=Math.max(8,Math.min(p.y,maxY));
    panel.style.left=p.x+'px';panel.style.top=p.y+'px';panel.style.right='auto';panel.style.bottom='auto';
  }
  function beginPanelDrag(event) {
    var head=event.target.closest('.se-tool-panel-head'),panel=event.target.closest('.se-tool-panel');
    if(!head||!panel||event.target.closest('button'))return;
    var r=panel.getBoundingClientRect();
    state.panelPosition=state.panelPosition||{x:r.left,y:r.top};
    state.panelDragging={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:state.panelPosition.x,y:state.panelPosition.y};
    if(head.setPointerCapture)try{head.setPointerCapture(event.pointerId);}catch(_){}
    event.preventDefault();event.stopPropagation();
  }
  function movePanelDrag(event) {
    var d=state.panelDragging;if(!d||d.pointerId!==event.pointerId)return;
    state.panelPosition={x:d.x+event.clientX-d.startX,y:d.y+event.clientY-d.startY};
    applyPanelPosition();event.preventDefault();
  }
  function endPanelDrag(event) {
    if(state.panelDragging&&state.panelDragging.pointerId===event.pointerId)state.panelDragging=null;
  }
  function select(el) {
    if (!el || el === app() || w.SahmEditorCore.isEditorNode(el)) return;
    if (state.selected) state.selected.classList.remove('se-selected');
    if (state.selectionObserver) { state.selectionObserver.disconnect(); state.selectionObserver = null; }
    state.selected = el; state.activeTool = 'size'; w.SahmEditorCore.identify(el); el.classList.add('se-selected');
    if (w.ResizeObserver) { state.selectionObserver = new ResizeObserver(scheduleSelectionFrame); state.selectionObserver.observe(el); }
    render();
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
    var parent = state.selected && state.selected.isConnected ? (kindOf(state.selected)==='container' ? state.selected : state.selected.parentElement) : document.getElementById('screen'), el;
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
    panel.addEventListener('pointerdown', beginSelectionFrameDrag);
    panel.addEventListener('pointerdown', beginPanelDrag);
    document.addEventListener('pointermove', movePanelDrag, true);
    document.addEventListener('pointerup', endPanelDrag, true);
    document.addEventListener('pointercancel', endPanelDrag, true);
    panel.addEventListener('click', function (event) {
      var stepper=event.target.closest('[data-range-step]');
      if(stepper){var target=panel.querySelector('#'+stepper.getAttribute('data-range-target'));if(target){var min=Number(target.min)||0,max=Number(target.max)||100,step=Number(target.step)||1,next=Math.max(min,Math.min(max,Number(target.value)+Number(stepper.getAttribute('data-range-step'))*step));target.value=next;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));}return;}
      var choice=event.target.closest('[data-add-kind]');
      if(choice){addElement(choice.getAttribute('data-add-kind'));state.activeTool=null;render();return;}
      var tool = event.target.closest('[data-se-tool]');
      if (tool) { var tn=normalizeTool(tool.getAttribute('data-se-tool')); state.activeTool=(tn==='select'||tn==='cursor'?null:tn); render(); return; }
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
      var crumb = event.target.closest('[data-se-select-id]');
      if (crumb) { var crumbEl = getById(crumb.getAttribute('data-se-select-id')); if (crumbEl) select(crumbEl); return; }
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
    panel.addEventListener('input', function (event) {
      var input = event.target;
      if (input.matches('[data-style],[data-text-edit],[data-attr],[data-position-axis]')) liveEdit(input);
    });
    panel.addEventListener('change', function (event) {
      var input = event.target;
      if (!input.matches('[data-style],[data-text-edit],[data-attr],[data-position-axis]')) return;
      liveEdit(input);
      commitLiveEdit(input);
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
    var now = w.performance ? w.performance.now() : Date.now();
    if (state.suppressClickUntil && now < state.suppressClickUntil) { state.suppressClickUntil = 0; event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); return; }
    var hit = document.elementFromPoint ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
    var el = hit && hit.closest ? hit.closest('#app *') : null;
    if (!el) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    if (event.altKey && el.parentElement && el.parentElement !== app()) el = el.parentElement;
    select(el);
  }
  function hover(event) {
    if (!state.enabled || w.SahmEditorCore.isEditorNode(event.target)) return;
    var el = event.target.closest('#app *'); if (!el) return;
    if (state.hover && state.hover !== state.selected) state.hover.classList.remove('se-hover');
    state.hover = el; if (el !== state.selected) el.classList.add('se-hover');
  }
  function beginSelectionFrameDrag(event) {
    var handle = event.target.closest('[data-se-handle]'), el = state.selected;
    if (!handle || !el || !el.isConnected) return;
    var rect = el.getBoundingClientRect(), scale = Number(app().dataset.sePreviewScale) || 1;
    var parts = String(el.style.translate || '0px 0px').trim().split(/\s+/);
    var pointerAngle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
    state.frameDragging = {
      el: el, pointerId: event.pointerId, handle: handle.getAttribute('data-se-handle'),
      mode: handle.getAttribute('data-se-handle') === 'rotate' ? 'rotate' : (handle.getAttribute('data-se-handle') === 'move' ? 'move' : 'resize'),
      startX: event.clientX, startY: event.clientY, scale: scale,
      startWidth: el.offsetWidth || rect.width / scale, startHeight: el.offsetHeight || rect.height / scale,
      startTranslate: { x: parseFloat(parts[0]) || 0, y: parseFloat(parts[1]) || 0 },
      startRotate: parseFloat(el.style.rotate) || 0, centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2, pointerAngle: pointerAngle, before: transformSnapshot(el)
    };
    if (handle.setPointerCapture) try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault(); event.stopPropagation();
  }
  function moveSelectionFrameDrag(event) {
    var d = state.frameDragging;
    if (!d || d.pointerId !== event.pointerId) return;
    if (d.mode === 'rotate') {
      var angle = Math.atan2(event.clientY - d.centerY, event.clientX - d.centerX);
      var degrees = d.startRotate + (angle - d.pointerAngle) * 180 / Math.PI;
      degrees = ((degrees + 180) % 360 + 360) % 360 - 180;
      d.el.style.rotate = Math.round(degrees) + 'deg';
    } else if (d.mode === 'move') {
      var moveX = d.startTranslate.x + (event.clientX - d.startX) / d.scale;
      var moveY = d.startTranslate.y + (event.clientY - d.startY) / d.scale;
      d.el.style.translate = Math.round(moveX) + 'px ' + Math.round(moveY) + 'px';
    } else {
      var dx = (event.clientX - d.startX) / d.scale, dy = (event.clientY - d.startY) / d.scale;
      var west = d.handle.indexOf('w') !== -1, east = d.handle.indexOf('e') !== -1;
      var north = d.handle.indexOf('n') !== -1, south = d.handle.indexOf('s') !== -1;
      if (west || east) {
        var width = Math.max(12, Math.round(d.startWidth + (east ? dx : -dx)));
        d.el.style.width = width + 'px';
        if (west) d.el.style.translate = (d.startTranslate.x - (width - d.startWidth)) + 'px ' + d.startTranslate.y + 'px';
      }
      if (north || south) {
        var height = Math.max(12, Math.round(d.startHeight + (south ? dy : -dy)));
        d.el.style.height = height + 'px';
        if (north) {
          var current = String(d.el.style.translate || '0px 0px').trim().split(/\s+/);
          var x = parseFloat(current[0]) || 0;
          d.el.style.translate = x + 'px ' + (d.startTranslate.y - (height - d.startHeight)) + 'px';
        }
      }
    }
    scheduleSelectionFrame(); event.preventDefault();
  }
  function endSelectionFrameDrag(event) {
    var d = state.frameDragging;
    if (!d || d.pointerId !== event.pointerId) return;
    state.frameDragging = null;
    var after = transformSnapshot(d.el), before = d.before;
    if (before.width !== after.width || before.height !== after.height || before.translate !== after.translate || before.rotate !== after.rotate) {
      var meta = w.SahmEditorCore.identify(d.el), timestamp = new Date().toISOString(), operations = [];
      ['width','height','translate','rotate'].forEach(function (property) {
        if (before[property] === after[property]) return;
        operations.push({
          type: 'style.set', elementId: meta.id, screen: meta.screen, source: meta, timestamp: timestamp,
          property: property, before: before[property] || '', after: after[property] || ''
        });
      });
      if (operations.length) {
        state.history.pushGroup(operations,
          function () { applyTransformSnapshot(d.el, before); },
          function () { applyTransformSnapshot(d.el, after); });
        state.saved = false;
      }
    } else scheduleSelectionFrame();
  }
  function beginDrag(event) {
    if (!state.enabled || state.activeTool !== 'position' && state.activeTool !== 'transform' || !state.selected || event.target !== state.selected) return;
    if (event.target.closest('input,textarea,select')) return;
    var el=state.selected, parts=String(el.style.translate||'0px 0px').split(/\s+/);
    state.dragging={el:el,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:parseFloat(parts[0])||0,y:parseFloat(parts[1])||0,before:el.style.translate||''};
    if(el.setPointerCapture) try{el.setPointerCapture(event.pointerId);}catch(_){}
    event.preventDefault();
  }
  function moveDrag(event) {
    var d=state.dragging;if(!d||d.pointerId!==event.pointerId)return;
    var scale=Number(app().dataset.sePreviewScale)||1;var x=Math.round(d.x+(event.clientX-d.startX)/scale),y=Math.round(d.y+(event.clientY-d.startY)/scale);
    d.el.style.translate=x+'px '+y+'px';scheduleSelectionFrame();event.preventDefault();
  }
  function endDrag(event) {
    var d=state.dragging;if(!d||d.pointerId!==event.pointerId)return;
    state.dragging=null;var after=d.el.style.translate;
    if (after !== d.before) state.suppressClickUntil = (w.performance ? w.performance.now() : Date.now()) + 300;
    if(after!==d.before)record('style.set',d.el,{property:'translate',before:d.before,after:after},
      function(){if(d.before)d.el.style.translate=d.before;else d.el.style.removeProperty('translate');},
      function(){d.el.style.translate=after;});
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
      state.before = w.SahmEditorCore.capture(); state.history = w.SahmEditorCore.history(function (action) { if (action === 'push') refreshHistoryControls(); else render(); });
      state.selected = null; state.activeTool = null; state.saved = false; document.body.classList.add('sahm-editor-active'); preparePreview();
      panel.hidden = false; button.hidden = true; render();
      document.addEventListener('click', appClick, true); document.addEventListener('pointerover', hover, true); document.addEventListener('pointerdown', beginDrag, true); document.addEventListener('pointermove', moveDrag, true); document.addEventListener('pointermove', moveSelectionFrameDrag, true); document.addEventListener('pointerup', endDrag, true); document.addEventListener('pointerup', endSelectionFrameDrag, true); document.addEventListener('pointercancel', endDrag, true); document.addEventListener('pointercancel', endSelectionFrameDrag, true); document.addEventListener('scroll', scheduleSelectionFrame, true); w.addEventListener('resize', scheduleSelectionFrame); document.addEventListener('keydown', keys, true);
    } else {
      document.removeEventListener('click', appClick, true); document.removeEventListener('pointerover', hover, true); document.removeEventListener('pointerdown', beginDrag, true); document.removeEventListener('pointermove', moveDrag, true); document.removeEventListener('pointermove', moveSelectionFrameDrag, true); document.removeEventListener('pointerup', endDrag, true); document.removeEventListener('pointerup', endSelectionFrameDrag, true); document.removeEventListener('pointercancel', endDrag, true); document.removeEventListener('pointercancel', endSelectionFrameDrag, true); document.removeEventListener('scroll', scheduleSelectionFrame, true); w.removeEventListener('resize', scheduleSelectionFrame); document.removeEventListener('keydown', keys, true);
      if (state.selectionObserver) { state.selectionObserver.disconnect(); state.selectionObserver = null; }
      state.frameDragging = null; state.dragging = null; state.frameRaf = 0;
      restorePreview(); document.body.classList.remove('sahm-editor-active'); panel.hidden = true; button.hidden = !canShow();
      if (state.selected) state.selected.classList.remove('se-selected'); if (state.hover) state.hover.classList.remove('se-hover');
      state.selected = null; state.hover = null; state.activeTool = null;
    }
  }
  function init() {
    w.addEventListener('resize', applyPanelPosition);
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