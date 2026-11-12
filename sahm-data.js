/* SAHM data layer — store versioning, fresh preview dataset, and read-side queries.
   The dataset is generated relative to "today" so installment states stay realistic.
   Depends on window.SahmCore. No DOM access. */
(function (root) {
  'use strict';
  var C = function () { return root.SahmCore; };
  var TZ = 'Asia/Aden';
  var DATA_VERSION = 'sahm-data-2026-11-v3';
  var DATA_KEY = 'sahm_preview_data_v3';
  var PREFS_KEY = 'sahm_preview_prefs_v1';
  var LEGACY_KEYS = ['sahm_preview_db'];
  var MAX_MSG = 50;

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
  var TPL = {
    received: function (v) { return 'سجّل مدير الجمعية استلام القسط رقم ' + v.no + ' من ' + v.of + ' للعضو ' + v.name; },
    completed: function (v) { return 'أكمل ' + v.name + ' جميع أقساط الدورة ' + v.cycle + '. جزاه الله خيرًا'; },
    late: function (v) { return 'تأخر ' + v.name + ' عن القسط رقم ' + v.no + ' من الدورة ' + v.cycle; },
    drawSoon: function (v) { return 'تقترب قرعة الجولة ' + v.round + '، وموعدها ' + v.date; },
    drawDue: function (v) { return 'حلّ اليوم موعد قرعة الجولة ' + v.round; },
    drawResult: function (v) { return 'نتيجة قرعة الجولة ' + v.round + ': فاز ' + v.label + ' بجائزة ' + v.prize; },
    joined: function (v) { return 'انضم ' + v.name + ' إلى الجمعية بـ ' + v.shares + ' ' + (v.shares === 1 ? 'سهم' : 'أسهم'); },
    motivate: function (v) { return v.text; }
  };

  /* ---------- time helpers ---------- */
  function nowAt() {
    try {
      var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
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

  /* ---------- message creation (single place used by seed and later by actions) ---------- */
  function nextId(db, p) { db.seq = (db.seq || 0) + 1; return p + '-' + db.seq; }
  function postSystem(db, g, type, vars, at) {
    if (!g.notify[type]) return null;
    var m = { id: nextId(db, 'msg'), groupId: g.id, kind: 'system', senderName: 'سهم', type: type, text: TPL[type](vars), at: at };
    db.messages.push(m); return m;
  }
  function postMember(db, g, senderName, userId, text, at) {
    var m = { id: nextId(db, 'msg'), groupId: g.id, kind: 'member', senderName: senderName, userId: userId || null, text: text, at: at };
    db.messages.push(m); return m;
  }

  /* ---------- seed ---------- */
  function buildSeed(anchor) {
    var K = C(), db = {
      version: DATA_VERSION, seededOn: anchor, seq: 0,
      groups: [], members: [], shares: [], receipts: [], draws: [], messages: [], events: [],
      notifications: [], chatReads: {}, reminders: [], invites: []
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
          if (!paid) postSystem(db, g, 'late', { name: m.name, no: k2, cycle: c2 }, K.addDays(r2.end, 1) + 'T09:00');
        }
      });

      /* lottery rounds */
      sp.draws.forEach(function (dr) {
        var m = byName[dr.member], sh = db.shares.find(function (s) { return s.memberId === m.id && s.no === dr.no; });
        var date = K.roundDate(g, dr.round);
        db.draws.push({ id: nextId(db, 'dr'), groupId: g.id, round: dr.round, date: date, winnerShareId: sh.id, shareCount: total, prize: K.prizeTarget(g, total) });
        db.events.push({ id: nextId(db, 'ev'), groupId: g.id, at: date + 'T12:00', type: 'draw', text: 'قرعة الجولة ' + dr.round + ' — الفائز ' + m.name });
        postSystem(db, g, 'drawDue', { round: dr.round }, date + 'T09:00');
        postSystem(db, g, 'drawResult', { round: dr.round, label: K.shareLabel(db, sh), prize: K.fmtMoney(K.prizeTarget(g, total), g.currency) }, date + 'T12:05');
      });
      var nextRound = sp.draws.length + 1;
      if (nextRound <= total && g.startDate <= anchor) {
        var nd = K.roundDate(g, nextRound);
        if (K.addDays(nd, -4) <= K.addDays(anchor, -1)) postSystem(db, g, 'drawSoon', { round: nextRound, date: K.fmtDate(nd) }, K.addDays(nd, -4) + 'T09:00');
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
    return db;
  }
  function addMin(hm, n) { var p = hm.split(':').map(Number), t = p[0] * 60 + p[1] + n; return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }

  /* ---------- store: versioned data + separate user preferences ---------- */
  function defaultPrefs() {
    return { session: false, verified: false, user: { id: 'me', name: 'أحمد محمد', phone: '+967 777 123 456', city: 'تعز' }, notifications: true, biometric: false, mute: {} };
  }
  function lsGet(k) { try { return JSON.parse(root.localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable: state stays in memory */ } }
  function loadPrefs() {
    var p = lsGet(PREFS_KEY);
    if (p) return Object.assign(defaultPrefs(), p, { user: Object.assign(defaultPrefs().user, p.user || {}) });
    var base = defaultPrefs(), old = null;
    LEGACY_KEYS.forEach(function (k) { old = old || lsGet(k); });
    if (old && old.user) { /* keep only account preferences from the retired preview store */
      base.user.name = old.user.name || base.user.name; base.user.phone = old.user.phone || base.user.phone; base.user.city = old.user.city || base.user.city;
      base.session = !!old.session; base.verified = !!old.verified;
      base.notifications = old.user.notifications !== false; base.biometric = !!old.user.biometric;
    }
    return base;
  }
  function load() {
    var prefs = loadPrefs(), db = lsGet(DATA_KEY);
    if (!db || db.version !== DATA_VERSION) db = buildSeed(C().todayIn(TZ));
    LEGACY_KEYS.forEach(function (k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    db.prefs = prefs; save(db); return db;
  }
  function save(db) { var p = db.prefs; var copy = Object.assign({}, db); delete copy.prefs; lsSet(DATA_KEY, copy); lsSet(PREFS_KEY, p); }

  /* ---------- read-side queries ---------- */
  function group(db, id) { return db.groups.find(function (g) { return g.id === id; }); }
  function roleOf(db, g) {
    var me = db.members.find(function (m) { return m.groupId === g.id && m.userId === 'me'; });
    var manager = g.managerUserId === 'me', part = !!(me && C().memberShares(db, me.id).length);
    return { manager: manager, participant: part, member: me || null,
      label: manager && part ? 'مدير ومشارك' : manager ? 'مدير' : 'مشارك', shares: me ? C().memberShares(db, me.id).length : 0 };
  }
  function myGroups(db) {
    var managed = [], joined = [];
    db.groups.forEach(function (g) { var r = roleOf(db, g); if (r.manager) managed.push(g); else if (r.participant) joined.push(g); });
    return { managed: managed, joined: joined };
  }
  var PHASE_LABEL = { pending: 'لم تبدأ بعد', open: 'قبل أول قرعة', running: 'جارية', completed: 'مكتملة' };
  function phase(db, g, today) {
    var total = C().groupShares(db, g.id).length, drawn = db.draws.filter(function (d) { return d.groupId === g.id; }).length;
    if (!drawn) return today < g.startDate ? 'pending' : 'open';
    return drawn >= total ? 'completed' : 'running';
  }
  function groupSummary(db, g, today) {
    var K = C(), r = roleOf(db, g), total = K.groupShares(db, g.id).length, drawn = db.draws.filter(function (d) { return d.groupId === g.id; }).length;
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
    }).sort(function (a, b) { return (b.last ? b.last.at : '') < (a.last ? a.last.at : '') ? -1 : 1; });
  }
  function totalUnreadNotifications(db) { return db.notifications.filter(function (n) { return !n.read; }).length; }
  function recentActivity(db, n) {
    var ids = {}; db.groups.forEach(function (g) { var r = roleOf(db, g); if (r.manager || r.participant) ids[g.id] = g; });
    var icon = { join: 'user-plus', receipt: 'receipt', draw: 'layers' };
    return db.events.filter(function (e) { return ids[e.groupId]; }).slice(0, n || 3).map(function (e) {
      return { title: e.text, groupId: e.groupId, groupName: ids[e.groupId].name, at: e.at, icon: icon[e.type] || 'activity' };
    });
  }

  root.SahmData = {
    VERSION: DATA_VERSION, MAX_MSG: MAX_MSG, NOTIFY_TYPES: NOTIFY_TYPES, PHASE_LABEL: PHASE_LABEL, TZ: TZ,
    buildSeed: buildSeed, load: load, save: save, nowAt: nowAt, chatTime: chatTime, nextId: nextId,
    postSystem: postSystem, postMember: postMember, group: group, roleOf: roleOf, myGroups: myGroups, phase: phase,
    groupSummary: groupSummary, groupMessages: groupMessages, unreadCount: unreadCount, chatList: chatList,
    totalUnreadNotifications: totalUnreadNotifications, recentActivity: recentActivity
  };
})(typeof window !== 'undefined' ? window : globalThis);
