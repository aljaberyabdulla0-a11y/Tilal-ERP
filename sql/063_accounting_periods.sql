-- ============================================================
-- تلال ERP — 063: قفل الفترة المحاسبية (المرحلة ٤/أ)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المشكلة =====
--
-- كل ما بُني في المراحل السابقة يكتب قيوداً: الراتب والعمولة
-- والسلفة والعربون والحركة النقدية. ولا شيء يمنع كتابةً أو حذفاً
-- في شهرٍ مضى — فميزانية أيلول التي عُرضت على شريك أو مصرف
-- تستطيع أن تتغيّر في تشرين بلا أن يعلم أحد.
--
-- ===== الحلّ: القفل في القاعدة لا في الشاشة =====
--
-- حارسان على journal_entries و journal_lines يرفضان أي كتابة أو
-- تعديل أو حذف يقع تاريخه في فترة مقفلة — **مهما كان الطريق**.
--
-- ⚠️ وهذا يشمل عائلة repost_* رغم أنها security definer: الدالّة
--    تتجاوز RLS، لكنها **لا تتجاوز المحفّزات**. فالقفل يمسك كل
--    الأبواب: الشاشة، والدوالّ، والمحفّزات المتسلسلة.
--    (ولولا sql/052 الذي سحب منحة repost_* من المستخدمين، لكان
--     في يد كل موظف بابٌ خلفي يُعيد كتابة قيدٍ في فترة مقفلة.)
--
-- ===== ما يترتّب عليه — وهو مقصود =====
--
--   • اعتماد كشف راتبٍ شهرُه مقفل يفشل (القيد لا يُكتب).
--   • إعادة فتح كشفٍ في فترة مقفلة تفشل (القيد لا يُحذف).
--   • حذف حركة نقدية أو دفعة في فترة مقفلة يفشل.
--   • تصحيح الماضي يمرّ بفتح الفترة صراحةً بسببٍ مكتوب — أو
--     بقيدٍ في الشهر الحالي، وهو الأصحّ محاسبياً.
--
-- ===== ثلاث حالات =====
--   مفتوح  — الافتراضي. أي شهر بلا صفّ هنا مفتوح.
--   مقفل   — لا كتابة. يُعاد فتحه بسببٍ مكتوب.
--   مؤرشف  — لا كتابة ولا إعادة فتح. نهائي.
--
-- ===== التراجع =====
--   drop trigger trg_lock_journal_entries on public.journal_entries;
--   drop trigger trg_lock_journal_lines   on public.journal_lines;
--   ثم الدوالّ والجدول.
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة:
--   accounting_periods
--
-- يتطلب: sql/052 (تحصين repost_*) و sql/058 (سجلّ التدقيق).
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الفترات
-- ------------------------------------------------------------
create table if not exists public.accounting_periods (
  period       text primary key check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status       text not null default 'مفتوح'
               check (status in ('مفتوح', 'مقفل', 'مؤرشف')),
  closed_by    uuid references auth.users(id) on delete set null,
  closed_by_name text,
  closed_at    timestamptz,
  reopened_by  uuid references auth.users(id) on delete set null,
  reopened_at  timestamptz,
  reopen_reason text,
  note         text,
  created_at   timestamptz not null default now()
);

comment on table public.accounting_periods is
  'حالة كل شهر محاسبي. الشهر بلا صفّ هنا مفتوح — فلا تحتاج القاعدة صفّاً لكل شهر (sql/063).';


-- ------------------------------------------------------------
-- 2) هل هذا التاريخ في فترة مقفلة؟
-- ------------------------------------------------------------
create or replace function public.is_period_locked(p_date date)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.accounting_periods
     where period = to_char(p_date, 'YYYY-MM')
       and status in ('مقفل', 'مؤرشف')
  );
$fn$;


-- ------------------------------------------------------------
-- 3) الحارسان
-- ------------------------------------------------------------
create or replace function public.guard_locked_period_entry()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare v_date date;
begin
  -- في التعديل يُفحص الطرفان: لا يُنقل قيدٌ من فترة مفتوحة إلى
  -- مقفلة، ولا يُسحب من مقفلة إلى مفتوحة.
  if tg_op in ('INSERT', 'UPDATE') then
    v_date := new.entry_date;
    if public.is_period_locked(v_date) then
      raise exception 'الفترة % مقفلة محاسبياً — لا يُكتب فيها قيد. افتحها بسببٍ مكتوب أو سجّل التصحيح في الشهر الحالي.',
        to_char(v_date, 'YYYY-MM');
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_date := old.entry_date;
    if public.is_period_locked(v_date) then
      raise exception 'الفترة % مقفلة محاسبياً — لا يُعدَّل قيدها ولا يُحذف.',
        to_char(v_date, 'YYYY-MM');
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_lock_journal_entries on public.journal_entries;
create trigger trg_lock_journal_entries
  before insert or update or delete on public.journal_entries
  for each row execute function public.guard_locked_period_entry();


create or replace function public.guard_locked_period_line()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare v_date date;
begin
  select je.entry_date into v_date
    from public.journal_entries je
   where je.id = coalesce(new.entry_id, old.entry_id);

  -- ⚠️ القيد غير موجود = سطرٌ يُحذف تتابعاً مع رأسه. وحارسُ الرأس
  --    قد فحص الفترة قبل قليل، فلا نمنع الحذف المتتابع هنا.
  if v_date is null then
    return coalesce(new, old);
  end if;

  if public.is_period_locked(v_date) then
    raise exception 'الفترة % مقفلة محاسبياً — لا تُعدَّل سطور قيودها.',
      to_char(v_date, 'YYYY-MM');
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_lock_journal_lines on public.journal_lines;
create trigger trg_lock_journal_lines
  before insert or update or delete on public.journal_lines
  for each row execute function public.guard_locked_period_line();


-- ------------------------------------------------------------
-- 4) الإقفال والفتح والأرشفة
-- ------------------------------------------------------------
create or replace function public.close_period(p_period text, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_drafts int; v_who text; v_names text;
begin
  if not public.is_admin() then
    raise exception 'إقفال الفترات المحاسبية للمدير';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر YYYY-MM';
  end if;
  if p_period > to_char((now() at time zone 'Asia/Baghdad')::date, 'YYYY-MM') then
    raise exception 'لا تُقفل فترة لم تنتهِ بعد';
  end if;

  -- ⚠️ كشفٌ مسوّدة في شهرٍ يُقفل يبقى معلّقاً إلى الأبد: اعتماده
  --    يحتاج كتابة قيد، والقفل يمنعها. فالإقفال يشترط إنهاءها.
  select count(*), string_agg(e.full_name, '، ')
    into v_drafts, v_names
    from public.payrolls p join public.employees e on e.id = p.employee_id
   where p.period = p_period and p.state = 'مسودة';

  if v_drafts > 0 then
    raise exception 'في % كشوف مسوّدة (%) — اعتمدها أو احذفها قبل الإقفال', p_period, v_names;
  end if;

  select coalesce(e.full_name, pr.email) into v_who
    from public.profiles pr left join public.employees e on e.user_id = pr.id
   where pr.id = auth.uid();

  insert into public.accounting_periods
    (period, status, closed_by, closed_by_name, closed_at, note)
  values (p_period, 'مقفل', auth.uid(), v_who, now(), nullif(btrim(coalesce(p_note,'')),''))
  on conflict (period) do update
    set status = 'مقفل', closed_by = excluded.closed_by,
        closed_by_name = excluded.closed_by_name, closed_at = now(),
        note = coalesce(excluded.note, public.accounting_periods.note);
end;
$fn$;

create or replace function public.reopen_period(p_period text, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare r public.accounting_periods%rowtype;
begin
  if not public.is_admin() then
    raise exception 'فتح الفترات المحاسبية للمدير';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'اكتب سبب إعادة الفتح — فتحُ فترةٍ مقفلة قرارٌ يُراجَع';
  end if;

  select * into r from public.accounting_periods where period = p_period;
  if not found or r.status = 'مفتوح' then
    raise exception 'الفترة % مفتوحة أصلاً', p_period;
  end if;
  if r.status = 'مؤرشف' then
    raise exception 'الفترة % مؤرشفة — لا تُفتح', p_period;
  end if;

  update public.accounting_periods
     set status = 'مفتوح', reopened_by = auth.uid(),
         reopened_at = now(), reopen_reason = btrim(p_reason)
   where period = p_period;
end;
$fn$;

create or replace function public.archive_period(p_period text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare r public.accounting_periods%rowtype;
begin
  if not public.is_admin() then
    raise exception 'أرشفة الفترات للمدير';
  end if;
  select * into r from public.accounting_periods where period = p_period;
  if not found or r.status <> 'مقفل' then
    raise exception 'لا تُؤرشف إلا فترة مقفلة';
  end if;
  update public.accounting_periods set status = 'مؤرشف' where period = p_period;
end;
$fn$;


-- ------------------------------------------------------------
-- 5) نظرة الشهور — للشاشة
-- ------------------------------------------------------------
create or replace function public.periods_overview(p_months int default 12)
returns table (
  period text, status text, entries int, total_debit numeric,
  draft_payrolls int, closed_by_name text, closed_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'الفترات المحاسبية للمدير';
  end if;

  return query
  select m.p,
         coalesce(ap.status, 'مفتوح'),
         (select count(*)::int from public.journal_entries je
           where to_char(je.entry_date,'YYYY-MM') = m.p),
         coalesce((select sum(jl.debit) from public.journal_entries je
                    join public.journal_lines jl on jl.entry_id = je.id
                   where to_char(je.entry_date,'YYYY-MM') = m.p), 0),
         (select count(*)::int from public.payrolls pr
           where pr.period = m.p and pr.state = 'مسودة'),
         ap.closed_by_name, ap.closed_at
    from (
      select to_char(
        (date_trunc('month', (now() at time zone 'Asia/Baghdad'))
         - (g || ' month')::interval), 'YYYY-MM') as p
      from generate_series(0, greatest(p_months, 1) - 1) g
    ) m
    left join public.accounting_periods ap on ap.period = m.p
   order by m.p desc;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) الصلاحيات
-- ------------------------------------------------------------
alter table public.accounting_periods enable row level security;

drop policy if exists "admin manages periods" on public.accounting_periods;
create policy "admin manages periods" on public.accounting_periods
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists trg_audit_accounting_periods on public.accounting_periods;
create trigger trg_audit_accounting_periods
  after insert or update or delete on public.accounting_periods
  for each row execute function public.audit_row();

-- ⚠️ is_period_locked تناديها المحفّزات (definer) — لا تُمنح.
revoke execute on function public.close_period(text, text)   from public, anon;
revoke execute on function public.reopen_period(text, text)  from public, anon;
revoke execute on function public.archive_period(text)       from public, anon;
revoke execute on function public.periods_overview(int)      from public, anon;

grant execute on function public.close_period(text, text)  to authenticated;
grant execute on function public.reopen_period(text, text) to authenticated;
grant execute on function public.archive_period(text)      to authenticated;
grant execute on function public.periods_overview(int)     to authenticated;

notify pgrst, 'reload schema';
