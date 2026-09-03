-- ============================================================
-- تلال ERP — 053: الحصانة الدائمة على منح التنفيذ
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ هجرة أمنية تكميلية لـ sql/052. لا جدول ولا عمود ولا دالّة ولا
--    محفّز ولا سياسة — تُغيّر ما تُولد به الدوالّ **القادمة**.
--
-- ===== لماذا =====
--
-- sql/052 سحبت المنحة عن ثماني عشرة دالّة قائمة. لكنها لم تمنع
-- تكرار الثغرة: كل دالّة تُكتب بعدها كانت ستولد ممنوحةً من جديد،
-- فيعود العيب مع أول هجرة قادمة.
--
-- ===== الصيغة الشائعة لا تكفي هنا =====
--
-- المعروف أن بوستكرس يمنح EXECUTE إلى PUBLIC تلقائياً، فيُظنّ أن
-- العلاج:
--     alter default privileges in schema public
--       revoke execute on functions from public;
--
-- وهذا **يمرّ بنجاح ولا يفعل شيئاً هنا**. فُحص pg_default_acl قبل
-- الكتابة فتبيّن أن Supabase لا يعتمد وراثة PUBLIC، بل يمنح
-- anon و authenticated **صراحةً بأسمائهما**، ومن **دورين**:
--
--   for_role = postgres        · public · functions
--        {postgres=X, anon=X, authenticated=X, service_role=X}
--   for_role = supabase_admin  · public · functions
--        {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- فالسحب يجب أن يُسمّيهما، وأن يجري لكل دور على حدة. ودوالّ public
-- الـ142 كلها مملوكة لـ postgres — وهو دور الهجرات.
--
-- ===== الثمن: انضباطٌ في كل هجرة قادمة =====
--
-- بعد هذه الهجرة تخرج كل دالّة **بلا منحة**، فيلزم في ذيل كل هجرة
-- قسمُ منحٍ صريح بثلاث فئات:
--
--   • تُنادى من الشاشة بـ rpc()   → grant execute … to authenticated
--   • تناديها سياسة RLS           → grant execute … to authenticated
--     ⚠️ إلزامي. نسيانه يعطّل كل استعلام على جدول تلك السياسة،
--        لأن السياسة تُنفَّذ بصلاحية المستخدم السائل لا المالك.
--   • داخلية (محفّزات فقط)        → لا منحة
--
-- والمكسب أن الخطأ صار «مغلقاً» لا «مفتوحاً»: الدالّة المنسيّة
-- تُكشَف بتعطّل الشاشة فوراً، لا بتسرّبٍ صامت لا يراه أحد.
--
-- ===== الأثر على الموجود: صفر =====
-- المنح الافتراضية تسري على ما يُنشأ بعدها فقط. لا دالّة قائمة
-- تتأثّر، ولا شاشة تتغيّر، ولا types.ts.
--
-- ===== التراجع =====
--   alter default privileges for role postgres in schema public
--     grant execute on functions to anon, authenticated;
--
-- طُبّق على القاعدة في 2026-09-03 عبر هجرة:
--   default_execute_privileges
--
-- آمن لإعادة التشغيل.
-- ============================================================

-- الدور الذي يملك كل دوالّ public وتعمل به الهجرات
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- والدور الثاني الذي يضع Supabase له منحاً افتراضية على نفس
-- المخطّط. قد يرفضه الخادم لعدم العضوية في الدور — ولذلك يُلفّ
-- في كتلة تُبلّغ ولا تُسقط الهجرة.
do $do$
begin
  execute 'alter default privileges for role supabase_admin in schema public
             revoke execute on functions from public, anon, authenticated';
  raise notice 'سُحبت المنحة الافتراضية عن supabase_admin أيضاً';
exception when insufficient_privilege or others then
  raise notice 'تعذّر تعديل منح supabase_admin (لا عضوية في الدور) — منح postgres سُحبت، وهي التي تملك دوالّ المشروع';
end $do$;

notify pgrst, 'reload schema';
