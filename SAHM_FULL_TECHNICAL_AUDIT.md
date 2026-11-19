# SAHM — التدقيق التقني الشامل وخطة إعادة التأسيس

- تاريخ التقرير: 2026-11-20
- المستودع: aaaaubad-byte/SAHM
- الفرع الذي جرى العمل عليه حصراً: SAHM-SUPABASE
- مرجع المشروع: Supabase SAHM / nusjnnrtpxbpphphmdsc
- الوضع: تدقيق ساكن وقراءة فقط للتطبيق وقاعدة البيانات وRender، مع كتابة تقارير Markdown فقط.
- لا يوجد تنفيذ للمعمارية الجديدة ولا تعديل لقواعد البيانات.

## 1. الحكم التنفيذي

SAHM يملك نواة مجال حقيقية ومترابطة للجمعيات: إنشاء جمعية، عضوية، أسهم، التزامات أقساط، تحصيل، تصحيح إيصال، قرعة، دعوات، رابط انضمام، محادثة، إشعارات وسجل تدقيق. أهم قواعد المجال ليست كلها في الواجهة؛ عمليات الإنشاء والاعتماد والتحصيل والقرعة محكومة بدوال قاعدة بيانات ذات معاملات وأقفال.

لكن الوضع الحالي غير مناسب لإعادة تأسيس مباشرة على أساس نقل الملفات كما هي. توجد فجوات في تطابق مصدر الحقيقة، وتكرار منطق العمل بين العميل والخادم، وتراكم واجهة/CSS، وتباعد في سجل migrations، ونقص في اختبارات المتصفح والتنافس والصلاحيات. كما أن بعض القدرات موجودة في RPC دون مسار واجهة ظاهر.

**التوصية:** إعادة بناء الواجهة كتطبيق React + TypeScript + Vite، مع الاحتفاظ بـSupabase كخلفية مؤقتاً بعد تسوية سجل migrations والأمن وعقود RPC. لا تبدأ إعادة كتابة DB أو نقل البيانات قبل تثبيت baseline وتوثيق كل القواعد والقرارات.

## 2. نطاق التدقيق وحالته

| المحور | الحالة | النتيجة |
|---|---|---|
| Baseline والمستودع | CONFIRMED | الفرع SAHM-SUPABASE هو نطاق العمل |
| HTML والشاشات | CONFIRMED جزئياً | سجل الشاشات ومساراتها مقروء؛ بعض CSS الرئيسي يحتاج مراجعة تفصيلية إضافية |
| Core/Data engine | CONFIRMED | توجد قواعد مكررة وتعارضات بين المحلي والبعيد |
| Supabase Auth/Data | CONFIRMED جزئياً | PKCE وpublishable key وsnapshot وRPC مقروءة؛ Auth settings BLOCKED |
| Navigation/PWA/CI | CONFIRMED | History API وService Worker و3 workflows مقروءة |
| Manager/member UI | CONFIRMED | 10 أقسام مدير و4 بطاقات عضو رئيسية مع مسارات فرعية |
| CSS manager | CONFIRMED | 12 طبقة متعاقبة، تكرار وتضارب وأصناف يتيمة مرشحة |
| HTML/JS/CSS reconciliation | CONFIRMED جزئياً | تم إغلاق عدد من الأصناف غير المستخدمة ومسارات UI المفقودة |
| DB schema/RLS/views | CONFIRMED | 26 جدولاً، 53 FK، 109 indexes، View واحدة |
| Function/trigger inventory | CONFIRMED | 116 دالة و25 Trigger غير داخلي |
| Invitation/phone trust | CONFIRMED | الهاتف غير مثبت الملكية ويستخدم في مطابقة الدعوات |
| Cron/Realtime/extensions/advisors | CONFIRMED | Cron واحدة، 4 جداول Realtime، 6 Extensions |
| Test inventory | CONFIRMED | 151 JS tests و9 SQL test files؛ لم تُشغّل |
| Render | CONFIRMED | خدمتا Static Site Live مع Auto Deploy |
| Auth provider settings | BLOCKED | لا توجد أداة موصل تعرض إعدادات Auth التفصيلية |
| Architecture | PROPOSED | React + TS + Vite مقترحة ولم تعتمد بعد |
| New implementation | NOT_STARTED | لم يبدأ التنفيذ |

## 3. بنية التطبيق الحالية

المشروع تطبيق ويب/PWA ساكن، يتكون من:
- Sahm_Preview_ROLE_SEPARATION.html: واجهة التطبيق، سجل الشاشات، التنقل وبعض CSS وJavaScript المضمن.
- sahm-core.js: قواعد وحسابات وتحقق محلي.
- sahm-data.js: نموذج تخزين محلي وبذرة وعمليات قديمة/اختبارية.
- sahm-app.js: facade يربط الواجهة بالنواة والبيانات.
- sahm-supabase.js: Supabase client وAuth وملف المستخدم.
- sahm-supabase-data.js: remote data gateway وRPC وRealtime.
- sahm-navigation.js: History API والتنقل والحوارات.
- sahm-managed-group.js: مساحة الجمعية للمدير والعضو.
- sahm-managed-group.css: أنماط مساحة الجمعية.
- sw.js وmanifest.webmanifest وindex.html: PWA.
- tests/ وsupabase/tests/ و.github/workflows/: الاختبارات وCI.

لا يوجد package.json في جذر الشجرة التي جرى جردها؛ الاختبارات تعتمد Node test runner عبر workflow. الواجهة الحالية لا تستخدم React/Vue/Svelte.

## 4. واجهات المنتج الفعلية

### 4.1 الشاشات العامة

تتضمن الشاشات المسجلة: welcome، register، account-login، profile-setup، reset-password، logged-out، home، groups، managed-groups، joined-groups، create-group، created-group، group-detail، members، member-reception، invite، invite-detail، join-group، join-request-status، join-requests، join-request-detail، installments، draw-room، draw-history، receipts، receipt-detail، chat، wall، news، notifications، audit، profile، edit-profile، settings.

هذه قائمة شاشات مسجلة في المصدر، وليست حكماً بأن كل شاشة متاحة عبر مسار ظاهر أو أن كل إجراء يعمل runtime.

### 4.2 أقسام المدير العشرة

1. التحصيل
2. القرعات
3. الأسهم
4. الأعضاء
5. الدعوات
6. الدردشة
7. الغرفة
8. المعلومات
9. الإعدادات
10. السجل

المدير يستخدم managerSection مخصصاً؛ مسارات التبويب القديمة ما زالت موجودة في بعض handlers، لكنها ليست المسار النهائي للمدير.

### 4.3 العضو

لوحة العضو تعرض أربع بطاقات رئيسية: أقساطي، أسهمي، القرعات، التواصل. تتفرع منها الأخبار والدردشة وتفاصيل العضو والدورة والقرعة. لا تضاعف هذه المسارات الفرعية كأقسام رئيسية جديدة.

### 4.4 فجوات الواجهة

- member-reception مسجلة وتحتوي إدارة الرابط العام، لكن لا يظهر مسار دخول واضح إليها من تدفق المدير الحالي.
- إدارة الأسهم/الأعضاء في واجهة المدير قائمة قراءة وبحث؛ لا توجد أزرار حالية لـaddShares/removeShares/removeMember رغم وجود عمليات خادمية.
- بعض أصناف CSS لا ينتجها HTML/JS الحالي، ومنها mgd-new-member-actions وmgd-member-tools وmgd-filter-grid وmgd-bulk-reminder وغيرها. صنّفت كمرشحات تقاعد لا كحذف معتمد.
- pendingInvitees يستخدم كمتغير دون تصريح محلي واضح؛ اعتماد على global ضمني.
- قاعدة CSS التي تخفي mgd-new-member-actions لا تخفي حالياً كتلة منتجة في HTML/JS؛ هي قاعدة CSS يتيمة بحسب الفحص الحالي.

## 5. قواعد الأعمال ومصدر الحقيقة

| المجال | مصدر الحقيقة الحالي | الملاحظة |
|---|---|---|
| الهوية | Supabase Auth + profiles + profile_private | الهاتف يحتاج إثبات ملكية |
| الجمعية | associations | إنشاء وتعديل محكومان بدوال |
| العضوية | association_memberships | الدعوة لا تساوي عضوية |
| الأسهم | shares | تنشأ عند اعتماد العضوية أو مشاركة المدير |
| الأقساط | installment_periods + installment_obligations + status | لا تحسب حقيقة المتأخرات في الواجهة |
| التحصيل | installment_receipts | تسجيل ذري مع قفل الالتزام |
| تصحيح الإيصال | receipt_corrections | void مع snapshot وسبب |
| القرعة | draws + draw_eligible_shares + association_cycles | DB هي مصدر النتيجة |
| الدعوات | invitations + join_requests | hash token والتحقق الخادمي |
| رابط الانضمام | private.association_public_links | hash فقط وحالة lifecycle |
| سجل النشاط | association_events | أحداث منظمة حسب المجال |
| الرسائل | chat_messages + chat_read_states | Realtime للتحديث |
| الإشعارات | notifications + preferences | تخزين دائم وidempotency |

### قواعد يجب الحفاظ عليها

- اعتماد المدير هو نقطة إنشاء العضوية؛ لا تُنشأ العضوية بمجرد إرسال دعوة أو اهتمام المدعو.
- اعتماد الانضمام ينشئ membership وshares وinstallment obligations في عملية ذرية.
- التحصيل لا يحذف؛ التصحيح يسجل السبب وbefore/after.
- القرعة تتطلب اكتمال الالتزامات والوقت والجولة الصحيحة، وتستبعد الفائزين السابقين.
- الحضور ليس شرطاً للقرعة الحالية؛ لا تعِده دون قرار منتج.
- كل الحسابات المالية بوحدات minor integer.
- رابط الانضمام يخزن hash، ويخضع لحالة الجمعية وتاريخها المحلي.
- Realtime لا يصبح مصدر حقيقة؛ يعقبه refetch من DB.

## 6. قاعدة البيانات الحية

- المشروع ACTIVE_HEALTHY، PostgreSQL 17.11.
- 24 جدولاً في public وجدولان في private.
- 53 Foreign Keys.
- 109 indexes.
- View واحدة.
- 116 دالة: 49 في public و67 في private.
- 25 Trigger غير داخلي.
- 32 سياسة في public وسياستان في cron.
- جميع جداول public الـ24 لديها RLS مفعّل.
- Realtime publication يضم chat_messages وinvitations وjoin_requests وnotifications.
- Extensions: pg_cron 1.6.4، pg_stat_statements 1.11، pgcrypto 1.3، plpgsql 1.0، supabase_vault 0.3.2، uuid-ossp 1.1.
- Cron واحدة تعمل كل عشر دقائق: private.process_time_events().
- سجل time_event_runs أظهر 706 تشغيلات ناجحة و0 فشل و0 تشغيل غير مكتمل حتى آخر سجل متاح وقت الفحص.

### ملاحظات أمنية

- private.association_public_links بلا RLS، لكن anon/authenticated لا يملكان SELECT مباشرة. لا يوجد دليل على انكشاف الجدول عبر Data API.
- private.time_event_runs لديه RLS بلا Policies ولا صلاحية SELECT مباشرة للأدوار العادية؛ قد يكون هذا إغلاقاً مقصوداً.
- Advisor حذر من تعطيل leaked password protection.
- خمسة فهارس مصنفة unused؛ لا تحذف قبل تحليل query plans وحجم البيانات.
- لا توجد Edge Functions منشورة في المشروع وفق الجرد.
- بعض السياسات تعتمد على grants أكثر من اعتمادها على RLS، ويجب اختبار EXECUTE grants وdirect DML.

## 7. المخاطر الحرجة

1. **الهاتف غير مثبت الملكية:** complete_my_profile يتحقق من الصيغة والتفرد، لا من OTP؛ ويستخدم الهاتف في مطابقة الدعوات. هذا يفتح احتمال مطالبة مستخدم بدعوة موجهة لرقم لم يثبت ملكيته. التوصية: تحقق هاتف مستقل قبل استخدامه في الهوية/الدعوات.
2. **غياب سقف أسهم موثق:** managerShares يولد صفوف shares دون حد أعمال أعلى ظاهر، وtarget_shares/max_shares_per_member NULL. يلزم قرار حد أعلى لكل عضو ولكل جمعية.
3. **Migration drift:** 36 ملفاً في repo و36 سجلاً حياً؛ 22 رقم إصدار متطابقاً و14 غير متطابق. يجب تفسير كل فرق قبل إعادة تأسيس DB.
4. **تكرار قواعد العمل:** قفل الاتفاق ونافذة الانضمام وجاهزية القرعة وحالة القسط وتطبيع الهاتف وإعدادات الإشعارات لها نسخ متعددة.
5. **تحميل snapshot واسع:** remote gateway يقرأ 21 جدولاً وصف inbox ثم يعيد تحميل البيانات بعد mutations؛ سيصبح مكلفاً وبطيئاً مع النمو.
6. **Realtime محدود:** لا تُنشر الجداول المالية الأساسية مثل receipts/draws/memberships/shares/associations/cycles، وقد تبقى بعض الواجهات قديمة حتى refresh.
7. **كتم الإشعارات غير متسق:** publish_association_event لا يقرأ mute_group بينما مسارات الرسائل والتذكيرات تفعل.
8. **Service Worker يخزن query strings:** رموز الدعوات وAuth callback قد تبقى في Cache Storage.
9. **Auto Deploy side effects:** كل Commit يشغل workflow ختم sw.js، وخدمتا Render تنشران تلقائياً.
10. **نقص الاختبارات:** لا توجد E2E/visual/concurrency suite ظاهرة، ولا نتائج تشغيل فعلية لهذا التدقيق.

تفاصيل كل خطر وقرارات المنتج في audit-results/14-critical-risk-register.md.

## 8. الاختبارات

- 9 ملفات JavaScript، 151 حالة test().
- 9 ملفات SQL، 777 سطراً إجمالاً.
- تغطية موجودة: Core/Domain، بيانات محلية، Auth contracts، Supabase gateway contracts، navigation، CSS hygiene، UI contracts، SQL invariants/smoke.
- فجوات: browser E2E، visual regression، RLS negative tests الشاملة، concurrency/load tests، وتغطية تربط كل RULE/RPC بشروطه.
- لم يتم تشغيل أي اختبار. لا توجد نتيجة pass/fail أو نسبة coverage.

## 9. Auth وRender

### Auth
كود العميل يستخدم Publishable Key وPKCE وعميل bootstrap، ويفصل الهاتف في profile_private. إعدادات Auth Provider التفصيلية BLOCKED عبر الموصل الحالي: Site URL وRedirect URLs وSMTP وMFA وsession duration وrate limits.

### Render
خدمتا Static Site:
- sahm-supabase-preview
- sahm-supabase-preview-fixed

كلتاهما Live على SAHM-SUPABASE، Auto Deploy عند كل Commit. لم يتم تغيير أي إعداد أو نشر يدوي.

**حادثة نطاق:** بعد إضافة تقارير Markdown، أنشأ workflow آلي Commit لتغيير BUILD_ID في sw.js، ثم نشرت الخدمتان تلقائياً. التغيير الوحيد في Commit البوت كان سطر BUILD_ID. لم أعدّل sw.js مباشرة. تكررت آلية الختم بعد Commitات التقارير اللاحقة. هذا أثر جانبي موثق، ويجب تجميع أي Markdown مستقبلي في Commit واحد وتقليل الكتابات المنفصلة. لا يُعطل workflow ولا تُرجع sw.js دون قرار منفصل.

## 10. القرار المعماري

**المقترح:** React + TypeScript + Vite، TanStack Query، React Router، Zod، Vitest، Testing Library، Playwright. فصل UI عن Application Use Cases وDomain وInfrastructure، مع Supabase repositories/RPC وRealtime.

لماذا React: منظومة أوسع للمكونات المعقدة والاختبار والوصولية وتوسيع الفريق. لا توجد حاجة مثبتة إلى Next.js/SSR. Preact أصغر، لكن حجم runtime ليس العامل الحاسم مقارنة باتساع النظام البيئي.

لا تضع قواعد المال أو العضوية أو القرعة في React hooks. كل mutation مهم يمر عبر RPC ذرية. Realtime يبطل query ثم refetch. لا تستخدم optimistic update للعمليات المالية أو القرعة دون آلية تعويض واختبارات.

التفصيل في audit-results/11-target-architecture-evaluation.md.

## 11. خطة إعادة التأسيس

### المرحلة 0 — تثبيت الأدلة
- إغلاق كل NOT VERIFIED وBLOCKED الممكنة.
- إنشاء schema baseline موثق.
- مطابقة migration timestamps وnames وchecksums.
- حفظ inventory لكل RPC/grant/RLS/trigger.

### المرحلة 1 — قرارات المنتج
- التحقق من الهاتف.
- حد الأسهم.
- إدارة الرابط العام.
- إدارة الأسهم وإزالة العضو.
- سياسة كتم الإشعارات.
- سياسة رؤية سجل النشاط.
- اختيار خدمة Render المرجعية.

### المرحلة 2 — تأسيس المشروع الجديد
- React + TypeScript + Vite.
- design tokens وRTL components.
- routing وauth guards.
- error handling وtelemetry.
- CI type-check/lint/unit.
- لا اتصال بقاعدة الإنتاج خلال هذه المرحلة.

### المرحلة 3 — الهوية والملف
- التسجيل وتأكيد البريد.
- تحقق الهاتف.
- الملف الشخصي والشروط.
- اختبارات Auth وsession recovery.

### المرحلة 4 — الجمعية والعضوية
- إنشاء جمعية ذري.
- الدعوات والرابط.
- طلب الانضمام واعتماد المدير.
- membership/shares/obligations.
- اختبارات صلاحيات وتنافس.

### المرحلة 5 — المالية
- عرض الالتزامات.
- تسجيل التحصيل.
- تصحيح الإيصال.
- التذكيرات.
- سجل مالي/audit.
- اختبارات idempotency والتزامن.

### المرحلة 6 — القرعة
- الجاهزية والتوقيت والجدولة.
- تنفيذ القرعة وخوارزمية الاختيار.
- حفظ eligible snapshot.
- إنشاء الدورات اللاحقة.
- اختبارات تزامن وإعادة تشغيل.

### المرحلة 7 — الاتصال
- Realtime محدد.
- الدردشة والأخبار والإشعارات.
- سياسات الكتم وقنوات النشر.
- اختبارات صلاحيات وتحديث واجهات.

### المرحلة 8 — الإدارة والواجهة
- أقسام المدير العشرة.
- بطاقات العضو الأربع.
- البحث والفلترة والحالات الفارغة/التحميل/الفشل.
- اختبار Mobile-first وaccessibility.

### المرحلة 9 — parity وcutover
- E2E كاملة.
- مقارنة قواعد العمل ببيانات اختبار اصطناعية.
- خطة نقل بيانات وrollback.
- قرار إطلاق وتحويل حركة المستخدمين.

## 12. قرارات لا أتخذها نيابة عنك

1. لا أضع سقفاً رقمياً للأسهم دون قرارك.
2. لا أقرر أن الهاتف يجب أن يكون OTP دون اعتماد سياسة الهوية، لكن التوصية الفنية هي إثبات الملكية.
3. لا أعيد وظائف add/remove shares أو remove member للواجهة دون اعتماد.
4. لا أنقل إدارة الرابط العام لقسم محدد دون قرار تصميم.
5. لا أوقف أي خدمة Render ولا أغيّر workflow.
6. لا أحذف الجداول/الدوال/الأصناف المرشحة للتقاعد بناء على عدم الاستخدام الساكن فقط.

## 13. حدود التقرير

- تم العمل حصراً على SAHM-SUPABASE.
- لم يتم إنشاء فرع.
- لم يتم تعديل HTML/JS/CSS/SQL أو إعدادات Render يدوياً.
- لم يتم تعديل قاعدة البيانات أو تشغيل migration.
- لم يتم تشغيل الاختبارات.
- Auth provider settings وبيانات HTTP headers التفصيلية على Render غير متاحة عبر الأدوات الحالية.
- بعض تفاصيل CSS الرئيسي ونتائج runtime/visual ما زالت تحتاج تحققاً لاحقاً.
- التقرير نهائي كملخص للأدلة المتاحة حالياً، لكنه لا يدّعي أن العناصر المصنفة NOT VERIFIED أو BLOCKED قد حُسمت.
