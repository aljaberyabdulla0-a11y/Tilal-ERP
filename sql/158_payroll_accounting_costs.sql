-- ============================================================
-- تلال ERP — 158: ربط الحسابات، مراكز الكلفة، التوزيع، القسيمة (المرحلة 5)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 157.
--
-- ============================================================
-- ١) ربط الحسابات قابل للإعداد
--
-- أرقام الحسابات مكتوبة في خمس دوالّ ترحيل: 5100 مصروف الرواتب، 2300
-- الرواتب المستحقة، 1360 سلف الموظفين، 2310 الضريبة، 2320 الضمان، 5500
-- العمولات. صارت جدولاً (hr_account_map) يديره المحاسب، وقيمه الافتراضية
-- هي الأرقام الحالية نفسها — فلا يتغيّر قيدٌ واحد بهذه الهجرة.
--
-- التغيير في الدوالّ تبديلٌ نصّي لسطر البحث عن الحساب وحده، على النسخة
-- الحيّة مباشرةً (الكتلة في §١)، فيبقى كل ما سواه حرفياً. حسابات النقد
-- (1100/1200/2500) شأن الخزينة لا الرواتب — لم تُمسّ.
--
-- ============================================================
-- ٢) مراكز الكلفة والتوزيع على المشاريع
--
--   cost_centers                    مركز لكل قسم ولكل مشروع + «عام»
--   employees.cost_center_id        تجاوزٌ اختياري لمركز الموظف
--   employee_project_allocations    الموظف على أكثر من مشروع بنِسَب (≤ 100%)
--   payroll_cost_allocation()       كلفة الكشف موزّعةً على المشاريع بالنِّسَب
--   department_costs()              كلفة كل قسم: أساسي، بدلات، إضافي، مكافآت، عمولات
--
-- تقارير قراءة فقط — لا تمسّ القيود. القيد يبقى كما هو (مشروعه من 116).
--
-- ============================================================
-- ٣) قسيمة الراتب: salary_slip() — للموظف قسائمه المعتمدة فقط، ولـ HR والمالية الكل.
-- ============================================================


-- ============================================================
-- ١) ربط الحسابات
-- ============================================================
create table if not exists public.hr_account_map (
  key           text primary key,
  label         text not null,
  account_code  text not null references public.accounts(code) on update cascade on delete restrict,
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid() references auth.users(id) on delete set null
);

insert into public.hr_account_map (key, label, account_code) values
  ('salary_expense',          'مصروف الرواتب (مدين عند اعتماد الكشف)',     '5100'),
  ('salary_payable',          'الرواتب المستحقة (دائن، وتُسدَّد بالدفع)',  '2300'),
  ('employee_advances',       'سلف الموظفين',                              '1360'),
  ('income_tax_payable',      'ضريبة الدخل المستحقة',                      '2310'),
  ('social_security_payable', 'الضمان الاجتماعي المستحق',                  '2320'),
  ('commission_expense',      'مصروف العمولات (عند استحقاقها)',            '5500')
on conflict (key) do nothing;

create or replace function public.hr_account(p_key text)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.hr_account_map m join public.accounts a on a.code = m.account_code where m.key = p_key;
$$;

revoke all on function public.hr_account(text) from public, anon, authenticated;

alter table public.hr_account_map enable row level security;
drop policy if exists "read hr account map" on public.hr_account_map;
create policy "read hr account map" on public.hr_account_map for select to authenticated
  using ((select public.can_see_payroll()) or (select public.can_manage_finance()));
drop policy if exists "finance manages hr account map" on public.hr_account_map;
create policy "finance manages hr account map" on public.hr_account_map for update to authenticated
  using ((select public.can_manage_finance())) with check ((select public.can_manage_finance()));
revoke all on public.hr_account_map from anon;

drop trigger if exists trg_audit_hr_account_map on public.hr_account_map;
create trigger trg_audit_hr_account_map after insert or update or delete on public.hr_account_map
  for each row execute function public.audit_row();

-- التبديل النصّي على النسخ الحيّة — سطر البحث وحده
do $$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
    ('public.repost_payroll(uuid)',          'select id into v_exp from public.accounts where code=''5100'';',        'v_exp := public.hr_account(''salary_expense'');'),
    ('public.repost_payroll(uuid)',          'select id into v_due from public.accounts where code=''2300'';',        'v_due := public.hr_account(''salary_payable'');'),
    ('public.repost_payroll(uuid)',          'select id into v_adv from public.accounts where code=''1360'';',        'v_adv := public.hr_account(''employee_advances'');'),
    ('public.repost_payroll(uuid)',          'select id into v_tax from public.accounts where code=''2310'';',        'v_tax := public.hr_account(''income_tax_payable'');'),
    ('public.repost_payroll(uuid)',          'select id into v_soc from public.accounts where code=''2320'';',        'v_soc := public.hr_account(''social_security_payable'');'),
    ('public.repost_payroll_payment(uuid)',  'select id into v_due  from public.accounts where code = ''2300'';',     'v_due := public.hr_account(''salary_payable'');'),
    ('public.post_commission_to_ledger()',   'select id into v_expense from public.accounts where code = ''5500'';',  'v_expense := public.hr_account(''commission_expense'');'),
    ('public.post_commission_to_ledger()',   'select id into v_due     from public.accounts where code = ''2300'';',  'v_due := public.hr_account(''salary_payable'');'),
    ('public.repost_commission(uuid)',       'select id into v_exp from public.accounts where code = ''5500'';',      'v_exp := public.hr_account(''commission_expense'');'),
    ('public.repost_commission(uuid)',       'select id into v_due from public.accounts where code = ''2300'';',      'v_due := public.hr_account(''salary_payable'');'),
    ('public.disburse_advance(uuid,text,date)', 'select id into v_recv from public.accounts where code = ''1360'';',   'v_recv := public.hr_account(''employee_advances'');')
  ) v(fn, old_line, new_line)
  loop
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r\n', E'\n');
    if position(r.old_line in v_def) = 0 then
      if position(r.new_line in v_def) > 0 then continue; end if;
      raise exception 'لم يُعثر على سطر الحساب في % — راجع النسخة الحيّة قبل التطبيق', r.fn;
    end if;
    execute replace(v_def, r.old_line, r.new_line);
  end loop;
end $$;


-- ============================================================
-- ٢) مراكز الكلفة
-- ============================================================
create table if not exists public.cost_centers (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9_-]{2,40}$'),
  name_ar        text not null,
  kind           text not null check (kind in ('قسم', 'مشروع', 'عام')),
  department_id  uuid unique references public.departments(id) on delete set null,
  project_id     uuid unique references public.projects(id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into public.cost_centers (code, name_ar, kind) values ('CC-GEN', 'عام / إداري', 'عام')
on conflict (code) do nothing;

insert into public.cost_centers (code, name_ar, kind, department_id)
select 'CC-' || d.code, d.name_ar, 'قسم', d.id from public.departments d
 where not exists (select 1 from public.cost_centers c where c.department_id = d.id)
on conflict (code) do nothing;

insert into public.cost_centers (code, name_ar, kind, project_id)
select 'CC-P' || lpad(row_number() over (order by p.created_at)::text, 3, '0'), p.name, 'مشروع', p.id
  from public.projects p
 where not exists (select 1 from public.cost_centers c where c.project_id = p.id)
on conflict (code) do nothing;

-- قسم أو مشروع جديد ⇒ مركزه
create or replace function public.ensure_cost_center()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'departments' then
    insert into public.cost_centers (code, name_ar, kind, department_id)
    values ('CC-' || new.code, new.name_ar, 'قسم', new.id)
    on conflict do nothing;
  else
    insert into public.cost_centers (code, name_ar, kind, project_id)
    values ('CC-P-' || upper(left(replace(new.id::text, '-', ''), 8)), new.name, 'مشروع', new.id)
    on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_cost_center_department on public.departments;
create trigger trg_cost_center_department after insert on public.departments
  for each row execute function public.ensure_cost_center();
drop trigger if exists trg_cost_center_project on public.projects;
create trigger trg_cost_center_project after insert on public.projects
  for each row execute function public.ensure_cost_center();

alter table public.employees
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;

comment on column public.employees.cost_center_id is
  'تجاوز اختياري (158). الافتراضي: مركز قسم الموظف.';


-- ============================================================
-- ٣) توزيع الموظف على المشاريع
-- ============================================================
create table if not exists public.employee_project_allocations (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  role            text,
  allocation_pct  numeric not null check (allocation_pct > 0 and allocation_pct <= 100),
  start_date      date not null,
  end_date        date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint employee_project_allocations_range check (end_date is null or end_date >= start_date)
);

comment on column public.employee_project_allocations.project_id is
  'فارغ = حصّة «عام/الشركة» (158).';

create index if not exists employee_project_allocations_emp_idx on public.employee_project_allocations (employee_id, start_date);

-- لا يتجاوز مجموع النِّسَب المتزامنة 100%
create or replace function public.guard_project_allocation()
returns trigger language plpgsql set search_path = public as $$
declare v_sum numeric;
begin
  select coalesce(sum(a.allocation_pct), 0) into v_sum
    from public.employee_project_allocations a
   where a.employee_id = new.employee_id and a.id is distinct from new.id
     and a.start_date <= coalesce(new.end_date, 'infinity'::date)
     and coalesce(a.end_date, 'infinity'::date) >= new.start_date;
  if v_sum + new.allocation_pct > 100 then
    raise exception 'مجموع توزيع الموظف في هذه الفترة يصير %٪ — الحدّ 100٪', v_sum + new.allocation_pct;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_project_allocation on public.employee_project_allocations;
create trigger trg_guard_project_allocation before insert or update on public.employee_project_allocations
  for each row execute function public.guard_project_allocation();


-- ============================================================
-- ٤) تحليل الكلفة — قراءة فقط
-- ============================================================

-- كلفة الكشف (أساسي + بدلات وإضافي ومكافآت + عمولات) موزّعةً على المشاريع
create or replace function public.payroll_cost_allocation(p_from text, p_to text)
returns table (period text, employee_id uuid, employee_name text, department_name text,
               project_id uuid, project_name text, share_pct numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  p record; a record;
  v_cost numeric; v_left numeric; v_mid date;
begin
  if not (public.can_see_payroll() or public.can_manage_finance()) then
    raise exception 'تحليل كلفة الرواتب لـ HR والمالية';
  end if;

  for p in
    select pr.*, e.full_name, e.department, e.project_id as emp_project
      from public.payrolls pr join public.employees e on e.id = pr.employee_id
     where pr.period between p_from and p_to
  loop
    v_cost := coalesce(p.basic, 0) + coalesce(p.allowances, 0) + coalesce(p.commissions_total, 0);
    if v_cost <= 0 then continue; end if;
    v_mid := to_date(p.period || '-15', 'YYYY-MM-DD');
    v_left := 100;

    for a in
      select x.project_id as pid, pj.name as pname, sum(x.allocation_pct) as pct
        from public.employee_project_allocations x
        left join public.projects pj on pj.id = x.project_id
       where x.employee_id = p.employee_id and x.start_date <= v_mid
         and coalesce(x.end_date, 'infinity'::date) >= v_mid
       group by x.project_id, pj.name
    loop
      period := p.period; employee_id := p.employee_id; employee_name := p.full_name;
      department_name := p.department; project_id := a.pid; project_name := coalesce(a.pname, 'عام');
      share_pct := a.pct; cost := round(v_cost * a.pct / 100);
      v_left := v_left - a.pct;
      return next;
    end loop;

    if v_left > 0 then
      period := p.period; employee_id := p.employee_id; employee_name := p.full_name;
      department_name := p.department;
      project_id := coalesce(p.project_id, p.emp_project);
      select pj.name into project_name from public.projects pj where pj.id = project_id;
      project_name := coalesce(project_name, 'عام');
      share_pct := v_left; cost := round(v_cost * v_left / 100);
      return next;
    end if;
  end loop;
end $$;

-- كلفة كل مشروع (مجموع التوزيع) — المجموع في القاعدة لا في المتصفح
create or replace function public.project_payroll_costs(p_from text, p_to text)
returns table (project_id uuid, project_name text, employees int, cost numeric)
language sql stable security definer set search_path = public as $$
  select a.project_id, a.project_name, count(distinct a.employee_id)::int, sum(a.cost)
    from public.payroll_cost_allocation(p_from, p_to) a
   group by a.project_id, a.project_name
   order by 4 desc;
$$;

revoke all on function public.project_payroll_costs(text, text) from public, anon;
grant execute on function public.project_payroll_costs(text, text) to authenticated;

-- كلفة كل قسم من بنود الكشوف
create or replace function public.department_costs(p_from text, p_to text)
returns table (department_id uuid, department_name text, employees int, basic numeric, allowances numeric,
               overtime numeric, bonuses numeric, commissions numeric, deductions numeric, total_cost numeric)
language sql stable security definer set search_path = public as $$
  select d.id, coalesce(d.name_ar, 'بلا قسم'),
         count(distinct pr.employee_id)::int,
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق' and l.category = 'راتب أساسي'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق' and l.category in ('بدل', 'استحقاق آخر')), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق' and l.category = 'عمل إضافي'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق' and l.category = 'مكافأة'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق' and l.category = 'عمولة'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استقطاع'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'استحقاق'), 0)
    from public.payrolls pr
    join public.employees e on e.id = pr.employee_id
    left join public.departments d on d.id = e.department_id
    left join public.payroll_lines l on l.payroll_id = pr.id
   where pr.period between p_from and p_to
     and (public.can_see_payroll() or public.can_manage_finance())
   group by d.id, d.name_ar
   order by 10 desc;
$$;


-- ============================================================
-- ٥) قسيمة الراتب
-- ============================================================
create or replace function public.salary_slip(p_payroll uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr public.payrolls%rowtype;
  e public.employees%rowtype;
  v_paid numeric;
  v_company text;
begin
  select * into pr from public.payrolls where id = p_payroll;
  if not found then raise exception 'الكشف غير موجود'; end if;
  select * into e from public.employees where id = pr.employee_id;

  if not (public.can_see_payroll() or public.can_manage_finance()
          or (pr.employee_id = public.my_employee_id() and pr.state <> 'مسودة')) then
    raise exception 'لا صلاحية لهذه القسيمة';
  end if;

  select coalesce(sum(x.amount), 0) into v_paid from public.payroll_payments x where x.payroll_id = p_payroll;
  select s.office_name into v_company from public.company_settings s where s.id = 1;

  return jsonb_build_object(
    'company', v_company,
    'payroll_id', pr.id, 'period', pr.period, 'state', pr.state, 'status', pr.status,
    'employee', jsonb_build_object(
      'name', e.full_name, 'code', e.employee_code, 'position', e.job_title, 'department', e.department,
      'hire_date', e.hire_date, 'bank', e.bank_name,
      -- آخر أربعة أرقام فقط على الورقة
      'iban_tail', case when e.bank_iban is not null then right(regexp_replace(e.bank_iban, '\s', '', 'g'), 4) end),
    'earnings', coalesce((select jsonb_agg(jsonb_build_object('category', l.category, 'description', l.description,
                                   'amount', l.amount) order by l.category, l.created_at)
                            from public.payroll_lines l where l.payroll_id = pr.id and l.kind = 'استحقاق'), '[]'::jsonb),
    'deductions', coalesce((select jsonb_agg(jsonb_build_object('category', l.category, 'description', l.description,
                                   'amount', l.amount) order by l.category, l.created_at)
                            from public.payroll_lines l where l.payroll_id = pr.id and l.kind = 'استقطاع'), '[]'::jsonb),
    'totals', jsonb_build_object(
      'basic', pr.basic, 'allowances', pr.allowances, 'commissions', pr.commissions_total,
      'gross', coalesce(pr.basic, 0) + coalesce(pr.allowances, 0) + coalesce(pr.commissions_total, 0),
      'deductions', pr.deductions_total, 'net', pr.net, 'paid', v_paid,
      'remaining', greatest(coalesce(pr.net, 0) - v_paid, 0)),
    'approved_at', pr.approved_at
  );
end $$;


-- ============================================================
-- ٦) RLS
-- ============================================================
alter table public.cost_centers                 enable row level security;
alter table public.employee_project_allocations enable row level security;

drop policy if exists "read cost centers" on public.cost_centers;
create policy "read cost centers" on public.cost_centers for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "finance hr manage cost centers" on public.cost_centers;
create policy "finance hr manage cost centers" on public.cost_centers for all to authenticated
  using ((select public.can_manage_finance()) or (select public.can_manage_hr()))
  with check ((select public.can_manage_finance()) or (select public.can_manage_hr()));

drop policy if exists "read allocations" on public.employee_project_allocations;
create policy "read allocations" on public.employee_project_allocations for select to authenticated
  using ((select public.can_manage_hr()) or (select public.can_manage_finance())
         or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t));
drop policy if exists "hr manages allocations" on public.employee_project_allocations;
create policy "hr manages allocations" on public.employee_project_allocations for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

revoke all on public.cost_centers, public.employee_project_allocations from anon;

drop trigger if exists trg_audit_cost_centers on public.cost_centers;
create trigger trg_audit_cost_centers after insert or update or delete on public.cost_centers
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_project_allocations on public.employee_project_allocations;
create trigger trg_audit_project_allocations after insert or update or delete on public.employee_project_allocations
  for each row execute function public.audit_row();

revoke all on function public.payroll_cost_allocation(text, text) from public, anon;
revoke all on function public.department_costs(text, text)        from public, anon;
revoke all on function public.salary_slip(uuid)                   from public, anon;
grant execute on function public.payroll_cost_allocation(text, text) to authenticated;
grant execute on function public.department_costs(text, text)        to authenticated;
grant execute on function public.salary_slip(uuid)                   to authenticated;
