'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./helpers');
const { K } = loadModules();

test('money parsing uses exact minor units and Arabic digits', () => {
  assert.equal(K.parseMoney('١٢٣٤', 'YER'), 1234);
  assert.equal(K.parseMoney('12.34', 'SAR'), 1234);
  assert.equal(K.parseMoney('12.34', 'USD'), 1234);
  assert.equal(K.parseMoney('12.345', 'SAR'), null);
  assert.equal(K.parseMoney('0', 'YER'), null);
  assert.equal(K.parseMoney('-1', 'YER'), null);
  assert.equal(K.parseMoney('1', 'EUR'), null);
});

test('Gregorian date validation rejects impossible dates and unsupported years', () => {
  assert.equal(K.isValidDate('2024-02-29'), true);
  assert.equal(K.isValidDate('2025-02-29'), false);
  assert.equal(K.isValidDate('2026-13-01'), false);
  assert.equal(K.isValidDate('1999-01-01'), false);
});

test('weekly, monthly and custom cycles use fixed day counts', () => {
  assert.equal(K.cycleLen({ cycleType: 'weekly' }), 7);
  assert.equal(K.cycleLen({ cycleType: 'monthly' }), 30);
  assert.equal(K.cycleLen({ cycleType: 'custom', cycleDays: 19 }), 19);
});

test('installment periods are contiguous, exhaustive and balanced', () => {
  for (let days = 1; days <= 90; days++) {
    for (let count = 1; count <= days; count++) {
      const periods = K.periods(days, count);
      assert.equal(periods.length, count);
      assert.equal(periods[0].from, 1);
      assert.equal(periods.at(-1).to, days);
      for (let i = 1; i < periods.length; i++) {
        assert.equal(periods[i].from, periods[i - 1].to + 1);
      }
      const lengths = periods.map(p => p.to - p.from + 1);
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1);
    }
  }
});

test('invalid period and split dimensions are rejected', () => {
  for (const args of [[0, 1], [7, 0], [7, 8], [7.5, 2]]) {
    assert.throws(() => K.periods(...args), RangeError);
  }
  for (const args of [[-1, 2], [1, 0], [1.5, 2], [2, 1.5]]) {
    assert.throws(() => K.splitAmount(...args), RangeError);
  }
});

test('splitAmount preserves every minor unit and the last installment absorbs the remainder', () => {
  assert.deepEqual(K.splitAmount(100000, 3), [33333, 33333, 33334]);
  for (let total = 0; total < 100; total++) {
    for (let count = 1; count < 15; count++) {
      const parts = K.splitAmount(total, count);
      const base = Math.floor(total / count);
      assert.equal(parts.length, count);
      assert.equal(parts.reduce((sum, value) => sum + value, 0), total);
      assert.ok(parts.slice(0, -1).every(value => value === base));
      assert.equal(parts.at(-1), base + (total % count));
    }
  }
});

test('30-day cycle first draw is after day 30, not on day 30', () => {
  const group = { startDate: '2026-11-01', cycleType: 'monthly', installments: 3 };
  assert.equal(K.firstDrawDate(group), '2026-12-01');
  assert.equal(K.roundDate(group, 2), '2026-12-31');
});

test('installment ranges and locate use inclusive period boundaries', () => {
  const group = { startDate: '2026-01-01', cycleType: 'monthly', installments: 3 };
  assert.deepEqual(K.instRange(group, 1, 1), {
    start: '2026-01-01', end: '2026-01-10', from: 1, to: 10
  });
  assert.equal(K.locate(group, '2026-01-10').no, 1);
  assert.equal(K.locate(group, '2026-01-11').no, 2);
  assert.equal(K.locate(group, '2026-01-20').no, 2);
  assert.equal(K.locate(group, '2026-01-21').no, 3);
  assert.equal(K.locate(group, '2025-12-31'), null);
});

test('leap-day date arithmetic is calendar-correct', () => {
  assert.equal(K.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(K.addDays('2024-02-29', 1), '2024-03-01');
});

test('late join preview includes only periods ended before joining', () => {
  const group = { startDate: '2026-11-01', cycleType: 'monthly', installments: 3, shareAmount: 90000 };
  const preview = K.lateJoinPreview(group, '2026-11-21', 1, '2026-11-21', 3);
  assert.deepEqual(preview.items.map(x => x.no), [1, 2]);
  assert.equal(preview.total, 60000);
});

test('agreement locks when the local date in the association time zone reaches the start date', () => {
  assert.equal(K.isAgreementLocked('2026-12-01', 'Asia/Aden', '2026-11-30T20:59:59Z'), false);
  assert.equal(K.isAgreementLocked('2026-12-01', 'Asia/Aden', '2026-11-30T21:00:00Z'), true);
  assert.equal(K.isAgreementLocked('2026-12-01', 'America/New_York', '2026-12-01T04:59:59Z'), false);
  assert.equal(K.isAgreementLocked('2026-12-01', 'America/New_York', '2026-12-01T05:00:00Z'), true);
  assert.throws(() => K.isAgreementLocked('not-a-date', 'Asia/Aden', '2026-12-01T00:00:00Z'), RangeError);
  assert.throws(() => K.isAgreementLocked('2026-12-01', 'Not/A_Timezone', '2026-12-01T00:00:00Z'), RangeError);
});

test('agreementLock and isFrozen combine the start-date lock with a recorded draw', () => {
  const lock = K.agreementLock({ startDate: '2026-12-01', tz: 'Asia/Aden' }, '2026-12-01T00:00:00Z');
  assert.equal(lock.locked, true);
  assert.equal(lock.localDate, '2026-12-01');
  assert.equal(lock.startDate, '2026-12-01');
  const group = { id: 'g', startDate: '2027-01-01', tz: 'Asia/Aden' };
  const now = '2026-11-01T00:00:00Z';
  assert.equal(K.isFrozen({ draws: [] }, group, now), false);
  assert.equal(K.isFrozen({ draws: [{ groupId: 'g' }] }, group, now), true);
  assert.equal(K.isFrozen({ draws: [{ groupId: 'other' }] }, group, now), false);
});

test('member commitment multiplies each installment by share count and keeps the remainder last', () => {
  const group = { shareAmount: 100000, installments: 3 };
  assert.deepEqual(K.memberCommitment(group, 3, 10), {
    shares: 3, perInstallment: [99999, 99999, 100002],
    perCycle: 300000, overall: 3000000
  });
});

test('group plan lists per-share installments with the remainder in the last one', () => {
  const plan = K.groupPlan({
    startDate: '2026-11-01', cycleType: 'monthly', installments: 3, shareAmount: 100000
  }, 4);
  assert.deepEqual(plan.installmentsPlan.map(x => x.perShare), [33333, 33333, 33334]);
  assert.equal(plan.rounds, 4);
  assert.equal(plan.prizeTarget, 400000);
  assert.equal(plan.firstDraw, '2026-12-01');
});

test('pickWinner supports deterministic tests and rejects invalid RNG values', () => {
  const shares = ['a', 'b', 'c'];
  assert.equal(K.pickWinner(shares, () => 0), 'a');
  assert.equal(K.pickWinner(shares, () => 0.99), 'c');
  assert.throws(() => K.pickWinner(shares, () => 1), RangeError);
});

test('group validation rejects removed payment and manual first-draw fields', () => {
  const errors = K.validateGroup({
    name: 'اختبار', currency: 'YER', cycleType: 'monthly', shareAmount: '1000',
    installments: 1, startDate: '2026-11-01', paymentMethod: 'bank',
    firstDrawDate: '2026-12-01'
  });
  assert.ok(errors.some(x => x.field === 'paymentMethod'));
  assert.ok(errors.some(x => x.field === 'firstDrawDate'));
});

test('installment status changes only after the inclusive end date', () => {
  const range = { start: '2026-11-01', end: '2026-11-10' };
  assert.equal(K.instStatus(range, false, '2026-10-31'), 'upcoming');
  assert.equal(K.instStatus(range, false, '2026-11-10'), 'due');
  assert.equal(K.instStatus(range, false, '2026-11-11'), 'late');
  assert.equal(K.instStatus(range, true, '2026-11-11'), 'paid');
});


test('new association cycle duration is derived from the selected first draw date', () => {
  assert.equal(K.firstDrawDurationDays('2027-01-01', '2027-01-31'), 30);
  assert.equal(K.firstDrawDurationDays('2024-02-28', '2024-03-01'), 2);
  assert.throws(() => K.firstDrawDurationDays('2027-01-01', '2027-01-01'), RangeError);
  assert.throws(() => K.firstDrawDurationDays('2027-02-30', '2027-03-01'), RangeError);
});

test('join window closes at midnight in the association timezone, not the device timezone', () => {
  assert.equal(K.isJoinWindowOpen('2026-12-02', 'Asia/Aden', '2026-12-01T20:59:59Z'), true);
  assert.equal(K.isJoinWindowOpen('2026-12-02', 'Asia/Aden', '2026-12-01T21:00:00Z'), false);
  assert.equal(K.isJoinWindowOpen('2026-04-01', 'America/New_York', '2026-04-01T03:59:59Z'), true);
  assert.equal(K.isJoinWindowOpen('2026-04-01', 'America/New_York', '2026-04-01T04:00:00Z'), false);
  assert.throws(() => K.isJoinWindowOpen('2026-12-02', 'Not/A_Timezone', '2026-12-01T20:00:00Z'), RangeError);
});

test('invitation response is separate from invitation acceptance and remains deferrable', () => {
  const S = K.INVITATION_RESPONSE_STATUS;
  assert.equal(K.nextInvitationResponseStatus(undefined, 'interested'), S.interested);
  assert.equal(K.nextInvitationResponseStatus(S.deferred, 'interested'), S.interested);
  assert.equal(K.nextInvitationResponseStatus(undefined, 'defer'), S.deferred);
  assert.equal(K.nextInvitationResponseStatus(undefined, 'decline'), S.declined);
  assert.throws(() => K.nextInvitationResponseStatus(S.declined, 'interested'), RangeError);
});

test('join request transitions enforce actor and terminal-state rules', () => {
  const S = K.JOIN_REQUEST_STATUS;
  assert.equal(K.nextJoinRequestStatus(S.pending, 'cancel', 'applicant'), S.cancelled);
  assert.equal(K.nextJoinRequestStatus(S.pending, 'approve', 'manager'), S.approved);
  assert.equal(K.nextJoinRequestStatus(S.pending, 'reject', 'manager'), S.rejected);
  assert.throws(() => K.nextJoinRequestStatus(S.pending, 'approve', 'applicant'), RangeError);
  assert.throws(() => K.nextJoinRequestStatus(S.approved, 'cancel', 'applicant'), RangeError);
  assert.throws(() => K.nextJoinRequestStatus(S.cancelled, 'approve', 'manager'), RangeError);
});

test('only approved join requests contribute shares and pending requests are unique per user and association', () => {
  const requests = [
    { association_id: 'a', applicant_user_id: 'u', requested_shares: 3, status: 'pending' },
    { association_id: 'a', applicant_user_id: 'v', requested_shares: 2, status: 'approved' },
    { association_id: 'a', applicant_user_id: 'w', requested_shares: 8, status: 'rejected' },
    { association_id: 'a', applicant_user_id: 'x', requested_shares: 5, status: 'cancelled' },
    { association_id: 'b', applicant_user_id: 'u', requested_shares: 4, status: 'approved' }
  ];
  assert.equal(K.hasPendingJoinRequest(requests, 'a', 'u'), true);
  assert.equal(K.hasPendingJoinRequest(requests, 'a', 'v'), false);
  assert.deepEqual(K.summarizeJoinRequests(requests, 'a'), {
    pendingCount: 1, approvedCount: 1, rejectedCount: 1, cancelledCount: 1, approvedShares: 2
  });
});

test('legacy invitation share counts are distinguished from new share-free invitations', () => {
  assert.equal(K.isLegacyInvitation({ shares_requested: 2 }), true);
  assert.equal(K.isLegacyInvitation({ sharesRequested: 1 }), true);
  assert.equal(K.isLegacyInvitation({ shares_requested: null }), false);
  assert.equal(K.isLegacyInvitation({}), false);
});


test('installment day remainder is assigned to the earliest installments like the database', () => {
  assert.deepEqual(K.periods(8, 3), [
    { no: 1, from: 1, to: 3 },
    { no: 2, from: 4, to: 6 },
    { no: 3, from: 7, to: 8 }
  ]);
});

test('fixed per-installment plan leaves the exact residual in the final installment', () => {
  assert.deepEqual(K.installmentAmounts({
    shareAmount: 10000, installments: 3, installmentMode: 'amount', installmentAmountMinor: 4000
  }), [4000, 4000, 2000]);
  assert.deepEqual(K.installmentAmounts({
    shareAmount: 10000, installments: 3, installmentMode: 'count'
  }), [3333, 3333, 3334]);
  assert.throws(() => K.installmentAmounts({
    shareAmount: 10000, installments: 2, installmentMode: 'amount', installmentAmountMinor: 4000
  }), /INVALID_FIXED_INSTALLMENT_PLAN/);
});

test('explicit first draw date anchors draw rounds while legacy dates retain their fallback', () => {
  const modern = { startDate: '2026-01-01', firstDrawOn: '2026-02-05', cycleType: 'custom', cycleDays: 35 };
  assert.equal(K.firstDrawDate(modern), '2026-02-05');
  assert.equal(K.roundDate(modern, 2), '2026-03-12');
  assert.equal(K.firstDrawDate({ startDate: '2026-01-01', cycleType: 'monthly' }), '2026-01-31');
});

test('unified association validation accepts date-based fields without target caps and ignores quorum', () => {
  const valid = {
    name: 'جمعية جديدة', currency: 'YER',
    startDate: '2027-01-01', firstDrawOn: '2027-01-31', durationDays: 30,
    shareAmountMinor: 10000, installmentMode: 'amount', installmentAmountMinor: 4000,
    managerMode: 'only', quorum: 66, tz: 'Asia/Aden'
  };
  assert.deepEqual(K.validateGroup(valid), []);
  assert.deepEqual(K.validateGroup({ ...valid, quorum: 5 }), []);
  assert.deepEqual(K.validateGroup({ ...valid, quorum: undefined }), []);
  assert.ok(K.validateGroup({ ...valid, durationDays: 29 }).some(x => x.code === 'DURATION_MISMATCH'));
  assert.ok(K.validateGroup({ ...valid, installmentAmountMinor: 100 }).some(x => x.code === 'INSTALLMENTS_EXCEED_DAYS'));
});

test('draw time is reached immediately without a scheduled time and exactly at the scheduled instant otherwise', () => {
  assert.equal(K.drawTimeReached(null, '2026-12-01T00:00:00Z'), true);
  assert.equal(K.drawTimeReached('', '2026-12-01T00:00:00Z'), true);
  assert.equal(K.drawTimeReached('2026-12-01T10:00:00Z', '2026-12-01T09:59:59Z'), false);
  assert.equal(K.drawTimeReached('2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z'), true);
});

test('draw schedule must fall on the due day in the future and be set on the due day', () => {
  const group = { startDate: '2026-11-01', cycleType: 'monthly', installments: 3, tz: 'Asia/Aden' };
  const now = '2026-12-01T05:00:00Z';
  assert.deepEqual(K.checkDrawSchedule(group, 1, '2026-12-01T10:00:00Z', now),
    { ok: true, code: null, dueDate: '2026-12-01' });
  assert.equal(K.checkDrawSchedule(group, 1, null, now).code, 'SCHEDULE_INVALID');
  assert.equal(K.checkDrawSchedule(group, 1, '2026-12-01T10:00:00Z', '2026-11-30T05:00:00Z').code, 'SCHEDULE_NOT_DUE_DAY');
  assert.equal(K.checkDrawSchedule(group, 1, '2026-12-02T10:00:00Z', now).code, 'SCHEDULE_OUTSIDE_DUE_DAY');
  assert.equal(K.checkDrawSchedule(group, 1, '2026-12-01T04:00:00Z', now).code, 'SCHEDULE_IN_PAST');
});

test('draw gate reports due day, exact time and financial readiness blockers separately', () => {
  const group = { startDate: '2026-11-01', cycleType: 'monthly', installments: 3, tz: 'Asia/Aden' };
  const scheduled = '2026-12-01T10:00:00Z';
  assert.deepEqual(K.drawGate(group, 1, null, { ready: true }, '2026-11-30T05:00:00Z'),
    { canDraw: false, blockers: ['DRAW_NOT_DUE'], dueDate: '2026-12-01' });
  assert.deepEqual(K.drawGate(group, 1, scheduled, { ready: true }, '2026-12-01T05:00:00Z').blockers,
    ['DRAW_TIME_NOT_REACHED']);
  assert.deepEqual(K.drawGate(group, 1, scheduled, { ready: false }, '2026-12-01T10:00:00Z').blockers,
    ['NOT_READY']);
  assert.deepEqual(K.drawGate(group, 1, scheduled, { ready: true }, '2026-12-01T10:00:00Z'),
    { canDraw: true, blockers: [], dueDate: '2026-12-01' });
});

test('local draw readiness requires every installment up to the round to be fully paid', () => {
  const group = { id: 'g', startDate: '2026-11-01', cycleType: 'monthly', installments: 2, shareAmount: 100000 };
  const db = {
    members: [{ id: 'm1', groupId: 'g', name: 'A', joinedAt: '2026-11-01' }],
    shares: [{ id: 's1', memberId: 'm1', groupId: 'g' }],
    receipts: [], draws: []
  };
  const open = K.drawReadinessLocal(db, group, '2026-12-01', 1);
  assert.equal(open.ready, false);
  assert.equal(open.reasons.length, 1);
  assert.equal(open.obligationsUnpaid, 2);
  assert.equal(open.installmentsRemaining, 2);
  assert.equal(open.remainingMinor, 100000);
  assert.equal(open.sharesIncomplete, 1);
  db.receipts = [1, 2].map(no => ({
    groupId: 'g', memberId: 'm1', cycle: 1, no, voided: false, shareIds: ['s1'], amount: 50000
  }));
  const paid = K.drawReadinessLocal(db, group, '2026-12-01', 1);
  assert.equal(paid.ready, true);
  assert.deepEqual(paid.reasons, []);
  assert.equal(paid.remainingMinor, 0);
  assert.equal(paid.sharesComplete, 1);
});

test('database readiness rows are normalized to a camelCase view model with safe defaults', () => {
  const view = K.normalizeReadiness({
    ready: true, reasons: ['x'], cycle_no: '2', periods_expected: 3,
    obligations_unpaid: '4', remaining_minor: '500'
  });
  assert.equal(view.ready, true);
  assert.deepEqual(view.reasons, ['x']);
  assert.equal(view.cycleNo, 2);
  assert.equal(view.periodsExpected, 3);
  assert.equal(view.obligationsUnpaid, 4);
  assert.equal(view.remainingMinor, 500);
  assert.equal(view.cycleId, null);
  assert.equal(view.membersTotal, 0);
  const empty = K.normalizeReadiness(null);
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.reasons, []);
  assert.equal(empty.cycleNo, null);
});

test('presentation state follows the cycle status once a result is recorded', () => {
  assert.equal(K.presentationState('scheduled', false), 'pending');
  assert.equal(K.presentationState('open', false), 'pending');
  assert.equal(K.presentationState(undefined, false), 'pending');
  assert.equal(K.presentationState('drawn', true), 'presenting');
  assert.equal(K.presentationState('completed', true), 'completed');
  assert.equal(K.presentationState('failed', true), 'failed');
});

test('wheel layout orders slots by share number so every device draws the same wheel', () => {
  const wheel = K.wheelLayout([
    { shareId: 'b', shareNo: 2 },
    { shareId: 'a', shareNo: 1 },
    { share_id: 'c', share_no: 3 }
  ]);
  assert.equal(wheel.slots.length, 3);
  assert.equal(wheel.indexOf('a'), 0);
  assert.equal(wheel.indexOf('b'), 1);
  assert.equal(wheel.indexOf('c'), 2);
  assert.equal(wheel.indexOf('missing'), -1);
});

test('notification channel settings default to publishing everything with names only on the draw result', () => {
  const defaults = K.normalizeNotifySettings(null);
  assert.deepEqual(K.notifyTypesOf(defaults.feed), K.NOTIFY_TYPE_IDS.slice());
  assert.deepEqual(K.notifyTypesOf(defaults.chat), K.NOTIFY_TYPE_IDS.slice());
  assert.deepEqual(K.notifyTypesOf(defaults.names), ['drawResult']);
  const custom = K.normalizeNotifySettings({
    feed_enabled_types: ['received'], chat_enabled_types: [],
    name_visible_types: ['drawResult', 'joined']
  });
  assert.equal(custom.feed.received, true);
  assert.equal(custom.feed.late, false);
  assert.deepEqual(K.notifyTypesOf(custom.chat), []);
  assert.equal(custom.names.joined, true);
  const legacy = K.normalizeNotifySettings({ enabled_types: ['late'] });
  assert.equal(legacy.chat.late, true);
  assert.equal(legacy.chat.received, false);
  assert.deepEqual(K.notifyTypesOf(legacy.feed), K.NOTIFY_TYPE_IDS.slice());
});
