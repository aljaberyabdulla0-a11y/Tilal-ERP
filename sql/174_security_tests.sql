-- ============================================================
-- تلال ERP — 174: اختبارات الأمن لكل دور (HR المؤسسي — المرحلة 10)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_security();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
-- كل فحص سلوكي يجري بدور authenticated وبهويّة المستخدم (act_as) فتُطبَّق
-- RLS كما يراها التطبيق — لا كما يراها postgres.
--
--   البنية     security_audit بلا «حرجة» ولا «عالية»؛ anon بلا جداول ولا دوال
--              عدا الأربع العامة؛ لا TRUNCATE لأحد
--   الزائر     لا يقرأ جدولاً، ونموذج الليد العام يعمل
--   الوسيط     يرى صفّه في profiles وحده، ولا موظفين ولا رواتب ولا تقارير HR
--   الموظف     صفّه وحده، كشوفه وحدها، لا يرفع راتبه ولا دوره، ولا أدوات الإدارة
--   المشرف     لا رواتب غيره
--   موظف HR    كل الموظفين والإجازات، ولا كشوف ولا تاريخ رواتب (المصفوفة)
--   HR النظامي والمحاسب  الكشوف كلها؛ المحاسب لا يعدّل موظفاً
--   القديمة    current_user_role تعمل، والجداول القديمة مغلقة على غير المدير
--
-- يتطلب: 082، 145–166، 170–173.
-- ============================================================

create or replace function tests.run_security()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; broker_u uuid; sup_u uuid; emp_u uuid; emp uuid; hr_u uuid; acc_u uuid;
  n int; m int; v numeric; b boolean; txt text;
  i int := 0;
  v_total_emp int; v_total_pay int; v_total_leaves int; v_total_hist int;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into broker_u from public.profiles where role = 'broker' order by created_at limit 1;
  select id into sup_u from public.profiles where role = 'supervisor' order by created_at limit 1;
  select x.uid, x.eid into emp_u, emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 1;
  select x.uid into hr_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 3;
  select x.uid into acc_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 4;

  if admin_u is null or broker_u is null or sup_u is null or emp is null or hr_u is null or acc_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير ووسيط ومشرف وأربعة موظفين بحسابات'::text;
    return;
  end if;

  select count(*) into v_total_emp from public.employees;
  select count(*) into v_total_pay from public.payrolls;
  select count(*) into v_total_leaves from public.leaves;
  select count(*) into v_total_hist from public.employee_salary_history;

  begin
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';

    -- ================= البنية =================
    perform tests.act_as(admin_u);
    select count(*) into n from public.security_audit() a where a.severity in ('حرجة', 'عالية');
    select string_agg(distinct a.check_name || ': ' || a.object_name, ' ؛ ') into txt
      from (select * from public.security_audit() a where a.severity in ('حرجة', 'عالية') limit 5) a;
    log := log || extensions.ok(n = 0, 'security_audit بلا «حرجة» ولا «عالية»' || coalesce(' — ' || txt, ''));

    log := log || extensions.ok(
      not has_table_privilege('anon', 'public.employees', 'select')
      and not has_table_privilege('anon', 'public.payrolls', 'select')
      and not has_table_privilege('anon', 'public.clients', 'select')
      and not has_table_privilege('anon', 'public.profiles', 'select'),
      'anon لا يقرأ الموظفين ولا الكشوف ولا العملاء ولا الحسابات');
    log := log || extensions.ok(
      not has_function_privilege('anon', 'public.is_admin()', 'execute')
      and not has_function_privilege('anon', 'public.assign_user_role(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.hr_report(text, date, date, jsonb)', 'execute')
      and has_function_privilege('anon', 'public.mkt_landing_public(text)', 'execute'),
      'anon لا ينفّذ دوال الإدارة، والصفحة العامة تعمل');
    log := log || extensions.ok(
      not has_table_privilege('authenticated', 'public.employees', 'truncate')
      and not has_table_privilege('authenticated', 'public.journal_entries', 'truncate'),
      'لا TRUNCATE للمسجّلين');
    log := log || extensions.ok(
      not has_column_privilege('authenticated', 'public.candidates', 'expected_salary', 'select'),
      'الراتب المتوقَّع للمرشح غير مقروء للمسجّلين');

    -- ================= الزائر =================
    perform tests.act_as(null);
    set local role anon;
    begin
      perform count(*) from public.employees;
      txt := 'مسموح';
    exception when others then txt := 'ممنوع';
    end;
    begin
      perform public.mkt_landing_public('no-such-slug-' || gen_random_uuid());
      b := true;
    exception when others then b := sqlerrm !~* 'permission denied';
    end;
    reset role;
    log := log || extensions.ok(txt = 'ممنوع' and b, 'الزائر: لا جدول الموظفين، والصفحة العامة تُستدعى');

    -- ================= الوسيط =================
    perform tests.act_as(broker_u);
    set local role authenticated;
    select count(*) into n from public.profiles;
    select count(*) into m from public.employees;
    select m + count(*) into m from public.payrolls;
    select m + count(*) into m from public.employee_salary_history;
    reset role;
    log := log || extensions.ok(n = 1 and m = 0, 'الوسيط: صفّه وحده في profiles، ولا موظفين ولا رواتب');
    begin
      perform public.hr_report('employees', null, null, '{}');
      log := log || extensions.fail('الوسيط يستخرج تقرير HR');
    exception when others then
      log := log || extensions.ok(true, 'الوسيط لا يستخرج تقارير HR');
    end;

    -- ================= الموظف =================
    perform tests.act_as(emp_u);
    set local role authenticated;
    select count(*) into n from public.employees;
    select count(*) into m from public.payrolls where employee_id <> emp;
    select m + count(*) into m from public.employee_salary_history where employee_id <> emp;
    select m + count(*) into m from public.employee_documents where employee_id <> emp;
    reset role;
    log := log || extensions.ok(n = 1 and m = 0, 'الموظف: صفّه وحده، ولا كشوف غيره ولا رواتبهم ولا مستنداتهم');

    select base_salary into v from public.employees where id = emp;
    set local role authenticated;
    begin
      update public.employees set base_salary = coalesce(base_salary, 0) + 1000000 where id = emp;
    exception when others then null;
    end;
    begin
      update public.profiles set role = 'admin', role_code = 'admin' where id = emp_u;
    exception when others then null;
    end;
    reset role;
    log := log || extensions.ok(
      (select base_salary from public.employees where id = emp) is not distinct from v
      and (select role from public.profiles where id = emp_u) = 'employee',
      'الموظف لا يرفع راتبه ولا دوره');

    n := 0;
    begin perform public.assign_user_role(emp_u, 'admin'); exception when others then n := n + 1; end;
    begin perform public.adjust_salary(emp, 9999999, public.baghdad_today(), 'اختبار'); exception when others then n := n + 1; end;
    begin perform public.handover_employee(emp, emp); exception when others then n := n + 1; end;
    begin perform public.security_audit(); exception when others then n := n + 1; end;
    begin perform * from public.integration_issues(); exception when others then n := n + 1; end;
    log := log || extensions.is(n, 5, 'الموظف لا يملك أدوات الإدارة (الأدوار، الراتب، التسليم، التدقيق، الفحص)');

    -- ================= المشرف =================
    perform tests.act_as(sup_u);
    set local role authenticated;
    select count(*) into n from public.payrolls p
     where p.employee_id is distinct from (select e.id from public.employees e where e.user_id = sup_u);
    select n + count(*) into n from public.employee_salary_history h
     where h.employee_id is distinct from (select e.id from public.employees e where e.user_id = sup_u);
    begin
      perform count(*) from public.team_members;
      b := true;
    exception when others then b := false;
    end;
    reset role;
    log := log || extensions.ok(n = 0 and b, 'المشرف: فريقه عبر team_members، ولا رواتب غيره');

    -- ================= موظف HR (المصفوفة) =================
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');
    perform tests.act_as(hr_u);
    set local role authenticated;
    select count(*) into n from public.employees;
    select count(*) into m from public.leaves;
    reset role;
    log := log || extensions.ok(n = v_total_emp and m = v_total_leaves, 'موظف HR يرى كل الموظفين والإجازات');
    set local role authenticated;
    select count(*) into n from public.payrolls p
     where p.employee_id is distinct from (select e.id from public.employees e where e.user_id = hr_u);
    select n + count(*) into n from public.employee_salary_history h
     where h.employee_id is distinct from (select e.id from public.employees e where e.user_id = hr_u);
    reset role;
    log := log || extensions.ok(n = 0 and not public.can_see_payroll(), 'موظف HR لا يرى كشوف غيره ولا تاريخ رواتبهم');

    -- ================= HR النظامي والمحاسب =================
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr');
    perform tests.act_as(hr_u);
    set local role authenticated;
    select count(*) into n from public.payrolls;
    select count(*) into m from public.employee_salary_history;
    reset role;
    log := log || extensions.ok(n = v_total_pay and m = v_total_hist, 'دور hr النظامي يرى الكشوف وتاريخ الرواتب كما كان');

    perform tests.act_as(admin_u);
    perform public.assign_user_role(acc_u, 'accountant');
    perform tests.act_as(acc_u);
    set local role authenticated;
    select count(*) into n from public.payrolls;
    update public.employees set notes = coalesce(notes, '') || ' ' where id = emp;
    get diagnostics m = row_count;
    reset role;
    log := log || extensions.ok(n = v_total_pay and m = 0, 'المحاسب يرى الكشوف ولا يعدّل موظفاً');

    -- ================= الجداول القديمة (D6) =================
    perform tests.act_as(emp_u);
    set local role authenticated;
    begin
      select count(*) into n from public.properties;
      select n + count(*) into n from public.deals;
      txt := public.current_user_role();
      b := true;
    exception when others then b := false; txt := sqlerrm;
    end;
    reset role;
    log := log || extensions.ok(b and n = 0 and txt = 'employee',
      'current_user_role تعمل، والجداول القديمة مغلقة على غير المدير' || case when not b then ' — ' || txt else '' end);

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الأمن: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_security() is
  'اختبارات المرحلة 10: البنية، الزائر، الوسيط، الموظف، المشرف، موظف HR، HR والمحاسب، الجداول القديمة (sql/174). يُلغي أثره.';

revoke all on function tests.run_security() from public;
grant execute on function tests.run_security() to service_role;
