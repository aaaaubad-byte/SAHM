# المرحلة 05b — تدقيق `sahm-managed-group.css`

- المرجع: الفرع `SAHM-SUPABASE`، آخر Commit تطبيقي بشري `7e33e157…`.
- طبيعة العمل: قراءة فقط. لا تعديل على التطبيق ولا Supabase ولا Render.
- الحالة: **قراءة الملف كاملة (CSS فقط)**. **مطابقة الأصناف مع JS وHTML (أي صنف مستخدم فعلاً) لم تُنفَّذ ومؤجلة إلى `05c`**؛ لذلك كل حكم «غير مستخدم» هنا هو INFERRED ولا يُبنى عليه حذف.
- التصنيفات: CONFIRMED (مقروء في نص الملف) / INFERRED / NOT VERIFIED / DEPRECATED CANDIDATE.
- الدليل: اسم المحدِّد أو الكتلة (الملف بلا ترقيم أسطر في مخرج `read_file`).

## 1. تغطية القراءة

`sahm-managed-group.css` (48135 بايت) قُرئ كاملاً في استجابة واحدة دون اقتطاع، وينتهي بقاعدة `.mgd-draw-overview b`.

## 2. البنية العامة (CONFIRMED)

- كل المحددات تبدأ بـ `#screen .mgd-*`، فالملف مقيَّد بمعرّف الحاوية `#screen` المعرَّف في HTML. التعليق الافتتاحي يقول «مجذَّر تحت `.mgd-*`» والواقع أن الجذر الفعلي هو `#screen`.
- لا يوجد في الملف: `font-family` (فقط `font:inherit` للحقول)، ولا `@font-face`، ولا `prefers-color-scheme` (لا وضع داكن)، ولا أي `min-width` في media queries. الخطوط والوضع الداكن إن وُجدا فمصدرهما خارج هذا الملف.
- نقاط التوقف أربع، كلها `max-width`: 340 و360 و380 و420. لا توجد قاعدة للشاشات الأكبر من الجوال.
- لا يحمل الملف أي بقايا مرئية للحضور أو النصاب: لا `attend` ولا `quorum` ولا `present` في أي محدِّد. (ينفع في سؤال الميزات الملغاة: الأثر في الواجهة CSS معدوم.)

## 3. طبقات الإضافة المتعاقبة (CONFIRMED)

الملف مبني بالإلحاق لا بالتصميم الموحد. التعليقات تفصل اثنتي عشرة طبقة بالترتيب:

| # | الطبقة (عنوان التعليق) | ملاحظة |
|---|---|---|
| 1 | Isolated managed-group workspace | الأساس: هوية بتدرج أزرق، تبويبات flex، بطاقات |
| 2 | Immediate feedback for async panels | `mgd-loading` والمؤشر الدوار |
| 3 | Compact manager header and five primary tabs | يعيد تعريف الهوية والتبويبات (شبكة 5 أعمدة) |
| 4 | Unified association workspace v2 | يعيد تعريف الهوية مرة ثالثة |
| 5 | Workspace visual pass | يعيد تعريف التبويبات والبطاقات والأزرار |
| 6 | Workspace visual cleanup — final | يحوّل الهوية إلى بطاقة بيضاء ويعيد تلوين الطبقات السابقة |
| 7 | Managed association landing | `mgd-home-*`: شريط شرائح وشبكة أقسام |
| 8 | Collection workspace | `mgd-collection-page`: شريط أدوات وبطاقات الأقساط وشريط التحديد |
| 9 | Unified inline search/filter row | مرشحات الأعضاء والقرعات |
| 10 | Independent manager section workspaces | `mgd-new-*` بلا شريط تبويبات قديم |
| 11 | Manager section content is final | بطاقات ثابتة `*-static` وقسم القرعة المجمّع |
| 12 | Invitations and join requests inline | ملخص الدعوات وطلبات الانضمام |

بعدها كتلتان بلا عنوان: `mgd-member-overview` و`mgd-draw-overview`.

**الأثر:** القيمة الفعلية لأي خاصية لا تُعرف بقراءة موضع واحد، بل بمتابعة آخر تعريف رابح في ترتيب المصدر. مثال: `.mgd-identity` تُعرَّف أربع مرات (الأساس، ثم 3، ثم 4، ثم 6). النتيجة الفعلية هي بطاقة بيضاء، وتدرج الأزرق والنص الأبيض من الطبقة 1 مُلغى بالطبقة 6.

## 4. النتائج (F-05b-)

### F-05b-01 — قواعد مُلغاة فعلياً بالتجاوز اللاحق — CONFIRMED (المنطق)، DEPRECATED CANDIDATE
بعد الطبقة 6 تفقد هذه القواعد أثرها في الهوية: ألوان النص الأبيض (`.mgd-identity` الأساس، `.mgd-identity-metrics>span` بلون `rgba(255,255,255,.82)`، `.mgd-identity-sub`، `.mgd-progress-caption`، `.mgd-progress` بلون أبيض شفاف). كلها مُعاد تعريفها بألوان داكنة في الطبقة 6. لا تُحذف قبل مطابقة 05c، لأن `.mgd-fact` و`.mgd-progress` قد تُستعمل في سياقات أخرى (مثل `.mgd-detail-card>.mgd-fact`).

### F-05b-02 — بقايا فراغات وكتل فارغة تدل على قواعد حُذفت — CONFIRMED
- كتلة `@media(max-width:380px){ }` **فارغة تماماً** قرب نهاية طبقة المرشحات.
- داخل `@media(max-width:420px)` ثلاثة أسطر فارغة، وبعد `.mgd-installment-summary` أسطر فارغة متتالية. هذا يتسق مع Commits الإزالة (مثل `chore(collection): remove obsolete selection styles`).

### F-05b-03 — لا نظام رموز تصميم؛ الألوان مكتوبة يدوياً — CONFIRMED
- الملف يقرأ ستة متغيرات فقط: `--radius-card` و`--sahm-font-home-card-title` و`--line` و`--surface` و`--muted` و`--primary`. غير أن `--radius-card` و`--primary` **بلا قيمة احتياطية**، فيعتمدان على تعريفهما في HTML (**NOT VERIFIED** حتى 05c). الباقي ألوان سداسية مباشرة.
- ما لا يقل عن سبع قيم زرقاء تؤدي دور لون العلامة/الإجراء: `#3158d6` و`#3158b7` و`#244fc2` و`#4267c9` و`#294fbf` و`#294aab` و`#244da9`، إضافةً إلى ألوان التدرجات (`#365bc0` و`#3568d8` و`#1d447f`). وكذلك أكثر من أخضر للحالة (`#18744f` و`#23815b` و`#28734a`) وأكثر من ذهبي.
- **للمعمارية الجديدة:** هذا الملف هو أوضح دليل على الحاجة إلى `tokens/` واحد، وعلى فحص CI يمنع الألوان الحرفية خارجه.

### F-05b-04 — قاعدة تخفي كتلة إجراءات كاملة — CONFIRMED (القاعدة)، الأثر INFERRED
`#screen .mgd-new-member-actions{display:none!important}` تأتي بعد قواعد تنسيق صريحة للكتلة نفسها (`margin-top`، وشبكة `.mgd-actions` بزرين وزر ثالث بعرض كامل). أي أن تنسيق إجراءات (يرجَّح أنها إدارة العضو) كُتب ثم أُخفي بالقوة. يتسق مع F-05-01 (لا إضافة/إزالة أسهم ولا إزالة عضو في قسم الأعضاء). **لا يُحسم** قبل التحقق في 05c: هل ما زال JS أو HTML يُخرج هذا الصنف؟ إن كان يُخرجه فهناك وظيفة موجودة ومخفية بـCSS لا بالمنطق.

### F-05b-05 — أصناف يُرجَّح أنها يتيمة بعد انتقال التصميم — INFERRED، DEPRECATED CANDIDATE
تنسيقات لواجهات تشير الوثيقة 05 إلى أنها استُبدلت أو غير قابلة للوصول: `.mgd-bulk-reminder` و`.mgd-member-tools` (التذكير الجماعي صار بالتحديد المطوَّل وشريط `.mgd-selection-bar`)، و`.mgd-filter-grid` و`.mgd-installment-filter-fields` المُبدَّل بصيغة المرشح المنسدل، و`.mgd-winner`، و`.mgd-back`، و`.mgd-detail-heading`، وقواعد عرض `member`/`cycle` (مرتبطة بـ F-05-02). التأكيد الوحيد المقبول هو مطابقة الأصناف في 05c.

### F-05b-06 — شبكة التبويبات بخمسة أعمدة مقابل تبويبات العضو — INFERRED
الطبقة 3 تضبط `.mgd-tabs{display:grid;grid-template-columns:repeat(5,…)}` ولم تُعدَّل في الطبقات اللاحقة. الوثيقة 05 تذكر أن تبويبات العضو أربعة (التحصيل، الأسهم، القرعات، التواصل) وأن المدير لا يستعملها (`tabs()` ترجع `''`). النتيجة المتوقعة للعضو: أربعة أزرار تشغل أربعة أخماس العرض. **يتطلب فحصاً بصرياً أو قراءة `tabs()` في HTML؛ لا يُنفَّذ هنا.**

### F-05b-07 — اعتماد على أصناف ومتغيرات يملكها غيره — CONFIRMED
أصناف يستهدفها الملف ولا يعرّفها: `.chatbubble` و`.chatbubble.mine` (الدردشة)، و`.draw-wheel` و`.draw-pointer` (العجلة)، و`.invitee-selection-bar` (محرر الدعوات)، إضافة إلى `#screen` والمتغيرات في F-05b-03. هذا اقتران بملفات/أنماط HTML المضمّنة، وهو الوجه الـCSS لاقتران JS الضمني الموثَّق في 05 §2. وصياغة طبقة 7 («reuse the application home visual language») تعني أن لغة الصفحة الرئيسية معرَّفة في موضع آخر (INFERRED: تكرار جزئي بين `mgd-home-*` وأنماط HTML).

### F-05b-08 — تعارض جهتين لحجم الهدف اللمسي والخط — CONFIRMED (القيم)، الأثر INFERRED
- ارتفاعات تحت 44px لعناصر تفاعلية: `.mgd-action` من 37 إلى 39px، وأزرار صفوف التحصيل 30px، وأزرار شريط التحديد 31px، وقوائم المرشح 34–36px، وأيقونات الأدوات بعرض 27–34px.
- أحجام الخطوط تنزل إلى 8px (`select` المرشح عند ≤380px) و9px في عدة مواضع، وتصعد إلى 25px (شريحة الصفحة الرئيسية).
- الأثر على سهولة الاستخدام والوصول INFERRED: لا فحص على جهاز فعلي.

### F-05b-09 — الحركة وتقليلها — CONFIRMED
ثلاث كتل `prefers-reduced-motion`. تغطي التبويبات والمؤشر الدوار وحركة `mgd-draw-panel` وانتقالات الصفحة الرئيسية. **لا تغطي** انتقالات صفحة التحصيل (`.mgd-installment-search` و`.mgd-tool-icon` والبطاقة) ولا انتقال `flex` في صف مرشح الأعضاء والقرعات.

### F-05b-10 — خلط الخصائص الفيزيائية والمنطقية في واجهة RTL — CONFIRMED (الوجود)
- منطقية: `inset` و`border-inline-start` و`padding-inline` و`margin-inline`.
- فيزيائية: `left`/`right` في مؤشر التبويب النشط وبطاقة الحالة، و`text-align:left` على `.mgd-fact>b` و`.mgd-progress-caption`، و`margin-right:auto`.
- `direction:rtl` صريح على `.mgd-installment-meta`، و`direction:ltr` على `.mgd-feed-time`.
- لا يُحكم أن أياً منها خطأ دون عرض فعلي. لكن في إعادة البناء يلزم قرار موحَّد (الاتجاه المنطقي).

### F-05b-11 — استعمال `!important` — CONFIRMED
خمسة مواضع: `.mgd-share-no` (خاصيتان)، وانتقال `.mgd-home-slide`، و`.mgd-selection-bar[hidden]`، و`.mgd-new-member-actions`، ومخطط حقل البحث (`outline` و`box-shadow`). الأخيران يعكسان تعارض الطبقات (F-05b-04) لا حاجة تصميمية.

### F-05b-12 — تكرار تعريفات حرفي — CONFIRMED
`.mgd-new-invite-list{display:flex;flex-direction:column;gap:8px}` معرَّف مرتين بنص متطابق (طبقة 10 وطبقة 12)، و`.mgd-cycle-main{gap:4px}` يكرر قيمة معرّفة سابقاً. كذلك `.mgd-tabs` و`.mgd-tabs button` معرّفان أربع مرات تقريباً، مع قيم متضاربة في الحجم والحشو بين الطبقات.

## 5. جرد المكونات البصرية (مرشح لـ `CMP-` و`design-system/`)

مستخلص من أسماء الأصناف وقواعدها (CONFIRMED وجودها في CSS؛ استعمالها الفعلي بانتظار 05c):

| الفئة | الأصناف |
|---|---|
| الهوية والتبويبات | `mgd-identity` (+ metrics وprogress وcurrent-round)، `mgd-tabs`، `mgd-draw-nav` (تبويب مقطعي) |
| البحث والمرشحات | `mgd-search`، `mgd-select`، `mgd-filterbar`، `mgd-inline-filter-toggle`، `mgd-installment-toolbar` |
| الأزرار | `mgd-action` (primary/disabled)، `mgd-tool-icon`، `mgd-secondary-link`، `mgd-back`، `mgd-reminder-icon` |
| البطاقات والقوائم | `mgd-member-card`، `mgd-cycle-card` (+ static)، `mgd-installment-card` (حالات paid/due/late/upcoming وselected)، `mgd-detail-card`، `mgd-simple-row`، `mgd-feed-card`، `mgd-audit-item`، `mgd-join-request-row`، `mgd-new-invite-row` |
| الحالات | `mgd-role`، `mgd-status-ok`، `mgd-share-state` (won/eligible)، `mgd-member-state`، `mgd-paid-state`، `mgd-reason`، `mgd-empty`، `mgd-loading` |
| الإدخال | `mgd-date-field`، `mgd-chat-form`، `mgd-toggle-row`، `mgd-inline-invite` (details) |
| التخطيط | `mgd-new-screen` (رأس + جسم)، `mgd-new-info-grid`، `mgd-member-stat-grid`، `mgd-member-overview`، `mgd-draw-overview`، `mgd-invite-summary`، `mgd-settings-grid`، `mgd-member-shortcuts` |
| الصفحة الرئيسية | `mgd-home-carousel` (شرائح blue/gold/dark ونقاط)، `mgd-home-section` (مربعات الأقسام) |

**ملاحظة معمارية:** أبسط المكونات (بحث، قائمة منسدلة، بطاقة، زر، حالة فارغة، مؤشر تحميل) معرَّفة هنا بأسماء خاصة بـ `mgd-`، بينما JS يستهلك من HTML مكونات عامة (`pill`, `uiIcon`, `chatbubble`). أي نظام تصميم واحد يجب أن يوحّد النسختين. هل توجد نسخة عامة موازية في CSS المضمّن في HTML؟ **NOT VERIFIED** (05c).

## 6. صلة الاختبارات (INFERRED من رسائل الـCommits فقط)

رسائل مثل `test(collection): validate compact card layout styles` تدل على أن بعض اختبارات `ui-contract` تتحقق من **نص CSS**. لم تُقرأ الاختبارات بعد، فلا حكم قبل مرحلة الاختبارات. إن ثبت ذلك فإعادة كتابة CSS ستكسر اختبارات لا تقيس سلوكاً.

## 7. ما تبقى من هذه المرحلة

1. مطابقة كل صنف `mgd-*` مع JS وHTML لتصنيفه: مستخدم / مُنتَج لكن مُخفى / يتيم (`05c`).
2. تحديد مصدر `--radius-card` و`--primary` و`--line` و`--surface` و`--muted` و`--sahm-font-home-card-title` في HTML.
3. التحقق البصري من F-05b-06 وF-05b-08 خارج نطاق القراءة الساكنة.

## 8. نقطة الاستئناف

التالي: المرحلة **06** (الجداول والأعمدة والقيود والفهارس وRLS والـView) باستعلامات `read_only: true` فقط، ثم 07 (الدوال والـTriggers وcron وRealtime)، ثم الأمان والتكرار والاختبارات والتقييم المعماري، ثم `05c`.
