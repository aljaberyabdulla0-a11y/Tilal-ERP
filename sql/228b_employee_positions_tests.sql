-- ============================================================
-- اختبارات 227 + 228 — أساس التدقيق وتعدد الوظائف.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_emp   public.employees%rowtype;   -- الموظف قيد الاختبار
  v_oth   public.employees%rowtype;   -- موظف عادي آخر (مدير الوظيفة الإضافية)
  v_thr   public.employees%rowtype;   -- موظف ثالث لا علاقة له (سلبي RLS)
  v_pos2 uuid; v_pos3 uuid; v_id uuid; v_id2 uuid; v_n int; v_old_pos uuid;
  v_prim public.employee_positions%rowtype;
  v_log text := '';
  v_roles text[] := array['employee','sales_employee','marketing_employee','crm_employee'];
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- T0 (227) الأعمدة والوحدات
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log' and column_name in ('reason','source')) <> 2 then
    raise exception 'T0 audit_log columns missing';
  end if;
  if (select count(*) from public.app_modules where enforced and code in ('positions_assign','responsibilities',
      'responsibility_assign','review_teams','quality_control','permission_grants','workload','allowances')) <> 8 then
    raise exception 'T0 modules missing';
  end if;
  v_log := v_log || 'T0 ';

  -- T1 الترحيل: كل موظف نشط له منصب ⇒ أساسية فعّالة واحدة مطابقة
  select count(*) into v_n from public.employees e
   where e.position_id is not null and e.status = 'active'
     and not exists (select 1 from public.employee_positions ep
                      where ep.employee_id = e.id and ep.kind = 'primary' and ep.status = 'active'
                        and ep.position_id = e.position_id and ep.workload_pct = 100);
  if v_n <> 0 then raise exception 'T1 backfill missing for % employees', v_n; end if;
  v_log := v_log || 'T1 ';

  select e.* into v_emp from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and e.position_id is not null and p.role_code = any (v_roles)
   order by e.full_name limit 1;
  select e.* into v_oth from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id <> v_emp.id
     and e.id <> coalesce(v_emp.manager_id, z) and coalesce(e.manager_id, z) <> v_emp.id
   order by e.full_name limit 1;
  select e.* into v_thr from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id not in (v_emp.id, v_oth.id)
     and e.id <> coalesce(v_emp.manager_id, z) and coalesce(e.manager_id, z) not in (v_emp.id, v_oth.id)
   order by e.full_name limit 1;
  if v_emp.id is null or v_oth.id is null or v_thr.id is null then raise exception 'T fixtures: not enough employees'; end if;
  v_old_pos := v_emp.position_id;
  select p.id into v_pos2 from public.positions p
   where p.status = 'نشط' and p.id <> v_emp.position_id and p.department_id is distinct from v_emp.department_id
   order by p.code limit 1;
  select p.id into v_pos3 from public.positions p
   where p.status = 'نشط' and p.id not in (v_emp.position_id, v_pos2) order by p.code limit 1;

  -- T2 موظف عادي لا يعيّن وظائف
  perform set_config('request.jwt.claims', json_build_object('sub', v_oth.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_pos2));
    raise exception 'T2 non-HR allowed';
  exception when others then if sqlerrm like 'T2%' then raise; end if;
  end;
  v_log := v_log || 'T2 ';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- T3 تجاوز ١٠٠٪ يُرفض (الأساسية 100)
  begin
    perform public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_pos2, 'workload_pct', 10));
    raise exception 'T3 over 100 allowed';
  exception when others then
    if sqlerrm like 'T3%' then raise; end if;
    if sqlerrm not like '%١٠٠٪%' then raise exception 'T3 wrong error: %', sqlerrm; end if;
  end;
  v_log := v_log || 'T3 ';

  -- T4 خفض الأساسية إلى 70 ثم وظيفة إضافية 30 في قسم آخر بمدير آخر
  select * into v_prim from public.employee_positions where employee_id = v_emp.id and kind = 'primary' and status = 'active';
  perform public.update_position_assignment(v_prim.id, jsonb_build_object('workload_pct', 70), 'اختبار 228: خفض');
  v_id := public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_pos2, 'workload_pct', 30,
                                                    'reports_to', v_oth.id, 'reason', 'اختبار 228'));
  if (select status from public.employee_positions where id = v_id) <> 'active'
     or (select reports_to from public.employee_positions where id = v_id) <> v_oth.id
     or (select position_id from public.employees where id = v_emp.id) <> v_old_pos
     or public.employee_planned_workload(v_emp.id) <> 100 then
    raise exception 'T4 additional position failed';
  end if;
  v_log := v_log || 'T4 ';

  -- T5 (227) سبب التغيير ومصدره في السجلّ
  if not exists (select 1 from public.audit_log where table_name = 'employee_positions' and record_id = v_id
                    and reason = 'اختبار 228' and source = 'assign_position') then
    raise exception 'T5 audit reason/source not recorded';
  end if;
  v_log := v_log || 'T5 ';

  -- T6 نفس المنصب في فترة متداخلة يُرفض
  begin
    perform public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_pos2, 'workload_pct', 0));
    raise exception 'T6 overlap allowed';
  exception when others then if sqlerrm like 'T6%' then raise; end if;
  end;
  v_log := v_log || 'T6 ';

  -- T7 المؤقتة بلا نهاية تُرفض
  begin
    perform public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_pos3, 'kind', 'temporary'));
    raise exception 'T7 temporary without end allowed';
  exception when others then if sqlerrm like 'T7%' then raise; end if;
  end;
  v_log := v_log || 'T7 ';

  -- T8 أساسية فعّالة ثانية مستحيلة حتى بالكتابة المباشرة
  begin
    perform set_config('tilal.employee_positions', 'off', true);
    insert into public.employee_positions (employee_id, position_id, kind, start_date) values (v_emp.id, v_pos3, 'primary', current_date);
    raise exception 'T8 second primary allowed';
  exception when unique_violation then null;
  end;
  perform set_config('tilal.employee_positions', '', true);
  v_log := v_log || 'T8 ';

  -- T9 (Q4) صلاحيات الوظيفة الإضافية: المدير العام وحده
  perform set_config('request.jwt.claims', json_build_object('sub', v_oth.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.set_position_permissions(v_id, true, null, 'اختبار');
    raise exception 'T9 non-admin granted';
  exception when others then if sqlerrm like 'T9%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_position_permissions(v_id, true, current_date + 30, 'اختبار 228: صلاحيات');
  if not (select grants_role_permissions and permissions_granted_by = v_admin and permissions_expire_on = current_date + 30
            from public.employee_positions where id = v_id) then
    raise exception 'T9 permissions not recorded';
  end if;
  v_log := v_log || 'T9 ';

  -- T10 إنهاء الإضافية: يبقى السجلّ
  perform public.end_position_assignment(v_id, current_date, 'اختبار 228: إنهاء');
  if (select status from public.employee_positions where id = v_id) <> 'ended'
     or (select end_date from public.employee_positions where id = v_id) is null then
    raise exception 'T10 end failed';
  end if;
  v_log := v_log || 'T10 ';

  -- T11 مسار نموذج HR القديم: تغيير المنصب في employees ⇒ تاريخ
  select count(*) into v_n from public.employee_positions where employee_id = v_emp.id;
  update public.employees set position_id = v_pos3 where id = v_emp.id;
  if (select count(*) from public.employee_positions where employee_id = v_emp.id) <> v_n + 1
     or (select status from public.employee_positions where id = v_prim.id) <> 'ended'
     or not exists (select 1 from public.employee_positions where employee_id = v_emp.id and kind = 'primary'
                       and status = 'active' and position_id = v_pos3 and workload_pct = 70) then
    raise exception 'T11 legacy position change not historised';
  end if;
  v_log := v_log || 'T11 ';

  -- T12 الترقية: إضافية ⇒ أساسية، والمرآة تتبع (المنصب والمدير)
  v_id2 := public.assign_position(jsonb_build_object('employee_id', v_emp.id, 'position_id', v_old_pos, 'workload_pct', 30,
                                                     'reports_to', v_oth.id, 'start_date', current_date));
  perform public.set_primary_position(v_id2, 'اختبار 228: ترقية');
  if (select position_id from public.employees where id = v_emp.id) <> v_old_pos
     or (select manager_id from public.employees where id = v_emp.id) is distinct from v_oth.id
     or (select count(*) from public.employee_positions where employee_id = v_emp.id and kind = 'primary' and status = 'active') <> 1 then
    raise exception 'T12 set primary failed';
  end if;
  v_log := v_log || 'T12 ';

  -- T13 RLS: الموظف يرى تعييناته، والثالث لا يراها
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.employee_positions where employee_id = v_emp.id;
  if v_n < 3 then reset role; raise exception 'T13 employee sees % own rows', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_thr.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.employee_positions where employee_id = v_emp.id;
  if v_n <> 0 then reset role; raise exception 'T13 unrelated employee sees % rows', v_n; end if;
  -- ولا كتابة مباشرة
  begin
    update public.employee_positions set workload_pct = 1 where employee_id = v_thr.id;
    reset role; raise exception 'T13 direct update allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_log := v_log || 'T13 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
