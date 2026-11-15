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
  const registry = html.match(/const ALL_SCREEN_REGISTRY\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(registry, 'central route registry exists');
  const routes = new Set([...registry[1].matchAll(/['"]?([A-Za-z_$][\w$-]*)['"]?\s*:/g)].map(x => x[1]));

  const staticRoutes = new Set([...html.matchAll(/data-go=["']([^"']+)["']/g)]
    .map(x => x[1]).filter(x => !x.includes('$')));
  for (const route of staticRoutes) assert.ok(routes.has(route), 'button route resolves: ' + route);

  const buttons = [...html.matchAll(/<button\b([^>]*)>/gi)].map(x => x[1]);
  assert.ok(buttons.length >= 100, 'all screen templates contribute their buttons');
  for (const attrs of buttons) {
    assert.match(attrs, /data-action|data-go|type=["']submit["']/, 'button has a delegated action, route, or form-submit role: ' + attrs);
  }

  const actions = new Set([...html.matchAll(/data-action=["']([^"']+)["']/g)]
    .map(x => x[1]).filter(x => !x.includes('$')));
  const actionCases = new Set([...html.matchAll(/action===["']([^"']+)["']/g)].map(x => x[1]));
  const groupedActions = new Set([...html.matchAll(/\[([^\]]+)\]\.includes\(action\)/g)]
    .flatMap(x => [...x[1].matchAll(/["']([^"']+)["']/g)].map(y => y[1])));
  const changeActions = new Set(['mute-toggle', 'notify-channel-toggle']);
  for (const action of actions) {
    assert.ok(actionCases.has(action) || groupedActions.has(action) || changeActions.has(action),
      'data-action is handled by click or change logic: ' + action);
  }

  assert.match(html, /document\.addEventListener\('click',[\s\S]*?handleAppAction\(action,el\)/);
  assert.match(html, /dialog\.addEventListener\('click',[\s\S]*?handleAppAction\(actionButton\.dataset\.action,actionButton\)/);
  assert.match(html, /buttons\.map\(\(\[label,act/);

  const formIds = new Set([...html.matchAll(/<form\b[^>]*\bid=["']([^"']+)["']/gi)].map(x => x[1]));
  const handledForms = new Set([...html.matchAll(/form\.id===["']([^"']+)["']/g)].map(x => x[1]));
  for (const id of formIds) assert.ok(handledForms.has(id), 'form submit is handled: ' + id);

  const anchors = [...html.matchAll(/<a\b([^>]*)>/gi)].map(x => x[1]);
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
  assert.match(html, /const managerOnly=\['members','invite','invites','join-requests','join-request-detail','audit'\]/);
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
