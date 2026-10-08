-- ============================================================
-- تلال ERP — 192: محرّك العمل V2 — المسارات والقوالب والتكرار والأتمتة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 189، 190، 191. ثم 193.
--
-- ===== ما يضيفه =====
--   1) مسارات مزروعة: خطّ المحتوى (فكرة ← … ← منشورة)، طلب تصميم،
--      مراجعة عامة. مهمة في مسار فيه خطوة موافقة تحتاج موافقة.
--   2) الموافقة داخل المسار: الاعتماد يُكمل إلى الخطوة التالية لا إلى
--      «منجزة»، والرفض يعيدها إلى التنفيذ.
--   3) قواعد الإسناد: مستخدم، المنشئ، دور، مدير القسم، مالك الكيان،
--      مديره، دور تسويقي، توزيع دوري، الأقل عبئاً.
--   4) القوالب: مهمة رئيسية + فرعية بإزاحة أيام وتبعيات وقائمة تحقق.
--   5) التكرار: يومي/أسبوعي/شهري/سنوي/كل N يوم — يولَّد ٥:٠٠ بغداد،
--      ومهمة واحدة لكل موعد مهما أُعيد التشغيل.
--   6) الأتمتة: حدث → قاعدة → قالب. الخطافات على الموظفين والحملات
--      والمحتوى، وفحص يومي للفواتير المتأخرة. القواعد مزروعة **معطّلة**.
-- ============================================================

-- ------------------------------------------------------------
-- 1) المسارات المزروعة
-- ------------------------------------------------------------
insert into public.task_workflows (code, name_ar, workspace, description, is_system)
values
  ('content_pipeline', 'خطّ المحتوى', 'marketing',
   'فكرة ← مخطّطة ← قيد التنفيذ ← مراجعة ← معتمدة ← مجدولة ← منشورة ← مكتملة', true),
  ('design_request', 'طلب تصميم', 'marketing',
   'طلب ← قيد التصميم ← مراجعة ← معتمد ← مُسلَّم', true),
  ('general_review', 'تنفيذ ومراجعة', null,
   'جديدة ← قيد التنفيذ ← مراجعة ← منجزة', true)
on conflict (code) do update set name_ar = excluded.name_ar, description = excluded.description;

do $$
declare w uuid;
begin
  select id into w from public.task_workflows where code = 'content_pipeline';
  insert into public.task_workflow_steps (workflow_id, code, name_ar, position, status_map, is_approval, color) values
    (w, 'idea',        'فكرة',        1, 'جديدة',       false, 'gray'),
    (w, 'planned',     'مخطّطة',      2, 'جديدة',       false, 'blue'),
    (w, 'in_progress', 'قيد التنفيذ', 3, 'قيد التنفيذ', false, 'amber'),
    (w, 'review',      'مراجعة',      4, 'قيد التنفيذ', true,  'purple'),
    (w, 'approved',    'معتمدة',      5, 'قيد التنفيذ', false, 'teal'),
    (w, 'scheduled',   'مجدولة',      6, 'قيد التنفيذ', false, 'indigo'),
    (w, 'published',   'منشورة',      7, 'قيد التنفيذ', false, 'green'),
    (w, 'completed',   'مكتملة',      8, 'منجزة',       false, 'green')
  on conflict (workflow_id, code) do nothing;

  select id into w from public.task_workflows where code = 'design_request';
  insert into public.task_workflow_steps (workflow_id, code, name_ar, position, status_map, is_approval, color) values
    (w, 'requested', 'طلب',          1, 'جديدة',       false, 'gray'),
    (w, 'designing', 'قيد التصميم',  2, 'قيد التنفيذ', false, 'amber'),
    (w, 'review',    'مراجعة',       3, 'قيد التنفيذ', true,  'purple'),
    (w, 'approved',  'معتمد',        4, 'قيد التنفيذ', false, 'teal'),
    (w, 'delivered', 'مُسلَّم',      5, 'منجزة',       false, 'green')
  on conflict (workflow_id, code) do nothing;

  select id into w from public.task_workflows where code = 'general_review';
  insert into public.task_workflow_steps (workflow_id, code, name_ar, position, status_map, is_approval, color) values
    (w, 'new',         'جديدة',       1, 'جديدة',       false, 'gray'),
    (w, 'in_progress', 'قيد التنفيذ', 2, 'قيد التنفيذ', false, 'amber'),
    (w, 'review',      'مراجعة',      3, 'قيد التنفيذ', true,  'purple'),
    (w, 'done',        'منجزة',       4, 'منجزة',       false, 'green')
  on conflict (workflow_id, code) do nothing;
end $$;

-- التسويق يفتح مهامه على خطّ المحتوى افتراضياً
update public.department_task_settings s
   set default_workflow_id = (select id from public.task_workflows where code = 'content_pipeline')
  from public.departments d
 where d.id = s.department_id and d.code = 'MKT' and s.default_workflow_id is null;

-- مهمة في مسار فيه خطوة موافقة تحتاج موافقة؛ والمسار الافتراضي للقسم
-- يُطبَّق على المهمة الجديدة إن لم تُحدَّد. (يعمل بعد trg_task_stamp)
create or replace function public.stamp_task_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first uuid;
begin
  if tg_op = 'INSERT' and new.workflow_id is null and new.department_id is not null
     and coalesce(new.task_source, 'manual') in ('manual', 'marketing', 'workflow')
     and new.parent_task_id is null
     and exists (select 1 from public.task_types tt where tt.code = new.task_type and tt.workspace = 'marketing') then
    select s.default_workflow_id into new.workflow_id from public.task_department_settings(new.department_id) s;
    if new.workflow_id is not null then
      select st.id into v_first from public.task_workflow_steps st
       where st.workflow_id = new.workflow_id order by st.position limit 1;
      new.workflow_step_id := v_first;
    end if;
  end if;
  if new.workflow_id is not null
     and (tg_op = 'INSERT' or new.workflow_id is distinct from old.workflow_id)
     and exists (select 1 from public.task_workflow_steps st where st.workflow_id = new.workflow_id and st.is_approval) then
    new.requires_approval := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_task_workflow on public.tasks;
create trigger trg_task_workflow
  before insert or update of workflow_id on public.tasks
  for each row execute function public.stamp_task_workflow();

-- ------------------------------------------------------------
-- 2) الموافقة داخل المسار
-- ------------------------------------------------------------
create or replace function public.task_decide_approval(p_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.task_begin_user_action();
  t      public.tasks%rowtype;
  v_cur  public.task_workflow_steps%rowtype;
  v_next uuid;
  v_back uuid;
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

  select * into v_cur from public.task_workflow_steps where id = t.workflow_step_id;

  if p_approve then
    if v_cur.id is not null and v_cur.is_approval then
      -- في المسار: الاعتماد ينقل إلى الخطوة التالية
      select s.id into v_next from public.task_workflow_steps s
       where s.workflow_id = v_cur.workflow_id and s.position > v_cur.position
       order by s.position limit 1;
      update public.tasks set
        approval_status = 'معتمدة', approved_by = v_uid, approved_at = now(), rejection_reason = null,
        workflow_step_id = coalesce(v_next, workflow_step_id)
       where id = p_id returning * into t;
    else
      update public.tasks set
        approval_status = 'معتمدة', approved_by = v_uid, approved_at = now(), rejection_reason = null,
        status = 'منجزة'
       where id = p_id returning * into t;
    end if;
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'اكتب سبب الرفض كي يعرف المسؤول ما يصلحه.' using errcode = '22023';
    end if;
    if v_cur.id is not null then
      select s.id into v_back from public.task_workflow_steps s
       where s.workflow_id = v_cur.workflow_id and s.position < v_cur.position and s.status_map = 'قيد التنفيذ'
       order by s.position desc limit 1;
    end if;
    update public.tasks set
      approval_status = 'مرفوضة', approved_by = v_uid, approved_at = now(), rejection_reason = btrim(p_reason),
      workflow_step_id = coalesce(v_back, workflow_step_id),
      status = case when v_back is null then 'قيد التنفيذ' else status end
     where id = p_id returning * into t;
  end if;
  return jsonb_build_object('result', case when p_approve then 'approved' else 'rejected' end,
                            'status', t.status, 'version', t.version);
end $$;

-- ------------------------------------------------------------
-- 3) قواعد الإسناد
--    {"kind": "user", "user_id": …}
--    {"kind": "creator"}
--    {"kind": "role", "role_code": "hr_manager"}
--    {"kind": "department_manager", "department_code": "HR"}   (أو department_id، أو قسم السياق)
--    {"kind": "entity_owner"}                                 (مالك العميل/الفرصة/الحملة/المحتوى/الحجز…)
--    {"kind": "manager"}                                      (مدير مالك الكيان أو مدير الموظف)
--    {"kind": "mkt_role", "mkt_role": "مصمّم"}
--    {"kind": "round_robin", "department_code": "SALES-TELE"} (أو user_ids)
--    {"kind": "least_loaded", "department_code": "MKT"}
--    كل قاعدة تقبل "fallback": قاعدة أخرى.
-- ------------------------------------------------------------
create or replace function public.task_rule_candidates(p_rule jsonb, p_ctx jsonb)
returns table (user_id uuid) language plpgsql stable security definer set search_path = public as $$
declare v_dept uuid;
begin
  v_dept := coalesce(
    (select d.id from public.departments d where d.code = p_rule->>'department_code'),
    case when p_rule->>'department_id' ~* '^[0-9a-f-]{36}$' then (p_rule->>'department_id')::uuid end,
    case when p_ctx->>'department_id' ~* '^[0-9a-f-]{36}$' then (p_ctx->>'department_id')::uuid end);

  if jsonb_typeof(p_rule->'user_ids') = 'array' then
    return query
      select e.user_id from public.employees e
       where e.status = 'active' and e.user_id::text in (select jsonb_array_elements_text(p_rule->'user_ids'))
       order by e.full_name;
  elsif v_dept is not null then
    return query
      select e.user_id from public.employees e
       where e.status = 'active' and e.user_id is not null
         and e.department_id in (select d.id from public.department_descendants(v_dept) d)
       order by e.full_name;
  end if;
end $$;

create or replace function public.task_entity_owner_employee(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'client'           then (select c.owner_id from public.clients c where c.id = p_id)
    when 'opportunity'      then (select o.owner_id from public.opportunities o where o.id = p_id)
    when 'employee'         then p_id
    when 'campaign'         then (select cc.owner_employee_id from public.crm_campaigns cc where cc.id = p_id)
    when 'content'          then (select mc.owner_id from public.mkt_content mc where mc.id = p_id)
    when 'reservation'      then (select r.agent_id from public.reservations r where r.id = p_id)
    when 'project'          then (select pr.supervisor_id from public.projects pr where pr.id = p_id)
    when 'lost_sale'        then (select l.owner_id from public.crm_lost_sales l where l.id = p_id)
    when 'invoice'          then (select c.owner_id from public.invoices i join public.clients c on c.id = i.client_id where i.id = p_id)
    when 'employee_expense' then (select x.employee_id from public.employee_expenses x where x.id = p_id)
  end;
$$;

create or replace function public.task_resolve_assignee(p_rule jsonb, p_ctx jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_kind  text := coalesce(p_rule->>'kind', 'creator');
  v_user  uuid;
  v_emp   uuid;
  v_dept  uuid;
  v_key   text;
  v_last  uuid;
  v_list  uuid[];
  v_idx   int;
begin
  if p_rule is null then
    return null;
  end if;

  case v_kind
    when 'user' then
      select e.user_id into v_user from public.employees e
       where e.user_id = case when p_rule->>'user_id' ~* '^[0-9a-f-]{36}$' then (p_rule->>'user_id')::uuid end
         and e.status = 'active';
      if v_user is null and p_rule->>'user_id' ~* '^[0-9a-f-]{36}$' then
        select p.id into v_user from public.profiles p where p.id = (p_rule->>'user_id')::uuid and p.role = 'admin';
      end if;
    when 'creator' then
      v_user := coalesce(case when p_ctx->>'creator' ~* '^[0-9a-f-]{36}$' then (p_ctx->>'creator')::uuid end, auth.uid());
    when 'role' then
      select p.id into v_user
        from public.profiles p
        left join public.employees e on e.user_id = p.id
       where p.role_code = p_rule->>'role_code' and coalesce(e.status, 'active') = 'active'
       order by p.created_at limit 1;
    when 'department_manager' then
      v_dept := coalesce(
        (select d.id from public.departments d where d.code = p_rule->>'department_code'),
        case when p_rule->>'department_id' ~* '^[0-9a-f-]{36}$' then (p_rule->>'department_id')::uuid end,
        case when p_ctx->>'department_id' ~* '^[0-9a-f-]{36}$' then (p_ctx->>'department_id')::uuid end);
      -- أقرب مدير صعوداً في الشجرة
      with recursive up as (
        select d.id, d.parent_id, d.manager_id, 0 as depth from public.departments d where d.id = v_dept
        union all
        select d.id, d.parent_id, d.manager_id, up.depth + 1 from public.departments d join up on d.id = up.parent_id
         where up.depth < 10
      )
      select e.user_id into v_user
        from up join public.employees e on e.id = up.manager_id
       where e.status = 'active' and e.user_id is not null
       order by up.depth limit 1;
    when 'entity_owner' then
      v_emp := public.task_entity_owner_employee(p_ctx->>'entity_type',
                 case when p_ctx->>'entity_id' ~* '^[0-9a-f-]{36}$' then (p_ctx->>'entity_id')::uuid end);
      select e.user_id into v_user from public.employees e where e.id = v_emp and e.status = 'active';
    when 'manager' then
      v_emp := public.task_entity_owner_employee(p_ctx->>'entity_type',
                 case when p_ctx->>'entity_id' ~* '^[0-9a-f-]{36}$' then (p_ctx->>'entity_id')::uuid end);
      select m.user_id into v_user
        from public.employees e join public.employees m on m.id = e.manager_id
       where e.id = v_emp and m.status = 'active';
    when 'mkt_role' then
      select e.user_id into v_user
        from public.mkt_team t join public.employees e on e.id = t.employee_id
       where t.is_active and t.mkt_role = p_rule->>'mkt_role' and e.status = 'active' and e.user_id is not null
       order by (select count(*) from public.tasks x where x.assigned_to = e.user_id and public.task_is_open(x.status)), e.full_name
       limit 1;
    when 'round_robin' then
      select array_agg(c.user_id) into v_list from public.task_rule_candidates(p_rule, p_ctx) c;
      if v_list is not null then
        v_key := coalesce(p_rule->>'key', md5(p_rule::text));
        select last_user into v_last from public.task_assign_cursor where key = v_key for update;
        v_idx := coalesce(array_position(v_list, v_last), 0);
        v_user := v_list[(v_idx % array_length(v_list, 1)) + 1];
        insert into public.task_assign_cursor (key, last_user, updated_at) values (v_key, v_user, now())
        on conflict (key) do update set last_user = excluded.last_user, updated_at = now();
      end if;
    when 'least_loaded' then
      select c.user_id into v_user
        from public.task_rule_candidates(p_rule, p_ctx) c
       order by (select count(*) from public.tasks x where x.assigned_to = c.user_id and public.task_is_open(x.status))
       limit 1;
    else
      v_user := null;
  end case;

  if v_user is null and jsonb_typeof(p_rule->'fallback') = 'object' then
    v_user := public.task_resolve_assignee(p_rule->'fallback', p_ctx);
  end if;
  return v_user;
end $$;
revoke all on function public.task_rule_candidates(jsonb, jsonb)       from public, anon, authenticated;
revoke all on function public.task_entity_owner_employee(text, uuid)   from public, anon, authenticated;
revoke all on function public.task_resolve_assignee(jsonb, jsonb)      from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4) القوالب
-- ------------------------------------------------------------
-- p: title, due_date, priority, assigned_to, department_id, entity_type,
--    entity_id, client_id, opportunity_id, project_id, campaign_id,
--    assign_rule (يغلب قاعدة القالب)، recurrence_id، recurrence_date،
--    task_source، created_source، creator.
-- p_system: من الأتمتة والتكرار — بلا فحص صلاحية المستخدم.
create or replace function public.task_from_template_internal(p_template uuid, p jsonb, p_system boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tpl      public.task_templates%rowtype;
  it       record;
  v_uid    uuid := auth.uid();
  v_creator uuid;
  v_base   date;
  v_parent uuid;
  v_task   uuid;
  v_assign uuid;
  v_dept   uuid;
  v_ctx    jsonb;
  v_map    jsonb := '{}'::jsonb;    -- position → task id
  v_step   uuid;
  v_src    text;
  v_csrc   text;
  v_item   text;
  v_people uuid[] := '{}';
  v_count  int := 0;
  u        uuid;
begin
  select * into tpl from public.task_templates where id = p_template;
  if tpl.id is null or not tpl.is_active then
    raise exception 'القالب غير موجود أو معطّل.' using errcode = 'P0002';
  end if;

  v_creator := coalesce(case when p->>'creator' ~* '^[0-9a-f-]{36}$' then (p->>'creator')::uuid end, v_uid);
  if not p_system and v_uid is null then
    raise exception 'سجّل الدخول أولاً.' using errcode = '42501';
  end if;

  v_base := coalesce(case when p->>'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'due_date')::date end,
                     public.baghdad_today() + tpl.due_offset_days);
  v_dept := coalesce(case when p->>'department_id' ~* '^[0-9a-f-]{36}$' then (p->>'department_id')::uuid end,
                     tpl.department_id);
  v_src  := coalesce(nullif(p->>'task_source', ''), case when p_system then 'automation' else 'manual' end);
  v_csrc := coalesce(nullif(p->>'created_source', ''), case when p_system then 'automation' else 'template' end);

  if nullif(p->>'entity_type', '') is not null and not p_system
     and not public.task_entity_linkable(p->>'entity_type', (p->>'entity_id')::uuid) then
    raise exception 'الكيان المرتبط غير موجود أو خارج نطاقك.' using errcode = '42501';
  end if;

  v_ctx := jsonb_build_object('creator', v_creator, 'department_id', v_dept,
                              'entity_type', p->>'entity_type', 'entity_id', p->>'entity_id');

  -- إشعار واحد لكل مسؤول بدل إشعار لكل مهمة
  perform set_config('tilal.quiet_task_notify', 'on', true);

  -- ===== المهمة الرئيسية =====
  v_assign := coalesce(
    case when p->>'assigned_to' ~* '^[0-9a-f-]{36}$' then (p->>'assigned_to')::uuid end,
    public.task_resolve_assignee(coalesce(p->'assign_rule', tpl.assign_rule), v_ctx),
    v_creator);
  if not p_system and not public.can_assign_task_to(v_assign) then
    v_assign := v_uid;
  end if;
  if v_assign is null then
    raise exception 'تعذّر تحديد مسؤول للمهمة — راجع قاعدة الإسناد في القالب.' using errcode = '22023';
  end if;

  if tpl.workflow_id is not null then
    select s.id into v_step from public.task_workflow_steps s where s.workflow_id = tpl.workflow_id order by s.position limit 1;
  end if;

  insert into public.tasks (
    title, description, priority, status, assigned_to, created_by, due_date,
    department_id, task_type, task_source, created_source, template_id,
    entity_type, entity_id, client_id, opportunity_id, project_id, campaign_id,
    estimated_minutes, requires_approval, workflow_id, workflow_step_id,
    recurrence_id, recurrence_date)
  values (
    coalesce(nullif(btrim(p->>'title'), ''), tpl.name_ar), tpl.description,
    coalesce(nullif(p->>'priority', ''), tpl.default_priority), 'جديدة', v_assign, v_creator, v_base,
    v_dept, tpl.task_type, v_src, v_csrc, tpl.id,
    nullif(p->>'entity_type', ''), case when p->>'entity_id' ~* '^[0-9a-f-]{36}$' then (p->>'entity_id')::uuid end,
    case when p->>'client_id' ~* '^[0-9a-f-]{36}$' then (p->>'client_id')::uuid end,
    case when p->>'opportunity_id' ~* '^[0-9a-f-]{36}$' then (p->>'opportunity_id')::uuid end,
    case when p->>'project_id' ~* '^[0-9a-f-]{36}$' then (p->>'project_id')::uuid end,
    case when p->>'campaign_id' ~* '^[0-9a-f-]{36}$' then (p->>'campaign_id')::uuid end,
    tpl.estimated_minutes, tpl.requires_approval, tpl.workflow_id, v_step,
    case when p->>'recurrence_id' ~* '^[0-9a-f-]{36}$' then (p->>'recurrence_id')::uuid end,
    case when p->>'recurrence_date' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'recurrence_date')::date end)
  returning id into v_parent;
  v_people := v_people || v_assign;
  v_count := 1;

  foreach v_item in array tpl.checklist loop
    if coalesce(btrim(v_item), '') <> '' then
      insert into public.task_checklist_items (task_id, body) values (v_parent, v_item);
    end if;
  end loop;

  -- ===== البنود الفرعية =====
  for it in select * from public.task_template_items i where i.template_id = tpl.id order by i.position loop
    v_assign := coalesce(public.task_resolve_assignee(it.assign_rule, v_ctx),
                         (select x.assigned_to from public.tasks x where x.id = v_parent));
    if not p_system and not public.can_assign_task_to(v_assign) then
      v_assign := v_uid;
    end if;

    v_step := null;
    if tpl.workflow_id is not null and it.workflow_step_code is not null then
      select s.id into v_step from public.task_workflow_steps s
       where s.workflow_id = tpl.workflow_id and s.code = it.workflow_step_code;
    end if;

    insert into public.tasks (
      title, description, priority, status, assigned_to, created_by, due_date,
      department_id, task_type, task_source, created_source, template_id, parent_task_id,
      entity_type, entity_id, client_id, opportunity_id, project_id, campaign_id,
      estimated_minutes, requires_approval, workflow_id, workflow_step_id)
    select
      it.title, it.description, coalesce(it.priority, tpl.default_priority), 'جديدة', v_assign, v_creator,
      v_base + it.offset_days,
      x.department_id, coalesce(it.task_type, tpl.task_type), v_src, v_csrc, tpl.id, v_parent,
      x.entity_type, x.entity_id, x.client_id, x.opportunity_id, x.project_id, x.campaign_id,
      it.estimated_minutes, it.requires_approval,
      case when v_step is not null then tpl.workflow_id end, v_step
      from public.tasks x where x.id = v_parent
    returning id into v_task;

    v_map := v_map || jsonb_build_object(it.position::text, v_task);
    if not (v_assign = any (v_people)) then v_people := v_people || v_assign; end if;
    v_count := v_count + 1;

    foreach v_item in array it.checklist loop
      if coalesce(btrim(v_item), '') <> '' then
        insert into public.task_checklist_items (task_id, body) values (v_task, v_item);
      end if;
    end loop;

    if it.depends_on_position is not null and v_map ? it.depends_on_position::text then
      insert into public.task_dependencies (task_id, depends_on_id, is_blocking)
      values (v_task, (v_map->>it.depends_on_position::text)::uuid, true)
      on conflict do nothing;
    end if;
  end loop;

  perform set_config('tilal.quiet_task_notify', '', true);
  foreach u in array v_people loop
    perform public.task_notify(u, 'مهام جديدة من قالب «' || tpl.name_ar || '»',
      (select count(*) from public.tasks x where (x.id = v_parent or x.parent_task_id = v_parent) and x.assigned_to = u)
        || ' مهمة — ' || coalesce(nullif(btrim(p->>'title'), ''), tpl.name_ar),
      v_parent);
  end loop;

  return v_parent;
end $$;
revoke all on function public.task_from_template_internal(uuid, jsonb, boolean) from public, anon, authenticated;

-- الواجهة: استعمال قالب
create or replace function public.task_template_apply(p_template uuid, p jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.task_begin_user_action();
  if public.is_broker() then
    raise exception 'المهام غير متاحة لحساب الوسيط.' using errcode = '42501';
  end if;
  return public.task_from_template_internal(p_template,
    (p - 'task_source' - 'created_source' - 'recurrence_id' - 'recurrence_date' - 'creator'), false);
end $$;
revoke all on function public.task_template_apply(uuid, jsonb) from public, anon;
grant execute on function public.task_template_apply(uuid, jsonb) to authenticated;

-- القوالب المزروعة
do $$
declare
  v_mkt uuid := (select id from public.departments where code = 'MKT');
  v_hr  uuid := (select id from public.departments where code = 'HR');
  v_fin uuid := (select id from public.departments where code = 'FIN');
  v_wf  uuid := (select id from public.task_workflows where code = 'content_pipeline');
  t uuid;
begin
  -- فيديو تسويقي
  insert into public.task_templates (code, name_ar, description, workspace, department_id, task_type, default_priority,
                                     due_offset_days, workflow_id, assign_rule, checklist)
  values ('marketing_video', 'فيديو تسويقي', 'سيناريو ← تصوير ← مونتاج ← تصميم ← مراجعة ← نشر ← تعزيز ← تقرير',
          'marketing', v_mkt, 'video', 'متوسطة', 14, v_wf,
          '{"kind": "mkt_role", "mkt_role": "مدير التسويق", "fallback": {"kind": "creator"}}',
          array['تحديد الهدف والجمهور', 'اعتماد الميزانية'])
  on conflict (code) do nothing returning id into t;
  if t is not null then
    insert into public.task_template_items (template_id, position, title, task_type, offset_days, assign_rule, depends_on_position, checklist) values
      (t, 1, 'كتابة السيناريو', 'copywriting', 0,  '{"kind": "mkt_role", "mkt_role": "كاتب محتوى"}', null, array['الفكرة', 'النصّ', 'الدعوة للإجراء']),
      (t, 2, 'التصوير',         'photography', 3,  '{"kind": "mkt_role", "mkt_role": "مصوّر"}',      1,    array['الموقع', 'المعدات', 'اللقطات']),
      (t, 3, 'المونتاج',         'video',       6,  '{"kind": "mkt_role", "mkt_role": "مونتير"}',     2,    '{}'),
      (t, 4, 'التصاميم المصاحبة', 'design',      6,  '{"kind": "mkt_role", "mkt_role": "مصمّم"}',      1,    '{}'),
      (t, 5, 'المراجعة والاعتماد', 'approval',    8,  '{"kind": "mkt_role", "mkt_role": "مدير التسويق"}', 3,  '{}'),
      (t, 6, 'النشر',            'publishing',  9,  '{"kind": "mkt_role", "mkt_role": "مدير منصّات"}', 5,   '{}'),
      (t, 7, 'التعزيز الإعلاني',  'media_buying', 10, '{"kind": "mkt_role", "mkt_role": "مشتري إعلانات"}', 6, '{}'),
      (t, 8, 'تقرير الأداء',      'reporting',   17, '{"kind": "mkt_role", "mkt_role": "أخصائي تسويق"}', 7, '{}');
  end if;

  -- إطلاق حملة
  t := null;
  insert into public.task_templates (code, name_ar, description, workspace, department_id, task_type, default_priority,
                                     due_offset_days, assign_rule)
  values ('campaign_launch', 'إطلاق حملة', 'الخطة ← المحتوى ← التصاميم ← الإعداد الإعلاني ← المراجعة ← الإطلاق ← تقرير الأسبوع الأول',
          'marketing', v_mkt, 'campaign', 'متوسطة', 21,
          '{"kind": "entity_owner", "fallback": {"kind": "creator"}}')
  on conflict (code) do nothing returning id into t;
  if t is not null then
    insert into public.task_template_items (template_id, position, title, task_type, offset_days, assign_rule, depends_on_position) values
      (t, 1, 'خطة الحملة والرسائل',  'campaign',      0,  null, null),
      (t, 2, 'المحتوى',              'content',       5,  '{"kind": "mkt_role", "mkt_role": "كاتب محتوى"}', 1),
      (t, 3, 'التصاميم',             'design',        8,  '{"kind": "mkt_role", "mkt_role": "مصمّم"}', 2),
      (t, 4, 'الإعداد الإعلاني',      'media_buying',  10, '{"kind": "mkt_role", "mkt_role": "مشتري إعلانات"}', 3),
      (t, 5, 'المراجعة',             'approval',      12, '{"kind": "mkt_role", "mkt_role": "مدير التسويق"}', 4),
      (t, 6, 'الإطلاق',              'publishing',    14, null, 5),
      (t, 7, 'تقرير الأسبوع الأول',   'reporting',     21, '{"kind": "mkt_role", "mkt_role": "أخصائي تسويق"}', 6);
  end if;

  -- تقرير التسويق الأسبوعي (يصلح للتكرار)
  insert into public.task_templates (code, name_ar, workspace, department_id, task_type, default_priority, assign_rule, checklist)
  values ('weekly_marketing_report', 'تقرير التسويق الأسبوعي', 'marketing', v_mkt, 'reporting', 'متوسطة',
          '{"kind": "mkt_role", "mkt_role": "أخصائي تسويق", "fallback": {"kind": "creator"}}',
          array['الليدات والتكلفة', 'أداء الحملات', 'المحتوى المنشور', 'التوصيات'])
  on conflict (code) do nothing;

  -- تهيئة موظف جديد
  t := null;
  insert into public.task_templates (code, name_ar, description, workspace, department_id, task_type, default_priority,
                                     due_offset_days, assign_rule)
  values ('new_employee_onboarding', 'تهيئة موظف جديد', 'المستندات ← العقد ← الحساب ← العهدة ← التعريف ← التدريب ← مراجعة ٣٠ يوماً',
          'hr', v_hr, 'onboarding', 'متوسطة', 30,
          '{"kind": "role", "role_code": "hr_manager", "fallback": {"kind": "department_manager", "department_code": "HR", "fallback": {"kind": "creator"}}}')
  on conflict (code) do nothing returning id into t;
  if t is not null then
    insert into public.task_template_items (template_id, position, title, task_type, offset_days, assign_rule, depends_on_position, checklist) values
      (t, 1, 'جمع المستندات',             'documents',          0,  null, null, array['الهوية', 'الشهادات', 'الصور', 'معلومات البنك']),
      (t, 2, 'توقيع العقد',               'contract',           1,  null, 1,    '{}'),
      (t, 3, 'إنشاء البريد وحساب ERP',     'administrative',     1,  null, null, '{}'),
      (t, 4, 'تجهيز مكان العمل والعهدة',   'administrative',     2,  null, null, array['المكتب', 'الجهاز', 'الهاتف']),
      (t, 5, 'التعريف بالقسم والمدير',     'onboarding',         3,  '{"kind": "manager", "fallback": {"kind": "department_manager"}}', 3, '{}'),
      (t, 6, 'التدريب الأولي',             'training',           7,  '{"kind": "manager", "fallback": {"kind": "department_manager"}}', 5, '{}'),
      (t, 7, 'مراجعة ٣٠ يوماً',            'performance_review', 30, '{"kind": "manager", "fallback": {"kind": "department_manager"}}', 6, '{}');
  end if;

  -- إنهاء خدمة
  t := null;
  insert into public.task_templates (code, name_ar, workspace, department_id, task_type, default_priority, due_offset_days, assign_rule)
  values ('employee_offboarding', 'إنهاء خدمة موظف', 'hr', v_hr, 'offboarding', 'متوسطة', 7,
          '{"kind": "role", "role_code": "hr_manager", "fallback": {"kind": "department_manager", "department_code": "HR", "fallback": {"kind": "creator"}}}')
  on conflict (code) do nothing returning id into t;
  if t is not null then
    insert into public.task_template_items (template_id, position, title, task_type, offset_days, assign_rule, depends_on_position) values
      (t, 1, 'تسليم المهام والعملاء',  'offboarding',    0, '{"kind": "manager", "fallback": {"kind": "department_manager"}}', null),
      (t, 2, 'استلام العهد',           'administrative', 2, null, null),
      (t, 3, 'إغلاق الحسابات',          'administrative', 3, null, 1),
      (t, 4, 'مقابلة الخروج',          'hr_request',     3, null, null),
      (t, 5, 'التسوية المالية',         'payment_request', 7, '{"kind": "role", "role_code": "finance_manager", "fallback": {"kind": "creator"}}', 2);
  end if;

  -- تحصيل فاتورة متأخرة
  t := null;
  insert into public.task_templates (code, name_ar, workspace, department_id, task_type, default_priority, due_offset_days, assign_rule)
  values ('invoice_collection', 'تحصيل فاتورة متأخرة', 'accounting', v_fin, 'collection', 'عاجلة', 3,
          '{"kind": "entity_owner", "fallback": {"kind": "role", "role_code": "finance_manager", "fallback": {"kind": "role", "role_code": "accountant"}}}')
  on conflict (code) do nothing returning id into t;
  if t is not null then
    insert into public.task_template_items (template_id, position, title, task_type, offset_days, assign_rule, depends_on_position) values
      (t, 1, 'الاتصال بالعميل',      'call',             0, null, null),
      (t, 2, 'إرسال تذكير مكتوب',    'payment_followup', 1, null, 1),
      (t, 3, 'تسجيل الدفعة أو التصعيد', 'collection',    3, '{"kind": "role", "role_code": "finance_manager", "fallback": {"kind": "role", "role_code": "accountant"}}', 2);
  end if;

  -- الإقفال الشهري
  insert into public.task_templates (code, name_ar, workspace, department_id, task_type, default_priority, due_offset_days, assign_rule, checklist)
  values ('monthly_closing', 'الإقفال الشهري', 'accounting', v_fin, 'monthly_closing', 'متوسطة', 5,
          '{"kind": "role", "role_code": "finance_manager", "fallback": {"kind": "role", "role_code": "accountant", "fallback": {"kind": "creator"}}}',
          array['مطابقة البنوك', 'مراجعة القيود المعلّقة', 'ترحيل الرواتب', 'العمولات المستحقة', 'التقارير المالية', 'إقفال الفترة'])
  on conflict (code) do nothing;
end $$;

-- ------------------------------------------------------------
-- 5) التكرار
-- ------------------------------------------------------------
-- الموعد التالي بعد تاريخ (أو null إن انتهى)
create or replace function public.task_recurrence_next(
  p_freq text, p_interval int, p_weekdays int[], p_month_day int,
  p_start date, p_end date, p_after date
) returns date language plpgsql immutable set search_path = public as $$
declare
  v_d    date;
  v_k    int;
  v_n    int := greatest(coalesce(p_interval, 1), 1);
  v_from date := greatest(p_after + 1, p_start);
  v_days int[] := coalesce(nullif(p_weekdays, '{}'), array[extract(dow from p_start)::int]);
  v_week0 date := p_start - extract(dow from p_start)::int;
  v_day  int := coalesce(p_month_day, extract(day from p_start)::int);
  v_month date;
begin
  if p_freq in ('daily', 'custom_days') then
    v_d := p_start + (ceil(greatest(v_from - p_start, 0)::numeric / v_n) * v_n)::int;
  elsif p_freq = 'weekly' then
    v_d := null;
    for i in 0 .. (7 * v_n * 2 + 7) loop
      if extract(dow from v_from + i)::int = any (v_days)
         and (((v_from + i) - v_week0) / 7) % v_n = 0 then
        v_d := v_from + i;
        exit;
      end if;
    end loop;
  elsif p_freq in ('monthly', 'yearly') then
    if p_freq = 'yearly' then v_n := v_n * 12; end if;
    v_d := null;
    for v_k in 0 .. 1200 loop
      v_month := (date_trunc('month', p_start) + make_interval(months => v_k * v_n))::date;
      v_d := least(v_month + (v_day - 1), (v_month + interval '1 month' - interval '1 day')::date);
      exit when v_d >= v_from;
      v_d := null;
    end loop;
  end if;
  if v_d is null or (p_end is not null and v_d > p_end) then
    return null;
  end if;
  return v_d;
end $$;

grant execute on function public.task_recurrence_next(text, int, int[], int, date, date, date) to authenticated;

create or replace function public.stamp_task_recurrence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  if tg_op = 'INSERT'
     or (new.frequency, new.interval_n, new.weekdays, new.month_day, new.start_on, new.end_on)
        is distinct from (old.frequency, old.interval_n, old.weekdays, old.month_day, old.start_on, old.end_on) then
    new.next_run_on := public.task_recurrence_next(new.frequency, new.interval_n, new.weekdays, new.month_day,
                         new.start_on, new.end_on, greatest(coalesce(new.last_run_on, new.start_on - 1),
                                                            public.baghdad_today() - 1));
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_task_recurrence_stamp on public.task_recurrences;
create trigger trg_task_recurrence_stamp
  before insert or update on public.task_recurrences
  for each row execute function public.stamp_task_recurrence();

-- المولّد: مهمة واحدة لآخر موعد مستحق (لا تراكم للأيام الفائتة)، والفهرس
-- الفريد (recurrence_id, recurrence_date) يمنع التكرار عند إعادة التشغيل.
create or replace function public.task_generate_recurring(p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_date, public.baghdad_today());
  r       public.task_recurrences%rowtype;
  v_occ   date;
  v_nxt   date;
  v_assign uuid;
  v_made  int := 0;
  v_id    uuid;
begin
  for r in
    select * from public.task_recurrences
     where is_active and next_run_on is not null and next_run_on <= v_today
     for update skip locked
  loop
    begin
      v_occ := r.next_run_on;
      loop
        v_nxt := public.task_recurrence_next(r.frequency, r.interval_n, r.weekdays, r.month_day, r.start_on, r.end_on, v_occ);
        exit when v_nxt is null or v_nxt > v_today;
        v_occ := v_nxt;
      end loop;

      if not exists (select 1 from public.tasks t where t.recurrence_id = r.id and t.recurrence_date = v_occ) then
        if r.template_id is not null then
          v_id := public.task_from_template_internal(r.template_id, jsonb_build_object(
            'title', r.title, 'due_date', v_occ + r.due_offset_days, 'priority', r.priority,
            'assigned_to', r.assigned_to, 'assign_rule', r.assign_rule, 'department_id', r.department_id,
            'project_id', r.project_id, 'campaign_id', r.campaign_id, 'creator', r.created_by,
            'recurrence_id', r.id, 'recurrence_date', v_occ,
            'task_source', 'recurring', 'created_source', 'recurrence'), true);
        else
          v_assign := coalesce(r.assigned_to,
                               public.task_resolve_assignee(r.assign_rule,
                                 jsonb_build_object('creator', r.created_by, 'department_id', r.department_id)),
                               r.created_by);
          insert into public.tasks (title, description, priority, status, assigned_to, created_by, due_date,
                                    department_id, task_type, task_source, created_source, project_id, campaign_id,
                                    recurrence_id, recurrence_date)
          values (r.title, r.description, r.priority, 'جديدة', v_assign, r.created_by, v_occ + r.due_offset_days,
                  r.department_id, r.task_type, 'recurring', 'recurrence', r.project_id, r.campaign_id,
                  r.id, v_occ)
          on conflict (recurrence_id, recurrence_date) where recurrence_id is not null do nothing;
        end if;
        v_made := v_made + 1;
      end if;

      v_nxt := public.task_recurrence_next(r.frequency, r.interval_n, r.weekdays, r.month_day, r.start_on, r.end_on, v_occ);
      update public.task_recurrences
         set last_run_on = v_occ, next_run_on = v_nxt, is_active = (v_nxt is not null)
       where id = r.id;
    exception when others then
      raise warning 'task_generate_recurring: % — %', r.id, sqlerrm;
    end;
  end loop;
  return v_made;
end $$;
revoke all on function public.task_generate_recurring(date) from public, anon, authenticated;
grant execute on function public.task_generate_recurring(date) to service_role;

-- قبل التذكير اليومي (٦:٠٠ UTC) بساعة: ٥:٠٠ بغداد
select cron.unschedule('tasks-recurring')
 where exists (select 1 from cron.job where jobname = 'tasks-recurring');
select cron.schedule('tasks-recurring', '0 2 * * *', $cron$ select public.task_generate_recurring(); $cron$);

-- ------------------------------------------------------------
-- 6) الأتمتة: حدث → قاعدة → قالب
-- ------------------------------------------------------------
create or replace function public.task_emit_event(
  p_event text, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_key text default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  r      public.task_automation_rules%rowtype;
  v_key  text := coalesce(p_key, p_event || ':' || coalesce(p_entity_id::text, ''));
  v_run  uuid;
  v_task uuid;
  v_made int := 0;
  v_dept uuid;
begin
  for r in
    select * from public.task_automation_rules
     where is_active and event = p_event and coalesce(p_payload, '{}'::jsonb) @> conditions
  loop
    insert into public.task_automation_runs (rule_id, event_key, entity_type, entity_id)
    values (r.id, v_key, p_entity_type, p_entity_id)
    on conflict (rule_id, event_key) do nothing
    returning id into v_run;
    continue when v_run is null;      -- شُغّل من قبل: لا تكرار

    begin
      v_dept := case when p_payload->>'department_id' ~* '^[0-9a-f-]{36}$' then (p_payload->>'department_id')::uuid end;
      v_task := public.task_from_template_internal(r.template_id, jsonb_strip_nulls(jsonb_build_object(
        'title', p_payload->>'title',
        'entity_type', p_entity_type, 'entity_id', p_entity_id,
        'client_id', p_payload->>'client_id', 'project_id', p_payload->>'project_id',
        'campaign_id', p_payload->>'campaign_id', 'assign_rule', r.assign_rule,
        'creator', coalesce(auth.uid()::text, r.created_by::text),
        'task_source', 'automation', 'created_source', 'automation')), true);
      update public.task_automation_runs set task_id = v_task, status = 'ok' where id = v_run;
      v_made := v_made + 1;
    exception when others then
      update public.task_automation_runs set status = 'error', error = left(sqlerrm, 500) where id = v_run;
    end;
  end loop;
  return v_made;
end $$;
revoke all on function public.task_emit_event(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.task_emit_event(text, text, uuid, jsonb, text) to service_role;

-- الخطافات — لا تُفشل المعاملة الأصلية أبداً
create or replace function public.task_hook_employee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.task_emit_event('employee.created', 'employee', new.id, jsonb_build_object(
        'title', 'تهيئة: ' || new.full_name,
        'department_code', (select d.code from public.departments d where d.id = new.department_id),
        'employment_type', new.employment_type));
    elsif old.status = 'active' and new.status <> 'active' then
      perform public.task_emit_event('employee.ended', 'employee', new.id, jsonb_build_object(
        'title', 'إنهاء خدمة: ' || new.full_name,
        'department_code', (select d.code from public.departments d where d.id = new.department_id)));
    end if;
  exception when others then
    raise warning 'task_hook_employee: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_task_hook_employee on public.employees;
create trigger trg_task_hook_employee
  after insert or update of status on public.employees
  for each row execute function public.task_hook_employee();

create or replace function public.task_hook_campaign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.task_emit_event('campaign.created', 'campaign', new.id, jsonb_build_object(
      'title', 'إطلاق حملة: ' || new.name, 'campaign_type', new.campaign_type,
      'campaign_id', new.id, 'project_id', new.project_id));
  exception when others then
    raise warning 'task_hook_campaign: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_task_hook_campaign on public.crm_campaigns;
create trigger trg_task_hook_campaign
  after insert on public.crm_campaigns
  for each row execute function public.task_hook_campaign();

create or replace function public.task_hook_content()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.task_emit_event('content.created', 'content', new.id, jsonb_build_object(
      'title', 'محتوى: ' || new.title, 'content_type', new.content_type,
      'campaign_id', new.campaign_id, 'project_id', new.project_id));
  exception when others then
    raise warning 'task_hook_content: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_task_hook_content on public.mkt_content;
create trigger trg_task_hook_content
  after insert on public.mkt_content
  for each row execute function public.task_hook_content();

-- فحص يومي: فواتير العملاء المتأخرة غير المسدّدة (حدث واحد لكل فاتورة)
create or replace function public.task_scan_events()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.baghdad_today();
  r record;
  n int := 0;
begin
  if not exists (select 1 from public.task_automation_rules where is_active and event = 'invoice.overdue') then
    return 0;
  end if;
  for r in
    select i.id, i.invoice_number, i.client_id, c.name as client_name,
           i.total_amount - coalesce((select sum(pm.amount) from public.payments pm where pm.invoice_id = i.id), 0) as due
      from public.invoices i
      left join public.clients c on c.id = i.client_id
     where i.cancelled_at is null and i.due_date < v_today
  loop
    continue when r.due <= 0;
    n := n + public.task_emit_event('invoice.overdue', 'invoice', r.id, jsonb_build_object(
      'title', 'تحصيل الفاتورة ' || coalesce(r.invoice_number, '') || coalesce(' — ' || r.client_name, ''),
      'client_id', r.client_id, 'amount_due', r.due));
  end loop;
  return n;
end $$;
revoke all on function public.task_scan_events() from public, anon, authenticated;
grant execute on function public.task_scan_events() to service_role;

select cron.unschedule('tasks-event-scan')
 where exists (select 1 from cron.job where jobname = 'tasks-event-scan');
select cron.schedule('tasks-event-scan', '30 2 * * *', $cron$ select public.task_scan_events(); $cron$);

-- القواعد المزروعة — **معطّلة**: التهيئة لها اليوم onboarding_tasks (151)،
-- وتفعيل قاعدة التهيئة قبل قرار المالك يكرّر العمل.
insert into public.task_automation_rules (code, name_ar, event, template_id, is_active, description)
select v.code, v.name_ar, v.event, t.id, false, v.description
  from (values
    ('onboarding_on_hire',  'تهيئة كل موظف جديد',       'employee.created', 'new_employee_onboarding',
     'تنشئ مهام التهيئة حين يُضاف موظف. معطّلة لأن onboarding_tasks (151) يغطي التهيئة اليوم.'),
    ('offboarding_on_exit', 'إنهاء خدمة عند خروج موظف', 'employee.ended',   'employee_offboarding',
     'تنشئ مهام إنهاء الخدمة حين تتغيّر حالة الموظف من نشط.'),
    ('campaign_launch',     'خطة إطلاق لكل حملة',        'campaign.created', 'campaign_launch',
     'تنشئ مهام الإطلاق مسندة لمالك الحملة.'),
    ('invoice_collection',  'تحصيل الفواتير المتأخرة',   'invoice.overdue',  'invoice_collection',
     'الفحص اليومي ٥:٣٠ بغداد ينشئ مهمة تحصيل واحدة لكل فاتورة متأخرة غير مسدّدة.')
  ) v(code, name_ar, event, tpl_code, description)
  join public.task_templates t on t.code = v.tpl_code
on conflict (code) do nothing;

notify pgrst, 'reload schema';
