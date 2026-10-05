-- ============================================================
-- تلال ERP — 155: سياسات الإجازات وسير موافقتها (المرحلة 4)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 061، 153، 154.
--
-- ============================================================
-- ما يتغيّر
--
-- كانت الإجازة تُقرَّر بتحديثٍ مباشر لحالتها: المدير وHR والمشرف كلٌّ
-- يغيّرها. الآن كل طلب جديد يدخل محرّك الموافقات بسلسلة نوعه:
--     سنوية/مرضية/طارئة…  ⇒ leave         (المدير المباشر ← HR)
--     بدون راتب           ⇒ leave_unpaid  (المدير المباشر ← HR ← المدير العام)
-- والقرار من decide_leave (تستدعيها شاشات الإجازة الثلاث). HR والمدير
-- يبقى لهما «تجاوز» مسجَّل؛ والطلبات القديمة بلا سلسلة تُقرَّر كما كانت.
--
-- ما يبقى كما هو: الرصيد حركاتٌ في leave_ledger، والاستهلاك عند الاعتماد
-- (sync_leave_ledger)، وحارس الرصيد وحارس الكشف المعتمد (guard_leave_request).
--
-- ============================================================
-- ما يضيفه
--
--   • سياسة لكل نوع: السلسلة، أقصى أيام للطلب، إشعار مسبق، حدّ الترحيل،
--     يتطلب مرفقاً — تُدار من إعدادات HR.
--   • نوعان: «أمومة» و«تعويضية» (رصيدها من العمل الإضافي المعوَّض بإجازة).
--   • ترحيل الرصيد آخر السنة لما يُرحَّل (بحدّه) — cron.
--   • توثيق cron الاستحقاق الشهري (كان في القاعدة بلا ملف).
--   • approval_apply: تطبيق النتيجة على الإجازة وطلب الدوام والعمل الإضافي.
-- ============================================================


-- ============================================================
-- ١) سياسة النوع
-- ============================================================
alter table public.leave_types
  add column if not exists workflow_code        text references public.approval_workflows(code) on update cascade,
  add column if not exists max_days_per_request numeric check (max_days_per_request is null or max_days_per_request > 0),
  add column if not exists min_notice_days      int check (min_notice_days is null or min_notice_days >= 0),
  add column if not exists carry_over_max_days  numeric check (carry_over_max_days is null or carry_over_max_days >= 0),
  add column if not exists requires_attachment  boolean not null default false,
  add column if not exists description          text;

update public.leave_types set workflow_code = 'leave' where workflow_code is null;
update public.leave_types set workflow_code = 'leave_unpaid' where name = 'بدون راتب';
alter table public.leave_types alter column workflow_code set default 'leave';

insert into public.leave_types (name, annual_days, accrues_monthly, requires_balance, deducts_salary, carries_over, sort_order, workflow_code, description)
select v.name, 0, false, v.bal, false, false, v.ord, 'leave', v.descr
  from (values
    ('أمومة',    false, 10, 'مدتها وفق سياسة الشركة — يحدّدها المالك.'),
    ('تعويضية', true,  11, 'رصيدها من العمل الإضافي المعوَّض بإجازة (154).')
  ) v(name, bal, ord, descr)
 where not exists (select 1 from public.leave_types t where t.name = v.name);

alter table public.leave_ledger drop constraint if exists leave_ledger_kind_check;
alter table public.leave_ledger add constraint leave_ledger_kind_check
  check (kind in ('استحقاق شهري', 'استهلاك', 'ترحيل', 'تسوية يدوية', 'تعويض عمل إضافي'));

-- الإجازة الملغاة حالةٌ جديدة إلى جانب المعلقة والموافق عليها والمرفوضة
comment on column public.leaves.status is
  'معلقة | موافق عليها | مرفوضة | ملغاة (155). القرار عبر decide_leave ومحرّك الموافقات.';


-- ============================================================
-- ٢) حارس الطلب: السياسة قبل الإدخال
-- ============================================================
create or replace function public.guard_leave_policy()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.leave_types%rowtype;
  v_today date := public.baghdad_today();
begin
  select * into t from public.leave_types where name = new.leave_type;
  if not found then return new; end if;
  if not t.active then raise exception 'نوع الإجازة «%» موقوف', new.leave_type; end if;
  if public.can_manage_hr() then return new; end if;

  if t.max_days_per_request is not null and coalesce(new.days, 0) > t.max_days_per_request then
    raise exception 'أقصى إجازة % في الطلب الواحد % يوماً', new.leave_type, t.max_days_per_request;
  end if;
  if t.min_notice_days is not null and new.start_date - v_today < t.min_notice_days then
    raise exception 'إجازة % تُطلب قبل % يوماً على الأقل', new.leave_type, t.min_notice_days;
  end if;
  return new;
end $$;

drop trigger if exists trg_leaves_policy on public.leaves;
create trigger trg_leaves_policy
  before insert on public.leaves
  for each row execute function public.guard_leave_policy();


-- ============================================================
-- ٣) الطلب يدخل السلسلة
-- ============================================================
create or replace function public.leave_start_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_wf text;
  v_name text;
begin
  if new.status <> 'معلقة' then return null; end if;
  select coalesce(t.workflow_code, 'leave') into v_wf from public.leave_types t where t.name = new.leave_type;
  select e.full_name into v_name from public.employees e where e.id = new.employee_id;
  perform public.start_approval(coalesce(v_wf, 'leave'), 'leave', new.id, new.employee_id,
    'إجازة ' || new.leave_type || ' — ' || coalesce(v_name, '') || ' (' || public.leave_period_text(new) || ')',
    null, public.leave_consumed_days(new));
  return null;
end $$;

drop trigger if exists trg_leaves_approval_start on public.leaves;
create trigger trg_leaves_approval_start
  after insert on public.leaves
  for each row execute function public.leave_start_approval();

-- إشعار المدراء القديم: يبقى للإجازات التي لا سلسلة لها فقط (المحرّك ينبّه مُوافقيه)
create or replace function public.notify_leave_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
begin
  if exists (select 1 from public.approval_requests r
              where r.entity_type = 'leave' and r.entity_id = new.id and r.status = 'قيد الموافقة') then
    return new;
  end if;

  select full_name into emp_name from public.employees where id = new.employee_id;

  insert into public.notifications (user_id, title, body, link, kind, entity_id)
  select p.id,
         'طلب إجازة جديد',
         coalesce(emp_name, 'موظف') || ' يطلب إجازة ' || new.leave_type
           || ' — ' || public.leave_period_text(new),
         '/dashboard/hr/leaves',
         'إجازة',
         new.id
    from public.profiles p
   where p.role = 'admin';

  return new;
end; $$;

-- تغيير الحالة مباشرةً وفي الطلب سلسلة مفتوحة: لـ HR والمدير «تجاوزاً» فقط،
-- وتُغلق السلسلة بنتيجته. غيرهم يمرّ بـ decide_leave.
create or replace function public.guard_leave_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(current_setting('tilal.approval', true), '') = '1' then return new; end if;

  select r.id into v_req from public.approval_requests r
   where r.entity_type = 'leave' and r.entity_id = new.id and r.status = 'قيد الموافقة';
  if v_req is null then return new; end if;

  if not public.can_manage_hr() then
    raise exception 'الإجازة في سلسلة موافقة — القرار من «موافقاتي» أو decide_leave';
  end if;
  if exists (select 1 from public.employees e where e.id = new.employee_id and e.user_id = auth.uid()) then
    raise exception 'لا يوافق أحد على طلبه';
  end if;

  insert into public.approval_actions (request_id, decision, actor, actor_name, note)
  values (v_req, 'تجاوز', auth.uid(),
          coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام'),
          'تغيير مباشر للحالة إلى «' || new.status || '»');
  update public.approval_requests
     set status = case new.status when 'موافق عليها' then 'معتمد' when 'مرفوضة' then 'مرفوض' else 'ملغى' end,
         decided_at = now(), current_step = null
   where id = v_req;
  return new;
end $$;

drop trigger if exists trg_leaves_approval_guard on public.leaves;
create trigger trg_leaves_approval_guard
  before update of status on public.leaves
  for each row execute function public.guard_leave_status();


-- ============================================================
-- ٤) تطبيق النتيجة على الكيان — كل الأنواع
-- ============================================================
create or replace function public.approval_apply(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
begin
  select * into r from public.approval_requests where id = p_request;
  if r.status = 'قيد الموافقة' then return; end if;

  perform set_config('tilal.approval', '1', true);

  if r.entity_type = 'leave' then
    update public.leaves
       set status = case r.status when 'معتمد' then 'موافق عليها' when 'مرفوض' then 'مرفوضة' else 'ملغاة' end
     where id = r.entity_id and status = 'معلقة';

  elsif r.entity_type = 'attendance_request' then
    update public.attendance_requests set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_attendance_request(r.entity_id);
    end if;

  elsif r.entity_type = 'overtime_request' then
    update public.overtime_requests set status = r.status where id = r.entity_id;
    if r.status = 'معتمد' then
      perform public.apply_overtime_request(r.entity_id);
    end if;
  end if;

  perform set_config('tilal.approval', '', true);
end $$;

revoke all on function public.approval_apply(uuid) from public, anon, authenticated;


-- ============================================================
-- ٥) قرار الإجازة — نقطة الشاشات الثلاث
-- ============================================================
create or replace function public.decide_leave(p_leave uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.leaves%rowtype;
  v_req uuid;
begin
  select * into l from public.leaves where id = p_leave;
  if not found then raise exception 'الإجازة غير موجودة'; end if;
  if l.status <> 'معلقة' then raise exception 'الإجازة «%» لا تنتظر قراراً', l.status; end if;

  select r.id into v_req from public.approval_requests r
   where r.entity_type = 'leave' and r.entity_id = p_leave and r.status = 'قيد الموافقة';

  if v_req is not null then
    return public.approval_decide(v_req, p_approve, p_note);
  end if;

  -- طلب قديم بلا سلسلة: القاعدة القديمة — المدير وHR ومشرف الفريق، لا صاحبها
  if l.employee_id = public.my_employee_id() then raise exception 'لا يوافق أحد على طلبه'; end if;
  if not (public.can_manage_hr()
          or l.employee_id in (select m.id from public.my_scope_employees() m)) then
    raise exception 'ليس لك القرار في هذه الإجازة';
  end if;
  update public.leaves set status = case when p_approve then 'موافق عليها' else 'مرفوضة' end where id = p_leave;
  return case when p_approve then 'معتمد' else 'مرفوض' end;
end $$;

-- الموظف يسحب طلبه المعلّق
create or replace function public.cancel_my_leave(p_leave uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.leaves%rowtype;
  v_req uuid;
begin
  select * into l from public.leaves where id = p_leave;
  if not found then raise exception 'الإجازة غير موجودة'; end if;
  if l.employee_id is distinct from public.my_employee_id() and not public.can_manage_hr() then
    raise exception 'يسحب الطلبَ صاحبُه';
  end if;
  if l.status <> 'معلقة' then raise exception 'يُسحب الطلب المعلّق فقط (الحالة: %)', l.status; end if;

  select r.id into v_req from public.approval_requests r
   where r.entity_type = 'leave' and r.entity_id = p_leave and r.status = 'قيد الموافقة';
  if v_req is not null then
    perform public.cancel_approval(v_req, 'سحبه صاحبه');
  else
    perform set_config('tilal.approval', '1', true);
    update public.leaves set status = 'ملغاة' where id = p_leave;
    perform set_config('tilal.approval', '', true);
  end if;
end $$;


-- ============================================================
-- ٦) ترحيل الرصيد آخر السنة
-- ============================================================
create or replace function public.carry_forward_leave(p_year int default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_year int := coalesce(p_year, extract(year from public.baghdad_today())::int);
  e record; t record;
  v_bal numeric; v_carry numeric;
  n int := 0;
begin
  for t in select * from public.leave_types where active and carries_over loop
    for e in select id from public.employees where status = 'active' loop
      if exists (select 1 from public.leave_ledger l
                  where l.employee_id = e.id and l.leave_type_id = t.id and l.kind = 'ترحيل'
                    and l.entry_date = make_date(v_year, 1, 1)) then
        continue;
      end if;
      v_bal := public.leave_balance(e.id, t.id, v_year - 1);
      v_carry := least(v_bal, coalesce(t.carry_over_max_days, v_bal));
      if v_carry > 0 then
        insert into public.leave_ledger (employee_id, leave_type_id, entry_date, days, kind, note, created_by_name)
        values (e.id, t.id, make_date(v_year, 1, 1), v_carry, 'ترحيل',
                'ترحيل رصيد ' || (v_year - 1) || coalesce(' (بحدّ ' || t.carry_over_max_days || ')', ''), 'النظام');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

revoke all on function public.carry_forward_leave(int) from public, anon, authenticated;

-- أرصدة السنة لكل موظف ونوع — لشاشة HR
create or replace function public.leave_balances(p_year int default null)
returns table (employee_id uuid, full_name text, employee_code text, leave_type text, balance numeric,
               accrued numeric, consumed numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.employee_code, t.name,
         coalesce(sum(l.days), 0),
         coalesce(sum(l.days) filter (where l.days > 0), 0),
         coalesce(-sum(l.days) filter (where l.days < 0), 0)
    from public.employees e
    cross join public.leave_types t
    left join public.leave_ledger l on l.employee_id = e.id and l.leave_type_id = t.id
         and extract(year from l.entry_date)::int = coalesce(p_year, extract(year from public.baghdad_today())::int)
   where e.status = 'active' and t.active and (t.requires_balance or t.accrues_monthly)
     and (public.can_manage_hr() or e.id = public.my_employee_id())
   group by e.id, e.full_name, e.employee_code, t.name, t.sort_order
   order by e.full_name, t.sort_order;
$$;

-- الجدولة: الاستحقاق الشهري (موثَّق — كان في القاعدة بلا ملف) والترحيل السنوي
do $$
begin
  perform cron.unschedule('leave-monthly-accrual')
    where exists (select 1 from cron.job where jobname = 'leave-monthly-accrual');
  perform cron.schedule('leave-monthly-accrual', '10 0 1 * *', 'select public.accrue_monthly_leave();');

  perform cron.unschedule('leave-carry-forward')
    where exists (select 1 from cron.job where jobname = 'leave-carry-forward');
  -- 00:20 بتوقيت بغداد ليلة رأس السنة = 21:20 UTC يوم 31 ديسمبر. ساعتها
  -- baghdad_today() في السنة الجديدة أصلاً، فالترحيل إليها (الافتراضي).
  perform cron.schedule('leave-carry-forward', '20 21 31 12 *', 'select public.carry_forward_leave();');
end $$;


revoke all on function public.decide_leave(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_my_leave(uuid)             from public, anon;
revoke all on function public.leave_balances(int)               from public, anon;
grant execute on function public.decide_leave(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_my_leave(uuid)             to authenticated;
grant execute on function public.leave_balances(int)               to authenticated;

update public.app_modules set note = 'المرحلة 4: الإجازات عبر محرّك الموافقات (153، 155).' where code = 'leaves';
update public.app_modules set note = 'المرحلة 4: الورديات وطلبات الدوام والعمل الإضافي (154).' where code = 'attendance';
