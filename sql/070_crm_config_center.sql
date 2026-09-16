-- ============================================================
-- تلال ERP — 070: مركز إعدادات الـCRM
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- قواعد الـCRM اليوم مكتوبة في الكود لا في القاعدة:
--   • ٧ و٢١ يوماً (ألوان الصمت)      → src/lib/types.ts
--   • ١٤ يوماً (عميل مهمل)            → src/lib/crm-reports.ts
--   • المراحل الستّ                    → ثابت في TypeScript وفي دالة is_open_stage
--   • ٢٤ ساعة التصعيد، ٩ صباحاً       → نصّاً داخل sql/027
--
-- ومعنى ذلك أن تغيير «٢١ يوماً» إلى «١٥» يحتاج مبرمجاً ونشراً، وأن
-- إضافة مرحلة إلى خطّ المبيعات تتطلّب تعديل خمسة ملفات في ثلاث طبقات.
-- هذا الملف ينقل القرار من الكود إلى الجدول، ويترك الكود ينفّذ فقط.
--
-- ===== المبدأ الحاكم =====
--
--     البذرة تُطابق السلوك الحالي حرفياً.
--
-- بعد تشغيل هذا الملف **لا يتغيّر شيء في الشاشات**: نفس المراحل،
-- نفس الأيام، نفس الألوان. أضفنا مقبضاً للتحكّم، لا سلوكاً جديداً.
-- أي تغيير حقيقي يأتي لاحقاً من صفحة الإعدادات بقرار الإدارة.
--
-- ===== ما يضيفه =====
--
--   1) crm_settings          — أرقام القواعد (أيام، ساعات، حدود)
--   2) crm_stages            — المراحل: الترتيب، النوع، الاحتمال، SLA، الحقول المطلوبة
--   3) crm_stage_transitions — الانتقالات المسموحة بين المراحل
--   4) crm_sources           — مصادر العملاء
--   5) crm_lost_reasons      — أسباب فشل البيع
--   6) crm_activity_types    — أنواع التواصل
--   7) crm_score_rules       — قواعد تقييم الليد (تُستهلك في 074)
--
-- ===== التوافق =====
--
-- is_open_stage() كانت immutable وتحمل الاسمين نصّاً. تصير stable
-- وتقرأ من crm_stages. فُحص أثرها قبل التغيير: مستدعاة في خمسة
-- محفّزات فقط (027، 029، 045، 046) ولا في أي فهرس ولا قيد check —
-- فتغيير التقلّب آمن. ولو غابت المرحلة عن الجدول تعود إلى الاسمين
-- المعروفين، فعطلٌ في الإعدادات لا يفتح ملفاً مغلقاً.
--
-- يتطلب: sql/005 (الأدوار) و sql/017 (المراحل) و sql/027 و sql/058 (التدقيق).
-- الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) crm_settings — الأرقام التي كانت في الكود
-- ------------------------------------------------------------
create table if not exists public.crm_settings (
  key         text primary key,
  value       jsonb not null,
  label       text not null,              -- ما يراه المدير في صفحة الإعدادات
  description text,                       -- ماذا يحدث لو غيّرته
  unit        text,                       -- يوم | ساعة | عدد | نسبة
  min_value   numeric,                    -- حدود تمنع إدخالاً كارثياً
  max_value   numeric,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

comment on table public.crm_settings is
  'قواعد الـCRM القابلة للضبط. القيمة jsonb لتستوعب رقماً أو قائمة أو كائناً.';

insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('silence_green_days',  '7',   'حدّ الصمت الأخضر',
   'عميل تواصلنا معه خلال هذه المدة يُعرض بالأخضر.', 'يوم', 1, 90),
  ('silence_amber_days',  '21',  'حدّ الصمت الكهرماني',
   'بعد الأخضر وحتى هذا الحدّ يُعرض بالكهرماني، وبعده بالأحمر.', 'يوم', 2, 180),
  ('neglected_days',      '14',  'حدّ الإهمال',
   'عميل مفتوح بلا تواصل هذه المدة يدخل قائمة «المهملون».', 'يوم', 1, 180),
  ('escalation_hours',    '24',  'مهلة التصعيد للإدارة',
   'متابعة فات موعدها بهذه المدة بلا تحديث حالة تُصعَّد للإدارة.', 'ساعة', 1, 720),
  ('scan_hour_baghdad',   '9',   'ساعة الفحص اليومي',
   'موعد فحص المتابعات بتوقيت بغداد. تغييره يتطلب إعادة جدولة pg_cron.', 'ساعة', 0, 23),
  ('first_contact_sla_hours', '24', 'مهلة أول تواصل مع ليد جديد',
   'ليد جديد لم يُتواصل معه خلال هذه المدة يُعدّ خرقاً لمستوى الخدمة.', 'ساعة', 1, 336),
  ('max_open_leads_per_owner', '150', 'الحدّ الأعلى لليدات المفتوحة للموظف',
   'تجاوزه يرفع تنبيه «تركّز إسناد» في لوحة التوزيع — لا يمنع الإسناد.', 'عدد', 10, 2000),
  ('unworked_lead_days',  '3',   'مهلة العمل على ليد مُسنَد',
   'ليد أُسنِد ولم يُسجَّل عليه تواصل خلال هذه المدة يُعدّ «غير مُشتغَل».', 'يوم', 1, 60),
  ('duplicate_name_similarity', '0.45', 'حدّ تشابه الأسماء',
   'نسبة التشابه التي يُعدّ عندها اسمان مرشَّحَين للتكرار.', 'نسبة', 0.1, 1.0)
on conflict (key) do nothing;   -- لا نطمس ضبطاً غيّرته الإدارة

-- ------------------------------------------------------------
-- 2) crm_stages — المرحلة تصير صفّاً لا نصّاً
-- ------------------------------------------------------------
create table if not exists public.crm_stages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,       -- الاسم الظاهر — هو نفسه المخزَّن في clients.stage
  sort_order  int  not null,
  stage_type  text not null default 'open'
              check (stage_type in ('open','won','lost')),
  probability numeric not null default 0
              check (probability between 0 and 100),
  sla_hours   int,                        -- المهلة القصوى داخل المرحلة (null = بلا مهلة)
  requires_activity boolean not null default false,  -- هل يلزم تواصل مسجَّل للدخول؟
  required_fields   text[] not null default '{}',    -- حقول لا يُدخَل بدونها
  color       text,                       -- صنف Tailwind — يطابق PIPELINE_STAGE_COLORS
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on column public.crm_stages.name is
  'مطابق حرفياً لقيمة clients.stage. إعادة التسمية تتطلب تحديث الصفوف معه — لا تُعاد التسمية من هنا وحدها.';
comment on column public.crm_stages.probability is
  'احتمال الإغلاق — يُستعمل في خطّ الأنابيب الموزون. للقياس لا للاحتساب المالي.';

-- البذرة: المراحل الستّ الحالية بأسمائها وألوانها كما هي في types.ts
insert into public.crm_stages
  (name, sort_order, stage_type, probability, requires_activity, required_fields, color) values
  ('ليد',           1, 'open',  10, false, '{}',                'bg-gray-100 text-gray-700'),
  ('اتصال',         2, 'open',  25, true,  '{}',                'bg-blue-100 text-blue-700'),
  ('زيارة',         3, 'open',  45, true,  '{}',                'bg-purple-100 text-purple-700'),
  ('مناقشة العرض',  4, 'open',  70, true,  '{}',                'bg-amber-100 text-amber-700'),
  ('بيع',           5, 'won',  100, false, '{}',                'bg-green-100 text-green-700'),
  ('فشل البيع',     6, 'lost',   0, false, '{lost_reason_id}',  'bg-red-100 text-red-700')
on conflict (name) do nothing;

-- ⚠️ الحقول المطلوبة أعلاه فارغة عمداً عدا سبب الفشل. تشديدها (ميزانية
--    للتأهيل، مشروع للفرصة…) يأتي في 072 بعد وجود الحقول نفسها — فرضُ
--    حقل غير موجود يقفل خطّ المبيعات في وجه الجميع.

-- ------------------------------------------------------------
-- 3) crm_stage_transitions — أي انتقال مسموح
--    الصفّ الغائب = ممنوع، لكن الفرض نفسه لا يبدأ إلا في 072 بقرار.
-- ------------------------------------------------------------
create table if not exists public.crm_stage_transitions (
  from_stage_id uuid not null references public.crm_stages(id) on delete cascade,
  to_stage_id   uuid not null references public.crm_stages(id) on delete cascade,
  requires_role text,                     -- null = أي صاحب صلاحية على السجلّ
  primary key (from_stage_id, to_stage_id),
  check (from_stage_id <> to_stage_id)
);

-- البذرة: خطوة للأمام أو للخلف بين المراحل المفتوحة، والإغلاق من أيّها.
-- (السلوك الحالي يسمح بكل شيء؛ نبذر الخريطة الآن ونفرضها لاحقاً بقرار.)
insert into public.crm_stage_transitions (from_stage_id, to_stage_id)
select f.id, t.id
  from public.crm_stages f
  join public.crm_stages t on f.id <> t.id
 where f.stage_type = 'open'
   and (
        (t.stage_type = 'open' and abs(t.sort_order - f.sort_order) = 1)
        or t.stage_type in ('won', 'lost')
       )
on conflict do nothing;

-- ------------------------------------------------------------
-- 4) crm_sources — مصادر العملاء
-- ------------------------------------------------------------
create table if not exists public.crm_sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  category   text,                 -- تسويق رقمي | إحالة | مباشر | فعالية | آخر
  is_active  boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- البذرة من المصادر الموجودة فعلاً في البيانات — لا من قائمة مخترعة.
-- هكذا لا يظهر مصدر في القائمة ولا عميل عليه، ولا يبقى مصدرٌ على
-- عملاء وهو غائب عن التقارير.
insert into public.crm_sources (name, category, sort_order)
select distinct btrim(c.source),
       case
         when btrim(c.source) in ('سوشيل ميديا', 'سوشيال ميديا') then 'تسويق رقمي'
         when btrim(c.source) in ('صديق أو معارف')               then 'إحالة'
         when btrim(c.source) in ('مكتب عقاري')                  then 'إحالة'
         when btrim(c.source) in ('مرّ من المنطقة', 'مر من المنطقة') then 'مباشر'
         else 'آخر'
       end,
       100
  from public.clients c
 where c.source is not null
   and btrim(c.source) <> ''
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 5) crm_lost_reasons — «فشل البيع» بلا سبب رقمٌ لا يُفيد
-- ------------------------------------------------------------
create table if not exists public.crm_lost_reasons (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  category      text,               -- سعر | منتج | منافسة | عميل | تمويل | توقيت | آخر
  requires_note boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now()
);

insert into public.crm_lost_reasons (name, category, requires_note, sort_order) values
  ('السعر مرتفع',           'سعر',     false, 10),
  ('الموقع غير مناسب',      'منتج',    false, 20),
  ('خطة الدفع غير مناسبة',  'سعر',     false, 30),
  ('المساحة غير مناسبة',    'منتج',    false, 40),
  ('اشترى من منافس',        'منافسة',  true,  50),
  ('غيّر رأيه',             'عميل',    false, 60),
  ('لا يردّ على التواصل',    'عميل',    false, 70),
  ('تعذّر التمويل',         'تمويل',   false, 80),
  ('التوقيت غير مناسب',     'توقيت',   false, 90),
  ('تأخّر المشروع',         'منتج',    true,  100),
  ('فقد الثقة',             'عميل',    true,  110),
  ('سبب آخر',               'آخر',     true,  999)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 6) crm_activity_types — أنواع التواصل
--    counts_as_contact = يُحتسب في «عدد مرات التواصل» وفي تقارير النشاط.
--    «تغيير مرحلة» و«ملاحظة» خارجه — تماماً كما يستثنيهما الكود اليوم.
-- ------------------------------------------------------------
create table if not exists public.crm_activity_types (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  icon              text,
  color             text,
  has_direction     boolean not null default false,
  has_duration      boolean not null default false,
  is_system         boolean not null default false,   -- يسجّله النظام فلا يُختار يدوياً
  counts_as_contact boolean not null default true,
  is_active         boolean not null default true,
  sort_order        int not null default 100,
  created_at        timestamptz not null default now()
);

insert into public.crm_activity_types
  (name, icon, color, has_direction, has_duration, is_system, counts_as_contact, sort_order) values
  ('مكالمة',      'call',          'bg-blue-100 text-blue-700',     true,  true,  false, true,  10),
  ('واتساب',      'chat',          'bg-green-100 text-green-700',   true,  false, false, true,  20),
  ('اجتماع',      'groups',        'bg-purple-100 text-purple-700', false, true,  false, true,  30),
  ('زيارة',       'location_on',   'bg-indigo-100 text-indigo-700', false, true,  false, true,  40),
  ('عرض سعر',     'request_quote', 'bg-amber-100 text-amber-700',   false, false, false, true,  50),
  ('ملاحظة',      'sticky_note_2', 'bg-gray-100 text-gray-700',     false, false, false, false, 60),
  ('تغيير مرحلة', 'swap_horiz',    'bg-slate-100 text-slate-700',   false, false, true,  false, 900)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 7) crm_score_rules — قواعد التقييم (يستهلكها المحرّك في 074)
--    تُخزَّن الآن ليكون المحرّك لاحقاً قارئاً لا حاكماً، ولتُشرح كل
--    نقطة للموظف باسمها — لا درجة بلا سبب.
-- ------------------------------------------------------------
create table if not exists public.crm_score_rules (
  code       text primary key,
  label      text not null,              -- يُعرض كسبب في شرح الدرجة
  points     int  not null,
  param      numeric,                    -- عتبة القاعدة إن احتاجت (أيام مثلاً)
  is_active  boolean not null default true,
  sort_order int not null default 100
);

insert into public.crm_score_rules (code, label, points, param, sort_order) values
  ('budget_known',       'ميزانية محدّدة',            10, null, 10),
  ('project_selected',   'اختار مشروعاً',              10, null, 20),
  ('unit_selected',      'اختار وحدة بعينها',          15, null, 30),
  ('visit_done',         'زار الموقع',                 15, null, 40),
  ('offer_requested',    'طلب عرض سعر',                20, null, 50),
  ('recent_activity',    'تواصل خلال ٧ أيام',          10, 7,    60),
  ('reservation_intent', 'أبدى نيّة الحجز',            20, null, 70),
  ('decision_maker',     'صاحب القرار',                 5, null, 80),
  ('no_answer',          'لا يردّ',                   -10, null, 90),
  ('stale_short',        'بلا نشاط أكثر من ١٤ يوماً',  -5, 14,  100),
  ('stale_long',         'بلا نشاط أكثر من ٣٠ يوماً', -10, 30,  110)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 8) قارئات الإعدادات — نقطة وصول واحدة بقيمة احتياطية
--    كل مستهلك يمرّ من هنا، فلا ينتشر رقمٌ سحريّ ثانية.
-- ------------------------------------------------------------
create or replace function public.crm_setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (s.value #>> '{}')::numeric from public.crm_settings s where s.key = p_key),
    p_default
  );
$$;

comment on function public.crm_setting_num(text, numeric) is
  'قيمة إعداد رقمية. الافتراضي يُمرَّر من المستدعي فيبقى السلوك سليماً لو حُذف الصفّ.';

create or replace function public.crm_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select public.crm_setting_num(p_key, p_default::numeric)::int;
$$;

-- ------------------------------------------------------------
-- 9) is_open_stage — تقرأ الجدول بدل الاسمين المكتوبين
--
-- ⚠️ التقلّب يتغيّر من immutable إلى stable، و create or replace لا
--    يقبل تغيير التقلّب — فنُسقطها أولاً. فُحص قبل ذلك أنها لا
--    تُستعمل في أي فهرس ولا قيد check: خمسة استدعاءات، كلها داخل
--    أجسام محفّزات، فلا يسقط معها شيء.
-- ------------------------------------------------------------
drop function if exists public.is_open_stage(text);

create or replace function public.is_open_stage(stage text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.stage_type = 'open'
       from public.crm_stages s
      where s.name = coalesce(stage, 'ليد')),
    -- مرحلة غير معروفة في الجدول: نعود إلى القاعدة القديمة حرفياً.
    -- إبقاء ملف مفتوح بالخطأ أهون من إغلاقه بالخطأ.
    coalesce(stage, 'ليد') not in ('بيع', 'فشل البيع')
  );
$$;

-- ------------------------------------------------------------
-- 10) الصلاحيات
--     القراءة لكل مسجّل — الواجهة تبني منها القوائم المنسدلة.
--     الكتابة للمدير وحده: هذه قواعد تحكم تقارير الناس وحوافزهم.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crm_settings', 'crm_stages', 'crm_stage_transitions',
                           'crm_sources', 'crm_lost_reasons', 'crm_activity_types',
                           'crm_score_rules']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format(
      'create policy "read %1$s" on public.%1$I for select to authenticated using (true)', t);

    execute format('drop policy if exists "admin writes %1$s" on public.%1$I', t);
    execute format(
      'create policy "admin writes %1$s" on public.%1$I for all to authenticated '
      || 'using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

revoke all on function public.crm_setting_num(text, numeric) from public;
revoke all on function public.crm_setting_int(text, int)     from public;
revoke all on function public.is_open_stage(text)            from public;
grant execute on function public.crm_setting_num(text, numeric) to authenticated, service_role;
grant execute on function public.crm_setting_int(text, int)     to authenticated, service_role;
grant execute on function public.is_open_stage(text)            to authenticated, service_role;

-- ------------------------------------------------------------
-- 11) ختم من عدّل الإعداد — لا رقم يتغيّر بلا صاحب
-- ------------------------------------------------------------
create or replace function public.stamp_crm_setting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

drop trigger if exists trg_stamp_crm_setting on public.crm_settings;
create trigger trg_stamp_crm_setting
  before update on public.crm_settings
  for each row execute function public.stamp_crm_setting();

-- الإعدادات والمراحل تدخلان سجلّ التدقيق العام (058):
-- تغيير «٢١ يوماً» أو احتمال مرحلة يغيّر أرقام الإدارة، فيُعرف من غيّره.
drop trigger if exists trg_audit_crm_settings on public.crm_settings;
create trigger trg_audit_crm_settings
  after insert or update or delete on public.crm_settings
  for each row execute function public.audit_row();

drop trigger if exists trg_audit_crm_stages on public.crm_stages;
create trigger trg_audit_crm_stages
  after insert or update or delete on public.crm_stages
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 12) التحقّق — يطبع ما صار، فلا يُصدَّق النجاح على عهدة الصمت
-- ------------------------------------------------------------
do $$
declare
  n_stages int; n_sources int; n_reasons int; n_types int;
  n_settings int; n_trans int; mismatched int; bad_name text;
begin
  select count(*) into n_stages   from public.crm_stages;
  select count(*) into n_sources  from public.crm_sources;
  select count(*) into n_reasons  from public.crm_lost_reasons;
  select count(*) into n_types    from public.crm_activity_types;
  select count(*) into n_settings from public.crm_settings;
  select count(*) into n_trans    from public.crm_stage_transitions;

  -- أهمّ فحص: هل كل مرحلة مكتوبة على عميل موجودة في الجدول؟
  -- صفرٌ هنا شرطُ ألّا يتغيّر سلوك is_open_stage عمّا كان.
  select count(*) into mismatched
    from (select distinct coalesce(stage, 'ليد') s from public.clients) x
    left join public.crm_stages g on g.name = x.s
   where g.id is null;

  raise notice '--- 070 مركز إعدادات الـCRM ---';
  raise notice 'المراحل: %   الانتقالات: %', n_stages, n_trans;
  raise notice 'المصادر: %   أسباب الفشل: %   أنواع التواصل: %', n_sources, n_reasons, n_types;
  raise notice 'الإعدادات: %', n_settings;

  if mismatched > 0 then
    for bad_name in
      select distinct coalesce(c.stage, 'ليد')
        from public.clients c
        left join public.crm_stages g on g.name = coalesce(c.stage, 'ليد')
       where g.id is null
    loop
      raise warning 'مرحلة على عملاء وليست في crm_stages: «%»', bad_name;
    end loop;
    raise warning 'أضِف المراحل أعلاه إلى crm_stages قبل الاعتماد على الجدول.';
  else
    raise notice 'مطابقة المراحل: سليمة — كل مرحلة على العملاء لها صفّ.';
  end if;
end $$;

notify pgrst, 'reload schema';
