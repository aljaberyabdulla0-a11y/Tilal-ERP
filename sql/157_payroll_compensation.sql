-- ============================================================
-- تلال ERP — 157: محرّك الكشف والتعويضات (HR المؤسسي — المرحلة 5)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 119 (build_payroll)، 153–155.
--
-- ============================================================
-- المشكلة الأولى: build_payroll يمسح كل البنود ويعيد بناءها، فيضيع
-- معها كل بند يدوي أو معدَّل بصمت (HR_ARCHITECTURE §14 «ديون تقنية»).
--
-- الحلّ: لكل بند أصل محسوب (origin): نظام · يدوي · معدَّل. وإعادة البناء
-- تمسح بنود «النظام» وحدها، وتعيد توليدها دون أن تمسّ اليدوي والمعدَّل:
-- المصدر الواحد لا يُولَّد مرتين (الفهرس الفريد payroll_id+source)،
-- فالبند المعدَّل يبقى بمبلغه المعدَّل ولا يتكرّر.
--
-- ============================================================
-- الثانية: الكشف لا يعرف إلا الأساسي والعمولة والاستقطاعات. يضيف:
--
--   employee_allowances   بدلات ثابتة بفترة (سكن، نقل…) — تُجزَّأ كالأساسي
--   employee_bonuses      مكافآت — تمرّ بسلسلة «bonus» (HR ← المدير العام)
--   overtime_requests     العمل الإضافي المعتمد بأجر (154) — «عمل إضافي»
--   leave_encashments     صرف رصيد إجازة نقداً — سلسلة «leave_encashment»
--
-- كلها استحقاقات تدخل «allowances» في رأس الكشف، فتدخل قيد الاعتماد
-- مدينةً على مصروف الرواتب كما يدخله البدل اليدوي اليوم — repost_payroll
-- لا يتغيّر منطقه. والمبالغ تُحسب في القاعدة وتُجمَّد عند الاعتماد.
--
-- ⚠️ build_payroll أدناه هو نسخة 119 الحيّة حرفياً، والفروق موسومة (157).
-- ============================================================


-- ============================================================
-- ١) أصل البند
-- ============================================================
alter table public.payroll_lines
  add column if not exists origin text
  generated always as (
    case when manual then 'يدوي'
         when original_amount is not null or edited_at is not null then 'معدَّل'
         else 'نظام' end
  ) stored;

comment on column public.payroll_lines.origin is
  'نظام | يدوي | معدَّل (157). إعادة البناء تمسح «نظام» وحدها. و«مقفل» حالة الكشف لا البند.';


-- ============================================================
-- ٢) البدلات الثابتة
-- ============================================================
create table if not exists public.employee_allowances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  amount       numeric not null check (amount > 0),
  start_date   date not null,
  end_date     date,
  prorate      boolean not null default true,
  notes        text,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint employee_allowances_range check (end_date is null or end_date >= start_date)
);

create index if not exists employee_allowances_emp_idx on public.employee_allowances (employee_id, start_date);

comment on table public.employee_allowances is
  'بدلات ثابتة بفترة سريان (157). تدخل الكشف «بدل» وتُجزَّأ بأيام الخدمة وأيام سريانها في الشهر.';


-- ============================================================
-- ٣) المكافآت
-- ============================================================
create table if not exists public.employee_bonuses (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  bonus_type      text not null default 'أداء' check (bonus_type in ('أداء', 'سنوية', 'مكافأة خاصة', 'أخرى')),
  amount          numeric not null check (amount > 0),
  reason          text not null check (btrim(reason) <> ''),
  payable_period  text not null check (payable_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status          text not null default 'قيد الموافقة' check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى')),
  approval_id     uuid references public.approval_requests(id) on delete set null,
  payroll_id      uuid references public.payrolls(id) on delete set null,
  proposed_by     uuid default auth.uid() references auth.users(id) on delete set null,
  proposed_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists employee_bonuses_emp_idx on public.employee_bonuses (employee_id, payable_period);


-- ============================================================
-- ٤) صرف رصيد الإجازة نقداً
-- ============================================================
alter table public.leave_types add column if not exists encashable boolean not null default false;

alter table public.leave_ledger drop constraint if exists leave_ledger_kind_check;
alter table public.leave_ledger add constraint leave_ledger_kind_check
  check (kind in ('استحقاق شهري', 'استهلاك', 'ترحيل', 'تسوية يدوية', 'تعويض عمل إضافي', 'صرف نقدي'));

create table if not exists public.leave_encashments (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  leave_type_id   uuid not null references public.leave_types(id) on delete restrict,
  days            numeric not null check (days > 0),
  reason          text,
  status          text not null default 'قيد الموافقة' check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى')),
  approval_id     uuid references public.approval_requests(id) on delete set null,
  -- لحظة الاعتماد: قيمة اليوم والمبلغ مجمّدان، وحركة الرصيد مكتوبة
  day_value       numeric,
  amount          numeric,
  ledger_id       uuid references public.leave_ledger(id) on delete set null,
  payroll_id      uuid references public.payrolls(id) on delete set null,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);


-- ============================================================
-- ٥) سلسلتا الموافقة
-- ============================================================
insert into public.approval_workflows (code, name_ar, entity_type, description) values
  ('bonus',            'المكافآت',           'bonus',            'الموارد البشرية ثم المدير العام.'),
  ('leave_encashment', 'صرف رصيد الإجازة',   'leave_encashment', 'الموارد البشرية ثم المدير العام.')
on conflict (code) do nothing;

insert into public.approval_steps (workflow_code, step_no, label, approver_kind) values
  ('bonus', 1, 'الموارد البشرية', 'HR'),
  ('bonus', 2, 'المدير العام', 'المدير العام'),
  ('leave_encashment', 1, 'الموارد البشرية', 'HR'),
  ('leave_encashment', 2, 'المدير العام', 'المدير العام')
on conflict (workflow_code, step_no) do nothing;

-- اقتراح مكافأة: HR أو مدير الموظف
create or replace function public.propose_bonus(
  p_employee uuid, p_amount numeric, p_reason text, p_period text, p_type text default 'أداء')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text;
begin
  if not (public.can_manage_hr() or public.is_manager_of(p_employee)) then
    raise exception 'تقترح المكافأةَ الموارد البشرية أو مدير الموظف';
  end if;
  if p_employee = public.my_employee_id() then raise exception 'لا يقترح أحد مكافأة لنفسه'; end if;
  if exists (select 1 from public.payrolls p where p.employee_id = p_employee and p.period = p_period and p.state <> 'مسودة') then
    raise exception 'كشف % معتمد — اختر شهراً لاحقاً', p_period;
  end if;

  insert into public.employee_bonuses (employee_id, bonus_type, amount, reason, payable_period, proposed_by_name)
  values (p_employee, p_type, p_amount, btrim(p_reason), p_period,
          coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'))
  returning id into v_id;

  select e.full_name into v_name from public.employees e where e.id = p_employee;
  update public.employee_bonuses
     set approval_id = public.start_approval('bonus', 'bonus', v_id, p_employee,
           'مكافأة ' || p_type || ' — ' || v_name || ' (' || p_period || ')', p_amount, null)
   where id = v_id;
  return v_id;
end $$;

-- طلب صرف رصيد إجازة: الموظف لنفسه أو HR نيابةً
create or replace function public.request_leave_encashment(
  p_type uuid, p_days numeric, p_reason text default null, p_employee uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(p_employee, public.my_employee_id());
  t public.leave_types%rowtype;
  v_bal numeric;
  v_id uuid;
  v_name text;
begin
  if v_emp is null then raise exception 'حسابك غير مربوط بملف موظف'; end if;
  if v_emp is distinct from public.my_employee_id() and not public.can_manage_hr() then
    raise exception 'يطلب الصرفَ صاحبُ الرصيد أو الموارد البشرية';
  end if;
  select * into t from public.leave_types where id = p_type;
  if not found or not t.encashable then raise exception 'هذا النوع لا يُصرف نقداً'; end if;
  if p_days is null or p_days <= 0 then raise exception 'عدد الأيام أكبر من صفر'; end if;
  v_bal := public.leave_balance(v_emp, p_type, null)
           - coalesce((select sum(x.days) from public.leave_encashments x
                        where x.employee_id = v_emp and x.leave_type_id = p_type and x.status = 'قيد الموافقة'), 0);
  if p_days > v_bal then
    raise exception 'الرصيد المتاح للصرف % يوماً', round(v_bal, 2);
  end if;

  insert into public.leave_encashments (employee_id, leave_type_id, days, reason)
  values (v_emp, p_type, p_days, nullif(btrim(p_reason), ''))
  returning id into v_id;

  select e.full_name into v_name from public.employees e where e.id = v_emp;
  update public.leave_encashments
     set approval_id = public.start_approval('leave_encashment', 'leave_encashment', v_id, v_emp,
           'صرف ' || p_days || ' يوم ' || t.name || ' — ' || v_name, null, p_days)
   where id = v_id;
  return v_id;
end $$;

create or replace function public.apply_leave_encashment(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.leave_encashments%rowtype;
  v_today date := public.baghdad_today();
  v_bal numeric;
  v_day numeric;
  v_ledger uuid;
begin
  select * into x from public.leave_encashments where id = p_id for update;
  v_bal := public.leave_balance(x.employee_id, x.leave_type_id, null);
  if x.days > v_bal then
    raise exception 'الرصيد % يوماً لم يعد يكفي لصرف %', round(v_bal, 2), x.days;
  end if;
  v_day := round(public.salary_at(x.employee_id, v_today) / 30.0);

  insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note, created_by, created_by_name)
  values (x.employee_id, x.leave_type_id, v_today, -x.days, 'صرف نقدي', 'صرف رصيد نقداً — ' || x.days || ' يوم',
          auth.uid(), coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'))
  returning id into v_ledger;

  update public.leave_encashments
     set day_value = v_day, amount = round(v_day * x.days), ledger_id = v_ledger
   where id = p_id;
end $$;


-- ============================================================
-- ٦) تطبيق النتيجة — كل الأنواع (155 + المكافأة والصرف)
-- ============================================================
create or replace function public.approval_apply(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
begin
  select * into r from public.approval_requests where id = p_request;
  if r.status = 'قيد الموافقة' then return; end if;

  perform set_config('tilal.approval', '1', true);

  if r.entity_type = 'leave' then
    update public.leaves
       set status = case r.status when 'معتمد' then 'موافق عليها' when 'مرفوض' then 'مرفوضة' else 'ملغاة' end
     where id = r.entity_id and status = 'معلقة';

  elsif r.entity_type = 'attendance_request' then
    update public.attendance_requests set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_attendance_request(r.entity_id);
    end if;

  elsif r.entity_type = 'overtime_request' then
    update public.overtime_requests set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_overtime_request(r.entity_id);
    end if;

  elsif r.entity_type = 'bonus' then
    update public.employee_bonuses set status = r.status where id = r.entity_id;

  elsif r.entity_type = 'leave_encashment' then
    update public.leave_encashments set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_leave_encashment(r.entity_id);
    end if;
  end if;

  perform set_config('tilal.approval', '', true);
end $$;


-- ============================================================
-- ٧) build_payroll — نسخة 119 حرفياً + الفروق (157)
-- ============================================================
create or replace function public.build_payroll(p_employee uuid, p_period text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  emp public.employees%rowtype; v_id uuid; ex public.payrolls%rowtype;
  c record; d record; a record; u record; ins record; st record; w record;
  v_basic numeric; v_desc text;
  -- (157)
  al record; bn record; ot record; enc record;
  v_m_start date; v_m_end date; v_from date; v_to date; v_days int; v_amt numeric;
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
    -- (157) المصادر الجديدة تُحرَّر كالقديمة
    update public.overtime_requests set payroll_id = null where payroll_id = v_id;
    update public.employee_bonuses  set payroll_id = null where payroll_id = v_id;
    update public.leave_encashments set payroll_id = null where payroll_id = v_id;
    -- (157) تُمسح بنود النظام وحدها — اليدوي والمعدَّل باقيان
    delete from public.payroll_lines
     where payroll_id = v_id and not manual and original_amount is null and edited_at is null;
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
    values (v_id,'استحقاق','راتب أساسي', v_desc, v_basic,'employees', emp.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
  end if;

  -- (157) البدلات الثابتة: تُجزَّأ بأيام تقاطع سريانها مع نافذة الخدمة
  select * into w from public.service_window(p_employee, p_period);
  v_m_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_m_end   := (v_m_start + interval '1 month - 1 day')::date;
  if w.service_days > 0 then
    for al in select * from public.employee_allowances x
       where x.employee_id = p_employee and x.start_date <= w.svc_to
         and coalesce(x.end_date, 'infinity'::date) >= w.svc_from
       order by x.start_date
    loop
      v_from := greatest(al.start_date, w.svc_from);
      v_to   := least(coalesce(al.end_date, 'infinity'::date), w.svc_to);
      v_days := (v_to - v_from) + 1;
      v_amt  := case when al.prorate then round(al.amount * v_days / w.month_days) else al.amount end;
      if v_amt > 0 then
        insert into public.payroll_lines
          (payroll_id, kind, category, description, amount, source_table, source_id)
        values (v_id, 'استحقاق', 'بدل',
                al.name || case when al.prorate and v_days < w.month_days
                                then ' — ' || v_days || ' يوماً من ' || w.month_days else '' end,
                v_amt, 'employee_allowances', al.id)
        on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
      end if;
    end loop;
  end if;

  for c in select * from public.commissions
     where employee_id = p_employee and payroll_id is null
       and payable_at is not null and to_char(payable_at,'YYYY-MM') <= p_period
     order by comm_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استحقاق','عمولة',
            coalesce(c.description,'عمولة ' || c.comm_date::text), c.amount,'commissions', c.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
    update public.commissions set payroll_id = v_id where id = c.id;
  end loop;

  -- (157) المكافآت المعتمدة المستحقة حتى هذا الشهر
  for bn in select * from public.employee_bonuses x
     where x.employee_id = p_employee and x.status = 'معتمد' and x.payroll_id is null
       and x.payable_period <= p_period
     order by x.payable_period, x.created_at
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'مكافأة', 'مكافأة ' || bn.bonus_type || ' — ' || bn.reason, bn.amount,
            'employee_bonuses', bn.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
    update public.employee_bonuses set payroll_id = v_id where id = bn.id;
  end loop;

  -- (157) العمل الإضافي المعتمد بأجر، بمبلغه المجمَّد
  for ot in select * from public.overtime_requests x
     where x.employee_id = p_employee and x.status = 'معتمد' and x.compensation = 'أجر'
       and x.amount is not null and x.amount > 0 and x.payroll_id is null
       and to_char(x.work_date, 'YYYY-MM') <= p_period
     order by x.work_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'عمل إضافي',
            'عمل إضافي ' || ot.work_date || ' — ' || ot.hours || ' ساعة × ' || ot.rate_factor,
            ot.amount, 'overtime_requests', ot.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
    update public.overtime_requests set payroll_id = v_id where id = ot.id;
  end loop;

  -- (157) صرف رصيد الإجازة المعتمد
  for enc in select x.*, t.name as type_name from public.leave_encashments x
       join public.leave_types t on t.id = x.leave_type_id
     where x.employee_id = p_employee and x.status = 'معتمد' and x.amount is not null
       and x.payroll_id is null
     order by x.created_at
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'استحقاق آخر', 'صرف رصيد ' || enc.type_name || ' — ' || enc.days || ' يوم',
            enc.amount, 'leave_encashments', enc.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
    update public.leave_encashments set payroll_id = v_id where id = enc.id;
  end loop;

  for a in select * from public.attendance_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع', a.category, a.description, a.amount,'attendance', a.source_id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
  end loop;

  for u in select * from public.unpaid_leave_deductions(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع','إجازة بلا راتب', u.description, u.amount,'leaves', u.leave_id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
  end loop;

  for st in select * from public.statutory_deductions(p_employee, p_period) loop
    -- (157) بلا مصدر فريد: لا يُولَّد إن بقي بند معدَّل من الفئة نفسها
    if not exists (select 1 from public.payroll_lines l
                    where l.payroll_id = v_id and l.source_table = 'statutory' and l.category = st.category) then
      insert into public.payroll_lines
        (payroll_id, kind, category, description, amount, source_table)
      values (v_id,'استقطاع', st.category, st.description, st.amount,'statutory');
    end if;
  end loop;

  for ins in select * from public.due_advance_installments(p_employee, p_period) loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id,'استقطاع','قسط سلفة', ins.description, ins.amount,
            'advance_installments', ins.installment_id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
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
            d.amount,'deductions', d.id)
    on conflict (payroll_id, source_table, source_id) where source_id is not null do nothing;
    update public.deductions set payroll_id = v_id where id = d.id;
  end loop;

  perform public.refresh_payroll_totals(v_id);
  return v_id;
end;
$$;


-- ============================================================
-- ٨) حذف البند وتعديله يعرفان المصادر الجديدة
-- ============================================================
create or replace function public.remove_payroll_line(p_line uuid)
returns void
language plpgsql security definer set search_path = public as $$
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
  -- (157)
  elsif l.source_table = 'overtime_requests' then
    update public.overtime_requests set payroll_id = null where id = l.source_id;
  elsif l.source_table = 'employee_bonuses' then
    update public.employee_bonuses set payroll_id = null where id = l.source_id;
  elsif l.source_table = 'leave_encashments' then
    update public.leave_encashments set payroll_id = null where id = l.source_id;
  end if;

  delete from public.payroll_lines where id = p_line;
end;
$$;

create or replace function public.update_payroll_line(p_line uuid, p_amount numeric, p_description text)
returns void
language plpgsql security definer set search_path = public as $$
declare l public.payroll_lines%rowtype; v_state text; v_who text;
begin
  if not public.can_manage_hr() then
    raise exception 'تعديل بنود الراتب للمدير أو الموارد البشرية';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر';
  end if;

  select * into l from public.payroll_lines where id = p_line;
  if not found then raise exception 'البند غير موجود'; end if;

  select state into v_state from public.payrolls where id = l.payroll_id;
  if v_state <> 'مسودة' then
    raise exception 'الكشف % — أعِد فتحه أولاً ثم عدّل', v_state;
  end if;

  if p_amount <> l.amount and l.source_table = 'commissions' then
    raise exception 'مبلغ العمولة مُرحَّل في الدفاتر عند استحقاقها — عدّل العمولة نفسها أو احذف البند';
  end if;
  if p_amount <> l.amount and l.source_table = 'advance_installments' then
    raise exception 'مبلغ القسط من جدول السلفة — عدّله من ملفّ السلفة أو احذف البند';
  end if;
  -- (157) مبالغ اعتُمدت في سلسلة موافقة لا تُغيَّر من الكشف
  if p_amount <> l.amount and l.source_table in ('overtime_requests', 'employee_bonuses', 'leave_encashments') then
    raise exception 'المبلغ اعتُمد في سلسلة موافقته — لا يُغيَّر من الكشف؛ احذف البند إن لزم';
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  update public.payroll_lines
     set amount          = p_amount,
         description     = nullif(btrim(coalesce(p_description, '')), ''),
         original_amount = case
                             when p_amount <> l.amount then coalesce(l.original_amount, l.amount)
                             else l.original_amount
                           end,
         edited_at       = now(),
         edited_by       = auth.uid(),
         edited_by_name  = v_who
   where id = p_line;
end;
$$;


-- ============================================================
-- ٩) المحرّك: من رفع الطلب لا يوافق عليه — لا صاحب الملف وحده
--
-- في 153 استُبعد صاحب الملف (subject) من المُوافِقين. لكن المكافأة يقترحها
-- HR ويوافق عليها HR، وطلب الدوام قد يرفعه HR نيابةً عن موظف. فيُستبعد
-- رافع الطلب أيضاً: خطوةٌ لا مُوافِق فيها غيره تُصعَّد. نسخ 153 حرفياً
-- والفرق موسوم (157).
-- ============================================================
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
    if (s.min_amount is not null and coalesce(r.amount, 0) < s.min_amount)
       or (s.min_days is not null and coalesce(r.days, 0) < s.min_days) then
      continue;
    end if;
    if exists (select 1 from public.approval_step_users(s.id, r.subject_employee) u
                where u.user_id is distinct from r.requested_by) then   -- (157)
      return s.step_no;
    end if;
    insert into public.approval_actions (request_id, step_no, step_label, decision, actor_name, note)
    values (p_request, s.step_no, s.label, 'تصعيد', 'النظام', 'لا مُوافِق لهذه الخطوة — صُعّد الطلب');
  end loop;
  return null;
end $$;

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
    return query select u.user_id from public.approval_step_users(v_step, r.subject_employee) u
                  where u.user_id is distinct from r.requested_by;   -- (157)
  else
    return query select p.id from public.profiles p
      where p.role = 'admin' and p.id is distinct from v_subject_user
        and p.id is distinct from r.requested_by;   -- (157)
  end if;
end $$;

create or replace function public.can_act_on_approval(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.approval_current_approvers(p_request) a where a.user_id = auth.uid())
      or (public.is_admin() and exists (
            select 1 from public.approval_requests r
              left join public.employees e on e.id = r.subject_employee
             where r.id = p_request and r.status = 'قيد الموافقة'
               and e.user_id is distinct from auth.uid()
               and r.requested_by is distinct from auth.uid()));   -- (157)
$$;

-- approval_decide: رسالةٌ صريحة لرافع الطلب قبل فحص الدور
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
  if exists (select 1 from public.employees e where e.id = r.subject_employee and e.user_id = auth.uid())
     or r.requested_by = auth.uid() then   -- (157)
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
     and r.entity_type <> 'leave';

  return r.status;
end $$;

revoke all on function public.approval_advance(uuid, int) from public, anon, authenticated;


-- ============================================================
-- ١٠) RLS
-- ============================================================
alter table public.employee_allowances enable row level security;
alter table public.employee_bonuses    enable row level security;
alter table public.leave_encashments   enable row level security;

drop policy if exists "read allowances" on public.employee_allowances;
create policy "read allowances" on public.employee_allowances for select to authenticated
  using ((select public.can_see_payroll()) or employee_id = (select public.my_employee_id()));
drop policy if exists "hr manages allowances" on public.employee_allowances;
create policy "hr manages allowances" on public.employee_allowances for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

-- المكافأة رقمٌ مالي: HR والمالية وصاحبها، ومن قرّر أو يقرّر فيها
drop policy if exists "read bonuses" on public.employee_bonuses;
create policy "read bonuses" on public.employee_bonuses for select to authenticated
  using ((select public.can_see_payroll()) or employee_id = (select public.my_employee_id())
         or proposed_by = (select auth.uid())
         or (approval_id is not null and public.can_see_approval(approval_id)));

drop policy if exists "read encashments" on public.leave_encashments;
create policy "read encashments" on public.leave_encashments for select to authenticated
  using ((select public.can_see_payroll()) or employee_id = (select public.my_employee_id())
         or (approval_id is not null and public.can_see_approval(approval_id)));

revoke all on public.employee_allowances, public.employee_bonuses, public.leave_encashments from anon;

drop trigger if exists trg_audit_employee_allowances on public.employee_allowances;
create trigger trg_audit_employee_allowances after insert or update or delete on public.employee_allowances
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_employee_bonuses on public.employee_bonuses;
create trigger trg_audit_employee_bonuses after insert or update or delete on public.employee_bonuses
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_leave_encashments on public.leave_encashments;
create trigger trg_audit_leave_encashments after insert or update or delete on public.leave_encashments
  for each row execute function public.audit_row();

revoke all on function public.apply_leave_encashment(uuid) from public, anon, authenticated;
revoke all on function public.approval_apply(uuid)         from public, anon, authenticated;
revoke all on function public.propose_bonus(uuid, numeric, text, text, text)            from public, anon;
revoke all on function public.request_leave_encashment(uuid, numeric, text, uuid)       from public, anon;
grant execute on function public.propose_bonus(uuid, numeric, text, text, text)         to authenticated;
grant execute on function public.request_leave_encashment(uuid, numeric, text, uuid)    to authenticated;

update public.app_modules set note = 'المرحلة 5: البدلات والمكافآت والعمل الإضافي وصرف الرصيد في الكشف؛ حماية البنود اليدوية (157).'
 where code = 'payroll';
