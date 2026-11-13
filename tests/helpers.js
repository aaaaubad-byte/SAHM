'use strict';
/* Shared test helpers: fresh module instances, a fake localStorage, and a controllable clock. */
const path = require('path');
const ROOT = path.join(__dirname, '..');

function makeStorage(opts) {
  const map = new Map(); opts = opts || {};
  const st = {
    failWrites: false, failAll: false,
    getItem(k) { if (st.failAll) throw new Error('SecurityError'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (st.failAll || st.failWrites) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    keys() { return Array.from(map.keys()); },
    raw(k) { return map.get(k); },
    put(k, v) { map.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  };
  return st;
}
function loadModules() {
  delete require.cache[require.resolve(path.join(ROOT, 'sahm-core.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'sahm-data.js'))];
  require(path.join(ROOT, 'sahm-core.js'));
  require(path.join(ROOT, 'sahm-data.js'));
  return { K: globalThis.SahmCore, D: globalThis.SahmData };
}
/* fresh world with the default preview seed anchored at `now` */
function fresh(now) {
  const storage = makeStorage(); globalThis.localStorage = storage;
  const { K, D } = loadModules();
  const clock = { now: now || '2026-11-13T10:00' };
  D.setClock(() => clock.now);
  const db = D.load();
  return { K, D, db, storage, clock, ME: 'me' };
}
/* empty world (no preview data) — for rules tested in isolation */
function blank(now) {
  const w = fresh(now);
  ['groups', 'members', 'shares', 'receipts', 'draws', 'messages', 'events', 'notifications', 'reminders', 'invites', 'corrections'].forEach(k => { w.db[k].length = 0; });
  w.db.emitted = {}; w.db.chatReads = {};
  return w;
}
function setNow(w, iso) { w.clock.now = iso; }
function day(K, base, off) { return K.addDays(base, off); }

/* a standard group for rule tests: monthly (30d), 3 installments, 90,000 YER per share, manager "me" */
function makeGroup(w, over) {
  const input = Object.assign({
    name: 'جمعية الاختبار', currency: 'YER', cycleType: 'monthly', shareAmount: '90000', installments: 3, startDate: '2026-11-01',
    targetShares: 10, maxPerMember: 3, quorum: 60, rules: 'قواعد'
  }, over || {});
  const r = w.D.createGroup(w.db, 'me', input);
  if (!r.ok) throw new Error('makeGroup failed: ' + JSON.stringify(r));
  return w.db.groups.find(g => g.id === r.groupId);
}
module.exports = { fresh, blank, setNow, day, makeGroup, makeStorage, loadModules, ROOT };
