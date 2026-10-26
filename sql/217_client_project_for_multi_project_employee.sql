-- ============================================================
-- تلال ERP — 217: عملاء الموظف مفروزون على مشاريعه
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الطلب (2026-10-26): بعد 216 صار الموظف على أكثر من مشروع، وزبائن
--   كل مشروع غير زبائن الآخر — «نفرزهم للموظف حتى ما يتوه».
--
-- أين المشروع اليوم (قاعدة 206): البطاقة ← المفضّل ← الحملة ← مشروع
--   الموظّف. والبيانات الحيّة: ١٤١١ من ١٦٠٩ عملاء (٨٨٪) مشروعهم من
--   **مشروع موظّفهم** وحده. فموظفٌ على مشروعين يرى كل عملائه تحت
--   أساسيّه، وإن غيّر أساسيّه انتقلوا كلهم معه.
--
-- والمالك (2026-10-26): «انسب كل الزبائن إلى المشاريع الموكلة
--   لموظفيهم — تبارك كل زبائنها للفرقان، وعلى هذا الغرار — وأن يُختار
--   مشروعٌ للزبون عند إضافته مباشرةً». ولم يُضَف بعدُ زبونٌ لمدينة المستقبل.
--
-- الحلّ:
--   (١) clients.project_id («مشروع البطاقة»، 043) يصير **حقيقةً مسجّلة**
--       لكل عميل لا تخميناً: يُعبّأ مرّةً (القسم ٦) من مشروع موظّفه
--       الأساسي، وإلا من مشروع مساره. قيس على الحيّة: مشروع المسار
--       يطابق مشروع الموظّف لكل الموظفين بلا استثناء، فلا عميل ينتقل —
--       يصير مكتوباً فقط. والمدير (بلا مشروع) ١١ عميلاً بلا مسار بمشروع
--       يبقون بلا مشروع حتى يُفرَزوا.
--   (٢) والعميل الجديد يولد بمشروعه (القسم ٥، محفّز): ما اختير في
--       النموذج، وإلا المفضّل ← الحملة ← مشروع موظّفه. فالاستيراد وليدات
--       الإعلانات والإضافة السريعة كلها تحمل مشروعاً. وعند إسناد عميلٍ
--       بلا مشروع يأخذ مشروع موظّفه الجديد.
--   (٣) القاعدة الواحدة لمشروع الليد — والمسار قبل مشروع الموظّف:
--          البطاقة ← المفضّل ← الحملة ← المسار ← مشروع الموظّف
--       فلا يتبع العميلُ أساسيَّ موظّفه إن تغيّر.
--   (٤) تغيير مشروع البطاقة يُلحق به مساره المفتوح (ما لم يكن مربوطاً
--       بوحدة — فمشروعها هو مشروعه) وحقائق تقاريره: تصحيح فرز.
--   (٥) set_client_project(): تغيير مشروع عميل لمن يملك تعديله (RLS)،
--       وفي مشاريع مالكه أو مشاريعه هو — والإدارة أيّ مشروع. وجماعةً
--       bulk_set_client_project().
--
-- يتطلب: 206، 213، 216. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) القاعدة الواحدة لمشروع الليد — والمسار قبل مشروع الموظّف
-- ------------------------------------------------------------
-- المسار المفتوح أولاً، وإلا أحدث مسار. مشروعه جُمِّد يوم وُلد.
create or replace function public.lead_project_id(public.clients)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    $1.project_id,
    $1.preferred_project_id,
    (select k.project_id from public.crm_campaigns k where k.id = $1.campaign_id),
    (select o.project_id from public.opportunities o
      where o.client_id = $1.id and o.deleted_at is null and o.project_id is not null
      order by (o.closed_at is null) desc, o.created_at desc
      limit 1),
    (select e.project_id from public.employees e where e.id = $1.owner_id));
$$;
comment on function public.lead_project_id(public.clients) is
  'مشروع الليد: البطاقة ← المفضّل ← الحملة ← المسار ← مشروع الموظّف (206، 213، 217).';

create or replace function public.crm_lead_project(p_client_id uuid, p_owner_id uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    c.project_id,
    c.preferred_project_id,
    (select k.project_id from public.crm_campaigns k where k.id = c.campaign_id),
    (select o.project_id from public.opportunities o
      where o.client_id = c.id and o.deleted_at is null and o.project_id is not null
      order by (o.closed_at is null) desc, o.created_at desc
      limit 1),
    (select e.project_id from public.employees e where e.id = coalesce(p_owner_id, c.owner_id)))
  from public.clients c where c.id = p_client_id;
$$;
comment on function public.crm_lead_project(uuid, uuid) is
  'مشروع الليد: البطاقة ← المفضّل ← الحملة ← المسار ← مشروع الموظّف (206، 217).';

-- ------------------------------------------------------------
-- 2) خيارات مُرشِّحات القائمة — بالقاعدة نفسها لا بنسخةٍ منها
-- ------------------------------------------------------------
create or replace function public.crm_client_filter_options()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, c.owner_id, c.campaign_id, c.broker_company_id,
           public.lead_project_id(c) as project_id
      from public.clients c
     where c.id in (select public.my_visible_client_ids())
  )
  select jsonb_build_object(
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'n', x.n) order by x.name)
        from (select e.id, e.full_name as name, count(*) as n
                from mine m join public.employees e on e.id = m.owner_id
               group by e.id, e.full_name) x), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'n', x.n) order by x.name)
        from (select p.id, p.name, count(*) as n
                from mine m join public.projects p on p.id = m.project_id
               group by p.id, p.name) x), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'n', x.n) order by x.name)
        from (select k.id, k.name, count(*) as n
                from mine m join public.crm_campaigns k on k.id = m.campaign_id
               group by k.id, k.name) x), '[]'::jsonb),
    'brokers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'n', x.n) order by x.name)
        from (select b.id, b.name, count(*) as n
                from mine m join public.broker_companies b on b.id = m.broker_company_id
               group by b.id, b.name) x), '[]'::jsonb),
    'no_campaign', (select count(*) from mine where campaign_id is null)
  );
$$;

-- ------------------------------------------------------------
-- 3) مشروع البطاقة يُلحق به المسار المفتوح — وحقائق تقاريره
-- ------------------------------------------------------------
-- المسار المربوط بوحدة لا يُمسّ: مشروعه مشروع وحدته. والمسارات المغلقة
-- (بيع، خسارة) تبقى على مشروعها يومها.
--
-- تغيير المشروع **تصحيح فرز** (العميل كان لهذا المشروع والنظام خمّن
-- غيره)، فحقائق التقارير (crm_event_facts — تُجمَّد يوم الحدث) التي
-- حملت المشروع القديم للعميل أو لمساره المفتوح تُصحَّح معه — كما صحّح
-- 214 الحملة. وإلا بقي «ليد جديد» يُعدّ للمشروع الخطأ في التقارير.
create or replace function public.sync_client_project_to_journeys()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old uuid := public.lead_project_id(old);  -- المسار لم يُمسّ بعد
begin
  -- كتابة المشروع الفعلي نفسه على البطاقة (التعبئة، أو اختيار ما كان)
  -- لا تصحّح شيئاً في التقارير
  if v_old is distinct from new.project_id then
    update public.crm_event_facts f
       set project_id = new.project_id, updated_at = now()
     where f.client_id = new.id
       and f.project_id is not distinct from v_old
       and (f.opportunity_id is null
            or f.opportunity_id in (select o.id from public.opportunities o
                                     where o.client_id = new.id and o.deleted_at is null
                                       and o.closed_at is null and o.unit_id is null));
  end if;

  update public.opportunities o
     set project_id = new.project_id
   where o.client_id = new.id
     and o.deleted_at is null
     and o.closed_at is null
     and o.unit_id is null
     and o.project_id is distinct from new.project_id;
  return null;
end $$;

drop trigger if exists trg_sync_client_project_to_journeys on public.clients;
create trigger trg_sync_client_project_to_journeys
  after update of project_id on public.clients
  for each row
  when (new.project_id is distinct from old.project_id and new.project_id is not null)
  execute function public.sync_client_project_to_journeys();

-- ------------------------------------------------------------
-- 4) تغيير مشروع عميل
-- ------------------------------------------------------------
-- مشاريع موظفٍ بعينه — employee_projects محصورة بالنطاق، وهذه تُقرأ
-- للتحقّق وحده (مالك العميل قد يكون خارج نطاق قراءة السائل).
create or replace function public.employee_project_ids(p_employee_id uuid)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select ep.project_id from public.employee_projects ep where ep.employee_id = p_employee_id
  union
  select e.project_id from public.employees e
   where e.id = p_employee_id and e.project_id is not null;
$$;
revoke all on function public.employee_project_ids(uuid) from public, anon;
grant execute on function public.employee_project_ids(uuid) to authenticated;

-- security invoker عمداً: التعديل نفسه يمرّ بسياسة «update own clients»،
-- فمن لا يملك تعديل البطاقة لا يغيّر مشروعها.
create or replace function public.set_client_project(p_client_id uuid, p_project_id uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid;
  v_n     int;
begin
  if p_project_id is null then
    raise exception 'اختر المشروع';
  end if;
  if public.is_broker() then
    raise exception 'مشروع ليد الوسيط يُحدَّد من بوّابة الوسطاء';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'المشروع غير موجود';
  end if;

  select c.owner_id into v_owner from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'العميل غير موجود أو خارج صلاحيتك';
  end if;

  if not (public.is_admin() or public.is_marketing_manager() or public.is_followup_manager())
     and p_project_id not in (select x.id from public.employee_project_ids(v_owner) x
                              union
                              select m.id from public.my_project_ids() m) then
    raise exception 'هذا المشروع ليس من مشاريع موظف العميل';
  end if;

  update public.clients set project_id = p_project_id
   where id = p_client_id and project_id is distinct from p_project_id;
  get diagnostics v_n = row_count;

  -- صفرٌ بلا خطأ = RLS رفضت، إلا إن كان المشروع هو نفسه أصلاً
  if v_n = 0 and not exists (select 1 from public.clients
                              where id = p_client_id and project_id = p_project_id) then
    raise exception 'لا تملك تعديل هذا العميل';
  end if;
  return p_project_id;
end $$;

revoke all on function public.set_client_project(uuid, uuid) from public, anon;
grant execute on function public.set_client_project(uuid, uuid) to authenticated;

-- جماعةً من قائمة العملاء — لفرز ما سُجّل قبل 217 تحت الأساسي.
-- صفّاً صفّاً عبر set_client_project، فالحراسة نفسها، وصفٌّ مرفوض لا
-- يُسقط الدفعة (نمط 214).
create or replace function public.bulk_set_client_project(
  p_client_ids uuid[],
  p_project_id uuid
) returns table (succeeded int, failed int, first_error text)
language plpgsql security invoker set search_path = public as $$
declare
  cid   uuid;
  n_ok  int := 0;
  n_bad int := 0;
  err   text;
begin
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;

  foreach cid in array p_client_ids loop
    begin
      perform public.set_client_project(cid, p_project_id);
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

revoke all on function public.bulk_set_client_project(uuid[], uuid) from public, anon;
grant execute on function public.bulk_set_client_project(uuid[], uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) العميل يولد بمشروعه
-- ------------------------------------------------------------
-- النموذج يُلزم باختيار المشروع، لكن الاستيراد وليدات الإعلانات وكل
-- طريقٍ آخر يمرّ هنا: ما اختير، وإلا المفضّل ← الحملة ← مشروع موظّفه.
-- وعميلٌ بلا مشروع يُسند لموظف يأخذ مشروعه. ومشروعٌ مكتوب لا يُداس.
-- ليد الوسيط مشروعه من بوّابته (043، 188) فلا يُمسّ.
--
-- الاسم trg_y_ عمداً: محفّزات BEFORE تجري بترتيب أسمائها، وهذا بعد
-- trg_client_owner_sync (المالك من اسم الموظف) و trg_stamp_broker_lead.
-- و«update of sales_employee» لأن تغيير الاسم يغيّر المالك هناك.
create or replace function public.stamp_client_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null or new.broker_company_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;
  new.project_id := coalesce(
    new.preferred_project_id,
    (select k.project_id from public.crm_campaigns k where k.id = new.campaign_id),
    (select e.project_id from public.employees e where e.id = new.owner_id));
  return new;
end $$;

drop trigger if exists trg_y_stamp_client_project on public.clients;
create trigger trg_y_stamp_client_project
  before insert or update of owner_id, sales_employee on public.clients
  for each row execute function public.stamp_client_project();

-- ------------------------------------------------------------
-- 6) التعبئة: كل عميل على مشروع موظّفه
-- ------------------------------------------------------------
-- مشروع الموظّف الأساسي، وإلا مشروع مساره (عملاء المدير). المشروع
-- الفعلي لا يتغيّر لأحد (قيس قبلها) — يصير مكتوباً فقط، فيُوقف سجلّ
-- التدقيق أثناءها كما في 206 (١٥٠٠ صفّ «مشروع: فارغ ← كذا» ضجيج).
-- trg_sync_client_project_to_journeys يبقى: يملأ مساراً مفتوحاً بلا
-- مشروع، ولا يمسّ الحقائق (المشروع الفعلي لم يتغيّر). وما سواه من
-- المحفّزات لا يعمل بتغيير project_id وحده (فُحصت على الحيّة).
-- آمن لإعادة التشغيل: الفارغ وحده.
do $fill$
declare n int;
begin
  alter table public.clients disable trigger trg_audit_clients;

  update public.clients c
     set project_id = x.pid
    from (
      select c2.id,
             coalesce(
               (select e.project_id from public.employees e where e.id = c2.owner_id),
               (select o.project_id from public.opportunities o
                 where o.client_id = c2.id and o.deleted_at is null and o.project_id is not null
                 order by (o.closed_at is null) desc, o.created_at desc
                 limit 1)) as pid
        from public.clients c2
       where c2.project_id is null
         and c2.broker_company_id is null
         and c2.deleted_at is null
         and c2.merged_into is null
    ) x
   where x.id = c.id and x.pid is not null;
  get diagnostics n = row_count;

  alter table public.clients enable trigger trg_audit_clients;
  raise notice '217: كُتب مشروع % عميلاً', n;
end $fill$;

notify pgrst, 'reload schema';
