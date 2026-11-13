# التصميم العلائقي لقاعدة بيانات سهم — Supabase

**الإصدار:** 1.0 — 13 نوفمبر 2026  
**الحالة:** تصميم قبل التنفيذ؛ لم تُطبق الجداول أو السياسات بعد.  
**المستودع/الفرع:** `aaaaubad-byte/SAHM` / `SAHM-SUPABASE`  
**المرجع الملزم:** `SAHM_Association_Creation_and_Installments_Reference_AR_v2.md`  
**المشروع المستهدف:** `SAHM` — `nusjnnrtpxbpphphmdsc`

## 1. مبادئ التصميم

1. قاعدة PostgreSQL هي مصدر الحقيقة الوحيد للجمعيات والعضويات والأسهم والأقساط والاستلام والقرعة والمحادثات والإشعارات.
2. `auth.users.id` هو الهوية الداخلية UUID. البريد الإلكتروني وكلمة المرور هما وسيلة الدخول. الهاتف معرف فريد في `profiles` بصيغة E.164، وليس وسيلة مصادقة أو إثبات ملكية.
3. لا تنقل بيانات المعاينة أو قيم `me` أو seed إلى قاعدة البيانات.
4. كل جمعية نطاق أمني مستقل. تربط القيود المركبة السجلات التابعة بالجمعية نفسها لمنع ربط سجل بكيان من جمعية أخرى.
5. المبالغ أعداد صحيحة بوحدات العملة الصغرى: YER = ريال، SAR = هللة، USD = سنت. لا تستخدم `float` أو `double precision`.
6. تحفظ اللحظات الزمنية في `timestamptz`، والتواريخ التشغيلية في `date`، والمنطقة الزمنية IANA في الجمعية.
7. لا تخزن حالة القسط المستقبلية بوصفها حالة مالية؛ تعرض «لم يحن موعده بعد» من مقارنة التاريخ. الحالة «مدفوع» مصدرها سجل استلام نشط، و«مستحق/متأخر» تحسب من فترة القسط والمنطقة الزمنية.
8. السجلات المالية ونتائج القرعة والتصحيحات والأحداث لا تحذف ماديًا. الإلغاء/التصحيح حدث جديد يحفظ الأصل.
9. لا توجد صلاحية إدارية عامة أو دور يختاره المستخدم؛ المدير هو `associations.manager_user_id` لكل جمعية.
10. لا حاجة إلى Storage حاليًا؛ V2 ألغى المرفقات وإثباتات التحويل. لا تُنشأ حاوية ما لم تظهر حاجة موثقة جديدة.

## 2. المخطط والجداول

كل المفاتيح الأساسية UUID مع `gen_random_uuid()`، عدا `profiles.id` الذي يساوي `auth.users.id`. جميع الجداول التالية في `public` ومفعّل عليها RLS. أسماء الأعمدة المقترحة إنجليزية ثابتة لتسهيل SQL وواجهات Supabase؛ تسميات الواجهة عربية.

### 2.1 الحسابات

**profiles**
- `id uuid PK FK auth.users(id) ON DELETE CASCADE`
- `full_name text NOT NULL`
- `phone_e164 text NOT NULL UNIQUE` — قيد تحقق `^\\+[1-9][0-9]{7,14}$`.
- `city text NULL`
- `phone_verified_at timestamptz NULL` — لا يُملأ في مرحلة التسجيل الحالية.
- `created_at, updated_at timestamptz NOT NULL`.

البريد لا يكرر هنا؛ مصدره `auth.users.email`. ينشأ الملف في trigger واحد داخل معاملة إنشاء Auth. تستقبل بيانات الاسم والهاتف والمدينة من بيانات التسجيل الوصفية لأغراض الملف فقط، ولا تستخدم أي metadata لتحديد صلاحيات.

### 2.2 الجمعية والعضوية والأسهم والدعوات

**associations**
- `id uuid PK`, `manager_user_id uuid FK profiles(id) ON DELETE RESTRICT`.
- `name text NOT NULL`, `currency text CHECK IN ('YER','SAR','USD')`.
- `start_date date NOT NULL`, `invite_opens_on date NULL`, `invite_closes_on date NULL`.
- `time_zone text NOT NULL` — اسم IANA.
- `cycle_type text CHECK IN ('weekly','monthly','custom')`, `cycle_days int NOT NULL`؛ قيد يفرض 7 للأسبوعي و30 للشهري و1..3650 للمخصص.
- `share_amount_minor bigint CHECK > 0`, `installments_count int CHECK BETWEEN 1 AND cycle_days`.
- `target_shares int CHECK > 0`, `max_shares_per_member int CHECK BETWEEN 1 AND target_shares`.
- `manager_participates boolean NOT NULL DEFAULT false`, `quorum_percent int CHECK BETWEEN 1 AND 100`, `rules text NOT NULL DEFAULT ''`.
- `locked_at timestamptz NULL`, `locked_share_count int NULL` — يثبتان ذريًا عند أول قرعة.
- `status text CHECK IN ('active','closed') DEFAULT 'active'`, `created_at, updated_at timestamptz`.

**association_memberships**
- `id uuid PK`, `association_id uuid FK associations ON DELETE RESTRICT`, `user_id uuid FK profiles ON DELETE RESTRICT`.
- `joined_at timestamptz NOT NULL`, `status text CHECK IN ('active','left') DEFAULT 'active'`, `left_at timestamptz NULL`.
- `UNIQUE(association_id,user_id)` و`UNIQUE(id,association_id)`.
- يمثل هذا الجدول المشاركين الفعليين. المدير الذي اختار «مدير فقط» لا ينشأ له سجل مشاركة أو سهم؛ وإذا شارك ينشأ له سجل عضوية وأسهم كأي مشارك. صفة المدير مصدرها الجمعية، لا حقلًا يكتبه المستخدم.

**shares**
- `id uuid PK`, `association_id uuid NOT NULL`, `membership_id uuid NOT NULL`, `share_no int NOT NULL`.
- `status text CHECK IN ('active','removed') DEFAULT 'active'`, `added_at timestamptz NOT NULL`, `removed_at timestamptz NULL`.
- FK مركب `(membership_id,association_id)` إلى العضوية، و`UNIQUE(association_id,share_no)`، و`UNIQUE(id,association_id)`.
- لا يعاد استخدام رقم سهم محذوف/مزال. لا يسمح بإضافة أو إزالة الأسهم بعد أول قرعة.

**invitations**
- `id uuid PK`, `association_id uuid FK associations`, `created_by uuid FK profiles`.
- `invitee_name text NOT NULL`, `invitee_phone_e164 text NULL`, `shares_requested int CHECK > 0`.
- `token_hash text NOT NULL UNIQUE` — يحفظ hash لرمز عشوائي قوي، لا الرمز الخام.
- `status text CHECK IN ('pending','accepted','cancelled','expired')`, `invited_user_id uuid NULL FK profiles`.
- `created_at, expires_at, accepted_at, cancelled_at timestamptz`.
- رقم الهاتف في الدعوة معلومة مساعدة فقط؛ لا يثبت ملكية الرقم ولا يمنح العضوية. قبول الدعوة يتطلب جلسة Auth صالحة ورمز دعوة سريًا، ثم ينفذ الخادم التحقق من الصلاحية وحد الأسهم.

### 2.3 دورات القرعة وخطط الأقساط والالتزامات

**association_cycles**
- `id uuid PK`, `association_id uuid NOT NULL FK associations`, `cycle_no int NOT NULL CHECK > 0`.
- `starts_on date NOT NULL`, `ends_on date NOT NULL` (شامل)، `duration_days int NOT NULL CHECK > 0`.
- نسخة تاريخية: `currency text`, `share_amount_minor bigint`, `installments_count int`, `cycle_type text`, `created_at timestamptz`.
- `status text CHECK IN ('scheduled','open','drawn','completed')`.
- `UNIQUE(association_id,cycle_no)`, و`UNIQUE(id,association_id)`.
- ينشأ سجل الدورة وخطتها عند بدء الدورة، مع نسخة الإعدادات المستخدمة فيها. أي تعديل إعدادات لا يعيد كتابة دورة بدأت أو أقساطها؛ يطبق على دورة مستقبلية فقط.

**installment_periods**
- `id uuid PK`, `cycle_id uuid NOT NULL FK association_cycles`, `installment_no int NOT NULL`.
- `starts_on date NOT NULL`, `ends_on date NOT NULL` (شامل)، `per_share_amount_minor bigint CHECK > 0`.
- `UNIQUE(cycle_id,installment_no)`, `CHECK(starts_on <= ends_on)`.
- يجب أن تغطي الفترات أيام الدورة كلها بالتتابع، دون فجوات أو تداخل، وأن يكون مجموع مبالغها مساويًا لحصة السهم للدورة.

**installment_obligations**
- `id uuid PK`, `association_id uuid NOT NULL`, `cycle_id uuid NOT NULL`, `membership_id uuid NOT NULL`, `period_id uuid NOT NULL`.
- `shares_count int NOT NULL CHECK > 0`, `amount_minor bigint NOT NULL CHECK > 0`, `currency text NOT NULL`, `created_at timestamptz`.
- FK مركبة تضمن أن الدورة والعضوية وفترة القسط تتبع الجمعية نفسها.
- `UNIQUE(membership_id,period_id)` لمنع إنشاء الالتزام مرتين.
- يحفظ `shares_count` والمبلغ وقت توليد الالتزام؛ لا يتغير التزام السهم الفائز بعد الفوز. تنشأ التزامات العضو المنضم متأخرًا للفترات التي انتهت قبله وفق V2، وتظهر متأخرة دون تحويلها إلى مدفوعة.

**installment_receipts**
- `id uuid PK`, `association_id uuid NOT NULL`, `obligation_id uuid NOT NULL`, `membership_id uuid NOT NULL`.
- `beneficiary_user_id uuid NOT NULL FK profiles`, `recorded_by_user_id uuid NOT NULL FK profiles`.
- `amount_minor bigint NOT NULL CHECK > 0`, `currency text NOT NULL`, `recorded_at timestamptz NOT NULL DEFAULT now()`.
- `self_recorded boolean NOT NULL`, `status text CHECK IN ('active','voided') DEFAULT 'active'`.
- FK مركبة لضمان تطابق الجمعية والالتزام والعضوية. فهرس فريد جزئي `UNIQUE(obligation_id) WHERE status='active'` يمنع أكثر من استلام نشط، ويسمح بتسجيل بديل بعد تصحيح/إبطال سابق مع بقاء الأصل.
- لا يملك المشارك إدخال هذا السجل أو تغيير حالته. المدير فقط، بما في ذلك تسجيل قسطه الشخصي مع `self_recorded=true`.

**receipt_corrections**
- `id uuid PK`, `receipt_id uuid NOT NULL FK installment_receipts ON DELETE RESTRICT`.
- `corrected_by_user_id uuid NOT NULL FK profiles`, `reason text NOT NULL`, `action text CHECK IN ('void')`.
- `before_snapshot jsonb NOT NULL`, `after_snapshot jsonb NOT NULL`, `corrected_at timestamptz NOT NULL DEFAULT now()`.
- سجل إضافي غير قابل للتعديل أو الحذف. لا يستبدل سجل الاستلام الأصلي ولا يمحو أثره.

### 2.4 الحضور والقرعة

**cycle_attendance**
- `id uuid PK`, `cycle_id uuid NOT NULL`, `membership_id uuid NOT NULL`.
- `present boolean NOT NULL`, `marked_by_user_id uuid NOT NULL FK profiles`, `marked_at timestamptz NOT NULL`.
- `UNIQUE(cycle_id,membership_id)`. الحضور يحسب بعدد الأشخاص ذوي العضوية، لا بعدد الأسهم.

**draws**
- `id uuid PK`, `association_id uuid NOT NULL`, `cycle_id uuid NOT NULL UNIQUE`, `round_no int NOT NULL`.
- `scheduled_on date NOT NULL`, `drawn_at timestamptz NOT NULL`, `winner_share_id uuid NOT NULL`.
- لقطات: `share_count_at_draw int`, `eligible_count int`, `prize_target_minor bigint`, `quorum_people int`, `quorum_required int`, `algorithm_version text`.
- `UNIQUE(association_id,round_no)`، FK مركب للسهم والجمعية، وفهرس فريد على `winner_share_id` لمنع فوز السهم نفسه مرتين.
- النتيجة واحدة فقط لكل دورة. لا يخزن ترتيب فائزين مسبقًا.

**draw_eligible_shares**
- `id uuid PK`, `draw_id uuid NOT NULL FK draws`, `share_id uuid NOT NULL FK shares`, `captured_at timestamptz`.
- `UNIQUE(draw_id,share_id)`. يحفظ مجموعة الأسهم المؤهلة التي دخلت القرعة فعليًا، لأغراض التدقيق. يستبعد السهم الفائز وحده من الجولات التالية.

### 2.5 المحادثة والإشعارات والتذكيرات والتدقيق

**chat_messages**
- `id uuid PK`, `association_id uuid NOT NULL FK associations`, `sender_user_id uuid NULL FK profiles`.
- `kind text CHECK IN ('member','system')`, `body text NOT NULL`, `system_type text NULL`, `event_id uuid NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.
- قيد يفرض رسالة العضو 1–50 حرفًا ووجود مرسل، ورسالة النظام بلا مرسل بشري وبنوع نظام محدد. لا تعديل أو حذف للرسائل بعد إرسالها.
- Realtime على الإدراج فقط، مع RLS العضوية.

**association_notification_settings**
- `association_id uuid PK FK associations`, `enabled_types text[] NOT NULL`, `updated_by_user_id uuid FK profiles`, `updated_at timestamptz`.
- المدير يحدد أنواع رسائل النظام المنشورة في المجموعة. لا يمنع تعطيل النوع تسجيل الحدث الداخلي.

**association_user_preferences**
- `id uuid PK`, `association_id uuid NOT NULL`, `user_id uuid NOT NULL FK profiles`.
- `mute_group boolean NOT NULL DEFAULT false`, `mute_reminders boolean NOT NULL DEFAULT false`, `updated_at timestamptz`.
- `UNIQUE(association_id,user_id)`. الكتم شخصي ولا يحذف الرسالة أو الحدث ولا يغير الحالة المالية.

**notifications**
- `id uuid PK`, `user_id uuid NOT NULL FK profiles`, `association_id uuid NULL FK associations`.
- `type text NOT NULL`, `title text NOT NULL`, `body text NOT NULL`, `related_entity_id uuid NULL`.
- `idempotency_key text NOT NULL UNIQUE`, `created_at timestamptz NOT NULL DEFAULT now()`, `read_at timestamptz NULL`.
- يقرأ المستخدم إشعاراته فقط. الكتم يضبط قرار التنبيه، لا حذف الإشعار المخزن.

**reminders**
- `id uuid PK`, `association_id uuid NOT NULL`, `obligation_id uuid NOT NULL`, `recipient_user_id uuid NOT NULL FK profiles`.
- `sent_by_user_id uuid NOT NULL FK profiles`, `sent_at timestamptz NOT NULL DEFAULT now()`, `batch_id uuid NULL`.
- لا يغير التذكير حالة القسط. تحفظ كل محاولة إرسال ومستلميها. لا تفرض قاعدة منع تكرار زمني قبل اعتماد سياسة التكرار من V2.

**association_events**
- `id uuid PK`, `association_id uuid NOT NULL FK associations`, `actor_user_id uuid NULL FK profiles`.
- `event_type text NOT NULL`, `entity_type text NOT NULL`, `entity_id uuid NULL`, `visibility text CHECK IN ('manager','member','all')`.
- `before_data jsonb NULL`, `after_data jsonb NULL`, `occurred_at timestamptz NOT NULL DEFAULT now()`.
- Append-only. يخزن أقل قدر لازم للتدقيق، ولا يعرض البيانات الإدارية/المالية الخاصة للمشاركين غير المعنيين.

## 3. العلاقات الأساسية

- `auth.users 1—1 profiles`.
- `profiles 1—N associations` عبر مدير الجمعية، و`profiles N—N associations` عبر `association_memberships`.
- `association 1—N memberships`; `membership 1—N shares`.
- `association 1—N invitations`.
- `association 1—N cycles 1—N installment_periods`.
- `membership N—N installment_periods` عبر `installment_obligations`، مع التزام واحد لكل عضوية وفترة.
- `obligation 1—N historical receipts` مع استلام نشط واحد كحد أقصى، و`receipt 1—N receipt_corrections`.
- `cycle 1—1 draw`; `draw N—N shares` عبر لقطة `draw_eligible_shares`; السهم الفائز فريد تاريخيًا.
- `cycle N—N memberships` عبر الحضور.
- `association 1—N chat_messages/events/reminders`; `profile 1—N notifications`.
- تفضيلات العضوية وإعدادات إشعارات الجمعية منفصلة.

## 4. القيود والفهارس المطلوبة

- فريد: الهاتف E.164، عضوية المستخدم داخل الجمعية، رقم السهم داخل الجمعية، رمز الدعوة المجزأ، رقم الدورة، رقم فترة القسط، التزام العضوية/الفترة، إشعار idempotency، تفضيل العضوية.
- فريد جزئي: استلام نشط واحد لكل التزام، وفوز واحد فقط لكل سهم.
- فهارس وصول: `associations(manager_user_id,status)`; `memberships(user_id,status,association_id)`; `shares(association_id,membership_id,status)`; `cycles(association_id,cycle_no)`; `obligations(association_id,cycle_id,membership_id)`; `receipts(association_id,recorded_at)`; `messages(association_id,created_at DESC)`; `notifications(user_id,read_at,created_at DESC)`; `events(association_id,occurred_at DESC)`; `reminders(obligation_id,sent_at DESC)`.
- قيود مركبة على `association_id` في المفاتيح الأجنبية التابعة تمنع ربط بيانات جمعية بسجل من جمعية أخرى.
- حذف الجمعية/العضوية/السهم أو الحساب لا يمحو سجلات مالية أو تدقيقية. الإجراء الطبيعي إغلاق الجمعية أو إنهاء العضوية/إزالة سهم قبل أول قرعة مع حفظ السجل.

## 5. مصفوفة الصلاحيات وRLS

| الكيان | المدير داخل جمعيته | المشارك داخل جمعيته | غير العضو / مستخدم آخر |
|---|---|---|---|
| الملف الشخصي | ملفه فقط | ملفه فقط | ملفه فقط |
| الجمعية وإعداداتها | قراءة وتعديل عبر RPC | قراءة | لا وصول |
| العضويات والأسهم | قراءة وإدارة عبر RPC | قراءة بيانات العضوية والأسهم المسموح بها | لا وصول |
| الدعوات | إدارة وقراءة | لا يقرأ قائمة الدعوات | لا وصول |
| الدورات وفترات الأقساط | قراءة كاملة | قراءة خطة الجمعية | لا وصول |
| الالتزامات | جميع التزامات الجمعية | التزامات عضويته فقط | لا وصول |
| الاستلام | جميع سجلات جمعيته وتسجيل/تصحيح عبر RPC | سجلاته هو فقط | لا وصول |
| التصحيحات | سجلات جمعيته | لا وصول إلى تفاصيل تصحيح غيره؛ لا تمنح صلاحية مالية | لا وصول |
| الحضور والقرعة | إدارة الحضور وتنفيذ القرعة عبر RPC | قراءة النتيجة وبيانات الحضور المسموحة | لا وصول |
| الرسائل | قراءة/إرسال | قراءة/إرسال | لا وصول |
| الإشعارات | إشعارات حسابه | إشعارات حسابه | إشعارات حسابه فقط |
| التذكيرات | إنشاء وقراءة | لا إنشاء ولا تغيير حالة | لا وصول |
| الأحداث | كل أحداث جمعيته | الأحداث المصنفة مرئية للأعضاء فقط | لا وصول |

تطبق السياسات على كل جدول في `public`. سياسات UPDATE تتضمن `USING` و`WITH CHECK`. لا يكفي `TO authenticated` وحده؛ كل سياسة تربط `auth.uid()` بملكية الملف أو عضوية الجمعية أو مديرها.

تكون القراءة المباشرة محدودة عبر RLS، بينما تمنع منح INSERT/UPDATE/DELETE المباشر على الجداول الحساسة. تنفذ الكتابات من RPC فقط. توضع دوال المساعدة الأمنية في مخطط `private` غير المكشوف، مع `SECURITY DEFINER` فقط عند الضرورة، و`SET search_path = ''`، ومراجع مؤهلة بالكامل، وفحص صريح لـ `auth.uid()`، وسحب EXECUTE من `PUBLIC/anon` ومنح ما يلزم لـ `authenticated` فقط. لا تستخدم `user_metadata` لتحديد الدور.

## 6. عمليات RPC والمعاملات الذرية

| RPC مقترح | المسؤولية والتحقق |
|---|---|
| `create_association` | إنشاء الجمعية والمدير وإعدادات إشعاراتها ودورة البداية وخطتها في معاملة واحدة. |
| `update_association_settings` | المدير فقط؛ لا يعيد كتابة دورة بدأت أو التزاماتها، ويطبق الإعداد على دورة مستقبلية. |
| `create_invitation` / `cancel_invitation` | المدير فقط؛ التحقق من قفل الجمعية والحدود وتخزين hash الرمز. |
| `accept_invitation` | جلسة Auth ورمز دعوة صالح؛ لا تعتمد مطابقة هاتف غير موثق كإثبات ملكية. تنشئ العضوية والأسهم والالتزامات المتأخرة اللازمة ذريًا. |
| `add_shares` / `remove_shares` | المدير فقط وقبل أول قرعة؛ تحقق من حدود الفرد والعدد المستهدف، مع حفظ الأثر. |
| `set_cycle_attendance` | المدير فقط؛ سجل حضور واحد لكل شخص ودورة. |
| `record_installment_receipt` | المدير فقط؛ يتحقق من الالتزام والجمعية والمبلغ والعملة، ويمنع التكرار بقيد الاستلام النشط. يسجل self-record عند تطابق المدير والمستفيد. |
| `correct_installment_receipt` | المدير فقط؛ يقفل السجل، يحفظ snapshot قبل/بعد والسبب والفاعل، ويحوّل السجل إلى voided دون حذفه. |
| `perform_draw` | المدير فقط؛ يقفل صف الجمعية `FOR UPDATE`، يتحقق من الموعد والنصاب وعدم وجود نتيجة، يجمع الأسهم المؤهلة التي لم تفز، يحفظ snapshot المرشحين، يختار سهمًا واحدًا، ويثبت draw/event/notification في المعاملة نفسها. |
| `send_reminder` | المدير فقط؛ ينشئ سجلًا لكل مستلم مؤهل ولا يغير الالتزام. |
| `send_chat_message` | عضو نشط فقط؛ حد 50 حرفًا؛ يسجل الرسالة والحدث والإشعار عند الحاجة في معاملة واحدة. |
| `set_notification_settings` | المدير يضبط أنواع النشر للجمعية. |
| `set_user_association_preferences` | المستخدم يضبط كتمه الشخصي فقط. |
| `mark_notifications_read` / `mark_chat_read` | المستخدم يحدث مؤشرات القراءة الخاصة به فقط. |

### منع السباق والتكرار

- `perform_draw`: قفل صف الجمعية أو قفل advisory داخل المعاملة، مع `UNIQUE(association_id,cycle_id)` و`UNIQUE(winner_share_id)`. طلبان متزامنان للدورة نفسها لا ينتجان نتيجتين.
- الاستلام: `UNIQUE` جزئي على الالتزام حيث السجل نشط، مع قفل الالتزام عند التسجيل والتصحيح.
- العضوية والدعوة: قيود unique على (الجمعية، المستخدم) وعلى token hash، مع قفل الجمعية أثناء تخصيص الأسهم.
- جميع آثار العملية (سجل الحدث والإشعار والنتيجة/الاستلام) تحفظ داخل المعاملة ذاتها؛ فشل أي خطوة يعيد كل التغييرات.
- اختيار الفائز يستخدم عشوائية تشفيرية من `pgcrypto.gen_random_bytes` مع اختيار موحد غير متحيز، ولا يعتمد ترتيبًا محفوظًا مسبقًا أو `Math.random()` في المتصفح.

## 7. المصادقة وإنشاء الملف

- التسجيل: `auth.signUp({ email, password, options: { data: { full_name, phone, city } } })`.
- قبل إنشاء الملف، تطبع الواجهة الأرقام العربية والهندية وتزيل فواصل العرض، ثم تشترط رقمًا دوليًا يبدأ بـ +؛ لا تخمّن رمز الدولة عند غيابه.
- trigger بعد INSERT على `auth.users` يستدعي `private.handle_new_user()` وينشئ `profiles` ضمن المعاملة نفسها. فشل تحقق الهاتف أو تعارض UNIQUE يفشل إنشاء Auth كله، فلا يبقى حساب بلا ملف.
- لا توجد SMS أو phone OTP أو phone sign-in في هذه المرحلة. الهاتف غير موثق، ولا يمنح صلاحية أو إثبات ملكية.
- الدخول: `signInWithPassword({ email, password })`. استعادة كلمة المرور: `resetPasswordForEmail(email, { redirectTo })`.
- لا يتوقف التطبيق على شاشة تحقق بريد عند تعطيل Confirm Email من لوحة Supabase؛ يتعامل مع session إن أعادها Auth، ويعرض حالة انتظار فقط إذا كانت إعدادات المالك تتطلبها.
- الأدوار لا تحفظ في `user_metadata` أو `app_metadata`؛ مدير الجمعية يستنتج من `associations.manager_user_id`، والمشارك من العضوية.

## 8. Realtime وStorage

- Realtime مطلوب لقائمة رسائل الجمعية الحية وتحديث الرسائل الجديدة. تظل قراءة التاريخ من قاعدة البيانات، والاشتراك لا يتجاوز RLS. لا يُستخدم Realtime لإرسال عمليات مالية أو قرعة.
- إشعارات داخل التطبيق تحفظ في `notifications`; Push والإرسال المجدول ليسا ضمن افتراضات هذا المخطط حتى يثبت احتياجهما.
- لا Storage في الإصدار الحالي لعدم وجود صور أو مرفقات أو إيصالات تحويل في V2.

## 9. سياسة الحذف والتحديث

- Auth user: حذف Auth يزيل ملفه عبر FK، لكن وجود عضوية أو إدارة جمعية أو سجل مرتبط يمنع الحذف بسبب قيود RESTRICT؛ معالجة حذف الحساب مستقبلًا تكون إجراء إغلاق/إخفاء متوافقًا مع الاحتفاظ بالسجلات.
- Association: لا حذف مادي بعد وجود سجلات؛ يستخدم `status='closed'`.
- Membership/share: الإنهاء/الإزالة حالة موثقة لا حذف مادي؛ إزالة الأسهم ممنوعة بعد أول قرعة.
- Receipts/draws/messages/events/corrections: لا حذف ولا تعديل تاريخي؛ التصحيح حدث جديد.
- Notifications/preferences: يمكن تحديث read/mute، ولا يحذف كتم الإشعار السجل الأصلي.

## 10. قرارات غير محسومة — لا تُخترع

1. **تجاوز النصاب:** V2 لا يعتمد تجاوزًا إداريًا صريحًا؛ لا تنفذ RPC خيار override قبل قرار مالك المشروع.
2. **السداد المسبق لقسط مستقبلي:** غير محسوم صراحة؛ التصميم يسمح بحفظ فترة القسط، لكن لا يقرر قبول/رفض الدفع قبل بدايتها حتى يعتمد القرار.
3. **تغيير إعدادات الجمعية بعد بدء الدورات:** تحفظ نسخة كل دورة؛ تطبيق التعديل على دورة مستقبلية فقط. يلزم اعتماد تفاصيل توقيت سريان الإعداد إذا تغير قبل بداية الدورة الأولى.
4. **سياسة إعادة تسجيل استلام بعد التصحيح:** يسمح بقيد استلام نشط واحد؛ السجل الملغى يبقى محفوظًا ويمكن إنشاء سجل بديل جديد بعد التصحيح. يجب أن تعرض الواجهة السجلين وتسلسل التصحيح.
5. **تنبيه Push/التذكير المجدول:** لا يضاف مزود Push أو Cron قبل اعتماد الحاجة وسياسة الإرسال.

## 11. خطة التحقق قبل تطبيق التصميم

- اختبار القيود الفريدة والمفاتيح المركبة وتطابق الجمعية.
- اختبار trigger إنشاء الملف: نجاح التسجيل، رقم غير صالح، هاتف مكرر، rollback كامل.
- اختبار RLS بثلاث هويات: مدير، مشارك، غير عضو، مع تغيير UUID يدويًا.
- اختبار التسجيل/الدخول/استعادة الجلسة/استعادة كلمة المرور في المتصفح.
- اختبار استلام متزامن لنفس الالتزام، وتصحيح الاستلام، والتسجيل الذاتي.
- اختبار قرعة متزامنة لنفس الدورة، واستبعاد السهم الفائز فقط، واستمرار الالتزامات.
- اختبار Realtime لمحادثة عضوين ومنع غير العضو من الاستماع أو القراءة.
- تشغيل Security Advisors بعد كل دفعة DDL/RPC، ومعالجة جميع التحذيرات ذات الصلة.

**حالة التنفيذ:** وثيقة تصميم فقط. لم يتم إنشاء أي جدول أو RPC أو سياسة أو مستخدم تجريبي في مشروع Supabase عند اعتماد هذه الوثيقة.
