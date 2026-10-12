-- ============================================================
-- تلال ERP — 204: مطابقة ترحيل رحلة العميل (للقراءة فقط)
--
--   select public.crm_journey_reconcile();
--
-- يقارن الإحصاء القبلي والبعدي المحفوظين في crm_journey_migration_runs
-- (201) بالحالة الآن، ويفحص الثوابت التي يجب أن تبقى صحيحة دائماً:
--   • لا فرق بين البطاقة ومسارها، ولا عميل بلا مسار، ولا حجز بلا مسار
--   • الترحيل لم يُغيّر عدد الخسائر ولا المبيعات ولا العمولات ولا الحجوزات
--   • الأحداث زادت بمقدار صفوف «الدخول الأول» المضافة لا غير
-- ويُرجع ok = false مع الفروق إن اختلّ شيء.
-- ============================================================

create or replace function public.crm_journey_reconcile()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b   jsonb;
  a   jsonb;
  n   jsonb;
  bad jsonb := '[]'::jsonb;
begin
  if not (public.is_admin() or auth.uid() is null) then
    raise exception 'المطابقة للمدير.' using errcode = '42501';
  end if;

  select counts into b from public.crm_journey_migration_runs where phase = '201:before' order by at desc limit 1;
  select counts into a from public.crm_journey_migration_runs where phase = '201:after'  order by at desc limit 1;
  n := public.crm_journey_counts();

  if b is null or a is null then
    return jsonb_build_object('ok', false, 'issues', jsonb_build_array('الترحيل 201 لم يُسجَّل بعد'), 'now', n);
  end if;

  -- ثوابت دائمة
  if (n->>'drift')::int <> 0 then bad := bad || jsonb_build_array('فروق البطاقة/المسار: ' || (n->>'drift')); end if;
  if (n->>'clients_no_journey')::int <> 0 then bad := bad || jsonb_build_array('عملاء بلا مسار: ' || (n->>'clients_no_journey')); end if;
  if (n->>'reservations_unlinked')::int <> 0 then bad := bad || jsonb_build_array('حجوزات بلا مسار: ' || (n->>'reservations_unlinked')); end if;
  if (n->>'journeys_without_initial')::int <> 0 then bad := bad || jsonb_build_array('مسارات بلا دخول أول: ' || (n->>'journeys_without_initial')); end if;

  -- الترحيل نفسه لم يمسّ المال ولا الخسائر
  if (a->>'lost_rows') <> (b->>'lost_rows') then bad := bad || jsonb_build_array('تغيّر عدد الخسائر أثناء الترحيل'); end if;
  if (a->>'completed_sales') <> (b->>'completed_sales') then bad := bad || jsonb_build_array('تغيّر عدد المبيعات أثناء الترحيل'); end if;
  if (a->>'sale_commissions') <> (b->>'sale_commissions') then bad := bad || jsonb_build_array('تغيّر عدد العمولات أثناء الترحيل'); end if;
  if (a->>'reservations') <> (b->>'reservations') then bad := bad || jsonb_build_array('تغيّر عدد الحجوزات أثناء الترحيل'); end if;
  if (a->>'clients') <> (b->>'clients') or (a->>'journeys') <> (b->>'journeys') then
    bad := bad || jsonb_build_array('تغيّر عدد العملاء أو المسارات أثناء الترحيل');
  end if;
  if (a->>'card_stages') <> (b->>'card_stages') then bad := bad || jsonb_build_array('تغيّر توزيع مراحل البطاقات أثناء الترحيل'); end if;
  if (a->>'facts')::int - (b->>'facts')::int <> (a->>'initial_rows_added')::int then
    bad := bad || jsonb_build_array(format('الأحداث زادت %s والمتوقَّع %s (صفوف الدخول الأول)',
                                           (a->>'facts')::int - (b->>'facts')::int, a->>'initial_rows_added'));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(bad) = 0,
    'issues', bad,
    'before', b,
    'after', a,
    'now', n);
end $$;

comment on function public.crm_journey_reconcile() is
  'مطابقة ترحيل 201: الإحصاء القبلي والبعدي والآن + الثوابت (لا فرق، لا عميل بلا مسار، المال والخسائر لم تتغيّر) (204).';
revoke all on function public.crm_journey_reconcile() from public, anon;
grant execute on function public.crm_journey_reconcile() to authenticated;

do $$
declare v jsonb;
begin
  v := public.crm_journey_reconcile();
  raise notice '204: ok = % · issues = %', v->>'ok', v->'issues';
end $$;
