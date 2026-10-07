-- ============================================================
-- تلال ERP — 169: الدمج بالتطابق، والطلب لمشرف الفريق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- في 104 يدمج الموظف ما يملكه فقط. وبطاقة الزميل للشخص نفسه
-- (الرقم نفسه!) تحتاج طلباً ينتظر الإدارة ومدير المتابعة وحدهما.
-- فتتراكم الطلبات، ويبقى الشخص بطاقتين. وفي المقابل يطوي الموظف
-- بطاقتين من بطاقاته لا يجمعهما رقمٌ ولا اسم دون أن يراجعه أحد.
--
-- ===== القاعدة الجديدة (قرار المالك 2026-10-07) =====
--
--   • تطابقٌ = الرقم نفسه، أو رقم إحداهما هو البديل للأخرى، أو الاسم
--     نفسه حرفياً بعد التوحيد (المسافات والهمزات والتاء المربوطة
--     والياء والتشكيل) وفيه كلمتان على الأقل. «محمد» وحده ليس تطابقاً.
--   • مع التطابق: موظف المبيعات يدمج مباشرة، ولو كانت إحداهما عند
--     زميل.
--   • بلا تطابق: طلبٌ يصل إلى مشرف فريق كلٍّ من البطاقتين (إشعار
--     ولوحة «الجودة»)، والإدارة ومدير المتابعة يرونه كما الآن.
--     المشرف يدمج بطاقات فريقه، ويوافق على طلبٍ إحدى بطاقتيه في فريقه.
--   • «ليسا واحداً» قرار بشري: يُسقط الدمج المباشر بالتطابق ويُرجعه طلباً.
--   • العميل للأقدم: إن لم يملك الدامج البطاقتين، فالمالك بعد الدمج
--     هو مالك البطاقة الأقدم تسجيلاً، أيّاً كانت الباقية. لا يُكسب
--     عميل زميل بالدمج.
--   • المعلومات تبقى في الحسابين: من خسر الملكية بالدمج يبقى يرى
--     البطاقة وتاريخها (client_watchers) — قراءةً وتسجيل تواصل، لا
--     تعديل البطاقة. ويُشعَر أصحاب البطاقتين بالدمج.
--   • الإدارة ومدير المتابعة كما في 104: يدمجون أيّ زوج ويختارون المالك.
--
-- ===== ما يضيفه =====
--
--   1) person_name_key()        مفتاح الاسم للتطابق الحرفي
--   2) client_watchers          من يرى البطاقة وليس مالكها (بعد دمج)
--   3) can_see_client + سياسة قراءة clients تقرآن client_watchers
--   4) client_merge_mode(a, b)  direct | request | none — مصدر القرار الوحيد
--   5) find_client_matches      الاسم نفسه درجة «محتمل»، وcan_merge من الوضع
--   6) client_merge_peer()      بطاقة الزميل لشاشة المقارنة حين يحقّ الدمج
--   7) merge_clients            الصلاحية من الوضع، والمالك للأقدم، والرؤية المشتركة
--   8) request_client_merge     إشعار مشرفي الفريقين
--   9) resolve_client_duplicate لمن يحقّ له الدمج المباشر
--  10) المشرف يقرأ طلبات فريقه في client_duplicates
--
-- يتطلب: 104، 133. آمن لإعادة التشغيل.
-- ⚠️ merge_clients أدناه نسخة 104 الحيّة حرفياً، والتغيير في ثلاثة
--    مواضع معلَّمة بـ«169».
-- ============================================================

-- ------------------------------------------------------------
-- 1) مفتاح الاسم: «أحمد  علي» = «احمد علي»، «فاطمة» = «فاطمه»
-- ------------------------------------------------------------
create or replace function public.person_name_key(txt text)
returns text language sql immutable parallel safe as $$
  select nullif(btrim(regexp_replace(
           translate(regexp_replace(lower(coalesce(txt, '')),
                                    '[ً-ٰٟـ.,،؛:_()/"''-]', '', 'g'),
                     'أإآٱةىؤئیک', 'ااااهيوييك'),
           '\s+', ' ', 'g')), '');
$$;

comment on function public.person_name_key(text) is
  'الاسم بعد توحيد المسافات والهمزات والتاء المربوطة والياء والتشكيل — للتطابق الحرفي في الدمج (169).';

create index if not exists clients_person_name_key_idx
  on public.clients (public.person_name_key(name)) where deleted_at is null;

-- ------------------------------------------------------------
-- 2) الرؤية المشتركة بعد الدمج
-- ------------------------------------------------------------
create table if not exists public.client_watchers (
  client_id      uuid not null references public.clients(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  reason         text not null default 'دمج',
  from_client_id uuid references public.clients(id) on delete set null,
  added_by       uuid references auth.users(id) on delete set null,
  added_at       timestamptz not null default now(),
  primary key (client_id, employee_id)
);

create index if not exists client_watchers_employee_idx on public.client_watchers (employee_id);

comment on table public.client_watchers is
  'موظفٌ يرى البطاقة وليس مالكها: كان يملك بطاقةً طُويت فيها (169). قراءة وتسجيل تواصل، لا تعديل البطاقة.';

alter table public.client_watchers enable row level security;
drop policy if exists "read watchers" on public.client_watchers;
create policy "read watchers" on public.client_watchers
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or employee_id in (select s.id from public.my_scope_employees() s)
         or public.can_see_client(client_id));
-- لا سياسة كتابة: الصفّ يُكتب من merge_clients() وحدها

-- مالك البطاقة موظفاً: owner_id، وإلا الاسم القديم (٦٩٧ بطاقة بلا owner_id)
create or replace function public.client_owner_employee(p_owner uuid, p_sales text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(p_owner,
    (select e.id from public.employees e
      where p_sales is not null and public.name_key(e.full_name) = public.name_key(p_sales)
      order by (e.status = 'active') desc, e.created_at
      limit 1));
$$;

-- ------------------------------------------------------------
-- 3) بوّابة الرؤية تقرأ client_watchers
--    can_see_client: نسخة 133 حرفياً + سطر الرؤية المشتركة
-- ------------------------------------------------------------
create or replace function public.can_see_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not public.is_broker()
     and exists (
    select 1 from public.clients c
     where c.id = cid
       and c.deleted_at is null
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         -- أنا ومن أُشرف عليهم — بالمفتاح
         or (c.owner_id is not null
             and c.owner_id in (select s.id from public.my_scope_employees() s))
         -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
         -- كانت لي بطاقةٌ طُويت فيها (169)
         or exists (select 1 from public.client_watchers w
                     where w.client_id = c.id
                       and w.employee_id in (select s.id from public.my_scope_employees() s))
       )
  );
$function$;

comment on function public.can_see_client(uuid) is
  'بوّابة بيانات العميل الداخلية (حجوزات، فواتير، مدفوعات، مستندات، فرص...). الوسيط لا يمرّ منها أبداً — بابه can_see_broker_lead (sql/133). ومن طُويت بطاقته فيها يراها (169).';

-- سياسة قراءة البطاقات: نسخة 084/133 الحيّة + سطر الرؤية المشتركة
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    deleted_at is null and (
      (select public.is_admin())
      or (select public.is_followup_manager())
      or (select public.can_read_all_crm())
      or created_by = (select auth.uid())
      or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
      or (sales_employee is not null
          and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
      or (broker_company_id is not null and broker_company_id = (select public.my_broker_company()))
      or (broker_company_id is not null and broker_company_id in (select m.company_id from public.my_rm_companies() m))
      -- (169) غير مترابط عمداً: يُحسب مرة واحدة للاستعلام لا لكل صفّ
      or (not (select public.is_broker())
          and id in (select w.client_id from public.client_watchers w
                      where w.employee_id in (select s.id from public.my_scope_employees() s)))
    )
  );

-- ------------------------------------------------------------
-- 4) التطابق والوضع
-- ------------------------------------------------------------

-- على ماذا تتطابق البطاقتان؟ null = لا تطابق
create or replace function public.clients_match_on(p_a uuid, p_b uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.phone_key is not null and a.phone_key = b.phone_key then 'هاتف'
    when (a.phone_key is not null and a.phone_key = b.alt_phone_key)
      or (b.phone_key is not null and b.phone_key = a.alt_phone_key) then 'هاتف بديل'
    when public.person_name_key(a.name) is not null
     and public.person_name_key(a.name) = public.person_name_key(b.name)
     and position(' ' in public.person_name_key(a.name)) > 0 then 'الاسم نفسه'
  end
  from public.clients a, public.clients b
  where a.id = p_a and b.id = p_b;
$$;

-- هل أشرف على فريق؟ (المشرف = projects.supervisor_id، sql/037)
create or replace function public.i_supervise()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.my_supervised_projects());
$$;

-- مصدر القرار الوحيد: الواجهة تسأله لتعرض «ادمج» أو «اطلب»،
-- وmerge_clients تسأله قبل أن تنقل شيئاً.
--   direct   يدمج الآن
--   request  يطلب من مشرف الفريق
--   none     لا علاقة له بالبطاقتين (أو وسيط)
create or replace function public.client_merge_mode(p_a uuid, p_b uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  sa boolean;
  sb boolean;
  pair_status text;
  pair_requested boolean;
begin
  if p_a is null or p_b is null or p_a = p_b then return 'none'; end if;
  if not exists (select 1 from public.clients where id = p_a and deleted_at is null)
     or not exists (select 1 from public.clients where id = p_b and deleted_at is null) then
    return 'none';
  end if;
  if auth.uid() is null or public.is_admin() or public.is_followup_manager() then
    return 'direct';
  end if;
  if public.is_broker() then return 'none'; end if;

  sa := public.client_merge_scope(p_a);
  sb := public.client_merge_scope(p_b);
  if not (sa or sb) then
    return case when public.can_see_client(p_a) or public.can_see_client(p_b) then 'request' else 'none' end;
  end if;

  select d.status, d.requested_at is not null into pair_status, pair_requested
    from public.client_duplicates d
   where d.client_a = least(p_a, p_b) and d.client_b = greatest(p_a, p_b);

  -- المشرف: بطاقتا فريقه، أو طلبٌ قائم إحدى بطاقتيه في فريقه
  if public.i_supervise() then
    if sa and sb then return 'direct'; end if;
    if pair_status = 'جديد' and pair_requested then return 'direct'; end if;
  end if;

  if pair_status = 'ليسا واحداً' then return 'request'; end if;
  if public.clients_match_on(p_a, p_b) is not null then return 'direct'; end if;
  return 'request';
end $$;

comment on function public.client_merge_mode(uuid, uuid) is
  'direct: يدمج الآن (تطابق رقم/اسم، أو مشرف فريقه، أو إدارة). request: طلب لمشرف الفريق. none: لا علاقة (169).';

-- هل يُفرض «العميل للأقدم»؟ حين يدمج من لا يملك البطاقتين معاً
create or replace function public.client_merge_owner_locked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not (auth.uid() is null or public.is_admin() or public.is_followup_manager())
     and not (public.client_merge_scope(p_a) and public.client_merge_scope(p_b));
$$;

-- ------------------------------------------------------------
-- 5) «هذا الشخص موجود» — نسخة 104 + درجة «الاسم نفسه» + can_merge من الوضع
-- ------------------------------------------------------------
create or replace function public.find_client_matches(
  p_phone     text,
  p_alt_phone text default null,
  p_name      text default null,
  p_exclude   uuid default null
)
returns table (
  id          uuid,
  name        text,
  phone       text,
  stage       text,
  owner_name  text,
  created_at  timestamptz,
  match_type  text,
  match_on    text,
  similarity  numeric,
  can_view    boolean,
  can_merge   boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  k1       text := public.normalize_iraqi_phone(p_phone);
  k2       text := public.normalize_iraqi_phone(p_alt_phone);
  nm       text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  nk       text := public.person_name_key(p_name);
  sim      numeric := public.crm_setting_num('duplicate_name_prompt_similarity', 0.6);
  broker   boolean := public.is_broker();
  sees_all boolean := auth.uid() is null or public.is_admin() or public.is_followup_manager();
  superv   boolean := public.i_supervise();
begin
  if k1 is null and k2 is null and nm is null then
    return;
  end if;
  -- اسمٌ من كلمة واحدة لا يُطابَق حرفياً — يبقى للتشابه
  if nk is not null and position(' ' in nk) = 0 then
    nk := null;
  end if;

  return query
  with hits as (
    select c.id as cid, 'مؤكّد'::text as mt, 'هاتف'::text as mo, 1.0::numeric as s, 1 as rk
      from public.clients c
     where k1 is not null and c.phone_key = k1 and c.deleted_at is null
    union all
    select c.id, 'محتمل', 'هاتف بديل', 0.8, 2
      from public.clients c
     where c.deleted_at is null
       and ((k1 is not null and c.alt_phone_key = k1)
            or (k2 is not null and c.phone_key = k2))
    union all
    -- (169) الاسم نفسه حرفياً: تطابقٌ يُدمَج به مباشرة
    select c.id, 'محتمل', 'الاسم نفسه', 0.9, 2
      from public.clients c
     where nk is not null and c.deleted_at is null
       and public.person_name_key(c.name) = nk
    union all
    select c.id, 'مرشّح', 'اسم', round(public.similarity(c.name, nm)::numeric, 2), 3
      from public.clients c
     where nm is not null and c.deleted_at is null
       and public.similarity(c.name, nm) >= sim
  ),
  best as (
    select distinct on (h.cid) h.* from hits h order by h.cid, h.rk, (h.mo = 'الاسم نفسه')
  )
  select c.id,
         case when v.can_view or not broker then c.name else 'عميل مسجّل مسبقاً' end,
         case when v.can_view then c.phone end,
         c.stage,
         case when v.can_view or not broker then coalesce(e.full_name, c.sales_employee) end,
         c.created_at,
         b.mt, b.mo, b.s,
         v.can_view,
         case
           when p_exclude is not null then public.client_merge_mode(p_exclude, c.id) = 'direct'
           -- قبل الحفظ: البطاقة الجديدة ستكون لكاتبها، فالتطابق يكفي
           else sees_all or (not broker and (b.rk < 3 or (superv and public.client_merge_scope(c.id))))
         end
    from best b
    join public.clients c on c.id = b.cid
    left join public.employees e on e.id = c.owner_id
    cross join lateral (select sees_all or public.can_see_client(c.id) as can_view) v
   where (p_exclude is null or c.id <> p_exclude)
     -- الرقم يكشف لمن كتبه؛ الاسم الحرفي يكشف لغير الوسيط؛ التشابه لا يكشف إلا ما تراه
     and ((b.rk < 3 and not (broker and b.mo = 'الاسم نفسه')) or v.can_view)
     and (p_exclude is null or not exists (
           select 1 from public.client_duplicates d
            where d.client_a = least(p_exclude, c.id)
              and d.client_b = greatest(p_exclude, c.id)
              and d.status = 'ليسا واحداً'))
   order by b.rk, b.s desc, c.created_at
   limit 10;
end $$;

comment on function public.find_client_matches(text, text, text, uuid) is
  'بطاقات قد تكون للشخص نفسه. الرقم والاسم الحرفي يكشفان ولو لم تكن البطاقة لك؛ التشابه لا يكشف إلا ما تراه. can_merge = client_merge_mode (169).';

-- ------------------------------------------------------------
-- 6) بطاقة الطرف الآخر لشاشة المقارنة
--
-- بطاقة الزميل لا تمرّ من RLS. وحين يحقّ الدمج المباشر (تطابق أو
-- طلبٌ ينتظر المشرف) تُعرض كاملة: هي بعد لحظة بطاقة مشتركة.
-- ------------------------------------------------------------
create or replace function public.client_merge_peer(p_client_id uuid, p_other uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.clients%rowtype;
  v_mode text := public.client_merge_mode(p_client_id, p_other);
begin
  if v_mode <> 'direct' and not public.can_see_client(p_other) then
    return null;
  end if;
  select * into c from public.clients where id = p_other and deleted_at is null;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'client', to_jsonb(c),
    'owner_name', coalesce((select e.full_name from public.employees e where e.id = c.owner_id), c.sales_employee),
    'counts', jsonb_build_object(
      'activities',    (select count(*) from public.client_activities where client_id = c.id),
      'opportunities', (select count(*) from public.opportunities where client_id = c.id and deleted_at is null),
      'reservations',  (select count(*) from public.reservations where client_id = c.id),
      'tasks',         (select count(*) from public.tasks where client_id = c.id),
      'documents',     (select count(*) from public.client_documents where client_id = c.id)),
    'mode', v_mode,
    'owner_locked', public.client_merge_owner_locked(p_client_id, p_other),
    'match_on', public.clients_match_on(p_client_id, p_other));
end $$;

-- الوضع وحده — لشاشة المقارنة حين تكون البطاقتان ظاهرتين
create or replace function public.client_merge_context(p_a uuid, p_b uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mode', public.client_merge_mode(p_a, p_b),
    'owner_locked', public.client_merge_owner_locked(p_a, p_b),
    'match_on', public.clients_match_on(p_a, p_b));
$$;

-- ------------------------------------------------------------
-- 7) merge_clients — نسخة 104 الحيّة، والتغيير في المواضع «169»
-- ------------------------------------------------------------
create or replace function public.merge_clients(
  p_keep_id  uuid,
  p_merge_id uuid,
  p_take     text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  allowed constant text[] := array[
    'name', 'phone', 'alt_contact', 'governorate', 'area', 'purchase_purpose', 'source',
    'payment_method', 'stage', 'owner', 'budget', 'purchase_timeline', 'is_decision_maker',
    'financing_required', 'urgency', 'preferred_project_id', 'preferred_area',
    'preferred_unit_type'];
  take     text[] := coalesce(p_take, '{}');
  keep     public.clients%rowtype;
  gone     public.clients%rowtype;
  after_c  public.clients%rowtype;
  moved    jsonb := '{}'::jsonb;
  n        int;
  bad      text;
  actor    text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  surv     public.opportunities%rowtype;
  folded   uuid[] := '{}';
  other_ph text;
  g_id     uuid;
  note     text;
  warn     text;
  -- (169)
  v_mode   text;
  older    public.clients%rowtype;
  final_emp uuid;
  involved uuid[];
begin
  if p_keep_id is null or p_merge_id is null then
    raise exception 'حدّد البطاقتين.';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'لا تُدمَج البطاقة بنفسها.';
  end if;

  select f into bad from unnest(take) f where not (f = any(allowed)) limit 1;
  if bad is not null then
    raise exception 'حقل غير معروف في الدمج: %', bad;
  end if;

  -- القفل بترتيب ثابت: دمجان متزامنان على البطاقتين لا يتشابكان
  perform 1 from public.clients where id in (p_keep_id, p_merge_id) order by id for update;

  select * into keep from public.clients where id = p_keep_id;
  select * into gone from public.clients where id = p_merge_id;
  if keep.id is null or gone.id is null then
    raise exception 'إحدى البطاقتين غير موجودة.';
  end if;
  if keep.deleted_at is not null or gone.deleted_at is not null then
    raise exception 'إحدى البطاقتين محذوفة أو مدموجة سابقاً — حدّث الصفحة.';
  end if;

  -- (169) الصلاحية من الوضع: تطابقٌ أو مشرفٌ أو إدارة
  v_mode := public.client_merge_mode(p_keep_id, p_merge_id);
  if v_mode = 'request' then
    raise exception 'لا تتطابق البطاقتان بالرقم أو بالاسم — أرسل طلب دمج إلى مشرف الفريق.';
  elsif v_mode <> 'direct' then
    raise exception 'لا صلاحية لك على هاتين البطاقتين.';
  end if;

  -- (169) العميل للأقدم: من لا يملك البطاقتين لا يختار المالك. المالك
  -- مالك الأقدم تسجيلاً أيّاً كانت الباقية — إلا أن تكون الأقدم بلا مالك.
  if public.client_merge_owner_locked(p_keep_id, p_merge_id) then
    if (gone.created_at, gone.id) < (keep.created_at, keep.id) then
      older := gone;
    else
      older := keep;
    end if;
    take := array_remove(take, 'owner');
    if (older.id = gone.id and (older.owner_id is not null or older.sales_employee is not null))
       or (older.id = keep.id and older.owner_id is null and older.sales_employee is null) then
      take := array_append(take, 'owner');
    end if;
  end if;

  -- الوسيط يعمل على بطاقته؛ طيّها في غيرها يسحبها من تحت يده
  if gone.broker_company_id is not null
     and gone.broker_company_id is distinct from keep.broker_company_id then
    raise exception 'البطاقة التي ستُطوى مُسنَدة لشركة وساطة — اجعلها هي الباقية، أو اسحب الإسناد أولاً.';
  end if;

  perform set_config('tilal.merging', 'on', true);

  -- ===== (أ) الفرص: شخصٌ واحد = فرصة مفتوحة واحدة لكل مشروع =====
  --
  -- الباقية أكثر الفرص المفتوحة تقدّماً (ثم فرصة البطاقة الباقية، ثم
  -- الأقدم). وتُطوى فيها كل فرصة مفتوحة أخرى على المشروع نفسه أو بلا
  -- مشروع — ما لم يكن عليها حجز، فالحجز صفقةٌ قائمة لا تكرار.
  select o.* into surv
    from public.opportunities o
    join public.crm_stages g on g.id = o.stage_id
   where o.client_id in (p_keep_id, p_merge_id)
     and o.deleted_at is null and g.stage_type = 'open'
   order by g.sort_order desc, (o.client_id = p_keep_id) desc, o.created_at
   limit 1;

  if surv.id is not null then
    select coalesce(array_agg(o.id), '{}') into folded
      from public.opportunities o
      join public.crm_stages g on g.id = o.stage_id
     where o.client_id in (p_keep_id, p_merge_id)
       and o.id <> surv.id
       and o.deleted_at is null and g.stage_type = 'open'
       and (o.project_id is null or surv.project_id is null
            or o.project_id = surv.project_id)
       and not exists (select 1 from public.reservations r where r.opportunity_id = o.id);

    if cardinality(folded) > 0 then
      -- ما تعرفه المطويّة ولا تعرفه الباقية ينتقل إليها
      update public.opportunities s
         set project_id     = coalesce(s.project_id, x.project_id),
             unit_id        = coalesce(s.unit_id, x.unit_id),
             expected_value = coalesce(s.expected_value, x.expected_value),
             budget_min     = coalesce(s.budget_min, x.budget_min),
             budget_max     = coalesce(s.budget_max, x.budget_max),
             payment_method = coalesce(s.payment_method, x.payment_method),
             next_action      = coalesce(s.next_action, x.next_action),
             next_action_date = coalesce(s.next_action_date, x.next_action_date),
             last_activity_at = greatest(s.last_activity_at, x.last_activity_at)
        from (select (array_agg(o.project_id) filter (where o.project_id is not null))[1] project_id,
                     (array_agg(o.unit_id) filter (where o.unit_id is not null))[1] unit_id,
                     max(o.expected_value) expected_value,
                     min(o.budget_min) budget_min, max(o.budget_max) budget_max,
                     (array_agg(o.payment_method) filter (where o.payment_method is not null))[1] payment_method,
                     (array_agg(o.next_action order by o.next_action_date) filter (where o.next_action_date is not null))[1] next_action,
                     min(o.next_action_date) next_action_date,
                     max(o.last_activity_at) last_activity_at
                from public.opportunities o where o.id = any(folded)) x
       where s.id = surv.id;

      -- كل ما عُلِّق بالمطويّة يُعلَّق بالباقية
      update public.client_activities set opportunity_id = surv.id where opportunity_id = any(folded);
      update public.tasks             set opportunity_id = surv.id where opportunity_id = any(folded);
      update public.client_documents  set opportunity_id = surv.id where opportunity_id = any(folded);
      update public.client_interests  set opportunity_id = surv.id where opportunity_id = any(folded);
      -- أحداث التواصل والمهام تبقى محسوبة — على الفرصة الباقية
      update public.crm_event_facts
         set opportunity_id = surv.id, updated_at = now()
       where opportunity_id = any(folded)
         and source_table in ('client_activities', 'tasks');

      -- الطيّ: فتحُ الفرصة المكرّرة وتقدّمها يُبطَلان في التقارير (096)
      update public.opportunities
         set deleted_at = now(), deleted_by = auth.uid(),
             notes = concat_ws(E'\n', nullif(notes, ''),
                               'طُويت في فرصة ' || surv.id::text || ' عند دمج البطاقتين.')
       where id = any(folded);

      moved := moved || jsonb_build_object('فرص مكرّرة طُويت', cardinality(folded));
    end if;
  end if;

  -- ===== (ب) نقل كل ما للبطاقة المطويّة =====
  update public.client_activities set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('أنشطة', n); end if;

  update public.opportunities set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('فرص', n); end if;

  update public.client_interests set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('اهتمامات', n); end if;

  update public.reservations set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('حجوزات', n); end if;

  update public.invoices set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('فواتير', n); end if;

  update public.sale_commissions set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('عمولات بيع', n); end if;

  update public.broker_commissions set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('عمولات وسطاء', n); end if;

  update public.tasks set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('مهام', n); end if;

  update public.client_documents set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('مستندات', n); end if;

  insert into public.client_tags (client_id, tag_id, added_at, added_by, added_by_name)
  select p_keep_id, t.tag_id, t.added_at, t.added_by, t.added_by_name
    from public.client_tags t where t.client_id = p_merge_id
  on conflict (client_id, tag_id) do nothing;
  get diagnostics n = row_count; if n > 0 then moved := moved || jsonb_build_object('وسوم', n); end if;
  delete from public.client_tags where client_id = p_merge_id;

  update public.client_assignments set client_id = p_keep_id where client_id = p_merge_id;
  update public.lead_transfers     set client_id = p_keep_id where client_id = p_merge_id;
  update public.crm_lead_intake    set client_id = p_keep_id where client_id = p_merge_id;
  update public.crm_lead_score_history set client_id = p_keep_id where client_id = p_merge_id;
  delete from public.crm_lead_scores where client_id = p_merge_id;

  -- تجاوزات SLA: المفتوح على المطويّة وله نظيرٌ مفتوح على الباقية يُغلق،
  -- والباقي ينتقل (قيد «تجاوز مفتوح واحد لكل قاعدة وكيان»)
  update public.crm_sla_breaches b
     set resolved_at = now(), resolved_by = auth.uid(), resolution = 'دُمجت البطاقة'
   where b.entity_type = 'client' and b.entity_id = p_merge_id and b.resolved_at is null
     and exists (select 1 from public.crm_sla_breaches k
                  where k.entity_type = 'client' and k.entity_id = p_keep_id
                    and k.rule_code = b.rule_code and k.resolved_at is null);
  update public.crm_sla_breaches
     set entity_id = p_keep_id
   where entity_type = 'client' and entity_id = p_merge_id;
  update public.crm_sla_breaches set client_id = p_keep_id where client_id = p_merge_id;

  -- أحداث التقارير (096): كل حدثٍ وقع للشخص يبقى له. محفّز الحجوزات
  -- لا يتبع client_id، وطيّ البطاقة يُبطل كل ما بقي عليها — فبلا هذا
  -- يختفي بيعٌ حقيقي من التقارير. ما يبقى على المطويّة: «ليد جديد»
  -- و«تأهيل» — يُبطَلان عمداً، فالشخص ليدٌ واحد لا اثنان.
  update public.crm_event_facts
     set client_id = p_keep_id, updated_at = now()
   where client_id = p_merge_id and source_table <> 'clients';

  -- ===== (ج) البطاقة الباقية: اختيار الموظف، والفراغ يُملأ =====
  other_ph := case when 'phone' = any(take) then keep.phone else gone.phone end;
  note := '— من البطاقة المدموجة «' || gone.name || '»'
          || case when other_ph is not null
                   and public.normalize_iraqi_phone(other_ph)
                       is distinct from public.normalize_iraqi_phone(
                         case when 'phone' = any(take) then gone.phone else keep.phone end)
                  then ' · رقمٌ آخر للعميل: ' || other_ph else '' end
          || ' —';

  update public.clients c
     set name                 = case when 'name' = any(take) then gone.name else c.name end,
         phone                = case when 'phone' = any(take) then gone.phone else coalesce(c.phone, gone.phone) end,
         alt_contact_name     = case when 'alt_contact' = any(take) then gone.alt_contact_name
                                     when c.alt_contact_name is null and c.alt_contact_phone is null then gone.alt_contact_name
                                     else c.alt_contact_name end,
         alt_contact_phone    = case when 'alt_contact' = any(take) then gone.alt_contact_phone
                                     when c.alt_contact_name is null and c.alt_contact_phone is null then gone.alt_contact_phone
                                     else c.alt_contact_phone end,
         alt_contact_relation = case when 'alt_contact' = any(take) then gone.alt_contact_relation
                                     when c.alt_contact_name is null and c.alt_contact_phone is null then gone.alt_contact_relation
                                     else c.alt_contact_relation end,
         governorate          = case when 'governorate' = any(take) then gone.governorate else coalesce(c.governorate, gone.governorate) end,
         area                 = case when 'area' = any(take) then gone.area else coalesce(c.area, gone.area) end,
         purchase_purpose     = case when 'purchase_purpose' = any(take) then gone.purchase_purpose else coalesce(c.purchase_purpose, gone.purchase_purpose) end,
         source               = case when 'source' = any(take) then gone.source else coalesce(c.source, gone.source) end,
         payment_method       = case when 'payment_method' = any(take) then gone.payment_method else coalesce(c.payment_method, gone.payment_method) end,
         stage                = case when 'stage' = any(take) then gone.stage else coalesce(c.stage, gone.stage) end,
         owner_id             = case when 'owner' = any(take) then gone.owner_id else coalesce(c.owner_id, gone.owner_id) end,
         sales_employee       = case when 'owner' = any(take) then gone.sales_employee
                                     when c.owner_id is null and c.sales_employee is null then gone.sales_employee
                                     else c.sales_employee end,
         budget_min           = case when 'budget' = any(take) then gone.budget_min
                                     when c.budget_min is null and c.budget_max is null then gone.budget_min
                                     else c.budget_min end,
         budget_max           = case when 'budget' = any(take) then gone.budget_max
                                     when c.budget_min is null and c.budget_max is null then gone.budget_max
                                     else c.budget_max end,
         purchase_timeline    = case when 'purchase_timeline' = any(take) then gone.purchase_timeline else coalesce(c.purchase_timeline, gone.purchase_timeline) end,
         is_decision_maker    = case when 'is_decision_maker' = any(take) then gone.is_decision_maker else coalesce(c.is_decision_maker, gone.is_decision_maker) end,
         financing_required   = case when 'financing_required' = any(take) then gone.financing_required else coalesce(c.financing_required, gone.financing_required) end,
         urgency              = case when 'urgency' = any(take) then gone.urgency else coalesce(c.urgency, gone.urgency) end,
         preferred_project_id = case when 'preferred_project_id' = any(take) then gone.preferred_project_id else coalesce(c.preferred_project_id, gone.preferred_project_id) end,
         preferred_area       = case when 'preferred_area' = any(take) then gone.preferred_area else coalesce(c.preferred_area, gone.preferred_area) end,
         preferred_unit_type  = case when 'preferred_unit_type' = any(take) then gone.preferred_unit_type else coalesce(c.preferred_unit_type, gone.preferred_unit_type) end,
         -- ما لا يُسأل عنه
         entry_date           = least(c.entry_date, gone.entry_date),
         first_touch_at       = least(c.first_touch_at, gone.first_touch_at),
         qualified_at         = least(c.qualified_at, gone.qualified_at),
         won_at               = least(c.won_at, gone.won_at),
         campaign_id          = coalesce(c.campaign_id, gone.campaign_id),
         medium               = coalesce(c.medium, gone.medium),
         content              = coalesce(c.content, gone.content),
         notes                = concat_ws(E'\n\n', nullif(btrim(c.notes), ''),
                                          note || coalesce(E'\n' || nullif(btrim(gone.notes), ''), ''))
   where c.id = p_keep_id;

  -- ===== (د) طيّ المطويّة — يُبطل «ليدها» في التقارير =====
  update public.clients
     set deleted_at    = now(),
         deleted_by    = auth.uid(),
         delete_reason = 'دُمجت في «' || keep.name || '»',
         merged_into   = p_keep_id
   where id = p_merge_id;

  -- ===== (هـ) أزواج التكرار =====
  update public.client_duplicates
     set status = 'مدموج', resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = actor
   where client_a = least(p_keep_id, p_merge_id) and client_b = greatest(p_keep_id, p_merge_id);

  -- أزواج المطويّة مع غيرها تصير أزواج الباقية (قرار «ليسا واحداً» لا يضيع)
  insert into public.client_duplicates
    (client_a, client_b, match_type, match_on, similarity, status,
     resolved_by, resolved_by_name, resolved_at, detected_at,
     requested_by, requested_by_name, requested_at, request_note)
  select least(p_keep_id, o.other), greatest(p_keep_id, o.other),
         d.match_type, d.match_on, d.similarity, d.status,
         d.resolved_by, d.resolved_by_name, d.resolved_at, d.detected_at,
         d.requested_by, d.requested_by_name, d.requested_at, d.request_note
    from public.client_duplicates d
    cross join lateral (select case when d.client_a = p_merge_id then d.client_b else d.client_a end as other) o
   where (d.client_a = p_merge_id or d.client_b = p_merge_id)
     and o.other <> p_keep_id
  on conflict (client_a, client_b) do nothing;

  delete from public.client_duplicates
   where (client_a = p_merge_id or client_b = p_merge_id)
     and not (client_a = least(p_keep_id, p_merge_id) and client_b = greatest(p_keep_id, p_merge_id));

  perform set_config('tilal.merging', 'off', true);

  -- ===== (و) ما عُلِّق يُحسب مرة واحدة =====
  perform public.refresh_client_contact(p_keep_id);

  update public.clients c
     set follow_up_date = coalesce(
           (select a.next_action_date from public.client_activities a
             where a.client_id = p_keep_id and a.next_action_date is not null
             order by a.occurred_at desc nulls last, a.created_at desc limit 1),
           c.follow_up_date, gone.follow_up_date)
   where c.id = p_keep_id;

  -- مرحلة البطاقة ومرحلة فرصتها الوحيدة واحدة (083). والمزامنة محاولة:
  -- مرحلةٌ تشترط حقلاً ناقصاً على الفرصة لا تُسقط الدمج كلّه.
  select * into after_c from public.clients where id = p_keep_id;
  select g.id into g_id from public.crm_stages g where g.name = after_c.stage;
  if g_id is not null
     and (select count(*) from public.opportunities o
           where o.client_id = p_keep_id and o.deleted_at is null) = 1 then
    begin
      update public.opportunities
         set stage_id = g_id
       where client_id = p_keep_id and deleted_at is null
         and stage_id is distinct from g_id
         and not exists (select 1 from public.crm_stages s
                          where s.id = g_id and 'lost_reason_id' = any(s.required_fields));
    exception when others then
      warn := 'بقيت مرحلة الفرصة كما هي: ' || sqlerrm;
      moved := moved || jsonb_build_object('تنبيه', warn);
    end;
  end if;

  perform public.refresh_lead_scores(p_keep_id);

  -- ===== (169) المعلومات تبقى في الحسابين =====
  --
  -- من كان يملك إحدى البطاقتين أو أنشأ المطويّة ولم يعد مالكاً يبقى
  -- يرى الباقية. ومن كان يراها بدمجٍ سابق يتبعها إلى الباقية.
  final_emp := public.client_owner_employee(after_c.owner_id, after_c.sales_employee);

  insert into public.client_watchers (client_id, employee_id, reason, from_client_id, added_by, added_at)
  select p_keep_id, w.employee_id, w.reason, w.from_client_id, w.added_by, w.added_at
    from public.client_watchers w where w.client_id = p_merge_id
  on conflict (client_id, employee_id) do nothing;
  delete from public.client_watchers where client_id = p_merge_id;

  select coalesce(array_agg(distinct x.emp), '{}') into involved
    from (values (public.client_owner_employee(keep.owner_id, keep.sales_employee)),
                 (public.client_owner_employee(gone.owner_id, gone.sales_employee)),
                 ((select e.id from public.employees e where e.user_id = gone.created_by limit 1))) x(emp)
   where x.emp is not null;

  insert into public.client_watchers (client_id, employee_id, reason, from_client_id, added_by)
  select p_keep_id, x.emp, 'دمج', p_merge_id, auth.uid()
    from unnest(involved) x(emp)
   where x.emp is distinct from final_emp
  on conflict (client_id, employee_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('يراها أيضاً', n); end if;

  -- المالك لا يُسجَّل مشاهِداً لبطاقته
  delete from public.client_watchers where client_id = p_keep_id and employee_id = final_emp;

  -- أصحاب البطاقتين يعرفون بالدمج — إلا من دمج بنفسه
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select distinct e.user_id,
         'دُمجت بطاقة «' || gone.name || '»',
         actor || ' دمجها في «' || after_c.name || '». '
           || case when e.id = final_emp then 'العميل عندك.'
                   else 'العميل الآن عند ' || coalesce(
                          (select f.full_name from public.employees f where f.id = final_emp),
                          after_c.sales_employee, 'غيرك')
                        || '، وتبقى ترى البطاقة وتاريخها.' end,
         '/dashboard/clients/' || p_keep_id, 'عام', p_keep_id, 'client', 'CRM'
    from public.employees e
   where e.id = any(array_append(involved, final_emp))
     and e.user_id is not null
     and e.user_id is distinct from auth.uid();

  -- ===== (ز) الأثر: سطرٌ في سجلّ العميل، وصورة كاملة، وتدقيق =====
  insert into public.client_activities
    (client_id, created_by, activity_type, summary, actor_name)
  values
    (p_keep_id, auth.uid(), 'دمج',
     'دُمجت فيها بطاقة «' || gone.name || '»'
       || coalesce(' (' || gone.phone || ')', '')
       || coalesce(' — نُقل: ' || (select string_agg(k || ' ' || v, '، ')
                                    from jsonb_each_text(moved - 'تنبيه') e(k, v)), ''),
     actor);

  insert into public.client_merges
    (kept_id, merged_id, kept_before, merged_row, taken_fields, moved, merged_by, merged_by_name)
  values
    (p_keep_id, p_merge_id, to_jsonb(keep), to_jsonb(gone), take, moved, auth.uid(), actor);

  insert into public.audit_log
    (table_name, record_id, operation, old_data, new_data, actor, actor_name)
  values
    ('clients', p_keep_id, 'UPDATE',
     jsonb_build_object('merged_from', p_merge_id, 'merged_name', gone.name),
     moved || jsonb_build_object('taken', take), auth.uid(), actor);

  return moved || jsonb_build_object('kept_id', p_keep_id);
end $$;

comment on function public.merge_clients(uuid, uuid, text[]) is
  'يطوي بطاقة في أخرى: ينقل كل تابع، ويأخذ من المطويّة ما في p_take، ويملأ الفراغ. الصلاحية من client_merge_mode، والمالك للأقدم لمن لا يملك البطاقتين (169).';

-- ------------------------------------------------------------
-- 8) الطلب: يصل إلى مشرف فريق كلٍّ من البطاقتين
--    نسخة 104 + التطابق من clients_match_on + الإشعار
-- ------------------------------------------------------------
create or replace function public.request_client_merge(p_a uuid, p_b uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  ca public.clients%rowtype;
  cb public.clients%rowtype;
  mt text; mo text;
  who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()));
begin
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'حدّد بطاقتين مختلفتين.';
  end if;
  select * into ca from public.clients where id = p_a and deleted_at is null;
  select * into cb from public.clients where id = p_b and deleted_at is null;
  if ca.id is null or cb.id is null then
    raise exception 'إحدى البطاقتين غير موجودة.';
  end if;
  -- يكفي أن تكون إحداهما لك: الطلب يُنشأ غالباً من بطاقتك الجديدة
  if not (auth.uid() is null or public.is_admin() or public.is_followup_manager()
          or public.can_see_client(p_a) or public.can_see_client(p_b)
          or public.client_merge_scope(p_a) or public.client_merge_scope(p_b)) then
    raise exception 'لا ترى أيّاً من البطاقتين.';
  end if;

  mo := public.clients_match_on(p_a, p_b);
  mt := case mo when 'هاتف' then 'مؤكّد' when 'هاتف بديل' then 'محتمل' when 'الاسم نفسه' then 'محتمل' else 'مرشّح' end;
  mo := coalesce(mo, 'طلب موظف');

  insert into public.client_duplicates
    (client_a, client_b, match_type, match_on, similarity, status,
     requested_by, requested_by_name, requested_at, request_note)
  values
    (least(p_a, p_b), greatest(p_a, p_b), mt, mo,
     case when mt = 'مرشّح' then round(public.similarity(ca.name, cb.name)::numeric, 2) end,
     'جديد', auth.uid(), who, now(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (client_a, client_b) do update
    set status            = 'جديد',
        resolved_at       = null, resolved_by = null, resolved_by_name = null,
        requested_by      = excluded.requested_by,
        requested_by_name = excluded.requested_by_name,
        requested_at      = excluded.requested_at,
        request_note      = excluded.request_note
  where public.client_duplicates.status <> 'مدموج';

  -- (169) مشرف فريق كل بطاقة وفريق الطالب — والطالب لا يُشعَر بطلبه
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select distinct s.user_id,
         'طلب دمج بطاقتين',
         coalesce(who, 'موظف') || ' يطلب دمج «' || ca.name || '» و«' || cb.name || '»'
           || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '.'),
         '/dashboard/crm/data-quality#duplicates', 'عام', least(p_a, p_b), 'client_duplicate', 'CRM'
    from (values (public.client_owner_employee(ca.owner_id, ca.sales_employee)),
                 (public.client_owner_employee(cb.owner_id, cb.sales_employee)),
                 ((select e.id from public.employees e where e.user_id = auth.uid() limit 1))) x(emp)
    join public.employees m on m.id = x.emp
    join public.projects p on p.id = m.project_id
    join public.employees s on s.id = p.supervisor_id
   where s.user_id is not null
     and s.user_id is distinct from auth.uid();
end $$;

-- ------------------------------------------------------------
-- 9) «ليسا واحداً» / «تجاهل» — نسخة 104، والصلاحية تتّسع لمن
--    يحقّ له الدمج المباشر (client_merge_mode)
-- ------------------------------------------------------------
create or replace function public.resolve_client_duplicate(p_a uuid, p_b uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare ca public.clients%rowtype; cb public.clients%rowtype;
begin
  if p_status not in ('ليسا واحداً', 'مُتجاهَل', 'جديد') then
    raise exception 'قرار غير معروف: %', p_status;
  end if;
  if not ((public.client_merge_scope(p_a) and public.client_merge_scope(p_b))
          or public.client_merge_mode(p_a, p_b) = 'direct'
          or public.is_admin() or public.is_followup_manager()) then
    raise exception 'القرار لمن يحقّ له دمج البطاقتين: صاحباهما عند التطابق، أو المشرف، أو الإدارة.';
  end if;
  select * into ca from public.clients where id = p_a;
  select * into cb from public.clients where id = p_b;
  if ca.id is null or cb.id is null then
    raise exception 'إحدى البطاقتين غير موجودة.';
  end if;

  insert into public.client_duplicates
    (client_a, client_b, match_type, match_on, similarity, status,
     resolved_by, resolved_by_name, resolved_at)
  values
    (least(p_a, p_b), greatest(p_a, p_b),
     case when ca.phone_key = cb.phone_key then 'مؤكّد'
          when ca.phone_key = cb.alt_phone_key or cb.phone_key = ca.alt_phone_key then 'محتمل'
          else 'مرشّح' end,
     case when ca.phone_key = cb.phone_key then 'هاتف'
          when ca.phone_key = cb.alt_phone_key or cb.phone_key = ca.alt_phone_key then 'هاتف بديل'
          else 'اسم' end,
     round(public.similarity(ca.name, cb.name)::numeric, 2),
     p_status,
     case when p_status <> 'جديد' then auth.uid() end,
     case when p_status <> 'جديد' then coalesce(public.my_employee_name(), public.display_name(auth.uid())) end,
     case when p_status <> 'جديد' then now() end)
  on conflict (client_a, client_b) do update
    set status = excluded.status, resolved_by = excluded.resolved_by,
        resolved_by_name = excluded.resolved_by_name, resolved_at = excluded.resolved_at
  where public.client_duplicates.status <> 'مدموج';
end $$;

-- ------------------------------------------------------------
-- 10) المشرف يقرأ طلبات فريقه في لوحة «الجودة»
-- ------------------------------------------------------------
drop policy if exists "supervisor reads merge requests" on public.client_duplicates;
create policy "supervisor reads merge requests" on public.client_duplicates
  for select to authenticated
  using (requested_at is not null
         and (select public.i_supervise())
         and (public.client_merge_scope(client_a) or public.client_merge_scope(client_b)));

-- ------------------------------------------------------------
-- 11) الصلاحيات
-- ------------------------------------------------------------
revoke all on function public.person_name_key(text)                 from public;
revoke all on function public.client_owner_employee(uuid, text)     from public;
revoke all on function public.clients_match_on(uuid, uuid)          from public;
revoke all on function public.i_supervise()                         from public;
revoke all on function public.client_merge_mode(uuid, uuid)         from public;
revoke all on function public.client_merge_owner_locked(uuid, uuid) from public;
revoke all on function public.client_merge_peer(uuid, uuid)         from public;
revoke all on function public.client_merge_context(uuid, uuid)      from public;

grant execute on function public.person_name_key(text)                 to authenticated, service_role;
grant execute on function public.client_owner_employee(uuid, text)     to authenticated, service_role;
grant execute on function public.clients_match_on(uuid, uuid)          to authenticated, service_role;
grant execute on function public.i_supervise()                         to authenticated, service_role;
grant execute on function public.client_merge_mode(uuid, uuid)         to authenticated, service_role;
grant execute on function public.client_merge_owner_locked(uuid, uuid) to authenticated, service_role;
grant execute on function public.client_merge_peer(uuid, uuid)         to authenticated, service_role;
grant execute on function public.client_merge_context(uuid, uuid)      to authenticated, service_role;

grant select on public.client_watchers to authenticated;

-- ------------------------------------------------------------
-- 12) التحقّق
-- ------------------------------------------------------------
do $$
declare n_names int; n_req int;
begin
  select count(*) into n_names from (
    select public.person_name_key(name) k from public.clients
     where deleted_at is null and position(' ' in coalesce(public.person_name_key(name), '')) > 0
     group by 1 having count(*) > 1) x;
  select count(*) into n_req from public.client_duplicates where status = 'جديد' and requested_at is not null;
  raise notice '--- 169 الدمج بالتطابق ---';
  raise notice '  أسماء متطابقة حرفياً على أكثر من بطاقة: % · طلبات دمج قائمة: %', n_names, n_req;
end $$;

notify pgrst, 'reload schema';
