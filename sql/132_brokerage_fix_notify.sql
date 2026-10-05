-- ============================================================
-- تلال ERP — 132: إصلاح إشعار طلب الوسيط (128)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ عاجل: في 128 كانت notify_broker_request تكتب
--      v_sent := v_sent || 'مدير العلاقات'
--    و Postgres يقرأ النصّ الحرفي مع مصفوفة كأنه مصفوفةٌ أخرى، فيفشل
--    بـ «malformed array literal». الدالّة تُنادى من رفع الطلب، فكان كل طلب
--    حجز من وسيط يفشل منذ تطبيق 128. كشفه tests.run_brokerage().
--
-- الإصلاح: array_append بدل || — لا تغيير آخر. (صُحّح في 128 أيضاً.)
-- آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.notify_broker_request(
  p_id uuid, p_to text[], p_title text, p_extra text default null
)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  q record; v_body text; v_sent text[] := '{}'; n int; v_admins boolean;
begin
  select q0.*, bc.name as company_name, pr.name as project_name,
         rm.full_name as rm_name, rm.user_id as rm_user, sup.user_id as sup_user
    into q
    from public.broker_reservation_requests q0
    left join public.broker_companies bc on bc.id = q0.company_id
    left join public.projects pr on pr.id = q0.project_id
    left join public.employees rm  on rm.id  = q0.rm_id
    left join public.employees sup on sup.id = q0.supervisor_id
   where q0.id = p_id;
  if not found then return; end if;

  v_body := coalesce(q.company_name, '—')
    || ' · العميل ' || coalesce(q.client_name, '—')
    || ' · ' || coalesce(q.project_name, '—')
    || ' · الوحدة ' || coalesce(q.unit_code, '—')
    || ' · السعر ' || coalesce(public.fmt_qty(coalesce(q.requested_price, q.unit_price)), '—')
    || ' · ' || to_char(q.created_at at time zone 'Asia/Baghdad', 'YYYY-MM-DD')
    || ' · مدير العلاقات: ' || coalesce(q.rm_name, '—')
    || ' · الحالة: ' || q.status
    || coalesce(E'\n' || nullif(btrim(coalesce(p_extra, '')), ''), '');

  if 'broker' = any(p_to) then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    select bu.user_id, p_title, v_body, '/dashboard/broker/requests', 'حجز', p_id, 'broker_request', 'وساطة'
      from public.broker_users bu
     where bu.company_id = q.company_id and bu.is_active
       and bu.user_id is distinct from auth.uid();
    get diagnostics n = row_count;
    if n > 0 then v_sent := array_append(v_sent, 'الوسيط'); end if;
  end if;

  if 'rm' = any(p_to) and q.rm_user is not null and q.rm_user is distinct from auth.uid() then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    values (q.rm_user, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة');
    v_sent := array_append(v_sent, 'مدير العلاقات');
  end if;

  if 'supervisor' = any(p_to) and q.sup_user is not null
     and q.sup_user is distinct from auth.uid()
     and (q.sup_user is distinct from q.rm_user or not ('rm' = any(p_to))) then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category, priority)
    values (q.sup_user, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة', 'عالية');
    v_sent := array_append(v_sent, 'المشرف');
  end if;

  v_admins := 'admins' = any(p_to)
           or ('rm' = any(p_to) and q.rm_user is null)
           or ('supervisor' = any(p_to) and q.sup_user is null);
  if v_admins then
    insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
    select p.id, p_title, v_body, '/dashboard/brokers/requests/' || p_id, 'حجز', p_id, 'broker_request', 'وساطة'
      from public.profiles p
     where p.role = 'admin' and p.id is distinct from auth.uid()
       and p.id is distinct from q.rm_user and p.id is distinct from q.sup_user;
    get diagnostics n = row_count;
    if n > 0 then v_sent := array_append(v_sent, 'الإدارة'); end if;
  end if;

  if array_length(v_sent, 1) > 0 then
    perform public.log_broker_request_event(p_id, 'إشعار',
      p_title || ' ← ' || array_to_string(v_sent, '، '), false);
  end if;
end; $fn$;

revoke execute on function public.notify_broker_request(uuid, text[], text, text) from public, anon, authenticated;
