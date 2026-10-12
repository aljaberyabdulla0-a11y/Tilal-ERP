-- ============================================================
-- تلال ERP — 209: إيراد المسار الرابح = عمولة تلال لا ثمن الوحدة
--
-- العَرَض (مراجعة ٢٠٢٦-١٠-١٣): opportunities.won_value — أساس REVENUE
--   و«الإيراد» في لوحة التحكم وأداء الموظفين والحملات والأهداف — يُكتب
--   بثمن الوحدة. مثال حيّ: ٣٨٥٫٩ مليوناً قيمة فوز، وعمولة تلال الفعلية
--   على البيع نفسه ١٫٩٣ مليوناً (sale_commissions.company_amount).
--   السبب منذ 072: sync_opportunity_from_reservation يكتب sale_price،
--   وprepare_opportunity يملأ الفارغ بـexpected_value (ثمن الوحدة).
--   وهذا ما يمنعه مبدأ 056: تلال وسيط، والإيراد عمولتها.
--
-- القاعدة:
--   won_value = مجموع company_amount غير المعكوس لمبيعات المسار المكتملة.
--   لا عمولة مسجّلة (بيع يدوي بلا حجز) ⇒ فارغ = غير معروف، لا ثمن الوحدة.
--   قيمة الصفقة (ثمن الوحدة) تبقى في expected_value و SALES_VALUE.
--
--   1) crm_journey_revenue(journey) — تعريفٌ واحد.
--   2) prepare_opportunity لا يملأ won_value بثمن الوحدة.
--   3) sync_opportunity_from_reservation يكتب العمولة عند «بيع مكتمل».
--   4) محفّز على sale_commissions: تسجيل العمولة أو تعديلها أو عكسها يحدّث المسار.
--   5) ترحيل المسارات الرابحة القائمة — وأحداث الفوز تتبعها (trg_crm_fact).
--   6) «لماذا نخسر؟» وتاريخ مبيعات العميل يقارنان قيمة الصفقة (ثمن الوحدة)
--      بقيمة الخسارة (ثمن الوحدة) — فيقرآن expected_value لا الإيراد.
--
-- لا يمسّ محرّك العمولات ولا القيود ولا الفواتير. آمن لإعادة التشغيل.
-- ============================================================

-- (١) التعريف الواحد
create or replace function public.crm_journey_revenue(p_journey_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select sum(sc.company_amount)
    from public.reservations r
    join public.sale_commissions sc on sc.reservation_id = r.id and sc.reversed_at is null
   where r.opportunity_id = p_journey_id and r.status = 'بيع مكتمل';
$$;
comment on function public.crm_journey_revenue(uuid) is
  'إيراد تلال من المسار: مجموع عمولة الشركة غير المعكوسة لمبيعاته المكتملة. فارغ = لا عمولة مسجّلة (209).';
revoke all on function public.crm_journey_revenue(uuid) from public, anon;
grant execute on function public.crm_journey_revenue(uuid) to authenticated;

do $p$
declare d text; d2 text;
begin
  -- (٢) prepare_opportunity: لا ثمن وحدة في الإيراد
  d := replace(pg_get_functiondef('public.prepare_opportunity()'::regprocedure), E'\r', '');
  if position('new.won_value := coalesce(new.won_value, new.expected_value);' in d) > 0 then
    d2 := replace(d, 'new.won_value := coalesce(new.won_value, new.expected_value);',
                     'new.won_value := new.won_value;  -- 209: الإيراد عمولة تلال (crm_journey_revenue) لا ثمن الوحدة');
    execute d2;
  end if;

  -- (٣) الحجز: «بيع مكتمل» يكتب العمولة
  d := replace(pg_get_functiondef('public.sync_opportunity_from_reservation()'::regprocedure), E'\r', '');
  if position('crm_journey_revenue' in d) = 0 then
    d2 := replace(d, 'won_value = coalesce(new.sale_price, expected_value)',
                     'won_value = public.crm_journey_revenue(o.id)');
    if d2 = d then raise exception '209: لم يُعثر على موضع الترقيع في sync_opportunity_from_reservation'; end if;
    execute d2;
  end if;

  -- (٦أ) «لماذا نخسر؟»: قيمة الرابحة قيمة صفقتها لا الإيراد
  d := replace(pg_get_functiondef('public.crm_lost_intelligence(jsonb)'::regprocedure), E'\r', '');
  if position('coalesce(o.won_value, o.expected_value) as won_value' in d) > 0 then
    d2 := replace(d, 'coalesce(o.won_value, o.expected_value) as won_value',
                     'o.expected_value as won_value');
    execute d2;
  end if;

  -- (٦ب) تاريخ مبيعات العميل: قيمة الصفقة
  d := replace(pg_get_functiondef('public.crm_client_sales_history'::regproc), E'\r', '');
  if position('coalesce(o.won_value, o.expected_value)' in d) > 0 or position('coalesce(won_value, expected_value)' in d) > 0 then
    d2 := replace(replace(d, 'coalesce(o.won_value, o.expected_value)', 'o.expected_value'),
                  'coalesce(won_value, expected_value)', 'expected_value');
    execute d2;
  end if;
end $p$;

-- (٤) العمولة تُسجَّل أو تُعدَّل أو تُعكس ⇒ إيراد المسار يتبعها
create or replace function public.sync_journey_revenue_from_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare j uuid;
begin
  select r.opportunity_id into j from public.reservations r
   where r.id = coalesce(new.reservation_id, old.reservation_id);
  if j is null then return null; end if;
  update public.opportunities o
     set won_value = public.crm_journey_revenue(j)
   where o.id = j
     and exists (select 1 from public.crm_stages g where g.id = o.stage_id and g.stage_type = 'won')
     and o.won_value is distinct from public.crm_journey_revenue(j);
  return null;
end $$;

drop trigger if exists trg_sync_journey_revenue on public.sale_commissions;
create trigger trg_sync_journey_revenue
  after insert or delete or update of company_amount, reversed_at, reservation_id on public.sale_commissions
  for each row execute function public.sync_journey_revenue_from_commission();

-- (٥) الترحيل
do $m$
declare n int; before_sum numeric; after_sum numeric;
begin
  if exists (select 1 from public.crm_journey_migration_runs where phase = '209') then
    return;
  end if;
  select sum(o.won_value) into before_sum from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id and g.stage_type = 'won' where o.deleted_at is null;

  update public.opportunities o
     set won_value = public.crm_journey_revenue(o.id)
    from public.crm_stages g
   where g.id = o.stage_id and g.stage_type = 'won'
     and o.won_value is distinct from public.crm_journey_revenue(o.id);
  get diagnostics n = row_count;

  select sum(o.won_value) into after_sum from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id and g.stage_type = 'won' where o.deleted_at is null;

  insert into public.crm_journey_migration_runs (phase, counts)
  values ('209', jsonb_build_object('journeys_updated', n, 'won_value_before', before_sum, 'won_value_after', after_sum,
          'commission_total', (select sum(company_amount) from public.sale_commissions where reversed_at is null)));
end $m$;

update public.crm_metrics
   set notes = 'منذ 209: won_value = عمولة تلال من sale_commissions (crm_journey_revenue)، لا ثمن الوحدة. بيعٌ بلا عمولة مسجّلة لا يُحسب إيراداً.',
       updated_at = now()
 where code in ('REVENUE', 'AVG_DEAL_VALUE');

do $$
declare v jsonb;
begin
  select counts into v from public.crm_journey_migration_runs where phase = '209';
  raise notice '209: %', v;
end $$;
