-- ============================================================
-- تلال ERP — الانصراف التلقائي عند نهاية الدوام
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المشكلة: الموظف يبصم حضوره، ثم يغلق النظام ويمشي بلا بصمة انصراف،
-- فيبقى يومه «بلا انصراف» ولا تُحتسب له ساعات عمل.
--
-- الحل: كل ليلة يمرّ النظام على بصمات اليوم التي بلا انصراف ويسجّل
-- الانصراف على **نهاية دوام الموظف** (دوام الشركة الآن ينتهي 18:00 أي
-- الساعة ٦ مساءً، ومن له دوام خاص يُحسب حسب دوامه هو).
--
-- لماذا يعمل الفحص ليلاً لا في السادسة بالضبط؟
--   لو أغلقنا السجلّات الساعة ٦، لَما استطاع الموظف الذي بقي حتى ٧
--   أن يسجّل انصرافه الحقيقي. فالفحص ينتظر آخر اليوم: من بصم انصرافه
--   بنفسه يبقى وقته الحقيقي، ومن نسي فقط يأخذ توقيت نهاية الدوام.
--
-- يتطلب: sql/012 (الدوام) و sql/022 (الإشعارات) و sql/027 (baghdad_today).
-- آمن لإعادة التشغيل، وآمن للتشغيل أكثر من مرة في اليوم.
-- ============================================================

create extension if not exists pg_cron;

-- ------------------------------------------------------------
-- 1) استثناء البصمة التلقائية من فحص الموقع
-- ------------------------------------------------------------
-- البصمة التلقائية يسجّلها النظام لا الموظف، فلا توجد إحداثيات لفحصها.
-- العلامة app.auto_checkout تُضبط داخل الدالة auto_checkout وحدها وتنتهي
-- بانتهاء المعاملة، والموظف العادي لا يملك أي طريق لضبطها من الواجهة.
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
  -- الانصراف التلقائي من النظام: لا فحص موقع
  if coalesce(current_setting('app.auto_checkout', true), '') = 'on' then
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

-- ------------------------------------------------------------
-- 2) الانصراف التلقائي
-- ------------------------------------------------------------
-- p_days_back: كم يوماً للخلف نفحص (١ = أمس واليوم). الأيام السابقة
-- تُفحص أيضاً حتى لا يضيع يوم لو تعطّلت الجدولة ليلة واحدة.
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

  -- هذه بصمة من النظام: تجاوز فحص الموقع (تنتهي العلامة بانتهاء المعاملة)
  perform set_config('app.auto_checkout', 'on', true);

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
    -- دوام الموظف الخاص إن وُجد، وإلا دوام الشركة العام
    shift_end := coalesce(rec.work_end_time, s.work_end_time, '17:00'::time);

    -- نهاية الدوام بتوقيت بغداد في يوم البصمة نفسه
    out_ts := (rec.work_date + shift_end) at time zone 'Asia/Baghdad';

    -- من بصم حضوره بعد نهاية الدوام: لا يجوز أن يسبق انصرافُه حضورَه
    if out_ts < rec.check_in then
      out_ts := rec.check_in;
    end if;

    update public.attendance
       set check_out = out_ts,
           note = coalesce(nullif(rec.note, '') || ' · ', '') || 'انصراف تلقائي'
     where id = rec.id;

    closed := closed + 1;

    -- نُعلم الموظف حتى يراجع المدير لو كان الوقت غير صحيح
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
    'ran_at',    now(),
    'today',     today,
    'closed',    closed,
    'notified',  notified
  );
end; $$;

-- الدالة للنظام فقط، لا تُستدعى من الواجهة مباشرة
revoke all on function public.auto_checkout(int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) تشغيل يدوي للمدير (زر «إغلاق البصمات الناقصة»)
-- ------------------------------------------------------------
create or replace function public.run_auto_checkout(p_days_back int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية متاحة للإدارة فقط.';
  end if;
  return public.auto_checkout(p_days_back);
end; $$;

grant execute on function public.run_auto_checkout(int) to authenticated;

-- ------------------------------------------------------------
-- 4) الجدولة اليومية: 23:55 بتوقيت بغداد = 20:55 UTC
-- ------------------------------------------------------------
select cron.unschedule('auto-checkout')
 where exists (select 1 from cron.job where jobname = 'auto-checkout');

select cron.schedule(
  'auto-checkout',
  '55 20 * * *',
  $cron$ select public.auto_checkout(1); $cron$
);

notify pgrst, 'reload schema';
