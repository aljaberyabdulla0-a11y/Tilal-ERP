-- ============================================================
-- تلال ERP — 074: التأهيل وتقييم الليد ودرجة الحرارة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- «٣٢٥ ليداً» رقمٌ لا يُتَّخذ عليه قرار. الموظف الذي يفتح قائمته
-- صباحاً يرى ٦٢ اسماً متساوية الوزن، فيبدأ من الأعلى — أي من
-- الأقدم — لا من الأقرب إلى البيع.
--
-- والمعلومات التي تفرّق بينها موجودة في القاعدة أصلاً ومبعثرة:
-- من زار الموقع؟ (نشاط) من طلب عرضاً؟ (نشاط) من حدّد وحدة؟ (فرصة)
-- من لا يردّ؟ (نتيجة نشاط) — لكن لا أحد يجمعها في رقم واحد.
--
-- ============================================================
-- المبدأ الحاكم
--
--     لا درجة بلا سبب مكتوب.
--
-- كل نقطة في الدرجة تحمل اسمها ونصّها. الموظف يرى «٦٥ = زار الموقع
-- ١٥ + طلب عرضاً ٢٠ + اختار وحدة ١٥ + ميزانية ١٠ + تواصل حديث ١٠
-- − لا يردّ ١٠ + أساس ٥». لا صندوق أسود يقول «٦٥» ويسكت — رقمٌ لا
-- يُفسَّر لا يُوثَق به ولا يُحتجّ به على أحد.
--
-- والقواعد نفسها في crm_score_rules (070): تُعدَّل نقاطها من صفحة
-- الإعدادات بلا نشر، والدرجات تُعاد بالقواعد الجديدة عند الفحص.
--
-- ============================================================
-- ما يضيفه
--
--   1) حقول التأهيل على clients (ميزانية، إطار زمني، صاحب قرار…)
--   2) qualification_status محسوب لا مُدخَل
--   3) compute_lead_score() — الدرجة وأسبابها معاً
--   4) crm_lead_scores + crm_lead_score_history — الدرجة وتحرّكها
--   5) درجة الحرارة: ساخن | دافئ | بارد | خامل
--   6) refresh_lead_scores() + مهمة يومية
--
-- يتطلب: sql/070 و sql/071 و sql/072. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) حقول التأهيل
--
-- كلها **اختيارية**. ليد بلا ميزانية ليد ناقص التأهيل لا ليد
-- مرفوض — والنظام يقيس النقص ولا يمنع الإدخال.
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists budget_min          numeric,
  add column if not exists budget_max          numeric,
  add column if not exists purchase_timeline   text,   -- فوري | ٣ أشهر | ٦ أشهر | سنة | غير محدّد
  add column if not exists is_decision_maker   boolean,
  add column if not exists financing_required  boolean,
  add column if not exists urgency             text,   -- عالية | متوسطة | منخفضة
  add column if not exists preferred_project_id uuid references public.projects(id) on delete set null,
  add column if not exists preferred_area      text,
  add column if not exists preferred_unit_type text,
  add column if not exists lead_score          int,
  add column if not exists lead_temperature    text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_budget_range_chk') then
    alter table public.clients add constraint clients_budget_range_chk
      check (budget_min is null or budget_max is null or budget_min <= budget_max);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_timeline_chk') then
    alter table public.clients add constraint clients_timeline_chk
      check (purchase_timeline is null or purchase_timeline in
             ('فوري','خلال ٣ أشهر','خلال ٦ أشهر','خلال سنة','غير محدّد'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_urgency_chk') then
    alter table public.clients add constraint clients_urgency_chk
      check (urgency is null or urgency in ('عالية','متوسطة','منخفضة'));
  end if;
end $$;

comment on column public.clients.lead_score is
  'مرآة للدرجة المحسوبة في crm_lead_scores — للفرز والفهرسة. المصدر والأسباب هناك.';

-- ------------------------------------------------------------
-- 2) حالة التأهيل — محسوبة لا مُدخَلة
--
-- موظف يختار «مؤهَّل» من قائمة يجعل التأهيل رأياً. هنا يصير قياساً:
-- كم من أركان التأهيل الأربعة توفّر فعلاً؟
--
--   الميزانية · الاهتمام العقاري · الإطار الزمني · صاحب القرار
-- ------------------------------------------------------------
create or replace function public.client_qualification(p_client_id uuid)
returns text language sql stable security definer set search_path = public as $$
  with c as (select * from public.clients where id = p_client_id),
  facts as (
    select
      (select (budget_min is not null or budget_max is not null) from c) as has_budget,
      (select (preferred_project_id is not null
               or preferred_area is not null
               or preferred_unit_type is not null) from c)              as has_interest,
      (select (purchase_timeline is not null
               and purchase_timeline <> 'غير محدّد') from c)            as has_timeline,
      (select coalesce(is_decision_maker, false) from c)                as is_dm,
      exists (select 1 from public.opportunities o
               join public.crm_stages g on g.id = o.stage_id
               where o.client_id = p_client_id and o.deleted_at is null
                 and o.unit_id is not null and g.stage_type = 'open')   as has_unit
  )
  select case
           when has_unit and has_budget                      then 'فرصة ساخنة'
           when (has_budget::int + has_interest::int
                 + has_timeline::int + is_dm::int) >= 3       then 'مؤهَّل'
           when (has_budget::int + has_interest::int
                 + has_timeline::int + is_dm::int) >= 1       then 'مؤهَّل جزئياً'
           else 'غير مؤهَّل'
         end
    from facts;
$$;

-- ------------------------------------------------------------
-- 3) الدرجة وأسبابها — في استدعاء واحد
--
-- تُرجِع الدرجة والحرارة ومصفوفة الأسباب. من يعرض الرقم يعرض
-- تفسيره في نفس اللحظة، فلا يُفصَل أحدهما عن الآخر بالغفلة.
--
-- الأسباب jsonb: [{"code":"visit_done","label":"زار الموقع","points":15}, …]
-- ------------------------------------------------------------
create or replace function public.compute_lead_score(p_client_id uuid)
returns table (score int, temperature text, reasons jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  c            public.clients%rowtype;
  rule         public.crm_score_rules%rowtype;
  total        int := 0;
  acc          jsonb := '[]'::jsonb;
  days_silent  numeric;
  hit          boolean;
  has_open     boolean;
  best_stage   numeric := 0;
  temp         text;
begin
  select * into c from public.clients where id = p_client_id;
  if c.id is null then
    return;
  end if;

  days_silent := extract(epoch from (now() - coalesce(c.last_contact_at, c.created_at))) / 86400.0;

  select exists (
    select 1 from public.opportunities o
     join public.crm_stages g on g.id = o.stage_id
    where o.client_id = p_client_id and o.deleted_at is null and g.stage_type = 'open'
  ) into has_open;

  select coalesce(max(g.probability), 0) into best_stage
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id = p_client_id and o.deleted_at is null and g.stage_type = 'open';

  for rule in
    select * from public.crm_score_rules where is_active order by sort_order
  loop
    hit := false;

    case rule.code
      when 'budget_known' then
        hit := c.budget_min is not null or c.budget_max is not null;

      when 'project_selected' then
        hit := c.preferred_project_id is not null
               or exists (select 1 from public.opportunities o
                           where o.client_id = p_client_id
                             and o.deleted_at is null and o.project_id is not null);

      when 'unit_selected' then
        hit := exists (select 1 from public.opportunities o
                        where o.client_id = p_client_id
                          and o.deleted_at is null and o.unit_id is not null);

      when 'visit_done' then
        hit := exists (select 1 from public.client_activities a
                        where a.client_id = p_client_id and a.activity_type = 'زيارة');

      when 'offer_requested' then
        hit := exists (select 1 from public.client_activities a
                        where a.client_id = p_client_id and a.activity_type = 'عرض سعر');

      when 'recent_activity' then
        hit := c.last_contact_at is not null
               and days_silent <= coalesce(rule.param, 7);

      when 'reservation_intent' then
        hit := exists (select 1 from public.reservations r where r.client_id = p_client_id);

      when 'decision_maker' then
        hit := coalesce(c.is_decision_maker, false);

      when 'no_answer' then
        -- مرّتان فأكثر «لم يرد» في آخر ثلاثة أنشطة: نمطٌ لا حادثة
        hit := (select count(*) from (
                  select a.outcome from public.client_activities a
                   where a.client_id = p_client_id
                   order by a.occurred_at desc limit 3
                ) t where t.outcome = 'لم يرد') >= 2;

      when 'stale_short' then
        hit := days_silent > coalesce(rule.param, 14)
               and days_silent <= coalesce(
                     (select param from public.crm_score_rules where code = 'stale_long'), 30);

      when 'stale_long' then
        hit := days_silent > coalesce(rule.param, 30);

      else
        hit := false;   -- قاعدة أضافها المدير ولا منطق لها بعد: تُتجاهَل بلا خطأ
    end case;

    if hit then
      total := total + rule.points;
      acc := acc || jsonb_build_object(
        'code', rule.code, 'label', rule.label, 'points', rule.points);
    end if;
  end loop;

  -- المرحلة نفسها إشارة: من بلغ «مناقشة العرض» أقرب ممّن هو في «ليد»
  if has_open and best_stage > 0 then
    total := total + round(best_stage / 5.0)::int;   -- ٧٠٪ ← ١٤ نقطة
    acc := acc || jsonb_build_object(
      'code', 'stage_progress',
      'label', 'تقدّم في خطّ المبيعات (' || round(best_stage) || '%)',
      'points', round(best_stage / 5.0)::int);
  end if;

  total := greatest(0, least(100, total));

  -- ===== درجة الحرارة =====
  -- لا تتبع الدرجة وحدها: ليدٌ درجته ٧٠ وصامت منذ ٦٠ يوماً ليس ساخناً.
  -- الصمت يُبرّد مهما كانت الإشارات، والملفّ المغلق خامدٌ بطبعه.
  temp := case
            when not has_open                      then 'خامل'
            when days_silent > 45                  then 'خامل'
            when total >= 70 and days_silent <= 14 then 'ساخن'
            when total >= 40 and days_silent <= 30 then 'دافئ'
            else 'بارد'
          end;

  return query select total, temp, acc;
end $$;

comment on function public.compute_lead_score(uuid) is
  'الدرجة وأسبابها معاً — لا يُعرض الرقم بلا تفسيره. القواعد من crm_score_rules.';

-- ------------------------------------------------------------
-- 4) تخزين الدرجة وتاريخها
-- ------------------------------------------------------------
create table if not exists public.crm_lead_scores (
  client_id   uuid primary key references public.clients(id) on delete cascade,
  score       int  not null,
  temperature text not null,
  reasons     jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists crm_lead_scores_score_idx on public.crm_lead_scores (score desc);
create index if not exists crm_lead_scores_temp_idx  on public.crm_lead_scores (temperature);

create table if not exists public.crm_lead_score_history (
  id          bigserial primary key,
  client_id   uuid not null references public.clients(id) on delete cascade,
  score       int  not null,
  delta       int  not null,
  temperature text not null,
  temperature_from text,
  reasons     jsonb,
  at          timestamptz not null default now()
);

create index if not exists crm_lead_score_history_client_idx
  on public.crm_lead_score_history (client_id, at desc);

comment on table public.crm_lead_score_history is
  'لا يُكتب إلا عند تغيّر الدرجة فعلاً — فحصٌ يومي لا يعني صفّاً يومياً.';

-- ------------------------------------------------------------
-- 5) الفحص الدوري
--
-- يمرّ على الليدات المفتوحة وحدها. الملفّات المغلقة درجتها لا تعني
-- شيئاً، والمرور عليها يضاعف الكلفة بلا فائدة.
-- ------------------------------------------------------------
create or replace function public.refresh_lead_scores(p_client_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r       record;
  s       record;
  changed int := 0;
  prev    public.crm_lead_scores%rowtype;
begin
  for r in
    select c.id from public.clients c
     where (p_client_id is null and public.is_open_stage(c.stage))
        or c.id = p_client_id
  loop
    select * into s from public.compute_lead_score(r.id);
    if s.score is null then continue; end if;

    select * into prev from public.crm_lead_scores where client_id = r.id;

    insert into public.crm_lead_scores (client_id, score, temperature, reasons, computed_at)
    values (r.id, s.score, s.temperature, s.reasons, now())
    on conflict (client_id) do update
      set score = excluded.score,
          temperature = excluded.temperature,
          reasons = excluded.reasons,
          computed_at = excluded.computed_at;

    if prev.client_id is null or prev.score is distinct from s.score then
      insert into public.crm_lead_score_history
        (client_id, score, delta, temperature, temperature_from, reasons)
      values (r.id, s.score, s.score - coalesce(prev.score, 0),
              s.temperature, prev.temperature, s.reasons);
      changed := changed + 1;
    end if;

    -- المرآة على العميل للفرز والفهرسة في الشاشات
    update public.clients
       set lead_score = s.score, lead_temperature = s.temperature
     where id = r.id
       and (lead_score is distinct from s.score
            or lead_temperature is distinct from s.temperature);
  end loop;

  return changed;
end $$;

-- ⚠️ التحديث أعلاه يمسّ clients، وعلى الجدول محفّز تدقيق (071).
--    الشرط `is distinct from` يمنع كتابة صفّ تدقيق يومي لكل عميل
--    لم تتغيّر درجته — بلا هذا الشرط ينتفخ audit_log بلا معنى.

create or replace function public.run_lead_score_refresh()
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  n := public.refresh_lead_scores();
  raise notice 'تحديث درجات الليدات: % تغيّرت.', n;
end $$;

-- ------------------------------------------------------------
-- 6) الجدولة — ٦ صباحاً بتوقيت بغداد، قبل فحص المتابعات بثلاث ساعات
--    كي يرى الموظف درجاتٍ محدَّثة حين تصله تنبيهات اليوم.
--    (٦ بغداد = ٣ UTC)
-- ------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('lead-score-refresh');
exception when others then
  null;   -- لم تكن مجدولة
end $$;

select cron.schedule(
  'lead-score-refresh',
  '0 3 * * *',
  $cron$ select public.run_lead_score_refresh(); $cron$
);

-- ------------------------------------------------------------
-- 7) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_lead_scores        enable row level security;
alter table public.crm_lead_score_history enable row level security;

drop policy if exists "read lead scores" on public.crm_lead_scores;
create policy "read lead scores" on public.crm_lead_scores
  for select to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id));

drop policy if exists "read score history" on public.crm_lead_score_history;
create policy "read score history" on public.crm_lead_score_history
  for select to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id));
-- لا سياسة كتابة: الدرجة تُحسب ولا تُدخَل (§51).

revoke all on function public.compute_lead_score(uuid)   from public;
revoke all on function public.client_qualification(uuid) from public;
revoke all on function public.refresh_lead_scores(uuid)  from public;
revoke all on function public.run_lead_score_refresh()   from public;
grant execute on function public.compute_lead_score(uuid)   to authenticated, service_role;
grant execute on function public.client_qualification(uuid) to authenticated, service_role;
grant execute on function public.refresh_lead_scores(uuid)  to authenticated, service_role;
grant execute on function public.run_lead_score_refresh()   to service_role;

-- ------------------------------------------------------------
-- 8) الحساب الأول والتحقّق
-- ------------------------------------------------------------
do $$
declare
  n_changed int;
  r record;
begin
  n_changed := public.refresh_lead_scores();

  raise notice '--- 074 التأهيل والتقييم ---';
  raise notice 'درجات مُحتسَبة: %', n_changed;

  raise notice 'التوزيع بدرجة الحرارة:';
  for r in
    select temperature, count(*) n, round(avg(score)) avg_score
      from public.crm_lead_scores group by temperature order by avg(score) desc
  loop
    raise notice '  % — % ليداً (متوسط الدرجة %)', r.temperature, r.n, r.avg_score;
  end loop;

  raise notice 'أعلى ١٠ درجات:';
  for r in
    select c.name, s.score, s.temperature
      from public.crm_lead_scores s join public.clients c on c.id = s.client_id
     order by s.score desc limit 10
  loop
    raise notice '  % — % (%)', r.name, r.score, r.temperature;
  end loop;

  if not exists (select 1 from public.crm_lead_scores where score >= 40) then
    raise warning 'لا ليد بدرجة ٤٠ فأعلى — متوقّع قبل تعبئة حقول التأهيل (الميزانية، الإطار الزمني).';
    raise warning 'الدرجات سترتفع تلقائياً كلما أُدخلت بيانات التأهيل وسُجّلت الزيارات والعروض.';
  end if;
end $$;

notify pgrst, 'reload schema';
