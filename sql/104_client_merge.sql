-- ============================================================
-- تلال ERP — 104: دمج البطاقات المكرّرة بيد الموظف
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- الشخص الواحد صار بطاقتين (٥٦ رقماً مكرّراً على ١١٦ بطاقة يوم
-- كتابة هذا الملف). والتكرار لا يُرى إلا في لوحة «الجودة» للمدير،
-- والدمج (sql/077) للمدير وحده. والموظف الذي يُدخل عميلاً لا يعرف
-- أن الرقم نفسه مسجّل منذ شهر — فيُنشئ ثالثة.
--
-- وفي 077 عيبان يمنعان الاعتماد عليها أصلاً:
--
--   ١) قاعدة المتابعة (028) تعمل عند **تعديل** النشاط أيضاً. فنقل
--      نشاطٍ قديم بلا موعد متابعة إلى بطاقة مفتوحة يُسقط الدمج كلّه
--      (٢٦٧ نشاطاً اليوم بلا موعد). وإن كانت الباقية مغلقة، تمحو
--      القاعدة مواعيد الأنشطة المنقولة.
--   ٢) ينقل ستة جداول من ستة عشر مرتبطة بالعميل. الفواتير والمستندات
--      والوسوم والعمولات والتحويلات تبقى معلّقة ببطاقة مطويّة.
--      وأحداث الحجز في محرّك التقارير (096) تُبطَل مع طيّ البطاقة —
--      فيختفي بيعٌ حقيقي من التقارير.
--
-- ===== ما يضيفه =====
--
--   1) find_client_matches()      «هذا الشخص موجود» قبل الحفظ
--   2) client_match_candidates()  البطاقات المحتملة لبطاقة قائمة
--   3) client_merge_scope()       من يدمج: من يملك البطاقتين معاً
--   4) merge_clients(keep, merge, take[])  الموظف يختار حقلاً حقلاً
--   5) request_client_merge() / resolve_client_duplicate()
--   6) client_merges              سجلّ كل دمج بصورة البطاقتين قبله
--   7) رصد التكرار لحظة الكتابة (محفّز) لا بزرّ «افحص» وحده
--   8) client_merged_into()       الرابط القديم يقود إلى الباقية
--
-- ===== القواعد =====
--
--   • الدمج نقلٌ لا محو (077). البطاقة الأخرى تُطوى ولا تُحذف،
--     وصورتها الكاملة تُحفظ في client_merges.
--   • يدمج من يملك البطاقتين: الموظف بطاقاته، والمشرف بطاقات
--     فريقه، والمدير ومدير المتابعة الكل. ومن لا يملك إحداهما
--     «يطلب» الدمج فيظهر الطلب في لوحة الجودة.
--   • الوسيط لا يدمج. وبطاقةٌ مُسنَدة لوسيط لا تُطوى في غيرها.
--   • فرصتان مفتوحتان لشخص واحد على المشروع نفسه تصيران واحدة —
--     وإلا بقي الشخص ليدين في خطّ الأنابيب. الفرصة المحجوزة لا تُطوى.
--   • أثناء الدمج تُعلَّق آثار الصفّ الواحد (قاعدة المتابعة، إعادة
--     عدّ التواصل، مزامنة المرحلة) ثم تُحسب مرة واحدة في آخره.
--
-- يتطلب: 028، 071، 072، 077، 091، 096. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 0) «دمج» نوع نشاط نظامي — يُكتب في سجلّ الباقية ولا يُحسب تواصلاً
--    ⚠️ يقابله SYSTEM_ACTIVITY_TYPES في src/lib/types.ts
-- ------------------------------------------------------------
create or replace function public.is_system_activity(p_type text)
returns boolean language sql immutable as $$
  select p_type in ('تغيير مرحلة', 'تسليم', 'حجز', 'دمج');
$$;

-- ------------------------------------------------------------
-- 1) الأعمدة والجداول
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists merged_into uuid references public.clients(id) on delete set null;

comment on column public.clients.merged_into is
  'البطاقة التي طُويت فيها هذه (104). الرابط القديم يقود إليها.';

alter table public.client_duplicates
  add column if not exists requested_by      uuid references auth.users(id) on delete set null,
  add column if not exists requested_by_name text,
  add column if not exists requested_at      timestamptz,
  add column if not exists request_note      text;

create table if not exists public.client_merges (
  id             uuid primary key default gen_random_uuid(),
  kept_id        uuid not null references public.clients(id) on delete cascade,
  merged_id      uuid not null references public.clients(id) on delete cascade,
  kept_before    jsonb not null,
  merged_row     jsonb not null,
  taken_fields   text[] not null default '{}',
  moved          jsonb not null default '{}',
  merged_by      uuid references auth.users(id) on delete set null,
  merged_by_name text,
  merged_at      timestamptz not null default now()
);

create index if not exists client_merges_kept_idx   on public.client_merges (kept_id, merged_at desc);
create index if not exists client_merges_merged_idx on public.client_merges (merged_id);

comment on table public.client_merges is
  'كل دمج بصورة البطاقتين قبله. الفصل بعد الدمج يدوي، وهذا ما يُفصَل منه.';

alter table public.client_merges enable row level security;
drop policy if exists "read merges" on public.client_merges;
create policy "read merges" on public.client_merges
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or public.can_see_client(kept_id));
-- لا سياسة كتابة: الصفّ يُكتب من merge_clients() وحدها

-- مدير المتابعة يقرّر في أزواج التكرار كالمدير
drop policy if exists "manage duplicates" on public.client_duplicates;
create policy "manage duplicates" on public.client_duplicates
  for all to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager()))
  with check ((select public.is_admin()) or (select public.is_followup_manager()));

-- ------------------------------------------------------------
-- 2) من يدمج؟ من يملك البطاقة — لا من يراها فقط
--
-- الرؤية أوسع من الملكية: مدير المتابعة وأدوار القراءة ترى الكل،
-- ومنشئ البطاقة يراها ولو صارت لغيره. والدمج يسحب تاريخ البطاقة
-- الأخرى إلى الباقية، فلا يجوز لموظف أن يطوي بطاقة زميله في بطاقته.
-- ------------------------------------------------------------
create or replace function public.client_merge_scope(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id
       and c.deleted_at is null
       and (
         auth.uid() is null
         or public.is_admin()
         or public.is_followup_manager()
         or (not public.is_broker() and (
               (c.owner_id is not null
                and c.owner_id in (select s.id from public.my_scope_employees() s))
               or (c.owner_id is null and (
                     c.created_by = auth.uid()
                     or (c.sales_employee is not null
                         and public.name_key(c.sales_employee)
                             in (select k.name_key from public.my_scope_name_keys() k))))
             ))
       )
  );
$$;

comment on function public.client_merge_scope(uuid) is
  'هل للمستخدم أن يطوي هذه البطاقة أو يُبقيها في دمج؟ الملكية لا الرؤية.';

-- ------------------------------------------------------------
-- 3) «هذا الشخص موجود»
--
-- تُسأل قبل الحفظ بالرقم والاسم المكتوبين. ثلاث درجات كـ071:
--   مؤكّد  نفس الرقم
--   محتمل  رقمه هو الرقم البديل للآخر، أو العكس
--   مرشّح  تشابه اسم فوق العتبة
--
-- ⚠️ تطابق الرقم يُعرَض ولو كانت البطاقة لغيرك: الموظف كتب الرقم
--    بنفسه، ومعرفة أن صاحبه عميلٌ لزميله هي ما يمنع البطاقة الثالثة.
--    لكن رقم البطاقة لا يُعرَض إن لم تكن تراها.
-- ⚠️ تشابه الاسم وحده لا يكشف بطاقةً لا تراها — وإلا صار البحث
--    بالأسماء بوابةً على عملاء الآخرين.
-- ⚠️ الوسيط يعرف أن الرقم مسجّل ولا يعرف عند من ولا باسم من.
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
  sim      numeric := public.crm_setting_num('duplicate_name_prompt_similarity', 0.6);
  broker   boolean := public.is_broker();
  sees_all boolean := auth.uid() is null or public.is_admin() or public.is_followup_manager();
begin
  if k1 is null and k2 is null and nm is null then
    return;
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
    select c.id, 'مرشّح', 'اسم', round(public.similarity(c.name, nm)::numeric, 2), 3
      from public.clients c
     where nm is not null and c.deleted_at is null
       and public.similarity(c.name, nm) >= sim
  ),
  best as (
    select distinct on (h.cid) h.* from hits h order by h.cid, h.rk
  )
  select c.id,
         case when v.can_view or not broker then c.name else 'عميل مسجّل مسبقاً' end,
         case when v.can_view then c.phone end,
         c.stage,
         case when v.can_view or not broker then coalesce(e.full_name, c.sales_employee) end,
         c.created_at,
         b.mt, b.mo, b.s,
         v.can_view,
         public.client_merge_scope(c.id)
    from best b
    join public.clients c on c.id = b.cid
    left join public.employees e on e.id = c.owner_id
    cross join lateral (select sees_all or public.can_see_client(c.id) as can_view) v
   where (p_exclude is null or c.id <> p_exclude)
     and (b.rk < 3 or v.can_view)
     and (p_exclude is null or not exists (
           select 1 from public.client_duplicates d
            where d.client_a = least(p_exclude, c.id)
              and d.client_b = greatest(p_exclude, c.id)
              and d.status = 'ليسا واحداً'))
   order by b.rk, b.s desc, c.created_at
   limit 10;
end $$;

comment on function public.find_client_matches(text, text, text, uuid) is
  'بطاقات قد تكون للشخص نفسه، قبل الحفظ. الرقم يكشف ولو لم تكن البطاقة لك؛ الاسم لا يكشف إلا ما تراه.';

-- البطاقات المحتملة لبطاقة قائمة — شريط التنبيه في صفحة العميل
create or replace function public.client_match_candidates(p_client_id uuid)
returns table (
  id uuid, name text, phone text, stage text, owner_name text, created_at timestamptz,
  match_type text, match_on text, similarity numeric, can_view boolean, can_merge boolean
)
language plpgsql stable security definer set search_path = public as $$
declare c public.clients%rowtype;
begin
  select * into c from public.clients x where x.id = p_client_id and x.deleted_at is null;
  if c.id is null then return; end if;
  if not (auth.uid() is null or public.is_admin() or public.is_followup_manager()
          or public.can_see_client(p_client_id) or public.client_merge_scope(p_client_id)) then
    return;
  end if;
  return query select * from public.find_client_matches(c.phone, c.alt_contact_phone, c.name, c.id);
end $$;

-- ------------------------------------------------------------
-- 4) تعليق آثار الصفّ الواحد أثناء الدمج
--
-- merge_clients() تضبط tilal.merging محلياً في معاملتها، وهذه
-- المحفّزات تتنحّى ما دام مضبوطاً — ثم تُحسب آثارها مرة واحدة في
-- آخر الدمج. ⚠️ المتغيّر لا يُضبط من الواجهة: PostgREST لا يعرض
-- set_config، وكل طلب معاملةٌ مستقلة.
--
-- كل دالة أدناه منسوخة من نسختها الحيّة حرفياً، والإضافة سطر
-- التنحّي وحده.
-- ------------------------------------------------------------

-- قاعدة المتابعة (028): النقل ليس تسجيلاً جديداً
create or replace function public.enforce_activity_followup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  client_stage text;
begin
  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;

  if public.is_system_activity(new.activity_type) then
    return new;
  end if;

  select stage into client_stage
    from public.clients
   where id = new.client_id;

  if not public.is_open_stage(client_stage) then
    new.next_action := null;
    new.next_action_date := null;
    return new;
  end if;

  if new.next_action_date is null then
    raise exception
      'حدّد موعد المتابعة القادم — إلزامي ما دام ملف العميل مفتوحاً.';
  end if;

  return new;
end;
$$;

-- عدّاد التواصل وموعد المتابعة: يُعاد حسابهما مرة في آخر الدمج
create or replace function public.after_activity_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('tilal.merging', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_client_contact(old.client_id);
    return old;
  end if;

  perform public.refresh_client_contact(new.client_id);

  if new.next_action_date is not null then
    update public.clients
       set follow_up_date = new.next_action_date
     where id = new.client_id;
  end if;

  return new;
end; $$;

-- «الخطوة القادمة» على الفرصة: نشاطٌ قديم يُنقل لا يكتب فوقها
create or replace function public.refresh_opportunity_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('tilal.merging', true) = 'on' then
    return null;
  end if;

  if new.opportunity_id is null then return null; end if;

  update public.opportunities
     set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at),
                                     new.occurred_at),
         next_action      = coalesce(new.next_action, next_action),
         next_action_date = coalesce(new.next_action_date, next_action_date)
   where id = new.opportunity_id
     and closed_at is null;

  return null;
end; $$;

-- نقل الملكية: الدمج قرّر صلاحيته بنفسه (client_merge_scope)
create or replace function public.guard_client_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;

  if auth.uid() is null
     or public.is_admin()
     or public.is_followup_manager()
     or (public.is_supervisor()
         and (old.owner_id is null or old.owner_id in (select s.id from public.my_scope_employees() s))
         and (new.owner_id is null or new.owner_id in (select s.id from public.my_scope_employees() s)))
  then
    return new;
  end if;

  raise exception 'نقل ملكية العميل من صلاحية الإدارة والمشرف ومدير المتابعة.';
end; $$;

-- مرآة المرحلة على الفرصة: الدمج يزامنها بنفسه في آخره
create or replace function public.mirror_client_stage_to_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n_opp   int;
  the_opp uuid;
  g_id    uuid;
begin
  if new.stage is not distinct from old.stage then
    return null;
  end if;

  if current_setting('tilal.merging', true) = 'on' then
    return null;
  end if;

  select count(*), (array_agg(o.id order by o.created_at))[1] into n_opp, the_opp
    from public.opportunities o
   where o.client_id = new.id and o.deleted_at is null;

  if n_opp <> 1 then
    return null;
  end if;

  select id into g_id from public.crm_stages where name = new.stage;
  if g_id is null then
    return null;
  end if;

  update public.opportunities
     set stage_id = g_id
   where id = the_opp
     and stage_id is distinct from g_id
     and not exists (
       select 1 from public.crm_stages s
        where s.id = g_id and 'lost_reason_id' = any(s.required_fields)
     );

  return null;
end; $$;

-- ------------------------------------------------------------
-- 5) الدمج
--
-- p_take: الحقول التي تُؤخذ قيمتها من البطاقة المطويّة وإن كانت
-- في الباقية قيمة. وما لم يُذكر: قيمة الباقية، وإن كانت فارغة
-- فقيمة المطويّة. فالموظف يختار عند التعارض فقط، والفراغ يُملأ
-- بلا سؤال.
--
-- الحقول المسموحة (مجموعاتٌ تُؤخذ معاً):
--   name · phone · alt_contact (الاسم والرقم والصفة) · governorate ·
--   area · purchase_purpose · source · payment_method · stage ·
--   owner (المالك واسم الموظف) · budget (الأدنى والأعلى) ·
--   purchase_timeline · is_decision_maker · financing_required ·
--   urgency · preferred_project_id · preferred_area · preferred_unit_type
--
-- وحقولٌ لا تُسأل: تاريخ الدخول والتأهيل والفوز وأول لمسة = الأقدم؛
-- الحملة والوسيط = الباقية ثم المطويّة؛ الملاحظات = الاثنتان معاً
-- مع رقم البطاقة المطويّة إن اختلف؛ العدّادات = تُعاد من الأنشطة.
-- ------------------------------------------------------------
drop function if exists public.merge_clients(uuid, uuid);

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

  if not (public.client_merge_scope(p_keep_id) and public.client_merge_scope(p_merge_id)) then
    raise exception 'لا تملك البطاقتين معاً — اطلب الدمج من الإدارة أو مدير المتابعة.';
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
  'يطوي بطاقة في أخرى: ينقل كل تابع، ويأخذ من المطويّة ما في p_take، ويملأ الفراغ. لمن يملك البطاقتين.';

-- ------------------------------------------------------------
-- 6) الطلب والقرار
-- ------------------------------------------------------------

-- «هذا عميلٌ لزميلي — ادمجوه»: يظهر في لوحة الجودة باسم طالبه
create or replace function public.request_client_merge(p_a uuid, p_b uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  ca public.clients%rowtype;
  cb public.clients%rowtype;
  mt text; mo text;
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

  if ca.phone_key is not null and ca.phone_key = cb.phone_key then
    mt := 'مؤكّد'; mo := 'هاتف';
  elsif (ca.phone_key is not null and ca.phone_key = cb.alt_phone_key)
     or (cb.phone_key is not null and cb.phone_key = ca.alt_phone_key) then
    mt := 'محتمل'; mo := 'هاتف بديل';
  else
    mt := 'مرشّح'; mo := 'طلب موظف';
  end if;

  insert into public.client_duplicates
    (client_a, client_b, match_type, match_on, similarity, status,
     requested_by, requested_by_name, requested_at, request_note)
  values
    (least(p_a, p_b), greatest(p_a, p_b), mt, mo,
     case when mt = 'مرشّح' then round(public.similarity(ca.name, cb.name)::numeric, 2) end,
     'جديد', auth.uid(),
     coalesce(public.my_employee_name(), public.display_name(auth.uid())),
     now(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (client_a, client_b) do update
    set status            = 'جديد',
        resolved_at       = null, resolved_by = null, resolved_by_name = null,
        requested_by      = excluded.requested_by,
        requested_by_name = excluded.requested_by_name,
        requested_at      = excluded.requested_at,
        request_note      = excluded.request_note
  where public.client_duplicates.status <> 'مدموج';
end $$;

-- «ليسا واحداً» / «تجاهل»: يقرّره من يملك البطاقتين، أو الإدارة
create or replace function public.resolve_client_duplicate(p_a uuid, p_b uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare ca public.clients%rowtype; cb public.clients%rowtype;
begin
  if p_status not in ('ليسا واحداً', 'مُتجاهَل', 'جديد') then
    raise exception 'قرار غير معروف: %', p_status;
  end if;
  if not ((public.client_merge_scope(p_a) and public.client_merge_scope(p_b))
          or public.is_admin() or public.is_followup_manager()) then
    raise exception 'القرار لمن يملك البطاقتين، أو للإدارة.';
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

-- الرابط القديم للبطاقة المطويّة يقود إلى الباقية — لمن يرى الباقية
create or replace function public.client_merged_into(p_client_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare target uuid; hops int := 0;
begin
  select merged_into into target from public.clients where id = p_client_id;
  -- سلسلة دمج (أ في ب ثم ب في ج) تنتهي عند الحيّة
  while target is not null and hops < 10 loop
    exit when exists (select 1 from public.clients where id = target and deleted_at is null);
    select merged_into into target from public.clients where id = target;
    hops := hops + 1;
  end loop;
  if target is null then return null; end if;
  if not (public.is_admin() or public.is_followup_manager() or public.can_see_client(target)
          or public.can_read_all_crm()) then
    return null;
  end if;
  return target;
end $$;

-- ------------------------------------------------------------
-- 7) الرصد لحظة الكتابة
--
-- زرّ «افحص التكرار» (071) يبقى للأسماء، والرقم يُرصد عند الحفظ:
-- البطاقة المكرّرة تدخل طابور الجودة فوراً — ولو اختار الموظف
-- «أنشئ على أي حال».
-- ------------------------------------------------------------
create or replace function public.detect_client_duplicates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.phone_key is not distinct from old.phone_key
     and new.alt_phone_key is not distinct from old.alt_phone_key then
    return null;
  end if;

  begin
    insert into public.client_duplicates (client_a, client_b, match_type, match_on, similarity)
    select least(new.id, c.id), greatest(new.id, c.id),
           case when c.phone_key = new.phone_key then 'مؤكّد' else 'محتمل' end,
           case when c.phone_key = new.phone_key then 'هاتف' else 'هاتف بديل' end,
           case when c.phone_key = new.phone_key then 1.0 else 0.8 end
      from public.clients c
     where c.id <> new.id and c.deleted_at is null
       and ((new.phone_key is not null and (c.phone_key = new.phone_key or c.alt_phone_key = new.phone_key))
            or (new.alt_phone_key is not null and c.phone_key = new.alt_phone_key))
    on conflict (client_a, client_b) do nothing;
  exception when others then
    -- الرصد لا يمنع حفظ عميل أبداً
    raise warning 'تعذّر رصد تكرار العميل %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_zz_detect_duplicates on public.clients;
create trigger trg_zz_detect_duplicates
  after insert or update of phone, alt_contact_phone on public.clients
  for each row execute function public.detect_client_duplicates();

-- ------------------------------------------------------------
-- 8) الصلاحيات
-- ------------------------------------------------------------
revoke all on function public.client_merge_scope(uuid)                       from public;
revoke all on function public.find_client_matches(text, text, text, uuid)    from public;
revoke all on function public.client_match_candidates(uuid)                  from public;
revoke all on function public.merge_clients(uuid, uuid, text[])              from public;
revoke all on function public.request_client_merge(uuid, uuid, text)         from public;
revoke all on function public.resolve_client_duplicate(uuid, uuid, text)     from public;
revoke all on function public.client_merged_into(uuid)                       from public;
revoke all on function public.detect_client_duplicates()                     from public;

grant execute on function public.client_merge_scope(uuid)                    to authenticated, service_role;
grant execute on function public.find_client_matches(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.client_match_candidates(uuid)               to authenticated, service_role;
grant execute on function public.merge_clients(uuid, uuid, text[])           to authenticated, service_role;
grant execute on function public.request_client_merge(uuid, uuid, text)      to authenticated, service_role;
grant execute on function public.resolve_client_duplicate(uuid, uuid, text)  to authenticated, service_role;
grant execute on function public.client_merged_into(uuid)                    to authenticated, service_role;

grant select on public.client_merges to authenticated;

-- ------------------------------------------------------------
-- 9) التحقّق
-- ------------------------------------------------------------
do $$
declare n_groups int; n_pairs int;
begin
  select count(*) into n_groups from (
    select phone_key from public.clients
     where deleted_at is null and phone_key is not null
     group by 1 having count(*) > 1) x;
  select count(*) into n_pairs from public.client_duplicates where status = 'جديد' and match_type = 'مؤكّد';
  raise notice '--- 104 دمج البطاقات ---';
  raise notice '  أرقام مكرّرة: % · أزواج مؤكّدة بانتظار القرار: %', n_groups, n_pairs;
end $$;

notify pgrst, 'reload schema';
