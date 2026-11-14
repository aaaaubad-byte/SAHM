/* SAHM Supabase client + Auth facade.
 * Browser-safe: only the publishable key is embedded here. Never place service_role keys in this file.
 */
(function (root) {
  'use strict';
  var SUPABASE_URL = 'https://nusjnnrtpxbpphphmdsc.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_RE6_iJo4rqaD4-FqOCMh5A_ZB05bU10';
  var TERMS_VERSION = '2026-11-14';
  var clients = Object.create(null);
  var activeClientKey = 'default';
  var currentUser = null;
  var authListener = null;
  var ACCOUNT_INDEX_KEY = 'sahm.saved.accounts.v1';

  function readAccounts() {
    try { return JSON.parse(root.localStorage.getItem(ACCOUNT_INDEX_KEY) || '[]').filter(function (x) { return x && x.id && x.email; }); }
    catch (_) { return []; }
  }
  function writeAccounts(items) {
    try { root.localStorage.setItem(ACCOUNT_INDEX_KEY, JSON.stringify(items)); } catch (_) {}
  }
  function accountStorageKey(id) { return 'account-' + String(id).replace(/[^a-zA-Z0-9_-]/g, ''); }
  function getClient(key) {
    key = key || activeClientKey;
    if (clients[key]) return clients[key];
    if (!root.supabase || typeof root.supabase.createClient !== 'function') {
      throw new Error('تعذر تحميل مكتبة الاتصال الآمن. تحقق من اتصال الإنترنت ثم أعد المحاولة.');
    }
    var authOptions = {
      autoRefreshToken: true, persistSession: true, detectSessionInUrl: key === 'default',
      flowType: 'pkce'
    };
    if (key !== 'default') authOptions.storageKey = 'sahm-auth-' + key;
    clients[key] = root.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: authOptions,
      global: { headers: { 'X-Client-Info': 'sahm-web/1.0.0' } }
    });
    return clients[key];
  }

  function friendly(error) {
    var msg = String(error && (error.message || error.msg) || '');
    if (/Invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (/Email not confirmed/i.test(msg)) return 'يجب تأكيد بريدك الإلكتروني من الرسالة المرسلة إليك أولاً.';
    if (/User already registered/i.test(msg)) return 'تعذر إنشاء الحساب بهذه البيانات. جرّب تسجيل الدخول أو استعادة كلمة المرور.';
    if (/Password should be at least/i.test(msg)) return 'كلمة المرور قصيرة؛ استخدم 8 أحرف على الأقل.';
    if (/rate limit|too many requests/i.test(msg)) return 'تم تجاوز عدد المحاولات المسموح مؤقتًا. حاول لاحقًا.';
    if (/network|fetch/i.test(msg)) return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
    if (/phone.*already|duplicate key/i.test(msg)) return 'رقم الهاتف مسجل مسبقًا بحساب آخر.';
    if (/three|ثلاثة مقاطع|الاسم الكامل/i.test(msg)) return 'اكتب الاسم الثلاثي على الأقل.';
    return msg || 'حدث خطأ غير متوقع. حاول مرة أخرى.';
  }

  async function signUp(email, password, acceptedTerms) {
    if (!acceptedTerms) throw new Error('يجب الموافقة على الشروط والأحكام لإكمال التسجيل.');
    var c = getClient();
    var result = await c.auth.signUp({
      email: String(email || '').trim().toLowerCase(),
      password: password,
      options: {
        emailRedirectTo: root.location.origin + root.location.pathname + root.location.search,
        data: { terms_accepted: true, terms_version: TERMS_VERSION }
      }
    });
    if (result.error) throw result.error;
    currentUser = result.data.user || null;
    return {
      user: currentUser,
      session: result.data.session || null,
      needsEmailConfirmation: !result.data.session
    };
  }

  function rememberAccount(userValue) {
    if (!userValue || !userValue.id || !userValue.email) return;
    var items = readAccounts().filter(function (x) { return x.id !== userValue.id; });
    items.unshift({ id: userValue.id, email: userValue.email, label: userValue.user_metadata && (userValue.user_metadata.full_name || userValue.user_metadata.name) || userValue.email });
    writeAccounts(items);
  }

  async function activateSession(sessionValue) {
    if (!sessionValue || !sessionValue.user) throw new Error('لم يتم العثور على جلسة الحساب.');
    var id = sessionValue.user.id, key = accountStorageKey(id), target = getClient(key);
    var stored = await target.auth.getSession();
    if (!stored.data.session || stored.data.session.refresh_token !== sessionValue.refresh_token) {
      var set = await target.auth.setSession({ access_token: sessionValue.access_token, refresh_token: sessionValue.refresh_token });
      if (set.error) throw set.error;
    }
    activeClientKey = key;
    currentUser = sessionValue.user;
    rememberAccount(sessionValue.user);
    return { user: currentUser, session: (await target.auth.getSession()).data.session };
  }

  async function signIn(email, password) {
    var defaultClient = getClient('default');
    var result = await defaultClient.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(), password: password
    });
    if (result.error) throw result.error;
    var activated = await activateSession(result.data.session);
    await defaultClient.auth.signOut({ scope: 'local' });
    return activated;
  }

  async function switchAccount(userId) {
    var key = accountStorageKey(userId), target = getClient(key);
    var result = await target.auth.getUser();
    if (result.error || !result.data.user) throw result.error || new Error('انتهت جلسة هذا الحساب. سجّل الدخول إليه مجددًا.');
    activeClientKey = key;
    currentUser = result.data.user;
    rememberAccount(currentUser);
    return { user: currentUser, session: (await target.auth.getSession()).data.session };
  }

  function accounts() { return readAccounts(); }

  async function signOut() {
    var c = getClient(), id = currentUser && currentUser.id;
    var result = await c.auth.signOut({ scope: 'local' });
    if (result.error) throw result.error;
    if (id) writeAccounts(readAccounts().filter(function (x) { return x.id !== id; }));
    activeClientKey = 'default';
    currentUser = null;
    return true;
  }

  async function session() {
    var c = getClient(activeClientKey);
    var result = await c.auth.getSession();
    if (result.error) throw result.error;
    if (!result.data.session && activeClientKey !== 'default') {
      activeClientKey = 'default';
      c = getClient('default');
      result = await c.auth.getSession();
      if (result.error) throw result.error;
    }
    if (result.data.session && result.data.session.user && activeClientKey === 'default') {
      var legacy = result.data.session;
      var activated = await activateSession(legacy);
      await c.auth.signOut({ scope: 'local' });
      return activated.session;
    }
    currentUser = result.data.session && result.data.session.user || null;
    if (currentUser) rememberAccount(currentUser);
    return result.data.session || null;
  }

  async function user() {
    var c = getClient();
    var result = await c.auth.getUser();
    if (result.error) throw result.error;
    currentUser = result.data.user || null;
    return currentUser;
  }

  async function profile(userId) {
    var c = getClient();
    var id = userId || (await user()).id;
    var a = await c.from('profiles')
      .select('id,full_name,avatar_key,profile_completed,created_at')
      .eq('id', id).maybeSingle();
    if (a.error) throw a.error;
    var b = await c.from('profile_private')
      .select('phone_e164,phone_verified_at,city')
      .eq('user_id', id).maybeSingle();
    if (b.error) throw b.error;
    return {
      id: id,
      fullName: a.data && a.data.full_name || '',
      avatarKey: a.data && a.data.avatar_key || 'avatar-01',
      completed: !!(a.data && a.data.profile_completed),
      phone: b.data && b.data.phone_e164 || '',
      phoneVerifiedAt: b.data && b.data.phone_verified_at || null,
      city: b.data && b.data.city || ''
    };
  }

  async function completeProfile(fullName, phoneE164, avatarKey) {
    var c = getClient();
    var result = await c.rpc('complete_my_profile', {
      p_full_name: String(fullName || '').trim(),
      p_phone_e164: String(phoneE164 || '').trim(),
      p_avatar_key: avatarKey || 'avatar-01'
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function resetPassword(email) {
    var c = getClient();
    var redirect = new URL(root.location.href);
    redirect.hash = '';
    redirect.searchParams.delete('code');
    redirect.searchParams.set('auth_action', 'reset-password');
    var result = await c.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), {
      redirectTo: redirect.toString()
    });
    if (result.error) throw result.error;
    return true;
  }

  async function updatePassword(password) {
    var c = getClient();
    var result = await c.auth.updateUser({ password: password });
    if (result.error) throw result.error;
    return result.data.user;
  }

  function onAuthStateChange(callback) {
    var c = getClient();
    if (authListener) authListener.unsubscribe();
    var result = c.auth.onAuthStateChange(function (event, sessionValue) {
      currentUser = sessionValue && sessionValue.user || null;
      if (typeof callback === 'function') {
        Promise.resolve().then(function () { callback(event, sessionValue || null); });
      }
    });
    authListener = result.data.subscription;
    return authListener;
  }

  root.SahmSupabase = {
    url: SUPABASE_URL,
    termsVersion: TERMS_VERSION,
    client: getClient,
    signUp: signUp,
    signIn: signIn,
    switchAccount: switchAccount,
    accounts: accounts,
    signOut: signOut,
    session: session,
    user: user,
    profile: profile,
    completeProfile: completeProfile,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    onAuthStateChange: onAuthStateChange,
    friendlyError: friendly
  };
})(window);
