-- ============================================================
-- تلال ERP — 149: اختبارات ملف الموظف (المرحلة 2)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_profile();
--
-- نمط 082/147: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الحالة     الترحيل متّسق، الانتقالات المسموحة وحدها، الخروج عبر الإنهاء،
--              الإنهاء وإعادة التفعيل يحرّكان الوصف، التجربة تلقائية
--   الراتب     السبب إلزامي، لا مستقبل، الرجعيّ لا يغيّر الحالي، السابق والنسبة،
--              لا سطر مكرّر من المحفّز، HR وحدها
--   المستندات  تاريخ الانتهاء للأنواع التي تتطلبه، المسار يتبع الموظف، لا استبدال،
--              التنبيه مرة لكل مرحلة، RLS: صاحبه/HR/المالية للبنكي فقط
--   الخط الزمني HR وصاحبه، ويجمع الراتب والمستند والحالة
--   بوابتي     الموظف يحدّث تواصله لا راتبه
--
-- يتطلب: 082، 145، 146، 148.
-- ============================================================

create or replace function tests.run_profile()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; hr_u uuid; acc_u uuid;
  p_agent uuid; e_new uuid; e_prob uuid; doc_a uuid; doc_b uuid; doc_c uuid;
  v_today date := public.baghdad_today();
  n int; txt text; j jsonb; rec record;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
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
  select id into p_agent from public.positions where code = 'SALES-AGENT';

  if admin_u is null or plain_u is null or hr_u is null or acc_u is null or p_agent is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وثلاثة موظفين بحسابات وبذرة 145'::text;
    return;
  end if;

  begin
    -- ================= الحالة الوظيفية =================
    select count(*) into n from public.employees
     where (status = 'active' and employment_status in ('غير نشط', 'مستقيل', 'منتهية خدمته'))
        or (status = 'inactive' and employment_status not in ('غير نشط', 'مستقيل', 'منتهية خدمته'));
    log := log || extensions.is(n, 0, 'الحالة الوظيفية متّسقة مع مفتاح الوصول لكل موظف');

    perform tests.act_as(admin_u);
    perform public.assign_user_role(hr_u, 'hr_officer');
    perform public.assign_user_role(acc_u, 'accountant');

    insert into public.employees (full_name, base_salary, position_id, hire_date)
    values ('موظف اختبار الملف', 1000000, p_agent, v_today - 60) returning id into e_new;
    log := log || extensions.is((select employment_status from public.employees where id = e_new), 'نشط',
                                'الموظف الجديد بلا تجربة: نشط');

    insert into public.employees (full_name, base_salary, position_id, hire_date, probation_start, probation_end)
    values ('موظف تحت التجربة', 0, p_agent, v_today, v_today, v_today + 90) returning id into e_prob;
    log := log || extensions.is((select employment_status from public.employees where id = e_prob), 'تحت التجربة',
                                'فترة تجربة لم تنتهِ ⇒ تحت التجربة تلقائياً');

    update public.employees set employment_status = 'موقوف' where id = e_new;
    log := log || extensions.is((select employment_status from public.employees where id = e_new), 'موقوف',
                                'نشط ← موقوف مسموح');

    begin
      update public.employees set employment_status = 'في إجازة' where id = e_new;
      log := log || extensions.fail('موقوف ← في إجازة مرفوض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا انتقال%', 'موقوف ← في إجازة مرفوض');
    end;

    update public.employees set employment_status = 'نشط' where id = e_new;
    begin
      update public.employees set employment_status = 'مستقيل' where id = e_new;
      log := log || extensions.fail('الاستقالة لا تُكتب على موظف نشط');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا انتقال%' or sqlerrm like '%إنهاء الخدمة%',
                                  'الاستقالة لا تُكتب على موظف نشط');
    end;

    update public.employees set status = 'inactive' where id = e_new;
    log := log || extensions.is((select employment_status from public.employees where id = e_new), 'غير نشط',
                                'إنهاء الخدمة يجعل الوصف «غير نشط»');
    update public.employees set employment_status = 'مستقيل' where id = e_new;
    log := log || extensions.is((select employment_status from public.employees where id = e_new), 'مستقيل',
                                'بعد الإنهاء يُصنَّف: مستقيل');
    update public.employees set status = 'active' where id = e_new;
    log := log || extensions.is((select employment_status from public.employees where id = e_new), 'نشط',
                                'إعادة التفعيل تعيد «نشط»');

    -- ================= الراتب =================
    perform tests.act_as(hr_u);
    begin
      perform public.adjust_salary(e_new, 1200000, v_today, '  ');
      log := log || extensions.fail('السبب إلزامي');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%السبب%', 'السبب إلزامي');
    end;
    begin
      perform public.adjust_salary(e_new, 1200000, v_today + 1, 'زيادة');
      log := log || extensions.fail('لا تاريخ سريان في المستقبل');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%بعد اليوم%', 'لا تاريخ سريان في المستقبل');
    end;
    begin
      perform public.adjust_salary(e_new, 1200000, v_today - 90, 'قبل المباشرة');
      log := log || extensions.fail('لا سريان قبل المباشرة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%المباشرة%', 'لا سريان قبل المباشرة');
    end;

    j := public.adjust_salary(e_new, 1100000, v_today - 30, 'تصحيح رجعي');
    select * into rec from public.employee_salary_history where employee_id = e_new and effective_from = v_today - 30;
    log := log || extensions.ok(
      rec.previous_amount = 1000000 and rec.change_pct = 10 and rec.reason = 'تصحيح رجعي' and rec.approved_by = hr_u,
      'الرجعيّ يسجّل السابق والنسبة والسبب والمعتمِد');
    log := log || extensions.ok(
      (j->>'current_changed')::boolean = false
      and (select base_salary from public.employees where id = e_new) = 1000000,
      'الرجعيّ قبل سطرٍ أحدث لا يغيّر الراتب الحالي');
    log := log || extensions.is(public.salary_at(e_new, v_today - 10), 1100000::numeric,
                                'salary_at يقرأ الرجعيّ لأيامه');

    j := public.adjust_salary(e_new, 1300000, v_today, 'ترقية');
    select * into rec from public.employee_salary_history where employee_id = e_new and effective_from = v_today;
    log := log || extensions.ok(
      (select base_salary from public.employees where id = e_new) = 1300000
      and rec.amount = 1300000 and rec.previous_amount = 1100000 and rec.reason = 'ترقية',
      'تعديل اليوم يغيّر الحالي ويحفظ السابق');
    log := log || extensions.is(
      (select count(*)::int from public.employee_salary_history where employee_id = e_new), 2,
      'لا سطر مكرّر من المحفّز');

    perform tests.act_as(plain_u);
    begin
      perform public.adjust_salary(plain_emp, 9999999, v_today, 'تلاعب');
      log := log || extensions.fail('الموظف لا يعدّل راتبه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%للموارد البشرية%', 'الموظف لا يعدّل راتبه');
    end;

    -- ================= المستندات =================
    perform tests.act_as(hr_u);
    begin
      insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
      values (plain_emp, 'national_id', 'employees/' || plain_emp || '/t1.pdf', 't1.pdf');
      log := log || extensions.fail('الهوية بلا تاريخ انتهاء مرفوضة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%تاريخ انتهاء%', 'الهوية بلا تاريخ انتهاء مرفوضة');
    end;
    begin
      insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
      values (plain_emp, 'cv', 'employees/' || e_new || '/t2.pdf', 't2.pdf');
      log := log || extensions.fail('مسار الملف يتبع صاحبه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%employee_documents_path%', 'مسار الملف يتبع صاحبه');
    end;

    insert into public.employee_documents (employee_id, type_code, storage_path, file_name, expiry_date)
    values (plain_emp, 'national_id', 'employees/' || plain_emp || '/t3.pdf', 't3.pdf', v_today + 10)
    returning id into doc_a;
    insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
    values (plain_emp, 'bank', 'employees/' || plain_emp || '/t4.pdf', 't4.pdf') returning id into doc_b;
    update public.employee_document_types set employee_visible = false where code = 'performance';
    insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
    values (plain_emp, 'performance', 'employees/' || plain_emp || '/t5.pdf', 't5.pdf') returning id into doc_c;

    log := log || extensions.ok(
      (select uploaded_by = hr_u and uploaded_by_name is not null from public.employee_documents where id = doc_a),
      'الرافع ووقته من القاعدة');

    begin
      update public.employee_documents set storage_path = 'employees/' || plain_emp || '/other.pdf' where id = doc_a;
      log := log || extensions.fail('الملف لا يُستبدل في مكانه');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا يُستبدل%', 'الملف لا يُستبدل في مكانه');
    end;

    perform tests.act_as(null);
    n := public.scan_employee_document_expiry();
    log := log || extensions.ok(
      (select expiry_notice from public.employee_documents where id = doc_a) = 1
      and exists (select 1 from public.notifications where entity_id = doc_a and user_id = hr_u)
      and exists (select 1 from public.notifications where entity_id = doc_a and user_id = plain_u),
      'تنبيه الانتهاء يصل HR وصاحب المستند');
    select count(*) into n from public.notifications where entity_id = doc_a;
    perform public.scan_employee_document_expiry();
    log := log || extensions.is((select count(*)::int from public.notifications where entity_id = doc_a), n,
                                'لا تنبيه مكرّر للمرحلة نفسها');

    perform tests.act_as(plain_u);
    set local role authenticated;
    select count(*) into n from public.employee_documents where employee_id = plain_emp;
    reset role;
    log := log || extensions.is(n, 2, 'الموظف يرى مستنداته المعروضة له فقط (لا مستند الأداء المخفي)');

    perform tests.act_as(acc_u);
    set local role authenticated;
    select count(*) into n from public.employee_documents where employee_id = plain_emp;
    select count(*) into i from public.employee_documents where id = doc_b;
    reset role;
    log := log || extensions.ok(n = 1 and i = 1, 'المالية ترى المستند البنكي وحده');
    i := 0;

    perform tests.act_as(plain_u);
    set local role authenticated;
    begin
      insert into public.employee_documents (employee_id, type_code, storage_path, file_name)
      values (plain_emp, 'cv', 'employees/' || plain_emp || '/mine.pdf', 'mine.pdf');
      reset role;
      log := log || extensions.fail('الموظف لا يرفع مستنداً في ملفه');
    exception when others then
      reset role;
      log := log || extensions.pass('الموظف لا يرفع مستنداً في ملفه');
    end;

    perform tests.act_as(hr_u);
    update public.employee_documents set deleted_at = now() where id = doc_b;
    log := log || extensions.ok(
      (select deleted_by = hr_u from public.employee_documents where id = doc_b),
      'الإخفاء ناعم ويسجّل من أخفى');

    -- ================= الخط الزمني =================
    perform tests.act_as(admin_u);
    update public.employees set employment_status = 'في إجازة' where id = e_new;
    perform tests.act_as(hr_u);
    select count(*) filter (where kind = 'راتب'), count(*) filter (where kind = 'تنظيم')
      into n, i from public.employee_timeline(e_new);
    log := log || extensions.ok(n >= 2 and i >= 1, 'الخط الزمني يجمع الراتب وتغيّر الحالة');
    i := 0;

    perform tests.act_as(plain_u);
    begin
      perform * from public.employee_timeline(e_new);
      log := log || extensions.fail('الموظف لا يرى سجلّ غيره');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا صلاحية%', 'الموظف لا يرى سجلّ غيره');
    end;
    select count(*) filter (where kind = 'مستند') into n from public.employee_timeline(plain_emp);
    log := log || extensions.is(n, 1, 'الموظف يرى سجلّه بلا المستند المخفي عنه');

    -- ================= بوابتي =================
    perform public.update_my_profile('{"phone": "07700000000", "emergency_contact_name": "قريب"}'::jsonb);
    log := log || extensions.ok(
      (select phone = '07700000000' and emergency_contact_name = 'قريب' from public.employees where id = plain_emp),
      'الموظف يحدّث هاتفه وجهة طوارئه');
    begin
      perform public.update_my_profile('{"base_salary": 5000000}'::jsonb);
      log := log || extensions.fail('الموظف لا يحدّث راتبه من بوابته');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%فقط%', 'الموظف لا يحدّث راتبه من بوابته');
    end;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الملف: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_profile() is
  'اختبارات ملف الموظف: الحالة، الراتب، المستندات، الخط الزمني، البوابة (sql/149). يُلغي أثره.';

revoke all on function tests.run_profile() from public;
grant execute on function tests.run_profile() to service_role;
