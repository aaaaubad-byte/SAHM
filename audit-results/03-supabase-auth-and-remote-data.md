# المرحلة 03 — تدقيق `sahm-supabase.js` و`sahm-supabase-data.js` (المصادقة والبوابة البعيدة) وعلاقتهما بـ `sahm-app.js`

- المرجع: الفرع `SAHM-SUPABASE`، آخر Commit تطبيقي `69259582c5c7c4660fed3ab53f92e3ee8e755117`.
- طبيعة العمل: قراءة فقط. لا تعديل على التطبيق ولا Supabase ولا Render. لم يُنفَّذ أي استدعاء RPC ولا استعلام على قاعدة البيانات في هذه المرحلة.
- الحالة: **مكتملة لنطاق الملفين** (مع إعادة قراءة `sahm-app.js` الذي قُرئ في المرحلة 02). ما يتعلق بما يفعله الخادم فعلاً (RLS والدوال والأعمدة) **NOT VERIFIED** حتى المراحل 06 و07 و08.
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.
- **عن الأدلة:** الدليل هو اسم الدالة داخل الملف (لا ترقيم أسطر في مخرج `read_file`). **لا تُعرض قيمة المفتاح العام**؛ يُذكر نوعه فقط.

## 1. تغطية القراءة

| الملف | القراءة |
|---|---|
| `sahm-supabase.js` (12050 بايت) | كاملة في استجابة واحدة، تنتهي بـ `root.SahmSupabase = {...}` ثم `})(window)` |
| `sahm-supabase-data.js` (45956 بايت) | كاملة في استجابة واحدة، تنتهي بـ `root.SahmSupabaseData = {...}` ثم `})(window)` |
| `sahm-app.js` | قُرئ كاملاً في المرحلة 02 واستُعمل هنا |

## 2. `sahm-supabase.js` — المصادقة وتعدد الحسابات

### 2.1 ما يفعله (CONFIRMED)
- يعرّف `SUPABASE_URL` (مشروع `nusjnnrtpxbpphphmdsc`، يطابق المشروع المتحقق منه في المرحلة 0) و`PUBLISHABLE_KEY` من النوع **المخصص للمتصفح** (بادئة `sb_publishable_`). **لا يوجد `service_role` ولا أي سر آخر** في الملف.
- **عميل لكل حساب:** `getClient(key)` ينشئ عميلاً بمفتاح تخزين `sahm-auth-<key>` حيث `key = 'account-' + userId`، مع `persistSession:true` و`flowType:'pkce'`. العميل `default` مؤقت (`storageKey = sb-<ref>-auth-token`، `autoRefreshToken:false`، `detectSessionInUrl:true`).
- **الدخول:** `signIn` يدخل عبر العميل المؤقت، ثم `activateSession` ينسخ الجلسة (`setSession`) إلى عميل الحساب، ثم `clearBootstrapSession` يحذف مفتاح الجلسة المؤقتة من localStorage **دون** استدعاء `signOut` (تعليق الملف يشرح أنه يُبطل الجلسة على الخادم).
- **التسجيل:** `signUp` يرسل `emailRedirectTo` = الأصل + المسار + `location.search`، و`options.data = {terms_accepted:true, terms_version}`.
- **الحسابات المتعددة:** فهرس `sahm.saved.accounts.v1` (معرّف + بريد + تسمية) في localStorage، والحساب النشط في `sahm.active.account.v1`. `switchAccount` يتحقق من الجلسة بـ `auth.getUser()` (طلب إلى الخادم).
- **الخروج:** `signOut` يستدعي `auth.signOut({scope:'local'})` على العميل النشط، ويحذف ذلك الحساب من الفهرس فقط، ويعيد المفتاح النشط إلى `default`.
- **الملف الشخصي:** `profile()` يقرأ جدولي `profiles` و`profile_private` مباشرة، و`completeProfile` يستدعي RPC `complete_my_profile`.
- **كلمة المرور:** `resetPassword` يضبط `redirectTo` بوسيط `auth_action=reset-password`، و`updatePassword` عبر `auth.updateUser`.

### 2.2 النتائج (F-03-S)

**F-03-S1 — جلسات كل الحسابات المحفوظة تبقى في localStorage — CONFIRMED (الآلية)، الأثر INFERRED**
- `persistSession:true` مع مفتاح لكل حساب يعني أن رمز الدخول ورمز التجديد لكل حساب نُشّط يبقى في localStorage حتى خروج ذلك الحساب أو انتهاء جلسته. أي XSS في الصفحة يصل إلى كل الحسابات المحفوظة معاً، لا إلى الحساب النشط فقط. (النمط قياسي في supabase-js لكن تعدد الحسابات يضاعف الأثر.)
- فهرس الحسابات يخزن **البريد الإلكتروني بنص صريح** على الجهاز. أثر الخصوصية على جهاز مشترك.
- لا يوجد في الملف أي تشفير أو قفل إضافي. التقييم الأمني الكامل في المرحلة 08.

**F-03-S2 — إقرار الشروط يُسجَّل في بيانات يتحكم بها المستخدم — CONFIRMED (الكود)، الخادم NOT VERIFIED**
- `terms_accepted` و`terms_version` تُرسل ضمن `user_metadata` عند التسجيل. هذه البيانات قابلة للتعديل من المستخدم نفسه عبر `auth.updateUser`. كونها غير موثوقة يتوقف على ما إذا كان الخادم يسجّل القبول في جدول أو Trigger مستقل. يُفحص في المرحلة 07 (Triggers على `auth.users`).

**F-03-S3 — رسالة خطأ مضللة محتملة — CONFIRMED (الكود)**
- `friendly()` تحوّل أي رسالة تطابق `duplicate key` إلى «رقم الهاتف مسجل مسبقاً بحساب آخر»، فيظهر هذا النص لأي تعارض مفتاح فريد آخر. وتحوّل `/network|fetch/` إلى «تعذر الاتصال» حتى لو كان مصدرها نصاً آخر يحوي الكلمة.

**F-03-S4 — رابط استعادة كلمة المرور مع وجود حساب نشط — INFERRED (يحتاج اختباراً تشغيلياً، لا يُنفَّذ هنا)**
- `detectSessionInUrl:true` ممكّن **للعميل `default` فقط**، والعميل `default` لا يُنشأ إلا عند الحاجة (`getClient('default')`). عند وجود حساب نشط مخزَّن، `session()` تبدأ بعميل ذلك الحساب. فقد لا يعالج أي عميل `code` القادم في رابط الاستعادة قبل أن يُنشأ `default`. المسار في الواجهة (`PASSWORD_RECOVERY` أو `?auth_action`) يعتمد على ذلك (المرحلة 01، SCR-004). **لم يُتحقق تشغيلياً.**

**F-03-S5 — ربط مستمع المصادقة بالعميل النشط — CONFIRMED (الكود)**
- `bindAuthListener` يسجل على `getClient()` أي العميل النشط وقت الاستدعاء، ويعيد الربط في `activateSession` و`switchAccount` لكن **ليس** في المسار الذي يبدّل فيه `session()` المفتاح النشط إلى `default`. أثره العملي NOT VERIFIED.

## 3. `sahm-supabase-data.js` — البوابة البعيدة

### 3.1 التحقق من ملاحظة التقرير الأولي: «قراءة 21 جدولاً كاملة بعد كل عملية كتابة» — **CONFIRMED**

الدليل: `loadSnapshot(profileValue)` تعرّف `names` بـ **21 جدولاً** بالترتيب:
`associations, profiles, association_memberships, shares, association_cycles, installment_periods, installment_obligations, installment_receipts, receipt_corrections, draws, draw_eligible_shares, chat_messages, chat_read_states, association_events, association_notification_settings, association_user_preferences, invitations, join_requests, notifications, reminders, user_preferences`.

- كل جدول يُقرأ بـ `rows(table)` الذي يجلب **صفحات من 500 صف** بلا أي مرشح (`select('*')` ثم `.order(...).range(...)`)، ويكرر حتى تقل الصفحة عن 500.
- يضاف RPC واحد `get_my_invitation_inbox`، وطلب `auth.getUser()` (عبر `SahmSupabase.user()`) في بداية كل لقطة.
- **الحد الأدنى لكل لقطة: 23 طلباً** (21 قراءة + 1 RPC + 1 `getUser`)، ويزداد بصفحة إضافية لكل 500 صف في أي جدول. القراءات والـ RPC تُطلق معاً بـ `Promise.all` (يخفف الزمن لكن لا الحمل على الخادم). أي جدول يفشل يُفشل اللقطة كلها.
- الحجم لا يتناسب مع الحاجة: لا مرشح على الجمعية ولا على الدورة (النطاق كله يُحدَّد بـ RLS)، ولا قراءة تزايدية.

**العمليات التي تُشغّل لقطة كاملة بعدها (28 عملية، CONFIRMED من `await refresh()` داخل كل منها):**
`createGroup` (+ RPC ثانٍ للرابط العام)، `updateGroup`، `createInvite`، `createInvitationsBulk`، `cancelInvite`، `acceptInvite`، `respondToInvite`، `submitJoinRequest`، `cancelJoinRequest`، `approveJoinRequest`، `rejectJoinRequest`، `managePublicLink`، `acceptLegacyInvitationById`، `submitJoinRequestByInvitation`، `addShares`، `removeShares`، `removeMember`، `recordPaid`، `correctReceipt`، `sendReminder` (إلا مع `p.skipRefresh`)، `performDraw`، `setDrawScheduledAt`، `setDrawPresentationStatus`، **`sendMessage`** (أي رسالة دردشة)، `setNotifySettings`، `setNotifyType`، `setMute`، `updateMyProfile` (مع قراءتين إضافيتين للملف الشخصي).

**أحداث Realtime التي تُشغّل لقطة كاملة:** أي حدث على `join_requests` أو `invitations` (مع تأخير 100 ملّي ثانية). الأحداث على `chat_messages` و`notifications` تُعالَج تزايدياً بلا لقطة.

**عمليات لا تُشغّل لقطة:** `markChatRead` (upsert مباشر)، `markNotificationsRead`، `savePrefs`، وكل الاستعلامات (`get*` و`preview*` و`list*` و`shareList` و`myShareList`).

### 3.2 التحقق من ملاحظة «Monkey Patching في `install()`» — **CONFIRMED**

الدليل: `install()` تعيّن خصائص على الكائن `SahmApp` مباشرة (`app.createGroup = createGroup` ...) — **36 اسماً**:

- **22 تستبدل عمليات محلية قائمة:** `createGroup`, `updateGroup`, `createInvite`, `createInvitationsBulk`, `cancelInvite`, `managePublicLink`, `addShares`, `removeShares`, `removeMember`, `setAttendance`, `recordPaid`, `correctReceipt`, `sendReminder`, `performDraw`, `sendMessage`, `setNotifyType`, `setMute`, `markChatRead`, `markNotificationsRead`, `savePrefs`, `shareList`, `myShareList`.
- **14 تضيف أسماء لا وجود لها في `SahmApp` الأصلي** (تؤكد F-02-07): `respondToInvite`, `submitJoinRequest`, `cancelJoinRequest`, `approveJoinRequest`, `rejectJoinRequest`, `setDrawScheduledAt`, `setDrawPresentationStatus`, `getDrawRoom`, `getDrawHistory`, `getDrawReadiness`, `getFinancialSummary`, `getNews`, `getAuditLog`, `setNotifySettings`.

**ما لم يُستبدل ويبقى محلياً داخل `SahmApp` (CONFIRMED بمقارنة `ACTOR_OPS` و`VIEW_QUERIES` و`PLAIN` مع القائمة أعلاه):**
- **عمليتان محليتان تغيّران الحالة:** `addMember` و`joinByCode`.
- **12 استعلاماً يُحسب محلياً من اللقطة:** `groupDetail`, `installmentRows`, `memberStatement`, `receiptList`, `receiptDetail`, `eventLog`, `memberList`, `inviteList`, `myInvitations`, `drawHistory`, `notificationList`, `chatView`.
- **5 مساعدات:** `drawStatus`, `previewJoin`, `inviteSummary`, `getInviteInfo`, `lastReminder`.
- مساعدات `SahmApp` المباشرة: `myGroups`, `roleOf`, `chatList`, `recentActivity`, `unreadNotifications`, `tick`, `storageState`, `takeNotices`, `prefs`, `nowAt`, `todayIn`, `chatTime`, `notifyTypes`, `maxMessage`.

**توقيعات البدائل متوافقة مع المحلية من جهة المستدعي** (مثلاً `recordPaid(p)` و`performDraw(groupId)` و`sendMessage(groupId, body)`)، فالواجهة تستدعي الشكل نفسه.

### 3.3 قواعد الأعمال: أين تُتخذ الآن؟ (التصنيف المطلوب)

| القاعدة | العميل (النواة/البيانات) | RPC أو قيود الخادم |
|---|---|---|
| إنشاء جمعية والتحقق | تحقق الواجهة (HTML) + نسخة في `SahmCore.validateUnifiedGroup` **لا تُستدعى من `createGroup` البعيدة** | `create_association_unified` — NOT VERIFIED |
| تسجيل قسط مدفوع | غير موجودة في المسار البعيد: يبحث `findObligation` عن صف الالتزام ثم يستدعي RPC | `record_installment_receipt(p_obligation_id)` — القرار للخادم، NOT VERIFIED |
| **حالة القسط (مدفوع/مستحق/متأخر)** | **تُشتق على العميل** من التواريخ والإيصالات (`SahmCore.obligation`, `instStatus`) | الجدول `installment_obligations` يُقرأ لكن لا يُقرأ منه أي حقل حالة (انظر F-03-D3) |
| جاهزية القرعة | محلية `drawReadinessLocal` عبر `SahmApp.drawStatus` (محلي) | RPC `get_draw_readiness` موصولة أيضاً (`getDrawReadiness`) — أيّهما تستعمله الشاشات NOT VERIFIED |
| تنفيذ القرعة | لا قرار في العميل (يمرر `p_expected_round_no` فقط) | `perform_draw` — يتحقق من رقم الجولة المتوقع (تحكم تزامني جيد من جهة العميل) |
| قفل الاتفاق ونافذة الانضمام | `agreementLock` و`inviteWindow`/`isJoinWindowOpen` (مكررة: F-02-01 وF-02-02) | NOT VERIFIED |
| الصلاحيات (مدير/عضو) | **لا فحص صلاحيات في أي عملية بعيدة** (CONFIRMED: لا استدعاء لـ `needManager` ولا شبهه). في الواجهة حراسة `go()` فقط (المرحلة 01) | RLS + RPC — NOT VERIFIED (المراحل 06–08) |
| تطبيع الهاتف | **أربع نسخ:** `invitePhoneKey` في HTML، و`phoneE164` هنا، و`normPhone` في `sahm-data.js`، ونمط `^\+[1-9][0-9]{7,14}$` في شاشة الملف الشخصي. ثلاث منها تفترض الرمز `+967` أو تتجاهله | قيد الخادم NOT VERIFIED |
| قائمة أنواع الإشعارات | **ثلاث نسخ:** `NOTIFY_TYPE_IDS` (النواة)، `NOTIFY_TYPES` (البيانات)، `NOTIFY` (هنا) | الأعمدة `feed_enabled_types` ... NOT VERIFIED |

### 3.4 النتائج (F-03-D)

**F-03-D1 — لا تسلسل للتحديثات؛ قد يطغى سجل أقدم على أحدث — CONFIRMED (غياب الحماية)، الوقوع الفعلي INFERRED**
- `refresh()` لا يحرس تزامنها: لا قفل ولا رقم تسلسل ولا إلغاء. إن تداخل تحديثان (عملية + حدث Realtime بعد 100 ملّي ثانية، أو عمليتان متتاليتان) فاللقطة التي **تنتهي** آخراً تغلب، حتى لو كانت قد **قرأت** قبل الأخرى. النتيجة: واجهة تعرض حالة أقدم من آخر كتابة.
- `loadSnapshot` تستبدل `raw` و`store` بعد اكتمال القراءات. صف يصل عبر Realtime أثناء القراءة (رسالة أو إشعار) يُضاف إلى `store` القديم ثم يُهمل، وقد لا تحويه اللقطة الجديدة إن قُرئت قبل وصوله. يظهر بعد التحديث التالي فقط.

**F-03-D2 — فشل التحديث بعد نجاح الكتابة يُبلَّغ كفشل للعملية — CONFIRMED**
- في كل عملية: `try { await invoke(...); await refresh(); return {ok:true} } catch(e){ return fail(e) }`. إن نجح RPC وفشل `refresh` (انقطاع، أو فشل جدول واحد من الـ21) تُرجع العملية `ok:false` مع أن الخادم نفّذها. إعادة المحاولة قد تكرر أثراً (جمعية ثانية في `createGroup`، دعوات مكررة في `createInvitationsBulk`، تذكير آخر في `sendReminder`).

**F-03-D3 — حالة القسط تُشتق على العميل مع وجود صفوف التزام على الخادم — CONFIRMED (الكود)، مطابقتها للخادم NOT VERIFIED**
- `installment_obligations` و`installment_periods` تُقرأ لكن تُستخدم فقط في خرائط بحث (`obligationMap`, `periodMap`) لربط الإيصالات وللعثور على `obligation.id` عند التسجيل. لا يُقرأ منها حقل حالة. `SahmCore.obligation` يعيد حساب الحالة من التواريخ والإيصالات.
- يتبع ذلك: **مصدران لقرار «مدفوع/متأخر»** (العميل، وما تحسبه دوال الخادم مثل `get_association_financial_summary` و`get_draw_readiness`). تطابقهما يُفحص في المرحلتين 06 و07.
- **اشتقاق تقريبي لأسهم الإيصال (INFERRED):** يبني `loadSnapshot` الحقل `shareIds` بأخذ **أول N أسهم** (مرتبة برقمها) للعضو، لا الأسهم الفعلية المدفوعة. إن أُضيفت أسهم بعد الدفع فقد تُحتسب «غير مدفوعة جزئياً» أو العكس حسب ترتيبها. كيف يعامل الخادم الأسهم المضافة بعد توليد الالتزامات يُفحص في المرحلة 07.

**F-03-D4 — حد زمني خاطئ في `lateByJoin` للأسهم المضافة — CONFIRMED (دلالة المقارنة)، الأثر INFERRED**
- `SahmCore.obligation` تقارن `(s.addedAt || member.joinedAt) > range.end`. في المسار البعيد `addedAt = s.added_at` **طابع زمني كامل** (`YYYY-MM-DDTHH:MM:SS…`) بينما `range.end` تاريخ فقط (`YYYY-MM-DD`). مقارنة النصوص تعدّ الطابع في **اليوم نفسه أكبر** (لأنه أطول بالبادئة نفسها). فسهم أُضيف في **آخر يوم من فترة القسط** يُعدّ «انضم بعد انتهاء الفترة» (`lateByJoin = true`) خطأً. (`joinedAt` للأعضاء يُقتطع إلى تاريخ، فلا تظهر المشكلة معه.) الأثر على العرض وعلى كتم إشعارات التأخر المحلية.

**F-03-D5 — عرض وقت الرسائل بتوقيت UTC لا توقيت الجمعية — INFERRED (قوي من الكود)**
- `chatView` تستعمل `chatTime(m.at, today)` التي تقتطع `at.slice(11,16)`، وفي المسار البعيد `at = created_at` طابع ISO بتوقيت UTC (الشكل الذي يعيده PostgREST للأعمدة `timestamptz`، يُؤكَّد في المرحلة 06). الساعة المعروضة بالتوقيت العالمي لا بتوقيت عدن (UTC+3)، ومقارنة «أمس» تخلط تاريخ UTC بتاريخ محلي قرب منتصف الليل.
- أصل المشكلة: الشكل المحلي للوقت (`YYYY-MM-DDTHH:MM` بتوقيت الجمعية) ≠ الشكل البعيد (ISO UTC) داخل **بنية بيانات واحدة** (`db`).

**F-03-D6 — الهوية الثابتة `'me'` وعدّاد غير المقروء — CONFIRMED (عدم التطابق)، الأثر INFERRED**
- `prefs.user.id` في الوضع البعيد = UUID المستخدم، بينما `SahmData.unreadCount` تستثني الرسائل بشرط `m.userId !== 'me'` **ثابتاً**. الرسائل التي أرسلها المستخدم نفسه تُحتسب غير مقروءة (إن كان `at > last_read`).
- والنسخة البعيدة من `sendMessage` لا تحدّث `chatReads` (المحلية كانت تفعل). و`markChatRead` تكتب `last_read_at` بـ **ساعة الجهاز** (`new Date().toISOString()`) وتقارنها بـ `created_at` من الخادم، فيؤثر انحراف الساعة على العدّاد.

**F-03-D7 — عمليات محلية باقية قد تكتب لقطة الخادم في localStorage — CONFIRMED (المسار)، الاستدعاء الفعلي NOT VERIFIED**
- `addMember` و`joinByCode` و`tick` (من `SahmApp`) تعمل على `db` الذي أصبح لقطة الخادم، وتنتهي بـ `SahmData.save(db)` التي تكتب `sahm_preview_data_v4` و`sahm_preview_prefs_v1` **بنص صريح في localStorage**: أي نسخة من **بيانات المستخدم الحقيقية** تُحفظ على الجهاز ولا تُمسح عند الخروج (`clear()` لا يحذفها).
- `tick` بالذات: `db.emitted` يُعاد فارغاً مع كل لقطة، فإن استُدعيت تُعيد توليد رسائل نظام «تأخر…/اقتراب القرعة» محلياً **مكررة** مع رسائل الخادم.
- لم يُثبَّت بعد من يستدعي `SahmApp.tick` و`SahmApp.addMember` و`SahmApp.joinByCode` في المسار البعيد: يُفحص في المرحلتين 04 و05 (`NOT VERIFIED`).

**F-03-D8 — بعد الخروج قد تُبنى بيانات البذرة (تحديث F-02-06) — CONFIRMED (المسار)، الاستدعاء الفعلي NOT VERIFIED**
- `clear()` تستدعي `app.clearStore()` فتجعل `db = null`. أي استدعاء لاحق لـ `SahmApp.*` يمر بـ `init()` الذي ينفّذ `SahmData.load()` فيبني **البذرة التجريبية** (جمعيات «الأهل» و«زملاء العمل»... والمستخدم «أحمد محمد») ويكتبها في localStorage. هل تستدعي الواجهة `SahmApp.*` بين الخروج وإعادة الدخول؟ (`load()` في HTML تقرأ من `SahmApp`) NOT VERIFIED.
- **تصحيح لـ F-02-06:** القلق من ضعف التحقق في `useRemoteStore` **مخفَّف**: `loadSnapshot` تبني كل المصفوفات صراحةً وتستدعي `SahmData.normalizeDb(db)` قبل التسليم (CONFIRMED).

**F-03-D9 — كتابات مباشرة على جداول من العميل — CONFIRMED (الكود)، الحماية NOT VERIFIED**
- `markChatRead` → `upsert` على `chat_read_states`، و`savePrefs` → `upsert` على `user_preferences`. الحماية الوحيدة هي سياسات RLS (المرحلة 06). باقي الكتابات عبر RPC.

**F-03-D10 — كل قراءة جدول بلا مرشح؛ النطاق يعتمد على RLS كلياً — CONFIRMED (الكود)**
- `rows(table)` لا تُمرّر `association_id` ولا `user_id`. فما يراه المستخدم **يحدده RLS وحده**. أي جدول بسياسة أوسع من المقصود (مثل `profiles` أو `association_events` أو `reminders`) يتسرب إلى `raw` ثم إلى `store`. تُفحص السياسات واحدة واحدة في المرحلتين 06 و08.

**F-03-D11 — ترتيب الصفحات والقراءة بالإزاحة — CONFIRMED (الكود)، التبعات INFERRED**
- الترتيب بالعمود `id` لكل جدول عدا ثلاثة (`association_notification_settings` بـ `association_id`، `user_preferences` بـ `user_id`، `join_requests` بـ `submitted_at`). **يجب التأكد في المرحلة 06 أن كل جدول من الـ18 الباقية له عمود `id`** (جداول مثل `chat_read_states` و`association_user_preferences` و`draw_eligible_shares` قد تكون مفاتيحها مركّبة).
- الترتيب بـ `submitted_at` غير فريد قد يُنتج صفوفاً مكررة أو مفقودة بين الصفحات عند الربط، والقراءة بالإزاحة على جدول حي قد تفعل الشيء نفسه عند الإدراج أثناء القراءة.

**F-03-D12 — بقايا النصاب والحضور ما زالت تُقرأ وتُبنى في اللقطة — CONFIRMED**
- `db.draws[].quorum = {people: d.quorum_people, required: d.quorum_required}` و`overrideQuorum:false`، و`db.members[].present:false`، وتعيين `attendance_marked` إلى نوع `'attendance'` في `mapEventType`، وقراءة العمود القديم `enabled_types` كاحتياط. أي أن الأعمدة `draws.quorum_*` وما يقابلها **ما زالت مستهلَكة** من العميل. مستهلكو `.quorum` و`.present` في الواجهة NOT VERIFIED.
- `setAttendance` البعيدة ترجع خطأً ثابتاً `ATTENDANCE_RETIRED` دون استدعاء الخادم (على خلاف تعليقها «the database rejects the call»). لا RPC للحضور في هذا الملف. **DEPRECATED CANDIDATE، لا حذف** قبل تتبع مستهلك `SahmApp.setAttendance`.

**F-03-D13 — Realtime — CONFIRMED (الاشتراكات)، السلوك الدقيق NOT VERIFIED**
- قناة واحدة `sahm-user-<uid>`: `chat_messages` (INSERT، بلا مرشح)، `notifications` (INSERT وUPDATE بمرشح `user_id=eq.<uid>`)، `join_requests` (`*`)، `invitations` (`*`). **تطابق الجداول الأربعة المنشورة** (المرحلة 0).
- يُعاد إنشاء القناة بإزالة السابقة أولاً (`startRealtime` تزيل `realtimeChannel` ثم تنشئ) وتتوقف في `stopRealtime` (تُستدعى من `clear`). ملاحظتان: (1) `removeChannel` لا يُنتظر قبل إنشاء القناة الجديدة بالاسم نفسه؛ (2) تُستدعى على `c()` أي **العميل النشط الحالي** وقد يكون غير العميل الذي أنشأ القناة بعد `switchAccount`. كون المقبس القديم يُغلق فعلاً NOT VERIFIED (سلوك المكتبة).
- `handleRealtime` تتجاهل أي حدث بلا `payload.new` فلا تعالج `DELETE`. حدث `DELETE` على `join_requests`/`invitations` (الاشتراك `*`) لا يُحدّث الواجهة (INFERRED؛ يلزم أن تكون الصفوف تُحذف فعلاً وليس بتغيير الحالة).
- بعد التحديث المؤجل يُستدعى `realtimeCallback` **مرة لكل حدث متراكم**، فقد يتكرر إعادة الرسم. وإن فشل التحديث تُفقد الأحداث المتراكمة (يُبلَّغ الخطأ فقط).
- `chat_messages` بلا مرشح على الجمعية: ما يصل يعتمد على RLS (المرحلة 08).

**F-03-D14 — `markNotificationsRead` حلقة RPC متتابعة — CONFIRMED**
- RPC واحد لكل إشعار داخل `for` مع `await`. تحديد «كل الإشعارات كمقروءة» بـ N طلباً متتابعاً، وإن فشل أحدها يتوقف والباقي بلا تعليم مع أن القائمة المحلية لا تُحدَّث عند الفشل.

**F-03-D15 — تسمية نتيجة القرعة غير متسقة — CONFIRMED (الكود)، الأثر تجميلي**
- نتيجة `performDraw` الفورية: `اسم + ' · السهم ' + رقم` دائماً. بينما `SahmCore.shareLabel` تضيف «السهم n» فقط عند تعدد أسهم العضو. فيختلف نص الفائز بين شاشة النتيجة والسجل.

**F-03-D16 — ازدواج مصادر لبيانات متكافئة — CONFIRMED (وجود الاثنتين)، أيّهما تستعمله الشاشات NOT VERIFIED**
- سجل القرعات: `SahmApp.drawHistory` (محلي من اللقطة) و`SahmApp.getDrawHistory` (RPC `get_draw_history`).
- الجاهزية: `SahmApp.drawStatus` (محلي) و`getDrawReadiness` (RPC).
- الملخص المالي: `groupSummary` (محلي) و`getFinancialSummary` (RPC).
- الدعوات الواردة: `get_my_invitation_inbox` (في اللقطة) و`list_my_invitations` (`listMyInvitations`، مصدّرة).
- الأسهم: `SahmApp.shareList/myShareList` (بدائل RPC) مقابل اشتقاق محلي كان موجوداً.

**F-03-D17 — العملية غير ذرية في `createGroup` — CONFIRMED (الكود)**
- استدعاءان منفصلان: `create_association_unified` ثم `manage_association_public_link(create)`. فشل الثاني لا يلغي الأول، فيُرجع `ok:true` مع `linkWarning`. سلوك معالج في الواجهة (المرحلة 01 SCR-012 «الرابط متوقف أو غير منشأ»).

**F-03-D18 — أداء المعالجة على العميل — INFERRED**
- حلقات متداخلة داخل `loadSnapshot`: لكل إيصال `db.shares.filter(...).sort(...)` (O(R·S))، ولكل جمعية/عضو/إشعار `find` خطي على المصفوفات الخام (O(M·A) وO(N·P)). ثم كل استعلام محلي يعيد المسح (F-02-13). التكلفة تكبر مع حجم البيانات، وتتكرر بعد كل عملية.

## 4. جرد RPC المستدعاة من العميل (لمطابقتها في المرحلة 07)

**43 اسماً** (42 في `sahm-supabase-data.js` + `complete_my_profile` في `sahm-supabase.js`):

`get_my_invitation_inbox`, `create_association_unified`, `manage_association_public_link`, `update_association`, `create_invitation`, `create_invitations_bulk`, `cancel_invitation`, `preview_invitation`, `accept_invitation`, `respond_to_invitation`, `submit_join_request`, `cancel_join_request`, `approve_join_request`, `reject_join_request`, `preview_public_join_link`, `list_my_invitations`, `get_my_invitation_details`, `accept_legacy_invitation_by_id`, `submit_join_request_by_invitation`, `get_association_public_link_status`, `add_shares`, `remove_shares`, `remove_member`, `record_installment_receipt`, `correct_installment_receipt`, `send_installment_reminders`, `perform_draw`, `set_draw_scheduled_at`, `set_draw_presentation_status`, `get_draw_room`, `get_association_shares`, `get_my_association_shares`, `get_draw_history`, `get_draw_readiness`, `get_association_financial_summary`, `get_association_news`, `get_association_audit_log`, `send_chat_message`, `set_association_notification_settings`, `set_association_user_preferences`, `mark_my_notification_read`, `update_my_profile`, `complete_my_profile`.

**مقابل 49 دالة في القاعدة (المرحلة 0):** الفرق (دوال في القاعدة لا يستدعيها هذان الملفان) يُحسب في المرحلة 07، وبه يُحكم على المرشحات المذكورة في التوجيه:
- `create_association` مقابل `create_association_unified`: **العميل يستدعي الموحدة فقط** (في هذين الملفين).
- `set_association_notification_types` مقابل `set_association_notification_settings`: **العميل يستدعي `_settings` فقط**.
- `create_invitation` و`send_installment_reminders`: المستدعى باسم واحد؛ أي نسخة (توقيع) تُستدعى يُحدَّد بمطابقة أسماء المعاملات في المرحلة 07: `create_invitation(p_association_id, p_name, p_phone)` و`send_installment_reminders(p_cycle_id, p_installment_no, p_membership_id, p_confirm_repeat)`.
- هذا **ليس دليلاً** على أن النسخ الأخرى غير مستخدمة: قد تستدعيها ملفات أخرى (HTML وmanaged-group) أو الاختبارات أو cron أو دوال أخرى.

**الجداول المقروءة مباشرة (21) + المكتوبة مباشرة:** `chat_read_states`، `user_preferences`؛ ويقرأ `profile()` أيضاً `profiles` و`profile_private`.

## 5. تحديث نتائج المرحلة 02 على ضوء هذه المرحلة

| البند | القرار الجديد |
|---|---|
| F-02-04 (افتراضيات الإشعارات) | **تفصيل:** المسار البعيد يفترض **كل الأنواع مفعّلة** عند غياب صف الإعدادات (القيمة الافتراضية `NOTIFY` كلها) والأسماء ظاهرة لـ`drawResult` فقط، أي يطابق النواة ويخالف `DEFAULT_NOTIFY` في `sahm-data.js` (محلي فقط). النواة `normalizeNotifySettings` **غير مستعملة** في المسار البعيد (أعاد الملف تنفيذها بـ`typeMap`). مستهلكو `normalizeNotifySettings` في الملفات الأخرى NOT VERIFIED |
| F-02-05 (`createInvite` المحلية) | في المسار البعيد **مستبدَلة** بنسخة `create_invitation` (بلا أسهم). النسخة المحلية معطوبة لكنها خارج المسار الفعلي. هل تستدعي الواجهة `SahmApp.createInvite` أصلاً؟ NOT VERIFIED (المرحلة 05) |
| F-02-06 | مخفّف جزئياً (انظر F-03-D8) |
| F-02-07 | **مؤكَّد:** 14 اسماً تُضاف من `install()` |
| F-02-08 | **مؤكَّد:** المصدر هو `loadSnapshot` (`drawScheduledAt`, `cycleStatus`, `eventType`, `entityId`, `invitedUserId`) |
| F-02-09 | `setAttendance` مُستبدَلة بنسخة تفشل دائماً. DEPRECATED CANDIDATE |
| `SahmCore.validateGroup`/`validateUnifiedGroup` | **لا تُستدعى** من `createGroup` البعيدة. مستهلكها الوحيد المعروف الآن: `SahmData.createGroup/updateGroup` المحلية (المستبدلة) وربما الاختبارات. NOT VERIFIED في HTML/managed-group |
| `SahmCore.normalizeReadiness` | **تُستعمل** في `getDrawReadiness` (CONFIRMED) |

## 6. ما تبقى من هذه المرحلة

1. من يستدعي `SahmApp.tick` و`addMember` و`joinByCode` و`createInvite` و`setAttendance` و`drawStatus` و`drawHistory` وغيرها (المرحلتان 04 و05).
2. صحة F-03-S4 تشغيلياً (غير مطلوب الآن؛ يُذكر في التوصيات).
3. مطابقة الـRPC والجداول والأعمدة والسياسات مع ما يفترضه العميل (المراحل 06–08).

## 7. نقطة الاستئناف

المرحلة التالية: **04** — `sahm-navigation.js` و`sw.js` و`index.html` و`terms.html` و`manifest.webmanifest` و`icons/sahm.svg` وملفات `.github/workflows`.
