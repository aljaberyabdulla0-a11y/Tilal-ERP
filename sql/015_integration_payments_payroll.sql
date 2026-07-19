-- ============================================================
-- تلال ERP — التكامل: مدفوعات الفواتير + الرواتب → المحاسبة تلقائياً
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- (يتطلب sql/011 المحاسبة و sql/012 HR و sql/013 الفواتير)
-- ============================================================

alter table public.payments add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;
alter table public.payrolls add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;

-- ========== مدفوعات الفواتير → قيد محاسبي ==========
-- نقد → الصندوق (1100)، غير ذلك → البنك (1200)، مقابل إيرادات المبيعات (4100)
create or replace function public.post_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_debit uuid;
  v_credit uuid;
  v_entry uuid;
  v_inv text;
begin
  if new.method is null or new.method = 'نقد' then
    select id into v_debit from public.accounts where code = '1100';
  else
    select id into v_debit from public.accounts where code = '1200';
  end if;
  select id into v_credit from public.accounts where code = '4100';
  if v_debit is null or v_credit is null then return new; end if;

  select invoice_number into v_inv from public.invoices where id = new.invoice_id;

  insert into public.journal_entries (entry_date, description, reference)
  values (coalesce(new.payment_date, current_date),
          'تحصيل دفعة - فاتورة ' || coalesce(v_inv, ''), 'PAY')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_debit, new.amount, 0),
         (v_entry, v_credit, 0, new.amount);

  update public.payments set journal_entry_id = v_entry where id = new.id;
  return new;
end; $$;

drop trigger if exists trg_payment_ledger on public.payments;
create trigger trg_payment_ledger after insert on public.payments
  for each row execute function public.post_payment_to_ledger();

create or replace function public.unpost_payment_from_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.journal_entry_id is not null then
    delete from public.journal_entries where id = old.journal_entry_id;
  end if;
  return old;
end; $$;

drop trigger if exists trg_payment_unpost on public.payments;
create trigger trg_payment_unpost after delete on public.payments
  for each row execute function public.unpost_payment_from_ledger();

-- ========== الرواتب → قيد محاسبي ==========
-- مدين: الرواتب (5100) = الأساسي + البدلات
-- دائن: الصندوق (1100) = الصافي (بدون العمولات، لأنها رُحّلت مسبقاً)
-- دائن: إيرادات أخرى (4300) = الاستقطاعات
create or replace function public.post_payroll_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_exp uuid; v_cash uuid; v_other uuid; v_entry uuid; v_emp text;
  v_salary numeric;
  v_ded numeric;
begin
  v_salary := coalesce(new.basic, 0) + coalesce(new.allowances, 0);
  v_ded := coalesce(new.deductions_total, 0);
  if v_salary <= 0 then return new; end if;

  select id into v_exp   from public.accounts where code = '5100';
  select id into v_cash  from public.accounts where code = '1100';
  select id into v_other from public.accounts where code = '4300';
  if v_exp is null or v_cash is null then return new; end if;

  select full_name into v_emp from public.employees where id = new.employee_id;

  insert into public.journal_entries (entry_date, description, reference)
  values (current_date, 'راتب: ' || coalesce(v_emp, '') || ' - ' || new.period, 'PAYROLL')
  returning id into v_entry;

  -- مدين: مصروف الرواتب
  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_exp, v_salary, 0);

  -- دائن: الصندوق + الاستقطاعات (كإيراد آخر) — يتوازن دائماً
  if v_ded > 0 and v_other is not null then
    insert into public.journal_lines (entry_id, account_id, debit, credit)
    values (v_entry, v_cash, 0, v_salary - v_ded),
           (v_entry, v_other, 0, v_ded);
  else
    insert into public.journal_lines (entry_id, account_id, debit, credit)
    values (v_entry, v_cash, 0, v_salary);
  end if;

  update public.payrolls set journal_entry_id = v_entry where id = new.id;
  return new;
end; $$;

drop trigger if exists trg_payroll_ledger on public.payrolls;
create trigger trg_payroll_ledger after insert on public.payrolls
  for each row execute function public.post_payroll_to_ledger();

create or replace function public.unpost_payroll_from_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.journal_entry_id is not null then
    delete from public.journal_entries where id = old.journal_entry_id;
  end if;
  return old;
end; $$;

drop trigger if exists trg_payroll_unpost on public.payrolls;
create trigger trg_payroll_unpost after delete on public.payrolls
  for each row execute function public.unpost_payroll_from_ledger();

notify pgrst, 'reload schema';
