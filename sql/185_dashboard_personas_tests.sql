-- ============================================================
-- تلال ERP — 185: اختبارات «لوحة لكل شخص» (184)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_dashboard_personas();
--
-- معاملة فرعية تُلغى في النهاية (نمط 168/183)، فلا أثر على البيانات.
-- تختبر القواعد على أشخاص القاعدة الحيّة أنفسهم:
--
--   كل حساب له لوحة واحدة على الأقل
--   المدير: التنفيذية أولاً، وكل اللوحات معها
--   الوسيط: لوحته وحدها
--   منصب تسويق بدور موظف ← التسويق أساسية (وعدم تطابق)
--   منصب مبيعات بدور موظف ← المبيعات أساسية
--   مدير علاقات وسيط (rm_id) ← لسان «الوساطة»
--   دور مشرف ← لسان «فريقي»
--   التخصيص يغلب ثم يُرفع فيعود التلقائي؛ والقيم الغريبة تُهمل
--   غير المدير لا يخصّص ولا يقرأ قائمة الأشخاص؛ والوسيط لا يُعطى لوحة غيره
--
-- ⚠️ الهوية تُبدَّل بـ set_config بعد «set local role authenticated».
-- يتطلب: 082، 184.
-- ============================================================

create or replace function tests.run_dashboard_personas()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; sales_u uuid; mkt_u uuid; rm_u uuid; sup_u uuid; broker_u uuid;
  n int; j jsonb; v text[]; txt text; i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into broker_u from public.profiles where role = 'broker' order by created_at limit 1;
  select p.id into sales_u from public.profiles p
    join public.employees e on e.user_id = p.id and e.status = 'active'
    join public.positions ps on ps.id = e.position_id and ps.default_role_code = 'sales_employee'
   where p.role = 'employee' and (p.role_code is null or p.role_code = 'employee') order by p.created_at limit 1;
  select p.id into mkt_u from public.profiles p
    join public.employees e on e.user_id = p.id and e.status = 'active'
    join public.positions ps on ps.id = e.position_id and ps.default_role_code in ('marketing_manager', 'marketing_employee')
   where p.role = 'employee' and (p.role_code is null or p.role_code = 'employee') order by p.created_at limit 1;
  select p.id into rm_u from public.profiles p
    join public.employees e on e.user_id = p.id and e.status = 'active'
   where p.role in ('employee', 'supervisor')
     and exists (select 1 from public.broker_company_projects b where b.rm_id = e.id) order by p.created_at limit 1;
  select id into sup_u from public.profiles where role = 'supervisor' order by created_at limit 1;

  if admin_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير'::text;
    return;
  end if;

  begin
    -- ================= القواعد على كل الأشخاص =================
    select count(*) into n from public.profiles p
     where jsonb_array_length(public.dashboard_views_for(p.id, true)->'views') = 0;
    log := log || extensions.is(n, 0, 'كل حساب له لوحة واحدة على الأقل');

    j := public.dashboard_views_for(admin_u, true);
    log := log || extensions.is(j->'views'->>0, 'executive', 'المدير: التنفيذية أولاً');
    log := log || extensions.ok(j->'views' ?& array['team','sales','marketing','followup','rm','finance','hr'],
      'المدير: كل لوحات الأقسام معها');

    if broker_u is not null then
      log := log || extensions.is(public.dashboard_views_for(broker_u, true)->'views', '["broker"]'::jsonb,
        'الوسيط: لوحته وحدها');
    end if;

    if sales_u is not null then
      log := log || extensions.is(public.dashboard_views_for(sales_u, true)->>'primary', 'sales',
        'منصب «موظف مبيعات» بدور موظف ← المبيعات أساسية');
    end if;

    if mkt_u is not null then
      j := public.dashboard_views_for(mkt_u, true);
      log := log || extensions.is(j->>'primary', 'marketing', 'منصب تسويق بدور موظف ← التسويق أساسية');
      log := log || extensions.ok((j->>'mismatch')::boolean
                                  = not exists (select 1 from public.mkt_team mt join public.employees e on e.id = mt.employee_id
                                                 where e.user_id = mkt_u and mt.is_active),
        'عدم التطابق يُعلَّم ما دام لا يملك صلاحية قراءة التسويق');
    end if;

    if rm_u is not null then
      log := log || extensions.ok(public.dashboard_views_for(rm_u, true)->'views' ? 'rm',
        'مدير علاقات وسيط (rm_id) ← لسان «الوساطة»');
    end if;

    if sup_u is not null then
      log := log || extensions.ok(public.dashboard_views_for(sup_u, true)->'views' ? 'team',
        'دور مشرف ← لسان «فريقي»');
    end if;

    select count(*) into n from public.profiles p
     where p.role <> 'admin'
       and public.dashboard_views_for(p.id, true)->'views' ? 'executive'
       and not exists (select 1 from public.dashboard_assignments a where a.user_id = p.id);
    log := log || extensions.is(n, 0, 'التنفيذية لا تُعطى تلقائياً لغير المدير');

    -- ================= التخصيص =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    if sales_u is not null then
      perform public.set_dashboard_views(sales_u, array['marketing', 'nonsense', 'sales', 'marketing']);
      select a.views into v from public.dashboard_assignments a where a.user_id = sales_u;
      log := log || extensions.is(v, array['marketing', 'sales'], 'التخصيص يُحفظ بلا تكرار والقيم الغريبة تُهمل');

      perform set_config('request.jwt.claims', json_build_object('sub', sales_u, 'role', 'authenticated')::text, true);
      j := public.my_dashboard_views();
      log := log || extensions.ok(j->>'source' = 'override' and j->>'primary' = 'marketing',
        'تخصيص المدير يغلب الاختيار التلقائي');

      begin
        perform public.set_dashboard_views(sales_u, array['executive']);
        log := log || extensions.fail('غير المدير لا يخصّص لوحته');
      exception when others then
        log := log || extensions.ok(sqlerrm like '%للمدير وحده%', 'غير المدير لا يخصّص لوحته');
      end;

      begin
        perform * from public.dashboard_people();
        log := log || extensions.fail('غير المدير لا يقرأ قائمة الأشخاص');
      exception when others then
        log := log || extensions.ok(sqlerrm like '%للمدير وحده%', 'غير المدير لا يقرأ قائمة الأشخاص');
      end;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
      perform public.set_dashboard_views(sales_u, null);
      perform set_config('request.jwt.claims', json_build_object('sub', sales_u, 'role', 'authenticated')::text, true);
      j := public.my_dashboard_views();
      log := log || extensions.ok(j->>'source' = 'auto' and j->>'primary' = 'sales', 'رفع التخصيص يعيد التلقائي');

      perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
      begin
        perform public.set_dashboard_views(sales_u, array['broker']);
        log := log || extensions.fail('لوحة الوسيط لا تُعطى لموظف');
      exception when others then
        log := log || extensions.ok(sqlerrm like '%الوسيطة وحدها%', 'لوحة الوسيط لا تُعطى لموظف');
      end;
      begin
        perform public.set_dashboard_views(sales_u, array['nonsense']);
        log := log || extensions.fail('اختيارٌ بلا لوحة صالحة يُرفض');
      exception when others then
        log := log || extensions.ok(sqlerrm like '%لا لوحة صالحة%', 'اختيارٌ بلا لوحة صالحة يُرفض');
      end;
    end if;

    if broker_u is not null then
      begin
        perform public.set_dashboard_views(broker_u, array['executive']);
        log := log || extensions.fail('الوسيط لا يُعطى لوحة داخلية');
      exception when others then
        log := log || extensions.ok(sqlerrm like '%لوحتها وحدها%', 'الوسيط لا يُعطى لوحة داخلية');
      end;
    end if;

    select count(*) into n from public.dashboard_people();
    log := log || extensions.is(n, (select count(*)::int from public.profiles), 'قائمة المدير تشمل كل الحسابات');

    -- القراءة المباشرة: كلٌّ تخصيصه وحده
    if sales_u is not null then
      perform public.set_dashboard_views(sales_u, array['sales']);
      perform set_config('request.jwt.claims', json_build_object('sub', coalesce(mkt_u, rm_u, sup_u), 'role', 'authenticated')::text, true);
      select count(*) into n from public.dashboard_assignments where user_id = sales_u;
      log := log || extensions.is(n, 0, 'لا يقرأ أحدٌ تخصيص غيره');
    end if;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات اللوحات: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_dashboard_personas() is
  'اختبارات «لوحة لكل شخص» (184): القواعد على أشخاص القاعدة، والتخصيص وصلاحياته. يُلغي أثره.';

revoke all on function tests.run_dashboard_personas() from public;
grant execute on function tests.run_dashboard_personas() to service_role;
