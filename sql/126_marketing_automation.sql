-- ============================================================
-- تلال ERP — 126: التسويق ٥ — الأتمتة والتنبيهات والتكاملات وسجلّ المساعد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== الأتمتة =====
--
-- قواعد بأنواعٍ مغلقة لا نصّ SQL يُكتب في شاشة: كل نوعٍ شرطٌ مكتوب
-- هنا ومعاملاته (النسبة، الأيام) في params. والتنبيه يُكتب **مرّة**
-- بمفتاح عدم تكرار — حملةٌ تجاوزت ميزانيتها تُنبِّه حين تتجاوز، لا كل
-- صباح حتى تُغلق (درس 075: ٢١٢ إشعاراً في اليوم الأول تقتل المصداقية).
--
--   المهمة المجدولة mkt-automation-scan — ٧:٠٠ بغداد، يومياً.
--   وكل تشغيل صفٌّ في mkt_automation_runs: بدأ، اكتمل، فشل، كم أطلق.
--   وفشل قاعدةٍ لا يُسقط البقيّة — يُسجَّل في التشغيل ويُكمَل.
--
-- ===== التكاملات =====
--
-- السرّ لا يمرّ بجدول يُقرأ: يُحفظ في Supabase Vault (مثبّت)، والجدول
-- يحمل معرّفه في جدولٍ بلا سياسة قراءة لأحد. ولا تقرؤه إلا دالّة
-- مسموحة لـ service_role — أي دالّة الحافة marketing-sync وحدها.
-- والسجلّ يحفظ ما حدث (بدأ، اكتمل، فشل، المحاولة، عدد الصفوف) لا
-- الحمولة ولا المفتاح.
--
-- يتطلب: 121، 122، 124، 125، pg_cron، supabase_vault. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) القواعد والتنبيهات والتشغيلات
-- ------------------------------------------------------------
create table if not exists public.mkt_automation_rules (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  trigger_kind text not null check (trigger_kind in (
                 'عتبة الميزانية', 'تجاوز ميزانية الحملة', 'ارتفاع كلفة الليد', 'بلوغ هدف الليدات',
                 'تأخّر الموافقة', 'تأخّر تسليم المؤثر', 'انتهاء نشاط ميداني', 'انتهاء الحملة',
                 'ليد بلا متابعة', 'فشل المزامنة', 'تأخّر المحتوى')),
  params       jsonb not null default '{}'::jsonb,
  notify       text[] not null default array['مدير التسويق'],
  severity     text not null default 'عالية' check (severity in ('حرجة', 'عالية', 'عادية', 'منخفضة')),
  is_active    boolean not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);

insert into public.mkt_automation_rules (code, name, trigger_kind, params, notify, severity) values
  ('budget_threshold', 'الميزانية بلغت ٨٠٪ / ٩٠٪ / ١٠٠٪', 'عتبة الميزانية', '{}', array['مدير التسويق'], 'عالية'),
  ('campaign_overspend', 'الحملة تجاوزت ميزانيتها بـ١٠٪', 'تجاوز ميزانية الحملة', '{"pct": 10}', array['مدير التسويق', 'المدير'], 'حرجة'),
  ('cpl_spike', 'كلفة الليد ارتفعت ٣٠٪ عن الأسبوع السابق', 'ارتفاع كلفة الليد', '{"pct": 30, "days": 7, "min_leads": 3}', array['مشتري إعلانات', 'مدير التسويق'], 'عالية'),
  ('lead_target_reached', 'الحملة بلغت هدف الليدات', 'بلوغ هدف الليدات', '{}', array['مدير التسويق', 'المسؤول'], 'عادية'),
  ('approval_overdue', 'طلب موافقة معلّق أكثر من يومين', 'تأخّر الموافقة', '{"days": 2}', array['مدير التسويق'], 'عالية'),
  ('influencer_late', 'تسليم مؤثر تأخّر عن موعده', 'تأخّر تسليم المؤثر', '{}', array['مدير التسويق'], 'عالية'),
  ('offline_expiring', 'نشاط ميداني ينتهي خلال ٧ أيام', 'انتهاء نشاط ميداني', '{"days": 7}', array['المسؤول', 'منسّق فعاليات'], 'عادية'),
  ('campaign_ended', 'حملة انتهى تاريخها — أغلقها واكتب تقرير أدائها', 'انتهاء الحملة', '{}', array['المسؤول', 'مدير التسويق'], 'عالية'),
  ('lead_no_followup', 'ليدات تسويقية بلا أي تواصل بعد يومين', 'ليد بلا متابعة', '{"days": 2}', array['مدير المتابعة', 'مدير التسويق'], 'عالية'),
  ('sync_failure', 'تكامل فشلت مزامنته', 'فشل المزامنة', '{}', array['مدير التسويق'], 'حرجة'),
  ('content_late', 'محتوى تجاوز موعده ولم يُعتمد', 'تأخّر المحتوى', '{}', array['المسؤول'], 'عادية')
on conflict (code) do nothing;

create table if not exists public.mkt_alerts (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid references public.mkt_automation_rules(id) on delete set null,
  rule_code   text,
  entity_type text,
  entity_id   uuid,
  dedupe_key  text not null unique,
  severity    text not null,
  title       text not null,
  body        text,
  link        text,
  notified    int not null default 0,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index if not exists mkt_alerts_open_idx on public.mkt_alerts (created_at desc) where resolved_at is null;

create table if not exists public.mkt_automation_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'بدأ' check (status in ('بدأ', 'اكتمل', 'اكتمل بأخطاء', 'فشل')),
  trigger     text not null default 'مجدول' check (trigger in ('مجدول', 'يدوي')),
  fired       int not null default 0,
  errors      jsonb not null default '[]'::jsonb
);


-- ------------------------------------------------------------
-- 2) المحرّك
-- ------------------------------------------------------------
-- يُطلق التنبيه مرّة بمفتاحه، ويُشعر المستلمين بالدور + صاحب الكيان
create or replace function public.mkt_fire_alert(
  r public.mkt_automation_rules, p_entity_type text, p_entity uuid, p_key text,
  p_title text, p_body text, p_link text, p_owner uuid default null, p_extra_roles text[] default '{}'
) returns int language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; n int := 0;
begin
  insert into public.mkt_alerts (rule_id, rule_code, entity_type, entity_id, dedupe_key, severity, title, body, link)
  values (r.id, r.code, p_entity_type, p_entity, p_key, r.severity, p_title, p_body, p_link)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return 0; end if;

  n := public.mkt_notify(r.notify || p_extra_roles, p_owner, p_title, p_body, p_link, p_entity, r.severity);
  update public.mkt_alerts set notified = n where id = v_id;
  return 1;
end;
$fn$;

revoke all on function public.mkt_fire_alert(public.mkt_automation_rules, text, uuid, text, text, text, text, uuid, text[])
  from public, anon, authenticated;

create or replace function public.mkt_run_automation(p_trigger text default 'مجدول')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r public.mkt_automation_rules%rowtype; x record;
  v_run bigint; v_fired int := 0; v_errs jsonb := '[]'::jsonb;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_days int; v_pct numeric; v_min int;
begin
  -- المهمة المجدولة تعمل بلا مستخدم؛ اليدوي لمدير التسويق
  if auth.uid() is not null and not public.is_marketing_manager() then
    raise exception 'تشغيل الأتمتة يدوياً لمدير التسويق';
  end if;

  insert into public.mkt_automation_runs (trigger) values (p_trigger) returning id into v_run;

  for r in select * from public.mkt_automation_rules where is_active order by code loop
    begin
      v_days := coalesce((r.params->>'days')::int, 7);
      v_pct  := coalesce((r.params->>'pct')::numeric, 10);
      v_min  := coalesce((r.params->>'min_leads')::int, 3);

      if r.trigger_kind = 'عتبة الميزانية' then
        for x in select * from public.mkt_budget_status(v_today, v_today) b
                  where b.status = 'معتمدة' and b.alert_level is not null loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'ميزانية', x.budget_id,
            'budget:' || x.budget_id || ':' || x.alert_level,
            'الميزانية ' || x.alert_level || ': ' || x.name,
            x.scope_label || ' — مصروف وملتزم ' || public.fmt_qty(x.spent + x.committed) ||
              ' من ' || public.fmt_qty(coalesce(x.approved, x.planned)) || ' (' || x.utilization_pct || '٪)',
            '/dashboard/marketing/budget');
        end loop;

      elsif r.trigger_kind = 'تجاوز ميزانية الحملة' then
        for x in select c.id, c.name, c.budget, c.spent, c.owner_employee_id
                   from public.crm_campaigns c
                  where c.is_active and coalesce(c.budget, 0) > 0
                    and coalesce(c.spent, 0) > c.budget * (1 + v_pct / 100) loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'حملة', x.id, 'camp-over:' || x.id,
            'تجاوزت ميزانيتها: ' || x.name,
            'المصروف ' || public.fmt_qty(x.spent) || ' مقابل ميزانية ' || public.fmt_qty(x.budget),
            '/dashboard/marketing/campaigns/' || x.id, x.owner_employee_id);
        end loop;

      elsif r.trigger_kind = 'ارتفاع كلفة الليد' then
        for x in
          with cur as (
            select f.campaign_id, sum(f.amount) as cost from public.mkt_cost_facts(v_today - v_days + 1, v_today) f
             where f.campaign_id is not null group by 1),
          prev as (
            select f.campaign_id, sum(f.amount) as cost from public.mkt_cost_facts(v_today - 2 * v_days + 1, v_today - v_days) f
             where f.campaign_id is not null group by 1),
          lc as (
            select f.campaign_id, count(*) as n from public.mkt_lead_facts(v_today - v_days + 1, v_today) f
             where f.campaign_id is not null group by 1),
          lp as (
            select f.campaign_id, count(*) as n from public.mkt_lead_facts(v_today - 2 * v_days + 1, v_today - v_days) f
             where f.campaign_id is not null group by 1)
          select c.id, c.name, c.owner_employee_id,
                 cur.cost / lc.n as cpl_now, prev.cost / lp.n as cpl_before
            from public.crm_campaigns c
            join cur on cur.campaign_id = c.id join prev on prev.campaign_id = c.id
            join lc on lc.campaign_id = c.id join lp on lp.campaign_id = c.id
           where c.is_active and lc.n >= v_min and lp.n >= v_min
             and cur.cost / lc.n > (prev.cost / lp.n) * (1 + v_pct / 100)
        loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'حملة', x.id,
            'cpl:' || x.id || ':' || to_char(v_today, 'IYYY-IW'),
            'كلفة الليد ارتفعت: ' || x.name,
            public.fmt_qty(round(x.cpl_before)) || ' ← ' || public.fmt_qty(round(x.cpl_now)) ||
              ' د.ع (آخر ' || v_days || ' أيام مقابل ما قبلها)',
            '/dashboard/marketing/campaigns/' || x.id, x.owner_employee_id);
        end loop;

      elsif r.trigger_kind = 'بلوغ هدف الليدات' then
        for x in
          select c.id, c.name, c.expected_leads, c.owner_employee_id, count(f.client_id) as n
            from public.crm_campaigns c
            join public.mkt_lead_facts(null, v_today) f on f.campaign_id = c.id
           where c.is_active and coalesce(c.expected_leads, 0) > 0
             and f.created_on >= coalesce(c.start_date, f.created_on)
           group by c.id, c.name, c.expected_leads, c.owner_employee_id
          having count(f.client_id) >= c.expected_leads
        loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'حملة', x.id, 'target:' || x.id,
            'بلغت هدف الليدات: ' || x.name, x.n || ' ليداً من هدف ' || x.expected_leads,
            '/dashboard/marketing/campaigns/' || x.id, x.owner_employee_id);
        end loop;

      elsif r.trigger_kind = 'تأخّر الموافقة' then
        for x in select a.* from public.mkt_approvals a
                  where a.status = 'معلّق' and a.requested_at < now() - make_interval(days => v_days) loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'موافقة', x.id, 'appr:' || x.id,
            'موافقة معلّقة منذ ' || (v_today - (x.requested_at at time zone 'Asia/Baghdad')::date) || ' أيام',
            x.entity_type || ': ' || x.title || ' — يعتمدها ' || x.approver,
            '/dashboard/marketing/approvals', null,
            case x.approver when 'المدير' then array['المدير'] when 'المالية' then array['المالية'] else '{}'::text[] end);
        end loop;

      elsif r.trigger_kind = 'تأخّر تسليم المؤثر' then
        for x in select d.id, d.due_date, i.name, cp.owner_employee_id
                   from public.mkt_influencer_deals d
                   join public.mkt_influencers i on i.id = d.influencer_id
                   left join public.crm_campaigns cp on cp.id = d.campaign_id
                  where d.due_date < v_today
                    and d.stage in ('معتمد', 'عقد', 'محتوى') loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'مؤثر', x.id, 'inf:' || x.id || ':' || x.due_date,
            'تأخّر تسليم المؤثر: ' || x.name, 'الموعد كان ' || x.due_date,
            '/dashboard/marketing/influencers', x.owner_employee_id);
        end loop;

      elsif r.trigger_kind = 'انتهاء نشاط ميداني' then
        for x in select a.id, a.title, a.end_date, a.responsible_employee_id
                   from public.mkt_activities a
                  where a.end_date between v_today and v_today + v_days
                    and a.status in ('معتمد', 'قيد التنفيذ', 'نشط') loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'نشاط', x.id, 'act-exp:' || x.id || ':' || x.end_date,
            'ينتهي قريباً: ' || x.title, 'ينتهي في ' || x.end_date || ' — جدّد أو أزِل',
            '/dashboard/marketing/offline/' || x.id, x.responsible_employee_id);
        end loop;

      elsif r.trigger_kind = 'انتهاء الحملة' then
        for x in select c.id, c.name, c.end_date, c.owner_employee_id from public.crm_campaigns c
                  where c.status = 'نشطة' and c.end_date < v_today loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'حملة', x.id, 'camp-end:' || x.id || ':' || x.end_date,
            'انتهت الحملة: ' || x.name, 'انتهت في ' || x.end_date || ' — أغلقها واكتب تقرير أدائها',
            '/dashboard/marketing/campaigns/' || x.id, x.owner_employee_id);
        end loop;

      elsif r.trigger_kind = 'ليد بلا متابعة' then
        -- تنبيهٌ واحد في اليوم بالعدد — لا تنبيهٌ لكل ليد
        select count(*) as n into x
          from public.clients c
         where c.deleted_at is null and c.merged_into is null
           and c.created_at < now() - make_interval(days => v_days)
           and c.created_at > now() - interval '30 days'
           and coalesce(c.contact_count, 0) = 0
           and public.is_open_stage(c.stage)
           and (c.campaign_id is not null or exists (select 1 from public.mkt_touchpoints t where t.client_id = c.id));
        if x.n > 0 then
          v_fired := v_fired + public.mkt_fire_alert(r, 'ليدات', null, 'leads-nofollow:' || v_today,
            x.n || ' ليداً تسويقياً بلا أي تواصل',
            'دخلوا من حملات وقنوات التسويق قبل أكثر من ' || v_days || ' أيام ولم يُتصل بهم — المصروف يضيع هنا',
            '/dashboard/crm/distribution');
        end if;

      elsif r.trigger_kind = 'فشل المزامنة' then
        for x in select i.id, i.name, i.provider, i.last_error from public.mkt_integrations i
                  where i.is_active and (i.status = 'خطأ'
                     or (i.sync_frequency <> 'يدوي' and i.last_success_at is not null
                         and i.last_success_at < now() - case i.sync_frequency when 'كل ساعة' then interval '3 hours'
                                                                                else interval '2 days' end)) loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'تكامل', x.id, 'sync:' || x.id || ':' || v_today,
            'المزامنة متعطّلة: ' || x.name, coalesce(x.last_error, 'لم تنجح المزامنة منذ مدّة'),
            '/dashboard/marketing/integrations');
        end loop;

      elsif r.trigger_kind = 'تأخّر المحتوى' then
        for x in select c.id, c.title, c.due_date, c.owner_id from public.mkt_content c
                  where c.due_date < v_today
                    and c.status in ('فكرة', 'مسودة', 'كتابة', 'تصميم', 'مونتاج', 'بانتظار الموافقة') loop
          v_fired := v_fired + public.mkt_fire_alert(r, 'محتوى', x.id, 'content-late:' || x.id || ':' || x.due_date,
            'محتوى متأخّر: ' || x.title, 'موعده كان ' || x.due_date,
            '/dashboard/marketing/content/' || x.id, x.owner_id);
        end loop;
      end if;

      update public.mkt_automation_rules set last_run_at = now() where id = r.id;
    exception when others then
      v_errs := v_errs || jsonb_build_object('rule', r.code, 'error', sqlerrm);
    end;
  end loop;

  update public.mkt_automation_runs
     set finished_at = now(), fired = v_fired, errors = v_errs,
         status = case when jsonb_array_length(v_errs) = 0 then 'اكتمل' else 'اكتمل بأخطاء' end
   where id = v_run;

  return jsonb_build_object('run', v_run, 'fired', v_fired, 'errors', v_errs);
end;
$fn$;

create or replace function public.mkt_resolve_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_write_marketing() then raise exception 'لفريق التسويق'; end if;
  update public.mkt_alerts set resolved_at = now(), resolved_by = auth.uid()
   where id = p_id and resolved_at is null;
end;
$fn$;

revoke all on function public.mkt_run_automation(text) from public, anon;
revoke all on function public.mkt_resolve_alert(uuid)  from public, anon;
grant execute on function public.mkt_run_automation(text) to authenticated;
grant execute on function public.mkt_resolve_alert(uuid)  to authenticated;


-- ------------------------------------------------------------
-- 3) التكاملات
-- ------------------------------------------------------------
create table if not exists public.mkt_integrations (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null check (provider in (
                         'meta', 'google_ads', 'tiktok', 'linkedin', 'youtube', 'google_analytics',
                         'gtm', 'whatsapp', 'email', 'sms')),
  name                 text not null,
  account_ref          text,
  account_id           uuid references public.mkt_accounts(id) on delete set null,
  auth_type            text not null default 'token' check (auth_type in ('oauth', 'api_key', 'token')),
  status               text not null default 'غير متصل' check (status in ('غير متصل', 'متصل', 'خطأ', 'موقوف')),
  sync_frequency       text not null default 'يومي' check (sync_frequency in ('يدوي', 'كل ساعة', 'يومي')),
  mapping              jsonb not null default '{}'::jsonb,
  last_sync_at         timestamptz,
  last_success_at      timestamptz,
  last_error           text,
  consecutive_failures int not null default 0,
  is_active            boolean not null default true,
  created_by           uuid references auth.users(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now()
);
create unique index if not exists mkt_integrations_one_active
  on public.mkt_integrations (provider, coalesce(account_ref, '')) where is_active;

-- معرّف السرّ في Vault — جدولٌ بلا سياسة: لا يقرؤه مستخدمٌ بحال
create table if not exists public.mkt_integration_secrets (
  integration_id  uuid primary key references public.mkt_integrations(id) on delete cascade,
  vault_secret_id uuid not null,
  set_at          timestamptz not null default now(),
  set_by          uuid references auth.users(id) on delete set null
);
alter table public.mkt_integration_secrets enable row level security;

create table if not exists public.mkt_sync_logs (
  id             bigint generated always as identity primary key,
  integration_id uuid not null references public.mkt_integrations(id) on delete cascade,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'بدأ' check (status in ('بدأ', 'اكتمل', 'فشل', 'إعادة محاولة')),
  trigger        text not null default 'يدوي' check (trigger in ('يدوي', 'مجدول')),
  attempt        int not null default 1,
  rows_in        int,
  error          text,
  meta           jsonb
);
create index if not exists mkt_sync_logs_integration_idx on public.mkt_sync_logs (integration_id, started_at desc);

create or replace function public.mkt_set_integration_secret(p_integration uuid, p_secret text)
returns void language plpgsql security definer set search_path = public, vault as $fn$
declare v_sid uuid;
begin
  if not public.is_marketing_manager() then raise exception 'مفاتيح التكامل لمدير التسويق'; end if;
  if coalesce(length(btrim(p_secret)), 0) < 8 then raise exception 'المفتاح قصير'; end if;
  if not exists (select 1 from public.mkt_integrations where id = p_integration) then
    raise exception 'التكامل غير موجود';
  end if;

  select vault_secret_id into v_sid from public.mkt_integration_secrets where integration_id = p_integration;
  if v_sid is null then
    v_sid := vault.create_secret(btrim(p_secret), 'mkt_integration_' || p_integration,
                                 'مفتاح تكامل تسويقي — لا يُقرأ إلا من دالّة الحافة');
    insert into public.mkt_integration_secrets (integration_id, vault_secret_id, set_by)
    values (p_integration, v_sid, auth.uid());
  else
    perform vault.update_secret(v_sid, btrim(p_secret));
    update public.mkt_integration_secrets set set_at = now(), set_by = auth.uid()
     where integration_id = p_integration;
  end if;

  update public.mkt_integrations
     set status = 'غير متصل', last_error = null, consecutive_failures = 0
   where id = p_integration;
end;
$fn$;

-- لدالّة الحافة وحدها (service_role)
create or replace function public.mkt_integration_secret(p_integration uuid)
returns text language plpgsql security definer set search_path = public, vault as $fn$
declare v text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'غير مسموح';
  end if;
  select ds.decrypted_secret into v
    from public.mkt_integration_secrets s
    join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
   where s.integration_id = p_integration;
  return v;
end;
$fn$;

create or replace function public.mkt_has_integration_secret(p_integration uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_marketing()
     and exists (select 1 from public.mkt_integration_secrets where integration_id = p_integration);
$$;

-- بداية المزامنة ونهايتها — السجلّ والتكامل يُحدَّثان معاً
create or replace function public.mkt_sync_begin(p_integration uuid, p_trigger text default 'يدوي', p_attempt int default 1)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v bigint;
begin
  if not (public.can_write_marketing() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'لفريق التسويق';
  end if;
  insert into public.mkt_sync_logs (integration_id, trigger, attempt,
                                    status)
  values (p_integration, p_trigger, p_attempt, case when p_attempt > 1 then 'إعادة محاولة' else 'بدأ' end)
  returning id into v;
  update public.mkt_integrations set last_sync_at = now() where id = p_integration;
  return v;
end;
$fn$;

create or replace function public.mkt_sync_finish(
  p_log bigint, p_ok boolean, p_rows int default null, p_error text default null, p_meta jsonb default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_int uuid; v_fail int;
begin
  if not (public.can_write_marketing() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'لفريق التسويق';
  end if;
  update public.mkt_sync_logs
     set finished_at = now(), status = case when p_ok then 'اكتمل' else 'فشل' end,
         rows_in = p_rows, error = left(p_error, 2000),
         meta = case when jsonb_typeof(p_meta) = 'object' then p_meta - 'access_token' - 'token' - 'secret' end
   where id = p_log
  returning integration_id into v_int;

  if p_ok then
    update public.mkt_integrations
       set status = 'متصل', last_success_at = now(), last_error = null, consecutive_failures = 0
     where id = v_int;
  else
    update public.mkt_integrations
       set status = 'خطأ', last_error = left(p_error, 500), consecutive_failures = consecutive_failures + 1
     where id = v_int
    returning consecutive_failures into v_fail;
    -- الفشل الأول يُعلَن فوراً؛ ما بعده تجمعه قاعدة «فشل المزامنة» يومياً
    if v_fail = 1 then
      perform public.mkt_notify(array['مدير التسويق'], null, 'فشلت مزامنة تكامل تسويقي',
        left(coalesce(p_error, ''), 200), '/dashboard/marketing/integrations', v_int, 'عالية');
    end if;
  end if;
end;
$fn$;

revoke all on function public.mkt_set_integration_secret(uuid, text) from public, anon;
revoke all on function public.mkt_integration_secret(uuid) from public, anon, authenticated;
revoke all on function public.mkt_has_integration_secret(uuid) from public, anon;
revoke all on function public.mkt_sync_begin(uuid, text, int) from public, anon;
revoke all on function public.mkt_sync_finish(bigint, boolean, int, text, jsonb) from public, anon;
grant execute on function public.mkt_set_integration_secret(uuid, text) to authenticated;
grant execute on function public.mkt_integration_secret(uuid) to service_role;
grant execute on function public.mkt_has_integration_secret(uuid) to authenticated;
grant execute on function public.mkt_sync_begin(uuid, text, int) to authenticated, service_role;
grant execute on function public.mkt_sync_finish(bigint, boolean, int, text, jsonb) to authenticated, service_role;


-- ------------------------------------------------------------
-- 4) سجلّ المساعد الذكي — كل سؤال وكل أداة استُدعيت
-- ------------------------------------------------------------
create table if not exists public.mkt_ai_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at         timestamptz not null default now(),
  mode       text not null check (mode in ('سؤال', 'توليد')),
  prompt     text not null,
  tools      jsonb not null default '[]'::jsonb,
  answer     text,
  model      text,
  tokens_in  int,
  tokens_out int,
  error      text
);
create index if not exists mkt_ai_log_user_idx on public.mkt_ai_log (user_id, at desc);

alter table public.mkt_ai_log enable row level security;
drop policy if exists "read own ai log" on public.mkt_ai_log;
create policy "read own ai log" on public.mkt_ai_log
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_marketing_manager()));
drop policy if exists "write own ai log" on public.mkt_ai_log;
create policy "write own ai log" on public.mkt_ai_log
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_read_marketing_money()));


-- ------------------------------------------------------------
-- 5) RLS والتدقيق
-- ------------------------------------------------------------
alter table public.mkt_automation_rules enable row level security;
alter table public.mkt_alerts           enable row level security;
alter table public.mkt_automation_runs  enable row level security;
alter table public.mkt_integrations     enable row level security;
alter table public.mkt_sync_logs        enable row level security;

drop policy if exists "read rules" on public.mkt_automation_rules;
create policy "read rules" on public.mkt_automation_rules
  for select to authenticated using ((select public.can_read_marketing()));
drop policy if exists "manage rules" on public.mkt_automation_rules;
create policy "manage rules" on public.mkt_automation_rules
  for update to authenticated
  using ((select public.is_marketing_manager())) with check ((select public.is_marketing_manager()));

drop policy if exists "read alerts" on public.mkt_alerts;
create policy "read alerts" on public.mkt_alerts
  for select to authenticated using ((select public.can_read_marketing()));

drop policy if exists "read runs" on public.mkt_automation_runs;
create policy "read runs" on public.mkt_automation_runs
  for select to authenticated using ((select public.can_read_marketing()));

drop policy if exists "read integrations" on public.mkt_integrations;
create policy "read integrations" on public.mkt_integrations
  for select to authenticated using ((select public.can_read_marketing()));
drop policy if exists "manage integrations" on public.mkt_integrations;
create policy "manage integrations" on public.mkt_integrations
  for all to authenticated
  using ((select public.is_marketing_manager())) with check ((select public.is_marketing_manager()));

drop policy if exists "read sync logs" on public.mkt_sync_logs;
create policy "read sync logs" on public.mkt_sync_logs
  for select to authenticated using ((select public.can_read_marketing()));

do $$
declare t text;
begin
  foreach t in array array['mkt_automation_rules', 'mkt_integrations'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.audit_row()', t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 6) المهمّة المجدولة — ٧:٠٠ بغداد (٤:٠٠ UTC)
--
-- بعد الدرجات (٦) وقبل فحص الخدمة (٨) والمتابعات (٩): مدير التسويق
-- يرى تنبيهاته صباحاً، ومدير المتابعة يرى «ليدات بلا متابعة» قبل جولته.
--
-- ⚠️ المزامنة التلقائية للمنصّات لا تُجدول هنا: pg_net غير مثبّت، فلا
--    تستطيع القاعدة نداء دالّة الحافة. فعّل pg_net ثم شغّل الكتلة
--    المعلَّقة في آخر هذا الملف — أو اضغط «زامن الآن» من الشاشة.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mkt-automation-scan') then
    perform cron.unschedule('mkt-automation-scan');
  end if;
  perform cron.schedule('mkt-automation-scan', '0 4 * * *',
                        $job$select public.mkt_run_automation('مجدول')$job$);
end $$;

-- المزامنة المجدولة (بعد تفعيل pg_net وضبط السرّ MKT_CRON_SECRET في دالّة الحافة):
--
-- select cron.schedule('mkt-sync-daily', '30 3 * * *', $job$
--   select net.http_post(
--     url     := 'https://edgblrqkushnznhmuxln.supabase.co/functions/v1/marketing-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                                   'x-cron-secret', '<MKT_CRON_SECRET>'),
--     body    := '{"mode":"scheduled"}'::jsonb)
-- $job$);


-- ------------------------------------------------------------
-- 7) التحقّق
-- ------------------------------------------------------------
do $$
declare n int;
begin
  raise notice '--- 126 التسويق ٥ — الأتمتة والتكاملات ---';
  select count(*) into n from public.mkt_automation_rules where is_active;
  raise notice 'قواعد فعّالة: %', n;
  if not exists (select 1 from cron.job where jobname = 'mkt-automation-scan') then
    raise warning 'المهمة mkt-automation-scan لم تُجدول';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_secret'
                                         and pronamespace = 'vault'::regnamespace) then
    raise warning 'vault.create_secret غير موجودة — حفظ مفاتيح التكامل سيفشل';
  end if;
end $$;

notify pgrst, 'reload schema';
