-- ============================================================
-- تلال ERP — 071: هوية العميل وملكيّته
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ أهمّ هجرة في الـCRM. تُصلح الجذر الذي تتفرّع منه بقية المشاكل.
--    اقرأ الرأس كاملاً قبل تشغيلها.
--
-- ============================================================
-- المشكلة (فُحصت لا خُمّنت)
--
-- ملكيّة العميل اليوم **نصّ مكتوب بخطّ اليد**: clients.sales_employee.
-- وعليه بُني كل شيء:
--
--     clients.sales_employee (نصّ)
--            ↓ name_key()
--     can_see_client() → RLS       ← من يرى العميل
--     buildTeam()      → التقارير   ← أداء الموظف
--     crm_followup_scan() → التنبيه ← من يُشعَر
--
-- ونتائج ذلك ثلاث، كلها ظاهرة في البيانات الآن:
--
--   1) اسمٌ لا يقابل حساباً = عميلٌ لا يراه إلا المدير ولا يظهر في
--      أداء أحد. حتى أن sql/032 أضاف دالة تشخيص لهذه الحالة بالذات
--      (unmatched_sales_employees) — اعترافٌ بالمشكلة لا حلٌّ لها.
--
--   2) **لا تاريخ للملكية**. تغيير النصّ يستبدل النصّ. من كان يملك
--      هذا الليد الشهر الماضي؟ لا جواب في القاعدة.
--
--   3) الإسناد الجماعي بلا حارس ولا أثر: ٦٢ عميلاً باسم موظفة واحدة،
--      كلهم صامتون منذ خمسين يوماً، كلهم في مرحلة «اتصال». النظام
--      يعرض ذلك اليوم كـ«ضعف أداء» وهو في الحقيقة **خلل توزيع**.
--
-- وفوق ذلك: رقم الهاتف يُخزَّن كما كُتب. 07701234567 و+9647701234567
-- شخصٌ واحد وصفّان، ولا شيء في القاعدة يعرف ذلك.
--
-- ============================================================
-- المبدأ الحاكم
--
--     المالك مفتاحٌ لا اسم، ولا يتغيّر بلا أثر.
--
-- ============================================================
-- عدم الكسر: القراءة والكتابة المزدوجة
--
-- `sales_employee` **لا يُحذف ولا يُفرَّغ**. يصير مرآةً يحدّثها محفّز
-- من owner_id، فتستمر كل شاشة وتقرير واستيراد وتصدير تعمل بلا تعديل
-- سطر واحد في الواجهة. وسياسات RLS تقبل الطريقين معاً:
--
--     owner_id = ملفّي   OR   name_key(sales_employee) = اسمي
--
-- فلا يفقد أحدٌ وصولاً كان له. حذف النصّ يأتي في هجرة منفصلة بعد
-- هجرة الشاشات كلها إلى owner_id.
--
-- ============================================================
-- ما يضيفه
--
--   1) normalize_iraqi_phone() + phone_key/alt_phone_key (عمودان محسوبان)
--   2) clients.owner_id → employees(id) مع ترحيل من الأسماء
--   3) محفّز مزامنة الاتجاهين بين owner_id و sales_employee
--   4) client_assignments — تاريخ الملكية، يُكتب تلقائياً
--   5) assign_client() — الإسناد المضبوط بالصلاحية والسبب
--   6) client_duplicates + scan_client_duplicates()
--   7) توسيع سياسات clients و can_see_client() لتقبل المفتاح
--   8) فهارس أنماط الاستعلام الفعلية
--
-- يتطلب: sql/012 (الموظفون) و sql/023 و sql/032 و sql/036 و sql/043 و sql/058 و sql/070.
-- الملف آمن لإعادة التشغيل.
-- ============================================================

create extension if not exists pg_trgm;   -- لتشابه الأسماء في كشف التكرار

-- ------------------------------------------------------------
-- 1) تطبيع الهاتف العراقي
--
-- ثلاث كتابات لرقم واحد:
--     07701234567        (محلي)
--     +9647701234567     (دولي)
--     009647701234567    (دولي بصيغة الاتصال)
-- والمفتاح الموحّد: 9647701234567
--
-- ⚠️ immutable عمداً — بلا ذلك لا يقبلها عمود محسوب (generated).
--    وهي كذلك فعلاً: معالجة نصّ خالصة بلا قراءة جدول ولا وقت.
--
-- ⚠️ ما لا ينطبق عليه الشكل العراقي يُرجِع NULL لا نصّاً مشوّهاً.
--    مفتاحٌ خاطئ يُلصق شخصين ببعضهما في كشف التكرار — وغيابُ
--    المفتاح أهون من دمج عميلين ليسا واحداً.
-- ------------------------------------------------------------
create or replace function public.normalize_iraqi_phone(p text)
returns text language sql immutable as $$
  with digits as (
    select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d
  ),
  stripped as (
    select case
             when d like '00964%' then substring(d from 6)   -- 00964… → …
             when d like '964%'   then substring(d from 4)   -- 964…   → …
             when d like '0%'     then substring(d from 2)   -- 07…    → 7…
             else d
           end as n
      from digits
  )
  select case
           when n ~ '^7[0-9]{9}$' then '964' || n            -- الشكل العراقي السليم
           else null
         end
    from stripped;
$$;

comment on function public.normalize_iraqi_phone(text) is
  'مفتاح الهاتف العراقي الموحّد (9647XXXXXXXXX). NULL لما لا يطابق الشكل — لا نخترع مفتاحاً.';

-- الأعمدة المحسوبة: لا تُكتب ولا تُنسى ولا تتناقض مع مصدرها
-- ⚠️ العمود المحسوب المخزَّن يُعاد حسابه في **كل** كتابة على الصفّ،
--    لا حين يتغيّر مصدره فقط. فالدالة تحتاج تنفيذاً لكل من يكتب
--    صفّ عميل — وغيابه عطّل كل كتابة حتى صُحِّح في 093.
grant execute on function public.normalize_iraqi_phone(text) to authenticated, service_role;

alter table public.clients
  add column if not exists phone_key text
    generated always as (public.normalize_iraqi_phone(phone)) stored;

alter table public.clients
  add column if not exists alt_phone_key text
    generated always as (public.normalize_iraqi_phone(alt_contact_phone)) stored;

comment on column public.clients.phone_key is
  'رقم مطبّع للمطابقة والبحث والتكرار. المصدر يبقى phone كما كتبه الموظف.';

-- ------------------------------------------------------------
-- 2) owner_id — المالك يصير مفتاحاً
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists owner_id uuid references public.employees(id) on delete set null;

alter table public.clients
  add column if not exists owner_assigned_at timestamptz;

comment on column public.clients.owner_id is
  'مالك الليد. مصدر الحقيقة. sales_employee مرآةٌ نصّية له للتوافق مع الشاشات القديمة.';

-- ===== الترحيل: الاسم → المفتاح =====
-- نُسنِد فقط حين يكون التطابق **واحداً لا لبس فيه**. اسمان لموظفَين
-- مختلفَين بنفس name_key يُتركان بلا إسناد ويظهران في تقرير آخر
-- الملف — تخمينُ المالك أسوأ من الاعتراف بالجهل به.
with matched as (
  select c.id as client_id,
         (select e.id
            from public.employees e
           where public.name_key(e.full_name) = public.name_key(c.sales_employee)
           limit 1) as emp_id,
         (select count(*)
            from public.employees e
           where public.name_key(e.full_name) = public.name_key(c.sales_employee)) as n
    from public.clients c
   where c.owner_id is null
     and c.sales_employee is not null
     and btrim(c.sales_employee) <> ''
)
update public.clients c
   set owner_id          = m.emp_id,
       owner_assigned_at = coalesce(c.owner_assigned_at, c.created_at)
  from matched m
 where c.id = m.client_id
   and m.n = 1
   and m.emp_id is not null;

-- ------------------------------------------------------------
-- 3) مزامنة الاتجاهين — جسر التوافق
--
-- الاتجاه الأول (الأساسي): owner_id تغيّر → نكتب اسمه في النصّ.
-- الاتجاه الثاني (التوافق): النصّ وحده تغيّر (شاشة قديمة، استيراد
--   Excel) → نحاول استنتاج المفتاح منه.
--
-- ⚠️ الأولوية للمفتاح دائماً. لو تغيّر الاثنان في نفس التحديث فالنصّ
--    يُعاد بناؤه من المفتاح — وإلا لأمكن لشاشة قديمة أن تسحب عميلاً
--    من مالكه بكتابة اسم آخر في خانة نصّية.
-- ------------------------------------------------------------
create or replace function public.sync_client_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  emp_id   uuid;
  n_match  int;
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    -- المفتاح هو المرجع: النصّ يتبعه
    if new.owner_id is not null then
      select full_name into emp_name from public.employees where id = new.owner_id;
      if emp_name is not null then
        new.sales_employee := emp_name;
      end if;
      new.owner_assigned_at := coalesce(new.owner_assigned_at, now());
    end if;

  elsif new.sales_employee is distinct from old.sales_employee then
    -- النصّ وحده تغيّر: نستنتج المفتاح إن كان التطابق واحداً
    if new.sales_employee is null or btrim(new.sales_employee) = '' then
      new.owner_id := null;
    else
      -- min(uuid) غير موجودة في Postgres — أول عنصر من array_agg
      select count(*), (array_agg(e.id order by e.id))[1] into n_match, emp_id
        from public.employees e
       where public.name_key(e.full_name) = public.name_key(new.sales_employee);
      if n_match = 1 then
        new.owner_id := emp_id;
        new.owner_assigned_at := now();
      end if;
      -- تطابق صفر أو أكثر من واحد: نترك المفتاح كما هو ونُبقي النصّ.
      -- تقرير جودة البيانات يلتقط الحالة؛ لا نُخمّن هنا.
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_client_owner_sync on public.clients;
create trigger trg_client_owner_sync
  before insert or update on public.clients
  for each row execute function public.sync_client_owner();

-- ------------------------------------------------------------
-- 4) client_assignments — تاريخ الملكية
--    لا يُكتب من الواجهة. محفّزٌ يكتبه، فلا يمكن تغيير مالك بلا أثر.
-- ------------------------------------------------------------
create table if not exists public.client_assignments (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  from_owner_id  uuid references public.employees(id) on delete set null,
  to_owner_id    uuid references public.employees(id) on delete set null,
  from_owner_name text,                  -- الاسم وقت النقل — يبقى لو حُذف الملفّ
  to_owner_name   text,
  reason         text,                   -- لماذا نُقل
  method         text not null default 'يدوي'
                 check (method in ('يدوي','ترحيل','توزيع تلقائي','إعادة توزيع','تسليم عهدة','استيراد')),
  assigned_by      uuid references auth.users(id) on delete set null,
  assigned_by_name text,
  at             timestamptz not null default now()
);

create index if not exists client_assignments_client_idx
  on public.client_assignments (client_id, at desc);
create index if not exists client_assignments_to_idx
  on public.client_assignments (to_owner_id, at desc);

comment on table public.client_assignments is
  'تاريخ ملكية الليد. يُكتب بمحفّز لا من الواجهة — لا نقل بلا أثر.';

create or replace function public.log_client_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  from_name text;
  to_name   text;
  actor     text;
begin
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return null;
  end if;
  if tg_op = 'INSERT' and new.owner_id is null then
    return null;   -- ليد دخل بلا مالك: لا شيء يُسجَّل حتى يُسنَد
  end if;

  select full_name into from_name from public.employees
   where id = case when tg_op = 'UPDATE' then old.owner_id else null end;
  select full_name into to_name   from public.employees where id = new.owner_id;

  -- اسم الفاعل وقت الفعل. auth.uid() فارغة حين يعمل الترحيل أو
  -- المهام المجدولة، فنكتب «النظام» بدل تركها بلا صاحب.
  actor := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');

  insert into public.client_assignments
    (client_id, from_owner_id, to_owner_id, from_owner_name, to_owner_name,
     method, assigned_by, assigned_by_name)
  values
    (new.id,
     case when tg_op = 'UPDATE' then old.owner_id else null end,
     new.owner_id, from_name, to_name,
     case when auth.uid() is null then 'ترحيل' else 'يدوي' end,
     auth.uid(), actor);

  return null;
end; $$;

drop trigger if exists trg_log_client_assignment on public.clients;
create trigger trg_log_client_assignment
  after insert or update of owner_id on public.clients
  for each row execute function public.log_client_assignment();

-- بذرة التاريخ: الملكية القائمة اليوم تُسجَّل مرة واحدة كنقطة بداية،
-- فلا يبدأ التاريخ فارغاً ويبدو كأن أحداً لم يملك شيئاً قبل اليوم.
insert into public.client_assignments
  (client_id, from_owner_id, to_owner_id, from_owner_name, to_owner_name,
   method, reason, assigned_by_name, at)
select c.id, null, c.owner_id, null, e.full_name,
       'ترحيل', 'نقطة البداية عند ترحيل الملكية إلى مفتاح (071)', 'النظام',
       coalesce(c.owner_assigned_at, c.created_at)
  from public.clients c
  join public.employees e on e.id = c.owner_id
 where c.owner_id is not null
   and not exists (select 1 from public.client_assignments a where a.client_id = c.id);

-- ------------------------------------------------------------
-- 5) assign_client() — الإسناد المضبوط
--
-- من يملك نقل ليد؟ المدير، والمشرف داخل نطاقه، ومدير المتابعة.
-- الموظف لا ينقل ليداً — لا إليه ولا منه. لو مَلَك ذلك لأمكنه أن
-- يتخلّص من ليد صعب أو يستولي على ليد ساخن لزميله.
-- ------------------------------------------------------------
create or replace function public.assign_client(
  p_client_id uuid,
  p_owner_id  uuid,
  p_reason    text default null,
  p_method    text default 'يدوي'
) returns void language plpgsql security definer set search_path = public as $$
declare
  cur_owner uuid;
  ok        boolean;
begin
  select owner_id into cur_owner from public.clients where id = p_client_id;
  if not found then
    raise exception 'العميل غير موجود.';
  end if;

  -- auth.uid() فارغة داخل محرّر SQL = سياق موثوق (نفس اصطلاح is_admin
  -- في بقية النظام)
  ok := auth.uid() is null
        or public.is_admin()
        or public.is_followup_manager()
        or (public.is_supervisor()
            and (cur_owner is null or cur_owner in (select s.id from public.my_scope_employees() s))
            and (p_owner_id is null or p_owner_id in (select s.id from public.my_scope_employees() s)));

  if not ok then
    raise exception 'لا تملك صلاحية نقل ملكية هذا العميل.';
  end if;

  if p_owner_id is not null
     and not exists (select 1 from public.employees where id = p_owner_id) then
    raise exception 'الموظف المستلِم غير موجود.';
  end if;

  if cur_owner is not distinct from p_owner_id then
    return;   -- لا نقل، فلا صفّ في التاريخ
  end if;

  update public.clients
     set owner_id = p_owner_id,
         owner_assigned_at = now()
   where id = p_client_id;

  -- المحفّز كتب الصفّ؛ نُثبت السبب والطريقة عليه
  update public.client_assignments
     set reason = coalesce(p_reason, reason),
         method = p_method
   where id = (select id from public.client_assignments
                where client_id = p_client_id order by at desc limit 1);
end; $$;

revoke all on function public.assign_client(uuid, uuid, text, text) from public;
grant execute on function public.assign_client(uuid, uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 6) كشف التكرار
--
-- لا يحذف ولا يدمج شيئاً. يرصد ويعرض، والقرار للمدير (§14).
--   مؤكّد  = نفس مفتاح الهاتف
--   محتمل  = هاتف أحدهما يطابق هاتف الآخر البديل
--   مرشّح  = تشابه اسم فوق العتبة بلا تطابق هاتف
-- ------------------------------------------------------------
create table if not exists public.client_duplicates (
  id          uuid primary key default gen_random_uuid(),
  client_a    uuid not null references public.clients(id) on delete cascade,
  client_b    uuid not null references public.clients(id) on delete cascade,
  match_type  text not null check (match_type in ('مؤكّد','محتمل','مرشّح')),
  match_on    text not null,               -- هاتف | هاتف بديل | اسم
  similarity  numeric,
  status      text not null default 'جديد'
              check (status in ('جديد','مدموج','مُتجاهَل','ليسا واحداً')),
  resolved_by      uuid references auth.users(id) on delete set null,
  resolved_by_name text,
  resolved_at timestamptz,
  detected_at timestamptz not null default now(),
  -- الزوج يُخزَّن مرتّباً (a < b) فلا يتكرّر الزوج نفسه معكوساً
  constraint client_duplicates_pair_uq unique (client_a, client_b),
  constraint client_duplicates_ordered check (client_a < client_b)
);

create index if not exists client_duplicates_status_idx
  on public.client_duplicates (status, detected_at desc);

create or replace function public.scan_client_duplicates()
returns int language plpgsql security definer set search_path = public as $$
declare
  sim_threshold numeric := public.crm_setting_num('duplicate_name_similarity', 0.45);
begin
  -- الترتيب مقصود: الأقوى أولاً. الزوج الذي رُصد بالهاتف لا يُعاد
  -- رصده باسمٍ متشابه، لأن on conflict يمنع تكرار الزوج نفسه —
  -- فيبقى لكل زوج تصنيفٌ واحد هو الأدقّ.

  -- (١) تطابق مفتاح الهاتف = مؤكّد
  insert into public.client_duplicates (client_a, client_b, match_type, match_on, similarity)
  select least(a.id, b.id), greatest(a.id, b.id), 'مؤكّد', 'هاتف', 1.0
    from public.clients a
    join public.clients b
      on b.phone_key = a.phone_key
     and a.id < b.id
   where a.phone_key is not null
  on conflict (client_a, client_b) do nothing;

  -- (٢) هاتف أحدهما = الهاتف البديل للآخر
  insert into public.client_duplicates (client_a, client_b, match_type, match_on, similarity)
  select least(a.id, b.id), greatest(a.id, b.id), 'محتمل', 'هاتف بديل', 0.8
    from public.clients a
    join public.clients b
      on b.alt_phone_key = a.phone_key
     and a.id <> b.id
   where a.phone_key is not null
  on conflict (client_a, client_b) do nothing;

  -- (٣) تشابه الاسم بلا تطابق هاتف — مرشّح فقط، للعين البشرية
  insert into public.client_duplicates (client_a, client_b, match_type, match_on, similarity)
  select least(a.id, b.id), greatest(a.id, b.id), 'مرشّح', 'اسم',
         round(similarity(a.name, b.name)::numeric, 2)
    from public.clients a
    join public.clients b
      on a.id < b.id
     and similarity(a.name, b.name) >= sim_threshold
   where a.phone_key is distinct from b.phone_key
  on conflict (client_a, client_b) do nothing;

  return (select count(*) from public.client_duplicates where status = 'جديد');
end; $$;

comment on function public.scan_client_duplicates() is
  'يرصد التكرار ولا يحذف ولا يدمج. القرار للمدير من لوحة جودة البيانات.';

revoke all on function public.scan_client_duplicates() from public;
grant execute on function public.scan_client_duplicates() to authenticated, service_role;

alter table public.client_duplicates enable row level security;
drop policy if exists "read duplicates" on public.client_duplicates;
create policy "read duplicates" on public.client_duplicates
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager()));
drop policy if exists "manage duplicates" on public.client_duplicates;
create policy "manage duplicates" on public.client_duplicates
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

alter table public.client_assignments enable row level security;
drop policy if exists "read assignments" on public.client_assignments;
create policy "read assignments" on public.client_assignments
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or public.can_see_client(client_id)
  );
-- لا سياسة كتابة: التاريخ يكتبه المحفّز بـ security definer وحده.

-- ------------------------------------------------------------
-- 7) توسيع الرؤية لتقبل المفتاح — بلا انتقاص من القديم
--
-- ⚠️ كل شرط قائم يبقى كما هو حرفياً، ونضيف شرط owner_id بـ OR.
--    لا أحد يفقد وصولاً كان له؛ من كان يُرى بالاسم يبقى يُرى بالاسم.
-- ------------------------------------------------------------
create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         -- الجديد: الملكية بالمفتاح
         or (c.owner_id is not null and c.owner_id = public.my_employee_id())
         -- القديم كما كان — جسر التوافق
         or (c.sales_employee is not null
             and c.sales_employee = public.my_employee_name())
       )
  );
$$;

drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or created_by = (select auth.uid())
    -- الجديد: المفتاح — أنا أو من أُشرف عليهم
    or (owner_id is not null
        and owner_id in (select s.id from public.my_scope_employees() s))
    -- القديم: الاسم
    or (
      sales_employee is not null
      and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)
    )
    or (broker_company_id is not null
        and broker_company_id = (select public.my_broker_company()))
    or (broker_company_id is not null
        and broker_company_id in (select m.company_id from public.my_rm_companies() m))
  );

drop policy if exists "update own clients" on public.clients;
create policy "update own clients" on public.clients
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (owner_id is not null
        and owner_id in (select s.id from public.my_scope_employees() s))
    or (sales_employee is not null
        and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
    or (broker_company_id is not null
        and broker_company_id = (select public.my_broker_company()))
    or (broker_company_id is not null
        and broker_company_id in (select m.company_id from public.my_rm_companies() m))
  )
  with check (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or (owner_id is not null
        and owner_id in (select s.id from public.my_scope_employees() s))
    or (sales_employee is not null
        and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
    or (broker_company_id is not null
        and broker_company_id = (select public.my_broker_company()))
    or (broker_company_id is not null
        and broker_company_id in (select m.company_id from public.my_rm_companies() m))
  );

-- ------------------------------------------------------------
-- 8) حارس الملكية — الموظف لا ينقل ليداً
--
-- RLS تحكم الصفّ لا العمود، فلا تستطيع منع تغيير owner_id وحده.
-- المحفّز يفعل. (نفس علاج sql/043 لـ broker_company_id.)
-- ------------------------------------------------------------
create or replace function public.guard_client_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not distinct from old.owner_id then
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

-- ⚠️ الاسم يبدأ بـ trg_z ليعمل بعد trg_client_owner_sync: المزامنة
--    قد تستنتج owner_id من النصّ، والحارس يجب أن يرى النتيجة النهائية.
drop trigger if exists trg_z_guard_client_owner on public.clients;
create trigger trg_z_guard_client_owner
  before update of owner_id, sales_employee on public.clients
  for each row execute function public.guard_client_owner();

-- ------------------------------------------------------------
-- 9) الفهارس — مبنيّة على الاستعلامات الفعلية لا على التخمين
-- ------------------------------------------------------------
create index if not exists clients_phone_key_idx    on public.clients (phone_key)
  where phone_key is not null;
create index if not exists clients_alt_phone_key_idx on public.clients (alt_phone_key)
  where alt_phone_key is not null;
create index if not exists clients_owner_stage_idx  on public.clients (owner_id, stage);
create index if not exists clients_followup_idx     on public.clients (follow_up_date)
  where follow_up_date is not null;
create index if not exists clients_stage_idx        on public.clients (stage);
create index if not exists clients_created_idx      on public.clients (created_at desc);
create index if not exists clients_name_trgm_idx    on public.clients using gin (name gin_trgm_ops);

-- التدقيق العام على الملكية: تغيير المالك حدثٌ مالي بالنتيجة (عمولة)
drop trigger if exists trg_audit_clients on public.clients;
create trigger trg_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 10) التحقّق — يقول ما صار، ويسمّي ما لم يُحَلّ
-- ------------------------------------------------------------
do $$
declare
  n_total int; n_owned int; n_orphan int; n_nophone int;
  n_dupes int; n_conc int; top_owner text; top_count int;
  r record;
begin
  select count(*) into n_total from public.clients;
  select count(*) into n_owned from public.clients where owner_id is not null;
  select count(*) into n_orphan
    from public.clients
   where owner_id is null
     and sales_employee is not null and btrim(sales_employee) <> '';
  select count(*) into n_nophone from public.clients where phone_key is null;

  perform public.scan_client_duplicates();
  select count(*) into n_dupes from public.client_duplicates where status = 'جديد';

  raise notice '--- 071 هوية العميل وملكيّته ---';
  raise notice 'العملاء: %   بمالك مفتاحي: %   (%%%)',
    n_total, n_owned, case when n_total > 0 then round(n_owned * 100.0 / n_total) else 0 end;

  if n_orphan > 0 then
    raise warning 'بلا مالك رغم وجود اسم: % — الأسماء التي لا تقابل موظفاً:', n_orphan;
    for r in
      select c.sales_employee as nm, count(*) as n
        from public.clients c
       where c.owner_id is null
         and c.sales_employee is not null and btrim(c.sales_employee) <> ''
       group by 1 order by 2 desc limit 10
    loop
      raise warning '   «%» — % عميلاً', r.nm, r.n;
    end loop;
    raise warning 'صحّح الاسم في ملف الموظفين أو أسنِدهم بـ assign_client().';
  else
    raise notice 'الترحيل: كامل — كل اسم قابَل موظفاً.';
  end if;

  if n_nophone > 0 then
    raise warning 'بلا مفتاح هاتف صالح: % — تظهر في لوحة جودة البيانات (077).', n_nophone;
  end if;

  raise notice 'تكرار مرصود بانتظار القرار: %', n_dupes;

  -- تركّز الإسناد: هذا ما فسّر «٦٢ مهملاً» في التقارير
  select e.full_name, count(*) into top_owner, top_count
    from public.clients c
    join public.employees e on e.id = c.owner_id
   where public.is_open_stage(c.stage)
   group by e.full_name order by count(*) desc limit 1;

  if top_count is not null then
    select count(*) into n_conc from public.clients where public.is_open_stage(stage);
    raise notice 'أعلى تركّز: «%» يملك % ليداً مفتوحاً من % (%%%).',
      top_owner, top_count, n_conc,
      case when n_conc > 0 then round(top_count * 100.0 / n_conc) else 0 end;
    if top_count > public.crm_setting_int('max_open_leads_per_owner', 150) then
      raise warning 'تجاوز الحدّ الأعلى لليدات المفتوحة — راجع لوحة التوزيع (073).';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
