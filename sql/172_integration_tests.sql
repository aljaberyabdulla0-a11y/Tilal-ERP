-- ============================================================
-- تلال ERP — 172: اختبارات التكامل وفرض المصفوفة (المرحلة 9)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_integrations();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الاسم      تغييره يسري إلى العميل والمهمة والحجز
--   المدير     تغييره ينقل المراجعة المفتوحة ويُشعِر المدير الجديد
--   الخروج     المرؤوسون لمديره، القسم بلا مدير، التوزيع والوردية تُغلق، التسويق يُعطَّل
--   المنصب     يقترح الدور بإشعار، والمدير العام وحده يطبّقه
--   الفحص      يُظهر حساباً مفتوحاً وعملاء باسم خارج، ومغلق على الموظف
--   المصفوفة   موظف HR: يدير الملفات بلا رواتب، ولا يعتمد الإجازة؛ مدير HR يفعل
--
-- يتطلب: 082، 145–166، 170–171.
-- ============================================================

create or replace function tests.run_integrations()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; mgr_u uuid; mgr_emp uuid; emp_u uuid; emp uuid; sub_emp uuid; out_u uuid;
  v_name text; v_client uuid; v_task uuid; v_dept uuid; v_pos uuid; v_rv uuid; v_shift uuid; v_alloc uuid;
  v_proj uuid; v_req uuid; v_leave uuid;
  n int; b boolean; txt text; rec record;
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
  select e.id into sub_emp from public.employees e
   where e.status = 'active' and e.id not in (emp, mgr_emp) and e.user_id is distinct from hr_u
     and e.user_id is distinct from out_u and e.user_id is distinct from admin_u
   order by e.created_at limit 1;
  select id into v_proj from public.projects order by created_at limit 1;

  if admin_u is null or emp is null or mgr_emp is null or hr_u is null or out_u is null or sub_emp is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وأربعة موظفين بحسابات وموظف خامس'::text;
    return;
  end if;

  begin
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';
    update public.employees set manager_id = null, hire_date = date '2019-01-01' where id in (emp, mgr_emp, sub_emp);
    perform tests.act_as(admin_u);

    -- ================= الاسم =================
    select full_name into v_name from public.employees where id = emp;
    insert into public.clients (name, phone, owner_id, created_by)
    values ('عميل اختبار التكامل', '0770' || lpad((floor(random() * 9999999))::int::text, 7, '0'), emp, admin_u)
    returning id into v_client;
    insert into public.tasks (title, assigned_to, assigned_to_name, status, priority, created_by)
    values ('مهمة اختبار التكامل', emp_u, v_name, 'جديدة', 'عادية', admin_u) returning id into v_task;

    update public.employees set full_name = v_name || ' (معدَّل)' where id = emp;
    log := log || extensions.ok(
      (select sales_employee from public.clients where id = v_client) = v_name || ' (معدَّل)'
      and (select owner_id from public.clients where id = v_client) = emp
      and (select assigned_to_name from public.tasks where id = v_task) = v_name || ' (معدَّل)',
      'تغيير الاسم يسري إلى العميل والمهمة، والمالك كما هو');

    -- ================= المدير =================
    insert into public.performance_reviews (employee_id, cycle, period_start, period_end, manager_id)
    values (emp, 'شهري', date '2026-01-01', date '2026-01-31', null) returning id into v_rv;
    delete from public.notifications where user_id = mgr_u;
    update public.employees set manager_id = mgr_emp where id = emp;
    log := log || extensions.ok(
      (select manager_id from public.performance_reviews where id = v_rv) = mgr_emp
      and exists (select 1 from public.notifications where user_id = mgr_u and title like 'انضمّ إلى فريقك%'),
      'تغيير المدير ينقل المراجعة المفتوحة ويُشعِر المدير الجديد');

    -- ================= المنصب ← الدور =================
    select p.id into v_pos from public.positions p where p.default_role_code is not null
       and p.default_role_code not in ('admin', 'general_manager', 'employee') order by p.sort_order limit 1;
    if v_pos is null then
      insert into public.positions (code, title_ar, default_role_code) values ('TST-INT', 'منصب اختبار', 'sales_employee')
      returning id into v_pos;
    end if;
    delete from public.notifications where title like 'منصب%يقترح دوراً آخر';
    update public.employees set position_id = v_pos where id = sub_emp;
    update public.employees set position_id = v_pos where id = emp;
    log := log || extensions.ok(
      exists (select 1 from public.notifications n join public.profiles p on p.id = n.user_id
                where p.role = 'admin' and n.title like 'منصب%يقترح دوراً آخر')
      and (select role_code from public.profiles where id = emp_u) = 'employee',
      'المنصب يقترح دوراً بإشعار للمدير العام، ولا يمنحه تلقائياً');
    select count(*) into n from public.integration_issues() x where x.kind = 'الدور لا يطابق المنصب' and x.employee_id = emp;
    log := log || extensions.is(n, 1, 'عدم مطابقة الدور للمنصب يظهر في الفحص');

    perform tests.act_as(hr_u);
    begin
      perform public.apply_position_role(emp);
      log := log || extensions.fail('غير المدير العام يمنح دوراً');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمدير العام وحده%', 'تطبيق دور المنصب للمدير العام وحده');
    end;
    perform tests.act_as(admin_u);
    txt := public.apply_position_role(emp);
    log := log || extensions.ok((select role_code from public.profiles where id = emp_u) = txt,
      'المدير العام يطبّق دور المنصب');
    update public.employees set position_id = null where id in (emp, sub_emp);
    perform public.assign_user_role(emp_u, 'employee');

    -- ================= الخروج =================
    update public.employees set manager_id = emp where id = sub_emp;
    select id into v_dept from public.departments where status = 'نشط' order by sort_order limit 1;
    update public.departments set manager_id = emp where id = v_dept;
    insert into public.employee_project_allocations (employee_id, project_id, allocation_pct, start_date)
    values (emp, v_proj, 50, date '2026-01-01') returning id into v_alloc;
    -- وردية موجودة، أو وردية اختبار تُلغى مع المعاملة
    select id into v_shift from public.work_shifts order by created_at limit 1;
    if v_shift is null then
      insert into public.work_shifts (name_ar, start_time, end_time) values ('وردية اختبار التكامل', '09:00', '17:00')
      returning id into v_shift;
    end if;
    insert into public.employee_shifts (employee_id, shift_id, start_date)
    values (emp, v_shift, date '2026-01-01') returning id into v_shift;
    insert into public.mkt_team (employee_id, mkt_role, is_active) values (emp, 'أخصائي تسويق', true)
      on conflict (employee_id) do update set is_active = true;

    update public.employees set status = 'inactive', end_date = public.baghdad_today() - 1 where id = emp;
    log := log || extensions.ok((select manager_id from public.employees where id = sub_emp) = mgr_emp,
      'الخروج: المرؤوس ينتقل إلى مدير الخارج');
    log := log || extensions.ok((select manager_id from public.departments where id = v_dept) is null,
      'الخروج: القسم الذي يديره يُخلى');
    log := log || extensions.ok(
      (select end_date from public.employee_project_allocations where id = v_alloc) = public.baghdad_today() - 1
      and (select end_date from public.employee_shifts where id = v_shift) = public.baghdad_today() - 1
      and not (select is_active from public.mkt_team where employee_id = emp),
      'الخروج: التوزيع والوردية تُغلق بتاريخ النهاية، وعضوية التسويق تُعطَّل');

    select count(*) into n from public.integration_issues() x
     where x.employee_id = emp and x.kind in ('حساب دخول مفتوح', 'عملاء باسم موظف خارج', 'مهام مفتوحة لموظف خارج');
    log := log || extensions.is(n, 3, 'الفحص يُظهر الحساب المفتوح والعملاء والمهام الباقية باسم الخارج');

    perform public.revoke_employee_access(emp);
    select count(*) into n from public.integration_issues() x where x.employee_id = emp and x.kind = 'حساب دخول مفتوح';
    log := log || extensions.is(n, 0, 'إغلاق الحساب يُخرجه من الفحص');

    perform tests.act_as(out_u);
    begin
      perform * from public.integration_issues();
      log := log || extensions.fail('موظف عادي يقرأ فحص التكامل');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%فحص التكامل%', 'فحص التكامل مغلق على الموظف العادي');
    end;

    -- ================= المصفوفة =================
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');
    perform tests.act_as(hr_u);
    log := log || extensions.ok(public.can_manage_hr() and not public.can_see_payroll(),
      'موظف HR: يدير الملفات ولا يرى الرواتب');
    log := log || extensions.ok(
      not exists (select 1 from public.hr_report_catalog() c where c.money and c.allowed),
      'موظف HR: لا تقارير مال');

    -- إجازة في مستوى HR: موظف HR ليس مُوافِقاً، فتصعد للمدير العام
    perform tests.act_as(admin_u);
    update public.employees set manager_id = null where id = sub_emp;
    select count(*) into n from public.approval_step_users(
      (select id from public.approval_steps where workflow_code = 'leave' and approver_kind = 'HR'), sub_emp) u
     where u.user_id = hr_u;
    log := log || extensions.is(n, 0, 'موظف HR ليس مُوافِقاً على الإجازة');

    perform public.assign_user_role(hr_u, 'hr_manager');
    select count(*) into n from public.approval_step_users(
      (select id from public.approval_steps where workflow_code = 'leave' and approver_kind = 'HR'), sub_emp) u
     where u.user_id = hr_u;
    log := log || extensions.is(n, 1, 'مدير HR مُوافِق على الإجازة');
    perform tests.act_as(hr_u);
    log := log || extensions.ok(public.can_manage_hr() and public.can_see_payroll(), 'مدير HR يدير ويرى الرواتب');

    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr');
    perform tests.act_as(hr_u);
    log := log || extensions.ok(public.can_manage_hr() and public.can_see_payroll(),
      'دور hr النظامي كما كان قبل الفرض');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 9: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_integrations() is
  'اختبارات المرحلة 9: الاسم، المدير، المنصب والدور، الخروج، الفحص، المصفوفة (sql/172). يُلغي أثره.';

revoke all on function tests.run_integrations() from public;
grant execute on function tests.run_integrations() to service_role;
