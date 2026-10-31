-- ============================================================
-- اختبارات 220 — تصحيح الموظف لاسم العميل ورقمه مرة واحدة.
-- كتلة واحدة تنتهي باستثناء ROLLBACK_OK فلا يبقى منها أثر.
--
-- ⚠️ محرّر SQL يعمل بدور postgres وله bypassrls: أفعال الموظف تجري بعد
--    «set local role authenticated»، والمعرّفات تُجلب قبله.
-- ============================================================
do $t$
declare
  v_user uuid; v_admin uuid;
  v_card uuid; v_name text; v_phone text;
  v_row public.clients%rowtype;
  v_n int; v_err text;
  v_log text := '';
begin
  -- موظف مبيعات (دور employee) وبطاقة يملكها برقم، ليست لوسيط
  select e.user_id, c.id, c.name, c.phone into v_user, v_card, v_name, v_phone
    from public.clients c
    join public.employees e on e.id = c.owner_id
    join public.profiles p on p.id = e.user_id and p.role = 'employee'
   where c.deleted_at is null and c.broker_company_id is null
     and c.phone is not null and c.contact_corrected_at is null
   limit 1;
  if v_card is null then raise exception 'لا بطاقة لموظف مبيعات للاختبار'; end if;
  select id into v_admin from public.profiles where role = 'admin' limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- T1) الاسم لا يُفرَّغ، والرقم لا يُمسح — ولا يُستهلك التصحيح بهما
  begin
    set local role authenticated;
    update public.clients set name = '  ' where id = v_card;
    reset role;
    raise exception 'T1 قُبل اسمٌ فارغ';
  exception when others then
    reset role;
    if sqlerrm like 'T1%' then raise; end if;
  end;
  begin
    set local role authenticated;
    update public.clients set phone = null where id = v_card;
    reset role;
    raise exception 'T1 قُبل مسح الرقم';
  exception when others then
    reset role;
    if sqlerrm like 'T1%' then raise; end if;
  end;
  if (select contact_corrected_at from public.clients where id = v_card) is not null then
    raise exception 'T1 الرفض استهلك التصحيح';
  end if;
  v_log := v_log || 'T1 ';

  -- T2) التصحيح الأول يمرّ، ويُختم بوقته وفاعله وما قبله
  set local role authenticated;
  update public.clients set name = v_name || ' (تصحيح)', phone = '07700000220' where id = v_card;
  get diagnostics v_n = row_count;
  reset role;
  if v_n <> 1 then raise exception 'T2 RLS منعت الموظف من بطاقته'; end if;
  select * into v_row from public.clients where id = v_card;
  if v_row.name <> v_name || ' (تصحيح)' or v_row.phone <> '07700000220' then raise exception 'T2 لم يُحفظ'; end if;
  if v_row.contact_corrected_at is null or v_row.contact_corrected_by is distinct from v_user then
    raise exception 'T2 لم يُختم';
  end if;
  if v_row.contact_before ->> 'name' <> v_name or v_row.contact_before ->> 'phone' <> v_phone then
    raise exception 'T2 contact_before خطأ: %', v_row.contact_before;
  end if;
  v_log := v_log || 'T2 ';

  -- T3) المرة الثانية تُرفض — بالرقم وحده أيضاً
  v_err := null;
  begin
    set local role authenticated;
    update public.clients set phone = '07700000221' where id = v_card;
    reset role;
  exception when others then
    reset role;
    v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%مرة واحدة%' then raise exception 'T3 قُبل تصحيحٌ ثانٍ: %', v_err; end if;
  v_log := v_log || 'T3 ';

  -- T4) لا يصفّر الختم ليصحّح ثانية، وتعديل غير الاسم والرقم يمرّ
  set local role authenticated;
  update public.clients set contact_corrected_at = null, contact_before = null where id = v_card;
  update public.clients set area = coalesce(area, '') where id = v_card;
  reset role;
  if (select contact_corrected_at is null or contact_before is null from public.clients where id = v_card) then
    raise exception 'T4 الموظف صفّر الختم';
  end if;
  v_log := v_log || 'T4 ';

  -- T5) المدير يعدّل بلا حدّ ولا يمسّ الختم
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.clients set name = v_name where id = v_card;
    update public.clients set phone = v_phone where id = v_card;
    reset role;
    select * into v_row from public.clients where id = v_card;
    if v_row.name <> v_name or v_row.phone <> v_phone then raise exception 'T5 المدير مُنع'; end if;
    if v_row.contact_corrected_by is distinct from v_user then raise exception 'T5 تغيّر الختم'; end if;
    v_log := v_log || 'T5 ';
  else
    v_log := v_log || 'T5(skip) ';
  end if;

  raise exception 'ROLLBACK_OK | %', v_log;
end $t$;
