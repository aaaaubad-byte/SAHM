'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadModules } = require('./helpers');

const html = fs.readFileSync(path.join(__dirname, '..', 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
const { K } = loadModules();

function extractFunction(name, nextName) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  const end = html.indexOf('\nfunction ' + nextName + '(', start);
  assert.notEqual(end, -1, nextName + ' follows ' + name);
  return html.slice(start, end).trim();
}

test('remote RLS-scoped join requests are copied into the screen view model', () => {
  const source = extractFunction('load', 'save');
  const requests = [
    { id: 'request-1', groupId: 'association-1', status: 'pending', requestedShares: 2 },
    { id: 'request-2', groupId: 'association-1', status: 'rejected', requestedShares: 1 }
  ];
  const appStore = { joinRequests: requests, invites: [{ id: 'invite-1' }] };
  const context = {
    SahmCore: K,
    SahmApp: {
      prefs: () => ({ session: true, verified: true, user: { id: 'user-1', name: 'مستخدم' } }),
      store: () => appStore,
      myGroups: () => ({ managed: [], joined: [] }),
      notificationList: () => ({ ok: true, unread: 0 }),
      unreadNotifications: () => 0
    }
  };
  const load = vm.runInNewContext('(' + source + ')', context);
  const result = load();
  assert.deepEqual(JSON.parse(JSON.stringify(result.joinRequests)), requests);
  assert.deepEqual(JSON.parse(JSON.stringify(result.invites)), appStore.invites);
  assert.notEqual(result.joinRequests, requests, 'view model receives its own array snapshot');
});

test('count-based join preview calculates first installment without an undefined variable', () => {
  const source = extractFunction('joinInstallmentPreview', 'showJoinRequestForm');
  const preview = vm.runInNewContext('(' + source + ')', {
    SahmCore: K,
    minorMoney: value => String(value),
    dateLabel: value => String(value)
  });
  const rendered = preview({
    currency: 'YER',
    shareAmountMinor: 1000,
    installments: 3,
    cycleDays: 30,
    startDate: '2027-01-01',
    installmentMode: 'count'
  }, 2);
  assert.match(rendered, /2000/, 'total commitment equals 2 shares');
  assert.match(rendered, /668/, 'first installment uses the first balanced split');
  assert.match(rendered, /666/, 'remaining installments preserve the remainder');
});

test('fixed-amount join preview displays the residual final installment', () => {
  const source = extractFunction('joinInstallmentPreview', 'showJoinRequestForm');
  const preview = vm.runInNewContext('(' + source + ')', {
    SahmCore: K,
    minorMoney: value => String(value),
    dateLabel: value => String(value)
  });
  const rendered = preview({
    currency: 'YER',
    shareAmountMinor: 1000,
    installments: 4,
    installmentMode: 'amount',
    installmentAmountMinor: 300,
    cycleDays: 30,
    startDate: '2027-01-01'
  }, 2);
  assert.match(rendered, /2000/, 'total commitment equals the full share amount times shares');
  assert.match(rendered, /600/, 'first fixed installment is multiplied by shares');
  assert.match(rendered, /200/, 'final residual installment is preserved');
});

test('manager request filters display only the selected request state', () => {
  const source = extractFunction('joinRequests', 'joinRequestDetail');
  const state = { rendered: '', joinRequestFilter: 'pending' };
  const context = {
    db: { joinRequests: [
      { id: 'p1', groupId: 'g1', status: 'pending', applicantName: 'معلق', requestedShares: 2, estimatedAmountMinor: 200, currency: 'YER', sourceType: 'public_link', submittedAt: '2026-11-14' },
      { id: 'a1', groupId: 'g1', status: 'approved', applicantName: 'مقبول', requestedShares: 1, estimatedAmountMinor: 100, currency: 'YER', sourceType: 'invitation', submittedAt: '2026-11-13' },
      { id: 'r1', groupId: 'g1', status: 'rejected', applicantName: 'مرفوض', requestedShares: 3, estimatedAmountMinor: 300, currency: 'YER', sourceType: 'invitation', submittedAt: '2026-11-12' }
    ] },
    joinRequestFilter: state.joinRequestFilter,
    currentGroup: () => ({ id: 'g1', name: 'جمعية الاختبار' }),
    isManager: () => true,
    toast: () => {},
    go: () => {},
    escapeHtml: value => String(value),
    minorMoney: value => String(value),
    dateLabel: value => String(value),
    pill: value => '[' + value + ']',
    header: () => '',
    shell: (title, active, markup) => { state.rendered = markup; }
  };
  const render = vm.runInNewContext('(' + source + ')', context);
  render();
  assert.match(state.rendered, /معلق/);
  assert.doesNotMatch(state.rendered, /مقبول/);
  context.joinRequestFilter = 'approved';
  render();
  assert.match(state.rendered, /مقبول/);
  assert.doesNotMatch(state.rendered, /معلق/);
  context.joinRequestFilter = 'all';
  render();
  assert.match(state.rendered, /معلق/);
  assert.match(state.rendered, /مقبول/);
  assert.match(state.rendered, /مرفوض/);
});

test('join request form guards repeated submission and restores button state', () => {
  assert.match(html, /if\(joinRequestBusy\)return;/);
  assert.match(html, /joinRequestBusy=true/);
  assert.match(html, /finally\{[\s\S]*?joinRequestBusy=false/);
  assert.match(html, /submit\.disabled=true/);
});

test('latest activity routes manager reviews and applicant outcomes to request screens', () => {
  const activity = extractFunction('homeActivity', 'homeInvitations');
  assert.match(activity, /join_request_submitted/);
  assert.match(activity, /join_request_approved/);
  assert.match(activity, /join_request_rejected/);
  assert.match(activity, /join_request_cancelled/);
  assert.match(activity, /join-request-detail/);
  assert.match(activity, /join-request-status/);
});
