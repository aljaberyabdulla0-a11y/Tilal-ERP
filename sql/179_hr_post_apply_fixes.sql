-- ============================================================
-- تلال ERP — 179: إصلاحات بعد تطبيق المراحل 6–10 (HR المؤسسي)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 165.
--
--   ١. hr_dashboard: «كشوف الشهر» كانت تُرجع أصفاراً لمن لا يرى الرواتب
--      (المدير مثلاً) بدل أن تغيب — التجميع بلا صفوف يُرجع صفّاً. لا تسريب:
--      الأعداد كانت صفراً، لكن البطاقة ظهرت له. الشرط صار خارج الاستعلام.
--   ٢. tasks.priority: القيمة الافتراضية 'medium' يرفضها القيد tasks_priority_chk
--      (عاجلة/متوسطة/عادية)، فكل إدخال مهمة بلا أولوية صريحة يفشل.
--      ← الافتراضية «عادية».
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
    -- (179) الشرط خارج الاستعلام: التجميع بلا صفوف يُرجع صفّاً بأصفار لا null
    'payroll_month', case when public.can_see_payroll() or public.can_manage_finance() then
                      (select jsonb_build_object(
                        'period', to_char(v_today, 'YYYY-MM'),
                        'draft', count(*) filter (where p.state = 'مسودة'),
                        'approved', count(*) filter (where p.state = 'معتمد'),
                        'locked', count(*) filter (where p.state = 'مقفل'))
                       from public.payrolls p where p.employee_id = any (v_emps) and p.period = to_char(v_today, 'YYYY-MM'))
                     end,
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('name', y.name, 'count', y.n) order by y.n desc), '[]'::jsonb)
                      from (select coalesce(d.name_ar, 'بلا قسم') name, count(*) n
                              from public.employees e left join public.departments d on d.id = e.department_id
                             where e.id = any (v_emps) and e.status = 'active'
                             group by d.name_ar) y)
  );
  return j;
end $$;

alter table public.tasks alter column priority set default 'عادية';
