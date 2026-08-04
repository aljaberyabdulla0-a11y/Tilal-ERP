-- ============================================================
-- تلال ERP — الإجازة الزمنية (بالساعات) + نظام الإشعارات
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يضيفه:
--   1) نوع مدّة للإجازة: «يوم كامل» أو «ساعات» (إجازة زمنية داخل نفس اليوم)
--      مع حساب الأيام/الساعات تلقائياً داخل قاعدة البيانات.
--   2) جدول إشعارات (notifications) لكل مستخدم.
--   3) إشعار تلقائي لكل المدراء عند تقديم طلب إجازة.
--   4) إشعار تلقائي للموظف عند الموافقة على إجازته أو رفضها.
--
-- يتطلب: sql/005 (الأدوار) و sql/012 (HR). الملف آمن لإعادة التشغيل.
-- ============================================================

-- ============================================================
-- الجزء الأول: الإجازة الزمنية (بالساعات)
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة جديدة على جدول الإجازات
-- ------------------------------------------------------------
alter table public.leaves
  add column if not exists duration_type text not null default 'يوم كامل', -- يوم كامل | ساعات
  add column if not exists start_time    time,      -- وقت بداية الإجازة الزمنية
  add column if not exists end_time      time,      -- وقت نهايتها
  add column if not exists hours         numeric(5,2); -- عدد الساعات (للإجازة الزمنية)

alter table public.leaves drop constraint if exists leaves_duration_type_chk;
alter table public.leaves add constraint leaves_duration_type_chk
  check (duration_type in ('يوم كامل', 'ساعات'));

-- ------------------------------------------------------------
-- 2) ضبط وحساب مدّة الإجازة تلقائياً قبل الحفظ
--    (لا نثق بما يرسله المتصفح — الحساب يتم هنا)
-- ------------------------------------------------------------
create or replace function public.normalize_leave()
returns trigger language plpgsql as $$
begin
  if new.duration_type = 'ساعات' then
    -- الإجازة الزمنية داخل يوم واحد فقط
    new.end_date := new.start_date;

    if new.start_time is null or new.end_time is null then
      raise exception 'حدّد وقت البداية ووقت النهاية للإجازة الزمنية.';
    end if;
    if new.end_time <= new.start_time then
      raise exception 'وقت النهاية يجب أن يكون بعد وقت البداية.';
    end if;

    new.hours := round((extract(epoch from (new.end_time - new.start_time)) / 3600.0)::numeric, 2);
    new.days  := 0;
  else
    -- إجازة بالأيام: نتجاهل الأوقات
    new.start_time := null;
    new.end_time   := null;
    new.hours      := null;

    if new.end_date < new.start_date then
      raise exception 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.';
    end if;

    new.days := (new.end_date - new.start_date) + 1;
  end if;

  return new;
end; $$;

drop trigger if exists trg_leaves_normalize on public.leaves;
create trigger trg_leaves_normalize
  before insert or update on public.leaves
  for each row execute function public.normalize_leave();

-- ------------------------------------------------------------
-- 3) وصف مقروء لفترة الإجازة (يُستخدم داخل نص الإشعار)
-- ------------------------------------------------------------
create or replace function public.leave_period_text(l public.leaves)
returns text language sql stable as $$
  select case
    when l.duration_type = 'ساعات' then
      to_char(l.start_date, 'YYYY-MM-DD')
      || ' من ' || substring(l.start_time::text from 1 for 5)
      || ' إلى ' || substring(l.end_time::text   from 1 for 5)
      || ' (' || coalesce(l.hours, 0) || ' ساعة)'
    else
      to_char(l.start_date, 'YYYY-MM-DD')
      || ' إلى ' || to_char(l.end_date, 'YYYY-MM-DD')
      || ' (' || coalesce(l.days, 0) || ' يوم)'
  end;
$$;

-- ============================================================
-- الجزء الثاني: نظام الإشعارات
-- ============================================================

-- ------------------------------------------------------------
-- 4) جدول الإشعارات — صف لكل مستخدم يجب أن يصله الإشعار
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,                                -- الصفحة التي يفتحها الإشعار
  kind       text not null default 'عام',         -- إجازة | عام
  entity_id  uuid,                                -- معرّف السجل المرتبط (طلب الإجازة مثلاً)
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- كل مستخدم يرى إشعاراته فقط، ويقدر يعلّمها كمقروءة أو يحذفها.
-- لا توجد سياسة إضافة (insert) — الإشعارات تُنشأ من داخل القاعدة فقط،
-- فلا يستطيع أحد تلفيق إشعار لغيره.
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5) إشعار للمدراء عند وصول طلب إجازة جديد
-- ------------------------------------------------------------
create or replace function public.notify_leave_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
begin
  select full_name into emp_name from public.employees where id = new.employee_id;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         'طلب إجازة جديد',
         coalesce(emp_name, 'موظف') || ' يطلب إجازة ' || new.leave_type
           || ' — ' || public.leave_period_text(new),
         '/dashboard/hr/leaves',
         'إجازة',
         new.id
    from public.profiles p
   where p.role = 'admin';

  return new;
end; $$;

drop trigger if exists trg_leaves_notify_requested on public.leaves;
create trigger trg_leaves_notify_requested
  after insert on public.leaves
  for each row execute function public.notify_leave_requested();

-- ------------------------------------------------------------
-- 6) إشعار للموظف عند الموافقة على إجازته أو رفضها
-- ------------------------------------------------------------
create or replace function public.notify_leave_decided()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_user uuid;
begin
  -- لا نُشعر إلا عند تغيّر الحالة فعلاً
  if new.status is not distinct from old.status then
    return new;
  end if;

  select user_id into target_user from public.employees where id = new.employee_id;
  if target_user is null then          -- الموظف غير مربوط بحساب دخول
    return new;
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (
    target_user,
    case new.status
      when 'موافق عليها' then 'تمت الموافقة على إجازتك ✅'
      when 'مرفوضة'      then 'تم رفض طلب إجازتك ❌'
      else 'تحديث على طلب إجازتك'
    end,
    'إجازة ' || new.leave_type || ' — ' || public.leave_period_text(new),
    '/dashboard/me/leaves',
    'إجازة',
    new.id
  );

  return new;
end; $$;

drop trigger if exists trg_leaves_notify_decided on public.leaves;
create trigger trg_leaves_notify_decided
  after update on public.leaves
  for each row execute function public.notify_leave_decided();

-- ------------------------------------------------------------
-- 7) تفعيل البثّ اللحظي (Realtime) ليصل الإشعار بدون تحديث الصفحة
--    إن كان مفعّلاً مسبقاً يتجاهل الخطأ ويكمل.
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then
  null;
end $$;

-- ------------------------------------------------------------
-- 8) ضبط الإجازات القديمة (كلها «يوم كامل») وإعادة حساب أيامها
-- ------------------------------------------------------------
update public.leaves
   set duration_type = 'يوم كامل'
 where duration_type is null;

update public.leaves
   set days = (end_date - start_date) + 1
 where duration_type = 'يوم كامل'
   and (days is null or days <> (end_date - start_date) + 1);

notify pgrst, 'reload schema';
