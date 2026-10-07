-- ============================================================
-- تلال ERP — 166: اختبارات تقارير HR ولوحتها (المرحلة 8)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_hr_reports();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الكتالوج   المدير العام يرى التقارير الـ17، والموظف بلا فريق لا يرى شيئاً
--   النطاق     المدير يرى فريقه فقط، بلا هاتف ولا تقارير مال؛ HR الكل بالهاتف
--   المرشّحات  الموظف والقسم يضيّقان، والتعداد يطابق الجدول
--   الحساب     التأخير بدقائقه من جدول اليوم، والغياب يوم عمل بلا بصمة ولا إجازة
--   اللوحة     مؤشراتها تطابق الجداول، ولا يفتحها موظف عادي
--   الحدود     تقرير مجهول ومدى معكوس أو طويل يُرفضان
--
-- يتطلب: 082، 145–165.
-- ============================================================

create or replace function tests.run_hr_reports()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; mgr_u uuid; mgr_emp uuid; emp_u uuid; emp uuid; out_u uuid; out_emp uuid;
  d_late date; d_abs date; sch record;
  j jsonb; n int; m int; txt text;
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
  select x.uid, x.eid into out_u, out_emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 4;

  if admin_u is null or emp is null or mgr_emp is null or hr_u is null or out_emp is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وأربعة موظفين بحسابات'::text;
    return;
  end if;

  begin
    -- فريق معزول: المدير يدير emp وحده، ولا يدير قسماً
    update public.employees set manager_id = null where manager_id in (mgr_emp, emp);
    update public.employees set manager_id = mgr_emp, hire_date = date '2019-01-01', exempt_from_attendance = false,
                                end_date = null where id = emp;
    update public.employees set manager_id = null where id in (mgr_emp, out_emp);
    update public.departments set manager_id = null where manager_id in (mgr_emp, out_emp);
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');

    -- ================= الكتالوج =================
    select count(*) into n from public.hr_report_catalog() c where c.allowed;
    log := log || extensions.ok(n = 17, 'المدير العام يرى التقارير الـ17');

    perform tests.act_as(out_u);
    select count(*) into n from public.hr_report_catalog() c where c.allowed;
    log := log || extensions.ok(n = 0, 'موظف بلا فريق ولا قسم لا يرى تقريراً');
    begin
      perform public.hr_report('employees', null, null, '{}');
      log := log || extensions.fail('موظف عادي يستخرج سجلّ الموظفين');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ليس لدورك%', 'موظف عادي يُرفض: ' || sqlerrm);
    end;
    begin
      perform public.hr_dashboard('{}');
      log := log || extensions.fail('موظف عادي يفتح لوحة HR');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لوحة HR%', 'لوحة HR مغلقة على الموظف العادي');
    end;

    -- ================= النطاق =================
    perform tests.act_as(admin_u);
    j := public.hr_report('employees', null, null, '{}');
    select count(*) into n from public.employees;
    log := log || extensions.is(jsonb_array_length(j->'rows'), n, 'المدير العام: سجلّ الموظفين كاملاً');

    perform tests.act_as(mgr_u);
    j := public.hr_report('employees', null, null, '{}');
    log := log || extensions.ok(jsonb_array_length(j->'rows') = 1
      and (j->'rows'->0->>'name') = (select full_name from public.employees where id = emp)
      and (j->'rows'->0->'phone') = 'null'::jsonb,
      'المدير يرى فريقه وحده، وبلا هاتف');
    begin
      perform public.hr_report('payroll', null, null, '{}');
      log := log || extensions.fail('المدير يستخرج تقرير الرواتب');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ليس لدورك%', 'تقارير المال ليست للمدير');
    end;
    j := public.hr_report('employees', null, null, jsonb_build_object('employee', out_emp));
    log := log || extensions.is(jsonb_array_length(j->'rows'), 0, 'مرشّح موظف خارج الفريق لا يوسّع النطاق');

    perform tests.act_as(hr_u);
    j := public.hr_report('employees', null, null, jsonb_build_object('employee', emp));
    log := log || extensions.ok(jsonb_array_length(j->'rows') = 1 and (j->'rows'->0) ? 'phone'
      and (j->'rows'->0->>'phone') is not distinct from (select phone from public.employees where id = emp),
      'HR يرى الكل بالهاتف، ومرشّح الموظف يضيّق');

    -- ================= المرشّحات والتعداد =================
    perform tests.act_as(admin_u);
    j := public.hr_report('headcount', null, null, '{}');
    select coalesce(sum((r->>'active')::int), 0) into n from jsonb_array_elements(j->'rows') r;
    select count(*) into m from public.employees where status = 'active';
    log := log || extensions.is(n, m, 'التعداد حسب القسم يساوي عدد النشطين');

    j := public.hr_report('employees', null, null,
           jsonb_build_object('department', (select department_id from public.employees where id = emp)));
    log := log || extensions.ok((select bool_and((r->>'department') is not distinct from (select department from public.employees where id = emp))
                                   from jsonb_array_elements(j->'rows') r)
                                and jsonb_array_length(j->'rows') >= 1
                                or (select department_id from public.employees where id = emp) is null,
      'مرشّح القسم يضيّق إلى القسم وما تحته');

    -- ================= التأخير والغياب =================
    -- يوما عمل في الأسبوعين الماضيين بحسب جدول emp
    select g::date into d_late from generate_series(public.baghdad_today() - 14, public.baghdad_today() - 2, interval '1 day') g
     cross join lateral public.work_schedule_on(emp, g::date) s
     where extract(dow from g)::int = any (s.work_days) order by g desc limit 1;
    select g::date into d_abs from generate_series(public.baghdad_today() - 14, public.baghdad_today() - 2, interval '1 day') g
     cross join lateral public.work_schedule_on(emp, g::date) s
     where extract(dow from g)::int = any (s.work_days) and g::date < d_late order by g desc limit 1;
    select * into sch from public.work_schedule_on(emp, d_late);

    delete from public.attendance where employee_id = emp and work_date in (d_late, d_abs);
    delete from public.leaves where employee_id = emp and start_date <= d_late and end_date >= d_abs;
    delete from public.attendance_exemptions where employee_id = emp and exempt_date in (d_late, d_abs);
    update public.company_settings set late_grace_minutes = 15,
           attendance_effective_date = least(coalesce(attendance_effective_date, d_abs), d_abs) where id = 1;
    insert into public.attendance (employee_id, work_date, check_in, check_out)
    values (emp, d_late, (d_late + sch.start_time + interval '45 minutes') at time zone 'Asia/Baghdad',
                         (d_late + sch.end_time) at time zone 'Asia/Baghdad');

    j := public.hr_report('late', d_abs, d_late, jsonb_build_object('employee', emp));
    log := log || extensions.ok(exists (select 1 from jsonb_array_elements(j->'rows') r
                                        where (r->>'day')::date = d_late and (r->>'minutes')::int = 45),
      'التأخير من جدول اليوم: 45 دقيقة');
    j := public.hr_report('absence', d_abs, d_late, jsonb_build_object('employee', emp));
    log := log || extensions.ok(exists (select 1 from jsonb_array_elements(j->'rows') r where (r->>'day')::date = d_abs)
                                and not exists (select 1 from jsonb_array_elements(j->'rows') r where (r->>'day')::date = d_late),
      'الغياب: يوم عمل بلا بصمة يظهر، ويوم البصمة لا يظهر');
    j := public.hr_report('attendance', d_abs, d_late, jsonb_build_object('employee', emp));
    log := log || extensions.ok((j->'rows'->0->>'present_days')::int >= 1 and (j->'rows'->0->>'late_days')::int >= 1,
      'تقرير الدوام يعدّ الحضور والتأخير');

    -- ================= اللوحة =================
    j := public.hr_dashboard('{}');
    select count(*) into n from public.employees;
    select count(*) into m from public.leaves where status = 'معلقة';
    log := log || extensions.ok((j->>'total')::int = n and (j->>'pending_leaves')::int = m
                                and j ? 'payroll_month' and jsonb_typeof(j->'departments') = 'array',
      'لوحة HR تطابق الجداول');

    perform tests.act_as(mgr_u);
    j := public.hr_dashboard('{}');
    log := log || extensions.ok((j->>'total')::int = 1 and (j->'payroll_month') = 'null'::jsonb,
      'لوحة المدير بفريقه، وبلا رواتب');

    -- ================= الحدود =================
    perform tests.act_as(admin_u);
    begin
      perform public.hr_report('nope', null, null, '{}');
      log := log || extensions.fail('تقرير مجهول يمرّ');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%غير معروف%', 'تقرير مجهول يُرفض');
    end;
    begin
      perform public.hr_report('employees', date '2026-02-01', date '2026-01-01', '{}');
      log := log || extensions.fail('مدى معكوس يمرّ');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%قبل بدايته%', 'مدى معكوس يُرفض');
    end;
    begin
      perform public.hr_report('absence', date '2026-01-01', date '2026-06-01', '{}');
      log := log || extensions.fail('غياب لخمسة أشهر يمرّ');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%93 يوما%', 'تقرير الغياب محدود بـ93 يوماً');
    end;

    -- كل تقرير يعمل للمدير العام ويُرجع أعمدة
    select count(*) into n from public.hr_report_catalog() c
     where jsonb_array_length(public.hr_report(c.key, date '2026-09-01', date '2026-10-01', '{}')->'columns') > 0;
    log := log || extensions.is(n, 17, 'التقارير الـ17 كلها تعمل وتُرجع أعمدتها');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 8: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_hr_reports() is
  'اختبارات المرحلة 8: الكتالوج، النطاق، المرشّحات، التأخير والغياب، اللوحة، الحدود (sql/166). يُلغي أثره.';

revoke all on function tests.run_hr_reports() from public;
grant execute on function tests.run_hr_reports() to service_role;
