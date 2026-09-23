-- ============================================================
-- تلال ERP — 080: العروض المحفوظة، ومطابقة الوحدات، والإجراء التالي
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- لماذا ملفٌّ ثالث عشر؟
--
-- مراجعة المتطلّبات بعد اكتمال 070–079 كشفت ثلاث فجوات في طبقة
-- القاعدة — كلها صغيرة، وكلها تلزم الواجهة قبل أن تُبنى:
--
--   1) المُرشِّحات تُبنى في الواجهة ثم تُفقد عند الخروج. الموظف
--      الذي يبني «ليداتي الساخنة في الكرادة» كل صباح يبنيها من
--      جديد كل صباح.
--
--   2) «أي وحدة تناسب هذا العميل؟» سؤالٌ يُجاب عنه اليوم بذاكرة
--      الموظف. وذاكرةٌ لا تسع ٤٠٠ وحدة في مجمّع الفرقان.
--
--   3) الموظف يفتح ملف العميل فيرى تاريخاً ولا يرى **ماذا يفعل
--      الآن**. والنظام يملك كل ما يلزم للإجابة ولا يجيب.
--
-- ============================================================
-- المبدأ الحاكم
--
--     يقترح ولا يقرّر، ويشرح ولا يأمر.
--
-- المطابقة ترتّب وحداتٍ بأسباب مكتوبة، والاقتراح يقول «اتّصل به —
-- صامت منذ ١٨ يوماً ودرجته ٧٢». ولا شيء يُنفَّذ تلقائياً: لا
-- إسناد، ولا حجز، ولا تغيير مرحلة. الموظف يقرأ السبب ويقرّر.
--
-- ولا تعلّم آلي هنا ولا نموذج. قواعد صريحة تُقرأ وتُراجَع وتُعدَّل —
-- ونظامٌ يقترح بما لا يستطيع شرحه لا يُوثَق به على عميل.
--
-- ============================================================
-- ما يضيفه
--
--   1) crm_saved_views      — مُرشِّحات محفوظة، خاصة أو مشتركة
--   2) match_units_for_client() — وحدات مرشَّحة بدرجة ملاءمة وأسباب
--   3) crm_next_best_action()   — الإجراء التالي بسببه وأولويته
--   4) crm_customer_health()    — الصحة بمكوّناتها لا كرقم مبهم
--
-- يتطلب: sql/070 → 079. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) العروض المحفوظة
--
-- المُرشِّحات jsonb بلا مخطّط مفروض: الواجهة تتطوّر وتضيف مُرشِّحاً
-- فلا تحتاج هجرة. والثمن أن القاعدة لا تتحقّق من محتواها — وهو
-- ثمن مقبول لتفضيلٍ شخصي لا لقاعدة عمل.
-- ------------------------------------------------------------
create table if not exists public.crm_saved_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  entity      text not null default 'clients'
              check (entity in ('clients','opportunities','tasks','activities')),
  filters     jsonb not null default '{}'::jsonb,
  sort_by     text,
  sort_dir    text check (sort_dir in ('asc','desc')),
  columns     text[],                   -- الأعمدة المعروضة وترتيبها
  is_shared   boolean not null default false,   -- يراه الفريق كله
  is_default  boolean not null default false,   -- يُفتح تلقائياً
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, entity, name)
);

create index if not exists crm_saved_views_user_idx
  on public.crm_saved_views (user_id, entity, sort_order);
create index if not exists crm_saved_views_shared_idx
  on public.crm_saved_views (entity) where is_shared;

comment on table public.crm_saved_views is
  'مُرشِّحات محفوظة. المشترك يراه الجميع لكن صاحبه وحده يعدّله — لا أحد يغيّر عرضاً يعتمد عليه غيره.';

-- افتراضي واحد لكل (مستخدم، كيان)
create unique index if not exists crm_saved_views_one_default_idx
  on public.crm_saved_views (user_id, entity) where is_default;

create or replace function public.stamp_saved_view()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.user_id := coalesce(new.user_id, auth.uid());
  else
    new.user_id := old.user_id;   -- لا تُنقَل ملكية عرض
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_saved_view on public.crm_saved_views;
create trigger trg_stamp_saved_view
  before insert or update on public.crm_saved_views
  for each row execute function public.stamp_saved_view();

-- ------------------------------------------------------------
-- 2) مطابقة الوحدات
--
-- درجة الملاءمة من ١٠٠، وكل نقطة لها سبب مكتوب يُعرض بجانب الوحدة.
-- الترتيب اقتراحٌ للعرض لا قرار بيع.
--
-- ⚠️ الوحدات المتاحة وحدها. اقتراح وحدة محجوزة أو مباعة يُحرج
--    الموظف أمام عميله — وهو أسوأ من ألّا يُقترح شيء.
-- ------------------------------------------------------------
create or replace function public.match_units_for_client(
  p_client_id uuid, p_limit int default 10
) returns table (
  unit_id     uuid,
  unit_code   text,
  project_name text,
  unit_type   text,
  space_m2    numeric,
  rooms       int,
  price       numeric,
  match_score int,
  reasons     text[]
)
language plpgsql stable set search_path = public as $$
declare c public.clients%rowtype;
begin
  select * into c from public.clients where id = p_client_id and deleted_at is null;
  if c.id is null then
    return;
  end if;

  return query
  with cand as (
    select u.*,
           -- الميزانية: الوزن الأكبر. خارجها لا صفقة مهما طابق الباقي.
           case
             when c.budget_min is null and c.budget_max is null then 0
             when u.price is null then 0
             when u.price between coalesce(c.budget_min, 0)
                              and coalesce(c.budget_max, u.price)      then 35
             -- ضمن ١٠٪ فوق السقف: يُعرض ويُعلَن تجاوزه
             when c.budget_max is not null and u.price <= c.budget_max * 1.1 then 18
             else -25
           end as sc_budget,
           case when c.preferred_project_id is not null
                 and u.project_id = c.preferred_project_id then 25 else 0 end as sc_project,
           case when c.preferred_unit_type is not null
                 and public.name_key(u.unit_type) = public.name_key(c.preferred_unit_type)
                then 15 else 0 end as sc_type,
           case when c.preferred_area is not null
                 and public.name_key(u.area) = public.name_key(c.preferred_area)
                then 15 else 0 end as sc_area,
           case when c.governorate is not null
                 and public.name_key(u.governorate) = public.name_key(c.governorate)
                then 10 else 0 end as sc_gov
      from public.units u
     where u.status = 'متاحة'
       -- ما سبق أن استُبعد لا يُقترح ثانية
       and not exists (
         select 1 from public.client_interests ci
          where ci.client_id = p_client_id and ci.unit_id = u.id
            and ci.status = 'استُبعد')
  )
  select cd.id, cd.unit_code, coalesce(p.name, cd.project), cd.unit_type,
         cd.space_m2, cd.rooms, cd.price,
         greatest(0, least(100,
           cd.sc_budget + cd.sc_project + cd.sc_type + cd.sc_area + cd.sc_gov))::int,
         array_remove(array[
           case when cd.sc_budget >= 35 then 'ضمن الميزانية' end,
           case when cd.sc_budget between 1 and 34 then 'أعلى من السقف بقليل' end,
           case when cd.sc_budget < 0 then 'خارج الميزانية' end,
           case when cd.sc_project > 0 then 'المشروع المفضّل' end,
           case when cd.sc_type    > 0 then 'نوع الوحدة المطلوب' end,
           case when cd.sc_area    > 0 then 'المنطقة المفضّلة' end,
           case when cd.sc_gov     > 0 then 'نفس المحافظة' end
         ], null)
    from cand cd
    left join public.projects p on p.id = cd.project_id
   -- لا نعرض ما لا يطابق شيئاً: قائمةٌ عشوائية أسوأ من قائمة فارغة
   where (cd.sc_budget + cd.sc_project + cd.sc_type + cd.sc_area + cd.sc_gov) > 0
   order by (cd.sc_budget + cd.sc_project + cd.sc_type + cd.sc_area + cd.sc_gov) desc,
            cd.price nulls last
   limit greatest(p_limit, 1);
end $$;

comment on function public.match_units_for_client(uuid, int) is
  'يقترح ولا يقرّر. كل درجة لها سبب مكتوب، والوحدات المتاحة وحدها تُعرض.';

-- ------------------------------------------------------------
-- 3) الإجراء التالي المقترح
--
-- ترتيب القواعد هو ترتيب الأولوية: أول قاعدة تنطبق هي الاقتراح.
-- وكلٌّ منها تحمل سببها ووجهتها، فالموظف يضغط ويعمل لا يبحث.
-- ------------------------------------------------------------
create or replace function public.crm_next_best_action(p_client_id uuid)
returns table (
  priority   int,
  action     text,
  reason     text,
  link       text
)
language plpgsql stable set search_path = public as $$
declare
  c          public.clients%rowtype;
  days_quiet numeric;
  n_open     int;
  has_unit   boolean;
  has_res    boolean;
  neglect_d  int := public.crm_setting_int('neglected_days', 14);
begin
  select * into c from public.clients where id = p_client_id and deleted_at is null;
  if c.id is null then return; end if;

  days_quiet := extract(epoch from (now() - coalesce(c.last_contact_at, c.created_at))) / 86400.0;

  select count(*) into n_open
    from public.opportunities o join public.crm_stages g on g.id = o.stage_id
   where o.client_id = p_client_id and o.deleted_at is null and g.stage_type = 'open';

  select exists (select 1 from public.opportunities o
                  where o.client_id = p_client_id and o.deleted_at is null
                    and o.unit_id is not null) into has_unit;
  select exists (select 1 from public.reservations r
                  where r.client_id = p_client_id) into has_res;

  -- الملفّ المغلق: لا إجراء إلا إن لم يُسجَّل سبب خسارته
  if not public.is_open_stage(c.stage) then
    if c.stage = 'فشل البيع' and exists (
         select 1 from public.opportunities o join public.crm_stages g on g.id = o.stage_id
          where o.client_id = p_client_id and g.stage_type = 'lost' and o.lost_reason_id is null)
    then
      return query select 1, 'سجّل سبب الخسارة',
        'الملفّ مغلق بلا سبب — بلا الأسباب لا نعرف لماذا نخسر.',
        '/dashboard/crm/opportunities?client=' || p_client_id::text;
    end if;
    return;
  end if;

  -- (١) لم يُتواصَل معه قطّ
  if c.last_contact_at is null then
    return query select 1, 'اتّصل به — أول تواصل',
      'أُسنِد منذ ' || round(extract(day from now()
        - coalesce(c.owner_assigned_at, c.created_at))) || ' يوماً بلا تواصل واحد.',
      '/dashboard/clients/' || p_client_id::text;
    return;
  end if;

  -- (٢) موعد متابعة فات
  if c.follow_up_date is not null and c.follow_up_date < public.baghdad_today() then
    return query select 1, 'تابِعه — الموعد فات',
      'موعد المتابعة كان ' || to_char(c.follow_up_date, 'YYYY-MM-DD') || '.',
      '/dashboard/clients/' || p_client_id::text;
    return;
  end if;

  -- (٣) صامت فوق حدّ الإهمال ودرجته عالية — أغلى ما يُفقَد
  if days_quiet > neglect_d and coalesce(c.lead_score, 0) >= 50 then
    return query select 1, 'اتّصل به — ليد قيّم يبرد',
      'درجته ' || c.lead_score || ' وصامت منذ ' || round(days_quiet) || ' يوماً.',
      '/dashboard/clients/' || p_client_id::text;
    return;
  end if;

  -- (٤) مفتوح بلا فرصة
  if n_open = 0 then
    return query select 2, 'افتح فرصة',
      'العميل في مرحلة «' || c.stage || '» ولا فرصة مسجّلة — لا يظهر في خطّ الأنابيب.',
      '/dashboard/clients/' || p_client_id::text || '?tab=deals';   -- تبويب الصفقات (090)
    return;
  end if;

  -- (٥) بلا تأهيل
  if c.budget_min is null and c.budget_max is null then
    return query select 2, 'اسأل عن الميزانية',
      'بلا ميزانية لا تُطابَق وحدة ولا تُقاس جدّية الطلب.',
      '/dashboard/clients/' || p_client_id::text || '?tab=deals';   -- التأهيل في تبويب الصفقات (090)
    return;
  end if;

  -- (٦) مؤهَّل بلا وحدة مختارة
  if not has_unit then
    return query select 2, 'اعرض عليه وحدات مناسبة',
      'ميزانيته معروفة ولم تُختَر وحدة — النظام يرشّح المطابق.',
      '/dashboard/clients/' || p_client_id::text || '?tab=property';
    return;
  end if;

  -- (٧) اختار وحدة ولم يحجز
  if has_unit and not has_res then
    return query select 2, 'ادفعه نحو الحجز',
      'اختار وحدة ولم يحجز — هذه أقصر مسافة متبقّية للبيع.',
      '/dashboard/reservations/new?client=' || p_client_id::text;
    return;
  end if;

  -- (٨) كل شيء مرتّب
  return query select 3, 'تابِع في موعده',
    coalesce('الموعد القادم ' || to_char(c.follow_up_date, 'YYYY-MM-DD'),
             'حدّد موعد المتابعة القادم.'),
    '/dashboard/clients/' || p_client_id::text;
end $$;

-- ------------------------------------------------------------
-- 4) صحّة العميل — بمكوّناتها لا كرقم مبهم (§36)
--
-- أربعة مكوّنات، كلٌّ من ١٠٠، ولكلٍّ سببه. رقمٌ واحد مجمَّع بلا
-- تفصيل يُحفَظ في الذاكرة ولا يُعمَل به.
-- ------------------------------------------------------------
create or replace function public.crm_customer_health(p_client_id uuid)
returns table (
  component text,
  value     int,
  note      text
)
language plpgsql stable set search_path = public as $$
declare
  c          public.clients%rowtype;
  days_quiet numeric;
  n_acts     int;
  n_answered int;
  n_total    int;
begin
  select * into c from public.clients where id = p_client_id and deleted_at is null;
  if c.id is null then return; end if;

  days_quiet := extract(epoch from (now() - coalesce(c.last_contact_at, c.created_at))) / 86400.0;

  select count(*) into n_acts from public.client_activities a
   where a.client_id = p_client_id
     and a.occurred_at > now() - interval '30 days'
     and a.activity_type <> 'تغيير مرحلة';

  select count(*) filter (where outcome <> 'لم يرد'), count(*)
    into n_answered, n_total
    from public.client_activities
   where client_id = p_client_id and outcome is not null;

  return query
  select 'الحداثة'::text,
         greatest(0, 100 - round(days_quiet * 3))::int,
         'آخر تواصل منذ ' || round(days_quiet) || ' يوماً.'
  union all
  select 'التفاعل',
         least(100, n_acts * 20)::int,
         n_acts || ' تواصلاً في آخر ٣٠ يوماً.'
  union all
  select 'الاستجابة',
         case when n_total > 0 then round(n_answered * 100.0 / n_total)::int else 50 end,
         case when n_total > 0
              then 'ردّ في ' || n_answered || ' من ' || n_total || ' محاولة.'
              else 'لا محاولات مسجّلة بنتيجة — لا حكم بعد.' end
  union all
  select 'نيّة الشراء',
         coalesce(c.lead_score, 0),
         'درجة الليد ' || coalesce(c.lead_score, 0) || ' — تفصيلها في crm_lead_scores.';
end $$;

-- ------------------------------------------------------------
-- 5) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_saved_views enable row level security;

drop policy if exists "read saved views" on public.crm_saved_views;
create policy "read saved views" on public.crm_saved_views
  for select to authenticated
  using (user_id = (select auth.uid()) or is_shared);

-- صاحب العرض وحده يعدّله أو يحذفه — ولو كان مشتركاً.
drop policy if exists "own saved views" on public.crm_saved_views;
create policy "own saved views" on public.crm_saved_views
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on function public.match_units_for_client(uuid, int) from public;
revoke all on function public.crm_next_best_action(uuid)        from public;
revoke all on function public.crm_customer_health(uuid)         from public;
grant execute on function public.match_units_for_client(uuid, int) to authenticated, service_role;
grant execute on function public.crm_next_best_action(uuid)        to authenticated, service_role;
grant execute on function public.crm_customer_health(uuid)         to authenticated, service_role;

-- ⚠️ الثلاث بلا security definer عمداً: تقرأ clients و units و
--    opportunities، فتسري عليها RLS. موظفٌ يستدعيها على عميل ليس
--    له يحصل على نتيجة فارغة لا على بياناته.

-- ------------------------------------------------------------
-- 6) التحقّق
-- ------------------------------------------------------------
do $$
declare cid uuid; r record; n int := 0;
begin
  raise notice '--- 080 العروض والمطابقة والإجراء التالي ---';

  -- عيّنة: أعلى ليد مفتوح درجةً
  select c.id into cid from public.clients c
   where c.deleted_at is null and public.is_open_stage(c.stage)
   order by coalesce(c.lead_score, 0) desc limit 1;

  if cid is null then
    raise notice 'لا ليدات مفتوحة للتجربة.';
    return;
  end if;

  raise notice 'عيّنة على العميل %:', cid;

  for r in select * from public.crm_next_best_action(cid) loop
    raise notice '  الإجراء التالي [أولوية %]: % — %', r.priority, r.action, r.reason;
  end loop;

  for r in select * from public.crm_customer_health(cid) loop
    raise notice '  صحّة · %: % — %', r.component, r.value, r.note;
  end loop;

  for r in select * from public.match_units_for_client(cid, 3) loop
    n := n + 1;
    raise notice '  وحدة مرشَّحة: % (%) — ملاءمة % · %',
      coalesce(r.unit_code, '—'), coalesce(r.project_name, '—'),
      r.match_score, array_to_string(r.reasons, ' · ');
  end loop;

  if n = 0 then
    raise notice '  لا وحدات مرشَّحة — متوقّع قبل تعبئة الميزانية والتفضيلات.';
  end if;
end $$;

notify pgrst, 'reload schema';
