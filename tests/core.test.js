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

test('splitAmount preserves every minor unit and assigns remainder first', () => {
  assert.deepEqual(K.splitAmount(100000, 3), [33334, 33333, 33333]);
  for (let total = 0; total < 100; total++) {
    for (let count = 1; count < 15; count++) {
      const parts = K.splitAmount(total, count);
      assert.equal(parts.reduce((sum, value) => sum + value, 0), total);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
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

test('quorum counts people rather than shares and compares threshold exactly', () => {
  const db = {
    members: [
      { id: 'm1', groupId: 'g', present: true },
      { id: 'm2', groupId: 'g', present: false },
      { id: 'm3', groupId: 'g', present: true }
    ],
    shares: [
      { memberId: 'm1', groupId: 'g' }, { memberId: 'm1', groupId: 'g' },
      { memberId: 'm1', groupId: 'g' }, { memberId: 'm2', groupId: 'g' },
      { memberId: 'm3', groupId: 'g' }
    ]
  };
  const quorum = K.quorumInfo(db, { id: 'g', quorum: 67 });
  assert.equal(quorum.people, 3);
  assert.equal(quorum.present, 2);
  assert.equal(quorum.required, 3);
  assert.equal(quorum.met, false);
});

test('member commitment multiplies each installment by share count', () => {
  const group = { shareAmount: 100000, installments: 3 };
  assert.deepEqual(K.memberCommitment(group, 3, 10), {
    shares: 3, perInstallment: [100002, 99999, 99999],
    perCycle: 300000, overall: 3000000
  });
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
