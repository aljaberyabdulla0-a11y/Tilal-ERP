-- ============================================================
-- تلال ERP — 061: أرصدة الإجازات (المرحلة ٢)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المشكلة =====
--
-- جدول leaves فيه طلبٌ وقرار فقط: لا رصيد، ولا مستحَقّ سنوي، ولا
-- أثر مالي. والموظف يطلب ما شاء ولا يعرف ماذا بقي له، ونوع
-- «بدون راتب» موجود في القائمة **ولا يولّد خصماً** — يوافق المدير
-- ويُدفع الراتب كاملاً.
--
-- ===== المبدأ: الرصيد يُشتقّ ولا يُخزَّن =====
--
-- لا عمود اسمه «الرصيد المتبقّي» يُكتب فيه رقم. الرصيد **مجموع
-- حركات** في leave_ledger: استحقاق شهري موجب، واستهلاك سالب،
-- وتسوية يدوية موقَّعة. ورقمٌ مخزَّن يُحرَّر بيدٍ يفقد صلته بما
-- جرى فعلاً — كما كانت مجاميع كشف الراتب قبل sql/051.
--
--   الرصيد = Σ leave_ledger.days لتلك السنة
--
-- ===== الجداول الثلاثة =====
--
--   leave_types        سياسة كل نوع: كم يستحقّ سنوياً، أيُخصم من
--                      الراتب، أيُرحَّل، أيُشترط له رصيد.
--   leave_entitlements الخطة: ما يستحقّه موظفٌ من نوعٍ في سنة.
--   leave_ledger       الواقع: كل حركة رصيد بسببها وتاريخها.
--
-- ⚠️ بذور الأنواع الأربعة تُزرع **بما لا يغيّر سلوك اليوم**:
--    «سنوية» ٢١ يوماً بتراكم شهري بلا ترحيل (قرار المالك).
--    «بدون راتب» تُخصم من الراتب ولا رصيد لها.
--    «مرضية» و«طارئة» بلا رصيد وبلا خصم — **لأن المالك لم يحدّد
--    لهما عدداً بعد**. لا أفترض سياسةً لم تُقَل: تُضبطان من الشاشة
--    متى قرّر، والمحرّك يقرأ الأرقام ولا يحملها.
--
-- ===== التراجع =====
--   حذف المحفّزات ثم الدوالّ ثم الجداول الثلاثة، واستعادة
--   build_payroll من sql/060.
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة:
--   leave_balances
--
-- يتطلب: sql/057 (salary_at) و sql/060 (بنود الدوام).
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) سياسة كل نوع
-- ------------------------------------------------------------
create table if not exists public.leave_types (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  annual_days      numeric not null default 0 check (annual_days >= 0),
  accrues_monthly  boolean not null default true,
  requires_balance boolean not null default false,
  deducts_salary   boolean not null default false,
  carries_over     boolean not null default false,
  active           boolean not null default true,
  sort_order       int not null default 0
);

comment on table public.leave_types is
  'سياسة أنواع الإجازات — بيانات لا كود. تُعدَّل من الشاشة بلا هجرة (sql/061).';
comment on column public.leave_types.requires_balance is
  'true = يُمنع الموظف من طلب ما يتجاوز رصيده. المدير يتجاوزه بموافقة صريحة.';
comment on column public.leave_types.deducts_salary is
  'true = أيام الإجازة تُنتج بند استقطاع في كشف الشهر.';

insert into public.leave_types
  (name, annual_days, accrues_monthly, requires_balance, deducts_salary, carries_over, sort_order)
values
  ('سنوية',      21, true,  true,  false, false, 1),
  ('مرضية',       0, false, false, false, false, 2),
  ('طارئة',       0, false, false, false, false, 3),
  ('بدون راتب',   0, false, false, true,  false, 4)
on conflict (name) do nothing;


-- ------------------------------------------------------------
-- 2) الخطة السنوية
-- ------------------------------------------------------------
create table if not exists public.leave_entitlements (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year          int  not null,
  entitled_days numeric not null default 0 check (entitled_days >= 0),
  created_at    timestamptz not null default now(),
  constraint leave_entitlements_uniq unique (employee_id, leave_type_id, year)
);


-- ------------------------------------------------------------
-- 3) دفتر الحركات — مصدر الرصيد الوحيد
-- ------------------------------------------------------------
create table if not exists public.leave_ledger (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  leave_type_id   uuid not null references public.leave_types(id) on delete cascade,
  entry_date      date not null default current_date,
  -- موجب = استحقاق · سالب = استهلاك
  days            numeric not null,
  kind            text not null check (kind in
                   ('استحقاق شهري','استهلاك','ترحيل','تسوية يدوية')),
  leave_id        uuid references public.leaves(id) on delete cascade,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text
);

create index if not exists leave_ledger_lookup
  on public.leave_ledger (employee_id, leave_type_id, entry_date);
create index if not exists leave_ledger_leave on public.leave_ledger (leave_id);

-- استحقاقٌ واحد لكل شهر لكل نوع — يمنع تكرار مهمّة cron
create unique index if not exists leave_ledger_monthly_uniq
  on public.leave_ledger (employee_id, leave_type_id, entry_date)
  where kind = 'استحقاق شهري';

comment on table public.leave_ledger is
  'حركات رصيد الإجازات. الرصيد = مجموع days، ولا يُخزَّن رقماً يُحرَّر (sql/061).';


-- ------------------------------------------------------------
-- 4) الرصيد
-- ------------------------------------------------------------
create or replace function public.leave_balance(
  p_employee uuid, p_type uuid, p_year int default null
)
returns numeric
language sql stable security definer set search_path = public
as $fn$
  select coalesce(sum(l.days), 0)
    from public.leave_ledger l
   where l.employee_id = p_employee
     and l.leave_type_id = p_type
     and extract(year from l.entry_date)::int
         = coalesce(p_year, extract(year from (now() at time zone 'Asia/Baghdad'))::int);
$fn$;

-- أرصدة موظف بكل الأنواع — للشاشات.
-- ⚠️ تفحص الصلاحية بنفسها: الموظف يرى أرصدته، والمدير الجميع.
create or replace function public.leave_balances_for(p_employee uuid)
returns table (
  leave_type_id uuid, type_name text, entitled numeric,
  accrued numeric, used numeric, balance numeric,
  requires_balance boolean, deducts_salary boolean
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_year int;
begin
  if not public.is_admin()
     and p_employee is distinct from public.my_employee_id() then
    raise exception 'أرصدة الإجازات لصاحبها أو للمدير';
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Baghdad'))::int;

  return query
  select t.id, t.name,
         coalesce(en.entitled_days, t.annual_days),
         coalesce((select sum(l.days) from public.leave_ledger l
                    where l.employee_id = p_employee and l.leave_type_id = t.id
                      and l.days > 0 and extract(year from l.entry_date)::int = v_year), 0),
         coalesce((select -sum(l.days) from public.leave_ledger l
                    where l.employee_id = p_employee and l.leave_type_id = t.id
                      and l.days < 0 and extract(year from l.entry_date)::int = v_year), 0),
         public.leave_balance(p_employee, t.id, v_year),
         t.requires_balance, t.deducts_salary
    from public.leave_types t
    left join public.leave_entitlements en
      on en.employee_id = p_employee and en.leave_type_id = t.id and en.year = v_year
   where t.active
   order by t.sort_order;
end;
$fn$;


-- ------------------------------------------------------------
-- 5) الاستحقاق الشهري
-- ------------------------------------------------------------
-- يُنادى من pg_cron أول كل شهر. آمن لإعادة التشغيل: الفريد الجزئي
-- يمنع استحقاقاً ثانياً لنفس الشهر.
create or replace function public.accrue_monthly_leave()
returns integer
language plpgsql security definer set search_path = public
as $fn$
declare
  e record; t record; v_year int; v_first date; v_n int := 0;
begin
  v_first := date_trunc('month', (now() at time zone 'Asia/Baghdad'))::date;
  v_year  := extract(year from v_first)::int;

  for e in select * from public.employees where status = 'active' loop
    for t in select * from public.leave_types
              where active and accrues_monthly and annual_days > 0 loop

      -- لا استحقاق عن شهورٍ سبقت التعيين
      if e.hire_date is not null and e.hire_date > (v_first + interval '1 month - 1 day')::date then
        continue;
      end if;

      insert into public.leave_entitlements (employee_id, leave_type_id, year, entitled_days)
      values (e.id, t.id, v_year, t.annual_days)
      on conflict (employee_id, leave_type_id, year) do nothing;

      insert into public.leave_ledger
        (employee_id, leave_type_id, entry_date, days, kind, note, created_by_name)
      values (e.id, t.id, v_first,
              round(coalesce(
                (select en.entitled_days from public.leave_entitlements en
                  where en.employee_id = e.id and en.leave_type_id = t.id and en.year = v_year),
                t.annual_days) / 12.0, 2),
              'استحقاق شهري',
              'استحقاق ' || to_char(v_first, 'YYYY-MM'), 'النظام')
      on conflict do nothing;

      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end;
$fn$;

-- غلافٌ لتشغيلها يدوياً من الشاشة
create or replace function public.run_leave_accrual()
returns integer language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'تشغيل استحقاق الإجازات للمدير';
  end if;
  return public.accrue_monthly_leave();
end;
$fn$;


-- ------------------------------------------------------------
-- 6) الاعتماد يستهلك، والإلغاء يُعيد
-- ------------------------------------------------------------
-- أيام الاستهلاك: الإجازة اليومية بأيامها، والزمنية بنسبة ساعاتها
-- إلى ساعات الدوام — فنصف يومٍ نصفُ يوم لا يوماً كاملاً.
create or replace function public.leave_consumed_days(l public.leaves)
returns numeric
language plpgsql stable security definer set search_path = public
as $fn$
declare s public.company_settings%rowtype; emp public.employees%rowtype; v_hours numeric;
begin
  if l.duration_type = 'ساعات' then
    select * into s from public.company_settings where id = 1;
    select * into emp from public.employees where id = l.employee_id;
    v_hours := greatest(extract(epoch from (
                 coalesce(emp.work_end_time,   s.work_end_time) -
                 coalesce(emp.work_start_time, s.work_start_time)))/3600.0, 1);
    return round(coalesce(l.hours, 0) / v_hours, 2);
  end if;
  return coalesce(l.days, 0);
end;
$fn$;

create or replace function public.sync_leave_ledger()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare v_type uuid; v_days numeric; v_who text;
begin
  select id into v_type from public.leave_types where name = new.leave_type;
  if v_type is null then
    return null;                       -- نوعٌ خارج السياسة: لا رصيد له
  end if;

  -- خرج من الاعتماد (رُفض أو أُعيد للتعليق) → تُسحب حركة الاستهلاك
  if old.status = 'موافق عليها' and new.status <> 'موافق عليها' then
    delete from public.leave_ledger
     where leave_id = new.id and kind = 'استهلاك';
    return null;
  end if;

  -- دخل الاعتماد → يُستهلك
  if new.status = 'موافق عليها' and old.status is distinct from 'موافق عليها' then
    v_days := public.leave_consumed_days(new);
    if v_days <= 0 then return null; end if;

    select coalesce(e.full_name, p.email) into v_who
      from public.profiles p left join public.employees e on e.user_id = p.id
     where p.id = auth.uid();

    insert into public.leave_ledger
      (employee_id, leave_type_id, entry_date, days, kind, leave_id, note, created_by, created_by_name)
    values (new.employee_id, v_type, new.start_date, -v_days, 'استهلاك', new.id,
            'إجازة ' || new.leave_type || ' — ' || public.leave_period_text(new),
            auth.uid(), v_who);
  end if;

  return null;
end;
$fn$;

drop trigger if exists trg_sync_leave_ledger on public.leaves;
create trigger trg_sync_leave_ledger
  after update of status on public.leaves
  for each row execute function public.sync_leave_ledger();


-- ------------------------------------------------------------
-- 7) حارسان على الإجازة
-- ------------------------------------------------------------
-- (أ) الموظف لا يطلب ما يتجاوز رصيده. المدير يتجاوزه صراحةً.
-- (ب) لا يُلغى اعتمادُ إجازةٍ دخلت كشفاً **معتمداً**: أرقامه في
--     الدفاتر، وسحبُ أيامها من الخلف يجعل القيد يخالف بنوده.
create or replace function public.guard_leave_request()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare t public.leave_types%rowtype; v_days numeric; v_bal numeric; v_state text;
begin
  select * into t from public.leave_types where name = new.leave_type;

  if tg_op = 'INSERT' and t.id is not null and t.requires_balance
     and not public.is_admin() then
    v_days := public.leave_consumed_days(new);
    v_bal  := public.leave_balance(new.employee_id, t.id, null);
    if v_days > v_bal then
      raise exception 'رصيدك من إجازة % هو % يوماً، وطلبك % — راجع المدير',
        new.leave_type, round(v_bal, 2), round(v_days, 2);
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'موافق عليها' and new.status <> 'موافق عليها' then
    select p.state into v_state from public.payrolls p
     where p.employee_id = new.employee_id
       and p.period = to_char(new.start_date, 'YYYY-MM');
    if v_state is not null and v_state <> 'مسودة' then
      raise exception 'كشف % لهذا الموظف % — أعِد فتحه قبل إلغاء اعتماد إجازته',
        to_char(new.start_date, 'YYYY-MM'), v_state;
    end if;
  end if;

  return new;
end;
$fn$;

-- ⚠️ الاسم يبدأ بـ trg_leaves_zz عمداً: محفّزات BEFORE تعمل
--    بترتيب أبجدي، ويجب أن يعمل هذا **بعد** trg_leaves_normalize
--    الذي يحسب new.days — وإلا قارن الحارسُ صفراً بالرصيد.
drop trigger if exists trg_guard_leave_request on public.leaves;
drop trigger if exists trg_leaves_zz_guard_request on public.leaves;
create trigger trg_leaves_zz_guard_request
  before insert or update on public.leaves
  for each row execute function public.guard_leave_request();


-- ------------------------------------------------------------
-- 8) الصلاحيات
-- ------------------------------------------------------------
alter table public.leave_types        enable row level security;
alter table public.leave_entitlements enable row level security;
alter table public.leave_ledger       enable row level security;

drop policy if exists "read leave types" on public.leave_types;
create policy "read leave types" on public.leave_types
  for select to authenticated using (true);
drop policy if exists "admin manages leave types" on public.leave_types;
create policy "admin manages leave types" on public.leave_types
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "admin manages entitlements" on public.leave_entitlements;
create policy "admin manages entitlements" on public.leave_entitlements
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "employee reads own entitlements" on public.leave_entitlements;
create policy "employee reads own entitlements" on public.leave_entitlements
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));

drop policy if exists "admin manages leave ledger" on public.leave_ledger;
create policy "admin manages leave ledger" on public.leave_ledger
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "employee reads own leave ledger" on public.leave_ledger;
create policy "employee reads own leave ledger" on public.leave_ledger
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));
drop policy if exists "supervisor reads scope leave ledger" on public.leave_ledger;
create policy "supervisor reads scope leave ledger" on public.leave_ledger
  for select to authenticated
  using (employee_id in (select m.id from public.my_scope_employees() m));

-- سجلّ التدقيق يشملها
do $do$
declare t text;
begin
  foreach t in array array['leave_types','leave_entitlements','leave_ledger'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete
                      on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $do$;

-- ⚠️ منذ sql/054 لا منحة افتراضية — المنح صريح.
--    leave_balance داخلية (تُنادى من الحرّاس)، فلا تُمنح.
revoke execute on function public.leave_balances_for(uuid) from public, anon;
revoke execute on function public.run_leave_accrual()      from public, anon;
grant  execute on function public.leave_balances_for(uuid) to authenticated;
grant  execute on function public.run_leave_accrual()      to authenticated;

notify pgrst, 'reload schema';
