-- ============================================================
-- تلال ERP — 133: الوسيط لا يمرّ من بوّابة can_see_client
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== الثغرة (قائمة منذ 043، كشفها tests.run_brokerage في 131) =====
--
-- 043 قرّرت: «لا تُوسَّع can_see_client للوسيط — هي بوّابة الفواتير والمدفوعات
-- والحجوزات، وتوسيعها كان يفتح مالية تلال لشركة وسيطة». لكن الدالّة فيها
--     c.created_by = auth.uid()
-- وكل ليدٍ يُدخله الوسيط هو منشئه — فكان يقرأ من ليداته عبرها: الحجوزات،
-- والفواتير، والمدفوعات، والمستندات، والفرص، والوسوم، والاهتمامات، ونقاط
-- الليد، ولمسات التسويق (٢٣ سياسة تستعملها).
--
-- ===== الإصلاح =====
-- الوسيط لا يمرّ منها أبداً. كل ما يحتاجه له بابه المستقل:
--   • العميل وتعديله       → سياسات clients (فرع broker_company_id)
--   • سجلّ التواصل          → can_see_broker_lead في سياسات client_activities،
--                              وتعديل/حذف نشاطه بـ created_by على النشاط نفسه
--   • الوحدات والطلبات      → broker_units() و broker_reservation_requests
-- فُحصت شاشات الوسيط: لا تقرأ ولا تكتب غير clients و client_activities
-- و project_nodes ودوالّ الطلب.
--
-- التغيير الوحيد عن الدالّة الحيّة: الشرط الأول `not public.is_broker()`.
-- آمن لإعادة التشغيل. التراجع: أعد الدالّة بلا ذلك الشرط.
-- ============================================================

create or replace function public.can_see_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not public.is_broker()
     and exists (
    select 1 from public.clients c
     where c.id = cid
       and c.deleted_at is null
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         -- أنا ومن أُشرف عليهم — بالمفتاح
         or (c.owner_id is not null
             and c.owner_id in (select s.id from public.my_scope_employees() s))
         -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
       )
  );
$function$;

comment on function public.can_see_client(uuid) is
  'بوّابة بيانات العميل الداخلية (حجوزات، فواتير، مدفوعات، مستندات، فرص...). الوسيط لا يمرّ منها أبداً — بابه can_see_broker_lead (sql/133).';

notify pgrst, 'reload schema';
