-- ============================================================
-- تلال ERP — 203: اختبارات رحلة العميل (201–202)
--
--   select * from tests.run_client_journey();
--
-- وتكييف ثلاثة اختبارات قديمة كانت تكتب clients.stage مباشرةً — وهو
-- ما صار مرفوضاً بالتصميم (201). السلوك الذي تحرسه باقٍ، والباب تغيّر:
--   run_all            «الكانبان يحرّك الفرصة» ← crm_move_client_stage
--   run_write_paths    «الموظف يغيّر مرحلة عميله» ← crm_move_client_stage
--   run_lost_sales     «بطاقة لها فرصة مفتوحة لا تُنقل إلى فشل البيع» ← رسالة النموذج
--   run_lost_card_sync يُعاد كتابته: المرآة التي يختبرها لم تعد موجودة؛
--                      يختبر الآن أن البطاقة تتبع مسارها الحالي في الحالات نفسها.
--
-- كل اختبار يعمل في معاملة فرعية تُلغى في آخرها — لا أثر يبقى.
-- ============================================================

-- ============================================================
-- (أ) الاختبار الجديد
-- ============================================================
create or replace function tests.run_client_journey()
returns table(nr integer, result text, test_name text)
language plpgsql set search_path = public, extensions as $fn$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; other_u uuid; other_emp uuid; mkt_u uuid;
  proj uuid;
  g_lead uuid; g_contact uuid; g_neg uuid; g_res uuid; g_unr uuid;
  c_price uuid; r_m2 uuid;
  cli uuid; cli2 uuid; cli3 uuid; cli4 uuid;
  j uuid; j2 uuid; j3 uuid; j4 uuid;
  u1 uuid; u2 uuid; u3 uuid;
  res1 uuid; res2 uuid; res3 uuid;
  n int; m int; txt text; base jsonb; hrow record;
  v_mine0 jsonb; v_mine1 jsonb; v_other0 jsonb; v_other1 jsonb;
  i int := 0;
  today date := public.baghdad_today();
  ph text;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select p.id, e.id into other_u, other_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and e.id <> plain_emp order by p.created_at limit 1;
  select id into mkt_u from public.profiles where role = 'marketing' order by created_at limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into g_lead    from public.crm_stages where name = 'ليد';
  select id into g_contact from public.crm_stages where name = 'اتصال';
  select id into g_neg     from public.crm_stages where name = 'مناقشة العرض';
  select id into g_res     from public.crm_stages where name = 'حجز';
  select id into g_unr     from public.crm_stages where name = 'تعذّر الوصول';
  select id into c_price from public.crm_loss_categories where code = 'price';
  select id into r_m2    from public.crm_lost_reasons where category_id = c_price and name = 'سعر المتر مرتفع';

  if admin_u is null or plain_u is null or other_u is null or proj is null
     or g_lead is null or g_res is null or g_unr is null or r_m2 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بملفّ ومشروع ومراحل 201 وبذرة 140'::text;
    return;
  end if;

  base := jsonb_build_object('category_id', c_price, 'reason_id', r_m2, 'loss_source', 'price',
                             'customer_potential', 'B', 'recovery_potential', 'none',
                             'details', 'اختبار رحلة العميل — السعر');

  begin
    -- ================= (٠) البيانات الحيّة =================
    perform tests.act_as(null);
    log := log || extensions.is((select count(*)::int from public.crm_journey_drift()), 0,
      '٢: كل بطاقة تطابق مسارها الحالي (البيانات الحيّة)');
    log := log || extensions.is((select count(*)::int from public.clients c
                                  where c.deleted_at is null
                                    and not exists (select 1 from public.opportunities o
                                                     where o.client_id = c.id and o.deleted_at is null)), 0,
      '٢: لا عميل بلا مسار — كل العملاء في لوحة المسار');
    log := log || extensions.is((select count(*)::int from public.opportunities o
                                  where o.deleted_at is null
                                    and not exists (select 1 from public.opportunity_stage_history h
                                                     where h.opportunity_id = o.id and h.from_stage_id is null)), 0,
      '٦: لكل مسار صفّ «دخول أول» فيعدّه القمع');
    log := log || extensions.is((select count(*)::int from public.reservations where opportunity_id is null), 0,
      '٧: لا حجز بلا مسار');
    log := log || extensions.is((select count(*)::int from public.crm_journey_migration_runs where phase = '201:after'), 1,
      '١٦: الترحيل سُجّل مرة واحدة (يتخطّى نفسه عند إعادة التشغيل)');
    log := log || extensions.ok(not exists (select 1 from pg_trigger
                                             where not tgisinternal
                                               and tgname in ('trg_mirror_client_stage', 'trg_client_stage_log',
                                                              'trg_guard_client_lost_stage', 'trg_close_client_on_sale')),
      '٢٠: المرايا القديمة أُسقطت — لا كاتب ثانٍ للمرحلة');
    log := log || extensions.is((select count(*)::int from public.crm_lost_card_drift()), 0,
      '٢: لا بطاقة «فشل البيع» على مسار غير خاسر');

    v_mine0  := public.crm_journey_outcomes(jsonb_build_object('owner_id', plain_emp, 'from', today, 'to', today));
    v_other0 := public.crm_journey_outcomes(jsonb_build_object('owner_id', other_emp, 'from', today, 'to', today));

    -- ================= (١) العميل الجديد =================
    perform tests.act_as(admin_u);
    ph := '0773' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار رحلة العميل', ph, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli;
    select current_journey_id into j from public.clients where id = cli;

    log := log || extensions.is((select count(*)::int from public.opportunities where client_id = cli and deleted_at is null), 1,
      '١: العميل الجديد يولد بمسار افتراضي واحد بلا إنشاء يدوي');
    log := log || extensions.ok(j is not null and j = (select id from public.opportunities where client_id = cli),
      '١: البطاقة تعرف مسارها الحالي');
    log := log || extensions.ok(exists (select 1 from public.opportunity_stage_history
                                         where opportunity_id = j and from_stage_id is null
                                           and to_stage_id = g_lead and change_source = 'created'),
      '١: صفّ «دخول أول» بمصدر created');
    log := log || extensions.ok(exists (select 1 from public.crm_event_facts
                                         where client_id = cli and event_type = 'lead_created'),
      '٥: الليد يُعدّ من العميل نفسه (lead_created) لا من الفرصة');
    log := log || extensions.ok(exists (select 1 from public.crm_event_facts
                                         where opportunity_id = j and event_type = 'stage_change' and event_subtype = 'initial'),
      '٦: دخول المرحلة الأولى حدثٌ في القمع');

    -- ================= (٢) الانتقال بالباب الواحد =================
    perform tests.act_as(plain_u);
    perform public.crm_move_client_stage(cli, 'اتصال', 'ردّ وحدّد موعداً');
    log := log || extensions.is((select stage from public.clients where id = cli), 'اتصال',
      '٣: النقل يحرّك المسار والبطاقة معاً');
    select * into hrow from public.opportunity_stage_history
     where opportunity_id = j and to_stage_id = g_contact order by at desc limit 1;
    log := log || extensions.ok(hrow.from_stage_id = g_lead and hrow.changed_by = plain_u and hrow.change_source = 'user'
                                and hrow.note = 'ردّ وحدّد موعداً' and hrow.owner_id = plain_emp and hrow.project_id = proj,
      '٣: السجلّ يحفظ السابقة والمنفّذ والمصدر والسبب والمالك والمشروع وقتها');
    log := log || extensions.ok(exists (select 1 from public.client_activities
                                         where client_id = cli and activity_type = 'تغيير مرحلة' and stage_to = 'اتصال'),
      '٣: سطر «تغيير مرحلة» في سجلّ التواصل');
    log := log || extensions.is(
      (select count(*)::int from public.crm_event_facts f where f.opportunity_id = j and f.event_type = 'stage_change'),
      (select count(*)::int from public.opportunity_stage_history where opportunity_id = j),
      '٦: لكل انتقال حدثٌ واحد في محرّك التقارير');

    begin
      update public.clients set stage = 'زيارة' where id = cli;
      log := log || extensions.fail('٢٠: الكتابة المباشرة على مرحلة البطاقة تُرفض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مسار البيع%', '٢٠: الكتابة المباشرة على مرحلة البطاقة تُرفض');
    end;
    begin
      perform public.crm_move_client_stage(cli, 'حجز');
      log := log || extensions.fail('٧: «حجز» لا يُدخل يدوياً');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%بتسجيل الحجز%', '٧: «حجز» لا يُدخل يدوياً');
    end;
    begin
      perform public.crm_move_client_stage(cli, 'فشل البيع');
      log := log || extensions.fail('٩: الخسارة لا تُسجَّل إلا بالنموذج');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%نموذج%', '٩: الخسارة لا تُسجَّل إلا بالنموذج');
    end;

    -- ================= (٣) لا خسارة تلقائية =================
    insert into public.client_activities
      (client_id, created_by, activity_type, direction, outcome, summary, next_action, next_action_date)
    values (cli, plain_u, 'مكالمة', 'صادر', 'لم يرد', 'لم يرد على الاتصال', 'معاودة الاتصال', today + 1);
    log := log || extensions.ok((select stage from public.clients where id = cli) = 'اتصال'
                                and not exists (select 1 from public.crm_lost_sales where opportunity_id = j),
      '٤: «لم يرد» لا يغيّر المرحلة ولا يسجّل خسارة');
    begin
      perform public.crm_move_client_stage(cli, 'تعذّر الوصول');
      log := log || extensions.fail('٤: «تعذّر الوصول» بسبب إلزامي');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سبب%', '٤: «تعذّر الوصول» بسبب إلزامي');
    end;
    perform public.crm_move_client_stage(cli, 'تعذّر الوصول', 'خمس محاولات بلا ردّ خلال أسبوعين');
    log := log || extensions.ok(
      (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = j) = 'closed'
      and not exists (select 1 from public.crm_lost_sales where opportunity_id = j)
      and (select closed_at from public.opportunities where id = j) is not null,
      '٤: «تعذّر الوصول» إغلاق غير تجاري — لا خسارة بيع، والمسار مُغلق');
    log := log || extensions.ok(exists (select 1 from public.crm_event_facts
                                         where opportunity_id = j and event_type = 'stage_change'
                                           and to_stage_type = 'closed' and event_subtype = 'closed'),
      '٤: حدثه في التقارير closed لا lost ولا progression');
    begin
      perform public.crm_move_client_stage(cli, 'اتصال');
      log := log || extensions.fail('١٠: العودة من إغلاق غير تجاري بسبب');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%سبب إعادة فتح%', '١٠: العودة من إغلاق غير تجاري بسبب');
    end;
    perform public.crm_move_client_stage(cli, 'اتصال', 'ردّ أخيراً من رقم آخر');
    log := log || extensions.ok(exists (select 1 from public.crm_event_facts
                                         where opportunity_id = j and event_subtype = 'reopened'),
      '١٠: العودة حدث reopened');

    -- ================= (٤) الصلاحيات =================
    perform tests.act_as(other_u);
    begin
      perform public.crm_move_client_stage(cli, 'زيارة');
      log := log || extensions.fail('١٤: موظف آخر لا ينقل عميلاً لا يملكه');
    exception when others then
      log := log || extensions.is(sqlstate, '42501', '١٤: موظف آخر لا ينقل عميلاً لا يملكه');
    end;
    select b.succeeded, b.failed into n, m from public.bulk_set_stage(array[cli], 'زيارة') b;
    log := log || extensions.ok(n = 0 and m = 1,
      '١٤: الإجراء الجماعي لا يتجاوز الصلاحية (كان definer بلا فحص)');
    if mkt_u is not null then
      perform tests.act_as(mkt_u);
      begin
        perform public.crm_move_client_stage(cli, 'زيارة');
        log := log || extensions.fail('١٤: التسويق لا ينقل مرحلة عميل');
      exception when others then
        log := log || extensions.is(sqlstate, '42501', '١٤: التسويق لا ينقل مرحلة عميل');
      end;
    end if;
    log := log || extensions.is(
      tests.count_as(other_u, format('select count(*) from public.opportunity_stage_history where opportunity_id = %L', j)),
      0::bigint, '١٤: سجلّ مراحل عميلٍ لا يراه الموظف مغلقٌ عليه (RLS)');
    log := log || extensions.ok(
      tests.count_as(plain_u, format('select count(*) from public.opportunity_stage_history where opportunity_id = %L', j)) > 0,
      '١٤: وصاحبه يراه');
    log := log || extensions.is(
      tests.count_as(other_u, format('select count(*) from public.clients where id = %L and current_journey_id is not null', cli)),
      0::bigint, '١٤: الأعمدة الجديدة على البطاقة لا توسّع رؤيتها');
    log := log || extensions.ok(
      not has_function_privilege('authenticated', 'public.crm_journey_apply_stage(uuid, uuid, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.crm_journey_sync_client(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.crm_move_client_stage(uuid, text, text, uuid)', 'execute'),
      '١٤: الدوال الداخلية لا تُستدعى من الواجهة، والباب العام مغلق على غير المسجَّل');

    -- ================= (٥) الحجز والإلغاء =================
    perform tests.act_as(admin_u);
    insert into public.units (project, project_id, unit_code, unit_type, price, status)
    values ('اختبار رحلة العميل', proj, 'J-' || substr(md5(random()::text), 1, 6), 'شقة', 150000000, 'متاحة') returning id into u1;
    insert into public.units (project, project_id, unit_code, unit_type, price, status)
    values ('اختبار رحلة العميل', proj, 'J-' || substr(md5(random()::text), 1, 6), 'شقة', 160000000, 'متاحة') returning id into u2;
    insert into public.units (project, project_id, unit_code, unit_type, price, status)
    values ('اختبار رحلة العميل', proj, 'J-' || substr(md5(random()::text), 1, 6), 'شقة', 170000000, 'متاحة') returning id into u3;

    perform public.crm_move_client_stage(cli, 'مناقشة العرض');
    insert into public.reservations (client_id, unit_id, reservation_date, status, created_by)
    values (cli, u1, current_date, 'حجز', admin_u) returning id into res1;
    log := log || extensions.is((select opportunity_id from public.reservations where id = res1), j,
      '٧: الحجز يُربط بالمسار الحالي');
    log := log || extensions.is((select stage from public.clients where id = cli), 'حجز',
      '٧: الحجز ينقل المسار والبطاقة إلى «حجز»');
    log := log || extensions.is((select count(*)::int from public.opportunities where client_id = cli and deleted_at is null), 1,
      '٧: بلا مسار مكرّر');
    log := log || extensions.ok(exists (select 1 from public.opportunity_stage_history
                                         where opportunity_id = j and to_stage_id = g_res and change_source = 'reservation'),
      '٧: الانتقال إلى «حجز» مصدره reservation');

    update public.reservations set status = 'ملغى' where id = res1;
    log := log || extensions.is((select stage from public.clients where id = cli), 'مناقشة العرض',
      '٨: إلغاء الحجز يعيد المسار إلى ما قبل «حجز»');
    log := log || extensions.ok(exists (select 1 from public.crm_event_facts
                                         where source_table = 'reservations' and source_id = res1
                                           and event_type = 'reservation_cancelled'),
      '٨: الإلغاء حدثٌ في التقارير');
    log := log || extensions.is((select count(*)::int from public.sale_commissions where reservation_id = res1), 0,
      '٨: حجزٌ أُلغي قبل البيع لا عمولة له');

    -- ================= (٦) البيع والشراء الثاني =================
    res2 := tests.direct_sale(plain_u, admin_u, proj, u2, 'اختبار رحلة العميل — بيع');
    select client_id into cli2 from public.reservations where id = res2;
    select current_journey_id into j2 from public.clients where id = cli2;
    log := log || extensions.ok(
      (select stage from public.clients where id = cli2) = 'بيع'
      and (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = j2) = 'won'
      and (select opportunity_id from public.reservations where id = res2) = j2,
      '٨: البيع المكتمل يجعل مسار الحجز «بيع» والبطاقة تتبعه');
    n := (select count(*)::int from public.sale_commissions where reservation_id = res2);
    m := (select count(*)::int from public.crm_event_facts where source_table = 'reservations' and source_id = res2 and event_type = 'sale_completed');
    update public.reservations set status = 'بيع مكتمل' where id = res2;   -- لا تغيير
    update public.opportunities set notes = coalesce(notes, '') || ' ' where id = j2;
    log := log || extensions.ok(n <= 1
      and (select count(*)::int from public.sale_commissions where reservation_id = res2) = n
      and (select count(*)::int from public.crm_event_facts where source_table = 'reservations' and source_id = res2 and event_type = 'sale_completed') = m
      and m = 1,
      '٨: تكرار التحديث لا يكرّر العمولة ولا حدث البيع');

    perform tests.act_as(plain_u);
    begin
      perform public.crm_move_client_stage(cli2, 'مناقشة العرض', 'تصحيح');
      log := log || extensions.fail('٨: مسارٌ عليه بيع مكتمل لا تُنقل مرحلته');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%بيعٌ مكتمل%', '٨: مسارٌ عليه بيع مكتمل لا تُنقل مرحلته');
    end;

    perform tests.act_as(admin_u);
    insert into public.reservations (client_id, unit_id, reservation_date, status, created_by)
    values (cli2, u3, current_date, 'حجز', admin_u) returning id into res3;
    log := log || extensions.is((select count(*)::int from public.opportunities where client_id = cli2 and deleted_at is null), 2,
      '١٩: حجزٌ ثانٍ لعميل اشترى يفتح مسار شراء جديداً');
    log := log || extensions.ok(
      (select opportunity_id from public.reservations where id = res3) <> j2
      and (select opportunity_id from public.reservations where id = res2) = j2
      and (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = j2) = 'won',
      '١٩: كل حجز على مساره — البيع الأول لا يُمسّ');
    log := log || extensions.is((select stage from public.clients where id = cli2), 'حجز',
      '١٩: البطاقة تتبع المسار المفتوح الجديد');

    -- ================= (٧) الخسارة وإعادة التنشيط والخسارة الثانية =================
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار رحلة العميل — خسارة', '0774' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'),
            'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli3;
    select current_journey_id into j3 from public.clients where id = cli3;
    update public.opportunities set expected_value = 120000000 where id = j3;

    perform tests.act_as(plain_u);
    begin
      perform public.close_opportunity_lost(j3, jsonb_build_object('details', 'ناقصة'));
      log := log || extensions.fail('٩: الاستمارة الناقصة تُرفض');
    exception when others then
      log := log || extensions.pass('٩: الاستمارة الناقصة تُرفض');
    end;
    log := log || extensions.is((select count(*)::int from public.crm_lost_sales where opportunity_id = j3), 0,
      '٩: ولا يُحفظ منها شيء');
    perform public.close_opportunity_lost(j3, base);
    log := log || extensions.ok(
      (select stage from public.clients where id = cli3) = 'فشل البيع'
      and (select count(*) from public.crm_lost_sales where opportunity_id = j3 and loss_no = 1) = 1,
      '٩: النموذج الكامل يُغلق المسار ويحرّك البطاقة');
    log := log || extensions.is(public.crm_loss_class_at(j3, now()), 'commercial',
      'التصنيف: خسارة بالسعر لعميل B = تجارية');
    perform public.reactivate_lost_opportunity(j3, g_contact, 'عاد يسأل عن مشروع جديد', 'اتصال متابعة', today + 2);
    log := log || extensions.ok(
      (select stage from public.clients where id = cli3) = 'اتصال'
      and (select outcome from public.crm_lost_sales where opportunity_id = j3 and loss_no = 1) = 'reactivated',
      '١٠: إعادة التنشيط تُبقي الخسارة الأولى بحالها «أُعيد تنشيطها»');
    perform public.close_opportunity_lost(j3, base || jsonb_build_object('customer_potential', 'D'));
    log := log || extensions.ok(
      (select count(*) from public.crm_lost_sales where opportunity_id = j3) = 2
      and exists (select 1 from public.crm_lost_sales where opportunity_id = j3 and loss_no = 2)
      and exists (select 1 from public.crm_lost_sales where opportunity_id = j3 and loss_no = 1),
      '١١: الخسارة الثانية واقعة جديدة، والأولى باقية');
    log := log || extensions.is(public.crm_loss_class_at(j3, now()), 'unqualified',
      'التصنيف: الثانية «غير مؤهّل» لا خسارة تجارية');

    -- ================= (٨) الاتساق: الآن / الحدث / إعادة البناء =================
    perform tests.act_as(null);
    log := log || extensions.is(
      (select s.stage_name from public.crm_state_as_of(null) s where s.client_id = cli and s.is_primary),
      (select stage from public.clients where id = cli),
      '١٢: «الحالة الآن» في المحرّك = البطاقة');
    log := log || extensions.is(
      (select s.stage_name from public.crm_state_as_of(now() + interval '1 second') s where s.client_id = cli and s.is_primary),
      (select stage from public.clients where id = cli),
      '١٢: إعادة البناء من الأحداث للّحظة نفسها = الحالة الآن');
    log := log || extensions.is(
      (select s.stage_name from public.crm_state_as_of(now() + interval '1 second') s where s.client_id = cli3 and s.is_primary),
      'فشل البيع', '١٢: والخاسر يُعاد بناؤه خاسراً');

    -- ================= (٩) المرشّحات =================
    v_mine1  := public.crm_journey_outcomes(jsonb_build_object('owner_id', plain_emp, 'from', today, 'to', today));
    v_other1 := public.crm_journey_outcomes(jsonb_build_object('owner_id', other_emp, 'from', today, 'to', today));
    log := log || extensions.ok(
      (v_mine1->>'closed_noncommercial')::int - (v_mine0->>'closed_noncommercial')::int = 1
      and (v_mine1->>'lost_commercial')::int  - (v_mine0->>'lost_commercial')::int  = 1
      and (v_mine1->>'lost_unqualified')::int - (v_mine0->>'lost_unqualified')::int = 1,
      '١٣: نتائج المدة بمرشّح الموظف: إغلاق غير تجاري ١، خسارة تجارية ١، غير مؤهّل ١');
    log := log || extensions.is(v_other1, v_other0, '١٣: أحداث موظف لا تظهر في مرشّح غيره');
    -- المقام نفسه لا قيمة المعدّل: بلا فوز في اليوم يكون المعدّلان صفراً كلاهما
    log := log || extensions.ok(
      (v_mine1->>'lost_all')::int > (v_mine1->>'lost_commercial')::int
      and (v_mine1->>'win_rate_commercial')::numeric is not distinct from
          case when (v_mine1->>'won')::int + (v_mine1->>'lost_commercial')::int > 0
               then round((v_mine1->>'won')::int * 100.0
                          / ((v_mine1->>'won')::int + (v_mine1->>'lost_commercial')::int), 1) end,
      '١٣: معدّل الفوز التجاري مقامه فوز + خسارة تجارية — غير المؤهّل خارجه');

    -- ================= (١٠) الدمج والحذف الناعم =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار رحلة العميل — مكرّر', '0775' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0'),
            'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli4;
    select current_journey_id into j4 from public.clients where id = cli4;
    perform public.crm_move_client_stage(cli4, 'زيارة');
    n := (select count(*)::int from public.opportunity_stage_history where opportunity_id in (j, j4));
    perform public.merge_clients(cli, cli4, '{}'::text[]);
    log := log || extensions.is((select count(*)::int from public.opportunity_stage_history where opportunity_id in (j, j4)), n,
      '١٧: الدمج لا يحذف سجلّ المراحل');
    log := log || extensions.is((select count(*)::int from public.crm_journey_drift() where client_id = cli), 0,
      '١٧: البطاقة الباقية تطابق مسارها بعد الدمج');
    perform public.soft_delete_client(cli3, 'اختبار رحلة العميل');
    log := log || extensions.ok(
      (select count(*) from public.opportunity_stage_history where opportunity_id = j3) >= 4
      and (select count(*) from public.crm_lost_sales where opportunity_id = j3) = 2,
      '١٧: الحذف الناعم لا يمسّ التاريخ ولا الخسائر');

    -- ================= (١١) المقاييس الجديدة في المحرّك =================
    perform public.crm_report_query(
      p_metrics => array['WIN_RATE_COMMERCIAL', 'COMMERCIAL_LOST_DEALS', 'NONCOMMERCIAL_LOST',
                         'UNANALYSED_LOST', 'DISQUALIFIED_CLOSED', 'RESERVATION_STAGE_ENTERED'],
      p_from => today - 30, p_to => today);
    log := log || extensions.pass('٢٠: المقاييس الحدثية الجديدة تُنفَّذ في المحرّك');
    perform public.crm_report_query(
      p_metrics => array['AT_RESERVATION', 'CLOSED_NONCOMMERCIAL_TOTAL'], p_state => 'current');
    log := log || extensions.pass('٢٠: مقاييس الحالة الجديدة تُنفَّذ في المحرّك');

    log := log || extensions.is((select count(*)::int from public.crm_journey_drift()
                                  where client_id in (cli, cli2)), 0,
      '٢: لا فرق بعد كل ما سبق');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات رحلة العميل: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $fn$;

-- ============================================================
-- (ب) تكييف الاختبارات القديمة — الباب تغيّر والسلوك المحروس باقٍ
-- ============================================================
do $patch$
declare d text; d2 text;
begin
  -- run_all: «الكانبان يحرّك الفرصة»
  d := pg_get_functiondef('tests.run_all()'::regprocedure);
  if position('crm_move_client_stage' in d) = 0 then
    d2 := replace(d, $q$update public.clients set stage = 'زيارة' where id = cid;$q$,
                     $q$perform public.crm_move_client_stage(cid, 'زيارة');$q$);
    d2 := replace(d2, $q$'المرآة: سحب البطاقة في الكانبان يحرّك الفرصة'$q$,
                      $q$'الباب الواحد (201): نقل البطاقة يحرّك مسارها'$q$);
    if d2 = d then raise exception '203: لم يُعثر على موضع الترقيع في tests.run_all'; end if;
    execute d2;
  end if;

  -- run_write_paths: «الموظف يغيّر مرحلة عميله»
  d := pg_get_functiondef('tests.run_write_paths()'::regprocedure);
  if position('crm_move_client_stage' in d) = 0 then
    d2 := replace(d, $q$format('update public.clients set stage = %L where id = %L', 'زيارة', cid)$q$,
                     $q$format('select public.crm_move_client_stage(%L::uuid, %L)', cid, 'زيارة')$q$);
    if d2 = d then raise exception '203: لم يُعثر على موضع الترقيع في tests.run_write_paths'; end if;
    execute d2;
  end if;

  -- run_lost_sales: البطاقة لا تُنقل إلى «فشل البيع» — الرسالة الآن رسالة النموذج
  d := pg_get_functiondef('tests.run_lost_sales()'::regprocedure);
  if position('crm_move_client_stage' in d) = 0 then
    d2 := replace(d, $q$update public.clients set stage = 'فشل البيع' where id = cli;$q$,
                     $q$perform public.crm_move_client_stage(cli, 'فشل البيع');$q$);
    d2 := replace(d2, $q$sqlerrm like '%فرصة مفتوحة%', 'بطاقة لها فرصة مفتوحة$q$,
                      $q$sqlerrm like '%نموذج%', 'بطاقة لها فرصة مفتوحة$q$);
    if d2 = d then raise exception '203: لم يُعثر على موضع الترقيع في tests.run_lost_sales'; end if;
    execute d2;
  end if;
end $patch$;

-- run_lost_card_sync: المرآة التي يختبرها أُسقطت؛ الحالات نفسها على المسار
create or replace function tests.run_lost_card_sync()
returns table(nr integer, result text, test_name text)
language plpgsql set search_path = public, extensions as $fn$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; proj uuid;
  g_neg uuid; g_lost uuid;
  c_price uuid; r_m2 uuid;
  cli uuid; cli2 uuid; opp uuid; opp2 uuid;
  n int; txt text; base jsonb;
  i int := 0;
  v_phone  text := '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  v_phone2 text := '0772' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into g_neg  from public.crm_stages where name = 'مناقشة العرض';
  select id into g_lost from public.crm_stages where stage_type = 'lost' order by sort_order limit 1;
  select id into c_price from public.crm_loss_categories where code = 'price';
  select id into r_m2    from public.crm_lost_reasons where category_id = c_price and name = 'سعر المتر مرتفع';

  if admin_u is null or plain_u is null or proj is null or g_neg is null or g_lost is null or r_m2 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف بملفّ ومشروع ومراحل 070 وبذرة 140'::text;
    return;
  end if;

  begin
    log := log || extensions.is((select count(*)::int from public.crm_lost_card_drift()), 0,
      'لا بطاقة «فشل البيع» على فرصة غير خاسرة');
    log := log || extensions.is((select count(*)::int from public.crm_journey_drift()), 0,
      'كل بطاقة مرآة مسارها الحالي (201)');

    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار تطابق', v_phone, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli;
    select current_journey_id into opp from public.clients where id = cli;
    update public.opportunities set project_id = proj, expected_value = 100000000 where id = opp;
    perform public.crm_move_client_stage(cli, 'مناقشة العرض');

    base := jsonb_build_object('category_id', c_price, 'reason_id', r_m2, 'loss_source', 'price',
                               'customer_potential', 'B', 'recovery_potential', 'none',
                               'details', 'اختبار تطابق البطاقة والفرصة');

    -- ================= المفتوحة =================
    perform tests.act_as(plain_u);
    begin
      update public.clients set stage = 'فشل البيع' where id = cli;
      log := log || extensions.fail('البطاقة لا تُكتب مباشرة — ولا إلى «فشل البيع»');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مسار البيع%', 'البطاقة لا تُكتب مباشرة — ولا إلى «فشل البيع»');
    end;
    begin
      perform public.crm_move_client_stage(cli, 'فشل البيع');
      log := log || extensions.fail('مسار مفتوح لا يُنقل إلى «فشل البيع» إلا بالنموذج');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%نموذج%', 'مسار مفتوح لا يُنقل إلى «فشل البيع» إلا بالنموذج');
    end;

    -- ================= الرابحة: «بيع» ثم «فشل البيع» =================
    perform public.crm_move_client_stage(cli, 'بيع');
    log := log || extensions.is(
      (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = opp),
      'won', 'النقل إلى «بيع» يجعل المسار رابحاً والبطاقة تتبعه');
    begin
      perform public.crm_move_client_stage(cli, 'فشل البيع');
      log := log || extensions.fail('مسار رابح لا يُنقل إلى «فشل البيع»');
    exception when others then
      log := log || extensions.pass('مسار رابح لا يُنقل إلى «فشل البيع»');
    end;
    begin
      perform public.crm_move_client_stage(cli, 'مناقشة العرض', 'تراجع');
      log := log || extensions.fail('الموظف لا يعيد «بيع» إلى مرحلة مفتوحة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مسار شراء إضافي%', 'الموظف لا يعيد «بيع» إلى مرحلة مفتوحة');
    end;
    log := log || extensions.is((select stage from public.clients where id = cli), 'بيع',
      'المحاولات المرفوضة لم تغيّر البطاقة');

    -- ================= النموذج =================
    perform tests.act_as(admin_u);
    perform public.crm_move_client_stage(cli, 'مناقشة العرض', 'تصحيح «بيع» سُجّل خطأً');
    perform tests.act_as(plain_u);
    perform public.close_opportunity_lost(opp, base);
    log := log || extensions.ok(
      (select stage from public.clients where id = cli) = 'فشل البيع'
      and (select stage_id from public.opportunities where id = opp) = g_lost,
      'إغلاق المسار بالنموذج يحرّك البطاقة إلى «فشل البيع»');
    perform tests.act_as(null);
    log := log || extensions.is(
      (select count(*)::int from public.crm_lost_card_drift() where client_id = cli), 0,
      'البطاقة والمسار متطابقان بعد النموذج');

    -- ================= المتعدّدة =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار تطابق ٢', v_phone2, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli2;
    select current_journey_id into opp from public.clients where id = cli2;
    insert into public.opportunities (client_id, stage_id, owner_id, project_id, created_at)
    values (cli2, g_neg, plain_emp, proj, now() + interval '1 second') returning id into opp2;
    log := log || extensions.is((select current_journey_id from public.clients where id = cli2), opp2,
      'مساران مفتوحان: البطاقة على الأحدث');

    perform public.close_opportunity_lost(opp, base);
    log := log || extensions.is((select stage from public.clients where id = cli2), 'مناقشة العرض',
      'مسار خاسر وآخر مفتوح: البطاقة على المفتوح');
    perform public.close_opportunity_lost(opp2, base);
    log := log || extensions.is((select stage from public.clients where id = cli2), 'فشل البيع',
      'كل المسارات خاسرة ⇒ البطاقة «فشل البيع» بلا نقل يدوي');

    -- ================= التسوية =================
    perform tests.act_as(null);
    select count(*) into n
      from public.opportunities o
     where o.deleted_at is null and o.lost_note like 'أُغلقت بالتسوية 167%'
       and not exists (select 1 from public.crm_lost_sales l
                        where l.opportunity_id = o.id and l.outcome = 'lost'
                          and l.is_backfilled and l.category_id is null);
    log := log || extensions.is(n, 0, 'كل فرصة أغلقتها التسوية لها صفّ «مُرحَّل» غير محلَّل');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات التطابق: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $fn$;

-- ===== التحقّق =====
do $$
begin
  raise notice '203: شغّل select * from tests.run_client_journey(); — والمجموعات: run_all, run_lost_sales, run_lost_card_sync, run_lost_analysis_tasks, run_reporting, run_roles, run_privacy, run_write_paths';
end $$;
