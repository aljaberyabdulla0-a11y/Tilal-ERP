-- ============================================================
-- تلال ERP — 085: الإجراءات الجماعية (§47)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المبدأ =====
--
--     الجماعي لا يعني بلا أثر فردي.
--
-- كل صفّ يمرّ بنفس الحارس والمحفّز الذي يمرّ به لو عُولج وحده،
-- ويُكتب له سجلّه. فمئة إسناد = مئة صفّ في تاريخ الملكية، لا صفّ
-- واحد يقول «إجراء جماعي» ثم لا يُعرف بعد شهر من نُقل ولا لماذا.
--
-- وما يُرفض يُعدّ ويُسمّى سببه ولا يُسقط الدفعة: رفض ثلاثة من مئة
-- لا يمنع السبعة والتسعين. والدوال تُرجِع العددين معاً — «نجح ٩٧،
-- رُفض ٣» أصدق من «تمّ».
--
-- ⚠️ الحدّ ٥٠٠ صفّاً: ليس حدّاً تقنياً بل حدُّ مراجعة. من يختار ألفاً
--    لم يقرأ ما اختار.
--
-- يتطلب: 071 (assign_client) و 070 (crm_stages) و 031 (tasks).
-- ============================================================

-- ------------------------------------------------------------
-- 1) إسناد جماعي بالاختيار
--    غير redistribute_leads (073): تلك تأخذ «من موظف» و«كم»، وهذه
--    تأخذ صفوفاً اختارها المستخدم بيده من الجدول.
-- ------------------------------------------------------------
create or replace function public.bulk_assign_clients(
  p_client_ids uuid[],
  p_owner_id   uuid,
  p_reason     text default null
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid   uuid;
  n_ok  int := 0;
  n_bad int := 0;
  err   text;
begin
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;

  foreach cid in array p_client_ids loop
    begin
      -- يمرّ بالحارس نفسه: من لا يملك النقل يُرفض صفّاً صفّاً
      perform public.assign_client(cid, p_owner_id,
                                   coalesce(p_reason, 'إسناد جماعي'), 'إعادة توزيع');
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

comment on function public.bulk_assign_clients(uuid[], uuid, text) is
  'إسناد صفوف مختارة. كل صفّ يمرّ بـ assign_client فيُحرَس ويُسجَّل. الفشل يُعدّ ولا يُسقط الدفعة.';

-- ------------------------------------------------------------
-- 2) تغيير مرحلة جماعي
--
-- ⚠️ يُرفض النقل إلى مرحلة ذات حقول مطلوبة — وأهمّها «فشل البيع».
--    إغلاق مئة صفقة بسبب واحد يُفسد تحليل «لماذا نخسر»، وهو أنفع ما
--    في التقارير. الخسارة تُغلق واحدةً واحدة بسببها.
-- ------------------------------------------------------------
create or replace function public.bulk_set_stage(
  p_client_ids uuid[],
  p_stage      text
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid   uuid;
  g     public.crm_stages%rowtype;
  n_ok  int := 0;
  n_bad int := 0;
  err   text;
begin
  select * into g from public.crm_stages where name = p_stage;
  if g.id is null then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;
  if not g.is_active then
    raise exception 'المرحلة «%» موقوفة.', p_stage;
  end if;
  if array_length(g.required_fields, 1) is not null then
    raise exception
      'المرحلة «%» تتطلّب حقولاً لكل صفقة — تُنقل واحدةً واحدة لا جملةً.', p_stage;
  end if;
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;

  foreach cid in array p_client_ids loop
    begin
      -- تحديث عادي: تسري RLS والمحفّزات والمرآة كما في الصفّ الواحد
      update public.clients set stage = p_stage
       where id = cid and stage is distinct from p_stage;
      if found then n_ok := n_ok + 1; else n_bad := n_bad + 1; end if;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

comment on function public.bulk_set_stage(uuid[], text) is
  'نقل مرحلة لصفوف مختارة. المراحل ذات الحقول المطلوبة مستثناة عمداً — الخسارة تُغلق بسببها.';

-- ------------------------------------------------------------
-- 3) إنشاء مهمّة لكل صفّ مختار
--    «اتصل بهم كلهم غداً» فعلٌ يومي، وبناؤه يدوياً مئة مرة لا يُفعل.
-- ------------------------------------------------------------
create or replace function public.bulk_create_tasks(
  p_client_ids uuid[],
  p_title      text,
  p_due_date   date default null,
  p_priority   text default 'متوسطة'
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid     uuid;
  n_ok    int := 0;
  n_bad   int := 0;
  err     text;
  owner_u uuid;
  actor   text;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'عنوان المهمّة مطلوب.';
  end if;
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;

  actor := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');

  foreach cid in array p_client_ids loop
    begin
      -- المهمّة تذهب إلى **مالك العميل** لا إلى من أنشأها: من يعمل
      -- على الليد هو من يتابعه.
      select e.user_id into owner_u
        from public.clients c
        join public.employees e on e.id = c.owner_id
       where c.id = cid;

      insert into public.tasks
        (title, description, assigned_to, due_date, priority, status,
         client_id, related_client, created_by, created_by_name)
      values
        (p_title, 'أُنشئت ضمن إجراء جماعي على ' || array_length(p_client_ids, 1) || ' صفّاً.',
         owner_u, p_due_date, p_priority, 'جديدة',
         cid, cid, auth.uid(), actor);
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

comment on function public.bulk_create_tasks(uuid[], text, date, text) is
  'مهمّة لكل صفّ مختار، تُسنَد إلى مالك العميل لا إلى منشئها.';

-- ------------------------------------------------------------
-- 4) الصلاحيات — من يملك الفعل مفرداً يملكه جماعةً، لا أكثر
--
-- لا فحص دور هنا عمداً: assign_client تفحص بنفسها، وتغيير المرحلة
-- تحكمه RLS على clients، وإنشاء المهمّة تحكمه سياسات tasks. إضافة
-- فحصٍ ثانٍ هنا تعني موضعين للحقيقة الواحدة.
-- ------------------------------------------------------------
revoke all on function public.bulk_assign_clients(uuid[], uuid, text) from public;
revoke all on function public.bulk_set_stage(uuid[], text)            from public;
revoke all on function public.bulk_create_tasks(uuid[], text, date, text) from public;

grant execute on function public.bulk_assign_clients(uuid[], uuid, text) to authenticated, service_role;
grant execute on function public.bulk_set_stage(uuid[], text)            to authenticated, service_role;
grant execute on function public.bulk_create_tasks(uuid[], text, date, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5) التحقّق
-- ------------------------------------------------------------
do $$
declare n_bulk int;
begin
  select count(*) into n_bulk from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'bulk\_%';
  raise notice '--- 085 الإجراءات الجماعية ---';
  raise notice 'دوال جماعية: % (المتوقَّع ٣)', n_bulk;
  raise notice 'الحدّ ٥٠٠ صفّاً للدفعة. «فشل البيع» مستثنى — يُغلق بسببه واحداً واحداً.';
end $$;

notify pgrst, 'reload schema';
