-- ============================================================
-- تلال ERP — 206: الليد يُنسب لمشروعه — والخسارة والمسار والأحداث معه
--
-- العَرَض (٢٠٢٦-١٠-١٣): «لماذا نخسر؟» بمُرشِّح المشروع يُظهر صفراً تقريباً.
--   ١٤١٨ عميلاً وليس على أيّ بطاقة مشروع، فكل الخسائر الـ١٠٥١ بلا مشروع،
--   و١٠٤٩ من أحداث الخسارة بلا مشروع. والمالك: «كل ليد في النظام تابع لمشروع».
--
-- أين المشروع فعلاً: عبر موظّفه. الفريق هو المشروع منذ 037
--   (employees.project_id): لاماك ٨٤٤، الفرقان ٣٤٩، داماك ١٩٣ = ١٣٨٦ عميلاً.
--   وحملة مربوطة بمشروع لـ١٤ عميلاً، ومشروع مفضّل لـ٩.
--
-- القاعدة — تعريفٌ واحد (crm_lead_project):
--   مشروع البطاقة ← المشروع المفضّل ← مشروع الحملة ← مشروع الموظّف (فريقه)
--   ويُحفظ «أساس النسبة» مع كل خسارة (project_basis) فلا يُقرأ المستنتَج كمُدخَل.
--
--   1) المسار يأخذ مشروع ليده إن خلا: عند الإنشاء (prepare_opportunity)،
--      وعند إسناد العميل (sync_open_opportunities_owner)، وترحيلاً للقائم.
--   2) الخسارة الجديدة: crm_build_lost_row يكمل المشروع بالقاعدة نفسها.
--   3) الخسائر القديمة: مشروع مسارها، وإلا «فريق» الخسارة المجمَّد يومها
--      (team_id = مشروع موظّفها يوم الخسارة) — بيانٌ مسجَّل لا تخمين.
--   4) أحداث التقارير بلا مشروع: مشروع مسارها، وإلا فريقها المجمَّد يوم الحدث.
--      وcrm_event_dims يكمل المشروع للأحداث القادمة بالقاعدة نفسها.
--
-- الترحيل لا يمسّ تحليل أي خسارة ولا قيمتها ولا تاريخ تعديلها (محفّزات
-- الختم والسجلّ تُوقف أثناءه ويُسجَّل في crm_journey_migration_runs).
-- آمن لإعادة التشغيل. المواضع تُطابَق بعد نزع \r من الطرفين.
-- ============================================================

alter table public.crm_lost_sales add column if not exists project_basis text;
comment on column public.crm_lost_sales.project_basis is
  'من أين جاء المشروع: journey | unit | client | preferred | campaign | team (مشروع الموظّف يوم الخسارة) | null (لا يُعرف) (206).';

-- (أ) التعريف الواحد لمشروع الليد
create or replace function public.crm_lead_project(p_client_id uuid, p_owner_id uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    c.project_id,
    c.preferred_project_id,
    (select k.project_id from public.crm_campaigns k where k.id = c.campaign_id),
    (select e.project_id from public.employees e where e.id = coalesce(p_owner_id, c.owner_id)))
  from public.clients c where c.id = p_client_id;
$$;
comment on function public.crm_lead_project(uuid, uuid) is
  'مشروع الليد: البطاقة ← المفضّل ← الحملة ← مشروع الموظّف (الفريق) (206).';
revoke all on function public.crm_lead_project(uuid, uuid) from public, anon;
grant execute on function public.crm_lead_project(uuid, uuid) to authenticated;

-- (ب) ترقيع الدوال — المسار يولد بمشروعه، والإسناد يكمله، والخسارة والأحداث تكملانه
do $patch$
declare d text; d2 text;
begin
  -- prepare_opportunity: عند الإنشاء
  d := replace(pg_get_functiondef('public.prepare_opportunity()'::regprocedure), E'\r', '');
  if position('crm_lead_project' in d) = 0 then
    d2 := regexp_replace(d,
      $q$(select owner_id into new\.owner_id from public\.clients where id = new\.client_id;\s+end if;)$q$,
      E'\\1\n    -- 206: المسار يولد بمشروع ليده\n    if new.project_id is null then\n      new.project_id := public.crm_lead_project(new.client_id, new.owner_id);\n    end if;');
    if d2 = d then raise exception '206: لم يُعثر على موضع الترقيع في prepare_opportunity'; end if;
    execute d2;
  end if;

  -- sync_open_opportunities_owner: إسناد العميل يكمل مشروع مساره المفتوح إن خلا
  d := replace(pg_get_functiondef('public.sync_open_opportunities_owner()'::regprocedure), E'\r', '');
  if position('crm_lead_project' in d) = 0 then
    d2 := replace(d, 'set owner_id = new.owner_id',
                     'set owner_id = new.owner_id, project_id = coalesce(o.project_id, public.crm_lead_project(new.id, new.owner_id))');
    if d2 = d then raise exception '206: لم يُعثر على موضع الترقيع في sync_open_opportunities_owner'; end if;
    execute d2;
  end if;

  -- crm_build_lost_row: الخسارة الجديدة تُنسب لمشروع ليدها، وأساس النسبة معها
  d := replace(pg_get_functiondef('public.crm_build_lost_row'::regproc), E'\r', '');
  if position('project_basis' in d) = 0 then
    d2 := replace(d, '  v.project_id  := coalesce(o.project_id, u.project_id);',
$r$  v.project_id  := coalesce(o.project_id, u.project_id,
                            public.crm_lead_project(o.client_id, o.owner_id), v.team_id);
  v.project_basis := case when o.project_id is not null then 'journey'
                          when u.project_id is not null then 'unit'
                          when c.project_id is not null then 'client'
                          when c.preferred_project_id is not null then 'preferred'
                          when exists (select 1 from public.crm_campaigns k
                                        where k.id = c.campaign_id and k.project_id is not null) then 'campaign'
                          when v.project_id is not null then 'team' end;$r$);
    if d2 = d then raise exception '206: لم يُعثر على موضع الترقيع في crm_build_lost_row'; end if;
    execute d2;
  end if;

  -- crm_event_dims: الأحداث القادمة تحمل مشروع ليدها (الموظّف = مالكه يوم الحدث)
  d := replace(pg_get_functiondef('public.crm_event_dims'::regproc), E'\r', '');
  if position('crm_lead_project' in d) = 0 then
    d2 := replace(d, 'coalesce(o.project_id, c.project_id, c.preferred_project_id),',
                     'coalesce(o.project_id, public.crm_lead_project(c.id, own.id)),');
    if d2 = d then raise exception '206: لم يُعثر على موضع الترقيع في crm_event_dims'; end if;
    execute d2;
  end if;
end $patch$;

-- (ج) الترحيل
do $migrate$
declare
  n_j int; n_l int; n_f int;
begin
  if exists (select 1 from public.crm_journey_migration_runs where phase = '206') then
    raise notice '206: الترحيل سبق — يُتخطّى.';
    return;
  end if;

  -- 1) المسارات بلا مشروع: مشروع ليدها (مالك المسار نفسه — للمغلق مالكه يوم أُغلق)
  alter table public.opportunities disable trigger trg_audit_opportunities;
  update public.opportunities o
     set project_id = public.crm_lead_project(o.client_id, o.owner_id)
   where o.project_id is null
     and public.crm_lead_project(o.client_id, o.owner_id) is not null;
  get diagnostics n_j = row_count;
  alter table public.opportunities enable trigger trg_audit_opportunities;

  -- 2) الخسائر بلا مشروع: مشروع مسارها، وإلا فريقها المجمَّد يوم الخسارة.
  --    التحليل والقيمة وتاريخ التعديل لا تُمسّ: محفّزات الختم والسجلّ موقوفة.
  alter table public.crm_lost_sales disable trigger trg_stamp_lost_sale;
  alter table public.crm_lost_sales disable trigger trg_log_lost_sale_change;
  alter table public.crm_lost_sales disable trigger trg_audit_crm_lost_sales;
  update public.crm_lost_sales l
     set project_id = coalesce(o.project_id, l.team_id),
         project_basis = case when o.project_id is not null then 'journey' else 'team' end
    from public.opportunities o
   where o.id = l.opportunity_id
     and l.project_id is null
     and coalesce(o.project_id, l.team_id) is not null;
  get diagnostics n_l = row_count;
  update public.crm_lost_sales set project_basis = 'journey'
   where project_id is not null and project_basis is null;
  alter table public.crm_lost_sales enable trigger trg_stamp_lost_sale;
  alter table public.crm_lost_sales enable trigger trg_log_lost_sale_change;
  alter table public.crm_lost_sales enable trigger trg_audit_crm_lost_sales;

  -- 3) أحداث التقارير بلا مشروع: مشروع مسارها، وإلا الفريق المجمَّد يوم الحدث
  update public.crm_event_facts f
     set project_id = coalesce(
           (select o.project_id from public.opportunities o where o.id = f.opportunity_id),
           f.team_id),
         updated_at = now()
   where f.project_id is null
     and coalesce((select o.project_id from public.opportunities o where o.id = f.opportunity_id), f.team_id) is not null;
  get diagnostics n_f = row_count;

  insert into public.crm_journey_migration_runs (phase, counts)
  values ('206', jsonb_build_object(
    'journeys_given_project', n_j,
    'losses_given_project',   n_l,
    'facts_given_project',    n_f,
    'losses_without_project', (select count(*) from public.crm_lost_sales where project_id is null),
    'losses_by_project',      (select jsonb_object_agg(coalesce(p.name, '∅'), x.n) from
                                (select project_id, count(*) n from public.crm_lost_sales group by 1) x
                                left join public.projects p on p.id = x.project_id),
    'losses_by_basis',        (select jsonb_object_agg(coalesce(project_basis, '∅'), n) from
                                (select project_basis, count(*) n from public.crm_lost_sales group by 1) x)));

  raise notice '206: مسارات % · خسائر % · أحداث % نالت مشروعها', n_j, n_l, n_f;
end $migrate$;

-- ===== التحقّق =====
do $$
declare v jsonb;
begin
  select counts into v from public.crm_journey_migration_runs where phase = '206' order by at desc limit 1;
  raise notice '206: %', v;
end $$;
