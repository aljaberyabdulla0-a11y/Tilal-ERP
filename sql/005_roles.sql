-- ============================================================
-- تلال ERP — نظام الأدوار والصلاحيات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الفكرة: كل مستخدم له "دور" (role): admin (مدير) أو employee (موظف).
--   - الموظف: يقرأ ويضيف العملاء فقط.
--   - المدير: يقدر أيضاً يعدّل ويحذف.
-- ============================================================

-- 1) جدول الملفات الشخصية — يربط كل مستخدم بدوره
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'employee',  -- 'admin' أو 'employee'
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- أي مستخدم مسجّل يقدر يقرأ الأدوار (لعرضها)، لكن لا يعدّلها من التطبيق
drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles"
  on public.profiles for select to authenticated using (true);

-- 2) دالة تتحقق: هل المستخدم الحالي مدير؟
--    security definer = تتجاوز حماية الصفوف لتفادي التكرار اللانهائي
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 3) إنشاء ملف شخصي تلقائياً لأي مستخدم جديد يسجّل مستقبلاً
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) إنشاء ملفات شخصية للمستخدمين الموجودين حالياً (دور موظف افتراضياً)
insert into public.profiles (id, email, role)
select id, email, 'employee' from auth.users
on conflict (id) do nothing;

-- 5) ترقية حسابك الرئيسي إلى "مدير"
update public.profiles
set role = 'admin'
where email = 'aljaberyabdulla0@gmail.com';

-- 6) تحديث صلاحيات جدول العملاء:
--    القراءة والإضافة = لكل مسجّل | التعديل والحذف = للمدراء فقط
drop policy if exists "authenticated can read clients"   on public.clients;
drop policy if exists "authenticated can insert clients" on public.clients;
drop policy if exists "authenticated can update clients" on public.clients;
drop policy if exists "authenticated can delete clients" on public.clients;

create policy "authenticated can read clients"
  on public.clients for select to authenticated using (true);

create policy "authenticated can insert clients"
  on public.clients for insert to authenticated with check (true);

create policy "admins can update clients"
  on public.clients for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admins can delete clients"
  on public.clients for delete to authenticated
  using (public.is_admin());

-- 7) إعادة تحميل ذاكرة الواجهة
notify pgrst, 'reload schema';
