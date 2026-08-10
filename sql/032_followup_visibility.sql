-- ============================================================
-- تلال ERP — ظهور متابعات العملاء للموظفين
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المشكلة:
--   الموظف يرى العميل فقط إذا كان «موظف المبيعات» المكتوب على العميل
--   **يطابق حرفياً** اسمه في ملف الموظفين. أي فرق بسيط — مسافة زائدة،
--   مسافتان بين الاسمين، اختلاف حالة أحرف في اسم إنجليزي — يجعل
--   العميل مخفياً عنه تماماً، فلا تظهر له متابعاته.
--
-- ما يعالجه هذا الملف:
--   1) مقارنة الاسم تصير **متسامحة**: تتجاهل المسافات الزائدة وحالة
--      الأحرف. (لا تُوسّع الصلاحيات لغير ذلك — نفس القاعدة تماماً.)
--   2) دالة تشخيص للمدير: أي اسم «موظف مبيعات» مكتوب على عملاء
--      ولا يقابله حساب موظف — هؤلاء العملاء لا يراهم إلا المدير.
--
-- يتطلب: sql/005 و sql/012 و sql/023 و sql/026. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) مفتاح المقارنة الموحّد للأسماء
--    «  أحمد   علي » و «أحمد علي» يصيران شيئاً واحداً.
-- ------------------------------------------------------------
create or replace function public.name_key(txt text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(txt, '')), '\s+', ' ', 'g')), '');
$$;

-- ------------------------------------------------------------
-- 2) سياسات العملاء — نفس القاعدة، بمقارنة متسامحة
--    (المدير كل شيء | من أضاف العميل | من العميل مُسند له)
-- ------------------------------------------------------------
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and public.name_key(sales_employee)
          = (select public.name_key(public.my_employee_name()))
    )
  );

drop policy if exists "update own clients" on public.clients;
create policy "update own clients" on public.clients
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and public.name_key(sales_employee)
          = (select public.name_key(public.my_employee_name()))
    )
  )
  with check (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and public.name_key(sales_employee)
          = (select public.name_key(public.my_employee_name()))
    )
  );

-- ------------------------------------------------------------
-- 3) نفس التسامح في بوابة سجلّ التواصل
-- ------------------------------------------------------------
create or replace function public.can_see_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee)
                 = public.name_key(public.my_employee_name()))
       )
  );
$$;

-- ------------------------------------------------------------
-- 4) تشخيص للمدير: أسماء موظفي مبيعات بلا حساب مطابق
--    كل عميل تحت هذه الأسماء لا يراه إلا المدير — ومتابعاته
--    لا تصل لأي موظف.
-- ------------------------------------------------------------
create or replace function public.unmatched_sales_employees()
returns table (sales_employee text, clients integer, due_followups integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.sales_employee,
         count(*)::int,
         count(*) filter (
           where c.follow_up_date is not null
             and c.follow_up_date <= public.baghdad_today()
             and coalesce(c.stage, 'ليد') not in ('بيع', 'فشل البيع')
         )::int
    from public.clients c
   where public.is_admin()                       -- للمدير فقط
     and c.sales_employee is not null
     and btrim(c.sales_employee) <> ''
     and not exists (
       select 1 from public.employees e
        where e.user_id is not null              -- لا بد أن يملك حساب دخول
          and public.name_key(e.full_name) = public.name_key(c.sales_employee)
     )
   group by c.sales_employee
   order by 2 desc;
$$;

grant execute on function public.name_key(text)                 to authenticated;
grant execute on function public.unmatched_sales_employees()    to authenticated;

notify pgrst, 'reload schema';
