-- ============================================================
-- تلال ERP — 151: التهيئة وفترة التجربة (HR المؤسسي — المرحلة 3)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 146، 148، 150.
--
-- ============================================================
-- التهيئة
--
-- موظف جديد ⇒ قائمة مهام تلقائية من قالبٍ يُدار (onboarding_templates).
-- لكل مهمة مسؤول (HR، المدير المباشر، تقنية، إدارة) وموعد من المباشرة.
-- وما يمكن للقاعدة أن تتحقّق منه بنفسها تُنجزه بنفسها حين يتحقّق:
-- ربط الحساب، القسم، المنصب، المدير، البريد، رفع العقد والهوية، الدور.
-- فلا تُعلَّم «منجزة» مهمةٌ لم تُنجز، ولا تبقى معلّقة مهمةٌ أُنجزت.
--
-- لا تُولَّد للموظفين الحاليين (تهيّأوا فعلاً)؛ start_onboarding() لمن أراده HR.
--
-- ============================================================
-- فترة التجربة
--
--   تقييم المدير + تقييم HR (درجة 1–5 وتوصية) ──► قرار HR:
--     تثبيت ⇒ الحالة «نشط»
--     تمديد ⇒ نهاية جديدة، يبقى «تحت التجربة»
--     إنهاء ⇒ يُسجَّل ويُنبَّه المدير لإكمال «إنهاء الخدمة» (التسليم يبقى قراره)
--   تنبيه قبل النهاية بـ14 يوماً (cron) لـ HR والمدير، مرةً لكل نهاية.
--   لا أحد يقيّم نفسه ولا يقرّر في تجربته.
-- ============================================================


-- ============================================================
-- ١) قالب التهيئة
-- ============================================================
create table if not exists public.onboarding_templates (
  code        text primary key check (code ~ '^[a-z_]{2,40}$'),
  title       text not null,
  owner_role  text not null check (owner_role in ('HR', 'المدير المباشر', 'التقنية', 'الإدارة', 'المالية')),
  due_days    int  not null default 0 check (due_days between 0 and 90),
  auto_rule   text check (auto_rule in ('code', 'user', 'department', 'position', 'manager', 'email',
                                        'contract', 'identity', 'role')),
  sort_order  int  not null default 0,
  active      boolean not null default true
);

insert into public.onboarding_templates (code, title, owner_role, due_days, auto_rule, sort_order) values
  ('employee_code',      'إصدار الرقم الوظيفي',                  'HR',             0,  'code',       1),
  ('assign_department',  'تعيين القسم',                           'HR',             0,  'department', 2),
  ('assign_position',    'تعيين المنصب',                          'HR',             0,  'position',   3),
  ('assign_manager',     'تعيين المدير المباشر',                  'HR',             0,  'manager',    4),
  ('create_user',        'إنشاء حساب الدخول وربطه',               'HR',             1,  'user',       5),
  ('create_email',       'إنشاء بريد العمل',                      'التقنية',        1,  'email',      6),
  ('assign_permissions', 'منح الدور والصلاحيات المناسبة للمنصب',  'الإدارة',        1,  'role',       7),
  ('work_schedule',      'ضبط الدوام وموقع البصمة',               'HR',             1,  null,         8),
  ('upload_contract',    'رفع عقد العمل الموقَّع',                'HR',             3,  'contract',   9),
  ('upload_documents',   'رفع الهوية أو جواز السفر',              'HR',             7,  'identity',   10),
  ('assign_equipment',   'تسليم العهد (حاسوب، هاتف، شريحة)',      'الإدارة',        1,  null,         11),
  ('assign_workspace',   'تجهيز مكان العمل',                      'الإدارة',        0,  null,         12),
  ('team_intro',         'تعريف بالفريق وسير العمل',              'المدير المباشر', 2,  null,         13),
  ('assign_targets',     'تحديد الأهداف',                         'المدير المباشر', 14, null,         14),
  ('assign_kpis',        'تحديد مؤشرات الأداء',                   'المدير المباشر', 14, null,         15)
on conflict (code) do nothing;

alter table public.onboarding_templates enable row level security;
drop policy if exists "read onboarding templates" on public.onboarding_templates;
create policy "read onboarding templates" on public.onboarding_templates for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "hr manages onboarding templates" on public.onboarding_templates;
create policy "hr manages onboarding templates" on public.onboarding_templates for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));
revoke all on public.onboarding_templates from anon;


-- ============================================================
-- ٢) مهام التهيئة
-- ============================================================
create table if not exists public.onboarding_tasks (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  template_code      text references public.onboarding_templates(code) on update cascade on delete set null,
  title              text not null,
  owner_role         text not null,
  assignee_id        uuid references public.employees(id) on delete set null,
  due_date           date,
  status             text not null default 'معلّقة' check (status in ('معلّقة', 'منجزة', 'غير لازمة')),
  auto_rule          text,
  completed_at       timestamptz,
  completed_by       uuid references auth.users(id) on delete set null,
  completed_by_name  text,
  note               text,
  created_at         timestamptz not null default now(),
  unique (employee_id, template_code)
);

create index if not exists onboarding_tasks_open_idx on public.onboarding_tasks (employee_id) where status = 'معلّقة';
create index if not exists onboarding_tasks_assignee_idx on public.onboarding_tasks (assignee_id) where status = 'معلّقة';

-- ما تتحقّق منه القاعدة تُنجزه بنفسها
create or replace function public.refresh_onboarding(p_employee uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  v_role text; v_default text;
  n int;
begin
  select * into e from public.employees where id = p_employee;
  if not found then return 0; end if;
  select p.role_code into v_role from public.profiles p where p.id = e.user_id;
  select pos.default_role_code into v_default from public.positions pos where pos.id = e.position_id;

  update public.onboarding_tasks t
     set status = 'منجزة', completed_at = now(), completed_by = null, completed_by_name = 'النظام (تحقّق تلقائي)'
   where t.employee_id = p_employee and t.status = 'معلّقة' and t.auto_rule is not null
     and case t.auto_rule
           when 'code'       then e.employee_code is not null
           when 'user'       then e.user_id is not null
           when 'department' then e.department_id is not null
           when 'position'   then e.position_id is not null
           when 'manager'    then e.manager_id is not null
           when 'email'      then coalesce(btrim(e.email), '') <> ''
           when 'contract'   then exists (select 1 from public.employee_documents d
                                           where d.employee_id = e.id and d.type_code = 'contract' and d.deleted_at is null)
           when 'identity'   then exists (select 1 from public.employee_documents d
                                           where d.employee_id = e.id and d.type_code in ('national_id', 'passport')
                                             and d.deleted_at is null)
           when 'role'       then e.user_id is not null and v_role is not null
                                  and (v_default is null or v_role = v_default)
           else false
         end;
  get diagnostics n = row_count;
  return n;
end $$;

-- توليد القائمة: للموظف الجديد تلقائياً، ولغيره بطلب HR
create or replace function public.generate_onboarding(p_employee uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  n int;
begin
  select * into e from public.employees where id = p_employee;
  if not found or e.status <> 'active' then return 0; end if;

  insert into public.onboarding_tasks (employee_id, template_code, title, owner_role, assignee_id, due_date, auto_rule)
  select e.id, t.code, t.title, t.owner_role,
         case when t.owner_role = 'المدير المباشر' then e.manager_id end,
         coalesce(e.hire_date, public.baghdad_today()) + t.due_days,
         t.auto_rule
    from public.onboarding_templates t
   where t.active
  on conflict (employee_id, template_code) do nothing;
  get diagnostics n = row_count;

  perform public.refresh_onboarding(e.id);
  return n;
end $$;

create or replace function public.start_onboarding(p_employee uuid)
returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_hr() then
    raise exception 'بدء التهيئة للموارد البشرية';
  end if;
  return public.generate_onboarding(p_employee);
end $$;

create or replace function public.onboarding_on_employee_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.generate_onboarding(new.id);
  return null;
end $$;

drop trigger if exists trg_onboarding_on_employee_insert on public.employees;
create trigger trg_onboarding_on_employee_insert
  after insert on public.employees
  for each row execute function public.onboarding_on_employee_insert();

create or replace function public.onboarding_on_employee_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- مهام المدير تتبع المدير الجديد ما دامت معلّقة
  if new.manager_id is distinct from old.manager_id then
    update public.onboarding_tasks set assignee_id = new.manager_id
     where employee_id = new.id and status = 'معلّقة' and owner_role = 'المدير المباشر';
  end if;
  perform public.refresh_onboarding(new.id);
  return null;
end $$;

drop trigger if exists trg_onboarding_on_employee_update on public.employees;
create trigger trg_onboarding_on_employee_update
  after update of user_id, department_id, position_id, manager_id, email on public.employees
  for each row execute function public.onboarding_on_employee_update();

create or replace function public.onboarding_on_document()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_onboarding(new.employee_id);
  return null;
end $$;

drop trigger if exists trg_onboarding_on_document on public.employee_documents;
create trigger trg_onboarding_on_document
  after insert on public.employee_documents
  for each row execute function public.onboarding_on_document();

create or replace function public.onboarding_on_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select e.id into v_emp from public.employees e where e.user_id = new.id;
  if v_emp is not null then
    perform public.refresh_onboarding(v_emp);
  end if;
  return null;
end $$;

drop trigger if exists trg_onboarding_on_role on public.profiles;
create trigger trg_onboarding_on_role
  after update of role_code on public.profiles
  for each row execute function public.onboarding_on_role();

-- إنجاز يدوي: HR أيّ مهمة، والمكلَّف مهمته. «غير لازمة» بملاحظة.
create or replace function public.complete_onboarding_task(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.onboarding_tasks%rowtype;
begin
  select * into t from public.onboarding_tasks where id = p_id for update;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if not (public.can_manage_hr() or t.assignee_id = public.my_employee_id()) then
    raise exception 'ينجز المهمةَ المكلَّفُ بها أو الموارد البشرية';
  end if;
  if t.employee_id = public.my_employee_id() and not public.is_admin() then
    raise exception 'لا يُنجز الموظف مهام تهيئته بنفسه';
  end if;
  if p_status not in ('منجزة', 'غير لازمة', 'معلّقة') then
    raise exception 'الحالة: منجزة أو غير لازمة أو معلّقة';
  end if;
  if p_status = 'غير لازمة' and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب «غير لازمة» إلزامي';
  end if;

  update public.onboarding_tasks
     set status = p_status,
         completed_at = case when p_status = 'معلّقة' then null else now() end,
         completed_by = case when p_status = 'معلّقة' then null else auth.uid() end,
         completed_by_name = case when p_status = 'معلّقة' then null
                                  else coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام') end,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = p_id;
end $$;

-- لوحة التهيئة: المهام مع اسم الموظف (مدير الفريق لا يقرأ جدول الموظفين)
create or replace function public.onboarding_board(p_include_done boolean default false)
returns table (
  id uuid, employee_id uuid, employee_name text, employee_code text, hire_date date,
  title text, owner_role text, assignee_id uuid, assignee_name text, due_date date,
  status text, auto_rule text, completed_at timestamptz, completed_by_name text, note text,
  can_complete boolean
)
language sql stable security definer set search_path = public as $$
  select t.id, t.employee_id, e.full_name, e.employee_code, e.hire_date,
         t.title, t.owner_role, t.assignee_id, a.full_name, t.due_date,
         t.status, t.auto_rule, t.completed_at, t.completed_by_name, t.note,
         (public.can_manage_hr() or t.assignee_id = public.my_employee_id())
           and (t.employee_id is distinct from public.my_employee_id() or public.is_admin())
    from public.onboarding_tasks t
    join public.employees e on e.id = t.employee_id
    left join public.employees a on a.id = t.assignee_id
    left join public.onboarding_templates tpl on tpl.code = t.template_code
   where (p_include_done or t.status = 'معلّقة')
     and (public.can_manage_hr()
          or t.assignee_id = public.my_employee_id()
          or t.employee_id in (select x.id from public.my_team_employee_ids() x))
   order by e.hire_date desc nulls last, e.full_name, tpl.sort_order nulls last, t.created_at;
$$;

revoke all on function public.onboarding_board(boolean) from public, anon;
grant execute on function public.onboarding_board(boolean) to authenticated;

alter table public.onboarding_tasks enable row level security;
drop policy if exists "read onboarding tasks" on public.onboarding_tasks;
create policy "read onboarding tasks" on public.onboarding_tasks for select to authenticated
  using ((select public.can_manage_hr())
         or assignee_id = (select public.my_employee_id())
         or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t));
drop policy if exists "hr manages onboarding tasks" on public.onboarding_tasks;
create policy "hr manages onboarding tasks" on public.onboarding_tasks for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));
revoke all on public.onboarding_tasks from anon;

drop trigger if exists trg_audit_onboarding_tasks on public.onboarding_tasks;
create trigger trg_audit_onboarding_tasks after insert or update or delete on public.onboarding_tasks
  for each row execute function public.audit_row();


-- ============================================================
-- ٣) فترة التجربة
-- ============================================================
alter table public.employees add column if not exists probation_notified_end date;

create table if not exists public.probation_reviews (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  probation_end  date not null,
  reviewer_type  text not null check (reviewer_type in ('المدير', 'HR')),
  reviewer_id    uuid references auth.users(id) on delete set null,
  reviewer_name  text,
  score          int  not null check (score between 1 and 5),
  recommendation text not null check (recommendation in ('تثبيت', 'تمديد', 'إنهاء')),
  strengths      text,
  improvements   text,
  comments       text,
  submitted_at   timestamptz not null default now(),
  unique (employee_id, probation_end, reviewer_type)
);

create table if not exists public.probation_decisions (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  probation_end      date not null,
  decision           text not null check (decision in ('تثبيت', 'تمديد', 'إنهاء')),
  new_probation_end  date,
  note               text,
  decided_by         uuid references auth.users(id) on delete set null,
  decided_by_name    text,
  decided_at         timestamptz not null default now(),
  unique (employee_id, probation_end),
  constraint probation_decisions_extend check (decision <> 'تمديد' or new_probation_end > probation_end)
);

-- هل يقيّم المستخدم الحالي تجربة هذا الموظف كمدير؟
create or replace function public.is_manager_of(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
     where e.id = p_employee
       and e.id is distinct from public.my_employee_id()
       and (e.manager_id = public.my_employee_id()
            or e.department_id in (select m.id from public.my_managed_department_ids() m)));
$$;

create or replace function public.submit_probation_review(
  p_employee uuid, p_type text, p_score int, p_recommendation text,
  p_strengths text default null, p_improvements text default null, p_comments text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
begin
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if p_employee = public.my_employee_id() then raise exception 'لا يقيّم أحد تجربته'; end if;
  if e.employment_status <> 'تحت التجربة' or e.probation_end is null then
    raise exception 'الموظف ليس تحت التجربة';
  end if;
  if p_type = 'المدير' then
    if not (public.is_manager_of(p_employee) or public.is_admin()) then
      raise exception 'تقييم المدير لمديره المباشر أو مدير قسمه';
    end if;
  elsif p_type = 'HR' then
    if not public.can_manage_hr() then raise exception 'تقييم HR للموارد البشرية'; end if;
  else
    raise exception 'نوع التقييم: المدير أو HR';
  end if;
  if exists (select 1 from public.probation_decisions d
              where d.employee_id = p_employee and d.probation_end = e.probation_end) then
    raise exception 'صدر قرار هذه الفترة — التقييم مغلق';
  end if;

  insert into public.probation_reviews
    (employee_id, probation_end, reviewer_type, reviewer_id, reviewer_name, score, recommendation,
     strengths, improvements, comments)
  values (p_employee, e.probation_end, p_type, auth.uid(),
          coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'),
          p_score, p_recommendation, nullif(btrim(p_strengths), ''), nullif(btrim(p_improvements), ''),
          nullif(btrim(p_comments), ''))
  on conflict (employee_id, probation_end, reviewer_type) do update
    set reviewer_id = excluded.reviewer_id, reviewer_name = excluded.reviewer_name,
        score = excluded.score, recommendation = excluded.recommendation,
        strengths = excluded.strengths, improvements = excluded.improvements,
        comments = excluded.comments, submitted_at = now();
end $$;

create or replace function public.decide_probation(
  p_employee uuid, p_decision text, p_new_end date default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  v_who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  if not public.can_manage_hr() then raise exception 'قرار التجربة للموارد البشرية'; end if;
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if p_employee = public.my_employee_id() then raise exception 'لا يقرّر أحد في تجربته'; end if;
  if e.employment_status <> 'تحت التجربة' or e.probation_end is null then
    raise exception 'الموظف ليس تحت التجربة';
  end if;
  if p_decision not in ('تثبيت', 'تمديد', 'إنهاء') then
    raise exception 'القرار: تثبيت أو تمديد أو إنهاء';
  end if;
  if not exists (select 1 from public.probation_reviews r
                  where r.employee_id = p_employee and r.probation_end = e.probation_end and r.reviewer_type = 'HR') then
    raise exception 'يلزم تقييم HR قبل القرار';
  end if;
  if e.manager_id is not null and not exists (
       select 1 from public.probation_reviews r
        where r.employee_id = p_employee and r.probation_end = e.probation_end and r.reviewer_type = 'المدير') then
    raise exception 'يلزم تقييم المدير المباشر قبل القرار';
  end if;
  if p_decision = 'تمديد' and (p_new_end is null or p_new_end <= e.probation_end) then
    raise exception 'التمديد بتاريخ نهاية بعد % ', e.probation_end;
  end if;
  if p_decision = 'إنهاء' and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الإنهاء إلزامي';
  end if;

  insert into public.probation_decisions
    (employee_id, probation_end, decision, new_probation_end, note, decided_by, decided_by_name)
  values (p_employee, e.probation_end, p_decision,
          case when p_decision = 'تمديد' then p_new_end end, nullif(btrim(p_note), ''), auth.uid(), v_who);

  if p_decision = 'تثبيت' then
    update public.employees set employment_status = 'نشط' where id = p_employee;
    perform public.hr_notify_employee(p_employee, 'تهانينا — ثُبّتّ في وظيفتك',
      'انتهت فترة تجربتك بنجاح.', '/dashboard/me/profile', 'تجربة', p_employee, 'employee');
  elsif p_decision = 'تمديد' then
    update public.employees set probation_end = p_new_end, probation_notified_end = null where id = p_employee;
    perform public.hr_notify_employee(p_employee, 'مُدّدت فترة تجربتك',
      'حتى ' || p_new_end || coalesce(' — ' || nullif(btrim(p_note), ''), ''), '/dashboard/me/profile',
      'تجربة', p_employee, 'employee');
  else
    perform public.hr_notify_levels(array['admin'], 'إنهاء خلال التجربة: ' || e.full_name,
      btrim(p_note) || ' — أكمل «إنهاء الخدمة» من ملف الموظف (التسليم وإغلاق الحساب).',
      '/dashboard/hr/employees/' || p_employee, 'تجربة', p_employee, 'employee', 'عالية');
  end if;

  if e.manager_id is not null then
    perform public.hr_notify_employee(e.manager_id, 'قرار تجربة ' || e.full_name || ': ' || p_decision,
      coalesce(nullif(btrim(p_note), ''), ''), '/dashboard/hr/probation', 'تجربة', p_employee, 'employee');
  end if;
end $$;

-- من تحت التجربة في نطاقي — HR الكل، والمدير فريقه
create or replace function public.probation_overview()
returns table (
  employee_id uuid, employee_code text, full_name text, position_title text, department_name text,
  manager_name text, probation_start date, probation_end date, days_left int,
  manager_review boolean, hr_review boolean, manager_score int, hr_score int,
  manager_recommendation text, hr_recommendation text, last_decision text, can_decide boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.employee_code, e.full_name, e.job_title, e.department, m.full_name,
         e.probation_start, e.probation_end, (e.probation_end - public.baghdad_today())::int,
         rm.id is not null, rh.id is not null, rm.score, rh.score, rm.recommendation, rh.recommendation,
         (select d.decision || ' (' || d.probation_end || ')' from public.probation_decisions d
           where d.employee_id = e.id order by d.decided_at desc limit 1),
         public.can_manage_hr() and e.id is distinct from public.my_employee_id()
    from public.employees e
    left join public.employees m on m.id = e.manager_id
    left join public.probation_reviews rm on rm.employee_id = e.id and rm.probation_end = e.probation_end and rm.reviewer_type = 'المدير'
    left join public.probation_reviews rh on rh.employee_id = e.id and rh.probation_end = e.probation_end and rh.reviewer_type = 'HR'
   where e.status = 'active' and e.employment_status = 'تحت التجربة' and e.probation_end is not null
     and (public.can_manage_hr() or public.is_manager_of(e.id))
   order by e.probation_end;
$$;

-- تنبيه قبل نهاية التجربة بـ14 يوماً — مرةً لكل تاريخ نهاية
create or replace function public.scan_probation_endings()
returns int
language plpgsql security definer set search_path = public as $$
declare
  e record;
  n int := 0;
begin
  for e in
    select x.id, x.full_name, x.probation_end, x.manager_id
      from public.employees x
     where x.status = 'active' and x.employment_status = 'تحت التجربة' and x.probation_end is not null
       and x.probation_end <= public.baghdad_today() + 14
       and x.probation_notified_end is distinct from x.probation_end
  loop
    perform public.hr_notify_levels(array['admin', 'hr'], 'تنتهي تجربة ' || e.full_name || ' في ' || e.probation_end,
      'قيّمها وقرّر: تثبيت أو تمديد أو إنهاء.', '/dashboard/hr/probation', 'تجربة', e.id, 'employee',
      case when e.probation_end < public.baghdad_today() then 'عالية' else 'عادية' end);
    if e.manager_id is not null then
      perform public.hr_notify_employee(e.manager_id, 'قيّم تجربة ' || e.full_name,
        'تنتهي في ' || e.probation_end || ' — تقييمك مطلوب قبل القرار.', '/dashboard/hr/probation',
        'تجربة', e.id, 'employee');
    end if;
    update public.employees set probation_notified_end = e.probation_end where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.scan_probation_endings() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('probation-ending-scan')
    where exists (select 1 from cron.job where jobname = 'probation-ending-scan');
  perform cron.schedule('probation-ending-scan', '25 3 * * *', 'select public.scan_probation_endings();');
end $$;

alter table public.probation_reviews   enable row level security;
alter table public.probation_decisions enable row level security;

-- التقييمات: HR، وكاتبها، ومدير الموظف. الموظف نفسه لا يرى درجات مقيّميه.
drop policy if exists "read probation reviews" on public.probation_reviews;
create policy "read probation reviews" on public.probation_reviews for select to authenticated
  using ((select public.can_manage_hr()) or reviewer_id = (select auth.uid()) or public.is_manager_of(employee_id));

-- القرار: HR، والموظف نفسه، ومديره
drop policy if exists "read probation decisions" on public.probation_decisions;
create policy "read probation decisions" on public.probation_decisions for select to authenticated
  using ((select public.can_manage_hr()) or employee_id = (select public.my_employee_id())
         or public.is_manager_of(employee_id));

revoke all on public.probation_reviews, public.probation_decisions from anon;

drop trigger if exists trg_audit_probation_reviews on public.probation_reviews;
create trigger trg_audit_probation_reviews after insert or update or delete on public.probation_reviews
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_probation_decisions on public.probation_decisions;
create trigger trg_audit_probation_decisions after insert or update or delete on public.probation_decisions
  for each row execute function public.audit_row();


revoke all on function public.refresh_onboarding(uuid)                       from public, anon, authenticated;
revoke all on function public.generate_onboarding(uuid)                      from public, anon, authenticated;
revoke all on function public.start_onboarding(uuid)                         from public, anon;
revoke all on function public.complete_onboarding_task(uuid, text, text)     from public, anon;
revoke all on function public.is_manager_of(uuid)                            from public, anon;
revoke all on function public.submit_probation_review(uuid, text, int, text, text, text, text) from public, anon;
revoke all on function public.decide_probation(uuid, text, date, text)       from public, anon;
revoke all on function public.probation_overview()                           from public, anon;
grant execute on function public.start_onboarding(uuid)                      to authenticated;
grant execute on function public.complete_onboarding_task(uuid, text, text)  to authenticated;
grant execute on function public.is_manager_of(uuid)                         to authenticated;
grant execute on function public.submit_probation_review(uuid, text, int, text, text, text, text) to authenticated;
grant execute on function public.decide_probation(uuid, text, date, text)    to authenticated;
grant execute on function public.probation_overview()                        to authenticated;
