-- ============================================================
-- 047 — عربون الحجز مالٌ يدخل الصندوق، والتحصيل يصل الدفاتر
--
-- ⚠️ يحتوي إصلاح ثغرة قديمة: تحصيل الفواتير لم يكن يُرحَّل أصلاً.
--    دالة post_payment_to_ledger موجودة منذ sql/015 لكنها **بلا
--    محفّز**، وعمود payments.journal_entry_id لم يُنشأ — فالهجرة
--    طُبّقت ناقصة، وكل دفعة تُقبض من عميل لم تكن تظهر في الصندوق
--    ولا في الإيرادات.
--
-- والعربون: كان يُسجَّل في صفّ الحجز ولا يعرف عنه دفتر الأستاذ
-- شيئاً. وهو ليس إيراداً — الصفقة لم تتمّ — بل **التزام** تردّه
-- الشركة إن أُلغي الحجز:
--     الحجز    : مدين الصندوق (1100) / دائن عربونات محجوزة (2400)
--     البيع    : فاتورة بثمن الوحدة + دفعة مصدرها العربون
--                → مدين 2400 / دائن الإيراد (4100)
--     الإلغاء  : يُعكس القيد ويُردّ المبلغ
-- فالنقد يدخل مرة، والإيراد يُعترف به مرة، والالتزام يعود صفراً.
--
-- طُبّق على القاعدة في 2026-08-31 عبر هجرتين:
--   reservation_deposit_accounting
--   attach_payment_ledger_trigger
-- ============================================================

alter table public.reservations
  add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;

alter table public.payments
  add column if not exists from_deposit boolean not null default false,
  add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;

comment on column public.payments.from_deposit is
  'دفعة مصدرها عربون حجز سبق قبضه — تُقيَّد على «عربونات محجوزة» لا على الصندوق.';

-- ===== 1) قيد العربون =====
create or replace function public.repost_reservation_deposit(p_res uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_cash uuid; v_liab uuid; v_entry uuid; v_unit text;
begin
  select * into r from public.reservations where id = p_res;
  if not found then return; end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
    update public.reservations set journal_entry_id = null where id = p_res;
  end if;

  -- الملغى لا عربون له: رُدّ لصاحبه
  if coalesce(r.amount, 0) <= 0 or r.status = 'ملغى' then return; end if;

  select id into v_cash from public.accounts where code = '1100';
  select id into v_liab from public.accounts where code = '2400';
  if v_cash is null or v_liab is null then return; end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(r.reservation_date, current_date),
          'عربون حجز الوحدة ' || v_unit || ' — ' ||
            coalesce((select name from public.clients where id = r.client_id), ''),
          'DEPOSIT', 'إداري عام', 'reservations')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_cash, r.amount, 0),
         (v_entry, v_liab, 0,        r.amount);

  update public.reservations set journal_entry_id = v_entry where id = p_res;
end; $$;

create or replace function public.post_reservation_deposit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      delete from public.journal_entries where id = old.journal_entry_id;
    end if;
    return old;
  end if;
  perform public.repost_reservation_deposit(new.id);
  return null;
end; $$;

drop trigger if exists trg_reservation_deposit_ledger on public.reservations;
create trigger trg_reservation_deposit_ledger
  after insert or update of amount, status, reservation_date on public.reservations
  for each row execute function public.post_reservation_deposit();

drop trigger if exists trg_reservation_deposit_unpost on public.reservations;
create trigger trg_reservation_deposit_unpost
  before delete on public.reservations
  for each row execute function public.post_reservation_deposit();

-- ===== 2) تحصيل الدفعات — يُربط أخيراً بالدفاتر =====
create or replace function public.repost_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay record; v_debit uuid; v_credit uuid; v_entry uuid; v_inv text;
begin
  select * into pay from public.payments where id = p_id;
  if not found then return; end if;

  if pay.journal_entry_id is not null then
    delete from public.journal_entries where id = pay.journal_entry_id;
    update public.payments set journal_entry_id = null where id = p_id;
  end if;

  if coalesce(pay.amount, 0) <= 0 then return; end if;

  if pay.from_deposit then
    -- النقد دخل يوم الحجز؛ هنا يتحوّل الالتزام إلى إيراد
    select id into v_debit from public.accounts where code = '2400';
  elsif pay.method is null or pay.method = 'نقد' then
    select id into v_debit from public.accounts where code = '1100';
  else
    select id into v_debit from public.accounts where code = '1200';
  end if;

  select id into v_credit from public.accounts where code = '4100';
  if v_debit is null or v_credit is null then return; end if;

  select invoice_number into v_inv from public.invoices where id = pay.invoice_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(pay.payment_date, current_date),
          case when pay.from_deposit
               then 'احتساب عربون على فاتورة ' || coalesce(v_inv, '')
               else 'تحصيل دفعة - فاتورة ' || coalesce(v_inv, '') end,
          'PAY', 'إداري عام', 'payments')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_debit,  pay.amount, 0),
         (v_entry, v_credit, 0,          pay.amount);

  update public.payments set journal_entry_id = v_entry where id = p_id;
end; $$;

create or replace function public.post_payment_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      delete from public.journal_entries where id = old.journal_entry_id;
    end if;
    return old;
  end if;
  perform public.repost_payment(new.id);
  return null;
end; $$;

drop trigger if exists trg_payment_ledger on public.payments;
create trigger trg_payment_ledger
  after insert or update of amount, method, payment_date, from_deposit
  on public.payments
  for each row execute function public.post_payment_ledger();

drop trigger if exists trg_payment_unpost on public.payments;
create trigger trg_payment_unpost
  before delete on public.payments
  for each row execute function public.post_payment_ledger();

-- الدالة القديمة صارت بلا مستدعٍ — تُحذف لئلا تُظنّ عاملة
drop function if exists public.post_payment_to_ledger();

do $$ declare p record;
begin
  for p in select id from public.payments loop
    perform public.repost_payment(p.id);
  end loop;
end; $$;

-- ===== 3) البيع: الفاتورة ثم احتساب العربون دفعةً عليها =====
create or replace function public.invoice_on_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record; u record; v_note text; v_inv uuid;
begin
  if new.status <> 'بيع مكتمل' then return null; end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not coalesce(s.auto_invoice_on_sale, true) then return null; end if;

  if exists (select 1 from public.invoices i where i.reservation_id = new.id) then
    return null;
  end if;

  select * into u from public.units where id = new.unit_id;
  if u is null or coalesce(u.price, 0) <= 0 then return null; end if;

  v_note := 'فاتورة آلية عند إتمام بيع الوحدة ' || coalesce(u.unit_code, '') ||
            case when u.node_path is not null then ' — ' || u.node_path else '' end;

  insert into public.invoices (client_id, reservation_id, unit_id, total_amount, notes)
  values (new.client_id, new.id, new.unit_id, u.price, v_note)
  returning id into v_inv;

  -- العربون المقبوض يُحتسب دفعةً على الفاتورة، وإلا طُولب العميل
  -- بثمنٍ كامل وقد دفع جزءاً منه فعلاً.
  if coalesce(new.amount, 0) > 0 then
    insert into public.payments (invoice_id, amount, payment_date, method, note, from_deposit)
    values (v_inv, new.amount, coalesce(new.reservation_date, current_date),
            'نقد', 'عربون الحجز', true);
  end if;

  return null;
end; $$;
