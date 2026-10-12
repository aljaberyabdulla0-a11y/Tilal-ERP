-- ============================================================
-- تلال ERP — 202: تقارير رحلة العميل — تصنيف النتائج والمقاييس
--
-- المرجع: docs/crm-client-centric-migration-plan.md §٣
--
-- المشكلة (مقاسةً على القاعدة الحيّة ٢٠٢٦-١٠-١٢): من ١٠٥١ خسارة
-- مسجّلة، ٥٨٣ إمكانيتها «D — غير مؤهّل» و١١١ سببها «لا يردّ على
-- التواصل». كلها تُعدّ في LOST_DEALS ومقام CONVERSION_RATE و«لماذا
-- نخسر؟» كأنها صفقات خسرناها في التفاوض. فالرقم «١٫٨٪ تحويل» يقيس
-- جودة الليدات قبل أن يقيس أداء البيع.
--
-- الحلّ: تصنيفٌ يُشتقّ مما سجّله الموظف في الاستمارة — لا يكتب فوقه
-- ولا يخترع شيئاً:
--   unanalysed   بلا فئة (لم تُحلَّل) — لا يُعرف
--   unreachable  السبب مُعلَّم outcome_class = unreachable
--   unqualified  الإمكانية غير مؤهَّلة (crm_customer_potentials.is_qualified = false)
--   commercial   غير ذلك — الخسارة التجارية الفعلية
-- والإغلاق غير التجاري بمرحلة (النوع closed — 201) منفصل عنها كلها.
--
-- المقاييس القديمة تبقى بتعريفها (للمقارنة التاريخية) وتُضاف الجديدة
-- بمقام صحيح: WIN_RATE_COMMERCIAL = فوز ÷ (فوز + خسارة تجارية).
-- ============================================================

-- (أ) تعليم الأسباب التي ليست خسارة بيع
alter table public.crm_lost_reasons add column if not exists outcome_class text;
alter table public.crm_lost_reasons drop constraint if exists crm_lost_reasons_outcome_class_chk;
alter table public.crm_lost_reasons add constraint crm_lost_reasons_outcome_class_chk
  check (outcome_class is null or outcome_class in ('unreachable', 'unqualified'));
comment on column public.crm_lost_reasons.outcome_class is
  'السبب يعني أن النتيجة ليست خسارة بيع: unreachable | unqualified. فارغ = يُحكم بالإمكانية (202).';

update public.crm_lost_reasons set outcome_class = 'unreachable'
 where name in ('لا يردّ على التواصل', 'لا يرد على التواصل', 'رقم خاطئ', 'الرقم مغلق')
   and outcome_class is null;

-- (ب) التصنيف — دالة واحدة تستعملها كل التقارير
create or replace function public.crm_loss_class(p_potential text, p_reason_id uuid, p_category_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
           when p_category_id is null then 'unanalysed'
           when (select r.outcome_class from public.crm_lost_reasons r where r.id = p_reason_id) is not null
             then (select r.outcome_class from public.crm_lost_reasons r where r.id = p_reason_id)
           when coalesce((select p.is_qualified from public.crm_customer_potentials p where p.code = p_potential), true) = false
             then 'unqualified'
           else 'commercial'
         end;
$$;
comment on function public.crm_loss_class(text, uuid, uuid) is
  'صنف نتيجة الخسارة: commercial | unqualified | unreachable | unanalysed — من الاستمارة نفسها (202).';

-- صنف آخر خسارة للمسار حتى لحظةٍ ما
create or replace function public.crm_loss_class_at(p_journey_id uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.crm_loss_class(l.customer_potential, l.reason_id, l.category_id)
       from public.crm_lost_sales l
      where l.opportunity_id = p_journey_id
        and l.lost_at <= p_at + interval '5 minutes'
      order by l.lost_at desc, l.loss_no desc
      limit 1),
    'unanalysed');
$$;
comment on function public.crm_loss_class_at(uuid, timestamptz) is
  'صنف آخر خسارة سجّلها المسار حتى لحظة (202).';

-- صنف الخسارة التي يمثّلها حدث «إغلاق خاسر» بعينه — للمقاييس الحدثية.
-- الحدث رقم k الخاسر للمسار = الخسارة loss_no = k (مطابقة ١٠٥١ ↔ ١٠٥١
-- على البيانات الحيّة). والوقت احتياطٌ إن اختلّ الترتيب.
create or replace function public.crm_loss_class_of_event(p_fact_id bigint)
returns text language sql stable security definer set search_path = public as $$
  with e as (
    select f.id, f.opportunity_id, f.event_at from public.crm_event_facts f where f.id = p_fact_id
  ),
  k as (
    select count(*)::int as n
      from public.crm_event_facts f, e
     where f.opportunity_id = e.opportunity_id
       and f.event_type = 'stage_change' and f.to_stage_type = 'lost' and not f.is_void
       and (f.event_at < e.event_at or (f.event_at = e.event_at and f.id <= e.id))
  )
  select coalesce(
    (select public.crm_loss_class(l.customer_potential, l.reason_id, l.category_id)
       from public.crm_lost_sales l, e, k
      where l.opportunity_id = e.opportunity_id and l.loss_no = k.n),
    (select public.crm_loss_class_at(e.opportunity_id, e.event_at) from e),
    'unanalysed');
$$;
comment on function public.crm_loss_class_of_event(bigint) is
  'صنف الخسارة التي يمثّلها حدث الإغلاق الخاسر (crm_event_facts.id) — COMMERCIAL_LOST_DEALS وأخواتها (202).';

revoke all on function public.crm_loss_class(text, uuid, uuid)       from public, anon;
revoke all on function public.crm_loss_class_at(uuid, timestamptz)   from public, anon;
revoke all on function public.crm_loss_class_of_event(bigint)        from public, anon;
grant execute on function public.crm_loss_class(text, uuid, uuid)     to authenticated;
grant execute on function public.crm_loss_class_at(uuid, timestamptz) to authenticated;
grant execute on function public.crm_loss_class_of_event(bigint)      to authenticated;

create index if not exists crm_lost_sales_opp_lost_at_idx on public.crm_lost_sales(opportunity_id, lost_at desc);

-- (ج) عرض الخسائر بصنفها — invoker، فوق v_crm_lost_sales (التقنيع فيه)
create or replace view public.v_crm_lost_sales_classified
with (security_invoker = true) as
  select v.*, public.crm_loss_class(v.customer_potential, v.reason_id, v.category_id) as loss_class
    from public.v_crm_lost_sales v;
grant select on public.v_crm_lost_sales_classified to authenticated;

-- (د) «لماذا نخسر؟» يقبل مرشّح الصنف (loss_class)
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.crm_lost_intelligence(jsonb)'::regprocedure);
  if position('f_class' in d) = 0 then
    d2 := regexp_replace(d, $q$(f_comp\s+uuid := nullif\(f->>'competitor_id', ''\)::uuid;)$q$,
                            E'\\1\n  f_class    text := nullif(f->>''loss_class'', '''');');
    d2 := regexp_replace(d2, $q$(coalesce\(mc\.name, l\.competitor_name\) as comp_name)$q$,
                             E'\\1,\n           public.crm_loss_class(l.customer_potential, l.reason_id, l.category_id) as loss_class');
    d2 := regexp_replace(d2, $q$l\.id as loss_id, l\.category_id,$q$,
                             $q$l.id as loss_id, l.loss_class, l.category_id,$q$);
    d2 := regexp_replace(d2, $q$(and \(f_comp\s+is null or r\.outcome <> 'lost' or r\.competitor_id = f_comp\))$q$,
                             E'\\1\n       and (f_class    is null or r.outcome <> ''lost'' or r.loss_class = f_class)');
    if (length(d2) - length(replace(d2, 'f_class', ''))) / length('f_class') < 3
       or position('as loss_class' in d2) = 0 or position('l.loss_class' in d2) = 0 then
      raise exception '202: لم يُعثر على مواضع الترقيع في crm_lost_intelligence';
    end if;
    execute d2;
  end if;
end $patch$;

-- (هـ) نتائج المسارات في مدة — بأبعادها يوم الحدث
--     invoker: RLS على الأحداث والخسائر تحصر النطاق كما في كل التقارير
create or replace function public.crm_journey_outcomes(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  d_from   date := nullif(f->>'from', '')::date;
  d_to     date := nullif(f->>'to', '')::date;
  f_owner  uuid := nullif(f->>'owner_id', '')::uuid;
  f_team   uuid := nullif(f->>'team_id', '')::uuid;
  f_proj   uuid := nullif(f->>'project_id', '')::uuid;
  f_src    uuid := nullif(f->>'source_id', '')::uuid;
  f_camp   uuid := nullif(f->>'campaign_id', '')::uuid;
  res      jsonb;
begin
  with ev as (
    select e.*
      from public.crm_event_facts e
     where not e.is_void
       and (d_from is null or e.event_date >= d_from)
       and (d_to   is null or e.event_date <= d_to)
       and (f_owner is null or e.owner_id    = f_owner)
       and (f_team  is null or e.team_id     = f_team)
       and (f_proj  is null or e.project_id  = f_proj)
       and (f_src   is null or e.source_id_dim = f_src)
       and (f_camp  is null or e.campaign_id = f_camp)
  ),
  closes as (
    select ev.*, case when ev.to_stage_type = 'lost'
                      then public.crm_loss_class_of_event(ev.id) end as loss_class
      from ev
     where ev.event_type = 'stage_change' and ev.to_stage_type in ('won', 'lost', 'closed')
  ),
  agg as (
    select count(*) filter (where to_stage_type = 'won')                                   as won,
           count(*) filter (where to_stage_type = 'lost')                                  as lost_all,
           count(*) filter (where loss_class = 'commercial')                               as lost_commercial,
           count(*) filter (where loss_class = 'unqualified')                              as lost_unqualified,
           count(*) filter (where loss_class = 'unreachable')                              as lost_unreachable,
           count(*) filter (where loss_class = 'unanalysed')                               as lost_unanalysed,
           count(*) filter (where to_stage_type = 'closed')                                as closed_noncommercial
      from closes
  )
  select jsonb_build_object(
           'won',                  a.won,
           'lost_all',             a.lost_all,
           'lost_commercial',      a.lost_commercial,
           'lost_unqualified',     a.lost_unqualified,
           'lost_unreachable',     a.lost_unreachable,
           'lost_unanalysed',      a.lost_unanalysed,
           'closed_noncommercial', a.closed_noncommercial,
           'closed_by_stage',      coalesce((select jsonb_object_agg(to_stage, n) from
                                     (select to_stage, count(*) n from closes where to_stage_type = 'closed'
                                       group by to_stage) x), '{}'::jsonb),
           'reservations',         (select count(*) from ev where event_type = 'reservation'),
           'reservations_cancelled', (select count(*) from ev where event_type = 'reservation_cancelled'),
           'sales_completed',      (select count(*) from ev where event_type = 'sale_completed'),
           'reopened',             (select count(*) from ev where event_type = 'stage_change' and event_subtype = 'reopened'),
           -- معدّل الفوز التجاري: المقام فوز + خسارة تجارية — غير المؤهّل وتعذّر الوصول خارجه
           'win_rate_commercial',  case when a.won + a.lost_commercial > 0
                                        then round(a.won * 100.0 / (a.won + a.lost_commercial), 1) end,
           -- القديم للمقارنة: كل خسارة في المقام
           'win_rate_all',         case when a.won + a.lost_all > 0
                                        then round(a.won * 100.0 / (a.won + a.lost_all), 1) end,
           -- ما لم يُحلَّل يجعل الرقم التجاري حدّاً أعلى لا قيمة دقيقة
           'win_rate_commercial_is_upper_bound', a.lost_unanalysed > 0
         )
    into res
    from agg a;
  return res;
end $$;

comment on function public.crm_journey_outcomes(jsonb) is
  'نتائج المسارات في مدة: فوز، خسارة بأصنافها، إغلاق غير تجاري، حجوزات وإلغاؤها، إعادة فتح — ومعدّل الفوز بمقامين (202).';
revoke all on function public.crm_journey_outcomes(jsonb) from public, anon;
grant execute on function public.crm_journey_outcomes(jsonb) to authenticated;

-- (و) المقاييس — التعريف = التنفيذ (crm_metrics)
insert into public.crm_metrics
  (code, name_ar, name_en, category, source, predicate, agg, numerator, denominator, unit,
   good_direction, definition, formula, date_field, source_tables, notes, legacy_equivalent,
   owner, sort_order, is_active)
select v.* from (values
  ('COMMERCIAL_LOST_DEALS', 'خسارة تجارية', 'Commercial Losses', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and r.to_stage_type = 'lost' and public.crm_loss_class_of_event(r.id) = 'commercial'$p$,
   'count', null, null, 'count', 'down',
   'مسارات خُسرت في المدة وتحليلها يقول إنها فرصة بيع حقيقية: ليست «غير مؤهّل» ولا «لا يرد» ولا بلا تحليل.',
   'LOST_DEALS − غير المؤهّل − تعذّر الوصول − بلا تحليل', 'تاريخ الإغلاق',
   'opportunity_stage_history, crm_lost_sales, crm_customer_potentials, crm_lost_reasons.outcome_class',
   'الصنف من crm_loss_class — يتبع تعديل الاستمارة.', 'crm_kpis.lost_count (أوسع)', 'إدارة المبيعات', 311, true),

  ('NONCOMMERCIAL_LOST', 'خسارة غير تجارية', 'Non-commercial Losses', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and r.to_stage_type = 'lost' and public.crm_loss_class_of_event(r.id) in ('unqualified', 'unreachable')$p$,
   'count', null, null, 'count', null,
   'مسارات أُغلقت «فشل البيع» وتحليلها يقول: غير مؤهّل أو تعذّر الوصول. جودة ليد لا أداء بيع.',
   'عدد خسائر المدة بصنف unqualified أو unreachable', 'تاريخ الإغلاق', 'opportunity_stage_history, crm_lost_sales', null, null, 'إدارة المبيعات', 312, true),

  ('UNANALYSED_LOST', 'خسارة بلا تحليل', 'Unanalysed Losses', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and r.to_stage_type = 'lost' and public.crm_loss_class_of_event(r.id) = 'unanalysed'$p$,
   'count', null, null, 'count', 'down',
   'خسائر لا يُعرف صنفها لأن الاستمارة لم تُملأ. ما دامت > 0 فالأرقام التجارية حدٌّ أعلى.',
   'عدد خسائر المدة بلا فئة', 'تاريخ الإغلاق', 'opportunity_stage_history, crm_lost_sales', null, null, 'إدارة المبيعات', 313, true),

  ('DISQUALIFIED_CLOSED', 'أُغلقت غير تجارية', 'Closed (non-commercial)', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and r.to_stage_type = 'closed'$p$,
   'count', null, null, 'count', null,
   'مسارات نُقلت إلى مرحلة ختامية غير تجارية («غير مؤهّل»، «تعذّر الوصول») في المدة. ليست خسارة.',
   'عدد انتقالات المدة إلى مرحلة نوعها closed', 'تاريخ الانتقال', 'opportunity_stage_history, crm_stages.stage_type = closed', null, null, 'إدارة المبيعات', 314, true),

  ('CLOSED_COMMERCIAL', 'مُحسومة تجارياً', 'Commercially Decided', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and (r.to_stage_type = 'won' or (r.to_stage_type = 'lost' and public.crm_loss_class_of_event(r.id) = 'commercial'))$p$,
   'count', null, null, 'count', null,
   'فوز + خسارة تجارية. مقام معدّل الفوز التجاري.',
   'WON_DEALS + COMMERCIAL_LOST_DEALS', 'تاريخ الإغلاق', 'opportunity_stage_history, crm_lost_sales', null, null, 'إدارة المبيعات', 316, true),

  ('WIN_RATE_COMMERCIAL', 'معدّل الفوز التجاري', 'Commercial Win Rate', 'outcome', 'events',
   $p$r.event_type = 'stage_change' and (r.to_stage_type = 'won' or (r.to_stage_type = 'lost' and public.crm_loss_class_of_event(r.id) = 'commercial'))$p$,
   'ratio', 'WON_DEALS', 'CLOSED_COMMERCIAL', 'pct', 'up',
   'فائزة ÷ (فائزة + خسارة تجارية). غير المؤهّل وتعذّر الوصول والإغلاق غير التجاري خارج المقام. ما بلا تحليل خارجه أيضاً فالرقم حدٌّ أعلى حتى يُحلَّل.',
   'WON_DEALS ÷ CLOSED_COMMERCIAL', 'تاريخ الإغلاق', 'opportunity_stage_history, crm_lost_sales',
   'CONVERSION_RATE يبقى بمقامه القديم (كل خسارة) للمقارنة التاريخية.', 'crm_kpis.conversion_rate (مقام أوسع)', 'إدارة المبيعات', 321, true),

  ('RESERVATION_STAGE_ENTERED', 'دخلوا «حجز»', 'Entered Reserved', 'pipeline', 'events',
   $p$r.event_type = 'stage_change' and gs.report_milestone = 'reservation'$p$,
   'opportunities', null, null, 'count', 'up',
   'مسارات دخلت مرحلة معلمها «reservation» في المدة — بالحجز نفسه (201).',
   'مسارات مميّزة دخلت مرحلة معلمها reservation', 'تاريخ الانتقال', 'opportunity_stage_history, crm_stages.report_milestone', null, null, 'إدارة المبيعات', 265, true),

  ('AT_RESERVATION', 'في «حجز»', 'At Reserved', 'state', 'state',
   $p$r.stage_type = 'open' and r.milestone = 'reservation'$p$,
   'count', null, null, 'count', null,
   'مسارات في مرحلة معلمها reservation في لحظة الصورة.',
   'عدد صفوف اللقطة بمرحلة معلمها reservation', 'تاريخ اللقطة', 'opportunities', null, null, 'إدارة المبيعات', 534, true),

  ('CLOSED_NONCOMMERCIAL_TOTAL', 'مغلقة غير تجارية (تراكمي)', 'Closed non-commercial (cumulative)', 'state', 'state',
   $p$r.stage_type = 'closed'$p$,
   'count', null, null, 'count', null,
   'كل المسارات في مرحلة ختامية غير تجارية حتى لحظة الصورة.',
   'عدد صفوف اللقطة بمرحلة نوعها closed', 'تاريخ اللقطة', 'opportunities', null, null, 'إدارة المبيعات', 542, true)
) as v(code, name_ar, name_en, category, source, predicate, agg, numerator, denominator, unit,
       good_direction, definition, formula, date_field, source_tables, notes, legacy_equivalent,
       owner, sort_order, is_active)
where not exists (select 1 from public.crm_metrics m where m.code = v.code);

update public.crm_metrics
   set notes = coalesce(notes || ' ', '')
               || '⚠️ المقام يشمل الخسائر غير التجارية (غير مؤهّل، لا يرد) وما بلا تحليل — المقام الصحيح في WIN_RATE_COMMERCIAL (202).',
       updated_at = now()
 where code = 'CONVERSION_RATE' and coalesce(notes, '') not like '%WIN_RATE_COMMERCIAL%';

update public.crm_metrics
   set notes = coalesce(notes || ' ', '')
               || 'يشمل غير المؤهّل وتعذّر الوصول وما بلا تحليل — الخسارة التجارية وحدها COMMERCIAL_LOST_DEALS (202).',
       updated_at = now()
 where code = 'LOST_DEALS' and coalesce(notes, '') not like '%COMMERCIAL_LOST_DEALS%';

update public.crm_metrics
   set definition = 'مسارات مرحلتها مفتوحة في لحظة الصورة (كل عميل له مسار افتراضي — 083/201).',
       updated_at = now()
 where code = 'OPEN_OPPORTUNITIES' and definition = 'فرص مرحلتها مفتوحة في لحظة الصورة.';

-- ===== التحقّق =====
do $$
declare v jsonb; n int;
begin
  select count(*) into n from public.crm_metrics
   where code in ('COMMERCIAL_LOST_DEALS', 'NONCOMMERCIAL_LOST', 'UNANALYSED_LOST', 'DISQUALIFIED_CLOSED',
                  'CLOSED_COMMERCIAL', 'WIN_RATE_COMMERCIAL', 'RESERVATION_STAGE_ENTERED',
                  'AT_RESERVATION', 'CLOSED_NONCOMMERCIAL_TOTAL');
  raise notice '202: مقاييس جديدة: % من ٩', n;
  select jsonb_object_agg(cls, k) into v from (
    select public.crm_loss_class(customer_potential, reason_id, category_id) cls, count(*) k
      from public.crm_lost_sales group by 1) x;
  raise notice '202: أصناف الخسائر المسجّلة: %', v;
end $$;
