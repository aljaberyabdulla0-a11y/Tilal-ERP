-- ============================================================
-- تلال ERP — 105: تعديل بند في كشف الراتب
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- منذ sql/051 يُضاف البند ويُحذف ولا يُعدَّل. فتصحيح رقمٍ واحد
-- كان حذفاً ثم إضافة — والراتب الأساسي لا يُعاد أصلاً: فئته ليست
-- في نموذج الإضافة. فمن أراد أن يصرف لموظفٍ نصف أساسيّه هذا الشهر
-- لم يجد طريقاً.
--
-- ===== ما يضيفه =====
--
--   update_payroll_line(line, amount, description)
--     • على المسوّدة وحدها — الحارس trg_guard_payroll_lines (051)
--       يفرض ذلك أصلاً. والمعتمد يُعاد فتحه أولاً كما كان.
--     • لمن يبني الكشف: can_manage_hr() — كالإضافة والحذف (068).
--     • يحفظ المبلغ الأصلي ومن عدّله ومتى، فيظهر في الكشف
--       «عُدّل من كذا». والتفصيل الكامل في audit_log (058).
--
-- ⚠️ بندان لا يُعدَّل مبلغهما، والوصف يُعدَّل:
--   • العمولة: تُرحَّل إلى الدفاتر لحظة استحقاقها (019). لو تغيّر
--     مبلغها في الكشف لافترق الصافي عن القيد. تُعدَّل العمولة
--     نفسها، أو يُحذف البند.
--   • قسط السلفة: رصيد السلفة يُحسب من مبالغ الأقساط (062). لو
--     تغيّر المبلغ هنا لبقي الرصيد على حاله.
--
-- ⚠️ إعادة الحساب (build_payroll) تمسح البنود وتبنيها من جديد —
--    فيضيع التعديل كما تضيع البنود اليدوية. هذا سلوك 051 لم يتغيّر.
--
-- يتطلب: sql/051 و sql/068. آمن لإعادة التشغيل.
-- ============================================================

alter table public.payroll_lines
  add column if not exists original_amount numeric,
  add column if not exists edited_at       timestamptz,
  add column if not exists edited_by       uuid references auth.users(id) on delete set null,
  add column if not exists edited_by_name  text;

comment on column public.payroll_lines.original_amount is
  'المبلغ قبل أول تعديل يدوي. فارغ = لم يُعدَّل مبلغه (sql/105).';

create or replace function public.update_payroll_line(
  p_line        uuid,
  p_amount      numeric,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare l public.payroll_lines%rowtype; v_state text; v_who text;
begin
  if not public.can_manage_hr() then
    raise exception 'تعديل بنود الراتب للمدير أو الموارد البشرية';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر';
  end if;

  select * into l from public.payroll_lines where id = p_line;
  if not found then raise exception 'البند غير موجود'; end if;

  select state into v_state from public.payrolls where id = l.payroll_id;
  if v_state <> 'مسودة' then
    raise exception 'الكشف % — أعِد فتحه أولاً ثم عدّل', v_state;
  end if;

  if p_amount <> l.amount and l.source_table = 'commissions' then
    raise exception 'مبلغ العمولة مُرحَّل في الدفاتر عند استحقاقها — عدّل العمولة نفسها أو احذف البند';
  end if;
  if p_amount <> l.amount and l.source_table = 'advance_installments' then
    raise exception 'مبلغ القسط من جدول السلفة — عدّله من ملفّ السلفة أو احذف البند';
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  update public.payroll_lines
     set amount          = p_amount,
         description     = nullif(btrim(coalesce(p_description, '')), ''),
         original_amount = case
                             when p_amount <> l.amount then coalesce(l.original_amount, l.amount)
                             else l.original_amount
                           end,
         edited_at       = now(),
         edited_by       = auth.uid(),
         edited_by_name  = v_who
   where id = p_line;
  -- المجاميع يعيد حسابها trg_payroll_line_totals (051)
end;
$fn$;

revoke all on function public.update_payroll_line(uuid, numeric, text) from public, anon;
grant execute on function public.update_payroll_line(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
