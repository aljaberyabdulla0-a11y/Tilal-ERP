-- ============================================================
-- تلال ERP — 188: ليد الوسيط — الشركة صاحبته، والـRM مسؤول متابعته
--
-- العَرَض: بعد 186 بقي في «ليدات بلا مالك» ليد واحد بلا اسم موظف: ليدٌ
--   أدخلته شركة وسيطة من بوّابتها. stamp_broker_lead (043/117) يختم
--   الشركة والمهلة، ولا يسند الليد لأحد في تلال — فلا يظهر في متابعة
--   أي موظف، ولا يُحسب في حِمل أحد.
--
-- القاعدة (طلب المالك ٢٠٢٦-١٠-٠٨):
--   • صاحب الليد = الشركة الوسيطة (clients.broker_company_id) — كما هو.
--   • المسؤول عن متابعته في تلال = مدير علاقات الشركة على مشروع الليد
--     (broker_company_projects.rm_id) ← clients.owner_id.
--   فالليد يظهر في قائمة الـRM ولوحته وحِمله، والواجهة تعرض اسم الشركة
--   صاحبةً والـRM متابعاً.
--
-- المسارات:
--   1) broker_lead_rm(): الـRM للشركة على المشروع؛ وإن لم يكن للّيد مشروع
--      (أو لا إسناد عليه) فالـRM الوحيد للشركة إن لم يكن لها إلا واحد.
--      غير ذلك null — يبقى الليد في «بلا مالك» حتى يُحسم يدوياً.
--   2) إدخال ليد بشركة (بوّابة الوسيط) ← المالك = الـRM.
--   3) إسناد ليد لشركة (أو تغيير مشروعه) ← المالك = الـRM.
--      عودته لتلال (انتهاء المهلة أو سحبه) ← يُفرَّغ المالك إن كان هو الـRM
--      نفسه، فيدخل «ليدات بلا مالك» ويوزَّع كأي ليد عائد.
--   4) تغيّر الـRM على (شركة، مشروع) ← ليدات الشركة المفتوحة تتبعه.
--   5) ترحيل ليدات الوسطاء الحالية.
--
-- ⚠️ محفّز BEFORE يغيّر owner_id في UPDATE لم يذكره لا يُطلق المحفّزات
--    المقيّدة بـ «UPDATE OF owner_id» — Postgres يقرّر ذلك من قائمة SET لا
--    من NEW. فسجلّ الإسناد (071) ومزامنة الفرصة (187) يصيران محفّزَي
--    UPDATE عامَّين بشرط على NEW/OLD، وإلا لنُقل الليد للـRM بلا أثر في
--    client_assignments وبقيت فرصته بلا مالك.
-- ============================================================

-- 1) الـRM المسؤول عن ليد الشركة
create or replace function public.broker_lead_rm(p_company uuid, p_project uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select bcp.rm_id from public.broker_company_projects bcp
      where bcp.company_id = p_company and bcp.project_id = p_project
        and bcp.rm_id is not null),
    (select case when count(distinct bcp.rm_id) = 1 then (array_agg(bcp.rm_id))[1] end
       from public.broker_company_projects bcp
      where bcp.company_id = p_company and bcp.rm_id is not null)
  );
$$;

comment on function public.broker_lead_rm(uuid, uuid) is
  'مدير علاقات الشركة الوسيطة المسؤول عن ليدها: على مشروع الليد، وإلا الوحيد للشركة، وإلا null (188).';

revoke all on function public.broker_lead_rm(uuid, uuid) from public, anon, authenticated;

-- 2) إدخال ليد بشركة ← الـRM مالكاً
--    trg_stamp_broker_lead يعمل بعد trg_client_owner_sync (ترتيب الأسماء)،
--    فنكتب مرآة الاسم هنا بأنفسنا.
create or replace function public.stamp_broker_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  my_company uuid := public.my_broker_company();
  today      date := (now() at time zone 'Asia/Baghdad')::date;
  rm         uuid;
begin
  if my_company is not null then
    new.broker_company_id := my_company;
  end if;
  if new.broker_company_id is not null then
    new.broker_assigned_at := coalesce(new.broker_assigned_at, now());
    new.broker_deadline    := coalesce(new.broker_deadline, today + public.broker_lead_days());
    new.returned_at        := null;
    new.returned_from      := null;

    rm := public.broker_lead_rm(new.broker_company_id, new.project_id);
    if rm is not null then
      new.owner_id          := rm;
      new.sales_employee    := (select full_name from public.employees where id = rm);
      new.owner_assigned_at := now();
    end if;
  end if;
  return new;
end; $$;

-- 3) إسناد لشركة / تغيير المشروع / العودة لتلال
create or replace function public.reassign_broker_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  today  date := (now() at time zone 'Asia/Baghdad')::date;
  old_rm uuid;
  new_rm uuid;
begin
  if new.broker_company_id is distinct from old.broker_company_id then
    if new.broker_company_id is not null then
      new.broker_assigned_at := now();
      new.broker_deadline    := today + public.broker_lead_days();
      new.returned_at        := null;
      new.returned_from      := null;
    else
      new.broker_assigned_at := null;
      new.broker_deadline    := null;
      new.returned_at        := coalesce(new.returned_at, now());
      new.returned_from      := coalesce(new.returned_from, old.broker_company_id);
    end if;
  end if;

  if new.broker_company_id is not distinct from old.broker_company_id
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  if old.broker_company_id is not null then
    old_rm := public.broker_lead_rm(old.broker_company_id, old.project_id);
  end if;
  if new.broker_company_id is not null then
    new_rm := public.broker_lead_rm(new.broker_company_id, new.project_id);
  end if;

  -- المالك يتبع الـRM ما دام هو الـRM السابق أو لا مالك — إسنادٌ يدويّ
  -- لموظف آخر لا يُداس.
  if new.owner_id is null or new.owner_id is not distinct from old_rm then
    if new.broker_company_id is not null then
      if new_rm is not null then
        new.owner_id          := new_rm;
        new.sales_employee    := (select full_name from public.employees where id = new_rm);
        new.owner_assigned_at := now();
      end if;
    elsif old_rm is not null and new.owner_id is not distinct from old_rm then
      -- عاد لتلال: الـRM تابَع الشركة لا العميل — الليد للتوزيع
      new.owner_id          := null;
      new.sales_employee    := null;
      new.owner_assigned_at := null;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_reassign_broker_lead on public.clients;
create trigger trg_reassign_broker_lead
  before update of broker_company_id, project_id on public.clients
  for each row execute function public.reassign_broker_lead();

-- 4) تغيّر الـRM على (شركة، مشروع) ← ليدات الشركة المفتوحة تتبعه
create or replace function public.broker_leads_follow_rm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.rm_id is not distinct from old.rm_id then
    return null;
  end if;

  update public.clients c
     set owner_id = r.rm
    from (select c2.id, public.broker_lead_rm(c2.broker_company_id, c2.project_id) as rm
            from public.clients c2
           where c2.broker_company_id = new.company_id
             and c2.deleted_at is null
             and public.is_open_stage(c2.stage)) r
   where c.id = r.id
     and r.rm is not null
     and c.owner_id is distinct from r.rm
     and (c.owner_id is null
          or (tg_op = 'UPDATE' and c.owner_id is not distinct from old.rm_id));
  return null;
end; $$;

drop trigger if exists trg_broker_leads_follow_rm on public.broker_company_projects;
create trigger trg_broker_leads_follow_rm
  after insert or update of rm_id on public.broker_company_projects
  for each row execute function public.broker_leads_follow_rm();

-- ===== المحفّزات المقيّدة بالأعمدة ← عامّة (انظر ⚠️ أعلاه) =====
drop trigger if exists trg_log_client_assignment on public.clients;
create trigger trg_log_client_assignment
  after insert or update on public.clients
  for each row execute function public.log_client_assignment();

drop trigger if exists trg_sync_open_opportunities_owner on public.clients;
create trigger trg_sync_open_opportunities_owner
  after update on public.clients
  for each row
  when (new.owner_id is distinct from old.owner_id)
  execute function public.sync_open_opportunities_owner();

-- 5) الترحيل: ليدات الوسطاء بلا مالك ← الـRM
update public.clients c
   set owner_id          = r.rm,
       owner_assigned_at = coalesce(c.broker_assigned_at, c.created_at)
  from (select c2.id, public.broker_lead_rm(c2.broker_company_id, c2.project_id) as rm
          from public.clients c2
         where c2.broker_company_id is not null and c2.owner_id is null) r
 where c.id = r.id
   and r.rm is not null;

-- ===== التحقّق =====
do $$
declare n_left int; n_open int;
begin
  select count(*) into n_left from public.clients
   where broker_company_id is not null and owner_id is null;
  select count(*) into n_open from public.clients
   where owner_id is null and public.is_open_stage(stage);
  raise notice '188: ليدات وسطاء بلا RM: %   ليدات مفتوحة بلا مالك: %', n_left, n_open;
end $$;
