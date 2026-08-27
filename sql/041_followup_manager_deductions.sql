-- ============================================================
-- تلال ERP — مدير المتابعة يخصم على الموظفين
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-08-27): توسيع صلاحية مدير المتابعة ليسجّل استقطاعات
-- على الموظفين (تأخير، غياب، مخالفة…). وهذا **أول باب مالي** يُفتح
-- له، فالتوسعة مضبوطة بثلاثة قيود:
--
--   1) **الخصم موقَّع باسمه** — عمودا created_by/created_by_name
--      يُملآن داخل القاعدة لا من الواجهة، فيُعرف من خصم ومتى.
--   2) **لا يمسّ خصماً دخل كشف راتب** — بعد أن يُحتسب الخصم في كشف
--      (payroll_id مملوء) يُقفل تماماً: تعديله أو حذفه يعني أن
--      الراتب المدفوع لم يعد مطابقاً لسببه. التصحيح بعدها للمدير.
--   3) **لا يخصم على نفسه** — لا أحد يبتّ في مال نفسه، تماماً كما
--      لا يوافق المشرف على إجازته هو (sql/036).
--
-- ⚠️ المقارنة في القيد الثالث بـ «is distinct from» لا بـ «<>»:
--    حساب مدير المتابعة قد لا يكون مربوطاً بملفّ موظف أصلاً، فترجع
--    my_employee_id() فارغة، والمقارنة بـ «<>» مع الفارغ تعطي NULL —
--    وNULL في WITH CHECK رفضٌ صامت كان سيمنعه من **كل** خصم.
--    (حدث فعلاً: أول حساب مدير متابعة في النظام بلا ملفّ موظف.)
--
-- ويبقى خارج نطاقه: الرواتب والعمولات والبدلات وتوليد الكشوف.
-- الاستقطاع بند تشغيلي يُدخله، والراتب يبقى قرار الإدارة.
--
-- ملاحظة: الخصم لا يُرحَّل للمحاسبة بذاته — يدخل كشف الراتب القادم
-- تلقائياً (كل استقطاع payroll_id فارغ يُضمّ للكشف الجديد)، والكشف
-- هو ما يُرحَّل (sql/015).
--
-- يتطلب: sql/012 و sql/022 و sql/040. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) من سجّل الخصم
-- ------------------------------------------------------------
alter table public.deductions
  add column if not exists created_by      uuid references auth.users(id) on delete set null,
  add column if not exists created_by_name text;

create index if not exists deductions_employee_idx on public.deductions (employee_id, ded_date desc);

create or replace function public.stamp_deduction()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.created_by_name is null then
    new.created_by_name := coalesce(
      public.my_employee_name(),
      (select p.email from public.profiles p where p.id = auth.uid())
    );
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_stamp_deduction on public.deductions;
create trigger trg_stamp_deduction
  before insert on public.deductions
  for each row execute function public.stamp_deduction();

-- ------------------------------------------------------------
-- 2) صلاحيات مدير المتابعة على الاستقطاعات
-- ------------------------------------------------------------
-- القراءة: كل الاستقطاعات (يتابع ما خُصم على الفريق كله)
drop policy if exists "followup reads deductions" on public.deductions;
create policy "followup reads deductions" on public.deductions
  for select to authenticated
  using ((select public.is_followup_manager()));

-- الإضافة: باسمه هو، على غيره لا على نفسه، وخارج أي كشف راتب
drop policy if exists "followup adds deductions" on public.deductions;
create policy "followup adds deductions" on public.deductions
  for insert to authenticated
  with check (
    (select public.is_followup_manager())
    and created_by = (select auth.uid())
    and payroll_id is null
    and employee_id is distinct from public.my_employee_id()
  );

-- التصحيح والحذف: ما سجّله هو، وما دام لم يدخل كشفاً بعد
drop policy if exists "followup fixes own deductions" on public.deductions;
create policy "followup fixes own deductions" on public.deductions
  for update to authenticated
  using (
    (select public.is_followup_manager())
    and created_by = (select auth.uid())
    and payroll_id is null
  )
  with check (
    (select public.is_followup_manager())
    and created_by = (select auth.uid())
    and payroll_id is null
    and employee_id is distinct from public.my_employee_id()
  );

drop policy if exists "followup deletes own deductions" on public.deductions;
create policy "followup deletes own deductions" on public.deductions
  for delete to authenticated
  using (
    (select public.is_followup_manager())
    and created_by = (select auth.uid())
    and payroll_id is null
  );

-- ------------------------------------------------------------
-- 3) إشعار الإدارة بكل خصم يسجّله غير المدير
-- ------------------------------------------------------------
-- المال لا يُخصم في صمت: المدير يعرف بالخصم ساعة تسجيله، فيصحّحه
-- قبل أن يدخل كشف الراتب إن كان في غير محلّه.
create or replace function public.notify_deduction_created()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  emp_name text;
begin
  -- خصم المدير لا يحتاج إشعاراً للمدراء
  if public.is_admin() then
    return new;
  end if;

  select full_name into emp_name from public.employees where id = new.employee_id;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         'استقطاع جديد على ' || coalesce(emp_name, 'موظف'),
         public.fmt_qty(new.amount)
           || ' — سجّله ' || coalesce(new.created_by_name, 'مستخدم')
           || coalesce(' · ' || new.reason, ''),
         '/dashboard/hr/employees/' || new.employee_id,
         'راتب',
         new.id
    from public.profiles p
   where p.role = 'admin';

  return new;
end; $fn$;

drop trigger if exists trg_deduction_notify on public.deductions;
create trigger trg_deduction_notify
  after insert on public.deductions
  for each row execute function public.notify_deduction_created();

notify pgrst, 'reload schema';
