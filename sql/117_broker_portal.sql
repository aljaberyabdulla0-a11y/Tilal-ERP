-- ============================================================
-- تلال ERP — 117: بوّابة الوسيط — وحداتٌ مكشوفة، طلبات حجز، وشرائح عمولة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المطلوب (2026-10-01، من المالك) =====
--
--   ١) حساب الشركة الوسيطة يُنشأ من شاشتها لا من لوحة Supabase.
--      (الإنشاء نفسه في دالّة الحافّة broker-accounts — تحتاج مفتاح
--       الخدمة ولا يجوز أن يصل للمتصفح. هنا عمود التفعيل وحده.)
--   ٢) الوسيط يرى وحدات المشاريع المُسنَدة له — والإدارة تختار: كل
--      المتاح، أو وحداتٍ بعينها.
--   ٣) الوسيط يرفع «طلب حجز» على وحدة، ومدير العلاقات المسؤول يتابعه
--      حتى الحجز ثم البيع.
--   ٤) العمولة ليست نسبةً مقطوعة للشركة: **شرائح تصاعدية لكل مشروع**.
--
-- ===== قرارات الشرائح (أجاب عنها المالك) =====
--
--   • الأساس: **عدد وحدات الشركة نفسها** في المشروع.
--   • الفترة: **شهرية** — العدّاد يبدأ من الصفر أول كل شهر.
--   • التطبيق: **بأثر رجعي** — بلوغ شريحة يرفع كل صفقات الشركة في
--     ذلك المشروع وذلك الشهر إلى نسبتها، ويُسجَّل الفرق في
--     broker_commission_adjustments سطراً لكل تعديل.
--   • النطاق: شرائح للمشروع تسري على كل الوسطاء، ويجوز لشركةٍ بعينها
--     شرائح خاصة في مشروع (إن وُجد لها صفٌّ واحد حلّت شرائحها كلّها
--     محلّ شرائح المشروع — لا خلط بين الجدولين).
--
-- ===== ما الذي يُبنى عليه =====
--
--   العمولة صفٌّ في broker_commissions لكل صفقة (كما في 043)، لكن
--   نسبتها ومبلغها **يُعادان حسابهما** لكل الدلو (شركة × مشروع × شهر)
--   كلما دخلته صفقة أو خرجت منه (فسخ). الدالّة الوحيدة التي تكتب
--   النسبة هي recompute_broker_tier — فلا يتناقض رقمان.
--
--   ⚠️ ولا ينزل مبلغ عمولةٍ تحت ما صُرف منها فعلاً: فسخُ صفقةٍ يُنزل
--      الشريحة، لكن المصروف للوسيط حركةٌ نقدية مقيّدة لا تُمحى برقم.
--
--   ⚠️ العمولة نفسها لا قيد لها (يُقيَّد الصرف وحده في broker_payments
--      منذ 108)، فإعادة حساب المبلغ لا تمسّ الدفاتر.
--
-- ===== ثغرات أُغلقت في الطريق =====
--
--   • «authenticated can insert reservations» كانت with check (true):
--     حساب الوسيط يستطيع إدراج حجزٍ مباشرةً. صارت ممنوعةً عليه — طريقه
--     الوحيد طلب الحجز.
--   • عمولة الوسيط كانت تُحسب من reservations.amount — وهو **العربون**
--     لا السعر. صارت من sale_price ثم سعر الوحدة، وتتبع sale_price إن
--     أُدخل لاحقاً عند تأكيد المقدمة.
--   • فسخ البيع (113) كان يترك عمولة الوسيط قائمة. صار يعكسها ويعيد
--     حساب شريحة شهرها.
--   • الليد الذي عليه حجزٌ قائم أو طلب حجز مفتوح كان يعود إلى تلال عند
--     انتهاء مهلته وسط الصفقة. صار لا يعود.
--
-- يتطلب: 043، 050، 056، 069، 108، 113. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الحساب: تفعيلٌ وإيقاف
-- ------------------------------------------------------------
alter table public.broker_users
  add column if not exists is_active boolean not null default true,
  add column if not exists login_name text;

comment on column public.broker_users.is_active is
  'الحساب الموقوف لا نطاق له: my_broker_company() تُرجع فراغاً، ودالّة الحافّة تحظر دخوله (sql/117).';
comment on column public.broker_users.login_name is
  'اسم الدخول كما كتبه المدير (بريد أو اسم مستخدم) — للعرض فقط.';

-- الحساب الموقوف يفقد نطاقه فوراً — كل السياسات مبنيّة على هذه الدالّة
create or replace function public.my_broker_company()
returns uuid language sql stable security definer set search_path = public as $fn$
  select bu.company_id from public.broker_users bu
   where bu.user_id = auth.uid() and bu.is_active;
$fn$;


-- ------------------------------------------------------------
-- 2) الوحدات التي يراها الوسيط
-- ------------------------------------------------------------
alter table public.broker_company_projects
  add column if not exists units_scope text not null default 'الكل';

alter table public.broker_company_projects drop constraint if exists bcp_units_scope_chk;
alter table public.broker_company_projects
  add constraint bcp_units_scope_chk check (units_scope in ('الكل', 'مختارة'));

comment on column public.broker_company_projects.units_scope is
  'الكل = كل وحدات المشروع المتاحة. مختارة = ما في broker_visible_units وحده (sql/117).';

create table if not exists public.broker_visible_units (
  company_id uuid not null references public.broker_companies(id) on delete cascade,
  unit_id    uuid not null references public.units(id)            on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references auth.users(id) on delete set null,
  primary key (company_id, unit_id)
);

create index if not exists bvu_unit_idx on public.broker_visible_units (unit_id);

alter table public.broker_visible_units enable row level security;

drop policy if exists "read broker visible units" on public.broker_visible_units;
create policy "read broker visible units" on public.broker_visible_units
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id in (select m.company_id from public.my_rm_companies() m)
  );

drop policy if exists "admins manage broker visible units" on public.broker_visible_units;
create policy "admins manage broker visible units" on public.broker_visible_units
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- هل هذه الوحدة مكشوفة لهذه الشركة؟ (مشروعها مُسنَد، ونطاقه يشملها)
create or replace function public.broker_unit_visible(p_company uuid, p_unit uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.units u
      join public.broker_company_projects bcp
        on bcp.project_id = u.project_id and bcp.company_id = p_company
     where u.id = p_unit
       and (
         bcp.units_scope = 'الكل'
         or exists (select 1 from public.broker_visible_units v
                     where v.company_id = p_company and v.unit_id = u.id)
       )
  );
$fn$;


-- ------------------------------------------------------------
-- 3) طلبات الحجز
-- ------------------------------------------------------------
create table if not exists public.broker_reservation_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  company_id      uuid not null references public.broker_companies(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  unit_id         uuid not null references public.units(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  requested_by_name text,
  note            text,
  -- لقطة الوحدة يوم الطلب: الوسيط لا يقرأ جدول الوحدات، فيحتاج ما يعرضه
  unit_code       text,
  unit_price      numeric,
  -- المتابعة
  rm_id           uuid references public.employees(id) on delete set null,
  status          text not null default 'معلّق',
  handled_by      uuid references auth.users(id) on delete set null,
  handled_by_name text,
  handled_at      timestamptz,
  decision_note   text,
  reservation_id  uuid references public.reservations(id) on delete set null,
  -- مرآة حالة الحجز بعد إنشائه — الوسيط لا يقرأ جدول الحجوزات
  reservation_status text
);

alter table public.broker_reservation_requests drop constraint if exists brr_status_chk;
alter table public.broker_reservation_requests
  add constraint brr_status_chk
  check (status in ('معلّق', 'قيد المتابعة', 'تمّ الحجز', 'مرفوض', 'ملغى'));

-- وحدةٌ واحدة = طلبٌ مفتوح واحد. الأسبق يُتابَع، والبقية ينتظرون قراره.
create unique index if not exists brr_one_open_per_unit
  on public.broker_reservation_requests (unit_id)
  where status in ('معلّق', 'قيد المتابعة');

create index if not exists brr_company_idx on public.broker_reservation_requests (company_id, created_at desc);
create index if not exists brr_rm_idx      on public.broker_reservation_requests (rm_id, status);
create index if not exists brr_res_idx     on public.broker_reservation_requests (reservation_id) where reservation_id is not null;

alter table public.broker_reservation_requests enable row level security;

-- القراءة: الإدارة، والشركة طلباتها، ومدير العلاقات ما أُسند إليه أو
-- ما يخصّ شركاته، ومشرف المشروع. الكتابة كلّها عبر الدوالّ أدناه.
drop policy if exists "read broker reservation requests" on public.broker_reservation_requests;
create policy "read broker reservation requests" on public.broker_reservation_requests
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or rm_id = (select public.my_employee_id())
    or company_id in (select m.company_id from public.my_rm_companies() m)
    or (project_id is not null and (select public.can_manage_project(project_id)))
  );

-- من يتابع هذا الطلب؟ المدير، أو مدير العلاقات المسؤول، أو مشرف المشروع
create or replace function public.can_handle_broker_request(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.broker_reservation_requests q
     where q.id = p_id
       and (
         public.is_admin()
         or (q.rm_id is not null and q.rm_id = public.my_employee_id())
         or (q.project_id is not null and public.can_manage_project(q.project_id))
       )
  );
$fn$;

create or replace function public.actor_display_name()
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(
    public.my_employee_name(),
    (select bu.full_name from public.broker_users bu where bu.user_id = auth.uid()),
    (select p.email from public.profiles p where p.id = auth.uid()),
    'النظام'
  );
$fn$;

-- إشعار من يتابع الطلب: مدير العلاقات، وإن لم يوجد فالإدارة
create or replace function public.notify_broker_request_handlers(
  p_id uuid, p_title text, p_body text
)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_rm_user uuid;
begin
  select * into q from public.broker_reservation_requests where id = p_id;
  select e.user_id into v_rm_user from public.employees e where e.id = q.rm_id;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select t.uid, p_title, p_body, '/dashboard/brokers/requests', 'حجز', p_id
    from (
      select v_rm_user as uid where v_rm_user is not null
      union
      select p.id from public.profiles p
       where p.role = 'admin' and v_rm_user is null
    ) t
   where t.uid is not null and t.uid is distinct from auth.uid();
end; $fn$;

create or replace function public.notify_broker_company(
  p_company uuid, p_title text, p_body text, p_link text, p_entity uuid
)
returns void language sql security definer set search_path = public as $fn$
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select bu.user_id, p_title, p_body, p_link, 'حجز', p_entity
    from public.broker_users bu
   where bu.company_id = p_company and bu.is_active
     and bu.user_id is distinct from auth.uid();
$fn$;

-- ===== (أ) الوسيط يرفع الطلب =====
-- العميل: ليدٌ قائم للشركة، أو ليدٌ جديد يُنشأ هنا (الاسم والهاتف)،
-- فلا يُضطرّ الوسيط إلى شاشتين لطلبٍ واحد.
create or replace function public.broker_request_reservation(
  p_unit       uuid,
  p_client     uuid default null,
  p_new_name   text default null,
  p_new_phone  text default null,
  p_note       text default null
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid := public.my_broker_company();
  u         public.units%rowtype;
  c         public.clients%rowtype;
  v_rm      uuid;
  v_client  uuid;
  v_id      uuid;
  v_who     text := public.actor_display_name();
  v_cname   text;
begin
  if v_company is null then
    raise exception 'طلب الحجز لحسابات الشركات الوسيطة';
  end if;

  if not exists (select 1 from public.broker_companies b where b.id = v_company and b.is_active) then
    raise exception 'شركتكم موقوفة — راجعوا تلال';
  end if;

  select * into u from public.units where id = p_unit for update;
  if not found or not public.broker_unit_visible(v_company, p_unit) then
    raise exception 'الوحدة غير متاحة لكم';
  end if;

  if u.status <> 'متاحة' then
    raise exception 'الوحدة % لم تعد متاحة (%)', coalesce(u.unit_code, ''), u.status;
  end if;

  if exists (select 1 from public.broker_reservation_requests q
              where q.unit_id = p_unit and q.status in ('معلّق', 'قيد المتابعة')) then
    raise exception 'على الوحدة % طلب حجز قيد المتابعة', coalesce(u.unit_code, '');
  end if;

  if p_client is not null then
    select * into c from public.clients where id = p_client;
    if not found or c.deleted_at is not null or c.broker_company_id is distinct from v_company then
      raise exception 'العميل ليس من ليدات شركتكم';
    end if;
    v_client := c.id;
    v_cname  := c.name;
  else
    if nullif(btrim(coalesce(p_new_name, '')), '') is null then
      raise exception 'اختر عميلاً من ليداتكم أو اكتب اسم عميل جديد';
    end if;
    -- المحفّز stamp_broker_lead يختم الشركة والمهلة من هوية المُدخِل
    insert into public.clients (name, phone, project_id, created_by, notes)
    values (btrim(p_new_name), nullif(btrim(coalesce(p_new_phone, '')), ''),
            u.project_id, auth.uid(), 'أُضيف مع طلب حجز الوحدة ' || coalesce(u.unit_code, ''))
    returning id, name into v_client, v_cname;
  end if;

  select bcp.rm_id into v_rm from public.broker_company_projects bcp
   where bcp.company_id = v_company and bcp.project_id = u.project_id;

  insert into public.broker_reservation_requests
    (company_id, project_id, unit_id, client_id, requested_by, requested_by_name,
     note, unit_code, unit_price, rm_id)
  values (v_company, u.project_id, p_unit, v_client, auth.uid(), v_who,
          nullif(btrim(coalesce(p_note, '')), ''), u.unit_code, u.price, v_rm)
  returning id into v_id;

  perform public.log_unit_event(p_unit, 'طلب حجز',
    (select b.name from public.broker_companies b where b.id = v_company)
      || ' تطلب حجز الوحدة للعميل ' || coalesce(v_cname, '—'));

  perform public.notify_broker_request_handlers(v_id,
    'طلب حجز من وسيط',
    (select b.name from public.broker_companies b where b.id = v_company)
      || ' — الوحدة ' || coalesce(u.unit_code, '—') || ' للعميل ' || coalesce(v_cname, '—'));

  return v_id;
end; $fn$;

-- ===== (ب) الوسيط يسحب طلبه =====
create or replace function public.broker_cancel_reservation_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype;
begin
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not found or q.company_id is distinct from public.my_broker_company() then
    raise exception 'الطلب غير موجود';
  end if;
  if q.status not in ('معلّق', 'قيد المتابعة') then
    raise exception 'لا يُسحب إلا طلبٌ مفتوح (الحالة: %)', q.status;
  end if;

  update public.broker_reservation_requests
     set status = 'ملغى', handled_at = now(), handled_by = auth.uid(),
         handled_by_name = public.actor_display_name(),
         decision_note = 'سحبه الوسيط'
   where id = p_id;

  perform public.notify_broker_request_handlers(p_id,
    'سُحب طلب حجز', 'الوحدة ' || coalesce(q.unit_code, '—') || ' — سحبه الوسيط');
end; $fn$;

-- ===== (ج) مدير العلاقات يستلم الطلب =====
create or replace function public.broker_request_take(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype;
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'متابعة هذا الطلب لمدير العلاقات المسؤول أو الإدارة';
  end if;
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if q.status <> 'معلّق' then
    raise exception 'الطلب ليس معلّقاً (الحالة: %)', q.status;
  end if;

  update public.broker_reservation_requests
     set status = 'قيد المتابعة', handled_by = auth.uid(),
         handled_by_name = public.actor_display_name(), handled_at = now()
   where id = p_id;

  perform public.notify_broker_company(q.company_id,
    'طلبكم قيد المتابعة',
    'الوحدة ' || coalesce(q.unit_code, '—') || ' — يتابعها ' || public.actor_display_name(),
    '/dashboard/broker/requests', p_id);
end; $fn$;

-- ===== (د) مدير العلاقات يؤكّد الحجز =====
-- يُنشئ حجزاً حقيقياً («حجز») ومحفّزات 044 تجعل الوحدة محجوزة. ومن
-- هنا يمضي المسار المعتاد: طلب البيع ← موافقة الإدارة ← بيع مكتمل ←
-- عمولة الوسيط بشريحتها.
create or replace function public.broker_request_confirm(
  p_id      uuid,
  p_deposit numeric default null,
  p_expiry  date    default null,
  p_note    text    default null
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  q     public.broker_reservation_requests%rowtype;
  v_res uuid;
  v_agent uuid;
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'تأكيد الحجز لمدير العلاقات المسؤول أو الإدارة';
  end if;
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if q.status not in ('معلّق', 'قيد المتابعة') then
    raise exception 'الطلب مغلق (الحالة: %)', q.status;
  end if;
  if p_deposit is not null and p_deposit < 0 then
    raise exception 'العربون لا يكون سالباً';
  end if;

  -- صاحب الصفقة داخل تلال: مدير العلاقات المسؤول، وإلا من يؤكّد
  v_agent := coalesce(q.rm_id, public.my_employee_id());

  -- guard_reservation_unit (044) يرفض الوحدة المباعة أو الموقوفة أو المحجوزة
  insert into public.reservations
    (client_id, unit_id, reservation_date, status, amount, expiry_date,
     agent_id, created_by, notes)
  values (q.client_id, q.unit_id, (now() at time zone 'Asia/Baghdad')::date, 'حجز',
          p_deposit, p_expiry, v_agent, auth.uid(),
          'من طلب الوسيط ' || (select b.name from public.broker_companies b where b.id = q.company_id)
            || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''))
  returning id into v_res;

  update public.broker_reservation_requests
     set status = 'تمّ الحجز', reservation_id = v_res, reservation_status = 'حجز',
         handled_by = auth.uid(), handled_by_name = public.actor_display_name(),
         handled_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  perform public.notify_broker_company(q.company_id,
    'تمّ حجز الوحدة ✅',
    'الوحدة ' || coalesce(q.unit_code, '—') || ' محجوزة لعميلكم — يتابع البيع ' || public.actor_display_name(),
    '/dashboard/broker/requests', p_id);

  return v_res;
end; $fn$;

-- ===== (هـ) الرفض =====
create or replace function public.broker_request_reject(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_reason text;
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'رفض الطلب لمدير العلاقات المسؤول أو الإدارة';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'اكتب سبب الرفض — الوسيط يحتاج يعرف لماذا';
  end if;
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if q.status not in ('معلّق', 'قيد المتابعة') then
    raise exception 'الطلب مغلق (الحالة: %)', q.status;
  end if;

  update public.broker_reservation_requests
     set status = 'مرفوض', handled_by = auth.uid(),
         handled_by_name = public.actor_display_name(),
         handled_at = now(), decision_note = v_reason
   where id = p_id;

  perform public.log_unit_event(q.unit_id, 'رفض طلب حجز', 'رُفض طلب الوسيط — ' || v_reason);

  perform public.notify_broker_company(q.company_id,
    'رُفض طلب الحجز',
    'الوحدة ' || coalesce(q.unit_code, '—') || ' — ' || v_reason,
    '/dashboard/broker/requests', p_id);
end; $fn$;

-- ===== (و) مرآة حالة الحجز على الطلب =====
create or replace function public.mirror_reservation_to_broker_request()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  update public.broker_reservation_requests
     set reservation_status = new.status
   where reservation_id = new.id
  returning * into q;

  if q.id is not null and new.status = 'ملغى' then
    perform public.notify_broker_company(q.company_id,
      'أُلغي حجز الوحدة',
      'الوحدة ' || coalesce(q.unit_code, '—') || ' — أُلغي الحجز وعادت متاحة',
      '/dashboard/broker/requests', q.id);
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_mirror_reservation_to_broker_request on public.reservations;
create trigger trg_mirror_reservation_to_broker_request
  after update of status on public.reservations
  for each row execute function public.mirror_reservation_to_broker_request();


-- ===== (ز) الوحدات كما يراها الوسيط =====
-- ⚠️ لا تُفتح سياسة units للوسيط: فيها الملاحظات الداخلية وسبب الإيقاف
--    والسمات الحرّة. هذه الدالّة تُرجع ما يحتاجه للبيع وحده.
drop function if exists public.broker_units();
create function public.broker_units()
returns table (
  id uuid, project_id uuid, project_name text, unit_code text, unit_type text,
  node_path text, space_m2 numeric, rooms integer, bathrooms integer,
  built_area_m2 numeric, land_area_m2 numeric, floors_count integer,
  parking_spaces integer, price numeric, price_per_m2 numeric, payment_plan text,
  availability text, my_request_id uuid
)
language sql stable security definer set search_path = public as $fn$
  with me as (select public.my_broker_company() as cid)
  select u.id, u.project_id, p.name, u.unit_code, u.unit_type, u.node_path,
         u.space_m2::numeric, u.rooms::integer, u.bathrooms::integer,
         u.built_area_m2::numeric, u.land_area_m2::numeric, u.floors_count::integer,
         u.parking_spaces::integer, u.price::numeric, u.price_per_m2::numeric, u.payment_plan,
         case
           when u.status = 'محجوزة'                   then 'محجوزة'
           when q.id is not null and q.company_id = me.cid then 'طلبكم قيد المتابعة'
           when q.id is not null                       then 'عليها طلب'
           else 'متاحة'
         end,
         case when q.company_id = me.cid then q.id end
    from me
    join public.broker_company_projects bcp on bcp.company_id = me.cid
    join public.units u    on u.project_id = bcp.project_id
    join public.projects p on p.id = u.project_id
    left join public.broker_reservation_requests q
           on q.unit_id = u.id and q.status in ('معلّق', 'قيد المتابعة')
   where me.cid is not null
     and u.status in ('متاحة', 'محجوزة')
     and (
       bcp.units_scope = 'الكل'
       or exists (select 1 from public.broker_visible_units v
                   where v.company_id = me.cid and v.unit_id = u.id)
     )
   order by p.name, u.node_path nulls last, u.unit_code;
$fn$;


-- ------------------------------------------------------------
-- 4) شرائح العمولة
-- ------------------------------------------------------------
-- «من الوحدة السادسة في الشهر تصير 1.5%» = صفٌّ min_units=6 rate=1.5
-- company_id فارغ = شرائح المشروع لكل الوسطاء.
create table if not exists public.broker_commission_tiers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  company_id uuid references public.broker_companies(id) on delete cascade,
  min_units  int  not null check (min_units > 0),
  rate       numeric(5,2) not null check (rate >= 0 and rate <= 100),
  created_at timestamptz not null default now()
);

create unique index if not exists bct_unique
  on public.broker_commission_tiers
  (project_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), min_units);

comment on table public.broker_commission_tiers is
  'شرائح عمولة الوسطاء: عدد وحدات الشركة في المشروع خلال الشهر ← النسبة، بأثر رجعي على صفقات الشهر كلّها (sql/117).';

alter table public.broker_commission_tiers enable row level security;

-- الوسيط يرى شرائح مشاريعه العامة وشرائحه الخاصة — لا شرائح غيره
drop policy if exists "read broker tiers" on public.broker_commission_tiers;
create policy "read broker tiers" on public.broker_commission_tiers
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      project_id in (select p.project_id from public.my_broker_projects() p)
      and (company_id is null or company_id = (select public.my_broker_company()))
    )
    or project_id in (
      select bcp.project_id from public.broker_company_projects bcp
       where bcp.rm_id = (select public.my_employee_id())
    )
  );

drop policy if exists "admins manage broker tiers" on public.broker_commission_tiers;
create policy "admins manage broker tiers" on public.broker_commission_tiers
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- نسبة الشركة في المشروع عند بلوغها n وحدة في الشهر.
-- شرائحها الخاصة إن وُجدت، وإلا شرائح المشروع، وإلا صفر.
create or replace function public.broker_tier_rate(p_company uuid, p_project uuid, p_units int)
returns numeric language sql stable security definer set search_path = public as $fn$
  with own as (
    select t.min_units, t.rate from public.broker_commission_tiers t
     where t.project_id = p_project and t.company_id = p_company
  ), proj as (
    select t.min_units, t.rate from public.broker_commission_tiers t
     where t.project_id = p_project and t.company_id is null
  ), eff as (
    select * from own
    union all
    select * from proj where not exists (select 1 from own)
  )
  select coalesce(
    (select e.rate from eff e where e.min_units <= greatest(p_units, 1)
      order by e.min_units desc limit 1),
    0
  );
$fn$;

-- سجلّ كل تعديل على عمولة بعد استحقاقها — «الفرق» الذي يراه الوسيط
create table if not exists public.broker_commission_adjustments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  commission_id  uuid not null references public.broker_commissions(id) on delete cascade,
  old_rate       numeric(5,2),
  new_rate       numeric(5,2),
  old_amount     numeric(16,2),
  new_amount     numeric(16,2),
  period_units   int,
  reason         text
);

create index if not exists bca_commission_idx on public.broker_commission_adjustments (commission_id, created_at);

alter table public.broker_commission_adjustments enable row level security;

drop policy if exists "read broker adjustments" on public.broker_commission_adjustments;
create policy "read broker adjustments" on public.broker_commission_adjustments
  for select to authenticated
  using (commission_id in (select bc.id from public.broker_commissions bc));
-- (يتبع نطاق broker_commissions نفسه. لا سياسة كتابة: الدوالّ وحدها تكتب.)

alter table public.broker_commissions
  add column if not exists tier_units      int,
  add column if not exists reversed_at     timestamptz,
  add column if not exists reversal_reason text;

comment on column public.broker_commissions.tier_units is
  'عدد وحدات الشركة في المشروع في شهر الصفقة عند آخر حساب — به عُرفت الشريحة (sql/117).';
comment on column public.broker_commissions.rate is
  'نسبة الشريحة التي بلغتها الشركة في شهر الصفقة. تكتبها recompute_broker_tier وحدها (sql/117).';

create index if not exists broker_commissions_bucket_idx
  on public.broker_commissions (company_id, project_id, earned_at)
  where reversed_at is null;

-- إعادة حساب دلوٍ واحد (شركة × مشروع × شهر)
create or replace function public.recompute_broker_tier(
  p_company uuid, p_project uuid, p_period text, p_reason text
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  n       int;
  v_rate  numeric(5,2);
  r       record;
  v_paid  numeric;
  v_new   numeric(16,2);
  v_up    numeric := 0;
  v_moved int := 0;
  v_from  date := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_to    date := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
begin
  select count(*) into n
    from public.broker_commissions bc
   where bc.company_id = p_company
     and bc.project_id is not distinct from p_project
     and bc.earned_at >= v_from and bc.earned_at < v_to
     and bc.reversed_at is null;

  v_rate := public.broker_tier_rate(p_company, p_project, n);

  for r in
    select * from public.broker_commissions bc
     where bc.company_id = p_company
       and bc.project_id is not distinct from p_project
       and bc.earned_at >= v_from and bc.earned_at < v_to
       and bc.reversed_at is null
     for update
  loop
    select coalesce(sum(bp.amount), 0) into v_paid
      from public.broker_payments bp where bp.commission_id = r.id;

    -- ⚠️ لا ينزل تحت المصروف — الصرف حركة نقدية مقيّدة
    v_new := greatest(round(coalesce(r.deal_amount, 0) * v_rate / 100, 2), v_paid);

    if v_new is distinct from r.amount or v_rate is distinct from r.rate then
      -- السطر الأول لعمولةٍ جديدة ليس «تعديلاً» — هو الاستحقاق نفسه
      if r.tier_units is not null then
        insert into public.broker_commission_adjustments
          (commission_id, old_rate, new_rate, old_amount, new_amount, period_units, reason)
        values (r.id, r.rate, v_rate, r.amount, v_new, n, p_reason);
        if v_new > r.amount then
          v_up := v_up + (v_new - r.amount);
          v_moved := v_moved + 1;
        end if;
      end if;
    end if;

    update public.broker_commissions
       set rate = v_rate, amount = v_new, tier_units = n
     where id = r.id
       and (rate is distinct from v_rate or amount is distinct from v_new
            or tier_units is distinct from n);
  end loop;

  -- ارتفعت الشريحة فارتفعت صفقاتٌ سابقة: يعرف الوسيط بالفرق
  if v_up > 0 then
    perform public.notify_broker_company(p_company,
      'ارتفعت شريحتكم إلى ' || trim_scale(v_rate) || '٪ 🎯',
      'بلغتم ' || n || ' وحدة في ' || coalesce((select pr.name from public.projects pr where pr.id = p_project), 'المشروع')
        || ' هذا الشهر — أُضيف ' || public.fmt_qty(v_up) || ' د.ع على ' || v_moved || ' صفقة سابقة.',
      '/dashboard/broker/commissions', null);
  end if;
end; $fn$;

-- سعر الصفقة الذي تُحسب منه عمولة الوسيط: سعر البيع إن أُدخل، وإلا سعر الوحدة
create or replace function public.broker_deal_price(p_res uuid)
returns numeric language sql stable security definer set search_path = public as $fn$
  select coalesce(nullif(r.sale_price, 0), u.price, 0)
    from public.reservations r
    left join public.units u on u.id = r.unit_id
   where r.id = p_res;
$fn$;

-- الاستحقاق عند إتمام البيع — يحلّ محلّ نسخة 043/107
create or replace function public.post_broker_commission()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid;
  v_project uuid;
  v_client  text;
  v_comm    uuid;
  v_price   numeric(16,2);
  v_amount  numeric(16,2);
  v_rate    numeric(5,2);
  v_today   date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if new.status <> 'بيع مكتمل' then
    return new;
  end if;

  if exists (select 1 from public.broker_commissions bc
              where bc.reservation_id = new.id) then
    return new;
  end if;

  -- الشركة: صاحبة طلب الحجز إن جاء منه، وإلا صاحبة الليد
  select q.company_id into v_company
    from public.broker_reservation_requests q
   where q.reservation_id = new.id
   limit 1;

  select coalesce(v_company, c.broker_company_id), c.name
    into v_company, v_client
    from public.clients c where c.id = new.client_id;

  if v_company is null then
    return new;                       -- ليد تلال نفسها: لا عمولة وساطة
  end if;

  select u.project_id into v_project from public.units u where u.id = new.unit_id;
  v_price := public.broker_deal_price(new.id);

  insert into public.broker_commissions
    (company_id, client_id, unit_id, reservation_id, project_id,
     deal_amount, rate, amount, earned_at, notes)
  values (v_company, new.client_id, new.unit_id, new.id, v_project,
          coalesce(v_price, 0), 0, 0, v_today,
          'استحقاق تلقائي عند إتمام البيع')
  returning id into v_comm;

  perform public.recompute_broker_tier(v_company, v_project, to_char(v_today, 'YYYY-MM'),
                                       'صفقة جديدة رفعت عدد الشهر');

  select bc.amount, bc.rate into v_amount, v_rate
    from public.broker_commissions bc where bc.id = v_comm;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select bu.user_id,
         'عمولة مستحقة لكم 🎉',
         'إتمام بيع للعميل ' || coalesce(v_client, '') || ' — ' || trim_scale(v_rate) || '٪ = '
           || public.fmt_qty(v_amount) || ' د.ع',
         '/dashboard/broker/commissions', 'عمولة', v_comm
    from public.broker_users bu where bu.company_id = v_company and bu.is_active;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         case when v_rate = 0 then 'عمولة وساطة بلا شريحة ⚠️' else 'عمولة وساطة مستحقة' end,
         (select bcm.name from public.broker_companies bcm where bcm.id = v_company)
           || ' — ' || public.fmt_qty(v_amount) || ' د.ع'
           || case when v_rate = 0 then ' — لا شرائح عمولة لهذا المشروع، عرّفها ثم أعد الحساب' else '' end,
         '/dashboard/brokers/' || v_company, 'عمولة', v_comm
    from public.profiles p where p.role = 'admin';

  return new;
end; $fn$;

-- سعر البيع يُدخل عادةً عند تأكيد المقدمة — بعد الاستحقاق. تتبعه العمولة.
create or replace function public.sync_broker_deal_price()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare bc public.broker_commissions%rowtype;
begin
  if new.sale_price is not distinct from old.sale_price then
    return null;
  end if;

  select * into bc from public.broker_commissions
   where reservation_id = new.id and reversed_at is null;
  if not found then
    return null;
  end if;

  update public.broker_commissions
     set deal_amount = public.broker_deal_price(new.id)
   where id = bc.id;

  perform public.recompute_broker_tier(bc.company_id, bc.project_id,
                                       to_char(bc.earned_at, 'YYYY-MM'),
                                       'أُدخل سعر البيع الفعلي');
  return null;
end; $fn$;

drop trigger if exists trg_sync_broker_deal_price on public.reservations;
create trigger trg_sync_broker_deal_price
  after update of sale_price on public.reservations
  for each row execute function public.sync_broker_deal_price();

-- زرّ «أعد الحساب» للمدير — بعد تعريف شرائح لمشروع أو تعديلها
create or replace function public.recalc_broker_commissions(
  p_company uuid default null, p_project uuid default null, p_period text default null
)
returns integer language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  if not public.is_admin() then
    raise exception 'إعادة حساب العمولات للمدير';
  end if;
  if p_period is not null and p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة الشهر YYYY-MM';
  end if;

  for r in
    select distinct bc.company_id, bc.project_id, to_char(bc.earned_at, 'YYYY-MM') as period
      from public.broker_commissions bc
     where bc.reversed_at is null
       and (p_company is null or bc.company_id = p_company)
       and (p_project is null or bc.project_id = p_project)
       and (p_period  is null or to_char(bc.earned_at, 'YYYY-MM') = p_period)
  loop
    perform public.recompute_broker_tier(r.company_id, r.project_id, r.period,
                                         'إعادة حساب يدوية بعد تعديل الشرائح');
    n := n + 1;
  end loop;
  return n;
end; $fn$;


-- ------------------------------------------------------------
-- 5) فسخ البيع يعكس عمولة الوسيط — نصّ 113 + كتلة الوسيط
-- ------------------------------------------------------------
create or replace function public.reverse_sale(p_res uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  c public.commissions%rowtype; pr public.payrolls%rowtype;
  bk public.broker_commissions%rowtype;
  v_unit text; v_rev uuid; v_recv uuid; v_entry uuid;
  v_emp_action text := 'لا عمولة موظف';
  v_co_action  text := 'لا عمولة شركة';
  v_bk_action  text := 'لا عمولة وسيط';
begin
  if not public.is_admin() then
    raise exception 'فسخ البيع للمدير';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'اكتب سبب الفسخ';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status <> 'بيع مكتمل' then
    raise exception 'لا يُفسخ إلا بيع مكتمل (الحالة: %)', r.status;
  end if;

  select coalesce(u.unit_code,'') into v_unit from public.units u where u.id = r.unit_id;
  select * into sc from public.sale_commissions where reservation_id = p_res;

  -- ===== عمولة الوسيط (117) — تُفحص أولاً لأنها قد تمنع الفسخ =====
  select * into bk from public.broker_commissions
   where reservation_id = p_res and reversed_at is null;
  if bk.id is not null and exists (select 1 from public.broker_payments bp where bp.commission_id = bk.id) then
    raise exception 'صُرف للوسيط من عمولة هذه الصفقة — استرداده حركةٌ نقدية تُسجَّل قبل الفسخ';
  end if;

  -- ===== عمولة الشركة =====
  if sc.id is not null and coalesce(sc.company_amount,0) > 0 then
    if sc.collected_at is not null then
      raise exception 'عمولة الشركة عن هذه الصفقة محصّلة في % — ردّها للمطوّر حركةٌ نقدية يسجّلها المدير قبل الفسخ',
        sc.collected_at::text;
    end if;

    if r.commission_accrual_entry_id is not null then
      select id into v_rev  from public.accounts where code = '4200';
      select id into v_recv from public.accounts where code = '1250';
      if v_rev is not null and v_recv is not null then
        insert into public.journal_entries (entry_date, description, reference, arm, source)
        values ((now() at time zone 'Asia/Baghdad')::date,
                'عكس عمولة صفقة مفسوخة — الوحدة ' || v_unit || ' — ' || btrim(p_reason),
                'COMMREV', 'إداري عام', 'reservations')
        returning id into v_entry;

        insert into public.journal_lines (entry_id, account_id, debit, credit)
        values (v_entry, v_rev,  sc.company_amount, 0),
               (v_entry, v_recv, 0,                sc.company_amount);

        update public.reservations set commission_reversal_entry_id = v_entry where id = p_res;

        v_co_action := 'عُكس استحقاق ' || public.fmt_qty(sc.company_amount) || ' د.ع';
      end if;
    end if;
  end if;

  -- ===== عمولة الموظف =====
  if sc.commission_id is not null then
    select * into c from public.commissions where id = sc.commission_id;

    if c.id is null then
      v_emp_action := 'العمولة محذوفة سلفاً';

    elsif c.payroll_id is null then
      delete from public.commissions where id = c.id;
      v_emp_action := 'حُذفت عمولة ' || public.fmt_qty(c.amount) || ' د.ع';

    else
      select * into pr from public.payrolls where id = c.payroll_id;

      if pr.state = 'مسودة' then
        delete from public.payroll_lines
         where payroll_id = pr.id and source_table = 'commissions' and source_id = c.id;
        delete from public.commissions where id = c.id;
        perform public.refresh_payroll_totals(pr.id);
        v_emp_action := 'أُزيلت من كشف ' || pr.period || ' المسوّدة';

      else
        insert into public.deductions
          (employee_id, amount, ded_date, reason, created_by, created_by_name)
        values (c.employee_id, c.amount,
                (now() at time zone 'Asia/Baghdad')::date,
                'استرداد عمولة صفقة مفسوخة — الوحدة ' || v_unit,
                auth.uid(),
                (select coalesce(e.full_name, p.email) from public.profiles p
                   left join public.employees e on e.user_id = p.id where p.id = auth.uid()));

        v_emp_action := 'كشف ' || pr.period || ' ' || pr.state ||
                        ' — أُنشئ استرداد ' || public.fmt_qty(c.amount) || ' د.ع للكشف القادم';
      end if;
    end if;
  end if;

  -- ===== عمولة الوسيط: تُصفَّر وتخرج من عدّ شهرها =====
  if bk.id is not null then
    insert into public.broker_commission_adjustments
      (commission_id, old_rate, new_rate, old_amount, new_amount, period_units, reason)
    values (bk.id, bk.rate, 0, bk.amount, 0, null, 'فسخ البيع — ' || btrim(p_reason));

    update public.broker_commissions
       set reversed_at = now(), reversal_reason = btrim(p_reason), amount = 0
     where id = bk.id;

    -- خروجها قد يُنزل شريحة بقية صفقات الشهر (ولا ينزل أيٌّ تحت مصروفه)
    perform public.recompute_broker_tier(bk.company_id, bk.project_id,
                                         to_char(bk.earned_at, 'YYYY-MM'),
                                         'فسخ صفقة في الشهر نفسه');

    v_bk_action := 'أُلغيت عمولة ' || public.fmt_qty(bk.amount) || ' د.ع وأُعيد حساب شريحة الشهر';
  end if;

  if sc.id is not null then
    update public.sale_commissions
       set reversed_at = now(), reversal_reason = btrim(p_reason)
     where id = sc.id;
  end if;

  update public.invoices
     set cancelled_at = now(), cancel_reason = btrim(p_reason)
   where reservation_id = p_res and cancelled_at is null;

  update public.reservations
     set status = 'ملغى',
         notes = coalesce(notes || E'\n','') || 'فُسخ البيع: ' || btrim(p_reason)
   where id = p_res;

  perform public.log_unit_event(r.unit_id, 'إلغاء حجز',
    'فُسخ بيع الوحدة ' || v_unit || ' — ' || btrim(p_reason));

  return jsonb_build_object(
    'unit', v_unit, 'company', v_co_action, 'employee', v_emp_action,
    'broker', v_bk_action, 'reversal_entry_id', v_entry);
end;
$fn$;


-- ------------------------------------------------------------
-- 6) الليد في منتصف صفقة لا يعود إلى تلال
-- ------------------------------------------------------------
create or replace function public.broker_lead_in_deal(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.reservations rs
                  where rs.client_id = p_client and rs.status in ('حجز', 'بيع مكتمل'))
      or exists (select 1 from public.broker_reservation_requests q
                  where q.client_id = p_client and q.status in ('معلّق', 'قيد المتابعة'));
$fn$;

create or replace function public.return_expired_broker_leads()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  r       record;
  n       integer := 0;
  v_days  integer;
begin
  for r in
    select c.id, c.name, c.broker_company_id, bc.name as company_name
      from public.clients c
      join public.broker_companies bc on bc.id = c.broker_company_id
     where c.broker_company_id is not null
       and c.broker_deadline is not null
       and c.broker_deadline < v_today
       and coalesce(c.stage, 'ليد') <> 'بيع'
       and not public.broker_lead_in_deal(c.id)          -- 117
  loop
    update public.clients
       set broker_company_id = null,
           returned_at       = now(),
           returned_from     = r.broker_company_id
     where id = r.id;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select bu.user_id,
           'انتهت مهلة الليد: ' || r.name,
           'مضى ' || public.broker_lead_days() || ' يوماً بلا إغلاق، فعاد الليد إلى تلال.',
           '/dashboard/broker/leads', 'ليد', r.id
      from public.broker_users bu where bu.company_id = r.broker_company_id;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select distinct e.user_id,
           'عاد ليد إلى تلال: ' || r.name,
           'من ' || r.company_name || ' — انتهت المهلة بلا إغلاق.',
           '/dashboard/brokers/leads', 'ليد', r.id
      from public.broker_company_projects bcp
      join public.employees e on e.id = bcp.rm_id
     where bcp.company_id = r.broker_company_id and e.user_id is not null;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select p.id,
           'ليد عاد لتلال للتوزيع: ' || r.name,
           'من ' || r.company_name || ' — انتهت مهلة ' || public.broker_lead_days() || ' يوماً.',
           '/dashboard/brokers/leads', 'ليد', r.id
      from public.profiles p where p.role = 'admin';

    n := n + 1;
  end loop;

  for r in
    select c.id, c.name, c.broker_company_id, (c.broker_deadline - v_today) as days_left
      from public.clients c
     where c.broker_company_id is not null
       and c.broker_deadline is not null
       and (c.broker_deadline - v_today) in (3, 1)
       and coalesce(c.stage, 'ليد') <> 'بيع'
       and not public.broker_lead_in_deal(c.id)          -- 117
  loop
    v_days := r.days_left;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select bu.user_id,
           'باقٍ ' || v_days || case when v_days = 1 then ' يوم' else ' أيام' end || ' على ليد: ' || r.name,
           'أغلق الصفقة قبل انتهاء المهلة وإلا عاد الليد إلى تلال.',
           '/dashboard/broker/leads', 'ليد', r.id
      from public.broker_users bu where bu.company_id = r.broker_company_id;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select distinct e.user_id,
           'ليد يقترب من انتهاء مهلته: ' || r.name,
           'باقٍ ' || v_days || case when v_days = 1 then ' يوم' else ' أيام' end || '.',
           '/dashboard/brokers/leads', 'ليد', r.id
      from public.broker_company_projects bcp
      join public.employees e on e.id = bcp.rm_id
     where bcp.company_id = r.broker_company_id and e.user_id is not null;
  end loop;

  return n;
end; $fn$;


-- ------------------------------------------------------------
-- 7) الصلاحيات على الجداول القائمة
-- ------------------------------------------------------------
-- الحجز: كل مسجَّل دخول **عدا الوسيط** — طريقه طلب الحجز
drop policy if exists "authenticated can insert reservations" on public.reservations;
create policy "authenticated can insert reservations" on public.reservations
  for insert to authenticated
  with check (not (select public.is_broker()));

-- مدير العلاقات يتابع حجوزات ليدات شركاته حتى البيع
drop policy if exists "read reservations in scope" on public.reservations;
create policy "read reservations in scope" on public.reservations
  for select to authenticated
  using (
    (select public.is_admin())
    or public.can_see_client(client_id)
    or ((select public.is_rm()) and public.can_see_broker_lead(client_id))
  );

-- ومدير العلاقات يرى وحدات المشاريع التي يتابع فيها شركات
drop policy if exists "read units in scope" on public.units;
create policy "read units in scope" on public.units
  for select to authenticated
  using (
    case
      when (select public.is_broker()) then false
      else (
        (select public.is_admin())
        or (select public.can_read_all_crm())
        or project_id is null
        or project_id in (select m.id from public.my_project_ids() m(id))
        or exists (select 1 from public.projects p
                    where p.id = units.project_id and p.supervisor_id is null)
        or project_id in (select bcp.project_id from public.broker_company_projects bcp
                           where bcp.rm_id = (select public.my_employee_id()))
      )
    end
  );


-- ------------------------------------------------------------
-- 8) المنح — منذ 054 تخرج كل دالّة بلا منحة
-- ------------------------------------------------------------
revoke execute on function public.broker_unit_visible(uuid, uuid)                     from public, anon;
revoke execute on function public.can_handle_broker_request(uuid)                     from public, anon;
revoke execute on function public.actor_display_name()                                from public, anon;
revoke execute on function public.notify_broker_request_handlers(uuid, text, text)    from public, anon, authenticated;
revoke execute on function public.notify_broker_company(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.broker_request_reservation(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.broker_cancel_reservation_request(uuid)             from public, anon;
revoke execute on function public.broker_request_take(uuid)                           from public, anon;
revoke execute on function public.broker_request_confirm(uuid, numeric, date, text)   from public, anon;
revoke execute on function public.broker_request_reject(uuid, text)                   from public, anon;
revoke execute on function public.broker_units()                                      from public, anon;
revoke execute on function public.broker_tier_rate(uuid, uuid, int)                   from public, anon;
revoke execute on function public.recompute_broker_tier(uuid, uuid, text, text)       from public, anon, authenticated;
revoke execute on function public.broker_deal_price(uuid)                             from public, anon, authenticated;
revoke execute on function public.recalc_broker_commissions(uuid, uuid, text)         from public, anon;
revoke execute on function public.broker_lead_in_deal(uuid)                           from public, anon, authenticated;

grant execute on function public.broker_unit_visible(uuid, uuid)                     to authenticated;
grant execute on function public.can_handle_broker_request(uuid)                     to authenticated;
grant execute on function public.actor_display_name()                                to authenticated;
grant execute on function public.broker_request_reservation(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.broker_cancel_reservation_request(uuid)             to authenticated;
grant execute on function public.broker_request_take(uuid)                           to authenticated;
grant execute on function public.broker_request_confirm(uuid, numeric, date, text)   to authenticated;
grant execute on function public.broker_request_reject(uuid, text)                   to authenticated;
grant execute on function public.broker_units()                                      to authenticated;
grant execute on function public.broker_tier_rate(uuid, uuid, int)                   to authenticated;
grant execute on function public.recalc_broker_commissions(uuid, uuid, text)         to authenticated;

-- ------------------------------------------------------------
-- 9) نسبة الشركة القديمة تصير شرائح مشروعها
-- ------------------------------------------------------------
-- commission_rate يبقى عموداً (لا يُقرأ بعد اليوم) ولا يُحذف: حذفه يكسر
-- 043 لو أُعيد تشغيلها. وكل إسنادٍ قائم يرث نسبة شركته شريحةً خاصةً
-- من الوحدة الأولى — فلا تصير عمولة شركةٍ قائمة صفراً بصمت.
insert into public.broker_commission_tiers (project_id, company_id, min_units, rate)
select bcp.project_id, bcp.company_id, 1, bc.commission_rate
  from public.broker_company_projects bcp
  join public.broker_companies bc on bc.id = bcp.company_id
 where bc.commission_rate > 0
on conflict do nothing;

comment on column public.broker_companies.commission_rate is
  'متقاعد منذ sql/117 — العمولة من broker_commission_tiers. نُقل إلى شريحة خاصة لكل إسناد قائم.';

notify pgrst, 'reload schema';
