-- ============================================================
-- تلال ERP — 168: اختبارات تطابق «فشل البيع» بين البطاقة والفرصة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_lost_card_sync();
--
-- نمط 082/142: معاملة فرعية تُلغى في النهاية. security invoker عمداً.
--
--   القاعدة     لا بطاقة «فشل البيع» على فرصة غير خاسرة — صفر على القاعدة الحيّة
--   المفتوحة    البطاقة لا تُنقل، والرسالة تدلّ على النموذج
--   الرابحة     الباب القديم «بيع» ثم «فشل البيع» مغلق
--   النموذج     إغلاق الفرصة الوحيدة يحرّك البطاقة، والعددان متطابقان
--   المتعدّدة   كل الفرص خاسرة ⇒ البطاقة تُنقل
--   التسوية     كل فرصة أغلقتها 167 لها صفّ «مُرحَّل» بلا فئة
--
-- يتطلب: 082 (tests.act_as)، 140، 167.
-- ============================================================

create or replace function tests.run_lost_card_sync()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
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
    -- ================= القاعدة على البيانات الحيّة =================
    log := log || extensions.is((select count(*)::int from public.crm_lost_card_drift()), 0,
      'لا بطاقة «فشل البيع» على فرصة غير خاسرة');

    -- ================= التهيئة =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار تطابق', v_phone, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli;
    select id into opp from public.opportunities where client_id = cli and deleted_at is null limit 1;
    if opp is null then
      insert into public.opportunities (client_id, stage_id, owner_id, project_id)
      values (cli, (select id from public.crm_stages where name = 'ليد'), plain_emp, proj) returning id into opp;
    end if;
    update public.opportunities set project_id = proj, expected_value = 100000000, stage_id = g_neg where id = opp;

    base := jsonb_build_object('category_id', c_price, 'reason_id', r_m2, 'loss_source', 'price',
                               'customer_potential', 'B', 'recovery_potential', 'none',
                               'details', 'اختبار تطابق البطاقة والفرصة');

    -- ================= المفتوحة =================
    perform tests.act_as(plain_u);
    begin
      update public.clients set stage = 'فشل البيع' where id = cli;
      log := log || extensions.fail('بطاقة فرصتها مفتوحة لا تُنقل إلى «فشل البيع»');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%فرصة مفتوحة%', 'بطاقة فرصتها مفتوحة لا تُنقل إلى «فشل البيع»');
    end;

    -- ================= الرابحة: «بيع» ثم «فشل البيع» =================
    update public.clients set stage = 'بيع' where id = cli;
    log := log || extensions.is(
      (select g.stage_type from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = opp),
      'won', 'البطاقة إلى «بيع» تجعل فرصتها الوحيدة رابحة (المرآة)');
    begin
      update public.clients set stage = 'فشل البيع' where id = cli;
      log := log || extensions.fail('بطاقة فرصتها رابحة لا تُنقل إلى «فشل البيع»');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%مسجّلة «بيع»%', 'بطاقة فرصتها رابحة لا تُنقل إلى «فشل البيع»');
    end;
    log := log || extensions.is((select stage from public.clients where id = cli), 'بيع',
      'المحاولة المرفوضة لم تغيّر البطاقة');

    -- ================= النموذج =================
    update public.clients set stage = 'مناقشة العرض' where id = cli;
    perform public.close_opportunity_lost(opp, base);
    log := log || extensions.ok(
      (select stage from public.clients where id = cli) = 'فشل البيع'
      and (select stage_id from public.opportunities where id = opp) = g_lost,
      'إغلاق الفرصة الوحيدة بالنموذج يحرّك البطاقة إلى «فشل البيع»');
    perform tests.act_as(null);
    log := log || extensions.is(
      (select count(*)::int from public.crm_lost_card_drift() where client_id = cli), 0,
      'البطاقة والفرصة متطابقتان بعد النموذج');

    -- ================= المتعدّدة =================
    perform tests.act_as(admin_u);
    insert into public.clients (name, phone, stage, owner_id, source, governorate, project_id)
    values ('اختبار تطابق ٢', v_phone2, 'ليد', plain_emp, 'سوشيل ميديا', 'بغداد', proj)
    returning id into cli2;
    select id into opp from public.opportunities where client_id = cli2 and deleted_at is null limit 1;
    if opp is null then
      insert into public.opportunities (client_id, stage_id, owner_id, project_id)
      values (cli2, (select id from public.crm_stages where name = 'ليد'), plain_emp, proj) returning id into opp;
    end if;
    insert into public.opportunities (client_id, stage_id, owner_id, project_id)
    values (cli2, g_neg, plain_emp, proj) returning id into opp2;

    perform public.close_opportunity_lost(opp, base);
    begin
      update public.clients set stage = 'فشل البيع' where id = cli2;
      log := log || extensions.fail('فرصة خاسرة وأخرى مفتوحة: البطاقة لا تُنقل');
    exception when others then
      log := log || extensions.ok(sqlerrm like '%فرصة مفتوحة%', 'فرصة خاسرة وأخرى مفتوحة: البطاقة لا تُنقل');
    end;
    perform public.close_opportunity_lost(opp2, base);
    update public.clients set stage = 'فشل البيع' where id = cli2;
    log := log || extensions.is((select stage from public.clients where id = cli2), 'فشل البيع',
      'كل الفرص خاسرة ⇒ البطاقة تُنقل إلى «فشل البيع»');

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
end $$;

comment on function tests.run_lost_card_sync() is
  'اختبارات تطابق «فشل البيع» بين بطاقة العميل وفرصته: الحارس للمفتوحة والرابحة، النموذج، الفرص المتعدّدة، التسوية (sql/168). يُلغي أثره.';

revoke all on function tests.run_lost_card_sync() from public;
grant execute on function tests.run_lost_card_sync() to service_role;
