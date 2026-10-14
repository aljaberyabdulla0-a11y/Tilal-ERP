-- ============================================================
-- تلال ERP — 213: مُرشِّحات قائمة العملاء — المشروع والحملة وموظف المبيعات
--
-- الطلب (٢٠٢٦-١٠-١٤): مُرشِّحات أكثر في قائمة العملاء (المشروع، الحملة،
--   موظف المبيعات، …) كي يتابع المدراء — كلٌّ بحسب صلاحيته: المشرف
--   مشاريعه، ومدير التسويق والمدير كل المشاريع.
--
-- (١) lead_project_id(clients) — حقلٌ محسوب يُرشَّح عليه في PostgREST
--     (?lead_project_id=eq.…) بلا عمود جديد. هو crm_lead_project (206)
--     نفسها: البطاقة ← المفضّل ← الحملة ← مشروع الموظّف. فمُرشِّح «المشروع»
--     في القائمة يطابق «المشروع» في التقارير و«لماذا نخسر؟».
--     security definer لأن employees ممنوع على غير المدير (الرواتب) —
--     وهو يُرجع معرّف مشروعٍ لصفٍّ يراه السائل أصلاً، لا أكثر.
--
-- (٢) crm_client_filter_options() — خيارات المُرشِّحات من العملاء الذين
--     يراهم السائل وحدهم (my_visible_client_ids، 211)، مع عددهم:
--     موظفو المبيعات، والمشاريع، والحملات، والشركات الوسيطة.
--     فالصلاحية لا تُكتب مرّتين: المشرف يرى في القائمة مشاريع فريقه
--     وموظفيه، ومدير التسويق والمدير الكل (212)، والموظف نفسه.
--     كان «الموظف» يُبنى من team_members، فمدير التسويق (دوره employee)
--     يرى كل الليدات ولا يجد مُرشِّح الموظف أصلاً.
--
-- آمن لإعادة التشغيل.
-- ============================================================

-- (١) مشروع الليد حقلاً محسوباً
create or replace function public.lead_project_id(public.clients)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    $1.project_id,
    $1.preferred_project_id,
    (select k.project_id from public.crm_campaigns k where k.id = $1.campaign_id),
    (select e.project_id from public.employees e where e.id = $1.owner_id));
$$;
comment on function public.lead_project_id(public.clients) is
  'مشروع الليد حقلاً محسوباً للترشيح في PostgREST — قاعدة crm_lead_project (206) (213).';
revoke all on function public.lead_project_id(public.clients) from public, anon;
grant execute on function public.lead_project_id(public.clients) to authenticated;

-- (٢) خيارات المُرشِّحات — من نطاق السائل
create or replace function public.crm_client_filter_options()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, c.owner_id, c.campaign_id, c.broker_company_id,
           coalesce(c.project_id, c.preferred_project_id, k.project_id, e.project_id) as project_id
      from public.clients c
      left join public.crm_campaigns k on k.id = c.campaign_id
      left join public.employees e on e.id = c.owner_id
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
comment on function public.crm_client_filter_options() is
  'خيارات مُرشِّحات قائمة العملاء (موظف، مشروع، حملة، وسيط) من العملاء الظاهرين للسائل وحده، مع العدد (213).';
revoke all on function public.crm_client_filter_options() from public, anon;
grant execute on function public.crm_client_filter_options() to authenticated;

notify pgrst, 'reload schema';
