-- ============================================================
-- تلال ERP — 096: محرّك التقارير (١/٤) — طبقة الأحداث
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- كل تقرير اليوم يُحسب من «الحالة الراهنة»: crm_kpis تعدّ الفرص
-- الفائزة **الآن** بين ما أُنشئ في المدة، وتنسب التواصل إلى **مالك
-- العميل الآن**. فمكالمةٌ أجراها أحمد في ٢٠ سبتمبر، ثم نُقل العميل
-- إلى علي، تظهر غداً في أداء علي. وتقرير ٢٠ سبتمبر يتغيّر كلما
-- تغيّر شيء بعده.
--
-- ============================================================
-- الحلّ: الحدث صفٌّ يُكتب لحظة وقوعه، بأبعاده لحظة وقوعه
--
--     crm_event_facts — صفّ لكل ما حدث:
--        تواصل · ليد جديد · تأهيل · إسناد · فرصة جديدة · تغيير مرحلة
--        (تقدّم/تراجع/فوز/خسارة/إعادة فتح) · حجز · بيع مكتمل · إلغاء
--        حجز · مهمّة منجزة · ليد مُعاد من وسيط
--
-- والأبعاد (الموظف، المالك، الفريق، المشروع، المصدر، الحملة) تُجمَّد
-- عند الكتابة. نقل العميل غداً لا يُعيد نسبة مكالمة الأمس.
--
-- ===== من يكتب الجدول =====
--
-- محفّزات على الجداول الأصلية — لا الواجهة. ولكل مصدر دالة مزامنة
-- واحدة يستعملها المحفّز والتعبئة الأولى معاً، فلا طريقان يفترقان.
--
-- ⚠️ المحفّز **لا يُسقط الكتابة الأصلية أبداً**. فشلُ كتابة الحدث
--    يُسجَّل في crm_fact_errors وتمضي المكالمة. مكالمةٌ ضاعت من
--    التقرير تُصلَح بإعادة المزامنة؛ مكالمةٌ رُفضت أمام الموظف لا.
--
-- ===== المسؤول عن الحدث (employee_id) — لكل نوع تعريفه =====
--
--     تواصل           من أجراه (created_by) — وإلا مالك العميل وقتها
--     ليد / تأهيل     مالك العميل وقتها
--     إسناد           المالك الجديد
--     فرصة / مرحلة    مالك الفرصة وقتها — الفوز يُنسب لصاحب الصفقة
--                     لا لمن ضغط الزرّ
--     حجز / بيع       مالك الفرصة، وإلا مالك العميل
--     مهمّة           المُسنَدة إليه
--
-- ===== ما يُجمَّد وما لا يُجمَّد =====
--
--     يُجمَّد: الوقت، الموظف، المالك، الفريق، المشروع، المصدر، الحملة،
--              المرحلة من/إلى، القيمة المتوقّعة عند الحدث.
--     يتبع الأصل: نوع التواصل ونتيجته إن صُحِّحا، وقيمة الفوز (تُحسب
--              العمولة بعد الإغلاق — sql/069)، وسبب الخسارة، ومعرّف
--              العميل عند الدمج (sql/077).
--     الحذف الناعم للعميل أو الفرصة لا يمحو الحدث — يُعلَّمه باطلاً
--              (is_void)، فيتّسق مع تعريف «الليد = عميل غير محذوف».
--
-- ===== التاريخ =====
--
-- event_date = تاريخ الحدث **بتوقيت بغداد** يُحسب عند الكتابة. لا
-- تقرير يستعمل ::date على timestamptz (يعطي تاريخ UTC — مكالمة
-- الساعة ٢:٠٠ فجراً بغداد تسقط في اليوم السابق).
--
-- يتطلب: 070–095. آمن لإعادة التشغيل.
-- ============================================================

-- ⚠️ القفل: المحفّزات والتعبئة تمسك الجداول الأصلية. انتظارٌ أطول من
--    ٥ ثوانٍ يعني أن أحداً يكتب الآن — الأفضل الفشل والإعادة من تعطيله.
set local lock_timeout = '5s';

-- ------------------------------------------------------------
-- 0) أدوات
-- ------------------------------------------------------------

-- تاريخ بغداد للحظة. العراق بلا توقيت صيفي منذ ٢٠٠٨، لكن الاسم لا
-- الإزاحة: إن عاد التوقيت الصيفي يوماً لا يُعاد كتابة سطر.
create or replace function public.crm_bgd_date(p_ts timestamptz)
returns date language sql stable set search_path = public as $$
  select (p_ts at time zone 'Asia/Baghdad')::date;
$$;

-- نهاية يوم بغداد (اللحظة الأخيرة فيه) — حدّ «كما كان في نهاية اليوم»
create or replace function public.crm_bgd_day_end(p_day date)
returns timestamptz language sql stable set search_path = public as $$
  select ((p_day + 1)::timestamp at time zone 'Asia/Baghdad') - interval '1 microsecond';
$$;

-- بداية الأسبوع — السبت افتراضياً (أسبوع العمل العراقي)، والإعداد
-- week_start_dow يغيّره (٠ = الأحد … ٦ = السبت). الواجهة تقرأ نفس
-- الإعداد، فلا يختلف «هذا الأسبوع» بين الشاشة والقاعدة.
create or replace function public.crm_week_start(p_day date)
returns date language sql stable set search_path = public as $$
  select p_day - ((extract(dow from p_day)::int
                   - public.crm_setting_int('week_start_dow', 6) + 7) % 7);
$$;

insert into public.crm_settings (key, value, label, description, unit, min_value, max_value)
values ('week_start_dow', to_jsonb(6), 'أول أيام الأسبوع في التقارير',
        '٠ الأحد · ١ الاثنين · … · ٦ السبت. يحكم «هذا الأسبوع» والتجميع الأسبوعي.', 'يوم', 0, 6)
on conflict (key) do nothing;

-- موظف الحساب — بلا الرجوع إلى employees من صلاحية السائل
create or replace function public.crm_emp_of_user(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.user_id = p_user limit 1;
$$;

-- ------------------------------------------------------------
-- 1) المالك «كما كان» — من تاريخ الإسناد (071)
--
--   آخر إسناد قبل اللحظة           ← المالك الجديد فيه
--   وإلا أول إسناد بعدها            ← المالك السابق فيه
--        (بذرة 071 «ترحيل» بلا سابق: لا تعني «بلا مالك» بل «لا نعرف
--         ما قبل التسجيل»، فنأخذ مالكها — أقرب تقدير لا اختراع)
--   وإلا لا تاريخ أصلاً             ← المالك الحالي
-- ------------------------------------------------------------
create or replace function public.crm_owner_as_of(p_client uuid, p_at timestamptz)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select a.to_owner_id into r
    from public.client_assignments a
   where a.client_id = p_client and a.at <= p_at
   order by a.at desc limit 1;
  if found then return r.to_owner_id; end if;

  select a.from_owner_id, a.to_owner_id, a.method into r
    from public.client_assignments a
   where a.client_id = p_client and a.at > p_at
   order by a.at asc limit 1;
  if found then
    return coalesce(r.from_owner_id, case when r.method = 'ترحيل' then r.to_owner_id end);
  end if;

  return (select c.owner_id from public.clients c where c.id = p_client);
end $$;

-- ------------------------------------------------------------
-- 2) الجدول
-- ------------------------------------------------------------
create table if not exists public.crm_event_facts (
  id                bigserial primary key,
  source_table      text        not null,
  source_id         uuid        not null,
  event_type        text        not null,
  event_subtype     text,
  event_at          timestamptz not null,
  event_date        date        not null,           -- بتوقيت بغداد

  client_id         uuid,
  opportunity_id    uuid,
  project_id        uuid,
  unit_id           uuid,
  employee_id       uuid,                           -- المسؤول عن الحدث (انظر الرأس)
  owner_id          uuid,                           -- مالك العميل لحظة الحدث
  team_id           uuid,                           -- مشروع الموظف (037)
  source_id_dim     uuid,                           -- مصدر الليد (crm_sources)
  campaign_id       uuid,

  activity_type     text,
  counts_as_contact boolean     not null default false,
  direction         text,
  result            text,
  duration_min      int,
  next_action_date  date,                           -- ما حدّده الموظف في هذا التواصل (028)

  from_stage_id     uuid,
  to_stage_id       uuid,
  from_stage        text,
  to_stage          text,
  to_stage_type     text,                           -- open | won | lost
  days_in_from      numeric,

  value             numeric,
  cycle_days        numeric,                        -- للفوز والخسارة: من إنشاء الفرصة
  lost_reason_id    uuid,

  lead_created_date date,                           -- لتقارير «حسب تاريخ الإنشاء»
  opp_created_date  date,

  is_void           boolean     not null default false,
  is_backfilled     boolean     not null default false,
  is_synthetic      boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,

  constraint crm_event_facts_type_chk check (event_type in (
    'activity', 'lead_created', 'lead_returned', 'qualified', 'assignment',
    'opportunity_created', 'stage_change', 'reservation', 'sale_completed',
    'reservation_cancelled', 'task_completed')),
  constraint crm_event_facts_source_uk unique (source_table, source_id, event_type)
);

comment on table public.crm_event_facts is
  'حدثٌ لكل ما وقع في الـCRM بأبعاده لحظة وقوعه (096). تكتبه المحفّزات وحدها. '
  'التقارير الحدثية تقرأ من هنا لا من الحالة الراهنة.';
comment on column public.crm_event_facts.source_id_dim is
  'مصدر الليد (crm_sources.id). الاسم بلاحقة كي لا يلتبس بـ source_id معرّف الصفّ الأصلي.';
comment on column public.crm_event_facts.value is
  'الفوز: قيمة الفوز (عمولة تلال، تتبع الأصل). الحجز: مبلغ الحجز. غيرها: القيمة المتوقّعة لحظة الحدث.';

-- لمن طُبِّق عليه الملف قبل إضافة العمود
alter table public.crm_event_facts add column if not exists next_action_date date;

create index if not exists crm_event_facts_date_idx     on public.crm_event_facts (event_date, event_type) where not is_void;
create index if not exists crm_event_facts_client_idx   on public.crm_event_facts (client_id, event_at);
create index if not exists crm_event_facts_opp_idx      on public.crm_event_facts (opportunity_id, event_at) where opportunity_id is not null;
create index if not exists crm_event_facts_emp_idx      on public.crm_event_facts (employee_id, event_date) where not is_void;
create index if not exists crm_event_facts_owner_idx    on public.crm_event_facts (owner_id, event_date) where not is_void;
create index if not exists crm_event_facts_project_idx  on public.crm_event_facts (project_id, event_date) where not is_void;
create index if not exists crm_event_facts_source_idx   on public.crm_event_facts (source_id_dim, event_date) where not is_void;
create index if not exists crm_event_facts_campaign_idx on public.crm_event_facts (campaign_id) where campaign_id is not null;
create index if not exists crm_event_facts_team_idx     on public.crm_event_facts (team_id, event_date) where not is_void;
create index if not exists crm_event_facts_lead_idx     on public.crm_event_facts (lead_created_date) where not is_void;

-- أخطاء الكتابة — تُرى في «عمليات اللقطات» وتُصلَح بإعادة المزامنة
create table if not exists public.crm_fact_errors (
  id           bigserial primary key,
  source_table text not null,
  source_id    uuid,
  op           text,
  sqlstate     text,
  message      text,
  context      text,
  at           timestamptz not null default now(),
  resolved_at  timestamptz
);

-- ------------------------------------------------------------
-- 3) الأبعاد المشتركة لحدثٍ على عميل/فرصة في لحظة
-- ------------------------------------------------------------
create or replace function public.crm_event_dims(p_client uuid, p_opp uuid, p_at timestamptz)
returns table (owner_id uuid, team_id uuid, project_id uuid, unit_id uuid,
               source_id uuid, campaign_id uuid, lead_created_date date,
               opp_created_date date, opp_owner uuid, expected_value numeric,
               opp_created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.clients where id = p_client),
       o as (
         select * from public.opportunities
          where id = coalesce(p_opp,
                  -- بلا فرصة صريحة: فرصة العميل الوحيدة غير المحذوفة (083)
                  (select (array_agg(x.id order by x.created_at desc))[1]
                     from public.opportunities x
                    where x.client_id = p_client and x.deleted_at is null
                   having count(*) = 1))
       ),
       own as (select public.crm_owner_as_of(p_client, p_at) as id)
  select own.id,
         (select e.project_id from public.employees e where e.id = own.id),
         coalesce(o.project_id, c.project_id, c.preferred_project_id),
         o.unit_id,
         coalesce(o.source_id, c.original_source_id),
         coalesce(o.campaign_id, c.campaign_id),
         public.crm_bgd_date(c.created_at),
         public.crm_bgd_date(o.created_at),
         o.owner_id,
         o.expected_value,
         o.created_at
    from c
    cross join own
    left join o on true;
$$;

-- ------------------------------------------------------------
-- 4) دوال المزامنة — واحدة لكل مصدر، للمحفّز والتعبئة معاً
-- ------------------------------------------------------------

-- ——— التواصل ———
create or replace function public.crm_fact_sync_activity(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a record; d record; t record; emp uuid;
begin
  select * into a from public.client_activities where id = p_id;
  if not found or public.is_system_activity(a.activity_type) then
    -- حُذف، أو صار نوعاً نظامياً: «تغيير مرحلة» يأتي من تاريخ المراحل
    -- و«حجز» من الحجوزات — عدّه هنا يضاعفه
    delete from public.crm_event_facts
     where source_table = 'client_activities' and source_id = p_id;
    return;
  end if;

  select * into d from public.crm_event_dims(a.client_id, a.opportunity_id, a.occurred_at);
  select counts_as_contact into t from public.crm_activity_types where name = a.activity_type;
  emp := coalesce(public.crm_emp_of_user(a.created_by), d.owner_id);

  insert into public.crm_event_facts as f
    (source_table, source_id, event_type, event_subtype, event_at, event_date,
     client_id, opportunity_id, project_id, unit_id, employee_id, owner_id, team_id,
     source_id_dim, campaign_id, activity_type, counts_as_contact, direction, result,
     duration_min, next_action_date, value, lead_created_date, opp_created_date, is_backfilled)
  values
    ('client_activities', a.id, 'activity', a.activity_type, a.occurred_at,
     public.crm_bgd_date(a.occurred_at),
     a.client_id, a.opportunity_id, d.project_id, d.unit_id, emp, d.owner_id,
     (select e.project_id from public.employees e where e.id = emp),
     d.source_id, d.campaign_id, a.activity_type, coalesce(t.counts_as_contact, false),
     a.direction, a.outcome, a.duration_min, a.next_action_date, null, d.lead_created_date, d.opp_created_date,
     p_backfill)
  on conflict (source_table, source_id, event_type) do update
    -- ما يُصحَّح في الأصل يتبعه؛ الأبعاد مجمَّدة إلا إن تغيّر العميل (دمج)
    set event_subtype     = excluded.event_subtype,
        event_at          = excluded.event_at,
        event_date        = excluded.event_date,
        activity_type     = excluded.activity_type,
        counts_as_contact = excluded.counts_as_contact,
        direction         = excluded.direction,
        result            = excluded.result,
        duration_min      = excluded.duration_min,
        next_action_date  = excluded.next_action_date,
        opportunity_id    = excluded.opportunity_id,
        client_id         = excluded.client_id,
        project_id  = case when f.client_id is distinct from excluded.client_id then excluded.project_id  else f.project_id end,
        owner_id    = case when f.client_id is distinct from excluded.client_id then excluded.owner_id    else f.owner_id end,
        source_id_dim = case when f.client_id is distinct from excluded.client_id then excluded.source_id_dim else f.source_id_dim end,
        campaign_id = case when f.client_id is distinct from excluded.client_id then excluded.campaign_id else f.campaign_id end,
        lead_created_date = excluded.lead_created_date,
        updated_at  = now();
end $$;

-- ——— تغيير المرحلة (من تاريخ المراحل 072) ———
create or replace function public.crm_fact_sync_stage(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare h record; o record; d record; gf record; gt record; sub text;
begin
  select * into h from public.opportunity_stage_history where id = p_id;
  if not found then return; end if;
  select * into o from public.opportunities where id = h.opportunity_id;
  if not found then return; end if;

  select * into d from public.crm_event_dims(o.client_id, o.id, h.at);
  select * into gt from public.crm_stages where id = h.to_stage_id;
  select * into gf from public.crm_stages where id = h.from_stage_id;

  -- ⚠️ الفوز والخسارة قبل «initial»: بذرة 072 كتبت لكل فرصة مُرحَّلة صفّاً
  --    بلا مرحلة سابقة بمرحلتها الحالية — ومنها ٣٢٤ خسارة و٥ فوز. لو سبق
  --    «initial» لاختفت كلها من عدّ الفوز والخسارة (كشفه أول تشغيل).
  sub := case
           when gt.stage_type = 'won'                             then 'won'
           when gt.stage_type = 'lost'                            then 'lost'
           when h.from_stage_id is null                           then 'initial'
           when gf.stage_type in ('won', 'lost')                  then 'reopened'
           when gt.sort_order > gf.sort_order                     then 'progression'
           when gt.sort_order < gf.sort_order                     then 'regression'
           else 'lateral'
         end;

  insert into public.crm_event_facts as f
    (source_table, source_id, event_type, event_subtype, event_at, event_date,
     client_id, opportunity_id, project_id, unit_id, employee_id, owner_id, team_id,
     source_id_dim, campaign_id, from_stage_id, to_stage_id, from_stage, to_stage,
     to_stage_type, days_in_from, value, cycle_days, lost_reason_id,
     lead_created_date, opp_created_date, is_backfilled, is_void)
  values
    ('opportunity_stage_history', h.id, 'stage_change', sub, h.at, public.crm_bgd_date(h.at),
     o.client_id, o.id, d.project_id, d.unit_id,
     coalesce(o.owner_id, d.owner_id), d.owner_id,
     (select e.project_id from public.employees e where e.id = coalesce(o.owner_id, d.owner_id)),
     d.source_id, d.campaign_id, h.from_stage_id, h.to_stage_id, h.from_stage, h.to_stage,
     gt.stage_type, h.days_in_from,
     case when gt.stage_type = 'won' then o.won_value else o.expected_value end,
     case when gt.stage_type in ('won', 'lost')
          then round((extract(epoch from (h.at - o.created_at)) / 86400.0)::numeric, 2) end,
     case when gt.stage_type = 'lost' then o.lost_reason_id end,
     d.lead_created_date, d.opp_created_date, p_backfill,
     o.deleted_at is not null
       or exists (select 1 from public.clients c where c.id = o.client_id and c.deleted_at is not null))
  on conflict (source_table, source_id, event_type) do update
    set value          = excluded.value,
        lost_reason_id = excluded.lost_reason_id,
        updated_at     = now();
end $$;

-- ——— الليد الجديد + التأهيل + الإعادة من وسيط (من clients) ———
create or replace function public.crm_fact_sync_client(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare c record; d record;
begin
  select * into c from public.clients where id = p_id;
  if not found then return; end if;

  select * into d from public.crm_event_dims(c.id, null, c.created_at);
  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_subtype, event_at, event_date, client_id,
     project_id, employee_id, owner_id, team_id, source_id_dim, campaign_id,
     lead_created_date, is_backfilled, is_void)
  values
    ('clients', c.id, 'lead_created', c.source, c.created_at, public.crm_bgd_date(c.created_at), c.id,
     d.project_id, coalesce(d.owner_id, public.crm_emp_of_user(c.created_by)), d.owner_id,
     (select e.project_id from public.employees e where e.id = d.owner_id),
     d.source_id, d.campaign_id, d.lead_created_date, p_backfill, c.deleted_at is not null)
  on conflict (source_table, source_id, event_type) do update
    set is_void = excluded.is_void, updated_at = now();

  -- التأهيل: لحظة عبور الدرجة عتبتها (079) — تُختم مرة ولا تُمحى
  if c.qualified_at is not null then
    select * into d from public.crm_event_dims(c.id, null, c.qualified_at);
    insert into public.crm_event_facts
      (source_table, source_id, event_type, event_at, event_date, client_id, project_id,
       employee_id, owner_id, team_id, source_id_dim, campaign_id, lead_created_date,
       is_backfilled, is_void)
    values
      ('clients', c.id, 'qualified', c.qualified_at, public.crm_bgd_date(c.qualified_at), c.id,
       d.project_id, d.owner_id, d.owner_id,
       (select e.project_id from public.employees e where e.id = d.owner_id),
       d.source_id, d.campaign_id, d.lead_created_date, p_backfill, c.deleted_at is not null)
    on conflict (source_table, source_id, event_type) do update
      set is_void = excluded.is_void, updated_at = now();
  end if;

  -- الإعادة من الوسيط: آخر إعادة وحدها (مفتاح الحدث هو العميل)
  if c.returned_at is not null then
    select * into d from public.crm_event_dims(c.id, null, c.returned_at);
    insert into public.crm_event_facts as f
      (source_table, source_id, event_type, event_at, event_date, client_id, project_id,
       employee_id, owner_id, team_id, source_id_dim, campaign_id, lead_created_date,
       is_backfilled, is_void)
    values
      ('clients', c.id, 'lead_returned', c.returned_at, public.crm_bgd_date(c.returned_at), c.id,
       d.project_id, d.owner_id, d.owner_id,
       (select e.project_id from public.employees e where e.id = d.owner_id),
       d.source_id, d.campaign_id, d.lead_created_date, p_backfill, c.deleted_at is not null)
    on conflict (source_table, source_id, event_type) do update
      set event_at = excluded.event_at, event_date = excluded.event_date,
          is_void = excluded.is_void, updated_at = now();
  end if;

  -- الحذف الناعم والاسترجاع يُبطلان/يُعيدان كل أحداث العميل
  update public.crm_event_facts
     set is_void = (c.deleted_at is not null), updated_at = now()
   where client_id = c.id and is_void is distinct from (c.deleted_at is not null)
     and (opportunity_id is null
          or opportunity_id not in (select id from public.opportunities where deleted_at is not null));
end $$;

-- ——— الفرصة الجديدة ———
create or replace function public.crm_fact_sync_opportunity(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare o record; d record; client_deleted boolean;
begin
  select * into o from public.opportunities where id = p_id;
  if not found then return; end if;
  select c.deleted_at is not null into client_deleted from public.clients c where c.id = o.client_id;

  select * into d from public.crm_event_dims(o.client_id, o.id, o.created_at);
  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_at, event_date, client_id, opportunity_id,
     project_id, unit_id, employee_id, owner_id, team_id, source_id_dim, campaign_id, value,
     lead_created_date, opp_created_date, is_backfilled, is_void)
  values
    ('opportunities', o.id, 'opportunity_created', o.created_at, public.crm_bgd_date(o.created_at),
     o.client_id, o.id, d.project_id, d.unit_id, coalesce(o.owner_id, d.owner_id), d.owner_id,
     (select e.project_id from public.employees e where e.id = coalesce(o.owner_id, d.owner_id)),
     d.source_id, d.campaign_id, o.expected_value, d.lead_created_date, d.opp_created_date,
     p_backfill, o.deleted_at is not null or coalesce(client_deleted, false))
  on conflict (source_table, source_id, event_type) do update
    set is_void = excluded.is_void, client_id = excluded.client_id, updated_at = now();

  -- ما يتبع الفرصة: الإبطال، والعميل عند الدمج، وقيمة الفوز وسبب الخسارة
  update public.crm_event_facts f
     set is_void   = (o.deleted_at is not null or coalesce(client_deleted, false)),
         client_id = o.client_id,
         value     = case when f.event_type = 'stage_change' and f.to_stage_type = 'won'
                          then o.won_value else f.value end,
         lost_reason_id = case when f.event_type = 'stage_change' and f.to_stage_type = 'lost'
                               then coalesce(o.lost_reason_id, f.lost_reason_id) else f.lost_reason_id end,
         updated_at = now()
   where f.opportunity_id = o.id
     and (f.is_void is distinct from (o.deleted_at is not null or coalesce(client_deleted, false))
          or f.client_id is distinct from o.client_id
          or (f.event_type = 'stage_change' and f.to_stage_type = 'won' and f.value is distinct from o.won_value)
          or (f.event_type = 'stage_change' and f.to_stage_type = 'lost'
              and o.lost_reason_id is not null and f.lost_reason_id is distinct from o.lost_reason_id));

  -- الخاسرة/الفائزة بلا صفّ في تاريخ المراحل (قبل 072): حدثٌ مركَّب من
  -- closed_at يُعلَّم is_synthetic — لا يُترك الفوز بلا تاريخ.
  -- ⚠️ في التعبئة وحدها: الإغلاق الحيّ يكتب تاريخ المراحل بمحفّز قد يعمل
  --    بعد هذا، فلو رُكِّب هنا لصار الفوز الواحد فوزين.
  if p_backfill and o.closed_at is not null and not exists (
       select 1 from public.crm_event_facts x
        where x.opportunity_id = o.id and x.event_type = 'stage_change'
          and x.to_stage_type in ('won', 'lost')) then
    insert into public.crm_event_facts
      (source_table, source_id, event_type, event_subtype, event_at, event_date, client_id,
       opportunity_id, project_id, unit_id, employee_id, owner_id, team_id, source_id_dim,
       campaign_id, to_stage_id, to_stage, to_stage_type, value, cycle_days, lost_reason_id,
       lead_created_date, opp_created_date, is_backfilled, is_synthetic, is_void)
    select 'opportunities', o.id, 'stage_change', g.stage_type, o.closed_at,
           public.crm_bgd_date(o.closed_at), o.client_id, o.id, d.project_id, d.unit_id,
           coalesce(o.owner_id, d.owner_id), d.owner_id,
           (select e.project_id from public.employees e where e.id = coalesce(o.owner_id, d.owner_id)),
           d.source_id, d.campaign_id, g.id, g.name, g.stage_type,
           case when g.stage_type = 'won' then o.won_value else o.expected_value end,
           round((extract(epoch from (o.closed_at - o.created_at)) / 86400.0)::numeric, 2),
           case when g.stage_type = 'lost' then o.lost_reason_id end,
           d.lead_created_date, d.opp_created_date, p_backfill, true,
           o.deleted_at is not null or coalesce(client_deleted, false)
      from public.crm_stages g
     where g.id = o.stage_id and g.stage_type in ('won', 'lost')
    on conflict (source_table, source_id, event_type) do nothing;
  end if;
end $$;

-- ——— الإسناد (071) ———
create or replace function public.crm_fact_sync_assignment(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a record; d record;
begin
  select * into a from public.client_assignments where id = p_id;
  if not found then return; end if;
  select * into d from public.crm_event_dims(a.client_id, null, a.at);

  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_subtype, event_at, event_date, client_id,
     project_id, employee_id, owner_id, team_id, source_id_dim, campaign_id,
     lead_created_date, is_backfilled, is_void)
  values
    ('client_assignments', a.id, 'assignment',
     case when a.from_owner_id is null then 'initial' else 'reassign' end,
     a.at, public.crm_bgd_date(a.at), a.client_id, d.project_id, a.to_owner_id, a.to_owner_id,
     (select e.project_id from public.employees e where e.id = a.to_owner_id),
     d.source_id, d.campaign_id, d.lead_created_date, p_backfill,
     exists (select 1 from public.clients c where c.id = a.client_id and c.deleted_at is not null))
  on conflict (source_table, source_id, event_type) do nothing;
end $$;

-- ——— الحجز والبيع والإلغاء ———
create or replace function public.crm_fact_sync_reservation(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r record; d record; emp uuid; t timestamptz; is_void boolean;
begin
  select * into r from public.reservations where id = p_id;
  if not found then
    delete from public.crm_event_facts where source_table = 'reservations' and source_id = p_id;
    return;
  end if;

  select * into d from public.crm_event_dims(r.client_id, r.opportunity_id, r.created_at);
  emp := coalesce(d.opp_owner, d.owner_id, public.crm_emp_of_user(r.created_by));
  is_void := exists (select 1 from public.clients c where c.id = r.client_id and c.deleted_at is not null);

  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_subtype, event_at, event_date, client_id,
     opportunity_id, project_id, unit_id, employee_id, owner_id, team_id, source_id_dim,
     campaign_id, value, lead_created_date, opp_created_date, is_backfilled, is_void)
  values
    ('reservations', r.id, 'reservation', r.status, r.created_at, public.crm_bgd_date(r.created_at),
     r.client_id, r.opportunity_id,
     coalesce(d.project_id, (select u.project_id from public.units u where u.id = r.unit_id)),
     r.unit_id, emp, d.owner_id, (select e.project_id from public.employees e where e.id = emp),
     d.source_id, d.campaign_id, r.amount, d.lead_created_date, d.opp_created_date,
     p_backfill, is_void)
  on conflict (source_table, source_id, event_type) do update
    set event_subtype = excluded.event_subtype, value = excluded.value,
        is_void = excluded.is_void, updated_at = now();

  if r.status = 'بيع مكتمل' then
    t := coalesce(r.sale_decided_at, r.down_payment_confirmed_at, now());
    insert into public.crm_event_facts
      (source_table, source_id, event_type, event_at, event_date, client_id, opportunity_id,
       project_id, unit_id, employee_id, owner_id, team_id, source_id_dim, campaign_id, value,
       lead_created_date, opp_created_date, is_backfilled, is_void)
    values
      ('reservations', r.id, 'sale_completed', t, public.crm_bgd_date(t), r.client_id, r.opportunity_id,
       coalesce(d.project_id, (select u.project_id from public.units u where u.id = r.unit_id)),
       r.unit_id, emp, d.owner_id, (select e.project_id from public.employees e where e.id = emp),
       d.source_id, d.campaign_id, r.sale_price, d.lead_created_date, d.opp_created_date,
       p_backfill, is_void)
    on conflict (source_table, source_id, event_type) do update
      set value = excluded.value, is_void = excluded.is_void, updated_at = now();
  elsif r.status is not null and r.status not in ('حجز', 'بيع مكتمل') then
    t := now();
    insert into public.crm_event_facts
      (source_table, source_id, event_type, event_subtype, event_at, event_date, client_id,
       opportunity_id, project_id, unit_id, employee_id, owner_id, team_id, source_id_dim,
       campaign_id, value, lead_created_date, opp_created_date, is_backfilled, is_void,
       is_synthetic)
    values
      ('reservations', r.id, 'reservation_cancelled', r.status, t, public.crm_bgd_date(t),
       r.client_id, r.opportunity_id,
       coalesce(d.project_id, (select u.project_id from public.units u where u.id = r.unit_id)),
       r.unit_id, emp, d.owner_id, (select e.project_id from public.employees e where e.id = emp),
       d.source_id, d.campaign_id, r.amount, d.lead_created_date, d.opp_created_date,
       p_backfill, is_void, p_backfill)   -- في التعبئة لا نعرف لحظة الإلغاء
    on conflict (source_table, source_id, event_type) do nothing;
  end if;
end $$;

-- ——— المهمّة المنجزة ———
create or replace function public.crm_fact_sync_task(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare k record; d record; emp uuid; t timestamptz; cid uuid;
begin
  select * into k from public.tasks where id = p_id;
  if not found or k.status is distinct from 'منجزة' then
    delete from public.crm_event_facts
     where source_table = 'tasks' and source_id = p_id and event_type = 'task_completed';
    return;
  end if;

  cid := coalesce(k.client_id, k.related_client);
  t := coalesce(k.completed_at, k.updated_at, now());
  emp := public.crm_emp_of_user(k.assigned_to);
  if cid is not null then
    select * into d from public.crm_event_dims(cid, k.opportunity_id, t);
  end if;

  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_at, event_date, client_id, opportunity_id,
     project_id, employee_id, owner_id, team_id, source_id_dim, campaign_id,
     lead_created_date, is_backfilled)
  values
    ('tasks', k.id, 'task_completed', t, public.crm_bgd_date(t), cid, k.opportunity_id,
     d.project_id, coalesce(emp, d.owner_id), d.owner_id,
     (select e.project_id from public.employees e where e.id = coalesce(emp, d.owner_id)),
     d.source_id, d.campaign_id, d.lead_created_date, p_backfill)
  on conflict (source_table, source_id, event_type) do update
    set event_at = excluded.event_at, event_date = excluded.event_date, updated_at = now();
end $$;

-- ------------------------------------------------------------
-- 5) المحفّزات — وحارس «لا تُسقط الأصل»
-- ------------------------------------------------------------
create or replace function public.crm_fact_log_error(p_table text, p_id uuid, p_op text,
                                                     p_state text, p_msg text, p_ctx text)
returns void language sql security definer set search_path = public as $$
  insert into public.crm_fact_errors (source_table, source_id, op, sqlstate, message, context)
  values (p_table, p_id, p_op, p_state, p_msg, p_ctx);
$$;

create or replace function public.trg_crm_fact()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rid uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  st text; msg text; ctx text;
begin
  begin
    case tg_table_name
      when 'client_activities'         then perform public.crm_fact_sync_activity(rid);
      when 'opportunity_stage_history' then perform public.crm_fact_sync_stage(rid);
      when 'clients'                   then perform public.crm_fact_sync_client(rid);
      when 'opportunities'             then perform public.crm_fact_sync_opportunity(rid);
      when 'client_assignments'        then perform public.crm_fact_sync_assignment(rid);
      when 'reservations'              then perform public.crm_fact_sync_reservation(rid);
      when 'tasks'                     then perform public.crm_fact_sync_task(rid);
    end case;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, ctx = pg_exception_context;
    perform public.crm_fact_log_error(tg_table_name, rid, tg_op, st, msg, ctx);
  end;
  return null;
end $$;

drop trigger if exists trg_crm_fact on public.client_activities;
create trigger trg_crm_fact after insert or update or delete on public.client_activities
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.opportunity_stage_history;
create trigger trg_crm_fact after insert on public.opportunity_stage_history
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.clients;
create trigger trg_crm_fact after insert or update of qualified_at, deleted_at, returned_at on public.clients
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.opportunities;
create trigger trg_crm_fact after insert or update of deleted_at, client_id, won_value, lost_reason_id, closed_at
  on public.opportunities
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.client_assignments;
create trigger trg_crm_fact after insert on public.client_assignments
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.reservations;
create trigger trg_crm_fact after insert or update of status, amount, sale_price or delete on public.reservations
  for each row execute function public.trg_crm_fact();

drop trigger if exists trg_crm_fact on public.tasks;
create trigger trg_crm_fact after insert or update of status, completed_at on public.tasks
  for each row execute function public.trg_crm_fact();

-- ------------------------------------------------------------
-- 6) المطابقة — هل الأحداث تطابق الأصل؟
--
-- تُشغَّل قبل كل لقطة (097). فرقٌ هنا يعني أن محفّزاً فشل أو أُوقف،
-- ويظهر تحذيراً في اللقطة لا رقماً ناقصاً صامتاً.
-- ------------------------------------------------------------
create or replace function public.crm_fact_reconcile()
returns table (source text, source_rows bigint, fact_rows bigint, missing bigint, orphaned bigint)
language sql stable security definer set search_path = public as $$
  with a as (
    select 'client_activities'::text s,
           (select count(*) from public.client_activities x where not public.is_system_activity(x.activity_type)) src,
           (select count(*) from public.crm_event_facts f where f.source_table = 'client_activities') fct,
           (select count(*) from public.client_activities x
             where not public.is_system_activity(x.activity_type)
               and not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'client_activities' and f.source_id = x.id)) miss,
           (select count(*) from public.crm_event_facts f
             where f.source_table = 'client_activities'
               and not exists (select 1 from public.client_activities x where x.id = f.source_id)) orph
    union all
    select 'opportunity_stage_history',
           (select count(*) from public.opportunity_stage_history),
           (select count(*) from public.crm_event_facts f where f.source_table = 'opportunity_stage_history'),
           (select count(*) from public.opportunity_stage_history x
             where not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'opportunity_stage_history' and f.source_id = x.id)),
           0
    union all
    select 'clients',
           (select count(*) from public.clients),
           (select count(*) from public.crm_event_facts f where f.source_table = 'clients' and f.event_type = 'lead_created'),
           (select count(*) from public.clients x
             where not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'clients' and f.event_type = 'lead_created' and f.source_id = x.id)),
           0
    union all
    select 'opportunities',
           (select count(*) from public.opportunities),
           (select count(*) from public.crm_event_facts f where f.source_table = 'opportunities' and f.event_type = 'opportunity_created'),
           (select count(*) from public.opportunities x
             where not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'opportunities' and f.event_type = 'opportunity_created' and f.source_id = x.id)),
           0
    union all
    select 'client_assignments',
           (select count(*) from public.client_assignments),
           (select count(*) from public.crm_event_facts f where f.source_table = 'client_assignments'),
           (select count(*) from public.client_assignments x
             where not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'client_assignments' and f.source_id = x.id)),
           0
    union all
    select 'reservations',
           (select count(*) from public.reservations),
           (select count(*) from public.crm_event_facts f where f.source_table = 'reservations' and f.event_type = 'reservation'),
           (select count(*) from public.reservations x
             where not exists (select 1 from public.crm_event_facts f
                                where f.source_table = 'reservations' and f.event_type = 'reservation' and f.source_id = x.id)),
           0
  )
  select s, src, fct, miss, orph from a;
$$;

-- إعادة المزامنة: يملأ الناقص ويحذف اليتيم — للمدير من «عمليات اللقطات»
create or replace function public.crm_fact_resync(p_since timestamptz default null)
returns table (source text, synced bigint)
language plpgsql security definer set search_path = public as $$
declare r record; n bigint;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null and not public.is_admin() then
    raise exception 'إعادة مزامنة الأحداث للمدير وحده.' using errcode = '42501';
  end if;

  n := 0;
  for r in select id from public.client_activities
            where p_since is null or created_at >= p_since loop
    perform public.crm_fact_sync_activity(r.id, p_since is null); n := n + 1;
  end loop;
  delete from public.crm_event_facts f
   where f.source_table = 'client_activities'
     and not exists (select 1 from public.client_activities x where x.id = f.source_id);
  source := 'client_activities'; synced := n; return next;

  n := 0;
  for r in select id from public.clients where p_since is null or created_at >= p_since loop
    perform public.crm_fact_sync_client(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'clients'; synced := n; return next;

  n := 0;
  for r in select id from public.client_assignments where p_since is null or at >= p_since order by at loop
    perform public.crm_fact_sync_assignment(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'client_assignments'; synced := n; return next;

  n := 0;
  for r in select id from public.opportunity_stage_history where p_since is null or at >= p_since order by at loop
    perform public.crm_fact_sync_stage(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'opportunity_stage_history'; synced := n; return next;

  -- بعد تاريخ المراحل: الفوز المركَّب يُنشأ فقط لما لا صفّ له هناك
  n := 0;
  for r in select id from public.opportunities where p_since is null or created_at >= p_since loop
    perform public.crm_fact_sync_opportunity(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'opportunities'; synced := n; return next;

  n := 0;
  for r in select id from public.reservations where p_since is null or created_at >= p_since loop
    perform public.crm_fact_sync_reservation(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'reservations'; synced := n; return next;

  n := 0;
  for r in select id from public.tasks where status = 'منجزة' and (p_since is null or created_at >= p_since) loop
    perform public.crm_fact_sync_task(r.id, p_since is null); n := n + 1;
  end loop;
  source := 'tasks'; synced := n; return next;

  update public.crm_fact_errors set resolved_at = now() where resolved_at is null;
end $$;

-- ------------------------------------------------------------
-- 7) التجميعات اليومية والأسبوعية والشهرية (§75)
--
-- عروض لا جداول: الأحداث اليوم ~٥ آلاف صفّ في سبعة أشهر، وتجميعها
-- عند الطلب أسرع من أي جدول يحتاج تحديثاً. عتبة التحويل إلى عرض
-- مادّي موثّقة في CRM_ARCHITECTURE §٢٠ (قياس، لا تخمين).
-- security_invoker: كل قارئ يرى نطاقه.
-- ------------------------------------------------------------
create or replace view public.v_crm_events_daily with (security_invoker = true) as
select f.event_date                       as bucket,
       f.event_type, f.event_subtype, f.employee_id, f.team_id, f.project_id,
       f.source_id_dim                     as source_id,
       count(*)                            as events,
       count(distinct f.client_id)         as unique_clients,
       coalesce(sum(f.value), 0)           as value
  from public.crm_event_facts f
 where not f.is_void
 group by 1, 2, 3, 4, 5, 6, 7;

create or replace view public.v_crm_events_weekly with (security_invoker = true) as
select public.crm_week_start(f.event_date) as bucket,
       f.event_type, f.event_subtype, f.employee_id, f.team_id, f.project_id,
       f.source_id_dim                     as source_id,
       count(*)                            as events,
       count(distinct f.client_id)         as unique_clients,
       coalesce(sum(f.value), 0)           as value
  from public.crm_event_facts f
 where not f.is_void
 group by 1, 2, 3, 4, 5, 6, 7;

create or replace view public.v_crm_events_monthly with (security_invoker = true) as
select date_trunc('month', f.event_date)::date as bucket,
       f.event_type, f.event_subtype, f.employee_id, f.team_id, f.project_id,
       f.source_id_dim                     as source_id,
       count(*)                            as events,
       count(distinct f.client_id)         as unique_clients,
       coalesce(sum(f.value), 0)           as value
  from public.crm_event_facts f
 where not f.is_void
 group by 1, 2, 3, 4, 5, 6, 7;

-- ------------------------------------------------------------
-- 8) الأمن
--
-- القراءة: نفس نطاق سجلّ التواصل (client_activities) حرفياً، ومعه
-- شرطان: الموظف يرى ما **فعله هو** ولو نُقل العميل عنه (أداؤه
-- التاريخي له)، والمحاسب يرى أحداث المال وحدها (حجز، بيع، فوز).
-- لا سياسة كتابة: المحفّزات وحدها تكتب.
-- ------------------------------------------------------------
alter table public.crm_event_facts enable row level security;
drop policy if exists "read event facts" on public.crm_event_facts;
create policy "read event facts" on public.crm_event_facts
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or employee_id in (select s.id from public.my_scope_employees() s)
    or owner_id    in (select s.id from public.my_scope_employees() s)
    or ((select public.is_accountant())
        and (event_type in ('reservation', 'sale_completed', 'reservation_cancelled')
             or (event_type = 'stage_change' and to_stage_type = 'won')))
    or (client_id is not null and public.can_see_client(client_id))
  );

alter table public.crm_fact_errors enable row level security;
drop policy if exists "admin reads fact errors" on public.crm_fact_errors;
create policy "admin reads fact errors" on public.crm_fact_errors
  for select to authenticated using ((select public.is_admin()));

revoke all on public.crm_event_facts from anon;
revoke insert, update, delete, truncate on public.crm_event_facts from authenticated;
grant select on public.crm_event_facts to authenticated;
grant select on public.v_crm_events_daily, public.v_crm_events_weekly, public.v_crm_events_monthly to authenticated;
revoke all on public.crm_fact_errors from anon;
revoke insert, update, delete, truncate on public.crm_fact_errors from authenticated;
grant select on public.crm_fact_errors to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'crm_fact_sync_activity(uuid, boolean)', 'crm_fact_sync_stage(uuid, boolean)',
    'crm_fact_sync_client(uuid, boolean)', 'crm_fact_sync_opportunity(uuid, boolean)',
    'crm_fact_sync_assignment(uuid, boolean)', 'crm_fact_sync_reservation(uuid, boolean)',
    'crm_fact_sync_task(uuid, boolean)', 'crm_fact_log_error(text, uuid, text, text, text, text)',
    'crm_event_dims(uuid, uuid, timestamptz)', 'crm_owner_as_of(uuid, timestamptz)',
    'crm_emp_of_user(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;

  foreach fn in array array['crm_fact_resync(timestamptz)', 'crm_bgd_date(timestamptz)',
                            'crm_bgd_day_end(date)', 'crm_week_start(date)']
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- crm_fact_reconcile تكشف أعداداً على مستوى الشركة: للإدارة وحدها
create or replace function public.crm_fact_reconcile_checked()
returns table (source text, source_rows bigint, fact_rows bigint, missing bigint, orphaned bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not (public.is_admin() or public.is_followup_manager()) then
    raise exception 'للإدارة وحدها.' using errcode = '42501';
  end if;
  return query select * from public.crm_fact_reconcile();
end $$;
revoke all on function public.crm_fact_reconcile() from public, anon, authenticated;
grant execute on function public.crm_fact_reconcile() to service_role;
revoke all on function public.crm_fact_reconcile_checked() from public, anon;
grant execute on function public.crm_fact_reconcile_checked() to authenticated, service_role;

-- ------------------------------------------------------------
-- 9) التعبئة الأولى — كل ما حدث منذ بداية البيانات
--
-- الأبعاد في التعبئة «كما كانت» حيث يوجد تاريخ (الملكية من 071،
-- المراحل من 072)، والحالي حيث لا تاريخ (مشروع الموظف، مصدر العميل)
-- — وتُعلَّم is_backfilled كي لا يُظنّ أنها جُمِّدت لحظة الحدث.
-- ------------------------------------------------------------
do $
declare r record;
begin
  if not exists (select 1 from public.crm_event_facts limit 1) then
    for r in select * from public.crm_fact_resync(null) loop
      raise notice 'تعبئة %: %', r.source, r.synced;
    end loop;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10) التحقّق
-- ------------------------------------------------------------
do $$
declare r record; bad int := 0;
begin
  raise notice '--- 096 طبقة الأحداث ---';
  for r in select * from public.crm_fact_reconcile() loop
    raise notice '  % — الأصل % · الأحداث % · ناقص % · يتيم %',
      r.source, r.source_rows, r.fact_rows, r.missing, r.orphaned;
    bad := bad + r.missing + r.orphaned;
  end loop;
  if bad > 0 then
    raise warning 'فرق بين الأصل والأحداث: % — راجع crm_fact_errors', bad;
  end if;
  raise notice 'أخطاء كتابة: %', (select count(*) from public.crm_fact_errors where resolved_at is null);
  raise notice 'أحداث حسب النوع: %',
    (select jsonb_object_agg(event_type, n) from
       (select event_type, count(*) n from public.crm_event_facts group by 1) x);
end $$;

notify pgrst, 'reload schema';
