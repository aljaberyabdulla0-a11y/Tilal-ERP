-- ============================================================
-- تلال ERP — 110: مطابقة الرواتب، ودفع الكشف من جيب شريك
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- النموذج: اعتماد الكشف = مدين 5100 / دائن 2300، ودفعه = مدين 2300 /
-- دائن النقد. فإن دُفع راتبٌ له كشف بحركة «رواتب وأجور» (5100 مباشرة)
-- صار مصروف الراتب مرتين وبقي 2300 دَيناً مدفوعاً.
--
-- الواقع (2026-10-01): ٤ كشوف معتمدة (آب وأيلول) بلا دفعة واحدة في
-- payroll_payments، و٢١ حركة 5100، ٢٠ منها دفعها شريك من جيبه
-- (مدين 5100 / دائن 2500). والسبب أن payroll_payments لا تعرف الدفع
-- من جيب شريك — تعرف النقد والبنك وحدهما — فكان الطريق الوحيد
-- لتسجيل ما دفعه الشريك هو الحركة النقدية.
--
-- ===== ما يضيفه =====
--
--   ١) payroll_payments.partner_id — دفعة دفعها شريك من حسابه:
--      مدين 2300 / دائن 2500 (جاري الشركاء)، كما تفعل الحركة النقدية
--      مع المصروف. فالكشف يُدفع من حيث دُفع فعلاً، ولا يبقى سببٌ
--      لتسجيله حركةً على 5100.
--   ٢) حارس الدفعة: لا تتجاوز الدفعاتُ صافيَ الكشف، ولا تُدفع مسوّدة،
--      ولا تُعدَّل أرقام دفعة مُرحَّلة (لا محفّز تعديل يعيد ترحيلها).
--   ٣) payroll_reconciliation(from, to) — للقراءة فقط. تضع كل حركة
--      5100 وكل كشف معتمد في صنف:
--        مطابق           كشفٌ دُفع عبر payroll_payments ولا حركة تشبهه
--        تكرار محتمل      حركة لموظف له كشف يغطّي تاريخها (آخر الشهر
--                         حتى ٤٥ يوماً بعده)، أو كشف له حركة كهذه
--        يحتاج مراجعة     حركة لموظف معروف بلا كشف يغطّيها، أو دُفعت
--                         قبل نهاية الشهر (قد تكون راتب الشهر السابق)
--        أجر يومي         حركة فيها «أجور/أسبوعية/مصور/تصوير…» — تُقدَّم على
--                         مطابقة الاسم («تصوير صب لاماك» ليست صِبا)
--        غير مطابق        حركة لا تسمّي موظفاً، أو كشف معتمد لم يُدفع
--      الاسم يُطابق بهيكل الحروف الساكنة (fin_name_skeleton): دانيا
--      ودانيه ← «دن»، ليندا ولندا ← «لند».
--
-- لا يغيّر حركة ولا قيداً. التصحيح قرارٌ للمالك بعد المراجعة
-- (docs/accounting-corrections.md).
--
-- يتطلب: 019، 068، 109. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- ١) الدفع من جيب شريك
-- ------------------------------------------------------------
alter table public.payroll_payments
  add column if not exists partner_id uuid references public.partners(id) on delete restrict;

comment on column public.payroll_payments.partner_id is
  'شريكٌ دفع الراتب من حسابه: القيد مدين 2300 / دائن 2500 بدل النقد (sql/110). فارغ = دفعته الشركة.';

create or replace function public.repost_payroll_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pay     record;
  pr      record;
  v_due   uuid;
  v_cash  uuid;
  v_entry uuid;
  v_emp   text;
  v_who   text;
begin
  select * into pay from public.payroll_payments where id = p_id;
  if not found then return; end if;

  if pay.journal_entry_id is not null then
    delete from public.journal_entries where id = pay.journal_entry_id;
  end if;

  select * into pr from public.payrolls where id = pay.payroll_id;

  select id into v_due  from public.accounts where code = '2300';
  if pay.partner_id is not null then
    select id into v_cash from public.accounts where code = '2500';
    select name into v_who from public.partners where id = pay.partner_id;
  else
    select id into v_cash from public.accounts
      where code = case when pay.method = 'بنك' then '1200' else '1100' end;
  end if;
  if v_due is null or v_cash is null then
    raise exception 'حساب 2300 أو حساب الدفع غير موجود — الدفعة لا تُحفظ بلا قيد';
  end if;

  select full_name into v_emp from public.employees where id = pr.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (
    pay.pay_date,
    'دفع راتب: ' || coalesce(v_emp, '') || ' - ' || coalesce(pr.period, '')
      || case when v_who is not null then ' — دفعه ' || v_who || ' من حسابه الخاص' else '' end,
    'PAYRUN', 'إداري عام', 'payroll_payments'
  )
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    (v_entry, v_due,  pay.amount, 0),
    (v_entry, v_cash, 0,          pay.amount);

  update public.payroll_payments set journal_entry_id = v_entry where id = p_id;
end; $$;

create or replace function public.guard_payroll_payment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare pr public.payrolls%rowtype; v_paid numeric;
begin
  if tg_op = 'UPDATE' then
    if (new.amount, new.pay_date, new.method, new.partner_id, new.payroll_id)
       is distinct from
       (old.amount, old.pay_date, old.method, old.partner_id, old.payroll_id) then
      raise exception 'الدفعة مُرحَّلة — لا تُعدَّل أرقامها. احذفها وسجّلها من جديد';
    end if;
    return new;
  end if;

  select * into pr from public.payrolls where id = new.payroll_id;
  if pr.state = 'مسودة' then
    raise exception 'الكشف مسوّدة — يُعتمد قبل أن يُدفع';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from public.payroll_payments where payroll_id = new.payroll_id;
  if v_paid + new.amount > coalesce(pr.net, 0) + 0.01 then
    raise exception 'الدفعة (%) تتجاوز المتبقّي من صافي الكشف (%)',
      new.amount, greatest(coalesce(pr.net, 0) - v_paid, 0);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_guard_payroll_payment on public.payroll_payments;
create trigger trg_guard_payroll_payment
  before insert or update on public.payroll_payments
  for each row execute function public.guard_payroll_payment();


-- ------------------------------------------------------------
-- ٢) أداة المطابقة
-- ------------------------------------------------------------

-- هيكل الاسم: بلا تشكيل ولا مدّ، والهمزات ألف، ثم تُسقط حروف المدّ
-- والتاء المربوطة والهاء الأخيرة — فتتطابق «دانيا/دانيه» و«ليندا/لندا».
create or replace function public.fin_name_skeleton(p text)
returns text language sql immutable as $fn$
  select nullif(
    regexp_replace(
      translate(lower(coalesce(p, '')),
                'أإآٱىةـًٌٍَُِّْ', 'اااايه'),
      '[اويهء\s]', '', 'g'),
    '');
$fn$;

comment on function public.fin_name_skeleton(text) is
  'هيكل الحروف الساكنة لاسم عربي — لمطابقة الأسماء بين الحركات والموظفين مع اختلاف الإملاء (sql/110).';

create or replace function public.payroll_reconciliation(
  p_from date default null,
  p_to   date default null
)
returns table (
  side            text,     -- 'حركة' | 'كشف'
  classification  text,
  reason          text,
  ref_id          uuid,
  ref_date        date,
  amount          numeric,
  label           text,
  paid_by         text,
  employee_id     uuid,
  employee_name   text,
  payroll_id      uuid,
  period          text,
  payroll_net     numeric,
  paid_via_payroll numeric
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_see_payroll() then
    raise exception 'مطابقة الرواتب للمدير أو المحاسب أو الموارد البشرية';
  end if;

  return query
  with emp as (
    select e.id, e.full_name,
           public.fin_name_skeleton(split_part(btrim(e.full_name), ' ', 1)) sk
      from public.employees e
  ),
  pay as (
    select p.id, p.employee_id, p.period, p.net, p.state,
           to_date(p.period || '-01', 'YYYY-MM-DD') p_start,
           (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date p_end,
           coalesce((select sum(pp.amount) from public.payroll_payments pp
                      where pp.payroll_id = p.id), 0) paid
      from public.payrolls p
     where p.state <> 'مسودة'
  ),
  mv as (
    select c.id, c.move_date, c.amount,
           btrim(c.description || coalesce(' — ' || c.notes, '')) lbl,
           coalesce(pt.name, case when c.method = 'بنك' then 'الشركة (بنك)' else 'الشركة (نقد)' end) who,
           -- أوّل موظف يطابق هيكلُ اسمه الأوّل كلمةً في البيان أو الملاحظة
           (select em.id from emp em
             where em.sk is not null and length(em.sk) >= 2
               and em.sk = any (
                 select public.fin_name_skeleton(w)
                   from regexp_split_to_table(c.description || ' ' || coalesce(c.notes, ''), '\s+') w)
             order by em.full_name limit 1) emp_id
      from public.cash_moves c
      left join public.partners pt on pt.id = c.partner_id
     where c.account_code = '5100'
       and (p_from is null or c.move_date >= p_from)
       and (p_to   is null or c.move_date <= p_to)
  ),
  mv_match as (
    select m.*,
           (select py.id from pay py
             where py.employee_id = m.emp_id
               and m.move_date between py.p_start and py.p_end + 45
             order by abs(m.move_date - py.p_end) limit 1) pay_id
      from mv m
  )
  -- الحركات
  select 'حركة'::text,
         case
           when mm.lbl ~ '(اجور|أجور|اسبوعي|أسبوعي|يومي|مصور|تصوير|فديو|فيديو|كوبي|ترويج|مونتاج)'
             then 'أجر يومي'
           when mm.emp_id is null then 'غير مطابق'
           when mm.pay_id is null then 'يحتاج مراجعة'
           when mm.move_date < py.p_end - 5 then 'يحتاج مراجعة'
           else 'تكرار محتمل'
         end,
         case
           when mm.lbl ~ '(اجور|أجور|اسبوعي|أسبوعي|يومي|مصور|تصوير|فديو|فيديو|كوبي|ترويج|مونتاج)'
             then 'أجر تصوير أو أسبوعي أو مستقل — مكانه 5110 لا الكشف'
           when mm.emp_id is null then 'لا يسمّي موظفاً معروفاً — راجع البيان'
           when mm.pay_id is null then 'موظف بلا كشف معتمد يغطّي هذا التاريخ — راتب دُفع خارج نظام الكشوف'
           when mm.move_date < py.p_end - 5 then
             'دُفعت في ' || mm.move_date || ' قبل نهاية شهر الكشف ' || py.period ||
             ' — قد تكون راتب الشهر السابق'
           else 'للموظف كشف ' || py.period || ' معتمد'
                || case when abs(mm.amount - py.net) < 1 then ' بالمبلغ نفسه' else ' (صافيه ' || py.net || ')' end
                || ' — المصروف مسجّل في الكشف وفي الحركة'
         end,
         mm.id, mm.move_date, mm.amount, mm.lbl, mm.who,
         mm.emp_id, em.full_name, py.id, py.period, py.net, py.paid
    from mv_match mm
    left join emp em on em.id = mm.emp_id
    left join pay py on py.id = mm.pay_id

  union all

  -- الكشوف المعتمدة
  select 'كشف'::text,
         case
           when exists (select 1 from mv_match mm where mm.pay_id = py.id
                          and mm.move_date >= py.p_end - 5) then 'تكرار محتمل'
           when py.paid >= py.net - 0.01 then 'مطابق'
           else 'غير مطابق'
         end,
         case
           when exists (select 1 from mv_match mm where mm.pay_id = py.id
                          and mm.move_date >= py.p_end - 5) then
             'حركة 5100 لهذا الموظف بعد نهاية الشهر — قد تكون دفعة هذا الكشف مسجّلةً مصروفاً ثانياً'
           when py.paid >= py.net - 0.01 then 'مدفوع عبر دفعات الكشف'
           when py.paid > 0 then 'مدفوع جزئياً — المتبقّي ' || (py.net - py.paid) || ' دَين في 2300'
           else 'معتمد بلا دفعة — ' || py.net || ' دَين في 2300. إن دُفع فعلاً فسجّل الدفعة من الكشف'
         end,
         py.id, py.p_end, py.net, 'كشف ' || py.period, null::text,
         py.employee_id, e.full_name, py.id, py.period, py.net, py.paid
    from pay py
    join public.employees e on e.id = py.employee_id
   where (p_from is null or py.p_end >= p_from)
     and (p_to   is null or py.p_start <= p_to)
   order by 5, 1;
end;
$fn$;

comment on function public.payroll_reconciliation(date, date) is
  'مطابقة حركات 5100 بكشوف الرواتب ودفعاتها. للقراءة فقط — لا يغيّر شيئاً (sql/110).';

revoke execute on function public.payroll_reconciliation(date, date) from public, anon;
grant  execute on function public.payroll_reconciliation(date, date) to authenticated;
revoke execute on function public.guard_payroll_payment() from public, anon, authenticated;

notify pgrst, 'reload schema';
