-- ============================================================
-- تلال ERP — تمكين المدراء من تعديل أدوار المستخدمين من صفحة الإعدادات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ============================================================

-- سياسة: المدير فقط يقدر يعدّل صفوف جدول profiles (أي يغيّر الأدوار)
drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- إعادة تحميل ذاكرة الواجهة
notify pgrst, 'reload schema';
