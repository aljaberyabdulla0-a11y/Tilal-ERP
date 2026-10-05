-- ============================================================
-- تلال ERP — 150: التوظيف (HR المؤسسي — المرحلة 3)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 146، 148.
--
-- ============================================================
-- السير
--
--   مدير القسم ── طلب توظيف ──► HR توافق ──► الإدارة توافق ──► وظيفة مفتوحة
--        مرشح ──► طلب تقدّم ──► فرز ──► مقابلة (مقيِّم بدرجة وتوصية) ──► تقييم
--        ──► عرض (HR تُعدّه، الإدارة تعتمده، المرشح يقبل) ──► hire_candidate()
--        ──► موظف (تحت التجربة) + قائمة تهيئة (151)
--
-- ============================================================
-- القواعد
--
--   • لا أحد يوافق على طلبه هو، ولا يعتمد عرضاً أعدّه.
--   • القرارات (موافقة، رفض، اعتماد، قبول، تعيين) عبر دوالّ فقط؛ تغيير
--     الحالة بتحديث مباشر مرفوض (حارس بعلَم tilal.recruit).
--   • «مرفوض» يتطلب سبباً، والمراحل الختامية لا تُفتح ثانيةً، و«عرض»
--     يتطلب مقابلة تمّت.
--   • الرواتب (نطاق الطلب، العرض) لا يراها المقيِّم ولا مدير القسم من
--     خارج HR: العروض لـ HR والمالية، والمقيِّم يرى مقابلاته عبر دالة.
--   • الوحدة «recruitment» صارت مُطبَّقة: HR بمستواها، أو من له
--     recruitment.update / read في المصفوفة.
-- ============================================================


-- ============================================================
-- ١) الصلاحية والإشعار
-- ============================================================
create or replace function public.can_manage_recruitment()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr() or public.has_permission('recruitment', 'update');
$$;

create or replace function public.can_read_recruitment()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_recruitment() or public.has_permission('recruitment', 'read');
$$;

update public.app_modules
   set enforced = true, note = 'المرحلة 3: الطلبات والوظائف والمرشحون والمقابلات والعروض (150).'
 where code = 'recruitment';

-- إشعار لأصحاب مستوى أمني (admin/hr…) — داخلي للدوالّ
create or replace function public.hr_notify_levels(
  p_levels text[], p_title text, p_body text, p_link text, p_kind text,
  p_entity uuid default null, p_entity_type text default null, p_priority text default 'عادية')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, priority, category)
  select p.id, p_title, p_body, p_link, p_kind, p_entity, p_entity_type, p_priority, 'HR'
    from public.profiles p
   where p.role = any (p_levels) and p.id is distinct from auth.uid();
$$;

-- إشعار لموظف بعينه (إن كان له حساب)
create or replace function public.hr_notify_employee(
  p_employee uuid, p_title text, p_body text, p_link text, p_kind text,
  p_entity uuid default null, p_entity_type text default null, p_priority text default 'عادية')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, priority, category)
  select e.user_id, p_title, p_body, p_link, p_kind, p_entity, p_entity_type, p_priority, 'HR'
    from public.employees e
   where e.id = p_employee and e.user_id is not null and e.user_id is distinct from auth.uid();
$$;

revoke all on function public.hr_notify_levels(text[], text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.hr_notify_employee(uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;

create sequence if not exists public.job_requisition_seq;
create sequence if not exists public.job_opening_seq;
create sequence if not exists public.job_offer_seq;


-- ============================================================
-- ٢) طلبات التوظيف
-- ============================================================
create table if not exists public.job_requisitions (
  id                    uuid primary key default gen_random_uuid(),
  req_no                text not null unique,
  department_id         uuid not null references public.departments(id) on delete restrict,
  position_id           uuid references public.positions(id) on delete set null,
  title                 text not null check (btrim(title) <> ''),
  headcount             int  not null default 1 check (headcount between 1 and 100),
  employment_type       text not null default 'full_time' references public.employment_types(code) on update cascade,
  reason                text not null default 'توسّع' check (reason in ('توسّع', 'بديل', 'منصب جديد')),
  replaces_employee_id  uuid references public.employees(id) on delete set null,
  justification         text,
  salary_min            numeric check (salary_min is null or salary_min >= 0),
  salary_max            numeric check (salary_max is null or salary_max >= 0),
  needed_by             date,
  status                text not null default 'بانتظار HR'
                          check (status in ('بانتظار HR', 'بانتظار الإدارة', 'معتمد', 'مرفوض', 'ملغى', 'مغلق')),
  requested_by          uuid default auth.uid() references auth.users(id) on delete set null,
  requested_by_name     text,
  hr_decided_by         uuid references auth.users(id) on delete set null,
  hr_decided_by_name    text,
  hr_decided_at         timestamptz,
  hr_note               text,
  mgmt_decided_by       uuid references auth.users(id) on delete set null,
  mgmt_decided_by_name  text,
  mgmt_decided_at       timestamptz,
  mgmt_note             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint job_requisitions_salary_range check (salary_min is null or salary_max is null or salary_max >= salary_min)
);

create index if not exists job_requisitions_dept_idx on public.job_requisitions (department_id, status);

-- ============================================================
-- ٣) الوظائف المفتوحة
-- ============================================================
create table if not exists public.job_openings (
  id                 uuid primary key default gen_random_uuid(),
  opening_no         text not null unique,
  requisition_id     uuid unique references public.job_requisitions(id) on delete restrict,
  title              text not null check (btrim(title) <> ''),
  department_id      uuid not null references public.departments(id) on delete restrict,
  position_id        uuid references public.positions(id) on delete set null,
  branch_id          uuid references public.branches(id) on delete set null,
  employment_type    text not null default 'full_time' references public.employment_types(code) on update cascade,
  headcount          int  not null default 1 check (headcount between 1 and 100),
  hiring_manager_id  uuid references public.employees(id) on delete set null,
  description        text,
  requirements       text,
  status             text not null default 'مفتوحة' check (status in ('مفتوحة', 'معلّقة', 'مغلقة')),
  opened_at          date not null default public.baghdad_today(),
  closes_at          date,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists job_openings_dept_idx on public.job_openings (department_id, status);

-- ============================================================
-- ٤) المرشحون وطلبات التقدّم
-- ============================================================
create table if not exists public.candidates (
  id                    uuid primary key default gen_random_uuid(),
  full_name             text not null check (btrim(full_name) <> ''),
  phone                 text,
  email                 text,
  source                text not null default 'أخرى'
                          check (source in ('إحالة', 'موقع الشركة', 'لينكدإن', 'وسائل التواصل', 'وكالة توظيف', 'أخرى')),
  referred_by_employee  uuid references public.employees(id) on delete set null,
  current_title         text,
  expected_salary       numeric check (expected_salary is null or expected_salary >= 0),
  cv_path               text unique check (cv_path is null or cv_path like 'candidates/%'),
  cv_file_name          text,
  notes                 text,
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- مرشح واحد لكل رقم — التكرار يُكتشف قبل أن يُقابَل الشخص مرتين
create unique index if not exists candidates_phone_key
  on public.candidates (regexp_replace(phone, '\D', '', 'g')) where phone is not null and btrim(phone) <> '';

create table if not exists public.job_applications (
  id                 uuid primary key default gen_random_uuid(),
  opening_id         uuid not null references public.job_openings(id) on delete cascade,
  candidate_id       uuid not null references public.candidates(id) on delete cascade,
  stage              text not null default 'جديد'
                       check (stage in ('جديد', 'فرز', 'مقابلة', 'تقييم', 'عرض', 'تم التعيين', 'مرفوض', 'انسحب')),
  stage_changed_at   timestamptz not null default now(),
  rejection_reason   text,
  employee_id        uuid references public.employees(id) on delete set null,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (opening_id, candidate_id)
);

create index if not exists job_applications_opening_idx on public.job_applications (opening_id, stage);

-- سجلّ المراحل — كل نقلة بمن ومتى ولماذا
create table if not exists public.job_application_events (
  id              bigserial primary key,
  application_id  uuid not null references public.job_applications(id) on delete cascade,
  from_stage      text,
  to_stage        text not null,
  note            text,
  actor           uuid,
  actor_name      text,
  at              timestamptz not null default now()
);

create index if not exists job_application_events_app_idx on public.job_application_events (application_id, at);

-- ============================================================
-- ٥) المقابلات
-- ============================================================
create table if not exists public.job_interviews (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.job_applications(id) on delete cascade,
  round           int  not null default 1 check (round between 1 and 10),
  scheduled_at    timestamptz not null,
  mode            text not null default 'حضوري' check (mode in ('حضوري', 'هاتف', 'فيديو')),
  location        text,
  interviewer_id  uuid not null references public.employees(id) on delete restrict,
  status          text not null default 'مجدولة' check (status in ('مجدولة', 'تمت', 'ألغيت')),
  score           int check (score between 1 and 5),
  recommendation  text check (recommendation in ('قبول', 'محايد', 'رفض')),
  feedback        text,
  submitted_at    timestamptz,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint job_interviews_done_has_score check (status <> 'تمت' or (score is not null and recommendation is not null))
);

create index if not exists job_interviews_interviewer_idx on public.job_interviews (interviewer_id, scheduled_at);

-- ============================================================
-- ٦) العروض
-- ============================================================
create table if not exists public.job_offers (
  id                 uuid primary key default gen_random_uuid(),
  offer_no           text not null unique,
  application_id     uuid not null references public.job_applications(id) on delete cascade,
  position_id        uuid references public.positions(id) on delete set null,
  department_id      uuid not null references public.departments(id) on delete restrict,
  salary             numeric not null check (salary >= 0),
  start_date         date not null,
  employment_type    text not null default 'full_time' references public.employment_types(code) on update cascade,
  probation_months   int not null default 3 check (probation_months between 0 and 12),
  notes              text,
  status             text not null default 'بانتظار الاعتماد'
                       check (status in ('بانتظار الاعتماد', 'معتمد', 'رُفض داخلياً', 'مقبول', 'رفضه المرشح', 'مسحوب')),
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name    text,
  approved_by        uuid references auth.users(id) on delete set null,
  approved_by_name   text,
  approved_at        timestamptz,
  decision_note      text,
  responded_at       timestamptz,
  created_at         timestamptz not null default now()
);

-- عرضٌ حيّ واحد لكل طلب تقدّم
create unique index if not exists job_offers_one_live
  on public.job_offers (application_id) where status in ('بانتظار الاعتماد', 'معتمد', 'مقبول');


-- ============================================================
-- ٧) من يرى طلب التقدّم: HR، أو مقيِّمه، أو مدير التوظيف / مدير القسم
-- ============================================================
create or replace function public.can_see_application(p_app uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_recruitment()
      or exists (select 1 from public.job_interviews i
                  where i.application_id = p_app and i.interviewer_id = public.my_employee_id())
      or exists (select 1 from public.job_applications a
                   join public.job_openings o on o.id = a.opening_id
                  where a.id = p_app
                    and (o.hiring_manager_id = public.my_employee_id()
                         or o.department_id in (select m.id from public.my_managed_department_ids() m)));
$$;


-- ============================================================
-- ٨) الحرّاس والأختام
-- ============================================================
create or replace function public.stamp_job_requisition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.req_no := 'REQ-' || lpad(nextval('public.job_requisition_seq')::text, 4, '0');
    new.requested_by := auth.uid();
    new.requested_by_name := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
    new.status := 'بانتظار HR';
    new.hr_decided_by := null; new.hr_decided_at := null; new.hr_decided_by_name := null;
    new.mgmt_decided_by := null; new.mgmt_decided_at := null; new.mgmt_decided_by_name := null;
    if (select d.status from public.departments d where d.id = new.department_id) <> 'نشط' then
      raise exception 'القسم مؤرشف';
    end if;
  else
    if coalesce(current_setting('tilal.recruit', true), '') <> '1' then
      if new.status is distinct from old.status
         or new.hr_decided_by is distinct from old.hr_decided_by
         or new.mgmt_decided_by is distinct from old.mgmt_decided_by
         or new.requested_by is distinct from old.requested_by then
        raise exception 'قرارات الطلب عبر decide_requisition / cancel_requisition';
      end if;
      if old.status not in ('بانتظار HR', 'بانتظار الإدارة') then
        raise exception 'طلب «%» لا يُعدَّل', old.status;
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_job_requisition on public.job_requisitions;
create trigger trg_stamp_job_requisition
  before insert or update on public.job_requisitions
  for each row execute function public.stamp_job_requisition();

create or replace function public.stamp_job_opening()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.job_requisitions%rowtype;
begin
  if tg_op = 'INSERT' then
    new.opening_no := 'JOB-' || lpad(nextval('public.job_opening_seq')::text, 4, '0');
    if new.requisition_id is null then
      -- بلا طلب معتمد: للمدير وحده (استثناء مُعلَن لا طريق خلفي)
      if not public.is_admin() then
        raise exception 'الوظيفة تُفتح من طلب توظيف معتمد';
      end if;
    else
      select * into v_req from public.job_requisitions where id = new.requisition_id;
      if v_req.status <> 'معتمد' then
        raise exception 'طلب التوظيف % ليس معتمداً (%)', v_req.req_no, v_req.status;
      end if;
      new.department_id := v_req.department_id;
      new.headcount := v_req.headcount;
    end if;
  else
    if new.requisition_id is distinct from old.requisition_id then
      raise exception 'لا يتغيّر طلب التوظيف الذي فُتحت منه الوظيفة';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_job_opening on public.job_openings;
create trigger trg_stamp_job_opening
  before insert or update on public.job_openings
  for each row execute function public.stamp_job_opening();

create or replace function public.stamp_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_candidate on public.candidates;
create trigger trg_stamp_candidate
  before insert or update on public.candidates
  for each row execute function public.stamp_candidate();

-- المراحل: لا رجعة من الختامية، «مرفوض» بسبب، «عرض» بعد مقابلة تمّت،
-- و«تم التعيين» من hire_candidate وحدها
create or replace function public.guard_job_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_final constant text[] := array['تم التعيين', 'مرفوض', 'انسحب'];
  v_rpc boolean := coalesce(current_setting('tilal.recruit', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if (select o.status from public.job_openings o where o.id = new.opening_id) <> 'مفتوحة' then
      raise exception 'الوظيفة ليست مفتوحة للتقدّم';
    end if;
    new.stage := 'جديد';
    new.employee_id := null;
    new.stage_changed_at := now();
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id and not v_rpc then
    raise exception 'ربط الموظف من hire_candidate وحدها';
  end if;

  if new.stage is distinct from old.stage then
    if old.stage = any (v_final) then
      raise exception 'المرحلة «%» ختامية — قدّم طلباً جديداً إن عاد المرشح', old.stage;
    end if;
    if new.stage = 'تم التعيين' and not v_rpc then
      raise exception 'التعيين عبر hire_candidate (يتطلب عرضاً مقبولاً)';
    end if;
    if new.stage = 'مرفوض' and coalesce(btrim(new.rejection_reason), '') = '' then
      raise exception 'سبب الرفض إلزامي';
    end if;
    if new.stage = 'عرض' and not exists (
         select 1 from public.job_interviews i where i.application_id = new.id and i.status = 'تمت') then
      raise exception 'لا عرض قبل مقابلة تمّت بتقييمها';
    end if;
    new.stage_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_job_application on public.job_applications;
create trigger trg_guard_job_application
  before insert or update on public.job_applications
  for each row execute function public.guard_job_application();

create or replace function public.log_job_application_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.job_application_events (application_id, from_stage, to_stage, note, actor, actor_name)
    values (new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
            case when new.stage = 'مرفوض' then new.rejection_reason end,
            auth.uid(), coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'));
  end if;
  return null;
end $$;

drop trigger if exists trg_log_job_application_stage on public.job_applications;
create trigger trg_log_job_application_stage
  after insert or update of stage on public.job_applications
  for each row execute function public.log_job_application_stage();

-- المقابلة: المقيِّم موظف نشط، والإشعار يصله عند الجدولة
create or replace function public.guard_job_interview()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cand text;
begin
  if tg_op = 'INSERT' or new.interviewer_id is distinct from old.interviewer_id then
    if (select e.status from public.employees e where e.id = new.interviewer_id) <> 'active' then
      raise exception 'المقيِّم يجب أن يكون موظفاً على رأس عمله';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'تمت'
     and coalesce(current_setting('tilal.recruit', true), '') <> '1'
     and (new.score is distinct from old.score or new.recommendation is distinct from old.recommendation) then
    raise exception 'تقييم مقابلة تمّت لا يُعدَّل — يُضاف تقييم في جولة جديدة';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_job_interview on public.job_interviews;
create trigger trg_guard_job_interview
  before insert or update on public.job_interviews
  for each row execute function public.guard_job_interview();

create or replace function public.notify_job_interview()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cand text; v_job text;
begin
  select c.full_name, o.title into v_cand, v_job
    from public.job_applications a
    join public.candidates c on c.id = a.candidate_id
    join public.job_openings o on o.id = a.opening_id
   where a.id = new.application_id;
  perform public.hr_notify_employee(new.interviewer_id,
    'مقابلة: ' || v_cand || ' — ' || v_job,
    'الموعد ' || to_char(new.scheduled_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI') || ' (' || new.mode || ')',
    '/dashboard/me/interviews', 'توظيف', new.id, 'job_interview');
  return null;
end $$;

drop trigger if exists trg_notify_job_interview on public.job_interviews;
create trigger trg_notify_job_interview
  after insert on public.job_interviews
  for each row execute function public.notify_job_interview();

-- العرض: يُعدّ في مرحلة «عرض»، ولا تتغيّر حالته إلا بالدوالّ
create or replace function public.stamp_job_offer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (select a.stage from public.job_applications a where a.id = new.application_id) <> 'عرض' then
      raise exception 'العرض يُعدّ حين يكون الطلب في مرحلة «عرض»';
    end if;
    select coalesce(new.department_id, o.department_id), coalesce(new.position_id, o.position_id),
           coalesce(new.employment_type, o.employment_type)
      into new.department_id, new.position_id, new.employment_type
      from public.job_applications a join public.job_openings o on o.id = a.opening_id
     where a.id = new.application_id;
    new.offer_no := 'OFR-' || lpad(nextval('public.job_offer_seq')::text, 4, '0');
    new.status := 'بانتظار الاعتماد';
    new.created_by := auth.uid();
    new.created_by_name := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
    new.approved_by := null; new.approved_at := null; new.approved_by_name := null; new.responded_at := null;
  elsif coalesce(current_setting('tilal.recruit', true), '') <> '1' then
    if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by then
      raise exception 'حالة العرض عبر decide_offer / record_offer_response / withdraw_offer';
    end if;
    if old.status <> 'بانتظار الاعتماد' then
      raise exception 'عرض «%» لا يُعدَّل — اسحبه وأعدّ عرضاً جديداً', old.status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_job_offer on public.job_offers;
create trigger trg_stamp_job_offer
  before insert or update on public.job_offers
  for each row execute function public.stamp_job_offer();


-- ============================================================
-- ٩) الدوالّ
-- ============================================================

-- قرار على طلب التوظيف: HR ثم الإدارة. لا أحد يقرّر في طلبه.
create or replace function public.decide_requisition(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.job_requisitions%rowtype;
  v_who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  v_new text;
  v_opening uuid;
begin
  select * into r from public.job_requisitions where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.requested_by = auth.uid() then
    raise exception 'لا يوافق أحد على طلبه';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الرفض إلزامي';
  end if;

  perform set_config('tilal.recruit', '1', true);

  if r.status = 'بانتظار HR' then
    if not public.can_manage_hr() then
      raise exception 'مرحلة الموارد البشرية';
    end if;
    v_new := case when p_approve then 'بانتظار الإدارة' else 'مرفوض' end;
    update public.job_requisitions
       set status = v_new, hr_decided_by = auth.uid(), hr_decided_by_name = v_who,
           hr_decided_at = now(), hr_note = nullif(btrim(p_note), '')
     where id = p_id;
    if p_approve then
      perform public.hr_notify_levels(array['admin'], 'طلب توظيف بانتظار اعتمادك: ' || r.title,
        r.req_no || ' — ' || r.headcount || ' شاغر', '/dashboard/hr/recruitment', 'توظيف', r.id, 'job_requisition');
    end if;
  elsif r.status = 'بانتظار الإدارة' then
    if not public.is_admin() then
      raise exception 'مرحلة اعتماد الإدارة للمدير';
    end if;
    v_new := case when p_approve then 'معتمد' else 'مرفوض' end;
    update public.job_requisitions
       set status = v_new, mgmt_decided_by = auth.uid(), mgmt_decided_by_name = v_who,
           mgmt_decided_at = now(), mgmt_note = nullif(btrim(p_note), '')
     where id = p_id;
    if p_approve then
      -- الوظيفة تُفتح من الطلب المعتمد مباشرةً
      insert into public.job_openings (requisition_id, title, department_id, position_id, employment_type, headcount, description)
      values (r.id, r.title, r.department_id, r.position_id, r.employment_type, r.headcount, r.justification)
      returning id into v_opening;
    end if;
  else
    raise exception 'الطلب «%» لا ينتظر قراراً', r.status;
  end if;

  perform set_config('tilal.recruit', '', true);

  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select r.requested_by, 'طلب التوظيف ' || r.req_no || ': ' || v_new,
         coalesce(nullif(btrim(p_note), ''), r.title), '/dashboard/hr/recruitment', 'توظيف', r.id, 'job_requisition', 'HR'
   where r.requested_by is not null;

  return v_new;
end $$;

create or replace function public.cancel_requisition(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.job_requisitions%rowtype;
begin
  select * into r from public.job_requisitions where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not (r.requested_by = auth.uid() or public.can_manage_recruitment()) then
    raise exception 'يلغي الطلبَ صاحبُه أو الموارد البشرية';
  end if;
  if r.status not in ('بانتظار HR', 'بانتظار الإدارة') then
    raise exception 'الطلب «%» لا يُلغى', r.status;
  end if;
  perform set_config('tilal.recruit', '1', true);
  update public.job_requisitions set status = 'ملغى', hr_note = coalesce(nullif(btrim(p_note), ''), hr_note) where id = p_id;
  perform set_config('tilal.recruit', '', true);
end $$;

-- إضافة مرشح إلى وظيفة: يُعاد استعمال المرشح إن وُجد رقمه
create or replace function public.add_candidate_to_opening(p_opening uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cand uuid;
  v_app uuid;
  v_phone text := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
begin
  if not public.can_manage_recruitment() then
    raise exception 'إضافة المرشحين للموارد البشرية';
  end if;
  if v_phone is not null then
    select c.id into v_cand from public.candidates c
     where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone;
  end if;
  if v_cand is null then
    insert into public.candidates (full_name, phone, email, source, current_title, expected_salary, notes, referred_by_employee)
    values (btrim(p->>'full_name'), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'email'), ''),
            coalesce(nullif(p->>'source', ''), 'أخرى'), nullif(btrim(p->>'current_title'), ''),
            nullif(p->>'expected_salary', '')::numeric, nullif(btrim(p->>'notes'), ''),
            nullif(p->>'referred_by_employee', '')::uuid)
    returning id into v_cand;
  end if;
  insert into public.job_applications (opening_id, candidate_id) values (p_opening, v_cand)
  returning id into v_app;
  return v_app;
exception when unique_violation then
  raise exception 'المرشح متقدّم لهذه الوظيفة أصلاً';
end $$;

-- تقييم المقيِّم لمقابلته (أو HR نيابةً)
create or replace function public.submit_interview_feedback(
  p_id uuid, p_score int, p_recommendation text, p_feedback text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.job_interviews%rowtype;
begin
  select * into i from public.job_interviews where id = p_id for update;
  if not found then raise exception 'المقابلة غير موجودة'; end if;
  if not (i.interviewer_id = public.my_employee_id() or public.can_manage_recruitment()) then
    raise exception 'يقيّم المقابلةَ مقيِّمها أو الموارد البشرية';
  end if;
  if i.status = 'ألغيت' then raise exception 'المقابلة ملغاة'; end if;
  if i.status = 'تمت' then raise exception 'قُيّمت المقابلة — التقييم لا يُعاد كتابته'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'الدرجة من 1 إلى 5'; end if;
  if p_recommendation not in ('قبول', 'محايد', 'رفض') then raise exception 'التوصية: قبول أو محايد أو رفض'; end if;

  update public.job_interviews
     set status = 'تمت', score = p_score, recommendation = p_recommendation,
         feedback = nullif(btrim(p_feedback), ''), submitted_at = now()
   where id = p_id;
end $$;

-- مقابلاتي — ما يحتاجه المقيِّم وحده: لا راتب متوقّع ولا عرض
create or replace function public.my_interviews()
returns table (
  id uuid, scheduled_at timestamptz, mode text, location text, status text, round int,
  score int, recommendation text, feedback text,
  candidate_id uuid, candidate_name text, current_title text, has_cv boolean,
  opening_title text, department_name text
)
language sql stable security definer set search_path = public as $$
  select i.id, i.scheduled_at, i.mode, i.location, i.status, i.round,
         i.score, i.recommendation, i.feedback,
         c.id, c.full_name, c.current_title, c.cv_path is not null,
         o.title, d.name_ar
    from public.job_interviews i
    join public.job_applications a on a.id = i.application_id
    join public.candidates c on c.id = a.candidate_id
    join public.job_openings o on o.id = a.opening_id
    left join public.departments d on d.id = o.department_id
   where i.interviewer_id = public.my_employee_id()
   order by (i.status <> 'مجدولة'), i.scheduled_at desc;
$$;

-- اعتماد العرض: للمدير، ولا يعتمد عرضاً أعدّه
create or replace function public.decide_offer(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers%rowtype;
begin
  if not public.is_admin() then raise exception 'اعتماد العروض للمدير'; end if;
  select * into o from public.job_offers where id = p_id for update;
  if not found then raise exception 'العرض غير موجود'; end if;
  if o.created_by = auth.uid() then raise exception 'لا يعتمد أحد عرضاً أعدّه'; end if;
  if o.status <> 'بانتظار الاعتماد' then raise exception 'العرض «%» لا ينتظر اعتماداً', o.status; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'سبب الرفض إلزامي'; end if;

  perform set_config('tilal.recruit', '1', true);
  update public.job_offers
     set status = case when p_approve then 'معتمد' else 'رُفض داخلياً' end,
         approved_by = auth.uid(), approved_at = now(),
         approved_by_name = coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'),
         decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  perform set_config('tilal.recruit', '', true);

  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select o.created_by, 'العرض ' || o.offer_no || ': ' || case when p_approve then 'معتمد' else 'رُفض' end,
         coalesce(nullif(btrim(p_note), ''), 'أبلغ المرشح بالقرار'),
         '/dashboard/hr/recruitment', 'توظيف', o.id, 'job_offer', 'HR'
   where o.created_by is not null;
end $$;

-- ردّ المرشح على عرضٍ معتمد
create or replace function public.record_offer_response(p_id uuid, p_accepted boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers%rowtype;
begin
  if not public.can_manage_recruitment() then raise exception 'للموارد البشرية'; end if;
  select * into o from public.job_offers where id = p_id for update;
  if not found then raise exception 'العرض غير موجود'; end if;
  if o.status <> 'معتمد' then raise exception 'يُسجَّل الرد على عرضٍ معتمد فقط (الحالة: %)', o.status; end if;

  perform set_config('tilal.recruit', '1', true);
  update public.job_offers
     set status = case when p_accepted then 'مقبول' else 'رفضه المرشح' end,
         responded_at = now(), decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
   where id = p_id;
  if not p_accepted then
    update public.job_applications
       set stage = 'انسحب', rejection_reason = coalesce(nullif(btrim(p_note), ''), 'رفض العرض')
     where id = o.application_id;
  end if;
  perform set_config('tilal.recruit', '', true);
end $$;

create or replace function public.withdraw_offer(p_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers%rowtype;
begin
  if not public.can_manage_recruitment() then raise exception 'للموارد البشرية'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'سبب السحب إلزامي'; end if;
  select * into o from public.job_offers where id = p_id for update;
  if not found then raise exception 'العرض غير موجود'; end if;
  if o.status not in ('بانتظار الاعتماد', 'معتمد') then raise exception 'العرض «%» لا يُسحب', o.status; end if;
  perform set_config('tilal.recruit', '1', true);
  update public.job_offers set status = 'مسحوب', decision_note = btrim(p_note) where id = p_id;
  perform set_config('tilal.recruit', '', true);
end $$;

-- التعيين: المرشح بعرضٍ مقبول يصير موظفاً تحت التجربة
create or replace function public.hire_candidate(p_application uuid, p_hire_date date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a public.job_applications%rowtype;
  c public.candidates%rowtype;
  o public.job_offers%rowtype;
  op public.job_openings%rowtype;
  v_hire date;
  v_emp uuid;
  v_hired int;
begin
  if not public.can_manage_hr() then raise exception 'التعيين للموارد البشرية والمدير'; end if;

  select * into a from public.job_applications where id = p_application for update;
  if not found then raise exception 'طلب التقدّم غير موجود'; end if;
  if a.employee_id is not null then raise exception 'عُيّن هذا المرشح من قبل'; end if;

  select * into o from public.job_offers where application_id = p_application and status = 'مقبول';
  if not found then raise exception 'لا تعيين بلا عرضٍ معتمد قبله المرشح'; end if;

  select * into c from public.candidates where id = a.candidate_id;
  select * into op from public.job_openings where id = a.opening_id;
  v_hire := coalesce(p_hire_date, o.start_date);

  insert into public.employees (
    full_name, phone, email, position_id, department_id, branch_id, employment_type,
    base_salary, hire_date, probation_start, probation_end, manager_id, notes)
  values (
    c.full_name, c.phone, c.email, o.position_id, o.department_id, op.branch_id, o.employment_type,
    o.salary, v_hire,
    case when o.probation_months > 0 then v_hire end,
    case when o.probation_months > 0 then (v_hire + make_interval(months => o.probation_months))::date - 1 end,
    op.hiring_manager_id,
    'عُيّن من التوظيف: ' || op.opening_no || ' / ' || o.offer_no)
  returning id into v_emp;

  perform set_config('tilal.recruit', '1', true);
  update public.job_applications set stage = 'تم التعيين', employee_id = v_emp where id = p_application;

  -- اكتمل العدد؟ تُغلق الوظيفة ويُغلق طلبها
  select count(*) into v_hired from public.job_applications
   where opening_id = a.opening_id and stage = 'تم التعيين';
  if v_hired >= op.headcount then
    update public.job_openings set status = 'مغلقة' where id = op.id;
    if op.requisition_id is not null then
      update public.job_requisitions set status = 'مغلق' where id = op.requisition_id;
    end if;
  end if;
  perform set_config('tilal.recruit', '', true);

  if op.hiring_manager_id is not null then
    perform public.hr_notify_employee(op.hiring_manager_id, 'انضمّ إلى فريقك: ' || c.full_name,
      'يباشر ' || v_hire || ' — ' || op.title, '/dashboard/hr/onboarding', 'توظيف', v_emp, 'employee');
  end if;

  return v_emp;
end $$;


-- ============================================================
-- ١٠) RLS
-- ============================================================
alter table public.job_requisitions       enable row level security;
alter table public.job_openings           enable row level security;
alter table public.candidates             enable row level security;
alter table public.job_applications       enable row level security;
alter table public.job_application_events enable row level security;
alter table public.job_interviews         enable row level security;
alter table public.job_offers             enable row level security;

drop policy if exists "read requisitions" on public.job_requisitions;
create policy "read requisitions" on public.job_requisitions for select to authenticated
  using ((select public.can_read_recruitment())
         or requested_by = (select auth.uid())
         or department_id in (select m.id from public.my_managed_department_ids() m));
drop policy if exists "request requisitions" on public.job_requisitions;
create policy "request requisitions" on public.job_requisitions for insert to authenticated
  with check ((select public.can_manage_recruitment())
              or department_id in (select m.id from public.my_managed_department_ids() m));
drop policy if exists "edit requisitions" on public.job_requisitions;
create policy "edit requisitions" on public.job_requisitions for update to authenticated
  using ((select public.can_manage_recruitment()) or requested_by = (select auth.uid()))
  with check ((select public.can_manage_recruitment()) or requested_by = (select auth.uid()));

drop policy if exists "read openings" on public.job_openings;
create policy "read openings" on public.job_openings for select to authenticated
  using ((select public.can_read_recruitment())
         or hiring_manager_id = (select public.my_employee_id())
         or department_id in (select m.id from public.my_managed_department_ids() m));
drop policy if exists "manage openings" on public.job_openings;
create policy "manage openings" on public.job_openings for all to authenticated
  using ((select public.can_manage_recruitment())) with check ((select public.can_manage_recruitment()));

drop policy if exists "read applications" on public.job_applications;
create policy "read applications" on public.job_applications for select to authenticated
  using (public.can_see_application(id));
drop policy if exists "manage applications" on public.job_applications;
create policy "manage applications" on public.job_applications for all to authenticated
  using ((select public.can_manage_recruitment())) with check ((select public.can_manage_recruitment()));

drop policy if exists "read application events" on public.job_application_events;
create policy "read application events" on public.job_application_events for select to authenticated
  using (public.can_see_application(application_id));

drop policy if exists "read candidates" on public.candidates;
create policy "read candidates" on public.candidates for select to authenticated
  using ((select public.can_read_recruitment())
         or exists (select 1 from public.job_applications a where a.candidate_id = candidates.id));
drop policy if exists "manage candidates" on public.candidates;
create policy "manage candidates" on public.candidates for all to authenticated
  using ((select public.can_manage_recruitment())) with check ((select public.can_manage_recruitment()));

drop policy if exists "read interviews" on public.job_interviews;
create policy "read interviews" on public.job_interviews for select to authenticated
  using ((select public.can_read_recruitment()) or interviewer_id = (select public.my_employee_id())
         or public.can_see_application(application_id));
drop policy if exists "manage interviews" on public.job_interviews;
create policy "manage interviews" on public.job_interviews for all to authenticated
  using ((select public.can_manage_recruitment())) with check ((select public.can_manage_recruitment()));

-- العروض فيها الراتب: HR والمالية فقط
drop policy if exists "read offers" on public.job_offers;
create policy "read offers" on public.job_offers for select to authenticated
  using ((select public.can_manage_recruitment()) or (select public.can_manage_finance()));
drop policy if exists "manage offers" on public.job_offers;
create policy "manage offers" on public.job_offers for all to authenticated
  using ((select public.can_manage_recruitment())) with check ((select public.can_manage_recruitment()));

revoke all on public.job_requisitions, public.job_openings, public.candidates, public.job_applications,
              public.job_application_events, public.job_interviews, public.job_offers from anon;

-- مدير القسم والمقيِّم يريان المرشح بالاسم والمسمّى — لا راتبه المتوقّع.
-- سحبُ العمود وحده لا يكفي ما دامت القراءة ممنوحةً على الجدول كله،
-- فتُسحب قراءة الجدول وتُمنح الأعمدة الأخرى صراحةً. (الواجهة تختار
-- أعمدتها ولا تقرأ select *، والراتب المتوقّع من دالة لـ HR.)
revoke select on public.candidates from authenticated;
grant select (id, full_name, phone, email, source, referred_by_employee, current_title,
              cv_path, cv_file_name, notes, created_by, created_by_name, created_at, updated_at)
  on public.candidates to authenticated;

-- الراتب المتوقّع لـ HR عبر دالة
create or replace function public.candidate_expected_salary(p_candidate uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select c.expected_salary from public.candidates c
   where c.id = p_candidate and (public.can_manage_recruitment() or public.can_manage_finance());
$$;


-- ============================================================
-- ١١) السِّيَر الذاتية — دلو خاصّ
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recruitment', 'recruitment', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read recruitment storage" on storage.objects;
create policy "read recruitment storage" on storage.objects for select to authenticated
  using (bucket_id = 'recruitment'
         and exists (select 1 from public.candidates c where c.cv_path = name));

drop policy if exists "write recruitment storage" on storage.objects;
create policy "write recruitment storage" on storage.objects for insert to authenticated
  with check (bucket_id = 'recruitment'
              and (storage.foldername(name))[1] = 'candidates'
              and (select public.can_manage_recruitment()));

drop policy if exists "delete recruitment storage" on storage.objects;
create policy "delete recruitment storage" on storage.objects for delete to authenticated
  using (bucket_id = 'recruitment'
         and ((select public.is_admin())
              or ((select public.can_manage_recruitment())
                  and not exists (select 1 from public.candidates c where c.cv_path = name))));


-- ============================================================
-- ١٢) التدقيق والصلاحيات على الدوالّ
-- ============================================================
drop trigger if exists trg_audit_job_requisitions on public.job_requisitions;
create trigger trg_audit_job_requisitions after insert or update or delete on public.job_requisitions
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_job_openings on public.job_openings;
create trigger trg_audit_job_openings after insert or update or delete on public.job_openings
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_candidates on public.candidates;
create trigger trg_audit_candidates after insert or update or delete on public.candidates
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_job_interviews on public.job_interviews;
create trigger trg_audit_job_interviews after insert or update or delete on public.job_interviews
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_job_offers on public.job_offers;
create trigger trg_audit_job_offers after insert or update or delete on public.job_offers
  for each row execute function public.audit_row();

revoke all on function public.can_manage_recruitment()                              from public, anon;
revoke all on function public.can_read_recruitment()                                from public, anon;
revoke all on function public.can_see_application(uuid)                             from public, anon;
revoke all on function public.decide_requisition(uuid, boolean, text)               from public, anon;
revoke all on function public.cancel_requisition(uuid, text)                        from public, anon;
revoke all on function public.add_candidate_to_opening(uuid, jsonb)                 from public, anon;
revoke all on function public.submit_interview_feedback(uuid, int, text, text)      from public, anon;
revoke all on function public.my_interviews()                                       from public, anon;
revoke all on function public.decide_offer(uuid, boolean, text)                     from public, anon;
revoke all on function public.record_offer_response(uuid, boolean, text)            from public, anon;
revoke all on function public.withdraw_offer(uuid, text)                            from public, anon;
revoke all on function public.hire_candidate(uuid, date)                            from public, anon;
revoke all on function public.candidate_expected_salary(uuid)                       from public, anon;
grant execute on function public.can_manage_recruitment()                           to authenticated;
grant execute on function public.can_read_recruitment()                             to authenticated;
grant execute on function public.can_see_application(uuid)                          to authenticated;
grant execute on function public.decide_requisition(uuid, boolean, text)            to authenticated;
grant execute on function public.cancel_requisition(uuid, text)                     to authenticated;
grant execute on function public.add_candidate_to_opening(uuid, jsonb)              to authenticated;
grant execute on function public.submit_interview_feedback(uuid, int, text, text)   to authenticated;
grant execute on function public.my_interviews()                                    to authenticated;
grant execute on function public.decide_offer(uuid, boolean, text)                  to authenticated;
grant execute on function public.record_offer_response(uuid, boolean, text)         to authenticated;
grant execute on function public.withdraw_offer(uuid, text)                         to authenticated;
grant execute on function public.hire_candidate(uuid, date)                         to authenticated;
grant execute on function public.candidate_expected_salary(uuid)                    to authenticated;
