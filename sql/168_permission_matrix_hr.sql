-- ============================================================
-- تلال ERP — 168: فرض مصفوفة الصلاحيات على وحدات HR (المرحلة 9)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145–167.
--
-- ============================================================
-- حتى الآن كانت المصفوفة (146) تُفرض على «الهيكل» و«التوظيف» وحدهما، وكل
-- من دورُه الأساسي hr يملك صلاحيات HR كلها: موظف HR ومدير HR سواء.
--
-- هذه الهجرة تجعل الدوالّ المساعدة التي تقرؤها السياسات القديمة تسأل
-- المصفوفة للوحدات المفروضة — دون لمس أيّ سياسة:
--
--   can_manage_hr()    ← is_admin() أو (is_hr() و employees:update)
--   can_see_payroll()  ← is_admin() أو (المحاسب و payroll:read) أو (HR و payroll:view_salary)
--   مُوافِقو مستوى «HR» في السلاسل ← فقط من تمنحه المصفوفة «اعتماد» وحدة الطلب
--                        (إجازة ← leaves، دوام وعمل إضافي ← attendance، مكافأة ← payroll:update)
--
-- أثرها على المستخدمين الحاليين: صفر. الأدوار النظامية (hr، accountant،
-- admin) مزروعة بكل ما كانت تملكه، ولا أحد يحمل اليوم دوراً تجارياً من
-- عائلة HR. الفرق يظهر حين يُعيَّن «موظف HR»: يعمل على الملفات والطلبات،
-- ولا يرى الرواتب، ولا يعتمد الإجازات ولا الدوام.
--
-- ما بقي على is_hr() مباشرة (19 سياسة) يُراجع في تدقيق المرحلة 10.
-- ============================================================


-- ============================================================
-- ١) أدوات المصفوفة
-- ============================================================
create or replace function public.module_enforced(p_module text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select m.enforced from public.app_modules m where m.code = p_module), false);
$$;

-- الوحدة غير المفروضة تسمح (السياسة القديمة تحكم)، والمفروضة تسأل المصفوفة
create or replace function public.module_allows(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.module_enforced(p_module) or public.has_permission(p_module, p_action);
$$;

-- صلاحية مستخدم آخر (لاختيار المُوافِقين) — داخلية
create or replace function public.user_has_permission(p_user uuid, p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin')
      or exists (
        select 1
          from public.profiles p
          join public.roles r on r.code = p.role_code and r.status = 'نشط'
          join public.role_permissions rp on rp.role_code = p.role_code
         where p.id = p_user and rp.module = p_module and p_action = any (rp.actions));
$$;

-- وحدة الطلب وفعل الاعتماد المطلوب من مستوى HR
create or replace function public.approval_entity_permission(p_entity_type text, out module text, out action text)
language sql immutable as $$
  select x.m, x.a from (values
    ('leave', 'leaves', 'approve'),
    ('leave_encashment', 'leaves', 'approve'),
    ('attendance_request', 'attendance', 'approve'),
    ('overtime_request', 'attendance', 'approve'),
    ('bonus', 'payroll', 'update'),
    ('advance', 'advances', 'approve'),
    ('expense', 'expenses', 'approve'),
    ('termination', 'employees', 'update')
  ) x(e, m, a) where x.e = p_entity_type;
$$;


-- ============================================================
-- ٢) الدوالّ المساعدة التي تقرؤها السياسات
-- ============================================================
create or replace function public.can_manage_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_hr() and public.module_allows('employees', 'update'));
$$;

create or replace function public.can_see_payroll()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_accountant() and public.module_allows('payroll', 'read'))
      or (public.is_hr() and public.module_allows('payroll', 'view_salary'));
$$;


-- ============================================================
-- ٣) مُوافِقو مستوى HR — نسخة 153 + شرط المصفوفة
-- ============================================================
create or replace function public.approval_step_users(p_step uuid, p_subject uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.approval_steps%rowtype;
  v_subject_user uuid;
  v_dept uuid;
  v_mgr uuid;
  v_guard int := 0;
  v_perm record;
begin
  select * into s from public.approval_steps where id = p_step;
  if not found then return; end if;
  select e.user_id, e.department_id into v_subject_user, v_dept from public.employees e where e.id = p_subject;

  if s.approver_kind = 'المدير المباشر' then
    return query
      select m.user_id from public.employees e join public.employees m on m.id = e.manager_id
       where e.id = p_subject and m.status = 'active' and m.user_id is not null
         and m.user_id is distinct from v_subject_user;

  elsif s.approver_kind = 'مدير القسم' then
    -- أقرب مدير قسمٍ في السلسلة، غير صاحب الطلب
    while v_dept is not null and v_guard < 10 loop
      select d.manager_id into v_mgr from public.departments d where d.id = v_dept;
      if v_mgr is not null and v_mgr is distinct from p_subject then
        return query
          select m.user_id from public.employees m
           where m.id = v_mgr and m.status = 'active' and m.user_id is not null
             and m.user_id is distinct from v_subject_user;
        return;
      end if;
      select d.parent_id into v_dept from public.departments d where d.id = v_dept;
      v_guard := v_guard + 1;
    end loop;

  elsif s.approver_kind = 'HR' then
    -- (168) في الوحدة المفروضة: من تمنحه المصفوفة فعل الاعتماد وحده
    select p.module, p.action into v_perm
      from public.approval_workflows w
      cross join lateral public.approval_entity_permission(w.entity_type) p
     where w.code = s.workflow_code;
    return query select p.id from public.profiles p
      where p.role = 'hr' and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active')
        and (v_perm.module is null or not public.module_enforced(v_perm.module)
             or public.user_has_permission(p.id, v_perm.module, v_perm.action));

  elsif s.approver_kind = 'المالية' then
    return query select p.id from public.profiles p
      where p.role = 'accountant' and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active');

  elsif s.approver_kind = 'المدير العام' then
    return query select p.id from public.profiles p
      where p.role_code = 'general_manager' and p.id is distinct from v_subject_user;
    if not found then
      return query select p.id from public.profiles p
        where p.role = 'admin' and p.id is distinct from v_subject_user;
    end if;

  elsif s.approver_kind = 'دور' then
    return query select p.id from public.profiles p
      where p.role_code = s.approver_role and p.id is distinct from v_subject_user
        and not exists (select 1 from public.employees x where x.user_id = p.id and x.status <> 'active');

  elsif s.approver_kind = 'شخص' then
    return query select s.approver_user where s.approver_user is distinct from v_subject_user;
  end if;
end $$;


-- ============================================================
-- ٤) الوحدات المفروضة
-- ============================================================
update public.app_modules set enforced = true
 where code in ('employees', 'payroll', 'leaves', 'attendance', 'advances', 'performance', 'hr_reports', 'documents');


revoke all on function public.module_enforced(text)                       from public, anon;
revoke all on function public.module_allows(text, text)                   from public, anon;
revoke all on function public.user_has_permission(uuid, text, text)       from public, anon, authenticated;
revoke all on function public.approval_entity_permission(text)            from public, anon;
grant execute on function public.module_enforced(text)                    to authenticated;
grant execute on function public.module_allows(text, text)                to authenticated;
grant execute on function public.approval_entity_permission(text)         to authenticated;
