-- ============================================================
-- تلال ERP — 067: إغلاق الشهر، والأهداف، ومطابقة البنك (المرحلة ٧ و٦)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ثلاثة أبواب في هجرة واحدة لأنها كلّها **قراءات وأدوات تشغيل**
-- لا تغيّر منطقاً محاسبياً قائماً ولا تكتب قيداً جديداً بنفسها.
--
-- ============================================================
-- ١) معالج إغلاق الشهر
--
-- كان إغلاق الشهر: افتح ملفّ كل موظف، ابنِ كشفه، راجعه، اعتمده.
-- ثمانية موظفين = ثمانٍ وعشرون نقرة وأربع شاشات، وفرصةٌ لنسيان واحد.
--
-- صار: بناءٌ جماعي، ثم **جدول مراجعة يؤشّر الشاذّ**، ثم اعتماد
-- دفعة واحدة. والشاذّ يُؤشَّر ولا يُمنع — القرار للمدير:
--   • لا كشف · بلا بنود
--   • صافٍ صفر أو سالب        (يمنع الاعتماد أصلاً)
--   • سجلّ دوام مفتوح          (يمنع الاعتماد أصلاً)
--   • غياب مرتفع (٥ أيام فأكثر)
--   • عمولة تفوق ضعف الراتب    (تُراجَع لا تُرفض)
--
-- ⚠️ الاعتماد الجماعي يمرّ بـ approve_payroll نفسها لكل كشف: كل
--    حرّاسها تعمل ولا يُختصر شيء. وما يفشل يُجمَع في تقرير ولا
--    يُوقف البقيّة.
--
-- ⚠️ درسان تعلَّمناهما بالخطأ أثناء كتابة هذا الملف:
--   • أسماء معاملات الإخراج (employee_id · payroll_id · net · state)
--     تطابق أعمدة الجداول المستعلَمة، فيلزم اسمٌ مستعار لكل جدول
--     داخلي وإلا رفضت القاعدة الالتباس. نفس ما وقع مع work_date
--     في sql/060 — وهو صنف خطأ يتكرّر في دوالّ returns table.
--   • تسلسلُ نصٍّ إلى مصفوفة بـ || ملتبس: بوستكرس يحاول تفسير
--     السلسلة مصفوفةً ويفشل. الصواب array_append(arr, 'نص'::text).
--
-- ============================================================
-- ٢) أهداف الموظفين — بنية بلا أرقام
--    الأرقام يضعها المالك. الجدول والمقارنة جاهزان.
--
-- ============================================================
-- ٣) مطابقة البنك
--
-- سطور كشف الحساب تُستورد، ثم تُطابَق يدوياً أو باقتراح آلي مع
-- حركات النظام (cash_moves ودفعات الرواتب). ورصيد 1200 يصير
-- **مطابَقاً لا إنشائياً**: ما لم يُطابَق يظهر فرقاً يُسأل عنه.
--
-- ⚠️ المطابقة **لا تكتب قيداً**. سطر بنك بلا مقابل يعني حركةً
--    ناقصة في النظام يسجّلها المدير بنفسه — لا يخترعها المطابِق.
--
-- ===== التراجع ===== drop function / drop table — بلا أثر محاسبي.
--
-- طُبّق على القاعدة في 2026-09-05 عبر ثلاث هجرات:
--   month_close_targets_bank
--   fix_month_close_ambiguous_columns
--   fix_month_close_array_append
--
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- ١) إغلاق الشهر
-- ------------------------------------------------------------
create or replace function public.month_close_overview(p_period text)
returns table (
  employee_id uuid, full_name text, payroll_id uuid, state text,
  basic numeric, commissions numeric, deductions numeric, net numeric,
  lines int, absent_days int, open_attendance date, flags text[]
)
language plpgsql stable security definer set search_path = public
as $fn$
declare e record; p public.payrolls%rowtype; v_flags text[]; v_abs int; v_open date; v_lines int;
begin
  if not public.is_admin() then raise exception 'إغلاق الشهر للمدير'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'صيغة الشهر YYYY-MM'; end if;

  for e in select * from public.employees emp
            where emp.status = 'active'
              and (emp.end_date is null or to_char(emp.end_date,'YYYY-MM') >= p_period)
            order by emp.full_name
  loop
    v_flags := array[]::text[];
    p := null;

    select pr.* into p from public.payrolls pr
     where pr.employee_id = e.id and pr.period = p_period;

    select count(*) into v_lines from public.payroll_lines pl where pl.payroll_id = p.id;
    select count(*) into v_abs   from public.payroll_lines pl
     where pl.payroll_id = p.id and pl.category = 'غياب';

    select a.work_date into v_open from public.attendance a
     where a.employee_id = e.id and to_char(a.work_date,'YYYY-MM') = p_period
       and a.check_in is not null and a.check_out is null
     order by a.work_date limit 1;

    if p.id is null then
      v_flags := array_append(v_flags, 'لا كشف'::text);
    else
      if v_lines = 0 then
        v_flags := array_append(v_flags, 'بلا بنود'::text);
      end if;
      if coalesce(p.net,0) <= 0 then
        v_flags := array_append(v_flags, 'صافٍ صفر أو سالب'::text);
      end if;
      if v_abs >= 5 then
        v_flags := array_append(v_flags, ('غياب مرتفع: ' || v_abs || ' يوم')::text);
      end if;
      if coalesce(p.commissions_total,0) > coalesce(p.basic,0) * 2
         and coalesce(p.basic,0) > 0 then
        v_flags := array_append(v_flags, 'عمولة غير معتادة'::text);
      end if;
    end if;
    if v_open is not null then
      v_flags := array_append(v_flags, ('دوام مفتوح ' || to_char(v_open,'MM-DD'))::text);
    end if;

    employee_id := e.id;  full_name := e.full_name;  payroll_id := p.id;
    state := coalesce(p.state, '—');
    basic := coalesce(p.basic,0);  commissions := coalesce(p.commissions_total,0);
    deductions := coalesce(p.deductions_total,0);  net := coalesce(p.net,0);
    lines := coalesce(v_lines,0);  absent_days := coalesce(v_abs,0);
    open_attendance := v_open;  flags := v_flags;
    return next;
  end loop;
end;
$fn$;

-- بناءٌ جماعي: ما يفشل يُجمَع ولا يُوقف البقيّة
create or replace function public.build_all_payrolls(p_period text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare e record; v_ok int := 0; v_skip int := 0; v_err text[] := array[]::text[];
begin
  if not public.is_admin() then raise exception 'بناء كشوف الشهر للمدير'; end if;

  for e in select emp.* from public.employees emp
            where emp.status = 'active'
              and (emp.end_date is null or to_char(emp.end_date,'YYYY-MM') >= p_period)
            order by emp.full_name
  loop
    begin
      perform public.build_payroll(e.id, p_period);
      v_ok := v_ok + 1;
    exception when others then
      v_skip := v_skip + 1;
      v_err := array_append(v_err, (e.full_name || ': ' || sqlerrm)::text);
    end;
  end loop;

  return jsonb_build_object('built', v_ok, 'skipped', v_skip, 'errors', to_jsonb(v_err));
end;
$fn$;

create or replace function public.approve_all_payrolls(p_period text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare p record; v_ok int := 0; v_skip int := 0; v_err text[] := array[]::text[];
begin
  if not public.is_admin() then raise exception 'اعتماد كشوف الشهر للمدير'; end if;

  for p in select pr.id, e.full_name from public.payrolls pr
            join public.employees e on e.id = pr.employee_id
           where pr.period = p_period and pr.state = 'مسودة'
           order by e.full_name
  loop
    begin
      perform public.approve_payroll(p.id);
      v_ok := v_ok + 1;
    exception when others then
      v_skip := v_skip + 1;
      v_err := array_append(v_err, (p.full_name || ': ' || sqlerrm)::text);
    end;
  end loop;

  return jsonb_build_object('approved', v_ok, 'failed', v_skip, 'errors', to_jsonb(v_err));
end;
$fn$;


-- ------------------------------------------------------------
-- ٢) الأهداف
-- ------------------------------------------------------------
create table if not exists public.employee_targets (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
  target_deals  int,
  target_amount numeric,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  constraint employee_targets_uniq unique (employee_id, period)
);

comment on table public.employee_targets is
  'أهداف الموظف — شهرية (YYYY-MM) أو سنوية (YYYY). الأرقام يضعها المالك (sql/067).';

create or replace function public.target_progress(p_period text)
returns table (
  employee_id uuid, full_name text, target_deals int, target_amount numeric,
  actual_deals int, actual_amount numeric, pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'تقرير الأهداف للمدير'; end if;

  return query
  select e.id, e.full_name, t.target_deals, t.target_amount,
         coalesce(a.n, 0), coalesce(a.amt, 0),
         case when coalesce(t.target_amount,0) > 0
              then round(coalesce(a.amt,0) * 100 / t.target_amount, 1) else null end
    from public.employees e
    left join public.employee_targets t
      on t.employee_id = e.id and (t.period = p_period or t.period = left(p_period,4))
    left join (
      select sc.employee_id as eid, count(*)::int as n, sum(sc.deal_amount) as amt
        from public.sale_commissions sc
        join public.reservations r on r.id = sc.reservation_id
       where sc.reversed_at is null and r.down_payment_confirmed_at is not null
         and to_char((r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date,'YYYY-MM')
             between (case when length(p_period)=7 then p_period else left(p_period,4)||'-01' end)
                 and (case when length(p_period)=7 then p_period else left(p_period,4)||'-12' end)
       group by sc.employee_id
    ) a on a.eid = e.id
   where e.status = 'active'
   order by 6 desc nulls last;
end;
$fn$;


-- ------------------------------------------------------------
-- ٣) مطابقة البنك
-- ------------------------------------------------------------
create table if not exists public.bank_statement_lines (
  id           uuid primary key default gen_random_uuid(),
  stmt_date    date not null,
  description  text,
  reference    text,
  amount       numeric not null check (amount > 0),
  direction    text not null check (direction in ('وارد', 'صادر')),
  matched_type text check (matched_type in ('cash_moves', 'payroll_payments', 'يدوي')),
  matched_id   uuid,
  matched_at   timestamptz,
  matched_by   uuid references auth.users(id) on delete set null,
  note         text,
  imported_at  timestamptz not null default now(),
  imported_by  uuid references auth.users(id) on delete set null
);

create index if not exists bank_lines_unmatched
  on public.bank_statement_lines (stmt_date) where matched_at is null;

comment on table public.bank_statement_lines is
  'سطور كشف الحساب المصرفي. المطابقة لا تكتب قيداً — سطرٌ بلا مقابل يعني حركة ناقصة يسجّلها المدير (sql/067).';

-- اقتراح المقابل: نفس المبلغ، واتجاهٌ موافق، وتاريخٌ ضمن أسبوع
create or replace function public.suggest_bank_match(p_line uuid)
returns table (kind text, ref_id uuid, ref_date date, ref_desc text, ref_amount numeric, day_gap int)
language plpgsql stable security definer set search_path = public
as $fn$
declare l public.bank_statement_lines%rowtype;
begin
  if not public.is_admin() then raise exception 'مطابقة البنك للمدير'; end if;
  select * into l from public.bank_statement_lines where id = p_line;
  if not found then raise exception 'السطر غير موجود'; end if;

  return query
  select 'cash_moves', cm.id, cm.move_date, cm.description, cm.amount,
         abs(cm.move_date - l.stmt_date)::int
    from public.cash_moves cm
   where cm.method = 'بنك' and cm.amount = l.amount
     and cm.direction = case when l.direction = 'وارد' then 'قبض' else 'صرف' end
     and abs(cm.move_date - l.stmt_date) <= 7
     and not exists (select 1 from public.bank_statement_lines b
                      where b.matched_type = 'cash_moves' and b.matched_id = cm.id)
  union all
  select 'payroll_payments', pp.id, pp.pay_date, 'دفع راتب', pp.amount,
         abs(pp.pay_date - l.stmt_date)::int
    from public.payroll_payments pp
   where pp.method = 'بنك' and pp.amount = l.amount and l.direction = 'صادر'
     and abs(pp.pay_date - l.stmt_date) <= 7
     and not exists (select 1 from public.bank_statement_lines b
                      where b.matched_type = 'payroll_payments' and b.matched_id = pp.id)
   order by 6;
end;
$fn$;

create or replace function public.bank_reconciliation(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare v_bank numeric; v_book numeric; v_unmatched int; v_unmatched_amt numeric;
begin
  if not public.is_admin() then raise exception 'مطابقة البنك للمدير'; end if;

  select coalesce(sum(case when direction='وارد' then amount else -amount end), 0)
    into v_bank from public.bank_statement_lines where stmt_date between p_from and p_to;

  select coalesce(sum(jl.debit - jl.credit), 0) into v_book
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.accounts a on a.id = jl.account_id
   where a.code = '1200' and je.entry_date between p_from and p_to;

  select count(*), coalesce(sum(amount), 0) into v_unmatched, v_unmatched_amt
    from public.bank_statement_lines
   where stmt_date between p_from and p_to and matched_at is null;

  return jsonb_build_object(
    'bank_movement', v_bank, 'book_movement', v_book,
    'difference', v_bank - v_book,
    'unmatched_lines', v_unmatched, 'unmatched_amount', v_unmatched_amt);
end;
$fn$;


-- ------------------------------------------------------------
-- الصلاحيات
-- ------------------------------------------------------------
alter table public.employee_targets     enable row level security;
alter table public.bank_statement_lines enable row level security;

drop policy if exists "admin manages targets" on public.employee_targets;
create policy "admin manages targets" on public.employee_targets
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "employee reads own targets" on public.employee_targets;
create policy "employee reads own targets" on public.employee_targets
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));

drop policy if exists "admin manages bank lines" on public.bank_statement_lines;
create policy "admin manages bank lines" on public.bank_statement_lines
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

do $do$
declare t text;
begin
  foreach t in array array['employee_targets','bank_statement_lines'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete
                      on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $do$;

revoke execute on function public.month_close_overview(text)      from public, anon;
revoke execute on function public.build_all_payrolls(text)        from public, anon;
revoke execute on function public.approve_all_payrolls(text)      from public, anon;
revoke execute on function public.target_progress(text)           from public, anon;
revoke execute on function public.suggest_bank_match(uuid)        from public, anon;
revoke execute on function public.bank_reconciliation(date, date) from public, anon;

grant execute on function public.month_close_overview(text)      to authenticated;
grant execute on function public.build_all_payrolls(text)        to authenticated;
grant execute on function public.approve_all_payrolls(text)      to authenticated;
grant execute on function public.target_progress(text)           to authenticated;
grant execute on function public.suggest_bank_match(uuid)        to authenticated;
grant execute on function public.bank_reconciliation(date, date) to authenticated;

notify pgrst, 'reload schema';
