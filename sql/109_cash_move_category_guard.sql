-- ============================================================
-- تلال ERP — 109: إيقاف تصنيفات الحركات المخالفة لنموذج الوساطة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- الحركة النقدية (cash_moves) تكتب على الحساب الذي يختاره التصنيف.
-- أربعة تصنيفات تكتب على حسابٍ له مسارٌ آليّ آخر، فيتكرّر الرقم:
--
--   التصنيف            الحساب   المسار الصحيح                       الخطر
--   ─────────────────  ──────   ──────────────────────────────────  ─────────────────────
--   بيع عقار أو وحدة   4100     لا قيد — ثمن الوحدة للمطوّر (056)   إيراد ليس لتلال
--   عمولة عقارية       4200     «تسجيل التحصيل» في صفحة الوحدة      إيراد مرتين، 1250 معلّق
--   رواتب وأجور        5100     «دفع» في كشوف الرواتب (2300)        مصروف الراتب مرتين
--   عمولات مدفوعة      5500     كشف الراتب / دفعات الوسطاء          مصروف العمولة مرتين
--
-- وقالب القيد اليدوي فيه مثلها (بيع وحدة، عربون 2400، قبض عمولة 4200،
-- دفع راتب، دفع عمولة) — تُزال من الواجهة في الملف نفسه من src/.
--
-- الواقع (2026-10-01): ٢١ حركة «رواتب وأجور» (11,398,015 − قيود الكشوف)
-- ولا حركة على 4100 أو 4200 أو 5500. التاريخ لا يُمسّ.
--
-- ===== ما يضيفه =====
--
--   ١) حساب 5110 «أجور يومية ومستقلون» — للمصوّر والأسبوعية ومن
--      ليس على كشف رواتب. 5100 يبقى لقيود الكشوف وحدها، فتصير
--      مطابقته مع الكشوف ممكنة (110).
--   ٢) 4100 و2400 غير نشطين: لا يظهران في القيد اليدوي، والحسابان
--      باقيان بتاريخهما (صفر سطور اليوم).
--   ٣) حارسٌ على cash_moves:
--      • حركة جديدة على 4100/4200/5100/5500/2400 تُرفض برسالة تسمّي
--        المسار الصحيح.
--      • حركة على حسابٍ غير موجود أو غير نشط تُرفض — كانت تُحفظ
--        بلا قيد بصمت (post_cash_move_to_ledger «نتجنّب الخطأ»).
--      • حركة مُرحَّلة لا تُعدَّل أرقامها: لا محفّز تعديل يعيد
--        ترحيلها، فالتعديل كان يفصل الحركة عن قيدها. يُسمح بالبيان
--        والملاحظات. التصحيح = حذف وإدخال، أو حركة معاكسة.
--
-- ===== التراجع =====
--
--   drop trigger trg_guard_cash_move on public.cash_moves;
--   update public.accounts set is_active = true where code in ('4100','2400');
--   (5110 يبقى إن كُتب عليه.)
--
-- يتطلب: 018، 056. آمن لإعادة التشغيل.
-- ============================================================

insert into public.accounts (code, name, type)
values ('5110', 'أجور يومية ومستقلون', 'expense')
on conflict (code) do nothing;

update public.accounts set is_active = false
 where code in ('4100', '2400') and is_active;

comment on column public.accounts.is_active is
  'غير النشط لا يُختار في قيد ولا حركة جديدة، وتاريخه باقٍ. 4100 و2400 مجمّدان منذ 056 (sql/109).';


create or replace function public.guard_cash_move()
returns trigger language plpgsql set search_path = public as $fn$
declare v_active boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.amount, new.direction, new.account_code, new.method, new.partner_id,
        new.move_date, new.arm, new.category)
       is distinct from
       (old.amount, old.direction, old.account_code, old.method, old.partner_id,
        old.move_date, old.arm, old.category) then
      raise exception 'الحركة مُرحَّلة في الدفاتر — لا تُعدَّل أرقامها. احذفها وأدخلها من جديد، أو سجّل حركة معاكسة';
    end if;
    return new;
  end if;

  -- INSERT
  if new.account_code = '4100' then
    raise exception 'تلال وسيط لا بائع — ثمن الوحدة لا يدخل إيرادها. عمولة الصفقة تُستحقّ من صفحة الوحدة عند تأكيد المقدمة';
  elsif new.account_code = '4200' then
    raise exception 'عمولة الصفقة تُحصَّل من صفحة الوحدة («تسجيل التحصيل») لتُسقط ذمّة المطوّر 1250 — لا تُسجَّل إيراداً جديداً';
  elsif new.account_code = '5100' then
    raise exception 'رواتب الموظفين تُدفع من كشوف الرواتب (زرّ «دفع»). الأجر اليومي والمستقل: تصنيف «أجور يومية ومستقلون»';
  elsif new.account_code = '5500' then
    raise exception 'عمولة الموظف تُدفع ضمن كشف راتبه، وعمولة الشركة الوسيطة من صفحة الوسطاء';
  elsif new.account_code = '2400' then
    raise exception 'العربون يذهب للمطوّر ولا يدخل صندوق تلال (sql/056)';
  end if;

  select is_active into v_active from public.accounts where code = new.account_code;
  if v_active is null then
    raise exception 'الحساب % غير موجود في شجرة الحسابات — الحركة لا تُحفظ بلا قيد', new.account_code;
  elsif not v_active then
    raise exception 'الحساب % غير نشط', new.account_code;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_cash_move on public.cash_moves;
create trigger trg_guard_cash_move
  before insert or update on public.cash_moves
  for each row execute function public.guard_cash_move();

revoke execute on function public.guard_cash_move() from public, anon, authenticated;
