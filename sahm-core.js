/* SAHM core engine — pure calculation rules from the unified reference v2.
   No DOM access, no storage. Dates are ISO strings (YYYY-MM-DD) in the association time zone.
   Amounts are integers in minor currency units. Everything here is deterministic except pickWinner. */
(function (root) {
  'use strict';
  var DAY = 86400000;

  /* ---------- currencies (amounts are stored in minor units) ---------- */
  var CURRENCIES = {
    YER: { name: 'ريال يمني', short: 'ر.ي', minor: 1 },
    SAR: { name: 'ريال سعودي', short: 'ر.س', minor: 100 },
    USD: { name: 'دولار أمريكي', short: '$', minor: 100 }
  };
  var MAX_MINOR = 1e13; /* sanity ceiling, far below Number.MAX_SAFE_INTEGER */

  function normDigits(v) {
    return String(v == null ? '' : v)
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/٫/g, '.').replace(/[٬,\s]/g, '');
  }
  /* exact decimal parsing (no floating point): returns minor units or null when invalid / not positive */
  function parseMoney(v, cur) {
    var c = CURRENCIES[cur]; if (!c) return null;
    var s = normDigits(v); if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var parts = s.split('.'), dec = c.minor === 1 ? 0 : 2, frac = parts[1] || '';
    if (frac.length > dec && !/^0+$/.test(frac.slice(dec))) return null;
    var minor = Number(parts[0]) * c.minor + (dec ? Number((frac + '00').slice(0, dec)) : 0);
    if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MINOR) return null;
    return minor;
  }
  function toMinor(major, cur) {
    var m = parseMoney(major, cur);
    return m !== null ? m : Math.round(Number(major) * CURRENCIES[cur].minor);
  }
  function fmtMoney(minor, cur) {
    var c = CURRENCIES[cur] || CURRENCIES.YER, v = minor / c.minor;
    var s = new Intl.NumberFormat('ar-YE', { maximumFractionDigits: c.minor > 1 ? 2 : 0 }).format(v);
    return s + ' ' + c.short;
  }

  /* ---------- dates ---------- */
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    if (p[0] < 2000 || p[0] > 2200) return false;
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function toDay(iso) { var p = iso.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / DAY); }
  function fromDay(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function addDays(iso, n) { return fromDay(toDay(iso) + n); }
  function diffDays(a, b) { return toDay(a) - toDay(b); }
  function todayIn(tz) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function isValidTimeZone(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; } }
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

  /* installment period k (1..N) inside a cycle of D days: [from,to] as day numbers 1..D.
     end of period k = floor(k*D/N): consecutive, no gaps/overlap, lengths differ by at most one day */
  function periods(D, N) {
    if (!Number.isInteger(D) || !Number.isInteger(N) || D < 1 || N < 1 || N > D) throw new RangeError('INVALID_PERIODS');
    var out = [], base = Math.floor(D / N), rem = D % N, from = 1;
    for (var k = 1; k <= N; k++) {
      var span = base + (k <= rem ? 1 : 0), end = from + span - 1;
      out.push({ no: k, from: from, to: end });
      from = end + 1;
    }
    return out;
  }
  function maxInstallments(g) { return cycleLen(g); }

  /* split T (minor units) across N installments exactly, remainder (one unit each) to the first installments */
  function splitAmount(T, N) {
    if (!Number.isInteger(T) || T < 0 || !Number.isInteger(N) || N < 1) throw new RangeError('INVALID_SPLIT');
    var base = Math.floor(T / N), rem = T % N, out = [];
    for (var i = 0; i < N; i++) out.push(base + (i < rem ? 1 : 0));
    return out;
  }
  /* Exact per-share installment amounts for both supported plans.
     Fixed-amount mode leaves only the residual in the final installment. */
  function installmentAmounts(g) {
    var total = Number(g && g.shareAmount), count = Number(g && g.installments);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(count) || count < 1) throw new RangeError('INVALID_INSTALLMENT_PLAN');
    if (!g || g.installmentMode !== 'amount') return splitAmount(total, count);
    var fixed = Number(g.installmentAmountMinor);
    if (!Number.isSafeInteger(fixed) || fixed < 1 || fixed > total || count !== Math.ceil(total / fixed)) {
      throw new RangeError('INVALID_FIXED_INSTALLMENT_PLAN');
    }
    var out = [], remaining = total;
    for (var i = 0; i < count; i++) {
      var amount = Math.min(fixed, remaining);
      if (amount < 1) throw new RangeError('INVALID_FIXED_INSTALLMENT_PLAN');
      out.push(amount);
      remaining -= amount;
    }
    if (remaining !== 0) throw new RangeError('INVALID_FIXED_INSTALLMENT_PLAN');
    return out;
  }

  function cycleStart(g, c) { return addDays(g.startDate, (c - 1) * cycleLen(g)); }
  function instRange(g, c, k) {
    var p = periods(cycleLen(g), g.installments)[k - 1], cs = cycleStart(g, c);
    return { start: addDays(cs, p.from - 1), end: addDays(cs, p.to - 1), from: p.from, to: p.to };
  }
  function firstDrawDate(g) {
    return g && isValidDate(g.firstDrawOn) ? g.firstDrawOn : addDays(g.startDate, cycleLen(g));
  }
  function roundDate(g, r) {
    return addDays(firstDrawDate(g), (Number(r) - 1) * cycleLen(g));
  }
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
  /* which cycle / installment does a calendar date fall in (null before the start) */
  function locate(g, iso) {
    var d = diffDays(iso, g.startDate); if (d < 0) return null;
    var D = cycleLen(g), c = Math.floor(d / D) + 1, day = d % D + 1, per = periods(D, g.installments), k = 0;
    for (var i = 0; i < per.length; i++) if (day >= per[i].from && day <= per[i].to) { k = per[i].no; break; }
    return { cycle: c, dayInCycle: day, no: k };
  }

  /* plan for the review screen: every figure the creation flow needs, computed once here */
  function groupPlan(g, shareCount) {
    var D = cycleLen(g), N = Number(g.installments), T = Number(g.shareAmount);
    if (!Number.isInteger(N) || N < 1 || N > D || !Number.isInteger(T) || T < 0) return null;
    var amounts = installmentAmounts(g), per = periods(D, N);
    var plan = {
      cycleDays: D, cycleLabel: cycleLabel(g), installments: N, shareAmount: T, shareCount: shareCount || 0,
      installmentMode: g.installmentMode === 'amount' ? 'amount' : 'count',
      installmentAmountMinor: g.installmentAmountMinor == null ? null : Number(g.installmentAmountMinor),
      installmentsPlan: per.map(function (p) { return { no: p.no, fromDay: p.from, toDay: p.to, days: p.to - p.from + 1, perShare: amounts[p.no - 1] }; })
    };
    if (isValidDate(g.startDate)) {
      plan.startDate = g.startDate; plan.firstDraw = firstDrawDate(g);
      plan.installmentsPlan.forEach(function (i) { i.start = addDays(g.startDate, i.fromDay - 1); i.end = addDays(g.startDate, i.toDay - 1); });
      if (shareCount > 0) {
        var di = durationInfo(g, shareCount);
        plan.rounds = di.rounds; plan.durationDays = di.days; plan.endDate = di.endDate; plan.lastDay = di.lastDay; plan.prizeTarget = shareCount * T;
      }
    }
    return plan;
  }
  /* what one participant owes (reference §6.2–6.3); rounds = number of lottery rounds */
  function memberCommitment(g, sharesCount, rounds) {
    var amounts = installmentAmounts(g);
    return { shares: sharesCount, perInstallment: amounts.map(function (a) { return a * sharesCount; }),
      perCycle: g.shareAmount * sharesCount, overall: rounds > 0 ? g.shareAmount * sharesCount * rounds : 0 };
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
  function shareAmounts(g) { return installmentAmounts(g); }
  function activeReceipts(db, filter) {
    return db.receipts.filter(function (r) {
      if (r.voided) return false;
      for (var k in filter) if (r[k] !== filter[k]) return false;
      return true;
    });
  }

  /* obligation of one member for one installment (cycle c, number k) */
  function obligation(db, g, member, c, k, today) {
    var shares = memberShares(db, member.id), amounts = shareAmounts(g), per = amounts[k - 1];
    var recs = db.receipts.filter(function (r) { return r.memberId === member.id && r.cycle === c && r.no === k && !r.voided; });
    var paidIds = {}; recs.forEach(function (r) { r.shareIds.forEach(function (id) { paidIds[id] = r; }); });
    var unpaid = shares.filter(function (s) { return !paidIds[s.id]; });
    var range = instRange(g, c, k);
    var allPaid = shares.length > 0 && unpaid.length === 0;
    var status = instStatus(range, allPaid, today);
    /* created late only because the share/member joined after the period had ended (reference §7.2) */
    var lateByJoin = status === 'late' && unpaid.some(function (s) { return (s.addedAt || member.joinedAt) > range.end; });
    return {
      member: member, cycle: c, no: k, range: range, status: status, perShare: per,
      shares: shares.length, paidShares: shares.length - unpaid.length, unpaidShares: unpaid,
      total: per * shares.length, remaining: per * unpaid.length, receipts: recs, lateByJoin: lateByJoin
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

  /* what a late joiner would owe immediately (preview before confirming, reference §7.2 / §21.4) */
  function lateJoinPreview(g, joinDate, sharesCount, today, totalCycles) {
    var out = [], amounts = shareAmounts(g), cyc = currentCycle(g, joinDate, 0);
    for (var c = 1; c <= cyc; c++) for (var k = 1; k <= g.installments; k++) {
      var r = instRange(g, c, k);
      if (r.end < joinDate) out.push({ cycle: c, no: k, amount: amounts[k - 1] * sharesCount, periodStart: r.start, periodEnd: r.end });
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
    var owned = memberShares(db, s.memberId), idx = owned.findIndex(function (x) { return x.id === s.id; });
    return (m ? m.name : '—') + (owned.length > 1 ? ' · السهم ' + (idx + 1) : '');
  }
  /* unbiased pick; rng (optional, returns [0,1)) exists for deterministic tests only */
  function pickWinner(list, rng) {
    var n = list.length; if (!n) return null;
    if (typeof rng === 'function') {
      var r = Number(rng());
      if (!(r >= 0 && r < 1)) throw new RangeError('INVALID_RNG');
      return list[Math.floor(r * n)];
    }
    var cr = root.crypto || root.msCrypto;
    if (!cr || !cr.getRandomValues) throw new Error('NO_SECURE_RANDOM');
    var buf = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n, x;
    do { cr.getRandomValues(buf); x = buf[0]; } while (x >= lim);
    return list[x % n];
  }
  function prizeTarget(g, shareCount) { return shareCount * g.shareAmount; }
  /* target prize vs what the manager actually recorded for the funding cycle (reference §6.4, §14.3) */
  function prizeInfo(db, g, round, shareCount) {
    var target = prizeTarget(g, shareCount), recorded = 0;
    db.receipts.forEach(function (r) { if (r.groupId === g.id && r.cycle === round && !r.voided) recorded += r.amount; });
    return { round: round, target: target, recorded: recorded, outstanding: Math.max(0, target - recorded) };
  }

  /* attendance quorum counts people, not shares; threshold compared exactly (no rounding up) */
  function requiredPeople(g, people) { return Math.ceil(people * g.quorum / 100); }
  function quorumInfo(db, g) {
    var people = groupMembers(db, g.id).filter(function (m) { return memberShares(db, m.id).length; });
    var present = people.filter(function (m) { return m.present; }).length;
    var pct = people.length ? Math.floor(present / people.length * 100) : 0;
    return { present: present, people: people.length, pct: pct, required: requiredPeople(g, people.length),
      met: people.length > 0 && present * 100 >= g.quorum * people.length };
  }

  /* ---------- unified association workflow guards ---------- */
  var JOIN_REQUEST_STATUS = Object.freeze({
    pending: 'pending', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled'
  });
  var INVITATION_RESPONSE_STATUS = Object.freeze({
    pending: 'pending_response', interested: 'interested', declined: 'declined', deferred: 'deferred'
  });

  /* New-flow duration is derived from the two selected dates; legacy cycle helpers remain unchanged. */
  function firstDrawDurationDays(startDate, firstDrawDate) {
    if (!isValidDate(startDate) || !isValidDate(firstDrawDate)) {
      throw new RangeError('INVALID_ASSOCIATION_DATES');
    }
    var days = diffDays(firstDrawDate, startDate);
    if (!Number.isInteger(days) || days < 1) throw new RangeError('FIRST_DRAW_MUST_FOLLOW_START');
    return days;
  }

  /* UI advisory only. The database must repeat this check using its own clock and association timezone. */
  function isJoinWindowOpen(startDate, timeZone, now) {
    if (!isValidDate(startDate)) throw new RangeError('INVALID_ASSOCIATION_START_DATE');
    var zone = timeZone || 'Asia/Aden';
    if (!isValidTimeZone(zone)) throw new RangeError('INVALID_ASSOCIATION_TIME_ZONE');
    var instant = now === undefined ? new Date() : (now instanceof Date ? now : new Date(now));
    if (!Number.isFinite(instant.getTime())) throw new RangeError('INVALID_CURRENT_INSTANT');
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(instant);
    var part = {};
    parts.forEach(function (x) { if (x.type !== 'literal') part[x.type] = x.value; });
    var localDate = part.year + '-' + part.month + '-' + part.day;
    return localDate < startDate;
  }

  function nextInvitationResponseStatus(currentStatus, action) {
    var current = currentStatus || INVITATION_RESPONSE_STATUS.pending;
    if (current !== INVITATION_RESPONSE_STATUS.pending && current !== INVITATION_RESPONSE_STATUS.deferred) {
      throw new RangeError('INVITATION_RESPONSE_IS_TERMINAL');
    }
    if (action === 'interested') return INVITATION_RESPONSE_STATUS.interested;
    if (action === 'decline') return INVITATION_RESPONSE_STATUS.declined;
    if (action === 'defer') return INVITATION_RESPONSE_STATUS.deferred;
    throw new RangeError('INVALID_INVITATION_RESPONSE_ACTION');
  }

  function nextJoinRequestStatus(currentStatus, action, actorRole) {
    if (currentStatus !== JOIN_REQUEST_STATUS.pending) throw new RangeError('JOIN_REQUEST_IS_TERMINAL');
    if (action === 'cancel' && actorRole === 'applicant') return JOIN_REQUEST_STATUS.cancelled;
    if (action === 'approve' && actorRole === 'manager') return JOIN_REQUEST_STATUS.approved;
    if (action === 'reject' && actorRole === 'manager') return JOIN_REQUEST_STATUS.rejected;
    throw new RangeError('JOIN_REQUEST_TRANSITION_FORBIDDEN');
  }

  function hasPendingJoinRequest(requests, associationId, applicantUserId) {
    return (requests || []).some(function (r) {
      return r.association_id === associationId && r.applicant_user_id === applicantUserId &&
        r.status === JOIN_REQUEST_STATUS.pending;
    });
  }

  /* Only approved requests contribute requested shares; pending/rejected/cancelled never do. */
  function summarizeJoinRequests(requests, associationId) {
    var out = { pendingCount: 0, approvedCount: 0, rejectedCount: 0, cancelledCount: 0, approvedShares: 0 };
    (requests || []).forEach(function (r) {
      if (associationId && r.association_id !== associationId) return;
      if (r.status === JOIN_REQUEST_STATUS.pending) out.pendingCount++;
      else if (r.status === JOIN_REQUEST_STATUS.approved) {
        out.approvedCount++;
        out.approvedShares += Math.max(0, Number(r.requested_shares) || 0);
      } else if (r.status === JOIN_REQUEST_STATUS.rejected) out.rejectedCount++;
      else if (r.status === JOIN_REQUEST_STATUS.cancelled) out.cancelledCount++;
    });
    return out;
  }

  /* Legacy invites with a fixed share count are retained on their original acceptance path. */
  function isLegacyInvitation(invitation) {
    var value = invitation && (invitation.shares_requested !== undefined
      ? invitation.shares_requested : invitation.sharesRequested);
    return Number.isInteger(Number(value)) && Number(value) > 0;
  }

  /* ---------- validation ---------- */
  var LEGACY_FIELDS = ['paymentMethod', 'paymentMethods', 'proofRequired', 'requireProof', 'referenceNo', 'transferRef', 'receiptImage', 'firstDrawDate', 'firstDraw'];

  /* Validation for the date-based unified association contract. */
  function validateUnifiedGroup(d) {
    var e = [];
    function bad(field, code, message) { e.push({ field: field, code: code, message: message }); }
    var name = typeof d.name === 'string' ? d.name.trim() : '';
    if (name.length < 2) bad('name', 'NAME_REQUIRED', 'أدخل اسم الجمعية');
    else if (name.length > 120) bad('name', 'NAME_TOO_LONG', 'اسم الجمعية لا يزيد على 120 حرفًا');
    if (!CURRENCIES[d.currency]) bad('currency', 'CURRENCY_REQUIRED', 'اختر العملة');
    if (!isValidDate(d.startDate)) bad('startDate', 'START_DATE_INVALID', 'أدخل تاريخ بداية صحيحًا');
    if (!isValidDate(d.firstDrawOn)) bad('firstDrawOn', 'FIRST_DRAW_INVALID', 'أدخل تاريخ أول قرعة صحيحًا');
    var days = isValidDate(d.startDate) && isValidDate(d.firstDrawOn) ? diffDays(d.firstDrawOn, d.startDate) : 0;
    if (days < 1 || days > 3650) bad('firstDrawOn', 'FIRST_DRAW_RANGE_INVALID', 'يجب أن تكون أول قرعة بعد البداية خلال مدة لا تتجاوز 3650 يومًا');
    if (d.durationDays !== undefined && d.durationDays !== null && Number(d.durationDays) !== days) {
      bad('durationDays', 'DURATION_MISMATCH', 'مدة الدورة لا تطابق التاريخين المحددين');
    }
    var total = d.shareAmountMinor !== undefined && d.shareAmountMinor !== null
      ? Number(d.shareAmountMinor) : (CURRENCIES[d.currency] ? parseMoney(d.shareAmount, d.currency) : null);
    if (!Number.isSafeInteger(total) || total < 1) bad('shareAmountMinor', 'SHARE_AMOUNT_INVALID', 'أدخل قيمة حصة سهم صحيحة وموجبة');
    var mode = d.installmentMode || 'count', count = 0, fixed = null;
    if (mode === 'count') {
      count = Number(d.installments);
      if (!Number.isInteger(count) || count < 1 || (days > 0 && count > days)) {
        bad('installments', 'INSTALLMENTS_INVALID', 'عدد الأقساط غير صالح أو يتجاوز مدة الدورة');
      }
    } else if (mode === 'amount') {
      fixed = d.installmentAmountMinor !== undefined && d.installmentAmountMinor !== null
        ? Number(d.installmentAmountMinor) : (CURRENCIES[d.currency] ? parseMoney(d.installmentAmount, d.currency) : null);
      if (!Number.isSafeInteger(fixed) || fixed < 1 || (Number.isSafeInteger(total) && fixed > total)) {
        bad('installmentAmountMinor', 'FIXED_INSTALLMENT_INVALID', 'قيمة القسط يجب أن تكون موجبة ولا تتجاوز حصة السهم');
      } else if (Number.isSafeInteger(total)) {
        count = Math.ceil(total / fixed);
        if (days > 0 && count > days) bad('installmentAmountMinor', 'INSTALLMENTS_EXCEED_DAYS', 'عدد الأقساط الناتج يتجاوز مدة الدورة');
        if (Number(d.installments) > 0 && Number(d.installments) !== count) {
          bad('installments', 'INSTALLMENT_COUNT_MISMATCH', 'عدد الأقساط لا يطابق قيمة القسط المحددة');
        }
      }
    } else bad('installmentMode', 'INSTALLMENT_MODE_INVALID', 'اختر طريقة سداد صحيحة');
    var tz = d.tz || d.timeZone || 'Asia/Aden';
    if (!isValidTimeZone(tz)) bad('tz', 'TZ_INVALID', 'المنطقة الزمنية غير صحيحة');
    if (d.inviteOpensOn && !isValidDate(d.inviteOpensOn)) bad('inviteOpensOn', 'INVITE_DATE_INVALID', 'تاريخ فتح الانضمام غير صحيح');
    if (d.inviteClosesOn && !isValidDate(d.inviteClosesOn)) bad('inviteClosesOn', 'INVITE_DATE_INVALID', 'تاريخ إغلاق الانضمام غير صحيح');
    if (isValidDate(d.inviteOpensOn) && isValidDate(d.inviteClosesOn) && d.inviteClosesOn < d.inviteOpensOn) {
      bad('inviteClosesOn', 'INVITE_RANGE_INVALID', 'تاريخ إغلاق الانضمام قبل تاريخ فتحه');
    }
    var quorum = d.quorum === undefined || d.quorum === null || d.quorum === '' ? 66 : Number(d.quorum);
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) bad('quorum', 'QUORUM_INVALID', 'نسبة النصاب بين 1 و100');
    var managerMode = d.managerMode || 'only';
    if (managerMode !== 'only' && managerMode !== 'both') bad('managerMode', 'MANAGER_MODE_INVALID', 'اختر «مدير فقط» أو «مدير ومشارك»');
    if (managerMode === 'both' && (!Number.isSafeInteger(Number(d.managerShares)) || Number(d.managerShares) < 1)) {
      bad('managerShares', 'MANAGER_SHARES_INVALID', 'أدخل عدد أسهم المدير');
    }
    if (d.rules != null && String(d.rules).length > 4000) bad('rules', 'RULES_TOO_LONG', 'نص القواعد طويل جدًا');
    return e;
  }

  /* structured validation for creating an association: returns [{field, code, message}] */
  function validateGroup(d) {
    d = d || {};
    if (d.firstDrawOn !== undefined || d.durationDays !== undefined ||
        d.shareAmountMinor !== undefined || d.installmentMode !== undefined) return validateUnifiedGroup(d);
    var e = [];
    function bad(field, code, message) { e.push({ field: field, code: code, message: message }); }
    LEGACY_FIELDS.forEach(function (f) {
      if (d[f] !== undefined && d[f] !== null && d[f] !== '')
        bad(f, f === 'firstDrawDate' || f === 'firstDraw' ? 'FIRST_DRAW_NOT_EDITABLE' : 'FIELD_NOT_SUPPORTED',
          f === 'firstDrawDate' || f === 'firstDraw' ? 'موعد أول قرعة يحسبه النظام تلقائيًا ولا يُدخل يدويًا' : 'هذا الحقل غير مدعوم في سهم');
    });
    var name = typeof d.name === 'string' ? d.name.trim() : '';
    if (!name) bad('name', 'NAME_REQUIRED', 'أدخل اسم الجمعية');
    else if (name.length > 60) bad('name', 'NAME_TOO_LONG', 'اسم الجمعية لا يزيد على 60 حرفًا');
    if (!CURRENCIES[d.currency]) bad('currency', 'CURRENCY_REQUIRED', 'اختر العملة');
    if (!/^(weekly|monthly|custom)$/.test(d.cycleType || '')) bad('cycleType', 'CYCLE_REQUIRED', 'اختر دورة القرعة');
    var D = 0;
    if (d.cycleType === 'custom') {
      var cd = Number(d.cycleDays);
      if (!Number.isInteger(cd) || cd < 1 || cd > 3650) bad('cycleDays', 'CYCLE_DAYS_INVALID', 'أدخل عدد أيام صحيحًا للدورة المخصصة');
      else D = cd;
    } else if (d.cycleType) D = cycleLen(d);
    if (CURRENCIES[d.currency] && parseMoney(d.shareAmount, d.currency) === null) bad('shareAmount', 'SHARE_AMOUNT_INVALID', 'أدخل حصة السهم في الدورة بمبلغ صحيح موجب');
    else if (!CURRENCIES[d.currency] && !(Number(d.shareAmount) > 0)) bad('shareAmount', 'SHARE_AMOUNT_INVALID', 'أدخل حصة السهم في الدورة');
    var N = Number(d.installments);
    if (!Number.isInteger(N) || N < 1) bad('installments', 'INSTALLMENTS_INVALID', 'اختر عدد الأقساط');
    else if (D && N > D) bad('installments', 'INSTALLMENTS_EXCEED_DAYS', 'عدد الأقساط لا يمكن أن يزيد على ' + D + ' يومًا');
    if (!isValidDate(d.startDate)) bad('startDate', 'START_DATE_INVALID', 'أدخل تاريخ بداية صحيحًا');
    if (d.inviteOpensOn && !isValidDate(d.inviteOpensOn)) bad('inviteOpensOn', 'INVITE_DATE_INVALID', 'تاريخ فتح الدعوات غير صحيح');
    if (d.inviteClosesOn && !isValidDate(d.inviteClosesOn)) bad('inviteClosesOn', 'INVITE_DATE_INVALID', 'تاريخ إغلاق الدعوات غير صحيح');
    if (isValidDate(d.inviteOpensOn) && isValidDate(d.inviteClosesOn) && d.inviteClosesOn < d.inviteOpensOn) bad('inviteClosesOn', 'INVITE_RANGE_INVALID', 'تاريخ إغلاق الدعوات قبل تاريخ فتحها');
    if (d.tz && !isValidTimeZone(d.tz)) bad('tz', 'TZ_INVALID', 'المنطقة الزمنية غير صحيحة');
    var target = Number(d.targetShares), maxPer = Number(d.maxPerMember);
    if (!Number.isInteger(target) || target < 1 || target > 1000) bad('targetShares', 'TARGET_INVALID', 'أدخل عددًا مستهدفًا صحيحًا من الأسهم');
    if (!Number.isInteger(maxPer) || maxPer < 1) bad('maxPerMember', 'MAX_PER_INVALID', 'أدخل الحد الأقصى لأسهم الفرد');
    else if (Number.isInteger(target) && maxPer > target) bad('maxPerMember', 'MAX_PER_EXCEEDS_TARGET', 'الحد الأقصى لأسهم الفرد يتجاوز العدد المستهدف');
    if (d.quorum !== undefined && d.quorum !== null && d.quorum !== '') {
      var q = Number(d.quorum); if (!Number.isInteger(q) || q < 1 || q > 100) bad('quorum', 'QUORUM_INVALID', 'نسبة النصاب بين 1 و100');
    }
    var mode = d.managerMode || 'only';
    if (mode !== 'only' && mode !== 'both') bad('managerMode', 'MANAGER_MODE_INVALID', 'اختر «مدير فقط» أو «مدير ومشارك»');
    if (mode === 'both') {
      var ms = Number(d.managerShares);
      if (!Number.isInteger(ms) || ms < 1) bad('managerShares', 'MANAGER_SHARES_INVALID', 'أدخل عدد أسهم المدير');
      else if (Number.isInteger(maxPer) && ms > maxPer) bad('managerShares', 'MANAGER_SHARES_EXCEED_MAX', 'أسهم المدير تتجاوز الحد الأقصى للفرد');
      else if (Number.isInteger(target) && ms > target) bad('managerShares', 'MANAGER_SHARES_EXCEED_TARGET', 'أسهم المدير تتجاوز العدد المستهدف');
    }
    if (d.rules != null && String(d.rules).length > 2000) bad('rules', 'RULES_TOO_LONG', 'نص القواعد طويل جدًا');
    return e;
  }
  /* legacy string-array form kept for the existing screens (basic fields of the first creation step) */
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
    CURRENCIES: CURRENCIES, parseMoney: parseMoney, toMinor: toMinor, fmtMoney: fmtMoney,
    isValidDate: isValidDate, isValidTimeZone: isValidTimeZone,
    toDay: toDay, fromDay: fromDay, addDays: addDays, diffDays: diffDays, todayIn: todayIn, fmtDate: fmtDate,
    cycleLen: cycleLen, cycleLabel: cycleLabel, periods: periods, maxInstallments: maxInstallments, splitAmount: splitAmount,
    cycleStart: cycleStart, instRange: instRange, firstDrawDate: firstDrawDate, roundDate: roundDate, installmentAmounts: installmentAmounts,
    durationInfo: durationInfo, currentCycle: currentCycle, locate: locate, groupPlan: groupPlan, memberCommitment: memberCommitment,
    instStatus: instStatus, STATUS_LABEL: STATUS_LABEL,
    groupShares: groupShares, memberShares: memberShares, groupMembers: groupMembers, isLocked: isLocked, shareAmounts: shareAmounts,
    activeReceipts: activeReceipts,
    obligation: obligation, cycleObligations: cycleObligations, memberProgress: memberProgress, lateJoinPreview: lateJoinPreview,
    eligibleShares: eligibleShares, shareLabel: shareLabel, pickWinner: pickWinner, prizeTarget: prizeTarget, prizeInfo: prizeInfo,
    requiredPeople: requiredPeople, quorumInfo: quorumInfo,
    JOIN_REQUEST_STATUS: JOIN_REQUEST_STATUS, INVITATION_RESPONSE_STATUS: INVITATION_RESPONSE_STATUS,
    firstDrawDurationDays: firstDrawDurationDays, isJoinWindowOpen: isJoinWindowOpen,
    nextInvitationResponseStatus: nextInvitationResponseStatus, nextJoinRequestStatus: nextJoinRequestStatus,
    hasPendingJoinRequest: hasPendingJoinRequest, summarizeJoinRequests: summarizeJoinRequests,
    isLegacyInvitation: isLegacyInvitation, validateBasics: validateBasics, validateGroup: validateGroup
  };
})(typeof window !== 'undefined' ? window : globalThis);
