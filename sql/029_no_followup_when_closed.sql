-- ============================================================
-- تلال ERP — لا متابعة بعد إغلاق الملف (بيع / فشل البيع)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ما يتغيّر عن sql/028:
--   • موعد المتابعة يبقى إلزامياً ما دام العميل في مرحلة مفتوحة.
--   • إذا صارت حالته «بيع» أو «فشل البيع» فلا خطوة قادمة ولا موعد —
--     يُحفظ التواصل بدونهما، وأي قيمة تصل تُفرَّغ تلقائياً.
--   • عند نقل العميل لمرحلة مغلقة يُمسح تاريخ متابعته فلا تصله تذكيرات.
--
-- القيد القديم (check) لا يستطيع النظر إلى مرحلة العميل في جدول آخر،
-- لذا استبدلناه بمحفّز يقرأ المرحلة قبل الحفظ.
--
-- يتطلب: sql/026 و sql/027 (دالة is_open_stage). الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) إزالة القيد الثابت — صار الفحص في المحفّز
-- ------------------------------------------------------------
alter table public.client_activities
  drop constraint if exists client_activities_next_date_chk;

-- ------------------------------------------------------------
-- 2) فحص المتابعة حسب مرحلة العميل
-- ------------------------------------------------------------
create or replace function public.enforce_activity_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  client_stage text;
begin
  -- «تغيير مرحلة» يسجّله النظام تلقائياً بلا متابعة
  if new.activity_type = 'تغيير مرحلة' then
    return new;
  end if;

  select stage into client_stage
    from public.clients
   where id = new.client_id;

  if not public.is_open_stage(client_stage) then
    -- ملف مغلق: لا خطوة قادمة ولا موعد
    new.next_action := null;
    new.next_action_date := null;
    return new;
  end if;

  if new.next_action_date is null then
    raise exception
      'حدّد موعد المتابعة القادم — إلزامي ما دام ملف العميل مفتوحاً.';
  end if;

  return new;
end; $$;

drop trigger if exists trg_activity_followup on public.client_activities;
create trigger trg_activity_followup
  before insert or update on public.client_activities
  for each row execute function public.enforce_activity_followup();

-- ------------------------------------------------------------
-- 3) إغلاق الملف يمسح تاريخ المتابعة على العميل
--    (before trigger — يشمل التحديث القادم من محفّز الأنشطة أيضاً)
-- ------------------------------------------------------------
create or replace function public.clear_followup_when_closed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_open_stage(new.stage) then
    new.follow_up_date := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_client_clear_followup on public.clients;
create trigger trg_client_clear_followup
  before insert or update on public.clients
  for each row execute function public.clear_followup_when_closed();

-- ------------------------------------------------------------
-- 4) تنظيف العملاء المغلقين الذين ما زال لهم تاريخ متابعة
--    (سجلّ التواصل القديم يبقى كما هو — هو تاريخ لا يُمسح)
-- ------------------------------------------------------------
update public.clients
   set follow_up_date = null
 where follow_up_date is not null
   and not public.is_open_stage(stage);

notify pgrst, 'reload schema';
