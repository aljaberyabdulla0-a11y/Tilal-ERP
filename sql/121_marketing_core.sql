-- ============================================================
-- تلال ERP — 121: التسويق ١ — الفريق والقنوات والخطط والحملات والمحتوى
--                    والإعلانات والمؤثرون والميداني والمهامّ والموافقات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المبدأ =====
--
-- التسويق قسمٌ من النظام لا نظامٌ بجانبه. فكل ما له أصلٌ هنا يُوسَّع:
--
--   الحملة      crm_campaigns (079)        ← أعمدة جديدة، لا جدول ثانٍ
--   الليد       clients / crm_lead_intake   ← لا جدول ليدات (124 يضيف اللمسات)
--   المصدر      crm_sources                 ← القناة تُربط به
--   الموظف      employees                   ← الدور الوظيفي في mkt_team
--   المورّد     suppliers                   ← علَم «مورّد تسويق»
--   المشروع     projects / units            ← مفاتيح أجنبية، قراءة فقط
--
-- ===== الأدوار =====
--
-- `marketing` (084) يبقى دور الدخول. والعمل الفعلي يُوزَّع بدور وظيفي
-- على ملفّ الموظف (mkt_team): مدير تسويق، مشتري إعلانات، مصمّم…
-- فموظفٌ بدور `employee` يُضمّ إلى الفريق ويعمل في القسم بلا تغيير
-- دوره في النظام كله — وتغيير الدور هناك يمسّ كل سياسة.
--
--   can_read_marketing()     المدير، التسويق، المُطالِع، أعضاء الفريق
--   can_write_marketing()    المدير، التسويق، أعضاء الفريق
--   is_marketing_manager()   المدير، أو «مدير التسويق» في الفريق
--
-- ===== الحالات والموافقات =====
--
-- الاعتماد لا يقع بتعديل عمود. الحملة والخطة والمحتوى والنشاط
-- والمؤثر تُعتمد بـ mkt_decide_approval وحدها (أو بيد مدير التسويق)،
-- وحارسٌ على كل جدول يرفض غير ذلك — فلا «معتمدة» بلا صفّ موافقة
-- يقول من طلب ومن وافق ومتى.
--
-- يتطلب: 079، 084، 058 (audit_row)، 087 (نمط الدلو). آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) فريق التسويق والأدوار الوظيفية
-- ------------------------------------------------------------
create table if not exists public.mkt_team (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  mkt_role    text not null check (mkt_role in (
                'مدير التسويق', 'أخصائي تسويق', 'مدير حساب', 'كاتب محتوى',
                'مصمّم', 'مصوّر', 'مونتير', 'مشتري إعلانات', 'مدير منصّات',
                'أخصائي SEO', 'مسوّق أداء', 'منسّق فعاليات', 'منسّق تسويق')),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

comment on table public.mkt_team is
  'الدور الوظيفي في التسويق على ملفّ الموظف. لا يغيّر profiles.role — موظف عادي يُضمّ للفريق فيعمل في القسم وحده.';

create or replace function public.my_mkt_role()
returns text language sql stable security definer set search_path = public as $$
  select t.mkt_role
    from public.mkt_team t
    join public.employees e on e.id = t.employee_id
   where e.user_id = auth.uid() and t.is_active and e.status = 'active'
   limit 1;
$$;

create or replace function public.can_read_marketing()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_marketing() or public.is_viewer()
      or public.my_mkt_role() is not null;
$$;

create or replace function public.can_write_marketing()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_marketing() or public.my_mkt_role() is not null;
$$;

create or replace function public.is_marketing_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.my_mkt_role() = 'مدير التسويق', false);
$$;

-- أرقام التسويق المالية: القسم نفسه والمحاسب (يدفع المصروف ويطابقه)
create or replace function public.can_read_marketing_money()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_marketing() or public.is_accountant();
$$;

comment on function public.can_read_marketing() is
  'قراءة قسم التسويق. تقابلها canReadMarketing() في src/lib/auth.ts حرفياً.';

-- قوائم الاختيار في القسم — قراءة فقط، بلا رواتب ولا هواتف.
-- ⚠️ لا توسَّع سياسات employees/projects/units لأجل التسويق: عضو الفريق
--    قد يكون موظفاً بنطاق مشروعه، وتوسيع قراءته للجداول يكشف ما لا
--    يخصّ عمله. الدوالّ تُرجع الأعمدة التي يحتاجها الاختيار وحدها.
create or replace function public.mkt_people()
returns table (id uuid, full_name text, job_title text, mkt_role text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.job_title, t.mkt_role, e.user_id
    from public.employees e
    left join public.mkt_team t on t.employee_id = e.id and t.is_active
   where e.status = 'active' and public.can_read_marketing_money()
   order by (t.mkt_role is null), e.full_name;
$$;

create or replace function public.mkt_projects()
returns table (id uuid, name text, status text, governorate text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.status, p.governorate from public.projects p
   where public.can_read_marketing_money() order by p.name;
$$;

create or replace function public.mkt_units(p_project uuid)
returns table (id uuid, unit_code text, unit_type text, status text, space_m2 numeric, price numeric, node_path text)
language sql stable security definer set search_path = public as $$
  select u.id, u.unit_code, u.unit_type, u.status, u.space_m2, u.price, u.node_path
    from public.units u
   where u.project_id = p_project and public.can_read_marketing()
   order by u.node_path nulls last, u.unit_code;
$$;

revoke all on function public.mkt_people()      from public, anon;
revoke all on function public.mkt_projects()    from public, anon;
revoke all on function public.mkt_units(uuid)   from public, anon;
grant execute on function public.mkt_people()    to authenticated;
grant execute on function public.mkt_projects()  to authenticated;
grant execute on function public.mkt_units(uuid) to authenticated;

revoke all on function public.my_mkt_role()              from public, anon;
revoke all on function public.can_read_marketing()       from public, anon;
revoke all on function public.can_write_marketing()      from public, anon;
revoke all on function public.is_marketing_manager()     from public, anon;
revoke all on function public.can_read_marketing_money() from public, anon;
grant execute on function public.my_mkt_role()              to authenticated, service_role;
grant execute on function public.can_read_marketing()       to authenticated, service_role;
grant execute on function public.can_write_marketing()      to authenticated, service_role;
grant execute on function public.is_marketing_manager()     to authenticated, service_role;
grant execute on function public.can_read_marketing_money() to authenticated, service_role;


-- ------------------------------------------------------------
-- 2) القنوات — أدقّ من المصدر ومربوطة به
--
-- «سوشيل ميديا» في crm_sources مصدرٌ واحد؛ والتسويق يحتاج أن يفرّق
-- فيسبوك عن تيك توك. فالقناة تحمل source_id: تقارير الـCRM تبقى على
-- مصادرها الأربعة، وتقارير التسويق تنزل إلى القناة.
-- ------------------------------------------------------------
create table if not exists public.mkt_channels (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  mode           text not null check (mode in ('رقمي', 'ميداني')),
  platform       text,
  source_id      uuid references public.crm_sources(id) on delete set null,
  utm_source     text not null check (utm_source ~ '^[a-z0-9_.-]+$'),
  utm_medium     text not null check (utm_medium ~ '^[a-z0-9_.-]+$'),
  owner_employee_id uuid references public.employees(id) on delete set null,
  vendor_id      uuid references public.suppliers(id) on delete set null,
  monthly_budget numeric check (monthly_budget is null or monthly_budget >= 0),
  tracking       jsonb not null default '{}'::jsonb,
  is_active      boolean not null default true,
  sort_order     int not null default 100,
  created_at     timestamptz not null default now(),
  unique (utm_source, utm_medium)
);

insert into public.mkt_channels (name, mode, platform, utm_source, utm_medium, sort_order, source_id)
select v.name, v.mode, v.platform, v.src, v.med, v.ord,
       (select s.id from public.crm_sources s where s.name = v.crm_source)
  from (values
    ('فيسبوك',              'رقمي',   'meta',     'facebook',     'paid_social', 10, 'سوشيل ميديا'),
    ('إنستغرام',            'رقمي',   'meta',     'instagram',    'paid_social', 11, 'سوشيل ميديا'),
    ('تيك توك',             'رقمي',   'tiktok',   'tiktok',       'paid_social', 12, 'سوشيل ميديا'),
    ('يوتيوب',              'رقمي',   'google',   'youtube',      'video',       13, 'سوشيل ميديا'),
    ('سناب شات',            'رقمي',   'snap',     'snapchat',     'paid_social', 14, 'سوشيل ميديا'),
    ('لينكدإن',             'رقمي',   'linkedin', 'linkedin',     'paid_social', 15, 'سوشيل ميديا'),
    ('بحث جوجل',            'رقمي',   'google',   'google',       'cpc',         20, null),
    ('شبكة جوجل الإعلانية', 'رقمي',   'google',   'google',       'display',     21, null),
    ('جوجل Performance Max','رقمي',   'google',   'google',       'pmax',        22, null),
    ('الموقع الإلكتروني',   'رقمي',   'web',      'website',      'organic',     30, null),
    ('صفحة هبوط',           'رقمي',   'web',      'landing',      'landing',     31, null),
    ('البريد الإلكتروني',   'رقمي',   'email',    'email',        'email',       32, null),
    ('واتساب',              'رقمي',   'whatsapp', 'whatsapp',     'messaging',   33, null),
    ('رسائل SMS',           'رقمي',   'sms',      'sms',          'sms',         34, null),
    ('لوحة إعلانية',        'ميداني', null,       'billboard',    'ooh',         50, null),
    ('إعلان طرق',           'ميداني', null,       'roadside',     'ooh',         51, null),
    ('مول',                 'ميداني', null,       'mall',         'ooh',         52, null),
    ('بانر',                'ميداني', null,       'banner',       'ooh',         53, null),
    ('لافتات',              'ميداني', null,       'signage',      'ooh',         54, 'مرّ من المنطقة'),
    ('مركز المبيعات',       'ميداني', null,       'sales_center', 'offline',     55, 'مرّ من المنطقة'),
    ('مجلة',                'ميداني', null,       'magazine',     'print',       60, null),
    ('صحيفة',               'ميداني', null,       'newspaper',    'print',       61, null),
    ('بروشور',              'ميداني', null,       'brochure',     'print',       62, null),
    ('فلاير',               'ميداني', null,       'flyer',        'print',       63, null),
    ('راديو',               'ميداني', null,       'radio',        'broadcast',   70, null),
    ('تلفزيون',             'ميداني', null,       'tv',           'broadcast',   71, null),
    ('معرض',                'ميداني', null,       'exhibition',   'event',       80, null),
    ('فعالية',              'ميداني', null,       'event',        'event',       81, null),
    ('تفعيل ميداني',        'ميداني', null,       'activation',   'event',       82, null),
    ('مؤثرون',              'رقمي',   null,       'influencer',   'influencer',  40, 'سوشيل ميديا')
  ) as v(name, mode, platform, src, med, ord, crm_source)
on conflict (name) do nothing;


-- ------------------------------------------------------------
-- 3) الاستراتيجية والخطط والأهداف والجمهور والمنافسون
--
-- الاستراتيجية خطةٌ من نوعها: سنوية أو ربعية أو شهرية، وتحتها خطط
-- (parent_id). والهدف صفٌّ له مقياس من قائمة مغلقة (metric_code)،
-- فيُحسب «الفعلي» من القاعدة لا يُكتب باليد (125: mkt_objective_progress).
-- ------------------------------------------------------------
create table if not exists public.mkt_audiences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  segment     text,
  description text,
  age_range   text,
  locations   text,
  interests   text,
  income_level text,
  project_id  uuid references public.projects(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.mkt_competitors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  projects       text,
  strengths      text,
  weaknesses     text,
  price_position text,
  notes          text,
  created_at     timestamptz not null default now()
);

create table if not exists public.mkt_plans (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in (
                      'استراتيجية سنوية', 'استراتيجية ربعية', 'استراتيجية شهرية',
                      'خطة سنوية', 'خطة ربعية', 'خطة شهرية', 'خطة أسبوعية',
                      'خطة حملة', 'خطة مشروع', 'خطة قناة')),
  title             text not null,
  parent_id         uuid references public.mkt_plans(id) on delete set null,
  project_id        uuid references public.projects(id) on delete set null,
  channel_id        uuid references public.mkt_channels(id) on delete set null,
  audience_id       uuid references public.mkt_audiences(id) on delete set null,
  period_start      date not null,
  period_end        date not null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  status            text not null default 'مسودة'
                    check (status in ('مسودة', 'بانتظار الموافقة', 'معتمدة', 'مؤرشفة')),
  budget            numeric check (budget is null or budget >= 0),
  expected_leads    int check (expected_leads is null or expected_leads >= 0),
  expected_sales    int check (expected_sales is null or expected_sales >= 0),
  expected_revenue  numeric check (expected_revenue is null or expected_revenue >= 0),
  positioning       text,
  value_proposition text,
  hypotheses        text,
  notes             text,
  approved_at       timestamptz,
  approved_by       uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mkt_plans_dates check (period_end >= period_start)
);
create index if not exists mkt_plans_period_idx on public.mkt_plans (period_start, period_end);
create index if not exists mkt_plans_project_idx on public.mkt_plans (project_id);

-- مقاييس الهدف: قائمة مغلقة يحسبها 125. لا مقياس يُكتب «فعليّه» باليد.
create table if not exists public.mkt_objectives (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.mkt_plans(id) on delete cascade,
  kind         text not null default 'هدف'
               check (kind in ('هدف استراتيجي', 'هدف', 'مؤشر', 'مبادرة', 'أولوية')),
  title        text not null,
  metric_code  text check (metric_code in (
                 'leads', 'qualified', 'reservations', 'sales',
                 'commission', 'sale_value', 'spend', 'cpl', 'cpql', 'cpa', 'cac',
                 'roi', 'roas', 'lead_to_sale', 'lead_to_reservation')),
  target_value numeric,
  direction    text not null default 'أعلى' check (direction in ('أعلى', 'أدنى')),
  project_id   uuid references public.projects(id) on delete set null,
  campaign_id  uuid references public.crm_campaigns(id) on delete set null,
  channel_id   uuid references public.mkt_channels(id) on delete set null,
  notes        text,
  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),
  constraint mkt_objectives_metric_target check (metric_code is null or target_value is not null)
);
create index if not exists mkt_objectives_plan_idx on public.mkt_objectives (plan_id);


-- ------------------------------------------------------------
-- 4) الحملة — توسيع crm_campaigns لا جدول ثانٍ
--
-- ⚠️ الأعمدة القديمة لم يتغيّر معناها: الاسم ما زال مفتاح مطابقة
--    intake_lead، و is_active ما زالت «الحملة جارية» — صارت تُشتقّ
--    من الحالة بمحفّز. و spent يصير محسوباً من المصروفات المدفوعة
--    حين توجد (122) ويبقى يدوياً لحملةٍ لا مصروف مسجّلاً عليها.
-- ------------------------------------------------------------
create sequence if not exists public.mkt_campaign_code_seq;

alter table public.crm_campaigns
  add column if not exists code              text,
  add column if not exists campaign_type     text,
  add column if not exists status            text,
  add column if not exists mode              text,
  add column if not exists objective         text,
  add column if not exists channel_id        uuid references public.mkt_channels(id) on delete set null,
  add column if not exists audience_id       uuid references public.mkt_audiences(id) on delete set null,
  add column if not exists plan_id           uuid references public.mkt_plans(id) on delete set null,
  add column if not exists owner_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists unit_type         text,
  add column if not exists node_id           uuid references public.project_nodes(id) on delete set null,
  add column if not exists unit_id           uuid references public.units(id) on delete set null,
  add column if not exists expected_leads        int,
  add column if not exists expected_qualified    int,
  add column if not exists expected_reservations int,
  add column if not exists expected_sales        int,
  add column if not exists expected_revenue      numeric,
  add column if not exists target_cpl            numeric,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by       uuid references auth.users(id) on delete set null,
  add column if not exists updated_at        timestamptz not null default now();

-- ترحيل ما قبل 121: الجارية «نشطة» والمتوقفة «مكتملة»، ورمزٌ لكل حملة
update public.crm_campaigns
   set status = case when is_active then 'نشطة' else 'مكتملة' end,
       approved_at = coalesce(approved_at, created_at)
 where status is null;
update public.crm_campaigns
   set code = 'cmp-' || lpad(nextval('public.mkt_campaign_code_seq')::text, 4, '0')
 where code is null;
update public.crm_campaigns
   set campaign_type = coalesce(campaign_type, 'توليد ليدات'),
       mode          = coalesce(mode, 'رقمي');

alter table public.crm_campaigns alter column status set default 'مسودة';
alter table public.crm_campaigns alter column status set not null;
alter table public.crm_campaigns alter column code set not null;
alter table public.crm_campaigns alter column campaign_type set default 'توليد ليدات';
alter table public.crm_campaigns alter column campaign_type set not null;
alter table public.crm_campaigns alter column mode set default 'رقمي';
alter table public.crm_campaigns alter column mode set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_code_key') then
    alter table public.crm_campaigns add constraint crm_campaigns_code_key unique (code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_code_fmt') then
    alter table public.crm_campaigns add constraint crm_campaigns_code_fmt
      check (code ~ '^[a-z0-9][a-z0-9_-]{1,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_status_chk') then
    alter table public.crm_campaigns add constraint crm_campaigns_status_chk
      check (status in ('مسودة', 'تخطيط', 'بانتظار الموافقة', 'معتمدة', 'نشطة',
                        'متوقفة', 'مكتملة', 'ملغاة'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_type_chk') then
    alter table public.crm_campaigns add constraint crm_campaigns_type_chk
      check (campaign_type in ('توعية', 'توليد ليدات', 'تحويل', 'إعادة استهداف', 'إطلاق',
                               'إطلاق مشروع', 'تحديث مشروع', 'علامة تجارية', 'مستثمرون',
                               'فعالية', 'موسمية', 'مؤثرون', 'ميداني', 'هجينة'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_mode_chk') then
    alter table public.crm_campaigns add constraint crm_campaigns_mode_chk
      check (mode in ('رقمي', 'ميداني', 'هجين'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_campaigns_expect_chk') then
    alter table public.crm_campaigns add constraint crm_campaigns_expect_chk
      check (coalesce(expected_leads, 0) >= 0 and coalesce(expected_qualified, 0) >= 0
         and coalesce(expected_reservations, 0) >= 0 and coalesce(expected_sales, 0) >= 0
         and coalesce(expected_revenue, 0) >= 0 and coalesce(target_cpl, 0) >= 0);
  end if;
end $$;

create index if not exists crm_campaigns_status_idx  on public.crm_campaigns (status);
create index if not exists crm_campaigns_project_idx on public.crm_campaigns (project_id);
create index if not exists crm_campaigns_channel_idx on public.crm_campaigns (channel_id);
create index if not exists crm_campaigns_owner_idx   on public.crm_campaigns (owner_employee_id);

comment on column public.crm_campaigns.code is
  'رمز الحملة = utm_campaign. لاتيني صغير لأنه يمرّ في الروابط. يُولَّد cmp-0001 إن تُرك فارغاً.';

-- قنوات الحملة: الحملة الهجينة تعمل على أكثر من قناة، ولكلٍّ ميزانيتها المخطّطة
create table if not exists public.mkt_campaign_channels (
  campaign_id    uuid not null references public.crm_campaigns(id) on delete cascade,
  channel_id     uuid not null references public.mkt_channels(id) on delete restrict,
  planned_budget numeric check (planned_budget is null or planned_budget >= 0),
  primary key (campaign_id, channel_id)
);
create index if not exists mkt_campaign_channels_channel_idx on public.mkt_campaign_channels (channel_id);

-- ===== حارس الحملة: الرمز، والحالة، و is_active =====
create or replace function public.mkt_guard_campaign()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
begin
  new.code := lower(btrim(coalesce(new.code, '')));
  if new.code = '' then
    new.code := 'cmp-' || lpad(nextval('public.mkt_campaign_code_seq')::text, 4, '0');
  end if;

  if tg_op = 'INSERT' then
    new.status := coalesce(new.status, 'مسودة');
    -- الحملة تولد مسودة أو تخطيطاً. مدير التسويق يُدخل حملةً جاريةً (توثيق ما سبق النظام)
    if new.status not in ('مسودة', 'تخطيط') and not v_flag and not public.is_marketing_manager() then
      raise exception 'الحملة الجديدة تبدأ «مسودة» أو «تخطيط» — الاعتماد بطلب موافقة';
    end if;
    if new.status in ('معتمدة', 'نشطة', 'متوقفة', 'مكتملة') then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;
  elsif new.status is distinct from old.status then
    if old.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'الحملة بانتظار الموافقة — اسحب الطلب أو انتظر القرار';
    elsif new.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'طلب الاعتماد من زرّ «اطلب الموافقة» — ليُسجَّل من طلب ومتى';
    elsif new.status = 'معتمدة' and not v_flag and not public.is_marketing_manager() then
      raise exception 'اعتماد الحملة لمدير التسويق — اطلب الموافقة';
    elsif new.status in ('نشطة', 'متوقفة', 'مكتملة')
          and old.approved_at is null and not v_flag and not public.is_marketing_manager() then
      raise exception 'الحملة لم تُعتمد بعد — لا تُفعَّل قبل اعتمادها';
    elsif new.status = 'ملغاة' and not public.is_marketing_manager() then
      raise exception 'إلغاء الحملة لمدير التسويق';
    elsif old.status in ('مكتملة', 'ملغاة') and not public.is_marketing_manager() then
      raise exception 'الحملة % — إعادة فتحها لمدير التسويق', old.status;
    end if;

    if new.status = 'معتمدة' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
  end if;

  new.is_active  := new.status not in ('مكتملة', 'ملغاة');
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_campaign on public.crm_campaigns;
create trigger trg_mkt_guard_campaign
  before insert or update on public.crm_campaigns
  for each row execute function public.mkt_guard_campaign();

-- الحملة التي نُسب إليها ليدٌ أو مصروف لا تُحذف — تُلغى.
-- الحذف كان يُفرغ clients.campaign_id بصمت (on delete set null)، فيضيع
-- الإسناد التاريخي كلّه بنقرة.
create or replace function public.mkt_guard_campaign_delete()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.clients where campaign_id = old.id)
     or exists (select 1 from public.opportunities where campaign_id = old.id)
     or (to_regclass('public.mkt_expenses') is not null
         and exists (select 1 from public.mkt_expenses where campaign_id = old.id))
     or (to_regclass('public.mkt_touchpoints') is not null
         and exists (select 1 from public.mkt_touchpoints where campaign_id = old.id)) then
    raise exception 'الحملة «%» عليها ليدات أو مصروفات — لا تُحذف بل تُلغى، فيبقى إسنادها', old.name;
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_mkt_guard_campaign_delete on public.crm_campaigns;
create trigger trg_mkt_guard_campaign_delete
  before delete on public.crm_campaigns
  for each row execute function public.mkt_guard_campaign_delete();

-- الكتابة على الحملات: المدير والتسويق (084) + فريق التسويق
drop policy if exists "admin writes campaigns" on public.crm_campaigns;
create policy "admin writes campaigns" on public.crm_campaigns
  for all to authenticated
  using ((select public.can_write_marketing()))
  with check ((select public.can_write_marketing()));


-- ------------------------------------------------------------
-- 5) الحسابات — حسابات التواصل والإعلانات والمواقع
-- ------------------------------------------------------------
create table if not exists public.mkt_accounts (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('حساب تواصل', 'حساب إعلانات', 'موقع',
                                                   'واتساب', 'بريد', 'رسائل')),
  channel_id        uuid not null references public.mkt_channels(id) on delete restrict,
  name              text not null,
  handle            text,
  external_id       text,
  url               text,
  owner_employee_id uuid references public.employees(id) on delete set null,
  followers         int check (followers is null or followers >= 0),
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (channel_id, external_id)
);


-- ------------------------------------------------------------
-- 6) المحتوى ونسخه
-- ------------------------------------------------------------
create sequence if not exists public.mkt_content_code_seq;

create table if not exists public.mkt_content (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique
                 default ('cnt-' || lpad(nextval('public.mkt_content_code_seq')::text, 4, '0')),
  title          text not null,
  content_type   text not null check (content_type in (
                   'منشور', 'ريلز', 'فيديو', 'ستوري', 'كاروسيل', 'تصميم ثابت', 'مدونة', 'مقال',
                   'نص موقع', 'صفحة هبوط', 'بريد', 'رسالة نصية', 'واتساب', 'بروشور',
                   'لوحة إعلانية', 'بيان صحفي', 'دراسة حالة', 'تحديث مشروع',
                   'فيديو مبيعات', 'فيديو تعليمي', 'محتوى مستثمرين')),
  status         text not null default 'فكرة' check (status in (
                   'فكرة', 'مسودة', 'كتابة', 'تصميم', 'مونتاج', 'بانتظار الموافقة',
                   'معتمد', 'مجدول', 'منشور', 'مرفوض', 'مؤرشف')),
  objective      text,
  brief          text,
  script         text,
  caption        text,
  cta            text,
  hashtags       text,
  format         text,
  project_id     uuid references public.projects(id) on delete set null,
  campaign_id    uuid references public.crm_campaigns(id) on delete set null,
  channel_id     uuid references public.mkt_channels(id) on delete set null,
  account_id     uuid references public.mkt_accounts(id) on delete set null,
  audience_id    uuid references public.mkt_audiences(id) on delete set null,
  owner_id       uuid references public.employees(id) on delete set null,
  writer_id      uuid references public.employees(id) on delete set null,
  designer_id    uuid references public.employees(id) on delete set null,
  photographer_id uuid references public.employees(id) on delete set null,
  editor_id      uuid references public.employees(id) on delete set null,
  reviewer_id    uuid references public.employees(id) on delete set null,
  due_date       date,
  publish_at     timestamptz,
  published_at   timestamptz,
  published_url  text,
  reject_reason  text,
  version        int not null default 1,
  approved_at    timestamptz,
  approved_by    uuid references auth.users(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mkt_content_campaign_idx on public.mkt_content (campaign_id);
create index if not exists mkt_content_project_idx  on public.mkt_content (project_id);
create index if not exists mkt_content_status_idx   on public.mkt_content (status);
create index if not exists mkt_content_publish_idx  on public.mkt_content (publish_at);
create index if not exists mkt_content_due_idx      on public.mkt_content (due_date);

create table if not exists public.mkt_content_versions (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.mkt_content(id) on delete cascade,
  version    int not null,
  title      text,
  brief      text,
  script     text,
  caption    text,
  cta        text,
  hashtags   text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (content_id, version)
);

-- النسخة القديمة تُحفظ قبل كل تعديل على النصّ، والاعتماد/النشر بحارس
create or replace function public.mkt_guard_content()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status in ('بانتظار الموافقة', 'معتمد', 'مجدول', 'منشور')
       and not v_flag and not public.is_marketing_manager() then
      new.status := 'مسودة';
    end if;
    return new;
  end if;

  if (new.title, new.brief, new.script, new.caption, new.cta, new.hashtags)
     is distinct from (old.title, old.brief, old.script, old.caption, old.cta, old.hashtags) then
    insert into public.mkt_content_versions
      (content_id, version, title, brief, script, caption, cta, hashtags, changed_by)
    values (old.id, old.version, old.title, old.brief, old.script, old.caption, old.cta,
            old.hashtags, auth.uid())
    on conflict (content_id, version) do nothing;
    new.version := old.version + 1;
    -- تعديل نصٍّ معتمد يُسقط اعتماده: ما وافق عليه المدير ليس هذا
    if old.status in ('معتمد', 'مجدول') and not public.is_marketing_manager() then
      new.status := 'مسودة';
      new.approved_at := null;
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'المحتوى بانتظار الموافقة — اسحب الطلب أو انتظر القرار';
    elsif new.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'طلب اعتماد المحتوى من زرّ «اطلب الموافقة»';
    elsif new.status = 'معتمد' and not v_flag and not public.is_marketing_manager() then
      raise exception 'اعتماد المحتوى لمدير التسويق';
    elsif new.status in ('مجدول', 'منشور') and new.approved_at is null
          and not public.is_marketing_manager() then
      raise exception 'المحتوى لم يُعتمد — لا يُجدول ولا يُنشر قبل اعتماده';
    end if;
    if new.status = 'معتمد' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
    if new.status = 'منشور' then
      new.published_at := coalesce(new.published_at, now());
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_content on public.mkt_content;
create trigger trg_mkt_guard_content
  before insert or update on public.mkt_content
  for each row execute function public.mkt_guard_content();


-- ------------------------------------------------------------
-- 7) مكتبة الأصول — دلو خاصّ بنمط مستندات العميل (087)
--
-- المسار هو الحارس:  mkt/<uuid>-<اسم الملف>
-- لا سياسة update: الملفّ لا يُستبدَل في مكانه؛ النسخة الجديدة رفعٌ
-- جديد يشير إلى سابقته (parent_asset_id)، والقديمة تُؤرشف.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-assets', 'marketing-assets', false, 104857600,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
              'video/mp4', 'video/quicktime', 'application/pdf',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/zip'])
on conflict (id) do nothing;

create table if not exists public.mkt_assets (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  asset_type        text not null check (asset_type in (
                      'صورة', 'فيديو', 'تصميم ثلاثي الأبعاد', 'مخطط', 'شعار', 'دليل الهوية',
                      'بروشور', 'PDF', 'عرض تقديمي', 'مستند', 'تصميم سوشيال', 'إعلان',
                      'صورة مشروع', 'صورة إنشاء', 'عقد', 'فاتورة')),
  folder            text,
  tags              text[] not null default '{}',
  project_id        uuid references public.projects(id) on delete set null,
  campaign_id       uuid references public.crm_campaigns(id) on delete set null,
  storage_path      text not null unique check (storage_path like 'mkt/%'),
  file_name         text not null,
  mime_type         text,
  size_bytes        bigint,
  version           int not null default 1,
  parent_asset_id   uuid references public.mkt_assets(id) on delete set null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  usage_rights      text,
  copyright         text,
  expires_on        date,
  status            text not null default 'مسودة' check (status in ('مسودة', 'معتمد', 'مؤرشف')),
  uploaded_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  archived_at       timestamptz
);
create index if not exists mkt_assets_project_idx  on public.mkt_assets (project_id);
create index if not exists mkt_assets_campaign_idx on public.mkt_assets (campaign_id);
create index if not exists mkt_assets_tags_idx     on public.mkt_assets using gin (tags);

create table if not exists public.mkt_content_assets (
  content_id uuid not null references public.mkt_content(id) on delete cascade,
  asset_id   uuid not null references public.mkt_assets(id) on delete cascade,
  primary key (content_id, asset_id)
);

drop policy if exists "read marketing assets storage" on storage.objects;
create policy "read marketing assets storage" on storage.objects
  for select to authenticated
  using (bucket_id = 'marketing-assets'
         and (storage.foldername(name))[1] = 'mkt'
         and (select public.can_read_marketing()));

drop policy if exists "write marketing assets storage" on storage.objects;
create policy "write marketing assets storage" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketing-assets'
              and (storage.foldername(name))[1] = 'mkt'
              and (select public.can_write_marketing()));


-- ------------------------------------------------------------
-- 8) الإعلانات المدفوعة — حساب ← حملة إعلانية ← مجموعة ← إعلان
--
-- «الحملة الإعلانية» عند Meta غير «الحملة» في تلال: حملة تلال
-- (لاماك — أكتوبر) قد تشغّل ثلاث حملات إعلانية. فالمستوى الأعلى هنا
-- يحمل campaign_id ويرثه ما تحته.
-- ------------------------------------------------------------
create table if not exists public.mkt_ad_objects (
  id              uuid primary key default gen_random_uuid(),
  level           text not null check (level in ('حملة إعلانية', 'مجموعة إعلانية', 'إعلان')),
  parent_id       uuid references public.mkt_ad_objects(id) on delete cascade,
  account_id      uuid not null references public.mkt_accounts(id) on delete restrict,
  campaign_id     uuid references public.crm_campaigns(id) on delete set null,
  name            text not null,
  external_id     text,
  objective       text,
  audience_id     uuid references public.mkt_audiences(id) on delete set null,
  placement       text,
  content_id      uuid references public.mkt_content(id) on delete set null,
  daily_budget    numeric check (daily_budget is null or daily_budget >= 0),
  lifetime_budget numeric check (lifetime_budget is null or lifetime_budget >= 0),
  start_date      date,
  end_date        date,
  status          text not null default 'مسودة' check (status in ('مسودة', 'نشط', 'متوقف', 'منتهٍ')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, level, external_id),
  constraint mkt_ad_objects_parent check ((level = 'حملة إعلانية') = (parent_id is null)),
  constraint mkt_ad_objects_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists mkt_ad_objects_campaign_idx on public.mkt_ad_objects (campaign_id);
create index if not exists mkt_ad_objects_parent_idx   on public.mkt_ad_objects (parent_id);

-- المستوى الأدنى يرث حملة تلال من أعلاه، ويُرفض أبٌ من مستوى خاطئ
create or replace function public.mkt_stamp_ad_object()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare p public.mkt_ad_objects%rowtype;
begin
  if new.parent_id is not null then
    select * into p from public.mkt_ad_objects where id = new.parent_id;
    if (new.level = 'مجموعة إعلانية' and p.level <> 'حملة إعلانية')
       or (new.level = 'إعلان' and p.level <> 'مجموعة إعلانية') then
      raise exception 'التسلسل: حملة إعلانية ← مجموعة إعلانية ← إعلان';
    end if;
    new.campaign_id := coalesce(new.campaign_id, p.campaign_id);
    new.account_id  := p.account_id;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_stamp_ad_object on public.mkt_ad_objects;
create trigger trg_mkt_stamp_ad_object
  before insert or update on public.mkt_ad_objects
  for each row execute function public.mkt_stamp_ad_object();


-- ------------------------------------------------------------
-- 9) المؤثرون وصفقاتهم
--
-- المؤثر شخصٌ يُدفع له، فقد يكون مورّداً (vendor_id) يُصرف له من
-- المصروفات. والصفقة مع الحملة تمرّ بمراحلها، وتسليماتها محتوىً
-- (mkt_content.influencer_deal_id) لا جدول تسليمات ثالث.
-- ------------------------------------------------------------
create table if not exists public.mkt_influencers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  channel_id      uuid references public.mkt_channels(id) on delete set null,
  username        text,
  category        text,
  audience        text,
  followers       int check (followers is null or followers >= 0),
  avg_views       int check (avg_views is null or avg_views >= 0),
  engagement_rate numeric check (engagement_rate is null or engagement_rate between 0 and 100),
  location        text,
  demographics    text,
  phone           text,
  email           text,
  manager_name    text,
  manager_phone   text,
  base_rate       numeric check (base_rate is null or base_rate >= 0),
  vendor_id       uuid references public.suppliers(id) on delete set null,
  rating          int check (rating is null or rating between 1 and 5),
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (channel_id, username)
);

create table if not exists public.mkt_influencer_deals (
  id                 uuid primary key default gen_random_uuid(),
  influencer_id      uuid not null references public.mkt_influencers(id) on delete restrict,
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  stage              text not null default 'بحث' check (stage in (
                       'بحث', 'قائمة مختصرة', 'تواصل', 'تفاوض', 'معتمد', 'عقد', 'محتوى',
                       'منشور', 'نتائج', 'دفع', 'تقييم', 'ملغى')),
  quoted_rate        numeric check (quoted_rate is null or quoted_rate >= 0),
  negotiated_rate    numeric check (negotiated_rate is null or negotiated_rate >= 0),
  deliverables_count int not null default 1 check (deliverables_count >= 0),
  deliverables       text,
  due_date           date,
  contract_asset_id  uuid references public.mkt_assets(id) on delete set null,
  evaluation         text,
  rating             int check (rating is null or rating between 1 and 5),
  approved_at        timestamptz,
  approved_by        uuid references auth.users(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists mkt_influencer_deals_campaign_idx on public.mkt_influencer_deals (campaign_id);
create index if not exists mkt_influencer_deals_inf_idx      on public.mkt_influencer_deals (influencer_id);

alter table public.mkt_content
  add column if not exists influencer_deal_id uuid references public.mkt_influencer_deals(id) on delete set null;

create or replace function public.mkt_guard_deal()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
        v_order text[] := array['بحث','قائمة مختصرة','تواصل','تفاوض','معتمد','عقد','محتوى',
                                'منشور','نتائج','دفع','تقييم'];
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    -- ما بعد «تفاوض» لا يُبلَغ بلا اعتماد: هنا يبدأ الالتزام بالمال
    if array_position(v_order, new.stage) >= array_position(v_order, 'معتمد')
       and new.approved_at is null and not v_flag and not public.is_marketing_manager() then
      raise exception 'صفقة المؤثر تحتاج اعتماداً قبل «%» — اطلب الموافقة', new.stage;
    end if;
    if new.stage = 'معتمد' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;
  elsif tg_op = 'INSERT' and new.stage not in ('بحث', 'قائمة مختصرة', 'تواصل', 'تفاوض')
        and not public.is_marketing_manager() then
    new.stage := 'تفاوض';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_deal on public.mkt_influencer_deals;
create trigger trg_mkt_guard_deal
  before insert or update on public.mkt_influencer_deals
  for each row execute function public.mkt_guard_deal();


-- ------------------------------------------------------------
-- 10) التسويق الميداني والفعاليات والمعارض — جدولٌ واحد بنوعه
--
-- اللوحة الإعلانية والمعرض يشتركان في كل شيء تقريباً: مكان، مورّد،
-- مدّة، كلفة، مسؤول، رمز تتبّع، نتائج. والفعالية تضيف الزوّار والجناح.
-- فالفرق نوعٌ لا جدول — و«الفئة» تُشتقّ من النوع.
-- ------------------------------------------------------------
create sequence if not exists public.mkt_activity_code_seq;

create table if not exists public.mkt_activities (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique
                    default ('act-' || lpad(nextval('public.mkt_activity_code_seq')::text, 4, '0')),
  kind              text not null check (kind in (
                      'لوحة إعلانية', 'إعلان طرق', 'مول', 'معرض', 'معرض عقاري', 'فعالية',
                      'تجهيز مركز المبيعات', 'بانرات', 'أعلام', 'بروشورات', 'فلايرات',
                      'بطاقات عمل', 'إعلان مطبوع', 'مجلة', 'صحيفة', 'راديو', 'تلفزيون',
                      'تغليف مركبات', 'تفعيل ميداني', 'تفعيل شارع', 'لافتات المشروع',
                      'تجهيز موقع البناء', 'لافتات إرشادية', 'هدايا ترويجية')),
  category          text generated always as (
                      case when kind in ('معرض', 'معرض عقاري', 'فعالية') then 'فعالية' else 'ميداني' end
                    ) stored,
  title             text not null,
  campaign_id       uuid references public.crm_campaigns(id) on delete set null,
  project_id        uuid references public.projects(id) on delete set null,
  channel_id        uuid references public.mkt_channels(id) on delete set null,
  vendor_id         uuid references public.suppliers(id) on delete set null,
  city              text,
  location          text,
  venue             text,
  start_date        date,
  end_date          date,
  budget            numeric check (budget is null or budget >= 0),
  quantity          numeric check (quantity is null or quantity >= 0),
  dimensions        text,
  audience          text,
  objective         text,
  responsible_employee_id uuid references public.employees(id) on delete set null,
  status            text not null default 'مخطط' check (status in (
                      'مخطط', 'بانتظار الموافقة', 'معتمد', 'قيد التنفيذ', 'نشط', 'منتهٍ', 'ملغى')),
  expected_visitors int check (expected_visitors is null or expected_visitors >= 0),
  actual_visitors   int check (actual_visitors is null or actual_visitors >= 0),
  booth             text,
  sponsors          text,
  results           text,
  notes             text,
  approved_at       timestamptz,
  approved_by       uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mkt_activities_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists mkt_activities_campaign_idx on public.mkt_activities (campaign_id);
create index if not exists mkt_activities_project_idx  on public.mkt_activities (project_id);
create index if not exists mkt_activities_dates_idx    on public.mkt_activities (start_date, end_date);

create table if not exists public.mkt_activity_staff (
  activity_id uuid not null references public.mkt_activities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role        text,
  primary key (activity_id, employee_id)
);

alter table public.mkt_assets
  add column if not exists activity_id uuid references public.mkt_activities(id) on delete set null;
create index if not exists mkt_assets_activity_idx on public.mkt_assets (activity_id);

create or replace function public.mkt_guard_activity()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status not in ('مخطط') and not v_flag and not public.is_marketing_manager() then
      new.status := 'مخطط';
    end if;
  elsif new.status is distinct from old.status then
    if old.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'النشاط بانتظار الموافقة — اسحب الطلب أو انتظر القرار';
    elsif new.status = 'بانتظار الموافقة' and not v_flag then
      raise exception 'طلب اعتماد النشاط من زرّ «اطلب الموافقة»';
    elsif new.status = 'معتمد' and not v_flag and not public.is_marketing_manager() then
      raise exception 'اعتماد النشاط لمدير التسويق';
    elsif new.status in ('قيد التنفيذ', 'نشط', 'منتهٍ') and old.approved_at is null
          and not public.is_marketing_manager() then
      raise exception 'النشاط لم يُعتمد بعد';
    end if;
    if new.status = 'معتمد' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_activity on public.mkt_activities;
create trigger trg_mkt_guard_activity
  before insert or update on public.mkt_activities
  for each row execute function public.mkt_guard_activity();


-- ------------------------------------------------------------
-- 11) مهامّ التسويق
--
-- ⚠️ جدولٌ منفصل عن tasks عمداً، وهو القرار الوحيد هنا بإنشاء ما
--    يشبه موجوداً. tasks جدول الـCRM: مربوط بالعميل والفرصة، وحالاته
--    أربع بلا «مراجعة» ولا «معطّلة»، وعليه محفّز crm_event_facts
--    (096) — فمهمّة تصميم بروشور كانت ستدخل تقارير أداء المبيعات.
--    وفصلُهما أصدق من خلطهما بعمود «وحدة».
-- ------------------------------------------------------------
create table if not exists public.mkt_tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  campaign_id    uuid references public.crm_campaigns(id) on delete set null,
  content_id     uuid references public.mkt_content(id) on delete cascade,
  activity_id    uuid references public.mkt_activities(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  assignee_id    uuid references public.employees(id) on delete set null,
  priority       text not null default 'عادية' check (priority in ('عاجلة', 'متوسطة', 'عادية')),
  due_date       date,
  status         text not null default 'للتنفيذ'
                 check (status in ('للتنفيذ', 'قيد التنفيذ', 'مراجعة', 'معطّلة', 'منجزة')),
  depends_on     uuid references public.mkt_tasks(id) on delete set null,
  checklist      jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  blocked_reason text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  constraint mkt_tasks_not_self check (depends_on is null or depends_on <> id)
);
create index if not exists mkt_tasks_assignee_idx on public.mkt_tasks (assignee_id, status);
create index if not exists mkt_tasks_campaign_idx on public.mkt_tasks (campaign_id);
create index if not exists mkt_tasks_due_idx      on public.mkt_tasks (due_date) where status <> 'منجزة';


-- ------------------------------------------------------------
-- 12) الإشعارات — مستلمون بالدور
-- ------------------------------------------------------------
-- 'المدير' · 'المالية' · 'مدير المتابعة' · 'المسؤول' (صاحب الكيان) · أي دور في mkt_team.
-- مدير التسويق والمالية يسقطان إلى المدير إن لم يوجد من يحملهما —
-- فلا يضيع تنبيهٌ لأن الدور شاغر.
create or replace function public.mkt_recipients(p_roles text[], p_owner uuid default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  with r as (
    select p.id from public.profiles p where 'المدير' = any(p_roles) and p.role = 'admin'
    union
    select p.id from public.profiles p where 'المالية' = any(p_roles) and p.role = 'accountant'
    union
    select p.id from public.profiles p
     where 'المالية' = any(p_roles) and p.role = 'admin'
       and not exists (select 1 from public.profiles a where a.role = 'accountant')
    union
    select p.id from public.profiles p where 'مدير المتابعة' = any(p_roles) and p.role = 'followup_manager'
    union
    select e.user_id from public.mkt_team t join public.employees e on e.id = t.employee_id
     where t.is_active and e.user_id is not null and t.mkt_role = any(p_roles)
    union
    select p.id from public.profiles p
     where 'مدير التسويق' = any(p_roles) and p.role = 'admin'
       and not exists (select 1 from public.mkt_team t where t.is_active and t.mkt_role = 'مدير التسويق')
    union
    select e.user_id from public.employees e
     where 'المسؤول' = any(p_roles) and e.id = p_owner and e.user_id is not null
  )
  select id from r where id is not null;
$$;

create or replace function public.mkt_notify(
  p_roles text[], p_owner uuid, p_title text, p_body text, p_link text,
  p_entity uuid default null, p_priority text default 'عادية'
) returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
  select distinct u, p_title, p_body, p_link, 'تسويق', p_entity, p_priority, 'تسويق', 'marketing'
    from public.mkt_recipients(p_roles, p_owner) u;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.mkt_recipients(text[], uuid) from public, anon, authenticated;
revoke all on function public.mkt_notify(text[], uuid, text, text, text, uuid, text) from public, anon, authenticated;

-- المكلَّف بمهمّة يعرف بها لحظة إسنادها
create or replace function public.mkt_notify_task()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.mkt_notify(array['المسؤول'], new.assignee_id,
      'مهمّة تسويق جديدة', new.title ||
        coalesce(' — موعدها ' || new.due_date::text, ''),
      '/dashboard/marketing/tasks', new.id,
      case when new.priority = 'عاجلة' then 'عالية' else 'عادية' end);
  end if;
  if new.status = 'منجزة' and (tg_op = 'INSERT' or old.status <> 'منجزة') then
    new.completed_at := now();
  elsif new.status <> 'منجزة' then
    new.completed_at := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_notify_task on public.mkt_tasks;
create trigger trg_mkt_notify_task
  before insert or update on public.mkt_tasks
  for each row execute function public.mkt_notify_task();


-- ------------------------------------------------------------
-- 13) الموافقات — مسارٌ واحد لكل ما يُعتمد
--
-- القاعدة تختار المعتمِد بالنوع والمبلغ: أعلى عتبةٍ لا تتجاوز المبلغ.
-- وطالب الموافقة لا يوافق على طلبه (إلا المدير) — فصل الواجبات
-- كما في الكشوف (068).
-- ------------------------------------------------------------
create table if not exists public.mkt_approval_rules (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in
                ('حملة', 'خطة', 'محتوى', 'مؤثر', 'نشاط', 'ميزانية', 'مصروف', 'شراء')),
  min_amount  numeric not null default 0 check (min_amount >= 0),
  approver    text not null check (approver in ('مدير التسويق', 'المدير', 'المالية')),
  is_active   boolean not null default true,
  unique (entity_type, min_amount)
);

insert into public.mkt_approval_rules (entity_type, min_amount, approver) values
  ('حملة',     0,        'مدير التسويق'),
  ('حملة',     10000000, 'المدير'),
  ('خطة',      0,        'المدير'),
  ('محتوى',    0,        'مدير التسويق'),
  ('مؤثر',     0,        'مدير التسويق'),
  ('مؤثر',     5000000,  'المدير'),
  ('نشاط',     0,        'مدير التسويق'),
  ('نشاط',     10000000, 'المدير'),
  ('ميزانية',  0,        'المدير'),
  ('مصروف',    0,        'مدير التسويق'),
  ('مصروف',    2000000,  'المدير'),
  ('شراء',     0,        'مدير التسويق'),
  ('شراء',     2000000,  'المدير')
on conflict (entity_type, min_amount) do nothing;

create table if not exists public.mkt_approvals (
  id                uuid primary key default gen_random_uuid(),
  entity_type       text not null check (entity_type in
                      ('حملة', 'خطة', 'محتوى', 'مؤثر', 'نشاط', 'ميزانية', 'مصروف', 'شراء')),
  entity_id         uuid not null,
  title             text not null,
  amount            numeric,
  approver          text not null,
  escalated_reason  text,
  status            text not null default 'معلّق' check (status in ('معلّق', 'موافق', 'مرفوض', 'ملغى')),
  note              text,
  requested_by      uuid references auth.users(id) on delete set null,
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  decided_by        uuid references auth.users(id) on delete set null,
  decided_by_name   text,
  decided_at        timestamptz,
  reason            text
);
create unique index if not exists mkt_approvals_one_open
  on public.mkt_approvals (entity_type, entity_id) where status = 'معلّق';
create index if not exists mkt_approvals_entity_idx on public.mkt_approvals (entity_type, entity_id);
create index if not exists mkt_approvals_status_idx on public.mkt_approvals (status, requested_at);

create or replace function public.mkt_my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.my_employee_name(),
                  (select p.email from public.profiles p where p.id = auth.uid()));
$$;
revoke all on function public.mkt_my_name() from public, anon;
grant execute on function public.mkt_my_name() to authenticated;

-- عنوان الكيان ومبلغه وحالته — نقطة واحدة تعرف كل الأنواع.
-- ⚠️ الميزانية والمصروف والشراء جداول 122: تُقرأ هنا وقت التنفيذ فقط.
create or replace function public.mkt_entity_info(p_type text, p_id uuid,
  out title text, out amount numeric, out link text, out owner uuid, out escalate text)
language plpgsql stable security definer set search_path = public as $fn$
declare v_budget numeric; v_spent numeric; v_camp uuid;
begin
  escalate := null;
  if p_type = 'حملة' then
    select c.name, c.budget, c.owner_employee_id into title, amount, owner
      from public.crm_campaigns c where c.id = p_id;
    link := '/dashboard/marketing/campaigns/' || p_id;
  elsif p_type = 'خطة' then
    select p.title, p.budget, p.owner_employee_id into title, amount, owner
      from public.mkt_plans p where p.id = p_id;
    link := '/dashboard/marketing/plans/' || p_id;
  elsif p_type = 'محتوى' then
    select c.title, null::numeric, c.owner_id into title, amount, owner
      from public.mkt_content c where c.id = p_id;
    link := '/dashboard/marketing/content/' || p_id;
  elsif p_type = 'مؤثر' then
    select i.name || ' — ' || coalesce(cp.name, 'بلا حملة'),
           coalesce(d.negotiated_rate, d.quoted_rate), null::uuid
      into title, amount, owner
      from public.mkt_influencer_deals d
      join public.mkt_influencers i on i.id = d.influencer_id
      left join public.crm_campaigns cp on cp.id = d.campaign_id
     where d.id = p_id;
    link := '/dashboard/marketing/influencers';
  elsif p_type = 'نشاط' then
    select a.title, a.budget, a.responsible_employee_id into title, amount, owner
      from public.mkt_activities a where a.id = p_id;
    link := '/dashboard/marketing/offline/' || p_id;
  elsif p_type = 'ميزانية' then
    execute 'select name, planned, null::uuid from public.mkt_budgets where id = $1'
      into title, amount, owner using p_id;
    link := '/dashboard/marketing/budget';
  elsif p_type = 'مصروف' then
    execute 'select code || '' — '' || description, amount_iqd, employee_id, campaign_id
               from public.mkt_expenses where id = $1'
      into title, amount, owner, v_camp using p_id;
    link := '/dashboard/marketing/expenses';
    -- مصروفٌ يتجاوز ميزانية حملته يُرفع إلى المدير مهما صغر
    if v_camp is not null then
      select c.budget into v_budget from public.crm_campaigns c where c.id = v_camp;
      execute 'select coalesce(sum(amount_iqd), 0) from public.mkt_expenses
                where campaign_id = $1 and status in (''معتمد'', ''مدفوع'')'
        into v_spent using v_camp;
      if v_budget is not null and v_spent + coalesce(amount, 0) > v_budget then
        escalate := 'يتجاوز ميزانية الحملة (' || public.fmt_qty(v_spent + amount) ||
                    ' من ' || public.fmt_qty(v_budget) || ')';
      end if;
    end if;
  elsif p_type = 'شراء' then
    execute 'select item_name || '' × '' || quantity, estimated_cost, null::uuid
               from public.mkt_purchase_requests where id = $1'
      into title, amount, owner using p_id;
    link := '/dashboard/marketing/procurement';
  end if;
end;
$fn$;

-- نقل الكيان إلى حالة الطلب/الاعتماد/الرفض — الحرّاس تمرّ بالعلَم
create or replace function public.mkt_apply_approval_state(p_type text, p_id uuid, p_phase text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform set_config('tilal.mkt_approval', 'on', true);
  if p_type = 'حملة' then
    update public.crm_campaigns set status = case p_phase
      when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمدة' else 'مسودة' end
     where id = p_id;
  elsif p_type = 'خطة' then
    update public.mkt_plans set status = case p_phase
      when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمدة' else 'مسودة' end,
      approved_at = case when p_phase = 'approved' then now() else approved_at end,
      approved_by = case when p_phase = 'approved' then auth.uid() else approved_by end,
      updated_at = now()
     where id = p_id;
  elsif p_type = 'محتوى' then
    update public.mkt_content set status = case p_phase
      when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمد' else 'مرفوض' end
     where id = p_id;
  elsif p_type = 'مؤثر' then
    if p_phase = 'approved' then
      update public.mkt_influencer_deals set stage = 'معتمد' where id = p_id;
    end if;
  elsif p_type = 'نشاط' then
    update public.mkt_activities set status = case p_phase
      when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمد' else 'مخطط' end
     where id = p_id;
  elsif p_type = 'ميزانية' then
    execute 'update public.mkt_budgets set status = $2,
               approved = case when $3 then planned else approved end
              where id = $1'
      using p_id,
            case p_phase when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمدة' else 'مسودة' end,
            p_phase = 'approved';
  elsif p_type = 'مصروف' then
    execute 'update public.mkt_expenses set status = $2,
               approved_at = case when $3 then now() else approved_at end,
               approved_by = case when $3 then auth.uid() else approved_by end
              where id = $1'
      using p_id,
            case p_phase when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمد' else 'مرفوض' end,
            p_phase = 'approved';
  elsif p_type = 'شراء' then
    execute 'update public.mkt_purchase_requests set status = $2 where id = $1'
      using p_id,
            case p_phase when 'pending' then 'بانتظار الموافقة' when 'approved' then 'معتمد' else 'مرفوض' end;
  end if;
  perform set_config('tilal.mkt_approval', 'off', true);
end;
$fn$;

revoke all on function public.mkt_entity_info(text, uuid) from public, anon, authenticated;
revoke all on function public.mkt_apply_approval_state(text, uuid, text) from public, anon, authenticated;

create or replace function public.mkt_request_approval(p_type text, p_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  info record; v_approver text; v_id uuid;
begin
  if not public.can_write_marketing() then
    raise exception 'طلب الموافقة لفريق التسويق';
  end if;

  select * into info from public.mkt_entity_info(p_type, p_id);
  if info.title is null then
    raise exception 'الكيان غير موجود';
  end if;
  if exists (select 1 from public.mkt_approvals
              where entity_type = p_type and entity_id = p_id and status = 'معلّق') then
    raise exception 'طلب موافقة معلّق سلفاً على «%»', info.title;
  end if;

  select r.approver into v_approver
    from public.mkt_approval_rules r
   where r.entity_type = p_type and r.is_active and r.min_amount <= coalesce(info.amount, 0)
   order by r.min_amount desc limit 1;
  v_approver := coalesce(v_approver, 'المدير');
  if info.escalate is not null then
    v_approver := 'المدير';
  end if;

  insert into public.mkt_approvals
    (entity_type, entity_id, title, amount, approver, escalated_reason, note,
     requested_by, requested_by_name)
  values (p_type, p_id, info.title, info.amount, v_approver, info.escalate, p_note,
          auth.uid(), public.mkt_my_name())
  returning id into v_id;

  perform public.mkt_apply_approval_state(p_type, p_id, 'pending');

  perform public.mkt_notify(
    case v_approver when 'المدير' then array['المدير']
                    when 'المالية' then array['المالية']
                    else array['مدير التسويق'] end,
    null, 'بانتظار موافقتك: ' || p_type,
    info.title || coalesce(' — ' || public.fmt_qty(info.amount) || ' د.ع', '') ||
      coalesce(' · ' || info.escalate, ''),
    '/dashboard/marketing/approvals', v_id, 'عالية');

  return v_id;
end;
$fn$;

create or replace function public.mkt_decide_approval(p_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.mkt_approvals%rowtype; info record;
begin
  select * into a from public.mkt_approvals where id = p_id for update;
  if not found then raise exception 'طلب الموافقة غير موجود'; end if;
  if a.status <> 'معلّق' then raise exception 'الطلب % سلفاً', a.status; end if;

  if not (public.is_admin()
          or (a.approver = 'مدير التسويق' and public.is_marketing_manager())
          or (a.approver = 'المالية' and public.can_manage_finance())) then
    raise exception 'هذا الطلب يعتمده: %', a.approver;
  end if;
  if a.requested_by = auth.uid() and not public.is_admin() then
    raise exception 'لا يُعتمد الطلب ممّن طلبه — فصل الواجبات';
  end if;
  if not p_approve and coalesce(btrim(p_reason), '') = '' then
    raise exception 'اكتب سبب الرفض — يصل إلى من طلب';
  end if;

  update public.mkt_approvals
     set status = case when p_approve then 'موافق' else 'مرفوض' end,
         decided_by = auth.uid(), decided_by_name = public.mkt_my_name(),
         decided_at = now(), reason = nullif(btrim(p_reason), '')
   where id = p_id;

  perform public.mkt_apply_approval_state(a.entity_type, a.entity_id,
    case when p_approve then 'approved' else 'rejected' end);

  select * into info from public.mkt_entity_info(a.entity_type, a.entity_id);
  insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
  select a.requested_by,
         case when p_approve then 'اعتُمد: ' else 'رُفض: ' end || a.entity_type,
         a.title || coalesce(' — ' || nullif(btrim(p_reason), ''), ''),
         info.link, 'تسويق', a.entity_id, 'عادية', 'تسويق', 'marketing'
   where a.requested_by is not null;

  -- المصروف المعتمد ينتظر الدفع: المالية تعرف
  if p_approve and a.entity_type = 'مصروف' then
    perform public.mkt_notify(array['المالية'], null, 'مصروف تسويق معتمد بانتظار الدفع',
      a.title || ' — ' || public.fmt_qty(a.amount) || ' د.ع',
      '/dashboard/marketing/expenses?status=معتمد', a.entity_id, 'عالية');
  end if;
end;
$fn$;

create or replace function public.mkt_cancel_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.mkt_approvals%rowtype;
begin
  select * into a from public.mkt_approvals where id = p_id for update;
  if not found or a.status <> 'معلّق' then raise exception 'لا طلب معلّق'; end if;
  if a.requested_by is distinct from auth.uid() and not public.is_marketing_manager() then
    raise exception 'يسحب الطلبَ من طلبه أو مدير التسويق';
  end if;
  update public.mkt_approvals set status = 'ملغى', decided_by = auth.uid(),
         decided_by_name = public.mkt_my_name(), decided_at = now()
   where id = p_id;
  perform public.mkt_apply_approval_state(a.entity_type, a.entity_id, 'rejected');
end;
$fn$;

revoke all on function public.mkt_request_approval(text, uuid, text) from public, anon;
revoke all on function public.mkt_decide_approval(uuid, boolean, text) from public, anon;
revoke all on function public.mkt_cancel_approval(uuid)               from public, anon;
grant execute on function public.mkt_request_approval(text, uuid, text) to authenticated;
grant execute on function public.mkt_decide_approval(uuid, boolean, text) to authenticated;
grant execute on function public.mkt_cancel_approval(uuid)               to authenticated;


-- ------------------------------------------------------------
-- 14) الموردون — موردو التسويق في جدول الموردين نفسه
-- ------------------------------------------------------------
alter table public.suppliers
  add column if not exists is_marketing boolean not null default false,
  add column if not exists services     text[] not null default '{}',
  add column if not exists email        text,
  add column if not exists rating       int check (rating is null or rating between 1 and 5),
  add column if not exists contract_notes text;

comment on column public.suppliers.is_marketing is
  'مورّد تسويق (وكالة، مطبعة، مؤثر، مصوّر…). التسويق يرى ويكتب هؤلاء وحدهم؛ بقيّة الموردين للمخزون.';

-- سياستان تُضافان ولا تُعدَّل القائمتان (السياسات المتعدّدة تُجمع بـ OR)
drop policy if exists "marketing reads marketing suppliers" on public.suppliers;
create policy "marketing reads marketing suppliers" on public.suppliers
  for select to authenticated
  using (is_marketing and (select public.can_read_marketing_money()));

drop policy if exists "marketing writes marketing suppliers" on public.suppliers;
create policy "marketing writes marketing suppliers" on public.suppliers
  for insert to authenticated
  with check (is_marketing and (select public.can_write_marketing()));

drop policy if exists "marketing updates marketing suppliers" on public.suppliers;
create policy "marketing updates marketing suppliers" on public.suppliers
  for update to authenticated
  using (is_marketing and (select public.can_write_marketing()))
  with check (is_marketing and (select public.can_write_marketing()));


-- ------------------------------------------------------------
-- 15) RLS — النمط الواحد لجداول القسم
--
--   القراءة   can_read_marketing()
--   الكتابة   can_write_marketing()
--   الحذف     is_marketing_manager() — الحذف قرار، والأصل الإلغاء/الأرشفة
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'mkt_channels', 'mkt_audiences', 'mkt_competitors', 'mkt_plans', 'mkt_objectives',
    'mkt_campaign_channels', 'mkt_accounts', 'mkt_content', 'mkt_assets', 'mkt_content_assets',
    'mkt_ad_objects', 'mkt_influencers', 'mkt_influencer_deals', 'mkt_activities',
    'mkt_activity_staff', 'mkt_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "mkt read" on public.%I', t);
    execute format('create policy "mkt read" on public.%I for select to authenticated
                      using ((select public.can_read_marketing()))', t);
    execute format('drop policy if exists "mkt insert" on public.%I', t);
    execute format('create policy "mkt insert" on public.%I for insert to authenticated
                      with check ((select public.can_write_marketing()))', t);
    execute format('drop policy if exists "mkt update" on public.%I', t);
    execute format('create policy "mkt update" on public.%I for update to authenticated
                      using ((select public.can_write_marketing()))
                      with check ((select public.can_write_marketing()))', t);
    execute format('drop policy if exists "mkt delete" on public.%I', t);
    execute format('create policy "mkt delete" on public.%I for delete to authenticated
                      using ((select public.is_marketing_manager()))', t);
  end loop;
end $$;

-- القنوات: قراءتها لكل موظف (اسم القناة يظهر في مصدر الليد عند المبيعات)
drop policy if exists "mkt read" on public.mkt_channels;
create policy "mkt read" on public.mkt_channels
  for select to authenticated using (true);

-- الفريق: يقرؤه القسم والموارد البشرية، ويُديره مدير التسويق
alter table public.mkt_team enable row level security;
drop policy if exists "read mkt team" on public.mkt_team;
create policy "read mkt team" on public.mkt_team
  for select to authenticated
  using ((select public.can_read_marketing()) or (select public.can_manage_hr()));
drop policy if exists "manage mkt team" on public.mkt_team;
create policy "manage mkt team" on public.mkt_team
  for all to authenticated
  using ((select public.is_marketing_manager()))
  with check ((select public.is_marketing_manager()));

-- النسخ يكتبها المحفّز وحده
alter table public.mkt_content_versions enable row level security;
drop policy if exists "read content versions" on public.mkt_content_versions;
create policy "read content versions" on public.mkt_content_versions
  for select to authenticated using ((select public.can_read_marketing()));

-- الموافقات: تُقرأ، وتُكتب بالدوالّ وحدها
alter table public.mkt_approvals enable row level security;
drop policy if exists "read approvals" on public.mkt_approvals;
create policy "read approvals" on public.mkt_approvals
  for select to authenticated using ((select public.can_read_marketing_money()));

alter table public.mkt_approval_rules enable row level security;
drop policy if exists "read approval rules" on public.mkt_approval_rules;
create policy "read approval rules" on public.mkt_approval_rules
  for select to authenticated using ((select public.can_read_marketing_money()));
drop policy if exists "admin approval rules" on public.mkt_approval_rules;
create policy "admin approval rules" on public.mkt_approval_rules
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- ------------------------------------------------------------
-- 16) التدقيق — كل ما فيه قرار أو مال
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'mkt_team', 'mkt_channels', 'mkt_plans', 'mkt_objectives', 'mkt_content', 'mkt_assets',
    'mkt_ad_objects', 'mkt_influencers', 'mkt_influencer_deals', 'mkt_activities',
    'mkt_approvals', 'mkt_approval_rules', 'mkt_campaign_channels', 'mkt_tasks'
  ] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.audit_row()', t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 17) التحقّق
-- ------------------------------------------------------------
do $$
declare n_ch int; n_unmapped int; n_camp int;
begin
  raise notice '--- 121 التسويق ١ ---';
  select count(*), count(*) filter (where source_id is null) into n_ch, n_unmapped from public.mkt_channels;
  raise notice 'القنوات: % (بلا مصدر CRM: % — تُصنَّف في تقارير الـCRM بمصدر الليد كما يُدخَل)', n_ch, n_unmapped;
  select count(*) into n_camp from public.crm_campaigns;
  raise notice 'الحملات القائمة المُرحَّلة: % (لكلٍّ رمز وحالة)', n_camp;
  if not exists (select 1 from storage.buckets where id = 'marketing-assets') then
    raise warning 'دلو marketing-assets لم يُنشأ — راجع صلاحيات storage.';
  end if;
  if not exists (select 1 from public.mkt_team where mkt_role = 'مدير التسويق' and is_active) then
    raise notice 'لا «مدير تسويق» في الفريق بعد: الموافقات تذهب إلى المدير حتى يُعيَّن.';
  end if;
end $$;

notify pgrst, 'reload schema';
