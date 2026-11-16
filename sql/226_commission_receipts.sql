-- ============================================================
-- تلال ERP — 226: سند قبض لتحصيل العمولة، وإلغاؤه بقيد عكسي، ودفتر الصندوق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما المشكلة =====
--
-- «تسجيل التحصيل» في صفحة الوحدة كان يكتب قيده صحيحاً ومتوازناً
-- (مدين 1100 / دائن 1250 — COMMIN)، لكن:
--
--   ١) لا يظهر قبضاً في «الحركات المالية»: الشاشة تقرأ cash_moves
--      وحدها، والتحصيل يكتب في الدفتر مباشرة. فرصيد الصندوق يرتفع
--      ولا حركة تفسّره، ولا يُطابَق الصندوق بحركاته.
--   ٢) يذهب إلى الصندوق (1100) دائماً — لا خيار للبنك.
--   ٣) بلا سند: لا رقم قبض، ولا طريقة، ولا من قبض.
--   ٤) لا يُلغى: تحصيلٌ سُجّل خطأً، أو عمولةٌ رُدّت للمطوّر، لا طريق
--      له. و«فسخ البيع» يرفض ويطلب «حركة نقدية» لا تصنيف يقبلها (109).
--   ٥) بلا قفل: ضغطتان متزامنتان تكتبان قيدَي COMMIN. والأمر نفسه في
--      تأكيد المقدمة (COMMDUE) وصرف السلفة (ADVANCE).
--
-- ===== الحلّ =====
--
--   commission_receipts        سند قبض (RCV-0001) لكل تحصيل: المبلغ،
--                              الطريقة، التاريخ، قيده، وإلغاؤه إن أُلغي.
--                              سند سارٍ واحد لكل صفقة (فهرس فريد).
--   collect_company_commission تقفل الصفقة، وتختار 1100 أو 1200، وتكتب
--                              السند وقيده معاً، وتعيد معرّف السند.
--   cancel_commission_collection  للمدير: قيد عكسي COMMINREV (مدين 1250 /
--                              دائن النقد) مرتبط بالأصل (reversal_of)،
--                              والسند يُعلَّم ملغى ولا يُحذف. بعدها
--                              تُحصَّل الصفقة من جديد أو تُفسخ.
--   cash_book                  كل ما دخل الصندوق والبنك أو خرج منهما:
--                              الحركات اليدوية + القيود الآلية (تحصيل
--                              عمولة، دفعة راتب، سلفة، دين، مخزون، وسيط).
--                              مجموع أثرها = رصيد 1100 + 1200 دائماً.
--   أقفال                      for update في تأكيد المقدمة وصرف السلفة،
--                              وفهرس فريد يمنع قيدَين لمصدر واحد.
--   accounting_health          يعرف قيود السندات، ويكشف تحصيلاً بلا سند.
--
-- ===== ما لا يتغيّر =====
--
-- القيد نفسه (COMMIN، المصدر sale_commissions)، وعمود
-- reservations.commission_collect_entry_id (= قيد السند الساري)، وكل
-- تقرير يقرأ collected_at. والاستدعاء القديم بوسيطين يعمل (نقد).
--
-- يتطلب: 103، 108، 113، 114، 116، 120. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الجدول
-- ------------------------------------------------------------
create sequence if not exists public.commission_receipt_seq;

create table if not exists public.commission_receipts (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid() references auth.users(id) on delete set null,
  receipt_number       text not null unique
                       default ('RCV-' || lpad(nextval('public.commission_receipt_seq')::text, 4, '0')),
  -- restrict: الصفقة التي قُبض عنها لا تُحذف من تحت سندها
  reservation_id       uuid not null references public.reservations(id) on delete restrict,
  sale_commission_id   uuid not null references public.sale_commissions(id) on delete restrict,
  developer_invoice_id uuid references public.developer_invoices(id) on delete set null,
  amount               numeric not null check (amount > 0),
  method               text not null default 'نقد' check (method in ('نقد', 'بنك')),
  receipt_date         date not null,
  notes                text,
  journal_entry_id     uuid references public.journal_entries(id) on delete set null,
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users(id) on delete set null,
  cancel_reason        text,
  cancel_date          date,
  cancel_entry_id      uuid references public.journal_entries(id) on delete set null,
  constraint commission_receipts_cancel_complete
    check ((cancelled_at is null) = (cancel_reason is null)
       and (cancelled_at is null) = (cancel_date is null))
);

-- سند سارٍ واحد لكل صفقة — الحارس الأخير ضد التحصيل المكرّر
create unique index if not exists uq_commission_receipt_active
  on public.commission_receipts(reservation_id) where cancelled_at is null;
create index if not exists idx_commission_receipts_sale
  on public.commission_receipts(sale_commission_id);

comment on table public.commission_receipts is
  'سند قبض عمولة تلال من المطوّر (226). كل تحصيل سند بقيده (COMMIN)، وإلغاؤه قيد عكسي (COMMINREV) والسند يبقى. الكتابة بالدوالّ وحدها.';

alter table public.commission_receipts enable row level security;

drop policy if exists "finance reads commission_receipts" on public.commission_receipts;
create policy "finance reads commission_receipts"
  on public.commission_receipts for select to authenticated
  using ((select public.can_manage_finance()));

-- لا كتابة من المتصفّح إطلاقاً: السند يُكتب مع قيده أو لا يُكتب
revoke all on public.commission_receipts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.commission_receipts from authenticated;
grant select on public.commission_receipts to authenticated;

drop trigger if exists trg_audit_commission_receipts on public.commission_receipts;
create trigger trg_audit_commission_receipts
  after insert or update or delete on public.commission_receipts
  for each row execute function public.audit_row();


-- ------------------------------------------------------------
-- 2) سند لكل تحصيل سُجّل قبل اليوم — من قيده نفسه، بلا تغيير رقم
-- ------------------------------------------------------------
insert into public.commission_receipts
  (created_at, created_by, reservation_id, sale_commission_id, developer_invoice_id,
   amount, method, receipt_date, notes, journal_entry_id)
select e.created_at, e.created_by, r.id, sc.id,
       (select di.id from public.developer_invoices di
         where di.reservation_id = r.id and di.cancelled_at is null),
       sc.company_amount,
       case when exists (select 1 from public.journal_lines l
                          join public.accounts a on a.id = l.account_id
                         where l.entry_id = e.id and a.code = '1200' and l.debit > 0)
            then 'بنك' else 'نقد' end,
       sc.collected_at,
       'سندٌ أُنشئ لتحصيل سُجّل قبل العمل بالسندات (226)',
       e.id
  from public.sale_commissions sc
  join public.reservations r    on r.id = sc.reservation_id
  join public.journal_entries e on e.id = r.commission_collect_entry_id
 where sc.collected_at is not null
   and not exists (select 1 from public.commission_receipts cr
                    where cr.reservation_id = r.id and cr.cancelled_at is null)
 order by e.created_at;


-- ------------------------------------------------------------
-- 3) التحصيل: سند + قيد، نقداً أو بالبنك، مرّة واحدة
-- ------------------------------------------------------------
drop function if exists public.collect_company_commission(uuid, date);

create or replace function public.collect_company_commission(
  p_res    uuid,
  p_date   date default null,
  p_method text default 'نقد',
  p_notes  text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  r   public.reservations%rowtype;
  sc  public.sale_commissions%rowtype;
  inv public.developer_invoices%rowtype;
  emp public.employees%rowtype;
  v_method text := coalesce(nullif(btrim(p_method), ''), 'نقد');
  v_today  date := (now() at time zone 'Asia/Baghdad')::date;
  v_when   date;
  v_cash uuid; v_recv uuid; v_entry uuid; v_rcpt uuid;
  v_no text; v_unit text; v_n int;
begin
  if not public.can_manage_finance() then
    raise exception 'تسجيل تحصيل العمولة للمدير أو المحاسب';
  end if;
  if v_method not in ('نقد', 'بنك') then
    raise exception 'طريقة القبض: نقد أو بنك';
  end if;

  -- القفل: طلبان متزامنان على الصفقة نفسها يصطفّان، والثاني يرى «محصّلة سلفاً»
  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select * into sc from public.sale_commissions where reservation_id = p_res for update;
  if not found then raise exception 'لا سجلّ عمولة لهذه الصفقة'; end if;

  if sc.reversed_at is not null then
    raise exception 'صفقة مفسوخة — لا تُحصَّل عمولتها';
  end if;
  if r.down_payment_confirmed_at is null then
    raise exception 'أكّد المقدمة أولاً — العمولة لم تُستحقّ بعد';
  end if;
  if sc.collected_at is not null then
    raise exception 'عمولة هذه الصفقة محصّلة سلفاً في %', sc.collected_at::text;
  end if;
  if exists (select 1 from public.commission_receipts cr
              where cr.reservation_id = p_res and cr.cancelled_at is null) then
    raise exception 'لهذه الصفقة سند قبض سارٍ — لا تُحصَّل مرتين';
  end if;
  if coalesce(sc.company_amount, 0) <= 0 then
    raise exception 'لا مبلغ عمولة لتلال في هذه الصفقة';
  end if;

  select * into inv from public.developer_invoices
   where reservation_id = p_res and cancelled_at is null;
  if not found then
    raise exception 'أصدِر فاتورة العمولة للمطوّر أولاً — التحصيل يكون عليها';
  end if;

  v_when := coalesce(p_date, v_today);
  if v_when > v_today then
    raise exception 'تاريخ التحصيل (%) في المستقبل', v_when::text;
  end if;
  if v_when < (r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date then
    raise exception 'تاريخ التحصيل (%) قبل تأكيد المقدمة (%) — العمولة لم تكن مستحقّة',
      v_when::text, ((r.down_payment_confirmed_at at time zone 'Asia/Baghdad')::date)::text;
  end if;

  select id into v_cash from public.accounts
   where code = case when v_method = 'بنك' then '1200' else '1100' end and is_active;
  select id into v_recv from public.accounts where code = '1250' and is_active;
  if v_cash is null or v_recv is null then
    raise exception 'حساب النقد (1100/1200) أو 1250 غير موجود أو غير نشط';
  end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  insert into public.commission_receipts
    (reservation_id, sale_commission_id, developer_invoice_id, amount, method, receipt_date, notes)
  values (p_res, sc.id, inv.id, sc.company_amount, v_method, v_when, nullif(btrim(p_notes), ''))
  returning id, receipt_number into v_rcpt, v_no;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when,
          'تحصيل عمولة تلال من المطوّر — الوحدة ' || v_unit || ' — ' || inv.invoice_number
            || ' — سند ' || v_no,
          'COMMIN', 'إداري عام', 'sale_commissions')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit, line_note)
  values (v_entry, v_cash, sc.company_amount, 0, 'قبض ' || v_method || ' — سند ' || v_no),
         (v_entry, v_recv, 0, sc.company_amount, 'إسقاط ذمّة المطوّر — ' || inv.invoice_number);

  update public.commission_receipts set journal_entry_id = v_entry where id = v_rcpt;
  update public.sale_commissions set collected_at = v_when where id = sc.id;
  -- يختم القيد بمعرّف سجلّ العمولة ومشروعه (108، 116)
  update public.reservations set commission_collect_entry_id = v_entry where id = p_res;

  -- إرث ما قبل 120: عمولة موظف ما زالت تنتظر التحصيل
  if sc.commission_id is not null then
    update public.commissions set payable_at = v_when
     where id = sc.commission_id and payable_at is null;
    get diagnostics v_n = row_count;

    if v_n > 0 then
      perform public.attach_commission_to_draft(sc.commission_id);
      select e.* into emp from public.employees e where e.id = sc.employee_id;
      if emp.user_id is not null then
        insert into public.notifications (user_id, title, body, link, kind, entity_id)
        values (emp.user_id, 'عمولتك صارت مستحقّة الدفع',
                'حُصّلت عمولة الوحدة ' || v_unit || ' — تدخل كشف راتبك القادم.',
                '/dashboard/me/salary', 'راتب', sc.commission_id);
      end if;
    end if;
  end if;

  return v_rcpt;
end;
$fn$;

comment on function public.collect_company_commission(uuid, date, text, text) is
  'تحصيل عمولة تلال من المطوّر: سند قبض + قيد COMMIN (مدين 1100 نقداً أو 1200 بالبنك / دائن 1250). يقفل الصفقة، ويرفض التكرار، ويعيد معرّف السند (226).';

revoke execute on function public.collect_company_commission(uuid, date, text, text) from public, anon;
grant  execute on function public.collect_company_commission(uuid, date, text, text) to authenticated;


-- ------------------------------------------------------------
-- 4) إلغاء التحصيل: قيد عكسي، والسند والقيد الأصلي يبقيان
-- ------------------------------------------------------------
create or replace function public.cancel_commission_collection(
  p_res    uuid,
  p_reason text,
  p_date   date default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  r  public.reservations%rowtype;
  sc public.sale_commissions%rowtype;
  rc public.commission_receipts%rowtype;
  b  record;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_when  date;
  v_entry uuid; v_unit text;
  v_brk_back int := 0; v_brk_paid int := 0;
begin
  if not public.is_admin() then
    raise exception 'إلغاء التحصيل للمدير';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب إلغاء التحصيل';
  end if;

  select * into r from public.reservations where id = p_res for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select * into sc from public.sale_commissions where reservation_id = p_res for update;
  if not found then raise exception 'لا سجلّ عمولة لهذه الصفقة'; end if;
  if sc.collected_at is null then
    raise exception 'عمولة هذه الصفقة غير محصّلة — لا تحصيل يُلغى';
  end if;

  select * into rc from public.commission_receipts
   where reservation_id = p_res and cancelled_at is null for update;
  if not found or rc.journal_entry_id is null then
    raise exception 'لا سند قبض سارٍ بقيده لهذه الصفقة — راجع «صحّة المحاسبة»';
  end if;

  v_when := coalesce(p_date, v_today);
  if v_when > v_today then
    raise exception 'تاريخ الإلغاء (%) في المستقبل', v_when::text;
  end if;
  if v_when < rc.receipt_date then
    raise exception 'تاريخ الإلغاء (%) قبل تاريخ القبض (%)', v_when::text, rc.receipt_date::text;
  end if;

  select coalesce(u.unit_code, '') into v_unit from public.units u where u.id = r.unit_id;

  -- القيد العكسي: نفس الحسابات والمبالغ معكوسةً، مرتبطاً بالأصل.
  -- الفهرس الفريد على reversal_of يمنع عكس القيد نفسه مرتين.
  insert into public.journal_entries
    (entry_date, description, reference, arm, source, source_id, project_id, reversal_of)
  select v_when,
         'إلغاء تحصيل عمولة تلال — الوحدة ' || v_unit || ' — سند ' || rc.receipt_number
           || ' — ' || btrim(p_reason),
         'COMMINREV', e.arm, 'sale_commissions', sc.id, e.project_id, e.id
    from public.journal_entries e where e.id = rc.journal_entry_id
  returning id into v_entry;
  if v_entry is null then
    raise exception 'قيد التحصيل الأصلي غير موجود — راجع «صحّة المحاسبة»';
  end if;

  insert into public.journal_lines (entry_id, account_id, debit, credit, line_note)
  select v_entry, l.account_id, l.credit, l.debit, 'عكس سند ' || rc.receipt_number
    from public.journal_lines l where l.entry_id = rc.journal_entry_id;

  update public.commission_receipts
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason),
         cancel_date = v_when, cancel_entry_id = v_entry
   where id = rc.id;

  update public.sale_commissions set collected_at = null where id = sc.id;
  update public.reservations set commission_collect_entry_id = null where id = p_res;

  -- عمولة وسيط صارت قابلة للصرف بهذا التحصيل: تعود تنتظر — إلا ما صُرف منه شيء
  for b in
    select bc.id from public.broker_commissions bc
     where bc.reservation_id = p_res and bc.payable_rule = 'بعد تحصيل عمولة تلال'
       and bc.payable_at is not null and bc.reversed_at is null
     for update
  loop
    if public.broker_commission_net_paid(b.id) > 0 then
      v_brk_paid := v_brk_paid + 1;
    else
      update public.broker_commissions set payable_at = null where id = b.id;
      v_brk_back := v_brk_back + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'receipt', rc.receipt_number, 'amount', rc.amount, 'method', rc.method,
    'reversal_entry_id', v_entry, 'cancel_date', v_when,
    'broker_back_to_waiting', v_brk_back, 'broker_already_paid', v_brk_paid);
end;
$fn$;

comment on function public.cancel_commission_collection(uuid, text, date) is
  'إلغاء تحصيل عمولة تلال (للمدير): قيد عكسي COMMINREV مدين 1250 / دائن النقد مرتبط بالأصل، والسند يُعلَّم ملغى. بعده تُحصَّل الصفقة من جديد أو تُفسخ (226).';

revoke execute on function public.cancel_commission_collection(uuid, text, date) from public, anon;
grant  execute on function public.cancel_commission_collection(uuid, text, date) to authenticated;


-- ------------------------------------------------------------
-- 5) لا قيدَين لمصدر واحد — أقفال + فهرس فريد
--
-- تأكيد المقدمة وصرف السلفة يقرآن الصفّ بلا قفل ثم يكتبان القيد:
-- طلبان متزامنان يمرّان من الفحص معاً ويكتبان قيدَين. نُضيف
-- for update إلى سطر القراءة (ترقيع نصّي يتحقّق من مَرساه)، وفهرساً
-- فريداً يرفض القيد الثاني حتى لو فات القفل.
-- ------------------------------------------------------------
do $do$
declare
  v_def text; v_new text;
  v_fn  regprocedure;
  v_from text; v_to text;
begin
  -- confirm_down_payment
  v_fn  := 'public.confirm_down_payment(uuid,numeric,numeric)'::regprocedure;
  v_def := replace(pg_get_functiondef(v_fn), E'\r', '');
  v_from := 'select * into r from public.reservations where id = p_res;';
  v_to   := 'select * into r from public.reservations where id = p_res for update;';
  if position(v_to in v_def) = 0 then
    if position(v_from in v_def) = 0 then
      raise exception '226: مَرسى القفل غير موجود في confirm_down_payment';
    end if;
    execute replace(v_def, v_from, v_to);
  end if;

  -- disburse_advance
  v_fn  := 'public.disburse_advance(uuid,text,date)'::regprocedure;
  v_def := replace(pg_get_functiondef(v_fn), E'\r', '');
  v_from := 'select * into a from public.employee_advances where id = p_id;';
  v_to   := 'select * into a from public.employee_advances where id = p_id for update;';
  if position(v_to in v_def) = 0 then
    if position(v_from in v_def) = 0 then
      raise exception '226: مَرسى القفل غير موجود في disburse_advance';
    end if;
    execute replace(v_def, v_from, v_to);
  end if;

  -- reverse_sale: الرسالة كانت تطلب «حركة نقدية» لا تصنيف يقبلها — الطريق الآن إلغاء التحصيل
  v_fn  := 'public.reverse_sale(uuid,text)'::regprocedure;
  v_def := replace(pg_get_functiondef(v_fn), E'\r', '');
  if position('إلغاء التحصيل' in v_def) = 0 then
    v_new := regexp_replace(v_def, $p$% — [^']+قبل الفسخ'$p$,
      $r$% — ألغِ تحصيلها أولاً من صفحة الوحدة («إلغاء التحصيل» يقيّد ردّ المبلغ للمطوّر) ثم افسخ'$r$);
    if v_new = v_def then
      raise exception '226: مَرسى الرسالة غير موجود في reverse_sale';
    end if;
    execute v_new;
  end if;

  -- sale_reversal_preview: نفس الرسالة في المعاينة
  v_fn  := 'public.sale_reversal_preview(uuid)'::regprocedure;
  v_def := replace(pg_get_functiondef(v_fn), E'\r', '');
  if position('إلغاء التحصيل' in v_def) = 0 then
    v_new := regexp_replace(v_def, $p$' — [^']+قبل الفسخ'$p$,
      $r$' — ألغِ تحصيلها أولاً («إلغاء التحصيل» في صفحة الوحدة) ثم افسخ'$r$);
    if v_new = v_def then
      raise exception '226: مَرسى الرسالة غير موجود في sale_reversal_preview';
    end if;
    execute v_new;
  end if;
end
$do$;

-- قيد استحقاق واحد وقيد عكس واحد لكل حجز، وقيد صرف واحد لكل سلفة.
-- (COMMIN خارجه عمداً: الصفقة تُحصَّل من جديد بعد إلغاء تحصيلها،
--  ويحرسها uq_commission_receipt_active و journal_entries_reversal_once.)
create unique index if not exists uq_journal_single_posting
  on public.journal_entries (source, source_id, reference)
  where source_id is not null and reference in ('COMMDUE', 'COMMREV', 'ADVANCE');


-- ------------------------------------------------------------
-- 6) دفتر الصندوق: كل قبض وصرف، من أيّ مصدر
--
-- kind = 'move' حركة يدوية (cash_moves) تُعدَّل وتُحذف من شاشتها،
-- kind = 'auto' قيد آلي مسّ الصندوق أو البنك (أو دفعة راتب من جيب
-- شريك) يُدار من مصدره. cash_effect = أثر الصفّ على 1100 + 1200،
-- ومجموعه بلا فلتر = رصيد النقد في الدفتر.
-- ------------------------------------------------------------
create or replace function public.cash_book(
  p_dir     text default null,
  p_arm     text default null,
  p_project text default null,   -- معرّف مشروع، أو 'general' لما لا مشروع له
  p_q       text default null,
  p_limit   int  default 500
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_out  jsonb;
  v_dir  text := nullif(btrim(coalesce(p_dir, '')), '');
  v_arm  text := nullif(btrim(coalesce(p_arm, '')), '');
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
  v_general boolean := coalesce(p_project = 'general', false);
  v_proj uuid;
begin
  if not public.can_manage_finance() then
    raise exception 'الحركات المالية للمدير أو المحاسب';
  end if;
  if nullif(btrim(coalesce(p_project, '')), '') is not null and not v_general then
    v_proj := p_project::uuid;
  end if;

  with ent as (
    select e.id, e.entry_date, e.created_at, e.description, e.reference, e.source, e.source_id,
           e.arm, e.project_id,
           coalesce(sum(l.debit - l.credit) filter (where a.code = '1100'), 0) n_cash,
           coalesce(sum(l.debit - l.credit) filter (where a.code = '1200'), 0) n_bank,
           coalesce(sum(l.credit - l.debit) filter (where a.code = '2500'), 0) n_partner
      from public.journal_entries e
      join public.journal_lines l on l.entry_id = e.id
      join public.accounts a      on a.id = l.account_id
     group by e.id
  ),
  allrows as (
    select 'move'::text kind, m.id, m.journal_entry_id entry_id, m.move_date, m.created_at,
           m.direction, m.amount, m.category, m.account_code, m.arm, m.method, m.partner_id,
           m.description, m.notes, m.project_id, 'MOVE'::text reference, 'cash_moves'::text source,
           coalesce(en.n_cash + en.n_bank, 0) cash_effect,
           '/dashboard/accounting/entries/' || m.journal_entry_id link
      from public.cash_moves m
      left join ent en on en.id = m.journal_entry_id
    union all
    select 'auto', en.id, en.id, en.entry_date, en.created_at,
           case when en.n_cash + en.n_bank > 0 then 'قبض' else 'صرف' end,
           case when en.n_cash + en.n_bank <> 0 then abs(en.n_cash + en.n_bank) else en.n_partner end,
           case en.reference
             when 'COMMIN'      then 'تحصيل عمولة من المطوّر'
             when 'COMMINREV'   then 'إلغاء تحصيل عمولة'
             when 'PAYRUN'      then 'دفعة راتب'
             when 'ADVANCE'     then 'سلفة موظف'
             when 'DEBT'        then 'دين خارجي'
             when 'DEBTPAY'     then 'استحصال دين'
             when 'STOCK'       then 'شراء لوازم'
             when 'BRKPAY'      then 'دفعة لشركة وسيطة'
             when 'EXPENSE-PAY' then 'مصروف موظف'
             else case when en.source is null then 'قيد يدوي' else coalesce(en.reference, en.source) end
           end,
           null, coalesce(en.arm, 'إداري عام'),
           case when en.n_cash <> 0 and en.n_bank <> 0 then 'نقد وبنك'
                when en.n_bank <> 0 then 'بنك'
                when en.n_cash <> 0 then 'نقد' end,
           pp.partner_id, en.description, null, en.project_id, en.reference, en.source,
           en.n_cash + en.n_bank,
           case when en.source = 'sale_commissions' and sc.unit_id is not null
                  then '/dashboard/units/' || sc.unit_id
                when en.source = 'payroll_payments' and pp.payroll_id is not null
                  then '/dashboard/hr/payroll/' || pp.payroll_id
                else '/dashboard/accounting/entries/' || en.id end
      from ent en
      left join public.payroll_payments pp on en.source = 'payroll_payments' and pp.id = en.source_id
      left join public.sale_commissions sc on en.source = 'sale_commissions' and sc.id = en.source_id
     where en.source is distinct from 'cash_moves'
       and (en.n_cash + en.n_bank <> 0
            or (en.source = 'payroll_payments' and pp.partner_id is not null and en.n_partner > 0))
  ),
  f as (
    select * from allrows x
     where (v_dir is null or x.direction = v_dir)
       and (v_arm is null or x.arm = v_arm)
       and (not v_general or x.project_id is null)
       and (v_proj is null or x.project_id = v_proj)
       and (v_q is null or x.description ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'count',     (select count(*) from f),
    'total_in',  coalesce((select sum(f.amount) from f where f.direction = 'قبض'), 0),
    'total_out', coalesce((select sum(f.amount) from f where f.direction = 'صرف'), 0),
    'cash',      coalesce((select sum(ent.n_cash) from ent), 0),
    'bank',      coalesce((select sum(ent.n_bank) from ent), 0),
    'rows',      coalesce((
      select jsonb_agg(to_jsonb(t) order by t.move_date desc, t.created_at desc)
        from (select * from f order by f.move_date desc, f.created_at desc
               limit greatest(coalesce(p_limit, 500), 1)) t), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;

comment on function public.cash_book(text, text, text, text, int) is
  'دفتر الصندوق: الحركات اليدوية + كل قيد آلي مسّ 1100/1200 (تحصيل عمولة، دفعة راتب، سلفة، دين، مخزون، وسيط)، مع رصيدَي الصندوق والبنك. مجموع cash_effect بلا فلتر = رصيد النقد (226).';

revoke execute on function public.cash_book(text, text, text, text, int) from public, anon;
grant  execute on function public.cash_book(text, text, text, text, int) to authenticated;


-- ------------------------------------------------------------
-- 7) صحّة المحاسبة: قيود السندات ليست يتيمة، والتحصيل بلا سند يُكشف
--
-- ترقيع نصّي على التعريف الحيّ (114) — يتحقّق من كل مَرسى ويفشل
-- بصوت عالٍ إن لم يجده. يضيف:
--   • قيدَي السند (التحصيل وإلغاءه) وقيدَي مصروف الموظف إلى مراجع
--     JRN_ORPHAN — وإلا ظهر كل إلغاء تحصيل وكل مصروف موظف «قيداً بلا مصدر».
--   • SRC_NO_JOURNAL: مصروف موظف مدفوع بلا قيد دفع.
--   • RCPT_MISMATCH (حرج): تحصيل بلا سند سارٍ، أو سند لا يطابق قيده.
-- ------------------------------------------------------------
do $do$
declare
  v_def text; v_new text;
  v_a1 text := '    union all select commission_reversal_entry_id from public.reservations';
  v_a2 text := '       where sc.collected_at is not null and r.commission_collect_entry_id is null';
  v_a3 text := '  -- ===== متوسط =====';
begin
  v_def := replace(pg_get_functiondef('public.accounting_health()'::regprocedure), E'\r', '');
  if position('commission_receipts' in v_def) > 0 then
    return;  -- مُرقَّع سلفاً
  end if;
  if position(v_a1 in v_def) = 0 or position(v_a2 in v_def) = 0 or position(v_a3 in v_def) = 0 then
    raise exception '226: مَرسى غير موجود في accounting_health (% / % / %)',
      position(v_a1 in v_def) > 0, position(v_a2 in v_def) > 0, position(v_a3 in v_def) > 0;
  end if;

  v_new := replace(v_def, v_a1, v_a1 || $x$
    union all select journal_entry_id from public.commission_receipts
    union all select cancel_entry_id from public.commission_receipts
    union all select accrual_entry_id from public.employee_expenses
    union all select payment_entry_id from public.employee_expenses$x$);

  v_new := replace(v_new, v_a2, v_a2 || $x$
      union all
      select 'مصروف موظف مدفوع بلا قيد دفع', xe.description, xe.amount, 'employee_expenses', xe.id,
             xe.paid_at::date, '/dashboard/hr/expenses'
        from public.employee_expenses xe
       where xe.status = 'مدفوع' and xe.payment_entry_id is null$x$);

  v_new := replace(v_new, v_a3, $x$  return query
  select 'حرج', 1, 'RCPT_MISMATCH', 'تحصيل عمولة لا يطابق سند قبضه',
         y.d, y.amt, 'reservations', y.rid, y.dt, '/dashboard/units/' || y.uid
    from (
      select 'عمولة معلَّمة محصّلة ولا سند قبض سارٍ لها'::text d, sc.company_amount amt,
             r.id rid, sc.collected_at dt, r.unit_id uid
        from public.sale_commissions sc join public.reservations r on r.id = sc.reservation_id
       where sc.collected_at is not null
         and not exists (select 1 from public.commission_receipts cr
                          where cr.reservation_id = r.id and cr.cancelled_at is null)
      union all
      select 'سند القبض ' || cr.receipt_number || ' سارٍ وعمولته غير معلَّمة محصّلة', cr.amount,
             r.id, cr.receipt_date, r.unit_id
        from public.commission_receipts cr
        join public.reservations r on r.id = cr.reservation_id
        join public.sale_commissions sc on sc.id = cr.sale_commission_id
       where cr.cancelled_at is null and sc.collected_at is null
      union all
      select 'سند القبض ' || cr.receipt_number || ' لا يطابق قيده (القيد أو المبلغ)', cr.amount,
             r.id, cr.receipt_date, r.unit_id
        from public.commission_receipts cr
        join public.reservations r on r.id = cr.reservation_id
        join public.sale_commissions sc on sc.id = cr.sale_commission_id
       where cr.cancelled_at is null and sc.collected_at is not null
         and (cr.journal_entry_id is distinct from r.commission_collect_entry_id
              or cr.amount <> sc.company_amount
              or cr.amount <> coalesce((
                   select sum(l.debit - l.credit)
                     from public.journal_lines l join public.accounts a on a.id = l.account_id
                    where l.entry_id = cr.journal_entry_id and a.code in ('1100', '1200')), 0))
    ) y;

$x$ || v_a3);

  execute v_new;
end
$do$;

notify pgrst, 'reload schema';
