-- ============================================================
-- تلال ERP — خصوصية بيانات العملاء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الفكرة: قبل هذا الملف كان أي موظف مسجّل يقرأ **كل** العملاء، ولذلك
-- إخفاء زر التصدير من الواجهة ما كان يحمي شيئاً — الموظف يقدر يوصل
-- للبيانات من الـ API مباشرة. الحماية الحقيقية تصير هنا داخل القاعدة:
--
--   المدير  → يشوف ويعدّل كل العملاء.
--   الموظف → يشوف ويعدّل فقط العملاء الذين:
--              • أضافهم بنفسه (created_by = حسابه)، أو
--              • مُسندين له (موظف المبيعات = اسمه في ملف الموظفين).
--
-- ملاحظة: العملاء القدامى الذين ليس لهم مُنشئ ولا اسم موظف مبيعات
-- سيراهم المدير فقط. لإسنادهم لموظف، عدّل حقل «موظف المبيعات»
-- ليطابق اسمه في ملف الموظفين تماماً.
--
-- يتطلب: sql/005 (الأدوار) و sql/012 (HR) و sql/017 (مراحل المبيعات).
-- الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) اسم الموظف المرتبط بالمستخدم الحالي
--    (نطابق به عمود «موظف المبيعات» النصّي في جدول العملاء)
--    security definer لأن الموظف لا يقرأ جدول الموظفين كاملاً.
-- ------------------------------------------------------------
create or replace function public.my_employee_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select full_name from public.employees where user_id = auth.uid() limit 1;
$$;

-- ------------------------------------------------------------
-- 2) استبدال سياسات العملاء المفتوحة
--    كل استدعاء دالة ملفوف بـ (select ...) ليُحسب مرة واحدة
--    للاستعلام كله بدل مرة لكل صف (توصية Supabase للأداء).
-- ------------------------------------------------------------

-- القراءة
drop policy if exists "authenticated can read clients" on public.clients;
drop policy if exists "read own clients"               on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and sales_employee = (select public.my_employee_name())
    )
  );

-- التعديل — لازم يُقيَّد أيضاً، وإلا صار بإمكان الموظف تعديل أي عميل
-- وقراءة الصف المعاد بعد التعديل (تسريب من الباب الخلفي).
drop policy if exists "authenticated can update clients" on public.clients;
drop policy if exists "admins can update clients"        on public.clients;
drop policy if exists "update own clients"               on public.clients;
create policy "update own clients" on public.clients
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and sales_employee = (select public.my_employee_name())
    )
  )
  with check (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and sales_employee = (select public.my_employee_name())
    )
  );

-- الإضافة تبقى متاحة لكل مسجّل، لكن نُلزم أن يكون المُنشئ هو نفسه
-- (لا يستطيع أحد نسب عميل لحساب غيره)
drop policy if exists "authenticated can insert clients" on public.clients;
drop policy if exists "insert clients"                   on public.clients;
create policy "insert clients" on public.clients
  for insert to authenticated
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

-- الحذف للمدراء فقط (كما كان)
drop policy if exists "admins can delete clients" on public.clients;
create policy "admins can delete clients" on public.clients
  for delete to authenticated using ((select public.is_admin()));

-- ------------------------------------------------------------
-- 3) فهارس تسرّع تطبيق السياسات
-- ------------------------------------------------------------
create index if not exists clients_created_by_idx     on public.clients (created_by);
create index if not exists clients_sales_employee_idx on public.clients (sales_employee);

notify pgrst, 'reload schema';
