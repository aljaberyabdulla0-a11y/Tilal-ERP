-- ============================================================
-- تلال ERP — 079: الحملات وإسناد المصدر
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- في شاشة التقارير: «سوشيل ميديا — ١١٥ عميلاً، بيعتان، ٤٪».
-- والسؤال الذي لا تجيب عنه: **كم دفعنا مقابل هاتين البيعتين؟**
--
-- بلا الكلفة لا معنى للمقارنة. مصدرٌ يجيب ١١٥ ليداً بمليون دينار
-- أفضل من مصدر يجيب ٣٨ بخمسة ملايين، والعمودان الظاهران اليوم
-- لا يقولان ذلك.
--
-- ومشكلة ثانية أدقّ: `clients.source` حقل **واحد**. وعميل رأى
-- إعلاناً على إنستغرام ثم جاء بترشيح صديق مصدرُه واحدٌ في القاعدة
-- واثنان في الواقع. فيُنسَب البيع كله إلى آخر من لمسه، ويُحرَم
-- الإعلانُ الذي صنع الوعي من أثره — فتُقطع ميزانيته وتجفّ القناة.
--
-- ============================================================
-- المبدأ الحاكم
--
--     لمستان تُحفظان: التي جاءت به، والتي أغلقته.
--
--   original_source  أول لمسة — من أين عرفنا؟   (تُكتب مرة ولا تتغيّر)
--   latest_source    آخر لمسة — من أين عاد؟     (تُحدَّث عند كل تحوّل)
--
-- والإسناد يُعرَض بالطريقتين معاً لا بواحدة: الأولى تقيس بناء
-- الطلب، والثانية تقيس إغلاق الصفقة، وكلٌّ منهما يموّل قراراً مختلفاً.
--
-- ============================================================
-- ما يضيفه
--
--   1) crm_campaigns        — الحملة بكلفتها ومدّتها
--   2) إسناد اللمستين على clients و opportunities
--   3) crm_lead_intake      — بوّابة استقبال الليدات الخارجية
--   4) intake_lead()        — الإدخال بالتطبيع وكشف التكرار
--   5) crm_campaign_performance() — CPL و CPQL و CAC و ROI
--   6) crm_attribution()    — المقارنة بين أول لمسة وآخرها
--
-- ⚠️ لا موصّلات Meta/Google/TikTok في هذا الملف. تُبنى **البوّابة**
--    فقط: جدولٌ يستقبل وصفوفٌ تُطبَّع وتُحوَّل إلى عملاء. ربطُ مزوّد
--    يحتاج مفاتيحه وعقده وسياسة خصوصيته، ولا يُفترَض شيء من ذلك.
--
-- يتطلب: sql/070 و 071 و 072 و 076. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الحملات
-- ------------------------------------------------------------
create table if not exists public.crm_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  source_id   uuid references public.crm_sources(id) on delete set null,
  project_id  uuid references public.projects(id)    on delete set null,
  medium      text,                  -- إعلان مدفوع | عضوي | بريد | رسائل | فعالية
  content     text,                  -- تمييز الإبداع/الإعلان داخل الحملة
  start_date  date,
  end_date    date,
  budget      numeric check (budget is null or budget >= 0),
  spent       numeric check (spent  is null or spent  >= 0),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  constraint crm_campaigns_dates check (end_date is null or start_date is null
                                        or end_date >= start_date)
);

comment on column public.crm_campaigns.spent is
  'المصروف الفعلي. هو مقام كل مقاييس الكلفة — بلا تعبئته تبقى CPL و CAC فارغة لا صفراً.';

create index if not exists crm_campaigns_active_idx
  on public.crm_campaigns (is_active, start_date desc);

-- المفتاح الأجنبي الذي أُجِّل من 072
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'opportunities_campaign_fk') then
    alter table public.opportunities
      add constraint opportunities_campaign_fk
      foreign key (campaign_id) references public.crm_campaigns(id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) إسناد اللمستين
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists original_source_id uuid references public.crm_sources(id) on delete set null,
  add column if not exists latest_source_id   uuid references public.crm_sources(id) on delete set null,
  add column if not exists campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  add column if not exists medium             text,
  add column if not exists content            text,
  add column if not exists first_touch_at     timestamptz,
  add column if not exists qualified_at       timestamptz,
  add column if not exists won_at             timestamptz;

create index if not exists clients_campaign_idx on public.clients (campaign_id)
  where campaign_id is not null;
create index if not exists clients_orig_source_idx on public.clients (original_source_id);

comment on column public.clients.original_source_id is
  'أول لمسة. تُكتب مرة واحدة ولا تتغيّر — وإلا ضاع أثر القناة التي صنعت الوعي.';

-- ترحيل: المصدر النصّي الحالي هو أول لمسة وآخرها معاً
update public.clients c
   set original_source_id = s.id,
       latest_source_id   = coalesce(c.latest_source_id, s.id),
       first_touch_at     = coalesce(c.first_touch_at, c.created_at)
  from public.crm_sources s
 where s.name = btrim(c.source)
   and c.original_source_id is null;

-- ------------------------------------------------------------
-- 3) حارس أول لمسة + ختم لحظات التحوّل
--
-- «متى تأهّل» و«متى ربحنا» لحظتان لا تُستخرجان لاحقاً بدقّة، فتُختمان
-- حين تقعان. بلا ذلك يصير حساب «زمن التأهيل» تخميناً بأثر رجعي.
-- ------------------------------------------------------------
-- الأثر التاريخي: من بيع قبل 079 له won_at من إغلاق فرصته، ومن بلغ
-- درجة التأهيل له qualified_at من لحظة احتسابها — وإلا عميت
-- تقارير الإسناد عن كل ما سبق.
update public.clients c
   set won_at = coalesce(c.won_at, o.closed_at, c.last_contact_at, c.created_at)
  from public.opportunities o
  join public.crm_stages g on g.id = o.stage_id
 where o.client_id = c.id and g.stage_type = 'won' and c.won_at is null;

update public.clients c
   set qualified_at = coalesce(c.qualified_at, s.computed_at)
  from public.crm_lead_scores s
 where s.client_id = c.id and s.score >= 40 and c.qualified_at is null;

create or replace function public.stamp_client_attribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare s_id uuid;
begin
  -- استنتاج المصدر من النصّ حين لم يُمرَّر مفتاحه
  if new.source is not null and btrim(new.source) <> '' then
    select id into s_id from public.crm_sources where name = btrim(new.source);
  end if;

  if tg_op = 'INSERT' then
    new.original_source_id := coalesce(new.original_source_id, s_id);
    new.latest_source_id   := coalesce(new.latest_source_id, s_id, new.original_source_id);
    new.first_touch_at     := coalesce(new.first_touch_at, now());
  else
    -- أول لمسة لا تُعاد كتابتها بعد أن تُسجَّل
    if old.original_source_id is not null then
      new.original_source_id := old.original_source_id;
    else
      new.original_source_id := coalesce(new.original_source_id, s_id);
    end if;

    if new.source is distinct from old.source and s_id is not null then
      new.latest_source_id := s_id;
    end if;

    -- لحظة التأهيل: أول مرة تتجاوز الدرجة العتبة
    if new.lead_score is not null and new.lead_score >= 40
       and coalesce(old.lead_score, 0) < 40 and new.qualified_at is null then
      new.qualified_at := now();
    end if;

    -- لحظة الفوز: أول مرة يدخل مرحلة فائزة
    if new.stage is distinct from old.stage and new.won_at is null
       and exists (select 1 from public.crm_stages g
                    where g.name = new.stage and g.stage_type = 'won') then
      new.won_at := now();
    end if;
  end if;

  return new;
end $$;

-- ⚠️ الاسم يبدأ بـ trg_a ليعمل **قبل** trg_client_owner_sync (071)
--    و trg_z_guard_client_owner — هذا المحفّز لا يمسّ الملكية، فترتيبه
--    أولاً يبقيه خارج نزاع الملكية تماماً.
drop trigger if exists trg_a_client_attribution on public.clients;
create trigger trg_a_client_attribution
  before insert or update on public.clients
  for each row execute function public.stamp_client_attribution();

-- ------------------------------------------------------------
-- 4) بوّابة الاستقبال
--
-- الليد الخارجي لا يدخل clients مباشرة. يدخل هنا خاماً، ثم يُطبَّع
-- ويُفحَص تكراره ويُحوَّل. وبهذا:
--   • الصفّ الخام يبقى كما وصل، فيمكن تشخيص أي خلل في المصدر.
--   • رقمٌ فاسد من مزوّد لا يُفسد جدول العملاء.
--   • إعادة إرسال نفس الليد لا تُنشئ عميلاً ثانياً.
-- ------------------------------------------------------------
create table if not exists public.crm_lead_intake (
  id          uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  provider    text not null,          -- meta | google | tiktok | website | whatsapp | manual | …
  external_id text,                   -- معرّف الليد عند المزوّد — مفتاح عدم التكرار
  raw         jsonb not null,         -- الحمولة كما وصلت، بلا مساس

  name        text,
  phone       text,
  phone_key   text generated always as (public.normalize_iraqi_phone(phone)) stored,
  campaign_ref text,
  source_ref   text,
  medium       text,
  content      text,

  status      text not null default 'جديد'
              check (status in ('جديد','مُحوَّل','مكرّر','مرفوض')),
  client_id   uuid references public.clients(id) on delete set null,
  reject_reason text,
  processed_at  timestamptz,
  unique (provider, external_id)
);

create index if not exists crm_lead_intake_status_idx
  on public.crm_lead_intake (status, received_at desc);
create index if not exists crm_lead_intake_phone_idx
  on public.crm_lead_intake (phone_key) where phone_key is not null;

comment on table public.crm_lead_intake is
  'بوّابة الليدات الخارجية. الخام يبقى خاماً؛ التحويل إلى clients قرارٌ منفصل قابل للمراجعة.';

-- تحويل صفّ استقبال إلى عميل
create or replace function public.intake_lead(p_intake_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  it      public.crm_lead_intake%rowtype;
  dup_id  uuid;
  s_id    uuid;
  camp_id uuid;
  new_id  uuid;
begin
  select * into it from public.crm_lead_intake where id = p_intake_id;
  if it.id is null then
    raise exception 'صفّ الاستقبال غير موجود.';
  end if;
  if it.status <> 'جديد' then
    return it.client_id;   -- عولج سابقاً
  end if;

  -- (أ) رقم غير صالح: يُرفض ولا يُلوّث جدول العملاء
  if it.phone_key is null then
    update public.crm_lead_intake
       set status = 'مرفوض', processed_at = now(),
           reject_reason = 'رقم هاتف غير صالح: ' || coalesce(it.phone, '(فارغ)')
     where id = p_intake_id;
    return null;
  end if;

  -- (ب) تكرار: نربطه بالعميل القائم ونحدّث آخر لمسة فقط
  select id into dup_id from public.clients
   where deleted_at is null and (phone_key = it.phone_key or alt_phone_key = it.phone_key)
   limit 1;

  select id into s_id    from public.crm_sources   where name = btrim(coalesce(it.source_ref, ''));
  select id into camp_id from public.crm_campaigns where name = btrim(coalesce(it.campaign_ref, ''));

  if dup_id is not null then
    update public.clients
       set latest_source_id = coalesce(s_id, latest_source_id),
           campaign_id      = coalesce(campaign_id, camp_id)
     where id = dup_id;

    -- ⚠️ بموعد متابعة اليوم: enforce_activity_followup (sql/028) يرفض
    --    نشاطاً غير نظامي بلا موعد على عميل مفتوح — والعائد يستحقّ
    --    اتصالاً اليوم أصلاً.
    insert into public.client_activities
      (client_id, activity_type, summary, actor_name, next_action, next_action_date)
    values (dup_id, 'ملاحظة',
            'عاد عبر ' || it.provider || coalesce(' — حملة ' || it.campaign_ref, ''),
            'النظام', 'عميل عائد — تواصل اليوم', public.baghdad_today());

    update public.crm_lead_intake
       set status = 'مكرّر', client_id = dup_id, processed_at = now()
     where id = p_intake_id;
    return dup_id;
  end if;

  -- (ج) عميل جديد
  insert into public.clients
    (name, phone, source, original_source_id, latest_source_id, campaign_id,
     medium, content, first_touch_at, stage, notes)
  values
    (coalesce(nullif(btrim(it.name), ''), 'ليد من ' || it.provider),
     it.phone, it.source_ref, s_id, s_id, camp_id,
     it.medium, it.content, it.received_at, 'ليد',
     'استُقبل تلقائياً من ' || it.provider)
  returning id into new_id;

  -- التوزيع بالقواعد إن وُجدت (073) — وإلا بقي بلا مالك ويظهر في اللوحة
  perform public.auto_assign_client(new_id);

  update public.crm_lead_intake
     set status = 'مُحوَّل', client_id = new_id, processed_at = now()
   where id = p_intake_id;

  perform public.refresh_lead_scores(new_id);
  return new_id;
end $$;

create or replace function public.process_lead_intake()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.crm_lead_intake
            where status = 'جديد' order by received_at limit 500
  loop
    perform public.intake_lead(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------
-- 5) أداء الحملة — الكلفة في كل خطوة
--
-- ⚠️ الكلفة تُقسَم على ما وقع فعلاً، وحين لا يقع شيء تبقى NULL لا
--    صفراً. «CAC = 0» يعني اكتساباً مجانياً، والحقيقة أنه لا اكتساب
--    أصلاً — والفرق بينهما قرار ميزانية.
-- ------------------------------------------------------------
create or replace function public.crm_campaign_performance(
  p_from date default null, p_to date default null
) returns table (
  campaign_id   uuid,
  campaign_name text,
  medium        text,
  budget        numeric,
  spent         numeric,
  leads         bigint,
  qualified     bigint,
  opportunities bigint,
  reservations  bigint,
  won           bigint,
  revenue       numeric,
  cost_per_lead      numeric,
  cost_per_qualified numeric,
  cac                numeric,
  roi_pct            numeric
)
language sql stable set search_path = public as $$
  with agg as (
    select cp.id, cp.name, cp.medium, cp.budget, cp.spent,
           count(distinct c.id)                                       as leads,
           count(distinct c.id) filter (where c.qualified_at is not null) as qualified,
           count(distinct o.id)                                       as opps,
           count(distinct r.id)                                       as res,
           count(distinct o.id) filter (where g.stage_type = 'won')   as won,
           coalesce(sum(o.won_value) filter (where g.stage_type = 'won'), 0) as revenue
      from public.crm_campaigns cp
      left join public.clients c on c.campaign_id = cp.id and c.deleted_at is null
           and (p_from is null or c.created_at::date >= p_from)
           and (p_to   is null or c.created_at::date <= p_to)
      left join public.opportunities o on o.client_id = c.id and o.deleted_at is null
      left join public.crm_stages g    on g.id = o.stage_id
      left join public.reservations r  on r.client_id = c.id
     group by cp.id, cp.name, cp.medium, cp.budget, cp.spent
  )
  select a.id, a.name, a.medium, a.budget, a.spent,
         a.leads, a.qualified, a.opps, a.res, a.won, round(a.revenue),
         case when a.leads     > 0 and a.spent is not null then round(a.spent / a.leads) end,
         case when a.qualified > 0 and a.spent is not null then round(a.spent / a.qualified) end,
         case when a.won       > 0 and a.spent is not null then round(a.spent / a.won) end,
         -- ⚠️ الإيراد هنا قيمة الصفقة لا عمولة تلال. الحملة تُقاس
         --    بما جلبته من مبيعات، وربحية تلال منها في محرّك العمولات.
         case when coalesce(a.spent, 0) > 0
              then round((a.revenue - a.spent) * 100.0 / a.spent, 1) end
    from agg a
   order by a.won desc, a.leads desc;
$$;

-- ------------------------------------------------------------
-- 6) المقارنة بين اللمستين
--
-- الفرق بين العمودين هو الرسالة: قناةٌ أولُها كبير وآخرها صغير
-- تبني الطلب ولا تُغلقه — وقطعُها يُجفّف ما بعدها بعد شهرين.
-- ------------------------------------------------------------
create or replace function public.crm_attribution(
  p_from date default null, p_to date default null
) returns table (
  source_name        text,
  first_touch_leads  bigint,
  first_touch_won    bigint,
  last_touch_leads   bigint,
  last_touch_won     bigint,
  builds_demand      boolean    -- أول لمسة أكبر من آخرها بوضوح
)
language sql stable set search_path = public as $$
  with base as (
    select c.id, c.original_source_id, c.latest_source_id,
           (c.won_at is not null) as is_won
      from public.clients c
     where c.deleted_at is null
       and (p_from is null or c.created_at::date >= p_from)
       and (p_to   is null or c.created_at::date <= p_to)
  )
  select s.name,
         count(*) filter (where b.original_source_id = s.id),
         count(*) filter (where b.original_source_id = s.id and b.is_won),
         count(*) filter (where b.latest_source_id   = s.id),
         count(*) filter (where b.latest_source_id   = s.id and b.is_won),
         count(*) filter (where b.original_source_id = s.id)
           > count(*) filter (where b.latest_source_id = s.id) * 1.3
    from public.crm_sources s
    cross join base b
   group by s.id, s.name
  having count(*) filter (where b.original_source_id = s.id) > 0
      or count(*) filter (where b.latest_source_id   = s.id) > 0
   order by count(*) filter (where b.original_source_id = s.id and b.is_won) desc;
$$;

-- ------------------------------------------------------------
-- 7) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_campaigns    enable row level security;
alter table public.crm_lead_intake  enable row level security;

drop policy if exists "read campaigns" on public.crm_campaigns;
create policy "read campaigns" on public.crm_campaigns
  for select to authenticated using (true);

-- الميزانية والمصروف أرقام مالية: الكتابة للإدارة وحدها
drop policy if exists "admin writes campaigns" on public.crm_campaigns;
create policy "admin writes campaigns" on public.crm_campaigns
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read intake" on public.crm_lead_intake;
create policy "read intake" on public.crm_lead_intake
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager()));

drop policy if exists "admin writes intake" on public.crm_lead_intake;
create policy "admin writes intake" on public.crm_lead_intake
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists trg_audit_campaigns on public.crm_campaigns;
create trigger trg_audit_campaigns
  after insert or update or delete on public.crm_campaigns
  for each row execute function public.audit_row();

revoke all on function public.intake_lead(uuid)                       from public;
revoke all on function public.process_lead_intake()                   from public;
revoke all on function public.crm_campaign_performance(date, date)    from public;
revoke all on function public.crm_attribution(date, date)             from public;

grant execute on function public.intake_lead(uuid)                    to authenticated, service_role;
grant execute on function public.process_lead_intake()                to service_role;
grant execute on function public.crm_campaign_performance(date, date) to authenticated, service_role;
grant execute on function public.crm_attribution(date, date)          to authenticated, service_role;

-- ------------------------------------------------------------
-- 8) التحقّق
-- ------------------------------------------------------------
do $$
declare n_src int; n_att int; r record;
begin
  raise notice '--- 079 الحملات وإسناد المصدر ---';

  select count(*) into n_att from public.clients
   where deleted_at is null and original_source_id is not null;
  select count(*) into n_src from public.clients where deleted_at is null;

  raise notice 'عملاء بأول لمسة مُسنَدة: % من %', n_att, n_src;
  if n_att < n_src then
    raise warning 'بلا إسناد: % — مصدرهم النصّي لا يقابل صفّاً في crm_sources.', n_src - n_att;
    raise warning 'أضِف المصدر الناقص إلى crm_sources ثم أعِد تشغيل قسم الترحيل.';
  end if;

  raise notice 'الإسناد بالمصدر (أول لمسة مقابل آخرها):';
  for r in select * from public.crm_attribution() loop
    raise notice '  % — أول: % (بيع %) | آخر: % (بيع %)%',
      r.source_name, r.first_touch_leads, r.first_touch_won,
      r.last_touch_leads, r.last_touch_won,
      case when r.builds_demand then '  ← يبني الطلب' else '' end;
  end loop;

  if not exists (select 1 from public.crm_campaigns) then
    raise notice 'لا حملات بعد. أضِف حملة بمصروفها لتظهر CPL و CAC و ROI —';
    raise notice 'وبلا عمود spent تبقى مقاييس الكلفة فارغة (وهو الصواب، لا صفراً).';
  end if;
end $$;

notify pgrst, 'reload schema';
