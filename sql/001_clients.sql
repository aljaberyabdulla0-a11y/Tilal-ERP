-- ============================================================
-- تلال ERP — جدول العملاء (CRM)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ============================================================

-- 1) جدول العملاء
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  name        text not null,          -- اسم العميل (إلزامي)
  phone       text,                   -- رقم الجوال
  email       text,                   -- البريد الإلكتروني
  city        text,                   -- المدينة
  status      text not null default 'جديد',  -- الحالة
  source      text,                   -- مصدر العميل (إعلان/إحالة...)
  notes       text                    -- ملاحظات
);

-- 2) تفعيل حماية الصفوف (Row Level Security)
alter table public.clients enable row level security;

-- 3) السياسات: أي مستخدم مسجّل دخوله يقدر يقرأ/يضيف/يعدّل/يحذف العملاء
--    (لاحقاً نضيّق الصلاحيات حسب أدوار الموظفين)
drop policy if exists "authenticated can read clients"   on public.clients;
drop policy if exists "authenticated can insert clients" on public.clients;
drop policy if exists "authenticated can update clients" on public.clients;
drop policy if exists "authenticated can delete clients" on public.clients;

create policy "authenticated can read clients"
  on public.clients for select
  to authenticated using (true);

create policy "authenticated can insert clients"
  on public.clients for insert
  to authenticated with check (true);

create policy "authenticated can update clients"
  on public.clients for update
  to authenticated using (true) with check (true);

create policy "authenticated can delete clients"
  on public.clients for delete
  to authenticated using (true);
