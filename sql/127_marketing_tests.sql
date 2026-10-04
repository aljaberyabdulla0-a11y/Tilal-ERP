-- ============================================================
-- تلال ERP — 127: اختبارات التسويق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_marketing();
--
-- ===== العزل =====
--
-- نمط 082/100/115: كل شيء داخل معاملة فرعية تُلغى في النهاية، وتواريخ
-- المال في فبراير ٢٠٢٠ — قبل أول قيد حقيقي. الأدوار التي لا مستخدم لها
-- (عضو فريق تسويق، محاسب، مُطالِع) تُمنح مؤقتاً لموظف داخل المعاملة
-- الملغاة. لا يترك بيانات.
--
-- ===== ما يُختبر =====
--
--   الأدوار      الفريق يفتح القسم، المدير يعتمد، الموظف خارجه لا يرى
--   الحملة       الرمز، الحالة الأولى، الاعتماد بالموافقة وحدها، فصل الواجبات،
--                التصعيد بالمبلغ، الحذف الممنوع
--   المال        المصروف ← موافقة ← دفع (cash_moves 5700 / 1100)، المصروف
--                المحسوب على الحملة، منع التعديل، الإلغاء بحركة معاكسة،
--                التصعيد عند تجاوز الميزانية، ربط حركة قائمة بلا ترحيل ثانٍ
--   الميزانية    المحاذاة، الاعتماد، الحالة والتنبيه
--   المواد       الصرف بكلفته على الحملة، ولا صرف فوق الرصيد
--   التتبّع      UTM من الحملة والقناة، النقرة بلا تكرار، UTM مكرّر مرفوض
--   النموذج      رقم فاسد، فخّ الروبوت، ليد حقيقي ← عميل ← لمسات
--   البوّابة     ترجمة utm_campaign إلى اسم الحملة
--   الإسناد      الأولى، الأخيرة، الخطّي، الموضعي، المتناقص — والأوزان = ١
--   المحتوى      النسخ، والنشر قبل الاعتماد
--   المؤثر       لا عقد قبل الاعتماد
--   التحليل      المؤشّرات، التفصيل، القمع، الجودة، البحث
--   الأتمتة      قاعدة تُطلق مرّة لا مرّتين
--   التكاملات    المفتاح لمدير التسويق، ولا يُقرأ من الواجهة
--   RLS          الموظف خارج الفريق لا يرى مصروفاً تحت دور authenticated
--
-- security invoker عمداً (نفس سبب 084/100/115).
--
-- يتطلب: 082 (tests.act_as)، 115 (tests.jl)، 121، 122، 124–126.
-- ============================================================

create or replace function tests.run_marketing()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; proj uuid;
  ch_fb uuid; ch_land uuid;
  camp uuid; camp2 uuid; camp_code text; appr uuid;
  ex uuid; ex2 uuid; cm uuid; je uuid; n int; n2 int; v numeric; txt text; j jsonb;
  bud uuid; lnk uuid; url text; lp uuid; cli uuid; it uuid; item uuid;
  cnt uuid; deal uuid; inf uuid; integ uuid;
  sale record; tA uuid; tB uuid;
  i int := 0;
  v_phone text := '0770' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into ch_fb   from public.mkt_channels where utm_source = 'facebook' and utm_medium = 'paid_social';
  select id into ch_land from public.mkt_channels where utm_source = 'landing';

  if admin_u is null or plain_u is null or proj is null or ch_fb is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف بملفّ ومشروع وقناة فيسبوك'::text;
    return;
  end if;

  begin
    -- ================= الأدوار =================
    perform tests.act_as(plain_u);
    log := log || extensions.ok(not public.can_read_marketing(), 'الموظف خارج الفريق لا يفتح التسويق');

    perform tests.act_as(null);
    insert into public.mkt_team (employee_id, mkt_role) values (plain_emp, 'أخصائي تسويق')
    on conflict (employee_id) do update set mkt_role = 'أخصائي تسويق', is_active = true;

    perform tests.act_as(plain_u);
    log := log || extensions.ok(public.can_write_marketing() and not public.is_marketing_manager(),
      'عضو الفريق يكتب في القسم ولا يعتمد');

    -- ================= الحملة =================
    insert into public.crm_campaigns (name, project_id, channel_id, budget, start_date, end_date, expected_leads)
    values ('اختبار تسويق ' || v_phone, proj, ch_fb, 5000000, '2020-02-01', '2020-03-01', 1)
    returning id, code into camp, camp_code;
    log := log || extensions.ok(camp_code ~ '^cmp-[0-9]{4}$', 'الحملة تأخذ رمزاً تلقائياً: ' || camp_code);
    log := log || extensions.is((select status from public.crm_campaigns where id = camp), 'مسودة',
      'الحملة الجديدة مسودة');

    begin
      update public.crm_campaigns set status = 'معتمدة' where id = camp;
      log := log || extensions.fail('عضو الفريق لا يعتمد الحملة بتعديل الحالة');
    exception when others then log := log || extensions.pass('عضو الفريق لا يعتمد الحملة بتعديل الحالة'); end;

    appr := public.mkt_request_approval('حملة', camp, 'اختبار');
    log := log || extensions.ok(
      (select approver from public.mkt_approvals where id = appr) = 'مدير التسويق'
      and (select status from public.crm_campaigns where id = camp) = 'بانتظار الموافقة',
      'طلب الموافقة: المعتمِد مدير التسويق، والحملة بانتظار الموافقة');

    begin
      perform public.mkt_decide_approval(appr, true);
      log := log || extensions.fail('من طلب لا يعتمد');
    exception when others then log := log || extensions.pass('من طلب لا يعتمد'); end;

    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    log := log || extensions.ok(
      (select status = 'معتمدة' and approved_at is not null from public.crm_campaigns where id = camp),
      'المدير يعتمد ← الحملة معتمدة بتاريخ اعتماد');

    perform tests.act_as(plain_u);
    update public.crm_campaigns set status = 'نشطة' where id = camp;
    log := log || extensions.ok((select is_active from public.crm_campaigns where id = camp),
      'الحملة المعتمدة تُفعَّل، و is_active يتبع الحالة');

    insert into public.crm_campaigns (name, project_id, channel_id, budget)
    values ('اختبار كبيرة ' || v_phone, proj, ch_fb, 20000000) returning id into camp2;
    appr := public.mkt_request_approval('حملة', camp2);
    log := log || extensions.is((select approver from public.mkt_approvals where id = appr), 'المدير',
      'حملة ٢٠ مليوناً ترتفع إلى المدير');

    -- ================= المصروف ← الدفتر =================
    insert into public.mkt_expenses (expense_date, category, description, amount, campaign_id, channel_id, project_id)
    values ('2020-02-10', 'إعلانات ميتا', 'اختبار مصروف', 500000, camp, ch_fb, proj) returning id into ex;
    begin
      update public.mkt_expenses set status = 'معتمد' where id = ex;
      log := log || extensions.fail('المصروف لا يُعتمد بتعديل حالته');
    exception when others then log := log || extensions.pass('المصروف لا يُعتمد بتعديل حالته'); end;

    appr := public.mkt_request_approval('مصروف', ex);
    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    log := log || extensions.is((select status from public.mkt_expenses where id = ex), 'معتمد', 'المصروف المعتمد');

    perform tests.act_as(plain_u);
    begin
      perform public.mkt_pay_expense(ex, 'نقد', null, 'التسويق', '2020-02-10');
      log := log || extensions.fail('التسويق لا يدفع');
    exception when others then log := log || extensions.pass('التسويق لا يدفع — المالية وحدها'); end;

    perform tests.act_as(admin_u);
    cm := public.mkt_pay_expense(ex, 'نقد', null, 'التسويق', '2020-02-10');
    select journal_entry_id into je from public.cash_moves where id = cm;
    log := log || extensions.ok(tests.jl(je, '5700') = 500000 and tests.jl(je, '1100') = -500000,
      'الدفع يكتب الحركة، ومحفّزها القائم يكتب القيد 5700 / 1100');
    log := log || extensions.ok(
      (select category = 'تسويق وإعلان' and project_id = proj from public.cash_moves where id = cm),
      'الحركة بتصنيف «تسويق وإعلان» وعلى مشروع الحملة');
    log := log || extensions.is((select spent from public.crm_campaigns where id = camp), 500000::numeric,
      'مصروف الحملة يُحسب من المدفوع');

    begin
      update public.mkt_expenses set amount = 1 where id = ex;
      log := log || extensions.fail('المصروف المدفوع لا يُعدَّل مبلغه');
    exception when others then log := log || extensions.pass('المصروف المدفوع لا يُعدَّل مبلغه'); end;
    begin
      update public.crm_campaigns set spent = 1 where id = camp;
      log := log || extensions.fail('المصروف اليدوي على حملةٍ لها مدفوع مرفوض');
    exception when others then log := log || extensions.pass('المصروف اليدوي على حملةٍ لها مدفوع مرفوض'); end;
    begin
      delete from public.crm_campaigns where id = camp;
      log := log || extensions.fail('حملة عليها مصروف لا تُحذف');
    exception when others then log := log || extensions.pass('حملة عليها مصروف لا تُحذف'); end;

    perform public.mkt_void_expense(ex, 'اختبار استرداد', 'نقد', '2020-02-12');
    select journal_entry_id into je from public.cash_moves
     where id = (select void_cash_move_id from public.mkt_expenses where id = ex);
    log := log || extensions.ok(tests.jl(je, '5700') = -500000 and tests.jl(je, '1100') = 500000,
      'إلغاء المدفوع حركةٌ معاكسة (1100 / 5700) لا حذف');
    log := log || extensions.ok(
      (select status = 'ملغى' from public.mkt_expenses where id = ex)
      and (select spent from public.crm_campaigns where id = camp) = 0
      and exists (select 1 from public.cash_moves where id = cm),
      'المصروف ملغى، والحملة صفر، والحركة الأصلية باقية بتاريخها');

    -- تجاوز ميزانية الحملة يرفع الطلب إلى المدير
    update public.crm_campaigns set budget = 1000000 where id = camp;
    perform tests.act_as(plain_u);
    insert into public.mkt_expenses (expense_date, category, description, amount, campaign_id)
    values ('2020-02-11', 'طباعة', 'اختبار تجاوز', 1500000, camp) returning id into ex2;
    appr := public.mkt_request_approval('مصروف', ex2);
    log := log || extensions.ok(
      (select approver = 'المدير' and escalated_reason is not null from public.mkt_approvals where id = appr),
      'مصروفٌ يتجاوز ميزانية حملته يُرفع إلى المدير بسببه');
    perform public.mkt_cancel_approval(appr);

    -- ربط حركة 5700 سُجّلت في المحاسبة: لا ترحيل ثانٍ
    perform tests.act_as(admin_u);
    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description, project_id)
    values ('2020-02-15', 'صرف', 300000, 'تسويق وإعلان', '5700', 'التسويق', 'نقد', 'اختبار حركة قائمة', proj)
    returning id into cm;
    select count(*) into n from public.cash_moves;
    perform public.mkt_link_cash_move(cm, 'لوحات إعلانية', camp, null, null, null);
    select count(*) into n2 from public.cash_moves;
    log := log || extensions.ok(n = n2 and (select spent from public.crm_campaigns where id = camp) = 300000,
      'ربط حركة قائمة: مصروف مدفوع على الحملة بلا حركة ثانية');

    -- ================= الميزانية =================
    perform tests.act_as(plain_u);
    begin
      insert into public.mkt_budgets (name, period_type, period_start, scope, planned)
      values ('خطأ', 'شهري', '2020-02-15', 'شركة', 1000);
      log := log || extensions.fail('الميزانية الشهرية تبدأ أول الشهر');
    exception when others then log := log || extensions.pass('الميزانية الشهرية تبدأ أول الشهر'); end;

    insert into public.mkt_budgets (name, period_type, period_start, scope, planned)
    values ('اختبار فبراير', 'شهري', '2020-02-01', 'شركة', 350000) returning id into bud;
    log := log || extensions.is((select period_end from public.mkt_budgets where id = bud), '2020-02-29'::date,
      'نهاية الفترة تُحسب (فبراير كبيس)');
    appr := public.mkt_request_approval('ميزانية', bud);
    perform tests.act_as(admin_u);
    perform public.mkt_decide_approval(appr, true);
    select spent, alert_level into v, txt from public.mkt_budget_status('2020-02-01', '2020-02-29') where budget_id = bud;
    log := log || extensions.ok(v = 300000 and txt = '80%',
      'حالة الميزانية: المدفوع في الفترة ٣٠٠ ألف من ٣٥٠ = تنبيه ٨٠٪ (فعلي: ' || coalesce(v::text, '∅') || ' / ' || coalesce(txt, '∅') || ')');

    -- ================= المواد =================
    insert into public.inventory_items (name, category, unit, quantity, min_quantity, is_active)
    values ('بروشور اختبار', 'مطبوعات ومواد تسويقية', 'قطعة', 0, 0, true) returning id into item;
    insert into public.inventory_moves (item_id, kind, quantity, unit_price, moved_at, created_by)
    values (item, 'شراء', 100, 1000, '2020-02-05', admin_u);
    perform tests.act_as(plain_u);
    perform public.mkt_issue_material(item, 10, camp, null, 'اختبار');
    select coalesce(sum(amount), 0) into v from public.mkt_cost_facts(null, null)
     where kind = 'مواد' and campaign_id = camp;
    log := log || extensions.is(v, 10000::numeric, 'صرف ١٠ بروشورات = ١٠ آلاف على كلفة الحملة');
    begin
      perform public.mkt_issue_material(item, 1000, camp, null, null);
      log := log || extensions.fail('لا صرف فوق الرصيد');
    exception when others then log := log || extensions.pass('لا صرف فوق الرصيد'); end;

    -- ================= التتبّع =================
    insert into public.mkt_tracking_links (name, destination_url, channel_id, campaign_id)
    values ('اختبار رابط', 'https://example.com/p', ch_fb, camp) returning id into lnk;
    select to_jsonb(l) into j from public.mkt_tracking_links l where l.id = lnk;
    log := log || extensions.ok(j->>'utm_source' = 'facebook' and j->>'utm_campaign' = camp_code
                                and (j->>'code') ~ '^[0-9a-f]{7}$',
      'الرابط يأخذ UTM من القناة والحملة ورمزاً قصيراً');
    begin
      insert into public.mkt_tracking_links (name, destination_url, channel_id, campaign_id)
      values ('مكرّر', 'https://example.com/p', ch_fb, camp);
      log := log || extensions.fail('UTM مكرّر لنفس الوجهة مرفوض');
    exception when others then log := log || extensions.pass('UTM مكرّر لنفس الوجهة مرفوض'); end;

    perform tests.act_as(null);
    url := public.mkt_track_hit(j->>'code', false, 'vis-test-1', 'جوال', null);
    perform public.mkt_track_hit(j->>'code', false, 'vis-test-1', 'جوال', null);
    log := log || extensions.ok(url like 'https://example.com/p?utm_source=facebook&%' and url like '%mkt_l=%'
                                and (select count(*) from public.mkt_link_hits where link_id = lnk) = 1,
      'النقرة من زائر غير مسجّل تُرجع الوجهة بمعاملاتها، ولا تتكرّر خلال ١٠ ثوانٍ');
    log := log || extensions.ok(public.mkt_track_hit('zzzzzzz') is null, 'رمز غير موجود يُرجع فراغاً');

    -- ================= صفحة الهبوط والنموذج =================
    perform tests.act_as(plain_u);
    insert into public.mkt_landing_pages (slug, title, campaign_id, status)
    values ('test-' || right(v_phone, 6), 'اختبار صفحة', camp, 'منشورة') returning id into lp;
    update public.mkt_tracking_links set landing_page_id = lp where id = lnk;

    perform tests.act_as(null);
    j := public.mkt_submit_lead('test-' || right(v_phone, 6), 'زائر', '123', 'vis-test-1', null, null, null, null);
    log := log || extensions.ok((j->>'ok')::boolean = false, 'رقم فاسد يُرفض برسالة');
    select count(*) into n from public.crm_lead_intake;
    j := public.mkt_submit_lead('test-' || right(v_phone, 6), 'روبوت', v_phone, null, null, null, null, 'bot');
    select count(*) into n2 from public.crm_lead_intake;
    log := log || extensions.ok((j->>'ok')::boolean and n = n2, 'فخّ الروبوت: «تمّ» بلا تسجيل');

    j := public.mkt_submit_lead('test-' || right(v_phone, 6), 'زائر اختبار', v_phone, 'vis-test-1',
                                '{"utm_source":"facebook","utm_medium":"paid_social"}'::jsonb, null, null, null);
    select client_id into cli from public.crm_lead_intake
     where provider = 'landing' and phone_key = public.normalize_iraqi_phone(v_phone)
     order by received_at desc limit 1;
    log := log || extensions.ok(cli is not null, 'النموذج ← البوّابة ← intake_lead ← عميل');
    log := log || extensions.ok(
      exists (select 1 from public.mkt_touchpoints where client_id = cli and touch_type = 'نموذج' and campaign_id = camp),
      'لمسة «نموذج» على حملة الصفحة');
    log := log || extensions.ok(
      exists (select 1 from public.mkt_touchpoints where client_id = cli and touch_type = 'نقرة إعلان' and link_id = lnk),
      'نقرة الزائر قبل النموذج صارت لمسة على رابطها');

    -- البوّابة تترجم رمز الحملة
    insert into public.crm_lead_intake (provider, external_id, raw, name, phone)
    values ('meta', 'test-' || v_phone, jsonb_build_object('utm_campaign', camp_code, 'utm_source', 'facebook'),
            'ليد ميتا', '07' || right(v_phone, 9))
    returning campaign_ref, source_ref into txt, url;
    log := log || extensions.ok(txt = (select name from public.crm_campaigns where id = camp)
                                and url = (select s.name from public.crm_sources s
                                            join public.mkt_channels c on c.source_id = s.id where c.id = ch_fb),
      'البوّابة: utm_campaign ← اسم الحملة، و utm_source ← مصدر الـCRM');

    -- لمسة يدوية
    perform tests.act_as(plain_u);
    insert into public.mkt_activities (kind, title, campaign_id, project_id) values ('معرض', 'معرض اختبار', camp, proj)
    returning id into it;
    perform public.mkt_add_touchpoint(cli, 'حضور فعالية', null, null, it, null, 'اختبار');
    log := log || extensions.ok(
      exists (select 1 from public.mkt_touchpoints where client_id = cli and activity_id = it and campaign_id = camp),
      'اللمسة اليدوية ترث حملة النشاط');
    begin
      perform public.mkt_add_touchpoint(cli, 'نقرة إعلان', camp);
      log := log || extensions.fail('الأنواع الآلية لا تُسجَّل يدوياً');
    exception when others then log := log || extensions.pass('الأنواع الآلية لا تُسجَّل يدوياً'); end;

    -- ================= الإسناد على بيعة حقيقية =================
    perform tests.act_as(admin_u);
    select sc.id, sc.client_id,
           coalesce((r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date,
                    (sc.created_at at time zone 'Asia/Baghdad')::date) as d
      into sale
      from public.sale_commissions sc join public.reservations r on r.id = sc.reservation_id
     where sc.reversed_at is null order by sc.created_at limit 1;
    if sale.id is null then
      log := log || extensions.pass('الإسناد: لا بيعة في القاعدة — تُخطّى # skip');
    else
      delete from public.mkt_touchpoints where client_id = sale.client_id;
      insert into public.mkt_touchpoints (client_id, occurred_at, touch_type, campaign_id)
      values (sale.client_id, (sale.d - 30)::timestamp at time zone 'Asia/Baghdad', 'يدوي', camp) returning id into tA;
      insert into public.mkt_touchpoints (client_id, occurred_at, touch_type, campaign_id)
      values (sale.client_id, (sale.d - 2)::timestamp at time zone 'Asia/Baghdad', 'يدوي', camp2) returning id into tB;

      log := log || extensions.ok(
        (select sum(weight) filter (where campaign_id = camp) from public.mkt_attributed_sales('first', sale.d, sale.d) where sale_id = sale.id) = 1
        and (select sum(weight) filter (where campaign_id = camp2) from public.mkt_attributed_sales('last', sale.d, sale.d) where sale_id = sale.id) = 1,
        'أول لمسة للحملة الأولى، وآخرها للثانية');
      log := log || extensions.ok(
        (select sum(weight) filter (where campaign_id = camp) from public.mkt_attributed_sales('linear', sale.d, sale.d) where sale_id = sale.id) = 0.5,
        'الخطّي: نصفٌ لكلّ لمسة');
      log := log || extensions.ok(
        (select sum(weight) filter (where campaign_id = camp2) from public.mkt_attributed_sales('time_decay', sale.d, sale.d) where sale_id = sale.id)
        > (select sum(weight) filter (where campaign_id = camp) from public.mkt_attributed_sales('time_decay', sale.d, sale.d) where sale_id = sale.id),
        'المتناقص: الأقرب إلى البيع أثقل');
      select count(*) into n from (
        select m.model, round(sum(a.weight), 6) as w
          from unnest(array['first','last','linear','position','time_decay','campaign']) m(model)
          cross join lateral public.mkt_attributed_sales(m.model, sale.d, sale.d) a
         where a.sale_id = sale.id group by m.model) x where x.w <> 1;
      log := log || extensions.is(n, 0, 'في كل النماذج الستّة: أوزان البيعة مجموعها ١');
    end if;

    -- ================= المحتوى والمؤثر =================
    perform tests.act_as(plain_u);
    insert into public.mkt_content (title, content_type, campaign_id, caption) values ('اختبار', 'ريلز', camp, 'نصّ ١')
    returning id into cnt;
    update public.mkt_content set caption = 'نصّ ٢' where id = cnt;
    log := log || extensions.ok(
      (select version from public.mkt_content where id = cnt) = 2
      and exists (select 1 from public.mkt_content_versions where content_id = cnt and caption = 'نصّ ١'),
      'تعديل النصّ يحفظ النسخة السابقة');
    begin
      update public.mkt_content set status = 'منشور' where id = cnt;
      log := log || extensions.fail('لا نشر قبل الاعتماد');
    exception when others then log := log || extensions.pass('لا نشر قبل الاعتماد'); end;

    insert into public.mkt_influencers (name, username) values ('مؤثر اختبار', 'test_' || v_phone) returning id into inf;
    insert into public.mkt_influencer_deals (influencer_id, campaign_id, stage, quoted_rate)
    values (inf, camp, 'تفاوض', 1000000) returning id into deal;
    begin
      update public.mkt_influencer_deals set stage = 'عقد' where id = deal;
      log := log || extensions.fail('لا عقد مع مؤثر قبل الاعتماد');
    exception when others then log := log || extensions.pass('لا عقد مع مؤثر قبل الاعتماد'); end;

    -- ================= التحليل =================
    perform tests.act_as(admin_u);
    -- بلا تاريخ: المواد صُرفت اليوم والمصروف في فبراير ٢٠٢٠
    j := public.mkt_kpis(null, null, null, camp, null, 'last');
    log := log || extensions.ok((j->>'cost')::numeric = 310000 and (j->>'spend')::numeric = 300000
                                and (j->>'materials')::numeric = 10000,
      'المؤشّرات: الكلفة = المدفوع + المواد (فعلي: ' || coalesce(j->>'cost', '∅') || ')');
    log := log || extensions.ok(j ? 'roi' and j ? 'cac' and j ? 'roas' and j ? 'lead_to_sale',
      'المؤشّرات تحمل ROI و CAC و ROAS والتحويل');
    select count(*) into n from public.mkt_breakdown('campaign', '2020-02-01', '2020-02-29') where dim_key = camp::text;
    log := log || extensions.is(n, 1, 'التفصيل بالحملة يحمل الحملة');
    begin
      perform * from public.mkt_breakdown('x');
      log := log || extensions.fail('بُعد غير معروف مرفوض');
    exception when others then log := log || extensions.pass('بُعد غير معروف مرفوض'); end;
    select count(*) into n from public.mkt_funnel('2020-02-01', '2020-02-29');
    log := log || extensions.is(n, 11, 'القمع إحدى عشرة خطوة');
    perform * from public.mkt_data_quality();
    log := log || extensions.pass('فحص الجودة يعمل');
    log := log || extensions.ok(exists (select 1 from public.mkt_search(camp_code) where id = camp),
      'البحث يجد الحملة برمزها');
    perform * from public.mkt_trend('week', '2020-02-01', '2020-02-29');
    perform public.mkt_forecast(1000000, 3);
    log := log || extensions.pass('الاتجاه والتنبؤ يعملان');

    -- ================= الأتمتة =================
    update public.crm_campaigns set end_date = '2020-03-01' where id = camp;
    j := public.mkt_run_automation('يدوي');
    select count(*) into n from public.mkt_alerts where dedupe_key = 'camp-end:' || camp || ':2020-03-01';
    j := public.mkt_run_automation('يدوي');
    select count(*) into n2 from public.mkt_alerts where dedupe_key = 'camp-end:' || camp || ':2020-03-01';
    log := log || extensions.ok(n = 1 and n2 = 1 and jsonb_array_length(j->'errors') = 0,
      'قاعدة «انتهاء الحملة» تُطلق مرّة لا مرّتين، والتشغيل بلا أخطاء');

    -- ================= التكاملات =================
    insert into public.mkt_integrations (provider, name, account_ref) values ('meta', 'اختبار', 'act_test_' || v_phone)
    returning id into integ;
    perform tests.act_as(plain_u);
    begin
      perform public.mkt_set_integration_secret(integ, 'secret-123456');
      log := log || extensions.fail('مفتاح التكامل لمدير التسويق');
    exception when others then log := log || extensions.pass('مفتاح التكامل لمدير التسويق'); end;
    perform tests.act_as(admin_u);
    perform public.mkt_set_integration_secret(integ, 'secret-123456');
    log := log || extensions.ok(public.mkt_has_integration_secret(integ), 'المفتاح يُحفظ في Vault');
    begin
      perform public.mkt_integration_secret(integ);
      log := log || extensions.fail('المفتاح لا يُقرأ بجلسة مستخدم');
    exception when others then log := log || extensions.pass('المفتاح لا يُقرأ بجلسة مستخدم — service_role وحده'); end;

    -- ================= RLS تحت دور authenticated =================
    perform tests.act_as(null);
    update public.mkt_team set is_active = false where employee_id = plain_emp;
    perform tests.act_as(plain_u);
    set local role authenticated;
    select count(*) into n from public.mkt_expenses;
    select count(*) into n2 from public.mkt_content;
    reset role;
    log := log || extensions.ok(n = 0 and n2 = 0, 'الموظف خارج الفريق لا يرى مصروفاً ولا محتوى (RLS)');
    begin
      perform public.mkt_kpis();
      log := log || extensions.fail('الموظف خارج الفريق لا يقرأ المؤشّرات');
    exception when others then log := log || extensions.pass('الموظف خارج الفريق لا يقرأ المؤشّرات'); end;

    -- المحاسب يقرأ الأرقام ولا يكتب حملة
    perform tests.act_as(null);
    update public.profiles set role = 'accountant' where id = plain_u;
    perform tests.act_as(plain_u);
    begin
      perform public.mkt_kpis('2020-02-01', '2020-02-29');
      log := log || extensions.pass('المحاسب يقرأ مؤشّرات التسويق');
    exception when others then log := log || extensions.fail('المحاسب يقرأ مؤشّرات التسويق: ' || sqlerrm); end;
    log := log || extensions.ok(not public.can_write_marketing(), 'المحاسب لا يكتب في التسويق');

    -- المُطالِع يقرأ ولا يكتب
    perform tests.act_as(null);
    update public.profiles set role = 'viewer' where id = plain_u;
    perform tests.act_as(plain_u);
    log := log || extensions.ok(public.can_read_marketing() and not public.can_write_marketing(),
      'المُطالِع يقرأ القسم ولا يكتب');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات التسويق: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_marketing() is
  'اختبارات التسويق: الأدوار، الحملة، المال حتى الدفتر، الميزانية، المواد، التتبّع، النموذج، الإسناد، التحليل، الأتمتة، التكاملات، RLS. يُلغي أثره (sql/127).';

revoke all on function tests.run_marketing() from public;
grant execute on function tests.run_marketing() to service_role;
