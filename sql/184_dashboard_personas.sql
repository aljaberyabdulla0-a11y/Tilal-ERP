-- ============================================================
-- تلال ERP — 184: لوحة لكل شخص — من منصبه وعلاقاته، وتخصيص المدير
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل اختباراته (185):  select * from tests.run_dashboard_personas();
--
-- ===== المشكلة =====
--
-- اللوحة كانت تُختار بـ profiles.role وحده. لكن الحسابات كلها على أدوار
-- نظامية عامّة (employee / supervisor)، بينما المنصب في HR يقول غير ذلك:
--   مديرة التسويق بدور employee      ← كانت تفتح لوحة المبيعات
--   مديرة المتابعة بدور supervisor   ← كانت تفتح لوحة الفريق
--   موظفو مبيعات هم مدراء علاقات وسطاء ← لا يرون الوساطة في لوحتهم
--
-- ===== القاعدة =====
--
-- ١) الدور الصريح يحكم: admin · broker · accountant · hr · viewer · marketing
--    · followup_manager · relationship_manager — اختارها المدير عمداً.
-- ٢) للموظف والمشرف (الأدوار العامّة): الدور المُسنَد غير النظامي
--    (profiles.role_code، 146) ← وإلا منصبه (positions.default_role_code)
--    ← وإلا دوره.
-- ٣) علاقات حقيقية تضيف ألسنة: مدير علاقات وسيط ← «الوساطة»؛ عضو فريق
--    التسويق ← «التسويق»؛ مشرف ← «فريقي»؛ له ليدات باسمه ← «مبيعاتي».
-- ٤) المدير يرى كل اللوحات ألسنةً.
-- ٥) تخصيص المدير لشخصٍ (dashboard_assignments) يغلب كل ما سبق.
--
-- ⚠️ اللوحة عرضٌ لا صلاحية. ما يُرى داخلها تقرّره RLS بدور الحساب
--    (profiles.role). فمنصبٌ يقترح دوراً لا يملكه صاحبه يُعلَّم «عدم
--    تطابق»، والواجهة تقول ذلك بدل أن تعرض أقساماً فارغة كأنها أصفار.
--    تصحيح الدور نفسه من «الأدوار والصلاحيات» — قرار المدير لا هذه الهجرة.
--
-- يتطلب: 121 (mkt_team)، 128 (broker_company_projects.rm_id)، 145/146.
-- آمن لإعادة التشغيل.
-- ============================================================

create table if not exists public.dashboard_assignments (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  views      text[] not null
             check (cardinality(views) between 1 and 10
                    and views <@ array['executive','team','sales','marketing','followup','rm',
                                       'finance','hr','viewer','broker']::text[]),
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);

comment on table public.dashboard_assignments is
  'تخصيص المدير للوحة شخصٍ بعينه (184): يغلب الاختيار التلقائي من المنصب. الكتابة عبر set_dashboard_views وحدها.';

alter table public.dashboard_assignments enable row level security;

drop policy if exists "read own or admin dashboard assignment" on public.dashboard_assignments;
create policy "read own or admin dashboard assignment" on public.dashboard_assignments
  for select using (user_id = auth.uid() or (select public.is_admin()));
-- لا سياسة كتابة: التعديل عبر set_dashboard_views (للمدير) فقط.

revoke all on public.dashboard_assignments from anon;
grant select on public.dashboard_assignments to authenticated;


-- ============================================================
-- ١) اللوحات لمستخدمٍ معيّن — داخلية (لا تُمنح للمستخدمين مباشرةً)
-- ============================================================
create or replace function public.dashboard_views_for(p_user uuid, p_ignore_override boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_role text; v_code text; v_sys boolean;
  v_emp uuid; v_pos text; v_pos_title text; v_pos_name text;
  v_persona text; v_primary text;
  v_views text[] := '{}';
  v_over text[];
  v_rm boolean := false; v_mkt boolean := false; v_leads boolean := false;
begin
  select p.role, p.role_code into v_role, v_code from public.profiles p where p.id = p_user;
  if v_role is null then
    return jsonb_build_object('views', jsonb_build_array('sales'), 'primary', 'sales', 'source', 'auto', 'mismatch', false);
  end if;

  select r.is_system into v_sys from public.roles r where r.code = v_code;

  select e.id, ps.default_role_code, ps.title_ar into v_emp, v_pos, v_pos_title
    from public.employees e
    left join public.positions ps on ps.id = e.position_id
   where e.user_id = p_user
   order by (e.status = 'active') desc, e.created_at desc
   limit 1;
  select r.name_ar into v_pos_name from public.roles r where r.code = v_pos;

  -- ١ و٢: من «هو» هذا الشخص
  v_persona := case
    when v_role in ('admin', 'broker', 'accountant', 'hr', 'viewer', 'marketing',
                    'followup_manager', 'relationship_manager') then v_role
    when v_code is not null and not coalesce(v_sys, true) then v_code
    when v_pos is not null then v_pos
    else v_role
  end;

  v_primary := case
    when v_persona in ('admin', 'general_manager')                            then 'executive'
    when v_persona = 'broker'                                                 then 'broker'
    when v_persona in ('marketing', 'marketing_manager', 'marketing_employee') then 'marketing'
    when v_persona in ('followup_manager', 'operations_manager')             then 'followup'
    when v_persona = 'relationship_manager'                                   then 'rm'
    when v_persona in ('accountant', 'finance_manager')                       then 'finance'
    when v_persona in ('hr', 'hr_manager', 'hr_officer')                      then 'hr'
    when v_persona = 'viewer'                                                 then 'viewer'
    when v_persona in ('supervisor', 'sales_manager', 'crm_manager', 'project_manager') then 'team'
    else 'sales'
  end;

  -- ٣: العلاقات
  if v_emp is not null then
    v_rm := exists (select 1 from public.broker_company_projects b where b.rm_id = v_emp);
    v_mkt := exists (select 1 from public.mkt_team mt where mt.employee_id = v_emp and mt.is_active);
    v_leads := exists (select 1 from public.clients c
                        where c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null);
  end if;

  if v_role = 'admin' then
    -- ٤: الإدارة ترى كل شيء
    v_views := array['executive', 'team', 'sales', 'marketing', 'followup', 'rm', 'finance', 'hr'];
  elsif v_role = 'broker' then
    v_views := array['broker'];
  else
    v_views := array[v_primary];
    -- «فريقي» لمن دوره مشرف: RLS تعطيه فريق مشروعه
    if v_role = 'supervisor' then v_views := array_append(v_views, 'team'); end if;
    if v_mkt then v_views := array_append(v_views, 'marketing'); end if;
    if v_rm or v_role = 'relationship_manager' then v_views := array_append(v_views, 'rm'); end if;
    if v_leads and v_role not in ('viewer', 'accountant', 'hr') then v_views := array_append(v_views, 'sales'); end if;
  end if;

  -- بلا تكرار، بالترتيب
  select coalesce(array_agg(u.v order by u.ord), '{}') into v_views
    from (select v, min(o) ord from unnest(v_views) with ordinality t(v, o) group by v) u;

  -- ٥: تخصيص المدير
  if not p_ignore_override then
    select a.views into v_over from public.dashboard_assignments a where a.user_id = p_user;
  end if;

  return jsonb_build_object(
    'views',          to_jsonb(coalesce(v_over, v_views)),
    'auto',           to_jsonb(v_views),
    'primary',        coalesce(v_over[1], v_primary),
    'source',         case when v_over is not null then 'override' else 'auto' end,
    'role',           v_role,
    'persona',        v_persona,
    'position_title', v_pos_title,
    'position_role',  v_pos,
    'position_role_name', v_pos_name,
    'is_rm',          v_rm,
    'in_mkt_team',    v_mkt,
    -- اللوحة الأساسية تحتاج صلاحيةً لا يملكها الحساب ← أقسامٌ ستظهر فارغة.
    -- (منصبٌ أدنى من الدور — موظف مبيعات بدور مشرف — ليس عدم تطابق: يرى أكثر لا أقل)
    'mismatch',       case v_primary
                        when 'marketing' then v_role not in ('marketing', 'admin', 'viewer') and not v_mkt
                        when 'followup'  then v_role not in ('followup_manager', 'admin')
                        when 'finance'   then v_role not in ('accountant', 'admin')
                        when 'hr'        then v_role not in ('hr', 'admin')
                        when 'team'      then v_role not in ('supervisor', 'admin')
                        when 'executive' then v_role <> 'admin'
                        else false
                      end
  );
end;
$fn$;

comment on function public.dashboard_views_for(uuid, boolean) is
  'لوحات مستخدمٍ: الدور الصريح ← الدور المُسنَد ← المنصب، وألسنة من العلاقات (وسيط/تسويق/مشرف/ليدات)، والمدير كل شيء، وتخصيص المدير يغلب (184). داخلية.';


-- ============================================================
-- ٢) لوحاتي — للمستخدم نفسه فقط
-- ============================================================
create or replace function public.my_dashboard_views()
returns jsonb
language sql stable security definer set search_path = public as $$
  select public.dashboard_views_for(auth.uid(), false);
$$;

comment on function public.my_dashboard_views() is
  'لوحات المستخدم الحالي (184) — لا يُطلب بها غيرُه.';


-- ============================================================
-- ٣) شاشة المدير: كل الأشخاص ولوحاتهم
-- ============================================================
create or replace function public.dashboard_people()
returns table (
  user_id uuid, name text, email text, role text, role_name text,
  position_title text, status text, auto_views text[], override_views text[], mismatch boolean,
  position_role_name text
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'تخصيص اللوحات للمدير وحده';
  end if;
  return query
  select p.id,
         coalesce(e.full_name, bc.name, p.email),
         p.email,
         p.role,
         coalesce(r.name_ar, p.role),
         (x.j->>'position_title'),
         coalesce(e.status, case when p.role = 'broker' then 'active' end),
         array(select jsonb_array_elements_text(x.j->'auto')),
         a.views,
         coalesce((x.j->>'mismatch')::boolean, false),
         (x.j->>'position_role_name')
    from public.profiles p
    left join lateral (select e2.full_name, e2.status from public.employees e2
                        where e2.user_id = p.id order by (e2.status = 'active') desc limit 1) e on true
    left join lateral (select b.name from public.broker_users bu
                         join public.broker_companies b on b.id = bu.company_id
                        where p.role = 'broker' and bu.user_id = p.id
                        order by bu.is_active desc limit 1) bc on true
    left join public.roles r on r.code = coalesce(p.role_code, p.role)
    left join public.dashboard_assignments a on a.user_id = p.id
    cross join lateral (select public.dashboard_views_for(p.id, true) j) x
   order by case p.role when 'admin' then 0 when 'broker' then 9 else 1 end,
            coalesce(e.status, 'active') <> 'active',
            coalesce(e.full_name, p.email);
end;
$fn$;

comment on function public.dashboard_people() is
  'للمدير: كل حساب ولوحاته التلقائية وتخصيصه وعدم تطابق منصبه مع دوره (184).';


-- ============================================================
-- ٤) تخصيص لوحات شخص — للمدير وحده. قائمة فارغة/null = رجوع للتلقائي
-- ============================================================
create or replace function public.set_dashboard_views(p_user uuid, p_views text[], p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_role text;
  v_clean text[];
begin
  if not public.is_admin() then
    raise exception 'تخصيص اللوحات للمدير وحده';
  end if;
  select role into v_role from public.profiles where id = p_user;
  if v_role is null then raise exception 'الحساب غير موجود'; end if;

  if p_views is null or cardinality(p_views) = 0 then
    delete from public.dashboard_assignments where user_id = p_user;
    return;
  end if;

  select coalesce(array_agg(u.v order by u.ord), '{}') into v_clean
    from (select v, min(o) ord from unnest(p_views) with ordinality t(v, o)
           where v = any (array['executive','team','sales','marketing','followup','rm','finance','hr','viewer','broker'])
           group by v) u;

  if cardinality(v_clean) = 0 then raise exception 'لا لوحة صالحة في الاختيار'; end if;
  -- الوسيط حساب خارجي: لوحته وحدها، ولا تُعطى لوحته لموظف
  if v_role = 'broker' and v_clean <> array['broker'] then
    raise exception 'الشركة الوسيطة لها لوحتها وحدها';
  end if;
  if v_role <> 'broker' and 'broker' = any (v_clean) then
    raise exception 'لوحة الوسيط لحسابات الشركات الوسيطة وحدها';
  end if;

  insert into public.dashboard_assignments (user_id, views, note, updated_at, updated_by)
  values (p_user, v_clean, nullif(btrim(coalesce(p_note, '')), ''), now(), auth.uid())
  on conflict (user_id) do update
    set views = excluded.views, note = excluded.note, updated_at = now(), updated_by = auth.uid();
end;
$fn$;

comment on function public.set_dashboard_views(uuid, text[], text) is
  'المدير يخصّص لوحات شخص (184). فارغة = رجوع للاختيار التلقائي من المنصب.';


revoke all on function public.dashboard_views_for(uuid, boolean)       from public, anon, authenticated;
revoke all on function public.my_dashboard_views()                    from public, anon;
revoke all on function public.dashboard_people()                      from public, anon;
revoke all on function public.set_dashboard_views(uuid, text[], text) from public, anon;
grant execute on function public.my_dashboard_views()                    to authenticated;
grant execute on function public.dashboard_people()                      to authenticated;
grant execute on function public.set_dashboard_views(uuid, text[], text) to authenticated;

notify pgrst, 'reload schema';
