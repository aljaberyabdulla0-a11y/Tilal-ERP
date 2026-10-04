-- ============================================================
-- تلال ERP — 142: اختبارات تحليل الخسائر
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_lost_sales();
--
-- نمط 082/100/127: كل شيء في معاملة فرعية تُلغى في النهاية، فلا يترك
-- عميلاً ولا فرصة ولا مهمة. security invoker عمداً.
--
--   الحارسان     لا خسارة من تحديث مباشر، ولا «فشل البيع» على بطاقة لها فرصة مفتوحة
--   الإلزام      الفئة، السبب التابع لها، «أخرى» بشرح، المنافس للمنافسة
--   الإغلاق      المرحلة التي سقطت منها، القيمة وأساسها، المهمة، المرآة، النشاط
--   عدم الفقدان  الفرصة لا تُحذف ولا تتغيّر قيمتها
--   التعديل      سببٌ إلزامي، وكل حقل في السجلّ
--   المراجعة     للمشرف والمدير لا للموظف، والاعتراض بملاحظة
--   التنشيط      الخسارة تبقى، المهمة تُنجَز، الخسارة الثانية رقمها ٢
--   الاسترجاع    ربحٌ بعد خسارة = «استُرجعت» بقيمتها
--   التقارير     الأرقام كما أُدخلت، والموظف يرى خسارته تحت RLS
--   القوائم      الموظف لا يكتب فيها
--   الترحيل      كل فرصة خاسرة لها صفّ
--
-- يتطلب: 082 (tests.act_as)، 140، 141.
-- ============================================================

create or replace function tests.run_lost_sales()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; proj uuid;
  g_neg uuid; g_contact uuid; g_lost uuid; g_won uuid;
  c_price uuid; c_comp uuid; c_other uuid;
  r_m2 uuid; r_other_price uuid; r_comp uuid; r_other_other uuid;
  cli uuid; opp uuid; ls uuid; ls2 uuid; t_id uuid;
  n int; v numeric; txt text; j jsonb; rec record;
  base jsonb;
  i int := 0;
  v_phone text := '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into g_neg     from public.crm_stages where name = 'مناقشة العرض';
  select id into g_contact from public.crm_stages where name = 'اتصال';
  select id into g_lost    from public.crm_stages where stage_type = 'lost' order by sort_order limit 1;
  select id into g_won     from public.crm_stages where stage_type = 'won'  order by sort_order limit 1;
  select id into c_price from public.crm_loss_categories where code = 'price';
  select id into c_comp  from public.crm_loss_categories where code = 'competition';
  select id into c_other from public.crm_loss_categories where code = 'other';
  select id into r_m2          from public.crm_lost_reasons where category_id = c_price and name = 'سعر المتر مرتفع';
  select id into r_other_price from public.crm_lost_reasons where category_id = c_price and is_other;
  select id into r_comp        from public.crm_lost_reasons where category_id = c_comp and name = 'وجد سعراً أفضل';

  if admin_u is null or plain_u is null or proj is null or g_neg is null or g_lost is null or r_m2 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف بملفّ ومشروع ومراحل 070 وبذرة 140'::text;
    return;
  end if;

  begin
    -- ================= التهيئة =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار خسارة', v_phone, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli;
    select id into opp from public.opportunities where client_id = cli and deleted_at is null limit 1;
    if opp is null then
      insert into public.opportunities (client_id, stage_id, owner_id, project_id)
      values (cli, (select id from public.crm_stages where name = 'ليد'), plain_emp, proj) returning id into opp;
    end if;
    update public.opportunities set project_id = proj, expected_value = 300000000, stage_id = g_neg where id = opp;

    base := jsonb_build_object('category_id', c_price, 'reason_id', r_m2, 'loss_source', 'price',
                               'customer_potential', 'A', 'recovery_potential', 'high',
                               'details', 'قارن العميل سعر المتر مع مشروع آخر');

    -- ================= الحارسان =================
    perform tests.act_as(plain_u);
    begin
      update public.opportunities set stage_id = g_lost, lost_reason_id = r_m2 where id = opp;
      log := log || extensions.fail('التحديث المباشر إلى الخسارة مرفوض');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%تحليل سبب فقدان%', 'التحديث المباشر إلى الخسارة مرفوض');
    end;
    begin
      update public.clients set stage = 'فشل البيع' where id = cli;
      log := log || extensions.fail('بطاقة لها فرصة مفتوحة لا تُنقل إلى «فشل البيع»');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%فرصة مفتوحة%', 'بطاقة لها فرصة مفتوحة لا تُنقل إلى «فشل البيع»');
    end;

    -- ================= الإلزام =================
    begin
      perform public.close_opportunity_lost(opp, base - 'category_id');
      log := log || extensions.fail('بلا فئة يُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%الفئة%', 'بلا فئة يُرفض'); end;

    begin
      perform public.close_opportunity_lost(opp, base || jsonb_build_object('reason_id', r_comp));
      log := log || extensions.fail('سببٌ من فئة أخرى يُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%لا يتبع%', 'سببٌ من فئة أخرى يُرفض'); end;

    begin
      perform public.close_opportunity_lost(opp, base || jsonb_build_object('reason_id', r_other_price, 'details', 'غالي'));
      log := log || extensions.fail('«أخرى» بلا شرح مفصّل تُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%شرحاً مفصّلاً%', '«أخرى» بلا شرح مفصّل تُرفض'); end;

    begin
      perform public.close_opportunity_lost(opp, base || jsonb_build_object('category_id', c_comp, 'reason_id', r_comp));
      log := log || extensions.fail('خسارة لمنافس بلا منافس تُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%المنافس%', 'خسارة لمنافس بلا منافس تُرفض'); end;

    begin
      perform public.close_opportunity_lost(opp, base - 'customer_potential');
      log := log || extensions.fail('بلا جودة العميل يُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%جودة العميل%', 'بلا جودة العميل يُرفض'); end;

    log := log || extensions.ok(
      (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = opp) = 'open',
      'المحاولات المرفوضة لم تُغلق الفرصة');

    -- ================= الإغلاق =================
    ls := public.close_opportunity_lost(opp, base);
    select * into rec from public.crm_lost_sales where id = ls;
    log := log || extensions.ok(
      (select stage_id from public.opportunities where id = opp) = g_lost, 'الفرصة صارت خاسرة');
    log := log || extensions.is(rec.lost_stage_name, 'مناقشة العرض', 'المرحلة التي سقطت منها تُلتقط تلقائياً');
    log := log || extensions.ok(rec.lost_value = 300000000 and rec.value_basis = 'deal', 'القيمة الخاسرة من الصفقة وأساسها «deal»');
    log := log || extensions.ok(rec.owner_id = plain_emp and rec.project_id = proj, 'المالك والمشروع مجمَّدان');
    log := log || extensions.ok(rec.recontact_required and rec.recontact_date = public.baghdad_today() + 30,
      'المرتفعة الاسترجاع: موعد بعد ٣٠ يوماً من القاعدة');
    log := log || extensions.ok(
      exists (select 1 from public.tasks where id = rec.recontact_task_id and assigned_to = plain_u
                                          and due_date = rec.recontact_date and opportunity_id = opp),
      'مهمة إعادة التواصل للمالك في موعدها');
    log := log || extensions.is((select stage from public.clients where id = cli), 'فشل البيع',
      'بطاقة العميل تتبع فرصتها الوحيدة');
    log := log || extensions.ok(
      exists (select 1 from public.client_activities where client_id = cli and activity_type = 'تحليل خسارة'),
      'سطر «تحليل خسارة» في تسلسل العميل');
    log := log || extensions.ok(
      (select lost_reason_id from public.opportunities where id = opp) = r_m2, 'السبب على الفرصة لتقارير 076');

    -- ================= عدم الفقدان =================
    log := log || extensions.ok(
      exists (select 1 from public.opportunities where id = opp and deleted_at is null and expected_value = 300000000),
      'الفرصة باقية بقيمتها');
    begin
      perform public.close_opportunity_lost(opp, base);
      log := log || extensions.fail('لا تُغلق الخاسرة مرتين');
    exception when others then log := log || extensions.pass('لا تُغلق الخاسرة مرتين'); end;

    -- ================= التعديل =================
    begin
      perform public.update_lost_analysis(ls, base || jsonb_build_object('customer_potential', 'B'), null);
      log := log || extensions.fail('التعديل بلا سبب يُرفض');
    exception when others then log := log || extensions.ok(sqlerrm like '%سبب التعديل%', 'التعديل بلا سبب يُرفض'); end;

    perform public.update_lost_analysis(ls, base || jsonb_build_object('customer_potential', 'B', 'recovery_potential', 'medium'),
                                        'تبيّن أن ميزانيته أقل');
    log := log || extensions.ok(
      (select count(*) from public.crm_lost_sale_changes
        where lost_sale_id = ls and field in ('customer_potential', 'recovery_potential')
          and changed_by = plain_u and edit_reason = 'تبيّن أن ميزانيته أقل') = 2,
      'كل حقل معدَّل في السجلّ بصاحبه وسببه');
    log := log || extensions.ok(
      (select old_value || '→' || new_value from public.crm_lost_sale_changes
        where lost_sale_id = ls and field = 'recovery_potential') = 'high→medium',
      'القيمة القديمة والجديدة محفوظتان');

    -- الموظف لا يصحّح القيمة؛ المشرف يصحّحها وتصير يدوية
    perform public.update_lost_analysis(ls, base || jsonb_build_object('lost_value', 1), 'محاولة');
    log := log || extensions.ok((select lost_value from public.crm_lost_sales where id = ls) = 300000000,
      'الموظف لا يغيّر القيمة الخاسرة');

    -- ================= المراجعة =================
    begin
      perform public.review_lost_sale(ls, 'confirmed', null);
      log := log || extensions.fail('الموظف لا يراجع خسارته');
    exception when others then log := log || extensions.pass('الموظف لا يراجع خسارته'); end;

    perform tests.act_as(admin_u);
    begin
      perform public.review_lost_sale(ls, 'disputed', '  ');
      log := log || extensions.fail('الاعتراض بلا ملاحظة مرفوض');
    exception when others then log := log || extensions.pass('الاعتراض بلا ملاحظة مرفوض'); end;
    perform public.review_lost_sale(ls, 'confirmed', 'مطابق');
    perform public.update_lost_analysis(ls, base || jsonb_build_object('customer_potential', 'B', 'recovery_potential', 'medium',
                                        'lost_value', 280000000), 'السعر بعد الخصم المعروض');
    select * into rec from public.crm_lost_sales where id = ls;
    log := log || extensions.ok(rec.review_status = 'confirmed' and rec.lost_value = 280000000 and rec.value_basis = 'manual',
      'المدير يراجع ويصحّح القيمة فتصير «manual»');

    -- ================= التقارير =================
    j := public.crm_lost_intelligence(jsonb_build_object('project_id', proj, 'from', public.baghdad_today(), 'to', public.baghdad_today()));
    log := log || extensions.ok((j->'kpis'->>'lost')::int >= 1, 'المؤشّرات تعدّ الخسارة');
    log := log || extensions.ok(
      exists (select 1 from jsonb_array_elements(j->'by_category') e where e->>'code' = 'price' and (e->>'value')::numeric >= 280000000),
      'التفصيل بالفئة يحمل القيمة');
    log := log || extensions.ok(
      exists (select 1 from jsonb_array_elements(j->'by_stage') e where e->>'stage' = 'مناقشة العرض'),
      'التفصيل بالمرحلة');
    log := log || extensions.ok(
      exists (select 1 from jsonb_array_elements(j->'recoverable') e where (e->>'opportunity_id')::uuid = opp),
      'القابلة للاسترجاع تحمل الفرصة');
    log := log || extensions.ok(
      (j->'kpis'->>'total')::int = (j->'kpis'->>'won')::int + (j->'kpis'->>'lost')::int + (j->'kpis'->>'open')::int,
      'الإجمالي = رابحة + خاسرة + مفتوحة');
    j := public.crm_lost_intelligence(jsonb_build_object('project_id', proj, 'category_id', c_comp,
                                                         'from', public.baghdad_today(), 'to', public.baghdad_today()));
    log := log || extensions.ok(
      not exists (select 1 from jsonb_array_elements(j->'by_category') e where e->>'code' = 'price'),
      'مُرشِّح الفئة يضيّق الخسائر');

    perform tests.act_as(plain_u);
    set local role authenticated;
    select count(*) into n from public.v_crm_lost_sales where id = ls;
    j := public.crm_lost_intelligence(jsonb_build_object('owner_id', plain_emp, 'from', public.baghdad_today()));
    reset role;
    log := log || extensions.ok(n = 1 and (j->'kpis'->>'lost')::int >= 1, 'الموظف يرى خسارته وتقريرها تحت RLS');

    set local role authenticated;
    begin
      insert into public.crm_loss_categories (code, name_ar, name_en) values ('x_test', 'تجربة', 'Test');
      reset role;
      log := log || extensions.fail('الموظف لا يكتب في قوائم الخسارة');
    exception when others then
      reset role;
      log := log || extensions.pass('الموظف لا يكتب في قوائم الخسارة');
    end;
    set local role authenticated;
    begin
      update public.crm_lost_sales set details = 'تلاعب' where id = ls;
      get diagnostics n = row_count;
      reset role;
      log := log || extensions.ok(n = 0, 'لا تعديل مباشر على الخسارة — الدوال وحدها');
    exception when others then
      reset role;
      log := log || extensions.pass('لا تعديل مباشر على الخسارة — الدوال وحدها');
    end;

    -- ================= التنشيط =================
    begin
      perform public.reactivate_lost_opportunity(opp, g_contact, '', null, public.baghdad_today() + 2);
      log := log || extensions.fail('التنشيط بلا سبب يُرفض');
    exception when others then log := log || extensions.pass('التنشيط بلا سبب يُرفض'); end;

    t_id := (select recontact_task_id from public.crm_lost_sales where id = ls);
    perform public.reactivate_lost_opportunity(opp, g_contact, 'اتصل يسأل عن خصم جديد', 'عرض خطة دفع', public.baghdad_today() + 2);
    select * into rec from public.crm_lost_sales where id = ls;
    log := log || extensions.ok(rec.outcome = 'reactivated' and rec.reactivation_note = 'اتصل يسأل عن خصم جديد',
      'الخسارة تبقى «أُعيد تنشيطها» بسببها');
    log := log || extensions.ok(
      (select stage_id = g_contact and lost_reason_id is null and next_action_date = public.baghdad_today() + 2
         from public.opportunities where id = opp),
      'الفرصة مفتوحة بخطوة قادمة وبلا سبب خسارة حالي');
    log := log || extensions.is((select status from public.tasks where id = t_id), 'منجزة', 'مهمة إعادة التواصل أُنجزت');
    log := log || extensions.ok(
      exists (select 1 from public.client_activities where client_id = cli and activity_type = 'إعادة تنشيط'),
      'سطر «إعادة تنشيط» في التسلسل');

    -- ================= خسارة ثانية لمنافس =================
    ls2 := public.close_opportunity_lost(opp, base || jsonb_build_object(
             'category_id', c_comp, 'reason_id', r_comp, 'loss_source', 'competition',
             'recovery_potential', 'none', 'competitor_name', 'منافس تجريبي',
             'competitor_price_per_m2', 1950000, 'recontact_required', true));
    select * into rec from public.crm_lost_sales where id = ls2;
    log := log || extensions.ok(rec.loss_no = 2 and rec.lost_stage_name = 'اتصال', 'الخسارة الثانية رقمها ٢ ومن مرحلتها');
    log := log || extensions.ok(not rec.recontact_required and rec.recontact_date is null,
      '«لا استرجاع» لا يقبل موعد تواصل');
    log := log || extensions.is((select outcome from public.crm_lost_sales where id = ls), 'relost', 'الأولى «خُسرت مجدداً»');

    -- ================= الاسترجاع =================
    perform public.reactivate_lost_opportunity(opp, g_neg, 'عاد بعد أن تراجع المنافس', null, public.baghdad_today());
    perform tests.act_as(admin_u);
    update public.opportunities set stage_id = g_won, won_value = 290000000 where id = opp;
    select * into rec from public.crm_lost_sales where id = ls2;
    log := log || extensions.ok(rec.outcome = 'recovered' and rec.recovered_value = 290000000,
      'ربحٌ بعد خسارة = «استُرجعت» بقيمة الفوز');
    j := public.crm_client_sales_history(cli);
    log := log || extensions.ok((j->>'won')::int = 1 and (j->>'recovered')::int = 1 and jsonb_array_length(j->'losses') = 2,
      'تاريخ مبيعات العميل: رابحة واحدة مسترجعة وخسارتان محفوظتان');

    -- ================= الترحيل =================
    perform tests.act_as(null);
    select count(*) into n
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where g.stage_type = 'lost' and o.deleted_at is null
       and not exists (select 1 from public.crm_lost_sales l where l.opportunity_id = o.id and l.outcome = 'lost');
    log := log || extensions.is(n, 0, 'كل فرصة خاسرة لها صفّ خسارة قائم');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الخسائر: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_lost_sales() is
  'اختبارات تحليل الخسائر: الحارسان، الإلزام، الإغلاق، عدم الفقدان، التعديل والسجلّ، المراجعة، التنشيط، الاسترجاع، التقارير وRLS، الترحيل. يُلغي أثره (sql/142).';

revoke all on function tests.run_lost_sales() from public;
grant execute on function tests.run_lost_sales() to service_role;
