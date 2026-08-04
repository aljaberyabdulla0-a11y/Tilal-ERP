-- ============================================================
-- تلال ERP — بصمة الحضور بالموقع الجغرافي (Geofence)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يضيفه:
--   1) إعدادات الشركة: إحداثيات مركز المبيعات + نطاق مسموح (افتراضياً 1 كم)
--   2) أعمدة الموقع على جدول الحضور (خط الطول والعرض والمسافة بالمتر)
--   3) تحقّق من جهة الخادم يرفض البصمة خارج النطاق — لا يمكن التحايل عليه
--      من المتصفح، لأن الرفض يحصل داخل قاعدة البيانات نفسها.
--   4) منع تكرار سجل الحضور لنفس الموظف في نفس اليوم
--
-- المدير مستثنى من قيد الموقع (يستطيع تسجيل الحضور يدوياً للموظفين).
-- يتطلب: sql/012 (HR). الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) إعدادات الشركة (صف واحد فقط)
-- ------------------------------------------------------------
create table if not exists public.company_settings (
  id                smallint primary key default 1 check (id = 1),
  office_name       text    not null default 'مركز المبيعات',
  office_lat        double precision,          -- خط العرض
  office_lng        double precision,          -- خط الطول
  geofence_radius_m integer not null default 1000,  -- النطاق المسموح بالمتر
  geofence_enabled  boolean not null default true,
  updated_at        timestamptz not null default now()
);

insert into public.company_settings (id) values (1) on conflict (id) do nothing;

alter table public.company_settings enable row level security;

-- الجميع يقرأ (الموظف يحتاج يعرف موقع المركز والنطاق)، والمدير وحده يعدّل
drop policy if exists "read company_settings" on public.company_settings;
create policy "read company_settings" on public.company_settings
  for select to authenticated using (true);

drop policy if exists "admin write company_settings" on public.company_settings;
create policy "admin write company_settings" on public.company_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2) أعمدة الموقع على جدول الحضور
-- ------------------------------------------------------------
alter table public.attendance
  add column if not exists check_in_lat         double precision,
  add column if not exists check_in_lng         double precision,
  add column if not exists check_in_distance_m  integer,
  add column if not exists check_out_lat        double precision,
  add column if not exists check_out_lng        double precision,
  add column if not exists check_out_distance_m integer,
  add column if not exists source               text;  -- بصمة ذاتية | تسجيل يدوي بواسطة المدير

-- ------------------------------------------------------------
-- 3) حساب المسافة بين نقطتين بالمتر (معادلة Haversine)
-- ------------------------------------------------------------
create or replace function public.geo_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ------------------------------------------------------------
-- 4) التحقّق من النطاق قبل حفظ البصمة
-- ------------------------------------------------------------
create or replace function public.enforce_attendance_geofence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s        record;
  d        double precision;
  new_in   boolean;
  new_out  boolean;
begin
  select * into s from public.company_settings where id = 1;

  -- المدير يسجّل يدوياً بدون قيد الموقع
  if public.is_admin() then
    if new.source is null then new.source := 'تسجيل يدوي بواسطة المدير'; end if;
    return new;
  end if;

  if new.source is null then new.source := 'بصمة ذاتية'; end if;

  -- الميزة معطّلة أو الموقع لم يُضبط بعد → لا نمنع أحداً
  if s is null or not s.geofence_enabled or s.office_lat is null or s.office_lng is null then
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
    d := public.geo_distance_m(new.check_in_lat, new.check_in_lng, s.office_lat, s.office_lng);
    new.check_in_distance_m := round(d);
    if d > s.geofence_radius_m then
      raise exception 'أنت خارج نطاق %: تبعد % متر والمسموح % متر.',
        s.office_name, round(d), s.geofence_radius_m;
    end if;
  end if;

  -- بصمة الانصراف
  if new_out then
    if new.check_out_lat is null or new.check_out_lng is null then
      raise exception 'لتسجيل الانصراف يجب السماح للتطبيق بالوصول إلى موقعك.';
    end if;
    d := public.geo_distance_m(new.check_out_lat, new.check_out_lng, s.office_lat, s.office_lng);
    new.check_out_distance_m := round(d);
    if d > s.geofence_radius_m then
      raise exception 'أنت خارج نطاق %: تبعد % متر والمسموح % متر.',
        s.office_name, round(d), s.geofence_radius_m;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_attendance_geofence on public.attendance;
create trigger trg_attendance_geofence
  before insert or update on public.attendance
  for each row execute function public.enforce_attendance_geofence();

-- ------------------------------------------------------------
-- 5) منع تكرار سجل الحضور لنفس الموظف في نفس اليوم
--    (نحذف التكرارات القديمة إن وُجدت، ونُبقي الأقدم)
-- ------------------------------------------------------------
delete from public.attendance a
 using public.attendance b
 where a.employee_id = b.employee_id
   and a.work_date   = b.work_date
   and a.ctid > b.ctid;

create unique index if not exists attendance_employee_day_uidx
  on public.attendance (employee_id, work_date);

notify pgrst, 'reload schema';
