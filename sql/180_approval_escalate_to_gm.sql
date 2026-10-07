-- ============================================================
-- تلال ERP — 180: التصعيد في منتصف السلسلة يصل للمدير العام (المرحلة 10)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- يتطلب: 153، 157.
--
-- ============================================================
-- الخلل (موجود منذ 153، كشفه تدقيق المرحلة 10):
--
-- قاعدة المحرّك «المستوى الذي لا مُوافِق له يُصعَّد لا يُتخطّى» كانت تُطبَّق
-- عند بدء الطلب فقط. أمّا بعد موافقة مستوى، فإن لم يجد ما بعده مُوافِقاً
-- (لا أحد بدور HR مثلاً) اعتُمد الطلب فوراً.
--
-- على القاعدة الحيّة: لا أحد يحمل دور HR، فكل إجازة وطلب دوام وعمل إضافي
-- يعتمده المدير المباشر يُعتمد نهائياً دون أن يمرّ بـ HR ولا بالمدير العام.
--
-- الإصلاح: إن بقيت بعد المستوى الحالي مستويات تنطبق على الطلب وكلها بلا
-- مُوافِق، يبقى الطلب «قيد الموافقة» وينتقل للمدير العام (current_step = null
-- ⇒ approval_current_approvers تُرجع المدراء). ولا يُعتمد إلا إن لم يبقَ
-- مستوى ينطبق.
--
-- أثره: حتى يُعيَّن «مدير HR»، تصل للمدير العام كل طلبات الإجازة والدوام
-- والعمل الإضافي بعد موافقة المدير المباشر. ليعود الاعتماد عند المدير
-- المباشر وحده: احذف مستوى HR من السلسلة في «إعدادات HR ← سلاسل الموافقة».
-- ============================================================

create or replace function public.approval_decide(p_request uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
  v_label text;
  v_next int;
  v_override boolean;
  v_who text := coalesce(public.my_employee_name(), public.display_name(auth.uid()), 'النظام');
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'قيد الموافقة' then raise exception 'الطلب «%» لا ينتظر قراراً', r.status; end if;
  if exists (select 1 from public.employees e where e.id = r.subject_employee and e.user_id = auth.uid())
     or r.requested_by = auth.uid() then   -- (157)
    raise exception 'لا يوافق أحد على طلبه';
  end if;
  if not public.can_act_on_approval(p_request) then
    raise exception 'ليس لك القرار في هذه المرحلة من الطلب';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الرفض إلزامي';
  end if;

  v_override := not exists (select 1 from public.approval_current_approvers(p_request) a where a.user_id = auth.uid());
  select st.label into v_label from public.approval_steps st
   where st.workflow_code = r.workflow_code and st.step_no = r.current_step;

  insert into public.approval_actions (request_id, step_no, step_label, decision, actor, actor_name, note)
  values (p_request, r.current_step, coalesce(v_label, 'المدير'),
          case when not p_approve then 'رفض' when v_override then 'تجاوز' else 'موافقة' end,
          auth.uid(), v_who, nullif(btrim(p_note), ''));

  if not p_approve then
    update public.approval_requests set status = 'مرفوض', decided_at = now() where id = p_request;
  elsif v_override or r.current_step is null then
    update public.approval_requests set status = 'معتمد', decided_at = now(), current_step = null where id = p_request;
  else
    v_next := public.approval_advance(p_request, r.current_step);
    if v_next is null and exists (
         select 1 from public.approval_steps st
          where st.workflow_code = r.workflow_code and st.step_no > r.current_step
            and not ((st.min_amount is not null and coalesce(r.amount, 0) < st.min_amount)
                  or (st.min_days is not null and coalesce(r.days, 0) < st.min_days))) then
      -- (180) بقيت مستويات تنطبق وكلها بلا مُوافِق: صُعِّدت ⇒ القرار للمدير العام
      update public.approval_requests set current_step = null where id = p_request;
      perform public.approval_notify_current(p_request);
      return 'قيد الموافقة';
    elsif v_next is null then
      update public.approval_requests set status = 'معتمد', decided_at = now(), current_step = null where id = p_request;
    else
      update public.approval_requests set current_step = v_next where id = p_request;
      perform public.approval_notify_current(p_request);
      return 'قيد الموافقة';
    end if;
  end if;

  perform public.approval_apply(p_request);

  select * into r from public.approval_requests where id = p_request;
  insert into public.notifications (user_id, title, body, link, kind, entity_id, entity_type, category)
  select e.user_id, r.title || ': ' || r.status, coalesce(nullif(btrim(p_note), ''), 'بواسطة ' || v_who),
         '/dashboard/me/requests', 'موافقة', r.id, 'approval_request', 'HR'
    from public.employees e
   where e.id = r.subject_employee and e.user_id is not null and e.user_id is distinct from auth.uid()
     and r.entity_type <> 'leave';

  return r.status;
end $$;

revoke all on function public.approval_decide(uuid, boolean, text) from public, anon;
grant execute on function public.approval_decide(uuid, boolean, text) to authenticated, service_role;
