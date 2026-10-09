-- ============================================================
-- تلال ERP — 199: سياسات قراءة الجداول المساعدة للمهام — مرة للاستعلام لا لكل صفّ
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== القياس على الحيّ (هوية موظف) =====
--   select count(*) from task_activity_log  → 2023 مللي ث لـ 156 صفاً
--   السبب: سياسة القراءة using (can_see_task(task_id)) تُستدعى لكل صفّ،
--   وكل استدعاء يعيد حساب النطاق والفريق والأقسام (~4 مللي ث).
--   أثره: عدّادات التعليقات والمرفقات وقائمة التحقق في task_list تمرّ
--   بالسياسة نفسها لكل صفّ — كلما كثرت التعليقات بطؤت كل قائمة مهام.
--
-- ===== الإصلاح =====
--   task_my_visible_ids(): مجموعة «المهام التي أراها» بشرط سياسة
--   "read my tasks" حرفياً، والدوال داخل (select …) تُحسب مرة. السياسة:
--       task_id in (select … from task_my_visible_ids())
--   تصير subplan مُجزّأً (hashed) يُحسب مرة لكل استعلام.
--   نفس الصلاحيات تماماً (الشرط نفسه)، وقواعد الكتابة لا تتغيّر.
--
-- يتطلب: 190، 191. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.task_my_visible_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select t.id
    from public.tasks t
   where auth.uid() is not null
     and (   (select public.task_my_scope()) = 'all'
          or t.assigned_to = (select auth.uid())
          or t.created_by  = (select auth.uid())
          or t.approver_id = (select auth.uid())
          or t.assigned_to in (select x.user_id from public.task_team_user_ids() x)
          or t.department_id in (select d.id from public.task_my_department_ids() d)
          or t.id in (select w.task_id from public.task_my_watched_ids() w));
$$;
comment on function public.task_my_visible_ids() is
  'المهام التي يراها السائل (199) — بشرط سياسة "read my tasks" نفسه، محسوبة مرة. لسياسات الجداول المساعدة.';
revoke all on function public.task_my_visible_ids() from public, anon;
grant execute on function public.task_my_visible_ids() to authenticated;

drop policy if exists "read task comments" on public.task_comments;
create policy "read task comments" on public.task_comments
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task attachments" on public.task_attachments;
create policy "read task attachments" on public.task_attachments
  for select to authenticated
  using (deleted_at is null and task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task checklist" on public.task_checklist_items;
create policy "read task checklist" on public.task_checklist_items
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task activity" on public.task_activity_log;
create policy "read task activity" on public.task_activity_log
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task watchers" on public.task_watchers;
create policy "read task watchers" on public.task_watchers
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task dependencies" on public.task_dependencies;
create policy "read task dependencies" on public.task_dependencies
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

drop policy if exists "read task label links" on public.task_label_links;
create policy "read task label links" on public.task_label_links
  for select to authenticated
  using (task_id in (select v.id from public.task_my_visible_ids() v));

-- تحقّق: نفس الصفوف (القديم = can_see_task لكل صفّ) — حساب لكل دور، فالقديم بطيء
do $$
declare r record; n_old int; n_new int; n_bad int := 0;
begin
  for r in select distinct on (p.role) p.id from public.profiles p order by p.role, p.created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    select count(*) into n_old from public.task_activity_log a where public.can_see_task(a.task_id);
    select count(*) into n_new from public.task_activity_log a
     where a.task_id in (select v.id from public.task_my_visible_ids() v);
    if n_old <> n_new then
      n_bad := n_bad + 1;
      raise warning '199: المستخدم % — قديم % جديد %', r.id, n_old, n_new;
    end if;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  if n_bad > 0 then
    raise exception '199: % مستخدم تختلف رؤيته — أُلغي التطبيق.', n_bad;
  end if;
  raise notice '199: الرؤية مطابقة لكل المستخدمين ✓';
end $$;

notify pgrst, 'reload schema';
