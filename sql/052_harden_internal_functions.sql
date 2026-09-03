-- ============================================================
-- تلال ERP — 052: تحصين الدوالّ الداخلية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ هجرة أمنية. لا تضيف جدولاً ولا عموداً ولا تغيّر منطقاً —
--    تسحب منحة تنفيذٍ ما كان يجب أن تُمنَح.
--
-- ===== الثغرة =====
--
-- ثماني عشرة دالّة `security definer` كانت ممنوحة للتنفيذ لكل
-- مستخدم مسجَّل. والدالّة `security definer` تعمل بصلاحية مالكها
-- **فتتجاوز RLS بحكم تعريفها** — فمن ملك تنفيذها ملك ما تفعله،
-- ولو لم يملك رؤية الصفّ الذي تعمل عليه.
--
-- أُثبتت الثغرة عملياً بحساب موظفة عادية (في معاملة أُلغيت):
--   repost_payroll('<كشف زميلتها>')      → نُفّذت، وأعادت كتابة قيد
--   repost_reservation_deposit('<حجز>')  → نُفّذت
--   record_sale_commission('<صفقة>')     → نُفّذت
--   scan_expired_reservations()          → نُفّذت
--   build_payroll(...)                   → رُفضت ✓ (تفحص is_admin)
--
-- وأخطرها ثلاث:
--   • record_sale_commission — تُعيد تجميد نِسَب الصفقة بأسعار
--     **اليوم**، فتنقض مبدأ تجميد sale_commissions وقت البيع،
--     وقد ترفع عمولة صفقة قديمة.
--   • settle_invoice_commission — قد تُنشئ عمولة وقيدها المحاسبي.
--   • عائلة repost_* — ستصير باباً خلفياً للكتابة في فترة مقفلة
--     حالما يُبنى قفل الفترات المحاسبية.
--
-- ===== لماذا السحب آمن =====
--
-- هذه الدوالّ لا تُنادى من الشاشة أصلاً، بل من ثلاثة أماكن:
--   ١) المحفّزات — وصلاحية تنفيذ دالّة المحفّز تُفحص **عند إنشاء
--      المحفّز** لا عند كل تشغيل.
--   ٢) دوالّ `security definer` أخرى — والاستدعاء الداخلي يجري
--      بصلاحية المالك لا بصلاحية المستخدم.
--   ٣) مهام pg_cron — تعمل بمستخدم postgres لا authenticated.
--
-- وفُحص قبل الكتابة أمران، وكلاهما صفر:
--   • كم دالّة منها مستعملة في تعبير سياسة RLS؟  → صفر
--     (لو استُعملت لتعطّل كل استعلام على جدولها.)
--   • كم دالّة `security invoker` تناديها؟        → صفر
--
-- ===== ما يبقى ممنوحاً =====
--
-- الواجهة الحقيقية للنظام، وكلها تفحص صلاحيتها بنفسها:
--   build_payroll · approve_payroll · reopen_payroll · lock_payroll
--   add_payroll_line · remove_payroll_line · handover_employee
--   reactivate_employee · request_unit_sale · decide_unit_sale
--   وأغلفة run_* (تفحص is_admin) لتشغيل المهام يدوياً.
--
-- ودوالّ الهوية والنطاق (is_admin · my_* · can_*) تبقى ممنوحة
-- **بالضرورة**: سياسات RLS نفسها تناديها، وتُنفَّذ بصلاحية
-- المستخدم السائل — فسحبها يُعطّل النظام كلّه.
--
-- ===== التراجع =====
-- هجرة جديدة تُعيد: grant execute on function <التوقيع> to authenticated;
--
-- طُبّق على القاعدة في 2026-09-03 عبر هجرة:
--   harden_internal_functions
--
-- آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) إعادة الترحيل المحاسبي — تُنادى من المحفّزات وحدها
-- ------------------------------------------------------------
revoke execute on function public.repost_payroll(uuid)             from authenticated, anon, public;
revoke execute on function public.repost_payroll_payment(uuid)     from authenticated, anon, public;
revoke execute on function public.repost_payment(uuid)             from authenticated, anon, public;
revoke execute on function public.repost_commission(uuid)          from authenticated, anon, public;
revoke execute on function public.repost_reservation_deposit(uuid) from authenticated, anon, public;
revoke execute on function public.repost_broker_payment(uuid)      from authenticated, anon, public;
revoke execute on function public.repost_inventory_purchase(uuid)  from authenticated, anon, public;

-- ------------------------------------------------------------
-- 2) إعادة الحساب — تكتب مجاميع وأرصدة
-- ------------------------------------------------------------
revoke execute on function public.refresh_payroll_totals(uuid)  from authenticated, anon, public;
revoke execute on function public.refresh_payroll_status(uuid)  from authenticated, anon, public;
revoke execute on function public.recalc_inventory_item(uuid)   from authenticated, anon, public;
revoke execute on function public.refresh_client_contact(uuid)  from authenticated, anon, public;

-- ------------------------------------------------------------
-- 3) العمولات
-- ------------------------------------------------------------
-- الأوليان تكتبان؛ والأخريان تقرآن نِسَب الشركة وقواعد الزملاء —
-- وهي أرقام إدارية أُغلقت على المدير في sql/049، فبقاء منحتهما
-- كان ينقض ذلك الإغلاق من باب خلفي.
revoke execute on function public.record_sale_commission(uuid)          from authenticated, anon, public;
revoke execute on function public.settle_invoice_commission(uuid)       from authenticated, anon, public;
revoke execute on function public.project_commission_rate(uuid, integer) from authenticated, anon, public;
revoke execute on function public.resolve_commission_rule(uuid, uuid, numeric) from authenticated, anon, public;

-- ------------------------------------------------------------
-- 4) المهام المجدولة — لها أغلفة run_* تفحص is_admin
-- ------------------------------------------------------------
revoke execute on function public.scan_expired_reservations()    from authenticated, anon, public;
revoke execute on function public.return_expired_broker_leads()  from authenticated, anon, public;

-- ------------------------------------------------------------
-- 5) سجلّ أحداث الوحدة — تكتبه المحفّزات لا المستخدم
-- ------------------------------------------------------------
-- بقاء منحته كان يسمح بتلفيق سطرٍ في تاريخ وحدة.
revoke execute on function public.log_unit_event(uuid, text, text) from authenticated, anon, public;

notify pgrst, 'reload schema';
