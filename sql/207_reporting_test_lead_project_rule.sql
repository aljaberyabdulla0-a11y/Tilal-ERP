-- ============================================================
-- تلال ERP — 207: تكييف اختبار التقارير مع قاعدة مشروع الليد (206) — اختبارات فقط
--
-- كان tests.run_reporting يفترض أن مُرشِّح المشروع لا يعدّ إلا عميلاً على
-- بطاقته مشروع (٤ تواصلات). بعد 206 مشروع الليد = مشروع بطاقته وإلا مشروع
-- موظّفه، فيُعدّ تواصل عملاء موظّفي المشروع أيضاً (٧). الاختبار يفحص الآن
-- ما يجب أن يبقى صحيحاً: المُرشِّح = بُعد المشروع في الأحداث نفسها.
-- (طُبّق ٢٠٢٦-١٠-١٣ — run_reporting ٣١/٣١)
-- ============================================================

do $p$
declare d text; d2 text;
begin
  d := replace(pg_get_functiondef('tests.run_reporting()'::regprocedure), E'\r', '');
  if position('206: مشروع الليد' in d) = 0 then
    d2 := replace(d,
$a$    log := log || extensions.is(n, 4, 'مُرشِّح المشروع: تواصل عميل المشروع وحده (٤)');$a$,
$b$    -- 206: مشروع الليد = مشروع بطاقته وإلا مشروع موظّفه — فتواصل عملاء موظّفي
    -- المشروع يُعدّ له أيضاً. المُرشِّح يطابق بُعد المشروع في الأحداث نفسها.
    select count(*) into n2 from public.crm_event_facts f
     where f.event_type = 'activity' and f.counts_as_contact and not f.is_void
       and f.event_date = d5 and f.project_id = proj;
    log := log || extensions.ok(n = n2 and n >= 4,
      format('مُرشِّح المشروع = بُعد المشروع في الأحداث (%s = %s، ويشمل عميل المشروع الأربعة) — 206: مشروع الليد', n, n2));$b$);
    if d2 = d then raise exception '207: لم يُعثر على موضع الترقيع في tests.run_reporting'; end if;
    execute d2;
  end if;
end $p$;
