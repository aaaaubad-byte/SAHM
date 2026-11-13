'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

function createGroup(w, overrides = {}) {
  const config = Object.assign({
    name: 'جمعية اختبار الدفعة الأولى', currency: 'YER', cycleType: 'monthly',
    shareAmount: '90000', installments: 3, startDate: '2026-11-13',
    targetShares: 3, maxPerMember: 2, quorum: 60, rules: ''
  }, overrides);
  config.maxPerMember = Math.min(config.maxPerMember, config.targetShares);
  const result = w.D.createGroup(w.db, 'me', config);
  assert.equal(result.ok, true, JSON.stringify(result));
  return { result, group: w.db.groups.find(g => g.id === result.groupId) };
}

test('data store loads a versioned seed and required collections', () => {
  const w = fresh();
  assert.equal(w.db.version, w.D.VERSION);
  for (const key of ['groups', 'members', 'shares', 'receipts', 'draws', 'messages', 'events', 'notifications', 'reminders', 'invites', 'corrections']) {
    assert.ok(Array.isArray(w.db[key]), key);
  }
});

test('manager-only creation does not create a manager share', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, managerMode: 'only' });
  assert.equal(w.K.groupShares(w.db, group.id).length, 0);
  assert.equal(w.D.groupDetail(w.db, 'me', group.id).role.manager, true);
  assert.equal(w.D.groupDetail(w.db, 'me', group.id).role.participant, false);
});

test('manager-participant creation creates only the configured manager shares', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 3, managerMode: 'both', managerShares: 2 });
  assert.equal(w.K.groupShares(w.db, group.id).length, 2);
  assert.equal(w.D.groupDetail(w.db, 'me', group.id).role.label, 'مدير ومشارك');
});

test('invalid group creation is rejected without adding a group', () => {
  const w = fresh();
  const before = w.db.groups.length;
  const result = w.D.createGroup(w.db, 'me', {
    name: '', currency: 'EUR', cycleType: 'monthly', shareAmount: '0',
    installments: 0, startDate: '2026-02-30', targetShares: 0, maxPerMember: 0, quorum: 101
  });
  assert.equal(result.ok, false);
  assert.equal(w.db.groups.length, before);
});

test('late member addition requires confirmation and reports expired periods', () => {
  const w = fresh();
  const { group } = createGroup(w, { startDate: '2026-11-01', targetShares: 2 });
  w.clock.now = '2026-11-21T10:00';
  const denied = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو متأخر', userId: 'late-user', shares: 1, joinedAt: '2026-11-21'
  });
  assert.equal(denied.code, 'LATE_IMPACT_CONFIRM_REQUIRED');
  const accepted = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو متأخر', userId: 'late-user', shares: 1,
    joinedAt: '2026-11-21', confirmLateImpact: true
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.lateImpact.items.map(x => x.no), [1, 2]);
  const member = accepted.member;
  const first = w.K.obligation(w.db, group, member, 1, 1, '2026-11-21');
  const third = w.K.obligation(w.db, group, member, 1, 3, '2026-11-21');
  assert.equal(first.status, 'late');
  assert.equal(first.lateByJoin, true);
  assert.equal(third.status, 'due');
});

test('member and share limits are enforced', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, maxPerMember: 1 });
  const first = w.D.addMember(w.db, 'me', group.id, {
    name: 'الأول', userId: 'u1', shares: 1, joinedAt: '2026-11-13'
  });
  assert.equal(first.ok, true);
  const over = w.D.addMember(w.db, 'me', group.id, {
    name: 'الثاني', userId: 'u2', shares: 2, joinedAt: '2026-11-13'
  });
  assert.equal(over.code, 'MAX_PER_MEMBER');
});

test('manager and participant views enforce role separation', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, managerMode: 'both', managerShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'مشارك', userId: 'participant-1', shares: 1, joinedAt: '2026-11-13'
  }).member;
  assert.equal(w.D.groupDetail(w.db, 'outsider', group.id).code, 'FORBIDDEN');
  const detail = w.D.groupDetail(w.db, 'participant-1', group.id);
  assert.equal(detail.role.manager, false);
  assert.equal(detail.permissions.canRecordPaid, false);
  assert.equal('inviteCode' in detail.group, false);
  const list = w.D.memberList(w.db, 'participant-1', group.id);
  assert.equal(list.scope, 'participant');
  assert.ok(list.members.every(x => !('present' in x) && !('joinedAt' in x) && !('linkedUser' in x)));
  assert.equal(member.userId, 'participant-1');
});

test('only manager can record receipts; self-receipt is explicitly marked', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, managerMode: 'both', managerShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'مشارك', userId: 'participant-2', shares: 1, joinedAt: '2026-11-13'
  }).member;
  const denied = w.D.recordPaid(w.db, 'participant-2', {
    groupId: group.id, memberId: member.id, cycle: 1, no: 1
  });
  assert.equal(denied.code, 'FORBIDDEN');
  const self = w.D.recordPaid(w.db, 'me', {
    groupId: group.id, memberId: w.db.members.find(m => m.groupId === group.id && m.userId === 'me').id,
    cycle: 1, no: 1
  });
  assert.equal(self.ok, true);
  assert.equal(self.receipt.self, true);
  const paid = w.D.recordPaid(w.db, 'me', {
    groupId: group.id, memberId: member.id, cycle: 1, no: 1
  });
  assert.equal(paid.ok, true);
  assert.equal(paid.receipt.self, false);
  const duplicate = w.D.recordPaid(w.db, 'me', {
    groupId: group.id, memberId: member.id, cycle: 1, no: 1
  });
  assert.equal(duplicate.code, 'ALREADY_RECORDED');
});

test('receipt correction is manager-only, reasoned and auditable', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو', userId: 'receipt-user', shares: 1, joinedAt: '2026-11-13'
  }).member;
  const receipt = w.D.recordPaid(w.db, 'me', {
    groupId: group.id, memberId: member.id, cycle: 1, no: 1
  }).receipt;
  assert.equal(w.D.correctReceipt(w.db, 'receipt-user', receipt.id, { reason: 'سبب واضح' }).code, 'FORBIDDEN');
  assert.equal(w.D.correctReceipt(w.db, 'me', receipt.id, { reason: 'x' }).code, 'REASON_REQUIRED');
  const corrected = w.D.correctReceipt(w.db, 'me', receipt.id, {
    reason: 'تصحيح سجل الاختبار', action: 'void'
  });
  assert.equal(corrected.ok, true);
  assert.equal(w.db.receipts.find(x => x.id === receipt.id).voided, true);
  assert.equal(w.db.corrections.length, 1);
});

test('reminder repeat asks for confirmation and paid members are excluded', () => {
  const w = fresh();
  const { group } = createGroup(w, { startDate: '2026-11-01', targetShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو', userId: 'reminder-user', shares: 1, joinedAt: '2026-11-01'
  }).member;
  assert.equal(w.D.sendReminder(w.db, 'me', {
    groupId: group.id, cycle: 1, no: 1, memberId: member.id
  }).ok, true);
  const repeated = w.D.sendReminder(w.db, 'me', {
    groupId: group.id, cycle: 1, no: 1, memberId: member.id
  });
  assert.equal(repeated.code, 'REMINDER_REPEAT');
  assert.equal(repeated.needsConfirm, true);
  assert.equal(w.D.recordPaid(w.db, 'me', {
    groupId: group.id, memberId: member.id, cycle: 1, no: 1
  }).ok, true);
  assert.equal(w.D.sendReminder(w.db, 'me', {
    groupId: group.id, cycle: 1, no: 1, memberId: member.id
  }).code, 'ALREADY_PAID');
});

test('member messages are limited to 50 characters and require membership', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو', userId: 'chat-user', shares: 1, joinedAt: '2026-11-13'
  }).member;
  assert.equal(w.D.sendMessage(w.db, 'chat-user', group.id, 'رسالة قصيرة').ok, true);
  assert.equal(w.D.sendMessage(w.db, 'chat-user', group.id, 'ا'.repeat(51)).code, 'MESSAGE_TOO_LONG');
  assert.equal(w.D.sendMessage(w.db, 'outsider', group.id, 'رسالة').code, 'FORBIDDEN');
  assert.equal(w.D.chatView(w.db, 'chat-user', group.id).maxLength, 50);
  assert.equal(member.userId, 'chat-user');
});

test('first draw waits for its date and quorum, then locks membership', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, managerMode: 'both', managerShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'مشارك', userId: 'draw-user', shares: 1, joinedAt: '2026-11-13'
  }).member;
  const manager = w.db.members.find(m => m.groupId === group.id && m.userId === 'me');
  w.D.setAttendance(w.db, 'me', manager.id, true);
  w.clock.now = '2026-12-13T10:00';
  assert.equal(w.D.performDraw(w.db, 'me', group.id, { rng: () => 0 }).code, 'QUORUM_NOT_MET');
  w.D.setAttendance(w.db, 'me', member.id, true);
  const draw = w.D.performDraw(w.db, 'me', group.id, { rng: () => 0 });
  assert.equal(draw.ok, true);
  assert.equal(draw.firstDraw, true);
  assert.equal(w.D.drawStatus(w.db, group.id).locked, true);
  assert.equal(w.D.addMember(w.db, 'me', group.id, {
    name: 'بعد القفل', userId: 'late-after-draw', shares: 1, joinedAt: '2026-12-13', confirmLateImpact: true
  }).code, 'GROUP_LOCKED');
  assert.equal(w.K.eligibleShares(w.db, group.id).length, 1);
});

test('tick does not duplicate generated notices on repeated calls', () => {
  const w = fresh();
  const first = w.D.tick(w.db);
  const messageCount = w.db.messages.length;
  const second = w.D.tick(w.db);
  assert.equal(second.posted, 0);
  assert.equal(w.db.messages.length, messageCount);
  assert.ok(first.posted >= 0);
});

test('normalization is idempotent and keeps collection shapes', () => {
  const w = fresh();
  w.D.normalizeDb(w.db);
  const once = JSON.stringify(w.db);
  w.D.normalizeDb(w.db);
  assert.equal(JSON.stringify(w.db), once);
});

test('successful save and reload preserve created groups and receipts', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'عضو', userId: 'persist-user', shares: 1, joinedAt: '2026-11-13'
  }).member;
  w.D.recordPaid(w.db, 'me', { groupId: group.id, memberId: member.id, cycle: 1, no: 1 });
  const loaded = w.D.load();
  assert.ok(loaded.groups.some(g => g.id === group.id));
  assert.ok(loaded.receipts.some(r => r.memberId === member.id));
});

test('corrupt stored data is archived before a fresh seed is used', () => {
  const w = fresh();
  w.storage.put(w.D.KEYS.data, '{broken json');
  const loaded = w.D.load();
  assert.ok(w.D.archiveList().some(x => x.key === w.D.KEYS.data && x.reason === 'corrupt'));
  assert.ok(Array.isArray(loaded.groups));
});

test('storage write failure is reported instead of claiming persistence', () => {
  const w = fresh();
  w.storage.failWrites = true;
  const { group } = createGroup(w, { targetShares: 1 });
  const result = w.D.updateGroup(w.db, 'me', group.id, { name: 'تعديل غير محفوظ' });
  assert.equal(result.persisted, false);
  assert.ok(result.warning);
});

test('adding shares respects the per-member limit and records the new share', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2, maxPerMember: 2 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'صاحب سهم', userId: 'share-owner', shares: 1, joinedAt: '2026-11-13'
  }).member;
  const added = w.D.addShares(w.db, 'me', member.id, 1);
  assert.equal(added.ok, true);
  assert.equal(added.totalShares, 2);
  assert.equal(w.K.memberShares(w.db, member.id).length, 2);
  assert.equal(w.D.addShares(w.db, 'me', member.id, 1).code, 'MAX_PER_MEMBER');
});

test('invitation acceptance binds the invited phone to the joining account', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 2 });
  const invitation = w.D.createInvite(w.db, 'me', group.id, {
    name: 'مدعو', phone: '777123456', shares: 1
  });
  assert.equal(invitation.ok, true);
  const joined = w.D.joinByCode(w.db, 'invitee-user', group.inviteCode, {
    name: 'المدعو', phone: '777123456'
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.member.userId, 'invitee-user');
  assert.equal(w.D.inviteSummary(w.db, group.id).assigned, 1);
});

test('manager controls group notification types while members control their own mute', () => {
  const w = fresh();
  const { group } = createGroup(w, { targetShares: 1 });
  const member = w.D.addMember(w.db, 'me', group.id, {
    name: 'مشارك', userId: 'mute-user', shares: 1, joinedAt: '2026-11-13'
  }).member;
  assert.equal(w.D.setNotifyType(w.db, 'me', group.id, 'received', false).ok, true);
  assert.equal(group.notify.received, false);
  assert.equal(w.D.setNotifyType(w.db, 'mute-user', group.id, 'received', true).code, 'FORBIDDEN');
  assert.equal(w.D.setMute(w.db, 'mute-user', group.id, { group: true, reminders: true }).ok, true);
  assert.equal(w.D.isMuted(w.db, group.id, 'reminder'), true);
  assert.equal(w.D.isMuted(w.db, group.id, 'group'), true);
  assert.equal(member.userId, 'mute-user');
});

test('v3 data is archived and migrated to the current schema', () => {
  const w = fresh();
  const old = w.D.buildSeed('2026-11-13');
  old.version = 'sahm-data-2026-11-v3';
  w.storage.put(w.D.KEYS.data, old);
  const migrated = w.D.load();
  assert.equal(migrated.version, w.D.VERSION);
  assert.ok(migrated.shares.every(x => !!x.addedAt));
  assert.ok(w.D.archiveList().some(x => x.key === w.D.KEYS.data && x.reason === 'migrated-from-sahm-data-2026-11-v3'));
});

test('chat list is sourced from accessible associations and sorted by newest message', () => {
  const w = fresh();
  const first = createGroup(w, { targetShares: 1 }).group;
  const second = createGroup(w, { targetShares: 1 }).group;

  w.clock.now = '2026-11-13T10:00';
  assert.equal(w.D.sendMessage(w.db, 'me', first.id, 'رسالة أقدم').ok, true);
  w.clock.now = '2026-11-13T11:00';
  assert.equal(w.D.sendMessage(w.db, 'me', second.id, 'رسالة أحدث').ok, true);

  const rows = w.D.chatList(w.db);
  const secondRow = rows.find(x => x.group.id === second.id);
  const firstRow = rows.find(x => x.group.id === first.id);
  assert.ok(secondRow && firstRow, 'both accessible group conversations are listed');
  assert.ok(rows.indexOf(secondRow) < rows.indexOf(firstRow), 'newer conversation appears first');
  assert.equal(secondRow.last.text, 'رسالة أحدث');
  assert.equal(firstRow.last.text, 'رسالة أقدم');
});
