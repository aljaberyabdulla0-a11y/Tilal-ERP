-- ============================================================
-- تلال ERP — 106: حذف كشف الراتب بيد المدير
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- لا زرّ حذف للكشف في الواجهة. والحذف المباشر من الجدول (تسمح به
-- سياسة المدير والموارد البشرية) خطِر على الكشف المعتمد: يذهب
-- الكشف ويبقى قيدُه في الدفاتر — دَينٌ للموظف على الشركة بلا كشف.
-- ومعه أقساط السلفة «محصّلة» من كشفٍ لم يعد موجوداً.
--
-- ===== ما يضيفه =====
--
--   delete_payroll(id) — للمدير وحده (is_admin):
--     • مسوّدة أو معتمد لم يُدفع منه شيء. المقفل والمدفوع لا —
--       الحارس trg_guard_payroll_delete (051) يفرض ذلك أصلاً.
--     • يسحب القيد من الدفاتر كما تفعل reopen_payroll، فإن كان
--       الشهر مقفلاً محاسبياً رفض حارس الفترات (063) والحذف كلّه.
--     • الأقساط المحصّلة تعود مستحقّة، والسلفة تعود مصروفة.
--     • العمولات والاستقطاعات تعود حرّة لكشفٍ قادم (on delete set
--       null على payroll_id)، والبنود تُحذف معه (cascade).
--     • يحذف إشعار «كشف راتبك جاهز» — لم يعد صحيحاً.
--
--   والحارس يرفض الآن حذف كشفٍ له قيد بغير هذه الدالة، فلا يتيتّم
--   قيدٌ في الدفاتر.
--
-- يتطلب: sql/051 و sql/062. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.guard_payroll_delete()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.state = 'مقفل' then
    raise exception 'الكشف مقفل — لا يُحذف';
  end if;
  if exists (select 1 from public.payroll_payments where payroll_id = old.id) then
    raise exception 'دُفع من هذا الكشف — لا يُحذف قبل حذف دفعاته';
  end if;
  -- delete_payroll تسحب القيد قبل الحذف، فلا يصل إلى هنا قيدٌ إلا
  -- من حذفٍ مباشر يتركه يتيماً في الدفاتر.
  if old.journal_entry_id is not null then
    raise exception 'الكشف مُرحَّل في الدفاتر — احذفه بزرّ «حذف الكشف» ليُسحب قيده معه';
  end if;
  return old;
end;
$fn$;

create or replace function public.delete_payroll(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare r public.payrolls%rowtype;
begin
  if not public.is_admin() then
    raise exception 'حذف كشوف الرواتب للمدير';
  end if;

  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state = 'مقفل' then raise exception 'الكشف مقفل — لا يُحذف'; end if;
  if exists (select 1 from public.payroll_payments where payroll_id = p_id) then
    raise exception 'دُفع من هذا الكشف — احذف دفعاته أولاً';
  end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
  end if;

  -- الأقساط تعود مستحقّة، والسلفة المسدَّدة تعود مصروفة (كما في reopen)
  update public.advance_installments
     set status = 'مستحق', collected_at = null
   where payroll_id = p_id and status = 'محصّل';

  update public.employee_advances a set status = 'مصروفة'
   where a.status = 'مسدَّدة' and public.advance_remaining(a.id) > 0;

  delete from public.notifications where kind = 'راتب' and entity_id = p_id;

  -- مسوّدةً أولاً: حارس البنود (051) يرفض حذفها من كشفٍ معتمد
  update public.payrolls
     set state = 'مسودة', journal_entry_id = null, approved_at = null, approved_by = null
   where id = p_id;

  delete from public.payrolls where id = p_id;
end;
$fn$;

revoke all on function public.delete_payroll(uuid) from public, anon;
grant execute on function public.delete_payroll(uuid) to authenticated;

notify pgrst, 'reload schema';
