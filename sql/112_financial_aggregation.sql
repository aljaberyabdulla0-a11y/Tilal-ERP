-- ============================================================
-- تلال ERP — 112: محرّك الأرقام في القاعدة — أرصدة بفترة، وملخّص، وكشف حساب
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- getLedgerRows() و getAccountBalances() تجلبان كل journal_lines إلى
-- الخادم وتجمعانها في TypeScript. حدّ PostgREST ١٠٠٠ صفّ: بعده تنقص
-- أرقام الملخّص والميزان والميزانية **بصمت**. اليوم ١٣٤ سطراً — قنبلة
-- موقوتة لا عطلٌ ظاهر. ولا تقرير يقبل فترة: الدخل والميزان على كل
-- الزمن، و«هذا الشهر» بتوقيت الخادم (UTC) لا بغداد.
--
-- ===== ما يضيفه =====
--
--   account_balances(from, to)
--     لكل حساب: رصيد افتتاحي (قبل from)، ومدين ودائن الفترة، ورصيد
--     ختامي (حتى to). فارغان = كل الزمن. يخدم ميزان المراجعة وقائمة
--     الدخل (حركة الفترة) والميزانية (الختامي حتى تاريخ).
--
--   money_overview(today)
--     الملخّص المالي كاملاً كائن jsonb واحد — لا صفوف، فلا حدّ.
--     «الشهر» وآخر ٦ أشهر بتوقيت بغداد.
--
--   account_ledger(code, from, to, limit, offset)
--     كشف حساب: سطوره بقيودها ومصدرها ورصيد جارٍ — النزول من رقم
--     الميزان إلى القيد ثم إلى مصدره.
--
-- كلها للمدير والمحاسب (can_manage_finance)، وللقراءة فقط.
--
-- يتطلب: 068، 108 (source_id). آمن لإعادة التشغيل.
-- ============================================================

create index if not exists journal_lines_account_idx on public.journal_lines (account_id);
create index if not exists journal_lines_entry_idx   on public.journal_lines (entry_id);
create index if not exists journal_entries_date_idx  on public.journal_entries (entry_date);


create or replace function public.account_balances(
  p_from date default null,
  p_to   date default null
)
returns table (
  account_id uuid, code text, name text, type text, is_active boolean,
  opening numeric, debit numeric, credit numeric, closing numeric
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_manage_finance() then
    raise exception 'أرصدة الحسابات للمدير أو المحاسب';
  end if;

  return query
  select a.id, a.code, a.name, a.type, a.is_active,
         coalesce(sum(l.debit - l.credit)
                    filter (where p_from is not null and e.entry_date < p_from), 0),
         coalesce(sum(l.debit)
                    filter (where (p_from is null or e.entry_date >= p_from)
                              and (p_to   is null or e.entry_date <= p_to)), 0),
         coalesce(sum(l.credit)
                    filter (where (p_from is null or e.entry_date >= p_from)
                              and (p_to   is null or e.entry_date <= p_to)), 0),
         coalesce(sum(l.debit - l.credit)
                    filter (where p_to is null or e.entry_date <= p_to), 0)
    from public.accounts a
    left join public.journal_lines   l on l.account_id = a.id
    left join public.journal_entries e on e.id = l.entry_id
   group by a.id
   order by a.code;
end;
$fn$;

comment on function public.account_balances(date, date) is
  'لكل حساب: افتتاحي قبل from، ومدين/دائن الفترة، وختامي حتى to. فارغان = كل الزمن (sql/112).';


create or replace function public.money_overview(p_today date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Baghdad')::date);
  v_month text := to_char(v_today, 'YYYY-MM');
  v_out   jsonb;
begin
  if not public.can_manage_finance() then
    raise exception 'الملخّص المالي للمدير أو المحاسب';
  end if;

  with r as (
    select a.code, a.name, a.type, to_char(e.entry_date, 'YYYY-MM') m,
           coalesce(e.arm, 'غير محدّد') arm, l.debit, l.credit
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      join public.accounts a        on a.id = l.account_id
  ),
  months as (
    select to_char(date_trunc('month', v_today) - make_interval(months => g), 'YYYY-MM') k
      from generate_series(0, 5) g
  )
  select jsonb_build_object(
    'cash',            coalesce(sum(r.debit - r.credit) filter (where r.code in ('1100','1200')), 0),
    'income',          coalesce(sum(r.credit - r.debit) filter (where r.type = 'revenue'), 0),
    'expense',         coalesce(sum(r.debit - r.credit) filter (where r.type = 'expense'), 0),
    'payrollDue',      coalesce(sum(r.credit - r.debit) filter (where r.code = '2300'), 0),
    'partnerDue',      coalesce(sum(r.credit - r.debit) filter (where r.code = '2500'), 0),
    'externalDebtDue', coalesce(sum(r.debit - r.credit) filter (where r.code = '1350'), 0),
    'developerDue',    coalesce(sum(r.debit - r.credit) filter (where r.code = '1250'), 0),
    'monthIncome',     coalesce(sum(r.credit - r.debit) filter (where r.type = 'revenue' and r.m = v_month), 0),
    'monthExpense',    coalesce(sum(r.debit - r.credit) filter (where r.type = 'expense' and r.m = v_month), 0),
    'month',           v_month,
    'byCategory', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.name, 'amount', x.amt) order by x.amt desc)
        from (select r2.name, sum(r2.debit - r2.credit) amt from r r2
               where r2.type = 'expense' group by r2.name
              having abs(sum(r2.debit - r2.credit)) > 0.009) x), '[]'::jsonb),
    'byArm', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.arm, 'amount', x.amt) order by x.amt desc)
        from (select r2.arm, sum(r2.debit - r2.credit) amt from r r2
               where r2.type = 'expense' group by r2.arm
              having abs(sum(r2.debit - r2.credit)) > 0.009) x), '[]'::jsonb),
    'months', (
      select jsonb_agg(jsonb_build_object(
               'key', mo.k,
               'income',  coalesce((select sum(r2.credit - r2.debit) from r r2
                                     where r2.type = 'revenue' and r2.m = mo.k), 0),
               'expense', coalesce((select sum(r2.debit - r2.credit) from r r2
                                     where r2.type = 'expense' and r2.m = mo.k), 0))
             order by mo.k)
        from months mo)
  ) into v_out
  from r;

  return v_out;
end;
$fn$;

comment on function public.money_overview(date) is
  'الملخّص المالي كائناً واحداً من الدفتر: النقد والالتزامات والدخل والصرف وتجميعاتها وآخر ٦ أشهر بتوقيت بغداد (sql/112).';


create or replace function public.account_ledger(
  p_code   text,
  p_from   date default null,
  p_to     date default null,
  p_limit  int  default 500,
  p_offset int  default 0
)
returns table (
  line_id uuid, entry_id uuid, entry_date date, description text, reference text,
  source text, source_id uuid, arm text, line_note text,
  debit numeric, credit numeric, running numeric, created_by_name text
)
language plpgsql stable security definer set search_path = public as $fn$
declare v_acc uuid; v_open numeric;
begin
  if not public.can_manage_finance() then
    raise exception 'كشف الحساب للمدير أو المحاسب';
  end if;
  select id into v_acc from public.accounts where code = p_code;
  if v_acc is null then raise exception 'الحساب % غير موجود', p_code; end if;

  select coalesce(sum(l.debit - l.credit), 0) into v_open
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
   where l.account_id = v_acc and p_from is not null and e.entry_date < p_from;

  return query
  select x.id, x.entry_id, x.entry_date, x.description, x.reference, x.source, x.source_id,
         x.arm, x.line_note, x.debit, x.credit,
         v_open + sum(x.debit - x.credit) over (order by x.entry_date, x.created_at, x.id),
         x.who
    from (
      select l.id, l.entry_id, e.entry_date, e.description, e.reference, e.source, e.source_id,
             e.arm, l.line_note, l.debit, l.credit, e.created_at,
             (select coalesce(em.full_name, p.email) from public.profiles p
                left join public.employees em on em.user_id = p.id
               where p.id = e.created_by) who
        from public.journal_lines l
        join public.journal_entries e on e.id = l.entry_id
       where l.account_id = v_acc
         and (p_from is null or e.entry_date >= p_from)
         and (p_to   is null or e.entry_date <= p_to)
    ) x
   order by x.entry_date, x.created_at, x.id
   limit greatest(coalesce(p_limit, 500), 1) offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

comment on function public.account_ledger(text, date, date, int, int) is
  'كشف حساب: سطوره بقيودها ومصدرها ورصيد جارٍ يبدأ من الافتتاحي (sql/112).';

revoke execute on function public.account_balances(date, date)              from public, anon;
revoke execute on function public.money_overview(date)                     from public, anon;
revoke execute on function public.account_ledger(text, date, date, int, int) from public, anon;
grant  execute on function public.account_balances(date, date)              to authenticated;
grant  execute on function public.money_overview(date)                     to authenticated;
grant  execute on function public.account_ledger(text, date, date, int, int) to authenticated;

notify pgrst, 'reload schema';
