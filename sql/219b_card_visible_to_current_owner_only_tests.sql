-- ============================================================
-- اختبارات 219 — البطاقة لا تبقى عند الموظف السابق بعد النقل أو الدمج.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
--
-- ⚠️ محرّر SQL يعمل بدور postgres وله bypassrls: فحص RLS يجري بعد
--    «set local role authenticated»، والمعرّفات تُجلب قبله.
-- ============================================================
do $t$
declare
  v_nermeen uuid; v_nermeen_user uuid;
  v_aya uuid;     v_aya_user uuid;
  v_zulf uuid := '6dbb2d6a-4945-48a8-a080-016b365a75ad';
  v_opp  uuid := 'e1ce4388-013b-4d84-8dfa-5a0dff900674';
  v_lynda_user uuid; v_nada_card uuid;
  v_watch_user uuid; v_watch_card uuid;
  v_client uuid; v_from uuid; v_to uuid; v_to_user uuid; v_task uuid;
  v_lost_opp uuid; v_open_stage uuid; v_card_owner uuid;
  v_colleague text; v_project uuid; v_new uuid;
  v_n int; v_owner uuid;
  v_log text := '';
begin
  select id, user_id into v_nermeen, v_nermeen_user from public.employees where full_name = 'نرمين شهاب حميد';
  select id, user_id into v_aya, v_aya_user from public.employees where full_name = 'اية عبدالحسين';

  -- T1) «ذو الفقار نوري» عند آية: نرمين (منشئتها) لا تراها، وآية تراها
  perform set_config('request.jwt.claims', json_build_object('sub', v_nermeen_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clients where id = v_zulf;
  reset role;
  if v_n <> 0 then raise exception 'T1 نرمين ما زالت ترى ذو الفقار نوري (RLS)'; end if;
  if public.can_see_client(v_zulf) then raise exception 'T1 can_see_client لنرمين = true'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_aya_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clients where id = v_zulf;
  reset role;
  if v_n <> 1 then raise exception 'T1 آية لا ترى بطاقتها'; end if;
  v_log := v_log || 'T1 ';

  -- T2) لندا أدخلت بطاقات ندى في الترحيل: لا تراها بعد اليوم
  select e.user_id into v_lynda_user from public.employees e where e.full_name = 'لندا عصام';
  select c.id into v_nada_card
    from public.clients c join public.employees o on o.id = c.owner_id
   where c.created_by = v_lynda_user and o.full_name = 'ندى ماجد يس' and c.deleted_at is null
   limit 1;
  if v_nada_card is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_lynda_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_nada_card;
    reset role;
    if v_n <> 0 then raise exception 'T2 لندا ترى بطاقة ندى'; end if;
    v_log := v_log || 'T2 ';
  else
    v_log := v_log || 'T2(skip) ';
  end if;

  -- T3) المشاهِد بعد الدمج (169) لا يرى البطاقة — ما لم يكن مالكها أو مشرفه
  select e.user_id, w.client_id into v_watch_user, v_watch_card
    from public.client_watchers w
    join public.employees e on e.id = w.employee_id
    join public.clients c on c.id = w.client_id
    join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where c.deleted_at is null and c.owner_id is distinct from w.employee_id
     and c.created_by is distinct from e.user_id
   limit 1;
  if v_watch_user is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_watch_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_watch_card;
    reset role;
    if v_n <> 0 then raise exception 'T3 المشاهِد ما زال يرى البطاقة'; end if;
    v_log := v_log || 'T3 ';
  else
    v_log := v_log || 'T3(skip) ';
  end if;

  -- T4) تصحيح البيانات: فرصة ذو الفقار وفشلها الثاني لآية، والأول لنرمين
  if (select owner_id from public.opportunities where id = v_opp) is distinct from v_aya then
    raise exception 'T4 الفرصة ليست لآية';
  end if;
  if (select owner_id from public.crm_lost_sales where opportunity_id = v_opp and loss_no = 2) is distinct from v_aya then
    raise exception 'T4 الفشل الثاني ليس لآية';
  end if;
  if (select owner_id from public.crm_lost_sales where opportunity_id = v_opp and loss_no = 1) is distinct from v_nermeen then
    raise exception 'T4 الفشل الأول تغيّر';
  end if;
  v_log := v_log || 'T4 ';

  -- T5) لا مهمة مفتوحة عند موظفٍ سابق للبطاقة
  select count(*) into v_n
    from public.tasks t
    join public.clients c on c.id = t.client_id
    join public.employees e on e.user_id = t.assigned_to
   where t.status in ('جديدة', 'قيد التنفيذ') and c.deleted_at is null and e.id <> c.owner_id
     and (exists (select 1 from public.client_watchers w where w.client_id = c.id and w.employee_id = e.id)
          or exists (select 1 from public.client_assignments a where a.client_id = c.id and a.from_owner_id = e.id));
  if v_n <> 0 then raise exception 'T5 % مهمة مفتوحة عند موظف سابق', v_n; end if;
  v_log := v_log || 'T5 ';

  -- T6) نقل بطاقة ينقل مهامها المفتوحة وفرصها المفتوحة للمالك الجديد
  select t.client_id, c.owner_id, t.id into v_client, v_from, v_task
    from public.tasks t
    join public.clients c on c.id = t.client_id
    join public.employees e on e.id = c.owner_id and e.user_id = t.assigned_to
   where t.status in ('جديدة', 'قيد التنفيذ') and c.deleted_at is null and c.broker_company_id is null
   limit 1;
  select e.id, e.user_id into v_to, v_to_user
    from public.employees e join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and e.id <> v_from
   limit 1;
  if v_client is not null and v_to is not null then
    update public.clients set owner_id = v_to where id = v_client;
    if (select assigned_to from public.tasks where id = v_task) is distinct from v_to_user then
      raise exception 'T6 المهمة لم تنتقل مع البطاقة';
    end if;
    if exists (select 1 from public.opportunities
                where client_id = v_client and closed_at is null and deleted_at is null
                  and owner_id is distinct from v_to) then
      raise exception 'T6 فرصة مفتوحة لم تنتقل';
    end if;
    v_log := v_log || 'T6 ';
  else
    v_log := v_log || 'T6(skip) ';
  end if;

  -- T7) إعادة فتح فرصة مغلقة على بطاقةٍ صارت لغير صاحبها ← لمالك البطاقة
  select o.id, c.owner_id into v_lost_opp, v_card_owner
    from public.opportunities o
    join public.clients c on c.id = o.client_id
    join public.crm_stages g on g.id = o.stage_id and g.stage_type = 'lost'
   where o.deleted_at is null and o.closed_at is not null and c.deleted_at is null
     and c.owner_id is not null and o.owner_id is distinct from c.owner_id
     and not exists (select 1 from public.opportunities o2
                      where o2.client_id = c.id and o2.closed_at is null and o2.deleted_at is null)
   limit 1;
  select id into v_open_stage from public.crm_stages
   where stage_type = 'open' and coalesce(array_length(required_fields, 1), 0) = 0
   order by sort_order nulls last limit 1;
  if v_lost_opp is not null and v_open_stage is not null then
    begin
      update public.opportunities set stage_id = v_open_stage where id = v_lost_opp;
      select owner_id into v_owner from public.opportunities where id = v_lost_opp;
      if v_owner is distinct from v_card_owner then
        raise exception 'T7 الفرصة المُعاد فتحها لم تنتقل لمالك البطاقة';
      end if;
      v_log := v_log || 'T7 ';
    exception when others then
      if sqlerrm like 'T7 %' then raise; end if;
      v_log := v_log || 'T7(skip: ' || left(sqlerrm, 60) || ') ';
    end;
  else
    v_log := v_log || 'T7(skip) ';
  end if;

  -- T8) موظف يضيف عميلاً باسم زميل: الإدخال مع قراءته يعمل (نافذة الإنشاء)
  select e.full_name, e.project_id into v_colleague, v_project
    from public.employees e
   where e.status = 'active' and e.project_id is not null and e.id <> v_nermeen
     and e.job_title = 'موظف مبيعات'
   limit 1;
  if v_colleague is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_nermeen_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.clients (name, phone, sales_employee, project_id, created_by)
    values ('اختبار 219', '0770' || lpad((floor(random() * 10000000))::int::text, 7, '0'),
            v_colleague, v_project, v_nermeen_user)
    returning id into v_new;
    reset role;
    if v_new is null then raise exception 'T8 الإدخال لم يُرجع البطاقة'; end if;
    v_log := v_log || 'T8 ';
  else
    v_log := v_log || 'T8(skip) ';
  end if;

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
