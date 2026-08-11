-- ============================================================
-- تلال ERP — الفرق والمشاريع ودور المشرف (Supervisor)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-08-11):
--   • تقسيم الموظفين إلى فرق، وتقسيم المشاريع العقارية على الفرق.
--   • دور ثالث «مشرف»: يشرف على فريق، يرى ليدات فريقه ويتابعهم في CRM.
--   • صلاحياته محدودة: لا محاسبة ولا رواتب ولا ملفات إدارية.
--
-- **المبدأ الحاكم لكل سياسة هنا:**
--     المشرف = موظف، لكن نطاقه **فريقه** بدل نفسه.
--   فحيثما كان الموظف يرى نفسه، يرى المشرف كل فريقه — ولا شيء أكثر.
--
-- ⚠️ يصلح هذا الملف أيضاً ثغرة قائمة: سياسات `tasks_*` القديمة كانت
--    تسمح لأي مستخدم مسجّل بقراءة **كل** المهام وإنشاء مهمة لأي أحد،
--    وهي تُبطل السياسات الصحيحة لأن السياسات المتساهلة تُجمع بـ OR.
--
-- يتطلب: sql/005 و sql/008 و sql/012 و sql/031 و sql/032. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الأدوار الثلاثة
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in ('admin', 'supervisor', 'employee'));

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'supervisor', false);
$$;

-- ------------------------------------------------------------
-- 2) الفرق
-- ------------------------------------------------------------
create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null unique,
  -- المشرف موظف بذاته، وقد يكون عضواً في فريقه أيضاً
  supervisor_id uuid references public.employees(id) on delete set null,
  is_active     boolean not null default true,
  notes         text
);

alter table public.employees add column if not exists team_id uuid;
do $$ begin
  alter table public.employees
    add constraint employees_team_fk foreign key (team_id)
    references public.teams(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists employees_team_idx on public.employees (team_id);
create index if not exists teams_supervisor_idx on public.teams (supervisor_id);

-- ------------------------------------------------------------
-- 3) المشاريع — تحويل النصّ الحرّ في units.project إلى جدول حقيقي
-- ------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null unique,
  governorate  text,
  area         text,
  status       text not null default 'نشط' check (status in ('نشط', 'مكتمل', 'متوقف')),
  -- فارغ = مشروع مشترك يراه الجميع
  team_id      uuid references public.teams(id) on delete set null,
  description  text
);

create index if not exists projects_team_idx on public.projects (team_id);

alter table public.units add column if not exists project_id uuid;
do $$ begin
  alter table public.units
    add constraint units_project_fk foreign key (project_id)
    references public.projects(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists units_project_idx on public.units (project_id);

-- نقل أسماء المشاريع الموجودة ثم ربط الوحدات بها
insert into public.projects (name)
select distinct btrim(u.project)
  from public.units u
 where u.project is not null and btrim(u.project) <> ''
on conflict (name) do nothing;

update public.units u
   set project_id = p.id
  from public.projects p
 where u.project_id is null
   and p.name = btrim(u.project);

-- عمود units.project النصّي ما زال مستخدَماً في استعلامات مضمّنة
-- (الحجوزات تجلب `units(project, unit_code)`)، فنُبقيه متزامناً تلقائياً
-- بدل أن نكسر تلك الاستعلامات.
create or replace function public.sync_unit_project_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null then
    select name into new.project from public.projects where id = new.project_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_sync_unit_project on public.units;
create trigger trg_sync_unit_project
  before insert or update of project_id on public.units
  for each row execute function public.sync_unit_project_name();

-- ------------------------------------------------------------
-- 4) دوال النطاق — قلب نموذج الصلاحيات كله
-- ------------------------------------------------------------

-- الفرق التي أقودها كمشرف
-- ملاحظة: `returns table` لا `setof` — لأن setof لا تُسمّي عمودها
-- فلا يصحّ `select id from f()` وهو ما تحتاجه السياسات أدناه.
drop function if exists public.my_supervised_teams() cascade;
create function public.my_supervised_teams()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select t.id from public.teams t
   where t.is_active
     and t.supervisor_id is not null
     and t.supervisor_id = public.my_employee_id();
$$;

-- كل فرقي: ما أقوده + الفريق الذي أنتمي إليه
drop function if exists public.my_team_ids() cascade;
create function public.my_team_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select s.id from public.my_supervised_teams() s
  union
  select e.team_id from public.employees e
   where e.user_id = auth.uid() and e.team_id is not null;
$$;

-- الموظفون الذين يشملهم نطاقي: أنا + كل من في الفرق التي أقودها.
-- الموظف العادي يرجع لنفسه فقط، فنفس الدالة تخدم الدورين.
drop function if exists public.my_scope_employees() cascade;
create function public.my_scope_employees()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.user_id = auth.uid()
  union
  select e.id from public.employees e
   where e.team_id in (select s.id from public.my_supervised_teams() s);
$$;

-- حسابات الدخول المقابلة (للمهام والمحادثات)
drop function if exists public.my_scope_users() cascade;
create function public.my_scope_users()
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select e.user_id from public.employees e
   where e.user_id is not null
     and e.id in (select m.id from public.my_scope_employees() m);
$$;

-- مفاتيح أسماء نطاقي — عليها يُبنى ربط العميل بموظف المبيعات
drop function if exists public.my_scope_name_keys() cascade;
create function public.my_scope_name_keys()
returns table (name_key text) language sql stable security definer set search_path = public as $$
  select public.name_key(e.full_name) from public.employees e
   where e.id in (select m.id from public.my_scope_employees() m);
$$;

-- ------------------------------------------------------------
-- 5) صلاحيات الفرق والمشاريع
-- ------------------------------------------------------------
alter table public.teams    enable row level security;
alter table public.projects enable row level security;

-- الجميع يقرأ أسماء الفرق (تظهر في القوائم)، والإدارة وحدها تُعدّل
drop policy if exists "read teams" on public.teams;
create policy "read teams" on public.teams
  for select to authenticated using (true);

drop policy if exists "admins manage teams" on public.teams;
create policy "admins manage teams" on public.teams
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- المشاريع: الإدارة ترى الكل، وغيرها يرى المشترك ومشاريع فرقه
drop policy if exists "read projects in scope" on public.projects;
create policy "read projects in scope" on public.projects
  for select to authenticated
  using (
    (select public.is_admin())
    or team_id is null
    or team_id in (select m.id from public.my_team_ids() m)
  );

drop policy if exists "admins manage projects" on public.projects;
create policy "admins manage projects" on public.projects
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 6) العملاء — نفس القاعدة، بنطاق الفريق
-- ------------------------------------------------------------
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)
    )
  );

drop policy if exists "update own clients" on public.clients;
create policy "update own clients" on public.clients
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (sales_employee is not null
        and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
  )
  with check (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (sales_employee is not null
        and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
  );

-- سجلّ التواصل يتبع صلاحية العميل نفسه
create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
       )
  );
$$;

-- ------------------------------------------------------------
-- 7) المهام — إزالة السياسات القديمة المتساهلة ثم نطاق الفريق
-- ------------------------------------------------------------
-- ⚠️ هذه الأربع كانت تسمح لأي مستخدم بقراءة كل المهام وإنشاء مهمة
--    لأي أحد. وجودها يُبطل السياسات الصحيحة (السياسات تُجمع بـ OR).
drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

drop policy if exists "read my tasks" on public.tasks;
create policy "read my tasks" on public.tasks
  for select to authenticated
  using (
    (select public.is_admin())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or assigned_to = (select auth.uid())
      -- المشرف يُسند المهام لفريقه
      or assigned_to in (select u.user_id from public.my_scope_users() u)
    )
  );

drop policy if exists "update my tasks" on public.tasks;
create policy "update my tasks" on public.tasks
  for update to authenticated
  using (
    (select public.is_admin())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  )
  with check (
    (select public.is_admin())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

drop policy if exists "delete my tasks" on public.tasks;
create policy "delete my tasks" on public.tasks
  for delete to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()));

-- ------------------------------------------------------------
-- 8) الوحدات — يراها من يملك مشروعها
-- ------------------------------------------------------------
drop policy if exists "authenticated can read units" on public.units;
create policy "read units in scope" on public.units
  for select to authenticated
  using (
    (select public.is_admin())
    or project_id is null              -- وحدة بلا مشروع: مشتركة
    or exists (
      select 1 from public.projects p
       where p.id = units.project_id
         and (p.team_id is null or p.team_id in (select m.id from public.my_team_ids() m))
    )
  );

-- ------------------------------------------------------------
-- 9) الفواتير والمدفوعات — كانت مفتوحة لكل مستخدم مسجّل
-- ------------------------------------------------------------
-- الآن: الإدارة ترى الكل، وغيرها يرى فواتير عملاء نطاقه فقط،
-- **قراءة بلا تعديل** (الإنشاء والتعديل والحذف للإدارة).
drop policy if exists "auth read invoices" on public.invoices;
create policy "read invoices in scope" on public.invoices
  for select to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id));

drop policy if exists "auth insert invoices" on public.invoices;
create policy "admins insert invoices" on public.invoices
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "auth read payments" on public.payments;
create policy "read payments in scope" on public.payments
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.invoices i
       where i.id = payments.invoice_id and public.can_see_client(i.client_id)
    )
  );

drop policy if exists "auth insert payments" on public.payments;
create policy "admins insert payments" on public.payments
  for insert to authenticated with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 10) الحجوزات — نطاق العميل نفسه
-- ------------------------------------------------------------
drop policy if exists "authenticated can read reservations" on public.reservations;
create policy "read reservations in scope" on public.reservations
  for select to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id));

-- ------------------------------------------------------------
-- 11) الدوام والإجازات — المشرف يرى فريقه ويبتّ إجازاتهم
-- ------------------------------------------------------------
drop policy if exists "emp read attendance" on public.attendance;
create policy "read attendance in scope" on public.attendance
  for select to authenticated
  using (
    (select public.is_admin())
    or employee_id in (select m.id from public.my_scope_employees() m)
  );

drop policy if exists "emp read leaves" on public.leaves;
create policy "read leaves in scope" on public.leaves
  for select to authenticated
  using (
    (select public.is_admin())
    or employee_id in (select m.id from public.my_scope_employees() m)
  );

-- المشرف يوافق أو يرفض إجازات فريقه — ولا يمسّ إجازته هو
-- (لا يوافق أحد على إجازة نفسه).
drop policy if exists "supervisor decides team leaves" on public.leaves;
create policy "supervisor decides team leaves" on public.leaves
  for update to authenticated
  using (
    employee_id in (select m.id from public.my_scope_employees() m)
    and employee_id <> public.my_employee_id()
  )
  with check (
    employee_id in (select m.id from public.my_scope_employees() m)
    and employee_id <> public.my_employee_id()
  );

-- ------------------------------------------------------------
-- 12) بيانات الفريق للمشرف — بلا رواتب
-- ------------------------------------------------------------
-- سياسات RLS تعمل على مستوى **الصف** لا العمود، فلو سمحنا للمشرف
-- بقراءة صفوف employees لرأى base_salary. الحل: منظور يكشف الأعمدة
-- الآمنة وحدها، ويبقى الجدول نفسه ممنوعاً عليه.
drop view if exists public.team_members;
create view public.team_members
with (security_invoker = false) as
  select e.id, e.user_id, e.full_name, e.job_title, e.department,
         e.phone, e.hire_date, e.status, e.team_id,
         e.exempt_from_attendance, e.work_start_time, e.work_end_time, e.work_days
    from public.employees e
   where public.is_admin()
      or e.id in (select m.id from public.my_scope_employees() m);

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

grant execute on function public.my_role()              to authenticated;
grant execute on function public.is_supervisor()        to authenticated;
grant execute on function public.my_team_ids()          to authenticated;
grant execute on function public.my_supervised_teams()  to authenticated;
grant execute on function public.my_scope_employees()   to authenticated;
grant execute on function public.my_scope_users()       to authenticated;
grant execute on function public.my_scope_name_keys()   to authenticated;

notify pgrst, 'reload schema';
