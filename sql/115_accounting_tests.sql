-- ============================================================
-- تلال ERP — 115: اختبارات المحاسبة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_accounting();
--
-- ===== العزل =====
--
-- كل قيود الاختبار بتواريخ يناير ٢٠٢٠ — قبل أول قيد حقيقي بست سنوات —
-- وكل شيء داخل معاملة فرعية تُلغى في النهاية (نمط 082/100). الأدوار
-- التي لا مستخدم لها اليوم (محاسب، موارد بشرية) تُمنح مؤقتاً لموظف
-- داخل المعاملة الملغاة. لا يترك بيانات.
--
-- ===== ما يُختبر =====
--
--   الحركات      مصروف نقد، قبض بنك، مصروف من جيب شريك، إيداع شريك،
--                التصنيفات الموقوفة (109)، تعديل الأرقام، الحذف يسحب القيد
--   القيد اليدوي ذرّي متوازن، والرفض: غير متوازن، حساب غير نشط، طرفان،
--                سطر واحد، غير المالية؛ العكس مرّة واحدة؛ الآلي لا يُعكس
--   الحماية      المتصفّح لا يكتب قيداً ولا يحذف آلياً ويحذف اليدوي؛
--                الحجز المُرحَّل لا يُحذف
--   الرواتب      بناء ← اعتماد (5100/2300) ← دفع من جيب شريك (2300/2500)
--                ← تجاوز الصافي مرفوض ← دفع المسوّدة مرفوض
--   الديون       دين (1350/النقد) واستحصاله
--   الفترات      إقفال ← الكتابة مرفوضة ← فتح بسبب ← الكتابة تمرّ
--   الصفقات      تحصيل (1100/1250) وفسخ (4200/1250) على صفقة حقيقية
--                مع معاينة الفسخ
--   التقارير     الميزان متوازن، الملخّص = الأرصدة، الفترة تحصر الحركة،
--                كشف الحساب برصيد جارٍ، فحص الصحّة يكشف قيداً يتيماً
--   الأدوار      موظف، مشرف، محاسب، موارد بشرية، مدير
--   الـ commit   كل القيود المؤجَّلة تمرّ في النهاية
--
-- security invoker عمداً: `set local role authenticated` ممنوع داخل
-- definer (نفس سبب 084/100).
--
-- يتطلب: 082 (tests.act_as)، 107–114. آمن لإعادة التشغيل.
-- ============================================================

-- صافي حساب في قيد: مدين − دائن
create or replace function tests.jl(p_entry uuid, p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.journal_lines l join public.accounts a on a.id = l.account_id
   where l.entry_id = p_entry and a.code = p_code;
$$;

create or replace function tests.run_accounting()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log      text[] := '{}';
  admin_u  uuid; plain_u uuid; sup_u uuid;
  emp      uuid;
  p1       uuid;
  cm uuid; cm2 uuid; je uuid; je2 uuid; m1 uuid; m2 uuid; rv uuid;
  pr uuid; pr2 uuid; v_net numeric; debt uuid;
  res_c uuid; res_r uuid; v_amt numeric; j jsonb;
  n int; v numeric; v2 numeric; txt text;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into plain_u from public.profiles where role = 'employee' order by created_at limit 1;
  select id into sup_u   from public.profiles where role = 'supervisor' order by created_at limit 1;
  select e.id into emp from public.employees e
   where e.status = 'active' and coalesce(e.base_salary, 0) > 0 and e.end_date is null
   order by e.full_name limit 1;
  select id into p1 from public.partners order by created_at limit 1;

  if admin_u is null or plain_u is null or emp is null or p1 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف وشريك'::text;
    return;
  end if;

  begin
    update public.company_settings set attendance_rules_enabled = false where id = 1;
    perform tests.act_as(admin_u);

    -- ================= الحركات =================
    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
    values ('2020-01-05', 'صرف', 1000, 'ضيافة وطعام', '5320', 'إداري عام', 'نقد', 'اختبار مصروف')
    returning id into cm;
    select journal_entry_id into je from public.cash_moves where id = cm;
    log := log || extensions.ok(tests.jl(je, '5320') = 1000 and tests.jl(je, '1100') = -1000,
      'مصروف نقدي: مدين 5320 / دائن 1100');
    log := log || extensions.is((select source_id from public.journal_entries where id = je), cm,
      'القيد الآلي يحمل source_id حركته');

    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
    values ('2020-01-06', 'قبض', 2000, 'خدمات تسويق', '4400', 'التسويق', 'بنك', 'اختبار قبض')
    returning id into cm2;
    select journal_entry_id into je2 from public.cash_moves where id = cm2;
    log := log || extensions.ok(tests.jl(je2, '1200') = 2000 and tests.jl(je2, '4400') = -2000,
      'قبض بالبنك: مدين 1200 / دائن 4400');

    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, partner_id, description)
    values ('2020-01-06', 'صرف', 500, 'تسويق وإعلان', '5700', 'التسويق', 'نقد', p1, 'اختبار من الجيب')
    returning journal_entry_id into je;
    select journal_entry_id into je from public.cash_moves where description = 'اختبار من الجيب' and move_date = '2020-01-06';
    log := log || extensions.ok(tests.jl(je, '5700') = 500 and tests.jl(je, '2500') = -500 and tests.jl(je, '1100') = 0,
      'مصروف من جيب شريك: مدين 5700 / دائن 2500، الصندوق لا يُمسّ');

    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, partner_id, description)
    values ('2020-01-07', 'قبض', 700, 'إيداع من شريك', '2500', 'إداري عام', 'نقد', p1, 'اختبار إيداع');
    select journal_entry_id into je from public.cash_moves where description = 'اختبار إيداع' and move_date = '2020-01-07';
    log := log || extensions.ok(tests.jl(je, '1100') = 700 and tests.jl(je, '2500') = -700,
      'إيداع شريك: مدين 1100 / دائن 2500');

    -- التصنيفات الموقوفة (109)
    foreach txt in array array['5100', '4200', '4100', '5500', '2400'] loop
      begin
        insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
        values ('2020-01-08', case when txt in ('4200','4100') then 'قبض' else 'صرف' end, 10, 'x', txt, 'إداري عام', 'نقد', 'اختبار موقوف');
        log := log || extensions.fail('حركة جديدة على ' || txt || ' تُرفض');
      exception when others then
        log := log || extensions.pass('حركة جديدة على ' || txt || ' تُرفض');
      end;
    end loop;

    begin
      update public.cash_moves set amount = 999 where id = cm;
      log := log || extensions.fail('تعديل مبلغ حركة مُرحَّلة يُرفض');
    exception when others then
      log := log || extensions.pass('تعديل مبلغ حركة مُرحَّلة يُرفض');
    end;
    update public.cash_moves set description = 'اختبار مصروف — بيان معدّل' where id = cm;
    log := log || extensions.pass('تعديل بيان الحركة يمرّ');

    select journal_entry_id into je from public.cash_moves where id = cm;
    delete from public.cash_moves where id = cm;
    log := log || extensions.ok(not exists (select 1 from public.journal_entries where id = je),
      'حذف الحركة يسحب قيدها');

    -- ================= القيد اليدوي =================
    m1 := public.post_manual_entry('2020-01-09', 'اختبار قيد يدوي', null,
            '[{"account_code":"1100","debit":300},{"account_code":"3100","credit":300,"note":"رأس مال"}]'::jsonb);
    log := log || extensions.ok(
      (select reference = 'MANUAL' and source is null from public.journal_entries where id = m1)
      and tests.jl(m1, '1100') = 300 and tests.jl(m1, '3100') = -300,
      'قيد يدوي ذرّي: مدين 1100 / دائن 3100، مرجع MANUAL');

    begin
      perform public.post_manual_entry('2020-01-09', 'غير متوازن', null,
        '[{"account_code":"1100","debit":300},{"account_code":"3100","credit":200}]'::jsonb);
      log := log || extensions.fail('قيد يدوي غير متوازن يُرفض');
    exception when others then log := log || extensions.pass('قيد يدوي غير متوازن يُرفض'); end;

    begin
      perform public.post_manual_entry('2020-01-09', 'حساب مجمَّد', null,
        '[{"account_code":"1100","debit":300},{"account_code":"4100","credit":300}]'::jsonb);
      log := log || extensions.fail('قيد يدوي على 4100 غير النشط يُرفض');
    exception when others then log := log || extensions.pass('قيد يدوي على 4100 غير النشط يُرفض'); end;

    begin
      perform public.post_manual_entry('2020-01-09', 'طرفان', null,
        '[{"account_code":"1100","debit":300,"credit":300},{"account_code":"3100","credit":0}]'::jsonb);
      log := log || extensions.fail('سطر مدين ودائن معاً يُرفض');
    exception when others then log := log || extensions.pass('سطر مدين ودائن معاً يُرفض'); end;

    begin
      perform public.post_manual_entry('2020-01-09', 'سطر واحد', null,
        '[{"account_code":"1100","debit":300}]'::jsonb);
      log := log || extensions.fail('قيد بسطر واحد يُرفض');
    exception when others then log := log || extensions.pass('قيد بسطر واحد يُرفض'); end;

    rv := public.reverse_journal_entry(m1, '2020-01-10', 'اختبار العكس');
    log := log || extensions.ok(tests.jl(rv, '1100') = -300 and tests.jl(rv, '3100') = 300
      and (select reversal_of from public.journal_entries where id = rv) = m1,
      'عكس القيد اليدوي: السطور معكوسة والأصل باقٍ');
    begin
      perform public.reverse_journal_entry(m1, '2020-01-10', 'مرّة ثانية');
      log := log || extensions.fail('القيد يُعكس مرّة واحدة');
    exception when others then log := log || extensions.pass('القيد يُعكس مرّة واحدة'); end;
    begin
      perform public.reverse_journal_entry(je2, '2020-01-10', 'آلي');
      log := log || extensions.fail('القيد الآلي لا يُعكس من دفتر القيود');
    exception when others then log := log || extensions.pass('القيد الآلي لا يُعكس من دفتر القيود'); end;

    m2 := public.post_manual_entry('2020-01-11', 'اختبار قيد يُحذف', 'TEST',
            '[{"account_code":"5800","debit":50},{"account_code":"1100","credit":50}]'::jsonb);

    -- ================= الحماية: المتصفّح =================
    set local role authenticated;
    begin
      insert into public.journal_entries (entry_date, description) values ('2020-01-12', 'مباشر');
      log := log || extensions.fail('المتصفّح لا يكتب رأس قيد مباشرة');
    exception when others then log := log || extensions.pass('المتصفّح لا يكتب رأس قيد مباشرة'); end;
    begin
      delete from public.journal_entries where id = je2;
      log := log || extensions.fail('المتصفّح لا يحذف قيداً آلياً');
    exception when others then log := log || extensions.pass('المتصفّح لا يحذف قيداً آلياً'); end;
    begin
      update public.journal_entries set description = 'x' where id = m2;
      log := log || extensions.fail('المتصفّح لا يعدّل قيداً');
    exception when others then log := log || extensions.pass('المتصفّح لا يعدّل قيداً'); end;
    begin
      delete from public.journal_entries where id = m1;
      log := log || extensions.fail('قيدٌ له عاكس لا يُحذف');
    exception when others then log := log || extensions.pass('قيدٌ له عاكس لا يُحذف'); end;
    delete from public.journal_entries where id = m2;
    log := log || extensions.ok(not exists (select 1 from public.journal_entries where id = m2)
      and not exists (select 1 from public.journal_lines where entry_id = m2),
      'المالية تحذف القيد اليدوي مع سطوره');

    select id into res_c from public.reservations where commission_accrual_entry_id is not null limit 1;
    if res_c is not null then
      begin
        delete from public.reservations where id = res_c;
        log := log || extensions.fail('حجز له قيد عمولة لا يُحذف');
      exception when others then log := log || extensions.pass('حجز له قيد عمولة لا يُحذف'); end;
    else
      log := log || extensions.skip('لا حجز مُرحَّل في البيانات', 1);
    end if;
    reset role;

    -- ================= الرواتب =================
    pr := public.build_payroll(emp, '2020-01');
    perform public.approve_payroll(pr);
    select net, journal_entry_id into v_net, je from public.payrolls where id = pr;
    log := log || extensions.ok(tests.jl(je, '5100') > 0 and tests.jl(je, '2300') < 0
      and (select sum(debit) = sum(credit) from public.journal_lines where entry_id = je),
      'اعتماد الكشف: مدين 5100 / دائن 2300 متوازن');

    begin
      insert into public.payroll_payments (payroll_id, pay_date, amount, method)
      values (pr, '2020-02-01', v_net + 1, 'نقد');
      log := log || extensions.fail('دفعة تتجاوز صافي الكشف تُرفض');
    exception when others then log := log || extensions.pass('دفعة تتجاوز صافي الكشف تُرفض'); end;

    insert into public.payroll_payments (payroll_id, pay_date, amount, method, partner_id)
    values (pr, '2020-02-01', v_net, 'نقد', p1);
    select journal_entry_id into je from public.payroll_payments where payroll_id = pr;
    log := log || extensions.ok(tests.jl(je, '2300') = v_net and tests.jl(je, '2500') = -v_net
      and tests.jl(je, '1100') = 0,
      'دفع الكشف من جيب شريك: مدين 2300 / دائن 2500');
    log := log || extensions.is((select status from public.payrolls where id = pr), 'مدفوع',
      'الكشف المدفوع كاملاً حالته «مدفوع»');

    pr2 := public.build_payroll(emp, '2020-02');
    begin
      insert into public.payroll_payments (payroll_id, pay_date, amount, method)
      values (pr2, '2020-03-01', 1, 'نقد');
      log := log || extensions.fail('كشف مسوّدة لا يُدفع');
    exception when others then log := log || extensions.pass('كشف مسوّدة لا يُدفع'); end;
    delete from public.payrolls where id = pr2;

    -- ================= الديون =================
    insert into public.external_debts (person_name, amount, debt_date, method)
    values ('اختبار دين', 400, '2020-01-13', 'نقد') returning id, journal_entry_id into debt, je;
    select journal_entry_id into je from public.external_debts where id = debt;
    insert into public.debt_repayments (debt_id, pay_date, amount, method) values (debt, '2020-01-14', 150, 'نقد');
    select journal_entry_id into je2 from public.debt_repayments where debt_id = debt;
    log := log || extensions.ok(tests.jl(je, '1350') = 400 and tests.jl(je, '1100') = -400
      and tests.jl(je2, '1100') = 150 and tests.jl(je2, '1350') = -150,
      'دين خارجي (1350/1100) واستحصاله (1100/1350)');

    -- ================= الفترات =================
    perform public.close_period('2020-01', 'اختبار');
    begin
      insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
      values ('2020-01-20', 'صرف', 10, 'ضيافة وطعام', '5320', 'إداري عام', 'نقد', 'في فترة مقفلة');
      log := log || extensions.fail('لا حركة في فترة مقفلة');
    exception when others then log := log || extensions.pass('لا حركة في فترة مقفلة'); end;
    begin
      perform public.post_manual_entry('2020-01-20', 'في فترة مقفلة', null,
        '[{"account_code":"5800","debit":5},{"account_code":"1100","credit":5}]'::jsonb);
      log := log || extensions.fail('لا قيد يدوي في فترة مقفلة');
    exception when others then log := log || extensions.pass('لا قيد يدوي في فترة مقفلة'); end;
    perform public.reopen_period('2020-01', 'اختبار إعادة الفتح');
    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
    values ('2020-01-20', 'صرف', 10, 'ضيافة وطعام', '5320', 'إداري عام', 'نقد', 'بعد إعادة الفتح');
    log := log || extensions.pass('الفترة المُعاد فتحها تقبل الكتابة');

    -- ================= الصفقات =================
    select r.id, sc.company_amount into res_c, v_amt
      from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
     where r.commission_accrual_entry_id is not null and r.commission_collect_entry_id is null
       and sc.collected_at is null and sc.reversed_at is null
       and exists (select 1 from public.developer_invoices di where di.reservation_id = r.id and di.cancelled_at is null)
     order by r.created_at limit 1;
    if res_c is not null then
      perform public.collect_company_commission(res_c, (now() at time zone 'Asia/Baghdad')::date);
      select commission_collect_entry_id into je from public.reservations where id = res_c;
      log := log || extensions.ok(tests.jl(je, '1100') = v_amt and tests.jl(je, '1250') = -v_amt
        and (select source_id from public.journal_entries where id = je)
            = (select id from public.sale_commissions where reservation_id = res_c),
        'تحصيل عمولة تلال: مدين 1100 / دائن 1250، والمصدر سجلّ العمولة');
      j := public.sale_reversal_preview(res_c);
      log := log || extensions.ok(not (j->>'can_reverse')::boolean,
        'معاينة الفسخ تمنع صفقةً حُصّلت عمولتها');
    else
      log := log || extensions.skip('لا صفقة جاهزة للتحصيل', 2);
    end if;

    select r.id, sc.company_amount into res_r, v_amt
      from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
     where r.status = 'بيع مكتمل' and r.commission_accrual_entry_id is not null
       and sc.collected_at is null and sc.reversed_at is null and r.id is distinct from res_c
     order by r.created_at limit 1;
    if res_r is not null then
      j := public.sale_reversal_preview(res_r);
      log := log || extensions.ok((j->>'can_reverse')::boolean and jsonb_array_length(j->'impact') >= 2,
        'معاينة الفسخ: مسموح، وتعرض أثر الدفاتر');
      j := public.reverse_sale(res_r, 'اختبار الفسخ');
      select commission_reversal_entry_id into je from public.reservations where id = res_r;
      log := log || extensions.ok(tests.jl(je, '4200') = v_amt and tests.jl(je, '1250') = -v_amt
        and (j->>'reversal_entry_id')::uuid = je,
        'فسخ البيع: مدين 4200 / دائن 1250، وقيد العكس محفوظ على الحجز');
      log := log || extensions.ok(not exists (select 1 from public.developer_invoices
                                              where reservation_id = res_r and cancelled_at is null),
        'الفسخ يلغي فاتورة المطوّر');
    else
      log := log || extensions.skip('لا صفقة قابلة للفسخ', 3);
    end if;

    -- ================= التقارير =================
    select sum(debit), sum(credit) into v, v2 from public.account_balances(null, null);
    log := log || extensions.ok(v = v2, 'ميزان المراجعة متوازن (account_balances)');

    select sum(closing) into v from public.account_balances(null, null) where code in ('1100', '1200');
    log := log || extensions.is((public.money_overview()->>'cash')::numeric, v,
      'الملخّص: النقد = رصيد 1100 + 1200');

    select debit into v from public.account_balances('2020-01-01', '2020-01-31') where code = '5320';
    log := log || extensions.ok(v = 10,
      'أرصدة بفترة: حركة 5320 في يناير ٢٠٢٠ = ما بقي من الاختبار (10)');

    select count(*), max(running) into n, v from public.account_ledger('1100', '2020-01-01', '2020-01-31');
    log := log || extensions.ok(n >= 3 and v is not null, 'كشف الحساب 1100 برصيد جارٍ');

    -- قيد يتيم مصطنع: الحركة تنفصل عن قيدها
    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description)
    values ('2020-01-21', 'صرف', 20, 'ضيافة وطعام', '5320', 'إداري عام', 'نقد', 'اختبار يتيم')
    returning id into cm;
    select journal_entry_id into je from public.cash_moves where id = cm;
    update public.cash_moves set journal_entry_id = null where id = cm;
    log := log || extensions.ok(
      exists (select 1 from public.accounting_health() h where h.check_code = 'JRN_ORPHAN' and h.ref_id = je)
      and exists (select 1 from public.accounting_health() h where h.check_code = 'SRC_NO_JOURNAL' and h.ref_id = cm),
      'فحص الصحّة يكشف القيد اليتيم والحركة بلا قيد');
    update public.cash_moves set journal_entry_id = je where id = cm;

    select count(*) into n from public.payroll_reconciliation(null, null);
    log := log || extensions.ok(n >= 1, 'مطابقة الرواتب تعمل');

    -- ================= الأدوار =================
    perform tests.act_as(plain_u);
    foreach txt in array array[
      'select public.post_manual_entry(''2020-01-22'',''x'',null,''[{"account_code":"5800","debit":1},{"account_code":"1100","credit":1}]''::jsonb)',
      'select * from public.account_balances(null, null)',
      'select public.money_overview()',
      'select * from public.accounting_health()',
      'select * from public.payroll_reconciliation(null, null)'] loop
      begin
        execute txt;
        log := log || extensions.fail('الموظف ممنوع: ' || left(txt, 40));
      exception when others then
        log := log || extensions.pass('الموظف ممنوع: ' || left(txt, 40));
      end;
    end loop;

    if sup_u is not null then
      perform tests.act_as(sup_u);
      begin
        perform public.money_overview();
        log := log || extensions.fail('المشرف لا يرى الملخّص المالي');
      exception when others then log := log || extensions.pass('المشرف لا يرى الملخّص المالي'); end;
    end if;

    -- محاسب مؤقّت
    perform tests.act_as(null);
    update public.profiles set role = 'accountant' where id = plain_u;
    perform tests.act_as(plain_u);
    begin
      perform public.money_overview();
      log := log || extensions.pass('المحاسب يرى الملخّص المالي');
    exception when others then log := log || extensions.fail('المحاسب يرى الملخّص المالي: ' || sqlerrm); end;
    begin
      perform public.build_payroll(emp, '2020-03');
      log := log || extensions.fail('المحاسب لا يُحضّر الكشف');
    exception when others then log := log || extensions.pass('المحاسب لا يُحضّر الكشف'); end;

    -- موارد بشرية مؤقّتة
    perform tests.act_as(null);
    update public.profiles set role = 'hr' where id = plain_u;
    perform tests.act_as(plain_u);
    pr2 := public.build_payroll(emp, '2020-03');
    log := log || extensions.pass('الموارد البشرية تُحضّر الكشف');
    begin
      perform public.approve_payroll(pr2);
      log := log || extensions.fail('الموارد البشرية لا تعتمد الكشف');
    exception when others then log := log || extensions.pass('الموارد البشرية لا تعتمد الكشف'); end;
    begin
      perform public.post_manual_entry('2020-01-22', 'x', null,
        '[{"account_code":"5800","debit":1},{"account_code":"1100","credit":1}]'::jsonb);
      log := log || extensions.fail('الموارد البشرية لا تكتب قيداً');
    exception when others then log := log || extensions.pass('الموارد البشرية لا تكتب قيداً'); end;

    -- ================= الـ commit =================
    perform tests.act_as(admin_u);
    begin
      set constraints all immediate;
      log := log || extensions.pass('كل قيود الاختبار متوازنة عند الـ commit');
    exception when others then
      log := log || extensions.fail('قيود الاختبار عند الـ commit: ' || sqlerrm);
    end;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المحاسبة: ' || sqlerrm || ' @ ' || left(txt, 300));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_accounting() is
  'اختبارات المحاسبة: الحركات، القيد اليدوي، الحماية، الرواتب، الديون، الفترات، الصفقات، التقارير، الأدوار. يُلغي أثره (sql/115).';

revoke all on function tests.run_accounting() from public;
revoke all on function tests.jl(uuid, text) from public;
grant execute on function tests.run_accounting() to service_role;
