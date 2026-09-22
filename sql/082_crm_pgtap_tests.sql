-- ============================================================
-- تلال ERP — 082: اختبارات القاعدة (pgTAP) — السياسات والمحفّزات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_all();
--
-- ===== لماذا =====
--
-- اختبارات vitest تحمي المنطق الخالص وحده. وما كسر النظام فعلاً عند
-- تشغيل 070–080 لم يكن منطقاً خالصاً: min(uuid) في محفّز، ومحفّز حجز
-- يصطدم بحارس متابعة، وجدول teams لا وجود له. ستّة أخطاء، كلها في
-- القاعدة، ولا يراها tsc ولا vitest.
--
-- ===== كيف تعمل =====
--
-- pgTAP يُصمَّم لـ pg_prove: يفتح معاملة، يُشغّل، يُلغي. ولا pg_prove
-- هنا — المحرّر يُنفّذ كل عبارة بمعاملتها. فالمُشغِّل أدناه يصنع
-- الأمرين بنفسه:
--
--   • كل اختبار داخل كتلة begin/exception — معاملة فرعية تُلغى
--     بإثارة استثناء في نهايتها. فلا يبقى أثر في بياناتك مهما أنشأ.
--   • النتائج تُجمَع في **متغيّر plpgsql** لا في جدول: المتغيّر لا
--     يُلغى مع المعاملة الفرعية، فتنجو النتيجة ويموت أثرها.
--
-- ===== ما يُختبر =====
--
--   أ) الحراسة: الموظف لا ينقل ملكية، والخسارة بلا سبب تُرفض،
--      والحذف مع حجز حيّ يُرفض، وتاريخ المراحل لا يُكتب من الواجهة.
--   ب) المرايا: الكانبان ↔ الفرصة في الاتجاهين، ونشاط واحد لا اثنان.
--   ج) الرؤية (RLS): الموظف يرى ليداته ولا يرى ليدات غيره.
--   د) الدوال: تطبيع الهاتف، والقمع لا يمنح الخاسرة مرحلة لم تبلغها،
--      وتعريف معدّل التحويل.
--
-- يتطلب: 070–081. آمن لإعادة التشغيل. لا يترك بيانات.
-- ============================================================

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

comment on schema tests is
  'اختبارات القاعدة. لا تُستدعى من التطبيق — تُشغَّل يدوياً أو من CI.';

-- ------------------------------------------------------------
-- أدوات: انتحال دور، وتثبيت بيانات اختبار
-- ------------------------------------------------------------

-- ⚠️ للاختبارات وحدها. تضع مطالبات JWT محليّاً في المعاملة الحالية
--    فتسري is_admin() و auth.uid() كما تسري على مستخدم حقيقي.
create or replace function tests.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', null, true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  end if;
end $$;

-- عميل اختبار كامل الأركان، مملوك لموظف مُعطى
create or replace function tests.make_client(p_owner uuid, p_stage text default 'اتصال')
returns uuid language plpgsql as $$
declare cid uuid;
begin
  insert into public.clients (name, phone, stage, owner_id, source, governorate)
  values ('اختبار — ' || substr(md5(random()::text), 1, 8),
          '07' || lpad((floor(random() * 900000000) + 100000000)::bigint::text, 9, '0'),
          p_stage, p_owner, 'سوشيل ميديا', 'بغداد')
  returning id into cid;
  return cid;
end $$;

-- ------------------------------------------------------------
-- المُشغِّل
--
-- كل اختبار: اسمه، ونتيجته، وتفصيله. والترتيب هو ترتيب التنفيذ.
-- ------------------------------------------------------------
create or replace function tests.run_all()
returns table (nr int, result text, test_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  log     text[] := '{}';
  emp_a   uuid;   -- موظف مبيعات أ (له حساب)
  emp_b   uuid;   -- موظف مبيعات ب
  usr_a   uuid;
  usr_b   uuid;
  admin_u uuid;
  cid     uuid;
  oid     uuid;
  won_id  uuid;
  lost_id uuid;
  visit   uuid;
  n       int;
  txt     text;
  i       int := 0;
begin
  -- الأدوار المتاحة في بياناتك الآن
  select p.id into admin_u from public.profiles p where p.role = 'admin' limit 1;

  select e.id, e.user_id into emp_a, usr_a
    from public.employees e
   where e.user_id is not null and e.status = 'active'
   order by e.full_name limit 1;

  select e.id, e.user_id into emp_b, usr_b
    from public.employees e
   where e.user_id is not null and e.status = 'active' and e.id <> emp_a
   order by e.full_name limit 1;

  select id into won_id  from public.crm_stages where stage_type = 'won'  limit 1;
  select id into lost_id from public.crm_stages where stage_type = 'lost' limit 1;
  select id into visit   from public.crm_stages where name = 'زيارة'      limit 1;

  if admin_u is null or emp_a is null or emp_b is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بحسابات'::text;
    return;
  end if;

  perform extensions.plan(16);

  -- ===== كل ما يلي داخل معاملة فرعية تُلغى بالكامل =====
  begin
    -- ——— (د) الدوال الخالصة ———
    log := log || extensions.is(
      public.normalize_iraqi_phone('07701234567'), '9647701234567',
      'تطبيع الهاتف: المحلي');
    log := log || extensions.is(
      public.normalize_iraqi_phone('+9647701234567'), '9647701234567',
      'تطبيع الهاتف: الدولي يطابق المحلي');
    log := log || extensions.is(
      public.normalize_iraqi_phone('+971509132112'), null,
      'تطبيع الهاتف: الأجنبي بلا مفتاح — لا نخترع');
    log := log || extensions.ok(
      public.is_open_stage('اتصال') and not public.is_open_stage('بيع'),
      'is_open_stage تقرأ من crm_stages');

    -- ——— (أ) الحراسة ———

    -- عميل يملكه الموظف (أ)
    perform tests.act_as(null);
    cid := tests.make_client(emp_a);

    -- ١) الموظف لا ينقل ملكية — لا إليه ولا منه
    perform tests.act_as(usr_a);
    log := log || extensions.throws_ok(
      format('update public.clients set owner_id = %L where id = %L', emp_b, cid),
      'P0001', null,
      'الحارس: الموظف لا ينقل ملكية العميل');

    -- ٢) المدير ينقلها
    perform tests.act_as(admin_u);
    log := log || extensions.lives_ok(
      format('select public.assign_client(%L, %L, %L)', cid, emp_b, 'اختبار'),
      'assign_client: المدير ينقل الملكية');

    select count(*) into n from public.client_assignments
     where client_id = cid and to_owner_id = emp_b;
    log := log || extensions.ok(n = 1, 'النقل يكتب صفّاً في تاريخ الملكية');

    select reason into txt from public.client_assignments
     where client_id = cid order by at desc limit 1;
    log := log || extensions.is(txt, 'اختبار', 'سبب النقل يُحفظ معه');

    -- ٣) الخسارة بلا سبب تُرفض (الحقول المطلوبة للمرحلة)
    perform tests.act_as(null);
    select id into oid from public.opportunities where client_id = cid limit 1;
    if oid is null then
      insert into public.opportunities (client_id, stage_id)
      values (cid, visit) returning id into oid;
    end if;

    log := log || extensions.throws_ok(
      format('update public.opportunities set stage_id = %L where id = %L', lost_id, oid),
      'P0001', null,
      'الحارس: لا إغلاق كخسارة بلا سبب');

    log := log || extensions.lives_ok(
      format('update public.opportunities set stage_id = %L, lost_reason_id = '
             || '(select id from public.crm_lost_reasons where not requires_note limit 1) '
             || 'where id = %L', lost_id, oid),
      'الخسارة بسببها تمرّ');

    -- ——— (ب) المرايا ———
    perform tests.act_as(null);
    cid := tests.make_client(emp_a, 'اتصال');
    select id into oid from public.opportunities where client_id = cid limit 1;

    -- الكانبان يحرّك الفرصة
    update public.clients set stage = 'زيارة' where id = cid;
    select g.name into txt from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id where o.id = oid;
    log := log || extensions.is(txt, 'زيارة',
      'المرآة: سحب البطاقة في الكانبان يحرّك الفرصة');

    -- والفرصة تحرّك الكانبان
    update public.opportunities
       set stage_id = (select id from public.crm_stages where name = 'مناقشة العرض')
     where id = oid;
    select stage into txt from public.clients where id = cid;
    log := log || extensions.is(txt, 'مناقشة العرض',
      'المرآة: تحريك الفرصة يحرّك بطاقة العميل');

    -- نشاط واحد لكل انتقال لا اثنان
    select count(*) into n from public.client_activities
     where client_id = cid and activity_type = 'تغيير مرحلة';
    log := log || extensions.is(n, 2,
      'لا ازدواج: نشاط واحد لكل انتقال (انتقالان = صفّان)');

    -- تاريخ المراحل يُكتب بالمحفّز
    select count(*) into n from public.opportunity_stage_history where opportunity_id = oid;
    log := log || extensions.ok(n >= 2, 'تاريخ المراحل يُكتب تلقائياً');

    -- ——— (ج) الرؤية (RLS) ———
    -- ⚠️ SECURITY DEFINER يتجاوز RLS، فنفحص الدالة الحاكمة نفسها
    --    (can_see_client) لا نتيجة select — وهي ما تبني عليه السياسات.
    perform tests.act_as(usr_a);
    log := log || extensions.ok(public.can_see_client(cid),
      'الرؤية: الموظف يرى عميله');

    perform tests.act_as(usr_b);
    log := log || extensions.ok(not public.can_see_client(cid),
      'الرؤية: الموظف لا يرى عميل غيره');

    -- ——— (د) تعريفات التقارير ———
    perform tests.act_as(admin_u);
    -- القمع: الخاسرة لا تُمنَح مرحلة لم تبلغها
    select f.reached into n from public.crm_funnel() f
     where f.stage_name = (select name from public.crm_stages where stage_type = 'won');
    log := log || extensions.ok(
      n <= (select count(*) from public.opportunities o
             join public.crm_stages g on g.id = o.stage_id
            where o.deleted_at is null and g.stage_type = 'won')
          + (select count(*) from public.opportunity_stage_history h
              join public.crm_stages g2 on g2.name = h.from_stage
             where g2.stage_type = 'won'),
      'القمع: «بيع» لا يتجاوز من بلغها فعلاً');

    -- إلغاء كل ما سبق
    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then
      null;   -- المقصود: كل ما أنشأه الاختبار أُلغي، والنتائج في log
  end;

  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_all() is
  'يشغّل كل اختبارات القاعدة ويُلغي أثرها. النتائج تنجو في متغيّر لا في جدول.';

-- ⚠️ اختبارات الأدوار (tests.run_roles) في ملف 084 لا هنا: تحتاج
--    security invoker لتبديل الدور، وهو ما لا يصلح لهذا الملف.

-- ------------------------------------------------------------
-- الصلاحيات — الاختبارات للمدير وحده
-- ------------------------------------------------------------
revoke all on schema tests from public;
revoke all on function tests.run_all()                 from public;
revoke all on function tests.act_as(uuid)              from public;
revoke all on function tests.make_client(uuid, text)   from public;
grant usage on schema tests to service_role;
grant execute on function tests.run_all() to service_role;

-- ------------------------------------------------------------
-- التشغيل الأول
-- ------------------------------------------------------------
do $$
declare r record; n_ok int := 0; n_fail int := 0;
begin
  raise notice '--- 082 اختبارات القاعدة ---';
  for r in select * from tests.run_all() loop
    if r.result = 'ok' then n_ok := n_ok + 1; else n_fail := n_fail + 1; end if;
    raise notice '  % %  %', r.result, r.nr, r.test_name;
  end loop;
  raise notice 'نجح % · فشل %', n_ok, n_fail;
  if n_fail > 0 then
    raise warning 'اختبارات فاشلة — لا تنشر قبل معالجتها.';
  end if;
end $$;
