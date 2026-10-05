-- ============================================================
-- تلال ERP — 145: الهيكل التنظيمي (HR المؤسسي — المرحلة 1)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- القسم والمسمّى نصّان حرّان على ملف الموظف. على القاعدة الحيّة:
-- «مبيعات» و«المبيعات»، «تسويق» و«التسويق»، و«ادارة»؛ ومدير الشركة
-- قسمُه «التسويق». فلا يُجمَّع شيء بالقسم، ولا يُبنى عليه نطاق رؤية،
-- ولا يُعرف من مدير من. والنطاق الوحيد اليوم هو المشروع (037).
--
-- ============================================================
-- ما يضيفه (بلا حذف ولا تغيير لسلوك قائم)
--
--   branches          الفروع (+ المقر الرئيسي)
--   departments       شجرة: إدارة ← قسم فرعي ← فريق، لكلٍّ مدير وفرع
--   job_grades        الدرجات ونطاق الراتب — قراءة HR والمالية وحدهما
--   employment_types  أنواع التوظيف (قائمة تُدار)
--   positions         المناصب: القسم، الدرجة، المنصب الأعلى، الدور الافتراضي
--   employees +       employee_code, department_id, position_id,
--                     manager_id, branch_id, employment_type
--
-- ⚠️ employees.department و job_title يبقيان — تقرؤهما شاشات قائمة و
--    mkt_people(). صارا **مشتقّين**: محفّز يملؤهما من القسم والمنصب،
--    فلا يتباعد النصّ عن المرجع.
--
-- ⚠️ لا يمسّ أي سياسة RLS قائمة، ولا profiles.role، ولا employees.project_id
--    (عليه نطاق المشرف كلّه).
--
-- الأدوار ومصفوفة الصلاحيات في 146، والاختبارات في 147.
-- ============================================================


-- ============================================================
-- ١) من يدير الهيكل — نسخة أولى، تعيد 146 تعريفها لتقرأ المصفوفة
-- ============================================================
create or replace function public.can_manage_org()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr();
$$;


-- ============================================================
-- ٢) الفروع
-- ============================================================
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,30}$'),
  name_ar     text not null check (btrim(name_ar) <> ''),
  name_en     text,
  city        text,
  address     text,
  status      text not null default 'نشط' check (status in ('نشط', 'مؤرشف')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null
);

comment on table public.branches is 'فروع الشركة (145). الشركة واحدة؛ بياناتها في company_settings.';


-- ============================================================
-- ٣) الأقسام — شجرة واحدة تحمل الإدارات والأقسام الفرعية والفرق
-- ============================================================
create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9_-]{2,30}$'),
  name_ar      text not null check (btrim(name_ar) <> ''),
  name_en      text,
  description  text,
  unit_type    text not null default 'إدارة' check (unit_type in ('إدارة', 'قسم فرعي', 'فريق')),
  parent_id    uuid references public.departments(id) on delete restrict,
  manager_id   uuid references public.employees(id) on delete set null,
  branch_id    uuid references public.branches(id) on delete restrict,
  status       text not null default 'نشط' check (status in ('نشط', 'مؤرشف')),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  constraint departments_not_own_parent check (parent_id is distinct from id)
);

create index if not exists departments_parent_idx  on public.departments(parent_id);
create index if not exists departments_manager_idx on public.departments(manager_id);
-- اسمان متطابقان تحت أبٍ واحد = قسم مكرَّر
create unique index if not exists departments_name_under_parent
  on public.departments (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name_ar)
  where status = 'نشط';

comment on table public.departments is
  'الهيكل التنظيمي (145): شجرة بـ parent_id. unit_type يميّز الإدارة والقسم الفرعي والفريق. '
  'الفريق هنا وحدة تنظيمية — غير «فريق المشرف» الذي هو المشروع (037).';


-- ============================================================
-- ٤) الدرجات الوظيفية — نطاق الراتب يسكن هنا لا في المنصب
--
-- المنصب يقرؤه كل موظف (ليعرف منصبه ومنصب مديره)، ونطاق الراتب لا
-- يقرؤه إلا HR والمالية. فلو كان النطاق عموداً في المنصب لصار مكشوفاً
-- لكل من يقرأ المنصب. فصار المنصب يشير إلى درجته، والدرجة محميّة.
-- ============================================================
create table if not exists public.job_grades (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar     text not null check (btrim(name_ar) <> ''),
  level       int  not null check (level between 1 and 99),
  salary_min  numeric check (salary_min is null or salary_min >= 0),
  salary_max  numeric check (salary_max is null or salary_max >= 0),
  notes       text,
  status      text not null default 'نشط' check (status in ('نشط', 'مؤرشف')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  constraint job_grades_range check (salary_min is null or salary_max is null or salary_max >= salary_min)
);

comment on table public.job_grades is
  'الدرجات الوظيفية ونطاق رواتبها (145). فارغة عمداً: الأرقام يضعها المالك. القراءة لـ HR والمالية.';


-- ============================================================
-- ٥) أنواع التوظيف
-- ============================================================
create table if not exists public.employment_types (
  code        text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_ar     text not null,
  sort_order  int not null default 0,
  active      boolean not null default true
);

insert into public.employment_types (code, name_ar, sort_order) values
  ('full_time',  'دوام كامل',        1),
  ('part_time',  'دوام جزئي',        2),
  ('fixed_term', 'عقد محدد المدة',   3),
  ('intern',     'تدريب',            4),
  ('consultant', 'استشاري',          5)
on conflict (code) do nothing;


-- ============================================================
-- ٦) المناصب
-- ============================================================
create table if not exists public.positions (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique check (code ~ '^[A-Z0-9_-]{2,30}$'),
  title_ar                text not null check (btrim(title_ar) <> ''),
  title_en                text,
  department_id           uuid not null references public.departments(id) on delete restrict,
  job_grade_id            uuid references public.job_grades(id) on delete restrict,
  reports_to_position_id  uuid references public.positions(id) on delete set null,
  employment_type         text not null default 'full_time'
                            references public.employment_types(code) on update cascade,
  -- الدور الذي يُقترح لصاحب المنصب — مرجعه roles (146). لا يُطبَّق
  -- تلقائياً في هذه المرحلة: تغيير الصلاحية قرارٌ صريح للمدير.
  default_role_code       text,
  -- خطة العمولة (129). محرّك العمولة عامّ أصلاً؛ ربط المنصب به في المرحلة 5.
  commission_plan_id      uuid references public.commission_plans(id) on delete set null,
  headcount_budget        int check (headcount_budget is null or headcount_budget >= 0),
  job_description         text,
  responsibilities        text,
  status                  text not null default 'نشط' check (status in ('نشط', 'مؤرشف')),
  sort_order              int not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default auth.uid() references auth.users(id) on delete set null,
  constraint positions_not_own_boss check (reports_to_position_id is distinct from id)
);

create index if not exists positions_department_idx on public.positions(department_id);

comment on table public.positions is
  'المناصب (145). نطاق الراتب من الدرجة (job_grades)، لا من المنصب — انظر سبب ذلك عند job_grades.';


-- ============================================================
-- ٧) أعمدة الموظف الجديدة
-- ============================================================
alter table public.employees
  add column if not exists employee_code   text,
  add column if not exists department_id   uuid references public.departments(id) on delete restrict,
  add column if not exists position_id     uuid references public.positions(id) on delete restrict,
  add column if not exists manager_id      uuid references public.employees(id) on delete set null,
  add column if not exists branch_id       uuid references public.branches(id) on delete restrict,
  add column if not exists employment_type text references public.employment_types(code) on update cascade;

create unique index if not exists employees_employee_code_key on public.employees(employee_code);
create index if not exists employees_department_idx on public.employees(department_id);
create index if not exists employees_position_idx   on public.employees(position_id);
create index if not exists employees_manager_idx    on public.employees(manager_id);

alter table public.employees drop constraint if exists employees_not_own_manager;
alter table public.employees add constraint employees_not_own_manager check (manager_id is distinct from id);

create sequence if not exists public.employee_code_seq;

comment on column public.employees.department is
  'مشتقّ (145): يملؤه المحفّز من departments.name_ar. اقرأ department_id للمنطق.';
comment on column public.employees.job_title is
  'مشتقّ (145) حين يكون للموظف منصب: يملؤه المحفّز من positions.title_ar.';


-- ============================================================
-- ٨) دوالّ الشجرة
-- ============================================================

-- القسم وكل ما تحته
create or replace function public.department_descendants(p_dept uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select d.id from public.departments d where d.id = p_dept
    union
    select c.id from public.departments c join t on c.parent_id = t.id
  )
  select t.id from t;
$$;

-- الأقسام التي أديرها (بنفسي) وكل ما تحتها
create or replace function public.my_managed_department_ids()
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select d.id from public.departments d
     where d.manager_id is not null
       and d.manager_id = public.my_employee_id()
       and d.status = 'نشط'
    union
    select c.id from public.departments c join t on c.parent_id = t.id
  )
  select t.id from t;
$$;

-- فريقي: من يتبعني مباشرةً أو بالتسلسل، ومن في أقسامي — دوني أنا
create or replace function public.my_team_employee_ids()
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with recursive r as (
    select e.id from public.employees e
     where e.manager_id is not null and e.manager_id = public.my_employee_id()
    union
    select e.id from public.employees e join r on e.manager_id = r.id
  )
  select r.id from r
  union
  select e.id from public.employees e
   where e.department_id in (select m.id from public.my_managed_department_ids() m)
     and e.id is distinct from public.my_employee_id();
$$;

comment on function public.my_team_employee_ids() is
  'نطاق «الفريق» التنظيمي (145): التابعون بالتسلسل + أعضاء الأقسام التي أديرها. '
  'غير my_scope_employees() — ذاك نطاق المشرف بالمشروع (037)، ويبقى كما هو.';


-- ============================================================
-- ٩) الحرّاس
-- ============================================================

-- القسم: لا حلقة، لا قسم نشط تحت مؤرشف، لا أرشفة لقسمٍ حيّ، والمدير نشط
create or replace function public.guard_department()
returns trigger language plpgsql set search_path = public as $$
declare
  v_n int;
begin
  new.code := upper(btrim(new.code));
  new.name_ar := btrim(new.name_ar);

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if new.parent_id = new.id
       or exists (
         with recursive up as (
           select d.id, d.parent_id from public.departments d where d.id = new.parent_id
           union
           select d.id, d.parent_id from public.departments d join up on d.id = up.parent_id
         )
         select 1 from up where up.id = new.id
       ) then
      raise exception 'لا يكون القسم تحت نفسه أو تحت أحد فروعه';
    end if;
  end if;

  if new.status = 'نشط' and new.parent_id is not null
     and (select d.status from public.departments d where d.id = new.parent_id) <> 'نشط' then
    raise exception 'لا يُعلَّق قسم نشط تحت قسم مؤرشف';
  end if;

  if tg_op = 'UPDATE' and new.status = 'مؤرشف' and old.status = 'نشط' then
    select count(*) into v_n from public.employees e
     where e.department_id = new.id and e.status = 'active';
    if v_n > 0 then
      raise exception 'لا يؤرشف قسم فيه % موظف نشط — انقلهم أولاً', v_n;
    end if;
    if exists (select 1 from public.departments c where c.parent_id = new.id and c.status = 'نشط') then
      raise exception 'لا يؤرشف قسم تحته أقسام نشطة — أرشفها أولاً';
    end if;
    if exists (select 1 from public.positions p where p.department_id = new.id and p.status = 'نشط') then
      raise exception 'لا يؤرشف قسم فيه مناصب نشطة — أرشفها أو انقلها أولاً';
    end if;
  end if;

  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and (select e.status from public.employees e where e.id = new.manager_id) <> 'active' then
    raise exception 'مدير القسم يجب أن يكون موظفاً على رأس عمله';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_department on public.departments;
create trigger trg_guard_department
  before insert or update on public.departments
  for each row execute function public.guard_department();


-- المنصب: لا حلقة في التبعية، القسم نشط، ولا أرشفة لمنصبٍ يشغله أحد
create or replace function public.guard_position()
returns trigger language plpgsql set search_path = public as $$
declare
  v_n int;
begin
  new.code := upper(btrim(new.code));
  new.title_ar := btrim(new.title_ar);

  if new.reports_to_position_id is not null
     and (tg_op = 'INSERT' or new.reports_to_position_id is distinct from old.reports_to_position_id)
     and exists (
       with recursive up as (
         select p.id, p.reports_to_position_id from public.positions p where p.id = new.reports_to_position_id
         union
         select p.id, p.reports_to_position_id from public.positions p join up on p.id = up.reports_to_position_id
       )
       select 1 from up where up.id = new.id
     ) then
    raise exception 'لا يتبع المنصب نفسه ولا منصباً يتبعه';
  end if;

  if new.status = 'نشط'
     and (select d.status from public.departments d where d.id = new.department_id) <> 'نشط' then
    raise exception 'لا يُنشأ منصب نشط في قسم مؤرشف';
  end if;

  if tg_op = 'UPDATE' and new.status = 'مؤرشف' and old.status = 'نشط' then
    select count(*) into v_n from public.employees e
     where e.position_id = new.id and e.status = 'active';
    if v_n > 0 then
      raise exception 'لا يؤرشف منصب يشغله % موظف نشط', v_n;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_position on public.positions;
create trigger trg_guard_position
  before insert or update on public.positions
  for each row execute function public.guard_position();


-- الموظف: الرمز، والنصّان المشتقّان، ولا حلقة إدارة، ولا تعيين على مؤرشف
create or replace function public.employees_org_sync()
returns trigger language plpgsql set search_path = public as $$
declare
  v_pos public.positions%rowtype;
  v_dep public.departments%rowtype;
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'EMP-' || lpad(nextval('public.employee_code_seq')::text, 4, '0');
  else
    new.employee_code := upper(btrim(new.employee_code));
  end if;

  if new.position_id is not null then
    select * into v_pos from public.positions p where p.id = new.position_id;
    if (tg_op = 'INSERT' or new.position_id is distinct from old.position_id)
       and v_pos.status <> 'نشط' then
      raise exception 'المنصب «%» مؤرشف', v_pos.title_ar;
    end if;
    new.job_title := v_pos.title_ar;
    -- القسم يتبع المنصب عند غيابه فقط. الندب إلى قسمٍ غير قسم المنصب
    -- مسموح، فلا يُفرض التطابق.
    if new.department_id is null then
      new.department_id := v_pos.department_id;
    end if;
    if new.employment_type is null then
      new.employment_type := v_pos.employment_type;
    end if;
  end if;

  if new.department_id is not null then
    select * into v_dep from public.departments d where d.id = new.department_id;
    if (tg_op = 'INSERT' or new.department_id is distinct from old.department_id)
       and v_dep.status <> 'نشط' then
      raise exception 'القسم «%» مؤرشف', v_dep.name_ar;
    end if;
    new.department := v_dep.name_ar;
  end if;

  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id) then
    if new.manager_id = new.id then
      raise exception 'لا يكون الموظف مديراً لنفسه';
    end if;
    if exists (
      with recursive up as (
        select e.id, e.manager_id from public.employees e where e.id = new.manager_id
        union
        select e.id, e.manager_id from public.employees e join up on e.id = up.manager_id
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'خط الإدارة يدور على نفسه: المدير المختار يتبع هذا الموظف';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_employees_org_sync on public.employees;
create trigger trg_employees_org_sync
  before insert or update of employee_code, department_id, position_id, manager_id,
                             employment_type, job_title, department
  on public.employees
  for each row execute function public.employees_org_sync();

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_job_grades_updated_at on public.job_grades;
create trigger trg_job_grades_updated_at before update on public.job_grades
  for each row execute function public.set_updated_at();
drop trigger if exists trg_positions_updated_at on public.positions;
create trigger trg_positions_updated_at before update on public.positions
  for each row execute function public.set_updated_at();


-- ============================================================
-- ١٠) البذرة والترحيل
-- ============================================================
insert into public.branches (code, name_ar, name_en)
values ('HQ', 'المقر الرئيسي', 'Head Office')
on conflict (code) do nothing;

-- الإدارات العليا
insert into public.departments (code, name_ar, name_en, unit_type, branch_id, sort_order)
select v.code, v.name_ar, v.name_en, 'إدارة', b.id, v.ord
  from (values
    ('EXEC',  'الإدارة العليا',          'Executive Management', 1),
    ('HR',    'الموارد البشرية',         'Human Resources',      2),
    ('FIN',   'المالية والمحاسبة',       'Finance & Accounting', 3),
    ('MKT',   'التسويق',                 'Marketing',            4),
    ('SALES', 'المبيعات',                'Sales',                5),
    ('CRM',   'إدارة علاقات العملاء',    'CRM',                  6),
    ('BRK',   'الوساطة',                 'Brokerage',            7),
    ('OPS',   'العمليات',                'Operations',           8),
    ('ADMIN', 'الشؤون الإدارية',         'Administration',       9)
  ) v(code, name_ar, name_en, ord)
  cross join (select id from public.branches where code = 'HQ') b
on conflict (code) do nothing;

-- الأقسام الفرعية
insert into public.departments (code, name_ar, name_en, unit_type, parent_id, branch_id, sort_order)
select v.code, v.name_ar, v.name_en, 'قسم فرعي', p.id, p.branch_id, v.ord
  from (values
    ('MKT-MGMT',     'MKT',   'إدارة التسويق',       'Marketing Management', 1),
    ('MKT-CONTENT',  'MKT',   'المحتوى',             'Content',              2),
    ('MKT-DESIGN',   'MKT',   'التصميم',             'Design',               3),
    ('MKT-MEDIA',    'MKT',   'التصوير والفيديو',    'Photography & Video',  4),
    ('MKT-BUY',      'MKT',   'شراء الإعلانات',      'Media Buying',         5),
    ('MKT-DIGITAL',  'MKT',   'التسويق الرقمي',      'Digital Marketing',    6),
    ('SALES-MGMT',   'SALES', 'إدارة المبيعات',      'Sales Management',     1),
    ('SALES-TELE',   'SALES', 'المبيعات الهاتفية',   'Tele Sales',           2),
    ('SALES-RM',     'SALES', 'مدراء العلاقات',      'Relationship Managers',3),
    ('SALES-AGENTS', 'SALES', 'مندوبو المبيعات',     'Sales Agents',         4)
  ) v(code, parent_code, name_ar, name_en, ord)
  join public.departments p on p.code = v.parent_code
on conflict (code) do nothing;

-- المناصب — بلا درجة (الدرجات يضعها المالك)
insert into public.positions (code, title_ar, title_en, department_id, sort_order)
select v.code, v.title_ar, v.title_en, d.id, v.ord
  from (values
    ('GM',           'المدير العام',            'General Manager',        'EXEC',         1),
    ('HR-MGR',       'مدير الموارد البشرية',    'HR Manager',             'HR',           1),
    ('HR-OFF',       'موظف موارد بشرية',        'HR Officer',             'HR',           2),
    ('FIN-MGR',      'المدير المالي',           'Finance Manager',        'FIN',          1),
    ('ACC',          'محاسب',                   'Accountant',             'FIN',          2),
    ('MKT-MGR',      'مدير التسويق',            'Marketing Manager',      'MKT-MGMT',     1),
    ('MKT-AM',       'مدير حساب',               'Account Manager',        'MKT-MGMT',     2),
    ('MKT-WRITER',   'كاتب محتوى',              'Content Writer',         'MKT-CONTENT',  1),
    ('MKT-DESIGNER', 'مصمّم جرافيك',            'Graphic Designer',       'MKT-DESIGN',   1),
    ('MKT-AI',       'أخصائي ذكاء اصطناعي',     'AI Specialist',          'MKT-DIGITAL',  1),
    ('MKT-PHOTO',    'مصوّر',                   'Photographer',           'MKT-MEDIA',    1),
    ('MKT-VIDEO',    'مونتير',                  'Video Editor',           'MKT-MEDIA',    2),
    ('MKT-BUYER',    'مشتري إعلانات',           'Media Buyer',            'MKT-BUY',      1),
    ('SALES-MGR',    'مدير المبيعات',           'Sales Manager',          'SALES-MGMT',   1),
    ('SALES-SUP',    'مشرف مبيعات',             'Sales Supervisor',       'SALES-MGMT',   2),
    ('SALES-AGENT',  'موظف مبيعات',             'Sales Agent',            'SALES-AGENTS', 1),
    ('SALES-TELE',   'موظف مبيعات هاتفية',      'Tele Sales Agent',       'SALES-TELE',   1),
    ('SALES-RM',     'مدير علاقات',             'Relationship Manager',   'SALES-RM',     1),
    ('CRM-SPEC',     'أخصائي CRM',              'CRM Specialist',         'CRM',          1),
    ('OPS-MGR',      'مدير العمليات',           'Operations Manager',     'OPS',          1),
    ('FOLLOWUP-MGR', 'مدير المتابعة',           'Follow-up Manager',      'OPS',          2),
    ('ADMIN-OFF',    'موظف إداري',              'Administrative Officer', 'ADMIN',        1)
  ) v(code, title_ar, title_en, dept_code, ord)
  join public.departments d on d.code = v.dept_code
on conflict (code) do nothing;

-- خطوط التبعية بين المناصب
update public.positions p
   set reports_to_position_id = b.id
  from (values
    ('HR-MGR', 'GM'), ('HR-OFF', 'HR-MGR'),
    ('FIN-MGR', 'GM'), ('ACC', 'FIN-MGR'),
    ('MKT-MGR', 'GM'), ('MKT-AM', 'MKT-MGR'), ('MKT-WRITER', 'MKT-MGR'),
    ('MKT-DESIGNER', 'MKT-MGR'), ('MKT-AI', 'MKT-MGR'), ('MKT-PHOTO', 'MKT-MGR'),
    ('MKT-VIDEO', 'MKT-MGR'), ('MKT-BUYER', 'MKT-MGR'),
    ('SALES-MGR', 'GM'), ('SALES-SUP', 'SALES-MGR'), ('SALES-AGENT', 'SALES-SUP'),
    ('SALES-TELE', 'SALES-SUP'), ('SALES-RM', 'SALES-MGR'),
    ('CRM-SPEC', 'GM'), ('OPS-MGR', 'GM'), ('FOLLOWUP-MGR', 'OPS-MGR'), ('ADMIN-OFF', 'GM')
  ) v(code, boss)
  join public.positions b on b.code = v.boss
 where p.code = v.code and p.reports_to_position_id is null;

-- رموز الموظفين بترتيب الانضمام
with o as (
  select e.id, row_number() over (order by e.created_at, e.id) as rn
    from public.employees e where e.employee_code is null
)
update public.employees e
   set employee_code = 'EMP-' || lpad(o.rn::text, 4, '0')
  from o where o.id = e.id;

select setval('public.employee_code_seq',
              greatest((select count(*) from public.employees), 1),
              (select count(*) from public.employees) > 0);

alter table public.employees alter column employee_code set not null;

-- المنصب من المسمّى الحالي. ومنه يأتي القسم (المحفّز)، فيُصحَّح
-- «المدير العام في التسويق» تلقائياً.
update public.employees e
   set position_id = p.id
  from public.positions p
 where e.position_id is null
   and p.code = case btrim(e.job_title)
                  when 'موظف مبيعات'   then 'SALES-AGENT'
                  when 'موظف المبيعات' then 'SALES-AGENT'
                  when 'مشرف مبيعات'   then 'SALES-SUP'
                  when 'مدير الشركة'   then 'GM'
                  when 'مدير تسويق'    then 'MKT-MGR'
                  when 'مدير متابعة'   then 'FOLLOWUP-MGR'
                end;

-- من بقي بلا منصب: القسم من نصّه
update public.employees e
   set department_id = d.id
  from public.departments d
 where e.department_id is null
   and d.code = case btrim(e.department)
                  when 'مبيعات'  then 'SALES'
                  when 'المبيعات' then 'SALES'
                  when 'تسويق'   then 'MKT'
                  when 'التسويق' then 'MKT'
                  when 'ادارة'   then 'ADMIN'
                  when 'إدارة'   then 'ADMIN'
                end;

update public.employees
   set branch_id = (select id from public.branches where code = 'HQ')
 where branch_id is null;

update public.employees set employment_type = 'full_time' where employment_type is null;

-- المدير المباشر = مشرف مشروع الموظف (نطاق 037 القائم)، إلا نفسه
update public.employees e
   set manager_id = p.supervisor_id
  from public.projects p
 where e.manager_id is null
   and p.id = e.project_id
   and p.supervisor_id is not null
   and p.supervisor_id <> e.id;

-- مدراء الأقسام حيث المنصب صريح ولا يشغله إلا واحد
update public.departments d
   set manager_id = h.emp_id
  from (
    select x.dept_code, (array_agg(e.id order by e.created_at))[1] as emp_id
      from (values ('EXEC', 'GM'), ('MKT', 'MKT-MGR'), ('MKT-MGMT', 'MKT-MGR')) x(dept_code, pos_code)
      join public.positions p on p.code = x.pos_code
      join public.employees e on e.position_id = p.id and e.status = 'active'
     group by x.dept_code
    having count(*) = 1
  ) h
 where d.code = h.dept_code and d.manager_id is null;


-- ============================================================
-- ١١) RLS
--
-- الهيكل يقرؤه كل موظف (منصبه وقسمه ومديره) — لا الوسيط الخارجي.
-- الدرجات (نطاق الراتب) لـ HR والمالية فقط. والكتابة لمن يدير الهيكل.
-- ============================================================
alter table public.branches         enable row level security;
alter table public.departments      enable row level security;
alter table public.job_grades       enable row level security;
alter table public.employment_types enable row level security;
alter table public.positions        enable row level security;

drop policy if exists "staff read branches" on public.branches;
create policy "staff read branches" on public.branches for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "org managers write branches" on public.branches;
create policy "org managers write branches" on public.branches for all to authenticated
  using ((select public.can_manage_org())) with check ((select public.can_manage_org()));

drop policy if exists "staff read departments" on public.departments;
create policy "staff read departments" on public.departments for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "org managers write departments" on public.departments;
create policy "org managers write departments" on public.departments for all to authenticated
  using ((select public.can_manage_org())) with check ((select public.can_manage_org()));

drop policy if exists "hr and finance read grades" on public.job_grades;
create policy "hr and finance read grades" on public.job_grades for select to authenticated
  using ((select public.can_manage_hr()) or (select public.can_manage_finance()) or (select public.can_manage_org()));
drop policy if exists "org managers write grades" on public.job_grades;
create policy "org managers write grades" on public.job_grades for all to authenticated
  using ((select public.can_manage_org())) with check ((select public.can_manage_org()));

drop policy if exists "staff read employment types" on public.employment_types;
create policy "staff read employment types" on public.employment_types for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "org managers write employment types" on public.employment_types;
create policy "org managers write employment types" on public.employment_types for all to authenticated
  using ((select public.can_manage_org())) with check ((select public.can_manage_org()));

drop policy if exists "staff read positions" on public.positions;
create policy "staff read positions" on public.positions for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "org managers write positions" on public.positions;
create policy "org managers write positions" on public.positions for all to authenticated
  using ((select public.can_manage_org())) with check ((select public.can_manage_org()));

revoke all on public.branches, public.departments, public.job_grades,
              public.employment_types, public.positions from anon;


-- ============================================================
-- ١٢) التدقيق
-- ============================================================
drop trigger if exists trg_audit_branches on public.branches;
create trigger trg_audit_branches after insert or update or delete on public.branches
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_departments on public.departments;
create trigger trg_audit_departments after insert or update or delete on public.departments
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_job_grades on public.job_grades;
create trigger trg_audit_job_grades after insert or update or delete on public.job_grades
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_positions on public.positions;
create trigger trg_audit_positions after insert or update or delete on public.positions
  for each row execute function public.audit_row();

revoke all on function public.department_descendants(uuid)  from public, anon;
revoke all on function public.my_managed_department_ids()   from public, anon;
revoke all on function public.my_team_employee_ids()        from public, anon;
revoke all on function public.can_manage_org()              from public, anon;
grant execute on function public.department_descendants(uuid) to authenticated;
grant execute on function public.my_managed_department_ids()  to authenticated;
grant execute on function public.my_team_employee_ids()       to authenticated;
grant execute on function public.can_manage_org()             to authenticated;
