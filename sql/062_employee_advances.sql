-- ============================================================
-- تلال ERP — 062: سلف الموظفين (المرحلة ٣)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== المشكلة =====
--
-- external_debts للسلف الخارجية (حساب 1350) فقط. وسلفة الموظف —
-- وهي الأكثر تكراراً — لا مكان لها: تُصرف نقداً وتُنسى، أو تُكتب
-- «استقطاع» بسببٍ نصّيّ «سلفة» بلا مبلغ أصلي ولا أقساط ولا رصيد،
-- وتُعامَل محاسبياً كأنها مصروف لا كأنها مالٌ للشركة عند الموظف.
--
-- ===== القيود — وهذا لبّ الهجرة =====
--
-- الصرف: مالٌ خرج وصار ذمّةً على الموظف، لا مصروفاً.
--     مدين 1360 سلف موظفين  /  دائن 1100 الصندوق (أو 1200 البنك)
--
-- الاعتماد: القسط **ليس مصروفاً ولا نقداً**. الموظف استحقّ راتبه
-- كاملاً، والشركة تحتجز جزءاً منه سداداً لذمّتها. فالقيد:
--
--     مدين 5100 الرواتب        E
--        دائن 2300 مستحقات      E − القسط
--        دائن 1360 السلف        القسط
--
--     حيث E = الأساسي + البدلات − الاستقطاعات الأخرى
--
-- مدينٌ واحد ودائنان: متوازن، ويُسقط الذمّة بمقدار القسط بلا أن
-- يمرّ نقدٌ ثانٍ. والموظف يقبض الصافي وقد نقص منه القسط أصلاً.
--
-- ⚠️ الفرق بين استقطاعٍ عادي وقسطِ سلفة جوهري:
--    الغياب يُنقص **المصروف** (لم يستحقّه الموظف أصلاً).
--    القسط يُنقص **الالتزام** (استحقّه، لكنه قبضه سلفاً).
--    ولذلك يُستثنى القسط من E ويُفرد بسطر دائن على 1360.
--
-- ⚠️ والتمييز بـ source_table = 'advance_installments' لا بالفئة:
--    الفئة نصٌّ قد يُعاد استعماله، والمصدر لا يلتبس.
--
-- ===== دورة السلفة =====
--   معلّقة → معتمدة (يُولَّد جدول الأقساط) → مصروفة (يُكتب القيد)
--          → مسدَّدة (بعد آخر قسط)
--   وأي حالة قبل الصرف تقبل الإلغاء.
--
-- ===== التراجع =====
--   حذف المحفّزات والدوالّ والجدولين، واستعادة repost_payroll و
--   build_payroll و reopen_payroll من sql/061 و sql/019.
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة:
--   employee_advances
--
-- يتطلب: sql/057 (salary_at) و sql/061 (بنود الإجازات).
-- آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 1) الحساب
-- ------------------------------------------------------------
-- منفصل عن 1350 «ديون خارجية» عمداً: سلفة الموظف تُستردّ من راتبه
-- آلياً، وسلفة الغير تُطالَب. خلطهما يُخفي أيّهما في الميزانية.
insert into public.accounts (code, name, type)
values ('1360', 'سلف الموظفين', 'asset')
on conflict (code) do nothing;


-- ------------------------------------------------------------
-- 2) السلفة
-- ------------------------------------------------------------
create table if not exists public.employee_advances (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  amount            numeric not null check (amount > 0),
  installments      int not null default 1 check (installments between 1 and 36),
  request_date      date not null default current_date,
  start_period      text,          -- أول شهر يُخصم فيه (YYYY-MM)
  reason            text,
  status            text not null default 'معلّقة'
                    check (status in ('معلّقة','معتمدة','مصروفة','مسدَّدة','ملغاة')),
  method            text not null default 'نقد' check (method in ('نقد','بنك')),
  approved_by       uuid references auth.users(id) on delete set null,
  approved_at       timestamptz,
  disbursed_at      date,
  disburse_entry_id uuid references public.journal_entries(id) on delete set null,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  created_by_name   text
);

create index if not exists employee_advances_emp
  on public.employee_advances (employee_id, status);

comment on table public.employee_advances is
  'سلف الموظفين — ذمّة على الموظف (حساب 1360) تُستردّ بأقساط من راتبه، لا مصروف (sql/062).';


-- ------------------------------------------------------------
-- 3) الأقساط
-- ------------------------------------------------------------
create table if not exists public.advance_installments (
  id           uuid primary key default gen_random_uuid(),
  advance_id   uuid not null references public.employee_advances(id) on delete cascade,
  seq          int not null,
  due_period   text not null,       -- YYYY-MM
  amount       numeric not null check (amount > 0),
  status       text not null default 'مستحق'
               check (status in ('مستحق','محصّل','مؤجّل','ملغى')),
  payroll_id   uuid references public.payrolls(id) on delete set null,
  collected_at date,
  constraint advance_installments_uniq unique (advance_id, seq)
);

create index if not exists advance_installments_due
  on public.advance_installments (status, due_period);

comment on table public.advance_installments is
  'جدول أقساط السلفة. build_payroll يسحب المستحقّ منها، و approve_payroll يحصّله (sql/062).';


-- ------------------------------------------------------------
-- 4) الرصيد المتبقّي — يُشتقّ لا يُخزَّن
-- ------------------------------------------------------------
create or replace function public.advance_remaining(p_advance uuid)
returns numeric
language sql stable security definer set search_path = public
as $fn$
  select greatest(
    (select a.amount from public.employee_advances a where a.id = p_advance)
    - coalesce((select sum(i.amount) from public.advance_installments i
                 where i.advance_id = p_advance and i.status = 'محصّل'), 0),
    0);
$fn$;

-- سلف موظف وأرصدتها — للشاشات، بفحص صلاحية داخلها
create or replace function public.advances_for(p_employee uuid)
returns table (
  id uuid, amount numeric, installments int, status text,
  request_date date, disbursed_at date, reason text,
  collected numeric, remaining numeric, next_due text
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.is_admin() and p_employee is distinct from public.my_employee_id() then
    raise exception 'سلف الموظف لصاحبها أو للمدير';
  end if;

  return query
  select a.id, a.amount, a.installments, a.status, a.request_date, a.disbursed_at, a.reason,
    coalesce((select sum(i.amount) from public.advance_installments i
               where i.advance_id = a.id and i.status = 'محصّل'), 0),
    public.advance_remaining(a.id),
    (select min(i.due_period) from public.advance_installments i
      where i.advance_id = a.id and i.status = 'مستحق')
  from public.employee_advances a
  where a.employee_id = p_employee
  order by a.request_date desc;
end;
$fn$;


-- ------------------------------------------------------------
-- 5) الطلب والاعتماد والصرف
-- ------------------------------------------------------------
create or replace function public.request_advance(
  p_employee     uuid,
  p_amount       numeric,
  p_installments int,
  p_reason       text default null,
  p_start_period text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid; v_who text; v_start text;
begin
  if not public.is_admin() and p_employee is distinct from public.my_employee_id() then
    raise exception 'تطلب سلفة لنفسك، أو يطلبها المدير لغيرك';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'مبلغ السلفة يجب أن يكون أكبر من صفر';
  end if;
  if p_installments is null or p_installments < 1 or p_installments > 36 then
    raise exception 'عدد الأقساط بين ١ و٣٦';
  end if;

  v_start := coalesce(p_start_period,
              to_char((now() at time zone 'Asia/Baghdad')::date + interval '1 month', 'YYYY-MM'));
  if v_start !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'صيغة شهر البدء YYYY-MM';
  end if;

  select coalesce(e.full_name, p.email) into v_who
    from public.profiles p left join public.employees e on e.user_id = p.id
   where p.id = auth.uid();

  insert into public.employee_advances
    (employee_id, amount, installments, reason, start_period, created_by, created_by_name)
  values (p_employee, p_amount, p_installments, nullif(btrim(coalesce(p_reason,'')),''),
          v_start, auth.uid(), v_who)
  returning id into v_id;

  -- إشعار المدراء
  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id, 'طلب سلفة جديد',
         coalesce(v_who, 'موظف') || ' يطلب سلفة ' || public.fmt_qty(p_amount) ||
         ' د.ع على ' || p_installments || ' أقساط',
         '/dashboard/hr/advances', 'راتب', v_id
    from public.profiles p
   where p.role = 'admin' and p.id <> auth.uid();

  return v_id;
end;
$fn$;

-- الاعتماد يولّد جدول الأقساط. آخر قسط يحمل الكسر فلا يضيع دينار.
create or replace function public.approve_advance(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  a public.employee_advances%rowtype; emp public.employees%rowtype;
  v_each numeric; v_sum numeric := 0; v_amt numeric; i int; v_period text;
begin
  if not public.is_admin() then
    raise exception 'اعتماد السلف للمدير';
  end if;

  select * into a from public.employee_advances where id = p_id;
  if not found then raise exception 'السلفة غير موجودة'; end if;
  if a.status <> 'معلّقة' then
    raise exception 'السلفة % — لا تُعتمد إلا المعلّقة', a.status;
  end if;

  v_each := round(a.amount / a.installments);

  for i in 1..a.installments loop
    v_period := to_char(to_date(a.start_period || '-01','YYYY-MM-DD')
                        + ((i - 1) || ' month')::interval, 'YYYY-MM');
    -- آخر قسط = الباقي، فلا يضيع كسرُ التقريب ولا يزيد
    v_amt := case when i = a.installments then a.amount - v_sum else v_each end;
    v_sum := v_sum + v_amt;

    insert into public.advance_installments (advance_id, seq, due_period, amount)
    values (p_id, i, v_period, v_amt)
    on conflict (advance_id, seq) do nothing;
  end loop;

  update public.employee_advances
     set status = 'معتمدة', approved_by = auth.uid(), approved_at = now()
   where id = p_id;

  select * into emp from public.employees where id = a.employee_id;
  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'اعتُمدت سلفتك',
            public.fmt_qty(a.amount) || ' د.ع على ' || a.installments ||
            ' أقساط، تبدأ من ' || a.start_period || '.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$fn$;

-- الصرف: هنا وحده يخرج النقد ويُكتب القيد
create or replace function public.disburse_advance(
  p_id uuid, p_method text default 'نقد', p_date date default null
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  a public.employee_advances%rowtype; emp public.employees%rowtype;
  v_cash uuid; v_recv uuid; v_entry uuid; v_when date;
begin
  if not public.is_admin() then
    raise exception 'صرف السلف للمدير';
  end if;

  select * into a from public.employee_advances where id = p_id;
  if not found then raise exception 'السلفة غير موجودة'; end if;
  if a.status <> 'معتمدة' then
    raise exception 'السلفة % — لا تُصرف إلا المعتمدة', a.status;
  end if;

  v_when := coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date);

  select id into v_recv from public.accounts where code = '1360';
  select id into v_cash from public.accounts
   where code = case when p_method = 'بنك' then '1200' else '1100' end;
  if v_recv is null or v_cash is null then
    raise exception 'حساب 1360 أو حساب النقد غير موجود';
  end if;

  select * into emp from public.employees where id = a.employee_id;

  insert into public.journal_entries (entry_date, description, reference, arm, source)
  values (v_when, 'صرف سلفة — ' || coalesce(emp.full_name, ''),
          'ADVANCE', 'إداري عام', 'employee_advances')
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit)
  values (v_entry, v_recv, a.amount, 0),
         (v_entry, v_cash, 0,        a.amount);

  update public.employee_advances
     set status = 'مصروفة', disbursed_at = v_when,
         method = p_method, disburse_entry_id = v_entry
   where id = p_id;

  if emp.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    values (emp.user_id, 'صُرفت سلفتك',
            public.fmt_qty(a.amount) || ' د.ع — تُستردّ بأقساط من راتبك.',
            '/dashboard/me/salary', 'راتب', p_id);
  end if;
end;
$fn$;

create or replace function public.cancel_advance(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.employee_advances%rowtype;
begin
  if not public.is_admin() then raise exception 'إلغاء السلف للمدير'; end if;
  select * into a from public.employee_advances where id = p_id;
  if not found then raise exception 'السلفة غير موجودة'; end if;
  if a.status = 'مصروفة' then
    raise exception 'السلفة مصروفة — النقد خرج فعلاً. سدّد أقساطها أو سجّل ردّها.';
  end if;
  if a.status in ('مسدَّدة','ملغاة') then
    raise exception 'السلفة % بالفعل', a.status;
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'اكتب سبب الإلغاء';
  end if;

  update public.advance_installments set status = 'ملغى'
   where advance_id = p_id and status = 'مستحق';
  update public.employee_advances
     set status = 'ملغاة', cancel_reason = btrim(p_reason)
   where id = p_id;
end;
$fn$;


-- ------------------------------------------------------------
-- 6) القسط يدخل الكشف
-- ------------------------------------------------------------
create or replace function public.due_advance_installments(p_employee uuid, p_period text)
returns table (installment_id uuid, description text, amount numeric)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'أقساط السلف للمدير';
  end if;

  return query
  select i.id,
         'قسط سلفة ' || i.seq || '/' || a.installments ||
           ' — المتبقّي بعده ' ||
           public.fmt_qty(greatest(public.advance_remaining(a.id) - i.amount, 0)) || ' د.ع',
         -- ⚠️ لا يُخصم أكثر من المتبقّي مهما كان جدول الأقساط
         least(i.amount, public.advance_remaining(a.id))
    from public.advance_installments i
    join public.employee_advances a on a.id = i.advance_id
   where a.employee_id = p_employee
     and a.status = 'مصروفة'
     and i.status = 'مستحق'
     and i.due_period <= p_period
     and public.advance_remaining(a.id) > 0
   order by i.due_period, i.seq;
end;
$fn$;


-- ------------------------------------------------------------
-- 7) الصلاحيات
-- ------------------------------------------------------------
alter table public.employee_advances   enable row level security;
alter table public.advance_installments enable row level security;

drop policy if exists "admin manages advances" on public.employee_advances;
create policy "admin manages advances" on public.employee_advances
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "employee reads own advances" on public.employee_advances;
create policy "employee reads own advances" on public.employee_advances
  for select to authenticated
  using (employee_id = (select public.my_employee_id()));

drop policy if exists "admin manages installments" on public.advance_installments;
create policy "admin manages installments" on public.advance_installments
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "employee reads own installments" on public.advance_installments;
create policy "employee reads own installments" on public.advance_installments
  for select to authenticated
  using (advance_id in (select a.id from public.employee_advances a
                         where a.employee_id = (select public.my_employee_id())));

do $do$
declare t text;
begin
  foreach t in array array['employee_advances','advance_installments'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete
                      on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $do$;

revoke execute on function public.request_advance(uuid, numeric, int, text, text) from public, anon;
revoke execute on function public.approve_advance(uuid)                  from public, anon;
revoke execute on function public.disburse_advance(uuid, text, date)     from public, anon;
revoke execute on function public.cancel_advance(uuid, text)             from public, anon;
revoke execute on function public.advances_for(uuid)                     from public, anon;
revoke execute on function public.due_advance_installments(uuid, text)   from public, anon;

grant execute on function public.request_advance(uuid, numeric, int, text, text) to authenticated;
grant execute on function public.approve_advance(uuid)               to authenticated;
grant execute on function public.disburse_advance(uuid, text, date)  to authenticated;
grant execute on function public.cancel_advance(uuid, text)          to authenticated;
grant execute on function public.advances_for(uuid)                  to authenticated;

notify pgrst, 'reload schema';
