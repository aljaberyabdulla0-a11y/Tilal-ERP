# المهام اليومية — المعمارية ودليل التطوير

> ⚠️ هذا وصف **الحالة قبل V2**. التطوير الجاري (محرّك العمل متعدد الأقسام، 189–194) في
> [TASK_SYSTEM_V2_ARCHITECTURE.md](TASK_SYSTEM_V2_ARCHITECTURE.md). ما زال هذا المستند صحيحاً
> حتى تُطبَّق هجرات V2 على القاعدة الحيّة.

> الحالة (2026-10-08): الوحدة حيّة منذ 031، وأصلحتها 086 (قيدان متناقضان كانا يرفضان كل إدراج).
> في القاعدة الحيّة **526 مهمة كلها من النظام** (مهامّ «استمارة فشل البيع» من 175)، منها 489 مفتوحة و37 منجزة — **ولا مهمة واحدة أنشأها مستخدم بيده بعد**.

---

## ٠) الخلاصة

- صفحة واحدة `/dashboard/tasks` تجيب عن «ماذا سأفعل اليوم؟»: **متأخرة ← اليوم ← قادمة ← منجزة**.
- كل مهمة تحمل **من طلبها** (يُثبَّت داخل القاعدة فلا يُزوَّر)، و**الخطوة القادمة**، و**موعد المتابعة**.
- **الحماية كلها في القاعدة** (RLS + محفّزات). الواجهة تكتب مباشرة إلى `tasks` من المتصفح ثم `router.refresh()`.
- **مصادر المهام:** يدوية (إضافة سريعة / نموذج كامل)، وجماعية (`bulk_create_tasks`)، وتلقائية من المبيعات (إعادة تواصل، استمارة فشل البيع).
- **تذكير يومي** الساعة ٩ صباحاً بتوقيت بغداد (pg_cron)، وإشعارات عند الإسناد وعند الإنجاز/الإلغاء.
- كل التواريخ **بتوقيت بغداد** (`baghdad_today()` في القاعدة، `baghdadDate()` في الواجهة).

---

## ١) قاعدة البيانات

### ١-١) الجدول `public.tasks`

| المجموعة | العمود | النوع | ملاحظة |
|---|---|---|---|
| المفتاح | `id` | uuid | |
| من طلبها | `created_by` | uuid → auth.users | يُثبَّت بـ `auth.uid()` عند الإدراج ولا يتغيّر بعده |
| | `created_by_name` | text | يُحسب من `display_name()` |
| | `created_by_role` | text | `مدير` \| `موظف` |
| لمن | `assigned_to` | uuid → auth.users | **إلزامي** — `on delete cascade` |
| | `assigned_to_name` | text | يُحسب في المحفّز، ويُحدَّث عند تغيير اسم الموظف (170) |
| المحتوى | `title` | text | إلزامي — المحفّز يرفض الفارغ |
| | `description` | text | |
| الحالة | `status` | text | `جديدة` \| `قيد التنفيذ` \| `منجزة` \| `ملغاة` — القيد `tasks_status_chk` |
| الأولوية | `priority` | text | `عاجلة` \| `متوسطة` \| `عادية` — القيد `tasks_priority_chk`، الافتراضي `عادية` (179) |
| التوقيت | `due_date` | date | افتراضياً `baghdad_today()` |
| | `due_time` | time | اختياري |
| المتابعة | `next_step` | text | الخطوة القادمة |
| | `follow_up_date` | date | موعد المتابعة |
| الربط | `client_id` | uuid → clients | `on delete set null` |
| | `opportunity_id` | uuid → opportunities | أُضيف في 072 |
| | `analysis_lost_sale_id` | uuid → crm_lost_sales | أُضيف في 175 — مهمة «استمارة فشل البيع» |
| إرث | `related_client`, `related_deal` | uuid | من المخطّط الإنجليزي الأول. ما زالت `bulk_create_tasks` و`crm_upsert_recontact_task` تملأ `related_client` |
| الإنجاز | `completed_at` | timestamptz | يُضبط/يُمسح تلقائياً مع الحالة |
| | `created_at`, `updated_at` | timestamptz | |

**الفهارس:** `(assigned_to, due_date)` · `(status, due_date)` · `follow_up_date` جزئي · `client_id` جزئي · `opportunity_id` جزئي · **فريد جزئي** `tasks_analysis_lost_sale_open_uq`: مهمة مفتوحة واحدة لكل خسارة.

### ١-٢) المحفّزات (الحيّة)

| المحفّز | متى | ماذا يفعل | الملف |
|---|---|---|---|
| `trg_task_stamp` → `stamp_task()` | قبل insert/update | يثبّت `created_by` واسمه ودوره، ويمنع تغييرها بعد الإنشاء؛ يحسب `assigned_to_name`؛ يرفض العنوان الفارغ؛ يضبط `completed_at` | [031](../sql/031_tasks.sql) |
| `trg_task_notify_assigned` → `notify_task_assigned()` | بعد insert | إشعار للمسؤول إن أسندها غيره. يصمت إن كان `tilal.quiet_task_notify = 'on'` | 031، عُدّلت في [175](../sql/175_lost_analysis_tasks.sql#L199) |
| `trg_task_notify_status` → `notify_task_status()` | بعد update | إشعار لصاحب الطلب عند `منجزة` أو `ملغاة` (لا يُشعر الشخص بنفسه) | 031 |
| `trg_z_guard_lost_analysis_task` → `guard_lost_analysis_task()` | قبل update | الموظف لا يُنجز/يُلغي مهمة الاستمارة بيده ولا يفكّ ربطها. المشرف والمدير يملكان ذلك (`crm_can_manage_lost`). تتجاوزه `tilal.lost_task_sync = 'on'` | [175](../sql/175_lost_analysis_tasks.sql#L161) |
| `trg_crm_fact` → `crm_fact_sync_task()` | بعد insert/update of status, completed_at | يكتب حدث `task_completed` في وقائع التقارير | [096](../sql/096_crm_event_facts.sql#L586) |
| `trg_tasks_updated` | قبل update | يحدّث `updated_at` | إرث |

> الإشعارات كلها `kind = 'مهمة'` ورابطها `/dashboard/tasks`.

### ١-٣) الصلاحيات (RLS) — آخر نسخة في [040](../sql/040_inventory_followup_manager.sql#L418)

| الفعل | من يملكه |
|---|---|
| **قراءة** | المدير · مدير المتابعة · المسؤول (`assigned_to`) · صاحب الطلب (`created_by`) · المشرف لمهام فريقه (`my_scope_users()`) |
| **إنشاء** | `created_by = auth.uid()` **و** (المدير · مدير المتابعة · لنفسي · لفريقي) |
| **تعديل** | نفس القراءة (using و with check) |
| **حذف** | المدير · صاحب الطلب فقط — الموظف لا يحذف مهمة طلبها المدير |

> ⚠️ مصفوفة الأدوار في [146](../sql/146_roles_permissions.sql#L119) تعرّف وحدة `tasks` (المشرف `team`، المتابعة `all`، الموظف `own`…) لكن **سياسات `tasks` لا تستعمل `has_permission()`** — الحقيقة الفعلية هي السياسات أعلاه.

### ١-٤) الجدولة

| الوظيفة | الموعد | الدالة |
|---|---|---|
| `tasks-daily-reminder` | `0 6 * * *` UTC = ٩ صباحاً بغداد | `tasks_daily_reminder()` — إشعار واحد يومياً لكل موظف: «مهام اليوم 📋» بعدد مهام اليوم والمتأخرة والمتابعات |

الغلاف اليدوي `run_tasks_daily_reminder()` صار لـ `service_role` فقط منذ [088](../sql/088_security_hardening.sql#L81).

### ١-٥) دوال تُنشئ مهامّ

| الدالة | تُسند إلى | ما تملؤه | المُستدعي |
|---|---|---|---|
| `bulk_create_tasks(client_ids[], title, due_date, priority)` — [085](../sql/085_crm_bulk_actions.sql#L124) | **مالك العميل** لا منشئها | `client_id`, `related_client`، حدّ ٥٠٠ صف | [clients/bulk-actions.tsx](../src/app/dashboard/clients/bulk-actions.tsx#L130) |
| `crm_upsert_recontact_task(task, opp, owner, date, note)` — [140](../sql/140_lost_sales_core.sql#L903) | موظف المالك، وإلا المستخدم الحالي | `opportunity_id`, `client_id`, `follow_up_date`, `next_step`. تحدّث المهمة المفتوحة إن وُجدت | إغلاق الفرصة كخاسرة |
| `crm_create_lost_analysis_task(lost)` — [175](../sql/175_lost_analysis_tasks.sql#L69) | `crm_lost_analysis_assignee()`: مالك الفرصة النشط ← من نقلها للخسارة ← مشرف المالك | `analysis_lost_sale_id`, `opportunity_id`, موعد = اليوم + ٧ | محفّز `trg_sync_lost_analysis_task` على `crm_lost_sales` |

**دورة مهمة الاستمارة:** تُنشأ عند خسارة بلا فئة ← تُنجَز وحدها حين تُملأ `category_id` ← تُلغى حين تُنشَّط الفرصة أو تُحذف الخسارة. الاختبارات: `select * from tests.run_lost_analysis_tasks();` ([178](../sql/178_lost_analysis_tasks_tests.sql)).

---

## ٢) الواجهة

### ٢-١) خريطة الملفات

| الملف | الدور |
|---|---|
| [tasks/page.tsx](../src/app/dashboard/tasks/page.tsx) | الصفحة (Server Component): ٤ مؤشرات · إضافة سريعة · متابعات العملاء · متابعات داخل المهام · الأقسام |
| [tasks/quick-add.tsx](../src/app/dashboard/tasks/quick-add.tsx) | سطر واحد: عنوان + أولوية + تاريخ (+ المسؤول للمدير). Enter يحفظ |
| [tasks/task-form.tsx](../src/app/dashboard/tasks/task-form.tsx) | النموذج الكامل للإضافة والتعديل. يتحقق أن المتابعة ≥ يوم التنفيذ |
| [tasks/new/page.tsx](../src/app/dashboard/tasks/new/page.tsx) | صفحة الإضافة — تجلب ≤٥٠٠ عميل للربط |
| [tasks/[id]/edit/page.tsx](../src/app/dashboard/tasks/[id]/edit/page.tsx) | صفحة التعديل — تعرض «من طلبها ومتى» |
| [tasks/task-card.tsx](../src/app/dashboard/tasks/task-card.tsx) | البطاقة: دائرة الإنجاز · بدء التنفيذ · تمّت · ملف العميل · تعديل · حذف · «املأ الاستمارة». نسخة `compact` للوحة |
| [tasks/employee-filter.tsx](../src/app/dashboard/tasks/employee-filter.tsx) | فلتر الموظف (`?emp=`) — للمدير فقط |
| [lib/tasks.ts](../src/lib/tasks.ts) | دوال خالصة: `sortTasks` · `groupTasks` · `followUpsDue` · `taskCounts` |
| [lib/types.ts](../src/lib/types.ts#L1643) | `Task` · `TASK_STATUSES` · `OPEN_TASK_STATUSES` · `isOpenTask` · `TASK_PRIORITIES` · الألوان · `taskOrigin` · `isTaskLate` · `dayLabel` |
| [components/today-tasks.tsx](../src/components/today-tasks.tsx) | بطاقة «مهامي اليوم» في اللوحة (≤٦ بطاقات) + سطر متأخرات الفريق للمدير |
| [lib/client-followups.ts](../src/lib/client-followups.ts) · [components/client-followups.tsx](../src/components/client-followups.tsx) | متابعات العملاء المعروضة داخل صفحة المهام (من `clients.follow_up_date` لا من `tasks`) |

### ٢-٢) معاملات الرابط

| المعامل | الأثر |
|---|---|
| `emp` | مهام موظف معيّن — يُحترم للمدير فقط |
| `done=1` | يُظهر قسم «منجزة مؤخراً» |
| `proj` | يُمرَّر إلى متابعات العملاء فقط |

### ٢-٣) منطق العرض

- **الجلب:** استعلامان — المفتوحة (`limit 300` مرتّبة بـ `due_date`) وآخر ٣٠ منجزة/ملغاة (بـ `updated_at`). RLS تحدّد ما يُرى.
- **التقسيم** (`groupTasks`): غير مفتوحة ← منجزة؛ `due_date < اليوم` ← متأخرة؛ `= اليوم` ← اليوم؛ وإلا قادمة.
- **الترتيب** (`sortTasks`): الأولوية (عاجلة→عادية) ← `due_time` ← الأقدم إنشاءً. المنجزة: الأحدث إنجازاً أولاً.
- **«أُنجزت اليوم»** تُقاس بـ `baghdadDate(completed_at)`.
- **مهمة الاستمارة** في البطاقة: دائرة الإنجاز معطّلة، وزر «تمّت» مخفي، ويظهر «املأ الاستمارة» إلى `/dashboard/crm/opportunities/{opp}?tab=lost&analyse={lost}`.

### ٢-٤) مسار الكتابة

```
المتصفح ── supabase.from("tasks").insert/update/delete ──► RLS ──► stamp_task / guard ──► الصف
                                                                    └─► notify_* ──► notifications
                                                                    └─► crm_fact_sync_task ──► وقائع التقارير
        ◄── router.refresh() ── يعيد رسم الصفحة من الخادم
```

---

## ٣) التكامل مع الوحدات الأخرى

| الوحدة | التفاعل | الملف |
|---|---|---|
| تسليم العمل / إنهاء الخدمة | تنقل **المفتوحة فقط** إلى المستلم (المنجزة تبقى سجلاً للأول) | [045](../sql/045_employee_handover.sql#L238) · [123](../sql/123_end_service_date.sql#L139) |
| دمج العملاء | تنقل `client_id` و`opportunity_id` للباقي | 104 · 169 · 077 |
| الموارد البشرية | تغيير الاسم يحدّث `assigned_to_name`؛ فحص «مهام مفتوحة لموظف خارج» | [170](../sql/170_hr_integrations.sql#L45) |
| جودة البيانات | فحص «ملفّات مغلقة ومهامّها ما زالت مفتوحة» | [077](../sql/077_crm_data_quality.sql#L315) |
| لوحة التحكم | `tasks_open` · `tasks_overdue` · `tasks_today` · `tasks_done_today` | [182](../sql/182_dashboard_core.sql#L358) · [_views/employee.tsx](../src/app/dashboard/_views/employee.tsx#L98) · [_sections/attention.tsx](../src/app/dashboard/_sections/attention.tsx#L85) |
| مدير المتابعة | عدّ المفتوحة والمتأخرة | [_views/followup.tsx](../src/app/dashboard/_views/followup.tsx#L43) · [followup/employees](../src/app/dashboard/followup/employees/page.tsx#L65) |
| يومي في CRM | مهامي المفتوحة | [crm/today/page.tsx](../src/app/dashboard/crm/today/page.tsx#L70) |
| البحث الشامل | بحث بالعنوان | [api/search/route.ts](../src/app/api/search/route.ts#L99) |

> **ليست من هذه الوحدة:** `onboarding_tasks` (تهيئة الموظفين، 151) و`mkt_tasks` (التسويق، 121) جدولان منفصلان بحالات ودوال خاصة.

---

## ٤) مشكلات معروفة

### أخطاء
| # | المشكلة | الأثر | الموضع |
|---|---|---|---|
| 1 | جلب المفتوحة بحدّ **300** بلا ترقيم ولا تنبيه | المدير يرى 300 من 489 مهمة مفتوحة الآن | [page.tsx:45](../src/app/dashboard/tasks/page.tsx#L45) |
| 2 | النموذج يرسل `assigned_to: isAdmin ? … : myUserId` عند **التعديل** أيضاً | المشرف أو مدير المتابعة إن عدّل مهمة موظفه **أسندها لنفسه** صامتاً | [task-form.tsx:78](../src/app/dashboard/tasks/task-form.tsx#L78) |
| 3 | اختيار المسؤول والفلتر بـ `isAdmin` فقط | المشرف ومدير المتابعة لا يستطيعان من الواجهة ما تسمح به RLS | quick-add · task-form · page |
| 4 | فحص الجودة يربط `/dashboard/tasks?filter=orphan` | الصفحة لا تقرأ `filter` | [077:316](../sql/077_crm_data_quality.sql#L316) |
| 5 | `notify_task_assigned` على الإدراج فقط | إعادة إسناد مهمة بالتعديل لا تُشعر المسؤول الجديد | 031 / 175 |

### نواقص
- قائمة العملاء في النموذج `limit 500` بلا بحث (العملاء أكثر)، ولا ربط بفرصة من النموذج، ولا رابط للفرصة في البطاقة إلا لمهمة الاستمارة.
- مصدران للصلاحية: مصفوفة 146 مقابل سياسات 040.
- عمودا الإرث `related_client`/`related_deal` يكرّران `client_id`.
- لا تعليقات · لا مرفقات · لا سجلّ تغييرات · لا تكرار · لا مهام فرعية · لا عرض تقويم/كانبان · لا سبب يُطلب عند الإلغاء.

---

## ٥) دليل التطوير

### إضافة عمود جديد
1. هجرة `sql/NNN_*.sql`: `alter table public.tasks add column if not exists …` + فهرس جزئي إن كان للربط.
2. إن احتاج حساباً أو حماية ← في `stamp_task()` (انسخ نصّها **الحيّ** كاملاً ثم عدّل).
3. `Task` في [types.ts](../src/lib/types.ts#L1643) (اختياري `?` إن لم يُطبَّق بعد).
4. [task-form.tsx](../src/app/dashboard/tasks/task-form.tsx) (الحالة + `payload`) و[task-card.tsx](../src/app/dashboard/tasks/task-card.tsx).
5. إن كان يشير إلى عميل/فرصة ← أضِفه إلى دوال الدمج (`merge_clients` في 104/169) حتى لا يبقى معلّقاً على عميل مدموج.

### مصدر تلقائي جديد للمهام
- دالة `security definer` تُدرج بـ `created_by_name = 'النظام'` (و`created_by` يبقى null حين لا مستخدم).
- عمود ربط خاص + **فهرس فريد جزئي على المفتوحة** يمنع التكرار (نمط 175).
- إن كان الإنجاز يجب أن يأتي من فعل آخر ← حارس `before update` بنمط `guard_lost_analysis_task` ومفتاح جلسة (`set_config('tilal.…', 'on', true)`) لتحديثات المزامنة.
- للإنشاء الجماعي: `set_config('tilal.quiet_task_notify', 'on', true)` ثم إشعار واحد لكل موظف.
- راجع: نقل المهمة في التسليم (045/123) — هل يجب أن تنتقل؟

### تعديل الصلاحيات
- السياسات الأربع تُستبدل كاملة (`drop policy if exists` ثم `create`). السياسات المتساهلة تُجمع بـ OR — سياسة واسعة واحدة تُبطل البقية (درس 036).
- اختبر بمستخدم غير مدير: `set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role','authenticated')::text, true)` ثم `set role authenticated`.

### قبل الدفع
- طبّق الهجرة أولاً، ثم ادفع الواجهة.
- الحالات والأولويات **عربية** في كل مكان — لا تُضف قيداً بقيم إنجليزية (درس 086).
- كل «اليوم» بتوقيت بغداد: `baghdad_today()` / `baghdadDate()` — لا `new Date()` ولا `current_date`.
