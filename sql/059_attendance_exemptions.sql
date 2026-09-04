-- ============================================================
-- تلال ERP — 059: استثناء الدوام اليومي
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ **شرطٌ لتشغيل قواعد الخصم لا ميزة إضافية.** بدونه كل موظف
--    مبيعات في زيارة موقع مع زبون يظهر غائباً ويُخصم راتبه.
--
-- ===== نوعا الاستثناء =====
--
--   «يوم كامل» — الموظف خارج المكتب طول اليوم (مهمة، إذن، زيارة
--                بعيدة). لا غياب ولا تأخير ولا انصراف مبكر. ولا
--                يُشترط أن يبصم أصلاً.
--
--   «فترة»     — خرج أو تأخّر بإذن ثم داوم (زيارة موقع صباحاً).
--                يُعفى من التأخير والانصراف المبكر، **لكن يبقى
--                مطالَباً بالبصمة** — فغيابه الكامل يُحتسب.
--
-- الفرق مقصود: «يوم كامل» يعفي من كل شيء، و«فترة» تعفي من دقائق
-- لا من الحضور. ولولا التفريق لصار الاستثناء باباً للغياب بإذن.
--
-- ===== قيدٌ على الأثر الرجعي =====
--
-- يُسمح بالاستثناء على فترةٍ كشفُها مسوّدة أو لا كشف لها. ويُمنع
-- على كشفٍ **معتمد**: أرقامه دخلت الدفاتر، وتغييرها من الخلف
-- يجعل القيد يخالف بنوده. التصحيح هناك بإعادة فتح الكشف.
--
-- ===== التراجع =====
--   drop trigger trg_guard_exemption_period on public.attendance_exemptions;
--   drop function public.guard_exemption_period();
--   drop table public.attendance_exemptions;
--
-- طُبّق على القاعدة في 2026-09-04 عبر هجرة:
--   attendance_exemptions
--
-- آمن لإعادة التشغيل.
-- ============================================================

create table if not exists public.attendance_exemptions (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  exempt_date     date not null,
  exempt_type     text not null default 'يوم كامل'
                  check (exempt_type in ('يوم كامل', 'فترة')),
  start_time      time,          -- لنوع «فترة» — توثيقٌ للمدّة المأذونة
  end_time        time,
  reason          text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  -- استثناءان في يومٍ واحد لموظفٍ واحد تناقض
  constraint attendance_exemptions_uniq unique (employee_id, exempt_date),
  -- «فترة» بلا حدود زمنية لا معنى لها
  constraint attendance_exemptions_window_chk check (
    exempt_type <> 'فترة'
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists attendance_exemptions_lookup
  on public.attendance_exemptions (employee_id, exempt_date);

comment on table public.attendance_exemptions is
  'إذن يوميّ يُعفي من خصم الدوام. «يوم كامل» يعفي من الغياب أيضاً، و«فترة» تعفي من الدقائق لا من الحضور (sql/059).';
comment on column public.attendance_exemptions.reason is
  'إلزامي — استثناءٌ بلا سبب مكتوب لا يُراجَع بعد شهر.';

-- ------------------------------------------------------------
-- الحارس: لا أثر رجعي على كشفٍ معتمد
-- ------------------------------------------------------------
create or replace function public.guard_exemption_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emp    uuid;
  v_date   date;
  v_state  text;
  v_who    text;
begin
  v_emp  := coalesce(new.employee_id, old.employee_id);
  v_date := coalesce(new.exempt_date, old.exempt_date);

  select p.state into v_state
    from public.payrolls p
   where p.employee_id = v_emp
     and p.period = to_char(v_date, 'YYYY-MM');

  if v_state is not null and v_state <> 'مسودة' then
    raise exception 'كشف % لهذا الموظف % — أعِد فتحه قبل تعديل استثناءات دوامه',
      to_char(v_date, 'YYYY-MM'), v_state;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- التوقيع باسم من أذن — لا يُترك للواجهة
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.created_by_name is null then
    select coalesce(e.full_name, p.email) into v_who
      from public.profiles p
      left join public.employees e on e.user_id = p.id
     where p.id = auth.uid();
    new.created_by_name := v_who;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_exemption_period on public.attendance_exemptions;
create trigger trg_guard_exemption_period
  before insert or update or delete on public.attendance_exemptions
  for each row execute function public.guard_exemption_period();

-- ------------------------------------------------------------
-- الصلاحيات
-- ------------------------------------------------------------
alter table public.attendance_exemptions enable row level security;

drop policy if exists "admin manages exemptions" on public.attendance_exemptions;
create policy "admin manages exemptions" on public.attendance_exemptions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- المشرف يرى استثناءات فريقه — ولا يكتبها (الإذن قرار إداري)
drop policy if exists "supervisor reads scope exemptions" on public.attendance_exemptions;
create policy "supervisor reads scope exemptions" on public.attendance_exemptions
  for select to authenticated
  using (employee_id in (select m.id from public.my_scope_employees() m));

-- الموظف يرى استثناءاته هو
drop policy if exists "employee reads own exemptions" on public.attendance_exemptions;
create policy "employee reads own exemptions" on public.attendance_exemptions
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));

-- سجلّ التدقيق يشمله: إذنٌ يُمحى بلا أثر بابٌ للتلاعب
drop trigger if exists trg_audit_attendance_exemptions on public.attendance_exemptions;
create trigger trg_audit_attendance_exemptions
  after insert or update or delete on public.attendance_exemptions
  for each row execute function public.audit_row();

notify pgrst, 'reload schema';
