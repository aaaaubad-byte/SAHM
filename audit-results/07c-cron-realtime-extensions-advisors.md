# المرحلة 07c — Cron وRealtime والامتدادات وتنبيهات المنصة (قراءة فقط)

- المرجع: `aaaaubad-byte/SAHM`، الفرع `SAHM-SUPABASE`، بعد التقرير `07b` (Commit `626355ac4fcc7e89f6e100d42ac23d9fdbcca77e`).
- قاعدة البيانات: مشروع `SAHM` المرجع `nusjnnrtpxbpphphmdsc` عبر موصل AMAN.Y. كل الاستعلامات `read_only=true` على الكتالوج و`cron.*` و`pg_stat_*` وجدول `private.time_event_runs` (سجل تشغيل داخلي لا بيانات مستخدمين). مع استدعاء `get_advisors` (قراءة).
- لم يُنفَّذ أي RPC ولا أي تعديل. التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.

## 1. Cron

### 1.1 المهام الفعلية (CONFIRMED)

| المهمة | الجدول | المستخدم | الأمر |
|---|---|---|---|
| `sahm-process-time-events` (jobid 1) | `*/10 * * * *` (كل 10 دقائق) | `postgres`، قاعدة `postgres` | `select private.process_time_events();` — نشطة |

**سجل التشغيل:** 702 تشغيلاً منذ `2026-11-15 01:40 UTC` حتى `2026-11-19 22:30 UTC`، **0 فشلاً** في `cron.job_run_details`. وفي `private.time_event_runs`: 703 صفاً، 0 غير ناجح، 0 غير منتهٍ، والمتوسط والأقصى ≈ 0 ملّي ثانية (القاعدة صغيرة).
`cron` و`vault`: لا `USAGE` لـ`anon` ولا `authenticated` (CONFIRMED).

### 1.2 ماذا تفعل `process_time_events` (CONFIRMED من الجسم الكامل)

تعمل لكل جمعية `status='active'` بتوقيت الجمعية، وكل جمعية في كتلة استثناء مستقلة (فشل جمعية لا يوقف الباقين):

1. **قسط متأخر:** إشعار شخصي لكل التزام انتهت فترته بلا إيصال نشط، بمفتاح `late:<obligation_id>` فيُرسَل **مرة واحدة فقط** للالتزام.
2. **اكتمال أقساط عضو في دورة:** إشعار بمفتاح `member-complete:<membership>:<cycle>`.
3. **اكتمال تحصيل الدورة:** حدث `cycle_collection_complete` منشور (خبر + رسالة نظام) مرة لكل دورة (فحص وجود الحدث)، يشترط `compute_draw_readiness(cycle_only)` = جاهزة.
4. **اقتراب القرعة وحلولها:** أحداث `draw_soon` و`draw_due` مرة لكل دورة (فحص وجود الحدث).
- **حماية التزامن:** `pg_try_advisory_xact_lock` يمنع تشغيلين متداخلين (يتجاوز التشغيل الثاني).
- **التنظيف:** تحذف من `time_event_runs` ما تجاوز 30 يوماً (CONFIRMED) فالنمو محدود (~4300 صف شهرياً).
- **لا تُجري القرعة:** القرعة تبقى إجراء يدوياً للمدير عبر `perform_draw` (CONFIRMED: لا استدعاء لها في Cron).

### 1.3 النتائج

**F-07c-01 — فشل الجمعية لا يُرى في حالة Cron (CONFIRMED الآلية):** الأخطاء تُلتقط داخل الدالة وتُكتب في `time_event_runs.ok/error`، بينما `cron.job_run_details.status` يبقى `succeeded`. أي أن لوحة فشل Cron **لن تُظهر** عطلاً في جمعية بعينها. لا تنبيه ولا مراقبة على `time_event_runs.ok=false` (MISSING). الحالي: 0 أخطاء.

**F-07c-02 — لا تنظيف لـ`cron.job_run_details` (INFERRED):** لا مهمة تنظيف (مهمة واحدة فقط). النمو ≈144 صفاً يومياً (~52 ألفاً سنوياً): أثر ضئيل، يُراقب.

**F-07c-03 — لا أرشفة ولا تنظيف للبيانات التراكمية (CONFIRMED غياب المهام، INFERRED الأثر):** `notifications` و`association_events` و`chat_messages` لا تُحذف ولا تُؤرشف (الأخيران `append-only` بالتصميم). والعميل يقرأ هذه الجداول **كاملة** في كل لقطة (F-03، 21 جدولاً بصفحات 500 صف). النمو سيزيد كلفة اللقطة مع الوقت. الأرقام الحالية صغيرة: `associations`=7، `association_memberships`=6، `shares`=19، `installment_receipts`=3، `association_events`=41، `chat_messages`=12، `notifications`=18، `draws`=**0**.

**F-07c-04 — لا قرعة نُفِّذت في القاعدة بعد (CONFIRMED من `draws=0`):** مسار `perform_draw` لم يُختبر ببيانات حقيقية، وكل ما يُعرف عنه قراءة ثابتة (07a/07b/07d). لا يعني ذلك أن الجدول غير مستخدم.

**F-07c-05 — تكاليف التوسع (INFERRED):** كل تشغيل يمر على كل جمعية نشطة بأربعة استعلامات، كل 10 دقائق، حتى للجمعيات التي لا تتغير. مقبول للحجم الحالي.

**F-07c-06 — إشعار «متأخر» لا يراعي `mute_group` ولا `mute_reminders` (INFERRED):** يحترم فقط `user_preferences.notifications_enabled`. بينما `send_installment_reminders` تحترم `mute_reminders`. قرار منتج.

## 2. Realtime

### 2.1 الاشتراكات المنشورة (CONFIRMED)

المنشور `supabase_realtime` (INSERT/UPDATE/DELETE): **أربعة جداول:** `chat_messages`، `invitations`، `join_requests`، `notifications`. (`supabase_realtime_messages_publication` يحوي أقسام `realtime.messages_*` لسبعة أيام: إدارة المنصة؛ لا يستعملها التطبيق، فهو يعتمد `postgres_changes` بحسب المرحلة 03.) `REPLICA IDENTITY DEFAULT` على الأربعة.

### 2.2 المطابقة مع العميل (من المرحلة 03)

| الجدول | اشتراك العميل | معالجة العميل |
|---|---|---|
| `chat_messages` | INSERT بلا مرشح (يحدد RLS ما يصل) | إضافة تزايدية بلا لقطة |
| `notifications` | INSERT وUPDATE مع `user_id=eq.<uid>` | تزايدية بلا لقطة |
| `join_requests` | `*` | لقطة كاملة (تأخير 100 ملّي ثانية) |
| `invitations` | `*` | لقطة كاملة |

**المطابقة تامة:** لا جدول منشور بلا مستهلك، ولا اشتراك على جدول غير منشور.

### 2.3 النتائج

**F-07c-07 — أحداث تغيّر البيانات المالية والقرعات لا تُبَث (CONFIRMED غياب النشر، INFERRED أثره في الواجهة):** جداول `installment_receipts`، `draws`، `association_memberships`، `shares`، `associations`، `association_cycles` غير منشورة. تسجيل قسط أو إجراء قرعة أو اعتماد عضو لا يصل لبقية المستخدمين إلا عبر **إشعار أو رسالة نظام** (تُعالَج تزايدياً بلا لقطة، 03)، فقد تبقى بيانات المدير أو العضو (حالة القسط، الفائز، قائمة الأعضاء) قديمة حتى أول تحديث لاحق (عملية أو حدث `join_requests`/`invitations` أو إعادة تحميل). أثر الواجهة الفعلي NOT VERIFIED وسيُحسم بمراجعة معالجات الإشعار في 05c.

**F-07c-08 — أحداث `DELETE` على `join_requests` و`invitations` (INFERRED، نظرياً):** معالجة العميل تتجاهل أحداث بلا `payload.new` (03)، وهي لا تُرشَّح بـRLS في Realtime وتحمل المفتاح الأساسي فقط (`REPLICA IDENTITY DEFAULT`). **لا دالة في القاعدة تحذف من هذين الجدولين** (CONFIRMED مسح `delete from`: الحذف الوحيد في `process_time_events` و`rebuild_open_association_obligations`)، فالمسألة نظرية.

**F-07c-09 — كلفة فحص RLS لكل رسالة (INFERRED):** `chat_messages` بلا مرشح اشتراك، فتفحص المنصة سياسة `can_view_association` (استعلامان) لكل مشترك مع كل رسالة. مقبول الآن، ويُراقب مع نمو عدد المستخدمين.

**F-07c-10 — تكرار التحديثات:** كل عملية تُنهي بلقطة كاملة (28 عملية، 03) وحدث `join_requests`/`invitations` يُطلق لقطة أخرى بعد 100 ملّي ثانية؛ والتداخل بلا تسلسل (F-03-D1). لا جديد من جهة القاعدة.

## 3. الامتدادات (CONFIRMED من `pg_extension`)

| الامتداد | الإصدار | المخطط | ملاحظة |
|---|---|---|---|
| `pg_cron` | 1.6.4 | `pg_catalog` | مهمة واحدة |
| `pgcrypto` | 1.3 | `extensions` | تستعمله `extensions.digest` لهاش الرموز |
| `uuid-ossp` | 1.1 | `extensions` | |
| `pg_stat_statements` | 1.11 | `extensions` | |
| `supabase_vault` | 0.3.2 | `vault` | لا `USAGE` لـanon/authenticated. محتوى الأسرار لم يُقرأ (NOT VERIFIED، ولا حاجة له) |
| `plpgsql` | 1.0 | `pg_catalog` | |

**لا `pg_net`** (لا استدعاءات HTTP من القاعدة)، **ولا `pg_graphql`** (توجد Event Triggers منصّة له لكن الامتداد غير مثبّت: لا واجهة GraphQL). كل الامتدادات في `extensions` (ليس `public`) عدا الافتراضيين.
**ملاحظة:** `anon` ينفّذ دالتين فقط في كل المخططات: `preview_public_join_link` في `private` و`public` (CONFIRMED).

## 4. تنبيهات المنصة `get_advisors` (CONFIRMED) وربطها بـSAHM

| التنبيه | المستوى | الأثر على SAHM |
|---|---|---|
| **`auth_leaked_password_protection`**: حماية كلمات المرور المسرّبة **معطّلة** | WARN | تسجيل بالبريد/كلمة المرور (03): يمكن لمستخدم اختيار كلمة مرور مسرّبة معروفة. يرفع خطر الاستيلاء على حسابات المدير ذات الأثر المالي. إعداد Auth، تفعيله خارج نطاق التدقيق. هذا **أول إعداد Auth مؤكد** نراه من الأداة |
| **`rls_enabled_no_policy`** على `private.time_event_runs` | INFO | **مقصود:** الجدول داخلي بلا أي منح لـanon/authenticated، فـRLS بلا سياسات تعني الرفض الكامل. لا أثر |
| **5× `unused_index`** (`receipt_corrections` ×2، `cycle_attendance`، `draw_eligible_shares`، `association_events_actor_idx`) | INFO | عدم الاستعمال بسبب حجم البيانات الصغير (القرعات 0، التصحيحات شبه معدومة). **لا يجوز الحكم بالإزالة**؛ فهي فهارس مفاتيح أجنبية لمسارات لم تُشغَّل بعد. `cycle_attendance` مرتبط بميزة موقوفة (DEPRECATED CANDIDATE للجدول لا للحذف) |

**نقطة مهمة (INFERRED):** لم يظهر تنبيه `authenticated_security_definer_function_executable` رغم أن دوال `private` من نوع DEFINER وقابلة للتنفيذ من `authenticated`. هذا المحلل يفحص المخططات **المكشوفة** في API، وغيابه يدل على أن **`private` غير مكشوف** (وهذا يخفف F-07a-10 من NOT VERIFIED إلى INFERRED-mitigated). لم أر إعداد المخططات المكشوفة مباشرة (BLOCKED).

## 5. ما لم يتحقق منه (NOT VERIFIED / BLOCKED)

1. إعدادات Auth الأخرى (تأكيد البريد، مدة الجلسة، تدوير رمز التجديد، تأكيد الهاتف): **BLOCKED** (لا أداة وصول). المعلوم فقط: حماية كلمات المرور المسرّبة معطلة.
2. المخططات المكشوفة وحدود المعدل و`statement_timeout`: **BLOCKED**.
3. أثر غياب بث الجداول المالية على الواجهة: يُحسم في 05c.
4. محتوى `vault`: لم يُقرأ ولا حاجة له.
5. **Render: BLOCKED** (لا أدوات وصول).

## 6. المهام المتبقية للمرحلة 07

- **07d:** القراءة الكاملة للدوال التي بقيت بمستوى الأسطر المفصلية (على رأسها `perform_draw`، `approve_join_request`، `update_association`) لإغلاق المرحلة 07.

## 7. القيود التي طُبّقت

لا تعديل. موصل AMAN.Y ومشروع SAHM والفرع `SAHM-SUPABASE` فقط. الملف الوحيد المضاف: هذا التقرير.

## 8. نقطة الاستئناف

التالي: **07d** ثم المرحلة 05c.
