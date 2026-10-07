-- ============================================================
-- تلال ERP — 163: إنهاء الخدمة وإخلاء الطرف والتسوية النهائية (المرحلة 7)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 045/123 (handover_employee)، 148، 153، 157، 162.
--
-- ============================================================
-- السير
--
--   طلب إنهاء (استقالة من الموظف، أو إنهاء من HR/المدير) ← سلسلة «termination»:
--   المدير المباشر ← HR ← المدير العام
--   الاعتماد ⇒ قائمة إخلاء طرف لكل جهة (HR، المالية، التقنية، الإدارة، المشاريع،
--             المبيعات، التسويق)، وما تتحقّق منه القاعدة يُنجز بنفسه:
--               العهد أُعيدت · السلف مسدَّدة أو مُعجَّلة للكشف الأخير · لا مصروف معلّق
--   التسوية (معاينة): راتب الشهر الأخير، العمولات المعلّقة، رصيد الإجازة القابل
--             للصرف، مكافأة نهاية الخدمة (بقاعدة يضعها المالك)، السلف المتبقية
--   الإكمال (المدير) — يُرفض قبل اكتمال الإخلاء:
--     تعجيل أقساط السلف ← صرف الرصيد ← handover_employee (التسليم، الإنهاء،
--     إغلاق الحساب) ← بناء الكشف الأخير ← بند مكافأة نهاية الخدمة ← تصنيف الحالة
--
-- ⚠️ مكافأة نهاية الخدمة: company_settings.eos_days_per_year فارغٌ حتى يحدّده
--    المالك — فلا مكافأة تُحسب من رقمٍ مفترض. ورصيد الإجازة يُصرف للأنواع
--    التي جعلها «قابلة للصرف» في إعدادات الإجازات.
-- ============================================================


-- ============================================================
-- ١) الإعدادات والطلب
-- ============================================================
alter table public.company_settings
  add column if not exists eos_days_per_year numeric check (eos_days_per_year is null or eos_days_per_year >= 0),
  add column if not exists eos_min_years     numeric check (eos_min_years is null or eos_min_years >= 0);

comment on column public.company_settings.eos_days_per_year is
  'أيام راتب لكل سنة خدمة في مكافأة نهاية الخدمة (163). فارغ = لم يحدّده المالك، فلا مكافأة.';

create table if not exists public.termination_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  term_type         text not null check (term_type in ('استقالة', 'إنهاء خدمة', 'انتهاء عقد', 'إنهاء خلال التجربة')),
  last_working_day  date not null,
  reason            text not null check (btrim(reason) <> ''),
  successor_id      uuid references public.employees(id) on delete set null,
  status            text not null default 'قيد الموافقة'
                      check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى', 'مكتمل')),
  approval_id       uuid references public.approval_requests(id) on delete set null,
  settlement        jsonb,
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id) on delete set null,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- طلب حيّ واحد لكل موظف
create unique index if not exists termination_requests_one_live
  on public.termination_requests (employee_id) where status in ('قيد الموافقة', 'معتمد');

insert into public.approval_workflows (code, name_ar, entity_type, description) values
  ('termination', 'إنهاء الخدمة', 'termination', 'المدير المباشر ثم HR ثم المدير العام.')
on conflict (code) do nothing;
insert into public.approval_steps (workflow_code, step_no, label, approver_kind) values
  ('termination', 1, 'المدير المباشر', 'المدير المباشر'),
  ('termination', 2, 'الموارد البشرية', 'HR'),
  ('termination', 3, 'المدير العام', 'المدير العام')
on conflict (workflow_code, step_no) do nothing;


-- ============================================================
-- ٢) إخلاء الطرف
-- ============================================================
create table if not exists public.clearance_templates (
  code        text primary key check (code ~ '^[a-z_]{2,40}$'),
  department  text not null check (department in ('HR', 'المالية', 'التقنية', 'الإدارة', 'المشاريع', 'المبيعات', 'التسويق')),
  title       text not null,
  auto_rule   text check (auto_rule in ('assets', 'advances', 'expenses')),
  sort_order  int not null default 0,
  active      boolean not null default true
);

insert into public.clearance_templates (code, department, title, auto_rule, sort_order) values
  ('return_assets',    'الإدارة',  'إعادة العهد (حاسوب، هاتف، شريحة، مفاتيح…)', 'assets',   1),
  ('clear_advances',   'المالية',  'تسوية السلف والقروض',                       'advances', 2),
  ('clear_expenses',   'المالية',  'لا مصروفات معلّقة',                          'expenses', 3),
  ('final_payroll',    'المالية',  'مراجعة الكشف الأخير',                        null,       4),
  ('return_documents', 'HR',       'استلام المستندات والبطاقات',                 null,       5),
  ('exit_interview',   'HR',       'مقابلة الخروج',                              null,       6),
  ('revoke_access',    'التقنية',  'إيقاف البريد والأنظمة الخارجية',             null,       7),
  ('handover_clients', 'المبيعات', 'تسليم العملاء والفرص للخَلَف',               null,       8),
  ('handover_projects','المشاريع', 'تسليم مهام المشاريع',                        null,       9),
  ('handover_marketing','التسويق', 'تسليم ملفات وحسابات التسويق',                null,       10)
on conflict (code) do nothing;

create table if not exists public.clearance_items (
  id                 uuid primary key default gen_random_uuid(),
  termination_id     uuid not null references public.termination_requests(id) on delete cascade,
  template_code      text references public.clearance_templates(code) on update cascade on delete set null,
  department         text not null,
  title              text not null,
  auto_rule          text,
  status             text not null default 'معلّقة' check (status in ('معلّقة', 'منجزة', 'غير لازمة')),
  completed_at       timestamptz,
  completed_by_name  text,
  note               text,
  unique (termination_id, template_code)
);

create or replace function public.refresh_clearance(p_termination uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  t public.termination_requests%rowtype;
  v_final text;
  n int;
begin
  select * into t from public.termination_requests where id = p_termination;
  v_final := to_char(t.last_working_day, 'YYYY-MM');

  update public.clearance_items c
     set status = 'منجزة', completed_at = now(), completed_by_name = 'النظام (تحقّق تلقائي)'
   where c.termination_id = p_termination and c.status = 'معلّقة' and c.auto_rule is not null
     and case c.auto_rule
           when 'assets' then not exists (
             select 1 from public.employee_assets a where a.employee_id = t.employee_id and a.status = 'مسلَّمة')
           -- لا قسط مستحقّ بعد الشهر الأخير (سُدّد أو عُجِّل للكشف الأخير)
           when 'advances' then not exists (
             select 1 from public.advance_installments i
               join public.employee_advances a on a.id = i.advance_id
              where a.employee_id = t.employee_id and a.status = 'مصروفة'
                and i.status = 'مستحق' and i.due_period > v_final)
           when 'expenses' then not exists (
             select 1 from public.employee_expenses x where x.employee_id = t.employee_id
               and x.status in ('قيد الموافقة', 'معتمد'))
           else false
         end;
  get diagnostics n = row_count;
  return n;
end $$;

-- الاعتماد ⇒ القائمة
create or replace function public.apply_termination(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.termination_requests%rowtype; v_name text;
begin
  select * into t from public.termination_requests where id = p_id;
  insert into public.clearance_items (termination_id, template_code, department, title, auto_rule)
  select p_id, c.code, c.department, c.title, c.auto_rule
    from public.clearance_templates c where c.active
  on conflict (termination_id, template_code) do nothing;
  perform public.refresh_clearance(p_id);

  select full_name into v_name from public.employees where id = t.employee_id;
  perform public.hr_notify_levels(array['admin', 'hr', 'accountant'], 'إخلاء طرف: ' || v_name,
    t.term_type || ' — آخر يوم ' || t.last_working_day || '. أنجز بنود جهتك.', '/dashboard/hr/offboarding',
    'إنهاء خدمة', p_id, 'termination');
end $$;

-- إنجاز بند يدوي: HR أي بند، والمالية بنودها
create or replace function public.complete_clearance_item(p_item uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.clearance_items%rowtype; t public.termination_requests%rowtype;
begin
  select * into c from public.clearance_items where id = p_item for update;
  if not found then raise exception 'البند غير موجود'; end if;
  select * into t from public.termination_requests where id = c.termination_id;
  if t.status <> 'معتمد' then raise exception 'الطلب «%» — لا تعديل على إخلائه', t.status; end if;
  if not (public.can_manage_hr() or (c.department = 'المالية' and public.can_manage_finance())) then
    raise exception 'ينجز البندَ الموارد البشرية أو جهته';
  end if;
  if t.employee_id = public.my_employee_id() then raise exception 'لا يُخلي أحد طرفه بنفسه'; end if;
  if p_status not in ('منجزة', 'غير لازمة', 'معلّقة') then raise exception 'الحالة: منجزة أو غير لازمة أو معلّقة'; end if;
  if p_status = 'غير لازمة' and coalesce(btrim(p_note), '') = '' then raise exception 'سبب «غير لازمة» إلزامي'; end if;
  update public.clearance_items
     set status = p_status,
         completed_at = case when p_status = 'معلّقة' then null else now() end,
         completed_by_name = case when p_status = 'معلّقة' then null
                                  else coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام') end,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = p_item;
end $$;


-- ============================================================
-- ٣) الطلب
-- ============================================================
create or replace function public.submit_termination(
  p_employee uuid, p_type text, p_last_day date, p_reason text, p_successor uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  v_self boolean := p_employee = public.my_employee_id();
  v_id uuid;
begin
  select * into e from public.employees where id = p_employee;
  if not found or e.status <> 'active' then raise exception 'الموظف غير موجود أو ليس على رأس عمله'; end if;
  if v_self then
    if p_type <> 'استقالة' then raise exception 'يقدّم الموظف استقالته فقط'; end if;
  elsif not (public.can_manage_hr() or public.is_manager_of(p_employee)) then
    raise exception 'يطلب الإنهاءَ الموارد البشرية أو مدير الموظف';
  end if;
  if p_last_day < coalesce(e.hire_date, p_last_day) then raise exception 'آخر يوم قبل المباشرة'; end if;
  if p_successor = p_employee then raise exception 'الخَلَف غير الموظف نفسه'; end if;

  insert into public.termination_requests (employee_id, term_type, last_working_day, reason, successor_id)
  values (p_employee, p_type, p_last_day, btrim(p_reason), p_successor)
  returning id into v_id;

  update public.termination_requests
     set approval_id = public.start_approval('termination', 'termination', v_id, p_employee,
           p_type || ' — ' || e.full_name || ' (آخر يوم ' || p_last_day || ')', null, null)
   where id = v_id;
  return v_id;
exception when unique_violation then
  raise exception 'للموظف طلب إنهاء حيّ أصلاً';
end $$;


-- الخَلَف الذي تُسلَّم إليه الملفات — يُحدَّد أو يُغيَّر قبل الإكمال
create or replace function public.set_termination_successor(p_id uuid, p_successor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.termination_requests%rowtype;
begin
  if not public.can_manage_hr() then raise exception 'تحديد الخَلَف للموارد البشرية'; end if;
  select * into t from public.termination_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if t.status not in ('قيد الموافقة', 'معتمد') then raise exception 'الطلب «%» مغلق', t.status; end if;
  if p_successor = t.employee_id then raise exception 'الخَلَف غير الموظف نفسه'; end if;
  if (select e.status from public.employees e where e.id = p_successor) <> 'active' then
    raise exception 'الخَلَف يجب أن يكون على رأس عمله';
  end if;
  update public.termination_requests set successor_id = p_successor where id = p_id;
end $$;

revoke all on function public.set_termination_successor(uuid, uuid) from public, anon;
grant execute on function public.set_termination_successor(uuid, uuid) to authenticated;


-- ============================================================
-- ٤) التسوية النهائية — معاينة محسوبة في القاعدة
-- ============================================================
create or replace function public.final_settlement_preview(p_termination uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t public.termination_requests%rowtype;
  e public.employees%rowtype;
  s public.company_settings%rowtype;
  v_final text; v_day numeric; v_years numeric;
  v_month_start date; v_month_days int; v_days int; v_basic numeric;
  v_comm numeric; v_leave jsonb; v_leave_total numeric; v_gratuity numeric; v_adv numeric;
  v_unpaid numeric; v_exp numeric; v_note text;
begin
  if not (public.can_see_payroll() or public.can_manage_finance()) then
    raise exception 'التسوية لـ HR والمالية';
  end if;
  select * into t from public.termination_requests where id = p_termination;
  if not found then raise exception 'الطلب غير موجود'; end if;
  select * into e from public.employees where id = t.employee_id;
  select * into s from public.company_settings where id = 1;

  v_final := to_char(t.last_working_day, 'YYYY-MM');
  v_day := round(public.salary_at(e.id, t.last_working_day) / 30.0);
  v_years := round(((t.last_working_day - coalesce(e.hire_date, t.last_working_day)) + 1) / 365.25, 2);

  -- راتب الشهر الأخير بأيامه (نافذة الخدمة حتى آخر يوم)
  v_month_start := greatest(date_trunc('month', t.last_working_day)::date, coalesce(e.hire_date, date '1900-01-01'));
  v_month_days := extract(day from (date_trunc('month', t.last_working_day) + interval '1 month - 1 day'))::int;
  v_days := (t.last_working_day - v_month_start) + 1;
  v_basic := round(public.salary_at(e.id, t.last_working_day) * v_days / v_month_days);

  select coalesce(sum(c.amount), 0) into v_comm from public.commissions c
   where c.employee_id = e.id and c.payroll_id is null and c.payable_at is not null;

  select coalesce(jsonb_agg(jsonb_build_object('type', x.name, 'days', x.bal, 'amount', round(x.bal * v_day))), '[]'::jsonb),
         coalesce(sum(round(x.bal * v_day)), 0)
    into v_leave, v_leave_total
    from (select lt.name, public.leave_balance(e.id, lt.id, null) as bal
            from public.leave_types lt where lt.active and lt.encashable) x
   where x.bal > 0;

  if s.eos_days_per_year is null then
    v_gratuity := 0;
    v_note := 'مكافأة نهاية الخدمة: لم يحدّد المالك قاعدتها بعد';
  elsif v_years < coalesce(s.eos_min_years, 0) then
    v_gratuity := 0;
    v_note := 'الخدمة أقل من الحدّ الأدنى لمكافأة نهاية الخدمة';
  else
    v_gratuity := round(v_day * s.eos_days_per_year * v_years);
  end if;

  select coalesce(sum(public.advance_remaining(a.id)), 0) into v_adv
    from public.employee_advances a where a.employee_id = e.id and a.status = 'مصروفة';

  select coalesce(sum(p.net - coalesce((select sum(x.amount) from public.payroll_payments x where x.payroll_id = p.id), 0)), 0)
    into v_unpaid
    from public.payrolls p where p.employee_id = e.id and p.state <> 'مسودة';

  select coalesce(sum(x.amount), 0) into v_exp from public.employee_expenses x
   where x.employee_id = e.id and x.status = 'معتمد';

  return jsonb_build_object(
    'employee', e.full_name, 'last_working_day', t.last_working_day, 'service_years', v_years,
    'day_value', v_day, 'final_period', v_final,
    'final_basic', v_basic, 'final_basic_days', v_days,
    'pending_commissions', v_comm,
    'leave_encashment', v_leave, 'leave_total', v_leave_total,
    'gratuity', v_gratuity, 'gratuity_note', v_note,
    'advances_remaining', v_adv,
    'unpaid_payrolls', greatest(v_unpaid, 0),
    'unpaid_expenses', v_exp,
    'estimated_net', v_basic + v_comm + v_leave_total + v_gratuity - v_adv
  );
end $$;


-- ============================================================
-- ٥) الإكمال — للمدير، وبعد اكتمال الإخلاء
-- ============================================================
create or replace function public.complete_termination(p_termination uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.termination_requests%rowtype;
  e public.employees%rowtype;
  v_final text;
  v_pending int;
  v_settle jsonb;
  v_pr uuid;
  v_state text;
  lt record;
  v_bal numeric;
  v_enc uuid;
begin
  if not public.is_admin() then raise exception 'إكمال إنهاء الخدمة للمدير (يتضمّن التسليم وإغلاق الحساب)'; end if;
  select * into t from public.termination_requests where id = p_termination for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if t.status <> 'معتمد' then raise exception 'الطلب «%» — يُكمَل المعتمد فقط', t.status; end if;
  select * into e from public.employees where id = t.employee_id;
  if e.user_id = auth.uid() then raise exception 'لا يُكمل أحد إنهاء خدمته'; end if;
  if t.successor_id is null then raise exception 'حدّد الخَلَف الذي تُسلَّم إليه الملفات أولاً'; end if;
  v_final := to_char(t.last_working_day, 'YYYY-MM');

  -- تعجيل الأقساط قبل فحص الإخلاء: القسط المعجَّل للكشف الأخير يُعدّ تسوية
  update public.advance_installments i set due_period = v_final
    from public.employee_advances a
   where a.id = i.advance_id and a.employee_id = e.id and a.status = 'مصروفة'
     and i.status = 'مستحق' and i.due_period > v_final;
  perform public.refresh_clearance(p_termination);

  select count(*) into v_pending from public.clearance_items where termination_id = p_termination and status = 'معلّقة';
  if v_pending > 0 then
    raise exception 'إخلاء الطرف ناقص: % بند معلّق — لا يُغلق الملف قبل اكتماله', v_pending;
  end if;

  v_settle := public.final_settlement_preview(p_termination);

  -- صرف رصيد الإجازة القابل للصرف — يدخل الكشف الأخير (157)
  for lt in select * from public.leave_types where active and encashable loop
    v_bal := public.leave_balance(e.id, lt.id, null);
    if v_bal > 0 then
      insert into public.leave_encashments (employee_id, leave_type_id, days, reason, status)
      values (e.id, lt.id, v_bal, 'تسوية نهاية الخدمة', 'معتمد') returning id into v_enc;
      perform public.apply_leave_encashment(v_enc);
    end if;
  end loop;

  -- التسليم والإنهاء وإغلاق الحساب — الدالة القائمة كما هي
  perform public.handover_employee(e.id, t.successor_id,
    t.term_type || ': ' || t.reason, true, true, t.last_working_day);

  -- الكشف الأخير: يُبنى إن لم يكن معتمداً، وتُضاف مكافأة نهاية الخدمة بنداً يدوياً يبقى
  select p.state into v_state from public.payrolls p where p.employee_id = e.id and p.period = v_final;
  if v_state is null or v_state = 'مسودة' then
    v_pr := public.build_payroll(e.id, v_final);
    if (v_settle ->> 'gratuity')::numeric > 0 then
      perform public.add_payroll_line(v_pr, 'استحقاق', 'استحقاق آخر', 'مكافأة نهاية الخدمة — '
        || (v_settle ->> 'service_years') || ' سنة', (v_settle ->> 'gratuity')::numeric);
    end if;
  end if;

  update public.employees
     set employment_status = case when t.term_type = 'استقالة' then 'مستقيل' else 'منتهية خدمته' end
   where id = e.id;

  update public.termination_requests
     set status = 'مكتمل', completed_at = now(), completed_by = auth.uid(),
         settlement = v_settle || jsonb_build_object('final_payroll_id', v_pr, 'final_payroll_state', coalesce(v_state, 'مسودة'))
   where id = p_termination;

  return v_settle || jsonb_build_object('final_payroll_id', v_pr);
end $$;


-- ============================================================
-- ٦) RLS
-- ============================================================
alter table public.termination_requests enable row level security;
alter table public.clearance_templates  enable row level security;
alter table public.clearance_items      enable row level security;

drop policy if exists "read terminations" on public.termination_requests;
create policy "read terminations" on public.termination_requests for select to authenticated
  using ((select public.can_manage_hr()) or (select public.can_manage_finance())
         or employee_id = (select public.my_employee_id())
         or public.is_manager_of(employee_id)
         or (approval_id is not null and public.can_see_approval(approval_id)));

drop policy if exists "read clearance templates" on public.clearance_templates;
create policy "read clearance templates" on public.clearance_templates for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "hr manages clearance templates" on public.clearance_templates;
create policy "hr manages clearance templates" on public.clearance_templates for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

drop policy if exists "read clearance items" on public.clearance_items;
create policy "read clearance items" on public.clearance_items for select to authenticated
  using (exists (select 1 from public.termination_requests t where t.id = termination_id));

revoke all on public.termination_requests, public.clearance_templates, public.clearance_items from anon;

drop trigger if exists trg_audit_termination_requests on public.termination_requests;
create trigger trg_audit_termination_requests after insert or update or delete on public.termination_requests
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_clearance_items on public.clearance_items;
create trigger trg_audit_clearance_items after insert or update or delete on public.clearance_items
  for each row execute function public.audit_row();

revoke all on function public.refresh_clearance(uuid)                       from public, anon, authenticated;
revoke all on function public.apply_termination(uuid)                       from public, anon, authenticated;
revoke all on function public.complete_clearance_item(uuid, text, text)     from public, anon;
revoke all on function public.submit_termination(uuid, text, date, text, uuid) from public, anon;
revoke all on function public.final_settlement_preview(uuid)                from public, anon;
revoke all on function public.complete_termination(uuid)                    from public, anon;
grant execute on function public.complete_clearance_item(uuid, text, text)  to authenticated;
grant execute on function public.submit_termination(uuid, text, date, text, uuid) to authenticated;
grant execute on function public.final_settlement_preview(uuid)             to authenticated;
grant execute on function public.complete_termination(uuid)                 to authenticated;
