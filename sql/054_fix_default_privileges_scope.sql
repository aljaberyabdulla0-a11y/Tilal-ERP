-- ============================================================
-- تلال ERP — 054: تصحيح نطاق المنح الافتراضية (يُصلح sql/053)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ sql/053 **لم تحقّق هدفها**، وهذه الهجرة تُصلحها. لا تُعدَّل
--    053 لأنها طُبّقت على الإنتاج — التصحيح بهجرة جديدة.
--
-- ===== ماذا حدث =====
--
-- sql/053 كتبت:
--     alter default privileges for role postgres IN SCHEMA public
--       revoke execute on functions from public, anon, authenticated;
--
-- ونجحت في نصف عملها: اختفت منحتا anon و authenticated الصريحتان
-- من pg_default_acl. لكن الدوالّ الجديدة بقيت مفتوحة، وأثبته
-- الفحص بدالّة اختبارية داخل معاملة أُلغيت:
--
--     proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--              ^^^^^^^^^^^^ المنحة المدمجة لـ PUBLIC
--     has_function_privilege('authenticated', …) = true
--
-- والسبب دقيق ويستحقّ التدوين: منحة EXECUTE المدمجة لـ PUBLIC على
-- الدوالّ قاعدةٌ **عامة** لا تخصّ مخطّطاً. وقاعدة pg_default_acl
-- المقيَّدة بـ IN SCHEMA تُطبَّق **فوق** الافتراضي المدمج لا بدلاً
-- منه — فسحب PUBLIC داخل نطاق مخطّط لا يمسّ القاعدة العامة أصلاً،
-- ويمرّ الأمر بنجاح ولا يفعل شيئاً.
--
-- و authenticated عضوٌ في PUBLIC، فبقاء =X يعني بقاء الثغرة كاملة.
--
-- ===== الصيغة الصحيحة =====
--
-- بلا IN SCHEMA. جُرّبت في معاملة أُلغيت قبل الكتابة، فأعطت:
--     proacl = {postgres=X/postgres, service_role=X/postgres}
--     has_function_privilege('authenticated', …) = false
--
-- ⚠️ أثرها يشمل كل المخطّطات لا public وحده — لكل دالّة ينشئها
--    الدور postgres. وهذا مقبول: دوالّ تطبيقنا كلها في public،
--    وبنية Supabase تُنشئ دوالّها بدور supabase_admin لا postgres،
--    فلا تتأثّر.
--
-- ===== ما لا تفعله هذه الهجرة =====
-- لا تمسّ دالّة قائمة (المنح الافتراضية تسري على ما يُنشأ بعدها)،
-- ولا جدولاً، ولا سياسة، ولا types.ts، ولا شاشة.
--
-- ⚠️ ويبقى منح **الجداول** الافتراضي كما هو: كل جدول جديد يُمنح
--    كاملاً لـ anon و authenticated. حمايته تبقى معلّقة على تفعيل
--    RLS وسياساتها في كل هجرة. لم يُعالَج هنا عمداً — نطاق مستقل.
--
-- ===== التراجع =====
--   alter default privileges for role postgres
--     grant execute on functions to public;
--
-- طُبّق على القاعدة في 2026-09-03 عبر هجرة:
--   fix_default_privileges_scope
--
-- آمن لإعادة التشغيل.
-- ============================================================

-- القاعدة العامة: تُزيل الافتراضي المدمج لـ PUBLIC
alter default privileges for role postgres
  revoke execute on functions from public;

-- وللاحتياط: anon و authenticated صراحةً على المستوى العام أيضاً،
-- فلو أضاف Supabase منحةً عامة لهما يوماً لم تُفلت.
alter default privileges for role postgres
  revoke execute on functions from anon, authenticated;

-- وتبقى قاعدة sql/053 المقيَّدة بالمخطّط كما هي — لا تضرّ،
-- وتحرس لو أُعيد منح PUBLIC عاماً يوماً.

notify pgrst, 'reload schema';
