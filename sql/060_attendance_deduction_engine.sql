-- ============================================================
-- تلال ERP — 060: محرّك خصم الدوام (المرحلة ١)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ **يُشحن مطفأً.** attendance_rules_enabled = false، فلا يمسّ
--    كشفاً واحداً حتى يشغّله المدير بنفسه بعد مراجعة المعاينة.
--
-- ===== المشكلة =====
--
-- النظام يجمع البصمة بإحداثياتها ويحسب الغياب والتأخير والانصراف
-- المبكر بدقّة (sql/021 و sql/024 و sql/033)… ثم لا يفعل بها شيئاً.
-- كل خصم يُكتب باليد. مئتان وعشرون سجل دوام لا يمسّ أحدها ديناراً،
-- وموظف غائب نصف الشهر يخرج راتبه كاملاً.
--
-- ===== المعادلة =====
--
--   قيمة اليوم   = salary_at(الموظف، تاريخ اليوم) ÷ 30
--   قيمة الساعة  = قيمة اليوم ÷ ساعات الدوام (نهاية − بداية)
--   قيمة الدقيقة = قيمة الساعة ÷ 60
--   خصم التأخير  = الدقائق × قيمة الدقيقة × late_hour_factor
--
-- ⚠️ الراتب يُقرأ بـ salary_at لا من base_salary: غيابُ أيلول
--    يُحسب براتب أيلول ولو رُفع الراتب في تشرين (sql/057).
--
-- ⚠️ السماح **عتبة لا خصم**: من تجاوز مدّة السماح يُحتسب تأخيره
--    من الدقيقة الأولى لا من التي بعد السماح. هذا سلوك محرّك
--    الدوام القائم منذ sql/024، وتغييره كان يجعل التقارير القديمة
--    تخالف الجديدة.
--
-- مثال (راتب 750,000 · دوام 09:00–17:00 · سماح 15):
--   اليوم 25,000 · الساعة 3,125 · الدقيقة 52.08
--   بصم 09:10 → داخل السماح → صفر
--   بصم 09:20 → 20 دقيقة → 1,042
--   بصم 11:30 → تجاوز عتبة الغياب → 25,000 بندَ غياب **واحداً**
--
-- ===== ترتيب الفحص لكل يوم — لا يُقلَب =====
--
--   ١) قبل attendance_effective_date        → تجاوز
--   ٢) ليس يوم دوام حسب جدوله               → تجاوز
--   ٣) الموظف معفى من البصمة (الإدارة)       → تجاوز
--   ٤) استثناء «يوم كامل»                    → تجاوز
--   ٥) إجازة معتمدة تغطّي اليوم              → تجاوز
--   ٦) لا بصمة                               → غياب
--   ٧) تأخير تجاوز العتبة                    → غياب **بدل** التأخير
--   ٨) تأخير / انصراف مبكر                   → بالدقيقة، بسقف يومي
--
-- والاستثناء يسبق الإجازة عمداً: إذنُ يومٍ بعينه أخصّ من إجازة
-- ممتدّة، ولو تصادفا فالأخصّ أولى.
--
-- ===== لماذا لا تكتب الدالّة شيئاً =====
--
-- attendance_deductions() تُرجع البنود ولا تُدرجها. فهي نفسها
-- تخدم شاشة المعاينة الصامتة و build_payroll معاً — فما يراه
-- المدير في المعاينة هو بعينه ما سيُكتب، لا حسابان قد يفترقان.
--
-- ===== مفتاح التكرار =====
--
-- source_id لبنود الدوام ليس معرّف سجلّ بصمة، بل مفتاحٌ مشتقّ:
--     md5(الموظف || التاريخ || الفئة)::uuid
-- لأن اليوم الواحد قد يُنتج بندَي تأخير وانصرافٍ مبكر معاً، ولأن
-- يوم الغياب لا سجلّ بصمة له أصلاً. والاشتقاق يجعل الفريد على
-- (payroll_id, source_table, source_id) يمنع التكرار حتماً.
--
-- ===== التراجع =====
--   استعادة build_payroll و approve_payroll من sql/056 و sql/051،
--   ثم drop function attendance_deductions، وحذف أعمدة الإعدادات.
--   أو أبسط: attendance_rules_enabled = false.
--
-- طُبّق على القاعدة في 2026-09-04 عبر هجرة:
--   attendance_deduction_engine
--
-- يتطلب: sql/057 (تاريخ الراتب) و sql/059 (الاستثناءات).
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) المعاملات — بيانات لا كود
-- ------------------------------------------------------------
alter table public.company_settings
  add column if not exists attendance_rules_enabled      boolean not null default false,
  add column if not exists attendance_effective_date     date,
  add column if not exists late_hour_factor              numeric not null default 1.0,
  add column if not exists late_absent_threshold_minutes integer not null default 120,
  add column if not exists absence_deduction_days        numeric not null default 1,
  add column if not exists late_daily_cap_days           numeric not null default 1,
  add column if not exists early_leave_as_late           boolean not null default true;

comment on column public.company_settings.attendance_rules_enabled is
  'مفتاح تشغيل قواعد خصم الدوام كلها. false = المحرّك لا يُنتج بنداً واحداً.';
comment on column public.company_settings.attendance_effective_date is
  'لا يعمل المحرّك على أي يوم يسبقه. بيانات الدوام تبدأ 2026-07-04، وتشغيله على ما قبلها يُظهر الجميع غائبين.';
comment on column public.company_settings.late_hour_factor is
  'مُعامِل شدّة التأخير. 1.0 = قيمة الساعة المشتقّة من الراتب · 0.5 تخفيف · 2.0 تشديد. مُعامِل لا مبلغ ثابت، ليبقى الخصم عادلاً بين الرواتب.';
comment on column public.company_settings.late_absent_threshold_minutes is
  'بعده يُحتسب اليوم غياباً كاملاً ويتوقّف عدّ الدقائق.';
comment on column public.company_settings.absence_deduction_days is
  'كم يوماً يُخصم مقابل يوم الغياب الواحد.';
comment on column public.company_settings.late_daily_cap_days is
  'سقف خصم اليوم الواحد كمضاعف لقيمة اليوم. 1 = لا يتجاوز الخصم قيمة يوم كامل مهما بلغ التأخير.';
comment on column public.company_settings.early_leave_as_late is
  'هل يُخصم الانصراف المبكر بنفس معادلة التأخير.';


-- ------------------------------------------------------------
-- 2) فئة بند جديدة
-- ------------------------------------------------------------
-- «انصراف مبكر» فئة مستقلّة عن «تأخير»: بندٌ اسمه تأخير عن
-- انصرافٍ مبكر يكذب على من يقرأ قسيمته.
alter table public.payroll_lines drop constraint if exists payroll_lines_category_chk;
alter table public.payroll_lines add constraint payroll_lines_category_chk check (
  (kind = 'استحقاق' and category in
    ('راتب أساسي', 'بدل', 'عمولة', 'مكافأة', 'عمل إضافي', 'استحقاق آخر'))
  or
  (kind = 'استقطاع' and category in
    ('غياب', 'تأخير', 'انصراف مبكر', 'إجازة بلا راتب', 'قسط سلفة', 'سلفة', 'استقطاع آخر'))
);


-- ------------------------------------------------------------
-- 3) المحرّك — يحسب ولا يكتب
-- ------------------------------------------------------------
create or replace function public.attendance_deductions(
  p_employee uuid,
  p_period   text
)
returns table (
  work_date   date,
  category    text,
  description text,
  amount      numeric,
  minutes     integer,
  source_id   uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  s          public.company_settings%rowtype;
  emp        public.employees%rowtype;
  d          date;
  d_start    date;
  d_end      date;
  v_today    date;
  v_start    time;
  v_end      time;
  v_days     int[];
  v_grace    int;
  v_hours    numeric;
  v_day_val  numeric;
  v_min_val  numeric;
  v_cap      numeric;
  att        public.attendance%rowtype;
  ex         public.attendance_exemptions%rowtype;
  v_in_min   int;
  v_out_min  int;
  v_start_m  int;
  v_end_m    int;
  v_late     int;
  v_early    int;
  v_late_amt numeric;
  v_erly_amt numeric;
  v_sum      numeric;
begin
  if not public.is_admin() then
    raise exception 'حساب خصومات الدوام للمدير';
  end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not s.attendance_rules_enabled then
    return;                    -- المحرّك مطفأ: لا بند
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found or emp.exempt_from_attendance then
    return;                    -- الإدارة معفاة من البصمة
  end if;

  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  v_today := (now() at time zone 'Asia/Baghdad')::date;
  d_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  d_end   := least((d_start + interval '1 month - 1 day')::date, v_today);

  -- لا يعمل قبل تاريخ السريان
  if s.attendance_effective_date is not null then
    d_start := greatest(d_start, s.attendance_effective_date);
  end if;
  if d_start > d_end then
    return;
  end if;

  -- جدول الموظف، وإلا جدول الشركة
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
    -- (٢) يوم دوام؟  0=الأحد … 6=السبت
    if not (extract(dow from d)::int = any(v_days)) then
      d := d + 1; continue;
    end if;

    -- (٤) استثناء
    select * into ex from public.attendance_exemptions
     where employee_id = p_employee and exempt_date = d;
    if found and ex.exempt_type = 'يوم كامل' then
      d := d + 1; continue;
    end if;

    -- (٥) إجازة معتمدة
    if exists (select 1 from public.leaves l
                where l.employee_id = p_employee
                  and l.status = 'موافق عليها'
                  and l.start_date <= d and l.end_date >= d) then
      d := d + 1; continue;
    end if;

    -- قيمة اليوم براتب ذلك اليوم
    v_day_val := round(public.salary_at(p_employee, d) / 30.0);
    v_min_val := (v_day_val / v_hours) / 60.0;
    v_cap     := round(v_day_val * coalesce(s.late_daily_cap_days, 1));

    if v_day_val <= 0 then
      d := d + 1; continue;
    end if;

    select * into att from public.attendance a2
     where a2.employee_id = p_employee and a2.work_date = d;

    -- (٦) لا بصمة → غياب
    if not found or att.check_in is null then
      work_date   := d;
      category    := 'غياب';
      description := 'غياب يوم ' || to_char(d, 'YYYY-MM-DD');
      amount      := round(v_day_val * coalesce(s.absence_deduction_days, 1));
      minutes     := null;
      source_id   := md5(p_employee::text || d::text || 'غياب')::uuid;
      return next;
      d := d + 1; continue;
    end if;

    -- استثناء «فترة» يعفي من الدقائق لا من الحضور
    if found and ex.id is not null and ex.exempt_type = 'فترة' then
      d := d + 1; continue;
    end if;

    v_in_min := extract(hour from (att.check_in at time zone 'Asia/Baghdad'))::int * 60
              + extract(minute from (att.check_in at time zone 'Asia/Baghdad'))::int;

    v_late := case when v_in_min > v_start_m + v_grace then v_in_min - v_start_m else 0 end;

    -- (٧) تجاوز العتبة → غياب بدل التأخير، بندٌ واحد لا بندان
    if s.late_absent_threshold_minutes is not null
       and v_late >= s.late_absent_threshold_minutes then
      work_date   := d;
      category    := 'غياب';
      description := 'تأخير ' || v_late || ' دقيقة تجاوز عتبة الغياب — ' || to_char(d, 'YYYY-MM-DD');
      amount      := round(v_day_val * coalesce(s.absence_deduction_days, 1));
      minutes     := v_late;
      source_id   := md5(p_employee::text || d::text || 'غياب')::uuid;
      return next;
      d := d + 1; continue;
    end if;

    -- (٨) انصراف مبكر
    v_early := 0;
    if coalesce(s.early_leave_as_late, true) and att.check_out is not null then
      v_out_min := extract(hour from (att.check_out at time zone 'Asia/Baghdad'))::int * 60
                 + extract(minute from (att.check_out at time zone 'Asia/Baghdad'))::int;
      if v_out_min < v_end_m then
        v_early := v_end_m - v_out_min;
      end if;
    end if;

    v_late_amt := round(v_late  * v_min_val * coalesce(s.late_hour_factor, 1));
    v_erly_amt := round(v_early * v_min_val * coalesce(s.late_hour_factor, 1));

    -- السقف اليومي على مجموعهما معاً، لا على كلٍّ وحده
    v_sum := v_late_amt + v_erly_amt;
    if v_sum > v_cap and v_sum > 0 then
      v_late_amt := round(v_late_amt * v_cap / v_sum);
      v_erly_amt := v_cap - v_late_amt;
    end if;

    if v_late_amt > 0 then
      work_date   := d;
      category    := 'تأخير';
      description := 'تأخير ' || v_late || ' دقيقة — ' || to_char(d, 'YYYY-MM-DD');
      amount      := v_late_amt;
      minutes     := v_late;
      source_id   := md5(p_employee::text || d::text || 'تأخير')::uuid;
      return next;
    end if;

    if v_erly_amt > 0 then
      work_date   := d;
      category    := 'انصراف مبكر';
      description := 'انصراف مبكر ' || v_early || ' دقيقة — ' || to_char(d, 'YYYY-MM-DD');
      amount      := v_erly_amt;
      minutes     := v_early;
      source_id   := md5(p_employee::text || d::text || 'انصراف مبكر')::uuid;
      return next;
    end if;

    d := d + 1;
  end loop;
end;
$fn$;

comment on function public.attendance_deductions(uuid, text) is
  'تحسب بنود خصم الدوام لفترة ولا تكتبها. تخدم شاشة المعاينة و build_payroll معاً — فما يُعرض هو ما يُكتب (sql/060).';


-- ------------------------------------------------------------
-- 4) إدخالها في بناء الكشف
-- ------------------------------------------------------------
-- التغيير الوحيد عن sql/056: حلقة بنود الدوام قبل الاستقطاعات.
create or replace function public.build_payroll(p_employee uuid, p_period text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  emp public.employees%rowtype; v_id uuid; ex public.payrolls%rowtype;
  c record; d record; a record;
begin
  if not public.is_admin() then
    raise exception 'توليد كشوف الرواتب للمدير';
  end if;

  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;

  if emp.end_date is not null and p_period > to_char(emp.end_date, 'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا كشف لشهر لاحق',
      emp.full_name, to_char(emp.end_date, 'YYYY-MM');
  end if;

  select * into ex from public.payrolls
   where employee_id = p_employee and period = p_period;

  if found then
    if ex.state <> 'مسودة' then
      raise exception 'كشف % لهذا الشهر % — أعِد فتحه قبل إعادة الحساب',
        emp.full_name, ex.state;
    end if;
    v_id := ex.id;
    update public.commissions set payroll_id = null where payroll_id = v_id;
    update public.deductions   set payroll_id = null where payroll_id = v_id;
    delete from public.payroll_lines where payroll_id = v_id;
  else
    insert into public.payrolls (employee_id, period, state)
    values (p_employee, p_period, 'مسودة')
    returning id into v_id;
  end if;

  if coalesce(emp.base_salary, 0) > 0 then
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'راتب أساسي', 'الراتب الأساسي',
            emp.base_salary, 'employees', emp.id);
  end if;

  for c in
    select * from public.commissions
     where employee_id = p_employee and payroll_id is null
       and payable_at is not null
       and to_char(payable_at, 'YYYY-MM') <= p_period
     order by comm_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'عمولة',
            coalesce(c.description, 'عمولة ' || c.comm_date::text),
            c.amount, 'commissions', c.id);
    update public.commissions set payroll_id = v_id where id = c.id;
  end loop;

  -- ===== خصومات الدوام (sql/060) =====
  -- تخرج فارغة إذا كان المحرّك مطفأً — فالإطفاء يكفي لإيقافها.
  for a in select * from public.attendance_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استقطاع', a.category, a.description, a.amount, 'attendance', a.source_id);
  end loop;

  for d in
    select * from public.deductions
     where employee_id = p_employee and payroll_id is null
     order by ded_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استقطاع',
            case when d.reason = 'سلفة' then 'سلفة' else 'استقطاع آخر' end,
            coalesce(d.reason, 'استقطاع') ||
              case when d.created_by_name is not null
                   then ' — ' || d.created_by_name else '' end,
            d.amount, 'deductions', d.id);
    update public.deductions set payroll_id = v_id where id = d.id;
  end loop;

  perform public.refresh_payroll_totals(v_id);
  return v_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 5) لا اعتماد على سجلّ دوامٍ مفتوح
-- ------------------------------------------------------------
-- بصمة حضور بلا انصراف = ساعات مجهولة. اعتماد كشفٍ فوقها يجمّد
-- رقماً مبنياً على نقص. التغيير الوحيد عن sql/051: هذا الفحص.
create or replace function public.approve_payroll(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r public.payrolls%rowtype; emp public.employees%rowtype; v_n int; v_open date;
begin
  if not public.is_admin() then
    raise exception 'اعتماد كشوف الرواتب للمدير';
  end if;

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

  select a.work_date into v_open
    from public.attendance a
   where a.employee_id = r.employee_id
     and to_char(a.work_date, 'YYYY-MM') = r.period
     and a.check_in is not null and a.check_out is null
   order by a.work_date
   limit 1;

  if v_open is not null then
    raise exception 'سجلّ دوام مفتوح بلا انصراف في % — أغلقه بوقتٍ وسببٍ مكتوب قبل الاعتماد',
      to_char(v_open, 'YYYY-MM-DD');
  end if;

  update public.payrolls
     set state = 'معتمد', approved_at = now(), approved_by = auth.uid()
   where id = p_id;

  perform public.repost_payroll(p_id);

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'كشف راتبك جاهز',
            'كشف ' || r.period || ' — الصافي ' || public.fmt_qty(r.net) || ' د.ع.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) الصلاحيات
-- ------------------------------------------------------------
-- ⚠️ منذ sql/054 لا منحة افتراضية. والمعاينة تناديها من الشاشة.
revoke execute on function public.attendance_deductions(uuid, text) from public, anon;
grant  execute on function public.attendance_deductions(uuid, text) to authenticated;

notify pgrst, 'reload schema';
