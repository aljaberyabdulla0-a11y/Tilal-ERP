-- ============================================================
-- تلال ERP — 097: محرّك التقارير (٢/٤) — الحالة والمقاييس والاستعلام
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- ثلاثة أسئلة مختلفة تبدو سؤالاً واحداً (§53)
--
--   ١) كم عميلاً في «مناقشة العرض» **الآن**؟          ← الحالة الراهنة
--   ٢) كم عميلاً **دخل** «مناقشة العرض» في سبتمبر؟    ← الأحداث (096)
--   ٣) كم عميلاً **كان** فيها في نهاية ٢٠ سبتمبر؟      ← اللقطة (098)
--
-- الأول والثالث صورتان لنفس الشكل في لحظتين، فتُبنيان بدالة واحدة:
-- crm_state_as_of(لحظة). بلا لحظة = الآن من الجداول الحيّة. بلحظة =
-- إعادة بناء من التاريخ: المرحلة من أحداث المراحل، والمالك من تاريخ
-- الإسناد، وآخر تواصل وموعد المتابعة من أحداث التواصل.
--
-- ⚠️ وما لا تاريخ له يُؤخذ من لحظة التشغيل ويُعلَن: القيمة المتوقّعة،
--    والاحتمال (إن لم تتغيّر المرحلة)، والحرارة، والدرجة، والمشروع.
--    اللقطة اليومية تُؤخذ صباح اليوم التالي فالفارق ساعات؛ وإعادة بناء
--    يومٍ قديم تحمل الفارق كاملاً — وتُعلَّم «مُعاد بناؤها» (098).
--
-- ============================================================
-- المقاييس: تعريف واحد مخزَّن، لا صيغة في صفحة (§51)
--
-- crm_metrics — صفٌّ لكل مقياس: شرطه (أيّ الصفوف)، وتجميعه (عدّ،
-- عملاء فريدون، مجموع، متوسط، نسبة)، ومصدره (أحداث أم حالة)، وتاريخه
-- المستعمل، ووصفه للإدارة. المحرّك يقرأ الصفّ ويبني الاستعلام.
-- فالوثيقة والتنفيذ **نفس الصفّ** — لا يفترقان.
--
-- ⚠️ الشرط نصّ SQL يُنفَّذ. لذلك الجدول بلا سياسة كتابة ولا منحة
--    تعديل لأحد: يُغيَّر بهجرة وحدها. قراءته للجميع (الوثيقة).
--
-- ============================================================
-- المحرّك: crm_report_query — استعلام واحد لكل تقرير
--
--     المقاييس × الأبعاد × المُرشِّحات × المدى × أساس التاريخ
--
-- security invoker: كل قارئ يرى نطاقه عبر RLS على الأحداث واللقطات
-- والعملاء. نفس الاستدعاء يعطي المدير الشركة والموظف نفسه.
--
-- يتطلب: 096. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 0) إعدادات ومعالم المراحل
-- ------------------------------------------------------------
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value)
values ('dormant_days', to_jsonb(30), 'الخمول',
        'ليد مفتوح بلا تواصل أطول من هذا = خامل. «مهمل» (neglected_days) أقصر منه.', 'يوم', 7, 365)
on conflict (key) do nothing;

-- معلم المرحلة في التقارير: «ليد/اتصال/زيارة/عرض» بمفردات ثابتة لا
-- بأسماء المراحل — فإعادة تسمية مرحلة لا تكسر تقريراً، وإضافة مرحلة
-- وسطى تُنسب إلى معلمها من الإعدادات.
alter table public.crm_stages add column if not exists report_milestone text;
do $$ begin
  alter table public.crm_stages add constraint crm_stages_milestone_chk
    check (report_milestone is null or report_milestone in ('lead', 'contacted', 'visit', 'offer'));
exception when duplicate_object then null; end $$;

update public.crm_stages set report_milestone = 'lead'      where name = 'ليد'          and report_milestone is null;
update public.crm_stages set report_milestone = 'contacted' where name = 'اتصال'        and report_milestone is null;
update public.crm_stages set report_milestone = 'visit'     where name = 'زيارة'        and report_milestone is null;
update public.crm_stages set report_milestone = 'offer'     where name = 'مناقشة العرض' and report_milestone is null;

-- ------------------------------------------------------------
-- 1) الحالة «كما كانت» — دالة واحدة للحظة الآن وللحظة ماضية
-- ------------------------------------------------------------
create or replace function public.crm_state_as_of(p_as_of timestamptz default null)
returns table (
  client_id uuid, opportunity_id uuid, is_primary boolean,
  owner_id uuid, team_id uuid, project_id uuid, unit_id uuid, source_id uuid, campaign_id uuid,
  stage_id uuid, stage_name text, stage_order int, stage_type text, milestone text,
  stage_estimated boolean, lead_open boolean, is_new_lead boolean, is_new_opp boolean,
  is_qualified boolean, temperature text, lead_score int, score_band text,
  payment_method text, purchase_purpose text, area text,
  expected_value numeric, probability numeric, weighted_value numeric, won_value numeric,
  lost_reason_id uuid, lead_created_at timestamptz, opp_created_at timestamptz,
  expected_close_date date, next_action_date date, has_next_action boolean,
  due_today boolean, is_overdue boolean, last_contact_at timestamptz, days_silent int,
  silence_bucket text, no_contact_ever boolean, is_neglected boolean, is_dormant boolean,
  has_active_reservation boolean, sla_breach_open boolean, is_unassigned boolean
)
language sql stable set search_path = public as $$
  with prm as (
    select coalesce(p_as_of, now())                                   as ts,
           p_as_of is null                                           as live,
           public.crm_bgd_date(coalesce(p_as_of, now()))             as d,
           public.crm_setting_int('neglected_days', 14)              as neglect,
           public.crm_setting_int('dormant_days', 30)                as dormant,
           (select g.id from public.crm_stages g
             where g.stage_type = 'open' order by g.sort_order limit 1) as entry_stage
  ),
  cl as (
    select c.*,
           case when prm.live then c.owner_id
                else public.crm_owner_as_of(c.id, prm.ts) end as owner_at
      from public.clients c, prm
     where c.created_at <= prm.ts
       and (c.deleted_at is null or (not prm.live and c.deleted_at > prm.ts))
  ),
  op as (
    select o.*
      from public.opportunities o, prm
     where o.created_at <= prm.ts
       and (o.deleted_at is null or (not prm.live and o.deleted_at > prm.ts))
  ),
  b0 as (
    select c.id as client_id, o.id as opportunity_id,
           case when prm.live then coalesce(o.owner_id, c.owner_at) else c.owner_at end as owner_id,
           coalesce(o.project_id, c.project_id, c.preferred_project_id) as project_id,
           o.unit_id,
           coalesce(o.source_id, c.original_source_id)  as source_id,
           coalesce(o.campaign_id, c.campaign_id)       as campaign_id,
           o.stage_id                                   as stage_now,
           -- المرحلة: الحيّة، أو آخر حدث قبل اللحظة، أو «من» أول حدث بعدها
           case
             when o.id is null then (select g.id from public.crm_stages g where g.name = c.stage)
             when prm.live then o.stage_id
             else coalesce(
               (select f.to_stage_id from public.crm_event_facts f
                 where f.opportunity_id = o.id and f.event_type = 'stage_change'
                   and not f.is_void and f.event_at <= prm.ts
                 order by f.event_at desc, f.id desc limit 1),
               (select coalesce(f.from_stage_id, prm.entry_stage) from public.crm_event_facts f
                 where f.opportunity_id = o.id and f.event_type = 'stage_change'
                   and not f.is_void and f.event_at > prm.ts
                 order by f.event_at asc, f.id asc limit 1),
               o.stage_id)
           end as stage_at,
           (not prm.live and o.id is not null and not exists (
              select 1 from public.crm_event_facts f
               where f.opportunity_id = o.id and f.event_type = 'stage_change'
                 and not f.is_void and f.event_at <= prm.ts))  as stage_estimated,
           c.created_at as lead_created_at, o.created_at as opp_created_at,
           c.qualified_at, c.lead_temperature, c.lead_score, c.payment_method,
           c.purchase_purpose, c.area,
           o.expected_value, o.probability, o.won_value, o.lost_reason_id, o.expected_close_date,
           case when prm.live then coalesce(o.next_action_date, c.follow_up_date)
                else (select f.next_action_date from public.crm_event_facts f
                       where f.client_id = c.id and f.event_type = 'activity'
                         and f.event_at <= prm.ts and f.next_action_date is not null
                         and (f.opportunity_id is null or o.id is null or f.opportunity_id = o.id)
                       order by f.event_at desc limit 1)
           end as next_action_at,
           case when prm.live then c.last_contact_at
                else (select max(f.event_at) from public.crm_event_facts f
                       where f.client_id = c.id and f.event_type = 'activity'
                         and f.counts_as_contact and not f.is_void and f.event_at <= prm.ts)
           end as last_contact_at
      from cl c
      cross join prm
      left join op o on o.client_id = c.id
  ),
  dir as (select * from public.crm_owner_directory()),
  b as (
    select b0.*, g.name as stage_name, g.sort_order as stage_order, g.stage_type,
           g.report_milestone, g.probability as stage_probability,
           dir.project_id as team_id,
           bool_or(coalesce(g.stage_type, 'open') = 'open') over (partition by b0.client_id) as lead_open,
           row_number() over (partition by b0.client_id
                              order by (g.stage_type = 'open') desc nulls last,
                                       b0.opp_created_at desc nulls last) as rn
      from b0
      left join public.crm_stages g on g.id = b0.stage_at
      left join dir on dir.id = b0.owner_id
  )
  select b.client_id, b.opportunity_id, b.rn = 1,
         b.owner_id, b.team_id, b.project_id, b.unit_id, b.source_id, b.campaign_id,
         b.stage_at, b.stage_name, b.stage_order, b.stage_type, b.report_milestone,
         b.stage_estimated, b.lead_open,
         public.crm_bgd_date(b.lead_created_at) = prm.d,
         b.opp_created_at is not null and public.crm_bgd_date(b.opp_created_at) = prm.d,
         b.qualified_at is not null and b.qualified_at <= prm.ts,
         b.lead_temperature, b.lead_score,
         case when b.lead_score is null then 'بلا درجة'
              when b.lead_score >= 70 then '70+'
              when b.lead_score >= 40 then '40–69'
              else '<40' end,
         b.payment_method, b.purchase_purpose, b.area,
         b.expected_value,
         -- الاحتمال: احتمال الفرصة إن كانت المرحلة نفسها، وإلا الافتراضي للمرحلة يومها
         case when b.stage_at is not distinct from b.stage_now then b.probability
              else b.stage_probability end,
         case when b.stage_type = 'open'
              then coalesce(b.expected_value, 0)
                   * coalesce(case when b.stage_at is not distinct from b.stage_now
                                   then b.probability else b.stage_probability end, 0) / 100.0
              else 0 end,
         case when b.stage_type = 'won' then b.won_value end,
         case when b.stage_type = 'lost' then b.lost_reason_id end,
         b.lead_created_at, b.opp_created_at, b.expected_close_date,
         b.next_action_at,
         b.next_action_at is not null,
         coalesce(b.stage_type, 'open') = 'open' and b.next_action_at = prm.d,
         coalesce(b.stage_type, 'open') = 'open' and b.next_action_at < prm.d,
         b.last_contact_at,
         case when b.last_contact_at is not null
              then prm.d - public.crm_bgd_date(b.last_contact_at) end,
         case when coalesce(b.stage_type, 'open') <> 'open' then null
              when b.last_contact_at is null then 'بلا تواصل'
              when prm.d - public.crm_bgd_date(b.last_contact_at) <= 3  then '0–3'
              when prm.d - public.crm_bgd_date(b.last_contact_at) <= 7  then '4–7'
              when prm.d - public.crm_bgd_date(b.last_contact_at) <= 14 then '8–14'
              when prm.d - public.crm_bgd_date(b.last_contact_at) <= 21 then '15–21'
              when prm.d - public.crm_bgd_date(b.last_contact_at) <= 30 then '22–30'
              else '30+' end,
         coalesce(b.stage_type, 'open') = 'open' and b.last_contact_at is null,
         -- «مهمل» كما في 076 حرفياً: الصمت من آخر تواصل وإلا من الإنشاء
         coalesce(b.stage_type, 'open') = 'open'
           and prm.d - public.crm_bgd_date(coalesce(b.last_contact_at, b.opp_created_at, b.lead_created_at)) > prm.neglect,
         coalesce(b.stage_type, 'open') = 'open'
           and prm.d - public.crm_bgd_date(coalesce(b.last_contact_at, b.opp_created_at, b.lead_created_at)) > prm.dormant,
         case when prm.live then exists (
                select 1 from public.reservations r
                 where r.client_id = b.client_id and r.status = 'حجز'
                   and (b.opportunity_id is null or r.opportunity_id is null or r.opportunity_id = b.opportunity_id))
              else exists (
                select 1 from public.crm_event_facts f
                 where f.client_id = b.client_id and f.event_type = 'reservation'
                   and not f.is_void and f.event_at <= prm.ts
                   and (b.opportunity_id is null or f.opportunity_id is null or f.opportunity_id = b.opportunity_id)
                   and not exists (select 1 from public.crm_event_facts x
                                    where x.source_table = 'reservations' and x.source_id = f.source_id
                                      and x.event_type in ('sale_completed', 'reservation_cancelled')
                                      and x.event_at <= prm.ts))
         end,
         exists (select 1 from public.crm_sla_breaches s
                  where s.client_id = b.client_id and s.detected_at <= prm.ts
                    and (s.resolved_at is null or s.resolved_at > prm.ts)),
         coalesce(b.stage_type, 'open') = 'open' and b.owner_id is null
    from b cross join prm;
$$;

comment on function public.crm_state_as_of(timestamptz) is
  'صورة الـCRM في لحظة: صفّ لكل (عميل × فرصة). بلا لحظة = الآن (RLS تسري). '
  'اللقطة اليومية (098) تحفظ ناتجها. المرحلة والمالك وآخر تواصل والمتابعة من التاريخ؛ '
  'القيمة والحرارة والدرجة من لحظة التشغيل.';

-- ------------------------------------------------------------
-- 2) جداول اللقطات — التشغيل والصفوف
--
-- كل تشغيل صفٌّ في crm_snapshot_runs، وصفوفه تحمل معرّفه. لليوم الواحد
-- تشغيلٌ «جارٍ» واحد (فهرس فريد جزئي). إعادة البناء تُنشئ تشغيلاً جديداً
-- وتُبقي القديم كما هو — فالأصل والمصحَّح يُقارنان (§46) ولا يُمحى شيء.
-- ------------------------------------------------------------
create table if not exists public.crm_snapshot_runs (
  id                uuid primary key default gen_random_uuid(),
  snapshot_date     date        not null,
  as_of             timestamptz not null,
  timezone          text        not null default 'Asia/Baghdad',
  trigger_kind      text        not null,
  method            text        not null default 'daily',
  status            text        not null default 'running',
  requested_by      uuid,
  requested_by_name text,
  reason            text,
  attempt           int         not null default 1,
  started_at        timestamptz not null default clock_timestamp(),
  finished_at       timestamptz,
  duration_ms       int,
  records_processed int,
  records_created   int,
  warnings          jsonb       not null default '[]'::jsonb,
  warning_count     int         not null default 0,
  error_stage       text,
  error_sqlstate    text,
  error_message     text,
  error_context     text,
  summary           jsonb,
  is_current        boolean     not null default false,
  supersedes        uuid references public.crm_snapshot_runs(id),
  superseded_by     uuid references public.crm_snapshot_runs(id),
  engine_version    text        not null default '1',
  created_at        timestamptz not null default now(),
  constraint crm_snapshot_runs_trigger_chk check (trigger_kind in ('cron', 'manual', 'retry', 'rebuild', 'backfill', 'test')),
  constraint crm_snapshot_runs_method_chk  check (method in ('daily', 'reconstructed')),
  constraint crm_snapshot_runs_status_chk  check (status in ('pending', 'running', 'completed', 'completed_with_warnings', 'failed'))
);

comment on table public.crm_snapshot_runs is
  'كل تشغيل للقطة يومية. is_current = النسخة المعتمدة لليوم. القديمة تبقى للمقارنة (أصل/مصحَّح).';
comment on column public.crm_snapshot_runs.method is
  'daily: أُخذت خلال ٣٦ ساعة من نهاية اليوم. reconstructed: أُعيد بناؤها لاحقاً — القيمة والحرارة من يوم إعادة البناء.';

create unique index if not exists crm_snapshot_runs_current_uk
  on public.crm_snapshot_runs (snapshot_date) where is_current;
create index if not exists crm_snapshot_runs_date_idx on public.crm_snapshot_runs (snapshot_date desc, started_at desc);

create table if not exists public.crm_snapshot_rows (
  run_id           uuid not null references public.crm_snapshot_runs(id) on delete cascade,
  snapshot_date    date not null,
  client_id uuid not null, opportunity_id uuid, is_primary boolean,
  owner_id uuid, team_id uuid, project_id uuid, unit_id uuid, source_id uuid, campaign_id uuid,
  stage_id uuid, stage_name text, stage_order int, stage_type text, milestone text,
  stage_estimated boolean, lead_open boolean, is_new_lead boolean, is_new_opp boolean,
  is_qualified boolean, temperature text, lead_score int, score_band text,
  payment_method text, purchase_purpose text, area text,
  expected_value numeric, probability numeric, weighted_value numeric, won_value numeric,
  lost_reason_id uuid, lead_created_at timestamptz, opp_created_at timestamptz,
  expected_close_date date, next_action_date date, has_next_action boolean,
  due_today boolean, is_overdue boolean, last_contact_at timestamptz, days_silent int,
  silence_bucket text, no_contact_ever boolean, is_neglected boolean, is_dormant boolean,
  has_active_reservation boolean, sla_breach_open boolean, is_unassigned boolean,
  constraint crm_snapshot_rows_uk unique nulls not distinct (run_id, client_id, opportunity_id)
);

comment on table public.crm_snapshot_rows is
  'صفّ لكل (عميل × فرصة) في كل لقطة. لا يُعدَّل بعد الكتابة — إعادة البناء تشغيلٌ جديد.';

create index if not exists crm_snapshot_rows_date_idx    on public.crm_snapshot_rows (snapshot_date, run_id);
create index if not exists crm_snapshot_rows_owner_idx   on public.crm_snapshot_rows (owner_id, snapshot_date);
create index if not exists crm_snapshot_rows_project_idx on public.crm_snapshot_rows (project_id, snapshot_date);
create index if not exists crm_snapshot_rows_team_idx    on public.crm_snapshot_rows (team_id, snapshot_date);
create index if not exists crm_snapshot_rows_client_idx  on public.crm_snapshot_rows (client_id);

-- اللقطات المعتمدة وحدها — ما تقرأه التقارير
create or replace view public.v_crm_snapshot_current with (security_invoker = true) as
select r.*
  from public.crm_snapshot_rows r
  join public.crm_snapshot_runs u on u.id = r.run_id and u.is_current;

-- ------------------------------------------------------------
-- 3) سجلّ المقاييس — التعريف والتنفيذ في صفّ واحد
-- ------------------------------------------------------------
create table if not exists public.crm_metrics (
  code          text primary key,
  name_ar       text not null,
  name_en       text not null,
  category      text not null,
  source        text not null,          -- events | state
  predicate     text not null,          -- شرط SQL على الاسم المستعار r (و gs لمرحلة الحدث، و cl للعميل)
  agg           text not null,          -- count | clients | opportunities | sum:<عمود> | avg:<عمود> | ratio
  numerator     text,                   -- للنسبة
  denominator   text,
  unit          text not null default 'count',     -- count | money | pct | days
  good_direction text,                  -- up | down | null
  definition    text not null,
  formula       text not null,
  date_field    text not null,
  source_tables text not null,
  notes         text,
  legacy_equivalent text,
  owner         text not null default 'إدارة المبيعات',
  sort_order    int  not null default 100,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now(),
  constraint crm_metrics_source_chk check (source in ('events', 'state')),
  constraint crm_metrics_unit_chk   check (unit in ('count', 'money', 'pct', 'days')),
  constraint crm_metrics_agg_chk    check (agg in ('count', 'clients', 'opportunities', 'ratio')
                                           or agg ~ '^(sum|avg):[a-z_]+$')
);

comment on table public.crm_metrics is
  'التعريف الملزم لكل مقياس في محرّك التقارير (097). يُغيَّر بهجرة وحدها — لا سياسة كتابة.';

insert into public.crm_metrics
  (code, name_ar, name_en, category, source, predicate, agg, numerator, denominator, unit,
   good_direction, definition, formula, date_field, source_tables, notes, legacy_equivalent, sort_order)
values
-- ===== الليدات (أحداث) =====
('NEW_LEADS', 'ليدات جديدة', 'New Leads', 'leads', 'events',
 $p$r.event_type = 'lead_created'$p$, 'count', null, null, 'count', 'up',
 'عملاء أُضيفوا في المدة. العميل المحذوف ناعماً لا يُعدّ.',
 'عدد أحداث lead_created', 'تاريخ إنشاء العميل (بغداد)', 'clients → crm_event_facts', null,
 'crm_kpis.leads', 10),
('QUALIFIED_LEADS', 'تأهّلوا', 'Qualified (entered)', 'leads', 'events',
 $p$r.event_type = 'qualified'$p$, 'count', null, null, 'count', 'up',
 'ليدات عبرت درجتها عتبة التأهيل (٤٠) **في المدة**. لا «المؤهَّلون الآن» — ذاك QUALIFIED_NOW.',
 'عدد أحداث qualified', 'qualified_at (بغداد)', 'clients.qualified_at (079)', 'التأهيل يُختم مرة ولا يُمحى.', null, 20),
('NEW_OPPORTUNITIES', 'فرص جديدة', 'New Opportunities', 'leads', 'events',
 $p$r.event_type = 'opportunity_created'$p$, 'count', null, null, 'count', 'up',
 'فرص أُنشئت في المدة (كل عميل جديد يولد بفرصة — 083).', 'عدد أحداث opportunity_created',
 'تاريخ إنشاء الفرصة', 'opportunities', null, 'crm_kpis.opportunities', 30),
('RETURNED_LEADS', 'ليدات مُعادة من وسيط', 'Returned Leads', 'leads', 'events',
 $p$r.event_type = 'lead_returned'$p$, 'count', null, null, 'count', null,
 'ليدات أعادها وسيط بعد انتهاء مهلته.', 'عدد أحداث lead_returned', 'returned_at',
 'clients.returned_at', 'آخر إعادة وحدها لكل عميل.', null, 40),
('REASSIGNMENTS', 'إعادات إسناد', 'Reassignments', 'leads', 'events',
 $p$r.event_type = 'assignment' and r.event_subtype = 'reassign'$p$, 'count', null, null, 'count', null,
 'نقل ليد من مالك إلى آخر.', 'عدد أحداث assignment/reassign', 'تاريخ النقل', 'client_assignments', null, null, 50),

-- ===== التواصل (أحداث) =====
('TOTAL_ACTIVITIES', 'تواصل', 'Total Activities', 'activity', 'events',
 $p$r.event_type = 'activity' and r.counts_as_contact$p$, 'count', null, null, 'count', 'up',
 'كل تواصل يُحتسب تواصلاً (مكالمة، واتساب، اجتماع، زيارة، عرض سعر). الملاحظة ليست تواصلاً.',
 'عدد أحداث activity حيث counts_as_contact', 'occurred_at (بغداد)', 'client_activities, crm_activity_types',
 'يُنسب لمن أجراه لا لمالك العميل الحالي.', 'crm_kpis.activities', 100),
('UNIQUE_CLIENTS_CONTACTED', 'عملاء فريدون تُوُصِّل معهم', 'Unique Clients Contacted', 'activity', 'events',
 $p$r.event_type = 'activity' and r.counts_as_contact$p$, 'clients', null, null, 'count', 'up',
 '٤٠ مكالمة مع ١٠ عملاء = ١٠ هنا. يُقرأ بجانب «تواصل» كي لا يتضخّم النشاط (§13).',
 'عدد العملاء المختلفين في أحداث التواصل', 'occurred_at (بغداد)', 'client_activities', null, null, 110),
('WORKED_LEADS', 'ليدات عُمل عليها', 'Worked Leads', 'activity', 'events',
 $p$(r.event_type = 'activity') or (r.event_type = 'stage_change' and r.event_subtype not in ('initial'))$p$,
 'clients', null, null, 'count', 'up',
 'عملاء لهم أي فعل في المدة: تواصل أو ملاحظة أو نقل مرحلة.', 'عدد العملاء المختلفين', 'تاريخ الحدث',
 'client_activities, opportunity_stage_history', null, null, 115),
('CALLS', 'مكالمات', 'Calls', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'مكالمة'$p$, 'count', null, null, 'count', 'up',
 'مكالمات مسجَّلة.', 'عدد أحداث activity/مكالمة', 'occurred_at', 'client_activities', null, null, 120),
('WHATSAPP', 'واتساب', 'WhatsApp', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'واتساب'$p$, 'count', null, null, 'count', 'up',
 'رسائل واتساب مسجَّلة.', 'عدد أحداث activity/واتساب', 'occurred_at', 'client_activities', null, null, 130),
('MEETINGS', 'اجتماعات', 'Meetings', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'اجتماع'$p$, 'count', null, null, 'count', 'up',
 'اجتماعات مسجَّلة.', 'عدد أحداث activity/اجتماع', 'occurred_at', 'client_activities', null, null, 140),
('VISITS', 'زيارات', 'Visits', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'زيارة'$p$, 'count', null, null, 'count', 'up',
 'زيارات مسجَّلة كتواصل (لا مرحلة «زيارة» — تلك VISIT_STAGE_ENTERED).', 'عدد أحداث activity/زيارة',
 'occurred_at', 'client_activities', null, null, 150),
('OFFERS_SENT', 'عروض أسعار', 'Offers Sent', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'عرض سعر'$p$, 'count', null, null, 'count', 'up',
 'عروض أسعار مسجَّلة كتواصل.', 'عدد أحداث activity/عرض سعر', 'occurred_at', 'client_activities', null, null, 160),
('NOTES', 'ملاحظات', 'Notes', 'activity', 'events',
 $p$r.event_type = 'activity' and r.activity_type = 'ملاحظة'$p$, 'count', null, null, 'count', null,
 'ملاحظات — ليست تواصلاً.', 'عدد أحداث activity/ملاحظة', 'occurred_at', 'client_activities', null, null, 170),
('INCOMING', 'وارد', 'Incoming', 'activity', 'events',
 $p$r.event_type = 'activity' and r.direction = 'وارد'$p$, 'count', null, null, 'count', null,
 'تواصل بدأه العميل.', 'عدد أحداث activity/وارد', 'occurred_at', 'client_activities', null, null, 180),
('OUTGOING', 'صادر', 'Outgoing', 'activity', 'events',
 $p$r.event_type = 'activity' and r.direction = 'صادر'$p$, 'count', null, null, 'count', null,
 'تواصل بدأه الموظف.', 'عدد أحداث activity/صادر', 'occurred_at', 'client_activities', null, null, 190),
('REACHED', 'تواصل وصل', 'Reached', 'activity', 'events',
 $p$r.event_type = 'activity' and r.counts_as_contact and coalesce(r.result, '') <> 'لم يرد'$p$, 'count', null, null, 'count', 'up',
 'تواصل نتيجته غير «لم يرد».', 'عدد', 'occurred_at', 'client_activities', null, null, 195),
('REACH_RATE', 'نسبة الوصول', 'Reach Rate', 'activity', 'events',
 $p$r.event_type = 'activity' and r.counts_as_contact$p$, 'ratio', 'REACHED', 'TOTAL_ACTIVITIES', 'pct', 'up',
 'من كل تواصل، كم وصل فعلاً.', 'REACHED ÷ TOTAL_ACTIVITIES × ١٠٠', 'occurred_at', 'client_activities', null, null, 198),
('TASKS_COMPLETED', 'مهامّ منجزة', 'Tasks Completed', 'activity', 'events',
 $p$r.event_type = 'task_completed'$p$, 'count', null, null, 'count', 'up',
 'مهامّ صارت «منجزة» في المدة.', 'عدد', 'completed_at', 'tasks', null, null, 199),

-- ===== المراحل (أحداث) =====
('STAGE_CHANGES', 'تغييرات مراحل', 'Stage Changes', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and r.event_subtype <> 'initial'$p$, 'count', null, null, 'count', null,
 'كل انتقال مرحلة عدا دخول المرحلة الأولى.', 'عدد', 'تاريخ الانتقال', 'opportunity_stage_history', null, null, 200),
('STAGE_PROGRESSIONS', 'تقدّم مرحلة', 'Stage Progressions', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and r.event_subtype = 'progression'$p$, 'count', null, null, 'count', 'up',
 'انتقال إلى مرحلة مفتوحة أعلى.', 'عدد', 'تاريخ الانتقال', 'opportunity_stage_history', null, null, 210),
('STAGE_REGRESSIONS', 'تراجع مرحلة', 'Stage Regressions', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and r.event_subtype = 'regression'$p$, 'count', null, null, 'count', 'down',
 'انتقال إلى مرحلة مفتوحة أدنى.', 'عدد', 'تاريخ الانتقال', 'opportunity_stage_history', null, null, 220),
('REACTIVATED', 'أُعيد فتحها', 'Reactivated', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and r.event_subtype = 'reopened'$p$, 'count', null, null, 'count', null,
 'فرصة مغلقة عادت مفتوحة.', 'عدد', 'تاريخ الانتقال', 'opportunity_stage_history', null, null, 230),
('CONTACTED_STAGE_ENTERED', 'دخلوا «اتصال»', 'Entered Contacted', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and gs.report_milestone = 'contacted'$p$, 'opportunities', null, null, 'count', 'up',
 'فرص دخلت مرحلة معلمها «contacted» في المدة.', 'عدد الفرص المختلفة', 'تاريخ الانتقال',
 'opportunity_stage_history, crm_stages.report_milestone', 'يشمل بذرة 072 (المرحلة الحالية للمُرحَّلين بتاريخها).', null, 240),
('VISIT_STAGE_ENTERED', 'دخلوا «زيارة»', 'Entered Visit', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and gs.report_milestone = 'visit'$p$, 'opportunities', null, null, 'count', 'up',
 'فرص دخلت مرحلة معلمها «visit» في المدة.', 'عدد الفرص المختلفة', 'تاريخ الانتقال',
 'opportunity_stage_history', null, null, 250),
('OFFER_STAGE_ENTERED', 'دخلوا «العرض»', 'Entered Offer', 'pipeline', 'events',
 $p$r.event_type = 'stage_change' and gs.report_milestone = 'offer'$p$, 'opportunities', null, null, 'count', 'up',
 'فرص دخلت مرحلة معلمها «offer» في المدة.', 'عدد الفرص المختلفة', 'تاريخ الانتقال',
 'opportunity_stage_history', null, null, 260),

-- ===== النتائج (أحداث) =====
('WON_DEALS', 'فوز', 'Won Deals', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type = 'won'$p$, 'count', null, null, 'count', 'up',
 'صفقات أُغلقت فوزاً **في المدة** (بتاريخ الإغلاق).',
 'عدد انتقالات إلى مرحلة نوعها won', 'تاريخ الإغلاق', 'opportunity_stage_history',
 '⚠️ crm_kpis.won_count يعدّ فائزة الآن مما أُنشئ في المدة (أساس الإنشاء). هنا أساس الإغلاق افتراضياً، واختيار «حسب تاريخ الإنشاء» يعطي رقم crm_kpis.',
 'crm_kpis.won_count (أساس الإنشاء)', 300),
('LOST_DEALS', 'خسارة', 'Lost Deals', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type = 'lost'$p$, 'count', null, null, 'count', 'down',
 'صفقات أُغلقت خسارةً في المدة.', 'عدد', 'تاريخ الإغلاق', 'opportunity_stage_history', null, 'crm_kpis.lost_count', 310),
('CLOSED_DEALS', 'مغلقة', 'Closed Deals', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type in ('won', 'lost')$p$, 'count', null, null, 'count', null,
 'فوز + خسارة.', 'عدد', 'تاريخ الإغلاق', 'opportunity_stage_history', null, null, 315),
('CONVERSION_RATE', 'معدّل التحويل', 'Conversion Rate', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type in ('won', 'lost')$p$, 'ratio', 'WON_DEALS', 'CLOSED_DEALS', 'pct', 'up',
 'فائزة ÷ (فائزة + خاسرة). المفتوحة خارج المقام — فرصة لم تُحسم ليست خسارة.',
 'WON_DEALS ÷ CLOSED_DEALS × ١٠٠', 'تاريخ الإغلاق', 'opportunity_stage_history', null, 'crm_kpis.conversion_rate', 320),
('REVENUE', 'الإيراد', 'Revenue', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type = 'won'$p$, 'sum:value', null, null, 'money', 'up',
 '**عمولة تلال** من الصفقات الفائزة في المدة — لا ثمن الوحدة (056).',
 'Σ قيمة الفوز', 'تاريخ الإغلاق', 'opportunities.won_value',
 'قيمة الفوز تتبع الأصل: تُحسب العمولة بعد الإغلاق فيتحدّث الرقم.', 'crm_kpis.won_value', 330),
('AVG_DEAL_VALUE', 'متوسط الصفقة', 'Average Deal Value', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type = 'won' and r.value is not null$p$, 'avg:value', null, null, 'money', 'up',
 'متوسط الإيراد للصفقة الفائزة (الصفقة بلا قيمة خارج المتوسط).', 'متوسط قيمة الفوز', 'تاريخ الإغلاق',
 'opportunities.won_value', null, 'crm_kpis.avg_deal_value', 340),
('AVG_SALES_CYCLE', 'دورة البيع', 'Average Sales Cycle', 'outcome', 'events',
 $p$r.event_type = 'stage_change' and r.to_stage_type = 'won'$p$, 'avg:cycle_days', null, null, 'days', 'down',
 'أيام من إنشاء الفرصة إلى فوزها.', 'متوسط (الإغلاق − الإنشاء)', 'تاريخ الإغلاق', 'opportunities', null,
 'crm_kpis.avg_sales_cycle', 350),
('RESERVATIONS', 'حجوزات', 'Reservations', 'outcome', 'events',
 $p$r.event_type = 'reservation'$p$, 'count', null, null, 'count', 'up',
 'حجوزات أُنشئت في المدة.', 'عدد', 'تاريخ إنشاء الحجز', 'reservations', null, null, 360),
('RESERVATION_VALUE', 'مبالغ الحجز', 'Reservation Amount', 'outcome', 'events',
 $p$r.event_type = 'reservation'$p$, 'sum:value', null, null, 'money', 'up',
 'مجموع مبالغ الحجز المدفوعة.', 'Σ amount', 'تاريخ الحجز', 'reservations', null, null, 365),
('SALES_COMPLETED', 'بيع مكتمل', 'Sales Completed', 'outcome', 'events',
 $p$r.event_type = 'sale_completed'$p$, 'count', null, null, 'count', 'up',
 'حجوزات صارت «بيع مكتمل» (قُبل طلب البيع).', 'عدد', 'sale_decided_at', 'reservations', null, null, 370),
('SALES_VALUE', 'قيمة المبيعات (ثمن الوحدات)', 'Sales Value (unit price)', 'outcome', 'events',
 $p$r.event_type = 'sale_completed'$p$, 'sum:value', null, null, 'money', null,
 '⚠️ ثمن الوحدات المباعة — **ليس إيراداً**. تلال وسيط (056)؛ الإيراد REVENUE.', 'Σ sale_price',
 'sale_decided_at', 'reservations.sale_price', null, null, 375),
('RESERVATIONS_CANCELLED', 'حجوزات أُلغيت', 'Reservations Cancelled', 'outcome', 'events',
 $p$r.event_type = 'reservation_cancelled'$p$, 'count', null, null, 'count', 'down',
 'حجوزات خرجت من «حجز» إلى غير البيع.', 'عدد', 'لحظة الإلغاء', 'reservations', null, null, 380),

-- ===== الحالة (لقطة أو الآن) =====
('TOTAL_LEADS', 'ليدات (إجمالي)', 'Total Leads', 'state', 'state',
 $p$r.is_primary$p$, 'count', null, null, 'count', null,
 'كل العملاء الموجودين في لحظة الصورة.', 'عدد العملاء', 'تاريخ اللقطة', 'clients', null, null, 500),
('OPEN_LEADS', 'ليدات مفتوحة', 'Open Leads', 'state', 'state',
 $p$r.is_primary and r.lead_open$p$, 'count', null, null, 'count', null,
 'عملاء لهم فرصة مفتوحة واحدة على الأقل (أو بلا فرصة).', 'عدد العملاء', 'تاريخ اللقطة', 'clients, opportunities', null, null, 510),
('QUALIFIED_NOW', 'مؤهَّلون (في اللحظة)', 'Qualified (at snapshot)', 'state', 'state',
 $p$r.is_primary and r.lead_open and r.is_qualified$p$, 'count', null, null, 'count', 'up',
 'ليدات مفتوحة مؤهَّلة في لحظة الصورة. غير QUALIFIED_LEADS (من تأهّل في المدة).', 'عدد', 'تاريخ اللقطة',
 'clients.qualified_at', null, null, 515),
('OPEN_OPPORTUNITIES', 'فرص مفتوحة', 'Open Opportunities', 'state', 'state',
 $p$r.opportunity_id is not null and r.stage_type = 'open'$p$, 'count', null, null, 'count', null,
 'فرص مرحلتها مفتوحة في لحظة الصورة.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, 'crm_kpis.open_count', 520),
('AT_LEAD', 'في «ليد»', 'At Lead', 'state', 'state',
 $p$r.stage_type = 'open' and r.milestone = 'lead'$p$, 'count', null, null, 'count', null,
 'فرص في مرحلة معلمها lead.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 530),
('AT_CONTACTED', 'في «اتصال»', 'At Contacted', 'state', 'state',
 $p$r.stage_type = 'open' and r.milestone = 'contacted'$p$, 'count', null, null, 'count', null,
 'فرص في مرحلة معلمها contacted.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 531),
('AT_VISIT', 'في «زيارة»', 'At Visit', 'state', 'state',
 $p$r.stage_type = 'open' and r.milestone = 'visit'$p$, 'count', null, null, 'count', null,
 'فرص في مرحلة معلمها visit.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 532),
('AT_OFFER', 'في «العرض»', 'At Offer', 'state', 'state',
 $p$r.stage_type = 'open' and r.milestone = 'offer'$p$, 'count', null, null, 'count', null,
 'فرص في مرحلة معلمها offer.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 533),
('ACTIVE_RESERVATIONS', 'حجوزات قائمة', 'Active Reservations', 'state', 'state',
 $p$r.has_active_reservation$p$, 'clients', null, null, 'count', 'up',
 'عملاء عليهم حجز قائم (لم يُبَع ولم يُلغَ) في لحظة الصورة.', 'عدد العملاء', 'تاريخ اللقطة', 'reservations', null, null, 535),
('WON_TOTAL', 'فائزة (تراكمي)', 'Won (cumulative)', 'state', 'state',
 $p$r.stage_type = 'won'$p$, 'count', null, null, 'count', 'up',
 'كل الفرص الفائزة حتى لحظة الصورة.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 540),
('LOST_TOTAL', 'خاسرة (تراكمي)', 'Lost (cumulative)', 'state', 'state',
 $p$r.stage_type = 'lost'$p$, 'count', null, null, 'count', null,
 'كل الفرص الخاسرة حتى لحظة الصورة.', 'عدد', 'تاريخ اللقطة', 'opportunities', null, null, 541),
('PIPELINE_VALUE', 'الأنابيب', 'Pipeline Value', 'state', 'state',
 $p$r.stage_type = 'open'$p$, 'sum:expected_value', null, null, 'money', 'up',
 'Σ القيمة المتوقّعة للفرص المفتوحة في لحظة الصورة.', 'Σ expected_value', 'تاريخ اللقطة',
 'opportunities', 'القيمة من لحظة التشغيل لا تاريخ لها.', 'crm_kpis.pipeline_value', 550),
('WEIGHTED_PIPELINE', 'الأنابيب الموزونة', 'Weighted Pipeline', 'state', 'state',
 $p$r.stage_type = 'open'$p$, 'sum:weighted_value', null, null, 'money', 'up',
 'Σ القيمة × الاحتمال ÷ ١٠٠ للمفتوحة.', 'Σ expected_value × probability ÷ 100', 'تاريخ اللقطة',
 'opportunities, crm_stages', null, 'crm_kpis.weighted_pipeline', 560),
('DUE_TODAY', 'متابعة اليوم', 'Due Today', 'followup', 'state',
 $p$r.due_today$p$, 'count', null, null, 'count', null,
 'مفتوحة موعد خطوتها القادمة يوم الصورة.', 'عدد', 'تاريخ اللقطة',
 'opportunities.next_action_date، وإلا clients.follow_up_date', null, null, 600),
('OVERDUE', 'متأخرة', 'Overdue', 'followup', 'state',
 $p$r.is_overdue$p$, 'count', null, null, 'count', 'down',
 'مفتوحة موعدها قبل يوم الصورة.', 'عدد', 'تاريخ اللقطة', 'opportunities, clients',
 'أوسع قليلاً من crm_kpis.overdue_count: من لا موعد لفرصته يُقرأ موعد العميل (028).', 'crm_kpis.overdue_count', 610),
('NO_NEXT_ACTION', 'بلا خطوة قادمة', 'Without Next Action', 'followup', 'state',
 $p$r.stage_type = 'open' and not r.has_next_action$p$, 'count', null, null, 'count', 'down',
 'مفتوحة بلا موعد.', 'عدد', 'تاريخ اللقطة', 'opportunities, clients', null, null, 620),
('NO_CONTACT', 'لم يُتواصل معهم قطّ', 'Never Contacted', 'followup', 'state',
 $p$r.is_primary and r.lead_open and r.no_contact_ever$p$, 'count', null, null, 'count', 'down',
 'ليدات مفتوحة بلا أي تواصل حتى لحظة الصورة.', 'عدد', 'تاريخ اللقطة', 'client_activities', null, null, 630),
('NEGLECTED', 'مهملة', 'Neglected', 'followup', 'state',
 $p$r.stage_type = 'open' and r.is_neglected$p$, 'count', null, null, 'count', 'down',
 'مفتوحة صامتة أطول من neglected_days.', 'عدد', 'تاريخ اللقطة', 'client_activities',
 'أيام بغداد التقويمية منذ آخر **تواصل**. crm_kpis.neglected_count يعدّ فترات ٢٤ ساعة منذ آخر **نشاط على الفرصة** (يشمل الملاحظة ونقل المرحلة) — فيفترقان بعميل أو اثنين (٦٧ مقابل ٦٩ يوم ٢٠٢٦-٠٩-٢٧).',
 'crm_kpis.neglected_count', 640),
('DORMANT', 'خاملة', 'Dormant', 'followup', 'state',
 $p$r.stage_type = 'open' and r.is_dormant$p$, 'count', null, null, 'count', 'down',
 'مفتوحة صامتة أطول من dormant_days.', 'عدد', 'تاريخ اللقطة', 'client_activities', null, null, 650),
('SLA_BREACH_OPEN', 'خروق خدمة قائمة', 'Open SLA Breaches', 'followup', 'state',
 $p$r.is_primary and r.sla_breach_open$p$, 'count', null, null, 'count', 'down',
 'عملاء عليهم خرق مستوى خدمة لم يُغلق في لحظة الصورة.', 'عدد', 'تاريخ اللقطة', 'crm_sla_breaches', null, null, 660),
('UNASSIGNED', 'بلا مالك', 'Unassigned', 'followup', 'state',
 $p$r.is_primary and r.is_unassigned$p$, 'count', null, null, 'count', 'down',
 'ليدات مفتوحة بلا مالك.', 'عدد', 'تاريخ اللقطة', 'clients.owner_id', null, null, 670)
on conflict (code) do update set
  name_ar = excluded.name_ar, name_en = excluded.name_en, category = excluded.category,
  source = excluded.source, predicate = excluded.predicate, agg = excluded.agg,
  numerator = excluded.numerator, denominator = excluded.denominator, unit = excluded.unit,
  good_direction = excluded.good_direction, definition = excluded.definition,
  formula = excluded.formula, date_field = excluded.date_field,
  source_tables = excluded.source_tables, notes = excluded.notes,
  legacy_equivalent = excluded.legacy_equivalent, sort_order = excluded.sort_order,
  updated_at = now();

-- ------------------------------------------------------------
-- 4) أجزاء الاستعلام — الأبعاد والمُرشِّحات في مكان واحد
--
-- المُرشِّحات قيمٌ تُمرَّر معاملاً ($1) لا نصّاً يُلصق: لا حقن ممكن.
-- والأبعاد والمفاتيح من قوائم مغلقة هنا. ما لا ينطبق على مصدرٍ
-- (نوع التواصل على اللقطة) يُتجاهل له ويُذكر في الناتج.
-- ------------------------------------------------------------

-- عمود التاريخ بحسب «الأساس» (§16)
create or replace function public.crm_rq_date_col(p_basis text)
returns text language sql immutable as $
  select case coalesce(p_basis, 'event')
    when 'event'        then 'r.event_date'
    when 'lead_created' then 'r.lead_created_date'
    when 'opp_created'  then 'r.opp_created_date'
  end;
$;

-- تعبير البُعد لمصدر؛ null = لا ينطبق
create or replace function public.crm_rq_dim(p_dim text, p_source text, p_basis text)
returns text language sql immutable as $$
  select case p_source
    when 'events' then case p_dim
      when 'day'           then 'to_char(' || public.crm_rq_date_col(p_basis) || ', ''YYYY-MM-DD'')'
      when 'week'          then 'to_char(public.crm_week_start(' || public.crm_rq_date_col(p_basis) || '), ''YYYY-MM-DD'')'
      when 'month'         then 'to_char(date_trunc(''month'', ' || public.crm_rq_date_col(p_basis) || '), ''YYYY-MM'')'
      when 'employee'      then 'r.employee_id::text'
      when 'owner'         then 'r.owner_id::text'
      when 'team'          then 'r.team_id::text'
      when 'project'       then 'r.project_id::text'
      when 'source'        then 'r.source_id_dim::text'
      when 'campaign'      then 'r.campaign_id::text'
      when 'stage'         then 'r.to_stage_id::text'
      when 'stage_from'    then 'r.from_stage_id::text'
      when 'activity_type' then 'r.activity_type'
      when 'result'        then 'r.result'
      when 'direction'     then 'r.direction'
      when 'event_type'    then 'r.event_type'
      when 'lost_reason'   then 'r.lost_reason_id::text'
      when 'temperature'   then 'cl.lead_temperature'
      when 'payment_method' then 'cl.payment_method'
      when 'purpose'       then 'cl.purchase_purpose'
      when 'area'          then 'cl.area'
    end
    when 'state' then case p_dim
      when 'day'           then 'to_char(r.snapshot_date, ''YYYY-MM-DD'')'
      when 'week'          then 'to_char(public.crm_week_start(r.snapshot_date), ''YYYY-MM-DD'')'
      when 'month'         then 'to_char(date_trunc(''month'', r.snapshot_date), ''YYYY-MM'')'
      when 'employee'      then 'r.owner_id::text'
      when 'owner'         then 'r.owner_id::text'
      when 'team'          then 'r.team_id::text'
      when 'project'       then 'r.project_id::text'
      when 'source'        then 'r.source_id::text'
      when 'campaign'      then 'r.campaign_id::text'
      when 'stage'         then 'r.stage_id::text'
      when 'lost_reason'   then 'r.lost_reason_id::text'
      when 'temperature'   then 'r.temperature'
      when 'score_band'    then 'r.score_band'
      when 'payment_method' then 'r.payment_method'
      when 'purpose'       then 'r.purchase_purpose'
      when 'area'          then 'r.area'
      when 'silence_bucket' then 'r.silence_bucket'
    end
  end;
$$;

-- المُرشِّحات: شروط تقرأ قيمها من $1 (jsonb). المفاتيح المقبولة وحدها.
create or replace function public.crm_rq_where(p_filters jsonb, p_source text)
returns text language plpgsql immutable as $$
declare
  k text; col text; w text := '';
  -- مفتاح ← عمود للأحداث | عمود للحالة | نوع
  map jsonb := '{
    "project":        ["r.project_id",      "r.project_id",      "uuid"],
    "employee":       ["r.employee_id",     "r.owner_id",        "uuid"],
    "owner":          ["r.owner_id",        "r.owner_id",        "uuid"],
    "team":           ["r.team_id",         "r.team_id",         "uuid"],
    "source":         ["r.source_id_dim",   "r.source_id",       "uuid"],
    "campaign":       ["r.campaign_id",     "r.campaign_id",     "uuid"],
    "stage":          ["r.to_stage_id",     "r.stage_id",        "uuid"],
    "stage_type":     ["r.to_stage_type",   "r.stage_type",      "text"],
    "unit":           ["r.unit_id",         "r.unit_id",         "uuid"],
    "lost_reason":    ["r.lost_reason_id",  "r.lost_reason_id",  "uuid"],
    "activity_type":  ["r.activity_type",   null,                "text"],
    "result":         ["r.result",          null,                "text"],
    "direction":      ["r.direction",       null,                "text"],
    "event_type":     ["r.event_type",      null,                "text"],
    "reservation_status": ["case when r.event_type = ''reservation'' then r.event_subtype end", null, "text"],
    "temperature":    ["cl.lead_temperature", "r.temperature",   "text"],
    "score_band":     [null,                "r.score_band",      "text"],
    "payment_method": ["cl.payment_method", "r.payment_method",  "text"],
    "purpose":        ["cl.purchase_purpose", "r.purchase_purpose", "text"],
    "area":           ["cl.area",           "r.area",            "text"],
    "silence_bucket": [null,                "r.silence_bucket",  "text"]
  }'::jsonb;
begin
  if p_filters is null then return ''; end if;

  for k in select jsonb_object_keys(p_filters) loop
    continue when jsonb_typeof(p_filters -> k) <> 'array' or jsonb_array_length(p_filters -> k) = 0;

    if map ? k then
      col := map -> k ->> (case when p_source = 'events' then 0 else 1 end);
      continue when col is null;   -- لا ينطبق على هذا المصدر
      -- «__none__» في القائمة = «بلا قيمة» (مثل: بلا مشروع)
      w := w || format(
        ' and (%1$s::text in (select jsonb_array_elements_text($1->%2$L))'
        || ' or ((($1->%2$L) ? ''__none__'') and %1$s is null))', col, k);
    elsif k in ('building', 'floor') then
      -- المبنى والطابق من مسار الوحدة: «B3 / G.FLOOR»
      w := w || format(
        ' and r.unit_id in (select u.id from public.units u'
        || ' where btrim(split_part(u.node_path, ''/'', %s)) in (select jsonb_array_elements_text($1->%L)))',
        case k when 'building' then 1 else 2 end, k);
    end if;
  end loop;

  -- مدى الدرجة (للحالة؛ وللأحداث من العميل)
  if p_filters ? 'score_min' then
    w := w || format(' and %s >= ($1->>''score_min'')::int',
                     case when p_source = 'events' then 'cl.lead_score' else 'r.lead_score' end);
  end if;
  if p_filters ? 'score_max' then
    w := w || format(' and %s <= ($1->>''score_max'')::int',
                     case when p_source = 'events' then 'cl.lead_score' else 'r.lead_score' end);
  end if;
  return w;
end $$;

-- مصدر الصفوف: الأحداث أو اللقطات أو الآن
create or replace function public.crm_rq_from(p_source text, p_state text, p_timed boolean, p_bucket text)
returns text language sql immutable as $$
  select case
    when p_source = 'events' then
      'public.crm_event_facts r'
      || ' left join public.crm_stages gs on gs.id = r.to_stage_id'
      || ' left join public.clients cl on cl.id = r.client_id'
      || ' where not r.is_void'
      || ' and ' || '%DATECOL%' || ' between $2 and $3'
    when p_state = 'current' then
      '(select public.baghdad_today() as snapshot_date, s.* from public.crm_state_as_of(null) s) r where true'
    when p_state = 'run' then
      'public.crm_snapshot_rows r where r.run_id = $5'
    when p_timed then
      -- لقطة لكل يوم في المدى؛ وفي الأسبوع/الشهر: آخر لقطة في كل فترة (إقفالها)
      'public.v_crm_snapshot_current r where r.snapshot_date between $2 and $3'
      || case p_bucket
           when 'week' then ' and r.snapshot_date = (select max(x.snapshot_date) from public.crm_snapshot_runs x'
                            || ' where x.is_current and x.snapshot_date between $2 and $3'
                            || ' and public.crm_week_start(x.snapshot_date) = public.crm_week_start(r.snapshot_date))'
           when 'month' then ' and r.snapshot_date = (select max(x.snapshot_date) from public.crm_snapshot_runs x'
                            || ' where x.is_current and x.snapshot_date between $2 and $3'
                            || ' and date_trunc(''month'', x.snapshot_date) = date_trunc(''month'', r.snapshot_date))'
           else '' end
    else
      -- بلا تجزئة زمنية: لقطة يومٍ واحد — المحدَّد، وإلا آخر لقطة ≤ نهاية المدى (إقفال المدة)
      'public.v_crm_snapshot_current r where r.snapshot_date = coalesce($4,'
      || ' (select max(x.snapshot_date) from public.crm_snapshot_runs x where x.is_current and x.snapshot_date <= $3))'
  end;
$$;

-- تعبير التجميع لمقياس
create or replace function public.crm_rq_agg(p_agg text, p_pred text)
returns text language plpgsql immutable as $$
declare col text;
begin
  if p_agg = 'count' then
    return format('count(*) filter (where %s)', p_pred);
  elsif p_agg = 'clients' then
    return format('count(distinct r.client_id) filter (where %s)', p_pred);
  elsif p_agg = 'opportunities' then
    return format('count(distinct r.opportunity_id) filter (where %s)', p_pred);
  elsif p_agg like 'sum:%' then
    col := substr(p_agg, 5);
    return format('round(coalesce(sum(r.%I) filter (where %s), 0), 2)', col, p_pred);
  elsif p_agg like 'avg:%' then
    col := substr(p_agg, 5);
    return format('round(avg(r.%I) filter (where %s), 2)', col, p_pred);
  end if;
  raise exception 'تجميع غير معروف: %', p_agg;
end $$;

-- ------------------------------------------------------------
-- 5) المحرّك
--
--   p_metrics   رموز من crm_metrics (يُخلط الحدثي والحالي)
--   p_group_by  أبعاد: day week month employee owner team project source
--               campaign stage stage_from activity_type result direction
--               event_type lost_reason temperature score_band
--               payment_method purpose area silence_bucket
--   p_from/p_to المدى (تاريخ بغداد)
--   p_filters   {"project":[…], "employee":[…], …} — قوائم متعدّدة الاختيار
--   p_basis     event | lead_created | opp_created (للأحداث)
--   p_state     snapshot | current | run (للحالة)
--
-- الناتج: صفٌّ لكل تركيبة أبعاد — المفاتيح (jsonb) والمقاييس (jsonb).
-- ------------------------------------------------------------
create or replace function public.crm_report_query(
  p_metrics       text[],
  p_group_by      text[]  default '{}',
  p_from          date    default null,
  p_to            date    default null,
  p_filters       jsonb   default '{}'::jsonb,
  p_basis         text    default 'event',
  p_state         text    default 'snapshot',
  p_snapshot_date date    default null,
  p_run_id        uuid    default null,
  p_limit         int     default 5000
) returns table (dims jsonb, metrics jsonb)
language plpgsql stable set search_path = public as $$
declare
  f date := coalesce(p_from, public.baghdad_today() - 29);
  t date := coalesce(p_to, public.baghdad_today());
  m record; src text; g text; e text; key_sql text; agg_sql text; sql text; any_pred text;
  parts text[] := '{}'; bucket text; timed boolean; state_mode text;
  ev_metrics text[] := '{}'; st_metrics text[] := '{}'; ratio_sql text := '';
  needed text[];
begin
  if p_basis not in ('event', 'lead_created', 'opp_created') then
    raise exception 'أساس تاريخ غير معروف: %', p_basis;
  end if;
  if p_state not in ('snapshot', 'current', 'run') then
    raise exception 'مصدر حالة غير معروف: %', p_state;
  end if;
  if t < f then raise exception 'نهاية المدى قبل بدايته'; end if;
  if t - f > 1100 then raise exception 'المدى أطول من ثلاث سنوات — جزّئه'; end if;

  if (select count(*) from unnest(p_metrics) x
       where not exists (select 1 from public.crm_metrics mm where mm.code = x)) > 0 then
    raise exception 'مقياس غير معروف في: %', p_metrics;
  end if;

  -- النسب تحتاج بسطها ومقامها
  select array_agg(distinct x) into needed from (
    select unnest(p_metrics) x
    union select mm.numerator   from public.crm_metrics mm where mm.code = any(p_metrics) and mm.agg = 'ratio'
    union select mm.denominator from public.crm_metrics mm where mm.code = any(p_metrics) and mm.agg = 'ratio'
  ) y where x is not null;

  for m in select * from public.crm_metrics mm where mm.code = any(needed) and mm.is_active loop
    if m.agg = 'ratio' then continue; end if;
    if m.source = 'events' then ev_metrics := ev_metrics || m.code;
    else st_metrics := st_metrics || m.code; end if;
  end loop;

  bucket := (select x from unnest(p_group_by) x where x in ('day', 'week', 'month') limit 1);
  timed  := bucket is not null;
  state_mode := case when p_run_id is not null then 'run' else p_state end;

  foreach src in array array['events', 'state'] loop
    continue when (src = 'events' and cardinality(ev_metrics) = 0)
               or (src = 'state'  and cardinality(st_metrics) = 0);

    -- مفتاح الأبعاد
    key_sql := 'jsonb_build_object(';
    for i in 1 .. coalesce(array_length(p_group_by, 1), 0) loop
      g := p_group_by[i];
      e := public.crm_rq_dim(g, src, p_basis);
      if e is null and public.crm_rq_dim(g, case src when 'events' then 'state' else 'events' end, p_basis) is null then
        raise exception 'بُعد غير معروف: %', g;
      end if;
      key_sql := key_sql || case when i > 1 then ', ' else '' end
                 || quote_literal(g) || ', ' || coalesce(e, 'null::text');
    end loop;
    key_sql := key_sql || ')';

    -- المقاييس
    agg_sql := 'jsonb_build_object(';
    any_pred := 'false';
    for m in select * from public.crm_metrics mm
              where mm.code = any(case src when 'events' then ev_metrics else st_metrics end)
              order by mm.sort_order loop
      agg_sql := agg_sql || case when agg_sql = 'jsonb_build_object(' then '' else ', ' end
                 || quote_literal(m.code) || ', ' || public.crm_rq_agg(m.agg, m.predicate);
      any_pred := any_pred || ' or (' || m.predicate || ')';
    end loop;
    agg_sql := agg_sql || ')';

    -- having: مجموعةٌ لا صفّ فيها يخصّ أيّ مقياس مطلوب لا تُعاد — وإلا
    -- ظهر «موظف: —» بأصفار لأن أحداث إنشاء الليد بلا موظف وقعت في المدة.
    sql := format('select %s as k, %s as m from %s %s group by 1 having bool_or(%s)',
                  key_sql, agg_sql,
                  replace(public.crm_rq_from(src, state_mode, timed, bucket),
                          '%DATECOL%', public.crm_rq_date_col(p_basis)),
                  public.crm_rq_where(p_filters, src), any_pred);
    parts := parts || sql;
  end loop;

  if cardinality(parts) = 0 then return; end if;

  -- دمج المصدرين على مفتاح الأبعاد نفسه
  if cardinality(parts) = 2 then
    sql := format(
      'select coalesce(a.k, b.k) as k, coalesce(a.m, ''{}'') || coalesce(b.m, ''{}'') as m'
      || ' from (%s) a full join (%s) b on a.k = b.k', parts[1], parts[2]);
  else
    sql := parts[1];
  end if;

  -- النسب تُحسب بعد التجميع من بسطها ومقامها (لا متوسط نسب)
  for m in select * from public.crm_metrics mm where mm.code = any(p_metrics) and mm.agg = 'ratio' loop
    ratio_sql := ratio_sql || format(
      ' || jsonb_build_object(%L, case when coalesce((x.m->>%L)::numeric, 0) > 0'
      || ' then round((x.m->>%L)::numeric * 100 / (x.m->>%L)::numeric, 1) else null end)',
      m.code, m.denominator, m.numerator, m.denominator);
  end loop;

  return query execute format(
    'select x.k, x.m %s from (%s) x order by x.k limit %s', ratio_sql, sql, greatest(1, least(p_limit, 20000)))
    using p_filters, f, t, p_snapshot_date, p_run_id;
end $$;

comment on function public.crm_report_query(text[], text[], date, date, jsonb, text, text, date, uuid, int) is
  'محرّك التقارير: مقاييس crm_metrics × أبعاد × مُرشِّحات × مدى. security invoker — RLS تحكم النطاق.';

-- ------------------------------------------------------------
-- 6) النزول إلى الأصل (§38 و §50)
--
-- كل رقم يُنقر: نفس شرط المقياس ونفس المُرشِّحات، ومعها قيم الأبعاد
-- للخلية المنقورة — فتظهر الصفوف التي صنعت الرقم بعينها.
-- النسبة تنزل إلى مقامها (الكل الذي حُسبت منه).
-- ------------------------------------------------------------
create or replace function public.crm_report_drill(
  p_metric        text,
  p_from          date    default null,
  p_to            date    default null,
  p_filters       jsonb   default '{}'::jsonb,
  p_dims          jsonb   default '{}'::jsonb,
  p_basis         text    default 'event',
  p_state         text    default 'snapshot',
  p_snapshot_date date    default null,
  p_limit         int     default 50,
  p_offset        int     default 0
) returns table (total bigint, row_data jsonb)
language plpgsql stable set search_path = public as $$
declare
  f date := coalesce(p_from, public.baghdad_today() - 29);
  t date := coalesce(p_to, public.baghdad_today());
  m record; k text; e text; w text := ''; timed boolean; bucket text; sql text; sel text;
begin
  select * into m from public.crm_metrics where code = p_metric;
  if not found then raise exception 'مقياس غير معروف: %', p_metric; end if;
  if m.agg = 'ratio' then
    select * into m from public.crm_metrics where code = m.denominator;
  end if;
  if p_basis not in ('event', 'lead_created', 'opp_created') then
    raise exception 'أساس تاريخ غير معروف: %', p_basis;
  end if;
  if p_state not in ('snapshot', 'current') then
    raise exception 'مصدر حالة غير معروف: %', p_state;
  end if;

  -- قيم الأبعاد للخلية المنقورة
  for k in select jsonb_object_keys(coalesce(p_dims, '{}'::jsonb)) loop
    e := public.crm_rq_dim(k, m.source, p_basis);
    continue when e is null;
    if jsonb_typeof(p_dims -> k) = 'null' then
      w := w || format(' and %s is null', e);
    else
      w := w || format(' and %s = ($6->>%L)', e, k);
    end if;
  end loop;

  bucket := (select x from jsonb_object_keys(coalesce(p_dims, '{}'::jsonb)) x
              where x in ('day', 'week', 'month') limit 1);
  timed := bucket is not null;

  if m.source = 'events' then
    sel := 'jsonb_build_object('
      || '''event_id'', r.id, ''event_at'', r.event_at, ''event_date'', r.event_date,'
      || '''event_type'', r.event_type, ''event_subtype'', r.event_subtype,'
      || '''client_id'', r.client_id, ''opportunity_id'', r.opportunity_id,'
      || '''client_name'', case when public.should_mask_client_pii() then public.mask_name(cl.name) else cl.name end,'
      || '''employee_id'', r.employee_id, ''owner_id'', r.owner_id, ''project_id'', r.project_id,'
      || '''source_id'', r.source_id_dim, ''campaign_id'', r.campaign_id,'
      || '''activity_type'', r.activity_type, ''direction'', r.direction, ''result'', r.result,'
      || '''from_stage'', r.from_stage, ''to_stage'', r.to_stage, ''value'', r.value,'
      || '''summary'', (select left(a.summary, 200) from public.client_activities a'
      || '              where r.source_table = ''client_activities'' and a.id = r.source_id),'
      || '''is_backfilled'', r.is_backfilled, ''is_synthetic'', r.is_synthetic)';
    sql := format('select count(*) over () as total, %s as row_data from %s %s and (%s) %s'
                  || ' order by r.event_at desc, r.id desc limit %s offset %s',
                  sel,
                  replace(public.crm_rq_from('events', p_state, timed, bucket), '%DATECOL%', public.crm_rq_date_col(p_basis)),
                  public.crm_rq_where(p_filters, 'events'), m.predicate, w,
                  greatest(1, least(p_limit, 1000)), greatest(0, p_offset));
  else
    sel := 'jsonb_build_object('
      || '''snapshot_date'', r.snapshot_date, ''client_id'', r.client_id, ''opportunity_id'', r.opportunity_id,'
      || '''client_name'', case when public.should_mask_client_pii() then public.mask_name(cl.name) else cl.name end,'
      || '''owner_id'', r.owner_id, ''project_id'', r.project_id, ''source_id'', r.source_id,'
      || '''stage_name'', r.stage_name, ''stage_estimated'', r.stage_estimated,'
      || '''expected_value'', r.expected_value, ''weighted_value'', round(r.weighted_value, 0),'
      || '''next_action_date'', r.next_action_date, ''days_silent'', r.days_silent,'
      || '''silence_bucket'', r.silence_bucket, ''temperature'', r.temperature, ''lead_score'', r.lead_score)';
    sql := format('select count(*) over () as total, %s as row_data from %s %s and (%s) %s'
                  || ' order by r.days_silent desc nulls first, r.client_id limit %s offset %s',
                  sel,
                  replace(replace(public.crm_rq_from('state', p_state, timed, bucket),
                                  ' r where', ' r left join public.clients cl on cl.id = r.client_id where'),
                          '%DATECOL%', 'r.snapshot_date'),
                  public.crm_rq_where(p_filters, 'state'), m.predicate, w,
                  greatest(1, least(p_limit, 1000)), greatest(0, p_offset));
  end if;

  return query execute sql using p_filters, f, t, p_snapshot_date, null::uuid, p_dims;
end $$;

-- ------------------------------------------------------------
-- 7) الأمن
--
-- صفوف اللقطات بنطاق **المالك يومها** لا اليوم: من نُقل عنه عميلٌ
-- يبقى يرى صورته التاريخية كما كانت عنده. والمشرف فريقه بمشروعه.
-- ------------------------------------------------------------
alter table public.crm_snapshot_rows enable row level security;
drop policy if exists "read snapshot rows" on public.crm_snapshot_rows;
create policy "read snapshot rows" on public.crm_snapshot_rows
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or owner_id in (select s.id from public.my_scope_employees() s)
    or team_id  in (select s.id from public.my_supervised_projects() s)
  );

alter table public.crm_snapshot_runs enable row level security;
drop policy if exists "read snapshot runs" on public.crm_snapshot_runs;
create policy "read snapshot runs" on public.crm_snapshot_runs
  for select to authenticated using (true);   -- حالة التشغيل ليست سرّاً؛ الأرقام في summary للإدارة (انظر 098)

alter table public.crm_metrics enable row level security;
drop policy if exists "read metrics" on public.crm_metrics;
create policy "read metrics" on public.crm_metrics for select to authenticated using (true);

revoke all on public.crm_snapshot_rows, public.crm_snapshot_runs, public.crm_metrics from anon;
revoke insert, update, delete, truncate on public.crm_snapshot_rows, public.crm_snapshot_runs, public.crm_metrics from authenticated;
grant select on public.crm_snapshot_rows, public.crm_metrics, public.v_crm_snapshot_current to authenticated;
-- summary يحمل أرقام الشركة: لا يُقرأ مباشرةً — عبر crm_snapshot_status (098).
-- ⚠️ صلاحيات Supabase الافتراضية تمنح authenticated كل الأعمدة؛ تُسحب ثم تُمنح بالعمود.
revoke select on public.crm_snapshot_runs from authenticated;
grant select (id, snapshot_date, as_of, timezone, trigger_kind, method, status, requested_by_name,
              reason, attempt, started_at, finished_at, duration_ms, records_processed,
              records_created, warning_count, error_stage, is_current, supersedes, superseded_by,
              engine_version, created_at)
  on public.crm_snapshot_runs to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'crm_state_as_of(timestamptz)',
    'crm_report_query(text[], text[], date, date, jsonb, text, text, date, uuid, int)',
    'crm_report_drill(text, date, date, jsonb, jsonb, text, text, date, int, int)',
    'crm_rq_dim(text, text, text)', 'crm_rq_date_col(text)', 'crm_rq_where(jsonb, text)',
    'crm_rq_from(text, text, boolean, text)', 'crm_rq_agg(text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8) التحقّق — تعريفٌ جديد يطابق القديم حيث يجب
-- ------------------------------------------------------------
do $$
declare n_state int; n_clients int; k record; q jsonb;
begin
  raise notice '--- 097 الحالة والمقاييس والمحرّك ---';
  select count(*) filter (where is_primary), count(*) into n_clients, n_state from public.crm_state_as_of(null);
  raise notice 'الحالة الآن: % عميلاً في % صفّاً', n_clients, n_state;
  raise notice 'العملاء غير المحذوفين: %', (select count(*) from public.clients where deleted_at is null);

  select * into k from public.crm_kpis();
  select metrics into q from public.crm_report_query(
    array['OPEN_OPPORTUNITIES', 'PIPELINE_VALUE', 'WEIGHTED_PIPELINE'], '{}', null, null, '{}', 'event', 'current');
  raise notice 'فرص مفتوحة: القديم % · الجديد %', k.open_count, q->>'OPEN_OPPORTUNITIES';
  raise notice 'الأنابيب: القديم % · الجديد %', k.pipeline_value, q->>'PIPELINE_VALUE';
  raise notice 'الموزونة: القديم % · الجديد %', k.weighted_pipeline, q->>'WEIGHTED_PIPELINE';
end $$;

notify pgrst, 'reload schema';
