-- ============================================================
-- تلال ERP — 051: كشف الراتب بنوداً، ودورة اعتماد تسبق الدفاتر
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المرحلة الأولى من تطوير الموارد البشرية. وهي أساس ما بعدها:
-- الدوام والإجازات والسلف كلها ستدخل الراتب **بنوداً**، فما لم
-- يكن للكشف بنودٌ أصلاً لم يكن لها أين تدخل.
--
-- ما كان قبل هذا الملف (فُحص لا خُمّن):
--
--   1) الراتب يُحسب في المتصفّح. صفحة التوليد تجمع الأساسي والبدلات
--      والعمولات وتطرح الاستقطاعات في جافاسكربت ثم تُدخل الصفّ
--      جاهزاً — وحده في النظام كلّه يفعل ذلك، وبقيته يضع الحساب
--      في القاعدة.
--
--   2) الكشف أربعة مجاميع لا بنود. لو حُذف استقطاع بعد التوليد بقي
--      المجموع على حاله والقيد المحاسبي على خطئه ولا أحد يعلم.
--
--   3) لا شيء يمنع كشفين لنفس الموظف ونفس الشهر — نقرة مزدوجة
--      تُنشئ قيدين ودَيناً مضاعفاً على الشركة.
--
--   4) القيد المحاسبي يُرحَّل لحظة الإنشاء (trg_payroll_ledger بعد
--      INSERT). فأي «مسوّدة» تدخل حسابات الشركة فوراً، ولا معنى
--      لدورة اعتماد فوق ذلك.
--
-- ما يفعله هذا الملف: يعالج الأربعة معاً — لأنها واحدة. لا يمكن
-- بناء البنود بلا تأجيل الترحيل: لو بقي الترحيل عند الإنشاء
-- لرُحِّل الكشف صفراً قبل أن يُضاف إليه بندٌ واحد.
--
-- ⚠️ الأعمدة الأربعة القديمة (basic, allowances, commissions_total,
--    deductions_total, net) **تبقى كما هي** ولا تُحذف: الشاشات
--    ودالة الترحيل وبوابة الموظف كلها تقرأ منها. صارت تُحسب من
--    البنود بدل أن تُكتب باليد — فالواجهة لم تنكسر والمصدر تغيّر.
--
-- ⚠️ العمولة لا تدخل قيد الراتب المحاسبي، ولن تدخله. هي تُرحَّل
--    لحظة استحقاقها (مدين 5500 / دائن 2300 في sql/019)، فلو
--    أدخلناها هنا لاحتُسب المصروف مرتين. البند في الكشف للعرض
--    وللصافي، لا للقيد.
--
-- الكشوف الستّة القائمة: فُحصت قبل الكتابة، مجاميعها متطابقة
-- تماماً مع صفوف عمولاتها واستقطاعاتها، فبُنيت بنودها أثراً
-- رجعياً بلا فقدان رقم. وحالتها «معتمد» لأنها مُرحَّلة فعلاً.
--
-- طُبّق على القاعدة في 2026-09-02 عبر هجرة:
--   payroll_lines_and_approval
--
-- يتطلب: sql/012 و sql/019. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) بنود الكشف
-- ------------------------------------------------------------
-- كل دينار في الكشف له سطرٌ يقول من أين جاء: أساسيٌّ من ملف
-- الموظف، أو عمولة من صفقة، أو خصمٌ من غياب. والمجاميع تُشتقّ من
-- السطور لا العكس.
create table if not exists public.payroll_lines (
  id              uuid primary key default gen_random_uuid(),
  payroll_id      uuid not null references public.payrolls(id) on delete cascade,
  kind            text not null check (kind in ('استحقاق', 'استقطاع')),
  category        text not null,
  description     text,
  -- موجبٌ دائماً. الاتجاه في kind لا في الإشارة: مبلغٌ سالب في
  -- عمود استقطاع يقلب معناه بلا أن يظهر ذلك في أي مجموع.
  amount          numeric not null check (amount >= 0),
  -- من أين جاء البند: اسم الجدول ومعرّف الصفّ. فارغٌ = بندٌ يدوي.
  source_table    text,
  source_id       uuid,
  manual          boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,

  constraint payroll_lines_category_chk check (
    (kind = 'استحقاق' and category in
      ('راتب أساسي', 'بدل', 'عمولة', 'مكافأة', 'عمل إضافي', 'استحقاق آخر'))
    or
    (kind = 'استقطاع' and category in
      ('غياب', 'تأخير', 'إجازة بلا راتب', 'قسط سلفة', 'سلفة', 'استقطاع آخر'))
  )
);

create index if not exists idx_payroll_lines_payroll
  on public.payroll_lines(payroll_id);

-- بندٌ واحد لكل مصدر في الكشف الواحد — يمنع ضمّ العمولة نفسها
-- مرتين لو أُعيد بناء الكشف وفيه بقيّة من بناءٍ سابق.
create unique index if not exists payroll_lines_source_uniq
  on public.payroll_lines(payroll_id, source_table, source_id)
  where source_id is not null;

comment on table public.payroll_lines is
  'بنود كشف الراتب — المصدر الوحيد لمجاميع الكشف. تُجمَّد بالاعتماد.';

-- ------------------------------------------------------------
-- 2) دورة حياة الكشف
-- ------------------------------------------------------------
-- ⚠️ عمود status القديم يبقى **حالة الدفع** كما كان (غير مدفوع /
--    مدفوع جزئياً / مدفوع) — تحسبها refresh_payroll_status من
--    الدفعات. وهذا محورٌ آخر غير دورة العمل: كشفٌ معتمدٌ قد يكون
--    مدفوعاً جزئياً. فُصلا في عمودين لأنهما سؤالان مختلفان.
alter table public.payrolls
  add column if not exists state       text not null default 'مسودة',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at   timestamptz;

-- الكشوف القائمة مُرحَّلة إلى الدفاتر فعلاً، فحالتها «معتمد» لا
-- «مسودة». لو تركناها مسوّدات لأمكن إعادة بنائها فوق قيدٍ قائم.
update public.payrolls
   set state       = 'معتمد',
       approved_at = coalesce(approved_at, created_at)
 where journal_entry_id is not null
   and state = 'مسودة';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'payrolls_state_chk') then
    alter table public.payrolls add constraint payrolls_state_chk
      check (state in ('مسودة', 'معتمد', 'مقفل'));
  end if;
end $do$;

comment on column public.payrolls.state is
  'دورة العمل: مسودة (تُعاد حسابتها) ← معتمد (رُحّل للدفاتر وجُمّدت أرقامه) ← مقفل. غير status وهو حالة الدفع.';

-- كشفان لنفس الموظف ونفس الشهر: دَينٌ مضاعف وقيدان. لم يقع بعد
-- (الستّة الحالية سليمة) ولذلك يمكن فرض القيد الآن بلا تنظيف.
create unique index if not exists payrolls_employee_period_uniq
  on public.payrolls(employee_id, period);

-- ------------------------------------------------------------
-- 3) المجاميع تُشتقّ من البنود
-- ------------------------------------------------------------
-- ⚠️ كشفٌ بلا بنود لا يُمسّ. لولا هذا الشرط لصفّرت الدالةُ أي كشف
--    قديم لم تُبنَ بنوده — ومعه قيدُه في الدفاتر.
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
  if v_n = 0 then return; end if;

  select
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category = 'راتب أساسي'), 0),
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category not in ('راتب أساسي', 'عمولة')), 0),
    coalesce(sum(amount) filter (where kind = 'استحقاق' and category = 'عمولة'), 0),
    coalesce(sum(amount) filter (where kind = 'استقطاع'), 0)
  into v_basic, v_allow, v_comm, v_ded
  from public.payroll_lines where payroll_id = p_id;

  update public.payrolls
     set basic             = v_basic,
         allowances        = v_allow,
         commissions_total = v_comm,
         deductions_total  = v_ded,
         net               = v_basic + v_allow + v_comm - v_ded
   where id = p_id;
end;
$fn$;

create or replace function public.on_payroll_line_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform public.refresh_payroll_totals(coalesce(new.payroll_id, old.payroll_id));
  return null;
end;
$fn$;

drop trigger if exists trg_payroll_line_totals on public.payroll_lines;
create trigger trg_payroll_line_totals
  after insert or update or delete on public.payroll_lines
  for each row execute function public.on_payroll_line_change();

-- ------------------------------------------------------------
-- 4) بناء بنود الكشوف القائمة — أثراً رجعياً
-- ------------------------------------------------------------
-- يجري **قبل** حرّاس التجميد، وإلا رفض الحارس الكتابة على كشف
-- حالته «معتمد». ويجري مرة واحدة: الشرط `not exists` يجعل إعادة
-- تشغيل الملف بلا أثر.
do $do$
declare p record; c record; d record;
begin
  for p in select * from public.payrolls loop
    if exists (select 1 from public.payroll_lines l where l.payroll_id = p.id) then
      continue;
    end if;

    if coalesce(p.basic, 0) > 0 then
      insert into public.payroll_lines (payroll_id, kind, category, description, amount, source_table, source_id)
      values (p.id, 'استحقاق', 'راتب أساسي', 'الراتب الأساسي', p.basic, 'employees', p.employee_id);
    end if;

    if coalesce(p.allowances, 0) > 0 then
      insert into public.payroll_lines (payroll_id, kind, category, description, amount, manual)
      values (p.id, 'استحقاق', 'بدل', 'بدلات (كشف سابق)', p.allowances, true);
    end if;

    for c in select * from public.commissions where payroll_id = p.id loop
      insert into public.payroll_lines (payroll_id, kind, category, description, amount, source_table, source_id)
      values (p.id, 'استحقاق', 'عمولة', coalesce(c.description, 'عمولة'), c.amount, 'commissions', c.id);
    end loop;

    for d in select * from public.deductions where payroll_id = p.id loop
      insert into public.payroll_lines (payroll_id, kind, category, description, amount, source_table, source_id)
      values (p.id, 'استقطاع', 'استقطاع آخر', coalesce(d.reason, 'استقطاع'), d.amount, 'deductions', d.id);
    end loop;
  end loop;
end $do$;

-- ------------------------------------------------------------
-- 5) الحرّاس: ما يُجمَّد بالاعتماد
-- ------------------------------------------------------------
-- البنود لا تُمسّ إلا في المسوّدة. التعديل بعد الاعتماد يكون
-- بتسوية موقَّعة لا بكتابةٍ فوق التاريخ (المرحلة القادمة).
create or replace function public.guard_payroll_lines()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_state text; v_payroll uuid;
begin
  v_payroll := coalesce(new.payroll_id, old.payroll_id);
  select state into v_state from public.payrolls where id = v_payroll;
  if v_state is null then
    return coalesce(new, old);
  end if;
  if v_state <> 'مسودة' then
    raise exception 'كشف الراتب % — بنوده مجمّدة. أعِد فتحه أولاً.', v_state;
  end if;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_guard_payroll_lines on public.payroll_lines;
create trigger trg_guard_payroll_lines
  before insert or update or delete on public.payroll_lines
  for each row execute function public.guard_payroll_lines();

-- أرقام الكشف نفسها: لا تتغيّر بعد الاعتماد.
-- ⚠️ نفحص **الأعمدة المالية وحدها**، لا الصفّ كلّه: دالة
--    refresh_payroll_status تكتب status عند كل دفعة، و repost_payroll
--    تكتب journal_entry_id — والحارس الشامل كان سيمنع الدفع نفسه.
create or replace function public.guard_payroll_figures()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.state = 'مسودة' then
    return new;
  end if;

  if new.basic             is distinct from old.basic
  or new.allowances        is distinct from old.allowances
  or new.commissions_total is distinct from old.commissions_total
  or new.deductions_total  is distinct from old.deductions_total
  or new.net               is distinct from old.net
  or new.employee_id       is distinct from old.employee_id
  or new.period            is distinct from old.period then
    raise exception 'أرقام كشفٍ % لا تُعدَّل. أعِد فتحه أولاً.', old.state;
  end if;

  if old.state = 'مقفل' and new.state is distinct from old.state then
    raise exception 'الكشف مقفل — لا يُعاد فتحه';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_payroll_figures on public.payrolls;
create trigger trg_guard_payroll_figures
  before update on public.payrolls
  for each row execute function public.guard_payroll_figures();

-- الحذف: كشفٌ دُفع منه شيء أو أُقفل لا يُحذف — التاريخ لا يُمحى.
create or replace function public.guard_payroll_delete()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.state = 'مقفل' then
    raise exception 'الكشف مقفل — لا يُحذف';
  end if;
  if exists (select 1 from public.payroll_payments where payroll_id = old.id) then
    raise exception 'دُفع من هذا الكشف — لا يُحذف قبل حذف دفعاته';
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_guard_payroll_delete on public.payrolls;
create trigger trg_guard_payroll_delete
  before delete on public.payrolls
  for each row execute function public.guard_payroll_delete();

-- ------------------------------------------------------------
-- 6) الترحيل ينتقل من الإنشاء إلى الاعتماد
-- ------------------------------------------------------------
-- هذا هو التغيير الجوهري: المسوّدة لم تعد تدخل دفاتر الشركة.
-- دالة repost_payroll نفسها (sql/019) تبقى كما هي حرفاً بحرف —
-- المتغيّر متى تُنادى لا ماذا تفعل.
drop trigger if exists trg_payroll_ledger on public.payrolls;

create or replace function public.approve_payroll(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r    public.payrolls%rowtype;
  emp  public.employees%rowtype;
  v_n  int;
begin
  if not public.is_admin() then
    raise exception 'اعتماد كشوف الرواتب للمدير';
  end if;

  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;

  if r.state <> 'مسودة' then
    raise exception 'الكشف % بالفعل', r.state;
  end if;

  select count(*) into v_n from public.payroll_lines where payroll_id = p_id;
  if v_n = 0 then
    raise exception 'كشف بلا بنود لا يُعتمد';
  end if;
  if coalesce(r.net, 0) <= 0 then
    raise exception 'صافي الكشف صفر أو أقل — راجع بنوده قبل الاعتماد';
  end if;

  select * into emp from public.employees where id = r.employee_id;
  if emp.end_date is not null and r.period > to_char(emp.end_date, 'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا يُعتمد كشف شهر لاحق',
      emp.full_name, to_char(emp.end_date, 'YYYY-MM');
  end if;

  update public.payrolls
     set state = 'معتمد', approved_at = now(), approved_by = auth.uid()
   where id = p_id;

  -- الآن فقط يدخل الدفاتر
  perform public.repost_payroll(p_id);

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'كشف راتبك جاهز',
            'كشف ' || r.period || ' — الصافي ' || public.fmt_qty(r.net) || ' د.ع.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$fn$;

-- إعادة الفتح: للتصحيح قبل أن يُدفع شيء. تسحب القيد من الدفاتر
-- كما لو لم يكن — وهذا جائز لأن لا نقد تحرّك بعد.
create or replace function public.reopen_payroll(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare r public.payrolls%rowtype;
begin
  if not public.is_admin() then
    raise exception 'إعادة فتح الكشف للمدير';
  end if;

  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state = 'مسودة' then raise exception 'الكشف مسوّدة أصلاً'; end if;
  if r.state = 'مقفل'  then raise exception 'الكشف مقفل — لا يُعاد فتحه'; end if;

  if exists (select 1 from public.payroll_payments where payroll_id = p_id) then
    raise exception 'دُفع من هذا الكشف — احذف دفعاته أولاً';
  end if;

  if r.journal_entry_id is not null then
    delete from public.journal_entries where id = r.journal_entry_id;
    update public.payrolls set journal_entry_id = null where id = p_id;
  end if;

  update public.payrolls
     set state = 'مسودة', approved_at = null, approved_by = null
   where id = p_id;
end;
$fn$;

create or replace function public.lock_payroll(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare r public.payrolls%rowtype;
begin
  if not public.is_admin() then
    raise exception 'إقفال الكشف للمدير';
  end if;
  select * into r from public.payrolls where id = p_id;
  if not found then raise exception 'الكشف غير موجود'; end if;
  if r.state <> 'معتمد' then
    raise exception 'لا يُقفل إلا كشفٌ معتمد';
  end if;

  update public.payrolls set state = 'مقفل', locked_at = now() where id = p_id;
end;
$fn$;

-- ------------------------------------------------------------
-- 7) بناء الكشف — في القاعدة لا في المتصفّح
-- ------------------------------------------------------------
-- تُستدعى مرة لإنشاء المسوّدة، وتُعاد استدعاؤها كلما أردت إعادة
-- الحساب: تمسح بنودها وتفكّ ما ضمّته ثم تبني من جديد. فما دام
-- الكشف مسوّدة فالضغط على الزر لا يُنشئ كشفاً ثانياً.
create or replace function public.build_payroll(p_employee uuid, p_period text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  emp    public.employees%rowtype;
  v_id   uuid;
  ex     public.payrolls%rowtype;
  c      record;
  d      record;
begin
  if not public.is_admin() then
    raise exception 'توليد كشوف الرواتب للمدير';
  end if;

  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر يجب أن تكون YYYY-MM';
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;

  if emp.end_date is not null and p_period > to_char(emp.end_date, 'YYYY-MM') then
    raise exception 'انتهت خدمة % في % — لا كشف لشهر لاحق',
      emp.full_name, to_char(emp.end_date, 'YYYY-MM');
  end if;

  select * into ex from public.payrolls
   where employee_id = p_employee and period = p_period;

  if found then
    if ex.state <> 'مسودة' then
      raise exception 'كشف % لهذا الشهر % — أعِد فتحه قبل إعادة الحساب',
        emp.full_name, ex.state;
    end if;
    v_id := ex.id;
    -- فكّ ما ضُمّ سابقاً حتى يُلتقط من جديد، ثم امسح البنود
    update public.commissions set payroll_id = null where payroll_id = v_id;
    update public.deductions   set payroll_id = null where payroll_id = v_id;
    delete from public.payroll_lines where payroll_id = v_id;
  else
    insert into public.payrolls (employee_id, period, state)
    values (p_employee, p_period, 'مسودة')
    returning id into v_id;
  end if;

  -- (أ) الراتب الأساسي من ملفّ الموظف — مصدر واحد للحقيقة
  if coalesce(emp.base_salary, 0) > 0 then
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'راتب أساسي', 'الراتب الأساسي',
            emp.base_salary, 'employees', emp.id);
  end if;

  -- (ب) العمولات المستحقّة ولمّا تدخل كشفاً
  for c in
    select * from public.commissions
     where employee_id = p_employee and payroll_id is null
     order by comm_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'عمولة',
            coalesce(c.description, 'عمولة ' || c.comm_date::text),
            c.amount, 'commissions', c.id);
    update public.commissions set payroll_id = v_id where id = c.id;
  end loop;

  -- (ج) الاستقطاعات المسجَّلة ولمّا تدخل كشفاً
  for d in
    select * from public.deductions
     where employee_id = p_employee and payroll_id is null
     order by ded_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استقطاع',
            case when d.reason = 'سلفة' then 'سلفة' else 'استقطاع آخر' end,
            coalesce(d.reason, 'استقطاع') ||
              case when d.created_by_name is not null
                   then ' — ' || d.created_by_name else '' end,
            d.amount, 'deductions', d.id);
    update public.deductions set payroll_id = v_id where id = d.id;
  end loop;

  perform public.refresh_payroll_totals(v_id);
  return v_id;
end;
$fn$;

-- بندٌ يدوي على مسوّدة (بدل، مكافأة، خصم إداري) — بابٌ واحد
-- موقَّع باسم من أضافه، بدل الكتابة المباشرة على الجدول.
create or replace function public.add_payroll_line(
  p_payroll     uuid,
  p_kind        text,
  p_category    text,
  p_description text,
  p_amount      numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid; v_who text;
begin
  if not public.is_admin() then
    raise exception 'إضافة بنود الراتب للمدير';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر';
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  insert into public.payroll_lines
    (payroll_id, kind, category, description, amount, manual, created_by, created_by_name)
  values (p_payroll, p_kind, p_category,
          nullif(btrim(coalesce(p_description, '')), ''),
          p_amount, true, auth.uid(), v_who)
  returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function public.remove_payroll_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare l public.payroll_lines%rowtype;
begin
  if not public.is_admin() then
    raise exception 'حذف بنود الراتب للمدير';
  end if;

  select * into l from public.payroll_lines where id = p_line;
  if not found then raise exception 'البند غير موجود'; end if;

  -- بندٌ جاء من عمولة أو استقطاع: يُفكّ ارتباطه ليعود متاحاً
  -- لكشفٍ آخر بدل أن يضيع بلا كشف.
  if l.source_table = 'commissions' then
    update public.commissions set payroll_id = null where id = l.source_id;
  elsif l.source_table = 'deductions' then
    update public.deductions set payroll_id = null where id = l.source_id;
  end if;

  delete from public.payroll_lines where id = p_line;
end;
$fn$;

-- ------------------------------------------------------------
-- 8) الصلاحيات
-- ------------------------------------------------------------
alter table public.payroll_lines enable row level security;

drop policy if exists "admin payroll_lines" on public.payroll_lines;
create policy "admin payroll_lines" on public.payroll_lines
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- الموظف يقرأ بنود كشوفه هو — قسيمة راتبه لا كشوف زملائه
drop policy if exists "employee reads own payroll lines" on public.payroll_lines;
create policy "employee reads own payroll lines" on public.payroll_lines
  for select to authenticated
  using (
    payroll_id in (
      select p.id from public.payrolls p
       where p.employee_id = (select public.my_employee_id())
    )
  );

revoke all on function public.build_payroll(uuid, text)                    from public, anon;
revoke all on function public.approve_payroll(uuid)                        from public, anon;
revoke all on function public.reopen_payroll(uuid)                         from public, anon;
revoke all on function public.lock_payroll(uuid)                           from public, anon;
revoke all on function public.add_payroll_line(uuid, text, text, text, numeric) from public, anon;
revoke all on function public.remove_payroll_line(uuid)                    from public, anon;

grant execute on function public.build_payroll(uuid, text)                 to authenticated;
grant execute on function public.approve_payroll(uuid)                     to authenticated;
grant execute on function public.reopen_payroll(uuid)                      to authenticated;
grant execute on function public.lock_payroll(uuid)                        to authenticated;
grant execute on function public.add_payroll_line(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.remove_payroll_line(uuid)                 to authenticated;

notify pgrst, 'reload schema';
