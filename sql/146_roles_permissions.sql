-- ============================================================
-- تلال ERP — 146: الأدوار ومصفوفة الصلاحيات (HR المؤسسي — المرحلة 1)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145.
--
-- ============================================================
-- المشكلة
--
-- الدور قيمةٌ واحدة في profiles.role عليها CHECK بعشر قيم، وعليها تُبنى
-- كل سياسات RLS (~400). فلا يُنشأ دور جديد إلا بهجرة، ولا يفرَّق بين
-- «مدير HR» و«موظف HR»، ولا يُسجَّل تغيير الدور (profiles بلا تدقيق).
--
-- ============================================================
-- المبدأ: طبقتان، والقديمة لا تُمسّ
--
--   roles.code ──base_role──► profiles.role   (المستوى الأمني — يحكم RLS القائمة)
--        │
--        └──► role_permissions (وحدة × أفعال × نطاق)  ──► has_permission()
--
-- الدور الجديد (مثلاً «موظف HR») يحمل مستوىً أمنياً من العشرة (hr)، ومنه
-- يُشتق profiles.role تلقائياً، فتراه كل سياسة قائمة كما كانت تراه.
-- والمصفوفة تحكم **الآن** الوحدات المعلَّمة enforced (الهيكل التنظيمي)،
-- وتنتقل إليها الوحدات القديمة واحدةً واحدة (المرحلة 9)، كلٌّ باختبار.
-- حتى ذلك الحين ما في المصفوفة لتلك الوحدات هو **السياسة المستهدفة**،
-- والواجهة تقولها صراحةً («غير مُطبَّق بعد»).
--
-- الأدوار العشرة الحالية تصير «أدواراً نظامية» (code = base_role) لا
-- تُحذف ولا يتغيّر مستواها. وكل حساب يُرحَّل إلى الدور النظامي المطابق
-- لدوره الحالي — **لا يتغيّر وصول أحد** بهذه الهجرة.
--
-- ⚠️ إدارة الأدوار والمصفوفة للمدير وحده (is_admin)، لا بصلاحيةٍ في
--    المصفوفة: من يمنح الصلاحيات لو مُنح ذلك بالمصفوفة لمنح نفسه المدير.
-- ============================================================


-- ============================================================
-- ١) الأدوار
-- ============================================================
create table if not exists public.roles (
  code         text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_ar      text not null check (btrim(name_ar) <> ''),
  name_en      text,
  description  text,
  base_role    text not null check (base_role in (
                 'admin', 'accountant', 'hr', 'supervisor', 'followup_manager',
                 'relationship_manager', 'broker', 'marketing', 'viewer', 'employee')),
  is_system    boolean not null default false,
  status       text not null default 'نشط' check (status in ('نشط', 'مؤرشف')),
  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  constraint roles_system_is_base check (not is_system or code = base_role)
);

comment on table public.roles is
  'الأدوار القابلة للإدارة (146). base_role = المستوى الأمني الذي تقرؤه RLS القائمة عبر profiles.role.';

insert into public.roles (code, name_ar, name_en, base_role, is_system, sort_order, description) values
  -- النظامية: الأدوار العشرة كما هي
  ('admin',                'مدير النظام',       'Super Admin',          'admin',                true,  1,  'كل شيء.'),
  ('accountant',           'محاسب',             'Accountant',           'accountant',           true,  20, 'يعتمد الكشوف ويدفع ويُرحّل — لا يُحضّر (068).'),
  ('hr',                   'موارد بشرية',       'HR',                   'hr',                   true,  10, 'يُحضّر الكشوف والدوام والإجازات — لا يعتمد (068).'),
  ('supervisor',           'مشرف',              'Supervisor',           'supervisor',           true,  40, 'يرى فريق مشروعه (037).'),
  ('followup_manager',     'مدير المتابعة',     'Follow-up Manager',    'followup_manager',     true,  50, 'المتابعة اليومية والمخزون والاستقطاعات (040–041).'),
  ('relationship_manager', 'مدير علاقات',       'Relationship Manager', 'relationship_manager', true,  60, 'شركات الوساطة في نطاقه.'),
  ('broker',               'شركة وسيطة',        'Broker',               'broker',               true,  90, 'حساب خارجي — يُضبط من صفحة الشركة لا من هنا.'),
  ('marketing',            'تسويق',             'Marketing',            'marketing',            true,  30, 'التسويق كتابةً و CRM قراءةً (084، 121).'),
  ('viewer',               'مُطالِع',           'Viewer',               'viewer',               true,  80, 'قراءة بلا كتابة.'),
  ('employee',             'موظف',              'Employee',             'employee',             true,  99, 'نفسه وعملاؤه.'),
  -- أدوار الأعمال: كلٌّ على مستوى أمني من العشرة
  ('general_manager',      'المدير العام',       'General Manager',      'admin',                false, 2,  null),
  ('hr_manager',           'مدير الموارد البشرية','HR Manager',          'hr',                   false, 11, null),
  ('hr_officer',           'موظف موارد بشرية',   'HR Officer',           'hr',                   false, 12, null),
  ('finance_manager',      'المدير المالي',      'Finance Manager',      'accountant',           false, 21, null),
  ('marketing_manager',    'مدير التسويق',       'Marketing Manager',    'marketing',            false, 31, 'لإدارة فريق التسويق يلزم أيضاً mkt_role «مدير التسويق» (121).'),
  ('marketing_employee',   'موظف تسويق',         'Marketing Employee',   'employee',             false, 32, 'يدخل قسم التسويق بعضويته في فريق التسويق (mkt_team).'),
  ('sales_manager',        'مدير المبيعات',      'Sales Manager',        'supervisor',           false, 41, null),
  ('sales_employee',       'موظف مبيعات',        'Sales Employee',       'employee',             false, 95, null),
  ('crm_manager',          'مدير CRM',           'CRM Manager',          'supervisor',           false, 42, null),
  ('crm_employee',         'موظف CRM',           'CRM Employee',         'employee',             false, 96, null),
  ('operations_manager',   'مدير العمليات',      'Operations Manager',   'followup_manager',     false, 51, null),
  ('project_manager',      'مدير مشروع',         'Project Manager',      'supervisor',           false, 43, null)
on conflict (code) do nothing;


-- ============================================================
-- ٢) الوحدات — enforced = تُفرض صلاحياتها من المصفوفة الآن
-- ============================================================
create table if not exists public.app_modules (
  code        text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_ar     text not null,
  area        text not null,
  enforced    boolean not null default false,
  sort_order  int not null default 0,
  note        text
);

insert into public.app_modules (code, name_ar, area, enforced, sort_order, note) values
  ('organization', 'الهيكل التنظيمي',      'HR',       true,  1,  'الأقسام والمناصب والفروع والدرجات (145).'),
  ('employees',    'الموظفون',             'HR',       false, 2,  null),
  ('attendance',   'الدوام',               'HR',       false, 3,  null),
  ('leaves',       'الإجازات',             'HR',       false, 4,  null),
  ('payroll',      'الرواتب والاستقطاعات', 'HR',       false, 5,  null),
  ('advances',     'السلف والقروض',        'HR',       false, 6,  null),
  ('commissions',  'العمولات',             'HR',       false, 7,  null),
  ('performance',  'الأداء والأهداف',      'HR',       false, 8,  'المرحلة 6.'),
  ('recruitment',  'التوظيف والتهيئة',     'HR',       false, 9,  'المرحلة 3.'),
  ('documents',    'مستندات الموظفين',     'HR',       false, 10, 'المرحلة 2.'),
  ('expenses',     'مصروفات الموظفين',     'HR',       false, 11, 'المرحلة 7.'),
  ('hr_reports',   'تقارير HR',            'HR',       false, 12, 'المرحلة 8.'),
  ('crm',          'العملاء والفرص',       'CRM',      false, 20, null),
  ('sales',        'الحجوزات والمبيعات',   'المبيعات', false, 21, null),
  ('brokerage',    'الوساطة',              'المبيعات', false, 22, null),
  ('projects',     'المشاريع والوحدات',    'المشاريع', false, 23, null),
  ('marketing',    'التسويق',              'التسويق',  false, 30, null),
  ('accounting',   'المحاسبة',             'المالية',  false, 40, null),
  ('inventory',    'المخزون',              'الإدارة',  false, 50, null),
  ('tasks',        'المهام',               'الإدارة',  false, 51, null)
on conflict (code) do nothing;


-- ============================================================
-- ٣) المصفوفة
-- ============================================================
create table if not exists public.role_permissions (
  role_code   text not null references public.roles(code) on update cascade on delete cascade,
  module      text not null references public.app_modules(code) on update cascade on delete cascade,
  actions     text[] not null default '{}',
  scope       text not null default 'own' check (scope in ('own', 'team', 'department', 'all')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (role_code, module),
  constraint role_permissions_actions_known check (actions <@ array[
    'create', 'read', 'update', 'delete', 'approve', 'export', 'manage',
    'view_financial', 'view_salary', 'view_personal']::text[])
);

comment on table public.role_permissions is
  'مصفوفة الصلاحيات (146): دور × وحدة ← أفعال + نطاق (own/team/department/all). '
  'تُفرض للوحدات enforced فقط؛ لغيرها هي السياسة المستهدفة.';

create or replace function public.role_permissions_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- ترتيب ثابت ولا تكرار: المصفوفة تُقارَن في الواجهة وفي السجلّ
  new.actions := array(select distinct a from unnest(new.actions) a order by a);
  return new;
end $$;

drop trigger if exists trg_role_permissions_touch on public.role_permissions;
create trigger trg_role_permissions_touch before insert or update on public.role_permissions
  for each row execute function public.role_permissions_touch();

-- البذرة: حزم صلاحيات، ثم كل دور يأخذ حزمته. حزمة «employee» قاعدةٌ لكل
-- دورٍ داخلي فيما لم تذكره حزمته (كلنا موظفون: نبصم ونطلب إجازة).
with pkg(pkg, module, actions, scope) as (values
  -- الموارد البشرية — مدير
  ('hr_mgr', 'organization', '{create,read,update,delete,export,manage}', 'all'),
  ('hr_mgr', 'employees',    '{create,read,update,delete,export,manage,view_salary,view_personal}', 'all'),
  ('hr_mgr', 'attendance',   '{create,read,update,delete,approve,export,manage}', 'all'),
  ('hr_mgr', 'leaves',       '{create,read,update,delete,approve,export,manage}', 'all'),
  ('hr_mgr', 'payroll',      '{create,read,update,delete,export,view_salary}', 'all'),
  ('hr_mgr', 'advances',     '{create,read,update,approve,export,view_salary}', 'all'),
  ('hr_mgr', 'commissions',  '{read,export,view_salary}', 'all'),
  ('hr_mgr', 'performance',  '{create,read,update,delete,approve,export,manage}', 'all'),
  ('hr_mgr', 'recruitment',  '{create,read,update,delete,approve,export,manage}', 'all'),
  ('hr_mgr', 'documents',    '{create,read,update,delete,export,manage,view_personal}', 'all'),
  ('hr_mgr', 'expenses',     '{read,export}', 'all'),
  ('hr_mgr', 'hr_reports',   '{read,export,view_salary}', 'all'),
  -- الموارد البشرية — موظف: يُدخل ولا يحذف، ولا يرى الرواتب ولا يدير الهيكل
  ('hr_off', 'organization', '{read}', 'all'),
  ('hr_off', 'employees',    '{create,read,update,export,view_personal}', 'all'),
  ('hr_off', 'attendance',   '{create,read,update,export}', 'all'),
  ('hr_off', 'leaves',       '{create,read,update,export}', 'all'),
  ('hr_off', 'payroll',      '{create,read,update}', 'all'),
  ('hr_off', 'advances',     '{create,read,update}', 'all'),
  ('hr_off', 'performance',  '{create,read,update}', 'all'),
  ('hr_off', 'recruitment',  '{create,read,update}', 'all'),
  ('hr_off', 'documents',    '{create,read,update,view_personal}', 'all'),
  ('hr_off', 'hr_reports',   '{read}', 'all'),
  -- المالية: تعتمد وتدفع ولا تُحضّر (068)، والبيانات الشخصية محدودة
  ('finance', 'organization', '{read}', 'all'),
  ('finance', 'employees',    '{read,view_salary}', 'all'),
  ('finance', 'payroll',      '{read,approve,export,view_financial,view_salary}', 'all'),
  ('finance', 'advances',     '{read,approve,export,view_financial}', 'all'),
  ('finance', 'commissions',  '{read,update,approve,export,view_financial}', 'all'),
  ('finance', 'expenses',     '{read,approve,export,view_financial}', 'all'),
  ('finance', 'accounting',   '{create,read,update,approve,export,manage,view_financial}', 'all'),
  ('finance', 'sales',        '{read,export,view_financial}', 'all'),
  ('finance', 'marketing',    '{read,view_financial}', 'all'),
  ('finance', 'hr_reports',   '{read,export,view_salary}', 'all'),
  -- المشرف ومدير المبيعات/المشروع/CRM: فريقه
  ('sup', 'organization', '{read}', 'all'),
  ('sup', 'employees',    '{read}', 'team'),
  ('sup', 'attendance',   '{read,approve}', 'team'),
  ('sup', 'leaves',       '{read,approve}', 'team'),
  ('sup', 'performance',  '{read,update}', 'team'),
  ('sup', 'crm',          '{create,read,update,export}', 'team'),
  ('sup', 'sales',        '{create,read,update}', 'team'),
  ('sup', 'brokerage',    '{read,approve}', 'team'),
  ('sup', 'projects',     '{read}', 'team'),
  ('sup', 'tasks',        '{create,read,update}', 'team'),
  -- المتابعة والعمليات
  ('followup', 'organization', '{read}', 'all'),
  ('followup', 'employees',    '{read}', 'all'),
  ('followup', 'attendance',   '{read}', 'all'),
  ('followup', 'payroll',      '{create}', 'all'),
  ('followup', 'crm',          '{read}', 'all'),
  ('followup', 'inventory',    '{create,read,update,delete,manage}', 'all'),
  ('followup', 'projects',     '{read}', 'all'),
  ('followup', 'tasks',        '{create,read,update}', 'all'),
  -- مدير العلاقات
  ('rm', 'organization', '{read}', 'all'),
  ('rm', 'brokerage',    '{read,update}', 'team'),
  ('rm', 'crm',          '{read}', 'team'),
  -- التسويق — مدير: قسمه كاملاً، بلا رواتب
  ('mkt_mgr', 'organization', '{read}', 'all'),
  ('mkt_mgr', 'marketing',    '{create,read,update,delete,approve,export,manage,view_financial}', 'department'),
  ('mkt_mgr', 'employees',    '{read}', 'department'),
  ('mkt_mgr', 'attendance',   '{read,approve}', 'department'),
  ('mkt_mgr', 'leaves',       '{read,approve}', 'department'),
  ('mkt_mgr', 'performance',  '{create,read,update}', 'department'),
  ('mkt_mgr', 'tasks',        '{create,read,update}', 'department'),
  ('mkt_mgr', 'crm',          '{read,export}', 'all'),
  -- التسويق — الدور النظامي (قراءة CRM كلّه، كتابة التسويق)
  ('mkt', 'organization', '{read}', 'all'),
  ('mkt', 'marketing',    '{create,read,update,export}', 'department'),
  ('mkt', 'crm',          '{read,export}', 'all'),
  -- التسويق — موظف
  ('mkt_emp', 'marketing',    '{create,read,update}', 'own'),
  -- المُطالِع
  ('viewer', 'organization', '{read}', 'all'),
  ('viewer', 'crm',          '{read}', 'all'),
  ('viewer', 'marketing',    '{read}', 'all'),
  ('viewer', 'projects',     '{read}', 'all'),
  -- الوسيط الخارجي: لا هيكل ولا HR
  ('broker', 'brokerage', '{create,read}', 'own'),
  ('broker', 'projects',  '{read}', 'own'),
  -- القاعدة: كل موظف داخلي
  ('employee', 'organization', '{read}', 'all'),
  ('employee', 'employees',    '{read,view_personal}', 'own'),
  ('employee', 'attendance',   '{create,read}', 'own'),
  ('employee', 'leaves',       '{create,read}', 'own'),
  ('employee', 'payroll',      '{read,view_salary}', 'own'),
  ('employee', 'advances',     '{create,read}', 'own'),
  ('employee', 'commissions',  '{read}', 'own'),
  ('employee', 'expenses',     '{create,read}', 'own'),
  ('employee', 'documents',    '{read}', 'own'),
  ('employee', 'performance',  '{read}', 'own'),
  ('employee', 'tasks',        '{create,read,update}', 'own'),
  -- المبيعات و CRM — موظف
  ('seller', 'crm',      '{create,read,update}', 'own'),
  ('seller', 'sales',    '{create,read}', 'own'),
  ('seller', 'projects', '{read}', 'own')
),
assign(role_code, pkg) as (values
  ('hr', 'hr_mgr'), ('hr_manager', 'hr_mgr'), ('hr_officer', 'hr_off'),
  ('accountant', 'finance'), ('finance_manager', 'finance'),
  ('supervisor', 'sup'), ('sales_manager', 'sup'), ('project_manager', 'sup'), ('crm_manager', 'sup'),
  ('followup_manager', 'followup'), ('operations_manager', 'followup'),
  ('relationship_manager', 'rm'),
  ('marketing_manager', 'mkt_mgr'), ('marketing', 'mkt'), ('marketing_employee', 'mkt_emp'),
  ('viewer', 'viewer'), ('broker', 'broker'),
  ('employee', 'seller'), ('sales_employee', 'seller'), ('crm_employee', 'seller')
),
rows as (
  select a.role_code, p.module, p.actions::text[] as actions, p.scope, 1 as prio
    from assign a join pkg p on p.pkg = a.pkg
  union all
  -- القاعدة لكل دور داخلي غير الوسيط والمطالِع
  select r.code, p.module, p.actions::text[], p.scope, 2
    from public.roles r join pkg p on p.pkg = 'employee'
   where r.base_role not in ('admin', 'broker', 'viewer')
  union all
  -- المدير ومن على مستواه: كل شيء
  select r.code, m.code,
         '{create,read,update,delete,approve,export,manage,view_financial,view_salary,view_personal}'::text[],
         'all', 0
    from public.roles r cross join public.app_modules m
   where r.base_role = 'admin'
)
insert into public.role_permissions (role_code, module, actions, scope)
select distinct on (role_code, module) role_code, module, actions, scope
  from rows
 order by role_code, module, prio
on conflict (role_code, module) do nothing;


-- ============================================================
-- ٤) ربط الحساب بالدور
-- ============================================================
alter table public.profiles
  add column if not exists role_code text references public.roles(code) on update cascade on delete restrict;

update public.profiles set role_code = role where role_code is null;

alter table public.profiles alter column role_code set not null;

-- المنصب يقترح دوراً (لا يفرضه في هذه المرحلة)
alter table public.positions drop constraint if exists positions_default_role_fk;
alter table public.positions add constraint positions_default_role_fk
  foreign key (default_role_code) references public.roles(code) on update cascade on delete set null;

update public.positions p set default_role_code = v.role_code
  from (values
    ('GM', 'general_manager'), ('HR-MGR', 'hr_manager'), ('HR-OFF', 'hr_officer'),
    ('FIN-MGR', 'finance_manager'), ('ACC', 'accountant'),
    ('MKT-MGR', 'marketing_manager'), ('MKT-AM', 'marketing_employee'),
    ('MKT-WRITER', 'marketing_employee'), ('MKT-DESIGNER', 'marketing_employee'),
    ('MKT-AI', 'marketing_employee'), ('MKT-PHOTO', 'marketing_employee'),
    ('MKT-VIDEO', 'marketing_employee'), ('MKT-BUYER', 'marketing_employee'),
    ('SALES-MGR', 'sales_manager'), ('SALES-SUP', 'supervisor'),
    ('SALES-AGENT', 'sales_employee'), ('SALES-TELE', 'sales_employee'),
    -- مدير العلاقات علاقةٌ لا دور (128): موظفٌ له rm_id في إسناد شركة
    ('SALES-RM', 'sales_employee'),
    ('CRM-SPEC', 'crm_employee'), ('OPS-MGR', 'operations_manager'),
    ('FOLLOWUP-MGR', 'followup_manager'), ('ADMIN-OFF', 'employee')
  ) v(code, role_code)
 where p.code = v.code and p.default_role_code is null;


-- الاشتقاق: role_code ← يحدّد role. وكتابةٌ قديمة على role مباشرةً
-- (شاشة الإعدادات، ربط الوسيط) تُرجع role_code إلى الدور النظامي —
-- إلا إن كان الدور الحالي على المستوى نفسه أصلاً.
create or replace function public.profiles_role_sync()
returns trigger language plpgsql set search_path = public as $$
declare
  v_base text;
  v_status text;
begin
  if tg_op = 'INSERT' then
    if new.role_code is null then
      new.role_code := new.role;
      return new;
    end if;
  elsif new.role_code is not distinct from old.role_code then
    if new.role is distinct from old.role then
      select r.base_role into v_base from public.roles r where r.code = new.role_code;
      if v_base is distinct from new.role then
        new.role_code := new.role;
      end if;
    end if;
    return new;
  end if;

  select r.base_role, r.status into v_base, v_status from public.roles r where r.code = new.role_code;
  if v_base is null then
    raise exception 'الدور «%» غير موجود', new.role_code;
  end if;
  if v_status <> 'نشط' then
    raise exception 'الدور «%» مؤرشف', new.role_code;
  end if;
  new.role := v_base;
  return new;
end $$;

drop trigger if exists trg_profiles_role_sync on public.profiles;
create trigger trg_profiles_role_sync
  before insert or update of role, role_code on public.profiles
  for each row execute function public.profiles_role_sync();


-- الدور: النظامي ثابت المستوى ولا يؤرشف، ودور فيه حسابات لا يؤرشف،
-- وتغيير مستوى دورٍ يسري على كل حساباته.
create or replace function public.guard_role()
returns trigger language plpgsql set search_path = public as $$
declare
  v_n int;
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'الدور النظامي «%» لا يُحذف', old.name_ar;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.code := lower(btrim(new.code));
    return new;
  end if;

  if new.code is distinct from old.code and old.is_system then
    raise exception 'رمز الدور النظامي لا يتغيّر';
  end if;
  if new.is_system is distinct from old.is_system then
    raise exception 'لا يتحوّل دور إلى نظامي أو عنه';
  end if;
  if new.base_role is distinct from old.base_role and old.is_system then
    raise exception 'مستوى الدور النظامي «%» ثابت', old.name_ar;
  end if;
  if new.status = 'مؤرشف' and old.status = 'نشط' then
    if old.is_system then
      raise exception 'الدور النظامي لا يؤرشف';
    end if;
    select count(*) into v_n from public.profiles p where p.role_code = old.code;
    if v_n > 0 then
      raise exception 'لا يؤرشف دور عليه % حساب — انقلهم أولاً', v_n;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_role on public.roles;
create trigger trg_guard_role
  before insert or update or delete on public.roles
  for each row execute function public.guard_role();

create or replace function public.roles_propagate_base()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.base_role is distinct from old.base_role then
    update public.profiles set role = new.base_role where role_code = new.code;
  end if;
  return null;
end $$;

drop trigger if exists trg_roles_propagate_base on public.roles;
create trigger trg_roles_propagate_base
  after update of base_role on public.roles
  for each row execute function public.roles_propagate_base();

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();


-- ============================================================
-- ٥) دوالّ الصلاحية
-- ============================================================
create or replace function public.my_role_code()
returns text language sql stable security definer set search_path = public as $$
  select p.role_code from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.has_permission(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_account_active(), false) and (
    public.is_admin()
    or exists (
      select 1
        from public.profiles p
        join public.roles r on r.code = p.role_code and r.status = 'نشط'
        join public.role_permissions rp on rp.role_code = p.role_code
       where p.id = auth.uid()
         and rp.module = p_module
         and p_action = any (rp.actions)
    )
  );
$$;

-- النطاق الذي يملك فيه الفعل: all/department/team/own — أو null
create or replace function public.permission_scope(p_module text, p_action text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not coalesce(public.my_account_active(), false) then null
    when public.is_admin() then 'all'
    else (
      select rp.scope
        from public.profiles p
        join public.roles r on r.code = p.role_code and r.status = 'نشط'
        join public.role_permissions rp on rp.role_code = p.role_code
       where p.id = auth.uid() and rp.module = p_module and p_action = any (rp.actions)
    )
  end;
$$;

-- الهيكل يُدار بالمستوى الأمني (المدير/HR) أو بالمصفوفة — أول وحدة مُطبَّقة
create or replace function public.can_manage_org()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr() or public.has_permission('organization', 'manage');
$$;

-- من يرى ناس القسم: HR والمالية، ومدير القسم أو أحد آبائه
create or replace function public.can_view_department(p_dept uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr() or public.can_manage_finance()
      or p_dept in (select m.id from public.my_managed_department_ids() m);
$$;


-- ============================================================
-- ٦) قراءات الهيكل — بلا أرقام مالية
-- ============================================================

-- الشجرة كاملةً مع أعداد الموظفين. يقرؤها كل موظف داخلي.
create or replace function public.department_tree(p_include_archived boolean default false)
returns table (
  id uuid, parent_id uuid, code text, name_ar text, name_en text, unit_type text,
  status text, sort_order int, depth int, path text,
  manager_id uuid, manager_name text, branch_name text,
  direct_headcount int, total_headcount int, positions_count int
)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select d.id, d.parent_id, 0 as depth, lpad(d.sort_order::text, 4, '0') || d.code as path
      from public.departments d
     where d.parent_id is null and (p_include_archived or d.status = 'نشط')
    union all
    select c.id, c.parent_id, t.depth + 1, t.path || '/' || lpad(c.sort_order::text, 4, '0') || c.code
      from public.departments c join t on c.parent_id = t.id
     where (p_include_archived or c.status = 'نشط')
  ),
  direct as (
    select e.department_id, count(*)::int as n
      from public.employees e where e.status = 'active' and e.department_id is not null
     group by e.department_id
  )
  select d.id, d.parent_id, d.code, d.name_ar, d.name_en, d.unit_type,
         d.status, d.sort_order, t.depth, t.path,
         d.manager_id, m.full_name, b.name_ar,
         coalesce(dr.n, 0),
         (select coalesce(sum(x.n), 0)::int from direct x
           where x.department_id in (select s.id from public.department_descendants(d.id) s)),
         (select count(*)::int from public.positions p where p.department_id = d.id and p.status = 'نشط')
    from t
    join public.departments d on d.id = t.id
    left join public.employees m on m.id = d.manager_id
    left join public.branches b on b.id = d.branch_id
    left join direct dr on dr.department_id = d.id
   where not public.is_broker()
   order by t.path;
$$;

-- ناس القسم (وما تحته) — للحقول غير المالية فقط. لا base_salary ولا
-- عمولة ولا هاتف: مدير القسم يرى فريقه، لا رواتبهم.
create or replace function public.department_members(p_dept uuid, p_include_sub boolean default true)
returns table (
  id uuid, employee_code text, full_name text, status text, hire_date date,
  department_id uuid, department_name text, position_id uuid, position_title text,
  manager_id uuid, manager_name text, project_name text, has_account boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_department(p_dept) then
    raise exception 'لا صلاحية لرؤية موظفي هذا القسم';
  end if;

  return query
  select e.id, e.employee_code, e.full_name, e.status, e.hire_date,
         e.department_id, d.name_ar, e.position_id, p.title_ar,
         e.manager_id, m.full_name, pr.name, e.user_id is not null
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.positions p on p.id = e.position_id
    left join public.employees m on m.id = e.manager_id
    left join public.projects pr on pr.id = e.project_id
   where e.department_id in (
           select s.id from public.department_descendants(p_dept) s
            where p_include_sub or s.id = p_dept)
   order by (e.status <> 'active'), d.name_ar, e.full_name;
end $$;


-- ============================================================
-- ٧) تعيين الدور — للمدير، لغيره، ومسجَّل
-- ============================================================
create or replace function public.assign_user_role(p_user uuid, p_role_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_role public.roles%rowtype;
  v_current text;
begin
  if not public.is_admin() then
    raise exception 'تعيين الأدوار للمدير وحده';
  end if;
  if p_user = auth.uid() then
    raise exception 'لا يغيّر المدير دوره بنفسه — حتى لا يقفل حسابه بالخطأ';
  end if;

  select p.role into v_current from public.profiles p where p.id = p_user;
  if v_current is null then
    raise exception 'الحساب غير موجود';
  end if;

  select * into v_role from public.roles r where r.code = p_role_code;
  if not found then
    raise exception 'الدور «%» غير موجود', p_role_code;
  end if;
  if v_role.status <> 'نشط' then
    raise exception 'الدور «%» مؤرشف', v_role.name_ar;
  end if;
  -- حساب الوسيط يُربط بشركته من صفحة الشركة: الدور بلا ربط لا يعمل
  if v_role.base_role = 'broker' or v_current = 'broker' then
    raise exception 'حسابات الوسطاء تُدار من صفحة الشركة الوسيطة';
  end if;

  update public.profiles set role_code = v_role.code where id = p_user;
  return v_role.base_role;
end $$;


-- ============================================================
-- ٨) RLS
-- ============================================================
alter table public.roles            enable row level security;
alter table public.app_modules      enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "read roles" on public.roles;
create policy "read roles" on public.roles for select to authenticated using (true);
drop policy if exists "admin manages roles" on public.roles;
create policy "admin manages roles" on public.roles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read modules" on public.app_modules;
create policy "read modules" on public.app_modules for select to authenticated using (true);
drop policy if exists "admin manages modules" on public.app_modules;
create policy "admin manages modules" on public.app_modules for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- كلٌّ يقرأ صلاحيات دوره؛ والمدير وHR المصفوفة كلها
drop policy if exists "read permissions" on public.role_permissions;
create policy "read permissions" on public.role_permissions for select to authenticated
  using ((select public.is_admin()) or (select public.can_manage_hr())
         or role_code = (select public.my_role_code()));
drop policy if exists "admin manages permissions" on public.role_permissions;
create policy "admin manages permissions" on public.role_permissions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.roles, public.app_modules, public.role_permissions from anon;


-- ============================================================
-- ٩) التدقيق — وأوّلها profiles: تغيير الدور لم يكن يُسجَّل
-- ============================================================
drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_roles on public.roles;
create trigger trg_audit_roles after insert or update or delete on public.roles
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_role_permissions on public.role_permissions;
create trigger trg_audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row();


-- ============================================================
-- ١٠) الصلاحيات على الدوالّ
-- ============================================================
revoke all on function public.my_role_code()                      from public, anon;
revoke all on function public.has_permission(text, text)          from public, anon;
revoke all on function public.permission_scope(text, text)        from public, anon;
revoke all on function public.can_manage_org()                    from public, anon;
revoke all on function public.can_view_department(uuid)           from public, anon;
revoke all on function public.department_tree(boolean)            from public, anon;
revoke all on function public.department_members(uuid, boolean)   from public, anon;
revoke all on function public.assign_user_role(uuid, text)        from public, anon;
grant execute on function public.my_role_code()                    to authenticated;
grant execute on function public.has_permission(text, text)        to authenticated;
grant execute on function public.permission_scope(text, text)      to authenticated;
grant execute on function public.can_manage_org()                  to authenticated;
grant execute on function public.can_view_department(uuid)         to authenticated;
grant execute on function public.department_tree(boolean)          to authenticated;
grant execute on function public.department_members(uuid, boolean) to authenticated;
grant execute on function public.assign_user_role(uuid, text)      to authenticated;
