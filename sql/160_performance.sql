-- ============================================================
-- تلال ERP — 160: الأداء والأهداف (HR المؤسسي — المرحلة 6)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 146، 154 (work_schedule_on)، 150 (التوظيف)، 096+ (crm_report_query).
--
-- ============================================================
-- المبدأ: الهدف عامّ لا مبيعاتيّ
--
--   kpi_definitions   مؤشر بمصدر فعليّه: يدوي · CRM (مقاييس 096) · المهام ·
--                     الدوام · التوظيف — ولكل قسم مؤشراته (تسويق، مبيعات، HR، مالية)
--   employee_targets  (موجود منذ 067 وفارغ) يُطوَّر ولا يُستبدل: هدفٌ لموظف أو
--                     قسم أو مشروع، بفترة، وقيمة مستهدفة، وفعلي يُحسب، ونسبة إنجاز
--   performance_reviews  ذاتي ← المدير ← HR، ونتيجة نهائية بأوزان قابلة للإعداد:
--                     الأهداف · المدير · الذاتي · HR
--
-- الفعلي من المصدر نفسه الذي تقرؤه تقارير الوحدة — CRM من crm_report_query،
-- فلا يُكتب منطق قياس ثانٍ. والمؤشر اليدوي يُدخل فعليَّه المدير أو HR.
-- الحساب كله في القاعدة: الفعلي، الإنجاز، الدرجة، النتيجة.
-- ============================================================


-- ============================================================
-- ١) المؤشرات
-- ============================================================
create table if not exists public.kpi_definitions (
  code            text primary key check (code ~ '^[A-Z0-9_]{2,40}$'),
  name_ar         text not null,
  department_id   uuid references public.departments(id) on delete set null,
  unit            text not null default 'عدد' check (unit in ('عدد', 'مبلغ', 'نسبة', 'ساعة', 'يوم')),
  good_direction  text not null default 'أعلى' check (good_direction in ('أعلى', 'أدنى')),
  source          text not null default 'يدوي' check (source in ('يدوي', 'CRM', 'المهام', 'الدوام', 'التوظيف')),
  crm_metric      text references public.crm_metrics(code) on update cascade on delete set null,
  hr_metric       text check (hr_metric in ('hires', 'time_to_hire', 'retention')),
  description     text,
  active          boolean not null default true,
  sort_order      int not null default 0,
  constraint kpi_definitions_crm check (source <> 'CRM' or crm_metric is not null),
  constraint kpi_definitions_hr check (source <> 'التوظيف' or hr_metric is not null)
);

insert into public.kpi_definitions (code, name_ar, department_id, unit, good_direction, source, crm_metric, hr_metric, sort_order)
select v.code, v.name_ar, d.id, v.unit, v.dir, v.src, v.crm, v.hr, v.ord
  from (values
    -- المبيعات (من محرّك CRM)
    ('SALES_UNITS',      'وحدات مباعة',           'SALES', 'عدد',  'أعلى', 'CRM',     'SALES_COMPLETED', null, 10),
    ('SALES_REVENUE',    'قيمة المبيعات',         'SALES', 'مبلغ', 'أعلى', 'CRM',     'SALES_VALUE',     null, 11),
    ('SALES_CONVERSION', 'معدّل التحويل',         'SALES', 'نسبة', 'أعلى', 'CRM',     'CONVERSION_RATE', null, 12),
    ('SALES_RESERVATIONS','حجوزات',               'SALES', 'عدد',  'أعلى', 'CRM',     'RESERVATIONS',    null, 13),
    ('SALES_CALLS',      'مكالمات',               'SALES', 'عدد',  'أعلى', 'CRM',     'CALLS',           null, 14),
    ('SALES_COLLECTIONS','تحصيلات',               'SALES', 'مبلغ', 'أعلى', 'يدوي',    null,              null, 15),
    -- التسويق
    ('MKT_LEADS',        'ليدات جديدة',           'MKT',   'عدد',  'أعلى', 'CRM',     'NEW_LEADS',       null, 20),
    ('MKT_REACH',        'الوصول',                'MKT',   'عدد',  'أعلى', 'يدوي',    null,              null, 21),
    ('MKT_ENGAGEMENT',   'التفاعل',               'MKT',   'نسبة', 'أعلى', 'يدوي',    null,              null, 22),
    ('MKT_CONTENT',      'إنتاج المحتوى',         'MKT',   'عدد',  'أعلى', 'المهام',  null,              null, 23),
    ('MKT_CAMPAIGN',     'أداء الحملات',          'MKT',   'نسبة', 'أعلى', 'يدوي',    null,              null, 24),
    -- الموارد البشرية
    ('HR_HIRES',         'تعيينات',               'HR',    'عدد',  'أعلى', 'التوظيف', null,              'hires', 30),
    ('HR_TIME_TO_HIRE',  'مدة التوظيف',           'HR',    'يوم',  'أدنى', 'التوظيف', null,              'time_to_hire', 31),
    ('HR_RETENTION',     'الاحتفاظ بالموظفين',    'HR',    'نسبة', 'أعلى', 'التوظيف', null,              'retention', 32),
    -- المالية
    ('FIN_COLLECTIONS',  'التحصيل',               'FIN',   'مبلغ', 'أعلى', 'يدوي',    null,              null, 40),
    ('FIN_CLOSING',      'إغلاق الشهر في موعده',  'FIN',   'يوم',  'أدنى', 'يدوي',    null,              null, 41),
    ('FIN_ACCURACY',     'دقة القيود',            'FIN',   'نسبة', 'أعلى', 'يدوي',    null,              null, 42),
    -- عامة لكل قسم
    ('TASKS_DONE',       'مهام منجزة',            null,    'عدد',  'أعلى', 'المهام',  null,              null, 1),
    ('ATTENDANCE_RATE',  'نسبة الحضور',           null,    'نسبة', 'أعلى', 'الدوام',  null,              null, 2)
  ) v(code, name_ar, dept, unit, dir, src, crm, hr, ord)
  left join public.departments d on d.code = v.dept
 where (v.crm is null or exists (select 1 from public.crm_metrics m where m.code = v.crm))
on conflict (code) do nothing;


-- ============================================================
-- ٢) الأهداف — employee_targets يُطوَّر
-- ============================================================
alter table public.employee_targets alter column employee_id drop not null;
alter table public.employee_targets alter column period drop not null;

alter table public.employee_targets
  add column if not exists kpi_code        text references public.kpi_definitions(code) on update cascade,
  add column if not exists department_id   uuid references public.departments(id) on delete cascade,
  add column if not exists project_id      uuid references public.projects(id) on delete set null,
  add column if not exists period_start    date,
  add column if not exists period_end      date,
  add column if not exists target_value    numeric,
  add column if not exists actual_value    numeric,
  add column if not exists actual_updated_at timestamptz,
  add column if not exists weight          numeric not null default 1 check (weight > 0),
  add column if not exists title           text;

-- الإنجاز: للمؤشر «أعلى أفضل» الفعلي ÷ المستهدف، و«أدنى أفضل» المستهدف ÷ الفعلي
alter table public.employee_targets add column if not exists direction text not null default 'أعلى'
  check (direction in ('أعلى', 'أدنى'));
alter table public.employee_targets add column if not exists achievement_pct numeric
  generated always as (
    case
      when target_value is null or actual_value is null then null
      when direction = 'أعلى' and target_value > 0 then round(actual_value / target_value * 100, 1)
      when direction = 'أدنى' and actual_value > 0 then round(target_value / actual_value * 100, 1)
      when direction = 'أدنى' and actual_value = 0 then 100
    end
  ) stored;

alter table public.employee_targets drop constraint if exists employee_targets_owner;
alter table public.employee_targets add constraint employee_targets_owner
  check (employee_id is not null or department_id is not null or project_id is not null);
alter table public.employee_targets drop constraint if exists employee_targets_period;
alter table public.employee_targets add constraint employee_targets_period
  check (period_start is null or period_end is null or period_end >= period_start);

create index if not exists employee_targets_emp_period_idx on public.employee_targets (employee_id, period_start);

-- القيد القديم (موظف، شهر) يمنع أكثر من هدف في الشهر — يبقى للصفوف القديمة
-- بلا مؤشر، ويحلّ محلّه للمؤشرات: هدفٌ واحد لكل (صاحب، مؤشر، بداية فترة)
alter table public.employee_targets drop constraint if exists employee_targets_uniq;
create unique index if not exists employee_targets_legacy_uniq
  on public.employee_targets (employee_id, period) where kpi_code is null;
create unique index if not exists employee_targets_kpi_uniq
  on public.employee_targets (coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid),
                              coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                              coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                              kpi_code, period_start)
  where kpi_code is not null;

comment on table public.employee_targets is
  'الأهداف (067، مُطوَّر في 160): لموظف أو قسم أو مشروع، بمؤشر من kpi_definitions وفترة. '
  'الفعلي يُحسب من مصدر المؤشر (refresh_target_actual) أو يُدخل يدوياً، والإنجاز عمود محسوب.';

-- الاتساق: الفترة القديمة النصّية تُشتق، واتجاه الإنجاز من المؤشر
create or replace function public.stamp_employee_target()
returns trigger language plpgsql security definer set search_path = public as $$
declare k public.kpi_definitions%rowtype;
begin
  if new.kpi_code is not null then
    select * into k from public.kpi_definitions where code = new.kpi_code;
    new.direction := k.good_direction;
    new.title := coalesce(nullif(btrim(new.title), ''), k.name_ar);
  end if;
  if new.period_start is not null then
    new.period := coalesce(new.period, to_char(new.period_start, 'YYYY-MM'));
    new.period_end := coalesce(new.period_end, (date_trunc('month', new.period_start) + interval '1 month - 1 day')::date);
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;

drop trigger if exists trg_stamp_employee_target on public.employee_targets;
create trigger trg_stamp_employee_target before insert or update on public.employee_targets
  for each row execute function public.stamp_employee_target();


-- ============================================================
-- ٣) حساب الفعلي من المصدر
-- ============================================================
create or replace function public.compute_target_actual(p_target uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  t public.employee_targets%rowtype;
  k public.kpi_definitions%rowtype;
  e public.employees%rowtype;
  v numeric;
  v_filters jsonb := '{}'::jsonb;
  d date; sch record; v_sched int := 0; v_present int := 0;
  v_dept_ids uuid[];
begin
  select * into t from public.employee_targets where id = p_target;
  if not found or t.kpi_code is null or t.period_start is null then return null; end if;
  select * into k from public.kpi_definitions where code = t.kpi_code;
  if k.source = 'يدوي' then return t.actual_value; end if;
  if t.employee_id is not null then select * into e from public.employees where id = t.employee_id; end if;
  if t.department_id is not null then
    select array_agg(x.id) into v_dept_ids from public.department_descendants(t.department_id) x;
  end if;

  if k.source = 'CRM' then
    if t.employee_id is not null then
      v_filters := jsonb_build_object('employee', jsonb_build_array(t.employee_id));
    elsif t.project_id is not null then
      v_filters := jsonb_build_object('project', jsonb_build_array(t.project_id));
    elsif v_dept_ids is not null then
      v_filters := jsonb_build_object('employee',
        coalesce((select jsonb_agg(x.id) from public.employees x where x.department_id = any (v_dept_ids)), '[]'::jsonb));
    end if;
    select (q.metrics ->> k.crm_metric)::numeric into v
      from public.crm_report_query(array[k.crm_metric], '{}'::text[], t.period_start, t.period_end,
                                   v_filters, 'event', 'current', null, null, 5000) q
     limit 1;
    return coalesce(v, 0);

  elsif k.source = 'المهام' then
    select count(*) into v from public.tasks x
     where x.status = 'منجزة' and x.completed_at::date between t.period_start and t.period_end
       and (x.assigned_to = e.user_id
            or (t.employee_id is null and x.assigned_to in (
                  select y.user_id from public.employees y where y.department_id = any (coalesce(v_dept_ids, '{}')))));
    v := v + (select count(*) from public.mkt_tasks x
               where x.status in ('منجزة', 'مكتملة') and x.completed_at::date between t.period_start and t.period_end
                 and (x.assignee_id = t.employee_id
                      or (t.employee_id is null and x.assignee_id in (
                            select y.id from public.employees y where y.department_id = any (coalesce(v_dept_ids, '{}'))))));
    return v;

  elsif k.source = 'الدوام' then
    if t.employee_id is null then return null; end if;
    d := greatest(t.period_start, coalesce(e.hire_date, t.period_start));
    while d <= least(t.period_end, public.baghdad_today(), coalesce(e.end_date, t.period_end)) loop
      select * into sch from public.work_schedule_on(t.employee_id, d);
      if extract(dow from d)::int = any (sch.work_days)
         and not exists (select 1 from public.leaves l where l.employee_id = t.employee_id and l.status = 'موافق عليها'
                          and l.start_date <= d and l.end_date >= d)
         and not exists (select 1 from public.attendance_exemptions x where x.employee_id = t.employee_id
                          and x.exempt_date = d and x.exempt_type = 'يوم كامل') then
        v_sched := v_sched + 1;
        if exists (select 1 from public.attendance a where a.employee_id = t.employee_id
                    and a.work_date = d and a.check_in is not null) then
          v_present := v_present + 1;
        end if;
      end if;
      d := d + 1;
    end loop;
    return case when v_sched = 0 then null else round(v_present::numeric / v_sched * 100, 1) end;

  elsif k.source = 'التوظيف' then
    if k.hr_metric = 'hires' then
      select count(*) into v from public.employees x
       where x.hire_date between t.period_start and t.period_end
         and (v_dept_ids is null or x.department_id = any (v_dept_ids));
    elsif k.hr_metric = 'time_to_hire' then
      select round(avg(x.hire_date - o.opened_at), 1) into v
        from public.job_applications a
        join public.job_openings o on o.id = a.opening_id
        join public.employees x on x.id = a.employee_id
       where a.stage = 'تم التعيين' and x.hire_date between t.period_start and t.period_end
         and (v_dept_ids is null or o.department_id = any (v_dept_ids));
    elsif k.hr_metric = 'retention' then
      -- من كان على رأس العمل أول الفترة وبقي آخرها ÷ من كان أولها
      select round(100.0 * count(*) filter (where x.end_date is null or x.end_date > t.period_end)
                   / nullif(count(*), 0), 1)
        into v
        from public.employees x
       where coalesce(x.hire_date, t.period_start) <= t.period_start
         and (x.end_date is null or x.end_date >= t.period_start)
         and (v_dept_ids is null or x.department_id = any (v_dept_ids));
    end if;
    return v;
  end if;
  return null;
end $$;

create or replace function public.refresh_target_actual(p_target uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric; k text;
begin
  select kd.source into k from public.employee_targets t join public.kpi_definitions kd on kd.code = t.kpi_code
   where t.id = p_target;
  if k is null or k = 'يدوي' then
    return (select actual_value from public.employee_targets where id = p_target);
  end if;
  v := public.compute_target_actual(p_target);
  update public.employee_targets set actual_value = v, actual_updated_at = now() where id = p_target;
  return v;
end $$;

-- كل الأهداف الجارية (أو المنتهية خلال 31 يوماً) — cron يومي
create or replace function public.refresh_all_target_actuals()
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select t.id from public.employee_targets t join public.kpi_definitions k on k.code = t.kpi_code
     where k.source <> 'يدوي' and t.period_start <= public.baghdad_today()
       and t.period_end >= public.baghdad_today() - 31
  loop
    perform public.refresh_target_actual(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  perform cron.unschedule('targets-refresh')
    where exists (select 1 from cron.job where jobname = 'targets-refresh');
  perform cron.schedule('targets-refresh', '40 3 * * *', 'select public.refresh_all_target_actuals();');
end $$;

-- إدخال الفعلي اليدوي: HR أو مدير صاحب الهدف — لا صاحبه
create or replace function public.set_target_actual(p_target uuid, p_value numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.employee_targets%rowtype; k text;
begin
  select * into t from public.employee_targets where id = p_target;
  if not found then raise exception 'الهدف غير موجود'; end if;
  select source into k from public.kpi_definitions where code = t.kpi_code;
  if k is not null and k <> 'يدوي' then raise exception 'فعليّ هذا المؤشر يُحسب من مصدره (%)', k; end if;
  if t.employee_id = public.my_employee_id() then raise exception 'لا يُدخل أحد فعليَّ هدفه'; end if;
  if not (public.can_manage_hr()
          or (t.employee_id is not null and public.is_manager_of(t.employee_id))
          or (t.department_id is not null and t.department_id in (select m.id from public.my_managed_department_ids() m))) then
    raise exception 'يُدخل الفعليَّ مدير صاحب الهدف أو الموارد البشرية';
  end if;
  update public.employee_targets set actual_value = p_value, actual_updated_at = now() where id = p_target;
end $$;

-- مَن يحدّد أهداف مَن: HR الكل، والمدير فريقه وقسمه
create or replace function public.can_set_target(p_employee uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_hr()
      or (p_employee is not null and public.is_manager_of(p_employee))
      or (p_employee is null and p_department is not null
          and p_department in (select m.id from public.my_managed_department_ids() m));
$$;


-- أسماء فريقي — للمدير الذي لا يقرأ جدول الموظفين (لا رواتب)
create or replace function public.team_member_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name from public.employees e
   where e.status = 'active' and e.id in (select t.id from public.my_team_employee_ids() t)
   order by e.full_name;
$$;

revoke all on function public.team_member_names() from public, anon;
grant execute on function public.team_member_names() to authenticated;


-- ============================================================
-- ٤) مراجعات الأداء
-- ============================================================
create table if not exists public.performance_settings (
  id               smallint primary key default 1 check (id = 1),
  weight_targets   numeric not null default 50 check (weight_targets >= 0),
  weight_manager   numeric not null default 30 check (weight_manager >= 0),
  weight_self      numeric not null default 10 check (weight_self >= 0),
  weight_hr        numeric not null default 10 check (weight_hr >= 0),
  constraint performance_weights_sum check (weight_targets + weight_manager + weight_self + weight_hr = 100)
);
insert into public.performance_settings (id) values (1) on conflict do nothing;

comment on table public.performance_settings is
  'أوزان النتيجة النهائية للمراجعة (160) — مبدئية يعدّلها المالك، ومجموعها 100.';

create table if not exists public.performance_reviews (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  cycle             text not null check (cycle in ('شهري', 'ربعي', 'سنوي')),
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'تقييم ذاتي'
                      check (status in ('تقييم ذاتي', 'تقييم المدير', 'مراجعة HR', 'مكتمل', 'ملغى')),
  self_score        numeric check (self_score between 1 and 5),
  self_comments     text,
  self_at           timestamptz,
  manager_id        uuid references public.employees(id) on delete set null,
  manager_score     numeric check (manager_score between 1 and 5),
  manager_comments  text,
  manager_at        timestamptz,
  hr_score          numeric check (hr_score between 1 and 5),
  hr_comments       text,
  hr_at             timestamptz,
  targets_pct       numeric,
  final_score       numeric,
  recommendation    text check (recommendation in ('لا شيء', 'مكافأة', 'ترقية', 'تدريب', 'خطة تحسين')),
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (employee_id, cycle, period_start),
  constraint performance_reviews_period check (period_end >= period_start)
);

create index if not exists performance_reviews_status_idx on public.performance_reviews (status, period_start);

-- إنجاز الأهداف الموزون لموظف في فترة (سقف 150% لكل هدف)
create or replace function public.weighted_target_achievement(p_employee uuid, p_from date, p_to date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(sum(least(t.achievement_pct, 150) * t.weight) / nullif(sum(t.weight), 0), 1)
    from public.employee_targets t
   where t.employee_id = p_employee and t.achievement_pct is not null
     and t.period_start <= p_to and t.period_end >= p_from;
$$;

-- فتح دورة مراجعة: لموظف أو لقسم كامل
create or replace function public.open_review_cycle(
  p_cycle text, p_start date, p_end date, p_department uuid default null, p_employee uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_manage_hr() then raise exception 'فتح دورات التقييم للموارد البشرية'; end if;
  insert into public.performance_reviews (employee_id, cycle, period_start, period_end, manager_id)
  select e.id, p_cycle, p_start, p_end, e.manager_id
    from public.employees e
   where e.status = 'active'
     and (p_employee is null or e.id = p_employee)
     and (p_department is null or e.department_id in (select x.id from public.department_descendants(p_department) x))
     and (e.hire_date is null or e.hire_date <= p_end)
  on conflict (employee_id, cycle, period_start) do nothing;
  get diagnostics n = row_count;

  insert into public.notifications (user_id, title, body, link, kind, category)
  select e.user_id, 'قيّم أداءك — ' || p_cycle, p_start || ' ← ' || p_end, '/dashboard/me/performance', 'أداء', 'HR'
    from public.performance_reviews r join public.employees e on e.id = r.employee_id
   where r.cycle = p_cycle and r.period_start = p_start and r.status = 'تقييم ذاتي'
     and e.user_id is not null and r.created_at > now() - interval '1 minute';
  return n;
end $$;

-- خطوة في المراجعة: ذاتي (صاحبها) ← المدير (مديره) ← HR (يُنهي ويحسب)
create or replace function public.submit_review_step(
  p_review uuid, p_step text, p_score numeric, p_comments text default null, p_recommendation text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.performance_reviews%rowtype;
  s public.performance_settings%rowtype;
  v_targets numeric;
  v_final numeric;
  v_wsum numeric;
begin
  select * into r from public.performance_reviews where id = p_review for update;
  if not found then raise exception 'المراجعة غير موجودة'; end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'الدرجة من 1 إلى 5'; end if;

  if p_step = 'ذاتي' then
    if r.employee_id is distinct from public.my_employee_id() then raise exception 'التقييم الذاتي لصاحبه'; end if;
    if r.status <> 'تقييم ذاتي' then raise exception 'المراجعة في مرحلة «%»', r.status; end if;
    update public.performance_reviews
       set self_score = p_score, self_comments = nullif(btrim(p_comments), ''), self_at = now(),
           status = case when manager_id is null then 'مراجعة HR' else 'تقييم المدير' end
     where id = p_review;
    if r.manager_id is not null then
      perform public.hr_notify_employee(r.manager_id, 'قيّم أداء فريقك',
        'وصل تقييمٌ ذاتي بانتظارك', '/dashboard/hr/performance', 'أداء', p_review, 'performance_review');
    end if;

  elsif p_step = 'المدير' then
    if not (public.is_manager_of(r.employee_id) or public.is_admin()) then
      raise exception 'تقييم المدير لمديره المباشر أو مدير قسمه';
    end if;
    if r.status <> 'تقييم المدير' then raise exception 'المراجعة في مرحلة «%»', r.status; end if;
    update public.performance_reviews
       set manager_score = p_score, manager_comments = nullif(btrim(p_comments), ''), manager_at = now(),
           status = 'مراجعة HR', recommendation = coalesce(p_recommendation, recommendation)
     where id = p_review;

  elsif p_step = 'HR' then
    if not public.can_manage_hr() then raise exception 'المراجعة النهائية للموارد البشرية'; end if;
    if r.employee_id = public.my_employee_id() then raise exception 'لا يُنهي أحد مراجعته'; end if;
    if r.status <> 'مراجعة HR' then raise exception 'المراجعة في مرحلة «%»', r.status; end if;
    select * into s from public.performance_settings where id = 1;
    v_targets := public.weighted_target_achievement(r.employee_id, r.period_start, r.period_end);

    -- كل مكوّن على مقياس 0–100: الدرجات (1–5) × 20، والأهداف بنسبتها (سقف 100)
    -- والمكوّن الغائب يُسقط ويُعاد توزيع وزنه على الحاضر
    v_wsum := s.weight_hr
            + case when v_targets is not null then s.weight_targets else 0 end
            + case when r.manager_score is not null then s.weight_manager else 0 end
            + case when r.self_score is not null then s.weight_self else 0 end;
    v_final := round((
        p_score * 20 * s.weight_hr
      + coalesce(least(v_targets, 100) * s.weight_targets, 0)
      + coalesce(r.manager_score * 20 * s.weight_manager, 0)
      + coalesce(r.self_score * 20 * s.weight_self, 0)
    ) / nullif(v_wsum, 0), 1);

    update public.performance_reviews
       set hr_score = p_score, hr_comments = nullif(btrim(p_comments), ''), hr_at = now(),
           targets_pct = v_targets, final_score = v_final, status = 'مكتمل',
           recommendation = coalesce(p_recommendation, recommendation, 'لا شيء')
     where id = p_review;
    perform public.hr_notify_employee(r.employee_id, 'اكتمل تقييم أدائك',
      'النتيجة ' || v_final || ' من 100', '/dashboard/me/performance', 'أداء', p_review, 'performance_review');
  else
    raise exception 'الخطوة: ذاتي أو المدير أو HR';
  end if;

  return (select status from public.performance_reviews where id = p_review);
end $$;


-- ============================================================
-- ٥) RLS
-- ============================================================
alter table public.kpi_definitions      enable row level security;
alter table public.employee_targets     enable row level security;
alter table public.performance_settings enable row level security;
alter table public.performance_reviews  enable row level security;

drop policy if exists "read kpis" on public.kpi_definitions;
create policy "read kpis" on public.kpi_definitions for select to authenticated using (not (select public.is_broker()));
drop policy if exists "hr manages kpis" on public.kpi_definitions;
create policy "hr manages kpis" on public.kpi_definitions for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

-- الأهداف: السياسات القديمة (067) تبقى؛ ويُضاف المدير لفريقه وقسمه
drop policy if exists "managers read team targets" on public.employee_targets;
create policy "managers read team targets" on public.employee_targets for select to authenticated
  using ((employee_id is not null and public.is_manager_of(employee_id))
         or (department_id is not null and department_id in (select m.id from public.my_managed_department_ids() m))
         or (employee_id is null and department_id is not null
             and department_id = (select e.department_id from public.employees e where e.id = (select public.my_employee_id()))));
drop policy if exists "managers set team targets" on public.employee_targets;
create policy "managers set team targets" on public.employee_targets for insert to authenticated
  with check (public.can_set_target(employee_id, department_id) and employee_id is distinct from (select public.my_employee_id()));
drop policy if exists "managers edit team targets" on public.employee_targets;
create policy "managers edit team targets" on public.employee_targets for update to authenticated
  using (public.can_set_target(employee_id, department_id) and employee_id is distinct from (select public.my_employee_id()))
  with check (public.can_set_target(employee_id, department_id) and employee_id is distinct from (select public.my_employee_id()));

drop policy if exists "read performance settings" on public.performance_settings;
create policy "read performance settings" on public.performance_settings for select to authenticated using (true);
drop policy if exists "hr manages performance settings" on public.performance_settings;
create policy "hr manages performance settings" on public.performance_settings for update to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

drop policy if exists "read reviews" on public.performance_reviews;
create policy "read reviews" on public.performance_reviews for select to authenticated
  using ((select public.can_manage_hr()) or employee_id = (select public.my_employee_id())
         or public.is_manager_of(employee_id));
drop policy if exists "hr manages reviews" on public.performance_reviews;
create policy "hr manages reviews" on public.performance_reviews for delete to authenticated
  using ((select public.can_manage_hr()));

revoke all on public.kpi_definitions, public.performance_settings, public.performance_reviews from anon;

drop trigger if exists trg_audit_performance_reviews on public.performance_reviews;
create trigger trg_audit_performance_reviews after insert or update or delete on public.performance_reviews
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_kpi_definitions on public.kpi_definitions;
create trigger trg_audit_kpi_definitions after insert or update or delete on public.kpi_definitions
  for each row execute function public.audit_row();

revoke all on function public.compute_target_actual(uuid)              from public, anon, authenticated;
revoke all on function public.refresh_all_target_actuals()             from public, anon, authenticated;
revoke all on function public.refresh_target_actual(uuid)              from public, anon;
revoke all on function public.set_target_actual(uuid, numeric)         from public, anon;
revoke all on function public.can_set_target(uuid, uuid)               from public, anon;
revoke all on function public.weighted_target_achievement(uuid, date, date) from public, anon;
revoke all on function public.open_review_cycle(text, date, date, uuid, uuid) from public, anon;
revoke all on function public.submit_review_step(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.refresh_target_actual(uuid)              to authenticated;
grant execute on function public.set_target_actual(uuid, numeric)         to authenticated;
grant execute on function public.can_set_target(uuid, uuid)               to authenticated;
grant execute on function public.weighted_target_achievement(uuid, date, date) to authenticated;
grant execute on function public.open_review_cycle(text, date, date, uuid, uuid) to authenticated;
grant execute on function public.submit_review_step(uuid, text, numeric, text, text) to authenticated;

update public.app_modules set note = 'المرحلة 6: المؤشرات والأهداف ومراجعات الأداء (160).' where code = 'performance';
