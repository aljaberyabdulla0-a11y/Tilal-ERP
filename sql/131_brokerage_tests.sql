-- ============================================================
-- تلال ERP — 131: اختبارات الوساطة v2
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_brokerage();
--
-- ===== العزل =====
-- نمط 082/115/127: كل شيء داخل معاملة فرعية تُلغى في النهاية. مشروعٌ ووحدات
-- وشركتان للاختبار؛ موظفون حقيقيون يُمنحون أدواراً مؤقتة، وحسابا وسيط حقيقيان
-- يُنقلان مؤقتاً إلى شركتي الاختبار. لا يترك أثراً.
--
-- ===== ما يُختبر =====
--   المسار     الـRM والمشرف يُختمان في القاعدة · الإشعارات · طلبان على وحدة ·
--              حجز مباشر على وحدة عليها طلب · الـRM لا يوافق ولا يرفض ·
--              المراجعة والتوصية · السؤال والإجابة · الرفض بلا سبب ·
--              الموافقة الذرّية وما تُنشئه · الانتهاء · تغيّر الـRM
--   الصلاحيات  (تحت دور authenticated) الوسيط لا يرى الوحدات ولا الحجوزات ولا
--              الأحداث الداخلية · المشرف يرى كل طلبات مشروعه · RM شركةٍ لا يرى
--              طلبات غيرها · الـRM بدور employee يرى حجوزات ليدات شركته
--   العمولة    ٥ مبيعات = ١٪ · السادسة = ١.٥٪ للستّ وسطر تعديل لكلٍّ من الخمس ·
--              عدّاد كل شركة مستقل · المباشر لا يمسّ الوسيط · الـRM بلا خطة = صفر ·
--              شرائح الموظف الرجعية وفرقها بعد المقدمة · قابلية الدفع ·
--              حارس الصرف · الاسترداد · الفسخ ونزول الشريحة · الخطة الخاصة
--              الحدّية بأساس القيمة · لا تغيير صيغة لخطةٍ عليها عمولات ·
--              مفتاح الفترة الربعية · دفتر العمولات · التقارير
--
-- يتطلب: 082 (tests.act_as)، 128–130.
-- ============================================================

-- عدّ صفوف تحت RLS بهوية مستخدم
create or replace function tests.count_as(p_user uuid, p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform tests.act_as(p_user);
  execute 'set local role authenticated';
  execute p_sql into n;
  execute 'reset role';
  return n;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- صفقة وسيط كاملة: طلب ← موافقة المشرف ← بيع مكتمل
create or replace function tests.brk_sale(p_broker uuid, p_sup uuid, p_admin uuid, p_unit uuid, p_name text)
returns uuid language plpgsql as $$
declare v_req uuid; v_res uuid;
begin
  perform tests.act_as(p_broker);
  v_req := public.broker_request_reservation(p_unit, null, p_name,
             '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), null, null);
  perform tests.act_as(p_sup);
  v_res := public.approve_broker_reservation_request(v_req, null, null, null, null);
  perform tests.act_as(p_admin);
  update public.reservations set status = 'بيع مكتمل' where id = v_res;
  return v_res;
end $$;

-- صفقة مباشرة كاملة لموظف
create or replace function tests.direct_sale(p_seller uuid, p_admin uuid, p_project uuid, p_unit uuid, p_name text)
returns uuid language plpgsql as $$
declare v_client uuid; v_res uuid;
begin
  perform tests.act_as(p_seller);
  insert into public.clients (name, phone, project_id, created_by)
  values (p_name, '0772' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), p_project, p_seller)
  returning id into v_client;
  insert into public.reservations (client_id, unit_id, reservation_date, status, created_by)
  values (v_client, p_unit, current_date, 'حجز', p_seller)
  returning id into v_res;
  perform tests.act_as(p_admin);
  update public.reservations set status = 'بيع مكتمل' where id = v_res;
  return v_res;
end $$;


create or replace function tests.run_brokerage()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid;
  sup_u uuid;  sup_e uuid;
  rm_u uuid;   rm_e uuid;
  rm2_u uuid;  rm2_e uuid;
  sel_u uuid;  sel_e uuid;
  brk1 uuid;   brk2 uuid;
  proj uuid; coA uuid; coB uuid; bplan uuid; eplan uuid; ovr uuid;
  u uuid[] := '{}';
  req uuid; req2 uuid; req3 uuid; res uuid; res6 uuid; resB uuid; d1 uuid; d4 uuid;
  bk uuid; bk6 uuid; sc1 uuid;
  n bigint; v numeric; txt text; st text; j jsonb;
  i int := 0;
  k int;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;

  -- أربعة موظفين بحسابات: مشرف، RM، RM ثانٍ، بائع
  with e as (
    select p.id as uid, em.id as eid, row_number() over (order by p.created_at) as rn
      from public.profiles p join public.employees em on em.user_id = p.id
     where p.role = 'employee' and em.status = 'active'
  )
  -- ⚠️ لا max(uuid) في Postgres — نجمع نصّاً ثم نعيده uuid
  select max(uid::text) filter (where rn = 1)::uuid, max(eid::text) filter (where rn = 1)::uuid,
         max(uid::text) filter (where rn = 2)::uuid, max(eid::text) filter (where rn = 2)::uuid,
         max(uid::text) filter (where rn = 3)::uuid, max(eid::text) filter (where rn = 3)::uuid,
         max(uid::text) filter (where rn = 4)::uuid, max(eid::text) filter (where rn = 4)::uuid
    into sup_u, sup_e, rm_u, rm_e, rm2_u, rm2_e, sel_u, sel_e
    from e;

  select max(user_id::text) filter (where rn = 1)::uuid, max(user_id::text) filter (where rn = 2)::uuid
    into brk1, brk2
    from (select bu.user_id, row_number() over (order by bu.created_at) as rn from public.broker_users bu) x;

  if admin_u is null or sel_u is null or brk2 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وأربعة موظفين بحسابات وحسابا وسيط'::text;
    return;
  end if;

  begin
    -- ================= البيئة =================
    perform tests.act_as(null);
    update public.profiles set role = 'supervisor' where id = sup_u;

    insert into public.projects (name, supervisor_id) values ('مشروع اختبار الوساطة ١٣١', sup_e)
    returning id into proj;
    insert into public.project_commissions (project_id, base_rate) values (proj, 2);

    for k in 1..16 loop
      insert into public.units (project, project_id, unit_code, unit_type, price, status)
      values ('مشروع اختبار الوساطة ١٣١', proj, 'T-' || k, 'شقة', 100000000, 'متاحة')
      returning id into res;
      u := u || res;
    end loop;

    insert into public.broker_companies (name) values ('شركة أ — اختبار ١٣١') returning id into coA;
    insert into public.broker_companies (name) values ('شركة ب — اختبار ١٣١') returning id into coB;
    insert into public.broker_company_projects (company_id, project_id, rm_id) values (coA, proj, rm_e), (coB, proj, rm2_e);
    update public.broker_users set company_id = coA, is_active = true where user_id = brk1;
    update public.broker_users set company_id = coB, is_active = true where user_id = brk2;

    perform tests.act_as(admin_u);
    bplan := public.save_commission_plan(
      jsonb_build_object('project_id', proj, 'recipient_type', 'وسيط', 'formula', 'شرائح رجعية',
                         'basis', 'عدد الوحدات', 'period', 'شهري', 'payable_rule', 'بعد تحصيل عمولة تلال'),
      '[{"min_units":1,"rate":1},{"min_units":6,"rate":1.5}]'::jsonb);
    eplan := public.save_commission_plan(
      jsonb_build_object('project_id', proj, 'recipient_type', 'موظف مباشر', 'formula', 'شرائح رجعية',
                         'basis', 'عدد الوحدات', 'period', 'شهري'),
      '[{"min_units":1,"rate":0.05},{"min_units":4,"rate":0.075}]'::jsonb);
    log := log || extensions.ok(bplan is not null and eplan is not null, 'الخطتان تُحفظان بدالّة واحدة');

    log := log || extensions.throws_ok(
      format($q$select public.save_commission_plan(jsonb_build_object('project_id', %L::uuid, 'recipient_type', 'وسيط'),
                                                   '[{"min_units":3,"rate":1}]'::jsonb)$q$, proj),
      'P0001', null, 'الخطة بلا شريحة من الوحدة ١ مرفوضة');

    -- ================= المسار =================
    perform tests.act_as(brk1);
    req := public.broker_request_reservation(u[1], null, 'عميل وسيط ١',
             '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), 'أريدها', 95000000);

    select q.status into st from public.broker_reservation_requests q where q.id = req;
    log := log || extensions.is(st, 'معلّق', 'الطلب يبدأ «معلّق»');
    log := log || extensions.ok(
      (select rm_id = rm_e and supervisor_id = sup_e and expires_at is not null
         from public.broker_reservation_requests where id = req),
      'الـRM والمشرف والمهلة تُختم في القاعدة لا من الواجهة');

    log := log || extensions.ok(
      exists (select 1 from public.notifications where entity_id = req and user_id = rm_u)
      and exists (select 1 from public.notifications where entity_id = req and user_id = sup_u),
      'إشعار للـRM وللمشرف عند الرفع');
    log := log || extensions.ok(
      exists (select 1 from public.broker_request_events where request_id = req and action = 'رفع الطلب'),
      'الخطّ الزمني يسجّل الرفع');

    perform tests.act_as(brk2);
    log := log || extensions.throws_ok(
      format($q$select public.broker_request_reservation(%L::uuid, null, 'منافس', null, null, null)$q$, u[1]),
      'P0001', null, 'وسيطٌ ثانٍ لا يطلب وحدةً عليها طلب مفتوح');

    perform tests.act_as(sel_u);
    insert into public.clients (name, phone, project_id, created_by)
    values ('عميل مباشر للقفل', '0773' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), proj, sel_u)
    returning id into d1;
    log := log || extensions.throws_ok(
      format($q$insert into public.reservations (client_id, unit_id, status, created_by) values (%L, %L, 'حجز', %L)$q$,
             d1, u[1], sel_u),
      'P0001', null, 'الحجز المباشر ممنوع على وحدةٍ عليها طلب وسيط');

    perform tests.act_as(rm_u);
    perform public.broker_request_take(req);
    select status into st from public.broker_reservation_requests where id = req;
    log := log || extensions.is(st, 'قيد المتابعة', 'الـRM يستلم الطلب');

    log := log || extensions.throws_ok(
      format('select public.approve_broker_reservation_request(%L::uuid)', req),
      'P0001', null, 'الـRM لا يوافق على الحجز');
    log := log || extensions.throws_ok(
      format($q$select public.broker_request_reject(%L::uuid, 'لا')$q$, req),
      'P0001', null, 'الـRM لا يرفض — يوصي');

    perform public.broker_request_review(req, 'أوصي بالموافقة', 'عميل جادّ');
    select status into st from public.broker_reservation_requests where id = req;
    log := log || extensions.is(st, 'بانتظار المشرف', 'المراجعة تنقل الطلب إلى المشرف');

    n := tests.count_as(brk1, format(
      'select count(*) from public.broker_request_events where request_id = %L and not visible_to_broker', req));
    log := log || extensions.is(n, 0::bigint, 'الوسيط لا يرى الأحداث الداخلية (التوصية، الإشعارات)');
    n := tests.count_as(sup_u, format(
      'select count(*) from public.broker_request_events where request_id = %L and action = %L', req, 'توصية'));
    log := log || extensions.is(n, 1::bigint, 'المشرف يرى التوصية');

    perform tests.act_as(sup_u);
    perform public.broker_request_ask_info(req, 'هل الدفعة الأولى جاهزة؟');
    select status into st from public.broker_reservation_requests where id = req;
    log := log || extensions.is(st, 'بحاجة لمعلومات', 'المشرف يطلب معلومات');

    perform tests.act_as(brk1);
    perform public.broker_request_answer(req, 'نعم، جاهزة');
    select status into st from public.broker_reservation_requests where id = req;
    log := log || extensions.is(st, 'بانتظار المشرف', 'إجابة الوسيط تعيد الطلب للمشرف');

    perform tests.act_as(sup_u);
    log := log || extensions.throws_ok(
      format($q$select public.broker_request_reject(%L::uuid, '  ')$q$, req),
      'P0001', null, 'الرفض بلا سبب ممنوع');

    res := public.approve_broker_reservation_request(req, null, 1000000, null, 'موافق');
    log := log || extensions.ok(
      (select r.status = 'حجز' and r.sale_channel = 'وسيط' and r.broker_company_id = coA
              and r.broker_request_id = req and r.broker_rm_id = rm_e and r.sale_price = 95000000
         from public.reservations r where r.id = res),
      'الموافقة تُنشئ حجزاً «وسيط» بالشركة والـRM والسعر المطلوب');
    log := log || extensions.ok(
      (select q.status = 'تمّ الحجز' and q.reservation_id = res and q.decided_by = sup_u
         from public.broker_reservation_requests q where q.id = req),
      'الطلب «تمّ الحجز» ومربوط بحجزه وصاحب القرار مسجَّل');
    log := log || extensions.is((select status from public.units where id = u[1]), 'محجوزة', 'الوحدة صارت محجوزة');

    -- ================= الصلاحيات تحت RLS =================
    n := tests.count_as(brk1, format('select count(*) from public.units where project_id = %L', proj));
    log := log || extensions.is(n, 0::bigint, 'الوسيط لا يقرأ جدول الوحدات');
    n := tests.count_as(brk1, format('select count(*) from public.reservations where id = %L', res));
    log := log || extensions.is(n, 0::bigint, 'الوسيط لا يقرأ الحجوزات');
    n := tests.count_as(rm_u, format('select count(*) from public.reservations where id = %L', res));
    log := log || extensions.is(n, 1::bigint, 'الـRM بدور employee يرى حجز ليد شركته (علاقة لا دور)');

    perform tests.act_as(brk2);
    req2 := public.broker_request_reservation(u[2], null, 'عميل ب',
              '0774' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), null, null);
    n := tests.count_as(sup_u, format('select count(*) from public.broker_reservation_requests where project_id = %L', proj));
    log := log || extensions.is(n, 2::bigint, 'المشرف يرى كل طلبات مشروعه أيّاً كان الـRM');
    n := tests.count_as(rm2_u, format('select count(*) from public.broker_reservation_requests where company_id = %L', coA));
    log := log || extensions.is(n, 0::bigint, 'RM شركة ب لا يرى طلبات شركة أ');

    -- ================= الانتهاء وتغيّر الـRM =================
    perform tests.act_as(null);
    update public.broker_reservation_requests set expires_at = now() - interval '1 minute' where id = req2;
    perform public.expire_broker_requests();
    select status into st from public.broker_reservation_requests where id = req2;
    log := log || extensions.is(st, 'منتهي', 'الطلب المنقضية مهلته «منتهي»');

    perform tests.act_as(brk2);
    req3 := public.broker_request_reservation(u[2], null, 'عميل ب ٢',
              '0775' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'), null, null);
    log := log || extensions.ok(req3 is not null, 'الوحدة تتحرّر بانتهاء الطلب');

    perform tests.act_as(admin_u);
    update public.broker_company_projects set rm_id = rm_e where company_id = coB and project_id = proj;
    log := log || extensions.ok(
      (select rm_id = rm_e from public.broker_reservation_requests where id = req3)
      and exists (select 1 from public.broker_request_events where request_id = req3 and action = 'تغيّر مدير العلاقات'),
      'تغيّر الـRM ينقل الطلب المفتوح بحدثٍ في الخطّ الزمني');
    update public.broker_company_projects set rm_id = rm2_e where company_id = coB and project_id = proj;
    perform tests.act_as(brk2);
    perform public.broker_cancel_reservation_request(req3);

    -- ================= عمولة الوسيط: الشرائح الرجعية =================
    perform tests.act_as(admin_u);
    update public.reservations set status = 'بيع مكتمل' where id = res;     -- البيع ١ (٩٥ مليون)
    select status into st from public.broker_reservation_requests where id = req;
    log := log || extensions.is(st, 'تمّ البيع', 'اكتمال البيع ينعكس على الطلب');

    for k in 3..6 loop
      perform tests.brk_sale(brk1, sup_u, admin_u, u[k], 'عميل أ ' || k);
    end loop;

    log := log || extensions.ok(
      (select count(*) = 5 and bool_and(rate = 1) from public.broker_commissions
        where company_id = coA and reversed_at is null),
      '٥ مبيعات = ١٪ لكلٍّ منها');

    res6 := tests.brk_sale(brk1, sup_u, admin_u, u[7], 'عميل أ ٧');
    log := log || extensions.ok(
      (select count(*) = 6 and bool_and(rate = 1.5) from public.broker_commissions
        where company_id = coA and reversed_at is null),
      'السادسة ترفع الستّ كلّها إلى ١.٥٪ بأثر رجعي');
    log := log || extensions.is(
      (select bc.amount from public.broker_commissions bc join public.reservations r on r.id = bc.reservation_id
        where r.id = res),
      1425000.00::numeric, 'الأولى أُعيدت على سعرها الفعلي: ٩٥ مليون × ١.٥٪');
    log := log || extensions.is(
      (select count(*) from public.broker_commission_adjustments a
         join public.broker_commissions bc on bc.id = a.commission_id
        where bc.company_id = coA and a.trigger_kind = 'صفقة جديدة' and a.new_rate = 1.5),
      5::bigint, 'سطر تعديل لكلٍّ من الخمس السابقة');
    log := log || extensions.ok(
      exists (select 1 from public.notifications n join public.broker_users bu on bu.user_id = n.user_id
               where bu.company_id = coA and n.title like '%انتقلتم إلى شريحة 1.5%'),
      'الوسيط يُبلَّغ بارتفاع شريحته');

    resB := tests.brk_sale(brk2, sup_u, admin_u, u[8], 'عميل ب ٨');
    log := log || extensions.is(
      (select rate from public.broker_commissions where reservation_id = resB), 1.0000::numeric,
      'عدّاد شركة ب مستقل عن شركة أ');

    log := log || extensions.ok(
      (select employee_role = 'مدير علاقات' and employee_id = rm_e and employee_amount = 0
         from public.sale_commissions where reservation_id = res6),
      'صفقة الوسيط لا تمرّ بقواعد البيع المباشر — الـRM بلا خطة = صفر');

    -- ================= قابلية الدفع، الصرف، الاسترداد، الفسخ =================
    select id into bk6 from public.broker_commissions where reservation_id = res6;
    log := log || extensions.ok((select payable_at is null from public.broker_commissions where id = bk6),
      'العمولة مستحقّة غير قابلة للصرف قبل تحصيل تلال');
    log := log || extensions.throws_ok(
      format($q$insert into public.broker_payments (commission_id, amount, method) values (%L, 1000, 'كاش')$q$, bk6),
      'P0001', null, 'لا صرف قبل قاعدة الخطة');

    select bc.id into bk from public.broker_commissions bc where bc.reservation_id = res;
    update public.sale_commissions set collected_at = current_date where reservation_id = res;
    log := log || extensions.ok((select payable_at is not null from public.broker_commissions where id = bk),
      'تحصيل عمولة تلال يجعل عمولة الوسيط قابلة للصرف');

    perform public.release_broker_commission(bk6, 'اختبار');
    insert into public.broker_payments (commission_id, amount, method) values (bk6, 1000000, 'كاش');
    log := log || extensions.ok(
      (select journal_entry_id is not null from public.broker_payments where commission_id = bk6 limit 1),
      'الدفعة تُقيَّد (5510/1100)');
    log := log || extensions.throws_ok(
      format($q$insert into public.broker_payments (commission_id, amount, method) values (%L, 600000, 'كاش')$q$, bk6),
      'P0001', null, 'الصرف فوق المستحق ممنوع');
    log := log || extensions.throws_ok(
      format($q$select public.reverse_sale(%L::uuid, 'اختبار')$q$, res6),
      'P0001', null, 'لا فسخ وقد صُرف للوسيط');
    log := log || extensions.throws_ok(
      format($q$insert into public.broker_payments (commission_id, amount, method, kind) values (%L, 2000000, 'كاش', 'استرداد')$q$, bk6),
      'P0001', null, 'الاسترداد فوق المصروف ممنوع');
    insert into public.broker_payments (commission_id, amount, method, kind) values (bk6, 1000000, 'كاش', 'استرداد');
    log := log || extensions.is(public.broker_commission_net_paid(bk6), 0::numeric, 'الاسترداد يصفّي المصروف');

    j := public.reverse_sale(res6, 'اختبار الفسخ');
    log := log || extensions.ok(
      (select reversed_at is not null and amount = 0 from public.broker_commissions where id = bk6),
      'الفسخ يعكس عمولة الوسيط ولا يحذفها');
    log := log || extensions.ok(
      (select count(*) = 5 and bool_and(rate = 1) from public.broker_commissions
        where company_id = coA and reversed_at is null),
      'خروج الصفقة يُنزل الشريحة إلى ١٪ للخمس الباقية');
    log := log || extensions.is(
      (select count(*) from public.broker_commission_adjustments a
         join public.broker_commissions bc on bc.id = a.commission_id
        where bc.company_id = coA and a.trigger_kind = 'فسخ'),
      6::bigint, 'سطر للمفسوخة وسطر لكلٍّ من الخمس');

    -- ================= البيع المباشر وشرائح الموظف =================
    d1 := tests.direct_sale(sel_u, admin_u, proj, u[9], 'مباشر ١');
    log := log || extensions.ok(
      (select r.sale_channel = 'مباشر' from public.reservations r where r.id = d1)
      and not exists (select 1 from public.broker_commissions where reservation_id = d1),
      'البيع المباشر بلا عمولة وساطة');
    perform tests.direct_sale(sel_u, admin_u, proj, u[10], 'مباشر ٢');
    perform tests.direct_sale(sel_u, admin_u, proj, u[11], 'مباشر ٣');
    log := log || extensions.ok(
      (select count(*) = 3 and bool_and(employee_rate = 0.05 and employee_amount = 50000)
         from public.sale_commissions where employee_plan_id = eplan and reversed_at is null),
      'ثلاث صفقات مباشرة = ٠.٠٥٪');

    perform tests.act_as(admin_u);
    perform public.confirm_down_payment(d1, 10000000);
    select id into sc1 from public.sale_commissions where reservation_id = d1;
    log := log || extensions.is(
      (select sum(amount) from public.commissions where sale_commission_id = sc1), 50000::numeric,
      'تأكيد المقدمة يُنشئ عمولة الموظف');

    d4 := tests.direct_sale(sel_u, admin_u, proj, u[12], 'مباشر ٤');
    log := log || extensions.ok(
      (select count(*) = 4 and bool_and(employee_rate = 0.075 and employee_amount = 75000)
         from public.sale_commissions where employee_plan_id = eplan and reversed_at is null),
      'الرابعة ترفع الأربع إلى ٠.٠٧٥٪ بأثر رجعي');
    log := log || extensions.ok(
      (select count(*) = 2 and sum(amount) = 75000 from public.commissions where sale_commission_id = sc1),
      'بعد المقدمة يُصدَر فرقٌ (٢٥ ألفاً) ولا يُعدَّل الصفّ المُرحَّل');
    log := log || extensions.is(
      (select count(*) from public.broker_commissions where company_id = coA and reversed_at is null),
      5::bigint, 'المبيعات المباشرة لا تمسّ عدّاد الوسيط');

    -- ================= الخطة الخاصة: حدّية بأساس القيمة =================
    log := log || extensions.throws_ok(
      format($q$select public.save_commission_plan(jsonb_build_object('id', %L::uuid, 'project_id', %L::uuid,
               'recipient_type', 'وسيط', 'formula', 'شرائح حدّية'), '[{"min_units":1,"rate":1}]'::jsonb)$q$, bplan, proj),
      'P0001', null, 'لا تتغيّر صيغة خطةٍ عليها عمولات');

    ovr := public.save_commission_plan(
      jsonb_build_object('project_id', proj, 'recipient_type', 'وسيط', 'company_id', coB,
                         'formula', 'شرائح حدّية', 'basis', 'قيمة المبيعات', 'period', 'ربعي',
                         'payable_rule', 'عند الاستحقاق'),
      '[{"min_value":0,"rate":1},{"min_value":150000000,"rate":2}]'::jsonb);
    res := tests.brk_sale(brk2, sup_u, admin_u, u[13], 'عميل ب ١٣');
    resB := tests.brk_sale(brk2, sup_u, admin_u, u[14], 'عميل ب ١٤');
    log := log || extensions.ok(
      (select rate = 1 and payable_at is not null from public.broker_commissions where reservation_id = res)
      and (select rate = 2 from public.broker_commissions where reservation_id = resB),
      'الحدّية بالقيمة: الأولى (١٠٠م) ١٪، الثانية (٢٠٠م تراكمياً) ٢٪ — والخاصة تحلّ محلّ العامة');
    log := log || extensions.is(public.commission_period_key('ربعي', date '2026-08-15'), '2026-Q3', 'مفتاح الفترة الربعية');

    -- ================= الدفتر والتقارير =================
    log := log || extensions.ok(
      exists (select 1 from public.commission_ledger where recipient_type = 'وسيط' and recipient_id = coA and status = 'قابلة للصرف')
      and exists (select 1 from public.commission_ledger where recipient_type = 'موظف مباشر' and recipient_id = sel_e)
      and exists (select 1 from public.commission_ledger where recipient_type = 'تلال' and project_id = proj),
      'الدفتر الموحّد يجمع الوسيط والموظف وعمولة المطوّر');

    perform tests.act_as(admin_u);
    log := log || extensions.ok(
      (select sales = 5 from public.broker_performance(null, null, proj) where company_id = coA),
      'أداء الشركة: ٥ مبيعات بعد الفسخ');
    log := log || extensions.ok(
      (select direct_sales = 4 and broker_sales = 8 from public.direct_vs_broker(null, null) where project_id = proj),
      'مباشر مقابل وسيط: ٤ مقابل ٨');
    log := log || extensions.ok(
      (select count(*) = 1 from public.supervisor_approval_performance(null, null) where project_id = proj),
      'أداء الموافقات يُرجع المشروع');
    perform tests.act_as(brk1);
    j := public.broker_dashboard_summary();
    log := log || extensions.ok((j->>'completed_sales')::int = 5, 'لوحة الوسيط: مبيعاته المكتملة');
    j := public.broker_request_detail(req);
    log := log || extensions.ok(not (j ? 'rm_recommendation') and jsonb_array_length(j->'events') > 0,
      'تفاصيل الطلب للوسيط بلا التوصية الداخلية ومعها خطّه الزمني');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الوساطة: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_brokerage() is
  'اختبارات الوساطة v2: المسار، القفل، الصلاحيات تحت RLS، الشرائح الرجعية والحدّية، المباشر مقابل الوسيط، الدفع والاسترداد والفسخ، الدفتر والتقارير. يُلغي أثره (sql/131).';

revoke all on function tests.run_brokerage() from public;
revoke all on function tests.count_as(uuid, text) from public;
revoke all on function tests.brk_sale(uuid, uuid, uuid, uuid, text) from public;
revoke all on function tests.direct_sale(uuid, uuid, uuid, uuid, text) from public;
grant execute on function tests.run_brokerage() to service_role;
