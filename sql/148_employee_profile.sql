-- ============================================================
-- تلال ERP — 148: ملف الموظف الكامل (HR المؤسسي — المرحلة 2)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145، 146.
--
-- ============================================================
-- ما يضيفه (بلا حذف ولا تغيير لسلوك قائم)
--
--   ١) البيانات الشخصية والطوارئ والتجربة والبنك على employees نفسه
--      (لا جدول staff ولا profile ثانٍ: الملف واحد، وRLS عليه قائمة)
--   ٢) employment_status — آلة حالات للحالة الوظيفية، بجانب status
--   ٣) تاريخ الراتب الموسّع: الراتب السابق، النسبة، السبب، المعتمِد،
--      و adjust_salary() بتاريخ سريان (رجعيّ بشرط ألّا يمسّ كشفاً معتمداً)
--   ٤) مستندات الموظف: أنواعها، ودلو خاصّ، وتنبيه قبل الانتهاء (cron)
--   ٥) الخط الزمني: employee_timeline() يقرأ من الجداول القائمة وسجلّ
--      التدقيق — لا جدول أحداث يُكتب مرتين فيتباعد
--   ٦) update_my_profile(): الموظف يحدّث بيانات تواصله وحدها
--
-- ============================================================
-- لماذا status و employment_status معاً؟
--
-- status (active/inactive) يقرؤه كل شيء: my_account_active() يُغلق به
-- الحساب، والرواتب والبصمة والنطاقات تفحصه. تغيير قيمه يكسرها كلها.
-- فبقي «مفتاح الوصول» كما هو، وصار employment_status «الوصف الوظيفي»
-- الأدقّ، ومحفّزٌ يُبقيهما متّسقين:
--
--   status → inactive (إنهاء الخدمة)   ⇒  employment_status = غير نشط
--                                         (ثم تُصنَّف: مستقيل/منتهية خدمته)
--   status → active   (إعادة التفعيل)  ⇒  نشط، أو تحت التجربة إن لم تنتهِ
--   حالات الخروج لا تُكتب مباشرةً على موظف نشط — الإنهاء عبر handover_employee
--
-- ⚠️ «موقوف» وصفٌ لا يُغلق الحساب في هذه المرحلة (المرحلة 9 تربطه).
-- ============================================================


-- ============================================================
-- ١) البيانات الشخصية
-- ============================================================
alter table public.employees
  add column if not exists name_en                     text,
  add column if not exists gender                      text check (gender in ('ذكر', 'أنثى')),
  add column if not exists birth_date                  date check (birth_date > date '1920-01-01'),
  add column if not exists nationality                 text,
  add column if not exists national_id_no              text,
  add column if not exists email                       text,
  add column if not exists address                     text,
  add column if not exists emergency_contact_name      text,
  add column if not exists emergency_contact_phone     text,
  add column if not exists emergency_contact_relation  text,
  add column if not exists probation_start             date,
  add column if not exists probation_end               date,
  add column if not exists bank_name                   text,
  add column if not exists bank_account_name           text,
  add column if not exists bank_iban                   text,
  add column if not exists employment_status           text;

alter table public.employees drop constraint if exists employees_probation_range;
alter table public.employees add constraint employees_probation_range
  check (probation_start is null or probation_end is null or probation_end >= probation_start);

comment on column public.employees.employment_status is
  'الحالة الوظيفية (148): آلة حالات بجانب status. status يبقى مفتاح الوصول، وهذه الوصف.';
comment on column public.employees.bank_iban is
  'بيانات بنكية (148): يقرؤها الموظف نفسه وHR والمالية (RLS employees)، وكل تغيير في سجلّ التدقيق.';


-- ============================================================
-- ٢) الحالة الوظيفية
-- ============================================================
update public.employees
   set employment_status = case when status = 'active' then 'نشط' else 'غير نشط' end
 where employment_status is null;

alter table public.employees alter column employment_status set default 'نشط';
alter table public.employees alter column employment_status set not null;
alter table public.employees drop constraint if exists employees_employment_status_chk;
alter table public.employees add constraint employees_employment_status_chk
  check (employment_status in ('تحت التجربة', 'نشط', 'في إجازة', 'موقوف',
                               'غير نشط', 'مستقيل', 'منتهية خدمته'));

-- الانتقالات المسموحة — جدول لا نصّ في دالة، فتُقرأ في الواجهة أيضاً
create table if not exists public.employment_status_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

insert into public.employment_status_transitions (from_status, to_status) values
  ('تحت التجربة', 'نشط'), ('تحت التجربة', 'في إجازة'), ('تحت التجربة', 'موقوف'),
  ('نشط', 'في إجازة'), ('نشط', 'موقوف'),
  ('في إجازة', 'نشط'), ('في إجازة', 'تحت التجربة'), ('في إجازة', 'موقوف'),
  ('موقوف', 'نشط'), ('موقوف', 'تحت التجربة'),
  ('غير نشط', 'مستقيل'), ('غير نشط', 'منتهية خدمته'),
  ('مستقيل', 'منتهية خدمته'), ('مستقيل', 'غير نشط'),
  ('منتهية خدمته', 'مستقيل'), ('منتهية خدمته', 'غير نشط')
on conflict do nothing;

alter table public.employment_status_transitions enable row level security;
drop policy if exists "read status transitions" on public.employment_status_transitions;
create policy "read status transitions" on public.employment_status_transitions
  for select to authenticated using (true);
revoke all on public.employment_status_transitions from anon;

create or replace function public.guard_employment_status()
returns trigger language plpgsql set search_path = public as $$
declare
  v_exit constant text[] := array['غير نشط', 'مستقيل', 'منتهية خدمته'];
  v_today date := public.baghdad_today();
  v_on_probation boolean := new.probation_end is not null and new.probation_end >= v_today;
begin
  if tg_op = 'INSERT' then
    if new.status = 'inactive' then
      if not (new.employment_status = any (v_exit)) then
        new.employment_status := 'غير نشط';
      end if;
    elsif new.employment_status = any (v_exit) then
      raise exception 'موظف جديد على رأس عمله لا يكون «%»', new.employment_status;
    elsif new.employment_status = 'نشط' and v_on_probation then
      new.employment_status := 'تحت التجربة';
    end if;
    return new;
  end if;

  -- إنهاء الخدمة (handover_employee أو تعديل الحالة): الوصف يتبع المفتاح
  if new.status is distinct from old.status then
    if new.status = 'inactive' then
      if not (new.employment_status = any (v_exit)) then
        new.employment_status := 'غير نشط';
      end if;
    else
      new.employment_status := case when v_on_probation then 'تحت التجربة' else 'نشط' end;
    end if;
    return new;
  end if;

  if new.employment_status is distinct from old.employment_status then
    if not exists (select 1 from public.employment_status_transitions t
                    where t.from_status = old.employment_status and t.to_status = new.employment_status) then
      raise exception 'لا انتقال من «%» إلى «%»', old.employment_status, new.employment_status;
    end if;
    if new.employment_status = any (v_exit) and new.status = 'active' then
      raise exception 'الخروج يمرّ بـ«إنهاء الخدمة» (التسليم وإغلاق الحساب) لا بتغيير الحالة';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_employment_status on public.employees;
create trigger trg_guard_employment_status
  before insert or update of status, employment_status on public.employees
  for each row execute function public.guard_employment_status();


-- ============================================================
-- ٣) تاريخ الراتب الموسّع
-- ============================================================
alter table public.employee_salary_history
  add column if not exists previous_amount  numeric,
  add column if not exists approved_by      uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_name text;

alter table public.employee_salary_history
  add column if not exists change_pct numeric
  generated always as (
    case when previous_amount is not null and previous_amount > 0
         then round((amount - previous_amount) / previous_amount * 100, 2) end
  ) stored;

-- السابق لكل سطر = السطر الذي قبله للموظف نفسه
with s as (
  select h.id, lag(h.amount) over (partition by h.employee_id order by h.effective_from) as prev
    from public.employee_salary_history h
)
update public.employee_salary_history h
   set previous_amount = s.prev
  from s
 where s.id = h.id and h.previous_amount is null and s.prev is not null;

-- المحفّز القائم (057) بثلاث إضافات: الراتب السابق، والسبب إن مُرِّر،
-- وتجاوزه حين كتبت adjust_salary السطر بنفسها.
create or replace function public.log_salary_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text; v_when date; v_reason text;
begin
  if tg_op = 'UPDATE' and new.base_salary is not distinct from old.base_salary then
    return new;
  end if;
  if new.base_salary is null then return new; end if;
  if coalesce(current_setting('app.salary_logged', true), '') = '1' then
    return new;
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  v_when := (now() at time zone 'Asia/Baghdad')::date;
  v_reason := nullif(current_setting('app.salary_reason', true), '');

  insert into public.employee_salary_history
    (employee_id, amount, effective_from, reason, previous_amount,
     created_by, created_by_name, approved_by, approved_by_name)
  values (new.id, new.base_salary, v_when,
          coalesce(v_reason, case when tg_op = 'INSERT' then 'راتب التعيين' else 'تعديل الراتب' end),
          case when tg_op = 'UPDATE' then old.base_salary end,
          auth.uid(), v_who, auth.uid(), v_who)
  on conflict (employee_id, effective_from) do update
    set amount = excluded.amount, reason = excluded.reason,
        created_by = excluded.created_by, created_by_name = excluded.created_by_name,
        approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name,
        created_at = now();

  return new;
end;
$$;

-- تعديل الراتب بتاريخ سريان وسبب. الرجعيّ مسموح ما لم يمسّ كشفاً
-- معتمداً — التصحيح حينها بإعادة فتح الكشف (القاعدة القائمة).
create or replace function public.adjust_salary(
  p_employee uuid, p_amount numeric, p_effective date, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  v_today date := public.baghdad_today();
  v_prev numeric;
  v_who text;
  v_locked text;
  v_drafts text;
  v_is_latest boolean;
begin
  if not public.can_manage_hr() then
    raise exception 'تعديل الراتب للموارد البشرية والمدير';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'الراتب يجب أن يكون صفراً أو أكثر';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'سبب التعديل إلزامي';
  end if;
  if p_effective is null or p_effective > v_today then
    raise exception 'تاريخ السريان لا يكون بعد اليوم — سجّله يوم يسري';
  end if;

  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if e.hire_date is not null and p_effective < e.hire_date then
    raise exception 'تاريخ السريان (%) قبل المباشرة (%)', p_effective, e.hire_date;
  end if;

  select string_agg(p.period || ' ' || p.state, '، ' order by p.period) into v_locked
    from public.payrolls p
   where p.employee_id = p_employee and p.period >= to_char(p_effective, 'YYYY-MM')
     and p.state <> 'مسودة';
  if v_locked is not null then
    raise exception 'كشوف معتمدة من تاريخ السريان: % — أعِد فتحها أولاً', v_locked;
  end if;

  v_prev := public.salary_at(p_employee, p_effective - 1);
  v_who := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');

  insert into public.employee_salary_history
    (employee_id, amount, effective_from, reason, previous_amount,
     created_by, created_by_name, approved_by, approved_by_name)
  values (p_employee, p_amount, p_effective, btrim(p_reason),
          case when e.hire_date is not null and p_effective = e.hire_date then null else v_prev end,
          auth.uid(), v_who, auth.uid(), v_who)
  on conflict (employee_id, effective_from) do update
    set amount = excluded.amount, reason = excluded.reason,
        previous_amount = coalesce(public.employee_salary_history.previous_amount, excluded.previous_amount),
        approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name,
        created_at = now();

  -- الراتب الحالي يتبع آخر سطر سارٍ
  v_is_latest := not exists (select 1 from public.employee_salary_history h
                              where h.employee_id = p_employee and h.effective_from > p_effective);
  if v_is_latest and e.base_salary is distinct from p_amount then
    perform set_config('app.salary_logged', '1', true);
    update public.employees set base_salary = p_amount where id = p_employee;
    perform set_config('app.salary_logged', '', true);
  end if;

  select string_agg(p.period, '، ' order by p.period) into v_drafts
    from public.payrolls p
   where p.employee_id = p_employee and p.period >= to_char(p_effective, 'YYYY-MM') and p.state = 'مسودة';

  return jsonb_build_object(
    'previous', v_prev, 'amount', p_amount, 'effective_from', p_effective,
    'current_changed', v_is_latest, 'drafts_to_rebuild', v_drafts);
end $$;


-- ============================================================
-- ٤) مستندات الموظف
-- ============================================================
create table if not exists public.employee_document_types (
  code              text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_ar           text not null,
  requires_expiry   boolean not null default false,
  employee_visible  boolean not null default true,
  finance_visible   boolean not null default false,
  sort_order        int not null default 0,
  active            boolean not null default true
);

insert into public.employee_document_types (code, name_ar, requires_expiry, employee_visible, finance_visible, sort_order) values
  ('contract',     'عقد العمل',       false, true,  false, 1),
  ('national_id',  'الهوية الوطنية',  true,  true,  false, 2),
  ('passport',     'جواز السفر',      true,  true,  false, 3),
  ('certificate',  'شهادة',           false, true,  false, 4),
  ('cv',           'السيرة الذاتية',  false, true,  false, 5),
  ('bank',         'مستند بنكي',      false, true,  true,  6),
  ('warning',      'إنذار',           false, true,  false, 7),
  ('letter',       'خطاب',            false, true,  false, 8),
  ('performance',  'مستند أداء',      false, true,  false, 9),
  ('other',        'أخرى',            false, true,  false, 10)
on conflict (code) do nothing;

alter table public.employee_document_types enable row level security;
drop policy if exists "read document types" on public.employee_document_types;
create policy "read document types" on public.employee_document_types
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "hr manages document types" on public.employee_document_types;
create policy "hr manages document types" on public.employee_document_types
  for all to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));
revoke all on public.employee_document_types from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 20971520,
        array['image/jpeg','image/png','image/webp','application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.employee_documents (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  type_code          text not null references public.employee_document_types(code) on update cascade,
  title              text,
  storage_path       text not null unique,
  file_name          text not null,
  mime_type          text,
  size_bytes         bigint,
  issue_date         date,
  expiry_date        date,
  notes              text,
  uploaded_by        uuid references auth.users(id) on delete set null,
  uploaded_by_name   text,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users(id) on delete set null,
  -- 0 لم يُنبَّه، 1 نُبّه قبل الانتهاء، 2 نُبّه عند الانتهاء
  expiry_notice      smallint not null default 0,
  constraint employee_documents_dates check (issue_date is null or expiry_date is null or expiry_date >= issue_date),
  constraint employee_documents_path check (storage_path like 'employees/' || employee_id::text || '/%')
);

create index if not exists employee_documents_emp_idx
  on public.employee_documents (employee_id, created_at desc) where deleted_at is null;
create index if not exists employee_documents_expiry_idx
  on public.employee_documents (expiry_date) where deleted_at is null and expiry_date is not null;

comment on table public.employee_documents is
  'مستندات الموظف (148). الملف في دلو خاصّ employee-documents، والتحميل برابط موقَّع. الحذف ناعم.';

create or replace function public.stamp_employee_document()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    new.uploaded_by_name := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
    if new.expiry_date is null
       and (select t.requires_expiry from public.employee_document_types t where t.code = new.type_code) then
      raise exception 'هذا النوع من المستندات يتطلب تاريخ انتهاء';
    end if;
  else
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_by := auth.uid();
    end if;
    -- تغيير تاريخ الانتهاء يعيد التنبيه من أوله
    if new.expiry_date is distinct from old.expiry_date then
      new.expiry_notice := 0;
    end if;
    if new.storage_path is distinct from old.storage_path or new.employee_id is distinct from old.employee_id then
      raise exception 'الملف لا يُستبدل في مكانه — ارفع نسخة جديدة وأخفِ القديمة';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_employee_document on public.employee_documents;
create trigger trg_stamp_employee_document
  before insert or update on public.employee_documents
  for each row execute function public.stamp_employee_document();

alter table public.employee_documents enable row level security;

-- HR كلها، والموظف ما يُعرض له من مستنداته، والمالية المستندات البنكية
drop policy if exists "read employee documents" on public.employee_documents;
create policy "read employee documents" on public.employee_documents
  for select to authenticated
  using (deleted_at is null and (
    (select public.can_manage_hr())
    or (employee_id = (select public.my_employee_id())
        and exists (select 1 from public.employee_document_types t
                     where t.code = type_code and t.employee_visible))
    or ((select public.can_manage_finance())
        and exists (select 1 from public.employee_document_types t
                     where t.code = type_code and t.finance_visible))
  ));

drop policy if exists "hr uploads employee documents" on public.employee_documents;
create policy "hr uploads employee documents" on public.employee_documents
  for insert to authenticated with check ((select public.can_manage_hr()));

drop policy if exists "hr edits employee documents" on public.employee_documents;
create policy "hr edits employee documents" on public.employee_documents
  for update to authenticated
  using ((select public.can_manage_hr())) with check ((select public.can_manage_hr()));

revoke all on public.employee_documents from anon;

drop trigger if exists trg_audit_employee_documents on public.employee_documents;
create trigger trg_audit_employee_documents
  after insert or update or delete on public.employee_documents
  for each row execute function public.audit_row();

-- التخزين: القراءة تتبع صفّ المستند (وRLS عليه)، فلا يكفي معرفة المسار
drop policy if exists "read employee docs storage" on storage.objects;
create policy "read employee docs storage" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and exists (select 1 from public.employee_documents d where d.storage_path = name)
  );

drop policy if exists "write employee docs storage" on storage.objects;
create policy "write employee docs storage" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = 'employees'
    and (select public.can_manage_hr())
  );

-- إزالة ملفّ يتيم بعد فشل حفظ صفّه — لـ HR، وما له صفّ لا يُمسّ
drop policy if exists "delete employee docs storage" on storage.objects;
create policy "delete employee docs storage" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-documents'
    and ((select public.is_admin())
         or ((select public.can_manage_hr())
             and not exists (select 1 from public.employee_documents d where d.storage_path = name)))
  );

-- تنبيه الانتهاء: قبل 30 يوماً مرة، وعند الانتهاء مرة — لـ HR والمدير وصاحب المستند
create or replace function public.scan_employee_document_expiry()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.baghdad_today();
  d record;
  n int := 0;
  v_stage smallint;
  v_title text;
begin
  for d in
    select doc.id, doc.employee_id, doc.expiry_date, doc.expiry_notice, coalesce(doc.title, t.name_ar) as label,
           e.full_name, e.user_id, t.employee_visible
      from public.employee_documents doc
      join public.employees e on e.id = doc.employee_id and e.status = 'active'
      join public.employee_document_types t on t.code = doc.type_code
     where doc.deleted_at is null and doc.expiry_date is not null
       and doc.expiry_date <= v_today + 30
       and doc.expiry_notice < case when doc.expiry_date < v_today then 2 else 1 end
  loop
    v_stage := case when d.expiry_date < v_today then 2 else 1 end;
    v_title := case when v_stage = 2
                    then 'انتهى مستند: ' || d.label || ' — ' || d.full_name
                    else 'مستند ينتهي قريباً: ' || d.label || ' — ' || d.full_name end;

    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, priority, category)
    select p.id, v_title, 'تاريخ الانتهاء ' || d.expiry_date,
           '/dashboard/hr/employees/' || d.employee_id, 'مستند', d.id, 'employee_document',
           case when v_stage = 2 then 'عالية' else 'عادية' end, 'HR'
      from public.profiles p
     where p.role in ('admin', 'hr');

    if d.user_id is not null and d.employee_visible then
      insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, priority, category)
      values (d.user_id,
              case when v_stage = 2 then 'انتهى مستندك: ' else 'مستندك ينتهي قريباً: ' end || d.label,
              'تاريخ الانتهاء ' || d.expiry_date || ' — راجع الموارد البشرية للتجديد.',
              '/dashboard/me/profile', 'مستند', d.id, 'employee_document',
              case when v_stage = 2 then 'عالية' else 'عادية' end, 'HR');
    end if;

    update public.employee_documents set expiry_notice = v_stage where id = d.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.scan_employee_document_expiry() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('employee-doc-expiry')
    where exists (select 1 from cron.job where jobname = 'employee-doc-expiry');
  perform cron.schedule('employee-doc-expiry', '20 3 * * *',
                        'select public.scan_employee_document_expiry();');
end $$;


-- ============================================================
-- ٥) الخط الزمني — من الجداول القائمة وسجلّ التدقيق
-- ============================================================
create or replace function public.employee_timeline(p_employee uuid, p_limit int default 200)
returns table (occurred_at timestamptz, kind text, title text, details text, actor text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_self boolean := p_employee = public.my_employee_id();
begin
  if not (public.can_manage_hr() or v_self) then
    raise exception 'لا صلاحية لرؤية سجلّ هذا الموظف';
  end if;

  return query
  select x.occurred_at, x.kind, x.title, x.details, x.actor from (
    -- التعيين
    select (e.hire_date::timestamp at time zone 'Asia/Baghdad') as occurred_at, 'تعيين'::text as kind,
           'باشر العمل'::text as title,
           coalesce(e.job_title, '') || coalesce(' — ' || e.department, '') as details, null::text as actor
      from public.employees e where e.id = p_employee and e.hire_date is not null
    union all
    -- الراتب
    select (h.effective_from::timestamp at time zone 'Asia/Baghdad'), 'راتب',
           case when h.previous_amount is null then 'تحديد الراتب' else 'تغيّر الراتب' end,
           coalesce(to_char(h.previous_amount, 'FM999,999,999,990') || ' ← ', '')
             || to_char(h.amount, 'FM999,999,999,990')
             || coalesce(' (' || h.change_pct || '%)', '') || coalesce(' — ' || h.reason, ''),
           coalesce(h.approved_by_name, h.created_by_name)
      from public.employee_salary_history h where h.employee_id = p_employee
    union all
    -- النقل والترقية والحالة: من سجلّ التدقيق
    select a.at, 'تنظيم',
           case
             when 'employment_status' = any (a.changed_fields)
               then 'الحالة الوظيفية: ' || coalesce(a.old_data->>'employment_status', '—') || ' ← ' || (a.new_data->>'employment_status')
             when 'position_id' = any (a.changed_fields)
               then 'تغيّر المنصب'
             when 'department_id' = any (a.changed_fields)
               then 'نُقل إلى قسم آخر'
             else 'تغيّر المدير المباشر'
           end,
           concat_ws(' · ',
             case when 'position_id' = any (a.changed_fields) then
               coalesce((select p.title_ar from public.positions p where p.id = (a.old_data->>'position_id')::uuid), '—')
               || ' ← ' || coalesce((select p.title_ar from public.positions p where p.id = (a.new_data->>'position_id')::uuid), '—') end,
             case when 'department_id' = any (a.changed_fields) then
               coalesce((select d.name_ar from public.departments d where d.id = (a.old_data->>'department_id')::uuid), '—')
               || ' ← ' || coalesce((select d.name_ar from public.departments d where d.id = (a.new_data->>'department_id')::uuid), '—') end,
             case when 'manager_id' = any (a.changed_fields) then
               'المدير: ' || coalesce((select m.full_name from public.employees m where m.id = (a.new_data->>'manager_id')::uuid), '—') end),
           a.actor_name
      from public.audit_log a
     where a.table_name = 'employees' and a.record_id = p_employee and a.operation = 'UPDATE'
       and a.changed_fields && array['department_id', 'position_id', 'manager_id', 'employment_status']
       -- ترحيلات الهجرات (145، 148) بلا فاعل — ليست أحداثاً في حياة الموظف
       and a.actor is not null
    union all
    -- الإجازات
    select l.created_at, 'إجازة', 'إجازة ' || l.leave_type || ' — ' || l.status,
           l.start_date || case when l.end_date is distinct from l.start_date then ' ← ' || l.end_date else '' end
             || coalesce(' · ' || l.reason, ''), null
      from public.leaves l where l.employee_id = p_employee
    union all
    -- العمولات
    select c.created_at, 'عمولة', 'عمولة ' || to_char(c.amount, 'FM999,999,999,990'), c.description, null
      from public.commissions c where c.employee_id = p_employee
    union all
    -- الاستقطاعات (والإنذارات المالية)
    select dd.created_at, 'استقطاع', 'استقطاع ' || to_char(dd.amount, 'FM999,999,999,990'), dd.reason, dd.created_by_name
      from public.deductions dd where dd.employee_id = p_employee
    union all
    -- الكشوف المعتمدة
    select coalesce(p.approved_at, p.created_at), 'راتب', 'كشف ' || p.period || ' — ' || p.state,
           'الصافي ' || to_char(p.net, 'FM999,999,999,990'), null
      from public.payrolls p where p.employee_id = p_employee and p.state <> 'مسودة'
    union all
    -- المستندات
    select doc.created_at, 'مستند', 'مستند: ' || coalesce(doc.title, t.name_ar),
           doc.file_name || coalesce(' · ينتهي ' || doc.expiry_date, ''), doc.uploaded_by_name
      from public.employee_documents doc
      join public.employee_document_types t on t.code = doc.type_code
     where doc.employee_id = p_employee and doc.deleted_at is null
       and (not v_self or t.employee_visible)
    union all
    -- التسليم وانتهاء الخدمة
    select hv.created_at, 'خدمة',
           case when hv.from_employee = p_employee
                then case when hv.ended_service then 'انتهت الخدمة وسلّم ملفاته' else 'سلّم ملفاته' end
                else 'استلم ملفات ' || hv.from_name end,
           'إلى ' || hv.to_name || ': ' || hv.clients_moved || ' عميل، ' || hv.tasks_moved || ' مهمة، '
             || hv.reservations_moved || ' حجز' || coalesce(' — ' || hv.note, ''),
           hv.created_by_name
      from public.employee_handovers hv where p_employee in (hv.from_employee, hv.to_employee)
  ) x
  order by x.occurred_at desc
  limit greatest(coalesce(p_limit, 200), 1);
end $$;


-- ============================================================
-- ٦) الموظف يحدّث بيانات تواصله — لا الراتب ولا البنك ولا المنصب
-- ============================================================
create or replace function public.update_my_profile(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.my_employee_id();
begin
  if v_emp is null then
    raise exception 'حسابك غير مربوط بملف موظف';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k
              where k not in ('phone', 'email', 'address', 'emergency_contact_name',
                              'emergency_contact_phone', 'emergency_contact_relation')) then
    raise exception 'يُحدَّث من هنا الهاتف والبريد والعنوان وجهة الطوارئ فقط';
  end if;

  update public.employees set
    phone                      = case when p ? 'phone' then nullif(btrim(p->>'phone'), '') else phone end,
    email                      = case when p ? 'email' then nullif(btrim(p->>'email'), '') else email end,
    address                    = case when p ? 'address' then nullif(btrim(p->>'address'), '') else address end,
    emergency_contact_name     = case when p ? 'emergency_contact_name' then nullif(btrim(p->>'emergency_contact_name'), '') else emergency_contact_name end,
    emergency_contact_phone    = case when p ? 'emergency_contact_phone' then nullif(btrim(p->>'emergency_contact_phone'), '') else emergency_contact_phone end,
    emergency_contact_relation = case when p ? 'emergency_contact_relation' then nullif(btrim(p->>'emergency_contact_relation'), '') else emergency_contact_relation end
  where id = v_emp;
end $$;


revoke all on function public.adjust_salary(uuid, numeric, date, text) from public, anon;
revoke all on function public.employee_timeline(uuid, int)          from public, anon;
revoke all on function public.update_my_profile(jsonb)              from public, anon;
grant execute on function public.adjust_salary(uuid, numeric, date, text) to authenticated;
grant execute on function public.employee_timeline(uuid, int)          to authenticated;
grant execute on function public.update_my_profile(jsonb)              to authenticated;

-- الوحدة صارت مُطبَّقة جزئياً: المستندات بصلاحياتها
update public.app_modules set note = 'المرحلة 2: مستندات بدلو خاصّ وتنبيه انتهاء.' where code = 'documents';
