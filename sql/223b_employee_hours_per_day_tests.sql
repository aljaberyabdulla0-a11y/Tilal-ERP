-- ============================================================
-- اختبارات 223 — دوام خاص لكل يوم.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_emp uuid; v_sun date; v_n int; v_ok boolean;
  sch record;
  v_log text := '';
begin
  select e.id into v_emp from public.employees e
   where e.status = 'active' and not e.exempt_from_attendance
     and not exists (select 1 from public.employee_shifts es where es.employee_id = e.id)
   limit 1;
  if v_emp is null then raise exception 'لا موظف نشط للاختبار'; end if;

  -- أحدٌ قريب (dow = 0)
  v_sun := current_date - extract(dow from current_date)::int;

  update public.employees
     set work_start_time = '09:00', work_end_time = '17:00',
         work_days = '{0,1,2,3,4}',
         work_day_hours = '{"0":{"start":"10:00","end":"18:00"},"1":{"start":"11:00","end":"19:00"}}'
   where id = v_emp;

  -- T1) الأحد بوقته
  select * into sch from public.work_schedule_on(v_emp, v_sun);
  if sch.start_time <> '10:00' or sch.end_time <> '18:00' then
    raise exception 'T1 الأحد % – %', sch.start_time, sch.end_time;
  end if;
  v_log := v_log || 'T1 ';

  -- T2) الاثنين بوقته
  select * into sch from public.work_schedule_on(v_emp, v_sun + 1);
  if sch.start_time <> '11:00' or sch.end_time <> '19:00' then
    raise exception 'T2 الاثنين % – %', sch.start_time, sch.end_time;
  end if;
  v_log := v_log || 'T2 ';

  -- T3) يوم بلا وقت خاص ← الوقت العام للموظف، والأيام من work_days
  select * into sch from public.work_schedule_on(v_emp, v_sun + 2);
  if sch.start_time <> '09:00' or sch.end_time <> '17:00' or sch.work_days <> '{0,1,2,3,4}' then
    raise exception 'T3 الثلاثاء % – % %', sch.start_time, sch.end_time, sch.work_days;
  end if;
  if sch.source <> 'دوام خاص' then raise exception 'T3 المصدر %', sch.source; end if;
  v_log := v_log || 'T3 ';

  -- T4) مدخلات خاطئة تُرفض: يوم خارج 0–6، نهاية قبل البداية، وقت غير صالح، كائن فارغ
  v_n := 0;
  begin
    update public.employees set work_day_hours = '{"7":{"start":"10:00","end":"18:00"}}' where id = v_emp;
  exception when check_violation then v_n := v_n + 1; end;
  begin
    update public.employees set work_day_hours = '{"0":{"start":"18:00","end":"10:00"}}' where id = v_emp;
  exception when check_violation then v_n := v_n + 1; end;
  begin
    update public.employees set work_day_hours = '{"0":{"start":"25:00","end":"26:00"}}' where id = v_emp;
  exception when check_violation then v_n := v_n + 1; end;
  begin
    update public.employees set work_day_hours = '{}' where id = v_emp;
  exception when check_violation then v_n := v_n + 1; end;
  if v_n <> 4 then raise exception 'T4 رُفض % من 4 مدخلات خاطئة', v_n; end if;
  v_log := v_log || 'T4 ';

  -- T5) بلا أوقات لكل يوم ← كما كان قبل 223
  update public.employees set work_day_hours = null where id = v_emp;
  select * into sch from public.work_schedule_on(v_emp, v_sun);
  if sch.start_time <> '09:00' or sch.end_time <> '17:00' then
    raise exception 'T5 بلا أوقات يومية % – %', sch.start_time, sch.end_time;
  end if;
  v_log := v_log || 'T5 ';

  -- T6) المنظور يحمل العمود
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'team_members'
                    and column_name = 'work_day_hours') into v_ok;
  if not v_ok then raise exception 'T6 team_members بلا work_day_hours'; end if;
  v_log := v_log || 'T6 ';

  -- T7) القيد يعمل بدور authenticated — كما يحفظ HR من النموذج (224)
  v_ok := has_function_privilege('authenticated', 'public.valid_work_day_hours(jsonb)', 'execute');
  if not v_ok then raise exception 'T7 authenticated لا ينفّذ valid_work_day_hours'; end if;
  v_log := v_log || 'T7 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
