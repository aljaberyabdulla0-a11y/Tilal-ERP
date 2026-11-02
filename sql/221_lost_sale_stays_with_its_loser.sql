-- ============================================================
-- تلال ERP — 221: فشل البيع على من وصل معه الزبون إليه — إنهاء الخدمة
--                 لا يحمّله للموظف المستلِم
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الطلب (2026-11-02): «عند إنهاء خدمات موظف تنتقل عملاؤه إلى موظف آخر،
--   لكن إذا كان العميل واصل مرحلة فشل البيع لا يُحتسب على الموظف الذي
--   نُقل إليه بل على الموظف الذي وصل معه الزبون إلى فشل البيع».
--
-- السبب (قيس على الحيّة):
--   (أ) استمارات فشل البيع تنتقل للمستلِم: 177 جعلت مالك البطاقة الحالي
--       ثاني من تُسند إليه استمارة خسارةٍ غادر صاحبها، و handover_employee
--       ينقل كل مهام المغادر المفتوحة للمستلِم ومعها الاستمارات، ومحفّز
--       نقل البطاقة (219) كذلك. اليوم عند عبدالله ٢٠ استمارة لخسارات نوران
--       وعند خالد ٩ لخسارات منار — كلها متأخرة منذ 10-14 وتُعدّ في مهامهما
--       المتأخرة.
--   (ب) لندا ← ندى (2026-08-31، قبل 071): الترحيل 071 سجّل ندى مالكةً
--       للبطاقات من يوم إنشائها، فنُسبت لندى ٢٠ خسارة وقعت عند لندا قبل
--       التسليم، و١٣ خسارة أعادت ندى تسجيلها يوم 10-06 (فتحت الفرصة
--       الخاسرة وأغلقتها خلال ثوانٍ لتملأ الاستمارة) — كلها في تقاريرها
--       وصفحة الخسائر.
--   ما كان سليماً: في تسليمَي نوران (09-27) ومنار (10-04) بقيت الخسارة
--   نفسها لصاحبتها — crm_lost_sales.owner_id والفرصة المغلقة (187)
--   وحقائق التقارير.
--
-- الحلّ:
--   (١) الاستمارة لمن خسر: مالك الخسارة ما دام على رأس عمله. إن غادر
--       لا تُسند لأحد وتبقى الخسارة «بلا تحليل» باسمه — يكملها المشرف أو
--       المدير من صفحة الخسائر إن شاء. الخسارة القديمة بلا مالك تبقى على
--       سلسلة 177 (مالك البطاقة ← من سجّلها ← المشرف).
--   (٢) إنهاء الخدمة يُلغي استمارات المغادر المفتوحة قبل نقل بطاقاته
--       (فلا يحملها محفّز 219 للمستلِم)، ويُرجع عددها.
--   (٣) «إعادة تواصل» من تحليل خسارةٍ غادر صاحبها تذهب لمالك البطاقة
--       الحالي لا لحسابٍ مُغلق — متابعةٌ للعميل لا احتسابٌ للخسارة.
--   (٤) تصحيح البيانات: إلغاء الاستمارات المفتوحة لخسارات من غادروا،
--       ونسبة خسائر لندا الـ٣٣ إليها مع فرصها وأحداث مراحلها ولقطاتها.
--   (٥) tests.run_lost_analysis_tasks: حالة «مالك الفرصة ترك العمل» تتبع (١).
--
-- ما لا يتغيّر: البطاقة نفسها تنتقل للمستلِم (يتابعها ويعيد تنشيطها،
--   وما يبيعه أو يخسره بعدها له). والنقل بين موظفَين على رأس عملهما
--   كما في 219.
--
-- يتطلب: 175، 177، 219. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الاستمارة لمن خسر — لا لمن انتقلت إليه البطاقة
-- ------------------------------------------------------------
create or replace function public.crm_lost_analysis_assignee(p_lost uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    -- (221) للخسارة مالك: هو وحده، ما دام على رأس عمله. غادر ← لا أحد،
    -- وتبقى «بلا تحليل» باسمه.
    when l.owner_id is not null then
      (select e.user_id from public.employees e
        where e.id = l.owner_id and e.status = 'active' and e.user_id is not null)
    -- خسارة قديمة بلا مالك: سلسلة 177
    else coalesce(
      (select e.user_id from public.employees e
         join public.opportunities o on o.id = l.opportunity_id
         join public.clients c on c.id = o.client_id
        where e.id = c.owner_id and e.status = 'active' and e.user_id is not null),
      (select e.user_id from public.employees e
        where e.user_id = l.lost_by and e.status = 'active'
        order by e.created_at limit 1),
      (select e.user_id from public.employees e
        where e.id = l.manager_id and e.status = 'active' and e.user_id is not null))
  end
  from public.crm_lost_sales l
  where l.id = p_lost;
$$;

-- ------------------------------------------------------------
-- 2) إنهاء الخدمة: استمارات المغادر تُلغى قبل نقل بطاقاته
-- ------------------------------------------------------------
-- handover_employee الحيّة بثلاثة تعديلات نصّية مُتحقَّق منها.
do $patch$
declare
  f text := pg_get_functiondef('public.handover_employee(uuid,uuid,text,boolean,boolean,date)'::regprocedure);
  old1 text := E'  v_locked  text;\n';
  new1 text := E'  v_locked  text;\n'
            || E'  n_lostf   int := 0;\n';
  old2 text := E'  -- ===== العملاء =====\n';
  new2 text := E'  -- ===== استمارات فشل البيع (221) =====\n'
            || E'  -- الخسارة تبقى على من خسرها: استمارته المفتوحة تُلغى ولا تنتقل\n'
            || E'  -- للمستلِم. قبل نقل العملاء، فلا يحملها محفّز نقل البطاقة (219).\n'
            || E'  if p_end_service and f.user_id is not null then\n'
            || E'    perform set_config(''tilal.lost_task_sync'', ''on'', true);\n'
            || E'    update public.tasks\n'
            || E'       set status = ''ملغاة'',\n'
            || E'           cancellation_reason = ''انتهت خدمة '' || f.full_name\n'
            || E'             || '' — تبقى الخسارة باسمه ولا تنتقل استمارتها إلى '' || t.full_name\n'
            || E'     where assigned_to = f.user_id\n'
            || E'       and analysis_lost_sale_id is not null\n'
            || E'       and status in (''جديدة'', ''قيد التنفيذ'');\n'
            || E'    get diagnostics n_lostf = row_count;\n'
            || E'    perform set_config(''tilal.lost_task_sync'', '''', true);\n'
            || E'  end if;\n'
            || E'\n'
            || E'  -- ===== العملاء =====\n';
  old3 text := E'    ''payrolls_removed'', n_pr_del\n';
  new3 text := E'    ''payrolls_removed'', n_pr_del,\n'
            || E'    ''lost_forms_cancelled'', n_lostf\n';
begin
  f := replace(f, chr(13), '');
  if strpos(f, 'استمارات فشل البيع (221)') > 0 then
    raise notice '221: handover_employee مُعدّلة سابقاً';
    return;
  end if;
  if (length(f) - length(replace(f, old1, ''))) / length(old1) <> 1 then
    raise exception '221: نصّ «v_locked» في handover_employee غير موجود مرّة واحدة';
  end if;
  if (length(f) - length(replace(f, old2, ''))) / length(old2) <> 1 then
    raise exception '221: نصّ «===== العملاء =====» في handover_employee غير موجود مرّة واحدة';
  end if;
  if (length(f) - length(replace(f, old3, ''))) / length(old3) <> 1 then
    raise exception '221: نصّ «payrolls_removed» في handover_employee غير موجود مرّة واحدة';
  end if;
  execute replace(replace(replace(f, old1, new1), old2, new2), old3, new3);
end $patch$;

-- ------------------------------------------------------------
-- 3) «إعادة تواصل» لخسارةٍ غادر صاحبها ← مالك البطاقة الحالي
-- ------------------------------------------------------------
create or replace function public.crm_upsert_recontact_task(p_task uuid, p_opp uuid, p_owner uuid, p_date date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.opportunities%rowtype;
  assignee uuid;
  t_id uuid := p_task;
begin
  select * into o from public.opportunities where id = p_opp;
  select e.user_id into assignee from public.employees e where e.id = p_owner and e.status = 'active';
  -- (221) صاحب الخسارة غادر: المتابعة لمن البطاقة عنده الآن
  if assignee is null then
    select e.user_id into assignee
      from public.clients c join public.employees e on e.id = c.owner_id
     where c.id = o.client_id and e.status = 'active';
  end if;
  assignee := coalesce(assignee, auth.uid());

  if t_id is not null and exists (select 1 from public.tasks where id = t_id and status in ('جديدة', 'قيد التنفيذ')) then
    update public.tasks set due_date = p_date, follow_up_date = p_date where id = t_id;
    return t_id;
  end if;

  insert into public.tasks
    (title, description, assigned_to, due_date, follow_up_date, priority, status,
     client_id, related_client, opportunity_id, next_step,
     task_type, task_source, created_source, entity_type, entity_id)
  values
    ('إعادة تواصل — فرصة خاسرة: ' || coalesce(o.title, 'فرصة'),
     coalesce(p_note, 'موعد إعادة التواصل الذي حُدِّد عند تحليل الخسارة.'),
     assignee, p_date, p_date, 'متوسطة', 'جديدة',
     o.client_id, o.client_id, o.id, 'اتصل بالعميل وقيّم إعادة تنشيط الفرصة',
     'follow_up', 'crm', 'trigger', 'opportunity', o.id)
  returning id into t_id;
  return t_id;
end $$;

-- ------------------------------------------------------------
-- 4) تصحيح البيانات
-- ------------------------------------------------------------
do $fix$
declare
  v_lynda    uuid := (select id from public.employees where full_name = 'لندا عصام');
  v_nada     uuid := (select id from public.employees where full_name = 'ندى ماجد يس');
  v_team     uuid;
  v_handover timestamptz;
  v_losses   uuid[];
  v_opps     uuid[];
  n int;
begin
  -- (أ) استمارات مفتوحة لخسائر من غادروا — عند المستلِم أو عند غيره ← تُلغى
  perform set_config('tilal.lost_task_sync', 'on', true);
  update public.tasks t
     set status = 'ملغاة',
         cancellation_reason = 'انتهت خدمة ' || lo.full_name
           || ' — تبقى الخسارة باسمه ولا تُحمَّل استمارتها لغيره (221)'
    from public.crm_lost_sales l, public.employees lo
   where l.id = t.analysis_lost_sale_id
     and lo.id = l.owner_id and lo.status <> 'active'
     and t.status in ('جديدة', 'قيد التنفيذ');
  get diagnostics n = row_count;
  perform set_config('tilal.lost_task_sync', '', true);
  raise notice '221: % استمارة مفتوحة لخسائر من غادروا أُلغيت', n;

  -- (ب) لندا ← ندى: خسائر وقعت عند لندا قبل التسليم، وإعادة تسجيلها
  --     خلال دقائق من فتحها (10-06) — كلها للندا
  select h.created_at into v_handover
    from public.employee_handovers h
   where h.from_employee = v_lynda and h.to_employee = v_nada
   order by h.created_at limit 1;
  if v_lynda is null or v_nada is null or v_handover is null then
    raise notice '221: تسليم لندا ← ندى غير موجود — تخطّي (ب)';
    return;
  end if;
  select project_id into v_team from public.employees where id = v_lynda;

  select array_agg(ls.id), array_agg(distinct ls.opportunity_id)
    into v_losses, v_opps
    from public.crm_lost_sales ls
    join public.opportunities o on o.id = ls.opportunity_id
   where ls.owner_id = v_nada
     and exists (select 1 from public.client_activities a
                  where a.client_id = o.client_id and a.activity_type = 'تسليم'
                    and a.summary like 'نُقل الملف من لندا عصام إلى ندى ماجد يس%')
     and (ls.lost_at < v_handover
          or exists (select 1 from public.crm_lost_sales p
                      where p.opportunity_id = ls.opportunity_id and p.loss_no = ls.loss_no - 1
                        and p.lost_at < v_handover and p.reactivated_at is not null
                        and ls.lost_at - p.reactivated_at < interval '10 minutes'));

  if v_losses is null then
    raise notice '221: خسائر لندا مصحّحة سابقاً';
    return;
  end if;
  if array_length(v_losses, 1) <> 33 or array_length(v_opps, 1) <> 20 then
    raise exception '221: المتوقع ٣٣ خسارة على ٢٠ فرصة، وُجد % على % — راجع قبل التصحيح',
      array_length(v_losses, 1), array_length(v_opps, 1);
  end if;

  -- الخسارة: stamp_lost_sale يجمّد owner_id («ما كان يوم الخسارة») — ويوم
  -- الخسارة كانت للندا، فالتصحيح يتخطّاه لهذه الصفوف وحدها (كما 219c)
  alter table public.crm_lost_sales disable trigger trg_stamp_lost_sale;
  update public.crm_lost_sales
     set owner_id = v_lynda, owner_name = 'لندا عصام', updated_at = now()
   where id = any(v_losses);
  alter table public.crm_lost_sales enable trigger trg_stamp_lost_sale;

  -- الفرصة المغلقة لمن خسرها (187)
  update public.opportunities set owner_id = v_lynda
   where id = any(v_opps) and owner_id = v_nada;

  -- حقائق التقارير: مراحل هذه الفرص للندا؛ ومالك البطاقة يومها لها قبل التسليم
  update public.crm_event_facts
     set employee_id = v_lynda, team_id = v_team, updated_at = now()
   where opportunity_id = any(v_opps)
     and source_table = 'opportunity_stage_history' and event_type = 'stage_change'
     and employee_id = v_nada;
  update public.crm_event_facts
     set owner_id = v_lynda, updated_at = now()
   where opportunity_id = any(v_opps)
     and source_table = 'opportunity_stage_history' and event_type = 'stage_change'
     and event_at < v_handover and owner_id = v_nada;

  -- اللقطات اليومية: الفرصة الخاسرة على لندا
  update public.crm_snapshot_rows
     set owner_id = v_lynda, team_id = v_team
   where opportunity_id = any(v_opps) and stage_type = 'lost' and owner_id = v_nada;

  raise notice '221: ٣٣ خسارة و٢٠ فرصة من ملفات لندا عادت إليها';
end $fix$;

-- ------------------------------------------------------------
-- 5) اختبار 177 يتبع القاعدة: «مالك الفرصة ترك العمل» ⇒ لا مهمة لأحد
-- ------------------------------------------------------------
-- هنا لا في 221b: كتلة 221b تُلغى كلها باستثنائها الأخير.
do $patch$
declare
  f text := pg_get_functiondef('tests.run_lost_analysis_tasks()'::regprocedure);
  old1 text := E'      log := log || extensions.ok(\n'
            || E'        (select assigned_to = plain_u from public.tasks where id = t_id),\n'
            || E'        ''مالك الفرصة ترك العمل ⇒ المهمة لمالك العميل الحالي'');\n'
            || E'\n'
            || E'      perform tests.act_as(plain_u);\n'
            || E'      perform public.update_lost_analysis(ls, base, null);\n'
            || E'      log := log || extensions.is((select status from public.tasks where id = t_id), ''منجزة'',\n'
            || E'        ''مالك العميل الحالي يحفظ الاستمارة بإذن المهمة، فتُنجَز'');\n'
            || E'    else\n'
            || E'      log := log || extensions.pass(''مالك الفرصة ترك العمل (لا موظف غير فعّال للاختبار)'');\n'
            || E'      log := log || extensions.pass(''مالك العميل الحالي يحفظ الاستمارة (لا موظف غير فعّال للاختبار)'');\n';
  new1 text := E'      -- (221) الخسارة على من خسرها: لا تُحمَّل استمارتها لمالك العميل الحالي\n'
            || E'      log := log || extensions.ok(t_id is null and public.crm_lost_analysis_assignee(ls) is null,\n'
            || E'        ''مالك الفرصة ترك العمل ⇒ لا مهمة لمالك العميل الحالي — الخسارة تبقى باسمه (221)'');\n'
            || E'\n'
            || E'      perform tests.act_as(admin_u);\n'
            || E'      perform public.update_lost_analysis(ls, base, null);\n'
            || E'      log := log || extensions.ok((select category_id is not null from public.crm_lost_sales where id = ls),\n'
            || E'        ''المدير يكمل تحليل خسارة الراحل من صفحة الخسائر'');\n'
            || E'    else\n'
            || E'      log := log || extensions.pass(''مالك الفرصة ترك العمل (لا موظف غير فعّال للاختبار)'');\n'
            || E'      log := log || extensions.pass(''المدير يكمل تحليل خسارة الراحل (لا موظف غير فعّال للاختبار)'');\n';
begin
  f := replace(f, chr(13), '');
  if strpos(f, '(221) الخسارة على من خسرها') > 0 then
    raise notice '221: tests.run_lost_analysis_tasks مُعدّلة سابقاً';
    return;
  end if;
  if (length(f) - length(replace(f, old1, ''))) / length(old1) <> 1 then
    raise exception '221: حالة «مالك الفرصة ترك العمل» في tests.run_lost_analysis_tasks غير موجودة مرّة واحدة';
  end if;
  execute replace(f, old1, new1);
end $patch$;

notify pgrst, 'reload schema';
