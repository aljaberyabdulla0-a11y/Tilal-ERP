-- ============================================================
-- تلال ERP — 068: دورا المحاسب والموارد البشرية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المشكلة =====
--
-- كل ما بُني في المراحل ١–٨ — كشوف الرواتب، والسلف، والفترات
-- المحاسبية، والاستقطاعات، والتقارير — محروسٌ بحارسٍ واحد:
-- is_admin(). فمن يريد أن يبني كشوف الشهر يحتاج حساب المالك،
-- ومن يريد أن يقفل فترةً يحتاج حساب المالك. والنتيجة العملية
-- المعروفة: كلمة سرّ المالك تُعطى لمن يعمل، فيصير «المدير» في
-- الدفاتر شخصين أو ثلاثة، ويسقط أثرُ audit_log لأن كل الأفعال
-- باسمٍ واحد.
--
-- ===== المبدأ: فصل الواجبات =====
--
-- الدوران الجديدان ليسا «مديراً أصغر»، بل قسمة عملٍ متعمَّدة:
--
--   الموارد البشرية (hr)   **تُحضّر**: تبني الكشوف، وتضيف بنوداً،
--                          وتحسب الدوام والإجازات والسلف.
--   المحاسب (accountant)   **يُرحِّل ويدفع**: يعتمد الكشف فيدخل
--                          الدفاتر، ويقفل الفترة، ويحصّل العمولة،
--                          ويصرف السلفة.
--
-- فمن يبني الرقم لا يعتمده، ومن يعتمده لا يبنيه. وهذا وحده يمنع
-- أكثر ما يُخشى في أنظمة الرواتب: أن يزيد أحدٌ بنداً لنفسه ثم
-- يعتمده بيده.
--
-- ⚠️ ما لم يُعطَ لهما عمداً:
--    · تغيير الأدوار (profiles UPDATE) — للمالك وحده، وإلا رفع
--      الموارد البشرية نفسها إلى «مدير» في نقرة.
--    · audit_log — للمالك وحده يقرؤه، ولا أحد يكتب فيه أو يحذف.
--    · reverse_sale و handover_employee — فسخُ بيعٍ وتسليمُ ملفات
--      قرارٌ إداري لا وظيفي.
--    · العملاء والمشاريع والوحدات والوساطة — خارج نطاقهما تماماً.
--
-- ===== الأسلوب: إضافةٌ لا استبدال =====
--
-- سياسات RLS تُجمَع بـ OR. فكل سياسةٍ هنا **تُضاف** إلى سياسة
-- المدير القائمة ولا تمسّها. لا سياسةً واحدة تُحذف، فلا يفقد
-- المدير شيئاً مهما أخطأتُ في هذا الملف.
--
-- وحرّاس الدوالّ تُرقَّع نصّياً من تعريفها الحيّ: تُقرأ الدالّة من
-- pg_get_functiondef ويُستبدل فيها الحارس وحده ثم تُعاد كما هي.
-- كتابةُ ثلاثين جسم دالّة باليد كانت ستُدخل فرقاً صامتاً بين ما في
-- الملف وما في القاعدة — وهو أخطر من الترقيع.
--
-- ===== التراجع =====
--   حذف السياسات الجديدة، وإعادة الحارس is_admin() في الدوالّ
--   الثلاثين، وحذف الدوالّ الخمس، وإعادة قيد profiles_role_chk.
--
-- يتطلب: sql/067. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الدوران في قائمة الأدوار المسموحة
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in ('admin', 'accountant', 'hr', 'supervisor',
                  'followup_manager', 'relationship_manager',
                  'broker', 'employee'));


-- ------------------------------------------------------------
-- 2) الحرّاس الخمسة
--
-- المركّبة تشمل المدير دائماً، فالمدير لا يفقد شيئاً بأي حال.
-- ------------------------------------------------------------
create or replace function public.is_accountant()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'accountant', false);
$fn$;

create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'hr', false);
$fn$;

-- من يمسّ دفاتر الشركة: يعتمد، ويقفل، ويحصّل، ويصرف.
create or replace function public.can_manage_finance()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.is_accountant();
$fn$;

-- من يُحضّر ملفّ الموظف: الكشف والدوام والإجازة والسلفة.
create or replace function public.can_manage_hr()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.is_hr();
$fn$;

-- من يرى أرقام الرواتب — الطرفان: من يُحضّرها ومن يُرحّلها.
create or replace function public.can_see_payroll()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.is_accountant() or public.is_hr();
$fn$;

comment on function public.can_manage_finance() is
  'المدير أو المحاسب — من يُرحّل ويدفع. لا يبني كشفاً (sql/068).';
comment on function public.can_manage_hr() is
  'المدير أو الموارد البشرية — من يُحضّر. لا يعتمد كشفاً (sql/068).';

-- ⚠️ لازم: sql/054 نزع المنح الافتراضية، فكل دالّة جديدة تُمنح صراحةً.
grant execute on function public.is_accountant()      to authenticated;
grant execute on function public.is_hr()              to authenticated;
grant execute on function public.can_manage_finance() to authenticated;
grant execute on function public.can_manage_hr()      to authenticated;
grant execute on function public.can_see_payroll()    to authenticated;


-- ------------------------------------------------------------
-- 3) سياسات المحاسب — دفاتر الشركة كاملةً
-- ------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array[
    'accounts', 'journal_entries', 'journal_lines', 'cash_moves',
    'invoices', 'payments', 'partners', 'partner_settlements',
    'external_debts', 'debt_repayments', 'accounting_periods',
    'bank_statement_lines', 'payroll_payments', 'commissions',
    'payroll_tax_brackets'
  ]
  loop
    execute format(
      'drop policy if exists "accountant manages %1$s" on public.%1$I', t);
    execute format(
      'create policy "accountant manages %1$s" on public.%1$I
         for all to authenticated
         using ((select public.is_accountant()))
         with check ((select public.is_accountant()))', t);
  end loop;
end
$do$;


-- ------------------------------------------------------------
-- 4) سياسات الموارد البشرية — ملفّ الموظف كاملاً
-- ------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array[
    'employees', 'employee_salary_history', 'payrolls', 'payroll_lines',
    'deductions', 'leaves', 'leave_types', 'leave_entitlements',
    'leave_ledger', 'attendance', 'attendance_exemptions',
    'employee_advances', 'advance_installments', 'employee_targets'
  ]
  loop
    execute format(
      'drop policy if exists "hr manages %1$s" on public.%1$I', t);
    execute format(
      'create policy "hr manages %1$s" on public.%1$I
         for all to authenticated
         using ((select public.is_hr()))
         with check ((select public.is_hr()))', t);
  end loop;
end
$do$;


-- ------------------------------------------------------------
-- 5) القراءات المتقاطعة
--
-- المحاسب يعتمد كشفاً فيجب أن يراه قبل أن يوقّعه — قراءةً لا
-- كتابة، فالبناء ليس شغله. والموارد البشرية تشرح للموظف من أين
-- جاء رقم عمولته، فتقرأ العمولات ولا تحرّرها.
-- ------------------------------------------------------------
do $do$
declare t text;
begin
  -- ما يقرؤه المحاسب من ملفّات الموظفين
  foreach t in array array[
    'employees', 'employee_salary_history', 'payrolls', 'payroll_lines',
    'deductions', 'employee_advances', 'advance_installments',
    'employee_targets', 'sale_commissions', 'project_commissions',
    'commission_tiers', 'employee_commission_rules'
  ]
  loop
    execute format(
      'drop policy if exists "accountant reads %1$s" on public.%1$I', t);
    execute format(
      'create policy "accountant reads %1$s" on public.%1$I
         for select to authenticated
         using ((select public.is_accountant()))', t);
  end loop;

  -- ما تقرؤه الموارد البشرية من أرقام العمولة
  foreach t in array array[
    'commissions', 'sale_commissions', 'employee_commission_rules'
  ]
  loop
    execute format(
      'drop policy if exists "hr reads %1$s" on public.%1$I', t);
    execute format(
      'create policy "hr reads %1$s" on public.%1$I
         for select to authenticated
         using ((select public.is_hr()))', t);
  end loop;
end
$do$;


-- ------------------------------------------------------------
-- 6) إعدادات الشركة
--
-- صفٌّ واحد يجمع دوام المكتب ونسبة العمولة ومفاتيح الضريبة، فلا
-- ينفصل بالأعمدة. يُفتح للاثنين معاً: الموارد البشرية تضبط قواعد
-- الدوام، والمحاسب يضبط مفاتيح الاستقطاعات القانونية.
-- ⚠️ وكلاهما يُسجَّل في audit_log، فالتغيير معروفٌ صاحبه.
-- ------------------------------------------------------------
drop policy if exists "finance hr write company_settings" on public.company_settings;
create policy "finance hr write company_settings"
  on public.company_settings for update to authenticated
  using      ((select public.is_accountant()) or (select public.is_hr()))
  with check ((select public.is_accountant()) or (select public.is_hr()));


-- ------------------------------------------------------------
-- 7) حرّاس الدوالّ
--
-- ترقيعٌ نصّي من التعريف الحيّ: يُقرأ تعريف الدالّة، ويُستبدل
-- `not public.is_admin()` وحده بالحارس المركّب، وتُصحَّح رسالة
-- الحارس لتسمّي من يملك الصلاحية فعلاً، ثم تُعاد الدالّة.
--
-- ⚠️ آمنٌ لأن كل دالّة في القائمة تحتوي is_admin() **مرّةً واحدة**
--    وهي حارس الدخول — فُحصت القاعدة قبل كتابة الملف. والدوالّ
--    التي تستعمل is_admin() في منطقها (guard_broker_assignment،
--    can_see_client، guard_leave_request…) ليست هنا عمداً.
--
-- ⚠️ create or replace يحفظ المنح القائمة، فلا حاجة لإعادة grant.
--
-- إعادة التشغيل: بعد أول مرّة لا يبقى النمط القديم، فتُتخطّى الدالّة.
-- ------------------------------------------------------------
do $do$
declare
  r     record;
  v_def text;
  v_new text;
  v_hit int := 0;
  v_skip int := 0;
begin
  for r in
    select * from (values
      -- ===== يُرحّل ويدفع: المدير أو المحاسب =====
      -- ⚠️ الصفّ الأول وحده مُصرَّحُ النوع: قوائم VALUES تأخذ نوعها
      --    من أول صفّ، والاسم المستعار أدناه يسمّي الأعمدة ولا
      --    يذكر أنواعها — ذكرُها هناك خطأٌ نحوي في PostgreSQL.
      ('public.approve_payroll(uuid)'::text,                  'can_manage_finance'::text, 'للمدير'::text, 'للمدير أو المحاسب'::text),
      ('public.approve_all_payrolls(text)',                   'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.reopen_payroll(uuid)',                         'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.lock_payroll(uuid)',                           'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.close_period(text,text)',                      'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.reopen_period(text,text)',                     'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.archive_period(text)',                         'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.periods_overview(integer)',                    'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.collect_company_commission(uuid,date)',        'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.disburse_advance(uuid,text,date)',             'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.suggest_bank_match(uuid)',                     'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.bank_reconciliation(date,date)',               'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.project_profitability(date,date)',             'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),
      ('public.commission_receivable_aging()',                'can_manage_finance', 'للمدير', 'للمدير أو المحاسب'),

      -- ===== يُحضّر: المدير أو الموارد البشرية =====
      ('public.build_payroll(uuid,text)',                     'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.build_all_payrolls(text)',                     'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.add_payroll_line(uuid,text,text,text,numeric)','can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.remove_payroll_line(uuid)',                    'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.attendance_deductions(uuid,text)',             'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.unpaid_leave_deductions(uuid,text)',           'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.due_advance_installments(uuid,text)',          'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.advances_for(uuid)',                           'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.leave_balances_for(uuid)',                     'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.run_leave_accrual()',                          'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.approve_advance(uuid)',                        'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.cancel_advance(uuid,text)',                    'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      ('public.target_progress(text)',                        'can_manage_hr', 'للمدير', 'للمدير أو الموارد البشرية'),
      -- رسالتها تقول «المدير» لا «للمدير» — الاستبدال مفصَّل لها وحدها
      ('public.request_advance(uuid,numeric,integer,text,text)',
                                                              'can_manage_hr', 'يطلبها المدير لغيرك', 'يطلبها المدير أو الموارد البشرية لغيرك'),

      -- ===== يراه الطرفان =====
      ('public.month_close_overview(text)',                   'can_see_payroll', 'للمدير', 'لمن يُحضّر الكشوف أو يعتمدها'),
      ('public.statutory_deductions(uuid,text)',              'can_see_payroll', 'للمدير', 'لمن يُحضّر الكشوف أو يعتمدها'),
      ('public.employee_cost(text,text)',                     'can_see_payroll', 'للمدير', 'لمن يُحضّر الكشوف أو يعتمدها')
    ) as t(sig, guard, msg_from, msg_to)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);

    if position('not public.is_admin()' in v_def) = 0 then
      v_skip := v_skip + 1;
      continue;                       -- مُرقَّعةٌ سلفاً: إعادة تشغيل
    end if;

    v_new := replace(v_def, 'not public.is_admin()',
                            'not public.' || r.guard || '()');

    -- الرسالة تُصحَّح **داخل الحارس وحده**: من الحارس إلى أول
    -- فاصلةٍ منقوطة. لولا هذا القيد لبدّل كلَّ «للمدير» في الجسم،
    -- ومنها رسائلُ حرّاسٍ أخرى لا تخصّ هذا الدور.
    v_new := regexp_replace(
               v_new,
               '(not public\.' || r.guard || '\(\)[^;]*?)' || r.msg_from,
               E'\\1' || r.msg_to);
    execute v_new;
    v_hit := v_hit + 1;
  end loop;

  raise notice 'حرّاس رُقِّعت: % · متخطّاة: %', v_hit, v_skip;
end
$do$;


-- ------------------------------------------------------------
-- 8) التحقّق
--
-- لا دالّةً في القائمة بقيت على is_admin()، ولا دالّةً خارجها
-- تغيّرت. شغّل هذا بعد الهجرة:
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and pg_get_functiondef(p.oid) like '%not public.can_manage_finance()%'
--    order by 1;
-- ------------------------------------------------------------
