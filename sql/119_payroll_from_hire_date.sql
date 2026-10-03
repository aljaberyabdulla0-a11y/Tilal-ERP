-- ============================================================
-- تلال ERP — 119: الراتب من تاريخ المباشرة — لا قبله ولا بعد نهاية الخدمة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- build_payroll لم يكن يقرأ hire_date أصلاً. فكان:
--   • يبني كشفاً لشهرٍ قبل المباشرة — خمسة موظفين باشروا 2026-09-02
--     لهم مسوّدات 2026-08 براتبٍ كامل.
--   • يضع الأساسي كاملاً في شهر المباشرة — من باشر يوم 25 يأخذ الشهر كلّه.
--   • وخصومات الدوام (060) تعدّ الغياب من أول الشهر: كل يوم دوامٍ قبل
--     المباشرة «غياب» بلا بصمة. القواعد معطّلة اليوم فلم يظهر، ويظهر
--     يوم تُفعَّل.
--   والأمر نفسه في الطرف الآخر: من انتهت خدمته يوم 27 يأخذ الشهر كاملاً.
--
-- ===== القاعدة =====
--
-- مدة الخدمة في الشهر = من max(أول الشهر، المباشرة)
--                         إلى min(آخر الشهر، نهاية الخدمة).
--   • لا كشف لشهرٍ قبل شهر المباشرة (كما لا كشف بعد نهاية الخدمة).
--   • الأساسي في الشهر الجزئي = الراتب × أيام الخدمة ÷ أيام الشهر
--     التقويمية — من باشر 2 سبتمبر يأخذ 29/30، ومن باشر 23 أغسطس 9/31.
--   • خصومات الدوام وإجازات بلا راتب لا تُحسب خارج مدة الخدمة.
--   • وعاء الاستقطاعات القانونية هو الأساسي بعد التجزئة.
--
-- ===== البيانات القائمة =====
--
--   • مسوّدات لشهرٍ قبل المباشرة تُحذف (بنودها معها، وما رُبط بها من
--     عمولات واستقطاعات وأقساط يعود حرّاً — on delete set null).
--   • مسوّدات شهر المباشرة أو شهر نهاية الخدمة: يُجزَّأ بند الأساسي —
--     إن كان كما بناه النظام (غير يدوي ولا معدَّل). المعدَّل يدوياً لا يُمسّ.
--   • المعتمد والمقفل لا يُمسّ — يُبلَّغ عنه فقط (لا شيء منه اليوم).
--
-- يتطلب: 051، 060، 064، 107. آمن لإعادة التشغيل. (118 لا يتوقّف عليه.)
-- ============================================================


-- ------------------------------------------------------------
-- 1) مدة الخدمة داخل شهر
-- ------------------------------------------------------------
-- بلا security definer عمداً: تُنادى من دوالّ الرواتب (وهي definer)
-- فتعمل بصلاحياتها، ولا تُفتح للمتصفّح فلا تكشف تواريخ الموظفين.
create or replace function public.service_window(p_employee uuid, p_period text)
returns table(svc_from date, svc_to date, month_days int, service_days int)
language sql
stable
set search_path = public
as $fn$
  with m as (
    select to_date(p_period || '-01', 'YYYY-MM-DD') as m_start,
           (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as m_end
  ), w as (
    select greatest(m.m_start, coalesce(e.hire_date, m.m_start)) as f,
           least(m.m_end, coalesce(e.end_date, m.m_end))         as t,
           extract(day from m.m_end)::int                         as n
      from m, public.employees e
     where e.id = p_employee
  )
  select f, t, n, greatest(t - f + 1, 0) from w;
$fn$;

revoke all on function public.service_window(uuid, text) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 2) build_payroll — يرفض ما قبل المباشرة، ويجزّئ الأساسي
-- ------------------------------------------------------------
create or replace function public.build_payroll(p_employee uuid, p_period text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  emp public.employees%rowtype; v_id uuid; ex public.payrolls%rowtype;
  c record; d record; a record; u record; ins record; st record; w record;
  v_basic numeric; v_desc text;
begin
  if not public.can_manage_hr() then raise exception 'توليد كشوف الرواتب للمدير أو الموارد البشرية'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if emp.hire_date is not null and p_period < to_char(emp.hire_date,'YYYY-MM') then
    raise exception 'باشر % في % — لا كشف لشهرٍ قبل المباشرة',
      emp.full_name, emp.hire_date;
  end if;
  if emp.end_date is not null and p_period > to_char(emp.end_date,'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا كشف لشهر لاحق',
      emp.full_name, to_char(emp.end_date,'YYYY-MM');
  end if;

  select * into ex from public.payrolls where employee_id = p_employee and period = p_period;
  if found then
    if ex.state <> 'مسودة' then
      raise exception 'كشف % لهذا الشهر % — أعِد فتحه قبل إعادة الحساب', emp.full_name, ex.state;
    end if;
    v_id := ex.id;
    update public.commissions set payroll_id = null where payroll_id = v_id;
    update public.deductions   set payroll_id = null where payroll_id = v_id;
    update public.advance_installments set payroll_id = null
     where payroll_id = v_id and status = 'مستحق';
    delete from public.payroll_lines where payroll_id = v_id;
  else
    insert into public.payrolls (employee_id, period, state)
    values (p_employee, p_period, 'مسودة') returning id into v_id;
  end if;

  if coalesce(emp.base_salary,0) > 0 then
    select * into w from public.service_window(p_employee, p_period);
    if w.service_days < w.month_days then
      v_basic := round(emp.base_salary * w.service_days / w.month_days);
      v_desc  := 'الراتب الأساسي — ' || w.service_days || ' يوماً من ' || w.month_days ||
                 ' (' || w.svc_from || ' ← ' || w.svc_to || ')';
    else
      v_basic := emp.base_salary;
      v_desc  := 'الراتب الأساسي';
    end if;
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استحقاق','راتب أساسي', v_desc, v_basic,'employees', emp.id);
  end if;

  for c in select * from public.commissions
     where employee_id = p_employee and payroll_id is null
       and payable_at is not null and to_char(payable_at,'YYYY-MM') <= p_period
     order by comm_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استحقاق','عمولة',
            coalesce(c.description,'عمولة ' || c.comm_date::text), c.amount,'commissions', c.id);
    update public.commissions set payroll_id = v_id where id = c.id;
  end loop;

  for a in select * from public.attendance_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع', a.category, a.description, a.amount,'attendance', a.source_id);
  end loop;

  for u in select * from public.unpaid_leave_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع','إجازة بلا راتب', u.description, u.amount,'leaves', u.leave_id);
  end loop;

  for st in select * from public.statutory_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table)
    values (v_id,'استقطاع', st.category, st.description, st.amount,'statutory');
  end loop;

  for ins in select * from public.due_advance_installments(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع','قسط سلفة', ins.description, ins.amount,
            'advance_installments', ins.installment_id);
    update public.advance_installments set payroll_id = v_id where id = ins.installment_id;
  end loop;

  for d in select * from public.deductions
     where employee_id = p_employee and payroll_id is null order by ded_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع',
            case when d.reason='سلفة' then 'سلفة' else 'استقطاع آخر' end,
            coalesce(d.reason,'استقطاع') ||
              case when d.created_by_name is not null then ' — ' || d.created_by_name else '' end,
            d.amount,'deductions', d.id);
    update public.deductions set payroll_id = v_id where id = d.id;
  end loop;

  perform public.refresh_payroll_totals(v_id);
  return v_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 3) خصومات الدوام — من المباشرة إلى نهاية الخدمة
-- ------------------------------------------------------------
create or replace function public.attendance_deductions(p_employee uuid, p_period text)
returns table(work_date date, category text, description text, amount numeric, minutes integer, source_id uuid)
language plpgsql
stable security definer
set search_path = public
as $fn$
declare
  s public.company_settings%rowtype; emp public.employees%rowtype;
  d date; d_start date; d_end date; v_today date;
  v_start time; v_end time; v_days int[]; v_grace int; v_hours numeric;
  v_day_val numeric; v_min_val numeric; v_cap numeric;
  att public.attendance%rowtype; ex public.attendance_exemptions%rowtype;
  v_in_min int; v_out_min int; v_start_m int; v_end_m int;
  v_late int; v_early int; v_late_amt numeric; v_erly_amt numeric; v_sum numeric;
  v_has_ex boolean;
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
  -- ما قبل المباشرة وما بعد نهاية الخدمة ليس غياباً
  if emp.hire_date is not null then d_start := greatest(d_start, emp.hire_date); end if;
  if emp.end_date  is not null then d_end   := least(d_end, emp.end_date);       end if;
  if d_start > d_end then return; end if;

  v_start := coalesce(emp.work_start_time, s.work_start_time);
  v_end   := coalesce(emp.work_end_time,   s.work_end_time);
  v_days  := case when emp.work_days is not null and array_length(emp.work_days,1) > 0
                  then emp.work_days else s.work_days end;
  v_grace := coalesce(s.late_grace_minutes, 15);

  v_start_m := extract(hour from v_start)::int * 60 + extract(minute from v_start)::int;
  v_end_m   := extract(hour from v_end)::int   * 60 + extract(minute from v_end)::int;
  v_hours   := greatest((v_end_m - v_start_m)::numeric / 60, 1);

  d := d_start;
  while d <= d_end loop
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

    -- ⚠️ الاسم المستعار a2 ضروري: work_date اسمٌ لعمود الجدول
    --    ولمعامل إخراج الدالّة معاً، والقاعدة ترفض الالتباس.
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
$fn$;


-- ------------------------------------------------------------
-- 4) إجازة بلا راتب — داخل مدة الخدمة فقط
-- ------------------------------------------------------------
create or replace function public.unpaid_leave_deductions(p_employee uuid, p_period text)
returns table(leave_id uuid, description text, amount numeric)
language plpgsql
stable security definer
set search_path = public
as $fn$
declare
  r record; l public.leaves%rowtype; w record;
  d_start date; d_end date; v_days numeric; v_day_val numeric; d date;
begin
  if not public.can_manage_hr() then
    raise exception 'حساب خصم الإجازات للمدير أو الموارد البشرية';
  end if;

  select * into w from public.service_window(p_employee, p_period);
  if not found or w.service_days = 0 then return; end if;
  d_start := w.svc_from;
  d_end   := w.svc_to;

  for r in
    select lv.id from public.leaves lv
    join public.leave_types t on t.name = lv.leave_type
    where lv.employee_id = p_employee
      and lv.status = 'موافق عليها'
      and t.deducts_salary
      and lv.start_date <= d_end
      and lv.end_date   >= d_start
    order by lv.start_date
  loop
    select * into l from public.leaves where id = r.id;

    v_days := 0; amount := 0;
    d := greatest(l.start_date, d_start);
    while d <= least(l.end_date, d_end) loop
      v_day_val := round(public.salary_at(p_employee, d) / 30.0);
      if l.duration_type = 'ساعات' then
        v_days := public.leave_consumed_days(l);
        amount := round(v_day_val * v_days);
        exit;
      else
        amount := amount + v_day_val;
        v_days := v_days + 1;
      end if;
      d := d + 1;
    end loop;

    if amount > 0 then
      leave_id    := l.id;
      description := 'إجازة بلا راتب ' || round(v_days, 2) || ' يوم — ' ||
                     public.leave_period_text(l);
      return next;
    end if;
  end loop;
end;
$fn$;


-- ------------------------------------------------------------
-- 5) الاستقطاعات القانونية — على الأساسي بعد التجزئة
-- ------------------------------------------------------------
create or replace function public.statutory_deductions(p_employee uuid, p_period text)
returns table(category text, description text, amount numeric)
language plpgsql
stable security definer
set search_path = public
as $fn$
declare s public.company_settings%rowtype; emp public.employees%rowtype;
        v_base numeric; v_allow numeric; v_amt numeric; v_start date; w record;
begin
  if not public.can_see_payroll() then raise exception 'حساب الاستقطاعات القانونية لمن يُحضّر الكشوف أو يعتمدها'; end if;
  select * into s from public.company_settings where id = 1;
  if s is null then return; end if;
  if not s.payroll_tax_enabled and not s.social_security_enabled then return; end if;

  select * into emp from public.employees where id = p_employee;
  if not found then return; end if;

  select * into w from public.service_window(p_employee, p_period);
  if w.service_days = 0 then return; end if;

  v_start := w.svc_from;
  v_base  := public.salary_at(p_employee, v_start);
  if w.service_days < w.month_days then
    v_base := round(v_base * w.service_days / w.month_days);
  end if;

  if s.statutory_base = 'إجمالي' then
    select coalesce(sum(l.amount),0) into v_allow
      from public.payroll_lines l join public.payrolls p on p.id = l.payroll_id
     where p.employee_id = p_employee and p.period = p_period
       and l.kind = 'استحقاق' and l.category = 'بدل';
    v_base := v_base + coalesce(v_allow, 0);
  end if;

  if s.payroll_tax_enabled then
    v_amt := public.statutory_amount('ضريبة', v_base);
    if v_amt > 0 then
      category := 'ضريبة دخل';
      description := 'ضريبة دخل على وعاء ' || public.fmt_qty(v_base) || ' د.ع';
      amount := v_amt; return next;
    end if;
  end if;

  if s.social_security_enabled then
    v_amt := public.statutory_amount('ضمان', v_base);
    if v_amt > 0 then
      category := 'ضمان اجتماعي';
      description := 'ضمان اجتماعي — حصّة الموظف على ' || public.fmt_qty(v_base) || ' د.ع';
      amount := v_amt; return next;
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) البيانات القائمة
-- ------------------------------------------------------------
do $do$
declare r record; w record; v_amt numeric; n_del int := 0; n_fix int := 0;
begin
  -- (أ) كشوف لشهرٍ قبل المباشرة
  for r in
    select p.id, p.period, p.state, e.full_name, e.hire_date
      from public.payrolls p join public.employees e on e.id = p.employee_id
     where e.hire_date is not null and p.period < to_char(e.hire_date, 'YYYY-MM')
  loop
    if r.state = 'مسودة' then
      update public.commissions set payroll_id = null where payroll_id = r.id;
      update public.deductions   set payroll_id = null where payroll_id = r.id;
      update public.advance_installments set payroll_id = null
       where payroll_id = r.id and status = 'مستحق';
      delete from public.notifications where kind = 'راتب' and entity_id = r.id;
      delete from public.payrolls where id = r.id;
      n_del := n_del + 1;
    else
      raise warning 'كشف % لـ % (%) قبل المباشرة % — لم يُمسّ، راجعه يدوياً',
        r.period, r.full_name, r.state, r.hire_date;
    end if;
  end loop;

  -- (ب) مسوّدات الشهر الجزئي: بند الأساسي كما بناه النظام يُجزَّأ
  for r in
    select l.id as line_id, l.amount, p.id as payroll_id, p.period, e.id as emp_id, e.base_salary
      from public.payrolls p
      join public.employees e on e.id = p.employee_id
      join public.payroll_lines l on l.payroll_id = p.id
     where p.state = 'مسودة'
       and l.category = 'راتب أساسي' and l.source_table = 'employees'
       and not l.manual and l.original_amount is null
       and l.amount = e.base_salary and e.base_salary > 0
       and (to_char(e.hire_date, 'YYYY-MM') = p.period or to_char(e.end_date, 'YYYY-MM') = p.period)
  loop
    select * into w from public.service_window(r.emp_id, r.period);
    if w.service_days < w.month_days then
      v_amt := round(r.base_salary * w.service_days / w.month_days);
      update public.payroll_lines
         set amount = v_amt,
             description = 'الراتب الأساسي — ' || w.service_days || ' يوماً من ' || w.month_days ||
                           ' (' || w.svc_from || ' ← ' || w.svc_to || ')'
       where id = r.line_id;
      n_fix := n_fix + 1;
    end if;
  end loop;

  raise notice '119: حُذفت % مسوّدة قبل المباشرة، وجُزّئ أساسي % مسوّدة', n_del, n_fix;
end $do$;
