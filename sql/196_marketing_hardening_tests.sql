-- ============================================================
-- Tilal ERP — 196: tests for 195 (closing the marketing gaps)
-- Copy this whole file and paste it into: Supabase ← SQL Editor ← New query ← Run
--
--   select * from tests.run_marketing_hardening();
--
-- Rolls back its own effects (RLBCK), in the style of 127. Requires: 082 (tests.act_as), 195.
-- ============================================================

create or replace function tests.run_marketing_hardening()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; old_pos uuid; pos_designer uuid; proj uuid; ch_fb uuid;
  plan uuid; camp uuid; camp2 uuid; appr uuid; ex uuid; acc uuid; ad uuid; it uuid; cli_b uuid; cli_s uuid;
  n int; txt text; j jsonb;
  i int := 0;
  v_phone text := '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id, e.position_id into plain_u, plain_emp, old_pos
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active'
     and public.mkt_role_for_position(e.position_id) is null
   order by p.created_at limit 1;
  select id into pos_designer from public.positions where code = 'MKT-DESIGNER';
  select id into proj from public.projects order by created_at limit 1;
  select id into ch_fb from public.mkt_channels where utm_source = 'facebook' and utm_medium = 'paid_social';

  if admin_u is null or plain_u is null or pos_designer is null or proj is null or ch_fb is null then
    return query select 0, 'not ok', 'بيئة ناقصة: مدير، موظف خارج التسويق، منصب MKT-DESIGNER، مشروع، قناة فيسبوك'::text;
    return;
  end if;

  begin
    -- ================= the team follows HR =================
    perform tests.act_as(null);
    delete from public.mkt_team where employee_id = plain_emp;
    update public.employees set position_id = pos_designer where id = plain_emp;
    log := log || extensions.ok(
      exists (select 1 from public.mkt_team where employee_id = plain_emp and is_active
                and mkt_role = 'مصمّم' and source = 'الموارد البشرية'),
      'تعيين الموظف في منصب تسويقي يضمّه إلى الفريق بدوره');
    update public.employees set position_id = old_pos where id = plain_emp;
    log := log || extensions.ok(
      exists (select 1 from public.mkt_team where employee_id = plain_emp and not is_active),
      'مغادرة المنصب التسويقي تُوقف عضويته');
    log := log || extensions.ok(
      not exists (select 1 from public.employees e
                   where e.status = 'active' and public.mkt_role_for_position(e.position_id) is not null
                     and not exists (select 1 from public.mkt_team t where t.employee_id = e.id and t.is_active)),
      'كل موظف في منصب تسويقي عضوٌ فعّال في الفريق (الترحيل)');

    -- a team member (manual)
    update public.mkt_team set is_active = true, mkt_role = 'أخصائي تسويق', source = 'يدوي' where employee_id = plain_emp;

    -- ================= the plan =================
    perform tests.act_as(plain_u);
    insert into public.mkt_plans (kind, title, period_start, period_end, budget, status)
    values ('خطة شهرية', 'خطة اختبار', '2020-02-01', '2020-02-29', 1000000, 'معتمدة') returning id into plan;
    log := log || extensions.is((select status from public.mkt_plans where id = plan), 'مسودة',
      'الخطة تولد مسودة ولو طُلب غير ذلك');
    begin
      update public.mkt_plans set status = 'معتمدة' where id = plan;
      log := log || extensions.fail('عضو الفريق لا يعتمد الخطة بتعديل حالتها');
    exception when others then log := log || extensions.pass('عضو الفريق لا يعتمد الخطة بتعديل حالتها'); end;
    appr := public.mkt_request_approval('خطة', plan);
    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    log := log || extensions.ok((select status = 'معتمدة' and approved_at is not null from public.mkt_plans where id = plan),
      'الخطة تُعتمد بالموافقة');

    -- ================= freezing the approved amount =================
    perform tests.act_as(plain_u);
    insert into public.crm_campaigns (name, project_id, channel_id, budget)
    values ('اختبار تجميد ' || v_phone, proj, ch_fb, 1000000) returning id into camp;
    appr := public.mkt_request_approval('حملة', camp);
    begin
      update public.crm_campaigns set budget = 9000000 where id = camp;
      log := log || extensions.fail('لا تعديل للمبلغ أثناء انتظار الموافقة');
    exception when others then log := log || extensions.pass('لا تعديل للمبلغ أثناء انتظار الموافقة'); end;

    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    perform tests.act_as(plain_u);
    begin
      update public.crm_campaigns set budget = 90000000 where id = camp;
      log := log || extensions.fail('عضو الفريق لا يرفع ميزانية حملة معتمدة');
    exception when others then log := log || extensions.pass('عضو الفريق لا يرفع ميزانية حملة معتمدة'); end;
    update public.crm_campaigns set budget = 800000 where id = camp;
    log := log || extensions.is((select budget from public.crm_campaigns where id = camp), 800000::numeric,
      'خفض الميزانية المعتمدة مسموح');

    perform tests.act_as(null);
    update public.mkt_team set mkt_role = 'مدير التسويق' where employee_id = plain_emp;
    perform tests.act_as(plain_u);
    update public.crm_campaigns set budget = 5000000 where id = camp;
    log := log || extensions.is((select budget from public.crm_campaigns where id = camp), 5000000::numeric,
      'مدير التسويق يرفعها في حدود اعتماده');
    begin
      update public.crm_campaigns set budget = 15000000 where id = camp;
      log := log || extensions.fail('فوق ١٠ ملايين يرفعها المدير وحده');
    exception when others then log := log || extensions.pass('فوق ١٠ ملايين يرفعها المدير وحده'); end;

    -- ================= the manager's own request goes up to the admin =================
    insert into public.crm_campaigns (name, project_id, channel_id, budget)
    values ('اختبار طلب المدير ' || v_phone, proj, ch_fb, 1000000) returning id into camp2;
    appr := public.mkt_request_approval('حملة', camp2);
    log := log || extensions.ok(
      (select approver = 'المدير' and escalated_reason like '%فصل الواجبات%' from public.mkt_approvals where id = appr),
      'طلب مدير التسويق نفسه يرتفع إلى المدير');

    -- ================= permissions =================
    perform tests.act_as(null);
    update public.mkt_team set mkt_role = 'أخصائي تسويق' where employee_id = plain_emp;
    perform tests.act_as(plain_u);
    insert into public.crm_campaigns (name) values ('اختبار حذف ' || v_phone);
    set local role authenticated;
    delete from public.crm_campaigns where name = 'اختبار حذف ' || v_phone;
    get diagnostics n = row_count;
    reset role;
    log := log || extensions.is(n, 0, 'عضو الفريق لا يحذف حملة');
    set local role authenticated;
    begin
      insert into public.mkt_channels (name, mode, utm_source, utm_medium) values ('قناة اختبار', 'رقمي', 'zz', 'zz');
      reset role;
      log := log || extensions.fail('عضو الفريق لا يضيف قناة');
    exception when others then reset role; log := log || extensions.pass('عضو الفريق لا يضيف قناة'); end;
    begin
      perform public.mkt_sync_begin((select id from public.mkt_integrations limit 1));
      log := log || extensions.fail('سجلّ المزامنة لا يُكتب بجلسة مستخدم');
    exception when others then log := log || extensions.pass('سجلّ المزامنة لا يُكتب بجلسة مستخدم'); end;

    -- ================= approved expense: changing its campaign brings it back to draft =================
    insert into public.mkt_expenses (expense_date, category, description, amount, campaign_id)
    values ('2020-02-10', 'إعلانات ميتا', 'اختبار', 100000, camp) returning id into ex;
    appr := public.mkt_request_approval('مصروف', ex);
    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    perform tests.act_as(plain_u);
    update public.mkt_expenses set campaign_id = camp2 where id = ex;
    log := log || extensions.is((select status from public.mkt_expenses where id = ex), 'مسودة',
      'تغيير حملة المصروف المعتمد يعيده مسودة');

    -- ================= the marketing lead and the honest channel =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, source, original_source_id, latest_source_id)
    values ('اختبار مكتب', '0772' || right(v_phone, 7), 'مكتب عقاري',
            (select id from public.crm_sources where name = 'مكتب عقاري'), (select id from public.crm_sources where name = 'مكتب عقاري'))
    returning id into cli_b;
    insert into public.clients (name, phone, source, original_source_id, latest_source_id)
    values ('اختبار سوشيل', '0773' || right(v_phone, 7), 'سوشيل ميديا',
            (select id from public.crm_sources where name = 'سوشيل ميديا'), (select id from public.crm_sources where name = 'سوشيل ميديا'))
    returning id into cli_s;
    log := log || extensions.ok(
      (select not is_marketing from public.mkt_lead_facts(v_today, v_today) where client_id = cli_b)
      and (select is_marketing from public.mkt_lead_facts(v_today, v_today) where client_id = cli_s),
      'ليد المكتب العقاري خارج التسويق، وليد السوشيل منه');
    log := log || extensions.ok(
      (select c.is_fallback from public.mkt_lead_facts(v_today, v_today) f
         join public.mkt_channels c on c.id = f.channel_id where f.client_id = cli_s),
      'ليد السوشيل بلا لمسة على «قناة غير محدّدة» لا فيسبوك');
    j := public.mkt_kpis(v_today, v_today);
    log := log || extensions.ok((j->>'all_leads')::int - (j->>'leads')::int >= 1 and j ? 'service_income' and j ? 'net_result',
      'المؤشّرات تفصل ليدات التسويق عن غيرها وتحمل إيراد خدمات التسويق');
    select count(*) into n from public.mkt_lead_followup(v_today, v_today);
    log := log || extensions.ok(n >= 1, 'متابعة ليدات التسويق بالموظف تعمل');

    -- ================= the landing page and the Meta ad =================
    insert into public.mkt_landing_pages (slug, title, status, whatsapp_phone, hero_image_url)
    values ('zz-test-' || right(v_phone, 6), 'اختبار', 'منشورة', '07701234567', 'https://example.com/a.jpg');
    j := public.mkt_landing_public('zz-test-' || right(v_phone, 6));
    log := log || extensions.ok(j->>'whatsapp' = '9647701234567' and j->>'hero_image_url' like 'https://%',
      'صفحة الهبوط تحمل واتساب بصيغة دولية وصورة');

    insert into public.mkt_accounts (kind, channel_id, name) values ('حساب إعلانات', ch_fb, 'حساب اختبار') returning id into acc;
    insert into public.mkt_ad_objects (level, account_id, campaign_id, name, external_id)
    values ('حملة إعلانية', acc, camp, 'إعلان اختبار', 'zz' || v_phone) returning id into ad;
    insert into public.crm_lead_intake (provider, external_id, raw, name, phone)
    values ('meta', 'lead-' || v_phone,
            jsonb_build_object('utm', jsonb_build_object('utm_source', 'facebook', 'utm_medium', 'paid_social'),
                               'mkt', jsonb_build_object('ad_object_id', ad)),
            'ليد نموذج ميتا', '0774' || right(v_phone, 7))
    returning id into it;
    perform public.intake_lead(it);
    log := log || extensions.ok(
      exists (select 1 from public.mkt_touchpoints t where t.intake_id = it and t.ad_object_id = ad
                and t.campaign_id = camp and t.touch_type = 'نموذج'),
      'ليد نموذج ميتا: لمسة «نموذج» على إعلانه وحملته');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات 195: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_marketing_hardening() is
  'اختبارات 195: الفريق من الموارد البشرية، حارس الخطة، تجميد المبلغ المعتمد، طلب المدير نفسه، الصلاحيات، ليد التسويق والقناة الصادقة، المتابعة، صفحة الهبوط، ليد ميتا. يُلغي أثره.';

revoke all on function tests.run_marketing_hardening() from public;
grant execute on function tests.run_marketing_hardening() to service_role;
