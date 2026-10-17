-- ============================================================
-- تلال ERP — 215: مشرف المبيعات يصحّح الحملة جماعةً لعملاء فريقه
--
-- الطلب (٢٠٢٦-١٠-١٧): صلاحية «تغيير الحملة» (214) لمشرف المبيعات أيضاً.
--
-- نطاقه: عملاء فريقه وحدهم — نفس ما يعدّله مفرداً بسياسة «update own
--   clients»: ما أنشأه، أو مالكه/موظف مبيعاته من my_scope_employees()
--   (هو ومن في مشاريعه). عميلٌ خارج فريقه يُعدّ في «رُفض» بسببه ولا
--   يُسقط الدفعة. مدير التسويق والمدير على الكل كما في 214.
--
-- النطاق يُحسب مرّة للدفعة لا لكل صفّ (درس 211).
-- آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.bulk_set_campaign(
  p_client_ids  uuid[],
  p_campaign_id uuid
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid    uuid;
  v_old  uuid;
  v_all  boolean;
  v_emps uuid[];
  v_keys text[];
  n_ok   int := 0;
  n_bad  int := 0;
  err    text;
begin
  if public.is_broker() then
    raise exception 'تغيير الحملة جماعةً غير متاح للوسطاء.';
  end if;
  v_all := public.is_marketing_manager();
  if not v_all and not public.is_supervisor() then
    raise exception 'تغيير الحملة جماعةً لمدير التسويق ومشرف المبيعات والإدارة — صحّح العميل مفرداً من نموذج تعديله.';
  end if;
  if array_length(p_client_ids, 1) is null then
    raise exception 'لم تُختَر صفوف.';
  end if;
  if array_length(p_client_ids, 1) > 500 then
    raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.';
  end if;
  if p_campaign_id is not null
     and not exists (select 1 from public.crm_campaigns where id = p_campaign_id) then
    raise exception 'حملة غير معروفة.';
  end if;

  if not v_all then
    v_emps := array(select s.id from public.my_scope_employees() s);
    v_keys := array(select k.name_key from public.my_scope_name_keys() k);
  end if;

  foreach cid in array p_client_ids loop
    begin
      select c.campaign_id into v_old
        from public.clients c
       where c.id = cid and c.deleted_at is null
         and (v_all
              or c.created_by = auth.uid()
              or c.owner_id = any(v_emps)
              or (c.sales_employee is not null and public.name_key(c.sales_employee) = any(v_keys)))
       for update;
      if not found then
        raise exception 'العميل غير موجود أو خارج فريقك.';
      end if;
      if v_old is not distinct from p_campaign_id then
        raise exception 'العميل على هذه الحملة أصلاً.';
      end if;

      update public.clients set campaign_id = p_campaign_id where id = cid;

      update public.crm_event_facts set campaign_id = p_campaign_id
       where client_id = cid and campaign_id is not distinct from v_old;

      update public.crm_lost_sales l set campaign_id = p_campaign_id
        from public.opportunities o
       where o.id = l.opportunity_id and o.client_id = cid
         and l.campaign_id is not distinct from v_old;

      n_ok := n_ok + 1;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;

  return query select n_ok, n_bad, err;
end $$;

comment on function public.bulk_set_campaign(uuid[], uuid) is
  'نقل صفوف مختارة إلى حملة (أو بلا حملة) — تصحيح إدخال. مدير التسويق والإدارة على الكل، ومشرف المبيعات على عملاء فريقه (215). يصحّح معها crm_event_facts و crm_lost_sales التي حملت الحملة القديمة (214).';

revoke all on function public.bulk_set_campaign(uuid[], uuid) from public, anon;
grant execute on function public.bulk_set_campaign(uuid[], uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
