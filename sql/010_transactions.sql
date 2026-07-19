-- ============================================================
-- تلال ERP — المحاسبة: جدول الحركات المالية (دفتر الأستاذ)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- كل صف = حركة مالية واحدة (دخل أو مصروف).
-- الوصول لهذه البيانات مقصور على المدراء فقط (بيانات حساسة).
-- ============================================================

drop table if exists public.transactions cascade;

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  txn_type       text not null,                 -- دخل | مصروف
  category       text,                          -- التصنيف
  amount         numeric not null,              -- المبلغ
  txn_date       date default current_date,     -- تاريخ الحركة
  description    text,                          -- البيان
  payment_method text,                          -- وسيلة الدفع
  status         text not null default 'مدفوع', -- مدفوع | مستحق
  notes          text
);

-- حماية الصفوف: كل العمليات للمدراء فقط
alter table public.transactions enable row level security;

create policy "admins read transactions"
  on public.transactions for select to authenticated using (public.is_admin());
create policy "admins insert transactions"
  on public.transactions for insert to authenticated with check (public.is_admin());
create policy "admins update transactions"
  on public.transactions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins delete transactions"
  on public.transactions for delete to authenticated using (public.is_admin());

notify pgrst, 'reload schema';
