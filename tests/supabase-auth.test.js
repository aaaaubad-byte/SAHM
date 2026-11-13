const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAuthFacade(overrides = {}) {
  const calls = { signUp: [], signIn: [], reset: [], update: [], signOut: 0 };
  const user = { id: 'user-1', email: 'person@example.com', email_confirmed_at: '2026-11-14T00:00:00Z' };
  const session = { user, access_token: 'test-token' };
  const auth = {
    signUp: async (args) => { calls.signUp.push(args); return { data: overrides.signUpData || { user, session: null }, error: overrides.signUpError || null }; },
    signInWithPassword: async (args) => { calls.signIn.push(args); return { data: { user, session }, error: overrides.signInError || null }; },
    signOut: async () => { calls.signOut++; return { error: null }; },
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    resetPasswordForEmail: async (...args) => { calls.reset.push(args); return { error: null }; },
    updateUser: async (...args) => { calls.update.push(args); return { data: { user }, error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  };
  const client = {
    auth,
    from(table) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: table === 'profiles'
                ? { id: user.id, full_name: 'أحمد محمد علي', avatar_key: 'avatar-01', profile_completed: true }
                : { phone_e164: '+967777123456', city: 'تعز' }, error: null }) };
            }
          };
        }
      };
    }
  };
  const window = { location: { origin: 'https://sahm.example', pathname: '/app.html', search: '?invite=secret-invite' } };
  window.supabase = { createClient: (url, key, options) => {
    calls.config = { url, key, options };
    return client;
  } };
  const code = fs.readFileSync(path.join(__dirname, '..', 'sahm-supabase.js'), 'utf8');
  vm.runInNewContext(code, { window, console, URL });
  return { facade: window.SahmSupabase, calls, user, session };
}

test('email signup requires terms and records the accepted terms version', async () => {
  const { facade, calls } = loadAuthFacade();
  await assert.rejects(() => facade.signUp('person@example.com', 'long-password', false), /الموافقة/);
  assert.equal(calls.signUp.length, 0);

  const result = await facade.signUp(' Person@Example.com ', 'long-password', true);
  assert.equal(result.needsEmailConfirmation, true);
  assert.equal(calls.signUp.length, 1);
  assert.equal(calls.signUp[0].email, 'person@example.com');
  assert.equal(calls.signUp[0].password, 'long-password');
  assert.equal(calls.signUp[0].options.data.terms_accepted, true);
  assert.equal(calls.signUp[0].options.data.terms_version, '2026-11-14');
  assert.equal(calls.signUp[0].options.emailRedirectTo, 'https://sahm.example/app.html?invite=secret-invite');
});

test('email login uses password authentication and normalizes email', async () => {
  const { facade, calls, user } = loadAuthFacade();
  const signed = await facade.signIn(' Person@Example.com ', 'correct-password');
  assert.equal(signed.user.id, user.id);
  assert.equal(calls.signIn[0].email, 'person@example.com');
  assert.equal(calls.signIn[0].password, 'correct-password');
});

test('profile reads private phone separately from public profile metadata', async () => {
  const { facade, user } = loadAuthFacade();
  const profile = await facade.profile(user.id);
  assert.equal(profile.id, user.id);
  assert.equal(profile.fullName, 'أحمد محمد علي');
  assert.equal(profile.avatarKey, 'avatar-01');
  assert.equal(profile.completed, true);
  assert.equal(profile.phone, '+967777123456');
});

test('password recovery redirect keeps the original invitation query', async () => {
  const { facade, calls } = loadAuthFacade();
  await facade.resetPassword('Person@Example.com');
  assert.equal(calls.reset[0][0], 'person@example.com');
  assert.equal(calls.reset[0][1].redirectTo, 'https://sahm.example/app.html?invite=secret-invite#reset-password');
});

test('password recovery updates the authenticated user password', async () => {
  const { facade, calls } = loadAuthFacade();
  await facade.updatePassword('new-long-password');
  assert.equal(calls.update[0][0].password, 'new-long-password');
});

test('publishable key only is configured for the browser client', async () => {
  const { facade, calls } = loadAuthFacade();
  await facade.session();
  assert.equal(calls.config.url, 'https://nusjnnrtpxbpphphmdsc.supabase.co');
  assert.match(calls.config.key, /^sb_publishable_/);
  assert.doesNotMatch(calls.config.key, /service_role/i);
  assert.equal(calls.config.options.auth.persistSession, true);
});
