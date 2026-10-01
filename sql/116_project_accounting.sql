-- ============================================================
-- تلال ERP — 116: المشروع على القيد — صرفيات كل مشروع وإيراده منفصلة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- الدفتر يعرف الحساب والذراع، ولا يعرف المشروع. فراتب موظفة الفرقان
-- وإعلان لاماك وضيافة المكتب كلها «مصروف» واحد، ولا يُعرف كم كلّف
-- كل مشروع. و«ربحية المشاريع» (066) تُحسب من الجداول التشغيلية لا من
-- الدفتر، فلا ترى الإعلان ولا أيّ حركة يدوية.
--
-- ===== ما يضيفه =====
--
--   ١) project_id على:
--      • journal_entries — المرجع لكل تقرير. فارغ = «عام» (على الشركة).
--      • cash_moves — يختاره المستخدم عند الصرف أو القبض، ويُعدَّل
--        لاحقاً لتصنيف الحركات القديمة؛ ويتبعه قيدها.
--      • payrolls — لقطة من مشروع الموظف عند إنشاء الكشف، فانتقال
--        الموظف لاحقاً لا يغيّر الأشهر الماضية. يُعدَّل من الكشف، ويتبعه
--        قيده وقيود دفعاته.
--
--   ٢) journal_project_for(source, id) — مشروع القيد الآلي من مصدره:
--        حركة          ← مشروع الحركة
--        كشف/دفعته     ← مشروع الكشف، وإلا مشروع الموظف
--        عمولة موظف    ← مشروع صفقتها، وإلا مشروع الموظف
--        عمولة تلال    ← مشروع الصفقة (استحقاق، تحصيل، عكس)
--        دفعة وسيط     ← مشروع عمولة الوسيط
--        سلفة، دين، مخزون ← عام
--      يُختم مع source_id (محفّز 108)، ويُعاد حسابه حين يتغيّر مشروع
--      المصدر.
--
--   ٣) post_manual_entry(…, p_project) — القيد اليدوي يحمل مشروعاً.
--
--   ٤) project_finance(from, to) — لكل مشروع و«عام»: الإيراد، والرواتب،
--      وعمولات الموظفين، وعمولات الوسطاء، والتسويق، وباقي المصروف، والصافي.
--      project_ledger(project, from, to) — سطور الإيراد والمصروف لمشروع
--      أو لـ«عام» (p_project فارغ).
--
-- ===== أثره على البيانات =====
--
-- لا مبلغ يتغيّر. يُملأ project_id للكشوف من مشروع موظفيها، وللقيود
-- الآلية من مصادرها. الحركات النقدية القديمة تبقى «عامة» حتى يصنّفها
-- المستخدم من صفحة الحركات. التصنيف يُسجَّل في audit_log، ويرفضه قفل
-- الفترة في الشهر المقفل.
--
-- ===== حدود =====
--
-- راتب موظف يعمل على أكثر من مشروع يُحمَّل كاملاً على مشروعه الواحد —
-- التوزيع بنِسب (مراكز التكلفة) مرحلة لاحقة.
--
-- يتطلب: 108، 110، 111، 112. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- ١) الأعمدة
-- ------------------------------------------------------------
alter table public.journal_entries
  add column if not exists project_id uuid references public.projects(id) on delete restrict;
alter table public.cash_moves
  add column if not exists project_id uuid references public.projects(id) on delete restrict;
alter table public.payrolls
  add column if not exists project_id uuid references public.projects(id) on delete restrict;

create index if not exists journal_entries_project_idx on public.journal_entries (project_id);
create index if not exists cash_moves_project_idx      on public.cash_moves (project_id);

comment on column public.journal_entries.project_id is
  'المشروع الذي يُحمَّل عليه القيد. فارغ = عام (على الشركة). للآلي من مصدره (journal_project_for — sql/116).';
comment on column public.cash_moves.project_id is
  'المشروع الذي صُرفت له الحركة أو قُبضت منه. فارغ = عام. يتبعه قيدها (sql/116).';
comment on column public.payrolls.project_id is
  'مشروع الكشف — لقطة من مشروع الموظف عند الإنشاء. يتبعه قيد الاستحقاق ودفعاته (sql/116).';


-- ------------------------------------------------------------
-- ٢) مشروع القيد الآلي من مصدره
-- ------------------------------------------------------------
create or replace function public.journal_project_for(p_source text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select case p_source
    when 'cash_moves' then
      (select c.project_id from public.cash_moves c where c.id = p_id)
    when 'payrolls' then
      (select coalesce(p.project_id, e.project_id)
         from public.payrolls p left join public.employees e on e.id = p.employee_id
        where p.id = p_id)
    when 'payroll_payments' then
      (select coalesce(p.project_id, e.project_id)
         from public.payroll_payments pp
         join public.payrolls p on p.id = pp.payroll_id
         left join public.employees e on e.id = p.employee_id
        where pp.id = p_id)
    when 'commissions' then
      (select coalesce(
                (select coalesce(sc.project_id, u.project_id)
                   from public.sale_commissions sc left join public.units u on u.id = sc.unit_id
                  where sc.commission_id = c.id limit 1),
                e.project_id)
         from public.commissions c left join public.employees e on e.id = c.employee_id
        where c.id = p_id)
    when 'reservations' then
      (select coalesce(sc.project_id, u.project_id)
         from public.reservations r
         left join public.sale_commissions sc on sc.reservation_id = r.id
         left join public.units u on u.id = r.unit_id
        where r.id = p_id limit 1)
    when 'sale_commissions' then
      (select coalesce(sc.project_id, u.project_id)
         from public.sale_commissions sc left join public.units u on u.id = sc.unit_id
        where sc.id = p_id)
    when 'broker_payments' then
      (select bc.project_id
         from public.broker_payments bp join public.broker_commissions bc on bc.id = bp.commission_id
        where bp.id = p_id)
    else null   -- سلفة، دين، مخزون: عام
  end;
$fn$;

comment on function public.journal_project_for(text, uuid) is
  'المشروع الذي يُحمَّل عليه قيدٌ آلي، من صفّه المصدر (sql/116).';

-- الختم (108) يضع المشروع مع source_id
create or replace function public.stamp_journal_source()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_col   text := tg_argv[0];
  v_entry uuid := (to_jsonb(new) ->> v_col)::uuid;
  v_old   uuid;
  v_sid   uuid := new.id;
begin
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_col)::uuid;
  end if;
  if v_entry is null or v_entry is not distinct from v_old then
    return null;
  end if;

  -- COMMIN يُسمّي sale_commissions مصدراً ويُحفظ على الحجز
  if tg_table_name = 'reservations' and v_col = 'commission_collect_entry_id' then
    select sc.id into v_sid from public.sale_commissions sc where sc.reservation_id = new.id;
  end if;

  update public.journal_entries e
     set source_id  = v_sid,
         project_id = public.journal_project_for(e.source, v_sid)
   where e.id = v_entry
     and (e.source_id is distinct from v_sid
          or e.project_id is distinct from public.journal_project_for(e.source, v_sid));
  return null;
end;
$fn$;

-- إعادة حساب مشروع قيود مصدرٍ ما — حين يتغيّر مشروعه
create or replace function public.resync_journal_project(p_source text, p_ids uuid[])
returns void language sql security definer set search_path = public as $fn$
  update public.journal_entries e
     set project_id = public.journal_project_for(e.source, e.source_id)
   where e.source = p_source and e.source_id = any (p_ids)
     and e.project_id is distinct from public.journal_project_for(e.source, e.source_id);
$fn$;

create or replace function public.sync_project_from_source()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_table_name = 'cash_moves' then
    perform public.resync_journal_project('cash_moves', array[new.id]);

  elsif tg_table_name = 'payrolls' then
    perform public.resync_journal_project('payrolls', array[new.id]);
    perform public.resync_journal_project('payroll_payments',
      array(select pp.id from public.payroll_payments pp where pp.payroll_id = new.id));

  elsif tg_table_name = 'sale_commissions' then
    perform public.resync_journal_project('sale_commissions', array[new.id]);
    perform public.resync_journal_project('reservations', array[new.reservation_id]);
    if new.commission_id is not null then
      perform public.resync_journal_project('commissions', array[new.commission_id]);
    end if;
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_sync_project_cash_move on public.cash_moves;
create trigger trg_sync_project_cash_move
  after update of project_id on public.cash_moves
  for each row when (new.project_id is distinct from old.project_id)
  execute function public.sync_project_from_source();

drop trigger if exists trg_sync_project_payroll on public.payrolls;
create trigger trg_sync_project_payroll
  after update of project_id on public.payrolls
  for each row when (new.project_id is distinct from old.project_id)
  execute function public.sync_project_from_source();

-- confirm_down_payment تكتب العمولة ثم تربطها بالصفقة: الربط يصحّح مشروع قيدها
drop trigger if exists trg_sync_project_sale_commission on public.sale_commissions;
create trigger trg_sync_project_sale_commission
  after update of commission_id, project_id on public.sale_commissions
  for each row
  when (new.commission_id is distinct from old.commission_id or new.project_id is distinct from old.project_id)
  execute function public.sync_project_from_source();

-- الكشف الجديد يأخذ مشروع موظفه لقطةً
create or replace function public.stamp_payroll_project()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.project_id is null then
    select e.project_id into new.project_id from public.employees e where e.id = new.employee_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_stamp_payroll_project on public.payrolls;
create trigger trg_stamp_payroll_project
  before insert on public.payrolls
  for each row execute function public.stamp_payroll_project();


-- ------------------------------------------------------------
-- ٣) ملء القائم
-- ------------------------------------------------------------
update public.payrolls p set project_id = e.project_id
  from public.employees e
 where e.id = p.employee_id and p.project_id is null and e.project_id is not null;

update public.journal_entries e
   set project_id = public.journal_project_for(e.source, e.source_id)
 where e.source is not null and e.source_id is not null
   and e.project_id is distinct from public.journal_project_for(e.source, e.source_id);


-- ------------------------------------------------------------
-- ٤) القيد اليدوي بمشروع
-- ------------------------------------------------------------
drop function if exists public.post_manual_entry(date, text, text, jsonb, text);

create or replace function public.post_manual_entry(
  p_date        date,
  p_description text,
  p_reference   text  default null,
  p_lines       jsonb default '[]'::jsonb,
  p_arm         text  default 'إداري عام',
  p_project     uuid  default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_entry uuid;
  l       jsonb;
  v_acc   public.accounts%rowtype;
  v_d     numeric; v_c numeric;
  v_td    numeric := 0; v_tc numeric := 0;
  v_n     int := 0;
  i       int := 0;
begin
  if not public.can_manage_finance() then
    raise exception 'القيد اليدوي للمدير أو المحاسب';
  end if;
  if p_date is null then
    raise exception 'تاريخ القيد مطلوب';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'اكتب بيان القيد';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'القيد يحتاج سطرين على الأقل';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project) then
    raise exception 'المشروع غير موجود';
  end if;

  insert into public.journal_entries
    (entry_date, description, reference, arm, source, created_by, project_id)
  values (p_date, btrim(p_description),
          coalesce(nullif(btrim(coalesce(p_reference, '')), ''), 'MANUAL'),
          coalesce(nullif(btrim(coalesce(p_arm, '')), ''), 'إداري عام'),
          null, auth.uid(), p_project)
  returning id into v_entry;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_d := round(coalesce(nullif(l->>'debit',  '')::numeric, 0), 2);
    v_c := round(coalesce(nullif(l->>'credit', '')::numeric, 0), 2);

    if v_d < 0 or v_c < 0 then
      raise exception 'السطر %: المبلغ لا يكون سالباً', i;
    end if;
    if v_d > 0 and v_c > 0 then
      raise exception 'السطر %: مدين أو دائن — لا الاثنان', i;
    end if;
    if v_d = 0 and v_c = 0 then
      raise exception 'السطر %: بلا مبلغ', i;
    end if;

    v_acc := null;
    if nullif(l->>'account_id', '') is not null then
      select * into v_acc from public.accounts where id = (l->>'account_id')::uuid;
    elsif nullif(l->>'account_code', '') is not null then
      select * into v_acc from public.accounts where code = l->>'account_code';
    end if;
    if v_acc.id is null then
      raise exception 'السطر %: الحساب غير موجود', i;
    end if;
    if not v_acc.is_active then
      raise exception 'السطر %: الحساب % — % غير نشط', i, v_acc.code, v_acc.name;
    end if;

    insert into public.journal_lines (entry_id, account_id, debit, credit, line_note)
    values (v_entry, v_acc.id, v_d, v_c, nullif(btrim(coalesce(l->>'note', '')), ''));

    v_td := v_td + v_d;
    v_tc := v_tc + v_c;
    v_n  := v_n + 1;
  end loop;

  if v_td <> v_tc then
    raise exception 'القيد غير متوازن: المدين % والدائن %', v_td, v_tc;
  end if;

  return v_entry;
end;
$fn$;

comment on function public.post_manual_entry(date, text, text, jsonb, text, uuid) is
  'القيد اليدوي ذرّياً، ومعه مشروعه إن كان له (sql/111، 116).';

-- العكس يرث مشروع الأصل
create or replace function public.inherit_reversal_project()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.reversal_of is not null and new.project_id is null then
    select e.project_id into new.project_id from public.journal_entries e where e.id = new.reversal_of;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_inherit_reversal_project on public.journal_entries;
create trigger trg_inherit_reversal_project
  before insert on public.journal_entries
  for each row execute function public.inherit_reversal_project();


-- ------------------------------------------------------------
-- ٥) التقارير
-- ------------------------------------------------------------
create or replace function public.project_finance(
  p_from date default null,
  p_to   date default null
)
returns table (
  project_id uuid, project_name text,
  revenue numeric, payroll numeric, commissions numeric, brokers numeric,
  marketing numeric, other_expense numeric, total_expense numeric, net numeric,
  entries bigint
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_manage_finance() then
    raise exception 'حسابات المشاريع للمدير أو المحاسب';
  end if;

  return query
  with x as (
    select e.project_id pid, a.code, a.type, l.debit, l.credit, e.id eid
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      join public.accounts a        on a.id = l.account_id
     where a.type in ('revenue', 'expense')
       and (p_from is null or e.entry_date >= p_from)
       and (p_to   is null or e.entry_date <= p_to)
  ),
  g as (
    select x.pid,
           coalesce(sum(x.credit - x.debit) filter (where x.type = 'revenue'), 0) rev,
           coalesce(sum(x.debit - x.credit) filter (where x.code in ('5100', '5110')), 0) pay,
           coalesce(sum(x.debit - x.credit) filter (where x.code = '5500'), 0) com,
           coalesce(sum(x.debit - x.credit) filter (where x.code = '5510'), 0) brk,
           coalesce(sum(x.debit - x.credit) filter (where x.code = '5700'), 0) mkt,
           coalesce(sum(x.debit - x.credit) filter (where x.type = 'expense'), 0) exp,
           count(distinct x.eid) n
      from x group by x.pid
  )
  select pr.id, coalesce(pr.name, 'عام — على الشركة'),
         coalesce(g.rev, 0), coalesce(g.pay, 0), coalesce(g.com, 0), coalesce(g.brk, 0),
         coalesce(g.mkt, 0),
         coalesce(g.exp, 0) - coalesce(g.pay, 0) - coalesce(g.com, 0) - coalesce(g.brk, 0) - coalesce(g.mkt, 0),
         coalesce(g.exp, 0),
         coalesce(g.rev, 0) - coalesce(g.exp, 0),
         coalesce(g.n, 0)
    from (select p.id, p.name from public.projects p
          union all select null::uuid, null::text) pr
    left join g on g.pid is not distinct from pr.id
   order by (pr.id is null), coalesce(g.rev, 0) - coalesce(g.exp, 0) desc, pr.name;
end;
$fn$;

comment on function public.project_finance(date, date) is
  'إيراد كل مشروع ومصروفه من الدفتر — رواتب، عمولات، وسطاء، تسويق، أخرى — وصفّ «عام» لما لا مشروع له (sql/116).';

create or replace function public.project_ledger(
  p_project uuid,
  p_from    date default null,
  p_to      date default null
)
returns table (
  entry_id uuid, entry_date date, description text, reference text, source text,
  account_code text, account_name text, account_type text,
  amount numeric   -- موجب: إيراد للمشروع أو مصروف عليه بحسب النوع
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_manage_finance() then
    raise exception 'حسابات المشاريع للمدير أو المحاسب';
  end if;

  return query
  select e.id, e.entry_date, e.description, e.reference, e.source,
         a.code, a.name, a.type,
         case when a.type = 'revenue' then l.credit - l.debit else l.debit - l.credit end
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.accounts a        on a.id = l.account_id
   where a.type in ('revenue', 'expense')
     and e.project_id is not distinct from p_project
     and (p_from is null or e.entry_date >= p_from)
     and (p_to   is null or e.entry_date <= p_to)
   order by e.entry_date desc, e.created_at desc;
end;
$fn$;

comment on function public.project_ledger(uuid, date, date) is
  'سطور الإيراد والمصروف لمشروع، أو لـ«عام» حين p_project فارغ (sql/116).';


-- ------------------------------------------------------------
-- الصلاحيات
-- ------------------------------------------------------------
revoke execute on function public.journal_project_for(text, uuid)            from public, anon, authenticated;
revoke execute on function public.resync_journal_project(text, uuid[])       from public, anon, authenticated;
revoke execute on function public.sync_project_from_source()                 from public, anon, authenticated;
revoke execute on function public.stamp_payroll_project()                    from public, anon, authenticated;
revoke execute on function public.inherit_reversal_project()                 from public, anon, authenticated;
revoke execute on function public.post_manual_entry(date, text, text, jsonb, text, uuid) from public, anon;
revoke execute on function public.project_finance(date, date)                from public, anon;
revoke execute on function public.project_ledger(uuid, date, date)           from public, anon;
grant  execute on function public.post_manual_entry(date, text, text, jsonb, text, uuid) to authenticated;
grant  execute on function public.project_finance(date, date)                to authenticated;
grant  execute on function public.project_ledger(uuid, date, date)           to authenticated;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- ٦) الاختبارات — select * from tests.run_project_accounting();
--    نمط 115: كل شيء في معاملة فرعية تُلغى، وتواريخ ٢٠٢٠.
-- ------------------------------------------------------------
create or replace function tests.run_project_accounting()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; p_a uuid; p_b uuid; emp uuid;
  cm uuid; je uuid; pr uuid; m1 uuid; v numeric; v2 numeric; n int; txt text; i int := 0;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();
  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  select id into p_a from public.projects order by name limit 1;
  select id into p_b from public.projects where id <> p_a order by name limit 1;
  select e.id into emp from public.employees e
   where e.status = 'active' and coalesce(e.base_salary, 0) > 0 and e.end_date is null
   order by e.full_name limit 1;
  if admin_u is null or p_a is null or p_b is null or emp is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير ومشروعان وموظف'::text;
    return;
  end if;

  begin
    update public.company_settings set attendance_rules_enabled = false where id = 1;
    perform tests.act_as(admin_u);

    -- مجموع المشاريع = قائمة الدخل
    select sum(revenue), sum(total_expense) into v, v2 from public.project_finance(null, null);
    log := log || extensions.ok(
      v  = (select coalesce(sum(credit - debit), 0) from public.account_balances(null, null) where type = 'revenue') and
      v2 = (select coalesce(sum(debit - credit), 0) from public.account_balances(null, null) where type = 'expense'),
      'مجموع حسابات المشاريع = الإيراد والمصروف في الدفتر');

    -- الحركة تحمل مشروعها إلى قيدها
    insert into public.cash_moves (move_date, direction, amount, category, account_code, arm, method, description, project_id)
    values ('2020-01-05', 'صرف', 1000, 'تسويق وإعلان', '5700', 'التسويق', 'نقد', 'اختبار مشروع', p_a)
    returning id into cm;
    select journal_entry_id into je from public.cash_moves where id = cm;
    log := log || extensions.is((select project_id from public.journal_entries where id = je), p_a,
      'حركة جديدة: قيدها على مشروعها');

    -- إعادة النسبة من المتصفّح تُنقل إلى القيد
    set local role authenticated;
    update public.cash_moves set project_id = p_b where id = cm;
    reset role;
    log := log || extensions.is((select project_id from public.journal_entries where id = je), p_b,
      'نسبة الحركة لمشروع آخر تنقل قيدها');

    select marketing into v from public.project_finance('2020-01-01', '2020-01-31') where project_id = p_b;
    log := log || extensions.ok(v = 1000, 'تسويق المشروع في الفترة = 1000');

    -- الكشف يأخذ مشروع موظفه، ويُنقل بقيده
    pr := public.build_payroll(emp, '2020-01');
    log := log || extensions.is((select project_id from public.payrolls where id = pr),
                                (select project_id from public.employees where id = emp),
      'الكشف الجديد يأخذ مشروع موظفه');
    perform public.approve_payroll(pr);
    update public.payrolls set project_id = p_a where id = pr;
    log := log || extensions.is(
      (select e.project_id from public.journal_entries e join public.payrolls p on p.journal_entry_id = e.id where p.id = pr),
      p_a, 'نقل الكشف لمشروع ينقل قيد استحقاقه');

    -- القيد اليدوي بمشروع، وعكسه يرثه
    m1 := public.post_manual_entry('2020-01-06', 'اختبار يدوي بمشروع', null,
            '[{"account_code":"5800","debit":50},{"account_code":"1100","credit":50}]'::jsonb, 'إداري عام', p_a);
    log := log || extensions.is((select project_id from public.journal_entries where id = m1), p_a,
      'القيد اليدوي يحمل مشروعه');
    log := log || extensions.is(
      (select project_id from public.journal_entries
        where id = public.reverse_journal_entry(m1, '2020-01-07', 'اختبار')), p_a,
      'عكس القيد يرث مشروعه');

    -- «عام»
    select count(*) into n from public.project_ledger(null, null, null);
    log := log || extensions.ok(n >= 0, 'سطور «عام» تُقرأ');

    begin
      set constraints all immediate;
      log := log || extensions.pass('كل القيود متوازنة عند الـ commit');
    exception when others then
      log := log || extensions.fail('commit: ' || sqlerrm);
    end;

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المشاريع: ' || sqlerrm || ' @ ' || left(txt, 300));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

revoke all on function tests.run_project_accounting() from public;
grant execute on function tests.run_project_accounting() to service_role;
