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
  const screenEntries = [...registryMatch[1].matchAll(/(?:^|,)\s*'?([A-Za-z_$][\w$-]*)'?\s*:\s*([A-Za-z_$][\w$]*)/gm)];
  assert.ok(screenEntries.length >= 20, 'all application screens are registered');

  const renderers = new Set([...html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[1]));
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
  assert.match(sw, /const CACHE_NAME = 'sahm-pwa-v30'/);
  assert.match(sw, /APP_SHELL[\s\S]*?'\/sahm-navigation\.js'/);
  assert.match(sw, /APP_SHELL[\s\S]*?'\/sahm-supabase-data\.js'/);
  assert.ok(sw.includes("'/sahm-app.js'"));
});


test('unified association UI and invitation renderer follow the new contract', () => {
  assert.match(html, /name="firstDrawOn"/);
  assert.match(html, /name="installmentMode"/);
  assert.match(html, /SahmCore\.installmentAmounts/);
  assert.match(html, /createInvitationsBulk/);
  assert.match(html, /data-action="submit-bulk-invites"/);
  assert.equal((html.match(/function inviteDetail\(\)\{/g) || []).length, 1);
  const handler = html.slice(html.indexOf("if(action==='invitation-interested'"), html.indexOf("if(action==='cancel-join-request'"));
  assert.ok(handler.indexOf("const response=") < handler.indexOf("if(response==='interested'"));
  assert.match(html, /shareSummary=g\.total==null/);
});


test('viewport metadata allows browser zoom for accessibility', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/);
  assert.ok(viewport, 'viewport metadata exists');
  assert.doesNotMatch(viewport[1], /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(viewport[1], /maximum-scale\s*=\s*1(?:[;,]|$)/i);
});

test('modal dialogs expose ARIA semantics and keyboard focus management', () => {
  assert.match(html, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="modal-title"/);
  assert.match(html, /<h3 id="modal-title">/);
  assert.match(html, /modalReturnFocus=document\.activeElement/);
  assert.match(html, /modalReturnFocus\.focus\(\)/);
  assert.match(html, /e\.key==='Escape'/);
  assert.match(html, /e\.key==='Tab'/);
  assert.match(html, /dialog\.contains\(document\.activeElement\)/);
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
  assert.ok(buttons.length >= 100, 'all screen templates contribute their buttons');
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
  assert.doesNotMatch(html, /quorumInfo|quorum|attendance-toggle|setAttendance|>حاضر<|>غير حاضر<|تسجيل الحضور|إلغاء الحضور/);
  assert.doesNotMatch(html, /name=["']tz["']|المنطقة الزمنية للجمعية/);
  assert.match(html, /agreementLocked/);
  assert.ok(html.includes("const managerOnly=['members','member-reception','invite','invites','join-requests','join-request-detail','audit']"));
  assert.match(html, /s==='draw-room'[\s\S]*?targetDetail\.role\.manager\|\|targetDetail\.role\.participant/);
  assert.match(html, /SahmApp\.getDrawRoom\(/);
  assert.match(html, /SahmApp\.getDrawHistory\(/);
  assert.match(html, /SahmApp\.getDrawReadiness\(/);
  assert.match(html, /SahmApp\.setDrawScheduledAt\(/);
  assert.match(html, /SahmApp\.setDrawPresentationStatus\(/);
  assert.match(html, /SahmApp\.performDraw\(/);
  assert.match(html, /adenDateTimeToUtc/);
  assert.match(html, /Asia\/Aden/);
  assert.match(html, /requestAnimationFrame\(\(\)=>\{wheelElement\.style\.transform/);
  assert.match(html, /SahmApp\.getNews\(/);
  assert.match(html, /subject_visible===true&&x\.subject_name/);
  assert.match(html, /SahmApp\.getAuditLog\(/);
  assert.doesNotMatch(html, /SahmApp\.eventLog\(g\.id/);
  assert.match(html, /channel\('feed'/);
  assert.match(html, /channel\('chat'/);
  assert.match(html, /channel\('names'/);
  assert.match(html, /SahmApp\.setNotifySettings\(/);
  assert.match(html, /SahmApp\.markNotificationsRead\(\[id\]\)/);
  assert.doesNotMatch(html, /SahmApp\.markNotificationsRead\(\)/);
  assert.match(html, /function news\(\)/);
  assert.match(html, /news:news/);
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
  assert.equal((groupsScreen.match(/data-go="create-group"/g) || []).length, 1,
    'the groups screen exposes only one create-association button');

  const memberStart = html.indexOf('function members(){');
  const memberEnd = html.indexOf('let pendingInvitees', memberStart);
  const membersScreen = html.slice(memberStart, memberEnd);
  assert.match(membersScreen, /search\.addEventListener\('input'/);
  assert.match(membersScreen, /container\.innerHTML=filtered\.length/);

  const navStart = html.indexOf('function nav(active){');
  const navEnd = html.indexOf('function shell(', navStart);
  const navCode = html.slice(navStart, navEnd);
  assert.match(navCode, /const groupScreens=/);
  assert.match(navCode, /const wallScreens=/);
  assert.match(navCode, /resolvedActive===s/);

  const statusStart = html.indexOf('async function loadAssociationPublicLinkStatus');
  const statusEnd = html.indexOf('function members(){', statusStart);
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


test('member reception is the central manager entry point and destructive link changes require confirmation', () => {
  assert.match(html, /'member-reception':memberReception/);
  assert.ok(html.includes("const managerOnly=['members','member-reception','invite','invites','join-requests','join-request-detail','audit']"));

  const receptionStart = html.indexOf('function memberReception(){');
  const receptionEnd = html.indexOf('function joinGroup(){', receptionStart);
  const reception = html.slice(receptionStart, receptionEnd);
  assert.match(reception, /استقبال الأعضاء/);
  assert.match(reception, /data-go="members"/);
  assert.match(reception, /data-go="invite"/);
  assert.match(reception, /data-go="invites"/);
  assert.match(reception, /data-go="join-requests"/);
  assert.ok(reception.includes('loadAssociationPublicLinkStatus(g.id,canInvite)'));

  const createdStart = html.indexOf('function showCreatedGroup(g){');
  const createdEnd = html.indexOf('function groupDetail(){', createdStart);
  const created = html.slice(createdStart, createdEnd);
  // The result screen merges success + invitations: no separate invite step after creation.
  assert.doesNotMatch(created, /data-go="invite"/);
  assert.match(created, /data-go="group-detail"/);
  assert.match(created, /data-action="copy-group-link"/);
  assert.match(created, /data-action="share-group-link"/);
  for (const helper of ['inviteePickerHtml()', 'inviteeListHtml()', 'inviteeBarHtml(', 'bindInviteePicker()']) {
    assert.ok(created.includes(helper), 'result screen uses ' + helper);
  }
  assert.ok(created.indexOf('inviteePickerHtml()') < created.indexOf('inviteeBarHtml('), 'contacts picker comes before the invite bar');
  assert.doesNotMatch(created, /data-go="member-reception"|data-go="invites"|data-go="join-requests"/);

  const pickerStart = html.indexOf('function inviteePickerHtml(){');
  const pickerEnd = html.indexOf('function inviteDetail(){', pickerStart);
  const picker = html.slice(pickerStart, pickerEnd);
  assert.ok(picker.indexOf('data-action="pick-device-contacts"') < picker.indexOf('<details class="cg-manual">'), 'contacts button precedes the folded manual entry');
  assert.match(picker, /id="inviteeManualForm"/);
  assert.match(picker, /id="sendInviteesButton"[^>]*data-action="submit-bulk-invites"/);
  const inviteStart = picker.indexOf('function invite(){');
  assert.ok(inviteStart > -1 && picker.slice(inviteStart).includes('inviteePickerHtml()'), 'invite from group details reuses the same picker');

  assert.match(html, /action==='confirm-public-link-action'/);
  assert.match(html, /سيصبح الرابط الحالي غير صالح/);
  assert.match(html, /سيُبطل الرابط العام نهائيًا/);
  assert.ok(html.includes("['rotate-group-link','revoke-group-link'].includes(action)"));
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


test('create-association flow is two flat steps with one primary action and no stale wizard code', () => {
  const start = html.indexOf('function setCreateWizardStep(');
  const end = html.indexOf('function groupDetail(){', start);
  const flow = html.slice(start, end);
  assert.match(html, /const CREATE_STEP_COUNT=2;/);
  assert.equal((html.match(/Math\.min\(2,/g) || []).length, 0, 'step limit is not hard-coded');
  for (const id of ['create-step-1', 'create-step-2']) assert.ok(flow.includes('id="' + id + '"'), id);
  assert.ok(!flow.includes('id="create-step-3"'), 'no third step');
  assert.ok(flow.includes("'+CREATE_STEP_COUNT+'"), 'step counter follows CREATE_STEP_COUNT');
  const step1 = flow.slice(flow.indexOf('id="create-step-1"'), flow.indexOf('id="create-step-2"'));
  const step2 = flow.slice(flow.indexOf('id="create-step-2"'), flow.indexOf('id="create-next"'));
  for (const field of ['name', 'startDate', 'firstDrawOn', 'shareAmount', 'currency']) assert.ok(step1.includes('name="' + field + '"'), 'screen 1 field: ' + field);
  for (const field of ['installmentMode', 'installments', 'installmentAmount', 'managerMode', 'managerShares']) assert.ok(step2.includes('name="' + field + '"'), 'screen 2 field: ' + field);
  assert.match(step1, /<div class="grid2"><div class="field"><label for="cg-start">[\s\S]*?name="startDate"[\s\S]*?name="firstDrawOn"/, 'start date and first draw share one row');
  assert.ok(step1.indexOf('id="cg-result"') > step1.indexOf('name="firstDrawOn"') && step1.indexOf('id="cg-result"') < step1.indexOf('name="shareAmount"'), 'computed duration line sits between the dates and the share row');
  assert.match(step1, /<div class="cg-row">[\s\S]*name="shareAmount"[\s\S]*name="currency"/, 'share amount and currency share one row');
  assert.ok(step2.indexOf('id="cg-installment-preview"') > step2.indexOf('name="installmentMode"') && step2.indexOf('id="cg-installment-preview"') < step2.indexOf('name="managerMode"'), 'actual installments list sits between payment method and manager');
  assert.ok(step2.indexOf('name="managerMode"') < flow.indexOf('id="create-final-submit"'));
  assert.ok(flow.indexOf('name="name"') < flow.indexOf('name="startDate"'));
  assert.ok(flow.indexOf('name="startDate"') < flow.indexOf('name="firstDrawOn"'));
  assert.ok(flow.indexOf('name="firstDrawOn"') < flow.indexOf('name="shareAmount"'));
  assert.ok(flow.indexOf('name="shareAmount"') < flow.indexOf('name="installmentMode"'));
  assert.ok(flow.indexOf('name="installmentMode"') < flow.indexOf('name="managerMode"'));
  for (const field of ['name', 'currency', 'startDate', 'firstDrawOn', 'shareAmount', 'installmentMode', 'installments', 'installmentAmount', 'managerMode', 'managerShares']) {
    assert.ok(flow.includes('name="' + field + '"'), 'form field kept: ' + field);
  }
  assert.doesNotMatch(flow, /create-prev|create-stage-title|create-section|inviteOpensOn|inviteClosesOn|name="rules"/);
  assert.equal((flow.match(/id="create-next"/g) || []).length, 1);
  assert.equal((flow.match(/id="create-final-submit"/g) || []).length, 1);
  assert.match(flow, /SahmCore\.periods\(duration,count\)/);
  assert.doesNotMatch(html, /create-step-active-|\.create-section|\.create-field|\.create-manager|\.create-rules-grid/);
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

test('draw and member tabs expose round progress and member win/eligibility filters', () => {
  assert.match(managed,/data-action="managed-open-cycle"/);
  assert.match(managed,/data-status=/);
  assert.match(managed,/mgdDrawSearch/);
  assert.match(managed,/mgdMemberStatus/);
  assert.match(managed,/memberStatus==='won'/);
  assert.match(managed,/backToTab\('draws'\)/);
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
