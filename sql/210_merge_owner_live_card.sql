-- ============================================================
-- تلال ERP — 210: في الدمج، البطاقة الحيّة قبل الأقدم
--
-- العَرَض (٢٠٢٦-١٠-١٤): «علي عرفي» (07816755815). بطاقتا تبارك من
--   ٢٠٢٦-٠٨-٠٨ في «فشل البيع» وكل فرصهما خاسرة. عاد العميل فسجّلته دانيه
--   ببطاقة جديدة (٠٩-٢٨) وتعمل عليه (مكالمة ١٠-١٢، رحلة مفتوحة). دمجت تبارك
--   بطاقتها القديمة في بطاقة دانيه، فطبّقت قاعدة 169 «العميل للأقدم»
--   ونقلت العميل — ورحلته المفتوحة (187) — من دانيه إلى تبارك.
--   وهذا عكس روح القاعدة نفسها: «لا يُكسب عميل زميل بالدمج».
--
-- القاعدة بعد 210 (حين لا يملك الدامج البطاقتين):
--   1) البطاقة التي بلا مالك لا تقرّر المالك (كما في 169).
--   2) بطاقة «ميتة» = ليس لها فرصة غير خاسرة، وهي في «فشل البيع» أو لها
--      فرصة خاسرة. إن كانت إحداهما ميتة والأخرى حيّة ⇒ المالك مالك الحيّة.
--   3) وإلا ⇒ مالك الأقدم تسجيلاً (169 كما هي).
--   من خسر الملكية يبقى يرى البطاقة (client_watchers) كما في 169،
--   والفرص الخاسرة تبقى لمن خسرها (187) — واستمارات تحليلها معه (177).
--
--   أ) client_merge_owner_card(a, b) — مصدر القرار الوحيد.
--   ب) merge_clients يقرأها بدل مقارنة التاريخ.
--   ج) client_merge_peer يعيدها (owner_card) لتعرض شاشة الدمج المالك الصحيح.
--   د) تصحيح «علي عرفي» (قرار المالك ٢٠٢٦-١٠-١٤: «أريد أن تختفي من عندها»):
--      يعود لدانيه، ولا تبقى تبارك مشاهِدةً، واستمارتا فشل البيع المفتوحتان
--      تنتقلان إلى دانيه — مالكة العميل، فتستطيع حفظهما (177: المهمة إذنٌ،
--      ورؤية العميل تكفي crm_can_edit_opportunity). الفرصتان الخاسرتان في
--      آب تبقيان باسم تبارك تاريخاً (187).
--
-- لا يمسّ صلاحية الدمج ولا ما يُنقل فيه. آمن لإعادة التشغيل.
-- ============================================================

-- (أ) أيّ البطاقتين يبقى مالكها مالكاً للعميل
create or replace function public.client_merge_owner_card(p_a uuid, p_b uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with c as (
    select x.id, x.created_at,
           (x.owner_id is not null or x.sales_employee is not null) as has_owner,
           not exists (select 1 from public.opportunities o
                         join public.crm_stages g on g.id = o.stage_id
                        where o.client_id = x.id and o.deleted_at is null
                          and g.stage_type is distinct from 'lost')
           and (x.stage = 'فشل البيع'
                or exists (select 1 from public.opportunities o
                             join public.crm_stages g on g.id = o.stage_id
                            where o.client_id = x.id and o.deleted_at is null
                              and g.stage_type = 'lost')) as dead
      from public.clients x
     where x.id in (p_a, p_b)
  )
  select id from c
   order by has_owner desc, dead asc, created_at asc, id asc
   limit 1;
$$;
comment on function public.client_merge_owner_card(uuid, uuid) is
  'الدمج بين زميلين: البطاقة التي يبقى مالكها مالكاً — ذات المالك، ثم الحيّة قبل الميتة (فشل/خاسرة فقط)، ثم الأقدم (210).';
revoke all on function public.client_merge_owner_card(uuid, uuid) from public, anon;
grant execute on function public.client_merge_owner_card(uuid, uuid) to authenticated;

do $p$
declare d text; d2 text;
begin
  -- (ب) merge_clients: القرار من client_merge_owner_card
  d := replace(pg_get_functiondef('public.merge_clients(uuid,uuid,text[])'::regprocedure), E'\r', '');
  if position('client_merge_owner_card' in d) = 0 then
    d2 := replace(d, 'if (gone.created_at, gone.id) < (keep.created_at, keep.id) then',
                     'if public.client_merge_owner_card(p_keep_id, p_merge_id) = gone.id then  -- 210: الحيّة قبل الأقدم');
    if d2 = d then raise exception '210: لم يُعثر على موضع الترقيع في merge_clients'; end if;
    execute d2;
  end if;

  -- (ج) client_merge_peer: شاشة الدمج تعرض المالك من القاعدة نفسها
  d := replace(pg_get_functiondef('public.client_merge_peer(uuid,uuid)'::regprocedure), E'\r', '');
  if position('owner_card' in d) = 0 then
    d2 := replace(d, '''owner_locked'', public.client_merge_owner_locked(p_client_id, p_other),',
                     '''owner_locked'', public.client_merge_owner_locked(p_client_id, p_other),
    ''owner_card'', public.client_merge_owner_card(p_client_id, p_other),');
    if d2 = d then raise exception '210: لم يُعثر على موضع الترقيع في client_merge_peer'; end if;
    execute d2;
  end if;
end $p$;

-- (د) تصحيح «علي عرفي»: يعود لدانيه (رحلته المفتوحة تتبعه — 187)،
--     ويختفي من عند تبارك: لا مشاهَدة، واستمارتاه المفتوحتان لدانيه
do $f$
declare
  v_client  uuid := '1e3023f9-e8c4-40ed-852c-87af9daf2997';
  v_dania   uuid := '96ba9cf8-ad72-429c-a9b2-b3cc967eb4e5';
  v_tabarak uuid := '29618964-7bb0-436b-a870-c220f53788d9';
  u_dania   uuid;
  u_tabarak uuid;
begin
  select user_id into u_dania   from public.employees where id = v_dania;
  select user_id into u_tabarak from public.employees where id = v_tabarak;

  if (select owner_id from public.clients where id = v_client and deleted_at is null) = v_tabarak then
    perform public.assign_client(v_client, v_dania,
      'تصحيح دمج (210): البطاقة القديمة «فشل البيع» لا تسحب عميلاً عاد عند زميلة', 'يدوي');
  end if;

  delete from public.client_watchers where client_id = v_client and employee_id in (v_dania, v_tabarak);

  if (select owner_id from public.clients where id = v_client) = v_dania then
    update public.tasks t
       set assigned_to = u_dania
     where t.client_id = v_client
       and t.assigned_to = u_tabarak
       and t.analysis_lost_sale_id is not null
       and t.status in ('جديدة', 'قيد التنفيذ');
  end if;
end $f$;

do $$
declare v jsonb;
begin
  select jsonb_build_object(
    'owner', (select e.full_name from public.clients c join public.employees e on e.id = c.owner_id
               where c.id = '1e3023f9-e8c4-40ed-852c-87af9daf2997'),
    'sales_employee', (select sales_employee from public.clients where id = '1e3023f9-e8c4-40ed-852c-87af9daf2997'),
    'open_journey_owner', (select e.full_name from public.opportunities o join public.employees e on e.id = o.owner_id
                            where o.id = 'c7cce277-3cba-4c2f-a8de-e9a8f975c22a'),
    'watchers', (select jsonb_agg(e.full_name) from public.client_watchers w join public.employees e on e.id = w.employee_id
                  where w.client_id = '1e3023f9-e8c4-40ed-852c-87af9daf2997'),
    'open_tasks', (select jsonb_agg(jsonb_build_object('title', t.title, 'to', e.full_name))
                     from public.tasks t left join public.employees e on e.user_id = t.assigned_to
                    where t.client_id = '1e3023f9-e8c4-40ed-852c-87af9daf2997' and t.status in ('جديدة', 'قيد التنفيذ')))
    into v;
  raise notice '210: %', v;
end $$;
