-- ============================================================
-- تلال ERP — 056: تصحيح النموذج المالي — تلال وسيط لا بائع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ أخطر هجرة في المشروع. تُغيّر **أين يُعترف بالإيراد ومتى**.
--    اقرأ الرأس كاملاً قبل تشغيلها.
--
-- ============================================================
-- القاعدة الحاكمة الجديدة
--
--     قيدٌ لكل دينار يمرّ بصندوق تلال، ولا قيدٌ لما لا يمرّ.
--
-- تلال شركة تسويق ووساطة، لا بائعة العقار. ثمن الوحدة ليس مالاً
-- لتلال ولا يمرّ بها — هو رقم مرجعي تُحسب منه العمولة ولا شيء
-- غير ذلك. إيراد تلال من صفقة بـ 77,180,000 هو عمولتها (٢٪ =
-- 1,543,600)، لا 77 مليوناً.
--
-- ============================================================
-- ما كان قبل هذه الهجرة (فُحص لا خُمّن)
--
-- الدفاتر كانت مبنيّة على أن تلال هي البائعة:
--   • العربون:      مدين 1100 الصندوق / دائن 2400
--   • تحصيل فاتورة: دائن 4100 «إيرادات المبيعات» بثمن الوحدة كاملاً
--   • 4200 «إيرادات العمولات» — الحساب الصحيح — فيه صفر سطور
--
-- والضرر لم يقع بعد: 4100 و 2400 فيهما صفر سطور لأنه لم تُسجَّل
-- دفعة واحدة قط. فهذه أرخص لحظة ممكنة للتصحيح — قبل أن يتراكم
-- قيدٌ واحد على نموذج خاطئ.
--
-- ============================================================
-- نقطة الاستحقاق — أهمّ تغيير هنا
--
-- كان: تُستحقّ العمولة عند **اكتمال سداد الفاتورة**.
-- وهذا مستحيل في نموذج الوساطة: تلال لا تتابع أقساط المشتري
-- الباقية عند المطوّر، فالفاتورة لا تكتمل أبداً، فجدول commissions
-- يبقى فارغاً إلى الأبد، وبند العمولة في كل كشف راتب صفر — وهي
-- أكبر مكوّن في دخل موظف المبيعات.
--
-- صار: تُستحقّ عند **تأكيد المقدمة**، وهي نقطة الاستحقاق الوحيدة.
-- وما بعدها (أقساط المشتري) شأن المطوّر ولا يدخل دفاتر تلال.
--
-- ============================================================
-- القيود بعد هذه الهجرة
--
--   ١) تأكيد المقدمة  → عمولة تلال:   مدين 1250 / دائن 4200
--                       عمولة الموظف: مدين 5500 / دائن 2300
--                       (الثانية يكتبها محفّز trg_commission_ledger
--                        القائم عند إدراج صفّ commissions — لا
--                        نكتبها بأيدينا فلا يتكرّر القيد)
--
--   ٢) تحصيل تلال عمولتها من المطوّر → مدين 1100 / دائن 1250
--      وعندها فقط تصير عمولة الموظف مؤهّلة لدخول كشف راتبه.
--
--   ٣) دفع الراتب — كما هو منذ sql/019: مدين 2300 / دائن 1100
--
-- ⚠️ ويبقى المبدأ الذي لا يُكسر: **العمولة لا تدخل قيد الراتب**.
--    repost_payroll يحسب basic + allowances − deductions ويتجاهل
--    commissions_total عمداً، لأنها رُحّلت عند استحقاقها. إدخالها
--    هناك يحتسب المصروف مرتين ويضخّم 2300.
--
-- ============================================================
-- «لا أدفع عمولة من جيبي على مال لم يصلني»
--
-- عمولة الموظف **تُستحقّ** عند تأكيد المقدمة (أنجز عمله وتُقيَّد
-- له)، لكنها **لا تدخل كشف راتبه** إلا بعد أن تقبض تلال عمولتها
-- من المطوّر. يفصل بينهما عمود commissions.payable_at:
--   فارغ    = مستحقّة ولم تُحصَّل → لا تدخل كشفاً
--   بتاريخ  = حُصّلت → تدخل كشف الشهر الذي يليها
--
-- ============================================================
-- الصفقتان القديمتان: لا قيد تصحيحياً لأيٍّ منهما (أمر المالك).
-- الـ 77 مليوناً لم تكن يوماً إيراد تلال، والفاتورة INV-0002
-- بصفر دفعات سلوكٌ صحيح لا خطأ.
--
-- ============================================================
-- خارج نطاق هذه الهجرة (عمداً)
--   • مسار إلغاء الحجز وفسخ البيع وعكس العمولات — مرحلة مستقلّة.
--   • قفل الفترات المحاسبية وسجلّ التدقيق.
--   • لا تُمسّ sale_commissions بنيوياً: تجميد النِّسب وقت البيع
--     مبدأ سليم. معرّفا القيدين يُحفظان على reservations لا عليها.
--
-- ===== التراجع =====
--   إعادة المحفّزات الستّة المحذوفة من sql/044 و sql/046 و sql/047،
--   وحذف الأعمدة المضافة، وحذف الحساب 1250 إن كان بلا سطور.
--
-- طُبّق على القاعدة في 2026-09-04 عبر هجرة:
--   broker_model_correction
--
-- يتطلب: sql/048 (محرّك العمولات) و sql/051 (بنود الراتب).
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الحسابات
-- ------------------------------------------------------------
insert into public.accounts (code, name, type)
values ('1250', 'عمولات مستحقة على المطوّرين', 'asset')
on conflict (code) do nothing;

comment on table public.accounts is
  'شجرة الحسابات. ⚠️ الدوالّ تبحث بالـ code لا بالـ id — أي حساب جديد يُستعمل بكوده.';

do $do$
declare v uuid;
begin
  select id into v from public.accounts where code='4100';
  if v is not null then
    update public.accounts
       set name = 'إيرادات المبيعات (مجمَّد — تلال وسيط لا بائع)'
     where id = v and name not like '%مجمَّد%';
  end if;

  select id into v from public.accounts where code='2400';
  if v is not null then
    update public.accounts
       set name = 'عربونات محجوزة (مجمَّد — العربون يذهب للمطوّر)'
     where id = v and name not like '%مجمَّد%';
  end if;
end $do$;


-- ------------------------------------------------------------
-- 2) أعمدة المقدمة على الحجز
-- ------------------------------------------------------------
alter table public.reservations
  add column if not exists down_payment_amount        numeric,
  add column if not exists down_payment_confirmed_at  timestamptz,
  add column if not exists down_payment_confirmed_by  uuid references auth.users(id) on delete set null,
  add column if not exists commission_accrual_entry_id uuid references public.journal_entries(id) on delete set null,
  add column if not exists commission_collect_entry_id uuid references public.journal_entries(id) on delete set null;

comment on column public.reservations.amount is
  'العربون — معلومة متابعة فقط. لا قيد له: يذهب للمطوّر ولا يمرّ بصندوق تلال (sql/056).';
comment on column public.reservations.down_payment_amount is
  'المقدمة. تأكيدها هو نقطة استحقاق العمولة الوحيدة في النظام.';

create index if not exists reservations_down_payment_idx
  on public.reservations (down_payment_confirmed_at)
  where down_payment_confirmed_at is not null;


-- ------------------------------------------------------------
-- 3) متى تصير عمولة الموظف قابلة للدفع
-- ------------------------------------------------------------
alter table public.commissions
  add column if not exists payable_at date;

comment on column public.commissions.payable_at is
  'فارغ = مستحقّة ولم تُحصَّل من المطوّر بعد، فلا تدخل كشف راتب. تُملأ عند تحصيل تلال عمولتها (sql/056).';

create index if not exists commissions_payable_idx
  on public.commissions (employee_id, payable_at)
  where payroll_id is null;

-- ⚠️ ملءٌ رجعي لازم: العمولات التي دخلت كشوفاً قبل هذه الهجرة
--    عوملت كمستحقّة الدفع فعلاً. وبلا هذا السطر تسقط من كشفها
--    **بصمت** لو أُعيد بناؤه، لأن build_payroll صار يشترط
--    payable_at. (أثّر في صفٍّ واحد: عمولة دانيه 150,000 في
--    كشف 2026-08 المعتمد.)
update public.commissions
   set payable_at = comm_date
 where payroll_id is not null
   and payable_at is null;


-- ------------------------------------------------------------
-- 4) إطفاء المحفّزات التي تكتب بنموذج البائع
-- ------------------------------------------------------------
-- العربون: لا يمرّ بصندوق تلال
drop trigger if exists trg_reservation_deposit_ledger on public.reservations;
drop trigger if exists trg_reservation_deposit_unpost on public.reservations;

-- دفعات المشتري: وثائق متابعة لا قيود
drop trigger if exists trg_payment_ledger  on public.payments;
drop trigger if exists trg_payment_unpost  on public.payments;

-- الاستحقاق انتقل من اكتمال الفاتورة إلى تأكيد المقدمة
drop trigger if exists trg_payment_commission        on public.payments;
drop trigger if exists trg_invoice_total_commission  on public.invoices;

comment on table public.invoices is
  'وثيقة متابعة للمشتري — لا تُرحَّل محاسبياً. تلال وسيط: ثمن الوحدة ليس إيرادها (sql/056).';
comment on table public.payments is
  'تحصيلات المطوّر من المشتري — متابعة لا محاسبة. لا قيد لها (sql/056). ما يدخل صندوق تلال يُسجَّل في cash_moves.';

-- الدوالّ تبقى في القاعدة موثَّقة ومعطَّلة، ولا تُحذف: حذفها يكسر
-- أي هجرة قديمة تشير إليها، وإبقاؤها بلا محفّز غير ضارّ.
comment on function public.repost_reservation_deposit(uuid) is
  'متقاعدة منذ sql/056 — العربون لا يمرّ بصندوق تلال. بلا محفّز.';
comment on function public.repost_payment(uuid) is
  'متقاعدة منذ sql/056 — دفعات المشتري وثائق متابعة لا قيود. بلا محفّز.';

-- ⚠️ settle_invoice_commission تُبطَل صراحةً لا بحذف محفّزها وحده:
--    لو نُوديت يوماً من مسارٍ منسيّ لأنشأت عمولة بالنموذج القديم.
--    وفيها أيضاً فرع company_settings.commission_rate الذي يحسب
--    صفراً بصمت — يزول معها.
create or replace function public.settle_invoice_commission(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  -- متقاعدة منذ sql/056. الاستحقاق صار عند تأكيد المقدمة عبر
  -- confirm_down_payment()، لا عند اكتمال سداد الفاتورة.
  return;
end;
$fn$;

comment on function public.settle_invoice_commission(uuid) is
  'مُبطَلة منذ sql/056 — لا تفعل شيئاً. الاستحقاق في confirm_down_payment().';


-- ------------------------------------------------------------
-- 5) تأكيد المقدمة — نقطة الاستحقاق الوحيدة
-- ------------------------------------------------------------
create or replace function public.confirm_down_payment(
  p_res    uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r        public.reservations%rowtype;
  sc       public.sale_commissions%rowtype;
  emp      public.employees%rowtype;
  v_unit   text;
  v_client text;
  v_recv   uuid;
  v_rev    uuid;
  v_entry  uuid;
  v_comm   uuid;
begin
  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;

  if not exists (select 1 from public.units u
                  where u.id = r.unit_id and public.can_manage_project(u.project_id)) then
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
  if not found then
    raise exception 'لا سجلّ عمولة لهذه الصفقة — راجع نِسَب المشروع ثم أعد إتمام البيع';
  end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;
  select name into v_client from public.clients where id = r.client_id;

  update public.reservations
     set down_payment_amount       = p_amount,
         down_payment_confirmed_at = now(),
         down_payment_confirmed_by = auth.uid()
   where id = p_res;

  -- ===== (أ) عمولة تلال: ذمّة على المطوّر وإيراد للشركة =====
  if coalesce(sc.company_amount, 0) > 0 then
    select id into v_recv from public.accounts where code = '1250';
    select id into v_rev  from public.accounts where code = '4200';

    if v_recv is not null and v_rev is not null then
      insert into public.journal_entries (entry_date, description, reference, arm, source)
      values (
        (now() at time zone 'Asia/Baghdad')::date,
        'استحقاق عمولة تلال — الوحدة ' || v_unit || ' — ' || coalesce(v_client, ''),
        'COMMDUE', 'إداري عام', 'reservations'
      )
      returning id into v_entry;

      insert into public.journal_lines (entry_id, account_id, debit, credit)
      values (v_entry, v_recv, sc.company_amount, 0),
             (v_entry, v_rev,  0,                sc.company_amount);

      update public.reservations set commission_accrual_entry_id = v_entry where id = p_res;
    end if;
  end if;

  -- ===== (ب) عمولة الموظف: تُستحقّ ولا تُدفع حتى نقبض =====
  -- ⚠️ لا نكتب قيدها بأيدينا: محفّز trg_commission_ledger القائم
  --    يرحّلها (مدين 5500 / دائن 2300) عند الإدراج. كتابتها هنا
  --    كانت ستُنتج قيدين لعمولة واحدة.
  if sc.employee_id is not null and coalesce(sc.employee_amount, 0) > 0
     and sc.commission_id is null then

    select * into emp from public.employees where id = sc.employee_id;

    insert into public.commissions
      (employee_id, amount, comm_date, description, auto, payable_at)
    values (
      sc.employee_id,
      sc.employee_amount,
      (now() at time zone 'Asia/Baghdad')::date,
      'عمولة بيع — الوحدة ' || v_unit || ' — ' || coalesce(sc.employee_basis, ''),
      true,
      null                     -- لا تدخل كشفاً حتى تُحصَّل عمولة تلال
    )
    returning id into v_comm;

    update public.sale_commissions set commission_id = v_comm where id = sc.id;

    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'استُحقّت لك عمولة',
              public.fmt_qty(sc.employee_amount) || ' د.ع عن الوحدة ' || v_unit ||
              ' — تدخل كشف راتبك بعد أن تُحصّل الشركة عمولتها من المطوّر.',
              '/dashboard/me/salary', 'راتب', v_comm);
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) تحصيل عمولة تلال من المطوّر
-- ------------------------------------------------------------
create or replace function public.collect_company_commission(
  p_res  uuid,
  p_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r       public.reservations%rowtype;
  sc      public.sale_commissions%rowtype;
  v_cash  uuid;
  v_recv  uuid;
  v_entry uuid;
  v_unit  text;
  v_when  date;
  emp     public.employees%rowtype;
begin
  if not public.is_admin() then
    raise exception 'تسجيل تحصيل العمولة للمدير';
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

  v_when := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);
  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  select id into v_cash from public.accounts where code = '1100';
  select id into v_recv from public.accounts where code = '1250';
  if v_cash is null or v_recv is null then
    raise exception 'حساب 1100 أو 1250 غير موجود';
  end if;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when,
          'تحصيل عمولة تلال من المطوّر — الوحدة ' || v_unit,
          'COMMIN', 'إداري عام', 'sale_commissions')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_cash, sc.company_amount, 0),
         (v_entry, v_recv, 0,                sc.company_amount);

  update public.sale_commissions set collected_at = v_when where id = sc.id;
  update public.reservations set commission_collect_entry_id = v_entry where id = p_res;

  -- الآن فقط تصير عمولة الموظف مؤهّلة لكشف الراتب
  if sc.commission_id is not null then
    update public.commissions
       set payable_at = v_when
     where id = sc.commission_id and payable_at is null;

    select e.* into emp from public.employees e where e.id = sc.employee_id;
    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'عمولتك صارت مستحقّة الدفع',
              'حُصّلت عمولة الوحدة ' || v_unit ||
              ' — تدخل كشف راتبك القادم.',
              '/dashboard/me/salary', 'راتب', sc.commission_id);
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 7) الكشف لا يسحب إلا عمولةً محصّلة
-- ------------------------------------------------------------
-- التغيير الوحيد عن sql/051: شرط payable_at في حلقة العمولات.
create or replace function public.build_payroll(p_employee uuid, p_period text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  emp public.employees%rowtype; v_id uuid; ex public.payrolls%rowtype; c record; d record;
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
    update public.commissions set payroll_id = null where payroll_id = v_id;
    update public.deductions   set payroll_id = null where payroll_id = v_id;
    delete from public.payroll_lines where payroll_id = v_id;
  else
    insert into public.payrolls (employee_id, period, state)
    values (p_employee, p_period, 'مسودة')
    returning id into v_id;
  end if;

  if coalesce(emp.base_salary, 0) > 0 then
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'راتب أساسي', 'الراتب الأساسي',
            emp.base_salary, 'employees', emp.id);
  end if;

  -- ⚠️ العمولة **المحصّلة** وحدها تدخل الكشف (sql/056):
  --    payable_at فارغ = استُحقّت للموظف ولم تقبضها الشركة بعد.
  --    ولا تدخل كشف شهرٍ سابقٍ لتحصيلها.
  for c in
    select * from public.commissions
     where employee_id = p_employee
       and payroll_id is null
       and payable_at is not null
       and to_char(payable_at, 'YYYY-MM') <= p_period
     order by comm_date
  loop
    insert into public.payroll_lines
      (payroll_id, kind, category, description, amount, source_table, source_id)
    values (v_id, 'استحقاق', 'عمولة',
            coalesce(c.description, 'عمولة ' || c.comm_date::text),
            c.amount, 'commissions', c.id);
    update public.commissions set payroll_id = v_id where id = c.id;
  end loop;

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


-- ------------------------------------------------------------
-- 8) invoice_items — جدول معطَّل، وسياسته كانت أوسع من أبيه
-- ------------------------------------------------------------
comment on table public.invoice_items is
  'معطَّل: صفر صفوف وصفر إشارة في الكود، ولا سياسة كتابة له فلا يُكتب فيه عبر الـAPI. يُبقى ولا يُسقط — قرار مستقل.';

-- كانت: current_user_role() is not null — أي كل مسجَّل دخول.
-- صارت تتبع نطاق invoices نفسه، فتضيق وتتّسع معه تلقائياً.
drop policy if exists "invoice_items_select" on public.invoice_items;
create policy "invoice_items follow invoices scope" on public.invoice_items
  for select to authenticated
  using (invoice_id in (select id from public.invoices));


-- ------------------------------------------------------------
-- 9) الصلاحيات
-- ------------------------------------------------------------
-- ⚠️ منذ sql/054 تخرج كل دالّة جديدة بلا منحة — فالمنح صريح.
revoke execute on function public.confirm_down_payment(uuid, numeric)   from public, anon;
revoke execute on function public.collect_company_commission(uuid, date) from public, anon;

grant execute on function public.confirm_down_payment(uuid, numeric)     to authenticated;
grant execute on function public.collect_company_commission(uuid, date)  to authenticated;

notify pgrst, 'reload schema';
