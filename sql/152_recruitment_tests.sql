-- ============================================================
-- تلال ERP — 152: اختبارات التوظيف والتهيئة والتجربة (المرحلة 3)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_recruitment();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الطلب      مدير القسم يطلب لقسمه فقط، لا يوافق على طلبه، HR ثم الإدارة،
--              الحالة بالدوالّ لا بالتحديث، والمعتمد يفتح وظيفة
--   المرشح     لا تكرار، «عرض» بعد مقابلة تمّت، «مرفوض» بسبب، السجلّ يحفظ النقلات
--   المقابلة   المقيِّم يُنبَّه ويرى مقابلاته بلا رواتب، يقيّم مرةً، وغيره لا يقيّم
--   العرض      بالدوالّ، الإدارة تعتمد، لا تعيين بلا قبول، مدير القسم لا يرى الراتب
--   التعيين    موظف تحت التجربة براتب العرض، الوظيفة والطلب يُغلقان
--   التهيئة    قائمة تلقائية، إنجاز تلقائي بالتحقّق، المكلَّف وحده، «غير لازمة» بسبب
--   التجربة    المدير ثم HR ثم القرار، التثبيت يغيّر الحالة، التنبيه مرة
--
-- يتطلب: 082، 145، 146، 148، 150، 151.
-- ============================================================

create or replace function tests.run_recruitment()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; hr_u uuid; mgr_u uuid; mgr_emp uuid; int_u uuid; int_emp uuid; out_u uuid;
  d_rec uuid; req uuid; opening uuid; app uuid; app2 uuid; iv uuid; ofr uuid; emp uuid; e_soon uuid;
  v_today date := public.baghdad_today();
  n int; txt text; rec record; ok boolean;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  -- خمسة حسابات «موظف» بملفّات نشطة: HR، مدير قسم، مقيِّم، غريب
  select x.uid into hr_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 1;
  select x.uid, x.eid into mgr_u, mgr_emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 2;
  select x.uid, x.eid into int_u, int_emp from (select p.id uid, e.id eid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 3;
  select x.uid into out_u from (select p.id uid, row_number() over (order by p.created_at) rn
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active') x where x.rn = 4;

  if admin_u is null or hr_u is null or mgr_u is null or int_u is null or out_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وأربعة موظفين بحسابات'::text;
    return;
  end if;

  begin
    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');
    insert into public.departments (code, name_ar, manager_id) values ('T-REC', 'قسم اختبار التوظيف', mgr_emp)
    returning id into d_rec;

    -- ================= طلب التوظيف =================
    perform tests.act_as(mgr_u);
    set local role authenticated;
    insert into public.job_requisitions (department_id, title, headcount, reason, justification, salary_min, salary_max)
    values (d_rec, 'مصمّم جرافيك', 1, 'توسّع', 'ضغط حملات الربع القادم', 1000000, 1500000)
    returning id into req;
    reset role;
    select * into rec from public.job_requisitions where id = req;
    log := log || extensions.ok(rec.status = 'بانتظار HR' and rec.req_no like 'REQ-%' and rec.requested_by = mgr_u,
                                'مدير القسم يطلب لقسمه: بانتظار HR ورقم وطالب من القاعدة');

    set local role authenticated;
    begin
      insert into public.job_requisitions (department_id, title)
      values ((select id from public.departments where code = 'SALES'), 'تسلّل');
      reset role;
      log := log || extensions.fail('مدير القسم لا يطلب لقسمٍ لا يديره');
    exception when others then
      reset role;
      log := log || extensions.pass('مدير القسم لا يطلب لقسمٍ لا يديره');
    end;

    set local role authenticated;
    begin
      update public.job_requisitions set status = 'معتمد' where id = req;
      reset role;
      log := log || extensions.fail('لا اعتماد بتحديث مباشر');
    exception when others then
      reset role;
      log := log || extensions.ok(sqlerrm like '%decide_requisition%', 'لا اعتماد بتحديث مباشر');
    end;

    begin
      perform public.decide_requisition(req, true);
      log := log || extensions.fail('لا يوافق أحد على طلبه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%على طلبه%', 'لا يوافق أحد على طلبه');
    end;

    perform tests.act_as(hr_u);
    begin
      perform public.decide_requisition(req, false, '  ');
      log := log || extensions.fail('رفض الطلب بلا سبب مرفوض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سبب الرفض%', 'رفض الطلب بلا سبب مرفوض');
    end;
    log := log || extensions.is(public.decide_requisition(req, true, 'مبرَّر'), 'بانتظار الإدارة', 'HR توافق ← بانتظار الإدارة');
    begin
      perform public.decide_requisition(req, true);
      log := log || extensions.fail('HR لا تعتمد مرحلة الإدارة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمدير%', 'HR لا تعتمد مرحلة الإدارة');
    end;

    perform tests.act_as(admin_u);
    log := log || extensions.is(public.decide_requisition(req, true), 'معتمد', 'الإدارة تعتمد');
    select id into opening from public.job_openings where requisition_id = req;
    log := log || extensions.ok(
      opening is not null and (select status = 'مفتوحة' and department_id = d_rec and opening_no like 'JOB-%'
                                 from public.job_openings where id = opening),
      'الطلب المعتمد يفتح وظيفة لقسمه');
    update public.job_openings set hiring_manager_id = mgr_emp where id = opening;

    perform tests.act_as(out_u);
    set local role authenticated;
    select count(*) into n from public.job_requisitions where id = req;
    reset role;
    log := log || extensions.is(n, 0, 'الغريب لا يرى طلبات التوظيف');

    -- ================= المرشح =================
    perform tests.act_as(hr_u);
    app := public.add_candidate_to_opening(opening, jsonb_build_object(
      'full_name', 'مرشح اختبار', 'phone', '0770 999 1234', 'email', 'cand@test.iq',
      'source', 'لينكدإن', 'current_title', 'مصمّم', 'expected_salary', 1400000));
    log := log || extensions.ok(
      (select stage = 'جديد' from public.job_applications where id = app)
      and (select count(*) = 1 from public.job_application_events where application_id = app),
      'التقدّم يبدأ «جديد» ويُسجَّل');

    begin
      perform public.add_candidate_to_opening(opening, jsonb_build_object('full_name', 'نفسه', 'phone', '07709991234'));
      log := log || extensions.fail('لا يتقدّم المرشح مرتين للوظيفة نفسها (الرقم بأي صيغة)');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لهذه الوظيفة%', 'لا يتقدّم المرشح مرتين للوظيفة نفسها (الرقم بأي صيغة)');
    end;

    begin
      update public.job_applications set stage = 'عرض' where id = app;
      log := log || extensions.fail('لا عرض قبل مقابلة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مقابلة%', 'لا عرض قبل مقابلة');
    end;
    begin
      update public.job_applications set stage = 'مرفوض' where id = app;
      log := log || extensions.fail('الرفض بلا سبب مرفوض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سبب الرفض%', 'الرفض بلا سبب مرفوض');
    end;

    update public.job_applications set stage = 'مقابلة' where id = app;
    insert into public.job_interviews (application_id, scheduled_at, interviewer_id)
    values (app, now() + interval '1 day', int_emp) returning id into iv;
    log := log || extensions.ok(
      exists (select 1 from public.notifications where entity_id = iv and user_id = int_u),
      'المقيِّم يُنبَّه بالمقابلة');

    -- ================= المقابلة =================
    perform tests.act_as(int_u);
    select count(*) into n from public.my_interviews();
    log := log || extensions.is(n, 1, 'المقيِّم يرى مقابلته');

    set local role authenticated;
    select count(*) into n from public.candidates where full_name = 'مرشح اختبار';
    reset role;
    log := log || extensions.is(n, 1, 'المقيِّم يرى المرشح الذي يقابله');

    set local role authenticated;
    begin
      perform expected_salary from public.candidates where full_name = 'مرشح اختبار';
      reset role;
      log := log || extensions.fail('المقيِّم لا يرى الراتب المتوقّع');
    exception when others then
      reset role;
      log := log || extensions.pass('المقيِّم لا يرى الراتب المتوقّع');
    end;

    perform tests.act_as(out_u);
    begin
      perform public.submit_interview_feedback(iv, 5, 'قبول', 'ممتاز');
      log := log || extensions.fail('غير المقيِّم لا يقيّم');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%أو الموارد البشرية%', 'غير المقيِّم لا يقيّم');
    end;

    perform tests.act_as(int_u);
    perform public.submit_interview_feedback(iv, 4, 'قبول', 'ملفّ أعمال قوي');
    log := log || extensions.ok(
      (select status = 'تمت' and score = 4 from public.job_interviews where id = iv), 'المقيِّم يقيّم مقابلته');
    begin
      perform public.submit_interview_feedback(iv, 1, 'رفض', 'تعديل');
      log := log || extensions.fail('التقييم لا يُعاد كتابته');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%كتابته%', 'التقييم لا يُعاد كتابته');
    end;

    -- ================= العرض =================
    perform tests.act_as(hr_u);
    update public.job_applications set stage = 'عرض' where id = app;
    insert into public.job_offers (application_id, salary, start_date, probation_months)
    values (app, 1500000, v_today, 3) returning id into ofr;
    log := log || extensions.ok(
      (select status = 'بانتظار الاعتماد' and department_id = d_rec and offer_no like 'OFR-%'
         from public.job_offers where id = ofr),
      'العرض يُعدّ بانتظار الاعتماد وقسمه من الوظيفة');

    begin
      update public.job_offers set status = 'معتمد' where id = ofr;
      log := log || extensions.fail('لا اعتماد للعرض بتحديث مباشر');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%decide_offer%', 'لا اعتماد للعرض بتحديث مباشر');
    end;
    begin
      perform public.decide_offer(ofr, true);
      log := log || extensions.fail('HR لا تعتمد العرض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للمدير%', 'HR لا تعتمد العرض');
    end;
    begin
      perform public.hire_candidate(app);
      log := log || extensions.fail('لا تعيين قبل قبول العرض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%قبله المرشح%', 'لا تعيين قبل قبول العرض');
    end;

    perform tests.act_as(admin_u);
    perform public.decide_offer(ofr, true);
    perform tests.act_as(hr_u);
    perform public.record_offer_response(ofr, true);
    log := log || extensions.is((select status from public.job_offers where id = ofr), 'مقبول', 'الإدارة تعتمد والمرشح يقبل');

    perform tests.act_as(mgr_u);
    set local role authenticated;
    select count(*) into n from public.job_offers where id = ofr;
    select count(*) into i from public.job_applications where id = app;
    reset role;
    log := log || extensions.ok(n = 0 and i = 1, 'مدير القسم يرى مرشّحه ولا يرى راتب العرض');
    i := 0;

    -- ================= التعيين =================
    perform tests.act_as(hr_u);
    emp := public.hire_candidate(app);
    select * into rec from public.employees where id = emp;
    log := log || extensions.ok(
      rec.status = 'active' and rec.employment_status = 'تحت التجربة' and rec.base_salary = 1500000
      and rec.department_id = d_rec and rec.manager_id = mgr_emp
      and rec.probation_end = (v_today + interval '3 months')::date - 1,
      'التعيين: موظف تحت التجربة براتب العرض ومديره وفترة تجربته');
    log := log || extensions.ok(
      (select stage = 'تم التعيين' and employee_id = emp from public.job_applications where id = app)
      and (select status = 'مغلقة' from public.job_openings where id = opening)
      and (select status = 'مغلق' from public.job_requisitions where id = req),
      'الطلب «تم التعيين»، والوظيفة والطلب يُغلقان باكتمال العدد');
    begin
      perform public.hire_candidate(app);
      log := log || extensions.fail('لا يُعيَّن المرشح مرتين');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%من قبل%', 'لا يُعيَّن المرشح مرتين');
    end;

    -- ================= التهيئة =================
    select count(*), count(*) filter (where status = 'منجزة') into n, i
      from public.onboarding_tasks where employee_id = emp;
    log := log || extensions.ok(
      n = (select count(*) from public.onboarding_templates where active) and i >= 4,
      'قائمة التهيئة تُولَّد، والرمز والقسم والمدير والبريد تُنجز تلقائياً');
    i := 0;

    insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
    values (emp, 'contract', 'employees/' || emp || '/c.pdf', 'c.pdf');
    log := log || extensions.is(
      (select status from public.onboarding_tasks where employee_id = emp and template_code = 'upload_contract'), 'منجزة',
      'رفع العقد يُنجز مهمته');

    perform tests.act_as(int_u);
    begin
      perform public.complete_onboarding_task(
        (select id from public.onboarding_tasks where employee_id = emp and template_code = 'team_intro'), 'منجزة');
      log := log || extensions.fail('غير المكلَّف لا يُنجز');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%أو الموارد البشرية%', 'غير المكلَّف لا يُنجز');
    end;

    perform tests.act_as(mgr_u);
    perform public.complete_onboarding_task(
      (select id from public.onboarding_tasks where employee_id = emp and template_code = 'team_intro'), 'منجزة');
    log := log || extensions.ok(
      (select status = 'منجزة' and completed_by = mgr_u from public.onboarding_tasks
        where employee_id = emp and template_code = 'team_intro'),
      'المدير يُنجز مهمته');

    perform tests.act_as(hr_u);
    begin
      perform public.complete_onboarding_task(
        (select id from public.onboarding_tasks where employee_id = emp and template_code = 'assign_workspace'), 'غير لازمة');
      log := log || extensions.fail('«غير لازمة» بسبب');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%إلزامي%', '«غير لازمة» بسبب');
    end;

    -- ================= التجربة =================
    perform tests.act_as(int_u);
    begin
      perform public.submit_probation_review(emp, 'المدير', 4, 'تثبيت');
      log := log || extensions.fail('غير المدير لا يقيّم كمدير');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لمديره%', 'غير المدير لا يقيّم كمدير');
    end;

    perform tests.act_as(mgr_u);
    select count(*) into n from public.probation_overview() where employee_id = emp;
    log := log || extensions.is(n, 1, 'المدير يرى تجربة فريقه');
    perform public.submit_probation_review(emp, 'المدير', 4, 'تثبيت', 'سريع التعلّم');

    perform tests.act_as(hr_u);
    begin
      perform public.decide_probation(emp, 'تثبيت');
      log := log || extensions.fail('لا قرار قبل تقييم HR');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%تقييم HR%', 'لا قرار قبل تقييم HR');
    end;
    perform public.submit_probation_review(emp, 'HR', 4, 'تثبيت');
    begin
      perform public.decide_probation(emp, 'تمديد', v_today);
      log := log || extensions.fail('التمديد بتاريخ بعد النهاية الحالية');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%التمديد%', 'التمديد بتاريخ بعد النهاية الحالية');
    end;
    perform public.decide_probation(emp, 'تثبيت', null, 'أداء جيد');
    log := log || extensions.ok(
      (select employment_status = 'نشط' from public.employees where id = emp)
      and exists (select 1 from public.probation_decisions where employee_id = emp and decision = 'تثبيت'),
      'التثبيت يجعله «نشط» ويُسجَّل القرار');
    begin
      perform public.submit_probation_review(emp, 'HR', 5, 'تثبيت');
      log := log || extensions.fail('لا تقييم بعد الخروج من التجربة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%ليس تحت التجربة%', 'لا تقييم بعد الخروج من التجربة');
    end;

    perform tests.act_as(admin_u);
    insert into public.employees (full_name, base_salary, hire_date, probation_start, probation_end, manager_id)
    values ('تجربة تنتهي قريباً', 0, v_today - 80, v_today - 80, v_today + 5, mgr_emp) returning id into e_soon;
    perform tests.act_as(null);
    perform public.scan_probation_endings();
    log := log || extensions.ok(
      exists (select 1 from public.notifications where entity_id = e_soon and user_id = mgr_u)
      and (select probation_notified_end = v_today + 5 from public.employees where id = e_soon),
      'تنبيه نهاية التجربة يصل المدير');
    select count(*) into n from public.notifications where entity_id = e_soon;
    perform public.scan_probation_endings();
    log := log || extensions.is((select count(*)::int from public.notifications where entity_id = e_soon), n,
                                'لا تنبيه مكرّر لنهاية التجربة نفسها');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات التوظيف: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_recruitment() is
  'اختبارات التوظيف والتهيئة والتجربة (sql/152). يُلغي أثره.';

revoke all on function tests.run_recruitment() from public;
grant execute on function tests.run_recruitment() to service_role;
