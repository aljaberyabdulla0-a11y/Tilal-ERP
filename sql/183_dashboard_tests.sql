-- ============================================================
-- تلال ERP — 183: اختبارات دوال لوحة التحكم (182)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_dashboard();
--
-- نمط 082/168: معاملة فرعية تُلغى في النهاية، فلا أثر على البيانات.
--
--   المخزون     مجموع dashboard_units = عدّ units مباشرةً (لا حدّ ١٠٠٠)
--   النطاق      الوسيط لا يرى وحدة؛ والموظف لا يرى أكثر من المدير
--   النشاط      لا يتجاوز الحدّ، مرتّب من الأحدث، والإغلاق بنتيجته won/lost
--   الانتباه    كل المفاتيح موجودة، والأعداد غير سالبة
--   ملخّصي      «ليداتي» بالمالك owner_id: ليدٌ أُسند لموظف يُعدّ له لا لمُدخِله
--   بغداد      «اليوم» في الانتباه = تاريخ بغداد
--
-- يتطلب: 082 (tests.act_as)، 182.
--
-- ⚠️ داخل الكتلة تُبدَّل الهوية بـ set_config لا بـ tests.act_as: بعد
--    «set local role authenticated» لا صلاحية على مخطط tests.
-- ============================================================

create or replace function tests.run_dashboard()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; other_u uuid; other_emp uuid; broker_u uuid;
  cli uuid; n int; m int; j jsonb; txt text; i int := 0;
  v_phone text := '0773' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select p.id, e.id into plain_u, plain_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' order by p.created_at limit 1;
  select p.id, e.id into other_u, other_emp
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and p.id <> plain_u order by p.created_at limit 1;
  select id into broker_u from public.profiles where role = 'broker' order by created_at limit 1;

  if admin_u is null or plain_u is null or other_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بملفّين'::text;
    return;
  end if;

  begin
    -- ================= المخزون: المجموع = العدّ المباشر =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select coalesce(sum(total), 0) into n from public.dashboard_units();
    select count(*) into m from public.units;
    log := log || extensions.is(n, m, 'مجموع dashboard_units يساوي عدد الوحدات كلّه للمدير');

    select coalesce(sum(available), 0) into n from public.dashboard_units();
    select count(*) into m from public.units where status = 'متاحة';
    log := log || extensions.is(n, m, 'المتاحة = عدّ الوحدات «متاحة» مباشرةً');

    -- ================= النطاق =================
    if broker_u is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', broker_u, 'role', 'authenticated')::text, true);
      select coalesce(sum(total), 0) into n from public.dashboard_units();
      log := log || extensions.is(n, 0, 'الوسيط لا يرى وحدات (سياسة units)');
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    select coalesce(sum(total), 0) into n from public.dashboard_units();
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    select coalesce(sum(total), 0) into m from public.dashboard_units();
    log := log || extensions.ok(n <= m, 'الموظف لا يرى من المخزون أكثر من المدير');

    -- ================= النشاط =================
    select count(*) into n from public.dashboard_activity(7);
    log := log || extensions.ok(n <= 7, 'السجلّ لا يتجاوز الحدّ المطلوب');

    select count(*) into n from (
      select at, lag(at) over (order by ord) prev_at
        from (select a.at, row_number() over () ord from public.dashboard_activity(30) a) x
    ) y where prev_at is not null and at > prev_at;
    log := log || extensions.is(n, 0, 'السجلّ مرتّب من الأحدث إلى الأقدم');

    select count(*) into n from public.dashboard_activity(100) a where a.kind = 'stage_change';
    log := log || extensions.is(n, 0, 'الإغلاق يُسمّى بنتيجته (won/lost) لا «stage_change»');

    select count(*) into n from public.dashboard_activity(5, null, now() - interval '100 years');
    log := log || extensions.is(n, 0, 'p_before يقصّ ما بعده');

    -- ================= الانتباه =================
    j := public.dashboard_attention();
    log := log || extensions.ok(
      j ?& array['sale_requests_pending','reservations_expiring','reservations_expired','broker_requests_open',
                 'broker_requests_supervisor','broker_leads_expiring','approvals_pending','leaves_pending',
                 'inventory_low','tasks_overdue'],
      'كائن الانتباه يحمل كل المفاتيح');
    select count(*) into n from jsonb_each(j) e where jsonb_typeof(e.value) = 'number' and (e.value)::text::numeric < 0;
    log := log || extensions.is(n, 0, 'لا عدّاد سالب');
    log := log || extensions.is((j->>'today')::date, (now() at time zone 'Asia/Baghdad')::date, '«اليوم» بتوقيت بغداد');

    -- ================= ملخّصي: المالك لا المُدخِل (H5) =================
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, created_by)
    values ('اختبار لوحة', v_phone, 'ليد', other_emp, 'سوشيل ميديا', 'بغداد', plain_u)
    returning id into cli;
    execute 'set local role authenticated';

    perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
    j := public.dashboard_my_summary();
    log := log || extensions.ok((j->>'has_employee')::boolean, 'الموظف المربوط بملفّ: has_employee');
    select count(*) into n from public.clients c
     where c.owner_id = other_emp and c.deleted_at is null and c.merged_into is null
       and coalesce(c.stage, '') not in ('بيع', 'فشل البيع');
    log := log || extensions.is((j->>'leads_open')::int, n, 'ليداتي المفتوحة = ما أملكه (owner_id) — والليد المُسنَد إليّ منها');

    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    j := public.dashboard_my_summary();
    select count(*) into n from public.clients c
     where c.owner_id = plain_emp and c.deleted_at is null and c.merged_into is null
       and coalesce(c.stage, '') not in ('بيع', 'فشل البيع');
    log := log || extensions.is((j->>'leads_open')::int, n, 'المُدخِل لا يُحسب له ليدٌ مالكه غيره');

    if broker_u is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', broker_u, 'role', 'authenticated')::text, true);
      j := public.dashboard_my_summary();
      log := log || extensions.ok(not (j->>'has_employee')::boolean and (j->>'leads_open')::int = 0, 'الوسيط بلا ملفّ موظف: أصفار لا خطأ');
    end if;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات اللوحة: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_dashboard() is
  'اختبارات دوال اللوحة (182): المخزون = العدّ المباشر، النطاق تحت RLS، ترتيب السجلّ، مفاتيح الانتباه، ليداتي بالمالك. يُلغي أثره.';

revoke all on function tests.run_dashboard() from public;
grant execute on function tests.run_dashboard() to service_role;
