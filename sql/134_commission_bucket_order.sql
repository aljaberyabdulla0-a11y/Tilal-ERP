-- ============================================================
-- تلال ERP — 134: ترتيب الصفقات في الدلو — تسلسلٌ لا uuid
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== الخطأ (كشفه tests.run_brokerage: الفحص ٥٥ ينجح مرّة ويفشل مرّة) =====
-- الصيغة الحدّية تعطي كل صفقة نسبة **ترتيبها** في الدلو، والترتيب في 129 كان:
--     order by earned_at, created_at, id
-- وصفقتان في معاملة واحدة (أو في اللحظة نفسها) تتساويان في created_at،
-- فيحكم بينهما id — وهو uuid عشوائي. فقد تُحسب الثانية قبل الأولى وتأخذ
-- نسبتها. (الرجعية لا تتأثّر: كل صفقات الفترة بنسبة واحدة.)
--
-- ===== الإصلاح =====
-- sale_seq: رقم تسلسلي يُختم عند الإدراج = ترتيب اكتمال البيع الحقيقي.
-- والصفوف القائمة تأخذ أرقامها بترتيب created_at ثم id (صفر صفّ حيّ للوسيط).
-- الدالّتان نصّ 129 حرفياً — التغيير الوحيد سطر order by.
--
-- آمن لإعادة التشغيل. التراجع: أعد الدالّتين من 129 (العمود لا يضرّ).
-- ============================================================

alter table public.broker_commissions add column if not exists sale_seq bigint;
alter table public.sale_commissions   add column if not exists sale_seq bigint;

create sequence if not exists public.commission_sale_seq;

-- الصفوف القائمة بترتيبها الزمني، ثم يصير التسلسل افتراضياً للجديد
update public.broker_commissions b set sale_seq = x.s
  from (select id, nextval('public.commission_sale_seq') as s
          from (select id from public.broker_commissions where sale_seq is null order by created_at, id) o) x
 where x.id = b.id;
update public.sale_commissions c set sale_seq = x.s
  from (select id, nextval('public.commission_sale_seq') as s
          from (select id from public.sale_commissions where sale_seq is null order by created_at, id) o) x
 where x.id = c.id;

alter table public.broker_commissions alter column sale_seq set default nextval('public.commission_sale_seq');
alter table public.sale_commissions   alter column sale_seq set default nextval('public.commission_sale_seq');

comment on column public.broker_commissions.sale_seq is
  'ترتيب اكتمال البيع — به ترتّب الصيغة الحدّية صفقات الدلو. created_at يتساوى داخل المعاملة الواحدة (sql/134).';
comment on column public.sale_commissions.sale_seq is
  'ترتيب اكتمال البيع — به ترتّب الصيغة الحدّية صفقات الدلو (sql/134).';

create or replace function public.recompute_broker_bucket(
  p_plan uuid, p_company uuid, p_period_key text, p_reason text, p_trigger text default 'يدوي'
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  pl        public.commission_plans%rowtype;
  v_total   numeric;
  v_run     numeric := 0;
  v_meas    numeric;
  v_rate    numeric;
  v_fixed   numeric;
  v_paid    numeric;
  v_new     numeric(16,2);
  v_up      numeric := 0;
  v_moved   int := 0;
  v_top     numeric;
  r         record;
begin
  select * into pl from public.commission_plans where id = p_plan;
  if not found then return; end if;

  select case when pl.basis = 'قيمة المبيعات' then coalesce(sum(bc.deal_amount), 0) else count(*) end
    into v_total
    from public.broker_commissions bc
   where bc.plan_id = p_plan and bc.company_id = p_company
     and bc.period_key = p_period_key and bc.reversed_at is null;

  for r in
    select bc.*, u.unit_type as u_type
      from public.broker_commissions bc
      left join public.units u on u.id = bc.unit_id
     where bc.plan_id = p_plan and bc.company_id = p_company
       and bc.period_key = p_period_key and bc.reversed_at is null
     order by bc.earned_at, bc.sale_seq, bc.id
     for update of bc
  loop
    v_run := v_run + case when pl.basis = 'قيمة المبيعات' then coalesce(r.deal_amount, 0) else 1 end;
    v_meas := case pl.formula
                when 'شرائح حدّية' then v_run
                when 'ثابتة'       then case when pl.basis = 'قيمة المبيعات' then 0 else 1 end
                else v_total
              end;

    v_rate := null; v_fixed := null;
    select t.rate, t.fixed_amount into v_rate, v_fixed
      from public.commission_plan_rate(p_plan, v_meas, r.u_type) t;
    v_rate := coalesce(v_rate, 0);

    v_paid := public.broker_commission_net_paid(r.id);
    -- ⚠️ لا ينزل تحت صافي المصروف — الصرف حركة نقدية مقيّدة
    v_new := greatest(round(coalesce(r.deal_amount, 0) * v_rate / 100 + coalesce(v_fixed, 0), 2), v_paid);

    if r.period_measure is not null
       and (v_new is distinct from r.amount or v_rate is distinct from r.rate
            or v_fixed is distinct from r.fixed_amount) then
      insert into public.broker_commission_adjustments
        (commission_id, old_rate, new_rate, old_amount, new_amount, period_units, period_measure,
         reason, trigger_kind, actor, actor_name)
      values (r.id, r.rate, v_rate, r.amount, v_new,
              case when pl.basis = 'عدد الوحدات' then v_meas::int end, v_meas,
              p_reason, p_trigger, auth.uid(),
              case when auth.uid() is null then 'النظام' else public.actor_display_name() end);
      if v_new > r.amount then
        v_up := v_up + (v_new - r.amount);
        v_moved := v_moved + 1;
      end if;
    end if;

    update public.broker_commissions
       set rate = v_rate, fixed_amount = v_fixed, amount = v_new, period_measure = v_meas,
           tier_units = case when pl.basis = 'عدد الوحدات' then v_meas::int else tier_units end
     where id = r.id
       and (rate is distinct from v_rate or amount is distinct from v_new
            or fixed_amount is distinct from v_fixed or period_measure is distinct from v_meas);
    v_top := v_rate;
  end loop;

  -- ارتفعت الشريحة فارتفعت صفقاتٌ سابقة: يعرف الوسيط بالفرق
  if v_up > 0 then
    perform public.notify_broker_company(p_company,
      'مبروك — انتقلتم إلى شريحة ' || trim_scale(v_top) || '٪ 🎯',
      case when pl.basis = 'قيمة المبيعات'
           then 'بلغت مبيعاتكم ' || public.fmt_qty(v_total) || ' د.ع'
           else 'بلغتم ' || v_total::int || ' وحدة' end
        || ' في ' || coalesce((select pr.name from public.projects pr where pr.id = pl.project_id), 'المشروع')
        || ' (' || p_period_key || ') — وأُعيد احتساب ' || v_moved || ' صفقة سابقة بأثر رجعي: +'
        || public.fmt_qty(v_up) || ' د.ع.',
      '/dashboard/broker/commissions', null);
  end if;
end; $fn$;

create or replace function public.recompute_employee_bucket(
  p_plan uuid, p_employee uuid, p_period text, p_reason text, p_trigger text default 'يدوي'
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  pl      public.commission_plans%rowtype;
  v_total numeric;
  v_run   numeric := 0;
  v_meas  numeric;
  v_rate  numeric;
  v_fixed numeric;
  v_new   numeric;
  v_delta numeric;
  v_acc   boolean;
  v_comm  uuid;
  v_set   text;
  v_up    numeric := 0;
  v_unit  text;
  v_user  uuid;
  r       record;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  select * into pl from public.commission_plans where id = p_plan;
  if not found or p_employee is null then return; end if;

  select case when pl.basis = 'قيمة المبيعات' then coalesce(sum(sc.deal_amount), 0) else count(*) end
    into v_total
    from public.sale_commissions sc
   where sc.employee_plan_id = p_plan and sc.employee_id = p_employee
     and sc.employee_period = p_period and sc.reversed_at is null;

  for r in
    select sc.*, u.unit_type as u_type, u.unit_code as u_code
      from public.sale_commissions sc
      left join public.units u on u.id = sc.unit_id
     where sc.employee_plan_id = p_plan and sc.employee_id = p_employee
       and sc.employee_period = p_period and sc.reversed_at is null
     order by sc.sale_seq, sc.id
     for update of sc
  loop
    v_run := v_run + case when pl.basis = 'قيمة المبيعات' then coalesce(r.deal_amount, 0) else 1 end;
    v_meas := case pl.formula
                when 'شرائح حدّية' then v_run
                when 'ثابتة'       then case when pl.basis = 'قيمة المبيعات' then 0 else 1 end
                else v_total
              end;

    v_rate := null; v_fixed := null;
    select t.rate, t.fixed_amount into v_rate, v_fixed
      from public.commission_plan_rate(p_plan, v_meas, r.u_type) t;
    v_rate := coalesce(v_rate, 0);
    v_new := round(coalesce(r.deal_amount, 0) * v_rate / 100 + coalesce(v_fixed, 0));

    if r.employee_measure is not null and v_new is distinct from r.employee_amount then
      v_delta := v_new - coalesce(r.employee_amount, 0);
      v_set := 'قبل تأكيد المقدمة — يتغيّر الرقم وحده';

      -- استُحقّت (تأكيد المقدمة، 120): فرقٌ لا تعديل لصفٍّ مُرحَّل.
      -- قبلها يكفي تغيير الرقم: confirm_down_payment يقرؤه عند الاستحقاق.
      select (rs.down_payment_confirmed_at is not null) into v_acc
        from public.reservations rs where rs.id = r.reservation_id;

      if coalesce(v_acc, false) then
        if v_delta > 0 then
          insert into public.commissions
            (employee_id, amount, comm_date, description, auto, payable_at, sale_commission_id)
          values (p_employee, v_delta, v_today,
                  case when r.commission_id is null then 'عمولة بيع' else 'فرق شريحة عمولة بأثر رجعي' end
                    || ' — الوحدة ' || coalesce(r.u_code, ''),
                  true, v_today, r.id)
          returning id into v_comm;
          if r.commission_id is null then
            update public.sale_commissions set commission_id = v_comm where id = r.id;
          end if;
          perform public.attach_commission_to_draft(v_comm);
          v_set := 'صفّ عمولة إضافي ' || public.fmt_qty(v_delta) || ' د.ع';
          v_up := v_up + v_delta;
        elsif exists (select 1 from public.commissions c
                       where c.employee_id = p_employee
                         and (c.sale_commission_id = r.id or c.id = r.commission_id)) then
          insert into public.deductions (employee_id, amount, ded_date, reason, sale_commission_id)
          values (p_employee, -v_delta, v_today,
                  'تعديل شريحة عمولة بأثر رجعي — الوحدة ' || coalesce(r.u_code, ''), r.id);
          v_set := 'استقطاع ' || public.fmt_qty(-v_delta) || ' د.ع في الكشف القادم';
        end if;
      end if;

      insert into public.sale_commission_adjustments
        (sale_commission_id, employee_id, old_rate, new_rate, old_amount, new_amount,
         period_measure, reason, trigger_kind, settlement, actor, actor_name)
      values (r.id, p_employee, r.employee_rate, v_rate, r.employee_amount, v_new,
              v_meas, p_reason, p_trigger, v_set, auth.uid(),
              case when auth.uid() is null then 'النظام' else public.actor_display_name() end);
    end if;

    update public.sale_commissions
       set employee_amount = v_new, employee_rate = v_rate, employee_fixed = v_fixed,
           employee_measure = v_meas,
           employee_basis = public.commission_basis_label(p_plan, v_rate, v_fixed, v_meas)
     where id = r.id;
  end loop;

  if v_up > 0 then
    select user_id into v_user from public.employees where id = p_employee;
    if v_user is not null then
      insert into public.notifications (user_id, title, body, link, kind, category)
      values (v_user, 'ارتفعت شريحة عمولتك 🎯',
              'بلغت شريحة أعلى (' || p_period || ') فأُعيد احتساب صفقاتك السابقة: +'
                || public.fmt_qty(v_up) || ' د.ع تدخل كشفك.',
              '/dashboard/me/salary', 'راتب', 'عمولة');
    end if;
  end if;
end; $fn$;

revoke execute on function public.recompute_broker_bucket(uuid, uuid, text, text, text)   from public, anon, authenticated;
revoke execute on function public.recompute_employee_bucket(uuid, uuid, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
