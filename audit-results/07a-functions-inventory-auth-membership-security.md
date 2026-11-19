# المرحلة 07a — جرد الدوال الـ116 وتدقيق المصادقة والصلاحيات والعضويات (قراءة فقط)

- المرجع: المستودع `aaaaubad-byte/SAHM`، الفرع `SAHM-SUPABASE`، آخر Commit تدقيق سابق `65b165e8440faebad648e2c96e03b87750429300` (المرحلة 06). آخر Commit بعده هو ختم PWA من CI (`c211ab05…`)، وليس تغييراً تطبيقياً.
- قاعدة البيانات: مشروع `SAHM` المرجع `nusjnnrtpxbpphphmdsc`، ACTIVE_HEALTHY، PostgreSQL 17.11، ap-northeast-1، عبر موصل **AMAN.Y** (يُرجع هذا المشروع وحده). موصل Supabase الآخر **BLOCKED** (يرفض الصلاحية؛ مربوط بمنظمة أخرى ولا يرى SAHM).
- الطبيعة: **قراءة فقط**. كل الاستعلامات `read_only=true` على الكتالوج (`pg_proc`, `pg_trigger`, `pg_indexes`, `pg_class`, `cron.job`). لم يُقرأ أي صف من جداول التطبيق، ولا نُفّذ أي استدعاء RPC، ولا تعديل على قاعدة البيانات أو التطبيق.
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.

## 1. مستوى الأدلة لكل دالة (مهم لقراءة الجرد)

| الرمز | المعنى |
|---|---|
| **B** | قُرئ نص الدالة كاملاً من `prosrc` |
| **K** | قُرئت الأسطر المفصلية فقط (تحقق الهوية، الصلاحية، الأقفال، الأخطاء، الكتابات الرئيسية) |
| **H** | مسح نصي آلي فقط (يستخدم `auth.uid()`؟ يستدعي دوال الصلاحية؟ `FOR UPDATE`؟ كتابة؟). **ليس دليلاً على سلامة المنطق** |

أي استنتاج في الجرد من مستوى H هو INFERRED على الأكثر.

## 2. الأعداد الفعلية (CONFIRMED)

| البند | الفعلي | التقرير السابق |
|---|---|---|
| دوال `public` | 49 | 49 ✔ |
| دوال `private` | 67 | 67 ✔ |
| SECURITY DEFINER | 64 في private، و1 في public (`rls_auto_enable`) | — |
| Triggers (غير داخلية، كل المخططات) | **25** | 12 |
| Event Triggers | 7 (واحد مخصص: `ensure_rls` ← `rls_auto_enable`) | — |
| سياسات RLS | 34 | — |
| مهام Cron | 1 | — |

**تفكيك الـ25 Trigger (CONFIRMED):** `public` = 11، `auth.users` = 1، `cron.job` = 1، `realtime.subscription` = 1، `storage` = 11 (9 على buckets و2 على objects). الأربعة عشر خارج `public` مملوكة للمنصة عدا `auth.users` (`sahm_on_auth_user_created`).
**الفرق عن «12»:** INFERRED أنها 11 في `public` + Trigger `auth.users` (12 تخص SAHM). لا فرق حقيقي في تعريفات SAHM.

**تركيب الـ116 دالة:** 46 زوجاً (غلاف `public` INVOKER + تنفيذ `private` DEFINER) = 92، و15 مساعدة داخلية في `private`، و6 دوال Trigger في `private`، ودالتان بمنطق كامل في `public` فقط، ودالة Event Trigger واحدة = 116 ✔.

## 3. الهندسة العامة (CONFIRMED من الكتالوج)

1. **طبقتان:** كل RPC يستدعيه التطبيق غلاف SQL في `public` بنمط `SELECT private.<name>(...)` (INVOKER)، والمنطق في `private` (DEFINER).
2. **`search_path` فارغ** (`""`) على كل دوال الطبقتين، عدا `rls_auto_enable` (`pg_catalog`). تعريفات DEFINER كلها مؤهلة بأسماء المخططات في الأجسام المقروءة.
3. **صلاحيات EXECUTE:** لا شيء ممنوح لـ`PUBLIC`. `anon` لديه EXECUTE على **دالتين فقط:** `public.preview_public_join_link` و`private.preview_public_join_link`. `authenticated` لديه EXECUTE على كل الدوال المستدعاة من العميل، وعلى `private.*` المقابلة (انظر F-07a-10).
4. **نموذج المدير:** مدير واحد لكل جمعية: `associations.manager_user_id = auth.uid()`. لا جدول أدوار.
5. **اشتقاق الجمعية من الكيان، لا من مدخلات المستدعي:** في الدوال المقروءة، الجمعية تُستخرج من الالتزام/الإيصال/الطلب/العضوية ثم يُفحص المدير عليها. لم أجد في الدوال المقروءة مساراً يثق بـ`association_id` من المستدعي دون ربطه بالكيان.
6. **التزامن:** أقفال `FOR UPDATE` على صف الجمعية (أو الكيان) في الإضافة/الإزالة/القرعة/الاعتماد/تسجيل الإيصال، مدعومة بفهارس فريدة (F-07a-04).

## 4. جرد الدوال (116) حسب المجموعات

الأعمدة: **W** = الغلاف `public` (INVOKER، EXECUTE لـ`authenticated` ما لم يُذكر)، **P** = تنفيذ `private` (DEFINER ما لم يُذكر)، **C** = ضمن الـ43 RPC التي يستدعيها `sahm-supabase*.js` بحسب المرحلة 03 (مستهلكو HTML وmanaged-group: NOT VERIFIED في هذه الدفعة). **G** = أدلة التحقق (هوية `U`، مدير `M`، عضو `E`، قفل `L`، حراسة `A`، كتابة `W`).

### A. المصادقة والملفات الشخصية

| الدالة | مخرجات | الأدلة | C |
|---|---|---|---|
| `complete_my_profile(p_full_name, p_phone_e164, p_avatar_key)` W+P | jsonb | **B** — U، يشترط `legal_acceptances` للنسخة `2026-11-14`، اسم ≥3 مقاطع، `normalize_phone_e164`، يكتب `profiles` و`profile_private`، تعارض الهاتف ← 23505 | ✔ |
| `update_my_profile(p_full_name, p_city)` W+P | boolean | **H** — U، كتابة، لا تلمس الهاتف (التوقيع) | ✔ |
| `private.handle_new_user()` trigger | trigger | **B** — على `auth.users` AFTER INSERT؛ ينشئ `profiles` و`profile_private` و`user_preferences`، ويسجل `legal_acceptances` من `raw_user_meta_data` | — |
| `private.can_view_profile(p_uid)` | boolean | **B** — الذات، أو مدير↔عضو نشط، أو عضوان نشطان بجمعية مشتركة | (RLS) |
| `private.normalize_phone_e164(p_phone)` INVOKER | text | **B** — أرقام عربية/فارسية ← لاتينية، E.164 بين 8 و15 رقماً | — |

### B. الجمعيات والأعضاء والدعوات وطلبات الانضمام والأسهم

| الدالة | الأدلة | C |
|---|---|---|
| `create_association(p_payload)` W+P | **B** — **تُطلق دائماً الخطأ 0A000** («تم إيقاف هذا المسار») | ✘ |
| `create_association_unified(p_payload)` W+P | **H** — U، كتابة (7.5KB)؛ لم يُقرأ منطقها | ✔ |
| `update_association(p_association_id, p_payload)` W+P | **K** — مدير+`status='active'`، `FOR UPDATE`، حراسة بعد القرعات/الإيصالات | ✔ |
| `manage_association_public_link(p_association_id, p_action)` W+P | **K** — مدير، `FOR UPDATE`، إجراءات create/rotate/pause/resume/revoke، الرمز = SHA-256 لمعرفين عشوائيين، يخزّن الهاش فقط، يُرجع الرمز مرة واحدة | ✔ |
| `get_association_public_link_status(p_association_id)` W+P | **K** — مدير | ✔ |
| `preview_public_join_link(p_token)` W+P، **anon** | **B** — طول الرمز ≥40، بحث بالهاش، `assert_association_join_open`، يُرجع بيانات الجمعية واسم المدير | ✔ |
| `create_invitation(p_association_id, p_name, p_phone)` W+P | **K** — مدير، `FOR UPDATE`، حراسة | ✔ (اسماً) |
| `create_invitation(…, p_shares)` W+P — **غير قابل للتنفيذ من authenticated** | **K** | ✘ — DEPRECATED CANDIDATE |
| `create_invitations_bulk(p_association_id, p_invitees)` W+P | **K** — مدير، `FOR UPDATE`، حراسة | ✔ |
| `cancel_invitation(p_invitation_id)` W+P | **K** — مدير الجمعية المشتقة من الدعوة | ✔ |
| `preview_invitation(p_token)` W+P (STABLE) | **K** — U، بحث بالهاش، `invited_user_id` فارغ أو = المستدعي | ✔ |
| `accept_invitation(p_token)` W+P | **K** — U، بحث بالهاش، `FOR UPDATE`، يمنع عضوية مكررة | ✔ |
| `respond_to_invitation(p_invitation_id, p_action)` W+P | **K** — U، `FOR UPDATE`؛ فحص `invited_user_id <> v_uid` فقط حين يكون غير فارغ | ✔ |
| `list_my_invitations()` / `get_my_invitation_inbox()` / `get_my_invitation_details(p_invitation_id)` W+P | **K/H** — U، التفاصيل: `invited_user_id` أو مطابقة هاتف الملف الشخصي | ✔ |
| `accept_legacy_invitation_by_id(p_invitation_id)` W+P | **K** — U، `FOR UPDATE`، مطابقة `invited_user_id` **أو الهاتف**، يكتب عضوية | ✔ |
| `submit_join_request(p_source_type, p_token, p_requested_shares)` W+P | **K** — U، بحث بالهاش، حراسة، `FOR UPDATE` | ✔ |
| `submit_join_request_by_invitation(p_invitation_id, p_requested_shares)` W+P | **K** — U، `invited_user_id = v_uid` | ✔ |
| `cancel_join_request(p_request_id)` W+P | **K** — صاحب الطلب فقط | ✔ |
| `approve_join_request(p_request_id)` W+P | **K** — مدير، `FOR UPDATE OF a`، يتحقق أن الطلب معلق، نافذة الانضمام، لا عضوية سابقة، صلاحية الدعوة الأصلية، `ON CONFLICT` على الالتزامات | ✔ |
| `reject_join_request(p_request_id, p_reason)` W+P | **K** — مدير | ✔ |
| `add_shares(p_membership_id, p_count)` / `remove_shares(…)` / `remove_member(p_membership_id)` W+P | **K** — مدير+جمعية نشطة، قفل صف الجمعية والعضوية، `assert_association_agreement_open` وحراسة السجل المالي، `remove_member` يمنع إزالة المدير | ✔ |
| `get_association_shares(p_association_id)` — **`public` فقط** (plpgsql INVOKER، STABLE) | **B** — مدير، يعتمد RLS على الجداول | ✔ |
| `get_my_association_shares(p_association_id)` — **`public` فقط** | **B** — عضو نشط، يعتمد RLS | ✔ |
| `private.is_association_manager(p_id)` / `is_association_member(p_id)` / `owns_membership(p_mid, p_aid)` | **B** — بـ`(SELECT auth.uid())`، DEFINER، STABLE | (RLS) |
| `private.can_view_association(p_id)` / `can_view_event(p_aid, p_visibility)` | **B** — مدير أو عضو؛ الأحداث: العضو يرى `member` و`all` فقط | (RLS) |
| `private.assert_association_join_open(p_association_id)` | **B** — نشطة وغير مقفلة، نافذة `invite_opens_on`/`invite_closes_on`، تُغلق عند `start_date` بتوقيت الجمعية | — |
| `private.assert_association_agreement_open(p_association_id)` | **B** — تُغلق عند `start_date` (توقيت الجمعية) | — |
| `private.assert_association_pre_financial(p_association_id)` | **B** — تمنع التغيير بعد وجود إيصالات أو تذكيرات أو قرعات | — |

### C. الأسهم والأقساط والإيصالات والتحصيل

| الدالة | الأدلة | C |
|---|---|---|
| `record_installment_receipt(p_obligation_id)` W+P | **B** — U، `FOR UPDATE` على الالتزام ثم الجمعية (مدير)، المبلغ والعملة من الالتزام لا من المدخل، يكتب إيصالاً + حدثاً + إشعاراً بمفتاح تفرّد | ✔ |
| `correct_installment_receipt(p_receipt_id, p_reason)` W+P | **K** — U، `FOR UPDATE`، مدير الجمعية المشتقة من الإيصال، السبب ≥3 أحرف، يحوّل `active ← voided` فقط | ✔ |
| `send_installment_reminders(p_cycle_id, p_installment_no, p_membership_id)` W+P | **B** — غلاف يستدعي نسخة الأربع معاملات مع `false` | ✘ (يُستدعى بالأربع) |
| `send_installment_reminders(…, p_confirm_repeat)` W+P | **B** — U، مدير، يمنع التكرار خلال 6 ساعات بالخطأ `RPT01` ما لم يُؤكَّد، يحترم كتم الجمعية وإعدادات المستخدم | ✔ |
| `get_association_financial_summary(p_association_id)` W+P | **K** — مدير فقط | ✔ |
| `private.derive_installment_status(p_paid, p_starts, p_ends, p_today)` INVOKER، IMMUTABLE | **H** | (دوال أخرى) |
| `private.rebuild_open_association_obligations(p_association_id)` | **H** — داخلية، كتابة، حراسة | — |

### D. القرعة والاستحقاق والحضور

| الدالة | الأدلة | C |
|---|---|---|
| `perform_draw(p_association_id, p_expected_round_no)` W+P | **K** — مدير+`active`، `FOR UPDATE`، `p_expected_round_no` وإلا `40001`، قفل الدورة، شرط اكتمال الأقساط، موعد القرعة | ✔ |
| `set_draw_scheduled_at(p_association_id, p_scheduled_at)` W+P | **K** — مدير، `FOR UPDATE`، داخل يوم الاستحقاق، ليس في الماضي | ✔ |
| `set_draw_presentation_status(p_association_id, p_round_no, p_status)` W+P | **K** — مدير، `FOR UPDATE` | ✔ |
| `get_draw_room(p_association_id, p_round_no)` W+P | **K** — مدير أو عضو | ✔ |
| `get_draw_history(p_association_id)` W+P | **H** — U، M، E | ✔ |
| `get_draw_readiness(p_association_id)` W+P | **K** — مدير فقط، تستدعي `compute_draw_readiness` | ✔ |
| `private.compute_draw_readiness(p_association_id, p_cycle_id, p_cycle_only)` | **H** — داخلية، لا EXECUTE لـauthenticated | — |
| `set_cycle_attendance(p_cycle_id, p_membership_id, p_present)` W+P | **B** — **تُطلق دائماً 0A000** («لم يعد شرطاً للقرعة»). التقرير 03: العميل لا يستدعيها | ✘ — DEPRECATED CANDIDATE |
| `private.sync_association_first_draw()` trigger INVOKER | **H** — BEFORE INSERT/UPDATE على `associations` | — |

### E. الإشعارات والمحادثات والتفضيلات والأحداث

| الدالة | الأدلة | C |
|---|---|---|
| `send_chat_message(p_association_id, p_body)` W+P | **K** — عضو أو مدير، يكتب رسالة وإشعارات للآخرين مع احترام الكتم | ✔ |
| `mark_my_notification_read(p_notification_id)` W+P | **B/K** — `WHERE id=… AND user_id=v_uid` | ✔ |
| `set_association_notification_settings(p_association_id, p_feed_types, p_chat_types, p_name_visible_types)` W+P | **H** — U، M، كتابة | ✔ |
| `set_association_notification_types(p_association_id, p_enabled_types)` W+P | **H** — U، M، كتابة (مسار أقدم) | ✘ — DEPRECATED CANDIDATE |
| `set_association_user_preferences(p_association_id, p_mute_group, p_mute_reminders)` W+P | **K** — عضو أو مدير | ✔ |
| `get_association_news(p_association_id, p_limit, p_before)` W+P | **K** — مدير أو عضو | ✔ |
| `get_association_audit_log(p_association_id, p_limit, p_before)` W+P | **H** — U، M | ✔ |
| `private.publish_association_event(…15 معاملاً…)` | **H** — داخلية، كتابة، لا EXECUTE لـauthenticated | — |
| `private.notify_invited_account()` / `notify_new_join_request()` / `set_join_request_applicant_name()` triggers | **H** | — |

### F. الداخلية والتشغيلية

| الدالة | الأدلة |
|---|---|
| `private.process_time_events()` (يستدعيها Cron كل 10 دقائق) | **H** — لا EXECUTE لـauthenticated، `advisory`، كتابة. **تفاصيلها في الدفعة 07c** |
| `private.guard_append_only_history()` trigger | **B** — الحذف مرفوض دائماً؛ التعديل مرفوض إلا `installment_receipts: active→voided` مع تطابق باقي الأعمدة |
| `public.rls_auto_enable()` event trigger (DEFINER، `search_path=pg_catalog`) | **B** — يفعّل RLS تلقائياً على الجداول الجديدة في `public` عند `CREATE TABLE` |

## 5. Triggers (CONFIRMED من `pg_get_triggerdef`) — جداول `public`

| الجدول | Trigger | التوقيت/الحدث | الدالة |
|---|---|---|---|
| `association_events` | `association_events_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `chat_messages` | `chat_messages_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `draw_eligible_shares` | `draw_eligible_shares_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `draws` | `draws_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `installment_receipts` | `installment_receipts_history_guard` | BEFORE UPDATE/DELETE | `guard_append_only_history` (يسمح `active→voided`) |
| `receipt_corrections` | `receipt_corrections_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `reminders` | `reminders_append_only` | BEFORE UPDATE/DELETE | `guard_append_only_history` |
| `associations` | `associations_sync_first_draw` | BEFORE INSERT / UPDATE OF `start_date`, `cycle_days`, `first_draw_on` | `sync_association_first_draw` |
| `invitations` | `invitations_notify_invitee` | AFTER INSERT، `WHEN shares_requested IS NULL` | `notify_invited_account` |
| `join_requests` | `join_requests_notify_manager` | AFTER INSERT | `notify_new_join_request` |
| `join_requests` | `join_requests_set_applicant_name` | BEFORE INSERT | `set_join_request_applicant_name` |

وإضافة: `auth.users` — `sahm_on_auth_user_created` AFTER INSERT ← `private.handle_new_user`.

**التقييم:** لا Triggers متداخلة على الجدول نفسه بالحدث نفسه (INFERRED من القائمة: لكل جدول trigger واحد، عدا `join_requests` بحدثين مختلفي التوقيت BEFORE/AFTER). حماية السجلات التاريخية متسقة مع `correct_installment_receipt` (F-07a-05). تأثير `notify_*` على الإشعارات ومنع حلقة الإشعارات: **NOT VERIFIED** (لم تُقرأ أجسامها) وتُراجع في 07b.

## 6. النتائج

### المؤكدة (CONFIRMED)

**F-07a-01 — بنية الغلاف/التنفيذ سليمة ومتسقة.** 46 زوجاً بالنمط نفسه، `search_path` فارغ، لا EXECUTE لـPUBLIC، و`anon` على معاينة الرابط العام وحدها.

**F-07a-02 — التحقق من الهوية والجمعية في الدوال المقروءة سليم.** كل دالة كتابية مقروءة تبدأ بـ`auth.uid()` وترفض الغائب (28000)، وتقيّد الصلاحية بمدير الجمعية المشتقة من الكيان. لم أجد في الدوال المقروءة مساراً يتيح لعضو في جمعية الوصول إلى بيانات جمعية أخرى عبر RPC. **هذا لا يغطي الدوال من مستوى H (انظر القسم 7).**

**F-07a-03 — الأموال محمية بالمصدر الواحد.** `record_installment_receipt` تأخذ المبلغ والعملة من صف الالتزام لا من العميل، ولا تقبل مبلغاً مدخلاً.

**F-07a-04 — حماية التكرار والتزامن مدعومة بفهارس فريدة (CONFIRMED من `pg_indexes`):**
- `installment_receipts_one_active_per_obligation` (فريد جزئي: إيصال نشط واحد لكل التزام)
- `draws_cycle_id_key` و`draws_share_wins_once` و`draws_association_id_round_no_key` (قرعة واحدة لكل دورة، والسهم يفوز مرة)
- `join_requests_one_pending_per_user_idx` و`join_requests_one_membership_idx`
- `association_memberships_association_id_user_id_key`، و`shares_association_id_share_no_key`

مع `p_expected_round_no` في `perform_draw` (خطأ 40001 عند اختلاف الجولة). النتيجة: تنفيذ القرعة أو تسجيل القسط مرتين لا يُنتج أثراً مالياً مكرراً على مستوى القاعدة.

**F-07a-05 — حارس السجل التاريخي متوافق مع التصحيح.** `correct_installment_receipt` تُحدّث `status` فقط، والحارس يسمح بذلك بالضبط (`active→voided` مع تطابق باقي الأعمدة)، ويرفض غيره.

**F-07a-06 — مساران موقوفان ما زالا قابلين للاستدعاء:** `create_association` و`set_cycle_attendance` تُطلقان 0A000 في الطبقتين. ليستا خطراً، لكنهما سطح غير لازم. **DEPRECATED CANDIDATE** — لا حذف قبل تتبع المستهلكين في HTML وmanaged-group والاختبارات.

**F-07a-07 — نسخة `create_invitation` بأربع معاملات (مع الأسهم)** غير قابلة للتنفيذ من `authenticated` في الطبقتين، فهي خارج مسار العميل. **DEPRECATED CANDIDATE.** وكذلك `set_association_notification_types` (حية لكن لا يستدعيها `sahm-supabase*.js`؛ بقية المستهلكين NOT VERIFIED).

**F-07a-08 — دالتا `get_association_shares` و`get_my_association_shares` تخالفان النمط:** منطق كامل في `public` بصلاحية INVOKER يعتمد على RLS، بلا نسخة في `private`. يعملان بأمان إذا كانت سياسات `shares` و`profiles` و`draws` صحيحة (06). عند إعادة البناء يجب نقلهما للنمط نفسه أو توثيق الاستثناء.

**F-07a-09 — حسم F-03-S2:** `handle_new_user` يسجل `legal_acceptances` من `raw_user_meta_data` (`terms_accepted`, `terms_version`) التي يرسلها العميل عند التسجيل. و`complete_my_profile` تشترط وجود قبول للنسخة المضمنة نصاً `2026-11-14`. أي: قبول الشروط **ادعاء من العميل** لا دليل خادمي مستقل، ويمكن لتسجيل مباشر عبر الـAPI أن يمرره دون المرور بشاشة الشروط. وتغيير نسخة الشروط يتطلب تعديل نص الدالة.

**F-07a-10 — تعرض مخطط `private`:** `USAGE` ممنوح لـ`anon` و`authenticated`، وEXECUTE على دوال `private` ممنوح لـ`authenticated`. ما يمنع الاستدعاء المباشر عملياً هو **عدم إدراج `private` ضمن المخططات المكشوفة في إعدادات API** وهذا **NOT VERIFIED / BLOCKED** (لا أرى إعدادات API). الأثر المحدود: كل دالة تفحص `auth.uid()` والصلاحية بنفسها، فلا ارتفاع صلاحيات. جدول `private.association_public_links` بلا RLS لكن بلا أي صلاحية لـanon/authenticated (حماية بالمنح وحدها)؛ والمنح الافتراضية للجداول المستقبلية NOT VERIFIED.

**F-07a-11 — ربط مع F-03-S3 (رسالة مضللة):** إعادة تسجيل الإيصال نفسه تنتهي بخطأ فريد باسم `installment_receipts_one_active_per_obligation` يحوي `duplicate key`، فتحوّله `friendly()` في العميل إلى «رقم الهاتف مسجل مسبقاً بحساب آخر». المسار مؤكد بالقراءة الثابتة للطرفين، **لم يُنفَّذ**.

### مخاطر محتملة (INFERRED) — ليست ثغرات مؤكدة

**R-07a-12 — ملكية الهاتف غير مُثبتة في مطابقة الدعوات.** `accept_legacy_invitation_by_id` و`get_my_invitation_details` تطابقان `invitee_phone_e164` مع هاتف الملف الشخصي، وهذا الهاتف يضبطه المستخدم في `complete_my_profile` بتحقق صيغة فقط (لا يوجد في الدالة ما يدل على OTP). فمن يسجل برقم لم يُسجَّل بعد قد يطالب بدعوة عُنونت لذلك الرقم. القيد الفريد على الهاتف يمنع الأرقام المسجلة فقط. **الأثر:** على الدعوات القديمة (legacy) والدعوات بالهاتف تحديداً. التحقق من هاتف المصادقة وإعدادات Auth **BLOCKED** (لا وصول لإعدادات Auth).

**R-07a-13 — `respond_to_invitation` لا يفحص ملكية الدعوة حين `invited_user_id` فارغ** في الأسطر المقروءة (قد توجد فحوص أخرى لم يلتقطها المسح). يلزم معرفة معرّف الدعوة (UUID). خطر نظري؛ يُحسم بقراءة الجسم الكامل في 07b.

**R-07a-14 — سباق في `send_installment_reminders`:** الجسم مقروء كاملاً (B) ولا قفل ولا `advisory` فيه. فحص «خلال 6 ساعات» ثم الإدراج غير ذريين: نداءان متزامنان قد يمرّان معاً فيُنشئان دفعتي تذكير مكررتين (مفتاح التفرد على الإشعار مبني على معرّف التذكير، فلا يحمي). الأثر: إزعاج وليس مالياً.

**R-07a-15 — قواعد تسجيل الإيصال:** الدالة (مقروءة كاملة) لا تفحص حالة الجمعية، ولا أن فترة القسط بدأت أو أن الالتزام مستحق، ولا حالة عضوية صاحب الالتزام، ولا تتطلب تأكيداً من العضو، ويحق للمدير تسجيل استلام التزامه هو (يُعلَّم `self_recorded`). قد تكون هذه قواعد مقصودة؛ ولم أتحقق هل تمنعها قيود الجداول أو مشغلات (06 غطّت القيود ولم أعد قراءتها). **قرار منتج لا خلل مؤكد.**

**R-07a-16 — معاينة الرابط العام لـ`anon`:** تكشف لحامل الرمز اسم الجمعية واسم المدير الكامل وشروطها المالية (مقصود وظيفياً). الرمز 64 خانة سداسية (هاش مضاعف المعرفات العشوائية)، فالتخمين غير عملي؛ لا حد للمحاولات داخل الدالة، وحدود المعدل على مستوى المنصة NOT VERIFIED.

**R-07a-17 — تفاصيل أداء بسيطة:** أغلفة القراءة (`get_*`) معرّفة VOLATILE بينما نسخ `private` STABLE، فلا تُدمج في الاستعلام ولا تُخزَّن نتائجها. أثر ضئيل.

## 7. ما لم يتحقق منه (NOT VERIFIED) والفجوات

1. **أجسام مستوى H لم تُقرأ كاملة:** `create_association_unified` (7.5KB، قواعد الإنشاء والأسهم والدورات)، `update_my_profile`، `get_draw_history`، `get_association_audit_log`، `set_association_notification_settings` و`_types`، `rebuild_open_association_obligations`، `compute_draw_readiness`، `publish_association_event`، `derive_installment_status`، ودوال الـTriggers الأربع. **لا يجوز اعتبارها آمنة بناءً على المسح الآلي.**
2. **سياسات RLS الـ34:** غطتها المرحلة 06؛ لم أعد قراءتها هنا، ولم أربط كل سياسة بدالة مساعدة (الربط يتم في 07b).
3. **مستهلكو الدوال في HTML وmanaged-group (05/05b/05c):** لم أعد فتحها؛ العمود C مبني على المرحلة 03 فقط.
4. **Cron وRealtime والامتدادات و`get_advisors`:** مؤجلة للدفعتين 07b/07c (Cron: مهمة واحدة `sahm-process-time-events` كل 10 دقائق، نشطة — مقروءة، لم تُحلل).
5. **إعدادات Auth وAPI (المخططات المكشوفة، التحقق من الهاتف، حدود المعدل):** **BLOCKED** — لا أداة وصول. **Render: BLOCKED.**
6. **لم يُنفَّذ أي RPC**، فكل الاستنتاجات عن السلوك الفعلي (رسائل الأخطاء، التعارض) مبنية على القراءة الثابتة.

## 8. المهام المتبقية (الدفعات التالية)

- **07b:** قراءة كاملة للدوال من مستوى H (خصوصاً `create_association_unified`)، وربط كل سياسة RLS بدالتها المساعدة، وفحص دوال الإشعارات والـTriggers المرتبطة، وحسم R-07a-13.
- **07c:** Cron (`process_time_events` والجداول المتأثرة ونمو `time_event_runs`) وRealtime (المنشور والمستهلكون) والامتدادات و`get_advisors` مع ربط كل تحذير بأثره على SAHM.
- ثم المرحلة 05c، فالتدقيق الأمني الشامل، والاختبارات، والتقرير النهائي.

## 9. القيود التي طُبّقت

لا تعديل لأي ملف تطبيقي أو جدول أو دالة أو سياسة أو Trigger أو إعداد. لا migrations. لا بيانات اختبارية. موصل AMAN.Y وحده؛ مشروع SAHM وحده؛ الفرع `SAHM-SUPABASE` وحده. الملف الوحيد المضاف: هذا التقرير.

## 10. نقطة الاستئناف

الدفعة التالية: **07b** كما في القسم 8.
