-- ════════════════════════════════════════════════════════════════════════
-- ⚠ طُبّقت على الإنتاج 2026-11-26 عبر apply_migration على أجزاء: 229_responsibilities (الجداول والمكتبة والقراءة)،
--   229e (دوال الكتابة)، 229f (دالة الصلاحيات بالاستبدال upsert + الامتيازات)، 229g (cron)، 229h (إصلاح responsibility_touch). 229b = 13/13.
-- 229_responsibilities
-- المسؤوليات التشغيلية: المكتبة والتكليف والانتهاء التلقائي
--
-- إطار الهجرة (Q14 — 2026-11-26). لا تُعدِّل الرأس ولا الذيل يدوياً؛ يولّدهما staging/tools/new-migration.mjs.
--   • الملف كله معاملة واحدة صريحة (begin … commit): أي خطأ ⇒ لا تغيير ولا تسجيل.
--   • الرأس يرفض التشغيل إن كانت الهجرة مسجّلة (بالاسم أو بمفتاح التفرّد) ⇒ لا تطبيق مرتين ولا تسجيل مرتين.
--   • التسجيل في supabase_migrations.schema_migrations نفسه (سجلّ Supabase)، بمفتاح تفرّد 'tilal:<name>'
--     يفرضه القيد الفريد schema_migrations_idempotency_key_key.
--   • الذيل يتأكد من صفّ التسجيل قبل commit.
--   • يُطبَّق باللصق في SQL Editor أو بـ staging/run-sql.ps1. **لا يُرسل عبر apply_migration**
--     (الأداة تسجّل صفّها الخاص بعد التنفيذ ⇒ اسم مكرّر). إن لزم ذلك يوماً: احذف الرأس والذيل.
-- ════════════════════════════════════════════════════════════════════════
begin;

do $tilal_reg$
declare
  v_name constant text := '229_responsibilities';
  v_ts   timestamp;
begin
  if exists (select 1 from supabase_migrations.schema_migrations
              where name = v_name or idempotency_key = 'tilal:' || v_name) then
    raise exception 'MIGRATION_ALREADY_APPLIED: % مسجّلة في سجلّ الهجرات — لن تُطبَّق مرتين', v_name;
  end if;
  -- نسخة بصيغة سجلّ Supabase (UTC، 14 رقماً)، وأكبر من كل نسخة سابقة بثانية على الأقل
  v_ts := greatest(
    date_trunc('second', clock_timestamp() at time zone 'utc'),
    coalesce((select to_timestamp(max(version), 'YYYYMMDDHH24MISS')::timestamp + interval '1 second'
                from supabase_migrations.schema_migrations where version ~ '^\d{14}$'), '-infinity'::timestamp));
  insert into supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key)
  values (to_char(v_ts, 'YYYYMMDDHH24MISS'), v_name,
          array['-- applied from sql/' || v_name || '.sql; full text in git'],
          'sql-file:' || current_user, 'tilal:' || v_name);
end $tilal_reg$;

-- ═══ محتوى الهجرة ═══════════════════════════════════════════════════════

-- 229 — المسؤوليات التشغيلية المشتركة بين الأقسام
-- responsibility_catalog: المكتبة (تعريف قابل للإدارة دون كود) · responsibility_assignments: التكليف على موظف (رئيسي/مساعد)
-- responsibility_permissions / responsibility_kpis: ما تمنحه المسؤولية وما تُقاس به (تُقرأ في 231 و236).
-- المرجع: docs/MULTI_ROLE_OPERATIONS_DESIGN.md §٤-٢، §٤-٣. يعتمد على 227، 228.

create table if not exists public.responsibility_catalog (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar                   text not null,
  name_en                   text,
  description               text,
  owner_department_id       uuid references public.departments(id),
  beneficiary_department_id uuid references public.departments(id),
  responsibility_type       text not null default 'other'
                              check (responsibility_type in ('monitoring', 'review', 'follow_up', 'coordination', 'audit', 'other')),
  default_priority          text not null default 'عادية' check (default_priority in ('عاجلة', 'متوسطة', 'عادية')),
  default_workload_pct      numeric(5,2) not null default 0 check (default_workload_pct between 0 and 100),
  default_hours_per_week    numeric(5,2) check (default_hours_per_week is null or default_hours_per_week between 0 and 60),
  sla_hours                 int check (sla_hours is null or sla_hours > 0),
  is_permanent_default      boolean not null default true,
  allowance_policy          jsonb not null default '{"type": "none"}'::jsonb,
  max_assignees             int check (max_assignees is null or max_assignees > 0),
  requires_lead             boolean not null default true,
  is_active                 boolean not null default false,
  archived_at               timestamptz,
  archived_by               uuid references auth.users(id),
  is_seed                   boolean not null default false,
  created_by                uuid references auth.users(id) default auth.uid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint responsibility_catalog_archived_chk check (archived_at is null or not is_active),
  constraint responsibility_catalog_allowance_chk check (allowance_policy ? 'type'
    and allowance_policy->>'type' in ('none', 'fixed', 'percent_of_base', 'kpi_bonus'))
);
comment on table public.responsibility_catalog is
  'مكتبة المسؤوليات التشغيلية (229). تُدار من الواجهة؛ الحذف منطقي (archived_at).';

create table if not exists public.responsibility_permissions (
  responsibility_id uuid not null references public.responsibility_catalog(id) on delete cascade,
  module            text not null references public.app_modules(code),
  actions           text[] not null check (actions <@ array['create','read','update','delete','approve','export',
                                                            'manage','view_financial','view_salary','view_personal']
                                           and cardinality(actions) > 0),
  scope             text not null default 'own' check (scope in ('own', 'team', 'department', 'all')),
  updated_by        uuid references auth.users(id) default auth.uid(),
  updated_at        timestamptz not null default now(),
  primary key (responsibility_id, module)
);
comment on table public.responsibility_permissions is
  'ما تمنحه المسؤولية لمن يتولّاها ما دام تكليفه فعّالاً (229؛ تُفرض في 231). يحرّرها المدير العام وحده.';

create table if not exists public.responsibility_kpis (
  responsibility_id uuid not null references public.responsibility_catalog(id) on delete cascade,
  kpi_code          text not null references public.kpi_definitions(code),
  target_value      numeric,
  weight            numeric not null default 1 check (weight > 0),
  primary key (responsibility_id, kpi_code)
);

create table if not exists public.responsibility_assignments (
  id                 uuid primary key default gen_random_uuid(),
  responsibility_id  uuid not null references public.responsibility_catalog(id),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  assignee_role      text not null default 'lead' check (assignee_role in ('lead', 'assistant')),
  supervisor_id      uuid references public.employees(id) on delete set null,
  start_date         date not null,
  end_date           date,
  is_permanent       boolean not null default true,
  status             text not null default 'active'
                       check (status in ('pending_approval', 'active', 'suspended', 'ended', 'rejected')),
  priority           text not null default 'عادية' check (priority in ('عاجلة', 'متوسطة', 'عادية')),
  workload_pct       numeric(5,2) not null default 0 check (workload_pct between 0 and 100),
  hours_per_week     numeric(5,2) check (hours_per_week is null or hours_per_week between 0 and 60),
  sla_hours          int check (sla_hours is null or sla_hours > 0),
  scope_filter       jsonb not null default '{}'::jsonb,
  allowance_id       uuid,   -- يُربط بـ employee_allowances في 235
  approval_id        uuid references public.approval_requests(id),
  notes              text,
  assigned_by        uuid references auth.users(id) default auth.uid(),
  ended_by           uuid references auth.users(id),
  ended_reason       text,
  expiry_notified_on date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint responsibility_assignments_dates_chk check (end_date is null or end_date >= start_date),
  constraint responsibility_assignments_term_chk  check (is_permanent or end_date is not null),
  constraint responsibility_assignments_self_chk  check (supervisor_id is distinct from employee_id),
  constraint responsibility_assignments_ended_chk check (status <> 'ended' or end_date is not null)
);
comment on table public.responsibility_assignments is
  'تكليف موظف بمسؤولية (229). لا حذف: الإنهاء = end_date + ended. الموظف يبقى تابعاً إدارياً لقسمه.';

create unique index if not exists responsibility_assignments_open_uq
  on public.responsibility_assignments (responsibility_id, employee_id)
  where status in ('pending_approval', 'active', 'suspended');
create unique index if not exists responsibility_assignments_one_lead_uq
  on public.responsibility_assignments (responsibility_id)
  where assignee_role = 'lead' and status = 'active';
create index if not exists responsibility_assignments_emp_idx on public.responsibility_assignments (employee_id, status);
create index if not exists responsibility_assignments_sup_idx on public.responsibility_assignments (supervisor_id);
create index if not exists responsibility_catalog_benef_idx on public.responsibility_catalog (beneficiary_department_id);

-- ── الختم والتدقيق ─────────────────────────────────────────────
create or replace function public.responsibility_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  -- (229h) شرطان متداخلان: PL/pgSQL لا يختصر AND
  if tg_table_name = 'responsibility_assignments' then
    if new.status = 'ended' and new.end_date is null then
      new.end_date := greatest(new.start_date, public.baghdad_today());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_responsibility_catalog_touch on public.responsibility_catalog;
create trigger trg_responsibility_catalog_touch before update on public.responsibility_catalog
  for each row execute function public.responsibility_touch();
drop trigger if exists trg_responsibility_assignments_touch on public.responsibility_assignments;
create trigger trg_responsibility_assignments_touch before insert or update on public.responsibility_assignments
  for each row execute function public.responsibility_touch();

drop trigger if exists trg_audit_responsibility_catalog on public.responsibility_catalog;
create trigger trg_audit_responsibility_catalog after insert or update or delete on public.responsibility_catalog
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_responsibility_assignments on public.responsibility_assignments;
create trigger trg_audit_responsibility_assignments after insert or update or delete on public.responsibility_assignments
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_responsibility_permissions on public.responsibility_permissions;
create trigger trg_audit_responsibility_permissions after insert or update or delete on public.responsibility_permissions
  for each row execute function public.audit_row();

-- ── الحمل المخطّط: الوظائف + المسؤوليات (تُوسّعها 230 بالعضويات) ─────
create or replace function public.employee_planned_workload(p_employee uuid, p_on date default null)
returns numeric language sql stable security definer set search_path = public as $$
  with d as (select coalesce(p_on, public.baghdad_today()) as on_day)
  select coalesce((select sum(ep.workload_pct) from public.employee_positions ep, d
                    where ep.employee_id = p_employee and ep.status in ('active', 'pending_approval')
                      and ep.start_date <= d.on_day and (ep.end_date is null or ep.end_date >= d.on_day)), 0)
       + coalesce((select sum(ra.workload_pct) from public.responsibility_assignments ra, d
                    where ra.employee_id = p_employee and ra.status in ('active', 'pending_approval', 'suspended')
                      and ra.start_date <= d.on_day and (ra.end_date is null or ra.end_date >= d.on_day)), 0);
$$;

-- p_exclude: معرّف تعيين وظيفة أو تكليف يُستبعد من الحساب (عند تعديل نسبته)
create or replace function public.assert_workload_within_capacity(p_employee uuid, p_extra numeric, p_on date,
                                                                  p_exclude uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  select public.employee_planned_workload(p_employee, p_on)
         - coalesce((select ep.workload_pct from public.employee_positions ep where ep.id = p_exclude), 0)
         - coalesce((select ra.workload_pct from public.responsibility_assignments ra where ra.id = p_exclude), 0)
         + coalesce(p_extra, 0)
    into v_total;
  if v_total > 100 then
    raise exception 'الحمل المخطّط سيصبح %٪ (أكثر من ١٠٠٪). خفّض نسبة وظيفة أو مسؤولية أخرى أولاً — تجاوز ١٠٠٪ يحتاج موافقة إدارية',
      round(v_total, 1);
  end if;
end $$;

-- ── من يدير ماذا ───────────────────────────────────────────────
create or replace function public.can_manage_responsibilities()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_permission('responsibilities', 'update');
$$;

-- الإسناد: الإدارة/HR للكل؛ مدير القسم لمسؤوليات قسمه المستفيد فقط
create or replace function public.can_assign_responsibility(p_responsibility uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.has_permission('responsibility_assign', 'create')
          and (public.permission_scope('responsibility_assign', 'create') = 'all'
               or exists (select 1 from public.responsibility_catalog c
                           where c.id = p_responsibility
                             and c.beneficiary_department_id in (select d.id from public.my_managed_department_ids() d))));
$$;

-- ── المكتبة ────────────────────────────────────────────────────
create or replace function public.responsibility_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_reason text := coalesce(nullif(p->>'reason', ''), 'تعديل المكتبة');
begin
  if not public.can_manage_responsibilities() then raise exception 'لا صلاحية لإدارة مكتبة المسؤوليات'; end if;
  if v_id is not null and exists (select 1 from public.responsibility_catalog where id = v_id and archived_at is not null) then
    raise exception 'المسؤولية مؤرشفة';
  end if;
  perform public.tilal_audit_context(v_reason, 'responsibility_save');
  if v_id is null then
    insert into public.responsibility_catalog (code, name_ar, name_en, description, owner_department_id,
      beneficiary_department_id, responsibility_type, default_priority, default_workload_pct, default_hours_per_week,
      sla_hours, is_permanent_default, allowance_policy, max_assignees, requires_lead, is_active)
    values (p->>'code', p->>'name_ar', nullif(p->>'name_en', ''), nullif(p->>'description', ''),
      nullif(p->>'owner_department_id', '')::uuid, nullif(p->>'beneficiary_department_id', '')::uuid,
      coalesce(p->>'responsibility_type', 'other'), coalesce(p->>'default_priority', 'عادية'),
      coalesce((p->>'default_workload_pct')::numeric, 0), (p->>'default_hours_per_week')::numeric,
      (p->>'sla_hours')::int, coalesce((p->>'is_permanent_default')::boolean, true),
      coalesce(p->'allowance_policy', '{"type": "none"}'::jsonb), (p->>'max_assignees')::int,
      coalesce((p->>'requires_lead')::boolean, true), coalesce((p->>'is_active')::boolean, false))
    returning id into v_id;
  else
    update public.responsibility_catalog c set
      name_ar                   = coalesce(p->>'name_ar', c.name_ar),
      name_en                   = case when p ? 'name_en' then nullif(p->>'name_en', '') else c.name_en end,
      description               = case when p ? 'description' then nullif(p->>'description', '') else c.description end,
      owner_department_id       = case when p ? 'owner_department_id' then nullif(p->>'owner_department_id', '')::uuid else c.owner_department_id end,
      beneficiary_department_id = case when p ? 'beneficiary_department_id' then nullif(p->>'beneficiary_department_id', '')::uuid else c.beneficiary_department_id end,
      responsibility_type       = coalesce(p->>'responsibility_type', c.responsibility_type),
      default_priority          = coalesce(p->>'default_priority', c.default_priority),
      default_workload_pct      = coalesce((p->>'default_workload_pct')::numeric, c.default_workload_pct),
      default_hours_per_week    = case when p ? 'default_hours_per_week' then (p->>'default_hours_per_week')::numeric else c.default_hours_per_week end,
      sla_hours                 = case when p ? 'sla_hours' then (p->>'sla_hours')::int else c.sla_hours end,
      is_permanent_default      = coalesce((p->>'is_permanent_default')::boolean, c.is_permanent_default),
      allowance_policy          = coalesce(p->'allowance_policy', c.allowance_policy),
      max_assignees             = case when p ? 'max_assignees' then (p->>'max_assignees')::int else c.max_assignees end,
      requires_lead             = coalesce((p->>'requires_lead')::boolean, c.requires_lead),
      is_active                 = coalesce((p->>'is_active')::boolean, c.is_active)
    where c.id = v_id;
    if not found then raise exception 'المسؤولية غير موجودة'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.responsibility_archive(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_responsibilities() then raise exception 'لا صلاحية لأرشفة المسؤوليات'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب الأرشفة مطلوب'; end if;
  if exists (select 1 from public.responsibility_assignments
              where responsibility_id = p_id and status in ('pending_approval', 'active', 'suspended')) then
    raise exception 'أنهِ التكليفات الفعّالة على هذه المسؤولية قبل أرشفتها';
  end if;
  perform public.tilal_audit_context(p_reason, 'responsibility_archive');
  update public.responsibility_catalog
     set is_active = false, archived_at = now(), archived_by = auth.uid()
   where id = p_id and archived_at is null;
  if not found then raise exception 'المسؤولية غير موجودة أو مؤرشفة'; end if;
end $$;

-- الصلاحيات التي تمنحها المسؤولية: المدير العام وحده (منع تصعيد الصلاحية — كإدارة الأدوار)
create or replace function public.responsibility_set_permissions(p_id uuid, p_rows jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'صلاحيات المسؤوليات يحدّدها المدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if not exists (select 1 from public.responsibility_catalog where id = p_id and archived_at is null) then
    raise exception 'المسؤولية غير موجودة أو مؤرشفة';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'الصيغة: مصفوفة صفوف'; end if;
  perform public.tilal_audit_context(p_reason, 'responsibility_set_permissions');
  delete from public.responsibility_permissions where responsibility_id = p_id;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from public.app_modules where code = r->>'module') then
      raise exception 'وحدة غير معروفة: %', r->>'module';
    end if;
    if r->>'module' in ('permission_grants', 'organization') then
      raise exception 'الوحدة % لا تُمنح عبر مسؤولية', r->>'module';
    end if;
    insert into public.responsibility_permissions (responsibility_id, module, actions, scope)
    values (p_id, r->>'module', array(select jsonb_array_elements_text(r->'actions')), coalesce(r->>'scope', 'own'));
  end loop;
end $$;

-- ── التكليف ────────────────────────────────────────────────────
create or replace function public.assign_responsibility(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c      public.responsibility_catalog%rowtype;
  v_emp  public.employees%rowtype;
  v_role text := coalesce(p->>'assignee_role', 'lead');
  v_start date := coalesce((p->>'start_date')::date, public.baghdad_today());
  v_perm boolean;
  v_end  date := (p->>'end_date')::date;
  v_pct  numeric;
  v_sup  uuid := nullif(p->>'supervisor_id', '')::uuid;
  v_id   uuid;
  v_n    int;
begin
  select * into c from public.responsibility_catalog where id = (p->>'responsibility_id')::uuid;
  if c.id is null or c.archived_at is not null then raise exception 'المسؤولية غير موجودة أو مؤرشفة'; end if;
  if not c.is_active then raise exception 'فعّل المسؤولية في المكتبة قبل التكليف بها'; end if;
  if not public.can_assign_responsibility(c.id) then raise exception 'لا صلاحية للتكليف بهذه المسؤولية'; end if;
  select * into v_emp from public.employees where id = (p->>'employee_id')::uuid;
  if v_emp.id is null or v_emp.status <> 'active' then raise exception 'الموظف غير موجود أو غير نشط'; end if;
  if v_role not in ('lead', 'assistant') then raise exception 'الدور: رئيسي أو مساعد'; end if;
  if v_sup is not null and not exists (select 1 from public.employees where id = v_sup and status = 'active') then
    raise exception 'المشرف غير نشط';
  end if;
  v_perm := coalesce((p->>'is_permanent')::boolean, c.is_permanent_default);
  if not v_perm and v_end is null then raise exception 'التكليف المؤقت يحتاج تاريخ نهاية'; end if;
  if v_role = 'lead' and exists (select 1 from public.responsibility_assignments
                                  where responsibility_id = c.id and assignee_role = 'lead' and status = 'active') then
    raise exception 'للمسؤولية مسؤول رئيسي فعّال — أضِف الموظف مساعداً أو انقل المسؤولية';
  end if;
  if c.max_assignees is not null then
    select count(*) into v_n from public.responsibility_assignments
     where responsibility_id = c.id and status in ('pending_approval', 'active', 'suspended');
    if v_n >= c.max_assignees then raise exception 'بلغت المسؤولية حدّها الأقصى من المكلَّفين (%)', c.max_assignees; end if;
  end if;
  v_pct := coalesce((p->>'workload_pct')::numeric, c.default_workload_pct);
  perform public.assert_workload_within_capacity(v_emp.id, v_pct, v_start);

  perform public.tilal_audit_context(coalesce(nullif(p->>'reason', ''), 'تكليف بمسؤولية'), 'assign_responsibility');
  insert into public.responsibility_assignments (responsibility_id, employee_id, assignee_role, supervisor_id,
    start_date, end_date, is_permanent, status, priority, workload_pct, hours_per_week, sla_hours, scope_filter, notes)
  values (c.id, v_emp.id, v_role, v_sup, v_start, v_end, v_perm, 'active',
    coalesce(p->>'priority', c.default_priority), v_pct,
    coalesce((p->>'hours_per_week')::numeric, c.default_hours_per_week),
    coalesce((p->>'sla_hours')::int, c.sla_hours), coalesce(p->'scope_filter', '{}'::jsonb), nullif(p->>'notes', ''))
  returning id into v_id;

  perform public.hr_notify_employee(v_emp.id, 'مسؤولية جديدة: ' || c.name_ar,
    'كُلّفت بمسؤولية «' || c.name_ar || '» (' || case v_role when 'lead' then 'مسؤول رئيسي' else 'مساعد' end
      || ') من ' || v_start::text || coalesce(' حتى ' || v_end::text, '') || '. تبقى تبعيتك الإدارية لقسمك.',
    '/dashboard/hr/employees/' || v_emp.id, 'عام', v_id, 'responsibility_assignment');
  if v_sup is not null then
    perform public.hr_notify_employee(v_sup, 'تشرف على مسؤولية: ' || c.name_ar,
      v_emp.full_name || ' كُلّف بمسؤولية «' || c.name_ar || '» تحت إشرافك.',
      '/dashboard/hr/employees/' || v_emp.id, 'عام', v_id, 'responsibility_assignment');
  end if;
  return v_id;
end $$;

create or replace function public.update_responsibility_assignment(p_id uuid, p jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.responsibility_assignments%rowtype;
begin
  select * into r from public.responsibility_assignments where id = p_id for update;
  if r.id is null or r.status not in ('active', 'suspended', 'pending_approval') then raise exception 'التكليف غير فعّال'; end if;
  if not public.can_assign_responsibility(r.responsibility_id) then raise exception 'لا صلاحية لتعديل هذا التكليف'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التعديل مطلوب'; end if;
  if p ? 'status' and p->>'status' not in ('active', 'suspended') then
    raise exception 'الحالة عبر التعديل: فعّال أو موقوف. الإنهاء بـ end_responsibility_assignment';
  end if;
  if p ? 'workload_pct' then
    perform public.assert_workload_within_capacity(r.employee_id, (p->>'workload_pct')::numeric, public.baghdad_today(), r.id);
  end if;
  if p ? 'assignee_role' and p->>'assignee_role' = 'lead' and r.assignee_role <> 'lead' and exists (
       select 1 from public.responsibility_assignments
        where responsibility_id = r.responsibility_id and assignee_role = 'lead' and status = 'active' and id <> r.id) then
    raise exception 'للمسؤولية مسؤول رئيسي فعّال';
  end if;
  perform public.tilal_audit_context(p_reason, 'update_responsibility_assignment');
  update public.responsibility_assignments set
    assignee_role  = coalesce(p->>'assignee_role', assignee_role),
    supervisor_id  = case when p ? 'supervisor_id' then nullif(p->>'supervisor_id', '')::uuid else supervisor_id end,
    end_date       = case when p ? 'end_date' then (p->>'end_date')::date else end_date end,
    is_permanent   = coalesce((p->>'is_permanent')::boolean, is_permanent),
    status         = coalesce(p->>'status', status),
    priority       = coalesce(p->>'priority', priority),
    workload_pct   = coalesce((p->>'workload_pct')::numeric, workload_pct),
    hours_per_week = case when p ? 'hours_per_week' then (p->>'hours_per_week')::numeric else hours_per_week end,
    sla_hours      = case when p ? 'sla_hours' then (p->>'sla_hours')::int else sla_hours end,
    scope_filter   = coalesce(p->'scope_filter', scope_filter),
    notes          = case when p ? 'notes' then nullif(p->>'notes', '') else notes end
  where id = p_id;
end $$;

create or replace function public.end_responsibility_assignment(p_id uuid, p_end_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.responsibility_assignments%rowtype;
begin
  select * into r from public.responsibility_assignments where id = p_id for update;
  if r.id is null or r.status not in ('active', 'suspended', 'pending_approval') then raise exception 'التكليف غير فعّال'; end if;
  if not public.can_assign_responsibility(r.responsibility_id) then raise exception 'لا صلاحية لإنهاء هذا التكليف'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب الإنهاء مطلوب'; end if;
  perform public.tilal_audit_context(p_reason, 'end_responsibility_assignment');
  update public.responsibility_assignments
     set status = 'ended', end_date = greatest(start_date, coalesce(p_end_date, public.baghdad_today())),
         ended_by = auth.uid(), ended_reason = p_reason
   where id = p_id;
  perform public.hr_notify_employee(r.employee_id, 'انتهى تكليف بمسؤولية',
    'انتهى تكليفك بمسؤولية «' || (select name_ar from public.responsibility_catalog where id = r.responsibility_id)
      || '». السبب: ' || p_reason,
    '/dashboard/hr/employees/' || r.employee_id, 'عام', r.id, 'responsibility_assignment');
end $$;

-- نقل المسؤولية لموظف آخر: إنهاء القديم وفتح جديد بنفس الإعدادات، ذرّياً
create or replace function public.transfer_responsibility(p_id uuid, p_to_employee uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.responsibility_assignments%rowtype; v_new uuid; v_today date := public.baghdad_today();
begin
  select * into r from public.responsibility_assignments where id = p_id for update;
  if r.id is null or r.status <> 'active' then raise exception 'التكليف غير فعّال'; end if;
  if r.employee_id = p_to_employee then raise exception 'الموظف نفسه'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب النقل مطلوب'; end if;
  perform public.end_responsibility_assignment(p_id, greatest(r.start_date, v_today - 1), 'نقل: ' || p_reason);
  v_new := public.assign_responsibility(jsonb_build_object(
    'responsibility_id', r.responsibility_id, 'employee_id', p_to_employee, 'assignee_role', r.assignee_role,
    'supervisor_id', r.supervisor_id, 'start_date', v_today,
    'end_date', case when r.is_permanent then null else greatest(r.end_date, v_today) end,
    'is_permanent', r.is_permanent, 'priority', r.priority, 'workload_pct', r.workload_pct,
    'hours_per_week', r.hours_per_week, 'sla_hours', r.sla_hours, 'scope_filter', r.scope_filter,
    'notes', r.notes, 'reason', 'نقل: ' || p_reason));
  return v_new;
end $$;

-- ── الانتهاء التلقائي والتنبيه (cron يومي 00:10 بغداد) ─────────────
create or replace function public.responsibility_expiry_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.baghdad_today();
  v_ended_ra int; v_ended_ep int; v_warn int := 0;
  r record;
begin
  perform public.tilal_audit_context('انتهاء المدة', 'responsibility_expiry_scan');
  update public.responsibility_assignments
     set status = 'ended', ended_reason = coalesce(ended_reason, 'انتهاء المدة')
   where status in ('active', 'suspended') and end_date is not null and end_date < v_today;
  get diagnostics v_ended_ra = row_count;

  perform set_config('tilal.employee_positions', 'off', true);
  update public.employee_positions
     set status = 'ended', ended_reason = coalesce(ended_reason, 'انتهاء المدة')
   where status = 'active' and kind <> 'primary' and end_date is not null and end_date < v_today;
  get diagnostics v_ended_ep = row_count;
  perform set_config('tilal.employee_positions', '', true);

  -- تنبيه قبل 7 أيام، مرة واحدة لكل تاريخ نهاية
  for r in select ra.id, ra.employee_id, ra.supervisor_id, ra.end_date, c.name_ar
             from public.responsibility_assignments ra join public.responsibility_catalog c on c.id = ra.responsibility_id
            where ra.status = 'active' and ra.end_date between v_today and v_today + 7
              and ra.expiry_notified_on is distinct from ra.end_date loop
    perform public.hr_notify_employee(r.employee_id, 'تكليف يقترب من نهايته',
      'ينتهي تكليفك بمسؤولية «' || r.name_ar || '» في ' || r.end_date::text || '.',
      '/dashboard/hr/employees/' || r.employee_id, 'عام', r.id, 'responsibility_assignment');
    if r.supervisor_id is not null then
      perform public.hr_notify_employee(r.supervisor_id, 'تكليف تحت إشرافك يقترب من نهايته',
        'مسؤولية «' || r.name_ar || '» تنتهي في ' || r.end_date::text || '.', null, 'عام', r.id, 'responsibility_assignment');
    end if;
    update public.responsibility_assignments set expiry_notified_on = r.end_date where id = r.id;
    v_warn := v_warn + 1;
  end loop;
  for r in select ep.id, ep.employee_id, ep.end_date, p.title_ar
             from public.employee_positions ep join public.positions p on p.id = ep.position_id
            where ep.status = 'active' and ep.kind <> 'primary' and ep.end_date between v_today and v_today + 7
              and ep.expiry_notified_on is distinct from ep.end_date loop
    perform public.hr_notify_employee(r.employee_id, 'وظيفة مؤقتة تقترب من نهايتها',
      'تنتهي وظيفتك «' || r.title_ar || '» في ' || r.end_date::text || '.',
      '/dashboard/hr/employees/' || r.employee_id, 'عام', r.id, 'employee_position');
    perform set_config('tilal.employee_positions', 'off', true);
    update public.employee_positions set expiry_notified_on = r.end_date where id = r.id;
    perform set_config('tilal.employee_positions', '', true);
    v_warn := v_warn + 1;
  end loop;

  return jsonb_build_object('ended_assignments', v_ended_ra, 'ended_positions', v_ended_ep, 'warned', v_warn);
end $$;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'responsibility-expiry') then
    perform cron.unschedule('responsibility-expiry');
  end if;
  perform cron.schedule('responsibility-expiry', '10 21 * * *', 'select public.responsibility_expiry_scan();');
end $cron$;

-- ── انتهاء الخدمة ⇒ تنتهي التكليفات ──────────────────────────────
create or replace function public.employees_responsibilities_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' and old.status = 'active' then
    update public.responsibility_assignments
       set status = 'ended', end_date = greatest(start_date, coalesce(new.end_date, public.baghdad_today())),
           ended_by = auth.uid(), ended_reason = coalesce(ended_reason, 'انتهاء الخدمة')
     where employee_id = new.id and status in ('pending_approval', 'active', 'suspended');
  end if;
  return null;
end $$;
drop trigger if exists trg_employees_responsibilities_end on public.employees;
create trigger trg_employees_responsibilities_end after update of status on public.employees
  for each row execute function public.employees_responsibilities_end();

-- ── المكتبة الأولية (PART 5) — كلها معطّلة، بلا صلاحيات ولا بدل ─────────
-- «Customer Quality Control» لا تُزرع مسؤوليةً: يحلّ محلّها فريق المراجعة (230).
insert into public.responsibility_catalog (code, name_ar, name_en, owner_department_id, beneficiary_department_id,
                                           responsibility_type, is_active, is_seed)
select s.code, s.name_ar, s.name_en,
       (select id from public.departments where code = s.owner),
       (select id from public.departments where code = s.benef),
       s.rtype, false, true
  from (values
    ('hr_employee_performance_followup', 'متابعة أداء الموظفين',          'Employee Performance Follow-up',   'HR',  'HR',    'follow_up'),
    ('hr_employee_compliance',           'متابعة التزام الموظفين',        'Employee Compliance Monitoring',   'HR',  'HR',    'monitoring'),
    ('hr_customer_complaint_review',     'مراجعة شكاوى العملاء',          'Customer Complaint Review',        'HR',  'SALES', 'review'),
    ('hr_attendance_compliance',         'الالتزام بالدوام',               'Attendance Compliance',            'HR',  'HR',    'monitoring'),
    ('hr_onboarding_followup',           'متابعة تهيئة الموظفين الجدد',    'Employee Onboarding Follow-up',    'HR',  'HR',    'follow_up'),
    ('hr_training_coordination',         'تنسيق تدريب الموظفين',          'Employee Training Coordination',   'HR',  'HR',    'coordination'),
    ('hr_internal_process_audit',        'تدقيق الإجراءات الداخلية',      'Internal Process Auditing',        'HR',  'OPS',   'audit'),
    ('mkt_lead_quality',                 'مراقبة جودة الليدات',           'Lead Quality Monitoring',          'MKT', 'SALES', 'monitoring'),
    ('mkt_campaign_performance',         'مراجعة أداء الحملات',           'Campaign Performance Review',      'MKT', 'MKT',   'review'),
    ('mkt_sales_response_time',          'مراقبة سرعة رد المبيعات',       'Sales Response Time Monitoring',   'MKT', 'SALES', 'monitoring'),
    ('mkt_content_quality',              'ضبط جودة المحتوى التسويقي',     'Marketing Content Quality Control','MKT', 'MKT',   'review'),
    ('mkt_social_monitoring',            'مراقبة التواصل الاجتماعي',      'Social Media Monitoring',          'MKT', 'MKT',   'monitoring'),
    ('mkt_competitor_monitoring',        'مراقبة المنافسين',               'Competitor Monitoring',            'MKT', 'MKT',   'monitoring'),
    ('mkt_budget_followup',              'متابعة ميزانية التسويق',         'Marketing Budget Follow-up',       'MKT', 'FIN',   'follow_up'),
    ('mkt_project_documentation',        'متابعة توثيق المشاريع',          'Project Documentation Follow-up',  'MKT', 'MKT',   'follow_up'),
    ('mkt_lead_source_analysis',         'تحليل أداء مصادر الليدات',      'Lead Source Performance Analysis', 'MKT', 'MKT',   'review'),
    ('sales_lost_customer_recovery',     'استعادة العملاء المفقودين',      'Lost Customer Recovery',           'SALES','SALES','follow_up'),
    ('sales_reservation_followup',       'متابعة الحجوزات',                'Reservation Follow-up',            'SALES','SALES','follow_up'),
    ('sales_pipeline_monitoring',        'مراقبة خط المبيعات',             'Sales Pipeline Monitoring',        'SALES','SALES','monitoring'),
    ('sales_unconverted_reservations',   'متابعة الحجوزات غير المكتملة',   'Unconverted Reservation Follow-up','SALES','SALES','follow_up'),
    ('sales_customer_followup_quality',  'جودة متابعة العملاء',            'Customer Follow-up Quality',       'SALES','SALES','review'),
    ('sales_target_monitoring',          'مراقبة أهداف المبيعات',          'Sales Target Monitoring',          'SALES','SALES','monitoring'),
    ('sales_conversion_monitoring',      'مراقبة نسب التحويل',             'Sales Conversion Monitoring',      'SALES','SALES','monitoring'),
    ('sales_customer_experience',        'متابعة تجربة العميل',            'Customer Experience Follow-up',    'SALES','SALES','follow_up'),
    ('fin_overdue_installments',         'مراقبة الأقساط المتأخرة',        'Overdue Installment Monitoring',   'FIN', 'FIN',   'monitoring'),
    ('fin_collection_followup',          'متابعة التحصيل',                 'Collection Follow-up',             'FIN', 'FIN',   'follow_up'),
    ('fin_commission_verification',      'التحقق من العمولات',             'Commission Verification',          'FIN', 'FIN',   'review'),
    ('fin_reservation_payment_check',    'التحقق من دفعات الحجز',          'Reservation Payment Verification', 'FIN', 'SALES', 'review'),
    ('fin_contract_financial_review',    'المراجعة المالية لعقود البيع',   'Sales Contract Financial Review',  'FIN', 'SALES', 'review'),
    ('fin_payment_schedule_monitoring',  'مراقبة جداول الدفع',             'Payment Schedule Monitoring',      'FIN', 'FIN',   'monitoring'),
    ('fin_reconciliation',               'المطابقة المالية',               'Financial Reconciliation',         'FIN', 'FIN',   'audit'),
    ('ops_cross_dept_tasks',             'متابعة المهام بين الأقسام',      'Cross-Department Task Monitoring', 'OPS', 'OPS',   'monitoring'),
    ('ops_project_milestones',           'متابعة مراحل المشاريع',          'Project Milestone Follow-up',      'OPS', 'OPS',   'follow_up'),
    ('ops_sla_compliance',               'مراقبة الالتزام بمستوى الخدمة',  'SLA Compliance Monitoring',        'OPS', 'OPS',   'monitoring'),
    ('ops_issue_escalation',             'تصعيد المشكلات التشغيلية',       'Operational Issue Escalation',     'OPS', 'OPS',   'coordination'),
    ('ops_internal_process_monitoring',  'مراقبة الإجراءات الداخلية',      'Internal Process Monitoring',      'OPS', 'OPS',   'monitoring'),
    ('ops_document_followup',            'متابعة المستندات',               'Document Follow-up',               'ADMIN','ADMIN','follow_up'),
    ('ops_department_coordination',      'التنسيق بين الأقسام',            'Department Coordination',          'ADMIN','OPS',  'coordination')
  ) s(code, name_ar, name_en, owner, benef, rtype)
on conflict (code) do nothing;

-- ── القراءة (RLS) — الكتابة عبر الدوال فقط ───────────────────────
-- مجموعات مرة للاستعلام (DEFINER) — تمنع التكرار المتبادل بين سياستي المكتبة والتكليف، ولا دالة لكل صفّ (درس 198/211)
create or replace function public.my_responsibility_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select distinct ra.responsibility_id from public.responsibility_assignments ra
   where ra.employee_id = public.my_employee_id();
$$;
create or replace function public.my_department_responsibility_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select c.id from public.responsibility_catalog c
   where c.beneficiary_department_id in (select d.id from public.my_managed_department_ids() d);
$$;
revoke all on function public.my_responsibility_ids() from public, anon;
revoke all on function public.my_department_responsibility_ids() from public, anon;
grant execute on function public.my_responsibility_ids() to authenticated;
grant execute on function public.my_department_responsibility_ids() to authenticated;

alter table public.responsibility_catalog enable row level security;
alter table public.responsibility_permissions enable row level security;
alter table public.responsibility_kpis enable row level security;
alter table public.responsibility_assignments enable row level security;

drop policy if exists "read responsibility catalog" on public.responsibility_catalog;
create policy "read responsibility catalog" on public.responsibility_catalog for select to authenticated using (
  (select public.is_admin())
  or (select public.has_permission('responsibilities', 'read'))
  or (select public.has_permission('responsibility_assign', 'create'))
  or id in (select m.id from public.my_responsibility_ids() m)
);
drop policy if exists "read responsibility permissions" on public.responsibility_permissions;
create policy "read responsibility permissions" on public.responsibility_permissions for select to authenticated using (
  (select public.is_admin()) or (select public.has_permission('responsibilities', 'read'))
  or responsibility_id in (select m.id from public.my_responsibility_ids() m)
);
drop policy if exists "read responsibility kpis" on public.responsibility_kpis;
create policy "read responsibility kpis" on public.responsibility_kpis for select to authenticated using (
  (select public.is_admin()) or (select public.has_permission('responsibilities', 'read'))
  or responsibility_id in (select m.id from public.my_responsibility_ids() m)
);
drop policy if exists "read responsibility assignments" on public.responsibility_assignments;
create policy "read responsibility assignments" on public.responsibility_assignments for select to authenticated using (
  (select public.is_admin())
  or (select public.permission_scope('responsibility_assign', 'read')) = 'all'
  or employee_id   = (select public.my_employee_id())
  or supervisor_id = (select public.my_employee_id())
  or ((select public.permission_scope('responsibility_assign', 'read')) = 'department'
      and responsibility_id in (select m.id from public.my_department_responsibility_ids() m))
  or ((select public.permission_scope('responsibility_assign', 'read')) in ('team', 'department')
      and employee_id in (select t.id from public.my_team_employee_ids() t))
);

revoke all on public.responsibility_catalog, public.responsibility_permissions, public.responsibility_kpis,
              public.responsibility_assignments from anon;
revoke insert, update, delete, truncate, references, trigger
    on public.responsibility_catalog, public.responsibility_permissions, public.responsibility_kpis,
       public.responsibility_assignments from authenticated;
grant select on public.responsibility_catalog, public.responsibility_permissions, public.responsibility_kpis,
                public.responsibility_assignments to authenticated;

revoke all on function public.responsibility_touch() from public, anon, authenticated;
revoke all on function public.employees_responsibilities_end() from public, anon, authenticated;
revoke all on function public.responsibility_expiry_scan() from public, anon, authenticated;
revoke all on function public.assert_workload_within_capacity(uuid, numeric, date, uuid) from public, anon, authenticated;
revoke all on function public.employee_planned_workload(uuid, date) from public, anon;
grant execute on function public.employee_planned_workload(uuid, date) to authenticated;
revoke all on function public.can_manage_responsibilities() from public, anon;
revoke all on function public.can_assign_responsibility(uuid) from public, anon;
revoke all on function public.responsibility_save(jsonb) from public, anon;
revoke all on function public.responsibility_archive(uuid, text) from public, anon;
revoke all on function public.responsibility_set_permissions(uuid, jsonb, text) from public, anon;
revoke all on function public.assign_responsibility(jsonb) from public, anon;
revoke all on function public.update_responsibility_assignment(uuid, jsonb, text) from public, anon;
revoke all on function public.end_responsibility_assignment(uuid, date, text) from public, anon;
revoke all on function public.transfer_responsibility(uuid, uuid, text) from public, anon;
grant execute on function public.can_manage_responsibilities() to authenticated;
grant execute on function public.can_assign_responsibility(uuid) to authenticated;
grant execute on function public.responsibility_save(jsonb) to authenticated;
grant execute on function public.responsibility_archive(uuid, text) to authenticated;
grant execute on function public.responsibility_set_permissions(uuid, jsonb, text) to authenticated;
grant execute on function public.assign_responsibility(jsonb) to authenticated;
grant execute on function public.update_responsibility_assignment(uuid, jsonb, text) to authenticated;
grant execute on function public.end_responsibility_assignment(uuid, date, text) to authenticated;
grant execute on function public.transfer_responsibility(uuid, uuid, text) to authenticated;

-- ═══ الذيل ══════════════════════════════════════════════════════════════
do $tilal_reg_end$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where idempotency_key = 'tilal:229_responsibilities') then
    raise exception 'MIGRATION_REGISTRATION_MISSING: 229_responsibilities';
  end if;
end $tilal_reg_end$;

commit;
