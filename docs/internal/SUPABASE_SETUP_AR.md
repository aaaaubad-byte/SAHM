# دليل إعداد Supabase لمشروع سهم

## المشروع المستهدف

- الاسم: SAHM
- Project ref: `nusjnnrtpxbpphphmdsc`
- URL: `https://nusjnnrtpxbpphphmdsc.supabase.co`
- المنطقة: `ap-northeast-1`
- PostgreSQL: 17.x

## إجراء المالك المطلوب قبل اختبار التسجيل

1. افتح Supabase Dashboard للمشروع SAHM.
2. افتح Authentication ثم Sign In / Providers أو إعدادات Email.
3. عطّل Confirm Email يدويًا كما طلب مالك المشروع.
4. لا تفعّل Phone provider ولا SMS ولا Phone OTP.
5. لا تغيّر إعدادات Auth برمجيًا من ملفات المشروع.
6. أبلغ فريق الاختبار بعد حفظ الإعداد.

## متغيرات البيئة المطلوبة للواجهة

- `SAHM_SUPABASE_URL` = عنوان المشروع أعلاه.
- `SAHM_SUPABASE_PUBLISHABLE_KEY` = مفتاح publishable من إعدادات API/Keys.

المفتاح publishable أو anon مخصص للواجهة ويمكن أن يظهر في طلبات المتصفح. لا تضع `service_role` أو أي secret key في HTML أو JavaScript أو مستودع GitHub. لا تستخدم مفاتيح قاعدة البيانات المباشرة في المتصفح.

**تنبيه Render:** خدمة Static Site لا تحول متغيرات البيئة تلقائيًا إلى متغيرات متاحة في JavaScript بالمتصفح. يجب أن يحدد أسلوب البناء/إنشاء ملف إعداد عام آمن كيفية تمرير URL ومفتاح publishable، دون تضمين أسرار. لم يعتمد هذا المشروع بعد آلية البناء النهائية لأن الواجهة لم تُربط بعد.

## التسجيل المتوقع

يستدعي العميل:
```js
supabase.auth.signUp({
  email,
  password,
  options: {
    data: { full_name, phone, city }
  }
});
```

- يجب إدخال الهاتف بصيغة دولية E.164 مع رمز الدولة؛ لا يخمّن التطبيق رمز الدولة.
- تقبل دالة قاعدة البيانات الأرقام العربية والهندية وتحوّلها إلى ASCII، وتحول بادئة 00 إلى +.
- Trigger على `auth.users` ينشئ `profiles` و`profile_private` و`user_preferences` في المعاملة نفسها.
- إذا كان الهاتف غير صالح أو مكررًا يفشل إنشاء Auth كله، ولا يبقى حساب بلا ملف.
- الهاتف ليس وسيلة دخول أو إثبات ملكية؛ الدخول بالبريد وكلمة المرور.
- لا توجد صلاحية إدارية في metadata.

## تسجيل الدخول واستعادة كلمة المرور

- الدخول: `supabase.auth.signInWithPassword({ email, password })`.
- استعادة: `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
- استعادة الجلسة: يقرأ العميل جلسة Supabase ويعيد تحميل بيانات الجمعيات من قاعدة البيانات.
- لا يظهر نجاح إنشاء الحساب أو الجمعية أو الاستلام أو القرعة إلا بعد رد خادمي ناجح.

## إعداد Realtime

تمت إضافة `public.chat_messages` إلى `supabase_realtime`. لا تستخدم Realtime للقرعة أو الأقساط أو الاستلام؛ هذه عمليات RPC ذرية.

## إعداد Storage

لا توجد حاويات Storage حاليًا؛ مرجع V2 لا يطلب صورًا أو مرفقات أو إثباتات دفع. لا تنشئ bucket دون حاجة جديدة موثقة.

## مراجع ملفات المشروع

- `supabase/SAHM_DATABASE_BASELINE.sql`: لقطة تأسيس كاملة للمخطط الحالي على مشروع فارغ.
- `supabase/migrations/`: التغييرات التراكمية بعد تأسيس المخطط.
- `docs/internal/SUPABASE_DATABASE_DESIGN_AR.md`: التصميم والعلاقات والصلاحيات والعمليات.
- `docs/internal/SUPABASE_IMPLEMENTATION_PROGRESS_AR.md`: حالة التنفيذ والفجوات المعروفة.

## حدود الدليل

هذا الدليل لا يعني أن الواجهة أصبحت متصلة أو أن التسجيل اختُبر؛ لا يزال ربط الواجهة وإنشاء حسابات اختبار Auth والاختبار على هاتف فعلي مطلوبًا.
