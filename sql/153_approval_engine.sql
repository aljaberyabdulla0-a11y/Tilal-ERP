-- ============================================================
-- تلال ERP — 153: محرّك الموافقات العام (HR المؤسسي — المرحلة 4)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 146، 150 (hr_notify_*).
--
-- ============================================================
-- الفكرة
--
-- كل طلب يحتاج موافقة (إجازة، عمل إضافي، تعديل بصمة، مهمة، ولاحقاً
-- مصروف وسلفة وزيادة راتب) يمرّ بالمحرّك نفسه بدل أن يكتب كل وحدة
-- موافقتها بيدها:
--
--   approval_workflows  ─< approval_steps (ترتيب، نوع المُوافِق، شرط مبلغ/أيام)
--   approval_requests   ─< approval_actions (من قرّر، متى، لماذا)
--
-- أنواع المُوافِق: المدير المباشر · مدير القسم · HR · المالية ·
-- المدير العام · دور بعينه (roles) · شخص بعينه.
--
-- ============================================================
-- القواعد الثابتة
--
--   • لا أحد يوافق على طلبه هو — يُستبعد صاحب الطلب من كل خطوة.
--   • خطوةٌ لا مُوافِق لها (لا مدير مباشر، لا أحد بدور hr…) تُصعَّد
--     إلى التالية، وتُسجَّل «تصعيد». ونهاية السلسلة بلا مُوافِق ⇒ المدير.
--   • خطوةٌ شرطها لا ينطبق (مبلغ أو أيام أقل من حدّها) تُتخطّى ولا تُسجَّل.
--   • المدير (admin) يستطيع القرار في أي خطوة — «تجاوز» مسجَّل باسمه.
--   • القرار عبر approval_decide وحدها؛ الجداول للقراءة.
--   • عند الاعتماد أو الرفض النهائي تُطبَّق النتيجة على الكيان نفسه
--     (approval_apply) — تُكمِلها 154 و155 لكل نوع.
-- ============================================================


-- ============================================================
-- ١) الجداول
-- ============================================================
create table if not exists public.approval_workflows (
  code         text primary key check (code ~ '^[a-z_]{2,40}$'),
  name_ar      text not null,
  entity_type  text not null,
  description  text,
  active       boolean not null default true
);

create table if not exists public.approval_steps (
  id                uuid primary key default gen_random_uuid(),
  workflow_code     text not null references public.approval_workflows(code) on update cascade on delete cascade,
  step_no           int  not null check (step_no between 1 and 10),
  label             text not null,
  approver_kind     text not null check (approver_kind in
                      ('المدير المباشر', 'مدير القسم', 'HR', 'المالية', 'المدير العام', 'دور', 'شخص')),
  approver_role     text references public.roles(code) on update cascade on delete restrict,
  approver_user     uuid references auth.users(id) on delete set null,
  min_amount        numeric check (min_amount is null or min_amount >= 0),
  min_days          numeric check (min_days is null or min_days >= 0),
  unique (workflow_code, step_no),
  constraint approval_steps_role_needs_code check (approver_kind <> 'دور' or approver_role is not null),
  constraint approval_steps_user_needs_id check (approver_kind <> 'شخص' or approver_user is not null)
);

create table if not exists public.approval_requests (
  id                uuid primary key default gen_random_uuid(),
  workflow_code     text not null references public.approval_workflows(code) on update cascade,
  entity_type       text not null,
  entity_id         uuid not null,
  subject_employee  uuid references public.employees(id) on delete cascade,
  requested_by      uuid references auth.users(id) on delete set null,
  requested_by_name text,
  title             text not null,
  amount            numeric,
  days              numeric,
  status            text not null default 'قيد الموافقة'
                      check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى')),
  current_step      int,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);

-- طلب واحد حيّ لكل كيان
create unique index if not exists approval_requests_one_open
  on public.approval_requests (entity_type, entity_id) where status = 'قيد الموافقة';
create index if not exists approval_requests_subject_idx on public.approval_requests (subject_employee, created_at desc);

create table if not exists public.approval_actions (
  id            bigserial primary key,
  request_id    uuid not null references public.approval_requests(id) on delete cascade,
  step_no       int,
  step_label    text,
  decision      text not null check (decision in ('موافقة', 'رفض', 'تصعيد', 'تجاوز', 'إلغاء')),
  actor         uuid,
  actor_name    text,
  note          text,
  at            timestamptz not null default now()
);

create index if not exists approval_actions_req_idx on public.approval_actions (request_id, at);

comment on table public.approval_requests is
  'محرّك الموافقات (153): طلب لكل كيان يحتاج موافقة. القرار عبر approval_decide، والنتيجة تُطبَّق على الكيان.';


-- ============================================================
-- ٢) البذرة — سلاسل افتراضية يعدّلها المدير من إعدادات HR
-- ============================================================
insert into public.approval_workflows (code, name_ar, entity_type, description) values
  ('leave',          'الإجازات',              'leave',              'المدير المباشر ثم الموارد البشرية.'),
  ('leave_unpaid',   'إجازة بدون راتب',       'leave',              'تمسّ الراتب: المدير المباشر ثم HR ثم المدير العام.'),
  ('attendance',     'طلبات الدوام',          'attendance_request', 'تعديل بصمة، مهمة رسمية، عمل ميداني أو عن بُعد: المدير المباشر ثم HR.'),
  ('overtime',       'العمل الإضافي',         'overtime_request',   'المدير المباشر ثم HR.')
on conflict (code) do nothing;

insert into public.approval_steps (workflow_code, step_no, label, approver_kind) values
  ('leave', 1, 'المدير المباشر', 'المدير المباشر'),
  ('leave', 2, 'الموارد البشرية', 'HR'),
  ('leave_unpaid', 1, 'المدير المباشر', 'المدير المباشر'),
  ('leave_unpaid', 2, 'الموارد البشرية', 'HR'),
  ('leave_unpaid', 3, 'المدير العام', 'المدير العام'),
  ('attendance', 1, 'المدير المباشر', 'المدير المباشر'),
  ('attendance', 2, 'الموارد البشرية', 'HR'),
  ('overtime', 1, 'المدير المباشر', 'المدير المباشر'),
  ('overtime', 2, 'الموارد البشرية', 'HR')
on conflict (workflow_code, step_no) do nothing;


-- ============================================================
-- ٣) من يوافق في خطوة لموظفٍ بعينه
-- ============================================================
create or replace function public.approval_step_users(p_step uuid, p_subject uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.approval_steps%rowtype;
  v_subject_user uuid;
  v_dept uuid;
  v_mgr uuid;
  v_guard int := 0;
begin
  select * into s from public.approval_steps where id = p_step;
  if not found then return; end if;
  select e.user_id, e.department_id into v_subject_user, v_dept from public.employees e where e.id = p_subject;

  if s.approver_kind = 'المدير المباشر' then
    return query
      select m.user_id from public.employees e join public.employees m on m.id = e.manager_id
       where e.id = p_subject and m.status = 'active' and m.user_id is not null
         and m.user_id is distinct from v_subject_user;

  elsif s.approver_kind = 'مدير القسم' then
    -- أقرب مدير قسمٍ في السلسلة، غير صاحب الطلب
    while v_dept is not null and v_guard < 10 loop
      select d.manager_id into v_mgr from public.departments d where d.id = v_dept;
      if v_mgr is not null and v_mgr is distinct from p_subject then
        return query
          select m.user_id from public.employees m
           where m.id = v_mgr and m.status = 'active' and m.user_id is not null
             and m.user_id is distinct from v_subject_user;
        return;
      end if;
      select d.parent_id into v_dept from public.departments d where d.id = v_dept;
      v_guard := v_guard + 1;
    end loop;

  elsif s.approver_kind = 'HR' then
    return query select p.id from public.profiles p
      where p.role = 'hr' and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active');

  elsif s.approver_kind = 'المالية' then
    return query select p.id from public.profiles p
      where p.role = 'accountant' and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active');

  elsif s.approver_kind = 'المدير العام' then
    return query select p.id from public.profiles p
      where p.role_code = 'general_manager' and p.id is distinct from v_subject_user;
    if not found then
      return query select p.id from public.profiles p
        where p.role = 'admin' and p.id is distinct from v_subject_user;
    end if;

  elsif s.approver_kind = 'دور' then
    return query select p.id from public.profiles p
      where p.role_code = s.approver_role and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active');

  elsif s.approver_kind = 'شخص' then
    return query select s.approver_user where s.approver_user is distinct from v_subject_user;
  end if;
end $$;

-- الخطوة التالية القابلة للتطبيق بعد p_after، مع تسجيل التصعيد لما لا مُوافِق له
create or replace function public.approval_advance(p_request uuid, p_after int)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
  s record;
begin
  select * into r from public.approval_requests where id = p_request;
  for s in
    select st.* from public.approval_steps st
     where st.workflow_code = r.workflow_code and st.step_no > coalesce(p_after, 0)
     order by st.step_no
  loop
    -- شرطٌ لا ينطبق: لا مكان لهذه الخطوة في هذا الطلب
    if (s.min_amount is not null and coalesce(r.amount, 0) < s.min_amount)
       or (s.min_days is not null and coalesce(r.days, 0) < s.min_days) then
      continue;
    end if;
    if exists (select 1 from public.approval_step_users(s.id, r.subject_employee)) then
      return s.step_no;
    end if;
    insert into public.approval_actions (request_id, step_no, step_label, decision, actor_name, note)
    values (p_request, s.step_no, s.label, 'تصعيد', 'النظام', 'لا مُوافِق لهذه الخطوة — صُعّد الطلب');
  end loop;
  return null;
end $$;

-- من يملك القرار الآن في طلب. نهاية السلسلة بلا خطوة ⇒ المدير (admin).
create or replace function public.approval_current_approvers(p_request uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
  v_step uuid;
  v_subject_user uuid;
begin
  select * into r from public.approval_requests where id = p_request;
  if not found or r.status <> 'قيد الموافقة' then return; end if;
  select e.user_id into v_subject_user from public.employees e where e.id = r.subject_employee;

  if r.current_step is not null then
    select st.id into v_step from public.approval_steps st
     where st.workflow_code = r.workflow_code and st.step_no = r.current_step;
    return query select u.user_id from public.approval_step_users(v_step, r.subject_employee) u;
  else
    return query select p.id from public.profiles p
      where p.role = 'admin' and p.id is distinct from v_subject_user;
  end if;
end $$;

create or replace function public.can_act_on_approval(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.approval_current_approvers(p_request) a where a.user_id = auth.uid())
      or (public.is_admin() and exists (
            select 1 from public.approval_requests r
              left join public.employees e on e.id = r.subject_employee
             where r.id = p_request and r.status = 'قيد الموافقة'
               and e.user_id is distinct from auth.uid()));
$$;

create or replace function public.approval_notify_current(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
begin
  select * into r from public.approval_requests where id = p_request;
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select a.user_id, 'بانتظار موافقتك: ' || r.title,
         coalesce(r.requested_by_name, '') || coalesce(' — ' || r.days || ' يوم', '')
           || coalesce(' — ' || to_char(r.amount, 'FM999,999,999,990'), ''),
         '/dashboard/me/approvals', 'موافقة', r.id, 'approval_request', 'HR'
    from public.approval_current_approvers(p_request) a
   where a.user_id is distinct from auth.uid();
end $$;


-- ============================================================
-- ٤) بدء الطلب، القرار، الإلغاء
-- ============================================================
create or replace function public.start_approval(
  p_workflow text, p_entity_type text, p_entity_id uuid, p_subject uuid,
  p_title text, p_amount numeric default null, p_days numeric default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_step int;
begin
  if not exists (select 1 from public.approval_workflows w where w.code = p_workflow and w.active) then
    raise exception 'سلسلة الموافقة «%» غير موجودة أو موقوفة', p_workflow;
  end if;

  insert into public.approval_requests
    (workflow_code, entity_type, entity_id, subject_employee, requested_by, requested_by_name, title, amount, days)
  values (p_workflow, p_entity_type, p_entity_id, p_subject, auth.uid(),
          coalesce(public.my_employee_name(), public.display_name(auth.uid()),
                   (select e.full_name from public.employees e where e.id = p_subject), 'النظام'),
          p_title, p_amount, p_days)
  returning id into v_id;

  v_step := public.approval_advance(v_id, 0);
  update public.approval_requests set current_step = v_step where id = v_id;
  perform public.approval_notify_current(v_id);
  return v_id;
end $$;

-- تطبيق النتيجة النهائية على الكيان — تُكمَّل لكل نوع في 154/155
create or replace function public.approval_apply(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  return;
end $$;

create or replace function public.approval_decide(p_request uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
  v_label text;
  v_next int;
  v_override boolean;
  v_who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'قيد الموافقة' then raise exception 'الطلب «%» لا ينتظر قراراً', r.status; end if;
  if exists (select 1 from public.employees e where e.id = r.subject_employee and e.user_id = auth.uid()) then
    raise exception 'لا يوافق أحد على طلبه';
  end if;
  if not public.can_act_on_approval(p_request) then
    raise exception 'ليس لك القرار في هذه المرحلة من الطلب';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الرفض إلزامي';
  end if;

  v_override := not exists (select 1 from public.approval_current_approvers(p_request) a where a.user_id = auth.uid());
  select st.label into v_label from public.approval_steps st
   where st.workflow_code = r.workflow_code and st.step_no = r.current_step;

  insert into public.approval_actions (request_id, step_no, step_label, decision, actor, actor_name, note)
  values (p_request, r.current_step, coalesce(v_label, 'المدير'),
          case when not p_approve then 'رفض' when v_override then 'تجاوز' else 'موافقة' end,
          auth.uid(), v_who, nullif(btrim(p_note), ''));

  if not p_approve then
    update public.approval_requests set status = 'مرفوض', decided_at = now() where id = p_request;
  elsif v_override or r.current_step is null then
    -- تجاوز المدير أو آخر السلسلة: اعتماد نهائي
    update public.approval_requests set status = 'معتمد', decided_at = now(), current_step = null where id = p_request;
  else
    v_next := public.approval_advance(p_request, r.current_step);
    if v_next is null then
      update public.approval_requests set status = 'معتمد', decided_at = now(), current_step = null where id = p_request;
    else
      update public.approval_requests set current_step = v_next where id = p_request;
      perform public.approval_notify_current(p_request);
      return 'قيد الموافقة';
    end if;
  end if;

  perform public.approval_apply(p_request);

  select * into r from public.approval_requests where id = p_request;
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select e.user_id, r.title || ': ' || r.status, coalesce(nullif(btrim(p_note), ''), 'بواسطة ' || v_who),
         '/dashboard/me/requests', 'موافقة', r.id, 'approval_request', 'HR'
    from public.employees e
   where e.id = r.subject_employee and e.user_id is not null and e.user_id is distinct from auth.uid()
     -- الإجازة تُبلِغ صاحبها بمحفّزها القائم (notify_leave_decided) — لا إشعاران
     and r.entity_type <> 'leave';

  return r.status;
end $$;

create or replace function public.cancel_approval(p_request uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'قيد الموافقة' then raise exception 'الطلب «%» لا يُلغى', r.status; end if;
  if not (r.requested_by = auth.uid()
          or exists (select 1 from public.employees e where e.id = r.subject_employee and e.user_id = auth.uid())
          or public.can_manage_hr()) then
    raise exception 'يلغي الطلبَ صاحبُه أو الموارد البشرية';
  end if;
  insert into public.approval_actions (request_id, step_no, decision, actor, actor_name, note)
  values (p_request, r.current_step, 'إلغاء', auth.uid(),
          coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'), nullif(btrim(p_note), ''));
  update public.approval_requests set status = 'ملغى', decided_at = now() where id = p_request;
  perform public.approval_apply(p_request);
end $$;

-- ما ينتظر قراري
create or replace function public.my_pending_approvals()
returns table (
  id uuid, workflow_code text, workflow_name text, entity_type text, entity_id uuid,
  subject_employee uuid, subject_name text, title text, amount numeric, days numeric,
  current_step int, step_label text, created_at timestamptz, is_override boolean
)
language sql stable security definer set search_path = public as $$
  select r.id, r.workflow_code, w.name_ar, r.entity_type, r.entity_id,
         r.subject_employee, e.full_name, r.title, r.amount, r.days,
         r.current_step, coalesce(st.label, 'المدير'), r.created_at,
         not exists (select 1 from public.approval_current_approvers(r.id) a where a.user_id = auth.uid())
    from public.approval_requests r
    join public.approval_workflows w on w.code = r.workflow_code
    left join public.employees e on e.id = r.subject_employee
    left join public.approval_steps st on st.workflow_code = r.workflow_code and st.step_no = r.current_step
   where r.status = 'قيد الموافقة'
     and (exists (select 1 from public.approval_current_approvers(r.id) a where a.user_id = auth.uid()))
   order by r.created_at;
$$;

-- سجلّ طلبٍ واحد (لصاحبه ومُوافقيه وHR)
create or replace function public.approval_trail(p_entity_type text, p_entity_id uuid)
returns table (request_id uuid, status text, current_step int, step_label text, decision text,
               actor_name text, note text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.current_step,
         coalesce(a.step_label, (select st.label from public.approval_steps st
                                  where st.workflow_code = r.workflow_code and st.step_no = r.current_step)),
         a.decision, a.actor_name, a.note, coalesce(a.at, r.created_at)
    from public.approval_requests r
    left join public.approval_actions a on a.request_id = r.id
   where r.entity_type = p_entity_type and r.entity_id = p_entity_id
     and (public.can_manage_hr()
          or r.requested_by = auth.uid()
          or exists (select 1 from public.employees e where e.id = r.subject_employee and e.user_id = auth.uid())
          or public.can_act_on_approval(r.id)
          or exists (select 1 from public.approval_actions x where x.request_id = r.id and x.actor = auth.uid()))
   order by r.created_at, a.at nulls first;
$$;


-- ============================================================
-- ٥) RLS — القراءة لأصحاب العلاقة، والكتابة بالدوالّ
-- ============================================================
alter table public.approval_workflows enable row level security;
alter table public.approval_steps     enable row level security;
alter table public.approval_requests  enable row level security;
alter table public.approval_actions   enable row level security;

drop policy if exists "read workflows" on public.approval_workflows;
create policy "read workflows" on public.approval_workflows for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "admin manages workflows" on public.approval_workflows;
create policy "admin manages workflows" on public.approval_workflows for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read steps" on public.approval_steps;
create policy "read steps" on public.approval_steps for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "admin manages steps" on public.approval_steps;
create policy "admin manages steps" on public.approval_steps for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- من يرى الطلب: HR، صاحبه، مُوافِقه الآن، ومن قرّر فيه سابقاً.
-- دالة واحدة للجدولين: لو أشارت سياسة كلٍّ منهما إلى الآخر لدارت RLS على نفسها.
create or replace function public.can_see_approval(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr()
      or exists (select 1 from public.approval_requests r
                  where r.id = p_request
                    and (r.requested_by = auth.uid()
                         or r.subject_employee = public.my_employee_id()))
      or public.can_act_on_approval(p_request)
      or exists (select 1 from public.approval_actions a where a.request_id = p_request and a.actor = auth.uid());
$$;

drop policy if exists "read approval requests" on public.approval_requests;
create policy "read approval requests" on public.approval_requests for select to authenticated
  using (public.can_see_approval(id));

drop policy if exists "read approval actions" on public.approval_actions;
create policy "read approval actions" on public.approval_actions for select to authenticated
  using (public.can_see_approval(request_id));

revoke all on public.approval_workflows, public.approval_steps, public.approval_requests, public.approval_actions from anon;

drop trigger if exists trg_audit_approval_steps on public.approval_steps;
create trigger trg_audit_approval_steps after insert or update or delete on public.approval_steps
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_approval_workflows on public.approval_workflows;
create trigger trg_audit_approval_workflows after insert or update or delete on public.approval_workflows
  for each row execute function public.audit_row();

revoke all on function public.approval_step_users(uuid, uuid)          from public, anon, authenticated;
revoke all on function public.approval_advance(uuid, int)              from public, anon, authenticated;
revoke all on function public.approval_notify_current(uuid)            from public, anon, authenticated;
revoke all on function public.approval_apply(uuid)                     from public, anon, authenticated;
revoke all on function public.start_approval(text, text, uuid, uuid, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.can_see_approval(uuid)                   from public, anon;
grant execute on function public.can_see_approval(uuid)                to authenticated;
revoke all on function public.approval_current_approvers(uuid)         from public, anon;
revoke all on function public.can_act_on_approval(uuid)                from public, anon;
revoke all on function public.approval_decide(uuid, boolean, text)     from public, anon;
revoke all on function public.cancel_approval(uuid, text)              from public, anon;
revoke all on function public.my_pending_approvals()                   from public, anon;
revoke all on function public.approval_trail(text, uuid)               from public, anon;
grant execute on function public.approval_current_approvers(uuid)      to authenticated;
grant execute on function public.can_act_on_approval(uuid)             to authenticated;
grant execute on function public.approval_decide(uuid, boolean, text)  to authenticated;
grant execute on function public.cancel_approval(uuid, text)           to authenticated;
grant execute on function public.my_pending_approvals()                to authenticated;
grant execute on function public.approval_trail(text, uuid)            to authenticated;
