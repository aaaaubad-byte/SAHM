'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdaptiveStore } = require('../editor/adaptive/store');

function makeGitHub() {
  let head = 'c0ffee0000000000000000000000000000000000';
  const commits = new Map([[head, { sha: head, tree: { sha: 'tree0' } }]]);
  const trees = new Map([['tree0', new Map()]]);
  const blobs = new Map();
  let sequence = 0;
  async function gh(url, options) {
    const u = new URL(url), path = u.pathname, method = (options && options.method) || 'GET';
    if (method === 'GET' && /\/git\/ref\/heads\//.test(path)) return { object: { sha: head } };
    if (method === 'GET' && /\/git\/commits\//.test(path)) return commits.get(path.split('/').pop());
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      const body = JSON.parse(options.body), sha = 'blob' + (++sequence);
      blobs.set(sha, body.content); return { sha: sha };
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      const body = JSON.parse(options.body), map = new Map(trees.get(body.base_tree) || []);
      body.tree.forEach((item) => map.set(item.path, item.sha));
      const sha = 'tree' + (++sequence); trees.set(sha, map); return { sha: sha };
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      const body = JSON.parse(options.body), sha = 'commit' + (++sequence);
      commits.set(sha, { sha: sha, tree: { sha: body.tree }, parents: body.parents }); return { sha: sha };
    }
    if (method === 'PATCH' && /\/git\/refs\/heads\//.test(path)) {
      const body = JSON.parse(options.body), current = commits.get(head), next = commits.get(body.sha);
      assert.ok(current && next); head = body.sha;
      return { ref: 'refs/heads/SAHM-LAB', object: { sha: head } };
    }
    if (method === 'GET' && path.includes('/contents/')) {
      const filePath = decodeURIComponent(path.split('/contents/')[1]);
      const snapshot = trees.get(commits.get(head).tree.sha) || new Map();
      if (!filePath.endsWith('.json')) {
        const prefix = filePath.replace(/\/$/, '') + '/';
        const items = Array.from(snapshot.keys()).filter((key) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') === -1);
        if (!items.length) { const error = new Error('NOT_FOUND'); error.status = 404; throw error; }
        return items.map((key) => ({ type: 'file', name: key.slice(prefix.length), path: key }));
      }
      const sha = snapshot.get(filePath);
      if (!sha) { const error = new Error('NOT_FOUND'); error.status = 404; throw error; }
      return { encoding: 'base64', content: Buffer.from(blobs.get(sha), 'utf8').toString('base64') };
    }
    throw new Error('UNEXPECTED_GITHUB_CALL ' + method + ' ' + path);
  }
  return { gh: gh };
}
function setup(auth) {
  const mock = makeGitHub(), capture = { status: null, body: null };
  const handler = createAdaptiveStore({
    gh: mock.gh,
    auth: auth || (async () => ({ id: 'admin-test' })),
    send: (res, status, body) => { res.status = status; res.body = body; },
    repo: 'test/repo', branch: 'SAHM-LAB'
  });
  return { handler: handler, capture: capture };
}
async function call(ctx, method, route, body) {
  await ctx.handler({ method: method, body: body || {} }, ctx.capture, route);
  return ctx.capture;
}

test('profiles persist with immutable versions and restore as a new revision', async () => {
  const ctx = setup();
  await call(ctx, 'POST', '/api/adaptive/profiles', {
    id: 'mobile-base', name: 'Mobile base',
    rules: [{ id: 'body-copy', target: { semanticRole: 'body-copy', expectedTag: 'p' }, styles: { 'font-size': '14px', 'line-height': '1.5' } }]
  });
  assert.equal(ctx.capture.status, 201);
  assert.equal(ctx.capture.body.item.version, 1);
  await call(ctx, 'PUT', '/api/adaptive/profiles/mobile-base', {
    expectedVersion: 1, name: 'Mobile base',
    rules: [{ id: 'body-copy', target: { semanticRole: 'body-copy', expectedTag: 'p' }, styles: { 'font-size': '15px', 'line-height': '1.55' } }]
  });
  assert.equal(ctx.capture.status, 200);
  assert.equal(ctx.capture.body.item.version, 2);
  await call(ctx, 'GET', '/api/adaptive/profiles/mobile-base/versions');
  assert.deepEqual(ctx.capture.body.versions.map((item) => item.version), [2, 1]);
  await call(ctx, 'POST', '/api/adaptive/profiles/mobile-base/restore', { version: 1, expectedVersion: 2 });
  assert.equal(ctx.capture.status, 200);
  assert.equal(ctx.capture.body.item.version, 3);
  assert.equal(ctx.capture.body.item.restoredFromVersion, 1);
  assert.equal(ctx.capture.body.item.rules[0].styles['font-size'], '14px');
});

test('stale writes, class-only targets and unsafe CSS are rejected', async () => {
  const ctx = setup();
  await call(ctx, 'POST', '/api/adaptive/profiles', {
    id: 'desktop-base', name: 'Desktop base',
    rules: [{ target: { semanticRole: 'title' }, styles: { 'font-size': '22px' } }]
  });
  assert.equal(ctx.capture.status, 201);
  await call(ctx, 'PUT', '/api/adaptive/profiles/desktop-base', {
    expectedVersion: 0, name: 'Stale update',
    rules: [{ target: { semanticRole: 'title' }, styles: { 'font-size': '23px' } }]
  });
  assert.equal(ctx.capture.status, 409);
  await call(ctx, 'POST', '/api/adaptive/profiles', {
    id: 'bad-selector', name: 'Bad selector',
    rules: [{ target: { selector: '.random-class' }, styles: { 'font-size': '14px' } }]
  });
  assert.equal(ctx.capture.status, 400);
  await call(ctx, 'POST', '/api/adaptive/profiles', {
    id: 'bad-css', name: 'Bad css',
    rules: [{ target: { semanticRole: 'title' }, styles: { 'font-size': '14px;display:none' } }]
  });
  assert.equal(ctx.capture.status, 400);
});

test('screen assignments retain explicit shared profile and component priorities', async () => {
  const ctx = setup();
  await call(ctx, 'POST', '/api/adaptive/assignments', {
    id: 'home',
    profiles: [{ id: 'mobile-base', priority: 10, enabled: true }, { id: 'rtl-overrides', priority: 20, enabled: true }],
    components: [{ id: 'card-default', priority: 5, enabled: true }],
    roleBindings: [{ elementId: 'se-home-title', semanticRole: 'shared-title' }, { elementId: 'se-home-subtitle', semanticRole: 'shared-title' }],
    overrides: [{ elementId: 'se-home-title', styles: { 'font-size': '21px' } }]
  });
  assert.equal(ctx.capture.status, 201);
  assert.equal(ctx.capture.body.item.screenId, 'home');
  assert.equal(ctx.capture.body.item.roleBindings.length, 2);
  assert.deepEqual(ctx.capture.body.item.profiles.map((item) => item.priority), [10, 20]);
});

test('every adaptive endpoint requires editor authorization', async () => {
  const ctx = setup(async () => { const error = new Error('AUTH_REQUIRED'); error.status = 401; throw error; });
  await call(ctx, 'GET', '/api/adaptive/profiles');
  assert.equal(ctx.capture.status, 401);
  assert.equal(ctx.capture.body.error, 'AUTH_REQUIRED');
});

test('role bindings reject invalid roles and duplicate element ids', async () => {
  const ctx = setup();
  await call(ctx, 'POST', '/api/adaptive/assignments', { id: 'profile', profiles: [], components: [], overrides: [], roleBindings: [{ elementId: 'se-title', semanticRole: 'shared-title' }] });
  assert.equal(ctx.capture.status, 201);
  await call(ctx, 'PUT', '/api/adaptive/assignments/profile', { expectedVersion: 1, profiles: [], components: [], overrides: [], roleBindings: [{ elementId: 'se-title', semanticRole: 'bad role' }] });
  assert.equal(ctx.capture.status, 400);
  await call(ctx, 'PUT', '/api/adaptive/assignments/profile', { expectedVersion: 1, profiles: [], components: [], overrides: [], roleBindings: [{ elementId: 'se-title', semanticRole: 'shared-title' }, { elementId: 'se-title', semanticRole: 'other-title' }] });
  assert.equal(ctx.capture.status, 400);
});
