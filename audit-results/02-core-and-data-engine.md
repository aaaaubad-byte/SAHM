# المرحلة 02 — تدقيق `sahm-core.js` و`sahm-data.js` (محرك القواعد وطبقة البيانات المحلية)

- المرجع: الفرع `SAHM-SUPABASE`، آخر Commit تطبيقي `69259582c5c7c4660fed3ab53f92e3ee8e755117` (ما بعده Commits تدقيق وأختام بوت فقط).
- طبيعة العمل: قراءة فقط. لا تعديل على التطبيق ولا Supabase ولا Render.
- الحالة: **مكتملة لنطاق الملفين**. تتبع المستهلكين في الملفات الأخرى **غير مكتمل بعد** ويُغلق في المراحل 03 و04 و05 (مبيّن في القسم 8).
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.
- **عن الأدلة:** خرج `read_file` كنص JSON بلا ترقيم أسطر، لذلك الدليل هنا **اسم الدالة داخل الملف** (وليس رقم السطر). أرقام الأسطر تُضاف حيث يتوفر ترقيم في مراحل لاحقة.

## 1. تغطية القراءة

| الملف | الحجم المعروف (المرحلة 0) | القراءة | ملاحظة |
|---|---|---|---|
| `sahm-core.js` | 41882 بايت | كاملة، في استجابة واحدة | انتهت بتصدير `root.SahmCore = {...}` فلا اقتطاع |
| `sahm-data.js` | 100678 بايت | كاملة، في استجابة واحدة | انتهت بتصدير `root.SahmData = {...}` فلا اقتطاع |
| `sahm-app.js` | 4870 بايت | كاملة (قُرئ لتتبع المستهلكين) | يُستكمل تحليله في المرحلة 03 |

لم أعدّ البايتات المستلمة بنفسي؛ الحكم بعدم الاقتطاع مبني على اكتمال البنية وخاتمة الملف.

## 2. الأدوار الفعلية للملفات

- **`sahm-core.js` (`window.SahmCore`)**: دوال حساب وتحقق، بلا DOM ولا تخزين. المبالغ أعداد صحيحة بالوحدة الصغرى والتواريخ نصوص ISO. يصرّح الرأس بأنه **يعكس عقد قاعدة البيانات** (CONFIRMED كتصريح، وصحة المطابقة **NOT VERIFIED** حتى المرحلتين 06 و07).
- **`sahm-data.js` (`window.SahmData`)**: مخزن محلي (localStorage) مع إصدار، وعمليات ذرية (`transact`)، وصلاحيات، وسجل أحداث، وإشعارات، ومحادثة، واستعلامات حسب المشاهد. يصرّح الرأس بأنه «المصدر الوحيد للحقيقة للمعاينة».
- **`sahm-app.js` (`window.SahmApp`)**: غلاف يحقن `(db, viewer)` ويستدعي `SahmData[name]` **بالاسم من قوائم ثابتة** (`ACTOR_OPS` و`VIEW_QUERIES` و`PLAIN`)، ويحتفظ بنسخة `db` واحدة، ويوفر `useRemoteStore(remoteStore)` لاستبدال النسخة بلقطة من الخادم (CONFIRMED).
- **ملاحظة منهجية مهمة (CONFIRMED):** لأن `SahmApp` يستدعي بالاسم عبر `D()[n]`، فالبحث النصي عن `SahmData.recordPaid` مثلاً **لا يجد مستهلكيها**. المستهلك الحقيقي يكتب `SahmApp.recordPaid`. أي حكم «غير مستخدمة» يجب أن يبحث عن `SahmApp.<name>` وعن الاستدعاء الديناميكي.

## 3. قواعد الأعمال في `sahm-core.js` (RULE-)

معرّفات مقترحة. كل قاعدة مع دالتها.

| المعرّف | القاعدة | الدالة | الحالة |
|---|---|---|---|
| RULE-C01 | تحليل المبلغ عشرياً دقيقاً بلا float، يرفض غير الموجب وما فوق `1e13` ويقبل الأرقام العربية والفارسية | `parseMoney`, `normDigits` | CONFIRMED |
| RULE-C02 | العملات: YER بلا كسور، SAR وUSD بمنزلتين عشريتين | `CURRENCIES` | CONFIRMED |
| RULE-C03 | توزيع أيام الدورة على الأقساط: الباقي يُسند إلى **الأقساط الأولى**، والفترات متتالية | `periods` | CONFIRMED |
| RULE-C04 | قسمة المبلغ: القسط الأخير يمتص كل باقي القسمة | `splitAmount` | CONFIRMED |
| RULE-C05 | وضع القسط الثابت: `count == ceil(total/fixed)` والأخير يحمل الباقي | `installmentAmounts` | CONFIRMED |
| RULE-C06 | حالة القسط: مدفوع / لم يحن / مستحق (حتى آخر يوم في الفترة) / متأخر | `instStatus` | CONFIRMED |
| RULE-C07 | قفل الاتفاق: يُقفل عندما يبلغ **التاريخ المحلي للجمعية** تاريخ البداية، أو عند أول قرعة | `isAgreementLocked`, `agreementLock`, `isFrozen`, `isLocked` | CONFIRMED |
| RULE-C08 | الالتزام: القسط يُحسب لكل سهم؛ يُعدّ «متأخراً بسبب الانضمام» إن أُضيف السهم بعد نهاية فترته | `obligation` (`lateByJoin`) | CONFIRMED |
| RULE-C09 | جاهزية القرعة: كل الأقساط حتى الجولة مسددة بالكامل وللجمعية أسهم | `drawReadinessLocal`, `cumulativeSummary` | CONFIRMED (نسخة محلية تقول إنها تعكس `get_association_financial_summary`) |
| RULE-C10 | بوابة القرعة: يوم الاستحقاق ثم الوقت المحدد (إن وُجد) ثم الجاهزية | `drawGate`, `drawTimeReached`, `checkDrawSchedule` | CONFIRMED |
| RULE-C11 | الجائزة = عدد الأسهم × قيمة السهم | `prizeTarget`, `prizeInfo` | CONFIRMED |
| RULE-C12 | اختيار الفائز بعشوائية آمنة غير متحيزة (`crypto.getRandomValues` برفض العينات الزائدة) | `pickWinner` | CONFIRMED |
| RULE-C13 | التحقق من إنشاء جمعية «موحدة» بالتواريخ (الاسم 2–120، مدة 1–3650 يوماً، قسط ثابت أو عدد أقساط، مدير فقط/ومشارك) | `validateUnifiedGroup` | CONFIRMED |
| RULE-C14 | التحقق القديم بدورة (أسبوعية/شهرية/مخصصة) والعدد المستهدف والحد الأقصى للفرد (الاسم ≤ 60، القواعد ≤ 2000) | `validateGroup` (فرع قديم)، `validateBasics` | CONFIRMED |
| RULE-C15 | آلة حالات طلب الانضمام: `pending` فقط ينتقل، المتقدم يلغي والمدير يوافق/يرفض | `nextJoinRequestStatus` | CONFIRMED |
| RULE-C16 | آلة حالات الرد على الدعوة: من `pending_response` أو `deferred` فقط إلى `interested/declined/deferred` | `nextInvitationResponseStatus` | CONFIRMED |
| RULE-C17 | ملخص طلبات الانضمام: الأسهم المقبولة وحدها تُحسب | `summarizeJoinRequests` | CONFIRMED |
| RULE-C18 | الدعوة «القديمة» هي ما له `shares_requested` عدد صحيح موجب | `isLegacyInvitation` | CONFIRMED |
| RULE-C19 | إعدادات النشر في المحادثة: ثلاث خرائط (`feed` و`chat` و`names`) لثمانية أنواع | `normalizeNotifySettings`, `NOTIFY_TYPE_IDS` | CONFIRMED |

## 4. العمليات والاستعلامات في `sahm-data.js` (FN-)

**عمليات تغيّر الحالة (كلها داخل `transact`، تتحقق من المدير بـ `needManager`، وتعيد `{ok,...}`):**
`createGroup`, `updateGroup`, `addMember`, `addShares`, `removeShares`, `removeMember`, `createInvite`, `cancelInvite`, `joinByCode`, `recordPaid`, `correctReceipt`, `sendReminder`, `performDraw`, `sendMessage`, `markChatRead`, `setNotifyType`, `setMute`, `markNotificationsRead`.

**عمليات تعيد خطأ ثابتاً في الوضع المحلي (CONFIRMED):**
- `setAttendance` ترجع `ATTENDANCE_RETIRED`.
- `createInvitationsBulk` ترجع `REMOTE_REQUIRED` (بعد التحقق من المدير) وتقول إن الروابط الآمنة تنشئها RPC فقط.
- `managePublicLink` ترجع `REMOTE_REQUIRED`.

**استعلامات (حسب المشاهد، المدير يرى الكل والمشارك نفسه فقط):**
`groupDetail`, `installmentRows`, `memberStatement`, `receiptList`, `receiptDetail`, `eventLog`, `memberList`, `shareList`, `myShareList`, `inviteList`, `myInvitations`, `drawHistory`, `notificationList`, `chatView`, `drawStatus`, `previewJoin`, `inviteSummary`, `getInviteInfo`, `lastReminder`, `myGroups`, `chatList`, `recentActivity`, `groupSummary`, `unreadCount`, `totalUnreadNotifications`.

**التخزين (CONFIRMED):** مفاتيح `sahm_preview_data_v4` و`sahm_preview_prefs_v1` و`sahm_archive_v1`، ومفاتيح قديمة `sahm_preview_db` و`sahm_preview_data_v3`. الأرشفة قبل الاستبدال، وتعليق الكتابة (`holdWrites`) إن فشلت الأرشفة. ترحيل وحيد من `v3` إلى `v4`.

**البذرة:** `buildSeed` تبني 4 جمعيات نموذجية (`g1`–`g4`) بأسماء أشخاص ومبالغ وإيصالات وقرعات ومحادثات. `defaultPrefs()` تعرّف مستخدماً ثابتاً `id:'me'` باسم «أحمد محمد» وهاتف `+967 777 123 456` ومدينة «تعز» (CONFIRMED).

## 5. المستهلكون المعروفون (ما أمكن إثباته من الملفات المقروءة)

- **`SahmData` ← `SahmApp`:** كل عملية واستعلام في القوائم الثلاث أعلاه مربوط بالاسم. أسماء في `ACTOR_OPS` **ليس لها تعريف** في `SahmData`: لا شيء (كل الأسماء الواحدة والعشرين موجودة في التصدير؛ تحققتُ منها واحداً واحداً). CONFIRMED.
- **`SahmData` ← `SahmCore`:** تستعمل `sahm-data.js` الدوال التالية من النواة: `validateGroup`, `parseMoney`, `firstDrawDurationDays`, `groupPlan`, `groupShares`, `memberShares`, `groupMembers`, `obligation`, `cycleObligations`, `memberProgress`, `lateJoinPreview`, `drawReadinessLocal`, `drawTimeReached`, `eligibleShares`, `shareLabel`, `pickWinner`, `prizeTarget`, `prizeInfo`, `durationInfo`, `roundDate`, `firstDrawDate`, `currentCycle`, `instRange`, `shareAmounts`, `isLocked`, `isValidDate`, `diffDays`, `addDays`, `toDay`, `fmtDate`, `fmtMoney`, `cycleLabel`, `memberCommitment`, `presentationState`, `STATUS_LABEL`, `CURRENCIES`. CONFIRMED.
- **دوال النواة التي لا يستعملها أي من الملفات الثلاثة المقروءة** (لا يعني أنها غير مستخدمة؛ مستهلكوها المحتملون في `sahm-supabase-data.js` و`sahm-managed-group.js` والـ HTML وتُفحص لاحقاً): `toMinor`, `fmtDateTime`, `isAgreementLocked`, `agreementLock`, `isFrozen`, `maxInstallments`, `locate`, `memberArrears`, `cumulativeSummary` (داخلية)، `checkDrawSchedule`, `drawGate`, `normalizeReadiness`, `wheelLayout`, `normalizeNotifySettings`, `notifyTypesOf`, `JOIN_REQUEST_STATUS`, `INVITATION_RESPONSE_STATUS`, `isJoinWindowOpen`, `nextInvitationResponseStatus`, `nextJoinRequestStatus`, `hasPendingJoinRequest`, `summarizeJoinRequests`, `isLegacyInvitation`, `validateBasics`, `localDateIn`, `todayIn`, `isValidTimeZone`. **كلها NOT VERIFIED كمستخدمة أو غير مستخدمة.** لا تُصنَّف DEPRECATED CANDIDATE قبل فحص المستهلكين الآخرين.

## 6. النتائج المثبتة (F-02-)

### F-02-01 — قرار «قفل الاتفاق» مُنفّذ في مكانين بساعتين مختلفتين — CONFIRMED
- **النواة:** `isAgreementLocked` و`agreementLock` تستعملان `localDateIn(tz, now)` وافتراضه `new Date()` الحقيقي.
- **البيانات:** `startReached(g)` تستعمل `todayOf(g)` ثم `nowAt` التي تدعم **ساعة بديلة** (`setClock`). وتُستهلك في `needLocked` و`updateGroup` و`groupDetail`.
- **الأثر:** القاعدة نفسها (التاريخ المحلي ≥ تاريخ البداية) لها تنفيذان. عند استبدال الساعة في الاختبارات تتباعد النتيجتان. مستهلكو `isFrozen` في النواة **NOT VERIFIED**.

### F-02-02 — تعريفان مختلفان لـ«باب الانضمام مفتوح» — CONFIRMED (الاختلاف)، الأثر NOT VERIFIED
- **النواة:** `isJoinWindowOpen(startDate, tz, now)` = `التاريخ المحلي < تاريخ البداية`.
- **البيانات:** `inviteWindow(g, today)` تعتمد `inviteOpensOn` و`inviteClosesOn` وتتجاهل تاريخ البداية، ويُضاف إليها `needLocked` (البداية/أول قرعة) في `createInvite` و`joinByCode`.
- **الأثر:** يمكن أن تُعرض الواجهة «مفتوحاً» بتعريف و«مغلقاً» بالآخر. أي التعريفين تعتمده الواجهة الفعلية يُحسم في المراحل 03 و05، وما يقوله الخادم يُحسم في 06 و07.

### F-02-03 — قاعدة بوابة القرعة بنسختين — CONFIRMED
- **النواة:** `drawGate` تقارن `localDateIn(tz, now) < due` بالساعة الحقيقية.
- **البيانات:** `drawStatus` تقارن `today >= sched` بالساعة البديلة، وتستعمل `drawReadinessLocal` للجاهزية.
- **الأثر:** مصدران للقرار نفسه. وللجاهزية نسخة ثالثة قادمة من الخادم (`normalizeReadiness` تحوّل `ready/reasons/...` بأسماء snake_case). أيّها تستعمله الواجهة في الوضع البعيد **NOT VERIFIED**.
- **اختلاف قد يكون مقصوداً (INFERRED):** `checkDrawSchedule` تشترط أن يكون **اليوم** هو يوم الاستحقاق بالضبط لجدولة وقت، بينما `drawGate` و`drawStatus` تسمحان بالقرعة من يوم الاستحقاق فصاعداً.

### F-02-04 — تعارض الافتراضات في إعدادات النشر — CONFIRMED
- **النواة** `normalizeNotifySettings`: الافتراضي لـ `feed` و`chat` = **كل الأنواع الثمانية مفعّلة**، والأسماء ظاهرة لـ `drawResult` فقط، بدعوى أنها «database defaults».
- **البيانات** `DEFAULT_NOTIFY`: `joined:0` و`motivate:0` (غير مفعّلين). والبذرة تفعّل `motivate` في `g1` و`g4` فقط.
- **نموذجان للبيانات نفسها:** خريطة واحدة `g.notify` (محلياً، عبر `setNotifyType`) مقابل ثلاث خرائط (النواة). وفي الواجهة (المرحلة 01) `SahmApp.setNotifyType`/`setNotifySettings` (الأخيرة ليست في `SahmApp` المقروء، انظر F-02-07).
- **المرجع الحاكم:** الافتراضيات الفعلية في أعمدة قاعدة البيانات (`feed_enabled_types` وما شابه). **NOT VERIFIED** حتى المرحلة 06.

### F-02-05 — `createInvite` تفشل دائماً للجمعيات «الموحدة» محلياً — CONFIRMED (في الكود)، الوصول الفعلي NOT VERIFIED
- في `createGroup` الجمعية الموحدة تُخزَّن بـ `maxPerMember: null` و`targetShares: null`.
- `createInvite` تنفذ `if (n > g.maxPerMember) throw MAX_PER_MEMBER`، و`n > sum.remaining` حيث `remaining = null` عند `targetShares == null`. في JavaScript المقارنة `1 > null` صحيحة (`null` يتحول إلى 0)، فتُرفع `MAX_PER_MEMBER` دائماً.
- بينما `addMemberCore` و`addShares` و`previewJoin` تفحص `!= null` أولاً (تتعامل مع null صحيحاً). فالتناقض داخل الملف نفسه.
- **هل يصل إليها المستخدم؟** الواجهة تستدعي `SahmApp.createInvitationsBulk` (ترجع `REMOTE_REQUIRED` محلياً). المسار القديم `createInvite` يبدو ميتاً (INFERRED) لكن لا يُحكم قبل فحص `sahm-supabase-data.js` و`sahm-managed-group.js`.

### F-02-06 — هوية ثابتة `'me'` وبيانات بذرة تظهر عند غياب لقطة الخادم — CONFIRMED (الكود)، الأثر NOT VERIFIED
- `defaultPrefs()` تعرّف مستخدماً وهمياً. `SahmApp.init()` تستدعي `SahmData.load()` إن لم تكن `db` موجودة، و`load()` **تبني البذرة وتكتبها في localStorage** إذا لم يوجد مخزن.
- `unreadCount` تستثني رسائل `m.userId !== 'me'` **بنص ثابت** بدل المشاهد الحالي. في الوضع البعيد المشاهد هو UUID، فتُحسب رسائل المستخدم نفسه غير مقروءة إلا إن عيّنت لقطة الخادم المعرّف `'me'` (يُفحص في المرحلة 03).
- `useRemoteStore` تتحقق فقط من وجود `groups` و`prefs.user.id`، ولا تفحص باقي المصفوفات (`draws`, `receipts`, `events`, ...) ولا تُطبّق `normalizeDb`. أي دالة استعلام تفترض وجودها قد ترمي TypeError إن غابت. هل تضمن `sahm-supabase-data.js` وجودها **NOT VERIFIED**.
- **السؤال الأمني/التشغيلي:** هل يمكن أن يرى مستخدم حقيقي بيانات البذرة (جمعيات «الأهل» و«زملاء العمل») بين تسجيل الدخول واكتمال تحميل اللقطة؟ يُفحص في المرحلة 03.

### F-02-07 — عمليات تستدعيها الواجهة ولا وجود لها في `SahmData` ولا في قوائم `SahmApp` — CONFIRMED (الغياب هنا)
أسماء ذُكرت في المرحلة 01 بصيغة `SahmApp.<name>`: `setDrawScheduledAt`, `getDrawRoom`, `setDrawPresentationStatus`, `approveJoinRequest`, `rejectJoinRequest`, `submitJoinRequest`, `submitJoinRequestByInvitation`, `respondToInvite`, `setNotifySettings`.
- لا تعريف لأي منها في `sahm-data.js` ولا في `ACTOR_OPS` أو `VIEW_QUERIES` أو `PLAIN` في `sahm-app.js`.
- **الاستنتاج (INFERRED):** تُضاف إلى `SahmApp` من `SahmSupabaseData.install()` فقط. أي أن الوضع المحلي لا يدعم طلبات الانضمام ولا جدولة القرعة ولا عرضها. **تأكيد ذلك والمصدر الفعلي في المرحلة 03.**
- شاهد إضافي: `normalizeDb` تنشئ `db.joinRequests` مصفوفة لكن لا تُعرّف أي عملية محلية عليها.

### F-02-08 — حقول قادمة من نموذج الخادم لا يُنتجها المخزن المحلي — CONFIRMED
- `drawStatus` تقرأ `g.drawScheduledAt` ولا تضبطها أي عملية محلية.
- `drawHistory` تقرأ `d.cycleStatus` و`d.drawScheduledAt`.
- `recentActivity` تقرأ `e.eventType` و`e.entityId`.
- `myInvitations` تقرأ `i.invitedUserId`.
- **الخلاصة:** شكل `db` هو **اتحاد** لشكلين (محلي وبعيد) بلا عقد واحد مكتوب. ويصرّح الرأس بأن العقد موثق في `docs/SAHM_ENGINE_DATA_CONTRACT_AR.md`، وهذا الملف **MISSING** في شجرة `docs/` (6 ملفات ليس بينها هذا الاسم، من المرحلة 0).

### F-02-09 — `setAttendance` ما زالت مكشوفة — CONFIRMED / DEPRECATED CANDIDATE
- معرّفة في `SahmData` وترجع `ATTENDANCE_RETIRED`، وما زالت في `ACTOR_OPS` فيعرضها `SahmApp.setAttendance` (واجهتها تُرجع الخطأ دائماً).
- لا توجد في الملفين أي بقية للنصاب (quorum): لا حقول ولا شروط؛ تعليق النواة يقول إنه يُتجاهل «إن أرسله مستدعٍ». يتحقق ذلك **بالإغفال**: `validateGroup` لا تشير إليه. بقاياه في القاعدة (`quorum_percent`, `draws.quorum_*`, `cycle_attendance`) تُفحص في المرحلتين 06 و09.
- **لا يُقترح حذف.** يلزم تتبع من يستدعي `SahmApp.setAttendance` ودليل أنه لا مستخدم لها.

### F-02-10 — نموذجان للدورة يتعايشان — CONFIRMED
- **قديم:** `cycleType` أسبوعية/شهرية (30 يوماً)/مخصصة، `targetShares`, `maxPerMember`.
- **موحد:** `firstDrawOn`, `durationDays`, `installmentMode`, بلا هدف أسهم ولا حد للفرد. `createGroup` تُخزّن الموحدة بـ `cycleType:'custom'` و`cycleDays = المدة بين البداية وأول قرعة`.
- التمييز بين النموذجين **بوجود حقول** (`firstDrawOn` أو `durationDays` أو `shareAmountMinor` أو `installmentMode`) في `validateGroup` و`createGroup` — تخمين بالشكل لا بحقل صريح.
- **الاعتماد:** بذرة `buildSeed` كلها بالنموذج القديم. واجهة الإنشاء (المرحلة 01) تُرسل النموذج الموحد حسب `createDraft` (INFERRED من النص، التفاصيل في المرحلة 05). مستهلكو الفرع القديم: البذرة والاختبارات (محتواها NOT VERIFIED حتى المرحلة 10). **DEPRECATED CANDIDATE لا حذف.**

### F-02-11 — تعديل الجمعية الموحدة محلياً: تغيير `startDate` يفشل دائماً (INFERRED، منطقي من الكود)
- `updateGroup` تُرفض `firstDrawOn` بحقل غير قابل للتعديل (ليس في `FREE_FIELDS` ولا `FIN_FIELDS` ولا `COUNT_FIELDS`).
- وتمرير `startDate` جديد مع بقاء `firstDrawOn` و`durationDays` القديمين يُنتج `DURATION_MISMATCH` أو `FIRST_DRAW_RANGE_INVALID` من `validateUnifiedGroup`.
- هل يُستدعى `updateGroup` أصلاً في الوضع البعيد؟ **NOT VERIFIED** (قد يستبدله `install()`).

### F-02-12 — `toMinor` تحتوي بديلاً بالفاصلة العائمة — CONFIRMED (الكود)، الاستهلاك NOT VERIFIED
- عند فشل `parseMoney` تعيد `Math.round(Number(major) * minor)`، وهذا يناقض ادعاء «بلا floating point» في تعليق `parseMoney`. مستهلكو `toMinor` غير ظاهرين في الملفات الثلاثة.

### F-02-13 — الأداء والذاكرة (INFERRED)
- `obligation` تمسح `db.receipts` و`db.shares` لكل (عضو، دورة، قسط). `cumulativeSummary` و`cycleObligations` و`groupSummary` تستدعيها ضمن حلقات (أعضاء × دورات × أقساط). `drawStatus` تستدعي `drawReadinessLocal` وتُستدعى من `drawHistory` و`performDraw`.
- `transact` تأخذ **لقطة JSON كاملة** من `db` لكل عملية وتحفظ `db` كاملاً في localStorage (محلياً). الأثر على الوضع البعيد مرتبط بكل استدعاء حسابي على لقطة الخادم الكاملة: يُقاس في المرحلة 03.

### F-02-14 — نصوص «معاينة محلية» تبقى في مخرجات الاستعلام — CONFIRMED (الكود)، العرض NOT VERIFIED
- `groupDetail` تعيد `previewNote` (= `LOCAL_PREVIEW_NOTE`: لا تزامن بين الأجهزة ولا إشعارات Push) و`getInviteInfo` تعيد `previewNote`. إن عرضتها الواجهة في الوضع البعيد فهي **ادعاء غير صحيح** (التطبيق متصل بـ Supabase). يرتبط بملاحظة التسمية في المرحلة 01 (البند 8).

## 7. ما تغطيه الاختبارات (تمهيد فقط)

وُجدت ملفات `tests/core.test.js` و`tests/data.test.js` (من المرحلة 0). **محتواها لم يُقرأ بعد (NOT VERIFIED)**؛ تُصنَّف في المرحلة 10. لا حكم هنا على أن قاعدة ما مغطاة.

## 8. ما تبقى من هذه المرحلة (يُغلق لاحقاً)

1. تتبع مستهلكي دوال النواة غير المستعملة داخلياً (القسم 5) في `sahm-supabase-data.js` و`sahm-managed-group.js` و`sahm-supabase.js` والـ HTML.
2. حسم F-02-06 وF-02-07: ما الذي يفعله `SahmSupabaseData.install()` بالضبط، وما يُرسل إلى `useRemoteStore`.
3. حسم F-02-02 وF-02-03: أي نسخة قرار تعتمدها الواجهة، وما الذي يفرضه الخادم.
4. حسم F-02-04: افتراضيات الأعمدة في قاعدة البيانات.
5. ثغرات المرحلة 01 المحوّلة إلى المرحلة 05: `chat()` و`invites()` و`pendingInvitees`، والشاشات اليتيمة، وإدارة الرابط العام، وأقسام المدير الخمسة، وواجهة العضو.

## 9. نقطة الاستئناف

المرحلة التالية: **03** — `sahm-supabase.js` و`sahm-supabase-data.js` (وإعادة فحص `sahm-app.js` ضمن علاقته بـ `install()`).
