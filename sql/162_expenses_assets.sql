-- ============================================================
-- تلال ERP — 162: مصروفات الموظف والعهد وأنواع السلف (HR المؤسسي — المرحلة 7)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 153، 157، 158 (hr_account_map، hr_account).
--
-- ============================================================
-- ١) مصروفات الموظف
--
--   الموظف يقدّم (فئة، مبلغ، تاريخ، مشروع، إيصال) ← سلسلة «expense»:
--   المدير المباشر ← المالية ← (المدير العام فوق حدٍّ يضعه المالك)
--   عند الاعتماد: قيد مدين حساب الفئة / دائن «مستحقات الموظفين» (expense_payable)
--   عند الدفع (المالية): مدين expense_payable / دائن الصندوق أو البنك
--   الحسابات من hr_account_map ومن الفئة — لا رقم في الواجهة.
--
-- ٢) السلف: نوعٌ للسلفة (سلفة راتب، قرض، طارئة، عهدة معدات) — دورة 062 كما هي.
--
-- ٣) العهد: ما سُلِّم للموظف (حاسوب، هاتف، شريحة، مفاتيح، مركبة…) وتاريخ
--    تسليمه وإعادته وحالته — وإخلاء الطرف (163) يقرؤه.
-- ============================================================


-- ============================================================
-- ١) فئات المصروف وحسابها
-- ============================================================
insert into public.hr_account_map (key, label, account_code) values
  ('expense_payable', 'مستحقات الموظفين عن المصروفات (دائن عند الاعتماد)', '2300')
on conflict (key) do nothing;

create table if not exists public.expense_categories (
  code          text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_ar       text not null,
  account_code  text not null references public.accounts(code) on update cascade on delete restrict,
  requires_receipt boolean not null default true,
  active        boolean not null default true,
  sort_order    int not null default 0
);

insert into public.expense_categories (code, name_ar, account_code, requires_receipt, sort_order)
select v.code, v.name_ar, v.acc, v.rec, v.ord
  from (values
    ('transport', 'مواصلات ووقود',    '5310', true,  1),
    ('travel',    'سفر ومهمات',       '5310', true,  2),
    ('meals',     'ضيافة وطعام',      '5320', true,  3),
    ('phone',     'هاتف واتصالات',    '5330', true,  4),
    ('business',  'مصروف عمل',        '5300', true,  5),
    ('other',     'أخرى',             '5800', true,  6)
  ) v(code, name_ar, acc, rec, ord)
 where exists (select 1 from public.accounts a where a.code = v.acc)
on conflict (code) do nothing;

insert into public.approval_workflows (code, name_ar, entity_type, description) values
  ('expense', 'مصروفات الموظفين', 'employee_expense', 'المدير المباشر ثم المالية. يضيف المالك خطوة المدير العام فوق حدّ مبلغ.')
on conflict (code) do nothing;
insert into public.approval_steps (workflow_code, step_no, label, approver_kind) values
  ('expense', 1, 'المدير المباشر', 'المدير المباشر'),
  ('expense', 2, 'المالية', 'المالية')
on conflict (workflow_code, step_no) do nothing;


-- ============================================================
-- ٢) المصروفات
-- ============================================================
create table if not exists public.employee_expenses (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  category_code     text not null references public.expense_categories(code) on update cascade,
  expense_date      date not null,
  amount            numeric not null check (amount > 0),
  description       text not null check (btrim(description) <> ''),
  project_id        uuid references public.projects(id) on delete set null,
  receipt_path      text unique check (receipt_path is null or receipt_path like 'expenses/%'),
  receipt_name      text,
  status            text not null default 'قيد الموافقة'
                      check (status in ('قيد الموافقة', 'معتمد', 'مرفوض', 'ملغى', 'مدفوع')),
  approval_id       uuid references public.approval_requests(id) on delete set null,
  accrual_entry_id  uuid references public.journal_entries(id) on delete set null,
  paid_at           date,
  paid_method       text check (paid_method in ('نقد', 'بنك')),
  payment_entry_id  uuid references public.journal_entries(id) on delete set null,
  paid_by           uuid references auth.users(id) on delete set null,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists employee_expenses_emp_idx on public.employee_expenses (employee_id, expense_date desc);
create index if not exists employee_expenses_status_idx on public.employee_expenses (status);

create or replace function public.submit_expense(
  p_category text, p_date date, p_amount numeric, p_description text,
  p_project uuid default null, p_receipt_path text default null, p_receipt_name text default null,
  p_employee uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(p_employee, public.my_employee_id());
  c public.expense_categories%rowtype;
  v_id uuid;
  v_name text;
begin
  if v_emp is null then raise exception 'حسابك غير مربوط بملف موظف'; end if;
  if v_emp is distinct from public.my_employee_id() and not public.can_manage_hr() then
    raise exception 'يقدّم المصروفَ صاحبُه أو الموارد البشرية نيابةً عنه';
  end if;
  select * into c from public.expense_categories where code = p_category and active;
  if not found then raise exception 'فئة المصروف غير موجودة'; end if;
  if c.requires_receipt and p_receipt_path is null then raise exception 'هذه الفئة تتطلب إيصالاً'; end if;
  if p_date > public.baghdad_today() then raise exception 'تاريخ المصروف لا يكون في المستقبل'; end if;
  if p_receipt_path is not null and p_receipt_path not like 'expenses/' || v_emp || '/%' then
    raise exception 'مسار الإيصال لا يطابق صاحب المصروف';
  end if;

  insert into public.employee_expenses
    (employee_id, category_code, expense_date, amount, description, project_id, receipt_path, receipt_name)
  values (v_emp, p_category, p_date, p_amount, btrim(p_description), p_project, p_receipt_path, p_receipt_name)
  returning id into v_id;

  select e.full_name into v_name from public.employees e where e.id = v_emp;
  update public.employee_expenses
     set approval_id = public.start_approval('expense', 'employee_expense', v_id, v_emp,
           'مصروف ' || c.name_ar || ' — ' || v_name || ' (' || p_date || ')', p_amount, null)
   where id = v_id;
  return v_id;
end $$;

-- الاعتماد ⇒ قيد الاستحقاق
create or replace function public.apply_expense(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_expenses%rowtype;
  v_exp uuid; v_pay uuid; v_entry uuid; v_name text;
begin
  select * into x from public.employee_expenses where id = p_id for update;
  if x.accrual_entry_id is not null then return; end if;
  select a.id into v_exp from public.expense_categories c join public.accounts a on a.code = c.account_code
   where c.code = x.category_code;
  v_pay := public.hr_account('expense_payable');
  if v_exp is null or v_pay is null then raise exception 'حساب الفئة أو مستحقات الموظفين غير موجود'; end if;
  select full_name into v_name from public.employees where id = x.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source, source_id, project_id)
  values (x.expense_date, 'مصروف موظف: ' || coalesce(v_name, '') || ' — ' || x.description, 'EXPENSE', 'إداري عام',
          'employee_expenses', x.id, x.project_id)
  returning id into v_entry;
  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_exp, x.amount, 0), (v_entry, v_pay, 0, x.amount);

  update public.employee_expenses set accrual_entry_id = v_entry where id = p_id;
end $$;

-- الدفع للموظف (المالية)
create or replace function public.pay_expense(p_id uuid, p_method text default 'نقد', p_date date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_expenses%rowtype;
  v_pay uuid; v_cash uuid; v_entry uuid; v_when date := coalesce(p_date, public.baghdad_today()); v_name text;
begin
  if not public.can_manage_finance() then raise exception 'دفع المصروفات للمالية'; end if;
  select * into x from public.employee_expenses where id = p_id for update;
  if not found then raise exception 'المصروف غير موجود'; end if;
  if x.status <> 'معتمد' then raise exception 'يُدفع المصروف المعتمد فقط (الحالة: %)', x.status; end if;
  if p_method not in ('نقد', 'بنك') then raise exception 'طريقة الدفع: نقد أو بنك'; end if;
  v_pay := public.hr_account('expense_payable');
  select id into v_cash from public.accounts where code = case when p_method = 'بنك' then '1200' else '1100' end;
  select full_name into v_name from public.employees where id = x.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source, source_id, project_id)
  values (v_when, 'دفع مصروف موظف: ' || coalesce(v_name, '') || ' — ' || x.description, 'EXPENSE-PAY', 'إداري عام',
          'employee_expenses', x.id, x.project_id)
  returning id into v_entry;
  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_pay, x.amount, 0), (v_entry, v_cash, 0, x.amount);

  update public.employee_expenses
     set status = 'مدفوع', paid_at = v_when, paid_method = p_method, payment_entry_id = v_entry, paid_by = auth.uid()
   where id = p_id;
  perform public.hr_notify_employee(x.employee_id, 'دُفع مصروفك', x.description || ' — ' || x.amount,
    '/dashboard/me/requests', 'مصروف', p_id, 'employee_expense');
end $$;


-- ============================================================
-- ٣) تطبيق النتيجة — 157 + المصروف
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

  -- (162)
  elsif r.entity_type = 'employee_expense' then
    update public.employee_expenses set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_expense(r.entity_id);
    end if;

  -- (163) إنهاء الخدمة — يُعرَّف في 163 ويُستدعى ديناميكياً لئلا يُشترط ترتيب الملفات
  elsif r.entity_type = 'termination' then
    update public.termination_requests set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      execute 'select public.apply_termination($1)' using r.entity_id;
    end if;
  end if;

  perform set_config('tilal.approval', '', true);
end $$;


-- ============================================================
-- ٤) السلف: نوع
-- ============================================================
alter table public.employee_advances
  add column if not exists advance_type text not null default 'سلفة راتب'
  check (advance_type in ('سلفة راتب', 'قرض', 'سلفة طارئة', 'عهدة معدات'));

comment on column public.employee_advances.advance_type is
  'نوع السلفة (162). الدورة كما هي (062): طلب ← اعتماد ← صرف ← أقساط من الكشف.';


-- ============================================================
-- ٥) العهد
-- ============================================================
create table if not exists public.employee_assets (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  asset_type         text not null check (asset_type in ('حاسوب', 'هاتف', 'كاميرا', 'مركبة', 'شريحة', 'مفاتيح', 'بطاقة دخول', 'أخرى')),
  description        text not null,
  asset_tag          text,
  serial_no          text,
  inventory_item_id  uuid references public.inventory_items(id) on delete set null,
  assigned_date      date not null default public.baghdad_today(),
  condition_out      text,
  returned_date      date,
  condition_in       text,
  status             text not null default 'مسلَّمة' check (status in ('مسلَّمة', 'مُعادة', 'مفقودة', 'تالفة')),
  notes              text,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint employee_assets_return check (returned_date is null or returned_date >= assigned_date),
  constraint employee_assets_returned check (status = 'مسلَّمة' or returned_date is not null or status in ('مفقودة', 'تالفة'))
);

create index if not exists employee_assets_emp_idx on public.employee_assets (employee_id, status);


-- ============================================================
-- ٦) الإيصالات — دلو خاصّ
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- الموظف يرفع إيصاله في مجلّده، وHR نيابةً عنه
drop policy if exists "write expense receipts" on storage.objects;
create policy "write expense receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts'
              and (storage.foldername(name))[1] = 'expenses'
              and ((storage.foldername(name))[2] = (select public.my_employee_id())::text
                   or (select public.can_manage_hr())));

-- القراءة تتبع صفّ المصروف (وRLS عليه)، والإيصال المرفوع قبل حفظ صفّه يقرؤه صاحبه
drop policy if exists "read expense receipts" on storage.objects;
create policy "read expense receipts" on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts'
         and (exists (select 1 from public.employee_expenses x where x.receipt_path = name)
              or (storage.foldername(name))[2] = (select public.my_employee_id())::text));


-- ============================================================
-- ٧) RLS
-- ============================================================
alter table public.expense_categories enable row level security;
alter table public.employee_expenses  enable row level security;
alter table public.employee_assets    enable row level security;

drop policy if exists "read expense categories" on public.expense_categories;
create policy "read expense categories" on public.expense_categories for select to authenticated
  using (not (select public.is_broker()));
drop policy if exists "finance manages expense categories" on public.expense_categories;
create policy "finance manages expense categories" on public.expense_categories for all to authenticated
  using ((select public.can_manage_finance())) with check ((select public.can_manage_finance()));

drop policy if exists "read employee expenses" on public.employee_expenses;
create policy "read employee expenses" on public.employee_expenses for select to authenticated
  using ((select public.can_manage_hr()) or (select public.can_manage_finance())
         or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t)
         or (approval_id is not null and public.can_see_approval(approval_id)));

drop policy if exists "read employee assets" on public.employee_assets;
create policy "read employee assets" on public.employee_assets for select to authenticated
  using ((select public.can_manage_hr()) or (select public.is_followup_manager())
         or employee_id = (select public.my_employee_id())
         or employee_id in (select t.id from public.my_team_employee_ids() t));
drop policy if exists "hr manages employee assets" on public.employee_assets;
create policy "hr manages employee assets" on public.employee_assets for all to authenticated
  using ((select public.can_manage_hr()) or (select public.is_followup_manager()))
  with check ((select public.can_manage_hr()) or (select public.is_followup_manager()));

revoke all on public.expense_categories, public.employee_expenses, public.employee_assets from anon;

drop trigger if exists trg_audit_employee_expenses on public.employee_expenses;
create trigger trg_audit_employee_expenses after insert or update or delete on public.employee_expenses
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_employee_assets on public.employee_assets;
create trigger trg_audit_employee_assets after insert or update or delete on public.employee_assets
  for each row execute function public.audit_row();

revoke all on function public.apply_expense(uuid)  from public, anon, authenticated;
revoke all on function public.approval_apply(uuid) from public, anon, authenticated;
revoke all on function public.submit_expense(text, date, numeric, text, uuid, text, text, uuid) from public, anon;
revoke all on function public.pay_expense(uuid, text, date)                                     from public, anon;
grant execute on function public.submit_expense(text, date, numeric, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.pay_expense(uuid, text, date)                                  to authenticated;

update public.app_modules set enforced = false, note = 'المرحلة 7: مصروفات الموظفين بسلسلة وقيد استحقاق ودفع (162).'
 where code = 'expenses';
