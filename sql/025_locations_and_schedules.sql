-- ============================================================
-- تلال ERP — مواقع عمل متعددة + إعفاء من البصمة + دوام خاص لكل موظف
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يضيفه:
--   1) جدول work_locations — أكثر من موقع عمل، والبصمة تُقبل من أي موقع.
--   2) عمود location_name على الحضور — يسجّل من أي موقع بصم الموظف.
--   3) employees.exempt_from_attendance — الإدارة معفاة من البصمة.
--   4) دوام خاص لكل موظف (وقت البداية والنهاية وأيام الدوام).
--
-- يتطلب: sql/021 و sql/024. الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) مواقع العمل
-- ------------------------------------------------------------
create table if not exists public.work_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   integer not null default 1000,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.work_locations enable row level security;

-- الموظف يحتاج يقرأها ليعرف كم يبعد عن أقرب موقع، والمدير وحده يعدّل
drop policy if exists "read work_locations" on public.work_locations;
create policy "read work_locations" on public.work_locations
  for select to authenticated using (true);

drop policy if exists "admin write work_locations" on public.work_locations;
create policy "admin write work_locations" on public.work_locations
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ننقل الموقع القديم من إعدادات الشركة ليصير أول موقع (مرة واحدة فقط)
insert into public.work_locations (name, lat, lng, radius_m, is_active)
select coalesce(s.office_name, 'مركز المبيعات'),
       s.office_lat, s.office_lng,
       coalesce(s.geofence_radius_m, 1000),
       true
  from public.company_settings s
 where s.id = 1
   and s.office_lat is not null
   and s.office_lng is not null
   and not exists (select 1 from public.work_locations);

-- ------------------------------------------------------------
-- 2) من أي موقع صارت البصمة
-- ------------------------------------------------------------
alter table public.attendance
  add column if not exists check_in_location  text,
  add column if not exists check_out_location text;

-- ------------------------------------------------------------
-- 3) إعفاء من البصمة + دوام خاص لكل موظف
--    (الأعمدة الفارغة تعني: استخدم دوام الشركة العام)
-- ------------------------------------------------------------
alter table public.employees
  add column if not exists exempt_from_attendance boolean not null default false,
  add column if not exists work_start_time time,
  add column if not exists work_end_time   time,
  add column if not exists work_days       integer[];

alter table public.employees drop constraint if exists employees_hours_chk;
alter table public.employees add constraint employees_hours_chk
  check (
    (work_start_time is null and work_end_time is null)
    or (work_start_time is not null and work_end_time is not null
        and work_end_time > work_start_time)
  );

-- الموظفون المرتبطون بحسابات إدارية يُعفَون تلقائياً
update public.employees e
   set exempt_from_attendance = true
  from public.profiles p
 where e.user_id = p.id
   and p.role = 'admin'
   and e.exempt_from_attendance = false;

-- ------------------------------------------------------------
-- 4) تحقّق النطاق: تُقبل البصمة من **أي** موقع عمل نشط
--    ونسجّل اسم أقرب موقع والمسافة إليه.
-- ------------------------------------------------------------
create or replace function public.enforce_attendance_geofence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s          record;
  emp        record;
  nearest    record;
  new_in     boolean;
  new_out    boolean;
  loc_count  integer;
begin
  select * into s from public.company_settings where id = 1;
  select * into emp from public.employees where id = new.employee_id;

  -- المدير يسجّل يدوياً بدون قيد الموقع
  if public.is_admin() then
    if new.source is null then new.source := 'تسجيل يدوي بواسطة المدير'; end if;
    return new;
  end if;

  if new.source is null then new.source := 'بصمة ذاتية'; end if;

  -- المعفيّون من البصمة لا يخضعون لقيد الموقع
  if emp.exempt_from_attendance then
    return new;
  end if;

  select count(*) into loc_count from public.work_locations where is_active;

  -- الميزة معطّلة أو لا توجد مواقع مضبوطة → لا نمنع أحداً
  if s is null or not s.geofence_enabled or loc_count = 0 then
    return new;
  end if;

  new_in  := new.check_in  is not null
             and (tg_op = 'INSERT' or old.check_in  is distinct from new.check_in);
  new_out := new.check_out is not null
             and (tg_op = 'INSERT' or old.check_out is distinct from new.check_out);

  -- بصمة الحضور
  if new_in then
    if new.check_in_lat is null or new.check_in_lng is null then
      raise exception 'لتسجيل البصمة يجب السماح للتطبيق بالوصول إلى موقعك.';
    end if;

    select l.name,
           public.geo_distance_m(new.check_in_lat, new.check_in_lng, l.lat, l.lng) as d,
           l.radius_m
      into nearest
      from public.work_locations l
     where l.is_active
     order by 2 asc
     limit 1;

    new.check_in_distance_m := round(nearest.d);
    new.check_in_location   := nearest.name;

    if nearest.d > nearest.radius_m then
      raise exception 'أنت خارج نطاق مواقع العمل. أقرب موقع «%» يبعد عنك % متر والمسموح % متر.',
        nearest.name, round(nearest.d), nearest.radius_m;
    end if;
  end if;

  -- بصمة الانصراف
  if new_out then
    if new.check_out_lat is null or new.check_out_lng is null then
      raise exception 'لتسجيل الانصراف يجب السماح للتطبيق بالوصول إلى موقعك.';
    end if;

    select l.name,
           public.geo_distance_m(new.check_out_lat, new.check_out_lng, l.lat, l.lng) as d,
           l.radius_m
      into nearest
      from public.work_locations l
     where l.is_active
     order by 2 asc
     limit 1;

    new.check_out_distance_m := round(nearest.d);
    new.check_out_location   := nearest.name;

    if nearest.d > nearest.radius_m then
      raise exception 'أنت خارج نطاق مواقع العمل. أقرب موقع «%» يبعد عنك % متر والمسموح % متر.',
        nearest.name, round(nearest.d), nearest.radius_m;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_attendance_geofence on public.attendance;
create trigger trg_attendance_geofence
  before insert or update on public.attendance
  for each row execute function public.enforce_attendance_geofence();

notify pgrst, 'reload schema';
