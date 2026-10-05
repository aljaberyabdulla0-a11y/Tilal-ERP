-- ============================================================
-- تلال ERP — 154: الورديات وطلبات الدوام والعمل الإضافي (المرحلة 4)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 148، 153.
--
-- ============================================================
-- ما يضيفه
--
--   ١) الورديات: work_shifts + employee_shifts (إسناد بتاريخ بداية ونهاية)
--      و work_schedule_on(موظف، يوم) = وردية اليوم ← دوام الموظف الخاص ← دوام الشركة.
--      attendance_deductions و auto_checkout يقرآنها يوماً يوماً — بقية
--      منطقهما منسوخ حرفياً من النسخة الحيّة (060، 033). المحرّك مطفأ حالياً.
--
--   ٢) طلبات الدوام: تعديل بصمة، مهمة رسمية، عمل ميداني، عمل عن بُعد، رحلة عمل.
--      تمرّ بمحرّك الموافقات (سلسلة attendance). المعتمد يُطبَّق:
--        تعديل بصمة  ⇒ يُكتب السجلّ (بختم النظام، خارج قيد الموقع)
--        غيرها       ⇒ استثناء «يوم كامل» لكل يوم — المحرّك يحترمه أصلاً (059)
--
--   ٣) العمل الإضافي: طلب بوقت وسبب ومشروع/مهمة وطريقة تعويض (أجر أو
--      إجازة تعويضية). سلسلة overtime. المعامل من الإعدادات — فارغٌ حتى يحدّده
--      المالك، ولا رقم في الواجهة. صرفه في الكشف: المرحلة 5.
--
-- لا يُقبل طلب يمسّ شهراً كشفُه معتمد — التصحيح بإعادة الفتح.
-- ============================================================


-- ============================================================
-- ١) الورديات
-- ============================================================
create table if not exists public.work_shifts (
  id             uuid primary key default gen_random_uuid(),
  name_ar        text not null unique check (btrim(name_ar) <> ''),
  start_time     time not null,
  end_time       time not null,
  work_days      int[] not null default '{0,1,2,3,4}',
  break_minutes  int not null default 0 check (break_minutes between 0 and 240),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint work_shifts_hours check (end_time > start_time),
  constraint work_shifts_days check (work_days <@ array[0,1,2,3,4,5,6] and array_length(work_days, 1) >= 1)
);

create table if not exists public.employee_shifts (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  shift_id     uuid not null references public.work_shifts(id) on delete restrict,
  start_date   date not null,
  end_date     date,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint employee_shifts_range check (end_date is null or end_date >= start_date)
);

create index if not exists employee_shifts_emp_idx on public.employee_shifts (employee_id, start_date);

-- لا تتداخل ورديتان لموظف واحد
create or replace function public.guard_employee_shift()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from public.employee_shifts s
     where s.employee_id = new.employee_id and s.id is distinct from new.id
       and s.start_date <= coalesce(new.end_date, 'infinity'::date)
       and coalesce(s.end_date, 'infinity'::date) >= new.start_date) then
    raise exception 'للموظف وردية أخرى في هذه الفترة — أنهِ السابقة أولاً';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_employee_shift on public.employee_shifts;
create trigger trg_guard_employee_shift before insert or update on public.employee_shifts
  for each row execute function public.guard_employee_shift();

-- دوام الموظف في يومٍ بعينه
create or replace function public.work_schedule_on(p_employee uuid, p_date date)
returns table (start_time time, end_time time, work_days int[], source text)
language sql stable security definer set search_path = public as $$
  select coalesce(sh.start_time, e.work_start_time, s.work_start_time),
         coalesce(sh.end_time,   e.work_end_time,   s.work_end_time),
         coalesce(sh.work_days,
                  case when e.work_days is not null and array_length(e.work_days, 1) > 0 then e.work_days end,
                  s.work_days),
         case when sh.id is not null then 'وردية: ' || sh.name_ar
              when e.work_start_time is not null or e.work_days is not null then 'دوام خاص'
              else 'دوام الشركة' end
    from public.employees e
    cross join public.company_settings s
    left join lateral (
      select w.* from public.employee_shifts es join public.work_shifts w on w.id = es.shift_id
       where es.employee_id = e.id and es.start_date <= p_date
         and coalesce(es.end_date, 'infinity'::date) >= p_date
       order by es.start_date desc limit 1
    ) sh on true
   where e.id = p_employee and s.id = 1;
$$;

alter table public.work_shifts     enable row level security;
alter table public.employee_shifts enable row level security;

drop policy if exists "read shifts" on public.work_shifts;
create policy "read shifts" on public.work_shifts for select to authenticated using (not (select public.is_broker()));
drop policy if exists "hr manages shifts" on public.work_shifts;
create policy "hr manages shifts" on public.work_shifts for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

drop policy if exists "read employee shifts" on public.employee_shifts;
create policy "read employee shifts" on public.employee_shifts for select to authenticated
  using ((select public.can_manage_hr()) or employee_id = (select public.my_employee_id())
         or employee_id in (select m.id from public.my_scope_employees() m)
         or employee_id in (select t.id from public.my_team_employee_ids() t));
drop policy if exists "hr manages employee shifts" on public.employee_shifts;
create policy "hr manages employee shifts" on public.employee_shifts for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

revoke all on public.work_shifts, public.employee_shifts from anon;

drop trigger if exists trg_audit_employee_shifts on public.employee_shifts;
create trigger trg_audit_employee_shifts after insert or update or delete on public.employee_shifts
  for each row execute function public.audit_row();


-- ============================================================
-- ٢) محرّك خصم الدوام والانصراف التلقائي — يوماً يوماً بالوردية
--    (النسخة الحيّة حرفياً، والفرق: الدوام من work_schedule_on لكل يوم)
-- ============================================================
create or replace function public.attendance_deductions(p_employee uuid, p_period text)
returns table (work_date date, category text, description text, amount numeric, minutes integer, source_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.company_settings%rowtype; emp public.employees%rowtype;
  d date; d_start date; d_end date; v_today date;
  v_start time; v_end time; v_days int[]; v_grace int; v_hours numeric;
  v_day_val numeric; v_min_val numeric; v_cap numeric;
  att public.attendance%rowtype; ex public.attendance_exemptions%rowtype;
  v_in_min int; v_out_min int; v_start_m int; v_end_m int;
  v_late int; v_early int; v_late_amt numeric; v_erly_amt numeric; v_sum numeric;
  v_has_ex boolean;
  sch record;
begin
  if not public.can_manage_hr() then
    raise exception 'حساب خصومات الدوام للمدير أو الموارد البشرية';
  end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not s.attendance_rules_enabled then return; end if;

  select * into emp from public.employees where id = p_employee;
  if not found or emp.exempt_from_attendance then return; end if;

  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  v_today := (now() at time zone 'Asia/Baghdad')::date;
  d_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  d_end   := least((d_start + interval '1 month - 1 day')::date, v_today);

  if s.attendance_effective_date is not null then
    d_start := greatest(d_start, s.attendance_effective_date);
  end if;
  if emp.hire_date is not null then d_start := greatest(d_start, emp.hire_date); end if;
  if emp.end_date  is not null then d_end   := least(d_end, emp.end_date);       end if;
  if d_start > d_end then return; end if;

  v_grace := coalesce(s.late_grace_minutes, 15);

  d := d_start;
  while d <= d_end loop
    -- دوام هذا اليوم: وردية ← دوام خاص ← دوام الشركة (154)
    select * into sch from public.work_schedule_on(p_employee, d);
    v_start := sch.start_time;
    v_end   := sch.end_time;
    v_days  := sch.work_days;
    v_start_m := extract(hour from v_start)::int * 60 + extract(minute from v_start)::int;
    v_end_m   := extract(hour from v_end)::int   * 60 + extract(minute from v_end)::int;
    v_hours   := greatest((v_end_m - v_start_m)::numeric / 60, 1);

    if not (extract(dow from d)::int = any(v_days)) then
      d := d + 1; continue;
    end if;

    v_has_ex := false;
    select * into ex from public.attendance_exemptions ae
     where ae.employee_id = p_employee and ae.exempt_date = d;
    if found then
      v_has_ex := true;
      if ex.exempt_type = 'يوم كامل' then
        d := d + 1; continue;
      end if;
    end if;

    if exists (select 1 from public.leaves l
                where l.employee_id = p_employee and l.status = 'موافق عليها'
                  and l.start_date <= d and l.end_date >= d) then
      d := d + 1; continue;
    end if;

    v_day_val := round(public.salary_at(p_employee, d) / 30.0);
    v_min_val := (v_day_val / v_hours) / 60.0;
    v_cap     := round(v_day_val * coalesce(s.late_daily_cap_days, 1));

    if v_day_val <= 0 then d := d + 1; continue; end if;

    select * into att from public.attendance a2
     where a2.employee_id = p_employee and a2.work_date = d;

    if not found or att.check_in is null then
      work_date := d; category := 'غياب';
      description := 'غياب يوم ' || to_char(d, 'YYYY-MM-DD');
      amount := round(v_day_val * coalesce(s.absence_deduction_days, 1));
      minutes := null;
      source_id := md5(p_employee::text || d::text || 'غياب')::uuid;
      return next;
      d := d + 1; continue;
    end if;

    if v_has_ex and ex.exempt_type = 'فترة' then
      d := d + 1; continue;
    end if;

    v_in_min := extract(hour from (att.check_in at time zone 'Asia/Baghdad'))::int * 60
              + extract(minute from (att.check_in at time zone 'Asia/Baghdad'))::int;
    v_late := case when v_in_min > v_start_m + v_grace then v_in_min - v_start_m else 0 end;

    if s.late_absent_threshold_minutes is not null
       and v_late >= s.late_absent_threshold_minutes then
      work_date := d; category := 'غياب';
      description := 'تأخير ' || v_late || ' دقيقة تجاوز عتبة الغياب — ' || to_char(d,'YYYY-MM-DD');
      amount := round(v_day_val * coalesce(s.absence_deduction_days, 1));
      minutes := v_late;
      source_id := md5(p_employee::text || d::text || 'غياب')::uuid;
      return next;
      d := d + 1; continue;
    end if;

    v_early := 0;
    if coalesce(s.early_leave_as_late, true) and att.check_out is not null then
      v_out_min := extract(hour from (att.check_out at time zone 'Asia/Baghdad'))::int * 60
                 + extract(minute from (att.check_out at time zone 'Asia/Baghdad'))::int;
      if v_out_min < v_end_m then v_early := v_end_m - v_out_min; end if;
    end if;

    v_late_amt := round(v_late  * v_min_val * coalesce(s.late_hour_factor, 1));
    v_erly_amt := round(v_early * v_min_val * coalesce(s.late_hour_factor, 1));

    v_sum := v_late_amt + v_erly_amt;
    if v_sum > v_cap and v_sum > 0 then
      v_late_amt := round(v_late_amt * v_cap / v_sum);
      v_erly_amt := v_cap - v_late_amt;
    end if;

    if v_late_amt > 0 then
      work_date := d; category := 'تأخير';
      description := 'تأخير ' || v_late || ' دقيقة — ' || to_char(d,'YYYY-MM-DD');
      amount := v_late_amt; minutes := v_late;
      source_id := md5(p_employee::text || d::text || 'تأخير')::uuid;
      return next;
    end if;

    if v_erly_amt > 0 then
      work_date := d; category := 'انصراف مبكر';
      description := 'انصراف مبكر ' || v_early || ' دقيقة — ' || to_char(d,'YYYY-MM-DD');
      amount := v_erly_amt; minutes := v_early;
      source_id := md5(p_employee::text || d::text || 'انصراف مبكر')::uuid;
      return next;
    end if;

    d := d + 1;
  end loop;
end;
$$;

create or replace function public.auto_checkout(p_days_back integer default 1)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today      date := public.baghdad_today();
  s          record;
  rec        record;
  shift_end  time;
  out_ts     timestamptz;
  closed     int := 0;
  notified   int := 0;
begin
  select * into s from public.company_settings where id = 1;

  perform set_config('app.system_stamp', 'on', true);

  for rec in
    select a.id, a.employee_id, a.work_date, a.check_in, a.note,
           e.full_name, e.user_id, e.work_end_time
      from public.attendance a
      join public.employees e on e.id = a.employee_id
     where a.check_in  is not null
       and a.check_out is null
       and a.work_date between today - greatest(p_days_back, 0) and today
     order by a.work_date, e.full_name
  loop
    -- نهاية دوام ذلك اليوم: الوردية أولاً (154)
    select coalesce(w.end_time, rec.work_end_time, s.work_end_time, '17:00'::time) into shift_end
      from public.work_schedule_on(rec.employee_id, rec.work_date) w;
    shift_end := coalesce(shift_end, rec.work_end_time, s.work_end_time, '17:00'::time);
    out_ts    := (rec.work_date + shift_end) at time zone 'Asia/Baghdad';

    if out_ts < rec.check_in then
      out_ts := rec.check_in;
    end if;

    update public.attendance
       set check_out = out_ts,
           note = coalesce(nullif(rec.note, '') || ' · ', '') || 'انصراف تلقائي'
     where id = rec.id;

    closed := closed + 1;

    if rec.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (
        rec.user_id,
        'سُجّل انصرافك تلقائياً',
        'لم تسجّل بصمة انصراف يوم ' || rec.work_date
          || '، فسجّلها النظام على نهاية دوامك ' || to_char(shift_end, 'HH24:MI')
          || '. لو الوقت غير صحيح قدّم طلب تعديل بصمة من «طلباتي».',
        '/dashboard/me/requests',
        'دوام',
        rec.id
      );
      notified := notified + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran_at', now(), 'today', today, 'closed', closed, 'notified', notified
  );
end; $$;


-- ============================================================
-- ٣) طلبات الدوام
-- ============================================================
create table if not exists public.attendance_requests (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  request_type    text not null check (request_type in
                    ('تعديل بصمة', 'مهمة رسمية', 'عمل ميداني', 'عمل عن بُعد', 'رحلة عمل')),
  start_date      date not null,
  end_date        date not null,
  check_in_time   time,
  check_out_time  time,
  reason          text not null check (btrim(reason) <> ''),
  status          text not null default 'قيد الموافقة' check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى')),
  approval_id     uuid references public.approval_requests(id) on delete set null,
  applied_at      timestamptz,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint attendance_requests_range check (end_date >= start_date and end_date - start_date <= 31),
  constraint attendance_requests_adjust check (
    request_type <> 'تعديل بصمة'
    or (start_date = end_date and (check_in_time is not null or check_out_time is not null)
        and (check_in_time is null or check_out_time is null or check_out_time > check_in_time)))
);

create index if not exists attendance_requests_emp_idx on public.attendance_requests (employee_id, start_date desc);

-- هل يمسّ المدى شهراً كشفه معتمد؟
create or replace function public.payroll_locked_between(p_employee uuid, p_from date, p_to date)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(p.period || ' ' || p.state, '، ' order by p.period)
    from public.payrolls p
   where p.employee_id = p_employee and p.state <> 'مسودة'
     and p.period between to_char(p_from, 'YYYY-MM') and to_char(p_to, 'YYYY-MM');
$$;

create or replace function public.submit_attendance_request(
  p_type text, p_start date, p_end date, p_reason text,
  p_check_in time default null, p_check_out time default null, p_employee uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(p_employee, public.my_employee_id());
  v_id uuid;
  v_locked text;
  v_today date := public.baghdad_today();
  v_name text;
begin
  if v_emp is null then raise exception 'حسابك غير مربوط بملف موظف'; end if;
  if v_emp is distinct from public.my_employee_id() and not public.can_manage_hr() then
    raise exception 'يقدّم الطلبَ صاحبُه أو الموارد البشرية نيابةً عنه';
  end if;
  if p_type = 'تعديل بصمة' and (p_start > v_today or p_start < v_today - 31) then
    raise exception 'تعديل البصمة لأيامٍ مضت خلال 31 يوماً';
  end if;
  v_locked := public.payroll_locked_between(v_emp, p_start, coalesce(p_end, p_start));
  if v_locked is not null then
    raise exception 'الفترة تمسّ كشفاً معتمداً (%) — راجع الموارد البشرية', v_locked;
  end if;

  insert into public.attendance_requests
    (employee_id, request_type, start_date, end_date, check_in_time, check_out_time, reason)
  values (v_emp, p_type, p_start, coalesce(p_end, p_start), p_check_in, p_check_out, btrim(p_reason))
  returning id into v_id;

  select e.full_name into v_name from public.employees e where e.id = v_emp;
  update public.attendance_requests
     set approval_id = public.start_approval('attendance', 'attendance_request', v_id, v_emp,
           p_type || ' — ' || v_name || ' (' || p_start ||
             case when coalesce(p_end, p_start) <> p_start then ' ← ' || p_end else '' end || ')',
           null, (coalesce(p_end, p_start) - p_start) + 1)
   where id = v_id;
  return v_id;
end $$;

-- تطبيق طلب دوام معتمد
create or replace function public.apply_attendance_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.attendance_requests%rowtype;
  v_att uuid;
  d date;
  v_who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  v_locked text;
begin
  select * into r from public.attendance_requests where id = p_id for update;
  if r.applied_at is not null then return; end if;
  v_locked := public.payroll_locked_between(r.employee_id, r.start_date, r.end_date);
  if v_locked is not null then
    raise exception 'لا يُطبَّق الطلب: كشف معتمد (%) — أعِد فتحه أولاً', v_locked;
  end if;

  if r.request_type = 'تعديل بصمة' then
    perform set_config('app.system_stamp', 'on', true);
    select a.id into v_att from public.attendance a
     where a.employee_id = r.employee_id and a.work_date = r.start_date limit 1;
    if v_att is null then
      insert into public.attendance (employee_id, work_date, check_in, check_out, source, note)
      values (r.employee_id, r.start_date,
              case when r.check_in_time is not null then (r.start_date + r.check_in_time) at time zone 'Asia/Baghdad' end,
              case when r.check_out_time is not null then (r.start_date + r.check_out_time) at time zone 'Asia/Baghdad' end,
              'تعديل معتمد', 'تعديل بصمة: ' || r.reason);
    else
      update public.attendance
         set check_in  = case when r.check_in_time  is not null
                              then (r.start_date + r.check_in_time)  at time zone 'Asia/Baghdad' else check_in end,
             check_out = case when r.check_out_time is not null
                              then (r.start_date + r.check_out_time) at time zone 'Asia/Baghdad' else check_out end,
             source = 'تعديل معتمد',
             note = coalesce(nullif(note, '') || ' · ', '') || 'تعديل بصمة: ' || r.reason
       where id = v_att;
    end if;
    perform set_config('app.system_stamp', '', true);
  else
    d := r.start_date;
    while d <= r.end_date loop
      insert into public.attendance_exemptions (employee_id, exempt_date, exempt_type, reason, created_by, created_by_name)
      values (r.employee_id, d, 'يوم كامل', r.request_type || ': ' || r.reason, auth.uid(), v_who)
      on conflict (employee_id, exempt_date) do nothing;
      d := d + 1;
    end loop;
  end if;

  update public.attendance_requests set applied_at = now() where id = p_id;
end $$;


-- ============================================================
-- ٤) العمل الإضافي
-- ============================================================
alter table public.company_settings
  add column if not exists overtime_factor_workday numeric check (overtime_factor_workday is null or overtime_factor_workday > 0),
  add column if not exists overtime_factor_offday  numeric check (overtime_factor_offday  is null or overtime_factor_offday  > 0);

comment on column public.company_settings.overtime_factor_workday is
  'معامل أجر ساعة العمل الإضافي في يوم دوام (154). فارغ = لم يحدّده المالك بعد، فلا يُحسب مبلغ.';

create table if not exists public.overtime_requests (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  work_date       date not null,
  start_time      time not null,
  end_time        time not null,
  hours           numeric not null,
  reason          text not null check (btrim(reason) <> ''),
  project_id      uuid references public.projects(id) on delete set null,
  task_id         uuid references public.tasks(id) on delete set null,
  compensation    text not null default 'أجر' check (compensation in ('أجر', 'إجازة تعويضية')),
  status          text not null default 'قيد الموافقة' check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى')),
  approval_id     uuid references public.approval_requests(id) on delete set null,
  -- لحظة الاعتماد: المعامل والأجر بالساعة والمبلغ، مجمّدةً
  is_offday       boolean,
  rate_factor     numeric,
  hourly_rate     numeric,
  amount          numeric,
  leave_days      numeric,
  payroll_id      uuid references public.payrolls(id) on delete set null,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint overtime_requests_time check (end_time > start_time),
  constraint overtime_requests_hours check (hours > 0 and hours <= 12)
);

create index if not exists overtime_requests_emp_idx on public.overtime_requests (employee_id, work_date desc);

create or replace function public.submit_overtime_request(
  p_date date, p_start time, p_end time, p_reason text,
  p_compensation text default 'أجر', p_project uuid default null, p_task uuid default null,
  p_employee uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(p_employee, public.my_employee_id());
  v_id uuid;
  v_hours numeric;
  v_today date := public.baghdad_today();
  v_locked text;
  v_name text;
begin
  if v_emp is null then raise exception 'حسابك غير مربوط بملف موظف'; end if;
  if v_emp is distinct from public.my_employee_id() and not public.can_manage_hr() then
    raise exception 'يقدّم الطلبَ صاحبُه أو الموارد البشرية نيابةً عنه';
  end if;
  if p_date < v_today - 31 or p_date > v_today + 30 then
    raise exception 'العمل الإضافي يُطلب خلال 31 يوماً مضت أو 30 يوماً قادمة';
  end if;
  if p_end <= p_start then raise exception 'وقت النهاية بعد البداية'; end if;
  v_hours := round((extract(epoch from (p_end - p_start)) / 3600.0)::numeric, 2);
  v_locked := public.payroll_locked_between(v_emp, p_date, p_date);
  if v_locked is not null then
    raise exception 'الشهر كشفه معتمد (%) — راجع الموارد البشرية', v_locked;
  end if;
  if exists (select 1 from public.overtime_requests o
              where o.employee_id = v_emp and o.work_date = p_date and o.status in ('قيد الموافقة', 'معتمد')
                and o.start_time < p_end and o.end_time > p_start) then
    raise exception 'يتداخل مع طلب عمل إضافي آخر لليوم نفسه';
  end if;

  insert into public.overtime_requests
    (employee_id, work_date, start_time, end_time, hours, reason, project_id, task_id, compensation)
  values (v_emp, p_date, p_start, p_end, v_hours, btrim(p_reason), p_project, p_task, p_compensation)
  returning id into v_id;

  select e.full_name into v_name from public.employees e where e.id = v_emp;
  update public.overtime_requests
     set approval_id = public.start_approval('overtime', 'overtime_request', v_id, v_emp,
           'عمل إضافي — ' || v_name || ' (' || p_date || '، ' || v_hours || ' ساعة)', null, null)
   where id = v_id;
  return v_id;
end $$;

-- حساب ما يستحقّه طلب معتمد — يُجمَّد لحظة الاعتماد
create or replace function public.apply_overtime_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.overtime_requests%rowtype;
  s public.company_settings%rowtype;
  sch record;
  v_hours_day numeric;
  v_off boolean;
  v_factor numeric;
  v_hourly numeric;
  v_type uuid;
begin
  select * into o from public.overtime_requests where id = p_id for update;
  select * into s from public.company_settings where id = 1;
  select * into sch from public.work_schedule_on(o.employee_id, o.work_date);
  v_hours_day := greatest(extract(epoch from (sch.end_time - sch.start_time)) / 3600.0, 1);
  v_off := not (extract(dow from o.work_date)::int = any (sch.work_days));

  if o.compensation = 'أجر' then
    v_factor := case when v_off then s.overtime_factor_offday else s.overtime_factor_workday end;
    v_hourly := round(public.salary_at(o.employee_id, o.work_date) / 30.0 / v_hours_day);
    update public.overtime_requests
       set is_offday = v_off, rate_factor = v_factor, hourly_rate = v_hourly,
           amount = case when v_factor is null then null else round(o.hours * v_hourly * v_factor) end
     where id = p_id;
  else
    select t.id into v_type from public.leave_types t where t.name = 'تعويضية';
    update public.overtime_requests
       set is_offday = v_off, leave_days = round(o.hours / v_hours_day, 2)
     where id = p_id;
    if v_type is not null then
      insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note, created_by, created_by_name)
      values (o.employee_id, v_type, o.work_date, round(o.hours / v_hours_day, 2), 'تعويض عمل إضافي',
              'عمل إضافي ' || o.work_date || ' — ' || o.hours || ' ساعة', auth.uid(),
              coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'));
    end if;
  end if;
end $$;


-- ============================================================
-- ٥) RLS — القراءة لصاحبه وفريقه ومُوافقيه وHR، والكتابة بالدوالّ
-- ============================================================
alter table public.attendance_requests enable row level security;
alter table public.overtime_requests   enable row level security;

drop policy if exists "read attendance requests" on public.attendance_requests;
create policy "read attendance requests" on public.attendance_requests for select to authenticated
  using ((select public.can_manage_hr()) or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t)
         or employee_id in (select m.id from public.my_scope_employees() m)
         or (approval_id is not null and public.can_see_approval(approval_id)));

drop policy if exists "read overtime requests" on public.overtime_requests;
create policy "read overtime requests" on public.overtime_requests for select to authenticated
  using ((select public.can_manage_hr()) or (select public.can_manage_finance())
         or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t)
         or employee_id in (select m.id from public.my_scope_employees() m)
         or (approval_id is not null and public.can_see_approval(approval_id)));

revoke all on public.attendance_requests, public.overtime_requests from anon;

drop trigger if exists trg_audit_attendance_requests on public.attendance_requests;
create trigger trg_audit_attendance_requests after insert or update or delete on public.attendance_requests
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_overtime_requests on public.overtime_requests;
create trigger trg_audit_overtime_requests after insert or update or delete on public.overtime_requests
  for each row execute function public.audit_row();

revoke all on function public.work_schedule_on(uuid, date)                  from public, anon;
revoke all on function public.payroll_locked_between(uuid, date, date)      from public, anon, authenticated;
revoke all on function public.apply_attendance_request(uuid)                from public, anon, authenticated;
revoke all on function public.apply_overtime_request(uuid)                  from public, anon, authenticated;
revoke all on function public.submit_attendance_request(text, date, date, text, time, time, uuid) from public, anon;
revoke all on function public.submit_overtime_request(date, time, time, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.work_schedule_on(uuid, date)               to authenticated;
grant execute on function public.submit_attendance_request(text, date, date, text, time, time, uuid) to authenticated;
grant execute on function public.submit_overtime_request(date, time, time, text, text, uuid, uuid, uuid) to authenticated;
