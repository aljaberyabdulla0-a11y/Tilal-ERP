-- ============================================================
-- تلال ERP — 077: جودة البيانات والدمج والحذف الناعم
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة
--
-- بياناتٌ سيّئة لا تُعلن عن نفسها — تكذب بصمت.
--
-- عميلٌ برقم هاتف خاطئ يبدو في التقارير كأي عميل: يُحتسب في
-- «٣٢٥ ليداً»، ويدخل مقام «معدّل الإغلاق»، ويُخفض أداء صاحبه —
-- وهو في الحقيقة صفٌّ لا يمكن الاتصال به أصلاً.
--
-- وعميلان بنفس الرقم يُحتسبان اثنين، فيرتفع البسط والمقام معاً
-- ويبدو المصدر أسخى ممّا هو.
--
-- وحين يُحذف عميل اليوم يُحذف **معه كل شيء**: `on delete cascade`
-- على الأنشطة والفرص والحجوزات. ضغطةُ زرٍّ تمحو تاريخاً كاملاً
-- بلا رجعة — وقد تمحو حجزاً مربوطاً بعمولة مُرحَّلة محاسبياً.
--
-- ============================================================
-- المبادئ الثلاثة
--
--   1) الخلل يُعرَض ولا يُصلَح تلقائياً.
--      إصلاحٌ صامت يخفي سببه فيتكرّر. اللوحة تقول «هذا خطأ» ويقرّر
--      البشر، إلا في التطبيع المحض (المسافات) فلا رأي فيه.
--
--   2) لا حذف نهائي لعميل.
--      deleted_at بدل DELETE. المحذوف يختفي من كل شاشة وتقرير،
--      ويبقى تاريخه متّصلاً بحجوزاته وقيوده المحاسبية.
--
--   3) الدمج نقلٌ لا محو.
--      كل نشاط وفرصة وحجز ومهمة ينتقل إلى الباقي قبل أن يُطوى
--      المدموج. لا سطر يضيع.
--
-- ============================================================
-- ما يضيفه
--
--   1) الحذف الناعم على clients + استثناؤه من كل السياسات
--   2) soft_delete_client() / restore_client()
--   3) merge_clients() — الدمج بنقل كامل وأثر مُدقَّق
--   4) crm_data_quality() — ١٤ فحصاً بخطورة وعدد ورابط
--   5) crm_fix_whitespace() — التطبيع المحض وحده
--
-- يتطلب: sql/058 و 070 و 071 و 072 و 074. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الحذف الناعم
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    uuid references auth.users(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists clients_active_idx on public.clients (created_at desc)
  where deleted_at is null;

comment on column public.clients.deleted_at is
  'الحذف الناعم. المحذوف خارج كل شاشة وتقرير، وتاريخه باقٍ متّصلاً بحجوزاته وقيوده.';

-- ===== استثناء المحذوف من الرؤية =====
-- ⚠️ نعيد بناء السياسة كما تركتها 071 حرفياً، ونضيف شرط الحذف
--    وحده. كل شرط قائم يبقى؛ لا أحد يفقد وصولاً كان له.
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select public.is_admin())
      or (select public.is_followup_manager())
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
  );

-- المدير وحده يرى المحذوفين (للاسترجاع)
drop policy if exists "admin reads deleted clients" on public.clients;
create policy "admin reads deleted clients" on public.clients
  for select to authenticated
  using (deleted_at is not null and (select public.is_admin()));

-- can_see_client بوابة الفواتير والحجوزات — المحذوف يُغلق عندها أيضاً
create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and c.deleted_at is null
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         or (c.owner_id is not null and c.owner_id = public.my_employee_id())
         or (c.sales_employee is not null
             and c.sales_employee = public.my_employee_name())
       )
  );
$$;

-- ------------------------------------------------------------
-- 2) الحذف والاسترجاع
--
-- ⚠️ الحذف يُرفض إن كان للعميل حجزٌ حيّ أو فاتورة. العميل ليس صفّاً
--    معزولاً: خلفه قيود محاسبية وعمولات مُرحَّلة، وطيّه يجعل دفتراً
--    مُرحَّلاً بلا طرف. تُفسخ الحجوزات أولاً (sql/065) ثم يُطوى.
-- ------------------------------------------------------------
create or replace function public.soft_delete_client(p_client_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare n_res int; n_inv int;
begin
  if not (auth.uid() is null or public.is_admin()) then
    raise exception 'حذف العميل من صلاحية الإدارة وحدها.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'اذكر سبب الحذف — حذفٌ بلا سبب لا يُراجَع لاحقاً.';
  end if;

  select count(*) into n_res from public.reservations
   where client_id = p_client_id and coalesce(status, '') not in ('ملغي', 'مفسوخ');
  if n_res > 0 then
    raise exception 'للعميل % حجزاً حيّاً — افسخها أولاً (sql/065) ثم احذف.', n_res;
  end if;

  select count(*) into n_inv from public.invoices where client_id = p_client_id;
  if n_inv > 0 then
    raise exception 'للعميل % فاتورة — لا يُحذف من له أثر محاسبي.', n_inv;
  end if;

  update public.clients
     set deleted_at = now(), deleted_by = auth.uid(), delete_reason = p_reason
   where id = p_client_id and deleted_at is null;

  -- فرصه المفتوحة تُطوى معه فلا تبقى في خطّ أنابيب لعميل غير موجود
  update public.opportunities
     set deleted_at = now(), deleted_by = auth.uid()
   where client_id = p_client_id and deleted_at is null;
end $$;

create or replace function public.restore_client(p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() is null or public.is_admin()) then
    raise exception 'الاسترجاع من صلاحية الإدارة وحدها.';
  end if;

  update public.clients
     set deleted_at = null, deleted_by = null, delete_reason = null
   where id = p_client_id;

  update public.opportunities
     set deleted_at = null, deleted_by = null
   where client_id = p_client_id;
end $$;

-- ------------------------------------------------------------
-- 3) الدمج — نقلٌ لا محو
--
-- الباقي (keep) يرث كل شيء من المدموج (merge):
--   الأنشطة · الفرص · الاهتمامات · الحجوزات · المهام · تاريخ الملكية
--
-- والحقول الفارغة في الباقي تُملأ من المدموج، والمملوءة لا تُمَس —
-- الدمج لا يُتلف بياناتٍ صحيحة باسم التوحيد.
-- ------------------------------------------------------------
create or replace function public.merge_clients(p_keep_id uuid, p_merge_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  keep    public.clients%rowtype;
  gone    public.clients%rowtype;
  moved   jsonb := '{}'::jsonb;
  n       int;
begin
  if not (auth.uid() is null or public.is_admin()) then
    raise exception 'الدمج من صلاحية الإدارة وحدها.';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'لا يُدمَج العميل بنفسه.';
  end if;

  select * into keep from public.clients where id = p_keep_id;
  select * into gone from public.clients where id = p_merge_id;
  if keep.id is null or gone.id is null then
    raise exception 'أحد العميلين غير موجود.';
  end if;
  if gone.deleted_at is not null then
    raise exception 'العميل المراد دمجه محذوف أصلاً.';
  end if;

  -- (أ) نقل السجلّات التابعة
  update public.client_activities set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('أنشطة', n);

  update public.opportunities set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('فرص', n);

  update public.client_interests set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('اهتمامات', n);

  update public.reservations set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('حجوزات', n);

  update public.tasks set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('مهام', n);

  update public.client_assignments set client_id = p_keep_id where client_id = p_merge_id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('سجلّات إسناد', n);

  -- (ب) ملء الفراغات في الباقي من المدموج — بلا إتلاف قائم
  update public.clients c
     set phone               = coalesce(c.phone, gone.phone),
         alt_contact_name    = coalesce(c.alt_contact_name, gone.alt_contact_name),
         alt_contact_phone   = coalesce(c.alt_contact_phone, gone.alt_contact_phone),
         alt_contact_relation= coalesce(c.alt_contact_relation, gone.alt_contact_relation),
         governorate         = coalesce(c.governorate, gone.governorate),
         area                = coalesce(c.area, gone.area),
         source              = coalesce(c.source, gone.source),
         purchase_purpose    = coalesce(c.purchase_purpose, gone.purchase_purpose),
         payment_method      = coalesce(c.payment_method, gone.payment_method),
         budget_min          = coalesce(c.budget_min, gone.budget_min),
         budget_max          = coalesce(c.budget_max, gone.budget_max),
         purchase_timeline   = coalesce(c.purchase_timeline, gone.purchase_timeline),
         is_decision_maker   = coalesce(c.is_decision_maker, gone.is_decision_maker),
         owner_id            = coalesce(c.owner_id, gone.owner_id),
         -- آخر تواصل: الأحدث بين الاثنين
         last_contact_at     = greatest(coalesce(c.last_contact_at, gone.last_contact_at),
                                        coalesce(gone.last_contact_at, c.last_contact_at)),
         contact_count       = coalesce(c.contact_count, 0) + coalesce(gone.contact_count, 0),
         notes               = concat_ws(E'\n---\n', nullif(c.notes, ''), nullif(gone.notes, ''))
   where c.id = p_keep_id;

  -- (ج) طيّ المدموج مع إشارة صريحة إلى وريثه
  update public.clients
     set deleted_at = now(), deleted_by = auth.uid(),
         delete_reason = 'دُمج في العميل ' || p_keep_id::text
   where id = p_merge_id;

  -- (د) إغلاق صفّ التكرار إن وُجد
  update public.client_duplicates
     set status = 'مدموج', resolved_at = now(), resolved_by = auth.uid(),
         resolved_by_name = coalesce(public.my_employee_name(),
                                     public.display_name(auth.uid()))
   where (client_a = least(p_keep_id, p_merge_id)
          and client_b = greatest(p_keep_id, p_merge_id));

  -- (هـ) أثرٌ صريح في سجلّ التدقيق — الدمج قرارٌ لا رجعة سهلة فيه
  insert into public.audit_log
    (table_name, record_id, operation, old_data, new_data, actor, actor_name)
  values
    ('clients', p_keep_id, 'UPDATE',
     jsonb_build_object('merged_from', p_merge_id, 'merged_name', gone.name),
     moved, auth.uid(),
     coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'));

  perform public.refresh_lead_scores(p_keep_id);

  return moved;
end $$;

comment on function public.merge_clients(uuid, uuid) is
  'يدمج عميلين بنقل كل تابع إلى الباقي ثم طيّ المدموج. يُرجِع عدّاد المنقول.';

-- ------------------------------------------------------------
-- 4) لوحة جودة البيانات
--
-- كل فحص يُرجِع: الخطورة، الرمز، العنوان، العدد، ومسار المعالجة.
-- «مسار المعالجة» عمودٌ مقصود: تقريرٌ يقول «٦٢ خطأ» ولا يقول أين
-- يُصلَح تقريرٌ يُحبط ولا يُصلِح.
-- ------------------------------------------------------------
create or replace function public.crm_data_quality()
returns table (
  severity text,
  code     text,
  title    text,
  affected bigint,
  fix_path text
)
language sql stable set search_path = public as $$
  with checks as (
    -- الاتصال ممكن أصلاً؟
    select 'عالٍ' s, 'missing_phone' c, 'عملاء بلا رقم هاتف' t,
           count(*) n, '/dashboard/clients?filter=no_phone' f
      from public.clients where deleted_at is null
       and (phone is null or btrim(phone) = '')
    union all
    select 'عالٍ', 'invalid_phone', 'أرقام لا تطابق الشكل العراقي',
           count(*), '/dashboard/crm/data-quality#phones'
      from public.clients where deleted_at is null
       and phone is not null and btrim(phone) <> '' and phone_key is null
    union all
    -- الملكية
    select 'عالٍ', 'no_owner', 'ليدات مفتوحة بلا مالك',
           count(*), '/dashboard/crm/distribution'
      from public.clients where deleted_at is null
       and owner_id is null and public.is_open_stage(stage)
    union all
    select 'متوسط', 'unmatched_employee', 'اسم موظف مبيعات لا يقابل حساباً',
           count(*), '/dashboard/hr/employees'
      from public.clients where deleted_at is null
       and owner_id is null
       and sales_employee is not null and btrim(sales_employee) <> ''
    union all
    -- المتابعة
    select 'عالٍ', 'open_no_next_action', 'فرص مفتوحة بلا خطوة قادمة',
           count(*), '/dashboard/crm/opportunities?filter=no_action'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open' and o.next_action_date is null
    union all
    select 'متوسط', 'closed_with_tasks', 'ملفّات مغلقة ومهامّها ما زالت مفتوحة',
           count(*), '/dashboard/tasks?filter=orphan'
      from public.tasks tk join public.clients c on c.id = tk.client_id
     where c.deleted_at is null and not public.is_open_stage(c.stage)
       and tk.status in ('جديدة', 'قيد التنفيذ')
    union all
    -- تماسك الفرص
    select 'متوسط', 'opp_no_project', 'فرص متقدّمة بلا مشروع',
           count(*), '/dashboard/crm/opportunities'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'open'
       and g.sort_order >= 3 and o.project_id is null
    union all
    select 'عالٍ', 'lost_no_reason', 'صفقات خاسرة بلا سبب مسجَّل',
           count(*), '/dashboard/crm/reports#lost'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'lost' and o.lost_reason_id is null
    union all
    select 'عالٍ', 'won_no_value', 'صفقات فائزة بلا قيمة',
           count(*), '/dashboard/crm/opportunities?filter=won'
      from public.opportunities o join public.crm_stages g on g.id = o.stage_id
     where o.deleted_at is null and g.stage_type = 'won'
       and coalesce(o.won_value, 0) = 0
    union all
    select 'متوسط', 'reservation_no_opp', 'حجوزات غير مربوطة بفرصة',
           count(*), '/dashboard/reservations'
      from public.reservations where opportunity_id is null
    union all
    -- التكرار
    select 'عالٍ', 'duplicates_confirmed', 'تكرار مؤكّد بانتظار القرار',
           count(*), '/dashboard/crm/data-quality#duplicates'
      from public.client_duplicates where status = 'جديد' and match_type = 'مؤكّد'
    union all
    select 'منخفض', 'duplicates_possible', 'تكرار محتمل للمراجعة',
           count(*), '/dashboard/crm/data-quality#duplicates'
      from public.client_duplicates where status = 'جديد' and match_type <> 'مؤكّد'
    union all
    -- التأهيل والمصدر
    select 'متوسط', 'missing_source', 'عملاء بلا مصدر',
           count(*), '/dashboard/clients?filter=no_source'
      from public.clients where deleted_at is null
       and (source is null or btrim(source) = '')
    union all
    select 'منخفض', 'missing_budget', 'ليدات مفتوحة بلا ميزانية',
           count(*), '/dashboard/clients?filter=no_budget'
      from public.clients where deleted_at is null
       and public.is_open_stage(stage) and budget_min is null and budget_max is null
    union all
    -- تواريخ مستحيلة
    select 'عالٍ', 'impossible_dates', 'تواريخ مستحيلة (متابعة قبل الإنشاء أو إغلاق قبل الفتح)',
           count(*), '/dashboard/crm/data-quality#dates'
      from public.opportunities
     where deleted_at is null
       and (closed_at < created_at or expected_close_date < created_at::date)
    union all
    select 'منخفض', 'whitespace', 'أسماء أو مصادر بمسافات زائدة',
           count(*), 'crm_fix_whitespace()'
      from public.clients where deleted_at is null
       and (name <> btrim(name) or name ~ '\s{2,}'
            or source <> btrim(coalesce(source, '')))
  )
  select s, c, t, n, f from checks where n > 0
   order by case s when 'عالٍ' then 1 when 'متوسط' then 2 else 3 end, n desc;
$$;

comment on function public.crm_data_quality() is
  'الخلل يُعرَض ولا يُصلَح تلقائياً. لكل صفّ مسار معالجة — تقريرٌ بلا مخرج يُحبط ولا يُصلِح.';

-- ------------------------------------------------------------
-- 5) الإصلاح الوحيد المسموح آلياً: المسافات
--    لا رأي في «  أحمد   علي  » — هو «أحمد علي» بلا خلاف.
--    وكل ما عداه (رقم خاطئ، مصدر ناقص) قرارُ بشر.
-- ------------------------------------------------------------
create or replace function public.crm_fix_whitespace()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (auth.uid() is null or public.is_admin()) then
    raise exception 'التطبيع من صلاحية الإدارة.';
  end if;

  update public.clients
     set name   = regexp_replace(btrim(name), '\s+', ' ', 'g'),
         source = nullif(regexp_replace(btrim(coalesce(source, '')), '\s+', ' ', 'g'), ''),
         area   = nullif(regexp_replace(btrim(coalesce(area, '')), '\s+', ' ', 'g'), '')
   where deleted_at is null
     and (name <> regexp_replace(btrim(name), '\s+', ' ', 'g')
          or coalesce(source, '') <> coalesce(nullif(regexp_replace(btrim(coalesce(source, '')), '\s+', ' ', 'g'), ''), '')
          or coalesce(area, '')   <> coalesce(nullif(regexp_replace(btrim(coalesce(area, '')), '\s+', ' ', 'g'), ''), ''));
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------
-- 6) الصلاحيات
-- ------------------------------------------------------------
revoke all on function public.soft_delete_client(uuid, text) from public;
revoke all on function public.restore_client(uuid)           from public;
revoke all on function public.merge_clients(uuid, uuid)      from public;
revoke all on function public.crm_data_quality()             from public;
revoke all on function public.crm_fix_whitespace()           from public;

grant execute on function public.soft_delete_client(uuid, text) to authenticated, service_role;
grant execute on function public.restore_client(uuid)           to authenticated, service_role;
grant execute on function public.merge_clients(uuid, uuid)      to authenticated, service_role;
grant execute on function public.crm_data_quality()             to authenticated, service_role;
grant execute on function public.crm_fix_whitespace()           to authenticated, service_role;

-- ⚠️ الحذف المباشر يبقى مُتاحاً للمدير في السياسة القديمة، لكنه
--    صار الطريق الخطأ. لا نُسقط السياسة (قد تعتمد عليها شاشة
--    قائمة) — الواجهة الجديدة تستدعي soft_delete_client() وحدها،
--    وزر الحذف الصلب يُزال منها في مرحلة الواجهة.

-- ------------------------------------------------------------
-- 7) التحقّق
-- ------------------------------------------------------------
do $$
declare r record; total bigint := 0; high bigint := 0;
begin
  raise notice '--- 077 جودة البيانات ---';
  for r in select * from public.crm_data_quality() loop
    total := total + r.affected;
    if r.severity = 'عالٍ' then high := high + r.affected; end if;
    raise notice '  [%] % — % سجلّاً  ↳ %', r.severity, r.title, r.affected, r.fix_path;
  end loop;

  if total = 0 then
    raise notice '  لا ملاحظات على جودة البيانات.';
  else
    raise notice 'الإجمالي: % ملاحظة، منها % بخطورة عالية.', total, high;
    raise notice 'ابدأ بالعالية: كل واحدة منها تُفسد رقماً في تقارير الإدارة.';
  end if;
end $$;

notify pgrst, 'reload schema';
