/* SAHM Supabase client + Auth facade.
 * Browser-safe: only the publishable key is embedded here. Never place service_role keys in this file.
 */
(function (root) {
  'use strict';
  var URL = 'https://nusjnnrtpxbpphphmdsc.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_RE6_iJo4rqaD4-FqOCMh5A_ZB05bU10';
  var TERMS_VERSION = '2026-11-14';
  var client = null;
  var currentUser = null;
  var authListener = null;

  function getClient() {
    if (client) return client;
    if (!root.supabase || typeof root.supabase.createClient !== 'function') {
      throw new Error('تعذر تحميل مكتبة الاتصال الآمن. تحقق من اتصال الإنترنت ثم أعد المحاولة.');
    }
    client = root.supabase.createClient(URL, PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      global: { headers: { 'X-Client-Info': 'sahm-web/1.0.0' } }
    });
    return client;
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
        emailRedirectTo: root.location.origin + root.location.pathname,
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

  async function signIn(email, password) {
    var c = getClient();
    var result = await c.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: password
    });
    if (result.error) throw result.error;
    currentUser = result.data.user || null;
    return { user: currentUser, session: result.data.session };
  }

  async function signOut() {
    var c = getClient();
    var result = await c.auth.signOut({ scope: 'local' });
    if (result.error) throw result.error;
    currentUser = null;
    return true;
  }

  async function session() {
    var c = getClient();
    var result = await c.auth.getSession();
    if (result.error) throw result.error;
    currentUser = result.data.session && result.data.session.user || null;
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
    var result = await c.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), {
      redirectTo: root.location.origin + root.location.pathname + '#reset-password'
    });
    if (result.error) throw result.error;
    return true;
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
    url: URL,
    termsVersion: TERMS_VERSION,
    client: getClient,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    session: session,
    user: user,
    profile: profile,
    completeProfile: completeProfile,
    resetPassword: resetPassword,
    onAuthStateChange: onAuthStateChange,
    friendlyError: friendly
  };
})(window);
