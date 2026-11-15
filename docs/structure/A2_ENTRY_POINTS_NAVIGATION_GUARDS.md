# SAHM — نقاط الدخول وطبقة التنقل وحراس الوصول وهيكل الغلاف (إكمال A2 وبداية A3)

> ملف مساند لـ `docs/SAHM_APPLICATION_STRUCTURE.md`، يكمل `docs/structure/A1_A2_ROUTES_AND_ACTIONS.md`.
> المصدر: الفرع `sahm-audit-and-fix`. الفحص بقراءة المصدر فقط، وكل بند `CODE_ONLY` ما لم يُذكر غير ذلك.
> أرقام الأسطر تخص `Sahm_Preview_ROLE_SEPARATION.html` في هذه النسخة.

## 1. نقاط الدخول والملفات المحمّلة

| الملف | النوع | ما يفعله (كما في المصدر) |
|---|---|---|
| `index.html` | نقطة دخول | صفحة إعادة توجيه إلى `/Sahm_Preview_ROLE_SEPARATION.html` عبر `meta refresh` و`location.replace`، مع رابط احتياطي «فتح معاينة سهم». لا تحوي واجهة تطبيق |
| `Sahm_Preview_ROLE_SEPARATION.html` | التطبيق | الواجهة كلها وسجل الشاشات والمعالجات |
| `terms.html` | صفحة ثابتة مستقلة | الشروط والأحكام، الإصدار `2026-11-14`، سبعة أقسام وتنبيه بأنها وثيقة أولية تحتاج اعتماداً قانونياً، وزر «العودة إلى سهم». يحمّل خطوط Google. تُفتح من شاشة التسجيل (سطر 3316) في تبويب جديد |
| `manifest.webmanifest` و`icons/sahm.svg` و`sw.js` | PWA | خارج نطاق هذه الجولة؛ لا يُفحص ولا يُعدَّل |

ترتيب تحميل السكربتات في التطبيق (سطور 2392 إلى 2398):
1. `@supabase/supabase-js@2.119.0` من CDN (jsDelivr)
2. `/sahm-supabase.js`
3. `/sahm-core.js`
4. `/sahm-data.js`
5. `/sahm-app.js`
6. `/sahm-supabase-data.js`
7. `/sahm-navigation.js`

## 2. هيكل الغلاف (سطور 2381 إلى 2390)

```text
[تطبيق] body
└── [حاوية] .workspace
    └── [حاوية] .phone  #app
        ├── [منطقة] #topbar   (يبدأ display:none)
        ├── [منطقة] #screen   (main، يبدأ بصنف auth-screen)
        ├── [منطقة] #bottomnav (nav، يبدأ display:none)
        ├── [منطقة] #modal-root
        └── [رسالة] #toast   (role=status، aria-live=polite)
```

- يوجد عنصر `noscript` يعرض «سهم» فقط عند تعطيل JavaScript.
- `header(title,sub)` (سطر 2581) تعيد نصاً فارغاً دائماً؛ العناوين وزر الرجوع ينتقلان بالكامل إلى الشريط العلوي.
- `toast(t)` (سطر 2580) يعرض النص في `#toast` لمدة 2300 ميلي ثانية.

## 3. الشريط العلوي `renderTopbar(title)` (سطر 2585)

| الحالة | السلوك |
|---|---|
| شاشة مصادقة (ضمن `AUTH_SCREEN_NAMES`) | يُخفى الشريط ويُفرَّغ |
| شاشة `home` | شريط `home-topbar` بدون عنوان: [زر] الحساب (`data-go=profile`، أيقونة user)، [زر] الإشعارات (`data-go=notifications`، أيقونة bell) مع [شارة] نقطة عندما `db.unread>0` |
| أي شاشة أخرى بعد الدخول | [زر] رجوع (`data-action=back`، أيقونة back-screen) + [عنوان] اسم الشاشة (الافتراضي «سهم») |

عناوين شاشات المصادقة (سطر 2608، تُمرَّر إلى `renderTopbar` لكنها لا تظهر لأن الشريط مخفي فيها): `welcome` «تسجيل الدخول»، `register` «إنشاء حساب»، `profile-setup` «بياناتك الشخصية»، `reset-password` «تعيين كلمة المرور»، `logged-out` «تم تسجيل الخروج»، `account-login` «إضافة أو استعادة حساب».

مصدر الوصول: زر الحساب والإشعارات لا يظهران إلا في `home`؛ في بقية الشاشات الوصول إليهما عبر الرئيسية فقط (لا يوجد عنصر شريط سفلي لهما).

## 4. محرك التنقل `sahm-navigation.js` (`SahmNavigation`، الإصدار 1)

- مبدأ الملف المعلن: سجل المتصفح (History API) هو المصدر الوحيد للحقيقة.
- يرمي خطأ إذا لم يتوفر `history.pushState` و`replaceState` و`back`.
- حالة المسار (snapshot): `screenName` و`params` و`currentGroupId` و`groupTab` (الافتراضي `all`) و`groupDetailTab` (الافتراضي `overview`) و`viewState`، مع `depth` و`epoch` و`layer` (`screen` أو `modal`).

| الدالة | السلوك |
|---|---|
| `start(snapshot)` | `replaceState` للحالة الأولى بعمق 0 |
| `navigate(snapshot)` | `pushState` بعمق +1؛ يغلق نافذة مفتوحة أولاً؛ لا يدفع شيئاً إن كان المسار مطابقاً للحالي |
| `replace(snapshot)` | `replaceState` بنفس العمق |
| `reset(snapshot)` | يرفع `epoch` ويعيد العمق إلى 0 (حد المصادقة)؛ المداخل القديمة لا تُستعاد |
| `openModal()` / `dismissModal()` | طبقة `modal` تُدفع كمدخل سجل؛ الإغلاق الصريح `replaceState` متزامن لتفادي `popstate` قديم |
| `back()` | لا يفعل شيئاً إن كان العمق 0 ولا طبقة نافذة؛ وإلا `history.back()` |
| `forward()` | `history.forward()` |
| معالج `popstate` | يتجاهل المداخل ذات `epoch` مختلف (لا يبعث شاشة من جلسة دخول/خروج سابقة)؛ يحوّل نافذة مستعادة إلى الشاشة التي تحتها؛ ينادي `onChange(snapshot,'popstate')`؛ للحالات الخارجية ينادي `onExternalPop` |

دوال التطبيق المرتبطة بها في الواجهة:

| الدالة | سطر | السلوك |
|---|---:|---|
| `go(s,p,context)` | 2554 | يتحقق من الشاشة والجلسة والحراس (القسم 5) ثم `navigation.navigate(routeSnapshot(...))` ثم `applyNavigationState` |
| `resetNavigation(s,p)` | 2569 | `navigation.reset` ثم `applyNavigationState` |
| `syncNavigationContext()` | 2574 | `navigation.replace` للحالة الحالية |
| `back()` | 2575 | `navigation.back()`؛ إن فشل: بعد الدخول يعود إلى `home` (إن لم نكن فيها)، وقبل الدخول يعود إلى `welcome` |

## 5. حراس الوصول داخل `go()` (سطور 2555 إلى 2564)

هذه الحراس **على مستوى الواجهة** وتعرض `toast` ثم ترفض الانتقال. لم يُتحقق من وجود ما يقابلها في المحرك أو قاعدة البيانات؛ ذلك ضمن A4.

| الشرط | الشاشات | الرسالة |
|---|---|---|
| route غير مسجل | أي شاشة | «تعذر فتح الشاشة المطلوبة» |
| لا جلسة وشاشة خارج المصادقة | أي شاشة غير مصادقة | «سجل الدخول أولاً للمتابعة» |
| مدير الجمعية فقط (`role.manager`) | `members` و`member-reception` و`invite` و`invites` و`join-requests` و`join-request-detail` و`audit` | «هذه الوظيفة متاحة لمدير هذه الجمعية فقط» |
| مدير أو مشارك (`role.manager` أو `role.participant`) | `draw-room` | «غرفة القرعة متاحة لأعضاء الجمعية فقط» |
| `permissions.canInvite` غير متاح (الاتفاق مقفل) | `invite` | «الاتفاق مقفل؛ لا يمكن إرسال دعوات جديدة» |

وسلوك إضافي: عند الانتقال إلى `create-group` من غير `create-group` تُعاد خطوة المعالج إلى 1 ويُفرَّغ `createFormSnapshot`. وعند `managed-groups` / `joined-groups` يُضبط `groupTab` إلى `manager` / `member`.

الشاشات التي لا يفرض عليها `go()` أي صلاحية دور: `installments` و`receipts` و`receipt-detail` و`draw-history` و`chat` و`news` و`join-request-status` و`join-group` و`invite-detail`. الحماية فيها (إن وجدت) داخل الشاشة نفسها أو في المحرك؛ **غير متحقق** حتى A4.

## 6. طبقة الربط `sahm-app.js` (`SahmApp`)

- الغرض المعلن: مسار الربط الوحيد بين الشاشات و`SahmData`/`SahmCore`. لا حساب ولا قاعدة صلاحيات فيها، ولا وصول DOM.
- تحتفظ بنسخة واحدة من المخزن `db` (`SahmData.load()`) وتحقن `(db, viewer)` في كل عملية.
- ثلاث مجموعات:
  - عمليات الفاعل (21): `createGroup` و`updateGroup` و`addMember` و`addShares` و`removeShares` و`removeMember` و`setAttendance` و`createInvite` و`createInvitationsBulk` و`managePublicLink` و`cancelInvite` و`recordPaid` و`correctReceipt` و`sendReminder` و`performDraw` و`sendMessage` و`setNotifyType` و`setMute` و`markChatRead` و`markNotificationsRead` و`joinByCode`.
  - استعلامات العرض (12): `groupDetail` و`installmentRows` و`memberStatement` و`receiptList` و`receiptDetail` و`eventLog` و`memberList` و`inviteList` و`myInvitations` و`drawHistory` و`notificationList` و`chatView`.
  - مساعدات بلا مشاهد (5): `drawStatus` و`previewJoin` و`inviteSummary` و`getInviteInfo` و`lastReminder`.
- دوال إضافية: `useRemoteStore` (استبدال اللقطة بلقطة خادم موثقة) و`clearStore` و`myGroups` و`roleOf` و`chatList` و`recentActivity` و`unreadNotifications` و`tick` و`storageState` و`takeNotices` و`prefs` و`savePrefs` و`nowAt` و`todayIn` و`chatTime` و`timeZone` و`notifyTypes` و`maxMessage`.
- نتائج الفشل أو عدم الحفظ تُبلَّغ مرة واحدة عبر `onResult`.

## 6.1 ملاحظات

| # | الملاحظة | الحالة |
|---:|---|---|
| N5 | `terms.html` (قسم 3) ما زالت تذكر «الحضور» ضمن البيانات المستخدمة، بينما سجل التقدم يوثق إيقاف الحضور والنصاب في المحرك | DUPLICATE_REVIEW (تعارض محتوى؛ لا إصلاح الآن) |
| N6 | `SahmApp.setAttendance` ما زالت ضمن `ACTOR_OPS`؛ سجل التقدم ينص على أن الدالة تُرجع `ATTENDANCE_RETIRED`، لكن لم أتحقق من ذلك في `sahm-data.js` بعد | UNTRACED |
| N7 | زر الحساب والإشعارات في الشريط العلوي للرئيسية فقط؛ لا يوجد وصول مباشر لهما من الشاشات الأخرى | موثق |
| N8 | `go()` يفرض صلاحيات دور على شاشات محددة فقط (القسم 5)؛ بقية الشاشات تعتمد على فحص خارج `go()` | NOT_VERIFIED |
| N9 | التطبيق يحمّل `@supabase/supabase-js` من CDN مع `sahm-supabase.js` قبل `sahm-core.js`؛ ترتيب `sahm-app.js` قبل `sahm-supabase-data.js` | موثق |

## 7. ما لم يكتمل

- مكدس التنقل لم يُشغَّل؛ السلوك مُستنتج من المصدر.
- `routeSnapshot()` و`applyNavigationState()` لم تُقرأ تفصيلاً.
- `uiIcon` والأيقونات والمكوّنات المشتركة والرسائل (A3) لم تُجرد بعد.
- أزرار كل نافذة حوارية كاملة لم تُستخرج.
