-- ============================================================
-- تلال ERP — 178: اختبارات مهام «استمارة فشل البيع» (تحلّ محلّ 176)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_lost_analysis_tasks();
--
-- نمط 082/142: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الحيّة      كل خسارة بلا تحليل لها مسؤول ⇒ مهمة مفتوحة واحدة
--   الحيّة ٢    كل صاحب مهمة يرى خسارتها ويملك فرصتها — تحت RLS (177)
--   الإنشاء     خسارة بلا تحليل ⇒ مهمة لمن نقلها حين لا مالك، مربوطة بالفرصة
--   المحلَّلة    خسارة بالنموذج لا تنشئ مهمة
--   الحارس      الموظف لا يعلّمها منجزة ولا يفكّ ربطها
--   الإنجاز     حفظ الاستمارة يُنجز المهمة وحده
--   الإلغاء     تنشيط الفرصة يلغي مهمتها
--   التكرار     لا مهمة ثانية لخسارة لها مهمة مفتوحة
--   المُعاد إسناده  مالك الفرصة ترك العمل ⇒ المهمة لمالك العميل الحالي، وحفظه يُقبل
--
-- يتطلب: 082 (tests.act_as)، 140، 175، 177.
-- ============================================================

create or replace function tests.run_lost_analysis_tasks()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; proj uuid; gone_emp uuid;
  g_neg uuid; g_lost uuid;
  c_price uuid; r_m2 uuid;
  cli uuid; opp uuid; ls uuid; t_id uuid;
  v public.crm_lost_sales%rowtype;
  rec record; u record; n int; n_bad int; txt text; base jsonb;
  i int := 0;
  v_phone text := '0773' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into gone_emp from public.employees where status <> 'active' order by created_at limit 1;
  select id into g_neg  from public.crm_stages where name = 'مناقشة العرض';
  select id into g_lost from public.crm_stages where stage_type = 'lost' order by sort_order limit 1;
  select id into c_price from public.crm_loss_categories where code = 'price';
  select id into r_m2    from public.crm_lost_reasons where category_id = c_price and name = 'سعر المتر مرتفع';

  if admin_u is null or plain_u is null or proj is null or g_neg is null or g_lost is null or r_m2 is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف بملفّ ومشروع ومراحل 070 وبذرة 140'::text;
    return;
  end if;

  begin
    -- ================= الحيّة =================
    select count(*) into n
      from public.crm_lost_sales l
      join public.opportunities o on o.id = l.opportunity_id and o.deleted_at is null
     where l.outcome = 'lost' and l.category_id is null
       and public.crm_lost_analysis_assignee(l.id) is not null
       and (select count(*) from public.tasks t
             where t.analysis_lost_sale_id = l.id and t.status in ('جديدة', 'قيد التنفيذ')) <> 1;
    log := log || extensions.is(n, 0, 'كل خسارة بلا تحليل لها مسؤول لها مهمة مفتوحة واحدة');

    -- ================= الحيّة ٢: كل صاحب مهمة يستطيع ملأها =================
    -- هذا ما كشف ٢٠ مهمة لمشرفة لا ترى عملاءها (177)
    n_bad := 0;
    for u in select distinct t.assigned_to as uid from public.tasks t
              where t.analysis_lost_sale_id is not null and t.status in ('جديدة', 'قيد التنفيذ') loop
      perform tests.act_as(u.uid);
      execute 'set local role authenticated';
      select n_bad + count(*) into n_bad
        from public.tasks t
       where t.assigned_to = u.uid and t.analysis_lost_sale_id is not null
         and t.status in ('جديدة', 'قيد التنفيذ')
         and (not exists (select 1 from public.v_crm_lost_sales x
                           where x.id = t.analysis_lost_sale_id and x.needs_analysis)
              or not public.crm_can_edit_opportunity(t.opportunity_id));
      execute 'reset role';
    end loop;
    perform tests.act_as(null);
    log := log || extensions.is(n_bad, 0, 'كل صاحب مهمة استمارة يرى خسارتها ويملك فرصتها (تحت RLS)');

    -- ================= التهيئة =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار مهمة استمارة', v_phone, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli;
    select id into opp from public.opportunities where client_id = cli and deleted_at is null limit 1;
    if opp is null then
      insert into public.opportunities (client_id, stage_id, owner_id, project_id)
      values (cli, (select id from public.crm_stages where name = 'ليد'), plain_emp, proj) returning id into opp;
    end if;
    update public.opportunities set project_id = proj, expected_value = 100000000, stage_id = g_neg where id = opp;

    base := jsonb_build_object('category_id', c_price, 'reason_id', r_m2, 'loss_source', 'price',
                               'customer_potential', 'B', 'recovery_potential', 'none',
                               'details', 'اختبار مهمة الاستمارة');

    -- ================= المحلَّلة لا تنشئ مهمة =================
    ls := public.close_opportunity_lost(opp, base);
    log := log || extensions.is(
      (select count(*)::int from public.tasks where analysis_lost_sale_id = ls), 0,
      'خسارة حُلّلت بالنموذج لا تنشئ مهمة استمارة');

    -- ================= الإنشاء: خسارة بلا تحليل وبلا مالك =================
    -- كما في تسوية 167: الفرصة خاسرة، والصفّ مُرحَّل، والمسؤول من نقل البطاقة
    perform tests.act_as(null);
    delete from public.crm_lost_sales where id = ls;
    v := public.crm_build_lost_row(opp, g_neg, now());
    v.is_backfilled := true;
    v.owner_id      := null;
    v.lost_by       := plain_u;
    insert into public.crm_lost_sales select v.*;
    ls := v.id;

    select * into rec from public.tasks where analysis_lost_sale_id = ls;
    t_id := rec.id;
    log := log || extensions.ok(
      rec.id is not null and rec.assigned_to = plain_u and rec.opportunity_id = opp and rec.client_id = cli
      and rec.status = 'جديدة' and rec.due_date = public.baghdad_today() + 7,
      'خسارة بلا تحليل وبلا مالك ⇒ مهمة لمن نقلها، مربوطة بالفرصة والعميل، بعد أسبوع');

    -- ================= التكرار =================
    log := log || extensions.is(public.crm_create_lost_analysis_task(ls), t_id,
      'لا مهمة ثانية لخسارة لها مهمة مفتوحة');

    -- ================= الحارس =================
    perform tests.act_as(plain_u);
    begin
      update public.tasks set status = 'منجزة' where id = t_id;
      log := log || extensions.fail('الموظف لا يعلّم مهمة الاستمارة منجزة قبل ملئها');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%املأ استمارة فشل البيع أولاً%',
        'الموظف لا يعلّم مهمة الاستمارة منجزة قبل ملئها');
    end;
    begin
      update public.tasks set analysis_lost_sale_id = null where id = t_id;
      log := log || extensions.fail('الموظف لا يفكّ ربط المهمة بالخسارة');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا يُفكّ ربطها%', 'الموظف لا يفكّ ربط المهمة بالخسارة');
    end;
    update public.tasks set status = 'قيد التنفيذ' where id = t_id;
    log := log || extensions.is((select status from public.tasks where id = t_id), 'قيد التنفيذ',
      '«بدء التنفيذ» مسموح');

    -- ================= الإنجاز =================
    perform public.update_lost_analysis(ls, base, null);
    log := log || extensions.ok(
      (select status = 'منجزة' and completed_at is not null from public.tasks where id = t_id),
      'حفظ الاستمارة يُنجز المهمة وحده');

    -- ================= الإلغاء بالتنشيط =================
    perform tests.act_as(null);
    delete from public.crm_lost_sales where opportunity_id = opp;
    v := public.crm_build_lost_row(opp, g_neg, now());
    v.is_backfilled := true;
    insert into public.crm_lost_sales select v.*;
    ls := v.id;
    select id into t_id from public.tasks where analysis_lost_sale_id = ls and status = 'جديدة';
    log := log || extensions.ok(t_id is not null, 'المالك على رأس عمله ⇒ المهمة له');

    perform tests.act_as(admin_u);
    update public.opportunities set stage_id = g_neg where id = opp;
    log := log || extensions.is((select status from public.tasks where id = t_id), 'ملغاة',
      'تنشيط الفرصة يلغي مهمة استمارتها');

    -- ================= المُعاد إسناده: مالك الفرصة ترك العمل =================
    -- العميل أُسند إلى غيره، والفرصة بقيت باسم الراحل (177)
    if gone_emp is not null then
      ls := public.close_opportunity_lost(opp, base);
      perform tests.act_as(null);
      delete from public.crm_lost_sales where opportunity_id = opp;
      update public.opportunities set owner_id = gone_emp where id = opp;
      update public.clients set owner_id = plain_emp where id = cli;
      v := public.crm_build_lost_row(opp, g_neg, now());
      v.is_backfilled := true;
      v.owner_id      := gone_emp;   -- المالك المجمَّد هو الراحل، أياً كانت مزامنة الملكية
      v.lost_by       := null;
      insert into public.crm_lost_sales select v.*;
      ls := v.id;
      select id into t_id from public.tasks where analysis_lost_sale_id = ls and status = 'جديدة';
      log := log || extensions.ok(
        (select assigned_to = plain_u from public.tasks where id = t_id),
        'مالك الفرصة ترك العمل ⇒ المهمة لمالك العميل الحالي');

      perform tests.act_as(plain_u);
      perform public.update_lost_analysis(ls, base, null);
      log := log || extensions.is((select status from public.tasks where id = t_id), 'منجزة',
        'مالك العميل الحالي يحفظ الاستمارة بإذن المهمة، فتُنجَز');
    else
      log := log || extensions.pass('مالك الفرصة ترك العمل (لا موظف غير فعّال للاختبار)');
      log := log || extensions.pass('مالك العميل الحالي يحفظ الاستمارة (لا موظف غير فعّال للاختبار)');
    end if;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات مهام الاستمارة: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_lost_analysis_tasks() is
  'اختبارات مهام «استمارة فشل البيع»: الإنشاء والمسؤول، الحارس، الإنجاز بالحفظ، الإلغاء بالتنشيط، عدم التكرار، قدرة كل صاحب مهمة على ملئها، العميل المُعاد إسناده (sql/178). يُلغي أثره.';

revoke all on function tests.run_lost_analysis_tasks() from public;
grant execute on function tests.run_lost_analysis_tasks() to service_role;
