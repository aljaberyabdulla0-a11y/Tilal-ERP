-- ============================================================
-- تلال ERP — تصفير سجلّ الدوام وبدء الاحتساب الفعلي 2026-08-11
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الغرض (بطلب المستخدم 2026-08-10):
--   كان النظام تحت التجربة، فسجلّ الدوام مليء بأيام فارغة وبصمات
--   بلا انصراف — وهذه ليست غياباً حقيقياً. القرار: يُعتبر كل موظف
--   **حاضراً دواماً كاملاً** من تاريخ تعيينه حتى 2026-08-10، ويبدأ
--   الاحتساب الحقيقي من **2026-08-11**.
--
-- ⚠️ هذا الملف يحذف بصمات الفترة السابقة ويبنيها من جديد.
--    السجلّ القديم يُنسخ أولاً إلى public.attendance_archive_20260811
--    (للمدير فقط) فيمكن الرجوع إليه.
--
-- ⚠️ للتشغيل مرة واحدة. إعادة تشغيله تعيد بناء نفس الفترة (لا تضرّ،
--    لكنها تمسح أي تصحيح يدوي أجريته على أيام ما قبل 2026-08-11).
--
-- يتطلب: sql/012 و sql/024 و sql/025 و sql/033.
-- ============================================================

-- ------------------------------------------------------------
-- 1) توحيد علامة «بصمة من النظام»
-- ------------------------------------------------------------
-- كان اسمها app.auto_checkout في sql/033 وخاصاً بالانصراف التلقائي.
-- صارت app.system_stamp لأن هذا الملف يحتاجها أيضاً: أي بصمة يكتبها
-- النظام بنفسه لا إحداثيات معها، فلا معنى لفحص الموقع عليها.
create or replace function public.enforce_attendance_geofence()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  s          record;
  emp        record;
  nearest    record;
  new_in     boolean;
  new_out    boolean;
  loc_count  integer;
begin
  -- بصمة من النظام لا من الموظف: لا فحص موقع
  if coalesce(current_setting('app.system_stamp', true), '') = 'on' then
    return new;
  end if;

  select * into s from public.company_settings where id = 1;
  select * into emp from public.employees where id = new.employee_id;

  if public.is_admin() then
    if new.source is null then new.source := 'تسجيل يدوي بواسطة المدير'; end if;
    return new;
  end if;

  if new.source is null then new.source := 'بصمة ذاتية'; end if;

  if emp.exempt_from_attendance then
    return new;
  end if;

  select count(*) into loc_count from public.work_locations where is_active;

  if s is null or not s.geofence_enabled or loc_count = 0 then
    return new;
  end if;

  new_in  := new.check_in  is not null
             and (tg_op = 'INSERT' or old.check_in  is distinct from new.check_in);
  new_out := new.check_out is not null
             and (tg_op = 'INSERT' or old.check_out is distinct from new.check_out);

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
end; $function$;

create or replace function public.auto_checkout(p_days_back int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today      date := public.baghdad_today();
  s          record;
  rec        record;
  shift_end  time;
  out_ts     timestamptz;
  closed     int := 0;
  notified   int := 0;
begin
  select * into s from public.company_settings where id = 1;

  perform set_config('app.system_stamp', 'on', true);

  for rec in
    select a.id, a.employee_id, a.work_date, a.check_in, a.note,
           e.full_name, e.user_id, e.work_end_time
      from public.attendance a
      join public.employees e on e.id = a.employee_id
     where a.check_in  is not null
       and a.check_out is null
       and a.work_date between today - greatest(p_days_back, 0) and today
     order by a.work_date, e.full_name
  loop
    shift_end := coalesce(rec.work_end_time, s.work_end_time, '17:00'::time);
    out_ts    := (rec.work_date + shift_end) at time zone 'Asia/Baghdad';

    if out_ts < rec.check_in then
      out_ts := rec.check_in;
    end if;

    update public.attendance
       set check_out = out_ts,
           note = coalesce(nullif(rec.note, '') || ' · ', '') || 'انصراف تلقائي'
     where id = rec.id;

    closed := closed + 1;

    if rec.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (
        rec.user_id,
        'سُجّل انصرافك تلقائياً',
        'لم تسجّل بصمة انصراف يوم ' || rec.work_date
          || '، فسجّلها النظام على نهاية دوامك ' || to_char(shift_end, 'HH24:MI')
          || '. لو الوقت غير صحيح راجع المدير لتصحيحه.',
        '/dashboard/me',
        'دوام',
        rec.id
      );
      notified := notified + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran_at', now(), 'today', today, 'closed', closed, 'notified', notified
  );
end; $$;

revoke all on function public.auto_checkout(int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2) أرشفة السجلّ القديم قبل المساس به
-- ------------------------------------------------------------
create table if not exists public.attendance_archive_20260811 (like public.attendance);

insert into public.attendance_archive_20260811
select * from public.attendance
 where work_date <= date '2026-08-10'
   and not exists (select 1 from public.attendance_archive_20260811);

alter table public.attendance_archive_20260811 enable row level security;

drop policy if exists "admins read attendance archive" on public.attendance_archive_20260811;
create policy "admins read attendance archive"
  on public.attendance_archive_20260811
  for select to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------
-- 3) إعادة بناء الفترة: دوام كامل من تاريخ التعيين حتى 2026-08-10
-- ------------------------------------------------------------
do $$
declare
  cutoff    date := date '2026-08-10';   -- آخر يوم يُبنى تلقائياً
  floor_d   date := date '2026-01-01';   -- حارس ضد تواريخ التعيين الخاطئة
  s         record;
  e         record;
  d         date;
  sched     int[];
  st        time;
  en        time;
  removed   int := 0;
  gone      int := 0;
  created   int := 0;
  skipped   text := '';
begin
  -- بصمات يكتبها النظام: لا فحص موقع
  perform set_config('app.system_stamp', 'on', true);

  select * into s from public.company_settings where id = 1;

  for e in
    select * from public.employees
     where status = 'active'
       and not exempt_from_attendance     -- الإدارة معفاة أصلاً من البصمة
       and hire_date is not null
     order by full_name
  loop
    -- تاريخ تعيين قديم بشكل غير منطقي = بيانات خاطئة. نتخطّاه بصوت عالٍ
    -- بدل أن نولّد له آلاف السجلات بصمت.
    if e.hire_date < floor_d then
      skipped := skipped || e.full_name || ' (تاريخ التعيين ' || e.hire_date || ') · ';
      continue;
    end if;

    -- دوام الموظف الخاص إن وُجد، وإلا دوام الشركة العام
    sched := coalesce(e.work_days,       s.work_days,       array[0,1,2,3,4]);
    st    := coalesce(e.work_start_time, s.work_start_time, '09:00'::time);
    en    := coalesce(e.work_end_time,   s.work_end_time,   '17:00'::time);

    delete from public.attendance
     where employee_id = e.id and work_date <= cutoff;
    get diagnostics gone = row_count;
    removed := removed + gone;

    for d in
      select generate_series(e.hire_date, cutoff, interval '1 day')::date
    loop
      -- عطلة أسبوعية
      continue when not (extract(dow from d)::int = any (sched));

      -- إجازة معتمدة تغطّي هذا اليوم: تبقى إجازة، لا نحوّلها لحضور
      continue when exists (
        select 1 from public.leaves l
         where l.employee_id = e.id
           and l.status = 'موافق عليها'
           and l.start_date <= d
           and l.end_date   >= d
      );

      insert into public.attendance
        (employee_id, work_date, check_in, check_out, source, note)
      values (
        e.id, d,
        (d + st) at time zone 'Asia/Baghdad',
        (d + en) at time zone 'Asia/Baghdad',
        'رصيد افتتاحي',
        'دوام كامل — سجّله النظام قبل بدء الاحتساب الفعلي في 2026-08-11'
      );
      created := created + 1;
    end loop;
  end loop;

  raise notice 'حُذف % سجلاً وأُنشئ % سجل دوام كامل حتى %.', removed, created, cutoff;
  if skipped <> '' then
    raise notice 'تُخطّي (تاريخ تعيين غير منطقي): %', skipped;
  end if;
end $$;

notify pgrst, 'reload schema';
