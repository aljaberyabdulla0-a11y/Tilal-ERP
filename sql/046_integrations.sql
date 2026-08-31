-- ============================================================
-- 046 — التكاملات: البيع ← الفاتورة ← العمولة، والمخزون والوسطاء
--     إلى دفاتر المحاسبة.
--
-- المبدأ: ما يحدث في وحدة يجب أن يظهر في الأخرى بلا إدخال ثانٍ.
-- بيعٌ يُنشئ فاتورة، وفاتورةٌ تُسدَّد تستحقّ عمولة، وشراء لوازم
-- يصير مصروفاً، ودفعة لوسيط تصير مصروفاً، وحجزٌ انتهت مهلته
-- ينبّه صاحبه.
--
-- ⚠️ يحتوي أيضاً تصحيحاً محاسبياً: العمولة كانت تُرحَّل دائنةً
-- على الصندوق فيُحتسب خروج النقد مرتين حين تُدفع مع الراتب.
-- الشرح كامل عند الدالة post_commission_to_ledger أدناه.
--
-- طُبّق على القاعدة في 2026-08-31 عبر أربع هجرات:
--   integrations_settings_and_accounts
--   integration_sale_invoice_commission
--   fix_commission_variable_shadowing
--   integrations_crm_inventory_brokers
--   integration_reservation_expiry_scan
-- ============================================================

-- ===== 1) الضوابط والحسابات =====
insert into public.accounts (code, name, type) values
  ('5350', 'لوازم مكتبية ومطبوعات', 'expense'),
  ('5510', 'عمولات الشركات الوسيطة', 'expense')
on conflict (code) do nothing;

alter table public.company_settings
  add column if not exists commission_rate         numeric not null default 0,
  add column if not exists auto_invoice_on_sale    boolean not null default true,
  add column if not exists auto_commission_on_paid boolean not null default true;

comment on column public.company_settings.commission_rate is
  'نسبة عمولة الموظف من قيمة الفاتورة (%). صفر = لا عمولة تلقائية.';

alter table public.employees
  add column if not exists commission_rate numeric;

comment on column public.employees.commission_rate is
  'نسبة عمولة خاصة بهذا الموظف. فارغ = يتبع نسبة الشركة.';

alter table public.commissions
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists auto boolean not null default false;

create unique index if not exists uq_commission_invoice
  on public.commissions(invoice_id) where invoice_id is not null;

alter table public.reservations
  add column if not exists expiry_notified_at timestamptz;

alter table public.inventory_moves
  add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;

alter table public.broker_payments
  add column if not exists journal_entry_id uuid
  references public.journal_entries(id) on delete set null;


-- ============================================================
-- 2) العمولة التزام لا نقدٌ خارج فوراً — تصحيح محاسبي
--
-- كانت العمولة تُرحَّل «مدين عمولات / دائن الصندوق»، ثم تدخل كشف
-- الراتب فيُدفع صافيه من الصندوق مرة أخرى — فيُحتسب خروج النقد
-- مرتين ويصير «رواتب مستحقة» مديناً بلا مقابل.
--
-- الصواب أن تُستحقّ كما يُستحقّ الراتب: «مدين عمولات / دائن رواتب
-- مستحقة»، فحين تُدفع مع الراتب يُقفل الالتزام ويخرج النقد مرة.
--
-- الخطأ كان محدوداً ما دامت العمولات تُدخل يدوياً، لكنّ الأتمتة
-- أدناه كانت ستحوّله إلى خطأ منهجي في كل صفقة.
-- ============================================================
create or replace function public.post_commission_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_expense uuid; v_due uuid; v_entry uuid; v_emp text;
begin
  select id into v_expense from public.accounts where code = '5500';
  select id into v_due     from public.accounts where code = '2300';
  if v_expense is null or v_due is null then return new; end if;

  select full_name into v_emp from public.employees where id = new.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(new.comm_date, current_date),
          'استحقاق عمولة: ' || coalesce(v_emp, '') || coalesce(' - ' || new.description, ''),
          'COMM', 'إداري عام', 'commissions')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_expense, new.amount, 0),
         (v_entry, v_due,     0,          new.amount);

  update public.commissions set journal_entry_id = v_entry where id = new.id;
  return new;
end; $$;

-- ============================================================
-- 3) البيع يُنشئ فاتورة للعميل
--
-- بسعر الوحدة كاملاً لا ناقصاً منه العربون: العربون دفعةٌ تُسجَّل
-- لا خصمٌ من الثمن، فطرحه كان سيخفي نقداً قُبض فعلاً.
-- ============================================================
create or replace function public.invoice_on_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record; u record; v_note text;
begin
  if new.status <> 'بيع مكتمل' then return null; end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not coalesce(s.auto_invoice_on_sale, true) then return null; end if;

  -- فاتورة واحدة لكل صفقة: إعادة حفظ الحجز لا تكرّرها
  if exists (select 1 from public.invoices i where i.reservation_id = new.id) then
    return null;
  end if;

  select * into u from public.units where id = new.unit_id;
  if u is null or coalesce(u.price, 0) <= 0 then
    return null;                      -- وحدة بلا سعر: لا فاتورة تُخترع
  end if;

  v_note := 'فاتورة آلية عند إتمام بيع الوحدة ' || coalesce(u.unit_code, '') ||
            case when u.node_path is not null then ' — ' || u.node_path else '' end ||
            case when coalesce(new.amount, 0) > 0
                 then '. عربون الحجز ' || public.fmt_qty(new.amount) ||
                      ' د.ع يُسجَّل دفعةً على هذه الفاتورة.' else '' end;

  insert into public.invoices (client_id, reservation_id, unit_id, total_amount, notes)
  values (new.client_id, new.id, new.unit_id, u.price, v_note);
  return null;
end; $$;

drop trigger if exists trg_invoice_on_sale on public.reservations;
create trigger trg_invoice_on_sale
  after insert or update of status on public.reservations
  for each row execute function public.invoice_on_sale();

-- ============================================================
-- 4) سداد الفاتورة يستحقّ عمولة الموظف المسؤول
--
-- المسؤول هو موظف الصفقة (agent_id) إن وُجد، وإلا الموظف المسنَد
-- إليه العميل. والنسبة نسبته الشخصية إن كانت له، وإلا نسبة الشركة.
--
-- تُحتسب عند **اكتمال السداد** لا عند إصدار الفاتورة: عمولة على
-- مبلغ لم يُقبض وعدٌ لا استحقاق.
--
-- ⚠️ كل المتغيّرات مسبوقة بـ v_ : متغيّر باسم amount كان يحجب
-- عمود payments.amount فيفشل الجمع بخطأ ambiguous.
-- ============================================================
create or replace function public.settle_invoice_commission(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv record; s record; v_paid numeric;
  emp public.employees%rowtype;
  v_rate numeric; v_amount numeric; existing record;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found then return; end if;

  select * into s from public.company_settings where id = 1;
  if s is null or not coalesce(s.auto_commission_on_paid, true) then return; end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p where p.invoice_id = p_invoice;

  select * into existing from public.commissions where invoice_id = p_invoice;

  -- لم تُسدَّد بعد: عمولة آلية سُجّلت ثم أُلغيت دفعة تُسحب، ما دامت
  -- لم تدخل كشف راتب. المضمّنة في كشف لا تُمسّ.
  if v_paid < inv.total_amount then
    if existing.id is not null and existing.auto and existing.payroll_id is null then
      delete from public.commissions where id = existing.id;
    end if;
    return;
  end if;

  if existing.id is not null then return; end if;

  if inv.reservation_id is not null then
    select e.* into emp from public.reservations r
    join public.employees e on e.id = r.agent_id where r.id = inv.reservation_id;
  end if;

  if emp.id is null then
    select e.* into emp from public.clients c
    join public.employees e
      on public.name_key(e.full_name) = public.name_key(c.sales_employee)
    where c.id = inv.client_id limit 1;
  end if;

  if emp.id is null or emp.status <> 'active' then return; end if;

  v_rate := coalesce(emp.commission_rate, s.commission_rate, 0);
  if v_rate <= 0 then return; end if;

  v_amount := round(inv.total_amount * v_rate / 100);
  if v_amount <= 0 then return; end if;

  insert into public.commissions (employee_id, amount, comm_date, description, invoice_id, auto)
  values (emp.id, v_amount, (now() at time zone 'Asia/Baghdad')::date,
          'عمولة ' || v_rate || '% على الفاتورة ' || inv.invoice_number, p_invoice, true);

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind)
    values (emp.user_id, 'استُحقّت لك عمولة',
            public.fmt_qty(v_amount) || ' د.ع عن الفاتورة ' || inv.invoice_number ||
              ' — تُضاف إلى كشف راتبك القادم.',
            '/dashboard/me/salary', 'راتب');
  end if;
end; $$;

create or replace function public.on_payment_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.settle_invoice_commission(
    case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end);
  return null;
end; $$;

drop trigger if exists trg_payment_commission on public.payments;
create trigger trg_payment_commission
  after insert or update or delete on public.payments
  for each row execute function public.on_payment_change();

-- تعديل مبلغ الفاتورة يغيّر شرط الاكتمال، فيُعاد الفحص
create or replace function public.on_invoice_total_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.settle_invoice_commission(new.id);
  return null;
end; $$;

drop trigger if exists trg_invoice_total_commission on public.invoices;
create trigger trg_invoice_total_commission
  after update of total_amount on public.invoices
  for each row execute function public.on_invoice_total_change();

-- ============================================================
-- 5) البيع يُغلق ملفّ العميل في المسار
--
-- كان العميل يبقى «زيارة» في الـ CRM بينما وحدته مباعة في المخزون،
-- فيُحتسب في المتابعات المفتوحة ويُطالَب الموظف بمتابعته.
-- ============================================================
create or replace function public.close_client_stage_on_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if new.status <> 'بيع مكتمل' then return null; end if;
  select stage into cur from public.clients where id = new.client_id;
  -- الملف المغلق لا يُعاد فتحه ولا تُغيَّر نتيجته
  if cur is null or not public.is_open_stage(cur) then return null; end if;
  update public.clients set stage = 'بيع' where id = new.client_id;
  return null;
end; $$;

drop trigger if exists trg_close_client_on_sale on public.reservations;
create trigger trg_close_client_on_sale
  after insert or update of status on public.reservations
  for each row execute function public.close_client_stage_on_sale();

-- ===== 6) الدفعة المحصّلة يعرفها صاحب الصفقة =====
create or replace function public.notify_payment_collected()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv record; emp public.employees%rowtype;
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if inv is null then return null; end if;

  if inv.reservation_id is not null then
    select e.* into emp from public.reservations r
    join public.employees e on e.id = r.agent_id where r.id = inv.reservation_id;
  end if;
  if emp.id is null then
    select e.* into emp from public.clients c
    join public.employees e
      on public.name_key(e.full_name) = public.name_key(c.sales_employee)
    where c.id = inv.client_id limit 1;
  end if;

  -- لا نُشعر من سجّل الدفعة بنفسه
  if emp.user_id is null or emp.user_id = auth.uid() then return null; end if;

  insert into public.notifications (user_id, title, body, link, kind)
  values (emp.user_id, 'دفعة على فاتورة ' || inv.invoice_number,
          'حُصّل ' || public.fmt_qty(new.amount) || ' د.ع من ' ||
            coalesce((select name from public.clients where id = inv.client_id), 'العميل') || '.',
          '/dashboard/invoices/' || inv.id, 'فاتورة');
  return null;
end; $$;

drop trigger if exists trg_notify_payment_collected on public.payments;
create trigger trg_notify_payment_collected
  after insert on public.payments
  for each row execute function public.notify_payment_collected();

-- ============================================================
-- 7) شراء لوازم المكتب مصروفٌ في الدفاتر
--
-- كان المخزون يسجّل الشراء ولا يعرف عنه دفتر الأستاذ شيئاً، فمالٌ
-- يخرج كل شهر ولا يظهر في قائمة الدخل.
-- ============================================================
create or replace function public.repost_inventory_purchase(p_move uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record; v_exp uuid; v_cash uuid; v_entry uuid; v_item text;
begin
  select * into m from public.inventory_moves where id = p_move;
  if not found then return; end if;

  if m.journal_entry_id is not null then
    delete from public.journal_entries where id = m.journal_entry_id;
    update public.inventory_moves set journal_entry_id = null where id = p_move;
  end if;

  if m.kind <> 'شراء' or coalesce(m.total_price, 0) <= 0 then return; end if;

  select id into v_exp  from public.accounts where code = '5350';
  select id into v_cash from public.accounts where code = '1100';
  if v_exp is null or v_cash is null then return; end if;

  select name into v_item from public.inventory_items where id = m.item_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(m.moved_at::date, current_date),
          'شراء لوازم: ' || coalesce(v_item, '') || ' × ' || public.fmt_qty(m.quantity),
          'STOCK', 'إداري عام', 'inventory_moves')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_exp,  m.total_price, 0),
         (v_entry, v_cash, 0,            m.total_price);

  update public.inventory_moves set journal_entry_id = v_entry where id = p_move;
end; $$;

create or replace function public.post_inventory_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      delete from public.journal_entries where id = old.journal_entry_id;
    end if;
    return old;
  end if;
  perform public.repost_inventory_purchase(new.id);
  return null;
end; $$;

drop trigger if exists trg_inventory_purchase_ledger on public.inventory_moves;
create trigger trg_inventory_purchase_ledger
  after insert or update of kind, quantity, unit_price, total_price, moved_at
  on public.inventory_moves
  for each row execute function public.post_inventory_purchase();

drop trigger if exists trg_inventory_purchase_unpost on public.inventory_moves;
create trigger trg_inventory_purchase_unpost
  before delete on public.inventory_moves
  for each row execute function public.post_inventory_purchase();

do $$ declare m record;
begin
  for m in select id from public.inventory_moves where kind = 'شراء' loop
    perform public.repost_inventory_purchase(m.id);
  end loop;
end; $$;

-- ===== 8) ما يُدفع للشركات الوسيطة مصروفٌ أيضاً =====
create or replace function public.repost_broker_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p record; v_exp uuid; v_cash uuid; v_entry uuid; v_co text;
begin
  select * into p from public.broker_payments where id = p_payment;
  if not found then return; end if;

  if p.journal_entry_id is not null then
    delete from public.journal_entries where id = p.journal_entry_id;
    update public.broker_payments set journal_entry_id = null where id = p_payment;
  end if;

  if coalesce(p.amount, 0) <= 0 then return; end if;

  select id into v_exp from public.accounts where code = '5510';
  select id into v_cash from public.accounts
    where code = case when p.method = 'بنك' then '1200' else '1100' end;
  if v_exp is null or v_cash is null then return; end if;

  select bc.name into v_co from public.broker_commissions c
  join public.broker_companies bc on bc.id = c.company_id where c.id = p.commission_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (coalesce(p.payment_date, current_date),
          'دفعة عمولة وسيط: ' || coalesce(v_co, ''), 'BRKPAY', 'إداري عام', 'broker_payments')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_exp,  p.amount, 0),
         (v_entry, v_cash, 0,        p.amount);

  update public.broker_payments set journal_entry_id = v_entry where id = p_payment;
end; $$;

create or replace function public.post_broker_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      delete from public.journal_entries where id = old.journal_entry_id;
    end if;
    return old;
  end if;
  perform public.repost_broker_payment(new.id);
  return null;
end; $$;

drop trigger if exists trg_broker_payment_ledger on public.broker_payments;
create trigger trg_broker_payment_ledger
  after insert or update of amount, method, payment_date on public.broker_payments
  for each row execute function public.post_broker_payment();

drop trigger if exists trg_broker_payment_unpost on public.broker_payments;
create trigger trg_broker_payment_unpost
  before delete on public.broker_payments
  for each row execute function public.post_broker_payment();

-- ============================================================
-- 9) الحجز الذي انتهت مهلته يُنبَّه عليه
--
-- المهلة كانت تُسجَّل ولا يقرؤها أحد، فتمرّ الأسابيع والوحدة
-- محجوزة لعميل لم يُكمل — تُحسب مشغولة وهي في الحقيقة متاحة.
--
-- لا يُلغى الحجز آلياً: القرار تجاري (يُمدَّد أو يُلغى)، والنظام
-- ينبّه ولا يقرّر. والتنبيه مرة واحدة لا كل يوم، وإلا صار ضجيجاً.
-- ============================================================
create or replace function public.scan_expired_reservations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  today date := (now() at time zone 'Asia/Baghdad')::date;
  n integer := 0;
begin
  for r in
    select res.id, res.unit_id, res.expiry_date, res.agent_id,
           u.unit_code, u.node_path, c.name as client_name, e.user_id as agent_user
    from public.reservations res
    join public.units u   on u.id = res.unit_id
    join public.clients c on c.id = res.client_id
    left join public.employees e on e.id = res.agent_id
    where res.status = 'حجز'
      and res.expiry_date is not null
      and res.expiry_date < today
      and res.expiry_notified_at is null
  loop
    -- صاحب الصفقة، وإن لم يكن له حساب فالمدراء
    if r.agent_user is not null then
      insert into public.notifications (user_id, title, body, link, kind)
      values (r.agent_user, 'انتهت مهلة حجز ' || coalesce(r.unit_code, ''),
              'حجز ' || r.client_name || ' على ' ||
                coalesce(r.node_path || ' / ', '') || coalesce(r.unit_code, '') ||
                ' انتهت مهلته في ' || r.expiry_date || '. مدّده أو ألغِه.',
              '/dashboard/units/' || r.unit_id, 'حجز');
    else
      insert into public.notifications (user_id, title, body, link, kind)
      select p.id, 'انتهت مهلة حجز ' || coalesce(r.unit_code, ''),
             'حجز ' || r.client_name || ' انتهت مهلته في ' || r.expiry_date ||
               ' ولا موظف مسؤول عنه.',
             '/dashboard/units/' || r.unit_id, 'حجز'
      from public.profiles p where p.role = 'admin';
    end if;

    update public.reservations set expiry_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- تمديد المهلة يُعيد فتح التنبيه: مهلة جديدة تستحقّ تنبيهاً جديداً
create or replace function public.reset_expiry_notice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.expiry_date is distinct from old.expiry_date then
    new.expiry_notified_at := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_reset_expiry_notice on public.reservations;
create trigger trg_reset_expiry_notice
  before update of expiry_date on public.reservations
  for each row execute function public.reset_expiry_notice();

select cron.unschedule('reservation-expiry-scan')
where exists (select 1 from cron.job where jobname = 'reservation-expiry-scan');

select cron.schedule('reservation-expiry-scan', '15 6 * * *',
  $cron$ select public.scan_expired_reservations(); $cron$);
