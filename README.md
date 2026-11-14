# SAHM | سهم

فرع التشغيل والتطوير المعتمد للتطبيق المتصل بـ Supabase.

## المسار المنشور
- Branch: `SAHM-SUPABASE`
- Entry: `index.html` → `Sahm_Preview_ROLE_SEPARATION.html`
- Render: `sahm-supabase-preview-fixed`
- Supabase Project: `nusjnnrtpxbpphphmdsc`

## ملفات التشغيل
- `Sahm_Preview_ROLE_SEPARATION.html`: واجهة التطبيق الحالية.
- `sahm-app.js`: طبقة تنسيق وربط الواجهة بالبيانات.
- `sahm-core.js`: قواعد الأعمال والحسابات والتحقق.
- `sahm-data.js`: نموذج البيانات والتطبيع والتوافق الذي تعتمد عليه طبقات التطبيق.
- `sahm-navigation.js`: التنقل وحالة المسارات.
- `sahm-supabase.js`: المصادقة والجلسات والملفات الشخصية.
- `sahm-supabase-data.js`: عمليات Supabase وRPC وRealtime.
- `sw.js`: Service Worker وتحديث ملفات التطبيق.
- `manifest.webmanifest`, `terms.html`, `icons/`: ملفات PWA والصفحات والأصول.

## قاعدة البيانات
ملفات `supabase/SAHM_DATABASE_BASELINE.sql` و`supabase/migrations/` و`supabase/tests/` هي سجل مرجعي واختباري للمخطط. لا تُحذف ولا تُشغّل على قاعدة الإنتاج عشوائياً. تغييرات المخطط الجديدة تكون بإضافات migrations مدروسة ومختبرة.

## التحقق
- JavaScript: `node --test tests/*.test.js`
- SQL: GitHub Actions workflow `.github/workflows/supabase-local-sql-tests.yml` ينشئ بيئة محلية معزولة للاختبار.
- لا تُزل ملفات الاختبارات أو ملفات قاعدة البيانات لمجرد أنها ليست مطلوبة لتحميل الصفحة؛ فهي ضمان صيانة وليست ملفات نشر للمتصفح.

## قواعد العمل
- هذا الفرع هو المصدر الوحيد لتعديلات التطبيق المتصل بقاعدة Supabase.
- لا تنشئ نسخ واجهات بديلة ولا تنقل الوظائف إلى ملف آخر قبل التحقق من الاعتمادات.
- لا تحذف أو تعيد إنشاء بيانات Supabase التشغيلية.
- لا تضع مفاتيح service_role أو الأسرار في ملفات الواجهة أو المستودع.
- انشر فقط بعد نجاح الاختبارات والتحقق من Commit المنشور.
