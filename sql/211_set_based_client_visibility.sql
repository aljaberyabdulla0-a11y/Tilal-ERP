-- ============================================================
-- تلال ERP — 211: صلاحية رؤية العميل تُحسب مرّة للاستعلام لا لكل صف
--
-- العَرَض (٢٠٢٦-١٠-١٤): الموظف يفتح «سجلّ التواصل» فيرى «لا يوجد تواصل
--   مسجّل» وأصفاراً، و«تقاريري» فارغة أو ناقصة — والإدارة ترى كل شيء.
--   سجلّ Postgres: «canceling statement due to statement timeout» في
--   استعلام client_activities وفي crm_report_query، والسياق كلّه
--   can_see_client ← my_scope_employees / my_scope_name_keys.
--
-- السبب: سياسات القراءة تنادي can_see_client(client_id) لكل صف، وكل
--   نداء يعيد حساب نطاق الموظف من الصفر (~١٫٤ مللي ثانية). على ٦٬٩٣٣
--   حدث تواصل = ١٠ ثوانٍ، وحدّ authenticated ٨ ثوانٍ ⇒ يُلغى الاستعلام
--   فتعرض الصفحة الفراغ. الإدارة لا تتأثّر لأن is_admin() تُقصِر الشرط.
--   والتقارير تقرأ opportunities بسياستها نفسها (crm_state_as_of
--   بصلاحية المستدعي) ⇒ ~٢ ثانية للقسم، وعشرات الأقسام معاً تتجاوز الحدّ.
--
-- القاعدة: نطاق الرؤية مجموعةٌ تُحسب مرّة —
--   client_id IN (SELECT my_visible_client_ids())  ⇒ hashed SubPlan واحد.
--   my_visible_client_ids() = نفس شروط can_see_client حرفياً (طُوبقت على
--   الإنتاج: مشرف ٨٧٠=٨٧٠، موظف ١٢٤=١٢٤، مدير ١٤٤٧=١٤٤٧، وسيط ٠=٠).
--   my_broker_lead_client_ids() = نفس شروط can_see_broker_lead.
--
-- النطاق: USING في سياسات القراءة (r) والشاملة (*) في public وحدها.
--   سياسات الكتابة تمسّ صفاً واحداً فتبقى can_see_client لها. ولا
--   يُمسّ storage. can_see_client نفسها تبقى للدوال التي تسأل عن عميل
--   واحد. آمن لإعادة التشغيل: بعد التحويل لا يبقى ما يُطابَق.
-- ============================================================

create or replace function public.my_visible_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
   where not (select public.is_broker())
     and c.deleted_at is null
     and ((select public.is_admin())
       or c.created_by = (select auth.uid())
       -- أنا ومن أُشرف عليهم — بالمفتاح
       or c.owner_id in (select s.id from public.my_scope_employees() s)
       -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
       or (c.sales_employee is not null
           and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
       -- كانت لي بطاقةٌ طُويت فيها (169)
       or c.id in (select w.client_id from public.client_watchers w
                    where w.employee_id in (select s.id from public.my_scope_employees() s)));
$$;
comment on function public.my_visible_client_ids() is
  'العملاء الذين يراهم المستخدم الحالي — نفس can_see_client لكن مجموعةً تُحسب مرّة للاستعلام (211).';
revoke all on function public.my_visible_client_ids() from public, anon;
grant execute on function public.my_visible_client_ids() to authenticated;

create or replace function public.my_broker_lead_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
   where c.broker_company_id is not null
     and (c.broker_company_id = (select public.my_broker_company())
       or c.broker_company_id in (select m.company_id from public.my_rm_companies() m));
$$;
comment on function public.my_broker_lead_client_ids() is
  'ليدات الوسطاء التي يراها المستخدم الحالي — نفس can_see_broker_lead مجموعةً (211).';
revoke all on function public.my_broker_lead_client_ids() from public, anon;
grant execute on function public.my_broker_lead_client_ids() to authenticated;

do $p$
declare r record; q text; q2 text; n int := 0;
begin
  for r in
    select c.relname as tbl, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) as qual
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public'
       and pol.polcmd in ('r', '*')
       and pg_get_expr(pol.polqual, pol.polrelid) ~ '\mcan_see_(client|broker_lead)\('
  loop
    q := replace(r.qual, E'\r', '');
    -- الشكل المغلَّف: ( SELECT can_see_client(x) AS can_see_client)
    q2 := regexp_replace(q, '\( SELECT can_see_client\(([A-Za-z_.]+)\) AS can_see_client\)',
                         '(\1 IN ( SELECT public.my_visible_client_ids()))', 'g');
    q2 := regexp_replace(q2, '\( SELECT can_see_broker_lead\(([A-Za-z_.]+)\) AS can_see_broker_lead\)',
                         '(\1 IN ( SELECT public.my_broker_lead_client_ids()))', 'g');
    -- الشكل المباشر: can_see_client(x)
    q2 := regexp_replace(q2, '\mcan_see_client\(([A-Za-z_.]+)\)',
                         '(\1 IN ( SELECT public.my_visible_client_ids()))', 'g');
    q2 := regexp_replace(q2, '\mcan_see_broker_lead\(([A-Za-z_.]+)\)',
                         '(\1 IN ( SELECT public.my_broker_lead_client_ids()))', 'g');
    if q2 ~ '\mcan_see_(client|broker_lead)\(' then
      raise exception '211: بقي نداءٌ لكل صف في %.% بعد التحويل: %', r.tbl, r.polname, q2;
    end if;
    execute format('alter policy %I on public.%I using (%s)', r.polname, r.tbl, q2);
    n := n + 1;
  end loop;
  raise notice '211: حُوّلت % سياسة قراءة', n;
end $p$;
