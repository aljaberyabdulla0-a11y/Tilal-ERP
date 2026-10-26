-- ============================================================
-- اختبارات 216 — الموظف على أكثر من مشروع.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_sup_user uuid;          -- مشرف المشروع الثاني
  v_emp uuid;
  v_n int; v_prim uuid; v_ok boolean;
  v_log text := '';
begin
  -- ثلاثة مشاريع مؤقتة، والثاني له مشرف حقيقي (مستخدم غير المدير)
  select e.user_id into v_sup_user
    from public.employees e join public.profiles pr on pr.id = e.user_id
   where e.user_id is not null and pr.role <> 'admin'
   order by e.full_name limit 1;

  insert into public.projects (name) values ('__t216_a') returning id into v_p1;
  insert into public.projects (name, supervisor_id)
  values ('__t216_b', (select id from public.employees where user_id = v_sup_user))
  returning id into v_p2;
  insert into public.projects (name) values ('__t216_c') returning id into v_p3;

  -- موظف آخر غير المشرف
  select e.id into v_emp from public.employees e
   where e.user_id is distinct from v_sup_user and e.status = 'active'
   order by e.full_name limit 1;

  -- 1) كتابة الأساسي مباشرةً (مسار HR) ⇒ عضوية
  update public.employees set project_id = v_p1 where id = v_emp;
  select count(*) into v_n from public.employee_projects where employee_id = v_emp and project_id = v_p1;
  if v_n <> 1 then raise exception 'T1 primary→membership failed'; end if;
  v_log := v_log || 'T1 ';

  -- 2) غير المدير ممنوع
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup_user, 'role', 'authenticated')::text, true);
  begin
    perform public.set_employee_projects(v_emp, array[v_p1, v_p2]);
    raise exception 'T2 non-admin allowed';
  exception when others then
    if sqlerrm like 'T2%' then raise; end if;
  end;
  -- والمشرف لا يرى الموظف قبل إسناده لمشروعه
  select exists (select 1 from public.my_scope_employees() s where s.id = v_emp) into v_ok;
  if v_ok then raise exception 'T2 supervisor sees employee before assignment'; end if;
  v_log := v_log || 'T2 ';

  -- 3) المدير يُسند مشروعين، والأساسي الثاني
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_prim := public.set_employee_projects(v_emp, array[v_p1, v_p2], v_p2);
  select count(*) into v_n from public.employee_projects
   where employee_id = v_emp and project_id in (v_p1, v_p2);
  if v_n <> 2 or v_prim <> v_p2
     or (select project_id from public.employees where id = v_emp) <> v_p2 then
    raise exception 'T3 set two projects failed (n=%, prim=%)', v_n, v_prim;
  end if;
  v_log := v_log || 'T3 ';

  -- 4) مشرف المشروع الثاني يرى الموظف الآن، والمنظور يحمل المشروعين
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup_user, 'role', 'authenticated')::text, true);
  select exists (select 1 from public.my_scope_employees() s where s.id = v_emp) into v_ok;
  if not v_ok then raise exception 'T4 supervisor does not see employee'; end if;
  select cardinality(project_ids) into v_n from public.team_members where id = v_emp;
  if v_n is distinct from 2 then raise exception 'T4 team_members.project_ids = %', v_n; end if;
  v_log := v_log || 'T4 ';

  -- 5) إزالة الأساسي من المجموعة ⇒ الأساسي يصير الباقي
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_prim := public.set_employee_projects(v_emp, array[v_p1]);
  if v_prim <> v_p1 or (select project_id from public.employees where id = v_emp) <> v_p1 then
    raise exception 'T5 primary not moved';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup_user, 'role', 'authenticated')::text, true);
  select exists (select 1 from public.my_scope_employees() s where s.id = v_emp) into v_ok;
  if v_ok then raise exception 'T5 supervisor still sees removed employee'; end if;
  v_log := v_log || 'T5 ';

  -- 6) HR تنقل الأساسي مباشرةً ⇒ نقل (القديم يُزال) والإضافي يبقى
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_employee_projects(v_emp, array[v_p1, v_p2], v_p1);
  update public.employees set project_id = v_p3 where id = v_emp;
  select count(*) into v_n from public.employee_projects
   where employee_id = v_emp and project_id in (v_p1, v_p2, v_p3);
  if v_n <> 2
     or exists (select 1 from public.employee_projects where employee_id = v_emp and project_id = v_p1) then
    raise exception 'T6 HR move failed (n=%)', v_n;
  end if;
  v_log := v_log || 'T6 ';

  -- 7) حذف صفّ الأساسي مباشرةً ⇒ يُصلَح إلى الباقي
  delete from public.employee_projects where employee_id = v_emp and project_id = v_p3;
  if (select project_id from public.employees where id = v_emp) is distinct from v_p2 then
    raise exception 'T7 primary not repaired';
  end if;
  v_log := v_log || 'T7 ';

  -- 8) حذف المشروع الأساسي كله ⇒ الأساسي يصير مشروعه الآخر
  perform public.set_employee_projects(v_emp, array[v_p1, v_p2], v_p2);
  delete from public.projects where id = v_p2;
  if (select project_id from public.employees where id = v_emp) is distinct from v_p1 then
    raise exception 'T8 project delete left primary=%', (select project_id from public.employees where id = v_emp);
  end if;
  v_log := v_log || 'T8 ';

  -- 9) مجموعة فارغة ⇒ بلا مشروع
  perform public.set_employee_projects(v_emp, '{}');
  if (select project_id from public.employees where id = v_emp) is not null
     or exists (select 1 from public.employee_projects where employee_id = v_emp) then
    raise exception 'T9 clear failed';
  end if;
  v_log := v_log || 'T9 ';

  -- 10) الثابت على البيانات الحقيقية: كل أساسي له عضوية
  select count(*) into v_n from public.employees e
   where e.project_id is not null
     and not exists (select 1 from public.employee_projects ep
                      where ep.employee_id = e.id and ep.project_id = e.project_id);
  if v_n <> 0 then raise exception 'T10 % employees without primary membership', v_n; end if;
  v_log := v_log || 'T10 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
