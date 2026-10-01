-- ============================================================
-- تلال ERP — 108: حماية دفتر القيود — التوازن، والقيد الآلي، والمصدر
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- ١) زرّ «حذف» في صفحة القيد يحذف أي قيد، آليّاً كان أو يدوياً.
--    حذف قيد آلي يترك مصدره (حركة، كشف، عمولة) بلا قيد — on delete
--    set null — فيبدو الكشف مُرحَّلاً وهو ليس كذلك.
-- ٢) لا شيء في القاعدة يفرض أن مدين القيد = دائنه. الفحص في المتصفّح
--    وحده، والقيد اليدوي يُحفظ على طلبين (الرأس ثم السطور).
-- ٣) القيد الآلي يحمل source (اسم الجدول) بلا source_id. التتبّع من
--    القيد إلى صفّه يمرّ بالبحث في ١٢ جدولاً.
-- ٤) حادثة 2026-09-28: حُذف حجز الوحدة 75 (بيعٌ مؤكَّدة مقدّمته)
--    حذفاً مباشراً. ذهب سجلّ العمولة وفاتورتا المطوّر بالتتالي، وبقي
--    قيد الاستحقاق (1250/4200 = 1,929,500) وعمولة الموظف
--    (5500/2300 = 150,000) يتيمَين. التصحيح في docs/accounting-corrections.md.
--
-- ===== ما يضيفه =====
--
--   أ) journal_entries.source_id — معرّف الصفّ في جدول source.
--      يُختَم بمحفّز على كل جدول مصدر حين يُكتب فيه عمود القيد،
--      ويُملأ للقيود القائمة. لا يمسّ مبلغاً ولا تاريخاً.
--      ⚠️ COMMIN: source = 'sale_commissions' والمرجع محفوظ على
--         reservations.commission_collect_entry_id — الختم يترجمه.
--
--   ب) القيد الآلي (source is not null) لا يُكتب ولا يُعدَّل ولا
--      يُحذف من المتصفّح. الحارس يقرأ current_user: في دالّة
--      security definer هو مالكها (postgres)، ومن PostgREST مباشرة
--      هو authenticated. فالمسار الآلي (حذف حركة ← محفّز يحذف قيدها)
--      يمرّ، والحذف المباشر يُرفض. والقيد اليدوي لا يُكتب مباشرة
--      أيضاً: يُكتب عبر post_manual_entry (111) ذرّياً. يبقى حذفه
--      المباشر مسموحاً للمالية كما كان.
--
--   ج) توازن كل قيد عند الـ commit (constraint trigger deferrable):
--      Σ مدين = Σ دائن، وسطران على الأقل. مؤجَّل لأن الدوالّ تكتب
--      الرأس ثم السطور سطراً سطراً في المعاملة نفسها.
--
--   د) حجزٌ له قيد عمولة (استحقاق أو تحصيل) لا يُحذف — يُفسخ
--      (reverse_sale). الحذف يُيتّم القيد كما في حادثة الوحدة 75.
--
-- ===== ما لا يفعله =====
--
-- لا يصحّح القيد اليتيم للوحدة 75 — ذلك يغيّر الإيراد والذمم، وينتظر
-- موافقة المالك.
--
-- ===== التراجع =====
--
--   drop trigger trg_guard_auto_journal_entry on public.journal_entries;
--   drop trigger trg_guard_auto_journal_line  on public.journal_lines;
--   drop trigger trg_journal_balance           on public.journal_lines;
--   drop trigger trg_journal_has_lines         on public.journal_entries;
--   drop trigger trg_guard_posted_reservation_delete on public.reservations;
--   drop trigger trg_stamp_journal_source_* (١١ محفّزاً) ثم
--   alter table public.journal_entries drop column source_id;
--
-- يتطلب: 063 (حارس الفترات). آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- أ) source_id
-- ------------------------------------------------------------
alter table public.journal_entries add column if not exists source_id uuid;

comment on column public.journal_entries.source_id is
  'معرّف الصفّ في الجدول المسمّى في source. يُختم آلياً (sql/108). فارغ في القيد اليدوي.';

create index if not exists journal_entries_source_idx
  on public.journal_entries (source, source_id);

-- الختم: محفّز AFTER على جدول المصدر. المعامل الأول اسم عمود القيد.
create or replace function public.stamp_journal_source()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_col   text := tg_argv[0];
  v_entry uuid := (to_jsonb(new) ->> v_col)::uuid;
  v_old   uuid;
  v_sid   uuid := new.id;
begin
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_col)::uuid;
  end if;
  if v_entry is null or v_entry is not distinct from v_old then
    return null;
  end if;

  -- COMMIN يُسمّي sale_commissions مصدراً ويُحفظ على الحجز
  if tg_table_name = 'reservations' and v_col = 'commission_collect_entry_id' then
    select sc.id into v_sid from public.sale_commissions sc where sc.reservation_id = new.id;
  end if;

  update public.journal_entries
     set source_id = v_sid
   where id = v_entry and source_id is distinct from v_sid;
  return null;
end;
$fn$;

do $do$
declare r record;
begin
  for r in select * from (values
    ('cash_moves',        'journal_entry_id'),
    ('commissions',       'journal_entry_id'),
    ('payrolls',          'journal_entry_id'),
    ('payroll_payments',  'journal_entry_id'),
    ('external_debts',    'journal_entry_id'),
    ('debt_repayments',   'journal_entry_id'),
    ('inventory_moves',   'journal_entry_id'),
    ('broker_payments',   'journal_entry_id'),
    ('employee_advances', 'disburse_entry_id'),
    ('reservations',      'commission_accrual_entry_id'),
    ('reservations',      'commission_collect_entry_id')
  ) as t(tbl, col)
  loop
    execute format('drop trigger if exists %I on public.%I',
                   'trg_stamp_journal_source_' || r.col, r.tbl);
    execute format(
      'create trigger %I after insert or update of %I on public.%I
         for each row execute function public.stamp_journal_source(%L)',
      'trg_stamp_journal_source_' || r.col, r.col, r.tbl, r.col);
  end loop;
end
$do$;

-- ملء القائم: من كل جدول مصدر إلى قيده
update public.journal_entries e set source_id = x.sid
  from (
    select journal_entry_id je, id sid from public.cash_moves
    union all select journal_entry_id, id from public.commissions
    union all select journal_entry_id, id from public.payrolls
    union all select journal_entry_id, id from public.payroll_payments
    union all select journal_entry_id, id from public.external_debts
    union all select journal_entry_id, id from public.debt_repayments
    union all select journal_entry_id, id from public.inventory_moves
    union all select journal_entry_id, id from public.broker_payments
    union all select disburse_entry_id, id from public.employee_advances
    union all select commission_accrual_entry_id, id from public.reservations
    union all select r.commission_collect_entry_id, sc.id
                from public.reservations r
                join public.sale_commissions sc on sc.reservation_id = r.id
  ) x
 where x.je = e.id and e.source_id is distinct from x.sid;


-- ------------------------------------------------------------
-- ب) القيد الآلي لا يُمسّ من المتصفّح
-- ------------------------------------------------------------

create or replace function public.guard_auto_journal_entry()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- من PostgREST مباشرة؟ داخل دالّة security definer يصير current_user مالكها
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'القيد اليدوي يُسجَّل عبر post_manual_entry — لا كتابة مباشرة في دفتر القيود';
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'القيد لا يُعدَّل بعد ترحيله — صحّحه بقيد عكسي';
  end if;

  -- DELETE
  if old.source is not null then
    raise exception 'قيد آلي من % — لا يُحذف من دفتر القيود. افتح مصدره واحذفه أو اعكسه من هناك', old.source;
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_guard_auto_journal_entry on public.journal_entries;
create trigger trg_guard_auto_journal_entry
  before insert or update or delete on public.journal_entries
  for each row execute function public.guard_auto_journal_entry();

create or replace function public.guard_auto_journal_line()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- من PostgREST مباشرة؟ داخل دالّة security definer يصير current_user مالكها
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    -- حذف القيد اليدوي يحذف سطوره بالتتالي: الرأس ذهب قبلها فيمرّ
    if exists (select 1 from public.journal_entries e where e.id = old.entry_id) then
      raise exception 'سطور القيد لا تُحذف منفردة — احذف القيد كاملاً أو اعكسه';
    end if;
    return old;
  end if;

  raise exception 'سطور القيد تُكتب عبر post_manual_entry — لا كتابة مباشرة في دفتر القيود';
end;
$fn$;

drop trigger if exists trg_guard_auto_journal_line on public.journal_lines;
create trigger trg_guard_auto_journal_line
  before insert or update or delete on public.journal_lines
  for each row execute function public.guard_auto_journal_line();


-- ------------------------------------------------------------
-- ج) التوازن عند الـ commit
-- ------------------------------------------------------------
create or replace function public.check_journal_balance()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_entry uuid;
  v_d numeric; v_c numeric; v_n int;
begin
  foreach v_entry in array array_remove(array[
      case when tg_op <> 'INSERT' then old.entry_id end,
      case when tg_op <> 'DELETE' then new.entry_id end], null)
  loop
    -- القيد حُذف كاملاً: لا شيء يُفحص
    continue when not exists (select 1 from public.journal_entries where id = v_entry);

    select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
      into v_d, v_c, v_n
      from public.journal_lines where entry_id = v_entry;

    if v_d <> v_c then
      raise exception 'قيد غير متوازن: المدين % والدائن % (القيد %)', v_d, v_c, v_entry
        using errcode = 'check_violation';
    end if;
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_journal_balance on public.journal_lines;
create constraint trigger trg_journal_balance
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.check_journal_balance();

create or replace function public.check_journal_has_lines()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not exists (select 1 from public.journal_entries where id = new.id) then
    return null;
  end if;
  select count(*) into v_n from public.journal_lines where entry_id = new.id;
  if v_n < 2 then
    raise exception 'قيد بلا سطور كافية (% سطر) — القيد يحتاج مديناً ودائناً', v_n
      using errcode = 'check_violation';
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_journal_has_lines on public.journal_entries;
create constraint trigger trg_journal_has_lines
  after insert on public.journal_entries
  deferrable initially deferred
  for each row execute function public.check_journal_has_lines();


-- ------------------------------------------------------------
-- د) الحجز المُرحَّل لا يُحذف
-- ------------------------------------------------------------
create or replace function public.guard_posted_reservation_delete()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if old.commission_accrual_entry_id is not null
     or old.commission_collect_entry_id is not null then
    raise exception 'لهذا الحجز قيد عمولة في الدفاتر — لا يُحذف. استعمل «فسخ البيع» ليُعكس قيده وتُعالج عمولة الموظف';
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_guard_posted_reservation_delete on public.reservations;
create trigger trg_guard_posted_reservation_delete
  before delete on public.reservations
  for each row execute function public.guard_posted_reservation_delete();


revoke execute on function public.stamp_journal_source()          from public, anon, authenticated;
revoke execute on function public.check_journal_balance()         from public, anon, authenticated;
revoke execute on function public.check_journal_has_lines()       from public, anon, authenticated;
revoke execute on function public.guard_auto_journal_entry()      from public, anon, authenticated;
revoke execute on function public.guard_auto_journal_line()       from public, anon, authenticated;
revoke execute on function public.guard_posted_reservation_delete() from public, anon, authenticated;

notify pgrst, 'reload schema';
