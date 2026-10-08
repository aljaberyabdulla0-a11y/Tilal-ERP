# محرّك العمل في تلال — معمارية المهام V2

> الحالة (2026-10-08): **مطبّقة على الحيّ** — 189–194 و197 (إصلاح `task_list`: حدّ ١٠٠ معامل في `jsonb_build_object`).
> `tests.run_tasks_v2()` = **65/65**، والانحدار: الاستمارة 13/13، اللوحة 15/15، الأمان 17/17. والواجهة مدفوعة.
> المرجع الوظيفي للحالة السابقة: [TASKS_ARCHITECTURE.md](TASKS_ARCHITECTURE.md).

---

## ٠) الخلاصة

- **لا إعادة بناء.** `public.tasks` يبقى المحرّك الواحد. كل ما أُضيف أعمدة اختيارية وجداول مساعدة، وكل دالة قديمة تعمل كما كانت.
- **الحالات الأربع لا تتغيّر** (`جديدة · قيد التنفيذ · منجزة · ملغاة`). يقرؤها ١٥ موضعاً في القاعدة (اللوحة، التذكير، الجودة، التسليم، الحارس، الفهرس الفريد…). التفصيل الخاص بكل قسم يأتي من **خطوة مسار العمل** (`workflow_step_id`)، و«بانتظار» يأتي من **حالة مشتقّة** (تبعية مفتوحة أو موافقة معلّقة أو توقّف مُعلَن).
- **القسم من شجرة HR نفسها** (`departments`، 145) لا جدول أقسام جديد. وإعداد القسم في `department_task_settings` يحدّد **مساحة العمل** (مبيعات · تسويق · موارد بشرية · محاسبة · مشاريع · عمليات · إدارة) فتختار الواجهة تخطيطها من البيانات.
- **مصدر واحد للصلاحية:** المصفوفة (`role_permissions`، 146) عبر `permission_scope('tasks', …)` + الجسور القديمة (المشرف بالمشروع، مدير المتابعة) كحدّ أدنى لا يُنقص أحداً. وRLS هي خطّ الدفاع، والواجهة لا تقرّر شيئاً.
- **الكتابة من المتصفح عبر دوالّ `task_*`** (SECURITY DEFINER بفحص صريح). والكتابة المباشرة القديمة على الجدول تمرّ بحارس (`guard_task_client_write`) يمنع ما لا تمنعه RLS: الإسناد لمن لا تملكه، تزوير المصدر، تجاوز الموافقة.
- **سجلّ نشاط** لكل تغيير مهمّ (من، ماذا، متى، قبل، بعد)، **وإصدار** (`version`) يمنع الكتابة فوق تعديل أحدث.

---

## ١) الحالة الحالية — ما وجده الفحص

| البند | الحالة الحيّة |
|---|---|
| المهام | 526، **كلها من النظام** (استمارة فشل البيع)، 489 مفتوحة، 0 ملغاة. لا مهمة يدوية بعد |
| الاتساق | `completed_at` يطابق الحالة في كل الصفوف؛ لا `due_date` فارغ |
| مفاتيح ناقصة | `assigned_to` و`created_by` **بلا مفتاح أجنبي** على الحيّ (031 أضاف العمودين بـ `add column if not exists` على جدول قائم فلم تُنشأ المفاتيح) |
| أعمدة إرث | `related_client` (صفّ واحد يختلف عن `client_id`)، `related_deal` (فارغ، مفتاحه إلى `deals` القديم) |
| المحفّزات | 6: `trg_task_stamp` · `trg_tasks_updated` · `trg_task_notify_assigned` · `trg_task_notify_status` · `trg_z_guard_lost_analysis_task` · `trg_crm_fact` |
| الأقسام | `departments` شجرة بـ19 قسماً (SALES، MKT، HR، FIN، CRM، BRK، OPS، ADMIN، EXEC + فروع) |
| الأدوار | 22 دوراً في `roles`؛ الحسابات الفعلية: 10 موظفين، 3 مشرفين، 2 مدير، 5 وسطاء |
| المصفوفة | وحدة `tasks` لها صفوف لكل دور بنطاق (own/team/department/all) و`enforced = false` — **لا تقرؤها سياسات `tasks`** |
| مهام التسويق | `mkt_tasks` (121) جدول منفصل عمداً — **فارغ**. يقرؤه تحليل التسويق (125) ومؤشر الأداء (160) |
| مهام التهيئة | `onboarding_tasks` (151) — **فارغ**. يُنجَز تلقائياً بقواعد `refresh_onboarding()` |
| الامتدادات | `pg_trgm` و`pg_cron` و`pgtap` مثبّتة |

### المشكلات التي يعالجها V2
1. حدّ 300 مهمة مفتوحة في الصفحة بلا ترقيم (489 مفتوحة الآن).
2. تعديل المشرف لمهمة موظفه يُسندها إليه (`assigned_to: isAdmin ? … : myUserId`).
3. الواجهة تقيّد الإسناد بـ `isAdmin` والقاعدة تسمح لأكثر — والعكس: سياسة التحديث تسمح لمنشئ المهمة بإسنادها **لأي أحد**.
4. رابط الجودة `?filter=orphan` لا يعمل.
5. لا إشعار عند إعادة الإسناد.
6. مصدران للصلاحية (146 مقابل 040).
7. لا تعليقات، مرفقات، سجلّ، مهام فرعية، تبعيات، قوالب، تكرار، موافقات.

### مواضع تقرأ الحالات الأربع حرفياً (لذلك لا تُضاف حالة خامسة)
`stamp_task`، `notify_task_status`، `tasks_daily_reminder`، `guard_lost_analysis_task`، `sync_lost_analysis_task`، `crm_create_lost_analysis_task`، الفهرس `tasks_analysis_lost_sale_open_uq`، `crm_upsert_recontact_task`، تسليم العمل (045/123)، `integration_issues` (170)، فحص الجودة (077)، `dashboard_attention`/`dashboard_my_summary` (182)، مؤشر الأداء (160)، والواجهة (`isOpenTask`).

---

## ٢) المعمارية المستهدفة

```
                    ┌──────────────── public.tasks (المحرّك) ────────────────┐
  مصادر الإنشاء ──► │ الحالة العامة · القسم · النوع · المصدر · الكيان المرتبط │ ──► الإشعارات
  يدوي · جماعي ·    │ الأب · المسار/الخطوة · القالب · التكرار · الموافقة ·    │ ──► سجلّ النشاط
  CRM · قالب ·      │ التقدير/الفعلي · الموعد النهائي · الأرشفة · الإصدار     │ ──► وقائع CRM (للمبيعات فقط)
  تكرار · أتمتة     └──────┬──────────────┬──────────────┬──────────────┬─────┘ ──► العدّادات والتقارير
                           │              │              │              │
                  تعليقات · مرفقات   قائمة تحقق    متابِعون · تبعيات   وسوم
```

### ٢-١) الأبعاد الجديدة على المهمة

| البُعد | العمود | المصدر |
|---|---|---|
| القسم | `department_id` → `departments` | يُشتقّ من قسم المسؤول إن لم يُحدَّد |
| النوع | `task_type` → `task_types(code)` | جدول قابل للإضافة، لكل نوع مساحته وأولويته الافتراضية ومدّته وSLA |
| المصدر | `task_source` → `task_sources(code)` | `manual · system · crm · sales · marketing · hr · accounting · projects · workflow · recurring · automation · integration` |
| قناة الإنشاء | `created_source` | `quick_add · form · bulk · subtask · template · recurrence · automation · trigger · duplicate · legacy` |
| الكيان | `entity_type` → `task_entity_types(code)` + `entity_id` | عميل، فرصة، موظف، مشروع، حملة، محتوى، فاتورة، فاتورة مطوّر، حجز، وحدة، وسيط، مورّد، طلب موافقة، مصروف موظف، خسارة |
| الإرث | `client_id`, `opportunity_id` تبقى | تُملأ تلقائياً من الكيان والعكس |
| البنية | `parent_task_id`, `project_id`, `campaign_id` | |
| المسار | `workflow_id`, `workflow_step_id` | الخطوة تحدّد الحالة العامة |
| الوقت | `start_date`, `started_at`, `estimated_minutes`, `actual_minutes`, `deadline_at` | `deadline_at` من SLA النوع إن لم يُحدَّد |
| الإغلاق | `completed_by`, `cancelled_by`, `cancelled_at`, `cancellation_reason` | يضبطها المحفّز من `auth.uid()` لا من المتصفح |
| الانتظار | `blocked_reason` | توقّف مُعلَن |
| الموافقة | `requires_approval`, `approval_status`, `approver_id`, `approval_requested_at`, `approved_by`, `approved_at`, `rejection_reason` | |
| الأرشفة | `archived_at`, `archived_by` | **للمغلقة فقط** — لا تُخفى متأخرة بالأرشفة |
| التزامن | `version` | يزيد مع كل تحديث؛ إرسال إصدار قديم يُرفض |

### ٢-٢) قواعد السلامة في القاعدة (CHECK)
- `منجزة` ⇔ `completed_at` موجود.
- `cancelled_*` فارغة ما لم تكن `ملغاة`.
- الأرشفة للمغلقة فقط.
- `entity_type` و`entity_id` معاً أو لا شيء.
- المهمة لا تكون أباً لنفسها، والدقائق غير سالبة، والإصدار ≥ 1.
- `approval_status` لا يوجد بلا `requires_approval`.
- تكرار واحد لكل (قاعدة التكرار، التاريخ) — فهرس فريد يمنع التكرار عند إعادة المحاولة.

### ٢-٣) الحالة المشتقّة «بانتظار»
مهمة مفتوحة و(لها تبعية مانعة غير منجزة **أو** موافقة معلّقة **أو** `blocked_reason`). تُحسب في `task_list` ولا تُخزَّن، فلا تختلف عن الواقع.

### ٢-٤) الجداول المساعدة

| الجدول | الغرض |
|---|---|
| `task_sources`, `task_types`, `task_entity_types`, `task_workspaces` | قوائم مرجعية قابلة للإضافة |
| `department_task_settings` | مساحة القسم، «قريبة الموعد» بالساعات، إلزام سبب الإلغاء، المسار الافتراضي |
| `task_comments` | محادثة المهمة + الإشارات (`mentions`) — حذف ناعم |
| `task_attachments` | ملفات في الدلو الخاص `task-attachments` (المسار `{task_id}/…`) |
| `task_checklist_items` | بنود قائمة التحقق بترتيب ومن أنجزها ومتى |
| `task_activity_log` | سجلّ لا يُكتب إلا من المحفّزات |
| `task_watchers` | متابِعون يرون المهمة ويتلقّون إشعاراتها |
| `task_dependencies` | B تعتمد على A (`is_blocking`) — منع الدوائر |
| `task_labels`, `task_label_links` | وسوم عامة أو خاصة بقسم |
| `task_saved_views` | مرشّحات محفوظة لكل مستخدم |
| `task_workflows`, `task_workflow_steps` | مسارات قابلة للتخصيص (التسويق، المحتوى، التهيئة…) |
| `task_templates`, `task_template_items` | قالب = مهمة رئيسية + مهام فرعية بإزاحة أيام وتبعيات وقائمة تحقق وقاعدة إسناد |
| `task_recurrences` | يومي/أسبوعي/شهري/سنوي/كل N يوم |
| `task_automation_rules`, `task_automation_runs` | حدث → قاعدة → قالب → مهام (بمفتاح حدث يمنع التكرار) |
| `task_assign_cursor` | حالة التوزيع الدوري (round robin) |

---

## ٣) نموذج الصلاحيات

### ٣-١) النطاق
`task_my_scope()` = أعلى ما يمنحه أيٌّ من:
1. المدير (`is_admin`) ← `all`.
2. المصفوفة: `permission_scope('tasks', 'read')` ← `all | department | team | own`.
3. الجسور القديمة (كي لا يخسر أحد ما يراه اليوم): مدير المتابعة ← `all`، المشرف ← `team`.
4. الوسيط ← `own` دائماً.

### ٣-٢) من يرى المهمة (RLS — SELECT)
- المسؤول، المنشئ، المعتمِد، المتابِع.
- `all`: الكل.
- `team`: مهام **فريقي** = `my_scope_users()` (المشرف بالمشروع) ∪ تقاريري المباشرة وغير المباشرة (`employees.manager_id`).
- `department`: الفريق ∪ مهام **أقسامي** = الأقسام التي أديرها وفروعها ∪ قسمي وفروعه.

### ٣-٣) من يعدّل
نفس القراءة **بلا** المتابِع والمعتمِد (يعلّقان ويوافقان عبر الدوال فقط).

### ٣-٤) لمن أُسند — `can_assign_task_to(user)`
- لنفسي دائماً.
- `all`: لأي موظف نشط (ليس وسيطاً، إلا للمدير).
- `team`: لفريقي.
- `department`: لفريقي ولأعضاء أقسامي.

### ٣-٥) الحذف
المدير، أو المنشئ ما دامت المهمة ليست من النظام (المصدر `manual`). البديل الموصى به: **الأرشفة** (للمغلقة).

### ٣-٦) الحارس — `guard_task_client_write` (SECURITY INVOKER)
يعمل حين `current_user = 'authenticated'` فقط (كتابة مباشرة من PostgREST). داخل دوالّ DEFINER يكون `current_user` مالك الدالة فيُتجاوز — لذلك كل دالة `task_*` تفحص بنفسها، وكل دوال النظام القديمة (الجماعي، إعادة التواصل، الاستمارة، التسليم، الدمج) تعمل كما كانت.
يمنع: الإسناد لمن لا يجوز، تزوير `task_source` (يُفرض `manual`)، تعديل حقول الموافقة والقالب والتكرار، الإلغاء بلا سبب حيث يلزم.

### ٣-٧) المصفوفة
تُحدَّث صفوف `tasks`: `hr_manager` و`finance_manager` ← `department` (كانا `own`)، ويُضاف `archive` و`manage` للمدير. لا يُفرض `enforced` على الوحدة: الجسور القديمة تبقى حدّاً أدنى.

---

## ٤) الدوال

### القراءة (SECURITY INVOKER — RLS تحكم)
| الدالة | ما تعيده |
|---|---|
| `task_list(filters jsonb, sort text, limit, offset)` | صفوف بأسماء مرتبطة (عميل، فرصة، قسم، مشروع، حملة)، عدّ الفرعية وقائمة التحقق، الوسوم، «بانتظار»، والعدد الكلّي — ترقيم من الخادم |
| `task_detail(id)` | المهمة + التعليقات + المرفقات + السجلّ + الفرعية + التبعيات + المتابعون + قائمة التحقق |
| `task_counts(scope)` | بطاقات «عملي» والفريق في استعلام واحد |
| `task_overview(from, to, filters)` | الأداء: منشأة/منجزة/متأخرة/ملغاة، متوسط زمن الإنجاز والتأخير، خرق SLA — حسب القسم والموظف والمصدر والأولوية والمشروع |
| `task_workload(department)` | العبء لكل مسؤول |
| `task_department_overview()` | لكل قسم: مفتوحة، متأخرة، اليوم، نسبة الإنجاز |

### الكتابة (SECURITY DEFINER — فحص صريح)
`task_save` · `task_set_status` · `task_reassign` · `task_decide_approval` · `task_set_step` · `task_comment_add/edit/delete` · `task_bulk_update` · `task_duplicate` · `task_archive` · `task_from_template` · `task_watch` · `task_add_dependency`.

### النظام
`task_resolve_assignee(rule, ctx)` · `task_emit_event(event, entity, payload, key)` · `task_generate_recurring(date)` · `tasks_daily_reminder()` (مطوَّرة، بنفس الاسم والجدولة).

---

## ٥) الإشعارات

| الحدث | المستلم | ملاحظة |
|---|---|---|
| إسناد (إنشاء) | المسؤول | كما كان، ويحترم `tilal.quiet_task_notify` |
| إعادة إسناد | المسؤول الجديد | من الواجهة/الدوال فقط؛ تسليم العمل يرسل ملخّصه الخاص |
| تعليق | المسؤول، المنشئ، المتابعون | لا يُشعَر الكاتب |
| إشارة @ | المُشار إليه | يُضاف متابعاً إن كان الكاتب يملك إسناده |
| موافقة مطلوبة | المعتمِد | |
| اعتماد/رفض | المسؤول | |
| إنجاز/إلغاء | المنشئ (كما كان) + المتابعون | |
| اكتملت تبعية | مسؤول المهمة التي صارت جاهزة | |
| التذكير اليومي ٩:٠٠ بغداد | كل موظف لديه ما يستحق | «متأخرة: n · اليوم: n · قادمة: n · بانتظار موافقتك: n» — لا يُرسل إن لم يكن متأخر أو اليوم أو متابعة أو موافقة |

كل إشعار جديد يحمل `entity_type = 'task'` ورابط `/dashboard/tasks/{id}`.

---

## ٦) الواجهة

```
/dashboard/tasks                 مركز العمل (عملي · الفريق · الأقسام · قائمة · لوحة · تقويم)
/dashboard/tasks/[id]            تفاصيل المهمة
/dashboard/tasks/[id]/edit       تعديل (أُصلح: لا يُعاد الإسناد)
/dashboard/tasks/new             إنشاء (قسم، نوع، كيان، مشروع، حملة، أب، موافقة، تقدير، وسوم، قالب)
/dashboard/tasks/dept/[code]     مساحة القسم — التخطيط من department_task_settings.workspace
/dashboard/tasks/projects        المشاريع: المراحل والمهام ونسبة الإنجاز
/dashboard/tasks/reports         التقارير
/dashboard/tasks/templates       القوالب
/dashboard/tasks/settings        الأنواع، الوسوم، إعداد الأقسام، المسارات، التكرار، الأتمتة
```

لماذا `/dashboard/tasks` لا `/dashboard/work`: كل الإشعارات القديمة والروابط في اللوحة والجودة والبحث تشير إليه، والمستخدم لا يشعر أن شيئاً انتقل.

### المكوّنات — `src/components/tasks/`
`core/` (الأنواع المشتركة، شارات الحالة والأولوية، أزرار الحالة)، `views/` (القائمة، اللوحة، التقويم، عملي، الفريق)، `detail/` (قائمة التحقق، الفرعية، التعليقات، المرفقات، السجلّ، التبعيات، المتابعون، الموافقة)، `workspaces/` (مبيعات، تسويق، HR، محاسبة، مشاريع، عام)، `related-tasks.tsx` (لوحة «المهام المرتبطة» في العميل والفرصة والموظف والحملة والمشروع).

### مساحات الأقسام
| المساحة | ما تعرضه |
|---|---|
| المبيعات | اليوم: متابعات، مكالمات، اجتماعات، زيارات، حجوزات، إجراءات معلّقة، عملاء متأخرون، ليدات ساخنة، فرص خاسرة — بطاقة بالعميل والفرصة والخطوة القادمة وأزرار: افتح العميل/الفرصة، اتصل، سجّل نتيجة، أجّل المتابعة، أنجز، مهمة جديدة |
| التسويق | متتبّع (لوحة بخطوات المسار)، الحملات، خطّ المحتوى، التقويم، الموافقات، عبء الفريق |
| الموارد البشرية | مهام الموظفين، التهيئة (المهام + `onboarding_board` القائم)، إنهاء الخدمة، الطلبات، التقييمات، التدريب، المعلّق |
| المحاسبة | حسب النوع: مراجعة فواتير، متابعة دفعات، تحصيل، تسوية، اعتماد مصروف، إقفال شهري |
| المشاريع | المراحل (`milestone`) ومهامها ونسبة الإنجاز والمتأخر |
| الإدارة | عبء الأقسام، المتأخر حسب القسم، نسبة الإنجاز، الأكثر تأخراً، حسب الأولوية/المشروع/المصدر — مع النزول |

---

## ٧) التكامل مع ما هو قائم

| القائم | ما يحدث |
|---|---|
| `bulk_create_tasks` | نفس التوقيع؛ يملأ المصدر `crm` والنوع `follow_up` والقناة `bulk` |
| `crm_upsert_recontact_task` | نفس التوقيع والسلوك؛ المصدر `crm` والنوع `follow_up` |
| `crm_create_lost_analysis_task` + الحارس + المزامنة | **لا تُمسّ**. المحفّز يصنّف المهمة `lost_analysis`/`crm` من `analysis_lost_sale_id` |
| `tasks_daily_reminder` | نفس الاسم والجدولة؛ رسالة أغنى وشرط إرسال |
| التسليم (045/123/163) والدمج (104/169) | لا تغيير — يكتبون عبر DEFINER فلا يعترضهم الحارس، ولا يُرسل إشعار لكل مهمة |
| وقائع CRM (096) | `crm_fact_sync_task` يسجّل مهام المبيعات فقط (لها عميل/فرصة أو قسمها في مساحة المبيعات أو بلا قسم) — مهمة تصميم لا تدخل تقارير المبيعات |
| اللوحة (182) | العدّادات الأربعة كما هي؛ والجديدة (`pending_approval`, `due_soon`, `sla_breached`) في `task_counts` |
| `mkt_tasks` | يبقى ولا يُحذف (فارغ). صفحة مهام التسويق القديمة تشير إلى المتتبّع الجديد. الترحيل والتجميد في مرحلة لاحقة بعد موافقة المالك |
| `onboarding_tasks` | يبقى بقواعده التلقائية؛ مساحة HR تعرضه بجانب مهام HR (طبقة توافق). قاعدة الأتمتة `employee.created` مزروعة **معطّلة** كي لا تتكرّر التهيئة |

---

## ٨) خطة الهجرات

| الملف | المحتوى |
|---|---|
| `189_task_v2_schema.sql` | القوائم المرجعية، الأعمدة، القيود، الفهارس، الجداول المساعدة، الدلو، الترحيل (بلا تغيير `updated_at` القديم) |
| `190_task_v2_permissions.sql` | دوال النطاق، سياسات RLS لكل الجداول، حارس الكتابة المباشرة، سياسات التخزين، تحديث المصفوفة |
| `191_task_v2_engine.sql` | المحفّزات (الختم v2، السجلّ، الإشعارات، التبعيات)، دوال القراءة والكتابة، التذكير v2، وقائع CRM، الدوال القديمة بمصادرها |
| `192_task_v2_workflows.sql` | المسارات، القوالب، الإسناد، التكرار (+ الجدولة)، الأتمتة (+ الخطافات)، البذور |
| `193_task_v2_analytics.sql` | التقارير والعبء ونظرة الأقسام |
| `194_task_v2_tests.sql` | `tests.run_tasks_v2()` |

### ترتيب النشر
1. تطبيق 189 → 190 → 191 → 192 → 193 → 194 (بالترتيب، في SQL Editor).
2. `select * from tests.run_tasks_v2();` ثم مجموعات الانحدار: `tests.run_lost_analysis_tasks()`, `tests.run_dashboard()`, `tests.run_integrations()`, `tests.run_security()`.
3. `select * from public.security_audit();` = لا جديد.
4. دفع الواجهة.

### الرجوع
- الواجهة: `git revert` للالتزام — الواجهة القديمة تعمل على الجدول نفسه.
- القاعدة: كل الإضافات اختيارية؛ الرجوع الأدنى = إعادة تعريف `stamp_task` و`tasks_daily_reminder` و`crm_fact_sync_task` و`bulk_create_tasks` و`crm_upsert_recontact_task` بنصوصها في 031/175/096/085/140، وإسقاط محفّزات 191 وسياسات 190 وإعادة سياسات 040 (النصّ في [sql/rollback_task_v2.sql](../sql/rollback_task_v2.sql) — بلا رقم عمداً، **لا يُشغَّل إلا عند الحاجة**). الجداول الجديدة والأعمدة تبقى (لا ضرر من بقائها).

---

## ٩) الاختبار

`tests.run_tasks_v2()` (نمط 183: معاملة تُلغى، الهوية بـ `set_config`):
- الترحيل: الحالات والأولويات والمسؤول والعميل والفرصة والخسارة و`completed_at` لم تتغيّر؛ مهام الاستمارة صُنّفت `lost_analysis`.
- RLS: الموظف لا يرى مهمة زميل؛ يراها متابِعاً؛ المشرف يرى فريقه؛ مدير القسم يرى قسمه؛ الوسيط لا يرى شيئاً.
- الإسناد: الموظف لا يُسند لغيره (مباشرة ولا عبر الدالة)؛ المشرف يُسند لفريقه لا لغيره؛ التعديل لا يغيّر المسؤول.
- إعادة الإسناد تُشعر الجديد وتُسجَّل.
- الإنجاز: `completed_by`؛ لا إنجاز قبل التبعية المانعة؛ لا إنجاز قبل الموافقة؛ الرفض يعيدها.
- الإلغاء: سبب إلزامي حيث يلزم؛ `cancelled_*` تُمسح عند الإرجاع.
- التزامن: إصدار قديم يُرفض.
- التبعيات: لا دوائر.
- القالب: يُنشئ الفرعية والتبعيات وقائمة التحقق.
- التكرار: تشغيلان لنفس اليوم = مهمة واحدة.
- الأتمتة: حدث بنفس المفتاح مرتين = تشغيل واحد.
- الانحدار: الجماعي وإعادة التواصل والاستمارة وحارسها، والتسليم، والتذكير، ووقائع CRM لا تسجّل مهمة تسويق.

واجهة: `vitest` لدوال `src/lib/tasks.ts` و`src/lib/task-filters.ts` الخالصة (التقسيم، الترتيب، المرشّحات، التقويم).

---


## ١٠) التقرير النهائي (2026-10-08)

### ١) ما تغيّر
- المحرّك: `tasks` صار متعدد الأقسام (قسم، نوع، مصدر، كيان، مشروع، حملة، أب، مسار، قالب، تكرار، موافقة، وقت، أرشفة، إصدار) — بلا حذف أو إعادة تسمية لأي عمود.
- الصلاحيات: مصدر واحد (المصفوفة + الجسور القديمة حدّاً أدنى + علاقات الإدارة الفعلية)، وحارس للكتابة المباشرة.
- الأخطاء الخمسة المعروفة أُصلحت: حدّ ٣٠٠ (ترقيم من الخادم)، التعديل يُعيد الإسناد، الإسناد بـ `isAdmin`، رابط الجودة `?filter=orphan`، إشعار إعادة الإسناد.
- واجهة كاملة: مركز العمل، صفحة المهمة، مساحات الأقسام، المشاريع، التقارير، القوالب، الإعدادات، ولوحة «المهام المرتبطة» في خمس صفحات.

### ٢) الملفات
| النوع | الملفات |
|---|---|
| هجرات | `sql/189_task_v2_schema.sql` · `197_task_v2_list_fix.sql` · `190_task_v2_permissions.sql` · `191_task_v2_engine.sql` · `192_task_v2_workflows.sql` · `193_task_v2_analytics.sql` · `194_task_v2_tests.sql` · `rollback_task_v2.sql` (طوارئ، بلا رقم) |
| مكتبة | `src/lib/types.ts` (أنواع V2) · `src/lib/tasks.ts` (موسّعة) · `src/lib/task-filters.ts` (جديد) · `src/lib/tasks-server.ts` (جديد) |
| اختبارات واجهة | `src/lib/tasks.test.ts` · `src/lib/task-filters.test.ts` |
| مكوّنات `src/components/tasks/` | `badges` · `use-task-actions` · `task-row-card` · `quick-add` · `filter-bar` · `list-view` · `board-view` · `calendar-view` · `work-center-ui` · `task-form` · `template-picker` · `template-editor` · `assign-rule-editor` · `settings-panels` · `related-tasks` · `detail/{detail-actions, approval-panel, checklist-panel, comments-panel, attachments-panel, relations-panel}` · `workspaces/{task-section, sales-workspace, marketing-workspace, sections-workspaces}` |
| صفحات | `/dashboard/tasks` (أُعيد بناؤها) · `/tasks/[id]` (جديدة) · `/tasks/[id]/edit` · `/tasks/new` · `/tasks/dept/[code]` · `/tasks/projects` · `/tasks/reports` · `/tasks/templates` · `/tasks/templates/[id]` · `/tasks/settings` |
| تكامل | العميل (تبويب التواصل) · الفرصة (تبويب «المهام») · الموظف · المشروع · الحملة (تبويب المهامّ على المحرّك الموحّد) · مهام التسويق القديمة (تحويل إلى المتتبّع) · البحث الشامل · `crm/today` و`followup/employees` (الموعد الفارغ) · `today-tasks`/`task-card` (عبر `task_set_status`) |
| حُذفت | `src/app/dashboard/tasks/{quick-add, task-form, employee-filter}.tsx` (حلّت محلّها مكوّنات `components/tasks`) |

### ٣–٨) القاعدة
- **جداول جديدة (22):** `task_sources` · `task_workspaces` · `task_types` · `task_entity_types` · `department_task_settings` · `task_workflows` · `task_workflow_steps` · `task_templates` · `task_template_items` · `task_recurrences` · `task_automation_rules` · `task_automation_runs` · `task_assign_cursor` · `task_comments` · `task_attachments` · `task_checklist_items` · `task_activity_log` · `task_watchers` · `task_dependencies` · `task_labels` · `task_label_links` · `task_saved_views`. ودلو `task-attachments` (خاص، ٢٥ م.ب).
- **أعمدة جديدة على `tasks` (34):** انظر §٢-١. و`due_date` صار يقبل الفراغ (الافتراضي باقٍ).
- **قيود:** `tasks_entity_pair_chk` · `tasks_not_own_parent_chk` · `tasks_minutes_chk` · `tasks_completed_chk` · `tasks_cancelled_chk` · `tasks_archived_chk` · `tasks_approval_chk` · `tasks_created_source_chk` · `tasks_version_chk` · `tasks_recurrence_pair_chk`.
- **فهارس:** المسؤول/الحالة/الموعد · القسم · المنشئ · النوع · المصدر · الكيان · المشروع · الحملة · الأب · الموافقات المعلّقة · `completed_at` · trigram على العنوان · فريد للتكرار.
- **دوال:** صلاحيات (`task_my_scope` · `task_team_user_ids` · `task_my_department_ids` · `task_row_visible/editable` · `can_see/edit_task` · `can_assign_task_to` · `task_can_manage_config` · `task_requires_cancel_reason` · `task_department_settings`)، كتابة (`task_save` · `task_set_status` · `task_decide_approval` · `task_set_step` · `task_reassign` · `task_comment_add/edit/delete` · `task_attachment_remove` · `task_watch` · `task_archive` · `task_duplicate` · `task_bulk_update` · `task_template_apply`)، قراءة (`task_list` · `task_detail` · `task_counts` · `task_assignable_people` · `task_overview` · `task_workload` · `task_department_overview` · `task_related_summary`)، نظام (`task_resolve_assignee` · `task_from_template_internal` · `task_recurrence_next` · `task_generate_recurring` · `task_emit_event` · `task_scan_events`).
- **محفّزات جديدة:** على `tasks`: `trg_task_guard_client` · `trg_task_guard_mark` · `trg_task_activity` · `trg_task_notify_events` · `trg_task_workflow`. وعلى المساعدة: الدوائر، الختم والسجلّ لقائمة التحقق والمرفقات والمتابعين والتبعيات، وختم التكرار. وخطافات الأتمتة على `employees` و`crm_campaigns` و`mkt_content`.
- **أُعيد تعريفها (نفس التوقيع):** `stamp_task` · `notify_task_assigned` · `notify_task_status` · `tasks_daily_reminder` · `crm_fact_sync_task` · `bulk_create_tasks` · `crm_upsert_recontact_task`.
- **سياسات RLS:** الأربع على `tasks` (نفس الأسماء) + سياسات لكل جدول مساعد + ٣ على `storage.objects` للدلو.
- **جدولة:** `tasks-recurring` (٥:٠٠ بغداد) · `tasks-event-scan` (٥:٣٠ بغداد) · `tasks-daily-reminder` كما هي (٩:٠٠).

### ١١) ما حُفظ
الحالات والأولويات العربية · الـ526 مهمة بحالتها ومسؤولها ومنشئها وعميلها وفرصتها وخسارتها و`completed_at` و`updated_at` (المحفّزات معطّلة أثناء الترحيل) · مهمة الاستمارة وحارسها ومزامنتها (لم تُمسّ) · الجماعي وإعادة التواصل (نفس التوقيع) · التسليم والدمج (لا إشعار لكل مهمة) · عدّادات اللوحة (182) · مؤشر الأداء (160) · التذكير اليومي (نفس الاسم والموعد) · `mkt_tasks` و`onboarding_tasks` (باقيان).

### ١٢) ما اختُبر
| ماذا | النتيجة |
|---|---|
| `tsc --noEmit` | ✅ بلا أخطاء |
| `vitest` (المشروع كله) | ✅ 243/243 (منها 24 جديدة للمهام) |
| `next build` | ✅ نجح — عشر صفحات مهام |
| تحليل SQL بمحلّل PostgreSQL الحقيقي (libpg-query 17) | ✅ 454 جملة، 57 دالة plpgsql، 8 كتل DO — بلا خطأ صياغة |
| تتبّع يدوي للمسارات الخطرة | وجد وأصلح ٤ أخطاء قبل القاعدة: `v_top` الفارغ كان يُسقط كل الفرعية، و`is_waiting` الفارغ كان يُخفي المهام العادية من «عملي»، وقيد الكيان في الترحيل، وتجميع متداخل في التقارير |
| `tests.run_tasks_v2()` على الحيّ | ✅ **65/65** — بعد إصلاح خطأ تشغيل كشفه أول تشغيل: صفّ `task_list` كان 132 معاملاً والحدّ 100 (الهجرة 197) |
| الانحدار على الحيّ | ✅ الاستمارة 13/13 · اللوحة 15/15 · الأمان 17/17 · التكامل 6/7 (الفاشل يحتاج ورديةً و`work_shifts` فارغ — لا علاقة له بالمهام) |

### ١٣) حدود معروفة
- `assigned_to` إلزامي: لا مهام «بلا مسؤول» (طابور قسم). مرشّح «Unassigned» غير مدعوم.
- «Critical» لم تُضف: الأولويات الثلاث تقرؤها مواضع كثيرة؛ «عاجلة» + SLA تغطي الحاجة.
- `mkt_tasks` و`onboarding_tasks` لم يُرحَّلا (فارغان): التسويق انتقل للمحرّك، والتهيئة باقية بقواعدها التلقائية وتُعرض في مساحة HR. قاعدة `employee.created` مزروعة معطّلة.
- حفظ القالب من المتصفح يحذف بنوده ثم يُدرجها (ليس ذرّياً): فشلٌ بين الخطوتين يترك قالباً بلا بنود يُعاد حفظه.
- اللوحة والتقويم يعرضان أول ٢٠٠ (مع تنبيه ورابط للقائمة المرقّمة).
- ESLint غير مُعدّ في المشروع، فلم يُشغَّل.
- لم يُختبر بحسابات حقيقية لكل دور في المتصفح.

### ١٤) المرحلة التالية المقترحة
1. تطبيق 189–194 وتشغيل الاختبارات، ثم قائمة تحقق الأدوار (موظف، مشرف، مدير قسم، مدير متابعة، مدير، وسيط).
2. إسناد مدراء الأقسام في شجرة HR (`departments.manager_id` فارغ في 16 من 19 قسماً) — هو ما يفتح «مدير القسم يرى قسمه».
3. قرار المالك: تفعيل قواعد الأتمتة (الحملات، الفواتير المتأخرة)، وترحيل التهيئة إلى المحرّك.
4. إضافة `tasks_pending_approval` و`tasks_due_soon` إلى `dashboard_my_summary` (182) حين يُعاد فتح ملف اللوحة.

### ترتيب الهجرات والنشر والرجوع
1. **تجربة بلا أثر:** الصق ملف التجربة (كل الهجرات + كتلة تُلغي كل شيء وتعرض النتائج) في SQL Editor.
2. **التطبيق:** الصق 189 → 190 → 191 → 192 → 193 → 194 (أو الملف المجمّع؛ أي خطأ يُلغي الكل لأنه معاملة واحدة).
3. `select * from tests.run_tasks_v2();` ثم `tests.run_lost_analysis_tasks()` · `tests.run_dashboard()` · `tests.run_security()` · `select * from security_audit();`.
4. **بعدها فقط** ادفع الواجهة.
5. **الرجوع:** `git revert` للواجهة، ثم `sql/rollback_task_v2.sql` (يعيد السلوك القديم حرفياً، ولا يحذف بيانات).
