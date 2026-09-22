-- ============================================================
-- تلال ERP — 088: سدّ ثغرتين كشفهما مستشار الأمان
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- كلتاهما إرثٌ من قبل الـCRM، ظهرتا حين فُحصت القاعدة بعد اكتمال
-- الهجرات. ولا تُستغَلّان اليوم — والكامن يُسدّ قبل أن يُستغَلّ.
-- ============================================================

-- ------------------------------------------------------------
-- 1) team_members: عرضٌ للقراءة يُكتب من خلاله
--
-- العرض `security definer` عمداً — شرط النطاق مكتوب في WHERE داخله
-- (is_admin أو is_followup_manager أو my_scope_employees)، فيتجاوز
-- RLS على employees ويُطبّق نطاقه بنفسه. وهذا صحيح **للقراءة**.
--
-- لكنه عرضٌ بسيط على جدول واحد، أي **قابل للتحديث تلقائياً**، و
-- authenticated يملك عليه INSERT و UPDATE و DELETE و TRUNCATE.
-- والنتيجة:
--
--     مدير المتابعة يرى كل الموظفين في هذا العرض (شرط WHERE)،
--     فيستطيع تعديل صفوفهم أو حذفها من خلاله — بينما RLS على
--     employees تقصر الكتابة على المدير والموارد البشرية وحدهما.
--
-- والمشرف كذلك، داخل نطاقه. ثغرة كامنة لا مُستغَلّة: لا حساب بدور
-- مدير متابعة اليوم — ولو أُنشئ غداً لعملت بلا أن يعلم أحد.
--
-- العلاج: العرض للقراءة وحدها. الكتابة تذهب إلى الجدول حيث RLS.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.team_members from authenticated;

comment on view public.team_members is
  'عرض قراءة لنطاق الفريق. definer عمداً — شرط النطاق في WHERE داخله. '
  'لا كتابة من خلاله: الكتابة على employees حيث تسري RLS (088).';

-- ------------------------------------------------------------
-- 2) دوالّ ذات أثر جانبي مفتوحة لغير المسجَّل
--
-- صلاحية EXECUTE تُمنح لـ PUBLIC افتراضياً في Postgres، فورثت
-- الدوال القديمة ذلك قبل أن يُضبط الافتراض في sql/053 و054.
--
-- وكلها تفحص الصلاحية داخلها فلا يقع ضرر اليوم. لكن الفحص الداخلي
-- هو الخطّ الثاني لا الأول: الأول ألّا تُنادى أصلاً. ودالةٌ تُنهي
-- خدمة موظف (handover_employee) لا تُترك على مسافة نداءٍ من زائر.
--
-- ⚠️ الدوال المساعدة للقراءة (is_admin، my_*، can_see_*) تبقى كما
--    هي عمداً: تستدعيها سياسات RLS نفسها، ونزعها من anon يحوّل
--    استعلاماً كان يعود فارغاً إلى خطأ — وهو تغيير سلوك لا تشديد.
-- ------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'handover_employee(uuid, uuid, text, boolean, boolean)',
    'reactivate_employee(uuid)',
    'run_auto_checkout(integer)',
    'run_broker_lead_scan()',
    'run_crm_followup_scan()',
    'run_tasks_daily_reminder()',
    'create_group_conversation(text, uuid[])',
    'get_or_create_direct(uuid)',
    'mark_conversation_read(uuid)',
    'unmatched_sales_employees()']
  loop
    begin
      execute format('revoke all on function public.%s from public, anon', fn);
      execute format('grant execute on function public.%s to authenticated, service_role', fn);
    exception when undefined_function then
      raise warning 'دالة غير موجودة فتُخطّى: %', fn;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) المهامّ المجدولة لـ service_role — إلا ما له زرّ
--
-- ⚠️ run_crm_followup_scan يبقى للمسجَّل: يناديه زرّ «فحص المتابعات
--    الآن» في التقارير، وهو يفحص is_admin() داخلياً ويرفع استثناءً
--    لغيره. نزعُه يكسر الزرّ بلا أن يزيد أماناً.
-- ------------------------------------------------------------
revoke execute on function public.run_tasks_daily_reminder() from authenticated;
revoke execute on function public.run_broker_lead_scan()     from authenticated;
grant  execute on function public.run_tasks_daily_reminder() to service_role;
grant  execute on function public.run_broker_lead_scan()     to service_role;
grant  execute on function public.run_crm_followup_scan()    to authenticated, service_role;

comment on function public.run_crm_followup_scan() is
  'فحص المتابعات يدوياً — للإدارة (يفحص is_admin داخلياً). يعمل تلقائياً ٩ صباحاً بغداد.';

-- ------------------------------------------------------------
-- 4) ما لم يُعالَج هنا — وسببه
--
--   • extension_in_public: pg_trgm في public. نقله يكسر الفهرس
--     clients_name_trgm_idx المبنيّ عليه، والمكسب أمنيّ نظريّ.
--
--   • search_path على دوالّ ليست definer (baghdad_today،
--     geo_distance_m، is_system_activity…): لا تعمل بصلاحية مرفوعة،
--     فاختطاف search_path لا يمنح شيئاً.
--
--   • auth_leaked_password_protection: إعداد في لوحة Supabase لا في
--     SQL — يُفعَّل من Authentication ← Policies.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 5) التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 088 تشديد الأمان ---';
  raise notice 'الكتابة عبر team_members: % (يجب false)',
    has_table_privilege('authenticated', 'public.team_members', 'UPDATE');
  raise notice 'القراءة منه: % (يجب true)',
    has_table_privilege('authenticated', 'public.team_members', 'SELECT');
  raise notice 'زرّ فحص المتابعات يعمل: % (يجب true)',
    has_function_privilege('authenticated', 'public.run_crm_followup_scan()', 'EXECUTE');
  raise notice 'غير المسجَّل يفحص المتابعات: % (يجب false)',
    has_function_privilege('anon', 'public.run_crm_followup_scan()', 'EXECUTE');
  raise notice 'غير المسجَّل يُنهي خدمة موظف: % (يجب false)',
    has_function_privilege('anon',
      'public.handover_employee(uuid,uuid,text,boolean,boolean)', 'EXECUTE');
end $$;

notify pgrst, 'reload schema';
