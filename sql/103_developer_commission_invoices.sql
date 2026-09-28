-- ============================================================
-- تلال ERP — 103: فاتورة العمولة للمطوّر — قبل التحصيل لا بعده
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- المطوّر لا يحوّل عمولة تلال على كلمة: يريد ورقةً بالوحدة وسعر
-- بيعها ونسبتنا والمبلغ. وكان المسار (sql/056) يقفز من «تأكيد
-- المقدمة» إلى «تسجيل التحصيل» بلا شيء بينهما.
--
-- صار ثلاث خطوات:
--   ١) تأكيد المقدمة        → تُستحقّ العمولة (مدين 1250 / دائن 4200)
--   ٢) فاتورة للمطوّر        → ورقة تُرسَل، **بلا قيد**
--   ٣) تسجيل التحصيل         → مدين 1100 / دائن 1250 — ويشترط الفاتورة
--
-- ===== لماذا جدولٌ منفصل لا invoices =====
--
-- invoices (sql/013) فواتير على **العميل** بثمن الوحدة — متابعةٌ لا
-- تمسّ دفاتر تلال (056). وهذه على **المطوّر** بعمولتنا، والمال فيها
-- مالُنا. خلطهما يجعل «المفوتر» في صفحة الوحدة يجمع ثمن الشقة مع
-- عمولتها، ويجعل مدفوعات invoices تكتب قيد 4100 على مالٍ ليس لنا.
--
-- ===== لماذا بلا قيد =====
--
-- الذمّة على المطوّر قُيّدت عند تأكيد المقدمة (1250). الفاتورة
-- مطالبةٌ بتلك الذمّة لا ذمّةٌ جديدة — قيدها يحتسب الإيراد مرتين.
--
-- ===== القواعد =====
--   • فاتورة سارية واحدة لكل صفقة (فهرس فريد جزئي).
--   • المبلغ منسوخ من sale_commissions.company_amount — المجمَّد منذ
--     التأكيد — فلا يختلف ما طُولب به عمّا يُقيَّد عند التحصيل.
--   • اسم المطوّر يُكتب عند الإصدار ويُحفظ على الفاتورة؛ والواجهة
--     تقترح آخر اسم استُعمل في المشروع نفسه.
--   • الإلغاء قبل التحصيل فقط. وفسخ البيع يلغيها تلقائياً (محفّز).
--   • الكتابة بالدوالّ وحدها؛ القراءة للمدير والمحاسب — كنطاق
--     sale_commissions نفسه.
--
-- يتطلب: 048، 056، 065، 068. آمن لإعادة التشغيل.
-- ============================================================

create sequence if not exists public.developer_invoice_seq;

create table if not exists public.developer_invoices (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  invoice_number      text not null unique
                      default ('DEV-' || lpad(nextval('public.developer_invoice_seq')::text, 4, '0')),
  reservation_id      uuid not null references public.reservations(id) on delete cascade,
  sale_commission_id  uuid not null references public.sale_commissions(id) on delete cascade,
  project_id          uuid references public.projects(id) on delete set null,
  unit_id             uuid references public.units(id) on delete set null,
  developer_name      text not null check (btrim(developer_name) <> ''),
  issue_date          date not null,
  due_date            date,
  sale_price          numeric not null,
  rate                numeric not null,
  amount              numeric not null check (amount > 0),
  notes               text,
  sent_at             timestamptz,
  sent_by             uuid references auth.users(id) on delete set null,
  cancelled_at        timestamptz,
  cancel_reason       text,
  constraint developer_invoices_due_after_issue
    check (due_date is null or due_date >= issue_date)
);

create unique index if not exists uq_developer_invoice_active
  on public.developer_invoices(reservation_id) where cancelled_at is null;
create index if not exists idx_developer_invoices_project
  on public.developer_invoices(project_id);

comment on table public.developer_invoices is
  'فاتورة عمولة تلال على المطوّر عن صفقة (103). مطالبةٌ بذمّة 1250 القائمة — بلا قيد. التحصيل يشترط فاتورةً سارية.';

alter table public.developer_invoices enable row level security;

drop policy if exists "finance reads developer_invoices" on public.developer_invoices;
create policy "finance reads developer_invoices"
  on public.developer_invoices for select to authenticated
  using ((select public.can_manage_finance()));

drop trigger if exists trg_audit_developer_invoices on public.developer_invoices;
create trigger trg_audit_developer_invoices
  after insert or update or delete on public.developer_invoices
  for each row execute function public.audit_row();


-- ------------------------------------------------------------
-- 1) إصدار الفاتورة
-- ------------------------------------------------------------
create or replace function public.issue_developer_invoice(
  p_res        uuid,
  p_developer  text,
  p_issue_date date default null,
  p_due_date   date default null,
  p_notes      text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  r    public.reservations%rowtype;
  sc   public.sale_commissions%rowtype;
  v_id uuid;
  v_issue date;
begin
  if not public.can_manage_finance() then
    raise exception 'إصدار فاتورة المطوّر للمدير أو المحاسب';
  end if;
  if nullif(btrim(coalesce(p_developer, '')), '') is null then
    raise exception 'اكتب اسم المطوّر';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if r.status <> 'بيع مكتمل' then
    raise exception 'لا فاتورة إلا لبيع مكتمل (الحالة: %)', r.status;
  end if;
  if r.down_payment_confirmed_at is null then
    raise exception 'أكّد المقدمة أولاً — العمولة لم تُستحقّ بعد';
  end if;

  select * into sc from public.sale_commissions where reservation_id = p_res;
  if not found then raise exception 'لا سجلّ عمولة لهذه الصفقة'; end if;
  if sc.reversed_at is not null then
    raise exception 'هذه الصفقة مفسوخة';
  end if;
  if sc.collected_at is not null then
    raise exception 'عمولة هذه الصفقة محصّلة سلفاً في %', sc.collected_at::text;
  end if;
  if coalesce(sc.company_amount, 0) <= 0 then
    raise exception 'لا مبلغ عمولة لتلال في هذه الصفقة';
  end if;

  if exists (select 1 from public.developer_invoices
              where reservation_id = p_res and cancelled_at is null) then
    raise exception 'لهذه الصفقة فاتورةٌ سارية — ألغِها أولاً إن أردت غيرها';
  end if;

  v_issue := coalesce(p_issue_date, (now() at time zone 'Asia/Baghdad')::date);
  if p_due_date is not null and p_due_date < v_issue then
    raise exception 'تاريخ الاستحقاق قبل تاريخ الإصدار';
  end if;

  insert into public.developer_invoices
    (reservation_id, sale_commission_id, project_id, unit_id, developer_name,
     issue_date, due_date, sale_price, rate, amount, notes)
  values
    (p_res, sc.id, sc.project_id, coalesce(sc.unit_id, r.unit_id), btrim(p_developer),
     v_issue, p_due_date, sc.deal_amount, sc.company_rate, sc.company_amount,
     nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 2) أُرسلت للمطوّر — تاريخٌ للمتابعة لا أكثر
-- ------------------------------------------------------------
create or replace function public.mark_developer_invoice_sent(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare inv public.developer_invoices%rowtype;
begin
  if not public.can_manage_finance() then
    raise exception 'فواتير المطوّر للمدير أو المحاسب';
  end if;
  select * into inv from public.developer_invoices where id = p_id;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.cancelled_at is not null then raise exception 'الفاتورة ملغاة'; end if;

  update public.developer_invoices
     set sent_at = now(), sent_by = auth.uid()
   where id = p_id and sent_at is null;
end;
$fn$;


-- ------------------------------------------------------------
-- 3) الإلغاء — قبل التحصيل فقط
-- ------------------------------------------------------------
create or replace function public.cancel_developer_invoice(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  inv public.developer_invoices%rowtype;
  v_collected date;
begin
  if not public.can_manage_finance() then
    raise exception 'فواتير المطوّر للمدير أو المحاسب';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب الإلغاء';
  end if;

  select * into inv from public.developer_invoices where id = p_id;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.cancelled_at is not null then raise exception 'الفاتورة ملغاة سلفاً'; end if;

  select collected_at into v_collected
    from public.sale_commissions where id = inv.sale_commission_id;
  if v_collected is not null then
    raise exception 'حُصّلت هذه الفاتورة في % — لا تُلغى', v_collected::text;
  end if;

  update public.developer_invoices
     set cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 4) فسخ البيع يلغي فاتورته
--
-- محفّزٌ لا تعديلٌ في reverse_sale: الدالّة طويلة وحسّاسة (065)،
-- وكل ما تحتاجه هنا أنّ reversed_at امتلأ.
-- ------------------------------------------------------------
create or replace function public.cancel_developer_invoice_on_reversal()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  update public.developer_invoices
     set cancelled_at = now(),
         cancel_reason = 'فسخ البيع' ||
           coalesce(' — ' || nullif(btrim(new.reversal_reason), ''), '')
   where sale_commission_id = new.id and cancelled_at is null;
  return new;
end;
$fn$;

drop trigger if exists trg_cancel_developer_invoice_on_reversal on public.sale_commissions;
create trigger trg_cancel_developer_invoice_on_reversal
  after update of reversed_at on public.sale_commissions
  for each row
  when (old.reversed_at is null and new.reversed_at is not null)
  execute function public.cancel_developer_invoice_on_reversal();


-- ------------------------------------------------------------
-- 5) التحصيل يشترط فاتورةً سارية
--
-- التعريف الحيّ نفسه (056 مرقّعاً بحارس 068) مع إضافتين:
--   • لا تحصيل بلا فاتورة سارية.
--   • رقم الفاتورة في وصف القيد — فيُعرف من دفتر اليومية أيّ
--     مطالبةٍ سدّها هذا المبلغ.
-- ------------------------------------------------------------
create or replace function public.collect_company_commission(
  p_res  uuid,
  p_date date default null
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  r public.reservations%rowtype; sc public.sale_commissions%rowtype;
  v_cash uuid; v_recv uuid; v_entry uuid; v_unit text; v_when date; emp public.employees%rowtype;
  v_inv text;
begin
  if not public.can_manage_finance() then
    raise exception 'تسجيل تحصيل العمولة للمدير أو المحاسب';
  end if;

  select * into r from public.reservations where id = p_res;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select * into sc from public.sale_commissions where reservation_id = p_res;
  if not found then raise exception 'لا سجلّ عمولة لهذه الصفقة'; end if;

  if r.down_payment_confirmed_at is null then
    raise exception 'أكّد المقدمة أولاً — العمولة لم تُستحقّ بعد';
  end if;
  if sc.collected_at is not null then
    raise exception 'عمولة هذه الصفقة محصّلة سلفاً في %', sc.collected_at::text;
  end if;
  if coalesce(sc.company_amount, 0) <= 0 then
    raise exception 'لا مبلغ عمولة لتلال في هذه الصفقة';
  end if;

  select invoice_number into v_inv
    from public.developer_invoices
   where reservation_id = p_res and cancelled_at is null;
  if v_inv is null then
    raise exception 'أصدِر فاتورة العمولة للمطوّر أولاً — التحصيل يكون عليها';
  end if;

  v_when := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);
  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  select id into v_cash from public.accounts where code = '1100';
  select id into v_recv from public.accounts where code = '1250';
  if v_cash is null or v_recv is null then
    raise exception 'حساب 1100 أو 1250 غير موجود';
  end if;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when, 'تحصيل عمولة تلال من المطوّر — الوحدة ' || v_unit || ' — ' || v_inv,
          'COMMIN', 'إداري عام', 'sale_commissions')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_cash, sc.company_amount, 0),
         (v_entry, v_recv, 0,                sc.company_amount);

  update public.sale_commissions set collected_at = v_when where id = sc.id;
  update public.reservations set commission_collect_entry_id = v_entry where id = p_res;

  if sc.commission_id is not null then
    update public.commissions set payable_at = v_when
     where id = sc.commission_id and payable_at is null;

    select e.* into emp from public.employees e where e.id = sc.employee_id;
    if emp.user_id is not null then
      insert into public.notifications (user_id, title, body, link, kind, entity_id)
      values (emp.user_id, 'عمولتك صارت مستحقّة الدفع',
              'حُصّلت عمولة الوحدة ' || v_unit || ' — تدخل كشف راتبك القادم.',
              '/dashboard/me/salary', 'راتب', sc.commission_id);
    end if;
  end if;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) الصلاحيات — منذ 054 تخرج كل دالّة جديدة بلا منحة
-- ------------------------------------------------------------
revoke execute on function public.issue_developer_invoice(uuid, text, date, date, text) from public, anon;
revoke execute on function public.mark_developer_invoice_sent(uuid)                    from public, anon;
revoke execute on function public.cancel_developer_invoice(uuid, text)                 from public, anon;
revoke execute on function public.cancel_developer_invoice_on_reversal()               from public, anon, authenticated;

grant execute on function public.issue_developer_invoice(uuid, text, date, date, text) to authenticated;
grant execute on function public.mark_developer_invoice_sent(uuid)                    to authenticated;
grant execute on function public.cancel_developer_invoice(uuid, text)                 to authenticated;

notify pgrst, 'reload schema';
