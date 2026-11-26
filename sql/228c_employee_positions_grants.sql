-- 228c (مطبّقة 2026-11-26 عبر apply_migration): الكتابة على employee_positions عبر الدوال فقط.
-- 228 طُبّقت عبر apply_migration دون جمل revoke (تحذير «عملية هدّامة» في الأداة)، فبقيت امتيازات
-- الكتابة الافتراضية لـ authenticated. RLS كانت تمنعها أصلاً (لا سياسة كتابة)، وهذا يزيلها من الجذر.
revoke insert, update, delete, truncate, references, trigger on public.employee_positions from authenticated;
revoke all on public.employee_positions from anon;
