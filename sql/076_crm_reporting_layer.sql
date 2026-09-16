-- ============================================================
-- تلال ERP — 076: طبقة التقارير — تعريف واحد لكل رقم
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- «معدّل الإغلاق» في شاشتك اليوم يُحسب في مكانين بطريقتين:
--
--   في «أداء الفريق»:   بيع ÷ (بيع + فشل)
--   في «مصادر العملاء»: بيع ÷ إجمالي العملاء
--
-- فمصدرٌ فيه ١٥٣ عميلاً وبيعة واحدة يظهر بـ«١٪»، وصاحبه في جدول
-- الفريق قد يظهر بـ«٥٠٪». الرقمان صحيحان كلٌّ بتعريفه، والإدارة
-- تقرأ الرقمين معاً فتخرج بقرار خاطئ.
--
-- وأخطر منه: «الإيراد». أي تقرير يجمع `units.price` يعرض ٧٧ مليوناً
-- حيث الإيراد الحقيقي ١٫٥ مليون — لأن تلال وسيط لا بائع (sql/056).
--
-- ============================================================
-- المبدأ الحاكم
--
--     الرقم يُحسب مرة واحدة في القاعدة، وتُعرَض النتيجة في كل مكان.
--
-- لا صفحة تحسب بنفسها. تغيير تعريف يتمّ في دالة واحدة فينتقل إلى
-- كل شاشة في نفس اللحظة — فلا تتناقض شاشتان أبداً.
--
-- ============================================================
-- التعريفات الملزمة
--
--   Lead              عميل غير محذوف
--   Opportunity       فرصة غير محذوفة
--   Open / Won / Lost بنوع مرحلة الفرصة (crm_stages.stage_type)
--   Conversion Rate   فائزة ÷ (فائزة + خاسرة)   ← المفتوحة خارج المقام
--   Pipeline Value    Σ expected_value للمفتوحة
--   Weighted Pipeline Σ expected_value × probability ÷ 100
--   Sales Cycle       أيام من إنشاء الفرصة إلى closed_at
--   **Revenue**       عمولة تلال وحدها — لا ثمن الوحدة (sql/056)
--
-- ============================================================
-- ما يضيفه
--
--   1) v_crm_opportunities — العرض الأساس: كل مشتقّ يُحسب مرة
--   2) crm_kpis()          — مؤشّرات مرشَّحة بمدى وفريق ومشروع ومصدر
--   3) crm_funnel()        — القمع بحجمه وتحويله وتسرّبه ومدّته
--   4) crm_stage_durations() — الزمن في كل مرحلة (متوسط ووسيط وP90)
--   5) crm_source_performance() — المصدر حتى البيع لا حتى الليد
--   6) crm_team_performance()   — الأداء بسياقه لا مجرّداً
--   7) crm_lost_analysis()      — لماذا نخسر
--   8) crm_sales_velocity()     — سرعة المبيعات
--   9) crm_snapshots + take_crm_snapshot() — المقارنة عبر الزمن
--
-- يتطلب: sql/070 و 071 و 072 و 074. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) العرض الأساس
--
-- كل مشتقّ زمني يُحسب هنا مرة واحدة: الأيام في المرحلة، أيام
-- الانفتاح، دورة البيع. لا دالة بعده تُعيد حسابها بطريقتها.
-- ------------------------------------------------------------
create or replace view public.v_crm_opportunities as
select
  o.id,
  o.client_id,
  c.name             as client_name,
  c.source           as client_source,
  o.owner_id,
  e.full_name        as owner_name,
  e.team_id,
  o.project_id,
  p.name             as project_name,
  o.unit_id,
  o.source_id,
  coalesce(src.name, c.source) as source_name,
  o.campaign_id,
  o.stage_id,
  g.name             as stage_name,
  g.stage_type,
  g.sort_order       as stage_order,
  o.probability,
  o.expected_value,
  -- الموزون: القيمة × الاحتمال. صفرٌ للمغلقة كي لا تُحتسب مرتين.
  case when g.stage_type = 'open'
       then coalesce(o.expected_value, 0) * coalesce(o.probability, 0) / 100.0
       else 0 end    as weighted_value,
  o.won_value,
  o.lost_reason_id,
  lr.name            as lost_reason,
  o.created_at,
  o.closed_at,
  o.expected_close_date,
  o.stage_entered_at,
  o.last_activity_at,
  o.next_action_date,
  -- المشتقّات الزمنية
  extract(epoch from (now() - o.stage_entered_at)) / 86400.0            as days_in_stage,
  extract(epoch from (coalesce(o.closed_at, now()) - o.created_at)) / 86400.0 as days_open,
  case when o.closed_at is not null
       then extract(epoch from (o.closed_at - o.created_at)) / 86400.0
  end                                                                   as sales_cycle_days,
  extract(epoch from (now() - coalesce(o.last_activity_at, o.created_at))) / 86400.0
                                                                        as days_silent,
  (o.next_action_date < public.baghdad_today())                         as is_overdue,
  c.lead_score,
  c.lead_temperature
from public.opportunities o
join public.crm_stages g   on g.id = o.stage_id
join public.clients c      on c.id = o.client_id
left join public.employees e on e.id = o.owner_id
left join public.projects p  on p.id = o.project_id
left join public.crm_sources src on src.id = o.source_id
left join public.crm_lost_reasons lr on lr.id = o.lost_reason_id
where o.deleted_at is null;

comment on view public.v_crm_opportunities is
  'الأساس لكل تقارير الـCRM. لا دالة تقرأ opportunities مباشرة — تقرأ من هنا.';

-- ============================================================
-- ⚠️ أمن التقارير — القرار الأهمّ في هذا الملف
--
-- العرض يعمل بـ security_invoker: يُنفَّذ بصلاحية من يسأل، فتسري
-- عليه سياسات RLS لـ opportunities و clients كما هي.
--
-- وتبعاً لذلك **كل دوال التقارير أدناه بلا security definer**.
-- ولو كانت definer لعملت بصلاحية مالك القاعدة، فتجاوزت RLS،
-- وأعادت للموظف أرقام الشركة كاملة من دالة تبدو بريئة — تسريبٌ
-- كامل من باب التقارير بينما الأبواب الأخرى مقفلة.
--
-- والنتيجة الآن: نفس الاستدعاء يعطي كل قارئ نطاقه.
--     المدير   → أرقام الشركة
--     المشرف   → نطاق فريقه
--     الموظف   → أرقامه هو
--
-- (الاستثناء الوحيد take_crm_snapshot: تعمل من مهمة مجدولة بلا
--  مستخدم، فتبقى definer كي ترى الكل عند أخذ اللقطة.)
-- ============================================================
do $$
begin
  alter view public.v_crm_opportunities set (security_invoker = true);
exception when others then
  -- PostgreSQL أقدم من 15 لا يعرف الخيار. نوقف الهجرة بدل المتابعة:
  -- عرضٌ بلا security_invoker يكشف كل الصفوف لكل قارئ.
  raise exception 'security_invoker غير مدعوم في هذه النسخة — لا تُشغّل 076 بدونه (خطر تسريب).';
end $$;

-- ------------------------------------------------------------
-- 2) المؤشّرات
--
-- كل المُرشِّحات اختيارية: NULL = الكل. هكذا تستعمل كل لوحة نفس
-- الدالة بمُرشِّحات مختلفة (§44) بدل دالة لكل شاشة.
-- ------------------------------------------------------------
create or replace function public.crm_kpis(
  p_from       date default null,
  p_to         date default null,
  p_owner_id   uuid default null,
  p_team_id    uuid default null,
  p_project_id uuid default null,
  p_source_id  uuid default null
) returns table (
  leads              bigint,
  opportunities      bigint,
  open_count         bigint,
  won_count          bigint,
  lost_count         bigint,
  conversion_rate    numeric,
  pipeline_value     numeric,
  weighted_pipeline  numeric,
  won_value          numeric,
  avg_deal_value     numeric,
  avg_sales_cycle    numeric,
  median_sales_cycle numeric,
  overdue_count      bigint,
  neglected_count    bigint,
  hot_count          bigint,
  activities         bigint
)
language sql stable set search_path = public as $$
  with f as (
    select * from public.v_crm_opportunities v
     where (p_from       is null or v.created_at::date >= p_from)
       and (p_to         is null or v.created_at::date <= p_to)
       and (p_owner_id   is null or v.owner_id   = p_owner_id)
       and (p_team_id    is null or v.team_id    = p_team_id)
       and (p_project_id is null or v.project_id = p_project_id)
       and (p_source_id  is null or v.source_id  = p_source_id)
  ),
  neglect as (select public.crm_setting_int('neglected_days', 14) d)
  select
    count(distinct f.client_id),
    count(*),
    count(*) filter (where f.stage_type = 'open'),
    count(*) filter (where f.stage_type = 'won'),
    count(*) filter (where f.stage_type = 'lost'),
    -- المقام: المغلقة وحدها. فرصةٌ لم تُحسم بعد ليست خسارة.
    case when count(*) filter (where f.stage_type in ('won','lost')) > 0
         then round(count(*) filter (where f.stage_type = 'won') * 100.0
                    / count(*) filter (where f.stage_type in ('won','lost')), 1)
         else 0 end,
    round(coalesce(sum(f.expected_value) filter (where f.stage_type = 'open'), 0)),
    round(coalesce(sum(f.weighted_value), 0)),
    round(coalesce(sum(f.won_value) filter (where f.stage_type = 'won'), 0)),
    round(coalesce(avg(f.won_value) filter (where f.stage_type = 'won'), 0)),
    round(coalesce(avg(f.sales_cycle_days) filter (where f.stage_type = 'won'), 0), 1),
    round(coalesce(
      percentile_cont(0.5) within group (order by f.sales_cycle_days::double precision)
        filter (where f.stage_type = 'won'), 0), 1),
    count(*) filter (where f.stage_type = 'open' and f.is_overdue),
    count(*) filter (where f.stage_type = 'open'
                       and f.days_silent > (select d from neglect)),
    count(*) filter (where f.lead_temperature = 'ساخن'),
    (select count(*) from public.client_activities a
      join public.crm_activity_types t on t.name = a.activity_type
     where t.counts_as_contact
       and (p_from is null or a.occurred_at::date >= p_from)
       and (p_to   is null or a.occurred_at::date <= p_to))
  from f;
$$;

comment on function public.crm_kpis(date, date, uuid, uuid, uuid, uuid) is
  'المصدر الوحيد لمؤشّرات الـCRM. كل لوحة تستدعيها بمُرشِّحاتها — لا حساب في الواجهة.';

-- ------------------------------------------------------------
-- 3) القمع — بالحجم والتحويل والتسرّب والمدّة
--
-- «وصل» = في هذه المرحلة أو تجاوزها. الخاسرة تُحتسب في التسرّب
-- لا في المراحل — الخسارة ليست خطوة في الطريق.
-- ------------------------------------------------------------
create or replace function public.crm_funnel(
  p_from date default null, p_to date default null,
  p_owner_id uuid default null, p_project_id uuid default null,
  p_source_id uuid default null
) returns table (
  stage_name      text,
  stage_order     int,
  reached         bigint,
  still_here      bigint,
  reached_pct     numeric,
  step_conversion numeric,
  drop_off_pct    numeric,
  avg_days        numeric,
  median_days     numeric,
  value_here      numeric
)
language sql stable set search_path = public as $$
  with f as (
    select * from public.v_crm_opportunities v
     where (p_from is null or v.created_at::date >= p_from)
       and (p_to   is null or v.created_at::date <= p_to)
       and (p_owner_id   is null or v.owner_id   = p_owner_id)
       and (p_project_id is null or v.project_id = p_project_id)
       and (p_source_id  is null or v.source_id  = p_source_id)
  ),
  entered as (select count(*) n from f),
  stages as (
    select g.name, g.sort_order
      from public.crm_stages g
     where g.stage_type in ('open','won') and g.is_active
     order by g.sort_order
  ),
  counts as (
    select s.name, s.sort_order,
           (select count(*) from f where f.stage_order >= s.sort_order) as reached,
           (select count(*) from f where f.stage_order  = s.sort_order) as still_here,
           (select round(avg(h.days_in_from), 1)
              from public.opportunity_stage_history h
             where h.from_stage = s.name and h.days_in_from is not null) as avg_days,
           (select round(percentile_cont(0.5) within group (order by h.days_in_from::double precision)::numeric, 1)
              from public.opportunity_stage_history h
             where h.from_stage = s.name and h.days_in_from is not null) as median_days,
           (select round(coalesce(sum(f.expected_value), 0))
              from f where f.stage_order = s.sort_order) as value_here
      from stages s
  )
  select c.name, c.sort_order::int, c.reached, c.still_here,
         case when (select n from entered) > 0
              then round(c.reached * 100.0 / (select n from entered), 1) else 0 end,
         case when lag(c.reached) over (order by c.sort_order) > 0
              then round(c.reached * 100.0 / lag(c.reached) over (order by c.sort_order), 1)
         end,
         case when lag(c.reached) over (order by c.sort_order) > 0
              then round(100 - c.reached * 100.0 / lag(c.reached) over (order by c.sort_order), 1)
         end,
         c.avg_days, c.median_days, c.value_here
    from counts c
   order by c.sort_order;
$$;

-- ------------------------------------------------------------
-- 4) الزمن في المراحل — أين يعلق خطّ الأنابيب
-- ------------------------------------------------------------
create or replace function public.crm_stage_durations(
  p_owner_id uuid default null, p_project_id uuid default null
) returns table (
  stage_name  text,
  transitions bigint,
  avg_days    numeric,
  median_days numeric,
  p90_days    numeric,
  max_days    numeric
)
language sql stable set search_path = public as $$
  select h.from_stage,
         count(*),
         round(avg(h.days_in_from), 1),
         round(percentile_cont(0.5) within group (order by h.days_in_from::double precision)::numeric, 1),
         round(percentile_cont(0.9) within group (order by h.days_in_from::double precision)::numeric, 1),
         round(max(h.days_in_from), 1)
    from public.opportunity_stage_history h
    join public.v_crm_opportunities v on v.id = h.opportunity_id
   where h.from_stage is not null
     and h.days_in_from is not null
     and (p_owner_id   is null or v.owner_id   = p_owner_id)
     and (p_project_id is null or v.project_id = p_project_id)
   group by h.from_stage
   order by avg(h.days_in_from) desc;
$$;

-- ------------------------------------------------------------
-- 5) أداء المصدر — حتى البيع لا حتى الليد
--
-- المصدر الذي يجيب ١٥٣ ليداً وبيعة واحدة أسوأ من مصدر يجيب ٣٨
-- وبيعتين. العمود الأخير هو الذي يُنفق عليه لا الأول.
-- ------------------------------------------------------------
create or replace function public.crm_source_performance(
  p_from date default null, p_to date default null
) returns table (
  source_name     text,
  leads           bigint,
  qualified       bigint,
  opportunities   bigint,
  won             bigint,
  lost            bigint,
  conversion_rate numeric,
  won_value       numeric,
  avg_deal_value  numeric,
  avg_cycle_days  numeric
)
language sql stable set search_path = public as $$
  select coalesce(v.source_name, 'غير محدّد'),
         count(distinct v.client_id),
         count(distinct v.client_id) filter (where v.lead_score >= 40),
         count(*),
         count(*) filter (where v.stage_type = 'won'),
         count(*) filter (where v.stage_type = 'lost'),
         case when count(*) filter (where v.stage_type in ('won','lost')) > 0
              then round(count(*) filter (where v.stage_type = 'won') * 100.0
                         / count(*) filter (where v.stage_type in ('won','lost')), 1)
              else 0 end,
         round(coalesce(sum(v.won_value) filter (where v.stage_type = 'won'), 0)),
         round(coalesce(avg(v.won_value) filter (where v.stage_type = 'won'), 0)),
         round(coalesce(avg(v.sales_cycle_days) filter (where v.stage_type = 'won'), 0), 1)
    from public.v_crm_opportunities v
   where (p_from is null or v.created_at::date >= p_from)
     and (p_to   is null or v.created_at::date <= p_to)
   group by coalesce(v.source_name, 'غير محدّد')
   order by count(*) filter (where v.stage_type = 'won') desc, count(*) desc;
$$;

-- ------------------------------------------------------------
-- 6) أداء الفريق — بسياقه (§41)
--
-- ⚠️ الأعمدة مرتّبة عمداً: ما أُعطي، ثم ما عُمل، ثم النتيجة.
--    ومعها `unworked` و`avg_lead_score` — فمن استلم ليدات ضعيفة
--    أو لم يستلم شيئاً لا يُقارَن بمن استلم ليدات ساخنة.
--    الجدول الذي يعرض «معدّل الإغلاق» وحده يكذب بالحذف.
-- ------------------------------------------------------------
create or replace function public.crm_team_performance(
  p_from date default null, p_to date default null, p_team_id uuid default null
) returns table (
  owner_id        uuid,
  owner_name      text,
  -- المُدخَل
  leads_received  bigint,
  avg_lead_score  numeric,
  -- العمل
  leads_worked    bigint,
  unworked        bigint,
  activities      bigint,
  contact_rate    numeric,
  -- النتيجة
  opportunities   bigint,
  won             bigint,
  lost            bigint,
  conversion_rate numeric,
  won_value       numeric,
  avg_cycle_days  numeric,
  overdue         bigint
)
language sql stable set search_path = public as $$
  with f as (
    select * from public.v_crm_opportunities v
     where (p_from is null or v.created_at::date >= p_from)
       and (p_to   is null or v.created_at::date <= p_to)
       and (p_team_id is null or v.team_id = p_team_id)
       and v.owner_id is not null
  ),
  acts as (
    select c.owner_id, count(*) n
      from public.client_activities a
      join public.clients c on c.id = a.client_id
      join public.crm_activity_types t on t.name = a.activity_type
     where t.counts_as_contact
       and (p_from is null or a.occurred_at::date >= p_from)
       and (p_to   is null or a.occurred_at::date <= p_to)
     group by c.owner_id
  ),
  leads as (
    select c.owner_id,
           count(*) n,
           round(avg(c.lead_score), 1) avg_score,
           count(*) filter (where c.last_contact_at is not null) worked,
           count(*) filter (where c.last_contact_at is null
                              and public.is_open_stage(c.stage)) unworked
      from public.clients c
     where c.owner_id is not null
       and (p_from is null or c.created_at::date >= p_from)
       and (p_to   is null or c.created_at::date <= p_to)
     group by c.owner_id
  )
  select e.id, e.full_name,
         coalesce(l.n, 0), coalesce(l.avg_score, 0),
         coalesce(l.worked, 0), coalesce(l.unworked, 0), coalesce(a.n, 0),
         case when coalesce(l.n, 0) > 0
              then round(coalesce(l.worked, 0) * 100.0 / l.n, 1) else 0 end,
         count(f.id),
         count(f.id) filter (where f.stage_type = 'won'),
         count(f.id) filter (where f.stage_type = 'lost'),
         case when count(f.id) filter (where f.stage_type in ('won','lost')) > 0
              then round(count(f.id) filter (where f.stage_type = 'won') * 100.0
                         / count(f.id) filter (where f.stage_type in ('won','lost')), 1)
              else 0 end,
         round(coalesce(sum(f.won_value) filter (where f.stage_type = 'won'), 0)),
         round(coalesce(avg(f.sales_cycle_days) filter (where f.stage_type = 'won'), 0), 1),
         count(f.id) filter (where f.stage_type = 'open' and f.is_overdue)
    from public.employees e
    left join f    on f.owner_id = e.id
    left join acts a on a.owner_id = e.id
    left join leads l on l.owner_id = e.id
   where e.user_id is not null
   group by e.id, e.full_name, l.n, l.avg_score, l.worked, l.unworked, a.n
  having coalesce(l.n, 0) > 0 or count(f.id) > 0
   order by count(f.id) filter (where f.stage_type = 'won') desc, coalesce(l.n, 0) desc;
$$;

-- ------------------------------------------------------------
-- 7) لماذا نخسر (§26)
-- ------------------------------------------------------------
create or replace function public.crm_lost_analysis(
  p_from date default null, p_to date default null
) returns table (
  lost_reason   text,
  category      text,
  lost_count    bigint,
  lost_value    numeric,
  share_pct     numeric,
  avg_stage_reached text
)
language sql stable set search_path = public as $$
  with lost as (
    select v.*, lr.category
      from public.v_crm_opportunities v
      left join public.crm_lost_reasons lr on lr.id = v.lost_reason_id
     where v.stage_type = 'lost'
       and (p_from is null or v.closed_at::date >= p_from)
       and (p_to   is null or v.closed_at::date <= p_to)
  ),
  total as (select count(*) n from lost)
  select coalesce(l.lost_reason, 'بلا سبب مسجَّل'),
         coalesce(l.category, '—'),
         count(*),
         round(coalesce(sum(l.expected_value), 0)),
         case when (select n from total) > 0
              then round(count(*) * 100.0 / (select n from total), 1) else 0 end,
         -- أبعد مرحلة بلغتها الصفقات قبل خسارتها بهذا السبب
         (select h.from_stage
            from public.opportunity_stage_history h
           where h.opportunity_id in (select id from lost l2
                                       where coalesce(l2.lost_reason, 'بلا سبب مسجَّل')
                                             = coalesce(l.lost_reason, 'بلا سبب مسجَّل'))
             and h.from_stage is not null
           group by h.from_stage order by count(*) desc limit 1)
    from lost l
   group by l.lost_reason, l.category
   order by count(*) desc;
$$;

-- ------------------------------------------------------------
-- 8) سرعة المبيعات (§24)
--
--     الفرص المؤهَّلة × متوسط قيمة الصفقة × معدّل الفوز ÷ طول الدورة
--
-- الناتج: قيمة متوقّعة في اليوم. صفرٌ حين لا دورة مكتملة بعد —
-- وهو جواب صادق لا عطل.
-- ------------------------------------------------------------
create or replace function public.crm_sales_velocity(
  p_from date default null, p_to date default null, p_owner_id uuid default null
) returns table (
  qualified_opps  bigint,
  avg_deal_value  numeric,
  win_rate        numeric,
  avg_cycle_days  numeric,
  velocity_per_day   numeric,
  velocity_per_week  numeric,
  velocity_per_month numeric
)
language sql stable set search_path = public as $$
  with f as (
    select * from public.v_crm_opportunities v
     where (p_from is null or v.created_at::date >= p_from)
       and (p_to   is null or v.created_at::date <= p_to)
       and (p_owner_id is null or v.owner_id = p_owner_id)
  ),
  m as (
    select count(*) filter (where f.stage_type = 'open')              as q,
           coalesce(avg(f.won_value) filter (where f.stage_type = 'won'), 0) as adv,
           case when count(*) filter (where f.stage_type in ('won','lost')) > 0
                then count(*) filter (where f.stage_type = 'won')::numeric
                     / count(*) filter (where f.stage_type in ('won','lost'))
                else 0 end                                            as wr,
           coalesce(avg(f.sales_cycle_days) filter (where f.stage_type = 'won'), 0) as cyc
      from f
  )
  select m.q, round(m.adv), round(m.wr * 100, 1), round(m.cyc, 1),
         case when m.cyc > 0 then round(m.q * m.adv * m.wr / m.cyc) else 0 end,
         case when m.cyc > 0 then round(m.q * m.adv * m.wr / m.cyc * 7) else 0 end,
         case when m.cyc > 0 then round(m.q * m.adv * m.wr / m.cyc * 30) else 0 end
    from m;
$$;

-- ------------------------------------------------------------
-- 9) اللقطات — المقارنة عبر الزمن (§54)
--
-- الحالة الراهنة لا تُجيب «هل تحسّنّا؟». نحفظ صورة يومية للأنابيب
-- والمراحل، فتصير المقارنة بين أسبوعين ممكنة بلا إعادة بناء تاريخ.
-- ------------------------------------------------------------
create table if not exists public.crm_snapshots (
  id           bigserial primary key,
  taken_on     date not null,
  scope        text not null default 'كلي',   -- كلي | موظف | مشروع
  scope_id     uuid,
  leads             bigint,
  opportunities     bigint,
  open_count        bigint,
  won_count         bigint,
  lost_count        bigint,
  conversion_rate   numeric,
  pipeline_value    numeric,
  weighted_pipeline numeric,
  won_value         numeric,
  avg_cycle_days    numeric,
  overdue_count     bigint,
  neglected_count   bigint,
  stage_distribution jsonb,
  taken_at     timestamptz not null default now(),
  unique (taken_on, scope, scope_id)
);

comment on table public.crm_snapshots is
  'صورة يومية للأنابيب. لا تُحذف ولا تُعدَّل — تاريخٌ يُقارَن به، وتعديله يُفسد المقارنة.';

create or replace function public.take_crm_snapshot(p_day date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, public.baghdad_today());
  k record;
  dist jsonb;
  n int := 0;
begin
  select * into k from public.crm_kpis();

  select jsonb_object_agg(x.stage_name, x.c) into dist
    from (select v.stage_name, count(*) c
            from public.v_crm_opportunities v
           where v.stage_type = 'open'
           group by v.stage_name) x;

  insert into public.crm_snapshots
    (taken_on, scope, scope_id, leads, opportunities, open_count, won_count, lost_count,
     conversion_rate, pipeline_value, weighted_pipeline, won_value, avg_cycle_days,
     overdue_count, neglected_count, stage_distribution)
  values
    (d, 'كلي', null, k.leads, k.opportunities, k.open_count, k.won_count, k.lost_count,
     k.conversion_rate, k.pipeline_value, k.weighted_pipeline, k.won_value, k.avg_sales_cycle,
     k.overdue_count, k.neglected_count, coalesce(dist, '{}'::jsonb))
  on conflict (taken_on, scope, scope_id) do update
    set leads = excluded.leads, opportunities = excluded.opportunities,
        open_count = excluded.open_count, won_count = excluded.won_count,
        lost_count = excluded.lost_count, conversion_rate = excluded.conversion_rate,
        pipeline_value = excluded.pipeline_value,
        weighted_pipeline = excluded.weighted_pipeline,
        won_value = excluded.won_value, avg_cycle_days = excluded.avg_cycle_days,
        overdue_count = excluded.overdue_count, neglected_count = excluded.neglected_count,
        stage_distribution = excluded.stage_distribution, taken_at = now();
  n := n + 1;

  -- لقطة لكل موظف له فرص — تتيح مقارنة أداء الفرد بنفسه لا بغيره
  for k in select * from public.crm_team_performance() loop
    insert into public.crm_snapshots
      (taken_on, scope, scope_id, leads, opportunities, won_count, lost_count,
       conversion_rate, won_value, avg_cycle_days, overdue_count)
    values
      (d, 'موظف', k.owner_id, k.leads_received, k.opportunities, k.won, k.lost,
       k.conversion_rate, k.won_value, k.avg_cycle_days, k.overdue)
    on conflict (taken_on, scope, scope_id) do update
      set leads = excluded.leads, opportunities = excluded.opportunities,
          won_count = excluded.won_count, lost_count = excluded.lost_count,
          conversion_rate = excluded.conversion_rate, won_value = excluded.won_value,
          avg_cycle_days = excluded.avg_cycle_days, overdue_count = excluded.overdue_count,
          taken_at = now();
    n := n + 1;
  end loop;

  return n;
end $$;

-- الاتجاه: مقارنة اللقطات
create or replace function public.crm_trend(
  p_metric text, p_days int default 30, p_scope text default 'كلي', p_scope_id uuid default null
) returns table (taken_on date, value numeric)
language plpgsql stable set search_path = public as $$
begin
  if p_metric not in ('leads','opportunities','open_count','won_count','lost_count',
                      'conversion_rate','pipeline_value','weighted_pipeline','won_value',
                      'avg_cycle_days','overdue_count','neglected_count') then
    raise exception 'مؤشّر غير معروف: %', p_metric;
  end if;

  -- اسم العمود يأتي من قائمة مغلقة أعلاه، فلا حقن ممكناً هنا
  return query execute format(
    'select taken_on, %I::numeric from public.crm_snapshots
      where scope = $1 and scope_id is not distinct from $2
        and taken_on >= public.baghdad_today() - $3
      order by taken_on', p_metric)
    using p_scope, p_scope_id, p_days;
end $$;

-- اللقطة اليومية: ١١ مساءً بغداد (٢٠ UTC) — بعد انتهاء يوم العمل
do $$ begin perform cron.unschedule('crm-daily-snapshot'); exception when others then null; end $$;
select cron.schedule('crm-daily-snapshot', '0 20 * * *',
  $cron$ select public.take_crm_snapshot(); $cron$);

-- ------------------------------------------------------------
-- 10) الصلاحيات
--
-- التقارير الإجمالية للإدارة والمشرف ومدير المتابعة. الموظف يرى
-- أرقامه من مُرشِّح owner_id على نفسه — لا من دالة تكشف الفريق.
-- ------------------------------------------------------------
alter table public.crm_snapshots enable row level security;
drop policy if exists "read snapshots" on public.crm_snapshots;
create policy "read snapshots" on public.crm_snapshots
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or (select public.is_supervisor()));
-- لا سياسة كتابة: اللقطة تُؤخذ بـ security definer من المهمة المجدولة.

do $$
declare fn text;
begin
  foreach fn in array array[
    'crm_kpis(date, date, uuid, uuid, uuid, uuid)',
    'crm_funnel(date, date, uuid, uuid, uuid)',
    'crm_stage_durations(uuid, uuid)',
    'crm_source_performance(date, date)',
    'crm_team_performance(date, date, uuid)',
    'crm_lost_analysis(date, date)',
    'crm_sales_velocity(date, date, uuid)',
    'crm_trend(text, int, text, uuid)']
  loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

revoke all on function public.take_crm_snapshot(date) from public;
grant execute on function public.take_crm_snapshot(date) to service_role;
grant select on public.v_crm_opportunities to authenticated;

-- ------------------------------------------------------------
-- 11) التحقّق — يطبع تقاريرك الحقيقية
-- ------------------------------------------------------------
do $$
declare k record; r record; n int;
begin
  raise notice '--- 076 طبقة التقارير ---';

  select * into k from public.crm_kpis();
  raise notice 'ليدات % | فرص % (مفتوحة % · فائزة % · خاسرة %)',
    k.leads, k.opportunities, k.open_count, k.won_count, k.lost_count;
  raise notice 'معدّل التحويل %%% | الأنابيب % | الموزونة %',
    k.conversion_rate, k.pipeline_value, k.weighted_pipeline;
  raise notice 'متأخرة % | مهملة % | ساخنة %',
    k.overdue_count, k.neglected_count, k.hot_count;

  raise notice 'القمع:';
  for r in select * from public.crm_funnel() loop
    raise notice '  % — وصل % (%%%) | تحويل %',
      r.stage_name, r.reached, r.reached_pct, coalesce(r.step_conversion, 0);
  end loop;

  raise notice 'المصادر (مرتّبة بالمبيعات لا بعدد الليدات):';
  for r in select * from public.crm_source_performance() loop
    raise notice '  % — ليدات % | فرص % | بيع % | تحويل %%%',
      r.source_name, r.leads, r.opportunities, r.won, r.conversion_rate;
  end loop;

  n := public.take_crm_snapshot();
  raise notice 'أول لقطة: % صفّاً. المقارنة الزمنية تبدأ من اليوم.', n;
end $$;

notify pgrst, 'reload schema';
