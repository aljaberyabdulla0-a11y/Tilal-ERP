-- ============================================================
-- تلال ERP — المخزون ودور «مدير المتابعة»
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-08-26):
--   1) قسم مستقل للمخزون: مطبوعات، مياه، تنظيف، معطرات، مناديل،
--      مستلزمات مكتبية وغيرها — مع المشتريات والصرف وحركة كل مادة.
--   2) دور رابع «مدير المتابعة»: المخزون + الموظفون + الاتصالات
--      والمهام التشغيلية — **بلا محاسبة ولا رواتب ولا فواتير**.
--
-- المبدأ الحاكم للمخزون:
--     `inventory_items.quantity` **ليست حقلاً يُكتب فيه** — بل ناتج
--     جمع الحركات. لا أحد يعدّل الرصيد يدوياً؛ يسجّل حركة فيتغيّر
--     الرصيد. هكذا يبقى «ماء: شراء 100، صرف 20، المتبقي 80» صادقاً
--     دائماً، ولا يوجد رقمان يتناقضان.
--
-- المبدأ الحاكم للدور:
--     مدير المتابعة = عين تشغيلية واسعة **قراءةً**، وسلطة كاملة على
--     المخزون وحده. كل ما يمسّ المال (المحاسبة، الرواتب، الفواتير،
--     العمولات) يبقى خارج نطاقه تماماً.
--
-- يتطلب: sql/005 و sql/012 و sql/022 و sql/026 و sql/031 و sql/036 و sql/037.
-- آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الدور الرابع
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in ('admin', 'supervisor', 'followup_manager', 'employee'));

create or replace function public.is_followup_manager()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'followup_manager', false);
$fn$;

-- «من يدير المخزون» — المدير أو مدير المتابعة.
-- دالة واحدة تستعملها كل سياسات المخزون، فلو تغيّرت القاعدة يوماً
-- تُغيَّر في مكان واحد لا في عشرة.
create or replace function public.can_manage_inventory()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.is_followup_manager();
$fn$;

grant execute on function public.is_followup_manager()  to authenticated;
grant execute on function public.can_manage_inventory() to authenticated;

-- ------------------------------------------------------------
-- 2) الموردون
-- ------------------------------------------------------------
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  name           text not null unique,
  phone          text,
  contact_person text,          -- الشخص المسؤول عند المورد
  address        text,
  is_active      boolean not null default true,
  notes          text
);

-- ------------------------------------------------------------
-- 3) المواد
-- ------------------------------------------------------------
create table if not exists public.inventory_items (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  name         text not null,
  category     text not null default 'مستلزمات أخرى',
  unit         text not null default 'قطعة',        -- وحدة القياس

  -- ⚠️ محسوبة من الحركات لا تُكتب باليد (انظر recalc_inventory_item)
  quantity     numeric(14,2) not null default 0,
  min_quantity numeric(14,2) not null default 0,    -- الحد الأدنى للتنبيه

  supplier_id  uuid references public.suppliers(id) on delete set null, -- المورد المعتاد

  -- آخر شراء — يملؤهما المحفّز من آخر حركة شراء، للعرض السريع
  last_purchase_date  date,
  last_purchase_price numeric(14,2),

  is_active    boolean not null default true,
  notes        text
);

alter table public.inventory_items drop constraint if exists inventory_items_category_chk;
alter table public.inventory_items
  add constraint inventory_items_category_chk
  check (category in (
    'مطبوعات ومواد تسويقية',
    'مياه شرب',
    'مواد تنظيف',
    'معطرات',
    'مناديل',
    'مستلزمات مكتبية',
    'ضيافة',
    'مستلزمات أخرى'
  ));

-- اسم المادة فريد بمقارنة متسامحة (مسافات زائدة/حالة أحرف)،
-- حتى لا تظهر «ماء» و«  ماء » كمادتين منفصلتين لكل منهما رصيد.
create unique index if not exists inventory_items_name_uidx
  on public.inventory_items (public.name_key(name));

create index if not exists inventory_items_category_idx on public.inventory_items (category);
create index if not exists inventory_items_supplier_idx on public.inventory_items (supplier_id);

-- ------------------------------------------------------------
-- 4) حركة المخزون — سجلّ لا يُمحى: كل شراء وكل صرف
-- ------------------------------------------------------------
create table if not exists public.inventory_moves (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  actor_name  text,                       -- اسم من سجّل الحركة وقتها

  item_id     uuid not null references public.inventory_items(id) on delete cascade,
  kind        text not null,              -- شراء | صرف | تسوية
  quantity    numeric(14,2) not null,

  unit_price  numeric(14,2),              -- سعر شراء الوحدة (للشراء)
  total_price numeric(16,2)
    generated always as (quantity * coalesce(unit_price, 0)) stored,

  supplier_id uuid references public.suppliers(id) on delete set null,
  moved_at    date not null default (now() at time zone 'Asia/Baghdad')::date,
  issued_to   text,                       -- صُرف إلى: قسم أو شخص
  notes       text
);

alter table public.inventory_moves drop constraint if exists inventory_moves_kind_chk;
alter table public.inventory_moves
  add constraint inventory_moves_kind_chk
  check (kind in ('شراء', 'صرف', 'تسوية'));

-- الشراء والصرف كمّيتهما موجبة دائماً (الاتجاه يحدّده النوع لا الإشارة).
-- التسوية وحدها تقبل السالب — لأنها تصحيح جرد قد يزيد أو ينقص.
alter table public.inventory_moves drop constraint if exists inventory_moves_qty_chk;
alter table public.inventory_moves
  add constraint inventory_moves_qty_chk
  check (
    (kind in ('شراء', 'صرف') and quantity > 0)
    or (kind = 'تسوية' and quantity <> 0)
  );

create index if not exists inventory_moves_item_idx on public.inventory_moves (item_id, moved_at desc);
create index if not exists inventory_moves_kind_idx on public.inventory_moves (kind, moved_at desc);
create index if not exists inventory_moves_date_idx on public.inventory_moves (moved_at desc);

-- ------------------------------------------------------------
-- 5) ختم صاحب الحركة داخل القاعدة (لا يُزوَّر من الواجهة)
-- ------------------------------------------------------------
create or replace function public.stamp_inventory_move()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.actor_name is null then
    new.actor_name := coalesce(
      public.my_employee_name(),
      (select p.email from public.profiles p where p.id = auth.uid())
    );
  end if;
  return new;
end; $fn$;

drop trigger if exists trg_stamp_inventory_move on public.inventory_moves;
create trigger trg_stamp_inventory_move
  before insert on public.inventory_moves
  for each row execute function public.stamp_inventory_move();

create or replace function public.stamp_inventory_owner()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end; $fn$;

drop trigger if exists trg_stamp_inventory_item on public.inventory_items;
create trigger trg_stamp_inventory_item
  before insert on public.inventory_items
  for each row execute function public.stamp_inventory_owner();

drop trigger if exists trg_stamp_supplier on public.suppliers;
create trigger trg_stamp_supplier
  before insert on public.suppliers
  for each row execute function public.stamp_inventory_owner();

-- ------------------------------------------------------------
-- 6) إعادة حساب رصيد المادة + تنبيه انخفاض المخزون
-- ------------------------------------------------------------
-- نعيد الحساب من مجموع الحركات كاملاً بدل جمع الفرق على الرصيد
-- القديم: أبطأ بقليل، لكنه **يصحّح نفسه** — أي حركة عُدّلت أو حُذفت
-- أو صفّ أُدخل من محرّر SQL يعود الرصيد بعده صحيحاً.
create or replace function public.recalc_inventory_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  it      public.inventory_items%rowtype;
  new_qty numeric(14,2);
begin
  select * into it from public.inventory_items where id = p_item;
  if not found then
    return;
  end if;

  select coalesce(sum(
           case m.kind
             when 'شراء' then  m.quantity
             when 'صرف'  then -m.quantity
             else              m.quantity      -- تسوية: الإشارة كما أُدخلت
           end), 0)
    into new_qty
    from public.inventory_moves m
   where m.item_id = p_item;

  update public.inventory_items i
     set quantity = new_qty,
         last_purchase_date = (
           select max(m.moved_at) from public.inventory_moves m
            where m.item_id = p_item and m.kind = 'شراء'
         ),
         last_purchase_price = (
           select m.unit_price from public.inventory_moves m
            where m.item_id = p_item and m.kind = 'شراء' and m.unit_price is not null
            order by m.moved_at desc, m.created_at desc
            limit 1
         )
   where i.id = p_item;

  -- التنبيه عند **عبور** الحد الأدنى نزولاً لا في كل حركة بعده،
  -- وإلا امتلأ جرس الإشعارات بنفس الرسالة عشرات المرات.
  if it.min_quantity > 0 and new_qty < it.min_quantity and it.quantity >= it.min_quantity then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select p.id,
           'مخزون منخفض: ' || it.name,
           'المتبقي ' || trim(to_char(new_qty, 'FM999999990.99')) || ' ' || it.unit
             || ' — الحد الأدنى ' || trim(to_char(it.min_quantity, 'FM999999990.99')) || ' ' || it.unit,
           '/dashboard/inventory',
           'مخزون',
           p_item
      from public.profiles p
     where p.role in ('admin', 'followup_manager');
  end if;
end; $fn$;

create or replace function public.on_inventory_move_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalc_inventory_item(new.item_id);
  end if;
  -- تعديل ينقل الحركة من مادة لأخرى: المادتان تحتاجان إعادة حساب
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_inventory_item(old.item_id);
  end if;
  return null;
end; $fn$;

drop trigger if exists trg_inventory_move_change on public.inventory_moves;
create trigger trg_inventory_move_change
  after insert or update or delete on public.inventory_moves
  for each row execute function public.on_inventory_move_change();

-- تصحيح أرصدة أي مواد موجودة (لا شيء عند أول تشغيل)
do $blk$
declare r record;
begin
  for r in select id from public.inventory_items loop
    perform public.recalc_inventory_item(r.id);
  end loop;
end $blk$;

-- ------------------------------------------------------------
-- 7) صلاحيات المخزون
-- ------------------------------------------------------------
-- المخزون قسم مغلق: المدير ومدير المتابعة وحدهما. الموظف العادي
-- لا يرى مشتريات الشركة ولا أسعارها ولا مورّديها.
alter table public.suppliers        enable row level security;
alter table public.inventory_items  enable row level security;
alter table public.inventory_moves  enable row level security;

drop policy if exists "inventory read suppliers"   on public.suppliers;
create policy "inventory read suppliers" on public.suppliers
  for select to authenticated using ((select public.can_manage_inventory()));

drop policy if exists "inventory manage suppliers" on public.suppliers;
create policy "inventory manage suppliers" on public.suppliers
  for all to authenticated
  using ((select public.can_manage_inventory()))
  with check ((select public.can_manage_inventory()));

drop policy if exists "inventory read items"   on public.inventory_items;
create policy "inventory read items" on public.inventory_items
  for select to authenticated using ((select public.can_manage_inventory()));

drop policy if exists "inventory manage items" on public.inventory_items;
create policy "inventory manage items" on public.inventory_items
  for all to authenticated
  using ((select public.can_manage_inventory()))
  with check ((select public.can_manage_inventory()));

drop policy if exists "inventory read moves"   on public.inventory_moves;
create policy "inventory read moves" on public.inventory_moves
  for select to authenticated using ((select public.can_manage_inventory()));

drop policy if exists "inventory insert moves" on public.inventory_moves;
create policy "inventory insert moves" on public.inventory_moves
  for insert to authenticated
  with check (
    (select public.can_manage_inventory())
    and created_by = (select auth.uid())
  );

-- التعديل والحذف: من سجّل الحركة أو المدير.
-- سجلّ الحركة أساس الرصيد، فلا نجعله مفتوحاً للجميع — من أخطأ
-- في تسجيله يصحّحه، ومن سواه يرجع للمدير.
drop policy if exists "inventory update moves" on public.inventory_moves;
create policy "inventory update moves" on public.inventory_moves
  for update to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()))
  with check ((select public.is_admin()) or created_by = (select auth.uid()));

drop policy if exists "inventory delete moves" on public.inventory_moves;
create policy "inventory delete moves" on public.inventory_moves
  for delete to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()));

-- ------------------------------------------------------------
-- 8) نطاق مدير المتابعة خارج المخزون — **قراءة تشغيلية**
-- ------------------------------------------------------------
-- الموظفون: من المنظور الآمن لا من جدول employees، فلا رواتب ولا
-- عمولات (RLS تعمل على الصف لا العمود — انظر sql/037).
drop view if exists public.team_members;
create view public.team_members
with (security_invoker = false) as
  select e.id, e.user_id, e.full_name, e.job_title, e.department,
         e.phone, e.hire_date, e.status, e.project_id,
         e.exempt_from_attendance, e.work_start_time, e.work_end_time, e.work_days
    from public.employees e
   where public.is_admin()
      or public.is_followup_manager()
      or e.id in (select m.id from public.my_scope_employees() m);

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

-- الحضور والإجازات: يتابعهما ولا يبتّ فيهما.
-- (لا سياسة update له على leaves عمداً — الموافقة للمدير والمشرف.)
drop policy if exists "read attendance in scope" on public.attendance;
create policy "read attendance in scope" on public.attendance
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or employee_id in (select m.id from public.my_scope_employees() m)
  );

drop policy if exists "read leaves in scope" on public.leaves;
create policy "read leaves in scope" on public.leaves
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or employee_id in (select m.id from public.my_scope_employees() m)
  );

-- الاتصالات والمتابعات: يرى العملاء وسجلّ التواصل كله ويسجّل تواصلاً.
--
-- ⚠️ وُسِّعت سياسات العملاء وسجلّ التواصل مباشرةً، ولم تُوسَّع الدالة
--    `can_see_client()` — لأنها هي نفسها بوابة **الفواتير والمدفوعات
--    والحجوزات**. توسيعها كان يفتح له المال من الباب الخلفي.
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
  );

drop policy if exists "read client activities" on public.client_activities;
create policy "read client activities" on public.client_activities
  for select to authenticated
  using (
    (select public.is_followup_manager())
    or (select public.can_see_client(client_id))
  );

drop policy if exists "insert client activities" on public.client_activities;
create policy "insert client activities" on public.client_activities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_followup_manager())
      or (select public.can_see_client(client_id))
    )
  );

-- المهام: يتابع المفتوح والمتأخر، ويسند مهمة متابعة لمن يلزم،
-- ويغلقها حين تُنجز.
drop policy if exists "read my tasks" on public.tasks;
create policy "read my tasks" on public.tasks
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or (select public.is_followup_manager())
      or assigned_to = (select auth.uid())
      or assigned_to in (select u.user_id from public.my_scope_users() u)
    )
  );

drop policy if exists "update my tasks" on public.tasks;
create policy "update my tasks" on public.tasks
  for update to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  )
  with check (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
    or assigned_to in (select u.user_id from public.my_scope_users() u)
  );

-- المشاريع: يقرأ أسماءها ليعرف على أي مشروع يعمل كل موظف
drop policy if exists "read projects in scope" on public.projects;
create policy "read projects in scope" on public.projects
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or supervisor_id is null
    or id in (select m.id from public.my_project_ids() m)
  );

notify pgrst, 'reload schema';
