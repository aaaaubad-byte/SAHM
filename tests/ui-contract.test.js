'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sahm-app.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'sahm-data.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'sahm-core.js'), 'utf8');
const managed = fs.readFileSync(path.join(ROOT, 'sahm-managed-group.js'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const auth = fs.readFileSync(path.join(ROOT, 'sahm-supabase.js'), 'utf8');
const remote = fs.readFileSync(path.join(ROOT, 'sahm-supabase-data.js'), 'utf8');

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
  const screenEntries = [...registryMatch[1].matchAll(/(?:^|,)\s*'?([A-Za-z_$][\w$-]*)'?\s*:\s*([^,\n]+)/gm)];
  assert.ok(screenEntries.length >= 20, 'all application screens are registered');
  const renderers = new Set([...html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[1]));
  for (const [, route, expression] of screenEntries) {
    const renderer = expression.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(renderer)) assert.ok(renderers.has(renderer), route + ' has renderer ' + renderer);
  }
  const routes = new Set(screenEntries.map(x => x[1]));
  const directTargets = [...(html + managed).matchAll(/data-go="([^"]+)"/g)]
    .map(x => x[1]).filter(x => !x.includes('$'));
  for (const route of directTargets) assert.ok(routes.has(route), 'data-go route is registered: ' + route);
});
test('saved-account reauthentication screen is reachable without logging out the current account', () => {
  assert.match(html, /'account-login':accountLogin/);
  assert.match(html, /const AUTH_SCREEN_NAMES=\[[^;]*'account-login'/);
  assert.match(html, /if\(action==='add-account'\)\{pendingAccountLogin=null;go\('account-login'/);
  assert.match(html, /id="accountLoginForm"/);
  assert.match(html, /if\(form\.id==='accountLoginForm'\)/);
  assert.match(html, /جلسة الحساب المحفوظ انتهت؛ أعد تسجيل الدخول إليه مرة واحدة لإعادة ربطه/);
  assert.match(html, /if\(action==='cancel-account-login'\)/);
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

  // Remote operations are attached at runtime by SahmSupabaseData.install().
  // Include those bindings when checking calls made by the screen layer.
  const installer = remote.match(/function install\(\)\{([\s\S]*?)\n\s*return true;/);
  assert.ok(installer, 'Supabase gateway installer exists');
  assert.match(html, /SahmSupabaseData\.install\(\)/, 'the screen bootstrap installs the remote gateway');
  const remoteBindings = new Map([...installer[1].matchAll(/\bapp\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)]
    .map(match => [match[1], match[2]]));
  const remoteFunctions = new Set([...remote.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(match => match[1]));

  const dataObject = data.slice(data.indexOf('root.SahmData = {'));
  const dataExports = new Set(objectKeys(dataObject, 'root.SahmData = {'));
  for (const name of used) {
    const remoteMethod = remoteBindings.get(name);
    assert.ok(appApi.has(name) || remoteBindings.has(name), 'SahmApp.' + name + ' is exported');
    assert.ok(dataExports.has(name) || (remoteMethod && remoteFunctions.has(remoteMethod)) ||
      ['init','store','viewer','onResult','nowAt','todayIn','chatTime','timeZone','notifyTypes','maxMessage','myGroups','roleOf','chatList','recentActivity','unreadNotifications','tick','storageState','takeNotices','prefs','savePrefs'].includes(name),
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



test('the stylesheet is balanced and mobile-only layout rules do not capture global refinements', () => {
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
  assert.ok(styleMatch, 'application stylesheet exists');
  const css = styleMatch[1];
  const marker = '/* Sahm design refinement: line icons without decorative containers. */';
  const markerIndex = css.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'global design refinements marker exists');

  let depth = 0;
  let quote = null;
  let inComment = false;
  let escaped = false;
  let depthAtGlobalStyles = null;

  for (let i = 0; i < css.length; i++) {
    if (i === markerIndex) depthAtGlobalStyles = depth;
    const ch = css[i];
    const next = css[i + 1];

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      assert.ok(depth >= 0, 'CSS closing brace has a matching opener');
    }
  }

  assert.equal(depth, 0, 'all CSS blocks are closed');
  assert.equal(depthAtGlobalStyles, 0, 'global refinements are outside the mobile media query');
});

test('all page scripts and Supabase modules are syntactically valid JavaScript', () => {
  new vm.Script(auth, { filename: 'sahm-supabase.js' });
  new vm.Script(remote, { filename: 'sahm-supabase-data.js' });
  new vm.Script(app, { filename: 'sahm-app.js' });
  new vm.Script(data, { filename: 'sahm-data.js' });
  new vm.Script(core, { filename: 'sahm-core.js' });
  let count=0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs=match[1]||'';
    const source=(match[2]||'').trim();
    if(!source || /type\s*=\s*["']application\/ld\+json["']/i.test(attrs))continue;
    new vm.Script(source,{filename:'inline-script-'+(++count)+'.js'});
  }
  assert.ok(count>=2,'inline application and PWA scripts are parsed');
});

test('email auth and staged profile onboarding replace the demo OTP flow', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'sahm-supabase.js'), 'utf8');
  const gateway = fs.readFileSync(path.join(ROOT, 'sahm-supabase-data.js'), 'utf8');
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="registerForm"/);
  assert.match(html, /id="setupForm"/);
  assert.match(html, /id="updatePasswordForm"/);
  assert.match(html, /name="terms" required/);
  assert.match(html, /href="\/terms\.html"/);
  assert.match(html, /name="fullName"/);
  assert.match(html, /name="phone"/);
  assert.ok(html.includes("['YE','اليمن','+967']"));
  assert.match(html, /AVATAR_OPTIONS/);
  assert.doesNotMatch(html, /246810|رمز المعاينة التجريبي/);
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /auth\.signUp/);
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /updateUser/);
  assert.match(gateway, /create_association/);
  assert.match(gateway, /accept_invitation/);
  assert.match(gateway, /postgres_changes/);
  assert.doesNotMatch(auth, /var URL\s*=/);
});

test('Supabase session handoff never revokes the session after transferring it', () => {
  assert.match(auth, /var BOOTSTRAP_STORAGE_KEY = 'sb-'/);
  assert.match(auth, /autoRefreshToken: key !== 'default'/);
  assert.match(auth, /function clearBootstrapSession\(client\)[\s\S]*?removeItem\(BOOTSTRAP_STORAGE_KEY\)/);
  const signup = auth.slice(auth.indexOf('async function signUp'), auth.indexOf('function rememberAccount'));
  const signin = auth.slice(auth.indexOf('async function signIn'), auth.indexOf('async function switchAccount'));
  const legacySession = auth.slice(auth.indexOf('async function session'), auth.indexOf('async function user'));
  for (const flow of [signup, signin, legacySession]) {
    assert.doesNotMatch(flow, /\.auth\.signOut\(/, 'transferred session must not be revoked remotely');
    assert.match(flow, /clearBootstrapSession\(/, 'bootstrap copy is cleared locally');
  }
  assert.match(auth, /async function signOut\(\)[\s\S]*?c\.auth\.signOut\(\{ scope: 'local' \}\)/,
    'the explicit user-requested sign-out still calls Supabase Auth');
  assert.match(auth, /هذا البريد الإلكتروني مرتبط بحساب موجود بالفعل/);
});

test('navigation runtime is loaded in order and precached by the service worker', () => {
  const appScript = html.indexOf('<script src="/sahm-app.js"></script>');
  const navigationScript = html.indexOf('<script src="/sahm-navigation.js"></script>');
  const nextInlineScript = html.indexOf('<script>', navigationScript + '<script src="/sahm-navigation.js"></script>'.length);
  assert.ok(appScript >= 0 && appScript < navigationScript && navigationScript < nextInlineScript);
  assert.match(sw, /const BUILD_ID = '[^']+';/);
  assert.match(sw, /const CACHE_NAME = .sahm-pwa-\$\{BUILD_ID\}./);
  assert.match(sw, /APP_SHELL[\s\S]*?'\/sahm-navigation\.js'/);
  assert.match(sw, /APP_SHELL[\s\S]*?'\/sahm-supabase-data\.js'/);
  assert.ok(sw.includes("'/sahm-app.js'"));
});
test('every rendered button, route, form, and modal action is connected to a handler', () => {
  const templates = html + managed;
  const registry = html.match(/const ALL_SCREEN_REGISTRY\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(registry, 'central route registry exists');
  const routes = new Set([...registry[1].matchAll(/['"]?([A-Za-z_$][\w$-]*)['"]?\s*:/g)].map(x => x[1]));

  const staticRoutes = new Set([...templates.matchAll(/data-go=["']([^"']+)["']/g)]
    .map(x => x[1]).filter(x => !x.includes('$')));
  for (const route of staticRoutes) assert.ok(routes.has(route), 'button route resolves: ' + route);

  const buttons = [...templates.matchAll(/<button\b([^>]*)>/gi)].map(x => x[1]);
  assert.ok(buttons.length >= 90, 'screen templates retain a substantial set of actionable controls after duplicate removal');
  for (const attrs of buttons) {
    assert.match(attrs, /data-action|data-go|type=["']submit["']/, 'button has a delegated action, route, or form-submit role: ' + attrs);
  }

  const actions = new Set([...templates.matchAll(/data-action=["']([^"']+)["']/g)]
    .map(x => x[1]).filter(x => !x.includes('$')));
  const actionCases = new Set([...templates.matchAll(/action\s*===\s*["']([^"']+)["']/g)].map(x => x[1]));
  const groupedActions = new Set([...templates.matchAll(/\[([^\]]+)\]\.includes\(action\)/g)]
    .flatMap(x => [...x[1].matchAll(/["']([^"']+)["']/g)].map(y => y[1])));
  const changeActions = new Set(['mute-toggle', 'notify-channel-toggle']);
  for (const action of actions) {
    assert.ok(actionCases.has(action) || groupedActions.has(action) || changeActions.has(action),
      'data-action is handled by click or change logic: ' + action);
  }

  assert.match(html, /document\.addEventListener\('click',[\s\S]*?handleAppAction\(action,el\)/);
  assert.match(html, /dialog\.addEventListener\('click',[\s\S]*?handleAppAction\(actionButton\.dataset\.action,actionButton\)/);
  assert.match(html, /buttons\.map\(\(\[label,act/);

  const formIds = new Set([...templates.matchAll(/<form\b[^>]*\bid=["']([^"']+)["']/gi)].map(x => x[1]));
  const handledForms = new Set([...templates.matchAll(/form\.id\s*(?:===|!==)\s*["']([^"']+)["']/g)].map(x => x[1]));
  for (const id of formIds) assert.ok(handledForms.has(id), 'form submit is handled: ' + id);

  const anchors = [...templates.matchAll(/<a\b([^>]*)>/gi)].map(x => x[1]);
  for (const attrs of anchors) assert.match(attrs, /\bhref\s*=/i, 'anchor has a destination');
});
test('copy and share buttons have clipboard fallbacks for browsers without Clipboard API', () => {
  assert.match(html, /async function copyText\(/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /await copyText\(value,'تم نسخ رابط الانضمام'\)/);
  assert.match(html, /await copyText\(value,'المشاركة غير مدعومة؛ تم نسخ الرابط'\)/);
});

test('account switch failures attempt to restore the previously active account', () => {
  assert.match(html, /previousUserSnapshot=Object\.assign\(\{\},db\.user\|\|\{\}\)/);
  assert.match(html, /await SahmSupabase\.switchAccount\(previousUserId\)/);
  assert.match(html, /await SahmSupabaseData\.init\(activeProfile\)/);
  assert.match(html, /startRemoteRealtime\(\)/);
});



test('role separation, draw room, publication channels and personal notification reads match Supabase contracts', () => {
  const workspace = html + managed;
  assert.doesNotMatch(html, /quorumInfo|quorum|attendance-toggle|setAttendance|>حاضر<|>غير حاضر<|تسجيل الحضور|إلغاء الحضور/);
  assert.doesNotMatch(html, /name=["']tz["']|المنطقة الزمنية للجمعية/);
  assert.match(html, /agreementLocked/);
  assert.ok(html.includes("const managerOnly=['members','member-reception','invite','invites','join-requests','join-request-detail','audit']"));
  assert.match(html, /s==='draw-room'[\s\S]*?targetDetail\.role\.manager\|\|targetDetail\.role\.participant/);
  for (const api of ['getDrawRoom','getDrawHistory','getDrawReadiness','setDrawScheduledAt','setDrawPresentationStatus','performDraw','getNews','getAuditLog']) {
    assert.ok(workspace.includes('SahmApp.'+api+'('), api+' is used by the shared workspace');
  }
  assert.match(html, /adenDateTimeToUtc/);
  assert.match(core, /Asia\/Aden/);
  assert.match(managed, /requestAnimationFrame\(/);
  assert.match(managed, /subject_visible\s*===\s*true\s*&&\s*x\.subject_name/);
  assert.doesNotMatch(workspace, /SahmApp\.eventLog\(g\.id/);
  assert.match(remote, /channel\('sahm-user-'\+user\.id\)/);
  assert.match(remote, /table:'chat_messages'/);
  assert.match(remote, /table:'notifications'/);
  assert.match(remote, /table:'join_requests'/);
  assert.match(remote, /table:'invitations'/);
  assert.match(html, /SahmApp\.setNotifySettings\(/);
  assert.match(html, /SahmApp\.markNotificationsRead\(\[id\]\)/);
  assert.doesNotMatch(html, /SahmApp\.markNotificationsRead\(\)/);
  assert.match(managed, /function newsPanel\(/);
  assert.match(html, /news:\(\)=>openAssociationWorkspace\('news'\)/);
});
test('confirmed unused stylesheet components and Supabase data helpers stay removed', () => {
  const styleMatch = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  assert.ok(styleMatch, 'application stylesheet exists');
  const unusedClasses = ["dot","formgrid","wheel-wrap","member-tabs","payment-progress","draw-percent","vote-panel","vote-number","compact-empty","topbar-icons","create-card-arrow","home-create-card","create-card-icon","home-actions","home-action-btn","home-action-icon","create-intro","create-intro-icon","create-intro-copy","create-kicker","create-fields-grid","create-submit-area","create-optional","create-summary-grid","create-summary-total","create-summary-foot","create-label-icon","created-link-row","created-link-actions","manual-contact-form","invite-candidate-row","invite-candidate-identity","invite-candidate-avatar","invite-share-field","invite-remove","created-invite-footer","create-unified-section","create-field-wide","create-subsection-title"];
  for (const className of unusedClasses) {
    const selector = new RegExp('\\.' + className + '(?![\\w-])');
    assert.doesNotMatch(styleMatch[1], selector, 'unused CSS selector removed: ' + className);
  }
  for (const variable of ["--gold","--card","--red","--blue","--radius"]) {
    assert.doesNotMatch(styleMatch[1], new RegExp(variable + '\\s*:'), 'unused CSS token removed: ' + variable);
  }
  assert.doesNotMatch(remote, /\bprofileCompletionRows\b/);
  assert.doesNotMatch(remote, /\bafterMutation\b/);
});


test('all navigation and topbar auth visibility use the canonical auth screen registry', () => {
  const authMatch = html.match(/const AUTH_SCREEN_NAMES=\[([^\]]+)\]/);
  assert.ok(authMatch, 'canonical auth screen registry exists');
  const authScreens = [...authMatch[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
  for (const screen of ['welcome', 'register', 'account-login', 'profile-setup', 'reset-password', 'logged-out']) {
    assert.ok(authScreens.includes(screen), 'auth screen is registered: ' + screen);
  }
  assert.match(html, /const authScreens=AUTH_SCREEN_NAMES;/);
  assert.match(html, /function syncBottomNavigation\(visible=!AUTH_SCREEN_NAMES\.includes\(screenName\)\)/);
  assert.match(html, /syncBottomNavigation\(!AUTH_SCREEN_NAMES\.includes\(screenName\)\)/);
  assert.doesNotMatch(html, /\['welcome','phone','otp','profile-setup','logged-out'\]/);
});


test('priority UX fixes keep managed/member routes separate and wire visible search fields', () => {
  const groupStart = html.indexOf('function groups(){');
  const groupEnd = html.indexOf('function setCreateWizardStep', groupStart);
  const groupsScreen = html.slice(groupStart, groupEnd);
  assert.match(html, /'managed-groups':managedGroups/);
  assert.match(html, /'joined-groups':joinedGroups/);
  assert.match(html, /function managedGroups\(\)\{groupTab='manager'/);
  assert.match(html, /function joinedGroups\(\)\{groupTab='member'/);
  assert.match(html, /go\('managed-groups'/);
  assert.match(html, /go\('joined-groups'/);
  assert.match(groupsScreen, /search\.addEventListener\('input'/);
  assert.equal((groupsScreen.match(/data-go="create-group"/g) || []).length, 0,
    'creation shortcut lives on the home screen, not duplicated in the groups list');
  const homeStart=html.indexOf('function home(){'),homeEnd=html.indexOf('function groups(){',homeStart);
  assert.equal((html.slice(homeStart,homeEnd).match(/data-go="create-group"/g)||[]).length,1,'one home creation shortcut');
  assert.match(managed,/mgdMemberSearch/);
  assert.match(managed,/bindMemberSearch\(\)/);
  assert.match(managed,/mgdMemberStatus/);
  assert.match(managed,/memberStatus==='won'/);
  const navStart = html.indexOf('function nav(active){');
  const navEnd = html.indexOf('function shell(', navStart);
  const navCode = html.slice(navStart, navEnd);
  assert.match(navCode, /const groupScreens=/);
  assert.match(navCode, /const wallScreens=/);
  assert.match(navCode, /resolvedActive===s/);
  const statusStart = html.indexOf('async function loadAssociationPublicLinkStatus');
  const statusEnd = html.indexOf('function memberReception()', statusStart);
  const linkStatus = html.slice(statusStart, statusEnd);
  assert.match(linkStatus, /if\(status==='active'\)/);
  assert.match(linkStatus, /data-action="pause-group-link"/);
  assert.match(linkStatus, /data-action="revoke-group-link"/);
  assert.match(linkStatus, /canInvite\?'<button class="btn soft small" data-action="rotate-group-link"/);
  assert.match(linkStatus, /استقبال الأعضاء مغلق/);
  assert.doesNotMatch(html, /data-action="rotate-group-link">إدارة رابط الانضمام/);
  const profileStart = html.indexOf('function profile(){');
  const profileEnd = html.indexOf('function editProfile(){', profileStart);
  const profileScreen = html.slice(profileStart, profileEnd);
  assert.match(profileScreen, /const managedGroup=db\.groups\.find\(g=>g\.role==='manager'\)/);
  assert.match(profileScreen, /const auditLink=managedGroup\?/);
  assert.doesNotMatch(profileScreen, />سجل العمليات</);
  assert.match(html, /if\(route==='audit'&&el\.dataset\.groupId\)context\.currentGroupId=el\.dataset\.groupId/);
  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)[1];
  assert.match(style, /#bottomnav \.navitem\.active,\s*#bottomnav \.navitem\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--primary\);[^}]*background:\s*transparent/);
  assert.doesNotMatch(style, /#bottomnav \.navitem[^{}]*\{[^}]*background:\s*#edf2ff/);
  assert.match(html, /'aria-current="page"'/);
});
test('public-link lifecycle is managed in one place rather than duplicated across success and settings screens', () => {
  const detailStart = html.indexOf('function groupDetail(){');
  const detailEnd = html.indexOf('async function loadAssociationPublicLinkStatus', detailStart);
  const detail = html.slice(detailStart, detailEnd);
  assert.match(managed, /data-go="member-reception"/);
  assert.doesNotMatch(detail, /association-link-status/);

  const createdStart = html.indexOf('function showCreatedGroup(g){');
  const createdEnd = html.indexOf('function groupDetail(){', createdStart);
  const created = html.slice(createdStart, createdEnd);
  assert.match(created, /data-action="copy-group-link"/);
  assert.match(created, /data-action="share-group-link"/);
  assert.doesNotMatch(created, /data-action="pause-group-link"|data-action="rotate-group-link"|data-action="revoke-group-link"|data-action="create-group-link"/);

  const receptionStart = html.indexOf('function memberReception(){');
  const receptionEnd = html.indexOf('function joinGroup(){', receptionStart);
  const reception = html.slice(receptionStart, receptionEnd);
  assert.match(reception, /id="association-link-status"/);
  assert.match(reception, /loadAssociationPublicLinkStatus\(g\.id,canInvite\)/);
  assert.match(html, /if\(currentGroupId!==associationId\|\|screenName!=='member-reception'\)return/);
});


test('create-association flow is one compact screen with a single submit action', () => {
  const start = html.indexOf('function createGroup(){');
  const end = html.indexOf('function groupDetail(){', start);
  const flow = html.slice(start, end);
  assert.match(html, /const CREATE_STEP_COUNT=1;/);
  assert.match(flow, /<form id="createForm"/);
  for (const field of ['name','currency','startDate','firstDrawOn','shareAmount','installmentMode','installments','installmentAmount','managerMode','managerShares']) {
    assert.ok(flow.includes('name="' + field + '"'), 'form field: ' + field);
  }
  assert.match(flow, /id="create-final-submit"/);
  assert.doesNotMatch(flow, /create-step-[23]|create-next|create-prev/);
  assert.match(flow, /id="cg-installment-preview"/);
  assert.match(flow, /مدة فترة التحصيل/);
  assert.match(html, /if\(form\.id==='createForm'\)[\s\S]*?validateCreateStep\(1\)[\s\S]*?validateCreateStep\(2\)/);
  assert.match(html, /SahmCore\.periods\(duration,count\)/);
});
test('line-icon system decorates inner screens only and never draws icon bubbles', () => {
  const start = html.indexOf('function decorateIcons(){');
  const end = html.indexOf('(function(){', start);
  const decorator = html.slice(start, end);
  assert.match(decorator, /classList\.contains\('home-screen'\)\|\|screen\.classList\.contains\('auth-screen'\)\)return/, 'home and auth screens are skipped');
  assert.doesNotMatch(decorator, /topbar|bottomnav|navitem/, 'top and bottom bars are never touched');
  for (const target of ['.avatar', '.btn', '.keyvalue>span:first-child', '.empty', 'h3']) assert.ok(decorator.includes(target), 'decorates ' + target);

  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)[1];
  const block = style.slice(style.indexOf('Line-icon system'));
  const rules = block.match(/[^{}]+\{[^}]*\}/g) || [];
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf('{'));
    if (selector.includes('#modal-root')) continue;
    assert.ok(selector.includes(':not(.home-screen)'), 'scoped away from the home screen: ' + selector.trim().slice(0, 60));
  }
  assert.match(block, /\.avatar\{[^}]*background:transparent!important/);
  assert.doesNotMatch(style, /\.cg-success-icon\{[^}]*background:/, 'success mark is a bare glyph');
  assert.doesNotMatch(html, /class="cg-sub"/, 'no explanatory sub-lines on the create flow');
});


test('inner screens and dialogs share one standard type scale; home, top bar and bottom bar keep theirs', () => {
  const marker = 'Standard type scale for inner screens and dialogs';
  const layer = html.slice(html.indexOf(marker), html.indexOf('Icon and brand glyph sizing'));
  assert.ok(layer.length > 100, 'standard scale layer exists');
  const tokens = { 'page-title': 20, 'section-title': 16, 'card-title': 15, body: 14, secondary: 12, helper: 11 };
  for (const [name, px] of Object.entries(tokens)) {
    assert.match(layer, new RegExp('--sahm-font-' + name + ':\\s*' + px + 'px'), name + ' = ' + px + 'px');
  }
  assert.match(layer, /#screen:not\(\.home-screen\),#modal-root\{/, 'tokens are scoped away from home, top bar and bottom bar');
  const weights = [...layer.matchAll(/--sahm-weight-\w+:\s*(\d+)/g)].map(m => Number(m[1]));
  assert.deepEqual(weights, [400, 500, 600, 700], 'only the four loaded font weights are used');
  assert.doesNotMatch(layer, /font-size:\s*\d/, 'sizes come from tokens, never literals');
  assert.match(html, /family=IBM\+Plex\+Sans\+Arabic:wght@400;500;600;700/, 'every weight in the scale is loaded');
});

test('managed association tabs follow the approved five-section order', () => {
  const block = managed.match(/const managers=\[([\s\S]*?)\];/);
  assert.ok(block);
  const ids = [...block[1].matchAll(/\['(installments|shares|draws|members|settings)'/g)].map(x=>x[1]);
  assert.deepEqual(ids,['installments','shares','draws','members','settings']);
  assert.match(managed,/async function shareCards/);
  assert.match(managed,/SahmApp\.shareList\(g\.id/);
  assert.match(managed,/x\.status === 'upcoming'/);
});


test('manager collection screen implements current installment filters, selective reminders and live data actions', () => {
  const panelStart = managed.indexOf('function installmentsPanel(g,d)');
  const panelEnd = managed.indexOf('async function cycleDetail(g, d, round)', panelStart);
  assert.ok(panelStart >= 0 && panelEnd > panelStart, 'one installment panel exists');
  const panel = managed.slice(panelStart, panelEnd);
  assert.ok(managed.includes("active === 'installments' && manager"), 'manager collection has a dedicated branch');
  assert.ok(managed.includes("shell('التحصيل'"), 'manager collection title is present');
  assert.ok(panel.includes('value="current"'), 'current installment is the default');
  assert.ok(panel.includes('value="all"'), 'all installments option exists');
  for (const id of ['mgdInstallmentSearch','mgdInstallmentNumber','mgdInstallmentStatus','mgdInstallmentFilterToggle','mgdInstallmentSelectToggle','mgdInstallmentBulkReminder']) {
    assert.ok(panel.includes('id="'+id+'"'), 'collection control '+id);
  }
  assert.ok(managed.includes('function currentInstallmentNo(rows, g)'), 'current installment is recalculated from the selected cycle');
  assert.ok(managed.includes("state.installment === 'current'"));
  assert.ok(managed.includes("const selectable = state.installmentSelectMode && (x.status === 'due' || x.status === 'late')"));
  assert.ok(managed.includes("const collect = x.status === 'due' || x.status === 'late' || x.status === 'upcoming'"));
  assert.ok(managed.includes("remind = x.status === 'due' || x.status === 'late'"));
  assert.ok(managed.includes('mgd-installment-status-icon'));
  assert.ok(managed.includes("uiIcon(meta[0],22)"), 'installment status icon matches 22px home activity icon');
  for (const metric of ["uiIcon('layers',14)","uiIcon('wallet',14)","uiIcon('calendar-days',14)"]) assert.ok(managed.includes(metric), 'installment metric icon '+metric);
  for (const label of ['الأسهم','المبلغ','رقم القسط']) assert.ok(managed.includes('<span>'+label+'</span>'), 'installment metric label '+label);
  assert.ok(managed.includes('mgd-installment-stat-label') && managed.includes('mgd-installment-stat'), 'each metric has a label row and a value below');
  assert.ok(managed.includes('data-action="managed-inline-filter-toggle"'), 'member and draw filter toggles expose delegated action semantics');

  assert.ok(managed.includes("title=\"'+esc(meta[1])+'\" aria-label=\"'+esc(meta[1])+'\">"), 'status wording remains accessible');
  assert.ok(managed.includes('SahmApp.installmentRows(g.id'));
  assert.ok(managed.includes('SahmApp.sendReminder('));
  assert.ok(managed.includes('skipRefresh:true'));
  assert.ok(managed.includes('id="mgdMemberFilterToggle"') && managed.includes('id="mgdDrawFilterToggle"'), 'member and draw lists use inline filter toggles');
  assert.ok(managed.includes("bindInlineFilterToggle('mgdMemberToolbar','mgdMemberFilterToggle','memberFiltersOpen')"));
  assert.ok(managed.includes("bindInlineFilterToggle('mgdDrawToolbar','mgdDrawFilterToggle','drawFiltersOpen')"));
  assert.ok(managed.includes('class="mgd-filter-fields"'), 'secondary filter controls are collapsed inside the toolbar');
  assert.ok(app.includes('api.refreshStore = function'));
  assert.ok(remote.includes("invoke('record_installment_receipt'"));
  assert.ok(remote.includes("invoke('send_installment_reminders'"));
  assert.ok(remote.includes('if(!(p&&p.skipRefresh)) await refresh();'));
  assert.ok(remote.includes('app.recordPaid=recordPaid'));
  assert.ok(remote.includes('app.sendReminder=sendReminder'));
  assert.ok(html.includes('const id=r.receipt&&r.receipt.id||r.receiptId'));
  assert.ok(!html.includes('send-reminder-all')&&!html.includes('reminderInstallment'), 'retired global reminder handler is removed');
  assert.ok(!managed.includes('selectedInstallmentCycle')&&!managed.includes('send-reminder-all'), 'retired selection and reminder hooks are removed');
  const css = fs.readFileSync(path.join(ROOT, 'sahm-managed-group.css'), 'utf8');
  assert.ok(css.includes('#screen .mgd-collection-page .mgd-installment-toolbar'));
  assert.ok(!css.includes('#screen .mgd-installment-toolbar'), 'collection CSS is scoped to its screen');
});

test('draw and member tabs expose round progress and member win/eligibility filters', () => {
  assert.match(managed,/data-action="managed-open-cycle"/);
  assert.match(managed,/data-status=/);
  assert.match(managed,/mgdDrawSearch/);
  assert.match(managed,/mgdMemberStatus/);
  assert.match(managed,/memberStatus==='won'/);
  assert.match(managed,/backToTab\('draws'\)/);
});

test('draw room sub-tabs are role-aware and participants never call manager-only readiness RPCs', () => {
  const start = managed.indexOf('async function drawPanel(g, d)');
  const end = managed.indexOf('async function newsPanel(g, d)', start);
  assert.ok(start >= 0 && end > start, 'draw room renderer exists');
  const draw = managed.slice(start, end);
  assert.match(draw, /const manager = !!\(d\.role && d\.role\.manager\)/);
  assert.match(draw, /manager && \(view === 'summary' \|\| view === 'result'\)[\s\S]*?SahmApp\.getDrawReadiness/);
  assert.match(draw, /manager && view === 'summary'[\s\S]*?SahmApp\.getFinancialSummary/);
  assert.match(draw, /const drawTabs = manager\s*\? \[\['summary','الملخص'\],\['eligible','الأسهم المؤهلة'\],\['schedule','الموعد'\],\['result','النتيجة'\],\['history','السجل'\]\]\s*:\s*\[\['summary','الملخص'\],\['eligible','الأسهم المؤهلة'\],\['result','النتيجة'\],\['history','السجل'\]\]/);
  assert.match(draw, /role="tablist"/);
  assert.match(draw, /role="tab"/);
  assert.match(draw, /aria-selected=/);
  assert.match(draw, /role="tabpanel"/);
  assert.match(draw, /manager \? \(draw \?/);
  assert.match(managed, /event\.stopImmediatePropagation\(\)/, 'workspace tab actions are not dispatched twice');
  assert.match(managed, /if \(!allowedViews\.includes\(requested\)\)/, 'invalid or manager-only sub-tabs are rejected');
});

test('participant draw entry does not repeat the full draw history already available inside the room', () => {
  const start = managed.indexOf('async function memberDraws(g)');
  const end = managed.indexOf('function memberCommunication()', start);
  const panel = managed.slice(start, end);
  assert.match(panel, /mgd-room-entry/);
  assert.match(panel, /فتح غرفة القرعة/);
  assert.doesNotMatch(panel, /history\.map\(/);
  assert.match(managed, /function notificationSettingsPanel\(d\)/);
  const newsStart = managed.indexOf('async function newsPanel(g, d)');
  const newsEnd = managed.indexOf('function notificationSettingsPanel(d)', newsStart);
  assert.doesNotMatch(managed.slice(newsStart, newsEnd), /إعدادات النشر/);
});

test('shared association workspace routes both roles through one detail component', () => {
  assert.match(html, /function groupDetail\(\)[\s\S]*SahmManagedGroup\.render\(g,d\)/);
  assert.doesNotMatch(html, /function legacyGroupDetail|legacy-group-detail/);
  for (const tab of ['overview','installments','shares','draws','communication']) assert.ok(managed.includes("['"+tab+"'"), 'missing participant tab '+tab);
  assert.match(managed, /SahmApp\.memberStatement\(g\.id,ownMemberId\(g\)\)/);
  assert.match(managed, /SahmApp\.drawHistory\(g\.id\)/);
});

test('participant workspace never guesses another member when own membership is missing', () => {
  assert.match(managed, /const own=members\.find\(x=>x\.isMe\);/);
  assert.doesNotMatch(managed, /members\.find\(x=>x\.isMe\)\s*\|\|\s*members\[0\]/);
  assert.match(managed, /SahmApp\.memberStatement\(g\.id,ownMemberId\(g\)\)/);
});

test('association subroutes all resolve to the shared workspace and retired duplicate renderers are absent', () => {
  assert.match(html, /installments:\(\)=>openAssociationWorkspace\('installments'\)/);
  assert.match(html, /'draw-room':\(\)=>openAssociationWorkspace\('draws','summary'\)/);
  assert.match(html, /'draw-history':\(\)=>openAssociationWorkspace\('draws','history'\)/);
  for (const name of ['members','installments','drawRoom','drawHistory','chat','news','audit']) {
    assert.doesNotMatch(html, new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('), 'retired renderer removed: '+name);
  }
  assert.doesNotMatch(html, /selectedInstallmentCycle|selectedInstallmentStatus|installments\(\)/);
});


test('association workspace tabs consume the correct role-specific data contracts', () => {
  assert.match(managed, /history\.map\(x=>\[Number\(x\.round_no\|\|x\.round\),x\]\)/);
  assert.match(managed, /r&&r\.ok\?\(r\.history\|\|r\.draws\|\|\[\]\):\[\]/);
  assert.match(managed, /draw\.winner_owner_name \|\| draw\.winnerLabel/);
  assert.match(managed, /draw\.winner_share_no \|\| '—'/);
  assert.doesNotMatch(managed, /winner_share_no\s*\|\|\s*[a-zA-Z]\w*\.winnerShareId/, 'internal share UUID is never presented as a share number');
  assert.match(managed, /pct===100\?'waiting':'collecting'/);
  assert.match(managed, /value=\"waiting\">بانتظار الموعد/);
  assert.match(managed, /memberStatement\(g\.id,ownMemberId\(g\)\)/);
  assert.match(managed, /SahmApp\.myShareList\(g\.id/);
  assert.doesNotMatch(managed, /تفاصيل رقم كل سهم وحالته غير متاحة/);
  assert.match(managed, /Number\(st\.shares\|\|0\)/);
  assert.match(app, /'myShareList'/);
  assert.match(data, /function myShareList\(db, viewer, gid, opts\)/);
  assert.match(remote, /invoke\('get_my_association_shares'/);
  assert.match(remote, /app\.myShareList=myShareList/);
});

test('managed workspace external stylesheet has balanced responsive rules and visible focus states', () => {
  const css = fs.readFileSync(path.join(ROOT, 'sahm-managed-group.css'), 'utf8');
  assert.match(html, /href=\"\/sahm-managed-group\.css\"/);
  assert.match(html, /src=\"\/sahm-managed-group\.js\"/);
  assert.doesNotMatch(css, /margin:9px 0 8px\\s*#screen/);
  assert.match(css, /#screen \.mgd-tabs button:focus-visible/);
  assert.match(css, /@media\(max-width:420px\)/);
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    assert.ok(depth >= 0, 'stylesheet braces close in order');
  }
  assert.equal(depth, 0, 'all managed workspace CSS blocks are balanced');
});


test('association workspace visual refinement preserves a calm, responsive hierarchy', () => {
  const css = fs.readFileSync(path.join(ROOT, 'sahm-managed-group.css'), 'utf8');
  assert.match(css, /SAHM workspace visual cleanup/);
  assert.match(css, /#screen \.mgd-identity\{[\s\S]*?background:#fff/);
  assert.match(css, /#screen \.mgd-identity-metrics\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /#screen \.mgd-tabs button\.active\{[\s\S]*?color:#3158b7/);
  assert.match(css, /#screen \.mgd-draw-nav button\.active/);
  assert.match(css, /#screen \.mgd-tabs button:focus-visible/);
  assert.match(css, /@media\(max-width:340px\)/);
});

test('managed association landing uses animated summary cards and exactly ten section cards', () => {
  assert.match(managed, /function managerDashboard\(g, d\)/);
  assert.match(managed, /class="mgd-home-summary"/);
  assert.match(managed, /class="mgd-home-sections"/);
  const sectionBlock = managed.match(/const sections = \[([\s\S]*?)\n    \];/);
  assert.ok(sectionBlock, 'ten manager sections are declared together');
  assert.equal((sectionBlock[1].match(/\['(?:installments|draws|shares|members|invites|chat|room|information|settings|audit)'\s*,/g) || []).length, 10);
  assert.match(managed, /if \(manager && !view\) \{ managerDashboard\(g, d\); return; \}/);
  assert.match(managed, /section === 'invites'\) \{ go\('invites'\); return; \}/);
  assert.match(managed, /section === 'room'/);
  assert.match(managed, /view === 'information'/);
});


test('managed installment selection starts with long press and bulk reminder is outside the search toolbar', () => {
  assert.match(managed, /pressTimer=setTimeout\([\s\S]*?state\.installmentSelectMode=true/);
  assert.match(managed, /state\.installmentSelected\.add\(pressCard\.dataset\.installmentKey\)/);
  assert.match(managed, /id="mgdInstallmentSelectionBar"/);
  assert.match(managed, /id="mgdInstallmentBulkReminder"/);
  assert.match(managed, /id="mgdInstallmentCancelSelection"/);
  assert.match(managed, /id="mgdInstallmentSelectVisible"/);
  const panel = managed.slice(managed.indexOf('function installmentsPanel'), managed.indexOf('async function cycleDetail'));
  const toolbar = panel.slice(panel.indexOf('id="mgdInstallmentToolbar"'), panel.indexOf('id="mgdInstallmentSelectionBar"'));
  assert.doesNotMatch(toolbar, /mgdInstallmentBulkReminder|managed-installment-select/);
  assert.match(managed, /<span>القسط<\/span>/);
  assert.doesNotMatch(managed, /<span>رقم القسط<\/span>/);
  assert.match(managed, /actionButton\('تذكير','send-reminder'/);
  assert.match(managed, /actionButton\('تحصيل','record-paid'/);
  assert.match(managed, /mgd-installment-status-icon/);
  assert.match(fs.readFileSync(path.join(ROOT, 'sahm-managed-group.css'), 'utf8'), /mgd-selection-bar/);
});
