-- ============================================================
-- تلال ERP — تحديث جدول العملاء ليشمل تفاصيل العراق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- هذا السكربت آمن: يعمل سواء كنت شغّلت 001 من قبل أو لا.
-- ============================================================

-- 1) إنشاء الجدول إن لم يكن موجوداً (بالهيكل الجديد الكامل)
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  name              text not null,          -- الاسم (إلزامي)
  phone             text,                   -- رقم الهاتف
  governorate       text,                   -- المحافظة
  area              text,                   -- المنطقة
  purchase_purpose  text,                   -- الغرض من الشراء (سكن/استثمار)
  source            text,                   -- مصدر العميل
  payment_method    text,                   -- طريقة الدفع
  sales_employee    text,                   -- موظف المبيعات
  entry_date        date default current_date, -- التاريخ
  notes             text                    -- ملاحظات
);

-- 2) إضافة الأعمدة الجديدة إن كان الجدول قديماً (آمن حتى لو موجودة)
alter table public.clients add column if not exists governorate      text;
alter table public.clients add column if not exists area             text;
alter table public.clients add column if not exists purchase_purpose text;
alter table public.clients add column if not exists payment_method   text;
alter table public.clients add column if not exists sales_employee   text;
alter table public.clients add column if not exists entry_date       date default current_date;

-- 3) حذف الأعمدة القديمة التي لم نعد نحتاجها (بيانات تجريبية فلا خسارة)
alter table public.clients drop column if exists email;
alter table public.clients drop column if exists city;
alter table public.clients drop column if exists status;

-- 4) التأكد من تفعيل حماية الصفوف والسياسات (آمن للتكرار)
alter table public.clients enable row level security;

drop policy if exists "authenticated can read clients"   on public.clients;
drop policy if exists "authenticated can insert clients" on public.clients;
drop policy if exists "authenticated can update clients" on public.clients;
drop policy if exists "authenticated can delete clients" on public.clients;

create policy "authenticated can read clients"
  on public.clients for select to authenticated using (true);
create policy "authenticated can insert clients"
  on public.clients for insert to authenticated with check (true);
create policy "authenticated can update clients"
  on public.clients for update to authenticated using (true) with check (true);
create policy "authenticated can delete clients"
  on public.clients for delete to authenticated using (true);
