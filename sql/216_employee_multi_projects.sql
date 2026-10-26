-- ============================================================
-- تلال ERP — الموظف على أكثر من مشروع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-10-26): «إمكانية إسناد أكثر من مشروع لشخص واحد».
--
-- كان النموذج منذ 037: employees.project_id — مشروع واحد للموظف.
-- المشرف يمسك أكثر من مشروع أصلاً (projects.supervisor_id)، فالناقص
-- هو جهة الموظف وحدها.
--
-- النموذج الآن:
--     employee_projects (employee_id, project_id)  →  كل مشاريع الموظف
--     employees.project_id                          →  «المشروع الأساسي»
--
-- لماذا نُبقي employees.project_id؟ لأنه بُعدٌ في عشرات الدوال
-- (نَسب الليد لمشروع، حقائق التقارير، كلفة الرواتب، مركز الكلفة…)
-- وكلها تحتاج مشروعاً **واحداً**. فالأساسي يبقى لها كما هو، والجدول
-- الجديد يوسّع **النطاق** وحده: من يرى من، ومن يُوزَّع عليه الليد.
--
-- الثابت الذي تحرسه المشغّلات:
--     project_id فارغ  ⇔  لا عضوية للموظف
--     project_id غير فارغ ⇒ له صفّ عضوية بنفس المشروع
--
-- شاشة HR التي تكتب employees.project_id مباشرةً تبقى تعمل كما كانت:
-- تغيير الأساسي من أ إلى ب ينقل الموظف (يُزيل أ ويضيف ب). أما الإسناد
-- المتعدّد فمن شاشة المشاريع عبر set_employee_projects().
--
-- يتطلب: sql/037. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الجدول + تعبئته من الإسناد الحالي
-- ------------------------------------------------------------
create table if not exists public.employee_projects (
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id  uuid not null references public.projects(id)  on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  primary key (employee_id, project_id)
);

-- النطاق يسأل «من على مشاريعي؟» — أي بالمشروع
create index if not exists employee_projects_project_idx
  on public.employee_projects (project_id, employee_id);

insert into public.employee_projects (employee_id, project_id, created_by)
select e.id, e.project_id, null
  from public.employees e
 where e.project_id is not null
on conflict do nothing;

-- ------------------------------------------------------------
-- 2) المزامنة بين الأساسي والعضويات
-- ------------------------------------------------------------
-- set_employee_projects() يضبط الطرفين بنفسه، فيُطفئ المشغّلين بهذا
-- العَلَم (نفس نمط tilal.merging في 104).

-- (أ) كتابة الأساسي مباشرةً (شاشة HR، إنشاء موظف): الأساسي الجديد
--     عضوية، والقديم يُزال — «نقل» كما كان قبل هذه الهجرة.
create or replace function public.sync_employee_primary_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tilal.employee_projects', true), '') = 'off' then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.project_id is not null
     and old.project_id is distinct from new.project_id then
    delete from public.employee_projects
     where employee_id = new.id and project_id = old.project_id;
  end if;

  if new.project_id is not null then
    insert into public.employee_projects (employee_id, project_id)
    values (new.id, new.project_id)
    on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_employee_primary_project on public.employees;
create trigger trg_sync_employee_primary_project
  after insert or update of project_id on public.employees
  for each row execute function public.sync_employee_primary_project();

-- (ب) إزالة عضوية هي الأساسي (أو حذف المشروع كله، وقد صفّر FK
--     الأساسي قبلها): يصير الأساسي أقدم عضوية باقية، أو فارغاً.
create or replace function public.repair_employee_primary_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tilal.employee_projects', true), '') = 'off' then
    return null;
  end if;

  update public.employees e
     set project_id = (select ep.project_id from public.employee_projects ep
                        where ep.employee_id = old.employee_id
                        order by ep.created_at, ep.project_id
                        limit 1)
   where e.id = old.employee_id
     and (e.project_id = old.project_id or e.project_id is null);
  return null;
end $$;

drop trigger if exists trg_repair_employee_primary_project on public.employee_projects;
create trigger trg_repair_employee_primary_project
  after delete on public.employee_projects
  for each row execute function public.repair_employee_primary_project();

-- ------------------------------------------------------------
-- 3) الإسناد المتعدّد — دالة واحدة ذرّية تضبط المجموعة كاملة
-- ------------------------------------------------------------
-- p_project_ids = كل مشاريع الموظف بعد الحفظ (فارغة = بلا مشروع).
-- p_primary    = الأساسي؛ إن لم يُمرَّر أو لم يكن ضمن المجموعة بقي
--                الأساسي الحالي إن كان ضمنها، وإلا أوّل المجموعة.
create or replace function public.set_employee_projects(
  p_employee_id uuid,
  p_project_ids uuid[],
  p_primary     uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ids     uuid[] := coalesce(array(select distinct x from unnest(p_project_ids) x
                                      where x is not null), '{}');
  v_current uuid;
  v_primary uuid;
begin
  if not (public.is_admin() or public.is_hr()) then
    raise exception 'إسناد الموظفين للمشاريع للإدارة وحدها';
  end if;

  select e.project_id into v_current from public.employees e where e.id = p_employee_id;
  if not found then
    raise exception 'الموظف غير موجود';
  end if;

  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.projects p where p.id = x)) then
    raise exception 'مشروع غير موجود في القائمة';
  end if;

  v_primary := case
    when p_primary = any(v_ids) then p_primary
    when v_current = any(v_ids) then v_current
    else v_ids[1]               -- فارغة ⇒ null
  end;

  perform set_config('tilal.employee_projects', 'off', true);

  delete from public.employee_projects
   where employee_id = p_employee_id and not (project_id = any(v_ids));

  insert into public.employee_projects (employee_id, project_id)
  select p_employee_id, x from unnest(v_ids) x
  on conflict do nothing;

  update public.employees set project_id = v_primary
   where id = p_employee_id and project_id is distinct from v_primary;

  perform set_config('tilal.employee_projects', '', true);
  return v_primary;
end $$;

revoke all on function public.set_employee_projects(uuid, uuid[], uuid) from public, anon;
grant execute on function public.set_employee_projects(uuid, uuid[], uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) الصلاحيات — قراءة بنطاق، والكتابة عبر الدالة وحدها
-- ------------------------------------------------------------
alter table public.employee_projects enable row level security;

drop policy if exists "read employee projects" on public.employee_projects;
create policy "read employee projects" on public.employee_projects
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_hr())
    or (select public.is_followup_manager())
    or employee_id in (select m.id from public.my_scope_employees() m)
  );

revoke insert, update, delete on public.employee_projects from anon, authenticated;
grant select on public.employee_projects to authenticated;

-- ------------------------------------------------------------
-- 5) دوال النطاق — نفس الأسماء والتواقيع (كل السياسات مبنية عليها)
-- ------------------------------------------------------------

-- كل مشاريعي: ما أشرف عليه + كل مشروع أعمل فيه
create or replace function public.my_project_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select s.id from public.my_supervised_projects() s
  union
  select ep.project_id from public.employee_projects ep
   where ep.employee_id = public.my_employee_id()
  union
  select e.project_id from public.employees e
   where e.user_id = auth.uid() and e.project_id is not null;
$$;

-- أنا + كل من له عضوية في مشروع أشرف عليه
create or replace function public.my_scope_employees()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.user_id = auth.uid()
  union
  select ep.employee_id from public.employee_projects ep
   where ep.project_id in (select s.id from public.my_supervised_projects() s)
  union
  select e.id from public.employees e
   where e.project_id in (select s.id from public.my_supervised_projects() s);
$$;

-- قاعدة التوزيع على «فريق مشروع»: كل من له عضوية فيه، لا الأساسي وحده
create or replace function public.crm_assignment_candidates(p_rule_id uuid)
returns table (employee_id uuid, full_name text, open_leads bigint)
language sql stable security definer set search_path = public as $$
  with rule as (
    select * from public.crm_assignment_rules where id = p_rule_id
  )
  select e.id,
         e.full_name,
         count(c.id) filter (where public.is_open_stage(c.stage)) as open_leads
    from public.employees e
    cross join rule r
    left join public.clients c on c.owner_id = e.id
   where e.user_id is not null
     and e.status = 'active'
     and e.end_date is null
     and (r.target_owner_id is null or e.id = r.target_owner_id)
     and (r.target_team_id  is null
          or e.project_id = r.target_team_id
          or exists (select 1 from public.employee_projects ep
                      where ep.employee_id = e.id and ep.project_id = r.target_team_id))
   group by e.id, e.full_name
   order by e.full_name;
$$;

-- ------------------------------------------------------------
-- 6) المنظور الآمن — عمود project_ids في آخره (project_id = الأساسي)
-- ------------------------------------------------------------
create or replace view public.team_members
with (security_invoker = false) as
  select e.id, e.user_id, e.full_name, e.job_title, e.department,
         e.phone, e.hire_date, e.status, e.project_id,
         e.exempt_from_attendance, e.work_start_time, e.work_end_time, e.work_days,
         coalesce((select array_agg(ep.project_id order by ep.created_at, ep.project_id)
                     from public.employee_projects ep
                    where ep.employee_id = e.id), '{}'::uuid[]) as project_ids
    from public.employees e
   where public.is_admin()
      or public.is_followup_manager()
      or e.id in (select m.id from public.my_scope_employees() m);

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

notify pgrst, 'reload schema';
