-- ============================================================
-- تلال ERP — 167: تطابق «فشل البيع» بين بطاقة العميل وفرصته
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل الاختبارات (168):  select * from tests.run_lost_card_sync();
--
-- ============================================================
-- المشكلة
--
-- قائمة العملاء تعدّ clients.stage، ولوحة الفرص تعدّ opportunities.stage_id.
-- المرآة (072) لا تنقل الفرصة إلى «فشل البيع» عمداً (سبب الفشل إلزامي)،
-- فكل بطاقة نُقلت إلى «فشل البيع» قبل 140 تركت فرصتها مفتوحة:
-- على القاعدة الحيّة ٣٠٥ فرصة — موظفة واحدة ترى ٢٠١ عميلاً خاسراً و٧٤
-- فرصة خاسرة. والفرص «المفتوحة» تتضخّم بها اللوحة وقيمة الخطّ و«صامت».
--
-- وحارس 140 (guard_client_lost_stage) يمنع البطاقة فقط حين تكون الفرصة
-- **مفتوحة**. فبقي بابٌ: البطاقة إلى «بيع» (المرآة تجعل الفرصة رابحة بلا
-- حجز) ثم بعد ثوانٍ إلى «فشل البيع» — الفرصة رابحة لا مفتوحة فيمرّ.
-- حالتان على القاعدة بهذا النمط (٣ ثوانٍ بين النقلتين).
--
-- ============================================================
-- الحلّ
--
--   1) الحارس: البطاقة لا تصير «فشل البيع» ما دامت لها فرصة غير خاسرة
--      — مفتوحة أو رابحة. الفرصة الوحيدة تُغلق بالنموذج فتتبعها البطاقة.
--   2) crm_lost_card_drift(): كل فرصة غير خاسرة على بطاقة خاسرة. يجب أن
--      تُرجع صفراً دائماً — تقرؤه الاختبارات (168) والتحقّق أدناه.
--   3) التسوية: كل فرصة كهذه تُغلق خاسرةً بتاريخ نقل البطاقة وبمن نقلها،
--      بصفّ خسارة «مُرحَّل» (is_backfilled) بلا فئة — يظهر «غير محلَّل»
--      في «لماذا نخسر؟»، ويُكمله صاحبه متى شاء (update_lost_analysis
--      يسمح بإكمال المُرحَّل بلا مهلة). لا سبب يُخترع.
--      الرابحة بحجز لا تُلمس (لا توجد اليوم) — تُذكر في التحذير فقط.
--
-- يتطلب: 072، 083، 140. آمن لإعادة التشغيل: التسوية لا تجد شيئاً ثانيةً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الحارس — الفرصة الرابحة كالمفتوحة
-- ------------------------------------------------------------
create or replace function public.guard_client_lost_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text;
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
  if not exists (select 1 from public.crm_stages s where s.name = new.stage and s.stage_type = 'lost') then
    return new;
  end if;

  -- المفتوحة أولاً: رسالتها هي الأكثر وقوعاً وتدلّ على النموذج
  select g.stage_type into t
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id = new.id and o.deleted_at is null and g.stage_type <> 'lost'
   order by (g.stage_type = 'open') desc
   limit 1;

  if t = 'open' then
    raise exception 'للعميل فرصة مفتوحة — أغلقها من نموذج «تحليل سبب فقدان فرصة البيع» بدل نقل البطاقة.'
      using hint = 'close_opportunity_lost';
  elsif t is not null then
    raise exception 'صفقة هذا العميل مسجّلة «بيع» فلا تُنقل بطاقته إلى «فشل البيع». إن لم يتمّ البيع فأعِد البطاقة إلى مرحلة مفتوحة (أو ألغِ الحجز إن وُجد)، ثم اختر «فشل البيع» ليُفتح نموذج التحليل.'
      using hint = 'close_opportunity_lost';
  end if;
  return new;
end $$;

revoke all on function public.guard_client_lost_stage() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2) الفحص — يجب أن يُرجع صفراً
-- ------------------------------------------------------------
create or replace function public.crm_lost_card_drift()
returns table (client_id uuid, client_stage text, opportunity_id uuid,
               opportunity_stage text, opportunity_stage_type text)
language sql stable security definer set search_path = public as $$
  select c.id, c.stage, o.id, g.name, g.stage_type
    from public.clients c
    join public.opportunities o on o.client_id = c.id and o.deleted_at is null
    join public.crm_stages g    on g.id = o.stage_id
   where c.deleted_at is null
     and g.stage_type <> 'lost'
     and exists (select 1 from public.crm_stages s where s.name = c.stage and s.stage_type = 'lost');
$$;

comment on function public.crm_lost_card_drift() is
  'فرصٌ غير خاسرة على بطاقة عميل «فشل البيع». يجب أن تُرجع صفراً؛ غيره يعني أن الشاشتين ستختلفان في العدد (167).';

revoke all on function public.crm_lost_card_drift() from public, anon, authenticated;
grant execute on function public.crm_lost_card_drift() to service_role;

-- ------------------------------------------------------------
-- 3) التسوية
--
-- ⚠️ حارس الحقول (guard_opportunity_stage) يطلب lost_reason_id لمرحلة
--    الخسارة، ولا سبب نعرفه لهذه الفرص. يُعطَّل داخل هذه المعاملة وحدها
--    ويُعاد قبل نهايتها؛ وأي خطأ يُلغي المعاملة كلها بما فيها التعطيل.
--    حارس التحليل (require_lost_analysis) يُعبَر بـtilal.lost_analysis
--    لكل فرصة — كما تفعل close_opportunity_lost.
--
-- الترتيب كما في close_opportunity_lost مع فرق واحد: الصفّ يُبنى **قبل**
-- نقل الفرصة (crm_build_lost_row يحسب الأيام في المرحلة من
-- stage_entered_at، والنقل يعيده إلى الآن)، ويُدرج **بعده** — لأن
-- track_lost_outcome يحوّل خسارةً «مسترجعة» سابقة إلى «أُعيد تنشيطها»
-- عند الخروج من «بيع»، فنعلّمها «خُسرت مجدداً» ثم نُدرج الجديدة.
-- ------------------------------------------------------------
do $$
declare
  r      record;
  v      public.crm_lost_sales%rowtype;
  g_lost uuid;
  a_at   timestamptz;
  a_by   uuid;
  a_name text;
  n_open int := 0;
  n_won  int := 0;
begin
  select id into g_lost from public.crm_stages
   where stage_type = 'lost' and is_active order by sort_order limit 1;
  if g_lost is null then
    raise exception 'لا مرحلة خسارة فعّالة في إعدادات الـCRM.';
  end if;

  alter table public.opportunities disable trigger trg_z_guard_opportunity_stage;

  for r in
    select o.id, o.client_id, o.stage_id, o.title, d.client_stage, d.opportunity_stage, d.opportunity_stage_type
      from public.crm_lost_card_drift() d
      join public.opportunities o on o.id = d.opportunity_id
     where d.opportunity_stage_type = 'open'
        or not exists (select 1 from public.reservations x where x.opportunity_id = o.id)
     order by o.created_at
  loop
    -- متى نُقلت البطاقة إلى «فشل البيع» ومن نقلها — من آخر نشاط «تغيير مرحلة»
    a_at := null; a_by := null; a_name := null;
    select a.created_at, a.created_by, a.actor_name into a_at, a_by, a_name
      from public.client_activities a
     where a.client_id = r.client_id and a.activity_type = 'تغيير مرحلة' and a.stage_to = r.client_stage
     order by a.created_at desc limit 1;

    v := public.crm_build_lost_row(r.id, r.stage_id, coalesce(a_at, now()));
    v.is_backfilled := true;
    v.lost_by       := a_by;
    v.lost_by_name  := coalesce(a_name, 'تسوية 167');
    v.days_in_stage := greatest(v.days_in_stage, 0);

    perform set_config('tilal.lost_analysis', r.id::text, true);
    update public.opportunities
       set stage_id  = g_lost,
           closed_at = coalesce(a_at, now()),
           won_value = null,
           lost_note = 'أُغلقت بالتسوية 167: بطاقة العميل كانت «' || r.client_stage
                       || '» والفرصة بقيت «' || r.opportunity_stage || '». سبب الخسارة لم يُسجَّل.'
     where id = r.id;
    perform set_config('tilal.lost_analysis', '', true);

    update public.crm_lost_sales
       set outcome = 'relost', closed_after_at = v.lost_at
     where opportunity_id = r.id and outcome = 'reactivated';

    insert into public.crm_lost_sales select v.*;

    insert into public.client_activities
      (client_id, opportunity_id, activity_type, summary, actor_name)
    values
      (r.client_id, r.id, 'تحليل خسارة',
       coalesce(r.title, 'فرصة') || ' — أُغلقت خاسرةً لتطابق بطاقة العميل (كانت «'
         || r.opportunity_stage || '»). التحليل ناقص: أكمله من صفحة الفرصة.',
       'النظام');

    if r.opportunity_stage_type = 'open' then n_open := n_open + 1; else n_won := n_won + 1; end if;
  end loop;

  alter table public.opportunities enable trigger trg_z_guard_opportunity_stage;

  raise notice 'تسوية 167: % فرصة مفتوحة و% رابحة بلا حجز أُغلقت خاسرة', n_open, n_won;
end $$;

-- ------------------------------------------------------------
-- 4) التحقّق
-- ------------------------------------------------------------
do $$
declare
  n_drift int; n_res int; n_unrowed int;
begin
  select count(*) into n_drift from public.crm_lost_card_drift();
  select count(*) into n_res from public.crm_lost_card_drift() d
   where exists (select 1 from public.reservations x where x.opportunity_id = d.opportunity_id);
  select count(*) into n_unrowed
    from public.opportunities o join public.crm_stages g on g.id = o.stage_id
   where g.stage_type = 'lost' and o.deleted_at is null
     and not exists (select 1 from public.crm_lost_sales l where l.opportunity_id = o.id and l.outcome = 'lost');

  raise notice '--- 167 تطابق «فشل البيع» ---';
  raise notice 'بطاقات خاسرة بفرصة غير خاسرة: %  (منها بحجز: %)', n_drift, n_res;
  raise notice 'فرص خاسرة بلا صفّ خسارة قائم: %', n_unrowed;
  if n_drift > 0 then
    raise warning 'بقيت % فرصة غير خاسرة على بطاقات «فشل البيع» (رابحة بحجز) — راجعها يدوياً: select * from public.crm_lost_card_drift();', n_drift;
  end if;
end $$;

notify pgrst, 'reload schema';
