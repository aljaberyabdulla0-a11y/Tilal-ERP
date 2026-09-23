-- ============================================================
-- تلال ERP — 092: إخفاء البيانات الشخصية عن التسويق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== الحدّ الذي يمكن بلوغه، وما لا يمكن =====
--
-- التسويق **يجب** أن يقرأ صفوف العملاء: دوال التقارير كلها
-- `security invoker` عمداً (076) كي تسري RLS فلا يرى الموظف أرقام
-- الشركة. فلو مُنع التسويق من الصفوف لعادت تقاريره **أصفاراً لا
-- أخطاء** — وهو أسوأ: رقمٌ كاذب لا رسالة منع.
--
-- فما يُبلَغ هنا: **الاسم والهاتف يُقنَّعان في كل ما يعرضه النظام**،
-- والشاشات التي تتصفّح الأشخاص تُنزع من قائمته.
--
-- ⚠️ وما لا يُبلَغ، وأقوله صراحةً: قراءة `clients` مباشرةً عبر
--    الواجهة البرمجية تبقى ممكنة له بالهاتف غير مُقنَّع. إغلاقها
--    يتطلّب إمّا نزع قراءة الصفوف (فتُكسر تقاريره) أو تحويل طبقة
--    التقارير إلى `security definer` بمُسنِد نطاق مكرَّر — وهو
--    تعريفان لحقيقة واحدة، وهي العلّة التي عالجها 076 أصلاً.
--
--    فالضمانة هنا **تنظيمية لا تقنية**: التسويق موظّف بعقد، ولا
--    يملك التصدير (الإدارة وحدها)، وكل قراءاته تحت التدقيق.
--    وكتابة هذا أصدق من ادّعاء إغلاقٍ لم يحدث.
--
-- يتطلب: 076 و 084. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.should_mask_client_pii()
returns boolean language sql stable security definer set search_path = public as $$
  -- التسويق وحده. المُطالِع إدارةٌ أو مراجعةٌ داخلية يرى ما يراجعه.
  select public.is_marketing();
$$;

comment on function public.should_mask_client_pii() is
  'من يُقنَّع له الاسم والهاتف. نقطة واحدة — أي دور يُضاف يُضاف هنا.';

-- ------------------------------------------------------------
-- التقنيع: يُبقي ما يكفي للتمييز ويحجب ما يكفي للخصوصية
--
-- «07701234567» ← «0770•••4567»: تكفي لمطابقة شكوى أو تمييز صفّين،
-- ولا تكفي للاتصال ولا للتصدير إلى منافس.
--
-- ورقمٌ أقصر من أن يُقنَّع يُرجِع NULL لا نصّاً ناقصاً: «077•••077»
-- تبدو رقماً وليست رقماً.
-- ------------------------------------------------------------
create or replace function public.mask_phone(p text)
returns text language sql immutable as $$
  select case
           when p is null or length(btrim(p)) < 7 then null
           else substr(btrim(p), 1, 4) || '•••' || right(btrim(p), 4)
         end;
$$;

-- «أحمد علي حسن» ← «أحمد ع.» — يُميّز ولا يُعرّف
create or replace function public.mask_name(p text)
returns text language sql immutable as $$
  select case
           when p is null or btrim(p) = '' then null
           else split_part(btrim(p), ' ', 1)
                || case when position(' ' in btrim(p)) > 0
                        then ' ' || left(split_part(btrim(p), ' ', 2), 1) || '.'
                        else '' end
         end;
$$;

revoke all on function public.should_mask_client_pii() from public;
revoke all on function public.mask_phone(text)         from public;
revoke all on function public.mask_name(text)          from public;
grant execute on function public.should_mask_client_pii() to authenticated, service_role;
grant execute on function public.mask_phone(text)         to authenticated, service_role;
grant execute on function public.mask_name(text)          to authenticated, service_role;

-- ------------------------------------------------------------
-- العرض الأساس يُقنّع الاسم
--
-- ⚠️ كل التقارير تقرأ من هنا (076)، فالتقنيع في مكان واحد يسري
--    عليها كلها — ولا شاشة تنسى أن تُقنّع.
--
-- وما عدا الاسم لم يتغيّر حرفاً عن 076/092: العمود الوحيد المُعدَّل
-- هو client_name.
-- ------------------------------------------------------------
create or replace view public.v_crm_opportunities as
select
  o.id,
  o.client_id,
  case when public.should_mask_client_pii()
       then public.mask_name(c.name) else c.name end as client_name,
  c.source           as client_source,
  o.owner_id,
  e.full_name        as owner_name,
  e.project_id       as team_id,
  o.project_id,
  p.name             as project_name,
  o.unit_id,
  o.source_id,
  coalesce(src.name, c.source) as source_name,
  o.campaign_id,
  o.stage_id,
  g.name             as stage_name,
  g.stage_type,
  g.sort_order       as stage_order,
  o.probability,
  o.expected_value,
  case when g.stage_type = 'open'
       then coalesce(o.expected_value, 0) * coalesce(o.probability, 0) / 100.0
       else 0 end    as weighted_value,
  o.won_value,
  o.lost_reason_id,
  lr.name            as lost_reason,
  o.created_at,
  o.closed_at,
  o.expected_close_date,
  o.stage_entered_at,
  o.last_activity_at,
  o.next_action_date,
  extract(epoch from (now() - o.stage_entered_at)) / 86400.0            as days_in_stage,
  extract(epoch from (coalesce(o.closed_at, now()) - o.created_at)) / 86400.0 as days_open,
  case when o.closed_at is not null
       then extract(epoch from (o.closed_at - o.created_at)) / 86400.0
  end                                                                   as sales_cycle_days,
  extract(epoch from (now() - coalesce(o.last_activity_at, o.created_at))) / 86400.0
                                                                        as days_silent,
  (o.next_action_date < public.baghdad_today())                         as is_overdue,
  c.lead_score,
  c.lead_temperature
from public.opportunities o
join public.crm_stages g   on g.id = o.stage_id
join public.clients c      on c.id = o.client_id
left join public.employees e on e.id = o.owner_id
left join public.projects p  on p.id = o.project_id
left join public.crm_sources src on src.id = o.source_id
left join public.crm_lost_reasons lr on lr.id = o.lost_reason_id
where o.deleted_at is null;

alter view public.v_crm_opportunities set (security_invoker = true);

comment on view public.v_crm_opportunities is
  'الأساس لكل تقارير الـCRM. الاسم مُقنَّع لمن يُقنَّع له (092) — التقنيع في مكان واحد فلا تنساه شاشة.';

grant select on public.v_crm_opportunities to authenticated;

-- ------------------------------------------------------------
-- عرضٌ مُقنَّع للعملاء — لمن احتاج قائمةً بلا هواتف
--
-- ⚠️ security_invoker: RLS تسري كما هي. التقنيع **فوقها** لا بدلاً
--    منها — من لا يرى الصفّ لا يراه مُقنَّعاً أيضاً.
-- ------------------------------------------------------------
create or replace view public.v_clients_masked as
select
  c.id,
  case when public.should_mask_client_pii()
       then public.mask_name(c.name) else c.name end  as name,
  case when public.should_mask_client_pii()
       then public.mask_phone(c.phone) else c.phone end as phone,
  c.stage, c.source, c.governorate, c.area,
  c.owner_id, c.lead_score, c.lead_temperature,
  c.created_at, c.last_contact_at, c.follow_up_date
from public.clients c
where c.deleted_at is null;

alter view public.v_clients_masked set (security_invoker = true);

comment on view public.v_clients_masked is
  'قائمة عملاء بلا هواتف لمن يُقنَّع له. RLS تسري كما هي — التقنيع فوقها لا بدلاً منها.';

grant select on public.v_clients_masked to authenticated;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 092 تقنيع البيانات الشخصية ---';
  raise notice 'هاتف: % ← %', '07701234567', public.mask_phone('07701234567');
  raise notice 'اسم: % ← %', 'أحمد علي حسن', public.mask_name('أحمد علي حسن');
  raise notice 'اسم بكلمة: % ← %', 'أحمد', public.mask_name('أحمد');
  raise notice 'التقنيع يسري على: التسويق وحده.';
  raise warning 'حدٌّ معلوم: قراءة clients مباشرةً عبر الواجهة البرمجية تبقى بلا تقنيع للتسويق — الضمانة تنظيمية (عقد + لا تصدير + تدقيق).';
end $$;

notify pgrst, 'reload schema';
