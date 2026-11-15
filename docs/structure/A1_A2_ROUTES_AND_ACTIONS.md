# SAHM — جرد المسارات والتنقل والإجراءات (A1 + A2)

> ملف مساند لـ `docs/SAHM_APPLICATION_STRUCTURE.md`.
> المصدر: `Sahm_Preview_ROLE_SEPARATION.html` على الفرع `sahm-audit-and-fix` (مطابق لـ `SAHM-SUPABASE` عند بدء الفحص).
> طريقة الفحص: قراءة وتحليل نصي للمصدر فقط. لم يُشغَّل التطبيق في متصفح؛ لذلك كل ما هنا حالته `CODE_ONLY`.
> أرقام الأسطر تخص هذه النسخة من الملف، وقد تنزاح مع أي تعديل لاحق.

## 1. سجل الشاشات `ALL_SCREEN_REGISTRY` (سطر 3357)

عدد المسارات المسجلة: **35**، وتطابق الجرد المرقّم في القسم 11 من الوثيقة الرئيسية اسماً وترتيباً.
كل دالة شاشة موجودة فعلاً في المصدر.

| # | Route | دالة الشاشة | سطر التعريف | الحالة |
|---:|---|---|---:|---|
| 01 | `welcome` | `welcome` | 3293 | CODE_ONLY |
| 02 | `register` | `register` | 3310 | CODE_ONLY |
| 03 | `account-login` | `accountLogin` | 3335 | CODE_ONLY |
| 04 | `profile-setup` | `profileSetup` | 3345 | CODE_ONLY |
| 05 | `reset-password` | `resetPasswordScreen` | 3302 | CODE_ONLY |
| 06 | `logged-out` | `logout` | 3356 | CODE_ONLY |
| 07 | `home` | `home` | 2627 | CODE_ONLY |
| 08 | `groups` | `groups` | 2689 (مدمجة في سطر واحد مع `setHomeSlide`) | CODE_ONLY |
| 09 | `managed-groups` | `managedGroups` | 2702 (تضبط `groupTab='manager'` ثم تستدعي `groups()`) | CODE_ONLY |
| 10 | `joined-groups` | `joinedGroups` | 2703 (تضبط `groupTab='member'` ثم تستدعي `groups()`) | CODE_ONLY |
| 11 | `create-group` | `createGroup` | 2797 | CODE_ONLY |
| 12 | `created-group` | `createdGroup` | 2842 | CODE_ONLY |
| 13 | `group-detail` | `groupDetail` | 2854 | CODE_ONLY |
| 14 | `members` | `members` | 2909 | CODE_ONLY |
| 15 | `member-reception` | `memberReception` | 3060 | CODE_ONLY |
| 16 | `invite` | `invite` | 2978 | CODE_ONLY |
| 17 | `invites` | `invites` | 3049 | CODE_ONLY |
| 18 | `invite-detail` | `inviteDetail` | 3000 | CODE_ONLY |
| 19 | `join-group` | `joinGroup` | 3081 | CODE_ONLY |
| 20 | `join-request-status` | `joinRequestStatus` | 3118 | CODE_ONLY |
| 21 | `join-requests` | `joinRequests` | 3125 | CODE_ONLY |
| 22 | `join-request-detail` | `joinRequestDetail` | 3139 | CODE_ONLY |
| 23 | `installments` | `installments` | 3151 | CODE_ONLY |
| 24 | `draw-room` | `drawRoom` | 3184 | CODE_ONLY |
| 25 | `draw-history` | `drawHistory` | 3213 | CODE_ONLY |
| 26 | `receipts` | `receipts` | 3217 | CODE_ONLY |
| 27 | `receipt-detail` | `receiptDetail` | 3221 | CODE_ONLY |
| 28 | `chat` | `chat` | 3244 | CODE_ONLY |
| 29 | `wall` | `wall` | 3249 | CODE_ONLY |
| 30 | `news` | `news` | 3269 | CODE_ONLY |
| 31 | `notifications` | `notifications` | 3263 | CODE_ONLY |
| 32 | `audit` | `audit` | 3276 | CODE_ONLY |
| 33 | `profile` | `profile` | 3284 | CODE_ONLY |
| 34 | `edit-profile` | `editProfile` | 3291 | CODE_ONLY |
| 35 | `settings` | `settings` | 3292 | CODE_ONLY |

ملاحظات:
- الشاشتان 09 و10 لا تملكان واجهة مستقلة؛ كلتاهما تغيّران `groupTab` ثم تعرضان واجهة 08 نفسها.
- الدالتان `profile` و`editProfile` و`settings` تقعان في سطور متجاورة (3284 إلى 3292) وعلى الأرجح مدمجتان في أسطر قليلة؛ تفصيلهما ضمن A6.
- كل قيم `data-go` المستخدمة في المصدر (24 وجهة مختلفة) موجودة في السجل؛ لا توجد وجهة `data-go` تشير إلى route غير مسجل.

## 2. التصيير والتنقل

| الدالة | سطر | الوظيفة (كما تظهر في المصدر) |
|---|---:|---|
| `render()` | بعد 3357 | تستدعي دالة الشاشة الحالية من السجل؛ إن لم توجد تعرض تنبيهاً وتعيد التنقل إلى `home` أو `welcome` حسب الجلسة؛ ثم `syncBottomNavigation` |
| `go(s,p,context)` | 2554 | الانتقال إلى شاشة (يتحقق من وجودها في السجل عند السطر 2555) |
| `resetNavigation(s,p)` | 2569 | إعادة ضبط مكدس التنقل ثم فتح شاشة |
| `nav(active)` | 2599 | يبني الشريط السفلي |
| `syncBottomNavigation(visible)` | 2598 | يُظهر الشريط السفلي أو يخفيه (يُخفى في شاشات المصادقة) |
| `shell(title,active,html)` | 2607 | غلاف الشاشات بعد الدخول: الشريط العلوي + الشريط السفلي + الحاوية `#screen` |
| `auth(html)` | بعد 2607 | غلاف شاشات المصادقة: شريط علوي بعنوان خاص، إخفاء الشريط السفلي، صنف `auth-screen` |
| `showModal(title,body,buttons)` | 3371 | عرض نافذة حوارية داخل `#modal-root` |
| `handleAppAction(action,el)` | 3405 | موزّع إجراءات `data-action` |

شاشات المصادقة `AUTH_SCREEN_NAMES` (سطر 2403): `welcome` و`register` و`profile-setup` و`reset-password` و`logged-out` و`account-login`.

### الشريط السفلي (سطر 2599 إلى 2606)

ثلاث عناصر فقط، كلها `data-go`:

| الترتيب في المصدر | الوجهة | الأيقونة | النص |
|---:|---|---|---|
| 1 | `groups` | groups | الجمعيات |
| 2 | `home` | home | الرئيسية |
| 3 | `wall` | messages | الدردشات |

منطق التفعيل `resolvedActive`:
- يُفعَّل «الجمعيات» لكل الشاشات الواردة في `groupScreens` (قائمة من 20 شاشة تقريباً تبدأ بـ `groups` و`managed-groups` و`joined-groups` وتشمل الإنشاء والتفاصيل والأعضاء والدعوات والانضمام والأقساط والقرعة والاستلام…) أو عندما `active==='groups'`.
- يُفعَّل «الدردشات» للشاشتين `wall` و`chat` فقط.
- ما عدا ذلك يُفعَّل «الرئيسية».

أي شاشة غير واردة في `groupScreens` ولا `wallScreens` (مثل `notifications` و`news` و`profile` و`settings` و`audit`) تُظهر «الرئيسية» نشطة. هذا سلوك قائم في الكود وليس قراراً موثّقاً؛ يُدقَّق ضمن A2 اللاحق.

## 3. النوافذ الحوارية `showModal`

دالة التعريف عند 3371، وفيها 13 موضع استدعاء. الحالة: CODE_ONLY لكلها.

| سطر | العنوان (كما في المصدر) | الإجراءات الظاهرة في النافذة |
|---:|---|---|
| 3453 | نتيجة إرسال الدعوات | إغلاق (افتراضي) |
| 3529 | عنوان ديناميكي حسب إجراء رابط الانضمام (تدوير أو إلغاء) | تأكيد (`confirm-public-link-action`) وإلغاء |
| 3540 | رابط الانضمام العام | عرض الرابط الجديد مرة واحدة؛ النص يحذّر من أن الرمز السري لا يُستعاد لاحقاً |
| 3555 | تأكيد قبول الدعوة القديمة | قبول الدعوة (`join-confirm`) |
| 3596 | تأكيد الموافقة | الموافقة على طلب الانضمام (بعدد الأسهم المطلوب كاملاً) |
| 3611 | رفض طلب الانضمام | حقل سبب اختياري (`joinRejectReason`، حتى 1000 حرف) |
| 3628 | تأكيد تسجيل الاستلام | تأكيد تسجيل قسط مستلم خارج التطبيق |
| 3643 | تأكيد تكرار التذكير | `send-reminder-confirm` |
| 3648 | تأكيد تكرار التذكير (موضع ثانٍ في معالج التذكير) | نفس السابق؛ تكرار منطق محتمل |
| 3667 | تصحيح سجل الاستلام | حقل سبب التصحيح؛ الأصل يبقى في سجل التدقيق |
| 3672 | تسجيل الخروج | تأكيد الخروج (`logout-now`) |
| 3892 | دعوة قديمة | عرض بيانات الدعوة القديمة |
| 3897 | دعوة للانضمام إلى جمعية | اهتمام (`invitation-interested`) ورفض (`invitation-declined`) وغيرهما |

- إغلاق النافذة عبر `overlay-close` و`close`.
- النافذة تضبط التركيز على أول عنصر قابل للتركيز وتعيده عند الإغلاق.

## 4. الإجراءات المعالَجة في `handleAppAction`

**61** إجراء بصيغة `action==='…'` بدءاً من السطر 3405، بالإضافة إلى 5 إجراءات روابط الانضمام العامة التي تُعالَج بمجموعة واحدة عند السطر 3533 (`create-group-link` و`rotate-group-link` و`pause-group-link` و`resume-group-link` و`revoke-group-link`). كل قيم `data-action` المستخدمة في المصدر (50 قيمة) لها معالجة؛ الأربع التي لا تظهر بصيغة `action===` تُعالَج ضمن المجموعة المذكورة.

الإجراءات حسب المجال (من أسماء الحالات في المعالج؛ السلوك التفصيلي يُوثَّق في A6):

- **الحساب والجلسة:** `add-account` و`cancel-account-login` و`choose-avatar` و`forgot-password` و`logout-confirm` و`logout-now` و`switch-account`.
- **التنقل العام:** `back` و`close` و`overlay-close` و`open-group` و`open-draw-history` و`notification-open`.
- **الرئيسية:** `home-managed` و`home-member` و`home-slide`.
- **الجمعيات والتبويبات:** `group-tab` و`detail-tab` و`create-next` و`create-prev` و`mute-toggle` و`notify-channel-toggle`.
- **روابط الانضمام العامة:** `copy-group-link` و`share-group-link` و`copy-created-link` و`confirm-public-link-action` + المجموعة الخماسية أعلاه.
- **الدعوات:** `pick-device-contacts` و`submit-bulk-invites` و`copy-bulk-invite-link` و`share-bulk-invite-link` و`copy-new-invite` و`cancel-invite` و`remove-invitee` و`accept-legacy-invitation-inbox` و`accept-legacy-invite-detail` و`continue-invitation-join` و`invitation-interested` و`invitation-declined` و`invitation-deferred`.
- **طلبات الانضمام:** `join-confirm` و`join-late-confirm` و`join-request-filter` و`approve-join-request` و`approve-join-request-confirm` و`reject-join-request` و`reject-join-request-confirm` و`cancel-join-request`.
- **الأقساط والاستلام:** `installment-filter` و`record-paid` و`record-paid-confirm` و`send-reminder` و`send-reminder-all` و`send-reminder-confirm` و`receipt-open` و`receipt-correct` و`receipt-correct-confirm`.
- **القرعة:** `schedule-draw` و`run-draw` و`draw-presentation-completed` و`draw-presentation-failed`.

## 5. ملاحظات ومراجعات (لا إصلاح ضمن هذه الجولة)

| # | الملاحظة | الحالة |
|---:|---|---|
| N1 | موضعان لتأكيد تكرار التذكير (3643 و3648) بمنطق متشابه | DUPLICATE_REVIEW |
| N2 | شاشات `notifications` و`news` و`profile` و`settings` و`audit` تُظهر «الرئيسية» نشطة في الشريط السفلي؛ السبب أنها خارج `groupScreens` و`wallScreens` | CODE_ONLY، يحتاج قراراً لاحقاً |
| N3 | الشاشة 29 `wall` اسمها في الشريط «الدردشات» بينما تسمية الشاشة المفردة `chat` «محادثة الجمعية»؛ الوثيقة الرئيسية تفرق بينهما بالفعل | موثق |
| N4 | السطور الطويلة المدمجة (مثل 2689 و2702 و2703) تصعّب التتبع؛ أي توثيق لاحق يعتمد على اسم الدالة لا رقم السطر | ملاحظة منهجية |

## 6. ما لم يكتمل من A1 وA2

- لم تُفحص نقاط الدخول الأخرى: `index.html` و`terms.html` و`sahm-app.js` و`sahm-navigation.js`.
- لم يُتتبع مكدس التنقل داخل `go()` و`resetNavigation()` ولا سلوك `back`.
- لم تُتحقق أي حالة تشغيلياً.
