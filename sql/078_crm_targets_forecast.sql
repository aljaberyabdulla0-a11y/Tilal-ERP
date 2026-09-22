-- ============================================================
-- تلال ERP — 078: الأهداف والتنبؤ
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- سؤال الإدارة في آخر كل شهر واحد: **كم سنبيع؟**
-- والجواب اليوم تخمين، لأن النظام يعرف الماضي ولا يرتّب المستقبل.
--
-- و«التاركت» موجود فعلاً في project_commissions.target_sales منذ
-- sql/048، لكنه رقم واحد على المشروع — لا هدف لموظف ولا لفريق،
-- ولا مقارنة بين المستهدَف والمُنجَز والمتبقّي.
--
-- ============================================================
-- المبدأ الحاكم
--
--     التنبؤ ثلاثة أرقام لا رقم واحد.
--
--   المُغلق (Closed)      ما بيع فعلاً هذا الشهر        يقين
--   الملتزم (Commit)      المفتوح باحتمال ≥٧٠٪ وموعد قريب  ترجيح عالٍ
--   أفضل حالة (Best)      كل المفتوح موزوناً باحتماله      سقف
--
-- ورقمٌ واحد يُقدَّم للإدارة باسم «التنبؤ» يُقرأ كوعد. ثلاثةٌ تُقرأ
-- كمدى — وهو الصدق.
--
-- ⚠️ الترجيح هنا بالاحتمال المُعلَن في crm_stages، لا بمعدّلات
--    تحويل تاريخية. التصحيح التاريخي يحتاج دورات مكتملة كافية،
--    ولا يوجد منها اليوم ما يكفي. تُضاف حين تتوفّر — وتقديرٌ
--    بمعطيات ناقصة يُعلَن نقصه خيرٌ من ثقةٍ مصطنعة.
--
-- ============================================================
-- ما يضيفه
--
--   1) sales_targets           — أهداف بمستويات ومدد
--   2) crm_target_progress()   — المستهدَف والمُنجَز والفجوة
--   3) crm_forecast()          — السيناريوهات الثلاثة شهرياً
--   4) crm_forecast_by()       — التنبؤ مقسوماً (موظف/مشروع/مصدر)
--   5) crm_forecast_snapshots  — المتوقَّع مقابل الفعلي لاحقاً
--
-- يتطلب: sql/070 و 072 و 076. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الأهداف
--
-- المفتاح المركّب يمنع هدفين متناقضين لنفس (النطاق، المدة، المقياس).
-- ------------------------------------------------------------
create table if not exists public.sales_targets (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('شركة','فريق','موظف','مشروع')),
  scope_id     uuid,                       -- فارغ حين النطاق «شركة»
  period_type  text not null check (period_type in ('شهري','ربعي','سنوي')),
  period_start date not null,              -- أول يوم في المدة
  metric       text not null check (metric in ('صفقات','وحدات','إيراد')),
  target_value numeric not null check (target_value > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (scope, scope_id, period_type, period_start, metric)
);

comment on table public.sales_targets is
  'الأهداف بمستوياتها. «إيراد» = عمولة تلال لا ثمن الوحدات (sql/056).';
comment on column public.sales_targets.scope_id is
  'معرّف الفريق أو الموظف أو المشروع. فارغ حين النطاق «شركة» — والقيد الفريد يعامل NULL كقيمة.';

create index if not exists sales_targets_period_idx
  on public.sales_targets (period_start, period_type);
create index if not exists sales_targets_scope_idx
  on public.sales_targets (scope, scope_id);

-- نهاية المدة — تُحسب ولا تُخزَّن، فلا تتناقض مع بدايتها
create or replace function public.target_period_end(p_start date, p_type text)
returns date language sql immutable as $$
  select case p_type
           when 'شهري' then (p_start + interval '1 month')::date - 1
           when 'ربعي' then (p_start + interval '3 months')::date - 1
           when 'سنوي' then (p_start + interval '1 year')::date - 1
           else (p_start + interval '1 month')::date - 1
         end;
$$;

-- ------------------------------------------------------------
-- 2) تقدّم الهدف
--
-- «الأنابيب المطلوبة» عمودٌ عملي: الفجوة ÷ معدّل الفوز. يقول للموظف
-- كم فرصة يحتاج أن يفتح لا كم يحتاج أن يبيع — والثاني لا يُعمَل به.
-- ------------------------------------------------------------
create or replace function public.crm_target_progress(
  p_period_start date default null, p_period_type text default 'شهري'
) returns table (
  target_id      uuid,
  scope          text,
  scope_id       uuid,
  scope_name     text,
  metric         text,
  target_value   numeric,
  achieved       numeric,
  remaining      numeric,
  achieved_pct   numeric,
  days_left      int,
  pipeline_open  numeric,
  weighted_open  numeric,
  pipeline_needed numeric,
  on_track       boolean
)
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
           -- المُنجَز بحسب المقياس
           case t.metric
             when 'صفقات' then count(v.id) filter (where v.stage_type = 'won')
             when 'وحدات' then count(distinct v.unit_id) filter (where v.stage_type = 'won')
             else coalesce(sum(v.won_value) filter (where v.stage_type = 'won'), 0)
           end::numeric as done,
           coalesce(sum(v.expected_value) filter (where v.stage_type = 'open'), 0) as pipe,
           coalesce(sum(v.weighted_value), 0) as wpipe,
           -- معدّل الفوز في نفس النطاق — أساس «الأنابيب المطلوبة»
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
         -- كم أنبوباً يلزم لسدّ الفجوة بمعدّل الفوز الحالي
         case when t.metric = 'إيراد'
              then round(greatest(t.target_value - a.done, 0) / nullif(a.win_rate, 0))
              else round(greatest(t.target_value - a.done, 0) / nullif(a.win_rate, 0), 1)
         end,
         -- على المسار؟ نسبة الإنجاز ≥ نسبة الزمن المنقضي
         (a.done / nullif(t.target_value, 0))
           >= ((public.baghdad_today() - t.period_start)::numeric
               / nullif((t.pe - t.period_start)::numeric, 0))
    from t
    join actual a on a.tid = t.id
    left join public.employees e on e.id = t.scope_id and t.scope = 'موظف'
    left join public.projects tm on tm.id = t.scope_id and t.scope = 'فريق'   -- الفريق = المشروع
    left join public.projects pr on pr.id = t.scope_id and t.scope = 'مشروع'
   order by t.scope, coalesce(e.full_name, tm.name, pr.name, '');
$$;

-- ------------------------------------------------------------
-- 3) التنبؤ — السيناريوهات الثلاثة، شهراً شهراً
--
-- الفرص بلا expected_close_date تُنسَب إلى شهر متوقَّع مشتقّ من
-- متوسط دورة البيع. وهو تقديرٌ مُعلَن: العمود undated يقول كم فرصة
-- دخلت بهذا الافتراض، فيعرف القارئ متانة الرقم.
-- ------------------------------------------------------------
create or replace function public.crm_forecast(
  p_months int default 3,
  p_owner_id uuid default null,
  p_project_id uuid default null
) returns table (
  period          date,
  closed_value    numeric,
  commit_value    numeric,
  best_case_value numeric,
  closed_count    bigint,
  commit_count    bigint,
  open_count      bigint,
  undated_count   bigint
)
language sql stable set search_path = public as $$
  with cyc as (
    select coalesce(avg(v.sales_cycle_days), 30)::int d
      from public.v_crm_opportunities v where v.stage_type = 'won'
  ),
  f as (
    select v.*,
           date_trunc('month',
             coalesce(v.expected_close_date,
                      (v.created_at + ((select d from cyc) || ' days')::interval)::date)
           )::date as exp_month,
           (v.expected_close_date is null) as undated
      from public.v_crm_opportunities v
     where (p_owner_id   is null or v.owner_id   = p_owner_id)
       and (p_project_id is null or v.project_id = p_project_id)
  ),
  months as (
    select (date_trunc('month', public.baghdad_today())::date
            + (n || ' months')::interval)::date m
      from generate_series(0, greatest(p_months - 1, 0)) n
  )
  select m.m,
         -- المُغلق: فوزٌ وقع فعلاً في هذا الشهر
         round(coalesce(sum(f.won_value)
               filter (where f.stage_type = 'won'
                         and date_trunc('month', f.closed_at)::date = m.m), 0)),
         -- الملتزم: مفتوح باحتمال عالٍ ومتوقَّع في هذا الشهر
         round(coalesce(sum(f.expected_value)
               filter (where f.stage_type = 'open'
                         and f.probability >= 70 and f.exp_month = m.m), 0)),
         -- أفضل حالة: كل المفتوح موزوناً
         round(coalesce(sum(f.weighted_value)
               filter (where f.stage_type = 'open' and f.exp_month = m.m), 0)),
         count(*) filter (where f.stage_type = 'won'
                            and date_trunc('month', f.closed_at)::date = m.m),
         count(*) filter (where f.stage_type = 'open'
                            and f.probability >= 70 and f.exp_month = m.m),
         count(*) filter (where f.stage_type = 'open' and f.exp_month = m.m),
         count(*) filter (where f.stage_type = 'open' and f.exp_month = m.m and f.undated)
    from months m
    left join f on true
   group by m.m
   order by m.m;
$$;

comment on function public.crm_forecast(int, uuid, uuid) is
  'ثلاثة أرقام لا واحد. undated_count يقول كم فرصة دخلت بتاريخ مُقدَّر — متانة الرقم مُعلَنة.';

-- ------------------------------------------------------------
-- 4) التنبؤ مقسوماً
-- ------------------------------------------------------------
create or replace function public.crm_forecast_by(p_dimension text default 'موظف')
returns table (
  dimension_id    uuid,
  dimension_name  text,
  open_count      bigint,
  pipeline_value  numeric,
  weighted_value  numeric,
  commit_value    numeric,
  avg_probability numeric
)
language plpgsql stable set search_path = public as $$
begin
  if p_dimension not in ('موظف','مشروع','مصدر','فريق') then
    raise exception 'بُعد غير معروف: % — المتاح: موظف | مشروع | مصدر | فريق', p_dimension;
  end if;

  return query
  select case p_dimension
           when 'موظف'  then v.owner_id
           when 'مشروع' then v.project_id
           when 'مصدر'  then v.source_id
           else v.team_id end,
         coalesce(case p_dimension
           when 'موظف'  then v.owner_name
           when 'مشروع' then v.project_name
           when 'مصدر'  then v.source_name
           else (select t.name from public.projects t where t.id = v.team_id) end, 'غير محدّد'),
         count(*),
         round(coalesce(sum(v.expected_value), 0)),
         round(coalesce(sum(v.weighted_value), 0)),
         round(coalesce(sum(v.expected_value) filter (where v.probability >= 70), 0)),
         round(coalesce(avg(v.probability), 0), 1)
    from public.v_crm_opportunities v
   where v.stage_type = 'open'
   group by 1, 2
   order by 4 desc;
end $$;

-- ------------------------------------------------------------
-- 5) لقطات التنبؤ — المتوقَّع مقابل الفعلي
--
-- بلا لقطة لا يمكن أن نسأل «هل كان تنبؤ الشهر الماضي دقيقاً؟».
-- تُؤخذ أول كل شهر للأشهر الثلاثة القادمة، ثم يُملأ الفعلي عند
-- انقضاء الشهر فتظهر دقّة التنبؤ رقماً.
-- ------------------------------------------------------------
create table if not exists public.crm_forecast_snapshots (
  id            bigserial primary key,
  taken_on      date not null,
  period        date not null,
  closed_value  numeric,
  commit_value  numeric,
  best_case_value numeric,
  open_count    bigint,
  -- يُملأ لاحقاً حين ينقضي الشهر
  actual_value  numeric,
  actual_count  bigint,
  accuracy_pct  numeric,
  unique (taken_on, period)
);

comment on table public.crm_forecast_snapshots is
  'تنبؤٌ محفوظ بتاريخ أخذه. المقارنة بالفعلي تُقاس بها دقّة التنبؤ نفسه.';

create or replace function public.take_forecast_snapshot()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; d date := public.baghdad_today();
begin
  for r in select * from public.crm_forecast(3) loop
    insert into public.crm_forecast_snapshots
      (taken_on, period, closed_value, commit_value, best_case_value, open_count)
    values (d, r.period, r.closed_value, r.commit_value, r.best_case_value, r.open_count)
    on conflict (taken_on, period) do update
      set closed_value = excluded.closed_value,
          commit_value = excluded.commit_value,
          best_case_value = excluded.best_case_value,
          open_count = excluded.open_count;
    n := n + 1;
  end loop;

  -- إغلاق الأشهر المنقضية: نُثبّت الفعلي ونقيس الدقّة
  update public.crm_forecast_snapshots s
     set actual_value = a.val,
         actual_count = a.cnt,
         accuracy_pct = case when a.val > 0
                             then round(100 - abs(s.commit_value - a.val) * 100.0 / a.val, 1)
                        end
    from (
      select date_trunc('month', v.closed_at)::date p,
             coalesce(sum(v.won_value), 0) val, count(*) cnt
        from public.v_crm_opportunities v
       where v.stage_type = 'won' and v.closed_at is not null
       group by 1
    ) a
   where s.period = a.p
     and s.period < date_trunc('month', d)::date
     and s.actual_value is null;

  return n;
end $$;

-- أول كل شهر الساعة ٥ فجراً بغداد (٢ UTC)
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('crm-forecast-snapshot'); exception when others then null; end $$;
select cron.schedule('crm-forecast-snapshot', '0 2 1 * *',
  $cron$ select public.take_forecast_snapshot(); $cron$);

-- ------------------------------------------------------------
-- 6) الصلاحيات
--
-- الأهداف يضعها المدير. والموظف يرى هدفه هو — لا أهداف زملائه.
-- ------------------------------------------------------------
alter table public.sales_targets           enable row level security;
alter table public.crm_forecast_snapshots  enable row level security;

drop policy if exists "read targets" on public.sales_targets;
create policy "read targets" on public.sales_targets
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (scope = 'شركة')
    or (scope = 'موظف' and scope_id in (select s.id from public.my_scope_employees() s))
    or (scope = 'فريق'
        and scope_id in (select t.id from public.my_supervised_projects() t))
  );

drop policy if exists "admin writes targets" on public.sales_targets;
create policy "admin writes targets" on public.sales_targets
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read forecast snapshots" on public.crm_forecast_snapshots;
create policy "read forecast snapshots" on public.crm_forecast_snapshots
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or (select public.is_supervisor()));

create or replace function public.stamp_sales_target()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_stamp_sales_target on public.sales_targets;
create trigger trg_stamp_sales_target
  before insert or update on public.sales_targets
  for each row execute function public.stamp_sales_target();

drop trigger if exists trg_audit_sales_targets on public.sales_targets;
create trigger trg_audit_sales_targets
  after insert or update or delete on public.sales_targets
  for each row execute function public.audit_row();

revoke all on function public.crm_target_progress(date, text)  from public;
revoke all on function public.crm_forecast(int, uuid, uuid)    from public;
revoke all on function public.crm_forecast_by(text)            from public;
revoke all on function public.take_forecast_snapshot()         from public;
revoke all on function public.target_period_end(date, text)    from public;

grant execute on function public.crm_target_progress(date, text) to authenticated, service_role;
grant execute on function public.crm_forecast(int, uuid, uuid)   to authenticated, service_role;
grant execute on function public.crm_forecast_by(text)           to authenticated, service_role;
grant execute on function public.target_period_end(date, text)   to authenticated, service_role;
grant execute on function public.take_forecast_snapshot()        to service_role;

-- ------------------------------------------------------------
-- 7) التحقّق
-- ------------------------------------------------------------
do $$
declare r record; n_targets int; n int;
begin
  raise notice '--- 078 الأهداف والتنبؤ ---';

  select count(*) into n_targets from public.sales_targets;
  raise notice 'أهداف معرَّفة: %', n_targets;
  if n_targets = 0 then
    raise notice 'لا أهداف بعد — تُدخَل من /dashboard/crm/forecast. مثال:';
    raise notice '  insert into sales_targets(scope,scope_id,period_type,period_start,metric,target_value)';
    raise notice '  values (''شركة'', null, ''شهري'', date_trunc(''month'', current_date)::date, ''صفقات'', 10);';
  end if;

  raise notice 'التنبؤ للأشهر الثلاثة القادمة:';
  for r in select * from public.crm_forecast(3) loop
    raise notice '  % — مُغلق % | ملتزم % (% فرصة) | أفضل حالة % | مفتوح % (بتاريخ مُقدَّر %)',
      to_char(r.period, 'YYYY-MM'), r.closed_value, r.commit_value, r.commit_count,
      r.best_case_value, r.open_count, r.undated_count;
  end loop;

  n := public.take_forecast_snapshot();
  raise notice 'أول لقطة تنبؤ: % شهراً. قياس الدقّة يبدأ بعد انقضاء أول شهر.', n;
end $$;

notify pgrst, 'reload schema';
