-- ============================================================
-- تلال ERP — 057: تاريخ الراتب
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- مسحوبة إلى الأمام من المرحلة ٤/ج لأنها **شرطٌ** للمرحلة ١:
-- محرّك خصم الدوام يشترط أن تُشتقّ قيمة اليوم من «الراتب الساري
-- في تاريخ الفترة».
--
-- ===== المشكلة =====
--
-- employees.base_salary عمودٌ مفرد يُكتب فوقه. فلو رُفع راتب موظفة
-- في تشرين ثم أُعيد بناء كشف أيلول، حُسب غيابُ أيلول **بالراتب
-- الجديد** — والتاريخ يُعاد كتابته بلا أثر يُنبّه.
--
-- والمبدأ نفسه المطبَّق في sale_commissions منذ sql/048: ما استُحقّ
-- بنسبةٍ يوم كذا لا تُعيد نسبةُ اليوم حسابَه.
--
-- ===== الحلّ =====
--
-- سجلٌّ بتواريخ سريان، و salary_at(employee, date) تُرجع الساري
-- في أي يوم. والعمود base_salary **يبقى** — هو الراتب الحالي وواجهةُ
-- التحرير في الشاشة، ومحفّزٌ يكتب سجلاً عند كل تغيير فيه. فلا
-- شاشة تنكسر ولا حقل يُهجر.
--
-- ⚠️ salary_at لا تُمنح لـ authenticated عمداً: هي security definer
--    وتقبل أي employee_id، فمنحها يكشف رواتب الزملاء. تُنادى من
--    build_payroll وهي definer تعمل بصلاحية المالك.
--
-- ===== التراجع =====
--   drop trigger trg_employee_salary_history on public.employees;
--   drop function public.log_salary_change();
--   drop function public.salary_at(uuid, date);
--   drop table public.employee_salary_history;
--
-- طُبّق على القاعدة في 2026-09-04 عبر هجرة:
--   employee_salary_history
--
-- آمن لإعادة التشغيل.
-- ============================================================

create table if not exists public.employee_salary_history (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  amount          numeric not null check (amount >= 0),
  effective_from  date not null,
  reason          text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  -- راتبان يسريان في اليوم نفسه لموظفٍ واحد تناقض
  constraint employee_salary_history_uniq unique (employee_id, effective_from)
);

create index if not exists employee_salary_history_lookup
  on public.employee_salary_history (employee_id, effective_from desc);

comment on table public.employee_salary_history is
  'تاريخ رواتب الموظف بتواريخ سريانها. المصدر الوحيد لقيمة اليوم في أي فترة ماضية (sql/057).';

-- ------------------------------------------------------------
-- الراتب الساري في تاريخ
-- ------------------------------------------------------------
-- ⚠️ الرجوع إلى base_salary عند غياب السجلّ مقصود: يجعل الدالّة
--    تُجيب دائماً ولا تُرجع صفراً يُخصم به راتب موظف بالخطأ.
create or replace function public.salary_at(p_employee uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select h.amount
       from public.employee_salary_history h
      where h.employee_id = p_employee
        and h.effective_from <= p_date
      order by h.effective_from desc
      limit 1),
    (select e.base_salary from public.employees e where e.id = p_employee),
    0
  );
$fn$;

comment on function public.salary_at(uuid, date) is
  'الراتب الساري لموظف في تاريخ. غير ممنوحة لـ authenticated عمداً — تكشف رواتب الغير.';

-- ------------------------------------------------------------
-- الملء الرجعي — **قبل** إنشاء المحفّز
-- ------------------------------------------------------------
-- لو أُنشئ المحفّز أولاً لَما تغيّر شيء (الملء إدراجٌ في السجلّ لا
-- تعديلٌ للراتب)، لكن الترتيب يبقى الأوضح لمن يقرأ.
insert into public.employee_salary_history
  (employee_id, amount, effective_from, reason)
select e.id,
       e.base_salary,
       coalesce(e.hire_date, e.created_at::date, date '2020-01-01'),
       'ملء رجعي عند إنشاء تاريخ الرواتب (sql/057)'
  from public.employees e
 where e.base_salary is not null
   and not exists (select 1 from public.employee_salary_history h
                    where h.employee_id = e.id)
on conflict (employee_id, effective_from) do nothing;

-- ------------------------------------------------------------
-- كل تغيير للراتب يترك أثراً
-- ------------------------------------------------------------
create or replace function public.log_salary_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_who text; v_when date;
begin
  if tg_op = 'UPDATE' and new.base_salary is not distinct from old.base_salary then
    return new;
  end if;
  if new.base_salary is null then
    return new;
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  v_when := (now() at time zone 'Asia/Baghdad')::date;

  -- تغييران في اليوم نفسه: الأخير يغلب. تصحيحُ خطأٍ فوري لا يُنشئ
  -- سطرين متناقضين في تاريخ واحد.
  insert into public.employee_salary_history
    (employee_id, amount, effective_from, reason, created_by, created_by_name)
  values (new.id, new.base_salary, v_when,
          case when tg_op = 'INSERT' then 'راتب التعيين' else 'تعديل الراتب' end,
          auth.uid(), v_who)
  on conflict (employee_id, effective_from) do update
    set amount          = excluded.amount,
        reason          = excluded.reason,
        created_by      = excluded.created_by,
        created_by_name = excluded.created_by_name,
        created_at      = now();

  return new;
end;
$fn$;

drop trigger if exists trg_employee_salary_history on public.employees;
create trigger trg_employee_salary_history
  after insert or update of base_salary on public.employees
  for each row execute function public.log_salary_change();

-- ------------------------------------------------------------
-- الصلاحيات
-- ------------------------------------------------------------
alter table public.employee_salary_history enable row level security;

drop policy if exists "admin salary history" on public.employee_salary_history;
create policy "admin salary history" on public.employee_salary_history
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- الموظف يرى تاريخ راتبه هو — لا رواتب زملائه
drop policy if exists "employee reads own salary history" on public.employee_salary_history;
create policy "employee reads own salary history" on public.employee_salary_history
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));

-- ⚠️ لا منحة لـ salary_at: تُنادى من دوالّ definer فقط (sql/054).

notify pgrst, 'reload schema';
