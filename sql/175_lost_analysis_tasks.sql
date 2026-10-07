-- ============================================================
-- تلال ERP — 175: مهمة «استمارة فشل البيع» لكل خسارة بلا تحليل
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل الاختبارات (176):  select * from tests.run_lost_analysis_tasks();
--
-- ============================================================
-- المشكلة
--
-- ٥٢٦ خسارة قائمة بلا سبب: ٢١٩ من ترحيل 140 و٣٠٧ من تسوية 167. تظهر
-- «بلا تحليل» في «لماذا نخسر؟» ولا أحد يُطالَب بها — الزرّ «حلّل»
-- موجود في صفحة الفرصة لكن لا شيء يقود الموظف إليه.
--
-- ============================================================
-- الحلّ
--
--   1) tasks.analysis_lost_sale_id: المهمة تعرف خسارتها، فالواجهة تفتح
--      الاستمارة مباشرة منها.
--   2) لمن؟ crm_lost_analysis_assignee — بالترتيب:
--        مالك الفرصة إن كان على رأس عمله
--        ← من نقل البطاقة إلى «فشل البيع» (lost_by) — ٢٢٦ فرصة بلا مالك
--        ← مشرف فريق المالك يوم الخسارة (manager_id) — المالك ترك العمل
--      ولا أحد منهم: لا مهمة، والخسارة تبقى «بلا تحليل» في التقرير.
--   3) المهمة تُنجَز وحدها حين تُحفظ الاستمارة (الفئة تُملأ)، وتُلغى
--      حين تُنشَّط الفرصة أو تُحذف الخسارة.
--   4) الحارس: الموظف لا يعلّمها «منجزة» أو «ملغاة» بيده ولا يفكّ ربطها.
--      المشرف والمدير يملكان ذلك (crm_can_manage_lost).
--   5) أي خسارة تُكتب لاحقاً بلا تحليل (من أي باب) تنال مهمتها تلقائياً.
--   6) الترحيل: مهمة لكل خسارة قائمة، **بإشعار واحد لكل موظف** يجمعها —
--      لا مئتي إشعار. (notify_task_assigned يحترم tilal.quiet_task_notify.)
--
-- يتطلب: 140، 167. آمن لإعادة التشغيل: لا مهمة ثانية لخسارة لها مهمة مفتوحة.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الربط
-- ------------------------------------------------------------
alter table public.tasks
  add column if not exists analysis_lost_sale_id uuid
    references public.crm_lost_sales(id) on delete set null;

comment on column public.tasks.analysis_lost_sale_id is
  'مهمة «استمارة فشل البيع»: الخسارة التي تنتظر تحليلها. تُنجَز تلقائياً عند الحفظ (175).';

-- مهمة مفتوحة واحدة لكل خسارة
create unique index if not exists tasks_analysis_lost_sale_open_uq
  on public.tasks (analysis_lost_sale_id)
  where analysis_lost_sale_id is not null and status in ('جديدة', 'قيد التنفيذ');

-- ------------------------------------------------------------
-- 2) لمن المهمة
-- ------------------------------------------------------------
create or replace function public.crm_lost_analysis_assignee(p_lost uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.user_id from public.employees e
      where e.id = l.owner_id and e.status = 'active' and e.user_id is not null),
    (select e.user_id from public.employees e
      where e.user_id = l.lost_by and e.status = 'active'
      order by e.created_at limit 1),
    (select e.user_id from public.employees e
      where e.id = l.manager_id and e.status = 'active' and e.user_id is not null))
  from public.crm_lost_sales l
  where l.id = p_lost;
$$;

-- ------------------------------------------------------------
-- 3) إنشاء المهمة
-- ------------------------------------------------------------
create or replace function public.crm_create_lost_analysis_task(p_lost uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l     public.crm_lost_sales%rowtype;
  o     public.opportunities%rowtype;
  cname text;
  who   uuid;
  t_id  uuid;
begin
  select * into l from public.crm_lost_sales where id = p_lost;
  if l.id is null or l.outcome <> 'lost' or l.category_id is not null then
    return null;
  end if;

  select id into t_id from public.tasks
   where analysis_lost_sale_id = p_lost and status in ('جديدة', 'قيد التنفيذ');
  if t_id is not null then
    return t_id;
  end if;

  select * into o from public.opportunities where id = l.opportunity_id;
  if o.id is null or o.deleted_at is not null then
    return null;
  end if;

  who := public.crm_lost_analysis_assignee(p_lost);
  if who is null then
    return null;
  end if;

  select name into cname from public.clients where id = o.client_id;

  insert into public.tasks
    (title, description, assigned_to, due_date, priority, status,
     client_id, related_client, opportunity_id, next_step, created_by_name, analysis_lost_sale_id)
  values
    ('استمارة فشل البيع — ' || coalesce(nullif(btrim(cname), ''), o.title, 'عميل'),
     'خُسرت هذه الفرصة يوم ' || to_char(l.lost_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD')
       || coalesce(' في مرحلة «' || l.lost_stage_name || '»', '')
       || ' ولم يُسجَّل سبب خسارتها. افتح الاستمارة واملأها — تُنجَز المهمة وحدها عند الحفظ.',
     who, public.baghdad_today() + 7, 'متوسطة', 'جديدة',
     o.client_id, o.client_id, o.id,
     'املأ استمارة «تحليل سبب فقدان فرصة البيع»', 'النظام', p_lost)
  returning id into t_id;
  return t_id;
end $$;

-- ------------------------------------------------------------
-- 4) المزامنة مع الخسارة
--
-- tilal.lost_task_sync يفتح الحارس (5) لهذه التحديثات وحدها.
-- ------------------------------------------------------------
create or replace function public.sync_lost_analysis_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.outcome = 'lost' and new.category_id is null then
      perform public.crm_create_lost_analysis_task(new.id);
    end if;
    return null;
  end if;

  perform set_config('tilal.lost_task_sync', 'on', true);
  if tg_op = 'DELETE' then
    update public.tasks set status = 'ملغاة'
     where analysis_lost_sale_id = old.id and status in ('جديدة', 'قيد التنفيذ');
  elsif old.category_id is null and new.category_id is not null then
    update public.tasks set status = 'منجزة'
     where analysis_lost_sale_id = new.id and status in ('جديدة', 'قيد التنفيذ');
  elsif old.outcome = 'lost' and new.outcome <> 'lost' then
    update public.tasks set status = 'ملغاة'
     where analysis_lost_sale_id = new.id and status in ('جديدة', 'قيد التنفيذ');
  end if;
  perform set_config('tilal.lost_task_sync', '', true);

  return case when tg_op = 'DELETE' then old else null end;
end $$;

drop trigger if exists trg_sync_lost_analysis_task on public.crm_lost_sales;
create trigger trg_sync_lost_analysis_task
  after insert or update of category_id, outcome on public.crm_lost_sales
  for each row execute function public.sync_lost_analysis_task();

-- قبل الحذف: المفتاح on delete set null سيفكّ الربط بعده
drop trigger if exists trg_sync_lost_analysis_task_del on public.crm_lost_sales;
create trigger trg_sync_lost_analysis_task_del
  before delete on public.crm_lost_sales
  for each row execute function public.sync_lost_analysis_task();

-- ------------------------------------------------------------
-- 5) الحارس — الاستمارة هي الإنجاز
-- ------------------------------------------------------------
create or replace function public.guard_lost_analysis_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  l public.crm_lost_sales%rowtype;
begin
  if old.analysis_lost_sale_id is null then
    return new;
  end if;
  if current_setting('tilal.lost_task_sync', true) = 'on' then
    return new;
  end if;

  select * into l from public.crm_lost_sales where id = old.analysis_lost_sale_id;
  if l.id is null or l.outcome <> 'lost' or l.category_id is not null then
    return new;   -- لم يعد هناك ما يُحلَّل
  end if;
  if public.crm_can_manage_lost(l.owner_id) then
    return new;   -- المشرف والمدير
  end if;

  if new.analysis_lost_sale_id is distinct from old.analysis_lost_sale_id then
    raise exception 'هذه مهمة «استمارة فشل البيع» ولا يُفكّ ربطها بالفرصة.';
  end if;
  if new.status in ('منجزة', 'ملغاة') and old.status not in ('منجزة', 'ملغاة') then
    raise exception 'املأ استمارة فشل البيع أولاً — زرّ «املأ الاستمارة» في المهمة. تُنجَز المهمة وحدها عند الحفظ.';
  end if;
  return new;
end $$;

drop trigger if exists trg_z_guard_lost_analysis_task on public.tasks;
create trigger trg_z_guard_lost_analysis_task
  before update on public.tasks
  for each row execute function public.guard_lost_analysis_task();

-- ------------------------------------------------------------
-- 6) إشعار المهمة يحترم الترحيل الجماعي
--    (نفس نصّ الدالة الحيّة + سطر الإسكات)
-- ------------------------------------------------------------
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not distinct from new.created_by then
    return new;                      -- كتبها لنفسه: لا داعي لإشعار
  end if;
  if current_setting('tilal.quiet_task_notify', true) = 'on' then
    return new;                      -- إنشاء جماعي: إشعارٌ واحد يجمعها يُرسَل بعده
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (
    new.assigned_to,
    'مهمة جديدة من ' || coalesce(new.created_by_name, 'الإدارة'),
    new.title || ' — موعدها ' || to_char(new.due_date, 'YYYY-MM-DD'),
    '/dashboard/tasks',
    'مهمة',
    new.id
  );
  return new;
end; $$;

revoke all on function public.crm_lost_analysis_assignee(uuid)     from public, anon, authenticated;
revoke all on function public.crm_create_lost_analysis_task(uuid)  from public, anon, authenticated;
revoke all on function public.sync_lost_analysis_task()            from public, anon, authenticated;
revoke all on function public.guard_lost_analysis_task()           from public, anon, authenticated;
grant execute on function public.crm_lost_analysis_assignee(uuid)    to service_role;
grant execute on function public.crm_create_lost_analysis_task(uuid) to service_role;

-- ------------------------------------------------------------
-- 7) الترحيل — مهمة لكل خسارة قائمة بلا تحليل، وإشعار واحد لكل موظف
-- ------------------------------------------------------------
do $$
declare
  r record;
  n_made int := 0;
  n_none int := 0;
begin
  perform set_config('tilal.quiet_task_notify', 'on', true);

  for r in
    select l.id
      from public.crm_lost_sales l
      join public.opportunities o on o.id = l.opportunity_id and o.deleted_at is null
     where l.outcome = 'lost' and l.category_id is null
     order by l.lost_at
  loop
    if public.crm_create_lost_analysis_task(r.id) is null then
      n_none := n_none + 1;
    else
      n_made := n_made + 1;
    end if;
  end loop;

  perform set_config('tilal.quiet_task_notify', '', true);

  insert into public.notifications (user_id, title, body, link, kind)
  select t.assigned_to,
         'فرص خاسرة تنتظر استمارة فشل البيع',
         'أُضيفت إلى مهامك ' || count(*) || ' فرصة خُسرت دون تسجيل السبب. املأ استمارة كلٍّ منها من زرّ «املأ الاستمارة» في المهمة.',
         '/dashboard/tasks',
         'مهمة'
    from public.tasks t
   where t.analysis_lost_sale_id is not null and t.status = 'جديدة'
     and t.created_at >= now() - interval '1 minute'
   group by t.assigned_to;

  raise notice 'مهام 175: % مهمة أُنشئت، و% خسارة بلا مسؤول على رأس عمله', n_made, n_none;
end $$;

-- ------------------------------------------------------------
-- 8) التحقّق
-- ------------------------------------------------------------
do $$
declare
  n_open_losses int; n_tasks int; n_orphan int;
begin
  select count(*) into n_open_losses
    from public.crm_lost_sales l
    join public.opportunities o on o.id = l.opportunity_id and o.deleted_at is null
   where l.outcome = 'lost' and l.category_id is null;
  select count(*) into n_tasks from public.tasks
   where analysis_lost_sale_id is not null and status in ('جديدة', 'قيد التنفيذ');
  select count(*) into n_orphan
    from public.crm_lost_sales l
    join public.opportunities o on o.id = l.opportunity_id and o.deleted_at is null
   where l.outcome = 'lost' and l.category_id is null
     and public.crm_lost_analysis_assignee(l.id) is not null
     and not exists (select 1 from public.tasks t
                      where t.analysis_lost_sale_id = l.id and t.status in ('جديدة', 'قيد التنفيذ'));

  raise notice '--- 175 مهام استمارة فشل البيع ---';
  raise notice 'خسائر بلا تحليل: %  مهام مفتوحة: %  خسائر لها مسؤول بلا مهمة: %', n_open_losses, n_tasks, n_orphan;
  if n_orphan > 0 then
    raise warning 'خسائر لها مسؤول ولا مهمة لها: % — راجع الترحيل.', n_orphan;
  end if;
end $$;

notify pgrst, 'reload schema';
