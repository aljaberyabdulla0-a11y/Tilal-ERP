-- ============================================================
-- تلال ERP — إصلاح: ضمان وجود كل أعمدة جدول العملاء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- آمن تماماً: يضيف فقط الأعمدة الناقصة ولا يحذف أي بيانات.
-- ============================================================

alter table public.clients add column if not exists name             text;
alter table public.clients add column if not exists phone            text;
alter table public.clients add column if not exists governorate      text;
alter table public.clients add column if not exists area             text;
alter table public.clients add column if not exists purchase_purpose text;
alter table public.clients add column if not exists source           text;
alter table public.clients add column if not exists payment_method   text;
alter table public.clients add column if not exists sales_employee   text;
alter table public.clients add column if not exists entry_date       date default current_date;
alter table public.clients add column if not exists notes            text;

-- إعادة تحميل ذاكرة الواجهة حتى تتعرّف على الأعمدة فوراً
notify pgrst, 'reload schema';
