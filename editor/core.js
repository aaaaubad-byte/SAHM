/* SAHM visual editor core: identity, snapshots, command history and local sessions. */
(function (w) {
  'use strict';
  var STYLE_KEYS = ['display','position','width','height','min-width','max-width','min-height','max-height','color','background-color','font-family','font-size','font-weight','line-height','letter-spacing','text-align','align-items','align-content','align-self','justify-content','justify-self','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','grid-template-columns','grid-auto-flow','gap','row-gap','column-gap','padding','margin','border','border-radius','opacity','overflow','overflow-x','overflow-y'];
  var SAFE_ATTRS = ['id','class','role','aria-label','aria-hidden','type','data-action','data-go','data-tab','placeholder'];
  function screen() {
    return w.history && w.history.state && w.history.state.screenName ? String(w.history.state.screenName) : 'unknown';
  }
  function hash(value) {
    var h = 2166136261;
    for (var i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function escCss(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function segment(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase(), action = el.getAttribute('data-action'), go = el.getAttribute('data-go');
    var aria = el.getAttribute('aria-label'), key = action ? '[data-action="' + escCss(action) + '"]' : go ? '[data-go="' + escCss(go) + '"]' : aria ? '[aria-label="' + escCss(aria) + '"]' : '';
    if (key) return tag + key;
    var cls = Array.prototype.filter.call(el.classList || [], function (x) { return x && !/^se-/.test(x); }).slice(0, 3);
    var base = tag + cls.map(function (x) { return '.' + x; }).join('');
    var p = el.parentElement;
    if (p) {
      var same = Array.prototype.filter.call(p.children, function (x) { return x.tagName === el.tagName && x.className === el.className; });
      if (same.length > 1) base += ':nth-of-type(' + (Array.prototype.indexOf.call(p.children, el) + 1) + ')';
    }
    return base;
  }
  function selector(el) {
    var parts = [], node = el;
    while (node && node.id !== 'app' && node.nodeType === 1) {
      parts.unshift(segment(node));
      if (node.parentElement && node.parentElement.id === 'app') break;
      node = node.parentElement;
    }
    return '#app > ' + parts.join(' > ');
  }
  function isEditorNode(el) { return !!(el && el.closest && el.closest('[data-sahm-editor-ui]')); }
  function identify(el) {
    if (!el || el.nodeType !== 1) return null;
    var route = screen(), loc = selector(el), id = el.getAttribute('data-sahm-editor-id');
    if (!id) { id = 'se-' + hash(route + '|' + loc); el.setAttribute('data-sahm-editor-id', id); }
    return {
      id: id, screen: route, tag: el.tagName.toLowerCase(), selector: loc,
      file: 'Sahm_Preview_ROLE_SEPARATION.html', sourceKind: 'rendered-dom',
      sourceHints: {
        htmlId: el.id || null, action: el.getAttribute('data-action'), route: el.getAttribute('data-go'),
        tab: el.getAttribute('data-tab'), classes: String(typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean)
      }
    };
  }
  function snapshotNode(el) {
    if (!el || el.nodeType !== 1 || isEditorNode(el)) return null;
    var identity = identify(el), attrs = {}, visual = {};
    SAFE_ATTRS.forEach(function (key) { var v = el.getAttribute(key); if (v !== null) attrs[key] = v; });
    try {
      var cs = w.getComputedStyle(el);
      STYLE_KEYS.forEach(function (key) { visual[key] = cs.getPropertyValue(key); });
    } catch (_) {}
    var children = [];
    Array.prototype.forEach.call(el.children || [], function (child) { var item = snapshotNode(child); if (item) children.push(item); });
    return { identity: identity, attributes: attrs, visual: visual, childCount: children.length, children: children };
  }
  function capture() {
    var app = w.document.getElementById('app');
    return { schemaVersion: 1, capturedAt: new Date().toISOString(), screen: screen(), tree: snapshotNode(app) };
  }
  function history(onChange) {
    var entries = [], cursor = 0;
    function notify(action) { if (typeof onChange === 'function') onChange(action, api); }
    var api = {
      push: function (entry, undo, redo) { entries = entries.slice(0, cursor); entries.push({ entry: entry, undo: undo, redo: redo }); cursor = entries.length; notify('push'); },
      pushGroup: function (batch, undo, redo) { if (!batch || !batch.length) return; entries = entries.slice(0, cursor); entries.push({ entry: batch.slice(), undo: undo, redo: redo }); cursor = entries.length; notify('push'); },
      undo: function () { if (!cursor) return false; entries[cursor - 1].undo(); cursor--; notify('undo'); return true; },
      redo: function () { if (cursor >= entries.length) return false; entries[cursor].redo(); cursor++; notify('redo'); return true; },
      canUndo: function () { return cursor > 0; }, canRedo: function () { return cursor < entries.length; },
      serialize: function () { return entries.slice(0, cursor).reduce(function (all, item) { return all.concat(Array.isArray(item.entry) ? item.entry : [item.entry]); }, []); },
      clear: function () { entries = []; cursor = 0; notify('clear'); }
    };
    return api;
  }
  var DB = 'sahm-visual-editor-v1', STORE = 'sessions', FALLBACK = 'sahm.editor.sessions.v1';
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!w.indexedDB) return reject(new Error('INDEXEDDB_UNAVAILABLE'));
      var request = w.indexedDB.open(DB, 1);
      request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function fallbackRead() { try { return JSON.parse(w.localStorage.getItem(FALLBACK) || '[]'); } catch (_) { return []; } }
  function saveSession(session) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(session);
        tx.oncomplete = function () { db.close(); resolve({ saved: true, storage: 'IndexedDB' }); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    }).catch(function () {
      var list = fallbackRead().filter(function (x) { return x.id !== session.id; }); list.unshift(session);
      try { w.localStorage.setItem(FALLBACK, JSON.stringify(list)); return { saved: true, storage: 'localStorage' }; }
      catch (_) { throw new Error('LOCAL_STORAGE_FULL'); }
    });
  }
  function listSessions() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly'), req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { db.close(); resolve((req.result || []).sort(function (a,b) { return b.createdAt.localeCompare(a.createdAt); })); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    }).catch(function () { return fallbackRead().sort(function (a,b) { return b.createdAt.localeCompare(a.createdAt); }); });
  }
  function createSession(before, operations) {
    var now = new Date(), id = 'SAHM-EDIT-' + now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 7), map = {};
    operations.forEach(function (op) { if (op.source) map[op.elementId] = op.source; });
    return {
      schemaVersion: 1, id: id, createdAt: now.toISOString(), status: 'local-draft',
      manifest: { application: 'SAHM', branch: 'SAHM-LAB', baseBranch: 'SAHM-SUPABASE', baseCommit: 'd21dae164461a5f763cb060c5971d69c53769d7b', screen: before.screen, sourceFile: 'Sahm_Preview_ROLE_SEPARATION.html' },
      before: before, after: capture(), operations: operations, componentMap: map, assets: [], screenshots: { before: null, after: null },
      notes: ['تُستبعد قيم حقول الإدخال والنصوص غير المعدلة من اللقطات البنيوية لتقليل احتمال حفظ بيانات المستخدمين.']
    };
  }
  function download(session) {
    var blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = w.document.createElement('a');
    a.href = url; a.download = session.id + '.json'; a.click(); w.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  w.SahmEditorCore = { screen: screen, identify: identify, selector: selector, isEditorNode: isEditorNode, capture: capture, history: history, saveSession: saveSession, listSessions: listSessions, createSession: createSession, download: download };
})(window);