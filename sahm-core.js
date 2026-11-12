/* SAHM core engine — pure calculation rules from the unified reference v2.
   No DOM access. Dates are ISO strings (YYYY-MM-DD) in the association time zone. */
(function (root) {
  'use strict';
  var DAY = 86400000;

  /* ---------- currencies (amounts are stored in minor units) ---------- */
  var CURRENCIES = {
    YER: { name: 'ريال يمني', short: 'ر.ي', minor: 1 },
    SAR: { name: 'ريال سعودي', short: 'ر.س', minor: 100 },
    USD: { name: 'دولار أمريكي', short: '$', minor: 100 }
  };
  function toMinor(major, cur) { return Math.round(Number(major) * CURRENCIES[cur].minor); }
  function fmtMoney(minor, cur) {
    var c = CURRENCIES[cur] || CURRENCIES.YER, v = minor / c.minor;
    var s = new Intl.NumberFormat('ar-YE', { maximumFractionDigits: c.minor > 1 ? 2 : 0 }).format(v);
    return s + ' ' + c.short;
  }

  /* ---------- dates ---------- */
  function toDay(iso) { var p = iso.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / DAY); }
  function fromDay(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function addDays(iso, n) { return fromDay(toDay(iso) + n); }
  function diffDays(a, b) { return toDay(a) - toDay(b); }
  function todayIn(tz) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function fmtDate(iso, opts) {
    if (!iso) return '—';
    var d = new Date(toDay(iso) * DAY);
    return new Intl.DateTimeFormat('ar-YE', Object.assign({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }, opts || {})).format(d);
  }

  /* ---------- cycle model ---------- */
  function cycleLen(g) {
    if (g.cycleType === 'weekly') return 7;
    if (g.cycleType === 'monthly') return 30;
    return Math.max(1, Math.floor(Number(g.cycleDays) || 0));
  }
  var CYCLE_LABEL = { weekly: 'أسبوعية', monthly: 'شهرية', custom: 'مخصصة' };
  function cycleLabel(g) { return g.cycleType === 'custom' ? 'كل ' + cycleLen(g) + ' يومًا' : CYCLE_LABEL[g.cycleType]; }

  /* installment period k (1..N) inside a cycle of D days: [start,end] as day numbers 1..D */
  function periods(D, N) {
    var out = [], prev = 0;
    for (var k = 1; k <= N; k++) { var end = Math.floor(k * D / N); out.push({ no: k, from: prev + 1, to: end }); prev = end; }
    return out;
  }
  function maxInstallments(g) { return cycleLen(g); }

  /* split T (minor units) across N installments, remainder to the first ones */
  function splitAmount(T, N) {
    var base = Math.floor(T / N), rem = T % N, out = [];
    for (var i = 0; i < N; i++) out.push(base + (i < rem ? 1 : 0));
    return out;
  }

  function cycleStart(g, c) { return addDays(g.startDate, (c - 1) * cycleLen(g)); }
  function instRange(g, c, k) {
    var p = periods(cycleLen(g), g.installments)[k - 1], cs = cycleStart(g, c);
    return { start: addDays(cs, p.from - 1), end: addDays(cs, p.to - 1), from: p.from, to: p.to };
  }
  function firstDrawDate(g) { return addDays(g.startDate, cycleLen(g)); }
  function roundDate(g, r) { return addDays(g.startDate, r * cycleLen(g)); }
  function durationInfo(g, shareCount) {
    var days = shareCount * cycleLen(g), end = addDays(g.startDate, days);
    return { rounds: shareCount, days: days, endDate: end, lastDay: addDays(end, -1) };
  }
  function currentCycle(g, today, totalCycles) {
    var d = diffDays(today, g.startDate);
    if (d < 0) return 0;
    var c = Math.floor(d / cycleLen(g)) + 1;
    return totalCycles ? Math.min(c, totalCycles) : c;
  }

  /* ---------- installment status (three operational states + upcoming display) ---------- */
  function instStatus(range, paid, today) {
    if (paid) return 'paid';
    if (today < range.start) return 'upcoming';
    if (today <= range.end) return 'due';
    return 'late';
  }
  var STATUS_LABEL = { paid: 'مدفوع', due: 'مستحق', late: 'متأخر', upcoming: 'لم يحن موعده بعد' };

  /* ---------- db-based helpers (db = the preview store) ---------- */
  function groupShares(db, gid) { return db.shares.filter(function (s) { return s.groupId === gid; }); }
  function memberShares(db, mid) { return db.shares.filter(function (s) { return s.memberId === mid; }); }
  function groupMembers(db, gid) { return db.members.filter(function (m) { return m.groupId === gid; }); }
  function isLocked(db, gid) { return db.draws.some(function (d) { return d.groupId === gid; }); }
  function shareAmounts(g) { return splitAmount(g.shareAmount, g.installments); }

  /* obligation of one member for one installment (cycle c, number k) */
  function obligation(db, g, member, c, k, today) {
    var shares = memberShares(db, member.id), amounts = shareAmounts(g), per = amounts[k - 1];
    var recs = db.receipts.filter(function (r) { return r.memberId === member.id && r.cycle === c && r.no === k && !r.voided; });
    var paidIds = {}; recs.forEach(function (r) { r.shareIds.forEach(function (id) { paidIds[id] = r; }); });
    var unpaid = shares.filter(function (s) { return !paidIds[s.id]; });
    var range = instRange(g, c, k);
    var allPaid = shares.length > 0 && unpaid.length === 0;
    var status = instStatus(range, allPaid, today);
    var joinLate = range.end < member.joinedAt;
    return {
      member: member, cycle: c, no: k, range: range, status: status, perShare: per,
      shares: shares.length, unpaidShares: unpaid, total: per * shares.length, remaining: per * unpaid.length,
      receipts: recs, lateByJoin: joinLate && status === 'late'
    };
  }
  function cycleObligations(db, g, c, today) {
    var out = [];
    groupMembers(db, g.id).forEach(function (m) {
      if (!memberShares(db, m.id).length) return;
      for (var k = 1; k <= g.installments; k++) out.push(obligation(db, g, m, c, k, today));
    });
    return out;
  }
  function memberProgress(db, g, member, c, today) {
    var paid = 0, total = g.installments;
    for (var k = 1; k <= total; k++) if (obligation(db, g, member, c, k, today).status === 'paid') paid++;
    return { paid: paid, total: total };
  }

  /* what a late joiner would owe immediately (preview before confirming) */
  function lateJoinPreview(g, joinDate, sharesCount, today, totalCycles) {
    var out = [], cyc = currentCycle(g, today, totalCycles), amounts = shareAmounts(g);
    for (var c = 1; c <= Math.max(cyc, 0); c++) for (var k = 1; k <= g.installments; k++) {
      var r = instRange(g, c, k);
      if (r.end < joinDate) out.push({ cycle: c, no: k, amount: amounts[k - 1] * sharesCount });
    }
    return { items: out, total: out.reduce(function (a, x) { return a + x.amount; }, 0) };
  }

  /* ---------- lottery ---------- */
  function eligibleShares(db, gid) {
    var won = {}; db.draws.filter(function (d) { return d.groupId === gid; }).forEach(function (d) { won[d.winnerShareId] = 1; });
    return groupShares(db, gid).filter(function (s) { return !won[s.id]; });
  }
  function shareLabel(db, s) {
    var m = db.members.find(function (x) { return x.id === s.memberId; });
    var owned = memberShares(db, s.memberId);
    return (m ? m.name : '—') + (owned.length > 1 ? ' · السهم ' + (owned.indexOf(s) + 1) : '');
  }
  function pickWinner(list) {
    var n = list.length; if (!n) return null;
    var buf = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n, x;
    do { (root.crypto || root.msCrypto).getRandomValues(buf); x = buf[0]; } while (x >= lim);
    return list[x % n];
  }
  function prizeTarget(g, shareCount) { return shareCount * g.shareAmount; }

  /* attendance quorum counts people, not shares */
  function quorumInfo(db, g) {
    var people = groupMembers(db, g.id).filter(function (m) { return memberShares(db, m.id).length; });
    var present = people.filter(function (m) { return m.present; }).length;
    var pct = people.length ? Math.round(present / people.length * 100) : 0;
    return { present: present, people: people.length, pct: pct, met: people.length > 0 && pct >= g.quorum };
  }

  /* ---------- validation for creating an association ---------- */
  function validateBasics(d) {
    var errs = [];
    if (!d.name || !d.name.trim()) errs.push('أدخل اسم الجمعية');
    if (!CURRENCIES[d.currency]) errs.push('اختر العملة');
    if (!/^(weekly|monthly|custom)$/.test(d.cycleType || '')) errs.push('اختر دورة القرعة');
    var D = cycleLen(d);
    if (d.cycleType === 'custom' && (!Number.isInteger(Number(d.cycleDays)) || Number(d.cycleDays) < 1)) errs.push('أدخل عدد أيام الدورة المخصصة');
    if (!(Number(d.shareAmount) > 0)) errs.push('أدخل حصة السهم في الدورة');
    var N = Number(d.installments);
    if (!Number.isInteger(N) || N < 1) errs.push('اختر عدد الأقساط');
    else if (N > D) errs.push('عدد الأقساط لا يمكن أن يزيد على ' + D + ' يومًا');
    return errs;
  }

  root.SahmCore = {
    CURRENCIES: CURRENCIES, toMinor: toMinor, fmtMoney: fmtMoney,
    toDay: toDay, fromDay: fromDay, addDays: addDays, diffDays: diffDays, todayIn: todayIn, fmtDate: fmtDate,
    cycleLen: cycleLen, cycleLabel: cycleLabel, periods: periods, maxInstallments: maxInstallments, splitAmount: splitAmount,
    cycleStart: cycleStart, instRange: instRange, firstDrawDate: firstDrawDate, roundDate: roundDate,
    durationInfo: durationInfo, currentCycle: currentCycle, instStatus: instStatus, STATUS_LABEL: STATUS_LABEL,
    groupShares: groupShares, memberShares: memberShares, groupMembers: groupMembers, isLocked: isLocked, shareAmounts: shareAmounts,
    obligation: obligation, cycleObligations: cycleObligations, memberProgress: memberProgress, lateJoinPreview: lateJoinPreview,
    eligibleShares: eligibleShares, shareLabel: shareLabel, pickWinner: pickWinner, prizeTarget: prizeTarget,
    quorumInfo: quorumInfo, validateBasics: validateBasics
  };
})(typeof window !== 'undefined' ? window : globalThis);
