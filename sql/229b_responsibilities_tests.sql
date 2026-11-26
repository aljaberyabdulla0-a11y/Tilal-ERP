-- ============================================================
-- اختبارات 229 — المسؤوليات التشغيلية والتكليف.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  a public.employees%rowtype; b public.employees%rowtype; c public.employees%rowtype; d public.employees%rowtype;
  v_lq uuid; v_sla uuid; v_id uuid; v_ib uuid; v_ic uuid; v_ib2 uuid; v_new uuid; v_n int; v_r jsonb;
  v_log text := '';
  v_roles text[] := array['employee','sales_employee','marketing_employee','crm_employee'];
begin
  -- R1 المكتبة الأولية: 38 معطّلة بلا صلاحيات، و Customer QC ليست بينها
  if (select count(*) from public.responsibility_catalog where is_seed) <> 38
     or exists (select 1 from public.responsibility_catalog where is_seed and is_active)
     or exists (select 1 from public.responsibility_permissions rp join public.responsibility_catalog c on c.id = rp.responsibility_id where c.is_seed)
     or exists (select 1 from public.responsibility_catalog where code ilike '%customer_q%') then
    raise exception 'R1 seed wrong';
  end if;
  v_log := v_log || 'R1 ';

  -- أربعة موظفين عاديين بلا علاقة إدارية بينهم
  select e.* into a from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) order by e.full_name limit 1;
  select e.* into b from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id <> a.id order by e.full_name limit 1;
  select e.* into c from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id not in (a.id, b.id) order by e.full_name limit 1;
  select e.* into d from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id not in (a.id, b.id, c.id)
     and coalesce(e.manager_id, a.id) not in (b.id, c.id) and b.manager_id is distinct from e.id
   order by e.full_name limit 1;
  if d.id is null then raise exception 'R fixtures: not enough employees'; end if;
  select id into v_lq from public.responsibility_catalog where code = 'mkt_lead_quality';
  select id into v_sla from public.responsibility_catalog where code = 'ops_sla_compliance';

  -- R2 موظف عادي لا يدير المكتبة ولا يكلّف
  perform set_config('request.jwt.claims', json_build_object('sub', c.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.responsibility_save(jsonb_build_object('id', v_lq, 'is_active', true));
    raise exception 'R2 non-admin saved';
  exception when others then if sqlerrm like 'R2%' then raise; end if;
  end;
  v_log := v_log || 'R2 ';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- R2b لا تكليف بمسؤولية معطّلة
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', a.id));
    raise exception 'R2b inactive assigned';
  exception when others then if sqlerrm like 'R2b%' then raise; end if;
  end;

  -- R3 تفعيل + رئيسي واحد + مساعد
  perform public.responsibility_save(jsonb_build_object('id', v_lq, 'is_active', true, 'max_assignees', 2, 'reason', 'اختبار 229'));
  v_id := public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', a.id, 'assignee_role', 'lead',
                                                          'supervisor_id', d.id, 'reason', 'اختبار 229'));
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', b.id, 'assignee_role', 'lead'));
    raise exception 'R3 second lead allowed';
  exception when others then if sqlerrm like 'R3%' then raise; end if;
  end;
  v_ib := public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', b.id, 'assignee_role', 'assistant'));
  if (select count(*) from public.responsibility_assignments where responsibility_id = v_lq and status = 'active') <> 2 then
    raise exception 'R3 lead+assistant failed';
  end if;
  v_log := v_log || 'R3 ';

  -- R4 تكليف مكرّر لنفس الموظف يُرفض
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', a.id, 'assignee_role', 'assistant'));
    raise exception 'R4 duplicate allowed';
  exception when others then if sqlerrm like 'R4%' then raise; end if;
  end;
  v_log := v_log || 'R4 ';

  -- R5 الحدّ الأقصى للمكلَّفين
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', c.id, 'assignee_role', 'assistant'));
    raise exception 'R5 max exceeded';
  exception when others then if sqlerrm like 'R5%' then raise; end if;
  end;
  v_log := v_log || 'R5 ';

  -- R6 المؤقت بلا نهاية يُرفض
  perform public.responsibility_save(jsonb_build_object('id', v_sla, 'is_active', true, 'requires_lead', false));
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_sla, 'employee_id', c.id, 'is_permanent', false));
    raise exception 'R6 temporary without end allowed';
  exception when others then if sqlerrm like 'R6%' then raise; end if;
  end;
  v_log := v_log || 'R6 ';

  -- R7 الحمل يشمل المسؤوليات: من حمله 100 لا يأخذ 10
  if public.employee_planned_workload(a.id) > 100 then raise exception 'R7 baseline over 100'; end if;
  begin
    perform public.update_responsibility_assignment(v_id, jsonb_build_object('workload_pct', 101 - public.employee_planned_workload(a.id)), 'اختبار');
    raise exception 'R7 over 100 allowed';
  exception when others then if sqlerrm like 'R7%' then raise; end if;
  end;
  v_log := v_log || 'R7 ';

  -- R8 صلاحيات المسؤولية: المدير العام وحده، ووحدات معروفة فقط، ولا منح للمنح
  perform set_config('request.jwt.claims', json_build_object('sub', c.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.responsibility_set_permissions(v_lq, '[{"module":"quality_control","actions":["read"],"scope":"own"}]', 'اختبار');
    raise exception 'R8 non-admin set permissions';
  exception when others then if sqlerrm like 'R8%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.responsibility_set_permissions(v_lq, '[{"module":"quality_control","actions":["read"],"scope":"own"}]', 'اختبار 229');
  if (select count(*) from public.responsibility_permissions where responsibility_id = v_lq) <> 1 then raise exception 'R8 not saved'; end if;
  begin
    perform public.responsibility_set_permissions(v_lq, '[{"module":"no_such","actions":["read"]}]', 'اختبار');
    raise exception 'R8 unknown module allowed';
  exception when others then if sqlerrm like 'R8%' then raise; end if;
  end;
  begin
    perform public.responsibility_set_permissions(v_lq, '[{"module":"permission_grants","actions":["read"]}]', 'اختبار');
    raise exception 'R8 permission_grants allowed';
  exception when others then if sqlerrm like 'R8%' then raise; end if;
  end;
  v_log := v_log || 'R8 ';

  -- R9 الانتهاء التلقائي والتنبيه مرة واحدة
  v_ic := public.assign_responsibility(jsonb_build_object('responsibility_id', v_sla, 'employee_id', c.id, 'is_permanent', false,
                                                          'start_date', current_date - 10, 'end_date', current_date - 1));
  v_ib2 := public.assign_responsibility(jsonb_build_object('responsibility_id', v_sla, 'employee_id', b.id, 'is_permanent', false,
                                                           'assignee_role', 'assistant', 'end_date', public.baghdad_today() + 3));
  v_r := public.responsibility_expiry_scan();
  perform public.responsibility_expiry_scan();
  if (select status from public.responsibility_assignments where id = v_ic) <> 'ended'
     or (select status from public.responsibility_assignments where id = v_ib2) <> 'active'
     or (select count(*) from public.notifications where entity_id = v_ib2 and title = 'تكليف يقترب من نهايته') <> 1 then
    raise exception 'R9 expiry scan wrong: %', v_r;
  end if;
  v_log := v_log || 'R9 ';

  -- R10 النقل: القديم منتهٍ والجديد رئيسي فعّال
  v_new := public.transfer_responsibility(v_id, c.id, 'اختبار 229');
  if (select status from public.responsibility_assignments where id = v_id) <> 'ended'
     or not exists (select 1 from public.responsibility_assignments where id = v_new and employee_id = c.id
                       and assignee_role = 'lead' and status = 'active' and supervisor_id = d.id) then
    raise exception 'R10 transfer failed';
  end if;
  v_log := v_log || 'R10 ';

  -- R11 RLS: المكلَّف يرى تكليفه والمشرف يراه، وغير المعني لا يرى؛ ولا كتابة مباشرة
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.responsibility_assignments where employee_id = b.id;
  if v_n < 2 then reset role; raise exception 'R11 assignee sees % rows', v_n; end if;
  select count(*) into v_n from public.responsibility_catalog where id = v_lq;
  if v_n <> 1 then reset role; raise exception 'R11 assignee cannot read catalog row'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', d.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.responsibility_assignments where id = v_new;
  if v_n <> 1 then reset role; raise exception 'R11 supervisor cannot see'; end if;
  select count(*) into v_n from public.responsibility_assignments where id = v_ib;
  if v_n <> 0 then reset role; raise exception 'R11 unrelated sees assistant row'; end if;
  begin
    update public.responsibility_assignments set workload_pct = 1 where id = v_new;
    reset role; raise exception 'R11 direct update allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_log := v_log || 'R11 ';

  -- R12 الأرشفة ترفض مع تكليفات فعّالة، وتنجح بعد إنهائها، والمؤرشف لا يُكلَّف
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.responsibility_archive(v_lq, 'اختبار');
    raise exception 'R12 archived with active';
  exception when others then if sqlerrm like 'R12%' then raise; end if;
  end;
  perform public.end_responsibility_assignment(v_new, null, 'اختبار 229');
  perform public.end_responsibility_assignment(v_ib, null, 'اختبار 229');
  perform public.responsibility_archive(v_lq, 'اختبار 229');
  begin
    perform public.assign_responsibility(jsonb_build_object('responsibility_id', v_lq, 'employee_id', a.id));
    raise exception 'R12 archived assigned';
  exception when others then if sqlerrm like 'R12%' then raise; end if;
  end;
  if (select count(*) from public.responsibility_assignments where responsibility_id = v_lq) < 3 then
    raise exception 'R12 history lost';
  end if;
  v_log := v_log || 'R12 ';

  -- R13 سبب التغيير في السجلّ، والجدولة موجودة
  if not exists (select 1 from public.audit_log where table_name = 'responsibility_assignments' and reason = 'اختبار 229') then
    raise exception 'R13 audit reason missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'responsibility-expiry') then raise exception 'R13 cron missing'; end if;
  v_log := v_log || 'R13 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
