/* SahmApp — the single binding path between the screens and SahmData/SahmCore.
   - Holds the one store instance (SahmData.load()) and the signed-in viewer id.
   - Every call injects (db, viewer) so screens never pass a user by hand and never touch db arrays.
   - Operations return the SahmData result untouched ({ok,...}); failures and unsaved state are reported
     once through onResult so every screen shows them the same way.
   - No calculation, status, eligibility or permission rule lives here: those stay in SahmCore/SahmData.
   Depends on window.SahmCore and window.SahmData (load them first). No DOM access. */
(function (root) {
  'use strict';
  var D = function () { return root.SahmData; };
  var db = null, listener = null;

  function init() { if (!db) db = D().load(); return db; }
  function store() { return init(); }
  function viewer() { return D().me(init()); }
  function onResult(fn) { listener = typeof fn === 'function' ? fn : null; }
  function report(name, r) {
    if (listener && r && (r.ok === false || r.persisted === false)) { try { listener(name, r); } catch (e) { /* UI listener must not break an operation */ } }
    return r;
  }

  /* operations: first argument after (db, actor) is passed through unchanged */
  var ACTOR_OPS = ['createGroup', 'updateGroup', 'addMember', 'addShares', 'removeShares', 'removeMember', 'setAttendance',
    'createInvite', 'cancelInvite', 'recordPaid', 'correctReceipt', 'sendReminder', 'performDraw', 'sendMessage',
    'setNotifyType', 'setMute', 'markChatRead', 'markNotificationsRead', 'joinByCode'];
  /* queries that take (db, viewer, ...) */
  var VIEW_QUERIES = ['groupDetail', 'installmentRows', 'memberStatement', 'receiptList', 'receiptDetail', 'eventLog',
    'memberList', 'inviteList', 'drawHistory', 'notificationList', 'chatView'];
  /* helpers that take (db, ...) with no viewer */
  var PLAIN = ['drawStatus', 'previewJoin', 'inviteSummary', 'getInviteInfo', 'lastReminder'];

  var api = { init: init, store: store, viewer: viewer, onResult: onResult };
  ACTOR_OPS.forEach(function (n) { api[n] = function () { var a = [init(), viewer()].concat([].slice.call(arguments)); return report(n, D()[n].apply(null, a)); }; });
  VIEW_QUERIES.forEach(function (n) { api[n] = function () { var a = [init(), viewer()].concat([].slice.call(arguments)); return D()[n].apply(null, a); }; });
  PLAIN.forEach(function (n) { api[n] = function () { var a = [init()].concat([].slice.call(arguments)); return D()[n].apply(null, a); }; });

  /* role-aware lists: a user can manage one association and participate in another */
  api.myGroups = function () { return D().myGroups(init(), viewer()); };
  api.roleOf = function (gid) { var g = D().group(init(), gid); return g ? D().roleOf(init(), g, viewer()) : null; };
  api.chatList = function () { return D().chatList(init()); };
  api.recentActivity = function (n) { return D().recentActivity(init(), n, viewer()); };
  api.unreadNotifications = function () { return D().totalUnreadNotifications(init()); };
  /* time-driven notices; call on app start and when the app returns to the foreground */
  api.tick = function () { return D().tick(init()); };
  api.storageState = function () { return D().storageState(); };
  api.takeNotices = function () { return D().takeNotices(); };

  /* account preferences live in db.prefs (not a second source of associations) */
  api.prefs = function () { return init().prefs; };
  api.savePrefs = function () { return report('savePrefs', D().save(init())); };
  api.nowAt = function (tz) { return D().nowAt(tz || D().TZ); };
  api.todayIn = function (tz) { return root.SahmCore.todayIn(tz || D().TZ); };
  api.chatTime = function (at, today) { return D().chatTime(at, today || root.SahmCore.todayIn(D().TZ)); };
  api.timeZone = function () { return D().TZ; };
  api.notifyTypes = function () { return D().NOTIFY_TYPES.slice(); };
  api.maxMessage = function () { return D().MAX_MSG; };

  root.SahmApp = api;
})(typeof window !== 'undefined' ? window : globalThis);
