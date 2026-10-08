-- ============================================================
-- تلال ERP — 195: إصلاح task_list — حدّ المعاملات في jsonb_build_object
--
-- ظهر عند أول تشغيل لـ tests.run_tasks_v2() على الحيّ: صفّ المهمة كان
-- يُبنى بـ jsonb_build_object واحد فيه 66 حقلاً = 132 معاملاً، وPostgreSQL
-- لا يقبل أكثر من 100 («cannot pass more than 100 arguments»). فتفشل
-- task_list وكل ما يقرؤها (مركز العمل، التفاصيل، البحث، المساحات).
--
-- الإصلاح: الصفّ ثلاثة أجزاء تُضمّ بـ || — نفس المفاتيح ونفس القيم.
-- لا تغيير في التوقيع ولا في الصلاحيات (create or replace يحفظ المنح).
-- يتطلب: 191. آمن لإعادة التشغيل.
-- ============================================================

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
             'parent_task_id', pg.parent_task_id
           ) || jsonb_build_object(
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
             'version', pg.version
           ) || jsonb_build_object(
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
  'قائمة المهام بترقيم من الخادم (191، 195). INVOKER: RLS تحدّد ما يُرى. {rows, total}.';

notify pgrst, 'reload schema';
