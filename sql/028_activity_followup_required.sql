-- ============================================================
-- تلال ERP — موعد المتابعة إلزامي في تسجيل التواصل
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- القاعدة: لا يُحفظ أي تواصل بدون تحديد موعد المتابعة القادم —
-- في كل المراحل بلا استثناء. هكذا لا يبقى عميل بلا خطوة تالية.
--
-- الاستثناء الوحيد: «تغيير مرحلة» لأن النظام يسجّله تلقائياً.
--
-- ملاحظة: نستخدم NOT VALID كي لا يرفض القيدُ السجلات القديمة التي
-- أُدخلت قبل هذه القاعدة — لكنه يسري على كل إضافة أو تعديل جديد،
-- بما فيها تعديل سجلّ قديم (فيُطلب حينها تحديد الموعد).
--
-- يتطلب: sql/026. الملف آمن لإعادة التشغيل.
-- ============================================================

alter table public.client_activities
  drop constraint if exists client_activities_next_date_chk;

alter table public.client_activities
  add constraint client_activities_next_date_chk
  check (activity_type = 'تغيير مرحلة' or next_action_date is not null)
  not valid;

notify pgrst, 'reload schema';
