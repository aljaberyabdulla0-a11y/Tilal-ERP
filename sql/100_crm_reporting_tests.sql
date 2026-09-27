-- ============================================================
-- تلال ERP — 100: اختبارات محرّك التقارير (§82–86)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_reporting();
--
-- ===== العزل =====
--
-- كل البيانات بتواريخ يناير ٢٠٢٠ — قبل أول عميل حقيقي بست سنوات.
-- فلقطة ٢٠٢٠ لا تحوي إلا عملاء الاختبار، والمقاييس على أيام ٢٠٢٠
-- لا تلمس رقماً حقيقياً. وكل شيء داخل معاملة فرعية تُلغى في النهاية
-- (نمط 082): النتائج في متغيّر، والأثر يموت.
--
-- ===== ما يُختبر =====
--
--   §83  عميل: ليد + مكالمة (ي١) ← تأهّل (ي٢) ← زيارة (ي٣) ← بيع (ي٤)
--        لقطة كل يوم، ثم يُنقل العميل ويُخسَر — واللقطات لا تتغيّر،
--        وإعادة البناء من التاريخ تعطي نفس الماضي.
--   §84  ١٠ تواصل مع ٣ عملاء = ١٠ تواصل و٣ عملاء فريدين.
--   §85  ٢٣:٥٩ و٠٠:٠١ بتوقيت بغداد في يومين مختلفين.
--   §86  لقطة مرتين لنفس اليوم = تشغيل واحد وصفوف بلا تكرار.
--        ومعها: إعادة البناء تُبقي الأصل، والفشل يُسجَّل ويُستعاد منه،
--        والمُرشِّحات (مشروع، موظف)، والنزول إلى الأصل، والتجميع
--        الشهري = مجموع الأيام، وRLS على الأحداث واللقطات،
--        والمحرّك بصلاحية موظف لا مدير (عطل 101).
--
-- security invoker عمداً: اختبار RLS يحتاج `set local role
-- authenticated` وهو ممنوع داخل definer (نفس سبب 084).
--
-- يتطلب: 082 (tests.act_as)، 096–099. آمن لإعادة التشغيل. لا يترك بيانات.
-- ============================================================

create or replace function tests.run_reporting()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log     text[] := '{}';
  emp_a   uuid; emp_b uuid; usr_a uuid; usr_b uuid; admin_u uuid;
  proj    uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; o1 uuid;
  g_lead uuid; g_visit uuid; g_won uuid; g_lost uuid;
  d1 date := '2020-01-01'; d2 date := '2020-01-02'; d3 date := '2020-01-03'; d4 date := '2020-01-04';
  d5 date := '2020-01-05'; d6 date := '2020-01-06'; d7 date := '2020-01-07'; d8 date := '2020-01-08';
  r1 uuid; r1b uuid; r_fail uuid; r_ok uuid;
  before_stages text; after_stages text;
  n int; n2 int; txt text; j jsonb;
  i int := 0;
  -- لحظة بتوقيت بغداد
  bgd constant text := ' Asia/Baghdad';
begin
  perform tests.reset_plan();

  select p.id into admin_u from public.profiles p where p.role = 'admin' limit 1;
  select e.id, e.user_id into emp_a, usr_a from public.employees e
   where e.user_id is not null and e.status = 'active' order by e.full_name limit 1;
  select e.id, e.user_id into emp_b, usr_b from public.employees e
   where e.user_id is not null and e.status = 'active' and e.id <> emp_a order by e.full_name limit 1;
  select id into proj from public.projects order by created_at limit 1;
  select id into g_lead  from public.crm_stages where report_milestone = 'lead' limit 1;
  select id into g_visit from public.crm_stages where report_milestone = 'visit' limit 1;
  select id into g_won   from public.crm_stages where stage_type = 'won' limit 1;
  select id into g_lost  from public.crm_stages where stage_type = 'lost' limit 1;

  if admin_u is null or emp_a is null or emp_b is null or proj is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بحسابات ومشروع'::text;
    return;
  end if;
  if exists (select 1 from public.crm_snapshot_runs where snapshot_date < '2021-01-01')
     or exists (select 1 from public.clients where created_at < '2021-01-01') then
    return query select 0, 'not ok', 'بيانات قبل ٢٠٢١ موجودة — العزل بالتاريخ لا يصحّ'::text;
    return;
  end if;

  perform extensions.plan(31);

  begin
    perform tests.act_as(null);

    -- ================= §83 سيناريو الأيام الأربعة =================
    insert into public.clients (name, phone, stage, owner_id, source, governorate, created_at)
    values ('اختبار تقارير ١', '07700000901', 'ليد', emp_a, 'سوشيل ميديا', 'بغداد',
            (d1::text || ' 09:00' || bgd)::timestamptz)
    returning id into c1;
    select id into o1 from public.opportunities where client_id = c1 limit 1;
    if o1 is null then
      insert into public.opportunities (client_id, stage_id, owner_id) values (c1, g_lead, emp_a) returning id into o1;
    end if;
    update public.opportunities set created_at = (d1::text || ' 09:00' || bgd)::timestamptz where id = o1;

    -- ي١: مكالمة
    insert into public.client_activities (client_id, opportunity_id, activity_type, direction, outcome,
                                          occurred_at, summary, next_action, next_action_date, created_by)
    values (c1, o1, 'مكالمة', 'صادر', 'تم التواصل', (d1::text || ' 10:00' || bgd)::timestamptz,
            'اختبار', 'متابعة', public.baghdad_today() + 1, usr_a);

    -- ي٢: تأهّل
    update public.clients set qualified_at = (d2::text || ' 11:00' || bgd)::timestamptz where id = c1;

    -- المراحل بتواريخها: دخول «ليد» ي١، «زيارة» ي٣، «بيع» ي٤
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage, at)
    values (o1, null,    g_lead,  null,   'ليد',   (d1::text || ' 09:00' || bgd)::timestamptz),
           (o1, g_lead,  g_visit, 'ليد',  'زيارة', (d3::text || ' 10:00' || bgd)::timestamptz),
           (o1, g_visit, g_won,   'زيارة', 'بيع',  (d4::text || ' 10:00' || bgd)::timestamptz);

    select count(*) into n from public.crm_event_facts
     where client_id = c1 and event_type = 'activity' and event_date = d1;
    log := log || extensions.is(n, 1, 'الحدث يُكتب بتاريخ بغداد لحظة وقوعه (مكالمة ي١)');

    select string_agg(event_subtype, ',' order by event_at) into txt from public.crm_event_facts
     where opportunity_id = o1 and event_type = 'stage_change' and event_at < '2021-01-01';
    log := log || extensions.is(txt, 'initial,progression,won',
      'تاريخ المراحل يصير أحداثاً: دخول ← تقدّم ← فوز');

    r1 := public.crm_run_snapshot(d1, 'test');
    perform public.crm_run_snapshot(d2, 'test');
    perform public.crm_run_snapshot(d3, 'test');
    perform public.crm_run_snapshot(d4, 'test');

    select string_agg(r.stage_name || ':' || r.is_qualified::text, ',' order by r.snapshot_date) into before_stages
      from public.v_crm_snapshot_current r where r.client_id = c1;

    log := log || extensions.is(split_part(before_stages, ',', 1), 'ليد:false', 'لقطة ي١: ليد، غير مؤهَّل');
    log := log || extensions.is(split_part(before_stages, ',', 2), 'ليد:true',  'لقطة ي٢: ليد، مؤهَّل');
    log := log || extensions.is(split_part(before_stages, ',', 3), 'زيارة:true', 'لقطة ي٣: زيارة');
    log := log || extensions.is(split_part(before_stages, ',', 4), 'بيع:true',   'لقطة ي٤: بيع');

    select summary into j from public.crm_snapshot_runs where snapshot_date = d1 and is_current;
    select (s2.summary->>'QUALIFIED_LEADS')::int, (s4.summary->>'WON_DEALS')::int into n, n2
      from public.crm_snapshot_runs s2, public.crm_snapshot_runs s4
     where s2.snapshot_date = d2 and s2.is_current and s4.snapshot_date = d4 and s4.is_current;
    log := log || extensions.ok((j->>'TOTAL_ACTIVITIES')::int = 1 and n = 1 and n2 = 1,
      'ملخّص اللقطات: تواصل ي١ = ١ · تأهّل ي٢ = ١ · فوز ي٤ = ١');

    -- الحالة الحالية تتغيّر كلياً: نقلٌ إلى موظف آخر ثم خسارة
    perform tests.act_as(admin_u);
    perform public.assign_client(c1, emp_b, 'اختبار التقارير');
    update public.opportunities
       set stage_id = g_lost,
           lost_reason_id = (select id from public.crm_lost_reasons where not requires_note limit 1)
     where id = o1;
    perform tests.act_as(null);

    select string_agg(r.stage_name || ':' || r.is_qualified::text, ',' order by r.snapshot_date) into after_stages
      from public.v_crm_snapshot_current r where r.client_id = c1;
    log := log || extensions.is(after_stages, before_stages,
      '§83: اللقطات لا تتغيّر حين تتغيّر حالة العميل لاحقاً');

    select s.stage_name || ':' || (s.owner_id = emp_a)::text into txt
      from public.crm_state_as_of(public.crm_bgd_day_end(d2)) s where s.client_id = c1;
    log := log || extensions.is(txt, 'ليد:true',
      'إعادة البناء من التاريخ: ي٢ ما زال «ليد» عند مالكه يومها');

    select s.stage_type into txt from public.crm_state_as_of(null) s where s.client_id = c1;
    log := log || extensions.is(txt, 'lost', 'والحالة الراهنة تغيّرت فعلاً (خاسرة) — الاختبار حقيقي');

    -- ================= §86 عدم التكرار وإعادة البناء =================
    select count(*) into n from public.crm_snapshot_rows where run_id = r1;
    log := log || extensions.is(public.crm_run_snapshot(d1, 'test'), r1,
      '§86: تشغيل ثانٍ لنفس اليوم يُعيد نفس التشغيل');
    select count(*) into n2 from public.crm_snapshot_rows r
      join public.crm_snapshot_runs u on u.id = r.run_id where u.snapshot_date = d1;
    log := log || extensions.ok(n2 = n and (select count(*) from public.crm_snapshot_runs where snapshot_date = d1) = 1,
      '§86: لا صفوف مكرّرة ولا تشغيل ثانٍ');

    r1b := public.crm_run_snapshot(d1, 'rebuild', 'اختبار إعادة البناء', true);
    log := log || extensions.ok(
      (select count(*) from public.crm_snapshot_runs where snapshot_date = d1) = 2
      and (select is_current from public.crm_snapshot_runs where id = r1b)
      and not (select is_current from public.crm_snapshot_runs where id = r1)
      and (select count(*) from public.crm_snapshot_rows where run_id = r1) = n,
      'إعادة البناء: تشغيل جديد معتمد، والأصل باقٍ بصفوفه للمقارنة');

    -- ================= §84 عشرة تواصل مع ثلاثة عملاء =================
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id, created_at)
    values ('اختبار تقارير ٢', '07700000902', 'اتصال', emp_a, 'سوشيل ميديا', 'بغداد', proj, (d1::text || ' 09:00' || bgd)::timestamptz)
    returning id into c2;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, created_at)
    values ('اختبار تقارير ٣', '07700000903', 'اتصال', emp_a, 'سوشيل ميديا', 'بغداد', (d1::text || ' 09:00' || bgd)::timestamptz)
    returning id into c3;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, created_at)
    values ('اختبار تقارير ٤', '07700000904', 'اتصال', emp_b, 'سوشيل ميديا', 'بغداد', (d1::text || ' 09:00' || bgd)::timestamptz)
    returning id into c4;

    insert into public.client_activities (client_id, activity_type, direction, outcome, occurred_at,
                                          summary, next_action, next_action_date, created_by)
    select x.cid, x.t, 'صادر', 'تم التواصل', (d5::text || ' 1' || x.h || ':00' || bgd)::timestamptz,
           'اختبار', 'متابعة', public.baghdad_today() + 1, x.u
      from (values (c2, 'مكالمة', 0, usr_a), (c2, 'مكالمة', 1, usr_a), (c2, 'واتساب', 2, usr_a), (c2, 'مكالمة', 3, usr_a),
                   (c3, 'مكالمة', 0, usr_a), (c3, 'واتساب', 1, usr_a), (c3, 'مكالمة', 2, usr_a),
                   (c4, 'مكالمة', 0, usr_b), (c4, 'مكالمة', 1, usr_b), (c4, 'واتساب', 2, usr_b)) x(cid, t, h, u);

    select q.metrics into j from public.crm_report_query(
      array['TOTAL_ACTIVITIES', 'UNIQUE_CLIENTS_CONTACTED', 'CALLS'], '{}', d5, d5) q;
    log := log || extensions.is((j->>'TOTAL_ACTIVITIES')::int, 10, '§84: ١٠ تواصل');
    log := log || extensions.is((j->>'UNIQUE_CLIENTS_CONTACTED')::int, 3, '§84: ٣ عملاء فريدون — لا يختلط الرقمان');

    -- ================= §85 حدود اليوم بتوقيت بغداد =================
    insert into public.client_activities (client_id, activity_type, direction, outcome, occurred_at,
                                          summary, next_action, next_action_date, created_by)
    values (c2, 'مكالمة', 'صادر', 'تم التواصل', (d6::text || ' 23:59' || bgd)::timestamptz, 'حدّ', 'متابعة', public.baghdad_today() + 1, usr_a),
           (c2, 'مكالمة', 'صادر', 'تم التواصل', (d7::text || ' 00:01' || bgd)::timestamptz, 'حدّ', 'متابعة', public.baghdad_today() + 1, usr_a);

    select string_agg(event_date::text, ',' order by event_at) into txt from public.crm_event_facts
     where client_id = c2 and event_type = 'activity' and event_date in (d6, d7);
    log := log || extensions.is(txt, d6::text || ',' || d7::text,
      '§85: ٢٣:٥٩ بغداد في يومه، و٠٠:٠١ في اليوم التالي (وفي UTC كلاهما في ي٦)');

    select string_agg((q.dims->>'day') || '=' || (q.metrics->>'CALLS'), ',' order by q.dims->>'day') into txt
      from public.crm_report_query(array['CALLS'], array['day'], d6, d7) q;
    log := log || extensions.is(txt, d6::text || '=1,' || d7::text || '=1', '§85: التجزئة اليومية تفصلهما');

    -- الشهر = مجموع أيامه
    select (q.metrics->>'TOTAL_ACTIVITIES')::int into n
      from public.crm_report_query(array['TOTAL_ACTIVITIES'], array['month'], '2020-01-01', '2020-01-31') q;
    select sum((q.metrics->>'TOTAL_ACTIVITIES')::int) into n2
      from public.crm_report_query(array['TOTAL_ACTIVITIES'], array['day'], '2020-01-01', '2020-01-31') q;
    log := log || extensions.ok(n = n2 and n = 13, format('الشهر (%s) = مجموع أيامه (%s) = ١٣', n, n2));

    -- ================= المُرشِّحات والنزول =================
    select (q.metrics->>'TOTAL_ACTIVITIES')::int into n from public.crm_report_query(
      array['TOTAL_ACTIVITIES'], '{}', d5, d5, jsonb_build_object('project', jsonb_build_array(proj))) q;
    log := log || extensions.is(n, 4, 'مُرشِّح المشروع: تواصل عميل المشروع وحده (٤)');

    select (q.metrics->>'TOTAL_ACTIVITIES')::int into n from public.crm_report_query(
      array['TOTAL_ACTIVITIES'], '{}', d5, d5, jsonb_build_object('employee', jsonb_build_array(emp_b))) q;
    log := log || extensions.is(n, 3, 'مُرشِّح الموظف: ما أجراه هو (٣)');

    select q.total into n from public.crm_report_drill('TOTAL_ACTIVITIES', d5, d5) q limit 1;
    log := log || extensions.is(n, 10, 'النزول إلى الأصل: ١٠ صفوف خلف الرقم ١٠');

    -- ================= الفشل والاستعادة =================
    alter table public.crm_snapshot_rows add constraint zz_test_fail check (false) not valid;
    r_fail := public.crm_run_snapshot(d8, 'test');
    log := log || extensions.ok(
      (select status = 'failed' and error_stage = 'extract' and not is_current and error_message is not null
         from public.crm_snapshot_runs where id = r_fail),
      'الفشل يُسجَّل: الحالة والمرحلة والرسالة — ولا يُعتمد');
    alter table public.crm_snapshot_rows drop constraint zz_test_fail;
    r_ok := public.crm_run_snapshot(d8, 'test');
    log := log || extensions.ok(
      r_ok <> r_fail and (select is_current and status like 'completed%' from public.crm_snapshot_runs where id = r_ok),
      'المحاولة التالية تكتمل وتُعتمد، والفاشلة تبقى في السجلّ');

    -- ================= RLS =================
    perform tests.act_as(usr_b);
    set local role authenticated;
    select count(*) into n from public.crm_event_facts where client_id = c3;
    log := log || extensions.is(n, 0, 'RLS: الموظف لا يرى أحداث عميل غيره');
    select (q.metrics->>'TOTAL_ACTIVITIES')::int into n
      from public.crm_report_query(array['TOTAL_ACTIVITIES'], '{}', d5, d5) q;
    log := log || extensions.is(n, 3, 'RLS: المحرّك يعطي الموظف تواصله وحده (٣ من ١٠)');
    select count(*) into n from public.crm_snapshot_rows where client_id = c1 and snapshot_date between d1 and d4;
    log := log || extensions.is(n, 0, 'RLS: اللقطة بنطاق المالك يومها — المالك الجديد لا يرى ماضي غيره');
    -- 101: «الحالة الآن» كانت تسقط لكل من ليس مديراً (صلاحية تُفحص عند التخطيط)
    log := log || extensions.lives_ok(
      $q$select * from public.crm_report_query(array['OPEN_OPPORTUNITIES', 'OVERDUE'], array['employee'], public.baghdad_today(), public.baghdad_today(), '{}', 'event', 'current')$q$,
      '101: «الحالة الآن» تعمل بصلاحية الموظف — لا للمدير وحده');
    reset role;

    perform tests.act_as(usr_a);
    set local role authenticated;
    select count(*) into n from public.crm_event_facts where client_id = c3 and event_type = 'activity';
    log := log || extensions.is(n, 3, 'RLS: المالك يرى أحداث عميله');
    select count(distinct r.snapshot_date) into n from public.v_crm_snapshot_current r
     where r.client_id = c1 and r.snapshot_date between d1 and d4;
    log := log || extensions.is(n, 4, 'RLS: من نُقل عنه العميل يبقى يرى صورته التاريخية (٤ أيام)');

    log := log || extensions.throws_ok(
      $q$update public.crm_metrics set predicate = 'true' where code = 'CALLS'$q$, '42501', null,
      'تعريف المقياس لا يُعدَّل من التطبيق');
    log := log || extensions.throws_ok(
      $q$insert into public.crm_event_facts (source_table, source_id, event_type, event_at, event_date) values ('x', gen_random_uuid(), 'activity', now(), current_date)$q$,
      '42501', null, 'الأحداث لا تُكتب من التطبيق');
    reset role;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات التقارير: ' || sqlerrm || ' @ ' || left(txt, 300));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_reporting() is
  'اختبارات محرّك التقارير (§82–86): اللقطات التاريخية، والتكرار، وحدود اليوم، والتفرّد، وRLS. يُلغي أثره.';

revoke all on function tests.run_reporting() from public;
grant execute on function tests.run_reporting() to service_role;
