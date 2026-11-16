const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('visual editor modules and session contract exist', () => {
  const required = ['editor/core.js','editor/sync.js','editor/ui/layers.js','editor/ui/inspector.js','editor/bootstrap.js','editor/editor.css','editor/session.schema.json','editor/server.js','package.json'];
  for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), file + ' exists');
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'editor/session.schema.json'), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, 1);
  for (const key of ['before','after','operations','componentMap']) assert.ok(schema.required.includes(key));
});

test('visual editor is integrated as separate files', () => {
  const html = fs.readFileSync(path.join(root, 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
  assert.ok(html.includes('/editor/editor.css'));
  assert.ok(html.includes('/editor/core.js'));
  assert.ok(html.includes('/editor/sync.js'));
  assert.ok(html.includes('/editor/bootstrap.js'));
});

test('GitHub writer keeps credentials server-side and restricts access', () => {
  const server = fs.readFileSync(path.join(root, 'editor/server.js'), 'utf8');
  assert.ok(server.includes('process.env.GITHUB_TOKEN'));
  assert.ok(server.includes('SAHM_EDITOR_ADMIN_IDS'));
  assert.ok(server.includes('SAHM_EDITOR_ADMIN_EMAILS'));
  assert.ok(server.includes('EDITOR_FORBIDDEN'));
  assert.ok(!server.includes('service_role'));
});
