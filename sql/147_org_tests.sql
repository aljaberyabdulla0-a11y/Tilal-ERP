-- ============================================================
-- تلال ERP — 147: اختبارات الهيكل التنظيمي والأدوار (المرحلة 1)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_org();
--
-- نمط 082/142: كل شيء في معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الترحيل      كل موظف له رمز ومنصب وقسم، والنصّان المشتقّان يطابقان المرجع،
--                و profiles.role = مستوى دورها، والمدير العام خرج من «التسويق»
--   الحرّاس      لا حلقة أقسام ولا إدارة، لا أرشفة لحيّ، لا تعيين على مؤرشف،
--                الموظف الجديد يأخذ رمزه وقسمه ومسمّاه
--   الأدوار      التعيين يشتق المستوى، الكتابة القديمة تبقى تعمل، تغيير المستوى يسري،
--                النظامي ثابت، لا تغيير للنفس، لا وسيط من هنا، HR لا يعيّن
--   الصلاحيات    has_permission/permission_scope، الهيكل يُدار بالمصفوفة، HR لا يعتمد الكشف
--   RLS          الموظف يقرأ ولا يكتب ولا يرى الدرجات، HR يكتب الهيكل لا الأدوار،
--                المحاسب لا يعدّل الهيكل، مدير القسم يرى ناسه بلا رواتب وحدهم،
--                الوسيط لا يرى الهيكل، والموظف يرى نفسه فقط كما كان
--
-- يتطلب: 082 (tests.act_as)، 145، 146.
-- ============================================================

create or replace function tests.run_org()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; hr_u uuid; acc_u uuid; brk_u uuid;
  d_sales uuid; d_agents uuid; d_mkt uuid; d_a uuid; d_b uuid; d_x uuid;
  p_t uuid; p_agent uuid; e_new uuid;
  n int; txt text; b boolean; rec record;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into brk_u   from public.profiles where role = 'broker' order by created_at limit 1;
  -- ثلاثة حسابات «موظف» بملفّات نشطة: موظف عادي، ويُرقّى اثنان مؤقتاً إلى HR والمالية
  select x.uid, x.eid into plain_u, plain_emp from (
    select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
      from public.profiles p join public.employees e on e.user_id = p.id
     where p.role = 'employee' and e.status = 'active') x where x.rn = 1;
  select x.uid into hr_u from (
    select p.id uid, row_number() over (order by p.created_at) rn
      from public.profiles p join public.employees e on e.user_id = p.id
     where p.role = 'employee' and e.status = 'active') x where x.rn = 2;
  select x.uid into acc_u from (
    select p.id uid, row_number() over (order by p.created_at) rn
      from public.profiles p join public.employees e on e.user_id = p.id
     where p.role = 'employee' and e.status = 'active') x where x.rn = 3;

  select id into d_sales  from public.departments where code = 'SALES';
  select id into d_agents from public.departments where code = 'SALES-AGENTS';
  select id into d_mkt    from public.departments where code = 'MKT';
  select id into p_agent  from public.positions   where code = 'SALES-AGENT';

  if admin_u is null or plain_u is null or hr_u is null or acc_u is null or d_sales is null or p_agent is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وثلاثة موظفين بحسابات وبذرة 145'::text;
    return;
  end if;

  begin
    -- ================= الترحيل =================
    select count(*) into n from public.employees where employee_code is null or employee_code !~ '^EMP-[0-9]{4,}$';
    log := log || extensions.is(n, 0, 'كل موظف له رمز EMP-####');

    select count(*) - count(distinct employee_code) into n from public.employees;
    log := log || extensions.is(n, 0, 'رموز الموظفين لا تتكرر');

    select count(*) into n from public.employees where position_id is null or department_id is null;
    log := log || extensions.is(n, 0, 'كل موظف حالي ربط بمنصب وقسم من مسمّاه');

    select count(*) into n from public.employees e join public.departments d on d.id = e.department_id
     where e.department is distinct from d.name_ar;
    log := log || extensions.is(n, 0, 'نصّ القسم القديم يطابق القسم المرجعي');

    select count(*) into n from public.employees e join public.positions p on p.id = e.position_id
     where e.job_title is distinct from p.title_ar;
    log := log || extensions.is(n, 0, 'المسمّى القديم يطابق المنصب');

    select count(*) into n from public.profiles p join public.roles r on r.code = p.role_code
     where r.base_role <> p.role;
    log := log || extensions.is(n, 0, 'profiles.role = مستوى الدور لكل حساب — لا تغيّر وصول أحد');

    select count(*) into n from public.employees e
      join public.positions p on p.id = e.position_id and p.code = 'GM'
      join public.departments d on d.id = e.department_id
     where d.code <> 'EXEC';
    log := log || extensions.is(n, 0, 'المدير العام في الإدارة العليا لا في التسويق');

    perform tests.act_as(admin_u);
    select count(*) into n from public.department_tree();
    log := log || extensions.is(n, (select count(*)::int from public.departments where status = 'نشط'),
                                'الشجرة تجمع كل قسم نشط — لا يتيم ولا حلقة');

    select count(*) into n from public.roles r
     where r.base_role not in ('admin', 'broker')
       and not exists (select 1 from public.role_permissions rp
                        where rp.role_code = r.code and rp.module = 'organization' and 'read' = any(rp.actions));
    log := log || extensions.is(n, 0, 'كل دور داخلي يقرأ الهيكل');

    -- ================= الحرّاس =================
    insert into public.departments (code, name_ar) values ('t-a', 'اختبار أ') returning id into d_a;
    insert into public.departments (code, name_ar, parent_id) values ('T-B', 'اختبار ب', d_a) returning id into d_b;
    log := log || extensions.is((select code from public.departments where id = d_a), 'T-A', 'الرمز يُكتب بحروف كبيرة');

    begin
      update public.departments set parent_id = d_b where id = d_a;
      log := log || extensions.fail('حلقة الأقسام تُرفض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%تحت نفسه%', 'حلقة الأقسام تُرفض');
    end;

    begin
      update public.departments set status = 'مؤرشف' where id = d_agents;
      log := log || extensions.fail('لا يؤرشف قسم فيه موظفون نشطون');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%موظف نشط%', 'لا يؤرشف قسم فيه موظفون نشطون');
    end;

    begin
      update public.departments set status = 'مؤرشف' where id = d_a;
      log := log || extensions.fail('لا يؤرشف قسم تحته أقسام نشطة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%أقسام نشطة%', 'لا يؤرشف قسم تحته أقسام نشطة');
    end;

    update public.departments set status = 'مؤرشف' where id = d_b;
    begin
      insert into public.departments (code, name_ar, parent_id) values ('T-C', 'اختبار ج', d_b);
      log := log || extensions.fail('لا قسم نشط تحت مؤرشف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مؤرشف%', 'لا قسم نشط تحت مؤرشف');
    end;

    insert into public.positions (code, title_ar, department_id) values ('T-POS', 'منصب اختبار', d_a) returning id into p_t;
    update public.positions set status = 'مؤرشف' where id = p_t;
    begin
      update public.employees set position_id = p_t where id = plain_emp;
      log := log || extensions.fail('لا تعيين على منصب مؤرشف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مؤرشف%', 'لا تعيين على منصب مؤرشف');
    end;

    begin
      update public.positions set status = 'مؤرشف' where id = p_agent;
      log := log || extensions.fail('لا يؤرشف منصب يشغله أحد');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يشغله%', 'لا يؤرشف منصب يشغله أحد');
    end;

    begin
      update public.positions set reports_to_position_id = p_agent
       where code = (select b.code from public.positions b where b.id =
                     (select reports_to_position_id from public.positions where id = p_agent));
      log := log || extensions.fail('حلقة المناصب تُرفض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يتبعه%', 'حلقة المناصب تُرفض');
    end;

    insert into public.employees (full_name, base_salary, position_id, hire_date)
    values ('موظف اختبار الهيكل', 0, p_agent, public.baghdad_today())
    returning id into e_new;
    select * into rec from public.employees where id = e_new;
    log := log || extensions.ok(
      rec.employee_code ~ '^EMP-[0-9]{4,}$' and rec.department_id = d_agents
      and rec.job_title = 'موظف مبيعات' and rec.department = 'مندوبو المبيعات'
      and rec.employment_type = 'full_time',
      'الموظف الجديد يأخذ رمزه، وقسمه ومسمّاه ونوعه من منصبه');

    begin
      update public.employees set manager_id = id where id = plain_emp;
      log := log || extensions.fail('لا يكون الموظف مدير نفسه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لنفسه%', 'لا يكون الموظف مدير نفسه');
    end;

    update public.employees set manager_id = plain_emp where id = e_new;
    begin
      update public.employees set manager_id = e_new where id = plain_emp;
      log := log || extensions.fail('حلقة الإدارة تُرفض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يدور%', 'حلقة الإدارة تُرفض');
    end;

    -- ================= الأدوار =================
    perform tests.act_as(admin_u);
    txt := public.assign_user_role(hr_u, 'hr_officer');
    log := log || extensions.ok(
      txt = 'hr' and (select role = 'hr' and role_code = 'hr_officer' from public.profiles where id = hr_u),
      'تعيين «موظف HR» يشتق المستوى hr');

    txt := public.assign_user_role(acc_u, 'finance_manager');
    log := log || extensions.ok(
      (select role = 'accountant' and role_code = 'finance_manager' from public.profiles where id = acc_u),
      'تعيين «المدير المالي» يشتق المستوى accountant');

    log := log || extensions.ok(
      (select count(*) from public.audit_log where table_name = 'profiles' and record_id = hr_u
          and 'role_code' = any(changed_fields)) >= 1,
      'تغيير الدور يُسجَّل في سجلّ التدقيق');

    begin
      perform public.assign_user_role(admin_u, 'employee');
      log := log || extensions.fail('المدير لا يغيّر دوره بنفسه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%بنفسه%', 'المدير لا يغيّر دوره بنفسه');
    end;

    begin
      perform public.assign_user_role(plain_u, 'broker');
      log := log || extensions.fail('دور الوسيط لا يُعيَّن من هنا');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%الوسطاء%', 'دور الوسيط لا يُعيَّن من هنا');
    end;

    update public.profiles set role = 'supervisor' where id = plain_u;
    log := log || extensions.is((select role_code from public.profiles where id = plain_u), 'supervisor',
                                'الكتابة القديمة على role تُرجع role_code إلى الدور النظامي');
    update public.profiles set role = 'employee' where id = plain_u;

    insert into public.roles (code, name_ar, base_role) values ('test_org_editor', 'محرّر هيكل (اختبار)', 'employee');
    insert into public.role_permissions (role_code, module, actions, scope)
    values ('test_org_editor', 'organization', '{manage,read,read}', 'all');
    log := log || extensions.is((select actions from public.role_permissions
                                  where role_code = 'test_org_editor' and module = 'organization'),
                                '{manage,read}'::text[], 'الأفعال تُرتَّب وتُزال مكرّراتها');

    perform public.assign_user_role(plain_u, 'test_org_editor');
    update public.roles set base_role = 'viewer' where code = 'test_org_editor';
    log := log || extensions.ok(
      (select role = 'viewer' and role_code = 'test_org_editor' from public.profiles where id = plain_u),
      'تغيير مستوى الدور يسري على حساباته ويُبقي الدور');
    update public.roles set base_role = 'employee' where code = 'test_org_editor';

    begin
      update public.roles set base_role = 'admin' where code = 'employee';
      log := log || extensions.fail('مستوى الدور النظامي ثابت');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ثابت%', 'مستوى الدور النظامي ثابت');
    end;

    begin
      update public.roles set status = 'مؤرشف' where code = 'test_org_editor';
      log := log || extensions.fail('لا يؤرشف دور عليه حسابات');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%حساب%', 'لا يؤرشف دور عليه حسابات');
    end;

    perform tests.act_as(hr_u);
    begin
      perform public.assign_user_role(plain_u, 'employee');
      log := log || extensions.fail('HR لا يعيّن الأدوار');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمدير وحده%', 'HR لا يعيّن الأدوار');
    end;

    -- ================= الصلاحيات =================
    perform tests.act_as(plain_u);
    log := log || extensions.ok(
      public.has_permission('organization', 'manage') and public.can_manage_org(),
      'دور مخصّص بصلاحية «إدارة الهيكل» يدير الهيكل وهو بمستوى موظف');

    perform tests.act_as(admin_u);
    perform public.assign_user_role(plain_u, 'employee');

    perform tests.act_as(plain_u);
    log := log || extensions.ok(
      not public.has_permission('organization', 'manage') and not public.can_manage_org()
      and public.has_permission('organization', 'read'),
      'الموظف يقرأ الهيكل ولا يديره');
    log := log || extensions.is(public.permission_scope('attendance', 'create'), 'own', 'نطاق الموظف نفسه');
    log := log || extensions.ok(public.permission_scope('payroll', 'approve') is null, 'الموظف لا يعتمد الكشف');

    perform tests.act_as(hr_u);
    log := log || extensions.ok(
      not public.has_permission('payroll', 'approve') and public.can_manage_org(),
      'HR يدير الهيكل ولا يعتمد الكشف (فصل الواجبات)');

    perform tests.act_as(acc_u);
    log := log || extensions.ok(
      public.has_permission('payroll', 'approve') and not public.can_manage_org(),
      'المالية تعتمد الكشف ولا تدير الهيكل');

    perform tests.act_as(admin_u);
    log := log || extensions.ok(public.has_permission('payroll', 'approve') and public.permission_scope('crm', 'read') = 'all',
                                'المدير يملك كل شيء');

    -- ================= RLS =================
    insert into public.job_grades (code, name_ar, level, salary_min, salary_max) values ('TG1', 'درجة اختبار', 1, 100, 200);

    perform tests.act_as(plain_u);
    set local role authenticated;
    select count(*) into n from public.departments;
    reset role;
    log := log || extensions.ok(n > 0, 'الموظف يقرأ الأقسام');

    set local role authenticated;
    select count(*) into n from public.job_grades;
    reset role;
    log := log || extensions.is(n, 0, 'الموظف لا يرى الدرجات ونطاق الرواتب');

    set local role authenticated;
    begin
      insert into public.departments (code, name_ar) values ('T-RLS1', 'تسلّل');
      reset role;
      log := log || extensions.fail('الموظف لا يُنشئ قسماً');
    exception when others then
      reset role;
      log := log || extensions.pass('الموظف لا يُنشئ قسماً');
    end;

    set local role authenticated;
    update public.departments set name_en = 'hacked' where id = d_sales;
    get diagnostics n = row_count;
    reset role;
    log := log || extensions.is(n, 0, 'الموظف لا يعدّل قسماً');

    set local role authenticated;
    begin
      insert into public.roles (code, name_ar, base_role) values ('t_escalate', 'تصعيد', 'admin');
      reset role;
      log := log || extensions.fail('الموظف لا يُنشئ دوراً');
    exception when others then
      reset role;
      log := log || extensions.pass('الموظف لا يُنشئ دوراً');
    end;

    set local role authenticated;
    select count(*) into n from public.employees;
    reset role;
    log := log || extensions.is(n, 1, 'الموظف يرى ملفه وحده — كما كان');

    set local role authenticated;
    select count(distinct role_code) into n from public.role_permissions;
    reset role;
    log := log || extensions.is(n, 1, 'الموظف يقرأ صلاحيات دوره وحده');

    set local role authenticated;
    begin
      perform * from public.department_members(d_sales);
      reset role;
      log := log || extensions.fail('الموظف لا يرى ناس قسمٍ لا يديره');
    exception when others then
      reset role;
      log := log || extensions.ok(sqlerrm like '%لا صلاحية%', 'الموظف لا يرى ناس قسمٍ لا يديره');
    end;

    -- مدير قسم التسويق بدورٍ «موظف»: يرى ناسه، بلا رواتب، ولا يرى المبيعات
    update public.departments set manager_id = plain_emp where id = d_mkt;
    set local role authenticated;
    select count(*) into n from public.department_members(d_mkt);
    reset role;
    log := log || extensions.ok(n >= 1, 'مدير القسم يرى ناس قسمه وما تحته');

    set local role authenticated;
    begin
      perform * from public.department_members(d_sales);
      reset role;
      log := log || extensions.fail('مدير التسويق لا يرى ناس المبيعات');
    exception when others then
      reset role;
      log := log || extensions.pass('مدير التسويق لا يرى ناس المبيعات');
    end;

    log := log || extensions.ok(
      not exists (select 1 from pg_proc p where p.proname = 'department_members'
                   and (p.proargnames && array['base_salary', 'commission_rate', 'phone'])),
      'department_members لا تُرجع الراتب ولا العمولة ولا الهاتف');

    set local role authenticated;
    select count(*) into n from public.employees;
    reset role;
    log := log || extensions.is(n, 1, 'إدارة القسم لا تفتح جدول الموظفين (الرواتب) لمديره');

    perform tests.act_as(hr_u);
    set local role authenticated;
    begin
      insert into public.departments (code, name_ar, parent_id) values ('T-HR', 'قسم من HR', d_a) returning id into d_x;
      reset role;
      log := log || extensions.ok(d_x is not null, 'HR يُنشئ قسماً');
    exception when others then
      reset role;
      log := log || extensions.fail('HR يُنشئ قسماً: ' || sqlerrm);
    end;

    set local role authenticated;
    select count(*) into n from public.job_grades where code = 'TG1';
    reset role;
    log := log || extensions.is(n, 1, 'HR يرى الدرجات');

    set local role authenticated;
    begin
      insert into public.roles (code, name_ar, base_role) values ('t_hr_role', 'دور من HR', 'hr');
      reset role;
      log := log || extensions.fail('HR لا يُنشئ أدواراً');
    exception when others then
      reset role;
      log := log || extensions.pass('HR لا يُنشئ أدواراً');
    end;

    set local role authenticated;
    update public.role_permissions set actions = actions || array['approve'] where role_code = 'hr_officer' and module = 'payroll';
    get diagnostics n = row_count;
    reset role;
    log := log || extensions.is(n, 0, 'HR لا يمنح نفسه اعتماد الكشف');

    perform tests.act_as(acc_u);
    set local role authenticated;
    update public.departments set name_en = 'x' where id = d_sales;
    get diagnostics n = row_count;
    reset role;
    log := log || extensions.is(n, 0, 'المحاسب لا يعدّل الهيكل');

    set local role authenticated;
    select count(*) into n from public.job_grades where code = 'TG1';
    reset role;
    log := log || extensions.is(n, 1, 'المالية ترى الدرجات');

    if brk_u is not null then
      perform tests.act_as(brk_u);
      set local role authenticated;
      select count(*) into n from public.departments;
      select n + count(*) into n from public.department_tree();
      reset role;
      log := log || extensions.is(n, 0, 'الوسيط الخارجي لا يرى الهيكل');
    end if;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الهيكل: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_org() is
  'اختبارات الهيكل التنظيمي والأدوار والمصفوفة وRLS (sql/147). يُلغي أثره.';

revoke all on function tests.run_org() from public;
grant execute on function tests.run_org() to service_role;
