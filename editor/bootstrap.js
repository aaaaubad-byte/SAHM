/* Embedded editor controller. Only the SAHM-LAB branch loads this module. */
(function (w) {
  'use strict';
  var state = { enabled: false, selected: null, before: null, history: null, hover: null, saved: false, lastSession: null, activeTool: null, dragging: null };
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
      click:'<path d="m9 9 5 12 2-5 5-2z"/><path d="M4 4 2 2M10 3V1M3 10H1"/>',
      copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m4 4v7m6-7v7"/>',
      more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      close:'<path d="m18 6-12 12M6 6l12 12"/>',
      check:'<path d="m5 12 4 4L19 6"/>'
    };
    return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.more)+'</svg>';
  }
  function normalizeTool(name) { return ({palette:'color',type:'text',move:'position',plus:'add',history:'sessions'}[name]||name); }
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
  function toolPanel() {
    var el=state.selected, kind=kindOf(el), t=normalizeTool(state.activeTool);
    if (!t || t==='select') return '';
    var h='<section class="se-tool-panel"><div class="se-tool-panel-head"><b>'+esc(({add:'إضافة عنصر',layers:'طبقات العناصر',sessions:'جلسات التحرير',text:'تحرير النص',color:'الألوان',font:'الخطوط',shadow:'الظلال',border:'الإطار والمسافات',position:'موقع العنصر',size:'الحجم والأبعاد',image:'إعدادات الصورة',click:'إعدادات العنصر',more:'أدوات إضافية'})[t]||'أداة التحرير')+'</b><button type="button" data-se-tool="select" aria-label="إغلاق">'+icon('close')+'</button></div><div class="se-tool-panel-body">';
    if (t==='add') {
      h+='<div class="se-element-grid">'+[['text','نص','type'],['heading','عنوان','type'],['button','زر','click'],['card','بطاقة','layers'],['image','صورة','image'],['divider','فاصل','border']].map(function(x){return '<button type="button" class="se-element-choice" data-add-kind="'+x[0]+'">'+icon(x[2])+'<span>'+x[1]+'</span></button>';}).join('')+'</div><div class="se-add-note">سيُضاف العنصر إلى الشاشة الحالية ويمكنك تعديله مباشرة.</div>';
    } else if (t==='layers') {
      h+=w.SahmEditorLayers.render(app(),el);
    } else if (t==='sessions') {
      h+='<div class="se-empty">الجلسات المحفوظة محلياً والمتزامنة مع الفرع.</div><div id="se-session-list"></div>';
    } else if (!el) {
      h+='<div class="se-empty">حدد عنصراً من شاشة المعاينة أولاً.</div>';
    } else if (t==='text') {
      h+='<label class="se-field"><span>النص الظاهر</span><textarea data-text-edit rows="3">'+esc(el.textContent||'')+'</textarea></label><label class="se-check"><input id="se-confirm-static-text" type="checkbox"> أؤكد أن النص ثابت وليس بيانات مستخدم</label>';
    } else if (t==='color') {
      h+='<label class="se-field"><span>لون النص</span><input type="color" data-style="color" value="#182b4d"></label><label class="se-field"><span>لون الخلفية</span><input type="color" data-style="background-color" value="#ffffff"></label>';
    } else if (t==='font') {
      h+='<label class="se-field"><span>عائلة الخط</span><input data-style="font-family" value="'+esc(valueOf(el,'font-family','IBM Plex Sans Arabic'))+'"></label><label class="se-field"><span>حجم الخط</span><input data-style="font-size" value="'+esc(valueOf(el,'font-size','14px'))+'"></label><label class="se-field"><span>سماكة الخط</span><select data-style="font-weight"><option value="400">عادي</option><option value="500">متوسط</option><option value="600">شبه عريض</option><option value="700">عريض</option></select></label><label class="se-field"><span>محاذاة النص</span><select data-style="text-align"><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></label>';
    } else if (t==='shadow') {
      h+='<label class="se-field"><span>ظل العنصر</span><input data-style="box-shadow" placeholder="0 4px 12px #0002" value="'+esc(el.style.boxShadow||'')+'"></label><label class="se-field"><span>ظل النص</span><input data-style="text-shadow" placeholder="0 1px 2px #0003" value="'+esc(el.style.textShadow||'')+'"></label>';
    } else if (t==='border') {
      h+='<label class="se-field"><span>الإطار</span><input data-style="border" placeholder="1px solid #ddd" value="'+esc(el.style.border||'')+'"></label><label class="se-field"><span>استدارة الزوايا</span><input data-style="border-radius" value="'+esc(valueOf(el,'border-radius','8px'))+'"></label><label class="se-field"><span>الحشوة الداخلية</span><input data-style="padding" value="'+esc(valueOf(el,'padding','0px'))+'"></label>';
    } else if (t==='position') {
      var tr=String(el.style.translate||'0px 0px').split(/\s+/),tx=parseFloat(tr[0])||0,ty=parseFloat(tr[1])||0;
      h+='<div class="se-axis"><label><span>أفقي X</span><b>'+tx+' px</b></label><input type="range" min="-180" max="180" step="1" data-position-axis="x" value="'+tx+'"></div><div class="se-axis"><label><span>عمودي Y</span><b>'+ty+' px</b></label><input type="range" min="-240" max="240" step="1" data-position-axis="y" value="'+ty+'"></div><div class="se-hint">يمكنك أيضاً سحب العنصر مباشرة داخل شاشة الهاتف بعد تفعيل أداة الموقع.</div>';
    } else if (t==='size') {
      h+='<label class="se-field"><span>العرض</span><input data-style="width" value="'+esc(el.style.width||'')+'" placeholder="auto أو 100%"></label><label class="se-field"><span>الارتفاع</span><input data-style="height" value="'+esc(el.style.height||'')+'" placeholder="auto"></label><label class="se-field"><span>الشفافية</span><input data-style="opacity" value="'+esc(valueOf(el,'opacity','1'))+'"></label>';
    } else if (t==='image' && kind==='image') {
      h+='<label class="se-field"><span>مصدر الصورة</span><input type="url" data-attr="src" value="'+esc(el.getAttribute('src')||'')+'"></label><label class="se-field"><span>النص البديل</span><input data-attr="alt" value="'+esc(el.getAttribute('alt')||'')+'"></label><label class="se-field"><span>طريقة الملاءمة</span><select data-style="object-fit"><option>contain</option><option>cover</option><option>fill</option><option>none</option></select></label>';
    } else if (t==='click') {
      h+='<div class="se-hint">هذا العنصر يحتفظ بسلوكه الأصلي. لا يتم إنشاء إجراء جديد أو تغيير ربطه الوظيفي من المحرر المرئي.</div>';
    } else if (t==='more') {
      h+='<div class="se-more-actions"><button data-se-action="duplicate">'+icon('copy')+' نسخ العنصر</button><button data-se-action="delete">'+icon('trash')+' حذف العنصر</button><button data-se-tool="layers">'+icon('layers')+' ترتيب الطبقات</button></div>';
    }
    h+='</div></section>'; return h;
  }
  function render() {
    if (!state.enabled) return;
    var selected=state.selected, history=state.history, kind=kindOf(selected);
    var tools=selected ? (
      toolButton('plus','العناصر')+(kind==='text' ? toolButton('type','النص') : '')+
      toolButton('palette','اللون')+toolButton('font','الخط')+toolButton('shadow','الظلال')+
      toolButton('border','الإطار')+toolButton('move','الموقع')+toolButton('size','الحجم')+
      (kind==='image'?toolButton('image','الصورة'):'')+
      (kind==='button'?toolButton('click','السلوك'):'')+toolButton('more','المزيد')
    ) : (
      toolButton('cursor','تحديد')+toolButton('plus','العناصر')+toolButton('layers','الطبقات')+
      actionButton('undo','تراجع')+actionButton('redo','إعادة')+toolButton('history','الجلسات')+actionButton('save','حفظ')
    );
    var html='<div class="se-topbar"><div class="se-brand"><b>سهم</b><small>محرر الواجهة</small></div><div class="se-top-actions"><button data-se-action="undo" '+(!history.canUndo()?'disabled':'')+' title="تراجع">'+icon('undo')+'</button><button data-se-action="redo" '+(!history.canRedo()?'disabled':'')+' title="إعادة">'+icon('redo')+'</button><button data-se-action="save" title="حفظ الجلسة">'+icon('save')+'</button><button data-se-action="exit" title="إغلاق المحرر">'+icon('close')+'</button></div></div>';
    html+=toolPanel();
    html+='<div class="se-dock-wrap"><div class="se-context-label">'+(selected?'العنصر المحدد: '+esc(selected.tagName.toLowerCase()):'أدوات المحرر')+'</div><nav class="se-dock" aria-label="أدوات التحرير">'+tools+'</nav><div id="sahm-editor-status" class="se-status">حدد عنصراً من المعاينة لعرض أدواته الخاصة.</div></div>';
    document.getElementById('sahm-editor-panel').innerHTML=html;
    if(state.activeTool==='sessions') w.SahmEditorCore.listSessions().then(renderSessions);
  }
  function select(el) {
    if (!el || el === app() || w.SahmEditorCore.isEditorNode(el)) return;
    if (state.selected) state.selected.classList.remove('se-selected');
    state.selected = el; state.activeTool = null; w.SahmEditorCore.identify(el); el.classList.add('se-selected'); render();
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
      else if (input.matches('[data-position-axis]') && state.selected) { var parts=String(state.selected.style.translate||'0px 0px').split(/\s+/),x=parseFloat(parts[0])||0,y=parseFloat(parts[1])||0; if(input.getAttribute('data-position-axis')==='x')x=Number(input.value);else y=Number(input.value); setStyle(state.selected,'translate',x+'px '+y+'px'); }
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
  function beginDrag(event) {
    if (!state.enabled || state.activeTool !== 'position' || !state.selected || !state.selected.contains(event.target)) return;
    if (event.target.closest('input,button,textarea,select')) return;
    var el=state.selected, parts=String(el.style.translate||'0px 0px').split(/\s+/);
    state.dragging={el:el,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:parseFloat(parts[0])||0,y:parseFloat(parts[1])||0,before:el.style.translate||''};
    if(el.setPointerCapture) try{el.setPointerCapture(event.pointerId);}catch(_){}
    event.preventDefault();
  }
  function moveDrag(event) {
    var d=state.dragging;if(!d||d.pointerId!==event.pointerId)return;
    var scale=Number(app().dataset.sePreviewScale)||1;var x=Math.round(d.x+(event.clientX-d.startX)/scale),y=Math.round(d.y+(event.clientY-d.startY)/scale);
    d.el.style.translate=x+'px '+y+'px';event.preventDefault();
  }
  function endDrag(event) {
    var d=state.dragging;if(!d||d.pointerId!==event.pointerId)return;
    state.dragging=null;var after=d.el.style.translate;
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
      state.before = w.SahmEditorCore.capture(); state.history = w.SahmEditorCore.history(render);
      state.selected = null; state.activeTool = null; state.saved = false; document.body.classList.add('sahm-editor-active'); preparePreview();
      panel.hidden = false; button.hidden = true; render();
      document.addEventListener('click', appClick, true); document.addEventListener('pointerover', hover, true); document.addEventListener('pointerdown', beginDrag, true); document.addEventListener('pointermove', moveDrag, true); document.addEventListener('pointerup', endDrag, true); document.addEventListener('pointercancel', endDrag, true); document.addEventListener('keydown', keys, true);
    } else {
      document.removeEventListener('click', appClick, true); document.removeEventListener('pointerover', hover, true); document.removeEventListener('pointerdown', beginDrag, true); document.removeEventListener('pointermove', moveDrag, true); document.removeEventListener('pointerup', endDrag, true); document.removeEventListener('pointercancel', endDrag, true); document.removeEventListener('keydown', keys, true);
      restorePreview(); document.body.classList.remove('sahm-editor-active'); panel.hidden = true; button.hidden = !canShow();
      if (state.selected) state.selected.classList.remove('se-selected'); if (state.hover) state.hover.classList.remove('se-hover');
      state.selected = null; state.hover = null; state.activeTool = null;
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