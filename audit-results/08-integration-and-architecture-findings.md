# 08 — تكامل الواجهة والمحرك وقاعدة البيانات والاختبارات

- تاريخ الفحص: 2026-11-20
- المستودع: `aaaaubad-byte/SAHM`
- الفرع المفحوص حصراً: `SAHM-SUPABASE`
- Commit المرجع عند بدء هذه المراجعة: `21bf57b75f546849c362ee2a1deaf6c42b225ca0`
- نمط العمل: قراءة فقط للتطبيق وقاعدة البيانات وRender. هذا الملف تقرير توثيق ولا يغيّر سلوك المنتج.

## 1. خلاصة تنفيذية

**CONFIRMED**
- تطبيق الويب الحالي عبارة عن واجهة HTML كبيرة مع JavaScript موزع إلى ملفات مستقلة، وطبقة Core/Data، وطبقة Supabase، وملف خاص بواجهات الجمعية المدارة.
- سجل الشاشات في `Sahm_Preview_ROLE_SEPARATION.html` يضم: welcome، register، account-login، profile-setup، reset-password، logged-out، home، groups، managed-groups، joined-groups، create-group، created-group، group-detail، members، member-reception، invite، invite-detail، join-group، join-request-status، join-requests، join-request-detail، installments، draw-room، draw-history، receipts، receipt-detail، chat، wall، news، notifications، audit، profile، edit-profile، settings.
- تظهر 43 عملية RPC مستدعاة بالاسم من كود الواجهة/الطبقة البعيدة التي تمت قراءتها. هذا جرد استدعاءات ساكن، وليس إثباتاً أن كل RPC مستخدمة في مسار مستخدم مكتمل أو مغطاة باختبار.
- جرد قاعدة البيانات الحية عبر Supabase أظهر 116 دالة في مخططي `public` و`private`، و25 Trigger غير داخلي عبر المخططات، و32 Policy في المخططات التي جرى جردها (التفاصيل بحسب مخرجات الاستعلام)، وCron job واحدة نشطة، وست Extensions.
- Realtime publication يضم أربع جداول: `public.invitations` و`public.join_requests` و`public.notifications` و`public.chat_messages`.
- خدمات Render المتاحة هي خدمتا Static Site باسمَي `sahm-supabase-preview` و`sahm-supabase-preview-fixed`. كلتاهما Live ومربوطتان بالفرع نفسه وبـ Commit المرجع أعلاه.
- ملفات الاختبارات المقروءة تضم 9 ملفات JavaScript و9 ملفات SQL. لم تُشغّل الاختبارات.

**INFERRED**
- التطبيق الحالي يجمع بين نموذج صفحة/موجّه يدوي وبين طبقات JavaScript مخصصة، وليس SPA مبنية على إطار UI حديث. وجود طبقة Core/Data منفصلة مفيد كنقطة استخراج، لكن الواجهة الضخمة ما زالت تعتمد على قوالب HTML مولدة وإجراءات مفوضة.
- يجب اعتبار طبقة Supabase الحالية طبقة توافق/تكامل قائمة تحتاج إلى توصيف عقودها قبل إعادة التصميم، لا أن تُنقل كما هي تلقائياً.

## 2. خريطة الواجهات والقدرات المرصودة

| المجال | الشاشات/القدرات المرصودة | ملاحظات الربط |
|---|---|---|
| الدخول والهوية | welcome، register، account-login، profile-setup، reset-password، logged-out، profile، edit-profile، settings | Supabase Auth وعمليات الملف الشخصي، منها `complete_my_profile` و`update_my_profile` |
| الصفحة الرئيسية | home | نقطة تجميع الحالة والانتقال إلى مجالات الجمعية |
| اكتشاف الجمعيات وإدارتها | groups، managed-groups، joined-groups، create-group، created-group، group-detail | إنشاء الجمعية يستدعي `create_association_unified`؛ إدارة الجمعية تستعمل `update_association` |
| العضوية والدعوات | members، member-reception، invite، invite-detail، join-group، join-request-status، join-requests، join-request-detail | تشمل دعوات فردية/جماعية، معاينة رابط عام، طلب انضمام، قبول/رفض، إلغاء دعوة وإزالة عضو |
| الأقساط والتحصيل | installments، receipts، receipt-detail | `record_installment_receipt` و`correct_installment_receipt` و`send_installment_reminders` |
| القرعة | draw-room، draw-history | `get_draw_readiness` و`get_draw_room` و`perform_draw` و`set_draw_scheduled_at` و`set_draw_presentation_status` |
| التواصل | chat، wall، news، notifications | `send_chat_message`، `get_association_news`، `get_association_audit_log` وإدارة إشعارات المستخدم |
| الشفافية والمالية | audit، ملخص مالي، سجل القرعة | `get_association_financial_summary` و`get_association_audit_log` و`get_draw_history` |

هذه الخريطة تمثل الشاشات المسجلة وعقود الاستدعاء التي ظهرت في الشيفرة. لا تعتبر إثباتاً على اكتمال كل عنصر بصري أو كل حالة واجهة أو صلاحية مستخدم؛ يلزم استكمال الربط على مستوى كل شاشة/نموذج/إجراء.

## 3. عمليات RPC المكتشفة من استدعاءات الواجهة

تم استخراج الأسماء التالية من استدعاءات `.rpc()` و`invoke()` في الملفات المقروءة:

```
accept_invitation
accept_legacy_invitation_by_id
add_shares
approve_join_request
cancel_invitation
cancel_join_request
complete_my_profile
correct_installment_receipt
create_association_unified
create_invitation
create_invitations_bulk
get_association_audit_log
get_association_financial_summary
get_association_news
get_association_public_link_status
get_association_shares
get_draw_history
get_draw_readiness
get_draw_room
get_my_association_shares
get_my_invitation_details
get_my_invitation_inbox
list_my_invitations
manage_association_public_link
mark_my_notification_read
perform_draw
preview_invitation
preview_public_join_link
record_installment_receipt
reject_join_request
remove_member
remove_shares
respond_to_invitation
send_chat_message
send_installment_reminders
set_association_notification_settings
set_association_user_preferences
set_draw_presentation_status
set_draw_scheduled_at
submit_join_request
submit_join_request_by_invitation
update_association
update_my_profile
```

## 4. نقاط تكامل تحتاج قراراً معمارياً

### 4.1 الواجهة والـ JavaScript

**CONFIRMED**
- شاشة `member-reception` موجودة في سجل الشاشات، لكن المراجعة النصية وجدت أن مرجع `member-reception` لا يظهر له انتقال واضح في الاستدعاءات المفحوصة. يلزم فحص مسار الدخول إليها وسبب إدراجها قبل تقرير أنها شاشة ميتة.
- `chat` و`invites` لم تظهر لهما دوال عرض مستقلة بالاسم المتوقع في البحث الأولي؛ التوجيه يتم عبر `openAssociationWorkspace` أو أجزاء عرض مضمّنة. هذا ليس وحده دليلاً على خلل.
- الواجهة تعتمد بكثافة على `innerHTML` وتوليد قوالب ديناميكية، بما في ذلك إنشاء Dialog ديناميكي وربط `data-action` به. ينبغي أن تُراجع سلامة إدخال البيانات والترميز في كل قالب، لا أن يُفترض وجود XSS أو غيابه من مجرد استخدام innerHTML.
- ملف `sahm-managed-group.js` يعرض أقسام المدير: نظرة عامة، الأعضاء، الدعوات، طلبات الانضمام، الأقساط، القرعة، الغرفة، السجل، الإشعارات، المحادثة، الحائط، الأخبار، الإعدادات، سجل التدقيق. بعض هذه الأقسام تُبنى في مكونات مستقلة وبعضها يُمرر إلى طبقة البيانات.

**NOT VERIFIED**
- لم يُحسم بعد أن كل بطاقة/زر/نموذج في الواجهة له handler عامل ومربوط بعقد بيانات صحيح.
- لم يُحسم أن كل قدرات العضو متاحة من واجهة مستقلة؛ لم تُستكمل مراجعة كل حالات العرض والانتقال والصلاحيات.
- لم يتم إجراء فحص runtime للمتصفح أو اختبار واجهة.

### 4.2 مزامنة قاعدة البيانات وملفات migrations

**CONFIRMED**
- مستودع الفرع يحتوي 36 ملف migration، وقاعدة البيانات الحية تعرض 36 migration مسجلة.
- 22 رقم إصدار تتطابق حرفياً، و14 رقم إصدار لا تتطابق حرفياً.
- عند المطابقة بالاسم، توجد 28 تسمية متطابقة، لكن ثمانية أسماء في سجل قاعدة البيانات تظهر مع بادئة timestamp داخل حقل الاسم، بينما ملفات المستودع تسجلها كأسماء عادية. يجب تفسير ذلك من سجل migration الأصلي/طريقة التسجيل قبل اعتبارها اختلافاً بنيوياً.
- توجد 14 حالة اختلاف timestamps بين ملف المستودع وسجل قاعدة البيانات حتى عندما تتطابق تسمية الترحيل. هذه فجوة توثيق/تتبع مؤكدة.

**RECOMMENDATION**
- قبل أي إعادة تأسيس، أنشئ baseline موثقاً من الـ schema الحي، ثم اربط كل migration بملفها وchecksum وتاريخ تطبيقها، وفسّر كل اختلاف timestamp. لا تعِد تشغيل migrations القديمة ولا تعدّل جدول سجل migrations يدوياً.

### 4.3 أمن RLS والمنح

**CONFIRMED**
- `private.association_public_links` لديه RLS معطّل.
- المراجعة السابقة لملف 07b سجلت عدم وجود منح مباشرة لـ `anon` أو `authenticated` على الجدول، لكن لم أعد استخراج نتيجة استعلام privilege كاملة قابلة للتوثيق في هذه المرحلة.
- Advisor الأمن سجل INFO: جدول `private.time_event_runs` لديه RLS مفعّل بلا Policies.
- Advisor الأمن سجل WARN: حماية كلمات المرور المسربة في Supabase Auth معطّلة.

**NOT VERIFIED**
- لا يصح وصف `association_public_links` بأنه مكشوف للعامة دون إثبات schema exposure وUSAGE وtable grants ومسار RPC/Edge Function الذي يصل إليه.
- لم تُراجع جميع تعريفات Security Definer وsearch_path وACL لكل الدوال الحرجة بعد.

### 4.4 الأداء والصحة

**CONFIRMED**
- Advisor الأداء سجل خمسة فهارس غير مستخدمة وقت الرصد: فهرسان على `receipt_corrections`، وفهرس على `cycle_attendance`، وفهرس على `draw_eligible_shares`، وفهرس على `association_events`.
- Advisor الصحة لم يُظهر نتائج lint.
- Extensions المرصودة: `pg_cron 1.6.4`، `pg_stat_statements 1.11`، `pgcrypto 1.3`، `plpgsql 1.0`، `supabase_vault 0.3.2`، `uuid-ossp 1.1`.

**RECOMMENDATION**
- لا تحذف أي فهرس لمجرد أن Advisor صنفه unused؛ افحص حجم البيانات وخطط الاستعلام ودورة الاستخدام قبل قرار الحذف.

## 5. الاختبارات وCI

**CONFIRMED**
- ملفات JavaScript المقروءة: `auth-flow.test.js`، `core.test.js`، `css-dedup.test.js`، `data.test.js`، `join-flow.test.js`، `navigation.test.js`، `supabase-auth.test.js`، `supabase-data.test.js`، `ui-contract.test.js`.
- ملفات SQL المقروءة تشمل اختبارات invariants وsmoke لطلبات الانضمام والعمليات والمشاركة والقرعة والمصادقة.
- Workflow الاختبارات يستخدم Node.js و`npm ci` و`npm test`، كما يوجد workflow لتشغيل SQL على Supabase محلياً، وworkflow لتحديث Service Worker.
- لم يتم تشغيل أي اختبار في هذه المراجعة. لا توجد نتيجة نجاح/فشل تنفيذية.

**MISSING**
- لا يوجد حتى الآن تقرير تغطية يربط كل قاعدة عمل وRPC وشاشة باختبار محدد.
- لم تُفحص كل assertions داخل ملفات الاختبار التسعة سطراً بسطر، ولم تُراجع قابلية SQL tests لإحداث تغييرات خارج transaction محلية.
- لم تُستخرج نتائج CI التفصيلية لكل workflow run.

## 6. Render

**CONFIRMED**
- خدمتا Static Site: `sahm-supabase-preview` و`sahm-supabase-preview-fixed`.
- كلتاهما Live وتشيران إلى المستودع نفسه والفرع `SAHM-SUPABASE` والـ Commit `21bf57b75f546849c362ee2a1deaf6c42b225ca0`.
- لم يتم تغيير أي إعداد أو نشر أو إيقاف خدمة.

**INFERRED**
- وجود خدمتين للمعاينة قد يسبب التباساً حول رابط المعاينة المرجعي، لكنه ليس خللاً مؤكداً. يجب تحديد الخدمة المعتمدة قبل توحيد النشر.

## 7. عناصر لم تُحسم بعد

1. استكمال قراءة كل ملفات Core/Data/Auth وملفات HTML/CSS/JS مع ربط كل وظيفة من واجهة المستخدم حتى استجابة DB.
2. جرد كل جداول DB وأعمدتها ومفاتيحها وعلاقاتها وفهارسها وسياسات RLS مع مصدر الحقيقة لكل مجال.
3. مراجعة bodies للدوال الحرجة، خاصة الإنشاء والعضوية والدعوات والتحصيل وتصحيح الإيصالات والقرعة والجدولة والإشعارات والمحادثة.
4. فحص Auth settings تفصيلياً، وربطها بتدفق التسجيل وتأكيد البريد واستعادة كلمة المرور.
5. حسم حالة كل migration mismatch بالـ checksum/الـ DDL لا بالاسم فقط.
6. فحص الاختبارات كلّها وتصنيفها وربطها بتغطية قواعد الأعمال، دون تشغيل أي اختبار على قاعدة الإنتاج.
7. فحص مسارات CSS والتكرار والتجاوب على الأجهزة، بما فيها الشاشات الصغيرة.
8. اختيار التقنية النهائية لإعادة البناء بعد إكمال تقييم التعقيد والاعتماديات وتدفق البيانات؛ لم يتم اعتماد React أو Vue أو Svelte أو Preact في هذا التقرير.
9. إعداد سجل نقل مركزي مفصل وخطة مراحل معايير قبول ومخاطر rollback.

## 8. قيود الفحص

- كل أعمال المستودع اقتصرت على `SAHM-SUPABASE`.
- لم يتم تعديل التطبيق أو قاعدة البيانات أو Render.
- لم يتم تشغيل الاختبارات.
- هذا تقرير مرحلي، وليس إعلان اكتمال التدقيق الشامل.
