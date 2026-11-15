# SAHM | سهم — سجل تتبع التطوير

**المرجع:** `docs/SAHM_DEVELOPMENT_GAP_PLAN.md`  
**الفرع:** `SAHM-SUPABASE`  
**قاعدة البيانات:** Supabase `nusjnnrtpxbpphphmdsc`  
**القاعدة:** يُحدَّث هذا السجل بعد كل مجموعة تغييرات مستقرة (ما أُنجز، ما تبقى، وما طُبّق على قاعدة البيانات).

---

## ملخص الحالة

| المرحلة | العنوان | الحالة |
|---|---|---|
| 0 | تثبيت خط الأساس والتحقق | منجزة |
| 1 | الإنشاء والقفل | قاعدة البيانات: منجزة ومطبّقة ومتحقق منها؛ الواجهة والمحرك والاختبارات لم تبدأ |
| 2 | الأقساط وأهلية القرعة | قاعدة البيانات: منجزة ومطبّقة ومتحقق منها؛ الواجهة والمحرك والاختبارات لم تبدأ |
| 3 | وقت القرعة والعجلة والنتيجة | قاعدة البيانات: منجزة ومطبّقة ومتحقق منها؛ الباقي لم يبدأ |
| 4 | الأحداث والإشعارات | قاعدة البيانات: منجزة ومطبّقة ومتحقق منها؛ الباقي لم يبدأ |
| 5 | المهام الزمنية | قاعدة البيانات: منجزة ومطبّقة (pg_cron يعمل كل 10 دقائق)؛ الباقي لا يلزم |
| 6 | اختبار قبول شامل ونشر | لم تبدأ |

## القرارات المعتمدة (ملزمة)

- السهم الفائز يستمر في سداد الأقساط ويُستبعد من أهلية الفوز اللاحقة فقط.
- التزام مجمّع واحد لكل عضو عن كل فترة قسط (لا التزام لكل سهم).
- لا حذف للجداول أو البنية؛ `cycle_attendance` و`quorum_percent` يبقيان دون اعتماد المنتج عليهما.
- لا يُمس `main` ولا خدمة Render `sahm-preview`.
- الترحيلات تُطبَّق على قاعدة البيانات مباشرة بعد رفعها إلى الفرع (قرار المالك بتاريخ 2026-11-15)، مع توثيقها هنا.

## السجل الزمني

### 2026-11-15

**المرحلة 0 — منجزة (قراءة فقط)**
- تأكيد أن الفرع على `b48f433` وأن أعداد السجلات مطابقة للوثيقة.
- أربع جمعيات تجاوزت تاريخ بدايتها (8 و14 و15 نوفمبر) و`locked_at` فيها فارغ.
- فحص تبعيات الدوال (12 دالة). دوال بلا حارس بدء الاتفاق: `add_shares`, `remove_shares`, `remove_member`, `update_association`, `accept_invitation`. دوال فيها الحارس: `accept_legacy_invitation_by_id`, `approve_join_request`. دوال تعتمد على النصاب/الحضور: `create_association`, `create_association_unified`, `perform_draw`, `update_association`, `set_cycle_attendance` (نسختان: private وpublic).
- اكتشاف جدول `private.association_public_links` (روابط الانضمام العامة) في مخطط `private`.

**حذف البيانات من قاعدة بيانات SAHM — منجز (بقرار المالك)**
- حُذفت بيانات التطبيق كلها (الجمعيات والعضويات والأسهم والدورات والأقساط والالتزامات والأحداث والإشعارات والمحادثات والدعوات وطلبات الانضمام وروابط الانضمام العامة).
- حُذفت الحسابات: `auth.users` و`profiles` و`profile_private` و`legal_acceptances` و`user_preferences`.
- عُطّلت سبعة حراس لمنع تعديل السجل التاريخي داخل عملية واحدة ثم أُعيد تفعيلها، وتم التحقق من أن الحراس كلها مفعّلة.
- البنية (الجداول والدوال والسياسات والترحيلات) لم تتغير.

**رفع الوثيقة والسجل**
- رُفعت `docs/SAHM_DEVELOPMENT_GAP_PLAN.md` إلى الفرع (`cf85a92`).
- أُنشئ هذا السجل (`0f3f3cd`).

**المرحلة 1 — ترحيل قاعدة البيانات: مطبّق ومتحقق منه**
- الملف: `supabase/migrations/20261115010000_phase1_agreement_lock_quorum_removal_rounding.sql` (على الفرع، `1a5a395`).
- طُبّق على Supabase مباشرة بالنص نفسه، وسُجّل في القاعدة بالإصدار `20261115005939` (الاسم `phase1_agreement_lock_quorum_removal_rounding`). رقم إصدار الملف في المستودع يختلف عن رقم التسجيل في القاعدة لأن القاعدة تسجّل وقت التطبيق؛ المحتوى متطابق.
- المحتوى:
  1. دالة جديدة `private.assert_association_agreement_open(uuid)`: ترفض التعديل متى كان التاريخ المحلي (حسب `associations.time_zone`) >= `start_date`. الصلاحيات مسحوبة من `public` و`anon` و`authenticated` (تُستدعى من الدوال الداخلية فقط).
  2. تطبيق الحارس على: `add_shares` و`remove_shares` و`remove_member` و`update_association` و`accept_invitation`. تبقى فحوص `locked_at` والقرعات والإيصالات كما هي.
  3. إزالة النصاب من `create_association_unified` و`update_association` (عمود `quorum_percent` يبقى بقيمته الافتراضية دون تغيير).
  4. في وضع العدد: فرق التقريب يذهب إلى القسط الأخير (`create_association_unified` و`rebuild_open_association_obligations`).
- التحقق بعد التطبيق (فحص التعريفات الحية): الحارس موجود في الدوال الخمس؛ لا أثر لـ `v_quorum` أو كلمة quorum في `create_association_unified` و`update_association`؛ التقريب الجديد موجود في الدالتين؛ لا بقايا للتقريب القديم؛ جميع الدوال ما زالت SECURITY DEFINER.

**المراحل 2 إلى 5 — دفعة قاعدة البيانات: خمسة ترحيلات مكتوبة ومرفوعة ومطبّقة ومتحقق منها**

| الدفعة | الملف | المحتوى | إصدار القاعدة |
|---|---|---|---|
| 1/5 | `20261115020000_phase2_5_foundations.sql` | عمود `draw_scheduled_at`، قيد حالة `failed`، أعمدة قنوات النشر والأسماء، جدول `private.time_event_runs`، `private.publish_association_event` (ناشر الأحداث الموحد)، سياسة `events_select` للمدير فقط، `derive_installment_status` وعرض `installment_obligation_status`، `compute_draw_readiness`، `get_draw_readiness` | `20261115012909` |
| 2/5 | `20261115020100_phase2_draw_eligibility_and_finance.sql` | إعادة كتابة `perform_draw` (بلا حضور ولا نصاب، جاهزية مالية كاملة، التقريب في القسط الأخير للدورات اللاحقة)، `record_installment_receipt` عبر الناشر، مسارات الانضمام الثلاثة عبر الناشر، إيقاف `set_cycle_attendance` و`create_association` القديمة، `get_association_financial_summary` | `20261115012955` |
| 3/5 | `20261115020200_phase3_draw_time_room_history.sql` | `set_draw_scheduled_at`، `set_draw_presentation_status`، `get_draw_room`، `get_draw_history` مع الأغلفة العامة | `20261115013026` |
| 4/5 | `20261115020300_phase4_settings_news_audit.sql` | `set_association_notification_settings` (قنوات الأخبار والمحادثة وإظهار الأسماء)، تحديث `set_association_notification_types` القديمة، `get_association_news` (إخفاء الاسم على الخادم)، `get_association_audit_log` (للمدير) | `20261115013051` |
| 5/5 | `20261115020400_phase5_time_events.sql` | تفعيل `pg_cron`، `private.process_time_events()` (تأخر، اكتمال أقساط العضو، اكتمال تحصيل الدورة، قرب القرعة وحلولها)، جدولة كل 10 دقائق | `20261115013111` |

قرارات ضمن الدفعة:
- `pg_cron` متاح في المشروع (1.6.4)؛ لذلك الجدولة داخل Supabase ولا حاجة لـ Render Cron.
- `events_select` على `association_events` أصبحت للمدير فقط؛ الأعضاء يقرؤون الأخبار عبر `get_association_news`.
- عند التعارض بين التوجيه والواقع: لا يوجد كائن `draw_history` في القاعدة، فصدرت `get_draw_history` بدلًا منه.

**التحقق من الدفعة على القاعدة الحية (2026-11-15، قراءة فقط)**
- سجل الترحيلات في القاعدة يحوي الإصدارات الخمسة بالترتيب بعد `20261115005939`؛ ما سبق في هذا السجل من عبارة «قيد التطبيق» كان متأخرًا عن الواقع وقد صُحّح.
- الكائنات موجودة: الأعمدة `draw_scheduled_at` و`feed_enabled_types` و`chat_enabled_types` و`name_visible_types`، الجدول `private.time_event_runs`، العرض `installment_obligation_status`، وكل الدوال الجديدة (private وpublic).
- قيد `association_cycles_status_check` يقبل: `scheduled, open, drawn, completed, failed`.
- مهمة `pg_cron` باسم `sahm-process-time-events` مفعّلة بجدول `*/10 * * * *` (لم تُنفَّذ بعد لأن القاعدة فارغة).
- `perform_draw`: لا إشارة إلى `cycle_attendance`، وتشترط `draw_scheduled_at`؛ كلمة quorum فيها أسماء أعمدة تاريخية في جدول `draws` فقط.
- الصلاحيات: `process_time_events` و`publish_association_event` و`compute_draw_readiness` غير قابلة للاستدعاء من `anon` و`authenticated`؛ الدوال العامة الجديدة قابلة للاستدعاء من `authenticated` فقط؛ `private.create_association` القديمة تُرجع خطأ إيقاف.
- لا توجد أي صلاحية INSERT/UPDATE/DELETE لـ `anon` أو `authenticated` على جداول `public` (الكتابة عبر RPC فقط) — أُغلق البند.
- مساري الانضمام (`approve_join_request` و`accept_legacy_invitation_by_id`) يستدعيان `assert_association_join_open` التي تفرض القفل بتاريخ البداية المحلي حسب `time_zone`.
- مستشارو الأمان: تنبيه INFO واحد (`private.time_event_runs` بلا سياسات RLS، وهو مقصود لأنه جدول داخلي لا يُقرأ إلا عبر الدوال). مستشارو الأداء: تنبيهات INFO لفهارس غير مستخدمة فقط (القاعدة فارغة).
- القاعدة ما زالت فارغة (0 جمعيات، 0 حسابات).

## المتبقي (مرتب)

### دفعة قاعدة البيانات
- [x] تطبيق الترحيلات الخمسة بالترتيب على القاعدة، والتحقق، وتحديث هذا السجل بالنتيجة.
- [x] مراجعة صلاحيات `authenticated` على جداول الأسهم والعضويات والجمعيات (إغلاق الكتابة المباشرة).
- [ ] اختبار سلوكي حي لدالة `perform_draw` و`process_time_events` (يلزم بيانات اختبار؛ يُنفَّذ ضمن اختبارات SQL المعزولة في المرحلة 6 لا على القاعدة الحية).

### المرحلة 1 — الإنشاء والقفل (الطبقات الأخرى)
- [ ] الواجهة: إزالة حقل المنطقة الزمنية والنصاب من نموذج الإنشاء ومن الـ payload (`Sahm_Preview_ROLE_SEPARATION.html`, `sahm-core.js`, `sahm-supabase-data.js`, `sahm-data.js`).
- [ ] الواجهة: عرض حالة القفل من تاريخ البداية المحلي.
- [ ] المحرك: توحيد حساب القسط الأخير في JavaScript (`splitAmount` في `sahm-core.js`) ليطابق SQL.
- [ ] الاختبارات: تحديث اختبارات Node وSQL (النصاب والقفل والتقريب) وتشغيلها.

### المراحل 2 إلى 6 (الطبقات الأخرى)
- [ ] المحرك ثم الواجهة ثم اختبارات Node وSQL ثم الاختبار الشامل والنشر (راجع `docs/SAHM_RESUME_DIRECTIVE.md` القسم 6).

## ملاحظات وتنبيهات

- الواجهة الحالية ما زالت ترسل `quorum` و`tz` في إنشاء الجمعية؛ الدالة تتجاهل `quorum` وتستعمل `Asia/Aden` عند غياب المنطقة الزمنية، فلا يتعطل الإنشاء إلى أن تُحدَّث الواجهة.
- الواجهة الحالية تقرأ `association_events` مباشرة للنشاط الأخير، وقد فقدت قراءتها للأعضاء (سياسة المدير فقط) إلى أن تُحوَّل إلى `get_association_news`.
- اختبارات SQL المحلية (`supabase-local-sql-tests.yml`) وNode لم تُشغَّل على تغييرات المراحل 1 إلى 5 بعد؛ بعض الاختبارات الحالية تتوقع النصاب والحضور وستحتاج تحديثًا.
- القاعدة الحية فارغة حاليًا (لا جمعيات ولا حسابات)، فلا توجد بيانات قائمة تتأثر.
