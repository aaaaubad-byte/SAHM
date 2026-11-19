# TRANSFER REGISTER — سجل نقل SAHM

هذا السجل هو المصدر المركزي لحالة اكتشاف وتوصيف ونقل وظائف SAHM إلى المعمارية الجديدة. SPECIFIED تعني أن قواعد العمل والعقد موثقة مبدئياً، ولا تعني أن التنفيذ الجديد بدأ.

## 1. الحالات

| الحالة | المعنى |
|---|---|
| NOT_STARTED | لم يبدأ اكتشاف المجال أو نقله |
| DISCOVERED | تم العثور على الشاشة أو الوظيفة أو الجدول، لكن المواصفات غير مكتملة |
| SPECIFIED | قواعد العمل والعقد والحالات الأساسية موثقة |
| IMPLEMENTED | نُفّذ في التطبيق الجديد |
| TESTED | اجتاز الاختبارات المحددة |
| VERIFIED | تحقق مستقل من السلوك والقبول والبيانات |

لا يوجد عنصر منفذ أو مختبر أو متحقق في تطبيق جديد حتى الآن.

## 2. سجل النقل

| ID | المجال/العنصر | المصدر الحالي | قواعد النقل | الحالة |
|---|---|---|---|---|
| CMP-001 | نظام التصميم | HTML/CSS و05b | Tokens، RTL منطقي، أحجام لمس، حالات موحدة | DISCOVERED |
| SCR-001 | الدخول والترحيب | welcome/account-login | فصل المصادقة عن إكمال الملف | DISCOVERED |
| SCR-002 | التسجيل | register | قبول الشروط ونسختها وPKCE | SPECIFIED |
| SCR-003 | الملف الشخصي | profile-setup | اسم ثلاثي، هاتف E.164 فريد، avatar whitelist | SPECIFIED |
| SCR-004 | استعادة كلمة المرور | reset-password | PKCE وredirect query دون فقد الرمز | DISCOVERED |
| SCR-005 | الصفحة الرئيسية | home | حالة موحدة وروابط المجالات | DISCOVERED |
| SCR-006 | استكشاف الجمعيات | groups | احترام صلاحيات الرؤية | DISCOVERED |
| SCR-007 | الجمعيات المدارة | managed-groups | فصل دور المدير عن العضو | DISCOVERED |
| SCR-008 | الجمعيات المنضم إليها | joined-groups | العضوية الفعلية من membership لا الدعوة | DISCOVERED |
| SCR-009 | إنشاء الجمعية | create-group | association + cycle + periods + obligations + events ذرياً | SPECIFIED |
| SCR-010 | تفاصيل الجمعية | group-detail | حالة الجمعية والتبويب والدورة قابلة للاستعادة | DISCOVERED |
| SCR-011 | أقسام المدير العشرة | sahm-managed-group.js | الحفاظ على الأقسام الفعلية وحدود الصلاحيات | DISCOVERED |
| SCR-012 | إدارة الأعضاء | members | العضوية والأسهم والالتزامات ضمن عمليات محكومة | DISCOVERED |
| SCR-013 | استقبال الأعضاء والرابط | member-reception/private link | token hash، pause/rotate/revoke، تاريخ محلي | SPECIFIED |
| SCR-014 | الدعوات | invite/invite-detail | الدعوة لا تساوي عضوية | SPECIFIED |
| SCR-015 | طلبات الانضمام | join-requests | اعتماد المدير ينشئ membership/shares/obligations ذرياً | SPECIFIED |
| SCR-016 | الأقساط | installments | periods وobligations مصدر الحقيقة | DISCOVERED |
| SCR-017 | التحصيل | record receipt | قفل الالتزام والتحقق من المدير وإنشاء الإيصال | SPECIFIED |
| SCR-018 | تصحيح الإيصال | receipt-detail | void + snapshot + reason + audit | SPECIFIED |
| SCR-019 | التذكيرات | reminders | قواعد منع التكرار وتأكيد الإرسال | DISCOVERED |
| SCR-020 | القرعة | draw-room | readiness + lock + round + rejection sampling | SPECIFIED |
| SCR-021 | سجل القرعات | draw-history | حفظ المؤهلين وإصدار الخوارزمية | SPECIFIED |
| SCR-022 | الحضور | cycle_attendance | مرشح تقاعد؛ لا يعود شرطاً للقرعة دون قرار | DISCOVERED |
| SCR-023 | المحادثة | chat | عضوية/مدير، حد الرسالة، كتم وإشعارات | SPECIFIED |
| SCR-024 | الحائط والأخبار | wall/news | صلاحيات النشر وإعدادات القنوات | DISCOVERED |
| SCR-025 | الإشعارات | notifications | تخزين دائم وإعدادات وقنوات | DISCOVERED |
| SCR-026 | سجل التدقيق | association_events | سجل أحداث لا حذف صامت | SPECIFIED |
| SCR-027 | الملف والإعدادات | profile/settings | فصل البيانات العامة عن الهاتف الخاص | DISCOVERED |
| FN-001 | إنشاء الجمعية الموحد | create_association_unified | عملية ذرية لإنشاء بنية الدورة | SPECIFIED |
| FN-002 | تحديث الجمعية | update_association | منع التعديل بعد بدء السجل المالي/القفل | SPECIFIED |
| FN-003 | طلب الانضمام | submit_join_request | invitation/public_link مع تحقق token | SPECIFIED |
| FN-004 | اعتماد الطلب | approve_join_request | membership + shares + obligations + events | SPECIFIED |
| FN-005 | تسجيل الإيصال | record_installment_receipt | قفل الالتزام والتحقق من المدير | SPECIFIED |
| FN-006 | تصحيح الإيصال | correct_installment_receipt | void موثق دون حذف | SPECIFIED |
| FN-007 | القرعة | perform_draw | الوقت والجاهزية والجولة والعشوائية | SPECIFIED |
| FN-008 | الرابط العام | manage_association_public_link | hash وإدارة حالة الرابط | SPECIFIED |
| FN-009 | الرسائل | send_chat_message | عضوية/مدير وحد الرسالة والإشعارات | SPECIFIED |
| TBL-001 | نموذج البيانات | 26 جدولاً / 53 FK | ERD وownership وconstraints | DISCOVERED |
| POL-001 | سياسات RLS | 32 policy في public | اختبار كل دور وكل جدول | DISCOVERED |
| POL-002 | جداول private | association_public_links/time_event_runs | ACL وRLS دون تعريض مباشر | DISCOVERED |
| INT-001 | Realtime | 4 جداول منشورة | قناة تحديث لا مصدر حقيقة | DISCOVERED |
| INT-002 | Supabase Auth | sahm-supabase.js | إعدادات Auth التفصيلية BLOCKED | DISCOVERED |
| INT-003 | Render | خدمتا Static Site | تحديد المرجعية دون إيقاف | DISCOVERED |
| INT-004 | PWA/Service Worker | sw.js/workflow | query tokens وBUILD_ID | DISCOVERED |
| TST-001 | اختبارات JS | 9 ملفات | ربط كل اختبار بـ FN/RULE/SCR | DISCOVERED |
| TST-002 | اختبارات SQL | 9 ملفات | Supabase local فقط | DISCOVERED |
| TST-003 | CI | 3 workflows | Node + local SQL + worker stamp | DISCOVERED |
| CMP-002 | مكونات الواجهة | HTML/JS/CSS | استخراج الاستخدام الفعلي لا CSS فقط | DISCOVERED |

## 3. قواعد لا تتغير دون قرار مالك المنتج

1. الدعوة لا تنشئ عضوية؛ اعتماد المدير هو نقطة إنشاء العضوية.
2. الأسهم والتزامات الأقساط تتولد ضمن معاملة اعتماد العضوية.
3. التحصيل لا يحذف؛ تصحيح الإيصال موثق بسبب وsnapshot.
4. القرعة لا تنفذ قبل الجاهزية والموعد، ولا تختار فائزاً سابقاً.
5. الحضور ليس شرطاً للقرعة الحالية.
6. الهاتف في مساحة خاصة منفصلة عن الملف العام.
7. رابط الانضمام يخزن hash ويخضع لحالة الجمعية وتاريخها المحلي.
8. Realtime للتحديث، وليس مصدراً نهائياً للحقيقة.
9. الحسابات المالية تستخدم integer minor units لا floating point.
10. صلاحيات المدير والعضو تفرض في DB/RPC لا بإخفاء الأزرار.

## 4. بوابات قبول النقل

- Gate A Discovery: كل شاشة ووظيفة وقاعدة لها ID ومصدر وأدلة.
- Gate B Specification: كل قاعدة لها حالات طبيعية وحدّية وفشل وصلاحية ونتيجة.
- Gate C Architecture: اعتماد stack وboundaries وrouting وstate/data/auth/security.
- Gate D Foundation: مشروع جديد وCI وtype-check وlint دون اتصال بإنتاج.
- Gate E Vertical slices: نقل المجالات UI → domain → DB → tests، لا نقل ملفات عشوائياً.
- Gate F Parity: مقارنة قواعد العمل ببيانات اصطناعية.
- Gate G Cutover: خطة ترحيل ومزامنة وrollback وتحويل حركة المستخدمين.

## 5. التقدم

- Discovery: جزئي.
- Specification: جزئي، خاصة الإنشاء والعضوية والتحصيل والتصحيح والقرعة والدعوات والرابط.
- Architecture: مقترحة في 11-target-architecture-evaluation.md، ولم تعتمد.
- New implementation: NOT_STARTED.
- Tests: لم تُشغّل في هذه المراجعة.
- Production migration/cutover: NOT_STARTED.


## 6. سجل قواعد الأعمال

| ID | القاعدة | المجال | الحالة |
|---|---|---|---|
| RULE-001 | الدعوة لا تنشئ عضوية؛ الاعتماد فقط ينشئ membership | العضوية | SPECIFIED |
| RULE-002 | اعتماد الانضمام ينشئ العضوية والأسهم والتزامات الأقساط ذرياً | العضوية/المالية | SPECIFIED |
| RULE-003 | تسجيل التحصيل متاح لمدير الجمعية ويتحقق من الالتزام ويقفل صفه | التحصيل | SPECIFIED |
| RULE-004 | تصحيح الإيصال لا يحذف السجل؛ يلغي الإيصال مع سبب وsnapshot | المالية | SPECIFIED |
| RULE-005 | لا قرعة قبل اكتمال الالتزامات والموعد ورقم الجولة المتوقع | القرعة | SPECIFIED |
| RULE-006 | السهم الفائز في جولة سابقة لا يعود مؤهلاً | القرعة | SPECIFIED |
| RULE-007 | إنشاء الجمعية يهيئ الدورة الأولى وفترات الأقساط والالتزامات في معاملة واحدة | الإنشاء | SPECIFIED |
| RULE-008 | تحديث إعدادات الجمعية يُمنع بعد القفل أو بدء السجل المالي | دورة الحياة | SPECIFIED |
| RULE-009 | الرابط العام يخزن hash للرمز ولا يعرض الرمز الخام إلا عند إنشائه | الدعوات | SPECIFIED |
| RULE-010 | الهاتف لا يعد ملكية مثبتة ما لم يوجد تحقق مستقل؛ التحقق الحالي غير مثبت | الهوية | DISCOVERED |
| RULE-011 | Realtime إشعار بالتغير وليس مصدراً نهائياً للحقيقة | التكامل | SPECIFIED |
| RULE-012 | الحضور لم يعد شرطاً للقرعة الحالية | القرعة | SPECIFIED |
| RULE-013 | مبالغ العملة تحفظ بوحدات minor integer | المالية | SPECIFIED |
| RULE-014 | إعدادات الإشعارات وكتم المجموعة يجب أن تتبع سياسة موحدة بين القنوات | الإشعارات | DISCOVERED |

## 7. سجل RPC

| ID | RPC | الوظيفة | الحالة |
|---|---|---|---|
| RPC-001 | create_association_unified | إنشاء الجمعية وبنيتها التشغيلية | SPECIFIED |
| RPC-002 | update_association | تحديث الإعدادات ضمن قيود دورة الحياة | SPECIFIED |
| RPC-003 | submit_join_request | تقديم طلب عبر دعوة أو رابط عام | SPECIFIED |
| RPC-004 | approve_join_request | اعتماد الطلب وتوليد العضوية والأسهم والالتزامات | SPECIFIED |
| RPC-005 | reject_join_request | رفض الطلب مع حالة نهائية | DISCOVERED |
| RPC-006 | create_invitation / create_invitations_bulk | إنشاء الدعوات الفردية/الجماعية | DISCOVERED |
| RPC-007 | manage_association_public_link | إنشاء/تدوير/إيقاف/استئناف/إلغاء الرابط | SPECIFIED |
| RPC-008 | record_installment_receipt | تسجيل التحصيل | SPECIFIED |
| RPC-009 | correct_installment_receipt | تصحيح إيصال موثق | SPECIFIED |
| RPC-010 | send_installment_reminders | إرسال تذكيرات الأقساط | DISCOVERED |
| RPC-011 | get_draw_readiness / get_draw_room / get_draw_history | استعلام جاهزية وغرفة وسجل القرعة | DISCOVERED |
| RPC-012 | perform_draw | تنفيذ القرعة ذرياً | SPECIFIED |
| RPC-013 | set_draw_scheduled_at / set_draw_presentation_status | الجدولة وحالة العرض | DISCOVERED |
| RPC-014 | send_chat_message | إرسال رسالة الجمعية | SPECIFIED |
| RPC-015 | set_association_notification_settings | إعداد قنوات النشر | DISCOVERED |
| RPC-016 | get_association_audit_log / get_association_financial_summary / get_association_news | تقارير القراءة | DISCOVERED |
| RPC-017 | update_my_profile / complete_my_profile | الملف الشخصي | SPECIFIED |
| RPC-018 | accept_invitation / respond_to_invitation / cancel_invitation | دورة استجابة الدعوة | DISCOVERED |

## 8. قرارات المنتج المطلوبة قبل نقل الوظائف المرتبطة بها

- اعتماد حد أعلى لأسهم المدير والعضو وإجمالي الأسهم، أو توثيق عدم وجود حد مع مبررات تشغيلية.
- تحديد طريقة إثبات ملكية الهاتف قبل استخدامه لمطابقة الدعوات أو قبول دعوة قديمة.
- تحديد المكان النهائي لإدارة رابط الانضمام العام داخل أقسام المدير العشرة.
- تقرير ما إذا كانت إضافة/تقليل الأسهم وإزالة العضو ستعود إلى واجهة المدير أم تبقى خارج المنتج.
- تحديد السلوك المتوقع لكتم المجموعة: هل يشمل إشعارات الأخبار والرسائل والتذكيرات أم لكل قناة سياسة مستقلة؟
- تحديد ما إذا كان يلزم استمرار خدمتي Render أم اعتماد خدمة معاينة واحدة.
- اعتماد سياسة خصوصية ومراجعة قانونية لشروط الاستخدام قبل الإطلاق.
