# المرحلة 1 — تدقيق `Sahm_Preview_ROLE_SEPARATION.html` (الشاشات والأدوات المشتركة)

- تاريخ التنفيذ: 2026-11-20
- المرجع: الفرع `SAHM-SUPABASE` عند الـ Commit `69259582c5c7c4660fed3ab53f92e3ee8e755117`
- المنفّذ: وكيل فرعي للقراءة فقط. ما يرد هنا مخرجه كما وصلني، وأرقام SCR مقترحة منه.
- الحالة: **مكتملة جزئياً**. الـ HTML (غير كتل CSS) مقروء كاملاً. ما لم يُقرأ مذكور في القسم 7.
- طبيعة العمل: لا تعديل على المستودع ولا Supabase ولا Render.
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.

## 1. تغطية القراءة

- نتيجة `read_file` جاءت JSON بحجم 210,585 حرفاً. فُكّ حقل `content` إلى ملف محلي مؤقت، فصار 4235 سطراً و217,230 بايت، وهذا يطابق حجم الملف في الشجرة (217230).
- أسطر قُرئت كاملة على أجزاء متتابعة بلا فجوات: 1–15 و2540–4235 (10 أجزاء: 2540–2700، 2701–2900، 2901–3090، 3091–3260، 3261–3440، 3441–3600، 3601–3770، 3771–3950، 3951–4100، 4101–4235).
- **كتل CSS (الأسطر 16–2539) لم تُقرأ سطراً سطراً.** هي ثلاث كتل: 16–2303، و`#sahm-typography-system-6-sizes` عند 2304–2387، و`#cg-create-form-refinement` عند 2388–2551. تم فحص بنيوي فقط (`@media`، `@keyframes`، `:root`، وعدّ `!important` = 238 موضعاً). أي استنتاج عن تفاصيل التنسيق **NOT VERIFIED**.
- بعض الأسطر الطويلة جداً (1000–1500 حرف، مثل 3390 و3436 و3816) قُصّت أثناء العرض. اطُّلع لاحقاً على ذيل السطر 3436. ذيل أسطر القوالب الطويلة الأخرى بقي مقصوصاً، ولم يُقدَّر أنه يغيّر استنتاجاً (تقدير الوكيل، **INFERRED**).
- للتحقق من الأقسام العشرة ومن حلّ `window.*` اطُّلع على `sahm-managed-group.js` (1051 سطراً) و`sahm-supabase.js`. لم تُقرأ `sahm-core.js` ولا `sahm-data.js` ولا `sahm-app.js` ولا `sahm-supabase-data.js` ولا `sahm-navigation.js` ولا `sw.js` في هذه المرحلة.

## 2. جدول الشاشات (SCR)

المصدر: `ALL_SCREEN_REGISTRY` (الأسطر 3516–3522) و`render()` (3523). أرقام SCR مقترحة.

| SCR | الاسم (المعرف) | الجهة | الغرض | الدالة (السطر) |
|---|---|---|---|---|
| 001 | تسجيل الدخول `welcome` | زائر | دخول بالبريد وكلمة المرور | `welcome()` 3440 |
| 002 | إنشاء حساب `register` | زائر | تسجيل مع الموافقة على الشروط | `register()` 3457 |
| 003 | بياناتك الشخصية `profile-setup` | مسجّل غير مكتمل الملف | اسم ثلاثي وهاتف وأيقونة | `profileSetup()` 3492 |
| 004 | تعيين كلمة مرور `reset-password` | عبر رابط الاستعادة | كلمة مرور جديدة | `resetPasswordScreen()` 3449 |
| 005 | تم تسجيل الخروج `logged-out` | زائر | شاشة نهاية الجلسة | `logout()` 3503 |
| 006 | إضافة/إعادة ربط حساب `account-login` | مسجّل | حساب ثانٍ على الجهاز | `accountLogin()` 3482 |
| 007 | الرئيسية `home` | الكل | ملخص ودعوات واردة وآخر نشاط | `home()` 2885 |
| 008 | الجمعيات `groups` | الكل | قائمة وبحث | `groups()` 2947 |
| 009 | جمعيات أديرها `managed-groups` | مدير | نفس `groups()` بفلتر `manager` | 2960 |
| 010 | جمعيات أشارك فيها `joined-groups` | عضو | بفلتر `member` | 2961 |
| 011 | إنشاء جمعية `create-group` | مدير | نموذج خطوة واحدة | `createGroup()` 3037 |
| 012 | تم إنشاء الجمعية `created-group` | مدير | ملخص ورابط ودعوة المشاركين | `createdGroup()` 3085، `showCreatedGroup()` 3086 |
| 013 | تفاصيل الجمعية `group-detail` | مدير/عضو | يفوّض كلياً إلى `SahmManagedGroup.render` | `groupDetail()` 3116 |
| 014 | استقبال الأعضاء `member-reception` | مدير | إحصاءات وحالة الرابط العام | `memberReception()` 3284 |
| 015 | إضافة أعضاء `invite` | مدير | اختيار جهات وإرسال دعوات | `invite()` 3226 |
| 016 | تفاصيل الدعوة `invite-detail` | مدعو | أرغب / رفض / تأجيل / قبول قديمة | `inviteDetail()` 3235 |
| 017 | الانضمام `join-group` | مسجّل | إدخال رابط أو رمز | `joinGroup()` 3305 |
| 018 | طلب الانضمام (نموذج) | مسجّل | عدد الأسهم ومعاينة الأقساط | `showJoinRequestForm()` 3326 |
| 019 | حالة طلب الانضمام `join-request-status` | مقدّم الطلب | متابعة وإلغاء | `joinRequestStatus()` 3342 |
| 020 | طلبات الانضمام `join-requests` | مدير | قائمة مع فلاتر | `joinRequests()` 3349 |
| 021 | تفاصيل طلب الانضمام `join-request-detail` | مدير | موافقة أو رفض | `joinRequestDetail()` 3363 |
| 022 | سجلات الاستلام `receipts` | مدير/عضو | قائمة الإيصالات | `receipts()` 3384 |
| 023 | تفاصيل الاستلام `receipt-detail` | مدير/عضو | إيصال وتصحيح | `receiptDetail()` 3388 |
| 024 | الدردشات `wall` | الكل | قائمة محادثات الجمعيات | `wall()` 3411 |
| 025 | الإشعارات `notifications` | الكل | قائمة وتعليم كمقروء | `notifications()` 3425 |
| 026 | حسابي `profile` | الكل | بيانات وحسابات محفوظة وروابط | `profile()` 3431 |
| 027 | تعديل الملف `edit-profile` | الكل | الاسم والمدينة | `editProfile()` 3438 |
| 028 | الإعدادات `settings` | الكل | تنبيهات وخروج | `settings()` 3439 |
| 029 | أسماء مسجلة تفوّض إلى الورشة | مدير/عضو | `members`, `installments`, `draw-room`, `draw-history`, `chat`, `news`, `audit` | `openAssociationWorkspace()` 3504 |

### نوافذ منبثقة (كلها عبر `showModal()` عند 3530 و`#modal-root`)

| SCR | العنصر | السطر |
|---|---|---|
| 030 | نتيجة إرسال الدعوات | 3612 |
| 031 | رابط الانضمام العام الجديد | 3697 |
| 032 | تأكيد تجديد/إبطال الرابط | 3686 |
| 033 | تأكيد قبول دعوة قديمة | 3712 |
| 034 | دعوة قديمة / دعوة للانضمام (من `joinForm`) | 4046 و4051 |
| 035 | تأكيد الموافقة على طلب | 3753 |
| 036 | رفض طلب مع سبب | 3768 |
| 037 | تأكيد تسجيل الاستلام | 3785 |
| 038 | تأكيد تكرار التذكير | 3794 |
| 039 | سجل الاستلام (نافذة داخل الجمعية) | 3816 |
| 040 | تصحيح سجل الاستلام | 3821 |
| 041 | تأكيد تسجيل الخروج | 3826 |

### أدوات مشتركة

| SCR | الأداة | السطر |
|---|---|---|
| 050 | الشريط العلوي `renderTopbar` | 2843 |
| 051 | الشريط السفلي `nav` (الجمعيات، الرئيسية، الدردشات) | 2857 |
| 052 | الإشعار المنبثق `toast` | 2837 |
| 053 | منتقي الأيقونات `AVATAR_OPTIONS` (12) | 3474 |
| 054 | منتقي جهات الاتصال `inviteePickerHtml` | 3199 |
| 055 | إشعار تحديث PWA | 4155 |

## 3. تفصيل الشاشات

**القاعدة العامة (CONFIRMED).** كل `data-go` يمر بـ `go()` (2810)، وكل `data-action` يمر بـ `handleAppAction()` (3564). المستمع الموحّد عند 3872. النماذج تُعالَج في مستمع `submit` موحّد (3892) وفق قائمة معرفات في السطر 3894.

**حراسة `go()` (2810–2825):**
- شاشة غير مسجّلة في السجل تُرفض برسالة.
- شاشة غير مصادقة دون جلسة تُرفض برسالة "سجل الدخول أولاً".
- شاشات مقصورة على المدير: `members, member-reception, invite, invites, join-requests, join-request-detail, audit`، والتحقق من `targetDetail.role.manager`.
- `draw-room` مقصورة على المدير والمشارك.
- `invite` ممنوعة عند `permissions.canInvite` الكاذبة (الاتفاق مقفل).
- `applyNavigationState` (2782) تعيد توجيه المصادَق بعيداً عن شاشات الزائر والعكس.

> هذه الحراسة في الواجهة فقط. ما يحمي البيانات فعلياً هو RLS وRPC في قاعدة البيانات (يُفحص في مراحل لاحقة).

### SCR-001 تسجيل الدخول — CONFIRMED
- **العناصر:** `loginEmail`، `loginPassword` (`minlength=8`)، زر الإرسال، "نسيت كلمة المرور؟" (`data-action="forgot-password"`)، زر إنشاء حساب (`data-go="register"`).
- **الدخول:** submit `loginForm` (3922) ثم `withAuthTimeout(SahmSupabase.signIn)` بمهلة 25 ثانية (2838).
- **بعد الدخول:** `SahmSupabaseData.init/install` ثم `load()` ثم `startRemoteRealtime()`. التوجيه إلى `profile-setup` أو `join-group` (إن وُجد `?invite` أو `?join`) أو `home`.
- **التحقق:** خلوّ الحقول يعطي توست. الفشل يمر عبر `SahmSupabase.friendlyError`.
- **نسيت كلمة المرور:** `SahmSupabase.resetPassword(email)` (3650)، ويُشترط إدخال البريد أولاً.
- **ملاحظة:** توجد نسخة ثابتة من نموذج الدخول داخل `<main id="screen">` في الـ HTML (2552–2563) بلا `novalidate` ولا `minlength`. تُستبدل عند `render()`.

### SCR-002 إنشاء حساب — CONFIRMED
- **الحقول:** البريد، كلمة المرور، التأكيد، خانة الشروط (رابط `/terms.html`).
- **المعالج:** submit `registerForm` (3941). التحقق: موافقة الشروط، 8 أحرف على الأقل، تطابق كلمتي المرور.
- **التنفيذ:** `SahmSupabase.signUp(email,password,true)`. مع جلسة: تحميل الملف ثم `profile-setup`. بلا جلسة: رسالة تأكيد بريد ثم `welcome`.

### SCR-003 بياناتك الشخصية — CONFIRMED
- **الحقول:** منتقي 12 أيقونة (`choose-avatar`)، `fullName` (`minlength=5`)، قائمة دول `COUNTRIES` (3467)، ورقم الهاتف.
- **التحقق (3978–3995):** 3 مقاطع على الأقل في الاسم، تطبيع الأرقام العربية والفارسية، بناء E.164 بنمط `^\+[1-9][0-9]{7,14}$`.
- **التنفيذ:** `SahmSupabase.completeProfile()`، وهو RPC `complete_my_profile` في `sahm-supabase.js`.
- **ملاحظة:** `db.verified=true` يُضبط قسراً بعد الحفظ (4000).

### SCR-004 تعيين كلمة المرور
- تُفتح عند حدث `PASSWORD_RECOVERY` (4095) أو `?auth_action=reset-password` أو الهاش (4110).
- **المعالج:** `updatePasswordForm` (3962) ثم `updatePassword` وتنظيف `code` و`auth_action` من الرابط بـ `history.replaceState`.

### SCR-005 / 006
- `logout()` تعرض زر العودة للدخول.
- `accountLogin()` يضيف حساباً ثانياً أو يعيد ربط حساب انتهت جلسته (`pendingAccountLogin`). عند الفشل يُرجَع الحساب السابق (3914–3917).

### SCR-007 الرئيسية — CONFIRMED
- **العناصر:** زر الحساب والإشعارات في الشريط العلوي مع نقطة غير مقروء `db.unread`؛ دوّار ملخص من 3 شرائح (جمعيات تديرها / أشارك فيها / عددها) بتدوير تلقائي كل 5 ثوانٍ (2904) وسحب بـ pointer events (2903) ونقاط `home-slide`؛ اختصاران `home-managed` و`home-member`؛ بطاقتان `create-group` و`join-group`؛ دعوات واردة `homeInvitations()` (2928)؛ أحدث النشاط `homeActivity()` (2906)، أقصاه 5، يدمج `SahmApp.recentActivity(10)` مع طلبات المستخدم.
- **التوجيه:** مدير مع `join_request_submitted` يذهب إلى `join-request-detail`. صاحب الطلب إلى `join-request-status`. غير ذلك إلى `group-detail`.
- **مصدر البيانات:** `load()` (2708) من `SahmApp.*` المخزّنة محلياً، وتُغذّى من `SahmSupabaseData` (غير مقروء في هذه المرحلة).

### SCR-008–010 الجمعيات
- `groupCard()` (2875) تفتح بـ `open-group`، وتدعم لوحة المفاتيح (Enter/Space، 3561).
- بحث حي في `groupSearch` بالاسم و`inviteCode` (2954).
- مؤشر تقدم الأسهم للمدير فقط عند وجود `total`.
- شريط التبويبات `group-tab` له معالج (3658) ولا يصدره أي عنصر مقروء (انظر القسم 5).

### SCR-011 إنشاء جمعية — CONFIRMED حتى حدود `SahmApp.createGroup` (غير مقروءة)
- **الحقول:** الاسم، `startDate`، `firstDrawOn`، `shareAmount`، `currency` (YER/SAR/USD)، `installmentMode` (count/amount)، `installments`/`installmentAmount`، `managerMode` (only/both)، `managerShares`.
- **معاينة حية:** `createPreview()` (3011) تحسب مدة التحصيل وجدول الأقساط عبر `SahmCore.splitAmount/periods/addDays`.
- **التحقق `validateCreateStep(1,2)` (2985–3010):** الاسم من 2 إلى 120 حرفاً؛ `firstDrawOn > startDate`؛ المدة من 1 إلى 3650 يوماً؛ عدد الأقساط ≤ المدة؛ `installmentAmount ≤ shareAmount`؛ `ceil(share/amount) ≤ المدة`؛ أسهم المدير ≥ 1 عند `both`.
- **الإرسال (4008):** `SahmApp.createGroup(createDraft(form))`. النجاح يحدّث `currentGroupId` و`createdGroupLink` ثم `resetNavigation('created-group')`.
- **الحماية:** `createGroupBusy` تمنع النقر المزدوج.
- **ملاحظة:** `CREATE_STEP_COUNT=1` و`setCreateWizardStep` شبه ميتة (القسم 5).

### SCR-012 تم إنشاء الجمعية
- ملخص (بداية، أول قرعة، المدة، قيمة السهم، الأقساط، المشاركون، الجائزة)، رابط انضمام مع نسخ ومشاركة (`navigator.share` مع بديل النسخ)، ملاحظة إن كان الرابط متوقفاً أو غير منشأ، ومنتقي دعوة المشاركين `inviteePickerHtml()` وقائمة المرشحين وشريط الإرسال.

### SCR-013 تفاصيل الجمعية — INFERRED للتفاصيل الداخلية (في ملف آخر)
- `groupDetail()` (3116) بلا واجهة بنفسها. تتأكد من `SahmApp.groupDetail(g.id)` ثم تستدعي `SahmManagedGroup.render(g,d)`، وإلا تظهر "تعذر تحميل مساحة الجمعية".
- **المدير:** لوحة الأقسام العشرة (القسم 6).
- **العضو:** `memberDashboard` مع تبويبات `overview, installments, shares, draws, communication, news, chat` (من `sahm-managed-group.js` 889–905). التنقل عبر `groupDetailTab`.

### SCR-014 استقبال الأعضاء
- 4 إحصاءات؛ أزرار `members` و`invite` و`managed-home-section[invites]` و`join-requests`؛ حالة الرابط العام عبر `SahmSupabaseData.getPublicLinkStatus` (3124)؛ أزرار `create/pause/resume/rotate/revoke-group-link` يتحكم بتفعيلها `canInvite`.
- **ملاحظة:** هذه الشاشة يتيمة (القسم 5).

### SCR-015 إضافة أعضاء — CONFIRMED
- **اختيار جهات الاتصال:** `navigator.contacts.select` (3566)، وإن لم يُدعم تظهر رسالة والبديل الإضافة اليدوية.
- **إضافة يدوية:** الاسم ≥ 2 والهاتف.
- **قيود:** 50 جهة كحد أقصى (3577، 4029)؛ منع التكرار بتطبيع الهاتف `invitePhoneKey()` (3146) الذي يفترض الرمز 967 لأرقام بلا بادئة دولية؛ بحث عند أكثر من 5؛ تعطيل الصف إذا وُجدت دعوة نشطة لنفس الرقم (`activeInvitationForPhone` 3154).
- **الإرسال (3590):** `SahmApp.createInvitationsBulk` مع نافذة نتائج. لا تُرسل رسالة خارجية؛ يُنسخ الرابط ويُشارك يدوياً (النص صريح في 3612).

### SCR-016 تفاصيل الدعوة
- **المصدر:** `SahmSupabaseData.getMyInvitationDetails(id)` (3239).
- **حالات الرد:** `pending_response`, `interested`, `deferred`, `declined`, `legacy_accepted`.
- **الأزرار:** `invitation-interested/declined/deferred` تستدعي `SahmApp.respondToInvite`؛ `continue-invitation-join` تفتح نموذج الأسهم؛ `accept-legacy-invite-detail` تفتح تأكيداً ثم `join-confirm` ثم `SahmSupabaseData.acceptLegacyInvitationById`.
- **حراسة:** إن أُغلق الاستقبال (`isJoinOpen=false`) لا تُقبل الرغبة.

### SCR-017/018 الانضمام ونموذج الطلب
- **`joinForm`:** يحلّل الرابط (`?join` للعام و`?invite` للدعوة) في 4036. العام: `previewPublicJoinLink` ثم نموذج الطلب. الدعوة: `previewInvite` ثم نافذة بثلاثة أزرار أو نافذة الدعوة القديمة.
- **نموذج الطلب:** `requestedShares` (`min=1`)، معاينة الأقساط `joinInstallmentPreview()` (3311) تُعاد عند الكتابة، وخانة إقرار `confirmCommitment`.
- **الإرسال (4054):** `submitJoinRequestByInvitation` أو `submitJoinRequest(source,token,shares)`. النجاح ينقل إلى `join-request-status`. `joinRequestBusy` تمنع التكرار.
- الإقرار بأن العضوية لا تُنشأ إلا بعد موافقة المدير مكتوب في الواجهة (3309، 3335).

### SCR-019–021 طلبات الانضمام
- **الحالة (للمقدّم):** الأسهم المطلوبة والالتزام التقديري وسبب الرفض، وزر `cancel-join-request` عند `pending` (عبر `SahmSupabaseData.cancelJoinRequest`).
- **القائمة (للمدير):** `join-request-filter` بخمس حالات (`pending, approved, rejected, cancelled, all`).
- **التفصيل (للمدير):** الموافقة تفتح نافذة تأكيد ثم `SahmApp.approveJoinRequest` وتُحجب إن لم تتوفر `permissions.canInvite`. الرفض بسبب اختياري ≤ 1000 حرف ثم `SahmApp.rejectJoinRequest`. الحماية `joinDecisionBusy`.

### SCR-022/023 الاستلام
- **القائمة:** `SahmApp.receiptList(g.id,{includeVoided:isManager()})`. **التفصيل:** `SahmApp.receiptDetail`.
- **التصحيح:** `receipt-correct` ثم سبب بحد أدنى 3 أحرف ثم `SahmApp.correctReceipt(id,{action:'void',reason})`. السجل الأصلي يبقى في التدقيق (3821).

### SCR-024 الدردشات
- قائمة من `SahmApp.chatList()` بآخر رسالة وعدد غير المقروء وحالة الكتم. النقر يستدعي `data-go="chat"` ويتفرّع إلى `openAssociationWorkspace('chat')`.

### SCR-025 الإشعارات
- 9 أنواع مسمّاة (3427). النقر يستدعي `SahmApp.markNotificationsRead([id])`. إشعارات قبول/رفض الانضمام تنقل إلى `join-request-status`.

### SCR-026–028 الحساب والتعديل والإعدادات
- **الحساب:** الحسابات المحفوظة على الجهاز (`SahmSupabase.accounts()`) مع `switch-account` (3836) و`add-account`.
- **التعديل:** `profileForm` يحدّث الاسم والمدينة عبر `SahmSupabaseData.updateMyProfile` (4083). الهاتف معطّل.
- **الإعدادات:** مفتاح التنبيهات `notifToggle` يحفظ عبر `save()` ثم `SahmApp.savePrefs()`. بند "حماية الجلسة" معروض "غير متاح" دائماً (3439).

### SCR-029 والإجراءات المالية (معرّفة في `handleAppAction`، تُصدَر من `sahm-managed-group.js`)
- **`record-paid`:** نافذة تأكيد ثم `SahmApp.recordPaid({groupId,memberId,cycle,no})`. النص يؤكد أنه إقرار استلام لا تحويل مالي (3785).
- **`send-reminder`:** `SahmApp.sendReminder`. عند `code==='REMINDER_REPEAT'` تُطلب موافقة ثم `confirmRepeat:true`.
- **`schedule-draw`:** يحوّل موعداً بتوقيت عدن (UTC+3) إلى UTC عبر `adenDateTimeToUtc` (3375) ثم `SahmApp.setDrawScheduledAt`.
- **`run-draw`:** `SahmApp.performDraw` ثم `drawAnimationPending=true`.
- **`draw-presentation-completed/failed`:** `getDrawRoom` ثم `setDrawPresentationStatus(g.id,round,status)`.
- **`mute-toggle` و`notify-channel-toggle`:** مستمع `change` (3889–3890) يحفظ بـ `SahmApp.setMute/setNotifySettings`.

## 4. الوظائف المشتركة

**1) ترتيب تحميل الموارد:**
1. `<meta>` للجوال وPWA (`apple-mobile-web-app-*` و`theme-color`).
2. `/manifest.webmanifest`.
3. `fonts.googleapis.com` و`fonts.gstatic.com` (preconnect) وخطا IBM Plex Sans Arabic وDM Sans.
4. `/icons/sahm.svg` (أيقونة و`apple-touch-icon`).
5. ثلاث كتل `<style>` مضمنة (16، 2304، 2388).
6. `/sahm-managed-group.css` (2552، آخر ورقة فتتفوق في الترتيب).
7. السكربتات أسفل `<body>` (2565–2572): `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0` (نسخة مثبّتة)، ثم `sahm-supabase.js`، `sahm-core.js`، `sahm-data.js`، `sahm-app.js`، `sahm-supabase-data.js`، `sahm-navigation.js`، `sahm-managed-group.js`.
8. السكربت الرئيسي المضمن (2573–4147)، ثم سكربت PWA المضمن (4148–4235).

كل السكربتات الخارجية عادية بلا `defer` أو `async` (تحميل متسلسل متزامن). لا SRI على سكربت CDN (ملاحظة، لا فشل).

**2) السكربت المضمن الأول (2573–4147)** يعرّف في النطاق العام:
- ثوابت وأدوات: `$`, `money`, `today`, `AUTH_SCREEN_NAMES`.
- الحالة `db` وحزمة المتغيرات (`screenName`, `params`, `groupTab` …).
- الأيقونات `uiIcon` و`IC_*` و`decorateIcons` (تُشغَّل من `MutationObserver` على `#app`، 2701).
- الدوال: `load`, `save`, `refreshData`, `startRemoteRealtime`, `currentGroup`, `isManager`, `go`, `back`, `toast`, `shell`, `auth`, ودوال الشاشات، و`showModal` و`closeModal`، `handleAppAction`.
- `ALL_SCREEN_REGISTRY` و`COUNTRIES` و`AVATAR_OPTIONS`.
- `navigation = SahmNavigation.create({window,onChange})` (4089) ثم `navigation.start(...)` و`render()`، و`bootSahm()` (4117).
- `window.managedInviteComposerMarkup` و`window.bindManagedInviteComposer` مرتبطتان تلقائياً لأنهما تصريحا دالة في سكربت كلاسيكي، وتستعملهما `sahm-managed-group.js` عبر `root.` (CONFIRMED).
- متغيرات `let/const` لا تصير خصائص `window` لكنها مرئية للسكربتات الأخرى كمتغيرات عامة، وتستخدمها `sahm-managed-group.js` (`go`, `currentGroup`, `isManager`, `db`…). **هذا اقتران ضمني بين ملفين** (CONFIRMED من القراءة).
- يعتمد على كائنات من ملفات أخرى: `SahmCore`, `SahmApp`, `SahmSupabase`, `SahmSupabaseData`, `SahmNavigation`, `SahmManagedGroup`. سلوكها هنا **NOT VERIFIED** وتُفحص في مراحل لاحقة.

**3) الإقلاع (4117–4146) `bootSahm`:** يربط مستمع الجلسة؛ يسابق `SahmSupabase.session()` مع مهلة 10 ثوانٍ؛ عند المهلة يعرض توست ويكمل في الخلفية؛ `finishSahmBoot` يحمّل الملف ثم يبدأ المزامنة الفورية ثم يوجّه المستخدم. `bootVersion` مقارنة بـ `authInteractionVersion` تمنع أن يطغى إقلاع متأخر على دخول يدوي.

**4) سكربت PWA المضمن (4148–4235):** يسجّل `/sw.js` بنطاق `/` و`updateViaCache:'none'`؛ يفحص التحديث كل 10 ثوانٍ عند ظهور الصفحة وعند التركيز؛ يعرض إشعار تحديث ويرسل `SKIP_WAITING`؛ يعيد التحميل عند `controllerchange` مع علامة `sessionStorage['sahm-build-updated']`. `sw.js` نفسه لم يُقرأ هنا.

**5) الأمان في العرض (INFERRED):** `escapeHtml()` (3410) تُستخدم بكثافة. مواضع بلا تهريب:
- `db.user.phone` في `editProfile()` و`settings()` (3438–3439).
- `r.id` و`x.id` في بعض خصائص `data-id`.
- حقول `title` في `showModal` (3533) تُحقن مباشرة (قيمها ثابتة اليوم).
- `String(err.message)` في رسالة فشل الإقلاع (4092) تُحقن دون تهريب.
القيم في الغالب من خادم موثوق، لكنه خط دفاع ناقص. يحتاج تأكيد المصدر الفعلي لكل قيمة.

## 5. الملاحظات والمشكلات (بالأدلة)

1. **دالتان مستدعاتان وغير معرّفتين في هذا الملف: `chat()` و`invites()`** — INFERRED / NOT VERIFIED في باقي الملفات.
   - مواضع الاستدعاء: `startRemoteRealtime` (2752، 2759)، و`cancel-invite` (3709) في الفرع `else invites()`، و`chatForm` (4081).
   - لا تعريف لهما في الـ HTML ولا في `sahm-managed-group.js` (بحث نصي). لم تُفحص بقية الملفات.
   - `screenName` لا يستقر غالباً على `'chat'` ولا `'invites'`، إذ `chat` في السجل يحوّل إلى `openAssociationWorkspace` و`invites` ليست في `ALL_SCREEN_REGISTRY` أصلاً. فالمستمع الفوري لن يصل غالباً لهذه الفروع (INFERRED).
   - مسار `cancel-invite` المعروف يصدر من قسم الدعوات داخل `group-detail` فيأخذ الفرع الأول. أي مسار آخر يرمي `ReferenceError`.
   - `invites` موجودة في `IC_GO` (2652) وفي قائمة `managerOnly` (2816) بلا مقابل.

2. **متغير `pendingInvitees` بلا تصريح** في هذا الملف: يُسند (3085، 3219، 3230) ويُقرأ (3172) دون `let/var`. يعمل بإسناد ضمني في الوضع غير الصارم، ويرمي `ReferenceError` لو قُرئ قبل أي إسناد. التصريح في ملف آخر **NOT VERIFIED**.

3. **شاشات يتيمة (DEPRECATED CANDIDATE):**
   - `member-reception` و`invite`: لا يصدر أي `data-go` لهما ولا استدعاء `go('member-reception'` في الملفين المقروءين. البديل المنفّذ في `sahm-managed-group.js`: قسم الدعوات (`invites`) ومنتقي الدعوات المضمّن `managedInviteComposerMarkup`.
   - `join-requests`: يصل إليها فقط `member-reception` اليتيمة و`go('join-requests')` بعد الموافقة أو الرفض خارج الجمعية. البديل قسم الدعوات في ورشة المدير.
   - عناصر مرتبطة: `create-group-link`, `pause/resume/revoke-group-link` تُصدر فقط من `loadAssociationPublicLinkStatus` داخل `memberReception()`. **إدارة الرابط العام ربما لا تصل إليها واجهة المدير الحالية** (يلزم تأكيد من `sahm-managed-group.js`، وهو NOT VERIFIED).

4. **معالجات بلا عنصر مُصدِر في الملفين المقروءين (DEPRECATED CANDIDATE، NOT VERIFIED في الملفات الأخرى):** `group-tab`, `detail-tab` (3658)، `mute-toggle` (3889)، `copy-created-link` (3660)، `accept-legacy-invitation-inbox` (3703)، `join-late-confirm` (3720)، `bioToggle` (3887)، ومستمع `chatForm` (4079). الدردشة الفعلية تستخدم `mgdChatForm` في `sahm-managed-group.js` (مستمع مستقل).

5. **كود شبه ميت:** `CREATE_STEP_COUNT=1` و`setCreateWizardStep` (2962–2967) تثبّتان `createWizardStep=1` دوماً. بقايا معالج متعدد الخطوات.

6. **منطق توجيه ثقيل:** `openAssociationWorkspace` (3504) تعيد توجيه `members/installments/draw-room/draw-history/chat/news/audit` إلى `group-detail` عبر `params.managedSection`، فيحدث `go` متداخل أثناء `render()`. يحجب `managerOnly` الشاشة `audit` عن غير المدير، و`news` و`chat` مفتوحتان للعضو. `members` في `managerOnly` لكن العضو يصل إلى تبويب الأعضاء عبر `managed-open-member` (INFERRED: حراسة واجهة غير متسقة).

7. **سلوك قد يخدع المستخدم:** `db.verified=true` يُضبط تلقائياً بعد حفظ الملف (4000). بند "حماية الجلسة" مكتوب "غير متاح في معاينة الويب" (3439). `biometric` و`bioToggle` بلا عنصر.

8. **تناقض التسمية:** "معاينة" و"تخزين المعاينة" (رسالة `persisted===false` عند 2699) توحي بأن الملف معاينة، بينما الشيفرة تتصل بـ Supabase حقيقي.

9. **صيانة:** أسطر بطول 1000–2000 حرف؛ 238 `!important`؛ أيقونات تُحقن بعد العرض بـ `MutationObserver` وتعبيرات نمطية على نصوص عربية (`IC_TEXT/IC_HEAD/IC_LABEL`) فتغيير نص عربي قد يغيّر أيقونته أو يزيلها؛ `wallet` معرَّفة مرتين في `uiIcon`؛ `uiIcon` تعيد أيقونة `groups` الافتراضية لأي اسم ناقص، وأسماء مثل `calendar-check` و`x-circle` و`door-open` و`history` و`arrow-right` مستخدمة (3096، 2911، `sahm-managed-group.js`) وغير ظاهرة في قاموس `paths` هنا. أيقوناتها قد تُرسم كأيقونة `groups` ما لم يكن لـ `sahm-managed-group.js` قاموسه الخاص (NOT VERIFIED).

10. **أمان الجلسة (INFERRED):** الحسابات المحفوظة (`sahm.saved.accounts.v1`) وجلسات كل حساب في `localStorage` (من `sahm-supabase.js`). يُفحص في مرحلة الأمان.

## 6. الأسرار والأقسام العشرة

### الأسرار والمفاتيح
- **داخل الـ HTML:** لا مفتاح ولا سر ولا رمز ثابت. `token` الظاهر هو رمز دعوة/رابط قادم من المستخدم أو الخادم (مثل 4035).
- **داخل `sahm-supabase.js` (خارج نطاق المرحلة):** يوجد `SUPABASE_URL` ومفتاح عام باسم `PUBLISHABLE_KEY` من النوع المخصص للمتصفح. ورد في التعليق أن `service_role` لا يوضع فيه. **لا تُعرض القيمة هنا.** لم يُبحث عن أسرار في باقي الملفات.

### الأقسام العشرة لمدير الجمعية
المصدر: `sahm-managed-group.js` (`managerDashboard` عند 666–680، `MANAGER_SECTION_TITLES` عند 710).

| # | المعرف | الاسم | الأيقونة |
|---|---|---|---|
| 1 | `installments` | التحصيل | receipt |
| 2 | `draws` | القرعات | shuffle |
| 3 | `shares` | الأسهم | layers |
| 4 | `members` | الأعضاء | users |
| 5 | `invites` | الدعوات | user-plus |
| 6 | `chat` | الدردشة | messages |
| 7 | `room` | الغرفة | door-open |
| 8 | `information` | المعلومات | info |
| 9 | `settings` | الإعدادات | settings |
| 10 | `audit` | السجل | history |

**العرض:** `managerDashboard` تبني `<main class="mgd-home">` وفيه دوّار من 4 شرائح (أعضاء، أسهم، إنجاز القرعات، تحصيل القرعة الحالية) ثم شبكة 10 بطاقات `managed-home-section`.

**الانتقال بين الأقسام:**
1. النقر على بطاقة يمر بمستمع `click` في `sahm-managed-group.js` (944) الذي يوقف الانتشار، ويضبط `params={managedSection:id}` و`groupDetailTab='overview'` (للغرفة `managedDrawView='summary'`) ثم `syncNavigationContext()` و`redraw()`.
2. `render()` (865) تستدعي `renderManagerSection(...)` التي تبني الشاشة بـ `mountManagerSection` داخل `managerSectionFrame` برأس وزر رجوع.
3. زر `managed-section-home` يعيد `params={}` فتظهر اللوحة.
4. زر رجوع الشريط العلوي `back()` يمر بـ `navigation.back()`، والتنقل بين الأقسام عبر `syncNavigationContext()` فيُسجَّل في السجل (`navigation.replace`).

**ما قُرئ منها:** `installments/draws/shares/members/invites` بُنيت أمام الوكيل. باقي `renderManagerSection` للأقسام `chat/room/information/settings/audit` لم يُقرأ بتفصيل (NOT VERIFIED).

**للعضو:** أقسام أقل (`installments, shares, draws, communication`) مع تبويبات إضافية `news, chat` (من `memberTabs`).

**فجوة (INFERRED):** `news` ليس ضمن أقسام المدير العشرة، لكن `go('news')` في السجل يمرّر إلى `openAssociationWorkspace('news')` فيذهب المدير إلى قسم `members` (الاحتياطي عند 3509).

## 7. ما لم يُتحقق منه (NOT VERIFIED) وما تبقى

- تفاصيل CSS كلها (أسطر 16–2539) وسلوك `sahm-managed-group.css`.
- منطق الأعمال في `SahmApp` و`SahmCore` و`SahmSupabaseData` (أسماء RPC والجداول وRLS وسلوك `createGroup` و`performDraw` و`approveJoinRequest` على الخادم).
- `sw.js` و`sahm-navigation.js` (آلية `navigation.openModal/dismissModal/reset/replace`).
- أن `chat()` و`invites()` و`pendingInvitees` غير معرّفة في باقي الملفات.
- هل المعالجات "اليتيمة" تُصدَر من ملفات لم تُقرأ.
- باقي أقسام المدير (غير الخمسة الأولى) وواجهة العضو بتبويباتها.
- وجود أي مسار لإدارة الرابط العام (إنشاء/إيقاف/تجديد/إبطال) خارج `memberReception()` اليتيمة.
- كون الأيقونات الناقصة تُرسم فعلاً كأيقونة بديلة.
- لم يُتتبع كل مسار حتى الجدول (زر ← معالج ← دالة ← RPC ← عرض) إلا حتى حدود `SahmApp.*` و`SahmSupabaseData.*`. التتبع الكامل في مراحل تالية.

## 8. نقطة الاستئناف

المراحل التالية المخططة: قراءة `sahm-core.js` و`sahm-data.js`، ثم `sahm-supabase-data.js` و`sahm-supabase.js` و`sahm-app.js` و`sahm-navigation.js` و`sw.js`، ثم `sahm-managed-group.js/css`، ثم تدقيق قاعدة البيانات، ثم الاختبارات. كل مرحلة في ملف مستقل داخل `audit-results/` بـ Commit منفصل.
