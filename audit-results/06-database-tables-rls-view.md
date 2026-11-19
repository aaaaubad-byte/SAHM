# المرحلة 06 — قاعدة البيانات: الجداول والقيود والفهارس وRLS والـView والصلاحيات

- المشروع: `SAHM` (`nusjnnrtpxbpphphmdsc`).
- طبيعة العمل: **استعلامات قراءة فقط** (`read_only: true`) على `pg_class` و`pg_attribute` و`pg_constraint` و`pg_indexes` و`pg_policies` و`pg_proc` و`pg_stat`. لا كتابة ولا DDL ولا migrations. لا مفاتيح ولا أسرار في هذا الملف.
- الحالة: **مكتملة لنطاقها** (الجداول، القيود، الفهارس، السياسات، الـView، صلاحيات الجداول). **خارج نطاقها ويُوثَّق في المرحلة 07:** تعريفات الدوال (بما فيها دوال RLS المساعدة `private.*`) والـTriggers وcron وRealtime والامتدادات.
- التصنيفات: CONFIRMED (نتيجة استعلام مباشر) / INFERRED / NOT VERIFIED.
- الأعداد الدقيقة للصفوف مأخوذة بـ `count(*)` (وليس إحصاءات `pg_stat`). وجود صفوف أو غيابها **لا يثبت** أن الميزة مستعملة أو معطلة، ولا أن البيانات تجريبية أو حقيقية (لم يُصنَّف أي شيء).

## 1. الملخص

| البند | القيمة | الحالة |
|---|---|---|
| جداول `public` | 24 (RLS مفعّل على الـ24، `FORCE` غير مفعّل) | CONFIRMED |
| View في `public` | 1 (`installment_obligation_status`، `security_invoker=true`) | CONFIRMED |
| جداول `private` | 2 (`association_public_links`، `time_event_runs`) | CONFIRMED |
| سياسات RLS | 32 على 24 جدولاً (لكل جدول سياسة واحدة على الأقل) | CONFIRMED |
| سياسات DELETE | **لا توجد**، ولا صلاحية DELETE لأي دور API | CONFIRMED |
| دوال `public` | 49: 48 INVOKER و1 DEFINER (`rls_auto_enable`) | CONFIRMED |
| دوال `private` | **67: 64 DEFINER و3 INVOKER** (لم تُحصَ في التقرير الأولي) | CONFIRMED (العدد فقط) |
| الدور `anon` | **لا أي صلاحية** على جداول `public` و`private` | CONFIRMED |

**نتيجة بنيوية (CONFIRMED في الشكل، INFERRED في الدلالة):** دوال `public` (48 INVOKER) غلاف رقيق، والمنطق الفعلي في `private.*` (64 DEFINER). كل الكتابة تقريباً تمر عبرها، لأن `authenticated` لا يملك صلاحية كتابة مباشرة إلا على ثلاثة جداول (§5). مضمون الدوال في المرحلة 07.

## 2. قاموس الجداول

الترميز: `NN` غير فارغ، `D=` قيمة افتراضية، `PK`، `FK→`، `UQ`. المعرفات `TBL-` **مقترحة** للسجل. «ص» = عدد الصفوف الدقيق.

### TBL-001 `profiles` (ص 2)
`id uuid NN` (PK، FK→`auth.users` CASCADE)، `full_name text NN` (طول 2–120 بعد القص)، `created_at`، `updated_at`، `avatar_key text NN D='avatar-01'` (CHECK: 12 قيمة `avatar-01..12`)، `profile_completed bool NN D=false`.

### TBL-002 `profile_private` (ص 2)
`user_id uuid NN` (PK، FK→`profiles` RESTRICT)، `phone_e164 text` (UQ، CHECK `^[+][1-9][0-9]{7,14}$`)، `city text`، `phone_verified_at timestamptz`، `created_at`، `updated_at`.

### TBL-003 `user_preferences` (ص 2)
`user_id` (PK، FK→`profiles`)، `notifications_enabled bool NN D=true`، `created_at`، `updated_at`.

### TBL-004 `legal_acceptances` (ص 2)
`user_id` + `terms_version text` (PK مركب، FK→`auth.users` CASCADE)، `accepted_at NN D=now()`.

### TBL-005 `associations` (ص 7)
`id` (PK)، `manager_user_id NN` (FK→`profiles`)، `name` (2–120)، `currency` (CHECK: `YER`/`SAR`/`USD`)، `start_date date NN`، `first_draw_on date NN`، `invite_opens_on`، `invite_closes_on`، `time_zone text NN`، `cycle_type` (`weekly`/`monthly`/`custom`)، `cycle_days int NN`، `share_amount_minor bigint NN`، `installments_count int NN`، `installment_mode text NN D='count'` (`count`/`amount`)، `installment_amount_minor bigint`، `target_shares int`، `max_shares_per_member int`، `manager_participates bool NN D=false`، **`quorum_percent int NN D=66`** (CHECK 1–100)، `rules text NN D=''`، `locked_at`، `locked_share_count`، `status NN D='active'` (`active`/`closed`)، `created_at`، `updated_at`.
- القيود: `installments_count ≤ cycle_days`؛ `max_shares_per_member ≤ target_shares`؛ أسبوعي=7 أيام وشهري=30 وخاص 1–3650؛ `invite_opens_on ≤ invite_closes_on`؛ `locked_at` و`locked_share_count` معاً أو لا شيء؛ نمط القسط: `count` ⇒ المبلغ NULL، و`amount` ⇒ المبلغ > 0.
- UQ: `(id, manager_user_id)`.

### TBL-006 `association_cycles` (ص 7)
`id`، `association_id NN` (FK)، `cycle_no int NN`، `starts_on`، `ends_on`، `duration_days` (CHECK = `ends_on − starts_on + 1`)، `currency`، `share_amount_minor`، `installments_count`، `installment_mode`، `installment_amount_minor`، `cycle_type`، `status NN D='scheduled'` (`scheduled`/`open`/`drawn`/`completed`/`failed`)، `draw_scheduled_at timestamptz`، `created_at`.
- UQ: `(association_id, cycle_no)`، `(id, association_id)`.
- ملاحظة: العملة والمبلغ ونمط القسط **مكررة** من `associations` إلى كل دورة (لقطة تاريخية؛ القصد غير موثق، INFERRED).

### TBL-007 `association_memberships` (ص 6)
`id`، `association_id`، `user_id` (FK→`profiles`)، `joined_at`، `status` (`active`/`left`)، `left_at`، `created_at`. CHECK: `active` ⇔ `left_at` NULL. UQ: `(association_id, user_id)`، `(id, association_id)`، `(id, association_id, user_id)`.

### TBL-008 `shares` (ص 19)
`id`، `association_id`، `membership_id` (FK مركب `(membership_id, association_id)`)، `share_no int NN`، `status` (`active`/`removed`)، `added_at`، `removed_at`. CHECK: `active` ⇔ `removed_at` NULL. UQ: `(association_id, share_no)`، `(id, association_id)`.

### TBL-009 `installment_periods` (ص 19)
`id`، `association_id`، `cycle_id` (FK مركب)، `installment_no`، `starts_on`، `ends_on`، `per_share_amount_minor`، `created_at`. UQ: `(cycle_id, installment_no)`، `(id, cycle_id, association_id)`.

### TBL-010 `installment_obligations` (ص 27)
`id`، `association_id`، `cycle_id`، `membership_id`، `period_id` (FK مركب إلى الدورة والعضوية والفترة)، `shares_count`، `amount_minor`، `currency`، `created_at`. UQ: `(membership_id, period_id)`، `(id, association_id)`، `(id, association_id, membership_id)`.

### TBL-011 `installment_receipts` (ص 3)
`id`، `association_id`، `obligation_id`، `membership_id`، `beneficiary_user_id`، `recorded_by_user_id`، `amount_minor`، `currency`، `recorded_at`، `self_recorded bool NN D=false`، `status NN D='active'` (`active`/`voided`).
- CHECK: `self_recorded = (recorded_by_user_id = beneficiary_user_id)`.
- فهرس فريد جزئي `installment_receipts_one_active_per_obligation (obligation_id) WHERE status='active'`.
- FK مركب `(membership_id, association_id, beneficiary_user_id)` يفرض أن المستفيد هو مستخدم العضوية نفسها.

### TBL-012 `receipt_corrections` (ص 0)
`id`، `association_id`، `receipt_id` (FK مركب)، `corrected_by_user_id`، `reason text NN` (CHECK طول ≥ 3)، `action text NN` (**CHECK `action = 'void'`**)، `before_snapshot jsonb NN`، `after_snapshot jsonb NN`، `corrected_at`.

### TBL-013 `reminders` (ص 2)
`id`، `association_id`، `obligation_id` (FK مركب)، `recipient_user_id`، `sent_by_user_id`، `batch_id uuid`، `sent_at`.

### TBL-014 `draws` (ص 0)
`id`، `association_id`، `cycle_id`، `round_no`، `scheduled_on`، `drawn_at`، `winner_share_id` (FK مركب)، `share_count_at_draw`، `eligible_count`، `prize_target_minor`، **`quorum_people int NN`**، **`quorum_required int NN`**، `algorithm_version text NN`.
- UQ: `(cycle_id)` (قرعة واحدة لكل دورة)، `(association_id, round_no)`، `(id, association_id)`، وفهرس فريد `draws_share_wins_once (winner_share_id)` (السهم يفوز مرة واحدة).

### TBL-015 `draw_eligible_shares` (ص 0)
`id`، `association_id`، `draw_id`، `share_id` (FK مركب لكليهما)، `captured_at`. UQ: `(draw_id, share_id)`.

### TBL-016 `cycle_attendance` (ص 0)
`id`، `association_id`، `cycle_id`، `membership_id`، **`present bool NN`**، `marked_by_user_id`، `marked_at`. UQ: `(cycle_id, membership_id)`.

### TBL-017 `invitations` (ص 4)
`id`، `association_id`، `created_by`، `invitee_name NN`، `invitee_phone_e164` (CHECK E.164)، `shares_requested` (> 0)، `token_hash text NN` (UQ)، **`status NN D='pending'`** (`pending`/`accepted`/`cancelled`/`expired`)، **`response_status NN D='pending_response'`** (`pending_response`/`interested`/`declined`/`deferred`/`legacy_accepted`/`expired`/`cancelled`)، `invited_user_id`، `created_at`، `expires_at`، `accepted_at`، `cancelled_at`، `responded_at`.

### TBL-018 `join_requests` (ص 2)
`id`، `association_id`، `applicant_user_id`، `applicant_name NN`، `invitation_id`، `public_link_id` (FK→`private.association_public_links`)، `source_type` (`invitation`/`public_link`)، `requested_shares`، `estimated_amount_minor`، `status` (`pending`/`approved`/`rejected`/`cancelled`)، `submitted_at`، `decided_at`، `decided_by_user_id`، `rejection_reason`، `membership_id`، `created_at`، `updated_at`.
- CHECK `source_shape`: `invitation` ⇒ `invitation_id` موجود و`public_link_id` NULL (والعكس).
- CHECK `decision_shape`: `pending` ⇒ لا قرار ولا عضوية؛ `approved` ⇒ قرار + قرر بواسطة + عضوية؛ `rejected`/`cancelled` ⇒ قرار بلا عضوية.
- فهارس فريدة جزئية: طلب `pending` واحد لكل `(association_id, applicant_user_id)`؛ وعضوية واحدة لكل طلب.

### TBL-019 `chat_messages` (ص 12)
`id`، `association_id`، `sender_user_id`، `kind` (`member`/`system`)، `body NN`، `system_type`، `event_id`، `created_at`. CHECK: رسالة `member` ⇒ مرسل موجود، `system_type` NULL، **طول `body` 1–50 حرفاً (`char_length`)**؛ رسالة `system` ⇒ بلا مرسل، `system_type` موجود، `body` غير فارغ.

### TBL-020 `chat_read_states` (ص 2)
`id`، `association_id`، `user_id`، `last_read_at`، `updated_at`. UQ: `(association_id, user_id)`.

### TBL-021 `notifications` (ص 18)
`id`، `user_id`، `association_id`، `type`، `title`، `body`، `related_entity_id`، `idempotency_key text NN` (UQ)، `created_at`، `read_at`.

### TBL-022 `association_notification_settings` (ص 7)
`association_id` (PK)، `enabled_types text[] NN`، `feed_enabled_types text[] NN`، `chat_enabled_types text[] NN`، `name_visible_types text[] NN D={drawResult}`، `updated_by_user_id`، `updated_at`. الافتراضي للأنواع الثلاثة الأولى هو الأنواع الثمانية: `received, completed, late, drawSoon, drawDue, drawResult, joined, motivate`.
- **CHECK `<@` مجموعة الأنواع الثمانية موجود على `feed_enabled_types` و`chat_enabled_types` و`name_visible_types` فقط. لا يوجد CHECK على `enabled_types`.**

### TBL-023 `association_user_preferences` (ص 0)
`id`، `association_id`، `user_id`، `mute_group bool D=false`، `mute_reminders bool D=false`، `updated_at`. UQ: `(association_id, user_id)`.

### TBL-024 `association_events` (ص 41)
`id`، `association_id`، `actor_user_id`، `event_type NN`، `entity_type NN`، `entity_id`، `visibility NN D='manager'` (`manager`/`member`/`all`)، `before_data jsonb`، `after_data jsonb`، `occurred_at`. UQ: `(id, association_id)`.

### جداول `private`
- **TBL-P01 `private.association_public_links` (ص 8):** `id`، `association_id`، `token_hash NN` (UQ)، `status NN D='active'` (`active`/`paused`/`revoked`/`expired`)، `created_by_user_id`، `created_at`، `expires_at`، `paused_at`، `revoked_at`، `rotated_at`. فهرس فريد جزئي: رابط `active` واحد لكل جمعية. **RLS غير مفعّل**، لكن لا أي صلاحية لـ`authenticated`/`anon` (الـACL للمالك فقط).
- **TBL-P02 `private.time_event_runs` (ص 700):** `id bigint` (تسلسل)، `started_at`، `finished_at`، `ok bool`، `summary jsonb`، `error text`. RLS مفعّل بلا سياسات، ولا صلاحيات لأدوار API. تُسجَّل فيها تشغيلات مهمة cron (مرة كل 10 دقائق).

### VW-001 `public.installment_obligation_status` (View)
مصدره: `installment_obligations` ⨝ `installment_periods` ⨝ `association_cycles` ⨝ `associations` ⟕ `installment_receipts` (`status='active'`). الأعمدة: معرفات الالتزام والجمعية والدورة والعضوية والفترة، `cycle_no`، `installment_no`، `starts_on`، `ends_on`، `shares_count`، `amount_minor`، `currency`، `receipt_id`، `paid_at`، **`status`**. الحالة تُحسب بـ `private.derive_installment_status(r.id IS NOT NULL, starts_on, ends_on, (now() AT TIME ZONE a.time_zone)::date)` أي **بمنطقة الجمعية الزمنية على الخادم**. `security_invoker=true` فتُطبَّق RLS للمستدعي. الصلاحية: `authenticated` يقرأ.
- مستهلك View في التطبيق: **لم يُتتبَّع بعد** (يحتاج بحثاً في الملفات؛ مرحلة المستهلكين).

## 3. العلاقات الأساسية

```
profiles ──< associations (manager) ──< association_cycles ──< installment_periods
profiles ──< association_memberships >── associations
association_memberships ──< shares
(cycle, membership, period) ──< installment_obligations ──< installment_receipts ──< receipt_corrections
installment_obligations ──< reminders
association_cycles ──1:1── draws ──< draw_eligible_shares >── shares ;  draws ──> shares (winner)
association_cycles ──< cycle_attendance >── association_memberships
associations ──< invitations ──< join_requests >── private.association_public_links
associations ──< chat_messages (event_id) >── association_events
```

**نمط العزل (CONFIRMED، إيجابي):** معظم المفاتيح الأجنبية بين الجداول الابنة مركّبة `(x_id, association_id)`، فيمنع Postgres نفسه ربط سجل بجمعية مختلفة. ON DELETE هو `RESTRICT` في كل مكان عدا `auth.users` (CASCADE لـ`profiles` و`legal_acceptances`).

## 4. الفهارس

الأعداد الكاملة مأخوذة من `pg_indexes`؛ هنا الخلاصة والملاحظات (التعريفات الكاملة قابلة للإعادة بالاستعلام نفسه).

- **تكرار حرفي (CONFIRMED):** `cycles_association_no_idx (association_id, cycle_no)` يطابق القيد الفريد `association_cycles_association_id_cycle_no_key`. و`draws_association_round_idx (association_id, round_no)` يطابق `draws_association_id_round_no_key`.
- **سابقة مغطاة (INFERRED):** `draw_eligible_draw_idx (draw_id)` مغطى ببادئة `draw_eligible_shares_draw_id_share_id_key`.
- **جدول بلا استعمال بشري وفيه ستة فهارس:** `cycle_attendance` (0 صفوف) فيه: `attendance_cycle_idx` و`cycle_attendance_cycle_association_idx` و`..._marker_idx` و`..._membership_association_idx` ومعهما الفريد والـPK.
- **فريد بلا مستهلك FK ظاهر:** `associations_id_manager_user_id_key (id, manager_user_id)` لا يشير إليه أي مفتاح أجنبي في `public` (قد يخدم Trigger؛ NOT VERIFIED حتى 07).
- فهارس FK موجودة لمعظم الأعمدة المرجعية. **التحقق الشامل من الأداء والفهارس الناقصة يُؤجَّل إلى `get_advisors`** (قراءة) في مرحلة الأمان والأداء.

## 5. الصلاحيات (ACL) — CONFIRMED

| الدور | الوضع |
|---|---|
| `anon` | لا شيء على أي جدول أو View في `public` و`private` |
| `authenticated` | `SELECT` فقط على كل جداول `public` والـView، **عدا**: `INSERT+SELECT+UPDATE` على `association_user_preferences` و`chat_read_states` و`user_preferences`؛ و`UPDATE` على أعمدة بعينها: `notifications.read_at` و`profile_private.city` و`profiles.full_name` |
| `service_role` | `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` فقط، **بلا SELECT/INSERT/UPDATE/DELETE** على جداول `public` |
| جداول `private` | المالك `postgres` فقط |
| View | `authenticated`: `SELECT`، وكذلك بتات `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` (لا معنى عملياً لـTRUNCATE على View؛ الأثر الأمني NOT VERIFIED) |

**استنتاجات:**
- الكتابة المباشرة من العميل تقتصر على: علامة القراءة في الدردشة (`chat_read_states`، ويتفق مع F-05-05 و`markChatRead`)، وتفضيلات الكتم، وتفضيل الإشعارات العام، وتعليم إشعار كمقروء، وتعديل الاسم والمدينة. كل ما عداه عبر RPC (INFERRED، يُثبَّت في 07).
- **`associations_manager_update` سياسة UPDATE بلا صلاحية UPDATE مقابلة** (لا على الجدول ولا على أعمدة) ⇒ لا أثر مباشر؛ التحديث يمر عبر RPC (`update_association`) (INFERRED).
- `service_role` بلا DML: أي مهمة تستخدم هذا الدور لتعديل البيانات ستفشل؛ المنطق المجدول يعمل بـDEFINER (INFERRED؛ 07).

## 6. سياسات RLS (32) — CONFIRMED

كل السياسات `PERMISSIVE` على الدور `authenticated`. الدوال المساعدة `private.can_view_association` و`private.is_association_manager` و`private.is_association_member` و`private.owns_membership` و`private.can_view_profile` **لم تُقرأ تعريفاتها بعد** (07)، فلا يُحكم على صحة السياسات قبلها. استدعاءات `auth.uid()` مغلَّفة بـ`(select auth.uid())` وهو النمط الصحيح للأداء.

| معرّف مقترح | الجدول / السياسة | الأمر | الشرط |
|---|---|---|---|
| POL-001 | `association_cycles` / `cycles_select` | SELECT | `can_view_association(association_id)` |
| POL-002 | `association_events` / `events_select` | SELECT | **مدير الجمعية فقط** |
| POL-003 | `association_memberships` / `memberships_select` | SELECT | `can_view_association` |
| POL-004 | `association_notification_settings` / `notification_settings_select` | SELECT | `can_view_association` |
| POL-005..007 | `association_user_preferences` / `association_prefs_insert|select|update` | INSERT/SELECT/UPDATE | صاحب الصف **و** (عضو أو مدير) |
| POL-008 | `associations` / `associations_manager_update` | UPDATE | `is_association_manager(id)` (بلا صلاحية، §5) |
| POL-009 | `associations` / `associations_select` | SELECT | `can_view_association(id)` |
| POL-010 | `chat_messages` / `chat_select` | SELECT | `can_view_association` |
| POL-011..013 | `chat_read_states` / `chat_read_insert|select|update` | INSERT/SELECT/UPDATE | صاحب الصف **و** `can_view_association` |
| POL-014 | `cycle_attendance` / `attendance_select` | SELECT | `can_view_association` |
| POL-015 | `draw_eligible_shares` / `draw_eligible_select` | SELECT | `can_view_association` |
| POL-016 | `draws` / `draws_select` | SELECT | `can_view_association` |
| POL-017 | `installment_obligations` / `obligations_select` | SELECT | مدير **أو** `owns_membership` |
| POL-018 | `installment_periods` / `periods_select` | SELECT | `can_view_association` |
| POL-019 | `installment_receipts` / `receipts_select` | SELECT | مدير **أو** `owns_membership` |
| POL-020 | `invitations` / `invitations_select_invitee_or_manager` | SELECT | `invited_user_id = uid` **أو** `invitee_phone_e164 =` هاتف المستخدم في `profile_private` **أو** مدير |
| POL-021 | `join_requests` / `join_requests_select_owner_or_manager` | SELECT | مقدّم الطلب أو مدير |
| POL-022 | `legal_acceptances` / `legal_acceptances_select_own` | SELECT | صاحب الصف |
| POL-023/024 | `notifications` / `notifications_select|update` | SELECT/UPDATE | صاحب الصف |
| POL-025/026 | `profile_private` / `profile_private_select|update` | SELECT/UPDATE | صاحب الصف |
| POL-027/028 | `profiles` / `profiles_select|update` | SELECT/UPDATE | الذات أو `can_view_profile(id)`؛ التحديث للذات |
| POL-029 | `receipt_corrections` / `corrections_manager_select` | SELECT | مدير |
| POL-030 | `reminders` / `reminders_manager_select` | SELECT | مدير |
| POL-031 | `shares` / `shares_select` | SELECT | `can_view_association` |
| POL-032 | `user_preferences` / `user_preferences_owner` | ALL | صاحب الصف |

## 5b. النتائج (F-06-)

### F-06-01 — حالة الدعوة في عمودين متداخلين — CONFIRMED
`invitations.status` (`pending/accepted/cancelled/expired`) و`invitations.response_status` (سبع قيم تشمل `cancelled` و`expired` و`legacy_accepted`). حالتا `cancelled` و`expired` موجودتان في العمودين معاً، أي أن الحقيقة في مكانين. الاتساق بينهما بيد الدوال/Triggers (07). مرتبط بمسار الدعوات «legacy» المذكور في التقرير الأولي.

### F-06-02 — بقايا الحضور والنصاب في البنية — CONFIRMED (الوجود)، الاستعمال NOT VERIFIED
- `cycle_attendance` (جدول كامل بـ6 فهارس وسياسة SELECT وFK مركبة، 0 صفوف) و`associations.quorum_percent` (NN، افتراضي 66، CHECK) و`draws.quorum_people` و`draws.quorum_required` (NN). لا دور في بنية الأعمدة يشير إلى أنها اختيارية: كل إدراج في `draws` **يجب** أن يزوّد قيمتي النصاب. لذلك أي إزالة مستقبلية تمس دالة القرعة التي تكتب `draws` (07).
- لا أي أثر لهذه الميزات في CSS (05b).

### F-06-03 — `enabled_types` بلا قيد صحة — CONFIRMED
ثلاثة أعمدة أنواع محمية بـCHECK (`ans_feed_types_valid`، `ans_chat_types_valid`، `ans_name_types_valid`) والرابع `enabled_types` بلا قيد. يقبل أي نص. وهو على الأرجح عمود الإعداد القديم الذي يقابله `set_association_notification_types` (INFERRED، 07).

### F-06-04 — قائمة الأنواع الثمانية مكررة في ثلاث طبقات — CONFIRMED
في الأعمدة الافتراضية (×4) وفي ثلاثة CHECK، وكذلك في ثابت العميل (`SahmApp.notifyTypes`). تغيير نوع إشعار يتطلب migration وتعديل العميل (ومرجع الدوال في 07).

### F-06-05 — قائمة العملات مكررة في أربعة قيود — CONFIRMED
`YER/SAR/USD` في CHECK على `associations` و`association_cycles` و`installment_obligations` و`installment_receipts`، وقد تتكرر في الدوال والعميل. إضافة عملة تعني أربعة قيود على الأقل.

### F-06-06 — حد الدردشة في الخادم = 50 حرفاً — CONFIRMED، يحسم جزءاً من F-05-06
CHECK يستعمل `char_length` (نقاط الكود). حد العميل الذي يقيسه `message.length` (وحدات UTF-16) أشد مع الإيموجي، بينما `SahmData.msgLength` تقيس نقاط الكود وتتطابق مع الخادم. (إن كانت `maxMessage` في العميل 50؛ لم يُتحقق من قيمتها هنا.)

### F-06-07 — ثغرات في مفاتيح التسلسل المركبة — CONFIRMED (غياب القيد)، الأثر NOT VERIFIED
`join_requests.membership_id → association_memberships(id)` و`join_requests.invitation_id → invitations(id)` و`join_requests.public_link_id → private.association_public_links(id)` مفاتيح أجنبية **بعمود واحد** بلا `association_id`، بخلاف نمط بقية الجداول، فلا يمنع Postgres ربط طلب بعضوية أو دعوة أو رابط من جمعية أخرى. كذلك `reminders.recipient_user_id` غير مربوط بمستخدم العضوية (على عكس `installment_receipts`). سلامتها حينئذ تعتمد على الدوال أو Triggers (07).

### F-06-08 — `time_zone` بلا قيد صحة والـView يعتمد عليه — CONFIRMED (غياب القيد)، الأثر NOT VERIFIED
`associations.time_zone text NN` بلا CHECK. الـView يستعمل `now() AT TIME ZONE a.time_zone` لكل صف، فاسم منطقة غير صالح قد يُفشل استعلام الـView كاملاً لكل المستخدمين الذين يمرون على ذلك الصف. هل تتحقق الدوال من الاسم؟ يُجاب في 07.

### F-06-09 — سياسة الدعوات تثق برقم الهاتف دون اشتراط التحقق — CONFIRMED (نص السياسة)، الأثر INFERRED
POL-020 تسمح بقراءة الدعوة إذا طابق `invitee_phone_e164` رقم المستخدم في `profile_private`، دون شرط `phone_verified_at IS NOT NULL`. والرقم فريد على مستوى الجدول (`UQ phone_e164`) لكنه غير مشروط بالتحقق. إن أمكن لمستخدم تسجيل رقم غيره دون تحقق (يتحدد في 07 بقراءة `complete_profile` وما يكتب الهاتف)، فيرى دعوات ذلك الرقم، بما فيها عمود `token_hash` (هاش لا رمز، وخطورته تتوقف على إنتروبيا الرمز: NOT VERIFIED). **بند أمني لمرحلة الأمان.**

### F-06-10 — عمود `visibility` في الأحداث لا تفرضه RLS — CONFIRMED
`association_events.visibility` يقبل `manager/member/all`، لكن POL-002 تحصر القراءة المباشرة في المدير. أي أن العضو لا يرى الأحداث إلا عبر RPC (مثل `get_news`)، وقيمتا `member` و`all` لا تعنيان شيئاً على مستوى RLS (فرضهما على الدالة، 07).

### F-06-11 — شفافية الأعضاء: كل عضو يرى القائمة والأسهم — CONFIRMED (السياسات)، القرار تجاري
`association_memberships` و`shares` و`draws` و`association_cycles` مقروءة لكل من يمرّ في `can_view_association`، و`profiles_select` تمرّ بـ`can_view_profile`. في المقابل الالتزامات والإيصالات مقيدة بالمدير وصاحب العضوية. أي أن العضو يرى من يملك أي سهم، ولا يرى مدفوعات غيره. **قاعدة أعمال تحتاج تأكيداً منك** قبل أن تُدرج في السجل (RULE) كما هي.

### F-06-12 — لا مسار حذف ولا سياسة DELETE — CONFIRMED
لا صلاحية DELETE ولا سياسة DELETE، وكل المفاتيح الأجنبية بـ`RESTRICT` عدا `auth.users`. حذف مستخدم له أي نشاط (جمعية، عضوية، إيصال، رسالة…) سيصطدم بالمفاتيح المقيِّدة على `profiles` (INFERRED). لا يوجد مسار موثق لحذف الحساب/البيانات الشخصية (مسألة امتثال تحتاج قراراً منك).

### F-06-13 — `time_event_runs` ينمو بلا تنظيف — CONFIRMED (الحجم)، INFERRED (غياب التنظيف)
700 صفاً وفق عد دقيق بعد نحو سبعة أيام من إنشاء المشروع، بمعدل مهمة واحدة كل 10 دقائق (~144 صفاً يومياً). في التقرير الأولي مهمة cron واحدة فقط، فلا مهمة تنظيف.

### F-06-14 — أرقام ملء الجداول — CONFIRMED
`draws` و`draw_eligible_shares` و`receipt_corrections` و`cycle_attendance` و`association_user_preferences` كلها **0 صفوف**؛ أي أن مسار القرعة وتصحيح الإيصال لا أثر لتنفيذهما في بيانات الإنتاج الحالية. هذا لا يثبت أنهما معطلان، ويعني أن سلوكهما الفعلي على قاعدة حقيقية لم يُلاحَظ في هذا الفحص.

### F-06-15 — حالات مفرطة النص — CONFIRMED
كل الحالات (`status`, `kind`, `cycle_type`...) أعمدة `text` مع `CHECK ... = ANY(ARRAY[...])` لا أنواع `enum`. الأثر: كل قيمة جديدة تتطلب تعديل قيد وكودين (دالة وعميل). قرار تصميم لا خطأ.

## 7. مصفوفة قواعد الأعمال المستخرجة من القيود (مرشحة لـ`RULE-`)

مؤكدة لأنها تنفذ في قاعدة البيانات (CONFIRMED):
1. العملات: `YER`/`SAR`/`USD` فقط.
2. الدورة: أسبوعي=7، شهري=30، مخصص 1–3650 يوماً؛ `installments_count ≤ cycle_days`.
3. نمط القسط: `count` ⇔ لا مبلغ، `amount` ⇒ مبلغ > 0.
4. الحد الأقصى للأسهم لكل عضو ≤ العدد المستهدف.
5. نافذة الدعوة: فتح ≤ إغلاق.
6. قفل الجمعية: التاريخ وعدد الأسهم المقفل معاً.
7. العضوية: `active` بلا `left_at`، `left` مع `left_at`؛ والسهم كذلك مع `removed_at`.
8. إيصال نشط واحد لكل التزام؛ `self_recorded` مشتق من المسجِّل والمستفيد؛ المستفيد هو مستخدم العضوية.
9. تصحيح الإيصال: الإجراء `void` فقط، والسبب ≥ 3 أحرف.
10. قرعة واحدة لكل دورة، ورقم جولة فريد لكل جمعية، وسهم يفوز مرة واحدة فقط.
11. طلب انضمام `pending` واحد لكل مستخدم في الجمعية؛ طلب ⇒ عضوية واحدة؛ شكل المصدر وشكل القرار.
12. رابط عام نشط واحد لكل جمعية.
13. الدردشة: رسالة عضو 1–50 حرفاً؛ رسالة نظام بلا مرسل.
14. الهاتف بصيغة E.164؛ الصورة الرمزية من 12 قيمة؛ الاسم 2–120.
15. أنواع الإشعارات من المجموعة الثمانية (للأعمدة الثلاثة).

غير مؤكدة (تُثبَّت بتعريفات الدوال في 07): كيف يحسب `installments_count`/المبلغ، وقواعد الأهلية للقرعة، ومن يستطيع تسجيل إيصال، وقواعد الاتفاق المقفل.

## 8. ما لم يُنجز بعد في نطاق «قاعدة البيانات»

- تعريفات الدوال (67 `private` + 49 `public`): التوقيعات، المعاملات، `SECURITY`، `search_path`، صلاحيات `EXECUTE`، الجداول المقروءة والمكتوبة، والمستهلكون في العميل.
- Triggers (12) وأثرها، ومهمة cron وكيف يتعامل العميل مع نتائجها، وإعدادات Realtime (منشور/جداول) مقارنة باشتراكات العميل.
- `get_advisors` (أمان وأداء) والامتدادات.
- تتبّع مستهلكي View `installment_obligation_status` في الملفات.

## 9. نقطة الاستئناف

التالي: المرحلة **07** (الدوال والـTriggers وcron وRealtime) بقراءة فقط، ثم الأمان والتكرار (التوائم المذكورة) والاختبارات والتقييم المعماري، ثم `05c`، ثم التقرير الشامل.
