-- ============================================================
-- تلال ERP — الرجوع عن محرّك العمل V2 (189–194) — للطوارئ فقط
--
-- ⚠️ لا يُشغَّل إلا إذا تقرّر الرجوع. ليس هجرة مرقّمة عمداً.
--
-- ما يفعله: يعيد السلوك القديم كما كان حرفياً (031/040/085/096/140/175)
-- ويُسقط المحفّزات والجدولة الجديدة. ولا يحذف بيانات: الجداول
-- والأعمدة الجديدة تبقى (لا تضرّ، ولا يقرؤها الكود القديم)، وكذلك
-- التعليقات والمرفقات والسجلّ — فإن عاد V2 لاحقاً عادت معها.
--
-- بعده: أعد نشر الواجهة السابقة (git revert لالتزام V2).
-- ============================================================

-- 1) المحفّزات والجدولة الجديدة
drop trigger if exists trg_task_guard_client   on public.tasks;
drop trigger if exists trg_task_guard_mark     on public.tasks;
drop trigger if exists trg_task_activity       on public.tasks;
drop trigger if exists trg_task_notify_events  on public.tasks;
drop trigger if exists trg_task_workflow       on public.tasks;
drop trigger if exists trg_task_hook_employee  on public.employees;
drop trigger if exists trg_task_hook_campaign  on public.crm_campaigns;
drop trigger if exists trg_task_hook_content   on public.mkt_content;

select cron.unschedule('tasks-recurring')  where exists (select 1 from cron.job where jobname = 'tasks-recurring');
select cron.unschedule('tasks-event-scan') where exists (select 1 from cron.job where jobname = 'tasks-event-scan');

-- 2) سياسات tasks كما في 040
drop policy if exists "read my tasks" on public.tasks;
create policy "read my tasks" on public.tasks
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or (select public.is_followup_manager())
      or assigned_to = (select auth.uid())
      or assigned_to in (select u.user_id from public.my_scope_users() u)
    )
  );

drop policy if exists "update my tasks" on public.tasks;
create policy "update my tasks" on public.tasks
  for update to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  )
  with check (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

drop policy if exists "delete my tasks" on public.tasks;
create policy "delete my tasks" on public.tasks
  for delete to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()));

-- 3) الدوال بنصوصها القديمة
create or replace function public.stamp_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.created_by is not null then
    new.created_by_name := public.display_name(new.created_by);
    new.created_by_role := case
      when exists (select 1 from public.profiles p where p.id = new.created_by and p.role = 'admin')
      then 'مدير' else 'موظف' end;
  elsif tg_op = 'UPDATE' then
    new.created_by_name := old.created_by_name;
    new.created_by_role := old.created_by_role;
  end if;
  new.assigned_to_name := public.display_name(new.assigned_to);
  if new.title is null or length(trim(new.title)) = 0 then
    raise exception 'اكتب عنوان المهمة.';
  end if;
  if new.status = 'منجزة' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  -- V2: أعمدة الإغلاق تبقى متّسقة مع قيودها
  if new.status <> 'منجزة' then new.completed_by := null; end if;
  if new.status <> 'ملغاة' then
    new.cancelled_at := null; new.cancelled_by := null; new.cancellation_reason := null;
  end if;
  if new.status in ('جديدة', 'قيد التنفيذ') then new.archived_at := null; end if;
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not distinct from new.created_by then
    return new;
  end if;
  if current_setting('tilal.quiet_task_notify', true) = 'on' then
    return new;
  end if;
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (new.assigned_to, 'مهمة جديدة من ' || coalesce(new.created_by_name, 'الإدارة'),
          new.title || ' — موعدها ' || to_char(new.due_date, 'YYYY-MM-DD'), '/dashboard/tasks', 'مهمة', new.id);
  return new;
end; $$;

create or replace function public.notify_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.created_by is null or new.created_by is not distinct from new.assigned_to then return new; end if;
  if new.status not in ('منجزة', 'ملغاة') then return new; end if;
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (new.created_by, case new.status when 'منجزة' then 'تم إنجاز مهمة ✅' else 'أُلغيت مهمة' end,
          coalesce(new.assigned_to_name, 'موظف') || ': ' || new.title, '/dashboard/tasks', 'مهمة', new.id);
  return new;
end; $$;

create or replace function public.tasks_daily_reminder()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := public.baghdad_today();
  sent int := 0;
  rec record;
  parts text;
begin
  for rec in
    select t.assigned_to as uid,
           count(*) filter (where t.due_date = today) as today_count,
           count(*) filter (where t.due_date < today) as late_count,
           count(*) filter (where t.follow_up_date = today) as followup_count
      from public.tasks t
     where t.status in ('جديدة', 'قيد التنفيذ')
       and (t.due_date <= today or t.follow_up_date = today)
     group by t.assigned_to
  loop
    if exists (select 1 from public.notifications n
                where n.user_id = rec.uid and n.kind = 'مهمة' and n.title like 'مهام اليوم%'
                  and (n.created_at at time zone 'Asia/Baghdad')::date = today) then
      continue;
    end if;
    parts := '';
    if rec.today_count > 0 then parts := parts || rec.today_count || ' مهمة اليوم'; end if;
    if rec.late_count > 0 then parts := parts || case when parts = '' then '' else ' · ' end || rec.late_count || ' متأخرة'; end if;
    if rec.followup_count > 0 then parts := parts || case when parts = '' then '' else ' · ' end || rec.followup_count || ' متابعة اليوم'; end if;
    insert into public.notifications (user_id, title, body, link, kind)
    values (rec.uid, 'مهام اليوم 📋', parts, '/dashboard/tasks', 'مهمة');
    sent := sent + 1;
  end loop;
  return jsonb_build_object('sent', sent, 'date', today);
end; $$;

create or replace function public.crm_fact_sync_task(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare k record; d record; emp uuid; t timestamptz; cid uuid;
begin
  select * into k from public.tasks where id = p_id;
  if not found or k.status is distinct from 'منجزة' then
    delete from public.crm_event_facts where source_table = 'tasks' and source_id = p_id and event_type = 'task_completed';
    return;
  end if;
  cid := coalesce(k.client_id, k.related_client);
  t := coalesce(k.completed_at, k.updated_at, now());
  emp := public.crm_emp_of_user(k.assigned_to);
  if cid is not null then
    select * into d from public.crm_event_dims(cid, k.opportunity_id, t);
  end if;
  insert into public.crm_event_facts
    (source_table, source_id, event_type, event_at, event_date, client_id, opportunity_id,
     project_id, employee_id, owner_id, team_id, source_id_dim, campaign_id, lead_created_date, is_backfilled)
  values
    ('tasks', k.id, 'task_completed', t, public.crm_bgd_date(t), cid, k.opportunity_id,
     d.project_id, coalesce(emp, d.owner_id), d.owner_id,
     (select e.project_id from public.employees e where e.id = coalesce(emp, d.owner_id)),
     d.source_id, d.campaign_id, d.lead_created_date, p_backfill)
  on conflict (source_table, source_id, event_type) do update
    set event_at = excluded.event_at, event_date = excluded.event_date, updated_at = now();
end $$;

-- الجماعي وإعادة التواصل: النسخة الجديدة تكتب أعمدة V2 الموجودة فتبقى
-- صالحة بعد الرجوع، ولا داعي لإعادة نصّهما.

notify pgrst, 'reload schema';
