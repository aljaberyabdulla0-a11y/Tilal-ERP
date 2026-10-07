-- ============================================================
-- تلال ERP — 165: محرّك تقارير HR ولوحة HR (HR المؤسسي — المرحلة 8)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145–164.
--
-- ============================================================
-- المبدأ — كمحرّك تقارير CRM والتسويق:
--
--   hr_report(key, from, to, filters) ⇒ { title, columns[{key,label,kind}], rows[] }
--   الشاشة وملف Excel وطباعة PDF تقرأ الدالة نفسها — لا يخرج في الملف رقمٌ
--   لم يظهر، ولا يُحسب في المتصفح رقم.
--
-- النطاق (hr_report_employees): HR والمالية الكل؛ والمدير فريقه وقسمه — ثم
-- المرشّحات: القسم (وما تحته)، الموظف، المشروع (أو توزيعه)، المدير، الحالة.
-- تقارير المال (الرواتب، الكلفة، العمولات، العمل الإضافي، المصروفات) لـ HR
-- والمالية وحدهما. والبيانات الشخصية (الهاتف والبريد) لـ HR وحدها.
--
-- التقارير: employees · headcount · attendance · absence · late · leaves ·
--   payroll · salary_cost · commissions · overtime · expenses · turnover ·
--   hiring · probation · performance · targets · documents
-- ============================================================


-- ============================================================
-- ١) النطاق
-- ============================================================
create or replace function public.hr_report_employees(p_filters jsonb default '{}'::jsonb)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select e.id
    from public.employees e
   where (public.can_manage_hr() or public.can_manage_finance()
          or e.id in (select t.id from public.my_team_employee_ids() t)
          or e.department_id in (select m.id from public.my_managed_department_ids() m))
     and (nullif(p_filters->>'department', '') is null
          or e.department_id in (select d.id from public.department_descendants((p_filters->>'department')::uuid) d))
     and (nullif(p_filters->>'employee', '') is null or e.id = (p_filters->>'employee')::uuid)
     and (nullif(p_filters->>'manager', '') is null or e.manager_id = (p_filters->>'manager')::uuid)
     and (nullif(p_filters->>'project', '') is null
          or e.project_id = (p_filters->>'project')::uuid
          or exists (select 1 from public.employee_project_allocations a
                      where a.employee_id = e.id and a.project_id = (p_filters->>'project')::uuid))
     and (coalesce(p_filters->>'status', 'all') = 'all'
          or (p_filters->>'status' = 'active' and e.status = 'active')
          or (p_filters->>'status' = 'inactive' and e.status <> 'active'));
$$;

-- الكتالوج وما يحقّ للمستخدم منه
create or replace function public.hr_report_catalog()
returns table (key text, title text, money boolean, allowed boolean)
language sql stable security definer set search_path = public as $$
  with c(key, title, money, ord) as (values
    ('employees',   'سجلّ الموظفين',             false, 1),
    ('headcount',   'التعداد حسب القسم',         false, 2),
    ('attendance',  'الدوام',                    false, 3),
    ('absence',     'الغياب',                    false, 4),
    ('late',        'التأخير',                   false, 5),
    ('leaves',      'الإجازات',                  false, 6),
    ('payroll',     'الرواتب',                   true,  7),
    ('salary_cost', 'كلفة الرواتب حسب القسم',    true,  8),
    ('commissions', 'العمولات',                  true,  9),
    ('overtime',    'العمل الإضافي',             true,  10),
    ('expenses',    'المصروفات',                 true,  11),
    ('turnover',    'دوران الموظفين',            false, 12),
    ('hiring',      'التوظيف',                   false, 13),
    ('probation',   'فترة التجربة',              false, 14),
    ('performance', 'الأداء',                    false, 15),
    ('targets',     'الأهداف',                   false, 16),
    ('documents',   'انتهاء المستندات',          false, 17)
  )
  select c.key, c.title, c.money,
         case when c.money then public.can_see_payroll() or public.can_manage_finance()
              else public.can_manage_hr() or public.can_manage_finance()
                   or exists (select 1 from public.my_team_employee_ids())
                   or exists (select 1 from public.my_managed_department_ids()) end
    from c order by c.ord;
$$;


-- ============================================================
-- ٢) المحرّك
-- ============================================================
create or replace function public.hr_report(
  p_report text, p_from date default null, p_to date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f date := coalesce(p_from, date_trunc('month', public.baghdad_today())::date);
  t date := coalesce(p_to, public.baghdad_today());
  v_emps uuid[];
  v_hr boolean := public.can_manage_hr();
  v_money boolean := public.can_see_payroll() or public.can_manage_finance();
  v_title text;
  v_cols jsonb;
  v_rows jsonb;
  v_grace int;
  v_base date;
  v_fp text; v_tp text;
begin
  if t < f then raise exception 'نهاية المدى قبل بدايته'; end if;
  if t - f > 400 then raise exception 'المدى أطول من 400 يوم — جزّئه'; end if;

  select c.title into v_title from public.hr_report_catalog() c where c.key = p_report and c.allowed;
  if v_title is null then
    if exists (select 1 from public.hr_report_catalog() c where c.key = p_report) then
      raise exception 'هذا التقرير ليس لدورك';
    end if;
    raise exception 'تقرير غير معروف: %', p_report;
  end if;

  v_emps := array(select x.id from public.hr_report_employees(coalesce(p_filters, '{}'::jsonb)) x);
  v_fp := to_char(f, 'YYYY-MM');
  v_tp := to_char(t, 'YYYY-MM');
  select coalesce(s.late_grace_minutes, 15), s.attendance_effective_date into v_grace, v_base
    from public.company_settings s where s.id = 1;

  if p_report = 'employees' then
    v_cols := '[{"key":"code","label":"الرقم","kind":"text"},{"key":"name","label":"الاسم","kind":"text"},
                {"key":"position","label":"المنصب","kind":"text"},{"key":"department","label":"القسم","kind":"text"},
                {"key":"manager","label":"المدير","kind":"text"},{"key":"branch","label":"الفرع","kind":"text"},
                {"key":"employment_type","label":"نوع التوظيف","kind":"text"},{"key":"status","label":"الحالة","kind":"text"},
                {"key":"hire_date","label":"المباشرة","kind":"date"},{"key":"probation_end","label":"نهاية التجربة","kind":"date"},
                {"key":"phone","label":"الهاتف","kind":"text"},{"key":"email","label":"البريد","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') into v_rows from (
      select e.employee_code code, e.full_name name, e.job_title as position, e.department, m.full_name manager,
             b.name_ar branch, et.name_ar employment_type, e.employment_status status, e.hire_date, e.probation_end,
             case when v_hr then e.phone end phone, case when v_hr then e.email end email
        from public.employees e
        left join public.employees m on m.id = e.manager_id
        left join public.branches b on b.id = e.branch_id
        left join public.employment_types et on et.code = e.employment_type
       where e.id = any (v_emps)) x;

  elsif p_report = 'headcount' then
    v_cols := '[{"key":"department","label":"القسم","kind":"text"},{"key":"active","label":"على رأس العمل","kind":"num"},
                {"key":"probation","label":"تحت التجربة","kind":"num"},{"key":"hires","label":"تعيينات الفترة","kind":"num"},
                {"key":"exits","label":"مغادرات الفترة","kind":"num"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.active desc), '[]') into v_rows from (
      select coalesce(d.name_ar, 'بلا قسم') department,
             count(*) filter (where e.status = 'active') active,
             count(*) filter (where e.employment_status = 'تحت التجربة') probation,
             count(*) filter (where e.hire_date between f and t) hires,
             count(*) filter (where e.end_date between f and t) exits
        from public.employees e left join public.departments d on d.id = e.department_id
       where e.id = any (v_emps)
       group by d.name_ar) x;

  elsif p_report = 'attendance' then
    v_cols := '[{"key":"code","label":"الرقم","kind":"text"},{"key":"name","label":"الموظف","kind":"text"},
                {"key":"present_days","label":"أيام الحضور","kind":"num"},{"key":"late_days","label":"أيام التأخير","kind":"num"},
                {"key":"open_days","label":"بلا انصراف","kind":"num"},{"key":"hours","label":"ساعات العمل","kind":"num"},
                {"key":"leave_days","label":"أيام الإجازة","kind":"num"},{"key":"exempt_days","label":"أيام معفاة","kind":"num"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') into v_rows from (
      select e.employee_code code, e.full_name name,
             (select count(*) from public.attendance a where a.employee_id = e.id and a.work_date between f and t
                and a.check_in is not null) present_days,
             (select count(*) from public.attendance a
                cross join lateral public.work_schedule_on(e.id, a.work_date) s
               where a.employee_id = e.id and a.work_date between f and t and a.check_in is not null
                 and (a.check_in at time zone 'Asia/Baghdad')::time > s.start_time + make_interval(mins => v_grace)) late_days,
             (select count(*) from public.attendance a where a.employee_id = e.id and a.work_date between f and t
                and a.check_in is not null and a.check_out is null) open_days,
             (select round(coalesce(sum(extract(epoch from a.check_out - a.check_in) / 3600.0), 0)::numeric, 1)
                from public.attendance a where a.employee_id = e.id and a.work_date between f and t
                 and a.check_out is not null) hours,
             (select coalesce(sum(least(l.end_date, t) - greatest(l.start_date, f) + 1), 0) from public.leaves l
               where l.employee_id = e.id and l.status = 'موافق عليها' and l.duration_type = 'يوم كامل'
                 and l.start_date <= t and l.end_date >= f) leave_days,
             (select count(*) from public.attendance_exemptions x where x.employee_id = e.id
                and x.exempt_date between f and t and x.exempt_type = 'يوم كامل') exempt_days
        from public.employees e
       where e.id = any (v_emps) and e.status = 'active') x;

  elsif p_report in ('absence', 'late') then
    if t - f > 93 then raise exception 'تقرير % لمدى 93 يوماً على الأكثر', v_title; end if;
    if p_report = 'absence' then
      v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"department","label":"القسم","kind":"text"},
                  {"key":"day","label":"اليوم","kind":"date"},{"key":"weekday","label":"اليوم من الأسبوع","kind":"text"}]';
      select coalesce(jsonb_agg(to_jsonb(x) order by x.day desc, x.name), '[]') into v_rows from (
        select e.full_name name, e.department, d::date as day,
               (array['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from d)::int + 1] weekday
          from public.employees e
          cross join generate_series(greatest(f, coalesce(v_base, (select min(a.work_date) from public.attendance a))),
                                     least(t, public.baghdad_today() - 1), interval '1 day') d
          cross join lateral public.work_schedule_on(e.id, d::date) s
         where e.id = any (v_emps) and not e.exempt_from_attendance
           and d::date >= coalesce(e.hire_date, d::date) and d::date <= coalesce(e.end_date, d::date)
           and extract(dow from d)::int = any (s.work_days)
           and not exists (select 1 from public.attendance a where a.employee_id = e.id and a.work_date = d::date and a.check_in is not null)
           and not exists (select 1 from public.leaves l where l.employee_id = e.id and l.status = 'موافق عليها'
                            and l.start_date <= d::date and l.end_date >= d::date)
           and not exists (select 1 from public.attendance_exemptions x where x.employee_id = e.id
                            and x.exempt_date = d::date and x.exempt_type = 'يوم كامل')) x;
    else
      v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"day","label":"اليوم","kind":"date"},
                  {"key":"scheduled","label":"بداية الدوام","kind":"text"},{"key":"check_in","label":"البصمة","kind":"text"},
                  {"key":"minutes","label":"دقائق التأخير","kind":"num"}]';
      select coalesce(jsonb_agg(to_jsonb(x) order by x.day desc, x.minutes desc), '[]') into v_rows from (
        select e.full_name name, a.work_date as day, to_char(s.start_time, 'HH24:MI') scheduled,
               to_char(a.check_in at time zone 'Asia/Baghdad', 'HH24:MI') check_in,
               (extract(epoch from ((a.check_in at time zone 'Asia/Baghdad')::time - s.start_time)) / 60)::int minutes
          from public.attendance a
          join public.employees e on e.id = a.employee_id
          cross join lateral public.work_schedule_on(e.id, a.work_date) s
         where e.id = any (v_emps) and a.work_date between f and t and a.check_in is not null
           and (a.check_in at time zone 'Asia/Baghdad')::time > s.start_time + make_interval(mins => v_grace)) x;
    end if;

  elsif p_report = 'leaves' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"type","label":"النوع","kind":"text"},
                {"key":"start_date","label":"من","kind":"date"},{"key":"end_date","label":"إلى","kind":"date"},
                {"key":"days","label":"أيام","kind":"num"},{"key":"hours","label":"ساعات","kind":"num"},
                {"key":"status","label":"الحالة","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc), '[]') into v_rows from (
      select e.full_name name, l.leave_type as type, l.start_date, l.end_date, l.days, l.hours, l.status
        from public.leaves l join public.employees e on e.id = l.employee_id
       where l.employee_id = any (v_emps) and l.start_date <= t and l.end_date >= f) x;

  elsif p_report = 'payroll' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"period","label":"الشهر","kind":"text"},
                {"key":"basic","label":"الأساسي","kind":"money"},{"key":"allowances","label":"بدلات وإضافي ومكافآت","kind":"money"},
                {"key":"commissions","label":"العمولات","kind":"money"},{"key":"deductions","label":"الاستقطاعات","kind":"money"},
                {"key":"net","label":"الصافي","kind":"money"},{"key":"paid","label":"المدفوع","kind":"money"},
                {"key":"state","label":"الحالة","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.period desc, x.name), '[]') into v_rows from (
      select e.full_name name, p.period, p.basic, p.allowances, p.commissions_total commissions,
             p.deductions_total deductions, p.net,
             coalesce((select sum(pp.amount) from public.payroll_payments pp where pp.payroll_id = p.id), 0) paid, p.state
        from public.payrolls p join public.employees e on e.id = p.employee_id
       where p.employee_id = any (v_emps) and p.period between v_fp and v_tp) x;

  elsif p_report = 'salary_cost' then
    v_cols := '[{"key":"department_name","label":"القسم","kind":"text"},{"key":"employees","label":"موظفون","kind":"num"},
                {"key":"basic","label":"الأساسي","kind":"money"},{"key":"allowances","label":"البدلات","kind":"money"},
                {"key":"overtime","label":"الإضافي","kind":"money"},{"key":"bonuses","label":"المكافآت","kind":"money"},
                {"key":"commissions","label":"العمولات","kind":"money"},{"key":"total_cost","label":"الكلفة","kind":"money"}]';
    select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows from public.department_costs(v_fp, v_tp) x;

  elsif p_report = 'commissions' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"count","label":"عدد","kind":"num"},
                {"key":"total","label":"الإجمالي","kind":"money"},{"key":"in_payroll","label":"دخل الكشوف","kind":"money"},
                {"key":"pending","label":"لم يدخل بعد","kind":"money"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]') into v_rows from (
      select e.full_name name, count(*) as count, sum(c.amount) as total,
             coalesce(sum(c.amount) filter (where c.payroll_id is not null), 0) in_payroll,
             coalesce(sum(c.amount) filter (where c.payroll_id is null), 0) pending
        from public.commissions c join public.employees e on e.id = c.employee_id
       where c.employee_id = any (v_emps) and c.comm_date between f and t
       group by e.full_name) x;

  elsif p_report = 'overtime' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"work_date","label":"اليوم","kind":"date"},
                {"key":"hours","label":"ساعات","kind":"num"},{"key":"compensation","label":"التعويض","kind":"text"},
                {"key":"amount","label":"المبلغ","kind":"money"},{"key":"leave_days","label":"أيام تعويضية","kind":"num"},
                {"key":"status","label":"الحالة","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date desc), '[]') into v_rows from (
      select e.full_name name, o.work_date, o.hours, o.compensation, o.amount, o.leave_days, o.status
        from public.overtime_requests o join public.employees e on e.id = o.employee_id
       where o.employee_id = any (v_emps) and o.work_date between f and t) x;

  elsif p_report = 'expenses' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"category","label":"الفئة","kind":"text"},
                {"key":"expense_date","label":"التاريخ","kind":"date"},{"key":"amount","label":"المبلغ","kind":"money"},
                {"key":"project","label":"المشروع","kind":"text"},{"key":"status","label":"الحالة","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.expense_date desc), '[]') into v_rows from (
      select e.full_name name, c.name_ar category, x.expense_date, x.amount, p.name project, x.status
        from public.employee_expenses x
        join public.employees e on e.id = x.employee_id
        left join public.expense_categories c on c.code = x.category_code
        left join public.projects p on p.id = x.project_id
       where x.employee_id = any (v_emps) and x.expense_date between f and t) x;

  elsif p_report = 'turnover' then
    v_cols := '[{"key":"department","label":"القسم","kind":"text"},{"key":"at_start","label":"أول الفترة","kind":"num"},
                {"key":"at_end","label":"آخرها","kind":"num"},{"key":"hires","label":"تعيينات","kind":"num"},
                {"key":"exits","label":"مغادرات","kind":"num"},{"key":"turnover_pct","label":"معدّل الدوران","kind":"pct"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.exits desc), '[]') into v_rows from (
      select y.department, y.at_start, y.at_end, y.hires, y.exits,
             case when (y.at_start + y.at_end) > 0 then round(y.exits * 200.0 / (y.at_start + y.at_end), 1) end turnover_pct
        from (select coalesce(d.name_ar, 'بلا قسم') department,
                     count(*) filter (where coalesce(e.hire_date, f) <= f and (e.end_date is null or e.end_date >= f)) at_start,
                     count(*) filter (where coalesce(e.hire_date, t) <= t and (e.end_date is null or e.end_date >= t)) at_end,
                     count(*) filter (where e.hire_date between f and t) hires,
                     count(*) filter (where e.end_date between f and t) exits
                from public.employees e left join public.departments d on d.id = e.department_id
               where e.id = any (v_emps)
               group by d.name_ar) y) x;

  elsif p_report = 'hiring' then
    v_cols := '[{"key":"opening","label":"الوظيفة","kind":"text"},{"key":"department","label":"القسم","kind":"text"},
                {"key":"status","label":"الحالة","kind":"text"},{"key":"applications","label":"متقدّمون","kind":"num"},
                {"key":"interviews","label":"مقابلات","kind":"num"},{"key":"offers","label":"عروض","kind":"num"},
                {"key":"hires","label":"عُيّنوا","kind":"num"},{"key":"avg_days_to_hire","label":"متوسط أيام التوظيف","kind":"num"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc), '[]') into v_rows from (
      select o.title opening, d.name_ar department, o.status, o.opened_at,
             (select count(*) from public.job_applications a where a.opening_id = o.id) applications,
             (select count(*) from public.job_interviews i join public.job_applications a on a.id = i.application_id
               where a.opening_id = o.id) interviews,
             (select count(*) from public.job_offers jo join public.job_applications a on a.id = jo.application_id
               where a.opening_id = o.id) offers,
             (select count(*) from public.job_applications a where a.opening_id = o.id and a.stage = 'تم التعيين') hires,
             (select round(avg(e.hire_date - o.opened_at), 1) from public.job_applications a
                join public.employees e on e.id = a.employee_id where a.opening_id = o.id) avg_days_to_hire
        from public.job_openings o left join public.departments d on d.id = o.department_id
       where o.opened_at <= t and (o.status <> 'مغلقة' or o.updated_at::date >= f)
         and (v_hr or public.can_read_recruitment() or o.department_id in (select m.id from public.my_managed_department_ids() m))
         and (nullif(p_filters->>'department', '') is null
              or o.department_id in (select dd.id from public.department_descendants((p_filters->>'department')::uuid) dd))) x;

  elsif p_report = 'probation' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"probation_start","label":"البداية","kind":"date"},
                {"key":"probation_end","label":"النهاية","kind":"date"},{"key":"manager_score","label":"تقييم المدير","kind":"num"},
                {"key":"hr_score","label":"تقييم HR","kind":"num"},{"key":"decision","label":"القرار","kind":"text"},
                {"key":"status","label":"الحالة الوظيفية","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.probation_end), '[]') into v_rows from (
      select e.full_name name, e.probation_start, e.probation_end,
             (select r.score from public.probation_reviews r where r.employee_id = e.id and r.reviewer_type = 'المدير'
               order by r.submitted_at desc limit 1) manager_score,
             (select r.score from public.probation_reviews r where r.employee_id = e.id and r.reviewer_type = 'HR'
               order by r.submitted_at desc limit 1) hr_score,
             (select pd.decision from public.probation_decisions pd where pd.employee_id = e.id
               order by pd.decided_at desc limit 1) decision,
             e.employment_status status
        from public.employees e
       where e.id = any (v_emps) and e.probation_end is not null
         and (e.probation_end between f and t or e.employment_status = 'تحت التجربة')) x;

  elsif p_report = 'performance' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"cycle","label":"الدورة","kind":"text"},
                {"key":"period_end","label":"نهاية الفترة","kind":"date"},{"key":"self_score","label":"ذاتي","kind":"num"},
                {"key":"manager_score","label":"المدير","kind":"num"},{"key":"hr_score","label":"HR","kind":"num"},
                {"key":"targets_pct","label":"الأهداف","kind":"pct"},{"key":"final_score","label":"النتيجة","kind":"num"},
                {"key":"recommendation","label":"التوصية","kind":"text"},{"key":"status","label":"الحالة","kind":"text"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.final_score desc nulls last), '[]') into v_rows from (
      select e.full_name name, r.cycle, r.period_end, r.self_score, r.manager_score, r.hr_score,
             r.targets_pct, r.final_score, r.recommendation, r.status
        from public.performance_reviews r join public.employees e on e.id = r.employee_id
       where r.employee_id = any (v_emps) and r.period_end between f and t) x;

  elsif p_report = 'targets' then
    v_cols := '[{"key":"owner","label":"صاحب الهدف","kind":"text"},{"key":"title","label":"المؤشر","kind":"text"},
                {"key":"period_start","label":"الفترة","kind":"date"},{"key":"target_value","label":"المستهدف","kind":"num"},
                {"key":"actual_value","label":"الفعلي","kind":"num"},{"key":"achievement_pct","label":"الإنجاز","kind":"pct"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.period_start desc, x.owner), '[]') into v_rows from (
      select coalesce(e.full_name, d.name_ar, p.name) owner, tg.title, tg.period_start, tg.target_value,
             tg.actual_value, tg.achievement_pct
        from public.employee_targets tg
        left join public.employees e on e.id = tg.employee_id
        left join public.departments d on d.id = tg.department_id
        left join public.projects p on p.id = tg.project_id
       where tg.kpi_code is not null and tg.period_start <= t and tg.period_end >= f
         and (tg.employee_id = any (v_emps)
              or (tg.employee_id is null and (v_hr or tg.department_id in (select m.id from public.my_managed_department_ids() m))))) x;

  elsif p_report = 'documents' then
    v_cols := '[{"key":"name","label":"الموظف","kind":"text"},{"key":"type","label":"النوع","kind":"text"},
                {"key":"title","label":"المستند","kind":"text"},{"key":"expiry_date","label":"الانتهاء","kind":"date"},
                {"key":"days_left","label":"باقٍ (أيام)","kind":"num"}]';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.expiry_date), '[]') into v_rows from (
      select e.full_name name, ty.name_ar as type, coalesce(doc.title, doc.file_name) title, doc.expiry_date,
             (doc.expiry_date - public.baghdad_today()) days_left
        from public.employee_documents doc
        join public.employees e on e.id = doc.employee_id
        join public.employee_document_types ty on ty.code = doc.type_code
       where doc.deleted_at is null and doc.expiry_date is not null and doc.expiry_date <= t
         and doc.employee_id = any (v_emps) and e.status = 'active' and v_hr) x;
  end if;

  return jsonb_build_object('key', p_report, 'title', v_title, 'from', f, 'to', t,
                            'columns', v_cols, 'rows', coalesce(v_rows, '[]'::jsonb));
end $$;


-- ============================================================
-- ٣) لوحة HR — مؤشرات اليوم والفترة بالمرشّحات نفسها
-- ============================================================
create or replace function public.hr_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emps uuid[];
  v_today date := public.baghdad_today();
  v_grace int;
  v_hr boolean := public.can_manage_hr();
  j jsonb;
begin
  if not (v_hr or public.can_manage_finance()
          or exists (select 1 from public.my_team_employee_ids())
          or exists (select 1 from public.my_managed_department_ids())) then
    raise exception 'لوحة HR لـ HR والمدراء';
  end if;
  v_emps := array(select x.id from public.hr_report_employees(coalesce(p_filters, '{}'::jsonb)) x);
  select coalesce(s.late_grace_minutes, 15) into v_grace from public.company_settings s where s.id = 1;

  select jsonb_build_object(
    'total',        count(*),
    'active',       count(*) filter (where e.status = 'active'),
    'inactive',     count(*) filter (where e.status <> 'active'),
    'probation',    count(*) filter (where e.employment_status = 'تحت التجربة'),
    'new_hires',    count(*) filter (where e.hire_date between v_today - 30 and v_today),
    'exits',        count(*) filter (where e.end_date between v_today - 30 and v_today),
    'resignations', count(*) filter (where e.end_date between v_today - 30 and v_today and e.employment_status = 'مستقيل')
  ) into j
  from public.employees e where e.id = any (v_emps);

  j := j || jsonb_build_object(
    'present_today', (select count(*) from public.attendance a where a.employee_id = any (v_emps)
                       and a.work_date = v_today and a.check_in is not null),
    'late_today', (select count(*) from public.attendance a
                    cross join lateral public.work_schedule_on(a.employee_id, a.work_date) s
                   where a.employee_id = any (v_emps) and a.work_date = v_today and a.check_in is not null
                     and (a.check_in at time zone 'Asia/Baghdad')::time > s.start_time + make_interval(mins => v_grace)),
    'absent_today', (select count(*) from public.employees e
                      cross join lateral public.work_schedule_on(e.id, v_today) s
                     where e.id = any (v_emps) and e.status = 'active' and not e.exempt_from_attendance
                       and extract(dow from v_today)::int = any (s.work_days)
                       and (e.hire_date is null or e.hire_date <= v_today)
                       and not exists (select 1 from public.attendance a where a.employee_id = e.id and a.work_date = v_today and a.check_in is not null)
                       and not exists (select 1 from public.leaves l where l.employee_id = e.id and l.status = 'موافق عليها'
                                        and l.start_date <= v_today and l.end_date >= v_today)
                       and not exists (select 1 from public.attendance_exemptions x where x.employee_id = e.id
                                        and x.exempt_date = v_today and x.exempt_type = 'يوم كامل')),
    'on_leave_today', (select count(distinct l.employee_id) from public.leaves l where l.employee_id = any (v_emps)
                        and l.status = 'موافق عليها' and l.start_date <= v_today and l.end_date >= v_today),
    'pending_leaves', (select count(*) from public.leaves l where l.employee_id = any (v_emps) and l.status = 'معلقة'),
    'pending_expenses', (select count(*) from public.employee_expenses x where x.employee_id = any (v_emps) and x.status = 'قيد الموافقة'),
    'unpaid_expenses', (select count(*) from public.employee_expenses x where x.employee_id = any (v_emps) and x.status = 'معتمد'),
    'pending_advances', (select count(*) from public.employee_advances a where a.employee_id = any (v_emps) and a.status = 'معلّقة'),
    'pending_overtime', (select count(*) from public.overtime_requests o where o.employee_id = any (v_emps) and o.status = 'قيد الموافقة'),
    'docs_expiring', (select count(*) from public.employee_documents d where d.employee_id = any (v_emps)
                       and d.deleted_at is null and d.expiry_date <= v_today + 30 and v_hr),
    'probation_ending', (select count(*) from public.employees e where e.id = any (v_emps)
                          and e.employment_status = 'تحت التجربة' and e.probation_end <= v_today + 14),
    'reviews_open', (select count(*) from public.performance_reviews r where r.employee_id = any (v_emps)
                      and r.status not in ('مكتمل', 'ملغى')),
    'open_jobs', (select count(*) from public.job_openings o where o.status = 'مفتوحة'
                   and (v_hr or o.department_id in (select m.id from public.my_managed_department_ids() m))),
    'terminations_open', (select count(*) from public.termination_requests t2 where t2.employee_id = any (v_emps)
                           and t2.status in ('قيد الموافقة', 'معتمد')),
    'payroll_month', (select jsonb_build_object(
                        'period', to_char(v_today, 'YYYY-MM'),
                        'draft', count(*) filter (where p.state = 'مسودة'),
                        'approved', count(*) filter (where p.state = 'معتمد'),
                        'locked', count(*) filter (where p.state = 'مقفل'))
                       from public.payrolls p where p.employee_id = any (v_emps) and p.period = to_char(v_today, 'YYYY-MM')
                         and (public.can_see_payroll() or public.can_manage_finance())),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('name', y.name, 'count', y.n) order by y.n desc), '[]'::jsonb)
                      from (select coalesce(d.name_ar, 'بلا قسم') name, count(*) n
                              from public.employees e left join public.departments d on d.id = e.department_id
                             where e.id = any (v_emps) and e.status = 'active'
                             group by d.name_ar) y)
  );
  return j;
end $$;


revoke all on function public.hr_report_employees(jsonb)            from public, anon;
revoke all on function public.hr_report_catalog()                   from public, anon;
revoke all on function public.hr_report(text, date, date, jsonb)    from public, anon;
revoke all on function public.hr_dashboard(jsonb)                   from public, anon;
grant execute on function public.hr_report_employees(jsonb)         to authenticated;
grant execute on function public.hr_report_catalog()                to authenticated;
grant execute on function public.hr_report(text, date, date, jsonb) to authenticated;
grant execute on function public.hr_dashboard(jsonb)                to authenticated;

update public.app_modules set note = 'المرحلة 8: محرّك تقارير HR (17 تقريراً) ولوحة HR بالمرشّحات (165).' where code = 'hr_reports';
