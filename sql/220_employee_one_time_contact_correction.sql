-- ============================================================
-- تلال ERP — 220: موظف المبيعات يصحّح اسم عميله ورقمه — مرة واحدة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الطلب (2026-10-31): «صلاحية لموظفي المبيعات: يعدّلون اسم الزبون
--   ورقم هاتفه لمرة واحدة بعد إضافته».
--
-- الواقع قبلها:
--   • نموذج «تعديل» البطاقة للمدير ومدير التسويق ومشرف الفريق وحدهم
--     (canEditClientCard) — فالموظف الذي أخطأ في حرفٍ من الاسم أو رقمٍ
--     من الهاتف يطلب من مشرفه.
--   • لكن «update own clients» تسمح له بكتابة بطاقته كلها عبر الـAPI،
--     فالمنع كان في الواجهة وحدها، بلا حدّ.
--
-- الحلّ:
--   (١) حارس قبل التحديث: تغيير الاسم أو الرقم ممن ليس مديراً ولا مدير
--       تسويق ولا مشرفاً يمرّ مرة واحدة على البطاقة، ويُختم بوقته وفاعله
--       والقيمتين قبله (contact_before) — فالمشرف يرى ما تغيّر.
--       المرة الثانية تُرفض برسالة: «اطلب من مشرفك».
--   (٢) الاسم لا يُفرَّغ، والرقم لا يُمسح — تصحيحٌ لا حذف.
--   (٣) الرقم الجديد يمرّ على كشف التكرار كأي رقم (trg_zz_detect_duplicates
--       بعد التحديث) — فإن كان لبطاقةٍ أخرى ظهر شريط التكرار.
--
-- ما لا يتغيّر: من يملك كتابة البطاقة أصلاً (RLS كما هي)، والمدير
--   ومدير التسويق والمشرف يعدّلون بلا حدّ من نموذج التعديل. الدمج
--   (tilal.merging)، والنظام (auth.uid() فارغ: البوّابة والاستيراد)،
--   والوسيط على ليداته — خارج الحدّ.
--
-- يتطلب: 104 (tilal.merging)، 212 (is_marketing_manager). آمن لإعادة التشغيل.
-- ============================================================

alter table public.clients
  add column if not exists contact_corrected_at timestamptz,
  add column if not exists contact_corrected_by uuid references auth.users(id) on delete set null,
  add column if not exists contact_before       jsonb;

comment on column public.clients.contact_corrected_at is
  '220: متى صحّح الموظف اسم العميل/رقمه — تصحيحه الوحيد. فارغ = لم يُستعمل';
comment on column public.clients.contact_before is
  '220: {name, phone} قبل تصحيح الموظف';

create or replace function public.guard_client_contact_correction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- الختم أعمدة النظام: لا تُكتب من الواجهة ولا تُصفَّر لتصحيحٍ ثانٍ.
  -- (إعادة السماح لبطاقةٍ بعينها: من محرّر SQL حيث auth.uid() فارغ)
  if auth.uid() is not null then
    new.contact_corrected_at := old.contact_corrected_at;
    new.contact_corrected_by := old.contact_corrected_by;
    new.contact_before       := old.contact_before;
  end if;

  if new.name is not distinct from old.name and new.phone is not distinct from old.phone then
    return new;
  end if;

  if coalesce(current_setting('tilal.merging', true), '') = 'on'
     or auth.uid() is null
     or public.is_marketing_manager()   -- ومعه المدير
     or public.is_supervisor()
     or public.is_broker() then
    return new;
  end if;

  if nullif(btrim(coalesce(new.name, '')), '') is null then
    raise exception 'اسم العميل لا يُترك فارغاً.';
  end if;
  if nullif(btrim(coalesce(new.phone, '')), '') is null and old.phone is not null then
    raise exception 'رقم العميل لا يُمسح — صحّحه برقمٍ آخر.';
  end if;

  if old.contact_corrected_at is not null then
    raise exception 'صُحّح اسم هذا العميل ورقمه مرة من قبل، والتصحيح مرة واحدة فقط — اطلب من مشرفك تعديله.'
      using hint = 'contact_correction_used';
  end if;

  new.contact_corrected_at := now();
  new.contact_corrected_by := auth.uid();
  new.contact_before       := jsonb_build_object('name', old.name, 'phone', old.phone);
  return new;
end; $$;

revoke all on function public.guard_client_contact_correction() from public, anon, authenticated;

-- قبل كشف التكرار (بعد التحديث) وقبل guard_client_owner — ترتيب الاسم أبجدي
drop trigger if exists trg_b_guard_client_contact on public.clients;
create trigger trg_b_guard_client_contact
  before update of name, phone, contact_corrected_at, contact_corrected_by, contact_before on public.clients
  for each row execute function public.guard_client_contact_correction();
