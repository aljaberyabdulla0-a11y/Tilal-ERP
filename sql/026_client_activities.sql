-- ============================================================
-- تلال ERP — سجلّ التواصل مع العميل (Activity Log)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يضيفه:
--   1) جدول client_activities — كل تواصل مع العميل: مكالمة، واتساب،
--      اجتماع، زيارة، عرض سعر، ملاحظة... مع نتيجته والمتابعة القادمة.
--   2) عمودان محسوبان على العميل: آخر تواصل وعدد مرات التواصل —
--      تُحدَّث تلقائياً بمحفّز، فتظهر في القائمة بلا استعلامات ثقيلة.
--   3) تسجيل تلقائي عند تغيّر مرحلة العميل (من لوحة المبيعات أو التعديل).
--   4) تحديث تاريخ المتابعة على العميل من النشاط مباشرة.
--
-- يتطلب: sql/017 (المراحل) و sql/023 (خصوصية العملاء). آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول الأنشطة
-- ------------------------------------------------------------
create table if not exists public.client_activities (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,

  activity_type text not null,                 -- مكالمة | واتساب | اجتماع | زيارة | عرض سعر | ملاحظة | تغيير مرحلة
  direction     text,                          -- صادر | وارد  (للمكالمات والرسائل)
  outcome       text,                          -- تم التواصل | لم يرد | مهتم | غير مهتم | مؤجل | تم الاتفاق
  occurred_at   timestamptz not null default now(),  -- وقت التواصل الفعلي (قد يُسجَّل لاحقاً)
  duration_min  integer,                       -- مدة المكالمة/الاجتماع بالدقائق
  summary       text,                          -- ماذا دار في التواصل

  next_action      text,                       -- الخطوة القادمة
  next_action_date date,                       -- موعدها

  -- تُملأ تلقائياً عند تسجيل تغيّر المرحلة
  stage_from    text,
  stage_to      text,

  -- اسم من سجّل النشاط وقت التسجيل (يبقى حتى لو حُذف الحساب)
  actor_name    text
);

create index if not exists client_activities_client_idx
  on public.client_activities (client_id, occurred_at desc);
create index if not exists client_activities_occurred_idx
  on public.client_activities (occurred_at desc);
create index if not exists client_activities_followup_idx
  on public.client_activities (next_action_date)
  where next_action_date is not null;

-- ------------------------------------------------------------
-- 2) الصلاحيات — النشاط يتبع صلاحية العميل نفسه
--    (الموظف يرى أنشطة عملائه فقط، والمدير يرى الكل)
-- ------------------------------------------------------------
alter table public.client_activities enable row level security;

-- دالة تختصر السؤال: هل أقدر أوصل لهذا العميل؟
-- security definer حتى تتجاوز RLS على clients أثناء الفحص وتتفادى التكرار.
create or replace function public.can_see_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clients c
     where c.id = cid
       and (
         public.is_admin()
         or c.created_by = auth.uid()
         or (c.sales_employee is not null
             and c.sales_employee = public.my_employee_name())
       )
  );
$$;

drop policy if exists "read client activities"   on public.client_activities;
create policy "read client activities" on public.client_activities
  for select to authenticated using ((select public.can_see_client(client_id)));

drop policy if exists "insert client activities" on public.client_activities;
create policy "insert client activities" on public.client_activities
  for insert to authenticated
  with check (
    (select public.can_see_client(client_id))
    and created_by = (select auth.uid())
  );

-- التعديل والحذف: صاحب النشاط أو المدير (سجلّ التواصل يجب ألا يُعبث به)
drop policy if exists "update own activities" on public.client_activities;
create policy "update own activities" on public.client_activities
  for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()))
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "delete own activities" on public.client_activities;
create policy "delete own activities" on public.client_activities
  for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------
-- 3) أعمدة سريعة على العميل: آخر تواصل وعدده
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists last_contact_at timestamptz,
  add column if not exists contact_count   integer not null default 0;

create index if not exists clients_last_contact_idx on public.clients (last_contact_at);

-- ------------------------------------------------------------
-- 4) عند إضافة/حذف نشاط: نعيد حساب آخر تواصل وعدده
--    (تغيير المرحلة التلقائي لا يُحتسب تواصلاً مع العميل)
-- ------------------------------------------------------------
create or replace function public.refresh_client_contact(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.clients c
     set last_contact_at = sub.last_at,
         contact_count   = sub.cnt
    from (
      select max(occurred_at) as last_at, count(*)::int as cnt
        from public.client_activities
       where client_id = cid
         and activity_type <> 'تغيير مرحلة'
    ) sub
   where c.id = cid;
end; $$;

create or replace function public.on_activity_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_client_contact(old.client_id);
    return old;
  end if;

  -- اسم من سجّل النشاط (من ملف الموظف، وإلا البريد)
  if new.actor_name is null then
    select coalesce(
             (select e.full_name from public.employees e where e.user_id = new.created_by),
             (select p.email     from public.profiles  p where p.id      = new.created_by)
           )
      into new.actor_name;
  end if;

  return new;
end; $$;

-- قبل الحفظ: نملأ اسم المسجّل
drop trigger if exists trg_activity_before on public.client_activities;
create trigger trg_activity_before
  before insert on public.client_activities
  for each row execute function public.on_activity_change();

-- بعد الحفظ: نحدّث ملخّص العميل وتاريخ متابعته
create or replace function public.after_activity_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_client_contact(old.client_id);
    return old;
  end if;

  perform public.refresh_client_contact(new.client_id);

  -- موعد المتابعة المكتوب في النشاط ينتقل لبطاقة العميل
  if new.next_action_date is not null then
    update public.clients
       set follow_up_date = new.next_action_date
     where id = new.client_id;
  end if;

  return new;
end; $$;

drop trigger if exists trg_activity_after on public.client_activities;
create trigger trg_activity_after
  after insert or update or delete on public.client_activities
  for each row execute function public.after_activity_change();

-- ------------------------------------------------------------
-- 5) تسجيل تلقائي عند تغيّر مرحلة العميل
--    (يشمل السحب والإفلات في لوحة المبيعات)
-- ------------------------------------------------------------
create or replace function public.log_client_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  if new.stage is not distinct from old.stage then
    return new;
  end if;

  select coalesce(
           (select e.full_name from public.employees e where e.user_id = auth.uid()),
           (select p.email     from public.profiles  p where p.id      = auth.uid())
         )
    into who;

  insert into public.client_activities
    (client_id, created_by, activity_type, summary, stage_from, stage_to, actor_name)
  values
    (new.id, auth.uid(), 'تغيير مرحلة',
     'انتقل من «' || coalesce(old.stage, '—') || '» إلى «' || coalesce(new.stage, '—') || '»',
     old.stage, new.stage, who);

  return new;
end; $$;

drop trigger if exists trg_client_stage_log on public.clients;
create trigger trg_client_stage_log
  after update of stage on public.clients
  for each row execute function public.log_client_stage_change();

-- ------------------------------------------------------------
-- 6) ضبط العملاء الحاليين (لا أنشطة لهم بعد)
-- ------------------------------------------------------------
update public.clients c
   set contact_count = sub.cnt,
       last_contact_at = sub.last_at
  from (
    select cl.id,
           (select count(*)::int from public.client_activities a
             where a.client_id = cl.id and a.activity_type <> 'تغيير مرحلة') as cnt,
           (select max(a.occurred_at) from public.client_activities a
             where a.client_id = cl.id and a.activity_type <> 'تغيير مرحلة') as last_at
      from public.clients cl
  ) sub
 where c.id = sub.id;

notify pgrst, 'reload schema';
