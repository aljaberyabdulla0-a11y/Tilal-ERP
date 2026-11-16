-- ============================================================
-- تلال ERP — 226b: اختبارات سند قبض العمولة ودفتر الصندوق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_commission_receipts();
--
-- ===== العزل =====
--
-- يعمل على صفقة حقيقية مؤكَّدة لم تُحصَّل (أقدمها)، وكل شيء داخل
-- معاملة فرعية تُلغى في النهاية (نمط 115). دور «المحاسب» يُمنح مؤقتاً
-- لموظف داخل المعاملة الملغاة. لا يترك بيانات — ورقم السند المستهلَك
-- من التسلسل وحده يبقى فجوةً في الترقيم.
--
-- ===== ما يُختبر =====
--
--   الترحيل الرجعي   كل تحصيل قائم له سند مطابق لقيده
--   الصلاحيات        الموظف لا يحصّل؛ المحاسب يحصّل ولا يلغي؛ المدير يلغي
--   المدخلات         طريقة غير معروفة، تاريخ مستقبلي، تاريخ قبل المقدمة
--   التحصيل نقداً    سند + قيد مدين 1100 / دائن 1250، والأرصدة، ولا إيراد جديد
--   منع التكرار      الاستدعاء الثاني مرفوض، والفهرس الفريد يرفض سنداً ثانياً،
--                    وقيد استحقاق ثانٍ للحجز نفسه مرفوض
--   دفتر الصندوق     التحصيل يظهر قبضاً برابط الوحدة؛ مجموع الأثر = رصيد النقد
--   الفسخ            مرفوض ما دامت محصّلة، والمعاينة تدلّ على إلغاء التحصيل
--   الإلغاء          قيد عكسي مرتبط بالأصل، السند يبقى ملغى، الأرصدة تعود،
--                    ولا يُلغى مرتين
--   التحصيل بالبنك   سند جديد + قيد مدين 1200 / دائن 1250
--   صحّة المحاسبة    لا قيد يتيم من السندات؛ فرق 1250 لم يتغيّر؛ التحصيل بلا
--                    سند يُكشف
--   المتصفّح         لا يكتب في السندات؛ الموظف لا يقرؤها
--   الردّ والفسخ     إلغاء التحصيل ثم الفسخ: النقد يعود والإيراد يُعكس
--   الـ commit       كل القيود المؤجَّلة تمرّ
--
-- security invoker عمداً (set local role ممنوع داخل definer).
-- يتطلب: 082، 115 (tests.jl)، 226. آمن لإعادة التشغيل.
-- ============================================================

-- رصيد حساب في الدفتر كلّه: مدين − دائن
create or replace function tests.bal(p_code text)
returns numeric language sql stable as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.journal_lines l join public.accounts a on a.id = l.account_id
   where a.code = p_code;
$$;

create or replace function tests.run_commission_receipts()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log      text[] := '{}';
  admin_u  uuid; plain_u uuid;
  res uuid; sc_id uuid; v_unit uuid; v_amt numeric; v_dp date;
  v_today  date := (now() at time zone 'Asia/Baghdad')::date;
  rc uuid; rc2 uuid; je uuid; je2 uuid; rv uuid; rv2 uuid;
  b_cash numeric; b_bank numeric; b_recv numeric; b_rev numeric; h_sub numeric;
  n int; n0 int; v numeric; j jsonb; txt text; ok_ boolean;
  i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into plain_u from public.profiles where role = 'employee' order by created_at limit 1;

  select r.id, sc.id, r.unit_id, sc.company_amount,
         (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date
    into res, sc_id, v_unit, v_amt, v_dp
    from public.reservations r join public.sale_commissions sc on sc.reservation_id = r.id
   where r.status = 'بيع مكتمل' and r.commission_accrual_entry_id is not null
     and r.commission_collect_entry_id is null
     and sc.collected_at is null and sc.reversed_at is null and coalesce(sc.company_amount, 0) > 0
     and not exists (select 1 from public.commission_receipts cr
                      where cr.reservation_id = r.id and cr.cancelled_at is null)
   order by r.created_at limit 1;

  if admin_u is null or plain_u is null or res is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظف وصفقة مؤكَّدة لم تُحصَّل'::text;
    return;
  end if;

  begin
    perform tests.act_as(admin_u);

    -- ================= الترحيل الرجعي =================
    log := log || extensions.ok(
      not exists (select 1 from public.accounting_health() h where h.check_code = 'RCPT_MISMATCH'),
      'كل تحصيل قائم له سند قبض سارٍ يطابق قيده ومبلغه');

    if not exists (select 1 from public.developer_invoices
                    where reservation_id = res and cancelled_at is null) then
      perform public.issue_developer_invoice(res, 'مطوّر الاختبار', null, null, null);
    end if;

    b_cash := tests.bal('1100'); b_bank := tests.bal('1200');
    b_recv := tests.bal('1250'); b_rev  := tests.bal('4200');
    select coalesce(max(h.amount), 0) into h_sub
      from public.accounting_health() h where h.check_code = 'SUB_1250';
    select count(*) into n0 from public.journal_entries
     where source = 'sale_commissions' and source_id = sc_id and reference = 'COMMIN';

    -- ================= الصلاحيات والمدخلات =================
    perform tests.act_as(plain_u);
    begin
      perform public.collect_company_commission(res, null, 'نقد', null);
      log := log || extensions.fail('الموظف لا يسجّل تحصيلاً');
    exception when others then log := log || extensions.pass('الموظف لا يسجّل تحصيلاً'); end;
    begin
      perform public.cash_book();
      log := log || extensions.fail('الموظف لا يرى دفتر الصندوق');
    exception when others then log := log || extensions.pass('الموظف لا يرى دفتر الصندوق'); end;

    perform tests.act_as(admin_u);
    begin
      perform public.collect_company_commission(res, null, 'شيك', null);
      log := log || extensions.fail('طريقة قبض غير معروفة مرفوضة');
    exception when others then log := log || extensions.pass('طريقة قبض غير معروفة مرفوضة'); end;
    begin
      perform public.collect_company_commission(res, v_today + 1, 'نقد', null);
      log := log || extensions.fail('تاريخ تحصيل مستقبلي مرفوض');
    exception when others then log := log || extensions.pass('تاريخ تحصيل مستقبلي مرفوض'); end;
    begin
      perform public.collect_company_commission(res, v_dp - 1, 'نقد', null);
      log := log || extensions.fail('تاريخ تحصيل قبل تأكيد المقدمة مرفوض');
    exception when others then log := log || extensions.pass('تاريخ تحصيل قبل تأكيد المقدمة مرفوض'); end;
    log := log || extensions.ok(
      tests.bal('1100') = b_cash and tests.bal('1250') = b_recv
      and not exists (select 1 from public.commission_receipts where reservation_id = res and cancelled_at is null),
      'المحاولات المرفوضة لا تترك سنداً ولا قيداً');

    -- ================= التحصيل نقداً =================
    rc := public.collect_company_commission(res, v_today, 'نقد', 'اختبار');
    select journal_entry_id into je from public.commission_receipts where id = rc;

    log := log || extensions.ok(
      tests.jl(je, '1100') = v_amt and tests.jl(je, '1250') = -v_amt and tests.jl(je, '1200') = 0
      and (select sum(debit) = sum(credit) from public.journal_lines where entry_id = je),
      'تحصيل نقدي: قيد متوازن مدين 1100 / دائن 1250');
    log := log || extensions.ok(
      (select e.reference = 'COMMIN' and e.source = 'sale_commissions' and e.source_id = sc_id
              and e.entry_date = v_today
              and e.project_id is not distinct from public.journal_project_for('sale_commissions', sc_id)
         from public.journal_entries e where e.id = je),
      'قيد التحصيل مربوط بسجلّ عمولة الصفقة ومشروعها');
    log := log || extensions.ok(
      (select cr.amount = v_amt and cr.method = 'نقد' and cr.receipt_date = v_today
              and cr.receipt_number ~ '^RCV-[0-9]{4,}$' and cr.cancelled_at is null
              and cr.developer_invoice_id is not null and cr.sale_commission_id = sc_id
         from public.commission_receipts cr where cr.id = rc),
      'سند القبض: رقم، مبلغ العمولة المجمَّد، الطريقة، الفاتورة');
    log := log || extensions.ok(
      (select collected_at = v_today from public.sale_commissions where id = sc_id)
      and (select commission_collect_entry_id = je from public.reservations where id = res),
      'الصفقة معلَّمة محصّلة وقيد السند محفوظ على الحجز');
    log := log || extensions.ok(
      tests.bal('1100') = b_cash + v_amt and tests.bal('1250') = b_recv - v_amt
      and tests.bal('4200') = b_rev and tests.bal('1200') = b_bank,
      'الأرصدة: الصندوق +العمولة، ذمّة المطوّر −العمولة، ولا إيراد جديد');

    -- ================= منع التكرار =================
    begin
      perform public.collect_company_commission(res, v_today, 'نقد', null);
      log := log || extensions.fail('التحصيل مرّة ثانية مرفوض');
    exception when others then log := log || extensions.pass('التحصيل مرّة ثانية مرفوض'); end;
    begin
      perform public.collect_company_commission(res, v_today, 'بنك', null);
      log := log || extensions.fail('التحصيل مرّة ثانية بطريقة أخرى مرفوض');
    exception when others then log := log || extensions.pass('التحصيل مرّة ثانية بطريقة أخرى مرفوض'); end;
    select count(*) into n from public.journal_entries
     where source = 'sale_commissions' and source_id = sc_id and reference = 'COMMIN';
    log := log || extensions.ok(n = n0 + 1 and tests.bal('1100') = b_cash + v_amt,
      'إعادة المحاولة لا تكتب قيداً ثانياً ولا تغيّر الصندوق');

    begin
      insert into public.commission_receipts (reservation_id, sale_commission_id, amount, method, receipt_date)
      values (res, sc_id, v_amt, 'نقد', v_today);
      log := log || extensions.fail('الفهرس الفريد يرفض سنداً سارياً ثانياً للصفقة');
    exception
      when unique_violation then log := log || extensions.pass('الفهرس الفريد يرفض سنداً سارياً ثانياً للصفقة');
      when others then log := log || extensions.fail('الفهرس الفريد يرفض سنداً سارياً ثانياً للصفقة: ' || sqlerrm);
    end;
    begin
      insert into public.journal_entries (entry_date, description, reference, arm, source, source_id)
      values (v_today, 'اختبار تكرار الاستحقاق', 'COMMDUE', 'إداري عام', 'reservations', res);
      log := log || extensions.fail('قيد استحقاق ثانٍ للحجز نفسه مرفوض');
    exception
      when unique_violation then log := log || extensions.pass('قيد استحقاق ثانٍ للحجز نفسه مرفوض');
      when others then log := log || extensions.fail('قيد استحقاق ثانٍ للحجز نفسه مرفوض: ' || sqlerrm);
    end;
    log := log || extensions.ok(
      (select prosrc ~ 'where id = p_res for update' from pg_proc
        where oid = 'public.confirm_down_payment(uuid,numeric,numeric)'::regprocedure)
      and (select prosrc ~ 'where id = p_id for update' from pg_proc
            where oid = 'public.disburse_advance(uuid,text,date)'::regprocedure)
      and (select prosrc ~ 'where id = p_res for update' from pg_proc
            where oid = 'public.collect_company_commission(uuid,date,text,text)'::regprocedure),
      'تأكيد المقدمة وصرف السلفة والتحصيل تقفل صفّها قبل الترحيل');

    -- ================= دفتر الصندوق =================
    j := public.cash_book('قبض', null, null, null, 100000);
    log := log || extensions.ok(
      exists (select 1 from jsonb_array_elements(j->'rows') x
               where (x->>'entry_id')::uuid = je and x->>'kind' = 'auto'
                 and (x->>'amount')::numeric = v_amt and x->>'method' = 'نقد'
                 and x->>'direction' = 'قبض'
                 and x->>'link' = '/dashboard/units/' || v_unit),
      'التحصيل يظهر قبضاً في الحركات المالية برابط وحدته');
    log := log || extensions.ok((j->>'total_in')::numeric >= v_amt,
      'إجمالي المقبوض يشمل تحصيل العمولة');

    j := public.cash_book(null, null, null, null, 100000);
    select coalesce(sum((x->>'cash_effect')::numeric), 0) into v
      from jsonb_array_elements(j->'rows') x;
    log := log || extensions.ok(
      v = tests.bal('1100') + tests.bal('1200')
      and (j->>'cash')::numeric = tests.bal('1100') and (j->>'bank')::numeric = tests.bal('1200'),
      'مطابقة: مجموع أثر الحركات = رصيد الصندوق + البنك في الدفتر');

    -- ================= الفسخ ممنوع ما دامت محصّلة =================
    j := public.sale_reversal_preview(res);
    log := log || extensions.ok(
      not (j->>'can_reverse')::boolean and j->>'blocked_reason' like '%إلغاء التحصيل%',
      'معاينة الفسخ تمنع المحصّلة وتدلّ على إلغاء التحصيل');
    begin
      perform public.reverse_sale(res, 'اختبار');
      log := log || extensions.fail('فسخ صفقة محصّلة مرفوض');
    exception when others then log := log || extensions.pass('فسخ صفقة محصّلة مرفوض'); end;

    -- ================= الإلغاء =================
    begin
      perform public.cancel_commission_collection(res, '  ', null);
      log := log || extensions.fail('إلغاء التحصيل بلا سبب مرفوض');
    exception when others then log := log || extensions.pass('إلغاء التحصيل بلا سبب مرفوض'); end;
    begin
      perform public.cancel_commission_collection(res, 'اختبار', v_today + 1);
      log := log || extensions.fail('إلغاء بتاريخ مستقبلي مرفوض');
    exception when others then log := log || extensions.pass('إلغاء بتاريخ مستقبلي مرفوض'); end;

    -- محاسب مؤقّت: يحصّل ولا يلغي
    perform tests.act_as(null);
    update public.profiles set role = 'accountant' where id = plain_u;
    perform tests.act_as(plain_u);
    begin
      perform public.cancel_commission_collection(res, 'اختبار', null);
      log := log || extensions.fail('المحاسب لا يلغي تحصيلاً');
    exception when others then log := log || extensions.pass('المحاسب لا يلغي تحصيلاً'); end;

    perform tests.act_as(admin_u);
    j  := public.cancel_commission_collection(res, 'اختبار إلغاء', null);
    rv := (j->>'reversal_entry_id')::uuid;

    log := log || extensions.ok(
      tests.jl(rv, '1250') = v_amt and tests.jl(rv, '1100') = -v_amt
      and (select sum(debit) = sum(credit) from public.journal_lines where entry_id = rv),
      'إلغاء التحصيل: قيد عكسي متوازن مدين 1250 / دائن 1100');
    log := log || extensions.ok(
      (select e.reference = 'COMMINREV' and e.reversal_of = je and e.source = 'sale_commissions'
              and e.source_id = sc_id
              and e.project_id is not distinct from (select project_id from public.journal_entries where id = je)
         from public.journal_entries e where e.id = rv),
      'القيد العكسي مرتبط بالقيد الأصلي وبالصفقة');
    log := log || extensions.ok(
      (select cr.cancelled_at is not null and cr.cancel_entry_id = rv and cr.cancel_reason = 'اختبار إلغاء'
              and cr.cancel_date = v_today and cr.journal_entry_id = je
         from public.commission_receipts cr where cr.id = rc)
      and exists (select 1 from public.journal_entries where id = je),
      'السند يُعلَّم ملغى ويبقى مع قيده الأصلي — لا حذف');
    log := log || extensions.ok(
      (select collected_at is null from public.sale_commissions where id = sc_id)
      and (select commission_collect_entry_id is null from public.reservations where id = res),
      'الصفقة تعود غير محصّلة');
    log := log || extensions.ok(
      tests.bal('1100') = b_cash and tests.bal('1250') = b_recv and tests.bal('4200') = b_rev,
      'الأرصدة تعود كما كانت قبل التحصيل');
    begin
      perform public.cancel_commission_collection(res, 'مرّة ثانية', null);
      log := log || extensions.fail('لا يُلغى التحصيل مرتين');
    exception when others then log := log || extensions.pass('لا يُلغى التحصيل مرتين'); end;

    -- ================= التحصيل بالبنك (والمحاسب يحصّل) =================
    perform tests.act_as(plain_u);
    begin
      rc2 := public.collect_company_commission(res, v_today, 'بنك', null);
      log := log || extensions.pass('المحاسب يسجّل التحصيل');
    exception when others then
      log := log || extensions.fail('المحاسب يسجّل التحصيل: ' || sqlerrm);
    end;
    perform tests.act_as(admin_u);
    if rc2 is null then
      rc2 := public.collect_company_commission(res, v_today, 'بنك', null);
    end if;
    select journal_entry_id into je2 from public.commission_receipts where id = rc2;

    log := log || extensions.ok(
      tests.jl(je2, '1200') = v_amt and tests.jl(je2, '1250') = -v_amt and tests.jl(je2, '1100') = 0,
      'تحصيل بالبنك: مدين 1200 / دائن 1250');
    log := log || extensions.ok(
      rc2 <> rc
      and (select a.receipt_number <> b.receipt_number
             from public.commission_receipts a, public.commission_receipts b
            where a.id = rc and b.id = rc2)
      and (select count(*) = 1 from public.commission_receipts
            where reservation_id = res and cancelled_at is null),
      'إعادة التحصيل بعد الإلغاء: سند جديد برقم جديد، وسارٍ واحد');
    log := log || extensions.ok(
      tests.bal('1200') = b_bank + v_amt and tests.bal('1100') = b_cash
      and tests.bal('1250') = b_recv - v_amt,
      'الأرصدة: البنك +العمولة، والصندوق لم يُمسّ');
    j := public.cash_book('قبض', null, null, null, 100000);
    log := log || extensions.ok(
      exists (select 1 from jsonb_array_elements(j->'rows') x
               where (x->>'entry_id')::uuid = je2 and x->>'method' = 'بنك'),
      'تحصيل البنك يظهر في الحركات المالية بطريقته');

    -- ================= صحّة المحاسبة =================
    log := log || extensions.ok(
      not exists (select 1 from public.accounting_health() h
                   where h.check_code = 'JRN_ORPHAN' and h.ref_id in (je, rv, je2))
      and not exists (select 1 from public.accounting_health() h where h.check_code = 'RCPT_MISMATCH'),
      'فحص الصحّة: قيود السندات (الأصلي والعكسي والجديد) ليست يتيمة');
    select coalesce(max(h.amount), 0) into v
      from public.accounting_health() h where h.check_code = 'SUB_1250';
    log := log || extensions.is(v, h_sub, 'فحص الصحّة: فرق ذمم المطوّرين 1250 لم يتغيّر بالتحصيل');

    update public.sale_commissions set collected_at = null where id = sc_id;
    log := log || extensions.ok(
      exists (select 1 from public.accounting_health() h
               where h.check_code = 'RCPT_MISMATCH' and h.ref_id = res),
      'فحص الصحّة يكشف سنداً سارياً وصفقته غير معلَّمة محصّلة');
    update public.sale_commissions set collected_at = v_today where id = sc_id;

    -- ================= المتصفّح لا يكتب في السندات =================
    perform tests.act_as(null);
    update public.profiles set role = 'employee' where id = plain_u;

    perform tests.act_as(admin_u);
    n := -1;
    set local role authenticated;
    begin
      update public.commission_receipts set amount = amount + 1 where id = rc2;
      get diagnostics n = row_count;
    exception when others then n := 0; end;
    reset role;
    log := log || extensions.ok(n = 0, 'المتصفّح لا يعدّل سند قبض — حتى المدير');

    n := -1;
    set local role authenticated;
    begin
      delete from public.commission_receipts where id = rc2;
      get diagnostics n = row_count;
    exception when others then n := 0; end;
    reset role;
    log := log || extensions.ok(n = 0, 'المتصفّح لا يحذف سند قبض');

    ok_ := false;
    set local role authenticated;
    begin
      insert into public.commission_receipts (reservation_id, sale_commission_id, amount, method, receipt_date)
      values (res, sc_id, 1, 'نقد', v_today);
    exception when others then ok_ := true; end;
    reset role;
    log := log || extensions.ok(ok_, 'المتصفّح لا يُدرج سند قبض بلا قيد');

    log := log || extensions.ok(
      tests.count_as(admin_u, 'select count(*) from public.commission_receipts') >= 2
      and tests.count_as(plain_u, 'select count(*) from public.commission_receipts') = 0,
      'السندات يقرؤها المدير، ولا يراها الموظف');

    -- ================= الردّ ثم الفسخ =================
    perform tests.act_as(admin_u);
    begin
      j   := public.cancel_commission_collection(res, 'ردّ العمولة للمطوّر — اختبار', null);
      rv2 := (j->>'reversal_entry_id')::uuid;
      log := log || extensions.ok(
        tests.jl(rv2, '1250') = v_amt and tests.jl(rv2, '1200') = -v_amt and tests.jl(rv2, '1100') = 0,
        'إلغاء تحصيل البنك يُخرج المبلغ من البنك لا من الصندوق');

      j := public.reverse_sale(res, 'اختبار الردّ والفسخ');
      log := log || extensions.ok(
        tests.bal('1100') = b_cash and tests.bal('1200') = b_bank
        and tests.bal('1250') = b_recv - v_amt and tests.bal('4200') = b_rev + v_amt,
        'الردّ ثم الفسخ: النقد كما كان، الذمّة سقطت، والإيراد عُكس');
      log := log || extensions.ok(
        (select count(*) = 2 and bool_and(cancelled_at is not null)
           from public.commission_receipts where reservation_id = res),
        'تاريخ الصفقة محفوظ: سندان ملغيان بقيودهما');
    exception when others then
      log := log || extensions.fail('الردّ ثم الفسخ: ' || sqlerrm);
    end;

    -- ================= الـ commit =================
    begin
      set constraints all immediate;
      log := log || extensions.pass('كل قيود الاختبار متوازنة عند الـ commit');
    exception when others then
      log := log || extensions.fail('قيود الاختبار عند الـ commit: ' || sqlerrm);
    end;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات سند القبض: ' || sqlerrm || ' @ ' || left(txt, 300));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_commission_receipts() is
  'اختبارات سند قبض العمولة: نقد، بنك، منع التكرار، الإلغاء بقيد عكسي، الردّ والفسخ، دفتر الصندوق، صحّة المحاسبة، الأدوار. يُلغي أثره (sql/226b).';

revoke all on function tests.run_commission_receipts() from public;
revoke all on function tests.bal(text) from public;
grant execute on function tests.run_commission_receipts() to service_role;
