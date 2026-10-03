-- ============================================================
-- تلال ERP — 120: موظف البيع يُعيَّن من الوحدة، وعمولته تدخل كشفه من تأكيد المقدمة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- • موظف البيع كان يُستنتج ولا يُختار: agent_id في الحجز، وإلا مطابقة
--   اسم «موظف المبيعات» في بطاقة العميل. الوحدة 65 بيعت بلا agent_id
--   فذهبت عمولتها لمن في بطاقة العميل — ولا طريق لتصحيحها.
-- • وعمولة الموظف تُنشأ عند تأكيد المقدمة لكن بلا payable_at، فلا
--   يلتقطها build_payroll حتى تُحصّل الشركة عمولتها من المطوّر.
--   أربع عمولات (600,000) عالقةٌ اليوم كذلك.
--
-- ===== القاعدة الجديدة =====
--
-- • الاستحقاق من تاريخ تأكيد المقدمة: payable_at = يوم التأكيد
--   (بتوقيت بغداد) — لا ينتظر التحصيل من المطوّر.
-- • وتُضاف العمولة فوراً إلى أقرب مسوّدة كشفٍ للموظف من شهر الاستحقاق
--   فصاعداً. فإن لم توجد مسوّدة التقطها build_payroll عند توليد الكشف.
-- • set_sale_employee(حجز، موظف) — للمدير: يعيّن موظف البيع، ويعيد حساب
--   عمولته بقاعدة الموظف الجديد على أساس الصفقة المجمَّد (السعر وعمولة
--   الشركة لا يتغيّران). وعمولة الموظف السابق:
--     - غير مضافة لكشف، أو في مسوّدة → تُحذف (ويُحذف بندها).
--     - في كشفٍ معتمد/مقفل → استقطاع استرداد في كشفه القادم (كفسخ البيع).
--
-- يتطلب: 048، 056، 103، 113. آمن لإعادة التشغيل. (119 لا يتوقّف عليه.)
-- ============================================================


-- ------------------------------------------------------------
-- 1) إلحاق عمولةٍ مستحقّة بأقرب مسوّدة
-- ------------------------------------------------------------
-- داخلية: تُنادى من الدوالّ أدناه وحدها.
create or replace function public.attach_commission_to_draft(p_comm uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c public.commissions%rowtype; v_pr uuid; v_period text;
begin
  select * into c from public.commissions where id = p_comm;
  if not found or c.payroll_id is not null or c.payable_at is null then
    return null;
  end if;

  select id, period into v_pr, v_period
    from public.payrolls
   where employee_id = c.employee_id and state = 'مسودة'
     and period >= to_char(c.payable_at, 'YYYY-MM')
   order by period
   limit 1;
  if v_pr is null then return null; end if;

  insert into public.payroll_lines
    (payroll_id, kind, category, description, amount, source_table, source_id)
  values (v_pr, 'استحقاق', 'عمولة',
          coalesce(c.description, 'عمولة ' || c.comm_date::text), c.amount,
          'commissions', c.id);
  update public.commissions set payroll_id = v_pr where id = c.id;

  return v_period;
end;
$fn$;

revoke execute on function public.attach_commission_to_draft(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 2) تأكيد المقدمة: العمولة مستحقّة الدفع من يومها
-- ------------------------------------------------------------
create or replace function public.confirm_down_payment(p_res uuid, p_amount numeric, p_sale_price numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype; emp public.employees%rowtype;
  u public.units%rowtype;
  v_price numeric; v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_unit text; v_client text; v_recv uuid; v_rev uuid; v_entry uuid; v_comm uuid;
  v_period text;
begin
  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;

  select * into u from public.units where id = r.unit_id;

  if not exists (select 1 from public.units u2
                  where u2.id = r.unit_id and public.can_manage_project(u2.project_id)) then
    raise exception 'تأكيد المقدمة للإدارة';
  end if;

  if r.status <> 'بيع مكتمل' then
    raise exception 'لا تُؤكَّد المقدمة إلا على بيع مكتمل (الحالة الآن: %)', r.status;
  end if;

  if r.down_payment_confirmed_at is not null then
    raise exception 'المقدمة مؤكَّدة سلفاً في %',
      to_char(r.down_payment_confirmed_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD');
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'مبلغ المقدمة يجب أن يكون أكبر من صفر';
  end if;

  select * into sc from public.sale_commissions where reservation_id = p_res;

  if sc.id is not null then
    if p_sale_price is not null and p_sale_price is distinct from sc.deal_amount then
      raise exception
        'عمولة هذه الصفقة محسوبة سلفاً على سعر % — لا تُعاد بأثر رجعي. للتصحيح افسخ الصفقة ثم أعدها',
        public.fmt_qty(sc.deal_amount);
    end if;
  else
    v_price := coalesce(nullif(p_sale_price, 0), r.sale_price, u.price);
    if coalesce(v_price, 0) <= 0 then
      raise exception 'أدخل سعر بيع الوحدة — منه تُحسب عمولة الشركة وعمولة الموظف';
    end if;

    update public.reservations set sale_price = v_price where id = p_res;

    if u.price is null and v_price > 0 then
      perform set_config('tilal.unit_price_from_deal', 'on', true);
      update public.units set price = v_price where id = r.unit_id and price is null;
      perform set_config('tilal.unit_price_from_deal', 'off', true);
    end if;

    perform public.record_sale_commission(p_res);

    select * into sc from public.sale_commissions where reservation_id = p_res;
    if sc.id is null then
      raise exception 'تعذّر حساب العمولة — راجع نسبة عمولة المشروع';
    end if;
  end if;

  select coalesce(u2.unit_code, '') into v_unit from public.units u2 where u2.id = r.unit_id;
  select name into v_client from public.clients where id = r.client_id;

  update public.reservations
     set down_payment_amount = p_amount,
         down_payment_confirmed_at = now(),
         down_payment_confirmed_by = auth.uid()
   where id = p_res;

  if coalesce(sc.company_amount, 0) > 0 then
    select id into v_recv from public.accounts where code = '1250';
    select id into v_rev  from public.accounts where code = '4200';
    if v_recv is not null and v_rev is not null then
      insert into public.journal_entries (entry_date, description, reference, arm, source)
      values (v_today,
              'استحقاق عمولة تلال — الوحدة ' || v_unit || ' — ' || coalesce(v_client, ''),
              'COMMDUE', 'إداري عام', 'reservations')
      returning id into v_entry;

      insert into public.journal_lines (entry_id, account_id, debit, credit)
      values (v_entry, v_recv, sc.company_amount, 0),
             (v_entry, v_rev,  0,                sc.company_amount);

      update public.reservations set commission_accrual_entry_id = v_entry where id = p_res;
    end if;
  end if;

  -- عمولة الموظف: مستحقّة الدفع من يوم التأكيد (120)
  if sc.employee_id is not null and coalesce(sc.employee_amount, 0) > 0
     and sc.commission_id is null then
    select * into emp from public.employees where id = sc.employee_id;

    insert into public.commissions
      (employee_id, amount, comm_date, description, auto, payable_at)
    values (sc.employee_id, sc.employee_amount, v_today,
            'عمولة بيع — الوحدة ' || v_unit || ' — ' || coalesce(sc.employee_basis, ''),
            true, v_today)
    returning id into v_comm;

    update public.sale_commissions set commission_id = v_comm where id = sc.id;

    v_period := public.attach_commission_to_draft(v_comm);

    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'استُحقّت لك عمولة',
              public.fmt_qty(sc.employee_amount) || ' د.ع عن الوحدة ' || v_unit ||
              case when v_period is not null
                   then ' — أُضيفت إلى كشف راتب ' || v_period || '.'
                   else ' — تدخل كشف راتبك القادم.' end,
              '/dashboard/me/salary', 'راتب', v_comm);
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 3) التحصيل من المطوّر: لا يمسّ عمولة الموظف بعد اليوم
-- ------------------------------------------------------------
-- يبقى يملأ payable_at لعمولةٍ قديمة لم تُملأ (احتياطاً)، ولا يُشعر
-- الموظف إلا حينها — فعمولته مستحقّة سلفاً من تأكيد المقدمة.
create or replace function public.collect_company_commission(p_res uuid, p_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  v_cash uuid; v_recv uuid; v_entry uuid; v_unit text; v_when date; emp public.employees%rowtype;
  v_inv text; v_n int;
begin
  if not public.can_manage_finance() then
    raise exception 'تسجيل تحصيل العمولة للمدير أو المحاسب';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select * into sc from public.sale_commissions where reservation_id = p_res;
  if not found then raise exception 'لا سجلّ عمولة لهذه الصفقة'; end if;

  if r.down_payment_confirmed_at is null then
    raise exception 'أكّد المقدمة أولاً — العمولة لم تُستحقّ بعد';
  end if;
  if sc.collected_at is not null then
    raise exception 'عمولة هذه الصفقة محصّلة سلفاً في %', sc.collected_at::text;
  end if;
  if coalesce(sc.company_amount, 0) <= 0 then
    raise exception 'لا مبلغ عمولة لتلال في هذه الصفقة';
  end if;

  select invoice_number into v_inv
    from public.developer_invoices
   where reservation_id = p_res and cancelled_at is null;
  if v_inv is null then
    raise exception 'أصدِر فاتورة العمولة للمطوّر أولاً — التحصيل يكون عليها';
  end if;

  v_when := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);
  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  select id into v_cash from public.accounts where code = '1100';
  select id into v_recv from public.accounts where code = '1250';
  if v_cash is null or v_recv is null then
    raise exception 'حساب 1100 أو 1250 غير موجود';
  end if;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when, 'تحصيل عمولة تلال من المطوّر — الوحدة ' || v_unit || ' — ' || v_inv,
          'COMMIN', 'إداري عام', 'sale_commissions')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_cash, sc.company_amount, 0),
         (v_entry, v_recv, 0,                sc.company_amount);

  update public.sale_commissions set collected_at = v_when where id = sc.id;
  update public.reservations set commission_collect_entry_id = v_entry where id = p_res;

  if sc.commission_id is not null then
    update public.commissions set payable_at = v_when
     where id = sc.commission_id and payable_at is null;
    get diagnostics v_n = row_count;

    if v_n > 0 then
      perform public.attach_commission_to_draft(sc.commission_id);
      select e.* into emp from public.employees e where e.id = sc.employee_id;
      if emp.user_id is not null then
        insert into public.notifications (user_id, title, body, link, kind, entity_id)
        values (emp.user_id, 'عمولتك صارت مستحقّة الدفع',
                'حُصّلت عمولة الوحدة ' || v_unit || ' — تدخل كشف راتبك القادم.',
                '/dashboard/me/salary', 'راتب', sc.commission_id);
      end if;
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 4) تعيين موظف البيع
-- ------------------------------------------------------------
create or replace function public.set_sale_employee(p_res uuid, p_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  emp public.employees%rowtype; old_emp text;
  c public.commissions%rowtype; pr public.payrolls%rowtype;
  rule public.employee_commission_rules%rowtype;
  v_amt numeric := 0; v_basis text; v_unit text; v_comm uuid; v_period text;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_paydate date;
  v_old_action text := 'لا عمولة سابقة';
  v_new_action text := 'لا عمولة';
begin
  if not public.is_admin() then
    raise exception 'تعيين موظف البيع للمدير';
  end if;

  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status not in ('حجز', 'بيع مكتمل') then
    raise exception 'لا يُعيَّن موظف بيع لحجزٍ %', r.status;
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;

  select * into sc from public.sale_commissions
   where reservation_id = p_res and reversed_at is null for update;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;
  select full_name into old_emp from public.employees
   where id = coalesce(sc.employee_id, r.agent_id);

  if r.agent_id is distinct from emp.id then
    update public.reservations
       set agent_id = emp.id, agent_name = emp.full_name
     where id = p_res;
  end if;

  -- العمولة لصاحبها سلفاً (مستنتَجاً من بطاقة العميل): يُثبَّت في الحجز ولا تُمسّ
  if (sc.id is not null and sc.employee_id is not distinct from emp.id)
     or (sc.id is null and r.agent_id is not distinct from emp.id) then
    if r.agent_id is distinct from emp.id then
      perform public.log_unit_event(r.unit_id, 'موظف البيع', 'ثُبِّت ' || emp.full_name);
    end if;
    return jsonb_build_object('changed', false);
  end if;

  -- لم تُسجَّل عمولة بعد: تُحسب عند تأكيد المقدمة على الموظف الجديد
  if sc.id is null then
    perform public.log_unit_event(r.unit_id, 'موظف البيع',
      coalesce(old_emp, '—') || ' ← ' || emp.full_name);
    return jsonb_build_object('changed', true, 'old', v_old_action, 'new', 'تُحسب عند تأكيد المقدمة');
  end if;

  -- ===== عمولة الموظف السابق — كما في فسخ البيع (113) =====
  if sc.commission_id is not null then
    select * into c from public.commissions where id = sc.commission_id;

    if c.id is null then
      v_old_action := 'العمولة السابقة محذوفة سلفاً';

    elsif c.payroll_id is null then
      delete from public.commissions where id = c.id;
      v_old_action := 'حُذفت عمولة ' || coalesce(old_emp, '') || ' (' || public.fmt_qty(c.amount) || ' د.ع)';

    else
      select * into pr from public.payrolls where id = c.payroll_id;

      if pr.state = 'مسودة' then
        delete from public.payroll_lines
         where payroll_id = pr.id and source_table = 'commissions' and source_id = c.id;
        delete from public.commissions where id = c.id;
        perform public.refresh_payroll_totals(pr.id);
        v_old_action := 'أُزيلت عمولة ' || coalesce(old_emp, '') || ' من كشف ' || pr.period || ' المسوّدة';

      else
        insert into public.deductions
          (employee_id, amount, ded_date, reason, created_by, created_by_name)
        values (c.employee_id, c.amount, v_today,
                'استرداد عمولة بيع — الوحدة ' || v_unit || ' نُقلت إلى ' || emp.full_name,
                auth.uid(),
                (select coalesce(e.full_name, p.email) from public.profiles p
                   left join public.employees e on e.user_id = p.id where p.id = auth.uid()));
        v_old_action := 'كشف ' || coalesce(old_emp, '') || ' ' || pr.period || ' ' || pr.state ||
                        ' — أُنشئ استرداد ' || public.fmt_qty(c.amount) || ' د.ع للكشف القادم';
      end if;
    end if;
  end if;

  -- ===== عمولة الموظف الجديد على أساس الصفقة المجمَّد =====
  select * into rule from public.resolve_commission_rule(emp.id, sc.project_id, sc.unit_area);
  if rule.id is not null then
    v_amt := case rule.kind
      when 'نسبة من عمولة الشركة' then round(coalesce(sc.company_amount, 0) * rule.value / 100)
      when 'نسبة من سعر البيع'    then round(coalesce(sc.deal_amount, 0) * rule.value / 100)
      when 'مبلغ لكل متر'          then round(coalesce(sc.unit_area, 0) * rule.value)
      else round(rule.value)
    end;
    v_basis := rule.kind || ' — ' || rule.value ||
               case when rule.kind like 'نسبة%' then '%' else ' د.ع' end;
  end if;

  update public.sale_commissions
     set employee_id = emp.id, employee_basis = v_basis,
         employee_amount = coalesce(v_amt, 0), rule_id = rule.id, commission_id = null
   where id = sc.id;

  if r.down_payment_confirmed_at is null then
    v_new_action := case when coalesce(v_amt, 0) > 0
                         then public.fmt_qty(v_amt) || ' د.ع — تُستحقّ عند تأكيد المقدمة'
                         else 'لا قاعدة عمولة تنطبق على ' || emp.full_name end;

  elsif coalesce(v_amt, 0) > 0 then
    -- الاستحقاق من يوم تأكيد المقدمة؛ والقيد بتاريخ اليوم (الفترات المقفلة)
    v_paydate := (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date;

    insert into public.commissions
      (employee_id, amount, comm_date, description, auto, payable_at)
    values (emp.id, v_amt, v_today,
            'عمولة بيع — الوحدة ' || v_unit || ' — ' || coalesce(v_basis, ''),
            true, v_paydate)
    returning id into v_comm;

    update public.sale_commissions set commission_id = v_comm where id = sc.id;
    v_period := public.attach_commission_to_draft(v_comm);

    v_new_action := public.fmt_qty(v_amt) || ' د.ع لـ' || emp.full_name ||
                    case when v_period is not null then ' — أُضيفت لكشف ' || v_period
                         else ' — تدخل كشفه القادم' end;

    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'استُحقّت لك عمولة',
              public.fmt_qty(v_amt) || ' د.ع عن الوحدة ' || v_unit ||
              case when v_period is not null
                   then ' — أُضيفت إلى كشف راتب ' || v_period || '.'
                   else ' — تدخل كشف راتبك القادم.' end,
              '/dashboard/me/salary', 'راتب', v_comm);
    end if;

  else
    v_new_action := 'لا قاعدة عمولة تنطبق على ' || emp.full_name;
  end if;

  perform public.log_unit_event(r.unit_id, 'موظف البيع',
    coalesce(old_emp, '—') || ' ← ' || emp.full_name || ' · ' || v_new_action);

  return jsonb_build_object('changed', true, 'old', v_old_action, 'new', v_new_action);
end;
$fn$;

revoke execute on function public.set_sale_employee(uuid, uuid) from public, anon;
grant  execute on function public.set_sale_employee(uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 5) البيانات القائمة: العمولات العالقة تُستحقّ من يوم التأكيد
-- ------------------------------------------------------------
do $$
declare x record; v_n int := 0; v_att int := 0;
begin
  for x in
    select c.id, (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date as d
      from public.commissions c
      join public.sale_commissions sc on sc.commission_id = c.id and sc.reversed_at is null
      join public.reservations r on r.id = sc.reservation_id
     where c.payable_at is null and r.down_payment_confirmed_at is not null
  loop
    update public.commissions set payable_at = x.d where id = x.id;
    v_n := v_n + 1;
    if public.attach_commission_to_draft(x.id) is not null then
      v_att := v_att + 1;
    end if;
  end loop;
  raise notice '120: % عمولة صارت مستحقّة الدفع، أُضيف منها % إلى مسوّدات قائمة', v_n, v_att;
end $$;
