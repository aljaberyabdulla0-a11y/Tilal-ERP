-- ============================================================
-- تلال ERP — 118: تعديل الكشف — شهره، وإعادة بناء بنوده له
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- الكشف يُبنى لشهرٍ ولا يُنقل منه. فمن بنى كشف 2026-10 وهو يقصد
-- 2026-09 لم يجد إلا الحذف — وحذف المسوّدة للمدير وحده (106). وما
-- فعله المستخدم فعلاً (2026-10-01): حذف بنود الكشف الخطأ بنداً بنداً
-- حتى فرغ، فبقي صافيه 750,000 على شاشةٍ تقول «لا استحقاقات».
--
-- ===== ما يضيفه =====
--
--   update_payroll_period(id, period, rebuild)
--     • للمسوّدة وحدها، ولمن يبني الكشف: can_manage_hr() (068).
--     • يرفض شهراً للموظف فيه كشفٌ آخر — الفهرس الفريد (051) كان
--       سيرفضه برسالةٍ لا تُفهم.
--     • يرفض شهراً قبل المباشرة أو بعد انتهاء الخدمة، كما يرفضه build_payroll (119).
--     • rebuild = true: يُعاد بناء البنود للشهر الجديد بـ build_payroll —
--       الدوام والإجازات والاستقطاعات القانونية والأقساط كلّها مرتبطة
--       بالشهر، فنقل التاريخ وحده يترك خصوم الشهر القديم في الجديد.
--       ⚠️ ويضيع معه ما أُضيف أو عُدّل يدوياً، كإعادة الحساب تماماً.
--       rebuild = false: يتغيّر الشهر وتبقى البنود كما هي.
--
-- ===== ثغرة أُغلقت =====
--
--   refresh_payroll_totals (051) لا تمسّ كشفاً بلا بنود — حمايةً
--   للكشوف القديمة قبل البنود. لكن المسوّدة التي حُذفت بنودها كلّها
--   بقيت بصافي آخر بندٍ قبلها. صارت المسوّدة الفارغة أصفاراً، والكشف
--   المعتمد بلا بنود (إن وُجد) لا يُمسّ كما كان.
--
-- يتطلب: 051، 068، 105. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) المسوّدة الفارغة صافيها صفر
-- ------------------------------------------------------------
create or replace function public.refresh_payroll_totals(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_basic numeric; v_allow numeric; v_comm numeric; v_ded numeric; v_n int;
begin
  select count(*) into v_n from public.payroll_lines where payroll_id = p_id;

  if v_n = 0 then
    -- المسوّدة وحدها تُصفَّر: الكشف المعتمد القديم بلا بنود له قيدٌ
    -- في الدفاتر، وتصفيره يفرّق بينهما (ويرفضه حارس الأرقام أصلاً).
    update public.payrolls
       set basic = 0, allowances = 0, commissions_total = 0,
           deductions_total = 0, net = 0
     where id = p_id and state = 'مسودة'
       and (coalesce(basic, 0) <> 0 or coalesce(allowances, 0) <> 0
            or coalesce(commissions_total, 0) <> 0
            or coalesce(deductions_total, 0) <> 0 or coalesce(net, 0) <> 0);
    return;
  end if;

  select
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category = 'راتب أساسي'), 0),
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category not in ('راتب أساسي', 'عمولة')), 0),
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category = 'عمولة'), 0),
    coalesce(sum(amount) filter (where kind = 'استقطاع'), 0)
  into v_basic, v_allow, v_comm, v_ded
  from public.payroll_lines where payroll_id = p_id;

  update public.payrolls
     set basic = v_basic, allowances = v_allow,
         commissions_total = v_comm, deductions_total = v_ded,
         net = v_basic + v_allow + v_comm - v_ded
   where id = p_id;
end;
$fn$;

-- المسوّدات الفارغة القائمة اليوم
do $do$
declare r record;
begin
  for r in
    select p.id from public.payrolls p
     where p.state = 'مسودة'
       and not exists (select 1 from public.payroll_lines l where l.payroll_id = p.id)
  loop
    perform public.refresh_payroll_totals(r.id);
  end loop;
end $do$;


-- ------------------------------------------------------------
-- 2) نقل المسوّدة إلى شهرٍ آخر
-- ------------------------------------------------------------
create or replace function public.update_payroll_period(
  p_id      uuid,
  p_period  text,
  p_rebuild boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r     public.payrolls%rowtype;
  emp   public.employees%rowtype;
  other public.payrolls%rowtype;
begin
  if not public.can_manage_hr() then
    raise exception 'تعديل كشوف الرواتب للمدير أو الموارد البشرية';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  select * into r from public.payrolls where id = p_id for update;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state <> 'مسودة' then
    raise exception 'الكشف % — أعِد فتحه أولاً ثم عدّله', r.state;
  end if;

  select * into emp from public.employees where id = r.employee_id;
  if emp.hire_date is not null and p_period < to_char(emp.hire_date, 'YYYY-MM') then
    raise exception 'باشر % في % — لا كشف لشهرٍ قبل المباشرة',
      emp.full_name, emp.hire_date;
  end if;
  if emp.end_date is not null and p_period > to_char(emp.end_date, 'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا كشف لشهر لاحق',
      emp.full_name, to_char(emp.end_date, 'YYYY-MM');
  end if;

  if p_period <> r.period then
    select * into other from public.payrolls
     where employee_id = r.employee_id and period = p_period and id <> p_id;
    if found then
      raise exception 'لـ % كشفٌ لشهر % بالفعل (%) — افتحه وعدّله، أو احذف أحد الكشفين',
        emp.full_name, p_period, other.state;
    end if;

    update public.payrolls set period = p_period where id = p_id;
  end if;

  -- build_payroll يجد المسوّدة بشهرها الجديد فيعيد بناءها لا يُنشئ غيرها
  if p_rebuild then
    perform public.build_payroll(r.employee_id, p_period);
  end if;
end;
$fn$;

revoke all on function public.update_payroll_period(uuid, text, boolean) from public, anon;
grant execute on function public.update_payroll_period(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
