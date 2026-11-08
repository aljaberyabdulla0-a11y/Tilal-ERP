-- ============================================================
-- تلال ERP — 224: تصحيح 223 — حفظ الموظف رُفض بـ
--   «permission denied for function valid_work_day_hours»
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- قيد employees_day_hours_chk يستدعي الدالة بدور من يحفظ (authenticated)،
-- والدوال الجديدة تُنشأ بلا صلاحية تنفيذ له. الدالة نقية (تفحص jsonb فقط
-- ولا تقرأ جدولاً)، فمنحها آمن.
--
-- يتطلب: 223. آمن لإعادة التشغيل.
-- ============================================================

grant execute on function public.valid_work_day_hours(jsonb) to authenticated;
