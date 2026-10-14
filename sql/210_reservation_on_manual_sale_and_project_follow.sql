-- ============================================================
-- تلال ERP — 210: حجزٌ يُثبت بيعاً يدوياً لا يفتح مساراً ثانياً،
--                 ومشروع البطاقة يصل إلى مسارها
--
-- 1) العَرَض: ٤ مسارات «بيع» نُقلت يدوياً بلا حجز (فلا عمولة ولا إيراد).
--    والطريق الصحيح لإثباتها: حجز ← طلب بيع ← قبول ← تأكيد المقدمة بالسعر.
--    لكن link_reservation_opportunity (201) يعامل العميل الذي مساره الحالي
--    «بيع» كمشترٍ عائد فيفتح له مساراً جديداً ⇒ بيعٌ واحد يُعدّ مرتين
--    (وقع فعلاً قبل 201 لـ«زينة جابر ياس»).
--    القاعدة: مسار «بيع» بلا حجز قائم ولا بيع مكتمل هو البيع نفسه يُثبَت —
--    الحجز يُربط به. ومسار «بيع» عليه بيع مكتمل ⇒ شراء جديد كما كان.
--
-- 2) عملاء المدير (عبدالله محمد — ليس في فريق مشروع) بلا مشروع: ١٢ مساراً
--    مفتوحاً. يحدّد الموظف «المشروع المفضّل» في تبويب التأهيل، فيصل المشروع
--    إلى المسار المفتوح الفارغ تلقائياً — وإلى خسارته وأحداثه بعده (206).
--
-- آمن لإعادة التشغيل. المواضع تُطابَق بعد نزع \r.
-- ============================================================

do $p$
declare d text; d2 text;
begin
  d := replace(pg_get_functiondef('public.link_reservation_opportunity()'::regprocedure), E'\r', '');
  if position('210:' in d) = 0 then
    d2 := replace(d, $a$  if cur is not null and t <> 'won' then$a$,
$b$  -- 210: «بيع» يدوي بلا حجز قائم ولا بيع مكتمل = البيع نفسه يُثبَت بالحجز
  if cur is not null and t = 'won'
     and not exists (select 1 from public.reservations r
                      where r.opportunity_id = cur and r.status in ('حجز', 'بيع مكتمل')) then
    new.opportunity_id := cur;
    return new;
  end if;

  if cur is not null and t <> 'won' then$b$);
    if d2 = d then raise exception '210: لم يُعثر على موضع الترقيع في link_reservation_opportunity'; end if;
    execute d2;
  end if;
end $p$;

create or replace function public.journey_project_follows_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.opportunities o
     set project_id = public.crm_lead_project(new.id, o.owner_id)
   where o.client_id = new.id
     and o.deleted_at is null
     and o.project_id is null
     and o.closed_at is null
     and public.crm_lead_project(new.id, o.owner_id) is not null;
  return null;
end $$;
comment on function public.journey_project_follows_client() is
  'مشروع البطاقة أو المفضّل أو الحملة يملأ المسار المفتوح الفارغ (210).';

drop trigger if exists trg_journey_project_follows_client on public.clients;
create trigger trg_journey_project_follows_client
  after update of project_id, preferred_project_id, campaign_id on public.clients
  for each row
  when (new.project_id is distinct from old.project_id
        or new.preferred_project_id is distinct from old.preferred_project_id
        or new.campaign_id is distinct from old.campaign_id)
  execute function public.journey_project_follows_client();
