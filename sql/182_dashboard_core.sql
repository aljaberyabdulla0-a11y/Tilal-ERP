-- ============================================================
-- تلال ERP — 182: دوال لوحة التحكم — المخزون والنشاط والتنبيهات وملخّصي
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل اختباراته (183):  select * from tests.run_dashboard();
--
-- ===== لماذا =====
--
-- اللوحة التنفيذية كانت تجلب units و payments و reservations كاملةً
-- وتجمعها في TypeScript. حدّ PostgREST ١٠٠٠ صفّ: بعده تنقص المبيعات
-- والعدّادات **بصمت** (الخلل نفسه الذي عالجته 112 في المحاسبة).
-- ولوحة الموظف تعدّ «عملائي» بـ created_by لا بالمالك owner_id، فالليد
-- المُسنَد أو المدموج (104، 169) لا يُحسب لصاحبه.
--
-- ===== ما يضيفه — أربع دوال قراءة، كلها security invoker =====
--
--   dashboard_units(project)
--     المخزون العقاري لكل مشروع: متاحة/محجوزة/مباعة/موقوفة، والحجوزات
--     القائمة، وقيمة المتاح بسعر القائمة. صفّ لكل مشروع — لا صفّ لكل وحدة.
--
--   dashboard_activity(limit, project, before)
--     سجلّ نشاط موحّد: أحداث الـCRM (crm_event_facts — ليد، إسناد، تواصل،
--     فوز، خسارة، حجز، بيع، مهمة) + الدفعات + طلبات حجز الوسطاء +
--     قرارات الموافقات + حركة المخزون. كل فرعٍ مقصوص بـlimit قبل الدمج.
--
--   dashboard_attention(project)
--     عدّادات «يحتاج انتباهك» التشغيلية في كائن واحد: طلبات بيع معلّقة،
--     حجوزات تنتهي، طلبات وسطاء مفتوحة، مهل ليدات الوسطاء، موافقات
--     تنتظرني، إجازات معلّقة، مواد ناقصة، مهام متأخرة.
--     (تنبيهات الـCRM — التوزيع والـSLA — تبقى من دوالّها في 073/075.)
--
--   dashboard_my_summary()
--     لوحة الموظف الشخصية: ليداتي (بالمالك)، حجوزاتي، مهامي، عمولاتي.
--
-- ===== الصلاحيات =====
--
-- security invoker عمداً: سياسات RLS هي التي تقرّر ما يُعدّ لكل دور،
-- ولا تفحص الدوال صلاحيةً بنفسها. المشرف يرى عدّادات مشروعه، والمدير
-- الكل، والوسيط لا يرى من الوحدات شيئاً (سياسة units). دالّةٌ تُضيف
-- فحصاً خاصاً بها تصير مصدرَ حقيقةٍ ثانياً — وهذا ما نتجنّبه.
--
-- «اليوم» بتوقيت بغداد في كل مكان.
--
-- يتطلب: 044، 050، 096، 117/128، 153. آمن لإعادة التشغيل.
-- ============================================================

-- ===== فهارس للقراءة الأحدث أولاً =====
create index if not exists crm_event_facts_at_idx
  on public.crm_event_facts (event_at desc) where not is_void;
create index if not exists payments_created_idx
  on public.payments (created_at desc);
create index if not exists inventory_moves_created_idx
  on public.inventory_moves (created_at desc);
create index if not exists approval_requests_status_idx
  on public.approval_requests (status, decided_at desc);
create index if not exists brr_created_idx
  on public.broker_reservation_requests (created_at desc);


-- ============================================================
-- ١) المخزون العقاري لكل مشروع
-- ============================================================
create or replace function public.dashboard_units(p_project_id uuid default null)
returns table (
  project_id uuid, project_name text,
  total bigint, available bigint, reserved bigint, sold bigint, blocked bigint,
  active_reservations bigint, available_value numeric, sold_list_value numeric
)
language sql stable security invoker set search_path = public as $$
  with u as (
    select u.id, u.project_id, u.project, u.status, u.price
      from public.units u
     where p_project_id is null or u.project_id = p_project_id
  ),
  r as (
    select u.project_id, count(*) n
      from public.reservations res
      join u on u.id = res.unit_id
     where res.status = 'حجز'
     group by u.project_id
  )
  select u.project_id,
         coalesce(p.name, min(u.project), 'بلا مشروع'),
         count(*),
         count(*) filter (where u.status = 'متاحة'),
         count(*) filter (where u.status = 'محجوزة'),
         count(*) filter (where u.status = 'مباعة'),
         count(*) filter (where u.status not in ('متاحة', 'محجوزة', 'مباعة')),
         coalesce(max(r.n), 0),
         coalesce(sum(u.price) filter (where u.status = 'متاحة'), 0),
         coalesce(sum(u.price) filter (where u.status = 'مباعة'), 0)
    from u
    left join public.projects p on p.id = u.project_id
    left join r on r.project_id is not distinct from u.project_id
   group by u.project_id, p.name
   order by count(*) desc;
$$;

comment on function public.dashboard_units(uuid) is
  'المخزون العقاري لكل مشروع (متاحة/محجوزة/مباعة/موقوفة + حجوزات قائمة + قيمة المتاح). security invoker — RLS تحدّد النطاق (sql/182).';


-- ============================================================
-- ٢) سجلّ النشاط الموحّد
--
-- كل فرعٍ يُقصّ بـlimit مرتّباً قبل الدمج، فلا يُقرأ جدولٌ كامل لعرض
-- عشرين سطراً. و p_before للصفحة التالية (أقدم من آخر سطر معروض).
-- ============================================================
create or replace function public.dashboard_activity(
  p_limit      int         default 20,
  p_project_id uuid        default null,
  p_before     timestamptz default null
)
returns table (
  at timestamptz, kind text, subtype text,
  entity text, entity_id uuid,
  client_id uuid, client_name text,
  project_id uuid, project_name text,
  actor_name text, amount numeric, detail text
)
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  return query
  with ev as (
    select f.event_at, f.event_type, f.event_subtype, f.source_table, f.source_id,
           f.client_id, f.opportunity_id, f.project_id, f.employee_id, f.value,
           f.activity_type, f.to_stage, f.to_stage_type
      from public.crm_event_facts f
     where not f.is_void
       and (p_before is null or f.event_at < p_before)
       and (p_project_id is null or f.project_id = p_project_id)
       and (
             f.event_type in ('lead_created', 'qualified', 'reservation', 'sale_completed',
                              'reservation_cancelled', 'task_completed', 'lead_returned')
          or (f.event_type = 'stage_change' and f.to_stage_type in ('won', 'lost'))
          or (f.event_type = 'assignment' and f.event_subtype = 'reassign')
          or (f.event_type = 'activity' and f.counts_as_contact)
       )
     order by f.event_at desc
     limit v_lim
  ),
  pay as (
    -- لحظة التسجيل لا تاريخ الدفعة: السجلّ «ما حدث في النظام»، والدفعة
    -- المؤرَّخة بالأمس وسُجّلت اليوم حدثُ اليوم.
    select p.created_at at_ts,
           p.id, p.amount, p.method, i.client_id, i.invoice_number, i.id invoice_id, p.created_by
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
     where (p_before is null or p.created_at < p_before)
       and (p_project_id is null or exists (
             select 1 from public.units un where un.id = i.unit_id and un.project_id = p_project_id))
     order by p.created_at desc
     limit v_lim
  ),
  brr as (
    select b.created_at, b.id, b.status, b.client_id, b.client_name, b.project_id,
           b.requested_by_name, b.unit_code, coalesce(b.requested_price, b.unit_price) price
      from public.broker_reservation_requests b
     where (p_before is null or b.created_at < p_before)
       and (p_project_id is null or b.project_id = p_project_id)
     order by b.created_at desc
     limit v_lim
  ),
  apr as (
    select a.decided_at, a.id, a.status, a.title, a.requested_by_name, a.entity_type, a.amount
      from public.approval_requests a
     where a.status in ('معتمد', 'مرفوض')
       and a.decided_at is not null
       and (p_before is null or a.decided_at < p_before)
       and p_project_id is null
     order by a.decided_at desc
     limit v_lim
  ),
  inv as (
    select m.created_at, m.id, m.kind, m.quantity, m.total_price, m.actor_name, m.item_id,
           it.name item_name, it.unit item_unit
      from public.inventory_moves m
      join public.inventory_items it on it.id = m.item_id
     where (p_before is null or m.created_at < p_before)
       and p_project_id is null
     order by m.created_at desc
     limit v_lim
  ),
  merged as (
    -- الإغلاق يُسمّى بنتيجته: won أو lost — لا «تغيير مرحلة» عامّاً
    select ev.event_at at_,
           case when ev.event_type = 'stage_change' then ev.to_stage_type else ev.event_type end kind_,
           coalesce(case ev.event_type
                      when 'activity'     then ev.activity_type
                      when 'stage_change' then ev.to_stage
                      else ev.event_subtype end, '') subtype_,
           case when ev.opportunity_id is not null and ev.event_type = 'stage_change' then 'opportunity'
                when ev.source_table = 'reservations' then 'reservation'
                when ev.source_table = 'tasks' then 'task'
                else 'client' end entity_,
           case when ev.opportunity_id is not null and ev.event_type = 'stage_change' then ev.opportunity_id
                when ev.source_table in ('reservations', 'tasks') then ev.source_id
                else ev.client_id end entity_id_,
           ev.client_id client_id_, ev.project_id project_id_,
           (select e.full_name from public.employees e where e.id = ev.employee_id) actor_,
           ev.value amount_, null::text detail_
      from ev
    union all
    select pay.at_ts, 'payment', coalesce(pay.method, ''), 'invoice', pay.invoice_id,
           pay.client_id, null::uuid,
           (select coalesce(em.full_name, pr.email) from public.profiles pr
              left join public.employees em on em.user_id = pr.id where pr.id = pay.created_by),
           pay.amount, pay.invoice_number
      from pay
    union all
    select brr.created_at, 'broker_request', brr.status, 'broker_request', brr.id,
           brr.client_id, brr.project_id, brr.requested_by_name, brr.price, brr.unit_code
      from brr
    union all
    select apr.decided_at, 'approval', apr.status, 'approval', apr.id,
           null::uuid, null::uuid, apr.requested_by_name, apr.amount, apr.title
      from apr
    union all
    select inv.created_at, 'inventory', inv.kind, 'inventory_item', inv.item_id,
           null::uuid, null::uuid, inv.actor_name, inv.total_price,
           inv.item_name || ' · '
             || trim(trailing '.' from to_char(inv.quantity, 'FM999999990.##'))
             || coalesce(' ' || inv.item_unit, '')
      from inv
  )
  select m.at_, m.kind_, m.subtype_, m.entity_, m.entity_id_,
         m.client_id_, c.name, m.project_id_, pj.name, m.actor_, m.amount_, m.detail_
    from (select * from merged order by at_ desc limit v_lim) m
    left join public.clients  c  on c.id  = m.client_id_
    left join public.projects pj on pj.id = m.project_id_
   order by m.at_ desc;
end;
$fn$;

comment on function public.dashboard_activity(int, uuid, timestamptz) is
  'سجلّ نشاط موحّد: أحداث CRM + دفعات + طلبات وسطاء + قرارات موافقات + حركة مخزون. كل فرع مقصوص قبل الدمج. security invoker (sql/182).';


-- ============================================================
-- ٣) «يحتاج انتباهك» — عدّادات تشغيلية
--
-- كل عدّاد يعدّ ما تسمح به RLS للمستدعي؛ فما لا يخصّ دوراً يرجع له
-- صفراً لا خطأً، والواجهة تُخفي الصفر.
-- ============================================================
create or replace function public.dashboard_attention(p_project_id uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_out   jsonb;
  v_appr  int := 0;
begin
  -- الموافقات التي تنتظر قراري — دالّتها (153) تعرف من المعتمِد في كل خطوة
  begin
    select count(*) into v_appr from public.my_pending_approvals() a where not a.is_override;
  exception when others then v_appr := 0;
  end;

  select jsonb_build_object(
    'today', v_today,
    'sale_requests_pending', (
      select count(*) from public.reservations r
        left join public.units u on u.id = r.unit_id
       where r.sale_request_status = 'معلّق'
         and (p_project_id is null or u.project_id = p_project_id)),
    'reservations_expiring', (
      select count(*) from public.reservations r
        left join public.units u on u.id = r.unit_id
       where r.status = 'حجز' and r.expiry_date between v_today and v_today + 3
         and (p_project_id is null or u.project_id = p_project_id)),
    'reservations_expired', (
      select count(*) from public.reservations r
        left join public.units u on u.id = r.unit_id
       where r.status = 'حجز' and r.expiry_date < v_today
         and (p_project_id is null or u.project_id = p_project_id)),
    'broker_requests_open', (
      select count(*) from public.broker_reservation_requests b
       where b.status in ('معلّق', 'قيد المتابعة', 'بحاجة لمعلومات', 'بانتظار المشرف')
         and (p_project_id is null or b.project_id = p_project_id)),
    'broker_requests_supervisor', (
      select count(*) from public.broker_reservation_requests b
       where b.status = 'بانتظار المشرف'
         and (p_project_id is null or b.project_id = p_project_id)),
    'broker_leads_expiring', (
      select count(*) from public.clients c
       where c.broker_company_id is not null and c.deleted_at is null and c.merged_into is null
         and c.broker_deadline between v_today and v_today + 3
         and coalesce(c.stage, '') not in ('بيع', 'فشل البيع')
         and (p_project_id is null or c.project_id = p_project_id)),
    'approvals_pending', v_appr,
    'leaves_pending', (select count(*) from public.leaves l where l.status = 'معلقة'),
    'inventory_low', (
      select count(*) from public.inventory_items i
       where i.is_active and i.min_quantity is not null and i.quantity <= i.min_quantity),
    'tasks_overdue', (
      select count(*) from public.tasks t
       where t.status in ('جديدة', 'قيد التنفيذ') and t.due_date < v_today)
  ) into v_out;

  return v_out;
end;
$fn$;

comment on function public.dashboard_attention(uuid) is
  'عدّادات «يحتاج انتباهك» التشغيلية كائناً واحداً — كلٌّ بما تسمح به RLS للمستدعي (sql/182).';


-- ============================================================
-- ٤) ملخّصي — لوحة الموظف الشخصية
--
-- «ليداتي» بالمالك owner_id لا بمن أدخلها created_by: الليد المُسنَد
-- إليّ أو المنقول إليّ بالدمج لي، والذي نُقل منّي ليس لي.
-- «حجوزاتي» بالوكيل agent_id (يُملأ تلقائياً بمُدخِله — 044).
-- ============================================================
create or replace function public.dashboard_my_summary()
returns jsonb
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Baghdad'))::date;
  v_emp   uuid := public.my_employee_id();
  v_uid   uuid := auth.uid();
begin
  return jsonb_build_object(
    'has_employee', v_emp is not null,
    'today', v_today,
    'leads_open', (
      select count(*) from public.clients c
       where v_emp is not null and c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null
         and coalesce(c.stage, '') not in ('بيع', 'فشل البيع')),
    'leads_total', (
      select count(*) from public.clients c
       where v_emp is not null and c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null),
    'leads_hot', (
      select count(*) from public.clients c
       where v_emp is not null and c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null
         and c.lead_temperature = 'ساخن' and coalesce(c.stage, '') not in ('بيع', 'فشل البيع')),
    'leads_new_month', (
      select count(*) from public.clients c
       where v_emp is not null and c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null
         and (c.created_at at time zone 'Asia/Baghdad')::date >= v_month),
    'followups_due', (
      select count(*) from public.clients c
       where v_emp is not null and c.owner_id = v_emp and c.deleted_at is null and c.merged_into is null
         and c.follow_up_date <= v_today and coalesce(c.stage, '') not in ('بيع', 'فشل البيع')),
    'reservations_active', (
      select count(*) from public.reservations r
       where r.status = 'حجز' and (r.agent_id = v_emp or (r.agent_id is null and r.created_by = v_uid))),
    'sales_month', (
      select count(*) from public.reservations r
       where r.status = 'بيع مكتمل'
         and (r.sale_decided_at at time zone 'Asia/Baghdad')::date >= v_month
         and (r.agent_id = v_emp or (r.agent_id is null and r.created_by = v_uid))),
    'sales_total', (
      select count(*) from public.reservations r
       where r.status = 'بيع مكتمل' and (r.agent_id = v_emp or (r.agent_id is null and r.created_by = v_uid))),
    'tasks_open', (
      select count(*) from public.tasks t
       where t.assigned_to = v_uid and t.status in ('جديدة', 'قيد التنفيذ')),
    'tasks_overdue', (
      select count(*) from public.tasks t
       where t.assigned_to = v_uid and t.status in ('جديدة', 'قيد التنفيذ') and t.due_date < v_today),
    'tasks_today', (
      select count(*) from public.tasks t
       where t.assigned_to = v_uid and t.status in ('جديدة', 'قيد التنفيذ') and t.due_date = v_today),
    'tasks_done_today', (
      select count(*) from public.tasks t
       where t.assigned_to = v_uid and t.completed_at is not null
         and (t.completed_at at time zone 'Asia/Baghdad')::date = v_today),
    'commission_total', (
      select coalesce(sum(cm.amount), 0) from public.commissions cm
       where v_emp is not null and cm.employee_id = v_emp),
    'commission_month', (
      select coalesce(sum(cm.amount), 0) from public.commissions cm
       where v_emp is not null and cm.employee_id = v_emp and cm.comm_date >= v_month),
    'commission_unpaid', (
      select coalesce(sum(cm.amount), 0) from public.commissions cm
       where v_emp is not null and cm.employee_id = v_emp and cm.payroll_id is null)
  );
end;
$fn$;

comment on function public.dashboard_my_summary() is
  'لوحة الموظف: ليداتي بالمالك owner_id، حجوزاتي بالوكيل، مهامي، عمولاتي — بتوقيت بغداد (sql/182).';


revoke all on function public.dashboard_units(uuid)                         from public, anon;
revoke all on function public.dashboard_activity(int, uuid, timestamptz)    from public, anon;
revoke all on function public.dashboard_attention(uuid)                     from public, anon;
revoke all on function public.dashboard_my_summary()                        from public, anon;
grant execute on function public.dashboard_units(uuid)                      to authenticated, service_role;
grant execute on function public.dashboard_activity(int, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.dashboard_attention(uuid)                  to authenticated, service_role;
grant execute on function public.dashboard_my_summary()                     to authenticated, service_role;

notify pgrst, 'reload schema';
