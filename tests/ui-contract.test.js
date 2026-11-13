'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sahm-app.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'sahm-data.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'sahm-core.js'), 'utf8');

function stringsFromArray(source, pattern) {
  const match = source.match(pattern);
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]) : [];
}

function objectKeys(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker + ' exists');
  const block = source.slice(start);
  return [...block.matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)].map(item => item[1]);
}

test('every registered screen has a real renderer and every static route resolves', () => {
  const registryMatch = html.match(/const ALL_SCREEN_REGISTRY=\{([\s\S]*?)\n\};/);
  assert.ok(registryMatch, 'central screen registry exists');
  const screenEntries = [...registryMatch[1].matchAll(/(?:^|,)\s*'?([A-Za-z_$][\w$-]*)'?\s*:\s*([A-Za-z_$][\w$]*)/gm)];
  assert.ok(screenEntries.length >= 20, 'all application screens are registered');

  const renderers = new Set([...html.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(x => x[1]));
  for (const [, route, renderer] of screenEntries) {
    assert.ok(renderers.has(renderer), route + ' has renderer ' + renderer);
  }

  const routes = new Set(screenEntries.map(x => x[1]));
  const directTargets = [...html.matchAll(/data-go="([^"]+)"/g)]
    .map(x => x[1]).filter(x => !x.includes('${'));
  for (const route of directTargets) {
    assert.ok(routes.has(route), 'data-go route is registered: ' + route);
  }
});

test('all screen engine calls resolve through SahmApp to real SahmData methods', () => {
  const used = new Set([...html.matchAll(/\bSahmApp\.([A-Za-z_$][\w$]*)/g)].map(x => x[1]));
  const actor = stringsFromArray(app, /var ACTOR_OPS = \[([\s\S]*?)\];/);
  const view = stringsFromArray(app, /var VIEW_QUERIES = \[([\s\S]*?)\];/);
  const plain = stringsFromArray(app, /var PLAIN = \[([\s\S]*?)\];/);
  const appApi = new Set([...actor, ...view, ...plain]);

  const apiObject = app.match(/var api = \{([\s\S]*?)\};/);
  if (apiObject) {
    for (const match of apiObject[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)) appApi.add(match[1]);
  }
  for (const match of app.matchAll(/api\.([A-Za-z_$][\w$]*)\s*=/g)) appApi.add(match[1]);

  const dataObject = data.slice(data.indexOf('root.SahmData = {'));
  const dataExports = new Set(objectKeys(dataObject, 'root.SahmData = {'));
  for (const name of used) {
    assert.ok(appApi.has(name), 'SahmApp.' + name + ' is exported');
    assert.ok(dataExports.has(name) || ['init','store','viewer','onResult','nowAt','todayIn','chatTime','timeZone','notifyTypes','maxMessage','myGroups','roleOf','chatList','recentActivity','unreadNotifications','tick','storageState','takeNotices','prefs','savePrefs'].includes(name),
      'SahmApp.' + name + ' maps to a declared source method');
  }

  const coreUsed = new Set([...html.matchAll(/\bSahmCore\.([A-Za-z_$][\w$]*)/g)].map(x => x[1]));
  const coreObject = core.slice(core.indexOf('root.SahmCore = {'));
  const coreExports = new Set(objectKeys(coreObject, 'root.SahmCore = {'));
  for (const name of coreUsed) assert.ok(coreExports.has(name), 'SahmCore.' + name + ' is exported');
});

test('obsolete parallel view-model collections and no-op route helpers are absent', () => {
  for (const property of ['participants','messages','wall','receipts','invites','audit']) {
    assert.doesNotMatch(html, new RegExp('\\bdb\\.' + property + '\\b'));
  }
  assert.doesNotMatch(html, /function\s+log\s*\(/);
  assert.doesNotMatch(html, /function\s+wall\s*\(\)\s*\{\s*chat\s*\(\)\s*\}/);
  assert.doesNotMatch(html, /\bstack\s*=\s*\[\]/);
});
