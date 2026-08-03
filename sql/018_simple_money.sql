-- ============================================================
-- تلال ERP — المحاسبة المبسّطة (الحركات المالية)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الفكرة: أنت تُدخل معلومة بسيطة جداً (صرفت / قبضت — كم — على شنو — مين دفع)
-- والنظام يحوّلها تلقائياً إلى قيد محاسبي مزدوج صحيح خلف الكواليس.
-- لن تحتاج أبداً أن تعرف معنى "مدين" و"دائن".
--
-- يتطلب تشغيل: 011 (المحاسبة) و 016 (الشركاء) أولاً.
-- الملف آمن لإعادة التشغيل (لا يحذف بياناتك).
-- ============================================================

-- ------------------------------------------------------------
-- 1) حسابات إضافية تحتاجها التصنيفات المبسّطة
-- ------------------------------------------------------------
insert into public.accounts (code, name, type) values
  ('2500', 'جاري الشركاء',              'liability'),  -- ما تدين به الشركة لشركائها
  ('4400', 'إيرادات خدمات التسويق',     'revenue'),
  ('5310', 'وقود ومواصلات',             'expense'),
  ('5320', 'ضيافة وطعام',               'expense'),
  ('5330', 'اشتراكات وبرامج',           'expense'),
  ('5340', 'رسوم حكومية ومعاملات',      'expense')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2) وسم القيود بالذراع (النشاط) ومصدر القيد
--    الذراع = العقارات | التسويق | إداري عام
-- ------------------------------------------------------------
alter table public.journal_entries
  add column if not exists arm    text,
  add column if not exists source text;

-- ------------------------------------------------------------
-- 3) جدول الحركات المالية المبسّط — هذا هو مكان الإدخال الوحيد
-- ------------------------------------------------------------
create table if not exists public.cash_moves (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  move_date        date not null default current_date,
  direction        text not null check (direction in ('صرف', 'قبض')),
  amount           numeric not null check (amount > 0),
  category         text not null,                       -- التصنيف بالعربي (رواتب، إيجار، تسويق...)
  account_code     text not null,                       -- كود الحساب المقابل (تحدّده الواجهة من التصنيف)
  arm              text not null default 'إداري عام',   -- الذراع: العقارات | التسويق | إداري عام
  method           text not null default 'نقد' check (method in ('نقد', 'بنك')),
  partner_id       uuid references public.partners(id) on delete set null, -- الشريك المرتبط بالحركة (دفع من جيبه / أودع / استرجع)
  description      text not null,
  notes            text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null
);

create index if not exists cash_moves_date_idx on public.cash_moves (move_date desc);

-- ------------------------------------------------------------
-- 4) الترحيل التلقائي للمحاسبة (هنا يقوم النظام بالعمل بدلاً عنك)
--
--    صرف:
--      • دفعته الشركة        → مدين: حساب المصروف | دائن: الصندوق أو البنك
--      • دفعه شريك من جيبه   → مدين: حساب المصروف | دائن: جاري الشركاء (يصير له عند الشركة)
--      • سداد لشريك (2500)   → مدين: جاري الشركاء | دائن: الصندوق أو البنك
--    قبض:
--      • مدين: الصندوق أو البنك | دائن: حساب الإيراد
--        (وإن كان إيداعاً من شريك فالدائن هو جاري الشركاء 2500)
-- ------------------------------------------------------------
create or replace function public.post_cash_move_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counter    uuid;   -- الحساب المقابل (مصروف / إيراد / جاري الشركاء)
  v_cash       uuid;   -- الصندوق أو البنك
  v_partner    uuid;   -- حساب جاري الشركاء
  v_entry      uuid;
  v_who        text;
  v_from_pocket boolean;
begin
  select id into v_counter from public.accounts where code = new.account_code;
  select id into v_cash    from public.accounts
    where code = case when new.method = 'بنك' then '1200' else '1100' end;
  select id into v_partner from public.accounts where code = '2500';

  -- إن لم تكن شجرة الحسابات مهيأة، نحفظ الحركة بدون ترحيل (نتجنّب الخطأ)
  if v_counter is null or v_cash is null then
    return new;
  end if;

  -- "دفع من جيبه" = صرف مرتبط بشريك وليس حركة تسوية مع حساب جاري الشركاء
  v_from_pocket := (new.direction = 'صرف'
                    and new.partner_id is not null
                    and new.account_code <> '2500'
                    and v_partner is not null);

  if new.partner_id is not null then
    select name into v_who from public.partners where id = new.partner_id;
  end if;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    new.move_date,
    new.description
      || case when v_from_pocket then ' — دفعها ' || v_who || ' من حسابه الخاص' else '' end
      || ' [' || new.category || ']',
    'MOVE',
    new.arm,
    'cash_moves'
  )
  returning id into v_entry;

  if new.direction = 'صرف' then
    insert into public.journal_lines (entry_id, account_id, debit, credit) values
      (v_entry, v_counter, new.amount, 0),
      (v_entry, case when v_from_pocket then v_partner else v_cash end, 0, new.amount);
  else
    insert into public.journal_lines (entry_id, account_id, debit, credit) values
      (v_entry, v_cash,    new.amount, 0),
      (v_entry, v_counter, 0,          new.amount);
  end if;

  update public.cash_moves set journal_entry_id = v_entry where id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_cash_move_ledger on public.cash_moves;
create trigger trg_cash_move_ledger
  after insert on public.cash_moves
  for each row execute function public.post_cash_move_to_ledger();

-- حذف الحركة يحذف قيدها المحاسبي
create or replace function public.unpost_cash_move_from_ledger()
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

drop trigger if exists trg_cash_move_unpost on public.cash_moves;
create trigger trg_cash_move_unpost
  after delete on public.cash_moves
  for each row execute function public.unpost_cash_move_from_ledger();

-- ------------------------------------------------------------
-- 5) حماية الصفوف: للمدراء فقط (مثل بقية المحاسبة)
-- ------------------------------------------------------------
alter table public.cash_moves enable row level security;
drop policy if exists "admin cash_moves" on public.cash_moves;
create policy "admin cash_moves" on public.cash_moves
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 6) نقل مصاريف الشركاء القديمة إلى الجدول الجديد ثم الاستغناء عنها
--    (يعمل مرة واحدة فقط — بياناتك محفوظة ولا تضيع)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.partner_expenses') is not null then
    insert into public.cash_moves
      (move_date, direction, amount, category, account_code, arm, method,
       partner_id, description, notes)
    select
      expense_date, 'صرف', amount, coalesce(nullif(category, ''), 'أخرى'),
      '5800', 'إداري عام', 'نقد', paid_by, description, notes
    from public.partner_expenses;

    drop table public.partner_expenses cascade;
  end if;
end $$;

notify pgrst, 'reload schema';
