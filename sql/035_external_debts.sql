-- ============================================================
-- تلال ERP — الديون الخارجية (سلف نعطيها ونستحصلها لاحقاً)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الغرض: فلوس نعطيها لناس نشتغل وياهم (مقاول، وسيط، مورد، …) على
-- أساس أنها تُرجَع لنا. هذه **ليست مصروفاً** — الفلوس ما راحت، بس
-- انتقلت من الصندوق إلى ذمّة شخص. لذلك لها حساب أصول مستقل تماماً
-- عن مصاريف الشركة، فلا تُنقص الربح ولا تظهر في «وين تروح فلوسنا».
--
-- الترحيل المحاسبي:
--   إعطاء دين  →  مدين 1350 ديون خارجية   / دائن 1100 الصندوق أو 1200 البنك
--   استحصال    →  مدين 1100 أو 1200        / دائن 1350 ديون خارجية
-- فيبقى رصيد 1350 = المبلغ الذي ما زال في ذمّة الناس.
--
-- يتطلب: sql/011 (شجرة الحسابات) و sql/018. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) حساب مستقل للديون الخارجية
-- ------------------------------------------------------------
insert into public.accounts (code, name, type)
values ('1350', 'ديون خارجية (سلف لدى الغير)', 'asset')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2) الجداول
-- ------------------------------------------------------------
create table if not exists public.external_debts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  person_name  text not null,
  person_phone text,
  person_kind  text not null default 'جهة أخرى',
  amount       numeric(14,2) not null check (amount > 0),
  debt_date    date not null default current_date,
  due_date     date,                       -- موعد الاستحصال المتوقّع
  method       text not null default 'نقد' check (method in ('نقد', 'بنك')),
  reason       text,                       -- على شنو انعطت
  notes        text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null
);

create table if not exists public.debt_repayments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  debt_id      uuid not null references public.external_debts(id) on delete cascade,
  pay_date     date not null default current_date,
  amount       numeric(14,2) not null check (amount > 0),
  method       text not null default 'نقد' check (method in ('نقد', 'بنك')),
  note         text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null
);

create index if not exists external_debts_date_idx    on public.external_debts (debt_date desc);
create index if not exists external_debts_due_idx     on public.external_debts (due_date);
create index if not exists debt_repayments_debt_idx   on public.debt_repayments (debt_id);

-- ------------------------------------------------------------
-- 3) الصلاحيات — المحاسبة كلها للإدارة فقط
-- ------------------------------------------------------------
alter table public.external_debts  enable row level security;
alter table public.debt_repayments enable row level security;

drop policy if exists "admins manage external debts" on public.external_debts;
create policy "admins manage external debts" on public.external_debts
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "admins manage debt repayments" on public.debt_repayments;
create policy "admins manage debt repayments" on public.debt_repayments
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 4) الترحيل التلقائي لدفتر القيود
-- ------------------------------------------------------------
-- إعطاء الدين: الفلوس تخرج من الصندوق وتدخل ذمّة الشخص
create or replace function public.post_debt_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt  uuid;
  v_cash  uuid;
  v_entry uuid;
begin
  select id into v_debt from public.accounts where code = '1350';
  select id into v_cash from public.accounts
   where code = case when new.method = 'بنك' then '1200' else '1100' end;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    new.debt_date,
    'دين خارجي — ' || new.person_name
      || coalesce(' — ' || nullif(new.reason, ''), ''),
    'DEBT',
    null,
    'external_debts'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_debt, new.amount, 0),
    (v_entry, v_cash, 0,          new.amount);

  update public.external_debts set journal_entry_id = v_entry where id = new.id;
  return new;
end; $$;

-- الاستحصال: الفلوس ترجع للصندوق وتنقص من ذمّة الشخص
create or replace function public.post_debt_repayment_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt  uuid;
  v_cash  uuid;
  v_entry uuid;
  v_who   text;
begin
  select id into v_debt from public.accounts where code = '1350';
  select id into v_cash from public.accounts
   where code = case when new.method = 'بنك' then '1200' else '1100' end;
  select person_name into v_who from public.external_debts where id = new.debt_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    new.pay_date,
    'استحصال دين — ' || coalesce(v_who, 'غير معروف'),
    'DEBTPAY',
    null,
    'debt_repayments'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_cash, new.amount, 0),
    (v_entry, v_debt, 0,          new.amount);

  update public.debt_repayments set journal_entry_id = v_entry where id = new.id;
  return new;
end; $$;

-- حذف السجل يحذف قيده — وإلا بقيت أرقام في الدفتر بلا مصدر
create or replace function public.unpost_debt_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.journal_entry_id is not null then
    delete from public.journal_entries where id = old.journal_entry_id;
  end if;
  return old;
end; $$;

drop trigger if exists trg_post_debt on public.external_debts;
create trigger trg_post_debt
  after insert on public.external_debts
  for each row execute function public.post_debt_to_ledger();

drop trigger if exists trg_unpost_debt on public.external_debts;
create trigger trg_unpost_debt
  after delete on public.external_debts
  for each row execute function public.unpost_debt_row();

drop trigger if exists trg_post_debt_repayment on public.debt_repayments;
create trigger trg_post_debt_repayment
  after insert on public.debt_repayments
  for each row execute function public.post_debt_repayment_to_ledger();

-- ملاحظة: حذف الدين يحذف دفعاته بالتتالي، ومحفّز الحذف هذا يعمل على
-- كل دفعة محذوفة، فتُمحى قيودها معها.
drop trigger if exists trg_unpost_debt_repayment on public.debt_repayments;
create trigger trg_unpost_debt_repayment
  after delete on public.debt_repayments
  for each row execute function public.unpost_debt_row();

notify pgrst, 'reload schema';
