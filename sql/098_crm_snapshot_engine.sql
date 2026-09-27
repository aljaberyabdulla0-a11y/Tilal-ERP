-- ============================================================
-- تلال ERP — 098: محرّك التقارير (٣/٤) — اللقطة اليومية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- ما تحفظه اللقطة
--
-- صورة الـCRM كما كانت **في نهاية يوم بغداد** — صفّ لكل (عميل × فرصة)
-- بمرحلته ومالكه وفريقه ومشروعه ومصدره وحرارته وقيمته ومتابعته وصمته
-- (crm_state_as_of في 097). لا مجاميع جاهزة: الصفّ الواحد يُجمَّع
-- بأي بُعد لاحقاً — مشروع، موظف، مصدر، حرارة، شريحة درجة، طريقة دفع،
-- غرض، منطقة، صمت — وبُعدٌ جديد غداً = عمود جديد لا جدول جديد.
--
-- ===== متى =====
--
-- ٩:٠٠ صباحاً بغداد افتراضياً (snapshot_hour_baghdad/_minute) — ولليوم
-- **السابق**. فالمرحلة والمالك وآخر تواصل والمتابعة تُعاد بناؤها من
-- التاريخ حتى نهاية الأمس بالضبط، مهما تأخّر التشغيل.
--
-- المهمة المجدولة تنبض كل ١٥ دقيقة وتقرّر بنفسها: هل حان الوقت؟ هل
-- أُخذت؟ هل فشلت فتُعاد بعد مهلة؟ هل فاتت أيام فتُستدرك؟ فتغيير الوقت
-- من الإعدادات يسري فوراً بلا إعادة جدولة.
--
-- ===== عدم التكرار (§44) =====
--
--   • لليوم تشغيلٌ معتمد واحد (فهرس فريد جزئي على is_current).
--   • تشغيلٌ ثانٍ لنفس اليوم بلا «إعادة بناء» = لا شيء؛ يُعاد معرّف الأول.
--   • قفل استشاري لليوم: تشغيلان متزامنان لا يلتقيان.
--   • إعادة البناء تكتب تشغيلاً جديداً وتُسقط اعتماد القديم **ولا تحذفه**.
--
-- ===== الفشل (§68) =====
--
-- العمل داخل كتلة فرعية: الفشل يُلغي صفوفها وحدها ويبقى صفّ التشغيل
-- بحالته «فشل» ومرحلته ورسالته وسياقه. ثم محاولة بعد ٣٠ دقيقة، حتى
-- ٣ محاولات، ثم إشعار للمدير.
--
-- يتطلب: 096، 097. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 0) الإعدادات — تُعدَّل من إعدادات الـCRM (070) بلا كود
-- ------------------------------------------------------------
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('snapshot_enabled',        to_jsonb(1),  'اللقطة اليومية مفعّلة', '١ مفعّلة · ٠ موقوفة.', '', 0, 1),
  ('snapshot_hour_baghdad',   to_jsonb(9),  'ساعة اللقطة اليومية', 'بتوقيت بغداد. اللقطة لليوم السابق.', 'ساعة', 0, 23),
  ('snapshot_minute',         to_jsonb(0),  'دقيقة اللقطة اليومية', 'تُقرَّب لأقرب ربع ساعة (نبض المهمة).', 'دقيقة', 0, 59),
  ('snapshot_max_retries',    to_jsonb(3),  'محاولات اللقطة الفاشلة', 'بعدها يُشعَر المدير ويُنتظر تدخّله.', 'محاولة', 1, 10),
  ('snapshot_retry_minutes',  to_jsonb(30), 'المهلة بين المحاولات', '', 'دقيقة', 15, 360),
  ('snapshot_catchup_days',   to_jsonb(7),  'استدراك الأيام الفائتة', 'إن توقّفت المهمة، تُؤخذ لقطات الأيام الفائتة حتى هذا العدد.', 'يوم', 0, 60),
  ('snapshot_retention_days', to_jsonb(0),  'الاحتفاظ باللقطات', '٠ = للأبد. غير ذلك: تُحذف لقطات أقدم من هذا العدد (بسجلّ تدقيق).', 'يوم', 0, 3650)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 1) إشعار الإدارة
-- ------------------------------------------------------------
create or replace function public.crm_notify_admins(p_title text, p_body text, p_link text,
                                                    p_priority text default 'عالية')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notifications (user_id, title, body, link, kind, priority, category, entity_type)
  select p.id, p_title, p_body, p_link, 'crm_report', p_priority, 'تقارير', 'crm_snapshot'
    from public.profiles p where p.role = 'admin';
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------
-- 2) التحقّق قبل اللقطة (§69)
--
-- نوعان من الملاحظات:
--   affects_snapshot = true   تمسّ صحّة اللقطة نفسها (أحداث ناقصة،
--                             تواريخ مستحيلة، إعادة بناء) — تجعل
--                             الحالة «مكتملة بتحذيرات».
--   affects_snapshot = false  جودة بيانات تُسجَّل مع اللقطة للسياق
--                             (بلا مالك، بلا خطوة قادمة…) — لا تغيّر
--                             الحالة، وإلا صارت كل لقطة «بتحذيرات»
--                             إلى الأبد فلا يعني التحذير شيئاً.
-- ------------------------------------------------------------
create or replace function public.crm_snapshot_validate(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb := '[]'::jsonb;
  n bigint;
  r record;
begin
  -- الأحداث تطابق الأصل؟
  select coalesce(sum(missing + orphaned), 0) into n from public.crm_fact_reconcile();
  if n > 0 then
    w := w || jsonb_build_object('code', 'facts_out_of_sync', 'severity', 'عالٍ', 'affects_snapshot', true,
      'title', 'أحداث لا تطابق أصلها (ناقصة أو يتيمة)', 'affected', n,
      'fix', 'عمليات اللقطات ← إعادة مزامنة الأحداث');
  end if;

  select count(*) into n from public.crm_fact_errors where resolved_at is null;
  if n > 0 then
    w := w || jsonb_build_object('code', 'fact_write_errors', 'severity', 'عالٍ', 'affects_snapshot', true,
      'title', 'أخطاء في كتابة الأحداث لم تُعالج', 'affected', n,
      'fix', 'عمليات اللقطات ← إعادة مزامنة الأحداث');
  end if;

  select count(*) into n from public.client_activities where occurred_at > now() + interval '1 hour';
  if n > 0 then
    w := w || jsonb_build_object('code', 'future_activities', 'severity', 'عالٍ', 'affects_snapshot', true,
      'title', 'تواصل بتاريخ مستقبلي', 'affected', n, 'fix', 'سجلّ التواصل');
  end if;

  select count(*) into n from public.clients
   where deleted_at is null and entry_date > public.baghdad_today();
  if n > 0 then
    w := w || jsonb_build_object('code', 'future_entry_date', 'severity', 'متوسط', 'affects_snapshot', false,
      'title', 'عملاء بتاريخ دخول مستقبلي', 'affected', n, 'fix', '/dashboard/clients');
  end if;

  select count(*) into n from public.client_activities a
   where not public.is_system_activity(a.activity_type)
     and not exists (select 1 from public.employees e where e.user_id = a.created_by);
  if n > 0 then
    w := w || jsonb_build_object('code', 'activity_no_employee', 'severity', 'متوسط', 'affects_snapshot', false,
      'title', 'تواصل سجّله حساب بلا ملفّ موظف — يُنسب لمالك العميل', 'affected', n,
      'fix', '/dashboard/hr/employees');
  end if;

  select count(*) into n
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id and g.stage_type = 'open'
    join public.employees e on e.id = o.owner_id
   where o.deleted_at is null and coalesce(e.status, 'active') <> 'active';
  if n > 0 then
    w := w || jsonb_build_object('code', 'owner_inactive', 'severity', 'عالٍ', 'affects_snapshot', false,
      'title', 'فرص مفتوحة عند موظف غير نشط', 'affected', n, 'fix', '/dashboard/crm/distribution');
  end if;

  select count(*) into n from public.client_activities a
    join public.clients c on c.id = a.client_id
   where a.occurred_at < c.created_at - interval '1 day';
  if n > 0 then
    w := w || jsonb_build_object('code', 'activity_before_client', 'severity', 'منخفض', 'affects_snapshot', false,
      'title', 'تواصل قبل تاريخ إنشاء العميل (غالباً سجلّ مستورد)', 'affected', n, 'fix', null);
  end if;

  -- جودة البيانات (077/083) كما هي — مصدرها الوحيد
  for r in select * from public.crm_data_quality() q where q.affected > 0 loop
    w := w || jsonb_build_object('code', 'dq_' || r.code, 'severity', r.severity, 'affects_snapshot', false,
      'title', r.title, 'affected', r.affected, 'fix', r.fix_path);
  end loop;

  -- إعادة بناء يومٍ مضى: القيمة والحرارة والدرجة من اليوم لا منه
  if now() - public.crm_bgd_day_end(p_date) > interval '36 hours' then
    w := w || jsonb_build_object('code', 'reconstructed', 'severity', 'متوسط', 'affects_snapshot', true,
      'title', 'لقطة مُعاد بناؤها: المرحلة والمالك والتواصل من التاريخ، والقيمة والحرارة والدرجة من يوم البناء',
      'affected', null, 'fix', null);
  end if;

  return w;
end $$;

-- ------------------------------------------------------------
-- 3) ملخّص تشغيل — من المحرّك نفسه لا بصيغ ثانية
-- ------------------------------------------------------------
create or replace function public.crm_snapshot_summary(p_run uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; e jsonb;
begin
  select q.metrics into s from public.crm_report_query(
    array['TOTAL_LEADS', 'OPEN_LEADS', 'QUALIFIED_NOW', 'OPEN_OPPORTUNITIES', 'AT_LEAD', 'AT_CONTACTED',
          'AT_VISIT', 'AT_OFFER', 'ACTIVE_RESERVATIONS', 'WON_TOTAL', 'LOST_TOTAL', 'PIPELINE_VALUE',
          'WEIGHTED_PIPELINE', 'DUE_TODAY', 'OVERDUE', 'NO_NEXT_ACTION', 'NO_CONTACT', 'NEGLECTED',
          'DORMANT', 'SLA_BREACH_OPEN', 'UNASSIGNED'],
    '{}', p_date, p_date, '{}', 'event', 'run', null, p_run) q;

  -- أحداث اليوم نفسه كما كانت ساعة اللقطة — تسجيلٌ متأخّر لاحقاً يظهر فرقاً في «التصحيحات»
  select q.metrics into e from public.crm_report_query(
    array['NEW_LEADS', 'QUALIFIED_LEADS', 'TOTAL_ACTIVITIES', 'UNIQUE_CLIENTS_CONTACTED', 'CALLS',
          'WHATSAPP', 'MEETINGS', 'VISITS', 'OFFERS_SENT', 'NOTES', 'STAGE_CHANGES', 'WON_DEALS',
          'LOST_DEALS', 'RESERVATIONS', 'SALES_COMPLETED', 'REVENUE', 'TASKS_COMPLETED'],
    '{}', p_date, p_date, '{}', 'event', 'snapshot') q;

  return coalesce(s, '{}'::jsonb) || coalesce(e, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------
-- 4) التشغيل
-- ------------------------------------------------------------
create or replace function public.crm_run_snapshot(
  p_date    date    default null,
  p_trigger text    default 'manual',
  p_reason  text    default null,
  p_force   boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d       date := coalesce(p_date, public.baghdad_today() - 1);
  api     boolean := nullif(current_setting('request.jwt.claims', true), '') is not null;
  cur     record;
  v_run   uuid;
  t0      timestamptz := clock_timestamp();
  stage   text := 'init';
  warn    jsonb := '[]'::jsonb;
  n_rows  int; n_clients int;
  summ    jsonb;
  st text; msg text; ctx text;
  att     int;
  kind    text := coalesce(p_trigger, 'manual');
begin
  -- ===== من يُشغّل =====
  if api then
    if not (public.is_admin() or public.is_followup_manager()) then
      raise exception 'تشغيل اللقطة للإدارة.' using errcode = '42501';
    end if;
    if kind not in ('manual', 'rebuild', 'backfill') then
      raise exception 'نوع تشغيل غير مسموح من الواجهة: %', kind using errcode = '42501';
    end if;
    if (p_force or kind = 'rebuild') and not public.is_admin() then
      raise exception 'إعادة بناء لقطة للمدير وحده.' using errcode = '42501';
    end if;
  end if;
  if (p_force or kind = 'rebuild') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'إعادة البناء تتطلب سبباً مكتوباً — يُحفظ مع التشغيل.';
  end if;
  if d >= public.baghdad_today() then
    raise exception 'لا لقطة ليومٍ لم ينتهِ بعد (%). اللقطة لنهاية يوم مكتمل.', d;
  end if;

  -- ===== عدم التكرار =====
  if not pg_try_advisory_xact_lock(hashtext('crm_snapshot'), d - date '2000-01-01') then
    raise exception 'لقطة % قيد التشغيل الآن.', d;
  end if;

  select * into cur from public.crm_snapshot_runs where snapshot_date = d and is_current;
  if found and not (p_force or kind = 'rebuild') then
    return cur.id;   -- مأخوذة: لا تكرار
  end if;

  select count(*) + 1 into att from public.crm_snapshot_runs where snapshot_date = d;

  insert into public.crm_snapshot_runs
    (snapshot_date, as_of, trigger_kind, method, status, requested_by, requested_by_name,
     reason, attempt, supersedes, started_at)
  values
    (d, public.crm_bgd_day_end(d), kind,
     case when now() - public.crm_bgd_day_end(d) > interval '36 hours' then 'reconstructed' else 'daily' end,
     'running', auth.uid(),
     coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'),
     nullif(btrim(p_reason), ''), att, cur.id, t0)
  returning id into v_run;

  -- ===== العمل — كتلة فرعية: فشلها يُلغي صفوفها ويُبقي صفّ التشغيل =====
  begin
    stage := 'validation';
    warn := public.crm_snapshot_validate(d);

    stage := 'extract';
    insert into public.crm_snapshot_rows
      (run_id, snapshot_date, client_id, opportunity_id, is_primary, owner_id, team_id, project_id,
       unit_id, source_id, campaign_id, stage_id, stage_name, stage_order, stage_type, milestone,
       stage_estimated, lead_open, is_new_lead, is_new_opp, is_qualified, temperature, lead_score,
       score_band, payment_method, purchase_purpose, area, expected_value, probability,
       weighted_value, won_value, lost_reason_id, lead_created_at, opp_created_at,
       expected_close_date, next_action_date, has_next_action, due_today, is_overdue,
       last_contact_at, days_silent, silence_bucket, no_contact_ever, is_neglected, is_dormant,
       has_active_reservation, sla_breach_open, is_unassigned)
    select v_run, d, s.*
      from public.crm_state_as_of(public.crm_bgd_day_end(d)) s;
    get diagnostics n_rows = row_count;

    -- اكتمال المكوّنات (§70): صفوفٌ لكل عميل كان موجوداً
    stage := 'completeness';
    select count(*) into n_clients from public.clients c
     where c.created_at <= public.crm_bgd_day_end(d)
       and (c.deleted_at is null or c.deleted_at > public.crm_bgd_day_end(d));
    if n_clients > 0 and (select count(distinct client_id) from public.crm_snapshot_rows where run_id = v_run) <> n_clients then
      raise exception 'اللقطة ناقصة: % عميلاً موجوداً و% في اللقطة', n_clients,
        (select count(distinct client_id) from public.crm_snapshot_rows where run_id = v_run);
    end if;

    stage := 'summary';
    summ := public.crm_snapshot_summary(v_run, d);

    stage := 'publish';
    update public.crm_snapshot_runs
       set is_current = false, superseded_by = v_run
     where snapshot_date = d and is_current and id <> v_run;

    update public.crm_snapshot_runs
       set is_current        = true,
           status            = case when exists (select 1 from jsonb_array_elements(warn) x
                                                  where (x->>'affects_snapshot')::boolean)
                                    then 'completed_with_warnings' else 'completed' end,
           warnings          = warn,
           warning_count     = jsonb_array_length(warn),
           records_processed = n_clients,
           records_created   = n_rows,
           summary           = summ,
           finished_at       = clock_timestamp(),
           duration_ms       = (extract(epoch from clock_timestamp() - t0) * 1000)::int
     where id = v_run;

  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, ctx = pg_exception_context;
    update public.crm_snapshot_runs
       set status         = 'failed',
           error_stage    = stage,
           error_sqlstate = st,
           error_message  = msg,
           error_context  = left(ctx, 2000),
           warnings       = warn,
           warning_count  = jsonb_array_length(warn),
           finished_at    = clock_timestamp(),
           duration_ms    = (extract(epoch from clock_timestamp() - t0) * 1000)::int
     where id = v_run;

    -- المحاولة الأخيرة المجدولة فشلت: الإدارة تعلم الآن لا غداً
    if kind in ('cron', 'retry')
       and att >= public.crm_setting_int('snapshot_max_retries', 3) then
      perform public.crm_notify_admins(
        'فشلت اللقطة اليومية ' || d::text,
        format('%s محاولات فشلت. المرحلة: %s — %s. لن تُعاد تلقائياً.', att, stage, msg),
        '/dashboard/crm/reports/snapshots', 'حرجة');
    end if;
  end;

  return v_run;
end $$;

comment on function public.crm_run_snapshot(date, text, text, boolean) is
  'يأخذ لقطة نهاية يومٍ مكتمل. مكرَّرة = لا شيء. إعادة البناء (force) للمدير بسبب، وتُبقي الأصل للمقارنة.';

-- ------------------------------------------------------------
-- 5) النبض — كل ١٥ دقيقة، يقرّر بنفسه
-- ------------------------------------------------------------
create or replace function public.crm_snapshot_tick()
returns text language plpgsql security definer set search_path = public as $$
declare
  today     date := public.baghdad_today();
  now_b     timestamp := now() at time zone 'Asia/Baghdad';
  due       timestamp := today + make_time(public.crm_setting_int('snapshot_hour_baghdad', 9),
                                           public.crm_setting_int('snapshot_minute', 0), 0);
  catchup   int := public.crm_setting_int('snapshot_catchup_days', 7);
  retries   int := public.crm_setting_int('snapshot_max_retries', 3);
  wait_min  int := public.crm_setting_int('snapshot_retry_minutes', 30);
  first_day date := (select min(snapshot_date) from public.crm_snapshot_runs);
  target    date;
  fails     int;
  last_fail timestamptz;
  purged    int;
begin
  if public.crm_setting_int('snapshot_enabled', 1) = 0 then return 'موقوفة من الإعدادات'; end if;
  if now_b < due then return 'لم يحن الوقت'; end if;

  -- أقدم يوم فائت بلا لقطة معتمدة (أمس وحده إن لم تُؤخذ لقطة قطّ).
  -- ⚠️ يومٌ استنفد محاولاته يُتخطّى — وإلا سدّ كل ما بعده إلى الأبد.
  select g::date into target
    from generate_series(today - greatest(catchup, 1), today - 1, interval '1 day') g
   where (first_day is null and g::date = today - 1 or first_day is not null and g::date >= first_day)
     and not exists (select 1 from public.crm_snapshot_runs r where r.snapshot_date = g::date and r.is_current)
     and (select count(*) from public.crm_snapshot_runs r
           where r.snapshot_date = g::date and r.status = 'failed'
             and r.trigger_kind in ('cron', 'retry')) < retries
   order by g
   limit 1;

  if target is null then
    if exists (select 1 from generate_series(greatest(coalesce(first_day, today - 1), today - greatest(catchup, 1)), today - 1, interval '1 day') g
                where not exists (select 1 from public.crm_snapshot_runs r where r.snapshot_date = g::date and r.is_current)) then
      return 'متوقّفة: يومٌ أو أكثر استنفد محاولاته — شغّله يدوياً من عمليات اللقطات';
    end if;
    -- الاحتفاظ: مرة في اليوم بعد اكتمال اللقطة
    if public.crm_setting_int('snapshot_retention_days', 0) > 0 then
      purged := public.crm_purge_snapshots();
      if purged > 0 then return 'مكتملة · حُذفت ' || purged || ' لقطة قديمة'; end if;
    end if;
    return 'مكتملة';
  end if;

  select count(*), max(started_at) into fails, last_fail
    from public.crm_snapshot_runs
   where snapshot_date = target and status = 'failed' and trigger_kind in ('cron', 'retry');

  if last_fail is not null and last_fail > now() - make_interval(mins => wait_min) then
    return 'بانتظار المحاولة التالية لـ' || target;
  end if;

  perform public.crm_run_snapshot(target, case when fails > 0 then 'retry' else 'cron' end);
  return 'شُغّلت لـ' || target;
end $$;

-- ------------------------------------------------------------
-- 6) الحالة للواجهة (§43)
-- ------------------------------------------------------------
create or replace function public.crm_snapshot_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  admin boolean := public.is_admin() or public.is_followup_manager()
                   or nullif(current_setting('request.jwt.claims', true), '') is null;
  ok record; bad record; today date := public.baghdad_today();
  h int := public.crm_setting_int('snapshot_hour_baghdad', 9);
  mi int := public.crm_setting_int('snapshot_minute', 0);
  nxt timestamptz;
begin
  select * into ok from public.crm_snapshot_runs
   where status in ('completed', 'completed_with_warnings') order by snapshot_date desc, finished_at desc limit 1;
  select * into bad from public.crm_snapshot_runs
   where status = 'failed' order by started_at desc limit 1;

  -- الموعد القادم: اليوم إن لم يحن ولم تُؤخذ لقطة الأمس، وإلا غداً
  nxt := ((today + make_time(h, mi, 0))::timestamp at time zone 'Asia/Baghdad');
  if nxt < now() and exists (select 1 from public.crm_snapshot_runs
                              where snapshot_date = today - 1 and is_current) then
    nxt := nxt + interval '1 day';
  elsif nxt < now() then
    nxt := now() + ((15 - extract(minute from now())::int % 15) || ' minutes')::interval;
  end if;

  return jsonb_build_object(
    'enabled', public.crm_setting_int('snapshot_enabled', 1) = 1,
    'schedule', jsonb_build_object('hour', h, 'minute', mi, 'timezone', 'Asia/Baghdad',
                                   'max_retries', public.crm_setting_int('snapshot_max_retries', 3),
                                   'retry_minutes', public.crm_setting_int('snapshot_retry_minutes', 30),
                                   'retention_days', public.crm_setting_int('snapshot_retention_days', 0)),
    'target_date', today - 1,
    'target_done', exists (select 1 from public.crm_snapshot_runs where snapshot_date = today - 1 and is_current),
    'next_run_at', nxt,
    'last_success', case when ok.id is null then null else jsonb_build_object(
        'run_id', ok.id, 'snapshot_date', ok.snapshot_date, 'finished_at', ok.finished_at,
        'status', ok.status, 'duration_ms', ok.duration_ms, 'rows', ok.records_created,
        'warning_count', ok.warning_count) end,
    'last_failure', case when bad.id is null then null else jsonb_build_object(
        'run_id', bad.id, 'snapshot_date', bad.snapshot_date, 'started_at', bad.started_at,
        'stage', bad.error_stage,
        'message', case when admin then bad.error_message else 'للإدارة' end,
        'recovered', exists (select 1 from public.crm_snapshot_runs x
                              where x.snapshot_date = bad.snapshot_date and x.is_current)) end,
    'fact_sync', case when admin then jsonb_build_object(
        'errors', (select count(*) from public.crm_fact_errors where resolved_at is null),
        'out_of_sync', (select coalesce(sum(missing + orphaned), 0) from public.crm_fact_reconcile())) end,
    'coverage', jsonb_build_object(
        'first_date', (select min(snapshot_date) from public.crm_snapshot_runs where is_current),
        'last_date',  (select max(snapshot_date) from public.crm_snapshot_runs where is_current),
        'days',       (select count(*) from public.crm_snapshot_runs where is_current))
  );
end $$;

-- تفاصيل تشغيل واحد: التحذيرات والخطأ والملخّص — للإدارة
create or replace function public.crm_snapshot_run_detail(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not (public.is_admin() or public.is_followup_manager()) then
    raise exception 'للإدارة.' using errcode = '42501';
  end if;
  select * into r from public.crm_snapshot_runs where id = p_run;
  if not found then return null; end if;
  return to_jsonb(r);
end $$;

-- ------------------------------------------------------------
-- 7) الأصل والمصحَّح (§46)
--
-- لكل يوم أُعيد بناؤه: الملخّص الأول المكتمل مقابل المعتمد الآن،
-- مقياساً مقياساً، ومعه من صحّح ولماذا ومتى.
-- ------------------------------------------------------------
create or replace function public.crm_snapshot_corrections(p_date date)
returns table (metric text, name_ar text, original numeric, corrected numeric, diff numeric,
               original_run uuid, corrected_run uuid, corrected_by text, reason text,
               corrected_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare o record; c record;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not (public.is_admin() or public.is_followup_manager()) then
    raise exception 'للإدارة.' using errcode = '42501';
  end if;

  select * into o from public.crm_snapshot_runs
   where snapshot_date = p_date and status in ('completed', 'completed_with_warnings')
   order by started_at asc limit 1;
  select * into c from public.crm_snapshot_runs where snapshot_date = p_date and is_current;
  if o.id is null or c.id is null or o.id = c.id then return; end if;

  return query
    select k.key, mm.name_ar,
           (o.summary->>k.key)::numeric, (c.summary->>k.key)::numeric,
           (c.summary->>k.key)::numeric - (o.summary->>k.key)::numeric,
           o.id, c.id, c.requested_by_name, c.reason, c.finished_at
      from jsonb_each(coalesce(c.summary, '{}'::jsonb)) k
      left join public.crm_metrics mm on mm.code = k.key
     where (o.summary->>k.key) is distinct from (c.summary->>k.key)
     order by mm.sort_order;
end $$;

-- ------------------------------------------------------------
-- 8) الاستدراك والاحتفاظ
-- ------------------------------------------------------------
create or replace function public.crm_backfill_snapshots(p_from date, p_to date, p_reason text)
returns table (snapshot_date date, run_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare d date; rid uuid;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null and not public.is_admin() then
    raise exception 'الاستدراك للمدير وحده.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'الاستدراك يتطلب سبباً.'; end if;
  if p_to - p_from > 400 then raise exception 'أكثر من ٤٠٠ يوم في طلب واحد — جزّئه.'; end if;

  for d in select g::date from generate_series(p_from, least(p_to, public.baghdad_today() - 1), interval '1 day') g loop
    if exists (select 1 from public.crm_snapshot_runs r where r.snapshot_date = d and r.is_current) then
      continue;   -- مأخوذة: الاستدراك لا يعيد بناء شيء
    end if;
    rid := public.crm_run_snapshot(d, 'backfill', p_reason, false);
    snapshot_date := d; run_id := rid;
    status := (select r.status from public.crm_snapshot_runs r where r.id = rid);
    return next;
  end loop;
end $$;

create or replace function public.crm_purge_snapshots()
returns int language plpgsql security definer set search_path = public as $$
declare days int := public.crm_setting_int('snapshot_retention_days', 0); n int; cutoff date;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null and not public.is_admin() then
    raise exception 'للمدير وحده.' using errcode = '42501';
  end if;
  if days <= 0 then return 0; end if;
  cutoff := public.baghdad_today() - days;

  insert into public.audit_log (table_name, operation, new_data, actor, actor_name)
  select 'crm_snapshot_runs', 'DELETE',
         jsonb_build_object('policy', 'snapshot_retention_days', 'retention_days', days,
                            'before', cutoff, 'runs', count(*), 'first', min(snapshot_date), 'last', max(snapshot_date)),
         auth.uid(), coalesce(public.display_name(auth.uid()), 'النظام')
    from public.crm_snapshot_runs where snapshot_date < cutoff
  having count(*) > 0;

  -- المعتمد أخيراً: supersedes/superseded_by تشير لبعضها — تُفكّ قبل الحذف
  update public.crm_snapshot_runs set supersedes = null, superseded_by = null where snapshot_date < cutoff;
  delete from public.crm_snapshot_runs where snapshot_date < cutoff;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------
-- 9) الجدولة
--
-- اللقطة القديمة crm-daily-snapshot (076، ١١ مساءً) تبقى: شريط الاتجاه
-- (trend-strip) يقرأ منها، وإيقافها يُفرغه. تُحال إلى هذا المحرّك
-- في هجرة لاحقة بعد أن تتراكم لقطات كافية هنا.
-- ------------------------------------------------------------
do $$ begin perform cron.unschedule('crm-snapshot-tick'); exception when others then null; end $$;
select cron.schedule('crm-snapshot-tick', '*/15 * * * *', $cron$ select public.crm_snapshot_tick(); $cron$);

-- ------------------------------------------------------------
-- 10) الصلاحيات
-- ------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'crm_notify_admins(text, text, text, text)', 'crm_snapshot_validate(date)',
    'crm_snapshot_summary(uuid, date)', 'crm_snapshot_tick()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;

  -- هذه تفحص الدور بنفسها
  foreach fn in array array[
    'crm_run_snapshot(date, text, text, boolean)', 'crm_snapshot_status()',
    'crm_snapshot_run_detail(uuid)', 'crm_snapshot_corrections(date)',
    'crm_backfill_snapshots(date, date, text)', 'crm_purge_snapshots()']
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 11) التحقّق
-- ------------------------------------------------------------
do $$
declare s jsonb;
begin
  raise notice '--- 098 اللقطة اليومية ---';
  s := public.crm_snapshot_status();
  raise notice 'الموعد القادم: % · التغطية: %', s->>'next_run_at', s->'coverage';
  raise notice 'تحذيرات التحقّق الآن: %', jsonb_array_length(public.crm_snapshot_validate(public.baghdad_today() - 1));
end $$;

notify pgrst, 'reload schema';
