-- ============================================================
-- تلال ERP — المحادثات الداخلية (دردشة بين الموظفين + إعلانات الإدارة)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يضيفه:
--   1) جدول conversations — كل محادثة (ثنائية بين شخصين، أو مجموعة،
--      أو «قناة إعلانات» يكتب فيها المدير فقط ويقرأها الجميع).
--   2) جدول conversation_members — من في المحادثة + آخر وقت قرأ فيه
--      (منه نحسب عدد الرسائل غير المقروءة).
--   3) جدول messages — الرسائل نفسها.
--   4) دوال جاهزة: فتح محادثة مع زميل، إنشاء مجموعة، قناة الإعلانات،
--      قائمة محادثاتي مع عدّاد غير المقروء.
--   5) إشعار تلقائي عند وصول رسالة جديدة (يظهر في جرس الإشعارات).
--   6) تفعيل البثّ اللحظي (Realtime) لتصل الرسالة بلا تحديث الصفحة.
--
-- يتطلب: sql/005 (الأدوار) و sql/012 (HR) و sql/022 (الإشعارات).
-- الملف آمن لإعادة التشغيل (يقدر يُشغَّل أكثر من مرة بلا ضرر).
-- ============================================================

-- ------------------------------------------------------------
-- 1) الجداول
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,

  kind              text not null default 'direct',   -- direct = بين شخصين | group = مجموعة
  title             text,                             -- اسم المجموعة (المحادثة الثنائية بلا اسم)
  is_announcement   boolean not null default false,   -- قناة إعلانات: المدير يكتب والجميع يقرأ

  -- ملخّص آخر رسالة — يُحدَّث بمحفّز حتى تُعرض القائمة باستعلام واحد
  last_message_at   timestamptz default now(),
  last_message_text text,
  last_sender_name  text
);

alter table public.conversations drop constraint if exists conversations_kind_chk;
alter table public.conversations add constraint conversations_kind_chk
  check (kind in ('direct', 'group'));

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),  -- كل ما قبله = مقروء
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references auth.users(id) on delete set null,
  sender_name     text,                                -- اسم المُرسِل وقت الإرسال (يبقى حتى لو حُذف الحساب)
  body            text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz                          -- حذف ناعم: تبقى الرسالة كـ«رسالة محذوفة»
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

-- ------------------------------------------------------------
-- 2) اسم العرض لأي مستخدم
--    (اسم الموظف إن كان مربوطاً بملف موظف، وإلا الجزء الأول من بريده)
-- ------------------------------------------------------------
create or replace function public.display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(trim(e.full_name), '') from public.employees e
      where e.user_id = uid limit 1),
    (select split_part(p.email, '@', 1) from public.profiles p where p.id = uid),
    'مستخدم'
  );
$$;

-- ------------------------------------------------------------
-- 3) هل أنا عضو في هذه المحادثة؟
--    security definer حتى لا تدور السياسات على نفسها (recursion).
-- ------------------------------------------------------------
create or replace function public.is_conversation_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id = cid and m.user_id = auth.uid()
  );
$$;

-- هل أقدر أُدير هذه المحادثة (أضيف أعضاء / أغيّر الاسم)؟
create or replace function public.can_manage_conversation(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.conversations c
     where c.id = cid and c.created_by = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- 4) الصلاحيات (RLS)
--    القاعدة: لا ترى إلا محادثاتك، ولا تكتب إلا فيها،
--    وقناة الإعلانات يكتب فيها المدير فقط.
-- ------------------------------------------------------------
alter table public.conversations       enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages            enable row level security;

drop policy if exists "read my conversations" on public.conversations;
create policy "read my conversations" on public.conversations
  for select to authenticated
  using ((select public.is_conversation_member(id)));

drop policy if exists "create conversations" on public.conversations;
create policy "create conversations" on public.conversations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "manage my conversations" on public.conversations;
create policy "manage my conversations" on public.conversations
  for update to authenticated
  using ((select public.can_manage_conversation(id)))
  with check ((select public.can_manage_conversation(id)));

drop policy if exists "read conversation members" on public.conversation_members;
create policy "read conversation members" on public.conversation_members
  for select to authenticated
  using ((select public.is_conversation_member(conversation_id)));

drop policy if exists "add conversation members" on public.conversation_members;
create policy "add conversation members" on public.conversation_members
  for insert to authenticated
  with check ((select public.can_manage_conversation(conversation_id)));

-- كل عضو يحدّث صفّه هو فقط (يعلّم المحادثة كمقروءة)
drop policy if exists "update my membership" on public.conversation_members;
create policy "update my membership" on public.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages
  for select to authenticated
  using ((select public.is_conversation_member(conversation_id)));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_conversation_member(conversation_id))
    -- قناة الإعلانات: الكتابة للمدير فقط
    and (
      (select public.is_admin())
      or not exists (
        select 1 from public.conversations c
         where c.id = conversation_id and c.is_announcement
      )
    )
  );

-- تعديل/حذف الرسالة: لصاحبها فقط (أو المدير)
drop policy if exists "edit own messages" on public.messages;
create policy "edit own messages" on public.messages
  for update to authenticated
  using (sender_id = (select auth.uid()) or (select public.is_admin()))
  with check (sender_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages
  for delete to authenticated
  using (sender_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------
-- 5) قبل حفظ الرسالة: نثبّت اسم المُرسِل من القاعدة (لا من المتصفح)
-- ------------------------------------------------------------
create or replace function public.stamp_message_sender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sender_name := public.display_name(new.sender_id);
  if new.body is null or length(trim(new.body)) = 0 then
    raise exception 'الرسالة فارغة.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_message_stamp on public.messages;
create trigger trg_message_stamp
  before insert on public.messages
  for each row execute function public.stamp_message_sender();

-- ------------------------------------------------------------
-- 6) بعد حفظ الرسالة: تحديث ملخّص المحادثة + إشعار بقية الأعضاء
--    (إشعار واحد لكل محادثة — نستبدل غير المقروء بدل تكديس عشرات
--     الإشعارات في الجرس)
-- ------------------------------------------------------------
create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_announce boolean;
begin
  update public.conversations
     set last_message_at   = new.created_at,
         last_message_text = left(new.body, 140),
         last_sender_name  = new.sender_name
   where id = new.conversation_id
  returning is_announcement into is_announce;

  -- نحذف الإشعارات غير المقروءة القديمة لنفس المحادثة
  delete from public.notifications n
   where n.kind = 'رسالة'
     and n.entity_id = new.conversation_id
     and n.is_read = false
     and n.user_id in (
       select m.user_id from public.conversation_members m
        where m.conversation_id = new.conversation_id
          and m.user_id is distinct from new.sender_id
     );

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select m.user_id,
         case when coalesce(is_announce, false)
              then 'إعلان من الإدارة 📢'
              else 'رسالة من ' || coalesce(new.sender_name, 'زميل')
         end,
         left(new.body, 90),
         '/dashboard/chat/' || new.conversation_id::text,
         'رسالة',
         new.conversation_id
    from public.conversation_members m
   where m.conversation_id = new.conversation_id
     and m.user_id is distinct from new.sender_id;

  return new;
end; $$;

drop trigger if exists trg_message_notify on public.messages;
create trigger trg_message_notify
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- ------------------------------------------------------------
-- 7) فتح محادثة مع زميل (تُعيد المحادثة القائمة إن وُجدت)
-- ------------------------------------------------------------
create or replace function public.get_or_create_direct(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  cid uuid;
begin
  if me is null then
    raise exception 'يجب تسجيل الدخول.';
  end if;
  if other_user = me then
    raise exception 'لا يمكنك محادثة نفسك.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'هذا المستخدم غير موجود.';
  end if;

  -- محادثة ثنائية فيها أنا وهو فقط
  select c.id into cid
    from public.conversations c
   where c.kind = 'direct'
     and exists (select 1 from public.conversation_members m
                  where m.conversation_id = c.id and m.user_id = me)
     and exists (select 1 from public.conversation_members m
                  where m.conversation_id = c.id and m.user_id = other_user)
     and (select count(*) from public.conversation_members m
           where m.conversation_id = c.id) = 2
   limit 1;

  if cid is not null then
    return cid;
  end if;

  insert into public.conversations (kind, created_by, last_message_at)
  values ('direct', me, now())
  returning id into cid;

  insert into public.conversation_members (conversation_id, user_id)
  values (cid, me), (cid, other_user);

  return cid;
end; $$;

-- ------------------------------------------------------------
-- 8) إنشاء مجموعة (لمن ينشئها؛ يضيف نفسه تلقائياً)
-- ------------------------------------------------------------
create or replace function public.create_group_conversation(
  group_title text,
  member_ids  uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  cid uuid;
begin
  if me is null then
    raise exception 'يجب تسجيل الدخول.';
  end if;
  if group_title is null or length(trim(group_title)) = 0 then
    raise exception 'اكتب اسماً للمجموعة.';
  end if;

  insert into public.conversations (kind, title, created_by, last_message_at)
  values ('group', trim(group_title), me, now())
  returning id into cid;

  insert into public.conversation_members (conversation_id, user_id)
  select cid, u
    from unnest(array_append(coalesce(member_ids, '{}'::uuid[]), me)) as u
   where exists (select 1 from public.profiles p where p.id = u)
  on conflict do nothing;

  return cid;
end; $$;

-- ------------------------------------------------------------
-- 9) قناة إعلانات الإدارة — للمدير فقط، والجميع أعضاء فيها
-- ------------------------------------------------------------
create or replace function public.ensure_announcement_channel()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if not public.is_admin() then
    raise exception 'قناة الإعلانات للمدير فقط.';
  end if;

  select id into cid from public.conversations
   where is_announcement limit 1;

  if cid is null then
    insert into public.conversations (kind, title, is_announcement, created_by, last_message_at)
    values ('group', 'إعلانات الإدارة', true, auth.uid(), now())
    returning id into cid;
  end if;

  -- مزامنة الأعضاء: كل من له حساب في النظام
  insert into public.conversation_members (conversation_id, user_id)
  select cid, p.id from public.profiles p
  on conflict do nothing;

  return cid;
end; $$;

-- أي مستخدم جديد يُضاف تلقائياً لقنوات الإعلانات
create or replace function public.add_new_user_to_announcements()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversation_members (conversation_id, user_id)
  select c.id, new.id from public.conversations c where c.is_announcement
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists trg_profile_join_announcements on public.profiles;
create trigger trg_profile_join_announcements
  after insert on public.profiles
  for each row execute function public.add_new_user_to_announcements();

-- ------------------------------------------------------------
-- 10) قائمة محادثاتي جاهزة للعرض (اسم الطرف الآخر + غير المقروء)
-- ------------------------------------------------------------
create or replace function public.my_conversations()
returns table (
  id                uuid,
  kind              text,
  title             text,
  is_announcement   boolean,
  last_message_at   timestamptz,
  last_message_text text,
  last_sender_name  text,
  unread            integer,
  other_user        uuid,
  display_title     text,
  member_count      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.kind,
         c.title,
         c.is_announcement,
         c.last_message_at,
         c.last_message_text,
         c.last_sender_name,
         (select count(*) from public.messages msg
           where msg.conversation_id = c.id
             and msg.sender_id is distinct from auth.uid()
             and msg.created_at > me.last_read_at)::int as unread,
         other.user_id as other_user,
         case when c.kind = 'direct'
              then public.display_name(other.user_id)
              else coalesce(c.title, 'مجموعة')
         end as display_title,
         (select count(*) from public.conversation_members m2
           where m2.conversation_id = c.id)::int as member_count
    from public.conversations c
    join public.conversation_members me
      on me.conversation_id = c.id and me.user_id = auth.uid()
    left join lateral (
      select m3.user_id
        from public.conversation_members m3
       where m3.conversation_id = c.id
         and m3.user_id <> auth.uid()
       limit 1
    ) other on c.kind = 'direct'
   order by c.last_message_at desc nulls last;
$$;

-- عدّاد الرسائل غير المقروءة كلها (لشارة الشريط الجانبي)
create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::int
    from public.messages msg
    join public.conversation_members m
      on m.conversation_id = msg.conversation_id
     and m.user_id = auth.uid()
   where msg.sender_id is distinct from auth.uid()
     and msg.created_at > m.last_read_at;
$$;

-- تعليم المحادثة كمقروءة
create or replace function public.mark_conversation_read(cid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = cid and user_id = auth.uid();
$$;

-- أعضاء محادثة معيّنة بأسمائهم (لعرض «المشاركون»)
create or replace function public.conversation_people(cid uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, public.display_name(m.user_id)
    from public.conversation_members m
   where m.conversation_id = cid
     and public.is_conversation_member(cid)   -- لا تكشف أعضاء محادثة لست فيها
   order by 2;
$$;

-- ------------------------------------------------------------
-- 11) الصلاحيات على الدوال
-- ------------------------------------------------------------
grant execute on function public.get_or_create_direct(uuid)        to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.ensure_announcement_channel()     to authenticated;
grant execute on function public.my_conversations()                to authenticated;
grant execute on function public.chat_unread_count()               to authenticated;
grant execute on function public.mark_conversation_read(uuid)      to authenticated;
grant execute on function public.conversation_people(uuid)         to authenticated;
grant execute on function public.display_name(uuid)                to authenticated;

-- ------------------------------------------------------------
-- 12) البثّ اللحظي (Realtime) للرسائل
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then
  null;
end $$;

notify pgrst, 'reload schema';
