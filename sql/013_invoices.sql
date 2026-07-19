-- ============================================================
-- تلال ERP — الفواتير والمدفوعات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- invoices (الفواتير، مرتبطة بعميل وحجز اختياري) + payments (الدفعات/الأقساط)
-- حالة الفاتورة تُحسب من مجموع الدفعات (مدفوعة/جزئياً/غير مدفوعة).
-- ============================================================

drop table if exists public.payments cascade;
drop table if exists public.invoices cascade;

-- تسلسل ترقيم الفواتير (INV-0001 ...)
create sequence if not exists public.invoice_seq;

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  invoice_number text not null default ('INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0')),
  client_id      uuid not null references public.clients(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  issue_date     date not null default current_date,
  due_date       date,
  total_amount   numeric not null default 0,
  notes          text
);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  amount       numeric not null,
  payment_date date not null default current_date,
  method       text,
  note         text
);

-- حماية الصفوف: قراءة/إضافة لكل مسجّل | تعديل/حذف للمدراء فقط
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

create policy "auth read invoices"   on public.invoices for select to authenticated using (true);
create policy "auth insert invoices" on public.invoices for insert to authenticated with check (true);
create policy "admin update invoices" on public.invoices for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete invoices" on public.invoices for delete to authenticated using (public.is_admin());

create policy "auth read payments"   on public.payments for select to authenticated using (true);
create policy "auth insert payments" on public.payments for insert to authenticated with check (true);
create policy "admin update payments" on public.payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete payments" on public.payments for delete to authenticated using (public.is_admin());

notify pgrst, 'reload schema';
