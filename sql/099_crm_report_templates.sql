-- ============================================================
-- تلال ERP — 099: محرّك التقارير (٤/٤) — القوالب والتشغيل والجدولة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- التقرير بيانات لا صفحة
--
-- التقرير = تعريف JSON: أقسام، ولكل قسم مقاييسه (من crm_metrics)
-- وأبعاده ونوع عرضه (مؤشّرات · اتجاه · جدول · مصفوفة · قمع · حركة
-- أنابيب · ملاحظات). الواجهة تقرأ التعريف وتسأل المحرّك (097) عن كل
-- قسم. فتقرير جديد = صفّ جديد، لا صفحة جديدة ولا صيغة جديدة.
--
--     القالب النظامي   يُكتب بهجرة، يراه من في «جمهوره» (audience)
--     القالب المخصّص   يُنشئه المدير أو مدير المتابعة أو المشرف من
--                      «منشئ التقارير»، خاصّاً أو مشتركاً
--
-- ⚠️ الجمهور يحكم **ظهور القالب** لا البيانات. البيانات تحكمها RLS
--    على الأحداث واللقطات: الموظف يفتح «أداء المبيعات اليومي» فيرى
--    صفّه وحده، والمشرف فريقه، والمدير الشركة — من نفس القالب.
--
-- ============================================================
-- التقارير المجدولة (§41)
--
-- لا بريد في النظام (لا خادم إرسال ولا مفاتيح). فالتسليم **إشعار
-- داخلي** برابط إلى تشغيلٍ محفوظ: المدى محسوم يوم الإرسال، والأرقام
-- تُحسب عند الفتح **بصلاحية المستلم** — فلا يستلم مشرفٌ أرقام الشركة
-- لأن المدير هو من جدول التقرير. والأحداث واللقطات تاريخية، فالرقم
-- الذي يفتحه غداً هو رقم اليوم (إلا تواصلاً سُجِّل متأخراً بتاريخه).
--
-- يتطلب: 097، 098. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) القوالب
-- ------------------------------------------------------------
create table if not exists public.crm_report_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                       -- للنظامية؛ المخصّصة بلا رمز
  name         text not null,
  description  text,
  category     text not null default 'مخصّص',
  definition   jsonb not null,
  audience     text[] not null default array['admin', 'followup_manager', 'supervisor', 'viewer'],
  is_system    boolean not null default false,
  is_shared    boolean not null default false,
  is_active    boolean not null default true,
  sort_order   int not null default 100,
  version      int not null default 1,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_report_templates_def_chk check (jsonb_typeof(definition -> 'sections') = 'array')
);

comment on table public.crm_report_templates is
  'تعريف التقرير: أقسامٌ كلٌّ منها مقاييس × أبعاد × عرض. النظامية بهجرة، والمخصّصة من منشئ التقارير (099).';

-- كل تعديل على قالب يرفع رقم نسخته — ويظهر في رأس التقرير (§39)
create or replace function public.crm_report_template_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.definition is distinct from old.definition then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_crm_report_template_touch on public.crm_report_templates;
create trigger trg_crm_report_template_touch before update on public.crm_report_templates
  for each row execute function public.crm_report_template_touch();

-- ------------------------------------------------------------
-- 2) سجلّ التشغيل (§40)
-- ------------------------------------------------------------
create table if not exists public.crm_report_runs (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid references public.crm_report_templates(id) on delete set null,
  template_code     text,
  report_name       text not null,
  template_version  int,
  requested_by      uuid default auth.uid(),
  requested_by_name text,
  recipients        uuid[] not null default '{}',
  schedule_id       uuid,
  trigger_kind      text not null default 'manual',
  format            text not null default 'view',
  status            text not null default 'completed',
  params            jsonb not null default '{}'::jsonb,
  date_from         date,
  date_to           date,
  rows_returned     int,
  duration_ms       int,
  error             text,
  snapshot_date     date,
  data_version      text not null default 'engine-1',
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  constraint crm_report_runs_trigger_chk check (trigger_kind in ('manual', 'schedule', 'export')),
  constraint crm_report_runs_format_chk  check (format in ('view', 'xlsx', 'csv', 'pdf')),
  constraint crm_report_runs_status_chk  check (status in ('completed', 'failed', 'delivered'))
);

create index if not exists crm_report_runs_user_idx     on public.crm_report_runs (requested_by, started_at desc);
create index if not exists crm_report_runs_template_idx on public.crm_report_runs (template_id, started_at desc);
create index if not exists crm_report_runs_started_idx  on public.crm_report_runs (started_at desc);

-- التسجيل من الواجهة: يُختم الاسم وآخر لقطة معتمدة من القاعدة لا من المتصفّح
create or replace function public.crm_log_report_run(
  p_template_id uuid, p_report_name text, p_trigger text, p_format text, p_params jsonb,
  p_from date, p_to date, p_rows int, p_duration_ms int, p_status text default 'completed',
  p_error text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; t record;
begin
  if auth.uid() is null then raise exception 'بلا مستخدم.' using errcode = '42501'; end if;
  select * into t from public.crm_report_templates where id = p_template_id;
  insert into public.crm_report_runs
    (template_id, template_code, report_name, template_version, requested_by, requested_by_name,
     trigger_kind, format, status, params, date_from, date_to, rows_returned, duration_ms, error,
     snapshot_date, finished_at)
  values
    (p_template_id, t.code, coalesce(t.name, p_report_name, 'تقرير'), t.version, auth.uid(),
     coalesce(public.my_employee_name(), public.display_name(auth.uid())),
     coalesce(p_trigger, 'manual'), coalesce(p_format, 'view'), coalesce(p_status, 'completed'),
     coalesce(p_params, '{}'::jsonb), p_from, p_to, p_rows, p_duration_ms, left(p_error, 2000),
     (select max(snapshot_date) from public.crm_snapshot_runs where is_current and snapshot_date <= coalesce(p_to, public.baghdad_today())),
     now())
  returning id into rid;
  return rid;
end $$;

-- ------------------------------------------------------------
-- 3) الجدولة (§41)
-- ------------------------------------------------------------
create table if not exists public.crm_report_schedules (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.crm_report_templates(id) on delete cascade,
  name          text not null,
  frequency     text not null default 'daily',
  run_time      time not null default '08:30',
  timezone      text not null default 'Asia/Baghdad',
  weekday       int,                        -- ٠ الأحد … ٦ السبت (للأسبوعي)
  month_day     int,                        -- ١–٢٨ (للشهري)
  range_preset  text not null default 'yesterday',
  compare       text not null default 'previous_period',
  filters       jsonb not null default '{}'::jsonb,
  recipients    uuid[] not null,
  format        text not null default 'view',
  is_active     boolean not null default true,
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  last_status   text,
  last_error    text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint crm_report_schedules_freq_chk   check (frequency in ('daily', 'weekly', 'monthly')),
  constraint crm_report_schedules_tz_chk     check (timezone = 'Asia/Baghdad'),
  constraint crm_report_schedules_wd_chk     check (weekday is null or weekday between 0 and 6),
  constraint crm_report_schedules_md_chk     check (month_day is null or month_day between 1 and 28),
  constraint crm_report_schedules_preset_chk check (range_preset in
    ('today', 'yesterday', 'last_7', 'last_14', 'last_30', 'this_week', 'last_week',
     'this_month', 'last_month', 'this_quarter', 'last_quarter')),
  constraint crm_report_schedules_cmp_chk    check (compare in ('none', 'previous_period', 'previous_year')),
  constraint crm_report_schedules_fmt_chk    check (format in ('view', 'xlsx', 'pdf')),
  constraint crm_report_schedules_rcpt_chk   check (cardinality(recipients) between 1 and 50)
);

-- المدى من الاختصار — بتوقيت بغداد، ونفس تعريف الواجهة (report-dates.ts)
create or replace function public.crm_resolve_range(p_preset text, p_today date default null)
returns table (date_from date, date_to date)
language plpgsql stable set search_path = public as $$
declare
  t  date := coalesce(p_today, public.baghdad_today());
  ws date := public.crm_week_start(t);
  q  date := (date_trunc('quarter', t))::date;
begin
  case p_preset
    when 'today'        then date_from := t;                        date_to := t;
    when 'yesterday'    then date_from := t - 1;                    date_to := t - 1;
    when 'last_7'       then date_from := t - 6;                    date_to := t;
    when 'last_14'      then date_from := t - 13;                   date_to := t;
    when 'last_30'      then date_from := t - 29;                   date_to := t;
    when 'this_week'    then date_from := ws;                       date_to := t;
    when 'last_week'    then date_from := ws - 7;                   date_to := ws - 1;
    when 'this_month'   then date_from := date_trunc('month', t)::date; date_to := t;
    when 'last_month'   then date_from := (date_trunc('month', t) - interval '1 month')::date;
                             date_to   := (date_trunc('month', t) - interval '1 day')::date;
    when 'this_quarter' then date_from := q;                        date_to := t;
    when 'last_quarter' then date_from := (q - interval '3 months')::date; date_to := q - 1;
    else raise exception 'اختصار مدى غير معروف: %', p_preset;
  end case;
  return next;
end $$;

-- الموعد القادم بعد لحظة معيّنة
create or replace function public.crm_schedule_next_run(
  p_frequency text, p_time time, p_weekday int, p_month_day int, p_after timestamptz default now())
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  local_after timestamp := p_after at time zone 'Asia/Baghdad';
  d date := local_after::date;
  cand timestamp;
begin
  for i in 0 .. 62 loop
    cand := (d + i) + p_time;
    continue when cand <= local_after;
    if p_frequency = 'daily'
       or (p_frequency = 'weekly'  and extract(dow from d + i) = coalesce(p_weekday, 0))
       or (p_frequency = 'monthly' and extract(day from d + i) = coalesce(p_month_day, 1)) then
      return cand at time zone 'Asia/Baghdad';
    end if;
  end loop;
  return null;
end $$;

-- التحقّق عند الحفظ: المستلمون يملكون دوراً يقرأ التقارير، والموعد يُحسب
create or replace function public.crm_report_schedule_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad int;
begin
  select count(*) into bad
    from unnest(new.recipients) u
   where not exists (select 1 from public.profiles p
                      where p.id = u and p.role in ('admin', 'followup_manager', 'supervisor',
                                                    'employee', 'marketing', 'viewer', 'accountant'));
  if bad > 0 then
    raise exception 'مستلمٌ بلا دور يقرأ التقارير (%).', bad;
  end if;
  if new.frequency = 'weekly' and new.weekday is null then new.weekday := 0; end if;
  if new.frequency = 'monthly' and new.month_day is null then new.month_day := 1; end if;
  -- ⚠️ فرعان لا شرطٌ واحد بـ or: OLD غير معرَّف في الإدراج، وSQL لا يَعِد
  --    بتقييم مختصر — فقراءة old.run_time قد تُقيَّم فتُسقط الإدراج.
  if tg_op = 'INSERT' then
    new.next_run_at := public.crm_schedule_next_run(new.frequency, new.run_time, new.weekday, new.month_day);
  elsif new.run_time is distinct from old.run_time
     or new.frequency is distinct from old.frequency or new.weekday is distinct from old.weekday
     or new.month_day is distinct from old.month_day or (new.is_active and not old.is_active) then
    new.next_run_at := public.crm_schedule_next_run(new.frequency, new.run_time, new.weekday, new.month_day);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_crm_report_schedule_before on public.crm_report_schedules;
create trigger trg_crm_report_schedule_before before insert or update on public.crm_report_schedules
  for each row execute function public.crm_report_schedule_before();

-- المُشغِّل — كل ١٥ دقيقة
create or replace function public.crm_run_due_report_schedules()
returns int language plpgsql security definer set search_path = public as $$
declare s record; t record; rng record; rid uuid; n int := 0; msg text;
begin
  for s in select * from public.crm_report_schedules
            where is_active and next_run_at is not null and next_run_at <= now()
            order by next_run_at
            for update skip locked loop
    begin
      select * into t from public.crm_report_templates where id = s.template_id;
      select * into rng from public.crm_resolve_range(s.range_preset);

      insert into public.crm_report_runs
        (template_id, template_code, report_name, template_version, requested_by, requested_by_name,
         recipients, schedule_id, trigger_kind, format, status, params, date_from, date_to,
         snapshot_date, finished_at)
      values
        (t.id, t.code, s.name, t.version, s.created_by, 'جدولة: ' || s.name, s.recipients, s.id,
         'schedule', s.format, 'delivered',
         jsonb_build_object('preset', s.range_preset, 'compare', s.compare, 'filters', s.filters),
         rng.date_from, rng.date_to,
         (select max(snapshot_date) from public.crm_snapshot_runs where is_current), now())
      returning id into rid;

      insert into public.notifications (user_id, title, body, link, kind, priority, category, entity_type, entity_id)
      select u, s.name,
             format('%s — من %s إلى %s', t.name, rng.date_from, rng.date_to),
             '/dashboard/crm/reports/view?run=' || rid, 'crm_report', 'عادية', 'تقارير', 'crm_report_run', rid
        from unnest(s.recipients) u;

      update public.crm_report_schedules
         set last_run_at = now(), last_status = 'delivered', last_error = null,
             next_run_at = public.crm_schedule_next_run(frequency, run_time, weekday, month_day, now())
       where id = s.id;
      n := n + 1;
    exception when others then
      get stacked diagnostics msg = message_text;
      update public.crm_report_schedules
         set last_run_at = now(), last_status = 'failed', last_error = left(msg, 1000),
             next_run_at = public.crm_schedule_next_run(frequency, run_time, weekday, month_day, now())
       where id = s.id;
      insert into public.notifications (user_id, title, body, link, kind, priority, category)
      select s.created_by, 'فشل إرسال تقرير مجدول: ' || s.name, left(msg, 300),
             '/dashboard/crm/reports/schedules', 'crm_report', 'عالية', 'تقارير'
       where s.created_by is not null;
    end;
  end loop;
  return n;
end $$;

do $$ begin perform cron.unschedule('crm-report-schedules'); exception when others then null; end $$;
select cron.schedule('crm-report-schedules', '*/15 * * * *', $cron$ select public.crm_run_due_report_schedules(); $cron$);

-- ------------------------------------------------------------
-- 4) العروض المحفوظة للتقارير (§19) — نفس جدول 080 لا جدولاً ثانياً
-- ------------------------------------------------------------
alter table public.crm_saved_views drop constraint if exists crm_saved_views_entity_check;
alter table public.crm_saved_views add constraint crm_saved_views_entity_check
  check (entity in ('clients', 'opportunities', 'tasks', 'activities', 'reports'));

-- ------------------------------------------------------------
-- 5) الأمن
-- ------------------------------------------------------------
alter table public.crm_report_templates enable row level security;
drop policy if exists "read report templates" on public.crm_report_templates;
create policy "read report templates" on public.crm_report_templates
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or ((is_system or is_shared) and is_active and (select public.my_role()) = any(audience))
    or (select public.is_admin())
  );

drop policy if exists "write own report templates" on public.crm_report_templates;
create policy "write own report templates" on public.crm_report_templates
  for all to authenticated
  using (not is_system and created_by = (select auth.uid()))
  with check (
    not is_system and created_by = (select auth.uid())
    and (select public.my_role()) in ('admin', 'followup_manager', 'supervisor')
  );

alter table public.crm_report_runs enable row level security;
drop policy if exists "read report runs" on public.crm_report_runs;
create policy "read report runs" on public.crm_report_runs
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or (select auth.uid()) = any(recipients)
    or (select public.is_admin())
  );

alter table public.crm_report_schedules enable row level security;
drop policy if exists "read report schedules" on public.crm_report_schedules;
create policy "read report schedules" on public.crm_report_schedules
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select auth.uid()) = any(recipients)
    or (select public.is_admin()) or (select public.is_followup_manager())
  );
drop policy if exists "write report schedules" on public.crm_report_schedules;
create policy "write report schedules" on public.crm_report_schedules
  for all to authenticated
  using (
    (select public.is_admin()) or (select public.is_followup_manager())
    or (created_by = (select auth.uid()) and (select public.is_supervisor()))
  )
  with check (
    (select public.is_admin()) or (select public.is_followup_manager())
    or (created_by = (select auth.uid()) and (select public.is_supervisor()))
  );

revoke all on public.crm_report_templates, public.crm_report_runs, public.crm_report_schedules from anon;
grant select, insert, update, delete on public.crm_report_templates, public.crm_report_schedules to authenticated;
grant select on public.crm_report_runs to authenticated;
revoke insert, update, delete, truncate on public.crm_report_runs from authenticated;

do $$
declare fn text;
begin
  foreach fn in array array['crm_run_due_report_schedules()', 'crm_report_schedule_before()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
  foreach fn in array array[
    'crm_log_report_run(uuid, text, text, text, jsonb, date, date, int, int, text, text)',
    'crm_resolve_range(text, date)', 'crm_schedule_next_run(text, time, int, int, timestamptz)']
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6) القوالب النظامية (§20 و§81)
--
-- التقرير القديم (/dashboard/crm/reports قبل هذه الهجرة) يبقى كما هو
-- حرفياً في /dashboard/crm/reports/analysis، ويُسجَّل هنا قالباً من
-- نوع «رابط» — فلا يُحذف تقرير ولا يتغيّر رقمٌ فيه.
-- ------------------------------------------------------------
insert into public.crm_report_templates (code, name, description, category, definition, audience, is_system, sort_order)
values
('daily_crm_activity', 'حركة الـCRM اليومية',
 'ما حدث يوماً بيوم: التواصل بأنواعه، والليدات، والمراحل، والحجوزات، والنتائج — ثم من وأين ولماذا.',
 'يومي',
 $j${"default_range":"yesterday","compare":"previous_period","basis":"event","sections":[
   {"key":"summary","title":"ماذا حدث","type":"kpis","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","CALLS","WHATSAPP","MEETINGS","VISITS","OFFERS_SENT","NOTES","STAGE_CHANGES","NEW_LEADS","QUALIFIED_LEADS","NEW_OPPORTUNITIES","RESERVATIONS","WON_DEALS","LOST_DEALS","TASKS_COMPLETED"]},
   {"key":"risk","title":"المتابعة في نهاية المدة","type":"kpis","metrics":["OVERDUE","DUE_TODAY","NO_NEXT_ACTION"],"state":"snapshot"},
   {"key":"trend","title":"يوماً بيوم","type":"trend","metrics":["TOTAL_ACTIVITIES","CALLS","WHATSAPP","VISITS","NEW_LEADS","STAGE_CHANGES","WON_DEALS"],"group_by":["day"]},
   {"key":"by_type","title":"حسب النوع","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","REACH_RATE"],"group_by":["activity_type"],"sort":"-TOTAL_ACTIVITIES"},
   {"key":"by_employee","title":"حسب الموظف","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","CALLS","WHATSAPP","MEETINGS","VISITS","OFFERS_SENT","STAGE_CHANGES"],"group_by":["employee"],"sort":"-TOTAL_ACTIVITIES"},
   {"key":"by_project","title":"حسب المشروع","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","NEW_LEADS","VISITS"],"group_by":["project"],"sort":"-TOTAL_ACTIVITIES"},
   {"key":"by_source","title":"حسب المصدر","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","NEW_LEADS"],"group_by":["source"],"sort":"-TOTAL_ACTIVITIES"},
   {"key":"by_result","title":"حسب النتيجة","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED"],"group_by":["result"],"sort":"-TOTAL_ACTIVITIES"},
   {"key":"insights","title":"ملاحظات","type":"insights"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','employee','viewer'], true, 10),

('daily_sales_performance', 'أداء المبيعات اليومي',
 'لكل موظف: ما استلم، ما عمل، ما أنجز. «تواصل» بجانب «عملاء فريدون» كي لا يتضخّم النشاط.',
 'يومي',
 $j${"default_range":"yesterday","compare":"previous_period","basis":"event","sections":[
   {"key":"summary","title":"الفريق","type":"kpis","metrics":["NEW_LEADS","WORKED_LEADS","UNIQUE_CLIENTS_CONTACTED","TOTAL_ACTIVITIES","QUALIFIED_LEADS","RESERVATIONS","WON_DEALS","LOST_DEALS","CONVERSION_RATE","REVENUE"]},
   {"key":"by_employee","title":"لكل موظف","type":"table","metrics":["NEW_LEADS","WORKED_LEADS","UNIQUE_CLIENTS_CONTACTED","TOTAL_ACTIVITIES","CALLS","WHATSAPP","MEETINGS","VISITS","OFFERS_SENT","QUALIFIED_LEADS","NEW_OPPORTUNITIES","RESERVATIONS","WON_DEALS","LOST_DEALS","CONVERSION_RATE","REVENUE","AVG_DEAL_VALUE","OVERDUE","NO_CONTACT"],"group_by":["employee"],"sort":"-TOTAL_ACTIVITIES","state":"snapshot"},
   {"key":"insights","title":"ملاحظات","type":"insights"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','employee','viewer'], true, 20),

('salesperson_productivity', 'إنتاجية موظف المبيعات',
 'مصفوفة الموظف × اليوم، ثم علاقة النشاط بالنتيجة: تواصل ← عملاء ← تأهيل ← فرصة ← حجز ← بيع.',
 'فريق',
 $j${"default_range":"last_14","compare":"previous_period","basis":"event","sections":[
   {"key":"matrix","title":"التواصل: الموظف × اليوم","type":"matrix","metrics":["TOTAL_ACTIVITIES"],"group_by":["employee","day"]},
   {"key":"productivity","title":"من النشاط إلى النتيجة","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","QUALIFIED_LEADS","VISIT_STAGE_ENTERED","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","OVERDUE"],"group_by":["employee"],"sort":"-TOTAL_ACTIVITIES","state":"snapshot"},
   {"key":"mix","title":"مزيج التواصل","type":"table","metrics":["CALLS","WHATSAPP","VISITS","MEETINGS","REACH_RATE"],"group_by":["employee"],"sort":"-CALLS"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','employee','viewer'], true, 30),

('project_performance', 'أداء المشاريع',
 'لكل مشروع: الطلب، والتحويل، والإيراد، والأنابيب، والنشاط — ومقارنةً بالفترة السابقة.',
 'مشاريع',
 $j${"default_range":"this_month","compare":"previous_period","basis":"event","sections":[
   {"key":"summary","title":"المجموع","type":"kpis","metrics":["NEW_LEADS","QUALIFIED_LEADS","NEW_OPPORTUNITIES","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","REVENUE","TOTAL_ACTIVITIES","VISITS","CONVERSION_RATE","AVG_SALES_CYCLE"]},
   {"key":"pipeline","title":"الأنابيب في نهاية المدة","type":"kpis","metrics":["OPEN_OPPORTUNITIES","PIPELINE_VALUE","WEIGHTED_PIPELINE","OVERDUE"],"state":"snapshot"},
   {"key":"trend","title":"يوماً بيوم","type":"trend","metrics":["NEW_LEADS","TOTAL_ACTIVITIES","VISITS","QUALIFIED_LEADS","RESERVATIONS","WON_DEALS"],"group_by":["day"]},
   {"key":"by_project","title":"لكل مشروع","type":"table","metrics":["NEW_LEADS","QUALIFIED_LEADS","NEW_OPPORTUNITIES","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","REVENUE","TOTAL_ACTIVITIES","VISITS","CALLS","WHATSAPP","CONVERSION_RATE","AVG_SALES_CYCLE","OPEN_OPPORTUNITIES","PIPELINE_VALUE","WEIGHTED_PIPELINE","OVERDUE"],"group_by":["project"],"sort":"-NEW_LEADS","state":"snapshot"},
   {"key":"insights","title":"ملاحظات","type":"insights"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','viewer','marketing'], true, 40),

('marketing_source', 'المصادر والحملات',
 'المصدر حتى البيع لا حتى الليد. الافتراضي «حسب تاريخ إنشاء الليد»: ليدات المدة، وإلى أين وصلت.',
 'تسويق',
 $j${"default_range":"last_30","compare":"previous_period","basis":"lead_created","sections":[
   {"key":"summary","title":"المجموع","type":"kpis","metrics":["NEW_LEADS","WORKED_LEADS","QUALIFIED_LEADS","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","CONVERSION_RATE","REVENUE"]},
   {"key":"by_source","title":"لكل مصدر","type":"table","metrics":["NEW_LEADS","WORKED_LEADS","UNIQUE_CLIENTS_CONTACTED","QUALIFIED_LEADS","NEW_OPPORTUNITIES","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","LOST_DEALS","CONVERSION_RATE","REVENUE"],"group_by":["source"],"sort":"-NEW_LEADS"},
   {"key":"by_campaign","title":"لكل حملة","type":"table","metrics":["NEW_LEADS","QUALIFIED_LEADS","WON_DEALS","REVENUE"],"group_by":["campaign"],"sort":"-NEW_LEADS"},
   {"key":"campaign_costs","title":"الكلفة والعائد","type":"campaign_costs"},
   {"key":"insights","title":"ملاحظات","type":"insights"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','marketing','viewer'], true, 50),

('followup_report', 'المتابعة والصمت',
 'ما يستحق اليوم، وما تأخّر، وما لا خطوة له، ومن صمت كم يوماً — بالموظف والمشروع والمصدر والمرحلة.',
 'متابعة',
 $j${"default_range":"yesterday","compare":"previous_period","basis":"event","sections":[
   {"key":"summary","title":"في نهاية المدة","type":"kpis","metrics":["DUE_TODAY","OVERDUE","NO_NEXT_ACTION","NO_CONTACT","NEGLECTED","DORMANT","SLA_BREACH_OPEN","UNASSIGNED"],"state":"snapshot"},
   {"key":"done","title":"ما أُنجز في المدة","type":"kpis","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","TASKS_COMPLETED"]},
   {"key":"trend","title":"المتأخّر يوماً بيوم","type":"trend","metrics":["OVERDUE","NO_NEXT_ACTION","NEGLECTED","DORMANT"],"group_by":["day"],"state":"snapshot"},
   {"key":"silence_employee","title":"الصمت × الموظف","type":"matrix","metrics":["OPEN_LEADS"],"group_by":["employee","silence_bucket"],"state":"snapshot"},
   {"key":"silence_project","title":"الصمت × المشروع","type":"matrix","metrics":["OPEN_LEADS"],"group_by":["project","silence_bucket"],"state":"snapshot"},
   {"key":"silence_source","title":"الصمت × المصدر","type":"matrix","metrics":["OPEN_LEADS"],"group_by":["source","silence_bucket"],"state":"snapshot"},
   {"key":"silence_stage","title":"الصمت × المرحلة","type":"matrix","metrics":["OPEN_LEADS"],"group_by":["stage","silence_bucket"],"state":"snapshot"},
   {"key":"by_employee","title":"لكل موظف","type":"table","metrics":["DUE_TODAY","OVERDUE","NO_NEXT_ACTION","NO_CONTACT","NEGLECTED","DORMANT","SLA_BREACH_OPEN"],"group_by":["employee"],"sort":"-OVERDUE","state":"snapshot"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','employee','viewer'], true, 60),

('pipeline_snapshot', 'الأنابيب يوماً بيوم',
 'حالة خطّ الأنابيب كما كانت في نهاية كل يوم — من اللقطات لا من الحالة الراهنة.',
 'أنابيب',
 $j${"default_range":"last_30","compare":"previous_period","basis":"event","sections":[
   {"key":"closing","title":"في نهاية المدة","type":"kpis","metrics":["OPEN_LEADS","QUALIFIED_NOW","OPEN_OPPORTUNITIES","AT_LEAD","AT_CONTACTED","AT_VISIT","AT_OFFER","ACTIVE_RESERVATIONS","WON_TOTAL","LOST_TOTAL","PIPELINE_VALUE","WEIGHTED_PIPELINE"],"state":"snapshot"},
   {"key":"trend","title":"يوماً بيوم","type":"trend","metrics":["OPEN_OPPORTUNITIES","AT_CONTACTED","AT_VISIT","AT_OFFER","ACTIVE_RESERVATIONS","WON_TOTAL"],"group_by":["day"],"state":"snapshot"},
   {"key":"by_stage","title":"حسب المرحلة","type":"table","metrics":["OPEN_OPPORTUNITIES","PIPELINE_VALUE","WEIGHTED_PIPELINE"],"group_by":["stage"],"state":"snapshot"},
   {"key":"by_owner","title":"حسب المالك","type":"table","metrics":["OPEN_OPPORTUNITIES","AT_VISIT","AT_OFFER","PIPELINE_VALUE","WEIGHTED_PIPELINE"],"group_by":["employee"],"sort":"-OPEN_OPPORTUNITIES","state":"snapshot"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','viewer'], true, 70),

('pipeline_movement', 'حركة الأنابيب',
 'ما كان في البداية، وما دخل، وما تقدّم وتراجع، وما رُبح وخُسر، وما بقي في النهاية.',
 'أنابيب',
 $j${"default_range":"this_month","compare":"previous_period","basis":"event","sections":[
   {"key":"movement","title":"الحركة","type":"movement"},
   {"key":"flow","title":"التدفّق يوماً بيوم","type":"trend","metrics":["NEW_OPPORTUNITIES","STAGE_PROGRESSIONS","STAGE_REGRESSIONS","WON_DEALS","LOST_DEALS","REACTIVATED"],"group_by":["day"]},
   {"key":"new_vs_existing","title":"جديد ومعاد ومُعاد فتحه","type":"kpis","metrics":["NEW_LEADS","RETURNED_LEADS","REACTIVATED","REASSIGNMENTS"]}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','viewer'], true, 80),

('funnel_by_period', 'القمع حسب الفترة',
 'ليدات المدة وإلى أين وصلت: العدد، ونسبة التحويل من الخطوة السابقة، والتسرّب.',
 'أنابيب',
 $j${"default_range":"this_month","compare":"previous_period","basis":"lead_created","sections":[
   {"key":"funnel","title":"القمع","type":"funnel","metrics":["NEW_LEADS","UNIQUE_CLIENTS_CONTACTED","QUALIFIED_LEADS","VISIT_STAGE_ENTERED","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS"]},
   {"key":"by_source","title":"القمع لكل مصدر","type":"table","metrics":["NEW_LEADS","UNIQUE_CLIENTS_CONTACTED","QUALIFIED_LEADS","VISIT_STAGE_ENTERED","OFFER_STAGE_ENTERED","RESERVATIONS","WON_DEALS","CONVERSION_RATE"],"group_by":["source"],"sort":"-NEW_LEADS"}
 ]}$j$::jsonb,
 array['admin','followup_manager','supervisor','viewer','marketing'], true, 90),

('executive_report', 'التقرير التنفيذي',
 'الأعمال، والليدات، والنشاط، والمخاطر، والاتجاه — في صفحة واحدة للإدارة.',
 'إدارة',
 $j${"default_range":"last_7","compare":"previous_period","basis":"event","sections":[
   {"key":"business","title":"الأعمال","type":"kpis","metrics":["WON_DEALS","REVENUE","RESERVATIONS","SALES_COMPLETED","CONVERSION_RATE"]},
   {"key":"pipeline","title":"الأنابيب","type":"kpis","metrics":["OPEN_OPPORTUNITIES","PIPELINE_VALUE","WEIGHTED_PIPELINE","AT_OFFER"],"state":"snapshot"},
   {"key":"leads","title":"الليدات","type":"kpis","metrics":["NEW_LEADS","WORKED_LEADS","QUALIFIED_LEADS","NEW_OPPORTUNITIES"]},
   {"key":"activity","title":"النشاط","type":"kpis","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","CALLS","WHATSAPP","VISITS","MEETINGS"]},
   {"key":"risk","title":"المخاطر","type":"kpis","metrics":["OVERDUE","DORMANT","SLA_BREACH_OPEN","UNASSIGNED","NO_NEXT_ACTION"],"state":"snapshot"},
   {"key":"trend","title":"الاتجاه","type":"trend","metrics":["NEW_LEADS","TOTAL_ACTIVITIES","WON_DEALS","OVERDUE"],"group_by":["day"]},
   {"key":"by_employee","title":"الفريق","type":"table","metrics":["TOTAL_ACTIVITIES","UNIQUE_CLIENTS_CONTACTED","WON_DEALS","REVENUE","OVERDUE"],"group_by":["employee"],"sort":"-TOTAL_ACTIVITIES","state":"snapshot"},
   {"key":"by_project","title":"المشاريع","type":"table","metrics":["NEW_LEADS","TOTAL_ACTIVITIES","RESERVATIONS","WON_DEALS","REVENUE"],"group_by":["project"],"sort":"-NEW_LEADS"},
   {"key":"by_source","title":"المصادر","type":"table","metrics":["NEW_LEADS","QUALIFIED_LEADS","WON_DEALS"],"group_by":["source"],"sort":"-NEW_LEADS"},
   {"key":"insights","title":"ملاحظات","type":"insights"}
 ]}$j$::jsonb,
 array['admin','followup_manager','viewer'], true, 100),

('revenue_report', 'الإيراد والحجوزات',
 'للمالية: الصفقات الفائزة وعمولتها، والحجوزات ومبالغها، والبيع المكتمل — بالشهر والمشروع.',
 'مالية',
 $j${"default_range":"this_quarter","compare":"previous_period","basis":"event","sections":[
   {"key":"summary","title":"المجموع","type":"kpis","metrics":["WON_DEALS","REVENUE","AVG_DEAL_VALUE","RESERVATIONS","RESERVATION_VALUE","SALES_COMPLETED","SALES_VALUE","RESERVATIONS_CANCELLED"]},
   {"key":"by_month","title":"بالشهر","type":"table","metrics":["WON_DEALS","REVENUE","RESERVATIONS","RESERVATION_VALUE","SALES_COMPLETED","SALES_VALUE"],"group_by":["month"]},
   {"key":"by_project","title":"بالمشروع","type":"table","metrics":["WON_DEALS","REVENUE","RESERVATIONS","SALES_COMPLETED","SALES_VALUE"],"group_by":["project"],"sort":"-REVENUE"}
 ]}$j$::jsonb,
 array['admin','followup_manager','accountant','viewer'], true, 110),

('legacy_sales_analysis', 'تحليل المبيعات (التقرير السابق)',
 'التقرير الذي كان في «التقارير» قبل المحرّك — كما هو: القمع، والزمن في المراحل، وسرعة المبيعات، ولماذا نخسر، ومستوى الخدمة.',
 'مرجعي',
 $j${"link":"/dashboard/crm/reports/analysis","sections":[]}$j$::jsonb,
 array['admin','followup_manager','supervisor','marketing','viewer'], true, 900),

('forecast', 'التنبؤ والأهداف',
 'الإقفال المتوقّع مقابل الهدف (078) — في شاشته.',
 'مرجعي',
 $j${"link":"/dashboard/crm/forecast","sections":[]}$j$::jsonb,
 array['admin','followup_manager','supervisor','viewer'], true, 910)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  definition = excluded.definition, audience = excluded.audience, sort_order = excluded.sort_order,
  is_system = true, is_active = true;

-- ------------------------------------------------------------
-- 7) التحقّق
-- ------------------------------------------------------------
do $$
declare t record; s jsonb; bad int := 0; m text;
begin
  raise notice '--- 099 القوالب والتشغيل والجدولة ---';
  -- كل مقياس في كل قالب موجود في السجلّ — قالبٌ يشير إلى مقياس محذوف يُكتشف هنا
  for t in select * from public.crm_report_templates where is_system loop
    for s in select * from jsonb_array_elements(t.definition -> 'sections') loop
      for m in select jsonb_array_elements_text(coalesce(s -> 'metrics', '[]'::jsonb)) loop
        if not exists (select 1 from public.crm_metrics where code = m) then
          raise warning 'القالب % يشير إلى مقياس غير موجود: %', t.code, m;
          bad := bad + 1;
        end if;
      end loop;
    end loop;
  end loop;
  raise notice 'قوالب نظامية: % · مراجع مقاييس مكسورة: %',
    (select count(*) from public.crm_report_templates where is_system), bad;
  raise notice 'أمس = %', (select to_jsonb(r) from public.crm_resolve_range('yesterday') r);
  raise notice 'الشهر الماضي = %', (select to_jsonb(r) from public.crm_resolve_range('last_month') r);
end $$;

notify pgrst, 'reload schema';
