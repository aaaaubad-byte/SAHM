const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('visual editor modules and session contract exist', () => {
  const required = ['editor/core.js','editor/sync.js','editor/ui/layers.js','editor/ui/inspector.js','editor/bootstrap.js','editor/editor.css','editor/session.schema.json','editor/server.js','editor/adaptive/store.js','editor/adaptive/schema.json','editor/adaptive/engine.js','editor/adaptive/ui.js','editor/adaptive/adaptive.css','package.json'];
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

test('adaptive screen builder is independently integrated', () => {
  const html = fs.readFileSync(path.join(root, 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'editor/builder.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'editor/editor.css'), 'utf8');
  assert.ok(html.includes('/editor/builder.js'));
  assert.ok(builder.includes('SahmScreenBuilder'));
  assert.ok(builder.includes('STORAGE_KEY'));
  assert.ok(builder.includes('320'));
  assert.ok(builder.includes('768'));
  assert.ok(builder.includes('function makeNode(type)'));
  assert.ok(!builder.includes('getComputedStyle('), 'new screens must not inherit computed app styles');
  assert.ok(css.includes('.seb-overlay'));
  assert.ok(css.includes('grid-template-columns:repeat(auto-fit'));
  assert.ok(css.includes('overflow-wrap:anywhere'));
});

test('adaptive runtime and UI are separately integrated with the editor', () => {
  const html = fs.readFileSync(path.join(root, 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(root, 'editor/bootstrap.js'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'editor/adaptive/engine.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'editor/adaptive/ui.js'), 'utf8');
  assert.ok(html.includes('/editor/adaptive/engine.js'));
  assert.ok(html.includes('/editor/adaptive/ui.js'));
  assert.ok(html.includes('/editor/adaptive/adaptive.css'));
  assert.ok(worker.includes('/editor/adaptive/engine.js'));
  assert.ok(bootstrap.includes("name === 'adaptive'"));
  assert.ok(engine.includes('expectedStructureHash'));
  assert.ok(engine.includes('roleBindings'));
  assert.ok(engine.includes('ResizeObserver'));
  assert.ok(ui.includes('data-form="rule"'));
  assert.ok(ui.includes('data-restore'));
});

test('adaptive runtime monitors screen transitions and supports responsive rule-width testing', () => {
  const engine = fs.readFileSync(path.join(root, 'editor/adaptive/engine.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'editor/adaptive/ui.js'), 'utf8');
  assert.ok(engine.includes('MutationObserver'));
  assert.ok(engine.includes('setPreviewWidth'));
  assert.ok(ui.includes('data-preview-width'));
  assert.ok(ui.includes('screenChanged'));
  assert.ok(ui.includes('minWidth'));
  assert.ok(ui.includes('maxWidth'));
});

test('adaptive UI displays shared profile impact and separates screen-only overrides', () => {
  const ui = fs.readFileSync(path.join(root, 'editor/adaptive/ui.js'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'editor/adaptive/store.js'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'editor/adaptive/engine.js'), 'utf8');
  assert.ok(ui.includes('s.assignments'));
  assert.ok(ui.includes('نطاق تأثير الملف المشترك'));
  assert.ok(ui.includes('value="screen"'));
  assert.ok(ui.includes('saveRefs(null,null,null,overrides)'));
  assert.ok(store.includes('expectedStructureHash'));
  assert.ok(engine.includes('OVERRIDE_STRUCTURE_MISMATCH'));
});
