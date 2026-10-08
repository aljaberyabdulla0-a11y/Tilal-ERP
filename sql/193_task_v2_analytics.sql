-- ============================================================
-- تلال ERP — 193: محرّك العمل V2 — التقارير والعبء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 189–192. ثم 194 (الاختبارات).
--
-- كل الدوال هنا INVOKER: RLS على tasks تحدّد ما يدخل الحساب، فالموظف
-- يرى أرقام مهامه، والمشرف فريقه، ومدير القسم قسمه، والمدير الكل —
-- بنفس الدالة. لا «إنتاجية» مطلقة: أرقام موضوعية فقط (عدد، نسبة،
-- متوسط زمن، تأخير).
-- ============================================================

-- تحويل آمن: نصّ غير صالح ← null (لا خطأ ولا تقييم مبكّر للتحويل)
create or replace function public.task_try_uuid(p text)
returns uuid language plpgsql immutable set search_path = public as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p::uuid;
end $$;
grant execute on function public.task_try_uuid(text) to authenticated;

-- مرشّحات مشتركة: department_id (مع الفروع)، assigned_to، project_id،
-- task_source[]، task_type[]
create or replace function public.task_report_filter_ok(t public.tasks, p jsonb, p_depts uuid[])
returns boolean language sql stable set search_path = public as $$
  select (p_depts is null or t.department_id = any (p_depts))
     and (public.task_try_uuid(p->>'assigned_to') is null or t.assigned_to = public.task_try_uuid(p->>'assigned_to'))
     and (public.task_try_uuid(p->>'project_id') is null or t.project_id = public.task_try_uuid(p->>'project_id'))
     and (jsonb_typeof(p->'task_source') is distinct from 'array' or jsonb_array_length(p->'task_source') = 0
          or t.task_source in (select jsonb_array_elements_text(p->'task_source')))
     and (jsonb_typeof(p->'task_type') is distinct from 'array' or jsonb_array_length(p->'task_type') = 0
          or t.task_type in (select jsonb_array_elements_text(p->'task_type')));
$$;

-- الأداء في مدة: منشأة، منجزة، ملغاة، متأخرة الآن، في الموعد، متوسط
-- زمن الإنجاز والتأخير، خرق SLA — ثم التفصيل حسب القسم والموظف والمصدر
-- والأولوية والنوع والمشروع.
create or replace function public.task_overview(p_from date, p_to date, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_today date := public.baghdad_today();
  v_from  date := coalesce(p_from, public.baghdad_today() - 30);
  v_to    date := coalesce(p_to, public.baghdad_today());
  v_depts uuid[];
  v_out   jsonb;
begin
  if auth.uid() is null then return null; end if;
  if p->>'department_id' ~* '^[0-9a-f-]{36}$' then
    select array_agg(d.id) into v_depts from public.department_descendants((p->>'department_id')::uuid) d;
  end if;

  with t as (
    select x.*,
           (x.created_at at time zone 'Asia/Baghdad')::date   as c_day,
           (x.completed_at at time zone 'Asia/Baghdad')::date as d_day,
           (x.cancelled_at at time zone 'Asia/Baghdad')::date as x_day,
           public.task_is_open(x.status) as is_open
      from public.tasks x
     where public.task_report_filter_ok(x, coalesce(p, '{}'::jsonb), v_depts)
  ), m as (
    select t.*,
           (t.c_day between v_from and v_to) as in_created,
           (t.status = 'منجزة' and t.d_day between v_from and v_to) as in_done,
           (t.status = 'ملغاة' and t.x_day between v_from and v_to) as in_cancel
      from t
  ), totals as (
    select jsonb_build_object(
      'created',   count(*) filter (where in_created),
      'completed', count(*) filter (where in_done),
      'cancelled', count(*) filter (where in_cancel),
      'open_now',  count(*) filter (where is_open),
      'overdue_now', count(*) filter (where is_open and due_date < v_today),
      'on_time',   count(*) filter (where in_done and due_date is not null and d_day <= due_date),
      'late_done', count(*) filter (where in_done and due_date is not null and d_day > due_date),
      'avg_completion_hours', round((avg(extract(epoch from (completed_at - created_at)) / 3600)
                                      filter (where in_done))::numeric, 1),
      'avg_delay_days', round((avg(d_day - due_date) filter (where in_done and due_date is not null and d_day > due_date))::numeric, 1),
      'sla_breaches', count(*) filter (where deadline_at is not null
                                       and ((is_open and deadline_at < now())
                                            or (in_done and completed_at > deadline_at)))) as j
      from m
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'totals', (select j from totals),
    'by_department', coalesce((
      select jsonb_agg(x order by (x->>'open')::int desc, x->>'name') from (
        select jsonb_build_object(
          'id', m.department_id, 'name', coalesce(d.name_ar, 'بلا قسم'),
          'created', count(*) filter (where in_created),
          'completed', count(*) filter (where in_done),
          'open', count(*) filter (where is_open),
          'overdue', count(*) filter (where is_open and due_date < v_today),
          'sla_breaches', count(*) filter (where deadline_at is not null and is_open and deadline_at < now())) x
          from m left join public.departments d on d.id = m.department_id
         group by m.department_id, d.name_ar) q), '[]'::jsonb),
    'by_employee', coalesce((
      select jsonb_agg(x order by (x->>'overdue')::int desc, (x->>'open')::int desc) from (
        select jsonb_build_object(
          'user_id', m.assigned_to, 'name', max(m.assigned_to_name),
          'assigned', count(*) filter (where in_created),
          'completed', count(*) filter (where in_done),
          'open', count(*) filter (where is_open),
          'overdue', count(*) filter (where is_open and due_date < v_today),
          'completion_rate', case when count(*) filter (where in_done or (is_open and due_date <= v_to)) = 0 then null
                                  else round(100.0 * count(*) filter (where in_done)
                                             / count(*) filter (where in_done or (is_open and due_date <= v_to)), 0) end,
          'avg_completion_hours', round((avg(extract(epoch from (completed_at - created_at)) / 3600)
                                          filter (where in_done))::numeric, 1)) x
          from m group by m.assigned_to) q), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(q.x order by q.n desc) from (
        select jsonb_build_object('code', m.task_source, 'name', s.name_ar,
                 'created', count(*) filter (where in_created), 'completed', count(*) filter (where in_done),
                 'open', count(*) filter (where is_open)) as x, count(*) as n
          from m left join public.task_sources s on s.code = m.task_source
         group by m.task_source, s.name_ar) q), '[]'::jsonb),
    'by_priority', coalesce((
      select jsonb_agg(q.x order by q.r) from (
        select jsonb_build_object('priority', m.priority,
                 'open', count(*) filter (where is_open),
                 'overdue', count(*) filter (where is_open and due_date < v_today),
                 'completed', count(*) filter (where in_done)) as x, public.task_priority_rank(m.priority) as r
          from m group by m.priority) q), '[]'::jsonb),
    'by_type', coalesce((
      select jsonb_agg(q.x order by q.n desc) from (
        select jsonb_build_object('code', m.task_type, 'name', tt.name_ar,
                 'open', count(*) filter (where is_open), 'completed', count(*) filter (where in_done)) as x,
               count(*) as n
          from m left join public.task_types tt on tt.code = m.task_type
         group by m.task_type, tt.name_ar) q), '[]'::jsonb),
    'by_project', coalesce((
      select jsonb_agg(q.x order by q.n desc) from (
        select jsonb_build_object('id', m.project_id, 'name', pr.name,
                 'open', count(*) filter (where is_open),
                 'overdue', count(*) filter (where is_open and due_date < v_today),
                 'completed', count(*) filter (where in_done)) as x,
               count(*) filter (where is_open) as n
          from m join public.projects pr on pr.id = m.project_id
         group by m.project_id, pr.name) q), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;
comment on function public.task_overview(date, date, jsonb) is
  'تقرير أداء المهام (193). INVOKER: يحسب ما يراه السائل فقط. أرقام موضوعية — ليس مؤشر أداء وظيفي وحيداً.';

-- العبء لكل مسؤول (المفتوح وما حوله)
create or replace function public.task_workload(p_department uuid default null)
returns table (
  user_id uuid, name text, department_name text,
  open_count int, late_count int, today_count int, week_count int,
  in_progress_count int, waiting_count int, pending_approval_count int, done_7d int
) language sql stable set search_path = public as $$
  with d as (
    select dd.id from public.department_descendants(p_department) dd
  )
  select t.assigned_to,
         max(t.assigned_to_name),
         (select dp.name_ar from public.employees e join public.departments dp on dp.id = e.department_id
           where e.user_id = t.assigned_to limit 1),
         (count(*) filter (where public.task_is_open(t.status)))::int,
         (count(*) filter (where public.task_is_open(t.status) and t.due_date < public.baghdad_today()))::int,
         (count(*) filter (where public.task_is_open(t.status) and t.due_date = public.baghdad_today()))::int,
         (count(*) filter (where public.task_is_open(t.status) and t.due_date between public.baghdad_today() and public.baghdad_today() + 7))::int,
         (count(*) filter (where t.status = 'قيد التنفيذ'))::int,
         (count(*) filter (where public.task_is_open(t.status) and (t.blocked_reason is not null
                             or exists (select 1 from public.task_dependencies dep join public.tasks x on x.id = dep.depends_on_id
                                         where dep.task_id = t.id and dep.is_blocking and x.status not in ('منجزة', 'ملغاة')))))::int,
         (count(*) filter (where t.approval_status = 'بانتظار الموافقة'))::int,
         (count(*) filter (where t.status = 'منجزة' and t.completed_at >= now() - interval '7 days'))::int
    from public.tasks t
   where t.archived_at is null
     and (p_department is null or t.department_id in (select d.id from d))
   group by t.assigned_to
  having count(*) filter (where public.task_is_open(t.status) or t.completed_at >= now() - interval '7 days') > 0
   order by 5 desc, 4 desc;
$$;

-- نظرة الأقسام: لكل قسم رئيسي (مع فروعه) المفتوح والمتأخر واليوم ونسبة
-- الإنجاز في ٣٠ يوماً — للنزول من لوحة الإدارة إلى مساحة القسم.
create or replace function public.task_department_overview()
returns table (
  department_id uuid, code text, name text, workspace text,
  open_count int, late_count int, today_count int, done_today int,
  pending_approval_count int, completion_rate_30d int
) language sql stable set search_path = public as $$
  with roots as (
    select d.id, d.code, d.name_ar, d.sort_order from public.departments d
     where d.parent_id is null and d.status = 'نشط'
  ), mapped as (
    select r.id as root_id, t.*
      from roots r
      join public.department_descendants(r.id) dd on true
      join public.tasks t on t.department_id = dd.id
     where t.archived_at is null
  )
  select r.id, r.code, r.name_ar,
         (select s.workspace from public.task_department_settings(r.id) s),
         (count(m.id) filter (where public.task_is_open(m.status)))::int,
         (count(m.id) filter (where public.task_is_open(m.status) and m.due_date < public.baghdad_today()))::int,
         (count(m.id) filter (where public.task_is_open(m.status) and m.due_date = public.baghdad_today()))::int,
         (count(m.id) filter (where m.status = 'منجزة' and (m.completed_at at time zone 'Asia/Baghdad')::date = public.baghdad_today()))::int,
         (count(m.id) filter (where m.approval_status = 'بانتظار الموافقة'))::int,
         case when count(m.id) filter (where m.due_date between public.baghdad_today() - 30 and public.baghdad_today() and m.status <> 'ملغاة') = 0 then null
              else round(100.0 * count(m.id) filter (where m.due_date between public.baghdad_today() - 30 and public.baghdad_today() and m.status = 'منجزة')
                         / count(m.id) filter (where m.due_date between public.baghdad_today() - 30 and public.baghdad_today() and m.status <> 'ملغاة'))::int end
    from roots r left join mapped m on m.root_id = r.id
   group by r.id, r.code, r.name_ar, r.sort_order
   order by r.sort_order, r.name_ar;
$$;

-- لوحات «المهام المرتبطة» في العميل والفرصة والموظف والحملة والمشروع
create or replace function public.task_related_summary(p_entity_type text, p_entity_id uuid)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select x.* from public.tasks x
     where x.archived_at is null and (
           (x.entity_type = p_entity_type and x.entity_id = p_entity_id)
        or (p_entity_type = 'client' and (x.client_id = p_entity_id or x.related_client = p_entity_id))
        or (p_entity_type = 'opportunity' and x.opportunity_id = p_entity_id)
        or (p_entity_type = 'project' and x.project_id = p_entity_id)
        or (p_entity_type = 'campaign' and x.campaign_id = p_entity_id)
        or (p_entity_type = 'employee' and x.assigned_to = (select e.user_id from public.employees e where e.id = p_entity_id)))
  )
  select jsonb_build_object(
    'open',      count(*) filter (where public.task_is_open(t.status)),
    'overdue',   count(*) filter (where public.task_is_open(t.status) and t.due_date < public.baghdad_today()),
    'completed', count(*) filter (where t.status = 'منجزة'),
    'total',     count(*) filter (where t.status <> 'ملغاة'),
    'completion_pct', case when count(*) filter (where t.status <> 'ملغاة') = 0 then null
                           else round(100.0 * count(*) filter (where t.status = 'منجزة')
                                      / count(*) filter (where t.status <> 'ملغاة'))::int end)
    from t;
$$;

revoke all on function public.task_report_filter_ok(public.tasks, jsonb, uuid[]) from public, anon;
revoke all on function public.task_overview(date, date, jsonb)      from public, anon;
revoke all on function public.task_workload(uuid)                   from public, anon;
revoke all on function public.task_department_overview()            from public, anon;
revoke all on function public.task_related_summary(text, uuid)      from public, anon;
grant execute on function public.task_report_filter_ok(public.tasks, jsonb, uuid[]) to authenticated;
grant execute on function public.task_overview(date, date, jsonb)   to authenticated;
grant execute on function public.task_workload(uuid)                to authenticated;
grant execute on function public.task_department_overview()         to authenticated;
grant execute on function public.task_related_summary(text, uuid)   to authenticated;

-- ------------------------------------------------------------
-- أمان (173): لا دالة DEFINER من 189–193 ينفّذها anon أو PUBLIC.
-- المنح الصريح لـ authenticated يبقى؛ دوال المحفّزات لا تحتاج منحاً.
-- ------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (p.proname like 'task\_%' or p.proname like '%\_task' or p.proname like '%\_task\_%'
            or p.proname in ('stamp_task', 'tasks_daily_reminder', 'can_see_task', 'can_edit_task',
                             'can_assign_task_to', 'bulk_create_tasks', 'crm_upsert_recontact_task'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
