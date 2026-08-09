-- ============================================================
-- تلال ERP — المهام اليومية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الفكرة ببساطة:
--   المدير يكتب مهمة ويسندها لموظف، والموظف يقدر يكتب مهمة لنفسه.
--   كل مهمة فيها: العنوان، التفاصيل، الأولوية، تاريخ التنفيذ،
--   **الخطوة القادمة** و**موعد المتابعة** — حتى يعرف الموظف صباحاً
--   ماذا سيفعل اليوم بالضبط.
--
--   وكل مهمة تحمل **اسم من صنعها أو طلبها** (يُثبَّت من داخل القاعدة
--   فلا يقدر أحد يزوّره).
--
-- ما يضيفه:
--   1) جدول tasks + صلاحياته.
--   2) تثبيت أسماء (من طلبها / لمن أُسندت) تلقائياً.
--   3) إشعار للموظف عند إسناد مهمة له، وإشعار لصاحب الطلب عند إنجازها.
--   4) تذكير يومي الساعة ٩ صباحاً بمهام اليوم والمتأخرة.
--
-- يتطلب: sql/005 (الأدوار) و sql/012 (HR) و sql/022 (الإشعارات)
--        و sql/027 (baghdad_today و pg_cron). الملف آمن لإعادة التشغيل.
-- ============================================================

-- اليوم بتوقيت بغداد (موجودة من sql/027 — نعيدها هنا للأمان)
create or replace function public.baghdad_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Baghdad')::date;
$$;

-- ------------------------------------------------------------
-- 1) الجدول
-- ------------------------------------------------------------
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- من طلب المهمة (يُملأ تلقائياً بالمستخدم الحالي)
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,                                  -- اسمه وقت الإنشاء
  created_by_role text,                                  -- مدير | موظف

  -- لمن هذه المهمة
  assigned_to      uuid not null references auth.users(id) on delete cascade,
  assigned_to_name text,

  title       text not null,
  description text,

  priority text not null default 'عادية',   -- عاجلة | متوسطة | عادية
  status   text not null default 'جديدة',   -- جديدة | قيد التنفيذ | منجزة | ملغاة

  due_date date not null default public.baghdad_today(),  -- يوم تنفيذ المهمة
  due_time time,                                          -- وقت اختياري داخل اليوم

  next_step       text,     -- الخطوة القادمة: ماذا أفعل بعدها بالضبط
  follow_up_date  date,     -- موعد المتابعة

  client_id uuid references public.clients(id) on delete set null,  -- ربط اختياري بعميل

  completed_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 1-ب) إكمال الأعمدة الناقصة
--    لو كان جدول tasks موجوداً من نسخة أقدم، فإن «create table if not
--    exists» أعلاه يتخطّاه ولا يضيف الأعمدة الجديدة — فنضيفها هنا.
--    الأمر آمن: العمود الموجود يُترك كما هو.
-- ------------------------------------------------------------
alter table public.tasks add column if not exists created_at       timestamptz not null default now();
alter table public.tasks add column if not exists created_by       uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists created_by_name  text;
alter table public.tasks add column if not exists created_by_role  text;
alter table public.tasks add column if not exists assigned_to      uuid references auth.users(id) on delete cascade;
alter table public.tasks add column if not exists assigned_to_name text;
alter table public.tasks add column if not exists title            text;
alter table public.tasks add column if not exists description      text;
alter table public.tasks add column if not exists priority         text not null default 'عادية';
alter table public.tasks add column if not exists status           text not null default 'جديدة';
alter table public.tasks add column if not exists due_date         date not null default public.baghdad_today();
alter table public.tasks add column if not exists due_time         time;
alter table public.tasks add column if not exists next_step        text;
alter table public.tasks add column if not exists follow_up_date   date;
alter table public.tasks add column if not exists client_id        uuid references public.clients(id) on delete set null;
alter table public.tasks add column if not exists completed_at     timestamptz;
alter table public.tasks add column if not exists updated_at       timestamptz not null default now();

-- الأعمدة الإلزامية: نفرض «not null» فقط إن لم يكن فيها صفوف فارغة
do $$
begin
  if not exists (select 1 from public.tasks where assigned_to is null) then
    alter table public.tasks alter column assigned_to set not null;
  end if;
  if not exists (select 1 from public.tasks where title is null) then
    alter table public.tasks alter column title set not null;
  end if;
end $$;

alter table public.tasks drop constraint if exists tasks_status_chk;
alter table public.tasks add constraint tasks_status_chk
  check (status in ('جديدة', 'قيد التنفيذ', 'منجزة', 'ملغاة'));

alter table public.tasks drop constraint if exists tasks_priority_chk;
alter table public.tasks add constraint tasks_priority_chk
  check (priority in ('عاجلة', 'متوسطة', 'عادية'));

create index if not exists tasks_assignee_idx  on public.tasks (assigned_to, due_date);
create index if not exists tasks_status_idx    on public.tasks (status, due_date);
create index if not exists tasks_followup_idx  on public.tasks (follow_up_date)
  where follow_up_date is not null;
create index if not exists tasks_client_idx    on public.tasks (client_id)
  where client_id is not null;

-- ------------------------------------------------------------
-- 2) الصلاحيات
--    الموظف: يرى مهامه وما طلبه، ويسند لنفسه فقط.
--    المدير : يرى الكل ويسند لأي موظف.
-- ------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists "read my tasks" on public.tasks;
create policy "read my tasks" on public.tasks
  for select to authenticated
  using (
    assigned_to = (select auth.uid())
    or created_by = (select auth.uid())
    or (select public.is_admin())
  );

drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      assigned_to = (select auth.uid())   -- مهمة لنفسي
      or (select public.is_admin())       -- أو المدير يسندها لموظف
    )
  );

-- الموظف المسؤول يقدر يحدّث حالة مهمته وخطوتها القادمة،
-- وصاحب الطلب والمدير يقدرون يعدّلونها كاملة.
drop policy if exists "update my tasks" on public.tasks;
create policy "update my tasks" on public.tasks
  for update to authenticated
  using (
    assigned_to = (select auth.uid())
    or created_by = (select auth.uid())
    or (select public.is_admin())
  )
  with check (
    assigned_to = (select auth.uid())
    or created_by = (select auth.uid())
    or (select public.is_admin())
  );

-- الحذف: لصاحب الطلب أو المدير فقط (الموظف لا يحذف مهمة طلبها المدير)
drop policy if exists "delete my tasks" on public.tasks;
create policy "delete my tasks" on public.tasks
  for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------
-- 3) تثبيت الأسماء وحالة الإنجاز قبل الحفظ
--    (كل شيء يُحسب هنا، فلا يقدر المتصفح يزوّر «من طلب المهمة»)
-- ------------------------------------------------------------
create or replace function public.stamp_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    -- لا يُغيَّر صاحب الطلب بعد الإنشاء
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  -- الاسم يُحسب من القاعدة، ويبقى محفوظاً لو حُذف حساب صاحب الطلب لاحقاً
  if new.created_by is not null then
    new.created_by_name := public.display_name(new.created_by);
    new.created_by_role := case
      when exists (select 1 from public.profiles p
                    where p.id = new.created_by and p.role = 'admin')
      then 'مدير' else 'موظف' end;
  elsif tg_op = 'UPDATE' then
    new.created_by_name := old.created_by_name;
    new.created_by_role := old.created_by_role;
  end if;

  new.assigned_to_name := public.display_name(new.assigned_to);

  if new.title is null or length(trim(new.title)) = 0 then
    raise exception 'اكتب عنوان المهمة.';
  end if;

  -- وقت الإنجاز يُضبط تلقائياً مع الحالة
  if new.status = 'منجزة' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;

  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_task_stamp on public.tasks;
create trigger trg_task_stamp
  before insert or update on public.tasks
  for each row execute function public.stamp_task();

-- ------------------------------------------------------------
-- 4) إشعار للموظف عند إسناد مهمة له من غيره
-- ------------------------------------------------------------
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not distinct from new.created_by then
    return new;                      -- كتبها لنفسه: لا داعي لإشعار
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (
    new.assigned_to,
    'مهمة جديدة من ' || coalesce(new.created_by_name, 'الإدارة'),
    new.title || ' — موعدها ' || to_char(new.due_date, 'YYYY-MM-DD'),
    '/dashboard/tasks',
    'مهمة',
    new.id
  );
  return new;
end; $$;

drop trigger if exists trg_task_notify_assigned on public.tasks;
create trigger trg_task_notify_assigned
  after insert on public.tasks
  for each row execute function public.notify_task_assigned();

-- ------------------------------------------------------------
-- 5) إشعار لصاحب الطلب عند إنجاز المهمة أو تغيّر حالتها
-- ------------------------------------------------------------
create or replace function public.notify_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.created_by is null
     or new.created_by is not distinct from new.assigned_to then
    return new;                      -- لا نُشعر الشخص بنفسه
  end if;
  if new.status not in ('منجزة', 'ملغاة') then
    return new;
  end if;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  values (
    new.created_by,
    case new.status
      when 'منجزة' then 'تم إنجاز مهمة ✅'
      else 'أُلغيت مهمة'
    end,
    coalesce(new.assigned_to_name, 'موظف') || ': ' || new.title,
    '/dashboard/tasks',
    'مهمة',
    new.id
  );
  return new;
end; $$;

drop trigger if exists trg_task_notify_status on public.tasks;
create trigger trg_task_notify_status
  after update on public.tasks
  for each row execute function public.notify_task_status();

-- ------------------------------------------------------------
-- 6) تذكير يومي: مهام اليوم + المتأخرة + متابعات اليوم
--    إشعار واحد لكل موظف في اليوم.
-- ------------------------------------------------------------
create or replace function public.tasks_daily_reminder()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today  date := public.baghdad_today();
  sent   int  := 0;
  rec    record;
  parts  text;
begin
  for rec in
    select t.assigned_to as uid,
           count(*) filter (where t.due_date = today)                     as today_count,
           count(*) filter (where t.due_date < today)                     as late_count,
           count(*) filter (where t.follow_up_date = today)               as followup_count
      from public.tasks t
     where t.status in ('جديدة', 'قيد التنفيذ')
       and (t.due_date <= today or t.follow_up_date = today)
     group by t.assigned_to
  loop
    -- تذكير واحد فقط في اليوم لكل موظف
    if exists (
      select 1 from public.notifications n
       where n.user_id = rec.uid
         and n.kind = 'مهمة'
         and n.title like 'مهام اليوم%'
         and (n.created_at at time zone 'Asia/Baghdad')::date = today
    ) then
      continue;
    end if;

    parts := '';
    if rec.today_count > 0 then
      parts := parts || rec.today_count || ' مهمة اليوم';
    end if;
    if rec.late_count > 0 then
      parts := parts || case when parts = '' then '' else ' · ' end
                     || rec.late_count || ' متأخرة';
    end if;
    if rec.followup_count > 0 then
      parts := parts || case when parts = '' then '' else ' · ' end
                     || rec.followup_count || ' متابعة اليوم';
    end if;

    insert into public.notifications (user_id, title, body, link, kind)
    values (rec.uid, 'مهام اليوم 📋', parts, '/dashboard/tasks', 'مهمة');

    sent := sent + 1;
  end loop;

  return jsonb_build_object('sent', sent, 'date', today);
end; $$;

-- لا يستدعيها أحد من التطبيق مباشرة (تعمل من الجدولة فقط)
revoke all on function public.tasks_daily_reminder() from public, anon, authenticated;

-- غلاف يشغّله المدير يدوياً عند الحاجة
create or replace function public.run_tasks_daily_reminder()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمدير فقط.';
  end if;
  return public.tasks_daily_reminder();
end; $$;

grant execute on function public.run_tasks_daily_reminder() to authenticated;

-- ------------------------------------------------------------
-- 7) جدولة التذكير — ٩ صباحاً بتوقيت بغداد (٦ صباحاً UTC)
-- ------------------------------------------------------------
create extension if not exists pg_cron;

select cron.unschedule('tasks-daily-reminder')
 where exists (select 1 from cron.job where jobname = 'tasks-daily-reminder');

select cron.schedule(
  'tasks-daily-reminder',
  '0 6 * * *',
  $cron$ select public.tasks_daily_reminder(); $cron$
);

notify pgrst, 'reload schema';
