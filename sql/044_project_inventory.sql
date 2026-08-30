-- ============================================================
-- 044 — مخزون المشاريع العقارية (Real Estate Inventory)
--
-- يحوّل المشروع من بطاقة معلومات إلى مخزون كامل: هيكل ديناميكي
-- (برج ← طابق ← وحدة) أو (مرحلة ← دار)، ووحدات بحقول تتبدّل حسب
-- نوعها، وحالة تحكم ما يجوز عليها، وسجل يروي تاريخها، وربط مباشر
-- بالفواتير والدفعات.
--
-- ⚠️ إضافي بالكامل: لا يحذف عموداً ولا سياسة قائمة. الجداول
-- والأعمدة الجديدة كلها اختيارية، فالوحدات القديمة تبقى صالحة
-- بلا هيكل (node_id فارغ) وتظهر تحت «غير مصنّف».
-- ============================================================

-- ============================================================
-- 1) أنواع الوحدات — جدول لا قائمة ثابتة في الكود
--
-- المطلوب نظام يقبل أنواعاً جديدة بلا إعادة بناء. لذلك النوع
-- صفٌّ في جدول، و category هي التي تقرّر أي حقول تظهر في النموذج:
--   عمودي  → طابق وغرف وشرفة وإطلالة (شقة، دوبلكس)
--   أفقي   → مساحة أرض وبناء وعدد طوابق وحديقة (دار، فيلا)
--   تجاري  → واجهة ومساحة
--   أرض    → مساحة أرض فقط
-- فإضافة نوع جديد = صفّ واحد، لا سطر كود.
-- ============================================================
create table if not exists public.unit_types (
  name       text primary key,
  category   text not null default 'أخرى'
             check (category in ('عمودي', 'أفقي', 'تجاري', 'أرض', 'أخرى')),
  sort_order int  not null default 100,
  active     boolean not null default true
);

comment on table public.unit_types is
  'أنواع الوحدات العقارية. category تقرّر أي حقول تظهر في نموذج الوحدة.';

insert into public.unit_types (name, category, sort_order) values
  ('شقة',        'عمودي', 1),
  ('دوبلكس',     'عمودي', 2),
  ('دار',        'أفقي',  3),
  ('فيلا',       'أفقي',  4),
  ('تاون هاوس',  'أفقي',  5),
  ('محل تجاري',  'تجاري', 6),
  ('مكتب',       'تجاري', 7),
  ('أرض',        'أرض',   8),
  ('أخرى',       'أخرى',  99)
on conflict (name) do nothing;

-- أي نوع مستعمل في بيانات قائمة ولم يُذكر أعلاه يُسجَّل كما هو،
-- حتى لا يفشل المفتاح الأجنبي على صفوف موجودة.
insert into public.unit_types (name, category, sort_order)
select distinct u.unit_type, 'أخرى', 50
from public.units u
where u.unit_type is not null
  and not exists (select 1 from public.unit_types t where t.name = u.unit_type);

alter table public.units drop constraint if exists units_unit_type_fk;
alter table public.units add constraint units_unit_type_fk
  foreign key (unit_type) references public.unit_types(name) on update cascade;

-- ============================================================
-- 2) هيكل المشروع — شجرة واحدة تكفي كل الأشكال
--
-- بدل جدول للأبراج وآخر للطوابق وثالث للمراحل، جدول واحد يشير
-- إلى نفسه. برج داخل مشروع، وطابق داخل برج، ودار داخل مرحلة —
-- كلها صفوف بنفس الشكل يفرّق بينها kind. وهكذا يقبل النظام أي
-- هيكل جديد غداً بلا هجرة.
-- ============================================================
alter table public.projects
  add column if not exists structure_kinds text[] not null default '{}';

comment on column public.projects.structure_kinds is
  'مستويات هيكل هذا المشروع بالترتيب، مثل {برج,طابق} أو {مرحلة}. فارغ = بلا هيكل.';

create table if not exists public.project_nodes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id  uuid references public.project_nodes(id) on delete cascade,
  kind       text not null
             check (kind in ('برج', 'مبنى', 'طابق', 'مرحلة', 'مجمع', 'منطقة')),
  name       text not null,
  sort_order int  not null default 0,
  depth      int  not null default 0,
  path       text not null default '',
  notes      text
);

create index if not exists idx_project_nodes_project on public.project_nodes(project_id, sort_order);
create index if not exists idx_project_nodes_parent  on public.project_nodes(parent_id, sort_order);

-- اسم المستوى فريد داخل أبيه — «الطابق 01» مرّتين في نفس البرج خطأ
create unique index if not exists uq_project_node_name_root
  on public.project_nodes(project_id, name) where parent_id is null;
create unique index if not exists uq_project_node_name_child
  on public.project_nodes(parent_id, name) where parent_id is not null;

-- المسار والعمق يُحسبان لا يُدخلان: المستخدم يكتب «الطابق 01»
-- والنظام يبني «برج A / الطابق 01» ليعرضه ويبحث فيه.
create or replace function public.stamp_project_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.project_nodes%rowtype;
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'اسم المستوى مطلوب';
  end if;

  if new.parent_id is null then
    new.depth := 0;
    new.path  := new.name;
  else
    select * into p from public.project_nodes where id = new.parent_id;
    if not found then
      raise exception 'المستوى الأب غير موجود';
    end if;
    if p.project_id <> new.project_id then
      raise exception 'لا يمكن ربط مستوى بمشروع غير مشروع أبيه';
    end if;
    if p.id = new.id then
      raise exception 'لا يمكن أن يكون المستوى أباً لنفسه';
    end if;
    if p.depth >= 3 then
      raise exception 'أقصى عمق للهيكل أربعة مستويات';
    end if;
    new.depth := p.depth + 1;
    new.path  := p.path || ' / ' || new.name;
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_project_node on public.project_nodes;
create trigger trg_stamp_project_node
  before insert or update of name, parent_id, project_id on public.project_nodes
  for each row execute function public.stamp_project_node();

-- تغيّر اسم برج ⇒ تتغيّر مسارات كل ما تحته. نلمس الأبناء فيعيد
-- محفّزهم حساب مسارهم من الأب الجديد، فيتسلسل التصحيح لأسفل وحده.
create or replace function public.repath_project_nodes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.path is distinct from old.path then
    -- الأبناء يعيدون حساب مسارهم بأنفسهم، فيتسلسل التصحيح لأسفل
    update public.project_nodes set name = name where parent_id = new.id;
    update public.units set node_id = node_id where node_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_repath_project_nodes on public.project_nodes;
create trigger trg_repath_project_nodes
  after update on public.project_nodes
  for each row execute function public.repath_project_nodes();

-- ============================================================
-- 3) الوحدة — حقول ثابتة لما يُبحث به، و attrs لما لا يُبحث
--
-- ما يُصفّى به (غرف، حمّامات، مساحات) عمودٌ حقيقي لأن الفهرس
-- لا يعمل على jsonb بلا عناء. وما يُقرأ فقط (إطلالة، شرفة،
-- موديل الفيلا) داخل attrs، فيُضاف حقل جديد بلا هجرة.
-- ============================================================
alter table public.units
  add column if not exists node_id         uuid references public.project_nodes(id) on delete set null,
  add column if not exists node_path       text,
  add column if not exists bathrooms       int,
  add column if not exists land_area_m2    numeric,
  add column if not exists built_area_m2   numeric,
  add column if not exists floors_count    int,
  add column if not exists parking_spaces  int,
  add column if not exists price_per_m2    numeric,
  add column if not exists payment_plan    text,
  add column if not exists blocked_reason  text,
  add column if not exists sold_at         date,
  add column if not exists attrs           jsonb not null default '{}'::jsonb;

comment on column public.units.node_path is
  'مسار الوحدة داخل الهيكل («برج A / الطابق 01») — محسوب للعرض والبحث.';
comment on column public.units.attrs is
  'حقول النوع التي لا يُصفّى بها: إطلالة، شرفة، حديقة، سطح، موديل…';

create index if not exists idx_units_node    on public.units(node_id);
create index if not exists idx_units_status  on public.units(project_id, status);

-- الحالة الرابعة: موقوفة — وحدة لا تُباع ولا تُحجز حتى يُرفع الإيقاف
update public.units set status = 'متاحة'
where status not in ('متاحة', 'محجوزة', 'مباعة', 'موقوفة');

alter table public.units drop constraint if exists units_status_check;
alter table public.units add constraint units_status_check
  check (status in ('متاحة', 'محجوزة', 'مباعة', 'موقوفة'));

create or replace function public.stamp_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.project_nodes%rowtype;
begin
  -- المشروع يُشتقّ من الهيكل: وحدة داخل «برج A» مشروعها مشروع البرج،
  -- فلا يمكن أن تُنسب لمشروع وتُوضع في هيكل مشروع آخر.
  if new.node_id is not null then
    select * into n from public.project_nodes where id = new.node_id;
    if not found then
      raise exception 'المستوى غير موجود';
    end if;
    new.project_id := n.project_id;
    new.node_path  := n.path;
  else
    new.node_path := null;
  end if;

  -- المحفّز القديم trg_sync_unit_project لا يشتعل إلا إذا ذكر الطلب
  -- عمود project_id صراحةً، وتغييرُنا له هنا لا يذكره — فنملأ الاسم
  -- بأنفسنا لئلا يبقى اسم مشروع قديم على وحدة نُقلت.
  if new.project_id is not null then
    select p.name into new.project from public.projects p where p.id = new.project_id;
  end if;

  new.price_per_m2 := case
    when coalesce(new.space_m2, 0) > 0 and new.price is not null
    then round(new.price / new.space_m2)
  end;

  -- سبب الإيقاف لا معنى له إن لم تكن موقوفة
  if new.status <> 'موقوفة' then
    new.blocked_reason := null;
  end if;
  if new.status = 'مباعة' and new.sold_at is null then
    new.sold_at := (now() at time zone 'Asia/Baghdad')::date;
  elsif new.status <> 'مباعة' then
    new.sold_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stamp_unit on public.units;
create trigger trg_stamp_unit
  before insert or update on public.units
  for each row execute function public.stamp_unit();

-- ============================================================
-- 4) سجل الوحدة — من فعل ماذا ومتى
--
-- تُكتب سطوره من المحفّزات لا من التطبيق، فلا تفوت عملية لأن
-- شاشة نسيت أن تسجّلها.
-- ============================================================
create table if not exists public.unit_events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unit_id    uuid not null references public.units(id) on delete cascade,
  kind       text not null,
  detail     text,
  actor      uuid references auth.users(id) on delete set null,
  actor_name text
);

create index if not exists idx_unit_events_unit on public.unit_events(unit_id, created_at desc);

create or replace function public.log_unit_event(p_unit uuid, p_kind text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  select coalesce(e.full_name, p.email, 'النظام')
    into who
  from public.profiles p
  left join public.employees e on e.user_id = p.id
  where p.id = auth.uid();

  insert into public.unit_events (unit_id, kind, detail, actor, actor_name)
  values (p_unit, p_kind, p_detail, auth.uid(), coalesce(who, 'النظام'));
end;
$$;

create or replace function public.track_unit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_unit_event(new.id, 'إنشاء',
      'أُنشئت الوحدة ' || coalesce(new.unit_code, '') ||
      case when new.node_path is not null then ' في ' || new.node_path else '' end);
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.log_unit_event(new.id, 'تغيير حالة',
      'من ' || old.status || ' إلى ' || new.status ||
      case when new.status = 'موقوفة' and new.blocked_reason is not null
           then ' — ' || new.blocked_reason else '' end);
  end if;

  if new.price is distinct from old.price then
    perform public.log_unit_event(new.id, 'تعديل سعر',
      'من ' || coalesce(public.fmt_qty(old.price), '—') ||
      ' إلى ' || coalesce(public.fmt_qty(new.price), '—') || ' د.ع');
  end if;

  if new.node_id is distinct from old.node_id then
    perform public.log_unit_event(new.id, 'نقل',
      'إلى ' || coalesce(new.node_path, 'خارج الهيكل'));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_track_unit_changes on public.units;
create trigger trg_track_unit_changes
  after insert or update on public.units
  for each row execute function public.track_unit_changes();

-- ============================================================
-- 5) الحجز والبيع
--
-- حالة الوحدة تتبع حجوزاتها آلياً، فلا تبقى «متاحة» بعد حجزها
-- لأن أحداً نسي تحديثها يدوياً.
-- ============================================================
alter table public.reservations
  add column if not exists expiry_date     date,
  add column if not exists agent_id        uuid references public.employees(id) on delete set null,
  add column if not exists agent_name      text,
  add column if not exists created_by_name text;

create index if not exists idx_reservations_unit on public.reservations(unit_id);

-- لا حجز على مباعة ولا على موقوفة
create or replace function public.guard_reservation_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.units%rowtype;
begin
  select * into u from public.units where id = new.unit_id;
  if not found then
    raise exception 'الوحدة غير موجودة';
  end if;

  if tg_op = 'INSERT' and new.status <> 'ملغى' then
    if u.status = 'مباعة' then
      raise exception 'الوحدة % مباعة — لا يجوز حجزها', coalesce(u.unit_code, '');
    end if;
    if u.status = 'موقوفة' then
      raise exception 'الوحدة % موقوفة — ارفع الإيقاف أولاً', coalesce(u.unit_code, '');
    end if;
    if u.status = 'محجوزة' and exists (
      select 1 from public.reservations r
      where r.unit_id = new.unit_id and r.status = 'حجز' and r.id <> new.id
    ) then
      raise exception 'الوحدة % محجوزة بالفعل', coalesce(u.unit_code, '');
    end if;
  end if;

  if new.agent_id is null then
    new.agent_id := public.my_employee_id();
  end if;
  if new.agent_name is null and new.agent_id is not null then
    select full_name into new.agent_name from public.employees where id = new.agent_id;
  end if;
  if new.created_by_name is null then
    select coalesce(e.full_name, p.email)
      into new.created_by_name
    from public.profiles p
    left join public.employees e on e.user_id = p.id
    where p.id = auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_reservation_unit on public.reservations;
create trigger trg_guard_reservation_unit
  before insert or update on public.reservations
  for each row execute function public.guard_reservation_unit();

create or replace function public.sync_unit_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target text;
  cur    text;
begin
  select status into cur from public.units where id = new.unit_id;
  if cur = 'موقوفة' then
    return null;              -- الإيقاف قرار إداري، لا يلغيه حجز
  end if;

  target := case new.status
    when 'حجز'        then 'محجوزة'
    when 'بيع مكتمل'  then 'مباعة'
    else case
      when exists (select 1 from public.reservations r
                   where r.unit_id = new.unit_id and r.status = 'حجز')
        then 'محجوزة'
      when exists (select 1 from public.reservations r
                   where r.unit_id = new.unit_id and r.status = 'بيع مكتمل')
        then 'مباعة'
      else 'متاحة'
    end
  end;

  if target is distinct from cur then
    update public.units set status = target where id = new.unit_id;
  end if;

  perform public.log_unit_event(new.unit_id,
    case new.status when 'حجز' then 'حجز'
                    when 'بيع مكتمل' then 'بيع'
                    else 'إلغاء حجز' end,
    case new.status
      when 'ملغى' then 'أُلغي الحجز'
      else 'العميل ' || coalesce((select name from public.clients where id = new.client_id), '—') ||
           case when new.amount is not null
                then ' — ' || public.fmt_qty(new.amount) || ' د.ع' else '' end
    end);

  return null;
end;
$$;

drop trigger if exists trg_sync_unit_from_reservation on public.reservations;
create trigger trg_sync_unit_from_reservation
  after insert or update of status on public.reservations
  for each row execute function public.sync_unit_from_reservation();

-- ============================================================
-- 6) الفواتير والدفعات مربوطة بالوحدة مباشرة
--
-- كانت الفاتورة تصل الوحدة عبر الحجز فقط، فإن حُذف الحجز ضاع
-- الأثر. صار unit_id عموداً ثابتاً يُملأ من الحجز آلياً.
-- ============================================================
alter table public.invoices
  add column if not exists unit_id uuid references public.units(id) on delete set null;

create index if not exists idx_invoices_unit on public.invoices(unit_id);

create or replace function public.stamp_invoice_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_id is null and new.reservation_id is not null then
    select unit_id into new.unit_id from public.reservations where id = new.reservation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_invoice_unit on public.invoices;
create trigger trg_stamp_invoice_unit
  before insert or update of reservation_id, unit_id on public.invoices
  for each row execute function public.stamp_invoice_unit();

update public.invoices i
set unit_id = r.unit_id
from public.reservations r
where i.reservation_id = r.id and i.unit_id is null;

create or replace function public.log_invoice_on_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_id is not null then
    perform public.log_unit_event(new.unit_id, 'فاتورة',
      'فاتورة ' || new.invoice_number || ' بمبلغ ' ||
      public.fmt_qty(new.total_amount) || ' د.ع');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_invoice_on_unit on public.invoices;
create trigger trg_log_invoice_on_unit
  after insert on public.invoices
  for each row execute function public.log_invoice_on_unit();

create or replace function public.log_payment_on_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
  n text;
begin
  select i.unit_id, i.invoice_number into u, n
  from public.invoices i where i.id = new.invoice_id;

  if u is not null then
    perform public.log_unit_event(u, 'دفعة',
      'دفعة ' || public.fmt_qty(new.amount) || ' د.ع على الفاتورة ' || n);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_payment_on_unit on public.payments;
create trigger trg_log_payment_on_unit
  after insert on public.payments
  for each row execute function public.log_payment_on_unit();

-- ============================================================
-- 7) الوضع المالي للوحدة — يُحسب لا يُخزَّن
--
-- المجموع المخزَّن يكذب بعد أول تعديل على فاتورة أو دفعة، لذلك
-- يُقرأ من مصدره في كل مرة.
-- ============================================================
-- security_invoker: الرؤية تُقرأ بصلاحية القارئ لا بصلاحية مالكها،
-- وإلا لالتفّت على RLS وكشفت مالية وحدات لا يراها المستخدم.
create or replace view public.unit_finance
with (security_invoker = true) as
select
  u.id                    as unit_id,
  u.price                 as unit_price,
  coalesce(inv.total, 0)  as invoiced,
  coalesce(pay.total, 0)  as paid,
  coalesce(inv.total, 0) - coalesce(pay.total, 0) as remaining
from public.units u
left join lateral (
  select sum(i.total_amount) as total
  from public.invoices i where i.unit_id = u.id
) inv on true
left join lateral (
  select sum(p.amount) as total
  from public.payments p
  join public.invoices i2 on i2.id = p.invoice_id
  where i2.unit_id = u.id
) pay on true;

-- ============================================================
-- 8) الصلاحيات
--
-- الفصل قائم على الأدوار الموجودة لا على مصفوفة جديدة:
--   المدير  : كل شيء.
--   المشرف  : وحدات مشاريعه — إنشاء وتعديل ونقل، وحجز وإلغاء حجز.
--   الموظف  : يقرأ الوحدات ويحجز لعملائه، ولا يعدّل وحدة ولا سعراً.
-- والسعر والإيقاف والحذف للمدير وحده، لأنها قرارات مالية وإدارية.
-- ============================================================
create or replace function public.can_manage_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or (public.is_supervisor() and p in (select id from public.my_supervised_projects()));
$$;

-- المشرف يعدّل وحدات مشروعه لكن لا يمسّ السعر ولا يوقف وحدة
create or replace function public.guard_unit_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.price is distinct from old.price then
      raise exception 'تعديل سعر الوحدة للمدير وحده';
    end if;
    if (new.status = 'موقوفة') is distinct from (old.status = 'موقوفة') then
      raise exception 'إيقاف الوحدة ورفع الإيقاف للمدير وحده';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_unit_authority on public.units;
create trigger trg_guard_unit_authority
  before update on public.units
  for each row execute function public.guard_unit_authority();

-- ===== RLS =====
alter table public.unit_types    enable row level security;
alter table public.project_nodes enable row level security;
alter table public.unit_events   enable row level security;

drop policy if exists "read unit types" on public.unit_types;
create policy "read unit types" on public.unit_types
  for select to authenticated using (true);

drop policy if exists "admin manages unit types" on public.unit_types;
create policy "admin manages unit types" on public.unit_types
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- الهيكل يُرى مع مشروعه: من رأى المشروع رأى أبراجه وطوابقه
drop policy if exists "read project nodes" on public.project_nodes;
create policy "read project nodes" on public.project_nodes
  for select to authenticated
  using (project_id in (select id from public.projects));

drop policy if exists "manage project nodes" on public.project_nodes;
create policy "manage project nodes" on public.project_nodes
  for all to authenticated
  using ((select public.can_manage_project(project_id)))
  with check ((select public.can_manage_project(project_id)));

drop policy if exists "read unit events" on public.unit_events;
create policy "read unit events" on public.unit_events
  for select to authenticated
  using (unit_id in (select id from public.units));

-- لا سياسة كتابة: السجل تكتبه المحفّزات وحدها (security definer)،
-- فلا يستطيع مستخدم تلفيق سطر فيه.

-- إنشاء الوحدات كان مفتوحاً لكل مسجّل دخول — يُضبط على من يملك المشروع
drop policy if exists "authenticated can insert units" on public.units;
drop policy if exists "insert units in scope" on public.units;
create policy "insert units in scope" on public.units
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (project_id is not null and (select public.can_manage_project(project_id)))
  );
