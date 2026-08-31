-- ============================================================
-- 049 — العمولات للمدير وحده
--
-- جداول العمولات تكشف ما تربحه الشركة من كل مطوّر ونسب الزملاء —
-- أرقام إدارية لا يطّلع عليها من يعمل تحتها. كان المشرف يقرأ
-- النسب والشرائح، والموظف يرى قاعدته وصفقاته؛ أُغلق الباب.
--
-- ⚠️ لا يفقد الموظف معرفة عمولته: تظهر له في كشف راتبه من جدول
-- commissions كما كانت — مبلغاً مستحقّاً له بلا كشف نسبة الشركة
-- ولا نسب زملائه.
--
-- تبقى سياسات «admin manages …» وحدها، وهي for all بصلاحية المدير.
-- ============================================================

drop policy if exists "team reads project commissions" on public.project_commissions;
drop policy if exists "team reads tiers"                on public.commission_tiers;
drop policy if exists "read my commission rule"         on public.employee_commission_rules;
drop policy if exists "read my sale commissions"        on public.sale_commissions;
