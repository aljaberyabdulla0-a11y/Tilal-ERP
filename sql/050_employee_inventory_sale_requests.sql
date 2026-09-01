-- ============================================================
-- تلال ERP — 050: مخزون المشاريع للموظف، وطلب تحويل الحجز إلى بيع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-09-01) شيئان:
--
--   1) الموظف يضيف «من ينوب عن العميل» من ملفّ العميل مباشرة بلا
--      إذن مدير. وهذا **لا يحتاج سطر SQL واحداً**: سياسة
--      `update own clients` (sql/043) تسمح له أصلاً بتعديل عميلٍ
--      أنشأه أو يحمل اسمه. المنع كان في الواجهة وحدها — زرّ
--      «تعديل» كان مخفياً عن غير المدير. يُفتح في الشاشة لا هنا.
--      (نتركه مكتوباً لأن من يقرأ الملف بعد سنة سيسأل: أين حصّته؟)
--
--   2) الموظف يرى مخزون مشاريعه، ويحجز وحدة، و**يطلب** تحويل
--      حجزه إلى بيع — والبيع نفسه لا يقع إلا بموافقة الإدارة.
--      هذا ما يبنيه الملف.
--
-- لماذا طلبٌ لا صلاحية؟ لأن «بيع مكتمل» ليس تغيير حالة في شاشة:
-- يُصدر فاتورة، ويعترف بالإيراد في الدفاتر، ويستحقّ عمولة
-- (sql/047 و sql/048). فالموظف يرفع الطلب، والإدارة تُمضيه.
--
-- ⚠️ التنفيذ عبر دالتين security definer لا عبر توسيع RLS. لو
--    فتحنا للموظف `update` على الحجوزات لصار يقدر يكتب
--    status = 'بيع مكتمل' بنفسه — والطلب حينها زينة. الدالة هي
--    الباب الوحيد، وهي التي تفحص من يطلب ومن يوافق.
--
-- طُبّق على القاعدة في 2026-09-01 عبر هجرة:
--   employee_inventory_sale_requests
--
-- يتطلب: sql/044 (المخزون) و sql/022 (الإشعارات). آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة الطلب على صفّ الحجز
-- ------------------------------------------------------------
-- على الحجز نفسه لا في جدول مستقل: الطلب صفةٌ للحجز لا كيان له
-- عمر مستقل، وجدولٌ منفصل كان سيفرض ربطاً في كل استعلام مقابل
-- لا شيء. والسجلّ التاريخي محفوظ في unit_events على أي حال.
alter table public.reservations
  add column if not exists sale_request_status text,
  add column if not exists sale_requested_at   timestamptz,
  add column if not exists sale_requested_by   uuid references auth.users(id) on delete set null,
  add column if not exists sale_request_note   text,
  add column if not exists sale_decided_at     timestamptz,
  add column if not exists sale_decided_by     uuid references auth.users(id) on delete set null,
  add column if not exists sale_reject_reason  text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_sale_request_status_chk'
  ) then
    alter table public.reservations
      add constraint reservations_sale_request_status_chk
      check (sale_request_status is null
             or sale_request_status in ('معلّق', 'مقبول', 'مرفوض'));
  end if;
end $$;

comment on column public.reservations.sale_request_status is
  'طلب تحويل الحجز إلى بيع: معلّق (بانتظار الإدارة) | مقبول | مرفوض. فارغ = لا طلب.';

-- فهرس للطلبات المعلّقة وحدها — الشاشة تسأل عنها كل مرة، وهي
-- قلّة بين آلاف الحجوزات، فالفهرس الجزئي يكفي ويبقى صغيراً.
create index if not exists reservations_pending_sale_idx
  on public.reservations (sale_requested_at desc)
  where sale_request_status = 'معلّق';

-- ------------------------------------------------------------
-- 2) من يملك الطلب؟ صاحب الصفقة.
-- ------------------------------------------------------------
-- الموظف الذي سجّل الحجز أو المسؤول عنه — لا كل من يرى الحجز.
-- بدون هذا الشرط كان زميلٌ يرى وحدة زميله فيطلب بيعها.
create or replace function public.can_request_unit_sale(p_res uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.reservations r
      join public.units u on u.id = r.unit_id
     where r.id = p_res
       and (
            r.created_by = auth.uid()
         or (r.agent_id is not null and r.agent_id = public.my_employee_id())
         or public.can_manage_project(u.project_id)
       )
  );
$$;

-- ------------------------------------------------------------
-- 3) رفع الطلب
-- ------------------------------------------------------------
create or replace function public.request_unit_sale(p_res uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.reservations%rowtype;
  v_unit     text;
  v_project  uuid;
  v_client   text;
  v_who      text;
  v_note     text;
begin
  select * into r from public.reservations where id = p_res;
  if not found then
    raise exception 'الحجز غير موجود';
  end if;

  if not public.can_request_unit_sale(p_res) then
    raise exception 'هذا الحجز ليس من صفقاتك';
  end if;

  if r.status <> 'حجز' then
    raise exception 'لا يُطلب البيع إلا على حجز قائم (حالته الآن: %)', r.status;
  end if;

  if r.sale_request_status = 'معلّق' then
    raise exception 'الطلب مرفوع بالفعل وبانتظار الإدارة';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select u.unit_code, u.project_id into v_unit, v_project
    from public.units u where u.id = r.unit_id;
  select c.name into v_client from public.clients c where c.id = r.client_id;
  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p
    left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  update public.reservations
     set sale_request_status = 'معلّق',
         sale_requested_at   = now(),
         sale_requested_by   = auth.uid(),
         sale_request_note   = v_note,
         sale_decided_at     = null,
         sale_decided_by     = null,
         sale_reject_reason  = null
   where id = p_res;

  perform public.log_unit_event(
    r.unit_id, 'طلب بيع',
    coalesce(v_who, 'موظف') || ' يطلب تحويل حجز ' || coalesce(v_client, '—') || ' إلى بيع');

  -- الإشعار للمدراء ولمشرف المشروع — من يملك البتّ هو من يُنبَّه.
  -- union لا union all: مشرفٌ صار دوره admin يوماً لا يصله إشعاران.
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select t.uid,
         'طلب تحويل حجز إلى بيع',
         coalesce(v_who, 'موظف') || ' يطلب بيع الوحدة ' || coalesce(v_unit, '—')
           || ' للعميل ' || coalesce(v_client, '—')
           || case when v_note is not null then ' — ' || v_note else '' end,
         '/dashboard/reservations',
         'بيع',
         p_res
    from (
      select p.id as uid from public.profiles p where p.role = 'admin'
      union
      select e.user_id from public.projects pr
        join public.employees e on e.id = pr.supervisor_id
       where pr.id = v_project and e.user_id is not null
    ) t
   where t.uid is not null
     and t.uid <> auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- 4) البتّ في الطلب — قبولاً أو رفضاً
-- ------------------------------------------------------------
-- من يوافق؟ من يملك إتمام البيع أصلاً: المدير، ومشرف المشروع
-- الذي يملكها منذ sql/039. لو قصرناها على المدير لصار المشرف
-- يتمّ البيع بزرّ ولا يقدر يقبل طلباً بنفس البيع — تناقض.
create or replace function public.decide_unit_sale(
  p_res     uuid,
  p_approve boolean,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.reservations%rowtype;
  v_unit   text;
  v_client text;
  v_reason text;
begin
  select * into r from public.reservations where id = p_res;
  if not found then
    raise exception 'الحجز غير موجود';
  end if;

  if not exists (
    select 1 from public.units u
     where u.id = r.unit_id and public.can_manage_project(u.project_id)
  ) then
    raise exception 'الموافقة على البيع للإدارة';
  end if;

  if r.sale_request_status is distinct from 'معلّق' then
    raise exception 'لا يوجد طلب معلّق على هذا الحجز';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  select u.unit_code into v_unit from public.units u where u.id = r.unit_id;
  select c.name into v_client from public.clients c where c.id = r.client_id;

  if p_approve then
    -- تغيير الحالة هنا يجرّ خلفه كل ما يجرّه زرّ «إتمام البيع»:
    -- الوحدة تصير مباعة، والعربون يُعترف به، والعمولة تُحتسب.
    -- لذلك لا نلمس شيئاً من ذلك بأيدينا — المحفّزات تفعل.
    update public.reservations
       set status              = 'بيع مكتمل',
           sale_request_status = 'مقبول',
           sale_decided_at     = now(),
           sale_decided_by     = auth.uid()
     where id = p_res;
  else
    if v_reason is null then
      raise exception 'اكتب سبب الرفض — الموظف يحتاج يعرف ماذا يصحّح';
    end if;
    update public.reservations
       set sale_request_status = 'مرفوض',
           sale_decided_at     = now(),
           sale_decided_by     = auth.uid(),
           sale_reject_reason  = v_reason
     where id = p_res;

    perform public.log_unit_event(
      r.unit_id, 'رفض بيع',
      'رُفض طلب بيع ' || coalesce(v_client, '—') || ' — ' || v_reason);
  end if;

  -- خبر القرار يعود لصاحب الطلب — لا يبقى ينتظر بلا جواب
  if r.sale_requested_by is not null and r.sale_requested_by <> auth.uid() then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (
      r.sale_requested_by,
      case when p_approve then 'تمّت الموافقة على البيع' else 'رُفض طلب البيع' end,
      'الوحدة ' || coalesce(v_unit, '—') || ' للعميل ' || coalesce(v_client, '—')
        || case when p_approve then ' — صارت مباعة.' else ' — ' || coalesce(v_reason, '') end,
      '/dashboard/units/' || r.unit_id::text,
      'بيع',
      p_res
    );
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5) الطلب يسقط إذا سقط سببه
-- ------------------------------------------------------------
-- حجزٌ أُلغي أو بيعٌ أُتمّ من طريق آخر يترك طلباً معلّقاً بلا معنى،
-- فيبقى في شاشة الإدارة يطلب قراراً في أمرٍ انتهى.
--
-- ⚠️ الشرط الأخير يستثني قرار الدالة نفسها: هي تكتب الحالة
--    وحقل الطلب معاً في جملة واحدة، فلا نعيد الكتابة فوقها.
create or replace function public.clear_stale_sale_request()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and new.status <> 'حجز'
     and old.sale_request_status = 'معلّق'
     and new.sale_request_status is not distinct from old.sale_request_status then
    new.sale_request_status := case when new.status = 'بيع مكتمل' then 'مقبول' else null end;
    new.sale_decided_at     := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_stale_sale_request on public.reservations;
create trigger trg_clear_stale_sale_request
  before update of status on public.reservations
  for each row execute function public.clear_stale_sale_request();

-- ------------------------------------------------------------
-- 6) الصلاحيات
-- ------------------------------------------------------------
revoke all on function public.request_unit_sale(uuid, text)         from public, anon;
revoke all on function public.decide_unit_sale(uuid, boolean, text) from public, anon;
grant execute on function public.can_request_unit_sale(uuid)          to authenticated;
grant execute on function public.request_unit_sale(uuid, text)        to authenticated;
grant execute on function public.decide_unit_sale(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
