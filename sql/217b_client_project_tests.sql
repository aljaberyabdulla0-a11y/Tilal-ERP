-- ============================================================
-- اختبارات 217 — مشروع العميل مكتوباً، ولموظفٍ على أكثر من مشروع.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
--
-- ⚠️ محرّر SQL يعمل بدور postgres وله bypassrls: انتحال المستخدم
--    بـ request.jwt.claims وحده يغيّر auth.uid() لكن RLS معطّلة. فقسم
--    الموظف (T2–T6) يجري بعد «set local role authenticated» — وإلا
--    نجح الموظف في تعديل عميلٍ ليس له (T5) ونجح الاختبار كاذباً.
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_emp uuid; v_emp_user uuid; v_emp_name text;
  v_client uuid; v_orig uuid; v_other_client uuid; v_new uuid;
  v_pa uuid; v_pb uuid; v_pc uuid;
  v_p uuid; v_n int; v_ok boolean;
  r record;
  v_log text := '';
begin
  -- 0) التعبئة: كل عميل (غير ليد وسيط) لموظفه مشروع صار له مشروع مكتوب
  select count(*) into v_n
    from public.clients c join public.employees e on e.id = c.owner_id
   where c.deleted_at is null and c.merged_into is null and c.broker_company_id is null
     and e.project_id is not null and c.project_id is null;
  if v_n <> 0 then raise exception 'T0 % clients still without a card project', v_n; end if;
  v_log := v_log || 'T0 ';

  -- عميل لموظفٍ (دوره employee) له مسار مفتوح بلا وحدة
  select c.id, c.owner_id, e.user_id, e.full_name, public.lead_project_id(c)
    into v_client, v_emp, v_emp_user, v_emp_name, v_orig
    from public.clients c
    join public.employees e on e.id = c.owner_id
    join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where c.deleted_at is null and c.merged_into is null and c.broker_company_id is null
     and exists (select 1 from public.opportunities o
                  where o.client_id = c.id and o.deleted_at is null
                    and o.closed_at is null and o.unit_id is null)
   order by c.created_at desc
   limit 1;
  if v_client is null then raise exception 'SETUP: لا عميل مناسب'; end if;

  -- عميلٌ لموظف آخر لا يراه موظفنا
  select c.id into v_other_client from public.clients c
   where c.owner_id is distinct from v_emp and c.created_by is distinct from v_emp_user
     and c.broker_company_id is null and c.deleted_at is null
   limit 1;

  insert into public.projects (name) values ('__t217_a') returning id into v_pa;
  insert into public.projects (name) values ('__t217_b') returning id into v_pb;
  insert into public.projects (name) values ('__t217_c') returning id into v_pc;

  -- الموظف على مشروعين جديدين، والأساسي الأول
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_employee_projects(v_emp, array[v_pa, v_pb], v_pa);

  -- 1) تغيير مشاريع الموظف لا ينقل عملاءه: مشروعهم مكتوب
  select public.lead_project_id(c) into v_p from public.clients c where c.id = v_client;
  if v_p is distinct from v_orig then
    raise exception 'T1 client followed the employee (got %, was %)', v_p, v_orig;
  end if;
  v_log := v_log || 'T1 ';

  -- 2) الموظف ينقل عميله لمشروعه الثاني ⇒ البطاقة والمسار المفتوح والقاعدة والحقائق
  --    (بدور authenticated فعلاً: RLS تعمل من هنا حتى T6)
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_client_project(v_client, v_pb);
  -- التحقّق بعين postgres: RLS قد تُخفي عن الموظف صفّاً فيمرّ الفحص فارغاً
  reset role;
  if (select project_id from public.clients where id = v_client) is distinct from v_pb then
    raise exception 'T2 card project not set';
  end if;
  if exists (select 1 from public.opportunities o
              where o.client_id = v_client and o.deleted_at is null and o.closed_at is null
                and o.unit_id is null and o.project_id is distinct from v_pb) then
    raise exception 'T2 open journey not synced';
  end if;
  select public.lead_project_id(c) into v_p from public.clients c where c.id = v_client;
  if v_p is distinct from v_pb then raise exception 'T2 lead_project_id = %', v_p; end if;
  if exists (select 1 from public.crm_event_facts f
              where f.client_id = v_client and f.project_id is not distinct from v_orig
                and (f.opportunity_id is null
                     or f.opportunity_id in (select o.id from public.opportunities o
                                              where o.client_id = v_client and o.deleted_at is null
                                                and o.closed_at is null and o.unit_id is null))) then
    raise exception 'T2 event facts still on old project';
  end if;
  v_log := v_log || 'T2 ';
  set local role authenticated;

  -- 3) ومُرشِّح القائمة يعدّه تحت مشروعه الجديد
  select exists (select 1 from jsonb_array_elements(public.crm_client_filter_options() -> 'projects') x
                  where (x ->> 'id')::uuid = v_pb) into v_ok;
  if not v_ok then raise exception 'T3 filter options miss the new project'; end if;
  v_log := v_log || 'T3 ';

  -- 4) مشروعٌ ليس من مشاريعه ⇒ مرفوض
  begin
    perform public.set_client_project(v_client, v_pc);
    raise exception 'T4 foreign project allowed';
  exception when others then
    if sqlerrm like 'T4%' then raise; end if;
  end;
  v_log := v_log || 'T4 ';

  -- 5) عميلٌ خارج نطاقه ⇒ مرفوض
  if v_other_client is not null then
    begin
      perform public.set_client_project(v_other_client, v_pa);
      raise exception 'T5 out-of-scope client allowed';
    exception when others then
      if sqlerrm like 'T5%' then raise; end if;
    end;
  end if;
  v_log := v_log || 'T5 ';

  -- 6) جماعةً: عميله يُنقل، والخارج عن نطاقه يُعدّ فاشلاً بلا إسقاط الدفعة
  select * into r from public.bulk_set_client_project(
    array_remove(array[v_client, v_other_client], null), v_pa);
  if r.succeeded <> 1 or r.failed <> (case when v_other_client is null then 0 else 1 end) then
    raise exception 'T6 bulk ok=% bad=% (%)', r.succeeded, r.failed, r.first_error;
  end if;
  reset role;
  if (select project_id from public.clients where id = v_client) is distinct from v_pa then
    raise exception 'T6 bulk did not move the client';
  end if;
  if v_other_client is not null
     and (select project_id from public.clients where id = v_other_client) = v_pa then
    raise exception 'T6 bulk moved an out-of-scope client';
  end if;
  v_log := v_log || 'T6 ';

  -- 7) الإدارة: أيّ مشروع
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_client_project(v_client, v_pc);
  if (select project_id from public.clients where id = v_client) is distinct from v_pc then
    raise exception 'T7 admin could not set any project';
  end if;
  v_log := v_log || 'T7 ';

  -- 8) عميلٌ جديد بلا مشروع (استيراد، إعلان) ⇒ يولد بمشروع موظّفه، ومساره معه
  insert into public.clients (name, sales_employee, owner_id)
  values ('__t217_new', v_emp_name, v_emp)
  returning id, project_id into v_new, v_p;
  if v_p is distinct from v_pa then raise exception 'T8 new client project = % (want %)', v_p, v_pa; end if;
  if exists (select 1 from public.opportunities o where o.client_id = v_new and o.project_id is distinct from v_pa) then
    raise exception 'T8 new journey not on the client project';
  end if;
  v_log := v_log || 'T8 ';

  -- 9) والمشروع المختار في النموذج لا يُداس
  insert into public.clients (name, sales_employee, owner_id, project_id)
  values ('__t217_new2', v_emp_name, v_emp, v_pb)
  returning project_id into v_p;
  if v_p is distinct from v_pb then raise exception 'T9 chosen project overwritten (%)', v_p; end if;
  v_log := v_log || 'T9 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
