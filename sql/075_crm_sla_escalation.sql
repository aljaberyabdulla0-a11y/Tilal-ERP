-- ============================================================
-- تلال ERP — 075: مستوى الخدمة والتصعيد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- التصعيد اليوم موجود في sql/027 لكنه **بلا ذاكرة**: يرسل إشعاراً
-- ثم ينسى. ولذلك لا أحد يستطيع أن يجيب عن أسئلة الإدارة الأربعة:
--
--   كم مرة تأخّرنا هذا الشهر؟        لا جواب — لم يُسجَّل التأخّر.
--   هل عولج التأخّر أم استمرّ؟        لا جواب — لم تُسجَّل المعالجة.
--   من صُعِّد إليه ولم يتحرّك؟        لا جواب — لم يُسجَّل التصعيد.
--   هل نتحسّن أم نسوء؟               لا جواب — لا تاريخ يُقارَن به.
--
-- وإشعارٌ يُرسَل ولا يُتابَع يتحوّل بعد أسبوعين إلى ضجيج يُغلقه
-- الموظف بلا قراءة — فيصير النظام يزعج ولا يحمي.
--
-- ============================================================
-- المبدأ الحاكم
--
--     الخرق واقعةٌ تُسجَّل وتُغلَق، لا رسالةٌ تُرسَل وتُنسى.
--
-- كل خرق صفٌّ له عمر: متى استُحقّ، متى رُصد، من صاحبه، إلى من
-- صُعِّد، ومتى عولج. فيصير «متوسط زمن الاستجابة» رقماً محسوباً لا
-- انطباعاً.
--
-- ============================================================
-- سلسلة التصعيد
--
--     المستوى ١  الموظف صاحب الليد        فور الخرق
--     المستوى ٢  مشرفه                    بعد مهلة التصعيد
--     المستوى ٣  الإدارة ومدير المتابعة   بعد ضعف المهلة
--
-- لا يُقفز مستوى. ولا يُصعَّد خرقٌ عولج. ومن صُعِّد إليه مرة لا
-- يُصعَّد إليه ثانية على نفس الخرق.
--
-- ============================================================
-- ما يضيفه
--
--   1) توسعة notifications: أولوية، تصنيف، نوع الكيان
--   2) crm_sla_rules    — القواعد ومهلها (قابلة للضبط)
--   3) crm_sla_breaches — الخروق بعمرها ومعالجتها
--   4) crm_escalations  — من صُعِّد إليه ولماذا ومتى
--   5) scan_crm_sla()   — الفحص الدوري
--   6) crm_sla_summary() — الأرقام التي تُقاس بها الاستجابة
--
-- ⚠️ لا يُلغى فحص sql/027 ولا يُعدَّل. هذا الملف يضيف طبقة الذاكرة
--    فوقه؛ الاثنان يتعايشان، والإشعارات المكرّرة يمنعها شرط
--    «لا إشعار لخرق مفتوح سبق أن أُشعر به».
--
-- يتطلب: sql/022 و 027 و 070 و 071 و 072. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) توسعة الإشعارات
-- ------------------------------------------------------------
alter table public.notifications
  add column if not exists priority    text not null default 'عادية',
  add column if not exists category    text,
  add column if not exists entity_type text,
  add column if not exists read_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_priority_chk') then
    alter table public.notifications add constraint notifications_priority_chk
      check (priority in ('حرجة','عالية','عادية','منخفضة'));
  end if;
end $$;

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);
create index if not exists notifications_category_idx
  on public.notifications (category, created_at desc) where category is not null;

comment on column public.notifications.priority is
  'حرجة = تحتاج تدخّلاً اليوم. الأولوية تُرتِّب مركز الإشعارات فلا يغرق المهم في العادي.';

-- ------------------------------------------------------------
-- 2) قواعد مستوى الخدمة
-- ------------------------------------------------------------
create table if not exists public.crm_sla_rules (
  code            text primary key,
  label           text not null,
  entity          text not null check (entity in ('client','opportunity')),
  threshold_hours int  not null,
  severity        text not null default 'عالية'
                  check (severity in ('حرجة','عالية','عادية','منخفضة')),
  escalate_after_hours int,          -- بعدها يصعد مستوى (null = بلا تصعيد)
  is_active       boolean not null default true,
  description     text
);

insert into public.crm_sla_rules
  (code, label, entity, threshold_hours, severity, escalate_after_hours, description) values
  ('first_contact', 'أول تواصل مع ليد جديد', 'client', 24, 'حرجة', 24,
   'ليد أُسنِد ولم يُسجَّل عليه تواصل خلال المهلة. أغلى خرق: ليدٌ بارد قبل أن يُلمَس.'),
  ('followup_overdue', 'متابعة فات موعدها', 'client', 24, 'عالية', 48,
   'موعد المتابعة مضى ولم يُسجَّل تواصل بعده.'),
  ('stage_stalled', 'فرصة عالقة في مرحلتها', 'opportunity', 720, 'عادية', null,
   'فرصة مفتوحة تجاوزت مهلة مرحلتها (crm_stages.sla_hours) أو ٣٠ يوماً.'),
  ('no_next_action', 'فرصة مفتوحة بلا خطوة قادمة', 'opportunity', 72, 'عالية', 72,
   'فرصة مفتوحة بلا موعد متابعة — خارج رادار الجميع.')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 3) الخروق
-- ------------------------------------------------------------
create table if not exists public.crm_sla_breaches (
  id          uuid primary key default gen_random_uuid(),
  rule_code   text not null references public.crm_sla_rules(code) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  client_id   uuid references public.clients(id) on delete cascade,
  owner_id    uuid references public.employees(id) on delete set null,
  owner_name  text,
  severity    text not null,
  due_at      timestamptz not null,      -- متى كان يجب أن يُنجَز
  detected_at timestamptz not null default now(),
  escalation_level int not null default 0,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution  text,                      -- تواصل | نُقل | أُغلق | يدوي
  -- خرقٌ واحد مفتوح لكل (قاعدة، كيان). إغلاقه يسمح بخرق جديد لاحقاً.
  constraint crm_sla_breaches_open_uq unique (rule_code, entity_id, detected_at)
);

create unique index if not exists crm_sla_breaches_one_open_idx
  on public.crm_sla_breaches (rule_code, entity_id)
  where resolved_at is null;

create index if not exists crm_sla_breaches_owner_idx
  on public.crm_sla_breaches (owner_id, resolved_at, detected_at desc);
create index if not exists crm_sla_breaches_open_idx
  on public.crm_sla_breaches (detected_at desc) where resolved_at is null;

comment on table public.crm_sla_breaches is
  'الخرق واقعة لها عمر: تُفتح وتُغلق. الفهرس الجزئي يضمن خرقاً مفتوحاً واحداً لكل قاعدة وكيان.';

-- ------------------------------------------------------------
-- 4) التصعيدات
-- ------------------------------------------------------------
create table if not exists public.crm_escalations (
  id          uuid primary key default gen_random_uuid(),
  breach_id   uuid not null references public.crm_sla_breaches(id) on delete cascade,
  level       int  not null check (level between 1 and 3),
  to_user_id  uuid references auth.users(id) on delete set null,
  to_name     text,
  reason      text not null,
  sent_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  constraint crm_escalations_once unique (breach_id, level, to_user_id)
);

create index if not exists crm_escalations_breach_idx
  on public.crm_escalations (breach_id, level);

-- ------------------------------------------------------------
-- 5) فتح خرق — نقطة دخول واحدة
--
-- تُرجِع معرّف الخرق (جديداً أو قائماً). الفهرس الجزئي يمنع
-- التكرار، فاستدعاؤها مرتين لا يفتح خرقين.
-- ------------------------------------------------------------
create or replace function public.open_sla_breach(
  p_rule_code text, p_entity_type text, p_entity_id uuid,
  p_client_id uuid, p_owner_id uuid, p_due_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
  sev      text;
  oname    text;
begin
  select id into existing from public.crm_sla_breaches
   where rule_code = p_rule_code and entity_id = p_entity_id and resolved_at is null;
  if existing is not null then
    return existing;
  end if;

  select severity into sev from public.crm_sla_rules where code = p_rule_code;
  select full_name into oname from public.employees where id = p_owner_id;

  insert into public.crm_sla_breaches
    (rule_code, entity_type, entity_id, client_id, owner_id, owner_name, severity, due_at)
  values
    (p_rule_code, p_entity_type, p_entity_id, p_client_id, p_owner_id, oname,
     coalesce(sev, 'عادية'), p_due_at)
  returning id into existing;

  return existing;
end $$;

-- ------------------------------------------------------------
-- 6) التصعيد — مستوى واحد في كل مرة
-- ------------------------------------------------------------
create or replace function public.escalate_breach(p_breach_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  b        public.crm_sla_breaches%rowtype;
  r        public.crm_sla_rules%rowtype;
  age_h    numeric;
  want     int;
  target   record;
  sent     int := 0;
  msg      text;
  deeplink text;
begin
  select * into b from public.crm_sla_breaches where id = p_breach_id;
  if b.id is null or b.resolved_at is not null then
    return 0;
  end if;

  select * into r from public.crm_sla_rules where code = b.rule_code;
  age_h := extract(epoch from (now() - b.detected_at)) / 3600.0;

  -- المستوى المستحقّ بعمر الخرق
  want := case
            when r.escalate_after_hours is null           then 1
            when age_h >= r.escalate_after_hours * 2      then 3
            when age_h >= r.escalate_after_hours          then 2
            else 1
          end;

  if want <= b.escalation_level then
    return 0;   -- صُعِّد لهذا المستوى سابقاً
  end if;

  -- الوجهة ملف العميل دائماً: فيه الفرص والإجراء التالي، ولا مسار
  -- مستقل للفرصة الواحدة في الواجهة.
  deeplink := case
                when b.client_id is not null then '/dashboard/clients/' || b.client_id
                when b.entity_type = 'opportunity' then '/dashboard/crm/opportunities'
                else '/dashboard/clients/' || b.entity_id
              end;

  msg := r.label || ' — ' || coalesce(b.owner_name, 'بلا مالك')
         || ' · مستحقّ منذ ' || to_char(b.due_at, 'YYYY-MM-DD HH24:MI');

  -- المستوى ١: صاحب الليد
  if want >= 1 and b.escalation_level < 1 then
    for target in
      select e.user_id uid, e.full_name nm from public.employees e
       where e.id = b.owner_id and e.user_id is not null
    loop
      insert into public.notifications
        (user_id, title, body, link, kind, category, entity_type, entity_id, priority)
      values (target.uid, r.label, msg, deeplink, 'عام', 'sla', b.entity_type,
              b.entity_id, b.severity);
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (b.id, 1, target.uid, target.nm, 'تنبيه صاحب الليد')
      on conflict do nothing;
      sent := sent + 1;
    end loop;
  end if;

  -- المستوى ٢: المشرف على فريق صاحب الليد
  if want >= 2 and b.escalation_level < 2 then
    for target in
      select p.id uid, public.display_name(p.id) nm
        from public.employees me
        join public.projects t  on t.id = me.project_id   -- الفريق = المشروع (sql/037)
        join public.employees s on s.id = t.supervisor_id
        join public.profiles p  on p.id = s.user_id
       where me.id = b.owner_id
    loop
      insert into public.notifications
        (user_id, title, body, link, kind, category, entity_type, entity_id, priority)
      values (target.uid, 'تصعيد: ' || r.label, msg, deeplink, 'عام', 'sla',
              b.entity_type, b.entity_id, 'عالية');
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (b.id, 2, target.uid, target.nm,
              'مضت ' || round(age_h) || ' ساعة بلا معالجة')
      on conflict do nothing;
      sent := sent + 1;
    end loop;
  end if;

  -- المستوى ٣: الإدارة ومدير المتابعة
  if want >= 3 and b.escalation_level < 3 then
    for target in
      select p.id uid, public.display_name(p.id) nm
        from public.profiles p
       where p.role in ('admin', 'followup_manager')
    loop
      insert into public.notifications
        (user_id, title, body, link, kind, category, entity_type, entity_id, priority)
      values (target.uid, 'تصعيد للإدارة: ' || r.label, msg, deeplink, 'عام', 'sla',
              b.entity_type, b.entity_id, 'حرجة');
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (b.id, 3, target.uid, target.nm,
              'مضت ' || round(age_h) || ' ساعة ولم يعالجها الموظف ولا المشرف')
      on conflict do nothing;
      sent := sent + 1;
    end loop;
  end if;

  update public.crm_sla_breaches set escalation_level = want where id = b.id;
  return sent;
end $$;

-- ------------------------------------------------------------
-- 7) الفحص الدوري
--
-- الترتيب مقصود: **نُغلق المعالَج قبل أن نفتح الجديد**. بلا ذلك
-- يُصعَّد خرقٌ عولج البارحة لأن الفحص رآه مفتوحاً.
-- ------------------------------------------------------------
--
-- p_notify = false: **خطّ الأساس** عند التفعيل الأول. الخروق القائمة قبل
-- تشغيل 075 تُسجَّل كاملةً (فتظهر في التقارير ومساحة العمل) لكن بلا
-- إشعار فردي — ٢١٢ خرقاً قديماً في صباح واحد يدفن الإشارة الحقيقية
-- ويُفقد الإشعارات مصداقيتها. تُختم بالمستوى ٣ وسببٍ صريح كي لا تُقرأ
-- في التقارير كتصعيدات فعلية، وتُبلَّغ الإدارة بإشعار واحد جامع.
-- ما يُفتح بعد ذلك يُنبَّه عليه ويُصعَّد كالمعتاد.
create or replace function public.scan_crm_sla(p_notify boolean default true)
returns table (opened int, escalated int, resolved int)
language plpgsql security definer set search_path = public as $$
declare
  n_open int := 0; n_esc int := 0; n_res int := 0;
  r      record;
  bid    uuid;
  fc_h   int := public.crm_setting_int('first_contact_sla_hours', 24);

  -- تصعيد أو ختم — بحسب الوضع
  procedure_note text := 'خرق قائم قبل تفعيل مستوى الخدمة (075) — سُجِّل بلا تنبيه فردي';
begin
  -- ===== (أ) إغلاق ما عولج =====

  -- أول تواصل: حصل التواصل
  with fixed as (
    update public.crm_sla_breaches b
       set resolved_at = now(), resolution = 'تواصل'
      from public.clients c
     where b.rule_code = 'first_contact' and b.resolved_at is null
       and c.id = b.entity_id and c.last_contact_at is not null
    returning 1)
  select count(*) into n_res from fixed;

  -- متابعة متأخرة: تواصلٌ بعد الموعد، أو أُغلق الملف
  with fixed as (
    update public.crm_sla_breaches b
       set resolved_at = now(), resolution = 'تواصل'
      from public.clients c
     where b.rule_code = 'followup_overdue' and b.resolved_at is null
       and c.id = b.entity_id
       and (not public.is_open_stage(c.stage)
            or c.last_contact_at > b.due_at
            or c.follow_up_date >= public.baghdad_today())
    returning 1)
  select n_res + count(*) into n_res from fixed;

  -- الفرص: تحرّكت المرحلة أو أُغلقت أو صار لها خطوة قادمة
  with fixed as (
    update public.crm_sla_breaches b
       set resolved_at = now(), resolution = 'أُغلق'
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where b.entity_type = 'opportunity' and b.resolved_at is null
       and o.id = b.entity_id
       and (o.deleted_at is not null
            or g.stage_type <> 'open'
            or (b.rule_code = 'stage_stalled'  and o.stage_entered_at > b.detected_at)
            or (b.rule_code = 'no_next_action' and o.next_action_date is not null))
    returning 1)
  select n_res + count(*) into n_res from fixed;

  -- الليد نُقل لمالك آخر: الخرق ليس على صاحبه الجديد
  with moved as (
    update public.crm_sla_breaches b
       set resolved_at = now(), resolution = 'نُقل'
      from public.clients c
     where b.resolved_at is null and c.id = b.client_id
       and b.owner_id is distinct from c.owner_id
    returning 1)
  select n_res + count(*) into n_res from moved;

  -- ===== (ب) فتح الجديد =====

  -- أول تواصل
  for r in
    select c.id, c.owner_id,
           coalesce(c.owner_assigned_at, c.created_at) + (fc_h || ' hours')::interval as due
      from public.clients c
     where public.is_open_stage(c.stage)
       and c.last_contact_at is null
       and coalesce(c.owner_assigned_at, c.created_at) < now() - (fc_h || ' hours')::interval
  loop
    bid := public.open_sla_breach('first_contact', 'client', r.id, r.id, r.owner_id, r.due);
    n_open := n_open + 1;
    if p_notify then
      n_esc := n_esc + public.escalate_breach(bid);
    else
      update public.crm_sla_breaches set escalation_level = 3
       where id = bid and escalation_level = 0;
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (bid, 3, null, 'النظام', procedure_note)
      on conflict do nothing;
    end if;
  end loop;

  -- متابعة فات موعدها
  for r in
    select c.id, c.owner_id, (c.follow_up_date + 1)::timestamptz as due
      from public.clients c
     where public.is_open_stage(c.stage)
       and c.follow_up_date < public.baghdad_today()
       and (c.last_contact_at is null or c.last_contact_at::date <= c.follow_up_date)
  loop
    bid := public.open_sla_breach('followup_overdue', 'client', r.id, r.id, r.owner_id, r.due);
    n_open := n_open + 1;
    if p_notify then
      n_esc := n_esc + public.escalate_breach(bid);
    else
      update public.crm_sla_breaches set escalation_level = 3
       where id = bid and escalation_level = 0;
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (bid, 3, null, 'النظام', procedure_note)
      on conflict do nothing;
    end if;
  end loop;

  -- فرصة مفتوحة بلا خطوة قادمة
  for r in
    select o.id, o.client_id, o.owner_id,
           o.created_at + (public.crm_setting_int('unworked_lead_days', 3) || ' days')::interval as due
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open'
       and o.next_action_date is null
       and o.created_at < now() - interval '72 hours'
  loop
    bid := public.open_sla_breach('no_next_action', 'opportunity', r.id, r.client_id,
                                  r.owner_id, r.due);
    n_open := n_open + 1;
    if p_notify then
      n_esc := n_esc + public.escalate_breach(bid);
    else
      update public.crm_sla_breaches set escalation_level = 3
       where id = bid and escalation_level = 0;
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (bid, 3, null, 'النظام', procedure_note)
      on conflict do nothing;
    end if;
  end loop;

  -- فرصة عالقة: مهلة مرحلتها إن وُجدت، وإلا ٣٠ يوماً
  for r in
    select o.id, o.client_id, o.owner_id,
           o.stage_entered_at + (coalesce(g.sla_hours, 720) || ' hours')::interval as due
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open'
       and o.stage_entered_at < now() - (coalesce(g.sla_hours, 720) || ' hours')::interval
  loop
    bid := public.open_sla_breach('stage_stalled', 'opportunity', r.id, r.client_id,
                                  r.owner_id, r.due);
    n_open := n_open + 1;
    if p_notify then
      n_esc := n_esc + public.escalate_breach(bid);
    else
      update public.crm_sla_breaches set escalation_level = 3
       where id = bid and escalation_level = 0;
      insert into public.crm_escalations (breach_id, level, to_user_id, to_name, reason)
      values (bid, 3, null, 'النظام', procedure_note)
      on conflict do nothing;
    end if;
  end loop;

  -- ===== (ج) تصعيد الخروق المفتوحة التي شاخت =====
  if p_notify then
    for r in
      select id from public.crm_sla_breaches
       where resolved_at is null and escalation_level < 3
    loop
      n_esc := n_esc + public.escalate_breach(r.id);
    end loop;
  end if;

  return query select n_open, n_esc, n_res;
end $$;

create or replace function public.run_crm_sla_scan()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.scan_crm_sla();
  raise notice 'فحص مستوى الخدمة: فُتح % · صُعِّد % · أُغلق %', r.opened, r.escalated, r.resolved;
end $$;

-- ------------------------------------------------------------
-- 8) ملخّص الاستجابة — ما تُقاس به الإدارة
-- ------------------------------------------------------------
create or replace function public.crm_sla_summary(
  p_from date default null, p_to date default null
) returns table (
  rule_code      text,
  rule_label     text,
  breaches       bigint,
  still_open     bigint,
  escalated_l2   bigint,
  escalated_l3   bigint,
  avg_resolution_hours numeric,
  worst_owner    text
)
language sql stable set search_path = public as $$
  select b.rule_code,
         r.label,
         count(*),
         count(*) filter (where b.resolved_at is null),
         count(*) filter (where b.escalation_level >= 2),
         count(*) filter (where b.escalation_level >= 3),
         round(avg(extract(epoch from (b.resolved_at - b.detected_at)) / 3600.0)
               filter (where b.resolved_at is not null), 1),
         (select b2.owner_name from public.crm_sla_breaches b2
           where b2.rule_code = b.rule_code and b2.owner_name is not null
           group by b2.owner_name order by count(*) desc limit 1)
    from public.crm_sla_breaches b
    join public.crm_sla_rules r on r.code = b.rule_code
   where (p_from is null or b.detected_at::date >= p_from)
     and (p_to   is null or b.detected_at::date <= p_to)
   group by b.rule_code, r.label
   order by count(*) filter (where b.resolved_at is null) desc;
$$;

-- ------------------------------------------------------------
-- 9) الجدولة — ٨ صباحاً بغداد (٥ UTC)، قبل فحص المتابعات بساعة
-- ------------------------------------------------------------
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('crm-sla-scan'); exception when others then null; end $$;
select cron.schedule('crm-sla-scan', '0 5 * * *',
  $cron$ select public.run_crm_sla_scan(); $cron$);

-- ------------------------------------------------------------
-- 10) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_sla_rules    enable row level security;
alter table public.crm_sla_breaches enable row level security;
alter table public.crm_escalations  enable row level security;

drop policy if exists "read sla rules" on public.crm_sla_rules;
create policy "read sla rules" on public.crm_sla_rules
  for select to authenticated using (true);
drop policy if exists "admin writes sla rules" on public.crm_sla_rules;
create policy "admin writes sla rules" on public.crm_sla_rules
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- الموظف يرى خروقه، والمشرف نطاقه، والإدارة الكل.
drop policy if exists "read sla breaches" on public.crm_sla_breaches;
create policy "read sla breaches" on public.crm_sla_breaches
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
  );

-- إغلاق الخرق يدوياً: الإدارة ومدير المتابعة (والفحص يغلق آلياً بـdefiner)
drop policy if exists "resolve sla breaches" on public.crm_sla_breaches;
create policy "resolve sla breaches" on public.crm_sla_breaches
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager()))
  with check ((select public.is_admin()) or (select public.is_followup_manager()));

drop policy if exists "read escalations" on public.crm_escalations;
create policy "read escalations" on public.crm_escalations
  for select to authenticated
  using (
    (select public.is_admin())
    or to_user_id = (select auth.uid())
    or exists (select 1 from public.crm_sla_breaches b
                where b.id = breach_id
                  and b.owner_id in (select s.id from public.my_scope_employees() s))
  );

-- إقرار الاستلام: من صُعِّد إليه وحده
drop policy if exists "ack escalations" on public.crm_escalations;
create policy "ack escalations" on public.crm_escalations
  for update to authenticated
  using (to_user_id = (select auth.uid()))
  with check (to_user_id = (select auth.uid()));

revoke all on function public.open_sla_breach(text, text, uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.escalate_breach(uuid)    from public;
revoke all on function public.scan_crm_sla(boolean)    from public;
revoke all on function public.run_crm_sla_scan()       from public;
revoke all on function public.crm_sla_summary(date, date) from public;

grant execute on function public.scan_crm_sla(boolean)       to service_role;
grant execute on function public.run_crm_sla_scan()          to service_role;
grant execute on function public.open_sla_breach(text, text, uuid, uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.escalate_breach(uuid)       to service_role;
grant execute on function public.crm_sla_summary(date, date) to authenticated, service_role;

-- ------------------------------------------------------------
-- 11) الفحص الأول والتحقّق
-- ------------------------------------------------------------
do $$
declare s record; r record;
begin
  raise notice '--- 075 مستوى الخدمة والتصعيد ---';

  -- خطّ الأساس: يُسجَّل القائم بلا تنبيهات فردية (انظر تعليق scan_crm_sla)
  select * into s from public.scan_crm_sla(false);
  raise notice 'خطّ الأساس: سُجِّل % خرقاً قائماً بلا تنبيه فردي · أُغلق %',
    s.opened, s.resolved;

  if s.opened > 0 then
    insert into public.notifications (user_id, title, body, link, kind, category, priority)
    select p.id,
           'تفعيل مستوى الخدمة',
           s.opened || ' خرقاً قائماً سُجِّل عند التفعيل بلا تنبيهات فردية — راجع ملخّص مستوى الخدمة في التقارير.',
           '/dashboard/crm/reports#sla', 'عام', 'sla', 'عالية'
      from public.profiles p
     where p.role in ('admin', 'followup_manager');
  end if;

  for r in select * from public.crm_sla_summary() loop
    raise notice '  % — % خرقاً (مفتوح %) | صُعِّد للمشرف % وللإدارة %',
      r.rule_label, r.breaches, r.still_open, r.escalated_l2, r.escalated_l3;
  end loop;

  if s.opened > 200 then
    raise warning 'عدد الخروق كبير في أول فحص (%) — متوقّع على بيانات متراكمة.', s.opened;
    raise warning 'عالج الدفعة الأولى من لوحة التوزيع قبل الاعتماد على التنبيهات اليومية،';
    raise warning 'وإلا أغرقت الإشعاراتُ الفريقَ فأهملها — والتنبيه المُهمَل أسوأ من غيابه.';
  end if;
end $$;

notify pgrst, 'reload schema';
