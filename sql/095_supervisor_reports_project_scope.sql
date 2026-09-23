-- ============================================================
-- تلال ERP — 095: تقارير المشرف على مشروعه وحده
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما حدث =====
--
-- المشرفة تفتح «التقارير» فترى في شريط الاتجاه:
--
--     ليدات 674 · فرص مفتوحة 344
--
-- وهي أرقام الشركة كلها، لا مشروعها. وجدول «أداء الفريق» تحته فارغ.
--
-- ===== السببان =====
--
-- ١) شريط الاتجاه يقرأ crm_snapshots، واللقطة نوعان فقط: «كلي» للشركة
--    و«موظف» لكل فرد. ولا لقطة للمشروع. وسياسة القراءة تفتح الجدول
--    كله للمشرف (076) — فيرى لقطة الشركة ولقطات موظفي المشاريع الأخرى.
--
-- ٢) دوال التقارير security invoker، أي بصلاحية السائل — وهذا صحيح:
--    RLS تحصر العملاء والفرص في نطاقه. لكنها تربط بجدول employees
--    لتعرف اسم الموظف ومشروعه، والمشرف ممنوع من employees عمداً (فيه
--    الرواتب — 037). فيصير كل ربط بالموظف فارغاً:
--       crm_team_performance  ← لا صفوف: «أداء الفريق» فارغ
--       crm_kpis(p_team_id)   ← صفر: مُرشِّح الفريق لا يعمل
--       v_crm_opportunities   ← owner_name و team_id فارغان
--
-- ===== الإصلاح =====
--
-- ١) crm_owner_directory(): دليلٌ ضيّق — المعرّف والاسم والمشروع
--    والحساب، لا غير. بنطاق السائل: المدير ومدير المتابعة ومن يقرأ
--    الـCRM كلّه يرون الجميع، والمشرف فريقه، والموظف نفسه.
--    تحلّ محلّ employees في الدوال والعرض أعلاه.
--
--    لماذا لا team_members؟ لأنه يُصفّي بـ auth.uid()، واللقطة اليومية
--    تعمل من المهمة المجدولة بلا مستخدم — فتصير لقطات الفرق أصفاراً.
--    الدليل يعرف هذه الحالة: لا طلب API إطلاقاً (لا request.jwt.claims)
--    = استدعاء داخلي من القاعدة نفسها، فيرى الكل.
--
-- ٢) take_crm_snapshot تأخذ لقطة «فريق» لكل مشروع — نفس مفردات
--    sales_targets: «فريق» = employees.project_id (037)، و«مشروع» =
--    مشروع الفرصة. المشرف مسؤول عن فريق مشروعه، فلقطته «فريق».
--
-- ٣) قراءة اللقطات: المشرف يرى لقطة فريقه ولقطات أفراد فريقه فقط.
--    لقطة الشركة للمدير ومدير المتابعة ومن يقرأ الـCRM كلّه.
--
-- ⚠️ لا تاريخ سابق لقطات الفرق: اللقطة صورة لحظتها ولا تُعاد بناؤها.
--    فشريط المشرف يظهر بعد لقطتين (ليلتين) — وإلى ذلك الحين يختفي
--    الشريط، ولا يعرض أرقام الشركة.
--
-- يتطلب: 037، 076، 084، 094. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الدليل الضيّق
-- ------------------------------------------------------------
create or replace function public.crm_owner_directory()
returns table (id uuid, full_name text, project_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.project_id, e.user_id
    from public.employees e
   where
     -- استدعاء داخلي (المهمة المجدولة، الهجرة): لا طلب API إطلاقاً.
     -- كل طلب عبر PostgREST — anon أو authenticated — يضبط هذا الإعداد.
     nullif(current_setting('request.jwt.claims', true), '') is null
     or public.is_admin()
     or public.is_followup_manager()
     or public.can_read_all_crm()
     or public.is_hr()
     or public.is_accountant()
     or e.id in (select s.id from public.my_scope_employees() s);
$$;

comment on function public.crm_owner_directory() is
  'الاسم والمشروع لمن في نطاقي — بلا رواتب. تستعملها تقارير الـCRM بدل employees، '
  'لأن المشرف ممنوع من employees والتقارير تعمل بصلاحيته (095).';

revoke all on function public.crm_owner_directory() from public, anon;
grant execute on function public.crm_owner_directory() to authenticated, service_role;

-- ------------------------------------------------------------
-- 2) عرض الفرص — الاسم والفريق من الدليل
--    الأعمدة كما هي حرفياً؛ تغيّر مصدر e وحده.
-- ------------------------------------------------------------
create or replace view public.v_crm_opportunities
with (security_invoker = true) as
 select o.id,
    o.client_id,
        case
            when should_mask_client_pii() then mask_name(c.name)
            else c.name
        end as client_name,
    c.source as client_source,
    o.owner_id,
    e.full_name as owner_name,
    e.project_id as team_id,
    o.project_id,
    p.name as project_name,
    o.unit_id,
    o.source_id,
    coalesce(src.name, c.source) as source_name,
    o.campaign_id,
    o.stage_id,
    g.name as stage_name,
    g.stage_type,
    g.sort_order as stage_order,
    o.probability,
    o.expected_value,
        case
            when (g.stage_type = 'open'::text) then ((coalesce(o.expected_value, (0)::numeric) * coalesce(o.probability, (0)::numeric)) / 100.0)
            else (0)::numeric
        end as weighted_value,
    o.won_value,
    o.lost_reason_id,
    lr.name as lost_reason,
    o.created_at,
    o.closed_at,
    o.expected_close_date,
    o.stage_entered_at,
    o.last_activity_at,
    o.next_action_date,
    (extract(epoch from (now() - o.stage_entered_at)) / 86400.0) as days_in_stage,
    (extract(epoch from (coalesce(o.closed_at, now()) - o.created_at)) / 86400.0) as days_open,
        case
            when (o.closed_at is not null) then (extract(epoch from (o.closed_at - o.created_at)) / 86400.0)
            else null::numeric
        end as sales_cycle_days,
    (extract(epoch from (now() - coalesce(o.last_activity_at, o.created_at))) / 86400.0) as days_silent,
    (o.next_action_date < baghdad_today()) as is_overdue,
    c.lead_score,
    c.lead_temperature
   from opportunities o
     join crm_stages g on g.id = o.stage_id
     join clients c on c.id = o.client_id
     left join public.crm_owner_directory() e on e.id = o.owner_id
     left join projects p on p.id = o.project_id
     left join crm_sources src on src.id = o.source_id
     left join crm_lost_reasons lr on lr.id = o.lost_reason_id
  where o.deleted_at is null;

-- ------------------------------------------------------------
-- 3) المؤشّرات — مُرشِّح الفريق يربط بالدليل
-- ------------------------------------------------------------
create or replace function public.crm_kpis(
  p_from date default null, p_to date default null, p_owner_id uuid default null,
  p_team_id uuid default null, p_project_id uuid default null, p_source_id uuid default null)
returns table (leads bigint, opportunities bigint, open_count bigint, won_count bigint,
               lost_count bigint, conversion_rate numeric, pipeline_value numeric,
               weighted_pipeline numeric, won_value numeric, avg_deal_value numeric,
               avg_sales_cycle numeric, median_sales_cycle numeric, overdue_count bigint,
               neglected_count bigint, hot_count bigint, activities bigint)
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
  neglect as (select public.crm_setting_int('neglected_days', 14) d),
  lead_count as (
    select count(*) n
      from public.clients c
      left join public.crm_owner_directory() e on e.id = c.owner_id
     where c.deleted_at is null
       and (p_from      is null or c.created_at::date >= p_from)
       and (p_to        is null or c.created_at::date <= p_to)
       and (p_owner_id  is null or c.owner_id   = p_owner_id)
       and (p_team_id   is null or e.project_id = p_team_id)
       and (p_project_id is null or c.project_id = p_project_id)
       and (p_source_id is null or c.original_source_id = p_source_id)
  )
  select
    (select n from lead_count),
    count(*),
    count(*) filter (where f.stage_type = 'open'),
    count(*) filter (where f.stage_type = 'won'),
    count(*) filter (where f.stage_type = 'lost'),
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
      (percentile_cont(0.5) within group (order by f.sales_cycle_days::double precision)
        filter (where f.stage_type = 'won'))::numeric, 0), 1),
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

-- ------------------------------------------------------------
-- 4) أداء الفريق — الصفوف من الدليل: المشرف يرى فريقه
-- ------------------------------------------------------------
create or replace function public.crm_team_performance(
  p_from date default null, p_to date default null, p_team_id uuid default null)
returns table (owner_id uuid, owner_name text, leads_received bigint, avg_lead_score numeric,
               leads_worked bigint, unworked bigint, activities bigint, contact_rate numeric,
               opportunities bigint, won bigint, lost bigint, conversion_rate numeric,
               won_value numeric, avg_cycle_days numeric, overdue bigint)
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
    from public.crm_owner_directory() e
    left join f    on f.owner_id = e.id
    left join acts a on a.owner_id = e.id
    left join leads l on l.owner_id = e.id
   where e.user_id is not null
     and (p_team_id is null or e.project_id = p_team_id)
   group by e.id, e.full_name, l.n, l.avg_score, l.worked, l.unworked, a.n
  having coalesce(l.n, 0) > 0 or count(f.id) > 0
   order by count(f.id) filter (where f.stage_type = 'won') desc, coalesce(l.n, 0) desc;
$$;

-- ------------------------------------------------------------
-- 5) تقدّم الأهداف — اسم الموظف من الدليل
-- ------------------------------------------------------------
create or replace function public.crm_target_progress(
  p_period_start date default null, p_period_type text default 'شهري')
returns table (target_id uuid, scope text, scope_id uuid, scope_name text, metric text,
               target_value numeric, achieved numeric, remaining numeric, achieved_pct numeric,
               days_left integer, pipeline_open numeric, weighted_open numeric,
               pipeline_needed numeric, on_track boolean)
language sql stable set search_path = public as $$
  with p as (
    select coalesce(p_period_start, date_trunc('month', public.baghdad_today())::date) as ps
  ),
  t as (
    select st.*, public.target_period_end(st.period_start, st.period_type) as pe
      from public.sales_targets st, p
     where st.period_start = p.ps and st.period_type = p_period_type
  ),
  actual as (
    select t.id as tid,
           case t.metric
             when 'صفقات' then count(v.id) filter (where v.stage_type = 'won')
             when 'وحدات' then count(distinct v.unit_id) filter (where v.stage_type = 'won')
             else coalesce(sum(v.won_value) filter (where v.stage_type = 'won'), 0)
           end::numeric as done,
           coalesce(sum(v.expected_value) filter (where v.stage_type = 'open'), 0) as pipe,
           coalesce(sum(v.weighted_value), 0) as wpipe,
           case when count(v.id) filter (where v.stage_type in ('won','lost')) > 0
                then count(v.id) filter (where v.stage_type = 'won')::numeric
                     / count(v.id) filter (where v.stage_type in ('won','lost'))
                else 0.2 end as win_rate
      from t
      left join public.v_crm_opportunities v
        on (t.scope = 'شركة'
            or (t.scope = 'موظف'  and v.owner_id   = t.scope_id)
            or (t.scope = 'فريق'  and v.team_id    = t.scope_id)
            or (t.scope = 'مشروع' and v.project_id = t.scope_id))
       and (v.stage_type <> 'won' or v.closed_at::date between t.period_start and t.pe)
     group by t.id, t.metric
  )
  select t.id, t.scope, t.scope_id,
         coalesce(e.full_name, tm.name, pr.name, 'الشركة'),
         t.metric, t.target_value,
         a.done,
         greatest(t.target_value - a.done, 0),
         round(a.done * 100.0 / nullif(t.target_value, 0), 1),
         greatest((t.pe - public.baghdad_today())::int, 0),
         round(a.pipe), round(a.wpipe),
         case when t.metric = 'إيراد'
              then round(greatest(t.target_value - a.done, 0) / nullif(a.win_rate, 0))
              else round(greatest(t.target_value - a.done, 0) / nullif(a.win_rate, 0), 1)
         end,
         (a.done / nullif(t.target_value, 0))
           >= ((public.baghdad_today() - t.period_start)::numeric
               / nullif((t.pe - t.period_start)::numeric, 0))
    from t
    join actual a on a.tid = t.id
    left join public.crm_owner_directory() e on e.id = t.scope_id and t.scope = 'موظف'
    left join public.projects tm on tm.id = t.scope_id and t.scope = 'فريق'
    left join public.projects pr on pr.id = t.scope_id and t.scope = 'مشروع'
   order by t.scope, coalesce(e.full_name, tm.name, pr.name, '');
$$;

-- ------------------------------------------------------------
-- 6) اللقطة اليومية — ومعها لقطة «فريق» لكل مشروع
-- ------------------------------------------------------------
create or replace function public.take_crm_snapshot(p_day date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, public.baghdad_today());
  k record;
  pr record;
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

  -- لقطة لكل فريق مشروع — شريط الاتجاه عند المشرف يقرأ لقطة فريقه (095)
  for pr in select p.id from public.projects p loop
    select * into k from public.crm_kpis(p_team_id => pr.id);

    select jsonb_object_agg(x.stage_name, x.c) into dist
      from (select v.stage_name, count(*) c
              from public.v_crm_opportunities v
             where v.stage_type = 'open' and v.team_id = pr.id
             group by v.stage_name) x;

    insert into public.crm_snapshots
      (taken_on, scope, scope_id, leads, opportunities, open_count, won_count, lost_count,
       conversion_rate, pipeline_value, weighted_pipeline, won_value, avg_cycle_days,
       overdue_count, neglected_count, stage_distribution)
    values
      (d, 'فريق', pr.id, k.leads, k.opportunities, k.open_count, k.won_count, k.lost_count,
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
  end loop;

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

-- ------------------------------------------------------------
-- 7) قراءة اللقطات — المشرف فريقه وأفراده، لا الشركة
-- ------------------------------------------------------------
drop policy if exists "read snapshots" on public.crm_snapshots;
create policy "read snapshots" on public.crm_snapshots
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or ((select public.is_supervisor())
        and ((scope = 'فريق' and scope_id in (select s.id from public.my_supervised_projects() s))
          or (scope = 'موظف' and scope_id in (select s.id from public.my_scope_employees() s))))
  );

-- ------------------------------------------------------------
-- 8) التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 095 تقارير المشرف على مشروعه ---';
  raise notice 'anon ينفّذ الدليل: % (يجب false)',
    has_function_privilege('anon', 'public.crm_owner_directory()', 'EXECUTE');
  raise notice 'الدليل من داخل القاعدة يرى: % موظفاً',
    (select count(*) from public.crm_owner_directory());
end $$;

notify pgrst, 'reload schema';
