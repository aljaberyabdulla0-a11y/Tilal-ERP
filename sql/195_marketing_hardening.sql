-- ============================================================
-- Tilal ERP — 195: Marketing 6 — closing the gaps found in the 2026-10-08 review
-- Copy this whole file and paste it into: Supabase ← SQL Editor ← New query ← Run
--
-- The review found the section built and tested (64/64), but:
--
--   1) The marketing manager doesn't open it: her position in HR is «مدير التسويق»
--      and the marketing team (mkt_team) is maintained by hand only.
--   2) A plan gets approved by editing its status — mkt_plans has no guard.
--   3) An approved amount doesn't freeze: an approved campaign's budget rises from one million
--      to ninety without anyone approving it (and the same goes for the activity, the deal and the plan).
--   4) The marketing manager's own request goes back to her — she can't approve it and
--      the admin doesn't know about it.
--   5) The database grants more than the UI shows: any member deletes a campaign,
--      edits the channels, and marks the integration as «connected».
--   6) The numbers: every client counts as a «marketing lead» (74% of them are a broker office or
--      acquaintances), «social media» gets attributed to Facebook arbitrarily, the lead date is its
--      entry date into the system, and the marketing-services revenue (4400) isn't seen.
--   7) Marketing doesn't see whether sales are following up its leads.
--   8) The landing page has no image and no WhatsApp; and Meta form leads go through no
--      path to the database (touchpoint by ad).
--
-- Requires: 121–127, 145–146 (positions). Safe to re-run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) The marketing team follows HR
--
-- An employee whose position is in marketing (MKT-*) joins the team with its matching role on
-- appointment, and leaves it when they leave the position. A manual row (the marketing manager added
-- someone from outside the department) isn't touched in its role, and isn't deactivated when they leave.
-- ------------------------------------------------------------
alter table public.mkt_team
  add column if not exists source text not null default 'يدوي';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_team_source_chk') then
    alter table public.mkt_team add constraint mkt_team_source_chk
      check (source in ('يدوي', 'الموارد البشرية'));
  end if;
end $$;

create or replace function public.mkt_role_for_position(p_position uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p.code
           when 'MKT-MGR'      then 'مدير التسويق'
           when 'MKT-AM'       then 'مدير حساب'
           when 'MKT-WRITER'   then 'كاتب محتوى'
           when 'MKT-DESIGNER' then 'مصمّم'
           when 'MKT-AI'       then 'أخصائي تسويق'
           when 'MKT-PHOTO'    then 'مصوّر'
           when 'MKT-VIDEO'    then 'مونتير'
           when 'MKT-BUYER'    then 'مشتري إعلانات'
           else case p.default_role_code
                  when 'marketing_manager'  then 'مدير التسويق'
                  when 'marketing_employee' then 'أخصائي تسويق'
                  when 'marketing'          then 'أخصائي تسويق'
                end
         end
    from public.positions p where p.id = p_position;
$$;

create or replace function public.mkt_sync_team_member(p_employee uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare e public.employees%rowtype; v_role text;
begin
  select * into e from public.employees where id = p_employee;
  if not found then return; end if;
  v_role := case when e.status = 'active' then public.mkt_role_for_position(e.position_id) end;

  if v_role is not null then
    insert into public.mkt_team (employee_id, mkt_role, source, is_active, notes)
    values (e.id, v_role, 'الموارد البشرية', true, 'من منصبه في الموارد البشرية')
    on conflict (employee_id) do update
      set is_active = true,
          mkt_role  = case when public.mkt_team.source = 'الموارد البشرية' then excluded.mkt_role
                           else public.mkt_team.mkt_role end;
  else
    update public.mkt_team set is_active = false
     where employee_id = e.id and is_active
       and (source = 'الموارد البشرية' or e.status <> 'active');
  end if;
end;
$fn$;

create or replace function public.mkt_on_employee_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  begin
    perform public.mkt_sync_team_member(new.id);
  exception when others then
    insert into public.mkt_event_errors (source, message, context)
    values ('mkt_on_employee_change', sqlerrm, jsonb_build_object('employee', new.id));
  end;
  return null;
end;
$fn$;

drop trigger if exists trg_mkt_team_from_hr on public.employees;
create trigger trg_mkt_team_from_hr
  after insert or update of position_id, status on public.employees
  for each row execute function public.mkt_on_employee_change();

revoke all on function public.mkt_role_for_position(uuid)   from public, anon, authenticated;
revoke all on function public.mkt_sync_team_member(uuid)    from public, anon, authenticated;
revoke all on function public.mkt_on_employee_change()      from public, anon, authenticated;

-- Backfill: anyone in a marketing position today joins the team
do $$
declare r record;
begin
  for r in select e.id from public.employees e
            where e.status = 'active' and public.mkt_role_for_position(e.position_id) is not null loop
    perform public.mkt_sync_team_member(r.id);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 2) Who approves what amount — one point
--
-- The approver is chosen by the rule (type × amount). The approved amount doesn't rise afterwards
-- except at the hand of whoever would have approved it — and the edit is recorded in the audit.
-- ------------------------------------------------------------
create or replace function public.mkt_required_approver(p_type text, p_amount numeric)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select r.approver from public.mkt_approval_rules r
                    where r.entity_type = p_type and r.is_active and r.min_amount <= coalesce(p_amount, 0)
                    order by r.min_amount desc limit 1), 'المدير');
$$;

create or replace function public.mkt_can_approve(p_type text, p_amount numeric)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.mkt_required_approver(p_type, p_amount)
           when 'مدير التسويق' then public.is_marketing_manager()
           when 'المالية'      then public.is_admin() or public.can_manage_finance()
           else public.is_admin()
         end;
$$;

revoke all on function public.mkt_required_approver(text, numeric) from public, anon;
revoke all on function public.mkt_can_approve(text, numeric)       from public, anon;
grant execute on function public.mkt_required_approver(text, numeric) to authenticated;
grant execute on function public.mkt_can_approve(text, numeric)       to authenticated;

-- One guard for the four entities whose amount is approved
create or replace function public.mkt_guard_approved_amount()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_type text; v_old numeric; v_new numeric; v_pending boolean; v_approved boolean;
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if coalesce(current_setting('tilal.mkt_approval', true), '') = 'on' then
    return new;
  end if;

  case tg_table_name
    when 'crm_campaigns' then
      v_type := 'حملة'; v_old := (o->>'budget')::numeric; v_new := (n->>'budget')::numeric;
      v_pending := o->>'status' = 'بانتظار الموافقة';
    when 'mkt_plans' then
      v_type := 'خطة'; v_old := (o->>'budget')::numeric; v_new := (n->>'budget')::numeric;
      v_pending := o->>'status' = 'بانتظار الموافقة';
    when 'mkt_activities' then
      v_type := 'نشاط'; v_old := (o->>'budget')::numeric; v_new := (n->>'budget')::numeric;
      v_pending := o->>'status' = 'بانتظار الموافقة';
    when 'mkt_influencer_deals' then
      v_type := 'مؤثر';
      v_old := coalesce((o->>'negotiated_rate')::numeric, (o->>'quoted_rate')::numeric);
      v_new := coalesce((n->>'negotiated_rate')::numeric, (n->>'quoted_rate')::numeric);
      v_pending := exists (select 1 from public.mkt_approvals a
                            where a.entity_type = 'مؤثر' and a.entity_id = old.id and a.status = 'معلّق');
  end case;
  v_approved := o->>'approved_at' is not null;

  if v_new is not distinct from v_old then
    return new;
  end if;

  if v_pending then
    raise exception 'بانتظار الموافقة على % — اسحب الطلب قبل تعديل المبلغ (المعتمِد يرى الرقم الذي طُلب)',
      public.fmt_qty(v_old);
  end if;

  -- After approval: the reduction is free, and the increase is for whoever would approve the new amount
  if v_approved and coalesce(v_new, 0) > coalesce(v_old, 0)
     and not public.mkt_can_approve(v_type, v_new) then
    raise exception 'المبلغ معتمد (%) — رفعه إلى % يعتمده: %. اطلب منه التعديل',
      public.fmt_qty(coalesce(v_old, 0)), public.fmt_qty(v_new), public.mkt_required_approver(v_type, v_new);
  end if;
  return new;
end;
$fn$;

revoke all on function public.mkt_guard_approved_amount() from public, anon, authenticated;

drop trigger if exists trg_mkt_guard_amount on public.crm_campaigns;
create trigger trg_mkt_guard_amount before update of budget on public.crm_campaigns
  for each row execute function public.mkt_guard_approved_amount();
drop trigger if exists trg_mkt_guard_amount on public.mkt_plans;
create trigger trg_mkt_guard_amount before update of budget on public.mkt_plans
  for each row execute function public.mkt_guard_approved_amount();
drop trigger if exists trg_mkt_guard_amount on public.mkt_activities;
create trigger trg_mkt_guard_amount before update of budget on public.mkt_activities
  for each row execute function public.mkt_guard_approved_amount();
drop trigger if exists trg_mkt_guard_amount on public.mkt_influencer_deals;
create trigger trg_mkt_guard_amount before update of quoted_rate, negotiated_rate on public.mkt_influencer_deals
  for each row execute function public.mkt_guard_approved_amount();


-- ------------------------------------------------------------
-- 3) Plan guard — the plan was the only one approved by editing its status
-- ------------------------------------------------------------
create or replace function public.mkt_guard_plan()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'مسودة' and not v_flag and not public.mkt_can_approve('خطة', new.budget) then
      new.status := 'مسودة';
    end if;
    if new.status = 'معتمدة' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    else
      new.approved_at := null; new.approved_by := null;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not v_flag then
    if old.status = 'بانتظار الموافقة' then
      raise exception 'الخطة بانتظار الموافقة — اسحب الطلب أو انتظر القرار';
    elsif new.status = 'بانتظار الموافقة' then
      raise exception 'طلب اعتماد الخطة من زرّ «اطلب الموافقة»';
    elsif new.status = 'معتمدة' and not public.mkt_can_approve('خطة', new.budget) then
      raise exception 'اعتماد الخطة لـ% — اطلب الموافقة', public.mkt_required_approver('خطة', new.budget);
    elsif old.status = 'مؤرشفة' and not public.is_marketing_manager() then
      raise exception 'إعادة فتح خطة مؤرشفة لمدير التسويق';
    end if;
    if new.status = 'معتمدة' then
      new.approved_at := now(); new.approved_by := auth.uid();
    end if;
  end if;

  -- The approval columns aren't written by hand
  if not v_flag and (new.approved_at, new.approved_by) is distinct from (old.approved_at, old.approved_by)
     and new.status is not distinct from old.status then
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

revoke all on function public.mkt_guard_plan() from public, anon, authenticated;

drop trigger if exists trg_mkt_guard_plan on public.mkt_plans;
create trigger trg_mkt_guard_plan
  before insert or update on public.mkt_plans
  for each row execute function public.mkt_guard_plan();

-- Approved expense: changing its campaign or category or vendor = a different document → back to draft
-- (escalation to the admin is computed from the campaign's budget, so changing the campaign after approval
-- was bypassing it)
create or replace function public.mkt_guard_expense_target()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.status = 'معتمد'
     and coalesce(current_setting('tilal.mkt_approval', true), '') <> 'on'
     and coalesce(current_setting('tilal.mkt_pay', true), '') <> 'on'
     and (new.campaign_id, new.category, new.vendor_id, new.activity_id)
         is distinct from (old.campaign_id, old.category, old.vendor_id, old.activity_id) then
    new.status := 'مسودة'; new.approved_at := null; new.approved_by := null;
  end if;
  return new;
end;
$fn$;

revoke all on function public.mkt_guard_expense_target() from public, anon, authenticated;

drop trigger if exists trg_mkt_guard_expense_target on public.mkt_expenses;
create trigger trg_mkt_guard_expense_target
  before update on public.mkt_expenses
  for each row execute function public.mkt_guard_expense_target();


-- ------------------------------------------------------------
-- 4) A request that doesn't go back to the requester
--
-- A request from the marketing manager whose approver is «the marketing manager» goes up to the admin —
-- it used to go back to her: she can't approve it (segregation of duties) and the admin doesn't know about it.
-- And likewise the accountant with a request whose approver is «finance».
-- ------------------------------------------------------------
create or replace function public.mkt_request_approval(p_type text, p_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  info record; v_approver text; v_reason text; v_id uuid;
begin
  if not public.can_write_marketing() then
    raise exception 'طلب الموافقة لفريق التسويق';
  end if;

  select * into info from public.mkt_entity_info(p_type, p_id);
  if info.title is null then
    raise exception 'الكيان غير موجود';
  end if;
  if exists (select 1 from public.mkt_approvals
              where entity_type = p_type and entity_id = p_id and status = 'معلّق') then
    raise exception 'طلب موافقة معلّق سلفاً على «%»', info.title;
  end if;

  v_approver := public.mkt_required_approver(p_type, info.amount);
  v_reason := info.escalate;
  if info.escalate is not null then
    v_approver := 'المدير';
  end if;
  if not public.is_admin() then
    if v_approver = 'مدير التسويق' and public.is_marketing_manager() then
      v_approver := 'المدير';
      v_reason := coalesce(v_reason || ' · ', '') || 'الطالب مدير التسويق نفسه — فصل الواجبات';
    elsif v_approver = 'المالية' and public.can_manage_finance() then
      v_approver := 'المدير';
      v_reason := coalesce(v_reason || ' · ', '') || 'الطالب من المالية نفسها — فصل الواجبات';
    end if;
  end if;

  insert into public.mkt_approvals
    (entity_type, entity_id, title, amount, approver, escalated_reason, note,
     requested_by, requested_by_name)
  values (p_type, p_id, info.title, info.amount, v_approver, v_reason, p_note,
          auth.uid(), public.mkt_my_name())
  returning id into v_id;

  perform public.mkt_apply_approval_state(p_type, p_id, 'pending');

  perform public.mkt_notify(
    case v_approver when 'المدير' then array['المدير']
                    when 'المالية' then array['المالية']
                    else array['مدير التسويق'] end,
    null, 'بانتظار موافقتك: ' || p_type,
    info.title || coalesce(' — ' || public.fmt_qty(info.amount) || ' د.ع', '') ||
      coalesce(' · ' || v_reason, ''),
    '/dashboard/marketing/approvals', v_id, 'عالية');

  return v_id;
end;
$fn$;

revoke all on function public.mkt_request_approval(text, uuid, text) from public, anon;
grant execute on function public.mkt_request_approval(text, uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 5) Permissions that match the documentation
-- ------------------------------------------------------------
-- Campaigns: the team creates and edits, and the marketing manager deletes (campaign deletion was open to every member)
drop policy if exists "admin writes campaigns" on public.crm_campaigns;
drop policy if exists "mkt insert campaigns" on public.crm_campaigns;
create policy "mkt insert campaigns" on public.crm_campaigns
  for insert to authenticated with check ((select public.can_write_marketing()));
drop policy if exists "mkt update campaigns" on public.crm_campaigns;
create policy "mkt update campaigns" on public.crm_campaigns
  for update to authenticated
  using ((select public.can_write_marketing())) with check ((select public.can_write_marketing()));
drop policy if exists "mkt delete campaigns" on public.crm_campaigns;
create policy "mkt delete campaigns" on public.crm_campaigns
  for delete to authenticated using ((select public.is_marketing_manager()));

-- The channels: classifying history (utm) is an admin decision
drop policy if exists "mkt insert" on public.mkt_channels;
create policy "mkt insert" on public.mkt_channels
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "mkt update" on public.mkt_channels;
create policy "mkt update" on public.mkt_channels
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "mkt delete" on public.mkt_channels;
create policy "mkt delete" on public.mkt_channels
  for delete to authenticated using ((select public.is_admin()));

-- The sync log: the edge function (service_role) writes it, not the user's session
create or replace function public.mkt_sync_begin(p_integration uuid, p_trigger text default 'يدوي', p_attempt int default 1)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'المزامنة تُسجَّل من دالّة الحافة — اضغط «زامن الآن»';
  end if;
  insert into public.mkt_sync_logs (integration_id, trigger, attempt, status)
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
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'المزامنة تُسجَّل من دالّة الحافة — اضغط «زامن الآن»';
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
    if v_fail = 1 then
      perform public.mkt_notify(array['مدير التسويق'], null, 'فشلت مزامنة تكامل تسويقي',
        left(coalesce(p_error, ''), 200), '/dashboard/marketing/integrations', v_int, 'عالية');
    end if;
  end if;
end;
$fn$;

revoke all on function public.mkt_sync_begin(uuid, text, int) from public, anon;
revoke all on function public.mkt_sync_finish(bigint, boolean, int, text, jsonb) from public, anon;
grant execute on function public.mkt_sync_begin(uuid, text, int) to authenticated, service_role;
grant execute on function public.mkt_sync_finish(bigint, boolean, int, text, jsonb) to authenticated, service_role;


-- ------------------------------------------------------------
-- 6) Which lead is a marketing lead — and which channel when we don't know
--
-- (a) The marketing source = a source linked to a channel (mkt_channels.source_id). «Broker office»
--     and «friend or acquaintances» aren't linked: their clients don't enter CPL and don't
--     count as a sale for marketing. And a client with a campaign or a touchpoint is a marketing lead whatever its source.
--
-- (b) «Social media» is one source above six channels. A client without a touchpoint used to get
--     attributed to the first of them (Facebook) — a number that misleads the budget decision. Now each source
--     has a «channel not specified» that's honest about it.
--
-- (c) The lead date = its entry date (entry_date) if it's before its creation in the system —
--     the import was making the import day look like a jump in leads.
-- ------------------------------------------------------------
alter table public.mkt_channels add column if not exists is_fallback boolean not null default false;

insert into public.mkt_channels (name, mode, platform, source_id, utm_source, utm_medium, sort_order, is_fallback)
select s.name || ' — قناة غير محدّدة',
       case when exists (select 1 from public.mkt_channels c where c.source_id = s.id and c.mode = 'رقمي') then 'رقمي' else 'ميداني' end,
       null, s.id, 'unspecified', 'src-' || substr(md5(s.id::text), 1, 6), 999, true
  from public.crm_sources s
 where exists (select 1 from public.mkt_channels c where c.source_id = s.id and not c.is_fallback)
on conflict (name) do nothing;

create or replace function public.mkt_source_channel(p_source uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.mkt_channels c
   where c.source_id = p_source
   order by c.is_fallback desc, c.sort_order limit 1;
$$;

create or replace function public.mkt_is_marketing_source(p_source uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_source is not null and exists (select 1 from public.mkt_channels c where c.source_id = p_source);
$$;

revoke all on function public.mkt_source_channel(uuid)      from public, anon;
revoke all on function public.mkt_is_marketing_source(uuid) from public, anon;
grant execute on function public.mkt_source_channel(uuid)      to authenticated;
grant execute on function public.mkt_is_marketing_source(uuid) to authenticated;

-- (a) The leads — with a new column: is_marketing
drop function if exists public.mkt_lead_facts(date, date);
create function public.mkt_lead_facts(p_from date default null, p_to date default null)
returns table (
  client_id uuid, created_on date, campaign_id uuid, channel_id uuid, project_id uuid,
  activity_id uuid, influencer_deal_id uuid, content_id uuid, landing_page_id uuid, owner_employee_id uuid,
  qualified boolean, contacted boolean, visited boolean, offered boolean,
  reserved boolean, sold boolean, is_marketing boolean
)
language sql stable security definer set search_path = public as $$
  with st as (
    select coalesce(max(sort_order) filter (where name = 'اتصال'), 2)       as o_contact,
           coalesce(max(sort_order) filter (where name = 'زيارة'), 3)       as o_visit,
           coalesce(max(sort_order) filter (where name = 'مناقشة العرض'), 4) as o_offer
      from public.crm_stages
  ),
  base as (
    select c.*, least(coalesce(c.entry_date, (c.created_at at time zone 'Asia/Baghdad')::date),
                      (c.created_at at time zone 'Asia/Baghdad')::date) as lead_on
      from public.clients c
     where public.can_read_marketing_money()
       and c.deleted_at is null and c.merged_into is null
  ),
  b as (
    select * from base
     where (p_from is null or lead_on >= p_from) and (p_to is null or lead_on <= p_to)
  ),
  ft as (
    select distinct on (t.client_id) t.client_id, t.campaign_id, t.channel_id, t.activity_id,
           t.influencer_deal_id, t.content_id, t.landing_page_id
      from public.mkt_touchpoints t
     where t.client_id in (select id from b)
     order by t.client_id, t.occurred_at
  ),
  reach as (
    select o.client_id, max(g.sort_order) as ord
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.client_id in (select id from b) and o.deleted_at is null and g.stage_type <> 'lost'
     group by o.client_id
    union all
    select o.client_id, max(g.sort_order)
      from public.opportunities o
      join public.opportunity_stage_history h on h.opportunity_id = o.id
      join public.crm_stages g on g.id = h.to_stage_id
     where o.client_id in (select id from b) and g.stage_type <> 'lost'
     group by o.client_id
  ),
  reached as (select client_id, max(ord) as ord from reach group by client_id)
  select c.id,
         c.lead_on,
         coalesce(c.campaign_id, ft.campaign_id),
         coalesce(ft.channel_id, cp.channel_id, public.mkt_source_channel(c.original_source_id)),
         coalesce(cp.project_id, c.project_id, c.preferred_project_id),
         ft.activity_id, ft.influencer_deal_id, ft.content_id, ft.landing_page_id,
         cp.owner_employee_id,
         c.qualified_at is not null,
         coalesce(rc.ord, 1) >= st.o_contact or coalesce(c.contact_count, 0) > 0,
         coalesce(rc.ord, 1) >= st.o_visit,
         coalesce(rc.ord, 1) >= st.o_offer,
         exists (select 1 from public.reservations r where r.client_id = c.id),
         exists (select 1 from public.sale_commissions sc where sc.client_id = c.id and sc.reversed_at is null),
         (c.campaign_id is not null or ft.client_id is not null
          or (c.broker_company_id is null and public.mkt_is_marketing_source(c.original_source_id)))
    from b c
    cross join st
    left join ft on ft.client_id = c.id
    left join public.crm_campaigns cp on cp.id = coalesce(c.campaign_id, ft.campaign_id)
    left join reached rc on rc.client_id = c.id;
$$;

revoke all on function public.mkt_lead_facts(date, date) from public, anon;
grant execute on function public.mkt_lead_facts(date, date) to authenticated;

-- (b) Attribution: the honest channel, and a sale from outside marketing is labelled «outside marketing»
create or replace function public.mkt_attributed_sales(
  p_model text default 'last', p_from date default null, p_to date default null
) returns table (
  sale_id uuid, reservation_id uuid, client_id uuid, project_id uuid, sale_date date,
  deal_amount numeric, commission numeric,
  campaign_id uuid, channel_id uuid, activity_id uuid, influencer_deal_id uuid, content_id uuid,
  touch_type text, weight numeric
)
language sql stable security definer set search_path = public as $$
  with sales as (
    select sc.id as sale_id, sc.reservation_id, sc.client_id, sc.project_id,
           coalesce((r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date,
                    (sc.created_at at time zone 'Asia/Baghdad')::date) as sale_date,
           coalesce(sc.deal_amount, 0) as deal_amount,
           coalesce(sc.company_amount, 0) as commission
      from public.sale_commissions sc
      join public.reservations r on r.id = sc.reservation_id
     where sc.reversed_at is null
       and public.can_read_marketing_money()
       and p_model in ('first', 'last', 'linear', 'position', 'time_decay', 'campaign')
  ),
  in_range as (
    select * from sales
     where (p_from is null or sale_date >= p_from) and (p_to is null or sale_date <= p_to)
  ),
  real_touches as (
    select t.client_id, t.occurred_at, t.campaign_id,
           coalesce(t.channel_id, cp.channel_id) as channel_id,
           t.activity_id, t.influencer_deal_id, t.content_id, t.touch_type
      from public.mkt_touchpoints t
      left join public.crm_campaigns cp on cp.id = t.campaign_id
     where t.client_id in (select client_id from in_range)
  ),
  -- A client without touchpoints: one touchpoint from its fields — if it came from marketing
  inferred as (
    select c.id as client_id, coalesce(c.first_touch_at, c.created_at) as occurred_at, c.campaign_id,
           coalesce(cp.channel_id, public.mkt_source_channel(c.original_source_id)) as channel_id,
           null::uuid as activity_id, null::uuid as influencer_deal_id, null::uuid as content_id,
           'أول لمسة (CRM)'::text as touch_type
      from public.clients c
      left join public.crm_campaigns cp on cp.id = c.campaign_id
     where c.id in (select client_id from in_range)
       and not exists (select 1 from public.mkt_touchpoints t where t.client_id = c.id)
       and (c.campaign_id is not null
            or (c.broker_company_id is null and public.mkt_is_marketing_source(c.original_source_id)))
  ),
  touches as (select * from real_touches union all select * from inferred),
  ranked as (
    select s.*, t.campaign_id, t.channel_id, t.activity_id, t.influencer_deal_id, t.content_id, t.touch_type,
           t.occurred_at,
           row_number() over (partition by s.sale_id order by t.occurred_at, t.touch_type) as rn,
           count(*)     over (partition by s.sale_id) as n,
           power(0.5, greatest(0, (s.sale_date - (t.occurred_at at time zone 'Asia/Baghdad')::date))::numeric / 7.0) as decay
      from in_range s
      join touches t on t.client_id = s.client_id
                    and (t.occurred_at at time zone 'Asia/Baghdad')::date <= s.sale_date
  ),
  weighted as (
    select r.*,
           case p_model
             when 'first'      then case when rn = 1 then 1 else 0 end
             when 'last'       then case when rn = n then 1 else 0 end
             when 'linear'     then 1.0 / n
             when 'position'   then case when n = 1 then 1
                                         when n = 2 then 0.5
                                         when rn = 1 or rn = n then 0.4
                                         else 0.2 / (n - 2) end
             when 'time_decay' then decay / sum(decay) over (partition by sale_id)
             else 0
           end::numeric as w
      from ranked r
  )
  select s.sale_id, s.reservation_id, s.client_id, s.project_id, s.sale_date, s.deal_amount, s.commission,
         c.campaign_id, cp.channel_id, null, null, null,
         case when c.campaign_id is not null then 'حملة العميل'
              when c.broker_company_id is null and public.mkt_is_marketing_source(c.original_source_id) then 'غير منسوب'
              else 'خارج التسويق' end, 1::numeric
    from in_range s
    join public.clients c on c.id = s.client_id
    left join public.crm_campaigns cp on cp.id = c.campaign_id
   where p_model = 'campaign'
  union all
  select sale_id, reservation_id, client_id, project_id, sale_date, deal_amount, commission,
         campaign_id, channel_id, activity_id, influencer_deal_id, content_id, touch_type, w
    from weighted
   where p_model <> 'campaign' and w > 0
  union all
  -- A sale with no touchpoint before it: «unattributed» if from marketing, «outside marketing» if from a broker office or acquaintances
  select s.sale_id, s.reservation_id, s.client_id, s.project_id, s.sale_date, s.deal_amount, s.commission,
         null, null, null, null, null,
         case when c.broker_company_id is null and public.mkt_is_marketing_source(c.original_source_id)
              then 'غير منسوب' else 'خارج التسويق' end,
         1::numeric
    from in_range s
    join public.clients c on c.id = s.client_id
   where p_model <> 'campaign'
     and not exists (select 1 from ranked r where r.sale_id = s.sale_id);
$$;

revoke all on function public.mkt_attributed_sales(text, date, date) from public, anon;
grant execute on function public.mkt_attributed_sales(text, date, date) to authenticated;

-- (c) The KPIs: marketing leads, sales attributed to marketing, and the marketing-services revenue
create or replace function public.mkt_kpis(
  p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null,
  p_model text default 'last'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_cost numeric; v_spend numeric; v_mat numeric; v_ad numeric; v_committed numeric; v_income numeric := 0;
  m record; l record; s record; v_scans bigint; v_views bigint;
  v_leads bigint;
begin
  if not public.can_read_marketing_money() then
    raise exception 'مؤشّرات التسويق لفريق التسويق والمالية';
  end if;

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where kind = 'مصروف'), 0),
         coalesce(sum(amount) filter (where kind = 'مواد'), 0),
         coalesce(sum(amount) filter (where is_ad), 0)
    into v_cost, v_spend, v_mat, v_ad
    from public.mkt_cost_facts(p_from, p_to) f
   where (p_project  is null or f.project_id  = p_project)
     and (p_campaign is null or f.campaign_id = p_campaign)
     and (p_channel  is null or f.channel_id  = p_channel);

  select coalesce(sum(e.amount_iqd), 0) into v_committed
    from public.mkt_expenses e
   where e.status = 'معتمد'
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
     and (p_project  is null or e.project_id  = p_project)
     and (p_campaign is null or e.campaign_id = p_campaign)
     and (p_channel  is null or e.channel_id  = p_channel);

  -- Marketing services revenue (4400): what the developer pays for marketing its project — a company and project level,
  -- not a campaign or a channel
  if p_campaign is null and p_channel is null then
    select coalesce(sum(cm.amount), 0) into v_income
      from public.cash_moves cm
     where cm.account_code = '4400' and cm.direction = 'قبض'
       and (p_from is null or cm.move_date >= p_from) and (p_to is null or cm.move_date <= p_to)
       and (p_project is null or cm.project_id = p_project);
  end if;

  select coalesce(sum(spend), 0) as spend, coalesce(sum(impressions), 0) as impressions,
         coalesce(sum(reach), 0) as reach, coalesce(sum(clicks), 0) as clicks,
         coalesce(sum(link_clicks), 0) as link_clicks, coalesce(sum(leads), 0) as platform_leads,
         coalesce(sum(video_views), 0) as video_views, coalesce(sum(engagements), 0) as engagements,
         coalesce(sum(visitors), 0) as visitors
    into m
    from public.mkt_metrics_daily d
    left join public.crm_campaigns cp on cp.id = d.campaign_id
   where (p_from is null or d.metric_date >= p_from) and (p_to is null or d.metric_date <= p_to)
     and (p_project  is null or cp.project_id = p_project)
     and (p_campaign is null or d.campaign_id = p_campaign)
     and (p_channel  is null or d.channel_id  = p_channel)
     and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب');

  select count(*) filter (where h.kind = 'مسح'), count(*) filter (where h.kind = 'زيارة')
    into v_scans, v_views
    from public.mkt_link_hits h
    left join public.mkt_tracking_links lk on lk.id = h.link_id
    left join public.mkt_landing_pages lp on lp.id = h.landing_page_id
   where (p_from is null or (h.hit_at at time zone 'Asia/Baghdad')::date >= p_from)
     and (p_to   is null or (h.hit_at at time zone 'Asia/Baghdad')::date <= p_to)
     and (p_project  is null or coalesce(lk.project_id, lp.project_id) = p_project)
     and (p_campaign is null or coalesce(lk.campaign_id, lp.campaign_id) = p_campaign)
     and (p_channel  is null or coalesce(lk.channel_id, lp.channel_id) = p_channel);

  select count(*) filter (where is_marketing) as leads,
         count(*) as all_leads,
         count(*) filter (where is_marketing and qualified) as qualified,
         count(*) filter (where is_marketing and contacted) as contacted,
         count(*) filter (where is_marketing and visited)   as visited,
         count(*) filter (where is_marketing and offered)   as offered,
         count(*) filter (where is_marketing and reserved)  as reserved,
         count(*) filter (where is_marketing and sold)      as sold
    into l
    from public.mkt_lead_facts(p_from, p_to) f
   where (p_project  is null or f.project_id  = p_project)
     and (p_campaign is null or f.campaign_id = p_campaign)
     and (p_channel  is null or f.channel_id  = p_channel);
  v_leads := l.leads;

  select coalesce(sum(weight) filter (where touch_type <> 'خارج التسويق'), 0) as sales,
         coalesce(sum(weight * commission) filter (where touch_type <> 'خارج التسويق'), 0) as commission,
         coalesce(sum(weight * deal_amount) filter (where touch_type <> 'خارج التسويق'), 0) as sale_value,
         coalesce(sum(weight) filter (where touch_type = 'غير منسوب'), 0) as unattributed,
         coalesce(sum(weight), 0) as all_sales,
         count(distinct reservation_id) as deals_touched
    into s
    from public.mkt_attributed_sales(p_model, p_from, p_to) a
   where (p_project  is null or a.project_id  = p_project)
     and (p_campaign is null or a.campaign_id = p_campaign)
     and (p_channel  is null or a.channel_id  = p_channel);

  return jsonb_build_object(
    'model', p_model,
    'cost', v_cost, 'spend', v_spend, 'materials', v_mat, 'ad_spend', v_ad, 'committed', v_committed,
    'service_income', v_income, 'net_result', round(s.commission + v_income - v_cost),
    'platform_spend', m.spend, 'recon_gap', m.spend - v_ad,
    'impressions', m.impressions, 'reach', m.reach, 'clicks', m.clicks, 'link_clicks', m.link_clicks,
    'platform_leads', m.platform_leads, 'video_views', m.video_views, 'engagements', m.engagements,
    'visitors', m.visitors + v_views, 'scans', v_scans,
    'leads', l.leads, 'all_leads', l.all_leads, 'non_marketing_leads', l.all_leads - l.leads,
    'qualified', l.qualified, 'contacted', l.contacted, 'visited', l.visited,
    'offered', l.offered, 'reservations', l.reserved, 'cohort_sales', l.sold,
    'sales', round(s.sales, 2), 'commission', round(s.commission), 'sale_value', round(s.sale_value),
    'unattributed_sales', round(s.unattributed, 2), 'all_sales', round(s.all_sales, 2),
    'cpl',  case when l.leads > 0     and v_cost > 0 then round(v_cost / l.leads) end,
    'cpql', case when l.qualified > 0 and v_cost > 0 then round(v_cost / l.qualified) end,
    'cpa',  case when l.reserved > 0  and v_cost > 0 then round(v_cost / l.reserved) end,
    'cac',  case when s.sales > 0     and v_cost > 0 then round(v_cost / s.sales) end,
    'ctr',  case when m.impressions > 0 then round(m.clicks * 100.0 / m.impressions, 2) end,
    'cpc',  case when m.clicks > 0 and m.spend > 0 then round(m.spend / m.clicks) end,
    'lead_to_qualified',   case when v_leads > 0 then round(l.qualified * 100.0 / v_leads, 1) end,
    'lead_to_reservation', case when v_leads > 0 then round(l.reserved  * 100.0 / v_leads, 1) end,
    'lead_to_sale',        case when v_leads > 0 then round(l.sold      * 100.0 / v_leads, 1) end,
    'roas', case when v_ad > 0 then round(s.commission / v_ad, 2) end,
    'roi',  case when v_cost > 0 then round((s.commission - v_cost) * 100.0 / v_cost, 1) end,
    'roi_value', case when v_cost > 0 then round((s.sale_value - v_cost) * 100.0 / v_cost, 1) end
  );
end;
$fn$;

revoke all on function public.mkt_kpis(date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_kpis(date, date, uuid, uuid, uuid, text) to authenticated;

-- (d) The breakdown and the trend: marketing leads and sales alone
create or replace function public.mkt_breakdown(
  p_dim text, p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null,
  p_model text default 'last'
) returns table (
  dim_key text, label text, cost numeric, ad_spend numeric, platform_spend numeric,
  impressions bigint, clicks bigint, leads bigint, qualified bigint, reservations bigint,
  sales numeric, commission numeric, sale_value numeric,
  cpl numeric, cpql numeric, cac numeric, roas numeric, roi numeric
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_read_marketing_money() then
    raise exception 'لفريق التسويق والمالية';
  end if;
  if p_dim not in ('campaign', 'channel', 'project', 'activity', 'influencer', 'content',
                   'vendor', 'category', 'month', 'employee', 'landing') then
    raise exception 'بُعد غير معروف: %', p_dim;
  end if;

  return query
  with costs as (
    select case p_dim
             when 'campaign'   then f.campaign_id::text
             when 'channel'    then f.channel_id::text
             when 'project'    then f.project_id::text
             when 'activity'   then f.activity_id::text
             when 'influencer' then f.influencer_deal_id::text
             when 'vendor'     then f.vendor_id::text
             when 'category'   then f.category
             when 'month'      then to_char(f.cost_date, 'YYYY-MM')
             when 'employee'   then f.owner_employee_id::text
           end as k,
           sum(f.amount) as cost, sum(f.amount) filter (where f.is_ad) as ad
      from public.mkt_cost_facts(p_from, p_to) f
     where (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  leads as (
    select case p_dim
             when 'campaign'   then f.campaign_id::text
             when 'channel'    then f.channel_id::text
             when 'project'    then f.project_id::text
             when 'activity'   then f.activity_id::text
             when 'influencer' then f.influencer_deal_id::text
             when 'content'    then f.content_id::text
             when 'landing'    then f.landing_page_id::text
             when 'month'      then to_char(f.created_on, 'YYYY-MM')
             when 'employee'   then f.owner_employee_id::text
           end as k,
           count(*) as leads, count(*) filter (where f.qualified) as qualified,
           count(*) filter (where f.reserved) as reserved
      from public.mkt_lead_facts(p_from, p_to) f
     where p_dim not in ('vendor', 'category')
       and f.is_marketing
       and (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  sales as (
    select case p_dim
             when 'campaign'   then a.campaign_id::text
             when 'channel'    then a.channel_id::text
             when 'project'    then a.project_id::text
             when 'activity'   then a.activity_id::text
             when 'influencer' then a.influencer_deal_id::text
             when 'content'    then a.content_id::text
             when 'month'      then to_char(a.sale_date, 'YYYY-MM')
             when 'employee'   then (select cp.owner_employee_id::text from public.crm_campaigns cp where cp.id = a.campaign_id)
           end as k,
           sum(a.weight) as sales, sum(a.weight * a.commission) as commission,
           sum(a.weight * a.deal_amount) as sale_value
      from public.mkt_attributed_sales(p_model, p_from, p_to) a
     where p_dim not in ('vendor', 'category', 'landing')
       and a.touch_type <> 'خارج التسويق'
       and (p_project is null or a.project_id = p_project)
       and (p_campaign is null or a.campaign_id = p_campaign)
       and (p_channel is null or a.channel_id = p_channel)
     group by 1
  ),
  metrics as (
    select case p_dim
             when 'campaign'   then d.campaign_id::text
             when 'channel'    then d.channel_id::text
             when 'project'    then cp.project_id::text
             when 'activity'   then case when d.entity_type = 'نشاط' then d.entity_id::text end
             when 'influencer' then case when d.entity_type = 'مؤثر' then d.entity_id::text end
             when 'content'    then coalesce(case when d.entity_type = 'محتوى' then d.entity_id::text end,
                                             (select ao.content_id::text from public.mkt_ad_objects ao
                                               where d.entity_type = 'إعلان' and ao.id = d.entity_id))
             when 'landing'    then case when d.entity_type = 'صفحة هبوط' then d.entity_id::text end
             when 'month'      then to_char(d.metric_date, 'YYYY-MM')
             when 'employee'   then cp.owner_employee_id::text
           end as k,
           sum(d.spend) as spend, sum(d.impressions)::bigint as impressions, sum(d.clicks)::bigint as clicks
      from public.mkt_metrics_daily d
      left join public.crm_campaigns cp on cp.id = d.campaign_id
     where p_dim not in ('vendor', 'category')
       and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب')
       and (p_from is null or d.metric_date >= p_from) and (p_to is null or d.metric_date <= p_to)
       and (p_project is null or cp.project_id = p_project)
       and (p_campaign is null or d.campaign_id = p_campaign)
       and (p_channel is null or d.channel_id = p_channel)
     group by 1
  ),
  keys as (
    select k from costs union select k from leads union select k from sales union select k from metrics
  ),
  j as (
    select ky.k,
           coalesce(c.cost, 0) as cost, coalesce(c.ad, 0) as ad, coalesce(m.spend, 0) as pspend,
           coalesce(m.impressions, 0) as impressions, coalesce(m.clicks, 0) as clicks,
           coalesce(l.leads, 0) as leads, coalesce(l.qualified, 0) as qualified,
           coalesce(l.reserved, 0) as reserved,
           coalesce(s.sales, 0) as sales, coalesce(s.commission, 0) as commission,
           coalesce(s.sale_value, 0) as sale_value
      from keys ky
      left join costs c   on c.k is not distinct from ky.k
      left join leads l   on l.k is not distinct from ky.k
      left join sales s   on s.k is not distinct from ky.k
      left join metrics m on m.k is not distinct from ky.k
  )
  select j.k,
         case
           when j.k is null then case p_dim when 'month' then '—' else 'غير منسوب' end
           when p_dim = 'campaign'   then (select name from public.crm_campaigns where id = j.k::uuid)
           when p_dim = 'channel'    then (select name from public.mkt_channels where id = j.k::uuid)
           when p_dim = 'project'    then (select name from public.projects where id = j.k::uuid)
           when p_dim = 'activity'   then (select title from public.mkt_activities where id = j.k::uuid)
           when p_dim = 'influencer' then (select i.name || coalesce(' — ' || cp.name, '')
                                             from public.mkt_influencer_deals d
                                             join public.mkt_influencers i on i.id = d.influencer_id
                                             left join public.crm_campaigns cp on cp.id = d.campaign_id
                                            where d.id = j.k::uuid)
           when p_dim = 'content'    then (select title from public.mkt_content where id = j.k::uuid)
           when p_dim = 'vendor'     then (select name from public.suppliers where id = j.k::uuid)
           when p_dim = 'employee'   then (select full_name from public.employees where id = j.k::uuid)
           when p_dim = 'landing'    then (select title from public.mkt_landing_pages where id = j.k::uuid)
           else j.k
         end,
         j.cost, j.ad, j.pspend, j.impressions, j.clicks, j.leads, j.qualified, j.reserved,
         round(j.sales, 2), round(j.commission), round(j.sale_value),
         case when j.leads > 0 and j.cost > 0 then round(j.cost / j.leads) end,
         case when j.qualified > 0 and j.cost > 0 then round(j.cost / j.qualified) end,
         case when j.sales > 0 and j.cost > 0 then round(j.cost / j.sales) end,
         case when j.ad > 0 then round(j.commission / j.ad, 2) end,
         case when j.cost > 0 then round((j.commission - j.cost) * 100.0 / j.cost, 1) end
    from j
   order by case when p_dim = 'month' then j.k end desc nulls last,
            j.commission desc, j.leads desc, j.cost desc;
end;
$fn$;

revoke all on function public.mkt_breakdown(text, date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_breakdown(text, date, date, uuid, uuid, uuid, text) to authenticated;

create or replace function public.mkt_trend(
  p_grain text default 'month', p_from date default null, p_to date default null,
  p_project uuid default null, p_campaign uuid default null, p_channel uuid default null
) returns table (period date, cost numeric, leads bigint, qualified bigint, sales numeric, commission numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare v_from date; v_to date := coalesce(p_to, (now() at time zone 'Asia/Baghdad')::date);
begin
  if not public.can_read_marketing_money() then raise exception 'لفريق التسويق والمالية'; end if;
  if p_grain not in ('day', 'week', 'month') then raise exception 'الدقّة: day أو week أو month'; end if;
  v_from := coalesce(p_from, v_to - case p_grain when 'day' then 29 when 'week' then 83 else 364 end);

  return query
  with periods as (
    select generate_series(date_trunc(p_grain, v_from::timestamp), date_trunc(p_grain, v_to::timestamp),
                           ('1 ' || p_grain)::interval)::date as p
  ),
  c as (
    select date_trunc(p_grain, f.cost_date::timestamp)::date as p, sum(f.amount) as cost
      from public.mkt_cost_facts(v_from, v_to) f
     where (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  l as (
    select date_trunc(p_grain, f.created_on::timestamp)::date as p,
           count(*) as leads, count(*) filter (where f.qualified) as qualified
      from public.mkt_lead_facts(v_from, v_to) f
     where f.is_marketing
       and (p_project is null or f.project_id = p_project)
       and (p_campaign is null or f.campaign_id = p_campaign)
       and (p_channel is null or f.channel_id = p_channel)
     group by 1
  ),
  s as (
    select date_trunc(p_grain, a.sale_date::timestamp)::date as p,
           sum(a.weight) as sales, sum(a.weight * a.commission) as commission
      from public.mkt_attributed_sales('last', v_from, v_to) a
     where a.touch_type <> 'خارج التسويق'
       and (p_project is null or a.project_id = p_project)
       and (p_campaign is null or a.campaign_id = p_campaign)
       and (p_channel is null or a.channel_id = p_channel)
     group by 1
  )
  select periods.p, coalesce(c.cost, 0), coalesce(l.leads, 0), coalesce(l.qualified, 0),
         round(coalesce(s.sales, 0), 2), round(coalesce(s.commission, 0))
    from periods
    left join c on c.p = periods.p
    left join l on l.p = periods.p
    left join s on s.p = periods.p
   order by periods.p;
end;
$fn$;

revoke all on function public.mkt_trend(text, date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.mkt_trend(text, date, date, uuid, uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 7) Following up marketing leads — per sales employee
--
-- Marketing doesn't read clients (092), but it needs to know: did its leads reach anyone?
-- And who sat on them? Totals per responsible employee — names of staff, not of clients.
-- ------------------------------------------------------------
create or replace function public.mkt_lead_followup(
  p_from date default null, p_to date default null, p_campaign uuid default null, p_stale_days int default 2
) returns table (
  employee_id uuid, employee_name text, leads bigint, contacted bigint, stale bigint,
  qualified bigint, reserved bigint, sold bigint, contact_rate numeric
)
language sql stable security definer set search_path = public as $$
  select c.owner_id, coalesce(e.full_name, 'بلا مسؤول'),
         count(*),
         count(*) filter (where f.contacted),
         count(*) filter (where not f.contacted and public.is_open_stage(c.stage)
                            and c.created_at < now() - make_interval(days => greatest(coalesce(p_stale_days, 2), 0))),
         count(*) filter (where f.qualified),
         count(*) filter (where f.reserved),
         count(*) filter (where f.sold),
         round(count(*) filter (where f.contacted) * 100.0 / nullif(count(*), 0), 1)
    from public.mkt_lead_facts(p_from, p_to) f
    join public.clients c on c.id = f.client_id
    left join public.employees e on e.id = c.owner_id
   where public.can_read_marketing_money()
     and f.is_marketing
     and (p_campaign is null or f.campaign_id = p_campaign)
   group by c.owner_id, e.full_name
   order by count(*) filter (where not f.contacted and public.is_open_stage(c.stage)
                               and c.created_at < now() - make_interval(days => greatest(coalesce(p_stale_days, 2), 0))) desc,
            count(*) desc;
$$;

revoke all on function public.mkt_lead_followup(date, date, uuid, int) from public, anon;
grant execute on function public.mkt_lead_followup(date, date, uuid, int) to authenticated;


-- ------------------------------------------------------------
-- 8) The landing page: an image and a WhatsApp button
-- ------------------------------------------------------------
alter table public.mkt_landing_pages
  add column if not exists hero_image_url text,
  add column if not exists whatsapp_phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_landing_hero_url') then
    alter table public.mkt_landing_pages add constraint mkt_landing_hero_url
      check (hero_image_url is null or hero_image_url ~ '^https://');
  end if;
end $$;

create or replace function public.mkt_landing_public(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', lp.slug, 'title', lp.title, 'headline', lp.headline, 'body', lp.body,
    'cta', lp.cta, 'thank_you', lp.thank_you,
    'ask_budget', lp.ask_budget, 'ask_timeline', lp.ask_timeline,
    'hero_image_url', lp.hero_image_url,
    -- WhatsApp in international format without a plus: 07XXXXXXXXX ← 9647XXXXXXXXX
    'whatsapp', case when public.normalize_iraqi_phone(lp.whatsapp_phone) is not null
                     then '964' || right(public.normalize_iraqi_phone(lp.whatsapp_phone), 10) end,
    'project', case when lp.show_project_facts and p.id is not null then jsonb_build_object(
        'name', p.name, 'governorate', p.governorate, 'area', p.area,
        'available', (select count(*) from public.units u where u.project_id = p.id and u.status = 'متاحة'),
        'types', (select jsonb_agg(distinct u.unit_type) from public.units u
                   where u.project_id = p.id and u.status = 'متاحة' and u.unit_type is not null),
        'min_space', (select min(u.space_m2) from public.units u where u.project_id = p.id and u.status = 'متاحة'),
        'max_space', (select max(u.space_m2) from public.units u where u.project_id = p.id and u.status = 'متاحة'),
        'min_price', (select min(u.price) from public.units u where u.project_id = p.id and u.status = 'متاحة' and u.price > 0))
      end)
    from public.mkt_landing_pages lp
    left join public.projects p on p.id = lp.project_id
   where lp.slug = lower(public.mkt_clean_token(p_slug, 61)) and lp.status = 'منشورة' and lp.hosted;
$$;

revoke all on function public.mkt_landing_public(text) from public;
grant execute on function public.mkt_landing_public(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 9) Meta form leads: the touchpoint carries its ad
--
-- The edge function meta-leads writes in raw.mkt the ad (ad_object_id) — and the touchpoint inherits
-- from it the campaign and the channel by its existing trigger (mkt_stamp_touchpoint).
-- ------------------------------------------------------------
create or replace function public.mkt_intake_touchpoint()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  m jsonb := coalesce(new.raw->'mkt', '{}'::jsonb);
  v_utm jsonb := coalesce(new.raw->'utm', new.raw);
  v_camp uuid; v_ch uuid; v_vis text;
begin
  if new.client_id is null or new.status not in ('مُحوَّل', 'مكرّر')
     or old.status = new.status then
    return null;
  end if;
  begin
    v_camp := coalesce((m->>'campaign_id')::uuid,
                       (select id from public.crm_campaigns where name = new.campaign_ref limit 1));
    v_ch := coalesce((m->>'channel_id')::uuid,
                     (select c.id from public.mkt_channels c
                       where c.utm_source = lower(coalesce(v_utm->>'utm_source',
                               case new.provider when 'meta' then 'facebook' when 'tiktok' then 'tiktok'
                                                 when 'google' then 'google' when 'website' then 'website'
                                                 when 'whatsapp' then 'whatsapp' when 'landing' then 'landing' end))
                       order by (c.utm_medium = lower(coalesce(v_utm->>'utm_medium', new.medium, ''))) desc, c.sort_order
                       limit 1));

    insert into public.mkt_touchpoints
      (client_id, occurred_at, touch_type, campaign_id, channel_id, medium, content_ref,
       link_id, landing_page_id, ad_object_id, utm, intake_id, is_conversion, created_by)
    values (new.client_id, new.received_at,
            case when new.provider in ('landing', 'meta') then 'نموذج' else 'استقبال' end,
            v_camp, v_ch, new.medium, new.content,
            (m->>'link_id')::uuid, (m->>'landing_page_id')::uuid, (m->>'ad_object_id')::uuid,
            case when jsonb_typeof(v_utm) = 'object' then v_utm end,
            new.id, new.status = 'مُحوَّل', null)
    on conflict (intake_id) do nothing;

    v_vis := m->>'visitor';
    if v_vis is not null then
      insert into public.mkt_touchpoints
        (client_id, occurred_at, touch_type, link_id, landing_page_id, hit_id, created_by)
      select new.client_id, h.hit_at,
             case h.kind when 'مسح' then 'مسح QR' when 'نقرة' then 'نقرة إعلان' else 'زيارة صفحة' end,
             h.link_id, h.landing_page_id, h.id, null
        from public.mkt_link_hits h
       where h.visitor = v_vis and h.hit_at <= new.received_at
         and h.hit_at > new.received_at - interval '90 days'
         and h.kind in ('نقرة', 'مسح')
      on conflict (hit_id) do nothing;
    end if;
  exception when others then
    insert into public.mkt_event_errors (source, message, context)
    values ('mkt_intake_touchpoint', sqlerrm, jsonb_build_object('intake', new.id, 'client', new.client_id));
  end;
  return null;
end;
$fn$;

revoke all on function public.mkt_intake_touchpoint() from public, anon, authenticated;

-- The Facebook page whose form leads this integration receives (meta-leads picks the integration by it)
alter table public.mkt_integrations add column if not exists page_ref text;
comment on column public.mkt_integrations.page_ref is
  'معرّف صفحة فيسبوك لليدات النماذج الفورية (meta-leads). مفتاح التكامل رمز صفحة بصلاحية leads_retrieval.';


-- ------------------------------------------------------------
-- 10) The expense invoice — finance sees it before paying
--
-- The invoice is an asset in the private marketing bucket (asset_type = 'فاتورة') attached to the expense
-- (invoice_asset_id). The accountant reads the marketing money and doesn't read its library: he's
-- allowed the invoice of an expense alone — the row and the file — not every asset.
-- ------------------------------------------------------------
drop policy if exists "finance reads expense invoices" on public.mkt_assets;
create policy "finance reads expense invoices" on public.mkt_assets
  for select to authenticated
  using ((select public.can_read_marketing_money())
         and exists (select 1 from public.mkt_expenses e where e.invoice_asset_id = mkt_assets.id));

drop policy if exists "finance reads expense invoice files" on storage.objects;
create policy "finance reads expense invoice files" on storage.objects
  for select to authenticated
  using (bucket_id = 'marketing-assets'
         and (select public.can_read_marketing_money())
         and exists (select 1 from public.mkt_assets a
                       join public.mkt_expenses e on e.invoice_asset_id = a.id
                      where a.storage_path = storage.objects.name));


-- ------------------------------------------------------------
-- 11) Verification
-- ------------------------------------------------------------
do $$
declare n_team int; n_fb int;
begin
  raise notice '--- 195 التسويق ٦ — سدّ النواقص ---';
  select count(*) into n_team from public.mkt_team where source = 'الموارد البشرية' and is_active;
  raise notice 'أعضاء الفريق من الموارد البشرية: %', n_team;
  select count(*) into n_fb from public.mkt_channels where is_fallback;
  raise notice 'قنوات «غير محدّدة» للمصادر: %', n_fb;
  if not exists (select 1 from public.mkt_team where mkt_role = 'مدير التسويق' and is_active) then
    raise notice 'لا «مدير تسويق» فعّال — الموافقات تذهب إلى المدير.';
  end if;
end $$;

notify pgrst, 'reload schema';
