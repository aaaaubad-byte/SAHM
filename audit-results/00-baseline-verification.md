# المرحلة 0 — التحقق من خط الأساس (قراءة فقط)

- تاريخ التنفيذ: 2026-11-20
- الحالة: **مكتملة**
- طبيعة العمل: قراءة فقط. لم يُعدَّل أي ملف تطبيق، ولا قاعدة Supabase، ولا Render. الإضافة الوحيدة هي ملفات `audit-results/`.
- تصحيح: النسخة الأولى من هذا الملف ذكرت 42 ملف migration، والصحيح **36** (عُدّت من الشجرة).

## 1. قيود التنفيذ المطبقة

- كل استعلامات SQL نُفذت بـ `read_only: true`.
- لم تُستخدم أدوات `supabase_apply_migration` أو `delete_file` أو `create_branch`.
- `write_file` استُخدمت فقط لكتابة ملفات داخل `audit-results/` على الفرع `SAHM-SUPABASE`.
- لا مفاتيح ولا أسرار ولا رموز وصول في هذا الملف.

## 2. المستودع — CONFIRMED

| العنصر | القيمة المتحقق منها |
|---|---|
| المستودع | `aaaaubad-byte/SAHM`، عام، الفرع الافتراضي `main` |
| الصلاحيات على المستودع | admin, maintain, push, triage, pull |
| الفرع المرجعي | `SAHM-SUPABASE` |
| رأس الفرع وقت الفحص | `69259582c5c7c4660fed3ab53f92e3ee8e755117` (مطابق للمعروف سابقاً) |
| وصف الـ Commit | `chore(pwa): stamp worker for 7e33e157f63f`، بوت github-actions، 2026-11-19T00:31:42Z |
| آخر Commit بشري | `7e33e157f63f64384a1c9430c70cf48d7746339b` «Rebuild ten final association manager sections»، 2026-11-19T00:31:34Z |
| المجلد `audit-results/` قبل أول Commit تدقيق | غير موجود (HTTP 404) |

### الفروع الموجودة (10)

| الفرع | رأس الفرع |
|---|---|
| `SAHM-SUPABASE` | `69259582c5c7c4660fed3ab53f92e3ee8e755117` |
| `main` | `6e7a26bb4cb7d75fabe1a4ecd14ade21a4e46128` |
| `SAHM-FINAL` | `2965cb78b4d59e08e9391fa83ff7b14bbe319dd7` |
| `SAHM-LAB` | `2b1f6194488b1cfb9cc5305b51aefc084b65e2ac` |
| `SAHM-LAB-MANAGED-SCREENS-20261119` | `032969772ba2ec0cedc822d498e9c28543e8ff70` |
| `feat/complete-association-workspace` | `40d649bb2dfdcb75a74004f714a2040cb6302e70` |
| `fix/workspace-tabs-visual-audit-20261118` | `d4347b3b07063fd77577b49ec887582b90a20abf` |
| `fix/workspace-visual-cleanup-20261118` | `dc2748c09b8d000a2c16dbde72e4734f4f369a84` |
| `sahm-audit-and-fix` | `230386ca03352c17923f3c6d6cfe61b259f45360` |
| `work/ui-remove-quorum-and-role-room` | `65f07f611c1c704a7563658cf0a6ff897593b98f` |

ملاحظة: `main` يشير إلى Commit مختلف عن `SAHM-SUPABASE`. لم أقارن بينهما بعد (**NOT VERIFIED** إلى أن تُنفَّذ المقارنة).

## 3. شجرة الملفات على `SAHM-SUPABASE` — CONFIRMED

الشجرة كاملة وغير مقتطعة (`truncated: false`).

### ملفات التطبيق (الجذر)

| الملف | الحجم (بايت) |
|---|---|
| `Sahm_Preview_ROLE_SEPARATION.html` | 217230 |
| `sahm-data.js` | 100678 |
| `sahm-managed-group.js` | 91749 |
| `sahm-managed-group.css` | 48135 |
| `sahm-supabase-data.js` | 45956 |
| `sahm-core.js` | 41882 |
| `sahm-supabase.js` | 12050 |
| `sahm-navigation.js` | 6438 |
| `terms.html` | 5303 |
| `sahm-app.js` | 4870 |
| `sw.js` | 2730 |
| `README.md` | 2505 |
| `manifest.webmanifest` | 552 |
| `index.html` | 459 |
| `icons/sahm.svg` | 686 |

لا توجد ملفات CSS أو JS أو HTML أخرى في الجذر غير المذكورة أعلاه. الملفات المطلوب قراءتها كاملة في التوجيه موجودة كلها، ويضاف إليها `terms.html` و`manifest.webmanifest` و`icons/sahm.svg`.

### الوثائق (`docs/`)

| الملف | الحجم |
|---|---|
| `SAHM_PROGRESS_LOG.md` | 63899 |
| `SAHM_FULL_PROJECT_CLEANUP_AUDIT.md` | 50994 |
| `SAHM_APPLICATION_STRUCTURE.md` | 48563 |
| `SAHM_DEVELOPMENT_GAP_PLAN.md` | 48271 |
| `SAHM_RESUME_DIRECTIVE.md` | 14840 |
| `SAHM_CODE_CLEANUP_AUDIT.md` | 9347 |

### الاختبارات

- **JavaScript (`tests/`, 10 ملفات):** `auth-flow`, `core`, `css-dedup`, `data`, `helpers` (مساعد لا اختبار)، `join-flow`, `navigation`, `supabase-auth`, `supabase-data`, `ui-contract` (46928 بايت).
- **SQL (`supabase/tests/`, 9 ملفات):** `association_join_request_smoke`, `association_operations_smoke`, `association_rpc_invariants`, `association_share_register`, `association_workflow_smoke`, `draw_last_day_schedule`, `email_auth_profile_invariants`, `email_signup_profile_completion_smoke`, `schema_invariants`.
- **Workflows (3):** `node-tests.yml`, `refresh-sahm-pwa-worker.yml`, `supabase-local-sql-tests.yml`.

### Supabase في المستودع

- `supabase/SAHM_DATABASE_BASELINE.sql` (88111 بايت).
- `supabase/migrations/`: **36** ملف migration، من `20261113195243` إلى `20261118202251`.

## 4. Supabase — CONFIRMED (استعلام قراءة فقط)

| العنصر | القيمة |
|---|---|
| المشروع | `SAHM` (`nusjnnrtpxbpphphmdsc`) |
| الحالة | ACTIVE_HEALTHY |
| Postgres | 17.11.0.019 (القناة ga) |
| المنطقة | ap-northeast-1 |
| تاريخ إنشاء المشروع | 2026-11-13T17:37:12Z |
| جداول أساسية في `public` | 24 |
| Views في `public` | 1 |
| دوال في `public` (prokind = f) | 49 |
| سياسات RLS في `public` | 32 |
| جداول مفعّل عليها RLS | 24 من 24 |
| Triggers (غير داخلية، في `public` و`private` و`auth`) | 12 |
| مهام cron | 1 |
| جداول Realtime | `chat_messages`, `invitations`, `join_requests`, `notifications` |

التطابق مع التقرير الأولي: الأعداد (24 / 1 / 49 / 32 / RLS / 1 cron / 4 Realtime) **تطابقت كلها**. الرقم الجديد هنا هو عدد الـ Triggers (12)، ولم يكن موثقاً في التقرير الأولي. تفاصيل كل Trigger في مرحلة تدقيق قاعدة البيانات.

التوكن المتاح يرى مشروع SAHM فقط (من التقرير الأولي، ولم يُعد فحصه في هذه المرحلة).

## 5. Render — BLOCKED

- لا أملك أداة للوصول إلى Render في هذه الجلسة: لا قراءة لنوع الخدمة، ولا Build Command، ولا Publish Directory، ولا أسماء المتغيرات، ولا النشر التلقائي، ولا النطاقات، ولا Health Checks.
- المصدر الوحيد المتاح هو `README.md` ويقول: الفرع `SAHM-SUPABASE`، نقطة الدخول `index.html`، اسم الخدمة `sahm-supabase-preview-fixed`. هذا **ادعاء توثيقي (NOT VERIFIED)** ولا يثبت الإعدادات الفعلية.
- لا يوجد ملف `render.yaml` في الشجرة، فلا مصدر آخر للإعدادات داخل المستودع.
- **المطلوب من المستخدم لإغلاق هذا البند:** لقطات شاشة أو تصدير لإعدادات الخدمة (النوع، المستودع والفرع، Build، Publish، أسماء المتغيرات فقط، Auto-Deploy، النطاق).

## 6. ما تبقى

- المرحلة 1 فصاعداً: قراءة الملفات الأحد عشر كاملة، ثم باقي الملفات، وتوثيق الشاشات والوظائف.
- تدقيق Supabase التفصيلي (الأعمدة والقيود والفهارس، تعريفات الـ View، توقيعات الدوال، Triggers، Cron).
- الأمان، التكرار، الاختبارات، التقييم المعماري، والتقرير النهائي.
- مقارنة `main` مع `SAHM-SUPABASE`.

## 7. نقطة الاستئناف

آخر Commit تطبيقي معتمد كمرجع: `69259582c5c7c4660fed3ab53f92e3ee8e755117`. عند الاستئناف: أعد التحقق من أن رأس الفرع لم يتغير (باستثناء Commits مجلد `audit-results/`)، ثم تابع من المرحلة 1.
