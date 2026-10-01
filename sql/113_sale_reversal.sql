-- ============================================================
-- تلال ERP — 113: فسخ البيع — معاينة قبل التنفيذ، وقيد العكس محفوظ
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- reverse_sale (065) جاهزة بلا واجهة، فلم يبقَ للمدير طريقٌ لإلغاء صفقة
-- مؤكَّدة إلا حذف الحجز — وهذا ما يتّم قيد الوحدة 75. منذ 108 الحذف
-- مرفوض، فيلزم الطريق الصحيح في الواجهة، ومعه معاينةٌ تقول ماذا سيحدث
-- في الدفاتر قبل أن يحدث.
--
-- وقيد العكس (COMMREV) يُكتب ولا يُحفظ معرّفه في أي صفّ، فلا يُعرف من
-- الحجز أيّ قيدٍ عكسه، ويبدو القيد يتيماً لفحص الصحّة (114).
--
-- ===== ما يضيفه =====
--
--   ١) reservations.commission_reversal_entry_id — قيد العكس، ويُختم
--      source_id عليه كما في 108.
--   ٢) reverse_sale — نصّ 065 نفسه، مع حفظ قيد العكس على الحجز.
--   ٣) sale_reversal_preview(res) — للمدير، للقراءة فقط:
--      السعر، عمولة تلال ونسبتها، هل حُصّلت، فواتير المطوّر، عمولة
--      الموظف وحال كشفها، وما سيُكتب في الدفاتر سطراً سطراً، أو سبب
--      المنع (عمولة محصّلة، حالة غير «بيع مكتمل»).
--
-- يتطلب: 065، 103، 108. آمن لإعادة التشغيل.
-- ============================================================

alter table public.reservations
  add column if not exists commission_reversal_entry_id uuid
    references public.journal_entries(id) on delete set null;

comment on column public.reservations.commission_reversal_entry_id is
  'قيد عكس عمولة تلال عند فسخ البيع — مدين 4200 / دائن 1250 (sql/113).';

drop trigger if exists trg_stamp_journal_source_commission_reversal_entry_id on public.reservations;
create trigger trg_stamp_journal_source_commission_reversal_entry_id
  after insert or update of commission_reversal_entry_id on public.reservations
  for each row execute function public.stamp_journal_source('commission_reversal_entry_id');

-- قيود COMMREV القائمة (لا شيء اليوم): تُربط بحجزها إن عُرف
update public.journal_entries e set source_id = r.id
  from public.reservations r
 where r.commission_reversal_entry_id = e.id and e.source_id is distinct from r.id;


create or replace function public.reverse_sale(p_res uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  c public.commissions%rowtype; pr public.payrolls%rowtype;
  v_unit text; v_rev uuid; v_recv uuid; v_entry uuid;
  v_emp_action text := 'لا عمولة موظف';
  v_co_action  text := 'لا عمولة شركة';
begin
  if not public.is_admin() then
    raise exception 'فسخ البيع للمدير';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'اكتب سبب الفسخ';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status <> 'بيع مكتمل' then
    raise exception 'لا يُفسخ إلا بيع مكتمل (الحالة: %)', r.status;
  end if;

  select coalesce(u.unit_code,'') into v_unit from public.units u where u.id = r.unit_id;
  select * into sc from public.sale_commissions where reservation_id = p_res;

  -- ===== عمولة الشركة =====
  if sc.id is not null and coalesce(sc.company_amount,0) > 0 then
    if sc.collected_at is not null then
      raise exception 'عمولة الشركة عن هذه الصفقة محصّلة في % — ردّها للمطوّر حركةٌ نقدية يسجّلها المدير قبل الفسخ',
        sc.collected_at::text;
    end if;

    if r.commission_accrual_entry_id is not null then
      select id into v_rev  from public.accounts where code = '4200';
      select id into v_recv from public.accounts where code = '1250';
      if v_rev is not null and v_recv is not null then
        insert into public.journal_entries (entry_date, description, reference, arm, source)
        values ((now() at time zone 'Asia/Baghdad')::date,
                'عكس عمولة صفقة مفسوخة — الوحدة ' || v_unit || ' — ' || btrim(p_reason),
                'COMMREV', 'إداري عام', 'reservations')
        returning id into v_entry;

        insert into public.journal_lines (entry_id, account_id, debit, credit)
        values (v_entry, v_rev,  sc.company_amount, 0),
               (v_entry, v_recv, 0,                sc.company_amount);

        -- ⚠️ جديد في 113: قيد العكس محفوظ على الحجز (ومحفّز 108 يختم مصدره)
        update public.reservations set commission_reversal_entry_id = v_entry where id = p_res;

        v_co_action := 'عُكس استحقاق ' || public.fmt_qty(sc.company_amount) || ' د.ع';
      end if;
    end if;
  end if;

  -- ===== عمولة الموظف =====
  if sc.commission_id is not null then
    select * into c from public.commissions where id = sc.commission_id;

    if c.id is null then
      v_emp_action := 'العمولة محذوفة سلفاً';

    elsif c.payroll_id is null then
      delete from public.commissions where id = c.id;   -- محفّزها يسحب قيدها
      v_emp_action := 'حُذفت عمولة ' || public.fmt_qty(c.amount) || ' د.ع';

    else
      select * into pr from public.payrolls where id = c.payroll_id;

      if pr.state = 'مسودة' then
        delete from public.payroll_lines
         where payroll_id = pr.id and source_table = 'commissions' and source_id = c.id;
        delete from public.commissions where id = c.id;
        perform public.refresh_payroll_totals(pr.id);
        v_emp_action := 'أُزيلت من كشف ' || pr.period || ' المسوّدة';

      else
        -- ⚠️ الماضي لا يُمسّ: استرداد في الكشف القادم
        insert into public.deductions
          (employee_id, amount, ded_date, reason, created_by, created_by_name)
        values (c.employee_id, c.amount,
                (now() at time zone 'Asia/Baghdad')::date,
                'استرداد عمولة صفقة مفسوخة — الوحدة ' || v_unit,
                auth.uid(),
                (select coalesce(e.full_name, p.email) from public.profiles p
                   left join public.employees e on e.user_id = p.id where p.id = auth.uid()));

        v_emp_action := 'كشف ' || pr.period || ' ' || pr.state ||
                        ' — أُنشئ استرداد ' || public.fmt_qty(c.amount) || ' د.ع للكشف القادم';
      end if;
    end if;
  end if;

  if sc.id is not null then
    update public.sale_commissions
       set reversed_at = now(), reversal_reason = btrim(p_reason)
     where id = sc.id;
  end if;

  update public.invoices
     set cancelled_at = now(), cancel_reason = btrim(p_reason)
   where reservation_id = p_res and cancelled_at is null;

  -- الحجز يُلغى، ومحفّز sync_unit_from_reservation يُعيد الوحدة متاحة
  update public.reservations
     set status = 'ملغى',
         notes = coalesce(notes || E'\n','') || 'فُسخ البيع: ' || btrim(p_reason)
   where id = p_res;

  perform public.log_unit_event(r.unit_id, 'إلغاء حجز',
    'فُسخ بيع الوحدة ' || v_unit || ' — ' || btrim(p_reason));

  return jsonb_build_object(
    'unit', v_unit, 'company', v_co_action, 'employee', v_emp_action,
    'reversal_entry_id', v_entry);
end;
$fn$;


create or replace function public.sale_reversal_preview(p_res uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  r   public.reservations%rowtype;
  sc  public.sale_commissions%rowtype;
  c   public.commissions%rowtype;
  pr  public.payrolls%rowtype;
  v_unit text; v_client text; v_emp text;
  v_block text;
  v_emp_action text := 'لا عمولة موظف';
  v_impact jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'فسخ البيع للمدير';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;
  select cl.name into v_client from public.clients cl where cl.id = r.client_id;
  select * into sc from public.sale_commissions where reservation_id = p_res;

  if r.status <> 'بيع مكتمل' then
    v_block := 'لا يُفسخ إلا بيع مكتمل (الحالة: ' || r.status || ')';
  elsif sc.collected_at is not null then
    v_block := 'عمولة تلال محصّلة في ' || to_char(sc.collected_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD')
               || ' — ردّها للمطوّر حركةٌ نقدية تُسجَّل قبل الفسخ';
  end if;

  if sc.id is not null and coalesce(sc.company_amount, 0) > 0
     and r.commission_accrual_entry_id is not null and sc.collected_at is null then
    v_impact := v_impact || jsonb_build_array(
      jsonb_build_object('code', '4200', 'name', 'إيرادات العمولات', 'debit', sc.company_amount, 'credit', 0,
                         'note', 'يُعكس الإيراد'),
      jsonb_build_object('code', '1250', 'name', 'عمولات مستحقة على المطوّرين', 'debit', 0, 'credit', sc.company_amount,
                         'note', 'تسقط الذمّة على المطوّر'));
  end if;

  if sc.commission_id is not null then
    select * into c from public.commissions where id = sc.commission_id;
    select full_name into v_emp from public.employees where id = c.employee_id;
    if c.id is null then
      v_emp_action := 'العمولة محذوفة سلفاً';
    elsif c.payroll_id is null then
      v_emp_action := 'تُحذف عمولة ' || coalesce(v_emp, '') || ' (' || public.fmt_qty(c.amount)
                      || ' د.ع) ويُسحب قيدها: مدين 2300 / دائن 5500';
      v_impact := v_impact || jsonb_build_array(
        jsonb_build_object('code', '2300', 'name', 'رواتب مستحقة الدفع', 'debit', c.amount, 'credit', 0,
                           'note', 'يُحذف قيد العمولة'),
        jsonb_build_object('code', '5500', 'name', 'عمولات مدفوعة', 'debit', 0, 'credit', c.amount,
                           'note', 'يُحذف قيد العمولة'));
    else
      select * into pr from public.payrolls where id = c.payroll_id;
      if pr.state = 'مسودة' then
        v_emp_action := 'تُزال عمولة ' || coalesce(v_emp, '') || ' من كشف ' || pr.period
                        || ' المسوّدة وتُحذف مع قيدها';
      else
        v_emp_action := 'كشف ' || pr.period || ' ' || pr.state || ' — لا يُمسّ؛ يُنشأ استرداد '
                        || public.fmt_qty(c.amount) || ' د.ع على ' || coalesce(v_emp, '')
                        || ' في كشفه القادم';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'reservation_id',   r.id,
    'unit',             v_unit,
    'client',           v_client,
    'status',           r.status,
    'sale_price',       r.sale_price,
    'down_payment',     r.down_payment_amount,
    'confirmed_at',     r.down_payment_confirmed_at,
    'company_rate',     sc.company_rate,
    'company_amount',   sc.company_amount,
    'collected_at',     sc.collected_at,
    'accrual_entry_id', r.commission_accrual_entry_id,
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'number', di.invoice_number, 'amount', di.amount,
               'sent', di.sent_at is not null, 'cancelled', di.cancelled_at is not null,
               'id', di.id) order by di.created_at)
        from public.developer_invoices di where di.reservation_id = r.id), '[]'::jsonb),
    'employee',        v_emp,
    'employee_amount', c.amount,
    'employee_action', v_emp_action,
    'impact',          v_impact,
    'can_reverse',     v_block is null,
    'blocked_reason',  v_block
  );
end;
$fn$;

comment on function public.sale_reversal_preview(uuid) is
  'ما سيحدث عند فسخ البيع — في الدفاتر وعمولة الموظف وفواتير المطوّر — قبل التنفيذ. للمدير (sql/113).';

revoke execute on function public.sale_reversal_preview(uuid) from public, anon;
grant  execute on function public.sale_reversal_preview(uuid) to authenticated;

notify pgrst, 'reload schema';
