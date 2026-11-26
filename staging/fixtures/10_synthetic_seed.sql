-- ════════════════════════════════════════════════════════════════════════
-- Tilal ERP — بيانات اختبار اصطناعية لـ STAGING فقط
-- التشغيل: staging\run-sql.ps1 -File staging\fixtures\10_synthetic_seed.sql   (معاملة واحدة: أي خطأ يُلغي الكل)
-- يفترض: الاستعادة (3-restore) + مستخدمي الاختبار (4-create-test-users) — يُطابقهم بالبريد @staging.tilal.invalid.
--
-- كل الأسماء والهواتف وهمية: الهواتف 07700000xxx (نطاق محجوز للاختبار في فاحص التصدير).
-- يمرّ عبر دوال النظام الحقيقية (close_opportunity_lost، reactivate_lost_opportunity، assign_client)
-- كي تكون السجلات كما ينتجها النظام، لا إدراجاً مباشراً يتجاوز قواعده.
--
-- السيناريوهات (staging/README.md §٦):
--   S1  فريقان (مشروعان) بمشرفين وأربعة بائعين — «الفريق» و«الزميل» في التضارب
--   S2  أعضاء جودة محتملون من HR والتسويق والعمليات والإدارة
--   S3  ٤٠ عميلاً بسجلّ متابعات: نتائج منظّمة + ملاحظات خام فيها أسعار وخصومات وخطط دفع (اختبار Q9)
--   S4  ١٢ خسارة حديثة (منها ٤ «لا يمكن الوصول») + ٨ تاريخية بتواريخ قديمة (اختبار الدفعة Q7) + ١ مُعاد تنشيطها
--   S5  تضارب: عميل أنشأه موظف التسويق، عميل سجّل عليه موظف CRM ومدير العمليات نشاطاً، عميل نُقل من ب2 إلى أ1
--   S6  أقسام بلا مدير (Q8): مدير لقسم إدارة المبيعات فقط
-- ════════════════════════════════════════════════════════════════════════
select staging_meta.assert_staging();

create or replace function staging_meta.uid(p_key text) returns uuid language sql stable as $$
  select id from auth.users where email = replace(p_key, '_', '-') || '@staging.tilal.invalid'
$$;
create or replace function staging_meta.emp(p_key text) returns uuid language sql stable as $$
  select e.id from public.employees e where e.user_id = staging_meta.uid(p_key)
$$;
create or replace function staging_meta.act_as(p_key text) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', staging_meta.uid(p_key), 'role', 'authenticated')::text, true);
$$;
-- أقرب يوم ليس جمعة (قاعدة 225)
create or replace function staging_meta.workday(p date) returns date language sql immutable as $$
  select case when extract(isodow from p) = 5 then p + 1 else p end
$$;

do $seed$
declare
  u record;
  v_proj_a uuid; v_proj_b uuid;
  v_emp uuid; v_client uuid; v_opp uuid;
  v_owner_key text; v_n int := 0; v_i int;
  v_reason record; v_unreach record;
  v_stage_contact uuid;
  v_keys text[] := array['sales_a1','sales_a2','sales_b1','sales_b2'];
  v_notes text[] := array[
    'اتصلت به وعرضت عليه شقة ١٢٠ م بسعر ١٤٥ مليون مع خصم ٣٪ إن دفع نقداً',
    'طلب خطة دفع: مقدمة ٢٠٪ والباقي على ٣٦ شهراً، قلت له القسط ٣.٢ مليون',
    'العميل يقارن بمشروع منافس سعر المتر عندهم ١.٠٥ مليون',
    'لم يرد، سأعاود الاتصال',
    'مهتم بالطابق الثالث، ينتظر راتبه',
    'يريد زيارة الموقع مع زوجته يوم السبت',
    'رفض العمولة الإضافية للوسيط وطلب التعامل مباشرة',
    'قال إن الميزانية لا تتجاوز ١٠٠ مليون'];
  v_outcomes text[] := array['تم التواصل','لم يرد','مهتم','مؤجل','غير مهتم'];
begin
  perform staging_meta.assert_staging();
  if (select count(*) from auth.users where email like '%@staging.tilal.invalid') < 16 then
    raise exception 'شغّل 4-create-test-users.ps1 أولاً (16 مستخدماً)';
  end if;
  if exists (select 1 from public.clients where phone like '07700000%') then
    raise exception 'البيانات الاصطناعية موجودة مسبقاً — أعد بناء staging بدل تكرارها';
  end if;

  -- ── الأدوار ─────────────────────────────────────────────
  for u in select * from jsonb_to_recordset(
      '[{"k":"gm","r":"general_manager"},{"k":"hr_mgr","r":"hr_manager"},{"k":"hr_off","r":"hr_officer"},
        {"k":"mkt_mgr","r":"marketing_manager"},{"k":"mkt_emp","r":"marketing_employee"},{"k":"ops_mgr","r":"operations_manager"},
        {"k":"admin_off","r":"employee"},{"k":"fin_mgr","r":"finance_manager"},{"k":"sales_mgr","r":"sales_manager"},
        {"k":"sup_a","r":"supervisor"},{"k":"sup_b","r":"supervisor"},{"k":"sales_a1","r":"sales_employee"},
        {"k":"sales_a2","r":"sales_employee"},{"k":"sales_b1","r":"sales_employee"},{"k":"sales_b2","r":"sales_employee"},
        {"k":"crm_emp","r":"crm_employee"}]'::jsonb) as x(k text, r text)
  loop
    update public.profiles set role_code = u.r where id = staging_meta.uid(u.k);
    if not found then raise exception 'لا ملف تعريف للمستخدم %', u.k; end if;
  end loop;

  -- ── المشروعان (S1) ──────────────────────────────────────
  insert into public.projects (name) values ('مشروع اختبار أ') returning id into v_proj_a;
  insert into public.projects (name) values ('مشروع اختبار ب') returning id into v_proj_b;

  -- ── الموظفون ────────────────────────────────────────────
  for u in select * from jsonb_to_recordset(
      '[{"k":"gm","n":"مدير عام اختبار","d":"EXEC","p":"GM","pr":null},
        {"k":"hr_mgr","n":"مدير HR اختبار","d":"HR","p":"HR-MGR","pr":null},
        {"k":"hr_off","n":"موظف HR اختبار","d":"HR","p":"HR-OFF","pr":null},
        {"k":"mkt_mgr","n":"مدير تسويق اختبار","d":"MKT-MGMT","p":"MKT-MGR","pr":null},
        {"k":"mkt_emp","n":"موظف تسويق اختبار","d":"MKT-CONTENT","p":"MKT-WRITER","pr":null},
        {"k":"ops_mgr","n":"مدير عمليات اختبار","d":"OPS","p":"OPS-MGR","pr":null},
        {"k":"admin_off","n":"موظف إدارة اختبار","d":"ADMIN","p":"ADMIN-OFF","pr":null},
        {"k":"fin_mgr","n":"مدير مالي اختبار","d":"FIN","p":"FIN-MGR","pr":null},
        {"k":"sales_mgr","n":"مدير مبيعات اختبار","d":"SALES-MGMT","p":"SALES-MGR","pr":null},
        {"k":"sup_a","n":"مشرف مبيعات أ","d":"SALES-MGMT","p":"SALES-SUP","pr":"A"},
        {"k":"sup_b","n":"مشرف مبيعات ب","d":"SALES-MGMT","p":"SALES-SUP","pr":"B"},
        {"k":"sales_a1","n":"بائع أ1","d":"SALES-AGENTS","p":"SALES-AGENT","pr":"A"},
        {"k":"sales_a2","n":"بائع أ2","d":"SALES-AGENTS","p":"SALES-AGENT","pr":"A"},
        {"k":"sales_b1","n":"بائع ب1","d":"SALES-AGENTS","p":"SALES-AGENT","pr":"B"},
        {"k":"sales_b2","n":"بائع ب2","d":"SALES-AGENTS","p":"SALES-AGENT","pr":"B"},
        {"k":"crm_emp","n":"موظف CRM اختبار","d":"CRM","p":"CRM-SPEC","pr":null}]'::jsonb)
      as x(k text, n text, d text, p text, pr text)
  loop
    v_n := v_n + 1;
    insert into public.employees (user_id, full_name, department_id, position_id, project_id, hire_date,
                                  base_salary, phone, email, status)
    values (staging_meta.uid(u.k), u.n,
            (select id from public.departments where code = u.d),
            (select id from public.positions where code = u.p),
            case u.pr when 'A' then v_proj_a when 'B' then v_proj_b end,
            date '2026-01-04', 1000000, '07700000' || lpad(v_n::text, 3, '0'),
            replace(u.k, '_', '-') || '@staging.tilal.invalid', 'active');
  end loop;

  -- التبعية الإدارية: البائع ← مشرفه ← مدير المبيعات ← المدير العام؛ والبقية ← المدير العام
  update public.employees set manager_id = staging_meta.emp('sup_a')     where id in (staging_meta.emp('sales_a1'), staging_meta.emp('sales_a2'));
  update public.employees set manager_id = staging_meta.emp('sup_b')     where id in (staging_meta.emp('sales_b1'), staging_meta.emp('sales_b2'));
  update public.employees set manager_id = staging_meta.emp('sales_mgr') where id in (staging_meta.emp('sup_a'), staging_meta.emp('sup_b'));
  update public.employees set manager_id = staging_meta.emp('gm')
   where id in (staging_meta.emp('sales_mgr'), staging_meta.emp('hr_mgr'), staging_meta.emp('mkt_mgr'),
                staging_meta.emp('ops_mgr'), staging_meta.emp('fin_mgr'), staging_meta.emp('admin_off'), staging_meta.emp('crm_emp'));
  update public.employees set manager_id = staging_meta.emp('hr_mgr')  where id = staging_meta.emp('hr_off');
  update public.employees set manager_id = staging_meta.emp('mkt_mgr') where id = staging_meta.emp('mkt_emp');

  update public.projects set supervisor_id = staging_meta.emp('sup_a') where id = v_proj_a;
  update public.projects set supervisor_id = staging_meta.emp('sup_b') where id = v_proj_b;
  -- العضوية: الأساسي ضمن العضويات (216) — إن لم يُنشئها المحفّز
  insert into public.employee_projects (employee_id, project_id)
  select e.id, e.project_id from public.employees e where e.project_id is not null on conflict do nothing;

  -- S6: مدير لقسم إدارة المبيعات فقط؛ بقية الأقسام بلا مدير (مسار المدير العام — Q8)
  update public.departments set manager_id = staging_meta.emp('sales_mgr') where code = 'SALES-MGMT';

  -- ── العملاء والمتابعات (S3) ─────────────────────────────
  v_n := 0;
  for v_i in 1..40 loop
    v_owner_key := v_keys[1 + (v_i - 1) % 4];
    v_emp := staging_meta.emp(v_owner_key);
    insert into public.clients (name, phone, owner_id, sales_employee, project_id, created_by, source, entry_date)
    values ('عميل اختبار ' || lpad(v_i::text, 3, '0'), '07700000' || lpad((100 + v_i)::text, 3, '0'), v_emp,
            (select full_name from public.employees where id = v_emp),
            case when v_owner_key like 'sales_a%' then v_proj_a else v_proj_b end,
            -- S5: العميل ٥ أنشأه موظف التسويق
            case when v_i = 5 then staging_meta.uid('mkt_emp') else staging_meta.uid(v_owner_key) end,
            'اختبار', current_date - 60)
    returning id into v_client;

    for v_n in 1..(2 + v_i % 3) loop
      insert into public.client_activities (client_id, created_by, actor_name, activity_type, direction, outcome,
                                            occurred_at, duration_min, summary, next_action, next_action_date)
      values (v_client, staging_meta.uid(v_owner_key), (select full_name from public.employees where id = v_emp),
              case when v_n % 3 = 0 then 'واتساب' else 'مكالمة' end, 'صادر',
              v_outcomes[1 + (v_i + v_n) % 5],
              now() - make_interval(days => 40 - v_n * 7), 2 + v_n,
              v_notes[1 + (v_i * 3 + v_n) % 8],
              case when v_n = 1 then 'إرسال عرض السعر والخصم' else 'متابعة' end,
              staging_meta.workday(current_date + 1 + (v_i % 20)));
    end loop;
  end loop;

  -- S5: مشاركون في معالجة الحالة من خارج المبيعات
  insert into public.client_activities (client_id, created_by, actor_name, activity_type, summary, next_action_date)
  select c.id, staging_meta.uid('crm_emp'), 'موظف CRM اختبار', 'ملاحظة', 'تحقق من بيانات العميل',
         staging_meta.workday(current_date + 3)
    from public.clients c where c.name = 'عميل اختبار 007';
  insert into public.client_activities (client_id, created_by, actor_name, activity_type, summary, next_action_date)
  select c.id, staging_meta.uid('ops_mgr'), 'مدير عمليات اختبار', 'ملاحظة', 'تنسيق زيارة الموقع',
         staging_meta.workday(current_date + 4)
    from public.clients c where c.name = 'عميل اختبار 007';

  -- S5: نقل العميل ١٢ من ب2 إلى أ1 (مالك سابق) عبر دالة الإسناد
  perform staging_meta.act_as('gm');
  perform public.assign_client((select id from public.clients where name = 'عميل اختبار 012'),
                               staging_meta.emp('sales_a1'), 'اختبار staging: مالك سابق', 'manual');

  -- ── الخسائر (S4) ────────────────────────────────────────
  select r.id, r.category_id into v_unreach
    from public.crm_lost_reasons r join public.crm_loss_categories k on k.id = r.category_id
   where r.is_active and r.outcome_class = 'unreachable' and not k.requires_competitor
   order by r.sort_order limit 1;
  if v_unreach.id is null then raise exception 'لا سبب «لا يمكن الوصول» فعّال في بيانات الإعداد'; end if;

  for v_i in 1..21 loop
    select o.id, c.owner_id into v_opp, v_emp
      from public.clients c join public.opportunities o on o.client_id = c.id and o.closed_at is null
     where c.name = 'عميل اختبار ' || lpad(v_i::text, 3, '0') limit 1;
    if v_opp is null then raise exception 'لا فرصة مفتوحة للعميل %', v_i; end if;

    select r.id, r.category_id into v_reason
      from public.crm_lost_reasons r join public.crm_loss_categories k on k.id = r.category_id
     where r.is_active and coalesce(r.outcome_class, '') <> 'unreachable' and not coalesce(r.is_other, false)
       and not coalesce(r.requires_note, false) and not k.requires_competitor
     order by r.sort_order offset (v_i % 6) limit 1;

    perform set_config('request.jwt.claims',
      json_build_object('sub', (select user_id from public.employees where id = v_emp), 'role', 'authenticated')::text, true);
    perform public.close_opportunity_lost(v_opp, jsonb_build_object(
      'category_id', case when v_i in (3, 6, 9, 12) then v_unreach.category_id else v_reason.category_id end,
      'reason_id',   case when v_i in (3, 6, 9, 12) then v_unreach.id          else v_reason.id end,
      'details', 'تحليل اختبار: العميل وجد السعر ١٥٠ مليون مرتفعاً مقارنة بالمنافس'));
  end loop;

  -- ٨ تاريخية (13..20): قبل تاريخ التفعيل بأشهر — لمراجعة الدفعة اليدوية
  update public.crm_lost_sales l
     set lost_at = now() - make_interval(days => 90 + (right(c.name, 3)::int) * 5)
    from public.opportunities o join public.clients c on c.id = o.client_id
   where l.opportunity_id = o.id and right(c.name, 3)::int between 13 and 20;

  -- ١ مُعادة التنشيط (21) عبر الدالة القائمة
  select id into v_stage_contact from public.crm_stages where name = 'اتصال' and is_active limit 1;
  perform staging_meta.act_as('sup_a');
  perform public.reactivate_lost_opportunity(
    (select o.id from public.opportunities o join public.clients c on c.id = o.client_id
      where c.name = 'عميل اختبار 021' order by o.created_at desc limit 1),
    v_stage_contact, 'اختبار staging: إعادة تنشيط', 'اتصال متابعة', staging_meta.workday(current_date + 2));

  perform set_config('request.jwt.claims', '', true);
end $seed$;

-- ── الملخّص ──────────────────────────────────────────────
select 'employees' k, count(*)::text v from public.employees
union all select 'clients', count(*)::text from public.clients where phone like '07700000%'
union all select 'activities', count(*)::text from public.client_activities
union all select 'lost_sales', count(*)::text from public.crm_lost_sales
union all select 'lost_unreachable', count(*)::text from public.crm_lost_sales l join public.crm_lost_reasons r on r.id = l.reason_id where r.outcome_class = 'unreachable'
union all select 'lost_historical(>60d)', count(*)::text from public.crm_lost_sales where lost_at < now() - interval '60 days'
union all select 'reactivated', count(*)::text from public.crm_lost_sales where outcome = 'reactivated'
union all select 'departments_with_manager', count(*)::text from public.departments where manager_id is not null
union all select 'open_tasks', count(*)::text from public.tasks where status in ('جديدة', 'قيد التنفيذ');
