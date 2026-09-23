-- ============================================================
-- تلال ERP — 094: المشرف لا يرى تواصل فريقه مع العملاء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما حدث =====
--
-- موظفة المبيعات تسجّل مكالمة على عميلها فتظهر في «سجلّ التواصل»
-- عندها. المشرفة تفتح العميل نفسه فترى البطاقة كاملة، والسجلّ:
--
--     لا يوجد تواصل مسجّل بعد.        مرات التواصل: 0
--
-- ===== السبب =====
--
-- رؤية العميل ورؤية ما تحته تمرّان ببوّابتين مختلفتين:
--
--     clients               ← سياسة "read own clients": أنا + فريقي
--                             (my_scope_employees / my_scope_name_keys)
--     التواصل، الفرص، الاهتمامات، المستندات، الوسوم، الحجوزات…
--                           ← can_see_client(): أنا فقط
--
-- و036 كانت قد وسّعت can_see_client لنطاق الفريق. ثم أعادت 071
-- كتابتها لتضيف owner_id، لكنها بنت على نسخة 032 القديمة لا على 036،
-- فسقط نطاق الفريق ومعه name_key. ونسختها 077 كما هي.
--
-- فصار المشرف يرى العميل ولا يرى شيئاً مما سُجّل عليه: لا تواصل،
-- ولا صفقات، ولا اهتمامات، ولا مستندات — وهي بالضبط المتابعة التي
-- عمله أن يراها.
--
-- ===== الإصلاح =====
--
-- can_see_client تطابق شروط النطاق في "read own clients" حرفياً:
--
--     created_by أنا
--     owner_id ضمن my_scope_employees()        ← أنا ومن أُشرف عليهم
--     name_key(sales_employee) ضمن my_scope_name_keys()
--
-- وهي مجموعة أوسع من الحالية: my_employee_id() ضمن my_scope_employees()،
-- والتطابق الحرفي للاسم يقتضي تطابق name_key. فلا أحد يفقد وصولاً.
--
-- ⚠️ ما لا يُضاف هنا عمداً:
--    - is_followup_manager / can_read_all_crm: قراءة شاملة تُذكر في
--      سياسات القراءة نفسها. can_see_client بوّابة كتابة أيضاً
--      (الحجوزات، الفرص، المستندات)، فإدخالهما هنا يمنحهما كتابة.
--    - الوسيط: له can_see_broker_lead، ولا يرى الفواتير والحجوزات.
--
-- يتطلب: 036، 071، 077. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
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
$$;

comment on function public.can_see_client(uuid) is
  'هل العميل ضمن نطاقي: أنا أو فريقي (المشرف). تطابق شروط النطاق في "read own clients" — '
  'أي تعديل هناك يُعكس هنا، وإلا رأى المستخدم العميل ولم يرَ تواصله (094).';

-- ------------------------------------------------------------
-- التحقّق — كم عميلاً يراه كل مشرف ولا يرى تواصله
-- يجب أن يكون صفراً للجميع بعد الإصلاح.
-- ------------------------------------------------------------
do $$
declare r record; n_gap int; n_total int := 0;
begin
  raise notice '--- 094 نطاق الفريق في can_see_client ---';

  for r in
    select p.id, e.full_name
      from public.profiles p
      join public.employees e on e.user_id = p.id
     where p.role = 'supervisor'
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.id, 'role', 'authenticated')::text, true);

    select count(*) into n_gap
      from public.clients c
     where c.deleted_at is null
       and (c.owner_id in (select s.id from public.my_scope_employees() s)
            or public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
       and not public.can_see_client(c.id);

    n_total := n_total + n_gap;
    if n_gap > 0 then
      raise warning '  % — % عميلاً في فريقه بلا رؤية لتواصلهم', r.full_name, n_gap;
    end if;
  end loop;

  perform set_config('request.jwt.claims', null, true);

  if n_total = 0 then
    raise notice 'كل مشرف يرى تواصل كل عملاء فريقه.';
  end if;
end $$;

notify pgrst, 'reload schema';
