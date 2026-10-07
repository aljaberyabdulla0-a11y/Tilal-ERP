-- ============================================================
-- تلال ERP — 173: التدقيق الأمني والتحصين (HR المؤسسي — المرحلة 10)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from public.security_audit();   ← يجب ألّا يُرجع «حرجة» ولا «عالية»
-- يتطلب: 145–166، 170–171.
--
-- ============================================================
-- ما وجده التدقيق على القاعدة الحيّة (2026-10-07) وما تفعله هذه الهجرة:
--
--   ١. anon (الزائر بلا دخول) يملك كل الصلاحيات على كل جداول public ومنها
--      TRUNCATE التي لا تخضع لـ RLS. لا يحتاج أيّاً منها: الصفحات العامة
--      (/f نموذج الليد و/r رابط التتبّع) تنادي أربع دوال فقط.
--        ← تُسحب كل صلاحيات الجداول والتسلسلات من anon، وكذلك الافتراضية.
--   ٢. 93 دالة security definer يناديها anon عبر /rest/v1/rpc.
--        ← يُسحب التنفيذ من anon وPUBLIC عن كل دوال definer عدا الأربع
--          العامة. صلاحية authenticated تُمنح صراحةً حيث كانت، فلا يتغيّر
--          شيء للمستخدمين المسجّلين.
--   ٣. authenticated يملك TRUNCATE/TRIGGER/REFERENCES/MAINTAIN على كل جدول.
--      PostgREST لا يعرضها، لكنها لا تلزم أحداً ← تُسحب (دفاع في العمق).
--   ٤. profiles مقروء لكل مسجَّل (using true): الوسيط — مستخدم من خارج
--      الشركة — يقرأ بريد كل موظف ودوره.
--        ← الوسيط يقرأ صفّه وحده؛ موظفو الشركة كما كانوا.
--   ٥. 19 سياسة تقرأ is_hr() مباشرة فتتجاوز المصفوفة (171).
--        ← تقرأ hr_allows(وحدة، فعل): الرواتب والعمولات والاستقطاعات وتاريخ
--          الراتب تتطلّب payroll:view_salary؛ الإجازات والدوام والسلف والأهداف
--          والموظفون تتطلّب update في وحدتها. دور hr النظامي يملكها كلها.
--   ٦. D6: current_user_role() تقرأ عموداً محذوفاً (profiles.is_active) فكل
--      سياسة على الجداول القديمة (properties, deals, lease_contracts,
--      lease_payments, activities) تفشل بخطأ. الجداول فارغة ولا تستعملها
--      الواجهة ← الدالة تُصلَح، والجداول للمدير العام وحده.
--   ٧. ثماني دوال plpgsql بلا search_path ثابت ← يُثبَّت على public, extensions
--      (المسار الفعلي الذي كانت تعمل به، فلا تنكسر دالة تستدعي إضافة).
--   ٨. security_audit(): فحص دوري يعيد ما سبق — للمدير العام.
--
-- مقبول عن قصد (موثّق في docs/HR_SECURITY_AUDIT.md):
--   • team_members منظور definer: هو طريق المشرف إلى فريقه، ومرشَّح بالنطاق.
--   • mkt_integration_secrets بـ RLS بلا سياسات = مغلق إلا عبر دوال definer.
--   • pg_trgm في public: نقلها يكسر دوالّ تستدعي similarity() بـ search_path=public.
--   • دوال SQL الثابتة (name_key، mask_phone…) بلا search_path: تثبيته يمنع
--     تضمينها في الاستعلامات (inlining)، وهي invoker لا تُصعِّد صلاحية.
--   • حماية كلمات المرور المسرّبة: إعداد في لوحة Supabase (Auth) لا SQL.
-- ============================================================


-- ============================================================
-- ١) anon: لا جداول ولا تسلسلات
-- ============================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ٣) authenticated: لا TRUNCATE ولا TRIGGER ولا REFERENCES ولا MAINTAIN
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;
do $$
begin
  -- MAINTAIN صلاحية PG17؛ تُتخطّى بصمت على إصدار أقدم
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke maintain on tables from authenticated';
exception when others then null;
end $$;


-- ============================================================
-- ٢) دوال definer: لا anon ولا PUBLIC، عدا الأربع العامة
-- ============================================================
do $$
declare
  f record;
  v_public constant text[] := array['mkt_landing_public', 'mkt_submit_lead', 'mkt_track_hit', 'mkt_track_view'];
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    continue when f.proname = any (v_public);
    -- من كان يملك التنفيذ من المسجّلين يبقى يملكه، صراحةً لا عبر PUBLIC
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from anon;


-- ============================================================
-- ٤) profiles: الوسيط يقرأ صفّه وحده
-- ============================================================
drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or not (select public.is_broker()));


-- ============================================================
-- ٥) السياسات القديمة على is_hr() تسأل المصفوفة
-- ============================================================
create or replace function public.hr_allows(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hr() and public.module_allows(p_module, p_action);
$$;
revoke all on function public.hr_allows(text, text) from public, anon;
grant execute on function public.hr_allows(text, text) to authenticated, service_role;

do $$
declare
  m record;
begin
  for m in select * from (values
    ('employee_advances',         'hr manages employee_advances',         'advances',    'update'),
    ('advance_installments',      'hr manages advance_installments',      'advances',    'update'),
    ('employee_targets',          'hr manages employee_targets',          'performance', 'update'),
    ('leaves',                    'hr manages leaves',                    'leaves',      'update'),
    ('leave_entitlements',        'hr manages leave_entitlements',        'leaves',      'update'),
    ('leave_types',               'hr manages leave_types',               'leaves',      'update'),
    ('leave_ledger',              'hr manages leave_ledger',              'leaves',      'update'),
    ('attendance',                'hr manages attendance',                'attendance',  'update'),
    ('attendance_exemptions',     'hr manages attendance_exemptions',     'attendance',  'update'),
    ('employees',                 'hr manages employees',                 'employees',   'update'),
    ('deductions',                'hr manages deductions',                'payroll',     'view_salary'),
    ('payrolls',                  'hr manages payrolls',                  'payroll',     'view_salary'),
    ('payroll_lines',             'hr manages payroll_lines',             'payroll',     'view_salary'),
    ('employee_salary_history',   'hr manages employee_salary_history',   'payroll',     'view_salary'),
    ('commissions',               'hr reads commissions',                 'payroll',     'view_salary'),
    ('sale_commissions',          'hr reads sale_commissions',            'payroll',     'view_salary'),
    ('employee_commission_rules', 'hr reads employee_commission_rules',   'payroll',     'view_salary')
  ) x(tbl, pol, module, action)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = m.tbl and policyname = m.pol) then
      raise exception 'السياسة «%» على % غير موجودة — راجِع قبل المتابعة', m.pol, m.tbl;
    end if;
    if (select cmd from pg_policies where schemaname = 'public' and tablename = m.tbl and policyname = m.pol) = 'SELECT' then
      execute format('alter policy %I on public.%I using ((select public.hr_allows(%L, %L)))',
                     m.pol, m.tbl, m.module, m.action);
    else
      execute format('alter policy %I on public.%I using ((select public.hr_allows(%L, %L))) with check ((select public.hr_allows(%L, %L)))',
                     m.pol, m.tbl, m.module, m.action, m.module, m.action);
    end if;
  end loop;
end $$;

alter policy "finance hr write company_settings" on public.company_settings
  using (((select public.is_accountant()) or (select public.hr_allows('attendance', 'manage'))))
  with check (((select public.is_accountant()) or (select public.hr_allows('attendance', 'manage'))));

alter policy "read sale commission adjustments" on public.sale_commission_adjustments
  using (((select public.is_admin()) or (select public.is_accountant())
          or (select public.hr_allows('payroll', 'view_salary'))
          or (employee_id = (select public.my_employee_id()))));


-- ============================================================
-- ٦) D6: current_user_role والجداول القديمة
-- ============================================================
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and public.my_account_active();
$$;

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['properties', 'deals', 'lease_contracts', 'lease_payments', 'activities'] loop
    continue when to_regclass('public.' || t) is null;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy "legacy admin only" on public.%I for all to authenticated
                      using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('comment on table public.%I is %L', t,
      'جدول قديم غير مستعمل (فارغ في 2026-10). للمدير العام وحده منذ 173.');
  end loop;
end $$;


-- ============================================================
-- ٧) search_path للدوال الإجرائية
-- ============================================================
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure::text sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null and l.lanname = 'plpgsql'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;


-- ============================================================
-- ٨) security_audit() — الفحص الدوري
-- ============================================================
create or replace function public.security_audit()
returns table (severity text, check_name text, object_name text, detail text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_public constant text[] := array['mkt_landing_public', 'mkt_submit_lead', 'mkt_track_hit', 'mkt_track_view'];
begin
  if not public.is_admin() then raise exception 'التدقيق الأمني للمدير العام وحده'; end if;

  return query
  -- جدول بلا RLS
  select 'حرجة'::text, 'جدول بلا RLS'::text, c.relname::text, 'أيّ مسجَّل يقرأ ويكتب كل صفوفه.'::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

  union all
  -- صلاحية جدول لـ anon
  select 'حرجة', 'جدول مفتوح لـ anon', c.relname::text,
         'صلاحيات: ' || concat_ws(',',
           case when has_table_privilege('anon', c.oid, 'select') then 'select' end,
           case when has_table_privilege('anon', c.oid, 'insert') then 'insert' end,
           case when has_table_privilege('anon', c.oid, 'update') then 'update' end,
           case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end,
           case when has_table_privilege('anon', c.oid, 'truncate') then 'truncate' end)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete')
          or has_table_privilege('anon', c.oid, 'truncate'))

  union all
  -- TRUNCATE لـ authenticated (لا يخضع لـ RLS)
  select 'عالية', 'TRUNCATE لـ authenticated', c.relname::text, 'التفريغ لا يخضع لـ RLS.'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'truncate')

  union all
  -- دالة definer ينفّذها anon
  select 'عالية', 'دالة definer لـ anon', p.oid::regprocedure::text, 'تُنادى بلا دخول عبر /rest/v1/rpc.'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
     and not (p.proname = any (v_public))
     and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  union all
  -- دالة definer بلا search_path
  select 'عالية', 'definer بلا search_path', p.oid::regprocedure::text, 'قابلة لحقن المخطط.'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  union all
  -- سياسة مفتوحة (true) على جدول حسّاس
  select 'عالية', 'سياسة مفتوحة على جدول حسّاس', pol.tablename || ' / ' || pol.policyname,
         'using (' || coalesce(pol.qual, '') || ')'
    from pg_policies pol
   where pol.schemaname = 'public'
     and pol.tablename in ('employees', 'payrolls', 'payroll_lines', 'payroll_payments', 'employee_salary_history',
                           'commissions', 'deductions', 'employee_advances', 'employee_documents', 'candidates',
                           'job_offers', 'profiles', 'journal_entries', 'journal_lines', 'clients',
                           'employee_expenses', 'termination_requests', 'performance_reviews')
     and (pol.qual = 'true' or pol.with_check = 'true')

  union all
  -- حاوية تخزين عامّة
  select 'عالية', 'حاوية تخزين عامّة', b.id, 'ملفاتها تُقرأ بلا دخول.'
    from storage.buckets b where b.public

  union all
  -- سياسات HR خارج المصفوفة
  select 'متوسطة', 'سياسة تقرأ is_hr() مباشرة', pol.tablename || ' / ' || pol.policyname,
         'تتجاوز المصفوفة — استعمل hr_allows(وحدة، فعل).'
    from pg_policies pol
   where pol.schemaname = 'public'
     and (coalesce(pol.qual, '') ~ 'is_hr\(\)' or coalesce(pol.with_check, '') ~ 'is_hr\(\)')

  union all
  -- حساب موظف خارج غير محظور
  select 'متوسطة', 'حساب دخول لموظف خارج', e.full_name, 'غير نشط وحسابه غير محظور في auth.'
    from public.employees e join auth.users u on u.id = e.user_id
   where e.status <> 'active' and (u.banned_until is null or u.banned_until < now())

  union all
  -- أكثر من مدير عام: كل واحد منهم يملك كل شيء
  select 'منخفضة', 'عدد المدراء العامّين', count(*)::text || ' حساباً', 'كل حساب admin يملك النظام كله — راجِع الحاجة.'
    from public.profiles where role = 'admin'
  having count(*) > 2;
end $$;

revoke all on function public.security_audit() from public, anon;
grant execute on function public.security_audit() to authenticated, service_role;

comment on function public.security_audit() is
  'الفحص الأمني الدوري (173): RLS، صلاحيات anon، دوال definer، سياسات مفتوحة، حاويات عامة، سياسات HR خارج المصفوفة. للمدير العام.';
