-- ============================================================
-- تلال ERP — التقسيم على المشاريع مباشرة (يُبسّط sql/036)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- التصحيح (2026-08-11): وضّح المستخدم أن **المشروع نفسه** هو وحدة
-- التقسيم — «الموظفون مقسّمون على المشاريع، والمشرف مسؤول عن مشروع».
-- فطبقة «الفريق» التي أنشأها 036 زائدة، ونحذفها.
--
-- النموذج الآن:
--     projects.supervisor_id  →  من يشرف على المشروع
--     employees.project_id    →  على أي مشروع يعمل الموظف
--
-- ويبقى المبدأ الحاكم كما هو:
--     المشرف = موظف، لكن نطاقه **مشروعه** بدل نفسه.
--
-- مشرف واحد يقدر يمسك أكثر من مشروع (علاقة واحد-لمتعدّد)، والموظف
-- على مشروع واحد. والمشروع بلا مشرف أو الوحدة بلا مشروع = مشترك.
--
-- يتطلب: sql/036. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الأعمدة الجديدة
-- ------------------------------------------------------------
alter table public.projects  add column if not exists supervisor_id uuid;
alter table public.employees add column if not exists project_id    uuid;

do $$ begin
  alter table public.projects
    add constraint projects_supervisor_fk foreign key (supervisor_id)
    references public.employees(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.employees
    add constraint employees_project_fk foreign key (project_id)
    references public.projects(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists projects_supervisor_idx on public.projects  (supervisor_id);
create index if not exists employees_project_idx   on public.employees (project_id);

-- ------------------------------------------------------------
-- 2) دوال النطاق — نفس الأسماء والتواقيع، بأجساد قائمة على المشروع
-- ------------------------------------------------------------
-- الأسماء والتواقيع تبقى كما هي عمداً: كل سياسات 036 مبنية عليها،
-- فاستبدال الجسم وحده يجنّبنا إسقاط وإعادة بناء عشرات السياسات.

-- المشاريع التي أشرف عليها
create or replace function public.my_supervised_projects()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select p.id from public.projects p
   where p.supervisor_id is not null
     and p.supervisor_id = public.my_employee_id();
$$;

-- كل مشاريعي: ما أشرف عليه + المشروع الذي أعمل فيه
create or replace function public.my_project_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select s.id from public.my_supervised_projects() s
  union
  select e.project_id from public.employees e
   where e.user_id = auth.uid() and e.project_id is not null;
$$;

-- أنا + كل من يعمل على المشاريع التي أشرف عليها.
-- الموظف العادي لا يشرف على شيء، فترجع له نفسه فقط — نفس الدالة
-- تخدم الدورين بلا شرط على الدور.
create or replace function public.my_scope_employees()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.user_id = auth.uid()
  union
  select e.id from public.employees e
   where e.project_id in (select s.id from public.my_supervised_projects() s);
$$;

-- ------------------------------------------------------------
-- 3) السياستان الوحيدتان اللتان كانتا تشيران إلى الفرق
-- ------------------------------------------------------------
drop policy if exists "read projects in scope" on public.projects;
create policy "read projects in scope" on public.projects
  for select to authenticated
  using (
    (select public.is_admin())
    or supervisor_id is null            -- مشروع بلا مشرف = مشترك
    or id in (select m.id from public.my_project_ids() m)
  );

drop policy if exists "read units in scope" on public.units;
create policy "read units in scope" on public.units
  for select to authenticated
  using (
    (select public.is_admin())
    or project_id is null               -- وحدة بلا مشروع = مشتركة
    or project_id in (select m.id from public.my_project_ids() m)
    or exists (
      select 1 from public.projects p
       where p.id = units.project_id and p.supervisor_id is null
    )
  );

-- ------------------------------------------------------------
-- 4) منظور الفريق — صار يعرض المشروع بدل الفريق
-- ------------------------------------------------------------
-- (التذكير: RLS تعمل على الصف لا العمود، فلو فتحنا employees للمشرف
--  لرأى base_salary. المنظور يكشف الأعمدة الآمنة وحدها.)
drop view if exists public.team_members;
create view public.team_members
with (security_invoker = false) as
  select e.id, e.user_id, e.full_name, e.job_title, e.department,
         e.phone, e.hire_date, e.status, e.project_id,
         e.exempt_from_attendance, e.work_start_time, e.work_end_time, e.work_days
    from public.employees e
   where public.is_admin()
      or e.id in (select m.id from public.my_scope_employees() m);

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

grant execute on function public.my_supervised_projects() to authenticated;
grant execute on function public.my_project_ids()         to authenticated;

-- ------------------------------------------------------------
-- 5) إزالة طبقة الفرق
-- ------------------------------------------------------------
-- تُحذف بعد أن صارت كل السياسات تعتمد المشاريع. الجدول لم يُستعمل
-- ولم تُنشأ فيه صفوف، فالحذف بلا فقدان بيانات.
drop function if exists public.my_team_ids()         cascade;
drop function if exists public.my_supervised_teams() cascade;

alter table public.projects  drop column if exists team_id;
alter table public.employees drop column if exists team_id;
drop table if exists public.teams cascade;

notify pgrst, 'reload schema';
