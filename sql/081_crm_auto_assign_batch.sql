-- ============================================================
-- تلال ERP — 081: توزيع دفعة الليدات بلا مالك في نداء واحد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- auto_assign_client() في 073 تُسنِد ليداً واحداً. ولوحة التوزيع
-- تحتاج إسناد ما بلا مالك جملةً — فكانت الواجهة ستنادي الدالة مرة
-- لكل ليد: مئتا رحلة شبكة من المتصفح، عشرات الثواني، وأي انقطاع
-- في المنتصف يترك النصف مُسنَداً والنصف لا، بلا خبر بما تمّ.
--
-- ===== ما يضيفه =====
--
-- حلقة واحدة في القاعدة تُرجِع تقريراً: كم أُسنِد، وكم بقي بلا
-- قاعدة منطبقة. والرقم الثاني مقصود: ليدٌ لا قاعدة له يبقى بلا
-- مالك ويظهر في اللوحة — أهون من إسناده عشوائياً لأول اسم.
--
-- ⚠️ لا تلمس ليداً له مالك. الإسناد التلقائي للوارد الجديد، وسحبُ
--    ليد من صاحبه فعلٌ آخر اسمه إعادة التوزيع وله دالته وحارسها
--    (redistribute_leads في 073).
--
-- وكل إسناد يمرّ بـ assign_client() كما في الإفرادي: فحص صلاحية،
-- وصفّ في client_assignments بسببه. الدفعة لا تعني أثراً جماعياً.
--
-- يتطلب: sql/071 و sql/073. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.auto_assign_ownerless(p_limit int default 200)
returns table (assigned int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  c        record;
  picked   uuid;
  n_ok     int := 0;
  n_skip   int := 0;
begin
  -- نفس صلاحية إعادة التوزيع: من يوزّع يوزّع بالحالتين
  if not (auth.uid() is null or public.is_admin() or public.is_followup_manager()) then
    raise exception 'التوزيع من صلاحية الإدارة ومدير المتابعة.';
  end if;

  for c in
    select cl.id
      from public.clients cl
     where cl.owner_id is null
       and cl.deleted_at is null
       and public.is_open_stage(cl.stage)     -- المغلق لا يُوزَّع: لا عمل عليه
     order by cl.created_at
     limit greatest(p_limit, 0)
  loop
    picked := public.auto_assign_client(c.id);
    if picked is null then
      n_skip := n_skip + 1;   -- لا قاعدة منطبقة — يبقى ظاهراً في اللوحة
    else
      n_ok := n_ok + 1;
    end if;
  end loop;

  return query select n_ok, n_skip;
end $$;

comment on function public.auto_assign_ownerless(int) is
  'يوزّع ما بلا مالك حسب قواعد 073 في نداء واحد. لا يمسّ ليداً له مالك — ذاك اسمه إعادة توزيع.';

revoke all on function public.auto_assign_ownerless(int) from public;
grant execute on function public.auto_assign_ownerless(int) to authenticated, service_role;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
declare n_ownerless int; n_rules int;
begin
  select count(*) into n_ownerless from public.clients
   where owner_id is null and deleted_at is null and public.is_open_stage(stage);
  select count(*) into n_rules from public.crm_assignment_rules where is_active;

  raise notice '--- 081 توزيع الدفعة ---';
  raise notice 'ليدات مفتوحة بلا مالك: %   قواعد فعّالة: %', n_ownerless, n_rules;

  if n_ownerless > 0 and n_rules = 0 then
    raise warning 'لا قاعدة فعّالة — الزرّ في لوحة التوزيع لن يُسنِد شيئاً.';
    raise warning 'أضِف قاعدة بلا شروط في آخر الأولويات كشبكة أمان.';
  end if;
end $$;

notify pgrst, 'reload schema';
