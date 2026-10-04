-- ============================================================
-- تلال ERP — 124: التسويق ٣ — التتبّع والإسناد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== السلسلة =====
--
--   إعلان / QR / مؤثر / لوحة
--        │  رابط تتبّع (mkt_tracking_links) — UTM يُولَّد لا يُكتب
--        ▼
--   /r/<code>  ──mkt_track_hit──►  mkt_link_hits (نقرة أو مسح، بمعرّف زائر)
--        │
--        ▼
--   /f/<slug>  ──mkt_submit_lead──►  crm_lead_intake ──intake_lead()──► clients
--                                          │ (محفّز)
--                                          ▼
--                                   mkt_touchpoints  ◄── نقرات الزائر نفسه قبل النموذج
--                                          │            ◄── لمسات يدوية (فعالية، إحالة)
--                                          ▼
--                         mkt_attributed_sales(النموذج) — كل بيعة موزّعة على لمساتها
--
-- ===== لماذا لمسات فوق clients لا بدلاً منها =====
--
-- clients يحمل أول لمسة (original_source_id، campaign_id) وآخرها منذ 079،
-- وتقارير الـCRM كلها عليها. اللمسات **سلسلة** بين الأولى والأخيرة —
-- ما تحتاجه النماذج الخطّية والموضعية والمتناقصة. فتُضاف ولا يُمسّ شيء.
-- وعميلٌ بلا لمسات (كل ما سبق 124) يُقرأ من حقوله: لمسة واحدة مُستنتَجة.
--
-- ===== البوّابة لا تُعاد كتابتها =====
--
-- intake_lead (079) يطابق الحملة والمصدر **بالاسم**. فمحفّزٌ قبل الإدخال
-- يترجم utm_campaign (رمز الحملة) وutm_source إلى الاسمين — فتعمل
-- المطابقة القائمة كما هي، لـMeta وGoogle والموقع ونموذجنا معاً.
--
-- ===== الأمان في الصفحتين العامّتين =====
--
-- /r و/f بلا تسجيل دخول. لا يُمنح anon شيءٌ على الجداول؛ أربع دوالّ
-- definer وحدها، كلٌّ تقبل معاملات محدّدة وتتحقّق منها:
--   mkt_track_hit · mkt_track_view · mkt_landing_public · mkt_submit_lead
-- والنموذج: حقل فخّ للروبوتات، رقم عراقي مُطبَّع أو رفض، ثلاث مرّات
-- للرقم في اليوم، وسقف عامّ في الدقيقة.
--
-- يتطلب: 079، 104، 121. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 0) سجلّ أخطاء المحفّزات — المحفّز لا يُسقط كتابةً أصلية أبداً
-- ------------------------------------------------------------
create table if not exists public.mkt_event_errors (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  source  text not null,
  message text not null,
  context jsonb
);
alter table public.mkt_event_errors enable row level security;
drop policy if exists "read mkt errors" on public.mkt_event_errors;
create policy "read mkt errors" on public.mkt_event_errors
  for select to authenticated using ((select public.is_marketing_manager()));


-- ------------------------------------------------------------
-- 1) صفحات الهبوط
-- ------------------------------------------------------------
create table if not exists public.mkt_landing_pages (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title              text not null,
  hosted             boolean not null default true,
  external_url       text check (external_url is null or external_url ~ '^https?://'),
  project_id         uuid references public.projects(id) on delete set null,
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  channel_id         uuid references public.mkt_channels(id) on delete set null,
  conversion_goal    text not null default 'ليد',
  headline           text,
  body               text,
  cta                text not null default 'سجّل اهتمامك',
  thank_you          text not null default 'وصلنا طلبك — سيتصل بك فريق المبيعات قريباً.',
  show_project_facts boolean not null default true,
  ask_budget         boolean not null default false,
  ask_timeline       boolean not null default false,
  owner_employee_id  uuid references public.employees(id) on delete set null,
  status             text not null default 'مسودة' check (status in ('مسودة', 'منشورة', 'متوقفة')),
  published_at       timestamptz,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint mkt_landing_external check (hosted or external_url is not null)
);

create or replace function public.mkt_stamp_landing()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.slug := lower(btrim(new.slug));
  if new.channel_id is null then
    select id into new.channel_id from public.mkt_channels where utm_source = 'landing' limit 1;
  end if;
  if new.project_id is null and new.campaign_id is not null then
    select project_id into new.project_id from public.crm_campaigns where id = new.campaign_id;
  end if;
  if new.status = 'منشورة' and (tg_op = 'INSERT' or old.status <> 'منشورة') then
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_stamp_landing on public.mkt_landing_pages;
create trigger trg_mkt_stamp_landing
  before insert or update on public.mkt_landing_pages
  for each row execute function public.mkt_stamp_landing();


-- ------------------------------------------------------------
-- 2) روابط التتبّع و QR — UTM موحّد يُولَّد من الحملة والقناة
-- ------------------------------------------------------------
create table if not exists public.mkt_tracking_links (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[a-z0-9]{4,12}$'),
  name               text not null,
  destination_kind   text not null default 'صفحة هبوط' check (destination_kind in (
                       'صفحة هبوط', 'مشروع', 'وحدة', 'واتساب', 'اتصال', 'بروشور', 'نموذج ليد',
                       'حملة', 'رابط خارجي')),
  destination_url    text not null check (destination_url ~ '^(https?://|/|tel:|https://wa\.me/)'),
  channel_id         uuid not null references public.mkt_channels(id) on delete restrict,
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  project_id         uuid references public.projects(id) on delete set null,
  unit_id            uuid references public.units(id) on delete set null,
  activity_id        uuid references public.mkt_activities(id) on delete set null,
  content_id         uuid references public.mkt_content(id) on delete set null,
  influencer_deal_id uuid references public.mkt_influencer_deals(id) on delete set null,
  ad_object_id       uuid references public.mkt_ad_objects(id) on delete set null,
  landing_page_id    uuid references public.mkt_landing_pages(id) on delete set null,
  utm_source         text not null check (utm_source   ~ '^[a-z0-9_.-]+$'),
  utm_medium         text not null check (utm_medium   ~ '^[a-z0-9_.-]+$'),
  utm_campaign       text not null check (utm_campaign ~ '^[a-z0-9_.-]+$'),
  utm_content        text check (utm_content is null or utm_content ~ '^[a-z0-9_.-]+$'),
  utm_term           text check (utm_term is null or utm_term ~ '^[a-z0-9_.+-]+$'),
  is_qr              boolean not null default false,
  is_active          boolean not null default true,
  expires_on         date,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

-- UTM مكرّر يعني رابطين لا يُفرَّق بينهما في التقارير
create unique index if not exists mkt_tracking_links_utm_unique on public.mkt_tracking_links (
  utm_source, utm_medium, utm_campaign, coalesce(utm_content, ''), coalesce(utm_term, ''), destination_url);
create index if not exists mkt_tracking_links_campaign_idx on public.mkt_tracking_links (campaign_id);
create index if not exists mkt_tracking_links_activity_idx on public.mkt_tracking_links (activity_id);

create or replace function public.mkt_stamp_link()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare ch public.mkt_channels%rowtype; v_code text; i int := 0;
begin
  select * into ch from public.mkt_channels where id = new.channel_id;
  new.utm_source := lower(btrim(coalesce(nullif(new.utm_source, ''), ch.utm_source)));
  new.utm_medium := lower(btrim(coalesce(nullif(new.utm_medium, ''), ch.utm_medium)));

  if coalesce(new.utm_campaign, '') = '' then
    select code into new.utm_campaign from public.crm_campaigns where id = new.campaign_id;
    new.utm_campaign := coalesce(new.utm_campaign, 'general');
  end if;
  new.utm_campaign := lower(btrim(new.utm_campaign));

  -- المحتوى يميّز الرابط داخل الحملة: رمز النشاط أو المحتوى أو الإعلان
  if coalesce(new.utm_content, '') = '' then
    new.utm_content := coalesce(
      (select code from public.mkt_activities where id = new.activity_id),
      (select code from public.mkt_content where id = new.content_id),
      (select 'inf-' || left(replace(d.id::text, '-', ''), 6) from public.mkt_influencer_deals d where d.id = new.influencer_deal_id),
      (select 'ad-' || left(replace(a.id::text, '-', ''), 6) from public.mkt_ad_objects a where a.id = new.ad_object_id));
  end if;
  new.utm_content := nullif(lower(btrim(coalesce(new.utm_content, ''))), '');

  if new.project_id is null then
    new.project_id := coalesce(
      (select project_id from public.crm_campaigns where id = new.campaign_id),
      (select project_id from public.mkt_activities where id = new.activity_id),
      (select project_id from public.units where id = new.unit_id));
  end if;

  if tg_op = 'INSERT' and coalesce(new.code, '') = '' then
    loop
      v_code := substr(md5(random()::text || clock_timestamp()::text), 1, 7);
      exit when not exists (select 1 from public.mkt_tracking_links where code = v_code);
      i := i + 1;
      if i > 20 then raise exception 'تعذّر توليد رمز فريد'; end if;
    end loop;
    new.code := v_code;
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'رمز الرابط لا يتغيّر — رموز QR المطبوعة تحمله';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_stamp_link on public.mkt_tracking_links;
create trigger trg_mkt_stamp_link
  before insert or update on public.mkt_tracking_links
  for each row execute function public.mkt_stamp_link();

-- الرابط النهائي بمعاملاته — مكانٌ واحد يُبنى فيه
create or replace function public.mkt_link_url(l public.mkt_tracking_links)
returns text language sql immutable set search_path = public as $$
  select l.destination_url
      || case when l.destination_url like 'tel:%' then ''
              else case when position('?' in l.destination_url) > 0 then '&' else '?' end
                || 'utm_source='   || l.utm_source
                || '&utm_medium='  || l.utm_medium
                || '&utm_campaign='|| l.utm_campaign
                || coalesce('&utm_content=' || l.utm_content, '')
                || coalesce('&utm_term='    || l.utm_term, '')
                || '&mkt_l=' || l.code
         end;
$$;


-- ------------------------------------------------------------
-- 3) النقرات والمسوح والزيارات
-- ------------------------------------------------------------
create table if not exists public.mkt_link_hits (
  id              bigint generated always as identity primary key,
  link_id         uuid references public.mkt_tracking_links(id) on delete cascade,
  landing_page_id uuid references public.mkt_landing_pages(id) on delete cascade,
  kind            text not null check (kind in ('نقرة', 'مسح', 'زيارة')),
  hit_at          timestamptz not null default now(),
  visitor         text,
  device          text check (device in ('جوال', 'حاسوب', 'لوحي', 'غير معروف')),
  referrer_host   text,
  utm             jsonb
);
create index if not exists mkt_link_hits_link_idx    on public.mkt_link_hits (link_id, hit_at);
create index if not exists mkt_link_hits_landing_idx on public.mkt_link_hits (landing_page_id, hit_at);
create index if not exists mkt_link_hits_visitor_idx on public.mkt_link_hits (visitor) where visitor is not null;

create or replace function public.mkt_clean_token(p text, p_len int default 64)
returns text language sql immutable set search_path = public as $$
  select nullif(left(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9_.-]', '', 'g'), p_len), '');
$$;

-- /r/<code>: يسجّل النقرة أو المسح ويُرجع الوجهة بمعاملاتها
create or replace function public.mkt_track_hit(
  p_code text, p_qr boolean default false, p_visitor text default null,
  p_device text default null, p_referrer text default null
) returns text language plpgsql security definer set search_path = public as $fn$
declare l public.mkt_tracking_links%rowtype; v_vis text := public.mkt_clean_token(p_visitor);
begin
  select * into l from public.mkt_tracking_links
   where code = lower(public.mkt_clean_token(p_code, 12)) and is_active
     and (expires_on is null or expires_on >= (now() at time zone 'Asia/Baghdad')::date);
  if not found then return null; end if;

  -- نفس الزائر على نفس الرابط خلال عشر ثوانٍ نقرةٌ واحدة (تحديث الصفحة)
  if v_vis is null or not exists (
       select 1 from public.mkt_link_hits h
        where h.link_id = l.id and h.visitor = v_vis and h.hit_at > now() - interval '10 seconds') then
    insert into public.mkt_link_hits (link_id, landing_page_id, kind, visitor, device, referrer_host)
    values (l.id, l.landing_page_id,
            case when p_qr or l.is_qr then 'مسح' else 'نقرة' end, v_vis,
            case when p_device in ('جوال', 'حاسوب', 'لوحي') then p_device else 'غير معروف' end,
            left(public.mkt_clean_token(p_referrer, 120), 120));
  end if;

  return public.mkt_link_url(l);
end;
$fn$;

-- صفحة الهبوط المستضافة: ما يُعرض للزائر — وحقائق المشروع من الوحدات
-- (عددٌ ومدى، لا وحدةٌ بعينها ولا سعرٌ مخفيّ)
create or replace function public.mkt_landing_public(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', lp.slug, 'title', lp.title, 'headline', lp.headline, 'body', lp.body,
    'cta', lp.cta, 'thank_you', lp.thank_you,
    'ask_budget', lp.ask_budget, 'ask_timeline', lp.ask_timeline,
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

create or replace function public.mkt_track_view(
  p_slug text, p_visitor text default null, p_device text default null,
  p_utm jsonb default null, p_link_code text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_page uuid; v_link uuid; v_vis text := public.mkt_clean_token(p_visitor);
begin
  select id into v_page from public.mkt_landing_pages
   where slug = lower(public.mkt_clean_token(p_slug, 61)) and status = 'منشورة';
  if v_page is null then return; end if;
  select id into v_link from public.mkt_tracking_links where code = lower(public.mkt_clean_token(p_link_code, 12));
  if v_vis is not null and exists (
       select 1 from public.mkt_link_hits where landing_page_id = v_page and visitor = v_vis
          and kind = 'زيارة' and hit_at > now() - interval '30 minutes') then
    return;   -- جلسةٌ واحدة لا زيارات
  end if;
  insert into public.mkt_link_hits (link_id, landing_page_id, kind, visitor, device, utm)
  values (v_link, v_page, 'زيارة', v_vis,
          case when p_device in ('جوال', 'حاسوب', 'لوحي') then p_device else 'غير معروف' end,
          case when jsonb_typeof(p_utm) = 'object' then p_utm end);
end;
$fn$;

-- النموذج العام ← بوّابة الاستقبال ← intake_lead — المسار القائم كما هو
create or replace function public.mkt_submit_lead(
  p_slug text, p_name text, p_phone text, p_visitor text default null,
  p_utm jsonb default null, p_link_code text default null, p_extra jsonb default null,
  p_trap text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  lp public.mkt_landing_pages%rowtype; l public.mkt_tracking_links%rowtype;
  v_key text; v_intake uuid; v_camp public.crm_campaigns%rowtype; v_ch public.mkt_channels%rowtype;
  v_src text; v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_vis text := public.mkt_clean_token(p_visitor);
  v_utm jsonb := case when jsonb_typeof(p_utm) = 'object' then p_utm else '{}'::jsonb end;
begin
  select * into lp from public.mkt_landing_pages
   where slug = lower(public.mkt_clean_token(p_slug, 61)) and status = 'منشورة';
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الصفحة غير متاحة');
  end if;

  -- الروبوت يملأ الحقل المخفي؛ يُقال له «تمّ» ولا يُسجَّل شيء
  if coalesce(btrim(p_trap), '') <> '' then
    return jsonb_build_object('ok', true, 'message', lp.thank_you);
  end if;

  v_key := public.normalize_iraqi_phone(p_phone);
  if v_key is null then
    return jsonb_build_object('ok', false, 'message', 'رقم الهاتف غير صحيح — اكتبه بصيغة 07XXXXXXXXX');
  end if;
  if coalesce(length(btrim(p_name)), 0) not between 2 and 100 then
    return jsonb_build_object('ok', false, 'message', 'اكتب اسمك');
  end if;

  if (select count(*) from public.crm_lead_intake
       where provider = 'landing' and received_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('ok', false, 'message', 'ضغطٌ على الخدمة — حاول بعد دقيقة');
  end if;
  if (select count(*) from public.crm_lead_intake
       where provider = 'landing' and phone_key = v_key and received_at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', true, 'message', lp.thank_you);
  end if;

  select * into l from public.mkt_tracking_links
   where code = lower(public.mkt_clean_token(p_link_code, 12));
  select * into v_camp from public.crm_campaigns
   where id = coalesce(l.campaign_id, lp.campaign_id)
      or (l.id is null and lp.campaign_id is null and code = lower(public.mkt_clean_token(v_utm->>'utm_campaign')))
   limit 1;
  select * into v_ch from public.mkt_channels
   where id = coalesce(l.channel_id,
                       (select c.id from public.mkt_channels c
                         where c.utm_source = lower(v_utm->>'utm_source')
                           and c.utm_medium = lower(coalesce(v_utm->>'utm_medium', c.utm_medium))
                         order by c.sort_order limit 1),
                       lp.channel_id);
  select name into v_src from public.crm_sources where id = v_ch.source_id;

  insert into public.crm_lead_intake
    (provider, external_id, raw, name, phone, campaign_ref, source_ref, medium, content)
  values ('landing',
          'lp:' || lp.slug || ':' || v_key || ':' || v_today,
          jsonb_build_object(
            'page', lp.slug, 'utm', v_utm,
            'extra', case when jsonb_typeof(p_extra) = 'object' then p_extra else '{}'::jsonb end,
            'mkt', jsonb_build_object('link_id', l.id, 'landing_page_id', lp.id, 'visitor', v_vis,
                                      'campaign_id', v_camp.id, 'channel_id', v_ch.id)),
          left(btrim(p_name), 100), p_phone, v_camp.name, v_src,
          coalesce(lower(v_utm->>'utm_medium'), v_ch.utm_medium),
          coalesce(lower(v_utm->>'utm_content'), l.utm_content))
  on conflict (provider, external_id) do nothing
  returning id into v_intake;

  if v_intake is not null then
    perform public.intake_lead(v_intake);
  end if;
  return jsonb_build_object('ok', true, 'message', lp.thank_you);
end;
$fn$;

revoke all on function public.mkt_track_hit(text, boolean, text, text, text) from public;
revoke all on function public.mkt_landing_public(text) from public;
revoke all on function public.mkt_track_view(text, text, text, jsonb, text) from public;
revoke all on function public.mkt_submit_lead(text, text, text, text, jsonb, text, jsonb, text) from public;
grant execute on function public.mkt_track_hit(text, boolean, text, text, text) to anon, authenticated;
grant execute on function public.mkt_landing_public(text) to anon, authenticated;
grant execute on function public.mkt_track_view(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.mkt_submit_lead(text, text, text, text, jsonb, text, jsonb, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4) اللمسات
-- ------------------------------------------------------------
create table if not exists public.mkt_touchpoints (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  occurred_at        timestamptz not null,
  touch_type         text not null check (touch_type in (
                       'نقرة إعلان', 'مسح QR', 'زيارة صفحة', 'نموذج', 'استقبال',
                       'حضور فعالية', 'إحالة', 'مؤثر', 'يدوي')),
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  channel_id         uuid references public.mkt_channels(id) on delete set null,
  source_id          uuid references public.crm_sources(id) on delete set null,
  medium             text,
  content_ref        text,
  link_id            uuid references public.mkt_tracking_links(id) on delete set null,
  landing_page_id    uuid references public.mkt_landing_pages(id) on delete set null,
  activity_id        uuid references public.mkt_activities(id) on delete set null,
  influencer_deal_id uuid references public.mkt_influencer_deals(id) on delete set null,
  ad_object_id       uuid references public.mkt_ad_objects(id) on delete set null,
  content_id         uuid references public.mkt_content(id) on delete set null,
  utm                jsonb,
  intake_id          uuid unique references public.crm_lead_intake(id) on delete set null,
  hit_id             bigint unique references public.mkt_link_hits(id) on delete set null,
  is_conversion      boolean not null default false,
  note               text,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);
create index if not exists mkt_touchpoints_client_idx   on public.mkt_touchpoints (client_id, occurred_at);
create index if not exists mkt_touchpoints_campaign_idx on public.mkt_touchpoints (campaign_id);
create index if not exists mkt_touchpoints_channel_idx  on public.mkt_touchpoints (channel_id);
create index if not exists mkt_touchpoints_activity_idx on public.mkt_touchpoints (activity_id) where activity_id is not null;

-- القناة والمصدر والحملة تُستكمل من الرابط والإعلان والنشاط إن لم تُمرَّر
create or replace function public.mkt_stamp_touchpoint()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare l public.mkt_tracking_links%rowtype;
begin
  if new.link_id is not null then
    select * into l from public.mkt_tracking_links where id = new.link_id;
    new.campaign_id        := coalesce(new.campaign_id, l.campaign_id);
    new.channel_id         := coalesce(new.channel_id, l.channel_id);
    new.activity_id        := coalesce(new.activity_id, l.activity_id);
    new.content_id         := coalesce(new.content_id, l.content_id);
    new.influencer_deal_id := coalesce(new.influencer_deal_id, l.influencer_deal_id);
    new.ad_object_id       := coalesce(new.ad_object_id, l.ad_object_id);
    new.landing_page_id    := coalesce(new.landing_page_id, l.landing_page_id);
  end if;
  if new.ad_object_id is not null then
    select coalesce(new.campaign_id, a.campaign_id), coalesce(new.channel_id, ac.channel_id)
      into new.campaign_id, new.channel_id
      from public.mkt_ad_objects a join public.mkt_accounts ac on ac.id = a.account_id
     where a.id = new.ad_object_id;
  end if;
  if new.activity_id is not null then
    select coalesce(new.campaign_id, a.campaign_id), coalesce(new.channel_id, a.channel_id)
      into new.campaign_id, new.channel_id
      from public.mkt_activities a where a.id = new.activity_id;
  end if;
  if new.influencer_deal_id is not null then
    select coalesce(new.campaign_id, d.campaign_id) into new.campaign_id
      from public.mkt_influencer_deals d where d.id = new.influencer_deal_id;
    new.channel_id := coalesce(new.channel_id,
      (select id from public.mkt_channels where utm_source = 'influencer' limit 1));
  end if;
  if new.channel_id is null and new.campaign_id is not null then
    select channel_id into new.channel_id from public.crm_campaigns where id = new.campaign_id;
  end if;
  if new.source_id is null and new.channel_id is not null then
    select source_id into new.source_id from public.mkt_channels where id = new.channel_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_stamp_touchpoint on public.mkt_touchpoints;
create trigger trg_mkt_stamp_touchpoint
  before insert on public.mkt_touchpoints
  for each row execute function public.mkt_stamp_touchpoint();

-- ===== البوّابة: قبل الإدخال — ترجمة UTM إلى أسماء تطابقها intake_lead =====
create or replace function public.mkt_intake_resolve()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text; v_ch public.mkt_channels%rowtype; v_src text; v_raw jsonb := coalesce(new.raw, '{}'::jsonb);
        v_utm jsonb;
begin
  begin
    v_utm := coalesce(v_raw->'utm', v_raw);

    if not exists (select 1 from public.crm_campaigns where name = btrim(coalesce(new.campaign_ref, ''))) then
      select name into v_name from public.crm_campaigns
       where code in (lower(btrim(coalesce(new.campaign_ref, ''))), lower(coalesce(v_utm->>'utm_campaign', '')))
       limit 1;
      if v_name is not null then new.campaign_ref := v_name; end if;
    end if;

    if not exists (select 1 from public.crm_sources where name = btrim(coalesce(new.source_ref, ''))) then
      select * into v_ch from public.mkt_channels
       where utm_source = lower(coalesce(v_utm->>'utm_source', new.source_ref,
                                         case new.provider when 'meta' then 'facebook'
                                                           when 'tiktok' then 'tiktok'
                                                           when 'google' then 'google'
                                                           when 'website' then 'website'
                                                           when 'whatsapp' then 'whatsapp'
                                                           when 'landing' then 'landing' end))
       order by (utm_medium = lower(coalesce(v_utm->>'utm_medium', new.medium, ''))) desc, sort_order
       limit 1;
      if v_ch.source_id is not null then
        select name into v_src from public.crm_sources where id = v_ch.source_id;
        new.source_ref := v_src;
      end if;
    end if;

    new.medium  := coalesce(new.medium, lower(v_utm->>'utm_medium'));
    new.content := coalesce(new.content, lower(v_utm->>'utm_content'));
  exception when others then
    insert into public.mkt_event_errors (source, message, context)
    values ('mkt_intake_resolve', sqlerrm, jsonb_build_object('intake', new.id, 'provider', new.provider));
  end;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_intake_resolve on public.crm_lead_intake;
create trigger trg_mkt_intake_resolve
  before insert on public.crm_lead_intake
  for each row execute function public.mkt_intake_resolve();

-- ===== البوّابة: بعد التحويل — لمسة الاستقبال ونقرات الزائر قبلها =====
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
       link_id, landing_page_id, utm, intake_id, is_conversion, created_by)
    values (new.client_id, new.received_at,
            case when new.provider = 'landing' then 'نموذج' else 'استقبال' end,
            v_camp, v_ch, new.medium, new.content,
            (m->>'link_id')::uuid, (m->>'landing_page_id')::uuid,
            case when jsonb_typeof(v_utm) = 'object' then v_utm end,
            new.id, new.status = 'مُحوَّل', null)
    on conflict (intake_id) do nothing;

    -- نقرات الزائر نفسه قبل النموذج: الإعلان الذي جاء به قبل أن يسجّل
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

drop trigger if exists trg_mkt_intake_touchpoint on public.crm_lead_intake;
create trigger trg_mkt_intake_touchpoint
  after update of status on public.crm_lead_intake
  for each row execute function public.mkt_intake_touchpoint();

-- الدمج (104) يضع merged_into على البطاقة المدموجة: لمساتها تتبعها
create or replace function public.mkt_follow_merge()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.mkt_touchpoints set client_id = new.merged_into where client_id = new.id;
  return null;
end;
$fn$;

drop trigger if exists trg_mkt_follow_merge on public.clients;
create trigger trg_mkt_follow_merge
  after update of merged_into on public.clients
  for each row when (new.merged_into is not null and new.merged_into is distinct from old.merged_into)
  execute function public.mkt_follow_merge();

revoke all on function public.mkt_intake_resolve()    from public, anon, authenticated;
revoke all on function public.mkt_intake_touchpoint() from public, anon, authenticated;
revoke all on function public.mkt_follow_merge()      from public, anon, authenticated;

-- لمسة يدوية: موظف المبيعات يسجّل «جاء من المعرض»، والتسويق ينسب
create or replace function public.mkt_add_touchpoint(
  p_client uuid, p_type text, p_campaign uuid default null, p_channel uuid default null,
  p_activity uuid default null, p_influencer_deal uuid default null, p_note text default null,
  p_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not (public.can_write_marketing() or public.can_see_client(p_client)) then
    raise exception 'لا ترى هذا العميل';
  end if;
  if p_type not in ('حضور فعالية', 'إحالة', 'مؤثر', 'يدوي') then
    raise exception 'نوع اللمسة اليدوية: حضور فعالية، إحالة، مؤثر، يدوي';
  end if;
  if p_campaign is null and p_channel is null and p_activity is null and p_influencer_deal is null then
    raise exception 'اختر الحملة أو القناة أو النشاط أو المؤثر';
  end if;

  insert into public.mkt_touchpoints
    (client_id, occurred_at, touch_type, campaign_id, channel_id, activity_id, influencer_deal_id, note)
  values (p_client, coalesce(p_at, now()), p_type, p_campaign, p_channel, p_activity, p_influencer_deal,
          nullif(btrim(p_note), ''))
  returning id into v_id;

  -- أول حملة معروفة للعميل تصير حملته في الـCRM — ولا تُستبدل حملةٌ قائمة
  update public.clients c
     set campaign_id = t.campaign_id
    from public.mkt_touchpoints t
   where t.id = v_id and c.id = p_client and c.campaign_id is null and t.campaign_id is not null;
  return v_id;
end;
$fn$;

create or replace function public.mkt_delete_touchpoint(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_marketing_manager() then raise exception 'لمدير التسويق'; end if;
  delete from public.mkt_touchpoints
   where id = p_id and touch_type in ('حضور فعالية', 'إحالة', 'مؤثر', 'يدوي');
  if not found then raise exception 'تُحذف اللمسات اليدوية وحدها — الآلية أثرٌ لا رأي'; end if;
end;
$fn$;

revoke all on function public.mkt_add_touchpoint(uuid, text, uuid, uuid, uuid, uuid, text, timestamptz) from public, anon;
revoke all on function public.mkt_delete_touchpoint(uuid) from public, anon;
grant execute on function public.mkt_add_touchpoint(uuid, text, uuid, uuid, uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.mkt_delete_touchpoint(uuid) to authenticated;


-- ------------------------------------------------------------
-- 5) المقاييس اليومية — ما تقوله المنصّة
--
-- ⚠️ «مصروف المنصّة» هنا ما يقوله مدير إعلانات ميتا، لا ما دفعته تلال.
--    كلفة التسويق في كل مؤشّر = المصروفات المدفوعة (122) — الدفتر.
--    والفرق بينهما يُعرض «فرقَ مطابقة» ولا يُجمعان.
-- ------------------------------------------------------------
create table if not exists public.mkt_metrics_daily (
  id               bigint generated always as identity primary key,
  metric_date      date not null,
  entity_type      text not null check (entity_type in (
                     'حملة', 'قناة', 'حساب', 'حملة إعلانية', 'مجموعة إعلانية', 'إعلان',
                     'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط')),
  entity_id        uuid not null,
  campaign_id      uuid references public.crm_campaigns(id) on delete set null,
  channel_id       uuid references public.mkt_channels(id) on delete set null,
  source           text not null default 'يدوي' check (source in ('يدوي', 'استيراد', 'مزامنة')),
  spend            numeric not null default 0 check (spend >= 0),
  impressions      bigint  not null default 0 check (impressions >= 0),
  reach            bigint  not null default 0 check (reach >= 0),
  clicks           bigint  not null default 0 check (clicks >= 0),
  link_clicks      bigint  not null default 0 check (link_clicks >= 0),
  leads            int     not null default 0 check (leads >= 0),
  conversions      int     not null default 0 check (conversions >= 0),
  video_views      bigint  not null default 0 check (video_views >= 0),
  watch_seconds    bigint  not null default 0 check (watch_seconds >= 0),
  engagements      bigint  not null default 0 check (engagements >= 0),
  likes            bigint  not null default 0 check (likes >= 0),
  comments         bigint  not null default 0 check (comments >= 0),
  shares           bigint  not null default 0 check (shares >= 0),
  saves            bigint  not null default 0 check (saves >= 0),
  followers_gained int     not null default 0,
  visitors         int     not null default 0 check (visitors >= 0),
  updated_at       timestamptz not null default now(),
  unique (entity_type, entity_id, metric_date)
);
create index if not exists mkt_metrics_campaign_idx on public.mkt_metrics_daily (campaign_id, metric_date);
create index if not exists mkt_metrics_channel_idx  on public.mkt_metrics_daily (channel_id, metric_date);
create index if not exists mkt_metrics_date_idx     on public.mkt_metrics_daily (metric_date);

create or replace function public.mkt_stamp_metric()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  case new.entity_type
    when 'حملة' then
      select id, channel_id into new.campaign_id, new.channel_id from public.crm_campaigns where id = new.entity_id;
    when 'قناة' then
      new.channel_id := new.entity_id;
    when 'حساب' then
      select channel_id into new.channel_id from public.mkt_accounts where id = new.entity_id;
    when 'محتوى' then
      select campaign_id, channel_id into new.campaign_id, new.channel_id from public.mkt_content where id = new.entity_id;
    when 'مؤثر' then
      select campaign_id into new.campaign_id from public.mkt_influencer_deals where id = new.entity_id;
      select id into new.channel_id from public.mkt_channels where utm_source = 'influencer' limit 1;
    when 'نشاط' then
      select campaign_id, channel_id into new.campaign_id, new.channel_id from public.mkt_activities where id = new.entity_id;
    when 'صفحة هبوط' then
      select campaign_id, channel_id into new.campaign_id, new.channel_id from public.mkt_landing_pages where id = new.entity_id;
    else
      select a.campaign_id, ac.channel_id into new.campaign_id, new.channel_id
        from public.mkt_ad_objects a join public.mkt_accounts ac on ac.id = a.account_id
       where a.id = new.entity_id;
  end case;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_stamp_metric on public.mkt_metrics_daily;
create trigger trg_mkt_stamp_metric
  before insert or update on public.mkt_metrics_daily
  for each row execute function public.mkt_stamp_metric();

-- استيراد جماعي (CSV من مدير الإعلانات، أو المزامنة) — صفّاً صفّاً بأخطائه
--
-- كل صفّ: { "date", "entity_type", ثم واحد من: "entity_id" | "campaign_code" |
--   "ad_external_id" | "content_code" | "activity_code", والأرقام }
create or replace function public.mkt_import_metrics(p_rows jsonb, p_source text default 'استيراد')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r jsonb; i int := 0; v_id uuid; v_type text; v_date date; n_ok int := 0;
  errs jsonb := '[]'::jsonb;
  k text;
begin
  -- ⚠️ داخل definer يصير current_user مالكَ الدالّة؛ هويّة الطالب في الرمز
  if not (public.can_write_marketing() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'استيراد المقاييس لفريق التسويق';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'المدخل مصفوفة صفوف'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'أكثر من ٢٠٬٠٠٠ صفّ — قسّم الملف'; end if;
  if p_source not in ('يدوي', 'استيراد', 'مزامنة') then raise exception 'المصدر'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_date := (r->>'date')::date;
      v_type := coalesce(r->>'entity_type', 'إعلان');
      v_id := nullif(r->>'entity_id', '')::uuid;
      if v_id is null then
        if r ? 'campaign_code' then
          select id into v_id from public.crm_campaigns where code = lower(r->>'campaign_code');
          v_type := 'حملة';
        elsif r ? 'ad_external_id' then
          select id into v_id from public.mkt_ad_objects
           where external_id = r->>'ad_external_id' and level = v_type;
        elsif r ? 'content_code' then
          select id into v_id from public.mkt_content where code = lower(r->>'content_code');
          v_type := 'محتوى';
        elsif r ? 'activity_code' then
          select id into v_id from public.mkt_activities where code = lower(r->>'activity_code');
          v_type := 'نشاط';
        end if;
      end if;
      if v_id is null then raise exception 'الكيان غير معروف'; end if;

      foreach k in array array['spend','impressions','reach','clicks','link_clicks','leads','conversions',
                               'video_views','watch_seconds','engagements','likes','comments','shares',
                               'saves','visitors'] loop
        if coalesce((r->>k)::numeric, 0) < 0 then raise exception '% سالب', k; end if;
      end loop;

      insert into public.mkt_metrics_daily
        (metric_date, entity_type, entity_id, source, spend, impressions, reach, clicks, link_clicks,
         leads, conversions, video_views, watch_seconds, engagements, likes, comments, shares, saves,
         followers_gained, visitors)
      values (v_date, v_type, v_id, p_source,
              coalesce((r->>'spend')::numeric, 0), coalesce((r->>'impressions')::bigint, 0),
              coalesce((r->>'reach')::bigint, 0), coalesce((r->>'clicks')::bigint, 0),
              coalesce((r->>'link_clicks')::bigint, 0), coalesce((r->>'leads')::int, 0),
              coalesce((r->>'conversions')::int, 0), coalesce((r->>'video_views')::bigint, 0),
              coalesce((r->>'watch_seconds')::bigint, 0), coalesce((r->>'engagements')::bigint, 0),
              coalesce((r->>'likes')::bigint, 0), coalesce((r->>'comments')::bigint, 0),
              coalesce((r->>'shares')::bigint, 0), coalesce((r->>'saves')::bigint, 0),
              coalesce((r->>'followers_gained')::int, 0), coalesce((r->>'visitors')::int, 0))
      on conflict (entity_type, entity_id, metric_date) do update set
        source = excluded.source, spend = excluded.spend, impressions = excluded.impressions,
        reach = excluded.reach, clicks = excluded.clicks, link_clicks = excluded.link_clicks,
        leads = excluded.leads, conversions = excluded.conversions, video_views = excluded.video_views,
        watch_seconds = excluded.watch_seconds, engagements = excluded.engagements,
        likes = excluded.likes, comments = excluded.comments, shares = excluded.shares,
        saves = excluded.saves, followers_gained = excluded.followers_gained, visitors = excluded.visitors;
      n_ok := n_ok + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('ok', n_ok, 'failed', jsonb_array_length(errs), 'errors', errs);
end;
$fn$;

revoke all on function public.mkt_import_metrics(jsonb, text) from public, anon;
grant execute on function public.mkt_import_metrics(jsonb, text) to authenticated, service_role;


-- ------------------------------------------------------------
-- 6) الإسناد — كل بيعة موزّعة على لمساتها بالنموذج المختار
--
--   first      الأولى ١٠٠٪                 — من صنع الطلب
--   last       الأخيرة ١٠٠٪                — من أغلق
--   linear     بالتساوي
--   position   ٤٠٪ الأولى، ٤٠٪ الأخيرة، ٢٠٪ بين ما بينهما
--   time_decay وزن ٢^(−أيام قبل البيع ÷ ٧) — الأقرب أثقل
--   campaign   حملة العميل في الـCRM (clients.campaign_id) ١٠٠٪
--
-- البيعة = صفّ sale_commissions غير مفسوخ. تاريخها تأكيد المقدمة
-- (بتوقيت بغداد)، وإيرادها **عمولة تلال**، وقيمتها ثمن الوحدة منفصلاً.
--
-- ⚠️ definer: التسويق لا يقرأ sale_commissions، و invoker هنا كان
--    سيُرجع إيراداً صفراً لا خطأً. الفحص داخلها، والمُخرَج مجاميع
--    لا أسماء.
-- ------------------------------------------------------------
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
  -- عميلٌ بلا لمسات: لمسةٌ واحدة من حقوله (أول مصدر وحملة 079)
  inferred as (
    select c.id as client_id, coalesce(c.first_touch_at, c.created_at) as occurred_at, c.campaign_id,
           coalesce(cp.channel_id,
                    (select ch.id from public.mkt_channels ch
                      where ch.source_id = c.original_source_id order by ch.sort_order limit 1)) as channel_id,
           null::uuid as activity_id, null::uuid as influencer_deal_id, null::uuid as content_id,
           'أول لمسة (CRM)'::text as touch_type
      from public.clients c
      left join public.crm_campaigns cp on cp.id = c.campaign_id
     where c.id in (select client_id from in_range)
       and not exists (select 1 from public.mkt_touchpoints t where t.client_id = c.id)
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
  -- نموذج الحملة: حملة العميل في الـCRM وحدها
  select s.sale_id, s.reservation_id, s.client_id, s.project_id, s.sale_date, s.deal_amount, s.commission,
         c.campaign_id, cp.channel_id, null, null, null, 'حملة العميل', 1::numeric
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
  -- بيعةٌ لا لمسة قبلها: «غير منسوب» بوزنها كاملاً — لا تختفي من المجموع
  select s.sale_id, s.reservation_id, s.client_id, s.project_id, s.sale_date, s.deal_amount, s.commission,
         null, null, null, null, null, 'غير منسوب', 1::numeric
    from in_range s
   where p_model <> 'campaign'
     and not exists (select 1 from ranked r where r.sale_id = s.sale_id);
$$;

revoke all on function public.mkt_attributed_sales(text, date, date) from public, anon;
grant execute on function public.mkt_attributed_sales(text, date, date) to authenticated;


-- ------------------------------------------------------------
-- 7) RLS والتدقيق
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mkt_landing_pages', 'mkt_tracking_links', 'mkt_metrics_daily'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "mkt read" on public.%I', t);
    execute format('create policy "mkt read" on public.%I for select to authenticated
                      using ((select public.can_read_marketing()))', t);
    execute format('drop policy if exists "mkt insert" on public.%I', t);
    execute format('create policy "mkt insert" on public.%I for insert to authenticated
                      with check ((select public.can_write_marketing()))', t);
    execute format('drop policy if exists "mkt update" on public.%I', t);
    execute format('create policy "mkt update" on public.%I for update to authenticated
                      using ((select public.can_write_marketing()))
                      with check ((select public.can_write_marketing()))', t);
    execute format('drop policy if exists "mkt delete" on public.%I', t);
    execute format('create policy "mkt delete" on public.%I for delete to authenticated
                      using ((select public.is_marketing_manager()))', t);
  end loop;
end $$;

-- النقرات: تُقرأ ولا تُكتب إلا بالدوالّ
alter table public.mkt_link_hits enable row level security;
drop policy if exists "read hits" on public.mkt_link_hits;
create policy "read hits" on public.mkt_link_hits
  for select to authenticated using ((select public.can_read_marketing()));

-- اللمسات: التسويق، ومن يرى العميل (المبيعات تعرف من أين جاء عميلها)
alter table public.mkt_touchpoints enable row level security;
drop policy if exists "read touchpoints" on public.mkt_touchpoints;
create policy "read touchpoints" on public.mkt_touchpoints
  for select to authenticated
  using ((select public.can_read_marketing()) or public.can_see_client(client_id));

do $$
declare t text;
begin
  foreach t in array array['mkt_landing_pages', 'mkt_tracking_links', 'mkt_touchpoints'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.audit_row()', t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 8) التحقّق
-- ------------------------------------------------------------
do $$
declare n_sales int; n_unattr int;
begin
  raise notice '--- 124 التسويق ٣ — التتبّع والإسناد ---';
  select count(*) into n_sales from public.sale_commissions where reversed_at is null;
  select count(*) into n_unattr
    from public.sale_commissions sc join public.clients c on c.id = sc.client_id
   where sc.reversed_at is null and c.campaign_id is null and c.original_source_id is null;
  raise notice 'بيعات غير مفسوخة: % — بلا أي مصدر أو حملة: % (تظهر «غير منسوب»)', n_sales, n_unattr;
  if to_regprocedure('public.normalize_iraqi_phone(text)') is null then
    raise warning 'normalize_iraqi_phone غير موجودة — النموذج العام سيفشل';
  end if;
end $$;

notify pgrst, 'reload schema';
