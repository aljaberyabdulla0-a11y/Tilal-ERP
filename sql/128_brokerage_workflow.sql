-- ============================================================
-- تلال ERP — 128: مسار طلب الوسيط — مراجعة الـRM، قرار المشرف، الخطّ الزمني، قفل الوحدة، قناة البيع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- التصميم الكامل: docs/BROKERAGE_V2_DESIGN.md (الأقسام D–H).
--
-- ===== تغيّرات على قواعد قائمة (موثّقة قبل التنفيذ) =====
--
--   ١) الـRM لم يعد يؤكّد الحجز ولا يرفضه (117). يستلم ويراجع ويوصي ويطلب
--      معلومات؛ و**الموافقة والرفض لمشرف المشروع أو الإدارة** —
--      can_manage_project()، نفس من يوافق على البيع في decide_unit_sale.
--      الـRM الذي هو مشرف المشروع نفسه يوافق بصفته مشرفاً.
--   ٢) مدير العلاقات علاقةٌ لا دور: من له rm_id في إسناد. القاعدة الحيّة
--      ليس فيها أحد بدور relationship_manager، فكانت سياسة الحجوزات
--      (is_rm()) والشاشات تُخفي عن الخمسة شركاتهم.
--   ٣) الطلب المفتوح يقفل الوحدة على **الجميع** (لا الوسطاء وحدهم)، وينتهي
--      بعد ٧٢ ساعة بلا قرار (project_broker_settings، وفارغ = لا انتهاء).
--   ٤) حجزٌ نشط واحد لكل وحدة — فهرس فريد وقفل صفّ، لا فحصٌ بلا قفل.
--
-- ===== باقٍ كما هو =====
--   الوسيط لا يقرأ units ولا reservations؛ الليد ٣٠ يوماً؛ صفقة ليد الوسيط
--   له حتى لو حجزها موظف (القناة = من جلب العميل).
--
-- ===== التراجع =====
--   الأعمدة والجداول الجديدة لا تمسّ قيماً قديمة. لإعادة 117: أعد تشغيل
--   أقسام الدوالّ والسياسات من sql/117، واحذف المحفّزات trg_a_* و
--   trg_brr_* و trg_guard_sale_channel، والفهرس reservations_one_active_per_unit.
--
-- يتطلب: 043، 044، 050، 088، 104، 117. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 0) إصلاحان صغيران
-- ------------------------------------------------------------
-- زرّ «تشغيل الفحص الآن»: 088 نزع المنحة فتعطّل الزرّ. الدالّة تفحص
-- is_admin() بنفسها، فالمنحة آمنة (نفس ما فعلته 088 مع run_crm_followup_scan).
grant execute on function public.run_broker_lead_scan() to authenticated;


-- ------------------------------------------------------------
-- 1) النطاق: مدير العلاقات علاقة، والمشرف علاقة
-- ------------------------------------------------------------
create or replace function public.is_broker_rm()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_rm()
      or exists (select 1 from public.broker_company_projects bcp
                  where bcp.rm_id is not null and bcp.rm_id = public.my_employee_id());
$fn$;

-- مشرفٌ على مشروعٍ فيه شركات وسيطة
create or replace function public.is_broker_supervisor()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.my_supervised_projects() s
                   join public.broker_company_projects bcp on bcp.project_id = s.id);
$fn$;

-- ما تحتاجه الواجهة لتقرّر ما تعرض (العرض وحده — الحماية في السياسات)
create or replace function public.my_broker_scope()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'admin',      public.is_admin(),
    'rm',         public.is_broker_rm(),
    'supervisor', public.is_broker_supervisor(),
    'broker',     public.my_broker_company() is not null
  );
$fn$;

-- الحالات المفتوحة — تقفل الوحدة. ⚠️ الفهرس الجزئي أدناه يكرّرها حرفياً
-- (الفهرس لا يقبل دالّة غير ثابتة)؛ غيّرهما معاً.
create or replace function public.broker_request_is_open(p_status text)
returns boolean language sql immutable as $fn$
  select p_status in ('معلّق', 'قيد المتابعة', 'بحاجة لمعلومات', 'بانتظار المشرف');
$fn$;


-- ------------------------------------------------------------
-- 2) إعدادات المسار لكل مشروع
-- ------------------------------------------------------------
create table if not exists public.project_broker_settings (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  request_ttl_hours int default 72 check (request_ttl_hours is null or request_ttl_hours > 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null
);

comment on table public.project_broker_settings is
  'إعدادات مسار طلب الوسيط لكل مشروع. لا صفّ = الافتراضي (٧٢ ساعة). request_ttl_hours فارغ = الطلب لا ينتهي (sql/128).';

alter table public.project_broker_settings enable row level security;

drop policy if exists "read project broker settings" on public.project_broker_settings;
create policy "read project broker settings" on public.project_broker_settings
  for select to authenticated using (not (select public.is_broker()));

drop policy if exists "admins manage project broker settings" on public.project_broker_settings;
create policy "admins manage project broker settings" on public.project_broker_settings
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.broker_request_ttl(p_project uuid)
returns int language sql stable security definer set search_path = public as $fn$
  select case when s.project_id is null then 72 else s.request_ttl_hours end
    from (select 1) one
    left join public.project_broker_settings s on s.project_id = p_project;
$fn$;


-- ------------------------------------------------------------
-- 3) الطلب: لقطات، مراجعة، قرار، مهلة
-- ------------------------------------------------------------
alter table public.broker_reservation_requests
  add column if not exists supervisor_id       uuid references public.employees(id) on delete set null,
  add column if not exists client_name         text,
  add column if not exists client_phone        text,
  add column if not exists requested_price     numeric,
  add column if not exists payment_plan        text,
  add column if not exists rm_recommendation   text,
  add column if not exists rm_review_note      text,
  add column if not exists rm_reviewed_at      timestamptz,
  add column if not exists rm_reviewed_by      uuid references auth.users(id) on delete set null,
  add column if not exists rm_reviewed_by_name text,
  add column if not exists info_request        text,
  add column if not exists info_response       text,
  add column if not exists decided_at          timestamptz,
  add column if not exists decided_by          uuid references auth.users(id) on delete set null,
  add column if not exists decided_by_name     text,
  add column if not exists expires_at          timestamptz,
  add column if not exists expiry_warned_at    timestamptz,
  add column if not exists status_changed_at   timestamptz;

comment on column public.broker_reservation_requests.supervisor_id is
  'مشرف المشروع يوم الطلب — يُختم في القاعدة. صلاحية القرار تتبع المشرف **الحالي** للمشروع (sql/128).';
comment on column public.broker_reservation_requests.client_name is
  'لقطة اسم العميل: المشرف قد لا يقرأ بطاقة ليدٍ لوسيط، ويحتاج الاسم في القائمة (sql/128).';
comment on column public.broker_reservation_requests.decided_by is
  'صاحب القرار النهائي (موافقة/رفض/سحب/انتهاء). handled_by يبقى «من استلم» (sql/128).';

alter table public.broker_reservation_requests drop constraint if exists brr_requested_price_chk;
alter table public.broker_reservation_requests
  add constraint brr_requested_price_chk check (requested_price is null or requested_price > 0);

alter table public.broker_reservation_requests drop constraint if exists brr_recommendation_chk;
alter table public.broker_reservation_requests
  add constraint brr_recommendation_chk
  check (rm_recommendation is null or rm_recommendation in ('أوصي بالموافقة', 'أوصي بالرفض', 'بلا توصية'));

alter table public.broker_reservation_requests drop constraint if exists brr_status_chk;
alter table public.broker_reservation_requests
  add constraint brr_status_chk check (status in (
    'معلّق', 'قيد المتابعة', 'بحاجة لمعلومات', 'بانتظار المشرف',
    'تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز', 'مرفوض', 'ملغى', 'منتهي'));

-- وحدةٌ واحدة = طلبٌ مفتوح واحد (⚠️ نفس قائمة broker_request_is_open)
drop index if exists public.brr_one_open_per_unit;
create unique index brr_one_open_per_unit
  on public.broker_reservation_requests (unit_id)
  where status in ('معلّق', 'قيد المتابعة', 'بحاجة لمعلومات', 'بانتظار المشرف');

create index if not exists brr_supervisor_idx on public.broker_reservation_requests (supervisor_id, status);
create index if not exists brr_project_idx    on public.broker_reservation_requests (project_id, status);
create index if not exists brr_expiry_idx     on public.broker_reservation_requests (expires_at)
  where status in ('معلّق', 'قيد المتابعة', 'بحاجة لمعلومات', 'بانتظار المشرف');

-- ملءٌ رجعي: المشرف واللقطات وصاحب القرار
update public.broker_reservation_requests q
   set supervisor_id = coalesce(q.supervisor_id, p.supervisor_id)
  from public.projects p
 where p.id = q.project_id and q.supervisor_id is null;

update public.broker_reservation_requests q
   set client_name  = coalesce(q.client_name, c.name),
       client_phone = coalesce(q.client_phone, c.phone)
  from public.clients c
 where c.id = q.client_id and q.client_name is null;

update public.broker_reservation_requests
   set decided_at = handled_at, decided_by = handled_by, decided_by_name = handled_by_name
 where status in ('تمّ الحجز', 'مرفوض', 'ملغى') and decided_at is null;

update public.broker_reservation_requests
   set status_changed_at = coalesce(handled_at, created_at)
 where status_changed_at is null;

-- الطلبات المؤكَّدة قديماً تتبع حالة حجزها
update public.broker_reservation_requests
   set status = case reservation_status when 'بيع مكتمل' then 'تمّ البيع' else 'أُلغي الحجز' end
 where status = 'تمّ الحجز' and reservation_status in ('بيع مكتمل', 'ملغى');


-- ------------------------------------------------------------
-- 4) من يرى، من يتابع، من يقرّر
-- ------------------------------------------------------------
create or replace function public.can_view_broker_request(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.broker_reservation_requests q
     where q.id = p_id
       and (
         public.is_admin()
         or q.company_id = public.my_broker_company()
         or (q.rm_id is not null and q.rm_id = public.my_employee_id())
         or q.company_id in (select m.company_id from public.my_rm_companies() m)
         or (q.supervisor_id is not null and q.supervisor_id = public.my_employee_id())
         or (q.project_id is not null and q.project_id in (select s.id from public.my_supervised_projects() s))
         or (q.project_id is not null and public.can_manage_project(q.project_id))
       )
  );
$fn$;

-- المتابعة (استلام، سؤال، ملاحظة): الـRM المسؤول، والمشرف، والإدارة
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

-- القرار (موافقة = حجز، رفض): المشرف الحالي للمشروع أو الإدارة
create or replace function public.can_approve_broker_request(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.broker_reservation_requests q
     where q.id = p_id
       and (public.is_admin()
            or (q.project_id is not null and public.can_manage_project(q.project_id)))
  );
$fn$;

drop policy if exists "read broker reservation requests" on public.broker_reservation_requests;
create policy "read broker reservation requests" on public.broker_reservation_requests
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or rm_id = (select public.my_employee_id())
    or company_id in (select m.company_id from public.my_rm_companies() m)
    or supervisor_id = (select public.my_employee_id())
    or project_id in (select s.id from public.my_supervised_projects() s)
    or (project_id is not null and (select public.can_manage_project(broker_reservation_requests.project_id)))
  );

-- المشرف يرى أسماء الشركات العاملة في مشاريعه وإسناداتها (لقائمة الطلبات)
drop policy if exists "read broker companies" on public.broker_companies;
create policy "read broker companies" on public.broker_companies
  for select to authenticated
  using (
    (select public.is_admin())
    or id = (select public.my_broker_company())
    or id in (select m.company_id from public.my_rm_companies() m)
    or id in (select bcp.company_id from public.broker_company_projects bcp
               where bcp.project_id in (select s.id from public.my_supervised_projects() s))
  );

drop policy if exists "read broker projects" on public.broker_company_projects;
create policy "read broker projects" on public.broker_company_projects
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or rm_id = (select public.my_employee_id())
    or project_id in (select s.id from public.my_supervised_projects() s)
  );

-- الحجوزات: الـRM يتابع حجوزات ليدات شركاته **بالعلاقة** لا بالدور.
-- الوسيط مستثنى صراحةً — can_see_broker_lead صحيحة له على ليداته.
drop policy if exists "read reservations in scope" on public.reservations;
create policy "read reservations in scope" on public.reservations
  for select to authenticated
  using (
    (select public.is_admin())
    or public.can_see_client(client_id)
    or (not (select public.is_broker()) and public.can_see_broker_lead(client_id))
  );


-- ------------------------------------------------------------
-- 5) الخطّ الزمني
-- ------------------------------------------------------------
create table if not exists public.broker_request_events (
  id                bigint generated always as identity primary key,
  request_id        uuid not null references public.broker_reservation_requests(id) on delete cascade,
  at                timestamptz not null default now(),
  actor             uuid references auth.users(id) on delete set null,
  actor_name        text,
  actor_role        text,
  action            text not null,
  old_status        text,
  new_status        text,
  note              text,
  visible_to_broker boolean not null default true
);

create index if not exists bre_request_idx on public.broker_request_events (request_id, at);

comment on table public.broker_request_events is
  'الخطّ الزمني لطلب الحجز: كل تغيير حالة يسجّله محفّز فلا يفلت انتقال، والدوالّ تضيف الإشعارات والملاحظات والتوصيات. visible_to_broker = false للداخلي (sql/128).';

alter table public.broker_request_events enable row level security;

drop policy if exists "read broker request events" on public.broker_request_events;
create policy "read broker request events" on public.broker_request_events
  for select to authenticated
  using (
    public.can_view_broker_request(request_id)
    and (visible_to_broker or not (select public.is_broker()))
  );
-- لا سياسة كتابة: الدوالّ والمحفّزات وحدها تكتب.

create or replace function public.broker_actor_role(p_project uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select case
    when auth.uid() is null                       then 'النظام'
    when public.my_broker_company() is not null   then 'وسيط'
    when public.is_admin()                        then 'الإدارة'
    when p_project is not null
         and public.can_manage_project(p_project) then 'مشرف المشروع'
    when public.is_broker_rm()                    then 'مدير العلاقات'
    else 'موظف'
  end;
$fn$;

create or replace function public.log_broker_request_event(
  p_request uuid, p_action text, p_note text default null,
  p_visible boolean default true, p_old text default null, p_new text default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_project uuid;
begin
  select project_id into v_project from public.broker_reservation_requests where id = p_request;
  insert into public.broker_request_events
    (request_id, actor, actor_name, actor_role, action, old_status, new_status, note, visible_to_broker)
  values (p_request, auth.uid(),
          case when auth.uid() is null then 'النظام' else public.actor_display_name() end,
          public.broker_actor_role(v_project),
          p_action, p_old, p_new, nullif(btrim(coalesce(p_note, '')), ''), p_visible);
end; $fn$;

-- الدوالّ تمرّر الفعل والملاحظة قبل التحديث؛ والمحفّز يقرؤهما ثم يمسحهما
-- فلا يرثهما تحديثٌ لاحق في المعاملة نفسها.
create or replace function public.brr_set_event(p_action text, p_note text default null, p_internal boolean default false)
returns void language plpgsql as $fn$
begin
  perform set_config('tilal.brr_action',   coalesce(p_action, ''), true);
  perform set_config('tilal.brr_note',     coalesce(p_note, ''), true);
  perform set_config('tilal.brr_internal', case when p_internal then 'on' else '' end, true);
end; $fn$;

create or replace function public.brr_stamp_status_change()
returns trigger language plpgsql as $fn$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_brr_stamp_status_change on public.broker_reservation_requests;
create trigger trg_brr_stamp_status_change
  before update of status on public.broker_reservation_requests
  for each row execute function public.brr_stamp_status_change();

create or replace function public.brr_log_status_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_action text := nullif(current_setting('tilal.brr_action', true), '');
  v_note   text := nullif(current_setting('tilal.brr_note', true), '');
  v_int    boolean := coalesce(current_setting('tilal.brr_internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    perform public.log_broker_request_event(new.id, 'رفع الطلب', new.note, true, null, new.status);
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.log_broker_request_event(new.id, coalesce(v_action, 'تغيّر الحالة'), v_note,
                                            not v_int, old.status, new.status);
    perform public.brr_set_event(null);
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_brr_log_status_change on public.broker_reservation_requests;
create trigger trg_brr_log_status_change
  after insert or update of status on public.broker_reservation_requests
  for each row execute function public.brr_log_status_change();

-- ملءٌ رجعي للطلبات القائمة: رفعها وقرارها
insert into public.broker_request_events
  (request_id, at, actor, actor_name, actor_role, action, old_status, new_status, note)
select q.id, q.created_at, q.requested_by, q.requested_by_name, 'وسيط', 'رفع الطلب', null, 'معلّق', q.note
  from public.broker_reservation_requests q
 where not exists (select 1 from public.broker_request_events e where e.request_id = q.id);

insert into public.broker_request_events
  (request_id, at, actor, actor_name, actor_role, action, old_status, new_status, note)
select q.id, q.decided_at, q.decided_by, q.decided_by_name, 'سجلّ سابق',
       case q.status when 'مرفوض' then 'رفض' when 'ملغى' then 'سحب الوسيط' else 'تأكيد الحجز' end,
       'معلّق', q.status, q.decision_note
  from public.broker_reservation_requests q
 where q.decided_at is not null
   and (select count(*) from public.broker_request_events e where e.request_id = q.id) = 1;


-- ------------------------------------------------------------
-- 6) الإشعارات — قالبٌ واحد يحمل كل ما يحتاجه القرار
-- ------------------------------------------------------------
-- p_to: 'broker' | 'rm' | 'supervisor' | 'admins'. الـRM أو المشرف الغائب
-- تنوب عنه الإدارة. لا يُشعَر الفاعل نفسه، ولا الشخص مرّتين (المشرف الذي
-- هو الـRM). وكل إرسال حدثٌ داخلي في الخطّ الزمني.
create or replace function public.notify_broker_request(
  p_id uuid, p_to text[], p_title text, p_extra text default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  q record; v_body text; v_sent text[] := '{}'; n int; v_admins boolean;
begin
  select q0.*, bc.name as company_name, pr.name as project_name,
         rm.full_name as rm_name, rm.user_id as rm_user, sup.user_id as sup_user
    into q
    from public.broker_reservation_requests q0
    left join public.broker_companies bc on bc.id = q0.company_id
    left join public.projects pr on pr.id = q0.project_id
    left join public.employees rm  on rm.id  = q0.rm_id
    left join public.employees sup on sup.id = q0.supervisor_id
   where q0.id = p_id;
  if not found then return; end if;

  v_body := coalesce(q.company_name, '—')
    || ' · العميل ' || coalesce(q.client_name, '—')
    || ' · ' || coalesce(q.project_name, '—')
    || ' · الوحدة ' || coalesce(q.unit_code, '—')
    || ' · السعر ' || coalesce(public.fmt_qty(coalesce(q.requested_price, q.unit_price)), '—')
    || ' · ' || to_char(q.created_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD')
    || ' · مدير العلاقات: ' || coalesce(q.rm_name, '—')
    || ' · الحالة: ' || q.status
    || coalesce(E'\n' || nullif(btrim(coalesce(p_extra, '')), ''), '');

  if 'broker' = any(p_to) then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    select bu.user_id, p_title, v_body, '/dashboard/broker/requests', 'حجز', p_id, 'broker_request', 'وساطة'
      from public.broker_users bu
     where bu.company_id = q.company_id and bu.is_active
       and bu.user_id is distinct from auth.uid();
    get diagnostics n = row_count;
    if n > 0 then v_sent := array_append(v_sent, 'الوسيط'); end if;
  end if;

  if 'rm' = any(p_to) and q.rm_user is not null and q.rm_user is distinct from auth.uid() then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    values (q.rm_user, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة');
    v_sent := array_append(v_sent, 'مدير العلاقات');
  end if;

  if 'supervisor' = any(p_to) and q.sup_user is not null
     and q.sup_user is distinct from auth.uid()
     and (q.sup_user is distinct from q.rm_user or not ('rm' = any(p_to))) then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category, priority)
    values (q.sup_user, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة', 'عالية');
    v_sent := array_append(v_sent, 'المشرف');
  end if;

  v_admins := 'admins' = any(p_to)
           or ('rm' = any(p_to) and q.rm_user is null)
           or ('supervisor' = any(p_to) and q.sup_user is null);
  if v_admins then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    select p.id, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة'
      from public.profiles p
     where p.role = 'admin' and p.id is distinct from auth.uid()
       and p.id is distinct from q.rm_user and p.id is distinct from q.sup_user;
    get diagnostics n = row_count;
    if n > 0 then v_sent := array_append(v_sent, 'الإدارة'); end if;
  end if;

  if array_length(v_sent, 1) > 0 then
    perform public.log_broker_request_event(p_id, 'إشعار',
      p_title || ' ← ' || array_to_string(v_sent, '، '), false);
  end if;
end; $fn$;


-- ------------------------------------------------------------
-- 7) الوسيط يرفع الطلب — الـRM والمشرف يُختمان في القاعدة
-- ------------------------------------------------------------
drop function if exists public.broker_request_reservation(uuid, uuid, text, text, text);
create or replace function public.broker_request_reservation(
  p_unit            uuid,
  p_client          uuid    default null,
  p_new_name        text    default null,
  p_new_phone       text    default null,
  p_note            text    default null,
  p_requested_price numeric default null
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid := public.my_broker_company();
  u         public.units%rowtype;
  c         public.clients%rowtype;
  v_rm      uuid;
  v_sup     uuid;
  v_client  uuid;
  v_cname   text;
  v_cphone  text;
  v_id      uuid;
  v_ttl     int;
  v_coname  text;
begin
  if v_company is null then
    raise exception 'طلب الحجز لحسابات الشركات الوسيطة';
  end if;

  select b.name into v_coname from public.broker_companies b where b.id = v_company and b.is_active;
  if v_coname is null then
    raise exception 'شركتكم موقوفة — راجعوا تلال';
  end if;

  if p_requested_price is not null and p_requested_price <= 0 then
    raise exception 'السعر المطلوب يجب أن يكون أكبر من صفر';
  end if;

  -- قفل صفّ الوحدة: طلبان متزامنان ينتظر ثانيهما الأول ثم يرى طلبه
  select * into u from public.units where id = p_unit for update;
  if not found or not public.broker_unit_visible(v_company, p_unit) then
    raise exception 'الوحدة غير متاحة لكم';
  end if;

  if u.status <> 'متاحة' then
    raise exception 'الوحدة % لم تعد متاحة (%)', coalesce(u.unit_code, ''), u.status;
  end if;

  if exists (select 1 from public.broker_reservation_requests q
              where q.unit_id = p_unit and public.broker_request_is_open(q.status)) then
    raise exception 'هذه الوحدة عليها طلب حجز قيد المعالجة';
  end if;

  if p_client is not null then
    select * into c from public.clients where id = p_client;
    if not found or c.deleted_at is not null or c.broker_company_id is distinct from v_company then
      raise exception 'العميل ليس من ليدات شركتكم';
    end if;
    v_client := c.id; v_cname := c.name; v_cphone := c.phone;
  else
    if nullif(btrim(coalesce(p_new_name, '')), '') is null then
      raise exception 'اختر عميلاً من ليداتكم أو اكتب اسم عميل جديد';
    end if;
    -- المحفّز stamp_broker_lead يختم الشركة والمهلة من هوية المُدخِل
    insert into public.clients (name, phone, project_id, created_by, notes)
    values (btrim(p_new_name), nullif(btrim(coalesce(p_new_phone, '')), ''),
            u.project_id, auth.uid(), 'أُضيف مع طلب حجز الوحدة ' || coalesce(u.unit_code, ''))
    returning id, name, phone into v_client, v_cname, v_cphone;
  end if;

  -- لا يختارهما الوسيط ولا ترسلهما الواجهة
  select bcp.rm_id into v_rm from public.broker_company_projects bcp
   where bcp.company_id = v_company and bcp.project_id = u.project_id;
  select pr.supervisor_id into v_sup from public.projects pr where pr.id = u.project_id;
  v_ttl := public.broker_request_ttl(u.project_id);

  insert into public.broker_reservation_requests
    (company_id, project_id, unit_id, client_id, requested_by, requested_by_name,
     note, unit_code, unit_price, payment_plan, requested_price,
     client_name, client_phone, rm_id, supervisor_id, expires_at, status_changed_at)
  values (v_company, u.project_id, p_unit, v_client, auth.uid(), public.actor_display_name(),
          nullif(btrim(coalesce(p_note, '')), ''), u.unit_code, u.price, u.payment_plan, p_requested_price,
          v_cname, v_cphone, v_rm, v_sup,
          case when v_ttl is null then null else now() + make_interval(hours => v_ttl) end, now())
  returning id into v_id;

  perform public.log_unit_event(p_unit, 'طلب حجز',
    v_coname || ' تطلب حجز الوحدة للعميل ' || coalesce(v_cname, '—'));

  perform public.notify_broker_request(v_id, array['rm', 'supervisor'],
    'طلب حجز جديد من ' || v_coname || ' — الوحدة ' || coalesce(u.unit_code, '—'));

  return v_id;
end; $fn$;


-- ------------------------------------------------------------
-- 8) المتابعة: استلام، مراجعة، سؤال، إجابة، ملاحظة
-- ------------------------------------------------------------
create or replace function public.broker_request_take(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype;
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'متابعة هذا الطلب لمدير العلاقات المسؤول أو المشرف أو الإدارة';
  end if;
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if q.status <> 'معلّق' then
    raise exception 'الطلب ليس معلّقاً (الحالة: %)', q.status;
  end if;

  perform public.brr_set_event('استلام الطلب');
  update public.broker_reservation_requests
     set status = 'قيد المتابعة', handled_by = auth.uid(),
         handled_by_name = public.actor_display_name(), handled_at = now()
   where id = p_id;

  perform public.notify_broker_request(p_id, array['broker'],
    'طلبكم قيد المتابعة — الوحدة ' || coalesce(q.unit_code, '—'),
    'يتابعه ' || public.actor_display_name());
end; $fn$;

-- الـRM يراجع ويوصي — لا يقرّر. التوصية داخلية لا يراها الوسيط.
create or replace function public.broker_request_review(
  p_id uuid, p_recommendation text, p_note text default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if not (public.is_admin() or (q.rm_id is not null and q.rm_id = public.my_employee_id())) then
    raise exception 'المراجعة لمدير العلاقات المسؤول عن الشركة';
  end if;
  if q.status not in ('معلّق', 'قيد المتابعة', 'بانتظار المشرف') then
    raise exception 'لا يُراجَع طلبٌ حالته %', q.status;
  end if;
  if p_recommendation not in ('أوصي بالموافقة', 'أوصي بالرفض', 'بلا توصية') then
    raise exception 'التوصية: أوصي بالموافقة، أو أوصي بالرفض، أو بلا توصية';
  end if;
  if p_recommendation = 'أوصي بالرفض' and v_note is null then
    raise exception 'اكتب سبب التوصية بالرفض — المشرف يقرّر عليه';
  end if;

  perform public.brr_set_event('مراجعة مدير العلاقات');
  update public.broker_reservation_requests
     set status = 'بانتظار المشرف',
         rm_recommendation = p_recommendation, rm_review_note = v_note,
         rm_reviewed_at = now(), rm_reviewed_by = auth.uid(),
         rm_reviewed_by_name = public.actor_display_name(),
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, public.actor_display_name()),
         handled_at = coalesce(handled_at, now())
   where id = p_id;

  -- إعادة المراجعة لا تغيّر الحالة، فلا يسجّلها المحفّز
  if q.status = 'بانتظار المشرف' then
    perform public.brr_set_event(null);
  end if;
  perform public.log_broker_request_event(p_id, 'توصية',
    p_recommendation || coalesce(' — ' || v_note, ''), false);

  perform public.notify_broker_request(p_id, array['supervisor'],
    'بانتظار قرارك: طلب حجز الوحدة ' || coalesce(q.unit_code, '—'),
    'توصية مدير العلاقات: ' || p_recommendation || coalesce(' — ' || v_note, ''));
end; $fn$;

create or replace function public.broker_request_ask_info(p_id uuid, p_question text)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_q text := nullif(btrim(coalesce(p_question, '')), '');
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'طلب المعلومات لمدير العلاقات أو المشرف أو الإدارة';
  end if;
  if v_q is null then raise exception 'اكتب ما تحتاج معرفته'; end if;

  select * into q from public.broker_reservation_requests where id = p_id for update;
  if q.status not in ('معلّق', 'قيد المتابعة', 'بانتظار المشرف') then
    raise exception 'لا يُسأل الوسيط في طلبٍ حالته %', q.status;
  end if;

  perform public.brr_set_event('طلب معلومات', v_q);
  update public.broker_reservation_requests
     set status = 'بحاجة لمعلومات', info_request = v_q, info_response = null,
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, public.actor_display_name()),
         handled_at = coalesce(handled_at, now())
   where id = p_id;

  perform public.notify_broker_request(p_id, array['broker'],
    'مطلوب معلومات عن طلب الوحدة ' || coalesce(q.unit_code, '—'), v_q);
end; $fn$;

create or replace function public.broker_request_answer(p_id uuid, p_answer text)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_a text := nullif(btrim(coalesce(p_answer, '')), '');
begin
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not found or q.company_id is distinct from public.my_broker_company() then
    raise exception 'الطلب غير موجود';
  end if;
  if q.status <> 'بحاجة لمعلومات' then
    raise exception 'لا سؤال معلّق على هذا الطلب';
  end if;
  if v_a is null then raise exception 'اكتب الإجابة'; end if;

  perform public.brr_set_event('إجابة الوسيط', v_a);
  update public.broker_reservation_requests
     set status = case when rm_reviewed_at is not null then 'بانتظار المشرف' else 'قيد المتابعة' end,
         info_response = v_a
   where id = p_id;

  perform public.notify_broker_request(p_id, array['rm', 'supervisor'],
    'أجاب الوسيط عن طلب الوحدة ' || coalesce(q.unit_code, '—'), v_a);
end; $fn$;

create or replace function public.broker_request_add_note(p_id uuid, p_note text, p_internal boolean default true)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_handle_broker_request(p_id) then
    raise exception 'الملاحظات لمدير العلاقات أو المشرف أو الإدارة';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'اكتب الملاحظة';
  end if;
  perform public.log_broker_request_event(p_id, 'ملاحظة', p_note, not coalesce(p_internal, true));
end; $fn$;


-- ------------------------------------------------------------
-- 9) القرار — الموافقة ذرّية: قفل، تحقّق، حجز، ربط، حدث، إشعارات
-- ------------------------------------------------------------
create or replace function public.approve_broker_reservation_request(
  p_id      uuid,
  p_price   numeric default null,
  p_deposit numeric default null,
  p_expiry  date    default null,
  p_note    text    default null
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  q       public.broker_reservation_requests%rowtype;
  u       public.units%rowtype;
  v_res   uuid;
  v_price numeric;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_co    text;
begin
  -- ١) الصلاحية
  if not public.can_approve_broker_request(p_id) then
    raise exception 'الموافقة على الحجز لمشرف المشروع أو الإدارة';
  end if;

  -- ٢) حالة الطلب (مقفول حتى نهاية المعاملة)
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not public.broker_request_is_open(q.status) then
    raise exception 'الطلب مغلق (الحالة: %)', q.status;
  end if;

  -- ٣) الوحدة (مقفولة كذلك)
  select * into u from public.units where id = q.unit_id for update;
  if not found or u.status <> 'متاحة' then
    raise exception 'الوحدة % لم تعد متاحة (%)', coalesce(u.unit_code, q.unit_code, ''), coalesce(u.status, 'محذوفة');
  end if;

  v_price := coalesce(p_price, q.requested_price);
  if v_price is not null and v_price <= 0 then
    raise exception 'سعر البيع يجب أن يكون أكبر من صفر';
  end if;
  if p_deposit is not null and p_deposit < 0 then
    raise exception 'العربون لا يكون سالباً';
  end if;

  select b.name into v_co from public.broker_companies b where b.id = q.company_id;

  -- ٤) الحجز — محفّز القفل يسمح لهذا الطلب وحده، ومحفّز القناة يختمه «وسيط»
  perform set_config('tilal.broker_approval', p_id::text, true);
  insert into public.reservations
    (client_id, unit_id, reservation_date, status, amount, expiry_date,
     agent_id, created_by, notes, sale_price)
  values (q.client_id, q.unit_id, (now() at time zone 'Asia/Baghdad')::date, 'حجز',
          p_deposit, p_expiry, coalesce(q.rm_id, public.my_employee_id()), auth.uid(),
          'من طلب الوسيط ' || coalesce(v_co, '') || coalesce(E'\n' || v_note, ''),
          v_price)
  returning id into v_res;
  perform set_config('tilal.broker_approval', '', true);

  -- ٥–٧) الربط والحالة والحدث
  perform public.brr_set_event('موافقة وإنشاء الحجز', v_note);
  update public.broker_reservation_requests
     set status = 'تمّ الحجز', reservation_id = v_res, reservation_status = 'حجز',
         decided_at = now(), decided_by = auth.uid(), decided_by_name = public.actor_display_name(),
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, public.actor_display_name()),
         handled_at = coalesce(handled_at, now()),
         decision_note = v_note
   where id = p_id;

  -- ٨–١٠) الإشعارات
  perform public.notify_broker_request(p_id, array['broker', 'rm', 'supervisor'],
    'تمّت الموافقة وحُجزت الوحدة ' || coalesce(q.unit_code, '—') || ' ✅',
    'وافق ' || public.actor_display_name() || coalesce(' — ' || v_note, ''));

  return v_res;
end; $fn$;

-- الاسم القديم (117) يبقى لأي نداءٍ قائم — ويمرّ بالصلاحية الجديدة
create or replace function public.broker_request_confirm(
  p_id uuid, p_deposit numeric default null, p_expiry date default null, p_note text default null
)
returns uuid language sql security definer set search_path = public as $fn$
  select public.approve_broker_reservation_request(p_id, null, p_deposit, p_expiry, p_note);
$fn$;

create or replace function public.broker_request_reject(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_approve_broker_request(p_id) then
    raise exception 'رفض الطلب لمشرف المشروع أو الإدارة — مدير العلاقات يوصي بالرفض';
  end if;
  if v_reason is null then
    raise exception 'اكتب سبب الرفض — الوسيط يحتاج يعرف لماذا';
  end if;
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not public.broker_request_is_open(q.status) then
    raise exception 'الطلب مغلق (الحالة: %)', q.status;
  end if;

  perform public.brr_set_event('رفض', v_reason);
  update public.broker_reservation_requests
     set status = 'مرفوض', decided_at = now(), decided_by = auth.uid(),
         decided_by_name = public.actor_display_name(), decision_note = v_reason,
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, public.actor_display_name()),
         handled_at = coalesce(handled_at, now())
   where id = p_id;

  perform public.log_unit_event(q.unit_id, 'رفض طلب حجز', 'رُفض طلب الوسيط — ' || v_reason);

  perform public.notify_broker_request(p_id, array['broker', 'rm', 'supervisor'],
    'رُفض طلب حجز الوحدة ' || coalesce(q.unit_code, '—'), v_reason);
end; $fn$;

create or replace function public.broker_cancel_reservation_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype;
begin
  select * into q from public.broker_reservation_requests where id = p_id for update;
  if not found or q.company_id is distinct from public.my_broker_company() then
    raise exception 'الطلب غير موجود';
  end if;
  if not public.broker_request_is_open(q.status) then
    raise exception 'لا يُسحب إلا طلبٌ مفتوح (الحالة: %)', q.status;
  end if;

  perform public.brr_set_event('سحب الوسيط');
  update public.broker_reservation_requests
     set status = 'ملغى', decided_at = now(), decided_by = auth.uid(),
         decided_by_name = public.actor_display_name(), decision_note = 'سحبه الوسيط'
   where id = p_id;

  perform public.notify_broker_request(p_id, array['rm', 'supervisor'],
    'سحب الوسيط طلب حجز الوحدة ' || coalesce(q.unit_code, '—'));
end; $fn$;


-- ------------------------------------------------------------
-- 10) انتهاء الطلب بلا قرار — يحرّر الوحدة
-- ------------------------------------------------------------
create or replace function public.expire_broker_requests()
returns integer language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  -- تنبيهٌ واحد قبل ٢٤ ساعة للمشرف والـRM
  for r in
    select q.id, q.unit_code from public.broker_reservation_requests q
     where public.broker_request_is_open(q.status)
       and q.expires_at is not null and q.expiry_warned_at is null
       and q.expires_at > now() and q.expires_at <= now() + interval '24 hours'
     for update skip locked
  loop
    update public.broker_reservation_requests set expiry_warned_at = now() where id = r.id;
    perform public.notify_broker_request(r.id, array['rm', 'supervisor'],
      'ينتهي خلال ٢٤ ساعة: طلب حجز الوحدة ' || coalesce(r.unit_code, '—'),
      'بلا قرار تنتهي المهلة وتتحرّر الوحدة.');
  end loop;

  for r in
    select q.id, q.unit_code from public.broker_reservation_requests q
     where public.broker_request_is_open(q.status)
       and q.expires_at is not null and q.expires_at <= now()
     for update skip locked
  loop
    perform public.brr_set_event('انتهاء المهلة', 'انقضت مهلة الطلب بلا قرار فتحرّرت الوحدة');
    update public.broker_reservation_requests
       set status = 'منتهي', decided_at = now(), decided_by = null,
           decided_by_name = 'النظام', decision_note = 'انتهت المهلة بلا قرار'
     where id = r.id;

    perform public.notify_broker_request(r.id, array['broker', 'rm', 'supervisor'],
      'انتهى طلب حجز الوحدة ' || coalesce(r.unit_code, '—'),
      'انقضت المهلة بلا قرار — الوحدة متاحة من جديد.');
    n := n + 1;
  end loop;
  return n;
end; $fn$;

select cron.unschedule('broker-request-expiry')
 where exists (select 1 from cron.job where jobname = 'broker-request-expiry');

select cron.schedule('broker-request-expiry', '7 * * * *',
  $cron$ select public.expire_broker_requests(); $cron$);


-- ------------------------------------------------------------
-- 11) الحجز يتبعه الطلب: البيع، الإلغاء
-- ------------------------------------------------------------
create or replace function public.mirror_reservation_to_broker_request()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare q public.broker_reservation_requests%rowtype; v_new text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  select * into q from public.broker_reservation_requests where reservation_id = new.id;
  if not found then return null; end if;

  v_new := case new.status
             when 'بيع مكتمل' then 'تمّ البيع'
             when 'ملغى'      then 'أُلغي الحجز'
             when 'حجز'       then 'تمّ الحجز'
           end;

  if v_new is not null and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز')
     and v_new is distinct from q.status then
    perform public.brr_set_event(case v_new when 'تمّ البيع' then 'اكتمل البيع'
                                            when 'أُلغي الحجز' then 'أُلغي الحجز'
                                            else 'عاد الحجز' end);
    update public.broker_reservation_requests
       set status = v_new, reservation_status = new.status
     where id = q.id;

    perform public.notify_broker_request(q.id, array['broker', 'rm'],
      case v_new when 'تمّ البيع' then 'اكتمل بيع الوحدة ' || coalesce(q.unit_code, '—') || ' 🎉'
                 when 'أُلغي الحجز' then 'أُلغي حجز الوحدة ' || coalesce(q.unit_code, '—')
                 else 'عاد حجز الوحدة ' || coalesce(q.unit_code, '—') end);
  else
    update public.broker_reservation_requests set reservation_status = new.status where id = q.id;
  end if;
  return null;
end; $fn$;


-- ------------------------------------------------------------
-- 12) تغيّر الـRM أو المشرف: الطلبات المفتوحة تنتقل
-- ------------------------------------------------------------
create or replace function public.brr_follow_rm_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.rm_id is not distinct from old.rm_id then return null; end if;

  for r in
    select q.id from public.broker_reservation_requests q
     where q.company_id = new.company_id and q.project_id = new.project_id
       and public.broker_request_is_open(q.status)
  loop
    update public.broker_reservation_requests set rm_id = new.rm_id where id = r.id;
    perform public.log_broker_request_event(r.id, 'تغيّر مدير العلاقات',
      coalesce((select full_name from public.employees where id = old.rm_id), '—') || ' ← '
        || coalesce((select full_name from public.employees where id = new.rm_id), '—'), false);
    perform public.notify_broker_request(r.id, array['rm'], 'أُسند إليك طلب حجز قائم');
  end loop;
  return null;
end; $fn$;

drop trigger if exists trg_brr_follow_rm_change on public.broker_company_projects;
create trigger trg_brr_follow_rm_change
  after update of rm_id on public.broker_company_projects
  for each row execute function public.brr_follow_rm_change();

create or replace function public.brr_follow_supervisor_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.supervisor_id is not distinct from old.supervisor_id then return null; end if;

  for r in
    select q.id from public.broker_reservation_requests q
     where q.project_id = new.id and public.broker_request_is_open(q.status)
  loop
    update public.broker_reservation_requests set supervisor_id = new.supervisor_id where id = r.id;
    perform public.log_broker_request_event(r.id, 'تغيّر مشرف المشروع',
      coalesce((select full_name from public.employees where id = old.supervisor_id), '—') || ' ← '
        || coalesce((select full_name from public.employees where id = new.supervisor_id), '—'), false);
    perform public.notify_broker_request(r.id, array['supervisor'], 'طلب حجز قائم في مشروعك ينتظر قرارك');
  end loop;
  return null;
end; $fn$;

drop trigger if exists trg_brr_follow_supervisor_change on public.projects;
create trigger trg_brr_follow_supervisor_change
  after update of supervisor_id on public.projects
  for each row execute function public.brr_follow_supervisor_change();

-- دمج العميل (104): الطلبات تتبع البطاقة الباقية — نفس نمط trg_mkt_follow_merge
create or replace function public.brr_follow_merge()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.merged_into is not null and new.merged_into is distinct from old.merged_into then
    update public.broker_reservation_requests set client_id = new.merged_into where client_id = new.id;
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_brr_follow_merge on public.clients;
create trigger trg_brr_follow_merge
  after update of merged_into on public.clients
  for each row execute function public.brr_follow_merge();


-- ------------------------------------------------------------
-- 13) قفل الوحدة في القاعدة
-- ------------------------------------------------------------
-- حجزٌ نشط واحد لكل وحدة (فُحص قبل الكتابة: صفر تعارض حيّ)
create unique index if not exists reservations_one_active_per_unit
  on public.reservations (unit_id)
  where status in ('حجز', 'بيع مكتمل');

-- يسبق كل محفّزات الإدراج (الترتيب أبجدي): يقفل صفّ الوحدة فيتسلسل كل
-- حجزٍ عليها، ويرفض الحجز إن كان عليها طلب وسيط مفتوح — إلا من دالّة
-- الموافقة على ذلك الطلب نفسه.
create or replace function public.reservation_unit_lock()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_open uuid;
begin
  if new.status = 'ملغى' then return new; end if;

  perform 1 from public.units where id = new.unit_id for update;

  select q.id into v_open from public.broker_reservation_requests q
   where q.unit_id = new.unit_id and public.broker_request_is_open(q.status)
   limit 1;

  if v_open is not null
     and v_open::text is distinct from nullif(current_setting('tilal.broker_approval', true), '') then
    raise exception 'على الوحدة طلب حجز من وسيط قيد المعالجة — يُقرَّر فيه أولاً';
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_a_reservation_unit_lock on public.reservations;
create trigger trg_a_reservation_unit_lock
  before insert on public.reservations
  for each row execute function public.reservation_unit_lock();


-- ------------------------------------------------------------
-- 14) قناة البيع — من جلب العميل
-- ------------------------------------------------------------
alter table public.reservations
  add column if not exists sale_channel      text not null default 'مباشر',
  -- restrict: شركةٌ لها صفقات لا تُحذف (تُوقَف)، وإلا صارت صفقة «وسيط» بلا وسيط
  add column if not exists broker_company_id uuid references public.broker_companies(id) on delete restrict,
  add column if not exists broker_rm_id      uuid references public.employees(id) on delete set null,
  add column if not exists broker_request_id uuid references public.broker_reservation_requests(id) on delete set null;

alter table public.reservations drop constraint if exists reservations_sale_channel_chk;
alter table public.reservations
  add constraint reservations_sale_channel_chk check (
    (sale_channel = 'مباشر' and broker_company_id is null)
    or (sale_channel = 'وسيط' and broker_company_id is not null));

comment on column public.reservations.sale_channel is
  'مباشر = عميل تلال. وسيط = عميل جلبته شركة وسيطة (من طلبها، أو ليدها وقت الحجز). تُختم في القاعدة عند الإدراج ولا تتغيّر إلا بـ set_sale_channel قبل اكتمال البيع (sql/128).';
comment on column public.reservations.broker_rm_id is
  'مدير علاقات الشركة في المشروع يوم الحجز — مستحقّ العمولة الداخلية لصفقة الوسيط إن عُرّفت (sql/129).';

create index if not exists reservations_channel_idx on public.reservations (sale_channel, status);
create index if not exists reservations_broker_idx  on public.reservations (broker_company_id) where broker_company_id is not null;

create or replace function public.stamp_sale_channel()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_req uuid := nullif(current_setting('tilal.broker_approval', true), '')::uuid; q record; v_co uuid;
begin
  new.sale_channel := 'مباشر';
  new.broker_company_id := null; new.broker_rm_id := null; new.broker_request_id := null;

  if v_req is not null then
    select company_id, rm_id into q from public.broker_reservation_requests where id = v_req;
    new.sale_channel := 'وسيط';
    new.broker_company_id := q.company_id;
    new.broker_rm_id := q.rm_id;
    new.broker_request_id := v_req;
  else
    select c.broker_company_id into v_co from public.clients c where c.id = new.client_id;
    if v_co is not null then
      new.sale_channel := 'وسيط';
      new.broker_company_id := v_co;
      select bcp.rm_id into new.broker_rm_id
        from public.broker_company_projects bcp
        join public.units u on u.project_id = bcp.project_id
       where u.id = new.unit_id and bcp.company_id = v_co;
    end if;
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_a_stamp_sale_channel on public.reservations;
create trigger trg_a_stamp_sale_channel
  before insert on public.reservations
  for each row execute function public.stamp_sale_channel();

-- يحرس القناة والشركة وحدهما: broker_rm_id و broker_request_id قد يصيران
-- فراغاً بحذفٍ متتابع (set null)، وهذا لا يغيّر من جلب العميل.
create or replace function public.guard_sale_channel()
returns trigger language plpgsql as $fn$
begin
  if (new.sale_channel, new.broker_company_id)
     is distinct from (old.sale_channel, old.broker_company_id)
     and coalesce(current_setting('tilal.set_channel', true), '') <> 'on' then
    raise exception 'قناة البيع تُختم عند الحجز — تغييرها بـ set_sale_channel للمدير قبل اكتمال البيع';
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_guard_sale_channel on public.reservations;
create trigger trg_guard_sale_channel
  before update on public.reservations
  for each row execute function public.guard_sale_channel();

-- ملءٌ رجعي: من طلب الوسيط، وإلا ليد الوسيط الحالي
do $do$
begin
  perform set_config('tilal.set_channel', 'on', true);

  update public.reservations r
     set sale_channel = 'وسيط', broker_company_id = q.company_id,
         broker_rm_id = q.rm_id, broker_request_id = q.id
    from public.broker_reservation_requests q
   where q.reservation_id = r.id and r.broker_request_id is null;

  update public.reservations r
     set sale_channel = 'وسيط', broker_company_id = c.broker_company_id,
         broker_rm_id = (select bcp.rm_id from public.broker_company_projects bcp
                           join public.units u on u.project_id = bcp.project_id
                          where u.id = r.unit_id and bcp.company_id = c.broker_company_id)
    from public.clients c
   where c.id = r.client_id and c.broker_company_id is not null
     and r.sale_channel = 'مباشر';

  perform set_config('tilal.set_channel', '', true);
end $do$;

-- التحويل اليدوي — قبل اكتمال البيع فقط (بعده: فسخ ثم إعادة)
create or replace function public.set_sale_channel(
  p_res uuid, p_channel text, p_company uuid default null, p_reason text default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare r public.reservations%rowtype; v_rm uuid; v_project uuid; v_co text;
begin
  if not public.is_admin() then raise exception 'تغيير قناة البيع للمدير'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب التغيير'; end if;
  if p_channel not in ('مباشر', 'وسيط') then raise exception 'القناة: مباشر أو وسيط'; end if;

  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status <> 'حجز' then
    raise exception 'القناة تتغيّر قبل اكتمال البيع فقط — البيع % يُفسخ ثم يُعاد', r.status;
  end if;

  select project_id into v_project from public.units where id = r.unit_id;

  if p_channel = 'وسيط' then
    if p_company is null then raise exception 'اختر الشركة الوسيطة'; end if;
    select b.name into v_co from public.broker_companies b
      join public.broker_company_projects bcp on bcp.company_id = b.id and bcp.project_id = v_project
     where b.id = p_company;
    if v_co is null then raise exception 'الشركة غير مُسنَدة لمشروع الوحدة'; end if;
    select bcp.rm_id into v_rm from public.broker_company_projects bcp
     where bcp.company_id = p_company and bcp.project_id = v_project;
  end if;

  perform set_config('tilal.set_channel', 'on', true);
  update public.reservations
     set sale_channel = p_channel,
         broker_company_id = case when p_channel = 'وسيط' then p_company end,
         broker_rm_id      = case when p_channel = 'وسيط' then v_rm end,
         broker_request_id = case when p_channel = 'وسيط' then broker_request_id end
   where id = p_res;
  perform set_config('tilal.set_channel', '', true);

  perform public.log_unit_event(r.unit_id, 'قناة البيع',
    r.sale_channel || ' ← ' || p_channel || coalesce(' (' || v_co || ')', '') || ' — ' || btrim(p_reason));
end; $fn$;


-- ------------------------------------------------------------
-- 15) ما يمسّه اتّساع الحالات المفتوحة
-- ------------------------------------------------------------
create or replace function public.broker_lead_in_deal(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.reservations rs
                  where rs.client_id = p_client and rs.status in ('حجز', 'بيع مكتمل'))
      or exists (select 1 from public.broker_reservation_requests q
                  where q.client_id = p_client and public.broker_request_is_open(q.status));
$fn$;

create or replace function public.broker_units()
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
           when u.status = 'محجوزة'                        then 'محجوزة'
           when q.id is not null and q.company_id = me.cid then 'طلبكم قيد المتابعة'
           when q.id is not null                           then 'عليها طلب'
           else 'متاحة'
         end,
         case when q.company_id = me.cid then q.id end
    from me
    join public.broker_company_projects bcp on bcp.company_id = me.cid
    join public.units u    on u.project_id = bcp.project_id
    join public.projects p on p.id = u.project_id
    left join public.broker_reservation_requests q
           on q.unit_id = u.id and public.broker_request_is_open(q.status)
   where me.cid is not null
     and u.status in ('متاحة', 'محجوزة')
     and (
       bcp.units_scope = 'الكل'
       or exists (select 1 from public.broker_visible_units v
                   where v.company_id = me.cid and v.unit_id = u.id)
     )
   order by p.name, u.node_path nulls last, u.unit_code;
$fn$;

-- مهلة الليد: نصّ 117 + الإشعار للحسابات النشطة وحدها
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
       and not public.broker_lead_in_deal(c.id)
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
      from public.broker_users bu where bu.company_id = r.broker_company_id and bu.is_active;

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
       and not public.broker_lead_in_deal(c.id)
  loop
    v_days := r.days_left;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select bu.user_id,
           'باقٍ ' || v_days || case when v_days = 1 then ' يوم' else ' أيام' end || ' على ليد: ' || r.name,
           'أغلق الصفقة قبل انتهاء المهلة وإلا عاد الليد إلى تلال.',
           '/dashboard/broker/leads', 'ليد', r.id
      from public.broker_users bu where bu.company_id = r.broker_company_id and bu.is_active;

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
-- 16) المنح — منذ 054 تخرج كل دالّة بلا منحة
-- ------------------------------------------------------------
revoke execute on function public.is_broker_rm()                                   from public, anon;
revoke execute on function public.is_broker_supervisor()                           from public, anon;
revoke execute on function public.my_broker_scope()                                from public, anon;
revoke execute on function public.broker_request_is_open(text)                     from public, anon;
revoke execute on function public.broker_request_ttl(uuid)                         from public, anon;
revoke execute on function public.can_view_broker_request(uuid)                    from public, anon;
revoke execute on function public.can_approve_broker_request(uuid)                 from public, anon;
revoke execute on function public.broker_actor_role(uuid)                          from public, anon, authenticated;
revoke execute on function public.log_broker_request_event(uuid, text, text, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.brr_set_event(text, text, boolean)               from public, anon, authenticated;
revoke execute on function public.notify_broker_request(uuid, text[], text, text)  from public, anon, authenticated;
revoke execute on function public.broker_request_reservation(uuid, uuid, text, text, text, numeric) from public, anon;
revoke execute on function public.broker_request_review(uuid, text, text)          from public, anon;
revoke execute on function public.broker_request_ask_info(uuid, text)              from public, anon;
revoke execute on function public.broker_request_answer(uuid, text)                from public, anon;
revoke execute on function public.broker_request_add_note(uuid, text, boolean)     from public, anon;
revoke execute on function public.approve_broker_reservation_request(uuid, numeric, numeric, date, text) from public, anon;
revoke execute on function public.broker_request_confirm(uuid, numeric, date, text) from public, anon;
revoke execute on function public.expire_broker_requests()                         from public, anon, authenticated;
revoke execute on function public.set_sale_channel(uuid, text, uuid, text)         from public, anon;

grant execute on function public.is_broker_rm()                                   to authenticated;
grant execute on function public.is_broker_supervisor()                           to authenticated;
grant execute on function public.my_broker_scope()                                to authenticated;
grant execute on function public.broker_request_is_open(text)                     to authenticated;
grant execute on function public.broker_request_ttl(uuid)                         to authenticated;
grant execute on function public.can_view_broker_request(uuid)                    to authenticated;
grant execute on function public.can_approve_broker_request(uuid)                 to authenticated;
grant execute on function public.broker_request_reservation(uuid, uuid, text, text, text, numeric) to authenticated;
grant execute on function public.broker_request_review(uuid, text, text)          to authenticated;
grant execute on function public.broker_request_ask_info(uuid, text)              to authenticated;
grant execute on function public.broker_request_answer(uuid, text)                to authenticated;
grant execute on function public.broker_request_add_note(uuid, text, boolean)     to authenticated;
grant execute on function public.approve_broker_reservation_request(uuid, numeric, numeric, date, text) to authenticated;
grant execute on function public.broker_request_confirm(uuid, numeric, date, text) to authenticated;
grant execute on function public.set_sale_channel(uuid, text, uuid, text)         to authenticated;

notify pgrst, 'reload schema';
