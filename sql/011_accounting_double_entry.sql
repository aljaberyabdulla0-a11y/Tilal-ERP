-- ============================================================
-- تلال ERP — نظام محاسبي احترافي (القيد المزدوج / Double-Entry)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- يستبدل النظام المبسّط القديم (transactions) بنظام معياري:
--   accounts (شجرة الحسابات) + journal_entries (قيود اليومية) + journal_lines (سطور القيد)
-- الوصول للمدراء فقط.
-- ============================================================

-- 0) حذف النظام القديم
drop table if exists public.transactions cascade;
drop table if exists public.journal_lines cascade;
drop table if exists public.journal_entries cascade;
drop table if exists public.accounts cascade;

-- 1) شجرة الحسابات (Chart of Accounts)
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,   -- رقم الحساب (مثل 1100)
  name       text not null,          -- اسم الحساب
  type       text not null,          -- asset|liability|equity|revenue|expense
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) قيود اليومية (رأس القيد)
create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  entry_date  date not null default current_date,
  description text not null,          -- بيان القيد
  reference   text                    -- مرجع اختياري
);

-- 3) سطور القيد (مدين/دائن لكل حساب)
create table public.journal_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  debit      numeric not null default 0,   -- مدين
  credit     numeric not null default 0,   -- دائن
  line_note  text,
  -- كل سطر يكون مديناً أو دائناً فقط (وليس الاثنين)، وبقيمة غير سالبة
  constraint one_sided check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0))
);

-- 4) حماية الصفوف: كل جداول المحاسبة للمدراء فقط
alter table public.accounts        enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;

create policy "admins all accounts" on public.accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins all journal_entries" on public.journal_entries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins all journal_lines" on public.journal_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) بذر شجرة حسابات معيارية لشركة تسويق عقاري
insert into public.accounts (code, name, type) values
  ('1100', 'الصندوق (نقد)',            'asset'),
  ('1200', 'البنك',                    'asset'),
  ('1300', 'المدينون / العملاء',       'asset'),
  ('1400', 'مخزون العقارات والوحدات',  'asset'),
  ('1500', 'الأصول الثابتة',           'asset'),
  ('2100', 'الدائنون / الموردون',      'liability'),
  ('2200', 'القروض',                   'liability'),
  ('2300', 'رواتب مستحقة الدفع',        'liability'),
  ('2400', 'عربونات محجوزة',           'liability'),
  ('3100', 'رأس المال',                'equity'),
  ('3200', 'الأرباح المحتجزة',          'equity'),
  ('4100', 'إيرادات المبيعات',         'revenue'),
  ('4200', 'إيرادات العمولات',         'revenue'),
  ('4300', 'إيرادات أخرى',             'revenue'),
  ('5100', 'الرواتب',                  'expense'),
  ('5200', 'الإيجار',                  'expense'),
  ('5300', 'مصاريف يومية',             'expense'),
  ('5400', 'فواتير الخدمات',           'expense'),
  ('5500', 'عمولات مدفوعة',            'expense'),
  ('5600', 'الصيانة',                  'expense'),
  ('5700', 'التسويق والإعلان',         'expense'),
  ('5800', 'مصاريف أخرى',              'expense');

notify pgrst, 'reload schema';
