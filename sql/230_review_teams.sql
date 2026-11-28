-- ════════════════════════════════════════════════════════════════════════
-- 230_review_teams — فريق ضبط الجودة المستقل متعدد الأقسام + أنواع المراجعة
-- يُطبَّق عبر apply_migration (يسجّل نفسه في supabase_migrations). المرجع: docs/MULTI_ROLE_OPERATIONS_DESIGN.md §٥-١، §٥-٢.
--   • review_teams: كيان تشغيلي — ليس قسماً في departments.
--   • review_team_members: سجلّ تاريخي؛ تغيير الدور أو الإيقاف لا يعدّل الصفّ بل يغلقه ويفتح غيره.
--     الأعضاء يبقون تابعين إدارياً لأقسامهم (لا يمسّ employees).
--   • review_types / review_outcomes / review_criteria: Customer QC مفعّل، والأنواع المستقبلية معطّلة.
--   • contact_policy (Q11) و sla_policy (Q12) قابلة للتعديل من المدير العام.
--   • البذرة: فريق «draft» بلا أعضاء — المدير العام يختار القائد والأعضاء من الواجهة ثم يفعّل.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.review_types (
  code                           text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar                        text not null,
  description                    text,
  is_active                      boolean not null default false,
  subject_kind                   text not null default 'generic'
                                   check (subject_kind in ('lost_sale', 'client', 'opportunity', 'campaign', 'task', 'generic')),
  task_template_id               uuid references public.task_templates(id),
  trigger_rule                   jsonb not null default '{}'::jsonb,
  form_schema                    jsonb not null default '[]'::jsonb,
  conflict_sources               text[] not null default array['loser','opportunity_owner','client_owners','supervisors','team','participants'],
  contact_policy                 jsonb not null default '{}'::jsonb,
  sla_policy                     jsonb not null default '{}'::jsonb,
  approval_required              boolean not null default true,
  visible_to_subject_after_close boolean not null default true,
  sort_order                     int not null default 0,
  updated_at                     timestamptz not null default now()
);

create table if not exists public.review_outcomes (
  id                     uuid primary key default gen_random_uuid(),
  review_type            text not null references public.review_types(code),
  code                   text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar                text not null,
  name_en                text,
  counts_as_subject_fault boolean not null default false,
  requires_actions       boolean not null default false,
  is_active              boolean not null default true,
  sort_order             int not null default 0,
  unique (review_type, code)
);

create table if not exists public.review_criteria (
  id          uuid primary key default gen_random_uuid(),
  review_type text not null references public.review_types(code),
  code        text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar     text not null,
  weight      numeric not null check (weight > 0),
  scale_max   int not null default 5 check (scale_max between 2 and 10),
  guidance    text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  unique (review_type, code)
);

create table if not exists public.review_teams (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name_ar                text not null,
  name_en                text,
  description            text,
  status                 text not null default 'draft' check (status in ('draft', 'active', 'suspended', 'archived')),
  escalation_employee_id uuid references public.employees(id) on delete set null,
  settings               jsonb not null default '{}'::jsonb,
  created_by             uuid references auth.users(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz
);
comment on table public.review_teams is
  'فرق المراجعة (230): كيان تشغيلي مستقل، ليس قسماً. أعضاؤه من أي قسم ويبقون تابعين إدارياً لأقسامهم.';

create table if not exists public.review_team_types (
  team_id     uuid not null references public.review_teams(id) on delete cascade,
  review_type text not null references public.review_types(code),
  primary key (team_id, review_type)
);

create table if not exists public.review_team_members (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.review_teams(id),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  member_role      text not null check (member_role in ('leader', 'reviewer', 'member')),
  specializations  jsonb not null default '{}'::jsonb,
  max_open_reviews int not null default 10 check (max_open_reviews between 1 and 200),
  workload_pct     numeric(5,2) not null default 0 check (workload_pct between 0 and 100),
  start_date       date not null,
  end_date         date,
  status           text not null default 'active' check (status in ('pending_approval', 'active', 'suspended', 'ended')),
  allowance_id     uuid,
  approval_id      uuid references public.approval_requests(id),
  notes            text,
  added_by         uuid references auth.users(id) default auth.uid(),
  ended_by         uuid references auth.users(id),
  ended_reason     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint review_team_members_dates_chk check (end_date is null or end_date >= start_date),
  constraint review_team_members_ended_chk check (status <> 'ended' or end_date is not null)
);
comment on table public.review_team_members is
  'عضوية فرق المراجعة (230) — سجلّ تاريخي: تغيير الدور = إغلاق الصفّ وفتح صفّ جديد.';

create unique index if not exists review_team_members_open_uq
  on public.review_team_members (team_id, employee_id) where status in ('pending_approval', 'active', 'suspended');
create unique index if not exists review_team_members_one_leader_uq
  on public.review_team_members (team_id) where member_role = 'leader' and status = 'active';
create index if not exists review_team_members_emp_idx on public.review_team_members (employee_id, status);

-- ── الختم والتدقيق ─────────────────────────────────────────────
create or replace function public.review_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name = 'review_team_members' then
    if new.status = 'ended' and new.end_date is null then
      new.end_date := greatest(new.start_date, public.baghdad_today());
    end if;
  end if;
  return new;
end $$;

create trigger trg_review_teams_touch before update on public.review_teams
  for each row execute function public.review_touch();
create trigger trg_review_team_members_touch before insert or update on public.review_team_members
  for each row execute function public.review_touch();
create trigger trg_review_types_touch before update on public.review_types
  for each row execute function public.review_touch();
create trigger trg_audit_review_teams after insert or update or delete on public.review_teams
  for each row execute function public.audit_row();
create trigger trg_audit_review_team_members after insert or update or delete on public.review_team_members
  for each row execute function public.audit_row();
create trigger trg_audit_review_types after insert or update or delete on public.review_types
  for each row execute function public.audit_row();

-- ── الحمل المخطّط: + العضويات ──────────────────────────────────
create or replace function public.employee_planned_workload(p_employee uuid, p_on date default null)
returns numeric language sql stable security definer set search_path = public as $$
  with d as (select coalesce(p_on, public.baghdad_today()) as on_day)
  select coalesce((select sum(ep.workload_pct) from public.employee_positions ep, d
                    where ep.employee_id = p_employee and ep.status in ('active', 'pending_approval')
                      and ep.start_date <= d.on_day and (ep.end_date is null or ep.end_date >= d.on_day)), 0)
       + coalesce((select sum(ra.workload_pct) from public.responsibility_assignments ra, d
                    where ra.employee_id = p_employee and ra.status in ('active', 'pending_approval', 'suspended')
                      and ra.start_date <= d.on_day and (ra.end_date is null or ra.end_date >= d.on_day)), 0)
       + coalesce((select sum(m.workload_pct) from public.review_team_members m, d
                    where m.employee_id = p_employee and m.status in ('active', 'pending_approval', 'suspended')
                      and m.start_date <= d.on_day and (m.end_date is null or m.end_date >= d.on_day)), 0);
$$;

create or replace function public.assert_workload_within_capacity(p_employee uuid, p_extra numeric, p_on date,
                                                                  p_exclude uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  select public.employee_planned_workload(p_employee, p_on)
         - coalesce((select ep.workload_pct from public.employee_positions ep where ep.id = p_exclude), 0)
         - coalesce((select ra.workload_pct from public.responsibility_assignments ra where ra.id = p_exclude), 0)
         - coalesce((select m.workload_pct from public.review_team_members m where m.id = p_exclude), 0)
         + coalesce(p_extra, 0)
    into v_total;
  if v_total > 100 then
    raise exception 'الحمل المخطّط سيصبح %٪ (أكثر من ١٠٠٪). خفّض نسبة وظيفة أو مسؤولية أخرى أولاً — تجاوز ١٠٠٪ يحتاج موافقة إدارية',
      round(v_total, 1);
  end if;
end $$;

-- ── مساعدات القراءة (مرة للاستعلام) ──────────────────────────────
create or replace function public.my_review_team_ids()
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select distinct m.team_id from public.review_team_members m
   where m.employee_id = public.my_employee_id() and m.status in ('active', 'suspended');
$$;
create or replace function public.my_review_team_role(p_team uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.member_role from public.review_team_members m
   where m.team_id = p_team and m.employee_id = public.my_employee_id() and m.status = 'active'
   limit 1;
$$;

-- ── إدارة الفريق: المدير العام وحده (Q2) ─────────────────────────
create or replace function public.review_team_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_t text;
begin
  if not public.is_admin() then raise exception 'إدارة فرق المراجعة للمدير العام فقط'; end if;
  perform public.tilal_audit_context(coalesce(nullif(p->>'reason', ''), 'تعديل فريق المراجعة'), 'review_team_save');
  if v_id is null then
    insert into public.review_teams (code, name_ar, name_en, description, escalation_employee_id, settings)
    values (p->>'code', p->>'name_ar', nullif(p->>'name_en', ''), nullif(p->>'description', ''),
            nullif(p->>'escalation_employee_id', '')::uuid, coalesce(p->'settings', '{}'::jsonb))
    returning id into v_id;
  else
    update public.review_teams t set
      name_ar                = coalesce(p->>'name_ar', t.name_ar),
      name_en                = case when p ? 'name_en' then nullif(p->>'name_en', '') else t.name_en end,
      description            = case when p ? 'description' then nullif(p->>'description', '') else t.description end,
      escalation_employee_id = case when p ? 'escalation_employee_id' then nullif(p->>'escalation_employee_id', '')::uuid else t.escalation_employee_id end,
      settings               = coalesce(p->'settings', t.settings)
    where t.id = v_id and t.archived_at is null;
    if not found then raise exception 'الفريق غير موجود أو مؤرشف'; end if;
  end if;
  if p ? 'review_types' then
    for v_t in select jsonb_array_elements_text(p->'review_types') loop
      if not exists (select 1 from public.review_types where code = v_t) then raise exception 'نوع مراجعة غير معروف: %', v_t; end if;
      insert into public.review_team_types (team_id, review_type) values (v_id, v_t) on conflict do nothing;
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.review_team_set_status(p_team uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.review_teams%rowtype;
begin
  if not public.is_admin() then raise exception 'إدارة فرق المراجعة للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if p_status not in ('active', 'suspended', 'archived') then raise exception 'الحالة: فعّال، موقوف، مؤرشف'; end if;
  select * into t from public.review_teams where id = p_team for update;
  if t.id is null or t.archived_at is not null then raise exception 'الفريق غير موجود أو مؤرشف'; end if;
  if p_status = 'active' then
    if not exists (select 1 from public.review_team_members where team_id = p_team and member_role = 'leader' and status = 'active') then
      raise exception 'لا يُفعَّل الفريق بلا قائد — عيّن القائد أولاً';
    end if;
    if not exists (select 1 from public.review_team_types where team_id = p_team) then
      raise exception 'حدّد أنواع المراجعة التي يتولّاها الفريق';
    end if;
  end if;
  if p_status = 'archived' and exists (select 1 from public.review_team_members
                                        where team_id = p_team and status in ('active', 'suspended', 'pending_approval')) then
    raise exception 'أنهِ العضويات الفعّالة قبل الأرشفة';
  end if;
  perform public.tilal_audit_context(p_reason, 'review_team_set_status');
  update public.review_teams
     set status = p_status, archived_at = case when p_status = 'archived' then now() end
   where id = p_team;
end $$;

create or replace function public.team_add_member(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.review_teams%rowtype;
  v_emp public.employees%rowtype;
  v_role text := coalesce(p->>'member_role', 'member');
  v_start date := coalesce((p->>'start_date')::date, public.baghdad_today());
  v_pct numeric := coalesce((p->>'workload_pct')::numeric, 0);
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'إضافة الأعضاء للمدير العام فقط'; end if;
  select * into t from public.review_teams where id = (p->>'team_id')::uuid;
  if t.id is null or t.archived_at is not null then raise exception 'الفريق غير موجود أو مؤرشف'; end if;
  select * into v_emp from public.employees where id = (p->>'employee_id')::uuid;
  if v_emp.id is null or v_emp.status <> 'active' then raise exception 'الموظف غير موجود أو غير نشط'; end if;
  if v_emp.user_id is null then raise exception 'الموظف بلا حساب دخول — لا يستطيع العمل على المراجعات'; end if;
  if v_role not in ('leader', 'reviewer', 'member') then raise exception 'الدور: قائد، مراجع، عضو'; end if;
  if v_role = 'leader' and exists (select 1 from public.review_team_members
                                    where team_id = t.id and member_role = 'leader' and status = 'active') then
    raise exception 'للفريق قائد — استعمل تغيير القائد';
  end if;
  if exists (select 1 from public.review_team_members where team_id = t.id and employee_id = v_emp.id
              and status in ('pending_approval', 'active', 'suspended')) then
    raise exception 'الموظف عضو في الفريق — غيّر دوره بدل إضافته مرة أخرى';
  end if;
  perform public.assert_workload_within_capacity(v_emp.id, v_pct, v_start);
  perform public.tilal_audit_context(coalesce(nullif(p->>'reason', ''), 'إضافة عضو'), 'team_add_member');
  insert into public.review_team_members (team_id, employee_id, member_role, specializations, max_open_reviews,
                                          workload_pct, start_date, notes)
  values (t.id, v_emp.id, v_role, coalesce(p->'specializations', '{}'::jsonb),
          coalesce((p->>'max_open_reviews')::int, 10), v_pct, v_start, nullif(p->>'notes', ''))
  returning id into v_id;
  perform public.hr_notify_employee(v_emp.id, 'انضممت إلى ' || t.name_ar,
    'أصبحت ' || case v_role when 'leader' then 'قائداً' when 'reviewer' then 'مراجعاً' else 'عضواً' end
      || ' في «' || t.name_ar || '». تبقى تبعيتك الإدارية لقسمك.',
    '/dashboard/quality', 'عام', v_id, 'review_team_member');
  return v_id;
end $$;

-- إغلاق صفّ عضوية (داخلي)
create or replace function public.team_close_membership(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.review_team_members
     set status = 'ended', end_date = greatest(start_date, public.baghdad_today()),
         ended_by = auth.uid(), ended_reason = p_reason
   where id = p_id and status in ('pending_approval', 'active', 'suspended');
end $$;

create or replace function public.team_change_member_role(p_member uuid, p_role text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.review_team_members%rowtype; v_new uuid;
begin
  if not public.is_admin() then raise exception 'تغيير الأدوار للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if p_role not in ('reviewer', 'member') then raise exception 'القائد يتغيّر بتغيير القائد'; end if;
  select * into m from public.review_team_members where id = p_member for update;
  if m.id is null or m.status <> 'active' then raise exception 'العضوية غير فعّالة'; end if;
  if m.member_role = 'leader' then raise exception 'القائد يتغيّر بتغيير القائد'; end if;
  if m.member_role = p_role then raise exception 'الدور نفسه'; end if;
  perform public.tilal_audit_context(p_reason, 'team_change_member_role');
  perform public.team_close_membership(m.id, 'تغيير الدور: ' || p_reason);
  insert into public.review_team_members (team_id, employee_id, member_role, specializations, max_open_reviews,
                                          workload_pct, start_date, notes)
  values (m.team_id, m.employee_id, p_role, m.specializations, m.max_open_reviews, m.workload_pct,
          public.baghdad_today(), m.notes)
  returning id into v_new;
  return v_new;
end $$;

-- تغيير القائد ذرّياً: القائد السابق يصبح عضواً (أو يُنهى)، والجديد قائد
create or replace function public.team_set_leader(p_team uuid, p_employee uuid, p_reason text, p_keep_old_as_member boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare old public.review_team_members%rowtype; cur public.review_team_members%rowtype; v_new uuid; v_pct numeric := 0;
begin
  if not public.is_admin() then raise exception 'تعيين القائد للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if not exists (select 1 from public.review_teams where id = p_team and archived_at is null) then
    raise exception 'الفريق غير موجود أو مؤرشف';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and status = 'active' and user_id is not null) then
    raise exception 'الموظف غير نشط أو بلا حساب';
  end if;
  perform public.tilal_audit_context(p_reason, 'team_set_leader');
  select * into old from public.review_team_members where team_id = p_team and member_role = 'leader' and status = 'active' for update;
  if old.employee_id = p_employee then raise exception 'هو القائد الحالي'; end if;
  select * into cur from public.review_team_members
   where team_id = p_team and employee_id = p_employee and status in ('active', 'suspended', 'pending_approval') for update;
  if cur.id is not null then
    v_pct := cur.workload_pct;
    perform public.team_close_membership(cur.id, 'أصبح القائد: ' || p_reason);
  end if;
  if old.id is not null then
    perform public.team_close_membership(old.id, 'تغيير القائد: ' || p_reason);
    if p_keep_old_as_member then
      insert into public.review_team_members (team_id, employee_id, member_role, specializations, max_open_reviews,
                                              workload_pct, start_date)
      values (p_team, old.employee_id, 'member', old.specializations, old.max_open_reviews, old.workload_pct, public.baghdad_today());
    end if;
  end if;
  insert into public.review_team_members (team_id, employee_id, member_role, specializations, max_open_reviews,
                                          workload_pct, start_date)
  values (p_team, p_employee, 'leader', coalesce(cur.specializations, '{}'::jsonb), coalesce(cur.max_open_reviews, 10),
          v_pct, public.baghdad_today())
  returning id into v_new;
  perform public.hr_notify_employee(p_employee, 'أصبحت قائد فريق المراجعة',
    'عُيّنت قائداً لـ «' || (select name_ar from public.review_teams where id = p_team) || '».',
    '/dashboard/quality', 'عام', v_new, 'review_team_member');
  return v_new;
end $$;

create or replace function public.team_set_member_status(p_member uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.review_team_members%rowtype; t public.review_teams%rowtype;
begin
  if not public.is_admin() then raise exception 'إدارة العضويات للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if p_action not in ('suspend', 'resume', 'end') then raise exception 'الإجراء: إيقاف، استئناف، إنهاء'; end if;
  select * into m from public.review_team_members where id = p_member for update;
  if m.id is null or m.status not in ('active', 'suspended', 'pending_approval') then raise exception 'العضوية غير فعّالة'; end if;
  select * into t from public.review_teams where id = m.team_id;
  if m.member_role = 'leader' and p_action <> 'resume' and t.status = 'active' then
    raise exception 'لا يُوقف قائد فريق فعّال ولا يُنهى — عيّن قائداً آخر أولاً';
  end if;
  perform public.tilal_audit_context(p_reason, 'team_set_member_status');
  if p_action = 'end' then
    perform public.team_close_membership(m.id, p_reason);
  else
    update public.review_team_members
       set status = case p_action when 'suspend' then 'suspended' else 'active' end
     where id = m.id;
  end if;
end $$;

-- Q11 / Q12: سياسة الاتصال وSLA قابلة للتعديل — المدير العام، بحدود منطقية
create or replace function public.review_type_set_policy(p_code text, p_contact jsonb, p_sla jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'سياسات المراجعة للمدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if p_contact is not null and (
       coalesce((p_contact->>'min_attempts')::int, 0) < 1 or coalesce((p_contact->>'min_distinct_days')::int, 0) < 1
       or coalesce((p_contact->>'min_channels')::int, 0) < 1 or coalesce((p_contact->>'min_hours_between')::numeric, -1) < 0
       or (p_contact->>'min_distinct_days')::int > (p_contact->>'min_attempts')::int
       or (p_contact->>'min_channels')::int > (p_contact->>'min_attempts')::int) then
    raise exception 'سياسة الاتصال غير منطقية: محاولة واحدة على الأقل، والأيام والقنوات لا تتجاوز عدد المحاولات، والفاصل غير سالب';
  end if;
  if p_sla is not null and (
       coalesce((p_sla->>'review_hours')::int, 0) < 1 or coalesce((p_sla->>'deferred_days')::int, 0) < 1
       or coalesce((p_sla->>'first_attempt_hours')::int, 0) < 1) then
    raise exception 'SLA غير منطقي: ساعات المراجعة وأيام المؤجّل ومهلة أول محاولة أكبر من صفر';
  end if;
  perform public.tilal_audit_context(p_reason, 'review_type_set_policy');
  update public.review_types
     set contact_policy = coalesce(p_contact, contact_policy), sla_policy = coalesce(p_sla, sla_policy)
   where code = p_code;
  if not found then raise exception 'نوع مراجعة غير معروف'; end if;
end $$;

-- ── انتهاء الخدمة ⇒ تنتهي العضويات؛ وقائد فريق فعّال ⇒ الفريق يُوقف ويُنبَّه المدير العام ──
create or replace function public.employees_review_membership_end()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status <> 'active' and old.status = 'active' then
    for r in select m.id, m.team_id, m.member_role from public.review_team_members m
              where m.employee_id = new.id and m.status in ('pending_approval', 'active', 'suspended') loop
      update public.review_team_members
         set status = 'ended', end_date = greatest(start_date, coalesce(new.end_date, public.baghdad_today())),
             ended_by = auth.uid(), ended_reason = 'انتهاء الخدمة'
       where id = r.id;
      if r.member_role = 'leader' then
        update public.review_teams set status = 'suspended' where id = r.team_id and status = 'active';
        perform public.hr_notify_levels(array['admin'], 'فريق مراجعة بلا قائد',
          'انتهت خدمة قائد «' || (select name_ar from public.review_teams where id = r.team_id) || '» فأُوقف الفريق — عيّن قائداً وفعّله.',
          '/dashboard/quality/team', 'عام', r.team_id, 'review_team', 'عالية');
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger trg_employees_review_membership_end after update of status on public.employees
  for each row execute function public.employees_review_membership_end();

-- ── البذور ──────────────────────────────────────────────────────
insert into public.review_types (code, name_ar, description, is_active, subject_kind, contact_policy, sla_policy, sort_order) values
  ('customer_qc', 'ضبط جودة العملاء', 'مراجعة حالات فشل البيع: السبب الحقيقي وجودة متابعة البائع', true, 'lost_sale',
   '{"min_attempts": 3, "min_distinct_days": 2, "min_channels": 2, "min_hours_between": 4, "retry_after_hours": 4}',
   '{"review_hours": 72, "deferred_days": 7, "first_attempt_hours": 24, "warn_at_pct": [75, 90], "escalate_to": "leader"}', 1),
  ('sales_qc', 'ضبط جودة المبيعات', 'مستقبلي — مراجعة إجراءات البيع والحجز', false, 'opportunity', '{}', '{}', 2),
  ('marketing_qc', 'ضبط جودة التسويق', 'مستقبلي — مراجعة الحملات والمحتوى والليدات', false, 'campaign', '{}', '{}', 3),
  ('operational_qc', 'ضبط الجودة التشغيلية', 'مستقبلي — مراجعة الإجراءات والمهام بين الأقسام', false, 'task', '{}', '{}', 4)
on conflict (code) do nothing;

insert into public.review_outcomes (review_type, code, name_ar, name_en, counts_as_subject_fault, requires_actions, sort_order) values
  ('customer_qc', 'verified_lost',     'خسارة مؤكَّدة',            'Verified Lost Sale',        false, false, 1),
  ('customer_qc', 'followup_failure',  'إخفاق في متابعة المبيعات', 'Sales Follow-up Failure',   true,  true,  2),
  ('customer_qc', 'pricing_issue',     'مشكلة تسعير',              'Pricing Issue',             false, true,  3),
  ('customer_qc', 'product_issue',     'مشكلة في المشروع/المنتج',  'Project/Product Issue',     false, true,  4),
  ('customer_qc', 'not_qualified',     'عميل غير مؤهَّل',           'Customer Not Qualified',    false, false, 5),
  ('customer_qc', 'reactivated',       'أُعيد تنشيط العميل',        'Customer Reactivated',      false, true,  6),
  ('customer_qc', 'escalated',         'تصعيد إلى الإدارة',         'Escalated to Management',   false, true,  7),
  ('customer_qc', 'unreachable',       'تعذّر الوصول بعد المحاولات', 'Customer Unreachable',      false, false, 8)
on conflict (review_type, code) do nothing;

insert into public.review_criteria (review_type, code, name_ar, weight, guidance, sort_order) values
  ('customer_qc', 'first_response',        'سرعة الرد الأول',      25, 'الزمن من دخول الليد حتى أول تواصل فعلي', 1),
  ('customer_qc', 'followup_regularity',   'انتظام المتابعة',      25, 'المتابعات في مواعيدها بلا فجوات طويلة', 2),
  ('customer_qc', 'appointment_commitment','الالتزام بالمواعيد',   20, 'المتابعات المجدولة نُفّذت أم فاتت', 3),
  ('customer_qc', 'offer_quality',         'جودة العرض',           15, 'وضوح العرض وملاءمته لاحتياج العميل (من رأي العميل)', 4),
  ('customer_qc', 'documentation',         'التوثيق في السجل',     15, 'هل يعكس السجل ما حدث فعلاً', 5)
on conflict (review_type, code) do nothing;

insert into public.review_teams (code, name_ar, description, status, created_by)
values ('quality_control', 'فريق ضبط الجودة', 'فريق مستقل متعدد الأقسام لمراجعة حالات فشل البيع وجودة المتابعة', 'draft', null)
on conflict (code) do nothing;
insert into public.review_team_types (team_id, review_type)
select id, 'customer_qc' from public.review_teams where code = 'quality_control'
on conflict do nothing;

-- ── القراءة (RLS) — الكتابة عبر الدوال فقط ───────────────────────
alter table public.review_types enable row level security;
alter table public.review_outcomes enable row level security;
alter table public.review_criteria enable row level security;
alter table public.review_teams enable row level security;
alter table public.review_team_types enable row level security;
alter table public.review_team_members enable row level security;

-- التعريفات (الأنواع والنتائج والمعايير) غير حسّاسة: يقرؤها كل حساب نشط
create policy "read review types" on public.review_types for select to authenticated using ((select public.my_account_active()));
create policy "read review outcomes" on public.review_outcomes for select to authenticated using ((select public.my_account_active()));
create policy "read review criteria" on public.review_criteria for select to authenticated using ((select public.my_account_active()));
create policy "read review teams" on public.review_teams for select to authenticated using (
  (select public.is_admin()) or (select public.has_permission('review_teams', 'read'))
  or id in (select t.id from public.my_review_team_ids() t)
);
create policy "read review team types" on public.review_team_types for select to authenticated using (
  (select public.is_admin()) or (select public.has_permission('review_teams', 'read'))
  or team_id in (select t.id from public.my_review_team_ids() t)
);
create policy "read review team members" on public.review_team_members for select to authenticated using (
  (select public.is_admin()) or (select public.has_permission('review_teams', 'read'))
  or employee_id = (select public.my_employee_id())
  or team_id in (select t.id from public.my_review_team_ids() t)
);

grant select on public.review_types, public.review_outcomes, public.review_criteria, public.review_teams,
                public.review_team_types, public.review_team_members to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.review_types, public.review_outcomes,
       public.review_criteria, public.review_teams, public.review_team_types, public.review_team_members from authenticated;
revoke all on public.review_types, public.review_outcomes, public.review_criteria, public.review_teams,
              public.review_team_types, public.review_team_members from anon;

grant execute on function public.employee_planned_workload(uuid, date) to authenticated;
grant execute on function public.my_review_team_ids() to authenticated;
grant execute on function public.my_review_team_role(uuid) to authenticated;
grant execute on function public.review_team_save(jsonb) to authenticated;
grant execute on function public.review_team_set_status(uuid, text, text) to authenticated;
grant execute on function public.team_add_member(jsonb) to authenticated;
grant execute on function public.team_change_member_role(uuid, text, text) to authenticated;
grant execute on function public.team_set_leader(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.team_set_member_status(uuid, text, text) to authenticated;
grant execute on function public.review_type_set_policy(text, jsonb, jsonb, text) to authenticated;
