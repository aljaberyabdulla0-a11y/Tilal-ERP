-- ============================================================
-- تلال ERP — 130: تفاصيل الطلب، اللوحات، وتقارير الأداء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- كلها security definer تفحص النطاق بنفسها وتُرجع ما يخصّ السائل:
--   المدير الكل · الـRM شركاته · المشرف مشاريعه · الوسيط شركته.
-- السبب نفسه في 125 و 100: الوسيط لا يقرأ الحجوزات، والمشرف قد لا يقرأ بطاقة
-- ليد وسيط — فالتقرير بصلاحيات السائل كان سيُرجع صفراً لا خطأً.
--
-- ===== تعريفات =====
--   تاريخ البيع        = coalesce(sale_decided_at, created_at) للحجز «بيع مكتمل»
--   ليد الشركة          = عميلٌ أدخلته (broker_company_id أو returned_from)
--   ليد منتهٍ           = lead_transfers من الشركة إلى تلال (عودة بالمهلة)
--   فرصة ضائعة          = طلب مرفوض أو منتهٍ + حجز أُلغي
--   زمن المعالجة (RM)   = من رفع الطلب إلى أول فعلٍ للـRM (استلام أو مراجعة)
--   زمن الموافقة         = من رفع الطلب إلى القرار
--   الاسترداد (RM)      = ليدات شركاته العائدة لتلال ثم بيعت ÷ ليداتها العائدة
--
-- يتطلب: 128، 129. آمن لإعادة التشغيل.
-- ============================================================


-- ------------------------------------------------------------
-- 0) نطاق الشركات والمشاريع لكل سائل
-- ------------------------------------------------------------
create or replace function public.my_scope_broker_companies()
returns table (company_id uuid) language sql stable security definer set search_path = public as $fn$
  select b.id from public.broker_companies b where public.is_admin()
  union select public.my_broker_company() where public.my_broker_company() is not null
  union select m.company_id from public.my_rm_companies() m
  union select bcp.company_id from public.broker_company_projects bcp
         where bcp.project_id in (select s.id from public.my_supervised_projects() s);
$fn$;

create or replace function public.my_scope_projects()
returns table (project_id uuid) language sql stable security definer set search_path = public as $fn$
  select p.id from public.projects p where public.is_admin() or public.is_accountant()
  union select s.id from public.my_supervised_projects() s;
$fn$;


-- ------------------------------------------------------------
-- 1) تفاصيل طلب الحجز — كل ما يحتاجه القرار في نداء واحد
-- ------------------------------------------------------------
create or replace function public.broker_request_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  q       record;
  v_brk   boolean := public.my_broker_company() is not null;
  v_out   jsonb;
begin
  if not public.can_view_broker_request(p_id) then
    raise exception 'الطلب غير موجود';
  end if;

  select q0.*, bc.name as company_name, pr.name as project_name,
         rm.full_name as rm_name, sup.full_name as supervisor_name,
         u.unit_type, u.space_m2, u.status as unit_status, u.price as unit_price_now, u.node_path,
         c.stage as client_stage, c.created_at as client_created_at, c.broker_deadline,
         c.last_contact_at, c.contact_count, c.phone as client_phone_now
    into q
    from public.broker_reservation_requests q0
    left join public.broker_companies bc on bc.id = q0.company_id
    left join public.projects pr on pr.id = q0.project_id
    left join public.employees rm  on rm.id  = q0.rm_id
    left join public.employees sup on sup.id = q0.supervisor_id
    left join public.units u on u.id = q0.unit_id
    left join public.clients c on c.id = q0.client_id
   where q0.id = p_id;

  v_out := jsonb_build_object(
    'id', q.id, 'status', q.status, 'created_at', q.created_at,
    'status_changed_at', q.status_changed_at, 'expires_at', q.expires_at,
    'company_id', q.company_id, 'company_name', q.company_name,
    'requested_by_name', q.requested_by_name,
    'project_id', q.project_id, 'project_name', q.project_name,
    'rm_id', q.rm_id, 'rm_name', q.rm_name,
    'supervisor_id', q.supervisor_id, 'supervisor_name', q.supervisor_name,
    'unit_id', q.unit_id, 'unit_code', q.unit_code, 'unit_type', q.unit_type,
    'space_m2', q.space_m2, 'node_path', q.node_path, 'unit_status', q.unit_status,
    'unit_price', q.unit_price, 'unit_price_now', q.unit_price_now,
    'requested_price', q.requested_price,
    'discount', case when q.requested_price is not null and q.unit_price is not null
                     then q.unit_price - q.requested_price end,
    'discount_pct', case when q.requested_price is not null and coalesce(q.unit_price, 0) > 0
                         then round((q.unit_price - q.requested_price) / q.unit_price * 100, 2) end,
    'payment_plan', q.payment_plan,
    'note', q.note,
    'info_request', q.info_request, 'info_response', q.info_response,
    'decided_at', q.decided_at, 'decided_by_name', q.decided_by_name, 'decision_note', q.decision_note,
    'reservation_id', q.reservation_id, 'reservation_status', q.reservation_status,
    'client_id', q.client_id, 'client_name', q.client_name, 'client_phone', coalesce(q.client_phone_now, q.client_phone),
    'can_handle',  public.can_handle_broker_request(p_id),
    'can_approve', public.can_approve_broker_request(p_id),
    'can_review',  public.is_admin() or (q.rm_id is not null and q.rm_id = public.my_employee_id()),
    'is_broker',   v_brk
  );

  -- الداخلي لا يصل الوسيط: التوصية، تاريخ العميل في تلال، الطلبات الأخرى
  if not v_brk then
    v_out := v_out || jsonb_build_object(
      'rm_recommendation', q.rm_recommendation, 'rm_review_note', q.rm_review_note,
      'rm_reviewed_at', q.rm_reviewed_at, 'rm_reviewed_by_name', q.rm_reviewed_by_name,
      'handled_by_name', q.handled_by_name, 'handled_at', q.handled_at,
      'client', jsonb_build_object(
        'stage', q.client_stage, 'created_at', q.client_created_at,
        'broker_deadline', q.broker_deadline, 'last_contact_at', q.last_contact_at,
        'contact_count', q.contact_count),
      'client_activities', coalesce((
        select jsonb_agg(a order by a->>'created_at' desc) from (
          select jsonb_build_object('created_at', ca.occurred_at, 'type', ca.activity_type,
                                    'outcome', ca.outcome, 'note', ca.summary,
                                    'actor', ca.actor_name) as a
            from public.client_activities ca
           where ca.client_id = q.client_id
           order by ca.occurred_at desc limit 10) x), '[]'::jsonb),
      'client_reservations', coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'date', r.reservation_date,
                                            'unit_code', u2.unit_code, 'channel', r.sale_channel)
                         order by r.created_at desc)
          from public.reservations r left join public.units u2 on u2.id = r.unit_id
         where r.client_id = q.client_id), '[]'::jsonb),
      'other_requests', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'unit_code', o.unit_code,
                                            'created_at', o.created_at, 'company', ob.name)
                         order by o.created_at desc)
          from public.broker_reservation_requests o
          left join public.broker_companies ob on ob.id = o.company_id
         where o.id <> p_id
           and (o.client_id = q.client_id
                or (o.company_id = q.company_id and public.broker_request_is_open(o.status)))), '[]'::jsonb)
    );
  end if;

  v_out := v_out || jsonb_build_object('events', coalesce((
    select jsonb_agg(jsonb_build_object('at', e.at, 'actor_name', e.actor_name, 'actor_role', e.actor_role,
                                        'action', e.action, 'old_status', e.old_status,
                                        'new_status', e.new_status, 'note', e.note,
                                        'internal', not e.visible_to_broker)
                     order by e.at, e.id)
      from public.broker_request_events e
     where e.request_id = p_id and (e.visible_to_broker or not v_brk)), '[]'::jsonb));

  return v_out;
end; $fn$;


-- ------------------------------------------------------------
-- 2) لوحة الوسيط
-- ------------------------------------------------------------
create or replace function public.broker_dashboard_summary()
returns jsonb language sql stable security definer set search_path = public as $fn$
  with me as (select public.my_broker_company() as cid),
  today as (select (now() at time zone 'Asia/Baghdad')::date as d),
  leads as (
    select c.* from public.clients c, me
     where c.broker_company_id = me.cid and c.deleted_at is null),
  reqs as (select q.* from public.broker_reservation_requests q, me where q.company_id = me.cid),
  res as (select r.* from public.reservations r, me where r.broker_company_id = me.cid),
  led as (select l.* from public.commission_ledger l, me
           where l.recipient_type = 'وسيط' and l.recipient_id = me.cid and l.reversed_at is null)
  select case when (select cid from me) is null then null else jsonb_build_object(
    'leads',            (select count(*) from leads),
    'active_leads',     (select count(*) from leads where coalesce(stage, 'ليد') not in ('بيع', 'فشل البيع')),
    'expiring_leads',   (select count(*) from leads, today
                          where broker_deadline is not null and broker_deadline - today.d between 0 and 3
                            and coalesce(stage, 'ليد') not in ('بيع', 'فشل البيع')),
    'requests',         (select count(*) from reqs),
    'pending_requests', (select count(*) from reqs where public.broker_request_is_open(status)),
    'needs_info',       (select count(*) from reqs where status = 'بحاجة لمعلومات'),
    'rejected_requests',(select count(*) from reqs where status in ('مرفوض', 'منتهي')),
    'approved_reservations', (select count(*) from reqs where status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز')),
    'active_deals',     (select count(*) from res where status = 'حجز'),
    'completed_sales',  (select count(*) from res where status = 'بيع مكتمل'),
    'commission_earned',  (select coalesce(sum(amount), 0) from led),
    'commission_payable', (select coalesce(sum(balance), 0) from led where payable_at is not null),
    'commission_pending', (select coalesce(sum(balance), 0) from led where payable_at is null),
    'commission_paid',    (select coalesce(sum(paid_amount), 0) from led)
  ) end;
$fn$;


-- ------------------------------------------------------------
-- 3) لوحة المشرف — لكل مشروع أشرف عليه
-- ------------------------------------------------------------
create or replace function public.supervisor_broker_dashboard()
returns table (
  project_id uuid, project_name text,
  total_requests bigint, open_requests bigint, pending_approval bigint, needs_info bigint,
  approved_today bigint, rejected_today bigint, oldest_open_hours numeric,
  reservations bigint, sales bigint,
  units_available bigint, units_requested bigint, units_reserved bigint, units_sold bigint
)
language sql stable security definer set search_path = public as $fn$
  with today as (select (now() at time zone 'Asia/Baghdad')::date as d),
  pr as (
    select p.id, p.name from public.projects p
     where (public.is_admin() and exists (select 1 from public.broker_company_projects b where b.project_id = p.id))
        or p.id in (select s.id from public.my_supervised_projects() s)
  )
  select pr.id, pr.name,
    (select count(*) from public.broker_reservation_requests q where q.project_id = pr.id),
    (select count(*) from public.broker_reservation_requests q where q.project_id = pr.id and public.broker_request_is_open(q.status)),
    (select count(*) from public.broker_reservation_requests q where q.project_id = pr.id and q.status = 'بانتظار المشرف'),
    (select count(*) from public.broker_reservation_requests q where q.project_id = pr.id and q.status = 'بحاجة لمعلومات'),
    (select count(*) from public.broker_reservation_requests q, today
      where q.project_id = pr.id and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز')
        and (q.decided_at at time zone 'Asia/Baghdad')::date = today.d),
    (select count(*) from public.broker_reservation_requests q, today
      where q.project_id = pr.id and q.status = 'مرفوض'
        and (q.decided_at at time zone 'Asia/Baghdad')::date = today.d),
    (select round(extract(epoch from now() - min(q.created_at)) / 3600, 1)
       from public.broker_reservation_requests q
      where q.project_id = pr.id and public.broker_request_is_open(q.status)),
    (select count(*) from public.reservations r join public.units u on u.id = r.unit_id
      where u.project_id = pr.id and r.status = 'حجز' and r.sale_channel = 'وسيط'),
    (select count(*) from public.reservations r join public.units u on u.id = r.unit_id
      where u.project_id = pr.id and r.status = 'بيع مكتمل' and r.sale_channel = 'وسيط'),
    (select count(*) from public.units u where u.project_id = pr.id and u.status = 'متاحة'
        and not exists (select 1 from public.broker_reservation_requests q
                         where q.unit_id = u.id and public.broker_request_is_open(q.status))),
    (select count(*) from public.broker_reservation_requests q
      where q.project_id = pr.id and public.broker_request_is_open(q.status)),
    (select count(*) from public.units u where u.project_id = pr.id and u.status = 'محجوزة'),
    (select count(*) from public.units u where u.project_id = pr.id and u.status = 'مباعة')
  from pr
  order by pr.name;
$fn$;


-- ------------------------------------------------------------
-- 4) أداء الشركات الوسيطة
-- ------------------------------------------------------------
create or replace function public.broker_performance(
  p_from date default null, p_to date default null, p_project uuid default null
)
returns table (
  company_id uuid, company_name text, is_active boolean,
  leads bigint, qualified_leads bigint, expired_leads bigint,
  requests bigint, approved bigint, rejected bigint, expired_requests bigint,
  reservations bigint, sales bigint, conversion_rate numeric,
  sales_value numeric, commission numeric, avg_days_to_sale numeric,
  lost_opportunities bigint, rank bigint
)
language sql stable security definer set search_path = public as $fn$
  with rng as (
    select coalesce(p_from, date '2000-01-01') as f, coalesce(p_to, date '2999-12-31') as t
  ),
  co as (
    select b.id, b.name, b.is_active from public.broker_companies b
     where b.id in (select s.company_id from public.my_scope_broker_companies() s)
       and (p_project is null or exists (select 1 from public.broker_company_projects x
                                          where x.company_id = b.id and x.project_id = p_project))
  ),
  sold as (
    select r.broker_company_id as cid, r.id, r.client_id,
           coalesce(r.sale_price, u.price, 0) as val,
           (coalesce(r.sale_decided_at, r.created_at) at time zone 'Asia/Baghdad')::date as sold_on
      from public.reservations r join public.units u on u.id = r.unit_id, rng
     where r.status = 'بيع مكتمل' and r.sale_channel = 'وسيط'
       and (p_project is null or u.project_id = p_project)
       and (coalesce(r.sale_decided_at, r.created_at) at time zone 'Asia/Baghdad')::date between rng.f and rng.t
  ),
  base as (
    select co.id, co.name, co.is_active,
      (select count(*) from public.clients c, rng
        where coalesce(c.broker_company_id, c.returned_from) = co.id and c.deleted_at is null
          and (p_project is null or c.project_id = p_project)
          and (c.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as leads,
      (select count(*) from public.clients c, rng
        where coalesce(c.broker_company_id, c.returned_from) = co.id and c.deleted_at is null
          and c.qualified_at is not null
          and (p_project is null or c.project_id = p_project)
          and (c.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as qualified,
      (select count(*) from public.lead_transfers lt join public.clients c on c.id = lt.client_id, rng
        where lt.from_company_id = co.id and lt.to_company_id is null
          and (p_project is null or c.project_id = p_project)
          and (lt.moved_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as expired_leads,
      (select count(*) from public.broker_reservation_requests q, rng
        where q.company_id = co.id and (p_project is null or q.project_id = p_project)
          and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as requests,
      (select count(*) from public.broker_reservation_requests q, rng
        where q.company_id = co.id and (p_project is null or q.project_id = p_project)
          and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز')
          and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as approved,
      (select count(*) from public.broker_reservation_requests q, rng
        where q.company_id = co.id and (p_project is null or q.project_id = p_project)
          and q.status = 'مرفوض'
          and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as rejected,
      (select count(*) from public.broker_reservation_requests q, rng
        where q.company_id = co.id and (p_project is null or q.project_id = p_project)
          and q.status = 'منتهي'
          and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t) as expired_req,
      (select count(*) from public.reservations r join public.units u on u.id = r.unit_id, rng
        where r.broker_company_id = co.id and (p_project is null or u.project_id = p_project)
          and r.reservation_date between rng.f and rng.t) as reservations,
      (select count(*) from public.reservations r join public.units u on u.id = r.unit_id, rng
        where r.broker_company_id = co.id and r.status = 'ملغى'
          and (p_project is null or u.project_id = p_project)
          and r.reservation_date between rng.f and rng.t) as cancelled,
      (select count(*) from sold where sold.cid = co.id) as sales,
      (select coalesce(sum(val), 0) from sold where sold.cid = co.id) as sales_value,
      (select coalesce(sum(bc.amount), 0) from public.broker_commissions bc, rng
        where bc.company_id = co.id and bc.reversed_at is null
          and (p_project is null or bc.project_id = p_project)
          and bc.earned_at between rng.f and rng.t) as commission,
      (select round(avg(sold.sold_on - (c.created_at at time zone 'Asia/Baghdad')::date), 1)
         from sold join public.clients c on c.id = sold.client_id where sold.cid = co.id) as avg_days
    from co
  )
  select id, name, is_active, leads, qualified, expired_leads,
         requests, approved, rejected, expired_req, reservations, sales,
         case when leads > 0 then round(sales::numeric / leads * 100, 1) end,
         sales_value, commission, avg_days,
         rejected + expired_req + cancelled,
         rank() over (order by sales desc, sales_value desc, requests desc)
    from base
   order by 18, name;
$fn$;


-- ------------------------------------------------------------
-- 5) أداء مدراء العلاقات
-- ------------------------------------------------------------
create or replace function public.rm_performance(
  p_from date default null, p_to date default null, p_project uuid default null
)
returns table (
  rm_id uuid, rm_name text, companies bigint, leads bigint, requests bigint,
  reviewed bigint, avg_handling_hours numeric, reservations bigint, sales bigint,
  sales_value numeric, broker_commission numeric, rm_commission numeric,
  returned_leads bigint, recovered_leads bigint, recovery_rate numeric
)
language sql stable security definer set search_path = public as $fn$
  with rng as (
    select coalesce(p_from, date '2000-01-01') as f, coalesce(p_to, date '2999-12-31') as t
  ),
  rms as (
    select distinct bcp.rm_id as id from public.broker_company_projects bcp
     where bcp.rm_id is not null
       and (p_project is null or bcp.project_id = p_project)
       and (public.is_admin()
            or bcp.rm_id = public.my_employee_id()
            or bcp.project_id in (select s.id from public.my_supervised_projects() s))
  ),
  cos as (
    select bcp.rm_id, bcp.company_id, bcp.project_id from public.broker_company_projects bcp
     where bcp.rm_id in (select id from rms) and (p_project is null or bcp.project_id = p_project)
  )
  select e.id, e.full_name,
    (select count(distinct company_id) from cos where cos.rm_id = e.id),
    (select count(*) from public.clients c, rng
      where c.deleted_at is null
        and exists (select 1 from cos where cos.rm_id = e.id
                      and cos.company_id = coalesce(c.broker_company_id, c.returned_from)
                      and cos.project_id = c.project_id)
        and (c.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select count(*) from public.broker_reservation_requests q, rng
      where q.rm_id = e.id and (p_project is null or q.project_id = p_project)
        and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select count(*) from public.broker_reservation_requests q, rng
      where q.rm_id = e.id and q.rm_reviewed_at is not null and (p_project is null or q.project_id = p_project)
        and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select round(avg(extract(epoch from coalesce(q.rm_reviewed_at, q.handled_at) - q.created_at) / 3600)::numeric, 1)
       from public.broker_reservation_requests q, rng
      where q.rm_id = e.id and coalesce(q.rm_reviewed_at, q.handled_at) is not null
        and (p_project is null or q.project_id = p_project)
        and (q.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select count(*) from public.reservations r join public.units u on u.id = r.unit_id, rng
      where r.broker_rm_id = e.id and (p_project is null or u.project_id = p_project)
        and r.reservation_date between rng.f and rng.t),
    (select count(*) from public.reservations r join public.units u on u.id = r.unit_id, rng
      where r.broker_rm_id = e.id and r.status = 'بيع مكتمل' and (p_project is null or u.project_id = p_project)
        and (coalesce(r.sale_decided_at, r.created_at) at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select coalesce(sum(coalesce(r.sale_price, u.price, 0)), 0)
       from public.reservations r join public.units u on u.id = r.unit_id, rng
      where r.broker_rm_id = e.id and r.status = 'بيع مكتمل' and (p_project is null or u.project_id = p_project)
        and (coalesce(r.sale_decided_at, r.created_at) at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    (select coalesce(sum(bc.amount), 0)
       from public.broker_commissions bc join public.reservations r on r.id = bc.reservation_id, rng
      where r.broker_rm_id = e.id and bc.reversed_at is null
        and (p_project is null or bc.project_id = p_project)
        and bc.earned_at between rng.f and rng.t),
    (select coalesce(sum(sc.employee_amount), 0) from public.sale_commissions sc, rng
      where sc.employee_id = e.id and sc.employee_role = 'مدير علاقات' and sc.reversed_at is null
        and (p_project is null or sc.project_id = p_project)
        and (sc.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t),
    rt.returned, rt.recovered,
    case when rt.returned > 0 then round(rt.recovered::numeric / rt.returned * 100, 1) end
  from rms join public.employees e on e.id = rms.id
  cross join lateral (
    select count(*) as returned,
           count(*) filter (where exists (select 1 from public.reservations r
                                            where r.client_id = c.id and r.status = 'بيع مكتمل')) as recovered
      from public.clients c, rng
     where c.returned_from is not null
       and exists (select 1 from cos where cos.rm_id = e.id and cos.company_id = c.returned_from
                     and cos.project_id = c.project_id)
       and (c.returned_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t
  ) rt
  order by 9 desc, 2;
$fn$;


-- ------------------------------------------------------------
-- 6) أداء الموافقات — أين يختنق المسار؟
-- ------------------------------------------------------------
create or replace function public.supervisor_approval_performance(
  p_from date default null, p_to date default null
)
returns table (
  supervisor_id uuid, supervisor_name text, project_id uuid, project_name text,
  pending_now bigint, oldest_pending_hours numeric,
  decided bigint, approved bigint, rejected bigint, rejection_rate numeric,
  avg_approval_hours numeric, avg_wait_after_review_hours numeric,
  reservation_conversion numeric
)
language sql stable security definer set search_path = public as $fn$
  with rng as (
    select coalesce(p_from, date '2000-01-01') as f, coalesce(p_to, date '2999-12-31') as t
  ),
  pr as (
    select p.id, p.name, p.supervisor_id from public.projects p
     where exists (select 1 from public.broker_company_projects b where b.project_id = p.id)
       and (public.is_admin() or p.id in (select s.id from public.my_supervised_projects() s))
  ),
  q as (
    select q0.* from public.broker_reservation_requests q0, rng
     where (q0.created_at at time zone 'Asia/Baghdad')::date between rng.f and rng.t
  )
  select pr.supervisor_id, e.full_name, pr.id, pr.name,
    (select count(*) from public.broker_reservation_requests o
      where o.project_id = pr.id and public.broker_request_is_open(o.status)),
    (select round(extract(epoch from now() - min(o.created_at)) / 3600, 1)
       from public.broker_reservation_requests o
      where o.project_id = pr.id and public.broker_request_is_open(o.status)),
    (select count(*) from q where q.project_id = pr.id and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز', 'مرفوض')),
    (select count(*) from q where q.project_id = pr.id and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز')),
    (select count(*) from q where q.project_id = pr.id and q.status = 'مرفوض'),
    (select case when count(*) > 0
                 then round(count(*) filter (where q.status = 'مرفوض')::numeric / count(*) * 100, 1) end
       from q where q.project_id = pr.id and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز', 'مرفوض')),
    (select round(avg(extract(epoch from q.decided_at - q.created_at) / 3600)::numeric, 1)
       from q where q.project_id = pr.id and q.decided_at is not null
        and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز', 'مرفوض')),
    (select round(avg(extract(epoch from q.decided_at - q.rm_reviewed_at) / 3600)::numeric, 1)
       from q where q.project_id = pr.id and q.decided_at is not null and q.rm_reviewed_at is not null
        and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز', 'مرفوض')),
    (select case when count(*) > 0
                 then round(count(*) filter (where q.status = 'تمّ البيع')::numeric / count(*) * 100, 1) end
       from q where q.project_id = pr.id and q.status in ('تمّ الحجز', 'تمّ البيع', 'أُلغي الحجز'))
  from pr left join public.employees e on e.id = pr.supervisor_id
  order by 5 desc, 4;
$fn$;


-- ------------------------------------------------------------
-- 7) مباشر مقابل وسيط — لكل مشروع
-- ------------------------------------------------------------
create or replace function public.direct_vs_broker(p_from date default null, p_to date default null)
returns table (
  project_id uuid, project_name text,
  direct_sales bigint, direct_value numeric,
  broker_sales bigint, broker_value numeric,
  developer_commission numeric,
  direct_commission numeric, broker_commission numeric, rm_commission numeric,
  total_commission_cost numeric, net_commission numeric
)
language sql stable security definer set search_path = public as $fn$
  with rng as (
    select coalesce(p_from, date '2000-01-01') as f, coalesce(p_to, date '2999-12-31') as t
  ),
  pr as (select p.id, p.name from public.projects p
          where p.id in (select s.project_id from public.my_scope_projects() s)),
  sold as (
    select u.project_id, r.id, r.sale_channel, coalesce(r.sale_price, u.price, 0) as val
      from public.reservations r join public.units u on u.id = r.unit_id, rng
     where r.status = 'بيع مكتمل'
       and (coalesce(r.sale_decided_at, r.created_at) at time zone 'Asia/Baghdad')::date between rng.f and rng.t
  ),
  agg as (
    select pr.id, pr.name,
      (select count(*) from sold where sold.project_id = pr.id and sold.sale_channel = 'مباشر') as ds,
      (select coalesce(sum(val), 0) from sold where sold.project_id = pr.id and sold.sale_channel = 'مباشر') as dv,
      (select count(*) from sold where sold.project_id = pr.id and sold.sale_channel = 'وسيط') as bs,
      (select coalesce(sum(val), 0) from sold where sold.project_id = pr.id and sold.sale_channel = 'وسيط') as bv,
      (select coalesce(sum(sc.company_amount), 0) from public.sale_commissions sc
        where sc.reservation_id in (select id from sold where sold.project_id = pr.id) and sc.reversed_at is null) as dev,
      (select coalesce(sum(sc.employee_amount), 0) from public.sale_commissions sc
        where sc.reservation_id in (select id from sold where sold.project_id = pr.id)
          and sc.reversed_at is null and coalesce(sc.employee_role, 'موظف مباشر') = 'موظف مباشر') as dc,
      (select coalesce(sum(bc.amount), 0) from public.broker_commissions bc
        where bc.reservation_id in (select id from sold where sold.project_id = pr.id) and bc.reversed_at is null) as bc,
      (select coalesce(sum(sc.employee_amount), 0) from public.sale_commissions sc
        where sc.reservation_id in (select id from sold where sold.project_id = pr.id)
          and sc.reversed_at is null and sc.employee_role = 'مدير علاقات') as rc
    from pr
  )
  select id, name, ds, dv, bs, bv, dev, dc, bc, rc, dc + bc + rc, dev - (dc + bc + rc)
    from agg
   where ds + bs > 0 or id in (select b.project_id from public.broker_company_projects b)
   order by name;
$fn$;


-- ------------------------------------------------------------
-- 8) المنح
-- ------------------------------------------------------------
revoke execute on function public.my_scope_broker_companies()                 from public, anon;
revoke execute on function public.my_scope_projects()                         from public, anon;
revoke execute on function public.broker_request_detail(uuid)                 from public, anon;
revoke execute on function public.broker_dashboard_summary()                  from public, anon;
revoke execute on function public.supervisor_broker_dashboard()               from public, anon;
revoke execute on function public.broker_performance(date, date, uuid)        from public, anon;
revoke execute on function public.rm_performance(date, date, uuid)            from public, anon;
revoke execute on function public.supervisor_approval_performance(date, date) from public, anon;
revoke execute on function public.direct_vs_broker(date, date)                from public, anon;

grant execute on function public.my_scope_broker_companies()                 to authenticated;
grant execute on function public.my_scope_projects()                         to authenticated;
grant execute on function public.broker_request_detail(uuid)                 to authenticated;
grant execute on function public.broker_dashboard_summary()                  to authenticated;
grant execute on function public.supervisor_broker_dashboard()               to authenticated;
grant execute on function public.broker_performance(date, date, uuid)        to authenticated;
grant execute on function public.rm_performance(date, date, uuid)            to authenticated;
grant execute on function public.supervisor_approval_performance(date, date) to authenticated;
grant execute on function public.direct_vs_broker(date, date)                to authenticated;

notify pgrst, 'reload schema';
