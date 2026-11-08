-- ============================================================
-- تلال ERP — 223: دوام خاص لكل يوم — لكل يوم من أيام دوام الموظف
--                 وقت بداية ونهاية خاص به
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- قبلها: الدوام الخاص (025) وقتٌ واحد لكل الأيام. اليوم: الأحد 10–6
--   والاثنين 11–7 لموظفٍ واحد غير ممكن.
--
-- الحلّ:
--   (١) employees.work_day_hours (jsonb) — مفتاحه رقم اليوم (0=الأحد …
--       6=السبت) وقيمته {"start":"HH:MI","end":"HH:MI"}. فارغ = نفس الوقت
--       لكل الأيام كما كان. ويوم دوام بلا مفتاح ← work_start_time/end_time.
--   (٢) work_schedule_on — المصدر الوحيد لدوام يومٍ بعينه (154) — تقرأ وقت
--       اليوم أولاً. منها يأخذ: خصم التأخير والغياب، الانصراف التلقائي،
--       العمل الإضافي، تقارير HR ولوحتها، الأهداف.
--   (٣) إجازة الساعات تُحسب بساعات يوم بدايتها لا بالوقت العام.
--   (٤) team_members يحمل العمود (الحضور عند المشرف والمتابعة).
--
-- ما لا يتغيّر: الوردية (154) تسبق الدوام الخاص، وأيام الدوام من work_days.
--
-- يتطلب: 025، 154، 216. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) العمود وحراسته
-- ------------------------------------------------------------
alter table public.employees
  add column if not exists work_day_hours jsonb;

create or replace function public.valid_work_day_hours(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text; v jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[0-6]$' or jsonb_typeof(v) <> 'object' then return false; end if;
    if coalesce(v->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
       or coalesce(v->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
      return false;
    end if;
    if (v->>'end')::time <= (v->>'start')::time then return false; end if;
  end loop;
  return true;
end $$;

alter table public.employees drop constraint if exists employees_day_hours_chk;
alter table public.employees add constraint employees_day_hours_chk
  check (public.valid_work_day_hours(work_day_hours));

-- ------------------------------------------------------------
-- 2) دوام يومٍ بعينه: وردية ← وقت هذا اليوم ← الدوام الخاص ← دوام الشركة
-- ------------------------------------------------------------
create or replace function public.work_schedule_on(p_employee uuid, p_date date)
returns table (start_time time, end_time time, work_days int[], source text)
language sql stable security definer set search_path = public as $$
  select coalesce(sh.start_time, (dh->>'start')::time, e.work_start_time, s.work_start_time),
         coalesce(sh.end_time,   (dh->>'end')::time,   e.work_end_time,   s.work_end_time),
         coalesce(sh.work_days,
                  case when e.work_days is not null and array_length(e.work_days, 1) > 0 then e.work_days end,
                  s.work_days),
         case when sh.id is not null then 'وردية: ' || sh.name_ar
              when e.work_start_time is not null or e.work_days is not null
                   or e.work_day_hours is not null then 'دوام خاص'
              else 'دوام الشركة' end
    from public.employees e
    cross join public.company_settings s
    cross join lateral (
      select e.work_day_hours -> extract(dow from p_date)::int::text as dh
    ) d
    left join lateral (
      select w.* from public.employee_shifts es join public.work_shifts w on w.id = es.shift_id
       where es.employee_id = e.id and es.start_date <= p_date
         and coalesce(es.end_date, 'infinity'::date) >= p_date
       order by es.start_date desc limit 1
    ) sh on true
   where e.id = p_employee and s.id = 1;
$$;

-- ------------------------------------------------------------
-- 3) إجازة الساعات: ساعات يوم بدايتها
-- ------------------------------------------------------------
create or replace function public.leave_consumed_days(l public.leaves)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_hours numeric; sch record;
begin
  if l.duration_type = 'ساعات' then
    select * into sch from public.work_schedule_on(l.employee_id, l.start_date);
    v_hours := greatest(extract(epoch from (sch.end_time - sch.start_time))/3600.0, 1);
    return round(coalesce(l.hours, 0) / v_hours, 2);
  end if;
  return coalesce(l.days, 0);
end;
$$;

-- ------------------------------------------------------------
-- 4) المنظور الآمن — work_day_hours في آخره
-- ------------------------------------------------------------
create or replace view public.team_members
with (security_invoker = false) as
  select e.id, e.user_id, e.full_name, e.job_title, e.department,
         e.phone, e.hire_date, e.status, e.project_id,
         e.exempt_from_attendance, e.work_start_time, e.work_end_time, e.work_days,
         coalesce((select array_agg(ep.project_id order by ep.created_at, ep.project_id)
                     from public.employee_projects ep
                    where ep.employee_id = e.id), '{}'::uuid[]) as project_ids,
         e.work_day_hours
    from public.employees e
   where public.is_admin()
      or public.is_followup_manager()
      or e.id in (select m.id from public.my_scope_employees() m);

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

notify pgrst, 'reload schema';
