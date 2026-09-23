-- ============================================================
-- تلال ERP — 091: الوسوم (§47)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا جدولان لا عمود =====
--
-- الوسم عمودَ نصٍّ (`tags text[]`) أسهل بيوم وأغلى بسنة: يُكتب
-- «VIP» و«vip» و«في آي بي» فتصير ثلاثة، ولا أحد يعرف أيّها
-- المقصود، ولا سبيل إلى إعادة تسمية وسم في كل الصفوف دفعةً.
--
-- فالوسم صفٌّ له اسم ولون، والربط جدولٌ ثانٍ. إعادة التسمية تمسّ
-- صفّاً واحداً، والدمج يمسّ الروابط، والقائمة مغلقة فلا تتكاثر.
--
-- ===== ما ليس وسماً =====
--
-- المرحلة ليست وسماً (crm_stages)، ولا الحرارة (محسوبة في 074)،
-- ولا المصدر (crm_sources). الوسم لما لا يُحسب ولا يُشتقّ: «تكلّم
-- إنجليزية»، «يفضّل الواتساب»، «عميل الشركة الفلانية».
--
-- يتطلب: 071 (can_see_client) و 084 (can_read_all_crm).
-- ============================================================

create table if not exists public.crm_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text not null default 'bg-gray-100 text-gray-700',
  is_active  boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table public.crm_tags is
  'الوسوم: قائمة مغلقة يديرها المدير. ما لا يُحسب ولا يُشتقّ — لا المرحلة ولا الحرارة ولا المصدر.';

create table if not exists public.client_tags (
  client_id  uuid not null references public.clients(id) on delete cascade,
  tag_id     uuid not null references public.crm_tags(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references auth.users(id) on delete set null,
  added_by_name text,
  primary key (client_id, tag_id)
);

create index if not exists client_tags_tag_idx on public.client_tags (tag_id);

-- بذرة قليلة عمداً: الوسوم تُولد من الحاجة لا من التخمين. قائمةٌ
-- مخترَعة من عشرين وسماً تُترك فارغة وتُشوّش القائمة.
insert into public.crm_tags (name, color, sort_order) values
  ('مهمّ',            'bg-red-100 text-red-700',       10),
  ('يفضّل الواتساب',  'bg-green-100 text-green-700',   20),
  ('مستثمر',          'bg-purple-100 text-purple-700', 30),
  ('يحتاج متابعة خاصة','bg-amber-100 text-amber-700',  40)
on conflict (name) do nothing;

create or replace function public.stamp_client_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.added_by := coalesce(new.added_by, auth.uid());
  new.added_by_name := coalesce(
    public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  return new;
end $$;

drop trigger if exists trg_stamp_client_tag on public.client_tags;
create trigger trg_stamp_client_tag
  before insert on public.client_tags
  for each row execute function public.stamp_client_tag();

-- ------------------------------------------------------------
-- وسم جماعي — كل صفّ يمرّ بالحارس نفسه (§47)
--
-- ⚠️ auth.uid() فارغة = محرّر SQL = سياق موثوق، كما في assign_client
--    (071) و merge_clients (077). الاصطلاح واحد في كل الملفّات.
-- ------------------------------------------------------------
create or replace function public.bulk_tag_clients(
  p_client_ids uuid[],
  p_tag_id     uuid,
  p_remove     boolean default false
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid      uuid;
  n_ok     int := 0;
  n_bad    int := 0;
  err      text;
  trusted  boolean := auth.uid() is null or public.is_admin();
begin
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;
  if not exists (select 1 from public.crm_tags where id = p_tag_id and is_active) then
    raise exception 'الوسم غير موجود أو موقوف.';
  end if;

  foreach cid in array p_client_ids loop
    begin
      -- الوسم يتبع رؤية العميل: من لا يراه لا يسِمه
      if not (trusted or public.can_see_client(cid)) then
        n_bad := n_bad + 1;
        if err is null then err := 'صفوف خارج نطاقك لم تُمَسّ.'; end if;
        continue;
      end if;

      if p_remove then
        delete from public.client_tags where client_id = cid and tag_id = p_tag_id;
      else
        insert into public.client_tags (client_id, tag_id)
        values (cid, p_tag_id)
        on conflict (client_id, tag_id) do nothing;
      end if;
      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

comment on function public.bulk_tag_clients(uuid[], uuid, boolean) is
  'وسم أو نزع وسم لصفوف مختارة. من لا يرى العميل لا يسِمه — والمرفوض يُعدّ.';

-- ------------------------------------------------------------
-- الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_tags    enable row level security;
alter table public.client_tags enable row level security;

drop policy if exists "read tags" on public.crm_tags;
create policy "read tags" on public.crm_tags
  for select to authenticated using (true);

-- قائمة الوسوم للمدير: وسمٌ يضيفه كل موظف يعيد فوضى النصّ الحرّ
drop policy if exists "admin writes tags" on public.crm_tags;
create policy "admin writes tags" on public.crm_tags
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read client tags" on public.client_tags;
create policy "read client tags" on public.client_tags
  for select to authenticated
  using ((select public.is_admin())
         or (select public.can_read_all_crm())
         or public.can_see_client(client_id));

-- الوسم على العميل لمن يراه: هو عمل يومي لا قرار إداري
drop policy if exists "write client tags" on public.client_tags;
create policy "write client tags" on public.client_tags
  for all to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id))
  with check ((select public.is_admin()) or public.can_see_client(client_id));

revoke all on function public.bulk_tag_clients(uuid[], uuid, boolean) from public;
grant execute on function public.bulk_tag_clients(uuid[], uuid, boolean)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
declare n_tags int; n_links int;
begin
  select count(*) into n_tags  from public.crm_tags;
  select count(*) into n_links from public.client_tags;
  raise notice '--- 091 الوسوم ---';
  raise notice 'وسوم معرَّفة: %   روابط على عملاء: %', n_tags, n_links;
  raise notice 'الوسم يتبع رؤية العميل — ومن لا يراه لا يسِمه.';
end $$;

notify pgrst, 'reload schema';
