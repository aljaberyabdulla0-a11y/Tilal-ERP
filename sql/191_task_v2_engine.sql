-- ============================================================
-- تلال ERP — 191: محرّك العمل V2 — المحرّك (المحفّزات والدوال)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 189، 190. ثم 192.
--
-- ===== ما يضيفه =====
--   1) stamp_task v2 — نفس المحفّز، ويضيف: الإصدار (تزامن)، من أنجز/ألغى
--      ومتى، اشتقاق القسم والكيان والمشروع، خطوة المسار ↔ الحالة،
--      بوّابتا التبعية والموافقة، الأرشفة.
--   2) سجلّ النشاط (من المحفّزات وحدها).
--   3) الإشعارات: إعادة الإسناد، المتابعون، الموافقة، اكتمال تبعية،
--      التعليق والإشارة. ونفس إشعاري 031 برابط المهمة نفسها.
--   4) منع الدوائر في التبعيات، وختم قائمة التحقق والمرفقات.
--   5) دوال الكتابة task_* (DEFINER بفحص صريح) ودوال القراءة (INVOKER:
--      RLS تحكم): task_list بترقيم من الخادم، task_detail، task_counts.
--   6) tasks_daily_reminder v2 — نفس الاسم والجدولة.
--   7) crm_fact_sync_task: مهامّ المبيعات وحدها تدخل وقائع CRM.
--   8) bulk_create_tasks وcrm_upsert_recontact_task بمصدرهما (crm).
--
-- لا يُمسّ: crm_create_lost_analysis_task، sync_lost_analysis_task،
-- guard_lost_analysis_task (175/177) — والمحفّز يصنّف مهمتها وحده.
-- ============================================================

-- ------------------------------------------------------------
-- 0) أدوات صغيرة
-- ------------------------------------------------------------
create or replace function public.task_priority_rank(p text)
returns int language sql immutable set search_path = public as $$
  select case p when 'عاجلة' then 0 when 'متوسطة' then 1 when 'عادية' then 2 else 9 end;
$$;

-- لحظة الاستحقاق: اليوم + الوقت (أو نهاية اليوم) بتوقيت بغداد
create or replace function public.task_due_at(p_date date, p_time time)
returns timestamptz language sql immutable set search_path = public as $$
  select case when p_date is null then null
              else ((p_date + coalesce(p_time, time '23:59')) at time zone 'Asia/Baghdad') end;
$$;

create or replace function public.task_is_open(p_status text)
returns boolean language sql immutable set search_path = public as $$
  select p_status in ('جديدة', 'قيد التنفيذ');
$$;

-- إشعار مهمة واحد: لا يُشعَر الفاعل بنفسه، ولا يتكرّر نفس الإشعار
-- لنفس الشخص خلال دقيقتين، ويحترم الإسكات الجماعي.
create or replace function public.task_notify(
  p_user uuid, p_title text, p_body text, p_task uuid, p_priority text default 'عادية'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then
    return;
  end if;
  if current_setting('tilal.quiet_task_notify', true) = 'on' then
    return;
  end if;
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.entity_id = p_task and n.title = p_title
                and n.created_at > now() - interval '2 minutes') then
    return;
  end if;
  insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
  values (p_user, p_title, left(coalesce(p_body, ''), 500), '/dashboard/tasks/' || p_task, 'مهمة', p_task,
          case when p_priority in ('حرجة', 'عالية', 'عادية', 'منخفضة') then p_priority else 'عادية' end,
          'مهام', 'task');
end $$;
revoke all on function public.task_notify(uuid, text, text, uuid, text) from public, anon, authenticated;

-- اسم الكيان المرتبط ورابطه (للبطاقة والتفاصيل)
create or replace function public.task_entity_label(p_type text, p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_type is null or p_id is null then return null; end if;
  case p_type
    when 'client'            then select c.name into v from public.clients c where c.id = p_id;
    when 'opportunity'       then select coalesce(o.title, c.name) into v from public.opportunities o
                                    left join public.clients c on c.id = o.client_id where o.id = p_id;
    when 'employee'          then select e.full_name into v from public.employees e where e.id = p_id;
    when 'project'           then select pr.name into v from public.projects pr where pr.id = p_id;
    when 'campaign'          then select cc.name into v from public.crm_campaigns cc where cc.id = p_id;
    when 'content'           then select mc.title into v from public.mkt_content mc where mc.id = p_id;
    when 'broker_company'    then select b.name into v from public.broker_companies b where b.id = p_id;
    when 'supplier'          then select s.name into v from public.suppliers s where s.id = p_id;
    when 'approval_request'  then select a.title into v from public.approval_requests a where a.id = p_id;
    else v := null;
  end case;
  return coalesce(v, (select et.name_ar from public.task_entity_types et where et.code = p_type));
end $$;
revoke all on function public.task_entity_label(text, uuid) from public, anon;
grant execute on function public.task_entity_label(text, uuid) to authenticated;

-- هل الكيان موجود ويحقّ لي ربطه؟ العميل والفرصة بنطاق CRM، والباقي بالوجود
create or replace function public.task_entity_linkable(p_type text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_table text; v_ok boolean;
begin
  if p_type is null and p_id is null then return true; end if;
  if p_type is null or p_id is null then return false; end if;
  select et.table_name into v_table from public.task_entity_types et where et.code = p_type;
  if v_table is null then return false; end if;
  if p_type = 'client' then
    return public.is_admin() or public.can_see_client(p_id);
  elsif p_type = 'opportunity' then
    return public.is_admin()
        or exists (select 1 from public.opportunities o where o.id = p_id and public.can_see_client(o.client_id));
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_ok using p_id;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.task_entity_linkable(text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1) stamp_task v2 — نفس المحفّز trg_task_stamp
-- ------------------------------------------------------------
create or replace function public.stamp_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_type    public.task_types%rowtype;
  v_step    public.task_workflow_steps%rowtype;
  v_opp     record;
  v_blocker text;
  v_status_changed boolean;
  v_step_changed   boolean;
begin
  -- ===== المنشئ لا يتغيّر، والإصدار يحرس التزامن =====
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
    new.version := 1;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.version is distinct from old.version then
      raise exception 'عُدّلت هذه المهمة بعد أن فتحتها — حدّث الصفحة ثم أعد المحاولة.' using hint = 'version_conflict';
    end if;
    new.version := old.version + 1;
  end if;

  -- الاسم يُحسب من القاعدة، ويبقى محفوظاً لو حُذف حساب صاحب الطلب لاحقاً
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
  new.title := btrim(new.title);

  -- ===== التصنيف =====
  -- مهمة الاستمارة (175) تُعرَف من ربطها — لا نلمس دالتها
  if new.analysis_lost_sale_id is not null and tg_op = 'INSERT' then
    new.task_type      := 'lost_analysis';
    new.task_source    := 'crm';
    new.created_source := coalesce(new.created_source, 'trigger');
  end if;
  if tg_op = 'INSERT' and new.created_source is null then
    new.created_source := case when v_uid is null then 'trigger' else 'form' end;
    if v_uid is null and new.task_source = 'manual' then
      new.task_source := 'system';
    end if;
  end if;

  select * into v_type from public.task_types where code = new.task_type;
  if tg_op = 'INSERT' then
    if new.estimated_minutes is null then
      new.estimated_minutes := v_type.default_minutes;
    end if;
    if new.deadline_at is null and v_type.sla_hours is not null then
      new.deadline_at := now() + make_interval(hours => v_type.sla_hours);
    end if;
    if v_type.requires_approval then
      new.requires_approval := true;
    end if;
  end if;

  -- ===== الكيان ↔ أعمدة الإرث =====
  if new.entity_type is null then
    if new.opportunity_id is not null then
      new.entity_type := 'opportunity'; new.entity_id := new.opportunity_id;
    elsif new.client_id is not null then
      new.entity_type := 'client'; new.entity_id := new.client_id;
    end if;
  elsif new.entity_type = 'client' and new.client_id is null then
    new.client_id := new.entity_id;
  elsif new.entity_type = 'opportunity' and new.opportunity_id is null then
    new.opportunity_id := new.entity_id;
  elsif new.entity_type = 'campaign' and new.campaign_id is null then
    new.campaign_id := new.entity_id;
  elsif new.entity_type = 'project' and new.project_id is null then
    new.project_id := new.entity_id;
  end if;

  if new.opportunity_id is not null and (new.client_id is null or new.project_id is null) then
    select o.client_id, o.project_id into v_opp from public.opportunities o where o.id = new.opportunity_id;
    new.client_id  := coalesce(new.client_id, v_opp.client_id);
    new.project_id := coalesce(new.project_id, v_opp.project_id);
  end if;

  -- القسم من قسم المسؤول إن لم يُحدَّد
  if tg_op = 'INSERT' and new.department_id is null then
    select e.department_id into new.department_id
      from public.employees e
     where e.user_id = new.assigned_to and e.department_id is not null
     order by (e.status = 'active') desc
     limit 1;
  end if;

  -- ===== خطوة المسار ↔ الحالة العامة =====
  v_status_changed := tg_op = 'INSERT' or new.status is distinct from old.status;
  v_step_changed   := tg_op = 'INSERT' or new.workflow_step_id is distinct from old.workflow_step_id;

  if new.workflow_step_id is not null then
    select * into v_step from public.task_workflow_steps where id = new.workflow_step_id;
    if new.workflow_id is null then
      new.workflow_id := v_step.workflow_id;
    elsif v_step.workflow_id is distinct from new.workflow_id then
      raise exception 'الخطوة المختارة ليست من مسار هذه المهمة.' using errcode = '22023';
    end if;
  end if;

  if new.workflow_id is not null then
    if v_step_changed and new.workflow_step_id is not null
       and (tg_op = 'INSERT' or not v_status_changed) then
      -- نُقلت الخطوة: الحالة تتبعها
      new.status := v_step.status_map;
    elsif v_status_changed and tg_op = 'UPDATE' and not v_step_changed then
      -- تغيّرت الحالة بزرّها: الخطوة تتبعها
      if new.status = 'منجزة' then
        select s.id into new.workflow_step_id from public.task_workflow_steps s
         where s.workflow_id = new.workflow_id and s.status_map = 'منجزة' order by s.position limit 1;
      elsif public.task_is_open(new.status) and not public.task_is_open(old.status) then
        select s.id into new.workflow_step_id from public.task_workflow_steps s
         where s.workflow_id = new.workflow_id and s.status_map = new.status order by s.position desc limit 1;
      elsif new.status = 'قيد التنفيذ' and old.status = 'جديدة' then
        select s.id into new.workflow_step_id from public.task_workflow_steps s
         where s.workflow_id = new.workflow_id and s.status_map = 'قيد التنفيذ' order by s.position limit 1;
      end if;
    elsif tg_op = 'INSERT' and new.workflow_step_id is null then
      select s.id into new.workflow_step_id from public.task_workflow_steps s
       where s.workflow_id = new.workflow_id order by s.position limit 1;
      if new.workflow_step_id is not null then
        select s.status_map into new.status from public.task_workflow_steps s where s.id = new.workflow_step_id;
      end if;
    end if;
  end if;

  -- ===== الإنجاز =====
  if new.status = 'منجزة' then
    if tg_op = 'INSERT' or old.status <> 'منجزة' then
      -- بوّابة التبعية: لا تُنجز قبل ما تعتمد عليه (الملغاة لا تمنع)
      if tg_op = 'UPDATE' then
        select string_agg('«' || p.title || '»', '، ') into v_blocker
          from public.task_dependencies d join public.tasks p on p.id = d.depends_on_id
         where d.task_id = new.id and d.is_blocking and p.status not in ('منجزة', 'ملغاة');
        if v_blocker is not null then
          raise exception 'لا تُنجز هذه المهمة قبل: %', v_blocker using errcode = '22023';
        end if;
      end if;
      -- بوّابة الموافقة
      if new.requires_approval and new.approval_status is distinct from 'معتمدة' then
        raise exception 'هذه المهمة تحتاج موافقة قبل إنجازها — اطلب الموافقة.' using errcode = '22023';
      end if;
      new.completed_by := v_uid;
    else
      new.completed_by := old.completed_by;
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  -- ===== الإلغاء =====
  if new.status = 'ملغاة' then
    if tg_op = 'INSERT' or old.status <> 'ملغاة' then
      new.cancelled_at := now();
      new.cancelled_by := v_uid;
    else
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    end if;
    new.cancellation_reason := nullif(btrim(new.cancellation_reason), '');
  else
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
  end if;

  -- بدء التنفيذ: أول مرة فقط
  if new.status = 'قيد التنفيذ' and new.started_at is null then
    new.started_at := now();
  end if;

  -- إعادة فتح مهمة معتمدة: تحتاج موافقة جديدة
  if tg_op = 'UPDATE' and old.status = 'منجزة' and public.task_is_open(new.status)
     and new.requires_approval and new.approval_status = 'معتمدة' then
    new.approval_status := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if not new.requires_approval then
    new.approval_status := null;
  end if;

  -- ===== الأرشفة: للمغلقة فقط، وإعادة الفتح تُخرجها =====
  if public.task_is_open(new.status) then
    new.archived_at := null;
  end if;
  if new.archived_at is null then
    new.archived_by := null;
  elsif tg_op = 'INSERT' or old.archived_at is null then
    new.archived_by := v_uid;
  else
    new.archived_by := old.archived_by;
  end if;

  new.blocked_reason := nullif(btrim(new.blocked_reason), '');
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------
-- 2) سجلّ النشاط
-- ------------------------------------------------------------
create or replace function public.task_log(
  p_task uuid, p_action text, p_field text default null, p_old text default null,
  p_new text default null, p_note text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.task_activity_log (task_id, action, field, old_value, new_value, note, actor, actor_name)
  values (p_task, p_action, p_field, left(p_old, 500), left(p_new, 500), left(p_note, 1000), auth.uid(),
          case when auth.uid() is null then 'النظام' else public.display_name(auth.uid()) end);
$$;
revoke all on function public.task_log(uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_name text; v_new_name text;
begin
  if tg_op = 'INSERT' then
    perform public.task_log(new.id, 'created', null, null, new.title);
    if new.assigned_to is distinct from new.created_by then
      perform public.task_log(new.id, 'assigned', 'assigned_to', null, new.assigned_to_name);
    end if;
    if new.parent_task_id is not null then
      perform public.task_log(new.parent_task_id, 'subtask_added', null, null, new.title);
    end if;
    return null;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.task_log(new.id, 'reassigned', 'assigned_to', old.assigned_to_name, new.assigned_to_name);
  end if;

  if new.status is distinct from old.status then
    perform public.task_log(new.id,
      case when new.status = 'منجزة' then 'completed'
           when new.status = 'ملغاة' then 'cancelled'
           when old.status in ('منجزة', 'ملغاة') then 'restored'
           when new.status = 'قيد التنفيذ' then 'started'
           else 'status_changed' end,
      'status', old.status, new.status,
      case when new.status = 'ملغاة' then new.cancellation_reason end);
  end if;

  if new.priority is distinct from old.priority then
    perform public.task_log(new.id, 'priority_changed', 'priority', old.priority, new.priority);
  end if;
  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    perform public.task_log(new.id, 'due_date_changed', 'due_date',
      concat_ws(' ', old.due_date::text, to_char(old.due_time, 'HH24:MI')),
      concat_ws(' ', new.due_date::text, to_char(new.due_time, 'HH24:MI')));
  end if;
  if new.department_id is distinct from old.department_id then
    select name_ar into v_old_name from public.departments where id = old.department_id;
    select name_ar into v_new_name from public.departments where id = new.department_id;
    perform public.task_log(new.id, 'department_changed', 'department_id', v_old_name, v_new_name);
  end if;
  if new.workflow_step_id is distinct from old.workflow_step_id then
    select name_ar into v_old_name from public.task_workflow_steps where id = old.workflow_step_id;
    select name_ar into v_new_name from public.task_workflow_steps where id = new.workflow_step_id;
    perform public.task_log(new.id, 'workflow_step_changed', 'workflow_step_id', v_old_name, v_new_name);
  end if;
  if new.approval_status is distinct from old.approval_status and new.approval_status is not null then
    perform public.task_log(new.id,
      case new.approval_status when 'بانتظار الموافقة' then 'approval_requested'
                               when 'معتمدة' then 'approved' else 'rejected' end,
      'approval_status', old.approval_status, new.approval_status,
      case when new.approval_status = 'مرفوضة' then new.rejection_reason end);
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform public.task_log(new.id, case when new.archived_at is null then 'unarchived' else 'archived' end);
  end if;

  -- التعديلات الأخرى: سطر لكل حقل
  if new.title is distinct from old.title then
    perform public.task_log(new.id, 'edited', 'title', old.title, new.title);
  end if;
  if new.description is distinct from old.description then
    perform public.task_log(new.id, 'edited', 'description', left(old.description, 200), left(new.description, 200));
  end if;
  if new.next_step is distinct from old.next_step then
    perform public.task_log(new.id, 'edited', 'next_step', old.next_step, new.next_step);
  end if;
  if new.follow_up_date is distinct from old.follow_up_date then
    perform public.task_log(new.id, 'edited', 'follow_up_date', old.follow_up_date::text, new.follow_up_date::text);
  end if;
  if new.task_type is distinct from old.task_type then
    perform public.task_log(new.id, 'edited', 'task_type', old.task_type, new.task_type);
  end if;
  if new.entity_id is distinct from old.entity_id then
    perform public.task_log(new.id, 'edited', 'entity',
      public.task_entity_label(old.entity_type, old.entity_id), public.task_entity_label(new.entity_type, new.entity_id));
  end if;
  if new.requires_approval is distinct from old.requires_approval then
    perform public.task_log(new.id, 'edited', 'requires_approval', old.requires_approval::text, new.requires_approval::text);
  end if;
  if new.blocked_reason is distinct from old.blocked_reason then
    perform public.task_log(new.id, 'edited', 'blocked_reason', old.blocked_reason, new.blocked_reason);
  end if;
  if new.estimated_minutes is distinct from old.estimated_minutes
     or new.actual_minutes is distinct from old.actual_minutes then
    perform public.task_log(new.id, 'edited', 'minutes',
      concat_ws('/', old.estimated_minutes, old.actual_minutes), concat_ws('/', new.estimated_minutes, new.actual_minutes));
  end if;
  return null;
end $$;

drop trigger if exists trg_task_activity on public.tasks;
create trigger trg_task_activity
  after insert or update on public.tasks
  for each row execute function public.log_task_activity();

-- ------------------------------------------------------------
-- 3) الإشعارات
-- ------------------------------------------------------------

-- 031/175 كما هي، والرابط إلى المهمة نفسها
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not distinct from new.created_by then
    return new;                      -- كتبها لنفسه: لا داعي لإشعار
  end if;
  if current_setting('tilal.quiet_task_notify', true) = 'on' then
    return new;                      -- إنشاء جماعي: إشعارٌ واحد يجمعها يُرسَل بعده
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
  values (
    new.assigned_to,
    'مهمة جديدة من ' || coalesce(new.created_by_name, 'الإدارة'),
    new.title || coalesce(' — موعدها ' || to_char(new.due_date, 'YYYY-MM-DD'), ''),
    '/dashboard/tasks/' || new.id,
    'مهمة',
    new.id,
    case when new.priority = 'عاجلة' then 'عالية' else 'عادية' end,
    'مهام',
    'task'
  );
  return new;
end; $$;

create or replace function public.notify_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.created_by is null
     or new.created_by is not distinct from new.assigned_to then
    return new;                      -- لا نُشعر الشخص بنفسه
  end if;
  if new.status not in ('منجزة', 'ملغاة') then
    return new;
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
  values (
    new.created_by,
    case new.status when 'منجزة' then 'تم إنجاز مهمة ✅' else 'أُلغيت مهمة' end,
    coalesce(new.assigned_to_name, 'موظف') || ': ' || new.title
      || coalesce(' — السبب: ' || new.cancellation_reason, ''),
    '/dashboard/tasks/' || new.id,
    'مهمة',
    new.id,
    'عادية',
    'مهام',
    'task'
  );
  return new;
end; $$;

-- الأحداث الجديدة
create or replace function public.notify_task_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w record;
  d record;
  v_actor text := case when auth.uid() is null then 'النظام' else public.display_name(auth.uid()) end;
begin
  if current_setting('tilal.quiet_task_notify', true) = 'on' then
    return null;
  end if;

  -- إعادة الإسناد: من الواجهة أو دوال task_* فقط. التسليم والدمج
  -- يرسلون ملخّصهم الخاص — لا إشعار لكل مهمة.
  if new.assigned_to is distinct from old.assigned_to
     and current_setting('tilal.task_user_action', true) = 'on' then
    perform public.task_notify(new.assigned_to, 'أُسندت إليك مهمة',
      new.title || coalesce(' — موعدها ' || to_char(new.due_date, 'YYYY-MM-DD'), '') || ' (من ' || v_actor || ')',
      new.id, case when new.priority = 'عاجلة' then 'عالية' else 'عادية' end);
  end if;

  -- الموافقة
  if new.approval_status is distinct from old.approval_status then
    if new.approval_status = 'بانتظار الموافقة' then
      perform public.task_notify(new.approver_id, 'مهمة بانتظار موافقتك',
        coalesce(new.assigned_to_name, '') || ': ' || new.title, new.id, 'عالية');
    elsif new.approval_status = 'معتمدة' then
      perform public.task_notify(new.assigned_to, 'اعتُمدت مهمتك ✅', new.title, new.id);
    elsif new.approval_status = 'مرفوضة' then
      perform public.task_notify(new.assigned_to, 'رُفضت مهمتك — راجعها',
        new.title || coalesce(' — ' || new.rejection_reason, ''), new.id, 'عالية');
    end if;
  end if;

  -- الإنجاز/الإلغاء: المتابِعون (المنشئ يُشعَر من notify_task_status)
  if new.status is distinct from old.status and new.status in ('منجزة', 'ملغاة') then
    for w in
      select tw.user_id from public.task_watchers tw
       where tw.task_id = new.id
         and tw.user_id is distinct from new.assigned_to
         and tw.user_id is distinct from new.created_by
    loop
      perform public.task_notify(w.user_id,
        case new.status when 'منجزة' then 'أُنجزت مهمة تتابعها' else 'أُلغيت مهمة تتابعها' end,
        coalesce(new.assigned_to_name, '') || ': ' || new.title, new.id);
    end loop;
  end if;

  -- اكتملت تبعية: المهمة التي صارت جاهزة
  if new.status is distinct from old.status and new.status in ('منجزة', 'ملغاة') then
    for d in
      select t.id, t.title, t.assigned_to
        from public.task_dependencies dep
        join public.tasks t on t.id = dep.task_id
       where dep.depends_on_id = new.id and dep.is_blocking
         and public.task_is_open(t.status)
         and not exists (
           select 1 from public.task_dependencies o join public.tasks x on x.id = o.depends_on_id
            where o.task_id = t.id and o.is_blocking and o.depends_on_id <> new.id
              and x.status not in ('منجزة', 'ملغاة'))
    loop
      perform public.task_notify(d.assigned_to, 'يمكنك البدء الآن',
        d.title || ' — اكتمل ما تعتمد عليه: ' || new.title, d.id);
    end loop;
  end if;

  return null;
end $$;

drop trigger if exists trg_task_notify_events on public.tasks;
create trigger trg_task_notify_events
  after update on public.tasks
  for each row execute function public.notify_task_events();

-- الحارس (190) يعلّم الكتابة المباشرة من المتصفح بأنها فعل مستخدم
create or replace function public.guard_task_mark_user_action()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    perform set_config('tilal.task_user_action', 'on', true);
  end if;
  return new;
end $$;
drop trigger if exists trg_task_guard_mark on public.tasks;
create trigger trg_task_guard_mark
  before update on public.tasks
  for each row execute function public.guard_task_mark_user_action();

-- ------------------------------------------------------------
-- 4) الجداول المساعدة: الدوائر، الختم، السجلّ
-- ------------------------------------------------------------
create or replace function public.guard_task_dependency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    with recursive chain as (
      select d.depends_on_id as id, 1 as depth from public.task_dependencies d where d.task_id = new.depends_on_id
      union
      select d.depends_on_id, c.depth + 1 from public.task_dependencies d join chain c on d.task_id = c.id
       where c.depth < 50
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception 'تبعية دائرية: المهمة المختارة تعتمد (مباشرة أو بواسطة) على هذه المهمة.' using errcode = '22023';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
drop trigger if exists trg_task_dependency_guard on public.task_dependencies;
create trigger trg_task_dependency_guard
  before insert on public.task_dependencies
  for each row execute function public.guard_task_dependency();

create or replace function public.log_task_dependency()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if tg_op = 'INSERT' then
    select title into v_title from public.tasks where id = new.depends_on_id;
    perform public.task_log(new.task_id, 'dependency_added', null, null, v_title);
  else
    select title into v_title from public.tasks where id = old.depends_on_id;
    perform public.task_log(old.task_id, 'dependency_removed', null, v_title, null);
  end if;
  return null;
end $$;
drop trigger if exists trg_task_dependency_log on public.task_dependencies;
create trigger trg_task_dependency_log
  after insert or delete on public.task_dependencies
  for each row execute function public.log_task_dependency();

create or replace function public.stamp_task_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.position is null or new.position = 0 then
      select coalesce(max(position), 0) + 1 into new.position
        from public.task_checklist_items where task_id = new.task_id;
    end if;
  else
    new.task_id := old.task_id;
    new.created_by := old.created_by;
  end if;
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif not new.is_done then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.body := btrim(new.body);
  return new;
end $$;
drop trigger if exists trg_task_checklist_stamp on public.task_checklist_items;
create trigger trg_task_checklist_stamp
  before insert or update on public.task_checklist_items
  for each row execute function public.stamp_task_checklist();

create or replace function public.log_task_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.task_log(new.task_id, 'checklist_changed', 'checklist', null, new.body, 'أُضيف بند');
  elsif tg_op = 'DELETE' then
    perform public.task_log(old.task_id, 'checklist_changed', 'checklist', old.body, null, 'حُذف بند');
  elsif new.is_done is distinct from old.is_done then
    perform public.task_log(new.task_id, 'checklist_changed', 'checklist', null, new.body,
                            case when new.is_done then 'أُنجز بند' else 'أُعيد فتح بند' end);
  end if;
  return null;
end $$;
drop trigger if exists trg_task_checklist_log on public.task_checklist_items;
create trigger trg_task_checklist_log
  after insert or update or delete on public.task_checklist_items
  for each row execute function public.log_task_checklist();

create or replace function public.stamp_task_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_by_name := public.display_name(new.uploaded_by);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists trg_task_attachment_stamp on public.task_attachments;
create trigger trg_task_attachment_stamp
  before insert on public.task_attachments
  for each row execute function public.stamp_task_attachment();

create or replace function public.log_task_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.task_log(new.task_id, 'attachment_added', null, null, new.file_name);
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform public.task_log(new.task_id, 'attachment_removed', null, new.file_name, null);
  end if;
  return null;
end $$;
drop trigger if exists trg_task_attachment_log on public.task_attachments;
create trigger trg_task_attachment_log
  after insert or update on public.task_attachments
  for each row execute function public.log_task_attachment();

create or replace function public.stamp_task_watcher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.added_by := coalesce(auth.uid(), new.added_by);
  return new;
end $$;
drop trigger if exists trg_task_watcher_stamp on public.task_watchers;
create trigger trg_task_watcher_stamp
  before insert on public.task_watchers
  for each row execute function public.stamp_task_watcher();

-- بعد الإدراج لا قبله: «on conflict do nothing» لا يكتب سطراً كاذباً
create or replace function public.log_task_watcher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.task_log(new.task_id, 'watcher_added', null, null, public.display_name(new.user_id));
  else
    perform public.task_log(old.task_id, 'watcher_removed', null, public.display_name(old.user_id), null);
  end if;
  return null;
end $$;
drop trigger if exists trg_task_watcher_log on public.task_watchers;
create trigger trg_task_watcher_log
  after insert or delete on public.task_watchers
  for each row execute function public.log_task_watcher();

-- ------------------------------------------------------------
-- 5) دوال الكتابة — DEFINER، كل دالة تفحص بنفسها
-- ------------------------------------------------------------

-- أعلّم المعاملة بأنها فعل مستخدم (للإشعارات) وأتحقق من الدخول
create or replace function public.task_begin_user_action()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'سجّل الدخول أولاً.' using errcode = '42501';
  end if;
  perform set_config('tilal.task_user_action', 'on', true);
  return v_uid;
end $$;
revoke all on function public.task_begin_user_action() from public, anon, authenticated;

-- المعتمِد الافتراضي: من طلب المهمة إن لم يكن هو المسؤول، وإلا مدير
-- قسمها، وإلا مدير النظام الأقدم.
create or replace function public.task_default_approver(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.created_by from public.tasks t
      where t.id = p_task and t.created_by is not null and t.created_by <> t.assigned_to),
    (select e.user_id from public.tasks t
       join public.departments d on d.id = t.department_id
       join public.employees e on e.id = d.manager_id
      where t.id = p_task and e.status = 'active' and e.user_id is not null and e.user_id <> t.assigned_to),
    (select e.user_id from public.tasks t
       join public.employees me on me.user_id = t.assigned_to
       join public.employees e on e.id = me.manager_id
      where t.id = p_task and e.status = 'active' and e.user_id is not null),
    (select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1));
$$;
revoke all on function public.task_default_approver(uuid) from public, anon, authenticated;

create or replace function public.task_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := public.task_begin_user_action();
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_old     public.tasks%rowtype;
  v_new     public.tasks%rowtype;
  v_parent  public.tasks%rowtype;
  v_assign  uuid;
  v_dept    uuid;
  v_type    text;
  v_etype   text;
  v_eid     uuid;
  v_scope   text := public.task_my_scope();
  v_label   uuid;
  v_user    uuid;
  v_item    text;
  v_src     text;
begin
  if public.is_broker() then
    raise exception 'المهام غير متاحة لحساب الوسيط.' using errcode = '42501';
  end if;

  if v_id is null then
    -- ================= إنشاء =================
    if coalesce(btrim(p->>'title'), '') = '' then
      raise exception 'اكتب عنوان المهمة.' using errcode = '22023';
    end if;

    if nullif(p->>'parent_task_id', '') is not null then
      select * into v_parent from public.tasks where id = (p->>'parent_task_id')::uuid;
      if v_parent.id is null or not public.can_edit_task(v_parent.id) then
        raise exception 'لا تملك إضافة مهمة فرعية لهذه المهمة.' using errcode = '42501';
      end if;
    end if;

    v_assign := coalesce(nullif(p->>'assigned_to', '')::uuid, v_uid);
    if not public.can_assign_task_to(v_assign) then
      raise exception 'لا تملك صلاحية إسناد هذه المهمة لهذا الموظف.' using errcode = '42501';
    end if;

    v_type := coalesce(nullif(p->>'task_type', ''), 'general');
    if not exists (select 1 from public.task_types tt where tt.code = v_type and tt.is_active and not tt.is_system) then
      raise exception 'نوع المهمة غير متاح.' using errcode = '22023';
    end if;

    v_dept := coalesce(nullif(p->>'department_id', '')::uuid, v_parent.department_id);
    if v_dept is not null and v_scope <> 'all'
       and v_dept not in (select d.id from public.task_my_department_ids() d)
       and v_dept is distinct from (select e.department_id from public.employees e where e.user_id = v_assign limit 1)
       and v_dept is distinct from (select e.department_id from public.employees e where e.user_id = v_uid limit 1) then
      raise exception 'لا تملك إنشاء مهمة في هذا القسم.' using errcode = '42501';
    end if;

    v_etype := coalesce(nullif(p->>'entity_type', ''), v_parent.entity_type);
    v_eid   := coalesce(nullif(p->>'entity_id', '')::uuid, v_parent.entity_id);
    if not public.task_entity_linkable(v_etype, v_eid) then
      raise exception 'الكيان المرتبط غير موجود أو خارج نطاقك.' using errcode = '42501';
    end if;
    if nullif(p->>'client_id', '') is not null and not public.task_entity_linkable('client', (p->>'client_id')::uuid) then
      raise exception 'العميل غير موجود أو خارج نطاقك.' using errcode = '42501';
    end if;
    if nullif(p->>'opportunity_id', '') is not null and not public.task_entity_linkable('opportunity', (p->>'opportunity_id')::uuid) then
      raise exception 'الفرصة غير موجودة أو خارج نطاقك.' using errcode = '42501';
    end if;

    v_src := case when p->>'created_source' in ('quick_add', 'form', 'subtask', 'duplicate') then p->>'created_source'
                  when v_parent.id is not null then 'subtask' else 'form' end;

    insert into public.tasks (
      title, description, priority, status, assigned_to, created_by,
      due_date, due_time, next_step, follow_up_date,
      client_id, opportunity_id, entity_type, entity_id,
      department_id, task_type, task_source, created_source,
      project_id, campaign_id, parent_task_id,
      estimated_minutes, start_date, deadline_at, blocked_reason,
      requires_approval, approver_id, workflow_id, workflow_step_id)
    values (
      btrim(p->>'title'),
      nullif(btrim(p->>'description'), ''),
      coalesce(nullif(p->>'priority', ''), (select tt.default_priority from public.task_types tt where tt.code = v_type), 'عادية'),
      'جديدة',
      v_assign, v_uid,
      case when p ? 'due_date' then nullif(p->>'due_date', '')::date else public.baghdad_today() end,
      nullif(p->>'due_time', '')::time,
      nullif(btrim(p->>'next_step'), ''),
      nullif(p->>'follow_up_date', '')::date,
      coalesce(nullif(p->>'client_id', '')::uuid, case when v_parent.id is not null then v_parent.client_id end),
      coalesce(nullif(p->>'opportunity_id', '')::uuid, case when v_parent.id is not null then v_parent.opportunity_id end),
      v_etype, v_eid,
      v_dept, v_type, 'manual', v_src,
      coalesce(nullif(p->>'project_id', '')::uuid, v_parent.project_id),
      coalesce(nullif(p->>'campaign_id', '')::uuid, v_parent.campaign_id),
      v_parent.id,
      nullif(p->>'estimated_minutes', '')::int,
      nullif(p->>'start_date', '')::date,
      nullif(p->>'deadline_at', '')::timestamptz,
      nullif(btrim(p->>'blocked_reason'), ''),
      coalesce((p->>'requires_approval')::boolean, false),
      nullif(p->>'approver_id', '')::uuid,
      nullif(p->>'workflow_id', '')::uuid,
      nullif(p->>'workflow_step_id', '')::uuid)
    returning * into v_new;

    -- قائمة التحقق
    if jsonb_typeof(p->'checklist') = 'array' then
      for v_item in select jsonb_array_elements_text(p->'checklist') loop
        if coalesce(btrim(v_item), '') <> '' then
          insert into public.task_checklist_items (task_id, body) values (v_new.id, v_item);
        end if;
      end loop;
    end if;
  else
    -- ================= تعديل =================
    select * into v_old from public.tasks where id = v_id for update;
    if v_old.id is null then
      raise exception 'المهمة غير موجودة.' using errcode = 'P0002';
    end if;
    if not public.task_row_editable(v_old.assigned_to, v_old.created_by, v_old.department_id) then
      raise exception 'لا تملك تعديل هذه المهمة.' using errcode = '42501';
    end if;
    if p ? 'version' and (p->>'version')::int is distinct from v_old.version then
      raise exception 'عُدّلت هذه المهمة بعد أن فتحتها — حدّث الصفحة ثم أعد المحاولة.' using hint = 'version_conflict';
    end if;

    -- المسؤول: لا يتغيّر إلا إن أُرسل وتغيّر فعلاً (إصلاح «التعديل يُسندها لي»)
    v_assign := v_old.assigned_to;
    if nullif(p->>'assigned_to', '') is not null and (p->>'assigned_to')::uuid <> v_old.assigned_to then
      v_assign := (p->>'assigned_to')::uuid;
      if not public.can_assign_task_to(v_assign) then
        raise exception 'لا تملك صلاحية إسناد هذه المهمة لهذا الموظف.' using errcode = '42501';
      end if;
    end if;

    v_dept := case when p ? 'department_id' then nullif(p->>'department_id', '')::uuid else v_old.department_id end;
    if v_dept is distinct from v_old.department_id and v_dept is not null and v_scope <> 'all'
       and v_uid is distinct from v_old.created_by and v_uid is distinct from v_old.assigned_to
       and v_dept not in (select d.id from public.task_my_department_ids() d) then
      raise exception 'لا تملك نقل المهمة إلى هذا القسم.' using errcode = '42501';
    end if;

    v_type := coalesce(nullif(p->>'task_type', ''), v_old.task_type);
    if v_type <> v_old.task_type then
      if exists (select 1 from public.task_types tt where tt.code in (v_type, v_old.task_type) and tt.is_system)
         and not public.is_admin() then
        raise exception 'نوع هذه المهمة يحدّده النظام.' using errcode = '42501';
      end if;
      if not exists (select 1 from public.task_types tt where tt.code = v_type and tt.is_active) then
        raise exception 'نوع المهمة غير متاح.' using errcode = '22023';
      end if;
    end if;

    v_etype := case when p ? 'entity_type' then nullif(p->>'entity_type', '') else v_old.entity_type end;
    v_eid   := case when p ? 'entity_id' then nullif(p->>'entity_id', '')::uuid else v_old.entity_id end;
    if (v_etype, v_eid) is distinct from (v_old.entity_type, v_old.entity_id)
       and not public.task_entity_linkable(v_etype, v_eid) then
      raise exception 'الكيان المرتبط غير موجود أو خارج نطاقك.' using errcode = '42501';
    end if;

    if p ? 'requires_approval' and (p->>'requires_approval')::boolean is distinct from v_old.requires_approval then
      if v_uid is distinct from v_old.created_by and v_scope <> 'all'
         and not coalesce(v_old.department_id in (select d.id from public.task_my_department_ids() d), false) then
        raise exception 'شرط الموافقة يغيّره من طلب المهمة أو مدير القسم.' using errcode = '42501';
      end if;
      if v_old.approval_status = 'بانتظار الموافقة' then
        raise exception 'المهمة بانتظار الموافقة — لا يُغيَّر شرطها الآن.' using errcode = '22023';
      end if;
    end if;

    if p ? 'status' and p->>'status' is distinct from v_old.status then
      if p->>'status' not in ('جديدة', 'قيد التنفيذ', 'منجزة', 'ملغاة') then
        raise exception 'حالة غير معروفة.' using errcode = '22023';
      end if;
      if p->>'status' = 'ملغاة' and coalesce(btrim(p->>'cancellation_reason'), '') = ''
         and public.task_requires_cancel_reason(v_type, v_dept) then
        raise exception 'اكتب سبب الإلغاء — هذا القسم أو النوع يطلبه.' using errcode = '22023';
      end if;
    end if;

    update public.tasks t set
      title             = case when p ? 'title' then p->>'title' else t.title end,
      description       = case when p ? 'description' then nullif(btrim(p->>'description'), '') else t.description end,
      priority          = case when p ? 'priority' then p->>'priority' else t.priority end,
      status            = case when p ? 'status' then p->>'status' else t.status end,
      cancellation_reason = case when p ? 'cancellation_reason' then p->>'cancellation_reason' else t.cancellation_reason end,
      assigned_to       = v_assign,
      due_date          = case when p ? 'due_date' then nullif(p->>'due_date', '')::date else t.due_date end,
      due_time          = case when p ? 'due_time' then nullif(p->>'due_time', '')::time else t.due_time end,
      next_step         = case when p ? 'next_step' then nullif(btrim(p->>'next_step'), '') else t.next_step end,
      follow_up_date    = case when p ? 'follow_up_date' then nullif(p->>'follow_up_date', '')::date else t.follow_up_date end,
      client_id         = case when p ? 'client_id' then nullif(p->>'client_id', '')::uuid else t.client_id end,
      opportunity_id    = case when p ? 'opportunity_id' then nullif(p->>'opportunity_id', '')::uuid else t.opportunity_id end,
      entity_type       = v_etype,
      entity_id         = v_eid,
      department_id     = v_dept,
      task_type         = v_type,
      project_id        = case when p ? 'project_id' then nullif(p->>'project_id', '')::uuid else t.project_id end,
      campaign_id       = case when p ? 'campaign_id' then nullif(p->>'campaign_id', '')::uuid else t.campaign_id end,
      estimated_minutes = case when p ? 'estimated_minutes' then nullif(p->>'estimated_minutes', '')::int else t.estimated_minutes end,
      actual_minutes    = case when p ? 'actual_minutes' then nullif(p->>'actual_minutes', '')::int else t.actual_minutes end,
      start_date        = case when p ? 'start_date' then nullif(p->>'start_date', '')::date else t.start_date end,
      deadline_at       = case when p ? 'deadline_at' then nullif(p->>'deadline_at', '')::timestamptz else t.deadline_at end,
      blocked_reason    = case when p ? 'blocked_reason' then p->>'blocked_reason' else t.blocked_reason end,
      requires_approval = case when p ? 'requires_approval' then (p->>'requires_approval')::boolean else t.requires_approval end,
      approver_id       = case when p ? 'approver_id' then nullif(p->>'approver_id', '')::uuid else t.approver_id end,
      workflow_id       = case when p ? 'workflow_id' then nullif(p->>'workflow_id', '')::uuid else t.workflow_id end,
      workflow_step_id  = case when p ? 'workflow_step_id' then nullif(p->>'workflow_step_id', '')::uuid else t.workflow_step_id end
     where t.id = v_id
    returning * into v_new;
  end if;

  -- الوسوم (استبدال كامل إن أُرسلت)
  if jsonb_typeof(p->'labels') = 'array' then
    delete from public.task_label_links l where l.task_id = v_new.id
       and l.label_id not in (select (x)::uuid from jsonb_array_elements_text(p->'labels') x);
    for v_label in select (x)::uuid from jsonb_array_elements_text(p->'labels') x loop
      -- الوسم عامّ، أو لقسم المهمة أو أحد آبائه
      if exists (select 1 from public.task_labels tl where tl.id = v_label and tl.is_active
                  and (tl.department_id is null
                       or v_new.department_id in (select d.id from public.department_descendants(tl.department_id) d))) then
        insert into public.task_label_links (task_id, label_id) values (v_new.id, v_label) on conflict do nothing;
      end if;
    end loop;
  end if;

  -- المتابِعون (إضافة فقط)
  if jsonb_typeof(p->'watchers') = 'array' then
    for v_user in select (x)::uuid from jsonb_array_elements_text(p->'watchers') x loop
      if v_user <> v_new.assigned_to and (v_user = v_uid or public.can_assign_task_to(v_user)) then
        insert into public.task_watchers (task_id, user_id) values (v_new.id, v_user) on conflict do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'status', v_new.status);
end $$;
comment on function public.task_save(jsonb) is
  'إنشاء/تعديل مهمة (191). التعديل لا يغيّر المسؤول إلا إن أُرسل assigned_to مختلفاً ومسموحاً. version يمنع الكتابة فوق تعديل أحدث.';

-- تغيير الحالة — بأزرار البطاقة. «أنجز» على مهمة تحتاج موافقة يطلب الموافقة.
create or replace function public.task_set_status(
  p_id uuid, p_status text, p_reason text default null, p_version int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
  v_approver uuid;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null then
    raise exception 'المهمة غير موجودة.' using errcode = 'P0002';
  end if;
  if not public.task_row_editable(t.assigned_to, t.created_by, t.department_id) then
    raise exception 'لا تملك تغيير حالة هذه المهمة.' using errcode = '42501';
  end if;
  if p_version is not null and p_version <> t.version then
    raise exception 'عُدّلت هذه المهمة بعد أن فتحتها — حدّث الصفحة ثم أعد المحاولة.' using hint = 'version_conflict';
  end if;
  if p_status not in ('جديدة', 'قيد التنفيذ', 'منجزة', 'ملغاة') then
    raise exception 'حالة غير معروفة.' using errcode = '22023';
  end if;
  if p_status = t.status then
    return jsonb_build_object('result', 'unchanged', 'status', t.status, 'version', t.version);
  end if;

  -- الإنجاز يحتاج موافقة: يتحوّل إلى طلب موافقة
  if p_status = 'منجزة' and t.requires_approval and t.approval_status is distinct from 'معتمدة' then
    if t.approval_status = 'بانتظار الموافقة' then
      raise exception 'المهمة بانتظار الموافقة بالفعل.' using errcode = '22023';
    end if;
    v_approver := coalesce(t.approver_id, public.task_default_approver(t.id));
    update public.tasks set
      approval_status = 'بانتظار الموافقة',
      approval_requested_at = now(),
      approver_id = v_approver,
      rejection_reason = null,
      status = case when status = 'جديدة' then 'قيد التنفيذ' else status end
     where id = p_id
    returning * into t;
    return jsonb_build_object('result', 'approval_requested', 'status', t.status, 'version', t.version,
                              'approver', public.display_name(v_approver));
  end if;

  if p_status = 'ملغاة' and coalesce(btrim(p_reason), '') = ''
     and public.task_requires_cancel_reason(t.task_type, t.department_id) then
    raise exception 'اكتب سبب الإلغاء — هذا القسم أو النوع يطلبه.' using errcode = '22023';
  end if;

  update public.tasks set
    status = p_status,
    cancellation_reason = case when p_status = 'ملغاة' then nullif(btrim(p_reason), '') end
   where id = p_id
  returning * into t;
  return jsonb_build_object('result', 'ok', 'status', t.status, 'version', t.version);
end $$;

-- قرار الموافقة: المعتمِد المسمّى، أو المدير، أو مدير القسم، أو من يملك
-- «approve» في نطاقه — ولا يعتمد المسؤول مهمته (إلا المدير).
create or replace function public.task_decide_approval(p_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null then
    raise exception 'المهمة غير موجودة.' using errcode = 'P0002';
  end if;
  if t.approval_status is distinct from 'بانتظار الموافقة' then
    raise exception 'لا طلب موافقة معلّق على هذه المهمة.' using errcode = '22023';
  end if;
  if not (
       public.is_admin()
    or v_uid = t.approver_id
    or (v_uid <> t.assigned_to and coalesce(t.department_id in (select m.id from public.my_managed_department_ids() m), false))
    or (v_uid <> t.assigned_to and public.has_permission('tasks', 'approve')
        and public.task_row_editable(t.assigned_to, t.created_by, t.department_id))
  ) then
    raise exception 'لا تملك اعتماد هذه المهمة.' using errcode = '42501';
  end if;
  if v_uid = t.assigned_to and not public.is_admin() then
    raise exception 'لا يعتمد المسؤول مهمته بنفسه.' using errcode = '42501';
  end if;

  if p_approve then
    update public.tasks set
      approval_status = 'معتمدة', approved_by = v_uid, approved_at = now(), rejection_reason = null,
      status = 'منجزة'
     where id = p_id returning * into t;
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'اكتب سبب الرفض كي يعرف المسؤول ما يصلحه.' using errcode = '22023';
    end if;
    update public.tasks set
      approval_status = 'مرفوضة', approved_by = v_uid, approved_at = now(), rejection_reason = btrim(p_reason),
      status = 'قيد التنفيذ'
     where id = p_id returning * into t;
  end if;
  return jsonb_build_object('result', case when p_approve then 'approved' else 'rejected' end,
                            'status', t.status, 'version', t.version);
end $$;

-- نقل الخطوة في المسار (لوحة التسويق). خطوة موافقة على مهمة تحتاجها
-- تطلب الموافقة بدل الانتقال.
create or replace function public.task_set_step(p_id uuid, p_step uuid, p_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
  s public.task_workflow_steps%rowtype;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null then
    raise exception 'المهمة غير موجودة.' using errcode = 'P0002';
  end if;
  if not public.task_row_editable(t.assigned_to, t.created_by, t.department_id) then
    raise exception 'لا تملك تحريك هذه المهمة.' using errcode = '42501';
  end if;
  if p_version is not null and p_version <> t.version then
    raise exception 'عُدّلت هذه المهمة بعد أن فتحتها — حدّث الصفحة ثم أعد المحاولة.' using hint = 'version_conflict';
  end if;
  select * into s from public.task_workflow_steps where id = p_step;
  if s.id is null or (t.workflow_id is not null and s.workflow_id <> t.workflow_id) then
    raise exception 'الخطوة ليست من مسار هذه المهمة.' using errcode = '22023';
  end if;

  if s.status_map = 'منجزة' and t.requires_approval and t.approval_status is distinct from 'معتمدة' then
    raise exception 'هذه المهمة تحتاج موافقة قبل الانتقال إلى «%».', s.name_ar using errcode = '22023';
  end if;

  update public.tasks set workflow_id = s.workflow_id, workflow_step_id = s.id where id = p_id returning * into t;

  if s.is_approval and t.requires_approval and t.approval_status is distinct from 'بانتظار الموافقة'
     and t.approval_status is distinct from 'معتمدة' then
    update public.tasks set
      approval_status = 'بانتظار الموافقة', approval_requested_at = now(),
      approver_id = coalesce(approver_id, public.task_default_approver(id)), rejection_reason = null
     where id = p_id returning * into t;
  end if;
  return jsonb_build_object('result', 'ok', 'status', t.status, 'step', s.name_ar, 'version', t.version);
end $$;

create or replace function public.task_reassign(p_id uuid, p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null then
    raise exception 'المهمة غير موجودة.' using errcode = 'P0002';
  end if;
  if not public.task_row_editable(t.assigned_to, t.created_by, t.department_id) then
    raise exception 'لا تملك إعادة إسناد هذه المهمة.' using errcode = '42501';
  end if;
  if p_user = t.assigned_to then
    return jsonb_build_object('result', 'unchanged', 'version', t.version);
  end if;
  if not public.can_assign_task_to(p_user) then
    raise exception 'لا تملك صلاحية إسناد هذه المهمة لهذا الموظف.' using errcode = '42501';
  end if;
  update public.tasks set assigned_to = p_user where id = p_id returning * into t;
  if coalesce(btrim(p_note), '') <> '' then
    perform public.task_comment_add(p_id, 'إعادة إسناد: ' || btrim(p_note), '{}');
  end if;
  return jsonb_build_object('result', 'ok', 'assigned_to_name', t.assigned_to_name, 'version', t.version);
end $$;

-- التعليقات والإشارات
create or replace function public.task_comment_add(p_task uuid, p_body text, p_mentions uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
  v_id uuid;
  v_author text := public.display_name(auth.uid());
  v_allowed uuid[] := '{}';
  m uuid;
  r record;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not public.can_see_task(p_task) then
    raise exception 'لا تملك التعليق على هذه المهمة.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'اكتب التعليق.' using errcode = '22023';
  end if;

  -- الإشارة: لمن في المهمة أصلاً، أو لمن أملك إسناده (فيصير متابعاً)
  foreach m in array coalesce(p_mentions, '{}') loop
    if m = t.assigned_to or m = t.created_by or m = t.approver_id
       or exists (select 1 from public.task_watchers w where w.task_id = p_task and w.user_id = m) then
      v_allowed := v_allowed || m;
    elsif public.can_assign_task_to(m) then
      insert into public.task_watchers (task_id, user_id) values (p_task, m) on conflict do nothing;
      v_allowed := v_allowed || m;
    end if;
  end loop;

  insert into public.task_comments (task_id, author_id, author_name, body, mentions)
  values (p_task, v_uid, v_author, btrim(p_body), v_allowed)
  returning id into v_id;

  perform public.task_log(p_task, 'comment_added', null, null, null, left(btrim(p_body), 200));

  -- الإشعارات: المُشار إليهم أولاً، ثم المشاركون
  foreach m in array v_allowed loop
    perform public.task_notify(m, v_author || ' أشار إليك في مهمة', t.title || ': ' || left(btrim(p_body), 160), p_task, 'عالية');
  end loop;
  for r in
    select distinct u from (
      select t.assigned_to as u union all select t.created_by union all
      select w.user_id from public.task_watchers w where w.task_id = p_task) x
     where u is not null and not (u = any (v_allowed))
  loop
    perform public.task_notify(r.u, 'تعليق جديد على مهمة', v_author || ' — ' || t.title || ': ' || left(btrim(p_body), 160), p_task);
  end loop;
  return v_id;
end $$;

create or replace function public.task_comment_edit(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.task_comments%rowtype;
begin
  perform public.task_begin_user_action();
  select * into c from public.task_comments where id = p_id for update;
  if c.id is null or c.deleted_at is not null then
    raise exception 'التعليق غير موجود.' using errcode = 'P0002';
  end if;
  if c.author_id <> auth.uid() then
    raise exception 'يعدّل التعليقَ كاتبُه فقط.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'اكتب التعليق.' using errcode = '22023';
  end if;
  update public.task_comments set body = btrim(p_body), edited_at = now() where id = p_id;
end $$;

create or replace function public.task_comment_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.task_comments%rowtype;
begin
  perform public.task_begin_user_action();
  select * into c from public.task_comments where id = p_id for update;
  if c.id is null or c.deleted_at is not null then
    raise exception 'التعليق غير موجود.' using errcode = 'P0002';
  end if;
  if c.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'يحذف التعليقَ كاتبُه أو المدير.' using errcode = '42501';
  end if;
  update public.task_comments set deleted_at = now() where id = p_id;
end $$;

create or replace function public.task_attachment_remove(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a public.task_attachments%rowtype;
begin
  perform public.task_begin_user_action();
  select * into a from public.task_attachments where id = p_id for update;
  if a.id is null or a.deleted_at is not null then
    raise exception 'المرفق غير موجود.' using errcode = 'P0002';
  end if;
  if a.uploaded_by <> auth.uid() and not public.can_edit_task(a.task_id) then
    raise exception 'يحذف المرفقَ رافعُه أو من يعدّل المهمة.' using errcode = '42501';
  end if;
  update public.task_attachments set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  return a.storage_path;   -- الواجهة تحذف الملف من الدلو بعدها
end $$;

-- المتابعة الذاتية
create or replace function public.task_watch(p_task uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.task_begin_user_action();
begin
  if not public.can_see_task(p_task) then
    raise exception 'لا تملك متابعة هذه المهمة.' using errcode = '42501';
  end if;
  if p_on then
    insert into public.task_watchers (task_id, user_id) values (p_task, v_uid) on conflict do nothing;
  else
    delete from public.task_watchers where task_id = p_task and user_id = v_uid;
  end if;
  return p_on;
end $$;

create or replace function public.task_archive(p_id uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null or not public.task_row_editable(t.assigned_to, t.created_by, t.department_id) then
    raise exception 'لا تملك أرشفة هذه المهمة.' using errcode = '42501';
  end if;
  if p_on and public.task_is_open(t.status) then
    raise exception 'تُؤرشف المهمة بعد إنجازها أو إلغائها — لا تُخفى المتأخرة بالأرشفة.' using errcode = '22023';
  end if;
  update public.tasks set archived_at = case when p_on then now() end where id = p_id returning * into t;
  return jsonb_build_object('result', 'ok', 'archived', t.archived_at is not null, 'version', t.version);
end $$;

create or replace function public.task_duplicate(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  t public.tasks%rowtype;
  v_new uuid;
begin
  select * into t from public.tasks where id = p_id;
  if t.id is null or not public.can_see_task(p_id) then
    raise exception 'لا تملك نسخ هذه المهمة.' using errcode = '42501';
  end if;
  if exists (select 1 from public.task_types tt where tt.code = t.task_type and tt.is_system) then
    raise exception 'مهامّ النظام لا تُنسخ.' using errcode = '22023';
  end if;
  insert into public.tasks (
    title, description, priority, status, assigned_to, created_by, due_date, due_time, next_step,
    client_id, opportunity_id, entity_type, entity_id, department_id, task_type, task_source, created_source,
    project_id, campaign_id, parent_task_id, estimated_minutes, requires_approval, approver_id, workflow_id)
  values (
    t.title || ' (نسخة)', t.description, t.priority, 'جديدة',
    case when public.can_assign_task_to(t.assigned_to) then t.assigned_to else v_uid end,
    v_uid, coalesce(t.due_date, public.baghdad_today()), t.due_time, t.next_step,
    t.client_id, t.opportunity_id, t.entity_type, t.entity_id, t.department_id, t.task_type, 'manual', 'duplicate',
    t.project_id, t.campaign_id, t.parent_task_id, t.estimated_minutes, t.requires_approval,
    case when t.approver_id = v_uid then null else t.approver_id end, t.workflow_id)
  returning id into v_new;

  insert into public.task_checklist_items (task_id, body, position)
  select v_new, c.body, c.position from public.task_checklist_items c where c.task_id = p_id order by c.position;
  insert into public.task_label_links (task_id, label_id)
  select v_new, l.label_id from public.task_label_links l where l.task_id = p_id;
  return v_new;
end $$;

-- إجراءات جماعية — كل صفّ بصلاحيته، وإشعار واحد لكل مسؤول جديد
create or replace function public.task_bulk_update(p_ids uuid[], p_action text, p_value jsonb default '{}'::jsonb)
returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.task_begin_user_action();
  v_id uuid;
  n_ok int := 0;
  n_bad int := 0;
  err text;
  t public.tasks%rowtype;
  v_user uuid;
begin
  if array_length(p_ids, 1) is null then
    raise exception 'لم تُختَر مهام.' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ مهمة في الدفعة الواحدة.' using errcode = '22023';
  end if;
  if p_action not in ('assign', 'priority', 'due_date', 'department', 'add_label', 'remove_label',
                      'start', 'complete', 'cancel', 'archive') then
    raise exception 'إجراء غير معروف.' using errcode = '22023';
  end if;

  if p_action = 'assign' then
    v_user := nullif(p_value->>'user_id', '')::uuid;
    if not public.can_assign_task_to(v_user) then
      raise exception 'لا تملك صلاحية إسناد المهام لهذا الموظف.' using errcode = '42501';
    end if;
    perform set_config('tilal.quiet_task_notify', 'on', true);
  end if;

  foreach v_id in array p_ids loop
    begin
      select * into t from public.tasks where id = v_id for update;
      if t.id is null or not public.task_row_editable(t.assigned_to, t.created_by, t.department_id) then
        raise exception 'لا تملك تعديل «%».', coalesce(t.title, v_id::text);
      end if;
      case p_action
        when 'assign' then
          update public.tasks set assigned_to = v_user where id = v_id;
        when 'priority' then
          update public.tasks set priority = p_value->>'priority' where id = v_id;
        when 'due_date' then
          update public.tasks set due_date = nullif(p_value->>'due_date', '')::date where id = v_id;
        when 'department' then
          if public.task_my_scope() <> 'all'
             and nullif(p_value->>'department_id', '')::uuid not in (select d.id from public.task_my_department_ids() d)
             and v_uid is distinct from t.created_by and v_uid is distinct from t.assigned_to then
            raise exception 'لا تملك نقل «%» إلى هذا القسم.', t.title;
          end if;
          update public.tasks set department_id = nullif(p_value->>'department_id', '')::uuid where id = v_id;
        when 'add_label' then
          insert into public.task_label_links (task_id, label_id)
          values (v_id, (p_value->>'label_id')::uuid) on conflict do nothing;
        when 'remove_label' then
          delete from public.task_label_links where task_id = v_id and label_id = (p_value->>'label_id')::uuid;
        when 'start' then
          perform public.task_set_status(v_id, 'قيد التنفيذ');
        when 'complete' then
          perform public.task_set_status(v_id, 'منجزة');
        when 'cancel' then
          perform public.task_set_status(v_id, 'ملغاة', p_value->>'reason');
        when 'archive' then
          perform public.task_archive(v_id, true);
      end case;
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  if p_action = 'assign' and n_ok > 0 then
    perform set_config('tilal.quiet_task_notify', '', true);
    perform public.task_notify(v_user, 'أُسندت إليك ' || n_ok || ' مهمة',
      'من ' || public.display_name(v_uid) || ' — افتح مهامك لترى التفاصيل.', p_ids[1], 'عالية');
  end if;

  return query select n_ok, n_bad, err;
end $$;

-- ------------------------------------------------------------
-- 6) دوال القراءة — INVOKER: RLS تحكم ما يُرى
-- ------------------------------------------------------------

-- القائمة بترقيم من الخادم. p: q, scope, bucket, split_waiting, status[],
-- priority[], task_type[], task_source[], department_id (مع الفروع),
-- workspace, assigned_to ('me'|uuid), created_by ('me'|uuid), project_id,
-- campaign_id, client_id, opportunity_id, entity_type+entity_id, parent
-- ('top'|uuid), label_id, due_from, due_to, archived ('include'|'only'),
-- sort ('smart'|'due'|'due_desc'|'priority'|'created'|'updated'|'title').
create or replace function public.task_list(p jsonb default '{}'::jsonb, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.baghdad_today();
  v_now     timestamptz := now();
  v_q       text := nullif(btrim(p->>'q'), '');
  v_like    text;
  v_sort    text := coalesce(nullif(p->>'sort', ''), 'smart');
  v_limit   int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_bucket  text := nullif(p->>'bucket', '');
  v_scope   text := nullif(p->>'scope', '');
  v_split   boolean := coalesce((p->>'split_waiting')::boolean, false);
  v_archived text := coalesce(p->>'archived', '');
  v_orphan  boolean := coalesce((p->>'orphan')::boolean, false);   -- عميل مغلق ومهمته مفتوحة (077)
  v_ws      text := nullif(p->>'workspace', '');
  -- كل مرشّح يُحوَّل إلى نوعه هنا مرة، فلا يُقيَّم تحويل داخل شرط
  v_id      uuid := case when p->>'id' ~* '^[0-9a-f-]{36}$' then (p->>'id')::uuid end;
  v_project uuid := case when p->>'project_id' ~* '^[0-9a-f-]{36}$' then (p->>'project_id')::uuid end;
  v_campaign uuid := case when p->>'campaign_id' ~* '^[0-9a-f-]{36}$' then (p->>'campaign_id')::uuid end;
  v_client  uuid := case when p->>'client_id' ~* '^[0-9a-f-]{36}$' then (p->>'client_id')::uuid end;
  v_opp     uuid := case when p->>'opportunity_id' ~* '^[0-9a-f-]{36}$' then (p->>'opportunity_id')::uuid end;
  v_etype   text := nullif(p->>'entity_type', '');
  v_eid     uuid := case when p->>'entity_id' ~* '^[0-9a-f-]{36}$' then (p->>'entity_id')::uuid end;
  v_top     boolean := coalesce(p->>'parent' = 'top', false);   -- غيابه = لا تصفية (لا null يُسقط الفرعية)
  v_parent  uuid := case when p->>'parent' ~* '^[0-9a-f-]{36}$' then (p->>'parent')::uuid end;
  v_labelid uuid := case when p->>'label_id' ~* '^[0-9a-f-]{36}$' then (p->>'label_id')::uuid end;
  v_from    date := case when p->>'due_from' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'due_from')::date end;
  v_to      date := case when p->>'due_to' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'due_to')::date end;
  v_assign  uuid := case when p->>'assigned_to' = 'me' then auth.uid()
                         when p->>'assigned_to' ~* '^[0-9a-f-]{36}$' then (p->>'assigned_to')::uuid end;
  v_creator uuid := case when p->>'created_by' = 'me' then auth.uid()
                         when p->>'created_by' ~* '^[0-9a-f-]{36}$' then (p->>'created_by')::uuid end;
  v_depts   uuid[];
  v_ws_depts uuid[];
  v_team    uuid[];
  v_watched uuid[];
  v_mydepts uuid[];
  v_status  text[];
  v_prio    text[];
  v_types   text[];
  v_srcs    text[];
  v_result  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  if jsonb_typeof(p->'status') = 'array' then v_status := array(select jsonb_array_elements_text(p->'status')); end if;
  if jsonb_typeof(p->'priority') = 'array' then v_prio := array(select jsonb_array_elements_text(p->'priority')); end if;
  if jsonb_typeof(p->'task_type') = 'array' then v_types := array(select jsonb_array_elements_text(p->'task_type')); end if;
  if jsonb_typeof(p->'task_source') = 'array' then v_srcs := array(select jsonb_array_elements_text(p->'task_source')); end if;
  if coalesce(array_length(v_status, 1), 0) = 0 then v_status := null; end if;
  if coalesce(array_length(v_prio, 1), 0) = 0 then v_prio := null; end if;
  if coalesce(array_length(v_types, 1), 0) = 0 then v_types := null; end if;
  if coalesce(array_length(v_srcs, 1), 0) = 0 then v_srcs := null; end if;

  if p->>'department_id' ~* '^[0-9a-f-]{36}$' then
    select array_agg(d.id) into v_depts from public.department_descendants((p->>'department_id')::uuid) d;
  end if;
  if v_ws is not null then
    select array_agg(d.id) into v_ws_depts from public.departments d
     where (select s.workspace from public.task_department_settings(d.id) s) = v_ws;
  end if;
  if v_scope = 'team' then
    select array_agg(x.user_id) into v_team from public.task_team_user_ids() x where x.user_id <> v_uid;
  elsif v_scope = 'department' then
    select array_agg(d.id) into v_mydepts from public.task_my_department_ids() d;
  elsif v_scope = 'watching' then
    select array_agg(w.task_id) into v_watched from public.task_my_watched_ids() w;
  end if;

  with base as (
    select t.*,
           public.task_is_open(t.status) as is_open,
           exists (select 1 from public.task_dependencies d join public.tasks x on x.id = d.depends_on_id
                    where d.task_id = t.id and d.is_blocking and x.status not in ('منجزة', 'ملغاة')) as has_blocker,
           public.task_due_at(t.due_date, t.due_time) as due_at
      from public.tasks t
     where (v_id is null or t.id = v_id)
       and (v_q is null
            or t.title ilike v_like or t.description ilike v_like or t.assigned_to_name ilike v_like
            or t.next_step ilike v_like or t.id::text = v_q
            or exists (select 1 from public.clients c where c.id = t.client_id and c.name ilike v_like)
            or exists (select 1 from public.opportunities o where o.id = t.opportunity_id and o.title ilike v_like)
            or exists (select 1 from public.projects pr where pr.id = t.project_id and pr.name ilike v_like)
            or exists (select 1 from public.crm_campaigns cc where cc.id = t.campaign_id and cc.name ilike v_like))
       and (v_status is null or t.status = any (v_status))
       and (v_prio is null or t.priority = any (v_prio))
       and (v_types is null or t.task_type = any (v_types))
       and (v_srcs is null or t.task_source = any (v_srcs))
       and (v_depts is null or t.department_id = any (v_depts))
       and (v_ws is null
            or t.department_id = any (coalesce(v_ws_depts, '{}'))
            or (v_ws = 'projects' and t.project_id is not null))
       and (v_assign is null or t.assigned_to = v_assign)
       and (v_creator is null or t.created_by = v_creator)
       and (v_project is null or t.project_id = v_project)
       and (v_campaign is null or t.campaign_id = v_campaign)
       and (v_client is null or t.client_id = v_client or t.related_client = v_client)
       and (v_opp is null or t.opportunity_id = v_opp)
       and (v_eid is null or (t.entity_type = v_etype and t.entity_id = v_eid))
       and (not v_top or t.parent_task_id is null)
       and (v_parent is null or t.parent_task_id = v_parent)
       and (v_labelid is null
            or exists (select 1 from public.task_label_links l where l.task_id = t.id and l.label_id = v_labelid))
       and (not v_orphan or exists (select 1 from public.clients c
                                     where c.id = t.client_id and c.deleted_at is null and not public.is_open_stage(c.stage)))
       and (v_from is null or t.due_date >= v_from)
       and (v_to is null or t.due_date <= v_to)
       and (case v_archived
              when 'include' then true
              when 'only' then t.archived_at is not null
              else t.archived_at is null end)
       and (case v_scope
              when 'mine' then t.assigned_to = v_uid
              when 'created' then t.created_by = v_uid and t.assigned_to <> v_uid
              when 'approvals' then t.approver_id = v_uid and t.approval_status = 'بانتظار الموافقة'
              when 'team' then t.assigned_to = any (coalesce(v_team, '{}'))
              when 'department' then t.department_id = any (coalesce(v_mydepts, '{}'))
              when 'watching' then t.id = any (coalesce(v_watched, '{}'))
              else true end)
  ), filtered as (
    -- كل مشتقّ منطقيّ صريح (coalesce): null هنا كان سيُسقط الصفّ من شرط
    -- «not (split and is_waiting)» فتختفي المهام العادية من «عملي».
    select b.*,
           coalesce(b.is_open and (b.blocked_reason is not null
                                   or b.approval_status = 'بانتظار الموافقة'
                                   or b.has_blocker), false) as is_waiting,
           coalesce(b.is_open and b.due_date < v_today, false) as is_late,
           coalesce(b.is_open and b.due_at between v_now and v_now + interval '24 hours', false) as is_due_soon,
           coalesce(b.deadline_at is not null
                    and ((b.is_open and b.deadline_at < v_now)
                         or (b.completed_at is not null and b.completed_at > b.deadline_at)), false) as sla_breached
      from base b
  ), bucketed as (
    select f.* from filtered f
     where case v_bucket
             when 'late'     then f.is_late and not (v_split and f.is_waiting)
             when 'today'    then f.is_open and f.due_date = v_today and not (v_split and f.is_waiting)
             when 'upcoming' then f.is_open and f.due_date > v_today and not (v_split and f.is_waiting)
             when 'nodate'   then f.is_open and f.due_date is null and not (v_split and f.is_waiting)
             when 'open'     then f.is_open
             when 'waiting'  then f.is_waiting
             when 'due_soon' then f.is_due_soon
             when 'done'     then f.status in ('منجزة', 'ملغاة')
             when 'completed' then f.status = 'منجزة'
             when 'pending_approval' then f.approval_status = 'بانتظار الموافقة'
             when 'sla'      then f.sla_breached
             else true end
  ), ranked as (
    select bk.*,
           count(*) over () as total_count,
           row_number() over (order by
             case when v_sort = 'smart' then public.task_priority_rank(bk.priority) end,
             case when v_sort in ('smart', 'due') then bk.due_date end asc nulls last,
             case when v_sort in ('smart', 'due') then bk.due_time end asc nulls last,
             case when v_sort = 'due_desc' then bk.due_date end desc nulls last,
             case when v_sort = 'priority' then public.task_priority_rank(bk.priority) end,
             case when v_sort = 'priority' then bk.due_date end asc nulls last,
             case when v_sort = 'created' then bk.created_at end desc,
             case when v_sort in ('updated', 'done') then coalesce(bk.completed_at, bk.cancelled_at, bk.updated_at) end desc,
             case when v_sort = 'title' then bk.title end,
             bk.created_at, bk.id) as rn
      from bucketed bk
  ), pg as (
    select r.* from ranked r order by r.rn limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'total', coalesce((select max(r2.total_count) from ranked r2), 0),
           'rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', pg.id, 'title', pg.title, 'description', left(pg.description, 300),
             'status', pg.status, 'priority', pg.priority,
             'due_date', pg.due_date, 'due_time', pg.due_time,
             'next_step', pg.next_step, 'follow_up_date', pg.follow_up_date,
             'assigned_to', pg.assigned_to, 'assigned_to_name', pg.assigned_to_name,
             'created_by', pg.created_by, 'created_by_name', pg.created_by_name, 'created_by_role', pg.created_by_role,
             'department_id', pg.department_id,
             'department_name', (select d.name_ar from public.departments d where d.id = pg.department_id),
             'task_type', pg.task_type,
             'type_name', (select tt.name_ar from public.task_types tt where tt.code = pg.task_type),
             'type_icon', (select tt.icon from public.task_types tt where tt.code = pg.task_type),
             'task_source', pg.task_source,
             'entity_type', pg.entity_type, 'entity_id', pg.entity_id,
             'entity_label', public.task_entity_label(pg.entity_type, pg.entity_id),
             'client_id', pg.client_id,
             'client_name', (select c.name from public.clients c where c.id = pg.client_id),
             'client_phone', (select c.phone from public.clients c where c.id = pg.client_id),
             'opportunity_id', pg.opportunity_id,
             'opportunity_title', (select o.title from public.opportunities o where o.id = pg.opportunity_id),
             'project_id', pg.project_id,
             'project_name', (select pr.name from public.projects pr where pr.id = pg.project_id),
             'campaign_id', pg.campaign_id,
             'campaign_name', (select cc.name from public.crm_campaigns cc where cc.id = pg.campaign_id),
             'parent_task_id', pg.parent_task_id,
             'workflow_id', pg.workflow_id, 'workflow_step_id', pg.workflow_step_id,
             'step_name', (select s.name_ar from public.task_workflow_steps s where s.id = pg.workflow_step_id),
             'step_color', (select s.color from public.task_workflow_steps s where s.id = pg.workflow_step_id),
             'requires_approval', pg.requires_approval, 'approval_status', pg.approval_status,
             'approver_id', pg.approver_id,
             'analysis_lost_sale_id', pg.analysis_lost_sale_id,
             'blocked_reason', pg.blocked_reason, 'deadline_at', pg.deadline_at,
             'estimated_minutes', pg.estimated_minutes, 'actual_minutes', pg.actual_minutes,
             'completed_at', pg.completed_at, 'cancelled_at', pg.cancelled_at,
             'cancellation_reason', pg.cancellation_reason,
             'created_at', pg.created_at, 'updated_at', pg.updated_at, 'archived_at', pg.archived_at,
             'version', pg.version,
             'is_late', pg.is_late, 'is_waiting', pg.is_waiting, 'is_due_soon', pg.is_due_soon,
             'sla_breached', pg.sla_breached, 'has_blocker', pg.has_blocker,
             'subtasks_total', (select count(*) from public.tasks s where s.parent_task_id = pg.id),
             'subtasks_done', (select count(*) from public.tasks s where s.parent_task_id = pg.id and s.status = 'منجزة'),
             'checklist_total', (select count(*) from public.task_checklist_items c where c.task_id = pg.id),
             'checklist_done', (select count(*) from public.task_checklist_items c where c.task_id = pg.id and c.is_done),
             'comments_count', (select count(*) from public.task_comments c where c.task_id = pg.id and c.deleted_at is null),
             'attachments_count', (select count(*) from public.task_attachments a where a.task_id = pg.id and a.deleted_at is null),
             'labels', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
                                   from public.task_label_links ll join public.task_labels l on l.id = ll.label_id
                                  where ll.task_id = pg.id), '[]'::jsonb)
           ) order by pg.rn), '[]'::jsonb))
    into v_result
    from pg;

  return v_result;
end $$;

comment on function public.task_list(jsonb, int, int) is
  'قائمة المهام بترقيم من الخادم (191). INVOKER: RLS تحدّد ما يُرى. {rows, total}.';

-- تفاصيل مهمة واحدة بكل ما حولها
create or replace function public.task_detail(p_id uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  t   public.tasks%rowtype;
  v_uid uuid := auth.uid();
  v_row jsonb;
begin
  select * into t from public.tasks where id = p_id;   -- RLS: لا صفّ = لا صلاحية
  if t.id is null then
    return null;
  end if;

  select (public.task_list(jsonb_build_object('archived', 'include', 'id', p_id::text), 1, 0)->'rows'->0)
    into v_row;

  return jsonb_build_object(
    'task', coalesce(v_row, to_jsonb(t)) || jsonb_build_object(
      'description', t.description, 'start_date', t.start_date, 'started_at', t.started_at,
      'completed_by_name', case when t.completed_by is not null then public.display_name(t.completed_by) end,
      'cancelled_by_name', case when t.cancelled_by is not null then public.display_name(t.cancelled_by) end,
      'approver_name', case when t.approver_id is not null then public.display_name(t.approver_id) end,
      'approved_by_name', case when t.approved_by is not null then public.display_name(t.approved_by) end,
      'approval_requested_at', t.approval_requested_at, 'approved_at', t.approved_at,
      'rejection_reason', t.rejection_reason, 'recurrence_id', t.recurrence_id, 'template_id', t.template_id,
      'created_source', t.created_source,
      'source_name', (select s.name_ar from public.task_sources s where s.code = t.task_source),
      'entity_url', (select replace(et.url_template, '{id}', t.entity_id::text) from public.task_entity_types et
                      where et.code = t.entity_type and et.url_template is not null),
      'entity_type_name', (select et.name_ar from public.task_entity_types et where et.code = t.entity_type)),
    'parent', (select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status)
                 from public.tasks x where x.id = t.parent_task_id),
    'subtasks', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'title', s.title, 'status', s.status, 'priority', s.priority,
                   'due_date', s.due_date, 'assigned_to_name', s.assigned_to_name, 'version', s.version)
                   order by s.due_date nulls last, s.created_at)
                   from public.tasks s where s.parent_task_id = t.id), '[]'::jsonb),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', c.id, 'body', c.body, 'is_done', c.is_done, 'position', c.position,
                   'done_by_name', case when c.done_by is not null then public.display_name(c.done_by) end,
                   'done_at', c.done_at) order by c.position, c.created_at)
                   from public.task_checklist_items c where c.task_id = t.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', c.id, 'author_id', c.author_id, 'author_name', c.author_name, 'body', c.body,
                   'created_at', c.created_at, 'edited_at', c.edited_at, 'mine', c.author_id = v_uid)
                   order by c.created_at)
                   from public.task_comments c where c.task_id = t.id and c.deleted_at is null), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
                   'storage_path', a.storage_path, 'uploaded_by_name', a.uploaded_by_name, 'created_at', a.created_at,
                   'mine', a.uploaded_by = v_uid) order by a.created_at desc)
                   from public.task_attachments a where a.task_id = t.id and a.deleted_at is null), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
                   select jsonb_build_object('id', l.id, 'action', l.action, 'field', l.field,
                          'old_value', l.old_value, 'new_value', l.new_value, 'note', l.note,
                          'actor_name', l.actor_name, 'at', l.at) as x
                     from public.task_activity_log l where l.task_id = t.id
                    order by l.at desc limit 200) y), '[]'::jsonb),
    'depends_on', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', x.id, 'title', x.title, 'status', x.status, 'is_blocking', d.is_blocking,
                   'assigned_to_name', x.assigned_to_name))
                   from public.task_dependencies d join public.tasks x on x.id = d.depends_on_id
                  where d.task_id = t.id), '[]'::jsonb),
    'dependents', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', x.id, 'title', x.title, 'status', x.status, 'is_blocking', d.is_blocking,
                   'assigned_to_name', x.assigned_to_name))
                   from public.task_dependencies d join public.tasks x on x.id = d.task_id
                  where d.depends_on_id = t.id), '[]'::jsonb),
    'watchers', coalesce((select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'name', public.display_name(w.user_id)))
                   from public.task_watchers w where w.task_id = t.id), '[]'::jsonb),
    'workflow_steps', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name_ar, 'position', s.position, 'status_map', s.status_map,
                   'is_approval', s.is_approval, 'color', s.color) order by s.position)
                   from public.task_workflow_steps s where s.workflow_id = t.workflow_id), '[]'::jsonb),
    'permissions', jsonb_build_object(
       'can_edit', public.task_row_editable(t.assigned_to, t.created_by, t.department_id),
       'can_delete', public.is_admin() or (t.created_by = v_uid and t.task_source = 'manual'),
       'can_approve', t.approval_status = 'بانتظار الموافقة' and (
            public.is_admin() or v_uid = t.approver_id
         or (v_uid <> t.assigned_to and coalesce(t.department_id in (select m.id from public.my_managed_department_ids() m), false))
         or (v_uid <> t.assigned_to and public.has_permission('tasks', 'approve')
             and public.task_row_editable(t.assigned_to, t.created_by, t.department_id))),
       'is_watching', exists (select 1 from public.task_watchers w where w.task_id = t.id and w.user_id = v_uid),
       'is_assignee', t.assigned_to = v_uid,
       'cancel_reason_required', public.task_requires_cancel_reason(t.task_type, t.department_id))
  );
end $$;

-- البطاقات: «عملي» دائماً، و«الفريق» لمن له فريق أو قسم
create or replace function public.task_counts()
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.baghdad_today();
  v_now timestamptz := now();
  v_mine jsonb;
  v_team jsonb := null;
  v_team_users uuid[];
  v_depts uuid[];
  v_scope text := public.task_my_scope();
begin
  if v_uid is null then return null; end if;

  select jsonb_build_object(
    'open',        count(*) filter (where public.task_is_open(t.status)),
    'late',        count(*) filter (where public.task_is_open(t.status) and t.due_date < v_today),
    'today',       count(*) filter (where public.task_is_open(t.status) and t.due_date = v_today),
    'upcoming',    count(*) filter (where public.task_is_open(t.status) and t.due_date > v_today and t.due_date <= v_today + 7),
    'nodate',      count(*) filter (where public.task_is_open(t.status) and t.due_date is null),
    'in_progress', count(*) filter (where t.status = 'قيد التنفيذ'),
    'waiting',     count(*) filter (where public.task_is_open(t.status) and (t.blocked_reason is not null
                                     or t.approval_status = 'بانتظار الموافقة'
                                     or exists (select 1 from public.task_dependencies d join public.tasks x on x.id = d.depends_on_id
                                                 where d.task_id = t.id and d.is_blocking and x.status not in ('منجزة', 'ملغاة')))),
    'due_soon',    count(*) filter (where public.task_is_open(t.status)
                                     and public.task_due_at(t.due_date, t.due_time) between v_now and v_now + interval '24 hours'),
    'done_today',  count(*) filter (where t.status = 'منجزة' and (t.completed_at at time zone 'Asia/Baghdad')::date = v_today),
    'followups',   count(*) filter (where public.task_is_open(t.status) and t.follow_up_date <= v_today))
    into v_mine
    from public.tasks t
   where t.assigned_to = v_uid and t.archived_at is null;

  v_mine := v_mine || jsonb_build_object(
    'my_approvals', (select count(*) from public.tasks t
                      where t.approver_id = v_uid and t.approval_status = 'بانتظار الموافقة'),
    'delegated_open', (select count(*) from public.tasks t
                        where t.created_by = v_uid and t.assigned_to <> v_uid and public.task_is_open(t.status)));

  select array_agg(x.user_id) into v_team_users from public.task_team_user_ids() x where x.user_id <> v_uid;
  select array_agg(d.id) into v_depts from public.task_my_department_ids() d;

  if v_scope = 'all' or v_team_users is not null or v_depts is not null then
    with scoped as (
      select t.* from public.tasks t
       where t.archived_at is null and t.assigned_to <> v_uid
         and (v_scope = 'all' or t.assigned_to = any (coalesce(v_team_users, '{}'))
              or t.department_id = any (coalesce(v_depts, '{}')))
    )
    select jsonb_build_object(
      'open',        count(*) filter (where public.task_is_open(s.status)),
      'late',        count(*) filter (where public.task_is_open(s.status) and s.due_date < v_today),
      'today',       count(*) filter (where public.task_is_open(s.status) and s.due_date = v_today),
      'in_progress', count(*) filter (where s.status = 'قيد التنفيذ'),
      'done_today',  count(*) filter (where s.status = 'منجزة' and (s.completed_at at time zone 'Asia/Baghdad')::date = v_today),
      'pending_approvals', count(*) filter (where s.approval_status = 'بانتظار الموافقة'),
      'people',      count(distinct s.assigned_to) filter (where public.task_is_open(s.status)),
      'due_30',      count(*) filter (where s.due_date between v_today - 30 and v_today and s.status <> 'ملغاة'),
      'done_due_30', count(*) filter (where s.due_date between v_today - 30 and v_today and s.status = 'منجزة'),
      'sla_breached', count(*) filter (where s.deadline_at is not null
                                       and ((public.task_is_open(s.status) and s.deadline_at < v_now)
                                            or (s.completed_at > s.deadline_at))))
      into v_team
      from scoped s;
  end if;

  return jsonb_build_object('scope', v_scope, 'mine', v_mine, 'team', v_team);
end $$;

-- من أستطيع إسناده (للقوائم المنسدلة)
create or replace function public.task_assignable_people()
returns table (user_id uuid, name text, department_id uuid, department_name text, is_me boolean)
language sql stable security definer set search_path = public as $$
  select e.user_id, e.full_name, e.department_id, d.name_ar, e.user_id = auth.uid()
    from public.employees e
    left join public.departments d on d.id = e.department_id
   where e.status = 'active' and e.user_id is not null
     and public.can_assign_task_to(e.user_id)
  union
  select p.id, public.display_name(p.id), null, null, true
    from public.profiles p
   where p.id = auth.uid()
     and not exists (select 1 from public.employees e where e.user_id = p.id and e.status = 'active')
  order by 5 desc, 2;
$$;

revoke all on function public.task_save(jsonb)                          from public, anon;
revoke all on function public.task_set_status(uuid, text, text, int)    from public, anon;
revoke all on function public.task_decide_approval(uuid, boolean, text) from public, anon;
revoke all on function public.task_set_step(uuid, uuid, int)            from public, anon;
revoke all on function public.task_reassign(uuid, uuid, text)           from public, anon;
revoke all on function public.task_comment_add(uuid, text, uuid[])      from public, anon;
revoke all on function public.task_comment_edit(uuid, text)             from public, anon;
revoke all on function public.task_comment_delete(uuid)                 from public, anon;
revoke all on function public.task_attachment_remove(uuid)              from public, anon;
revoke all on function public.task_watch(uuid, boolean)                 from public, anon;
revoke all on function public.task_archive(uuid, boolean)               from public, anon;
revoke all on function public.task_duplicate(uuid)                      from public, anon;
revoke all on function public.task_bulk_update(uuid[], text, jsonb)     from public, anon;
revoke all on function public.task_list(jsonb, int, int)                from public, anon;
revoke all on function public.task_detail(uuid)                         from public, anon;
revoke all on function public.task_counts()                             from public, anon;
revoke all on function public.task_assignable_people()                  from public, anon;
grant execute on function public.task_save(jsonb)                          to authenticated;
grant execute on function public.task_set_status(uuid, text, text, int)    to authenticated;
grant execute on function public.task_decide_approval(uuid, boolean, text) to authenticated;
grant execute on function public.task_set_step(uuid, uuid, int)            to authenticated;
grant execute on function public.task_reassign(uuid, uuid, text)           to authenticated;
grant execute on function public.task_comment_add(uuid, text, uuid[])      to authenticated;
grant execute on function public.task_comment_edit(uuid, text)             to authenticated;
grant execute on function public.task_comment_delete(uuid)                 to authenticated;
grant execute on function public.task_attachment_remove(uuid)              to authenticated;
grant execute on function public.task_watch(uuid, boolean)                 to authenticated;
grant execute on function public.task_archive(uuid, boolean)               to authenticated;
grant execute on function public.task_duplicate(uuid)                      to authenticated;
grant execute on function public.task_bulk_update(uuid[], text, jsonb)     to authenticated;
grant execute on function public.task_list(jsonb, int, int)                to authenticated;
grant execute on function public.task_detail(uuid)                         to authenticated;
grant execute on function public.task_counts()                             to authenticated;
grant execute on function public.task_assignable_people()                  to authenticated;
grant execute on function public.task_priority_rank(text)                  to authenticated;
grant execute on function public.task_due_at(date, time)                   to authenticated;
grant execute on function public.task_is_open(text)                        to authenticated;

-- ------------------------------------------------------------
-- 7) التذكير اليومي v2 — نفس الاسم والجدولة (٩:٠٠ بغداد)
--    «متأخرة: 3 · اليوم: 7 · قادمة: 5 · بانتظار موافقتك: 2»
--    ولا يُرسل إن لم يكن هناك متأخر أو اليوم أو متابعة أو موافقة.
-- ------------------------------------------------------------
create or replace function public.tasks_daily_reminder()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := public.baghdad_today();
  sent  int  := 0;
  rec   record;
  parts text[];
begin
  for rec in
    with mine as (
      select t.assigned_to as uid,
             count(*) filter (where t.due_date < today)                           as late_count,
             count(*) filter (where t.due_date = today)                           as today_count,
             count(*) filter (where t.due_date > today and t.due_date <= today + 7) as upcoming_count,
             count(*) filter (where t.follow_up_date = today)                     as followup_count
        from public.tasks t
       where t.status in ('جديدة', 'قيد التنفيذ') and t.archived_at is null
       group by t.assigned_to
    ), approvals as (
      select t.approver_id as uid, count(*) as approval_count
        from public.tasks t
       where t.approval_status = 'بانتظار الموافقة' and t.approver_id is not null
       group by t.approver_id
    )
    select coalesce(m.uid, a.uid) as uid,
           coalesce(m.late_count, 0) as late_count, coalesce(m.today_count, 0) as today_count,
           coalesce(m.upcoming_count, 0) as upcoming_count, coalesce(m.followup_count, 0) as followup_count,
           coalesce(a.approval_count, 0) as approval_count
      from mine m full join approvals a on a.uid = m.uid
  loop
    if rec.uid is null
       or rec.late_count + rec.today_count + rec.followup_count + rec.approval_count = 0 then
      continue;
    end if;

    -- تذكير واحد فقط في اليوم لكل موظف
    if exists (
      select 1 from public.notifications n
       where n.user_id = rec.uid and n.kind = 'مهمة' and n.title like 'مهام اليوم%'
         and (n.created_at at time zone 'Asia/Baghdad')::date = today
    ) then
      continue;
    end if;

    parts := '{}';
    if rec.late_count > 0 then parts := parts || ('متأخرة: ' || rec.late_count); end if;
    if rec.today_count > 0 then parts := parts || ('اليوم: ' || rec.today_count); end if;
    if rec.upcoming_count > 0 then parts := parts || ('قادمة: ' || rec.upcoming_count); end if;
    if rec.followup_count > 0 then parts := parts || ('متابعات اليوم: ' || rec.followup_count); end if;
    if rec.approval_count > 0 then parts := parts || ('بانتظار موافقتك: ' || rec.approval_count); end if;

    insert into public.notifications (user_id, title, body, link, kind, priority, category, entity_type)
    values (rec.uid, 'مهام اليوم 📋', array_to_string(parts, ' · '), '/dashboard/tasks', 'مهمة',
            case when rec.late_count > 0 then 'عالية' else 'عادية' end, 'مهام', 'task');
    sent := sent + 1;
  end loop;

  return jsonb_build_object('sent', sent, 'date', today);
end $$;
revoke all on function public.tasks_daily_reminder() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 8) وقائع CRM: مهامّ المبيعات وحدها
--    مهمة لها عميل/فرصة، أو قسمها في مساحة المبيعات، أو بلا قسم (كما
--    كان كل شيء قبل V2). مهمة تصميم لا تدخل تقارير أداء المبيعات.
-- ------------------------------------------------------------
create or replace function public.crm_fact_sync_task(p_id uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare k record; d record; emp uuid; t timestamptz; cid uuid;
begin
  select * into k from public.tasks where id = p_id;
  if not found or k.status is distinct from 'منجزة'
     or (k.client_id is null and k.related_client is null and k.opportunity_id is null
         and k.department_id is not null
         and coalesce((select s.workspace from public.task_department_settings(k.department_id) s), 'general') <> 'sales') then
    delete from public.crm_event_facts
     where source_table = 'tasks' and source_id = p_id and event_type = 'task_completed';
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
     project_id, employee_id, owner_id, team_id, source_id_dim, campaign_id,
     lead_created_date, is_backfilled)
  values
    ('tasks', k.id, 'task_completed', t, public.crm_bgd_date(t), cid, k.opportunity_id,
     d.project_id, coalesce(emp, d.owner_id), d.owner_id,
     (select e.project_id from public.employees e where e.id = coalesce(emp, d.owner_id)),
     d.source_id, d.campaign_id, d.lead_created_date, p_backfill)
  on conflict (source_table, source_id, event_type) do update
    set event_at = excluded.event_at, event_date = excluded.event_date, updated_at = now();
end $$;

-- ------------------------------------------------------------
-- 9) الدوال القديمة بمصدرها — نفس التوقيع والسلوك
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
         client_id, related_client, created_by, created_by_name,
         task_type, task_source, created_source, entity_type, entity_id)
      values
        (p_title, 'أُنشئت ضمن إجراء جماعي على ' || array_length(p_client_ids, 1) || ' صفّاً.',
         owner_u, coalesce(p_due_date, public.baghdad_today()), p_priority, 'جديدة',
         cid, cid, auth.uid(), actor,
         'follow_up', 'crm', 'bulk', 'client', cid);
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

create or replace function public.crm_upsert_recontact_task(p_task uuid, p_opp uuid, p_owner uuid, p_date date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.opportunities%rowtype;
  assignee uuid;
  t_id uuid := p_task;
begin
  select * into o from public.opportunities where id = p_opp;
  select e.user_id into assignee from public.employees e where e.id = p_owner;
  assignee := coalesce(assignee, auth.uid());

  if t_id is not null and exists (select 1 from public.tasks where id = t_id and status in ('جديدة', 'قيد التنفيذ')) then
    update public.tasks set due_date = p_date, follow_up_date = p_date where id = t_id;
    return t_id;
  end if;

  insert into public.tasks
    (title, description, assigned_to, due_date, follow_up_date, priority, status,
     client_id, related_client, opportunity_id, next_step,
     task_type, task_source, created_source, entity_type, entity_id)
  values
    ('إعادة تواصل — فرصة خاسرة: ' || coalesce(o.title, 'فرصة'),
     coalesce(p_note, 'موعد إعادة التواصل الذي حُدِّد عند تحليل الخسارة.'),
     assignee, p_date, p_date, 'متوسطة', 'جديدة',
     o.client_id, o.client_id, o.id, 'اتصل بالعميل وقيّم إعادة تنشيط الفرصة',
     'follow_up', 'crm', 'trigger', 'opportunity', o.id)
  returning id into t_id;
  return t_id;
end $$;

notify pgrst, 'reload schema';
