-- ============================================================
-- تلال ERP — 122: التسويق ٢ — الميزانيات والمصروفات والمشتريات والمواد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المبدأ =====
--
--     التسويق يطلب، والمالية تدفع، والدفتر يكتبه محفّزه القائم.
--
-- المصروف التسويقي وثيقةٌ لا قيد:
--
--   مسودة ──اطلب الموافقة──► بانتظار الموافقة ──mkt_decide_approval──► معتمد
--                                                                       │
--                       mkt_pay_expense (المالية وحدها)                ▼
--   cash_moves (صرف، «تسويق وإعلان»، 5700، المشروع) ──► post_cash_move_to_ledger
--                                                        (5700 / 1100|1200|2500)
--
-- فلا مسار ترحيل ثانٍ، ولا قيد من المتصفّح، ولا حساب جديد. وحارس 109
-- وقفل الفترة (063) يسريان على الحركة كما يسريان على أي حركة.
--
-- والإلغاء بعد الدفع **حركة معاكسة** (قبض على 5700) لا حذف: المال
-- خرج فعلاً، واسترداده حدثٌ ثانٍ بتاريخه.
--
-- ===== ما يُحسب لا يُكتب =====
--
--   crm_campaigns.spent  = مجموع المدفوع على الحملة — حين يوجد مصروف
--                          مسجّل. ويبقى يدوياً لحملةٍ لا مصروف لها.
--   مصروف الميزانية      = المدفوع في فترتها ونطاقها (mkt_budget_status)
--   الملتزَم به           = المعتمد غير المدفوع
--
-- ===== المطبوعات والمواد =====
--
-- طلب شراء (موافقة) ← المخزون يسجّل الشراء بمساره القائم (5350) ←
-- التسويق يصرف للحملة أو النشاط (mkt_issue_material) فتُحسب كلفة
-- المواد على الحملة بسعر شرائها. الصرف لا يُرحَّل (كما كان) — الشراء
-- رُحِّل عند دخوله، فالترحيل مرّتين يضاعف المصروف.
--
-- يتطلب: 121، 018، 109، 116، 040 (المخزون). آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الميزانيات
-- ------------------------------------------------------------
create table if not exists public.mkt_budgets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  period_type  text not null check (period_type in ('سنوي', 'ربعي', 'شهري')),
  period_start date not null,
  period_end   date not null,
  scope        text not null check (scope in ('شركة', 'مشروع', 'حملة', 'قناة', 'نشاط')),
  project_id   uuid references public.projects(id) on delete cascade,
  campaign_id  uuid references public.crm_campaigns(id) on delete cascade,
  channel_id   uuid references public.mkt_channels(id) on delete cascade,
  activity_id  uuid references public.mkt_activities(id) on delete cascade,
  parent_id    uuid references public.mkt_budgets(id) on delete set null,
  planned      numeric not null check (planned >= 0),
  approved     numeric check (approved is null or approved >= 0),
  forecast     numeric check (forecast is null or forecast >= 0),
  status       text not null default 'مسودة'
               check (status in ('مسودة', 'بانتظار الموافقة', 'معتمدة', 'مغلقة')),
  notes        text,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint mkt_budgets_scope check (
    (scope = 'شركة'  and project_id is null and campaign_id is null and channel_id is null and activity_id is null) or
    (scope = 'مشروع' and project_id  is not null) or
    (scope = 'حملة'  and campaign_id is not null) or
    (scope = 'قناة'  and channel_id  is not null) or
    (scope = 'نشاط'  and activity_id is not null)),
  constraint mkt_budgets_aligned check (
    extract(day from period_start) = 1 and
    (period_type <> 'ربعي' or extract(month from period_start) in (1, 4, 7, 10)) and
    (period_type <> 'سنوي' or extract(month from period_start) = 1))
);

-- ميزانية واحدة لكل (فترة × نطاق) — والميزانية المكرّرة تُضاعف «المتبقّي»
create unique index if not exists mkt_budgets_one_per_scope on public.mkt_budgets (
  period_type, period_start, scope,
  coalesce(project_id,  '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(activity_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists mkt_budgets_period_idx on public.mkt_budgets (period_start, period_end);

create or replace function public.mkt_guard_budget()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
begin
  new.period_end := (new.period_start + case new.period_type
                       when 'سنوي' then interval '1 year'
                       when 'ربعي' then interval '3 months'
                       else interval '1 month' end - interval '1 day')::date;

  if tg_op = 'INSERT' then
    if new.status <> 'مسودة' and not public.is_admin() then
      new.status := 'مسودة';
    end if;
    if new.status = 'مسودة' then new.approved := null; end if;
  else
    if new.status is distinct from old.status and not v_flag then
      if new.status in ('بانتظار الموافقة', 'معتمدة') or old.status = 'بانتظار الموافقة' then
        if not (new.status = 'معتمدة' and public.is_admin()) then
          raise exception 'اعتماد الميزانية بطلب موافقة — يعتمدها المدير';
        end if;
      end if;
    end if;
    if new.status = 'معتمدة' and old.status = 'معتمدة'
       and (new.planned, new.approved) is distinct from (old.planned, old.approved)
       and not public.is_admin() then
      raise exception 'الميزانية معتمدة — تعديل أرقامها للمدير (ويُسجَّل في التدقيق)';
    end if;
    if new.status = 'معتمدة' and new.approved is null then
      new.approved := new.planned;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_budget on public.mkt_budgets;
create trigger trg_mkt_guard_budget
  before insert or update on public.mkt_budgets
  for each row execute function public.mkt_guard_budget();


-- ------------------------------------------------------------
-- 2) المصروفات
-- ------------------------------------------------------------
create sequence if not exists public.mkt_expense_code_seq;

create table if not exists public.mkt_expenses (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique
                     default ('MEX-' || lpad(nextval('public.mkt_expense_code_seq')::text, 4, '0')),
  expense_date       date not null default ((now() at time zone 'Asia/Baghdad')::date),
  category           text not null check (category in (
                       'إعلانات ميتا', 'إعلانات جوجل', 'إعلانات تيك توك', 'إعلانات سناب شات',
                       'إعلانات أخرى', 'مؤثرون', 'طباعة', 'لوحات إعلانية', 'فعاليات ومعارض',
                       'أجنحة', 'وكالات', 'إنتاج', 'تصوير', 'فيديو', 'برمجيات واشتراكات',
                       'استضافة', 'عروض ترويجية', 'هدايا ترويجية', 'نقل', 'إعلام تقليدي', 'أخرى')),
  description        text not null,
  amount             numeric not null check (amount > 0),
  currency           text not null default 'IQD' check (currency in ('IQD', 'USD')),
  fx_rate            numeric not null default 1 check (fx_rate > 0),
  amount_iqd         numeric generated always as (round(amount * fx_rate)) stored,
  project_id         uuid references public.projects(id) on delete set null,
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  channel_id         uuid references public.mkt_channels(id) on delete set null,
  activity_id        uuid references public.mkt_activities(id) on delete set null,
  influencer_deal_id uuid references public.mkt_influencer_deals(id) on delete set null,
  vendor_id          uuid references public.suppliers(id) on delete set null,
  employee_id        uuid references public.employees(id) on delete set null,
  invoice_ref        text,
  invoice_asset_id   uuid references public.mkt_assets(id) on delete set null,
  status             text not null default 'مسودة' check (status in (
                       'مسودة', 'بانتظار الموافقة', 'معتمد', 'مدفوع', 'مرفوض', 'ملغى')),
  approved_by        uuid references auth.users(id) on delete set null,
  approved_at        timestamptz,
  paid_at            date,
  payment_method     text check (payment_method in ('نقد', 'بنك')),
  partner_id         uuid references public.partners(id) on delete set null,
  arm                text check (arm in ('التسويق', 'العقارات', 'إداري عام')),
  cash_move_id       uuid unique references public.cash_moves(id) on delete set null,
  void_cash_move_id  uuid unique references public.cash_moves(id) on delete set null,
  void_reason        text,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint mkt_expenses_fx check (currency <> 'IQD' or fx_rate = 1),
  constraint mkt_expenses_paid check ((status = 'مدفوع') = (cash_move_id is not null) or status = 'ملغى')
);
create index if not exists mkt_expenses_campaign_idx on public.mkt_expenses (campaign_id, status);
create index if not exists mkt_expenses_project_idx  on public.mkt_expenses (project_id, status);
create index if not exists mkt_expenses_channel_idx  on public.mkt_expenses (channel_id);
create index if not exists mkt_expenses_vendor_idx   on public.mkt_expenses (vendor_id);
create index if not exists mkt_expenses_date_idx     on public.mkt_expenses (expense_date, status);

comment on table public.mkt_expenses is
  'وثيقة مصروف تسويقي. لا تُرحَّل بنفسها: «دفع» المالية يُدخل cash_moves (5700) ومحفّزه يكتب القيد. المرجع المحاسبي = cash_move_id → journal_entry_id.';
comment on column public.mkt_expenses.amount_iqd is
  'المبلغ بالدينار. هو ما يُدفع (cash_moves بالدينار) وما تُحسب منه كل مقاييس الكلفة.';

create or replace function public.mkt_guard_expense()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_appr boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on';
  v_pay  boolean := coalesce(current_setting('tilal.mkt_pay', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status not in ('مسودة', 'مرفوض') then
      raise exception 'المصروف % — لا يُحذف، يُلغى فيبقى أثره', old.status;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if (new.status <> 'مسودة' or new.cash_move_id is not null) and not v_pay then
      raise exception 'المصروف يبدأ مسودة، ويُعتمد بطلب موافقة، وتدفعه المالية';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.cash_move_id is distinct from old.cash_move_id
     or new.void_cash_move_id is distinct from old.void_cash_move_id then
    if not v_pay then raise exception 'ربط المصروف بحركته المالية من الدالّة وحدها'; end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'مدفوع' and not v_pay then
      raise exception 'الدفع من «ادفع» في المالية — هو الذي يكتب الحركة والقيد';
    elsif new.status in ('بانتظار الموافقة', 'معتمد', 'مرفوض') and not v_appr then
      raise exception 'الاعتماد والرفض بطلب موافقة';
    elsif old.status = 'بانتظار الموافقة' and not v_appr then
      raise exception 'المصروف بانتظار الموافقة — اسحب الطلب أو انتظر القرار';
    elsif new.status = 'ملغى' and old.status in ('معتمد', 'مدفوع') and not v_pay then
      raise exception 'إلغاء المصروف المعتمد أو المدفوع من «ألغِ» — لتُكتب حركته المعاكسة';
    elsif old.status in ('مدفوع', 'ملغى') and not v_pay then
      raise exception 'المصروف % — لا تتغيّر حالته', old.status;
    end if;
  end if;

  if (new.amount, new.currency, new.fx_rate) is distinct from (old.amount, old.currency, old.fx_rate) then
    if old.status in ('مدفوع', 'ملغى') then
      raise exception 'المصروف % — لا يُعدَّل مبلغه. ألغِه وسجّل غيره', old.status;
    elsif old.status = 'بانتظار الموافقة' then
      raise exception 'المصروف بانتظار الموافقة — اسحب الطلب قبل تعديل المبلغ';
    elsif old.status = 'معتمد' then
      -- ما اعتُمد ليس هذا الرقم: يعود مسودة ويُطلب اعتماده من جديد
      new.status := 'مسودة'; new.approved_at := null; new.approved_by := null;
    end if;
  end if;

  if old.status = 'مدفوع' and (new.expense_date is distinct from old.expense_date
                               or new.partner_id is distinct from old.partner_id
                               or new.payment_method is distinct from old.payment_method) then
    raise exception 'المصروف مدفوع — تاريخه وطريقة دفعه من حركته المالية';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_expense on public.mkt_expenses;
create trigger trg_mkt_guard_expense
  before insert or update or delete on public.mkt_expenses
  for each row execute function public.mkt_guard_expense();

-- مشروع المصروف المدفوع يتبعه مشروع حركته — فيتبعه قيدها (116)
create or replace function public.mkt_sync_expense_effects()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare c uuid;
begin
  if tg_op = 'UPDATE' and new.cash_move_id is not null
     and new.project_id is distinct from old.project_id then
    update public.cash_moves set project_id = new.project_id where id = new.cash_move_id;
  end if;

  -- مصروف الحملة = المدفوع عليها، حين يوجد مدفوع
  for c in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.campaign_id end,
      case when tg_op <> 'DELETE' then new.campaign_id end]) x
     where x is not null
  loop
    perform set_config('tilal.mkt_spent_sync', 'on', true);
    update public.crm_campaigns cp
       set spent = (select coalesce(sum(e.amount_iqd), 0) from public.mkt_expenses e
                     where e.campaign_id = c and e.status = 'مدفوع')
     where cp.id = c
       and exists (select 1 from public.mkt_expenses e
                    where e.campaign_id = c and (e.status = 'مدفوع' or e.status = 'ملغى' and e.cash_move_id is not null));
    perform set_config('tilal.mkt_spent_sync', 'off', true);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_mkt_sync_expense on public.mkt_expenses;
create trigger trg_mkt_sync_expense
  after insert or update or delete on public.mkt_expenses
  for each row execute function public.mkt_sync_expense_effects();

-- المصروف اليدوي على الحملة يُرفض حين صار محسوباً
create or replace function public.mkt_guard_campaign_spent()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.spent is distinct from old.spent
     and coalesce(current_setting('tilal.mkt_spent_sync', true), '') <> 'on'
     and exists (select 1 from public.mkt_expenses e
                  where e.campaign_id = new.id and e.status = 'مدفوع') then
    raise exception 'مصروف الحملة يُحسب من مصروفاتها المدفوعة — سجّل مصروفاً لا رقماً';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_campaign_spent on public.crm_campaigns;
create trigger trg_mkt_guard_campaign_spent
  before update of spent on public.crm_campaigns
  for each row execute function public.mkt_guard_campaign_spent();

-- حركةٌ حُذفت من المحاسبة لا تترك مصروفاً «مدفوعاً» بلا حركة
create or replace function public.mkt_on_cash_move_deleted()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.mkt_expenses where cash_move_id = old.id) then
    perform set_config('tilal.mkt_pay', 'on', true);
    update public.mkt_expenses
       set status = 'ملغى', cash_move_id = null,
           void_reason = coalesce(void_reason, 'حُذفت حركته من المحاسبة')
     where cash_move_id = old.id;
    perform set_config('tilal.mkt_pay', 'off', true);
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_mkt_cash_move_deleted on public.cash_moves;
create trigger trg_mkt_cash_move_deleted
  before delete on public.cash_moves
  for each row execute function public.mkt_on_cash_move_deleted();

revoke all on function public.mkt_on_cash_move_deleted() from public, anon, authenticated;


-- ===== الدفع: المالية وحدها، والقيد يكتبه محفّز cash_moves =====
create or replace function public.mkt_pay_expense(
  p_id uuid, p_method text default 'نقد', p_partner uuid default null,
  p_arm text default 'التسويق', p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare e public.mkt_expenses%rowtype; v_cm uuid; v_vendor text; v_date date;
begin
  if not public.can_manage_finance() then
    raise exception 'دفع المصروف للمدير أو المحاسب';
  end if;
  select * into e from public.mkt_expenses where id = p_id for update;
  if not found then raise exception 'المصروف غير موجود'; end if;
  if e.status <> 'معتمد' then
    raise exception 'لا يُدفع إلا المعتمد (الحالة الآن: %)', e.status;
  end if;
  if p_method not in ('نقد', 'بنك') then raise exception 'طريقة الدفع: نقد أو بنك'; end if;
  if p_arm not in ('التسويق', 'العقارات', 'إداري عام') then raise exception 'الذراع غير معروف'; end if;

  v_date := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);
  select name into v_vendor from public.suppliers where id = e.vendor_id;

  insert into public.cash_moves
    (move_date, direction, amount, category, account_code, arm, method, partner_id,
     description, notes, project_id, created_by)
  values (v_date, 'صرف', e.amount_iqd, 'تسويق وإعلان', '5700', p_arm, p_method, p_partner,
          'تسويق — ' || e.code || ' — ' || e.description || coalesce(' — ' || v_vendor, ''),
          e.category || case when e.currency <> 'IQD'
                             then ' · ' || e.amount || ' ' || e.currency || ' × ' || e.fx_rate else '' end,
          e.project_id, auth.uid())
  returning id into v_cm;

  perform set_config('tilal.mkt_pay', 'on', true);
  update public.mkt_expenses
     set status = 'مدفوع', cash_move_id = v_cm, paid_at = v_date,
         payment_method = p_method, partner_id = p_partner, arm = p_arm
   where id = p_id;
  perform set_config('tilal.mkt_pay', 'off', true);

  if e.created_by is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
    values (e.created_by, 'دُفع مصروف تسويق', e.code || ' — ' || public.fmt_qty(e.amount_iqd) || ' د.ع',
            '/dashboard/marketing/expenses', 'تسويق', e.id, 'عادية', 'تسويق', 'marketing');
  end if;
  return v_cm;
end;
$fn$;

-- ربط حركة 5700 سُجّلت في المحاسبة قبل القسم — تُنسب ولا تُرحَّل مرّة ثانية
create or replace function public.mkt_link_cash_move(
  p_cash_move uuid, p_category text, p_campaign uuid default null, p_channel uuid default null,
  p_activity uuid default null, p_vendor uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare cm public.cash_moves%rowtype; v_id uuid;
begin
  if not (public.can_manage_finance() or public.is_marketing_manager()) then
    raise exception 'ربط الحركات للمالية أو مدير التسويق';
  end if;
  select * into cm from public.cash_moves where id = p_cash_move;
  if not found then raise exception 'الحركة غير موجودة'; end if;
  if cm.direction <> 'صرف' or cm.account_code <> '5700' then
    raise exception 'تُربط حركات الصرف على 5700 (تسويق وإعلان) وحدها';
  end if;
  if exists (select 1 from public.mkt_expenses where cash_move_id = p_cash_move or void_cash_move_id = p_cash_move) then
    raise exception 'الحركة مربوطة بمصروف سلفاً';
  end if;

  perform set_config('tilal.mkt_pay', 'on', true);
  insert into public.mkt_expenses
    (expense_date, category, description, amount, currency, project_id, campaign_id, channel_id,
     activity_id, vendor_id, status, approved_at, approved_by, paid_at, payment_method,
     partner_id, arm, cash_move_id)
  values (cm.move_date, p_category, cm.description, cm.amount, 'IQD', cm.project_id, p_campaign,
          p_channel, p_activity, p_vendor, 'مدفوع', now(), auth.uid(), cm.move_date, cm.method,
          cm.partner_id, cm.arm, cm.id)
  returning id into v_id;
  perform set_config('tilal.mkt_pay', 'off', true);
  return v_id;
end;
$fn$;

-- الإلغاء: قبل الدفع تغيير حالة؛ بعده حركة معاكسة (استرداد) بتاريخها
create or replace function public.mkt_void_expense(
  p_id uuid, p_reason text, p_refund_method text default 'نقد', p_date date default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare e public.mkt_expenses%rowtype; v_cm uuid; src public.cash_moves%rowtype;
begin
  select * into e from public.mkt_expenses where id = p_id for update;
  if not found then raise exception 'المصروف غير موجود'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;

  if e.status in ('مسودة', 'مرفوض') then
    if not public.can_write_marketing() then raise exception 'للتسويق'; end if;
  elsif e.status = 'معتمد' then
    if not (public.is_marketing_manager() or public.can_manage_finance()) then
      raise exception 'إلغاء المعتمد لمدير التسويق أو المالية';
    end if;
  elsif e.status = 'مدفوع' then
    if not public.can_manage_finance() then
      raise exception 'إلغاء المدفوع للمالية — يعني استرداداً يدخل الصندوق';
    end if;
    select * into src from public.cash_moves where id = e.cash_move_id;
    insert into public.cash_moves
      (move_date, direction, amount, category, account_code, arm, method, description, notes,
       project_id, created_by)
    values (coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date), 'قبض', e.amount_iqd,
            'تسويق وإعلان', '5700', coalesce(src.arm, e.arm, 'التسويق'), p_refund_method,
            'استرداد مصروف تسويق — ' || e.code || ' — ' || btrim(p_reason),
            'عكس الحركة ' || e.cash_move_id, e.project_id, auth.uid())
    returning id into v_cm;
  else
    raise exception 'المصروف % سلفاً', e.status;
  end if;

  if exists (select 1 from public.mkt_approvals where entity_type = 'مصروف' and entity_id = p_id and status = 'معلّق') then
    update public.mkt_approvals set status = 'ملغى', decided_at = now(), decided_by = auth.uid()
     where entity_type = 'مصروف' and entity_id = p_id and status = 'معلّق';
  end if;

  perform set_config('tilal.mkt_pay', 'on', true);
  update public.mkt_expenses
     set status = 'ملغى', void_reason = btrim(p_reason), void_cash_move_id = v_cm
   where id = p_id;
  perform set_config('tilal.mkt_pay', 'off', true);
end;
$fn$;

revoke all on function public.mkt_pay_expense(uuid, text, uuid, text, date) from public, anon;
revoke all on function public.mkt_link_cash_move(uuid, text, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.mkt_void_expense(uuid, text, text, date) from public, anon;
grant execute on function public.mkt_pay_expense(uuid, text, uuid, text, date) to authenticated;
grant execute on function public.mkt_link_cash_move(uuid, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.mkt_void_expense(uuid, text, text, date) to authenticated;


-- ------------------------------------------------------------
-- 3) حالة الميزانيات — المخطّط، المعتمد، الملتزم، المصروف، المتبقّي
-- ------------------------------------------------------------
create or replace function public.mkt_budget_status(p_from date default null, p_to date default null)
returns table (
  budget_id uuid, name text, scope text, scope_label text, period_type text,
  period_start date, period_end date, status text,
  planned numeric, approved numeric, committed numeric, spent numeric,
  remaining numeric, utilization_pct numeric, alert_level text, forecast numeric
)
language sql stable security definer set search_path = public as $$
  with b as (
    select * from public.mkt_budgets
     where public.can_read_marketing_money()
       and (p_from is null or period_end   >= p_from)
       and (p_to   is null or period_start <= p_to)
  ),
  agg as (
    select b.id,
           coalesce(sum(e.amount_iqd) filter (where e.status = 'مدفوع'), 0) as spent,
           coalesce(sum(e.amount_iqd) filter (where e.status = 'معتمد'), 0) as committed
      from b
      left join public.mkt_expenses e
        on e.status in ('مدفوع', 'معتمد')
       and coalesce(e.paid_at, e.expense_date) between b.period_start and b.period_end
       and case b.scope
             when 'شركة'  then true
             when 'مشروع' then e.project_id  = b.project_id
             when 'حملة'  then e.campaign_id = b.campaign_id
             when 'قناة'  then e.channel_id  = b.channel_id
             when 'نشاط'  then e.activity_id = b.activity_id
           end
     group by b.id
  )
  select b.id, b.name, b.scope,
         coalesce(p.name, cp.name, ch.name, ac.title, 'الشركة'),
         b.period_type, b.period_start, b.period_end, b.status,
         b.planned, b.approved, a.committed, a.spent,
         coalesce(b.approved, b.planned) - a.spent - a.committed,
         case when coalesce(b.approved, b.planned) > 0
              then round((a.spent + a.committed) * 100.0 / coalesce(b.approved, b.planned), 1) end,
         case
           when coalesce(b.approved, b.planned) = 0 then null
           when a.spent + a.committed >  coalesce(b.approved, b.planned) then 'تجاوز'
           when a.spent + a.committed >= coalesce(b.approved, b.planned) then '100%'
           when a.spent + a.committed >= coalesce(b.approved, b.planned) * 0.9 then '90%'
           when a.spent + a.committed >= coalesce(b.approved, b.planned) * 0.8 then '80%'
         end,
         b.forecast
    from b join agg a on a.id = b.id
    left join public.projects p       on p.id  = b.project_id
    left join public.crm_campaigns cp on cp.id = b.campaign_id
    left join public.mkt_channels ch  on ch.id = b.channel_id
    left join public.mkt_activities ac on ac.id = b.activity_id
   order by b.period_start desc, b.scope, b.name;
$$;

revoke all on function public.mkt_budget_status(date, date) from public, anon;
grant execute on function public.mkt_budget_status(date, date) to authenticated;


-- ------------------------------------------------------------
-- 4) المشتريات والمواد التسويقية — فوق المخزون القائم
-- ------------------------------------------------------------
alter table public.inventory_moves
  add column if not exists mkt_campaign_id uuid references public.crm_campaigns(id) on delete set null,
  add column if not exists mkt_activity_id uuid references public.mkt_activities(id) on delete set null;
create index if not exists inventory_moves_mkt_campaign_idx on public.inventory_moves (mkt_campaign_id)
  where mkt_campaign_id is not null;
create index if not exists inventory_moves_mkt_activity_idx on public.inventory_moves (mkt_activity_id)
  where mkt_activity_id is not null;

create sequence if not exists public.mkt_purchase_code_seq;

create table if not exists public.mkt_purchase_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique
                    default ('MPR-' || lpad(nextval('public.mkt_purchase_code_seq')::text, 4, '0')),
  item_id           uuid references public.inventory_items(id) on delete set null,
  item_name         text not null,
  quantity          numeric not null check (quantity > 0),
  estimated_cost    numeric check (estimated_cost is null or estimated_cost >= 0),
  campaign_id       uuid references public.crm_campaigns(id) on delete set null,
  activity_id       uuid references public.mkt_activities(id) on delete set null,
  project_id        uuid references public.projects(id) on delete set null,
  vendor_id         uuid references public.suppliers(id) on delete set null,
  needed_by         date,
  status            text not null default 'مسودة' check (status in (
                      'مسودة', 'بانتظار الموافقة', 'معتمد', 'تم الشراء', 'مرفوض', 'ملغى')),
  inventory_move_id uuid references public.inventory_moves(id) on delete set null,
  notes             text,
  requested_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);

create or replace function public.mkt_guard_purchase()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_flag boolean := coalesce(current_setting('tilal.mkt_approval', true), '') = 'on'
                       or coalesce(current_setting('tilal.mkt_pay', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.status := 'مسودة';
  elsif new.status is distinct from old.status and not v_flag
        and not (new.status = 'ملغى' and old.status in ('مسودة', 'مرفوض', 'معتمد')) then
    raise exception 'حالة طلب الشراء تتغيّر بالموافقة أو بتسجيل الشراء';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mkt_guard_purchase on public.mkt_purchase_requests;
create trigger trg_mkt_guard_purchase
  before insert or update on public.mkt_purchase_requests
  for each row execute function public.mkt_guard_purchase();

-- المخزون يسجّل الشراء المعتمد: حركة «شراء» بمسارها القائم (قيد 5350)
create or replace function public.mkt_receive_purchase(
  p_id uuid, p_unit_price numeric, p_supplier uuid default null, p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare r public.mkt_purchase_requests%rowtype; v_item uuid; v_move uuid;
begin
  if not public.can_manage_inventory() then
    raise exception 'تسجيل الشراء لمن يدير المخزون';
  end if;
  select * into r from public.mkt_purchase_requests where id = p_id for update;
  if not found then raise exception 'طلب الشراء غير موجود'; end if;
  if r.status <> 'معتمد' then raise exception 'لا يُشترى إلا المعتمد (الحالة: %)', r.status; end if;
  if coalesce(p_unit_price, -1) < 0 then raise exception 'سعر الوحدة'; end if;

  v_item := r.item_id;
  if v_item is null then
    insert into public.inventory_items (name, category, unit, quantity, min_quantity, supplier_id, is_active)
    values (r.item_name, 'مطبوعات ومواد تسويقية', 'قطعة', 0, 0, coalesce(p_supplier, r.vendor_id), true)
    returning id into v_item;
  end if;

  insert into public.inventory_moves
    (item_id, kind, quantity, unit_price, supplier_id, moved_at, notes,
     mkt_campaign_id, mkt_activity_id, created_by)
  values (v_item, 'شراء', r.quantity, p_unit_price,
          coalesce(p_supplier, r.vendor_id),
          coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date),
          'طلب شراء تسويق ' || r.code, r.campaign_id, r.activity_id, auth.uid())
  returning id into v_move;

  perform set_config('tilal.mkt_pay', 'on', true);
  update public.mkt_purchase_requests
     set status = 'تم الشراء', item_id = v_item, inventory_move_id = v_move
   where id = p_id;
  perform set_config('tilal.mkt_pay', 'off', true);

  if r.requested_by is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, priority, category, entity_type)
    values (r.requested_by, 'وصل طلب الشراء', r.code || ' — ' || r.item_name || ' × ' || r.quantity,
            '/dashboard/marketing/procurement', 'تسويق', r.id, 'عادية', 'تسويق', 'marketing');
  end if;
  return v_move;
end;
$fn$;

-- صرف مادّة تسويقية لحملة أو نشاط — بكلفة آخر شراء
create or replace function public.mkt_issue_material(
  p_item uuid, p_qty numeric, p_campaign uuid default null, p_activity uuid default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare it public.inventory_items%rowtype; v_move uuid; v_to text;
begin
  if not public.can_write_marketing() then raise exception 'صرف المواد لفريق التسويق'; end if;
  select * into it from public.inventory_items where id = p_item for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  if it.category <> 'مطبوعات ومواد تسويقية' then
    raise exception 'التسويق يصرف من «مطبوعات ومواد تسويقية» وحدها';
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'الكمية'; end if;
  if p_qty > coalesce(it.quantity, 0) then
    raise exception 'الرصيد % فقط من «%»', public.fmt_qty(it.quantity), it.name;
  end if;
  if p_campaign is null and p_activity is null then
    raise exception 'اختر الحملة أو النشاط — عليه تُحسب الكلفة';
  end if;

  select coalesce((select title from public.mkt_activities where id = p_activity),
                  (select name from public.crm_campaigns where id = p_campaign))
    into v_to;

  insert into public.inventory_moves
    (item_id, kind, quantity, unit_price, moved_at, issued_to, notes,
     mkt_campaign_id, mkt_activity_id, created_by)
  values (p_item, 'صرف', p_qty, it.last_purchase_price,
          (now() at time zone 'Asia/Baghdad')::date, 'تسويق — ' || v_to, p_note,
          p_campaign, p_activity, auth.uid())
  returning id into v_move;
  return v_move;
end;
$fn$;

revoke all on function public.mkt_receive_purchase(uuid, numeric, uuid, date) from public, anon;
revoke all on function public.mkt_issue_material(uuid, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.mkt_receive_purchase(uuid, numeric, uuid, date) to authenticated;
grant execute on function public.mkt_issue_material(uuid, numeric, uuid, uuid, text) to authenticated;

-- التسويق يرى مواده وحركاتها — ولا يرى بقيّة المخزون
drop policy if exists "marketing reads marketing items" on public.inventory_items;
create policy "marketing reads marketing items" on public.inventory_items
  for select to authenticated
  using (category = 'مطبوعات ومواد تسويقية' and (select public.can_read_marketing()));

drop policy if exists "marketing reads marketing moves" on public.inventory_moves;
create policy "marketing reads marketing moves" on public.inventory_moves
  for select to authenticated
  using ((select public.can_read_marketing())
         and (mkt_campaign_id is not null or mkt_activity_id is not null
              or exists (select 1 from public.inventory_items i
                          where i.id = item_id and i.category = 'مطبوعات ومواد تسويقية')));


-- ------------------------------------------------------------
-- 5) RLS والتدقيق
-- ------------------------------------------------------------
alter table public.mkt_budgets           enable row level security;
alter table public.mkt_expenses          enable row level security;
alter table public.mkt_purchase_requests enable row level security;

drop policy if exists "read mkt budgets" on public.mkt_budgets;
create policy "read mkt budgets" on public.mkt_budgets
  for select to authenticated using ((select public.can_read_marketing_money()));
drop policy if exists "write mkt budgets" on public.mkt_budgets;
create policy "write mkt budgets" on public.mkt_budgets
  for insert to authenticated with check ((select public.can_write_marketing()));
drop policy if exists "update mkt budgets" on public.mkt_budgets;
create policy "update mkt budgets" on public.mkt_budgets
  for update to authenticated
  using ((select public.can_write_marketing())) with check ((select public.can_write_marketing()));
drop policy if exists "delete mkt budgets" on public.mkt_budgets;
create policy "delete mkt budgets" on public.mkt_budgets
  for delete to authenticated
  using ((select public.is_marketing_manager()) and status = 'مسودة');

drop policy if exists "read mkt expenses" on public.mkt_expenses;
create policy "read mkt expenses" on public.mkt_expenses
  for select to authenticated using ((select public.can_read_marketing_money()));
drop policy if exists "write mkt expenses" on public.mkt_expenses;
create policy "write mkt expenses" on public.mkt_expenses
  for insert to authenticated with check ((select public.can_write_marketing()));
drop policy if exists "update mkt expenses" on public.mkt_expenses;
create policy "update mkt expenses" on public.mkt_expenses
  for update to authenticated
  using ((select public.can_write_marketing()) or (select public.can_manage_finance()))
  with check ((select public.can_write_marketing()) or (select public.can_manage_finance()));
drop policy if exists "delete mkt expenses" on public.mkt_expenses;
create policy "delete mkt expenses" on public.mkt_expenses
  for delete to authenticated using ((select public.is_marketing_manager()));

drop policy if exists "read mkt purchases" on public.mkt_purchase_requests;
create policy "read mkt purchases" on public.mkt_purchase_requests
  for select to authenticated
  using ((select public.can_read_marketing()) or (select public.can_manage_inventory()));
drop policy if exists "write mkt purchases" on public.mkt_purchase_requests;
create policy "write mkt purchases" on public.mkt_purchase_requests
  for insert to authenticated with check ((select public.can_write_marketing()));
drop policy if exists "update mkt purchases" on public.mkt_purchase_requests;
create policy "update mkt purchases" on public.mkt_purchase_requests
  for update to authenticated
  using ((select public.can_write_marketing())) with check ((select public.can_write_marketing()));
drop policy if exists "delete mkt purchases" on public.mkt_purchase_requests;
create policy "delete mkt purchases" on public.mkt_purchase_requests
  for delete to authenticated
  using ((select public.is_marketing_manager()) and status in ('مسودة', 'مرفوض'));

do $$
declare t text;
begin
  foreach t in array array['mkt_budgets', 'mkt_expenses', 'mkt_purchase_requests'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.audit_row()', t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- 6) التحقّق
-- ------------------------------------------------------------
do $$
declare n int; s numeric;
begin
  raise notice '--- 122 التسويق ٢ — المال ---';
  select count(*), coalesce(sum(amount), 0) into n, s from public.cash_moves
   where account_code = '5700' and direction = 'صرف'
     and id not in (select cash_move_id from public.mkt_expenses where cash_move_id is not null);
  raise notice 'حركات تسويق في المحاسبة غير منسوبة لحملة: % بمجموع % — تُنسب من «المصروفات» بـ«اربط حركة»', n, s;
  if not exists (select 1 from public.accounts where code = '5700' and is_active) then
    raise warning 'الحساب 5700 غير موجود أو غير نشط — الدفع سيُرفض من حارس 109';
  end if;
end $$;

notify pgrst, 'reload schema';
