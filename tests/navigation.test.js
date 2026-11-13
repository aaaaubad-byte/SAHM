'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../sahm-navigation.js');

function fakeWindow() {
  const listeners = new Map();
  const entries = [{ state: null, url: 'https://sahm.test/' }];
  let index = 0;
  const win = {
    location: { href: 'https://sahm.test/' },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      if (listeners.has(name)) listeners.get(name).delete(fn);
    },
    dispatch(name, event) {
      for (const fn of listeners.get(name) || []) fn(event);
    }
  };
  win.history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _title, url) {
      entries.splice(index + 1);
      entries.push({ state: structuredClone(state), url: url || win.location.href });
      index++;
    },
    replaceState(state, _title, url) {
      entries[index] = { state: structuredClone(state), url: url || win.location.href };
    },
    back() {
      if (index === 0) return;
      index--;
      win.dispatch('popstate', { state: entries[index].state });
    },
    forward() {
      if (index >= entries.length - 1) return;
      index++;
      win.dispatch('popstate', { state: entries[index].state });
    }
  };
  return win;
}

test('back and forward restore the real route sequence and its context', () => {
  const win = fakeWindow();
  const changes = [];
  const nav = create({ window: win, onChange: state => changes.push(state) });
  nav.start({ screenName: 'home', currentGroupId: null });
  nav.navigate({ screenName: 'groups', groupTab: 'manager' });
  nav.navigate({
    screenName: 'group-detail',
    currentGroupId: 'group-1',
    groupDetailTab: 'members',
    viewState: { selectedInstallmentCycle: 2, selectedInstallmentStatus: 'late' }
  });

  nav.back();
  assert.equal(nav.current().screenName, 'groups');
  assert.equal(nav.current().groupTab, 'manager');
  nav.back();
  assert.equal(nav.current().screenName, 'home');

  nav.forward();
  assert.equal(nav.current().screenName, 'groups');
  nav.forward();
  assert.equal(nav.current().screenName, 'group-detail');
  assert.equal(nav.current().currentGroupId, 'group-1');
  assert.equal(nav.current().groupDetailTab, 'members');
  assert.deepEqual(nav.current().viewState, {
    selectedInstallmentCycle: 2,
    selectedInstallmentStatus: 'late'
  });
  assert.equal(changes.length, 4);
});

test('device back closes a modal before leaving the underlying screen', () => {
  const win = fakeWindow();
  const nav = create({ window: win });
  nav.start({ screenName: 'home' });
  nav.navigate({ screenName: 'profile' });
  assert.equal(nav.openModal(), true);
  assert.equal(nav.current().layer, 'modal');

  nav.back();
  assert.equal(nav.current().screenName, 'profile');
  assert.equal(nav.current().layer, 'screen');
  nav.back();
  assert.equal(nav.current().screenName, 'home');
});

test('explicit modal close does not leave a phantom modal history entry', () => {
  const win = fakeWindow();
  const nav = create({ window: win });
  nav.start({ screenName: 'home' });
  nav.navigate({ screenName: 'profile' });
  nav.openModal();
  assert.equal(nav.dismissModal(), true);
  nav.navigate({ screenName: 'settings' });
  nav.back();
  assert.equal(nav.current().screenName, 'profile');
  assert.equal(nav.current().layer, 'screen');
});

test('reset creates an authentication boundary and blocks stale route restoration', () => {
  const win = fakeWindow();
  const nav = create({ window: win });
  nav.start({ screenName: 'home' });
  nav.navigate({ screenName: 'groups' });
  const before = nav.current().epoch;
  nav.reset({ screenName: 'logged-out' });
  assert.equal(nav.current().depth, 0);
  assert.equal(nav.current().epoch, before + 1);

  nav.back();
  assert.equal(nav.current().screenName, 'logged-out');
  assert.equal(nav.current().epoch, before + 1);
});

test('navigating to an identical route does not add another history entry', () => {
  const win = fakeWindow();
  const nav = create({ window: win });
  nav.start({ screenName: 'home' });
  const length = win.history.length;
  nav.navigate({ screenName: 'home' });
  assert.equal(win.history.length, length);
  assert.equal(nav.current().depth, 0);
});

test('creation wizard stages are browser-history entries and retain the draft', () => {
  const win = fakeWindow();
  const nav = create({ window: win });
  nav.start({ screenName: 'groups' });
  nav.navigate({
    screenName: 'create-group',
    viewState: { createWizardStep: 1, createFormSnapshot: { name: 'جمعية الاختبار' } }
  });
  nav.navigate({
    screenName: 'create-group',
    viewState: { createWizardStep: 2, createFormSnapshot: { name: 'جمعية الاختبار', currency: 'YER' } }
  });
  nav.navigate({
    screenName: 'create-group',
    viewState: { createWizardStep: 3, createFormSnapshot: { name: 'جمعية الاختبار', currency: 'YER', targetShares: '10' } }
  });

  nav.back();
  assert.equal(nav.current().viewState.createWizardStep, 2);
  assert.equal(nav.current().viewState.createFormSnapshot.currency, 'YER');
  nav.back();
  assert.equal(nav.current().viewState.createWizardStep, 1);
  nav.forward();
  assert.equal(nav.current().viewState.createWizardStep, 2);
  nav.forward();
  assert.equal(nav.current().viewState.createWizardStep, 3);
  assert.equal(nav.current().viewState.createFormSnapshot.targetShares, '10');
});
