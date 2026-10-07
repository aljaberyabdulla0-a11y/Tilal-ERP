-- ============================================================
-- تلال ERP — 169b: اختبارات الدمج بالتطابق (169)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_merge_by_match();
--
-- نمط 082/168: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   الاسم       «أحمد  علي» = «احمد علي»، وكلمة واحدة ليست تطابقاً
--   الرقم       موظف يدمج بطاقة زميل بالرقم نفسه، والعميل للأقدم
--   الحسابان    صاحب البطاقة الخاسرة يراها بعد الدمج (الدالة وRLS) ويُشعَر
--   الاسم نفسه  تطابق حرفي يدمج مباشرة، و«خذ المالك» لا يكسب عميل الزميل
--   بلا تطابق   بطاقتاه بلا رقم ولا اسم مشترك ⇒ طلب، والدمج يُرفض
--   الطلب       يصل إشعاراً لمشرف الفريق، ويراه، ويدمج بموافقته
--   ليسا واحداً يُرجع الزوج المتطابق طلباً
--
-- يتطلب: 082 (tests.act_as)، 104، 169.
-- ============================================================

create or replace function tests.run_merge_by_match()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid;
  u1 uuid; emp1 uuid; proj1 uuid;
  u2 uuid; emp2 uuid;
  sup_u uuid;
  proj uuid;
  ca uuid; cb uuid; cc uuid; cd uuid; ce uuid; cf uuid; cg uuid; ch uuid; ci uuid;
  n int; txt text;
  i int := 0;
  tag text := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
  ph1 text := '0771' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph2 text := '0772' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph3 text := '0773' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph4 text := '0774' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph5 text := '0775' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph6 text := '0776' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph7 text := '0777' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
  ph8 text := '0778' || lpad((floor(random() * 9000000) + 1000000)::text, 7, '0');
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  -- الموظف الأول: في فريقٍ له مشرف إن وُجد
  select p.id, e.id, e.project_id, s.user_id into u1, emp1, proj1, sup_u
    from public.profiles p
    join public.employees e on e.user_id = p.id
    left join public.projects pj on pj.id = e.project_id
    left join public.employees s on s.id = pj.supervisor_id and s.user_id is not null and s.id <> e.id
   where p.role = 'employee' and e.status = 'active'
   order by (s.user_id is not null) desc, p.created_at
   limit 1;
  -- الزميل: من فريق آخر إن أمكن
  select p.id, e.id into u2, emp2
    from public.profiles p join public.employees e on e.user_id = p.id
   where p.role = 'employee' and e.status = 'active' and e.id <> emp1
   order by (e.project_id is distinct from proj1) desc, p.created_at
   limit 1;
  select id into proj from public.projects order by created_at limit 1;

  if admin_u is null or u1 is null or u2 is null or proj is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بملفّين ومشروع'::text;
    return;
  end if;

  begin
    -- ================= الاسم =================
    log := log || extensions.is(public.person_name_key('أحمد  علي'), public.person_name_key('احمد علي'),
      'توحيد الاسم: المسافات والهمزة');
    log := log || extensions.is(public.person_name_key('فاطمة حسن'), public.person_name_key('فاطمه حسن'),
      'توحيد الاسم: التاء المربوطة');

    -- ================= التهيئة: البطاقات =================
    perform tests.act_as(admin_u);
    -- الرقم نفسه: B للزميل أقدم، A للموظف أحدث
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id, created_at)
    values ('اختبار دمج زميل ' || tag, ph1, 'ليد', emp2, 'سوشيل ميديا', 'بغداد', proj, now() - interval '10 days')
    returning id into cb;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id, created_at)
    values ('اختبار دمج موظف ' || tag, ph1, 'ليد', emp1, 'سوشيل ميديا', 'بغداد', proj, now())
    returning id into ca;
    -- الاسم نفسه بكتابتين: E للزميل أقدم، C للموظف
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id, created_at)
    values ('فاطمه اختبار ' || tag, ph2, 'ليد', emp2, 'سوشيل ميديا', 'بغداد', proj, now() - interval '5 days')
    returning id into ce;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id, created_at)
    values ('فاطمة  اختبار ' || tag, ph3, 'ليد', emp1, 'سوشيل ميديا', 'بغداد', proj, now())
    returning id into cc;
    -- بطاقتان للموظف بلا تطابق
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار بلا تطابق ' || tag, ph4, 'ليد', emp1, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cd;
    -- كلمة واحدة: للموظف وللزميل
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('سرمد' || tag, ph5, 'ليد', emp1, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cf;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('سرمد' || tag, ph6, 'ليد', emp2, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cg;
    -- الرقم نفسه ثم «ليسا واحداً»
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار ليسا واحدا أ ' || tag, ph7, 'ليد', emp1, 'سوشيل ميديا', 'بغداد', proj)
    returning id into ch;
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار ليسا واحدا ب ' || tag, ph7, 'ليد', emp2, 'سوشيل ميديا', 'بغداد', proj)
    returning id into ci;

    log := log || extensions.is(public.client_merge_mode(cd, cg), 'direct', 'الإدارة تدمج أيّ زوج');

    -- ================= الوضع للموظف =================
    perform tests.act_as(u1);
    log := log || extensions.is(public.client_merge_mode(ca, cb), 'direct', 'الرقم نفسه مع بطاقة زميل ⇒ دمج مباشر');
    log := log || extensions.is(public.client_merge_mode(cc, ce), 'direct', 'الاسم نفسه حرفياً مع بطاقة زميل ⇒ دمج مباشر');
    log := log || extensions.is(public.client_merge_mode(cc, cd), 'request', 'بطاقتاه بلا رقم ولا اسم مشترك ⇒ طلب');
    log := log || extensions.is(public.client_merge_mode(cf, cg), 'request', 'اسمٌ من كلمة واحدة ليس تطابقاً ⇒ طلب');
    log := log || extensions.ok(
      exists (select 1 from public.find_client_matches(ph1, null, null, ca) m where m.id = cb and m.can_merge),
      'شريط التنبيه يعرض بطاقة الزميل بالرقم نفسه قابلةً للدمج');
    log := log || extensions.ok(
      exists (select 1 from public.find_client_matches(null, null, 'فاطمة اختبار ' || tag, null) m
               where m.id = ce and m.match_on = 'الاسم نفسه' and m.can_merge),
      'قبل الحفظ: الاسم نفسه عند زميل يظهر «محتمل» قابلاً للدمج');
    log := log || extensions.ok((public.client_merge_peer(ca, cb) -> 'client' ->> 'id')::uuid = cb,
      'شاشة المقارنة تقرأ بطاقة الزميل حين يحقّ الدمج');
    log := log || extensions.ok(public.client_merge_peer(cc, cg) is null,
      'ولا تقرأ بطاقة زميل بلا تطابق');

    begin
      perform public.merge_clients(cc, cd, '{}');
      log := log || extensions.fail('الدمج بلا تطابق يُرفض للموظف');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%لا تتطابق%', 'الدمج بلا تطابق يُرفض للموظف');
    end;

    -- ================= الرقم: العميل للأقدم، والمعلومات في الحسابين =================
    perform public.merge_clients(ca, cb, '{}');
    perform tests.act_as(null);
    log := log || extensions.is((select owner_id from public.clients where id = ca), emp2,
      'الباقية بطاقة الموظف، لكن العميل لصاحب البطاقة الأقدم (الزميل)');
    log := log || extensions.ok((select deleted_at is not null and merged_into = ca from public.clients where id = cb),
      'بطاقة الزميل طُويت في الباقية');
    log := log || extensions.ok(exists (select 1 from public.client_watchers where client_id = ca and employee_id = emp1),
      'الموظف صار يرى البطاقة (client_watchers)');
    log := log || extensions.ok(exists (select 1 from public.notifications
                                         where user_id = u2 and entity_id = ca and title like 'دُمجت بطاقة%'),
      'الزميل أُشعِر بالدمج');

    perform tests.act_as(u1);
    log := log || extensions.ok(public.can_see_client(ca), 'can_see_client: الموظف يرى البطاقة بعد أن صارت للزميل');
    set local role authenticated;
    select count(*) into n from public.clients where id = ca;
    reset role;
    log := log || extensions.is(n, 1, 'RLS: البطاقة في قائمة الموظف بعد الدمج');

    -- ================= الاسم نفسه: «خذ المالك» لا يكسب عميل الزميل =================
    -- الباقية بطاقة الزميل الأقدم، والموظف يطلب مالك بطاقته هو
    perform public.merge_clients(ce, cc, array['owner']);
    perform tests.act_as(null);
    log := log || extensions.is((select owner_id from public.clients where id = ce), emp2,
      'طلب «خذ المالك» من موظف لا يملك البطاقتين يُتجاهل — العميل للأقدم');
    log := log || extensions.ok(exists (select 1 from public.client_watchers where client_id = ce and employee_id = emp1),
      'وصاحب البطاقة الأحدث يبقى يراها');

    -- ================= ليسا واحداً =================
    perform tests.act_as(u1);
    log := log || extensions.is(public.client_merge_mode(ch, ci), 'direct', 'الرقم نفسه ⇒ مباشر (قبل القرار)');
    perform public.resolve_client_duplicate(ch, ci, 'ليسا واحداً');
    log := log || extensions.is(public.client_merge_mode(ch, ci), 'request', '«ليسا واحداً» يُرجع الزوج طلباً');

    -- ================= الطلب للمشرف =================
    perform public.request_client_merge(cf, cg, 'اختبار 169b');
    perform tests.act_as(null);
    log := log || extensions.ok(exists (select 1 from public.client_duplicates
                                         where client_a = least(cf, cg) and client_b = greatest(cf, cg)
                                           and status = 'جديد' and requested_by = u1),
      'الطلب مسجّل باسم الموظف');
    if sup_u is null then
      log := log || extensions.pass('لا مشرف لفريق الموظف — تخطّي اختبارات المشرف');
    else
      log := log || extensions.ok(exists (select 1 from public.notifications
                                           where user_id = sup_u and entity_id = least(cf, cg)
                                             and title = 'طلب دمج بطاقتين'),
        'مشرف الفريق أُشعِر بالطلب');
      perform tests.act_as(sup_u);
      set local role authenticated;
      select count(*) into n from public.client_duplicates
       where client_a = least(cf, cg) and client_b = greatest(cf, cg);
      reset role;
      log := log || extensions.is(n, 1, 'RLS: المشرف يرى الطلب في «الجودة»');
      log := log || extensions.is(public.client_merge_mode(cf, cg), 'direct', 'المشرف يدمج بموافقته على الطلب');
    end if;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات الدمج بالتطابق: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_merge_by_match() is
  'اختبارات الدمج بالتطابق: الرقم والاسم الحرفي، العميل للأقدم، الرؤية في الحسابين، الطلب للمشرف، «ليسا واحداً» (sql/169b). يُلغي أثره.';

revoke all on function tests.run_merge_by_match() from public;
grant execute on function tests.run_merge_by_match() to service_role;
