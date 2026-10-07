-- ============================================================
-- تلال ERP — 164: اختبارات المصروفات والعهد وإنهاء الخدمة (المرحلة 7)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_offboarding();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
-- إنهاء الخدمة على موظفٍ يُنشأ داخل المعاملة — لا يُمسّ موظف حقيقي.
--
--   المصروف   الإيصال إلزامي ومساره لصاحبه، المدير ثم المالية، قيد الاستحقاق
--             على حساب الفئة، الدفع للمالية بقيده، والغريب لا يرى
--   الإنهاء   الغريب لا يطلب، السلسلة تُصعَّد عن رافعها، الاعتماد يولّد الإخلاء
--             ويُنجز التلقائي، لا إكمال قبل الإخلاء
--   التسوية   الراتب بأيامه، الرصيد القابل للصرف، مكافأة نهاية الخدمة بقاعدة
--             المالك، السلف المتبقية
--   الإكمال   الأقساط تُعجَّل للكشف الأخير، الرصيد يُصرف، التسليم والإنهاء،
--             مكافأة نهاية الخدمة بندٌ يدوي باقٍ، الحالة مصنَّفة، لا إكمال مرتين
--
-- يتطلب: 082، 145–163.
-- ============================================================

create or replace function tests.run_offboarding()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; fin_u uuid; mgr_u uuid; mgr_emp uuid; emp_u uuid; emp uuid; out_u uuid;
  e2 uuid; ex uuid; adv uuid; asset uuid; term uuid; v_type uuid; v_req uuid;
  v_today date := public.baghdad_today();
  v_period text := to_char(public.baghdad_today(), 'YYYY-MM');
  v_next text := to_char(public.baghdad_today() + interval '1 month', 'YYYY-MM');
  n int; txt text; rec record; v numeric; j jsonb; c record;
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
  select x.uid into fin_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 4;
  select x.uid into out_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 5;

  if admin_u is null or emp is null or mgr_emp is null or hr_u is null or fin_u is null or out_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وخمسة موظفين بحسابات'::text;
    return;
  end if;

  begin
    update public.company_settings set attendance_rules_enabled = false where id = 1;
    update public.employees set manager_id = mgr_emp where id = emp;
    update public.employees set manager_id = null where id = mgr_emp;
    update public.profiles set role_code = 'employee' where role in ('hr', 'accountant') and role_code <> 'employee';
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');
    perform public.assign_user_role(fin_u, 'accountant');

    -- ================= المصروف =================
    perform tests.act_as(emp_u);
    begin
      perform public.submit_expense('meals', v_today, 25000, 'غداء عمل مع عميل');
      log := log || extensions.fail('الإيصال إلزامي');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%إيصال%', 'الإيصال إلزامي');
    end;
    begin
      perform public.submit_expense('meals', v_today, 25000, 'غداء', null, 'expenses/' || mgr_emp || '/r.pdf', 'r.pdf');
      log := log || extensions.fail('مسار الإيصال لصاحب المصروف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مسار الإيصال%', 'مسار الإيصال لصاحب المصروف');
    end;
    ex := public.submit_expense('meals', v_today, 25000, 'غداء عمل مع عميل', null, 'expenses/' || emp || '/r1.pdf', 'r1.pdf');
    v_req := (select approval_id from public.employee_expenses where id = ex);

    perform tests.act_as(mgr_u);
    perform public.approval_decide(v_req, true);
    perform tests.act_as(fin_u);
    perform public.approval_decide(v_req, true);
    select * into rec from public.employee_expenses where id = ex;
    log := log || extensions.ok(
      rec.status = 'معتمد' and rec.accrual_entry_id is not null
      and exists (select 1 from public.journal_lines jl join public.accounts a on a.id = jl.account_id
                   where jl.entry_id = rec.accrual_entry_id and a.code = '5320' and jl.debit = 25000)
      and exists (select 1 from public.journal_lines jl
                   where jl.entry_id = rec.accrual_entry_id and jl.account_id = public.hr_account('expense_payable') and jl.credit = 25000),
      'المدير ثم المالية ⇒ قيد استحقاق: مدين حساب الفئة / دائن مستحقات الموظفين');

    perform tests.act_as(emp_u);
    begin
      perform public.pay_expense(ex, 'نقد');
      log := log || extensions.fail('الدفع للمالية');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمالية%', 'الدفع للمالية');
    end;
    perform tests.act_as(fin_u);
    perform public.pay_expense(ex, 'نقد');
    select * into rec from public.employee_expenses where id = ex;
    log := log || extensions.ok(
      rec.status = 'مدفوع' and rec.payment_entry_id is not null
      and exists (select 1 from public.journal_lines jl join public.accounts a on a.id = jl.account_id
                   where jl.entry_id = rec.payment_entry_id and a.code = '1100' and jl.credit = 25000),
      'الدفع يُسجَّل بقيده: مدين المستحقات / دائن الصندوق');

    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.employee_expenses where employee_id = emp;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى مصروفات غيره');

    -- ================= الإنهاء: التحضير =================
    perform tests.act_as(admin_u);
    insert into public.employees (full_name, base_salary, hire_date, manager_id)
    values ('موظف اختبار الإنهاء', 900000, date '2025-01-01', mgr_emp) returning id into e2;
    insert into public.employee_assets (employee_id, asset_type, description, asset_tag)
    values (e2, 'حاسوب', 'لابتوب اختبار', 'T-LAP-1') returning id into asset;
    insert into public.employee_advances (employee_id, amount, installments, start_period, reason, status)
    values (e2, 200000, 2, v_period, 'اختبار', 'مصروفة') returning id into adv;
    insert into public.advance_installments (advance_id, seq, due_period, amount, status) values
      (adv, 1, v_period, 100000, 'مستحق'), (adv, 2, v_next, 100000, 'مستحق');
    select id into v_type from public.leave_types where name = 'سنوية';
    update public.leave_types set encashable = true where id = v_type;
    insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note)
    values (e2, v_type, v_today, 3, 'تسوية يدوية', 'اختبار');
    update public.company_settings set eos_days_per_year = 15, eos_min_years = 0 where id = 1;

    perform tests.act_as(out_u);
    begin
      perform public.submit_termination(e2, 'إنهاء خدمة', v_today, 'اختبار');
      log := log || extensions.fail('الغريب لا يطلب إنهاء خدمة غيره');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يطلب الإنهاء%', 'الغريب لا يطلب إنهاء خدمة غيره');
    end;

    perform tests.act_as(mgr_u);
    term := public.submit_termination(e2, 'إنهاء خدمة', v_today, 'إعادة هيكلة', mgr_emp);
    select * into rec from public.approval_requests r where r.entity_type = 'termination' and r.entity_id = term;
    log := log || extensions.ok(rec.current_step = 2,
      'خطوة المدير المباشر هو رافعها ⇒ تُصعَّد إلى HR');

    perform tests.act_as(hr_u);
    perform public.approval_decide(rec.id, true);
    perform tests.act_as(admin_u);
    perform public.approval_decide(rec.id, true);
    select count(*), count(*) filter (where status = 'منجزة') into n, i
      from public.clearance_items where termination_id = term;
    log := log || extensions.ok(
      (select status = 'معتمد' from public.termination_requests where id = term)
      and n = (select count(*) from public.clearance_templates where active)
      and (select status = 'منجزة' from public.clearance_items where termination_id = term and template_code = 'clear_expenses')
      and (select status = 'معلّقة' from public.clearance_items where termination_id = term and template_code = 'return_assets'),
      'الاعتماد يولّد الإخلاء: «لا مصروف» منجز تلقائياً، والعهدة معلّقة');
    i := 0;

    -- ================= التسوية =================
    j := public.final_settlement_preview(term);
    v := round(public.salary_at(e2, v_today) / 30.0);
    log := log || extensions.ok(
      (j ->> 'leave_total')::numeric = 3 * v
      and (j ->> 'advances_remaining')::numeric = 200000
      and (j ->> 'gratuity')::numeric = round(v * 15 * (j ->> 'service_years')::numeric)
      and (j ->> 'final_basic')::numeric > 0,
      'التسوية: الراتب بأيامه، الرصيد القابل للصرف، مكافأة نهاية الخدمة بقاعدة المالك، السلف');

    begin
      perform public.complete_termination(term);
      log := log || extensions.fail('لا إكمال قبل اكتمال الإخلاء');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%إخلاء الطرف ناقص%', 'لا إكمال قبل اكتمال الإخلاء');
    end;

    update public.employee_assets set status = 'مُعادة', returned_date = v_today, condition_in = 'سليمة' where id = asset;
    perform tests.act_as(hr_u);
    for c in select id from public.clearance_items
              where termination_id = term and status = 'معلّقة' and auto_rule is null loop
      perform public.complete_clearance_item(c.id, 'منجزة');
    end loop;

    -- ================= الإكمال =================
    perform tests.act_as(hr_u);
    begin
      perform public.complete_termination(term);
      log := log || extensions.fail('الإكمال للمدير');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمدير%', 'الإكمال للمدير');
    end;

    perform tests.act_as(admin_u);
    j := public.complete_termination(term);
    select * into rec from public.employees where id = e2;
    log := log || extensions.ok(
      rec.status = 'inactive' and rec.employment_status = 'منتهية خدمته' and rec.end_date = v_today
      and (select status = 'مكتمل' from public.termination_requests where id = term)
      and exists (select 1 from public.employee_handovers h where h.from_employee = e2 and h.ended_service),
      'الإكمال: التسليم والإنهاء، والحالة «منتهية خدمته»، والطلب مكتمل');
    log := log || extensions.ok(
      (select count(*) = 2 from public.payroll_lines l join public.payrolls p on p.id = l.payroll_id
        where p.employee_id = e2 and p.period = v_period and l.source_table = 'advance_installments')
      and exists (select 1 from public.payroll_lines l join public.payrolls p on p.id = l.payroll_id
                   where p.employee_id = e2 and p.period = v_period and l.source_table = 'leave_encashments')
      and exists (select 1 from public.payroll_lines l join public.payrolls p on p.id = l.payroll_id
                   where p.employee_id = e2 and p.period = v_period and l.manual
                     and l.description like 'مكافأة نهاية الخدمة%'),
      'الكشف الأخير: القسطان معجَّلان، الرصيد مصروف، ومكافأة نهاية الخدمة بندٌ يدوي');

    begin
      perform public.complete_termination(term);
      log := log || extensions.fail('لا إكمال مرتين');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%المعتمد فقط%', 'لا إكمال مرتين');
    end;

    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.termination_requests where id = term;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى طلبات الإنهاء');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 7: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  i := 0;
  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_offboarding() is
  'اختبارات المرحلة 7: المصروفات، العهد، إنهاء الخدمة، الإخلاء، التسوية، الإكمال (sql/164). يُلغي أثره.';

revoke all on function tests.run_offboarding() from public;
grant execute on function tests.run_offboarding() to service_role;
