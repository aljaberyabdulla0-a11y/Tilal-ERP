-- ============================================================
-- تلال ERP — 190: محرّك العمل V2 — الصلاحيات (مصدر واحد)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 189. ثم 191.
--
-- ===== المشكلة =====
-- مصدران للحقيقة: المصفوفة (146) تقول «مدير التسويق يرى قسمه»
-- و«HR يرى ما له»، وسياسات tasks (040) لا تقرأ المصفوفة أصلاً. وسياسة
-- التحديث تسمح لمنشئ المهمة بإسنادها **لأي أحد**.
--
-- ===== القرار =====
-- النطاق = أعلى ما يمنحه أيٌّ من:
--   • المدير ← all
--   • المصفوفة permission_scope('tasks','read') ← all/department/team/own
--   • الجسور القديمة (040/036) حدّاً أدنى: مدير المتابعة ← all، المشرف ← team
--   • الوسيط ← own دائماً
-- وعلاقات الإدارة الفعلية تمنح الرؤية دائماً، أيّاً كان الدور:
--   • تقاريري المباشرة وغير المباشرة (employees.manager_id)
--   • موظفو مشاريعي (my_scope_users — 036/037)
--   • الأقسام التي أديرها وفروعها (departments.manager_id — 145)
-- ونطاق department في المصفوفة يضيف قسمي وفروعه.
--
-- الواجهة لا تقرّر شيئاً: RLS + حارس الكتابة المباشرة + فحص صريح في
-- كل دالة task_* (191).
-- ============================================================

-- ------------------------------------------------------------
-- 1) النطاق
-- ------------------------------------------------------------
create or replace function public.task_scope_rank(p text)
returns int language sql immutable set search_path = public as $$
  select case p when 'all' then 4 when 'department' then 3 when 'team' then 2 when 'own' then 1 else 0 end;
$$;

create or replace function public.task_my_scope()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'own'
    when public.is_admin() then 'all'
    when public.is_broker() then 'own'
    else (
      select v.s
        from (values
          (case when public.is_followup_manager() then 'all' end),
          (public.permission_scope('tasks', 'read')),
          (case when public.is_supervisor() then 'team' end),
          ('own')) v(s)
       where v.s is not null
       order by public.task_scope_rank(v.s) desc
       limit 1)
  end;
$$;
comment on function public.task_my_scope() is
  'نطاق رؤية المهام (190): all | department | team | own — أعلى ما تمنحه المصفوفة أو الجسور القديمة.';

-- فريقي: موظفو مشاريعي + تقاريري المباشرة وغير المباشرة
create or replace function public.task_team_user_ids()
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  with recursive me as (
    select e.id from public.employees e where e.user_id = auth.uid() limit 1
  ), reports as (
    select e.id, e.user_id from public.employees e join me on e.manager_id = me.id
    union
    select e.id, e.user_id from public.employees e join reports r on e.manager_id = r.id
  )
  select r.user_id from reports r where r.user_id is not null and auth.uid() is not null
  union
  select u.user_id from public.my_scope_users() u where u.user_id is not null;
$$;

-- أقسامي: ما أديره وفروعه دائماً، وقسمي وفروعه إن كان نطاقي department
create or replace function public.task_my_department_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select m.id from public.my_managed_department_ids() m
  union
  select d.id
    from public.department_descendants(
           (select e.department_id from public.employees e where e.user_id = auth.uid() limit 1)) d
   where public.task_my_scope() in ('department', 'all');
$$;

-- المهام التي أتابعها (DEFINER كي لا تتداخل سياسات task_watchers مع tasks)
create or replace function public.task_my_watched_ids()
returns table (task_id uuid) language sql stable security definer set search_path = public as $$
  select w.task_id from public.task_watchers w where w.user_id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 2) أسئلة الصلاحية — تُستعمل في السياسات والدوال والواجهة
-- ------------------------------------------------------------
create or replace function public.task_row_visible(
  p_id uuid, p_assignee uuid, p_creator uuid, p_approver uuid, p_dept uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
       public.task_my_scope() = 'all'
    or auth.uid() = p_assignee or auth.uid() = p_creator or auth.uid() = p_approver
    or p_assignee in (select t.user_id from public.task_team_user_ids() t)
    or (p_dept is not null and p_dept in (select d.id from public.task_my_department_ids() d))
    or exists (select 1 from public.task_watchers w where w.task_id = p_id and w.user_id = auth.uid())
  );
$$;

create or replace function public.task_row_editable(
  p_assignee uuid, p_creator uuid, p_dept uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
       public.task_my_scope() = 'all'
    or auth.uid() = p_assignee or auth.uid() = p_creator
    or p_assignee in (select t.user_id from public.task_team_user_ids() t)
    or (p_dept is not null and p_dept in (select d.id from public.task_my_department_ids() d))
  );
$$;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and public.task_row_visible(t.id, t.assigned_to, t.created_by, t.approver_id, t.department_id));
$$;

create or replace function public.can_edit_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and public.task_row_editable(t.assigned_to, t.created_by, t.department_id));
$$;

-- لمن أُسند؟ لنفسي دائماً؛ وللمدير أيّ حساب؛ وغير ذلك لموظف نشط
-- (ليس وسيطاً) في نطاقي.
create or replace function public.can_assign_task_to(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and auth.uid() is not null and (
       p_user = auth.uid()
    or (public.is_admin() and exists (select 1 from public.profiles p where p.id = p_user))
    or (
      exists (select 1 from public.employees e where e.user_id = p_user and e.status = 'active')
      and not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'broker')
      and (
           public.task_my_scope() = 'all'
        or p_user in (select t.user_id from public.task_team_user_ids() t)
        or exists (select 1 from public.employees e
                    where e.user_id = p_user and e.status = 'active'
                      and e.department_id in (select d.id from public.task_my_department_ids() d))
      )
    )
  );
$$;
comment on function public.can_assign_task_to(uuid) is
  'هل أملك إسناد مهمة لهذا المستخدم؟ (190) — نفسي، أو المدير، أو موظف نشط في فريقي/أقسامي، أو الكل لنطاق all.';

-- من يدير الإعدادات (القوالب، المسارات، الأنواع، الأتمتة) لقسم
create or replace function public.task_can_manage_config(p_dept uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.has_permission('tasks', 'manage')
      or (p_dept is not null and p_dept in (select m.id from public.my_managed_department_ids() m));
$$;

-- هل يطلب إلغاء هذه المهمة سبباً؟ النوع أو إعداد القسم (أو أبيه)
create or replace function public.task_requires_cancel_reason(p_type text, p_dept uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select tt.requires_cancel_reason from public.task_types tt where tt.code = p_type), false)
      or coalesce((
           with recursive up as (
             select d.id, d.parent_id, 0 as depth from public.departments d where d.id = p_dept
             union all
             select d.id, d.parent_id, up.depth + 1 from public.departments d join up on d.id = up.parent_id
              where up.depth < 10
           )
           select s.requires_cancel_reason
             from up join public.department_task_settings s on s.department_id = up.id
            order by up.depth limit 1), false);
$$;

-- إعداد القسم الفعلي (يرث من الأب)
create or replace function public.task_department_settings(p_dept uuid)
returns table (department_id uuid, workspace text, due_soon_hours int, requires_cancel_reason boolean, default_workflow_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select d.id, d.parent_id, 0 as depth from public.departments d where d.id = p_dept
    union all
    select d.id, d.parent_id, up.depth + 1 from public.departments d join up on d.id = up.parent_id
     where up.depth < 10
  )
  select p_dept, s.workspace, s.due_soon_hours, s.requires_cancel_reason, s.default_workflow_id
    from up join public.department_task_settings s on s.department_id = up.id
   order by up.depth limit 1;
$$;

revoke all on function public.task_my_scope()                        from public, anon;
revoke all on function public.task_team_user_ids()                   from public, anon;
revoke all on function public.task_my_department_ids()               from public, anon;
revoke all on function public.task_my_watched_ids()                  from public, anon;
revoke all on function public.task_row_visible(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.task_row_editable(uuid, uuid, uuid)    from public, anon;
revoke all on function public.can_see_task(uuid)                     from public, anon;
revoke all on function public.can_edit_task(uuid)                    from public, anon;
revoke all on function public.can_assign_task_to(uuid)               from public, anon;
revoke all on function public.task_can_manage_config(uuid)           from public, anon;
revoke all on function public.task_requires_cancel_reason(text, uuid) from public, anon;
revoke all on function public.task_department_settings(uuid)         from public, anon;
grant execute on function public.task_scope_rank(text)                to authenticated;
grant execute on function public.task_my_scope()                      to authenticated;
grant execute on function public.task_team_user_ids()                 to authenticated;
grant execute on function public.task_my_department_ids()             to authenticated;
grant execute on function public.task_my_watched_ids()                to authenticated;
grant execute on function public.task_row_visible(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.task_row_editable(uuid, uuid, uuid)  to authenticated;
grant execute on function public.can_see_task(uuid)                   to authenticated;
grant execute on function public.can_edit_task(uuid)                  to authenticated;
grant execute on function public.can_assign_task_to(uuid)             to authenticated;
grant execute on function public.task_can_manage_config(uuid)         to authenticated;
grant execute on function public.task_requires_cancel_reason(text, uuid) to authenticated;
grant execute on function public.task_department_settings(uuid)       to authenticated;

-- ------------------------------------------------------------
-- 3) سياسات tasks — نفس الأسماء الأربعة، منطق موحّد
--    الدوال داخل (select …) تُحسب مرة للاستعلام لا لكل صف.
-- ------------------------------------------------------------
drop policy if exists "read my tasks" on public.tasks;
create policy "read my tasks" on public.tasks
  for select to authenticated
  using (
       (select public.task_my_scope()) = 'all'
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or approver_id = (select auth.uid())
    or assigned_to in (select t.user_id from public.task_team_user_ids() t)
    or department_id in (select d.id from public.task_my_department_ids() d)
    or id in (select w.task_id from public.task_my_watched_ids() w)
  );

drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_assign_task_to(assigned_to)
  );

-- التحديث: نفس القراءة بلا المتابِع والمعتمِد (يعلّقان ويوافقان عبر الدوال).
-- تغيير المسؤول والقسم يفحصه الحارس (4).
drop policy if exists "update my tasks" on public.tasks;
create policy "update my tasks" on public.tasks
  for update to authenticated
  using (
       (select public.task_my_scope()) = 'all'
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select t.user_id from public.task_team_user_ids() t)
    or department_id in (select d.id from public.task_my_department_ids() d)
  )
  with check (
       (select public.task_my_scope()) = 'all'
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select t.user_id from public.task_team_user_ids() t)
    or department_id in (select d.id from public.task_my_department_ids() d)
  );

-- الحذف: المدير، أو منشئ مهمة يدوية. مهامّ النظام لا تُحذف إلا بيد المدير.
drop policy if exists "delete my tasks" on public.tasks;
create policy "delete my tasks" on public.tasks
  for delete to authenticated
  using (
    (select public.is_admin())
    or (created_by = (select auth.uid()) and task_source = 'manual')
  );

-- ------------------------------------------------------------
-- 4) حارس الكتابة المباشرة من المتصفح
--
-- SECURITY INVOKER عمداً: current_user = 'authenticated' يعني كتابة
-- مباشرة عبر PostgREST. داخل دوال DEFINER (task_* وكل دوال النظام
-- القديمة: الجماعي، إعادة التواصل، الاستمارة، التسليم، الدمج) يكون
-- current_user مالك الدالة فيُتجاوز — تلك الدوال تفحص بنفسها.
--
-- اسمه يبدأ بـ trg_task_guard فيعمل قبل trg_task_stamp (الترتيب أبجدي).
-- ------------------------------------------------------------
create or replace function public.guard_task_client_write()
returns trigger language plpgsql set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_scope text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  v_scope := public.task_my_scope();

  if tg_op = 'INSERT' then
    -- المتصفح لا يزوّر المصدر ولا القناة ولا يربط بقالب أو تكرار
    new.task_source     := 'manual';
    new.created_source  := case when new.created_source in ('quick_add', 'form', 'subtask', 'duplicate')
                                then new.created_source else 'form' end;
    new.template_id     := null;
    new.recurrence_id   := null;
    new.recurrence_date := null;
    new.approval_status := null;
    new.approval_requested_at := null;
    new.approved_by     := null;
    new.approved_at     := null;
    new.rejection_reason := null;
    new.archived_at     := null;
    new.archived_by     := null;
    new.version         := 1;

    if exists (select 1 from public.task_types tt where tt.code = new.task_type and tt.is_system) then
      raise exception 'هذا النوع من المهام يُنشئه النظام وحده.' using errcode = '42501';
    end if;
    if not public.can_assign_task_to(new.assigned_to) then
      raise exception 'لا تملك صلاحية إسناد هذه المهمة لهذا الموظف.' using errcode = '42501';
    end if;
    if new.status = 'ملغاة' then
      raise exception 'لا تُنشأ مهمة ملغاة.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- ===== UPDATE =====
  if new.task_source is distinct from old.task_source
     or new.created_source is distinct from old.created_source
     or new.template_id is distinct from old.template_id
     or new.recurrence_id is distinct from old.recurrence_id
     or new.recurrence_date is distinct from old.recurrence_date then
    raise exception 'مصدر المهمة وقالبها وتكرارها لا تُعدَّل.' using errcode = '42501';
  end if;

  if new.approval_status is distinct from old.approval_status
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.approval_requested_at is distinct from old.approval_requested_at
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'الموافقة تُطلب وتُقرَّر من أزرارها في المهمة.' using errcode = '42501';
  end if;

  -- المسؤول لا يُسقط شرط الموافقة عن مهمته
  if new.requires_approval is distinct from old.requires_approval
     and v_uid is distinct from old.created_by and v_scope <> 'all'
     and not coalesce(old.department_id in (select d.id from public.task_my_department_ids() d), false) then
    raise exception 'شرط الموافقة يغيّره من طلب المهمة أو مدير القسم.' using errcode = '42501';
  end if;
  if old.approval_status = 'بانتظار الموافقة' and not new.requires_approval then
    raise exception 'المهمة بانتظار الموافقة — لا يُلغى شرطها الآن.' using errcode = '42501';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     and not public.can_assign_task_to(new.assigned_to) then
    raise exception 'لا تملك صلاحية إسناد هذه المهمة لهذا الموظف.' using errcode = '42501';
  end if;

  if new.department_id is distinct from old.department_id
     and new.department_id is not null
     and v_scope <> 'all'
     and v_uid is distinct from old.created_by and v_uid is distinct from old.assigned_to
     and not coalesce(new.department_id in (select d.id from public.task_my_department_ids() d), false) then
    raise exception 'لا تملك نقل المهمة إلى هذا القسم.' using errcode = '42501';
  end if;

  if new.task_type is distinct from old.task_type then
    if exists (select 1 from public.task_types tt where tt.code in (new.task_type, old.task_type) and tt.is_system)
       and not public.is_admin() then
      raise exception 'نوع هذه المهمة يحدّده النظام.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'ملغاة' and old.status <> 'ملغاة'
     and coalesce(btrim(new.cancellation_reason), '') = ''
     and public.task_requires_cancel_reason(new.task_type, new.department_id) then
    raise exception 'اكتب سبب الإلغاء — هذا القسم أو النوع يطلبه.' using errcode = '22023';
  end if;

  return new;
end $$;

drop trigger if exists trg_task_guard_client on public.tasks;
create trigger trg_task_guard_client
  before insert or update on public.tasks
  for each row execute function public.guard_task_client_write();

-- ------------------------------------------------------------
-- 5) سياسات الجداول المساعدة
-- ------------------------------------------------------------

-- القوائم المرجعية: يقرؤها كل مسجَّل غير وسيط؛ ويكتبها مدير الإعدادات
do $$
declare t text;
begin
  foreach t in array array['task_sources', 'task_workspaces', 'task_types', 'task_entity_types'] loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select to authenticated using (not (select public.is_broker()))', t);
    execute format('drop policy if exists "manage %1$s" on public.%1$I', t);
    execute format('create policy "manage %1$s" on public.%1$I for all to authenticated
                      using ((select public.task_can_manage_config(null)))
                      with check ((select public.task_can_manage_config(null)))', t);
  end loop;
end $$;

-- إعداد القسم: يقرؤه الكل، ويكتبه مدير الإعدادات أو مدير القسم
drop policy if exists "read department task settings" on public.department_task_settings;
create policy "read department task settings" on public.department_task_settings
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage department task settings" on public.department_task_settings;
create policy "manage department task settings" on public.department_task_settings
  for all to authenticated
  using (public.task_can_manage_config(department_id))
  with check (public.task_can_manage_config(department_id));

-- المسارات وخطواتها
drop policy if exists "read task workflows" on public.task_workflows;
create policy "read task workflows" on public.task_workflows
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage task workflows" on public.task_workflows;
create policy "manage task workflows" on public.task_workflows
  for all to authenticated
  using (public.task_can_manage_config(department_id) and not is_system)
  with check (public.task_can_manage_config(department_id) and not is_system);

drop policy if exists "read task workflow steps" on public.task_workflow_steps;
create policy "read task workflow steps" on public.task_workflow_steps
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage task workflow steps" on public.task_workflow_steps;
create policy "manage task workflow steps" on public.task_workflow_steps
  for all to authenticated
  using (exists (select 1 from public.task_workflows w
                  where w.id = workflow_id and not w.is_system and public.task_can_manage_config(w.department_id)))
  with check (exists (select 1 from public.task_workflows w
                       where w.id = workflow_id and not w.is_system and public.task_can_manage_config(w.department_id)));

-- القوالب وبنودها
drop policy if exists "read task templates" on public.task_templates;
create policy "read task templates" on public.task_templates
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage task templates" on public.task_templates;
create policy "manage task templates" on public.task_templates
  for all to authenticated
  using (public.task_can_manage_config(department_id) or (created_by = (select auth.uid()) and not is_system))
  with check (public.task_can_manage_config(department_id) or (created_by = (select auth.uid()) and not is_system));

drop policy if exists "read task template items" on public.task_template_items;
create policy "read task template items" on public.task_template_items
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage task template items" on public.task_template_items;
create policy "manage task template items" on public.task_template_items
  for all to authenticated
  using (exists (select 1 from public.task_templates t
                  where t.id = template_id
                    and (public.task_can_manage_config(t.department_id) or (t.created_by = (select auth.uid()) and not t.is_system))))
  with check (exists (select 1 from public.task_templates t
                       where t.id = template_id
                         and (public.task_can_manage_config(t.department_id) or (t.created_by = (select auth.uid()) and not t.is_system))));

-- التكرار: منشئه ومسؤوله ومدير قسمه
drop policy if exists "read task recurrences" on public.task_recurrences;
create policy "read task recurrences" on public.task_recurrences
  for select to authenticated
  using (created_by = (select auth.uid()) or assigned_to = (select auth.uid())
         or public.task_can_manage_config(department_id)
         or assigned_to in (select t.user_id from public.task_team_user_ids() t));
drop policy if exists "manage task recurrences" on public.task_recurrences;
create policy "manage task recurrences" on public.task_recurrences
  for all to authenticated
  using (created_by = (select auth.uid()) or public.task_can_manage_config(department_id))
  with check ((created_by = (select auth.uid()) or public.task_can_manage_config(department_id))
              and (assigned_to is null or public.can_assign_task_to(assigned_to)));

-- الأتمتة: للمدير ومن يملك «إدارة المهام»
drop policy if exists "manage task automation" on public.task_automation_rules;
create policy "manage task automation" on public.task_automation_rules
  for all to authenticated
  using ((select public.task_can_manage_config(null)))
  with check ((select public.task_can_manage_config(null)));
drop policy if exists "read task automation runs" on public.task_automation_runs;
create policy "read task automation runs" on public.task_automation_runs
  for select to authenticated using ((select public.task_can_manage_config(null)));
-- task_assign_cursor: بلا سياسات — دوال DEFINER وحدها

-- التعليقات: يقرؤها من يرى المهمة؛ الكتابة عبر task_comment_* (191) وحدها
drop policy if exists "read task comments" on public.task_comments;
create policy "read task comments" on public.task_comments
  for select to authenticated using (public.can_see_task(task_id));
revoke insert, update, delete on public.task_comments from authenticated;

-- المرفقات: يرفع من يرى المهمة؛ الحذف الناعم عبر task_attachment_remove
drop policy if exists "read task attachments" on public.task_attachments;
create policy "read task attachments" on public.task_attachments
  for select to authenticated using (deleted_at is null and public.can_see_task(task_id));
drop policy if exists "add task attachments" on public.task_attachments;
create policy "add task attachments" on public.task_attachments
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and deleted_at is null and public.can_see_task(task_id));
revoke update, delete on public.task_attachments from authenticated;

-- قائمة التحقق: يقرؤها من يرى المهمة، ويكتبها من يعدّلها
drop policy if exists "read task checklist" on public.task_checklist_items;
create policy "read task checklist" on public.task_checklist_items
  for select to authenticated using (public.can_see_task(task_id));
drop policy if exists "write task checklist" on public.task_checklist_items;
create policy "write task checklist" on public.task_checklist_items
  for all to authenticated
  using (public.can_edit_task(task_id))
  with check (public.can_edit_task(task_id));

-- السجلّ: قراءة لمن يرى المهمة
drop policy if exists "read task activity" on public.task_activity_log;
create policy "read task activity" on public.task_activity_log
  for select to authenticated using (public.can_see_task(task_id));

-- المتابِعون: أتابع ما أراه؛ وأضيف غيري إن كنت أعدّل المهمة وأملك
-- إسناده (لا يُفتح سرّ مهمة لمن هو خارج نطاقي)
drop policy if exists "read task watchers" on public.task_watchers;
create policy "read task watchers" on public.task_watchers
  for select to authenticated using (public.can_see_task(task_id));
drop policy if exists "add task watchers" on public.task_watchers;
create policy "add task watchers" on public.task_watchers
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and public.can_see_task(task_id))
    or (public.can_edit_task(task_id) and public.can_assign_task_to(user_id))
  );
drop policy if exists "remove task watchers" on public.task_watchers;
create policy "remove task watchers" on public.task_watchers
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.can_edit_task(task_id));

-- التبعيات: من يعدّل المهمة ويرى ما تعتمد عليه
drop policy if exists "read task dependencies" on public.task_dependencies;
create policy "read task dependencies" on public.task_dependencies
  for select to authenticated using (public.can_see_task(task_id));
drop policy if exists "write task dependencies" on public.task_dependencies;
create policy "write task dependencies" on public.task_dependencies
  for insert to authenticated
  with check (public.can_edit_task(task_id) and public.can_see_task(depends_on_id));
drop policy if exists "remove task dependencies" on public.task_dependencies;
create policy "remove task dependencies" on public.task_dependencies
  for delete to authenticated using (public.can_edit_task(task_id));

-- الوسوم: يقرؤها الكل؛ العامة لمدير الإعدادات، وقسمها لمديره
drop policy if exists "read task labels" on public.task_labels;
create policy "read task labels" on public.task_labels
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "manage task labels" on public.task_labels;
create policy "manage task labels" on public.task_labels
  for all to authenticated
  using (public.task_can_manage_config(department_id))
  with check (public.task_can_manage_config(department_id));

drop policy if exists "read task label links" on public.task_label_links;
create policy "read task label links" on public.task_label_links
  for select to authenticated using (public.can_see_task(task_id));
drop policy if exists "write task label links" on public.task_label_links;
create policy "write task label links" on public.task_label_links
  for all to authenticated
  using (public.can_edit_task(task_id))
  with check (public.can_edit_task(task_id));

-- العروض المحفوظة: لصاحبها وحده
drop policy if exists "own task saved views" on public.task_saved_views;
create policy "own task saved views" on public.task_saved_views
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 6) التخزين — الدلو task-attachments
--    المسار {task_id}/…؛ القراءة والرفع لمن يرى المهمة، والإزالة لمن
--    رفع الملف أو يعدّل المهمة.
-- ------------------------------------------------------------
create or replace function public.task_storage_allowed(p_name text, p_mode text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_task uuid;
begin
  begin
    v_task := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  if p_mode = 'write' then
    return public.can_edit_task(v_task) or public.can_see_task(v_task);
  elsif p_mode = 'delete' then
    return public.can_edit_task(v_task);
  end if;
  return public.can_see_task(v_task);
end $$;
revoke all on function public.task_storage_allowed(text, text) from public, anon;
grant execute on function public.task_storage_allowed(text, text) to authenticated;

drop policy if exists "read task attachment files" on storage.objects;
create policy "read task attachment files" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-attachments' and public.task_storage_allowed(name, 'read'));

drop policy if exists "upload task attachment files" on storage.objects;
create policy "upload task attachment files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-attachments' and public.task_storage_allowed(name, 'write'));

drop policy if exists "delete task attachment files" on storage.objects;
create policy "delete task attachment files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-attachments'
         and (owner = (select auth.uid()) or public.task_storage_allowed(name, 'delete')));

-- ------------------------------------------------------------
-- 7) المصفوفة — صفوف tasks تطابق ما تفعله السياسات الآن
--    مدير HR والمدير المالي يريان قسمهما؛ المدير العام يدير.
-- ------------------------------------------------------------
update public.role_permissions
   set scope = 'department', updated_at = now()
 where module = 'tasks' and role_code in ('hr_manager', 'finance_manager') and scope = 'own';

update public.role_permissions
   set actions = array(select distinct unnest(actions || array['approve']::text[]) order by 1), updated_at = now()
 where module = 'tasks' and scope in ('team', 'department', 'all')
   and not ('approve' = any (actions));

update public.app_modules
   set note = 'المهام V2 (190): السياسات تقرأ permission_scope(''tasks'',''read'') مع الجسور القديمة حدّاً أدنى. manage = القوالب والمسارات والأتمتة.'
 where code = 'tasks';

-- ------------------------------------------------------------
-- 8) تحقّق: لا أحد خسر ما كان يراه
--    كل مهمة كان يراها مستخدم بسياسة 040 يراها الآن (الجسور حدّ أدنى).
-- ------------------------------------------------------------
do $$
declare r record; n_lost int := 0; n_old int; n_new int;
begin
  for r in select p.id, p.role from public.profiles p loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    select count(*) into n_old from public.tasks t
     where public.is_admin() or public.is_followup_manager()
        or t.assigned_to = r.id or t.created_by = r.id
        or t.assigned_to in (select u.user_id from public.my_scope_users() u);
    select count(*) into n_new from public.tasks t
     where public.task_row_visible(t.id, t.assigned_to, t.created_by, t.approver_id, t.department_id);
    if n_new < n_old then
      n_lost := n_lost + 1;
      raise warning '190: المستخدم % (%) كان يرى % ويرى الآن %', r.id, r.role, n_old, n_new;
    end if;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  if n_lost > 0 then
    raise exception '190: % مستخدم سيخسر رؤية مهام كان يراها — أُلغي التطبيق.', n_lost;
  end if;
  raise notice '190: لا مستخدم خسر رؤية مهمة كان يراها ✓';
end $$;

notify pgrst, 'reload schema';
