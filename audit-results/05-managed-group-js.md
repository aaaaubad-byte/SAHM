# المرحلة 05 — تدقيق `sahm-managed-group.js` (مساحة الجمعية: المدير والعضو) وإغلاق ثغرات المرحلة 01

- المرجع: الفرع `SAHM-SUPABASE`، آخر Commit تطبيقي بشري `7e33e157…`.
- طبيعة العمل: قراءة فقط. لا تعديل على التطبيق ولا Supabase ولا Render.
- الحالة: **JS مكتمل (القراءة كاملة)**. **CSS (`sahm-managed-group.css`) يُوثَّق في `05b`**. **إغلاق ثغرات المرحلة 01 المتعلقة بـ HTML يحتاج قراءة موجّهة للـ HTML ويُؤجَّل إلى `05c` بعد مراحل قاعدة البيانات** (سبب التأجيل: حماية ما تبقى من الحصة؛ لا أعتبر تلك البنود محسومة).
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.
- الدليل: اسم الدالة داخل الملف (لا ترقيم أسطر في مخرج `read_file`).

## 1. تغطية القراءة

`sahm-managed-group.js` (91749 بايت): قُرئ كاملاً في استجابة واحدة، ينتهي بـ `root.SahmManagedGroup = { render, redraw }; })(window);`. لا اقتطاع.

## 2. دور الملف وعلاقته بالباقي (CONFIRMED)

- طبقة عرض «معزولة» تستهلك `SahmApp.*` وتعتمد على **متغيرات وحدات عامة معرّفة في سكربت HTML المضمن** دون استيراد: `escapeHtml, minorMoney, money, dateLabel, pill, uiIcon, shell, toast, go, isManager, currentGroup, currentGroupId, params, groupDetailTab, db, refreshData, syncNavigationContext, utcToAdenDateTime, drawAnimationPending` بالإضافة إلى `SahmApp` و`SahmCore`. وتُسند قيماً إلى `params` و`groupDetailTab` و`drawAnimationPending` (متغيرات `let` في نطاق HTML العام). هذا اقتران ضمني بترتيب التحميل (تأكيد للمرحلة 01).
- تُسجَّل مستمعات `document` للنقر (`click`) والإرسال (`submit`) **مرة واحدة** عند التحميل. بما أن ملف JS يُحمَّل قبل السكربت المضمن (المرحلة 01 §4)، فمستمع النقر هنا يعمل **أولاً** ويستدعي `stopImmediatePropagation` للإجراءات `managed-*` فلا يصل نقرها إلى معالج HTML. الإجراءات الأخرى (مثل `record-paid`) تمر إلى معالج HTML بعد `invalidateReads()`.
- يصدّر `SahmManagedGroup.render` و`redraw` فقط، ويعتمد على `window.managedInviteComposerMarkup` و`window.bindManagedInviteComposer` (معرفتان في HTML، تأكيد المرحلة 01).

## 3. خريطة الأقسام العشرة للمدير مع مسار البيانات (SCR/FN)

المعرّفات مقترحة، وتبني على جدول المرحلة 01 (SCR-013 تفويض إلى هذا الملف).

| القسم | الدالة | مصدر البيانات | الإجراءات الصادرة |
|---|---|---|---|
| 1 `installments` التحصيل | `installmentsPanel` + `bindInstallmentFilters` + `receiptHistoryPanel` | **محلي مشتق من اللقطة:** `SahmApp.installmentRows`, `receiptList` | `record-paid`, `send-reminder` (لكل صف)، تحديد مطوّل بالضغط (480 ملّي ثانية) ثم **تذكير جماعي**، `receipt-open` |
| 2 `draws` القرعات | `cycleCards` | **RPC:** `getDrawHistory`, `getDrawReadiness` + **محلي** `installmentRows` لكل جولة | لا شيء (بطاقات ثابتة `mgd-cycle-card-static`) |
| 3 `shares` الأسهم | `shareCards` | **RPC** `shareList` (`get_association_shares`) | مرشح الحالة فقط |
| 4 `members` الأعضاء | `memberCards` | **محلي** `memberList` | بحث/مرشح على العميل، لا إجراءات |
| 5 `invites` الدعوات | في `renderManagerSection` | **محلي** `inviteList` + **قراءة مباشرة من المتغير العام `db.joinRequests`** | `cancel-invite`, `approve-join-request`, `reject-join-request`، ومحرر الدعوات (`managedInviteComposerMarkup`) عند `canInvite` |
| 6 `chat` الدردشة | `chatPanel` | **محلي** `chatView` | نموذج `mgdChatForm` → `SahmApp.sendMessage` |
| 7 `room` الغرفة | `drawPanel(g,d,true)` | **RPC:** `getDrawRoom`, `getDrawReadiness`, `getFinancialSummary`, `getDrawHistory` | `schedule-draw`, `run-draw`, `draw-presentation-completed`, `draw-presentation-failed` |
| 8 `information` المعلومات | `managerInformationContent` | حقول نموذج العرض `g.*` و`d.plan` (من `SahmCore.groupPlan`) | لا شيء |
| 9 `settings` الإعدادات | `notificationSettingsPanel` | **محلي** `d.group.notify/notifyChat/notifyNames` | `notify-channel-toggle` (يعالجه HTML) |
| 10 `audit` السجل | `auditPanel` | **RPC** `getAuditLog` (`get_association_audit_log`) | لا شيء |

**للعضو** (`memberDashboard` والتبويبات): `installments` (محلي `memberStatement`)، `shares` (RPC `myShareList`)، `draws` (محلي `drawHistory` لعدّاد فقط ثم غرفة قرعة `drawPanel` غير مدير عبر RPC)، `communication` ← `news` (RPC `getNews`) و`chat` (محلي).

## 4. النتائج (F-05-)

### F-05-01 — وظائف لها عمليات على الخادم وليس لها مُصدِر في واجهة المدير — CONFIRMED في هذا الملف، INFERRED على مستوى التطبيق
لا يوجد في `sahm-managed-group.js` أي زر أو إجراء لـ:
- **إدارة الرابط العام** (إنشاء/إيقاف/استئناف/تجديد/إبطال): لا `create-group-link` ولا `pause-group-link` ولا `rotate-group-link` ولا `revoke-group-link` ولا عرض حالة الرابط. القسم «الدعوات» لا يعرض الرابط ولا حالته. (وفق المرحلة 01 هذه الإجراءات تُصدَر فقط من `memberReception()` اليتيمة، وسيُغلق البند في 05c بقراءة `managedInviteComposerMarkup` في HTML.) **الأثر المحتمل:** بعد الإنشاء (شاشة «تم إنشاء الجمعية» تعرض الرابط) لا مسار ظاهر للمدير لإيقاف رابط مسرَّب أو تجديده، رغم وجود RPC `manage_association_public_link`.
- **تعديل الجمعية** `updateGroup` (RPC `update_association`): قسم «الإعدادات» عرض فقط (حالة الاتفاق + إعدادات النشر).
- **إضافة/تقليل أسهم وإزالة عضو** `addShares`/`removeShares`/`removeMember`: قسم «الأعضاء» قائمة قراءة فقط.
- **كتم الجمعية** `setMute`: لا عنصر `mute-toggle` هنا (والمعالج في HTML بلا مُصدِر حسب المرحلة 01).
- **تصحيح الإيصال:** يتم من شاشة الإيصال (`receipt-open` ← SCR-023، والمرحلة 01).
هذه الوظائف **ليست مثبتاً أنها غير مستخدمة**: يلزم نفي المُصدِرين في HTML (05c) قبل أي تصنيف.

### F-05-02 — بقايا مسارات تبويب المدير القديمة بلا أثر — CONFIRMED (المنطق)، DEPRECATED CANDIDATE
- `render()` يخرج مبكراً لكل مدير إلى `renderManagerSection` (التعليق: «The legacy tab-driven manager path is bypassed»). لذلك:
  - `tabs(active, manager)` تعيد `''` للمدير، وفرع `commitRender` الخاص بـ `installments && manager` لا يُبلَغ.
  - الإجراء `managed-tab` للمدير يضبط `groupDetailTab` ويفرغ `params`، فيعود `renderManagerSection` بـ`section=''` إلى `managerDashboard` (لا أثر).
  - `managed-draw-view` للمدير: `if (manager) return;` (لا أثر).
  - `managed-open-member` و`managed-open-cycle`: للمدير لا أثر، وللعضو يستدعيان `go('group-detail', {managedView:'member'|'cycle'})`. **لا مُصدِر لهذين الإجراءين في هذا الملف** (`memberCards` و`cycleCards` تُنتجان بطاقات ثابتة `*-static` بلا `data-action`). وبالتالي فرع العرض `view === 'member'` و`view === 'cycle'` والدالة `cycleDetail` **غير قابلة للوصول من هذا الملف** (مُصدِر في HTML NOT VERIFIED). **DEPRECATED CANDIDATE** لا حذف.
- `drawPanel` بمعاملاته غير `allViews` ما زال يُستعمل لعرض غرفة قرعة العضو (`view === 'draw'`).

### F-05-03 — الوصول المباشر إلى المتغير العام `db` من الواجهة — CONFIRMED
- قسم الدعوات يقرأ `db.joinRequests` مباشرة (وليس عبر `SahmApp`)، مخالفاً قاعدة رأس `sahm-app.js`: «screens never touch db arrays». ويعتمد على شكل بيانات الخادم (`submittedAt`, `applicantName`, `requestedShares`...) لا على واجهة موحدة، فلا مقابل محلي لها (F-02-07).

### F-05-04 — ذاكرة القراءة المؤقتة `readCache`: إبطال متأخر وغير شامل وغير مرتبط بالمستخدم — CONFIRMED (الآلية)، الأثر INFERRED
- `cachedRead(key, loader, ttl)` يخزن نتائج RPC في `Map` على مستوى الوحدة لمدد 7–15 ثانية (`draw-ready` و`draw-room` 7s، `news`/`audit`/`shares`/`financial` 12s/7s، `history` 15s).
- **الإبطال يحدث لحظة النقر (قبل اكتمال العملية):** المستمع ينفّذ `invalidateReads()` عند النقر على `record-paid`, `send-reminder`, `schedule-draw`, `run-draw`, `draw-presentation-*`, `notify-channel-toggle`, `approve-join-request-confirm`. أي إعادة رسم أثناء تنفيذ العملية (حدث Realtime مثلاً) تعيد ملء الذاكرة ببيانات **قبل** الأثر، فتبقى الأقسام (سجل القرعات، الجاهزية، الأسهم) قديمة حتى 15 ثانية.
- إجراءات تغيّر الحالة **غير مدرجة** في قائمة الإبطال: `cancel-invite`, `reject-join-request(-confirm)`, تصحيح الإيصال، الانضمام عبر الموافقة (تأثيرها على `shares:` و`audit:` و`news:`).
- المفتاح يتضمن معرّف الجمعية فقط **وليس المستخدم**، ولا تُمسح الذاكرة عند الخروج أو تبديل الحساب. تبديل حساب خلال مدة الصلاحية على الجمعية نفسها قد يعرض نتيجة RPC خاصة بالحساب السابق (مثلاً `draw-room` أو `audit`). احتمال ضعيف لكن الأثر خصوصية. INFERRED.

### F-05-05 — عمليات كتابة أثناء الرسم — CONFIRMED
- `chatPanel` يستدعي `SahmApp.markChatRead(g.id)` **داخل دالة بناء العرض** (بلا انتظار). في المسار البعيد هذا `upsert` على `chat_read_states` عند **كل** إعادة رسم لقسم الدردشة (بما فيها كل حدث Realtime يُعيد الرسم). عملية كتابة بلا إجراء مستخدم، وتُوسّع أثر F-03-D6 (انحراف ساعة الجهاز).

### F-05-06 — إرسال رسالة يُنتج تحديثين كاملين على الأقل — INFERRED (يتطلب تأكيد `refreshData` في HTML)
- بعد `SahmApp.sendMessage` (التي تنفذ لقطة كاملة، F-03-D1) يستدعي المعالج `invalidateReads(); refreshData(); redraw();`. إن كانت `refreshData` (HTML) تعيد قراءة اللقطة فهذا لقطة ثانية لنفس العملية. NOT VERIFIED.
- حد الطول يُفحص بـ`message.length` (وحدات UTF-16) بينما `SahmData.msgLength` تعد نقاط الكود (`Array.from`). فروق عند الإيموجي. حد الخادم NOT VERIFIED.

### F-05-07 — «الغرفة» للمدير: تعديل متغير عام أثناء انتظار غير متزامن، ولا تدوير لعجلة القرعة — CONFIRMED (المنطق)، الأثر INFERRED
- `drawPanel(g,d,true)` يعرض الأقسام الخمسة بتغيير `params.managedDrawView` عالمياً داخل حلقة `await` ثم يعيده في `finally`. أي حدث يعدّل `params` أثناء الانتظار (نقرة، تنقل) يُطمس عند الاسترجاع.
- العجلة `drawWheelMarkup` تستهلك `drawAnimationPending` عند **أول** استدعاء (قسم الملخص) وتضع `transform: rotate(0)` مع `transition`. لكن **التدوير النهائي** (`requestAnimationFrame` الذي يضبط `data-final-rotation`) موجود فقط في فرع العضو `view === 'draw'` وليس في `renderManagerSection('room')`. فالمتوقع للمدير بعد `run-draw`: عجلة الملخص تبقى عند 0° والعجلة الثانية (قسم النتيجة) تظهر بالدوران النهائي دون حركة. **INFERRED من الكود (يلزم تشغيل فعلي، لا يُنفَّذ هنا).**
- العجلة تتكرر مرتين في الصفحة (الملخص والنتيجة) ولا تتحقق من تطابق العناصر الحاملة للمعرّفات بعد حذف `id` الخاص بالـpanel بتعبير نمطي.

### F-05-08 — أشكال زمنية غير متسقة داخل الواجهة — CONFIRMED
- موعد القرعة: `SahmCore.fmtDateTime(..., 'Asia/Aden')` (صحيح)، وحقل الإدخال `utcToAdenDateTime`.
- الدردشة: `chatTime` (UTC، F-03-D5).
- الأخبار وسجل العمليات: `esc(x.occurred_at)` **الطابع الخام ISO** دون تنسيق ولا منطقة.
- تواريخ أخرى عبر `dateLabel(String(x).slice(0,10))` (تقطيع نص ISO قد يعطي تاريخ UTC).

### F-05-09 — ثلاثة أشكال لـ«الجمعية» في الواجهة — CONFIRMED (سلاسل الاحتياط)
- الكود يقرأ `g.start || g.startDate`, `g.first || g.firstDrawOn`, `g.share`, `g.shares`, `g.admin`, `g.periodDays || g.cycleDays`: شكل «نموذج عرض» تُنتجه `load()` في HTML (غير مقروء الآن)، بجانب `db.groups` (المخزن) و`d.group` (من `groupDetail`). سلاسل `||` دليل على عدم وجود عقد واحد.

### F-05-10 — مصادر متعددة لقرار «الإنجاز/التحصيل» — CONFIRMED (وجود الاثنين)
- نسبة «تحصيل القرعة الحالية» في لوحة المدير وفي الهوية تُحسب محلياً من `installmentRows`، بينما قسم «الغرفة» يعرض «الملخص المالي» (المستلم/المتبقي/المتأخر) من RPC `getFinancialSummary`، والجاهزية من RPC `getDrawReadiness`. قد تتباين أرقام الشاشتين (F-03-D3). عدّاد القرعات للمدير من RPC (`getDrawHistory`) وللعضو من المحلي (`drawHistory`).

### F-05-11 — قرار «القسط الحالي» مكرر — CONFIRMED
- `currentInstallmentNo` يحدد القسط الحالي بمقارنة تاريخ اليوم (`SahmApp.todayIn` بساعة الجهاز) بحدود الفترة، بجانب `SahmCore.locate`/`instRange` (غير مستعملة هنا) وإعادة التهيئة المتضاربة للحالة: `render()` يضبط `state.installment='all'` عند تغيير الجمعية، و`installmentsPanel` يضبطه `'current'` عبر متغير تتبع مختلف (`installmentSelectionGroupId`). النتيجة الفعلية للمدير `'current'`.

### F-05-12 — أداء الرسم — INFERRED
- `cycleCards` يستدعي `SahmApp.installmentRows` **لكل جولة** (عدد الجولات = عدد الأسهم) وكل استدعاء يمر على أعضاء × أقساط مع مسح الإيصالات (F-02-13). و`identity` و`installmentsPanel` و`update()` يستدعون الدالة نفسها أكثر من مرة في العرض الواحد.

### F-05-13 — تأثير «الاتفاق المقفل» محسوب على ساعة الجهاز — CONFIRMED (مصدر القرار)
- `canInvite` و`agreementLocked` يأتيان من `SahmApp.groupDetail` المحلي (`startReached` يعتمد `nowAt` بساعة الجهاز). قسم «الإعدادات» يعرضهما حالة رسمية. الخادم يفرض بنفسه (NOT VERIFIED) لكن واجهة المدير قد تعرض «مفتوح/مقفل» خطأً عند خطأ ساعة الجهاز.

### F-05-14 — السلامة من XSS في هذا الملف — CONFIRMED (إيجابي)
- كل القيم المتغيرة تمر عبر `esc(...)` (أسماء، ملاحظات، نصوص أخبار، `JSON.stringify(after_data)` داخل `<pre>`)، وعناوين الأزرار الثابتة فقط غير مهرّبة (`actionButton(label,...)`). لم أجد حقن `innerHTML` من نص خام. (`pill()` و`uiIcon()` و`dateLabel()` معرّفة في HTML وتُفحص هناك.)

### F-05-15 — حوارات أصلية للمتصفح — CONFIRMED
- التذكير الجماعي يستعمل `window.confirm` (مرتين) لا نوافذ التطبيق، ويرسل **متتابعاً** بلا حد أقصى، ثم `SahmApp.refreshStore()` مرة واحدة (نمط جيد يتجنب لقطة لكل تذكير) مع تقرير الفشل الجزئي.

### F-05-16 — مؤقت اللوحة — CONFIRMED (تسرب صغير)
- `dashboardTimer` (كل 5 ثوانٍ) يُلغى عند بداية كل `render()` فقط. عند مغادرة الشاشة عبر `go()` من HTML بلا `render` يبقى المؤقت يعمل على عقدة معزولة.

## 5. مستهلكو `SahmApp` الذين ظهروا في هذا الملف (تحديث للمراحل 02 و03)

| الاسم | المستهلك هنا | ملاحظة |
|---|---|---|
| `installmentRows`, `memberStatement`, `memberList`, `receiptList`, `inviteList`, `chatView`, `groupDetail` | نعم | محلية مشتقة |
| `drawHistory` (محلي) | `memberDraws` (للعدّ فقط) | مقابل `getDrawHistory` للمدير |
| `shareList`, `myShareList`, `getDrawRoom`, `getDrawHistory`, `getDrawReadiness`, `getFinancialSummary`, `getNews`, `getAuditLog` | نعم | RPC |
| `sendReminder` بـ`skipRefresh` | نعم (التذكير الجماعي) | **يُجيب عن سؤال المرحلة 03** |
| `refreshStore`, `sendMessage`, `markChatRead`, `maxMessage`, `notifyTypes`, `todayIn`, `chatTime` | نعم | |
| `tick`, `addMember`, `joinByCode`, `createInvite`, `setAttendance`, `updateGroup`, `addShares`, `removeShares`, `removeMember`, `setMute`, `drawStatus`, `eventLog`, `myInvitations`, `notificationList` | **لا** | **NOT VERIFIED في HTML**؛ مرحلة 05c |

## 6. ثغرات المرحلة 01: الحالة بعد هذه المرحلة

| البند | الحالة |
|---|---|
| `chat()` و`invites()` غير معرّفتين | **مؤكَّد غيابهما في كل ملفات JS الستة المقروءة الآن** (core, data, app, navigation, supabase, supabase-data, managed-group). الـHTML فُحص نصياً في المرحلة 01 فقط. يبقى **INFERRED** أنهما غير قابلتين للوصول (انظر `screenName`). 05c |
| `pendingInvitees` بلا تصريح | لا يظهر في أي ملف JS آخر. 05c |
| شاشات يتيمة `member-reception`/`invite`/`join-requests` | الموافقة/الرفض/إلغاء الدعوة/إنشاء الدعوات متاحة الآن في قسم «الدعوات» هنا (`approve-join-request`, `reject-join-request`, `cancel-invite`, المحرر). فتقوى فرضية أنها **DEPRECATED CANDIDATE**. `join-request-detail` ما زالت قابلة للوصول من النشاط والإشعارات (المرحلة 01) فلا تُعدّ يتيمة |
| إدارة الرابط العام | **لا واجهة لها في هذا الملف** (F-05-01) |
| معالجات بلا مُصدِر (`group-tab`, `detail-tab`, `mute-toggle`, `copy-created-link`, `accept-legacy-invitation-inbox`, `join-late-confirm`, `bioToggle`) | **لا مُصدِر لها هنا**. تبقى DEPRECATED CANDIDATE |
| أقسام المدير الخمسة غير المقروءة (`chat, room, information, settings, audit`) | **مغلق:** موثقة في القسم 3 |
| واجهة العضو وتبويباتها | **مغلق:** موثقة في القسم 3 |
| `news` غير ضمن أقسام المدير | **مؤكَّد:** القسم الأنسب للمدير هو «السجل» (`audit`) ولا أخبار. المدير لا يرى `getNews` (للأعضاء فقط) |

## 7. ما تبقى

1. **05b:** `sahm-managed-group.css`.
2. **05c:** قراءة HTML الموجّهة لإغلاق: مُصدِرو الإجراءات في F-05-01 و`mute-toggle` و`managed-open-*`، وتعريف `chat()`/`invites()`/`pendingInvitees`، واستدعاءات `tick/addMember/joinByCode/createInvite/setAttendance`، وحقول رابط الدعوة في `managedInviteComposerMarkup`.
3. مطابقة ما يفترضه هذا الملف من حقول RPC (`round_no`, `winner_owner_name`, `winner_index`, `room.eligible_shares`, `room.cycle.due_on`, `x.subject_visible`...) مع تعريفات الدوال الفعلية في المرحلة 07.

## 8. نقطة الاستئناف

التالي: `05b` (CSS) ثم المرحلة **06** (الجداول والعلاقات والقيود والفهارس وRLS والـView)، ثم 07 (الدوال والـTriggers وcron وRealtime)، ثم 08–12، ثم `05c`.
