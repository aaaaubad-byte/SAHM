# المرحلة 04 — التنقل وService Worker وملفات PWA وسير العمل (CI)

- المرجع: الفرع `SAHM-SUPABASE`. آخر Commit تطبيقي بشري `7e33e157…`. (Commits ما بعده: تدقيق وأختام بوت.)
- طبيعة العمل: قراءة فقط.
- الحالة: **مكتملة** للملفات التالية، كل ملف قُرئ كاملاً في استجابة واحدة: `sahm-navigation.js`, `sw.js`, `index.html`, `terms.html`, `manifest.webmanifest`, `icons/sahm.svg`, `README.md`, `.github/workflows/refresh-sahm-pwa-worker.yml`, `node-tests.yml`, `supabase-local-sql-tests.yml`.
- التصنيفات: CONFIRMED / INFERRED / NOT VERIFIED / MISSING / BLOCKED / DEPRECATED CANDIDATE.
- الدليل: اسم الدالة أو الخطوة داخل الملف (لا ترقيم أسطر في مخرج `read_file`).

## 0. تنبيه تشغيلي يخص عملية التدقيق نفسها (مهم)

**CONFIRMED:** سير العمل `refresh-sahm-pwa-worker.yml` يعمل عند **كل push** إلى `SAHM-SUPABASE` عدا ما يمس `sw.js` وحده (`paths-ignore: sw.js`). لذلك **كل Commit تدقيق في `audit-results/` يُنتج Commit ثانياً من البوت يعدّل `sw.js`** (يغيّر `BUILD_ID`). وهذا ظاهر في سجل الفرع: بعد كل Commit تدقيق يليه `chore(pwa): stamp worker for <sha>`، وقيمة `BUILD_ID` الحالية في `sw.js` هي `58d1dd974d3a` أي Commit المرحلة 02.

**الأثر:**
1. يتغير ملف تطبيق (`sw.js`) على الفرع المرجعي بفعل البوت رغم أن التدقيق لا يمسه (أثر جانبي غير مباشر).
2. لأن اسم الكاش يتضمن `BUILD_ID`، سيرى كل مستخدم نشط إشعار «تحديث متاح» ويعيد تنزيل الحزمة بعد كل Commit تدقيق، حتى لو لم يتغير التطبيق.
3. إن كانت خدمة Render مضبوطة على النشر التلقائي من هذا الفرع (**NOT VERIFIED / BLOCKED**) فإن **كل Commit تدقيق وكل Commit بوت يُطلق نشراً**. وهذا يتعارض مع قيد «لا تنشر أي خدمة» إن كان النشر التلقائي مفعلاً.

**القرار المطلوب منك:** هل النشر التلقائي في Render مفعّل لهذا الفرع؟ وهل تقبل أثر الإشعار على المستخدمين؟ لم أغيّر سير العمل ولا إعدادات الاستضافة. (بدائل خارج صلاحياتي: إضافة `audit-results/**` إلى `paths-ignore`، أو إيقاف النشر التلقائي مؤقتاً.)

## 1. `sahm-navigation.js`

### 1.1 ما يفعله (CONFIRMED)
- محرك تنقل مبني على History API، وحالة المسار تُخزَّن في `history.state` بصيغة `{__sahmNavigation, version:1, epoch, depth, layer('screen'|'modal'), screenName, params, currentGroupId, groupTab, groupDetailTab, viewState}`.
- الدوال: `start`, `navigate` (دفع Entry، ويتجاهل المسار المطابق بمقارنة `JSON.stringify`)، `replace`, `reset` (يزيد `epoch` عند حدود المصادقة)، `openModal` (دفع Entry بطبقة `modal`)، `dismissModal` (استبدال Entry الحالي)، `back` (يرفض عند `depth 0` خارج النافذة)، `forward`, `current`, `destroy`.
- `handlePop`: الحالة غير التابعة للمحرك تمر إلى `onExternalPop` (اختياري)؛ والحالة ذات `epoch` مختلف **تُستبدل بالحالة الحالية** (لا تُستعاد شاشة من جلسة سابقة)؛ ونافذة منبثقة تأتي من التقدم للأمام **تُطبَّع إلى الشاشة التي تحتها**.
- يعمل في Node أيضاً (`module.exports`) لأجل الاختبارات.

### 1.2 النتائج (F-04-N)

**F-04-N1 — كل نافذة منبثقة تترك Entry مكرراً في السجل — CONFIRMED (المنطق)، الأثر INFERRED**
- `openModal` تستدعي `pushState`، لكن `dismissModal` تستدعي `replaceState` (لا `history.back()`). النتيجة: بعد فتح وإغلاق نافذة بالأوامر البرمجية يبقى في السجل Entry إضافي بالمسار نفسه. زر الرجوع التالي «لا يفعل شيئاً مرئياً» مرة لكل نافذة فُتحت. تعليق الملف يشرح أنه مقصود لتجنب `popstate` غير متزامن. المقايضة قائمة وتحتاج قراراً في الإعادة (مثلاً التمييز بين إغلاق بالرجوع وإغلاق بزر).

**F-04-N2 — العودة بعد حد المصادقة تستهلك ضغطات رجوع — CONFIRMED (المنطق)، الأثر INFERRED**
- الـEntries من `epoch` سابق تُعطَّل بـ`replaceState` عند الوصول إليها دون تغيير الشاشة، فيحتاج المستخدم ضغطات رجوع متعددة «صامتة» بعد تسجيل الدخول/الخروج حتى يخرج من التطبيق. سلوك مقصود (منع استعادة شاشات جلسة سابقة).

**F-04-N3 — لا ترميز للمسار في العنوان — CONFIRMED**
- `commit` يستدعي `pushState(state,'',location.href)` أي **يُبقي العنوان كما هو**. فلا روابط عميقة لشاشة أو جمعية (باستثناء `?join` و`?invite` و`?auth_action`)، والتحديث (Refresh) يعتمد على منطق الإقلاع لا على `history.state` (المرحلة 01: `start(...)` يستبدل الحالة). مصدر الحقيقة للمسار هو `history.state`، ومصدر الحقيقة لباقي الحالة (الجمعية الحالية، التبويب) في متغيرات الواجهة (`params`, `currentGroupId`...) المنسوخة في اللقطة. تضارب محتمل عند الاستعادة (لقطة قديمة تشير إلى جمعية حُذفت أو لم تعد مرئية) — NOT VERIFIED.

**F-04-N4 — `onExternalPop` غير موصول — INFERRED**
- المرحلة 01 (HTML، `SahmNavigation.create({window,onChange})`) لا تمرّر `onExternalPop`، فأي `popstate` بحالة غريبة يُهمل بصمت.

## 2. `sw.js` (Service Worker)

### 2.1 ما يفعله (CONFIRMED)
- `BUILD_ID` ثابت نصي يحدّثه سير العمل؛ `CACHE_NAME = sahm-pwa-<BUILD_ID>`؛ `APP_SHELL` = 13 مورداً (الجذر، الصفحة الرئيسية، `terms.html`، ملفات JS الستة، `sahm-managed-group.js` و`.css`، `manifest`, `icons/sahm.svg`).
- **التثبيت:** `fetch(url,{cache:'reload'})` لكل مورد ثم `cache.put` إذا كانت الاستجابة سليمة. العامل الجديد **ينتظر** (لا `skipWaiting` تلقائي) حتى رسالة `SKIP_WAITING` من الصفحة.
- **التفعيل:** يحذف أي كاش يبدأ بـ`sahm-pwa-` ويخالف الحالي، ثم `clients.claim()`.
- **الجلب:** `GET` للأصل نفسه فقط. التنقل (`navigate`) و`.js/.html/.css/.webmanifest`: **الشبكة أولاً** (`cache:'no-store'`) مع الرجوع للكاش (`ignoreSearch:true`) ثم `/Sahm_Preview_ROLE_SEPARATION.html` ثم `/`. باقي الموارد (الأيقونات): الكاش أولاً.
- الأصول عبر الأصل (Supabase API وjsDelivr وGoogle Fonts) **لا يعترضها** العامل.

### 2.2 النتائج (F-04-S)

**F-04-S1 — كل Commit على الفرع يغيّر إصدار العامل وإن لم يتغير التطبيق — CONFIRMED**
- مرتبط بالقسم 0. `BUILD_ID` = أول 12 حرفاً من SHA الـCommit المُطلِق، بغض النظر عن نوع الملفات المتغيرة (وثائق، اختبارات، تدقيق). الأثر: إشعار تحديث وإعادة تنزيل للحزمة بلا تغيير وظيفي.

**F-04-S2 — روابط تحمل أسراراً تُخزَّن في Cache Storage — CONFIRMED (الآلية)، الأثر INFERRED**
- `networkFirst` تُنفذ `cache.put(request, fresh.clone())` لكل طلب تنقل ولكل ملف كود، **بمفتاح يتضمن سلسلة الاستعلام**. صفحة تُفتح بـ`?join=<token>` أو `?invite=<token>` أو `?code=<auth code>` أو `?auth_action=reset-password` تُخزَّن بذلك العنوان كاملاً في الكاش على الجهاز (حتى حذف الكاش بتغير `BUILD_ID`). وتتراكم مدخلات متعددة للصفحة نفسها بتعدد قيم الاستعلام. الأسرار هنا رموز دعوة/رابط عام/كود PKCE (قصيرة العمر غالباً؛ مدتها على الخادم NOT VERIFIED).

**F-04-S3 — العمل دون اتصال محدود فعلياً — CONFIRMED (الكود)، الأثر INFERRED**
- مكتبة `supabase-js` تُحمَّل من jsDelivr (المرحلة 01) ولا يعترضها العامل ولا يُخزَّنها. دون اتصال تُحمَّل الصفحة من الكاش لكن `getClient()` يرمي «تعذر تحميل مكتبة الاتصال الآمن». كذلك الخطوط (Google Fonts) غير مخزنة. فـ«PWA» هنا لا يعمل دون اتصال إلا شكلياً (وهو يحتاج الخادم أصلاً).

**F-04-S4 — فشل تنزيل مورد غير سليم يمر بصمت — CONFIRMED**
- في `install`: `if (res && res.ok) return cache.put(...)`، فمورد يعيد 404/500 يُتجاوز دون خطأ، ويُفعَّل عامل بكاش ناقص (فقط رفض الشبكة يُفشل التثبيت عبر `Promise.all`).

**F-04-S5 — افتراض نشر على جذر النطاق — CONFIRMED**
- كل المسارات مطلقة (`'/'`, `'/sahm-core.js'`...) و`scope:'/'`. النشر على مسار فرعي (مثل GitHub Pages لمستودع) يكسر الكاش والتسجيل. على Render كخدمة ساكنة على الجذر يعمل (README يقول إن الخدمة على Render، **غير متحقق منه**).

**F-04-S6 — إصدار الكاش يُحسب من SHA الـCommit المُطلِق لا من رأس الفرع — CONFIRMED (الكود)، الأثر INFERRED**
- الخطوة `Stamp worker` تستعمل `github.sha` (الـCommit المُطلِق) بينما `checkout` لـ`ref: SAHM-SUPABASE` (رأس الفرع وقت التنفيذ). عند دفعتين متقاربتين يشير `BUILD_ID` إلى Commit أقدم من الرأس. وخطوة `git push origin HEAD:SAHM-SUPABASE` بلا `pull --rebase` ولا إعادة محاولة، فتفشل إن تقدم الفرع بين الـcheckout والـpush (ويُفقد الختم). سجلات التشغيل غير متاحة لي (**NOT VERIFIED** هل حدث ذلك).

## 3. `index.html` وملفات PWA

**F-04-P1 — إعادة التوجيه تُسقط الاستعلام والهاش — CONFIRMED**
- `index.html` يحوي `<meta http-equiv="refresh" content="0;url=/Sahm_Preview_ROLE_SEPARATION.html">` و`location.replace('/Sahm_Preview_ROLE_SEPARATION.html')` **دون إلحاق `location.search` ولا `location.hash`**. أي رابط إلى `/` يحمل `?join=` أو `?invite=` أو `?code=` أو `?auth_action=` يفقد معاملاته.
- الروابط التي ينشئها التطبيق نفسه تُبنى من `location.pathname` للصفحة الرئيسية (`...ROLE_SEPARATION.html?join=...`) فلا تمر بهذا الملف. **لكن** إن كان إعداد Supabase Auth (Site URL أو قائمة السماح بإعادة التوجيه) يشير إلى جذر النطاق، فرسائل التأكيد والاستعادة قد تصل إلى `/` فتضيع `code`. إعداد Auth غير مرئي لي (**BLOCKED**).
- اسم الصفحة «سهم | المعاينة» ونص «فتح معاينة سهم» يكرران تسمية Preview (المرحلة 01 البند 8).

**F-04-P2 — `manifest.webmanifest` — CONFIRMED (المحتوى)**
- `id` و`start_url` يشيران إلى `/Sahm_Preview_ROLE_SEPARATION.html` (الأخير بـ`?v=4` ثابتاً)، `scope:'/'`, `display:standalone`, `orientation:portrait`. أيقونة واحدة SVG بـ`sizes:'any'` و`purpose:'any maskable'`. غياب أيقونات PNG: المرحلة 01 تذكر `apple-touch-icon` يشير إلى SVG، وiOS لا يدعم SVG لهذا الغرض (INFERRED من سلوك المنصة، غير مختبر).

**F-04-P3 — `terms.html` — CONFIRMED**
- نص الإصدار `2026-11-14` مكتوب في الصفحة وفي `TERMS_VERSION` داخل `sahm-supabase.js` (موضعان يلزم تحديثهما معاً).
- **نص قديم:** البند 3 «تُستخدم بيانات الأقساط **والحضور** والقرعة...» والحضور ألغي من المنتج (F-02-09).
- الوثيقة تنص بنفسها على أنها «أولية» و«ينبغي مراجعتها واعتمادها قانونياً قبل الإطلاق التجاري». **MISSING:** مراجعة قانونية، وسياسة خصوصية مستقلة (البند 5 فقرة قصيرة فقط).
- الصفحة تحمّل الخطوط من Google Fonts (طلب طرف ثالث).

**F-04-P4 — `icons/sahm.svg` — CONFIRMED**
- أيقونة SVG ثابتة (512×512)، مستطيلان بحواف مستديرة مدمجة. مع `purpose:'maskable'` قد تُقتطع الحواف (قيمة تجميلية).

## 4. سير العمل (CI) و`README.md`

**CONFIRMED:** ثلاثة workflows فقط.

| الملف | المحفّز | ما يفعل |
|---|---|---|
| `node-tests.yml` | push إلى `main` و`SAHM-SUPABASE` و`SAHM-LAB-*`، وPR، ويدوي | Node 22، `node --test tests/*.test.js`. لا بناء ولا lint. صلاحية قراءة فقط |
| `supabase-local-sql-tests.yml` | push إلى `SAHM-SUPABASE` عند تغيير `supabase/migrations/**` أو `SAHM_DATABASE_BASELINE.sql` أو `supabase/tests/**` أو الملف نفسه، ويدوي | يشغّل مجموعة Supabase **محلية مؤقتة** (CLI مثبّت 3.1.0)، يستعيد `SAHM_DATABASE_BASELINE.sql`، يطبّق الـmigrations الأحدث من `BASELINE_VERSION=20261113195525`، ثم يشغّل `supabase/tests/*.sql`. **لا يلمس قاعدة الإنتاج** (الاتصال `127.0.0.1:54322`) |
| `refresh-sahm-pwa-worker.yml` | push إلى `SAHM-SUPABASE` عدا `sw.js`، ويدوي | يختم `sw.js` ويدفع Commit (انظر القسم 0) |

**F-04-C1 — لا سير عمل للنشر داخل المستودع — CONFIRMED (الغياب)، النشر الفعلي NOT VERIFIED**
- لا workflow ينشر. النشر إذن عبر تكامل Render مع GitHub (إن وُجد) وهو غير مرئي لي (BLOCKED). README يقول فقط: «انشر فقط بعد نجاح الاختبارات والتحقق من Commit المنشور» (إجراء يدوي، ولا يوجد ما يفرضه آلياً).

**F-04-C2 — لا فحص لتطابق القاعدة الحية مع المستودع — MISSING**
- اختبارات SQL تُشغَّل على بيئة محلية من الـbaseline والـmigrations، ولا شيء يقارنها بمخطط قاعدة الإنتاج. جدول الـmigrations في الإنتاج (المرحلة 06) هو الفيصل في وجود انحراف (drift). كما أن `BASELINE_VERSION` ثابت داخل الـworkflow ويفترض أن الـbaseline يتضمن كل ما قبله (NOT VERIFIED).

**F-04-C3 — الاختبارات لا تغطي مسار البناء/النشر — CONFIRMED**
- لا يوجد بناء (البيئة ملفات ساكنة)، ولا اختبار لـ`sw.js` ولا لـ`index.html`/`manifest` في الـworkflows. أسماء ملفات الاختبار (المرحلة 0) لا تتضمن اختباراً للـSW. المحتوى يُفحص في المرحلة 10.

**F-04-C4 — لا سياسة CSP ولا SRI ضمن ملفات الصفحة — CONFIRMED لـ`index.html` و`terms.html`، والصفحة الرئيسية حسب المرحلة 01 (قائمة `<meta>` بلا CSP)**
- رؤوس HTTP على Render غير مرئية (**BLOCKED**). مع F-03-S1 (جلسات في localStorage) وتحميل سكربت من CDN دون SRI (المرحلة 01)، غياب CSP يرفع أثر أي XSS أو اختراق CDN.

**`README.md` — CONFIRMED (المحتوى):** يصف مسار النشر (الفرع، نقطة الدخول، اسم خدمة Render `sahm-supabase-preview-fixed`، مشروع Supabase)، وملفات التشغيل، وأن `supabase/` مرجع لا يُشغَّل على الإنتاج عشوائياً، وقواعد العمل (لا نسخ واجهات بديلة، لا `service_role`، نشر بعد نجاح الاختبارات). **هذه ادعاءات توثيقية** (إعدادات Render NOT VERIFIED). يذكر الأمر `node --test tests/*.test.js` وهو مطابق للـworkflow (`helpers.js` ليس `*.test.js` فلا يُشغَّل).

## 5. ما تبقى من هذه المرحلة

1. اختبارات `navigation` و`css-dedup` و`ui-contract`: المحتوى في المرحلة 10.
2. إعدادات Render وSupabase Auth (Site URL وقائمة إعادة التوجيه): **BLOCKED**، مطلوب لقطات منك.

## 6. نقطة الاستئناف

المرحلة التالية: **05** — `sahm-managed-group.js` و`sahm-managed-group.css`، مع إغلاق ثغرات المرحلة 01 والأسئلة المفتوحة من 02 و03 (من يستدعي `tick` و`addMember` و`joinByCode` و`createInvite` و`setAttendance`، وأقسام المدير الخمسة، وواجهة العضو، والرابط العام، وبقية الدوال غير المعرّفة).
