-- ============================================================
-- تلال ERP — 072: الفرص — الصفقة تنفصل عن الشخص
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- اليوم: `clients.stage` عمود واحد على الشخص. ومعناه أن العميل
-- كائنٌ له مرحلة واحدة وصفقة واحدة على الأكثر مدى حياته.
--
-- وهذا يكذب على الواقع العقاري في ثلاث حالات شائعة:
--
--   1) عميل اشترى شقة في لاماك ويفاوض على أخرى في الفرقان.
--      مرحلته «بيع» فلا تظهر مفاوضته في خطّ الأنابيب أصلاً.
--   2) عميل خسرناه في مشروع وربحناه في آخر. النتيجة تُكتب مرة
--      واحدة، فإمّا يضيع الفوز أو تضيع الخسارة.
--   3) مستثمر يسأل عن ثلاث وحدات في وقت واحد. لا مكان لثلاثة
--      اهتمامات في صفٍّ واحد.
--
-- وأثره على الأرقام مباشر: «معدّل الإغلاق» اليوم يُحسب على الأشخاص
-- لا على الصفقات. عميلٌ خسرناه مرتين وربحناه مرة يُحتسب مرة واحدة.
--
-- ============================================================
-- المبدأ الحاكم
--
--     العميل شخص. الفرصة صفقة. ولا يُقاس الشخص بمقياس الصفقة.
--
--     clients  1 ──── N  opportunities  1 ──── 0..1  reservations
--
-- ============================================================
-- جسر التوافق: المزامنة عند اليقين فقط
--
-- كل شاشة اليوم (لوحة الكانبان، التقارير، الاستيراد، التصدير) تقرأ
-- `clients.stage`. لا نكسرها ولا نجمّدها، بل نُبقيها مرآةً — لكن
-- **بشرط اليقين**:
--
--   • للعميل فرصة واحدة → المرحلتان تتزامنان في الاتجاهين.
--     سحب البطاقة في الكانبان يحرّك الفرصة، وتحريك الفرصة يحرّك
--     البطاقة. كل شيء يعمل كما كان.
--
--   • للعميل أكثر من فرصة → `clients.stage` **لا يُلمَس**.
--     لا يوجد جواب صحيح لسؤال «ما مرحلة هذا الشخص؟» حين تكون له
--     صفقتان في مرحلتين. التخمين هنا يفسد الأرقام أكثر من الصمت،
--     والتقارير تنتقل إلى opportunities في 076.
--
-- ============================================================
-- ما يضيفه
--
--   1) opportunities             — الصفقة: مشروع، وحدة، قيمة، مرحلة، احتمال
--   2) opportunity_stage_history — كل انتقال بزمنه ومدّته وصاحبه
--   3) client_interests          — ما يهتم به العميل (عميل ← N اهتمامات)
--   4) reservations.opportunity_id — الحجز يعود إلى فرصته
--   5) حراسة الانتقالات والحقول المطلوبة (سبب الفشل إلزامي)
--   6) ترحيل: فرصة لكل عميل له مرحلة اليوم — بلا فقدان تاريخ
--
-- يتطلب: sql/036 (المشاريع) و sql/044 و sql/070 و sql/071. آمن لإعادة التشغيل.
-- ============================================================

-- إعدادان جديدان يحكمان التشديد — يبدآن مطفأَين عمداً.
-- تشديد خطّ المبيعات قرار إداري، لا أثر جانبي لهجرة.
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('enforce_stage_transitions', '0', 'فرض مسار المراحل',
   'عند التفعيل يُمنع القفز بين مراحل غير متجاورة حسب crm_stage_transitions.', 'عدد', 0, 1),
  ('enforce_stage_required_fields', '1', 'فرض الحقول المطلوبة للمرحلة',
   'عند التفعيل لا تُنقل الفرصة إلى مرحلة قبل تعبئة حقولها المطلوبة (سبب الفشل مثلاً).', 'عدد', 0, 1)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 1) opportunities
-- ------------------------------------------------------------
create table if not exists public.opportunities (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,

  client_id   uuid not null references public.clients(id) on delete cascade,
  title       text,                     -- «لاماك — شقة ١٠١» مثلاً؛ يُبنى تلقائياً لو تُرك

  -- الطرف العقاري
  project_id  uuid references public.projects(id) on delete set null,
  unit_id     uuid references public.units(id)    on delete set null,

  -- الملكية والمصدر
  owner_id    uuid references public.employees(id) on delete set null,
  source_id   uuid references public.crm_sources(id) on delete set null,
  campaign_id uuid,                     -- المفتاح الأجنبي يُضاف في 079 مع crm_campaigns

  -- المرحلة
  stage_id         uuid not null references public.crm_stages(id),
  stage_entered_at timestamptz not null default now(),
  probability      numeric check (probability between 0 and 100),

  -- المال — قيمة الصفقة لا إيراد تلال (راجع 056)
  expected_value  numeric check (expected_value is null or expected_value >= 0),
  budget_min      numeric,
  budget_max      numeric,
  payment_method  text,
  expected_close_date date,

  -- الإغلاق
  closed_at      timestamptz,
  won_value      numeric,
  lost_reason_id uuid references public.crm_lost_reasons(id) on delete set null,
  lost_note      text,

  -- المتابعة (مرآة لما يُسجَّل في الأنشطة)
  next_action      text,
  next_action_date date,
  last_activity_at timestamptz,

  notes      text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,               -- حذف ناعم — لا تُمحى صفقة (§52)
  deleted_by uuid references auth.users(id) on delete set null,

  constraint opportunities_budget_range check (
    budget_min is null or budget_max is null or budget_min <= budget_max
  )
);

comment on table public.opportunities is
  'الصفقة. العميل قد يملك عدة فرص. معدّلات التحويل والأنابيب تُحسب من هنا لا من clients.';
comment on column public.opportunities.expected_value is
  'قيمة الصفقة (ثمن الوحدة) — مرجعٌ للترجيح لا إيراد. إيراد تلال عمولتها وحدها (sql/056).';
comment on column public.opportunities.probability is
  'يُملأ من احتمال المرحلة عند الانتقال، ويقبل تعديلاً يدوياً يبقى حتى المرحلة التالية.';

create index if not exists opportunities_client_idx   on public.opportunities (client_id)
  where deleted_at is null;
create index if not exists opportunities_owner_idx    on public.opportunities (owner_id, stage_id)
  where deleted_at is null;
create index if not exists opportunities_stage_idx    on public.opportunities (stage_id)
  where deleted_at is null;
create index if not exists opportunities_project_idx  on public.opportunities (project_id)
  where deleted_at is null;
create index if not exists opportunities_unit_idx     on public.opportunities (unit_id)
  where unit_id is not null and deleted_at is null;
create index if not exists opportunities_close_idx    on public.opportunities (expected_close_date)
  where closed_at is null and deleted_at is null;
create index if not exists opportunities_nextaction_idx on public.opportunities (next_action_date)
  where next_action_date is not null and deleted_at is null;

-- ------------------------------------------------------------
-- 2) opportunity_stage_history — التاريخ الذي لم يكن موجوداً
--
-- الاسم يُخزَّن نصّاً بجانب المفتاح عمداً: إعادة تسمية مرحلة بعد
-- سنتين يجب ألّا تُعيد كتابة الماضي. التاريخ يقول ما كان، لا ما صار.
-- ------------------------------------------------------------
create table if not exists public.opportunity_stage_history (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  from_stage_id  uuid references public.crm_stages(id) on delete set null,
  to_stage_id    uuid references public.crm_stages(id) on delete set null,
  from_stage     text,
  to_stage       text,
  days_in_from   numeric,               -- كم بقيت في المرحلة السابقة
  changed_by      uuid references auth.users(id) on delete set null,
  changed_by_name text,
  note           text,
  at             timestamptz not null default now()
);

create index if not exists opp_stage_history_opp_idx
  on public.opportunity_stage_history (opportunity_id, at desc);
create index if not exists opp_stage_history_to_idx
  on public.opportunity_stage_history (to_stage_id, at desc);

-- ------------------------------------------------------------
-- 3) client_interests — العميل يهتم بأكثر من وحدة
-- ------------------------------------------------------------
create table if not exists public.client_interests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  client_id      uuid not null references public.clients(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,

  project_id uuid references public.projects(id) on delete set null,
  unit_id    uuid references public.units(id)    on delete set null,
  unit_type  text,
  area_min   numeric,
  area_max   numeric,
  rooms      int,
  floor_pref text,
  view_pref  text,
  budget_min numeric,
  budget_max numeric,
  payment_method text,
  purpose    text,                      -- سكن | استثمار
  priority   int not null default 1,    -- ١ = الأعلى
  status     text not null default 'مهتم'
             check (status in ('مهتم','عُرِض عليه','استُبعد','محجوز','مباع')),
  notes      text,
  constraint client_interests_area_range check (
    area_min is null or area_max is null or area_min <= area_max
  )
);

comment on table public.client_interests is
  'ما يبحث عنه العميل. الوحدة اختيارية: «شقة ١٥٠م في لاماك» اهتمامٌ صالح قبل اختيار رقم الوحدة.';

create index if not exists client_interests_client_idx on public.client_interests (client_id);
create index if not exists client_interests_opp_idx    on public.client_interests (opportunity_id)
  where opportunity_id is not null;
create index if not exists client_interests_unit_idx   on public.client_interests (unit_id)
  where unit_id is not null;

-- ------------------------------------------------------------
-- 4) ربط الأنشطة والمهام والحجوزات بالفرصة
--    أعمدة اختيارية: لا نشاط قديم يُكسَر، ولا نشاط جديد يُجبَر.
-- ------------------------------------------------------------
alter table public.client_activities
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists client_activities_opp_idx
  on public.client_activities (opportunity_id, occurred_at desc)
  where opportunity_id is not null;

alter table public.tasks
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists tasks_opp_idx on public.tasks (opportunity_id)
  where opportunity_id is not null;

alter table public.reservations
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists reservations_opp_idx on public.reservations (opportunity_id)
  where opportunity_id is not null;

comment on column public.reservations.opportunity_id is
  'الفرصة التي أثمرت هذا الحجز. تربط دورة البيع بالحجز والعمولة في سلسلة واحدة.';

-- ------------------------------------------------------------
-- 5) الترحيل — فرصة لكل عميل له مرحلة اليوم
--
-- ⚠️ يعمل مرة واحدة فعلياً: الشرط `not exists` يمنع تكرار الفرص
--    عند إعادة تشغيل الملف.
--
-- المرحلة والمصدر والمالك والتاريخ كلها تُنقل كما هي، فلا يبدأ
-- خطّ الأنابيب من الصفر ولا يفقد أحد صفقاته المغلقة.
-- ------------------------------------------------------------
insert into public.opportunities
  (client_id, title, stage_id, stage_entered_at, probability,
   owner_id, source_id, created_at, created_by, created_by_name,
   next_action_date, last_activity_at, closed_at, notes)
select
  c.id,
  coalesce(nullif(btrim(c.name), ''), 'فرصة') || ' — ترحيل',
  g.id,
  c.created_at,
  g.probability,
  c.owner_id,
  s.id,
  c.created_at,
  c.created_by,
  null,
  case when g.stage_type = 'open' then c.follow_up_date end,
  c.last_contact_at,
  -- المغلقة: لا نعرف لحظة الإغلاق الحقيقية، فنستعمل آخر تواصل
  -- ثم تاريخ الإنشاء. تقريبٌ معلَن خيرٌ من عمود فارغ يُفسد دورة البيع.
  case when g.stage_type in ('won','lost')
       -- ⚠️ greatest: آخر تواصل قد يسبق الإنشاء في المستورد، والإغلاق قبل الفتح مستحيل
       then greatest(coalesce(c.last_contact_at, c.created_at), c.created_at) end,
  'فرصة مُرحَّلة تلقائياً من مرحلة العميل (072).'
from public.clients c
join public.crm_stages g on g.name = coalesce(c.stage, 'ليد')
left join public.crm_sources s on s.name = btrim(c.source)
where not exists (
  select 1 from public.opportunities o where o.client_id = c.id
);

-- (`last_contact_at` عمود يحدّثه محفّز sql/026 — فُحص وجوده قبل الاعتماد عليه.)

-- ربط الحجوزات القائمة بفرصها: نفس العميل، ونفس الوحدة إن أمكن.
update public.reservations r
   set opportunity_id = o.id
  from public.opportunities o
 where r.opportunity_id is null
   and o.client_id = r.client_id
   and o.deleted_at is null
   and (o.unit_id is null or o.unit_id = r.unit_id);

-- والوحدة تُثبَّت على الفرصة من حجزها — الفرصة صارت تعرف عقارها
update public.opportunities o
   set unit_id    = r.unit_id,
       project_id = coalesce(o.project_id, u.project_id)
  from public.reservations r
  join public.units u on u.id = r.unit_id
 where r.opportunity_id = o.id
   and o.unit_id is null;

-- بذرة التاريخ: نقطة بداية واحدة لكل فرصة مُرحَّلة
insert into public.opportunity_stage_history
  (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage,
   changed_by_name, note, at)
select o.id, null, o.stage_id, null, g.name,
       'النظام', 'نقطة البداية عند ترحيل الفرص (072)', o.created_at
  from public.opportunities o
  join public.crm_stages g on g.id = o.stage_id
 where not exists (
   select 1 from public.opportunity_stage_history h where h.opportunity_id = o.id
 );

-- ------------------------------------------------------------
-- 6) قبل الحفظ — العنوان، الاحتمال، لحظة دخول المرحلة، الإغلاق
-- ------------------------------------------------------------
create or replace function public.prepare_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g     public.crm_stages%rowtype;
  cname text;
  pname text;
  ucode text;
begin
  select * into g from public.crm_stages where id = new.stage_id;
  if g.id is null then
    raise exception 'المرحلة غير معروفة.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by_name := coalesce(public.my_employee_name(),
                                    public.display_name(auth.uid()));
    -- المالك الافتراضي: مالك العميل. فرصةٌ بلا مالك لا يتابعها أحد.
    if new.owner_id is null then
      select owner_id into new.owner_id from public.clients where id = new.client_id;
    end if;
  end if;

  -- عنوان يُقرأ في قائمة: «سعاد — لاماك / A101»
  if new.title is null or btrim(new.title) = '' then
    select name into cname from public.clients where id = new.client_id;
    select name into pname from public.projects where id = new.project_id;
    select unit_code into ucode from public.units where id = new.unit_id;
    new.title := coalesce(nullif(btrim(cname), ''), 'فرصة')
                 || coalesce(' — ' || pname, '')
                 || coalesce(' / ' || ucode, '');
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
    -- الاحتمال يتبع المرحلة الجديدة، إلا أن يكون المستخدم عدّله في
    -- نفس التحديث — فتعديله اليدوي أعرف بالصفقة من جدول عام.
    if new.probability is not distinct from old.probability then
      new.probability := g.probability;
    end if;
  elsif tg_op = 'INSERT' and new.probability is null then
    new.probability := g.probability;
  end if;

  -- الإغلاق والفتح: عمود closed_at لا يُترك للواجهة
  if g.stage_type in ('won', 'lost') then
    new.closed_at := coalesce(new.closed_at, now());
    if g.stage_type = 'won' then
      new.won_value := coalesce(new.won_value, new.expected_value);
    end if;
    -- ملفٌّ مغلق لا خطوة قادمة له — نفس قاعدة sql/029 على العميل
    new.next_action      := null;
    new.next_action_date := null;
  else
    new.closed_at := null;
    new.won_value := null;
  end if;

  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_prepare_opportunity on public.opportunities;
create trigger trg_prepare_opportunity
  before insert or update on public.opportunities
  for each row execute function public.prepare_opportunity();

-- ------------------------------------------------------------
-- 7) حراسة الانتقال — الحكم قبل الحركة
--
-- ⚠️ لا تعمل على INSERT عمداً: الترحيل يُدخل فرصاً مغلقة بلا سبب
--    فشل، وفرضُ القاعدة عليها كان سيرفض تاريخاً وقع فعلاً. القاعدة
--    تحكم ما هو آتٍ لا ما مضى.
--
-- فرض المسار (enforce_stage_transitions) يبدأ **مطفأً**؛ وفرض
-- الحقول المطلوبة يبدأ **مشتعلاً** لأن أثره الوحيد اليوم هو إلزام
-- سبب الفشل — وهو المطلوب أصلاً.
-- ------------------------------------------------------------
create or replace function public.guard_opportunity_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g        public.crm_stages%rowtype;
  fld      text;
  allowed  boolean;
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select * into g from public.crm_stages where id = new.stage_id;

  if not g.is_active then
    raise exception 'المرحلة «%» موقوفة ولا يُنقل إليها.', g.name;
  end if;

  -- (أ) المسار المسموح
  if public.crm_setting_int('enforce_stage_transitions', 0) = 1 then
    select exists (
      select 1 from public.crm_stage_transitions t
       where t.from_stage_id = old.stage_id and t.to_stage_id = new.stage_id
    ) into allowed;
    if not allowed then
      raise exception 'الانتقال من «%» إلى «%» غير مسموح في مسار المبيعات.',
        (select name from public.crm_stages where id = old.stage_id), g.name;
    end if;
  end if;

  -- (ب) الحقول المطلوبة للمرحلة
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

  -- (ج) سبب الفشل يحتاج ملاحظة أحياناً
  if new.lost_reason_id is not null
     and exists (select 1 from public.crm_lost_reasons r
                  where r.id = new.lost_reason_id and r.requires_note)
     and coalesce(btrim(new.lost_note), '') = '' then
    raise exception 'سبب الفشل المختار يتطلّب توضيحاً مكتوباً.';
  end if;

  return new;
end; $$;

-- z ليعمل بعد trg_prepare_opportunity: الحارس يحكم على القيم النهائية
drop trigger if exists trg_z_guard_opportunity_stage on public.opportunities;
create trigger trg_z_guard_opportunity_stage
  before update of stage_id on public.opportunities
  for each row execute function public.guard_opportunity_stage();

-- ------------------------------------------------------------
-- 8) بعد الحفظ — التاريخ، ونشاطٌ في تسلسل العميل، والمرآة
-- ------------------------------------------------------------
create or replace function public.after_opportunity_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  from_name text;
  to_name   text;
  actor     text;
  n_open    int;
  the_stage text;
begin
  if new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  select name into from_name from public.crm_stages where id = old.stage_id;
  select name into to_name   from public.crm_stages where id = new.stage_id;
  actor := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');

  insert into public.opportunity_stage_history
    (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage,
     days_in_from, changed_by, changed_by_name)
  values
    (new.id, old.stage_id, new.stage_id, from_name, to_name,
     round(extract(epoch from (now() - old.stage_entered_at)) / 86400.0, 2),
     auth.uid(), actor);

  select count(*) into n_open
    from public.opportunities o
   where o.client_id = new.client_id and o.deleted_at is null;

  -- ⚠️ لا ازدواج في التسلسل: محفّز العميل (sql/017) يسجّل «تغيير مرحلة»
  --    كلما تغيّر clients.stage. حين يملك العميل فرصة واحدة تتزامن
  --    المرحلتان بالمرآة، فيكفي سجلّه (يعمل قبل المرآة إن جاء التغيير
  --    من الكانبان، وبعدها إن جاء من الفرصة). نسجّل هنا فقط حين لا
  --    مرآة — صفر فرص أو أكثر من واحدة.
  if n_open <> 1 then
    insert into public.client_activities
      (client_id, opportunity_id, activity_type, summary, stage_from, stage_to, actor_name)
    values
      (new.client_id, new.id, 'تغيير مرحلة',
       coalesce(new.title, 'فرصة') || ': ' || coalesce(from_name, '—') || ' ← ' || to_name,
       from_name, to_name, actor);
  else
    -- ===== المرآة: عند اليقين فقط =====
    select name into the_stage from public.crm_stages where id = new.stage_id;
    update public.clients
       set stage = the_stage
     where id = new.client_id
       and stage is distinct from the_stage;
  end if;
  -- أكثر من فرصة: لا نلمس clients.stage. لا جواب صحيح لسؤال
  -- «ما مرحلة هذا الشخص؟» حين تكون له صفقتان في مرحلتين.

  return null;
end; $$;

drop trigger if exists trg_after_opportunity_stage on public.opportunities;
create trigger trg_after_opportunity_stage
  after update of stage_id on public.opportunities
  for each row execute function public.after_opportunity_stage_change();

-- ------------------------------------------------------------
-- 9) المرآة العكسية — الكانبان يبقى يعمل
--
-- الموظف يسحب البطاقة في /dashboard/clients/board فيتغيّر
-- clients.stage. نمرّر التغيير إلى الفرصة الوحيدة إن وُجدت.
--
-- ⚠️ حراسة الارتداد: نُحدّث الفرصة فقط إن كانت مرحلتها مختلفة فعلاً،
--    والمحفّز المقابل (8) يُحدّث العميل بنفس الشرط — فتتوقّف السلسلة
--    بعد خطوة واحدة ولا تدور.
-- ------------------------------------------------------------
create or replace function public.mirror_client_stage_to_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n_opp   int;
  the_opp uuid;
  g_id    uuid;
begin
  if new.stage is not distinct from old.stage then
    return null;
  end if;

  -- min(uuid) غير موجودة في Postgres — أول عنصر من array_agg
  select count(*), (array_agg(o.id order by o.created_at))[1] into n_opp, the_opp
    from public.opportunities o
   where o.client_id = new.id and o.deleted_at is null;

  if n_opp <> 1 then
    return null;   -- صفر أو أكثر من فرصة: لا مرآة
  end if;

  select id into g_id from public.crm_stages where name = new.stage;
  if g_id is null then
    return null;   -- مرحلة ليست في الجدول: لا نُخمّن
  end if;

  update public.opportunities
     set stage_id = g_id
   where id = the_opp
     and stage_id is distinct from g_id
     -- سبب الفشل إلزامي على الفرصة، ولوحة الكانبان لا تسأل عنه.
     -- فلا نمرّر نقلاً سيرفضه الحارس ويُفشل سحب البطاقة كلها؛
     -- الإغلاق كفشل يتم من شاشة الفرصة حيث يُسأل عن السبب.
     and not exists (
       select 1 from public.crm_stages s
        where s.id = g_id and 'lost_reason_id' = any(s.required_fields)
     );

  return null;
end; $$;

drop trigger if exists trg_mirror_client_stage on public.clients;
create trigger trg_mirror_client_stage
  after update of stage on public.clients
  for each row execute function public.mirror_client_stage_to_opportunity();

-- ------------------------------------------------------------
-- 10) الحجز يغذّي فرصته (§33)
--
-- الحجز حدثٌ في دورة البيع لا خارجها: يثبّت الوحدة على الفرصة،
-- ويسجّل نشاطاً، ويغلقها فوزاً عند اكتمال البيع.
--
-- ⚠️ النشاط المسجَّل من نوع «حجز» — نوعٌ نظامي (is_system_activity)
--    لا «ملاحظة». السبب: enforce_activity_followup (sql/028) يرفض أي
--    نشاط غير نظامي بلا موعد متابعة على عميل مفتوح، والحجز يُنشأ
--    غالباً على عميل مفتوح — فكان الإدخال سيُسقط الحجز كله. والحجز
--    حدثٌ يكتبه النظام لا تواصلٌ يقوم به موظف، فلا يُحتسب في عدّاد
--    الاتصالات — كما «تغيير مرحلة» و«تسليم» (sql/045).
--    ⚠️ يقابله SYSTEM_ACTIVITY_TYPES في src/lib/types.ts.
-- ------------------------------------------------------------
create or replace function public.is_system_activity(p_type text)
returns boolean language sql immutable as $$
  select p_type in ('تغيير مرحلة', 'تسليم', 'حجز');
$$;

insert into public.crm_activity_types
  (name, icon, color, has_direction, has_duration, is_system, counts_as_contact, sort_order)
values ('حجز', 'bookmark_added', 'bg-emerald-100 text-emerald-700', false, false, true, false, 910)
on conflict (name) do nothing;

create or replace function public.sync_opportunity_from_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o        public.opportunities%rowtype;
  won_id   uuid;
  proj_id  uuid;
begin
  -- الربط نفسه يتم في المحفّز before (link_reservation_opportunity):
  -- إسنادٌ إلى new داخل محفّز after لا يُحفظ. هنا نتعامل مع الربط
  -- القائم فقط.
  if new.opportunity_id is null then
    return null;
  end if;

  select * into o from public.opportunities where id = new.opportunity_id;
  if o.id is null then return null; end if;

  select project_id into proj_id from public.units where id = new.unit_id;

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

  -- اكتمال البيع يغلق الفرصة فوزاً.
  -- (trg_close_client_on_sale يغلق مرحلة العميل أصلاً؛ نغلق الصفقة
  --  هنا كي لا يبقى خطّ الأنابيب يعدّ صفقةً مباعة كأنها مفتوحة.)
  if new.status = 'بيع مكتمل' then
    select id into won_id from public.crm_stages where stage_type = 'won' limit 1;
    if won_id is not null then
      update public.opportunities
         set stage_id  = won_id,
             won_value = coalesce(new.sale_price, expected_value)
       where id = o.id
         and stage_id is distinct from won_id;
    end if;
  end if;

  return null;
end; $$;

drop trigger if exists trg_sync_opportunity_reservation on public.reservations;
create trigger trg_sync_opportunity_reservation
  after insert or update of status, unit_id, sale_price on public.reservations
  for each row execute function public.sync_opportunity_from_reservation();

-- والربط نفسه في محفّز before: حجزٌ جديد بلا فرصة مختارة يلتقط
-- الفرصة المفتوحة الأحدث لنفس العميل. صفر فرص مفتوحة = يبقى الحجز
-- بلا ربط ويظهر في لوحة جودة البيانات (077).
create or replace function public.link_reservation_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opportunity_id is null then
    select o.id into new.opportunity_id
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.client_id = new.client_id
       and o.deleted_at is null
       and g.stage_type = 'open'
     order by o.created_at desc
     limit 1;
  end if;
  return new;
end; $$;

drop trigger if exists trg_link_reservation_opportunity on public.reservations;
create trigger trg_link_reservation_opportunity
  before insert on public.reservations
  for each row execute function public.link_reservation_opportunity();

-- ------------------------------------------------------------
-- 11) آخر نشاط على الفرصة — يُحدَّث من الأنشطة لا باليد
-- ------------------------------------------------------------
create or replace function public.refresh_opportunity_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opportunity_id is null then return null; end if;

  update public.opportunities
     set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at),
                                     new.occurred_at),
         next_action      = coalesce(new.next_action, next_action),
         next_action_date = coalesce(new.next_action_date, next_action_date)
   where id = new.opportunity_id
     and closed_at is null;   -- المغلقة لا خطوة قادمة لها

  return null;
end; $$;

drop trigger if exists trg_refresh_opportunity_activity on public.client_activities;
create trigger trg_refresh_opportunity_activity
  after insert or update on public.client_activities
  for each row execute function public.refresh_opportunity_activity();

-- ------------------------------------------------------------
-- 12) الصلاحيات — نفس نموذج العملاء حرفياً
--     الفرصة تتبع عميلها: من يرى العميل يرى صفقاته.
-- ------------------------------------------------------------
alter table public.opportunities            enable row level security;
alter table public.opportunity_stage_history enable row level security;
alter table public.client_interests         enable row level security;

drop policy if exists "read opportunities" on public.opportunities;
create policy "read opportunities" on public.opportunities
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or created_by = (select auth.uid())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
    or public.can_see_client(client_id)
  );

drop policy if exists "write opportunities" on public.opportunities;
create policy "write opportunities" on public.opportunities
  for insert to authenticated
  with check (
    (select public.is_admin())
    or public.can_see_client(client_id)
  );

drop policy if exists "update opportunities" on public.opportunities;
create policy "update opportunities" on public.opportunities
  for update to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
    or public.can_see_client(client_id)
  )
  with check (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
    or public.can_see_client(client_id)
  );

-- الحذف للمدير وحده — واستعماله الصحيح هو الحذف الناعم (deleted_at)
drop policy if exists "delete opportunities" on public.opportunities;
create policy "delete opportunities" on public.opportunities
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "read opp history" on public.opportunity_stage_history;
create policy "read opp history" on public.opportunity_stage_history
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or exists (select 1 from public.opportunities o
                where o.id = opportunity_id and public.can_see_client(o.client_id))
  );
-- لا سياسة كتابة على التاريخ: المحفّز وحده يكتبه (§51).

drop policy if exists "read interests" on public.client_interests;
create policy "read interests" on public.client_interests
  for select to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id));

drop policy if exists "write interests" on public.client_interests;
create policy "write interests" on public.client_interests
  for all to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id))
  with check ((select public.is_admin()) or public.can_see_client(client_id));

drop trigger if exists trg_audit_opportunities on public.opportunities;
create trigger trg_audit_opportunities
  after insert or update or delete on public.opportunities
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 13) التحقّق
-- ------------------------------------------------------------
do $$
declare
  n_clients int; n_opps int; n_multi int; n_linked int; n_res int;
  n_open int; n_won int; n_lost int; pipeline numeric; weighted numeric;
begin
  select count(*) into n_clients from public.clients;
  select count(*) into n_opps    from public.opportunities where deleted_at is null;

  select count(*) into n_multi from (
    select client_id from public.opportunities where deleted_at is null
     group by client_id having count(*) > 1
  ) x;

  select count(*) into n_res    from public.reservations;
  select count(*) into n_linked from public.reservations where opportunity_id is not null;

  select count(*) filter (where g.stage_type = 'open'),
         count(*) filter (where g.stage_type = 'won'),
         count(*) filter (where g.stage_type = 'lost'),
         coalesce(sum(o.expected_value) filter (where g.stage_type = 'open'), 0),
         coalesce(sum(o.expected_value * o.probability / 100.0)
                  filter (where g.stage_type = 'open'), 0)
    into n_open, n_won, n_lost, pipeline, weighted
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.deleted_at is null;

  raise notice '--- 072 الفرص ---';
  raise notice 'العملاء: %   الفرص: %   (بأكثر من فرصة: %)', n_clients, n_opps, n_multi;
  raise notice 'مفتوحة: %   فائزة: %   خاسرة: %', n_open, n_won, n_lost;
  raise notice 'الحجوزات المربوطة بفرصها: % من %', n_linked, n_res;
  raise notice 'قيمة الأنابيب: %   الموزونة: %',
    round(pipeline), round(weighted);

  if n_opps < n_clients then
    raise warning 'عملاء بلا فرصة: % — مرحلتهم غير موجودة في crm_stages. شغّل 070 أولاً.',
      n_clients - n_opps;
  end if;

  if n_res > 0 and n_linked = 0 then
    raise warning 'لم يُربط أي حجز بفرصة — راجع تطابق client_id بين الجدولين.';
  end if;

  if pipeline = 0 and n_open > 0 then
    raise notice 'قيمة الأنابيب صفر: expected_value فارغ في الفرص المُرحَّلة — متوقّع.';
    raise notice 'القيمة تُملأ عند تحديد الوحدة أو عند تأكيد المقدمة (sql/069).';
  end if;
end $$;

notify pgrst, 'reload schema';
