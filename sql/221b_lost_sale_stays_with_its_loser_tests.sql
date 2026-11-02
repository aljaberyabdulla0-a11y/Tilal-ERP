-- ============================================================
-- اختبارات 221 — فشل البيع على من خسره، وإنهاء الخدمة لا يحمّله للمستلِم.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر — فيها إنهاء
-- خدمة تجريبي يُلغى كله.
-- بعدها: select * from tests.run_lost_analysis_tasks();  (كلها ok)
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_lynda uuid := (select id from public.employees where full_name = 'لندا عصام');
  v_nada  uuid := (select id from public.employees where full_name = 'ندى ماجد يس');
  v_a uuid; v_a_user uuid; v_b uuid; v_b_user uuid;
  v_loss uuid; v_opp uuid; v_card uuid; v_task uuid;
  v_res jsonb; v_owner uuid; v_n int;
  v_log text := '';
begin
  -- T1) لا استمارة مفتوحة لخسارةٍ غادر صاحبها — لا عند المستلِم ولا غيره
  select count(*) into v_n
    from public.tasks t
    join public.crm_lost_sales l on l.id = t.analysis_lost_sale_id
    join public.employees lo on lo.id = l.owner_id
   where lo.status <> 'active' and t.status in ('جديدة', 'قيد التنفيذ');
  if v_n <> 0 then raise exception 'T1 % استمارة مفتوحة لخسائر من غادروا', v_n; end if;
  v_log := v_log || 'T1 ';

  -- T2) خسارة غادر صاحبها لا تُسند لأحد
  select count(*) into v_n
    from public.crm_lost_sales l join public.employees lo on lo.id = l.owner_id
   where lo.status <> 'active' and public.crm_lost_analysis_assignee(l.id) is not null;
  if v_n <> 0 then raise exception 'T2 % خسارة لراحلٍ ما زالت تُسند لغيره', v_n; end if;
  v_log := v_log || 'T2 ';

  -- T3) ملفات لندا: خسائرها قبل التسليم وإعادة تسجيلها للندا، لا لندى
  if v_lynda is not null and v_nada is not null then
    select count(*) into v_n
      from public.crm_lost_sales ls join public.opportunities o on o.id = ls.opportunity_id
     where ls.owner_id = v_lynda
       and exists (select 1 from public.client_activities a
                    where a.client_id = o.client_id and a.activity_type = 'تسليم'
                      and a.summary like 'نُقل الملف من لندا عصام إلى ندى ماجد يس%');
    if v_n <> 33 then raise exception 'T3 خسائر لندا % (المتوقع ٣٣)', v_n; end if;
    select count(*) into v_n
      from public.crm_lost_sales ls
      join public.employee_handovers h on h.from_employee = v_lynda and h.to_employee = v_nada
     where ls.owner_id = v_nada and ls.lost_at < h.created_at
       and ls.opportunity_id in (select o.id from public.opportunities o
                                  join public.client_activities a on a.client_id = o.client_id
                                 where a.activity_type = 'تسليم'
                                   and a.summary like 'نُقل الملف من لندا عصام إلى ندى ماجد يس%');
    if v_n <> 0 then raise exception 'T3 % خسارة قبل التسليم ما زالت على ندى', v_n; end if;
    select count(*) into v_n
      from public.crm_event_facts f
     where f.event_type = 'stage_change' and f.employee_id = v_nada
       and f.opportunity_id in (select ls.opportunity_id from public.crm_lost_sales ls where ls.owner_id = v_lynda);
    if v_n <> 0 then raise exception 'T3 % حدث مرحلة لفرص لندا على ندى', v_n; end if;
    select count(*) into v_n
      from public.crm_snapshot_rows r
     where r.stage_type = 'lost' and r.owner_id = v_nada
       and r.opportunity_id in (select ls.opportunity_id from public.crm_lost_sales ls where ls.owner_id = v_lynda);
    if v_n <> 0 then raise exception 'T3 % لقطة خاسرة لفرص لندا على ندى', v_n; end if;
    v_log := v_log || 'T3 ';
  else
    v_log := v_log || 'T3(skip) ';
  end if;

  -- T4) «إعادة تواصل» لخسارة راحلة ← مالك البطاقة الحالي
  select l.opportunity_id, l.owner_id, ce.user_id into v_opp, v_owner, v_b_user
    from public.crm_lost_sales l
    join public.employees lo on lo.id = l.owner_id and lo.status <> 'active'
    join public.opportunities o on o.id = l.opportunity_id and o.deleted_at is null
    join public.clients c on c.id = o.client_id and c.deleted_at is null
    join public.employees ce on ce.id = c.owner_id and ce.status = 'active' and ce.user_id is not null
   limit 1;
  if v_opp is not null then
    v_task := public.crm_upsert_recontact_task(null, v_opp, v_owner, public.baghdad_today() + 3, 'اختبار 221');
    if (select assigned_to from public.tasks where id = v_task) is distinct from v_b_user then
      raise exception 'T4 إعادة التواصل لم تذهب لمالك البطاقة الحالي';
    end if;
    v_log := v_log || 'T4 ';
  else
    v_log := v_log || 'T4(skip) ';
  end if;

  -- T5) إنهاء خدمة تجريبي: البطاقة الخاسرة تنتقل، والخسارة واستمارتها لا
  select ls.id, ls.opportunity_id, c.id, e.id, e.user_id
    into v_loss, v_opp, v_card, v_a, v_a_user
    from public.crm_lost_sales ls
    join public.opportunities o on o.id = ls.opportunity_id and o.deleted_at is null and o.closed_at is not null
    join public.clients c on c.id = o.client_id and c.deleted_at is null and c.broker_company_id is null
    join public.employees e on e.id = ls.owner_id and e.id = c.owner_id
    join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and c.stage = 'فشل البيع' and ls.outcome = 'lost'
     and public.name_key(c.sales_employee) = public.name_key(e.full_name)
   limit 1;
  select e.id, e.user_id into v_b, v_b_user
    from public.employees e join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and e.id <> v_a
   limit 1;
  if v_loss is not null and v_b is not null and v_admin is not null then
    -- استمارة مفتوحة عند الراحل على خسارته (أياً كانت حالة تحليلها)
    insert into public.tasks (title, assigned_to, status, client_id, related_client, opportunity_id,
                              analysis_lost_sale_id, due_date, priority)
    values ('استمارة فشل البيع — اختبار 221', v_a_user, 'جديدة', v_card, v_card, v_opp,
            v_loss, public.baghdad_today() + 7, 'متوسطة')
    returning id into v_task;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_res := public.handover_employee(v_a, v_b, 'اختبار 221', true, false, null);
    perform set_config('request.jwt.claims', '', true);

    if coalesce((v_res ->> 'lost_forms_cancelled')::int, 0) < 1 then
      raise exception 'T5 الإنهاء لم يُرجع الاستمارات الملغاة: %', v_res;
    end if;
    if (select status from public.tasks where id = v_task) <> 'ملغاة'
       or (select assigned_to from public.tasks where id = v_task) is distinct from v_a_user then
      raise exception 'T5 الاستمارة انتقلت للمستلِم بدل أن تُلغى';
    end if;
    if exists (select 1 from public.tasks t join public.crm_lost_sales l on l.id = t.analysis_lost_sale_id
                where t.assigned_to = v_b_user and l.owner_id = v_a and t.status in ('جديدة', 'قيد التنفيذ')) then
      raise exception 'T5 عند المستلِم استمارة لخسارة الراحل';
    end if;
    if (select owner_id from public.clients where id = v_card) is distinct from v_b then
      raise exception 'T5 البطاقة الخاسرة لم تنتقل للمستلِم';
    end if;
    if (select owner_id from public.crm_lost_sales where id = v_loss) is distinct from v_a
       or (select owner_id from public.opportunities where id = v_opp) is distinct from v_a then
      raise exception 'T5 الخسارة أو فرصتها انتقلت للمستلِم';
    end if;
    if public.crm_lost_analysis_assignee(v_loss) is not null then
      raise exception 'T5 خسارة الراحل ما زالت تُسند لأحد';
    end if;
    v_log := v_log || 'T5 ';
  else
    v_log := v_log || 'T5(skip) ';
  end if;

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
