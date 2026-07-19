-- ============================================================
-- تلال ERP — الموارد البشرية (HR)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- جداول: employees (الموظفون) + attendance (الحضور/البصمة) + leaves (الإجازات)
--         + commissions (العمولات) + deductions (الاستقطاعات) + payrolls (كشوف الرواتب)
--
-- الصلاحيات: المدير يرى/يدير الكل. الموظف يرى بياناته فقط،
--            ويستطيع تسجيل حضوره وطلب إجازته.
-- ============================================================

drop table if exists public.payrolls    cascade;
drop table if exists public.deductions  cascade;
drop table if exists public.commissions cascade;
drop table if exists public.leaves      cascade;
drop table if exists public.attendance  cascade;
drop table if exists public.employees   cascade;

-- 1) الموظفون
create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete set null, -- ربط بحساب الدخول
  full_name   text not null,
  job_title   text,
  department  text,
  phone       text,
  hire_date   date,
  base_salary numeric not null default 0,
  status      text not null default 'active',  -- active | inactive
  notes       text,
  created_at  timestamptz not null default now()
);

-- 2) الحضور (تسجيل البصمة)
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date   date not null default current_date,
  check_in    timestamptz,
  check_out   timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

-- 3) الإجازات
create table public.leaves (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type  text not null default 'سنوية',   -- سنوية | مرضية | طارئة | بدون راتب
  start_date  date not null,
  end_date    date not null,
  days        integer,
  reason      text,
  status      text not null default 'معلقة',   -- معلقة | موافق عليها | مرفوضة
  created_at  timestamptz not null default now()
);

-- 4) العمولات
create table public.commissions (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount      numeric not null,
  comm_date   date not null default current_date,
  description text,
  created_at  timestamptz not null default now()
);

-- 5) الاستقطاعات
create table public.deductions (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount      numeric not null,
  ded_date    date not null default current_date,
  reason      text,
  created_at  timestamptz not null default now()
);

-- 6) كشوف الرواتب
create table public.payrolls (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  period            text not null,               -- الشهر YYYY-MM
  basic             numeric not null default 0,
  allowances        numeric not null default 0,
  commissions_total numeric not null default 0,
  deductions_total  numeric not null default 0,
  net               numeric not null default 0,
  status            text not null default 'غير مدفوع', -- مدفوع | غير مدفوع
  created_at        timestamptz not null default now()
);

-- دالة: معرّف الموظف المرتبط بالمستخدم الحالي
create or replace function public.my_employee_id()
returns uuid language sql security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

-- تفعيل RLS
alter table public.employees   enable row level security;
alter table public.attendance  enable row level security;
alter table public.leaves      enable row level security;
alter table public.commissions enable row level security;
alter table public.deductions  enable row level security;
alter table public.payrolls    enable row level security;

-- المدير: كل الصلاحيات على كل الجداول
create policy "admin employees"   on public.employees   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin attendance"  on public.attendance  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin leaves"      on public.leaves      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin commissions" on public.commissions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deductions"  on public.deductions  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin payrolls"    on public.payrolls    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الموظف: يقرأ بياناته فقط
create policy "emp read self"        on public.employees   for select to authenticated using (user_id = auth.uid());
create policy "emp read attendance"  on public.attendance  for select to authenticated using (employee_id = public.my_employee_id());
create policy "emp read leaves"      on public.leaves      for select to authenticated using (employee_id = public.my_employee_id());
create policy "emp read commissions" on public.commissions for select to authenticated using (employee_id = public.my_employee_id());
create policy "emp read deductions"  on public.deductions  for select to authenticated using (employee_id = public.my_employee_id());
create policy "emp read payrolls"    on public.payrolls    for select to authenticated using (employee_id = public.my_employee_id());

-- الموظف: يسجّل حضوره ويحدّثه (بصمة الدخول/الخروج)
create policy "emp insert attendance" on public.attendance for insert to authenticated with check (employee_id = public.my_employee_id());
create policy "emp update attendance" on public.attendance for update to authenticated using (employee_id = public.my_employee_id()) with check (employee_id = public.my_employee_id());

-- الموظف: يطلب إجازة (تبقى معلّقة حتى موافقة المدير)
create policy "emp insert leaves" on public.leaves for insert to authenticated with check (employee_id = public.my_employee_id() and status = 'معلقة');

notify pgrst, 'reload schema';
