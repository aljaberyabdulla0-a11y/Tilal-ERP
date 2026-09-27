-- ============================================================
-- تلال ERP — 101: محرّك التقارير — ما كشفه التشغيل بصلاحية غير المدير
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما حدث =====
--
-- اختبار الأداء بحساب مشرف وموظف (لا مدير) أسقط كل تقرير فيه مقياس
-- «حالة الآن»:
--
--     permission denied for function crm_owner_as_of
--
-- crm_state_as_of (097) بصلاحية السائل، وتذكر crm_owner_as_of في فرع
-- «كما كان» — وفي «الآن» لا تستدعيها أصلاً. لكن Postgres يفحص صلاحية
-- التنفيذ عند **تخطيط** الاستعلام لا عند تنفيذ الفرع، و096 سحبها من
-- authenticated. فالمدير لم يرَ شيئاً (يتجاوز) والبقية رأوا خطأً.
--
-- ===== الإصلاح =====
--
-- تُمنح للقارئ، وتحرس نفسها: من يسأل عبر الواجهة يحصل على مالك عميلٍ
-- يراه وحده، وإلا null. فلا تصير بابَ «من يملك هذا العميل؟» لعميلٍ
-- خارج النطاق. الاستدعاء الداخلي (اللقطة المجدولة) بلا طلب = يرى الكل.
--
-- ⚠️ وتُضاف الحالة إلى tests.run_reporting: المحرّك بصلاحية الموظف
--    بمقياس «الآن» — كي لا يعود هذا العطل صامتاً.
--
-- يتطلب: 096–100. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.crm_owner_as_of(p_client uuid, p_at timestamptz)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  -- طلبٌ من الواجهة: مالك عميلٍ في نطاق السائل وحده
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not (public.is_admin() or public.is_followup_manager() or public.can_read_all_crm()
              or public.can_see_client(p_client)) then
    return null;
  end if;

  select a.to_owner_id into r
    from public.client_assignments a
   where a.client_id = p_client and a.at <= p_at
   order by a.at desc limit 1;
  if found then return r.to_owner_id; end if;

  select a.from_owner_id, a.to_owner_id, a.method into r
    from public.client_assignments a
   where a.client_id = p_client and a.at > p_at
   order by a.at asc limit 1;
  if found then
    return coalesce(r.from_owner_id, case when r.method = 'ترحيل' then r.to_owner_id end);
  end if;

  return (select c.owner_id from public.clients c where c.id = p_client);
end $$;

revoke all on function public.crm_owner_as_of(uuid, timestamptz) from public, anon;
grant execute on function public.crm_owner_as_of(uuid, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------
-- روابط قديمة في جودة البيانات (083) تشير إلى /dashboard/crm/reports#lost
-- والتقرير القديم انتقل إلى /analysis (099). الصفحة الجديدة تحفظ
-- المرساة للإشعارات المرسلة، والدالة تُصحَّح هنا للقادم.
-- ------------------------------------------------------------
do $$
declare def text;
begin
  select pg_get_functiondef('public.crm_data_quality()'::regprocedure) into def;
  if def like '%/dashboard/crm/reports#lost%' then
    execute replace(def, '/dashboard/crm/reports#lost', '/dashboard/crm/reports/analysis#lost');
  end if;
end $$;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 101 ---';
  raise notice 'authenticated ينفّذ crm_owner_as_of: %',
    has_function_privilege('authenticated', 'public.crm_owner_as_of(uuid, timestamptz)', 'EXECUTE');
  raise notice 'رابط «بلا سبب خسارة»: %',
    (select fix_path from public.crm_data_quality() where code = 'lost_no_reason');
end $$;

notify pgrst, 'reload schema';
