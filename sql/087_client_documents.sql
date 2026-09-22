-- ============================================================
-- تلال ERP — 087: مستندات العميل
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا أُجّل =====
--
-- كان مؤجّلاً في §٤ لأنه «يحتاج Storage وسياسة احتفاظ». والحاجتان
-- تُحسمان هنا: دلوٌ خاصّ، وحذفٌ ناعم لا محو.
--
-- ===== القراران =====
--
-- **الملفّ خاصّ دائماً.** الدلو غير عامّ، والتحميل برابط موقَّع ينتهي
-- بعد دقيقة. هوية المشتري وعقده لا يُنشران برابط دائم يُخمَّن، ولا
-- يُترك رابطٌ في محادثة يعمل بعد سنة.
--
-- **الحذف ناعم.** عقدٌ رُفع ثم حُذف قد يكون هو الدليل يوماً. يختفي
-- من الشاشة، ويبقى الملفّ في التخزين وصفّه في السجلّ. والمحو النهائي
-- قرار إداري موثّق لا زرّ في شاشة.
--
-- ===== المسار هو الحارس =====
--
--     clients/<client_id>/<uuid>-<اسم الملفّ>
--
-- سياسة التخزين تستخرج معرّف العميل من المسار وتسأل can_see_client —
-- **نفس الحارس** الذي يحكم بقيّة ملفّه. فلا نموذج صلاحيات ثانٍ
-- للمستندات يفترق عن الأول مع الوقت.
--
-- والـuuid في الاسم يمنع التخمين ويمنع تصادم اسمين متطابقين.
--
-- يتطلب: 071 (can_see_client) و 084 (can_read_all_crm) و 058 (التدقيق).
-- ============================================================

-- ------------------------------------------------------------
-- 1) الدلو — خاصّ، بحدّ حجم وأنواع معلومة
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 20971520,
        array['image/jpeg','image/png','image/webp','application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 2) جدول الوصف — الملفّ في التخزين وبياناته هنا
-- ------------------------------------------------------------
create table if not exists public.client_documents (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  doc_type     text not null default 'آخر'
               check (doc_type in ('هوية','عقد','إيصال','مخطّط','عرض سعر','آخر')),
  notes        text,
  uploaded_by       uuid references auth.users(id) on delete set null,
  uploaded_by_name  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id) on delete set null
);

create index if not exists client_documents_client_idx
  on public.client_documents (client_id, created_at desc) where deleted_at is null;
create index if not exists client_documents_opp_idx
  on public.client_documents (opportunity_id) where opportunity_id is not null;

comment on table public.client_documents is
  'وصف مستندات العميل. الملفّ نفسه في دلو خاصّ، والتحميل برابط موقَّع لا برابط دائم.';
comment on column public.client_documents.storage_path is
  'clients/<client_id>/<uuid>-<اسم>. المسار هو ما تستخرج منه سياسة التخزين صاحب الملفّ.';

-- من رفع ومتى — لا يُترك للواجهة
create or replace function public.stamp_client_document()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    new.uploaded_by_name := coalesce(
      public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_client_document on public.client_documents;
create trigger trg_stamp_client_document
  before insert on public.client_documents
  for each row execute function public.stamp_client_document();

-- ------------------------------------------------------------
-- 3) الصلاحيات: المستند يتبع عميله حرفياً
-- ------------------------------------------------------------
alter table public.client_documents enable row level security;

drop policy if exists "read client documents" on public.client_documents;
create policy "read client documents" on public.client_documents
  for select to authenticated
  using (deleted_at is null
         and ((select public.is_admin())
              or (select public.can_read_all_crm())
              or public.can_see_client(client_id)));

drop policy if exists "upload client documents" on public.client_documents;
create policy "upload client documents" on public.client_documents
  for insert to authenticated
  with check ((select public.is_admin()) or public.can_see_client(client_id));

drop policy if exists "soft delete client documents" on public.client_documents;
create policy "soft delete client documents" on public.client_documents
  for update to authenticated
  using ((select public.is_admin()) or public.can_see_client(client_id))
  with check ((select public.is_admin()) or public.can_see_client(client_id));

drop trigger if exists trg_audit_client_documents on public.client_documents;
create trigger trg_audit_client_documents
  after insert or update or delete on public.client_documents
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 4) سياسات التخزين — المسار يقول لمن الملفّ
--
-- ⚠️ لا سياسة update: الملفّ لا يُستبدَل في مكانه. تعديله يعني رفع
--    نسخة جديدة وإخفاء القديمة — فيبقى للتاريخ نسختاه لا نسخة
--    كُتب فوقها.
-- ------------------------------------------------------------
drop policy if exists "read client docs storage" on storage.objects;
create policy "read client docs storage" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'clients'
    and (
      (select public.is_admin())
      or (select public.can_read_all_crm())
      or public.can_see_client(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists "write client docs storage" on storage.objects;
create policy "write client docs storage" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'clients'
    and ((select public.is_admin())
         or public.can_see_client(((storage.foldername(name))[2])::uuid))
  );

-- المحو النهائي للمدير وحده — وهو الاستثناء لا القاعدة
drop policy if exists "delete client docs storage" on storage.objects;
create policy "delete client docs storage" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-documents' and (select public.is_admin()));

-- ------------------------------------------------------------
-- 5) التحقّق
-- ------------------------------------------------------------
do $$
declare b record; n_pol int;
begin
  select id, public, file_size_limit into b from storage.buckets where id = 'client-documents';
  select count(*) into n_pol from pg_policies
   where schemaname = 'storage' and policyname like '%client docs%';

  raise notice '--- 087 مستندات العميل ---';
  if b.id is null then
    raise warning 'الدلو لم يُنشأ — راجع صلاحيات storage.';
  else
    raise notice 'الدلو: % · عامّ: % (يجب false) · الحدّ: % مب',
      b.id, b.public, round(b.file_size_limit / 1048576.0);
  end if;
  raise notice 'سياسات التخزين: % (المتوقَّع ٣)', n_pol;
  raise notice 'التحميل برابط موقَّع ينتهي — لا رابط دائم.';
end $$;

notify pgrst, 'reload schema';
