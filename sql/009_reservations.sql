-- ============================================================
-- تلال ERP — جدول الحجوزات (ربط عميل بوحدة عقارية)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ملاحظة: نحذف أي جدول reservations قديم (إن وُجد) ونبنيه نظيفاً.
-- ============================================================

drop table if exists public.reservations cascade;

create table public.reservations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  client_id        uuid not null references public.clients(id) on delete cascade,
  unit_id          uuid not null references public.units(id) on delete cascade,
  reservation_date date default current_date,   -- تاريخ الحجز
  status           text not null default 'حجز', -- حالة الحجز
  amount           numeric,                      -- المبلغ المدفوع
  notes            text
);

-- حماية الصفوف: قراءة/إضافة لكل مسجّل | تعديل/حذف للمدراء فقط
alter table public.reservations enable row level security;

create policy "authenticated can read reservations"
  on public.reservations for select to authenticated using (true);
create policy "authenticated can insert reservations"
  on public.reservations for insert to authenticated with check (true);
create policy "admins can update reservations"
  on public.reservations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete reservations"
  on public.reservations for delete to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
