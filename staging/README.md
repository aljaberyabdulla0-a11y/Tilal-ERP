# بيئة الاختبار `tilal-erp-staging`

> الغرض: اختبار الهجرات 227 فصاعداً (والانحدار كاملاً) على قاعدة **مطابقة لبنية الإنتاج** و**بيانات اصطناعية فقط**، قبل أي لمس للإنتاج.
> مرجع التصميم: [docs/MULTI_ROLE_OPERATIONS_DESIGN.md](../docs/MULTI_ROLE_OPERATIONS_DESIGN.md) §١٥. سجلّ الهجرات: [docs/MIGRATION_HISTORY_REPAIR.md](../docs/MIGRATION_HISTORY_REPAIR.md).

---

## ١) الضمانات

| الخطر | الحماية |
|---|---|
| سكربت يكتب في الإنتاج | كل سكربت كتابة يرفض أي ref/host/user يحوي `edgblrqkushnznhmuxln` (`guard.ps1`) **و**يتحقق داخل القاعدة من علامة `staging_meta.environment = 'staging'` قبل كل خطوة — والإنتاج لا يملكها |
| ملف SQL يُلصق خطأً في محرّر الإنتاج | كل ملف staging (الإعداد، البيانات المرجعية، البيانات الاصطناعية) يبدأ بحارس يرفع `STOP: not a staging database` |
| خروج بيانات شخصية من الإنتاج | التصدير: البنية بلا صفوف + قائمة بيضاء من 50 جدول إعداد تُحذف منها أعمدة الأشخاص والمفاتيح الخارجية للموظفين/المستخدمين قبل أن تغادر الإنتاج؛ والفاحص يرفض أي هاتف أو بريد أو سرّ |
| أسرار الإنتاج | لا تُنسخ: Vault، `mkt_integration_secrets`، مفاتيح Meta، مفاتيح API، Edge Functions، متغيّرات Vercel. كلمات المرور والمفاتيح تُطلب عند التشغيل بحقل مخفي ولا تُكتب في أي ملف |
| مهام مجدولة تتصل بالخارج | لا تُنسخ مهام cron (23 في الإنتاج) — staging بلا cron |
| بريد يصل لأشخاص حقيقيين | المستخدمون بنطاق `.invalid` (لا يُرسل إليه بريد)، والتسجيل الذاتي معطّل |
| التطبيق يتصل بالإنتاج | `run-app.ps1` يضع عناوين staging في بيئة العملية (تتقدّم على `.env.local`) ويرفض ref الإنتاج |
| تسرّب المخرجات إلى git | `staging/.gitignore` يستبعد `output/` وكل `.env*` و`*.local` |

**الوصول للإنتاج في هذه العملية كلها قراءة فقط:** الخطوة 1 وحدها تتصل بالإنتاج، باتصال مفروض `default_transaction_read_only=on`.

---

## ٢) المتطلبات على جهاز المالك

1. **أدوات PostgreSQL 17 (العميل فقط):** ملف ZIP للأدوات من صفحة PostgreSQL الرسمية لويندوز، ثم إضافة مجلد `bin` إلى `PATH`. يجب أن يُظهر `pg_dump --version` و`psql --version` الرقم 17. لا حاجة لتشغيل خادم.
2. **Node.js 20+** (موجود لتشغيل الواجهة).
3. **مدير كلمات مرور** لحفظ: كلمة مرور قاعدة staging، مفتاح `service_role` لـ staging، مفتاح `anon` لـ staging. **لا تُرسل في المحادثة ولا تُكتب في ملفات المشروع.**

---

## ٣) إنشاء المشروع (المالك، من لوحة Supabase)

| الإعداد | القيمة | السبب |
|---|---|---|
| الاسم | `tilal-erp-staging` | |
| المنطقة | `ap-south-1` (Mumbai) | مثل الإنتاج — نفس زمن الاستجابة وسلوك المنطقة الزمنية |
| Postgres | 17 | مثل الإنتاج |
| الخطة | Micro (مدفوعة) أو Free إن توفّرت خانة | Free يتوقف بعد أسبوع خمول ويُستعاد يدوياً — مقبول للاختبار |
| كلمة مرور القاعدة | تُولَّد في اللوحة وتُحفظ في مدير كلمات المرور فقط | |
| **Authentication → Sign In / Providers** | إيقاف `Allow new users to sign up` | المستخدمون يُنشؤون بسكربت فقط |
| **Authentication → URL Configuration** | Site URL = `http://localhost:3100` | لا روابط إلى نطاق الإنتاج |
| **Authentication → SMTP** | لا يُضبط | لا بريد يخرج |
| GitHub / Branching / Vercel Integration | **لا تُفعَّل** | لا ربط بالمستودع أو بالنشر |
| Edge Functions / Secrets | **لا شيء** | الوظائف الثلاث (`broker-accounts`, `marketing-sync`, `meta-leads`) خارج نطاق الاختبار |

بعد الإنشاء احفظ في مدير كلمات المرور: **ref المشروع** (20 حرفاً)، **Session pooler host** (من Connect)، كلمة مرور القاعدة، مفتاح `anon`، مفتاح `service_role`.

---

## ٤) الخطوات

| # | الأمر (من مجلد المشروع) | يتصل بـ | الناتج |
|---|---|---|---|
| 1 | `powershell -ExecutionPolicy Bypass -File staging\1-export-from-production.ps1` | **الإنتاج، قراءة فقط** | `staging/output/`: البنية، تخصيصات الجداول المُدارة، بيانات الإعداد المنقّاة، الجرد |
| 2 | `node staging\2-verify-export.mjs` | لا شيء | `PASS` أو `PASS WITH REVIEW` (راجع كل تنبيه) أو `NOT READY` (توقّف) |
| 3 | `powershell -ExecutionPolicy Bypass -File staging\3-restore-to-staging.ps1` | staging | الخطوة 0 (العلامة، **مرة واحدة على مشروع فارغ**) ثم البنية ← المُدارة ← الإعداد ← إعدادات staging؛ كل خطوة معاملة واحدة |
| 4 | `powershell -ExecutionPolicy Bypass -File staging\4-create-test-users.ps1` | staging Auth | 16 مستخدماً `<key>@staging.tilal.invalid`؛ كلمات المرور في `staging/output/test-users.json` فقط |
| 5 | `powershell -ExecutionPolicy Bypass -File staging\run-sql.ps1 -File staging\fixtures\10_synthetic_seed.sql` | staging | البيانات الاصطناعية + ملخّص بالأعداد |
| 6 | خط الأساس (§٧) عبر `run-sql.ps1` أو SQL Editor لمشروع staging | staging | نتائج الاختبارات **قبل** 227 — مرجع المقارنة |
| 6b | `powershell -ExecutionPolicy Bypass -File staging\tests\test-registration.ps1` | staging | اختبار آلية تسجيل الهجرات (Q14) R1–R5 — **يجب أن تنجح كلها قبل كتابة 227** |
| 7 | (اختياري) `powershell -ExecutionPolicy Bypass -File staging\run-app.ps1` | staging | الواجهة على `http://localhost:3100` |

**عند فشل خطوة:** الخطوة معاملة واحدة فلا يبقى منها شيء. أرسل رسالة الخطأ (بلا كلمات مرور) لأصلح الملف. لإعادة البناء من الصفر: احذف مشروع staging وأنشئه من جديد — أسرع وأنظف من التنظيف اليدوي.

**ملاحظات تقنية متوقعة في أول تشغيل:**
- بيانات الإعداد تُدرج بـ `session_replication_role = replica` (تعطيل المحفّزات والمفاتيح أثناء الإدراج). إن رفضه Supabase يُحذف السطر من رأس `reference_data.sql` والترتيب في التصدير يحترم المفاتيح.
- البيانات الاصطناعية تمرّ عبر دوال النظام الحقيقية؛ إن رفضت دالةٌ شيئاً فهذا اكتشاف مفيد يُصحَّح في الملف.

---

## ٥) المستخدمون الاصطناعيون

| key | الدور | القسم | المشروع | دوره في الاختبار |
|---|---|---|---|---|
| `gm` | general_manager | EXEC | — | المدير العام: إدارة الفريق، تصعيد Q8 |
| `hr_mgr` | hr_manager | HR | — | المستوى الأول لاعتماد البدلات |
| `hr_off` | hr_officer | HR | — | عضو جودة مرشّح من HR — **لا تضارب** |
| `mkt_mgr` | marketing_manager | MKT-MGMT | — | |
| `mkt_emp` | marketing_employee | MKT-CONTENT | — | عضو جودة مرشّح من التسويق — **منشئ العميل 005** |
| `ops_mgr` | operations_manager | OPS | — | قائد فريق مرشّح — **سجّل نشاطاً على العميل 007** |
| `admin_off` | employee | ADMIN | — | عضو جودة مرشّح من الإدارة — **لا تضارب** |
| `fin_mgr` | finance_manager | FIN | — | |
| `sales_mgr` | sales_manager | SALES-MGMT | — | مدير القسم الوحيد المعيَّن (Q8) |
| `sup_a` / `sup_b` | supervisor | SALES-MGMT | أ / ب | مشرفا الفريقين |
| `sales_a1`, `sales_a2` | sales_employee | SALES-AGENTS | أ | زميلان (تضارب «الفريق») |
| `sales_b1`, `sales_b2` | sales_employee | SALES-AGENTS | ب | `sales_b2` مالك سابق للعميل 012 |
| `crm_emp` | crm_employee | CRM | — | **سجّل نشاطاً على العميل 007** |

## ٦) السيناريوهات في البيانات

| # | السيناريو | البيانات | يختبر |
|---|---|---|---|
| S1 | فريقا مبيعات | مشروعان، مشرفان، 4 بائعين، تبعية إدارية كاملة | النطاق، «الفريق» في التضارب، التصعيد |
| S2 | أعضاء من أقسام مختلفة | HR، تسويق، عمليات، إدارة | فريق متعدد الأقسام، بقاء التبعية الإدارية |
| S3 | سجلّ متابعات | 40 عميلاً، 2–4 أنشطة لكل منهم بنتائج منظّمة + ملاحظات خام فيها أسعار وخصومات وخطط دفع وعمولة | Q9: الملخص الآمن لا يحوي نصاً خاماً ولا أرقاماً مالية |
| S4 | خسائر | 12 حديثة (4 منها «لا يمكن الوصول»)، 8 تاريخية (قبل 90+ يوماً)، 1 مُعادة التنشيط | Q1 (48 ساعة)، Q11 (المسار المؤجّل)، Q7 (الدفعة: المعاينة والتكرار)، تخطّي المُعاد تنشيطه |
| S5 | تضارب المصالح | العميل 005 أنشأه `mkt_emp`؛ العميل 007 سجّل عليه `crm_emp` و`ops_mgr`؛ العميل 012 نُقل من `sales_b2` إلى `sales_a1` | كل مصادر §٥-٤: المنشئ، المشارك، المالك السابق، الزميل، المشرف |
| S6 | أقسام بلا مدير | مدير لـ SALES-MGMT فقط | Q8: السقوط إلى المدير العام، وتحديثه عند تعيين مدير |

الهواتف `07700000xxx` — نطاق اختبار يستثنيه الفاحص؛ أي رقم آخر يُعدّ حقيقياً.

## ٧) خط الأساس قبل 227

يُشغَّل على staging بعد الخطوة 5، وتُحفظ النتائج كمرجع (بعض الفشل متوقع لأن بعض المجموعات كُتبت على افتراضات بيانات الإنتاج — يُسجَّل لا يُصلح الآن):

```sql
select * from tests.run_org();
select * from tests.run_profile();
select * from tests.run_workflow();
select * from tests.run_payroll5();
select * from tests.run_performance();
select * from tests.run_integrations();
select * from tests.run_security();
select * from tests.run_tasks_v2();
select * from tests.run_lost_sales();
select * from tests.run_lost_analysis_tasks();
select * from tests.run_dashboard();
select * from tests.run_commission_receipts();
select * from tests.run_accounting();          -- منفرداً
select * from tests.run_project_accounting();  -- منفرداً
select public.crm_lost_card_drift();           -- يجب 0
select * from public.security_audit();         -- يجب 0
```
وملفات الاختبار التي تُلغي نفسها: `sql/216b … 225b` (كلٌّ يرفع `ROLLBACK_OK`).

---

## ٨) التحقق من الاستقلال (قبل اعتماد البيئة)

| # | الفحص | أين | المتوقع |
|---|---|---|---|
| I1 | `select name from staging_meta.environment;` | staging | `staging` |
| I2 | `select to_regclass('staging_meta.environment');` | **الإنتاج** (قراءة) | `null` |
| I3 | `select count(*) from auth.users where email not like '%@staging.tilal.invalid';` | staging | 0 |
| I4 | `select count(*) from cron.job;` | staging | 0 |
| I5 | `select count(*) from vault.secrets;` | staging | 0 |
| I6 | `select count(*) from public.clients where phone not like '07700000%';` | staging | 0 |
| I7 | تشغيل `run-sql.ps1` وإدخال ref الإنتاج عمداً | جهاز المالك | `STOP: ... points to PRODUCTION` |
| I8 | لصق `staging/sql/20_staging_settings.sql` في محرّر **الإنتاج** عمداً | الإنتاج | `STOP: not a staging database` ولا شيء يتغيّر |
| I9 | لوحة staging: Edge Functions = 0، Integrations = لا شيء، Auth signups = معطّل | staging | كما هو |
| I10 | `run-app.ps1` ← فتح أي صفحة ← DevTools/Network | المتصفح | كل الطلبات إلى `<staging-ref>.supabase.co` |

---

## ٩) تطبيق هجرة قيد الاختبار

الهجرات من 227 تُبنى بالإطار (`node staging\tools\new-migration.mjs <name> "<title>" <body.sql>`) وتملك معاملتها؛ `run-sql.ps1` يكتشف ذلك فلا يغلّفها بـ`-1`. تشغيلها مرتين يُرفض بـ`MIGRATION_ALREADY_APPLIED`.

```powershell
powershell -ExecutionPolicy Bypass -File staging\run-sql.ps1 -File sql\227_ops_foundation.sql
powershell -ExecutionPolicy Bypass -File staging\run-sql.ps1 -File sql\227b_ops_foundation_tests.sql
```
ثم مجموعات §٧ كاملة ومقارنتها بخط الأساس. لا يُنقل شيء إلى الإنتاج قبل: اختبارات الهجرة خضراء + لا تراجع عن خط الأساس + موافقة المالك.

## ١٠) الملفات

| الملف | الدور |
|---|---|
| `guard.ps1` | الحراسة المشتركة (ref الإنتاج، العلامة، كلمة المرور في الذاكرة فقط) |
| `1-export-from-production.ps1` | تصدير قراءة فقط |
| `2-verify-export.mjs` | فاحص المخرجات |
| `3-restore-to-staging.ps1` | الاستعادة بالترتيب |
| `4-create-test-users.ps1` + `fixtures/create-test-users.mjs` + `fixtures/users.json` | مستخدمو Auth |
| `run-sql.ps1` | تطبيق ملف واحد على staging |
| `run-app.ps1` | الواجهة على staging |
| `sql/00_bootstrap.sql` | العلامة والامتدادات |
| `sql/reference_data_export.sql` | مولّد بيانات الإعداد (يُشغَّل على الإنتاج، قراءة) |
| `sql/inventory_export.sql` | الجرد (أسماء فقط) |
| `sql/20_staging_settings.sql` | الدلاء وموقع وهمي |
| `fixtures/10_synthetic_seed.sql` | البيانات الاصطناعية |
| `tools/extract-managed.mjs` | فرز تخصيصات auth/storage/realtime |
| `tools/check-function-drift.cjs` | مقارنة الملفات بالقاعدة (قراءة) |
| `tools/new-migration.mjs` + `../sql/templates/migration_frame.sql` | مولّد الهجرة بإطار التسجيل (Q14) |
| `tests/test-registration.ps1` | اختبار الإطار R1–R5 على staging |
