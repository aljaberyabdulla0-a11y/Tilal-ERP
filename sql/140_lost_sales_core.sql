-- ============================================================
-- تلال ERP — 140: تحليل الصفقات الخاسرة — النواة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- «فشل البيع» اليوم مرحلةٌ على الفرصة وسببٌ واحد من قائمة قصيرة
-- (crm_lost_reasons — 070). على القاعدة الحيّة: ٣٣٢ فرصة خاسرة،
-- ٨ منها فقط بسبب. فسؤال «لماذا نخسر؟» بلا جواب، وسؤال «كم نخسر؟»
-- بلا رقم: القيمة تُقرأ من الفرصة الآن لا يوم خسرناها، والمالك مالكها
-- الآن لا من كان يعمل عليها، والمرحلة «فشل البيع» لا التي سقطت منها.
--
-- ============================================================
-- المبدأ
--
--     الخسارة حدثٌ له سجلّ، لا حالةٌ تُكتب فوق الفرصة.
--
--     opportunities 1 ──── N crm_lost_sales   (خسارة، إعادة تنشيط، خسارة ثانية…)
--
-- الفرصة لا تُحذف ولا تتغيّر بياناتها. تُنقل إلى مرحلة الخسارة كما
-- كانت تُنقل، لكن **عبر نموذج التحليل وحده** (close_opportunity_lost)،
-- ويُكتب معها صفٌّ يجمّد أبعادها لحظة الخسارة: من كان مسؤولاً، ومشرفه،
-- والمشروع والوحدة ومساحتها وسعرها، وقيمة الصفقة وأساسها، والحملة
-- والمصدر، والمرحلة التي سقطت منها وأبعد نقطة بلغتها، وشواهد التواصل.
--
-- ثم إعادة التنشيط لا تمحو الخسارة: تُعلَّم «أُعيد تنشيطها»، فإن رُبحت
-- صارت «استُرجعت» بقيمتها، وإن خُسرت ثانيةً صارت «خُسرت مجدداً»
-- وكُتب صفٌّ ثانٍ. فنعرف المبيعات المسترجعة وقيمتها.
--
-- ============================================================
-- ما يضيفه
--
--   1) قوائم يديرها المدير: فئات الخسارة، مصادرها، جودة العميل،
--      مستويات الاسترجاع (بقاعدة موعد إعادة التواصل)
--   2) crm_lost_reasons تصير أسباباً فرعية تحت الفئات (بلا كسر القديم)
--   3) المنافسون: mkt_competitors (121) نفسه + مشاريعهم وأسعارها
--   4) crm_lost_sales + crm_lost_sale_changes (سجلّ تعديل مقروء)
--   5) الدوال: إغلاق كخسارة، تعديل، مراجعة، إعادة تنشيط
--   6) حارسان: لا خسارة بلا تحليل، ولا «فشل البيع» على بطاقة لها فرصة مفتوحة
--   7) تتبّع النتيجة تلقائياً (إعادة فتح من أي مكان، ربح بعد خسارة)
--   8) ترحيل: صفٌّ «غير محلَّل» لكل فرصة خاسرة قائمة — لا رقم يختفي
--
-- يتطلب: 070–072، 079، 083، 096، 104، 121. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 0) إعدادات
-- ------------------------------------------------------------
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('enforce_lost_analysis', '1', 'فرض تحليل الخسارة',
   'عند التفعيل لا تُغلق فرصة كخاسرة إلا عبر نموذج «تحليل سبب فقدان فرصة البيع» (140).', 'عدد', 0, 1),
  ('lost_edit_days', '7', 'مهلة تعديل الموظف لتحليل الخسارة',
   'يعدّل الموظف تحليل خسارته خلال هذه المدة من تاريخ الخسارة. المشرف والمدير يعدّلان دائماً. كل تعديل يُسجَّل.', 'يوم', 0, 90)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 1) القوائم المرجعية
--
-- الاسم بلغتين لأن الواجهة بلغتين. والكود ثابتٌ لا يُعاد تسميته:
-- التقارير والرؤى التلقائية تتعرّف على «السعر» و«المنافسة» بالكود،
-- والاسم الظاهر يتغيّر بحرّية.
-- ------------------------------------------------------------
create table if not exists public.crm_loss_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  name_en     text not null,
  default_source text,                       -- كود مصدر الخسارة المقترح عند اختيارها
  requires_competitor boolean not null default false,
  is_active   boolean not null default true,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now()
);

comment on table public.crm_loss_categories is
  'الفئة الرئيسية لفقدان البيع (السعر، خطة الدفع، المنافسة…). الكود ثابت؛ الاسم يُعدَّل من الإعدادات.';

create table if not exists public.crm_loss_sources (
  code        text primary key,
  name_ar     text not null,
  name_en     text not null,
  is_active   boolean not null default true,
  sort_order  int not null default 100
);

comment on table public.crm_loss_sources is
  'مصدر المشكلة: العميل، السعر، فريق المبيعات، التسويق، السوق… أهمّ حقل للتقارير: يفصل «من يُصلح» عن «ماذا حدث».';

create table if not exists public.crm_customer_potentials (
  code         text primary key,
  name_ar      text not null,
  name_en      text not null,
  is_qualified boolean not null default true,  -- D = غير مؤهّل: لم تكن فرصة حقيقية
  is_active    boolean not null default true,
  sort_order   int not null default 100
);

create table if not exists public.crm_recovery_levels (
  code               text primary key,
  name_ar            text not null,
  name_en            text not null,
  is_recoverable     boolean not null default false, -- يدخل «القيمة القابلة للاسترجاع»
  allows_recontact   boolean not null default true,
  recontact_required boolean not null default false, -- الافتراض في النموذج
  recontact_days     int check (recontact_days is null or recontact_days between 1 and 730),
  is_active          boolean not null default true,
  sort_order         int not null default 100
);

comment on table public.crm_recovery_levels is
  'قواعد الاسترجاع: لكل مستوى هل يدخل القيمة القابلة للاسترجاع، وهل يُقترح موعد إعادة تواصل وبعد كم يوماً.';

insert into public.crm_loss_categories (code, name_ar, name_en, default_source, requires_competitor, sort_order) values
  ('price',             'السعر',                    'Price',                    'price',          false, 10),
  ('payment_plan',      'خطة الدفع',                'Payment Plan',             'payment',        false, 20),
  ('unit',              'الوحدة / المنتج',          'Unit / Product',           'product',        false, 30),
  ('project',           'المشروع',                  'Project',                  'project',        false, 40),
  ('location',          'الموقع',                   'Location',                 'product',        false, 50),
  ('competition',       'المنافسة',                 'Competition',              'competition',    true,  60),
  ('customer_decision', 'قرار العميل',              'Customer Decision',        'customer',       false, 70),
  ('timing',            'التوقيت',                  'Timing',                   'customer',       false, 80),
  ('trust',             'الثقة / السمعة',           'Trust / Reputation',       'project',        false, 90),
  ('sales_employee',    'موظف المبيعات',            'Sales Employee',           'sales_employee', false, 100),
  ('availability',      'التوفّر',                  'Availability',             'product',        false, 110),
  ('financing',         'التمويل',                  'Financing',                'payment',        false, 120),
  ('family',            'قرار العائلة / الشريك',    'Family / Partner Decision','customer',       false, 130),
  ('project_delay',     'تأخّر المشروع',            'Project Delay',            'project',        false, 140),
  ('other',             'أخرى',                     'Other',                    null,             false, 999)
on conflict (code) do nothing;

insert into public.crm_loss_sources (code, name_ar, name_en, sort_order) values
  ('customer',       'العميل',          'Customer',        10),
  ('price',          'السعر',           'Price',           20),
  ('payment',        'الدفع',           'Payment',         30),
  ('project',        'المشروع',         'Project',         40),
  ('product',        'المنتج',          'Product',         50),
  ('sales_team',     'فريق المبيعات',   'Sales Team',      60),
  ('sales_employee', 'موظف المبيعات',   'Sales Employee',  70),
  ('marketing',      'التسويق',         'Marketing',       80),
  ('competition',    'المنافسة',        'Competition',     90),
  ('market',         'السوق',           'Market',          100),
  ('external',       'عامل خارجي',      'External Factor', 110)
on conflict (code) do nothing;

insert into public.crm_customer_potentials (code, name_ar, name_en, is_qualified, sort_order) values
  ('A', 'A — إمكانات عالية',   'A - High Potential',   true,  10),
  ('B', 'B — إمكانات متوسطة',  'B - Medium Potential', true,  20),
  ('C', 'C — إمكانات منخفضة',  'C - Low Potential',    true,  30),
  ('D', 'D — غير مؤهّل',       'D - Not Qualified',    false, 40)
on conflict (code) do nothing;

insert into public.crm_recovery_levels
  (code, name_ar, name_en, is_recoverable, allows_recontact, recontact_required, recontact_days, sort_order) values
  ('high',   'مرتفعة',          'High',        true,  true,  true,  30,   10),
  ('medium', 'متوسطة',          'Medium',      true,  true,  true,  60,   20),
  ('low',    'منخفضة',          'Low',         false, true,  false, 90,   30),
  ('none',   'لا استرجاع',      'No Recovery', false, false, false, null, 40)
on conflict (code) do nothing;

alter table public.crm_loss_categories
  drop constraint if exists crm_loss_categories_default_source_fkey;
alter table public.crm_loss_categories
  add constraint crm_loss_categories_default_source_fkey
  foreign key (default_source) references public.crm_loss_sources(code) on delete set null;

-- ------------------------------------------------------------
-- 2) الأسباب الفرعية — crm_lost_reasons نفسه، تحت الفئات
--
-- ⚠️ القيد القديم unique(name) يسقط: «الدفعة الأولى مرتفعة» سببٌ تحت
--    السعر وتحت خطة الدفع معاً، و«أخرى» تحت كل فئة. الفرادة صارت
--    (الفئة، الاسم). أثر جانبي واحد معلَن: إعادة تشغيل 070 تفشل عند
--    `on conflict (name)` — ولا سبب لإعادة تشغيلها.
--
--    عمود category النصّي يبقى مرآةً لاسم الفئة: crm_lost_analysis
--    (076) والإعدادات القديمة تقرآنه.
-- ------------------------------------------------------------
alter table public.crm_lost_reasons
  add column if not exists category_id uuid references public.crm_loss_categories(id) on delete restrict,
  add column if not exists name_en     text,
  add column if not exists is_other    boolean not null default false;

alter table public.crm_lost_reasons drop constraint if exists crm_lost_reasons_name_key;
create unique index if not exists crm_lost_reasons_cat_name_uq
  on public.crm_lost_reasons (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index if not exists crm_lost_reasons_category_idx on public.crm_lost_reasons (category_id, sort_order);

-- الأسباب القائمة تُلحق بفئاتها بأسمائها كما هي — الصفقات القديمة تشير إليها
update public.crm_lost_reasons r
   set category_id = c.id
  from public.crm_loss_categories c
 where r.category_id is null
   and c.code = case r.name
                  when 'السعر مرتفع'          then 'price'
                  when 'الموقع غير مناسب'     then 'location'
                  when 'خطة الدفع غير مناسبة' then 'payment_plan'
                  when 'المساحة غير مناسبة'   then 'unit'
                  when 'اشترى من منافس'       then 'competition'
                  when 'غيّر رأيه'            then 'customer_decision'
                  when 'لا يردّ على التواصل'   then 'customer_decision'
                  when 'تعذّر التمويل'        then 'financing'
                  when 'التوقيت غير مناسب'    then 'timing'
                  when 'تأخّر المشروع'        then 'project_delay'
                  when 'فقد الثقة'            then 'trust'
                  when 'سبب آخر'              then 'other'
                end;

update public.crm_lost_reasons set is_other = true, requires_note = true where name = 'سبب آخر';

update public.crm_lost_reasons set name_en = case name
    when 'السعر مرتفع'          then 'Price too high'
    when 'الموقع غير مناسب'     then 'Location not suitable'
    when 'خطة الدفع غير مناسبة' then 'Payment plan not suitable'
    when 'المساحة غير مناسبة'   then 'Unit size not suitable'
    when 'اشترى من منافس'       then 'Bought from a competitor'
    when 'غيّر رأيه'            then 'Changed his mind'
    when 'لا يردّ على التواصل'   then 'Not responding'
    when 'تعذّر التمويل'        then 'Financing failed'
    when 'التوقيت غير مناسب'    then 'Timing not suitable'
    when 'تأخّر المشروع'        then 'Project delayed'
    when 'فقد الثقة'            then 'Lost trust'
    when 'سبب آخر'              then 'Other reason'
  end
 where name_en is null;

-- البذرة: الأسباب المطلوبة لكل فئة. «أخرى» في كل فئة تُلزم بالتوضيح.
insert into public.crm_lost_reasons (category_id, name, name_en, requires_note, is_other, sort_order)
select c.id, x.name, x.name_en, x.is_other, x.is_other, x.sort_order
  from (values
    ('price', 'السعر أعلى من ميزانية العميل',          'Price above customer budget',          false, 11),
    ('price', 'السعر أعلى من المنافس',                 'Price higher than competitor',         false, 12),
    ('price', 'العميل طلب خصماً',                      'Customer requested a discount',        false, 13),
    ('price', 'قيمة العقار لا تناسب توقّع العميل',     'Value does not match expectation',     false, 14),
    ('price', 'سعر المتر مرتفع',                       'Price per sqm too high',               false, 15),
    ('price', 'الدفعة الأولى مرتفعة',                  'Down payment too high',                false, 16),
    ('price', 'القسط الشهري مرتفع',                    'Monthly instalment too high',          false, 17),
    ('price', 'غير مقتنع بالقيمة مقابل السعر',         'Not convinced of value for money',     false, 18),
    ('price', 'أخرى',                                  'Other',                                true,  998),

    ('payment_plan', 'الدفعة الأولى مرتفعة',           'Down payment too high',                false, 21),
    ('payment_plan', 'مدة التقسيط قصيرة',              'Instalment period too short',          false, 22),
    ('payment_plan', 'القسط الشهري مرتفع',             'Monthly instalment too high',          false, 23),
    ('payment_plan', 'يريد خطة دفع مختلفة',            'Wants a different payment plan',       false, 24),
    ('payment_plan', 'شروط الدفع غير مناسبة',          'Payment terms not suitable',           false, 25),
    ('payment_plan', 'أخرى',                           'Other',                                true,  998),

    ('unit', 'التصميم أو التوزيع الداخلي غير مناسب',   'Layout / design not suitable',         false, 31),
    ('unit', 'الطابق أو الإطلالة غير مناسبة',          'Floor / view not suitable',            false, 32),
    ('unit', 'عدد الغرف غير مناسب',                    'Number of rooms not suitable',         false, 33),
    ('unit', 'أخرى',                                   'Other',                                true,  998),

    ('project', 'المشروع غير مناسب',                   'Project not suitable',                 false, 41),
    ('project', 'الخدمات غير كافية',                   'Insufficient services',                false, 42),
    ('project', 'التصميم غير مناسب',                   'Design not suitable',                  false, 43),
    ('project', 'لا مرافق مناسبة',                     'No suitable amenities',                false, 44),
    ('project', 'عدم الثقة بالمشروع',                  'No trust in the project',              false, 45),
    ('project', 'عدم الثقة بالمطوّر',                  'No trust in the developer',            false, 46),
    ('project', 'موعد التسليم',                        'Delivery date',                        false, 47),
    ('project', 'أخرى',                                'Other',                                true,  998),

    ('location', 'بعيد عن العمل أو المدارس',           'Far from work / schools',              false, 51),
    ('location', 'المنطقة غير مرغوبة',                 'Area not desirable',                   false, 52),
    ('location', 'الخدمات المحيطة ضعيفة',              'Weak surrounding services',            false, 53),
    ('location', 'أخرى',                               'Other',                                true,  998),

    ('competition', 'اشترى من مشروع منافس',            'Bought from a competing project',      false, 61),
    ('competition', 'وجد سعراً أفضل',                  'Found a better price',                 false, 62),
    ('competition', 'وجد خطة دفع أفضل',                'Found a better payment plan',          false, 63),
    ('competition', 'موقع المنافس أفضل',               'Competitor location is better',        false, 64),
    ('competition', 'منتج المنافس أفضل',               'Competitor product is better',         false, 65),
    ('competition', 'خدمات المنافس أفضل',              'Competitor services are better',       false, 66),
    ('competition', 'ثقة أعلى بالمنافس',               'Higher trust in competitor',           false, 67),
    ('competition', 'عرض المنافس أفضل',                'Competitor offer is better',           false, 68),
    ('competition', 'أخرى',                            'Other',                                true,  998),

    ('customer_decision', 'العائلة رفضت',              'Family refused',                       false, 71),
    ('customer_decision', 'الشريك رفض',                'Partner refused',                      false, 72),
    ('customer_decision', 'أجّل قرار الشراء',          'Postponed the decision',               false, 73),
    ('customer_decision', 'تغيّرت ظروفه المالية',      'Financial circumstances changed',      false, 74),
    ('customer_decision', 'غير مستعدّ حالياً',         'Not ready now',                        false, 75),
    ('customer_decision', 'لم يعد بحاجة للعقار',       'No longer needs the property',         false, 76),
    ('customer_decision', 'أخرى',                      'Other',                                true,  998),

    ('timing', 'ينتظر انخفاض الأسعار',                 'Waiting for prices to drop',           false, 81),
    ('timing', 'ينتظر بيع عقار آخر',                   'Waiting to sell another property',     false, 82),
    ('timing', 'يريد تسليماً أقرب',                    'Wants earlier delivery',               false, 83),
    ('timing', 'أخرى',                                 'Other',                                true,  998),

    ('trust', 'سمعة المطوّر',                          'Developer reputation',                 false, 91),
    ('trust', 'تجربة سابقة سيئة',                      'Bad previous experience',              false, 92),
    ('trust', 'شكوك في الأوراق الرسمية',               'Doubts about legal documents',         false, 93),
    ('trust', 'أخرى',                                  'Other',                                true,  998),

    ('sales_employee', 'تأخّر الردّ على العميل',       'Slow response to customer',            false, 101),
    ('sales_employee', 'ضعف المتابعة',                 'Weak follow-up',                       false, 102),
    ('sales_employee', 'معلومات غير دقيقة',            'Inaccurate information',               false, 103),
    ('sales_employee', 'أسلوب تعامل غير مناسب',        'Unsuitable handling',                  false, 104),
    ('sales_employee', 'أخرى',                         'Other',                                true,  998),

    ('availability', 'الوحدة المطلوبة مباعة',          'Requested unit already sold',          false, 111),
    ('availability', 'لا تتوفّر المساحة المطلوبة',     'Requested size not available',         false, 112),
    ('availability', 'لا يتوفّر الطابق المطلوب',       'Requested floor not available',        false, 113),
    ('availability', 'أخرى',                           'Other',                                true,  998),

    ('financing', 'رُفض القرض المصرفي',                'Bank loan rejected',                   false, 121),
    ('financing', 'لا يملك الدفعة الأولى',             'Cannot afford the down payment',       false, 122),
    ('financing', 'أخرى',                              'Other',                                true,  998),

    ('family', 'العائلة رفضت',                         'Family refused',                       false, 131),
    ('family', 'الشريك رفض',                           'Partner refused',                      false, 132),
    ('family', 'خلاف على اختيار الوحدة',               'Disagreement on the unit',             false, 133),
    ('family', 'أخرى',                                 'Other',                                true,  998),

    ('project_delay', 'موعد التسليم بعيد',             'Delivery too far away',                false, 141),
    ('project_delay', 'توقّف العمل في المشروع',        'Construction stopped',                 false, 142),
    ('project_delay', 'أخرى',                          'Other',                                true,  998)
  ) as x(cat, name, name_en, is_other, sort_order)
  join public.crm_loss_categories c on c.code = x.cat
on conflict do nothing;

-- مرآة الاسم النصّي القديم من الفئة — قارئو 076 يبقون يعملون
create or replace function public.sync_lost_reason_category()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.category_id is not null then
    select name_ar into new.category from public.crm_loss_categories where id = new.category_id;
  end if;
  if new.is_other then
    new.requires_note := true;   -- «أخرى» بلا شرح لا تُفيد التقرير شيئاً
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_lost_reason_category on public.crm_lost_reasons;
create trigger trg_sync_lost_reason_category
  before insert or update on public.crm_lost_reasons
  for each row execute function public.sync_lost_reason_category();

update public.crm_lost_reasons set category_id = category_id where category_id is not null;

-- ------------------------------------------------------------
-- 3) المنافسون — mkt_competitors (121) نفسه
--
-- لا جدول ثانٍ: التسويق يعرف المنافسين أصلاً، والمبيعات تختار منهم.
-- نضيف مشاريعهم بأسعارها لأن المقارنة («١٬٩٥٠٬٠٠٠ للمتر عندهم
-- و٢٬٢٥٠٬٠٠٠ عندنا») تحتاج رقماً لكل مشروع لا لكل شركة.
-- ------------------------------------------------------------
alter table public.mkt_competitors
  add column if not exists name_en   text,
  add column if not exists website   text,
  add column if not exists is_active boolean not null default true;

create table if not exists public.mkt_competitor_projects (
  id             uuid primary key default gen_random_uuid(),
  competitor_id  uuid not null references public.mkt_competitors(id) on delete cascade,
  name           text not null,
  location       text,
  price_per_m2   numeric check (price_per_m2 is null or price_per_m2 >= 0),
  min_unit_m2    numeric,
  max_unit_m2    numeric,
  payment_plan   text,
  delivery       text,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (competitor_id, name)
);

create index if not exists mkt_competitor_projects_comp_idx on public.mkt_competitor_projects (competitor_id);

-- ------------------------------------------------------------
-- 4) crm_lost_sales — الخسارة كحدث
-- ------------------------------------------------------------
create table if not exists public.crm_lost_sales (
  id              uuid primary key default gen_random_uuid(),
  -- restrict: لا تُمحى فرصةٌ لها خسارة مسجّلة. الحذف الصحيح للفرصة ناعم (072).
  opportunity_id  uuid not null references public.opportunities(id) on delete restrict,
  loss_no         int  not null default 1,          -- الخسارة الأولى لهذه الفرصة أم الثانية بعد التنشيط
  lost_at         timestamptz not null default now(),
  lost_by         uuid references auth.users(id) on delete set null,
  lost_by_name    text,
  is_backfilled   boolean not null default false,   -- مُرحَّل من فرصة خاسرة قبل 140

  -- ===== الأبعاد مجمّدة لحظة الخسارة =====
  -- (لا client_id عمداً: العميل يُقرأ من الفرصة، فيتبعها عند الدمج — 104)
  owner_id        uuid references public.employees(id) on delete set null,
  owner_name      text,
  manager_id      uuid references public.employees(id) on delete set null,  -- مشرف فريق المالك يومها
  team_id         uuid references public.projects(id)  on delete set null,  -- الفريق = مشروع الموظف (037)
  project_id      uuid references public.projects(id)  on delete set null,
  unit_id         uuid references public.units(id)     on delete set null,
  source_id       uuid references public.crm_sources(id) on delete set null,
  source_name     text,
  campaign_id     uuid references public.crm_campaigns(id) on delete set null,

  -- ===== أين سقطت =====
  lost_stage_id     uuid references public.crm_stages(id) on delete set null,
  lost_stage_name   text,          -- الاسم يُحفظ نصّاً: إعادة تسمية مرحلة لا تعيد كتابة الماضي
  lost_stage_order  int,
  furthest_milestone text,         -- أبعد نقطة بلغتها بالشواهد (crm_opportunity_milestone)
  days_in_pipeline  numeric,
  days_in_stage     numeric,

  -- ===== كم خسرنا =====
  unit_type         text,
  area_m2           numeric,
  price_per_m2      numeric,
  unit_price        numeric,
  discount          numeric check (discount is null or discount >= 0),
  lost_value        numeric check (lost_value is null or lost_value >= 0),
  value_basis       text not null default 'none'
                    check (value_basis in ('deal', 'unit', 'budget', 'manual', 'none')),
  payment_plan      text,
  expected_revenue    numeric,     -- عمولة تلال المتوقّعة = إيرادها (056)
  expected_commission numeric,     -- عمولة موظف البيع المتوقّعة بقاعدته (048)

  -- ===== لماذا =====
  category_id        uuid references public.crm_loss_categories(id) on delete restrict,
  reason_id          uuid references public.crm_lost_reasons(id)    on delete restrict,
  loss_source        text references public.crm_loss_sources(code)        on update cascade,
  customer_potential text references public.crm_customer_potentials(code) on update cascade,
  recovery_potential text references public.crm_recovery_levels(code)     on update cascade,
  recontact_required boolean not null default false,
  recontact_date     date,
  recovery_reason    text,
  details            text,

  -- ===== المنافس =====
  competitor_id            uuid references public.mkt_competitors(id) on delete set null,
  competitor_project_id    uuid references public.mkt_competitor_projects(id) on delete set null,
  competitor_name          text,    -- منافسٌ ليس في القائمة بعد
  competitor_price         numeric check (competitor_price is null or competitor_price >= 0),
  competitor_price_per_m2  numeric check (competitor_price_per_m2 is null or competitor_price_per_m2 >= 0),
  competitor_unit_m2       numeric,
  competitor_payment_plan  text,
  competitor_advantage     text,
  competitor_choice_reason text,

  -- ===== الشواهد حتى لحظة الخسارة =====
  contacts_count   int,
  meetings_count   int,
  visits_count     int,
  offers_count     int,
  last_contact_at  timestamptz,
  reservation_id   uuid references public.reservations(id) on delete set null,

  -- ===== المتابعة والاسترجاع =====
  recontact_task_id   uuid references public.tasks(id) on delete set null,
  outcome             text not null default 'lost'
                      check (outcome in ('lost', 'reactivated', 'recovered', 'relost')),
  reactivated_at      timestamptz,
  reactivated_by      uuid references auth.users(id) on delete set null,
  reactivated_by_name text,
  reactivation_note   text,
  closed_after_at     timestamptz,  -- متى أُغلقت ثانيةً بعد التنشيط (ربحاً أو خسارة)
  recovered_value     numeric,

  -- ===== مراجعة المشرف =====
  review_status    text not null default 'pending' check (review_status in ('pending', 'confirmed', 'disputed')),
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_note      text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_by_name  text,

  -- الإلزام في القاعدة لا في النموذج وحده. المُرحَّل وحده يُعفى:
  -- خسارةٌ وقعت قبل وجود الحقول لا يُخترع لها سبب.
  constraint crm_lost_sales_mandatory check (
    is_backfilled
    or (category_id is not null and reason_id is not null and loss_source is not null
        and customer_potential is not null and recovery_potential is not null
        and lost_stage_id is not null)
  ),
  constraint crm_lost_sales_recontact check (not recontact_required or recontact_date is not null),
  unique (opportunity_id, loss_no)
);

comment on table public.crm_lost_sales is
  'خسارة صفقة كحدث: الفرصة تبقى كما هي، وهذا الصفّ يجمّد أبعادها لحظة الخسارة ويحمل التحليل والاسترجاع. يُكتب عبر close_opportunity_lost وحدها (140).';

-- خسارةٌ قائمة واحدة لكل فرصة — ما قبلها أُعيد تنشيطه أو استُرجع
create unique index if not exists crm_lost_sales_one_open_uq
  on public.crm_lost_sales (opportunity_id) where outcome = 'lost';
create index if not exists crm_lost_sales_lost_at_idx   on public.crm_lost_sales (lost_at desc);
create index if not exists crm_lost_sales_owner_idx     on public.crm_lost_sales (owner_id, lost_at desc);
create index if not exists crm_lost_sales_project_idx   on public.crm_lost_sales (project_id, lost_at desc);
create index if not exists crm_lost_sales_category_idx  on public.crm_lost_sales (category_id);
create index if not exists crm_lost_sales_competitor_idx on public.crm_lost_sales (competitor_id) where competitor_id is not null;
create index if not exists crm_lost_sales_recontact_idx on public.crm_lost_sales (recontact_date)
  where outcome = 'lost' and recontact_required;

-- ------------------------------------------------------------
-- 5) سجلّ التعديل — مقروءٌ لا JSON
--
-- audit_log (058) يحفظ الصفّ كاملاً قبل وبعد، وهو للتحقيق. هذا للعرض:
-- «غيّر أحمد الفئة من السعر إلى المنافسة يوم ٣ أكتوبر، والسبب: …».
-- بلا مفتاح أجنبي عمداً: حذف المدير للتحليل لا يمحو أثره.
-- ------------------------------------------------------------
create table if not exists public.crm_lost_sale_changes (
  id              bigserial primary key,
  lost_sale_id    uuid not null,
  opportunity_id  uuid not null,
  field           text not null,
  old_value       text,
  new_value       text,
  edit_reason     text,
  changed_by      uuid references auth.users(id) on delete set null,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);

create index if not exists crm_lost_sale_changes_sale_idx on public.crm_lost_sale_changes (lost_sale_id, changed_at desc);
create index if not exists crm_lost_sale_changes_opp_idx  on public.crm_lost_sale_changes (opportunity_id, changed_at desc);

create or replace function public.log_lost_sale_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text; who text;
  -- الحقول التجارية وحدها — الطوابع الزمنية وأسماء المعدِّلين ليست «تغييراً»
  tracked constant text[] := array[
    'category_id','reason_id','loss_source','customer_potential','recovery_potential',
    'recontact_required','recontact_date','recovery_reason','details',
    'lost_value','value_basis','discount',
    'competitor_id','competitor_project_id','competitor_name','competitor_price',
    'competitor_price_per_m2','competitor_unit_m2','competitor_payment_plan',
    'competitor_advantage','competitor_choice_reason',
    'outcome','review_status','review_note','reactivation_note','recovered_value'];
begin
  who := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');

  if tg_op = 'DELETE' then
    insert into public.crm_lost_sale_changes
      (lost_sale_id, opportunity_id, field, old_value, new_value, edit_reason, changed_by, changed_by_name)
    values (old.id, old.opportunity_id, '__deleted', to_jsonb(old)::text, null,
            nullif(current_setting('tilal.lost_edit_reason', true), ''), auth.uid(), who);
    return old;
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach k in array tracked loop
    if o -> k is distinct from n -> k then
      insert into public.crm_lost_sale_changes
        (lost_sale_id, opportunity_id, field, old_value, new_value, edit_reason, changed_by, changed_by_name)
      values (new.id, new.opportunity_id, k, o ->> k, n ->> k,
              nullif(current_setting('tilal.lost_edit_reason', true), ''), auth.uid(), who);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_log_lost_sale_change on public.crm_lost_sales;
create trigger trg_log_lost_sale_change
  after update or delete on public.crm_lost_sales
  for each row execute function public.log_lost_sale_change();

create or replace function public.stamp_lost_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  -- الأبعاد المجمّدة لا تُعدَّل بعد الكتابة: هي ما كان يوم الخسارة
  new.opportunity_id := old.opportunity_id;
  new.loss_no        := old.loss_no;
  new.lost_at        := old.lost_at;
  new.lost_by        := old.lost_by;
  new.owner_id       := old.owner_id;
  new.lost_stage_id  := old.lost_stage_id;
  new.created_at     := old.created_at;
  return new;
end $$;

drop trigger if exists trg_stamp_lost_sale on public.crm_lost_sales;
create trigger trg_stamp_lost_sale
  before update on public.crm_lost_sales
  for each row execute function public.stamp_lost_sale();

drop trigger if exists trg_audit_crm_lost_sales on public.crm_lost_sales;
create trigger trg_audit_crm_lost_sales
  after insert or update or delete on public.crm_lost_sales
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 6) نوعا نشاط نظاميان — الخسارة والتنشيط يظهران في تسلسل العميل
--
-- ⚠️ is_system_activity يقابله SYSTEM_ACTIVITY_TYPES في src/lib/types.ts.
--    نظاميٌّ لأن rule 028 ترفض نشاطاً بلا موعد على عميل مفتوح، ولأنه
--    حدثٌ يكتبه النظام لا تواصلٌ يُحتسب في عدّاد الاتصالات.
-- ------------------------------------------------------------
create or replace function public.is_system_activity(p_type text)
returns boolean language sql immutable as $$
  select p_type in ('تغيير مرحلة', 'تسليم', 'حجز', 'دمج', 'تحليل خسارة', 'إعادة تنشيط');
$$;

insert into public.crm_activity_types
  (name, icon, color, has_direction, has_duration, is_system, counts_as_contact, sort_order) values
  ('تحليل خسارة', 'heart_broken', 'bg-red-100 text-red-700',      false, false, true, false, 920),
  ('إعادة تنشيط', 'restart_alt',  'bg-emerald-100 text-emerald-700', false, false, true, false, 930)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 7) الدوال المساعدة
-- ------------------------------------------------------------

-- أبعد نقطة بلغتها الفرصة — بالشواهد لا بالمرحلة وحدها.
-- مراحل الخطّ أربع، والقمع الذي تسأل عنه الإدارة تسع نقاط (تأهيل،
-- اجتماع، زيارة موقع، عرض…). لا نضيف مراحل (قرارٌ يغيّر خطّ الجميع)؛
-- نستنتج النقطة مما سُجِّل فعلاً: حجزٌ، عرضُ سعر، زيارة، اجتماع، تأهيل.
create or replace function public.crm_opportunity_milestone(p_opp uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  o public.opportunities%rowtype;
  reached text[];
  acts text[];
  any_contact boolean;
begin
  select * into o from public.opportunities where id = p_opp;
  if o.id is null then return null; end if;

  select coalesce(array_agg(distinct g.name), '{}') into reached
    from (select o.stage_id as sid
          union select h.to_stage_id   from public.opportunity_stage_history h where h.opportunity_id = p_opp
          union select h.from_stage_id from public.opportunity_stage_history h where h.opportunity_id = p_opp) s
    join public.crm_stages g on g.id = s.sid;

  -- نشاط العميل غير المربوط بفرصة يُحتسب لها — أغلب التواصل اليوم بلا ربط
  select coalesce(array_agg(distinct a.activity_type), '{}'),
         coalesce(bool_or(t.counts_as_contact), false)
    into acts, any_contact
    from public.client_activities a
    left join public.crm_activity_types t on t.name = a.activity_type
   where a.client_id = o.client_id
     and (a.opportunity_id = p_opp or a.opportunity_id is null);

  if exists (select 1 from public.reservations r
              where r.opportunity_id = p_opp and r.down_payment_confirmed_at is not null) then
    return 'contract';
  elsif exists (select 1 from public.reservations r where r.opportunity_id = p_opp) then
    return 'reservation';
  elsif 'مناقشة العرض' = any(reached) then
    return 'negotiation';
  elsif 'عرض سعر' = any(acts) then
    return 'offer';
  elsif 'زيارة' = any(acts) or 'زيارة' = any(reached) then
    return 'site_visit';
  elsif 'اجتماع' = any(acts) then
    return 'meeting';
  elsif exists (select 1 from public.clients c where c.id = o.client_id and c.qualified_at is not null) then
    return 'qualified';
  elsif any_contact or 'اتصال' = any(reached) then
    return 'contacted';
  end if;
  return 'new';
end $$;

-- من يملك تعديل الفرصة — نفس سياسة «update opportunities» (072) حرفياً
create or replace function public.crm_can_edit_opportunity(p_opp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.opportunities o
     where o.id = p_opp and o.deleted_at is null
       and (public.is_admin()
            or public.is_followup_manager()
            or (o.owner_id is not null and o.owner_id in (select s.id from public.my_scope_employees() s))
            or public.can_see_client(o.client_id))
  );
$$;

-- من يراجع خسارة ويعدّلها بلا مهلة: المدير ومدير المتابعة دائماً،
-- والمشرف على خسائر فريقه. (الموظف ليس مديراً لنفسه.)
create or replace function public.crm_can_manage_lost(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.is_followup_manager()
      or (public.is_supervisor()
          and p_owner is not null
          and p_owner in (select s.id from public.my_scope_employees() s));
$$;

-- يبني صفّ الخسارة بأبعاده المجمّدة. التحليل نفسه يملؤه المستدعي.
create or replace function public.crm_build_lost_row(
  p_opp uuid, p_lost_stage_id uuid, p_lost_at timestamptz
) returns public.crm_lost_sales
language plpgsql security definer set search_path = public as $$
declare
  v    public.crm_lost_sales%rowtype;
  o    public.opportunities%rowtype;
  c    public.clients%rowtype;
  u    public.units%rowtype;
  g    public.crm_stages%rowtype;
  rule public.employee_commission_rules%rowtype;
  rate numeric;
begin
  select * into o from public.opportunities where id = p_opp;
  select * into c from public.clients where id = o.client_id;
  if o.unit_id is not null then
    select * into u from public.units where id = o.unit_id;
  end if;
  select * into g from public.crm_stages where id = p_lost_stage_id;

  v.id             := gen_random_uuid();
  v.opportunity_id := o.id;
  v.lost_at        := coalesce(p_lost_at, now());
  v.lost_by        := auth.uid();
  v.lost_by_name   := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  v.is_backfilled  := false;
  v.loss_no        := 1 + coalesce((select max(l.loss_no) from public.crm_lost_sales l where l.opportunity_id = o.id), 0);

  v.owner_id := o.owner_id;
  select e.full_name, e.project_id into v.owner_name, v.team_id
    from public.employees e where e.id = o.owner_id;
  select p.supervisor_id into v.manager_id from public.projects p where p.id = v.team_id;

  v.project_id  := coalesce(o.project_id, u.project_id);
  v.unit_id     := o.unit_id;
  v.source_id   := o.source_id;
  v.source_name := coalesce((select s.name from public.crm_sources s where s.id = o.source_id), c.source);
  v.campaign_id := coalesce(o.campaign_id, c.campaign_id);

  v.lost_stage_id    := g.id;
  v.lost_stage_name  := g.name;
  v.lost_stage_order := g.sort_order;
  v.furthest_milestone := public.crm_opportunity_milestone(o.id);
  v.days_in_pipeline := round((extract(epoch from (v.lost_at - o.created_at)) / 86400.0)::numeric, 1);
  v.days_in_stage    := round((extract(epoch from (v.lost_at - o.stage_entered_at)) / 86400.0)::numeric, 1);

  v.unit_type    := coalesce(u.unit_type, c.preferred_unit_type);
  v.area_m2      := coalesce(u.space_m2, u.built_area_m2);
  v.unit_price   := u.price;
  v.price_per_m2 := coalesce(u.price_per_m2,
                             case when coalesce(v.area_m2, 0) > 0 and coalesce(u.price, 0) > 0
                                  then round(u.price / v.area_m2) end);
  v.payment_plan := coalesce(u.payment_plan, o.payment_method, c.payment_method);

  -- قيمة الصفقة الخاسرة وأساسها — الأساس يُحفظ كي لا يُقرأ تقديرٌ كأنه عقد
  if coalesce(o.expected_value, 0) > 0 then
    v.lost_value := o.expected_value;  v.value_basis := 'deal';
  elsif coalesce(u.price, 0) > 0 then
    v.lost_value := u.price;           v.value_basis := 'unit';
  elsif o.budget_min is not null or o.budget_max is not null then
    v.lost_value := (coalesce(o.budget_min, o.budget_max) + coalesce(o.budget_max, o.budget_min)) / 2.0;
    v.value_basis := 'budget';
  elsif c.budget_min is not null or c.budget_max is not null then
    v.lost_value := (coalesce(c.budget_min, c.budget_max) + coalesce(c.budget_max, c.budget_min)) / 2.0;
    v.value_basis := 'budget';
  else
    v.value_basis := 'none';
  end if;

  -- الإيراد المتوقّع = عمولة تلال بنسبة المشروع (056)؛ وعمولة الموظف بقاعدته (048)
  if v.project_id is not null and v.lost_value is not null then
    rate := public.project_commission_rate(v.project_id, 1);
    if coalesce(rate, 0) > 0 then
      v.expected_revenue := round(v.lost_value * rate / 100.0);
    end if;
  end if;
  if o.owner_id is not null and v.lost_value is not null then
    select * into rule from public.resolve_commission_rule(o.owner_id, v.project_id, v.area_m2);
    if rule.id is not null then
      v.expected_commission := case rule.kind
        when 'نسبة من عمولة الشركة' then round(coalesce(v.expected_revenue, 0) * rule.value / 100)
        when 'نسبة من سعر البيع'    then round(v.lost_value * rule.value / 100)
        when 'مبلغ لكل متر'          then round(coalesce(v.area_m2, 0) * rule.value)
        else round(rule.value)
      end;
    end if;
  end if;

  -- الشواهد حتى لحظة الخسارة
  select count(*) filter (where t.counts_as_contact),
         count(*) filter (where a.activity_type = 'اجتماع'),
         count(*) filter (where a.activity_type = 'زيارة'),
         count(*) filter (where a.activity_type = 'عرض سعر'),
         max(a.occurred_at) filter (where t.counts_as_contact)
    into v.contacts_count, v.meetings_count, v.visits_count, v.offers_count, v.last_contact_at
    from public.client_activities a
    left join public.crm_activity_types t on t.name = a.activity_type
   where a.client_id = o.client_id
     and (a.opportunity_id = o.id or a.opportunity_id is null)
     and a.occurred_at <= v.lost_at;

  select r.id into v.reservation_id
    from public.reservations r where r.opportunity_id = o.id
   order by r.created_at desc limit 1;

  v.recontact_required := false;
  v.outcome            := 'lost';
  v.review_status      := 'pending';
  v.created_at         := now();
  v.updated_at         := now();
  return v;
end $$;

-- ------------------------------------------------------------
-- 8) تحقّق التحليل — دالة واحدة يستعملها الإغلاق والتعديل
--    تُرجع الحقول مُطبَّعة أو ترفع رسالة يفهمها الموظف.
-- ------------------------------------------------------------
create or replace function public.crm_validate_lost_payload(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cat  public.crm_loss_categories%rowtype;
  rsn  public.crm_lost_reasons%rowtype;
  rec  public.crm_recovery_levels%rowtype;
  v_details text := nullif(btrim(coalesce(p->>'details', '')), '');
  v_rc_req  boolean;
  v_rc_date date;
  v_comp    uuid := nullif(p->>'competitor_id', '')::uuid;
  v_cproj   uuid := nullif(p->>'competitor_project_id', '')::uuid;
  v_cname   text := nullif(btrim(coalesce(p->>'competitor_name', '')), '');
begin
  select * into cat from public.crm_loss_categories
   where id = nullif(p->>'category_id', '')::uuid and is_active;
  if cat.id is null then
    raise exception 'اختر الفئة الرئيسية لفقدان البيع.';
  end if;

  select * into rsn from public.crm_lost_reasons
   where id = nullif(p->>'reason_id', '')::uuid and is_active;
  if rsn.id is null then
    raise exception 'اختر سبب فقدان البيع.';
  end if;
  if rsn.category_id is distinct from cat.id then
    raise exception 'السبب المختار لا يتبع الفئة «%».', cat.name_ar;
  end if;

  if not exists (select 1 from public.crm_loss_sources where code = p->>'loss_source' and is_active) then
    raise exception 'اختر مصدر فقدان البيع.';
  end if;
  if not exists (select 1 from public.crm_customer_potentials where code = p->>'customer_potential' and is_active) then
    raise exception 'اختر جودة العميل (A/B/C/D).';
  end if;
  select * into rec from public.crm_recovery_levels where code = p->>'recovery_potential' and is_active;
  if rec.code is null then
    raise exception 'اختر إمكانية الاسترجاع.';
  end if;

  -- «أخرى» أو سببٌ يتطلّب توضيحاً: سطرٌ لا يُقرأ كلمةً واحدة
  if (rsn.is_other or rsn.requires_note or cat.code = 'other')
     and coalesce(length(v_details), 0) < 10 then
    raise exception 'هذا السبب يتطلّب شرحاً مفصّلاً في «تفاصيل فقدان البيع» (١٠ أحرف على الأقل).';
  end if;

  if cat.requires_competitor and v_comp is null and v_cname is null then
    raise exception 'الخسارة لمنافس: اختر المنافس من القائمة أو اكتب اسمه.';
  end if;
  if v_cproj is not null and not exists (
       select 1 from public.mkt_competitor_projects cp
        where cp.id = v_cproj and (v_comp is null or cp.competitor_id = v_comp)) then
    raise exception 'مشروع المنافس لا يتبع المنافس المختار.';
  end if;
  if v_cproj is not null and v_comp is null then
    select competitor_id into v_comp from public.mkt_competitor_projects where id = v_cproj;
  end if;

  -- إعادة التواصل بقاعدة المستوى، والموظف يعدّل الافتراض
  if not rec.allows_recontact then
    v_rc_req := false;
    v_rc_date := null;
  else
    v_rc_req := coalesce((p->>'recontact_required')::boolean, rec.recontact_required);
    v_rc_date := nullif(p->>'recontact_date', '')::date;
    if v_rc_req and v_rc_date is null then
      v_rc_date := public.baghdad_today() + coalesce(rec.recontact_days, 30);
    end if;
    if not v_rc_req then
      v_rc_date := null;
    end if;
  end if;
  if v_rc_req and v_rc_date <= public.baghdad_today() then
    raise exception 'موعد إعادة التواصل يجب أن يكون بعد اليوم.';
  end if;

  return jsonb_build_object(
    'category_id', cat.id, 'reason_id', rsn.id,
    'loss_source', p->>'loss_source',
    'customer_potential', p->>'customer_potential',
    'recovery_potential', rec.code,
    'recontact_required', v_rc_req, 'recontact_date', v_rc_date,
    'recovery_reason', nullif(btrim(coalesce(p->>'recovery_reason', '')), ''),
    'details', v_details,
    'discount', nullif(p->>'discount', '')::numeric,
    'competitor_id', v_comp, 'competitor_project_id', v_cproj,
    'competitor_name', case when v_comp is null then v_cname end,
    'competitor_price', nullif(p->>'competitor_price', '')::numeric,
    'competitor_price_per_m2', coalesce(nullif(p->>'competitor_price_per_m2', '')::numeric,
        (select cp.price_per_m2 from public.mkt_competitor_projects cp where cp.id = v_cproj)),
    'competitor_unit_m2', nullif(p->>'competitor_unit_m2', '')::numeric,
    'competitor_payment_plan', coalesce(nullif(btrim(coalesce(p->>'competitor_payment_plan', '')), ''),
        (select cp.payment_plan from public.mkt_competitor_projects cp where cp.id = v_cproj)),
    'competitor_advantage', nullif(btrim(coalesce(p->>'competitor_advantage', '')), ''),
    'competitor_choice_reason', nullif(btrim(coalesce(p->>'competitor_choice_reason', '')), ''),
    'reason_name', rsn.name, 'category_name', cat.name_ar,
    'is_competition', cat.requires_competitor
  );
end $$;

-- مهمة إعادة التواصل — تظهر في «يومي» وتذكّر بها مهمة tasks-daily-reminder
create or replace function public.crm_upsert_recontact_task(
  p_task uuid, p_opp uuid, p_owner uuid, p_date date, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.opportunities%rowtype;
  assignee uuid;
  t_id uuid := p_task;
begin
  select * into o from public.opportunities where id = p_opp;
  select e.user_id into assignee from public.employees e where e.id = p_owner;
  assignee := coalesce(assignee, auth.uid());

  if t_id is not null and exists (select 1 from public.tasks where id = t_id and status in ('جديدة', 'قيد التنفيذ')) then
    update public.tasks set due_date = p_date, follow_up_date = p_date where id = t_id;
    return t_id;
  end if;

  insert into public.tasks
    (title, description, assigned_to, due_date, follow_up_date, priority, status,
     client_id, related_client, opportunity_id, next_step)
  values
    ('إعادة تواصل — فرصة خاسرة: ' || coalesce(o.title, 'فرصة'),
     coalesce(p_note, 'موعد إعادة التواصل الذي حُدِّد عند تحليل الخسارة.'),
     assignee, p_date, p_date, 'متوسطة', 'جديدة',
     o.client_id, o.client_id, o.id, 'اتصل بالعميل وقيّم إعادة تنشيط الفرصة')
  returning id into t_id;
  return t_id;
end $$;

-- ------------------------------------------------------------
-- 9) الإغلاق كخسارة — الباب الوحيد
-- ------------------------------------------------------------
create or replace function public.close_opportunity_lost(p_opportunity_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o      public.opportunities%rowtype;
  g_from public.crm_stages%rowtype;
  g_lost uuid;
  vp     jsonb;
  v      public.crm_lost_sales%rowtype;
  actor  text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  if auth.uid() is null then
    raise exception 'سجّل الدخول أولاً.';
  end if;
  if not public.crm_can_edit_opportunity(p_opportunity_id) then
    raise exception 'لا صلاحية لك على هذه الفرصة.';
  end if;

  select * into o from public.opportunities where id = p_opportunity_id for update;
  select * into g_from from public.crm_stages where id = o.stage_id;
  if g_from.stage_type = 'lost' then
    raise exception 'الفرصة مغلقة كخاسرة أصلاً — عدّل تحليلها بدل إغلاقها ثانيةً.';
  elsif g_from.stage_type = 'won' then
    raise exception 'فرصة رابحة لا تُغلق كخاسرة. إن أُلغي البيع فاعكسه من الحجز أولاً.';
  end if;

  select id into g_lost from public.crm_stages
   where stage_type = 'lost' and is_active
     and (nullif(p->>'lost_stage_id', '') is null or id = (p->>'lost_stage_id')::uuid)
   order by sort_order limit 1;
  if g_lost is null then
    raise exception 'لا مرحلة خسارة فعّالة في إعدادات الـCRM.';
  end if;

  vp := public.crm_validate_lost_payload(p);

  -- المرحلة التي سقطت منها = مرحلتها الآن. لا يُسأل الموظف عنها.
  v := public.crm_build_lost_row(o.id, o.stage_id, now());
  v.category_id        := (vp->>'category_id')::uuid;
  v.reason_id          := (vp->>'reason_id')::uuid;
  v.loss_source        := vp->>'loss_source';
  v.customer_potential := vp->>'customer_potential';
  v.recovery_potential := vp->>'recovery_potential';
  v.recontact_required := (vp->>'recontact_required')::boolean;
  v.recontact_date     := (vp->>'recontact_date')::date;
  v.recovery_reason    := vp->>'recovery_reason';
  v.details            := vp->>'details';
  v.discount           := (vp->>'discount')::numeric;
  v.competitor_id            := (vp->>'competitor_id')::uuid;
  v.competitor_project_id    := (vp->>'competitor_project_id')::uuid;
  v.competitor_name          := vp->>'competitor_name';
  v.competitor_price         := (vp->>'competitor_price')::numeric;
  v.competitor_price_per_m2  := (vp->>'competitor_price_per_m2')::numeric;
  v.competitor_unit_m2       := (vp->>'competitor_unit_m2')::numeric;
  v.competitor_payment_plan  := vp->>'competitor_payment_plan';
  v.competitor_advantage     := vp->>'competitor_advantage';
  v.competitor_choice_reason := vp->>'competitor_choice_reason';

  -- خسارة ثانية بعد تنشيط: الأولى تُعلَّم «خُسرت مجدداً» ولا تُمحى
  update public.crm_lost_sales
     set outcome = 'relost', closed_after_at = now()
   where opportunity_id = o.id and outcome = 'reactivated';

  if v.recontact_required then
    v.recontact_task_id := public.crm_upsert_recontact_task(
      null, o.id, o.owner_id, v.recontact_date,
      'السبب: ' || (vp->>'category_name') || ' — ' || (vp->>'reason_name')
      || coalesce(E'\n' || v.recovery_reason, ''));
  end if;

  insert into public.crm_lost_sales select v.*;

  perform set_config('tilal.lost_analysis', o.id::text, true);
  update public.opportunities
     set stage_id = g_lost,
         lost_reason_id = v.reason_id,
         lost_note = left(coalesce(v.details, vp->>'reason_name'), 2000)
   where id = o.id;
  perform set_config('tilal.lost_analysis', '', true);

  -- سطرٌ في تسلسل العميل يقول لماذا، لا «تغيير مرحلة» وحده
  insert into public.client_activities
    (client_id, opportunity_id, activity_type, summary, actor_name)
  values
    (o.client_id, o.id, 'تحليل خسارة',
     coalesce(o.title, 'فرصة') || ' — خُسرت في «' || coalesce(g_from.name, '—') || '»: '
       || (vp->>'category_name') || ' / ' || (vp->>'reason_name')
       || case when v.recontact_required then ' · إعادة تواصل ' || to_char(v.recontact_date, 'YYYY-MM-DD') else '' end,
     actor);

  return v.id;
end $$;

comment on function public.close_opportunity_lost(uuid, jsonb) is
  'إغلاق فرصة كخاسرة مع تحليلها الإلزامي. الحقول: category_id, reason_id, loss_source, customer_potential, recovery_potential, details، واختيارياً recontact_*, recovery_reason, discount, competitor_* (140).';

-- ------------------------------------------------------------
-- 10) تعديل التحليل — كل تغيير يُسجَّل بصاحبه وسببه
-- ------------------------------------------------------------
create or replace function public.update_lost_analysis(p_id uuid, p jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l  public.crm_lost_sales%rowtype;
  vp jsonb;
  manager boolean;
  own boolean;
  edit_days int := public.crm_setting_int('lost_edit_days', 7);
  v_task uuid;
  v_value numeric;
begin
  select * into l from public.crm_lost_sales where id = p_id for update;
  if l.id is null then
    raise exception 'تحليل الخسارة غير موجود.';
  end if;

  manager := public.crm_can_manage_lost(l.owner_id);
  own := l.lost_by = auth.uid()
         or (l.owner_id is not null and l.owner_id = public.my_employee_id());

  if not manager then
    if not own or not public.crm_can_edit_opportunity(l.opportunity_id) then
      raise exception 'لا صلاحية لك على تحليل هذه الخسارة.';
    end if;
    if l.outcome <> 'lost' then
      raise exception 'الفرصة أُعيد تنشيطها — تحليل خسارتها السابقة يعدّله المشرف وحده.';
    end if;
    -- المُرحَّل غير المحلَّل يُكمله صاحبه في أي وقت؛ وغيره خلال المهلة
    if l.category_id is not null and l.lost_at < now() - make_interval(days => edit_days) then
      raise exception 'انتهت مهلة تعديلك (% أيام). اطلب التعديل من مشرفك.', edit_days;
    end if;
  end if;

  if l.category_id is not null and coalesce(btrim(p_reason), '') = '' then
    raise exception 'اكتب سبب التعديل — يُحفظ في سجلّ التحليل.';
  end if;

  vp := public.crm_validate_lost_payload(p);

  -- القيمة الخاسرة: المشرف وحده يصحّحها، وتصير «يدوية»
  v_value := l.lost_value;
  if manager and nullif(p->>'lost_value', '') is not null
     and (p->>'lost_value')::numeric is distinct from l.lost_value then
    v_value := (p->>'lost_value')::numeric;
    if v_value < 0 then raise exception 'القيمة لا تكون سالبة.'; end if;
  end if;

  -- مهمة إعادة التواصل تتبع الموعد
  v_task := l.recontact_task_id;
  if (vp->>'recontact_required')::boolean and l.outcome = 'lost' then
    v_task := public.crm_upsert_recontact_task(
      l.recontact_task_id, l.opportunity_id, l.owner_id, (vp->>'recontact_date')::date,
      'السبب: ' || (vp->>'category_name') || ' — ' || (vp->>'reason_name'));
  elsif l.recontact_task_id is not null then
    update public.tasks set status = 'ملغاة'
     where id = l.recontact_task_id and status in ('جديدة', 'قيد التنفيذ');
  end if;

  perform set_config('tilal.lost_edit_reason', coalesce(nullif(btrim(p_reason), ''), 'إكمال تحليل مُرحَّل'), true);
  update public.crm_lost_sales
     set category_id        = (vp->>'category_id')::uuid,
         reason_id          = (vp->>'reason_id')::uuid,
         loss_source        = vp->>'loss_source',
         customer_potential = vp->>'customer_potential',
         recovery_potential = vp->>'recovery_potential',
         recontact_required = (vp->>'recontact_required')::boolean,
         recontact_date     = (vp->>'recontact_date')::date,
         recovery_reason    = vp->>'recovery_reason',
         details            = vp->>'details',
         discount           = (vp->>'discount')::numeric,
         lost_value         = v_value,
         value_basis        = case when v_value is distinct from l.lost_value then 'manual' else value_basis end,
         competitor_id            = (vp->>'competitor_id')::uuid,
         competitor_project_id    = (vp->>'competitor_project_id')::uuid,
         competitor_name          = vp->>'competitor_name',
         competitor_price         = (vp->>'competitor_price')::numeric,
         competitor_price_per_m2  = (vp->>'competitor_price_per_m2')::numeric,
         competitor_unit_m2       = (vp->>'competitor_unit_m2')::numeric,
         competitor_payment_plan  = vp->>'competitor_payment_plan',
         competitor_advantage     = vp->>'competitor_advantage',
         competitor_choice_reason = vp->>'competitor_choice_reason',
         recontact_task_id  = case when (vp->>'recontact_required')::boolean then v_task else recontact_task_id end,
         -- تحليلٌ تغيّر بعد المراجعة يعود للمراجعة
         review_status      = case when manager then review_status else 'pending' end
   where id = l.id;
  perform set_config('tilal.lost_edit_reason', '', true);

  -- السبب على الفرصة يتبع (096 يصحّح حدث الخسارة في التقارير)
  if l.outcome = 'lost' then
    update public.opportunities
       set lost_reason_id = (vp->>'reason_id')::uuid,
           lost_note = left(coalesce(vp->>'details', vp->>'reason_name'), 2000)
     where id = l.opportunity_id
       and (lost_reason_id is distinct from (vp->>'reason_id')::uuid
            or lost_note is distinct from left(coalesce(vp->>'details', vp->>'reason_name'), 2000));
  end if;
end $$;

-- ------------------------------------------------------------
-- 11) المراجعة — المشرف يؤكّد التحليل أو يعترض عليه
-- ------------------------------------------------------------
create or replace function public.review_lost_sale(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.crm_lost_sales%rowtype;
begin
  select * into l from public.crm_lost_sales where id = p_id for update;
  if l.id is null then raise exception 'تحليل الخسارة غير موجود.'; end if;
  if not public.crm_can_manage_lost(l.owner_id) then
    raise exception 'المراجعة للمشرف على الفريق أو الإدارة.';
  end if;
  if p_status not in ('confirmed', 'disputed') then
    raise exception 'حالة المراجعة: مؤكَّد أو معترَض عليه.';
  end if;
  if p_status = 'disputed' and coalesce(btrim(p_note), '') = '' then
    raise exception 'الاعتراض يحتاج ملاحظة تشرح ما الخطأ في التحليل.';
  end if;
  if l.category_id is null then
    raise exception 'لا يُراجَع تحليلٌ لم يُكتب بعد.';
  end if;

  update public.crm_lost_sales
     set review_status = p_status,
         review_note = nullif(btrim(p_note), ''),
         reviewed_by = auth.uid(),
         reviewed_by_name = coalesce(public.my_employee_name(), public.display_name(auth.uid())),
         reviewed_at = now()
   where id = l.id;

  -- الاعتراض يصل صاحب الخسارة
  if p_status = 'disputed' then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, priority, category)
    select e.user_id, 'اعتراض على تحليل خسارة',
           coalesce(p_note, ''), '/dashboard/crm/opportunities/' || l.opportunity_id::text || '?tab=lost',
           'crm', l.opportunity_id, 'opportunity', 'عادية', 'crm'
      from public.employees e where e.id = l.owner_id and e.user_id is not null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 12) إعادة التنشيط — الخسارة السابقة تبقى بتاريخها
-- ------------------------------------------------------------
create or replace function public.reactivate_lost_opportunity(
  p_opportunity_id uuid, p_stage_id uuid, p_note text,
  p_next_action text, p_next_action_date date
) returns void language plpgsql security definer set search_path = public as $$
declare
  o public.opportunities%rowtype;
  g public.crm_stages%rowtype;
  g_to public.crm_stages%rowtype;
  actor text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  if not public.crm_can_edit_opportunity(p_opportunity_id) then
    raise exception 'لا صلاحية لك على هذه الفرصة.';
  end if;
  select * into o from public.opportunities where id = p_opportunity_id for update;
  select * into g from public.crm_stages where id = o.stage_id;
  if g.stage_type <> 'lost' then
    raise exception 'إعادة التنشيط لفرصة خاسرة فقط.';
  end if;
  select * into g_to from public.crm_stages where id = p_stage_id;
  if g_to.id is null or g_to.stage_type <> 'open' or not g_to.is_active then
    raise exception 'اختر مرحلة مفتوحة تعود إليها الفرصة.';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'اكتب لماذا عاد العميل مهتماً — هذا ما يُقرأ في تقرير المبيعات المسترجعة.';
  end if;
  if p_next_action_date is null or p_next_action_date < public.baghdad_today() then
    raise exception 'فرصةٌ أُعيد تنشيطها تحتاج موعد خطوة قادمة من اليوم فصاعداً.';
  end if;

  perform set_config('tilal.reactivation_note', btrim(p_note), true);
  update public.opportunities
     set stage_id = g_to.id,
         -- السبب يبقى في صفّ الخسارة؛ على فرصةٍ مفتوحة كان سيُقرأ سبباً حالياً
         lost_reason_id = null,
         lost_note = null,
         next_action = coalesce(nullif(btrim(p_next_action), ''), 'متابعة بعد إعادة التنشيط'),
         next_action_date = p_next_action_date
   where id = o.id;
  perform set_config('tilal.reactivation_note', '', true);

  insert into public.client_activities
    (client_id, opportunity_id, activity_type, summary, actor_name, next_action, next_action_date)
  values
    (o.client_id, o.id, 'إعادة تنشيط',
     coalesce(o.title, 'فرصة') || ' — أُعيد تنشيطها إلى «' || g_to.name || '»: ' || btrim(p_note),
     actor, coalesce(nullif(btrim(p_next_action), ''), 'متابعة بعد إعادة التنشيط'), p_next_action_date);
end $$;

-- ------------------------------------------------------------
-- 13) الحارسان
-- ------------------------------------------------------------

-- (أ) لا تدخل فرصةٌ مرحلة الخسارة إلا من close_opportunity_lost
create or replace function public.require_lost_analysis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;
  if public.crm_setting_int('enforce_lost_analysis', 1) = 0 then
    return new;
  end if;
  if (select stage_type from public.crm_stages where id = new.stage_id) = 'lost'
     and (select stage_type from public.crm_stages where id = old.stage_id) <> 'lost'
     and coalesce(current_setting('tilal.lost_analysis', true), '') <> new.id::text then
    raise exception 'لا تُغلق الفرصة كخاسرة إلا من نموذج «تحليل سبب فقدان فرصة البيع».'
      using hint = 'close_opportunity_lost';
  end if;
  return new;
end $$;

drop trigger if exists trg_z_require_lost_analysis on public.opportunities;
create trigger trg_z_require_lost_analysis
  before update of stage_id on public.opportunities
  for each row execute function public.require_lost_analysis();

-- (ب) بطاقة العميل لا تُنقل إلى «فشل البيع» وله فرصة مفتوحة.
--     ذلك كان يترك العميل «خاسراً» وفرصته مفتوحة في خطّ الأنابيب،
--     وخسارةً بلا تحليل. الواجهة تفتح النموذج بدلاً منه.
--     الفرصة الوحيدة حين تُغلق بالنموذج تحرّك البطاقة بالمرآة (072)
--     وقد صارت مغلقة، فيمرّ الحارس.
create or replace function public.guard_client_lost_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is not distinct from old.stage then
    return new;
  end if;
  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;
  if public.crm_setting_int('enforce_lost_analysis', 1) = 0 then
    return new;
  end if;
  if exists (select 1 from public.crm_stages s where s.name = new.stage and s.stage_type = 'lost')
     and exists (select 1 from public.opportunities o
                   join public.crm_stages g on g.id = o.stage_id
                  where o.client_id = new.id and o.deleted_at is null and g.stage_type = 'open') then
    raise exception 'للعميل فرصة مفتوحة — أغلقها من نموذج «تحليل سبب فقدان فرصة البيع» بدل نقل البطاقة.'
      using hint = 'close_opportunity_lost';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_client_lost_stage on public.clients;
create trigger trg_guard_client_lost_stage
  before update of stage on public.clients
  for each row execute function public.guard_client_lost_stage();

-- ------------------------------------------------------------
-- 14) تتبّع النتيجة — من أي باب جاء التغيير
--
-- الخروج من الخسارة إلى مرحلة مفتوحة (من النموذج، أو من القائمة، أو
-- من بطاقة العميل بالمرآة) = «أُعيد تنشيطها». الربح بعد خسارة =
-- «استُرجعت» بقيمتها. وعكس البيع يعيدها «مُنشَّطة».
-- ------------------------------------------------------------
create or replace function public.track_lost_outcome()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t_old text; t_new text;
  who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  if new.stage_id is not distinct from old.stage_id then
    return null;
  end if;
  select stage_type into t_old from public.crm_stages where id = old.stage_id;
  select stage_type into t_new from public.crm_stages where id = new.stage_id;

  if t_old = 'lost' and t_new <> 'lost' then
    update public.crm_lost_sales
       set outcome = case when t_new = 'won' then 'recovered' else 'reactivated' end,
           reactivated_at = now(), reactivated_by = auth.uid(), reactivated_by_name = who,
           reactivation_note = coalesce(nullif(current_setting('tilal.reactivation_note', true), ''),
                                        'أُعيد فتحها بتغيير المرحلة إلى «'
                                        || (select name from public.crm_stages where id = new.stage_id) || '»'),
           closed_after_at = case when t_new = 'won' then now() end,
           recovered_value = case when t_new = 'won' then coalesce(new.won_value, new.expected_value) end
     where opportunity_id = new.id and outcome = 'lost';
    -- عاد العميل: مهمة إعادة التواصل أدّت غرضها
    update public.tasks t set status = 'منجزة'
      from public.crm_lost_sales l
     where l.opportunity_id = new.id and t.id = l.recontact_task_id
       and t.status in ('جديدة', 'قيد التنفيذ');
  elsif t_old = 'open' and t_new = 'won' then
    update public.crm_lost_sales
       set outcome = 'recovered', closed_after_at = now(),
           recovered_value = coalesce(new.won_value, new.expected_value)
     where opportunity_id = new.id and outcome = 'reactivated';
  elsif t_old = 'won' and t_new <> 'won' then
    update public.crm_lost_sales
       set outcome = 'reactivated', closed_after_at = null, recovered_value = null
     where opportunity_id = new.id and outcome = 'recovered';
  end if;
  return null;
end $$;

drop trigger if exists trg_track_lost_outcome on public.opportunities;
create trigger trg_track_lost_outcome
  after update of stage_id on public.opportunities
  for each row execute function public.track_lost_outcome();

-- قيمة الفوز تُكتب أحياناً بعد الانتقال (الحجز يُحدّثها) — الاسترجاع يتبعها
create or replace function public.track_recovered_value()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.won_value is distinct from old.won_value and new.won_value is not null then
    update public.crm_lost_sales set recovered_value = new.won_value
     where opportunity_id = new.id and outcome = 'recovered'
       and recovered_value is distinct from new.won_value;
  end if;
  return null;
end $$;

drop trigger if exists trg_track_recovered_value on public.opportunities;
create trigger trg_track_recovered_value
  after update of won_value on public.opportunities
  for each row execute function public.track_recovered_value();

-- الانتقال من الخسارة إلى المراحل المفتوحة يدخل الخريطة (يُفرض فقط إن فُعّل enforce_stage_transitions)
insert into public.crm_stage_transitions (from_stage_id, to_stage_id)
select f.id, t.id from public.crm_stages f join public.crm_stages t on t.stage_type = 'open'
 where f.stage_type = 'lost'
on conflict do nothing;

-- ------------------------------------------------------------
-- 15) العرض — للتقارير والشاشات (security_invoker: RLS تسري)
-- ------------------------------------------------------------
create or replace view public.v_crm_lost_sales with (security_invoker = true) as
select
  l.*,
  o.client_id,
  case when public.should_mask_client_pii() then public.mask_name(c.name) else c.name end as client_name,
  o.title              as opportunity_title,
  g.name               as current_stage_name,
  g.stage_type         as current_stage_type,
  o.last_activity_at   as opportunity_last_activity_at,
  p.name               as project_name,
  u.unit_code,
  cat.code             as category_code,
  cat.name_ar          as category_name_ar,
  cat.name_en          as category_name_en,
  r.name               as reason_name_ar,
  coalesce(r.name_en, r.name) as reason_name_en,
  src.name_ar          as loss_source_name_ar,
  src.name_en          as loss_source_name_en,
  cp.name_ar           as customer_potential_name_ar,
  cp.name_en           as customer_potential_name_en,
  coalesce(cp.is_qualified, true) as is_qualified,
  rl.name_ar           as recovery_name_ar,
  rl.name_en           as recovery_name_en,
  coalesce(rl.is_recoverable, false) as is_recoverable,
  coalesce(mc.name, l.competitor_name) as competitor_display_name,
  mcp.name             as competitor_project_name,
  camp.name            as campaign_name,
  mgr.full_name        as manager_name,
  (l.category_id is null) as needs_analysis,
  (public.baghdad_today() - (l.lost_at at time zone 'Asia/Baghdad')::date) as days_since_lost
from public.crm_lost_sales l
join public.opportunities o  on o.id = l.opportunity_id and o.deleted_at is null
join public.clients c        on c.id = o.client_id
join public.crm_stages g     on g.id = o.stage_id
left join public.projects p  on p.id = l.project_id
left join public.units u     on u.id = l.unit_id
left join public.crm_loss_categories cat on cat.id = l.category_id
left join public.crm_lost_reasons r      on r.id = l.reason_id
left join public.crm_loss_sources src    on src.code = l.loss_source
left join public.crm_customer_potentials cp on cp.code = l.customer_potential
left join public.crm_recovery_levels rl  on rl.code = l.recovery_potential
left join public.mkt_competitors mc      on mc.id = l.competitor_id
left join public.mkt_competitor_projects mcp on mcp.id = l.competitor_project_id
left join public.crm_campaigns camp      on camp.id = l.campaign_id
-- employees محجوبٌ بـRLS عن الموظف؛ الدليل (095) يكشف الاسم وحده
left join public.crm_owner_directory() mgr(id, full_name, project_id, user_id) on mgr.id = l.manager_id;

comment on view public.v_crm_lost_sales is
  'تحليل الخسائر بأسمائه بلغتين. security_invoker: كل قارئ يرى نطاقه. الاسم مُقنَّع للتسويق (092).';

-- ------------------------------------------------------------
-- 16) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_loss_categories     enable row level security;
alter table public.crm_loss_sources        enable row level security;
alter table public.crm_customer_potentials enable row level security;
alter table public.crm_recovery_levels     enable row level security;
alter table public.crm_lost_sales          enable row level security;
alter table public.crm_lost_sale_changes   enable row level security;
alter table public.mkt_competitor_projects enable row level security;

-- القوائم: قراءة للجميع (النموذج يبني منها)، وكتابة للمدير وحده
do $$
declare t text;
begin
  foreach t in array array['crm_loss_categories', 'crm_loss_sources', 'crm_customer_potentials', 'crm_recovery_levels']
  loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "admin writes %1$s" on public.%1$I', t);
    execute format('create policy "admin writes %1$s" on public.%1$I for all to authenticated '
                   || 'using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I '
                   || 'for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- المنافسون: المبيعات تقرأ لتختار، والوسيط لا. الكتابة كما في 121 (التسويق والمدير).
drop policy if exists "crm read competitors" on public.mkt_competitors;
create policy "crm read competitors" on public.mkt_competitors
  for select to authenticated using (not (select public.is_broker()));

drop policy if exists "read competitor projects" on public.mkt_competitor_projects;
create policy "read competitor projects" on public.mkt_competitor_projects
  for select to authenticated using (not (select public.is_broker()));
drop policy if exists "write competitor projects" on public.mkt_competitor_projects;
create policy "write competitor projects" on public.mkt_competitor_projects
  for all to authenticated
  using ((select public.can_write_marketing()))
  with check ((select public.can_write_marketing()));

drop trigger if exists trg_audit_mkt_competitor_projects on public.mkt_competitor_projects;
create trigger trg_audit_mkt_competitor_projects
  after insert or update or delete on public.mkt_competitor_projects
  for each row execute function public.audit_row();

-- الخسائر: نطاق الفرصة. الأسرع أولاً — المالك المجمَّد بالمفتاح، ثم
-- الفرصة نفسها (سياستها تحكم) لمن يرى العميل بغير الملكية.
drop policy if exists "read lost sales" on public.crm_lost_sales;
create policy "read lost sales" on public.crm_lost_sales
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or lost_by = (select auth.uid())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
    or exists (select 1 from public.opportunities o where o.id = opportunity_id)
  );
-- لا سياسة إدراج ولا تعديل: الدوال وحدها تكتب، فلا تحليل بلا تحقّق ولا تعديل بلا أثر.
drop policy if exists "admin deletes lost sales" on public.crm_lost_sales;
create policy "admin deletes lost sales" on public.crm_lost_sales
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "read lost sale changes" on public.crm_lost_sale_changes;
create policy "read lost sale changes" on public.crm_lost_sale_changes
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.crm_lost_sales l where l.id = lost_sale_id)
  );

grant select on public.v_crm_lost_sales to authenticated;

-- الدوال الداخلية لا تُستدعى من الواجهة
revoke all on function public.crm_build_lost_row(uuid, uuid, timestamptz)                    from public, anon, authenticated;
revoke all on function public.crm_validate_lost_payload(jsonb)                               from public, anon, authenticated;
revoke all on function public.crm_upsert_recontact_task(uuid, uuid, uuid, date, text)        from public, anon, authenticated;
revoke all on function public.log_lost_sale_change()       from public, anon, authenticated;
revoke all on function public.stamp_lost_sale()            from public, anon, authenticated;
revoke all on function public.require_lost_analysis()      from public, anon, authenticated;
revoke all on function public.guard_client_lost_stage()    from public, anon, authenticated;
revoke all on function public.track_lost_outcome()         from public, anon, authenticated;
revoke all on function public.track_recovered_value()      from public, anon, authenticated;
revoke all on function public.sync_lost_reason_category()  from public, anon, authenticated;

revoke all on function public.crm_opportunity_milestone(uuid) from public, anon;
revoke all on function public.crm_can_edit_opportunity(uuid)  from public, anon;
revoke all on function public.crm_can_manage_lost(uuid)       from public, anon;
revoke all on function public.close_opportunity_lost(uuid, jsonb)                from public, anon;
revoke all on function public.update_lost_analysis(uuid, jsonb, text)            from public, anon;
revoke all on function public.review_lost_sale(uuid, text, text)                 from public, anon;
revoke all on function public.reactivate_lost_opportunity(uuid, uuid, text, text, date) from public, anon;

grant execute on function public.crm_opportunity_milestone(uuid) to authenticated, service_role;
grant execute on function public.crm_can_edit_opportunity(uuid)  to authenticated, service_role;
grant execute on function public.crm_can_manage_lost(uuid)       to authenticated, service_role;
grant execute on function public.close_opportunity_lost(uuid, jsonb)                to authenticated, service_role;
grant execute on function public.update_lost_analysis(uuid, jsonb, text)            to authenticated, service_role;
grant execute on function public.review_lost_sale(uuid, text, text)                 to authenticated, service_role;
grant execute on function public.reactivate_lost_opportunity(uuid, uuid, text, text, date) to authenticated, service_role;

-- ------------------------------------------------------------
-- 17) الترحيل — صفٌّ لكل فرصة خاسرة قائمة
--
-- يُعلَّم is_backfilled، وفئته من سببه القديم إن وُجد، وإلا يبقى
-- «غير محلَّل» ظاهراً في التقارير — رقمٌ يقول «لا نعرف» خيرٌ من رقم
-- يختفي. المرحلة التي سقطت منها من تاريخ المراحل (آخر دخول للخسارة).
-- ------------------------------------------------------------
do $$
declare
  r record;
  v public.crm_lost_sales%rowtype;
  h_from uuid; h_days numeric; h_at timestamptz; h_by uuid; h_by_name text;
  n int := 0;
begin
  for r in
    select o.id, o.closed_at, o.updated_at, o.created_at, o.lost_reason_id, o.lost_note
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where g.stage_type = 'lost' and o.deleted_at is null
       and not exists (select 1 from public.crm_lost_sales l where l.opportunity_id = o.id)
  loop
    h_from := null; h_days := null; h_at := null; h_by := null; h_by_name := null;
    select hh.from_stage_id, hh.days_in_from, hh.at, hh.changed_by, hh.changed_by_name
      into h_from, h_days, h_at, h_by, h_by_name
      from public.opportunity_stage_history hh
      join public.crm_stages gt on gt.id = hh.to_stage_id and gt.stage_type = 'lost'
     where hh.opportunity_id = r.id
     order by hh.at desc limit 1;

    v := public.crm_build_lost_row(r.id, h_from, coalesce(h_at, r.closed_at, r.updated_at, r.created_at));
    v.is_backfilled := true;
    v.lost_by       := h_by;
    v.lost_by_name  := coalesce(h_by_name, 'ترحيل 140');
    v.days_in_stage := h_days;
    v.reason_id     := r.lost_reason_id;
    v.category_id   := (select lr.category_id from public.crm_lost_reasons lr where lr.id = r.lost_reason_id);
    v.details       := r.lost_note;
    -- المُرحَّل ليس له مرحلةٌ محفوظة غالباً (ترحيل 072 وضعه مغلقاً مباشرة)
    if h_from is null then
      v.lost_stage_id := null; v.lost_stage_name := null; v.lost_stage_order := null;
    end if;
    insert into public.crm_lost_sales select v.*;
    n := n + 1;
  end loop;
  raise notice 'ترحيل 140: % خسارة', n;
end $$;

-- ------------------------------------------------------------
-- 18) التحقّق
-- ------------------------------------------------------------
do $$
declare
  n_lost int; n_rows int; n_cat int; n_rsn int; n_unlinked int;
begin
  select count(*) into n_lost from public.opportunities o join public.crm_stages g on g.id = o.stage_id
   where g.stage_type = 'lost' and o.deleted_at is null;
  select count(*) into n_rows from public.crm_lost_sales where outcome = 'lost';
  select count(*) into n_cat from public.crm_loss_categories;
  select count(*) into n_rsn from public.crm_lost_reasons where category_id is not null;
  select count(*) into n_unlinked from public.crm_lost_reasons where category_id is null;

  raise notice '--- 140 تحليل الخسائر ---';
  raise notice 'فئات: %  أسباب مربوطة: %  غير مربوطة: %', n_cat, n_rsn, n_unlinked;
  raise notice 'فرص خاسرة: %  خسائر قائمة مسجّلة: %', n_lost, n_rows;
  if n_rows <> n_lost then
    raise warning 'فرص خاسرة بلا صفّ خسارة: % — راجع الترحيل.', n_lost - n_rows;
  end if;
end $$;

notify pgrst, 'reload schema';
