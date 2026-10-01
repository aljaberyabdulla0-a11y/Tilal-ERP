-- ============================================================
-- تلال ERP — 114: صحّة المحاسبة — كشف المشاكل القائمة بالخطورة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- القيد اليتيم للوحدة 75 (1,929,500 إيراداً لا صفقة وراءه) بقي ثلاثة
-- أيام لا يراه أحد: الميزان متوازن، والملخّص يعرض الرقم كأنه صحيح.
-- التوازن وحده لا يكشف الخطأ — المطابقة بين الدفتر ومصادره تكشفه.
--
-- ===== ما يضيفه =====
--
--   accounting_health() — صفّ لكل مشكلة قائمة، بخطورتها ورابطها:
--
--   حرج     JRN_UNBALANCED     قيد مدينه ≠ دائنه
--           JRN_FEW_LINES      قيد بأقلّ من سطرين
--           JRN_ORPHAN         قيد آلي لا يشير إليه أي صفّ مصدر
--           SRC_NO_JOURNAL     صفّ مالي بلا قيد (حركة، عمولة، كشف معتمد،
--                              دفعة، دين، شراء، سلفة مصروفة، مقدمة مؤكَّدة…)
--   عالٍ    SUB_1250           رصيد 1250 ≠ مجموع عمولات الصفقات المؤكَّدة
--                              غير المحصّلة وغير المفسوخة
--           COMM_ORPHAN        عمولة موظف آلية لا صفقة تشير إليها
--           PAYROLL_DUP        حركة 5100 تشبه دفع كشفٍ معتمد (110)
--           NEG_CASH           رصيد صندوق أو بنك سالب
--   متوسط   PAYROLL_UNPAID     كشف معتمد لم يُدفع بعد ٤٥ يوماً من شهره
--           PAYROLL_DATE       قيد استحقاق الكشف بتاريخ خارج شهره
--           DEV_NO_INVOICE     صفقة مؤكَّدة بلا فاتورة مطوّر سارية
--           COMM_AGED          عمولة على المطوّر غير محصّلة > ٩٠ يوماً
--           INACTIVE_ACCOUNT   سطور على حساب غير نشط (4100، 2400)
--           NO_SOURCE_ID       قيد آلي بلا source_id
--           NO_REFERENCE       قيد بلا reference
--   منخفض   PERIOD_OPEN        شهر انتهى وفيه قيود ولم يُقفل
--           PAYROLL_DRAFT_OLD  كشف مسوّدة لشهر انتهى
--           BANK_UNMATCHED     سطر كشف بنك غير مطابق
--
-- للمدير والمحاسب. للقراءة فقط — لا يصلح شيئاً.
--
-- يتطلب: 108 (source_id)، 110 (payroll_reconciliation)، 113 (commission_reversal_entry_id). آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.accounting_health()
returns table (
  severity   text,      -- حرج | عالٍ | متوسط | منخفض
  rank       int,       -- 1..4 للترتيب
  check_code text,
  title      text,
  detail     text,
  amount     numeric,
  ref_table  text,
  ref_id     uuid,
  ref_date   date,
  link       text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_month text := to_char((now() at time zone 'Asia/Baghdad')::date, 'YYYY-MM');
  v_1250_book numeric; v_1250_sub numeric;
begin
  if not public.can_manage_finance() then
    raise exception 'صحّة المحاسبة للمدير أو المحاسب';
  end if;

  -- ===== حرج =====

  return query
  select 'حرج', 1, 'JRN_UNBALANCED', 'قيد غير متوازن',
         'المدين ' || sum(l.debit) || ' والدائن ' || sum(l.credit) || ' — ' || e.description,
         abs(sum(l.debit) - sum(l.credit)), 'journal_entries', e.id, e.entry_date,
         '/dashboard/accounting/entries/' || e.id
    from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
   group by e.id having sum(l.debit) <> sum(l.credit);

  return query
  select 'حرج', 1, 'JRN_FEW_LINES', 'قيد بلا سطور كافية',
         count(l.id) || ' سطر — ' || e.description, null::numeric,
         'journal_entries', e.id, e.entry_date, '/dashboard/accounting/entries/' || e.id
    from public.journal_entries e left join public.journal_lines l on l.entry_id = e.id
   group by e.id having count(l.id) < 2;

  return query
  with refs as (
    select journal_entry_id je from public.cash_moves
    union all select journal_entry_id from public.commissions
    union all select journal_entry_id from public.payrolls
    union all select journal_entry_id from public.payroll_payments
    union all select journal_entry_id from public.external_debts
    union all select journal_entry_id from public.debt_repayments
    union all select journal_entry_id from public.inventory_moves
    union all select journal_entry_id from public.broker_payments
    union all select disburse_entry_id from public.employee_advances
    union all select commission_accrual_entry_id from public.reservations
    union all select commission_collect_entry_id from public.reservations
    union all select commission_reversal_entry_id from public.reservations
  )
  select 'حرج', 1, 'JRN_ORPHAN', 'قيد آلي بلا مصدر',
         e.reference || ' من ' || e.source || ' — ' || e.description
           || ' — صفّه المصدر حُذف أو انفصل عنه، والقيد ما زال في الأرقام',
         (select sum(l.debit) from public.journal_lines l where l.entry_id = e.id),
         'journal_entries', e.id, e.entry_date, '/dashboard/accounting/entries/' || e.id
    from public.journal_entries e
   where e.source is not null
     and not exists (select 1 from refs r where r.je = e.id);

  return query
  select 'حرج', 1, 'SRC_NO_JOURNAL', x.t, x.d, x.amt, x.tbl, x.id, x.dt, x.lnk
    from (
      select 'حركة نقدية بلا قيد' t, c.description d, c.amount amt, 'cash_moves' tbl, c.id, c.move_date dt,
             '/dashboard/accounting/moves' lnk
        from public.cash_moves c where c.journal_entry_id is null
      union all
      select 'عمولة موظف بلا قيد', coalesce(c.description, ''), c.amount, 'commissions', c.id, c.comm_date,
             '/dashboard/commissions'
        from public.commissions c where c.journal_entry_id is null and c.amount > 0
      union all
      select 'كشف معتمد بلا قيد', 'كشف ' || p.period, p.net, 'payrolls', p.id,
             (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
             '/dashboard/hr/payroll/' || p.id
        from public.payrolls p
       where p.state <> 'مسودة' and p.journal_entry_id is null
         and coalesce(p.basic, 0) + coalesce(p.allowances, 0) > 0
      union all
      select 'دفعة راتب بلا قيد', coalesce(pp.notes, ''), pp.amount, 'payroll_payments', pp.id, pp.pay_date,
             '/dashboard/hr/payroll/' || pp.payroll_id
        from public.payroll_payments pp where pp.journal_entry_id is null
      union all
      select 'دين خارجي بلا قيد', d.person_name, d.amount, 'external_debts', d.id, d.debt_date,
             '/dashboard/accounting/debts'
        from public.external_debts d where d.journal_entry_id is null
      union all
      select 'استحصال دين بلا قيد', coalesce(r.note, ''), r.amount, 'debt_repayments', r.id, r.pay_date,
             '/dashboard/accounting/debts'
        from public.debt_repayments r where r.journal_entry_id is null
      union all
      select 'شراء مخزون بلا قيد', coalesce(m.notes, ''), m.total_price, 'inventory_moves', m.id, m.moved_at::date,
             '/dashboard/inventory/moves'
        from public.inventory_moves m
       where m.kind = 'شراء' and coalesce(m.total_price, 0) > 0 and m.journal_entry_id is null
      union all
      select 'دفعة وسيط بلا قيد', coalesce(b.notes, ''), b.amount, 'broker_payments', b.id, b.payment_date,
             '/dashboard/brokers/commissions'
        from public.broker_payments b where b.journal_entry_id is null
      union all
      select 'سلفة مصروفة بلا قيد', coalesce(a.reason, ''), a.amount, 'employee_advances', a.id, a.disbursed_at,
             '/dashboard/hr/payroll'
        from public.employee_advances a
       where a.status in ('مصروفة', 'مسدَّدة') and a.disburse_entry_id is null
      union all
      select 'مقدمة مؤكَّدة بلا قيد استحقاق', 'عمولة تلال ' || sc.company_amount, sc.company_amount,
             'reservations', r.id, r.down_payment_confirmed_at::date, '/dashboard/units/' || r.unit_id
        from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
       where r.down_payment_confirmed_at is not null and r.commission_accrual_entry_id is null
         and coalesce(sc.company_amount, 0) > 0 and sc.reversed_at is null
      union all
      select 'تحصيل عمولة بلا قيد', 'عمولة تلال ' || sc.company_amount, sc.company_amount,
             'sale_commissions', sc.id, sc.collected_at::date, '/dashboard/units/' || r.unit_id
        from public.sale_commissions sc join public.reservations r on r.id = sc.reservation_id
       where sc.collected_at is not null and r.commission_collect_entry_id is null
    ) x;

  -- ===== عالٍ =====

  select coalesce(sum(l.debit - l.credit), 0) into v_1250_book
    from public.journal_lines l join public.accounts a on a.id = l.account_id where a.code = '1250';
  select coalesce(sum(sc.company_amount), 0) into v_1250_sub
    from public.sale_commissions sc join public.reservations r on r.id = sc.reservation_id
   where r.commission_accrual_entry_id is not null
     and sc.collected_at is null and sc.reversed_at is null;

  if abs(v_1250_book - v_1250_sub) > 0.01 then
    return query select 'عالٍ', 2, 'SUB_1250', 'ذمم المطوّرين لا تطابق صفقاتها',
      'رصيد 1250 في الدفتر ' || v_1250_book || ' ومجموع عمولات الصفقات المؤكَّدة غير المحصّلة '
        || v_1250_sub || ' — الفرق إيرادٌ في 4200 لا صفقة وراءه أو صفقة بلا قيد',
      v_1250_book - v_1250_sub, 'accounts', null::uuid, v_today,
      '/dashboard/accounting/reports/trial-balance';
  end if;

  return query
  select 'عالٍ', 2, 'COMM_ORPHAN', 'عمولة موظف بلا صفقة',
         coalesce(c.description, '') || ' — مصروفها في 5500 ودَينها في 2300 ولا صفقة تشير إليها',
         c.amount, 'commissions', c.id, c.comm_date, '/dashboard/commissions'
    from public.commissions c
   where c.auto and c.payroll_id is null
     and not exists (select 1 from public.sale_commissions sc where sc.commission_id = c.id);

  return query
  select 'عالٍ', 2, 'PAYROLL_DUP', 'راتب قد يكون مسجّلاً مرتين',
         pr.employee_name || ' — ' || pr.label || ' — ' || pr.reason,
         pr.amount, 'cash_moves', pr.ref_id, pr.ref_date, '/dashboard/accounting/reconciliation/payroll'
    from public.payroll_reconciliation(null, null) pr
   where pr.side = 'حركة' and pr.classification = 'تكرار محتمل';

  return query
  select 'عالٍ', 2, 'NEG_CASH', 'رصيد نقدي سالب', a.code || ' — ' || a.name,
         sum(l.debit - l.credit), 'accounts', a.id, v_today,
         '/dashboard/accounting/ledger/' || a.code
    from public.accounts a join public.journal_lines l on l.account_id = a.id
   where a.code in ('1100', '1200')
   group by a.id having sum(l.debit - l.credit) < -0.01;

  -- ===== متوسط =====

  return query
  select 'متوسط', 3, 'PAYROLL_UNPAID', 'كشف معتمد لم يُدفع',
         e.full_name || ' — كشف ' || p.period || ' — المتبقّي '
           || (p.net - coalesce((select sum(pp.amount) from public.payroll_payments pp where pp.payroll_id = p.id), 0))
           || ' في 2300. إن دُفع خارج النظام فسجّل دفعته من الكشف',
         p.net - coalesce((select sum(pp.amount) from public.payroll_payments pp where pp.payroll_id = p.id), 0),
         'payrolls', p.id, (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
         '/dashboard/hr/payroll/' || p.id
    from public.payrolls p join public.employees e on e.id = p.employee_id
   where p.state <> 'مسودة' and p.status <> 'مدفوع'
     and (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date + 45 < v_today;

  return query
  select 'متوسط', 3, 'PAYROLL_DATE', 'استحقاق الكشف خارج شهره',
         'كشف ' || p.period || ' مُرحَّل بتاريخ ' || je.entry_date
           || ' — مصروف الشهر يظهر في شهرٍ آخر في التقارير بفترة',
         null::numeric, 'payrolls', p.id, je.entry_date, '/dashboard/hr/payroll/' || p.id
    from public.payrolls p join public.journal_entries je on je.id = p.journal_entry_id
   where to_char(je.entry_date, 'YYYY-MM') <> p.period;

  return query
  select 'متوسط', 3, 'DEV_NO_INVOICE', 'صفقة مؤكَّدة بلا فاتورة مطوّر',
         'عمولة تلال ' || sc.company_amount || ' — لا تُحصَّل قبل إصدار فاتورة (103)',
         sc.company_amount, 'reservations', r.id, r.down_payment_confirmed_at::date,
         '/dashboard/units/' || r.unit_id
    from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
   where r.down_payment_confirmed_at is not null and sc.collected_at is null and sc.reversed_at is null
     and not exists (select 1 from public.developer_invoices di
                      where di.reservation_id = r.id and di.cancelled_at is null);

  return query
  select 'متوسط', 3, 'COMM_AGED', 'عمولة على المطوّر متأخّرة',
         'عمولة ' || sc.company_amount || ' مؤكَّدة منذ ' || (v_today - r.down_payment_confirmed_at::date) || ' يوماً',
         sc.company_amount, 'reservations', r.id, r.down_payment_confirmed_at::date,
         '/dashboard/units/' || r.unit_id
    from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
   where r.down_payment_confirmed_at is not null and sc.collected_at is null and sc.reversed_at is null
     and r.down_payment_confirmed_at::date + 90 < v_today;

  return query
  select 'متوسط', 3, 'INACTIVE_ACCOUNT', 'سطور على حساب غير نشط',
         a.code || ' — ' || a.name || ': ' || count(*) || ' سطر', sum(l.debit + l.credit),
         'accounts', a.id, max(e.entry_date), '/dashboard/accounting/ledger/' || a.code
    from public.journal_lines l join public.accounts a on a.id = l.account_id
    join public.journal_entries e on e.id = l.entry_id
   where not a.is_active group by a.id;

  return query
  select 'متوسط', 3, 'NO_SOURCE_ID', 'قيد آلي بلا معرّف مصدر',
         e.reference || ' من ' || e.source || ' — ' || e.description, null::numeric,
         'journal_entries', e.id, e.entry_date, '/dashboard/accounting/entries/' || e.id
    from public.journal_entries e where e.source is not null and e.source_id is null;

  return query
  select 'متوسط', 3, 'NO_REFERENCE', 'قيد بلا رمز مرجع', e.description, null::numeric,
         'journal_entries', e.id, e.entry_date, '/dashboard/accounting/entries/' || e.id
    from public.journal_entries e where e.reference is null;

  -- ===== منخفض =====

  return query
  select 'منخفض', 4, 'PERIOD_OPEN', 'شهر انتهى ولم يُقفل',
         m.k || ' — ' || m.n || ' قيداً', null::numeric, 'accounting_periods', null::uuid,
         (to_date(m.k || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
         '/dashboard/accounting/periods'
    from (select to_char(e.entry_date, 'YYYY-MM') k, count(*) n
            from public.journal_entries e group by 1) m
   where m.k < v_month
     and not exists (select 1 from public.accounting_periods ap
                      where ap.period = m.k and ap.status <> 'مفتوح');

  return query
  select 'منخفض', 4, 'PAYROLL_DRAFT_OLD', 'كشف مسوّدة لشهر انتهى',
         e.full_name || ' — كشف ' || p.period, p.net, 'payrolls', p.id,
         (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
         '/dashboard/hr/payroll/' || p.id
    from public.payrolls p join public.employees e on e.id = p.employee_id
   where p.state = 'مسودة' and p.period < v_month;

  return query
  select 'منخفض', 4, 'BANK_UNMATCHED', 'سطر بنك غير مطابق',
         b.description, b.amount, 'bank_statement_lines', b.id, b.stmt_date, '/dashboard/accounting'
    from public.bank_statement_lines b where b.matched_at is null;
end;
$fn$;

comment on function public.accounting_health() is
  'كل مشكلة محاسبية قائمة بخطورتها ورابطها: توازن، أيتام، مصادر بلا قيد، ذمم لا تطابق، تكرار رواتب، فترات (sql/114).';

revoke execute on function public.accounting_health() from public, anon;
grant  execute on function public.accounting_health() to authenticated;

notify pgrst, 'reload schema';
