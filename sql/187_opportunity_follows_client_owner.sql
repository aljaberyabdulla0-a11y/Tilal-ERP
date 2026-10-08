-- ============================================================
-- تلال ERP — 187: الفرصة المفتوحة تنتقل مع عميلها
--
-- العَرَض: نقل العميل لموظف آخر (التوزيع، تسليم العهدة، assign_client)
--   يغيّر clients.owner_id وحده، وتبقى فرصته المفتوحة باسم المالك
--   القديم — حتى لو غادر. فالفرصة تُحسب في خطّ مبيعات موظف لا يملك
--   العميل، ويغيب عنها المالك الجديد في كل ما يُبنى على
--   opportunities.owner_id. (عند كتابة الملف: ١٨ فرصة مفتوحة، ١٧ منها
--   باسم موظفتين غير نشطتين بعد تسليم عهدتهما.)
--
-- القاعدة: الفرصة **المفتوحة** يملكها مالك بطاقتها، دائماً.
--   الفرص المغلقة (ربح/خسارة) لا تُمسّ: الربح محسوبٌ لمن باع، والخسارة
--   على من خسر — وتحليل الخسارة (140) والعمولة مبنيّان على ذلك.
--
--   1) محفّز على clients: تغيّر owner_id ← فرصه المفتوحة تتبعه.
--      يعمل في الدمج أيضاً (لا يُتخطّى بـ tilal.merging): البطاقة الباقية
--      بعد الدمج مالكٌ واحد لكل فرصها المفتوحة.
--   2) محفّز على opportunities: فرصة مفتوحة تنتقل لبطاقة أخرى (الدمج
--      ينقل client_id) ← تأخذ مالك البطاقة الجديدة.
--   3) ترحيل الفرص المفتوحة المخالفة الآن.
--
-- كلاهما security definer: من يملك حقّ نقل العميل قد لا يملك حقّ تعديل
-- الفرصة مباشرة، والمزامنة نتيجةٌ للنقل لا صلاحيةٌ جديدة.
-- ============================================================

-- 1) العميل ← فرصه المفتوحة
create or replace function public.sync_open_opportunities_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.opportunities o
     set owner_id = new.owner_id
   where o.client_id = new.id
     and o.closed_at is null
     and o.deleted_at is null
     and o.owner_id is distinct from new.owner_id;
  return null;
end $$;

comment on function public.sync_open_opportunities_owner() is
  'الفرصة المفتوحة يملكها مالك بطاقتها: تغيّر clients.owner_id ينقل فرصه المفتوحة معه (187).';

drop trigger if exists trg_sync_open_opportunities_owner on public.clients;
create trigger trg_sync_open_opportunities_owner
  after update of owner_id on public.clients
  for each row
  when (new.owner_id is distinct from old.owner_id)
  execute function public.sync_open_opportunities_owner();

-- 2) فرصة مفتوحة تنتقل لبطاقة أخرى ← مالك البطاقة الجديدة
create or replace function public.opportunity_owner_on_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.closed_at is null and new.deleted_at is null then
    select c.owner_id into new.owner_id from public.clients c where c.id = new.client_id;
  end if;
  return new;
end $$;

comment on function public.opportunity_owner_on_move() is
  'فرصة مفتوحة نُقلت لبطاقة أخرى (الدمج) تأخذ مالك البطاقة الجديدة (187).';

drop trigger if exists trg_opportunity_owner_on_move on public.opportunities;
create trigger trg_opportunity_owner_on_move
  before update of client_id on public.opportunities
  for each row
  when (new.client_id is distinct from old.client_id)
  execute function public.opportunity_owner_on_move();

-- 3) الترحيل
update public.opportunities o
   set owner_id = c.owner_id
  from public.clients c
 where c.id = o.client_id
   and o.closed_at is null
   and o.deleted_at is null
   and o.owner_id is distinct from c.owner_id;

-- ===== التحقّق =====
do $$
declare n int;
begin
  select count(*) into n
    from public.opportunities o join public.clients c on c.id = o.client_id
   where o.closed_at is null and o.deleted_at is null
     and o.owner_id is distinct from c.owner_id;
  raise notice '187: فرص مفتوحة مالكها غير مالك بطاقتها: % (المتوقَّع 0)', n;
end $$;
