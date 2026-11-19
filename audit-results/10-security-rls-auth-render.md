# 10 — مصفوفة الأمان والتشغيل ومخاطر النشر

- الفرع: SAHM-SUPABASE
- المشروع: nusjnnrtpxbpphphmdsc
- الفحص: قراءة فقط

## 1. RLS والمنح الفعلية

**CONFIRMED**
- جميع جداول public وعددها 24 لديها RLS مفعّل.
- توجد 32 سياسة في public، وسياستان في cron.
- private.association_public_links: RLS معطّل، ولا توجد صلاحية SELECT مباشرة لـ anon أو authenticated.
- private.time_event_runs: RLS مفعّل بلا سياسات، ولا توجد صلاحية SELECT مباشرة لـ anon أو authenticated.
- anon وauthenticated لديهما USAGE على private schema، لكن لا توجد صلاحية SELECT مباشرة على association_public_links.
- لا توجد صلاحية anon SELECT على public.profiles أو public.associations. authenticated لديه SELECT ويخضع لسياسات RLS.
- force RLS غير مفعّل على الجداول المفحوصة.

**التفسير:** لا يوجد دليل على أن association_public_links مكشوف عبر Data API. لكن الاعتماد على ACL دون RLS يتطلب توثيقاً ومراجعة دورية. ووجود RLS بلا سياسة على time_event_runs يبدو إغلاقاً متعمداً للوصول المباشر، وليس دليلاً على ثغرة.

## 2. RPC وSecurity Definer

- المتصفح يستدعي client.rpc(name,args) باستخدام عميل Supabase الافتراضي.
- الوظائف الحرجة لها أغلفة public تستدعي دوال private، ومنها create_association_unified وperform_draw وrecord_installment_receipt وapprove_join_request وsubmit_join_request وmanage_association_public_link.
- الدوال الداخلية المفحوصة SECURITY DEFINER وتستخدم SET search_path TO '' مع تأهيل أسماء الجداول والدوال بالمخطط.
- أغلفة public التي فُحصت SQL wrappers وليست SECURITY DEFINER.

**NOT VERIFIED**
- EXECUTE grants لكل RPC على anon/authenticated/service_role.
- جميع أغلفة public وما إذا كانت تعرض الوظائف الداخلية المقصودة فقط.
- كل دوال SECURITY DEFINER بحثاً عن dynamic SQL أو أخطاء تحقق أو تسريب بيانات.

## 3. Supabase Advisors

- WARN: حماية كلمات المرور المسربة في Auth معطّلة.
- INFO: private.time_event_runs لديه RLS دون Policies.
- INFO ×5: فهارس لم تستخدم وقت الرصد:
  - public.receipt_corrections.corrections_receipt_time_idx
  - public.cycle_attendance.attendance_cycle_idx
  - public.draw_eligible_shares.draw_eligible_draw_idx
  - public.association_events.association_events_actor_idx
  - public.receipt_corrections.receipt_corrections_receipt_association_idx
- Advisor health لم يعرض lint findings. هذا لا يثبت خلو النظام من العيوب.

لا تحذف الفهارس دون تحليل حجم البيانات وخطط الاستعلام ودورة الاستخدام.

## 4. Supabase Auth

**CONFIRMED**
- المشروع SAHM بحالة ACTIVE_HEALTHY وPostgreSQL 17.11.
- العميل يستخدم Publishable Key وPKCE، وعميل bootstrap يكتشف callback من URL.
- التسجيل يتطلب الموافقة على الشروط ويرسل redirect إلى المسار الحالي مع query string.
- إكمال الملف الشخصي يشترط قبول نسخة الشروط 2026-11-14، اسماً من ثلاثة مقاطع، هاتف E.164 فريداً، وصورة من قائمة ثابتة.
- لا توجد Edge Functions منشورة وفق أداة الجرد.

**BLOCKED**
- موصل Supabase لا يوفر قراءة Auth Provider settings: Site URL، Redirect URLs، SMTP، تأكيد البريد، MFA، مدة الجلسة، rate limits. لا يمكن تأكيدها من كود العميل أو catalog.
- لا توجد حاجة لنسخ service_role key ولا ينبغي طلبها.

## 5. Render

**CONFIRMED**
- sahm-supabase-preview: https://sahm-supabase-preview.onrender.com
- sahm-supabase-preview-fixed: https://sahm-supabase-preview-fixed.onrender.com
- الخدمتان Static Site، Auto Deploy مفعّل عند كل Commit، والفرع SAHM-SUPABASE والمستودع aaaaubad-byte/SAHM.
- كلتاهما أصبحتا Live على Commit e04dc6553476b3ab01c3c0f719a613da41bce304.
- publishPath هو ./ أو .، ولا يوجد build command، وقائمة IP تسمح 0.0.0.0/0.
- لم يتم تغيير إعدادات Render أو تشغيل نشر يدوي.

## 6. حادثة Workflow الآلي

**CONFIRMED**
- بعد Commit تقارير Markdown عمل refresh-sahm-pwa-worker.yml تلقائياً.
- أنشأ GitHub Actions Bot Commit e04dc6553476b3ab01c3c0f719a613da41bce304 بعنوان chore(pwa): stamp worker for e32de3b2cdc5.
- التغيير الوحيد في هذا Commit هو sw.js: BUILD_ID تغير من d075045d86e5 إلى e32de3b2cdc5. لا توجد تغييرات وظيفية أخرى وفق commit metadata.
- خدمتا Render نشرتا هذا Commit تلقائياً وأصبحتا Live.
- لم أعدّل sw.js أو Render مباشرة. التغيير نتج من automation موجود مسبقاً.
- هذا أثر جانبي غير مقصود خارج قيد Markdown-only، ويجب توثيقه. لا ينبغي إعادة sw.js تلقائياً دون قرار منفصل.

**التوصية**
- تجميع ملفات التدقيق المتبقية في Commit واحد لتقليل تشغيل Workflow وإعادة النشر.
- لا تعطّل Workflow ولا تغير Trigger ضمن هذا التدقيق دون موافقة صريحة.
- لا تُرجع sw.js إلى قيمة سابقة تلقائياً؛ ذلك تعديل إضافي خارج النطاق.

## 7. الأولويات

1. HIGH: تفعيل leaked password protection بعد اختبار التسجيل والدخول في بيئة اختبار.
2. HIGH: مراجعة EXECUTE grants وSecurity Definer لكل RPC.
3. MEDIUM: توثيق قصد RLS على time_event_runs.
4. MEDIUM: تحديد خدمة Render المرجعية دون إيقاف أي خدمة حالياً.
5. MEDIUM: معالجة تخزين query tokens في Service Worker cache وسياسة BUILD_ID مع كل Commit.
6. LOW / DATA-DEPENDENT: تقييم الفهارس غير المستخدمة قبل أي حذف.

## 8. حدود الفحص

لم تُقرأ بيانات معاملات المستخدمين، ولم تُعدّل DB أو Auth أو Render، ولم تُجر اختبارات runtime أو اختبارات صلاحيات هجومية.
