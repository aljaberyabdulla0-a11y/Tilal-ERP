-- ============================================================
-- تلال ERP — 066: تقارير الربحية والذمم (المرحلة ٦)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ **تصحيحٌ في مواصفة المرحلة**: طُلب «أعمار الذمم من invoices
--    ناقص payments». وهذا كان صحيحاً لو كانت تلال بائعة. لكنها
--    وسيط (sql/056): فاتورة المشتري ليست ذمّةً لتلال ولا تدخل
--    دفاترها. والذمّة الحقيقية الوحيدة هي **عمولاتنا عند
--    المطوّرين** (حساب 1250). فأُعيد توجيه التقرير إليها.
--
--    ولو بُني على invoices لأظهر ٧٧ مليوناً ذمّةً لنا وهي ليست
--    لنا — نفس الخطأ الذي صحّحه sql/056 في الإيراد.
--
-- ===== ربحية المشروع =====
--
-- الإيراد  = عمولة تلال المستحقّة عن صفقات المشروع (company_amount)
-- التكلفة  = عمولات موظفي تلك الصفقات
--          + رواتب الموظفين المُسنَدين إلى المشروع في الفترة
--          + عمولات الشركات الوسيطة على المشروع
--
-- ⚠️ الصفقات المفسوخة (reversed_at) تخرج من الحساب — لم تكن
--    إيراداً قط.
--
-- ⚠️ والرواتب تُنسب بـ employees.project_id: موظفٌ بلا مشروع لا
--    تُحمَّل رواتبه على مشروع، وتظهر في سطر «غير موزَّع».
--
-- ===== التراجع =====  drop function … (قراءات محضة، بلا أثر)
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة: reports_profitability
-- يتطلب: sql/056 و sql/065. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- ربحية المشروع
-- ------------------------------------------------------------
create or replace function public.project_profitability(
  p_from date default null, p_to date default null
)
returns table (
  project_id uuid, project_name text,
  deals int, company_commission numeric, collected numeric,
  employee_commission numeric, broker_commission numeric,
  salaries numeric, cost numeric, profit numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_from date; v_to date; v_pfrom text; v_pto text;
begin
  if not public.is_admin() then
    raise exception 'تقارير الربحية للمدير';
  end if;

  v_from := coalesce(p_from, date_trunc('year', (now() at time zone 'Asia/Baghdad'))::date);
  v_to   := coalesce(p_to,   (now() at time zone 'Asia/Baghdad')::date);
  v_pfrom := to_char(v_from, 'YYYY-MM');
  v_pto   := to_char(v_to,   'YYYY-MM');

  return query
  with deals as (
    select sc.project_id,
           count(*)::int                        as n,
           coalesce(sum(sc.company_amount), 0)  as co,
           coalesce(sum(sc.company_amount) filter (where sc.collected_at is not null), 0) as col,
           coalesce(sum(sc.employee_amount), 0) as emp
      from public.sale_commissions sc
      join public.reservations r on r.id = sc.reservation_id
     where sc.reversed_at is null
       and r.down_payment_confirmed_at is not null
       and (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date between v_from and v_to
     group by sc.project_id
  ),
  brok as (
    select bc.project_id, coalesce(sum(bc.amount), 0) as amt
      from public.broker_commissions bc
     where bc.created_at::date between v_from and v_to
     group by bc.project_id
  ),
  sal as (
    select e.project_id,
           coalesce(sum(p.basic + p.allowances), 0) as amt
      from public.payrolls p
      join public.employees e on e.id = p.employee_id
     where p.state <> 'مسودة' and p.period between v_pfrom and v_pto
     group by e.project_id
  )
  select pr.id, pr.name,
         coalesce(d.n, 0),
         coalesce(d.co, 0),
         coalesce(d.col, 0),
         coalesce(d.emp, 0),
         coalesce(b.amt, 0),
         coalesce(s.amt, 0),
         coalesce(d.emp, 0) + coalesce(b.amt, 0) + coalesce(s.amt, 0),
         coalesce(d.co, 0) - (coalesce(d.emp, 0) + coalesce(b.amt, 0) + coalesce(s.amt, 0))
    from public.projects pr
    left join deals d on d.project_id = pr.id
    left join brok  b on b.project_id = pr.id
    left join sal   s on s.project_id = pr.id
   order by 10 desc;
end;
$fn$;

-- ------------------------------------------------------------
-- أعمار عمولاتنا عند المطوّرين — الذمّة الحقيقية الوحيدة
-- ------------------------------------------------------------
create or replace function public.commission_receivable_aging()
returns table (
  reservation_id uuid, project_name text, unit_code text, client_name text,
  amount numeric, accrued_on date, age_days int, bucket text
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_today date;
begin
  if not public.is_admin() then
    raise exception 'تقرير الذمم للمدير';
  end if;
  v_today := (now() at time zone 'Asia/Baghdad')::date;

  return query
  select r.id, pr.name, u.unit_code, c.name,
         sc.company_amount,
         (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date,
         (v_today - (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date)::int,
         case
           when v_today - (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date <= 30  then 'حتى ٣٠ يوماً'
           when v_today - (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date <= 60  then '٣١–٦٠'
           when v_today - (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date <= 90  then '٦١–٩٠'
           else 'أكثر من ٩٠'
         end
    from public.sale_commissions sc
    join public.reservations r on r.id = sc.reservation_id
    left join public.projects pr on pr.id = sc.project_id
    left join public.units u on u.id = sc.unit_id
    left join public.clients c on c.id = sc.client_id
   where sc.reversed_at is null
     and sc.collected_at is null
     and r.down_payment_confirmed_at is not null
     and coalesce(sc.company_amount, 0) > 0
   order by 7 desc;
end;
$fn$;

-- ------------------------------------------------------------
-- تكلفة الموظف الكاملة — لتقرير «كم يكلّفني فلان؟»
-- ------------------------------------------------------------
create or replace function public.employee_cost(p_from text default null, p_to text default null)
returns table (
  employee_id uuid, full_name text, project_name text,
  basic numeric, allowances numeric, commissions numeric,
  deductions numeric, net numeric, payrolls int
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_from text; v_to text;
begin
  if not public.is_admin() then
    raise exception 'تقرير تكلفة الموظفين للمدير';
  end if;
  v_to   := coalesce(p_to,   to_char((now() at time zone 'Asia/Baghdad')::date, 'YYYY-MM'));
  v_from := coalesce(p_from, to_char(date_trunc('year', (now() at time zone 'Asia/Baghdad'))::date, 'YYYY-MM'));

  return query
  select e.id, e.full_name, pr.name,
         coalesce(sum(p.basic), 0), coalesce(sum(p.allowances), 0),
         coalesce(sum(p.commissions_total), 0), coalesce(sum(p.deductions_total), 0),
         coalesce(sum(p.net), 0), count(p.id)::int
    from public.employees e
    left join public.projects pr on pr.id = e.project_id
    left join public.payrolls p
      on p.employee_id = e.id and p.state <> 'مسودة' and p.period between v_from and v_to
   group by e.id, e.full_name, pr.name
   order by 8 desc;
end;
$fn$;

revoke execute on function public.project_profitability(date, date)      from public, anon;
revoke execute on function public.commission_receivable_aging()          from public, anon;
revoke execute on function public.employee_cost(text, text)              from public, anon;
grant  execute on function public.project_profitability(date, date)      to authenticated;
grant  execute on function public.commission_receivable_aging()          to authenticated;
grant  execute on function public.employee_cost(text, text)              to authenticated;

notify pgrst, 'reload schema';
