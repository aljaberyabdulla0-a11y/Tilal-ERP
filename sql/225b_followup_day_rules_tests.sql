-- ============================================================
-- اختبارات 225 — قواعد يوم المتابعة (سقف يومي + لا جمعة).
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- ============================================================
do $t$
declare
  v_owner uuid; v_admin uuid;
  c1 uuid; c2 uuid; c3 uuid;
  d date; d_free date; d_fri date; d_other date;
  v_act uuid; v_date date; v_n int; v_msg text;
  st jsonb;
  v_log text := '';
begin
  -- موظف له ثلاثة عملاء مفتوحين على الأقل
  select c.owner_id into v_owner
    from public.clients c
   where c.owner_id is not null and public.is_open_stage(c.stage)
   group by c.owner_id having count(*) >= 3
   order by count(*) desc limit 1;
  if v_owner is null then raise exception 'لا موظف له 3 عملاء مفتوحين'; end if;

  select (array_agg(id order by created_at))[1], (array_agg(id order by created_at))[2],
         (array_agg(id order by created_at))[3]
    into c1, c2, c3
    from (select id, created_at from public.clients
           where owner_id = v_owner and public.is_open_stage(stage)
           order by created_at limit 3) x;

  select id into v_admin from public.profiles where role = 'admin' limit 1;

  -- يوم بعيد خالٍ: أحد (فالاثنين بعده ليس جمعة)
  d := public.baghdad_today() + 400;
  d := d - extract(dow from d)::int;          -- الأحد
  d_free  := d + 1;                           -- الاثنين
  d_other := d + 2;                           -- الثلاثاء
  d_fri   := d + 5;                           -- الجمعة
  if extract(dow from d_fri)::int <> 5 then raise exception 'حساب الجمعة خاطئ'; end if;

  update public.crm_settings set value = '2' where key = 'followup_daily_cap';
  if public.followup_daily_cap() <> 2 then raise exception 'T0 السقف لم يُقرأ من الإعداد'; end if;

  -- T1) الجمعة تُرفض — مباشرة على العميل
  begin
    update public.clients set follow_up_date = d_fri where id = c1;
    raise exception 'T1 الجمعة قُبلت';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%الجمعة%عطلة%' then raise exception 'T1 %', v_msg; end if;
  end;
  v_log := v_log || 'T1 ';

  -- T2) يمتلئ اليوم عند السقف، والرسالة تقترح أقرب يوم متاح
  update public.clients set follow_up_date = d where id = c1;
  update public.clients set follow_up_date = d where id = c2;
  begin
    update public.clients set follow_up_date = d where id = c3;
    raise exception 'T2 تجاوز السقف قُبل';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%ممتلئ%' or v_msg not like '%' || d_free::text || '%' then
      raise exception 'T2 %', v_msg;
    end if;
  end;
  v_log := v_log || 'T2 ';

  -- T3) عميل موعده في اليوم الممتلئ أصلاً: إعادة حفظه وتعديل غير الموعد لا يُرفضان
  update public.clients set follow_up_date = d where id = c1;
  update public.clients set notes = notes where id = c2;
  v_log := v_log || 'T3 ';

  -- T4) عبر تسجيل التواصل: ممتلئ يُرفض، جمعة تُرفض، يوم متاح يُقبل ويصل للعميل
  begin
    insert into public.client_activities (client_id, activity_type, summary, next_action_date)
    values (c3, 'مكالمة', 'اختبار 225', d);
    raise exception 'T4 تواصل بيوم ممتلئ قُبل';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%ممتلئ%' then raise exception 'T4a %', v_msg; end if;
  end;
  begin
    insert into public.client_activities (client_id, activity_type, summary, next_action_date)
    values (c3, 'مكالمة', 'اختبار 225', d_fri);
    raise exception 'T4 تواصل بجمعة قُبل';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%الجمعة%' then raise exception 'T4b %', v_msg; end if;
  end;
  insert into public.client_activities (client_id, activity_type, summary, next_action_date)
  values (c3, 'مكالمة', 'اختبار 225', d_free)
  returning id into v_act;
  select follow_up_date into v_date from public.clients where id = c3;
  if v_date <> d_free then raise exception 'T4c موعد العميل %', v_date; end if;
  select count(*) into v_n from public.client_activities
   where client_id = c3 and summary = 'اختبار 225';
  if v_n <> 1 then raise exception 'T4d بقي % سجلّ (المرفوض لا يُحفظ)', v_n; end if;
  v_log := v_log || 'T4 ';

  -- T5) تعديل ملخّص سجلّ قديم لا يعيد موعده القديم إلى العميل
  update public.clients set follow_up_date = d_other where id = c3;
  update public.client_activities set summary = 'اختبار 225 — معدّل' where id = v_act;
  select follow_up_date into v_date from public.clients where id = c3;
  if v_date <> d_other then raise exception 'T5 الموعد رجع إلى %', v_date; end if;
  -- وتغيير الموعد في السجلّ يصل للعميل
  -- (موعد السجلّ الآن d_free — نغيّره إلى يوم مختلف فعلاً)
  update public.client_activities set next_action_date = d + 3 where id = v_act;
  select follow_up_date into v_date from public.clients where id = c3;
  if v_date <> d + 3 then raise exception 'T5b الموعد %', v_date; end if;
  v_log := v_log || 'T5 ';

  -- T6) حالة اليوم للواجهة (بهوية مدير)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  st := public.followup_day_status(c3, d);
  if not (st->>'full')::boolean or (st->>'count')::int <> 2 or (st->>'cap')::int <> 2
     or (st->>'next_free')::date <> d_free then
    raise exception 'T6a %', st;
  end if;
  st := public.followup_day_status(c1, d);       -- لا يَعُدّ نفسه
  if (st->>'full')::boolean or (st->>'count')::int <> 1 then raise exception 'T6b %', st; end if;
  st := public.followup_day_status(c1, d_fri);
  if not (st->>'day_off')::boolean or (st->>'next_free')::date <> d_fri + 1 then
    raise exception 'T6c %', st;
  end if;
  perform set_config('request.jwt.claims', '', true);
  if public.followup_day_status(c1, d) is not null then
    raise exception 'T6d مجهول الهوية رأى الحالة';
  end if;
  v_log := v_log || 'T6 ';

  -- T7) الدمج لا يُفحص
  perform set_config('tilal.merging', 'on', true);
  update public.clients set follow_up_date = d where id = c3;
  perform set_config('tilal.merging', 'off', true);
  select public.followup_day_count(v_owner, d) into v_n;
  if v_n <> 3 then raise exception 'T7 العدّ %', v_n; end if;
  v_log := v_log || 'T7 ';

  -- T8) الصلاحيات
  if not has_function_privilege('authenticated', 'public.followup_day_status(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'public.followup_day_count(uuid, date, uuid)', 'execute')
     or has_function_privilege('anon', 'public.followup_day_status(uuid, date)', 'execute') then
    raise exception 'T8 صلاحيات الدوال';
  end if;
  v_log := v_log || 'T8 ';

  -- T9) لا موعد قادماً في جمعة بعد الترحيل
  select count(*) into v_n from public.clients
   where follow_up_date >= public.baghdad_today() and public.is_followup_day_off(follow_up_date);
  if v_n <> 0 then raise exception 'T9 بقي % موعد في جمعة', v_n; end if;
  v_log := v_log || 'T9 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
