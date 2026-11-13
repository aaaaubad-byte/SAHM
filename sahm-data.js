/* SAHM data layer — the single source of truth for the preview: versioned store, atomic operations,
   permissions, audit trail, notifications, chat, and read-side queries for manager and participant.
   Depends on window.SahmCore. No DOM access. Every mutating operation:
     - takes the acting user id explicitly (permissions are enforced here, never by hiding buttons),
     - runs inside a transaction (all-or-nothing, rolled back on any failed rule),
     - returns { ok:true, ... } or { ok:false, code, message, ... } and never throws to the caller,
     - persists through save() and reports persisted:false when browser storage is unavailable.
   The contract is documented in docs/SAHM_ENGINE_DATA_CONTRACT_AR.md. */
(function (root) {
  'use strict';
  var C = function () { return root.SahmCore; };
  var TZ = 'Asia/Aden';
  var DATA_VERSION = 'sahm-data-2026-11-v4';
  var DATA_KEY = 'sahm_preview_data_v4';
  var PREV_DATA = [{ key: 'sahm_preview_data_v3', version: 'sahm-data-2026-11-v3' }];
  var PREFS_KEY = 'sahm_preview_prefs_v1';
  var LEGACY_KEYS = ['sahm_preview_db'];
  var ARCHIVE_KEY = 'sahm_archive_v1';
  var MAX_MSG = 50;
  var DRAW_SOON_DAYS = 3;
  var REMINDER_REPEAT_HOURS = 6;
  var PRIVACY_NOTE = 'قد تظهر لبقية أعضاء الجمعية أحداث مثل تسجيل الأقساط ونتائج القرعة داخل محادثة الجمعية، بحسب إعدادات المدير.';
  var LOCAL_PREVIEW_NOTE = 'هذه معاينة محلية: لا تستقبل أموالًا ولا تتحقق من البنوك، ولا تزامن بين الأجهزة ولا ترسل إشعارات Push حقيقية.';

  /* ---------- notification types the manager can publish into the group chat ---------- */
  var NOTIFY_TYPES = [
    { id: 'received', label: 'تسجيل استلام قسط', hint: 'عند تسجيل المدير استلام قسط عضو' },
    { id: 'completed', label: 'إكمال عضو لأقساط الدورة', hint: 'عندما يكمل عضو جميع أقساط الدورة' },
    { id: 'late', label: 'تأخر عضو عن قسط', hint: 'عند انتهاء فترة قسط دون تسجيل استلامه' },
    { id: 'drawSoon', label: 'قرب موعد القرعة', hint: 'قبل موعد القرعة بأيام' },
    { id: 'drawDue', label: 'حلول موعد القرعة', hint: 'في يوم القرعة' },
    { id: 'drawResult', label: 'نتيجة القرعة والفائز', hint: 'عند تثبيت نتيجة الجولة' },
    { id: 'joined', label: 'انضمام عضو جديد', hint: 'عند اعتماد عضو أو سهم جديد' },
    { id: 'motivate', label: 'رسائل تشجيعية', hint: 'تحفيز على الالتزام والاستمرار' }
  ];
  var DEFAULT_NOTIFY = { received: 1, completed: 1, late: 1, drawSoon: 1, drawDue: 1, drawResult: 1, joined: 0, motivate: 0 };
  var TPL = {
    received: function (v) { return 'سجّل مدير الجمعية استلام القسط رقم ' + v.no + ' من ' + v.of + ' للعضو ' + v.name; },
    completed: function (v) { return 'أكمل ' + v.name + ' جميع أقساط الدورة ' + v.cycle + '. جزاه الله خيرًا'; },
    late: function (v) { return 'تأخر ' + v.name + ' عن القسط رقم ' + v.no + ' من الدورة ' + v.cycle; },
    drawSoon: function (v) { return 'تقترب قرعة الجولة ' + v.round + '، وموعدها ' + v.date; },
    drawDue: function (v) { return 'حلّ اليوم موعد قرعة الجولة ' + v.round; },
    drawResult: function (v) { return 'نتيجة قرعة الجولة ' + v.round + ': فاز ' + v.label + ' بجائزة ' + v.prize; },
    joined: function (v) {
      if (v.added) return 'أضيف إلى ' + v.name + ' ' + v.added + ' ' + (v.added === 1 ? 'سهم' : 'أسهم');
      return 'انضم ' + v.name + ' إلى الجمعية بـ ' + v.shares + ' ' + (v.shares === 1 ? 'سهم' : 'أسهم');
    },
    motivate: function (v) { return v.text; }
  };

  /* ---------- time helpers (the clock can be replaced in tests) ---------- */
  var clockFn = null;
  function setClock(fn) { clockFn = typeof fn === 'function' ? fn : null; }
  function nowAt(tz) {
    if (clockFn) return clockFn();
    try {
      var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
    } catch (e) { return new Date().toISOString().slice(0, 16); }
  }
  function chatTime(at, today) {
    var d = at.slice(0, 10), diff = C().diffDays(today, d);
    if (diff <= 0) return at.slice(11, 16);
    if (diff === 1) return 'أمس';
    return C().fmtDate(d, { day: 'numeric', month: 'numeric', year: undefined });
  }
  function hoursBetween(a, b) { /* a,b = YYYY-MM-DDTHH:MM, a <= b */
    var K = C(), da = K.toDay(a.slice(0, 10)), db_ = K.toDay(b.slice(0, 10));
    var ma = Number(a.slice(11, 13)) * 60 + Number(a.slice(14, 16)), mb = Number(b.slice(11, 13)) * 60 + Number(b.slice(14, 16));
    return ((db_ - da) * 1440 + (mb - ma)) / 60;
  }
  function addMin(hm, n) { var p = hm.split(':').map(Number), t = p[0] * 60 + p[1] + n; return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function msgLength(text) { return Array.from(String(text == null ? '' : text)).length; }

  /* ---------- results and errors ---------- */
  function fail(code, message, extra) { var r = { ok: false, code: code, message: message }; if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return r; }
  function E(code, message, extra) { var e = new Error(message); e.sahm = { code: code, message: message, extra: extra }; return e; }

  /* ---------- message / event creation (single place used by seed and by actions) ---------- */
  function nextId(db, p) { db.seq = (db.seq || 0) + 1; return p + '-' + db.seq; }
  function postSystem(db, g, type, vars, at) {
    if (!g.notify[type]) return null;
    var m = { id: nextId(db, 'msg'), groupId: g.id, kind: 'system', senderName: 'سهم', senderId: 'sahm-system', type: type, text: TPL[type](vars), at: at };
    db.messages.push(m); return m;
  }
  function postMember(db, g, senderName, userId, text, at) {
    var m = { id: nextId(db, 'msg'), groupId: g.id, kind: 'member', senderName: senderName, userId: userId || null, text: text, at: at };
    db.messages.push(m); return m;
  }
  /* audit trail: vis = 'group' (everyone in the association) | 'private' (manager + the affected member) | 'manager' */
  function logEvent(db, g, type, text, o) {
    o = o || {};
    var e = { id: nextId(db, 'ev'), groupId: g.id, at: o.at || nowAt(g.tz), type: type, text: text, actor: o.actor || null,
      memberId: o.memberId || null, vis: o.vis || 'group', data: o.data || null };
    db.events.unshift(e); return e;
  }

  /* ---------- seed ---------- */
  function buildSeed(anchor) {
    var K = C(), db = {
      version: DATA_VERSION, seededOn: anchor, seq: 0,
      groups: [], members: [], shares: [], receipts: [], draws: [], messages: [], events: [],
      notifications: [], chatReads: {}, reminders: [], invites: [], corrections: [], emitted: {}, meta: { createdAt: anchor, migrations: [] }
    };
    function at(off, hm) { return K.addDays(anchor, off) + 'T' + hm; }

    var specs = [
      { id: 'g1', name: 'جمعية الأهل', tone: 'blue', manager: 'me', cycleType: 'monthly', installments: 2, shareAmount: 6000000, currency: 'YER',
        startOff: -54, maxPer: 3, target: 10, quorum: 66, created: -62,
        rules: 'الالتزام بسداد القسط خلال فترته، وتبليغ المدير عند أي ظرف، وحضور القرعة أو توكيل من ينوب.',
        notify: { received: 1, completed: 1, late: 1, drawSoon: 1, drawDue: 1, drawResult: 1, joined: 0, motivate: 1 },
        members: [
          { name: 'أحمد محمد', me: 1, shares: 2, join: -60, present: 1 },
          { name: 'سارة أحمد', shares: 2, join: -60, present: 1 },
          { name: 'خالد عبدالله', shares: 1, join: -59, present: 1 },
          { name: 'مروان علي', shares: 2, join: -58, present: 1 },
          { name: 'ريم صالح', shares: 1, join: -58, present: 1 },
          { name: 'نبيل سالم', shares: 1, join: -57, present: 0 },
          { name: 'هدى ياسين', shares: 1, join: -57, present: 0 }
        ],
        unpaid: { 'ريم صالح': [[1, 2], [2, 2]], 'نبيل سالم': [[2, 1], [2, 2]], 'هدى ياسين': [[2, 1], [2, 2]], 'مروان علي': [[2, 2]] },
        draws: [{ round: 1, member: 'خالد عبدالله', no: 1 }],
        talk: [[-40, '19:10', 'سارة أحمد', 'مبارك للفائز بالجولة الأولى'], [-3, '20:25', 'خالد عبدالله', 'جزاكم الله خيرًا على التنظيم'], [-2, '09:40', 'me', 'من لديه ظرف فليبلغني قبل نهاية الفترة'], [-1, '21:05', 'مروان علي', 'سأسدد القسط غدًا إن شاء الله']],
        reads: 2 },
      { id: 'g2', name: 'زملاء العمل', tone: 'gold', manager: 'ياسر الحداد', cycleType: 'weekly', installments: 1, shareAmount: 30000, currency: 'SAR',
        startOff: -19, maxPer: 2, target: 8, quorum: 60, created: -26,
        rules: 'القسط أسبوعي ويسدَّد خلال الأسبوع، ولا يحق لمن تأخر المطالبة بتأجيل القرعة.',
        notify: { received: 1, completed: 0, late: 1, drawSoon: 1, drawDue: 1, drawResult: 1, joined: 0, motivate: 0 },
        members: [
          { name: 'أحمد محمد', me: 1, shares: 1, join: -25, present: 1 },
          { name: 'عمر الشامي', shares: 1, join: -25, present: 1 },
          { name: 'لينا القاضي', shares: 2, join: -24, present: 1 },
          { name: 'فيصل النهاري', shares: 1, join: -24, present: 0 },
          { name: 'منى العريقي', shares: 1, join: -23, present: 1 },
          { name: 'بسام الوصابي', shares: 1, join: -23, present: 1 },
          { name: 'رنا الأهدل', shares: 1, join: -22, present: 1 }
        ],
        unpaid: { 'أحمد محمد': [[3, 1]], 'عمر الشامي': [[3, 1]], 'بسام الوصابي': [[3, 1]], 'فيصل النهاري': [[2, 1], [3, 1]] },
        draws: [{ round: 1, member: 'لينا القاضي', no: 2 }, { round: 2, member: 'عمر الشامي', no: 1 }],
        talk: [[-6, '18:30', 'لينا القاضي', 'الحمد لله، شكرًا للجميع'], [-2, '12:15', 'عمر الشامي', 'تذكير: القرعة يوم السبت']],
        reads: 1 },
      { id: 'g3', name: 'جمعية الجيران', tone: 'dark', manager: 'me', cycleType: 'custom', cycleDays: 15, installments: 3, shareAmount: 9000, currency: 'USD',
        startOff: 7, maxPer: 2, target: 8, quorum: 66, created: -9,
        rules: 'الدورة خمسة عشر يومًا بثلاثة أقساط، ويُغلق باب الانضمام عند أول قرعة.',
        notify: { received: 1, completed: 1, late: 1, drawSoon: 1, drawDue: 1, drawResult: 1, joined: 1, motivate: 0 },
        members: [
          { name: 'رشاد الصلوي', shares: 1, join: -8, present: 0 },
          { name: 'نجلاء الحميري', shares: 2, join: -7, present: 0 },
          { name: 'وليد القدسي', shares: 1, join: -6, present: 0 },
          { name: 'ابتسام الصبري', shares: 1, join: -4, present: 0 },
          { name: 'زيد المخلافي', shares: 1, join: -2, present: 0 }
        ],
        unpaid: {}, draws: [],
        talk: [[-5, '17:20', 'رشاد الصلوي', 'متى تبدأ الجمعية رسميًا؟'], [-5, '17:45', 'me', 'تبدأ بإذن الله بعد أسبوع']],
        reads: 0 },
      { id: 'g4', name: 'جمعية الأصدقاء', tone: 'blue', manager: 'me', cycleType: 'weekly', installments: 2, shareAmount: 4000000, currency: 'YER',
        startOff: -4, maxPer: 2, target: 6, quorum: 66, created: -12,
        rules: 'القسط الأول خلال الأيام الثلاثة الأولى من الأسبوع، والثاني في بقية الأسبوع.',
        notify: { received: 1, completed: 1, late: 1, drawSoon: 1, drawDue: 1, drawResult: 1, joined: 1, motivate: 1 },
        members: [
          { name: 'أحمد محمد', me: 1, shares: 1, join: -11, present: 1 },
          { name: 'مها الأكوع', shares: 1, join: -10, present: 1 },
          { name: 'فهد البعداني', shares: 1, join: -9, present: 1 },
          { name: 'جلال المقطري', shares: 1, join: -1, present: 0 },
          { name: 'ريما العديني', shares: 1, join: -8, present: 1 },
          { name: 'سامي الشرعبي', shares: 1, join: -8, present: 0 }
        ],
        unpaid: { 'جلال المقطري': [[1, 1], [1, 2]], 'مها الأكوع': [[1, 1], [1, 2]], 'فهد البعداني': [[1, 2]], 'أحمد محمد': [[1, 2]] },
        draws: [],
        talk: [[-3, '22:00', 'ريما العديني', 'بداية موفقة للجميع'], [-1, '11:30', 'جلال المقطري', 'سأسدد القسط الأول اليوم']],
        reads: 3 }
    ];

    specs.forEach(function (sp) {
      var g = {
        id: sp.id, name: sp.name, tone: sp.tone, currency: sp.currency, tz: TZ, cycleType: sp.cycleType, cycleDays: sp.cycleDays || null,
        installments: sp.installments, shareAmount: sp.shareAmount, startDate: K.addDays(anchor, sp.startOff), createdOn: K.addDays(anchor, sp.created),
        maxPerMember: sp.maxPer, targetShares: sp.target, quorum: sp.quorum, rules: sp.rules, notify: {},
        managerUserId: sp.manager === 'me' ? 'me' : null, managerName: sp.manager === 'me' ? 'أحمد محمد' : sp.manager,
        inviteCode: 'SAHM-' + sp.id.toUpperCase() + '-' + (7310 + sp.id.charCodeAt(1)), inviteOpensOn: K.addDays(anchor, sp.created)
      };
      NOTIFY_TYPES.forEach(function (t) { g.notify[t.id] = !!sp.notify[t.id]; });
      db.groups.push(g);
      var byName = {};
      sp.members.forEach(function (ms, i) {
        var m = { id: 'm-' + sp.id + '-' + (i + 1), groupId: g.id, name: ms.name, userId: ms.me ? 'me' : null, isManager: !!(ms.me && g.managerUserId === 'me'),
          joinedAt: K.addDays(anchor, ms.join), present: !!ms.present };
        db.members.push(m); byName[ms.name] = m;
        for (var n = 1; n <= ms.shares; n++) db.shares.push({ id: 's-' + sp.id + '-' + (i + 1) + '-' + n, groupId: g.id, memberId: m.id, no: n });
        db.events.push({ id: nextId(db, 'ev'), groupId: g.id, at: K.addDays(anchor, ms.join) + 'T08:30', type: 'join', text: 'انضم ' + ms.name + ' بـ ' + ms.shares + ' ' + (ms.shares === 1 ? 'سهم' : 'أسهم') });
        if (g.notify.joined && !ms.me) postSystem(db, g, 'joined', { name: ms.name, shares: ms.shares }, K.addDays(anchor, ms.join) + 'T08:30');
      });
      var total = db.shares.filter(function (s) { return s.groupId === g.id; }).length;
      var amounts = K.shareAmounts(g), cyc = K.currentCycle(g, anchor, total);

      /* receipts: every non-upcoming installment is paid unless listed as unpaid */
      sp.members.forEach(function (ms) {
        var m = byName[ms.name], owned = db.shares.filter(function (s) { return s.memberId === m.id; });
        var skip = sp.unpaid[ms.name] || [];
        for (var c = 1; c <= cyc; c++) {
          var doneAt = null;
          for (var k = 1; k <= g.installments; k++) {
            var r = K.instRange(g, c, k);
            if (r.start > K.addDays(anchor, -1)) continue;
            if (r.end < m.joinedAt) continue;
            if (skip.some(function (x) { return x[0] === c && x[1] === k; })) continue;
            var d = r.start > m.joinedAt ? K.addDays(r.start, 1) : m.joinedAt;
            if (d > r.end) d = r.end;
            if (d > K.addDays(anchor, -1)) d = K.addDays(anchor, -1);
            var stamp = d + 'T1' + ((k + c) % 8) + ':' + (10 + (m.id.length * 7 + k * 11) % 40);
            var rec = { id: nextId(db, 'rc'), groupId: g.id, memberId: m.id, cycle: c, no: k, shareIds: owned.map(function (s) { return s.id; }),
              amount: amounts[k - 1] * owned.length, currency: g.currency, recordedAt: stamp, recordedBy: g.managerUserId === 'me' ? 'me' : g.managerName, self: !!(ms.me && g.managerUserId === 'me') };
            db.receipts.push(rec); doneAt = stamp;
            db.events.push({ id: nextId(db, 'ev'), groupId: g.id, at: stamp, type: 'receipt', memberId: m.id, text: 'تسجيل استلام القسط رقم ' + k + ' من ' + g.installments + ' للعضو ' + m.name });
            postSystem(db, g, 'received', { no: k, of: g.installments, name: m.name }, stamp);
          }
          var mine = db.receipts.filter(function (x) { return x.memberId === m.id && x.cycle === c; });
          if (mine.length === g.installments && doneAt) postSystem(db, g, 'completed', { name: m.name, cycle: c }, doneAt.slice(0, 11) + addMin(doneAt.slice(11), 1));
        }
        /* late notices for finished, unpaid periods (not caused by late joining) */
        for (var c2 = 1; c2 <= cyc; c2++) for (var k2 = 1; k2 <= g.installments; k2++) {
          var r2 = K.instRange(g, c2, k2);
          if (r2.end >= anchor || r2.end < m.joinedAt) continue;
          var paid = db.receipts.some(function (x) { return x.memberId === m.id && x.cycle === c2 && x.no === k2; });
          if (!paid) { postSystem(db, g, 'late', { name: m.name, no: k2, cycle: c2 }, K.addDays(r2.end, 1) + 'T09:00'); db.emitted['late:' + g.id + ':' + m.id + ':' + c2 + ':' + k2] = 1; }
        }
      });

      /* lottery rounds */
      sp.draws.forEach(function (dr) {
        var m = byName[dr.member], sh = db.shares.find(function (s) { return s.memberId === m.id && s.no === dr.no; });
        var date = K.roundDate(g, dr.round);
        db.draws.push({ id: nextId(db, 'dr'), groupId: g.id, round: dr.round, date: date, winnerShareId: sh.id, shareCount: total, prize: K.prizeTarget(g, total) });
        db.events.push({ id: nextId(db, 'ev'), groupId: g.id, at: date + 'T12:00', type: 'draw', text: 'قرعة الجولة ' + dr.round + ' — الفائز ' + m.name });
        postSystem(db, g, 'drawDue', { round: dr.round }, date + 'T09:00'); db.emitted['drawDue:' + g.id + ':' + dr.round] = 1; db.emitted['drawSoon:' + g.id + ':' + dr.round] = 1;
        postSystem(db, g, 'drawResult', { round: dr.round, label: K.shareLabel(db, sh), prize: K.fmtMoney(K.prizeTarget(g, total), g.currency) }, date + 'T12:05');
      });
      var nextRound = sp.draws.length + 1;
      if (nextRound <= total && g.startDate <= anchor) {
        var nd = K.roundDate(g, nextRound);
        if (K.addDays(nd, -DRAW_SOON_DAYS) <= K.addDays(anchor, -1)) { postSystem(db, g, 'drawSoon', { round: nextRound, date: K.fmtDate(nd) }, K.addDays(nd, -DRAW_SOON_DAYS) + 'T09:00'); db.emitted['drawSoon:' + g.id + ':' + nextRound] = 1; }
      }
      if (sp.id === 'g1') postSystem(db, g, 'motivate', { text: 'الاستمرار في الالتزام يحفظ حق الجميع. بارك الله فيكم' }, at(-5, '10:00'));
      if (sp.id === 'g4') postSystem(db, g, 'motivate', { text: 'أسبوع جديد وبداية طيبة. نسأل الله التوفيق للجميع' }, at(-4, '09:30'));
      sp.talk.forEach(function (t) {
        var isMe = t[2] === 'me';
        if (t[3].length > MAX_MSG) throw new Error('seed message exceeds limit: ' + t[3]);
        postMember(db, g, isMe ? 'أحمد محمد' : t[2], isMe ? 'me' : null, t[3], at(t[0], t[1]));
      });
    });

    db.messages.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });
    db.events.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    specs.forEach(function (sp) {
      var list = db.messages.filter(function (m) { return m.groupId === sp.id; });
      var idx = Math.max(-1, list.length - 1 - sp.reads);
      db.chatReads[sp.id] = idx >= 0 ? list[idx].at : '0000-00-00T00:00';
    });

    /* private notifications for the current user, derived from the same records */
    var meIds = {}; db.members.forEach(function (m) { if (m.userId === 'me') meIds[m.id] = m; });
    db.receipts.forEach(function (r) {
      var g = db.groups.find(function (x) { return x.id === r.groupId; });
      if (meIds[r.memberId] && g.managerUserId !== 'me')
        db.notifications.push({ id: nextId(db, 'nt'), groupId: g.id, type: 'received', at: r.recordedAt, read: true, text: 'سجّل مدير جمعية ' + g.name + ' استلام القسط رقم ' + r.no + ' من ' + g.installments });
    });
    db.groups.forEach(function (g) {
      var m = db.members.find(function (x) { return x.groupId === g.id && x.userId === 'me'; });
      if (!m) return;
      var cy = K.currentCycle(g, anchor, K.groupShares(db, g.id).length);
      for (var c = 1; c <= cy; c++) for (var k = 1; k <= g.installments; k++) {
        var o = K.obligation(db, g, m, c, k, anchor);
        if (o.status === 'late' || o.status === 'due')
          db.notifications.push({ id: nextId(db, 'nt'), groupId: g.id, type: 'reminder', at: K.addDays(anchor, -1) + 'T08:30', read: o.status === 'late', text: (o.status === 'late' ? 'القسط رقم ' + k + ' من جمعية ' + g.name + ' متأخر' : 'القسط رقم ' + k + ' من جمعية ' + g.name + ' مستحق الآن') });
      }
    });
    db.draws.forEach(function (d) {
      var g = db.groups.find(function (x) { return x.id === d.groupId; }), sh = db.shares.find(function (s) { return s.id === d.winnerShareId; });
      if (meIds[sh.memberId] || db.members.some(function (m) { return m.groupId === g.id && m.userId === 'me'; }))
        db.notifications.push({ id: nextId(db, 'nt'), groupId: g.id, type: 'drawResult', at: d.date + 'T12:05', read: true, text: 'نتيجة قرعة الجولة ' + d.round + ' في ' + g.name + ': فاز ' + K.shareLabel(db, sh) });
    });
    db.notifications.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return normalizeDb(db);
  }

  /* ---------- storage: versioned data + separate user preferences, archive-before-remove ---------- */
  var storage = { available: true, lastSaveOk: true, error: null, holdWrites: false, notices: [] };
  function addNotice(code, message) { storage.notices.push({ code: code, message: message, at: nowAt() }); }
  function takeNotices() { var n = storage.notices.slice(); storage.notices.length = 0; return n; }
  function storageState() { return { available: storage.available, lastSaveOk: storage.lastSaveOk, error: storage.error, holdWrites: storage.holdWrites }; }
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function markStorage(okFlag, err) { storage.available = okFlag; storage.error = okFlag ? null : String(err || 'unavailable'); }
  function lsRead(k) {
    var s = ls(); if (!s) { markStorage(false, 'unavailable'); return { status: 'unavailable' }; }
    var raw; try { raw = s.getItem(k); } catch (e) { markStorage(false, e && e.name); return { status: 'unavailable' }; }
    if (raw == null) return { status: 'missing' };
    try { return { status: 'ok', value: JSON.parse(raw), raw: raw }; } catch (e) { return { status: 'corrupt', raw: raw }; }
  }
  function lsWriteRaw(k, str) {
    var s = ls(); if (!s) { markStorage(false, 'unavailable'); return false; }
    try { s.setItem(k, str); return true; } catch (e) { markStorage(false, e && e.name || 'write-failed'); return false; }
  }
  function lsSet(k, v) { var str; try { str = JSON.stringify(v); } catch (e) { return false; } return lsWriteRaw(k, str); }
  function lsRemove(k) { var s = ls(); try { if (s) s.removeItem(k); } catch (e) { /* ignore */ } }
  function probeStorage() {
    var s = ls(); if (!s) { markStorage(false, 'unavailable'); return false; }
    try { s.setItem('sahm__probe', '1'); s.removeItem('sahm__probe'); storage.available = true; storage.error = null; return true; }
    catch (e) { markStorage(false, e && e.name || 'write-failed'); return false; }
  }
  /* keeps a raw copy of data that is about to be replaced; returns true only when the copy is safely stored */
  function archiveRaw(key, raw, reason) {
    var cur = lsRead(ARCHIVE_KEY), list = (cur.status === 'ok' && Array.isArray(cur.value)) ? cur.value : [];
    list.push({ key: key, reason: reason, at: nowAt(), size: raw.length, raw: raw });
    while (list.length > 6) list.shift();
    while (!lsSet(ARCHIVE_KEY, list)) { if (list.length <= 1) return false; list.shift(); }
    return true;
  }
  function archiveList() { var r = lsRead(ARCHIVE_KEY); return r.status === 'ok' && Array.isArray(r.value) ? r.value : []; }

  function defaultPrefs() {
    return { session: false, verified: false, user: { id: 'me', name: 'أحمد محمد', phone: '+967 777 123 456', city: 'تعز' }, notifications: true, biometric: false, mute: {} };
  }
  function loadPrefs() {
    var r = lsRead(PREFS_KEY), base = defaultPrefs();
    if (r.status === 'ok' && r.value && typeof r.value === 'object') {
      var p = r.value;
      return Object.assign(base, p, { user: Object.assign(base.user, p.user || {}), mute: Object.assign({}, p.mute || {}) });
    }
    if (r.status === 'corrupt') {
      if (archiveRaw(PREFS_KEY, r.raw, 'corrupt-prefs')) addNotice('prefs-corrupt', 'تعذرت قراءة تفضيلات الحساب المحفوظة، وحُفظت نسخة منها ثم استُعيدت الإعدادات الافتراضية.');
      else storage.holdWrites = true;
      return base;
    }
    var old = null;
    LEGACY_KEYS.forEach(function (k) { if (old) return; var x = lsRead(k); if (x.status === 'ok' && x.value && x.value.user) old = x.value; });
    if (old) { /* keep only account preferences from the retired preview store */
      base.user.name = old.user.name || base.user.name; base.user.phone = old.user.phone || base.user.phone; base.user.city = old.user.city || base.user.city;
      base.session = !!old.session; base.verified = !!old.verified;
      base.notifications = old.user.notifications !== false; base.biometric = !!old.user.biometric;
    }
    return base;
  }
  function retireLegacy() {
    LEGACY_KEYS.forEach(function (k) {
      var r = lsRead(k); if (r.status !== 'ok' && r.status !== 'corrupt') return;
      if (archiveRaw(k, r.raw, 'legacy-retired')) { lsRemove(k); addNotice('legacy-archived', 'حُفظت نسخة من بيانات المعاينة القديمة في أرشيف محلي، ولم تُحذف.'); }
    });
  }

  function isDbShape(db) {
    return !!db && typeof db === 'object' && typeof db.version === 'string' &&
      ['groups', 'members', 'shares', 'receipts', 'draws', 'messages', 'events', 'notifications'].every(function (k) { return Array.isArray(db[k]); });
  }
  /* idempotent: fills every field introduced after earlier versions without touching existing values */
  function normalizeDb(db) {
    var K = C();
    ['groups', 'members', 'shares', 'receipts', 'draws', 'messages', 'events', 'notifications', 'reminders', 'invites', 'corrections'].forEach(function (k) { if (!Array.isArray(db[k])) db[k] = []; });
    ['chatReads', 'emitted'].forEach(function (k) { if (!db[k] || typeof db[k] !== 'object') db[k] = {}; });
    if (!db.meta || typeof db.meta !== 'object') db.meta = { createdAt: db.seededOn || null, migrations: [] };
    if (!Array.isArray(db.meta.migrations)) db.meta.migrations = [];
    if (typeof db.seq !== 'number') db.seq = 0;
    var gById = {}, mById = {};
    db.groups.forEach(function (g) {
      gById[g.id] = g;
      if (!g.notify || typeof g.notify !== 'object') g.notify = {};
      NOTIFY_TYPES.forEach(function (t) { if (g.notify[t.id] === undefined) g.notify[t.id] = !!DEFAULT_NOTIFY[t.id]; });
      if (g.inviteClosesOn === undefined) g.inviteClosesOn = null;
      if (!g.tz) g.tz = TZ;
      if (g.lockedAt === undefined) {
        var d = db.draws.filter(function (x) { return x.groupId === g.id; }).sort(function (a, b) { return a.round - b.round; })[0];
        g.lockedAt = d ? (d.at || d.date + 'T12:00') : null;
      }
    });
    db.members.forEach(function (m) { mById[m.id] = m; });
    db.shares.forEach(function (s) { if (!s.addedAt) { var m = mById[s.memberId]; s.addedAt = m ? m.joinedAt : ((gById[s.groupId] || {}).startDate || null); } });
    db.receipts.forEach(function (r) {
      if (r.voided === undefined) r.voided = false;
      if (!r.status) r.status = r.voided ? 'voided' : 'active';
      if (r.sharesCount === undefined) r.sharesCount = (r.shareIds || []).length;
      if (r.beneficiaryId === undefined) r.beneficiaryId = r.memberId;
      if (r.self === undefined) r.self = false;
      if (!r.periodStart && gById[r.groupId]) { try { var rg = K.instRange(gById[r.groupId], r.cycle, r.no); r.periodStart = rg.start; r.periodEnd = rg.end; } catch (e) { /* leave empty */ } }
    });
    db.events.forEach(function (e) {
      if (e.vis === undefined) e.vis = (e.type === 'receipt' || e.type === 'correction') ? 'private' : (e.type === 'reminder' || e.type === 'invite' ? 'manager' : 'group');
      if (e.actor === undefined) e.actor = null;
      if (e.memberId === undefined) e.memberId = null;
    });
    db.messages.forEach(function (m) { if (m.kind === 'system' && !m.senderId) m.senderId = 'sahm-system'; });
    db.notifications.forEach(function (n) { if (!n.userId) n.userId = 'me'; if (n.muted === undefined) n.muted = false; });
    db.draws.forEach(function (d) { if (!d.at) d.at = d.date + 'T12:00'; });
    return db;
  }
  var MIGRATIONS = {
    'sahm-data-2026-11-v3': function (old) {
      var c = clone(old);
      c.meta = c.meta || { createdAt: c.seededOn || null, migrations: [] };
      (c.meta.migrations = c.meta.migrations || []).push({ from: old.version, to: DATA_VERSION, at: nowAt() });
      c.version = DATA_VERSION; return c;
    }
  };

  function load() {
    var K = C(), migrated = false, db = null;
    probeStorage();
    var prefs = loadPrefs();
    var cur = lsRead(DATA_KEY);
    if (cur.status === 'ok') {
      if (isDbShape(cur.value) && cur.value.version === DATA_VERSION) db = cur.value;
      else if (isDbShape(cur.value) && MIGRATIONS[cur.value.version]) {
        if (archiveRaw(DATA_KEY, cur.raw, 'migrated-from-' + cur.value.version)) { db = MIGRATIONS[cur.value.version](cur.value); migrated = true; }
        else { db = null; storage.holdWrites = true; addNotice('archive-failed', 'تعذر حفظ نسخة احتياطية قبل ترحيل البيانات، لذلك لم تُعدَّل البيانات المحفوظة.'); }
      } else {
        if (archiveRaw(DATA_KEY, cur.raw, 'unsupported-shape')) addNotice('data-archived', 'بيانات محفوظة بصيغة غير مدعومة؛ حُفظت نسخة منها وبدأت معاينة جديدة.');
        else { storage.holdWrites = true; addNotice('archive-failed', 'تعذر حفظ نسخة من البيانات غير المدعومة؛ لم تُستبدل.'); }
      }
    } else if (cur.status === 'corrupt') {
      if (archiveRaw(DATA_KEY, cur.raw, 'corrupt')) addNotice('data-corrupt', 'تعذرت قراءة بيانات الجمعيات المحفوظة لأنها تالفة. حُفظت نسخة منها ثم بدأت معاينة جديدة.');
      else { storage.holdWrites = true; addNotice('archive-failed', 'بيانات الجمعيات المحفوظة تالفة وتعذر حفظ نسخة منها؛ لم تُستبدل.'); }
    }
    if (!db && cur.status !== 'unavailable') {
      PREV_DATA.forEach(function (p) {
        var r = lsRead(p.key); if (r.status !== 'ok' && r.status !== 'corrupt') return;
        var usable = !db && r.status === 'ok' && isDbShape(r.value) && MIGRATIONS[r.value.version];
        if (archiveRaw(p.key, r.raw, usable ? 'migrated-to-v4' : 'unusable-previous')) {
          if (usable) { db = MIGRATIONS[r.value.version](r.value); migrated = true; addNotice('data-migrated', 'رُحّلت بياناتك المحفوظة إلى الإصدار الجديد، وحُفظت نسخة من القديمة في الأرشيف.'); }
          lsRemove(p.key);
        } else if (usable) { db = MIGRATIONS[r.value.version](r.value); migrated = true; }
      });
    }
    retireLegacy();
    if (!db) db = buildSeed(nowAt().slice(0, 10));
    normalizeDb(db); db.version = DATA_VERSION;
    db.prefs = prefs;
    tick(db, { silent: migrated, noSave: true });
    save(db);
    return db;
  }
  function save(db) {
    if (storage.holdWrites) { storage.lastSaveOk = false; return { ok: false, held: true }; }
    var copy = Object.assign({}, db); delete copy.prefs;
    var a = lsSet(DATA_KEY, copy), b = lsSet(PREFS_KEY, db.prefs);
    storage.lastSaveOk = a && b;
    if (a && b) { storage.available = true; storage.error = null; }
    return { ok: a && b };
  }
  /* test/diagnostic helper: drop all SAHM keys (never called by the app) */
  function resetAll() { [DATA_KEY, PREFS_KEY, ARCHIVE_KEY].concat(LEGACY_KEYS, PREV_DATA.map(function (p) { return p.key; })).forEach(lsRemove); storage.holdWrites = false; storage.notices.length = 0; }

  /* ---------- transactions: all-or-nothing, in place so existing references stay valid ---------- */
  function snapshot(db) { var d = Object.assign({}, db); delete d.prefs; return JSON.stringify({ d: d, p: db.prefs }); }
  function replaceInPlace(obj, k, val) {
    var cur = obj[k];
    if (Array.isArray(cur) && Array.isArray(val)) { cur.length = 0; Array.prototype.push.apply(cur, val); }
    else if (cur && val && typeof cur === 'object' && typeof val === 'object' && !Array.isArray(cur) && !Array.isArray(val)) { Object.keys(cur).forEach(function (x) { delete cur[x]; }); Object.assign(cur, val); }
    else obj[k] = val;
  }
  function restore(db, snap) {
    var s = JSON.parse(snap);
    Object.keys(db).forEach(function (k) { if (k !== 'prefs' && !(k in s.d)) delete db[k]; });
    Object.keys(s.d).forEach(function (k) { replaceInPlace(db, k, s.d[k]); });
    replaceInPlace(db, 'prefs', s.p);
  }
  function transact(db, fn) {
    var snap = snapshot(db);
    try {
      var res = fn();
      if (res && res.ok === false) { restore(db, snap); return res; }
      res = res || {}; res.ok = true;
      var sv = save(db);
      res.persisted = !!sv.ok;
      if (!sv.ok) res.warning = 'تم تنفيذ العملية في هذه الجلسة لكن تعذر حفظها في تخزين المتصفح، وقد تضيع عند إغلاق التطبيق.';
      return res;
    } catch (e) {
      restore(db, snap);
      if (e && e.sahm) return fail(e.sahm.code, e.sahm.message, e.sahm.extra);
      return fail('INTERNAL_ERROR', 'حدث خطأ غير متوقع ولم تُنفَّذ العملية', { detail: String(e && e.message || e) });
    }
  }

  /* ---------- lookups and permissions ---------- */
  function me(db) { return db.prefs.user.id; }
  function group(db, id) { return db.groups.find(function (g) { return g.id === id; }); }
  function mustGroup(db, id) { var g = group(db, id); if (!g) throw E('GROUP_NOT_FOUND', 'الجمعية غير موجودة'); return g; }
  function mustMember(db, g, id) {
    var m = db.members.find(function (x) { return x.id === id && x.groupId === g.id; });
    if (!m) throw E('MEMBER_NOT_FOUND', 'العضو غير موجود في هذه الجمعية'); return m;
  }
  function needManager(g, actor) { if (!actor || g.managerUserId !== actor) throw E('FORBIDDEN', 'هذا الإجراء متاح لمدير الجمعية فقط'); }
  function memberOf(db, g, userId) { return db.members.find(function (m) { return m.groupId === g.id && m.userId === userId; }) || null; }
  function viewerRole(db, g, viewer) {
    var m = memberOf(db, g, viewer);
    return { manager: !!viewer && g.managerUserId === viewer, member: m && C().memberShares(db, m.id).length ? m : null };
  }
  function needLocked(db, g, what) { if (C().isLocked(db, g.id)) throw E('GROUP_LOCKED', 'أُقفلت العضويات والأسهم بعد تثبيت أول قرعة، ولا يمكن ' + what); }
  function frozenCount(db, g) {
    var first = db.draws.filter(function (d) { return d.groupId === g.id; }).sort(function (a, b) { return a.round - b.round; })[0];
    return first ? first.shareCount : C().groupShares(db, g.id).length;
  }
  function todayOf(g) { return nowAt(g && g.tz).slice(0, 10); }
  function majorOf(g) {
    var c = C().CURRENCIES[g.currency]; return c.minor === 1 ? String(g.shareAmount) : (g.shareAmount / c.minor).toFixed(2);
  }

  /* ---------- private notifications for the signed-in user ---------- */
  function isMuted(db, gid, kind) {
    var mu = db.prefs.mute[gid] || {};
    return db.prefs.notifications === false || !!mu.group || (kind === 'reminder' && !!mu.reminders);
  }
  function notifyUser(db, g, userId, type, text, at) {
    if (!userId || userId !== me(db)) return null; /* the preview holds the notifications of this device's user only */
    var n = { id: nextId(db, 'nt'), groupId: g.id, userId: userId, type: type, at: at, read: false, muted: isMuted(db, g.id, type), text: text };
    db.notifications.unshift(n); return n;
  }

  /* ---------- time-driven notices (late installments, upcoming / due draw): idempotent ---------- */
  function tick(db, opts) {
    opts = opts || {};
    var K = C(), now = nowAt(), posted = 0, dirty = false;
    function emit(key, stamp, fn) {
      if (db.emitted[key] || stamp > now) return;
      db.emitted[key] = 1; dirty = true;
      if (!opts.silent) { fn(stamp); posted++; }
    }
    db.groups.forEach(function (g) {
      var today = now.slice(0, 10); if (today < g.startDate) return;
      var total = K.groupShares(db, g.id).length; if (!total) return;
      var cyc = K.currentCycle(g, today, total);
      K.groupMembers(db, g.id).forEach(function (m) {
        if (!K.memberShares(db, m.id).length) return;
        for (var c = 1; c <= cyc; c++) for (var k = 1; k <= g.installments; k++) lateNotice(g, m, c, k, today);
      });
      var draws = db.draws.filter(function (d) { return d.groupId === g.id; }), frozen = draws.length ? frozenCount(db, g) : total;
      if (draws.length < frozen) {
        var rd = draws.length + 1, nd = K.roundDate(g, rd), soonAt = K.addDays(nd, -DRAW_SOON_DAYS);
        if (today >= nd) { db.emitted['drawSoon:' + g.id + ':' + rd] = 1; dirty = true; }
        else emit('drawSoon:' + g.id + ':' + rd, soonAt + 'T09:00', function (at) { postSystem(db, g, 'drawSoon', { round: rd, date: K.fmtDate(nd) }, at); });
        emit('drawDue:' + g.id + ':' + rd, nd + 'T09:00', function (at) { postSystem(db, g, 'drawDue', { round: rd }, at); });
      }
    });
    function lateNotice(g, m, c, k, today) {
      var r = K.instRange(g, c, k); if (r.end >= today) return;
      var o = K.obligation(db, g, m, c, k, today); if (o.status !== 'late' || o.lateByJoin) return;
      emit('late:' + g.id + ':' + m.id + ':' + c + ':' + k, K.addDays(r.end, 1) + 'T09:00', function (at) { postSystem(db, g, 'late', { name: m.name, no: k, cycle: c }, at); });
    }
    if (posted) db.messages.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });
    if ((posted || dirty) && !opts.noSave) save(db);
    return { posted: posted };
  }

  /* =====================================================================================
     OPERATIONS (all mutating, all permission-checked, all transactional)
     ===================================================================================== */

  /* ---------- associations ---------- */
  function inviteCodeFor(db, gid) {
    var code, n = 0;
    do { code = 'SAHM-' + gid.toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + (4000 + ((db.seq + n) * 7919) % 5000); n++; }
    while (db.groups.some(function (g) { return g.inviteCode === code; }));
    return code;
  }
  function createGroup(db, actor, input) {
    return transact(db, function () {
      var K = C(); input = input || {};
      if (!actor) throw E('FORBIDDEN', 'لا يوجد مستخدم مسجل');
      var errs = K.validateGroup(input);
      if (errs.length) return fail('VALIDATION', 'بيانات الجمعية غير مكتملة أو غير صحيحة', { errors: errs });
      var today = nowAt(TZ).slice(0, 10), gid = nextId(db, 'g');
      var g = {
        id: gid, name: input.name.trim(), tone: input.tone || 'blue', currency: input.currency, tz: input.tz || TZ, cycleType: input.cycleType,
        cycleDays: input.cycleType === 'custom' ? Number(input.cycleDays) : null, installments: Number(input.installments),
        shareAmount: K.parseMoney(input.shareAmount, input.currency), startDate: input.startDate, createdOn: today,
        maxPerMember: Number(input.maxPerMember), targetShares: Number(input.targetShares),
        quorum: input.quorum ? Number(input.quorum) : 66, rules: String(input.rules || '').trim(), notify: {},
        managerUserId: actor, managerName: actor === me(db) ? db.prefs.user.name : 'المدير',
        inviteOpensOn: input.inviteOpensOn || today, inviteClosesOn: input.inviteClosesOn || null, lockedAt: null
      };
      g.inviteCode = inviteCodeFor(db, gid);
      NOTIFY_TYPES.forEach(function (t) { g.notify[t.id] = input.notify && input.notify[t.id] !== undefined ? !!input.notify[t.id] : !!DEFAULT_NOTIFY[t.id]; });
      db.groups.push(g);
      logEvent(db, g, 'created', 'أُنشئت الجمعية «' + g.name + '»', { actor: actor, at: nowAt(g.tz) });
      if (input.managerMode === 'both') {
        addMemberCore(db, g, { name: g.managerName, userId: actor, shares: Number(input.managerShares), joinedAt: today, isManager: true, confirmLateImpact: true, silent: true });
      }
      return { groupId: gid, group: clone(g), plan: K.groupPlan(g, g.targetShares) };
    });
  }

  var FREE_FIELDS = ['name', 'rules', 'quorum', 'inviteOpensOn', 'inviteClosesOn', 'tone'];
  var FIN_FIELDS = ['currency', 'cycleType', 'cycleDays', 'installments', 'shareAmount', 'startDate'];
  var COUNT_FIELDS = ['targetShares', 'maxPerMember'];
  function updateGroup(db, actor, gid, patch) {
    return transact(db, function () {
      var K = C(), g = mustGroup(db, gid); needManager(g, actor); patch = patch || {};
      var keys = Object.keys(patch), locked = K.isLocked(db, g.id), hasReceipts = db.receipts.some(function (r) { return r.groupId === g.id && !r.voided; });
      keys.forEach(function (k) {
        if (FREE_FIELDS.indexOf(k) >= 0) return;
        if (FIN_FIELDS.indexOf(k) >= 0 || COUNT_FIELDS.indexOf(k) >= 0) {
          if (locked) throw E('SETTINGS_LOCKED', 'بعد تثبيت أول قرعة لا يمكن تعديل العملة أو الدورة أو الحصة أو الأقساط أو العدد المستهدف');
          if (FIN_FIELDS.indexOf(k) >= 0 && hasReceipts) throw E('SETTINGS_LOCKED_RECEIPTS', 'لا يمكن تعديل الإعدادات المالية بعد تسجيل استلام أي قسط');
          return;
        }
        throw E(k === 'firstDrawDate' || k === 'firstDraw' ? 'FIRST_DRAW_NOT_EDITABLE' : 'FIELD_NOT_EDITABLE', 'لا يمكن تعديل هذا الحقل: ' + k);
      });
      var cand = {
        name: g.name, currency: g.currency, cycleType: g.cycleType, cycleDays: g.cycleDays, installments: g.installments, shareAmount: majorOf(g), startDate: g.startDate,
        inviteOpensOn: g.inviteOpensOn, inviteClosesOn: g.inviteClosesOn, targetShares: g.targetShares, maxPerMember: g.maxPerMember, quorum: g.quorum, managerMode: 'only', tz: g.tz
      };
      keys.forEach(function (k) { cand[k] = patch[k]; });
      var errs = K.validateGroup(cand);
      if (errs.length) return fail('VALIDATION', 'التعديل غير صحيح', { errors: errs });
      var assigned = K.groupShares(db, g.id).length;
      if (Number(cand.targetShares) < assigned) throw E('TARGET_BELOW_ASSIGNED', 'العدد المستهدف أقل من الأسهم المخصصة فعلًا (' + assigned + ')');
      var maxOwned = 0; K.groupMembers(db, g.id).forEach(function (m) { maxOwned = Math.max(maxOwned, K.memberShares(db, m.id).length); });
      if (Number(cand.maxPerMember) < maxOwned) throw E('MAX_PER_BELOW_OWNED', 'الحد الأقصى لأسهم الفرد أقل مما يملكه عضو حاليًا (' + maxOwned + ')');
      var before = {}, after = {};
      keys.forEach(function (k) {
        var nv = patch[k];
        if (k === 'shareAmount') nv = K.parseMoney(nv, cand.currency);
        else if (['installments', 'targetShares', 'maxPerMember', 'quorum', 'cycleDays'].indexOf(k) >= 0) nv = nv === null || nv === '' ? null : Number(nv);
        else if (k === 'name' || k === 'rules') nv = String(nv == null ? '' : nv).trim();
        if (JSON.stringify(g[k]) !== JSON.stringify(nv)) { before[k] = g[k]; after[k] = nv; g[k] = nv; }
      });
      if (cand.currency !== undefined && keys.indexOf('currency') >= 0 && keys.indexOf('shareAmount') < 0) g.shareAmount = K.parseMoney(cand.shareAmount, g.currency);
      if (g.cycleType !== 'custom') g.cycleDays = null;
      if (Object.keys(after).length) logEvent(db, g, 'group-update', 'عُدّلت بيانات الجمعية', { actor: actor, data: { before: before, after: after } });
      return { group: clone(g), changed: Object.keys(after) };
    });
  }

  /* ---------- members and shares ---------- */
  function previewJoin(db, gid, input) {
    var g = group(db, gid); if (!g) return fail('GROUP_NOT_FOUND', 'الجمعية غير موجودة');
    var K = C(); input = input || {};
    var today = todayOf(g), joinDate = input.joinDate || today, n = Number(input.shares) || 0;
    if (!K.isValidDate(joinDate)) return fail('DATE_INVALID', 'تاريخ الانضمام غير صحيح');
    var assigned = K.groupShares(db, gid).length, lp = K.lateJoinPreview(g, joinDate, n, today, 0);
    return { ok: true, lateImpact: lp, hasLateImpact: lp.items.length > 0, assigned: assigned, remaining: Math.max(0, g.targetShares - assigned), locked: K.isLocked(db, gid) };
  }
  function addMemberCore(db, g, o) {
    var K = C(); needLocked(db, g, 'إضافة أعضاء أو أسهم');
    var name = String(o.name == null ? '' : o.name).trim();
    if (!name) throw E('NAME_REQUIRED', 'أدخل اسم العضو'); if (name.length > 60) throw E('NAME_TOO_LONG', 'اسم العضو طويل');
    var n = Number(o.shares);
    if (!Number.isInteger(n) || n < 1) throw E('SHARES_INVALID', 'عدد الأسهم يجب أن يكون عددًا صحيحًا موجبًا');
    if (n > g.maxPerMember) throw E('MAX_PER_MEMBER', 'عدد الأسهم يتجاوز الحد الأقصى للفرد (' + g.maxPerMember + ')');
    var assigned = K.groupShares(db, g.id).length;
    if (assigned + n > g.targetShares) throw E('TARGET_EXCEEDED', 'عدد الأسهم يتجاوز المتبقي من العدد المستهدف (' + (g.targetShares - assigned) + ')');
    if (o.userId && memberOf(db, g, o.userId)) throw E('ALREADY_MEMBER', 'هذا المستخدم عضو في الجمعية بالفعل');
    var today = todayOf(g), joinedAt = o.joinedAt || today;
    if (!K.isValidDate(joinedAt)) throw E('DATE_INVALID', 'تاريخ الانضمام غير صحيح');
    if (joinedAt > today) throw E('DATE_IN_FUTURE', 'تاريخ الانضمام لا يكون في المستقبل');
    var lp = K.lateJoinPreview(g, joinedAt, n, today, 0);
    if (lp.items.length && !o.confirmLateImpact) throw E('LATE_IMPACT_CONFIRM_REQUIRED', 'الانضمام بعد بداية الجمعية ينشئ أقساطًا متأخرة، ويلزم تأكيدها قبل الإضافة', { preview: lp });
    var at = nowAt(g.tz);
    var m = { id: nextId(db, 'm'), groupId: g.id, name: name, userId: o.userId || null, isManager: !!o.isManager, joinedAt: joinedAt, present: false };
    if (o.phone) m.phone = String(o.phone);
    db.members.push(m);
    var ids = [];
    for (var i = 1; i <= n; i++) { var s = { id: 's-' + m.id + '-' + i, groupId: g.id, memberId: m.id, no: i, addedAt: joinedAt }; db.shares.push(s); ids.push(s.id); }
    logEvent(db, g, 'join', 'انضم ' + name + ' بـ ' + n + ' ' + (n === 1 ? 'سهم' : 'أسهم'), { actor: o.actor || null, memberId: m.id, at: at });
    if (!o.silent) postSystem(db, g, 'joined', { name: name, shares: n }, at);
    return { member: clone(m), shareIds: ids, lateImpact: lp };
  }
  function addMember(db, actor, gid, input) {
    return transact(db, function () {
      var g = mustGroup(db, gid); needManager(g, actor); input = input || {};
      return addMemberCore(db, g, { name: input.name, userId: input.userId, phone: input.phone, shares: input.shares, joinedAt: input.joinedAt, confirmLateImpact: input.confirmLateImpact, actor: actor });
    });
  }
  function addShares(db, actor, memberId, count, opts) {
    return transact(db, function () {
      var K = C(), m = db.members.find(function (x) { return x.id === memberId; });
      if (!m) throw E('MEMBER_NOT_FOUND', 'العضو غير موجود');
      var g = mustGroup(db, m.groupId); needManager(g, actor); needLocked(db, g, 'إضافة أسهم');
      opts = opts || {}; var n = Number(count);
      if (!Number.isInteger(n) || n < 1) throw E('SHARES_INVALID', 'عدد الأسهم يجب أن يكون عددًا صحيحًا موجبًا');
      var owned = K.memberShares(db, m.id), assigned = K.groupShares(db, g.id).length;
      if (owned.length + n > g.maxPerMember) throw E('MAX_PER_MEMBER', 'عدد الأسهم يتجاوز الحد الأقصى للفرد (' + g.maxPerMember + ')');
      if (assigned + n > g.targetShares) throw E('TARGET_EXCEEDED', 'عدد الأسهم يتجاوز المتبقي من العدد المستهدف (' + (g.targetShares - assigned) + ')');
      var today = todayOf(g), lp = K.lateJoinPreview(g, today, n, today, 0);
      if (lp.items.length && !opts.confirmLateImpact) throw E('LATE_IMPACT_CONFIRM_REQUIRED', 'إضافة سهم بعد بداية الجمعية تنشئ أقساطًا متأخرة، ويلزم تأكيدها', { preview: lp });
      var at = nowAt(g.tz), top = owned.reduce(function (a, s) { return Math.max(a, s.no); }, 0), ids = [];
      for (var i = 1; i <= n; i++) { var s = { id: 's-' + m.id + '-' + (top + i), groupId: g.id, memberId: m.id, no: top + i, addedAt: today }; db.shares.push(s); ids.push(s.id); }
      logEvent(db, g, 'shares', 'أضيف إلى ' + m.name + ' ' + n + ' ' + (n === 1 ? 'سهم' : 'أسهم'), { actor: actor, memberId: m.id, at: at });
      postSystem(db, g, 'joined', { name: m.name, added: n }, at);
      return { shareIds: ids, lateImpact: lp, totalShares: owned.length + n };
    });
  }
  function maxReceiptCycle(db, gid) { var mx = 0; db.receipts.forEach(function (r) { if (r.groupId === gid && !r.voided) mx = Math.max(mx, r.cycle); }); return mx; }
  function removeShares(db, actor, memberId, count) {
    return transact(db, function () {
      var K = C(), m = db.members.find(function (x) { return x.id === memberId; });
      if (!m) throw E('MEMBER_NOT_FOUND', 'العضو غير موجود');
      var g = mustGroup(db, m.groupId); needManager(g, actor); needLocked(db, g, 'تقليل الأسهم');
      var n = Number(count), owned = K.memberShares(db, m.id).sort(function (a, b) { return a.no - b.no; });
      if (!Number.isInteger(n) || n < 1) throw E('SHARES_INVALID', 'عدد الأسهم يجب أن يكون عددًا صحيحًا موجبًا');
      if (n >= owned.length) throw E('REMOVE_ALL_SHARES', 'لإزالة جميع أسهم العضو احذف العضو نفسه');
      var drop = owned.slice(owned.length - n), ids = {}; drop.forEach(function (s) { ids[s.id] = 1; });
      var covered = db.receipts.some(function (r) { return !r.voided && r.shareIds.some(function (id) { return ids[id]; }); });
      if (covered) throw E('SHARE_HAS_RECEIPTS', 'لا يمكن إزالة سهم سُجل استلام قسطه؛ صحّح سجل الاستلام أولًا');
      if (K.groupShares(db, g.id).length - n < maxReceiptCycle(db, g.id)) throw E('ROUNDS_BELOW_RECEIPTS', 'تقليل الأسهم يخفض عدد الجولات دون دورة سُجلت أقساطها');
      db.shares = db.shares.filter(function (s) { return !ids[s.id]; });
      logEvent(db, g, 'shares', 'أُزيل ' + n + ' ' + (n === 1 ? 'سهم' : 'أسهم') + ' من ' + m.name, { actor: actor, memberId: m.id });
      return { totalShares: owned.length - n };
    });
  }
  function removeMember(db, actor, memberId) {
    return transact(db, function () {
      var K = C(), m = db.members.find(function (x) { return x.id === memberId; });
      if (!m) throw E('MEMBER_NOT_FOUND', 'العضو غير موجود');
      var g = mustGroup(db, m.groupId); needManager(g, actor); needLocked(db, g, 'حذف الأعضاء');
      if (db.receipts.some(function (r) { return r.memberId === m.id && !r.voided; })) throw E('MEMBER_HAS_RECEIPTS', 'لا يمكن حذف عضو سُجل استلام أقساطه؛ صحّح سجلات الاستلام أولًا');
      var n = K.memberShares(db, m.id).length;
      if (K.groupShares(db, g.id).length - n < maxReceiptCycle(db, g.id)) throw E('ROUNDS_BELOW_RECEIPTS', 'الحذف يخفض عدد الجولات دون دورة سُجلت أقساطها');
      db.shares = db.shares.filter(function (s) { return s.memberId !== m.id; });
      db.members = db.members.filter(function (x) { return x.id !== m.id; });
      logEvent(db, g, 'leave', 'أُزيل العضو ' + m.name + ' من الجمعية', { actor: actor });
      return { removedShares: n };
    });
  }
  function setAttendance(db, actor, memberId, present) {
    return transact(db, function () {
      var m = db.members.find(function (x) { return x.id === memberId; });
      if (!m) throw E('MEMBER_NOT_FOUND', 'العضو غير موجود');
      var g = mustGroup(db, m.groupId); needManager(g, actor);
      if (!C().memberShares(db, m.id).length) throw E('NO_SHARES', 'هذا العضو لا يملك أسهمًا');
      m.present = !!present;
      logEvent(db, g, 'attendance', (m.present ? 'سُجّل حضور ' : 'أُلغي حضور ') + m.name, { actor: actor, memberId: m.id, vis: 'manager' });
      return { quorum: C().quorumInfo(db, g) };
    });
  }

  /* ---------- invitations ---------- */
  function normPhone(p) { return String(p == null ? '' : p).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[^\d]/g, ''); }
  function inviteSummary(db, gid) {
    var g = group(db, gid); if (!g) return fail('GROUP_NOT_FOUND', 'الجمعية غير موجودة');
    var assigned = C().groupShares(db, gid).length, pending = 0;
    db.invites.forEach(function (i) { if (i.groupId === gid && i.status === 'pending') pending += i.shares; });
    return { ok: true, target: g.targetShares, assigned: assigned, pendingShares: pending, remaining: Math.max(0, g.targetShares - assigned - pending) };
  }
  function inviteWindow(g, today) {
    if (g.inviteOpensOn && today < g.inviteOpensOn) return 'not-open';
    if (g.inviteClosesOn && today > g.inviteClosesOn) return 'closed';
    return 'open';
  }
  function createInvite(db, actor, gid, input) {
    return transact(db, function () {
      var K = C(), g = mustGroup(db, gid); needManager(g, actor); needLocked(db, g, 'إرسال دعوات جديدة'); input = input || {};
      var today = todayOf(g), win = inviteWindow(g, today);
      if (win !== 'open') throw E(win === 'closed' ? 'INVITES_CLOSED' : 'INVITES_NOT_OPEN', win === 'closed' ? 'أُغلقت فترة استقبال الأعضاء' : 'لم تُفتح فترة استقبال الأعضاء بعد');
      var name = String(input.name || '').trim(), phone = normPhone(input.phone), n = Number(input.shares);
      if (!name) throw E('NAME_REQUIRED', 'أدخل اسم المدعو');
      if (phone.length < 7 || phone.length > 15) throw E('PHONE_INVALID', 'رقم الهاتف غير صحيح');
      if (!Number.isInteger(n) || n < 1) throw E('SHARES_INVALID', 'عدد الأسهم يجب أن يكون عددًا صحيحًا موجبًا');
      if (n > g.maxPerMember) throw E('MAX_PER_MEMBER', 'عدد الأسهم يتجاوز الحد الأقصى للفرد (' + g.maxPerMember + ')');
      if (db.invites.some(function (i) { return i.groupId === gid && i.status === 'pending' && i.phone === phone; })) throw E('DUPLICATE_INVITE', 'توجد دعوة معلقة لهذا الرقم');
      var sum = inviteSummary(db, gid);
      if (n > sum.remaining) throw E('TARGET_EXCEEDED', 'عدد الأسهم يتجاوز المتبقي من العدد المستهدف (' + sum.remaining + ')');
      var inv = { id: nextId(db, 'inv'), groupId: gid, name: name, phone: phone, shares: n, status: 'pending', createdAt: nowAt(g.tz), createdBy: actor };
      db.invites.push(inv);
      logEvent(db, g, 'invite', 'دعوة ' + name + ' بـ ' + n + ' ' + (n === 1 ? 'سهم' : 'أسهم'), { actor: actor, vis: 'manager', data: { inviteId: inv.id } });
      return { invite: clone(inv), summary: inviteSummary(db, gid) };
    });
  }
  function cancelInvite(db, actor, inviteId) {
    return transact(db, function () {
      var inv = db.invites.find(function (i) { return i.id === inviteId; });
      if (!inv) throw E('INVITE_NOT_FOUND', 'الدعوة غير موجودة');
      var g = mustGroup(db, inv.groupId); needManager(g, actor);
      if (inv.status !== 'pending') throw E('INVITE_NOT_PENDING', 'لا يمكن إلغاء دعوة غير معلقة');
      inv.status = 'cancelled'; inv.cancelledAt = nowAt(g.tz);
      logEvent(db, g, 'invite', 'أُلغيت دعوة ' + inv.name, { actor: actor, vis: 'manager', data: { inviteId: inv.id } });
      return { summary: inviteSummary(db, g.id) };
    });
  }
  /* what the invitation screen may show before membership is accepted (no member data) */
  function inviteList(db, viewer, gid) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err;
    if (!v.role.manager) return fail('FORBIDDEN', 'قائمة الدعوات متاحة لمدير الجمعية فقط');
    return { ok: true, groupId: gid, invites: db.invites.filter(function (i) { return i.groupId === gid; }).map(clone) };
  }

  function getInviteInfo(db, code) {
    var g = db.groups.find(function (x) { return x.inviteCode === String(code || '').trim(); });
    if (!g) return fail('INVITE_CODE_INVALID', 'رابط الدعوة غير صحيح');
    var K = C(), today = todayOf(g), assigned = K.groupShares(db, g.id).length;
    return { ok: true, groupId: g.id, name: g.name, managerName: g.managerName, currency: g.currency, cycleLabel: K.cycleLabel(g), installments: g.installments,
      shareAmount: g.shareAmount, startDate: g.startDate, firstDraw: K.firstDrawDate(g), maxPerMember: g.maxPerMember, targetShares: g.targetShares, assignedShares: assigned,
      rules: g.rules, window: inviteWindow(g, today), locked: K.isLocked(db, g.id), privacyNote: PRIVACY_NOTE, previewNote: LOCAL_PREVIEW_NOTE };
  }
  function joinByCode(db, userId, code, input) {
    return transact(db, function () {
      var K = C(); input = input || {};
      var g = db.groups.find(function (x) { return x.inviteCode === String(code || '').trim(); });
      if (!g) throw E('INVITE_CODE_INVALID', 'رابط الدعوة غير صحيح');
      if (!userId) throw E('FORBIDDEN', 'لا يوجد مستخدم مسجل');
      needLocked(db, g, 'الانضمام');
      var today = todayOf(g), win = inviteWindow(g, today);
      if (win !== 'open') throw E(win === 'closed' ? 'INVITES_CLOSED' : 'INVITES_NOT_OPEN', win === 'closed' ? 'أُغلقت فترة استقبال الأعضاء' : 'لم تُفتح فترة استقبال الأعضاء بعد');
      if (memberOf(db, g, userId)) throw E('ALREADY_MEMBER', 'أنت عضو في هذه الجمعية بالفعل');
      var phone = normPhone(input.phone || (userId === me(db) ? db.prefs.user.phone : ''));
      var inv = db.invites.find(function (i) { return i.groupId === g.id && i.status === 'pending' && i.phone === phone; });
      if (!inv) throw E('NOT_INVITED', 'لا توجد دعوة معلقة لرقمك في هذه الجمعية. اطلب من المدير دعوتك');
      var name = String(input.name || (userId === me(db) ? db.prefs.user.name : '') || inv.name).trim();
      var res = addMemberCore(db, g, { name: name, userId: userId, phone: phone, shares: inv.shares, confirmLateImpact: input.confirmLateImpact, actor: userId });
      inv.status = 'accepted'; inv.acceptedAt = nowAt(g.tz); inv.acceptedBy = userId; inv.memberId = res.member.id;
      return res;
    });
  }

  /* ---------- recording and correcting receipts (the manager's "تسجيل مدفوع") ---------- */
  function recordPaid(db, actor, p) {
    return transact(db, function () {
      var K = C(); p = p || {};
      var g = mustGroup(db, p.groupId); needManager(g, actor);
      var m = mustMember(db, g, p.memberId), rounds = frozenCount(db, g);
      if (!K.memberShares(db, m.id).length) throw E('NO_SHARES', 'هذا العضو لا يملك أسهمًا');
      if (!Number.isInteger(p.cycle) || p.cycle < 1 || p.cycle > rounds) throw E('CYCLE_INVALID', 'رقم الدورة غير صحيح');
      if (!Number.isInteger(p.no) || p.no < 1 || p.no > g.installments) throw E('INSTALLMENT_INVALID', 'رقم القسط غير صحيح');
      var at = nowAt(g.tz), today = at.slice(0, 10), o = K.obligation(db, g, m, p.cycle, p.no, today);
      if (!o.unpaidShares.length) throw E('ALREADY_RECORDED', 'سُجّل استلام هذا القسط لهذا العضو من قبل');
      var ids = o.unpaidShares.map(function (s) { return s.id; }), self = !!(m.userId && m.userId === actor);
      var rec = { id: nextId(db, 'rc'), groupId: g.id, memberId: m.id, beneficiaryId: m.id, cycle: p.cycle, no: p.no, shareIds: ids, sharesCount: ids.length,
        amount: o.perShare * ids.length, currency: g.currency, recordedAt: at, recordedBy: actor, recordedByName: g.managerName, self: self,
        periodStart: o.range.start, periodEnd: o.range.end, statusAtRecord: o.status, status: 'active', voided: false };
      if (p.note) rec.note = String(p.note).slice(0, 200);
      db.receipts.push(rec);
      logEvent(db, g, 'receipt', 'تسجيل استلام القسط رقم ' + p.no + ' من ' + g.installments + ' للعضو ' + m.name + (self ? ' (تسجيل ذاتي)' : ''),
        { actor: actor, memberId: m.id, vis: 'private', at: at, data: { receiptId: rec.id } });
      postSystem(db, g, 'received', { no: p.no, of: g.installments, name: m.name }, at);
      var prog = K.memberProgress(db, g, m, p.cycle, today);
      if (prog.paid === prog.total) postSystem(db, g, 'completed', { name: m.name, cycle: p.cycle }, at.slice(0, 11) + addMin(at.slice(11), 1));
      if (!self) notifyUser(db, g, m.userId, 'received', 'سجّل مدير جمعية ' + g.name + ' استلام القسط رقم ' + p.no + ' من ' + g.installments, at);
      return { receipt: clone(rec), status: 'paid', progress: prog };
    });
  }
  function correctReceipt(db, actor, receiptId, input) {
    return transact(db, function () {
      var K = C(); input = input || {};
      var rc = db.receipts.find(function (r) { return r.id === receiptId; });
      if (!rc) throw E('RECEIPT_NOT_FOUND', 'سجل الاستلام غير موجود');
      var g = mustGroup(db, rc.groupId); needManager(g, actor);
      if (rc.voided) throw E('ALREADY_VOIDED', 'هذا السجل صُحّح من قبل ولا يمكن تصحيحه مرة أخرى؛ صحّح السجل البديل إن وجد');
      var reason = String(input.reason == null ? '' : input.reason).trim();
      if (reason.length < 3) throw E('REASON_REQUIRED', 'اكتب سبب التصحيح (3 أحرف على الأقل)');
      if (reason.length > 200) throw E('REASON_TOO_LONG', 'سبب التصحيح طويل');
      var action = input.action || 'void';
      if (action !== 'void' && action !== 'amend') throw E('ACTION_INVALID', 'نوع التصحيح غير معروف');
      var m = mustMember(db, g, rc.memberId), at = nowAt(g.tz), today = at.slice(0, 10);
      var cid = nextId(db, 'cr'), before = { status: 'active', shareIds: rc.shareIds.slice(), sharesCount: rc.sharesCount, amount: rc.amount }, after, newRec = null;
      if (action === 'amend') {
        var want = Array.isArray(input.shareIds) ? input.shareIds.slice() : [];
        if (!want.length) throw E('SHARES_REQUIRED', 'اختر الأسهم التي استُلم قسطها');
        var mine = {}; K.memberShares(db, m.id).forEach(function (s) { mine[s.id] = 1; });
        var taken = {}; db.receipts.forEach(function (r) { if (!r.voided && r.id !== rc.id && r.memberId === m.id && r.cycle === rc.cycle && r.no === rc.no) r.shareIds.forEach(function (id) { taken[id] = 1; }); });
        var seen = {};
        want.forEach(function (id) {
          if (!mine[id]) throw E('SHARE_NOT_OWNED', 'سهم لا يخص هذا العضو');
          if (taken[id]) throw E('SHARE_ALREADY_RECORDED', 'سُجل استلام قسط أحد الأسهم المختارة من قبل');
          if (seen[id]) throw E('SHARE_DUPLICATE', 'سهم مكرر في الاختيار'); seen[id] = 1;
        });
        var per = K.shareAmounts(g)[rc.no - 1];
        newRec = { id: nextId(db, 'rc'), groupId: g.id, memberId: m.id, beneficiaryId: m.id, cycle: rc.cycle, no: rc.no, shareIds: want, sharesCount: want.length, amount: per * want.length,
          currency: g.currency, recordedAt: at, recordedBy: actor, recordedByName: g.managerName, self: !!(m.userId && m.userId === actor), periodStart: rc.periodStart, periodEnd: rc.periodEnd,
          statusAtRecord: K.obligation(db, g, m, rc.cycle, rc.no, today).status, status: 'active', voided: false, replacesId: rc.id, correctionId: cid };
        after = { status: 'active', shareIds: want.slice(), sharesCount: want.length, amount: newRec.amount, newReceiptId: newRec.id };
      } else after = { status: 'voided', shareIds: [], sharesCount: 0, amount: 0 };
      /* the original keeps every recorded value; only its standing flag changes, and the correction links to it */
      rc.voided = true; rc.status = 'voided'; rc.voidedAt = at; rc.voidedBy = actor; rc.correctionId = cid;
      if (newRec) db.receipts.push(newRec);
      db.corrections.push({ id: cid, groupId: g.id, receiptId: rc.id, memberId: m.id, kind: action, reason: reason, at: at, actor: actor, before: before, after: after, newReceiptId: newRec ? newRec.id : null });
      logEvent(db, g, 'correction', (action === 'void' ? 'تصحيح: إلغاء تسجيل استلام القسط رقم ' : 'تصحيح: تعديل تسجيل استلام القسط رقم ') + rc.no + ' للعضو ' + m.name + ' — ' + reason,
        { actor: actor, memberId: m.id, vis: 'private', at: at, data: { correctionId: cid, receiptId: rc.id } });
      return { correctionId: cid, correction: clone(db.corrections[db.corrections.length - 1]), receipt: clone(newRec), original: clone(rc) };
    });
  }

  /* ---------- reminders (never change an installment or create a receipt) ---------- */
  function sendReminder(db, actor, p) {
    return transact(db, function () {
      var K = C(); p = p || {};
      var g = mustGroup(db, p.groupId); needManager(g, actor);
      if (!Number.isInteger(p.cycle) || p.cycle < 1 || p.cycle > frozenCount(db, g)) throw E('CYCLE_INVALID', 'رقم الدورة غير صحيح');
      if (!Number.isInteger(p.no) || p.no < 1 || p.no > g.installments) throw E('INSTALLMENT_INVALID', 'رقم القسط غير صحيح');
      var at = nowAt(g.tz), today = at.slice(0, 10), targets;
      if (p.memberId) targets = [mustMember(db, g, p.memberId)];
      else targets = K.groupMembers(db, g.id).filter(function (m) { return K.memberShares(db, m.id).length; });
      var rows = targets.map(function (m) { return K.obligation(db, g, m, p.cycle, p.no, today); });
      if (rows.length && rows.every(function (o) { return o.status === 'upcoming'; })) throw E('NOT_YET_DUE', 'لم يحن موعد هذا القسط بعد');
      rows = rows.filter(function (o) { return o.status === 'due' || o.status === 'late'; });
      if (!rows.length) throw E(p.memberId ? 'ALREADY_PAID' : 'NO_RECIPIENTS', p.memberId ? 'هذا القسط مدفوع لهذا العضو' : 'لا يوجد مشاركون يحتاجون إلى تذكير بهذا القسط');
      var ids = rows.map(function (o) { return o.member.id; });
      var recent = db.reminders.filter(function (r) {
        return r.groupId === g.id && r.cycle === p.cycle && r.no === p.no && r.recipients.some(function (id) { return ids.indexOf(id) >= 0; }) && hoursBetween(r.at, at) < REMINDER_REPEAT_HOURS;
      });
      if (recent.length && !p.confirmRepeat) throw E('REMINDER_REPEAT', 'أُرسل تذكير بهذا القسط خلال الساعات الماضية. هل تريد إرسال تذكير آخر؟', { needsConfirm: true, lastAt: recent[recent.length - 1].at });
      var rem = { id: nextId(db, 'rm'), groupId: g.id, cycle: p.cycle, no: p.no, scope: p.memberId ? 'one' : 'all', recipients: ids, at: at, by: actor };
      db.reminders.push(rem);
      logEvent(db, g, 'reminder', 'تذكير بالقسط رقم ' + p.no + (p.memberId ? ' للعضو ' + rows[0].member.name : ' لـ ' + ids.length + ' من المشاركين'), { actor: actor, vis: 'manager', at: at, data: { reminderId: rem.id } });
      rows.forEach(function (o) { notifyUser(db, g, o.member.userId, 'reminder', 'تذكير: القسط رقم ' + p.no + ' من جمعية ' + g.name + (o.status === 'late' ? ' متأخر' : ' مستحق'), at); });
      return { reminder: clone(rem), recipients: ids.length };
    });
  }
  function lastReminder(db, gid, cycle, no, memberId) {
    var best = null;
    db.reminders.forEach(function (r) {
      if (r.groupId === gid && r.cycle === cycle && r.no === no && (!memberId || r.recipients.indexOf(memberId) >= 0) && (!best || r.at > best.at)) best = r;
    });
    return best ? clone(best) : null;
  }

  /* ---------- lottery ---------- */
  function drawStatus(db, gid) {
    var g = group(db, gid); if (!g) return fail('GROUP_NOT_FOUND', 'الجمعية غير موجودة');
    var K = C(), today = todayOf(g), draws = db.draws.filter(function (d) { return d.groupId === gid; }).sort(function (a, b) { return a.round - b.round; });
    var total = K.groupShares(db, gid).length, frozen = draws.length ? draws[0].shareCount : total, complete = frozen > 0 && draws.length >= frozen;
    var round = draws.length + 1, blockers = [];
    if (!total) blockers.push('NO_SHARES');
    if (complete) blockers.push('DRAW_COMPLETE');
    var sched = complete || !total ? null : K.roundDate(g, round);
    if (sched && today < sched) blockers.push('DRAW_NOT_DUE');
    var q = K.quorumInfo(db, g);
    return { ok: true, groupId: gid, rounds: frozen, drawn: draws.length, locked: draws.length > 0, complete: complete, round: complete ? null : round, scheduledDate: sched,
      due: !!sched && today >= sched, quorum: q, blockers: blockers, quorumMet: q.met, canDraw: !blockers.length && q.met, canDrawWithoutQuorum: !blockers.length,
      eligible: K.eligibleShares(db, gid).map(function (s) { return { shareId: s.id, memberId: s.memberId, label: K.shareLabel(db, s) }; }),
      prize: complete || !total ? null : K.prizeInfo(db, g, round, frozen) };
  }
  function performDraw(db, actor, gid, opts) {
    return transact(db, function () {
      var K = C(), g = mustGroup(db, gid); needManager(g, actor); opts = opts || {};
      var st = drawStatus(db, gid);
      if (st.blockers.indexOf('NO_SHARES') >= 0) throw E('NO_SHARES', 'لا توجد أسهم في الجمعية');
      if (st.blockers.indexOf('DRAW_COMPLETE') >= 0) throw E('DRAW_COMPLETE', 'اكتملت جميع جولات القرعة');
      if (st.blockers.indexOf('DRAW_NOT_DUE') >= 0) throw E('DRAW_NOT_DUE', 'لم يحن موعد قرعة الجولة ' + st.round + ' بعد (' + K.fmtDate(st.scheduledDate) + ')', { scheduledDate: st.scheduledDate });
      if (!st.quorumMet && !opts.overrideQuorum) throw E('QUORUM_NOT_MET', 'لم يكتمل نصاب الحضور (' + st.quorum.present + ' من ' + st.quorum.people + ' أشخاص)', { quorum: st.quorum });
      var elig = K.eligibleShares(db, gid); if (!elig.length) throw E('NO_ELIGIBLE_SHARES', 'لا توجد أسهم مؤهلة');
      var first = !st.locked, at = nowAt(g.tz), win = K.pickWinner(elig, opts.rng), frozen = st.rounds;
      var prize = K.prizeTarget(g, frozen), pi = K.prizeInfo(db, g, st.round, frozen);
      var d = { id: nextId(db, 'dr'), groupId: gid, round: st.round, date: st.scheduledDate, at: at, by: actor, winnerShareId: win.id, winnerMemberId: win.memberId,
        shareCount: frozen, prize: prize, recordedAtDraw: pi.recorded, eligibleShareIds: elig.map(function (s) { return s.id; }), quorum: st.quorum, overrideQuorum: !st.quorumMet };
      db.draws.push(d);
      var label = K.shareLabel(db, win), winner = db.members.find(function (m) { return m.id === win.memberId; });
      logEvent(db, g, 'draw', 'قرعة الجولة ' + st.round + ' — الفائز ' + winner.name + (st.quorumMet ? '' : ' (دون اكتمال النصاب)'), { actor: actor, at: at, data: { drawId: d.id } });
      var info = null;
      if (first) {
        g.lockedAt = at; var di = K.durationInfo(g, frozen); info = { rounds: frozen, endDate: di.endDate, lastDay: di.lastDay };
        logEvent(db, g, 'lock', 'تثبيت أول قرعة: أُقفلت الأعضاء والأسهم وثبت عدد الجولات (' + frozen + ') وتاريخ النهاية', { actor: actor, at: at, data: info });
      }
      db.emitted['drawDue:' + gid + ':' + st.round] = 1; db.emitted['drawSoon:' + gid + ':' + st.round] = 1;
      postSystem(db, g, 'drawResult', { round: st.round, label: label, prize: K.fmtMoney(prize, g.currency) }, at);
      db.members.forEach(function (m) {
        if (m.groupId === gid && m.userId) notifyUser(db, g, m.userId, 'drawResult', 'نتيجة قرعة الجولة ' + st.round + ' في ' + g.name + ': فاز ' + label, at);
      });
      return { draw: clone(d), winner: { shareId: win.id, memberId: win.memberId, label: label }, locked: true, firstDraw: first, lock: info };
    });
  }

  /* ---------- chat, notification settings, personal mute ---------- */
  function sendMessage(db, actor, gid, text) {
    return transact(db, function () {
      var g = mustGroup(db, gid), m = memberOf(db, g, actor), isMgr = g.managerUserId === actor;
      if (!m && !isMgr) throw E('FORBIDDEN', 'المحادثة لأعضاء الجمعية فقط');
      var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
      if (!t) throw E('MESSAGE_EMPTY', 'اكتب رسالة أولًا');
      var len = msgLength(t);
      if (len > MAX_MSG) throw E('MESSAGE_TOO_LONG', 'الحد الأقصى للرسالة ' + MAX_MSG + ' حرفًا', { length: len, max: MAX_MSG });
      var name = m ? m.name : g.managerName, at = nowAt(g.tz);
      var msg = postMember(db, g, name, actor, t, at);
      if (actor === me(db)) db.chatReads[gid] = at;
      return { message: clone(msg), remaining: MAX_MSG - len };
    });
  }
  function markChatRead(db, viewer, gid) {
    return transact(db, function () {
      var g = mustGroup(db, gid), r = viewerRole(db, g, viewer);
      if (!r.manager && !memberOf(db, g, viewer)) throw E('FORBIDDEN', 'المحادثة لأعضاء الجمعية فقط');
      db.chatReads[gid] = nowAt(g.tz); return {};
    });
  }
  function setNotifyType(db, actor, gid, typeId, enabled) {
    return transact(db, function () {
      var g = mustGroup(db, gid); needManager(g, actor);
      var t = NOTIFY_TYPES.find(function (x) { return x.id === typeId; });
      if (!t) throw E('NOTIFY_TYPE_UNKNOWN', 'نوع إشعار غير معروف');
      g.notify[typeId] = !!enabled;
      logEvent(db, g, 'notify-setting', (enabled ? 'تفعيل' : 'إيقاف') + ' نشر «' + t.label + '» في المحادثة', { actor: actor, vis: 'manager' });
      return { notify: clone(g.notify) };
    });
  }
  function setMute(db, viewer, gid, patch) {
    return transact(db, function () {
      var g = mustGroup(db, gid), r = viewerRole(db, g, viewer);
      if (!r.manager && !memberOf(db, g, viewer)) throw E('FORBIDDEN', 'لا تملك عضوية في هذه الجمعية');
      patch = patch || {};
      var cur = Object.assign({ group: false, reminders: false }, db.prefs.mute[gid] || {});
      if (patch.group !== undefined) cur.group = !!patch.group;
      if (patch.reminders !== undefined) cur.reminders = !!patch.reminders;
      db.prefs.mute[gid] = cur;
      db.notifications.forEach(function (n) { if (n.groupId === gid && !n.read) n.muted = isMuted(db, gid, n.type); });
      return { mute: clone(cur) };
    });
  }
  function markNotificationsRead(db, viewer, ids) {
    return transact(db, function () {
      var n = 0;
      db.notifications.forEach(function (x) { if (x.userId === viewer && !x.read && (!ids || ids.indexOf(x.id) >= 0)) { x.read = true; n++; } });
      return { marked: n };
    });
  }

  /* =====================================================================================
     READ-SIDE QUERIES — viewer-aware: the manager sees every member, a participant only their own
     ===================================================================================== */
  function roleOf(db, g, userId) {
    var uid = userId || db.prefs.user.id, K = C();
    var me_ = db.members.find(function (m) { return m.groupId === g.id && m.userId === uid; });
    var manager = g.managerUserId === uid, part = !!(me_ && K.memberShares(db, me_.id).length);
    return { manager: manager, participant: part, member: me_ || null,
      label: manager && part ? 'مدير ومشارك' : manager ? 'مدير' : 'مشارك', shares: me_ ? K.memberShares(db, me_.id).length : 0 };
  }
  function myGroups(db, userId) {
    var managed = [], joined = [];
    db.groups.forEach(function (g) { var r = roleOf(db, g, userId); if (r.manager) managed.push(g); else if (r.participant) joined.push(g); });
    return { managed: managed, joined: joined };
  }
  var PHASE_LABEL = { pending: 'لم تبدأ بعد', open: 'قبل أول قرعة', running: 'جارية', completed: 'مكتملة' };
  function phase(db, g, today) {
    var total = C().groupShares(db, g.id).length, drawn = db.draws.filter(function (d) { return d.groupId === g.id; }).length;
    if (!drawn) return today < g.startDate ? 'pending' : 'open';
    return drawn >= frozenCount(db, g) ? 'completed' : 'running';
  }
  function groupSummary(db, g, today, viewer) {
    var K = C(), r = roleOf(db, g, viewer), total = K.groupShares(db, g.id).length, drawn = db.draws.filter(function (d) { return d.groupId === g.id; }).length;
    var ph = phase(db, g, today), cyc = Math.max(1, K.currentCycle(g, today, total) || 1);
    var out = { group: g, role: r, phase: ph, phaseLabel: PHASE_LABEL[ph], totalShares: total, target: g.targetShares, drawn: drawn,
      rounds: total, locked: drawn > 0, cycle: cyc, nextDraw: drawn < total ? K.roundDate(g, drawn + 1) : null,
      members: K.groupMembers(db, g.id).filter(function (m) { return K.memberShares(db, m.id).length; }).length };
    if (r.participant) out.myProgress = K.memberProgress(db, g, r.member, cyc, today);
    if (r.manager) {
      var all = ph === 'pending' ? [] : K.cycleObligations(db, g, cyc, today);
      out.counts = { paid: 0, due: 0, late: 0, upcoming: 0 };
      all.forEach(function (o) { out.counts[o.status]++; });
      out.collected = all.length ? all.filter(function (o) { return o.status === 'paid'; }).length : 0;
      out.totalInstallments = all.length;
    }
    return out;
  }
  function groupMessages(db, gid) { return db.messages.filter(function (m) { return m.groupId === gid; }); }
  function unreadCount(db, gid) {
    var last = db.chatReads[gid] || '0000-00-00T00:00';
    return groupMessages(db, gid).filter(function (m) { return m.at > last && m.userId !== 'me'; }).length;
  }
  function chatList(db) {
    return db.groups.filter(function (g) { var r = roleOf(db, g); return r.manager || r.participant; }).map(function (g) {
      var msgs = groupMessages(db, g.id), last = msgs[msgs.length - 1] || null;
      return { group: g, last: last, unread: unreadCount(db, g.id), muted: !!(db.prefs.mute[g.id] && db.prefs.mute[g.id].group) };
    }).sort(function (a, b) { var aAt = a.last ? a.last.at : '', bAt = b.last ? b.last.at : ''; return aAt === bAt ? 0 : (aAt < bAt ? 1 : -1); });
  }
  function totalUnreadNotifications(db) { return db.notifications.filter(function (n) { return !n.read && !n.muted; }).length; }
  function eventVisible(e, role) {
    if (role.manager) return true;
    if (e.vis === 'group' || e.vis === undefined) return true;
    return e.vis === 'private' && !!role.member && e.memberId === role.member.id;
  }
  function recentActivity(db, n, viewer) {
    var ids = {}; db.groups.forEach(function (g) { var r = roleOf(db, g, viewer); if (r.manager || r.participant) ids[g.id] = { g: g, r: r }; });
    var icon = { join: 'user-plus', receipt: 'receipt', draw: 'layers' };
    return db.events.filter(function (e) { return ids[e.groupId] && eventVisible(e, ids[e.groupId].r); }).slice(0, n || 3).map(function (e) {
      return { title: e.text, groupId: e.groupId, groupName: ids[e.groupId].g.name, at: e.at, icon: icon[e.type] || 'activity' };
    });
  }

  function guardView(db, viewer, gid) {
    var g = group(db, gid); if (!g) return { err: fail('GROUP_NOT_FOUND', 'الجمعية غير موجودة') };
    var role = viewerRole(db, g, viewer);
    if (!role.manager && !role.member) return { err: fail('FORBIDDEN', 'لا تملك صلاحية عرض هذه الجمعية') };
    return { g: g, role: role };
  }
  function statusRow(g, o, includeName) {
    var last = o.receipts[o.receipts.length - 1] || null;
    return { memberId: o.member.id, memberName: o.member.name, shares: o.shares, paidShares: o.paidShares, cycle: o.cycle, no: o.no, of: g.installments,
      periodStart: o.range.start, periodEnd: o.range.end, perShare: o.perShare, total: o.total, remaining: o.remaining,
      status: o.status, statusLabel: C().STATUS_LABEL[o.status], lateByJoin: o.lateByJoin, partial: o.paidShares > 0 && o.unpaidShares.length > 0,
      receiptId: last ? last.id : null, recordedAt: last ? last.recordedAt : null };
  }
  /* unified installments screen: one list for the cycle; manager = everyone, participant = own rows only */
  function installmentRows(db, viewer, gid, opts) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err;
    var K = C(), g = v.g; opts = opts || {};
    var today = todayOf(g), total = frozenCount(db, g); if (!total) return fail('NO_SHARES', 'لا توجد أسهم بعد');
    var cyc = opts.cycle || Math.max(1, K.currentCycle(g, today, total) || 1);
    if (!Number.isInteger(cyc) || cyc < 1 || cyc > total) return fail('CYCLE_INVALID', 'رقم الدورة غير صحيح');
    var members = v.role.manager ? K.groupMembers(db, gid).filter(function (m) { return K.memberShares(db, m.id).length; }) : [v.role.member];
    var rows = [], counts = { paid: 0, due: 0, late: 0, upcoming: 0 };
    members.forEach(function (m) { for (var k = 1; k <= g.installments; k++) { var o = K.obligation(db, g, m, cyc, k, today); counts[o.status]++; rows.push(statusRow(g, o)); } });
    var filtered = rows;
    if (opts.status && opts.status !== 'all') filtered = filtered.filter(function (r) { return r.status === opts.status; });
    if (opts.installment) filtered = filtered.filter(function (r) { return r.no === opts.installment; });
    if (opts.query && v.role.manager) { var q = String(opts.query).trim(); if (q) filtered = filtered.filter(function (r) { return r.memberName.indexOf(q) >= 0; }); }
    var out = { ok: true, groupId: gid, cycle: cyc, cycles: total, scope: v.role.manager ? 'all' : 'own', rows: filtered, counts: counts, currency: g.currency };
    if (v.role.member) out.progress = K.memberProgress(db, g, v.role.member, cyc, today);
    return out;
  }
  function memberStatement(db, viewer, gid, memberId) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err;
    var K = C(), g = v.g, m = db.members.find(function (x) { return x.id === memberId && x.groupId === gid; });
    if (!m) return fail('MEMBER_NOT_FOUND', 'العضو غير موجود');
    if (!v.role.manager && (!v.role.member || v.role.member.id !== m.id)) return fail('FORBIDDEN', 'لا تملك صلاحية عرض أقساط عضو آخر');
    var today = todayOf(g), total = frozenCount(db, g), cyc = Math.max(1, K.currentCycle(g, today, total) || 1), cycles = [];
    var upto = K.memberShares(db, m.id).length ? Math.min(cyc, total) : 0;
    for (var c = 1; c <= upto; c++) {
      var rows = []; for (var k = 1; k <= g.installments; k++) rows.push(statusRow(g, K.obligation(db, g, m, c, k, today)));
      cycles.push({ cycle: c, progress: K.memberProgress(db, g, m, c, today), rows: rows });
    }
    var shares = K.memberShares(db, m.id).length;
    return { ok: true, groupId: gid, memberId: m.id, memberName: m.name, shares: shares, currency: g.currency, commitment: K.memberCommitment(g, shares, total), cycles: cycles };
  }
  function receiptView(db, r) {
    var m = db.members.find(function (x) { return x.id === r.memberId; });
    var c = clone(r); c.memberName = m ? m.name : '—'; c.corrections = db.corrections.filter(function (x) { return x.receiptId === r.id || x.newReceiptId === r.id; }).map(clone);
    return c;
  }
  function receiptList(db, viewer, gid, opts) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err; opts = opts || {};
    var list = db.receipts.filter(function (r) { return r.groupId === gid && (v.role.manager || (v.role.member && r.memberId === v.role.member.id)); });
    if (opts.memberId && v.role.manager) list = list.filter(function (r) { return r.memberId === opts.memberId; });
    if (!opts.includeVoided) list = list.filter(function (r) { return !r.voided; });
    list.sort(function (a, b) { return a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0; });
    return { ok: true, groupId: gid, receipts: list.map(function (r) { return receiptView(db, r); }) };
  }
  function receiptDetail(db, viewer, receiptId) {
    var r = db.receipts.find(function (x) { return x.id === receiptId; });
    if (!r) return fail('RECEIPT_NOT_FOUND', 'سجل الاستلام غير موجود');
    var v = guardView(db, viewer, r.groupId); if (v.err) return v.err;
    if (!v.role.manager && (!v.role.member || v.role.member.id !== r.memberId)) return fail('FORBIDDEN', 'لا تملك صلاحية عرض هذا السجل');
    var out = receiptView(db, r); out.ok = true; out.canCorrect = v.role.manager && !r.voided; return out;
  }
  function eventLog(db, viewer, gid, opts) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err; opts = opts || {};
    var list = db.events.filter(function (e) { return e.groupId === gid && eventVisible(e, v.role); });
    if (opts.limit) list = list.slice(0, opts.limit);
    return { ok: true, groupId: gid, events: list.map(clone) };
  }
  function memberList(db, viewer, gid) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err; var K = C();
    var list = K.groupMembers(db, gid).filter(function (m) { return K.memberShares(db, m.id).length; }).map(function (m) {
      var row = { memberId: m.id, name: m.name, shares: K.memberShares(db, m.id).length, isManager: !!m.isManager, isMe: m.userId === viewer };
      if (v.role.manager) { row.present = !!m.present; row.joinedAt = m.joinedAt; row.linkedUser = !!m.userId; }
      return row;
    });
    return { ok: true, groupId: gid, scope: v.role.manager ? 'manager' : 'participant', members: list, quorum: v.role.manager ? K.quorumInfo(db, v.g) : undefined };
  }
  function drawHistory(db, viewer, gid) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err; var K = C();
    var list = db.draws.filter(function (d) { return d.groupId === gid; }).sort(function (a, b) { return a.round - b.round; }).map(function (d) {
      var s = db.shares.find(function (x) { return x.id === d.winnerShareId; });
      return { id: d.id, round: d.round, date: d.date, at: d.at, winnerShareId: d.winnerShareId, winnerLabel: s ? K.shareLabel(db, s) : '—', prize: d.prize, recordedAtDraw: d.recordedAtDraw };
    });
    return { ok: true, groupId: gid, draws: list, status: drawStatus(db, gid) };
  }
  function notificationList(db, viewer) {
    return { ok: true, notifications: db.notifications.filter(function (n) { return n.userId === viewer; }).map(clone), unread: db.notifications.filter(function (n) { return n.userId === viewer && !n.read && !n.muted; }).length };
  }
  function chatView(db, viewer, gid) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err; var today = todayOf(v.g);
    return { ok: true, groupId: gid, maxLength: MAX_MSG, muted: !!(db.prefs.mute[gid] && db.prefs.mute[gid].group),
      messages: groupMessages(db, gid).map(function (m) { var c = clone(m); c.mine = m.kind === 'member' && m.userId === viewer; c.timeLabel = chatTime(m.at, today); return c; }) };
  }
  /* one call for the association details screen */
  function groupDetail(db, viewer, gid) {
    var v = guardView(db, viewer, gid); if (v.err) return v.err;
    var K = C(), g = v.g, today = todayOf(g), sum = groupSummary(db, g, today, viewer), locked = sum.locked;
    var hasReceipts = db.receipts.some(function (r) { return r.groupId === gid && !r.voided; });
    var rounds = frozenCount(db, g), pub = clone(g); if (!v.role.manager) delete pub.inviteCode;
    var out = { ok: true, group: pub, role: { manager: v.role.manager, participant: !!v.role.member, label: roleOf(db, g, viewer).label, shares: v.role.member ? K.memberShares(db, v.role.member.id).length : 0 },
      phase: sum.phase, phaseLabel: sum.phaseLabel, locked: locked, rounds: rounds, provisional: !locked, shortfall: Math.max(0, g.targetShares - K.groupShares(db, gid).length),
      drawn: sum.drawn, nextDraw: sum.nextDraw, cycle: sum.cycle, plan: K.groupPlan(g, rounds), members: sum.members, previewNote: LOCAL_PREVIEW_NOTE, privacyNote: PRIVACY_NOTE,
      permissions: { canEdit: v.role.manager, canEditFinancials: v.role.manager && !locked && !hasReceipts, canAddMembers: v.role.manager && !locked, canInvite: v.role.manager && !locked,
        canRecordPaid: v.role.manager, canCorrect: v.role.manager, canRemind: v.role.manager, canDraw: v.role.manager, canSetNotify: v.role.manager, canChat: true, canMute: true } };
    if (v.role.manager) { out.counts = sum.counts; out.quorum = K.quorumInfo(db, g); out.invites = inviteSummary(db, gid); out.lockedAt = g.lockedAt; }
    if (v.role.member) { out.myProgress = sum.myProgress; out.myCommitment = K.memberCommitment(g, out.role.shares, rounds); }
    return out;
  }

  root.SahmData = {
    VERSION: DATA_VERSION, MAX_MSG: MAX_MSG, NOTIFY_TYPES: NOTIFY_TYPES, PHASE_LABEL: PHASE_LABEL, TZ: TZ, PRIVACY_NOTE: PRIVACY_NOTE, LOCAL_PREVIEW_NOTE: LOCAL_PREVIEW_NOTE,
    KEYS: { data: DATA_KEY, prefs: PREFS_KEY, archive: ARCHIVE_KEY },
    /* store */
    buildSeed: buildSeed, load: load, save: save, normalizeDb: normalizeDb, tick: tick, storageState: storageState, takeNotices: takeNotices, archiveList: archiveList, resetAll: resetAll,
    setClock: setClock, nowAt: nowAt, chatTime: chatTime, nextId: nextId, msgLength: msgLength, me: me,
    /* legacy-compatible helpers */
    postSystem: postSystem, postMember: postMember, group: group, roleOf: roleOf, myGroups: myGroups, phase: phase,
    groupSummary: groupSummary, groupMessages: groupMessages, unreadCount: unreadCount, chatList: chatList,
    totalUnreadNotifications: totalUnreadNotifications, recentActivity: recentActivity,
    /* operations */
    createGroup: createGroup, updateGroup: updateGroup, previewJoin: previewJoin, addMember: addMember, addShares: addShares, removeShares: removeShares, removeMember: removeMember,
    setAttendance: setAttendance, inviteSummary: inviteSummary, createInvite: createInvite, cancelInvite: cancelInvite, getInviteInfo: getInviteInfo, joinByCode: joinByCode,
    recordPaid: recordPaid, correctReceipt: correctReceipt, sendReminder: sendReminder, lastReminder: lastReminder, drawStatus: drawStatus, performDraw: performDraw,
    sendMessage: sendMessage, markChatRead: markChatRead, setNotifyType: setNotifyType, setMute: setMute, isMuted: isMuted, markNotificationsRead: markNotificationsRead,
    /* queries */
    groupDetail: groupDetail, installmentRows: installmentRows, memberStatement: memberStatement, receiptList: receiptList, receiptDetail: receiptDetail,
    eventLog: eventLog, memberList: memberList, inviteList: inviteList, drawHistory: drawHistory, notificationList: notificationList, chatView: chatView
  };
})(typeof window !== 'undefined' ? window : globalThis);
