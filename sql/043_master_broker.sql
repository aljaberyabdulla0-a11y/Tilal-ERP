-- ============================================================
-- تلال ERP — نموذج «الماستر بروكر»: شركات وسيطة وليداتها وعمولاتها
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-08-27):
--   • تلال ماستر بروكر: تولّد حسابات لشركات وساطة تُدخل ليداتها في
--     المشروع السكني، وترى عمولاتها واستحقاقاتها المالية كاملة.
--   • **مهلة الشهر**: ليد لم تُغلق صفقته خلال ٣٠ يوماً من إدخاله
--     يعود إلى تلال لتوزّعه على من تريد.
--   • دور جديد **مدير العلاقات (RM)**: يتابع ليدات الشركات التي تحت
--     مظلته داخل مشروعه.
--
-- ثلاثة قرارات صمّمت هذا الملف (من المستخدم مباشرةً):
--   1) العمولة = **نسبة % من سعر الوحدة**، لكل شركة نسبتها.
--   2) المهلة **٣٠ يوماً من إدخال الليد ولا تتجدد** — التواصل لا
--      يمدّها. (وللإدارة تمديد يدوي لليد الواحد عند الحاجة، فالقاعدة
--      صارمة والاستثناء موثَّق.)
--   3) مستخدم الشركة يرى **كل ليدات شركته** لا ليداته هو.
--   4) الشركة قد تعمل على عدة مشاريع، ولكل (شركة × مشروع) مدير علاقات
--      — وهذا ما يجعل «أحمد مدير علاقات مشروع س يتابع شركات ص وع وك»
--      قابلاً للتمثيل بلا التواء.
--
-- المبدأ الحاكم:
--     الشركة الوسيطة **ليست موظفاً في تلال**. لا تدخل نطاق الموظفين
--     ولا المشاريع ولا الوحدات ولا الفواتير — ترى ليداتها هي، وسجلّ
--     تواصلها، وعمولاتها هي. لا شيء غير ذلك.
--
-- يتطلب: sql/005 و 012 و 022 و 026 و 027 و 036 و 037 و 040.
-- آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الدوران الجديدان
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in (
    'admin', 'supervisor', 'followup_manager',
    'relationship_manager', 'broker', 'employee'
  ));

create or replace function public.is_broker()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'broker', false);
$fn$;

create or replace function public.is_rm()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'relationship_manager', false);
$fn$;

-- ------------------------------------------------------------
-- 2) الشركات الوسيطة وحساباتها ومشاريعها
-- ------------------------------------------------------------
create table if not exists public.broker_companies (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  name            text not null unique,
  phone           text,
  email           text,
  license_no      text,                                   -- رقم إجازة المكتب
  -- نسبة العمولة من سعر الوحدة (٪) — تُثبَّت على العمولة وقت الاستحقاق
  commission_rate numeric(5,2) not null default 0,
  is_active       boolean not null default true,
  notes           text
);

alter table public.broker_companies drop constraint if exists broker_companies_rate_chk;
alter table public.broker_companies
  add constraint broker_companies_rate_chk
  check (commission_rate >= 0 and commission_rate <= 100);

-- حسابات دخول الشركة (قد يكون للشركة أكثر من حساب)
create table if not exists public.broker_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.broker_companies(id) on delete cascade,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now()
);

create index if not exists broker_users_company_idx on public.broker_users (company_id);

-- الشركة × المشروع + مدير العلاقات المسؤول عن هذه الشركة في هذا المشروع
create table if not exists public.broker_company_projects (
  company_id uuid not null references public.broker_companies(id) on delete cascade,
  project_id uuid not null references public.projects(id)         on delete cascade,
  rm_id      uuid references public.employees(id)                 on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, project_id)
);

create index if not exists bcp_project_idx on public.broker_company_projects (project_id);
create index if not exists bcp_rm_idx      on public.broker_company_projects (rm_id);

-- ------------------------------------------------------------
-- 3) دوال النطاق — عليها تُبنى كل السياسات أدناه
-- ------------------------------------------------------------
-- شركتي أنا (لمستخدم الشركة)
create or replace function public.my_broker_company()
returns uuid language sql stable security definer set search_path = public as $fn$
  select bu.company_id from public.broker_users bu where bu.user_id = auth.uid();
$fn$;

-- الشركات التي أتابعها كمدير علاقات (عبر إسناد الشركة لمشروعي)
drop function if exists public.my_rm_companies() cascade;
create function public.my_rm_companies()
returns table (company_id uuid) language sql stable security definer set search_path = public as $fn$
  select distinct bcp.company_id
    from public.broker_company_projects bcp
   where bcp.rm_id is not null
     and bcp.rm_id = public.my_employee_id();
$fn$;

-- مشاريع شركتي (لتقييد الليد بمشروع مسموح)
drop function if exists public.my_broker_projects() cascade;
create function public.my_broker_projects()
returns table (project_id uuid) language sql stable security definer set search_path = public as $fn$
  select bcp.project_id
    from public.broker_company_projects bcp
   where bcp.company_id = public.my_broker_company();
$fn$;

grant execute on function public.is_broker()          to authenticated;
grant execute on function public.is_rm()              to authenticated;
grant execute on function public.my_broker_company()  to authenticated;
grant execute on function public.my_rm_companies()    to authenticated;
grant execute on function public.my_broker_projects() to authenticated;

-- ------------------------------------------------------------
-- 4) الليد: صاحبه ومهلته
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists broker_company_id uuid references public.broker_companies(id) on delete set null,
  add column if not exists project_id        uuid references public.projects(id)         on delete set null,
  add column if not exists broker_assigned_at timestamptz,
  add column if not exists broker_deadline    date,       -- آخر يوم قبل العودة لتلال
  add column if not exists returned_at        timestamptz,
  add column if not exists returned_from      uuid references public.broker_companies(id) on delete set null;

create index if not exists clients_broker_idx   on public.clients (broker_company_id, broker_deadline);
create index if not exists clients_project_idx  on public.clients (project_id);
create index if not exists clients_returned_idx on public.clients (returned_at) where returned_at is not null;

-- هل هذا الليد داخل نطاقي؟ (شركتي، أو شركة أتابعها كمدير علاقات)
-- ⚠️ تعريفها هنا لا في القسم السابق: تقرأ `clients.broker_company_id`
--    ودالة SQL تُتحقَّق عند إنشائها، فلو سبقت الأعمدة لفشل الملف.
create or replace function public.can_see_broker_lead(cid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and c.broker_company_id is not null
       and (
         c.broker_company_id = public.my_broker_company()
         or c.broker_company_id in (select m.company_id from public.my_rm_companies() m)
       )
  );
$fn$;

grant execute on function public.can_see_broker_lead(uuid) to authenticated;

-- سجلّ انتقال الليد — من أي شركة إلى أي شركة ولماذا
create table if not exists public.lead_transfers (
  id              uuid primary key default gen_random_uuid(),
  moved_at        timestamptz not null default now(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  from_company_id uuid references public.broker_companies(id) on delete set null,
  to_company_id   uuid references public.broker_companies(id) on delete set null,
  reason          text,
  moved_by        uuid references auth.users(id) on delete set null,
  actor_name      text
);

create index if not exists lead_transfers_client_idx on public.lead_transfers (client_id, moved_at desc);

-- مدّة المهلة بيوم واحد في مكان واحد — لو تغيّرت السياسة غُيّرت هنا
create or replace function public.broker_lead_days()
returns integer language sql immutable as $fn$ select 30; $fn$;

-- بداية المهلة ونهايتها تُحسبان في القاعدة لا في الواجهة، وشركة الليد
-- تُفرض من هوية المُدخِل — فلا تُدخل شركة ليداً باسم شركة أخرى.
create or replace function public.stamp_broker_lead()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  my_company uuid := public.my_broker_company();
  today      date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if my_company is not null then
    new.broker_company_id := my_company;
  end if;

  if new.broker_company_id is not null then
    new.broker_assigned_at := coalesce(new.broker_assigned_at, now());
    new.broker_deadline    := coalesce(new.broker_deadline, today + public.broker_lead_days());
    new.returned_at        := null;
    new.returned_from      := null;
  end if;

  return new;
end; $fn$;

drop trigger if exists trg_stamp_broker_lead on public.clients;
create trigger trg_stamp_broker_lead
  before insert on public.clients
  for each row execute function public.stamp_broker_lead();

-- إعادة إسناد ليد لشركة أخرى = مهلة جديدة كاملة.
-- («لا تتجدد» تعني أن التواصل لا يمدّها، لا أن الإسناد الجديد يرث
--  ما تبقّى من مهلة شركة سابقة.)
create or replace function public.reassign_broker_lead()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if new.broker_company_id is distinct from old.broker_company_id then
    if new.broker_company_id is not null then
      new.broker_assigned_at := now();
      new.broker_deadline    := today + public.broker_lead_days();
      new.returned_at        := null;
      new.returned_from      := null;
    else
      -- سُحب من شركة بلا إسناد جديد: عاد إلى تلال
      new.broker_assigned_at := null;
      new.broker_deadline    := null;
      new.returned_at        := coalesce(new.returned_at, now());
      new.returned_from      := coalesce(new.returned_from, old.broker_company_id);
    end if;
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_reassign_broker_lead on public.clients;
create trigger trg_reassign_broker_lead
  before update of broker_company_id on public.clients
  for each row execute function public.reassign_broker_lead();

create or replace function public.log_lead_transfer()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.broker_company_id is distinct from old.broker_company_id then
    insert into public.lead_transfers
      (client_id, from_company_id, to_company_id, reason, moved_by, actor_name)
    values (
      new.id, old.broker_company_id, new.broker_company_id,
      case when new.broker_company_id is null then 'سحب/عودة إلى تلال' else 'إسناد لشركة' end,
      auth.uid(),
      coalesce(
        public.my_employee_name(),
        (select bu.full_name from public.broker_users bu where bu.user_id = auth.uid()),
        (select p.email from public.profiles p where p.id = auth.uid()),
        'النظام'   -- الفحص اليومي يعمل بلا مستخدم
      )
    );
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_log_lead_transfer on public.clients;
create trigger trg_log_lead_transfer
  after update of broker_company_id on public.clients
  for each row execute function public.log_lead_transfer();

-- ------------------------------------------------------------
-- 5) العمولات والاستحقاقات
-- ------------------------------------------------------------
create table if not exists public.broker_commissions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,

  company_id     uuid not null references public.broker_companies(id) on delete cascade,
  client_id      uuid references public.clients(id)      on delete set null,
  unit_id        uuid references public.units(id)        on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null,
  project_id     uuid references public.projects(id)     on delete set null,

  deal_amount    numeric(16,2) not null default 0,   -- سعر الوحدة وقت البيع
  rate           numeric(5,2)  not null default 0,   -- النسبة المثبَّتة
  amount         numeric(16,2) not null default 0,   -- المستحق (قابل للتعديل)

  earned_at      date not null default (now() at time zone 'Asia/Baghdad')::date,
  notes          text
);

create unique index if not exists broker_commissions_reservation_uidx
  on public.broker_commissions (reservation_id) where reservation_id is not null;
create index if not exists broker_commissions_company_idx on public.broker_commissions (company_id, earned_at desc);

-- الدفعات على العمولة — نفس نمط فواتير النظام: الحالة تُحسب من
-- مجموع المدفوع لا تُخزَّن، فلا يتناقض رقمان.
create table if not exists public.broker_payments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  commission_id uuid not null references public.broker_commissions(id) on delete cascade,
  amount        numeric(16,2) not null check (amount > 0),
  payment_date  date not null default (now() at time zone 'Asia/Baghdad')::date,
  method        text,
  notes         text
);

create index if not exists broker_payments_commission_idx on public.broker_payments (commission_id);

-- استحقاق تلقائي عند إتمام البيع لليد الذي جاءت به شركة
create or replace function public.post_broker_commission()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_company  uuid;
  v_project  uuid;
  v_rate     numeric(5,2);
  v_price    numeric(16,2);
  v_client   text;
  v_comm     uuid;
begin
  if new.status <> 'بيع مكتمل' then
    return new;
  end if;

  select c.broker_company_id, c.project_id, c.name
    into v_company, v_project, v_client
    from public.clients c where c.id = new.client_id;

  if v_company is null then
    return new;                       -- ليد تلال نفسها: لا عمولة وساطة
  end if;

  if exists (select 1 from public.broker_commissions bc where bc.reservation_id = new.id) then
    return new;                       -- سُجّلت من قبل
  end if;

  select bc.commission_rate into v_rate from public.broker_companies bc where bc.id = v_company;

  select coalesce(new.amount, u.price, 0), coalesce(v_project, u.project_id)
    into v_price, v_project
    from public.units u where u.id = new.unit_id;

  insert into public.broker_commissions
    (company_id, client_id, unit_id, reservation_id, project_id,
     deal_amount, rate, amount, notes)
  values (
    v_company, new.client_id, new.unit_id, new.id, v_project,
    coalesce(v_price, 0), coalesce(v_rate, 0),
    round(coalesce(v_price, 0) * coalesce(v_rate, 0) / 100, 2),
    'استحقاق تلقائي عند إتمام البيع'
  )
  returning id into v_comm;

  -- إشعار الشركة والإدارة
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select bu.user_id,
         'عمولة مستحقة لكم 🎉',
         'إتمام بيع للعميل ' || coalesce(v_client, '') || ' — المستحق '
           || public.fmt_qty(round(coalesce(v_price,0) * coalesce(v_rate,0) / 100, 2)),
         '/dashboard/broker/commissions', 'عمولة', v_comm
    from public.broker_users bu where bu.company_id = v_company;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         'عمولة وساطة مستحقة',
         (select bcm.name from public.broker_companies bcm where bcm.id = v_company)
           || ' — ' || public.fmt_qty(round(coalesce(v_price,0) * coalesce(v_rate,0) / 100, 2)),
         '/dashboard/brokers/' || v_company, 'عمولة', v_comm
    from public.profiles p where p.role = 'admin';

  return new;
end; $fn$;

drop trigger if exists trg_post_broker_commission on public.reservations;
create trigger trg_post_broker_commission
  after insert or update of status on public.reservations
  for each row execute function public.post_broker_commission();

-- ------------------------------------------------------------
-- 6) عودة الليد إلى تلال عند انتهاء المهلة
-- ------------------------------------------------------------
-- تعمل يومياً ٩ صباحاً بتوقيت بغداد، وتُرجع أيضاً من زرّ للإدارة.
-- الليد المغلق بيعاً لا يعود — أنجزت الشركة عملها.
create or replace function public.return_expired_broker_leads()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_today   date := (now() at time zone 'Asia/Baghdad')::date;
  r         record;
  n         integer := 0;
  v_days    integer;
begin
  -- 1) ما انتهت مهلته
  for r in
    select c.id, c.name, c.broker_company_id, bc.name as company_name
      from public.clients c
      join public.broker_companies bc on bc.id = c.broker_company_id
     where c.broker_company_id is not null
       and c.broker_deadline is not null
       and c.broker_deadline < v_today
       and coalesce(c.stage, 'ليد') <> 'بيع'
       and not exists (
         select 1 from public.reservations rs
          where rs.client_id = c.id and rs.status = 'بيع مكتمل'
       )
  loop
    -- المحفّزات تتكفّل بالتصفير وبتسجيل الانتقال
    update public.clients
       set broker_company_id = null,
           returned_at       = now(),
           returned_from     = r.broker_company_id
     where id = r.id;

    -- حسابات الشركة
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select bu.user_id,
           'انتهت مهلة الليد: ' || r.name,
           'مضى ' || public.broker_lead_days() || ' يوماً بلا إغلاق، فعاد الليد إلى تلال.',
           '/dashboard/broker/leads', 'ليد', r.id
      from public.broker_users bu where bu.company_id = r.broker_company_id;

    -- مدير العلاقات المسؤول عن هذه الشركة
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select distinct e.user_id,
           'عاد ليد إلى تلال: ' || r.name,
           'من ' || r.company_name || ' — انتهت المهلة بلا إغلاق.',
           '/dashboard/brokers/leads', 'ليد', r.id
      from public.broker_company_projects bcp
      join public.employees e on e.id = bcp.rm_id
     where bcp.company_id = r.broker_company_id and e.user_id is not null;

    -- الإدارة: عندها يُوزَّع الليد من جديد
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select p.id,
           'ليد عاد لتلال للتوزيع: ' || r.name,
           'من ' || r.company_name || ' — انتهت مهلة ' || public.broker_lead_days() || ' يوماً.',
           '/dashboard/brokers/leads', 'ليد', r.id
      from public.profiles p where p.role = 'admin';

    n := n + 1;
  end loop;

  -- 2) تنبيه مبكر: قبل ٣ أيام وقبل يوم واحد (مرة لكل حالة، فالفحص يومي)
  for r in
    select c.id, c.name, c.broker_company_id, (c.broker_deadline - v_today) as days_left
      from public.clients c
     where c.broker_company_id is not null
       and c.broker_deadline is not null
       and (c.broker_deadline - v_today) in (3, 1)
       and coalesce(c.stage, 'ليد') <> 'بيع'
       and not exists (
         select 1 from public.reservations rs
          where rs.client_id = c.id and rs.status = 'بيع مكتمل'
       )
  loop
    v_days := r.days_left;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select bu.user_id,
           'باقٍ ' || v_days || case when v_days = 1 then ' يوم' else ' أيام' end
             || ' على ليد: ' || r.name,
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

-- زرّ يدوي للإدارة (نفس نمط sql/027)
create or replace function public.run_broker_lead_scan()
returns integer language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'للمدير فقط';
  end if;
  return public.return_expired_broker_leads();
end; $fn$;

grant execute on function public.run_broker_lead_scan() to authenticated;

create extension if not exists pg_cron;

select cron.unschedule('broker-lead-scan')
 where exists (select 1 from cron.job where jobname = 'broker-lead-scan');

-- ٦:٠٥ UTC = ٩:٠٥ صباحاً بتوقيت بغداد (بعد فحص متابعات الـ CRM بدقائق)
select cron.schedule(
  'broker-lead-scan',
  '5 6 * * *',
  $cron$ select public.return_expired_broker_leads(); $cron$
);

-- ------------------------------------------------------------
-- 7) الصلاحيات
-- ------------------------------------------------------------
alter table public.broker_companies        enable row level security;
alter table public.broker_users            enable row level security;
alter table public.broker_company_projects enable row level security;
alter table public.broker_commissions      enable row level security;
alter table public.broker_payments         enable row level security;
alter table public.lead_transfers          enable row level security;

-- الشركات: الإدارة تديرها، والشركة ترى نفسها، ومدير العلاقات يرى من تحت مظلته
drop policy if exists "read broker companies" on public.broker_companies;
create policy "read broker companies" on public.broker_companies
  for select to authenticated
  using (
    (select public.is_admin())
    or id = (select public.my_broker_company())
    or id in (select m.company_id from public.my_rm_companies() m)
  );

drop policy if exists "admins manage broker companies" on public.broker_companies;
create policy "admins manage broker companies" on public.broker_companies
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read broker users" on public.broker_users;
create policy "read broker users" on public.broker_users
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or company_id in (select m.company_id from public.my_rm_companies() m)
  );

drop policy if exists "admins manage broker users" on public.broker_users;
create policy "admins manage broker users" on public.broker_users
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read broker projects" on public.broker_company_projects;
create policy "read broker projects" on public.broker_company_projects
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or rm_id = (select public.my_employee_id())
  );

drop policy if exists "admins manage broker projects" on public.broker_company_projects;
create policy "admins manage broker projects" on public.broker_company_projects
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- العمولات: الشركة ترى عمولاتها كاملة، ومدير العلاقات عمولات شركاته،
-- والإدارة وحدها تُنشئ وتعدّل وتصرف.
drop policy if exists "read broker commissions" on public.broker_commissions;
create policy "read broker commissions" on public.broker_commissions
  for select to authenticated
  using (
    (select public.is_admin())
    or company_id = (select public.my_broker_company())
    or company_id in (select m.company_id from public.my_rm_companies() m)
  );

drop policy if exists "admins manage broker commissions" on public.broker_commissions;
create policy "admins manage broker commissions" on public.broker_commissions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read broker payments" on public.broker_payments;
create policy "read broker payments" on public.broker_payments
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.broker_commissions bc
       where bc.id = broker_payments.commission_id
         and (
           bc.company_id = (select public.my_broker_company())
           or bc.company_id in (select m.company_id from public.my_rm_companies() m)
         )
    )
  );

drop policy if exists "admins manage broker payments" on public.broker_payments;
create policy "admins manage broker payments" on public.broker_payments
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- سجلّ انتقال الليد: للإدارة ولمن يخصّه الليد
drop policy if exists "read lead transfers" on public.lead_transfers;
create policy "read lead transfers" on public.lead_transfers
  for select to authenticated
  using (
    (select public.is_admin())
    or from_company_id = (select public.my_broker_company())
    or to_company_id   = (select public.my_broker_company())
    or from_company_id in (select m.company_id from public.my_rm_companies() m)
    or to_company_id   in (select m.company_id from public.my_rm_companies() m)
  );

-- ------------------------------------------------------------
-- 8) الليدات: رؤية الشركة ومدير العلاقات
-- ------------------------------------------------------------
-- ⚠️ نوسّع سياسات clients و client_activities مباشرةً، ولا نمسّ
--    `can_see_client()` — هي بوابة الفواتير والمدفوعات والحجوزات،
--    وتوسيعها كان يفتح مالية تلال لشركة وسيطة.
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or created_by = (select auth.uid())
    or (
      sales_employee is not null
      and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)
    )
    -- الشركة الوسيطة ترى كل ليدات شركتها
    or (broker_company_id is not null
        and broker_company_id = (select public.my_broker_company()))
    -- ومدير العلاقات يرى ليدات الشركات التي تحت مظلته
    or (broker_company_id is not null
        and broker_company_id in (select m.company_id from public.my_rm_companies() m))
  );

-- الإدخال: الشركة تُدخل ليداً لنفسها (المحفّز يفرض شركتها)، وفي مشروع
-- مُسنَد لها فقط — لا تُدخل ليداً في مشروع لا تعمل عليه.
drop policy if exists "insert clients" on public.clients;
create policy "insert clients" on public.clients
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (
      created_by = (select auth.uid())
      and (
        not (select public.is_broker())
        or (
          broker_company_id = (select public.my_broker_company())
          and project_id is not null
          and project_id in (select p.project_id from public.my_broker_projects() p)
        )
      )
    )
  );

-- التعديل: الشركة تعدّل ليداتها ومدير العلاقات يتابع ليدات شركاته.
-- ⚠️ لا تُمكّن أياً منهما من تغيير `broker_company_id` — الإسناد
--    وسحبُه قرار تلال وحدها. يفرضه محفّز أدناه لا السياسة، لأن RLS
--    تعمل على الصف لا على العمود.
drop policy if exists "update own clients" on public.clients;
create policy "update own clients" on public.clients
  for update to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
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
    or (sales_employee is not null
        and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
    or (broker_company_id is not null
        and broker_company_id = (select public.my_broker_company()))
    or (broker_company_id is not null
        and broker_company_id in (select m.company_id from public.my_rm_companies() m))
  );

-- من يملك تغيير صاحب الليد؟ الإدارة وحدها.
create or replace function public.guard_broker_assignment()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- ⚠️ بلا هذا السطر يتعطّل الفحص اليومي: وظيفة cron تعمل بلا مستخدم،
  --    فـ auth.uid() فارغة و is_admin() كاذبة، فيمنع النظامُ نفسَه من
  --    إعادة الليدات المنتهية مهلتها.
  if auth.uid() is null then
    return new;
  end if;

  if new.broker_company_id is distinct from old.broker_company_id
     and not public.is_admin() then
    raise exception 'إسناد الليد لشركة أو سحبه منها للإدارة فقط';
  end if;
  -- كذلك المهلة: تمديدها قرار إداري موثَّق لا تصرّف من الشركة
  if new.broker_deadline is distinct from old.broker_deadline
     and not public.is_admin() then
    raise exception 'تمديد مهلة الليد للإدارة فقط';
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_guard_broker_assignment on public.clients;
create trigger trg_guard_broker_assignment
  before update on public.clients
  for each row execute function public.guard_broker_assignment();

-- سجلّ التواصل يتبع الليد
drop policy if exists "read client activities" on public.client_activities;
create policy "read client activities" on public.client_activities
  for select to authenticated
  using (
    (select public.is_followup_manager())
    or (select public.can_see_client(client_id))
    or (select public.can_see_broker_lead(client_id))
  );

drop policy if exists "insert client activities" on public.client_activities;
create policy "insert client activities" on public.client_activities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_followup_manager())
      or (select public.can_see_client(client_id))
      or (select public.can_see_broker_lead(client_id))
    )
  );

-- المشاريع: الشركة ترى المشاريع المسندة لها وحدها (تحتاج اسمها عند
-- إدخال الليد).
--
-- ⚠️ `case` لا سلسلة `or`: شرط «مشروع بلا مشرف = مشترك» صحيح داخل
--    تلال، لكنه لو بقي ضمن الـ OR لأرى كلَّ مشروع بلا مشرف لشركة
--    خارجية. الفصل بين الداخلي والخارجي صريح هنا.
drop policy if exists "read projects in scope" on public.projects;
create policy "read projects in scope" on public.projects
  for select to authenticated
  using (
    case
      when (select public.is_broker()) then
        id in (select p.project_id from public.my_broker_projects() p)
      else
        (select public.is_admin())
        or (select public.is_followup_manager())
        or supervisor_id is null
        or id in (select m.id from public.my_project_ids() m)
        or id in (
          select bcp.project_id from public.broker_company_projects bcp
           where bcp.rm_id = (select public.my_employee_id())
        )
    end
  );

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 9) من يُغلق الليد؟ تلال لا الشركة
-- ------------------------------------------------------------
-- ⚠️ ثغرة أُغلقت قبل النشر: المهلة تسقط عن المرحلة «بيع»، والشركة
--    تملك تغيير مرحلة ليداتها — فكان بوسعها أن تعلن البيع بنفسها
--    فتحتفظ بالليد إلى الأبد بلا صفقة. الإغلاق قرار تلال (تسجيل حجز
--    «بيع مكتمل»)، فالمراحل المغلقة ممنوعة على حساب الوساطة.
create or replace function public.guard_broker_stage()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_broker()
     and new.stage is distinct from old.stage
     and new.stage in ('بيع', 'فشل البيع') then
    raise exception 'إغلاق الليد (بيع أو فشل) قرار تلال — سجّل تواصلك وتابع الصفقة معنا';
  end if;

  return new;
end; $fn$;

drop trigger if exists trg_guard_broker_stage on public.clients;
create trigger trg_guard_broker_stage
  before update of stage on public.clients
  for each row execute function public.guard_broker_stage();

-- وحزام ثانٍ داخل دالة الفحص: الليد الذي له حجز «بيع مكتمل» لا يعود
-- حتى لو لم تُحدَّث مرحلته — الواقع (صفقة مسجّلة) أقوى من حقل نصّي.
-- (الشرط مضاف إلى استعلامَي الدالة أعلاه:
--    and not exists (select 1 from public.reservations rs
--                     where rs.client_id = c.id and rs.status = 'بيع مكتمل')
--  وهو مطبَّق على القاعدة.)

notify pgrst, 'reload schema';
