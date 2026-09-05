-- ============================================================
-- تلال ERP — 065: الإلغاء والفسخ (المرحلة ٥/ب)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== إلغاء الحجز — بسيطٌ بعد sql/056 =====
--
-- كان في المواصفة الأصلية: «ردّ العربون (مدين 2400 / دائن 1100)
-- أو مصادرته (مدين 2400 / دائن إيراد)». وهذا كان صحيحاً لو كانت
-- تلال هي البائعة.
--
-- لكن العربون [ب] يذهب للمطوّر ولا يمرّ بصندوق تلال، فلا قيد له
-- أصلاً — **ولا قيد لردّه ولا لمصادرته**. ردُّه أو مصادرته شأنٌ
-- بين المشتري والمطوّر، وتلال تسجّله متابعةً لا محاسبةً.
-- فالإلغاء عندنا: الحجز «ملغى»، والوحدة تعود «متاحة»، وانتهى.
--
-- ===== فسخ البيع — أصعب حالة في النظام =====
--
-- ثلاث حالات لعمولة الموظف، ولكلٍّ علاجها:
--
--   ١) لم تدخل كشفاً        → تُحذف، ومحفّزها يسحب قيدها.
--   ٢) في كشفٍ **مسوّدة**    → يُحذف بندها ثم تُحذف.
--   ٣) في كشفٍ **معتمد أو مدفوع** → **لا يُمسّ الماضي**. يُنشأ
--      استقطاع استرداد في الكشف القادم.
--
-- ⚠️ والثالثة هي بيت القصيد. البدائل التي رُفضت:
--   • إعادة فتح الكشف القديم وحذف البند: يكسر مبدأ تجميد الكشف
--     المعتمد، ويستحيل أصلاً لو كانت فترته مقفلة (sql/063)، ولا
--     يجوز البتّة لو كان مدفوعاً — نقدٌ خرج فعلاً.
--   • قيدٌ عكسي بتاريخ الكشف القديم: يمسّ ميزانية شهرٍ عُرض.
--   • تجاهلها: الشركة تخسر عمولةً دفعتها على صفقة لم تتم.
--
--   والاسترداد في الشهر القادم هو الجواب المحاسبي المعتاد: لا
--   يُعاد كتابة التاريخ، ويُسترَدّ المال من مصدره.
--
-- ===== عمولة الشركة =====
--   لم تُحصَّل → قيدٌ عاكس: مدين 4200 / دائن 1250
--   حُصّلت    → **يُرفض الفسخ آلياً**: المال دخل الصندوق، وردُّه
--               للمطوّر قرارٌ وحركةٌ نقدية تُسجَّل بيد المدير.
--
-- ===== التراجع =====
--   الفسخ لا يُتراجع عنه آلياً — يُعاد إتمام البيع من جديد.
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة:
--   cancellation_and_reversal
--
-- يتطلب: sql/056 (النموذج) و sql/063 (قفل الفترات).
-- آمن لإعادة التشغيل.
-- ============================================================

alter table public.sale_commissions
  add column if not exists reversed_at     timestamptz,
  add column if not exists reversal_reason text;

alter table public.invoices
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text;

comment on column public.sale_commissions.reversed_at is
  'فُسخت الصفقة. النِّسب تبقى مجمّدة كما كانت — الفسخ لا يعيد كتابة التاريخ (sql/065).';

-- ------------------------------------------------------------
-- إلغاء الحجز
-- ------------------------------------------------------------
create or replace function public.cancel_reservation(p_res uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare r public.reservations%rowtype; v_unit text;
begin
  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;

  if not exists (select 1 from public.units u
                  where u.id = r.unit_id and public.can_manage_project(u.project_id)) then
    raise exception 'إلغاء الحجز للإدارة';
  end if;

  if r.status = 'بيع مكتمل' then
    raise exception 'هذه صفقة مكتملة — استعمل فسخ البيع لا إلغاء الحجز';
  end if;
  if r.status = 'ملغى' then raise exception 'الحجز ملغى بالفعل'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'اكتب سبب الإلغاء';
  end if;

  select coalesce(u.unit_code,'') into v_unit from public.units u where u.id = r.unit_id;

  -- ⚠️ لا قيد: العربون لم يدخل صندوق تلال أصلاً (sql/056).
  update public.reservations
     set status = 'ملغى',
         notes = coalesce(notes || E'\n', '') || 'أُلغي: ' || btrim(p_reason)
   where id = p_res;

  perform public.log_unit_event(r.unit_id, 'إلغاء حجز',
    'أُلغي حجز الوحدة ' || v_unit || ' — ' || btrim(p_reason));
end;
$fn$;

-- ------------------------------------------------------------
-- فسخ البيع
-- ------------------------------------------------------------
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
    'unit', v_unit, 'company', v_co_action, 'employee', v_emp_action);
end;
$fn$;

revoke execute on function public.cancel_reservation(uuid, text) from public, anon;
revoke execute on function public.reverse_sale(uuid, text)       from public, anon;
grant  execute on function public.cancel_reservation(uuid, text) to authenticated;
grant  execute on function public.reverse_sale(uuid, text)       to authenticated;

notify pgrst, 'reload schema';
