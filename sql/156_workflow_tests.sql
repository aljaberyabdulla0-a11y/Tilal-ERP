-- ============================================================
-- تلال ERP — 156: اختبارات الموافقات والدوام والعمل الإضافي والإجازات (المرحلة 4)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_workflow();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   المحرّك    التصعيد حين لا مُوافِق، المدير في نهاية السلسلة، لا موافقة على
--              الطلب الذاتي، غير المُوافِق لا يقرّر، الرفض بسبب، السجلّ
--   الإجازة    المدير ثم HR، بدون راتب ثلاث خطوات، التحديث المباشر مرفوض،
--              تجاوز HR يغلق السلسلة، السحب، السياسة (أقصى أيام)
--   الدوام     تعديل بصمة يكتب السجلّ، المهمة تكتب استثناءات، لا تعديل لمستقبل
--   الإضافي    المبلغ بالمعامل والأجر المجمَّد، لا تداخل، الإجازة التعويضية رصيد
--   الورديات   دوام اليوم من الوردية، لا تداخل إسنادين
--   الترحيل    بحدّه ومرةً واحدة
--   الرؤية     مُوافقاتي للمُوافِق وحده، والغريب لا يرى طلبات غيره
--
-- يتطلب: 082، 145، 146، 153، 154، 155.
-- ============================================================

create or replace function tests.run_workflow()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; a_u uuid; a_emp uuid; mgr_u uuid; mgr_emp uuid; hr_u uuid; out_u uuid; b_emp uuid;
  lv uuid; lv2 uuid; req uuid; ar uuid; ot uuid; sh uuid; v_type uuid;
  v_today date := public.baghdad_today();
  n int; txt text; rec record; v numeric;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select x.uid, x.eid into a_u, a_emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
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
  select x.eid into b_emp from (select e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 5;

  if admin_u is null or a_u is null or mgr_u is null or hr_u is null or out_u is null or b_emp is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وخمسة موظفين بحسابات'::text;
    return;
  end if;

  begin
    -- لا أحد بمستوى hr في البيئة الحيّة؛ نضمن ذلك قبل اختبار التصعيد
    update public.profiles set role_code = 'employee' where role = 'hr' and role_code <> 'employee';
    update public.employees set manager_id = mgr_emp where id = a_emp;
    update public.employees set manager_id = null where id = b_emp;
    update public.employees set manager_id = null where id = mgr_emp;

    -- ================= التصعيد =================
    perform tests.act_as(null);
    insert into public.leaves (employee_id, leave_type, start_date, end_date)
    values (b_emp, 'طارئة', v_today + 3, v_today + 3) returning id into lv;
    select * into rec from public.approval_requests where entity_type = 'leave' and entity_id = lv;
    log := log || extensions.ok(
      rec.status = 'قيد الموافقة' and rec.current_step is null
      and (select count(*) from public.approval_actions where request_id = rec.id and decision = 'تصعيد') = 2
      and exists (select 1 from public.approval_current_approvers(rec.id) x where x.user_id = admin_u),
      'لا مدير مباشر ولا HR ⇒ تصعيد خطوتين، والقرار للمدير');

    perform tests.act_as(admin_u);
    log := log || extensions.is(public.decide_leave(lv, true), 'معتمد', 'المدير يعتمد في نهاية السلسلة');
    log := log || extensions.is((select status from public.leaves where id = lv), 'موافق عليها', 'الاعتماد يُطبَّق على الإجازة');

    perform public.assign_user_role(hr_u, 'hr_officer');

    -- ================= الإجازة: المدير ثم HR =================
    perform tests.act_as(a_u);
    set local role authenticated;
    insert into public.leaves (employee_id, leave_type, start_date, end_date, reason)
    values (a_emp, 'طارئة', v_today + 5, v_today + 5, 'ظرف عائلي') returning id into lv;
    reset role;
    select * into rec from public.approval_requests where entity_type = 'leave' and entity_id = lv;
    req := rec.id;
    log := log || extensions.ok(rec.workflow_code = 'leave' and rec.current_step = 1
      and exists (select 1 from public.approval_current_approvers(req) x where x.user_id = mgr_u),
      'طلب الإجازة يدخل السلسلة عند المدير المباشر');

    begin
      perform public.decide_leave(lv, true);
      log := log || extensions.fail('لا يوافق أحد على طلبه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%على طلبه%', 'لا يوافق أحد على طلبه');
    end;

    perform tests.act_as(out_u);
    begin
      perform public.decide_leave(lv, true);
      log := log || extensions.fail('غير المُوافِق لا يقرّر');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ليس لك القرار%', 'غير المُوافِق لا يقرّر');
    end;
    select count(*) into n from public.my_pending_approvals();
    log := log || extensions.is(n, 0, 'الغريب لا يرى في موافقاته شيئاً');

    perform tests.act_as(mgr_u);
    select count(*) into n from public.my_pending_approvals() where entity_id = lv;
    log := log || extensions.is(n, 1, 'المدير يرى الطلب في موافقاته');
    begin
      perform public.decide_leave(lv, false, ' ');
      log := log || extensions.fail('الرفض بلا سبب مرفوض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سبب الرفض%', 'الرفض بلا سبب مرفوض');
    end;
    log := log || extensions.is(public.decide_leave(lv, true, 'لا مانع'), 'قيد الموافقة', 'موافقة المدير تنقله إلى HR');
    log := log || extensions.is((select current_step from public.approval_requests where id = req), 2, 'الخطوة الثانية: HR');
    begin
      perform public.decide_leave(lv, true);
      log := log || extensions.fail('المدير لا يقرّر خطوة HR');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ليس لك القرار%', 'المدير لا يقرّر خطوة HR');
    end;

    perform tests.act_as(a_u);
    set local role authenticated;
    begin
      update public.leaves set status = 'موافق عليها' where id = lv;
      get diagnostics n = row_count;
      reset role;
      log := log || extensions.ok(n = 0, 'الموظف لا يعتمد إجازته بتحديث مباشر');
    exception when others then
      reset role;
      log := log || extensions.pass('الموظف لا يعتمد إجازته بتحديث مباشر');
    end;

    perform tests.act_as(hr_u);
    log := log || extensions.is(public.decide_leave(lv, true), 'معتمد', 'HR تعتمد ← معتمد');
    log := log || extensions.ok(
      (select status = 'موافق عليها' from public.leaves where id = lv)
      and (select count(*) = 2 from public.approval_actions where request_id = req and decision = 'موافقة')
      and exists (select 1 from public.leave_ledger where leave_id = lv and kind = 'استهلاك'),
      'الإجازة معتمدة، والسجلّ بموافقتين، والاستهلاك في الرصيد');

    -- ================= بدون راتب: ثلاث خطوات =================
    perform tests.act_as(a_u);
    insert into public.leaves (employee_id, leave_type, start_date, end_date)
    values (a_emp, 'بدون راتب', v_today + 10, v_today + 11) returning id into lv2;
    select * into rec from public.approval_requests where entity_type = 'leave' and entity_id = lv2;
    log := log || extensions.ok(rec.workflow_code = 'leave_unpaid'
      and (select count(*) from public.approval_steps where workflow_code = 'leave_unpaid') = 3,
      'بدون راتب ⇒ سلسلة المدير ← HR ← المدير العام');

    perform tests.act_as(a_u);
    perform public.cancel_my_leave(lv2);
    log := log || extensions.ok(
      (select status = 'ملغاة' from public.leaves where id = lv2)
      and (select status = 'ملغى' from public.approval_requests where id = rec.id),
      'الموظف يسحب طلبه المعلّق');

    -- تجاوز HR بالتحديث المباشر
    insert into public.leaves (employee_id, leave_type, start_date, end_date)
    values (a_emp, 'طارئة', v_today + 20, v_today + 20) returning id into lv2;
    perform tests.act_as(hr_u);
    update public.leaves set status = 'مرفوضة' where id = lv2;
    select * into rec from public.approval_requests where entity_type = 'leave' and entity_id = lv2;
    log := log || extensions.ok(rec.status = 'مرفوض'
      and exists (select 1 from public.approval_actions where request_id = rec.id and decision = 'تجاوز' and actor = hr_u),
      'تجاوز HR بالتحديث المباشر يغلق السلسلة ويُسجَّل');

    -- السياسة
    update public.leave_types set max_days_per_request = 2 where name = 'طارئة';
    perform tests.act_as(a_u);
    begin
      insert into public.leaves (employee_id, leave_type, start_date, end_date)
      values (a_emp, 'طارئة', v_today + 30, v_today + 33);
      log := log || extensions.fail('أقصى أيام الطلب تُفرض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%أقصى%', 'أقصى أيام الطلب تُفرض');
    end;

    -- ================= طلبات الدوام =================
    perform tests.act_as(a_u);
    begin
      perform public.submit_attendance_request('تعديل بصمة', v_today + 1, v_today + 1, 'نسيت', '09:00', null);
      log := log || extensions.fail('لا تعديل بصمة لليوم القادم');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%31 يوماً%', 'لا تعديل بصمة لليوم القادم');
    end;

    ar := public.submit_attendance_request('تعديل بصمة', v_today - 1, v_today - 1, 'تعطّل الهاتف', '09:05', '17:10');
    perform tests.act_as(mgr_u);
    perform public.approval_decide((select approval_id from public.attendance_requests where id = ar), true);
    perform tests.act_as(hr_u);
    perform public.approval_decide((select approval_id from public.attendance_requests where id = ar), true);
    select * into rec from public.attendance where employee_id = a_emp and work_date = v_today - 1;
    log := log || extensions.ok(
      rec.source = 'تعديل معتمد'
      and to_char(rec.check_in at time zone 'Asia/Baghdad', 'HH24:MI') = '09:05'
      and to_char(rec.check_out at time zone 'Asia/Baghdad', 'HH24:MI') = '17:10'
      and (select status = 'معتمد' and applied_at is not null from public.attendance_requests where id = ar),
      'تعديل البصمة المعتمد يكتب السجلّ خارج قيد الموقع');

    perform tests.act_as(a_u);
    ar := public.submit_attendance_request('مهمة رسمية', v_today + 40, v_today + 41, 'معرض عقاري');
    perform tests.act_as(admin_u);
    perform public.approval_decide((select approval_id from public.attendance_requests where id = ar), true, null);
    select count(*) into n from public.attendance_exemptions
     where employee_id = a_emp and exempt_date between v_today + 40 and v_today + 41 and exempt_type = 'يوم كامل';
    log := log || extensions.is(n, 2, 'المهمة الرسمية المعتمدة ⇒ استثناء يوم كامل لكل يوم');
    log := log || extensions.ok(
      exists (select 1 from public.approval_actions a join public.attendance_requests r on r.approval_id = a.request_id
               where r.id = ar and a.decision = 'تجاوز'),
      'قرار المدير خارج دوره يُسجَّل «تجاوز»');

    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.attendance_requests where employee_id = a_emp;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى طلبات دوام غيره');
    perform tests.act_as(mgr_u);
    set local role authenticated;
    select count(*) into n from public.attendance_requests where employee_id = a_emp;
    reset role;
    log := log || extensions.ok(n >= 2, 'المدير المباشر يرى طلبات فريقه');

    -- ================= العمل الإضافي =================
    update public.company_settings set overtime_factor_workday = 1.5, overtime_factor_offday = 2 where id = 1;
    perform tests.act_as(a_u);
    ot := public.submit_overtime_request(v_today - 2, '18:00', '20:00', 'إغلاق حملة', 'أجر');
    begin
      perform public.submit_overtime_request(v_today - 2, '19:00', '21:00', 'تداخل', 'أجر');
      log := log || extensions.fail('لا تداخل في العمل الإضافي');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%يتداخل%', 'لا تداخل في العمل الإضافي');
    end;
    perform tests.act_as(admin_u);
    perform public.approval_decide((select approval_id from public.overtime_requests where id = ot), true);
    select * into rec from public.overtime_requests where id = ot;
    select round(public.salary_at(a_emp, v_today - 2) / 30.0 /
                 greatest(extract(epoch from (w.end_time - w.start_time)) / 3600.0, 1))
      into v from public.work_schedule_on(a_emp, v_today - 2) w;
    log := log || extensions.ok(
      rec.status = 'معتمد' and rec.hours = 2 and rec.hourly_rate = v
      and rec.rate_factor = case when rec.is_offday then 2 else 1.5 end
      and rec.amount = round(2 * v * rec.rate_factor),
      'المبلغ = الساعات × الأجر بالساعة × المعامل، مجمّداً لحظة الاعتماد');

    perform tests.act_as(a_u);
    ot := public.submit_overtime_request(v_today - 3, '18:00', '22:00', 'جرد', 'إجازة تعويضية');
    perform tests.act_as(admin_u);
    perform public.approval_decide((select approval_id from public.overtime_requests where id = ot), true);
    select id into v_type from public.leave_types where name = 'تعويضية';
    log := log || extensions.ok(
      exists (select 1 from public.leave_ledger where employee_id = a_emp and leave_type_id = v_type
               and kind = 'تعويض عمل إضافي' and days > 0)
      and (select amount is null and leave_days > 0 from public.overtime_requests where id = ot),
      'العمل الإضافي المعوَّض بإجازة يصير رصيداً تعويضياً');

    -- ================= الورديات =================
    insert into public.work_shifts (name_ar, start_time, end_time, work_days)
    values ('وردية اختبار', '10:00', '18:00', '{0,1,2,3,4,5,6}') returning id into sh;
    insert into public.employee_shifts (employee_id, shift_id, start_date) values (a_emp, sh, v_today - 10);
    select * into rec from public.work_schedule_on(a_emp, v_today);
    log := log || extensions.ok(rec.start_time = '10:00' and rec.source like 'وردية%', 'دوام اليوم من الوردية المسندة');
    begin
      insert into public.employee_shifts (employee_id, shift_id, start_date) values (a_emp, sh, v_today);
      log := log || extensions.fail('لا تتداخل ورديتان');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%وردية أخرى%', 'لا تتداخل ورديتان');
    end;

    -- ================= الترحيل =================
    select id into v_type from public.leave_types where name = 'سنوية';
    update public.leave_types set carries_over = true, carry_over_max_days = 5 where id = v_type;
    insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note)
    values (a_emp, v_type, make_date(extract(year from v_today)::int - 1, 6, 1), 10, 'تسوية يدوية', 'اختبار');
    perform public.carry_forward_leave(extract(year from v_today)::int);
    perform public.carry_forward_leave(extract(year from v_today)::int);
    select count(*), max(days) into n, v from public.leave_ledger
     where employee_id = a_emp and leave_type_id = v_type and kind = 'ترحيل'
       and entry_date = make_date(extract(year from v_today)::int, 1, 1);
    log := log || extensions.ok(n = 1 and v <= 5, 'الترحيل بحدّه ومرةً واحدة');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المرحلة 4: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_workflow() is
  'اختبارات المرحلة 4: محرّك الموافقات، الإجازات، طلبات الدوام، العمل الإضافي، الورديات، الترحيل (sql/156). يُلغي أثره.';

revoke all on function tests.run_workflow() from public;
grant execute on function tests.run_workflow() to service_role;
