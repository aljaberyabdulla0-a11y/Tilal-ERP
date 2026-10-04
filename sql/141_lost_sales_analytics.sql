-- ============================================================
-- تلال ERP — 141: ذكاء الخسائر — «لماذا نخسر المبيعات؟»
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- دالة واحدة لكل التقارير: crm_lost_intelligence(مُرشِّحات)
--
-- لماذا واحدة: المؤشّرات والتفصيل والاتجاه والرؤى يجب أن تُقرأ من
-- نفس المجموعة بنفس المُرشِّحات. عشر دوال تعني عشر فرصٍ لأن يختلف
-- رقمان في الشاشة نفسها — وقد حدث ذلك في «معدّل الإغلاق» قبل 076.
--
-- ============================================================
-- التعريفات الملزمة
--
--   المجموعة   فرص المدة: كل فرصة أُغلقت فيها (ربحاً أو خسارة)، وكل
--              فرصة كانت مفتوحة في نهايتها. الفرصة تُعدّ مرة واحدة
--              بآخر نتيجة لها داخل المدة. فـ«الإجمالي = رابحة + خاسرة
--              + مفتوحة» دائماً.
--   Win Rate   رابحة ÷ (رابحة + خاسرة) — المفتوحة خارج المقام (§53)
--   Lost Rate  خاسرة ÷ (رابحة + خاسرة)
--   Won Value  won_value ثم expected_value للرابحة
--   Lost Value lost_value المجمَّدة يوم الخسارة (crm_lost_sales)، بأساسها
--   القابلة للاسترجاع  خاسرة مستوى استرجاعها is_recoverable (مرتفعة/متوسطة)
--   المسترجعة  رابحة في المدة سبقتها خسارة (outcome = recovered)
--   الأبعاد    للخاسرة: ما كان يوم الخسارة (المالك، المشروع، الحملة…)؛
--              للرابحة والمفتوحة: ما هو الآن.
--   مُرشِّحا الفئة والمنافس  يضيّقان الخسائر وحدها؛ الرابحة والمفتوحة
--              لا فئة لها ولا منافس.
--
-- ⚠️ بلا security definer — كما 076: كل قارئ يرى نطاقه عبر RLS على
--    v_crm_opportunities و crm_lost_sales و clients. الموظف يرى
--    خسائره، والمشرف فريقه، والإدارة الكل.
--
-- يتطلب: 140. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) v_crm_opportunities — عمودان في آخره
--    حملة العميل (079) حين لا حملة على الفرصة نفسها، ولحظة تأهيله
--    (074). الإضافة في الآخر وحده: create or replace view يقبلها ولا
--    يمسّ قارئاً قائماً. التعريف أدناه هو الحيّ حرفياً (095 + 092).
-- ------------------------------------------------------------
create or replace view public.v_crm_opportunities with (security_invoker = true) as
 SELECT o.id,
    o.client_id,
        CASE
            WHEN should_mask_client_pii() THEN mask_name(c.name)
            ELSE c.name
        END AS client_name,
    c.source AS client_source,
    o.owner_id,
    e.full_name AS owner_name,
    e.project_id AS team_id,
    o.project_id,
    p.name AS project_name,
    o.unit_id,
    o.source_id,
    COALESCE(src.name, c.source) AS source_name,
    o.campaign_id,
    o.stage_id,
    g.name AS stage_name,
    g.stage_type,
    g.sort_order AS stage_order,
    o.probability,
    o.expected_value,
        CASE
            WHEN (g.stage_type = 'open'::text) THEN ((COALESCE(o.expected_value, (0)::numeric) * COALESCE(o.probability, (0)::numeric)) / 100.0)
            ELSE (0)::numeric
        END AS weighted_value,
    o.won_value,
    o.lost_reason_id,
    lr.name AS lost_reason,
    o.created_at,
    o.closed_at,
    o.expected_close_date,
    o.stage_entered_at,
    o.last_activity_at,
    o.next_action_date,
    (EXTRACT(epoch FROM (now() - o.stage_entered_at)) / 86400.0) AS days_in_stage,
    (EXTRACT(epoch FROM (COALESCE(o.closed_at, now()) - o.created_at)) / 86400.0) AS days_open,
        CASE
            WHEN (o.closed_at IS NOT NULL) THEN (EXTRACT(epoch FROM (o.closed_at - o.created_at)) / 86400.0)
            ELSE NULL::numeric
        END AS sales_cycle_days,
    (EXTRACT(epoch FROM (now() - COALESCE(o.last_activity_at, o.created_at))) / 86400.0) AS days_silent,
    (o.next_action_date < baghdad_today()) AS is_overdue,
    c.lead_score,
    c.lead_temperature,
    c.campaign_id  AS client_campaign_id,
    c.qualified_at AS client_qualified_at
   FROM ((((((opportunities o
     JOIN crm_stages g ON ((g.id = o.stage_id)))
     JOIN clients c ON ((c.id = o.client_id)))
     LEFT JOIN crm_owner_directory() e(id, full_name, project_id, user_id) ON ((e.id = o.owner_id)))
     LEFT JOIN projects p ON ((p.id = o.project_id)))
     LEFT JOIN crm_sources src ON ((src.id = o.source_id)))
     LEFT JOIN crm_lost_reasons lr ON ((lr.id = o.lost_reason_id)))
  WHERE (o.deleted_at IS NULL);

-- ------------------------------------------------------------
-- 2) شرائح السعر — مفتاحٌ ثابت تترجمه الواجهة
-- ------------------------------------------------------------
create or replace function public.crm_price_band(v numeric)
returns text language sql immutable as $$
  select case
    when v is null or v <= 0 then 'unknown'
    when v < 200000000 then 'lt200'
    when v < 300000000 then '200_300'
    when v < 500000000 then '300_500'
    when v < 750000000 then '500_750'
    else '750p'
  end;
$$;

comment on function public.crm_price_band(numeric) is
  'شريحة قيمة الصفقة بالدينار: <200م، 200–300م، 300–500م، 500–750م، 750م+، unknown (141).';

-- ------------------------------------------------------------
-- 3) المحرّك
-- ------------------------------------------------------------
create or replace function public.crm_lost_intelligence(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  f          jsonb := coalesce(p_filters, '{}'::jsonb);
  d_from     date := nullif(f->>'from', '')::date;
  d_to       date := nullif(f->>'to', '')::date;
  t_from     timestamptz;
  t_to       timestamptz;
  m_from     timestamptz;   -- نافذة الاتجاه الشهري
  m_to       timestamptz;
  f_project  uuid := nullif(f->>'project_id', '')::uuid;
  f_owner    uuid := nullif(f->>'owner_id', '')::uuid;
  f_team     uuid := nullif(f->>'team_id', '')::uuid;
  f_source   text := nullif(f->>'source', '');
  f_campaign uuid := nullif(f->>'campaign_id', '')::uuid;
  f_size     text := nullif(f->>'unit_size', '');
  f_band     text := nullif(f->>'price_band', '');
  f_cat_none boolean := f->>'category_id' = 'none';
  f_category uuid := case when f->>'category_id' = 'none' then null else nullif(f->>'category_id', '')::uuid end;
  f_comp     uuid := nullif(f->>'competitor_id', '')::uuid;
  res        jsonb;
  ins        jsonb := '[]'::jsonb;
  -- ليس j: عمود dgj اسمه j، ومتغيّرٌ بنفس الاسم يجعل المرجع ملتبساً في الاستعلام الرئيس
  v_ins      jsonb;
  avg_lr     numeric;
  avg_qr     numeric;
  today      date := public.baghdad_today();
begin
  t_from := case when d_from is not null then d_from::timestamp at time zone 'Asia/Baghdad' end;
  t_to   := case when d_to   is not null then (d_to + 1)::timestamp at time zone 'Asia/Baghdad' end;
  m_from := coalesce(t_from, (date_trunc('month', today::timestamp) - interval '11 months') at time zone 'Asia/Baghdad');
  m_to   := coalesce(t_to, (today + 1)::timestamp at time zone 'Asia/Baghdad');

  with
  opp as (
    select o.id, o.client_name, o.owner_id, o.owner_name, o.team_id, o.project_id,
           o.source_name, coalesce(o.campaign_id, o.client_campaign_id) as campaign_id,
           o.stage_type, o.created_at, o.closed_at,
           coalesce(o.won_value, o.expected_value) as won_value, o.expected_value,
           o.last_activity_at, u.space_m2
      from public.v_crm_opportunities o
      left join public.units u on u.id = o.unit_id
  ),
  loss as (
    select l.*, cat.code as cat_code, r.name as rsn_ar, coalesce(r.name_en, r.name) as rsn_en,
           coalesce(rl.is_recoverable, false) as recoverable,
           coalesce(cp.is_qualified, true)    as qualified,
           coalesce(mc.name, l.competitor_name) as comp_name
      from public.crm_lost_sales l
      join opp on opp.id = l.opportunity_id
      left join public.crm_loss_categories cat   on cat.id = l.category_id
      left join public.crm_lost_reasons r        on r.id = l.reason_id
      left join public.crm_recovery_levels rl    on rl.code = l.recovery_potential
      left join public.crm_customer_potentials cp on cp.code = l.customer_potential
      left join public.mkt_competitors mc        on mc.id = l.competitor_id
  ),
  ev as (
    select l.opportunity_id, 'lost'::text as kind, l.lost_at as at_, l.id as loss_id
      from loss l
     where (t_from is null or l.lost_at >= t_from) and (t_to is null or l.lost_at < t_to)
    union all
    select o.id, 'won', o.closed_at, null
      from opp o
     where o.stage_type = 'won' and o.closed_at is not null
       and (t_from is null or o.closed_at >= t_from) and (t_to is null or o.closed_at < t_to)
  ),
  last_ev as (
    select distinct on (opportunity_id) * from ev order by opportunity_id, at_ desc
  ),
  pop as (
    select o.*, le.kind, le.loss_id
      from opp o
      left join last_ev le on le.opportunity_id = o.id
     where le.kind is not null
        or (o.created_at < coalesce(t_to, 'infinity'::timestamptz)
            and (o.stage_type = 'open' or (t_to is not null and o.closed_at >= t_to)))
  ),
  rws as (
    select p.id,
           coalesce(p.kind, 'open') as outcome,
           coalesce(l.owner_id, p.owner_id)       as owner_id,
           coalesce(l.owner_name, p.owner_name)   as owner_name,
           coalesce(l.team_id, p.team_id)         as team_id,
           coalesce(l.project_id, p.project_id)   as project_id,
           coalesce(l.source_name, p.source_name) as source_name,
           coalesce(l.campaign_id, p.campaign_id) as campaign_id,
           case when p.kind = 'lost' then l.lost_value
                when p.kind = 'won'  then p.won_value
                else p.expected_value end          as value,
           coalesce(l.area_m2, p.space_m2)         as area,
           l.id as loss_id, l.category_id, l.cat_code, l.reason_id, l.rsn_ar, l.rsn_en,
           l.loss_source, l.customer_potential, l.qualified, l.recovery_potential, l.recoverable,
           l.competitor_id, l.comp_name, l.lost_stage_name, l.lost_stage_order, l.furthest_milestone,
           l.lost_at, l.recontact_date, l.recontact_required, l.price_per_m2,
           l.competitor_price_per_m2, l.competitor_price, l.competitor_payment_plan, l.value_basis,
           p.client_name, p.last_activity_at,
           (p.kind = 'won' and exists (select 1 from public.crm_lost_sales x
                                        where x.opportunity_id = p.id and x.outcome = 'recovered')) as recovered
      from pop p
      left join loss l on l.id = p.loss_id
  ),
  fr as (
    select r.*, public.crm_price_band(r.value) as band,
           case when r.area > 0 then round(r.area)::int::text end as size_key,
           pj.name as project_name, cmp.name as campaign_name
      from rws r
      left join public.projects pj      on pj.id = r.project_id
      left join public.crm_campaigns cmp on cmp.id = r.campaign_id
     where (f_project  is null or r.project_id  = f_project)
       and (f_owner    is null or r.owner_id    = f_owner)
       and (f_team     is null or r.team_id     = f_team)
       and (f_source   is null or r.source_name = f_source)
       and (f_campaign is null or r.campaign_id = f_campaign)
       and (f_size     is null or (r.area > 0 and round(r.area)::int::text = f_size))
       and (f_band     is null or public.crm_price_band(r.value) = f_band)
       and (f_category is null or r.outcome <> 'lost' or r.category_id = f_category)
       and (not f_cat_none     or r.outcome <> 'lost' or r.category_id is null)
       and (f_comp     is null or r.outcome <> 'lost' or r.competitor_id = f_comp)
  ),
  lost as (select * from fr where outcome = 'lost'),
  n_lost as (select greatest(count(*), 0) as n from lost),
  -- الأبعاد كلها في تمريرة واحدة
  dg as (
    select case when grouping(project_id) = 0 then 'project'
                when grouping(owner_id)   = 0 then 'employee'
                when grouping(source_name) = 0 then 'source'
                when grouping(campaign_id) = 0 then 'campaign'
                when grouping(band)       = 0 then 'price_band'
                else 'unit_size' end as dim,
           coalesce(project_id::text, owner_id::text, source_name, campaign_id::text, band, size_key) as key,
           -- max() يجمع صفوف المجموعة كلها: الاسم يُؤخذ من بُعد المجموعة وحده
           case when grouping(project_id)  = 0 then max(project_name)
                when grouping(owner_id)    = 0 then max(owner_name)
                when grouping(campaign_id) = 0 then max(campaign_name) end as label,
           count(*)                                         as total,
           count(*) filter (where outcome = 'won')          as won,
           count(*) filter (where outcome = 'lost')         as lost,
           count(*) filter (where outcome = 'open')         as open,
           coalesce(sum(value) filter (where outcome = 'won'), 0)  as won_value,
           coalesce(sum(value) filter (where outcome = 'lost'), 0) as lost_value,
           count(*) filter (where outcome = 'lost' and recoverable) as recoverable,
           coalesce(sum(value) filter (where outcome = 'lost' and recoverable), 0) as recoverable_value,
           count(*) filter (where recovered)                as recovered,
           count(*) filter (where outcome = 'lost' and cat_code = 'price') as price_lost,
           count(*) filter (where outcome = 'lost' and qualified = false)  as unqualified_lost,
           count(*) filter (where outcome = 'lost' and loss_source = 'sales_employee') as sales_employee_lost,
           mode() within group (order by cat_code) filter (where outcome = 'lost' and cat_code is not null) as main_category
      from fr
     group by grouping sets ((project_id), (owner_id), (source_name), (campaign_id), (band), (size_key))
  ),
  dgj as (
    select dim, jsonb_build_object(
             'key', key, 'label', label, 'total', total, 'won', won, 'lost', lost, 'open', open,
             'won_value', won_value, 'lost_value', lost_value,
             'win_rate',  round(100.0 * won  / nullif(won + lost, 0), 1),
             'lost_rate', round(100.0 * lost / nullif(won + lost, 0), 1),
             'recoverable', recoverable, 'recoverable_value', recoverable_value,
             'recovered', recovered,
             'recovery_rate', round(100.0 * recovered / nullif(lost + recovered, 0), 1),
             'price_lost', price_lost, 'unqualified_lost', unqualified_lost,
             'sales_employee_lost', sales_employee_lost,
             'main_category', main_category) as j,
           lost, lost_value, total
      from dg
  ),
  -- الليدات بمصدرها وحملتها — الجودة تُقاس من أول القمع لا من الفرص وحدها
  leads as (
    select c.id, c.campaign_id, coalesce(nullif(btrim(c.source), ''), os.name) as source_name,
           c.qualified_at is not null as qualified
      from public.clients c
      left join public.crm_sources os on os.id = c.original_source_id
     where c.deleted_at is null
       and (t_from is null or c.created_at >= t_from) and (t_to is null or c.created_at < t_to)
       and (f_project  is null or c.project_id = f_project)
       and (f_owner    is null or c.owner_id   = f_owner)
       and (f_campaign is null or c.campaign_id = f_campaign)
       and (f_source   is null or coalesce(nullif(btrim(c.source), ''), os.name) = f_source)
  ),
  lead_src as (
    select source_name as key, count(*) as leads, count(*) filter (where qualified) as qualified
      from leads group by 1
  ),
  lead_camp as (
    select l.campaign_id::text as key, max(cp.name) as label, count(*) as leads,
           count(*) filter (where l.qualified) as qualified
      from leads l left join public.crm_campaigns cp on cp.id = l.campaign_id
     where l.campaign_id is not null group by 1
  ),
  -- الاتجاه الشهري بالأحداث: الخسارة بشهر وقوعها، والربح بشهر إغلاقه
  mev as (
    select date_trunc('month', l.lost_at at time zone 'Asia/Baghdad')::date as m, 'lost'::text as kind,
           l.lost_value as value, l.cat_code, coalesce(l.project_id, o.project_id) as project_id,
           l.comp_name, l.category_id, l.competitor_id,
           coalesce(l.owner_id, o.owner_id) as owner_id, coalesce(l.team_id, o.team_id) as team_id,
           coalesce(l.source_name, o.source_name) as source_name, coalesce(l.campaign_id, o.campaign_id) as campaign_id,
           coalesce(l.area_m2, o.space_m2) as area
      from loss l join opp o on o.id = l.opportunity_id
     where l.lost_at >= m_from and l.lost_at < m_to
    union all
    select date_trunc('month', o.closed_at at time zone 'Asia/Baghdad')::date, 'won', o.won_value, null,
           o.project_id, null, null, null, o.owner_id, o.team_id, o.source_name, o.campaign_id, o.space_m2
      from opp o
     where o.stage_type = 'won' and o.closed_at >= m_from and o.closed_at < m_to
  ),
  mf as (
    select * from mev
     where (f_project  is null or project_id  = f_project)
       and (f_owner    is null or owner_id    = f_owner)
       and (f_team     is null or team_id     = f_team)
       and (f_source   is null or source_name = f_source)
       and (f_campaign is null or campaign_id = f_campaign)
       and (f_size     is null or (area > 0 and round(area)::int::text = f_size))
       and (f_band     is null or public.crm_price_band(value) = f_band)
       and (f_category is null or kind <> 'lost' or category_id = f_category)
       and (not f_cat_none     or kind <> 'lost' or category_id is null)
       and (f_comp     is null or kind <> 'lost' or competitor_id = f_comp)
  )
  select jsonb_build_object(
    'filters', f,
    'period', jsonb_build_object('from', d_from, 'to', d_to,
                                 'trend_from', (m_from at time zone 'Asia/Baghdad')::date,
                                 'trend_to', ((m_to at time zone 'Asia/Baghdad')::date - 1)),
    'kpis', (select jsonb_build_object(
        'total', count(*),
        'won',   count(*) filter (where outcome = 'won'),
        'lost',  count(*) filter (where outcome = 'lost'),
        'open',  count(*) filter (where outcome = 'open'),
        'won_value',  coalesce(sum(value) filter (where outcome = 'won'), 0),
        'lost_value', coalesce(sum(value) filter (where outcome = 'lost'), 0),
        'open_value', coalesce(sum(value) filter (where outcome = 'open'), 0),
        'win_rate',  round(100.0 * count(*) filter (where outcome = 'won')
                           / nullif(count(*) filter (where outcome in ('won', 'lost')), 0), 1),
        'lost_rate', round(100.0 * count(*) filter (where outcome = 'lost')
                           / nullif(count(*) filter (where outcome in ('won', 'lost')), 0), 1),
        'recoverable_count', count(*) filter (where outcome = 'lost' and recoverable),
        'recoverable_value', coalesce(sum(value) filter (where outcome = 'lost' and recoverable), 0),
        'high_recovery_count', count(*) filter (where outcome = 'lost' and recovery_potential = 'high'),
        'recovered_count', count(*) filter (where recovered),
        'recovered_value', coalesce(sum(value) filter (where recovered), 0),
        'unanalysed', count(*) filter (where outcome = 'lost' and category_id is null),
        'unqualified_lost', count(*) filter (where outcome = 'lost' and qualified = false),
        'lost_without_value', count(*) filter (where outcome = 'lost' and value is null),
        'lost_value_estimated', coalesce(sum(value) filter (where outcome = 'lost' and value_basis = 'budget'), 0)
      ) from fr),
    'by_category', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(cat_code, 'unanalysed') as code, count(*) as n, coalesce(sum(value), 0) as value,
               round(100.0 * count(*) / nullif((select n from n_lost), 0), 1) as share,
               count(*) filter (where recoverable) as recoverable,
               count(*) filter (where recovery_potential = 'high') as high_recovery,
               mode() within group (order by rsn_ar) as top_reason_ar,
               mode() within group (order by rsn_en) as top_reason_en
          from lost group by 1) x),
    'by_reason', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select cat_code as code, rsn_ar as name_ar, rsn_en as name_en, count(*) as n,
               coalesce(sum(value), 0) as value,
               round(100.0 * count(*) / nullif((select n from n_lost), 0), 1) as share
          from lost where reason_id is not null
         group by cat_code, rsn_ar, rsn_en order by count(*) desc limit 10) x),
    'by_loss_source', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(loss_source, 'unanalysed') as code, count(*) as n, coalesce(sum(value), 0) as value,
               round(100.0 * count(*) / nullif((select n from n_lost), 0), 1) as share
          from lost group by 1) x),
    'by_potential', (select coalesce(jsonb_agg(x order by x.code), '[]'::jsonb) from (
        select coalesce(customer_potential, 'unanalysed') as code, count(*) as n, coalesce(sum(value), 0) as value
          from lost group by 1) x),
    'by_recovery', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(recovery_potential, 'unanalysed') as code, count(*) as n, coalesce(sum(value), 0) as value
          from lost group by 1) x),
    'by_stage', (select coalesce(jsonb_agg(x order by x.ord nulls last), '[]'::jsonb) from (
        select coalesce(lost_stage_name, '—') as stage, min(lost_stage_order) as ord, count(*) as n,
               coalesce(sum(value), 0) as value,
               round(100.0 * count(*) / nullif((select n from n_lost), 0), 1) as share,
               mode() within group (order by cat_code) filter (where cat_code is not null) as main_category
          from lost group by 1) x),
    'by_milestone', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(furthest_milestone, 'unknown') as code, count(*) as n, coalesce(sum(value), 0) as value,
               round(100.0 * count(*) / nullif((select n from n_lost), 0), 1) as share
          from lost group by 1) x),
    'by_project',   (select coalesce(jsonb_agg(j order by lost_value desc, lost desc), '[]'::jsonb) from dgj where dim = 'project'),
    'by_employee',  (select coalesce(jsonb_agg(j order by total desc), '[]'::jsonb) from dgj where dim = 'employee'),
    'by_price_band',(select coalesce(jsonb_agg(j), '[]'::jsonb) from dgj where dim = 'price_band'),
    'by_unit_size', (select coalesce(jsonb_agg(j order by (j->>'key') is null, nullif(j->>'key', '')::int), '[]'::jsonb)
                       from dgj where dim = 'unit_size'),
    'by_source', (select coalesce(jsonb_agg(
                     coalesce(d.j, jsonb_build_object('key', s.key, 'total', 0, 'won', 0, 'lost', 0, 'open', 0,
                                                      'won_value', 0, 'lost_value', 0))
                     || jsonb_build_object('key', coalesce(d.j->>'key', s.key),
                                           'leads', coalesce(s.leads, 0), 'qualified', coalesce(s.qualified, 0))
                     order by coalesce(s.leads, 0) desc, coalesce((d.j->>'total')::int, 0) desc), '[]'::jsonb)
                    from (select * from dgj where dim = 'source') d
                    -- full join يشترط مساواة قابلة للتجزئة؛ «is not distinct from» ليست كذلك
                    full join lead_src s on coalesce(s.key, '') = coalesce(d.j->>'key', '')),
    'by_campaign', (select coalesce(jsonb_agg(
                     coalesce(d.j, jsonb_build_object('total', 0, 'won', 0, 'lost', 0, 'open', 0,
                                                      'won_value', 0, 'lost_value', 0, 'price_lost', 0, 'unqualified_lost', 0))
                     || jsonb_build_object('key', coalesce(d.j->>'key', s.key),
                                           'label', coalesce(d.j->>'label', s.label),
                                           'leads', coalesce(s.leads, 0), 'qualified', coalesce(s.qualified, 0),
                                           'qualified_rate', round(100.0 * s.qualified / nullif(s.leads, 0), 1),
                                           'opp_per_lead', round(100.0 * coalesce((d.j->>'total')::numeric, 0) / nullif(s.leads, 0), 1))
                     order by coalesce((d.j->>'won_value')::numeric, 0) desc, coalesce(s.leads, 0) desc), '[]'::jsonb)
                    from (select * from dgj where dim = 'campaign' and j->>'key' is not null) d
                    full join lead_camp s on s.key = d.j->>'key'),
    'by_competitor', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(competitor_id::text, 'name:' || lower(btrim(comp_name))) as key,
               max(comp_name) as name, count(*) as n, coalesce(sum(value), 0) as value,
               mode() within group (order by rsn_ar) as main_reason_ar,
               mode() within group (order by rsn_en) as main_reason_en,
               round(avg(price_per_m2 - competitor_price_per_m2)
                     filter (where price_per_m2 is not null and competitor_price_per_m2 is not null)) as avg_m2_diff,
               round(avg(value - competitor_price)
                     filter (where value is not null and competitor_price is not null)) as avg_price_diff,
               string_agg(distinct competitor_payment_plan, ' · ') filter (where competitor_payment_plan is not null) as payment_plans,
               string_agg(distinct project_name, ' · ') filter (where project_name is not null) as projects
          from lost where competitor_id is not null or comp_name is not null
         group by 1) x),
    'recoverable', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id as opportunity_id, loss_id, client_name, project_name, value, cat_code, rsn_ar, rsn_en,
               recovery_potential, owner_name, last_activity_at, recontact_date,
               (today - (lost_at at time zone 'Asia/Baghdad')::date) as days_since_lost
          from lost where recoverable
         order by (recovery_potential = 'high') desc, recontact_date nulls last, value desc nulls last
         limit 200) x),
    'monthly', (select coalesce(jsonb_agg(x order by x.m), '[]'::jsonb) from (
        select m,
               count(*) filter (where kind = 'won')  as won,
               count(*) filter (where kind = 'lost') as lost,
               round(100.0 * count(*) filter (where kind = 'lost') / nullif(count(*), 0), 1) as lost_rate,
               coalesce(sum(value) filter (where kind = 'won'), 0)  as won_value,
               coalesce(sum(value) filter (where kind = 'lost'), 0) as lost_value,
               mode() within group (order by cat_code) filter (where kind = 'lost' and cat_code is not null) as top_category,
               (select p.name from public.projects p where p.id =
                  mode() within group (order by project_id) filter (where kind = 'lost')) as top_project,
               mode() within group (order by comp_name) filter (where kind = 'lost' and comp_name is not null) as top_competitor
          from mf group by m) x),
    'reason_trend', (select coalesce(jsonb_agg(x order by x.m, x.n desc), '[]'::jsonb) from (
        select m, coalesce(cat_code, 'unanalysed') as code, count(*) as n
          from mf where kind = 'lost' group by m, coalesce(cat_code, 'unanalysed')) x)
  ) into res;

  -- =========================================================
  -- الرؤى التلقائية — من الأرقام أعلاه وحدها
  --
  -- كل رؤية رمزٌ ومعاملات؛ الواجهة تصوغها بلغتها. العتبات محافظة عمداً:
  -- رؤيةٌ تُبنى على خسارتين تُعلّم الإدارة تجاهل الرؤى كلها.
  -- =========================================================

  -- (١) السبب الأول في آخر ٣٠ يوماً
  select jsonb_build_object('code', c.code, 'n', x.n, 'total', x.total,
                            'share', round(100.0 * x.n / x.total, 1))
    into v_ins
    from (select l.category_id, count(*) as n, sum(count(*)) over () as total
            from public.crm_lost_sales l
            join public.v_crm_opportunities o on o.id = l.opportunity_id
           where l.lost_at >= now() - interval '30 days' and l.category_id is not null
             and (f_project is null or coalesce(l.project_id, o.project_id) = f_project)
             and (f_owner   is null or l.owner_id = f_owner)
           group by l.category_id) x
    join public.crm_loss_categories c on c.id = x.category_id
   where x.total >= 3
   order by x.n desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'top_reason_30d', 'level', 'warn', 'params', v_ins));
  end if;

  -- (٢) مشروعٌ خسارته أعلى من متوسط المشاريع بعشر نقاط فأكثر
  select round(100.0 * sum((e->>'lost')::numeric) / nullif(sum((e->>'won')::numeric + (e->>'lost')::numeric), 0), 1)
    into avg_lr
    from jsonb_array_elements(res->'by_project') e;
  v_ins := null;
  select jsonb_build_object('project', e->>'label', 'key', e->>'key', 'lost_rate', (e->>'lost_rate')::numeric,
                            'avg', avg_lr, 'diff', round((e->>'lost_rate')::numeric - avg_lr, 1),
                            'lost_value', (e->>'lost_value')::numeric)
    into v_ins
    from jsonb_array_elements(res->'by_project') e
   where e->>'key' is not null
     and (e->>'won')::int + (e->>'lost')::int >= 5
     and (e->>'lost_rate')::numeric - avg_lr >= 10
   order by (e->>'lost_rate')::numeric - avg_lr desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'project_lost_rate', 'level', 'risk', 'params', v_ins));
  end if;

  -- (٣) نسبة المرتفعة الاسترجاع بين خسائر السبب الأول
  v_ins := null;
  select jsonb_build_object('code', e->>'code', 'n', (e->>'n')::int,
                            'high', (e->>'high_recovery')::int,
                            'share', round(100.0 * (e->>'high_recovery')::numeric / nullif((e->>'n')::numeric, 0), 1))
    into v_ins
    from jsonb_array_elements(res->'by_category') e
   where e->>'code' <> 'unanalysed' and (e->>'n')::int >= 3 and (e->>'high_recovery')::int > 0
   order by (e->>'n')::int desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'recoverable_in_top_reason', 'level', 'info', 'params', v_ins));
  end if;

  -- (٤) حملة بحجم ليدات كبير وجودة منخفضة (تأهيلها نصف المتوسط أو أقل)
  select round(100.0 * sum((e->>'qualified')::numeric) / nullif(sum((e->>'leads')::numeric), 0), 1)
    into avg_qr
    from jsonb_array_elements(res->'by_campaign') e;
  v_ins := null;
  select jsonb_build_object('campaign', e->>'label', 'key', e->>'key', 'leads', (e->>'leads')::int,
                            'qualified_rate', coalesce((e->>'qualified_rate')::numeric, 0), 'avg', avg_qr,
                            'opportunities', (e->>'total')::int, 'won', (e->>'won')::int)
    into v_ins
    from jsonb_array_elements(res->'by_campaign') e
   where (e->>'leads')::int >= 10 and avg_qr > 0
     and coalesce((e->>'qualified_rate')::numeric, 0) <= avg_qr / 2
   order by (e->>'leads')::int desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'campaign_low_quality', 'level', 'warn', 'params', v_ins));
  end if;

  -- (٥) المنافس الأكثر أخذاً لعملائنا
  v_ins := null;
  select jsonb_build_object('name', e->>'name', 'n', (e->>'n')::int, 'value', (e->>'value')::numeric,
                            'avg_m2_diff', (e->>'avg_m2_diff')::numeric)
    into v_ins
    from jsonb_array_elements(res->'by_competitor') e
   where (e->>'n')::int >= 2
   order by (e->>'n')::int desc, (e->>'value')::numeric desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'competitor_impact', 'level', 'risk', 'params', v_ins));
  end if;

  -- (٦) تغيّر حصّة سبب بين آخر شهرين في النافذة (٣ خسائر محلَّلة على الأقل في كلٍّ منهما)
  v_ins := null;
  with mm as (
    select (e->>'m')::date as m, e->>'code' as code, (e->>'n')::numeric as n
      from jsonb_array_elements(res->'reason_trend') e
     where e->>'code' <> 'unanalysed'
  ), last2 as (
    select distinct m from mm order by m desc limit 2
  ), tot as (
    select m, sum(n) as t from mm where m in (select m from last2) group by m
  ), sh as (
    select mm.m, mm.code, 100.0 * mm.n / tot.t as share
      from mm join tot on tot.m = mm.m
  ), cmp as (
    select cur.code, round(coalesce(prev.share, 0), 1) as prev_share, round(cur.share, 1) as cur_share,
           round(cur.share - coalesce(prev.share, 0), 1) as diff
      from sh cur
      left join sh prev on prev.code = cur.code and prev.m = (select min(m) from last2)
     where cur.m = (select max(m) from last2)
  )
  select jsonb_build_object('code', code, 'prev_share', prev_share, 'cur_share', cur_share, 'diff', diff,
                            'month', (select max(m) from last2))
    into v_ins
    from cmp
   where (select count(*) from last2) = 2
     and (select min(t) from tot) >= 3
     and abs(diff) >= 10
   order by abs(diff) desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'reason_shift',
      'level', case when (v_ins->>'diff')::numeric > 0 then 'warn' else 'info' end, 'params', v_ins));
  end if;

  -- (٧) موظف يحتاج تدريباً: معدّل خسارته فوق المتوسط بـ١٥ نقطة، أو خسائر سببها هو
  select round(100.0 * sum((e->>'lost')::numeric) / nullif(sum((e->>'won')::numeric + (e->>'lost')::numeric), 0), 1)
    into avg_lr
    from jsonb_array_elements(res->'by_employee') e;
  v_ins := null;
  select jsonb_build_object('employee', e->>'label', 'key', e->>'key', 'lost_rate', (e->>'lost_rate')::numeric,
                            'avg', avg_lr, 'closed', (e->>'won')::int + (e->>'lost')::int,
                            'sales_employee_lost', (e->>'sales_employee_lost')::int)
    into v_ins
    from jsonb_array_elements(res->'by_employee') e
   where e->>'key' is not null
     and (e->>'won')::int + (e->>'lost')::int >= 5
     and ((e->>'lost_rate')::numeric - avg_lr >= 15 or (e->>'sales_employee_lost')::int >= 2)
   order by (e->>'sales_employee_lost')::int desc, (e->>'lost_rate')::numeric desc limit 1;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'employee_training', 'level', 'warn', 'params', v_ins));
  end if;

  -- (٨) خسائر بلا تحليل — فجوة البيانات تُقال لا تُخفى
  if (res->'kpis'->>'unanalysed')::int > 0 then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'unanalysed', 'level', 'info', 'params',
      jsonb_build_object('n', (res->'kpis'->>'unanalysed')::int,
                         'share', round(100.0 * (res->'kpis'->>'unanalysed')::numeric
                                        / nullif((res->'kpis'->>'lost')::numeric, 0), 1))));
  end if;

  -- (٩) مواعيد إعادة تواصل فاتت ولم يُعَد تنشيط الفرصة
  v_ins := null;
  select jsonb_build_object('n', count(*), 'value', coalesce(sum(l.lost_value), 0))
    into v_ins
    from public.crm_lost_sales l
    join public.v_crm_opportunities o on o.id = l.opportunity_id
   where l.outcome = 'lost' and l.recontact_required and l.recontact_date < today
     and (f_project is null or coalesce(l.project_id, o.project_id) = f_project)
     and (f_owner   is null or l.owner_id = f_owner)
  having count(*) > 0;
  if v_ins is not null then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'recontact_overdue', 'level', 'risk', 'params', v_ins));
  end if;

  -- (١٠) خسائر غير مؤهّلة كثيرة = مشكلة جودة ليدات لا مشكلة بيع
  if (res->'kpis'->>'lost')::int >= 5
     and (res->'kpis'->>'unqualified_lost')::numeric / nullif((res->'kpis'->>'lost')::numeric
           - (res->'kpis'->>'unanalysed')::numeric, 0) >= 0.3 then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'unqualified_losses', 'level', 'warn', 'params',
      jsonb_build_object('n', (res->'kpis'->>'unqualified_lost')::int,
                         'share', round(100.0 * (res->'kpis'->>'unqualified_lost')::numeric
                                        / nullif((res->'kpis'->>'lost')::numeric - (res->'kpis'->>'unanalysed')::numeric, 0), 1))));
  end if;

  -- (١١) قيمة الخسارة مجهولة لكثير من الصفقات
  if (res->'kpis'->>'lost')::int > 0
     and (res->'kpis'->>'lost_without_value')::numeric / (res->'kpis'->>'lost')::numeric >= 0.25 then
    ins := ins || jsonb_build_array(jsonb_build_object('code', 'value_unknown', 'level', 'info', 'params',
      jsonb_build_object('n', (res->'kpis'->>'lost_without_value')::int,
                         'share', round(100.0 * (res->'kpis'->>'lost_without_value')::numeric
                                        / (res->'kpis'->>'lost')::numeric, 1))));
  end if;

  return res || jsonb_build_object('insights', ins, 'generated_at', now());
end $$;

comment on function public.crm_lost_intelligence(jsonb) is
  'ذكاء الخسائر: المؤشّرات والتفصيل بكل بُعد والاتجاه الشهري والرؤى التلقائية بمُرشِّحات موحّدة (from, to, project_id, owner_id, team_id, source, campaign_id, unit_size, price_band, category_id|none, competitor_id). invoker: RLS تسري (141).';

-- ------------------------------------------------------------
-- 4) تاريخ مبيعات العميل — لا يُعدّ العميل «خاسراً» لأن صفقةً خسرت
-- ------------------------------------------------------------
create or replace function public.crm_client_sales_history(p_client_id uuid)
returns jsonb language sql stable set search_path = public as $$
  with o as (
    select * from public.v_crm_opportunities where client_id = p_client_id
  ), l as (
    select v.* from public.v_crm_lost_sales v where v.client_id = p_client_id
  )
  select jsonb_build_object(
    'total', (select count(*) from o),
    'won',   (select count(*) from o where stage_type = 'won'),
    'lost',  (select count(*) from o where stage_type = 'lost'),
    'open',  (select count(*) from o where stage_type = 'open'),
    'won_value',  (select coalesce(sum(coalesce(won_value, expected_value)), 0) from o where stage_type = 'won'),
    'lost_value', (select coalesce(sum(lost_value), 0) from l where outcome = 'lost'),
    'recovered',  (select count(*) from l where outcome = 'recovered'),
    'recovered_value', (select coalesce(sum(recovered_value), 0) from l where outcome = 'recovered'),
    'opportunities', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'title', coalesce(o.project_name, '—'), 'stage_name', o.stage_name,
          'stage_type', o.stage_type, 'value', case when o.stage_type = 'won' then coalesce(o.won_value, o.expected_value) else o.expected_value end,
          'created_at', o.created_at, 'closed_at', o.closed_at,
          'losses', (select count(*) from l where l.opportunity_id = o.id),
          'reactivated', exists (select 1 from l where l.opportunity_id = o.id and l.outcome in ('reactivated', 'recovered', 'relost'))
        ) order by o.created_at desc), '[]'::jsonb) from o),
    'losses', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', l.id, 'opportunity_id', l.opportunity_id, 'lost_at', l.lost_at, 'loss_no', l.loss_no,
          'category_code', coalesce(l.category_code, 'unanalysed'),
          'category_name_ar', l.category_name_ar, 'category_name_en', l.category_name_en,
          'reason_name_ar', l.reason_name_ar, 'reason_name_en', l.reason_name_en,
          'lost_stage_name', l.lost_stage_name, 'lost_value', l.lost_value, 'outcome', l.outcome,
          'project_name', l.project_name, 'competitor', l.competitor_display_name
        ) order by l.lost_at desc), '[]'::jsonb) from l)
  );
$$;

revoke all on function public.crm_price_band(numeric)            from public, anon;
revoke all on function public.crm_lost_intelligence(jsonb)       from public, anon;
revoke all on function public.crm_client_sales_history(uuid)     from public, anon;
grant execute on function public.crm_price_band(numeric)         to authenticated, service_role;
grant execute on function public.crm_lost_intelligence(jsonb)    to authenticated, service_role;
grant execute on function public.crm_client_sales_history(uuid)  to authenticated, service_role;

notify pgrst, 'reload schema';
