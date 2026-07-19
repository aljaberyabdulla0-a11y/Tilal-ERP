-- ============================================================
-- تلال ERP — جدول الوحدات العقارية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ملاحظة: نحذف أي جدول units قديم (إن وُجد) ونبنيه نظيفاً — لا توجد بيانات لتخسرها.
-- ============================================================

drop table if exists public.units cascade;

create table public.units (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  project     text not null,          -- المشروع / المجمّع
  unit_code   text,                   -- رقم/كود الوحدة
  unit_type   text not null default 'شقة', -- نوع الوحدة
  governorate text,                   -- المحافظة
  area        text,                   -- المنطقة
  space_m2    numeric,                -- المساحة (م²)
  rooms       integer,                -- عدد الغرف
  price       numeric,                -- السعر
  status      text not null default 'متاحة', -- الحالة
  notes       text
);

-- حماية الصفوف: قراءة/إضافة لكل مسجّل | تعديل/حذف للمدراء فقط (مثل العملاء)
alter table public.units enable row level security;

create policy "authenticated can read units"
  on public.units for select to authenticated using (true);
create policy "authenticated can insert units"
  on public.units for insert to authenticated with check (true);
create policy "admins can update units"
  on public.units for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete units"
  on public.units for delete to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
