-- ============================================================
-- تلال ERP — 214: تغيير الحملة التسويقية جماعةً
--
-- الطلب (٢٠٢٦-١٠-١٧): من شريط الإجراءات الجماعية في قائمة العملاء
--   تُنقل ليداتٌ مختارة من حملة إلى أخرى دفعةً واحدة — لتصحيح أخطاء
--   إدخال موظفي المبيعات.
--
-- مَن: مدير التسويق والمدير وحدهما (is_marketing_manager() يشمل المدير).
--   الحملة إسنادٌ تسويقي: تكلفة الليد وعائد الحملة يُحسبان منه، فتصحيحه
--   بالجملة لمن يملك أرقام التسويق. والموظف يبقى يصحّح عميله مفرداً من
--   نموذج التعديل كما كان.
--
-- ما يُصحَّح مع العميل — النسخ التي أخذت الحملة الخاطئة منه:
--   • crm_event_facts: أحداث العميل (ليد، تواصل، مرحلة…) تحمل بُعد الحملة
--     يوم وقوعها، وهو هنا نسخةٌ من الخطأ — فتقارير «حسب الحملة» تتبع.
--   • crm_lost_sales: سجلّ «فشل البيع» يأخذ الحملة يوم الخسارة (140).
--   يُغيَّر فيهما ما كان على الحملة القديمة وحدها، لا غيره.
--   ولا تُمسّ crm_snapshot_rows: اللقطة صورة يومٍ مضى عمداً.
--
-- كل صفّ يمرّ وحده (مثل 085): ما يُرفض يُعدّ ويُسمّى سببه ولا يُسقط
-- الدفعة، و audit_row على clients يكتب لكل عميل الحملةَ القديمة والجديدة
-- ومَن غيّرها.
--
-- p_campaign_id = null ← «بلا حملة» (لليد سُجّل على حملة لم يأتِ منها).
-- آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.bulk_set_campaign(
  p_client_ids  uuid[],
  p_campaign_id uuid
) returns table (succeeded int, failed int, first_error text)
language plpgsql security definer set search_path = public as $$
declare
  cid   uuid;
  v_old uuid;
  n_ok  int := 0;
  n_bad int := 0;
  err   text;
begin
  if public.is_broker() or not public.is_marketing_manager() then
    raise exception 'تغيير الحملة جماعةً لمدير التسويق والإدارة — صحّح العميل مفرداً من نموذج تعديله.';
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

  foreach cid in array p_client_ids loop
    begin
      select c.campaign_id into v_old
        from public.clients c
       where c.id = cid and c.deleted_at is null
       for update;
      if not found then
        raise exception 'العميل غير موجود أو محذوف.';
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
  'نقل صفوف مختارة إلى حملة (أو بلا حملة) — تصحيح إدخال. لمدير التسويق والإدارة. يصحّح معها crm_event_facts و crm_lost_sales التي حملت الحملة القديمة (214).';

revoke all on function public.bulk_set_campaign(uuid[], uuid) from public, anon;
grant execute on function public.bulk_set_campaign(uuid[], uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
