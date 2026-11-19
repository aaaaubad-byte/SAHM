# 12 — جرد الاختبارات والتغطية والفجوات

- الفرع: SAHM-SUPABASE
- نطاق القراءة: tests/*.test.js وsupabase/tests/*.sql وملفات CI
- لم يتم تشغيل أي اختبار.

## 1. جرد JavaScript

| الملف | عدد الاختبارات | المحور |
|---|---:|---|
| auth-flow.test.js | 5 | التسجيل والدخول وإكمال الملف |
| core.test.js | 35 | المبالغ والتواريخ والدورات والأقساط والقرعة والدعوات |
| css-dedup.test.js | 3 | تكرار CSS والقواعد الفارغة |
| data.test.js | 28 | مخزن محلي وقواعد الجمعية والأعضاء والتحصيل |
| join-flow.test.js | 12 | طلبات الانضمام وRealtime وتدفق الاعتماد |
| navigation.test.js | 6 | history/modal/auth boundaries |
| supabase-auth.test.js | 6 | Auth/PKCE/profile/session handoff |
| supabase-data.test.js | 15 | snapshot وRPC وpagination وRealtime |
| ui-contract.test.js | 41 | الشاشات والـhandlers والـCSS والعقود |
| **الإجمالي** | **151** | 9 ملفات |

**CONFIRMED:** الاختبارات معرفة عبر Node test runner، وتغطي اختبارات وحدات للنواة، وتدفق بيانات محلي، ومحاكاة بوابة Supabase، واختبارات عقود ساكنة للواجهة.

## 2. جرد SQL

| الملف | الأسطر | ملاحظات |
|---|---:|---|
| association_join_request_smoke.sql | 209 | سيناريو طلب الانضمام |
| association_operations_smoke.sql | 135 | عمليات الجمعية |
| association_rpc_invariants.sql | 41 | invariants لعقود RPC |
| association_share_register.sql | 38 | سجل الأسهم |
| association_workflow_smoke.sql | 106 | تدفق العمل |
| draw_last_day_schedule.sql | 25 | موعد القرعة |
| email_auth_profile_invariants.sql | 77 | شروط Auth والملف |
| email_signup_profile_completion_smoke.sql | 86 | إكمال الملف بعد التسجيل |
| schema_invariants.sql | 60 | قيود المخطط |
| **الإجمالي** | **777** | 9 ملفات |

تحتوي الملفات على assertions وفحوص استثناءات. أربعة ملفات تستخدم ROLLBACK صريحاً، بينما ملفات أخرى لا تحتوي ROLLBACK صريحاً. وفق workflow السابق، هذه الاختبارات تعمل على Supabase محلي مؤقت، لا على قاعدة الإنتاج. لم أشغّلها.

## 3. تصنيف التغطية

| النوع | الحالة | الأدلة |
|---|---|---|
| Unit / Domain | موجود | core.test.js |
| Local data behavior | موجود | data.test.js |
| Auth integration contract | موجود جزئياً | supabase-auth.test.js |
| Supabase gateway contract | موجود جزئياً | supabase-data.test.js |
| UI contract/static | موجود | ui-contract.test.js |
| CSS hygiene | موجود | css-dedup.test.js |
| Navigation | موجود | navigation.test.js |
| SQL invariants/smoke | موجود | 9 SQL files |
| Browser E2E | MISSING | لا يظهر مجلد أو workflow E2E في الجرد |
| Visual regression | MISSING | لا يظهر Playwright visual أو screenshot baseline |
| Security/RLS negative tests | جزئي / NOT VERIFIED | بعض SQL invariants؛ لا يوجد مصفوفة شاملة للأدوار |
| Load/concurrency tests | MISSING | لا يوجد اختبار تنافسية/ضغط ظاهر |
| Coverage report | MISSING | لا يوجد إخراج coverage موثق |

## 4. فجوات ذات أثر

1. لا يوجد ربط صريح بين كل قاعدة عمل واسم اختبار واحد أو أكثر؛ يجب أن يضاف هذا إلى سجل النقل.
2. لا يوجد اختبار E2E للرحلة الكاملة: تسجيل → إنشاء جمعية → دعوة → طلب انضمام → اعتماد → التزامات → تحصيل → تصحيح → قرعة.
3. اختبارات Supabase gateway تتحقق من عقود العميل بمحاكاة، ولا تثبت أن كل RPC تعمل على قاعدة حية أو أن grants وRLS صحيحة.
4. اختبارات UI contract تعتمد على قراءة النص/البنية، ولا تثبت أن العناصر تعمل فعلياً في المتصفح أو على الهاتف.
5. لا توجد تغطية مرئية لاختبارات cross-association IDOR أو صلاحيات عضو يحاول تنفيذ أمر مدير.
6. لا توجد اختبارات تنافسية تثبت منع التحصيل المكرر أو اعتماد طلب واحد مرتين أو تنفيذ القرعة بجولتين متزامنتين.
7. وجود بعض SQL tests دون ROLLBACK صريح آمن فقط ضمن قاعدة محلية مؤقتة يتم التخلص منها بعد التشغيل؛ لا تنقل تشغيلها إلى DB دائمة.
8. لم يتم تشغيل أي اختبار في هذا التدقيق، لذلك لا توجد نتيجة pass/fail ولا نسبة coverage.

## 5. توصية الاختبار في المعمارية الجديدة

- لكل RULE- سجل: Unit + SQL invariant + E2E عند الحاجة.
- لكل RPC- contract test لتوقيع المعاملات/المخرجات/الأخطاء + RLS/privilege test.
- اختبارات SQL على Supabase local disposable فقط.
- Playwright لتدفقات المستخدم الحقيقية، مع مستخدمين وأدوار اصطناعية.
- اختبارات concurrency للقرعة والتحصيل والعضوية.
- coverage thresholds لا تعتمد على نسبة عامة وحدها؛ تُقاس حسب domains الحرجة.
- لا ترفع TST إلى TESTED أو VERIFIED حتى تُشغّل الاختبارات وتُحفظ النتائج والـcommit الذي اختُبرت عليه.
