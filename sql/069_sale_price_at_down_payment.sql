-- ============================================================
-- تلال ERP — 069: سعر البيع يُدخَل عند تأكيد المقدمة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المشكلة =====
--
-- محرّك العمولة يقرأ سعره من units.price، و٤٠٠ وحدة في مجمّع
-- الفرقان سعرها فارغ. فالنتيجة اليوم ليست عمولةً بصفر، بل
-- **لا سجلّ عمولة أصلاً**: record_sale_commission() تكتب صفّاً
-- بأصفار، ثم confirm_down_payment() ترفض قائلةً «لا سجلّ عمولة
-- لهذه الصفقة». المسار مقفلٌ من طرفيه.
--
-- والسبب أعمق من بيانات ناقصة: تلال وسيطٌ لا بائع، فسعرُ الوحدة
-- لا يُعرف حتى تُبرَم الصفقة. طلبُ السعر يوم إدخال الوحدة إلى
-- المخزون طلبٌ لما لا يملكه أحدٌ بعد.
--
-- ===== المبدأ: الرقم يُطلَب حين يُعرَف =====
--
-- السعر يُدخَل يدوياً لحظة **تأكيد المقدمة** — لا عند الحجز، ولا
-- عند العربون، ولا عند إدخال الوحدة. وهي اللحظة نفسها التي
-- تُستحقّ فيها العمولة في نموذج الوساطة (sql/056)، فيلتقي
-- السؤال بجوابه: نسأل عن السعر في اللحظة التي نحتاجه فيها.
--
--   العربون   → متابعة فقط، بلا قيد وبلا سعر.
--   المقدمة   → هنا يُدخَل السعر، وهنا تُولَد العمولة وقيدها.
--
-- ===== ثلاثة تغييرات =====
--
--   ١) reservations.sale_price — سعر هذه الصفقة، مجمَّد بتأكيدها.
--   ٢) record_sale_commission() — أساسها sale_price ثم units.price،
--      و**لا تُولّد صفّاً بلا سعر**. صفقةٌ بلا سعر لا عمولة لها
--      تُجمَّد على صفر، بل تنتظر سعرها.
--   ٣) confirm_down_payment() — تأخذ السعر، تُجمّده، تملأ سعر
--      الوحدة إن كان فارغاً، ثم تحسب العمولة وتكتب القيد.
--
-- ⚠️ لماذا لا تُولَّد العمولة بصفر ثم تُصحَّح؟ لأن sale_commissions
--    مجمَّدة بالتصميم (القاعدة الخامسة): النِّسب تُثبَّت وقت البيع
--    ولا تُعدَّل بأثر رجعي. فالمخرج الصحيح ألّا يُولَد الصفّ قبل
--    أن يكون صحيحاً، لا أن يُولَد خطأً ثم يُحرَّر.
--
-- ⚠️ التصحيح بعد التأكيد: بفسخ الصفقة (reverse_sale) ثم إعادتها.
--    السعر يتجمّد بالتأكيد كما تتجمّد كل الأرقام المالية، ومحفّز
--    freeze_sale_price يرفض تعديله. وسعرُ الوحدة الذي مُلئ يبقى
--    بعد الفسخ — يعدّله المدير من شاشة الوحدة إن شاء.
--
-- ===== حالة القاعدة وقت الكتابة =====
--   لا صفّ واحد في sale_commissions. فنقل الحساب إلى لحظة المقدمة
--   لا يمسّ رقماً مجمَّداً ولا يخالف قاعدة «لا تعديل بأثر رجعي».
--
-- ===== التراجع =====
--   إعادة الدالّتين من sql/056، وحذف محفّز freeze_sale_price،
--   وحذف عمود sale_price، وإعادة guard_unit_authority من sql/044.
--
-- يتطلب: sql/056 و sql/068. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) سعر الصفقة
--
-- على الحجز لا على الوحدة، لأن ما بِيعت به الوحدة قد يخالف سعر
-- القائمة بعد التفاوض — والعمولة تُحسب مما دُفع فعلاً.
-- ------------------------------------------------------------
alter table public.reservations
  add column if not exists sale_price numeric;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_sale_price_chk') then
    alter table public.reservations
      add constraint reservations_sale_price_chk
      check (sale_price is null or sale_price > 0);
  end if;
end
$do$;

comment on column public.reservations.sale_price is
  'سعر بيع الوحدة في هذه الصفقة — أساس العمولة، يُدخل يدوياً عند تأكيد المقدمة ويتجمّد بها (sql/069).';


-- ------------------------------------------------------------
-- 2) سعر الصفقة لا يُعدَّل بعد التأكيد
--
-- confirm_down_payment وحدها تكتبه، لكن سياسة «تعديل الحجوزات في
-- النطاق» تسمح للمدير والمشرف بالكتابة المباشرة في الجدول. ورقمٌ
-- دخل الدفاتر لا يُترك مفتوحاً لتعديلٍ من شاشة.
-- ------------------------------------------------------------
create or replace function public.freeze_sale_price()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.down_payment_confirmed_at is not null
     and new.sale_price is distinct from old.sale_price then
    raise exception
      'سعر البيع تجمّد بتأكيد المقدمة — التصحيح بفسخ الصفقة ثم إعادتها';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_freeze_sale_price on public.reservations;
create trigger trg_freeze_sale_price
  before update on public.reservations
  for each row execute function public.freeze_sale_price();


-- ------------------------------------------------------------
-- 3) استثناءٌ ضيّق في حارس سعر الوحدة
--
-- guard_unit_authority يرفض تعديل units.price من غير المدير. وهو
-- صحيح: السعر سلطةٌ لا تُترك للجميع. لكن مشرف المشروع يؤكّد
-- المقدمة، وتأكيدها يملأ سعر الوحدة الفارغ — فيصطدم بالحارس.
--
-- الاستثناء بعلمٍ محلّي للمعاملة (set local) لا بتوسيع الصلاحية:
-- يُرفع داخل confirm_down_payment وحدها، وينتهي بانتهاء المعاملة،
-- ولا سبيل لرفعه من المتصفّح. ومشروطٌ بشرطين معاً: العلم مرفوع،
-- **و**السعر القديم فارغ. فهو يملأ ولا يستبدل أبداً.
-- ------------------------------------------------------------
create or replace function public.guard_unit_authority()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.price is distinct from old.price then
      -- ملءُ سعرٍ فارغ من تأكيد المقدمة — لا استبدال سعرٍ قائم
      if not (old.price is null
              and coalesce(current_setting('tilal.unit_price_from_deal', true), '') = 'on') then
        raise exception 'تعديل سعر الوحدة للمدير وحده';
      end if;
    end if;
    if (new.status = 'موقوفة') is distinct from (old.status = 'موقوفة') then
      raise exception 'إيقاف الوحدة ورفع الإيقاف للمدير وحده';
    end if;
  end if;

  return new;
end;
$fn$;


-- ------------------------------------------------------------
-- 4) محرّك العمولة يقرأ سعر الصفقة، ولا يولّد صفّاً بلا سعر
-- ------------------------------------------------------------
create or replace function public.record_sale_commission(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  res     record;
  u       record;
  idx     int;
  v_price numeric;
  v_rate  numeric;
  v_comp  numeric;
  rule    public.employee_commission_rules%rowtype;
  v_emp   uuid;
  v_amt   numeric := 0;
  v_basis text;
begin
  select * into res from public.reservations where id = p_reservation;
  if not found or res.status <> 'بيع مكتمل' then return; end if;

  -- صفقة واحدة سجلٌّ واحد: إعادة الحفظ لا تكرّرها ولا تعيد الحساب،
  -- فالنسبة المستحقّة يوم البيع لا تتغيّر بتعديل لاحق على القواعد.
  if exists (select 1 from public.sale_commissions s where s.reservation_id = p_reservation) then
    return;
  end if;

  select * into u from public.units where id = res.unit_id;
  if u is null then return; end if;

  -- ⚠️ أساس العمولة: سعر هذه الصفقة، وإلا سعر القائمة (sql/069).
  -- وبلا سعرٍ لا يُولَد صفٌّ أصلاً: صفٌّ بأصفار يتجمّد على الخطأ
  -- ويسدّ الطريق أمام حسابه الصحيح عند تأكيد المقدمة.
  v_price := coalesce(res.sale_price, u.price);
  if coalesce(v_price, 0) <= 0 then return; end if;

  -- ترتيب هذه الصفقة في مشروعها — عليه تُحدَّد الشريحة
  select count(*) into idx
  from public.reservations r
  join public.units un on un.id = r.unit_id
  where r.status = 'بيع مكتمل'
    and un.project_id is not distinct from u.project_id
    and r.created_at <= res.created_at;
  idx := greatest(coalesce(idx, 1), 1);

  v_rate := public.project_commission_rate(u.project_id, idx);
  v_comp := round(v_price * v_rate / 100);

  v_emp := res.agent_id;
  if v_emp is null then
    select e.id into v_emp
    from public.clients c
    join public.employees e
      on public.name_key(e.full_name) = public.name_key(c.sales_employee)
    where c.id = res.client_id limit 1;
  end if;

  if v_emp is not null then
    select * into rule from public.resolve_commission_rule(v_emp, u.project_id, u.space_m2);

    if rule.id is not null then
      v_amt := case rule.kind
        when 'نسبة من عمولة الشركة' then round(v_comp * rule.value / 100)
        when 'نسبة من سعر البيع'    then round(v_price * rule.value / 100)
        when 'مبلغ لكل متر'          then round(coalesce(u.space_m2, 0) * rule.value)
        else round(rule.value)
      end;
      v_basis := rule.kind || ' — ' || rule.value ||
                 case when rule.kind like 'نسبة%' then '%' else ' د.ع' end;
    end if;
  end if;

  insert into public.sale_commissions (
    reservation_id, project_id, unit_id, client_id, deal_amount, unit_area,
    sales_index, company_rate, company_amount,
    employee_id, employee_basis, employee_amount, rule_id
  ) values (
    p_reservation, u.project_id, res.unit_id, res.client_id,
    v_price, u.space_m2,
    idx, v_rate, v_comp,
    v_emp, v_basis, coalesce(v_amt, 0), rule.id
  );
end;
$fn$;


-- ------------------------------------------------------------
-- 5) تأكيد المقدمة — يأخذ السعر ويولّد العمولة
--
-- التوقيع تغيّر بمعامل ثالث له قيمة افتراضية، فنداءُ الشاشة القديمة
-- بمعاملَين يبقى صالحاً ويقع على هذه الدالّة — ويردّ برسالة مفهومة
-- تطلب السعر بدل أن ينكسر.
--
-- ⚠️ لا يجتمع توقيعان بمعاملَين وثلاثة (أحدهما بقيمة افتراضية):
--    النداء يصير ملتبساً. فالقديم يُحذف صراحةً.
-- ------------------------------------------------------------
drop function if exists public.confirm_down_payment(uuid, numeric);

create or replace function public.confirm_down_payment(
  p_res        uuid,
  p_amount     numeric,
  p_sale_price numeric default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype; emp public.employees%rowtype;
  u public.units%rowtype;
  v_price numeric;
  v_unit text; v_client text; v_recv uuid; v_rev uuid; v_entry uuid; v_comm uuid;
begin
  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;

  select * into u from public.units where id = r.unit_id;

  if not exists (select 1 from public.units u2
                  where u2.id = r.unit_id and public.can_manage_project(u2.project_id)) then
    raise exception 'تأكيد المقدمة للإدارة';
  end if;

  if r.status <> 'بيع مكتمل' then
    raise exception 'لا تُؤكَّد المقدمة إلا على بيع مكتمل (الحالة الآن: %)', r.status;
  end if;

  if r.down_payment_confirmed_at is not null then
    raise exception 'المقدمة مؤكَّدة سلفاً في %',
      to_char(r.down_payment_confirmed_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD');
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'مبلغ المقدمة يجب أن يكون أكبر من صفر';
  end if;

  select * into sc from public.sale_commissions where reservation_id = p_res;

  -- ===== السعر: يُقبل مرّةً واحدة، قبل أن تُولد العمولة =====
  if sc.id is not null then
    -- عمولةٌ محسوبة سلفاً (الوحدة كان لها سعر يوم البيع). السعر
    -- لا يُعاد بأثر رجعي، فإن أُرسل مخالفاً رُفض بدل أن يُهمَل صامتاً.
    if p_sale_price is not null and p_sale_price is distinct from sc.deal_amount then
      raise exception
        'عمولة هذه الصفقة محسوبة سلفاً على سعر % — لا تُعاد بأثر رجعي. للتصحيح افسخ الصفقة ثم أعدها',
        public.fmt_qty(sc.deal_amount);
    end if;
  else
    v_price := coalesce(nullif(p_sale_price, 0), r.sale_price, u.price);
    if coalesce(v_price, 0) <= 0 then
      raise exception 'أدخل سعر بيع الوحدة — منه تُحسب عمولة الشركة وعمولة الموظف';
    end if;

    update public.reservations set sale_price = v_price where id = p_res;

    -- سعر الوحدة الفارغ يُملأ من الصفقة، والمملوء يُترك كما هو.
    -- العلم المحلّي يفتح حارس guard_unit_authority لهذه الكتابة
    -- وحدها ثم يُطفأ (البند ٣ أعلاه).
    if u.price is null and v_price > 0 then
      perform set_config('tilal.unit_price_from_deal', 'on', true);
      update public.units set price = v_price where id = r.unit_id and price is null;
      perform set_config('tilal.unit_price_from_deal', 'off', true);
    end if;

    perform public.record_sale_commission(p_res);

    select * into sc from public.sale_commissions where reservation_id = p_res;
    if sc.id is null then
      raise exception 'تعذّر حساب العمولة — راجع نسبة عمولة المشروع';
    end if;
  end if;

  select coalesce(u2.unit_code, '') into v_unit from public.units u2 where u2.id = r.unit_id;
  select name into v_client from public.clients where id = r.client_id;

  update public.reservations
     set down_payment_amount = p_amount,
         down_payment_confirmed_at = now(),
         down_payment_confirmed_by = auth.uid()
   where id = p_res;

  if coalesce(sc.company_amount, 0) > 0 then
    select id into v_recv from public.accounts where code = '1250';
    select id into v_rev  from public.accounts where code = '4200';
    if v_recv is not null and v_rev is not null then
      insert into public.journal_entries (entry_date, description, reference, arm, source)
      values ((now() at time zone 'Asia/Baghdad')::date,
              'استحقاق عمولة تلال — الوحدة ' || v_unit || ' — ' || coalesce(v_client, ''),
              'COMMDUE', 'إداري عام', 'reservations')
      returning id into v_entry;

      insert into public.journal_lines (entry_id, account_id, debit, credit)
      values (v_entry, v_recv, sc.company_amount, 0),
             (v_entry, v_rev,  0,                sc.company_amount);

      update public.reservations set commission_accrual_entry_id = v_entry where id = p_res;
    end if;
  end if;

  if sc.employee_id is not null and coalesce(sc.employee_amount, 0) > 0
     and sc.commission_id is null then
    select * into emp from public.employees where id = sc.employee_id;

    insert into public.commissions
      (employee_id, amount, comm_date, description, auto, payable_at)
    values (sc.employee_id, sc.employee_amount,
            (now() at time zone 'Asia/Baghdad')::date,
            'عمولة بيع — الوحدة ' || v_unit || ' — ' || coalesce(sc.employee_basis, ''),
            true, null)
    returning id into v_comm;

    update public.sale_commissions set commission_id = v_comm where id = sc.id;

    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'استُحقّت لك عمولة',
              public.fmt_qty(sc.employee_amount) || ' د.ع عن الوحدة ' || v_unit ||
              ' — تدخل كشف راتبك بعد أن تُحصّل الشركة عمولتها من المطوّر.',
              '/dashboard/me/salary', 'راتب', v_comm);
    end if;
  end if;
end;
$fn$;

-- ⚠️ sql/054 نزع المنح الافتراضية، والحذف أعلاه أسقط منح القديمة.
grant execute on function public.confirm_down_payment(uuid, numeric, numeric) to authenticated;

-- record_sale_commission تبقى **بلا منح** كما تركها sql/052:
-- تُنادى من المحفّز ومن confirm_down_payment، لا من المتصفّح.


-- ------------------------------------------------------------
-- 6) التحقّق — شغّله بعد الهجرة
--
--   select r.id, u.unit_code, u.price as unit_price, r.sale_price,
--          sc.deal_amount, sc.company_rate, sc.company_amount, sc.employee_amount
--     from public.reservations r
--     join public.units u on u.id = r.unit_id
--     left join public.sale_commissions sc on sc.reservation_id = r.id
--    where r.status = 'بيع مكتمل';
--
-- قبل تأكيد المقدمة: sale_price و sc فارغة — وهذا صحيح الآن.
-- بعد التأكيد بسعرٍ مُدخَل: تمتلئ الثلاثة، ويظهر قيد COMMDUE.
-- ------------------------------------------------------------
