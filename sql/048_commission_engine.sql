-- ============================================================
-- 048 — نظام العمولات: عمولة الشركة من المشروع، ونصيب الموظف
--
-- طبقتان مختلفتان لا واحدة:
--   1) **عمولة الشركة**: نسبتها من كل مشروع تختلف — الفرقان 0.5%
--      ولاماك 2% — وترتفع بالشرائح كلما زادت المبيعات.
--   2) **عمولة الموظف**: إمّا جزءٌ من عمولة الشركة، أو مبلغٌ
--      مقطوع يتبع مساحة الوحدة.
--
-- النسبة الواحدة في company_settings لم تكن تكفي: مشروعان
-- بنسبتين، وشريحة تتغيّر بعدد الصفقات، وموظفان بقاعدتين. وتبقى
-- تلك النسبة احتياطاً للفواتير اليدوية التي لا صفقة لها.
--
-- طُبّق على القاعدة في 2026-08-31 عبر هجرتين:
--   commission_engine_tables
--   commission_engine_functions
-- ============================================================

-- ===== 1) نسبة المشروع وهدفه =====
create table if not exists public.project_commissions (
  project_id   uuid primary key references public.projects(id) on delete cascade,
  base_rate    numeric not null default 0,
  target_sales int,
  notes        text,
  updated_at   timestamptz not null default now()
);

comment on column public.project_commissions.target_sales is
  'التاركت — عدد المبيعات المستهدف. للقياس لا للاحتساب.';

-- ===== 2) شرائح النسبة =====
-- «عند تجاوز 30 عملية بيع تصل إلى 2.5%» = صفٌّ min_sales=31 rate=2.5
create table if not exists public.commission_tiers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  min_sales  int  not null check (min_sales > 0),
  rate       numeric not null check (rate >= 0),
  unique (project_id, min_sales)
);

comment on column public.commission_tiers.min_sales is
  'من هذه الصفقة فصاعداً تُطبَّق النسبة — الترتيب داخل المشروع لا الإجمالي.';

-- ===== 3) قواعد عمولة الموظفين =====
create table if not exists public.employee_commission_rules (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  -- فارغ = تسري على الجميع / كل المشاريع
  employee_id uuid references public.employees(id) on delete cascade,
  project_id  uuid references public.projects(id)  on delete cascade,
  kind        text not null check (kind in (
                'نسبة من عمولة الشركة', 'نسبة من سعر البيع',
                'مبلغ لكل متر', 'مبلغ مقطوع')),
  value       numeric not null check (value >= 0),
  -- شرائح المساحة: فارغ = بلا حدّ من تلك الجهة
  min_area    numeric,
  max_area    numeric,
  active      boolean not null default true,
  notes       text
);

create index if not exists idx_ecr_lookup
  on public.employee_commission_rules(active, employee_id, project_id);

-- ===== 4) سجلّ عمولة كل صفقة =====
create table if not exists public.sale_commissions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  reservation_id   uuid not null unique references public.reservations(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  unit_id          uuid references public.units(id) on delete set null,
  client_id        uuid references public.clients(id) on delete set null,
  deal_amount      numeric not null,
  unit_area        numeric,
  sales_index      int not null,
  company_rate     numeric not null default 0,
  company_amount   numeric not null default 0,
  employee_id      uuid references public.employees(id) on delete set null,
  employee_basis   text,
  employee_amount  numeric not null default 0,
  rule_id          uuid references public.employee_commission_rules(id) on delete set null,
  commission_id    uuid references public.commissions(id) on delete set null,
  collected_at     date
);

create index if not exists idx_sale_comm_project  on public.sale_commissions(project_id);
create index if not exists idx_sale_comm_employee on public.sale_commissions(employee_id);

comment on column public.sale_commissions.sales_index is
  'ترتيب هذه الصفقة داخل المشروع — به تُعرف الشريحة المطبَّقة.';
comment on column public.sale_commissions.collected_at is
  'تاريخ تحصيل عمولة الشركة من المطوّر. فارغ = ما زالت مستحقّة.';

-- ============================================================
-- نسبة المشروع عند صفقة رقم N
-- أعلى شريحة بلغها الترتيب، وإلا النسبة الأساسية.
-- ============================================================
create or replace function public.project_commission_rate(p_project uuid, p_index int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.rate from public.commission_tiers t
      where t.project_id = p_project and t.min_sales <= p_index
      order by t.min_sales desc limit 1),
    (select pc.base_rate from public.project_commissions pc where pc.project_id = p_project),
    0
  );
$$;

-- ============================================================
-- قاعدة عمولة الموظف: الأخصّ يسبق الأعمّ
--
-- قاعدة الموظف في هذا المشروع، ثم قاعدته العامة، ثم قاعدة
-- المشروع للجميع، ثم العامة. وضمن الدرجة الواحدة تسبق القاعدة
-- التي تحدّد شريحة مساحة، لأن المخصّص أدقّ من المطلق.
-- ============================================================
create or replace function public.resolve_commission_rule(
  p_employee uuid, p_project uuid, p_area numeric
)
returns public.employee_commission_rules
language sql stable security definer set search_path = public as $$
  select r.*
  from public.employee_commission_rules r
  where r.active
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
$$;

-- ============================================================
-- تسجيل عمولة صفقة
--
-- تُحسب مرة عند إتمام البيع وتُخزَّن، لا تُحسب عند كل عرض:
-- النسبة تتغيّر بالشرائح والقواعد تُعدَّل، فحسابها لاحقاً كان
-- سيُعطي رقماً غير الذي استُحقّ يوم البيع.
-- ============================================================
create or replace function public.record_sale_commission(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  res record; u record; idx int; v_rate numeric; v_comp numeric;
  rule public.employee_commission_rules%rowtype;
  v_emp uuid; v_amt numeric := 0; v_basis text;
begin
  select * into res from public.reservations where id = p_reservation;
  if not found or res.status <> 'بيع مكتمل' then return; end if;

  -- صفقة واحدة سجلٌّ واحد: إعادة الحفظ لا تكرّرها ولا تعيد الحساب
  if exists (select 1 from public.sale_commissions s where s.reservation_id = p_reservation) then
    return;
  end if;

  select * into u from public.units where id = res.unit_id;
  if u is null then return; end if;

  -- ترتيب هذه الصفقة في مشروعها — عليه تُحدَّد الشريحة
  select count(*) into idx
  from public.reservations r
  join public.units un on un.id = r.unit_id
  where r.status = 'بيع مكتمل'
    and un.project_id is not distinct from u.project_id
    and r.created_at <= res.created_at;
  idx := greatest(coalesce(idx, 1), 1);

  v_rate := public.project_commission_rate(u.project_id, idx);
  v_comp := round(coalesce(u.price, 0) * v_rate / 100);

  v_emp := res.agent_id;
  if v_emp is null then
    select e.id into v_emp
    from public.clients c
    join public.employees e
      on public.name_key(e.full_name) = public.name_key(c.sales_employee)
    where c.id = res.client_id limit 1;
  end if;

  if v_emp is not null then
    select * into rule from public.resolve_commission_rule(v_emp, u.project_id, u.space_m2);
    if rule.id is not null then
      v_amt := case rule.kind
        when 'نسبة من عمولة الشركة' then round(v_comp * rule.value / 100)
        when 'نسبة من سعر البيع'    then round(coalesce(u.price, 0) * rule.value / 100)
        when 'مبلغ لكل متر'          then round(coalesce(u.space_m2, 0) * rule.value)
        else round(rule.value)
      end;
      v_basis := rule.kind || ' — ' || rule.value ||
                 case when rule.kind like 'نسبة%' then '%' else ' د.ع' end;
    end if;
  end if;

  insert into public.sale_commissions (
    reservation_id, project_id, unit_id, client_id, deal_amount, unit_area,
    sales_index, company_rate, company_amount,
    employee_id, employee_basis, employee_amount, rule_id
  ) values (
    p_reservation, u.project_id, res.unit_id, res.client_id,
    coalesce(u.price, 0), u.space_m2, idx, v_rate, v_comp,
    v_emp, v_basis, coalesce(v_amt, 0), rule.id
  );
end; $$;

create or replace function public.on_sale_record_commission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'بيع مكتمل' then
    perform public.record_sale_commission(new.id);
  end if;
  return null;
end; $$;

drop trigger if exists trg_record_sale_commission on public.reservations;
create trigger trg_record_sale_commission
  after insert or update of status on public.reservations
  for each row execute function public.on_sale_record_commission();

-- ============================================================
-- استحقاق عمولة الموظف عند اكتمال السداد
--
-- المبلغ من سجلّ الصفقة إن وُجد — فهو المحسوب بقواعد يوم البيع.
-- وإن لم يوجد (فاتورة يدوية) تُستعمل النسبة العامة كما كانت.
-- ============================================================
create or replace function public.settle_invoice_commission(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv record; s record; sc record; v_paid numeric;
  emp public.employees%rowtype;
  v_rate numeric; v_amount numeric; v_desc text;
  existing record; new_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found then return; end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not coalesce(s.auto_commission_on_paid, true) then return; end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p where p.invoice_id = p_invoice;

  select * into existing from public.commissions where invoice_id = p_invoice;

  if v_paid < inv.total_amount then
    if existing.id is not null and existing.auto and existing.payroll_id is null then
      update public.sale_commissions set commission_id = null where commission_id = existing.id;
      delete from public.commissions where id = existing.id;
    end if;
    return;
  end if;

  if existing.id is not null then return; end if;

  if inv.reservation_id is not null then
    select * into sc from public.sale_commissions where reservation_id = inv.reservation_id;
  end if;

  if sc.id is not null then
    if sc.employee_id is null or coalesce(sc.employee_amount, 0) <= 0 then return; end if;
    select * into emp from public.employees where id = sc.employee_id;
    v_amount := sc.employee_amount;
    v_desc := 'عمولة بيع — ' || coalesce(sc.employee_basis, '') ||
              ' (الفاتورة ' || inv.invoice_number || ')';
  else
    select e.* into emp
    from public.clients c
    join public.employees e
      on public.name_key(e.full_name) = public.name_key(c.sales_employee)
    where c.id = inv.client_id limit 1;

    if emp.id is null then return; end if;
    v_rate := coalesce(emp.commission_rate, s.commission_rate, 0);
    if v_rate <= 0 then return; end if;
    v_amount := round(inv.total_amount * v_rate / 100);
    v_desc := 'عمولة ' || v_rate || '% على الفاتورة ' || inv.invoice_number;
  end if;

  if emp.id is null or emp.status <> 'active' or coalesce(v_amount, 0) <= 0 then return; end if;

  insert into public.commissions (employee_id, amount, comm_date, description, invoice_id, auto)
  values (emp.id, v_amount, (now() at time zone 'Asia/Baghdad')::date, v_desc, p_invoice, true)
  returning id into new_id;

  if sc.id is not null then
    update public.sale_commissions set commission_id = new_id where id = sc.id;
  end if;

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind)
    values (emp.user_id, 'استُحقّت لك عمولة',
            public.fmt_qty(v_amount) || ' د.ع عن الفاتورة ' || inv.invoice_number ||
              ' — تُضاف إلى كشف راتبك القادم.',
            '/dashboard/me/salary', 'راتب');
  end if;
end; $$;

-- ===== RLS =====
alter table public.project_commissions       enable row level security;
alter table public.commission_tiers          enable row level security;
alter table public.employee_commission_rules enable row level security;
alter table public.sale_commissions          enable row level security;

drop policy if exists "admin manages project commissions" on public.project_commissions;
create policy "admin manages project commissions" on public.project_commissions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "team reads project commissions" on public.project_commissions;
create policy "team reads project commissions" on public.project_commissions
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_supervisor()));

drop policy if exists "admin manages tiers" on public.commission_tiers;
create policy "admin manages tiers" on public.commission_tiers
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "team reads tiers" on public.commission_tiers;
create policy "team reads tiers" on public.commission_tiers
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_supervisor()));

drop policy if exists "admin manages employee rules" on public.employee_commission_rules;
create policy "admin manages employee rules" on public.employee_commission_rules
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- الموظف يرى القاعدة التي تخصّه: يحقّ له أن يعرف كيف تُحتسب عمولته
drop policy if exists "read my commission rule" on public.employee_commission_rules;
create policy "read my commission rule" on public.employee_commission_rules
  for select to authenticated
  using (
    (select public.is_admin()) or (select public.is_supervisor())
    or employee_id = (select public.my_employee_id())
    or employee_id is null
  );

drop policy if exists "admin manages sale commissions" on public.sale_commissions;
create policy "admin manages sale commissions" on public.sale_commissions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read my sale commissions" on public.sale_commissions;
create policy "read my sale commissions" on public.sale_commissions
  for select to authenticated
  using (
    (select public.is_admin()) or (select public.is_supervisor())
    or employee_id = (select public.my_employee_id())
  );
