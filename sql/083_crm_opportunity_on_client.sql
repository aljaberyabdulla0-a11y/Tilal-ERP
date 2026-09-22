-- ============================================================
-- تلال ERP — 083: فرصة لكل عميل جديد، و«الليد» يُعدّ من مكانه
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- كشفته اختبارات 082 لا العين: الهجرة 072 أنشأت فرصة **لكل عميل
-- قائم** (٦٧٤ عميلاً ← ٦٧٤ فرصة)، ولم تترك محفّزاً يفعل ذلك للوارد
-- الجديد. والنتيجة صامتة تماماً:
--
--   عميل يُضاف اليوم → لا فرصة → لا يظهر في خطّ الأنابيب، ولا في
--   القمع، ولا في التنبؤ، ولا يُحتسب في crm_kpis أصلاً.
--
-- ولا شيء في الشاشة يقول ذلك. المدير يقرأ «٣٤٤ فرصة مفتوحة» وهي
-- صحيحة بالأمس، وتنقص كل يوم بمقدار ما دخل من ليدات.
--
-- وأسوأ من النقص أنه **غير متّسق**: عميلان في نفس المرحلة، أحدهما
-- مُرحَّل والآخر جديد، يُعاملان معاملتين مختلفتين في كل تقرير.
--
-- ===== القرار =====
--
--     الفرصة تُولد مع العميل، كما وُلدت مع المُرحَّلين.
--
-- هذا لا ينقض «العميل شخص والفرصة صفقة» (072): قيمة الفصل أن العميل
-- يملك **أكثر من** فرصة، وأن الفوز والخسارة يُقاسان على الصفقة لا على
-- الشخص. وكلاهما باقٍ. ما يسقط هو الحالة الوسطى غير المفيدة: عميل
-- يعمل عليه موظف ولا يراه خطّ الأنابيب.
--
-- ⚠️ المحفّز لا يمنع إنشاء العميل أبداً. مرحلة غير معروفة، أو خطأ في
--    إنشاء الفرصة: يُكتب تحذير ويمرّ العميل. فقدان فرصة أهون من
--    رفض عميل أمام موظف يُدخله وعميله أمامه.
--
-- ===== وإصلاح ثانٍ معه =====
--
-- crm_kpis.leads كان يعدّ `count(distinct client_id)` من عرض الفرص —
-- أي أن من لا فرصة له لا يُعدّ ليداً أصلاً. والتعريف الملزم في §53:
-- «Lead = صفّ في clients غير محذوف». يُعدّ الآن من مكانه.
--
-- يتطلب: 070–072 و 076. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الفرصة تُولد مع العميل
-- ------------------------------------------------------------
create or replace function public.create_opportunity_for_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g_id uuid;
  s_id uuid;
begin
  -- مرحلة العميل يجب أن تُقابل صفّاً في crm_stages
  select id into g_id from public.crm_stages
   where name = coalesce(new.stage, 'ليد');

  if g_id is null then
    raise warning 'لا فرصة للعميل % — مرحلته «%» ليست في crm_stages.',
      new.id, coalesce(new.stage, 'ليد');
    return null;
  end if;

  select id into s_id from public.crm_sources where name = btrim(new.source);

  begin
    insert into public.opportunities
      (client_id, project_id, owner_id, source_id, stage_id, stage_entered_at,
       created_at, created_by, next_action_date, notes)
    values
      (new.id, new.project_id, new.owner_id, s_id, g_id, now(),
       new.created_at, new.created_by,
       case when public.is_open_stage(new.stage) then new.follow_up_date end,
       'فرصة أُنشئت مع العميل (083).');
  exception when others then
    -- لا نُسقط العميل لأن صفقته تعثّرت — تظهر في لوحة الجودة
    raise warning 'تعذّر إنشاء فرصة للعميل %: %', new.id, sqlerrm;
  end;

  return null;
end $$;

comment on function public.create_opportunity_for_client() is
  'فرصة لكل عميل جديد — كما فعل ترحيل 072 بالقائمين. لا يمنع إنشاء العميل بحال.';

-- ⚠️ after insert لا before: نحتاج المعرّف، والفشل هنا لا يمسّ العميل.
--    والاسم يبدأ بـ trg_z كي يعمل بعد محفّزات الملكية والإسناد (071)
--    فتَرِث الفرصة المالك الصحيح لا القيمة قبل المزامنة.
drop trigger if exists trg_z_create_opportunity on public.clients;
create trigger trg_z_create_opportunity
  after insert on public.clients
  for each row execute function public.create_opportunity_for_client();

-- سدّ ما دخل بين 072 واليوم (إن وُجد)
insert into public.opportunities
  (client_id, project_id, owner_id, source_id, stage_id, stage_entered_at,
   created_at, created_by, next_action_date, last_activity_at, closed_at, notes)
select c.id, c.project_id, c.owner_id, s.id, g.id, c.created_at,
       c.created_at, c.created_by,
       case when g.stage_type = 'open' then c.follow_up_date end,
       c.last_contact_at,
       case when g.stage_type in ('won','lost')
            then greatest(coalesce(c.last_contact_at, c.created_at), c.created_at) end,
       'فرصة استُدركت للعميل (083).'
  from public.clients c
  join public.crm_stages g on g.name = coalesce(c.stage, 'ليد')
  left join public.crm_sources s on s.name = btrim(c.source)
 where c.deleted_at is null
   and not exists (select 1 from public.opportunities o
                    where o.client_id = c.id and o.deleted_at is null);

-- وتاريخ المراحل لما استُدرك
insert into public.opportunity_stage_history
  (opportunity_id, from_stage_id, to_stage_id, from_stage, to_stage,
   changed_by_name, note, at)
select o.id, null, o.stage_id, null, g.name,
       'النظام', 'نقطة البداية (083)', o.created_at
  from public.opportunities o
  join public.crm_stages g on g.id = o.stage_id
 where not exists (
   select 1 from public.opportunity_stage_history h where h.opportunity_id = o.id
 );

-- ------------------------------------------------------------
-- 2) «الليد» يُعدّ من clients لا من عرض الفرص
--
-- التعريف الملزم (§53): Lead = صفّ في clients غير محذوف. وكان يُعدّ
-- من v_crm_opportunities، فمن لا فرصة له لا يُعدّ ليداً — تعريفان
-- لرقم واحد، وهي بعينها العلّة التي عالجها 076.
-- ------------------------------------------------------------
create or replace function public.crm_kpis(
  p_from       date default null,
  p_to         date default null,
  p_owner_id   uuid default null,
  p_team_id    uuid default null,
  p_project_id uuid default null,
  p_source_id  uuid default null
) returns table (
  leads              bigint,
  opportunities      bigint,
  open_count         bigint,
  won_count          bigint,
  lost_count         bigint,
  conversion_rate    numeric,
  pipeline_value     numeric,
  weighted_pipeline  numeric,
  won_value          numeric,
  avg_deal_value     numeric,
  avg_sales_cycle    numeric,
  median_sales_cycle numeric,
  overdue_count      bigint,
  neglected_count    bigint,
  hot_count          bigint,
  activities         bigint
)
language sql stable set search_path = public as $$
  with f as (
    select * from public.v_crm_opportunities v
     where (p_from       is null or v.created_at::date >= p_from)
       and (p_to         is null or v.created_at::date <= p_to)
       and (p_owner_id   is null or v.owner_id   = p_owner_id)
       and (p_team_id    is null or v.team_id    = p_team_id)
       and (p_project_id is null or v.project_id = p_project_id)
       and (p_source_id  is null or v.source_id  = p_source_id)
  ),
  neglect as (select public.crm_setting_int('neglected_days', 14) d),
  -- الليد من مكانه: clients. وتسري عليه RLS كما تسري على العرض،
  -- فيبقى كل قارئ في نطاقه.
  lead_count as (
    select count(*) n
      from public.clients c
      left join public.employees e on e.id = c.owner_id
     where c.deleted_at is null
       and (p_from      is null or c.created_at::date >= p_from)
       and (p_to        is null or c.created_at::date <= p_to)
       and (p_owner_id  is null or c.owner_id   = p_owner_id)
       and (p_team_id   is null or e.project_id = p_team_id)
       and (p_project_id is null or c.project_id = p_project_id)
       and (p_source_id is null or c.original_source_id = p_source_id)
  )
  select
    (select n from lead_count),
    count(*),
    count(*) filter (where f.stage_type = 'open'),
    count(*) filter (where f.stage_type = 'won'),
    count(*) filter (where f.stage_type = 'lost'),
    case when count(*) filter (where f.stage_type in ('won','lost')) > 0
         then round(count(*) filter (where f.stage_type = 'won') * 100.0
                    / count(*) filter (where f.stage_type in ('won','lost')), 1)
         else 0 end,
    round(coalesce(sum(f.expected_value) filter (where f.stage_type = 'open'), 0)),
    round(coalesce(sum(f.weighted_value), 0)),
    round(coalesce(sum(f.won_value) filter (where f.stage_type = 'won'), 0)),
    round(coalesce(avg(f.won_value) filter (where f.stage_type = 'won'), 0)),
    round(coalesce(avg(f.sales_cycle_days) filter (where f.stage_type = 'won'), 0), 1),
    round(coalesce(
      (percentile_cont(0.5) within group (order by f.sales_cycle_days::double precision)
        filter (where f.stage_type = 'won'))::numeric, 0), 1),
    count(*) filter (where f.stage_type = 'open' and f.is_overdue),
    count(*) filter (where f.stage_type = 'open'
                       and f.days_silent > (select d from neglect)),
    count(*) filter (where f.lead_temperature = 'ساخن'),
    (select count(*) from public.client_activities a
      join public.crm_activity_types t on t.name = a.activity_type
     where t.counts_as_contact
       and (p_from is null or a.occurred_at::date >= p_from)
       and (p_to   is null or a.occurred_at::date <= p_to))
  from f;
$$;

comment on function public.crm_kpis(date, date, uuid, uuid, uuid, uuid) is
  'المصدر الوحيد لمؤشّرات الـCRM. الليد من clients والفرصة من opportunities — كلٌّ من مكانه (§53).';

-- ------------------------------------------------------------
-- 3) دفاع بالعمق: الفجوة تُرصد ولو عاد المحفّز فسقط
-- ------------------------------------------------------------
create or replace function public.crm_data_quality()
returns table (
  severity text,
  code     text,
  title    text,
  affected bigint,
  fix_path text
)
language sql stable set search_path = public as $$
  with checks as (
    select 'عالٍ' s, 'missing_phone' c, 'عملاء بلا رقم هاتف' t,
           count(*) n, '/dashboard/clients?filter=no_phone' f
      from public.clients where deleted_at is null
       and (phone is null or btrim(phone) = '')
    union all
    select 'عالٍ', 'invalid_phone', 'أرقام لا تطابق الشكل العراقي',
           count(*), '/dashboard/crm/data-quality#phones'
      from public.clients where deleted_at is null
       and phone is not null and btrim(phone) <> '' and phone_key is null
    union all
    select 'عالٍ', 'no_owner', 'ليدات مفتوحة بلا مالك',
           count(*), '/dashboard/crm/distribution'
      from public.clients where deleted_at is null
       and owner_id is null and public.is_open_stage(stage)
    union all
    -- الفجوة التي كشفها 082: عميل بلا فرصة لا يراه خطّ الأنابيب
    select 'عالٍ', 'client_no_opportunity', 'عملاء بلا فرصة — خارج خطّ الأنابيب',
           count(*), '/dashboard/crm/opportunities'
      from public.clients c where c.deleted_at is null
       and not exists (select 1 from public.opportunities o
                        where o.client_id = c.id and o.deleted_at is null)
    union all
    select 'متوسط', 'unmatched_employee', 'اسم موظف مبيعات لا يقابل حساباً',
           count(*), '/dashboard/hr/employees'
      from public.clients where deleted_at is null
       and owner_id is null
       and sales_employee is not null and btrim(sales_employee) <> ''
    union all
    select 'عالٍ', 'open_no_next_action', 'فرص مفتوحة بلا خطوة قادمة',
           count(*), '/dashboard/crm/opportunities?filter=no_action'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open' and o.next_action_date is null
    union all
    select 'متوسط', 'closed_with_tasks', 'ملفّات مغلقة ومهامّها ما زالت مفتوحة',
           count(*), '/dashboard/tasks?filter=orphan'
      from public.tasks tk join public.clients c on c.id = tk.client_id
     where c.deleted_at is null and not public.is_open_stage(c.stage)
       and tk.status in ('جديدة', 'قيد التنفيذ')
    union all
    select 'متوسط', 'opp_no_project', 'فرص متقدّمة بلا مشروع',
           count(*), '/dashboard/crm/opportunities'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open'
       and g.sort_order >= 3 and o.project_id is null
    union all
    select 'عالٍ', 'lost_no_reason', 'صفقات خاسرة بلا سبب مسجَّل',
           count(*), '/dashboard/crm/reports#lost'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'lost' and o.lost_reason_id is null
    union all
    select 'عالٍ', 'won_no_value', 'صفقات فائزة بلا قيمة',
           count(*), '/dashboard/crm/opportunities?filter=won'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'won'
       and coalesce(o.won_value, 0) = 0
    union all
    select 'متوسط', 'reservation_no_opp', 'حجوزات غير مربوطة بفرصة',
           count(*), '/dashboard/reservations'
      from public.reservations where opportunity_id is null
    union all
    select 'عالٍ', 'duplicates_confirmed', 'تكرار مؤكّد بانتظار القرار',
           count(*), '/dashboard/crm/data-quality#duplicates'
      from public.client_duplicates where status = 'جديد' and match_type = 'مؤكّد'
    union all
    select 'منخفض', 'duplicates_possible', 'تكرار محتمل للمراجعة',
           count(*), '/dashboard/crm/data-quality#duplicates'
      from public.client_duplicates where status = 'جديد' and match_type <> 'مؤكّد'
    union all
    select 'متوسط', 'missing_source', 'عملاء بلا مصدر',
           count(*), '/dashboard/clients?filter=no_source'
      from public.clients where deleted_at is null
       and (source is null or btrim(source) = '')
    union all
    select 'منخفض', 'missing_budget', 'ليدات مفتوحة بلا ميزانية',
           count(*), '/dashboard/clients?filter=no_budget'
      from public.clients where deleted_at is null
       and public.is_open_stage(stage) and budget_min is null and budget_max is null
    union all
    select 'عالٍ', 'impossible_dates', 'تواريخ مستحيلة (متابعة قبل الإنشاء أو إغلاق قبل الفتح)',
           count(*), '/dashboard/crm/data-quality#dates'
      from public.opportunities
     where deleted_at is null
       and (closed_at < created_at or expected_close_date < created_at::date)
    union all
    select 'منخفض', 'whitespace', 'أسماء أو مصادر بمسافات زائدة',
           count(*), 'crm_fix_whitespace()'
      from public.clients where deleted_at is null
       and (name <> btrim(name) or name ~ '\s{2,}'
            or source <> btrim(coalesce(source, '')))
  )
  select s, c, t, n, f from checks where n > 0
   order by case s when 'عالٍ' then 1 when 'متوسط' then 2 else 3 end, n desc;
$$;

-- ------------------------------------------------------------
-- 4) التحقّق
-- ------------------------------------------------------------
do $$
declare n_gap int; k record;
begin
  select count(*) into n_gap from public.clients c
   where c.deleted_at is null
     and not exists (select 1 from public.opportunities o
                      where o.client_id = c.id and o.deleted_at is null);

  select * into k from public.crm_kpis();

  raise notice '--- 083 فرصة لكل عميل ---';
  raise notice 'عملاء بلا فرصة بعد الاستدراك: % (يجب أن يكون صفراً)', n_gap;
  raise notice 'الليد الآن يُعدّ من clients: % · الفرص: %', k.leads, k.opportunities;

  if n_gap > 0 then
    raise warning 'بقي % عميلاً بلا فرصة — مراحلهم ليست في crm_stages.', n_gap;
  end if;
end $$;

notify pgrst, 'reload schema';
