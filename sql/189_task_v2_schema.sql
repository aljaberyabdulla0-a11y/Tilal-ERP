-- ============================================================
-- تلال ERP — 189: محرّك العمل V2 — المخطّط (الجداول والأعمدة والقيود)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم 190 ← 191 ← 192 ← 193 ← 194 بالترتيب، ثم:
--   select * from tests.run_tasks_v2();
--
-- المعمارية: docs/TASK_SYSTEM_V2_ARCHITECTURE.md
--
-- ===== المبدأ =====
-- tasks يبقى المحرّك الواحد. هذا الملف **يضيف** فقط:
--   • قوائم مرجعية: المصادر، الأنواع، مساحات العمل، أنواع الكيانات.
--   • إعداد المهام لكل قسم (الأقسام نفسها من شجرة HR في 145).
--   • أعمدة اختيارية على tasks — لا عمود يُحذف ولا يُعاد تسميته.
--   • جداول مساعدة: تعليقات، مرفقات، قائمة تحقق، سجلّ، متابِعون،
--     تبعيات، وسوم، عروض محفوظة، مسارات، قوالب، تكرار، أتمتة.
--   • دلو خاص task-attachments.
--
-- ===== ما لا يتغيّر =====
--   الحالات الأربع (جديدة · قيد التنفيذ · منجزة · ملغاة) والأولويات
--   الثلاث: يقرؤها ١٥ موضعاً حرفياً. التفصيل يأتي من خطوة المسار.
--
-- ===== الترحيل =====
--   المهام القائمة (526) تُصنَّف بلا لمس الحالة أو المسؤول أو التواريخ:
--   المحفّزات تُعطَّل أثناء الترحيل كي لا يتغيّر updated_at ولا يُرسل
--   إشعار.
--
-- الجداول الجديدة تُفعَّل عليها RLS هنا بلا سياسات (مغلقة) — سياساتها
-- في 190. يتطلب: 031، 072، 145، 146، 175. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) القوائم المرجعية
-- ------------------------------------------------------------

-- مصدر المهمة: من أين جاءت (لا نصوص حرّة)
create table if not exists public.task_sources (
  code       text primary key check (code ~ '^[a-z][a-z_]*$'),
  name_ar    text not null,
  sort_order int  not null default 100
);
comment on table public.task_sources is 'مصادر المهام (189): يدوية، نظام، CRM، تسويق… القيمة في tasks.task_source.';

insert into public.task_sources (code, name_ar, sort_order) values
  ('manual',      'يدوية',          1),
  ('system',      'النظام',         2),
  ('crm',         'CRM',            3),
  ('sales',       'المبيعات',       4),
  ('marketing',   'التسويق',        5),
  ('hr',          'الموارد البشرية', 6),
  ('accounting',  'المحاسبة',       7),
  ('projects',    'المشاريع',       8),
  ('workflow',    'مسار عمل',       9),
  ('recurring',   'متكررة',        10),
  ('automation',  'أتمتة',         11),
  ('integration', 'تكامل',         12)
on conflict (code) do update set name_ar = excluded.name_ar, sort_order = excluded.sort_order;

-- مساحات العمل: كل قسم يُعرض بتخطيط مساحته (مبيعات، تسويق…).
-- «layout» مفتاح التخطيط في الواجهة؛ مساحة جديدة بتخطيط generic لا
-- تحتاج كوداً.
create table if not exists public.task_workspaces (
  code       text primary key check (code ~ '^[a-z][a-z_]*$'),
  name_ar    text not null,
  icon       text not null default 'task_alt',
  layout     text not null default 'generic'
             check (layout in ('sales', 'marketing', 'hr', 'accounting', 'projects', 'generic')),
  is_active  boolean not null default true,
  sort_order int not null default 100
);
comment on table public.task_workspaces is 'مساحات العمل (189). layout يختار تخطيط الواجهة؛ generic لأي قسم جديد.';

insert into public.task_workspaces (code, name_ar, icon, layout, sort_order) values
  ('sales',      'المبيعات',         'point_of_sale',          'sales',      1),
  ('marketing',  'التسويق',          'campaign',               'marketing',  2),
  ('hr',         'الموارد البشرية',   'badge',                  'hr',         3),
  ('accounting', 'المحاسبة',          'account_balance_wallet', 'accounting', 4),
  ('projects',   'المشاريع',          'foundation',             'projects',   5),
  ('operations', 'العمليات',          'settings_suggest',       'generic',    6),
  ('admin',      'الشؤون الإدارية',   'inventory_2',            'generic',    7),
  ('management', 'الإدارة العليا',    'monitoring',             'generic',    8),
  ('general',    'عام',               'task_alt',               'generic',    9)
on conflict (code) do update
  set name_ar = excluded.name_ar, icon = excluded.icon, layout = excluded.layout, sort_order = excluded.sort_order;

-- أنواع المهام — قابلة للإضافة من الإعدادات
create table if not exists public.task_types (
  code                   text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar                text not null,
  workspace              text references public.task_workspaces(code) on update cascade,  -- null = لكل المساحات
  icon                   text not null default 'task_alt',
  default_priority       text not null default 'عادية' check (default_priority in ('عاجلة', 'متوسطة', 'عادية')),
  default_minutes        int  check (default_minutes is null or default_minutes > 0),
  sla_hours              int  check (sla_hours is null or sla_hours > 0),
  requires_cancel_reason boolean not null default false,
  requires_approval      boolean not null default false,
  is_system              boolean not null default false,   -- لا يُختار يدوياً (استمارة الخسارة، النظام)
  is_active              boolean not null default true,
  sort_order             int not null default 100,
  created_at             timestamptz not null default now()
);
comment on table public.task_types is 'أنواع المهام (189). is_system = يُنشئه النظام وحده. sla_hours يملأ tasks.deadline_at.';

insert into public.task_types (code, name_ar, workspace, icon, default_priority, is_system, requires_approval, sort_order) values
  ('general',             'عامة',               null,         'task_alt',            'عادية',  false, false,  1),
  ('follow_up',           'متابعة',             'sales',      'event_repeat',        'متوسطة', false, false, 10),
  ('call',                'مكالمة',             'sales',      'call',                'متوسطة', false, false, 11),
  ('meeting',             'اجتماع',             null,         'groups',              'متوسطة', false, false, 12),
  ('visit',               'زيارة',              'sales',      'directions_walk',     'متوسطة', false, false, 13),
  ('reservation',         'حجز',                'sales',      'real_estate_agent',   'عاجلة',  false, false, 14),
  ('pending_action',      'إجراء معلّق',         'sales',      'pending_actions',     'متوسطة', false, false, 15),
  ('lost_analysis',       'استمارة فشل البيع',   'sales',      'heart_broken',        'متوسطة', true,  false, 16),
  ('content',             'محتوى',              'marketing',  'article',             'عادية',  false, false, 20),
  ('design',              'تصميم',              'marketing',  'palette',             'عادية',  false, false, 21),
  ('video',               'فيديو',              'marketing',  'videocam',            'عادية',  false, false, 22),
  ('photography',         'تصوير',              'marketing',  'photo_camera',        'عادية',  false, false, 23),
  ('copywriting',         'كتابة',              'marketing',  'edit_note',           'عادية',  false, false, 24),
  ('publishing',          'نشر',                'marketing',  'publish',             'متوسطة', false, false, 25),
  ('media_buying',        'شراء إعلانات',        'marketing',  'ads_click',           'متوسطة', false, false, 26),
  ('influencer',          'مؤثرون',             'marketing',  'star',                'عادية',  false, false, 27),
  ('campaign',            'حملة',               'marketing',  'flag',                'متوسطة', false, false, 28),
  ('event',               'فعالية',             'marketing',  'celebration',         'متوسطة', false, false, 29),
  ('offline_marketing',   'تسويق ميداني',        'marketing',  'storefront',          'عادية',  false, false, 30),
  ('digital_marketing',   'تسويق رقمي',          'marketing',  'language',            'عادية',  false, false, 31),
  ('approval',            'موافقة',             null,         'verified',            'متوسطة', false, true,  40),
  ('reporting',           'تقرير',              null,         'summarize',           'عادية',  false, false, 41),
  ('onboarding',          'تهيئة',              'hr',         'person_add',          'متوسطة', false, false, 50),
  ('documents',           'مستندات',            'hr',         'folder_open',         'عادية',  false, false, 51),
  ('contract',            'عقد',                'hr',         'contract',            'متوسطة', false, false, 52),
  ('evaluation',          'تقييم',              'hr',         'grading',             'عادية',  false, false, 53),
  ('training',            'تدريب',              'hr',         'school',              'عادية',  false, false, 54),
  ('attendance_followup', 'متابعة دوام',         'hr',         'schedule',            'عادية',  false, false, 55),
  ('performance_review',  'مراجعة أداء',         'hr',         'insights',            'متوسطة', false, false, 56),
  ('hr_request',          'طلب موظف',           'hr',         'assignment_ind',      'متوسطة', false, false, 57),
  ('offboarding',         'إنهاء خدمة',          'hr',         'person_remove',       'متوسطة', false, false, 58),
  ('invoice_review',      'مراجعة فاتورة',       'accounting', 'receipt_long',        'متوسطة', false, false, 60),
  ('payment_followup',    'متابعة دفعة',         'accounting', 'payments',            'متوسطة', false, false, 61),
  ('collection',          'تحصيل',              'accounting', 'request_quote',       'عاجلة',  false, false, 62),
  ('bank_reconciliation', 'تسوية بنكية',         'accounting', 'account_balance',     'عادية',  false, false, 63),
  ('expense_approval',    'اعتماد مصروف',        'accounting', 'price_check',         'متوسطة', false, true,  64),
  ('payment_request',     'طلب دفع',            'accounting', 'outbox',              'متوسطة', false, false, 65),
  ('financial_report',    'تقرير مالي',          'accounting', 'bar_chart',           'عادية',  false, false, 66),
  ('monthly_closing',     'إقفال شهري',          'accounting', 'lock_clock',          'متوسطة', false, false, 67),
  ('project',             'مشروع',              'projects',   'foundation',          'عادية',  false, false, 70),
  ('milestone',           'مرحلة',              'projects',   'flag_circle',         'متوسطة', false, false, 71),
  ('administrative',      'إداري',              'admin',      'description',         'عادية',  false, false, 80),
  ('system',              'نظام',               null,         'settings',            'عادية',  true,  false, 90)
on conflict (code) do update
  set name_ar = excluded.name_ar, workspace = excluded.workspace, icon = excluded.icon,
      is_system = excluded.is_system, sort_order = excluded.sort_order;

-- إلزام سبب الإلغاء للأنواع التي يُسأل فيها «لماذا أُلغيت؟»
update public.task_types set requires_cancel_reason = true
 where code in ('approval', 'contract', 'offboarding', 'onboarding', 'collection', 'expense_approval',
                'monthly_closing', 'campaign', 'milestone', 'payment_request')
   and not requires_cancel_reason;

-- أنواع الكيانات التي تُربط بها مهمة
create table if not exists public.task_entity_types (
  code         text primary key check (code ~ '^[a-z][a-z_]*$'),
  name_ar      text not null,
  table_name   text not null,
  url_template text,           -- {id} يُستبدل بالمعرّف؛ null = لا صفحة تفاصيل
  sort_order   int not null default 100
);
comment on table public.task_entity_types is 'الكيانات القابلة للربط بمهمة (189). table_name للتحقق من الوجود في task_save.';

insert into public.task_entity_types (code, name_ar, table_name, url_template, sort_order) values
  ('client',            'العميل',            'clients',             '/dashboard/clients/{id}',             1),
  ('opportunity',       'الفرصة',            'opportunities',       '/dashboard/crm/opportunities/{id}',   2),
  ('reservation',       'الحجز',             'reservations',        '/dashboard/reservations/{id}',        3),
  ('unit',              'الوحدة',            'units',               '/dashboard/units/{id}',               4),
  ('project',           'المشروع',           'projects',            '/dashboard/projects/{id}',            5),
  ('broker_company',    'الشركة الوسيطة',     'broker_companies',    '/dashboard/brokers/{id}',             6),
  ('lost_sale',         'خسارة بيع',          'crm_lost_sales',      null,                                  7),
  ('campaign',          'الحملة',            'crm_campaigns',       '/dashboard/marketing/campaigns/{id}', 10),
  ('content',           'المحتوى',           'mkt_content',         '/dashboard/marketing/content/{id}',   11),
  ('employee',          'الموظف',            'employees',           '/dashboard/hr/employees/{id}',        20),
  ('approval_request',  'طلب موافقة',         'approval_requests',   null,                                  21),
  ('employee_expense',  'مصروف موظف',         'employee_expenses',   null,                                  22),
  ('termination',       'إنهاء خدمة',          'termination_requests', null,                                 23),
  ('invoice',           'الفاتورة',          'invoices',            '/dashboard/invoices/{id}',            30),
  ('developer_invoice', 'فاتورة المطوّر',      'developer_invoices',  '/dashboard/developer-invoices/{id}',  31),
  ('payment',           'الدفعة',            'payments',            null,                                  32),
  ('supplier',          'المورّد',           'suppliers',           null,                                  33),
  ('lease_contract',    'عقد إيجار',          'lease_contracts',     null,                                  34)
on conflict (code) do update
  set name_ar = excluded.name_ar, table_name = excluded.table_name,
      url_template = excluded.url_template, sort_order = excluded.sort_order;

-- ------------------------------------------------------------
-- 2) المسارات والقوالب والتكرار والأتمتة (البنية — المنطق في 192)
--    تُنشأ هنا لأن tasks يشير إليها بمفاتيح.
-- ------------------------------------------------------------
create table if not exists public.task_workflows (
  id           uuid primary key default gen_random_uuid(),
  code         text unique check (code is null or code ~ '^[a-z][a-z0-9_]*$'),
  name_ar      text not null,
  workspace    text references public.task_workspaces(code) on update cascade,
  department_id uuid references public.departments(id) on delete set null,
  description  text,
  is_active    boolean not null default true,
  is_system    boolean not null default false,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.task_workflows is 'مسارات العمل (189): خطوات تفصيلية فوق الحالة العامة الأربع.';

create table if not exists public.task_workflow_steps (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.task_workflows(id) on delete cascade,
  code        text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar     text not null,
  position    int  not null check (position >= 0),
  status_map  text not null check (status_map in ('جديدة', 'قيد التنفيذ', 'منجزة', 'ملغاة')),
  is_approval boolean not null default false,   -- الدخول إليها يطلب موافقة
  color       text not null default 'gray',
  unique (workflow_id, code),
  unique (workflow_id, position)
);
comment on table public.task_workflow_steps is 'خطوة المسار تحدّد الحالة العامة (status_map) فلا تتعارضان.';
create index if not exists task_workflow_steps_wf_idx on public.task_workflow_steps (workflow_id, position);

create table if not exists public.task_templates (
  id                uuid primary key default gen_random_uuid(),
  code              text unique check (code is null or code ~ '^[a-z][a-z0-9_]*$'),
  name_ar           text not null,
  description       text,
  workspace         text references public.task_workspaces(code) on update cascade,
  department_id     uuid references public.departments(id) on delete set null,
  task_type         text not null default 'general' references public.task_types(code) on update cascade,
  default_priority  text not null default 'عادية' check (default_priority in ('عاجلة', 'متوسطة', 'عادية')),
  estimated_minutes int  check (estimated_minutes is null or estimated_minutes > 0),
  due_offset_days   int  not null default 0 check (due_offset_days between 0 and 365),
  workflow_id       uuid references public.task_workflows(id) on delete set null,
  checklist         text[] not null default '{}',
  assign_rule       jsonb not null default '{"kind": "creator"}'::jsonb check (jsonb_typeof(assign_rule) = 'object'),
  requires_approval boolean not null default false,
  is_active         boolean not null default true,
  is_system         boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.task_templates is 'قالب مهمة (189): مهمة رئيسية + بنود فرعية بإزاحة أيام وتبعيات.';

create table if not exists public.task_template_items (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.task_templates(id) on delete cascade,
  position            int  not null check (position >= 1),
  title               text not null check (length(btrim(title)) > 0),
  description         text,
  task_type           text references public.task_types(code) on update cascade,
  priority            text check (priority is null or priority in ('عاجلة', 'متوسطة', 'عادية')),
  offset_days         int  not null default 0 check (offset_days between 0 and 365),
  estimated_minutes   int  check (estimated_minutes is null or estimated_minutes > 0),
  assign_rule         jsonb check (assign_rule is null or jsonb_typeof(assign_rule) = 'object'),
  checklist           text[] not null default '{}',
  depends_on_position int  check (depends_on_position is null or depends_on_position >= 1),
  requires_approval   boolean not null default false,
  workflow_step_code  text,
  unique (template_id, position),
  check (depends_on_position is null or depends_on_position <> position)
);
create index if not exists task_template_items_tpl_idx on public.task_template_items (template_id, position);

create table if not exists public.task_recurrences (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) > 0),
  description     text,
  template_id     uuid references public.task_templates(id) on delete set null,
  department_id   uuid references public.departments(id) on delete set null,
  task_type       text not null default 'general' references public.task_types(code) on update cascade,
  priority        text not null default 'عادية' check (priority in ('عاجلة', 'متوسطة', 'عادية')),
  assigned_to     uuid,
  assign_rule     jsonb check (assign_rule is null or jsonb_typeof(assign_rule) = 'object'),
  project_id      uuid references public.projects(id) on delete set null,
  campaign_id     uuid references public.crm_campaigns(id) on delete set null,
  frequency       text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly', 'custom_days')),
  interval_n      int  not null default 1 check (interval_n between 1 and 365),
  weekdays        int[] check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]),  -- 0 = الأحد
  month_day       int  check (month_day is null or month_day between 1 and 31),
  start_on        date not null,
  end_on          date,
  due_offset_days int  not null default 0 check (due_offset_days between 0 and 90),
  next_run_on     date,
  last_run_on     date,
  is_active       boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_on is null or end_on >= start_on),
  check (assigned_to is not null or assign_rule is not null)
);
comment on table public.task_recurrences is 'مهام متكررة (189). المولّد في 192 يومياً؛ (recurrence_id, recurrence_date) فريد على tasks.';
create index if not exists task_recurrences_due_idx on public.task_recurrences (next_run_on) where is_active;

create table if not exists public.task_automation_rules (
  id          uuid primary key default gen_random_uuid(),
  code        text unique check (code is null or code ~ '^[a-z][a-z0-9_]*$'),
  name_ar     text not null,
  event       text not null check (event ~ '^[a-z_]+\.[a-z_]+$'),   -- employee.created، campaign.created، invoice.overdue…
  conditions  jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  assign_rule jsonb check (assign_rule is null or jsonb_typeof(assign_rule) = 'object'),
  is_active   boolean not null default false,
  description text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.task_automation_rules is 'حدث → قاعدة → قالب (189). تُزرع معطّلة؛ المدير يفعّلها.';

create table if not exists public.task_automation_runs (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid not null references public.task_automation_rules(id) on delete cascade,
  event_key   text not null,
  entity_type text,
  entity_id   uuid,
  task_id     uuid,
  status      text not null default 'ok' check (status in ('ok', 'skipped', 'error')),
  error       text,
  created_at  timestamptz not null default now(),
  unique (rule_id, event_key)
);
comment on table public.task_automation_runs is 'تشغيل واحد لكل (قاعدة، مفتاح حدث) — إعادة المحاولة لا تكرّر المهام.';

create table if not exists public.task_assign_cursor (
  key        text primary key,
  last_user  uuid,
  updated_at timestamptz not null default now()
);
comment on table public.task_assign_cursor is 'حالة التوزيع الدوري (round robin) لكل قاعدة إسناد.';

-- إعداد المهام لكل قسم — القسم نفسه من 145
create table if not exists public.department_task_settings (
  department_id          uuid primary key references public.departments(id) on delete cascade,
  workspace              text not null default 'general' references public.task_workspaces(code) on update cascade,
  due_soon_hours         int  not null default 24 check (due_soon_hours between 1 and 720),
  requires_cancel_reason boolean not null default false,
  default_workflow_id    uuid references public.task_workflows(id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);
comment on table public.department_task_settings is 'المساحة و«قريبة الموعد» وسبب الإلغاء لكل قسم (189). الفرع يرث من أبيه إن لم يكن له صفّ.';

-- البذور بالرمز لا بالمعرّف: الأقسام الرئيسية وفروعها
insert into public.department_task_settings (department_id, workspace, requires_cancel_reason)
select d.id,
       case
         when d.code in ('SALES', 'CRM', 'BRK') or d.code like 'SALES-%' then 'sales'
         when d.code = 'MKT' or d.code like 'MKT-%' then 'marketing'
         when d.code = 'HR' or d.code like 'HR-%'   then 'hr'
         when d.code = 'FIN' or d.code like 'FIN-%' then 'accounting'
         when d.code = 'OPS'   then 'operations'
         when d.code = 'ADMIN' then 'admin'
         when d.code = 'EXEC'  then 'management'
       end,
       d.code in ('HR', 'FIN') or d.code like 'HR-%' or d.code like 'FIN-%'
  from public.departments d
 where d.code in ('SALES', 'CRM', 'BRK', 'MKT', 'HR', 'FIN', 'OPS', 'ADMIN', 'EXEC')
    or d.code like 'SALES-%' or d.code like 'MKT-%' or d.code like 'HR-%' or d.code like 'FIN-%'
on conflict (department_id) do nothing;

-- ------------------------------------------------------------
-- 3) الأعمدة الجديدة على tasks — كلها اختيارية أو بقيمة افتراضية
-- ------------------------------------------------------------
alter table public.tasks
  add column if not exists department_id         uuid references public.departments(id) on delete set null,
  add column if not exists task_type             text not null default 'general' references public.task_types(code) on update cascade,
  add column if not exists task_source           text not null default 'manual' references public.task_sources(code) on update cascade,
  add column if not exists created_source        text,
  add column if not exists entity_type           text references public.task_entity_types(code) on update cascade,
  add column if not exists entity_id             uuid,
  add column if not exists project_id            uuid references public.projects(id) on delete set null,
  add column if not exists campaign_id           uuid references public.crm_campaigns(id) on delete set null,
  add column if not exists parent_task_id        uuid references public.tasks(id) on delete set null,
  add column if not exists template_id           uuid references public.task_templates(id) on delete set null,
  add column if not exists workflow_id           uuid references public.task_workflows(id) on delete set null,
  add column if not exists workflow_step_id      uuid references public.task_workflow_steps(id) on delete set null,
  add column if not exists recurrence_id         uuid references public.task_recurrences(id) on delete set null,
  add column if not exists recurrence_date       date,
  add column if not exists estimated_minutes     int,
  add column if not exists actual_minutes        int,
  add column if not exists start_date            date,
  add column if not exists started_at            timestamptz,
  add column if not exists deadline_at           timestamptz,
  add column if not exists completed_by          uuid,
  add column if not exists cancelled_by          uuid,
  add column if not exists cancelled_at          timestamptz,
  add column if not exists cancellation_reason   text,
  add column if not exists blocked_reason        text,
  add column if not exists requires_approval     boolean not null default false,
  add column if not exists approval_status       text,
  add column if not exists approver_id           uuid,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_by           uuid,
  add column if not exists approved_at           timestamptz,
  add column if not exists rejection_reason      text,
  add column if not exists archived_at           timestamptz,
  add column if not exists archived_by           uuid,
  add column if not exists version               int not null default 1;

-- مهمة بلا موعد («بدون موعد» في التسويق والأفكار). الافتراضي يبقى
-- اليوم، فكل إدراج قديم لا يتأثر.
alter table public.tasks alter column due_date drop not null;

comment on column public.tasks.department_id    is 'القسم (departments، 145). يُشتقّ من قسم المسؤول إن لم يُحدَّد (191).';
comment on column public.tasks.task_type        is 'task_types.code — الافتراضي general.';
comment on column public.tasks.task_source      is 'task_sources.code — من أين جاءت. المتصفح لا يكتب إلا manual (190).';
comment on column public.tasks.created_source   is 'قناة الإنشاء: quick_add · form · bulk · subtask · template · recurrence · automation · trigger · duplicate · legacy.';
comment on column public.tasks.entity_type      is 'نوع الكيان المرتبط (task_entity_types). client_id/opportunity_id يبقيان للتوافق ويُملآن منه.';
comment on column public.tasks.workflow_step_id is 'الخطوة التفصيلية؛ status_map فيها يحدّد الحالة العامة.';
comment on column public.tasks.version          is 'يزيد مع كل تحديث (191). إرسال إصدار أقدم يُرفض: «عُدّلت المهمة بعد فتحها».';
comment on column public.tasks.archived_at      is 'للمغلقة فقط (قيد). الأرشفة لا تُخفي متأخرة.';

-- ------------------------------------------------------------
-- 4) القيود — تُضاف بعد التأكد أن البيانات تحقّقها
-- ------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_entity_pair_chk;
alter table public.tasks add constraint tasks_entity_pair_chk
  check ((entity_type is null) = (entity_id is null));

alter table public.tasks drop constraint if exists tasks_not_own_parent_chk;
alter table public.tasks add constraint tasks_not_own_parent_chk
  check (parent_task_id is null or parent_task_id <> id);

alter table public.tasks drop constraint if exists tasks_minutes_chk;
alter table public.tasks add constraint tasks_minutes_chk
  check (coalesce(estimated_minutes, 0) >= 0 and coalesce(actual_minutes, 0) >= 0
         and coalesce(estimated_minutes, 0) <= 100000 and coalesce(actual_minutes, 0) <= 100000);

alter table public.tasks drop constraint if exists tasks_completed_chk;
alter table public.tasks add constraint tasks_completed_chk
  check ((status = 'منجزة') = (completed_at is not null));

alter table public.tasks drop constraint if exists tasks_cancelled_chk;
alter table public.tasks add constraint tasks_cancelled_chk
  check (status = 'ملغاة' or (cancelled_at is null and cancelled_by is null and cancellation_reason is null));

alter table public.tasks drop constraint if exists tasks_archived_chk;
alter table public.tasks add constraint tasks_archived_chk
  check (archived_at is null or status in ('منجزة', 'ملغاة'));

alter table public.tasks drop constraint if exists tasks_approval_chk;
alter table public.tasks add constraint tasks_approval_chk
  check (approval_status is null
         or (requires_approval and approval_status in ('بانتظار الموافقة', 'معتمدة', 'مرفوضة')));

alter table public.tasks drop constraint if exists tasks_created_source_chk;
alter table public.tasks add constraint tasks_created_source_chk
  check (created_source is null or created_source in
         ('quick_add', 'form', 'bulk', 'subtask', 'template', 'recurrence', 'automation', 'trigger', 'duplicate', 'legacy'));

alter table public.tasks drop constraint if exists tasks_version_chk;
alter table public.tasks add constraint tasks_version_chk check (version >= 1);

alter table public.tasks drop constraint if exists tasks_recurrence_pair_chk;
alter table public.tasks add constraint tasks_recurrence_pair_chk
  check ((recurrence_id is null) = (recurrence_date is null));

-- ------------------------------------------------------------
-- 5) الفهارس — لكل مرشّح في القائمة فهرس
-- ------------------------------------------------------------
create index if not exists tasks_assignee_status_due_idx on public.tasks (assigned_to, status, due_date);
create index if not exists tasks_dept_status_due_idx     on public.tasks (department_id, status, due_date) where department_id is not null;
create index if not exists tasks_creator_idx             on public.tasks (created_by, status);
create index if not exists tasks_type_idx                on public.tasks (task_type, status);
create index if not exists tasks_source_idx              on public.tasks (task_source, created_at);
create index if not exists tasks_entity_idx              on public.tasks (entity_type, entity_id) where entity_id is not null;
create index if not exists tasks_project_idx             on public.tasks (project_id) where project_id is not null;
create index if not exists tasks_campaign_idx            on public.tasks (campaign_id) where campaign_id is not null;
create index if not exists tasks_parent_idx              on public.tasks (parent_task_id) where parent_task_id is not null;
create index if not exists tasks_approver_pending_idx    on public.tasks (approver_id) where approval_status = 'بانتظار الموافقة';
create index if not exists tasks_completed_at_idx        on public.tasks (completed_at) where completed_at is not null;
create index if not exists tasks_title_trgm_idx          on public.tasks using gin (title gin_trgm_ops);
create unique index if not exists tasks_recurrence_once_uq on public.tasks (recurrence_id, recurrence_date)
  where recurrence_id is not null;

-- ------------------------------------------------------------
-- 6) الجداول المساعدة
-- ------------------------------------------------------------
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid not null default auth.uid(),
  author_name text,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
comment on table public.task_comments is 'محادثة المهمة (189). الحذف ناعم؛ الكاتب وحده يعدّل نصّه.';

create table if not exists public.task_attachments (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks(id) on delete cascade,
  storage_path     text not null unique,     -- {task_id}/{uuid}-{اسم}
  file_name        text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes between 0 and 26214400),
  uploaded_by      uuid not null default auth.uid(),
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  check (split_part(storage_path, '/', 1) = task_id::text)
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id) where deleted_at is null;
comment on table public.task_attachments is 'مرفقات المهمة في الدلو الخاص task-attachments (189). المسار يبدأ بمعرّف المهمة.';

create table if not exists public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 500),
  position   int  not null default 0,
  is_done    boolean not null default false,
  done_by    uuid,
  done_at    timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (is_done = (done_at is not null))
);
create index if not exists task_checklist_task_idx on public.task_checklist_items (task_id, position);

create table if not exists public.task_activity_log (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  action     text not null check (action in (
               'created', 'assigned', 'reassigned', 'status_changed', 'started', 'completed', 'cancelled',
               'restored', 'priority_changed', 'due_date_changed', 'department_changed', 'edited',
               'comment_added', 'attachment_added', 'attachment_removed', 'checklist_changed',
               'approval_requested', 'approved', 'rejected', 'workflow_step_changed',
               'dependency_added', 'dependency_removed', 'watcher_added', 'watcher_removed',
               'subtask_added', 'archived', 'unarchived', 'label_changed')),
  field      text,
  old_value  text,
  new_value  text,
  note       text,
  actor      uuid,
  actor_name text,
  at         timestamptz not null default now()
);
create index if not exists task_activity_task_idx on public.task_activity_log (task_id, at desc);
comment on table public.task_activity_log is 'سجلّ نشاط المهمة (189): من، ماذا، متى، قبل، بعد. لا يُكتب إلا من المحفّزات (191).';

create table if not exists public.task_watchers (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null,
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_watchers_user_idx on public.task_watchers (user_id);

create table if not exists public.task_dependencies (
  task_id       uuid not null references public.tasks(id) on delete cascade,
  depends_on_id uuid not null references public.tasks(id) on delete cascade,
  is_blocking   boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index if not exists task_dependencies_on_idx on public.task_dependencies (depends_on_id);
comment on table public.task_dependencies is 'task_id تعتمد على depends_on_id. is_blocking: لا تُنجز قبلها (191). الدوائر ممنوعة.';

create table if not exists public.task_labels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 40),
  color         text not null default 'gray'
                check (color in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink')),
  department_id uuid references public.departments(id) on delete cascade,
  is_active     boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index if not exists task_labels_name_uq
  on public.task_labels (lower(btrim(name)), coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.task_label_links (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.task_labels(id) on delete cascade,
  primary key (task_id, label_id)
);
create index if not exists task_label_links_label_idx on public.task_label_links (label_id);

create table if not exists public.task_saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  view       text not null default 'list' check (view in ('list', 'board', 'calendar')),
  filters    jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- وسوم أولية عامة
insert into public.task_labels (name, color)
select v.name, v.color
  from (values ('عاجل', 'red'), ('عميل', 'blue'), ('حملة', 'purple'), ('قانوني', 'indigo'),
               ('مالي', 'green'), ('VIP', 'amber')) v(name, color)
 where not exists (select 1 from public.task_labels l
                    where lower(l.name) = lower(v.name) and l.department_id is null);

-- RLS مغلقة حتى 190 — لا جدول في public بلا RLS (security_audit)
alter table public.task_sources             enable row level security;
alter table public.task_workspaces          enable row level security;
alter table public.task_types               enable row level security;
alter table public.task_entity_types        enable row level security;
alter table public.task_workflows           enable row level security;
alter table public.task_workflow_steps      enable row level security;
alter table public.task_templates           enable row level security;
alter table public.task_template_items      enable row level security;
alter table public.task_recurrences         enable row level security;
alter table public.task_automation_rules    enable row level security;
alter table public.task_automation_runs     enable row level security;
alter table public.task_assign_cursor       enable row level security;
alter table public.department_task_settings enable row level security;
alter table public.task_comments            enable row level security;
alter table public.task_attachments         enable row level security;
alter table public.task_checklist_items     enable row level security;
alter table public.task_activity_log        enable row level security;
alter table public.task_watchers            enable row level security;
alter table public.task_dependencies        enable row level security;
alter table public.task_labels              enable row level security;
alter table public.task_label_links         enable row level security;
alter table public.task_saved_views         enable row level security;

-- لا صلاحية لـ anon على أي جدول جديد (173)، ولا TRUNCATE لأحد
do $$
declare t text;
begin
  foreach t in array array['task_sources', 'task_workspaces', 'task_types', 'task_entity_types', 'task_workflows',
                           'task_workflow_steps', 'task_templates', 'task_template_items', 'task_recurrences',
                           'task_automation_rules', 'task_automation_runs', 'task_assign_cursor',
                           'department_task_settings', 'task_comments', 'task_attachments', 'task_checklist_items',
                           'task_activity_log', 'task_watchers', 'task_dependencies', 'task_labels',
                           'task_label_links', 'task_saved_views'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
  end loop;
end $$;

-- السجلّ والتشغيلات والمؤشر: قراءة فقط من المتصفح (الكتابة من المحفّزات والدوال)
revoke insert, update, delete on public.task_activity_log    from authenticated;
revoke insert, update, delete on public.task_automation_runs from authenticated;
revoke insert, update, delete on public.task_assign_cursor   from authenticated;

-- ------------------------------------------------------------
-- 7) الدلو الخاص للمرفقات — سياساته في 190
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
              'video/mp4', 'video/quicktime', 'video/webm',
              'application/pdf', 'text/plain', 'text/csv',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/zip'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 8) الترحيل — تصنيف المهام القائمة بلا لمس تاريخها
--
-- المحفّزات تُعطَّل في هذه المعاملة وحدها: لا updated_at جديد، لا
-- إشعار، لا حارس. ولا تُمسّ: الحالة، الأولوية، المسؤول، المنشئ،
-- العميل، الفرصة، الخسارة، completed_at.
-- ------------------------------------------------------------
alter table public.tasks disable trigger user;

-- مهامّ الاستمارة (175): CRM، مرتبطة بالفرصة
update public.tasks t
   set task_type = 'lost_analysis', task_source = 'crm', created_source = 'trigger',
       entity_type = case when t.opportunity_id is not null then 'opportunity' end,
       entity_id = t.opportunity_id
 where t.analysis_lost_sale_id is not null
   and t.task_type = 'general' and t.created_source is null;

-- إعادة التواصل مع فرصة خاسرة (140)
update public.tasks t
   set task_type = 'follow_up', task_source = 'crm', created_source = 'trigger',
       entity_type = coalesce(t.entity_type, 'opportunity'), entity_id = coalesce(t.entity_id, t.opportunity_id)
 where t.analysis_lost_sale_id is null and t.opportunity_id is not null
   and t.title like 'إعادة تواصل — فرصة خاسرة:%'
   and t.task_type = 'general' and t.created_source is null;

-- الإجراء الجماعي (085)
update public.tasks t
   set task_type = 'follow_up', task_source = 'crm', created_source = 'bulk',
       entity_type = case when t.client_id is not null then 'client' end,
       entity_id = t.client_id
 where t.description like 'أُنشئت ضمن إجراء جماعي%'
   and t.task_type = 'general' and t.created_source is null;

-- الباقي: النظام إن لم يكن له منشئ، ويُربط بعميله أو فرصته
update public.tasks t
   set task_source = case when t.created_by is null then 'system' else 'manual' end,
       created_source = 'legacy',
       entity_type = case when t.opportunity_id is not null then 'opportunity'
                          when t.client_id is not null then 'client' end,
       entity_id = coalesce(t.opportunity_id, t.client_id)
 where t.created_source is null;

-- القسم من قسم المسؤول، والمشروع من الفرصة
update public.tasks t
   set department_id = e.department_id
  from public.employees e
 where e.user_id = t.assigned_to and t.department_id is null and e.department_id is not null;

update public.tasks t
   set project_id = o.project_id
  from public.opportunities o
 where o.id = t.opportunity_id and t.project_id is null and o.project_id is not null;

alter table public.tasks enable trigger user;

-- سطر «أُنشئت» في السجلّ لكل مهمة قائمة، بتاريخ إنشائها
insert into public.task_activity_log (task_id, action, new_value, actor, actor_name, at)
select t.id, 'created', t.title, t.created_by, coalesce(t.created_by_name, 'النظام'), t.created_at
  from public.tasks t
 where not exists (select 1 from public.task_activity_log a where a.task_id = t.id and a.action = 'created');

-- ------------------------------------------------------------
-- 9) تحقّق: البيانات القديمة سليمة بعد الترحيل
-- ------------------------------------------------------------
do $$
declare n_total int; n_lost int; n_lost_typed int; n_bad int;
begin
  select count(*), count(*) filter (where analysis_lost_sale_id is not null),
         count(*) filter (where analysis_lost_sale_id is not null and task_type = 'lost_analysis' and task_source = 'crm')
    into n_total, n_lost, n_lost_typed
    from public.tasks;
  select count(*) into n_bad from public.tasks
   where (status = 'منجزة') <> (completed_at is not null) or created_source is null;
  raise notice '189: % مهمة؛ استمارات % صُنِّف منها %؛ صفوف غير متّسقة: %', n_total, n_lost, n_lost_typed, n_bad;
  if n_bad > 0 or n_lost <> n_lost_typed then
    raise warning '189: راجع الترحيل — هناك صفوف لم تُصنَّف كما يجب.';
  end if;
end $$;

notify pgrst, 'reload schema';
