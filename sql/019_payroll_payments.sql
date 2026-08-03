-- ============================================================
-- تلال ERP — دفع الرواتب (استحقاق ← دفع كامل أو جزئي)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المشكلة التي يحلّها:
--   كان توليد كشف الراتب يفترض أنك دفعت الراتب كاملاً نقداً في نفس اللحظة،
--   فينقص الصندوق فوراً — حتى لو لم تدفع بعد. ولا يوجد دفع جزئي.
--
-- المنطق الجديد (وهو المنطق المحاسبي الصحيح، ويبقى بسيطاً عليك):
--   1) توليد كشف الراتب  = «استحقاق»  → مصروف رواتب + دَين على الشركة (2300)
--                                        الصندوق لا يتأثر.
--   2) الضغط على «دفع»    = «سداد»     → ينقص الدَين وينقص الصندوق/البنك
--                                        بالمبلغ المدفوع فقط (كامل أو جزئي).
--   3) العمولات كذلك تصبح مستحقة عند إضافتها، وتُدفع مع الراتب.
--   4) حالة الكشف تتحدّث تلقائياً: غير مدفوع / مدفوع جزئياً / مدفوع.
--
-- يتطلب: 011 (المحاسبة) و 012 (HR) و 014 و 015.
-- الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول دفعات الرواتب (تسمح بالدفع على أكثر من مرة)
-- ------------------------------------------------------------
create table if not exists public.payroll_payments (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  payroll_id       uuid not null references public.payrolls(id) on delete cascade,
  pay_date         date not null default current_date,
  amount           numeric not null check (amount > 0),
  method           text not null default 'نقد' check (method in ('نقد', 'بنك')),
  notes            text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null
);

create index if not exists payroll_payments_payroll_idx
  on public.payroll_payments (payroll_id);

alter table public.payroll_payments enable row level security;

drop policy if exists "admin payroll_payments" on public.payroll_payments;
create policy "admin payroll_payments" on public.payroll_payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الموظف يرى دفعات رواتبه فقط
drop policy if exists "employee read own payroll_payments" on public.payroll_payments;
create policy "employee read own payroll_payments" on public.payroll_payments
  for select to authenticated using (
    exists (
      select 1 from public.payrolls p
      where p.id = payroll_id and p.employee_id = public.my_employee_id()
    )
  );

-- ------------------------------------------------------------
-- 1/ب) ربط العمولة/الاستقطاع بالكشف الذي ضمّهما
--      يمنع احتساب نفس العمولة في أكثر من كشف راتب.
-- ------------------------------------------------------------
alter table public.commissions
  add column if not exists payroll_id uuid references public.payrolls(id) on delete set null;
alter table public.deductions
  add column if not exists payroll_id uuid references public.payrolls(id) on delete set null;

-- ------------------------------------------------------------
-- 2) دوال الترحيل (قابلة لإعادة الاستدعاء — تحذف القيد القديم وتبني الجديد)
-- ------------------------------------------------------------

-- 2/أ) العمولة تصبح «مستحقة» للموظف بدل أن تُخصم من الصندوق فوراً
--      مدين: عمولات مدفوعة (5500) | دائن: رواتب مستحقة الدفع (2300)
create or replace function public.repost_commission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c       record;
  v_exp   uuid;
  v_due   uuid;
  v_entry uuid;
  v_emp   text;
begin
  select * into c from public.commissions where id = p_id;
  if not found then return; end if;

  if c.journal_entry_id is not null then
    delete from public.journal_entries where id = c.journal_entry_id;
  end if;

  select id into v_exp from public.accounts where code = '5500';
  select id into v_due from public.accounts where code = '2300';
  if v_exp is null or v_due is null then return; end if;

  select full_name into v_emp from public.employees where id = c.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    coalesce(c.comm_date, current_date),
    'عمولة مستحقة: ' || coalesce(v_emp, '') || coalesce(' - ' || c.description, ''),
    'COMM', 'إداري عام', 'commissions'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_exp, c.amount, 0),
    (v_entry, v_due, 0, c.amount);

  update public.commissions set journal_entry_id = v_entry where id = p_id;
end; $$;

-- 2/ب) كشف الراتب = استحقاق فقط (لا يمسّ الصندوق)
--      مدين: الرواتب (5100) = الأساسي + البدلات − الاستقطاعات
--      دائن: رواتب مستحقة الدفع (2300) = نفس المبلغ
--      (العمولات مستثناة لأنها استُحقّت أصلاً عند إضافتها)
create or replace function public.repost_payroll(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_exp    uuid;
  v_due    uuid;
  v_entry  uuid;
  v_emp    text;
  v_amount numeric;
begin
  select * into r from public.payrolls where id = p_id;
  if not found then return; end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
    update public.payrolls set journal_entry_id = null where id = p_id;
  end if;

  v_amount := coalesce(r.basic, 0) + coalesce(r.allowances, 0)
              - coalesce(r.deductions_total, 0);
  if v_amount <= 0 then return; end if;

  select id into v_exp from public.accounts where code = '5100';
  select id into v_due from public.accounts where code = '2300';
  if v_exp is null or v_due is null then return; end if;

  select full_name into v_emp from public.employees where id = r.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    coalesce(r.created_at::date, current_date),
    'استحقاق راتب: ' || coalesce(v_emp, '') || ' - ' || r.period,
    'PAYROLL', 'إداري عام', 'payrolls'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_exp, v_amount, 0),
    (v_entry, v_due, 0,        v_amount);

  update public.payrolls set journal_entry_id = v_entry where id = p_id;
end; $$;

-- 2/ج) دفعة الراتب = سداد الدَين نقداً أو بنكياً
--      مدين: رواتب مستحقة (2300) | دائن: الصندوق (1100) أو البنك (1200)
create or replace function public.repost_payroll_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pay     record;
  pr      record;
  v_due   uuid;
  v_cash  uuid;
  v_entry uuid;
  v_emp   text;
begin
  select * into pay from public.payroll_payments where id = p_id;
  if not found then return; end if;

  if pay.journal_entry_id is not null then
    delete from public.journal_entries where id = pay.journal_entry_id;
  end if;

  select * into pr from public.payrolls where id = pay.payroll_id;

  select id into v_due  from public.accounts where code = '2300';
  select id into v_cash from public.accounts
    where code = case when pay.method = 'بنك' then '1200' else '1100' end;
  if v_due is null or v_cash is null then return; end if;

  select full_name into v_emp from public.employees where id = pr.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    pay.pay_date,
    'دفع راتب: ' || coalesce(v_emp, '') || ' - ' || coalesce(pr.period, ''),
    'PAYRUN', 'إداري عام', 'payroll_payments'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_due,  pay.amount, 0),
    (v_entry, v_cash, 0,          pay.amount);

  update public.payroll_payments set journal_entry_id = v_entry where id = p_id;
end; $$;

-- ------------------------------------------------------------
-- 3) تحديث حالة الكشف تلقائياً حسب ما دُفع
-- ------------------------------------------------------------
create or replace function public.refresh_payroll_status(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric;
  v_net  numeric;
begin
  select coalesce(sum(amount), 0) into v_paid
    from public.payroll_payments where payroll_id = p_id;
  select net into v_net from public.payrolls where id = p_id;
  if v_net is null then return; end if;

  update public.payrolls
     set status = case
       when v_paid >= v_net - 0.01 and v_net > 0 then 'مدفوع'
       when v_paid > 0                           then 'مدفوع جزئياً'
       else                                           'غير مدفوع'
     end
   where id = p_id;
end; $$;

-- ------------------------------------------------------------
-- 4) المحفّزات
-- ------------------------------------------------------------

-- العمولات
create or replace function public.post_commission_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.repost_commission(new.id);
  return new;
end; $$;

drop trigger if exists trg_commission_ledger on public.commissions;
create trigger trg_commission_ledger after insert on public.commissions
  for each row execute function public.post_commission_to_ledger();

-- كشوف الرواتب
create or replace function public.post_payroll_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.repost_payroll(new.id);
  return new;
end; $$;

drop trigger if exists trg_payroll_ledger on public.payrolls;
create trigger trg_payroll_ledger after insert on public.payrolls
  for each row execute function public.post_payroll_to_ledger();

-- دفعات الرواتب
create or replace function public.post_payroll_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.repost_payroll_payment(new.id);
  perform public.refresh_payroll_status(new.payroll_id);
  return new;
end; $$;

drop trigger if exists trg_payroll_payment_ledger on public.payroll_payments;
create trigger trg_payroll_payment_ledger after insert on public.payroll_payments
  for each row execute function public.post_payroll_payment_to_ledger();

create or replace function public.unpost_payroll_payment_from_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.journal_entry_id is not null then
    delete from public.journal_entries where id = old.journal_entry_id;
  end if;
  perform public.refresh_payroll_status(old.payroll_id);
  return old;
end; $$;

drop trigger if exists trg_payroll_payment_unpost on public.payroll_payments;
create trigger trg_payroll_payment_unpost after delete on public.payroll_payments
  for each row execute function public.unpost_payroll_payment_from_ledger();

-- ------------------------------------------------------------
-- 5) ترحيل البيانات القديمة إلى المنطق الجديد
--    الكشوف القديمة كانت تُعتبر مدفوعة نقداً بالكامل لحظة توليدها،
--    لذلك نُنشئ لها دفعة كاملة حتى يبقى رصيد الصندوق كما هو تماماً.
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.commissions loop
    perform public.repost_commission(r.id);
  end loop;

  for r in select id, net, created_at from public.payrolls loop
    perform public.repost_payroll(r.id);

    if r.net > 0 and not exists (
      select 1 from public.payroll_payments where payroll_id = r.id
    ) then
      insert into public.payroll_payments (payroll_id, pay_date, amount, method, notes)
      values (r.id, r.created_at::date, r.net, 'نقد',
              'ترحيل تلقائي — كشف قديم كان يُحتسب مدفوعاً عند توليده');
    end if;

    perform public.refresh_payroll_status(r.id);
  end loop;

  -- العمولات والاستقطاعات القديمة كانت محتسبة ضمن الكشوف السابقة،
  -- نربطها بآخر كشف لكل موظف حتى لا تتكرّر في الكشف القادم.
  update public.commissions c
     set payroll_id = (
       select p.id from public.payrolls p
        where p.employee_id = c.employee_id
        order by p.period desc, p.created_at desc
        limit 1
     )
   where c.payroll_id is null
     and exists (select 1 from public.payrolls p where p.employee_id = c.employee_id);

  update public.deductions d
     set payroll_id = (
       select p.id from public.payrolls p
        where p.employee_id = d.employee_id
        order by p.period desc, p.created_at desc
        limit 1
     )
   where d.payroll_id is null
     and exists (select 1 from public.payrolls p where p.employee_id = d.employee_id);
end $$;

notify pgrst, 'reload schema';
