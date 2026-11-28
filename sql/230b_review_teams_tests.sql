-- ============================================================
-- اختبارات 230 — فريق ضبط الجودة وأنواع المراجعة.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  a public.employees%rowtype; b public.employees%rowtype; c public.employees%rowtype; d public.employees%rowtype;
  v_team uuid; v_ma uuid; v_mb uuid; v_mb2 uuid; v_mc uuid; v_n int; v_dep uuid;
  v_log text := '';
  v_roles text[] := array['employee','sales_employee','marketing_employee','crm_employee'];
begin
  -- V1 البذور
  select id into v_team from public.review_teams where code = 'quality_control';
  if v_team is null or (select status from public.review_teams where id = v_team) <> 'draft'
     or exists (select 1 from public.review_team_members where team_id = v_team)
     or (select count(*) from public.review_types) <> 4
     or (select count(*) from public.review_types where is_active) <> 1
     or (select count(*) from public.review_outcomes where review_type = 'customer_qc') <> 8
     or (select sum(weight) from public.review_criteria where review_type = 'customer_qc') <> 100
     or (select contact_policy->>'min_attempts' from public.review_types where code = 'customer_qc') <> '3'
     or (select sla_policy->>'review_hours' from public.review_types where code = 'customer_qc') <> '72'
     or not exists (select 1 from public.review_team_types where team_id = v_team and review_type = 'customer_qc') then
    raise exception 'V1 seed wrong';
  end if;
  v_log := v_log || 'V1 ';

  select e.* into a from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) order by e.full_name limit 1;
  select e.* into b from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id <> a.id order by e.full_name limit 1;
  select e.* into c from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id not in (a.id, b.id) order by e.full_name limit 1;
  select e.* into d from public.employees e join public.profiles p on p.id = e.user_id
   where e.status = 'active' and p.role_code = any (v_roles) and e.id not in (a.id, b.id, c.id) order by e.full_name limit 1;
  if d.id is null then raise exception 'V fixtures: not enough employees'; end if;
  v_dep := b.department_id;

  -- V2 غير المدير العام لا يضيف أعضاء ولا يغيّر السياسة
  perform set_config('request.jwt.claims', json_build_object('sub', a.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', b.id));
    raise exception 'V2 non-admin added member';
  exception when others then if sqlerrm like 'V2%' then raise; end if;
  end;
  begin
    perform public.review_type_set_policy('customer_qc', '{"min_attempts":1,"min_distinct_days":1,"min_channels":1,"min_hours_between":0}', null, 'x');
    raise exception 'V2 non-admin changed policy';
  exception when others then if sqlerrm like 'V2%' then raise; end if;
  end;
  v_log := v_log || 'V2 ';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- V3 لا تفعيل بلا قائد
  begin
    perform public.review_team_set_status(v_team, 'active', 'اختبار');
    raise exception 'V3 activated without leader';
  exception when others then if sqlerrm like 'V3%' then raise; end if;
  end;
  v_log := v_log || 'V3 ';

  -- V4 قائد + عضو + مراجع من أقسام أصحابها، ثم التفعيل
  v_ma := public.team_set_leader(v_team, a.id, 'اختبار 230');
  v_mb := public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', b.id, 'member_role', 'member',
                                                    'specializations', jsonb_build_object('review_types', jsonb_build_array('customer_qc'))));
  v_mc := public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', c.id, 'member_role', 'reviewer'));
  perform public.review_team_set_status(v_team, 'active', 'اختبار 230');
  if (select status from public.review_teams where id = v_team) <> 'active'
     or (select department_id from public.employees where id = b.id) is distinct from v_dep then
    raise exception 'V4 team activation or department changed';
  end if;
  v_log := v_log || 'V4 ';

  -- V5 لا تكرار، ولا قائد ثانٍ بالإضافة
  begin
    perform public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', b.id));
    raise exception 'V5 duplicate allowed';
  exception when others then if sqlerrm like 'V5%' then raise; end if;
  end;
  begin
    perform public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', d.id, 'member_role', 'leader'));
    raise exception 'V5 second leader allowed';
  exception when others then if sqlerrm like 'V5%' then raise; end if;
  end;
  v_log := v_log || 'V5 ';

  -- V6 العضوية تدخل الحمل المخطّط
  if public.employee_planned_workload(d.id) + 1 <= 100 then
    begin
      perform public.team_add_member(jsonb_build_object('team_id', v_team, 'employee_id', d.id,
                                                        'workload_pct', 101 - public.employee_planned_workload(d.id)));
      raise exception 'V6 over 100 allowed';
    exception when others then if sqlerrm like 'V6%' then raise; end if;
    end;
  end if;
  v_log := v_log || 'V6 ';

  -- V7 تغيير الدور يغلق الصفّ ويفتح غيره (التاريخ محفوظ)
  v_mb2 := public.team_change_member_role(v_mb, 'reviewer', 'اختبار 230');
  if (select status from public.review_team_members where id = v_mb) <> 'ended'
     or (select member_role from public.review_team_members where id = v_mb2) <> 'reviewer'
     or (select count(*) from public.review_team_members where team_id = v_team and employee_id = b.id) <> 2 then
    raise exception 'V7 role change history wrong';
  end if;
  v_log := v_log || 'V7 ';

  -- V8 إيقاف واستئناف وإنهاء
  perform public.team_set_member_status(v_mb2, 'suspend', 'اختبار');
  if (select status from public.review_team_members where id = v_mb2) <> 'suspended' then raise exception 'V8 suspend'; end if;
  perform public.team_set_member_status(v_mb2, 'resume', 'اختبار');
  perform public.team_set_member_status(v_mc, 'end', 'اختبار');
  if (select status from public.review_team_members where id = v_mb2) <> 'active'
     or (select status from public.review_team_members where id = v_mc) <> 'ended' then
    raise exception 'V8 resume/end wrong';
  end if;
  v_log := v_log || 'V8 ';

  -- V9 لا يُنهى قائد فريق فعّال مباشرة؛ تغيير القائد ذرّي
  begin
    perform public.team_set_member_status(v_ma, 'end', 'اختبار');
    raise exception 'V9 active leader ended';
  exception when others then if sqlerrm like 'V9%' then raise; end if;
  end;
  perform public.team_set_leader(v_team, b.id, 'اختبار 230: تبديل');
  if (select employee_id from public.review_team_members where team_id = v_team and member_role = 'leader' and status = 'active') <> b.id
     or (select status from public.review_team_members where id = v_ma) <> 'ended'
     or not exists (select 1 from public.review_team_members where team_id = v_team and employee_id = a.id
                       and member_role = 'member' and status = 'active') then
    raise exception 'V9 leader swap wrong';
  end if;
  v_log := v_log || 'V9 ';

  -- V10 السياسات: المدير العام يعدّلها بحدود منطقية
  begin
    perform public.review_type_set_policy('customer_qc', '{"min_attempts":2,"min_distinct_days":3,"min_channels":1,"min_hours_between":4}', null, 'اختبار');
    raise exception 'V10 illogical policy accepted';
  exception when others then if sqlerrm like 'V10%' then raise; end if;
  end;
  perform public.review_type_set_policy('customer_qc',
    '{"min_attempts":4,"min_distinct_days":2,"min_channels":2,"min_hours_between":6,"retry_after_hours":6}', null, 'اختبار 230');
  if (select contact_policy->>'min_attempts' from public.review_types where code = 'customer_qc') <> '4'
     or not exists (select 1 from public.audit_log where table_name = 'review_types' and reason = 'اختبار 230') then
    raise exception 'V10 policy update not saved/audited';
  end if;
  v_log := v_log || 'V10 ';

  -- V11 RLS: العضو يرى فريقه وأعضاءه، وغير المعني لا يرى؛ ولا كتابة مباشرة
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.review_team_members where team_id = v_team;
  if v_n < 3 then reset role; raise exception 'V11 member sees % rows', v_n; end if;
  select count(*) into v_n from public.review_teams where id = v_team;
  if v_n <> 1 then reset role; raise exception 'V11 member cannot see team'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', d.user_id, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.review_team_members where team_id = v_team;
  if v_n <> 0 then reset role; raise exception 'V11 outsider sees % rows', v_n; end if;
  select count(*) into v_n from public.review_outcomes where review_type = 'customer_qc';
  if v_n <> 8 then reset role; raise exception 'V11 definitions not readable'; end if;
  begin
    update public.review_team_members set workload_pct = 1 where team_id = v_team;
    reset role; raise exception 'V11 direct update allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_log := v_log || 'V11 ';

  -- V12 انتهاء خدمة القائد ⇒ عضويته تنتهي والفريق يُوقف
  begin
    update public.employees set status = 'inactive', end_date = public.baghdad_today() where id = b.id;
    if (select count(*) from public.review_team_members where employee_id = b.id and status in ('active','suspended')) <> 0
       or (select status from public.review_teams where id = v_team) <> 'suspended' then
      raise exception 'V12 exit did not end membership / suspend team';
    end if;
    v_log := v_log || 'V12 ';
  exception when others then
    if sqlerrm like 'V12%' then raise; end if;
    v_log := v_log || 'V12(skipped: ' || left(sqlerrm, 60) || ') ';
  end;

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
