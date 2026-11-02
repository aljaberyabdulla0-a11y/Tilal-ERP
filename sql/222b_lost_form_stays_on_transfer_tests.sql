-- ============================================================
-- اختبارات 222 — استمارة فشل البيع تبقى عند من خسر عند النقل.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
--
-- ⚠️ محرّر SQL يعمل بدور postgres وله bypassrls: فحص RLS يجري بعد
--    «set local role authenticated»، والمعرّفات تُجلب قبله.
-- بعدها: select * from tests.run_lost_analysis_tasks();  (كلها ok)
-- ============================================================
do $t$
declare
  v_loss uuid; v_opp uuid; v_card uuid;
  v_a uuid; v_a_user uuid; v_b uuid; v_b_user uuid;
  v_task uuid; v_other uuid;
  v_n int; v_ok boolean;
  v_log text := '';
begin
  -- T1) لا استمارة مفتوحة عند غير صاحب خسارتها وهو على رأس عمله
  select count(*) into v_n
    from public.tasks t
    join public.crm_lost_sales l on l.id = t.analysis_lost_sale_id
    join public.employees lo on lo.id = l.owner_id
   where lo.status = 'active' and lo.user_id is not null
     and t.assigned_to is distinct from lo.user_id
     and t.status in ('جديدة', 'قيد التنفيذ');
  if v_n <> 0 then raise exception 'T1 % استمارة عند غير صاحب خسارتها', v_n; end if;
  v_log := v_log || 'T1 ';

  -- T2) نقل بطاقة: استمارة صاحبها تبقى له، وبقية مهامها تنتقل (219)
  select ls.id, ls.opportunity_id, c.id, e.id, e.user_id
    into v_loss, v_opp, v_card, v_a, v_a_user
    from public.crm_lost_sales ls
    join public.opportunities o on o.id = ls.opportunity_id and o.deleted_at is null and o.closed_at is not null
    join public.clients c on c.id = o.client_id and c.deleted_at is null and c.broker_company_id is null
    join public.employees e on e.id = ls.owner_id and e.id = c.owner_id
    join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and ls.outcome = 'lost'
     and not exists (select 1 from public.projects p where p.supervisor_id = e.id)
   limit 1;
  -- المستلِم من فريقٍ آخر: فلا يرى صاحب الخسارة البطاقة إشرافاً
  select e.id, e.user_id into v_b, v_b_user
    from public.employees e join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and e.id <> v_a and e.project_id is not null
     and e.project_id is distinct from (select project_id from public.employees where id = v_a)
     and not exists (select 1 from public.employee_projects ep
                      where ep.employee_id = e.id
                        and ep.project_id in (select ep2.project_id from public.employee_projects ep2 where ep2.employee_id = v_a))
   limit 1;
  if v_loss is not null and v_b is not null then
    insert into public.tasks (title, assigned_to, status, client_id, related_client, opportunity_id,
                              analysis_lost_sale_id, due_date, priority)
    values ('استمارة فشل البيع — اختبار 222', v_a_user, 'جديدة', v_card, v_card, v_opp,
            v_loss, public.baghdad_today() + 7, 'متوسطة')
    returning id into v_task;
    insert into public.tasks (title, assigned_to, status, client_id, related_client, due_date, priority)
    values ('متابعة — اختبار 222', v_a_user, 'جديدة', v_card, v_card, public.baghdad_today() + 2, 'متوسطة')
    returning id into v_other;

    update public.clients set owner_id = v_b where id = v_card;

    if (select assigned_to from public.tasks where id = v_task) is distinct from v_a_user then
      raise exception 'T2 الاستمارة انتقلت مع البطاقة';
    end if;
    if (select assigned_to from public.tasks where id = v_other) is distinct from v_b_user then
      raise exception 'T2 المهمة العادية لم تنتقل مع البطاقة (219)';
    end if;
    v_log := v_log || 'T2 ';

    -- T3) صاحب الخسارة بعد النقل: لا يرى البطاقة، ويرى خسارته ويملك تحليلها
    perform set_config('request.jwt.claims', json_build_object('sub', v_a_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_card;
    if v_n <> 0 then reset role; raise exception 'T3 صاحب الخسارة ما زال يرى البطاقة (219)'; end if;
    select count(*) into v_n from public.v_crm_lost_sales where id = v_loss;
    if v_n <> 1 then reset role; raise exception 'T3 صاحب الخسارة لا يرى خسارته'; end if;
    select count(*) into v_n from public.opportunities where id = v_opp;
    if v_n <> 1 then reset role; raise exception 'T3 صاحب الخسارة لا يرى فرصتها'; end if;
    v_ok := public.crm_can_edit_opportunity(v_opp);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    if not v_ok then raise exception 'T3 صاحب الخسارة لا يملك فرصتها لتحليلها'; end if;
    v_log := v_log || 'T3 ';
  else
    v_log := v_log || 'T2(skip) T3(skip) ';
  end if;

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
