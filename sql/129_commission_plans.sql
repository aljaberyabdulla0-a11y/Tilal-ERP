-- ============================================================
-- تلال ERP — 129: محرّك العمولات — خطط المشروع، الشرائح الرجعية والحدّية، المستحقّ/القابل للدفع/المدفوع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- التصميم: docs/BROKERAGE_V2_DESIGN.md (القسم H).
--
-- ===== أربع طبقات لا تختلط =====
--   المطوّر → تلال     sale_commissions.company_*   (048 — كما هي، تعدّ كل المبيعات)
--   تلال → الوسيط      broker_commissions           خطة «وسيط»
--   تلال → الموظف      sale_commissions.employee_*  خطة «موظف مباشر» وإلا قواعد 048
--   تلال → الـRM       sale_commissions.employee_*  خطة «مدير علاقات» وإلا قواعد 048 المعلَّمة «وسيط»
--   والعرض commission_ledger يجمعها بأعمدة واحدة — لا جدول رابع يكرّرها.
--
-- ===== الدلو =====
--   (الخطة، المستفيد، مفتاح الفترة). البيع المباشر لا يدخل دلو وسيط والعكس،
--   وشركة A لا تمسّ شريحة B.
--
-- ===== تغيّرات على قواعد قائمة =====
--   ١) broker_commission_tiers يتقاعد: صفوفه تُنقل خططاً («شرائح رجعية»، عدد،
--      شهري) — نفس سلوك 117 حرفياً — ويبقى الجدول ولا يُقرأ.
--   ٢) عمولة الوسيط لا تُصرف قبل قاعدة خطتها (الافتراضي: بعد تحصيل تلال
--      عمولتها من المطوّر)، ولا فوق المستحق، والاسترداد حركة مقيّدة.
--   ٣) صفقة الوسيط لا تمرّ بقواعد البيع المباشر: للـRM عمولة داخلية فقط إن
--      عُرّفت خطة «مدير علاقات» أو قاعدة 048 بقناة «وسيط». (صفر صفقات وسيط حيّة.)
--   ٤) فرق شريحة الموظف بعد تأكيد المقدمة لا يُعدّل صفّ commissions مُرحَّلاً:
--      يُصدَر صفٌّ جديد (موجب) أو استقطاع (سالب).
--
-- ===== التراجع =====
--   أعد دوالّ 117 (post_broker_commission, recompute_broker_tier,
--   sync_broker_deal_price, recalc_broker_commissions, reverse_sale) ودوالّ
--   069/120 (record_sale_commission, set_sale_employee)، واحذف المحفّزات
--   trg_guard_broker_payment و trg_broker_payable_*. الجداول الجديدة لا تمسّ القديمة.
--
-- يتطلب: 048، 056، 103، 113، 117، 120، 128. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الخطط وشرائحها
-- ------------------------------------------------------------
create table if not exists public.commission_plans (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('وسيط', 'موظف مباشر', 'مدير علاقات')),
  company_id     uuid references public.broker_companies(id) on delete cascade,
  employee_id    uuid references public.employees(id) on delete cascade,
  formula        text not null default 'شرائح رجعية'
                 check (formula in ('شرائح رجعية', 'شرائح حدّية', 'ثابتة')),
  basis          text not null default 'عدد الوحدات'
                 check (basis in ('عدد الوحدات', 'قيمة المبيعات')),
  period         text not null default 'شهري'
                 check (period in ('شهري', 'ربعي', 'سنوي', 'عمر المشروع')),
  payable_rule   text not null default 'بعد تحصيل عمولة تلال'
                 check (payable_rule in ('عند الاستحقاق', 'بعد تأكيد المقدمة', 'بعد تحصيل عمولة تلال')),
  is_active      boolean not null default true,
  name           text,
  notes          text,
  constraint commission_plans_company_chk  check (company_id is null or recipient_type = 'وسيط'),
  constraint commission_plans_employee_chk check (employee_id is null or recipient_type <> 'وسيط')
);

-- خطةٌ نشطة واحدة لكل (مشروع × نوع × شركة|موظف)
create unique index if not exists commission_plans_one_active
  on public.commission_plans (project_id, recipient_type,
    coalesce(company_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;

comment on table public.commission_plans is
  'خطة عمولة لكل مشروع ونوع مستفيد (sql/129). company_id/employee_id = خطة خاصة تحلّ محلّ خطة المشروع كلّها. payable_rule تُطبَّق على الوسيط؛ الموظف قابلٌ للدفع من تأكيد المقدمة (120).';

create table if not exists public.commission_plan_tiers (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.commission_plans(id) on delete cascade,
  min_units    int     check (min_units is null or min_units > 0),
  min_value    numeric check (min_value is null or min_value >= 0),
  unit_type    text,
  rate         numeric(7,4) check (rate is null or (rate >= 0 and rate <= 100)),
  fixed_amount numeric      check (fixed_amount is null or fixed_amount >= 0),
  constraint commission_plan_tiers_value_chk check (rate is not null or fixed_amount is not null)
);

create index if not exists cpt_plan_idx on public.commission_plan_tiers (plan_id);

comment on table public.commission_plan_tiers is
  'شريحة: من العتبة (min_units لأساس العدد، min_value لأساس القيمة) فصاعداً — نسبة ٪ من سعر الصفقة و/أو مبلغ ثابت لكل وحدة. unit_type يقصرها على نوع وحدة؛ إن وُجدت شرائح لنوع الوحدة حلّت محلّ العامة (sql/129).';

alter table public.commission_plans      enable row level security;
alter table public.commission_plan_tiers enable row level security;

-- القراءة: الإدارة كلّها؛ الموظف خطط الموظفين العامة وخطّته؛ المشرف والـRM خطط
-- مشاريعهم؛ الوسيط خطط «وسيط» في مشاريعه (العامة وخاصّته). الكتابة بالدالّة وحدها.
drop policy if exists "read commission plans" on public.commission_plans;
create policy "read commission plans" on public.commission_plans
  for select to authenticated
  using (
    (select public.is_admin())
    or (not (select public.is_broker()) and recipient_type <> 'وسيط'
        and (employee_id is null or employee_id = (select public.my_employee_id())))
    or (not (select public.is_broker()) and (
          project_id in (select s.id from public.my_supervised_projects() s)
          or project_id in (select bcp.project_id from public.broker_company_projects bcp
                             where bcp.rm_id = (select public.my_employee_id()))))
    or (recipient_type = 'وسيط'
        and project_id in (select p.project_id from public.my_broker_projects() p)
        and (company_id is null or company_id = (select public.my_broker_company())))
  );

drop policy if exists "read commission plan tiers" on public.commission_plan_tiers;
create policy "read commission plan tiers" on public.commission_plan_tiers
  for select to authenticated
  using (plan_id in (select p.id from public.commission_plans p));


-- ------------------------------------------------------------
-- 2) أدوات المحرّك
-- ------------------------------------------------------------
create or replace function public.commission_period_key(p_period text, p_date date)
returns text language sql stable as $fn$
  select case p_period
    when 'شهري' then to_char(p_date, 'YYYY-MM')
    when 'ربعي' then to_char(p_date, 'YYYY') || '-Q' || extract(quarter from p_date)::int
    when 'سنوي' then to_char(p_date, 'YYYY')
    else 'الكل'
  end;
$fn$;

-- نسبة الشريحة ومبلغها الثابت عند قياسٍ ما (عدد أو قيمة) لنوع وحدة
create or replace function public.commission_plan_rate(p_plan uuid, p_measure numeric, p_unit_type text)
returns table (rate numeric, fixed_amount numeric)
language sql stable security definer set search_path = public as $fn$
  with p as (select c.basis from public.commission_plans c where c.id = p_plan),
  t as (select ct.* from public.commission_plan_tiers ct where ct.plan_id = p_plan),
  typed as (select * from t where t.unit_type is not null and t.unit_type = p_unit_type),
  eff as (
    select * from typed
    union all
    select * from t where t.unit_type is null and not exists (select 1 from typed)
  )
  select e.rate, e.fixed_amount
    from eff e, p
   where case when p.basis = 'قيمة المبيعات'
              then coalesce(e.min_value, 0) <= coalesce(p_measure, 0)
              else coalesce(e.min_units, 1) <= greatest(coalesce(p_measure, 0), 1) end
   order by case when p.basis = 'قيمة المبيعات' then e.min_value else e.min_units end desc nulls last
   limit 1;
$fn$;

create or replace function public.resolve_commission_plan(
  p_project uuid, p_type text, p_company uuid default null, p_employee uuid default null
)
returns uuid language sql stable security definer set search_path = public as $fn$
  select c.id from public.commission_plans c
   where c.is_active and c.project_id = p_project and c.recipient_type = p_type
     and (c.company_id  is null or c.company_id  = p_company)
     and (c.employee_id is null or c.employee_id = p_employee)
   order by (c.company_id is not null) desc, (c.employee_id is not null) desc
   limit 1;
$fn$;

-- وصفٌ قصير لما طُبِّق — يُكتب على الصفقة فيُقرأ بلا الرجوع للخطة
create or replace function public.commission_basis_label(p_plan uuid, p_rate numeric, p_fixed numeric, p_measure numeric)
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(c.name, c.formula) || ' — '
         || case when coalesce(p_rate, 0) > 0 then trim_scale(p_rate)::text || '٪' else '' end
         || case when coalesce(p_rate, 0) > 0 and coalesce(p_fixed, 0) > 0 then ' + ' else '' end
         || case when coalesce(p_fixed, 0) > 0 then public.fmt_qty(p_fixed) || ' د.ع' else '' end
         || case when coalesce(p_rate, 0) = 0 and coalesce(p_fixed, 0) = 0 then '0' else '' end
         || ' (' || case when c.basis = 'قيمة المبيعات' then public.fmt_qty(p_measure)
                         else coalesce(p_measure, 0)::int::text || ' وحدة' end
         || ' — ' || c.period || ')'
    from public.commission_plans c where c.id = p_plan;
$fn$;


-- ------------------------------------------------------------
-- 3) شرائح 117 تصير خططاً
-- ------------------------------------------------------------
do $do$
declare g record; v_plan uuid;
begin
  for g in
    select distinct t.project_id, t.company_id from public.broker_commission_tiers t
  loop
    if public.resolve_commission_plan(g.project_id, 'وسيط', g.company_id) is not null
       and exists (select 1 from public.commission_plans c
                    where c.is_active and c.project_id = g.project_id and c.recipient_type = 'وسيط'
                      and c.company_id is not distinct from g.company_id) then
      continue;
    end if;

    insert into public.commission_plans
      (project_id, recipient_type, company_id, formula, basis, period, payable_rule, name, notes)
    values (g.project_id, 'وسيط', g.company_id, 'شرائح رجعية', 'عدد الوحدات', 'شهري',
            'بعد تحصيل عمولة تلال',
            case when g.company_id is null then 'شرائح الوسطاء' else 'شرائح خاصة' end,
            'منقولة من broker_commission_tiers (sql/117 → 129)')
    returning id into v_plan;

    insert into public.commission_plan_tiers (plan_id, min_units, rate)
    select v_plan, t.min_units, t.rate from public.broker_commission_tiers t
     where t.project_id = g.project_id and t.company_id is not distinct from g.company_id;
  end loop;
end $do$;

comment on table public.broker_commission_tiers is
  'متقاعد منذ sql/129 — نُقل إلى commission_plans/commission_plan_tiers ولا يُقرأ. يبقى لأن 117 تُعاد.';


-- ------------------------------------------------------------
-- 4) عمولة الوسيط: الخطة، الفترة، قابلية الدفع
-- ------------------------------------------------------------
alter table public.broker_commissions alter column rate type numeric(7,4);

alter table public.broker_commissions
  add column if not exists plan_id        uuid references public.commission_plans(id) on delete set null,
  add column if not exists period_key     text,
  add column if not exists period_measure numeric,
  add column if not exists fixed_amount   numeric,
  add column if not exists payable_rule   text,
  add column if not exists payable_at     date;

comment on column public.broker_commissions.period_measure is
  'القياس الذي عُرفت به الشريحة عند آخر حساب (عدد أو قيمة). فارغ = لم يُحسب بعد — فأول حساب ليس «تعديلاً» (sql/129).';
comment on column public.broker_commissions.payable_at is
  'متى صارت قابلة للصرف بحسب payable_rule المختومة من الخطة يوم الاستحقاق. فارغ = مستحقّة ولا تُصرف بعد (sql/129).';

update public.broker_commissions
   set period_key = coalesce(period_key, to_char(earned_at, 'YYYY-MM')),
       period_measure = coalesce(period_measure, tier_units),
       payable_rule = coalesce(payable_rule, 'عند الاستحقاق'),
       payable_at = coalesce(payable_at, case when payable_rule is null then earned_at end)
 where period_key is null or payable_rule is null;

create index if not exists broker_commissions_plan_bucket_idx
  on public.broker_commissions (plan_id, company_id, period_key)
  where reversed_at is null;

alter table public.broker_commission_adjustments alter column old_rate type numeric(7,4);
alter table public.broker_commission_adjustments alter column new_rate type numeric(7,4);
alter table public.broker_commission_adjustments
  add column if not exists period_measure numeric,
  add column if not exists trigger_kind   text,
  add column if not exists actor          uuid references auth.users(id) on delete set null,
  add column if not exists actor_name     text;

do $do$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'broker_commission_adjustments'
                    and column_name = 'difference') then
    alter table public.broker_commission_adjustments
      add column difference numeric generated always as (coalesce(new_amount, 0) - coalesce(old_amount, 0)) stored;
  end if;
end $do$;

-- صافي المصروف لعمولة: دفعات − استرداد
alter table public.broker_payments
  add column if not exists kind text not null default 'دفعة';
alter table public.broker_payments drop constraint if exists broker_payments_kind_chk;
alter table public.broker_payments
  add constraint broker_payments_kind_chk check (kind in ('دفعة', 'استرداد'));

create or replace function public.broker_commission_net_paid(p_comm uuid)
returns numeric language sql stable security definer set search_path = public as $fn$
  select coalesce(sum(case when bp.kind = 'استرداد' then -bp.amount else bp.amount end), 0)
    from public.broker_payments bp where bp.commission_id = p_comm;
$fn$;


-- ------------------------------------------------------------
-- 5) إعادة حساب دلو وسيط — وحدها تكتب rate و amount
-- ------------------------------------------------------------
create or replace function public.recompute_broker_bucket(
  p_plan uuid, p_company uuid, p_period_key text, p_reason text, p_trigger text default 'يدوي'
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  pl        public.commission_plans%rowtype;
  v_total   numeric;
  v_run     numeric := 0;
  v_meas    numeric;
  v_rate    numeric;
  v_fixed   numeric;
  v_paid    numeric;
  v_new     numeric(16,2);
  v_up      numeric := 0;
  v_moved   int := 0;
  v_top     numeric;
  r         record;
begin
  select * into pl from public.commission_plans where id = p_plan;
  if not found then return; end if;

  select case when pl.basis = 'قيمة المبيعات' then coalesce(sum(bc.deal_amount), 0) else count(*) end
    into v_total
    from public.broker_commissions bc
   where bc.plan_id = p_plan and bc.company_id = p_company
     and bc.period_key = p_period_key and bc.reversed_at is null;

  for r in
    select bc.*, u.unit_type as u_type
      from public.broker_commissions bc
      left join public.units u on u.id = bc.unit_id
     where bc.plan_id = p_plan and bc.company_id = p_company
       and bc.period_key = p_period_key and bc.reversed_at is null
     order by bc.earned_at, bc.created_at, bc.id
     for update of bc
  loop
    v_run := v_run + case when pl.basis = 'قيمة المبيعات' then coalesce(r.deal_amount, 0) else 1 end;
    v_meas := case pl.formula
                when 'شرائح حدّية' then v_run
                when 'ثابتة'       then case when pl.basis = 'قيمة المبيعات' then 0 else 1 end
                else v_total
              end;

    v_rate := null; v_fixed := null;
    select t.rate, t.fixed_amount into v_rate, v_fixed
      from public.commission_plan_rate(p_plan, v_meas, r.u_type) t;
    v_rate := coalesce(v_rate, 0);

    v_paid := public.broker_commission_net_paid(r.id);
    -- ⚠️ لا ينزل تحت صافي المصروف — الصرف حركة نقدية مقيّدة
    v_new := greatest(round(coalesce(r.deal_amount, 0) * v_rate / 100 + coalesce(v_fixed, 0), 2), v_paid);

    if r.period_measure is not null
       and (v_new is distinct from r.amount or v_rate is distinct from r.rate
            or v_fixed is distinct from r.fixed_amount) then
      insert into public.broker_commission_adjustments
        (commission_id, old_rate, new_rate, old_amount, new_amount, period_units, period_measure,
         reason, trigger_kind, actor, actor_name)
      values (r.id, r.rate, v_rate, r.amount, v_new,
              case when pl.basis = 'عدد الوحدات' then v_meas::int end, v_meas,
              p_reason, p_trigger, auth.uid(),
              case when auth.uid() is null then 'النظام' else public.actor_display_name() end);
      if v_new > r.amount then
        v_up := v_up + (v_new - r.amount);
        v_moved := v_moved + 1;
      end if;
    end if;

    update public.broker_commissions
       set rate = v_rate, fixed_amount = v_fixed, amount = v_new, period_measure = v_meas,
           tier_units = case when pl.basis = 'عدد الوحدات' then v_meas::int else tier_units end
     where id = r.id
       and (rate is distinct from v_rate or amount is distinct from v_new
            or fixed_amount is distinct from v_fixed or period_measure is distinct from v_meas);
    v_top := v_rate;
  end loop;

  -- ارتفعت الشريحة فارتفعت صفقاتٌ سابقة: يعرف الوسيط بالفرق
  if v_up > 0 then
    perform public.notify_broker_company(p_company,
      'مبروك — انتقلتم إلى شريحة ' || trim_scale(v_top) || '٪ 🎯',
      case when pl.basis = 'قيمة المبيعات'
           then 'بلغت مبيعاتكم ' || public.fmt_qty(v_total) || ' د.ع'
           else 'بلغتم ' || v_total::int || ' وحدة' end
        || ' في ' || coalesce((select pr.name from public.projects pr where pr.id = pl.project_id), 'المشروع')
        || ' (' || p_period_key || ') — وأُعيد احتساب ' || v_moved || ' صفقة سابقة بأثر رجعي: +'
        || public.fmt_qty(v_up) || ' د.ع.',
      '/dashboard/broker/commissions', null);
  end if;
end; $fn$;

-- الاسم القديم (117): يعيد حساب كل دلاء الشركة في المشروع لذلك الشهر
create or replace function public.recompute_broker_tier(
  p_company uuid, p_project uuid, p_period text, p_reason text
)
returns void language plpgsql security definer set search_path = public as $fn$
declare b record;
begin
  for b in
    select distinct bc.plan_id, bc.period_key from public.broker_commissions bc
     where bc.company_id = p_company and bc.project_id is not distinct from p_project
       and to_char(bc.earned_at, 'YYYY-MM') = p_period
       and bc.plan_id is not null and bc.reversed_at is null
  loop
    perform public.recompute_broker_bucket(b.plan_id, p_company, b.period_key, p_reason, 'يدوي');
  end loop;
end; $fn$;

-- الاستحقاق عند إتمام البيع — القناة تقرّر لا بطاقة العميل
create or replace function public.post_broker_commission()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid;
  v_project uuid;
  v_client  text;
  v_comm    uuid;
  v_plan    uuid;
  pl        public.commission_plans%rowtype;
  v_amount  numeric;
  v_rate    numeric;
  v_today   date := (now() at time zone 'Asia/Baghdad')::date;
  v_key     text;
begin
  if new.status <> 'بيع مكتمل' or new.sale_channel <> 'وسيط' then
    return new;                         -- البيع المباشر: لا عمولة وساطة
  end if;

  if exists (select 1 from public.broker_commissions bc where bc.reservation_id = new.id) then
    return new;
  end if;

  v_company := new.broker_company_id;
  select c.name into v_client from public.clients c where c.id = new.client_id;
  select u.project_id into v_project from public.units u where u.id = new.unit_id;

  v_plan := public.resolve_commission_plan(v_project, 'وسيط', v_company);
  if v_plan is not null then
    select * into pl from public.commission_plans where id = v_plan;
    v_key := public.commission_period_key(pl.period, v_today);
  else
    v_key := to_char(v_today, 'YYYY-MM');
  end if;

  insert into public.broker_commissions
    (company_id, client_id, unit_id, reservation_id, project_id,
     deal_amount, rate, amount, earned_at, notes,
     plan_id, period_key, payable_rule, payable_at)
  values (v_company, new.client_id, new.unit_id, new.id, v_project,
          coalesce(public.broker_deal_price(new.id), 0), 0, 0, v_today,
          'استحقاق تلقائي عند إتمام البيع',
          v_plan, v_key, coalesce(pl.payable_rule, 'بعد تحصيل عمولة تلال'),
          case when pl.payable_rule = 'عند الاستحقاق' then v_today end)
  returning id into v_comm;

  if v_plan is not null then
    perform public.recompute_broker_bucket(v_plan, v_company, v_key, 'صفقة جديدة دخلت الفترة', 'صفقة جديدة');
  end if;

  select bc.amount, bc.rate into v_amount, v_rate from public.broker_commissions bc where bc.id = v_comm;

  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select bu.user_id,
         'عمولة مستحقة لكم 🎉',
         'إتمام بيع للعميل ' || coalesce(v_client, '') || ' — ' || trim_scale(v_rate) || '٪ = '
           || public.fmt_qty(v_amount) || ' د.ع'
           || case coalesce(pl.payable_rule, 'بعد تحصيل عمولة تلال')
                when 'عند الاستحقاق' then ' — قابلة للصرف.'
                when 'بعد تأكيد المقدمة' then ' — تُصرف بعد تأكيد مقدمة المشتري.'
                else ' — تُصرف بعد تحصيل تلال عمولتها من المطوّر.' end,
         '/dashboard/broker/commissions', 'عمولة', v_comm, 'broker_commission', 'وساطة'
    from public.broker_users bu where bu.company_id = v_company and bu.is_active;

  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select p.id,
         case when v_plan is null then 'عمولة وساطة بلا خطة ⚠️' else 'عمولة وساطة مستحقة' end,
         (select bcm.name from public.broker_companies bcm where bcm.id = v_company)
           || ' — ' || public.fmt_qty(v_amount) || ' د.ع'
           || case when v_plan is null then ' — لا خطة عمولة «وسيط» لهذا المشروع، عرّفها ثم أعد الحساب' else '' end,
         '/dashboard/brokers/' || v_company, 'عمولة', v_comm, 'broker_commission', 'وساطة'
    from public.profiles p where p.role = 'admin';

  return new;
end; $fn$;

create or replace function public.sync_broker_deal_price()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare bc public.broker_commissions%rowtype;
begin
  if new.sale_price is not distinct from old.sale_price then
    return null;
  end if;

  select * into bc from public.broker_commissions
   where reservation_id = new.id and reversed_at is null;
  if not found then return null; end if;

  update public.broker_commissions
     set deal_amount = public.broker_deal_price(new.id)
   where id = bc.id;

  if bc.plan_id is not null then
    perform public.recompute_broker_bucket(bc.plan_id, bc.company_id, bc.period_key,
                                           'أُدخل سعر البيع الفعلي', 'سعر البيع');
  end if;
  return null;
end; $fn$;

-- زرّ 117 القديم: يبقى ويمرّ بالدلاء
create or replace function public.recalc_broker_commissions(
  p_company uuid default null, p_project uuid default null, p_period text default null
)
returns integer language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  if not public.is_admin() then
    raise exception 'إعادة حساب العمولات للمدير';
  end if;

  for r in
    select distinct bc.plan_id, bc.company_id, bc.period_key
      from public.broker_commissions bc
     where bc.reversed_at is null and bc.plan_id is not null
       and (p_company is null or bc.company_id = p_company)
       and (p_project is null or bc.project_id = p_project)
       and (p_period  is null or bc.period_key = p_period or to_char(bc.earned_at, 'YYYY-MM') = p_period)
  loop
    perform public.recompute_broker_bucket(r.plan_id, r.company_id, r.period_key,
                                           'إعادة حساب يدوية بعد تعديل الشرائح', 'تعديل الخطة');
    n := n + 1;
  end loop;
  return n;
end; $fn$;


-- ------------------------------------------------------------
-- 6) متى تصير عمولة الوسيط قابلة للصرف
-- ------------------------------------------------------------
create or replace function public.broker_payable_on_down_payment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.down_payment_confirmed_at is null or old.down_payment_confirmed_at is not null then
    return null;
  end if;
  for r in
    update public.broker_commissions
       set payable_at = (new.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date
     where reservation_id = new.id and payable_rule = 'بعد تأكيد المقدمة'
       and payable_at is null and reversed_at is null
    returning id, company_id, amount
  loop
    perform public.notify_broker_company(r.company_id, 'عمولتكم صارت قابلة للصرف 💰',
      public.fmt_qty(r.amount) || ' د.ع — أُكّدت مقدمة المشتري.', '/dashboard/broker/commissions', r.id);
  end loop;
  return null;
end; $fn$;

drop trigger if exists trg_broker_payable_on_down_payment on public.reservations;
create trigger trg_broker_payable_on_down_payment
  after update of down_payment_confirmed_at on public.reservations
  for each row execute function public.broker_payable_on_down_payment();

create or replace function public.broker_payable_on_collection()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.collected_at is null or old.collected_at is not null then
    return null;
  end if;
  for r in
    update public.broker_commissions
       set payable_at = new.collected_at
     where reservation_id = new.reservation_id and payable_rule = 'بعد تحصيل عمولة تلال'
       and payable_at is null and reversed_at is null
    returning id, company_id, amount
  loop
    perform public.notify_broker_company(r.company_id, 'عمولتكم صارت قابلة للصرف 💰',
      public.fmt_qty(r.amount) || ' د.ع — حصّلت تلال عمولتها من المطوّر.', '/dashboard/broker/commissions', r.id);
  end loop;
  return null;
end; $fn$;

drop trigger if exists trg_broker_payable_on_collection on public.sale_commissions;
create trigger trg_broker_payable_on_collection
  after update of collected_at on public.sale_commissions
  for each row execute function public.broker_payable_on_collection();

-- استثناء إداري موثَّق: إتاحة الصرف قبل قاعدة الخطة
create or replace function public.release_broker_commission(p_comm uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare c public.broker_commissions%rowtype;
begin
  if not public.is_admin() then raise exception 'إتاحة الصرف استثناءً للمدير'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب الاستثناء'; end if;
  select * into c from public.broker_commissions where id = p_comm for update;
  if not found or c.reversed_at is not null then raise exception 'العمولة غير موجودة أو مفسوخة'; end if;
  if c.payable_at is not null then raise exception 'العمولة قابلة للصرف سلفاً'; end if;

  update public.broker_commissions
     set payable_at = (now() at time zone 'Asia/Baghdad')::date,
         notes = coalesce(notes || E'\n', '') || 'أُتيح الصرف استثناءً: ' || btrim(p_reason)
                 || ' — ' || public.actor_display_name()
   where id = p_comm;
end; $fn$;

-- حارس الصرف: لا قبل القاعدة، ولا فوق المستحق، ولا استرداد فوق المصروف.
-- يقفل صفّ العمولة فدفعتان متزامنتان لا تتجاوزان معاً.
create or replace function public.guard_broker_payment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare c public.broker_commissions%rowtype; v_other numeric;
begin
  if tg_op = 'UPDATE' and new.commission_id is distinct from old.commission_id then
    raise exception 'لا تُنقل دفعة من عمولة إلى أخرى — احذفها وسجّلها على الصحيحة';
  end if;

  select * into c from public.broker_commissions where id = new.commission_id for update;
  if not found then raise exception 'العمولة غير موجودة'; end if;

  select coalesce(sum(case when bp.kind = 'استرداد' then -bp.amount else bp.amount end), 0)
    into v_other
    from public.broker_payments bp
   where bp.commission_id = new.commission_id
     and (tg_op = 'INSERT' or bp.id <> new.id);

  if new.kind = 'دفعة' then
    if c.reversed_at is not null then
      raise exception 'صفقة مفسوخة — لا يُصرف من عمولتها';
    end if;
    if c.payable_at is null then
      raise exception 'العمولة مستحقّة ولم تصر قابلة للصرف بعد (القاعدة: %)', coalesce(c.payable_rule, '—');
    end if;
    if v_other + new.amount > c.amount + 0.005 then
      raise exception 'الصرف يتجاوز المستحق — الباقي %', public.fmt_qty(greatest(c.amount - v_other, 0));
    end if;
  else
    if new.amount > v_other + 0.005 then
      raise exception 'الاسترداد يتجاوز صافي المصروف (%)', public.fmt_qty(v_other);
    end if;
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_guard_broker_payment on public.broker_payments;
create trigger trg_guard_broker_payment
  before insert or update of amount, kind, commission_id on public.broker_payments
  for each row execute function public.guard_broker_payment();

-- القيد: الدفعة مدين 5510 / دائن الصندوق، والاسترداد عكسها
create or replace function public.repost_broker_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  p       record;
  v_exp   uuid;
  v_cash  uuid;
  v_entry uuid;
  v_co    text;
  v_ref   boolean;
begin
  select * into p from public.broker_payments where id = p_payment;
  if not found then return; end if;

  if p.journal_entry_id is not null then
    delete from public.journal_entries where id = p.journal_entry_id;
    update public.broker_payments set journal_entry_id = null where id = p_payment;
  end if;

  if coalesce(p.amount, 0) <= 0 then return; end if;
  v_ref := p.kind = 'استرداد';

  select id into v_exp from public.accounts where code = '5510';
  -- ⚠️ الواجهة تعرض «تحويل بنكي» والدالّة القديمة كانت تطابق «بنك» وحدها،
  --    فكان التحويل البنكي يُقيَّد على الصندوق 1100. صُحّح هنا (129).
  select id into v_cash from public.accounts
    where code = case when p.method in ('بنك', 'تحويل بنكي') then '1200' else '1100' end;
  if v_exp is null or v_cash is null then return; end if;

  select bc.name into v_co
  from public.broker_commissions c
  join public.broker_companies bc on bc.id = c.company_id
  where c.id = p.commission_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    coalesce(p.payment_date, current_date),
    case when v_ref then 'استرداد عمولة وسيط: ' else 'دفعة عمولة وسيط: ' end || coalesce(v_co, ''),
    case when v_ref then 'BRKREF' else 'BRKPAY' end, 'إداري عام', 'broker_payments'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, case when v_ref then v_cash else v_exp end, p.amount, 0),
         (v_entry, case when v_ref then v_exp else v_cash end, 0, p.amount);

  update public.broker_payments set journal_entry_id = v_entry where id = p_payment;
end; $fn$;

drop trigger if exists trg_broker_payment_ledger on public.broker_payments;
create trigger trg_broker_payment_ledger
  after insert or update of amount, method, payment_date, kind on public.broker_payments
  for each row execute function public.post_broker_payment();


-- ------------------------------------------------------------
-- 7) عمولة الموظف والـRM — القناة، الخطة، الفروق
-- ------------------------------------------------------------
alter table public.employee_commission_rules
  add column if not exists channel text not null default 'مباشر';
alter table public.employee_commission_rules drop constraint if exists ecr_channel_chk;
alter table public.employee_commission_rules
  add constraint ecr_channel_chk check (channel in ('مباشر', 'وسيط'));

comment on column public.employee_commission_rules.channel is
  'مباشر = تسري على البيع المباشر. وسيط = عمولة الـRM الداخلية على صفقة الوسيط. القواعد القائمة كلها «مباشر» (sql/129).';

create or replace function public.resolve_commission_rule(
  p_employee uuid, p_project uuid, p_area numeric, p_channel text
)
returns public.employee_commission_rules
language sql stable security definer set search_path = public as $fn$
  select r.*
  from public.employee_commission_rules r
  where r.active
    and r.channel = coalesce(p_channel, 'مباشر')
    and (r.employee_id is null or r.employee_id = p_employee)
    and (r.project_id  is null or r.project_id  = p_project)
    and (r.min_area is null or coalesce(p_area, 0) >= r.min_area)
    and (r.max_area is null or coalesce(p_area, 0) <= r.max_area)
  order by
    (r.employee_id is not null) desc,
    (r.project_id  is not null) desc,
    (r.min_area is not null or r.max_area is not null) desc,
    r.created_at desc
  limit 1;
$fn$;

-- النسخة القديمة (048) = البيع المباشر
create or replace function public.resolve_commission_rule(p_employee uuid, p_project uuid, p_area numeric)
returns public.employee_commission_rules
language sql stable security definer set search_path = public as $fn$
  select * from public.resolve_commission_rule(p_employee, p_project, p_area, 'مباشر');
$fn$;

alter table public.sale_commissions
  add column if not exists sale_channel     text,
  add column if not exists employee_role    text,
  add column if not exists employee_plan_id uuid references public.commission_plans(id) on delete set null,
  add column if not exists employee_period  text,
  add column if not exists employee_rate    numeric(7,4),
  add column if not exists employee_fixed   numeric,
  add column if not exists employee_measure numeric;

comment on column public.sale_commissions.employee_role is
  'موظف مباشر = بائع البيع المباشر. مدير علاقات = عمولة الـRM الداخلية على صفقة الوسيط (sql/129).';

update public.sale_commissions sc
   set sale_channel = r.sale_channel,
       employee_role = case when r.sale_channel = 'وسيط' then 'مدير علاقات' else 'موظف مباشر' end
  from public.reservations r
 where r.id = sc.reservation_id and sc.sale_channel is null;

create index if not exists sale_comm_emp_bucket_idx
  on public.sale_commissions (employee_plan_id, employee_id, employee_period)
  where reversed_at is null and employee_plan_id is not null;

-- كل استحقاقٍ وفرقٍ واسترداد مربوطٌ بصفقته
alter table public.commissions
  add column if not exists sale_commission_id uuid references public.sale_commissions(id) on delete set null;
alter table public.deductions
  add column if not exists sale_commission_id uuid references public.sale_commissions(id) on delete set null;

update public.commissions c
   set sale_commission_id = sc.id
  from public.sale_commissions sc
 where sc.commission_id = c.id and c.sale_commission_id is null;

create index if not exists commissions_sale_comm_idx on public.commissions (sale_commission_id) where sale_commission_id is not null;
create index if not exists deductions_sale_comm_idx  on public.deductions  (sale_commission_id) where sale_commission_id is not null;

create table if not exists public.sale_commission_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  sale_commission_id uuid not null references public.sale_commissions(id) on delete cascade,
  employee_id        uuid references public.employees(id) on delete set null,
  old_rate           numeric(7,4),
  new_rate           numeric(7,4),
  old_amount         numeric,
  new_amount         numeric,
  difference         numeric generated always as (coalesce(new_amount, 0) - coalesce(old_amount, 0)) stored,
  period_measure     numeric,
  reason             text,
  trigger_kind       text,
  settlement         text,
  actor              uuid references auth.users(id) on delete set null,
  actor_name         text
);

create index if not exists sca_sale_comm_idx on public.sale_commission_adjustments (sale_commission_id, created_at);

comment on table public.sale_commission_adjustments is
  'كل تغيير على عمولة موظف/RM بعد أول حساب — بأثر رجعي أو بفسخ أو بتعيين. settlement: كيف سُوّي الفرق (sql/129).';

alter table public.sale_commission_adjustments enable row level security;

drop policy if exists "read sale commission adjustments" on public.sale_commission_adjustments;
create policy "read sale commission adjustments" on public.sale_commission_adjustments
  for select to authenticated
  using (
    (select public.is_admin()) or (select public.is_accountant()) or (select public.is_hr())
    or employee_id = (select public.my_employee_id())
  );

-- تحرير كل ما استُحقّ لموظفٍ عن صفقة: غير المضاف لكشف يُحذف، وما في
-- مسوّدة يُزال، وصافي ما دخل كشوفاً معتمدة يُسترَدّ باستقطاع واحد.
create or replace function public.release_sale_commission_accruals(p_sc uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  sc public.sale_commissions%rowtype; c record; d record; pr public.payrolls%rowtype;
  v_paid numeric := 0; v_applied numeric := 0; v_removed numeric := 0; v_net numeric; v_unit text;
begin
  select * into sc from public.sale_commissions where id = p_sc;
  if not found then return 'لا سجلّ'; end if;
  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = sc.unit_id;

  for c in
    select * from public.commissions
     where sale_commission_id = p_sc or id = sc.commission_id
  loop
    if c.payroll_id is null then
      delete from public.commissions where id = c.id;
      v_removed := v_removed + c.amount;
    else
      select * into pr from public.payrolls where id = c.payroll_id;
      if pr.state = 'مسودة' then
        delete from public.payroll_lines
         where payroll_id = pr.id and source_table = 'commissions' and source_id = c.id;
        delete from public.commissions where id = c.id;
        perform public.refresh_payroll_totals(pr.id);
        v_removed := v_removed + c.amount;
      else
        v_paid := v_paid + c.amount;
      end if;
    end if;
  end loop;

  for d in select * from public.deductions where sale_commission_id = p_sc loop
    if d.payroll_id is null then
      delete from public.deductions where id = d.id;
    else
      select * into pr from public.payrolls where id = d.payroll_id;
      if pr.state = 'مسودة' then
        delete from public.payroll_lines
         where payroll_id = pr.id and source_table = 'deductions' and source_id = d.id;
        delete from public.deductions where id = d.id;
        perform public.refresh_payroll_totals(pr.id);
      else
        v_applied := v_applied + d.amount;
      end if;
    end if;
  end loop;

  update public.sale_commissions set commission_id = null where id = p_sc;

  v_net := v_paid - v_applied;
  if v_net > 0 and sc.employee_id is not null then
    insert into public.deductions (employee_id, amount, ded_date, reason, sale_commission_id)
    values (sc.employee_id, v_net, (now() at time zone 'Asia/Baghdad')::date,
            'استرداد عمولة — الوحدة ' || v_unit || ' — ' || coalesce(p_reason, ''), p_sc);
    return 'أُزيل ' || public.fmt_qty(v_removed) || ' د.ع غير مدفوع، واستُرِدّ ' || public.fmt_qty(v_net)
           || ' د.ع مدفوع باستقطاع في الكشف القادم';
  end if;

  return case when v_removed > 0 then 'أُزيلت عمولة ' || public.fmt_qty(v_removed) || ' د.ع لم تُدفع'
              else 'لا عمولة مستحقّة' end;
end; $fn$;

-- إعادة حساب دلو موظف/RM — وحدها تكتب employee_amount لصفقات الخطط
create or replace function public.recompute_employee_bucket(
  p_plan uuid, p_employee uuid, p_period text, p_reason text, p_trigger text default 'يدوي'
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  pl      public.commission_plans%rowtype;
  v_total numeric;
  v_run   numeric := 0;
  v_meas  numeric;
  v_rate  numeric;
  v_fixed numeric;
  v_new   numeric;
  v_delta numeric;
  v_acc   boolean;
  v_comm  uuid;
  v_set   text;
  v_up    numeric := 0;
  v_unit  text;
  v_user  uuid;
  r       record;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  select * into pl from public.commission_plans where id = p_plan;
  if not found or p_employee is null then return; end if;

  select case when pl.basis = 'قيمة المبيعات' then coalesce(sum(sc.deal_amount), 0) else count(*) end
    into v_total
    from public.sale_commissions sc
   where sc.employee_plan_id = p_plan and sc.employee_id = p_employee
     and sc.employee_period = p_period and sc.reversed_at is null;

  for r in
    select sc.*, u.unit_type as u_type, u.unit_code as u_code
      from public.sale_commissions sc
      left join public.units u on u.id = sc.unit_id
     where sc.employee_plan_id = p_plan and sc.employee_id = p_employee
       and sc.employee_period = p_period and sc.reversed_at is null
     order by sc.created_at, sc.id
     for update of sc
  loop
    v_run := v_run + case when pl.basis = 'قيمة المبيعات' then coalesce(r.deal_amount, 0) else 1 end;
    v_meas := case pl.formula
                when 'شرائح حدّية' then v_run
                when 'ثابتة'       then case when pl.basis = 'قيمة المبيعات' then 0 else 1 end
                else v_total
              end;

    v_rate := null; v_fixed := null;
    select t.rate, t.fixed_amount into v_rate, v_fixed
      from public.commission_plan_rate(p_plan, v_meas, r.u_type) t;
    v_rate := coalesce(v_rate, 0);
    v_new := round(coalesce(r.deal_amount, 0) * v_rate / 100 + coalesce(v_fixed, 0));

    if r.employee_measure is not null and v_new is distinct from r.employee_amount then
      v_delta := v_new - coalesce(r.employee_amount, 0);
      v_set := 'قبل تأكيد المقدمة — يتغيّر الرقم وحده';

      -- استُحقّت (تأكيد المقدمة، 120): فرقٌ لا تعديل لصفٍّ مُرحَّل.
      -- قبلها يكفي تغيير الرقم: confirm_down_payment يقرؤه عند الاستحقاق.
      select (rs.down_payment_confirmed_at is not null) into v_acc
        from public.reservations rs where rs.id = r.reservation_id;

      if coalesce(v_acc, false) then
        if v_delta > 0 then
          insert into public.commissions
            (employee_id, amount, comm_date, description, auto, payable_at, sale_commission_id)
          values (p_employee, v_delta, v_today,
                  case when r.commission_id is null then 'عمولة بيع' else 'فرق شريحة عمولة بأثر رجعي' end
                    || ' — الوحدة ' || coalesce(r.u_code, ''),
                  true, v_today, r.id)
          returning id into v_comm;
          if r.commission_id is null then
            update public.sale_commissions set commission_id = v_comm where id = r.id;
          end if;
          perform public.attach_commission_to_draft(v_comm);
          v_set := 'صفّ عمولة إضافي ' || public.fmt_qty(v_delta) || ' د.ع';
          v_up := v_up + v_delta;
        elsif exists (select 1 from public.commissions c
                       where c.employee_id = p_employee
                         and (c.sale_commission_id = r.id or c.id = r.commission_id)) then
          insert into public.deductions (employee_id, amount, ded_date, reason, sale_commission_id)
          values (p_employee, -v_delta, v_today,
                  'تعديل شريحة عمولة بأثر رجعي — الوحدة ' || coalesce(r.u_code, ''), r.id);
          v_set := 'استقطاع ' || public.fmt_qty(-v_delta) || ' د.ع في الكشف القادم';
        end if;
      end if;

      insert into public.sale_commission_adjustments
        (sale_commission_id, employee_id, old_rate, new_rate, old_amount, new_amount,
         period_measure, reason, trigger_kind, settlement, actor, actor_name)
      values (r.id, p_employee, r.employee_rate, v_rate, r.employee_amount, v_new,
              v_meas, p_reason, p_trigger, v_set, auth.uid(),
              case when auth.uid() is null then 'النظام' else public.actor_display_name() end);
    end if;

    update public.sale_commissions
       set employee_amount = v_new, employee_rate = v_rate, employee_fixed = v_fixed,
           employee_measure = v_meas,
           employee_basis = public.commission_basis_label(p_plan, v_rate, v_fixed, v_meas)
     where id = r.id;
  end loop;

  if v_up > 0 then
    select user_id into v_user from public.employees where id = p_employee;
    if v_user is not null then
      insert into public.notifications (user_id, title, body, link, kind, category)
      values (v_user, 'ارتفعت شريحة عمولتك 🎯',
              'بلغت شريحة أعلى (' || p_period || ') فأُعيد احتساب صفقاتك السابقة: +'
                || public.fmt_qty(v_up) || ' د.ع تدخل كشفك.',
              '/dashboard/me/salary', 'راتب', 'عمولة');
    end if;
  end if;
end; $fn$;

-- عمولة الموظف بقواعد 048 (بلا خطة) — مكانٌ واحد للحساب
create or replace function public.legacy_employee_commission(
  p_employee uuid, p_project uuid, p_area numeric, p_channel text,
  p_price numeric, p_company_amount numeric
)
returns table (amount numeric, basis text, rule_id uuid)
language plpgsql stable security definer set search_path = public as $fn$
declare rule public.employee_commission_rules%rowtype;
begin
  select * into rule from public.resolve_commission_rule(p_employee, p_project, p_area, p_channel);
  if rule.id is null then
    return query select 0::numeric, null::text, null::uuid;
    return;
  end if;
  return query select
    case rule.kind
      when 'نسبة من عمولة الشركة' then round(coalesce(p_company_amount, 0) * rule.value / 100)
      when 'نسبة من سعر البيع'    then round(coalesce(p_price, 0) * rule.value / 100)
      when 'مبلغ لكل متر'          then round(coalesce(p_area, 0) * rule.value)
      else round(rule.value)
    end,
    rule.kind || ' — ' || rule.value || case when rule.kind like 'نسبة%' then '%' else ' د.ع' end,
    rule.id;
end; $fn$;

-- تسجيل عمولة الصفقة — نصّ 069 + القناة والخطة
create or replace function public.record_sale_commission(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  res     record;
  u       record;
  idx     int;
  v_price numeric;
  v_rate  numeric;
  v_comp  numeric;
  v_emp   uuid;
  v_role  text;
  v_plan  uuid;
  v_per   text;
  v_amt   numeric := 0;
  v_basis text;
  v_rule  uuid;
  v_sc    uuid;
  lg      record;
begin
  select * into res from public.reservations where id = p_reservation;
  if not found or res.status <> 'بيع مكتمل' then return; end if;

  if exists (select 1 from public.sale_commissions s where s.reservation_id = p_reservation) then
    return;
  end if;

  select * into u from public.units where id = res.unit_id;
  if u is null then return; end if;

  v_price := coalesce(res.sale_price, u.price);
  if coalesce(v_price, 0) <= 0 then return; end if;

  -- عمولة تلال من المطوّر: ترتيب الصفقة في المشروع — كل القنوات (048)
  select count(*) into idx
  from public.reservations r
  join public.units un on un.id = r.unit_id
  where r.status = 'بيع مكتمل'
    and un.project_id is not distinct from u.project_id
    and r.created_at <= res.created_at;
  idx := greatest(coalesce(idx, 1), 1);

  v_rate := public.project_commission_rate(u.project_id, idx);
  v_comp := round(v_price * v_rate / 100);

  -- المستحقّ الداخلي: البائع في المباشر، ومدير علاقات الشركة في الوسيط
  if res.sale_channel = 'وسيط' then
    v_role := 'مدير علاقات';
    v_emp  := res.broker_rm_id;
  else
    v_role := 'موظف مباشر';
    v_emp  := res.agent_id;
    if v_emp is null then
      select e.id into v_emp
      from public.clients c
      join public.employees e
        on public.name_key(e.full_name) = public.name_key(c.sales_employee)
      where c.id = res.client_id limit 1;
    end if;
  end if;

  if v_emp is not null then
    v_plan := public.resolve_commission_plan(u.project_id, v_role, null, v_emp);
    if v_plan is not null then
      select public.commission_period_key(c.period, (now() at time zone 'Asia/Baghdad')::date)
        into v_per from public.commission_plans c where c.id = v_plan;
    else
      select * into lg from public.legacy_employee_commission(
        v_emp, u.project_id, u.space_m2, case when v_role = 'مدير علاقات' then 'وسيط' else 'مباشر' end,
        v_price, v_comp);
      v_amt := lg.amount; v_basis := lg.basis; v_rule := lg.rule_id;
    end if;
  end if;

  insert into public.sale_commissions (
    reservation_id, project_id, unit_id, client_id, deal_amount, unit_area,
    sales_index, company_rate, company_amount,
    employee_id, employee_basis, employee_amount, rule_id,
    sale_channel, employee_role, employee_plan_id, employee_period
  ) values (
    p_reservation, u.project_id, res.unit_id, res.client_id,
    v_price, u.space_m2,
    idx, v_rate, v_comp,
    v_emp, v_basis, coalesce(v_amt, 0), v_rule,
    res.sale_channel, v_role, v_plan, v_per
  )
  returning id into v_sc;

  if v_plan is not null then
    perform public.recompute_employee_bucket(v_plan, v_emp, v_per, 'صفقة جديدة دخلت الفترة', 'صفقة جديدة');
  end if;
end; $fn$;

-- تعيين موظف البيع (120) — بالخطة إن وُجدت، وتحرير السابق بالدالّة الموحّدة
create or replace function public.set_sale_employee(p_res uuid, p_employee uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  emp public.employees%rowtype; old_emp text;
  lg record;
  v_amt numeric := 0; v_basis text; v_rule uuid; v_unit text; v_comm uuid; v_period text;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_paydate date;
  v_role text; v_plan uuid; v_per text; v_cur uuid;
  v_old_plan uuid; v_old_emp uuid; v_old_per text;
  v_old_action text := 'لا عمولة سابقة';
  v_new_action text := 'لا عمولة';
begin
  if not public.is_admin() then
    raise exception 'تعيين موظف البيع للمدير';
  end if;

  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status not in ('حجز', 'بيع مكتمل') then
    raise exception 'لا يُعيَّن موظف بيع لحجزٍ %', r.status;
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;

  v_role := case when r.sale_channel = 'وسيط' then 'مدير علاقات' else 'موظف مباشر' end;
  v_cur  := case when r.sale_channel = 'وسيط' then r.broker_rm_id else r.agent_id end;

  select * into sc from public.sale_commissions
   where reservation_id = p_res and reversed_at is null for update;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;
  select full_name into old_emp from public.employees where id = coalesce(sc.employee_id, v_cur);

  if v_cur is distinct from emp.id then
    if r.sale_channel = 'وسيط' then
      update public.reservations set broker_rm_id = emp.id where id = p_res;
    else
      update public.reservations set agent_id = emp.id, agent_name = emp.full_name where id = p_res;
    end if;
  end if;

  if (sc.id is not null and sc.employee_id is not distinct from emp.id)
     or (sc.id is null and v_cur is not distinct from emp.id) then
    if v_cur is distinct from emp.id then
      perform public.log_unit_event(r.unit_id, 'موظف البيع', 'ثُبِّت ' || emp.full_name);
    end if;
    return jsonb_build_object('changed', false);
  end if;

  if sc.id is null then
    perform public.log_unit_event(r.unit_id, 'موظف البيع',
      coalesce(old_emp, '—') || ' ← ' || emp.full_name);
    return jsonb_build_object('changed', true, 'old', v_old_action, 'new', 'تُحسب عند اكتمال البيع');
  end if;

  -- ===== السابق: يُحرَّر ما استُحقّ له =====
  v_old_plan := sc.employee_plan_id; v_old_emp := sc.employee_id; v_old_per := sc.employee_period;
  if sc.employee_id is not null then
    v_old_action := coalesce(old_emp, '') || ': '
      || public.release_sale_commission_accruals(sc.id, 'نُقلت الصفقة إلى ' || emp.full_name);
  end if;

  -- ===== الجديد: على أساس الصفقة المجمَّد =====
  v_plan := public.resolve_commission_plan(sc.project_id, v_role, null, emp.id);
  if v_plan is not null then
    select public.commission_period_key(c.period, (sc.created_at at time zone 'Asia/Baghdad')::date)
      into v_per from public.commission_plans c where c.id = v_plan;
    update public.sale_commissions
       set employee_id = emp.id, employee_role = v_role, employee_plan_id = v_plan,
           employee_period = v_per, employee_amount = 0, employee_measure = null,
           employee_rate = null, employee_fixed = null, rule_id = null, commission_id = null
     where id = sc.id;
    perform public.recompute_employee_bucket(v_plan, emp.id, v_per, 'دخلت الصفقة بتعيين موظف البيع', 'تعيين موظف البيع');
    select employee_amount, employee_basis into v_amt, v_basis from public.sale_commissions where id = sc.id;
  else
    select * into lg from public.legacy_employee_commission(
      emp.id, sc.project_id, sc.unit_area, case when v_role = 'مدير علاقات' then 'وسيط' else 'مباشر' end,
      sc.deal_amount, sc.company_amount);
    v_amt := lg.amount; v_basis := lg.basis; v_rule := lg.rule_id;
    update public.sale_commissions
       set employee_id = emp.id, employee_role = v_role, employee_plan_id = null,
           employee_period = null, employee_basis = v_basis, employee_amount = coalesce(v_amt, 0),
           employee_measure = null, employee_rate = null, employee_fixed = null,
           rule_id = v_rule, commission_id = null
     where id = sc.id;
  end if;

  -- خروجها من دلو السابق قد يُنزل شريحته
  if v_old_plan is not null and v_old_emp is not null then
    perform public.recompute_employee_bucket(v_old_plan, v_old_emp, v_old_per,
      'خرجت صفقة من الفترة بتعيين موظف آخر', 'تعيين موظف البيع');
  end if;

  if r.down_payment_confirmed_at is null then
    v_new_action := case when coalesce(v_amt, 0) > 0
                         then public.fmt_qty(v_amt) || ' د.ع — تُستحقّ عند تأكيد المقدمة'
                         else 'لا خطة ولا قاعدة عمولة تنطبق على ' || emp.full_name end;

  elsif coalesce(v_amt, 0) > 0 then
    v_paydate := (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date;

    insert into public.commissions
      (employee_id, amount, comm_date, description, auto, payable_at, sale_commission_id)
    values (emp.id, v_amt, v_today,
            'عمولة بيع — الوحدة ' || v_unit || ' — ' || coalesce(v_basis, ''),
            true, v_paydate, sc.id)
    returning id into v_comm;

    update public.sale_commissions set commission_id = v_comm where id = sc.id;
    v_period := public.attach_commission_to_draft(v_comm);

    v_new_action := public.fmt_qty(v_amt) || ' د.ع لـ' || emp.full_name ||
                    case when v_period is not null then ' — أُضيفت لكشف ' || v_period
                         else ' — تدخل كشفه القادم' end;

    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'استُحقّت لك عمولة',
              public.fmt_qty(v_amt) || ' د.ع عن الوحدة ' || v_unit ||
              case when v_period is not null
                   then ' — أُضيفت إلى كشف راتب ' || v_period || '.'
                   else ' — تدخل كشف راتبك القادم.' end,
              '/dashboard/me/salary', 'راتب', v_comm);
    end if;

  else
    v_new_action := 'لا خطة ولا قاعدة عمولة تنطبق على ' || emp.full_name;
  end if;

  perform public.log_unit_event(r.unit_id, 'موظف البيع',
    coalesce(old_emp, '—') || ' ← ' || emp.full_name || ' · ' || v_new_action);

  return jsonb_build_object('changed', true, 'old', v_old_action, 'new', v_new_action);
end; $fn$;

-- تأكيد المقدمة (120) يُنشئ صفّ commissions — اربطه بصفقته
create or replace function public.link_commission_to_sale()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.commission_id is not null and new.commission_id is distinct from old.commission_id then
    update public.commissions set sale_commission_id = new.id
     where id = new.commission_id and sale_commission_id is null;
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_link_commission_to_sale on public.sale_commissions;
create trigger trg_link_commission_to_sale
  after update of commission_id on public.sale_commissions
  for each row execute function public.link_commission_to_sale();


-- ------------------------------------------------------------
-- 8) فسخ البيع — نصّ 117 + صافي المصروف للوسيط + تحرير الموظف بالدالّة + الدلاء
-- ------------------------------------------------------------
create or replace function public.reverse_sale(p_res uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  bk public.broker_commissions%rowtype;
  v_unit text; v_rev uuid; v_recv uuid; v_entry uuid; v_net numeric;
  v_emp_action text := 'لا عمولة موظف';
  v_co_action  text := 'لا عمولة شركة';
  v_bk_action  text := 'لا عمولة وسيط';
begin
  if not public.is_admin() then
    raise exception 'فسخ البيع للمدير';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب الفسخ';
  end if;

  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status <> 'بيع مكتمل' then
    raise exception 'لا يُفسخ إلا بيع مكتمل (الحالة: %)', r.status;
  end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;
  select * into sc from public.sale_commissions where reservation_id = p_res;

  -- ===== الوسيط — تُفحص أولاً لأنها قد تمنع الفسخ =====
  select * into bk from public.broker_commissions
   where reservation_id = p_res and reversed_at is null for update;
  if bk.id is not null then
    v_net := public.broker_commission_net_paid(bk.id);
    if v_net > 0 then
      raise exception 'صُرف للوسيط % د.ع من عمولة هذه الصفقة — سجّل الاسترداد أولاً ثم افسخ',
        public.fmt_qty(v_net);
    end if;
  end if;

  -- ===== عمولة الشركة =====
  if sc.id is not null and coalesce(sc.company_amount, 0) > 0 then
    if sc.collected_at is not null then
      raise exception 'عمولة الشركة عن هذه الصفقة محصّلة في % — ردّها للمطوّر حركةٌ نقدية يسجّلها المدير قبل الفسخ',
        sc.collected_at::text;
    end if;

    if r.commission_accrual_entry_id is not null then
      select id into v_rev  from public.accounts where code = '4200';
      select id into v_recv from public.accounts where code = '1250';
      if v_rev is not null and v_recv is not null then
        insert into public.journal_entries (entry_date, description, reference, arm, source)
        values ((now() at time zone 'Asia/Baghdad')::date,
                'عكس عمولة صفقة مفسوخة — الوحدة ' || v_unit || ' — ' || btrim(p_reason),
                'COMMREV', 'إداري عام', 'reservations')
        returning id into v_entry;

        insert into public.journal_lines (entry_id, account_id, debit, credit)
        values (v_entry, v_rev,  sc.company_amount, 0),
               (v_entry, v_recv, 0,                sc.company_amount);

        update public.reservations set commission_reversal_entry_id = v_entry where id = p_res;
        v_co_action := 'عُكس استحقاق ' || public.fmt_qty(sc.company_amount) || ' د.ع';
      end if;
    end if;
  end if;

  -- ===== الموظف/الـRM: الأصل والفروق صفّاً صفّاً =====
  if sc.id is not null and sc.employee_id is not null then
    v_emp_action := public.release_sale_commission_accruals(sc.id, 'فسخ البيع — ' || btrim(p_reason));
  end if;

  if sc.id is not null then
    update public.sale_commissions
       set reversed_at = now(), reversal_reason = btrim(p_reason)
     where id = sc.id;

    if sc.employee_plan_id is not null then
      insert into public.sale_commission_adjustments
        (sale_commission_id, employee_id, old_rate, new_rate, old_amount, new_amount,
         reason, trigger_kind, settlement, actor, actor_name)
      values (sc.id, sc.employee_id, sc.employee_rate, 0, sc.employee_amount, 0,
              'فسخ البيع — ' || btrim(p_reason), 'فسخ', v_emp_action, auth.uid(), public.actor_display_name());

      perform public.recompute_employee_bucket(sc.employee_plan_id, sc.employee_id, sc.employee_period,
                                               'فسخ صفقة في الفترة نفسها', 'فسخ');
    end if;
  end if;

  -- ===== الوسيط: سطر تعديل، لا حذف، ثم دلوه =====
  if bk.id is not null then
    insert into public.broker_commission_adjustments
      (commission_id, old_rate, new_rate, old_amount, new_amount, period_units, period_measure,
       reason, trigger_kind, actor, actor_name)
    values (bk.id, bk.rate, 0, bk.amount, 0, null, null,
            'فسخ البيع — ' || btrim(p_reason), 'فسخ', auth.uid(), public.actor_display_name());

    update public.broker_commissions
       set reversed_at = now(), reversal_reason = btrim(p_reason), amount = 0
     where id = bk.id;

    if bk.plan_id is not null then
      perform public.recompute_broker_bucket(bk.plan_id, bk.company_id, bk.period_key,
                                             'فسخ صفقة في الفترة نفسها', 'فسخ');
    end if;

    v_bk_action := 'أُلغيت عمولة ' || public.fmt_qty(bk.amount) || ' د.ع وأُعيد حساب شريحة الفترة';
  end if;

  update public.invoices
     set cancelled_at = now(), cancel_reason = btrim(p_reason)
   where reservation_id = p_res and cancelled_at is null;

  update public.reservations
     set status = 'ملغى',
         notes = coalesce(notes || E'\n', '') || 'فُسخ البيع: ' || btrim(p_reason)
   where id = p_res;

  perform public.log_unit_event(r.unit_id, 'إلغاء حجز',
    'فُسخ بيع الوحدة ' || v_unit || ' — ' || btrim(p_reason));

  return jsonb_build_object(
    'unit', v_unit, 'company', v_co_action, 'employee', v_emp_action,
    'broker', v_bk_action, 'reversal_entry_id', v_entry);
end; $fn$;


-- ------------------------------------------------------------
-- 9) إدارة الخطط — دالّة واحدة ذرّية (لا حذف ثم إدراج من المتصفح)
-- ------------------------------------------------------------
-- p_plan: {id?, project_id, recipient_type, company_id?, employee_id?, formula,
--          basis, period, payable_rule, name?, notes?}
-- p_tiers: [{min_units?, min_value?, unit_type?, rate?, fixed_amount?}, ...]
create or replace function public.save_commission_plan(p_plan jsonb, p_tiers jsonb)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_id      uuid := nullif(p_plan->>'id', '')::uuid;
  old       public.commission_plans%rowtype;
  v_project uuid := (p_plan->>'project_id')::uuid;
  v_type    text := p_plan->>'recipient_type';
  v_company uuid := nullif(p_plan->>'company_id', '')::uuid;
  v_emp     uuid := nullif(p_plan->>'employee_id', '')::uuid;
  v_formula text := coalesce(nullif(p_plan->>'formula', ''), 'شرائح رجعية');
  v_basis   text := coalesce(nullif(p_plan->>'basis', ''), 'عدد الوحدات');
  v_period  text := coalesce(nullif(p_plan->>'period', ''), 'شهري');
  v_pay     text := coalesce(nullif(p_plan->>'payable_rule', ''), 'بعد تحصيل عمولة تلال');
  t         jsonb;
  v_used    boolean;
  g         record;
  v_base       numeric := case when v_basis = 'عدد الوحدات' then 1 else 0 end;
  v_base_label text    := case when v_basis = 'عدد الوحدات' then 'الوحدة ١' else 'القيمة ٠' end;
begin
  if not public.is_admin() then raise exception 'خطط العمولات للمدير'; end if;
  if v_project is null then raise exception 'اختر المشروع'; end if;
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'عرّف شريحة واحدة على الأقل';
  end if;

  -- التحقّق من الشرائح
  for t in select * from jsonb_array_elements(p_tiers) loop
    if v_basis = 'عدد الوحدات' and coalesce((t->>'min_units')::int, 0) < 1 then
      raise exception 'كل شريحة تبدأ من وحدةٍ (١ فأكثر)';
    end if;
    if v_basis = 'قيمة المبيعات' and (t->>'min_value') is null then
      raise exception 'كل شريحة تبدأ من قيمة مبيعات (٠ فأكثر)';
    end if;
    if nullif(t->>'rate', '') is null and nullif(t->>'fixed_amount', '') is null then
      raise exception 'لكل شريحة نسبة أو مبلغ ثابت';
    end if;
  end loop;

  for g in
    select nullif(e->>'unit_type', '') as ut,
           count(*) as n,
           count(distinct case when v_basis = 'عدد الوحدات' then (e->>'min_units')::numeric
                               else (e->>'min_value')::numeric end) as nd,
           min(case when v_basis = 'عدد الوحدات' then (e->>'min_units')::numeric
                    else (e->>'min_value')::numeric end) as lo
      from jsonb_array_elements(p_tiers) e
     group by 1
  loop
    if g.n <> g.nd then
      raise exception 'لا تتكرّر بداية شريحتين%', coalesce(' لنوع ' || g.ut, '');
    end if;
    -- ⚠️ لا CASE داخل شرط IF: ماسح plpgsql يقف عند THEN الأولى
    if g.lo <> v_base then
      raise exception 'ابدأ بشريحة من % — وإلا كانت أولى صفقات الفترة بلا نسبة%',
        v_base_label, coalesce(' (' || g.ut || ')', '');
    end if;
  end loop;

  if v_formula = 'ثابتة' and exists (
       select 1 from jsonb_array_elements(p_tiers) e
        group by nullif(e->>'unit_type', '') having count(*) > 1) then
    raise exception 'الصيغة الثابتة شريحةٌ واحدة (لكل نوع وحدة)';
  end if;

  if v_id is not null then
    select * into old from public.commission_plans where id = v_id for update;
    if not found then raise exception 'الخطة غير موجودة'; end if;

    v_used := exists (select 1 from public.broker_commissions where plan_id = v_id)
           or exists (select 1 from public.sale_commissions where employee_plan_id = v_id);

    if v_used and (old.formula, old.basis, old.period, old.recipient_type, old.project_id,
                   old.company_id, old.employee_id)
                  is distinct from (v_formula, v_basis, v_period, v_type, v_project, v_company, v_emp) then
      raise exception 'خطةٌ عليها عمولات لا تتغيّر صيغتها ولا أساسها ولا فترتها — أنشئ خطة جديدة تحلّ محلّها للمبيعات الجديدة';
    end if;

    update public.commission_plans
       set project_id = v_project, recipient_type = v_type, company_id = v_company,
           employee_id = v_emp, formula = v_formula, basis = v_basis, period = v_period,
           payable_rule = v_pay, name = nullif(p_plan->>'name', ''),
           notes = nullif(p_plan->>'notes', ''), updated_at = now()
     where id = v_id;
  else
    -- الخطة الجديدة تحلّ محلّ النشطة من نفس النوع؛ عمولات القديمة تبقى على خطّتها
    update public.commission_plans
       set is_active = false, updated_at = now()
     where is_active and project_id = v_project and recipient_type = v_type
       and company_id is not distinct from v_company and employee_id is not distinct from v_emp;

    insert into public.commission_plans
      (project_id, recipient_type, company_id, employee_id, formula, basis, period,
       payable_rule, name, notes, created_by)
    values (v_project, v_type, v_company, v_emp, v_formula, v_basis, v_period,
            v_pay, nullif(p_plan->>'name', ''), nullif(p_plan->>'notes', ''), auth.uid())
    returning id into v_id;
  end if;

  delete from public.commission_plan_tiers where plan_id = v_id;
  insert into public.commission_plan_tiers (plan_id, min_units, min_value, unit_type, rate, fixed_amount)
  select v_id,
         case when v_basis = 'عدد الوحدات' then (e->>'min_units')::int end,
         case when v_basis = 'قيمة المبيعات' then (e->>'min_value')::numeric end,
         nullif(e->>'unit_type', ''),
         nullif(e->>'rate', '')::numeric,
         nullif(e->>'fixed_amount', '')::numeric
    from jsonb_array_elements(p_tiers) e;

  return v_id;
end; $fn$;

create or replace function public.set_commission_plan_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare pl public.commission_plans%rowtype;
begin
  if not public.is_admin() then raise exception 'خطط العمولات للمدير'; end if;
  select * into pl from public.commission_plans where id = p_id for update;
  if not found then raise exception 'الخطة غير موجودة'; end if;
  if p_active and exists (
       select 1 from public.commission_plans c
        where c.is_active and c.id <> p_id and c.project_id = pl.project_id
          and c.recipient_type = pl.recipient_type
          and c.company_id is not distinct from pl.company_id
          and c.employee_id is not distinct from pl.employee_id) then
    raise exception 'توجد خطة نشطة من النوع نفسه — أوقفها أولاً';
  end if;
  update public.commission_plans set is_active = p_active, updated_at = now() where id = p_id;
end; $fn$;

-- إعادة حساب خطة: كل دلائها، أو فترة واحدة
create or replace function public.recalc_commission_plan(p_plan uuid, p_period text default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare pl public.commission_plans%rowtype; r record; n int := 0;
begin
  if not public.is_admin() then raise exception 'إعادة حساب العمولات للمدير'; end if;
  select * into pl from public.commission_plans where id = p_plan;
  if not found then raise exception 'الخطة غير موجودة'; end if;

  if pl.recipient_type = 'وسيط' then
    for r in
      select distinct bc.company_id, bc.period_key from public.broker_commissions bc
       where bc.plan_id = p_plan and bc.reversed_at is null
         and (p_period is null or bc.period_key = p_period)
    loop
      perform public.recompute_broker_bucket(p_plan, r.company_id, r.period_key,
        'إعادة حساب بعد تعديل الخطة', 'تعديل الخطة');
      n := n + 1;
    end loop;
  else
    for r in
      select distinct sc.employee_id, sc.employee_period from public.sale_commissions sc
       where sc.employee_plan_id = p_plan and sc.reversed_at is null
         and (p_period is null or sc.employee_period = p_period)
    loop
      perform public.recompute_employee_bucket(p_plan, r.employee_id, r.employee_period,
        'إعادة حساب بعد تعديل الخطة', 'تعديل الخطة');
      n := n + 1;
    end loop;
  end if;
  return n;
end; $fn$;


-- ------------------------------------------------------------
-- 10) دفتر العمولات الموحّد — الطبقات الأربع بأعمدة واحدة
-- ------------------------------------------------------------
-- security_invoker: كلٌّ يرى من الصفوف ما تسمح به سياسات مخازنها.
drop view if exists public.commission_ledger;
create view public.commission_ledger with (security_invoker = true) as
-- ١) تلال → الوسيط
select
  'وسيط'::text                    as recipient_type,
  bc.company_id                   as recipient_id,
  b.name                          as recipient_name,
  'بيع وسيط'::text                as commission_type,
  'وسيط'::text                    as sale_channel,
  bc.id                           as entry_id,
  bc.reservation_id, bc.project_id, bc.unit_id, bc.client_id,
  bc.plan_id, pl.name             as plan_name, pl.formula, pl.basis,
  bc.period_key                   as period,
  bc.period_measure               as tier_measure,
  bc.rate, bc.fixed_amount, bc.deal_amount, bc.amount,
  bc.earned_at, bc.payable_at,
  coalesce(p.net, 0)              as paid_amount,
  greatest(bc.amount - coalesce(p.net, 0), 0) as balance,
  case
    when bc.reversed_at is not null                               then 'مفسوخة'
    when bc.amount > 0 and coalesce(p.net, 0) >= bc.amount - 0.01 then 'مدفوعة'
    when coalesce(p.net, 0) > 0                                   then 'مدفوعة جزئياً'
    when bc.payable_at is not null                                then 'قابلة للصرف'
    else 'مستحقة'
  end                             as status,
  bc.reversed_at
from public.broker_commissions bc
join public.broker_companies b on b.id = bc.company_id
left join public.commission_plans pl on pl.id = bc.plan_id
left join lateral (
  select sum(case when bp.kind = 'استرداد' then -bp.amount else bp.amount end) as net
    from public.broker_payments bp where bp.commission_id = bc.id
) p on true

union all

-- ٢) تلال → الموظف (مباشر) أو الـRM (وسيط)
select
  coalesce(sc.employee_role, 'موظف مباشر'),
  sc.employee_id,
  e.full_name,
  case when sc.employee_role = 'مدير علاقات' then 'عمولة مدير علاقات (وسيط)' else 'بيع مباشر' end,
  coalesce(sc.sale_channel, 'مباشر'),
  sc.id,
  sc.reservation_id, sc.project_id, sc.unit_id, sc.client_id,
  sc.employee_plan_id, pl.name, pl.formula, pl.basis,
  sc.employee_period,
  sc.employee_measure,
  sc.employee_rate, sc.employee_fixed, sc.deal_amount, sc.employee_amount,
  (sc.created_at at time zone 'Asia/Baghdad')::date,
  acc.payable_at,
  greatest(coalesce(acc.paid, 0) - coalesce(ded.applied, 0), 0),
  greatest(sc.employee_amount - (coalesce(acc.paid, 0) - coalesce(ded.applied, 0)), 0),
  case
    when sc.reversed_at is not null                                         then 'مفسوخة'
    when sc.employee_amount > 0
         and coalesce(acc.paid, 0) - coalesce(ded.applied, 0) >= sc.employee_amount - 0.01 then 'مدفوعة'
    when coalesce(acc.paid, 0) > 0                                          then 'مدفوعة جزئياً'
    when acc.payable_at is not null                                         then 'قابلة للصرف'
    else 'مستحقة'
  end,
  sc.reversed_at
from public.sale_commissions sc
join public.employees e on e.id = sc.employee_id
left join public.commission_plans pl on pl.id = sc.employee_plan_id
left join lateral (
  select min(c.payable_at) as payable_at,
         sum(c.amount) filter (where pr.state is not null and pr.state <> 'مسودة') as paid
    from public.commissions c
    left join public.payrolls pr on pr.id = c.payroll_id
   where c.sale_commission_id = sc.id or c.id = sc.commission_id
) acc on true
left join lateral (
  select sum(d.amount) filter (where pr.state is not null and pr.state <> 'مسودة') as applied
    from public.deductions d
    left join public.payrolls pr on pr.id = d.payroll_id
   where d.sale_commission_id = sc.id
) ded on true
where sc.employee_id is not null

union all

-- ٣) المطوّر → تلال
select
  'تلال'::text,
  null::uuid,
  'تلال — من المطوّر'::text,
  'عمولة المطوّر'::text,
  coalesce(sc.sale_channel, 'مباشر'),
  sc.id,
  sc.reservation_id, sc.project_id, sc.unit_id, sc.client_id,
  null::uuid, null::text, 'شرائح المشروع'::text, 'ترتيب الصفقة'::text,
  null::text,
  sc.sales_index::numeric,
  sc.company_rate, null::numeric, sc.deal_amount, sc.company_amount,
  coalesce((r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date,
           (sc.created_at at time zone 'Asia/Baghdad')::date),
  di.issue_date,
  case when sc.collected_at is not null then sc.company_amount else 0 end,
  case when sc.collected_at is not null or sc.reversed_at is not null then 0 else sc.company_amount end,
  case
    when sc.reversed_at is not null           then 'مفسوخة'
    when sc.collected_at is not null          then 'محصّلة'
    when di.id is not null                    then 'مفوترة'
    when r.down_payment_confirmed_at is not null then 'مستحقة'
    else 'بانتظار المقدمة'
  end,
  sc.reversed_at
from public.sale_commissions sc
join public.reservations r on r.id = sc.reservation_id
left join public.developer_invoices di on di.reservation_id = sc.reservation_id and di.cancelled_at is null;

comment on view public.commission_ledger is
  'دفتر العمولات الموحّد (sql/129): وسيط، موظف مباشر، مدير علاقات، تلال من المطوّر — مستحق/قابل للدفع/مدفوع/الرصيد. security_invoker: يرى كلٌّ نطاقه.';

grant select on public.commission_ledger to authenticated;


-- ------------------------------------------------------------
-- 11) المنح
-- ------------------------------------------------------------
revoke execute on function public.commission_period_key(text, date)                 from public, anon;
revoke execute on function public.commission_plan_rate(uuid, numeric, text)         from public, anon;
revoke execute on function public.resolve_commission_plan(uuid, text, uuid, uuid)   from public, anon;
revoke execute on function public.commission_basis_label(uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.broker_commission_net_paid(uuid)                  from public, anon;
revoke execute on function public.recompute_broker_bucket(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.recompute_broker_tier(uuid, uuid, text, text)     from public, anon, authenticated;
revoke execute on function public.recompute_employee_bucket(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.release_sale_commission_accruals(uuid, text)      from public, anon, authenticated;
revoke execute on function public.legacy_employee_commission(uuid, uuid, numeric, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.resolve_commission_rule(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.release_broker_commission(uuid, text)             from public, anon;
revoke execute on function public.save_commission_plan(jsonb, jsonb)                from public, anon;
revoke execute on function public.set_commission_plan_active(uuid, boolean)         from public, anon;
revoke execute on function public.recalc_commission_plan(uuid, text)                from public, anon;

grant execute on function public.commission_period_key(text, date)                 to authenticated;
grant execute on function public.commission_plan_rate(uuid, numeric, text)         to authenticated;
grant execute on function public.resolve_commission_plan(uuid, text, uuid, uuid)   to authenticated;
grant execute on function public.broker_commission_net_paid(uuid)                  to authenticated;
grant execute on function public.resolve_commission_rule(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.release_broker_commission(uuid, text)             to authenticated;
grant execute on function public.save_commission_plan(jsonb, jsonb)                to authenticated;
grant execute on function public.set_commission_plan_active(uuid, boolean)         to authenticated;
grant execute on function public.recalc_commission_plan(uuid, text)                to authenticated;

notify pgrst, 'reload schema';
