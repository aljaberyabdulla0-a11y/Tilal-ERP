-- ============================================================
-- تلال ERP — 161: اختبارات الأداء والأهداف (المرحلة 6)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_performance();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   المؤشرات   الكتالوج مزروع لكل قسم، ومصدر CRM مرتبط بمقياس موجود
--   الأهداف    المدير يحدّد لفريقه، لا لنفسه، والغريب لا يحدّد؛ أكثر من مؤشر في الشهر
--   الفعلي     المهام والدوام وCRM والتوظيف تُحسب؛ اليدوي يُدخله المدير لا صاحبه
--   الإنجاز    «أعلى أفضل» و«أدنى أفضل» محسوبان في القاعدة
--   المراجعة   ذاتي ← المدير ← HR، والنتيجة بأوزان الإعدادات، وكلٌّ لدوره
--   الرؤية     الغريب لا يرى أهداف غيره ولا مراجعته
--
-- يتطلب: 082، 145–160.
-- ============================================================

create or replace function tests.run_performance()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; mgr_u uuid; mgr_emp uuid; emp_u uuid; emp uuid; out_u uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; rv uuid;
  v_start date := date_trunc('month', public.baghdad_today())::date;
  v_end date := (date_trunc('month', public.baghdad_today()) + interval '1 month - 1 day')::date;
  n int; txt text; rec record; v numeric; s public.performance_settings%rowtype;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select x.uid, x.eid into emp_u, emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 1;
  select x.uid, x.eid into mgr_u, mgr_emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 2;
  select x.uid into hr_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 3;
  select x.uid into out_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 4;

  if admin_u is null or emp is null or mgr_emp is null or hr_u is null or out_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وأربعة موظفين بحسابات'::text;
    return;
  end if;

  begin
    update public.employees set manager_id = mgr_emp where id = emp;
    update public.employees set manager_id = null where id = mgr_emp;
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');

    -- ================= المؤشرات =================
    select count(*) into n from public.kpi_definitions;
    log := log || extensions.ok(n >= 15
      and exists (select 1 from public.kpi_definitions k join public.departments d on d.id = k.department_id where d.code = 'MKT')
      and exists (select 1 from public.kpi_definitions k join public.departments d on d.id = k.department_id where d.code = 'HR')
      and not exists (select 1 from public.kpi_definitions k where k.source = 'CRM'
                       and not exists (select 1 from public.crm_metrics m where m.code = k.crm_metric)),
      'كتالوج المؤشرات لكل الأقسام، ومؤشرات CRM مرتبطة بمقاييس موجودة');

    -- ================= الأهداف =================
    perform tests.act_as(mgr_u);
    set local role authenticated;
    insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
    values (emp, 'TASKS_DONE', v_start, 2) returning id into t1;
    insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
    values (emp, 'SALES_COLLECTIONS', v_start, 100) returning id into t2;
    reset role;
    select * into rec from public.employee_targets where id = t1;
    log := log || extensions.ok(rec.period_end = v_end and rec.period = to_char(v_start, 'YYYY-MM') and rec.title = 'مهام منجزة',
      'المدير يحدّد أهداف فريقه — أكثر من مؤشر في الشهر، والفترة والعنوان من القاعدة');

    perform tests.act_as(emp_u);
    set local role authenticated;
    begin
      insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
      values (emp, 'MKT_REACH', v_start, 1);
      reset role;
      log := log || extensions.fail('لا يحدّد أحد هدفه');
    exception when others then
      reset role;
      log := log || extensions.pass('لا يحدّد أحد هدفه');
    end;

    perform tests.act_as(out_u);
    set local role authenticated;
    begin
      insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
      values (emp, 'MKT_REACH', v_start, 1);
      reset role;
      log := log || extensions.fail('الغريب لا يحدّد أهداف غيره');
    exception when others then
      reset role;
      log := log || extensions.pass('الغريب لا يحدّد أهداف غيره');
    end;
    set local role authenticated;
    select count(*) into n from public.employee_targets where employee_id = emp;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى أهداف غيره');

    -- ================= الفعلي =================
    perform tests.act_as(admin_u);
    insert into public.tasks (title, assigned_to, status, priority, completed_at, created_by)
    values ('مهمة اختبار الأداء', emp_u, 'منجزة', 'عادية', now(), admin_u);
    v := public.refresh_target_actual(t1);
    log := log || extensions.ok(v >= 1 and (select actual_value = v from public.employee_targets where id = t1),
                                'فعليّ «مهام منجزة» يُحسب من المهام');

    perform tests.act_as(emp_u);
    begin
      perform public.set_target_actual(t2, 999);
      log := log || extensions.fail('لا يُدخل أحد فعليَّ هدفه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%هدفه%', 'لا يُدخل أحد فعليَّ هدفه');
    end;
    perform tests.act_as(mgr_u);
    perform public.set_target_actual(t2, 80);
    log := log || extensions.is((select achievement_pct from public.employee_targets where id = t2), 80.0,
                                'إنجاز «أعلى أفضل» = الفعلي ÷ المستهدف');
    begin
      perform public.set_target_actual(t1, 50);
      log := log || extensions.fail('الفعلي المحسوب لا يُدخل يدوياً');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يُحسب من مصدره%', 'الفعلي المحسوب لا يُدخل يدوياً');
    end;

    perform tests.act_as(hr_u);
    insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
    values (emp, 'FIN_CLOSING', v_start, 5) returning id into t3;
    perform public.set_target_actual(t3, 10);
    log := log || extensions.is((select achievement_pct from public.employee_targets where id = t3), 50.0,
                                'إنجاز «أدنى أفضل» = المستهدف ÷ الفعلي');

    insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
    values (emp, 'ATTENDANCE_RATE', v_start, 95) returning id into t4;
    v := public.refresh_target_actual(t4);
    log := log || extensions.ok(v is null or (v between 0 and 100), 'نسبة الحضور تُحسب من البصمة والوردية');

    if exists (select 1 from public.kpi_definitions where code = 'SALES_CALLS') then
      insert into public.employee_targets (employee_id, kpi_code, period_start, target_value)
      values (emp, 'SALES_CALLS', v_start, 50) returning id into t5;
      v := public.refresh_target_actual(t5);
      log := log || extensions.ok(v >= 0, 'فعليّ مؤشر CRM من محرّك التقارير نفسه');
    end if;

    insert into public.employee_targets (department_id, kpi_code, period_start, target_value)
    select d.id, 'HR_HIRES', v_start, 2 from public.departments d where d.code = 'HR' returning id into t5;
    v := public.refresh_target_actual(t5);
    log := log || extensions.ok(v >= 0, 'هدف قسمٍ بمؤشر التوظيف يُحسب');

    -- ================= المراجعة =================
    perform tests.act_as(mgr_u);
    begin
      perform public.open_review_cycle('شهري', v_start, v_end, null, emp);
      log := log || extensions.fail('فتح الدورة لـ HR');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للموارد البشرية%', 'فتح الدورة لـ HR');
    end;
    perform tests.act_as(hr_u);
    n := public.open_review_cycle('شهري', v_start, v_end, null, emp);
    select * into rec from public.performance_reviews where employee_id = emp and cycle = 'شهري' and period_start = v_start;
    rv := rec.id;
    log := log || extensions.ok(n = 1 and rec.status = 'تقييم ذاتي' and rec.manager_id = mgr_emp,
                                'الدورة تُفتح بمدير الموظف وتبدأ بالتقييم الذاتي');

    perform tests.act_as(emp_u);
    log := log || extensions.is(public.submit_review_step(rv, 'ذاتي', 4, 'أنجزت ما طُلب'), 'تقييم المدير',
                                'التقييم الذاتي ينقلها إلى المدير');
    perform tests.act_as(out_u);
    begin
      perform public.submit_review_step(rv, 'المدير', 1);
      log := log || extensions.fail('غير المدير لا يقيّم');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لمديره%', 'غير المدير لا يقيّم');
    end;
    perform tests.act_as(mgr_u);
    log := log || extensions.is(public.submit_review_step(rv, 'المدير', 4, 'جيد', 'تدريب'), 'مراجعة HR',
                                'تقييم المدير ينقلها إلى HR');
    perform tests.act_as(emp_u);
    begin
      perform public.submit_review_step(rv, 'HR', 5);
      log := log || extensions.fail('الموظف لا يُنهي مراجعته');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للموارد البشرية%', 'الموظف لا يُنهي مراجعته');
    end;

    perform tests.act_as(hr_u);
    perform public.submit_review_step(rv, 'HR', 3, 'مقبول');
    select * into rec from public.performance_reviews where id = rv;
    select * into s from public.performance_settings where id = 1;
    v := public.weighted_target_achievement(emp, v_start, v_end);
    log := log || extensions.ok(
      rec.status = 'مكتمل' and rec.targets_pct is not distinct from v and rec.recommendation = 'تدريب'
      and rec.final_score = round((3 * 20 * s.weight_hr
                                   + coalesce(least(v, 100) * s.weight_targets, 0)
                                   + 4 * 20 * s.weight_manager + 4 * 20 * s.weight_self)
                                  / (s.weight_hr + s.weight_manager + s.weight_self
                                     + case when v is not null then s.weight_targets else 0 end), 1),
      'النتيجة النهائية بأوزان الإعدادات: الأهداف والمدير والذاتي وHR');

    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.performance_reviews where employee_id = emp;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى مراجعة غيره');
    perform tests.act_as(mgr_u);
    set local role authenticated;
    select count(*) into n from public.performance_reviews where employee_id = emp;
    select n + count(*) into n from public.employee_targets where employee_id = emp;
    reset role;
    log := log || extensions.ok(n >= 3, 'المدير يرى أهداف فريقه ومراجعاته');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 6: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_performance() is
  'اختبارات المرحلة 6: المؤشرات، الأهداف، الفعلي، الإنجاز، المراجعة، الرؤية (sql/161). يُلغي أثره.';

revoke all on function tests.run_performance() from public;
grant execute on function tests.run_performance() to service_role;
