-- ============================================================
-- تلال ERP — 212: مدير التسويق يرى كل ليدات الـCRM ويعدّل عليها
--
-- الطلب (٢٠٢٦-١٠-١٤): مدير التسويق يرى جميع الليدات داخل الـCRM،
--   وكذلك التعديل عليها.
--
-- من هو: is_marketing_manager() (121) — المدير، أو من منصبه في فريق
--   التسويق «مدير التسويق» (mkt_team). دوره في profiles يبقى employee،
--   فلا يلزم دورٌ جديد ويتبع المنصبَ: يُعيَّن فيأخذها ويُعفى فتسقط.
--
-- ما يأخذه — مثل مالك البطاقة على كل البطاقات:
--   • الرؤية: my_visible_client_ids() (سياسات القراءة، 211) و«read own
--     clients» على clients.
--   • الكتابة: can_see_client() — وعليها تقوم كتابة الفرص والتواصل
--     والوثائق والوسوم والاهتمامات —، و«update own clients» على clients،
--     و crm_can_move_client() لنقل المرحلة.
--
-- ما لا يأخذه:
--   • نقل الملكية/الإسناد: assign_client و guard_client_owner بلا تغيير.
--     تغيير «موظف المبيعات» من نموذج التعديل يمرّ بـ sync_client_owner
--     فيصل guard_client_owner فيُرفض برسالته.
--   • الحذف: للإدارة كما هو.
--
-- ⚠️ can_see_client و my_visible_client_ids متطابقتان حرفياً (211) —
--    يُضاف الشرط إلى الاثنتين معاً.
-- آمن لإعادة التشغيل: الدوال create or replace، والسياسات تُعدَّل مرّة.
-- ============================================================

-- (١) الرؤية مجموعةً (سياسات القراءة)
create or replace function public.my_visible_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
   where not (select public.is_broker())
     and c.deleted_at is null
     and ((select public.is_admin())
       -- مدير التسويق: كل الليدات (212)
       or (select public.is_marketing_manager())
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

-- (٢) الرؤية لعميل واحد (سياسات الكتابة والدوال)
create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_broker()
     and exists (
    select 1 from public.clients c
     where c.id = cid
       and c.deleted_at is null
       and (
         public.is_admin()
         -- مدير التسويق: كل الليدات (212)
         or public.is_marketing_manager()
         or c.created_by = auth.uid()
         -- أنا ومن أُشرف عليهم — بالمفتاح
         or (c.owner_id is not null
             and c.owner_id in (select s.id from public.my_scope_employees() s))
         -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
         -- كانت لي بطاقةٌ طُويت فيها (169)
         or exists (select 1 from public.client_watchers w
                     where w.client_id = c.id
                       and w.employee_id in (select s.id from public.my_scope_employees() s))
       )
  );
$$;

-- (٣) نقل المرحلة (crm_move_client_stage)
create or replace function public.crm_can_move_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id and c.deleted_at is null
       and (public.is_admin()
            -- مدير التسويق: كل الليدات (212)
            or (not public.is_broker() and public.is_marketing_manager())
            or c.created_by = auth.uid()
            or (c.owner_id is not null and c.owner_id in (select s.id from public.my_scope_employees() s))
            or (c.sales_employee is not null
                and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
            or (c.broker_company_id is not null and c.broker_company_id = public.my_broker_company())
            or (c.broker_company_id is not null
                and c.broker_company_id in (select m.company_id from public.my_rm_companies() m)))
  );
$$;

-- (٤) سياستا جدول clients — شرطهما مكتوب فيهما لا عبر can_see_client
do $p$
declare q text; c text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into q
    from pg_policy pol
   where pol.polrelid = 'public.clients'::regclass and pol.polname = 'read own clients';
  if q is null then raise exception '212: سياسة «read own clients» غير موجودة'; end if;
  if q !~ 'is_marketing_manager' then
    execute format(
      'alter policy "read own clients" on public.clients using (((deleted_at is null) and ( select public.is_marketing_manager())) or (%s))',
      replace(q, E'\r', ''));
  end if;

  select pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid) into q, c
    from pg_policy pol
   where pol.polrelid = 'public.clients'::regclass and pol.polname = 'update own clients';
  if q is null then raise exception '212: سياسة «update own clients» غير موجودة'; end if;
  if q !~ 'is_marketing_manager' then
    execute format(
      'alter policy "update own clients" on public.clients using ((( select public.is_marketing_manager()) and (not ( select public.is_broker()))) or (%s)) with check ((( select public.is_marketing_manager()) and (not ( select public.is_broker()))) or (%s))',
      replace(q, E'\r', ''), replace(coalesce(c, q), E'\r', ''));
  end if;
end $p$;
