-- ============================================================
-- تلال ERP — 208: توحيد الـCRM على رحلة العميل — التعريفات في كل مكان
--
-- مراجعة ما بعد 201–207 وجدت أماكن ما زالت على التعريفات القديمة:
--
--   1) «مفتوح» = «ليس بيع ولا فشل البيع» نصّاً ثابتاً في أربع دوال:
--      dashboard_my_summary · dashboard_attention · broker_dashboard_summary ·
--      unmatched_sales_employees. فـ«غير مؤهّل» و«تعذّر الوصول» (closed — 201)
--      تُعدّ مفتوحة: في «ليداتي النشطة»، و«تحتاج انتباهاً»، ولوحة الوسيط.
--      تصير: المرحلة ليست من نوع غير مفتوح في crm_stages — تعريفٌ من القاعدة.
--
--   2) معدّل التحويل في دوال «تحليل المبيعات» الخمس (crm_kpis ·
--      crm_team_performance · crm_source_performance · crm_sales_velocity ·
--      crm_target_progress) مقامه كل خسارة — ومنها ٥٢٨ «غير مؤهّل» و١١١
--      «لا يرد». يصير مقامه فوز + خسارة تجارية، كـWIN_RATE_COMMERCIAL (202).
--      ولذلك يحمل v_crm_opportunities عموداً جديداً loss_class.
--
--   3) قوالب التقارير النظامية تعرض CONVERSION_RATE وLOST_DEALS: تصير
--      WIN_RATE_COMMERCIAL والخسارة التجارية وغير التجارية، والقمع يعرض «حجز».
--      القوالب التي أنشأها المستخدمون لا تُمسّ.
--
-- آمن لإعادة التشغيل. المواضع تُطابَق بعد نزع \r من الطرفين.
-- ============================================================

-- (أ) صنف آخر خسارة للمسار — definer: الصنف رمزٌ لا يكشف شيئاً، وتجنّب RLS
--     صفّاً صفّاً على crm_lost_sales داخل العرض (درس 199: ٤ms للصفّ)
create or replace function public.crm_journey_loss_class(p_journey_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.crm_loss_class(l.customer_potential, l.reason_id, l.category_id)
    from public.crm_lost_sales l
   where l.opportunity_id = p_journey_id
   order by l.loss_no desc
   limit 1;
$$;
comment on function public.crm_journey_loss_class(uuid) is
  'صنف آخر خسارة للمسار: commercial | unqualified | unreachable | unanalysed (208).';
revoke all on function public.crm_journey_loss_class(uuid) from public, anon;
grant execute on function public.crm_journey_loss_class(uuid) to authenticated;

-- (ب) العرض: loss_class في آخره (create or replace يقبل الإضافة في الآخر)
do $v$
declare d text; d2 text;
begin
  d := replace(pg_get_viewdef('public.v_crm_opportunities'::regclass, true), E'\r', '');
  if position('loss_class' in d) = 0 then
    d2 := regexp_replace(d, $q$c\.qualified_at AS client_qualified_at(\s+)FROM$q$,
      $q$c.qualified_at AS client_qualified_at,
        CASE
            WHEN g.stage_type = 'lost'::text THEN crm_journey_loss_class(o.id)
            ELSE NULL::text
        END AS loss_class\1FROM$q$);
    if d2 = d then raise exception '208: لم يُعثر على موضع الإضافة في v_crm_opportunities'; end if;
    execute 'create or replace view public.v_crm_opportunities with (security_invoker = true) as '
            || rtrim(d2, E'; \n');
  end if;
end $v$;

-- (ج) معدّل التحويل في الدوال الخمس: مقامه فوز + خسارة تجارية
do $p$
declare
  fn text;
  d  text;
  d2 text;
begin
  foreach fn in array array['crm_kpis', 'crm_team_performance', 'crm_source_performance',
                            'crm_sales_velocity', 'crm_target_progress'] loop
    d := replace(pg_get_functiondef(('public.' || fn)::regproc), E'\r', '');
    if position('loss_class' in d) = 0 then
      d2 := regexp_replace(d, $q$([a-z])\.stage_type in \('won', ?'lost'\)$q$,
                              $q$(\1.stage_type = 'won' or \1.loss_class = 'commercial')$q$, 'g');
      if d2 = d then raise exception '208: لم يُعثر على مقام التحويل في %', fn; end if;
      execute d2;
    end if;
  end loop;
end $p$;

-- (د) «مفتوح» من القاعدة لا نصّاً ثابتاً
do $p$
declare
  fn text;
  d  text;
  d2 text;
begin
  foreach fn in array array['dashboard_my_summary', 'dashboard_attention',
                            'broker_dashboard_summary', 'unmatched_sales_employees'] loop
    d := replace(pg_get_functiondef(('public.' || fn)::regproc), E'\r', '');
    if position($q$not in ('بيع', 'فشل البيع')$q$ in d) > 0 then
      d2 := replace(d, $q$not in ('بيع', 'فشل البيع')$q$,
                       $q$not in (select g.name from public.crm_stages g where g.stage_type <> 'open')$q$);
      execute d2;
    end if;
  end loop;
end $p$;

-- (هـ) قوالب النظام
update public.crm_report_templates t
   set definition = replace(replace(replace(t.definition::text,
         '"CONVERSION_RATE"', '"WIN_RATE_COMMERCIAL"'),
         '"LOST_DEALS"', '"COMMERCIAL_LOST_DEALS", "NONCOMMERCIAL_LOST"'),
         '"OFFER_STAGE_ENTERED"', '"OFFER_STAGE_ENTERED", "RESERVATION_STAGE_ENTERED"')::jsonb,
       updated_at = now()
 where t.is_system
   and t.definition::text ~ '"CONVERSION_RATE"|"LOST_DEALS"|"OFFER_STAGE_ENTERED"'
   and t.definition::text !~ 'WIN_RATE_COMMERCIAL|COMMERCIAL_LOST_DEALS|RESERVATION_STAGE_ENTERED';

-- ===== التحقّق =====
do $$
declare n_lit int; n_tpl int; v jsonb;
begin
  select count(*) into n_lit from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
   where p.prosrc like $q$%not in ('بيع', 'فشل البيع')%$q$;
  select count(*) into n_tpl from public.crm_report_templates
   where is_system and definition::text ~ '"CONVERSION_RATE"|"LOST_DEALS"';
  select to_jsonb(k) into v from public.crm_kpis() k limit 1;
  raise notice '208: دوال بمفتوح نصّي: % (المتوقَّع 0) · قوالب نظام بالتعريف القديم: % (المتوقَّع 0) · crm_kpis: %',
    n_lit, n_tpl, v;
end $$;
