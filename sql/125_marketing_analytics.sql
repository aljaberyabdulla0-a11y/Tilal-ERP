-- ============================================================
-- تلال ERP — 125: التسويق ٤ — المؤشّرات والتحليل
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== تعريفٌ واحد لكل رقم =====
--
-- كل رقم في لوحات التسويق وتقاريره ومساعده يأتي من هنا. الواجهة
-- تنقل ولا تحسب — كما في src/lib/crm.ts.
--
--   كلفة التسويق   = المصروفات المدفوعة (الدفتر 5700) + المواد المصروفة بكلفتها
--   مصروف الإعلان  = المدفوع في تصنيفات «إعلانات …» — مقام ROAS
--   مصروف المنصّة  = ما تقوله ميتا/جوجل (mkt_metrics_daily) — للنقر والظهور، لا للكلفة
--   الليد          = صفّ clients أُنشئ في المدة (بتوقيت بغداد)، غير محذوف ولا مدموج
--   المؤهَّل       = ليد له qualified_at (079)
--   تواصل/زيارة/عرض = ليدٌ بلغت إحدى فرصه مرحلة «اتصال»/«زيارة»/«مناقشة العرض» (حالياً أو تاريخاً)
--   الحجز          = ليدٌ له حجز
--   البيع          = صفّ sale_commissions غير مفسوخ، بتاريخ تأكيد المقدمة
--   الإيراد        = عمولة تلال (company_amount) — لا ثمن الوحدة
--   قيمة البيع     = ثمن الوحدة (deal_amount) — يُعرض باسمه ولا يُسمّى إيراداً
--
--   CPL  = الكلفة ÷ الليدات          CPQL = الكلفة ÷ المؤهَّلين
--   CPA  = الكلفة ÷ الحجوزات         CAC  = الكلفة ÷ البيعات
--   CTR  = النقر ÷ الظهور            CPC  = مصروف المنصّة ÷ النقر
--   ROAS = العمولة المنسوبة ÷ مصروف الإعلان
--   ROI  = (العمولة المنسوبة − الكلفة) ÷ الكلفة
--
-- القسمة على صفر = NULL لا صفر: «كلفة الليد صفر» تعني مجّاناً، والحقيقة
-- «لا ليدات» — والفرق قرار ميزانية (مبدأ 079).
--
-- ===== فوجان لا فوج واحد =====
--
-- الليدات تُعدّ بتاريخ دخولها، والبيعات بتاريخ وقوعها. فـ«بيعات أكتوبر»
-- قد تكون من ليدات أغسطس. ونسبة «ليد ← بيع» تُحسب على فوج الليدات
-- وحده (من دخل في المدة كم صار بيعاً) لا بقسمة رقمين من فوجين.
--
-- ===== الصلاحية =====
--
-- definer + can_read_marketing_money() في كل دالّة: مجاميع لا أشخاص،
-- والتسويق لا يقرأ sale_commissions (انظر 124 §6).
--
-- يتطلب: 121، 122، 124. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الطبقة الأساس — ثلاث وقائع بأبعادها
-- ------------------------------------------------------------

-- (أ) الليدات بأبعادها التسويقية
create or replace function public.mkt_lead_facts(p_from date default null, p_to date default null)
returns table (
  client_id uuid, created_on date, campaign_id uuid, channel_id uuid, project_id uuid,
  activity_id uuid, influencer_deal_id uuid, content_id uuid, landing_page_id uuid, owner_employee_id uuid,
  qualified boolean, contacted boolean, visited boolean, offered boolean,
  reserved boolean, sold boolean
)
language sql stable security definer set search_path = public as $$
  with st as (
    select coalesce(max(sort_order) filter (where name = 'اتصال'), 2)       as o_contact,
           coalesce(max(sort_order) filter (where name = 'زيارة'), 3)       as o_visit,
           coalesce(max(sort_order) filter (where name = 'مناقشة العرض'), 4) as o_offer
      from public.crm_stages
  ),
  base as (
    select c.* from public.clients c
     where public.can_read_marketing_money()
       and c.deleted_at is null and c.merged_into is null
       and (p_from is null or (c.created_at at time zone 'Asia/Baghdad')::date >= p_from)
       and (p_to   is null or (c.created_at at time zone 'Asia/Baghdad')::date <= p_to)
  ),
  ft as (   -- أول لمسة لكل ليد
    select distinct on (t.client_id) t.client_id, t.campaign_id, t.channel_id, t.activity_id,
           t.influencer_deal_id, t.content_id, t.landing_page_id
      from public.mkt_touchpoints t
     where t.client_id in (select id from base)
     order by t.client_id, t.occurred_at
  ),
  reach as (   -- أعلى مرحلة بلغتها أيّ فرصة — حالاً أو تاريخاً، والخاسرة لا تُحسب «وصولاً»
    select o.client_id, max(g.sort_order) as ord
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.client_id in (select id from base) and o.deleted_at is null and g.stage_type <> 'lost'
     group by o.client_id
    union all
    select o.client_id, max(g.sort_order)
      from public.opportunities o
      join public.opportunity_stage_history h on h.opportunity_id = o.id
      join public.crm_stages g on g.id = h.to_stage_id
     where o.client_id in (select id from base) and g.stage_type <> 'lost'
     group by o.client_id
  ),
  reached as (select client_id, max(ord) as ord from reach group by client_id)
  select c.id,
         (c.created_at at time zone 'Asia/Baghdad')::date,
         coalesce(c.campaign_id, ft.campaign_id),
         coalesce(ft.channel_id, cp.channel_id,
                  (select ch.id from public.mkt_channels ch
                    where ch.source_id = c.original_source_id order by ch.sort_order limit 1)),
         coalesce(cp.project_id, c.project_id, c.preferred_project_id),
         ft.activity_id, ft.influencer_deal_id, ft.content_id, ft.landing_page_id,
         cp.owner_employee_id,
         c.qualified_at is not null,
         coalesce(rc.ord, 1) >= st.o_contact or coalesce(c.contact_count, 0) > 0,
         coalesce(rc.ord, 1) >= st.o_visit,
         coalesce(rc.ord, 1) >= st.o_offer,
         exists (select 1 from public.reservations r where r.client_id = c.id),
         exists (select 1 from public.sale_commissions sc where sc.client_id = c.id and sc.reversed_at is null)
    from base c
    cross join st
    left join ft on ft.client_id = c.id
    left join public.crm_campaigns cp on cp.id = coalesce(c.campaign_id, ft.campaign_id)
    left join reached rc on rc.client_id = c.id;
$$;

-- (ب) الكلفة بأبعادها: مصروفٌ مدفوع، أو مادّةٌ صُرفت
create or replace function public.mkt_cost_facts(p_from date default null, p_to date default null)
returns table (
  kind text, cost_date date, amount numeric, is_ad boolean, category text,
  campaign_id uuid, channel_id uuid, project_id uuid, activity_id uuid, influencer_deal_id uuid,
  vendor_id uuid, owner_employee_id uuid
)
language sql stable security definer set search_path = public as $$
  select 'مصروف', coalesce(e.paid_at, e.expense_date), e.amount_iqd,
         e.category like 'إعلانات%', e.category,
         coalesce(e.campaign_id, a.campaign_id, d.campaign_id),
         coalesce(e.channel_id, a.channel_id, cp.channel_id,
                  case when e.influencer_deal_id is not null
                       then (select id from public.mkt_channels where utm_source = 'influencer' limit 1) end),
         coalesce(e.project_id, cp.project_id, a.project_id),
         e.activity_id, e.influencer_deal_id, e.vendor_id, cp.owner_employee_id
    from public.mkt_expenses e
    left join public.mkt_activities a on a.id = e.activity_id
    left join public.mkt_influencer_deals d on d.id = e.influencer_deal_id
    left join public.crm_campaigns cp on cp.id = coalesce(e.campaign_id, a.campaign_id, d.campaign_id)
   where public.can_read_marketing_money()
     and e.status = 'مدفوع'
     and (p_from is null or coalesce(e.paid_at, e.expense_date) >= p_from)
     and (p_to   is null or coalesce(e.paid_at, e.expense_date) <= p_to)
  union all
  select 'مواد', m.moved_at, coalesce(m.total_price, 0), false, 'مواد مصروفة',
         coalesce(m.mkt_campaign_id, a.campaign_id),
         coalesce(a.channel_id, cp.channel_id),
         coalesce(cp.project_id, a.project_id),
         m.mkt_activity_id, null, null, cp.owner_employee_id
    from public.inventory_moves m
    left join public.mkt_activities a on a.id = m.mkt_activity_id
    left join public.crm_campaigns cp on cp.id = coalesce(m.mkt_campaign_id, a.campaign_id)
   where public.can_read_marketing_money()
     and m.kind = 'صرف' and (m.mkt_campaign_id is not null or m.mkt_activity_id is not null)
     and (p_from is null or m.moved_at >= p_from)
     and (p_to   is null or m.moved_at <= p_to);
$$;

revoke all on function public.mkt_lead_facts(date, date) from public, anon;
revoke all on function public.mkt_cost_facts(date, date) from public, anon;
grant execute on function public.mkt_lead_facts(date, date) to authenticated;
grant execute on function public.mkt_cost_facts(date, date) to authenticated;


-- ------------------------------------------------------------
-- 2) المؤشّرات — صفٌّ واحد بكل الأرقام
-- ------------------------------------------------------------
create or replace function public.mkt_kpis(
  p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null,
  p_model text default 'last'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_cost numeric; v_spend numeric; v_mat numeric; v_ad numeric; v_committed numeric;
  m record; l record; s record; v_scans bigint; v_views bigint;
  v_leads bigint;
begin
  if not public.can_read_marketing_money() then
    raise exception 'مؤشّرات التسويق لفريق التسويق والمالية';
  end if;

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where kind = 'مصروف'), 0),
         coalesce(sum(amount) filter (where kind = 'مواد'), 0),
         coalesce(sum(amount) filter (where is_ad), 0)
    into v_cost, v_spend, v_mat, v_ad
    from public.mkt_cost_facts(p_from, p_to) f
   where (p_project  is null or f.project_id  = p_project)
     and (p_campaign is null or f.campaign_id = p_campaign)
     and (p_channel  is null or f.channel_id  = p_channel);

  select coalesce(sum(e.amount_iqd), 0) into v_committed
    from public.mkt_expenses e
   where e.status = 'معتمد'
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
     and (p_project  is null or e.project_id  = p_project)
     and (p_campaign is null or e.campaign_id = p_campaign)
     and (p_channel  is null or e.channel_id  = p_channel);

  select coalesce(sum(spend), 0) as spend, coalesce(sum(impressions), 0) as impressions,
         coalesce(sum(reach), 0) as reach, coalesce(sum(clicks), 0) as clicks,
         coalesce(sum(link_clicks), 0) as link_clicks, coalesce(sum(leads), 0) as platform_leads,
         coalesce(sum(video_views), 0) as video_views, coalesce(sum(engagements), 0) as engagements,
         coalesce(sum(visitors), 0) as visitors
    into m
    from public.mkt_metrics_daily d
    left join public.crm_campaigns cp on cp.id = d.campaign_id
   where (p_from is null or d.metric_date >= p_from) and (p_to is null or d.metric_date <= p_to)
     and (p_project  is null or cp.project_id = p_project)
     and (p_campaign is null or d.campaign_id = p_campaign)
     and (p_channel  is null or d.channel_id  = p_channel)
     -- مستوى واحد لا ثلاثة: الإعلان والمحتوى والنشاط والصفحة. مجموع الحملة الإعلانية
     -- ومجموعتها وإعلانها معاً يضاعف الرقم ثلاثاً.
     and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب');

  select count(*) filter (where h.kind = 'مسح'), count(*) filter (where h.kind = 'زيارة')
    into v_scans, v_views
    from public.mkt_link_hits h
    left join public.mkt_tracking_links lk on lk.id = h.link_id
    left join public.mkt_landing_pages lp on lp.id = h.landing_page_id
   where (p_from is null or (h.hit_at at time zone 'Asia/Baghdad')::date >= p_from)
     and (p_to   is null or (h.hit_at at time zone 'Asia/Baghdad')::date <= p_to)
     and (p_project  is null or coalesce(lk.project_id, lp.project_id) = p_project)
     and (p_campaign is null or coalesce(lk.campaign_id, lp.campaign_id) = p_campaign)
     and (p_channel  is null or coalesce(lk.channel_id, lp.channel_id) = p_channel);

  select count(*) as leads,
         count(*) filter (where qualified) as qualified,
         count(*) filter (where contacted) as contacted,
         count(*) filter (where visited)   as visited,
         count(*) filter (where offered)   as offered,
         count(*) filter (where reserved)  as reserved,
         count(*) filter (where sold)      as sold
    into l
    from public.mkt_lead_facts(p_from, p_to) f
   where (p_project  is null or f.project_id  = p_project)
     and (p_campaign is null or f.campaign_id = p_campaign)
     and (p_channel  is null or f.channel_id  = p_channel);
  v_leads := l.leads;

  select coalesce(sum(weight), 0) as sales,
         coalesce(sum(weight * commission), 0) as commission,
         coalesce(sum(weight * deal_amount), 0) as sale_value,
         count(distinct reservation_id) as deals_touched
    into s
    from public.mkt_attributed_sales(p_model, p_from, p_to) a
   where (p_project  is null or a.project_id  = p_project)
     and (p_campaign is null or a.campaign_id = p_campaign)
     and (p_channel  is null or a.channel_id  = p_channel);

  return jsonb_build_object(
    'model', p_model,
    'cost', v_cost, 'spend', v_spend, 'materials', v_mat, 'ad_spend', v_ad, 'committed', v_committed,
    'platform_spend', m.spend, 'recon_gap', m.spend - v_ad,
    'impressions', m.impressions, 'reach', m.reach, 'clicks', m.clicks, 'link_clicks', m.link_clicks,
    'platform_leads', m.platform_leads, 'video_views', m.video_views, 'engagements', m.engagements,
    'visitors', m.visitors + v_views, 'scans', v_scans,
    'leads', l.leads, 'qualified', l.qualified, 'contacted', l.contacted, 'visited', l.visited,
    'offered', l.offered, 'reservations', l.reserved, 'cohort_sales', l.sold,
    'sales', round(s.sales, 2), 'commission', round(s.commission), 'sale_value', round(s.sale_value),
    'cpl',  case when l.leads > 0     and v_cost > 0 then round(v_cost / l.leads) end,
    'cpql', case when l.qualified > 0 and v_cost > 0 then round(v_cost / l.qualified) end,
    'cpa',  case when l.reserved > 0  and v_cost > 0 then round(v_cost / l.reserved) end,
    'cac',  case when s.sales > 0     and v_cost > 0 then round(v_cost / s.sales) end,
    'ctr',  case when m.impressions > 0 then round(m.clicks * 100.0 / m.impressions, 2) end,
    'cpc',  case when m.clicks > 0 and m.spend > 0 then round(m.spend / m.clicks) end,
    'lead_to_qualified',   case when v_leads > 0 then round(l.qualified * 100.0 / v_leads, 1) end,
    'lead_to_reservation', case when v_leads > 0 then round(l.reserved  * 100.0 / v_leads, 1) end,
    'lead_to_sale',        case when v_leads > 0 then round(l.sold      * 100.0 / v_leads, 1) end,
    'roas', case when v_ad > 0 then round(s.commission / v_ad, 2) end,
    'roi',  case when v_cost > 0 then round((s.commission - v_cost) * 100.0 / v_cost, 1) end,
    'roi_value', case when v_cost > 0 then round((s.sale_value - v_cost) * 100.0 / v_cost, 1) end
  );
end;
$fn$;

revoke all on function public.mkt_kpis(date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_kpis(date, date, uuid, uuid, uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 3) التفصيل ببُعد — حملة، قناة، مشروع، نشاط، مؤثر، محتوى، مورّد،
--    تصنيف، شهر، موظف (صاحب الحملة)، صفحة هبوط
--
-- البُعد الذي لا يحمله الليد (المورّد، التصنيف) يُرجع الكلفة وحدها —
-- و«ليدات المورّد» سؤالٌ بلا جواب صادق.
-- ------------------------------------------------------------
create or replace function public.mkt_breakdown(
  p_dim text, p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null,
  p_model text default 'last'
) returns table (
  dim_key text, label text, cost numeric, ad_spend numeric, platform_spend numeric,
  impressions bigint, clicks bigint, leads bigint, qualified bigint, reservations bigint,
  sales numeric, commission numeric, sale_value numeric,
  cpl numeric, cpql numeric, cac numeric, roas numeric, roi numeric
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_read_marketing_money() then
    raise exception 'لفريق التسويق والمالية';
  end if;
  if p_dim not in ('campaign', 'channel', 'project', 'activity', 'influencer', 'content',
                   'vendor', 'category', 'month', 'employee', 'landing') then
    raise exception 'بُعد غير معروف: %', p_dim;
  end if;

  return query
  with costs as (
    select case p_dim
             when 'campaign'   then f.campaign_id::text
             when 'channel'    then f.channel_id::text
             when 'project'    then f.project_id::text
             when 'activity'   then f.activity_id::text
             when 'influencer' then f.influencer_deal_id::text
             when 'vendor'     then f.vendor_id::text
             when 'category'   then f.category
             when 'month'      then to_char(f.cost_date, 'YYYY-MM')
             when 'employee'   then f.owner_employee_id::text
           end as k,
           sum(f.amount) as cost, sum(f.amount) filter (where f.is_ad) as ad
      from public.mkt_cost_facts(p_from, p_to) f
     where (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  leads as (
    select case p_dim
             when 'campaign'   then f.campaign_id::text
             when 'channel'    then f.channel_id::text
             when 'project'    then f.project_id::text
             when 'activity'   then f.activity_id::text
             when 'influencer' then f.influencer_deal_id::text
             when 'content'    then f.content_id::text
             when 'landing'    then f.landing_page_id::text
             when 'month'      then to_char(f.created_on, 'YYYY-MM')
             when 'employee'   then f.owner_employee_id::text
           end as k,
           count(*) as leads, count(*) filter (where f.qualified) as qualified,
           count(*) filter (where f.reserved) as reserved
      from public.mkt_lead_facts(p_from, p_to) f
     where p_dim not in ('vendor', 'category')
       and (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  sales as (
    select case p_dim
             when 'campaign'   then a.campaign_id::text
             when 'channel'    then a.channel_id::text
             when 'project'    then a.project_id::text
             when 'activity'   then a.activity_id::text
             when 'influencer' then a.influencer_deal_id::text
             when 'content'    then a.content_id::text
             when 'month'      then to_char(a.sale_date, 'YYYY-MM')
             when 'employee'   then (select cp.owner_employee_id::text from public.crm_campaigns cp where cp.id = a.campaign_id)
           end as k,
           sum(a.weight) as sales, sum(a.weight * a.commission) as commission,
           sum(a.weight * a.deal_amount) as sale_value
      from public.mkt_attributed_sales(p_model, p_from, p_to) a
     where p_dim not in ('vendor', 'category', 'landing')
       and (p_project is null or a.project_id = p_project)
       and (p_campaign is null or a.campaign_id = p_campaign)
       and (p_channel is null or a.channel_id = p_channel)
     group by 1
  ),
  metrics as (
    select case p_dim
             when 'campaign'   then d.campaign_id::text
             when 'channel'    then d.channel_id::text
             when 'project'    then cp.project_id::text
             when 'activity'   then case when d.entity_type = 'نشاط' then d.entity_id::text end
             when 'influencer' then case when d.entity_type = 'مؤثر' then d.entity_id::text end
             when 'content'    then coalesce(case when d.entity_type = 'محتوى' then d.entity_id::text end,
                                             (select ao.content_id::text from public.mkt_ad_objects ao
                                               where d.entity_type = 'إعلان' and ao.id = d.entity_id))
             when 'landing'    then case when d.entity_type = 'صفحة هبوط' then d.entity_id::text end
             when 'month'      then to_char(d.metric_date, 'YYYY-MM')
             when 'employee'   then cp.owner_employee_id::text
           end as k,
           sum(d.spend) as spend, sum(d.impressions)::bigint as impressions, sum(d.clicks)::bigint as clicks
      from public.mkt_metrics_daily d
      left join public.crm_campaigns cp on cp.id = d.campaign_id
     where p_dim not in ('vendor', 'category')
       and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب')
       and (p_from is null or d.metric_date >= p_from) and (p_to is null or d.metric_date <= p_to)
       and (p_project is null or cp.project_id = p_project)
       and (p_campaign is null or d.campaign_id = p_campaign)
       and (p_channel is null or d.channel_id = p_channel)
     group by 1
  ),
  keys as (
    select k from costs union select k from leads union select k from sales union select k from metrics
  ),
  j as (
    select ky.k,
           coalesce(c.cost, 0) as cost, coalesce(c.ad, 0) as ad, coalesce(m.spend, 0) as pspend,
           coalesce(m.impressions, 0) as impressions, coalesce(m.clicks, 0) as clicks,
           coalesce(l.leads, 0) as leads, coalesce(l.qualified, 0) as qualified,
           coalesce(l.reserved, 0) as reserved,
           coalesce(s.sales, 0) as sales, coalesce(s.commission, 0) as commission,
           coalesce(s.sale_value, 0) as sale_value
      from keys ky
      left join costs c   on c.k is not distinct from ky.k
      left join leads l   on l.k is not distinct from ky.k
      left join sales s   on s.k is not distinct from ky.k
      left join metrics m on m.k is not distinct from ky.k
  )
  select j.k,
         case
           when j.k is null then case p_dim when 'month' then '—' else 'غير منسوب' end
           when p_dim = 'campaign'   then (select name from public.crm_campaigns where id = j.k::uuid)
           when p_dim = 'channel'    then (select name from public.mkt_channels where id = j.k::uuid)
           when p_dim = 'project'    then (select name from public.projects where id = j.k::uuid)
           when p_dim = 'activity'   then (select title from public.mkt_activities where id = j.k::uuid)
           when p_dim = 'influencer' then (select i.name || coalesce(' — ' || cp.name, '')
                                             from public.mkt_influencer_deals d
                                             join public.mkt_influencers i on i.id = d.influencer_id
                                             left join public.crm_campaigns cp on cp.id = d.campaign_id
                                            where d.id = j.k::uuid)
           when p_dim = 'content'    then (select title from public.mkt_content where id = j.k::uuid)
           when p_dim = 'vendor'     then (select name from public.suppliers where id = j.k::uuid)
           when p_dim = 'employee'   then (select full_name from public.employees where id = j.k::uuid)
           when p_dim = 'landing'    then (select title from public.mkt_landing_pages where id = j.k::uuid)
           else j.k
         end,
         j.cost, j.ad, j.pspend, j.impressions, j.clicks, j.leads, j.qualified, j.reserved,
         round(j.sales, 2), round(j.commission), round(j.sale_value),
         case when j.leads > 0 and j.cost > 0 then round(j.cost / j.leads) end,
         case when j.qualified > 0 and j.cost > 0 then round(j.cost / j.qualified) end,
         case when j.sales > 0 and j.cost > 0 then round(j.cost / j.sales) end,
         case when j.ad > 0 then round(j.commission / j.ad, 2) end,
         case when j.cost > 0 then round((j.commission - j.cost) * 100.0 / j.cost, 1) end
    from j
   order by case when p_dim = 'month' then j.k end desc nulls last,
            j.commission desc, j.leads desc, j.cost desc;
end;
$fn$;

revoke all on function public.mkt_breakdown(text, date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_breakdown(text, date, date, uuid, uuid, uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 3ب) أداء الإعلانات — كل مستوى بمجموع ما تحته
--
-- ⚠️ المقاييس تُسجَّل على مستوى الإعلان (المزامنة تفعل ذلك). من سجّل
--    على المستويين معاً ضاعف الرقم في المجموعة — الشاشة تقول ذلك.
--    و«ليدات فعلية» = لمسات بإعلانها (روابط تحمل ad_object_id) لا ما
--    تدّعيه المنصّة.
-- ------------------------------------------------------------
create or replace function public.mkt_ad_performance(
  p_from date default null, p_to date default null, p_campaign uuid default null
) returns table (
  id uuid, level text, parent_id uuid, name text, external_id text, status text,
  campaign_id uuid, account_id uuid,
  spend numeric, impressions bigint, reach bigint, clicks bigint, platform_leads bigint, real_leads bigint,
  ctr numeric, cpc numeric, cpl numeric
)
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select o.id as root, o.id as node from public.mkt_ad_objects o
     where p_campaign is null or o.campaign_id = p_campaign
    union all
    select t.root, c.id from tree t join public.mkt_ad_objects c on c.parent_id = t.node
  ),
  m as (
    select d.entity_id, sum(d.spend) as spend, sum(d.impressions) as imp, sum(d.reach) as reach,
           sum(d.clicks) as clicks, sum(d.leads) as leads
      from public.mkt_metrics_daily d
     where d.entity_type in ('حملة إعلانية', 'مجموعة إعلانية', 'إعلان')
       and (p_from is null or d.metric_date >= p_from) and (p_to is null or d.metric_date <= p_to)
     group by d.entity_id
  ),
  tl as (
    select t.ad_object_id, count(distinct t.client_id) as n
      from public.mkt_touchpoints t
     where t.ad_object_id is not null
       and (p_from is null or (t.occurred_at at time zone 'Asia/Baghdad')::date >= p_from)
       and (p_to   is null or (t.occurred_at at time zone 'Asia/Baghdad')::date <= p_to)
     group by t.ad_object_id
  ),
  agg as (
    select o.id, o.level, o.parent_id, o.name, o.external_id, o.status, o.campaign_id, o.account_id,
           coalesce(sum(m.spend), 0) as spend, coalesce(sum(m.imp), 0)::bigint as imp,
           coalesce(sum(m.reach), 0)::bigint as reach, coalesce(sum(m.clicks), 0)::bigint as clicks,
           coalesce(sum(m.leads), 0)::bigint as pleads, coalesce(sum(tl.n), 0)::bigint as rleads
      from public.mkt_ad_objects o
      join tree t on t.root = o.id
      left join m on m.entity_id = t.node
      left join tl on tl.ad_object_id = t.node
     where public.can_read_marketing()
     group by o.id, o.level, o.parent_id, o.name, o.external_id, o.status, o.campaign_id, o.account_id
  )
  select a.id, a.level, a.parent_id, a.name, a.external_id, a.status, a.campaign_id, a.account_id,
         a.spend, a.imp, a.reach, a.clicks, a.pleads, a.rleads,
         case when a.imp > 0 then round(a.clicks * 100.0 / a.imp, 2) end,
         case when a.clicks > 0 and a.spend > 0 then round(a.spend / a.clicks) end,
         case when a.rleads > 0 and a.spend > 0 then round(a.spend / a.rleads) end
    from agg a
   order by a.level, a.spend desc;
$$;

revoke all on function public.mkt_ad_performance(date, date, uuid) from public, anon;
grant execute on function public.mkt_ad_performance(date, date, uuid) to authenticated;


-- ------------------------------------------------------------
-- 4) القمع — من الظهور إلى البيع، بنسبة كل خطوة
-- ------------------------------------------------------------
create or replace function public.mkt_funnel(
  p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null
) returns table (step int, code text, label text, value numeric, from_previous numeric, from_leads numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare k jsonb := public.mkt_kpis(p_from, p_to, p_project, p_campaign, p_channel, 'last');
begin
  return query
  with s(step, code, label, value) as (
    values (1,  'impressions', 'ظهور',            (k->>'impressions')::numeric),
           (2,  'reach',       'وصول',            (k->>'reach')::numeric),
           (3,  'clicks',      'نقرات',           (k->>'clicks')::numeric),
           (4,  'visitors',    'زوّار الصفحات',    (k->>'visitors')::numeric),
           (5,  'leads',       'ليدات',           (k->>'leads')::numeric),
           (6,  'qualified',   'مؤهَّلون',         (k->>'qualified')::numeric),
           (7,  'contacted',   'تمّ التواصل',      (k->>'contacted')::numeric),
           (8,  'visited',     'زيارة الموقع',     (k->>'visited')::numeric),
           (9,  'offered',     'عرض',             (k->>'offered')::numeric),
           (10, 'reservations','حجز',             (k->>'reservations')::numeric),
           (11, 'sales',       'بيع (من الفوج)',   (k->>'cohort_sales')::numeric)
  )
  select s.step, s.code, s.label, s.value,
         case when lag(s.value) over (order by s.step) > 0
              then round(s.value * 100.0 / lag(s.value) over (order by s.step), 1) end,
         case when s.step >= 5 and (k->>'leads')::numeric > 0
              then round(s.value * 100.0 / (k->>'leads')::numeric, 1) end
    from s order by s.step;
end;
$fn$;

revoke all on function public.mkt_funnel(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.mkt_funnel(date, date, uuid, uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 5) الاتجاه — يوم/أسبوع/شهر
-- ------------------------------------------------------------
create or replace function public.mkt_trend(
  p_grain text default 'month', p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null
) returns table (period date, cost numeric, leads bigint, qualified bigint, sales numeric, commission numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare v_from date; v_to date := coalesce(p_to, (now() at time zone 'Asia/Baghdad')::date);
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;
  if p_grain not in ('day', 'week', 'month') then raise exception 'الدقّة: day أو week أو month'; end if;
  v_from := coalesce(p_from, v_to - case p_grain when 'day' then 29 when 'week' then 83 else 364 end);

  return query
  with periods as (
    select generate_series(date_trunc(p_grain, v_from::timestamp), date_trunc(p_grain, v_to::timestamp),
                           ('1 ' || p_grain)::interval)::date as p
  ),
  c as (
    select date_trunc(p_grain, f.cost_date::timestamp)::date as p, sum(f.amount) as cost
      from public.mkt_cost_facts(v_from, v_to) f
     where (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  l as (
    select date_trunc(p_grain, f.created_on::timestamp)::date as p,
           count(*) as leads, count(*) filter (where f.qualified) as qualified
      from public.mkt_lead_facts(v_from, v_to) f
     where (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  s as (
    select date_trunc(p_grain, a.sale_date::timestamp)::date as p,
           sum(a.weight) as sales, sum(a.weight * a.commission) as commission
      from public.mkt_attributed_sales('last', v_from, v_to) a
     where (p_project is null or a.project_id = p_project)
       and (p_campaign is null or a.campaign_id = p_campaign)
       and (p_channel is null or a.channel_id = p_channel)
     group by 1
  )
  select periods.p, coalesce(c.cost, 0), coalesce(l.leads, 0), coalesce(l.qualified, 0),
         round(coalesce(s.sales, 0), 2), round(coalesce(s.commission, 0))
    from periods
    left join c on c.p = periods.p
    left join l on l.p = periods.p
    left join s on s.p = periods.p
   order by periods.p;
end;
$fn$;

revoke all on function public.mkt_trend(text, date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.mkt_trend(text, date, date, uuid, uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 6) التنبؤ — ثلاثة سيناريوهات من نِسب آخر ستّة أشهر
--
-- لا نموذج تعلّم: نِسبٌ تاريخية صريحة تُضرب في الميزانية. والأساس
-- يُرجَع مع النتيجة، فيُرى من أين جاء كل رقم. وحين لا تاريخ كافياً
-- (لا كلفة أو لا ليدات) يُقال ذلك ولا يُخترع رقم.
-- ------------------------------------------------------------
create or replace function public.mkt_forecast(
  p_monthly_budget numeric, p_months int default 3,
  p_project uuid default null, p_channel uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_to date := (now() at time zone 'Asia/Baghdad')::date;
  v_from date := v_to - 180;
  k jsonb; v_cpl numeric; q numeric; r numeric; s numeric; v_comm_per_sale numeric;
  v_out jsonb := '[]'::jsonb; sc record; v_budget numeric; v_leads numeric;
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;
  if coalesce(p_monthly_budget, 0) <= 0 or coalesce(p_months, 0) not between 1 and 24 then
    raise exception 'الميزانية الشهرية موجبة، والأشهر بين ١ و٢٤';
  end if;

  k := public.mkt_kpis(v_from, v_to, p_project, null, p_channel, 'last');
  v_cpl := (k->>'cpl')::numeric;
  if v_cpl is null then
    return jsonb_build_object('ok', false,
      'reason', 'لا كلفة أو لا ليدات في آخر ستّة أشهر — لا أساس لتنبؤ صادق. سجّل المصروفات أولاً.',
      'basis', k);
  end if;

  q := coalesce((k->>'lead_to_qualified')::numeric, 0) / 100;
  r := coalesce((k->>'lead_to_reservation')::numeric, 0) / 100;
  s := coalesce((k->>'lead_to_sale')::numeric, 0) / 100;
  v_comm_per_sale := case when (k->>'sales')::numeric > 0
                          then (k->>'commission')::numeric / (k->>'sales')::numeric end;

  for sc in select * from (values ('متحفّظ', 1.20, 0.80), ('أساسي', 1.00, 1.00), ('طموح', 0.85, 1.20))
                         as v(name, cpl_f, rate_f) loop
    v_budget := p_monthly_budget * p_months;
    v_leads := floor(v_budget / (v_cpl * sc.cpl_f));
    v_out := v_out || jsonb_build_object(
      'scenario', sc.name, 'cost', v_budget,
      'leads', v_leads,
      'qualified', floor(v_leads * q * sc.rate_f),
      'reservations', floor(v_leads * r * sc.rate_f),
      'sales', round(v_leads * s * sc.rate_f, 1),
      'commission', case when v_comm_per_sale is not null
                         then round(v_leads * s * sc.rate_f * v_comm_per_sale) end,
      'roi', case when v_comm_per_sale is not null
                  then round((v_leads * s * sc.rate_f * v_comm_per_sale - v_budget) * 100.0 / v_budget, 1) end);
  end loop;

  return jsonb_build_object('ok', true, 'months', p_months, 'monthly_budget', p_monthly_budget,
    'basis', jsonb_build_object('from', v_from, 'to', v_to, 'cpl', v_cpl,
      'lead_to_qualified', q * 100, 'lead_to_reservation', r * 100, 'lead_to_sale', s * 100,
      'commission_per_sale', round(v_comm_per_sale)),
    'scenarios', v_out);
end;
$fn$;

revoke all on function public.mkt_forecast(numeric, int, uuid, uuid) from public, anon;
grant execute on function public.mkt_forecast(numeric, int, uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 7) تقدّم الأهداف — الفعلي محسوب لا مكتوب
-- ------------------------------------------------------------
create or replace function public.mkt_objective_progress(p_plan uuid)
returns table (objective_id uuid, title text, kind text, metric_code text, target_value numeric,
               actual numeric, progress_pct numeric, on_track boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare p public.mkt_plans%rowtype; o record; k jsonb; v numeric; v_code text;
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;
  select * into p from public.mkt_plans where id = p_plan;
  if not found then return; end if;

  for o in select * from public.mkt_objectives where plan_id = p_plan order by sort_order, created_at loop
    v := null;
    if o.metric_code is not null then
      k := public.mkt_kpis(p.period_start, least(p.period_end, (now() at time zone 'Asia/Baghdad')::date),
                           coalesce(o.project_id, p.project_id), o.campaign_id, coalesce(o.channel_id, p.channel_id));
      v_code := case o.metric_code
                  when 'spend' then 'cost' when 'sales' then 'sales'
                  else o.metric_code end;
      v := (k->>v_code)::numeric;
    end if;
    objective_id := o.id; title := o.title; kind := o.kind; metric_code := o.metric_code;
    target_value := o.target_value; actual := v;
    progress_pct := case
      when v is null or o.target_value is null or o.target_value = 0 then null
      when o.direction = 'أعلى' then round(v * 100.0 / o.target_value, 1)
      else round(o.target_value * 100.0 / nullif(v, 0), 1) end;
    on_track := case when v is null or o.target_value is null then null
                     when o.direction = 'أعلى' then v >= o.target_value
                     else v <= o.target_value end;
    return next;
  end loop;
end;
$fn$;

revoke all on function public.mkt_objective_progress(uuid) from public, anon;
grant execute on function public.mkt_objective_progress(uuid) to authenticated;


-- ------------------------------------------------------------
-- 8) تسويق المشروع — المخزون العقاري قراءةً، والتسويق حوله
-- ------------------------------------------------------------
create or replace function public.mkt_project_overview(p_project uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb;
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;
  select jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'name', p.name, 'governorate', p.governorate,
                                  'area', p.area, 'status', p.status),
    'units', (select jsonb_build_object(
                'total', count(*),
                'available', count(*) filter (where u.status = 'متاحة'),
                'sold', count(*) filter (where u.status = 'مباعة'),
                'blocked', count(*) filter (where u.status = 'موقوفة'),
                'reserved', count(*) filter (where u.status = 'متاحة' and exists (
                   select 1 from public.reservations r where r.unit_id = u.id and r.status = 'حجز')),
                'min_price', min(u.price) filter (where u.status = 'متاحة' and u.price > 0),
                'max_price', max(u.price) filter (where u.status = 'متاحة' and u.price > 0))
                from public.units u where u.project_id = p.id),
    'kpis', public.mkt_kpis(p_from, p_to, p.id, null, null, 'last'),
    'campaigns', (select count(*) from public.crm_campaigns c where c.project_id = p.id and c.is_active),
    'content', (select count(*) from public.mkt_content c where c.project_id = p.id and c.status <> 'مؤرشف'),
    'activities', (select count(*) from public.mkt_activities a where a.project_id = p.id and a.status not in ('منتهٍ', 'ملغى')),
    'influencer_deals', (select count(*) from public.mkt_influencer_deals d
                           join public.crm_campaigns c on c.id = d.campaign_id
                          where c.project_id = p.id and d.stage <> 'ملغى'))
    into v
    from public.projects p where p.id = p_project;
  return v;
end;
$fn$;

revoke all on function public.mkt_project_overview(uuid, date, date) from public, anon;
grant execute on function public.mkt_project_overview(uuid, date, date) to authenticated;

-- حقائق المشروع للمساعد الذكي — ما في القاعدة فقط، فلا يخترع ما ليس فيها
create or replace function public.mkt_project_brief(p_project uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.can_read_marketing() then jsonb_build_object(
    'name', p.name, 'governorate', p.governorate, 'area', p.area, 'status', p.status,
    'description', p.description,
    'units_total', (select count(*) from public.units u where u.project_id = p.id),
    'units_available', (select count(*) from public.units u where u.project_id = p.id and u.status = 'متاحة'),
    'unit_types', (select jsonb_agg(jsonb_build_object('type', t.unit_type, 'available', t.n, 'min_m2', t.mn, 'max_m2', t.mx,
                                                       'min_price', t.pmin, 'max_price', t.pmax, 'rooms', t.rooms))
                     from (select u.unit_type, count(*) n, min(u.space_m2) mn, max(u.space_m2) mx,
                                  min(u.price) filter (where u.price > 0) pmin, max(u.price) pmax,
                                  jsonb_agg(distinct u.rooms) filter (where u.rooms is not null) rooms
                             from public.units u
                            where u.project_id = p.id and u.status = 'متاحة'
                            group by u.unit_type) t),
    'payment_plans', (select jsonb_agg(distinct u.payment_plan) from public.units u
                       where u.project_id = p.id and u.payment_plan is not null and u.status = 'متاحة'),
    'active_campaigns', (select jsonb_agg(c.name) from public.crm_campaigns c where c.project_id = p.id and c.is_active))
  end
  from public.projects p where p.id = p_project;
$$;

revoke all on function public.mkt_project_brief(uuid) from public, anon;
grant execute on function public.mkt_project_brief(uuid) to authenticated;


-- ------------------------------------------------------------
-- 9) جودة البيانات التسويقية
-- ------------------------------------------------------------
create or replace function public.mkt_data_quality()
returns table (code text, severity text, label text, n bigint, hint text, sample jsonb)
language plpgsql stable security definer set search_path = public as $fn$
declare v_today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;

  return query
  select 'leads_no_source', 'عالٍ', 'ليدات آخر ٩٠ يوماً بلا مصدر ولا حملة ولا لمسة', count(*),
         'تُعرض «غير منسوب» في كل تقرير — اطلب من المبيعات تسجيل المصدر', jsonb_agg(c.id) filter (where true)
    from (select c.id from public.clients c
           where c.deleted_at is null and c.merged_into is null
             and c.created_at > now() - interval '90 days'
             and c.original_source_id is null and c.campaign_id is null
             and not exists (select 1 from public.mkt_touchpoints t where t.client_id = c.id)
           limit 1000) c
  union all
  select 'campaign_no_budget', 'متوسط', 'حملات جارية بلا ميزانية', count(*), 'بلا ميزانية لا تنبيه تجاوز',
         jsonb_agg(jsonb_build_object('id', id, 'name', name))
    from public.crm_campaigns where is_active and budget is null
  union all
  select 'campaign_no_project', 'منخفض', 'حملات جارية بلا مشروع (عدا العلامة التجارية)', count(*),
         'لا تظهر في تسويق المشروع ولا ربحيته', jsonb_agg(jsonb_build_object('id', id, 'name', name))
    from public.crm_campaigns where is_active and project_id is null and campaign_type <> 'علامة تجارية'
  union all
  select 'campaign_expired_active', 'عالٍ', 'حملات «نشطة» انتهى تاريخها', count(*),
         'أغلقها أو مدّدها — تُحسب جارية في كل لوحة', jsonb_agg(jsonb_build_object('id', id, 'name', name, 'end', end_date))
    from public.crm_campaigns where status = 'نشطة' and end_date < v_today
  union all
  select 'ads_no_campaign', 'متوسط', 'حملات إعلانية غير مربوطة بحملة تلال', count(*),
         'مصروفها ونقرها لا يدخلان أي حملة', jsonb_agg(jsonb_build_object('id', id, 'name', name))
    from public.mkt_ad_objects where level = 'حملة إعلانية' and campaign_id is null
  union all
  select 'content_no_owner', 'منخفض', 'محتوى بلا مسؤول', count(*), 'لا أحد يُنبَّه بتأخّره',
         jsonb_agg(jsonb_build_object('id', id, 'title', title))
    from public.mkt_content where owner_id is null and status not in ('منشور', 'مؤرشف', 'مرفوض')
  union all
  select 'expense_unassigned', 'متوسط', 'مصروفات بلا حملة ولا قناة ولا نشاط', count(*),
         'تدخل كلفة الشركة ولا تدخل كلفة أي حملة', jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code))
    from public.mkt_expenses e   -- ⚠️ مؤهَّلة: «code» اسم عمود مُخرَج هنا أيضاً
   where e.status not in ('ملغى', 'مرفوض') and e.campaign_id is null and e.channel_id is null and e.activity_id is null
  union all
  select 'cash_moves_unlinked', 'متوسط', 'حركات «تسويق وإعلان» في المحاسبة غير منسوبة', count(*),
         'اربطها من «المصروفات» — بلا ربطٍ لا تدخل كلفة حملة', jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'date', move_date))
    from public.cash_moves cm
   where cm.account_code = '5700' and cm.direction = 'صرف'
     and not exists (select 1 from public.mkt_expenses e where e.cash_move_id = cm.id)
  union all
  select 'duplicate_utm', 'متوسط', 'روابط بنفس UTM ووجهات مختلفة', count(*),
         'لا يُفرَّق بينها في التقارير — ميّز utm_content', jsonb_agg(x.g)
    from (select jsonb_build_object('utm', utm_source || '/' || utm_medium || '/' || utm_campaign || '/' || coalesce(utm_content, ''),
                                    'links', count(*)) as g
            from public.mkt_tracking_links
           group by utm_source, utm_medium, utm_campaign, utm_content, utm_term
          having count(*) > 1) x
  union all
  select 'broken_links', 'عالٍ', 'روابط فعّالة تقود إلى ما توقّف', count(*),
         'QR مطبوع يقود إلى صفحة متوقفة أو حملة منتهية', jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name))
    from public.mkt_tracking_links l
    left join public.mkt_landing_pages lp on lp.id = l.landing_page_id
    left join public.crm_campaigns c on c.id = l.campaign_id
   where l.is_active and (
         (l.expires_on is not null and l.expires_on < v_today)
      or (lp.id is not null and lp.status <> 'منشورة')
      or (c.id is not null and c.status in ('مكتملة', 'ملغاة')))
  union all
  select 'intake_stuck', 'عالٍ', 'ليدات في البوّابة لم تُعالَج منذ ساعة', count(*),
         'لم تصل إلى المبيعات', jsonb_agg(jsonb_build_object('id', id, 'provider', provider, 'at', received_at))
    from public.crm_lead_intake where status = 'جديد' and received_at < now() - interval '1 hour'
  union all
  select 'trigger_errors', 'متوسط', 'أخطاء ربط اللمسات آخر ٧ أيام', count(*),
         'ليدٌ وصل ولم تُسجَّل لمسته — راجع السجلّ', jsonb_agg(jsonb_build_object('at', at, 'source', source, 'message', message))
    from public.mkt_event_errors where at > now() - interval '7 days';
end;
$fn$;

revoke all on function public.mkt_data_quality() from public, anon;
grant execute on function public.mkt_data_quality() to authenticated;


-- ------------------------------------------------------------
-- 10) البحث الشامل في القسم
--
-- ⚠️ لا أشخاص: التسويق لا يتصفّح العملاء (092). يبحث في ما يملكه.
-- ------------------------------------------------------------
create or replace function public.mkt_search(p_q text, p_limit int default 40)
returns table (kind text, id uuid, title text, subtitle text, href text)
language plpgsql stable security definer set search_path = public as $fn$
declare q text := '%' || replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '') || '%';
begin
  if not public.can_read_marketing() then raise exception 'لفريق التسويق'; end if;
  if length(btrim(coalesce(p_q, ''))) < 2 then return; end if;

  return query
  (select 'حملة', c.id, c.name, c.code || ' · ' || c.status, '/dashboard/marketing/campaigns/' || c.id
     from public.crm_campaigns c where c.name ilike q or c.code ilike q limit p_limit)
  union all
  (select 'محتوى', c.id, c.title, c.code || ' · ' || c.content_type || ' · ' || c.status, '/dashboard/marketing/content/' || c.id
     from public.mkt_content c where c.title ilike q or c.code ilike q or c.caption ilike q or c.hashtags ilike q limit p_limit)
  union all
  (select 'نشاط', a.id, a.title, a.code || ' · ' || a.kind || coalesce(' · ' || a.city, ''), '/dashboard/marketing/offline/' || a.id
     from public.mkt_activities a where a.title ilike q or a.code ilike q or a.location ilike q or a.venue ilike q limit p_limit)
  union all
  (select 'مؤثر', i.id, i.name, coalesce('@' || i.username, '') || coalesce(' · ' || i.category, ''), '/dashboard/marketing/influencers?i=' || i.id
     from public.mkt_influencers i where i.name ilike q or i.username ilike q limit p_limit)
  union all
  (select 'مورّد', s.id, s.name, array_to_string(s.services, '، '), '/dashboard/marketing/vendors'
     from public.suppliers s where s.is_marketing and s.name ilike q limit p_limit)
  union all
  (select 'رابط', l.id, l.name, l.code || ' · ' || l.utm_source || '/' || l.utm_campaign, '/dashboard/marketing/tracking'
     from public.mkt_tracking_links l
    where l.name ilike q or l.code ilike q or l.utm_campaign ilike q or l.utm_content ilike q limit p_limit)
  union all
  (select 'صفحة هبوط', p.id, p.title, '/f/' || p.slug, '/dashboard/marketing/tracking?tab=pages'
     from public.mkt_landing_pages p where p.title ilike q or p.slug ilike q limit p_limit)
  union all
  (select 'أصل', a.id, a.title, a.asset_type || coalesce(' · ' || a.folder, ''), '/dashboard/marketing/assets?q=' || a.title
     from public.mkt_assets a where a.status <> 'مؤرشف'
      and (a.title ilike q or a.file_name ilike q or exists (select 1 from unnest(a.tags) t where t ilike q)) limit p_limit)
  union all
  (select 'خطة', p.id, p.title, p.kind, '/dashboard/marketing/plans/' || p.id
     from public.mkt_plans p where p.title ilike q limit p_limit)
  union all
  (select 'إعلان', a.id, a.name, a.level || coalesce(' · ' || a.external_id, ''), '/dashboard/marketing/ads'
     from public.mkt_ad_objects a where a.name ilike q or a.external_id ilike q limit p_limit);
end;
$fn$;

revoke all on function public.mkt_search(text, int) from public, anon;
grant execute on function public.mkt_search(text, int) to authenticated;


-- ------------------------------------------------------------
-- 11) التقويم — كل ما له تاريخ في القسم
-- ------------------------------------------------------------
create or replace function public.mkt_calendar(p_from date, p_to date)
returns table (kind text, id uuid, title text, starts date, ends date, status text, href text)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'حملة'::text, c.id, c.name, c.start_date, coalesce(c.end_date, c.start_date), c.status,
           '/dashboard/marketing/campaigns/' || c.id
      from public.crm_campaigns c
     where c.start_date is not null and c.start_date <= p_to and coalesce(c.end_date, c.start_date) >= p_from
    union all
    select 'محتوى', c.id, c.title,
           coalesce((c.publish_at at time zone 'Asia/Baghdad')::date, c.due_date),
           coalesce((c.publish_at at time zone 'Asia/Baghdad')::date, c.due_date), c.status,
           '/dashboard/marketing/content/' || c.id
      from public.mkt_content c
     where coalesce((c.publish_at at time zone 'Asia/Baghdad')::date, c.due_date) between p_from and p_to
       and c.status <> 'مؤرشف'
    union all
    select case when a.category = 'فعالية' then 'فعالية' else 'ميداني' end, a.id, a.title,
           a.start_date, coalesce(a.end_date, a.start_date), a.status, '/dashboard/marketing/offline/' || a.id
      from public.mkt_activities a
     where a.start_date is not null and a.start_date <= p_to and coalesce(a.end_date, a.start_date) >= p_from
    union all
    select 'مهمّة', t.id, t.title, t.due_date, t.due_date, t.status, '/dashboard/marketing/tasks'
      from public.mkt_tasks t
     where t.due_date between p_from and p_to and t.status <> 'منجزة'
    union all
    select 'مؤثر', d.id, i.name || ' — تسليم', d.due_date, d.due_date, d.stage, '/dashboard/marketing/influencers'
      from public.mkt_influencer_deals d join public.mkt_influencers i on i.id = d.influencer_id
     where d.due_date between p_from and p_to and d.stage not in ('ملغى', 'تقييم')
  ) x
  where public.can_read_marketing()
  order by 4, 1;
$$;

revoke all on function public.mkt_calendar(date, date) from public, anon;
grant execute on function public.mkt_calendar(date, date) to authenticated;


-- ------------------------------------------------------------
-- 12) التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 125 التسويق ٤ — التحليل ---';
  raise notice 'المؤشّرات تُقرأ بـ: select public.mkt_kpis(''2026-09-01'', ''2026-09-30'');';
  raise notice '(من محرّر SQL تُرجع خطأ صلاحية — auth.uid() فارغ. تُختبر من 127.)';
end $$;

notify pgrst, 'reload schema';
