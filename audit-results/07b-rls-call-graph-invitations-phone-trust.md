# المرحلة 07b — القراءة الكاملة للدوال المتبقية، وربط RLS والصلاحيات بالدوال، وبناء خريطة الاستدعاء (قراءة فقط)

- المرجع: `aaaaubad-byte/SAHM`، الفرع `SAHM-SUPABASE`، بعد التقرير `07a` (Commit `0f2c5ebb6328dcf2eba2d60ac81ecded92f3312c`).
- قاعدة البيانات: مشروع `SAHM` المرجع `nusjnnrtpxbpphphmdsc` عبر موصل AMAN.Y. كل الاستعلامات `read_only=true`.
- **ملاحظة عن البيانات:** كل الاستعلامات على الكتالوج، عدا **استعلام تجميعي واحد** على `public.invitations` (عدّ فقط، دون قراءة أي صف أو هاتف) لحسم R-07a-13. لم تُقرأ أي بيانات مستخدمين.
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.

## 1. ما أُغلق من فجوات 07a

أجسام الدوال التي كانت من مستوى H (مسح آلي) قُرئت الآن **كاملة (B)**: `create_association_unified`، `respond_to_invitation`، `get_my_invitation_inbox`، `list_my_invitations`، `set_association_notification_settings`، `set_association_notification_types`، `update_my_profile`، `compute_draw_readiness`، `derive_installment_status`، `get_association_audit_log`، `get_draw_history`، `publish_association_event`، `rebuild_open_association_obligations`، `notify_invited_account`، `notify_new_join_request`، `set_join_request_applicant_name`، `sync_association_first_draw`.
ما زال مقروءاً بالأسطر المفصلية فقط (K) من 07a: `approve_join_request`، `accept_invitation`، `accept_legacy_invitation_by_id`، `submit_join_request*`، `add/remove_shares`، `remove_member`، `update_association`، `perform_draw` (8.4KB)، `set_draw_*`، `create_invitation*`، `create_invitations_bulk`، `manage_association_public_link`، `get_draw_room`، `get_association_news`، `send_chat_message`، `get_association_financial_summary`. **تُراجع كاملة في دفعة 07d المقترحة (القسم 9).**

## 2. خريطة الاستدعاء بين الدوال (CONFIRMED: مسح `prosrc` بحثاً عن `private.<name>(`)

| الدالة الداخلية | تستدعيها |
|---|---|
| `assert_association_agreement_open` | `accept_invitation`، `add_shares`، `remove_member`، `remove_shares`، `update_association` |
| `assert_association_join_open` | `accept_legacy_invitation_by_id`، `approve_join_request`، `create_invitation` (3)، `create_invitations_bulk`، `preview_invitation`، `preview_public_join_link`، `respond_to_invitation`، `submit_join_request`، `submit_join_request_by_invitation` |
| `assert_association_pre_financial` | `rebuild_open_association_obligations` فقط |
| `rebuild_open_association_obligations` | `add_shares`، `remove_member`، `remove_shares`، `update_association` |
| `compute_draw_readiness` | `get_draw_readiness`، `perform_draw`، `process_time_events` |
| `derive_installment_status` | `get_association_financial_summary` + العرض `installment_obligation_status` |
| `publish_association_event` | `accept_invitation`، `accept_legacy_invitation_by_id`، `approve_join_request`، `perform_draw`، `process_time_events`، `record_installment_receipt`، `set_association_notification_settings`، `set_draw_presentation_status`، `set_draw_scheduled_at` |
| `normalize_phone_e164` | `complete_my_profile`، `create_invitation` (النسختان)، `create_invitations_bulk`، `handle_new_user` |
| `can_view_event` | **لا دالة ولا سياسة** (لا مستهلك داخل القاعدة) |
| `owns_membership` | لا دالة؛ **تستعملها سياستا RLS** على `installment_obligations` و`installment_receipts` |
| `process_time_events` | لا دالة؛ تستدعيها مهمة Cron (انظر 07c) |

**الاستنتاجات:**
- **جاهزية القرعة مصدرها الخادم:** `compute_draw_readiness` تغذي `perform_draw` نفسها، فهي القاعدة الملزمة. نسخة العميل المحلية (`drawReadinessLocal`) مكررة وتعرض فقط (F-03-D16). INFERRED أن `perform_draw` تُنفّذ الفحص داخلياً بهذه الدالة (ظاهر من الخريطة ورسالة «اكتمال الأقساط»).
- **حالة القسط لها ثلاثة مصادر:** (1) العميل (`SahmCore.obligation`)، (2) `derive_installment_status` عبر العرض والملخص المالي في الخادم، (3) `compute_draw_readiness` التي تُعرّف «مدفوع» بإيصال نشط يطابق مبلغ الالتزام. التعريفات متطابقة في المبدأ لكن **تطابقها مع العميل لم يُختبر** (NOT VERIFIED).
- **العرض `installment_obligation_status`:** لا تستعمله أي دالة، والعميل لا يقرؤه (المرحلة 03). مستهلكوه خارج هذين: NOT VERIFIED (قد تكون الاختبارات). **DEPRECATED CANDIDATE** لا يُحذف قبل تتبعها.
- **`can_view_event`:** بلا مستهلك داخل القاعدة. **DEPRECATED CANDIDATE** (قد تستعمله اختبارات SQL: NOT VERIFIED).

## 3. `create_association_unified` — القراءة الكاملة (CONFIRMED)

- **ذرّية:** كل الخطوات في دالة واحدة: الجمعية، إعدادات الإشعارات، عضوية المدير وأسهمه (إن شارك)، الدورة رقم 1، فترات الأقساط، التزامات المدير، حدث `association_created`. أي فشل يُلغي الكل. (الذي ليس ذرياً هو استدعاء الرابط العام اللاحق من العميل: F-03-D17.)
- **التحقق خادمي كامل:** الاسم (2–120)، العملة (YER/SAR/USD)، التواريخ والمدة (1–3650 يوماً)، قيمة السهم موجبة، المنطقة الزمنية من `pg_timezone_names`، منطق مشاركة المدير، طول القواعد ≤4000، وضعا الأقساط `count`/`amount` وحدودهما. **العميل البعيد لا يستدعي `validateUnifiedGroup`** (03)، فهذه الدالة هي نقطة التحقق الوحيدة الفعلية.
- **شرط إكمال الحساب:** `profile_completed` شرط لإنشاء الجمعية (وهو لا يُضبط إلا عبر `complete_my_profile`، انظر القسم 5).
- **قاعدة توزيع الأقساط:** الأيام تُوزَّع بالتساوي والباقي على الفترات الأولى؛ في وضع `count` يُضاف باقي المبلغ إلى **القسط الأخير**؛ في وضع `amount` القسط الأخير = المتبقي. تسقط الدورة الأولى `ends_on = first_draw_on − 1`.
- **توافق مع `sync_association_first_draw`:** `first_draw_on = start_date + cycle_days` (CONFIRMED من الدالتين).

**R-07b-01 — لا سقف لأسهم المدير (INFERRED):** `managerShares` عدد صحيح بلا حد أعلى، و`target_shares` و`max_shares_per_member` يُدرجان `NULL` دائماً. تُنفّذ `generate_series(1, managerShares)` إدراجاً في `shares` (ويضرب مبلغ الالتزام بالعدد). قد يُنتج رقم ضخم حملاً كبيراً أو خطأ تجاوز `bigint`. الحد الفعلي هو `statement_timeout` (NOT VERIFIED/BLOCKED لأنه إعداد منصة). لا قيد `CHECK` على `shares` يحدّ العدد، ولا حد لعدد الجمعيات لكل مستخدم.
**NOT VERIFIED:** سلوك `add_shares` ("الحد المسموح للفرد أو العدد المستهدف") عندما يكون الحدّان `NULL` كما تتركهما هذه الدالة.

**R-07b-02 — نسخ مكررة لقاعدة توليد الفترات/الالتزامات (CONFIRMED التكرار):** المنطق نفسه (توزيع الأيام والمبالغ) مكتوب في `create_association_unified` و`rebuild_open_association_obligations`، ولـ`approve_join_request` منطق إدراج التزامات (`ON CONFLICT(membership_id,period_id) DO NOTHING`)، إضافة إلى نسخة العميل. أي تعديل في القاعدة يجب أن يُطبَّق في كل المواضع.

## 4. المصادقة والصلاحيات: ربط الدوال بـRLS والمنح (CONFIRMED)

**المنح على جداول `public` للدور `authenticated` (من `has_table_privilege`/`has_column_privilege`):**
- **قراءة فقط (SELECT)** على 20 جدولاً: كل جداول المال والعضويات والقرعات والدعوات والطلبات والأحداث.
- **كتابة مباشرة** على سبعة مواضع فقط: `association_user_preferences` (INSERT/UPDATE)، `chat_read_states` (INSERT/UPDATE)، `user_preferences` (INSERT/UPDATE)، و**أعمدة محددة:** `notifications.read_at`، `profile_private.city`، `profiles.full_name`.
- **`anon`: لا شيء** على أي جدول في `public`.

**النتيجة:** كل كتابة مالية وعضوية تمر عبر RPC فقط، والمنح تمنع تجاوزها. `profile_completed` و`phone_e164` **غير قابلين للكتابة المباشرة** من العميل.

**سياسات RLS (34) مربوطة بالدوال المساعدة:**

| الجدول | القراءة | ملاحظة |
|---|---|---|
| `associations`, `association_cycles`, `association_memberships`, `shares`, `draws`, `draw_eligible_shares`, `chat_messages`, `installment_periods`, `association_notification_settings`, `cycle_attendance` | `can_view_association` (مدير أو عضو نشط) | يرى العضو كل الأعضاء والأسهم والقرعات في جمعيته |
| `installment_obligations`, `installment_receipts` | مدير **أو** `owns_membership` (صاحب العضوية النشطة) | العضو لا يرى التزامات الآخرين ولا إيصالاتهم |
| `association_events`, `reminders`, `receipt_corrections` | مدير فقط | العضو يقرأ الأخبار عبر RPC `get_association_news` لا مباشرة |
| `invitations` | `invited_user_id` أو **مطابقة هاتف الملف الشخصي** أو مدير | انظر F-07b-04 |
| `join_requests` | صاحب الطلب أو المدير | |
| `profiles` | الذات أو `can_view_profile` | أعضاء جمعية مشتركة نشطة فقط |
| `profile_private`, `notifications`, `legal_acceptances`, `user_preferences`, `chat_read_states`, `association_user_preferences` | الذات فقط | |

**CONFIRMED (قراءة ثابتة):** لا سياسة تتيح لعضو في جمعية قراءة بيانات جمعية أخرى؛ كل سياسة تمر بـ`can_view_association(association_id)` أو مدير/مالك العضوية أو الذات. (لم تُنفَّذ اختبارات تشغيلية.)

**F-07b-03 — سياسة `associations_manager_update` خاملة:** تسمح لمدير الجمعية بالتحديث، لكن لا يوجد منح `UPDATE` على `associations` للدور `authenticated`، فهي **غير فاعلة**. السلامة هنا تعتمد على **المنح وحدها**: لو مُنح `UPDATE` مستقبلاً لتجاوز المدير `update_association` (حراسة الإيصالات/القرعات) ولأمكنه تعديل `manager_user_id` والمبالغ. **DEPRECATED CANDIDATE** للسياسة، وبند لا يجوز فقده: «لا UPDATE مباشر على `associations`».

**R-07b-03 — `profiles.full_name` قابل للكتابة المباشرة (INFERRED):** يتجاوز تحقق `update_my_profile` (الاسم 5–120 حرفاً وثلاثة مقاطع). لم أقرأ قيود `CHECK` على `profiles` في هذه الدفعة (غطتها 06). الاسم يظهر للمدير عند اعتماد الطلبات وفي أسماء الفائزين. كذلك `notifications.read_at` قابل للكتابة مباشرة بجانب RPC `mark_my_notification_read` (مساران لشيء واحد).

**F-07b-05 — العرض `installment_obligation_status`:** `security_invoker=true` (CONFIRMED) فتُطبَّق سياسات RLS على المستدعي ولا تسرّب بين الجمعيات.

## 5. الدعوات والهاتف: جذر الثقة (النتيجة الأمنية الأهم في هذه الدفعة)

**F-07b-04 — الهاتف غير المُثبت يُستعمل كهوية (CONFIRMED الآلية في SQL):** هاتف `profile_private.phone_e164` يضبطه المستخدم في `complete_my_profile` بتحقق صيغة فقط، ثم تُبنى عليه ستة مواضع: `notify_invited_account` (trigger)، `get_my_invitation_inbox`، `list_my_invitations`، `get_my_invitation_details`، `respond_to_invitation`، `accept_legacy_invitation_by_id`، وسياسة RLS على `invitations`. التسجيل في العميل بالبريد (03)، ولا يوجد في أي من هذه الدوال ما يتحقق من ملكية الرقم (لا OTP). **إعدادات Auth (هل يُفرض تأكيد هاتف؟): BLOCKED.**

**الأثر (INFERRED، لم يُختبر تشغيلياً):**
1. **احتلال الرقم:** من يُكمل ملفه برقم شخص آخر أولاً يمنع صاحب الرقم الحقيقي من استخدامه (القيد الفريد، رسالة «رقم الهاتف مسجل مسبقاً»).
2. **اطلاع على الدعوات:** المحتل يرى صندوق الدعوات المعنونة لذلك الرقم (اسم الجمعية، اسم المدير، الشروط المالية) ويستطيع الرد «مهتم» فيُربط `invited_user_id` به.
3. **الحدّ من الضرر:** الانضمام عبر `submit_join_request_by_invitation` يحتاج **اعتماد المدير** (`approve_join_request` يتحقق أن الدعوة مربوطة بمقدّم الطلب)، فيرى المدير اسماً مختلفاً عن المدعو. أما `accept_legacy_invitation_by_id` فتُنشئ عضوية مباشرة بلا اعتماد، لكن **لا توجد دعوات قديمة معلقة حالياً** (القسم 6)، وكان إنشاؤها بنسخة `create_invitation` ذات الأسهم الموقوفة من `authenticated`.

**R-07a-13 مُغلق:** `respond_to_invitation` تفحص الهاتف عندما تحمله الدعوة (CONFIRMED من الجسم الكامل)، وفي البيانات الحالية **كل الدعوات تحمل هاتفاً** (انظر 6)، فالمسار النظري (دعوة بلا هاتف ولا مستخدم) غير موجود فعلياً. القيد `NOT NULL` غير مفروض على العمود (يُسمح بـ`NULL` في `CHECK`)، فيبقى حماية بالمنطق لا بالمخطط.

## 6. أرقام تجميعية من البيانات (CONFIRMED، عدّ فقط)

`invitations`: الإجمالي 4، المعلق 3، بلا هاتف 0، قديمة معلقة 0. **الدلالة:** القاعدة في مرحلة بيانات قليلة جداً، وعدم وجود صفوف في جدول **لا يعني** أنه غير مستخدم (قاعدة التدقيق).

## 7. Triggers وحلقاتها (CONFIRMED)

- **لا حلقات:** أجسام `notify_*` تُدرج في `notifications` فقط، ولا Trigger على `notifications`. و`publish_association_event` تُدرج في `association_events` و`chat_messages` (عليهما حارس Append-only لـUPDATE/DELETE فقط) و`notifications`.
- **تكرار الإشعار:** مفاتيح التفرد (`invitation:<id>:<user>`، `join-request:<id>:submitted`، `ev:<event>:<user>:feed`) تمنع التكرار عند إعادة الإدراج، لكنها **مرتبطة بمعرّف الحدث** فلا تحمي من حدثين مكررين متتاليين (انظر R-07a-14).
- **ترتيب `join_requests`:** `BEFORE INSERT` يضبط `applicant_name` من `profiles` ثم `AFTER INSERT` يُشعر المدير بالاسم نفسه ✔.
- **`notify_invited_account`:** يُشعر الحساب **المسجل وقت إنشاء الدعوة فقط**؛ من يسجل لاحقاً برقم مدعو لا يصله إشعار ويرى الدعوة في الصندوق فقط.

## 8. نتائج إضافية

- **F-07b-06 — `publish_association_event`** تُرسل إشعار الخبر إلى كل عضو نشط والمدير، مع احترام `user_preferences.notifications_enabled` العام وقوائم أنواع الجمعية، و**لا تقرأ** `association_user_preferences.mute_group`؛ بينما `send_chat_message` و`send_installment_reminders` تحترمان إعدادات الكتم. أثر الكتم على إشعارات الأخبار: INFERRED غير مُطبَّق خادمياً هنا (قد يُطبَّق في العميل: NOT VERIFIED). وقرار منتج.
- **F-07b-07 — `rebuild_open_association_obligations`** تحذف **كل** التزامات وفترات الجمعية وتعيد بناءها، وتحميها حراسة `assert_association_pre_financial` (لا إيصالات ولا تذكيرات ولا قرعات). تصاعد الخطر إن أُزيلت الحراسة أو أُضيف مستدعٍ جديد خارج `add/remove_shares` و`remove_member` و`update_association`.
- **F-07b-08 — `set_association_notification_types`** مسار قديم مكرر لـ`_settings`: لا يسجل حدثاً ولا يتحقق من نشاط الجمعية ويكتب القنوات الثلاث بقيمة واحدة. لا يستدعيه `sahm-supabase*.js`. **DEPRECATED CANDIDATE.**
- **F-07b-09 — `get_association_audit_log`** مقيّد بالمدير وبحد 200؛ يُرجع `before_data`/`after_data` كما هي (محتواها قد يتضمن بيانات أطراف: NOT VERIFIED).
- **F-07b-10 — `get_draw_history`** يعتمد `JOIN` داخلياً على `profiles` و`shares`؛ فائز بلا ملف مرئي يُسقَط من السجل (INFERRED، حالة نظرية).
- **`update_my_profile`** لا تتحقق من وجود صف `profile_private` (تحدّث 0 صفوف بصمت إن غاب)، و`handle_new_user` يضمن وجوده عادةً.

## 9. ما لم يتحقق منه والمتبقي

1. قراءة كاملة لأجسام الدوال المذكورة في القسم 1 (K فقط)، وفي مقدمتها **`perform_draw`** (قلب العدالة المالية) و`approve_join_request` و`update_association`. **مقترح دفعة 07d** مختصرة.
2. مستهلكو الدوال في HTML وmanaged-group (ما زال العمود C من المرحلة 03).
3. `statement_timeout` وحدود المعدل وإعدادات API/Auth: **BLOCKED**.
4. نتائج `get_advisors` والامتدادات وCron وRealtime: في 07c.

## 10. القيود التي طُبّقت

لا تعديل لأي شيء. موصل AMAN.Y ومشروع SAHM والفرع `SAHM-SUPABASE` فقط. الملف الوحيد المضاف: هذا التقرير.

## 11. نقطة الاستئناف

التالي: **07c** (Cron وRealtime والامتدادات والتنبيهات).
