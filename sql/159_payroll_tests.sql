-- ============================================================
-- تلال ERP — 159: اختبارات محرّك الكشف والتعويضات والكلفة (المرحلة 5)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_payroll5();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
-- الكشوف في 2020 — بعيداً عن أي كشف حقيقي، وتاريخ مباشرة الموظف يُعاد
-- إلى ما قبلها داخل المعاملة.
--
--   المصادر    البدل (كاملاً ومجزّأً)، المكافأة، العمل الإضافي، صرف الرصيد ⇒ «allowances»
--   الحماية    اليدوي والمعدَّل يبقيان بعد إعادة البناء، ولا تكرار، والأصل محسوب
--   القيود     مبلغ اعتُمد في سلسلة لا يُغيَّر من الكشف، وحذف البند يحرّر مصدره
--   الموافقة   رافع الطلب لا يوافق عليه، والخطوة بلا غيره تُصعَّد
--   الصرف      بحدود الرصيد، وقيمة اليوم مجمّدة، وحركة «صرف نقدي»
--   الحسابات   الربط الافتراضي = الأرقام القديمة، وتغييره يغيّر حساب القيد
--   الكلفة     التوزيع بالنِّسَب ≤ 100%، وكلفة القسم
--   القسيمة    للموظف المعتمدة فقط، والمجاميع = الكشف
--   الرؤية     الغريب لا يرى مكافأة غيره ولا ربط الحسابات
--
-- يتطلب: 082، 145–158.
-- ============================================================

create or replace function tests.run_payroll5()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; out_u uuid; emp uuid; emp_u uuid; proj uuid;
  pr uuid; pr2 uuid; al uuid; bn uuid; ot uuid; en uuid; ln uuid; v_type uuid; v_acc uuid;
  n int; txt text; rec record; v numeric; j jsonb;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select x.uid, x.eid into emp_u, emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and coalesce(e.base_salary, 0) > 0) x where x.rn = 1;
  select x.uid into hr_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and e.id <> coalesce(emp, '00000000-0000-0000-0000-000000000000'::uuid)) x where x.rn = 1;
  select x.uid into out_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and e.id <> coalesce(emp, '00000000-0000-0000-0000-000000000000'::uuid)) x where x.rn = 2;
  select id into proj from public.projects order by created_at limit 1;

  if admin_u is null or hr_u is null or out_u is null or emp is null or proj is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف براتب وموظفان آخران ومشروع'::text;
    return;
  end if;

  begin
    update public.company_settings set attendance_rules_enabled = false where id = 1;
    update public.employees set hire_date = date '2019-01-01', end_date = null where id = emp;
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_manager');   -- (180) موظف HR لا يعتمد ولا يرى الرواتب منذ 171

    -- ================= المصادر =================
    perform tests.act_as(hr_u);
    insert into public.employee_allowances (employee_id, name, amount, start_date)
    values (emp, 'بدل نقل', 100000, '2020-01-01') returning id into al;
    insert into public.employee_bonuses (employee_id, bonus_type, amount, reason, payable_period, status)
    values (emp, 'أداء', 50000, 'اختبار', '2020-03', 'معتمد') returning id into bn;
    insert into public.overtime_requests (employee_id, work_date, start_time, end_time, hours, reason, compensation,
                                          status, rate_factor, hourly_rate, amount)
    values (emp, '2020-03-10', '18:00', '20:00', 2, 'اختبار', 'أجر', 'معتمد', 1.5, 10000, 30000) returning id into ot;
    select id into v_type from public.leave_types where name = 'سنوية';
    insert into public.leave_encashments (employee_id, leave_type_id, days, status, day_value, amount)
    values (emp, v_type, 1, 'معتمد', 20000, 20000) returning id into en;

    pr := public.build_payroll(emp, '2020-03');
    select * into rec from public.payrolls where id = pr;
    log := log || extensions.is(rec.allowances, 200000::numeric,
      'البدل + المكافأة + الإضافي + صرف الرصيد = allowances (100+50+30+20 ألف)');
    log := log || extensions.ok(
      (select payroll_id = pr from public.employee_bonuses where id = bn)
      and (select payroll_id = pr from public.overtime_requests where id = ot)
      and (select payroll_id = pr from public.leave_encashments where id = en),
      'المصادر تُربط بالكشف');
    log := log || extensions.ok(
      (select count(*) = 0 from public.payroll_lines where payroll_id = pr and origin <> 'نظام'),
      'بنود المولِّد أصلها «نظام»');

    -- ================= الحماية =================
    ln := public.add_payroll_line(pr, 'استحقاق', 'بدل', 'بدل يدوي', 7000);
    select id into al from public.payroll_lines where payroll_id = pr and category = 'راتب أساسي';
    select amount into v from public.payroll_lines where id = al;
    perform public.update_payroll_line(al, v - 1000, 'أساسي معدَّل');
    log := log || extensions.ok(
      (select origin = 'يدوي' from public.payroll_lines where id = ln)
      and (select origin = 'معدَّل' from public.payroll_lines where id = al),
      'الأصل: يدوي ومعدَّل');

    perform public.build_payroll(emp, '2020-03');
    log := log || extensions.ok(
      exists (select 1 from public.payroll_lines where id = ln and amount = 7000)
      and (select amount = v - 1000 from public.payroll_lines where id = al)
      and (select count(*) = 1 from public.payroll_lines where payroll_id = pr and category = 'راتب أساسي')
      and (select count(*) = 1 from public.payroll_lines where payroll_id = pr and source_table = 'employee_bonuses'),
      'إعادة البناء تُبقي اليدوي والمعدَّل ولا تكرّر');

    select id into ln from public.payroll_lines where payroll_id = pr and source_table = 'employee_bonuses';
    begin
      perform public.update_payroll_line(ln, 99999, 'تلاعب');
      log := log || extensions.fail('مبلغ المكافأة المعتمدة لا يُغيَّر من الكشف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سلسلة موافقته%', 'مبلغ المكافأة المعتمدة لا يُغيَّر من الكشف');
    end;

    select id into ln from public.payroll_lines where payroll_id = pr and source_table = 'overtime_requests';
    perform public.remove_payroll_line(ln);
    log := log || extensions.ok((select payroll_id is null from public.overtime_requests where id = ot),
                                'حذف بند الإضافي يحرّر طلبه');

    -- التجزئة: بدل يبدأ منتصف أبريل
    insert into public.employee_allowances (employee_id, name, amount, start_date)
    values (emp, 'بدل سكن', 30000, '2020-04-16');
    pr2 := public.build_payroll(emp, '2020-04');
    log := log || extensions.is(
      (select amount from public.payroll_lines where payroll_id = pr2 and description like 'بدل سكن%'), 15000::numeric,
      'البدل يُجزَّأ بأيام سريانه: 30 ألف × 15 من 30');

    -- ================= الموافقة: رافع الطلب لا يوافق =================
    perform tests.act_as(hr_u);
    bn := public.propose_bonus(emp, 40000, 'إنجاز', '2020-05');
    select * into rec from public.approval_requests r where r.entity_type = 'bonus' and r.entity_id = bn;
    log := log || extensions.ok(
      rec.current_step = 2
      and exists (select 1 from public.approval_actions a where a.request_id = rec.id and a.decision = 'تصعيد' and a.step_no = 1),
      'خطوة HR لا مُوافِق فيها غير رافع الطلب ⇒ تُصعَّد إلى المدير العام');
    begin
      perform public.approval_decide(rec.id, true);
      log := log || extensions.fail('رافع الطلب لا يوافق عليه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%على طلبه%', 'رافع الطلب لا يوافق عليه');
    end;
    perform tests.act_as(admin_u);
    perform public.approval_decide(rec.id, true);
    log := log || extensions.is((select status from public.employee_bonuses where id = bn), 'معتمد',
                                'المدير العام يعتمد فتصير المكافأة معتمدة');

    -- ================= صرف الرصيد =================
    update public.leave_types set encashable = true where id = v_type;
    insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note)
    values (emp, v_type, public.baghdad_today(), 5, 'تسوية يدوية', 'اختبار');
    perform tests.act_as(hr_u);
    begin
      perform public.request_leave_encashment(v_type, 1000, null, emp);
      log := log || extensions.fail('الصرف بحدود الرصيد');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%الرصيد المتاح%', 'الصرف بحدود الرصيد');
    end;
    en := public.request_leave_encashment(v_type, 2, 'تسوية', emp);
    perform tests.act_as(admin_u);
    perform public.approval_decide((select approval_id from public.leave_encashments where id = en), true);
    select * into rec from public.leave_encashments where id = en;
    log := log || extensions.ok(
      rec.status = 'معتمد' and rec.day_value = round(public.salary_at(emp, public.baghdad_today()) / 30.0)
      and rec.amount = rec.day_value * 2
      and exists (select 1 from public.leave_ledger l where l.id = rec.ledger_id and l.days = -2 and l.kind = 'صرف نقدي'),
      'الاعتماد يجمّد قيمة اليوم والمبلغ ويكتب «صرف نقدي» في الرصيد');

    -- ================= الحسابات =================
    log := log || extensions.ok(
      public.hr_account('salary_expense') = (select id from public.accounts where code = '5100')
      and public.hr_account('salary_payable') = (select id from public.accounts where code = '2300')
      and position('hr_account(''salary_expense'')' in pg_get_functiondef('public.repost_payroll(uuid)'::regprocedure)) > 0
      and position('hr_account(''commission_expense'')' in pg_get_functiondef('public.post_commission_to_ledger()'::regprocedure)) > 0,
      'الربط الافتراضي هو الأرقام القديمة، والدوالّ تقرؤه');

    select id into v_acc from public.accounts where code = '5110';
    if v_acc is not null then
      update public.hr_account_map set account_code = '5110' where key = 'salary_expense';
      perform public.approve_payroll(pr);
      log := log || extensions.ok(
        exists (select 1 from public.journal_lines jl join public.payrolls p on p.journal_entry_id = jl.entry_id
                 where p.id = pr and jl.account_id = v_acc and jl.debit > 0),
        'تغيير الربط يغيّر حساب مصروف القيد');
    else
      perform public.approve_payroll(pr);
      log := log || extensions.pass('تغيير الربط (لا حساب 5110 للاختبار)');
    end if;

    -- ================= القسيمة =================
    perform tests.act_as(emp_u);
    j := public.salary_slip(pr);
    log := log || extensions.ok(
      (j->'totals'->>'net')::numeric = (select net from public.payrolls where id = pr)
      and jsonb_array_length(j->'earnings') >= 4,
      'الموظف يرى قسيمته المعتمدة بمجاميع الكشف');
    begin
      perform public.salary_slip(pr2);
      log := log || extensions.fail('قسيمة المسودة لا تُعرض للموظف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا صلاحية%', 'قسيمة المسودة لا تُعرض للموظف');
    end;
    perform tests.act_as(out_u);
    begin
      perform public.salary_slip(pr);
      log := log || extensions.fail('لا يرى أحد قسيمة غيره');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا صلاحية%', 'لا يرى أحد قسيمة غيره');
    end;

    -- ================= الكلفة =================
    perform tests.act_as(hr_u);
    insert into public.employee_project_allocations (employee_id, project_id, allocation_pct, start_date)
    values (emp, proj, 60, '2020-01-01');
    begin
      insert into public.employee_project_allocations (employee_id, project_id, allocation_pct, start_date)
      values (emp, null, 50, '2020-01-01');
      log := log || extensions.fail('مجموع التوزيع لا يتجاوز 100%');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%100%', 'مجموع التوزيع لا يتجاوز 100%');
    end;
    select coalesce(sum(cost), 0), count(*) into v, n
      from public.payroll_cost_allocation('2020-03', '2020-03') where employee_id = emp;
    select coalesce(basic, 0) + coalesce(allowances, 0) + coalesce(commissions_total, 0) into rec
      from public.payrolls where id = pr;
    log := log || extensions.ok(
      n = 2 and abs(v - ((select coalesce(basic, 0) + coalesce(allowances, 0) + coalesce(commissions_total, 0)
                            from public.payrolls where id = pr))) <= 1
      and exists (select 1 from public.payroll_cost_allocation('2020-03', '2020-03')
                   where employee_id = emp and project_id = proj and share_pct = 60),
      'الكلفة تُوزَّع 60% للمشروع والباقي لمشروع الكشف أو العام، ومجموعها كلفة الكشف');
    log := log || extensions.ok(
      exists (select 1 from public.department_costs('2020-03', '2020-03') where bonuses >= 50000),
      'كلفة القسم تُظهر المكافآت');

    -- ================= الرؤية =================
    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.employee_bonuses where employee_id = emp;
    select n + count(*) into n from public.hr_account_map;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى مكافآت غيره ولا ربط الحسابات');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 5: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_payroll5() is
  'اختبارات المرحلة 5: مصادر الكشف، حماية البنود، الموافقة، صرف الرصيد، ربط الحسابات، الكلفة، القسيمة (sql/159). يُلغي أثره.';

revoke all on function tests.run_payroll5() from public;
grant execute on function tests.run_payroll5() to service_role;
