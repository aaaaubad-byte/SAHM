'use strict';
const COLLECTIONS = Object.freeze({ profiles: true, components: true, assignments: true });
const ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SCREEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STYLE_KEYS = new Set(['display','position','width','height','min-width','max-width','min-height','max-height','top','right','bottom','left','inset','color','background-color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','white-space','word-break','overflow-wrap','align-items','align-content','align-self','justify-content','justify-self','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','grid-template-columns','grid-auto-flow','gap','row-gap','column-gap','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','border','border-width','border-style','border-color','border-radius','box-shadow','opacity','overflow','overflow-x','overflow-y','object-fit','object-position','aspect-ratio']);
const MAX_BODY = 512 * 1024, MAX_DOC = 256 * 1024, MAX_LIST = 100;
function fail(message, status) { const e = new Error(message); e.status = status || 400; return e; }
function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function validId(v, pattern) { return typeof v === 'string' && (pattern || ID).test(v); }
function safeText(v, field, max, required) {
  if (required && (typeof v !== 'string' || !v.trim())) throw fail('INVALID_' + field.toUpperCase());
  if (v != null && (typeof v !== 'string' || v.length > max)) throw fail('INVALID_' + field.toUpperCase());
  return v == null ? '' : v.trim();
}
function safeStyles(styles) {
  if (!isObject(styles)) throw fail('INVALID_STYLES');
  const keys = Object.keys(styles);
  if (!keys.length || keys.length > 48) throw fail('INVALID_STYLES');
  const out = {};
  for (const key of keys) {
    if (!STYLE_KEYS.has(key)) throw fail('UNSUPPORTED_STYLE_PROPERTY');
    const value = styles[key];
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length > 180) throw fail('INVALID_STYLE_VALUE');
    const text = String(value).trim();
    if (!text || /[;{}<>]|url\s*\(|expression\s*\(|javascript:|@import/i.test(text)) throw fail('UNSAFE_STYLE_VALUE');
    out[key] = text;
  }
  return out;
}
function safeTarget(target) {
  if (!isObject(target)) throw fail('INVALID_TARGET');
  const hasId = validId(target.elementId, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/);
  const hasRole = typeof target.semanticRole === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(target.semanticRole);
  if (!hasId && !hasRole) throw fail('TARGET_REQUIRES_STABLE_ID_OR_SEMANTIC_ROLE');
  const out = {};
  if (hasId) out.elementId = target.elementId;
  if (hasRole) out.semanticRole = target.semanticRole;
  if (target.expectedTag != null) {
    if (typeof target.expectedTag !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(target.expectedTag)) throw fail('INVALID_EXPECTED_TAG');
    out.expectedTag = target.expectedTag;
  }
  if (target.expectedRole != null) out.expectedRole = safeText(target.expectedRole, 'expected_role', 64, false);
  if (target.expectedStructureHash != null) {
    if (typeof target.expectedStructureHash !== 'string' || !/^[a-zA-Z0-9_-]{4,96}$/.test(target.expectedStructureHash)) throw fail('INVALID_STRUCTURE_HASH');
    out.expectedStructureHash = target.expectedStructureHash;
  }
  return out;
}
function safeRule(rule, index) {
  if (!isObject(rule)) throw fail('INVALID_RULE');
  const out = { id: validId(rule.id) ? rule.id : 'rule_' + (index + 1), target: safeTarget(rule.target), styles: safeStyles(rule.styles), priority: Number.isInteger(rule.priority) ? Math.max(-1000, Math.min(1000, rule.priority)) : 0, enabled: rule.enabled !== false };
  if (rule.screenId != null) {
    if (!validId(rule.screenId, SCREEN)) throw fail('INVALID_SCREEN_ID');
    out.screenId = rule.screenId;
  }
  if (rule.minWidth != null || rule.maxWidth != null) {
    const min = rule.minWidth == null ? 0 : Number(rule.minWidth), max = rule.maxWidth == null ? 3840 : Number(rule.maxWidth);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 7680 || min > max) throw fail('INVALID_RULE_BREAKPOINT');
    out.minWidth = min; out.maxWidth = max;
  }
  return out;
}
function safeRefs(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw fail('INVALID_' + field.toUpperCase());
  const seen = new Set();
  return value.map((item, index) => {
    if (!isObject(item) || !validId(item.id)) throw fail('INVALID_' + field.toUpperCase());
    if (seen.has(item.id)) throw fail('DUPLICATE_' + field.toUpperCase());
    seen.add(item.id);
    return { id: item.id, priority: Number.isInteger(item.priority) ? Math.max(-1000, Math.min(1000, item.priority)) : index, enabled: item.enabled !== false };
  });
}
function normalizeDocument(collection, id, input, previous, actor) {
  if (!isObject(input) || (input.schemaVersion != null && input.schemaVersion !== 1)) throw fail('INVALID_ADAPTIVE_DOCUMENT');
  const now = new Date().toISOString();
  const base = { schemaVersion: 1, id: id, version: previous ? previous.version + 1 : 1, status: 'active', createdAt: previous ? previous.createdAt : now, updatedAt: now, updatedBy: actor.id };
  if (collection === 'profiles') {
    const rules = input.rules == null ? (previous ? previous.rules : []) : input.rules;
    if (!Array.isArray(rules) || rules.length > 200) throw fail('INVALID_PROFILE_RULES');
    const normalized = rules.map(safeRule), ids = new Set();
    normalized.forEach((r) => { if (ids.has(r.id)) throw fail('DUPLICATE_RULE_ID'); ids.add(r.id); });
    const bp = input.breakpoints == null ? (previous ? previous.breakpoints : {}) : input.breakpoints;
    if (!isObject(bp) || Object.keys(bp).length > 8) throw fail('INVALID_BREAKPOINTS');
    const cleanBp = {};
    Object.keys(bp).forEach((key) => {
      const width = Number(bp[key]);
      if (!/^[a-z][a-z0-9_-]{0,23}$/.test(key) || !Number.isInteger(width) || width < 0 || width > 7680) throw fail('INVALID_BREAKPOINT');
      cleanBp[key] = width;
    });
    return Object.assign(base, { name: safeText(input.name != null ? input.name : previous && previous.name, 'name', 100, true), description: safeText(input.description != null ? input.description : previous && previous.description, 'description', 1000, false), breakpoints: cleanBp, rules: normalized });
  }
  if (collection === 'components') {
    const a = input.appliesTo != null ? input.appliesTo : previous && previous.appliesTo;
    if (!isObject(a)) throw fail('INVALID_COMPONENT_TARGET');
    const target = {};
    if (typeof a.semanticRole === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(a.semanticRole)) target.semanticRole = a.semanticRole;
    if (typeof a.tagName === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(a.tagName)) target.tagName = a.tagName;
    if (!target.semanticRole && !target.tagName) throw fail('COMPONENT_REQUIRES_SEMANTIC_TARGET');
    return Object.assign(base, { name: safeText(input.name != null ? input.name : previous && previous.name, 'name', 100, true), description: safeText(input.description != null ? input.description : previous && previous.description, 'description', 1000, false), appliesTo: target, styles: safeStyles(input.styles != null ? input.styles : previous && previous.styles) });
  }
  if (collection === 'assignments') {
    const profiles = safeRefs(input.profiles != null ? input.profiles : previous && previous.profiles, 'profiles');
    const components = safeRefs(input.components != null ? input.components : previous && previous.components, 'components');
    const raw = input.overrides != null ? input.overrides : previous && previous.overrides;
    if (raw != null && (!Array.isArray(raw) || raw.length > 300)) throw fail('INVALID_OVERRIDES');
    const seen = new Set();
    const overrides = (raw || []).map((item) => {
      if (!isObject(item) || !validId(item.elementId, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/)) throw fail('OVERRIDE_REQUIRES_STABLE_ELEMENT_ID');
      if (seen.has(item.elementId)) throw fail('DUPLICATE_OVERRIDE_ELEMENT');
      seen.add(item.elementId);
      return { elementId: item.elementId, styles: safeStyles(item.styles) };
    });
    const roleRaw = input.roleBindings != null ? input.roleBindings : previous && previous.roleBindings;
    if (roleRaw != null && (!Array.isArray(roleRaw) || roleRaw.length > 500)) throw fail('INVALID_ROLE_BINDINGS');
    const roleSeen = new Set();
    const roleBindings = (roleRaw || []).map((item) => {
      if (!isObject(item) || !validId(item.elementId, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/) ||
          typeof item.semanticRole !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(item.semanticRole)) throw fail('INVALID_ROLE_BINDING');
      if (roleSeen.has(item.elementId)) throw fail('DUPLICATE_ROLE_BINDING');
      roleSeen.add(item.elementId);
      return { elementId: item.elementId, semanticRole: item.semanticRole };
    });
    return Object.assign(base, { screenId: id, profiles: profiles, components: components, overrides: overrides, roleBindings: roleBindings });
  }
  throw fail('UNKNOWN_ADAPTIVE_COLLECTION', 404);
}
function decodeContent(file) {
  if (!file || typeof file.content !== 'string') throw fail('INVALID_GITHUB_CONTENT', 502);
  const raw = file.encoding === 'base64' ? Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8') : file.content;
  if (Buffer.byteLength(raw, 'utf8') > MAX_DOC) throw fail('ADAPTIVE_DOCUMENT_TOO_LARGE', 413);
  try { return JSON.parse(raw); } catch (_) { throw fail('CORRUPT_ADAPTIVE_DOCUMENT', 502); }
}
function createAdaptiveStore(options) {
  const gh = options.gh, auth = options.auth, send = options.send, repo = options.repo, branch = options.branch;
  if (typeof gh !== 'function' || typeof auth !== 'function' || typeof send !== 'function' || !repo || !branch) throw new Error('ADAPTIVE_STORE_CONFIGURATION_INVALID');
  function apiUrl(path) { return 'https://api.github.com/repos/' + repo + path; }
  function contentUrl(path) { return apiUrl('/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch)); }
  function headers() { return { 'Content-Type': 'application/json; charset=utf-8' }; }
  async function readJson(path) {
    try { return decodeContent(await gh(contentUrl(path))); }
    catch (e) { if (e && e.status === 404) return null; throw e; }
  }
  async function listDir(path) {
    try {
      const data = await gh(contentUrl(path));
      return Array.isArray(data) ? data.filter((x) => x && x.type === 'file' && /\.json$/i.test(x.name)).slice(0, MAX_LIST) : [];
    } catch (e) { if (e && e.status === 404) return []; throw e; }
  }
  async function readCollection(collection) {
    const files = await listDir('adaptive-data/' + collection);
    const docs = await Promise.all(files.map((x) => readJson(x.path || ('adaptive-data/' + collection + '/' + x.name))));
    return docs.filter(Boolean).sort((a, b) => String(a.name || a.screenId || a.id).localeCompare(String(b.name || b.screenId || b.id)));
  }
  async function readRecord(collection, id) { return readJson('adaptive-data/' + collection + '/' + id + '.json'); }
  async function commitBatch(changes, message, guard) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh(apiUrl('/git/ref/heads/' + encodeURIComponent(branch))), parentSha = ref && ref.object && ref.object.sha;
      if (!parentSha) throw fail('GITHUB_BRANCH_HEAD_NOT_FOUND', 502);
      const parent = await gh(apiUrl('/git/commits/' + parentSha));
      if (!parent || !parent.tree || !parent.tree.sha) throw fail('GITHUB_BASE_TREE_NOT_FOUND', 502);
      if (guard) await guard();
      const entries = await Promise.all(changes.map(async (change) => {
        const blob = await gh(apiUrl('/git/blobs'), { method: 'POST', headers: headers(), body: JSON.stringify({ content: JSON.stringify(change.value, null, 2) + '\n', encoding: 'utf-8' }) });
        return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
      }));
      const tree = await gh(apiUrl('/git/trees'), { method: 'POST', headers: headers(), body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }) });
      const commit = await gh(apiUrl('/git/commits'), { method: 'POST', headers: headers(), body: JSON.stringify({ message: message, tree: tree.sha, parents: [parentSha] }) });
      try {
        await gh(apiUrl('/git/refs/heads/' + encodeURIComponent(branch)), { method: 'PATCH', headers: headers(), body: JSON.stringify({ sha: commit.sha, force: false }) });
        return commit.sha;
      } catch (e) {
        if (attempt === 2 || !e || (e.status !== 409 && e.status !== 422)) throw e;
      }
    }
    throw fail('GITHUB_WRITE_CONFLICT', 409);
  }
  async function saveRecord(collection, id, input, actor, expectedVersion, restoredFrom) {
    const previous = await readRecord(collection, id);
    if (previous && previous.status === 'archived') throw fail('ADAPTIVE_RECORD_ARCHIVED', 409);
    if (!previous && expectedVersion != null && expectedVersion !== 0) throw fail('ADAPTIVE_RECORD_NOT_FOUND', 404);
    if (previous && (!Number.isInteger(expectedVersion) || expectedVersion !== previous.version)) throw fail('ADAPTIVE_VERSION_CONFLICT', 409);
    const doc = normalizeDocument(collection, id, input, previous, actor);
    if (restoredFrom != null) doc.restoredFromVersion = restoredFrom;
    if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOC) throw fail('ADAPTIVE_DOCUMENT_TOO_LARGE', 413);
    const current = 'adaptive-data/' + collection + '/' + id + '.json';
    const history = 'adaptive-data/history/' + collection + '/' + id + '/v' + doc.version + '.json';
    const expected = previous ? previous.version : null;
    const guard = async () => {
      const latest = await readRecord(collection, id);
      if ((latest ? latest.version : null) !== expected) throw fail('ADAPTIVE_VERSION_CONFLICT', 409);
    };
    await commitBatch([{ path: current, value: doc }, { path: history, value: doc }], 'adaptive(' + collection + '): save ' + id + ' v' + doc.version, guard);
    return doc;
  }
  async function archiveRecord(collection, id, actor, expectedVersion) {
    const previous = await readRecord(collection, id);
    if (!previous) throw fail('ADAPTIVE_RECORD_NOT_FOUND', 404);
    if (previous.status === 'archived') return previous;
    if (!Number.isInteger(expectedVersion) || expectedVersion !== previous.version) throw fail('ADAPTIVE_VERSION_CONFLICT', 409);
    const doc = Object.assign({}, previous, { status: 'archived', version: previous.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor.id });
    const guard = async () => {
      const latest = await readRecord(collection, id);
      if (!latest || latest.version !== previous.version || latest.status === 'archived') throw fail('ADAPTIVE_VERSION_CONFLICT', 409);
    };
    await commitBatch([{ path: 'adaptive-data/' + collection + '/' + id + '.json', value: doc }, { path: 'adaptive-data/history/' + collection + '/' + id + '/v' + doc.version + '.json', value: doc }], 'adaptive(' + collection + '): archive ' + id + ' v' + doc.version, guard);
    return doc;
  }
  async function readVersions(collection, id) {
    const files = await listDir('adaptive-data/history/' + collection + '/' + id);
    return files.map((f) => {
      const match = /^v([1-9][0-9]*)\.json$/.exec(f.name);
      return match ? { version: Number(match[1]), path: f.path, name: f.name } : null;
    }).filter(Boolean).sort((a, b) => b.version - a.version);
  }
  async function handle(req, res, pathname) {
    try {
      const actor = await auth(req), parts = String(pathname || '').split('/').filter(Boolean);
      if (parts[0] !== 'api' || parts[1] !== 'adaptive') return send(res, 404, { error: 'NOT_FOUND' });
      const collection = parts[2];
      if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, collection)) return send(res, 404, { error: 'NOT_FOUND' });
      if (req.method === 'GET' && parts.length === 3) return send(res, 200, { items: await readCollection(collection) });
      if (parts.length === 3 && req.method === 'POST') {
        const input = await readBody(req);
        if (!validId(input.id, collection === 'assignments' ? SCREEN : ID)) throw fail('INVALID_ADAPTIVE_ID');
        if (await readRecord(collection, input.id)) throw fail('ADAPTIVE_RECORD_EXISTS', 409);
        return send(res, 201, { saved: true, item: await saveRecord(collection, input.id, input, actor, null) });
      }
      if (parts.length < 4 || !validId(parts[3], collection === 'assignments' ? SCREEN : ID)) throw fail('INVALID_ADAPTIVE_ID');
      const id = parts[3];
      if (parts.length === 4 && req.method === 'GET') {
        const item = await readRecord(collection, id);
        if (!item) throw fail('ADAPTIVE_RECORD_NOT_FOUND', 404);
        return send(res, 200, { item: item });
      }
      if (parts.length === 4 && req.method === 'PUT') {
        const input = await readBody(req);
        return send(res, 200, { saved: true, item: await saveRecord(collection, id, input, actor, input.expectedVersion) });
      }
      if (parts.length === 4 && req.method === 'DELETE') {
        const input = await readBody(req);
        return send(res, 200, { archived: true, item: await archiveRecord(collection, id, actor, input.expectedVersion) });
      }
      if (parts[4] === 'versions' && parts.length === 5 && req.method === 'GET') return send(res, 200, { versions: await readVersions(collection, id) });
      if (parts[4] === 'versions' && parts.length === 6 && req.method === 'GET') {
        const version = Number(parts[5]);
        if (!Number.isInteger(version) || version < 1) throw fail('INVALID_VERSION');
        const item = await readJson('adaptive-data/history/' + collection + '/' + id + '/v' + version + '.json');
        if (!item) throw fail('ADAPTIVE_VERSION_NOT_FOUND', 404);
        return send(res, 200, { item: item });
      }
      if (parts[4] === 'restore' && parts.length === 5 && req.method === 'POST') {
        const input = await readBody(req), version = Number(input.version);
        if (!Number.isInteger(version) || version < 1) throw fail('INVALID_VERSION');
        const old = await readJson('adaptive-data/history/' + collection + '/' + id + '/v' + version + '.json');
        if (!old) throw fail('ADAPTIVE_VERSION_NOT_FOUND', 404);
        return send(res, 200, { restored: true, item: await saveRecord(collection, id, old, actor, input.expectedVersion, version) });
      }
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (e) {
      return send(res, Number(e && e.status) || 500, { error: e && e.message ? e.message : 'INTERNAL_ERROR' });
    }
  }
  return handle;
}
async function readBody(req) {
  if (req && Object.prototype.hasOwnProperty.call(req, 'body')) {
    if (!isObject(req.body)) throw fail('INVALID_JSON');
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(fail('BODY_TOO_LARGE', 413)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!isObject(value)) throw fail('INVALID_JSON'); resolve(value); }
      catch (e) { reject(e.status ? e : fail('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}
module.exports = { createAdaptiveStore: createAdaptiveStore, validate: normalizeDocument, safeStyles: safeStyles, safeTarget: safeTarget };
