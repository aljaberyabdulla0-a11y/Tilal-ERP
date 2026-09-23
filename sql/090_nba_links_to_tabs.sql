-- ============================================================
-- تلال ERP — 090: روابط «الإجراء التالي» تفتح تبويبها
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- صار ملفّ العميل تبويبات (§34)، فالمراسي (#units و#qualification)
-- لم تعد تصل إلى شيء: القسم المقصود مخفيٌّ خلف تبويب لا مطويٌّ في
-- الصفحة. ورابطٌ لا يصل أسوأ من رابط لا يوجد — يُنقر فلا يحدث شيء،
-- فيُظنّ العطل في النظام كله.
--
-- الآن `?tab=<المفتاح>` تفتح التبويب مباشرةً:
--
--     activity   التواصل    — نموذج التسجيل والتسلسل
--     deals      الصفقات    — التأهيل و«فرصة جديدة»
--     property   العقار     — الاهتمامات والحجز
--
-- ⚠️ الترتيب أدناه هو نفسه في 080 حرفياً — لم يتغيّر منطقٌ واحد،
--    الروابط وحدها. وأي تغيير في المنطق يُكتب هنا لا هناك.
--
-- يتطلب: 080. آمن لإعادة التشغيل.
-- ============================================================
create or replace function public.crm_next_best_action(p_client_id uuid)
returns table (
  priority   int,
  action     text,
  reason     text,
  link       text
)
language plpgsql stable set search_path = public as $$
declare
  c          public.clients%rowtype;
  days_quiet numeric;
  n_open     int;
  has_unit   boolean;
  has_res    boolean;
  neglect_d  int := public.crm_setting_int('neglected_days', 14);
begin
  select * into c from public.clients where id = p_client_id and deleted_at is null;
  if c.id is null then return; end if;

  days_quiet := extract(epoch from (now() - coalesce(c.last_contact_at, c.created_at))) / 86400.0;

  select count(*) into n_open
    from public.opportunities o join public.crm_stages g on g.id = o.stage_id
   where o.client_id = p_client_id and o.deleted_at is null and g.stage_type = 'open';

  select exists (select 1 from public.opportunities o
                  where o.client_id = p_client_id and o.deleted_at is null
                    and o.unit_id is not null) into has_unit;

  select exists (select 1 from public.reservations r
                  where r.client_id = p_client_id) into has_res;

  if not public.is_open_stage(c.stage) then
    if c.stage = 'فشل البيع' and exists (
         select 1 from public.opportunities o join public.crm_stages g on g.id = o.stage_id
          where o.client_id = p_client_id and g.stage_type = 'lost' and o.lost_reason_id is null)
    then
      return query select 1, 'سجّل سبب الخسارة',
        'الملفّ مغلق بلا سبب — بلا الأسباب لا نعرف لماذا نخسر.',
        '/dashboard/crm/opportunities?client=' || p_client_id::text;
    end if;
    return;
  end if;

  -- ——— ما يُفعل بالاتصال: تبويب التواصل حيث نموذج التسجيل ———
  if c.last_contact_at is null then
    return query select 1, 'اتّصل به — أول تواصل',
      'أُسنِد منذ ' || round(extract(day from now()
        - coalesce(c.owner_assigned_at, c.created_at))) || ' يوماً بلا تواصل واحد.',
      '/dashboard/clients/' || p_client_id::text || '?tab=activity';
    return;
  end if;

  if c.follow_up_date is not null and c.follow_up_date < public.baghdad_today() then
    return query select 1, 'تابِعه — الموعد فات',
      'موعد المتابعة كان ' || to_char(c.follow_up_date, 'YYYY-MM-DD') || '.',
      '/dashboard/clients/' || p_client_id::text || '?tab=activity';
    return;
  end if;

  if days_quiet > neglect_d and coalesce(c.lead_score, 0) >= 50 then
    return query select 1, 'اتّصل به — ليد قيّم يبرد',
      'درجته ' || c.lead_score || ' وصامت منذ ' || round(days_quiet) || ' يوماً.',
      '/dashboard/clients/' || p_client_id::text || '?tab=activity';
    return;
  end if;

  -- ——— ما يُفعل بالبيانات: تبويب الصفقات (التأهيل وفتح الفرصة) ———
  if n_open = 0 then
    return query select 2, 'افتح فرصة',
      'العميل في مرحلة «' || c.stage || '» ولا فرصة مسجّلة — لا يظهر في خطّ الأنابيب.',
      '/dashboard/clients/' || p_client_id::text || '?tab=deals';
    return;
  end if;

  if c.budget_min is null and c.budget_max is null then
    return query select 2, 'اسأل عن الميزانية',
      'بلا ميزانية لا تُطابَق وحدة ولا تُقاس جدّية الطلب.',
      '/dashboard/clients/' || p_client_id::text || '?tab=deals';
    return;
  end if;

  -- ——— ما يُفعل بالعقار: تبويب العقار (الاهتمامات والحجز) ———
  if not has_unit then
    return query select 2, 'اعرض عليه وحدات مناسبة',
      'ميزانيته معروفة ولم تُختَر وحدة — النظام يرشّح المطابق.',
      '/dashboard/clients/' || p_client_id::text || '?tab=property';
    return;
  end if;

  if has_unit and not has_res then
    return query select 2, 'ادفعه نحو الحجز',
      'اختار وحدة ولم يحجز — هذه أقصر مسافة متبقّية للبيع.',
      '/dashboard/clients/' || p_client_id::text || '?tab=property';
    return;
  end if;

  return query select 3, 'تابِع في موعده',
    coalesce('الموعد القادم ' || to_char(c.follow_up_date, 'YYYY-MM-DD'),
             'حدّد موعد المتابعة القادم.'),
    '/dashboard/clients/' || p_client_id::text || '?tab=activity';
end $$;

-- ------------------------------------------------------------
-- التحقّق — كل رابط يجب أن يحمل تبويباً أو يقصد شاشة أخرى
-- ------------------------------------------------------------
do $$
declare r record; n_bad int := 0; n_all int := 0;
begin
  raise notice '--- 090 روابط الإجراء التالي ---';
  for r in
    select (public.crm_next_best_action(c.id)).*
      from public.clients c
     where c.deleted_at is null and public.is_open_stage(c.stage)
     limit 50
  loop
    n_all := n_all + 1;
    if r.link like '/dashboard/clients/%' and r.link not like '%?tab=%' then
      n_bad := n_bad + 1;
      raise warning 'رابط بلا تبويب: %', r.link;
    end if;
  end loop;

  raise notice 'فُحص % رابطاً · بلا تبويب: %', n_all, n_bad;
  if n_bad = 0 then
    raise notice 'كل روابط ملفّ العميل تفتح تبويبها.';
  end if;
end $$;

notify pgrst, 'reload schema';
