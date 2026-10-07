-- ============================================================
-- تلال ERP — 167: تكامل HR مع بقية الوحدات (HR المؤسسي — المرحلة 9)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 145–166.
--
-- ============================================================
-- الموظف مربوط بوحدات كثيرة — بعضها بالمعرّف وبعضها بالاسم نصاً
-- (clients.sales_employee، tasks.assigned_to_name، reservations.agent_name).
-- هذه الهجرة تجعل أحداث HR تسري إليها بدل أن تبقى معلّقة:
--
--   تغيير الاسم   ← يُحدَّث النصّ في العملاء والمهام والحجوزات (المعرّف لا يتغيّر)
--   تغيير المدير  ← مراجعات الأداء المفتوحة تنتقل للمدير الجديد، ويُشعَر الطرفان
--   تغيير المنصب أو ربط الحساب ← إن اقترح المنصب دوراً غير دوره يُشعَر المدير
--                   العام. لا يُمنح دور تلقائياً: منح الصلاحيات قرار المدير العام (146)
--   الخروج (active ← inactive) ← مرؤوسوه إلى مديره، وإدارته لقسم تُخلى، وتوزيعه
--                   على المشاريع ووردياته تُغلق بتاريخ نهايته، وعضويته في فريق
--                   التسويق تُعطَّل
--
-- وما لا يصحّ أن يُحسم آلياً (عملاء باسم موظف خارج، حساب دخول لم يُغلق،
-- قسم بلا مدير، فريق تسويق لا يطابق القسم…) يظهر في integration_issues()
-- ليقرّره إنسان، ومعه أداتان للمدير العام: apply_position_role و
-- revoke_employee_access.
-- ============================================================


-- ============================================================
-- ١) محفّز التكامل على الموظف
-- ============================================================
create or replace function public.employees_integration_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_end date;
  v_role text;
  v_cur text;
  r record;
begin
  -- ===== تغيير الاسم: النصوص المرتبطة بالمعرّف تتبعه =====
  if new.full_name is distinct from old.full_name then
    update public.clients set sales_employee = new.full_name
     where owner_id = new.id and sales_employee is distinct from new.full_name;
    update public.reservations set agent_name = new.full_name
     where agent_id = new.id and agent_name is distinct from new.full_name;
    if new.user_id is not null then
      update public.tasks set assigned_to_name = new.full_name
       where assigned_to = new.user_id and assigned_to_name is distinct from new.full_name;
    end if;
  end if;

  -- ===== تغيير المدير المباشر =====
  if new.manager_id is distinct from old.manager_id and new.status = 'active' then
    update public.performance_reviews set manager_id = new.manager_id
     where employee_id = new.id and status in ('تقييم ذاتي', 'تقييم المدير');
    if new.manager_id is not null then
      perform public.hr_notify_employee(new.manager_id, 'انضمّ إلى فريقك: ' || new.full_name,
        'صار ' || new.full_name || ' تحت إدارتك المباشرة — طلباته ومراجعاته تصلك من الآن.',
        '/dashboard/hr/employees/' || new.id, 'عام', new.id, 'employee');
    end if;
    if old.manager_id is not null then
      perform public.hr_notify_employee(old.manager_id, 'خرج من فريقك: ' || new.full_name,
        'لم يعد ' || new.full_name || ' تحت إدارتك المباشرة.',
        null, 'عام', new.id, 'employee');
    end if;
  end if;

  -- ===== المنصب أو ربط الحساب: اقتراح الدور =====
  if new.user_id is not null and new.position_id is not null and new.status = 'active'
     and (new.position_id is distinct from old.position_id or new.user_id is distinct from old.user_id) then
    select p.default_role_code into v_role from public.positions p where p.id = new.position_id;
    select pr.role_code into v_cur from public.profiles pr where pr.id = new.user_id;
    if v_role is not null and v_role is distinct from v_cur
       and coalesce(v_cur, '') not in ('admin', 'general_manager') then
      perform public.hr_notify_levels(array['admin'],
        'منصب ' || new.full_name || ' يقترح دوراً آخر',
        'دوره الحالي «' || coalesce((select name_ar from public.roles where code = v_cur), v_cur, '—') ||
        '» ومنصبه يقترح «' || coalesce((select name_ar from public.roles where code = v_role), v_role) ||
        '». راجِعه من الأدوار والصلاحيات.',
        '/dashboard/hr/integrations', 'عام', new.id, 'employee');
    end if;
  end if;

  -- ===== الخروج =====
  if old.status = 'active' and new.status <> 'active' then
    v_end := coalesce(new.end_date, public.baghdad_today());

    -- مرؤوسوه إلى مديره (أو بلا مدير — يظهر في الفحص)
    for r in select e.id from public.employees e where e.manager_id = new.id and e.status = 'active' loop
      update public.employees set manager_id = new.manager_id where id = r.id;
    end loop;

    -- القسم الذي يديره يبقى بلا مدير حتى يُعيَّن غيره — التصعيد يتولّاه
    update public.departments set manager_id = null where manager_id = new.id;

    update public.employee_project_allocations set end_date = v_end
     where employee_id = new.id and (end_date is null or end_date > v_end);
    update public.employee_shifts set end_date = greatest(start_date, v_end)
     where employee_id = new.id and (end_date is null or end_date > v_end);
    update public.mkt_team set is_active = false where employee_id = new.id and is_active;

    perform public.hr_notify_levels(array['admin', 'hr'],
      'خرج ' || new.full_name || ' — راجِع ما بقي باسمه',
      'نُقل مرؤوسوه إلى مديره، وأُغلق توزيعه ووردياته. ما يحتاج قراراً (عملاء، مهام، حساب دخول) في فحص التكامل.',
      '/dashboard/hr/integrations', 'عام', new.id, 'employee');
  end if;

  return null;
end $$;

drop trigger if exists trg_employees_integration on public.employees;
create trigger trg_employees_integration
  after update of full_name, manager_id, position_id, user_id, status on public.employees
  for each row execute function public.employees_integration_sync();


-- ============================================================
-- ٢) فحص التكامل — ما يحتاج قراراً بشرياً
-- ============================================================
create or replace function public.integration_issues()
returns table (kind text, severity text, employee_id uuid, employee_name text, detail text, link text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_hr() then
    raise exception 'فحص التكامل لـ HR والمدير العام';
  end if;

  return query
  -- ١. حساب دخول لموظف خارج لم يُغلق في auth
  select 'حساب دخول مفتوح'::text, 'حرجة'::text, e.id, e.full_name,
         'الموظف غير نشط وحسابه غير محظور — من يملك رمزاً صالحاً قد ينادي الواجهة مباشرة.'::text,
         '/dashboard/hr/integrations'::text
    from public.employees e join auth.users u on u.id = e.user_id
   where e.status <> 'active' and (u.banned_until is null or u.banned_until < now())

  union all
  -- ٢. عملاء باسم موظف خارج
  select 'عملاء باسم موظف خارج', 'عالية', e.id, e.full_name,
         count(*)::text || ' عميلاً ما زالوا باسمه — سلّمهم من إنهاء الخدمة.',
         '/dashboard/hr/employees/' || e.id
    from public.employees e join public.clients c on c.owner_id = e.id
   where e.status <> 'active'
   group by e.id, e.full_name

  union all
  -- ٣. مهام مفتوحة لموظف خارج
  select 'مهام مفتوحة لموظف خارج', 'عالية', e.id, e.full_name,
         count(*)::text || ' مهمة جديدة أو قيد التنفيذ.',
         '/dashboard/tasks'
    from public.employees e join public.tasks t on t.assigned_to = e.user_id
   where e.status <> 'active' and t.status in ('جديدة', 'قيد التنفيذ')
   group by e.id, e.full_name

  union all
  -- ٤. حجوزات قائمة باسم موظف خارج
  select 'حجوزات قائمة لموظف خارج', 'عالية', e.id, e.full_name,
         count(*)::text || ' حجزاً بحالة «حجز».', '/dashboard/hr/employees/' || e.id
    from public.employees e join public.reservations r on r.agent_id = e.id
   where e.status <> 'active' and r.status = 'حجز'
   group by e.id, e.full_name

  union all
  -- ٥. مشرف مشروع خارج
  select 'مشرف مشروع خارج', 'عالية', e.id, e.full_name,
         'يشرف على: ' || string_agg(p.name, '، '), '/dashboard/projects'
    from public.employees e join public.projects p on p.supervisor_id = e.id
   where e.status <> 'active'
   group by e.id, e.full_name

  union all
  -- ٦. مُوافِق مسمّى في سلسلة وهو خارج
  select 'مُوافِق خارج في سلسلة', 'عالية', e.id, e.full_name,
         'مُوافِق باسمه في: ' || string_agg(distinct w.name_ar, '، '), '/dashboard/hr/settings'
    from public.approval_steps s
    join public.approval_workflows w on w.code = s.workflow_code
    join public.employees e on e.user_id = s.approver_user
   where s.approver_kind = 'شخص' and e.status <> 'active'
   group by e.id, e.full_name

  union all
  -- ٧. طلب موافقة عالق بلا مُوافِق
  select 'طلب بلا مُوافِق', 'عالية', a.subject_employee, e.full_name,
         'طلب «' || w.name_ar || '» في المستوى ' || coalesce(a.current_step::text, 'الأخير') || ' لا يجد من يوافق عليه.',
         '/dashboard/me/approvals'
    from public.approval_requests a
    join public.approval_workflows w on w.code = a.workflow_code
    left join public.employees e on e.id = a.subject_employee
   where a.status = 'قيد الموافقة'
     and not exists (select 1 from public.approval_current_approvers(a.id))

  union all
  -- ٨. منصب يقترح دوراً غير دور صاحبه
  -- نفس المستوى الأساسي (موظف ← موظف مبيعات): أثره في المصفوفة وحدها، فهو منخفض
  select 'الدور لا يطابق المنصب',
         case when rc.base_role = rd.base_role then 'منخفضة' else 'متوسطة' end, e.id, e.full_name,
         'الدور «' || coalesce(rc.name_ar, pr.role_code, '—') || '» والمنصب «' || ps.title_ar ||
         '» يقترح «' || coalesce(rd.name_ar, ps.default_role_code) || '».',
         '/dashboard/hr/integrations'
    from public.employees e
    join public.positions ps on ps.id = e.position_id and ps.default_role_code is not null
    join public.profiles pr on pr.id = e.user_id
    left join public.roles rc on rc.code = pr.role_code
    left join public.roles rd on rd.code = ps.default_role_code
   where e.status = 'active' and pr.role_code is distinct from ps.default_role_code
     and coalesce(pr.role_code, '') not in ('admin', 'general_manager')

  union all
  -- ٩. قسم نشط بلا مدير وفيه موظفون
  select 'قسم بلا مدير', 'متوسطة', null::uuid, d.name_ar,
         count(e.id)::text || ' موظفاً نشطاً بلا مدير قسم — موافقات «مدير القسم» تصعد للأعلى.',
         '/dashboard/hr/organization/' || d.id
    from public.departments d join public.employees e on e.department_id = d.id and e.status = 'active'
   where d.status = 'نشط' and d.manager_id is null
   group by d.id, d.name_ar

  union all
  -- ١٠. موظف نشط بلا قسم
  select 'موظف بلا قسم', 'متوسطة', e.id, e.full_name, 'لا يدخل في تقارير الأقسام ولا كلفتها.',
         '/dashboard/hr/employees/' || e.id
    from public.employees e where e.status = 'active' and e.department_id is null

  union all
  -- ١١. موظف نشط بلا مدير مباشر ولا يدير قسماً — طلباته تتخطّى «المدير المباشر» تصعيداً
  select 'موظف بلا مدير مباشر', 'منخفضة', e.id, e.full_name,
         'مستوى «المدير المباشر» في طلباته يُصعَّد.', '/dashboard/hr/employees/' || e.id
    from public.employees e
   where e.status = 'active' and e.manager_id is null
     and not exists (select 1 from public.departments d where d.manager_id = e.id)

  union all
  -- ١٢. فريق التسويق لا يطابق قسم التسويق (D4)
  select 'خارج فريق التسويق', 'منخفضة', e.id, e.full_name,
         'في قسم تسويق وليس عضواً نشطاً في فريق التسويق — لا يرى شاشات التسويق.', '/dashboard/marketing'
    from public.employees e
   where e.status = 'active'
     and e.department_id in (select d.id from public.department_descendants(
           (select x.id from public.departments x where x.code = 'MKT')) d)
     and not exists (select 1 from public.mkt_team t where t.employee_id = e.id and t.is_active)
  union all
  select 'في فريق التسويق من خارج القسم', 'منخفضة', e.id, e.full_name,
         'عضو نشط في فريق التسويق وقسمه ليس من التسويق.', '/dashboard/marketing'
    from public.mkt_team t join public.employees e on e.id = t.employee_id
   where t.is_active and e.department_id is not null
     and e.department_id not in (select d.id from public.department_descendants(
           (select x.id from public.departments x where x.code = 'MKT')) d)

  union all
  -- ١٣. عملاء باسم نصّي لا يطابق موظفاً
  select 'مسؤول عميل بلا موظف', 'منخفضة', null::uuid, c.sales_employee,
         count(*)::text || ' عميلاً باسم مسؤول لا يطابق أي موظف.', '/dashboard/clients'
    from public.clients c
   where c.owner_id is null and nullif(btrim(c.sales_employee), '') is not null
     and c.broker_company_id is null
   group by c.sales_employee;
end $$;


-- ============================================================
-- ٣) أدوات المدير العام
-- ============================================================

-- طبّق دور المنصب على صاحبه — عبر assign_user_role (المدير العام وحده)
create or replace function public.apply_position_role(p_employee uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
  v_role text;
begin
  if not public.is_admin() then raise exception 'منح الأدوار للمدير العام وحده'; end if;
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if e.user_id is null then raise exception 'الموظف بلا حساب دخول'; end if;
  if e.status <> 'active' then raise exception 'الموظف غير نشط'; end if;
  select p.default_role_code into v_role from public.positions p where p.id = e.position_id;
  if v_role is null then raise exception 'منصبه لا يقترح دوراً'; end if;
  perform public.assign_user_role(e.user_id, v_role);
  return v_role;
end $$;

-- أغلق حساب دخول موظف خارج في auth (كما يفعل handover_employee)
create or replace function public.revoke_employee_access(p_employee uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.employees%rowtype;
begin
  if not public.is_admin() then raise exception 'إغلاق الحسابات للمدير العام وحده'; end if;
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if e.status = 'active' then raise exception 'الموظف نشط — أنهِ خدمته أولاً'; end if;
  if e.user_id is null then raise exception 'الموظف بلا حساب دخول'; end if;
  update auth.users set banned_until = 'infinity' where id = e.user_id;
end $$;


revoke all on function public.employees_integration_sync()     from public, anon, authenticated;
revoke all on function public.integration_issues()             from public, anon;
revoke all on function public.apply_position_role(uuid)        from public, anon;
revoke all on function public.revoke_employee_access(uuid)     from public, anon;
grant execute on function public.integration_issues()          to authenticated;
grant execute on function public.apply_position_role(uuid)     to authenticated;
grant execute on function public.revoke_employee_access(uuid)  to authenticated;
