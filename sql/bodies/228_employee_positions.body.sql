-- 228 — تعدد الوظائف الرسمية للموظف
-- employee_positions: وظيفة أساسية واحدة فعّالة + إضافية/مؤقتة، لكلٍّ قسم ومدير ونسبة ومدة وسجلّ.
-- employees.position_id/department_id/manager_id تبقى «مرآة» الوظيفة الأساسية (نمط 216) فلا يتغيّر أي تقرير أو نطاق قائم.
-- المرجع: docs/MULTI_ROLE_OPERATIONS_DESIGN.md §٤-١. يعتمد على 227.

create table if not exists public.employee_positions (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null references public.employees(id) on delete cascade,
  position_id             uuid not null references public.positions(id),
  department_id           uuid references public.departments(id),
  kind                    text not null check (kind in ('primary', 'additional', 'temporary')),
  reports_to              uuid references public.employees(id) on delete set null,
  start_date              date not null,
  end_date                date,
  status                  text not null default 'active'
                            check (status in ('pending_approval', 'active', 'ended', 'rejected')),
  workload_pct            numeric(5,2) not null default 0 check (workload_pct between 0 and 100),
  job_description         text,
  responsibilities        text,
  grants_role_permissions boolean not null default false,
  permissions_granted_by  uuid references auth.users(id),
  permissions_granted_at  timestamptz,
  permissions_expire_on   date,
  approval_id             uuid references public.approval_requests(id),
  notes                   text,
  ended_reason            text,
  ended_by                uuid references auth.users(id),
  expiry_notified_on      date,
  created_by              uuid references auth.users(id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint employee_positions_dates_chk    check (end_date is null or end_date >= start_date),
  constraint employee_positions_temp_end_chk check (kind <> 'temporary' or end_date is not null),
  constraint employee_positions_self_chk     check (reports_to is distinct from employee_id),
  constraint employee_positions_perm_chk     check (not grants_role_permissions or permissions_granted_at is not null),
  constraint employee_positions_perm_exp_chk check (permissions_expire_on is null or end_date is null
                                                    or permissions_expire_on <= end_date),
  constraint employee_positions_ended_chk    check (status <> 'ended' or end_date is not null)
);
comment on table public.employee_positions is
  'تعيينات الموظف الوظيفية (228). الأساسية الفعّالة واحدة، وأعمدة employees الثلاثة مرآتها. لا حذف: الإنهاء = end_date + ended.';

create unique index if not exists employee_positions_one_primary_uq
  on public.employee_positions (employee_id) where kind = 'primary' and status = 'active';
create index if not exists employee_positions_emp_idx  on public.employee_positions (employee_id, status);
create index if not exists employee_positions_pos_idx  on public.employee_positions (position_id);
create index if not exists employee_positions_dept_idx on public.employee_positions (department_id);
create index if not exists employee_positions_rep_idx  on public.employee_positions (reports_to);

-- ── الحرّاس ──────────────────────────────────────────────────
create or replace function public.employee_positions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.department_id is null then
    select p.department_id into new.department_id from public.positions p where p.id = new.position_id;
  end if;
  if new.status = 'ended' and new.end_date is null then
    new.end_date := public.baghdad_today();
  end if;
  -- لا تعيينان متداخلان زمنياً لنفس المنصب لنفس الموظف (بديل exclusion constraint — btree_gist غير مثبّت)
  if new.status in ('active', 'pending_approval') and exists (
       select 1 from public.employee_positions o
        where o.employee_id = new.employee_id and o.position_id = new.position_id and o.id <> new.id
          and o.status in ('active', 'pending_approval')
          and daterange(o.start_date, o.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'الموظف معيَّن على هذا المنصب في فترة متداخلة';
  end if;
  if tg_op = 'INSERT' and new.status = 'active' and exists (
       select 1 from public.positions p where p.id = new.position_id and p.status <> 'نشط') then
    raise exception 'المنصب مؤرشف';
  end if;
  return new;
end $$;

drop trigger if exists trg_employee_positions_guard on public.employee_positions;
create trigger trg_employee_positions_guard before insert or update on public.employee_positions
  for each row execute function public.employee_positions_guard();

drop trigger if exists trg_audit_employee_positions on public.employee_positions;
create trigger trg_audit_employee_positions after insert or update or delete on public.employee_positions
  for each row execute function public.audit_row();

-- ── المرآة: الأساسية ⇒ employees ───────────────────────────────
create or replace function public.employee_positions_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tilal.employee_positions', true), '') = 'off' then
    return null;
  end if;
  if new.kind = 'primary' and new.status = 'active' then
    perform set_config('tilal.employee_positions', 'off', true);
    update public.employees e
       set position_id   = new.position_id,
           department_id = coalesce(new.department_id, e.department_id),
           manager_id    = new.reports_to
     where e.id = new.employee_id
       and (e.position_id is distinct from new.position_id
            or e.department_id is distinct from coalesce(new.department_id, e.department_id)
            or e.manager_id is distinct from new.reports_to);
    perform set_config('tilal.employee_positions', '', true);
  end if;
  return null;
end $$;

drop trigger if exists trg_employee_positions_mirror on public.employee_positions;
create trigger trg_employee_positions_mirror after insert or update on public.employee_positions
  for each row execute function public.employee_positions_mirror();

-- ── العكس: الكتابة القديمة على employees (نموذج HR) ⇒ تاريخ الوظيفة ──────
create or replace function public.employees_positions_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prim  public.employee_positions%rowtype;
  v_today date := public.baghdad_today();
begin
  if coalesce(current_setting('tilal.employee_positions', true), '') = 'off' then
    return null;
  end if;
  perform set_config('tilal.employee_positions', 'off', true);

  if tg_op = 'INSERT' then
    if new.position_id is not null then
      insert into public.employee_positions (employee_id, position_id, department_id, kind, reports_to,
                                             start_date, status, workload_pct, notes)
      values (new.id, new.position_id, new.department_id, 'primary', new.manager_id,
              coalesce(new.hire_date, v_today),
              case when new.status = 'active' then 'active' else 'ended' end,
              100, 'من سجلّ الموظف');
    end if;
  else
    select * into v_prim from public.employee_positions
     where employee_id = new.id and kind = 'primary' and status = 'active';

    if new.position_id is distinct from old.position_id then
      if v_prim.id is not null then
        update public.employee_positions
           set status = 'ended', end_date = greatest(start_date, v_today - 1),
               ended_by = auth.uid(), ended_reason = coalesce(ended_reason, 'تغيير المنصب من سجلّ الموظف')
         where id = v_prim.id;
      end if;
      if new.position_id is not null and new.status = 'active' then
        insert into public.employee_positions (employee_id, position_id, department_id, kind, reports_to,
                                               start_date, status, workload_pct, notes)
        values (new.id, new.position_id, new.department_id, 'primary', new.manager_id,
                v_today, 'active', coalesce(v_prim.workload_pct, 100), 'من سجلّ الموظف');
      end if;
    elsif v_prim.id is not null
          and (new.department_id is distinct from old.department_id or new.manager_id is distinct from old.manager_id) then
      update public.employee_positions
         set department_id = coalesce(new.department_id, department_id), reports_to = new.manager_id
       where id = v_prim.id;
    end if;

    -- انتهاء الخدمة: كل التعيينات الفعّالة تنتهي (السجلّ يبقى)
    if new.status <> 'active' and old.status = 'active' then
      update public.employee_positions
         set status = 'ended', end_date = greatest(start_date, coalesce(new.end_date, v_today)),
             ended_by = auth.uid(), ended_reason = coalesce(ended_reason, 'انتهاء الخدمة')
       where employee_id = new.id and status in ('active', 'pending_approval');
    end if;
  end if;

  perform set_config('tilal.employee_positions', '', true);
  return null;
end $$;

drop trigger if exists trg_employees_positions_sync on public.employees;
create trigger trg_employees_positions_sync
  after insert or update of position_id, department_id, manager_id, status on public.employees
  for each row execute function public.employees_positions_sync();

-- ── الترحيل: وظيفة أساسية لكل موظف له منصب ─────────────────────
select set_config('tilal.employee_positions', 'off', true);
insert into public.employee_positions (employee_id, position_id, department_id, kind, reports_to,
                                       start_date, end_date, status, workload_pct, notes, created_by)
select e.id, e.position_id, e.department_id, 'primary', e.manager_id,
       coalesce(e.hire_date, e.created_at::date),
       case when e.status = 'active' then null
            else greatest(coalesce(e.hire_date, e.created_at::date), coalesce(e.end_date, public.baghdad_today())) end,
       case when e.status = 'active' then 'active' else 'ended' end,
       100, 'ترحيل 228 من سجلّ الموظف', null
  from public.employees e
 where e.position_id is not null
   and not exists (select 1 from public.employee_positions x where x.employee_id = e.id);
select set_config('tilal.employee_positions', '', true);

-- ── الحمل المخطّط (تُوسّعها 229 بالمسؤوليات، و230 بالعضويات) ──────────
create or replace function public.employee_planned_workload(p_employee uuid, p_on date default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ep.workload_pct), 0)
    from public.employee_positions ep
   where ep.employee_id = p_employee
     and ep.status in ('active', 'pending_approval')
     and ep.start_date <= coalesce(p_on, public.baghdad_today())
     and (ep.end_date is null or ep.end_date >= coalesce(p_on, public.baghdad_today()));
$$;

-- ── الصلاحية ────────────────────────────────────────────────
create or replace function public.can_manage_positions()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_permission('positions_assign', 'create');
$$;

-- تجاوز ١٠٠٪ يحتاج موافقة موثّقة (Q3). محرّك الموافقة لهذا النوع يُربط في 234؛ حتى ذلك الحين يُرفض.
create or replace function public.assert_workload_within_capacity(p_employee uuid, p_extra numeric, p_on date,
                                                                  p_exclude uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  select public.employee_planned_workload(p_employee, p_on)
         - coalesce((select ep.workload_pct from public.employee_positions ep where ep.id = p_exclude), 0)
         + coalesce(p_extra, 0)
    into v_total;
  if v_total > 100 then
    raise exception 'الحمل المخطّط سيصبح %٪ (أكثر من ١٠٠٪). خفّض نسبة وظيفة أخرى أولاً — تجاوز ١٠٠٪ يحتاج موافقة إدارية',
      round(v_total, 1);
  end if;
end $$;

-- ── دوال الكتابة ────────────────────────────────────────────
create or replace function public.assign_position(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp   public.employees%rowtype;
  v_pos   public.positions%rowtype;
  v_kind  text := coalesce(p->>'kind', 'additional');
  v_start date := coalesce((p->>'start_date')::date, public.baghdad_today());
  v_end   date := (p->>'end_date')::date;
  v_pct   numeric := coalesce((p->>'workload_pct')::numeric, 0);
  v_rep   uuid := nullif(p->>'reports_to', '')::uuid;
  v_id    uuid;
begin
  if not public.can_manage_positions() then raise exception 'لا صلاحية لتعيين الوظائف'; end if;
  if v_kind not in ('additional', 'temporary') then
    raise exception 'الوظيفة الأساسية تتغيّر من سجلّ الموظف أو بـ set_primary_position';
  end if;
  select * into v_emp from public.employees where id = (p->>'employee_id')::uuid;
  if v_emp.id is null or v_emp.status <> 'active' then raise exception 'الموظف غير موجود أو غير نشط'; end if;
  select * into v_pos from public.positions where id = (p->>'position_id')::uuid;
  if v_pos.id is null or v_pos.status <> 'نشط' then raise exception 'المنصب غير موجود أو مؤرشف'; end if;
  if v_rep is not null and not exists (select 1 from public.employees where id = v_rep and status = 'active') then
    raise exception 'المدير المختار غير نشط';
  end if;
  perform public.assert_workload_within_capacity(v_emp.id, v_pct, v_start);

  perform public.tilal_audit_context(coalesce(p->>'reason', 'تعيين وظيفة'), 'assign_position');
  insert into public.employee_positions (employee_id, position_id, department_id, kind, reports_to, start_date,
                                         end_date, status, workload_pct, job_description, responsibilities, notes)
  values (v_emp.id, v_pos.id, coalesce(nullif(p->>'department_id', '')::uuid, v_pos.department_id), v_kind, v_rep,
          v_start, v_end, 'active', v_pct, nullif(p->>'job_description', ''), nullif(p->>'responsibilities', ''),
          nullif(p->>'notes', ''))
  returning id into v_id;

  perform public.hr_notify_employee(v_emp.id, 'وظيفة جديدة: ' || v_pos.title_ar,
    'كُلّفت بوظيفة ' || case v_kind when 'temporary' then 'مؤقتة' else 'إضافية' end || ' «' || v_pos.title_ar || '» من '
      || v_start::text || coalesce(' حتى ' || v_end::text, '') || '.',
    '/dashboard/hr/employees/' || v_emp.id, 'عام', v_id, 'employee_position');
  return v_id;
end $$;

create or replace function public.update_position_assignment(p_id uuid, p jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.employee_positions%rowtype;
begin
  if not public.can_manage_positions() then raise exception 'لا صلاحية لتعديل الوظائف'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التعديل مطلوب'; end if;
  select * into r from public.employee_positions where id = p_id for update;
  if r.id is null or r.status not in ('active', 'pending_approval') then raise exception 'التعيين غير فعّال'; end if;
  if p ? 'workload_pct' then
    perform public.assert_workload_within_capacity(r.employee_id, (p->>'workload_pct')::numeric, public.baghdad_today(), r.id);
  end if;
  if p ? 'end_date' and r.kind = 'primary' then
    raise exception 'الوظيفة الأساسية لا تُنهى بتاريخ — تنتهي بتغييرها أو بانتهاء الخدمة';
  end if;
  perform public.tilal_audit_context(p_reason, 'update_position_assignment');
  update public.employee_positions
     set reports_to       = case when p ? 'reports_to' then nullif(p->>'reports_to', '')::uuid else reports_to end,
         department_id    = case when p ? 'department_id' then nullif(p->>'department_id', '')::uuid else department_id end,
         workload_pct     = case when p ? 'workload_pct' then (p->>'workload_pct')::numeric else workload_pct end,
         end_date         = case when p ? 'end_date' then (p->>'end_date')::date else end_date end,
         job_description  = case when p ? 'job_description' then nullif(p->>'job_description', '') else job_description end,
         responsibilities = case when p ? 'responsibilities' then nullif(p->>'responsibilities', '') else responsibilities end,
         notes            = case when p ? 'notes' then nullif(p->>'notes', '') else notes end
   where id = p_id;
end $$;

create or replace function public.end_position_assignment(p_id uuid, p_end_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.employee_positions%rowtype;
begin
  if not public.can_manage_positions() then raise exception 'لا صلاحية لإنهاء الوظائف'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب الإنهاء مطلوب'; end if;
  select * into r from public.employee_positions where id = p_id for update;
  if r.id is null or r.status not in ('active', 'pending_approval') then raise exception 'التعيين غير فعّال'; end if;
  if r.kind = 'primary' then raise exception 'الوظيفة الأساسية تتغيّر بـ set_primary_position أو تنتهي بانتهاء الخدمة'; end if;
  perform public.tilal_audit_context(p_reason, 'end_position_assignment');
  update public.employee_positions
     set status = 'ended', end_date = greatest(start_date, coalesce(p_end_date, public.baghdad_today())),
         ended_by = auth.uid(), ended_reason = p_reason
   where id = p_id;
  perform public.hr_notify_employee(r.employee_id, 'انتهى تكليف وظيفي',
    'انتهت وظيفتك «' || (select title_ar from public.positions where id = r.position_id) || '». السبب: ' || p_reason,
    '/dashboard/hr/employees/' || r.employee_id, 'عام', r.id, 'employee_position');
end $$;

-- ترقية/نقل: تعيين فعّال (إضافي/مؤقت) يصبح الأساسي؛ الأساسي السابق يُنهى. ذرّي.
create or replace function public.set_primary_position(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.employee_positions%rowtype;
  v_old public.employee_positions%rowtype;
  v_today date := public.baghdad_today();
  v_new uuid;
begin
  if not public.can_manage_positions() then raise exception 'لا صلاحية لتغيير الوظيفة الأساسية'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب التغيير مطلوب'; end if;
  select * into r from public.employee_positions where id = p_id for update;
  if r.id is null or r.status <> 'active' or r.kind = 'primary' then raise exception 'اختر تعييناً إضافياً أو مؤقتاً فعّالاً'; end if;
  select * into v_old from public.employee_positions
   where employee_id = r.employee_id and kind = 'primary' and status = 'active' for update;

  perform public.tilal_audit_context(p_reason, 'set_primary_position');
  if v_old.id is not null then
    update public.employee_positions
       set status = 'ended', end_date = greatest(start_date, v_today - 1), ended_by = auth.uid(), ended_reason = p_reason
     where id = v_old.id;
  end if;
  update public.employee_positions
     set status = 'ended', end_date = greatest(start_date, v_today - 1), ended_by = auth.uid(),
         ended_reason = 'أصبحت الوظيفة الأساسية'
   where id = r.id;
  insert into public.employee_positions (employee_id, position_id, department_id, kind, reports_to, start_date,
                                         status, workload_pct, job_description, responsibilities, notes)
  values (r.employee_id, r.position_id, r.department_id, 'primary', r.reports_to, v_today, 'active',
          greatest(r.workload_pct, coalesce(v_old.workload_pct, 0)), r.job_description, r.responsibilities, p_reason)
  returning id into v_new;   -- المحفّز يحدّث employees (المنصب، القسم، المدير)
  return v_new;
end $$;

-- Q4: صلاحيات دور المنصب للتعيين الإضافي — المدير العام وحده، بتاريخ منح وانتهاء
create or replace function public.set_position_permissions(p_id uuid, p_on boolean, p_expire_on date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.employee_positions%rowtype;
begin
  if not public.is_admin() then raise exception 'تفعيل صلاحيات الوظيفة للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  select * into r from public.employee_positions where id = p_id for update;
  if r.id is null or r.status <> 'active' then raise exception 'التعيين غير فعّال'; end if;
  if r.kind = 'primary' then raise exception 'صلاحيات الوظيفة الأساسية تأتي من دور الحساب'; end if;
  if (select user_id from public.employees where id = r.employee_id) = auth.uid() then
    raise exception 'لا يمنح أحدٌ نفسه صلاحيات';
  end if;
  perform public.tilal_audit_context(p_reason, 'set_position_permissions');
  update public.employee_positions
     set grants_role_permissions = p_on,
         permissions_granted_by  = case when p_on then auth.uid() end,
         permissions_granted_at  = case when p_on then now() end,
         permissions_expire_on   = case when p_on then coalesce(p_expire_on, end_date) end
   where id = p_id;
end $$;

-- ── القراءة: RLS (الكتابة عبر الدوال فقط) ───────────────────────
alter table public.employee_positions enable row level security;
drop policy if exists "read employee positions" on public.employee_positions;
create policy "read employee positions" on public.employee_positions for select to authenticated using (
  (select public.is_admin())
  or (select public.permission_scope('positions_assign', 'read')) = 'all'
  or employee_id = (select public.my_employee_id())
  or reports_to  = (select public.my_employee_id())
  or ((select public.permission_scope('positions_assign', 'read')) in ('team', 'department')
      and employee_id in (select t.id from public.my_team_employee_ids() t))
  or ((select public.permission_scope('positions_assign', 'read')) = 'department'
      and department_id in (select d.id from public.my_managed_department_ids() d))
);
revoke all on public.employee_positions from anon;
revoke insert, update, delete, truncate, references, trigger on public.employee_positions from authenticated;
grant select on public.employee_positions to authenticated;

revoke all on function public.employee_positions_guard() from public, anon, authenticated;
revoke all on function public.employee_positions_mirror() from public, anon, authenticated;
revoke all on function public.employees_positions_sync() from public, anon, authenticated;
revoke all on function public.assert_workload_within_capacity(uuid, numeric, date, uuid) from public, anon, authenticated;
revoke all on function public.employee_planned_workload(uuid, date) from public, anon;
revoke all on function public.can_manage_positions() from public, anon;
revoke all on function public.assign_position(jsonb) from public, anon;
revoke all on function public.update_position_assignment(uuid, jsonb, text) from public, anon;
revoke all on function public.end_position_assignment(uuid, date, text) from public, anon;
revoke all on function public.set_primary_position(uuid, text) from public, anon;
revoke all on function public.set_position_permissions(uuid, boolean, date, text) from public, anon;
grant execute on function public.employee_planned_workload(uuid, date) to authenticated;
grant execute on function public.can_manage_positions() to authenticated;
grant execute on function public.assign_position(jsonb) to authenticated;
grant execute on function public.update_position_assignment(uuid, jsonb, text) to authenticated;
grant execute on function public.end_position_assignment(uuid, date, text) to authenticated;
grant execute on function public.set_primary_position(uuid, text) to authenticated;
grant execute on function public.set_position_permissions(uuid, boolean, date, text) to authenticated;
