-- ============================================================
-- تلال ERP — صلاحية المشرف في التعديل داخل الـ CRM
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الحالة قبل هذا الملف (فُحصت عملياً لا نظرياً): المشرف كان **يقدر**
-- يعدّل بيانات عملاء فريقه ويغيّر مراحلهم ومواعيد متابعتهم ويسجّل
-- التواصل ويضيف عملاء — لأن سياسة `update own clients` مبنية على
-- نطاق الأسماء. لكنه كان **لا يقدر** على ثلاثة أشياء داخل الـ CRM:
--     1) تعديل وحدات مشروعه (الحالة، السعر، التفاصيل)
--     2) تعديل حجوزات عملاء فريقه
--     3) تصحيح تسجيل تواصل كتبه أحد موظفيه
--
-- هذا الملف يفتح الثلاثة.
--
-- ⚠️ كل شرط هنا مقيّد بـ `is_supervisor()` عمداً. بدونه كان الموظف
--    العادي سيرث نفس الصلاحيات — لأن `can_see_client` و`my_project_ids`
--    تصدُقان عليه هو أيضاً في نطاقه. المطلوب توسيع صلاحية المشرف
--    وحده، لا صلاحيات الجميع.
--
-- ⚠️ **الحذف يبقى للمدير**: حذف عميل أو وحدة أو حجز لا رجعة فيه،
--    و«التعديل» المطلوب لا يعنيه. يُفتح بطلب صريح.
--
-- يتطلب: sql/036 و sql/037. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) وحدات المشروع الذي يشرف عليه
-- ------------------------------------------------------------
-- ملاحظة دقيقة: نستعمل `my_supervised_projects()` لا `my_project_ids()`.
-- الثانية تشمل المشروع الذي *ينتمي* إليه الموظف، فلو استعملناها
-- لصار كل موظف يعدّل وحدات مشروعه — وهذا ليس المطلوب.
drop policy if exists "admins can update units" on public.units;
create policy "update units in scope" on public.units
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_supervisor())
      and project_id in (select s.id from public.my_supervised_projects() s)
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.is_supervisor())
      and project_id in (select s.id from public.my_supervised_projects() s)
    )
  );

-- ------------------------------------------------------------
-- 2) حجوزات عملاء فريقه
-- ------------------------------------------------------------
drop policy if exists "admins can update reservations" on public.reservations;
create policy "update reservations in scope" on public.reservations
  for update to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_supervisor()) and public.can_see_client(client_id))
  )
  with check (
    (select public.is_admin())
    or ((select public.is_supervisor()) and public.can_see_client(client_id))
  );

-- ------------------------------------------------------------
-- 3) تصحيح تسجيل تواصل كتبه أحد موظفيه
-- ------------------------------------------------------------
-- المشرف يصحّح الخطأ، ولا يحذف السجلّ: الحذف يمحو أثر من تواصل
-- ومتى، وهو ما تُبنى عليه تقارير المتابعة والتصعيد.
drop policy if exists "update own activities" on public.client_activities;
create policy "update own activities" on public.client_activities
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or ((select public.is_supervisor()) and public.can_see_client(client_id))
  )
  with check (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or ((select public.is_supervisor()) and public.can_see_client(client_id))
  );

notify pgrst, 'reload schema';
