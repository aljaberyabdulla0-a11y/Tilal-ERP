-- ============================================================
-- اختبارات 218 — الليد لا يضيع ولا يتكرّر.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
-- النتيجة المتوقّعة: ERROR: ROLLBACK_OK | T1 T2 … T14
--
-- ⚠️ محرّر SQL يعمل بدور postgres (bypassrls): أفعال الموظف تجري بعد
--    «set local role authenticated» ثم reset role قبل الفحص (217b).
-- ============================================================
do $t$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_emp uuid; v_emp_user uuid; v_emp2 uuid;
  v_other_client uuid;
  v_camp uuid; v_rule uuid;
  p1 text; p2 text; p3 text;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_i5 uuid;
  v_c1 uuid; v_c uuid; v_req uuid := gen_random_uuid();
  v_batch uuid; v_res jsonb; v_res2 jsonb;
  v_meta text := '9218' || lpad((floor(random() * 100000000000))::bigint::text, 11, '0');
  v_n int; v_n2 int; v_ok boolean; v_st text; v_owner uuid;
  v_log text := '';
begin
  if v_admin is null then raise exception 'SETUP: لا مدير'; end if;

  -- أرقام عراقية سليمة لا يملكها عميل قائم
  loop
    p1 := '0790' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p1) or alt_phone_key = public.normalize_iraqi_phone(p1));
  end loop;
  loop
    p2 := '0791' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p2) or alt_phone_key = public.normalize_iraqi_phone(p2));
  end loop;
  loop
    p3 := '0792' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p3) or alt_phone_key = public.normalize_iraqi_phone(p3));
  end loop;

  -- موظفان فعّالان بحساب ودور employee
  select e.id, e.user_id into v_emp, v_emp_user
    from public.employees e join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and e.end_date is null
     -- مرشّحٌ فعلاً: لا إجازة معتمدة اليوم ولا إيقاف
     and not exists (select 1 from public.leaves l where l.employee_id = e.id and l.status = 'موافق عليها'
                      and public.baghdad_today() between l.start_date and l.end_date)
     and not exists (select 1 from public.crm_assignment_availability a where a.employee_id = e.id and a.paused)
   order by e.full_name limit 1;
  select e.id into v_emp2
    from public.employees e join public.profiles pr on pr.id = e.user_id and pr.role = 'employee'
   where e.status = 'active' and e.end_date is null and e.id <> v_emp
   order by e.full_name limit 1;
  if v_emp is null or v_emp2 is null then raise exception 'SETUP: موظفان مطلوبان'; end if;

  select c.id into v_other_client from public.clients c
   where c.owner_id is distinct from v_emp and c.owner_id is not null
     and c.created_by is distinct from v_emp_user and c.broker_company_id is null and c.deleted_at is null
   limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  -- سقف الحِمل يُعطَّل في الاختبار: موظفٌ حيّ فوق السقف لا يجعل T3 يفشل لسببٍ آخر
  update public.crm_settings set value = '0' where key = 'lead_assign_respect_cap';
  insert into public.crm_campaigns (name) values ('__t218_campaign_' || v_req) returning id into v_camp;

  -- قاعدة ثابتة على الحملة لموظفنا، قبل كل القواعد الحيّة
  insert into public.crm_assignment_rules (name, strategy, match_campaign_id, target_owner_id, priority)
  values ('__t218_rule', 'ثابت', v_camp, v_emp, -1000) returning id into v_rule;

  -- T1 دفتر البطاقات: عميل يُضاف من النموذج له صفّ «card» مُحوَّل
  insert into public.clients (name, phone, stage) values ('__t218 بطاقة', p3, 'ليد') returning id into v_c;
  select count(*) into v_n from public.crm_lead_intake
   where provider = 'card' and external_id = 'client:' || v_c and client_id = v_c and status = 'مُحوَّل';
  if v_n <> 1 then raise exception 'T1 card ledger row = %', v_n; end if;
  v_log := v_log || 'T1 ';

  -- T2 ويبهوك مكرّر: نفس الحدث مرتين ⇒ صفّ واحد وعميل واحد
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone, campaign_id)
  values ('meta', v_meta, '{}'::jsonb, '__t218 ليد', p1, v_camp) returning id into v_i1;
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone, campaign_id)
  values ('meta', v_meta, '{}'::jsonb, '__t218 ليد', p1, v_camp)
  on conflict (provider, external_id) do nothing;
  v_c1 := public.intake_lead(v_i1);
  perform public.intake_lead(v_i1);
  select count(*) into v_n from public.crm_lead_intake where provider = 'meta' and external_id = v_meta;
  select count(*) into v_n2 from public.clients where phone_key = public.normalize_iraqi_phone(p1) and deleted_at is null;
  if v_c1 is null or v_n <> 1 or v_n2 <> 1 then raise exception 'T2 rows=% clients=% c1=%', v_n, v_n2, v_c1; end if;
  if (select status from public.crm_lead_intake where id = v_i1) <> 'مُحوَّل' then raise exception 'T2 status'; end if;
  -- ولا صفّ «card» لعميل البوّابة: الدفتر لا يُسجّله مرتين
  if exists (select 1 from public.crm_lead_intake where external_id = 'client:' || v_c1) then
    raise exception 'T2 gateway client also written as card';
  end if;
  v_log := v_log || 'T2 ';

  -- T3 التوزيع بالقاعدة: الحملة ⇒ موظفنا، مسجَّلاً في تاريخ الملكية، والحملة على البطاقة
  select owner_id into v_owner from public.clients where id = v_c1;
  if v_owner is distinct from v_emp then raise exception 'T3 owner % expected %', v_owner, v_emp; end if;
  if not exists (select 1 from public.client_assignments where client_id = v_c1 and to_owner_id = v_emp and method = 'توزيع تلقائي') then
    raise exception 'T3 no assignment history';
  end if;
  if (select campaign_id from public.clients where id = v_c1) is distinct from v_camp then raise exception 'T3 campaign'; end if;
  v_log := v_log || 'T3 ';

  -- T4 عميل حقيقي من حملة ثانية (حدث مختلف، نفس الهاتف) ⇒ مكرّر مربوط + نشاط، لا بطاقة ثانية
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone, email)
  values ('landing', '__t218_lead_2', '{}'::jsonb, 'اسم آخر', '+964 ' || substr(p1, 2), '__t218@example.com')
  returning id into v_i2;
  perform public.intake_lead(v_i2);
  select status, client_id into v_st, v_c from public.crm_lead_intake where id = v_i2;
  if v_st <> 'مكرّر' or v_c is distinct from v_c1 then raise exception 'T4 % %', v_st, v_c; end if;
  if (select count(*) from public.clients where phone_key = public.normalize_iraqi_phone(p1) and deleted_at is null) <> 1 then
    raise exception 'T4 second card created';
  end if;
  if not exists (select 1 from public.client_activities where client_id = v_c1 and summary like 'عاد عبر%') then
    raise exception 'T4 no returning activity';
  end if;
  v_log := v_log || 'T4 ';

  -- T5 تكرار بالبريد بلا هاتف ⇒ مكرّر لا مرفوض
  insert into public.crm_lead_intake (provider, external_id, raw, name, email)
  values ('website', '__t218_lead_3', '{}'::jsonb, 'بلا هاتف', ' __T218@example.com ') returning id into v_i3;
  perform public.intake_lead(v_i3);
  select status, client_id into v_st, v_c from public.crm_lead_intake where id = v_i3;
  if v_st <> 'مكرّر' or v_c is distinct from v_c1 then raise exception 'T5 % %', v_st, v_c; end if;
  v_log := v_log || 'T5 ';

  -- T6 رقم غير صالح ⇒ مرفوض بلا بطاقة، ثم التصحيح من قائمة الأخطاء ⇒ مُحوَّل
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone)
  values ('meta', '__t218_lead_4', '{}'::jsonb, '__t218 خطأ رقم', '12345') returning id into v_i4;
  perform public.intake_lead(v_i4);
  select status into v_st from public.crm_lead_intake where id = v_i4;
  if v_st <> 'مرفوض' or (select client_id from public.crm_lead_intake where id = v_i4) is not null then
    raise exception 'T6a %', v_st;
  end if;
  v_res := public.lead_intake_resolve(v_i4, 'fix', p2, null, null);
  if v_res->>'status' <> 'مُحوَّل' then raise exception 'T6b %', v_res; end if;
  v_log := v_log || 'T6 ';

  -- T7 فشل داخل القاعدة ⇒ «خطأ» بموعد إعادة، بلا بطاقة؛ ثم الفحص الدوري يعيده
  create function public.__t218_fail() returns trigger language plpgsql as $f$
  begin
    if new.name = '__t218 يفشل' then raise exception 'فشل مقصود'; end if;
    return new;
  end $f$;
  create trigger __t218_fail before insert on public.clients
    for each row execute function public.__t218_fail();
  loop
    p3 := '0793' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p3));
  end loop;
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone)
  values ('meta', '__t218_lead_5', '{}'::jsonb, '__t218 يفشل', p3) returning id into v_i5;
  v_c := public.intake_lead(v_i5);
  select status, coalesce(attempts, 0) into v_st, v_n from public.crm_lead_intake where id = v_i5;
  if v_c is not null or v_st <> 'خطأ' or v_n <> 1
     or (select next_retry_at from public.crm_lead_intake where id = v_i5) is null
     or (select last_error from public.crm_lead_intake where id = v_i5) not like '%فشل مقصود%' then
    raise exception 'T7a % % %', v_c, v_st, v_n;
  end if;
  drop trigger __t218_fail on public.clients;
  drop function public.__t218_fail();
  update public.crm_lead_intake set name = '__t218 نجح', next_retry_at = now() - interval '1 minute' where id = v_i5;
  perform public.scan_lead_intake();
  if (select status from public.crm_lead_intake where id = v_i5) <> 'مُحوَّل' then
    raise exception 'T7b retry did not convert: %', (select status || ' ' || coalesce(last_error, '') from public.crm_lead_intake where id = v_i5);
  end if;
  v_log := v_log || 'T7 ';

  -- T8 الإيقاف المؤقّت: موظفنا موقوف ⇒ لا يستلم ليد الحملة
  perform public.set_assignment_pause(v_emp, true, null, '__t218');
  loop
    p3 := '0794' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p3));
  end loop;
  insert into public.crm_lead_intake (provider, external_id, raw, name, phone, campaign_id)
  values ('meta', '__t218_lead_6', '{}'::jsonb, '__t218 موقوف', p3, v_camp) returning id into v_i5;
  v_c := public.intake_lead(v_i5);
  if (select owner_id from public.clients where id = v_c) is not distinct from v_emp then
    raise exception 'T8 paused employee received a lead';
  end if;
  perform public.set_assignment_pause(v_emp, false, null, null);
  v_log := v_log || 'T8 ';

  -- T9 lead_capture من موظف (RLS فعلية): الإرسال مرتين بنفس المعرّف ⇒ صفّ واحد، مُسنَد له
  loop
    p3 := '0795' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p3));
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res  := public.lead_capture('__t218 رسالة', p3, 'instagram_dm', null, null, 'مهتم بشقة', null, true, v_req);
  v_res2 := public.lead_capture('__t218 رسالة', p3, 'instagram_dm', null, null, 'مهتم بشقة', null, true, v_req);
  reset role;
  if v_res->>'intake_id' is distinct from v_res2->>'intake_id' then raise exception 'T9 two rows'; end if;
  select count(*) into v_n from public.crm_lead_intake where external_id = 'capture:' || v_req;
  if v_n <> 1 or v_res->>'status' <> 'مُحوَّل' then raise exception 'T9 % %', v_n, v_res; end if;
  if (select owner_id from public.clients where id = (v_res->>'client_id')::uuid) is distinct from v_emp then
    raise exception 'T9 not assigned to capturer';
  end if;
  if coalesce(current_setting('tilal.system_assign', true), '') = 'on' then
    raise exception 'T9 system_assign flag leaked';
  end if;
  v_log := v_log || 'T9 ';

  -- T10 الموظف لا ينقل عميلاً ليس له، والعَلَم لا يفتح له الباب
  if v_other_client is not null then
    v_ok := false;
    set local role authenticated;
    begin
      perform public.assign_client(v_other_client, v_emp, 'سرقة', 'يدوي');
    exception when others then v_ok := true;
    end;
    reset role;
    if not v_ok then raise exception 'T10 employee reassigned a colleague client'; end if;
  end if;
  v_log := v_log || 'T10 ';

  -- T11 الموظف لا يعالج قائمة الأخطاء ولا يقرأ اللوحة
  v_ok := false;
  set local role authenticated;
  begin
    perform public.lead_intake_resolve(v_i4, 'dismiss', null, null, 'x');
  exception when others then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'T11 employee resolved an intake row'; end if;
  v_ok := false;
  set local role authenticated;
  begin
    perform public.lead_hub_summary(public.baghdad_today() - 30, public.baghdad_today());
  exception when others then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'T11 employee read the hub'; end if;
  v_log := v_log || 'T11 ';

  -- T12 الاستيراد: جديد + رقم غير صالح + ليد Meta وصل بالويبهوك ⇒ 1 جديد / 1 مرفوض / 1 سبق
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  loop
    p3 := '0796' || lpad((floor(random() * 10000000))::int::text, 7, '0');
    exit when not exists (select 1 from public.clients where phone_key = public.normalize_iraqi_phone(p3));
  end loop;
  v_batch := public.lead_import_begin('__t218.xlsx', 'hash', v_camp, null, 'facebook', '{}'::jsonb);
  v_res := public.lead_import_rows(v_batch, jsonb_build_array(
    jsonb_build_object('name', '__t218 ملف', 'phone', p3, 'created_time', to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF')),
    jsonb_build_object('name', '__t218 ملف خطأ', 'phone', '07'),
    jsonb_build_object('name', '__t218 ليد', 'phone', p1, 'external_id', 'l:' || v_meta)));
  -- الثالث «l:<id>» = ليد Meta وصل بالويبهوك في T2 ⇒ «سبق تسجيله» لا صفّ ثانٍ
  if (v_res->>'created')::int <> 1 or (v_res->>'rejected')::int <> 1 or (v_res->>'already')::int <> 1 then
    raise exception 'T12a %', v_res;
  end if;
  -- T13 إعادة الدفعة نفسها (انقطاع وإعادة) ⇒ لا شيء جديد
  v_res2 := public.lead_import_rows(v_batch, jsonb_build_array(
    jsonb_build_object('name', '__t218 ملف', 'phone', p3, 'created_time', to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF')),
    jsonb_build_object('name', '__t218 ملف خطأ', 'phone', '07'),
    jsonb_build_object('name', '__t218 ليد', 'phone', p1, 'external_id', 'l:' || v_meta)));
  if (v_res2->>'already')::int <> 3 or (v_res2->>'created')::int <> 0 then raise exception 'T13 %', v_res2; end if;
  if (select count(*) from public.clients where phone_key = public.normalize_iraqi_phone(p3) and deleted_at is null) <> 1 then
    raise exception 'T13 duplicate card from re-import';
  end if;
  v_log := v_log || 'T12 T13 ';

  -- T14 اللوحة للمدير: الأرقام تشمل ما أُدخل الآن، والتفصيل بالحملة يحمل الحملة
  v_res := public.lead_hub_summary(public.baghdad_today() - 1, public.baghdad_today());
  if (v_res->>'received')::int < 8 then raise exception 'T14a %', v_res; end if;
  select received into v_n from public.lead_hub_breakdown(public.baghdad_today() - 1, public.baghdad_today(), 'campaign')
   where k = v_camp::text;
  if coalesce(v_n, 0) < 3 then raise exception 'T14b campaign received = %', v_n; end if;
  v_log := v_log || 'T14 ';

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
