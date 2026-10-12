-- ============================================================
-- تلال ERP — 201: الـCRM المتمحور حول العميل — نواة «مسار البيع»
--
-- المرجع: docs/crm-client-centric-migration-plan.md
--
-- القرار: جدول opportunities **هو** مسار البيع (journey). لكل عميل مسار
-- افتراضي يولد معه (083)، ومسار إضافي فقط لنيّة شراء مستقلة. والمرحلة
-- الحالية لها مصدر حقيقة واحد: opportunities.stage_id.
--
-- ما كان قبله: مرآتان متقابلتان — clients.stage يكتب الفرصة
-- (mirror_client_stage_to_opportunity) والفرصة تكتب البطاقة
-- (after_opportunity_stage_change) — وتعملان فقط حين للعميل فرصة واحدة.
--
-- ما بعده:
--   1) clients.stage / current_journey_id / stage_entered_at مرآةٌ باتجاه
--      واحد يكتبها crm_journey_sync_client وحده (علَم tilal.journey_sync).
--      أي كتابة أخرى عليها تُرفض.
--   2) الباب الواحد: crm_move_client_stage(client, stage, reason, journey)
--      بصلاحية سياسة «update own clients» نفسها — لا توسيع.
--   3) قواعد الانتقال في الحارس guard_opportunity_stage فتسري على كل باب:
--      «حجز» بالحجز وحده، الختامية غير التجارية بسبب، لا خروج من «بيع»
--      وعليه بيع مكتمل.
--   4) نوع مرحلة رابع closed («غير مؤهّل»، «تعذّر الوصول») لا يدخل
--      الخسارة التجارية. ومرحلة «حجز» يحرّك إليها الحجز نفسه.
--   5) سجلّ المراحل يحفظ أبعاده يوم الحدث (المالك، المشروع، المصدر،
--      الحملة) ومصدر الانتقال (user/bulk/reservation/lost_form/…) وسببه.
--      وكل مسار يولد بصفّ «دخول أول».
--   6) الحجز يُربط بالمسار دائماً، والإلغاء يُعيد المسار من «حجز».
--   7) bulk_set_stage كان definer بلا فحص صلاحية (postgres يتجاوز RLS):
--      أي مستخدم ينقل أي عميل. الآن يمرّ بالباب الواحد صفّاً صفّاً.
--      ومثله bulk_create_tasks يفحص رؤية العميل.
--
-- آمن لإعادة التشغيل. لا drop column ولا drop table. الترحيل يحفظ
-- إحصاءً قبلياً وبعدياً في crm_journey_migration_runs ويُلغى كله إن بقي
-- فرقٌ بين البطاقة والمسار.
-- الرجوع: sql/rollback_201_client_journey.sql
-- ============================================================

-- ============================================================
-- (أ) المراحل: النوع closed، المعلَم reservation، وأعمدة الإعداد
-- ============================================================
alter table public.crm_stages add column if not exists name_en text;
alter table public.crm_stages add column if not exists requires_reason boolean not null default false;
alter table public.crm_stages add column if not exists is_manual boolean not null default true;
alter table public.crm_stages add column if not exists description text;

comment on column public.crm_stages.requires_reason is
  'الانتقال إليها يتطلّب سبباً مكتوباً (tilal.stage_reason) — الختامية غير التجارية (201).';
comment on column public.crm_stages.is_manual is
  'false = لا يُنقل إليها يدوياً؛ يدخلها المسار بحدث نظامي (حجز ← «حجز») (201).';

alter table public.crm_stages drop constraint if exists crm_stages_stage_type_check;
alter table public.crm_stages add constraint crm_stages_stage_type_check
  check (stage_type in ('open', 'won', 'lost', 'closed'));

alter table public.crm_stages drop constraint if exists crm_stages_milestone_chk;
alter table public.crm_stages add constraint crm_stages_milestone_chk
  check (report_milestone is null
         or report_milestone in ('lead', 'contacted', 'visit', 'offer', 'reservation'));

-- الترتيب: «حجز» بين «مناقشة العرض» و«بيع». المراحل المفتوحة 1–4 لا تتغيّر
-- فتبقى lost_stage_order المجمّدة في الخسائر صحيحة.
update public.crm_stages set sort_order = 6 where name = 'بيع'       and sort_order = 5;
update public.crm_stages set sort_order = 7 where name = 'فشل البيع' and sort_order = 6;

insert into public.crm_stages
  (name, name_en, sort_order, stage_type, probability, requires_activity, required_fields,
   color, is_active, report_milestone, requires_reason, is_manual, description)
select v.name, v.name_en, v.sort_order, v.stage_type, v.probability, false, '{}'::text[],
       v.color, true, v.milestone, v.requires_reason, v.is_manual, v.description
  from (values
    ('حجز',          'Reserved',      5, 'open',   90, 'bg-teal-100 text-teal-700',     'reservation', false, false,
     'وحدة محجوزة للعميل ولم يكتمل البيع. يدخلها المسار بتسجيل الحجز ويغادرها بالبيع أو الإلغاء.'),
    ('غير مؤهّل',     'Not Qualified', 8, 'closed',  0, 'bg-slate-200 text-slate-700',   null,          true,  true,
     'ليس مشترياً محتملاً (لا ميزانية، لا نيّة، ليس عميلاً عقارياً). ليست خسارة بيع.'),
    ('تعذّر الوصول',  'Unreachable',   9, 'closed',  0, 'bg-orange-100 text-orange-700', null,          true,  true,
     'استُنفدت محاولات الوصول بلا ردّ. ليست خسارة بيع، وتُعاد بسبب إن ردّ.')
  ) as v(name, name_en, sort_order, stage_type, probability, color, milestone, requires_reason, is_manual, description)
 where not exists (select 1 from public.crm_stages s where s.name = v.name);

update public.crm_stages s
   set name_en = v.name_en
  from (values ('ليد', 'Lead'), ('اتصال', 'Contacted'), ('زيارة', 'Visit'),
               ('مناقشة العرض', 'Offer Discussion'), ('بيع', 'Won'), ('فشل البيع', 'Lost')) v(name, name_en)
 where s.name = v.name and s.name_en is null;

-- مسارات الانتقال (تُستعمل فقط إن فُعّل enforce_stage_transitions)
insert into public.crm_stage_transitions (from_stage_id, to_stage_id)
select f.id, t.id
  from public.crm_stages f, public.crm_stages t
 where f.id <> t.id
   and (
        (f.stage_type = 'open' and t.stage_type = 'closed')                       -- إغلاق غير تجاري
     or (f.stage_type = 'closed' and t.stage_type = 'open' and t.is_manual)       -- إعادة فتح
     or (f.stage_type = 'open' and t.name = 'حجز')                                -- الحجز
     or (f.name = 'حجز' and t.stage_type in ('won', 'lost', 'open'))             -- بيع / خسارة / إلغاء حجز
     or (f.stage_type in ('lost', 'closed', 'won') and t.name = 'حجز')            -- حجزٌ على مسار مغلق
   )
   and not exists (select 1 from public.crm_stage_transitions x
                    where x.from_stage_id = f.id and x.to_stage_id = t.id);

-- ============================================================
-- (ب) الأعمدة: البطاقة تعرف مسارها الحالي، والسجلّ يحفظ أبعاده
-- ============================================================
alter table public.clients add column if not exists current_journey_id uuid
  references public.opportunities(id) on delete set null;
alter table public.clients add column if not exists stage_entered_at timestamptz;
create index if not exists clients_current_journey_idx on public.clients(current_journey_id);

comment on column public.clients.stage is
  'مرآة باتجاه واحد لمرحلة المسار الحالي (201). لا تُكتب مباشرة — crm_move_client_stage.';
comment on column public.clients.current_journey_id is
  'المسار الحالي: أحدث مسار مفتوح وإلا أحدث مسار (= is_primary في crm_state_as_of). يكتبه crm_journey_sync_client وحده (201).';
comment on column public.clients.stage_entered_at is
  'متى دخل المسار الحالي مرحلته — مرآة opportunities.stage_entered_at (201).';

alter table public.opportunity_stage_history add column if not exists owner_id uuid;
alter table public.opportunity_stage_history add column if not exists project_id uuid;
alter table public.opportunity_stage_history add column if not exists source_id uuid;
alter table public.opportunity_stage_history add column if not exists campaign_id uuid;
alter table public.opportunity_stage_history add column if not exists change_source text;
alter table public.opportunity_stage_history add column if not exists corrects_id uuid
  references public.opportunity_stage_history(id) on delete set null;

comment on column public.opportunity_stage_history.owner_id is
  'مالك المسار لحظة الانتقال — مجمَّد. للصفوف قبل 201 من crm_event_facts وإلا فارغ (غير معروف).';
comment on column public.opportunity_stage_history.change_source is
  'created | user | bulk | reservation | lost_form | reactivation | merge | system | import | migration | legacy (قبل 201).';
comment on column public.opportunity_stage_history.note is
  'سبب الانتقال إن كُتب (tilal.stage_reason) — إلزامي للختامية غير التجارية ولإعادة الفتح منها.';
comment on column public.opportunity_stage_history.corrects_id is
  'صفّ تصحيح: يشير إلى الانتقال الذي يصحّحه. السجلّ لا يُعدَّل، يُصحَّح بصفّ جديد.';

create index if not exists osh_opportunity_at_idx on public.opportunity_stage_history(opportunity_id, at);

-- ============================================================
-- (ج) سجلّ الترحيل
-- ============================================================
create table if not exists public.crm_journey_migration_runs (
  id      bigserial primary key,
  phase   text not null,
  at      timestamptz not null default now(),
  counts  jsonb not null
);
alter table public.crm_journey_migration_runs enable row level security;
drop policy if exists "admin reads journey migration runs" on public.crm_journey_migration_runs;
create policy "admin reads journey migration runs" on public.crm_journey_migration_runs
  for select using ((select public.is_admin()));

-- ============================================================
-- (د) التعريف الواحد: المسار الحالي، والمزامنة، والفرق
-- ============================================================
create or replace function public.crm_current_journey(p_client_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  -- نفس ترتيب is_primary في crm_state_as_of — تعريفٌ واحد لا اثنان
  select o.id
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id = p_client_id and o.deleted_at is null
   order by (g.stage_type = 'open') desc, o.created_at desc, o.id desc
   limit 1;
$$;

create or replace function public.crm_journey_sync_client(p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_stage text;
  v_at    timestamptz;
begin
  if p_client_id is null then return; end if;

  select o.id, g.name, o.stage_entered_at
    into v_id, v_stage, v_at
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id = p_client_id and o.deleted_at is null
   order by (g.stage_type = 'open') desc, o.created_at desc, o.id desc
   limit 1;

  -- عميل بلا مسار: لا نخترع مرحلة — crm_journey_drift() يكشفه
  if v_id is null then return; end if;

  perform set_config('tilal.journey_sync', 'on', true);
  update public.clients c
     set stage = v_stage, current_journey_id = v_id, stage_entered_at = v_at
   where c.id = p_client_id
     and (c.stage is distinct from v_stage
          or c.current_journey_id is distinct from v_id
          or c.stage_entered_at is distinct from v_at);
  perform set_config('tilal.journey_sync', '', true);
end $$;

comment on function public.crm_journey_sync_client(uuid) is
  'الاتجاه الواحد: المسار الحالي ← البطاقة (stage, current_journey_id, stage_entered_at). الكاتب الوحيد لهذه الأعمدة (201).';

create or replace function public.crm_journey_drift()
returns table(client_id uuid, issue text, card_stage text, journey_id uuid, journey_stage text)
language sql stable security definer set search_path = public as $$
  with cur as (
    select distinct on (o.client_id) o.client_id, o.id, g.name
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null
     order by o.client_id, (g.stage_type = 'open') desc, o.created_at desc, o.id desc
  )
  select c.id,
         case when cur.id is null then 'no_journey'
              when c.stage is distinct from cur.name then 'stage_mismatch'
              else 'pointer_mismatch' end,
         c.stage, cur.id, cur.name
    from public.clients c
    left join cur on cur.client_id = c.id
   where c.deleted_at is null
     and (cur.id is null
          or c.stage is distinct from cur.name
          or c.current_journey_id is distinct from cur.id)
     and (select public.is_admin() or public.is_followup_manager() or auth.uid() is null);
$$;

comment on function public.crm_journey_drift() is
  'فروق البطاقة عن مسارها الحالي. يجب أن تُرجع صفراً (201). للمدير ومدير المتابعة.';

-- ============================================================
-- (هـ) الحارس على البطاقة: لا كتابة على المرآة إلا من المزامِن
-- ============================================================
create or replace function public.guard_client_journey_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.stage is distinct from old.stage
      or new.current_journey_id is distinct from old.current_journey_id
      or new.stage_entered_at is distinct from old.stage_entered_at)
     and coalesce(current_setting('tilal.journey_sync', true), '') <> 'on'
     and coalesce(current_setting('tilal.merging', true), '') <> 'on' then
    raise exception 'مرحلة العميل تُدار من مسار البيع — انقلها من بطاقة العميل لا بتعديل حقل المرحلة. إن ظهرت هذه الرسالة في شاشة مفتوحة منذ مدة فحدّث الصفحة.'
      using hint = 'crm_move_client_stage';
  end if;
  return new;
end $$;

drop trigger if exists trg_a0_guard_client_journey on public.clients;
create trigger trg_a0_guard_client_journey
  before update of stage, current_journey_id, stage_entered_at on public.clients
  for each row execute function public.guard_client_journey_columns();

-- المرآة المعاكسة والمحفّزات التي حلّ محلّها المسار — تُسقط المحفّزات
-- وتبقى الدوال (للرجوع).
drop trigger if exists trg_mirror_client_stage    on public.clients;  -- البطاقة ← الفرصة
drop trigger if exists trg_client_stage_log       on public.clients;  -- السجلّ يكتبه المسار الآن
drop trigger if exists trg_guard_client_lost_stage on public.clients; -- البطاقة لا تُكتب أصلاً
drop trigger if exists trg_close_client_on_sale   on public.reservations; -- الحجز يحرّك المسار

-- ============================================================
-- (و) محفّزات المسار: الولادة، الانتقال، النقل والحذف
-- ============================================================
create or replace function public.crm_stage_actor()
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 'النظام'
              else coalesce(public.my_employee_name(), public.display_name(auth.uid())) end;
$$;

create or replace function public.crm_stage_change_source(p_journey uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(current_setting('tilal.stage_source', true), ''),
    case when coalesce(current_setting('tilal.merging', true), '') = 'on' then 'merge'
         when coalesce(current_setting('tilal.lost_analysis', true), '') = p_journey::text then 'lost_form'
         when coalesce(current_setting('tilal.reactivation_note', true), '') <> '' then 'reactivation'
         when auth.uid() is null then 'system'
         else 'user' end);
$$;

-- الولادة: صفّ «دخول أول» — بدونه لا يعدّ القمع من وُلد في «اتصال» مباشرة
create or replace function public.journey_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select project_id, original_source_id, campaign_id, owner_id into c
    from public.clients where id = new.client_id;

  insert into public.opportunity_stage_history
    (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage, days_in_from,
     changed_by, changed_by_name, note, at,
     owner_id, project_id, source_id, campaign_id, change_source)
  values
    (new.id, null, new.stage_id, null, (select name from public.crm_stages where id = new.stage_id), null,
     auth.uid(), public.crm_stage_actor(),
     nullif(btrim(coalesce(current_setting('tilal.stage_reason', true), '')), ''),
     coalesce(new.created_at, now()),
     coalesce(new.owner_id, c.owner_id), coalesce(new.project_id, c.project_id),
     coalesce(new.source_id, c.original_source_id), coalesce(new.campaign_id, c.campaign_id),
     coalesce(nullif(current_setting('tilal.stage_source', true), ''), 'created'));

  perform public.crm_journey_sync_client(new.client_id);
  return null;
end $$;

drop trigger if exists trg_journey_created on public.opportunities;
create trigger trg_journey_created
  after insert on public.opportunities
  for each row execute function public.journey_created();

-- الانتقال: سجلّ بأبعاده + سطر في سجلّ التواصل + مزامنة البطاقة.
-- كان يكتب البطاقة فقط لعميلٍ بفرصة واحدة، ويسجّل فقط لغيره.
create or replace function public.after_opportunity_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  from_name text;
  to_name   text;
  actor     text := public.crm_stage_actor();
  rsn       text := nullif(btrim(coalesce(current_setting('tilal.stage_reason', true), '')), '');
  n_live    int;
  c         record;
begin
  if new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  select name into from_name from public.crm_stages where id = old.stage_id;
  select name into to_name   from public.crm_stages where id = new.stage_id;
  select project_id, original_source_id, campaign_id, owner_id into c
    from public.clients where id = new.client_id;

  insert into public.opportunity_stage_history
    (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage,
     days_in_from, changed_by, changed_by_name, note,
     owner_id, project_id, source_id, campaign_id, change_source)
  values
    (new.id, old.stage_id, new.stage_id, from_name, to_name,
     round(extract(epoch from (now() - old.stage_entered_at)) / 86400.0, 2),
     auth.uid(), actor, rsn,
     coalesce(old.owner_id, new.owner_id, c.owner_id),
     coalesce(new.project_id, c.project_id),
     coalesce(new.source_id, c.original_source_id),
     coalesce(new.campaign_id, c.campaign_id),
     public.crm_stage_change_source(new.id));

  -- سطر «تغيير مرحلة» بلا ربط بالمسار عمداً: الربط يحدّث last_activity_at
  -- للمسار (refresh_opportunity_activity) فيُحسب نقل المرحلة «نشاطاً»
  -- ويُخفي الإهمال — وهو ما لم يكن يحدث للبطاقة ذات المسار الواحد.
  select count(*) into n_live from public.opportunities
   where client_id = new.client_id and deleted_at is null;

  insert into public.client_activities
    (client_id, created_by, activity_type, summary, stage_from, stage_to, actor_name)
  values
    (new.client_id, auth.uid(), 'تغيير مرحلة',
     case when n_live > 1 then coalesce(new.title, 'مسار') || ': ' else '' end
       || 'انتقل من «' || coalesce(from_name, '—') || '» إلى «' || coalesce(to_name, '—') || '»'
       || coalesce(' — ' || rsn, ''),
     from_name, to_name, actor);

  perform public.crm_journey_sync_client(new.client_id);
  return null;
end $$;

-- النقل بين البطاقات (الدمج) والحذف الناعم والصلب: البطاقتان تُعاد مزامنتهما
create or replace function public.journey_resync_clients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.crm_journey_sync_client(old.client_id);
    return null;
  end if;
  perform public.crm_journey_sync_client(new.client_id);
  if old.client_id is distinct from new.client_id then
    perform public.crm_journey_sync_client(old.client_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_journey_resync on public.opportunities;
create trigger trg_journey_resync
  after update of client_id, deleted_at on public.opportunities
  for each row execute function public.journey_resync_clients();

drop trigger if exists trg_journey_resync_del on public.opportunities;
create trigger trg_journey_resync_del
  after delete on public.opportunities
  for each row execute function public.journey_resync_clients();

-- ============================================================
-- (ز) قواعد الانتقال في الحارس — تسري على كل باب
-- ============================================================
create or replace function public.guard_opportunity_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g        public.crm_stages%rowtype;
  gf       public.crm_stages%rowtype;
  fld      text;
  allowed  boolean;
  merging  boolean := coalesce(current_setting('tilal.merging', true), '') = 'on';
  src      text := coalesce(nullif(current_setting('tilal.stage_source', true), ''), '');
  rsn      text := nullif(btrim(coalesce(current_setting('tilal.stage_reason', true), '')), '');
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select * into g  from public.crm_stages where id = new.stage_id;
  select * into gf from public.crm_stages where id = old.stage_id;

  if not g.is_active then
    raise exception 'المرحلة «%» موقوفة ولا يُنقل إليها.', g.name;
  end if;

  if not merging then
    -- «حجز» وأمثالها: يدخلها المسار بالحدث نفسه لا بالنقل
    if not g.is_manual and src <> 'reservation' then
      raise exception 'مرحلة «%» يدخلها العميل بتسجيل الحجز نفسه — احجز الوحدة من ملفّ العميل (تبويب العقار).', g.name
        using hint = 'reserve_unit';
    end if;

    -- الختامية غير التجارية بسببٍ مكتوب
    if g.requires_reason and rsn is null then
      raise exception 'اكتب سبب نقل العميل إلى «%» — الإغلاق بلا سبب لا يُفهم بعد شهر.', g.name
        using hint = 'stage_reason';
    end if;

    -- العودة من إغلاق غير تجاري بسبب
    if gf.stage_type = 'closed' and g.stage_type = 'open' and rsn is null then
      raise exception 'اكتب سبب إعادة فتح مسار العميل من «%».', gf.name
        using hint = 'stage_reason';
    end if;

    -- لا خروج من «بيع» وعلى المسار بيعٌ مكتمل: الإلغاء يعكس العمولة والقيود
    if gf.stage_type = 'won' and g.stage_type <> 'won'
       and exists (select 1 from public.reservations r
                    where r.opportunity_id = new.id and r.status = 'بيع مكتمل') then
      raise exception 'على هذا المسار بيعٌ مكتمل — يُلغى البيع من الحجوزات (الإلغاء يعكس العمولة والقيود) ولا تُنقل مرحلته يدوياً.'
        using hint = 'cancel_sale';
    end if;
  end if;

  if public.crm_setting_int('enforce_stage_transitions', 0) = 1 and not merging then
    select exists (
      select 1 from public.crm_stage_transitions t
       where t.from_stage_id = old.stage_id and t.to_stage_id = new.stage_id
    ) into allowed;
    if not allowed then
      raise exception 'الانتقال من «%» إلى «%» غير مسموح في مسار المبيعات.', gf.name, g.name;
    end if;
  end if;

  if public.crm_setting_int('enforce_stage_required_fields', 1) = 1 then
    foreach fld in array g.required_fields loop
      if fld = 'lost_reason_id' and new.lost_reason_id is null then
        raise exception 'لا تُغلق الصفقة كفاشلة بلا سبب — اختر سبب الفشل.';
      elsif fld = 'project_id' and new.project_id is null then
        raise exception 'مرحلة «%» تتطلّب تحديد المشروع.', g.name;
      elsif fld = 'unit_id' and new.unit_id is null then
        raise exception 'مرحلة «%» تتطلّب تحديد الوحدة.', g.name;
      elsif fld = 'expected_value' and coalesce(new.expected_value, 0) <= 0 then
        raise exception 'مرحلة «%» تتطلّب قيمة الصفقة.', g.name;
      elsif fld = 'budget' and new.budget_min is null and new.budget_max is null then
        raise exception 'مرحلة «%» تتطلّب ميزانية العميل.', g.name;
      end if;
    end loop;
  end if;

  if new.lost_reason_id is not null
     and exists (select 1 from public.crm_lost_reasons r
                  where r.id = new.lost_reason_id and r.requires_note)
     and coalesce(btrim(new.lost_note), '') = '' then
    raise exception 'سبب الفشل المختار يتطلّب توضيحاً مكتوباً.';
  end if;

  return new;
end $$;

-- الإغلاق غير التجاري يختم closed_at ويُفرغ الخطوة القادمة كالربح والخسارة
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.prepare_opportunity()'::regprocedure);
  if position($q$('won', 'lost', 'closed')$q$ in d) = 0 then
    d2 := replace(d, $q$if g.stage_type in ('won', 'lost') then$q$,
                     $q$if g.stage_type in ('won', 'lost', 'closed') then$q$);
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في prepare_opportunity'; end if;
    execute d2;
  end if;
end $patch$;

-- ============================================================
-- (ح) الأبواب: الانتقال، المسار الإضافي، الضمان، الصلاحية
-- ============================================================

-- الصلاحية = سياسة «update own clients» حرفياً — لا توسيع ولا تضييق
create or replace function public.crm_can_move_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id and c.deleted_at is null
       and (public.is_admin()
            or c.created_by = auth.uid()
            or (c.owner_id is not null and c.owner_id in (select s.id from public.my_scope_employees() s))
            or (c.sales_employee is not null
                and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
            or (c.broker_company_id is not null and c.broker_company_id = public.my_broker_company())
            or (c.broker_company_id is not null
                and c.broker_company_id in (select m.company_id from public.my_rm_companies() m)))
  );
$$;

comment on function public.crm_can_move_client(uuid) is
  'من ينقل مرحلة العميل = من يملك تعديل بطاقته (سياسة update own clients نفسها) (201).';

-- نداء من SQL مباشرة (المحرّر، الاختبارات، المهامّ المجدولة) لا من الواجهة البرمجية
create or replace function public.crm_is_system_call()
returns boolean language sql stable set search_path = public as $$
  select auth.uid() is null
     and coalesce(nullif(current_setting('request.jwt.claims', true), ''), 'null') = 'null';
$$;

create or replace function public.crm_resolve_stage(p_stage text)
returns public.crm_stages language sql stable security definer set search_path = public as $$
  -- CASE لا OR: الترتيب مضمون فلا يُجرَّب تحويل «ليد» إلى uuid
  select g.* from public.crm_stages g
   where g.name = btrim(p_stage)
      or g.id = case when btrim(p_stage) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then btrim(p_stage)::uuid end
   limit 1;
$$;

-- الضمان: عميل بلا مسار (لا يُفترض — 083) يُنشأ له مساره من مرحلة بطاقته
create or replace function public.crm_ensure_journey(p_client_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  j uuid := public.crm_current_journey(p_client_id);
  c public.clients%rowtype;
  g uuid;
begin
  if j is not null then return j; end if;
  select * into c from public.clients where id = p_client_id;
  if c.id is null then raise exception 'العميل غير موجود.'; end if;
  select id into g from public.crm_stages where name = coalesce(c.stage, 'ليد');
  if g is null then
    select id into g from public.crm_stages where stage_type = 'open' and is_active order by sort_order limit 1;
  end if;
  perform set_config('tilal.stage_source', 'system', true);
  insert into public.opportunities (client_id, project_id, owner_id, stage_id, stage_entered_at, notes)
  values (c.id, c.project_id, c.owner_id, g, now(), 'المسار الافتراضي — أُنشئ عند أول انتقال (201).')
  returning id into j;
  perform set_config('tilal.stage_source', '', true);
  return j;
end $$;

-- التنفيذ الداخلي: لا فحص صلاحية هنا (الأبواب العامة تفحص قبله)
create or replace function public.crm_journey_apply_stage(p_journey_id uuid, p_stage_id uuid,
                                                          p_reason text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('tilal.stage_source', coalesce(p_source, 'user'), true);
  perform set_config('tilal.stage_reason', coalesce(btrim(p_reason), ''), true);
  update public.opportunities set stage_id = p_stage_id where id = p_journey_id;
  perform set_config('tilal.stage_source', '', true);
  perform set_config('tilal.stage_reason', '', true);
end $$;

create or replace function public.crm_move_client_stage(
  p_client_id  uuid,
  p_stage      text,
  p_reason     text default null,
  p_journey_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g   public.crm_stages%rowtype;
  gf  public.crm_stages%rowtype;
  j   public.opportunities%rowtype;
  jid uuid;
  sys boolean := public.crm_is_system_call();
  src text := coalesce(nullif(current_setting('tilal.stage_source', true), ''), 'user');
begin
  if not sys and not public.crm_can_move_client(p_client_id) then
    raise exception 'لا تملك نقل مرحلة هذا العميل.' using errcode = '42501';
  end if;

  g := public.crm_resolve_stage(p_stage);
  if g.id is null then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  if p_journey_id is not null then
    select * into j from public.opportunities
     where id = p_journey_id and client_id = p_client_id and deleted_at is null;
    if j.id is null then raise exception 'المسار لا يخصّ هذا العميل.'; end if;
  else
    jid := public.crm_ensure_journey(p_client_id);
    select * into j from public.opportunities where id = jid;
  end if;

  select * into gf from public.crm_stages where id = j.stage_id;
  if g.id = gf.id then
    return jsonb_build_object('journey_id', j.id, 'from', gf.name, 'to', g.name, 'changed', false);
  end if;

  -- الوسيط يتابع ولا يُغلق (guard_broker_stage)
  if not sys and public.is_broker() and g.stage_type <> 'open' then
    raise exception 'إغلاق الليد (بيع أو فشل أو إغلاق) قرار تلال — سجّل تواصلك وتابع الصفقة معنا';
  end if;

  if g.stage_type = 'lost' then
    raise exception 'الخسارة تُسجَّل بنموذج «تحليل سبب فقدان فرصة البيع».'
      using hint = 'close_opportunity_lost';
  end if;

  if gf.stage_type = 'lost' then
    raise exception 'العميل في «%» — أعِد تنشيطه بسبب العودة وموعد الخطوة القادمة.', gf.name
      using hint = 'reactivate_lost_opportunity';
  end if;

  if gf.stage_type = 'won' and g.stage_type <> 'won' then
    if exists (select 1 from public.reservations r
                where r.opportunity_id = j.id and r.status = 'بيع مكتمل') then
      raise exception 'على هذا المسار بيعٌ مكتمل — يُلغى البيع من الحجوزات ولا تُنقل مرحلته.'
        using hint = 'cancel_sale';
    end if;
    if not sys and not public.is_admin() then
      raise exception 'العميل اشترى — لشراءٍ جديد افتح «مسار شراء إضافي»، وتصحيح «بيع» خاطئ للمدير.'
        using hint = 'start_journey';
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'اكتب سبب تصحيح «بيع».' using hint = 'stage_reason';
    end if;
  end if;

  perform public.crm_journey_apply_stage(j.id, g.id, p_reason, src);

  return jsonb_build_object(
    'journey_id', j.id, 'from', gf.name, 'to', g.name, 'changed', true,
    'client_stage', (select stage from public.clients where id = p_client_id));
end $$;

comment on function public.crm_move_client_stage(uuid, text, text, uuid) is
  'الباب الواحد لنقل مرحلة العميل: ينقل مساره الحالي (أو المحدَّد). الخسارة بنموذجها، والعودة منها بإعادة التنشيط (201).';

create or replace function public.crm_start_journey(
  p_client_id  uuid,
  p_note       text,
  p_project_id uuid default null,
  p_unit_id    uuid default null,
  p_stage      text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c   public.clients%rowtype;
  g   public.crm_stages%rowtype;
  jid uuid;
begin
  if not public.crm_is_system_call() and not public.crm_can_move_client(p_client_id) then
    raise exception 'لا تملك فتح مسار لهذا العميل.' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_note)), 0) < 5 then
    raise exception 'اكتب سبب فتح مسار شراء إضافي (٥ أحرف على الأقل) — المسار الإضافي لنيّة شراء مستقلة لا للمتابعة اليومية.';
  end if;
  select * into c from public.clients where id = p_client_id and deleted_at is null;
  if c.id is null then raise exception 'العميل غير موجود.'; end if;

  if exists (select 1 from public.opportunities o join public.crm_stages s on s.id = o.stage_id
              where o.client_id = p_client_id and o.deleted_at is null and s.stage_type = 'open'
                and (p_project_id is null or o.project_id is null or o.project_id = p_project_id)) then
    raise exception 'للعميل مسار مفتوح — تابعه من بطاقته. المسار الإضافي لمشروع آخر أو لشراء بعد بيع.';
  end if;

  if p_stage is not null then
    g := public.crm_resolve_stage(p_stage);
    if g.id is null or g.stage_type <> 'open' or not g.is_manual or not g.is_active then
      raise exception 'المسار الإضافي يبدأ بمرحلة مفتوحة.';
    end if;
  else
    select * into g from public.crm_stages where stage_type = 'open' and is_active and is_manual
     order by sort_order limit 1;
  end if;

  perform set_config('tilal.stage_source', 'user', true);
  perform set_config('tilal.stage_reason', btrim(p_note), true);
  insert into public.opportunities
    (client_id, project_id, unit_id, owner_id, stage_id, stage_entered_at, notes, created_by)
  values
    (c.id, p_project_id, p_unit_id, c.owner_id, g.id, now(), btrim(p_note), auth.uid())
  returning id into jid;
  perform set_config('tilal.stage_source', '', true);
  perform set_config('tilal.stage_reason', '', true);
  return jid;
end $$;

comment on function public.crm_start_journey(uuid, text, uuid, uuid, text) is
  'مسار شراء إضافي — لنيّة شراء مستقلة فقط (مشروع آخر أو شراء بعد بيع). لا مسار إجباري ولا صوري (201).';

-- ============================================================
-- (ط) الإجراء الجماعي: الباب نفسه صفّاً صفّاً
-- ============================================================
drop function if exists public.bulk_set_stage(uuid[], text);
create or replace function public.bulk_set_stage(p_client_ids uuid[], p_stage text, p_reason text default null)
returns table(succeeded integer, failed integer, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid   uuid;
  g     public.crm_stages%rowtype;
  n_ok  int := 0;
  n_bad int := 0;
  err   text;
  r     jsonb;
begin
  g := public.crm_resolve_stage(p_stage);
  if g.id is null then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;
  if not g.is_active then
    raise exception 'المرحلة «%» موقوفة.', p_stage;
  end if;
  if g.stage_type = 'lost' or array_length(g.required_fields, 1) is not null then
    raise exception 'المرحلة «%» تُحلَّل لكل عميل — تُنقل واحداً واحداً لا جملةً.', p_stage;
  end if;
  if not g.is_manual then
    raise exception 'المرحلة «%» يدخلها العميل بحدث (الحجز) لا بالنقل.', p_stage;
  end if;
  if g.requires_reason and coalesce(btrim(p_reason), '') = '' then
    raise exception 'المرحلة «%» تتطلّب سبباً — اكتبه مرة للدفعة.', p_stage;
  end if;
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;

  foreach cid in array p_client_ids loop
    begin
      perform set_config('tilal.stage_source', 'bulk', true);
      r := public.crm_move_client_stage(cid, g.name, p_reason, null);
      perform set_config('tilal.stage_source', '', true);
      if coalesce((r->>'changed')::boolean, false) then n_ok := n_ok + 1; else n_bad := n_bad + 1; end if;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

-- bulk_create_tasks كان يُنشئ مهمة على أي عميل لأي مستخدم (definer بلا فحص)
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.bulk_create_tasks'::regproc);
  if position('crm_can_task_client' in d) = 0 and position('can_see_client(cid)' in d) = 0 then
    d2 := replace(d, $q$      select e.user_id into owner_u$q$,
$q$      if not (public.is_admin() or public.is_followup_manager() or public.can_see_client(cid)) then
        raise exception 'لا ترى هذا العميل.';
      end if;
      select e.user_id into owner_u$q$);
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في bulk_create_tasks'; end if;
    execute d2;
  end if;
end $patch$;

-- ============================================================
-- (ي) الحجز ← المسار
-- ============================================================

-- الربط: الحجز يُربط دائماً بمسار. مفتوحٌ إن وُجد؛ وإلا المسار الحالي
-- (خاسرٌ أو مغلقٌ يُعاد فتحه بالحجز)؛ وعميلٌ اشترى سابقاً يُفتح له مسار
-- شراء جديد — الحجز الثاني ليس «بيعاً» على المسار الأول.
create or replace function public.link_reservation_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cur   uuid;
  t     text;
  first_open uuid;
begin
  if new.opportunity_id is not null then
    return new;
  end if;

  select o.id into new.opportunity_id
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id = new.client_id and o.deleted_at is null and g.stage_type = 'open'
   order by o.created_at desc
   limit 1;
  if new.opportunity_id is not null then return new; end if;

  cur := public.crm_current_journey(new.client_id);
  if cur is not null then
    select g.stage_type into t from public.opportunities o join public.crm_stages g on g.id = o.stage_id where o.id = cur;
  end if;

  if cur is not null and t <> 'won' then
    new.opportunity_id := cur;            -- خاسر/مغلق: يُعاد فتحه إلى «حجز» بعد الإدراج
    return new;
  end if;

  -- بلا مسار، أو اشترى سابقاً: مسار جديد
  select id into first_open from public.crm_stages
   where stage_type = 'open' and is_active and is_manual order by sort_order desc limit 1;
  perform set_config('tilal.stage_source', 'reservation', true);
  perform set_config('tilal.stage_reason', 'مسار شراء جديد — حجز وحدة', true);
  insert into public.opportunities (client_id, unit_id, owner_id, stage_id, stage_entered_at, notes)
  select new.client_id, new.unit_id, c.owner_id, first_open, now(), 'مسار شراء أُنشئ بالحجز (201).'
    from public.clients c where c.id = new.client_id
  returning id into new.opportunity_id;
  perform set_config('tilal.stage_source', '', true);
  perform set_config('tilal.stage_reason', '', true);
  return new;
end $$;

create or replace function public.sync_opportunity_from_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o         public.opportunities%rowtype;
  g_cur     public.crm_stages%rowtype;
  won_id    uuid;
  res_id    uuid;
  back_id   uuid;
  proj_id   uuid;
  ucode     text;
begin
  if new.opportunity_id is null then
    return null;
  end if;

  select * into o from public.opportunities where id = new.opportunity_id;
  if o.id is null then return null; end if;

  select project_id, unit_code into proj_id, ucode from public.units where id = new.unit_id;

  update public.opportunities
     set unit_id        = coalesce(unit_id, new.unit_id),
         project_id     = coalesce(project_id, proj_id),
         expected_value = coalesce(new.sale_price, expected_value)
   where id = o.id;

  insert into public.client_activities
    (client_id, opportunity_id, activity_type, summary, actor_name)
  values
    (new.client_id, o.id, 'حجز',
     case when tg_op = 'INSERT' then 'حجز وحدة — ' else 'تحديث حجز — ' end
     || coalesce(new.status, ''),
     coalesce(public.my_employee_name(), 'النظام'));

  select * into o from public.opportunities where id = new.opportunity_id;
  select * into g_cur from public.crm_stages where id = o.stage_id;
  select id into res_id from public.crm_stages where name = 'حجز';
  select id into won_id from public.crm_stages where stage_type = 'won' order by sort_order limit 1;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'حجز' and res_id is not null and o.stage_id <> res_id and g_cur.stage_type <> 'won' then
    -- خاسرٌ يعود بالحجز: الخسارة تبقى «أُعيد تنشيطها» بسببها
    if g_cur.stage_type = 'lost' then
      perform set_config('tilal.reactivation_note', 'عاد العميل بحجز وحدة ' || coalesce(ucode, ''), true);
    end if;
    perform public.crm_journey_apply_stage(o.id, res_id, 'حجز وحدة ' || coalesce(ucode, ''), 'reservation');
    perform set_config('tilal.reactivation_note', '', true);

  elsif new.status = 'بيع مكتمل' and won_id is not null and o.stage_id <> won_id then
    perform set_config('tilal.stage_source', 'reservation', true);
    perform set_config('tilal.stage_reason', 'بيع مكتمل ' || coalesce(ucode, ''), true);
    if g_cur.stage_type = 'lost' then
      perform set_config('tilal.reactivation_note', 'استُرجع ببيع مكتمل ' || coalesce(ucode, ''), true);
    end if;
    update public.opportunities
       set stage_id  = won_id,
           won_value = coalesce(new.sale_price, expected_value)
     where id = o.id;
    perform set_config('tilal.stage_source', '', true);
    perform set_config('tilal.stage_reason', '', true);
    perform set_config('tilal.reactivation_note', '', true);

  elsif new.status = 'ملغى' and tg_op = 'UPDATE'
        and (o.stage_id = res_id or g_cur.stage_type = 'won')
        and not exists (select 1 from public.reservations r
                         where r.opportunity_id = o.id and r.id <> new.id
                           and r.status in ('حجز', 'بيع مكتمل')) then
    -- الإلغاء: المسار يعود إلى ما كان عليه قبل «حجز»، وإلا «مناقشة العرض»
    select h.from_stage_id into back_id
      from public.opportunity_stage_history h
      join public.crm_stages s on s.id = h.from_stage_id
     where h.opportunity_id = o.id and h.to_stage_id = res_id and s.stage_type = 'open'
     order by h.at desc limit 1;
    if back_id is null then
      select id into back_id from public.crm_stages
       where stage_type = 'open' and is_manual and is_active and id <> coalesce(res_id, id)
       order by sort_order desc limit 1;
    end if;
    perform public.crm_journey_apply_stage(o.id, back_id,
      case when g_cur.stage_type = 'won' then 'إلغاء البيع ' else 'إلغاء الحجز ' end || coalesce(ucode, ''),
      'reservation');
  end if;

  return null;
end $$;

-- ============================================================
-- (ك) الأحداث والقمع والتقارير بالنوع الجديد closed
-- ============================================================
do $patch$
declare d text; d2 text;
begin
  -- نوع الحدث: الإغلاق غير التجاري «closed» لا «progression»، والعودة منه «reopened»
  d := pg_get_functiondef('public.crm_fact_sync_stage(uuid, boolean)'::regprocedure);
  if position($q$then 'closed'$q$ in d) = 0 then
    d2 := regexp_replace(d, $q$(when gt\.stage_type = 'lost'\s+then 'lost')$q$,
                            E'\\1\n           when gt.stage_type = ''closed''                          then ''closed''');
    d2 := regexp_replace(d2, $q$when gf\.stage_type in \('won', 'lost'\)(\s+)then 'reopened'$q$,
                             $q$when gf.stage_type in ('won', 'lost', 'closed')\1then 'reopened'$q$);
    d2 := regexp_replace(d2, $q$case when gt\.stage_type in \('won', 'lost'\)(\s+)then round$q$,
                             $q$case when gt.stage_type in ('won', 'lost', 'closed')\1then round$q$);
    if position($q$then 'closed'$q$ in d2) = 0 or position($q$('won', 'lost', 'closed')$q$ in d2) = 0 then
      raise exception '201: لم يُعثر على مواضع الترقيع في crm_fact_sync_stage';
    end if;
    execute d2;
  end if;

  -- القمع: المغلق غير التجاري يصل حتى آخر مرحلة مفتوحة بلغها — كالخاسر
  d := pg_get_functiondef('public.crm_funnel(date, date, uuid, uuid, uuid)'::regprocedure);
  if position($q$('lost', 'closed')$q$ in d) = 0 then
    d2 := replace(d, $q$when f0.stage_type = 'lost' then$q$, $q$when f0.stage_type in ('lost', 'closed') then$q$);
    d2 := replace(d2, $q$f.stage_type <> 'lost'$q$, $q$f.stage_type not in ('lost', 'closed')$q$);
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في crm_funnel'; end if;
    execute d2;
  end if;

  -- التسويق: الليد المغلق غير التجاري ليس «نشطاً» كالخاسر
  d := pg_get_functiondef('public.mkt_lead_facts'::regproc);
  if position($q$('lost', 'closed')$q$ in d) = 0 then
    d2 := replace(d, $q$g.stage_type <> 'lost'$q$, $q$g.stage_type not in ('lost', 'closed')$q$);
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في mkt_lead_facts'; end if;
    execute d2;
  end if;

  -- تاريخ مبيعات العميل: المغلق غير التجاري بعدّاده
  d := pg_get_functiondef('public.crm_client_sales_history'::regproc);
  if position($q$'closed', (select count(*)$q$ in d) = 0 then
    d2 := regexp_replace(d, $q$('open',\s+\(select count\(\*\) from o where stage_type = 'open'\),)$q$,
                            E'\\1\n    ''closed'', (select count(*) from o where stage_type = ''closed''),');
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في crm_client_sales_history'; end if;
    execute d2;
  end if;
end $patch$;

-- ============================================================
-- (ل) الدمج: البطاقة الباقية تُزامَن مع مسارها في آخر الدمج
--     (اختيار «المرحلة» في الدمج يحرّك المسار الوحيد كما كان؛ ومع عدة
--      مسارات تتبع البطاقة مسارها الحالي)
-- ============================================================
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.merge_clients(uuid, uuid, text[])'::regprocedure);
  if position('crm_journey_sync_client' in d) = 0 then
    d2 := replace(d, $q$  return moved || jsonb_build_object('kept_id', p_keep_id);$q$,
$q$  -- 201: البطاقة مرآة مسارها الحالي
  perform public.crm_journey_sync_client(p_keep_id);

  return moved || jsonb_build_object('kept_id', p_keep_id);$q$);
    if d2 = d then raise exception '201: لم يُعثر على موضع الترقيع في merge_clients'; end if;
    execute d2;
  end if;
end $patch$;

-- ============================================================
-- (م) الصلاحيات على الدوال
-- ============================================================
revoke all on function public.crm_current_journey(uuid)               from public, anon;
revoke all on function public.crm_journey_sync_client(uuid)           from public, anon, authenticated;
revoke all on function public.crm_journey_apply_stage(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_ensure_journey(uuid)                from public, anon, authenticated;
revoke all on function public.crm_journey_drift()                     from public, anon;
revoke all on function public.crm_move_client_stage(uuid, text, text, uuid) from public, anon;
revoke all on function public.crm_start_journey(uuid, text, uuid, uuid, text) from public, anon;
revoke all on function public.bulk_set_stage(uuid[], text, text)      from public, anon;
revoke all on function public.crm_can_move_client(uuid)               from public, anon;

grant execute on function public.crm_move_client_stage(uuid, text, text, uuid)  to authenticated;
grant execute on function public.crm_start_journey(uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.bulk_set_stage(uuid[], text, text)       to authenticated;
grant execute on function public.crm_can_move_client(uuid)                to authenticated;
grant execute on function public.crm_journey_drift()                      to authenticated;
grant execute on function public.crm_current_journey(uuid)                to authenticated;
grant execute on function public.crm_is_system_call()                     to authenticated;
grant execute on function public.crm_stage_change_source(uuid)            to authenticated;

-- ============================================================
-- (ن) ترحيل البيانات
-- ============================================================
create or replace function public.crm_journey_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clients',            (select count(*) from public.clients where deleted_at is null),
    'journeys',           (select count(*) from public.opportunities where deleted_at is null),
    'clients_no_journey', (select count(*) from public.clients c where c.deleted_at is null
                             and not exists (select 1 from public.opportunities o
                                              where o.client_id = c.id and o.deleted_at is null)),
    'clients_multi',      (select count(*) from (select client_id from public.opportunities
                                                  where deleted_at is null group by client_id having count(*) > 1) x),
    'card_stages',        (select jsonb_object_agg(coalesce(stage, '∅'), n) from
                             (select stage, count(*) n from public.clients where deleted_at is null group by stage) x),
    'journey_types',      (select jsonb_object_agg(stage_type, n) from
                             (select g.stage_type, count(*) n from public.opportunities o
                                join public.crm_stages g on g.id = o.stage_id
                               where o.deleted_at is null group by g.stage_type) x),
    'lost_rows',          (select count(*) from public.crm_lost_sales),
    'lost_by_outcome',    (select jsonb_object_agg(outcome, n) from
                             (select outcome, count(*) n from public.crm_lost_sales group by outcome) x),
    'reservations',       (select count(*) from public.reservations),
    'reservations_unlinked', (select count(*) from public.reservations where opportunity_id is null),
    'completed_sales',    (select count(*) from public.reservations where status = 'بيع مكتمل'),
    'sale_commissions',   (select count(*) from public.sale_commissions),
    'stage_history',      (select count(*) from public.opportunity_stage_history),
    'journeys_without_initial', (select count(*) from public.opportunities o where o.deleted_at is null
                                   and not exists (select 1 from public.opportunity_stage_history h
                                                    where h.opportunity_id = o.id and h.from_stage_id is null)),
    'facts',              (select count(*) from public.crm_event_facts),
    'drift',              (select count(*) from public.crm_journey_drift())
  )
  -- أرقام الشركة كلها: للمدير وللنداء من SQL مباشرة
  where (select public.is_admin() or auth.uid() is null);
$$;
revoke all on function public.crm_journey_counts() from public, anon;
grant execute on function public.crm_journey_counts() to authenticated;

do $migrate$
declare
  r      record;
  n_init int := 0;
  n_dims int := 0;
  n_link int := 0;
  n_sync int := 0;
  drift  int;
begin
  -- لا يُعاد الترحيل إن سبق (السجلّ يحمل «after» ناجحاً)
  if exists (select 1 from public.crm_journey_migration_runs where phase = '201:after') then
    raise notice '201: الترحيل سبق — يُتخطّى.';
    return;
  end if;

  insert into public.crm_journey_migration_runs (phase, counts)
  values ('201:before', public.crm_journey_counts());

  -- 1) صفّ «دخول أول» لكل مسار يفتقده — مستنتَج حتمياً من التاريخ الموجود:
  --    المرحلة = from_stage لأول انتقال، وإلا المرحلة الحالية؛ الوقت = إنشاء المسار.
  alter table public.opportunity_stage_history disable trigger trg_crm_fact;
  for r in
    select o.id, o.created_at, o.stage_id, o.owner_id, o.project_id, o.source_id, o.campaign_id,
           (select h.from_stage_id from public.opportunity_stage_history h
             where h.opportunity_id = o.id order by h.at, h.id limit 1) as first_from
      from public.opportunities o
     where not exists (select 1 from public.opportunity_stage_history h
                        where h.opportunity_id = o.id and h.from_stage_id is null)
  loop
    insert into public.opportunity_stage_history
      (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage, days_in_from,
       changed_by, changed_by_name, note, at, owner_id, project_id, source_id, campaign_id, change_source)
    values
      (r.id, null, coalesce(r.first_from, r.stage_id), null,
       (select name from public.crm_stages where id = coalesce(r.first_from, r.stage_id)), null,
       null, 'ترحيل 201', 'دخول أول مُستنتَج من تاريخ المسار (201)', r.created_at,
       r.owner_id, r.project_id, r.source_id, r.campaign_id, 'migration');
    n_init := n_init + 1;
  end loop;
  alter table public.opportunity_stage_history enable trigger trg_crm_fact;

  -- أحداثها بعلَم is_backfilled — كما تُعبّأ الأحداث التاريخية
  for r in select h.id from public.opportunity_stage_history h
            where h.change_source = 'migration'
              and not exists (select 1 from public.crm_event_facts f
                               where f.source_table = 'opportunity_stage_history' and f.source_id = h.id)
  loop
    perform public.crm_fact_sync_stage(r.id, true);
  end loop;

  -- 2) أبعاد الصفوف القديمة من الأحداث المجمّدة يوم وقوعها
  update public.opportunity_stage_history h
     set owner_id    = coalesce(h.owner_id, f.owner_id),
         project_id  = coalesce(h.project_id, f.project_id),
         source_id   = coalesce(h.source_id, f.source_id_dim),
         campaign_id = coalesce(h.campaign_id, f.campaign_id),
         change_source = coalesce(h.change_source, 'legacy')
    from public.crm_event_facts f
   where f.source_table = 'opportunity_stage_history' and f.source_id = h.id
     and f.event_type = 'stage_change'
     and h.change_source is distinct from 'migration'
     and (h.change_source is null or h.owner_id is null);
  get diagnostics n_dims = row_count;
  update public.opportunity_stage_history set change_source = 'legacy' where change_source is null;

  -- 3) الحجوزات بلا مسار تُربط بمسار عميلها الحالي
  update public.reservations r
     set opportunity_id = public.crm_current_journey(r.client_id)
   where r.opportunity_id is null
     and public.crm_current_journey(r.client_id) is not null;
  get diagnostics n_link = row_count;

  -- 4) البطاقات: المسار الحالي ووقت دخول مرحلته (عمودان مشتقّان — بلا تدقيق صفّي)
  alter table public.clients disable trigger trg_audit_clients;
  for r in select c.id from public.clients c loop
    perform public.crm_journey_sync_client(r.id);
    n_sync := n_sync + 1;
  end loop;
  alter table public.clients enable trigger trg_audit_clients;

  select count(*) into drift from public.crm_journey_drift();
  if drift > 0 then
    raise exception '201: بقي % فرقاً بين البطاقة ومسارها بعد الترحيل — أُلغي كل شيء.', drift;
  end if;

  insert into public.crm_journey_migration_runs (phase, counts)
  values ('201:after', public.crm_journey_counts()
                       || jsonb_build_object('initial_rows_added', n_init, 'history_dims_filled', n_dims,
                                             'reservations_linked', n_link, 'clients_synced', n_sync));

  raise notice '201: دخول أول % · أبعاد % · حجوزات رُبطت % · بطاقات % · فروق %',
    n_init, n_dims, n_link, n_sync, drift;
end $migrate$;

-- ===== التحقّق =====
do $$
declare v jsonb;
begin
  v := public.crm_journey_counts();
  raise notice '201: %', v;
  if (v->>'drift')::int <> 0 then raise warning '201: فروق البطاقة/المسار: %', v->>'drift'; end if;
  if (v->>'clients_no_journey')::int <> 0 then raise warning '201: عملاء بلا مسار: %', v->>'clients_no_journey'; end if;
  if (v->>'reservations_unlinked')::int <> 0 then raise warning '201: حجوزات بلا مسار: %', v->>'reservations_unlinked'; end if;
end $$;
