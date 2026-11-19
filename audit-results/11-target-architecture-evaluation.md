# 11 — تقييم المعمارية المستهدفة لإعادة تأسيس SAHM

## 1. التوصية الأولية

React + TypeScript + Vite، مع Supabase كخلفية، وطبقة Domain/Use Cases مستقلة عن React، وTanStack Query لحالة الخادم، وReact Router للتنقل، وZod للتحقق من العقود، وVitest + Testing Library + Playwright للاختبارات.

هذا اقتراح معماري وليس قراراً معتمداً أو تنفيذاً.

## 2. لماذا لا نعيد كتابة Vanilla JS كما هو؟

- HTML كبير يجمع سجل الشاشات ومعالجات الإجراءات وتوليد الواجهات.
- sahm-managed-group.js يعتمد على حالة عامة وSahmApp، ما يخلق اقتراناً ضمنياً.
- طبقة Supabase تقرأ snapshot واسعاً من جداول متعددة ثم تعيد بناء الحالة في العميل.
- CSS المدير مبني من طبقات متعاقبة، وفيه تكرار وتعريفات متضاربة وألوان حرفية وقواعد مخفية.
- تقارير 02 و03 و05 رصدت اختلافات بين المسار المحلي والبعيد، وعمليات كتابة أثناء الرسم، وذاكرة قراءة تحتاج إبطالاً أدق.

المشكلة ليست JavaScript بذاتها، بل حدود المسؤوليات والاعتمادات وضعف التحقق الساكن.

## 3. مقارنة الخيارات

| المعيار | React + TS | Vue + TS | Svelte + TS | Preact + TS |
|---|---|---|---|---|
| نضج النظام البيئي | مرتفع جداً | مرتفع | متوسط/متزايد | متوسط |
| مكونات وجداول ونماذج معقدة | خيارات واسعة | خيارات جيدة | خيارات أقل نسبياً | خيارات أقل |
| توفر المطورين | الأعلى غالباً | جيد | أقل نسبياً | أقل |
| حجم runtime | متوسط | متوسط | صغير | صغير جداً |
| ملاءمة PWA | ممتاز | ممتاز | ممتاز | جيد |
| قابلية التوسع بفريق | ممتازة | جيدة جداً | جيدة | جيدة |

**لماذا React؟** لتقليل مخاطر المكتبات، وتوفر مكونات الوصولية والجداول والنماذج والاختبار، وسهولة توسيع الفريق. ليس لأنه الأسرع أو الأصغر.

**لماذا ليس Next.js؟** لا يوجد مطلب مثبت لـSSR أو SEO أو Server Components. تطبيق PWA خاص وتفاعلي؛ Vite أبسط تشغيلياً. يعاد النظر في SSR إذا ظهر مطلب منتج.

**لماذا ليس Preact؟** خفة runtime ليست العامل الحاسم في منتج به معاملات مالية وعضوية وقرعة وتدقيق. خيارات المكتبات الأوسع أهم.

## 4. البنية المنطقية المقترحة

src/
  app/ (bootstrap, router, providers, layouts, guards)
  domains/
    identity/
    associations/
    memberships/
    invitations/
    shares/
    installments/
    receipts/
    draws/
    communications/
    notifications/
    audit/
  shared/ (ui, design-tokens, forms, validation, date-time, money, errors, permissions)
  infrastructure/supabase/ (client, auth, repositories, rpc, realtime)
  tests/ (fixtures, factories, contracts, e2e)

### الحدود

- UI: عرض الحالة ومدخلات المستخدم، لا قواعد مالية ولا صلاحيات.
- Application: تنسيق الأوامر والاستعلامات ومعالجة حالات النجاح والفشل.
- Domain: قواعد العمل والحسابات والتحقق المحلي.
- Infrastructure: Supabase client وrepositories وRPC وAuth وRealtime.
- Database: مصدر الحقيقة للعضوية والأسهم والالتزامات والتحصيل والقرعة والقيود والصلاحيات.

لا تنقل قواعد العمل إلى React hooks، ولا تضع استعلامات Supabase داخل المكونات.

## 5. تدفق البيانات

- Query: Screen → Use Case → Repository → Supabase → DTO validation → View Model → UI.
- Command: UI → Use Case → input validation → RPC ذرية → invalidate/refetch → UI.
- Realtime: الحدث يبطل query key مناسباً ثم يعاد جلب مصدر الحقيقة.
- لا تستخدم optimistic updates للمال أو العضوية أو القرعة دون تعويض/rollback واختبارات.

## 6. الحالة والبيانات

- TanStack Query لحالة الخادم والتخزين المؤقت والإبطال.
- Context للجلسة والمستخدم والجمعية النشطة وإعدادات العرض الصغيرة.
- لا تضف Zustand إلا عند ظهور حالة عميل معقدة لا تناسب Query أو component state.
- لا تحفظ بيانات الجمعية والأقساط والإيصالات كمصدر حقيقة في localStorage.
- localStorage للتفضيلات غير الحساسة فقط؛ جلسات Supabase تدار عبر Auth storage.

## 7. التصميم والتجاوب

- Design tokens موحدة للألوان semantic والخطوط والمسافات والاستدارة والظلال والحدود.
- مكونات عامة: Button, IconButton, Field, Select, SearchBar, FilterBar, Card, StatusBadge, EmptyState, Skeleton, Dialog, Sheet, Tabs, Toast.
- RTL بالخصائص المنطقية CSS، مع عزل الحالات LTR.
- Mobile-first واختبار 320/360/390/430px ثم tablet/desktop.
- وصولية: target 44px، focus، keyboard navigation، reduced motion، contrast.

## 8. استراتيجية الاختبارات

- Unit: حساب الأقساط والتواريخ والمبالغ.
- Domain: دورة حياة الجمعية والعضوية والقرعة.
- Component: loading/empty/error/disabled.
- Integration: repositories وRPC في Supabase محلي/بيئة اختبار.
- SQL: invariants وRLS وrace conditions في Supabase local فقط.
- E2E: تسجيل، إنشاء، دعوة، طلب انضمام، اعتماد، تحصيل، تصحيح، قرعة.
- Security: صلاحيات cross-association، escalation، token expiry، replay، IDOR.
- Visual regression: مكونات رئيسية على mobile/desktop.

لا تستخدم الإنتاج أو بياناته في اختبارات الكتابة.

## 9. المخاطر قبل التنفيذ

1. لا تبدأ قبل إغلاق قواعد العمل وتواقيع RPC والمنح.
2. يجب تفسير migration drift قبل اعتماد schema baseline.
3. يجب اعتماد سياسة البيانات التاريخية والتصحيح المالي.
4. يجب تحديد خدمة المعاينة المرجعية وسياسة النشر.
5. القرعة والتحصيل والعضوية تبقى ذرية في DB.
6. كل صلاحية تفرض في DB/RPC حتى لو أخفتها الواجهة.
7. يجب تحديد سياسة Auth/redirect/session قبل نقل التسجيل.

## 10. قرار لاحق

عند إغلاق التدقيق، يعرض قرار اعتماد React + TypeScript + Vite كواجهة جديدة مع Supabase بعد تسوية schema/migrations/security، أو اختيار بديل مدعوم. لا يُنشأ فرع جديد أو مشروع تنفيذ قبل القرار.
