-- ============================================================
-- تلال ERP — الشركاء وتصفية الحسابات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- شريكان (عبدالله وأحمد) بنسب متساوية 50%. المصاريف تُقسَّم بينهما،
-- لكن أحياناً يدفع أحدهما المبلغ كاملاً. النظام يسجّل من دفع، ثم يحسب
-- من مدين لمن، مع إمكانية تسجيل تسوية (دفعة من شريك لآخر).
-- الوصول للمدراء فقط.
-- ============================================================

drop table if exists public.partner_settlements cascade;
drop table if exists public.partner_expenses    cascade;
drop table if exists public.partners            cascade;

-- 1) الشركاء
create table public.partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  share_percent numeric not null default 50,   -- نسبة الشراكة
  created_at    timestamptz not null default now()
);

-- 2) المصاريف المشتركة (من دفعها فعلياً)
create table public.partner_expenses (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  expense_date date not null default current_date,
  description  text not null,
  amount       numeric not null,
  paid_by      uuid not null references public.partners(id) on delete cascade,
  category     text,
  notes        text
);

-- 3) التسويات (دفعة من شريك لآخر لتصفية المديونية)
create table public.partner_settlements (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  settlement_date date not null default current_date,
  from_partner    uuid not null references public.partners(id) on delete cascade,
  to_partner      uuid not null references public.partners(id) on delete cascade,
  amount          numeric not null,
  notes           text
);

-- حماية الصفوف: للمدراء فقط
alter table public.partners            enable row level security;
alter table public.partner_expenses    enable row level security;
alter table public.partner_settlements enable row level security;

create policy "admin partners"    on public.partners            for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin p_expenses"  on public.partner_expenses    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin p_settle"    on public.partner_settlements for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- بذر الشريكين
insert into public.partners (name, share_percent) values
  ('عبدالله', 50),
  ('أحمد', 50);

notify pgrst, 'reload schema';
