-- ============================================================
-- تلال ERP — 107: مطابقة المستودع للقاعدة الحيّة (دوالّ المالية)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- مقارنة نصّ كل دالّة مالية في القاعدة الحيّة (prosrc) بآخر تعريف
-- لها في sql/ — بعد إسقاط التعليقات والمسافات، وبعد محاكاة ترقيع
-- الحرّاس في 068 — أظهرت ٨ دوالّ تختلف فعلاً (2026-10-01).
-- السبب: 062 و064 عدّلتاها على القاعدة ولم تُحفظ نسختهما في
-- الملفات. فمن يعيد بناء القاعدة من sql/ يحصل على كشفٍ يتجاهل
-- أقساط السلف والضريبة والضمان، وإعادة فتحٍ لا تُعيد الأقساط.
--
--   الدالّة                  آخر نسخة في sql/   ما ينقص المستودع
--   ───────────────────────  ─────────────────  ─────────────────────────────
--   repost_payroll           019                تقسيم الدائن على 1360/2310/2320
--                                               وقصّ المحتجز عند المستحقّ
--   approve_payroll          060 (+068)         تحصيل الأقساط وإغلاق السلفة
--   reopen_payroll           051 (+068)         إعادة الأقساط مستحقّة
--   build_payroll            060 (+068)         بنود الضريبة/الضمان والأقساط
--   remove_payroll_line      051 (+068)         فكّ قسط السلفة عند حذف بنده
--   attendance_deductions    060 (+068)         الاسم المستعار a2 (التباس work_date)
--   disburse_advance         062 (+068)         نصّ مختلف — السلوك نفسه
--   post_broker_commission   043                متغيّر v_amount — السلوك نفسه
--
-- ===== ما يفعله =====
--
-- يعيد كتابة الدوالّ الثماني **كما هي على القاعدة الحيّة حرفياً**
-- (pg_get_functiondef). لا تغيير في السلوك: تطبيقه على القاعدة
-- الحيّة لا يغيّر شيئاً، وتطبيقه على قاعدة مبنيّة من sql/ يجعلها
-- مثل الحيّة. والمنح محفوظة (create or replace يُبقيها).
--
-- ===== التحقّق =====
--
--   select p.proname, md5(regexp_replace(lower(regexp_replace(p.prosrc,
--          '--[^\n]*', '', 'g')), '\s+', '', 'g'))
--     from pg_proc p where p.proname in ('repost_payroll', …);
--   قبل التطبيق وبعده: نفس البصمة.
--
-- ===== ملاحظة على repost_payroll (لا تُصحَّح هنا — انظر 112) =====
--
-- تاريخ قيد الاستحقاق = تاريخ إنشاء الكشف (created_at) لا آخر يوم
-- في شهره. فكشف آب المُنشأ في ٢ أيلول يُرحَّل مصروفاً في أيلول.
-- تصحيحه يغيّر تاريخ قيودٍ قائمة، فهو قرارٌ للمالك (docs/accounting-decisions.md).
--
-- يتطلب: 051، 060، 062، 064، 068. آمن لإعادة التشغيل.
-- ============================================================

CREATE OR REPLACE FUNCTION public.repost_payroll(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_exp uuid; v_due uuid; v_adv uuid; v_tax uuid; v_soc uuid;
  v_entry uuid; v_emp text;
  v_gross numeric; v_other numeric; v_advance numeric; v_taxamt numeric; v_socamt numeric;
  v_liab numeric; v_withheld numeric;
begin
  select * into r from public.payrolls where id = p_id;
  if not found then return; end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
    update public.payrolls set journal_entry_id = null where id = p_id;
  end if;

  select coalesce(sum(l.amount),0) into v_advance from public.payroll_lines l
   where l.payroll_id = p_id and l.kind='استقطاع' and l.source_table='advance_installments';
  select coalesce(sum(l.amount),0) into v_taxamt from public.payroll_lines l
   where l.payroll_id = p_id and l.kind='استقطاع' and l.category='ضريبة دخل';
  select coalesce(sum(l.amount),0) into v_socamt from public.payroll_lines l
   where l.payroll_id = p_id and l.kind='استقطاع' and l.category='ضمان اجتماعي';

  v_withheld := v_advance + v_taxamt + v_socamt;
  v_other := coalesce(r.deductions_total,0) - v_withheld;
  v_gross := coalesce(r.basic,0) + coalesce(r.allowances,0) - v_other;

  -- محتجزٌ يفوق المستحقّ يقلب القيد — يُقصّ عند الحدّ
  if v_withheld > v_gross then
    v_advance := greatest(v_gross - v_taxamt - v_socamt, 0);
    v_withheld := v_advance + v_taxamt + v_socamt;
  end if;
  if v_gross <= 0 then return; end if;

  select id into v_exp from public.accounts where code='5100';
  select id into v_due from public.accounts where code='2300';
  select id into v_adv from public.accounts where code='1360';
  select id into v_tax from public.accounts where code='2310';
  select id into v_soc from public.accounts where code='2320';
  if v_exp is null or v_due is null then return; end if;

  select full_name into v_emp from public.employees where id = r.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(r.created_at::date, current_date),
          'استحقاق راتب: ' || coalesce(v_emp,'') || ' - ' || r.period,
          'PAYROLL','إداري عام','payrolls')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_exp, v_gross, 0);

  v_liab := v_gross - v_withheld;
  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_due, 0, v_liab);

  if v_taxamt > 0 and v_tax is not null then
    insert into public.journal_lines (entry_id, account_id, debit, credit)
    values (v_entry, v_tax, 0, v_taxamt);
  end if;
  if v_socamt > 0 and v_soc is not null then
    insert into public.journal_lines (entry_id, account_id, debit, credit)
    values (v_entry, v_soc, 0, v_socamt);
  end if;
  if v_advance > 0 and v_adv is not null then
    insert into public.journal_lines (entry_id, account_id, debit, credit)
    values (v_entry, v_adv, 0, v_advance);
  end if;

  update public.payrolls set journal_entry_id = v_entry where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_payroll(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.payrolls%rowtype; emp public.employees%rowtype; v_n int; v_open date;
begin
  if not public.can_manage_finance() then raise exception 'اعتماد كشوف الرواتب للمدير أو المحاسب'; end if;

  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state <> 'مسودة' then raise exception 'الكشف % بالفعل', r.state; end if;

  select count(*) into v_n from public.payroll_lines where payroll_id = p_id;
  if v_n = 0 then raise exception 'كشف بلا بنود لا يُعتمد'; end if;
  if coalesce(r.net, 0) <= 0 then
    raise exception 'صافي الكشف صفر أو أقل — راجع بنوده قبل الاعتماد';
  end if;

  select * into emp from public.employees where id = r.employee_id;
  if emp.end_date is not null and r.period > to_char(emp.end_date, 'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا يُعتمد كشف شهر لاحق',
      emp.full_name, to_char(emp.end_date, 'YYYY-MM');
  end if;

  select a.work_date into v_open from public.attendance a
   where a.employee_id = r.employee_id and to_char(a.work_date,'YYYY-MM') = r.period
     and a.check_in is not null and a.check_out is null
   order by a.work_date limit 1;
  if v_open is not null then
    raise exception 'سجلّ دوام مفتوح بلا انصراف في % — أغلقه بوقتٍ وسببٍ مكتوب قبل الاعتماد',
      to_char(v_open, 'YYYY-MM-DD');
  end if;

  update public.payrolls
     set state='معتمد', approved_at=now(), approved_by=auth.uid() where id = p_id;

  update public.advance_installments
     set status = 'محصّل', collected_at = (now() at time zone 'Asia/Baghdad')::date
   where payroll_id = p_id and status = 'مستحق';

  update public.employee_advances a set status = 'مسدَّدة'
   where a.status = 'مصروفة' and public.advance_remaining(a.id) <= 0;

  perform public.repost_payroll(p_id);

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'كشف راتبك جاهز',
            'كشف ' || r.period || ' — الصافي ' || public.fmt_qty(r.net) || ' د.ع.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_payroll(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.payrolls%rowtype;
begin
  if not public.can_manage_finance() then raise exception 'إعادة فتح الكشف للمدير أو المحاسب'; end if;
  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state = 'مسودة' then raise exception 'الكشف مسوّدة أصلاً'; end if;
  if r.state = 'مقفل'  then raise exception 'الكشف مقفل — لا يُعاد فتحه'; end if;
  if exists (select 1 from public.payroll_payments where payroll_id = p_id) then
    raise exception 'دُفع من هذا الكشف — احذف دفعاته أولاً';
  end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
    update public.payrolls set journal_entry_id = null where id = p_id;
  end if;

  -- الأقساط تعود مستحقّة، والسلفة المسدَّدة تعود مصروفة
  update public.advance_installments
     set status = 'مستحق', collected_at = null
   where payroll_id = p_id and status = 'محصّل';

  update public.employee_advances a set status = 'مصروفة'
   where a.status = 'مسدَّدة' and public.advance_remaining(a.id) > 0;

  update public.payrolls
     set state='مسودة', approved_at=null, approved_by=null where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.build_payroll(p_employee uuid, p_period text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  emp public.employees%rowtype; v_id uuid; ex public.payrolls%rowtype;
  c record; d record; a record; u record; ins record; st record;
begin
  if not public.can_manage_hr() then raise exception 'توليد كشوف الرواتب للمدير أو الموارد البشرية'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
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
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استحقاق','راتب أساسي','الراتب الأساسي', emp.base_salary,'employees', emp.id);
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
$function$;

CREATE OR REPLACE FUNCTION public.remove_payroll_line(p_line uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.payroll_lines%rowtype;
begin
  if not public.can_manage_hr() then raise exception 'حذف بنود الراتب للمدير أو الموارد البشرية'; end if;
  select * into l from public.payroll_lines where id = p_line;
  if not found then raise exception 'البند غير موجود'; end if;

  if l.source_table = 'commissions' then
    update public.commissions set payroll_id = null where id = l.source_id;
  elsif l.source_table = 'deductions' then
    update public.deductions set payroll_id = null where id = l.source_id;
  elsif l.source_table = 'advance_installments' then
    update public.advance_installments set payroll_id = null where id = l.source_id;
  end if;

  delete from public.payroll_lines where id = p_line;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_deductions(p_employee uuid, p_period text)
 RETURNS TABLE(work_date date, category text, description text, amount numeric, minutes integer, source_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.disburse_advance(p_id uuid, p_method text DEFAULT 'نقد'::text, p_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.employee_advances%rowtype; emp public.employees%rowtype;
  v_cash uuid; v_recv uuid; v_entry uuid; v_when date;
begin
  if not public.can_manage_finance() then raise exception 'صرف السلف للمدير أو المحاسب'; end if;
  select * into a from public.employee_advances where id = p_id;
  if not found then raise exception 'السلفة غير موجودة'; end if;
  if a.status <> 'معتمدة' then raise exception 'السلفة % — لا تُصرف إلا المعتمدة', a.status; end if;

  v_when := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);
  select id into v_recv from public.accounts where code = '1360';
  select id into v_cash from public.accounts
   where code = case when p_method = 'بنك' then '1200' else '1100' end;
  if v_recv is null or v_cash is null then raise exception 'حساب 1360 أو النقد غير موجود'; end if;

  select * into emp from public.employees where id = a.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when, 'صرف سلفة — ' || coalesce(emp.full_name,''), 'ADVANCE', 'إداري عام', 'employee_advances')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_recv, a.amount, 0), (v_entry, v_cash, 0, a.amount);

  update public.employee_advances
     set status='مصروفة', disbursed_at=v_when, method=p_method, disburse_entry_id=v_entry
   where id = p_id;

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'صُرفت سلفتك',
            public.fmt_qty(a.amount) || ' د.ع — تُستردّ بأقساط من راتبك.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_broker_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_project uuid;
  v_rate    numeric(5,2);
  v_price   numeric(16,2);
  v_client  text;
  v_comm    uuid;
  v_amount  numeric(16,2);
begin
  if new.status <> 'بيع مكتمل' then
    return new;
  end if;

  select c.broker_company_id, c.project_id, c.name
    into v_company, v_project, v_client
    from public.clients c where c.id = new.client_id;

  if v_company is null then
    return new;
  end if;

  if exists (select 1 from public.broker_commissions bc where bc.reservation_id = new.id) then
    return new;
  end if;

  select bc.commission_rate into v_rate from public.broker_companies bc where bc.id = v_company;

  select coalesce(new.amount, u.price, 0), coalesce(v_project, u.project_id)
    into v_price, v_project
    from public.units u where u.id = new.unit_id;

  v_amount := round(coalesce(v_price, 0) * coalesce(v_rate, 0) / 100, 2);

  insert into public.broker_commissions
    (company_id, client_id, unit_id, reservation_id, project_id, deal_amount, rate, amount, notes)
  values (v_company, new.client_id, new.unit_id, new.id, v_project,
          coalesce(v_price, 0), coalesce(v_rate, 0), v_amount,
          'استحقاق تلقائي عند إتمام البيع')
  returning id into v_comm;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select bu.user_id,
         'عمولة مستحقة لكم 🎉',
         'إتمام بيع للعميل ' || coalesce(v_client, '') || ' — المستحق ' || public.fmt_qty(v_amount),
         '/dashboard/broker/commissions', 'عمولة', v_comm
    from public.broker_users bu where bu.company_id = v_company;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         'عمولة وساطة مستحقة',
         (select bcm.name from public.broker_companies bcm where bcm.id = v_company)
           || ' — ' || public.fmt_qty(v_amount),
         '/dashboard/brokers/' || v_company, 'عمولة', v_comm
    from public.profiles p where p.role = 'admin';

  return new;
end; $function$;
