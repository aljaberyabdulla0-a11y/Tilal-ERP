-- ============================================================
-- تلال ERP — التكامل: ربط عمولات الموظفين (HR) بالمحاسبة تلقائياً
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- كل عمولة تُضاف لموظف → تُرحّل تلقائياً كقيد محاسبي متوازن:
--   مدين: عمولات مدفوعة (5500)  |  دائن: الصندوق (1100)
-- وعند حذف العمولة → يُحذف القيد المرتبط بها.
-- (يتطلب تشغيل sql/011 المحاسبة و sql/012 الموارد البشرية أولاً)
-- ============================================================

-- 1) عمود يربط العمولة بقيدها المحاسبي
alter table public.commissions
  add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;

-- 2) دالة الترحيل: تُنشئ قيداً محاسبياً عند إضافة عمولة
create or replace function public.post_commission_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense uuid;
  v_cash    uuid;
  v_entry   uuid;
  v_emp     text;
begin
  select id into v_expense from public.accounts where code = '5500'; -- عمولات مدفوعة
  select id into v_cash    from public.accounts where code = '1100'; -- الصندوق

  -- إن لم تكن شجرة الحسابات مهيأة، لا نرحّل (نتجنّب الخطأ)
  if v_expense is null or v_cash is null then
    return new;
  end if;

  select full_name into v_emp from public.employees where id = new.employee_id;

  insert into public.journal_entries (entry_date, description, reference)
  values (
    coalesce(new.comm_date, current_date),
    'عمولة موظف: ' || coalesce(v_emp, '') || coalesce(' - ' || new.description, ''),
    'COMM'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_expense, new.amount, 0),
         (v_entry, v_cash,    0,          new.amount);

  update public.commissions set journal_entry_id = v_entry where id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_commission_ledger on public.commissions;
create trigger trg_commission_ledger
  after insert on public.commissions
  for each row execute function public.post_commission_to_ledger();

-- 3) دالة الإلغاء: تحذف القيد عند حذف العمولة
create or replace function public.unpost_commission_from_ledger()
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
end;
$$;

drop trigger if exists trg_commission_unpost on public.commissions;
create trigger trg_commission_unpost
  after delete on public.commissions
  for each row execute function public.unpost_commission_from_ledger();

notify pgrst, 'reload schema';
