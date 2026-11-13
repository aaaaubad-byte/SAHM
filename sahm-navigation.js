/* Sahm navigation engine — browser history is the single source of truth.
   Route snapshots include the screen context needed to restore the exact previous view.
   Back/forward, tab changes and modal layers are handled through one history state model. */
(function (root) {
  'use strict';

  var VERSION = 1;

  function copy(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return Object.assign({}, value);
    return value;
  }

  function isState(value) {
    return !!value && value.__sahmNavigation === true && value.version === VERSION &&
      typeof value.screenName === 'string';
  }

  function create(options) {
    options = options || {};
    var win = options.window || root;
    var history = win.history;
    var onChange = typeof options.onChange === 'function' ? options.onChange : function () {};
    var onExternalPop = typeof options.onExternalPop === 'function' ? options.onExternalPop : function () {};
    var current = null;

    if (!history || typeof history.pushState !== 'function' ||
        typeof history.replaceState !== 'function' || typeof history.back !== 'function') {
      throw new TypeError('SahmNavigation requires the browser History API');
    }

    function href() {
      return win.location && typeof win.location.href === 'string' ? win.location.href : undefined;
    }

    function commit(method, state) {
      var url = href();
      if (url === undefined) history[method](state, '');
      else history[method](state, '', url);
    }

    function normalize(snapshot, depth, epoch, layer) {
      snapshot = snapshot || {};
      return {
        __sahmNavigation: true,
        version: VERSION,
        epoch: Number.isInteger(epoch) && epoch > 0 ? epoch : 1,
        depth: Number.isInteger(depth) && depth >= 0 ? depth : 0,
        layer: layer === 'modal' ? 'modal' : 'screen',
        screenName: String(snapshot.screenName || 'welcome'),
        params: copy(snapshot.params) || {},
        currentGroupId: snapshot.currentGroupId == null ? null : snapshot.currentGroupId,
        groupTab: snapshot.groupTab || 'all',
        groupDetailTab: snapshot.groupDetailTab || 'overview'
      };
    }

    function cloneCurrent() {
      return current ? normalize(current, current.depth, current.epoch, current.layer) : null;
    }

    function sameRoute(a, b) {
      return a.screenName === b.screenName &&
        JSON.stringify(a.params || {}) === JSON.stringify(b.params || {}) &&
        a.currentGroupId === b.currentGroupId &&
        a.groupTab === b.groupTab &&
        a.groupDetailTab === b.groupDetailTab;
    }

    function start(snapshot) {
      current = normalize(snapshot, 0, 1, 'screen');
      commit('replaceState', current);
      return cloneCurrent();
    }

    function navigate(snapshot) {
      if (!current) return start(snapshot);
      if (current.layer === 'modal') dismissModal();
      var next = normalize(snapshot, current.depth + 1, current.epoch, 'screen');
      if (sameRoute(current, next)) return cloneCurrent();
      commit('pushState', next);
      current = next;
      return cloneCurrent();
    }

    function replace(snapshot) {
      if (!current) return start(snapshot);
      var next = normalize(snapshot, current.depth, current.epoch, 'screen');
      commit('replaceState', next);
      current = next;
      return cloneCurrent();
    }

    /* Resets the app's in-app route depth after an authentication boundary.
       Older browser entries are neutralized when encountered, never restored. */
    function reset(snapshot) {
      var epoch = current ? current.epoch + 1 : 1;
      current = normalize(snapshot, 0, epoch, 'screen');
      commit('replaceState', current);
      return cloneCurrent();
    }

    function openModal() {
      if (!current || current.layer === 'modal') return false;
      var next = normalize(current, current.depth, current.epoch, 'modal');
      commit('pushState', next);
      current = next;
      return true;
    }

    /* Explicit close replaces the modal entry synchronously, avoiding a stale
       asynchronous popstate when the same action immediately navigates elsewhere. */
    function dismissModal() {
      if (!current || current.layer !== 'modal') return false;
      current = normalize(current, current.depth, current.epoch, 'screen');
      commit('replaceState', current);
      return true;
    }

    function back() {
      if (!current) return false;
      if (current.layer !== 'modal' && current.depth === 0) return false;
      history.back();
      return true;
    }

    function forward() {
      if (typeof history.forward !== 'function') return false;
      history.forward();
      return true;
    }

    function handlePop(event) {
      var next = event && event.state;
      if (!isState(next)) {
        onExternalPop(cloneCurrent());
        return;
      }

      if (current && next.epoch !== current.epoch) {
        /* Do not resurrect a screen from a previous login/logout flow. */
        commit('replaceState', current);
        return;
      }

      if (next.layer === 'modal') {
        /* A forward navigation to a formerly open modal cannot restore its
           transient content; normalize it to the underlying screen instead. */
        next = normalize(next, next.depth, next.epoch, 'screen');
        commit('replaceState', next);
      } else {
        next = normalize(next, next.depth, next.epoch, 'screen');
      }

      current = next;
      onChange(cloneCurrent(), 'popstate');
    }

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('popstate', handlePop);
    }

    return {
      start: start,
      navigate: navigate,
      replace: replace,
      reset: reset,
      openModal: openModal,
      dismissModal: dismissModal,
      back: back,
      forward: forward,
      current: cloneCurrent,
      destroy: function () {
        if (typeof win.removeEventListener === 'function') win.removeEventListener('popstate', handlePop);
      }
    };
  }

  var api = { VERSION: VERSION, create: create, isState: isState };
  root.SahmNavigation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
