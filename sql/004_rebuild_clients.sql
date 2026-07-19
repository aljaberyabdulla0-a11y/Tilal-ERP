-- ============================================================
-- تلال ERP — إعادة بناء جدول العملاء من الصفر (نظيف)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ تنبيه: يحذف جدول العملاء الحالي بكل بياناته (وهي تجريبية فقط)
--    ويعيد إنشاءه بالبنية الصحيحة التي يتوقّعها النظام تماماً.
-- ============================================================

-- 1) حذف الجدول القديم المتعارض بالكامل
drop table if exists public.clients cascade;

-- 2) إنشاء الجدول من جديد بالأعمدة الصحيحة
create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  name              text not null,          -- الاسم
  phone             text,                   -- رقم الهاتف
  governorate       text,                   -- المحافظة
  area              text,                   -- المنطقة
  purchase_purpose  text,                   -- الغرض من الشراء
  source            text,                   -- مصدر العميل
  payment_method    text,                   -- طريقة الدفع
  sales_employee    text,                   -- موظف المبيعات
  entry_date        date default current_date, -- التاريخ
  notes             text                    -- ملاحظات
);

-- 3) تفعيل حماية الصفوف والسياسات
alter table public.clients enable row level security;

create policy "authenticated can read clients"
  on public.clients for select to authenticated using (true);
create policy "authenticated can insert clients"
  on public.clients for insert to authenticated with check (true);
create policy "authenticated can update clients"
  on public.clients for update to authenticated using (true) with check (true);
create policy "authenticated can delete clients"
  on public.clients for delete to authenticated using (true);

-- 4) إعادة تحميل ذاكرة الواجهة
notify pgrst, 'reload schema';
