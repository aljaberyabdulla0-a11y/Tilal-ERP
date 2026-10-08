-- ============================================================
-- تلال ERP — 194: اختبارات محرّك العمل V2 (189–193)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل:  select * from tests.run_tasks_v2();
-- ثم الانحدار:
--   select * from tests.run_lost_analysis_tasks();
--   select * from tests.run_dashboard();
--
-- نمط 183: معاملة فرعية تُلغى في النهاية — لا أثر على البيانات.
-- داخل الكتلة تُبدَّل الهوية بـ set_config (لا tests.act_as بعد
-- «set local role authenticated»).
-- ============================================================

create or replace function tests.run_tasks_v2()
returns table (nr int, result text, test_name text)
language plpgsql set search_path = public, extensions as $$
declare
  log text[] := '{}';
  admin_u uuid; plain_u uuid; plain_emp uuid; other_u uuid; broker_u uuid;
  lost_u uuid; lost_t uuid;
  cli uuid; cli_owner uuid; opp uuid;
  t1 uuid; t2 uuid; t3 uuid; ta uuid; tb uuid; tpl uuid; rec uuid; rule uuid; parent uuid;
  j jsonb; n int; m int; v int; txt text; err text; i int := 0;
  v_mkt uuid;
begin
  perform tests.reset_plan();
  perform extensions.no_plan();

  select id into admin_u from public.profiles where role = 'admin' order by created_at limit 1;
  -- موظفان عاديان بلا علاقة إدارة بينهما ولا يديران قسماً
  select p1.id, e1.id, p2.id into plain_u, plain_emp, other_u
    from public.profiles p1 join public.employees e1 on e1.user_id = p1.id
    join public.profiles p2 on p2.role = 'employee' and p2.id <> p1.id
    join public.employees e2 on e2.user_id = p2.id and e2.status = 'active'
   where p1.role = 'employee' and e1.status = 'active'
     and e1.manager_id is distinct from e2.id and e2.manager_id is distinct from e1.id
     and not exists (select 1 from public.departments d where d.manager_id in (e1.id, e2.id))
     and (e1.project_id is null or not exists (select 1 from public.projects pr where pr.id = e1.project_id and pr.supervisor_id = e2.id))
     and (e2.project_id is null or not exists (select 1 from public.projects pr where pr.id = e2.project_id and pr.supervisor_id = e1.id))
   order by p1.created_at, p2.created_at limit 1;
  select id into broker_u from public.profiles where role = 'broker' order by created_at limit 1;
  select id into v_mkt from public.departments where code = 'MKT';

  if admin_u is null or plain_u is null or other_u is null then
    return query select 0, 'not ok', 'بيئة ناقصة: يلزم مدير وموظفان بلا علاقة إدارة'::text;
    return;
  end if;

  begin
    -- ================= الترحيل =================
    select count(*) into n from public.tasks where analysis_lost_sale_id is not null;
    select count(*) into m from public.tasks
     where analysis_lost_sale_id is not null and task_type = 'lost_analysis' and task_source = 'crm';
    log := log || extensions.is(m, n, 'كل مهامّ الاستمارة صُنِّفت lost_analysis / crm');
    select count(*) into n from public.tasks where created_source is null;
    log := log || extensions.is(n, 0, 'لا مهمة بلا قناة إنشاء');
    select count(*) into n from public.tasks where (status = 'منجزة') <> (completed_at is not null);
    log := log || extensions.is(n, 0, 'completed_at يطابق الحالة في كل الصفوف');

    -- ================= الإنشاء والختم =================
    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    j := public.task_save(jsonb_build_object('title', 'اختبار V2 — مهمة الموظف', 'priority', 'عاجلة'));
    t1 := (j->>'id')::uuid;
    select created_by, version, task_source, created_source, assigned_to
      into ta, v, txt, err, tb from public.tasks where id = t1;
    log := log || extensions.ok(ta = plain_u and tb = plain_u, 'المنشئ والمسؤول = المستخدم الحالي');
    log := log || extensions.is(v, 1, 'الإصدار يبدأ من ١');
    log := log || extensions.ok(txt = 'manual' and err = 'form', 'المصدر manual والقناة form');

    -- الموظف لا يُسند لغيره — عبر الدالة ولا مباشرة
    err := null;
    begin
      perform public.task_save(jsonb_build_object('title', 'محاولة إسناد', 'assigned_to', other_u));
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%لا تملك صلاحية إسناد%', 'task_save: الموظف لا يُسند لزميل');

    err := null;
    begin
      insert into public.tasks (title, assigned_to, created_by) values ('مباشر', other_u, plain_u);
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err is not null, 'الإدراج المباشر لزميل مرفوض (RLS/الحارس)');

    err := null;
    begin
      update public.tasks set assigned_to = other_u where id = t1;
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%لا تملك صلاحية إسناد%', 'الحارس: تعديل مباشر يُسند لزميل مرفوض');

    err := null;
    begin
      update public.tasks set task_source = 'system' where id = t1;
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err is not null, 'الحارس: المصدر لا يُزوَّر');

    -- ================= الرؤية =================
    perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
    select count(*) into n from public.tasks where id = t1;
    log := log || extensions.is(n, 0, 'الزميل لا يرى مهمة الموظف');
    log := log || extensions.ok(public.task_detail(t1) is null, 'task_detail لا يكشف مهمة خارج النطاق');

    if broker_u is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', broker_u, 'role', 'authenticated')::text, true);
      select count(*) into n from public.tasks where id = t1;
      log := log || extensions.is(n, 0, 'الوسيط لا يرى المهمة');
    end if;

    -- المدير يضيف الزميل متابعاً ← يراها
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    perform public.task_save(jsonb_build_object('id', t1, 'watchers', jsonb_build_array(other_u)));
    perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
    select count(*) into n from public.tasks where id = t1;
    log := log || extensions.is(n, 1, 'المتابِع يرى المهمة');
    err := null;
    begin
      perform public.task_set_status(t1, 'منجزة');
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%لا تملك%', 'المتابِع لا يغيّر الحالة');

    -- ================= التعديل لا يُعيد الإسناد =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    j := public.task_save(jsonb_build_object('title', 'مهمة من المدير', 'assigned_to', plain_u));
    t2 := (j->>'id')::uuid;
    perform public.task_save(jsonb_build_object('id', t2, 'title', 'مهمة من المدير — معدَّلة'));
    select assigned_to into ta from public.tasks where id = t2;
    log := log || extensions.is(ta, plain_u, 'تعديل المدير لا يغيّر المسؤول (إصلاح الخطأ ٢)');

    -- التزامن
    select version into v from public.tasks where id = t2;
    err := null;
    begin
      perform public.task_save(jsonb_build_object('id', t2, 'version', v - 1, 'title', 'قديم'));
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%عُدّلت هذه المهمة%', 'إصدار قديم يُرفض');

    -- إعادة الإسناد: إشعار + سجلّ
    perform public.task_reassign(t2, other_u, 'للاختبار');
    execute 'reset role';
    select count(*) into n from public.notifications where user_id = other_u and entity_id = t2 and title = 'أُسندت إليك مهمة';
    log := log || extensions.is(n, 1, 'إعادة الإسناد تُشعر المسؤول الجديد');
    select count(*) into n from public.task_activity_log where task_id = t2 and action = 'reassigned';
    log := log || extensions.is(n, 1, 'إعادة الإسناد مسجّلة في السجلّ');
    execute 'set local role authenticated';

    -- ================= الإنجاز والإلغاء =================
    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    perform public.task_set_status(t1, 'منجزة');
    select completed_by into ta from public.tasks where id = t1;
    log := log || extensions.is(ta, plain_u, 'completed_by = من أنجز');
    perform public.task_set_status(t1, 'جديدة');
    select count(*) into n from public.tasks where id = t1 and completed_at is null and completed_by is null;
    log := log || extensions.is(n, 1, 'إعادة الفتح تمسح completed_*');

    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    j := public.task_save(jsonb_build_object('title', 'عقد للاختبار', 'task_type', 'contract', 'assigned_to', plain_u));
    t3 := (j->>'id')::uuid;
    err := null;
    begin
      perform public.task_set_status(t3, 'ملغاة');
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%سبب الإلغاء%', 'نوع يطلب سبب الإلغاء');
    perform public.task_set_status(t3, 'ملغاة', 'أُلغي العقد');
    select count(*) into n from public.tasks
     where id = t3 and cancelled_at is not null and cancelled_by = admin_u and cancellation_reason = 'أُلغي العقد';
    log := log || extensions.is(n, 1, 'الإلغاء يسجّل من ومتى ولماذا');

    -- الأرشفة للمغلقة فقط
    err := null;
    begin
      perform public.task_archive(t2, true);
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%تُؤرشف المهمة بعد%', 'لا تُؤرشف مهمة مفتوحة');
    perform public.task_archive(t3, true);
    j := public.task_list(jsonb_build_object('id', t3), 10, 0);
    log := log || extensions.is((j->>'total')::int, 0, 'المؤرشفة لا تظهر افتراضياً');
    j := public.task_list(jsonb_build_object('id', t3, 'archived', 'include'), 10, 0);
    log := log || extensions.is((j->>'total')::int, 1, 'وتظهر بـ archived=include');

    -- ================= التبعيات =================
    ta := (public.task_save(jsonb_build_object('title', 'أ — أولاً'))->>'id')::uuid;
    tb := (public.task_save(jsonb_build_object('title', 'ب — بعد أ'))->>'id')::uuid;
    insert into public.task_dependencies (task_id, depends_on_id) values (tb, ta);
    err := null;
    begin
      perform public.task_set_status(tb, 'منجزة');
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%لا تُنجز هذه المهمة قبل%', 'لا إنجاز قبل التبعية المانعة');
    err := null;
    begin
      insert into public.task_dependencies (task_id, depends_on_id) values (ta, tb);
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%دائرية%', 'التبعية الدائرية ممنوعة');
    perform public.task_set_status(ta, 'منجزة');
    perform public.task_set_status(tb, 'منجزة');
    select count(*) into n from public.tasks where id = tb and status = 'منجزة';
    log := log || extensions.is(n, 1, 'تُنجز بعد اكتمال ما تعتمد عليه');

    -- ================= الموافقة =================
    j := public.task_save(jsonb_build_object('title', 'تحتاج موافقة', 'assigned_to', plain_u, 'requires_approval', true));
    ta := (j->>'id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    j := public.task_set_status(ta, 'منجزة');
    log := log || extensions.is(j->>'result', 'approval_requested', '«أنجز» على مهمة تحتاج موافقة يطلب الموافقة');
    select approver_id into tb from public.tasks where id = ta;
    log := log || extensions.is(tb, admin_u, 'المعتمِد الافتراضي = من طلب المهمة');
    err := null;
    begin
      perform public.task_decide_approval(ta, true);
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err is not null, 'المسؤول لا يعتمد مهمته');
    err := null;
    begin
      update public.tasks set approval_status = 'معتمدة' where id = ta;
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%الموافقة%', 'الحارس: الموافقة لا تُكتب مباشرة');

    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    err := null;
    begin
      perform public.task_decide_approval(ta, false);
    exception when others then err := sqlerrm; end;
    log := log || extensions.ok(err like '%سبب الرفض%', 'الرفض يحتاج سبباً');
    perform public.task_decide_approval(ta, false, 'أكمل البند الثالث');
    select count(*) into n from public.tasks where id = ta and approval_status = 'مرفوضة' and status = 'قيد التنفيذ';
    log := log || extensions.is(n, 1, 'الرفض يعيدها قيد التنفيذ');

    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    perform public.task_set_status(ta, 'منجزة');
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    perform public.task_decide_approval(ta, true);
    select count(*) into n from public.tasks where id = ta and approval_status = 'معتمدة' and status = 'منجزة' and approved_by = admin_u;
    log := log || extensions.is(n, 1, 'الاعتماد يُنجز المهمة');

    -- ================= التعليقات والإشارة =================
    -- t1 مهمة الموظف نفسه (t2 أُعيد إسنادها لزميل فلم يعد يراها)
    perform set_config('request.jwt.claims', json_build_object('sub', plain_u, 'role', 'authenticated')::text, true);
    perform public.task_comment_add(t1, 'تعليق للاختبار', array[other_u]);
    execute 'reset role';
    select count(*) into n from public.task_comments where task_id = t1;
    log := log || extensions.ok(n >= 1, 'التعليق محفوظ');
    select count(*) into n from public.task_activity_log where task_id = t1 and action = 'comment_added';
    log := log || extensions.ok(n >= 1, 'التعليق في السجلّ');
    -- الزميل متابِع (أضافه المدير أعلاه) فالإشارة إليه مسموحة وتصله
    select count(*) into n from public.notifications
     where user_id = other_u and entity_id = t1 and title like '%أشار إليك%';
    log := log || extensions.is(n, 1, 'الإشارة (@) تُشعر المُشار إليه');
    execute 'set local role authenticated';

    -- انحدار task_list: الفرعية تظهر بلا مرشّح parent، و«عملي» لا يُسقط العادية
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    ta := (public.task_save(jsonb_build_object('title', 'أب للاختبار'))->>'id')::uuid;
    tb := (public.task_save(jsonb_build_object('title', 'ابن للاختبار', 'parent_task_id', ta))->>'id')::uuid;
    j := public.task_list(jsonb_build_object('id', tb), 5, 0);
    log := log || extensions.is((j->>'total')::int, 1, 'المهمة الفرعية تظهر في القائمة بلا مرشّح parent');
    j := public.task_list(jsonb_build_object('id', ta, 'scope', 'mine', 'bucket', 'today', 'split_waiting', true), 5, 0);
    log := log || extensions.is((j->>'total')::int, 1, '«عملي/اليوم» يعرض المهمة العادية (لا null يُسقطها)');
    j := public.task_list(jsonb_build_object('id', ta), 5, 0);
    log := log || extensions.ok((j->'rows'->0->>'subtasks_total')::int = 1 and (j->'rows'->0->>'is_waiting')::boolean = false,
                                'الأب يعدّ فرعيته، والمشتقّات منطقية صريحة');

    -- ================= القوالب =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    select id into tpl from public.task_templates where code = 'marketing_video';
    parent := public.task_template_apply(tpl, jsonb_build_object('title', 'فيديو اختبار', 'department_id', v_mkt));
    select count(*) into n from public.tasks where parent_task_id = parent;
    log := log || extensions.is(n, 8, 'القالب أنشأ ٨ مهام فرعية');
    select count(*) into n from public.task_dependencies d join public.tasks t on t.id = d.task_id where t.parent_task_id = parent;
    log := log || extensions.is(n, 7, 'وتبعياتها السبع');
    select count(*) into n from public.task_checklist_items where task_id = parent;
    log := log || extensions.is(n, 2, 'وقائمة تحقق الرئيسية');
    select count(*) into n from public.tasks where id = parent and template_id = tpl and workflow_id is not null and requires_approval;
    log := log || extensions.is(n, 1, 'الرئيسية على خطّ المحتوى وتحتاج موافقة');

    -- ================= العدّادات والقائمة =================
    j := public.task_counts();
    log := log || extensions.ok(j ? 'mine' and (j->>'scope') = 'all', 'task_counts للمدير: عملي + نطاق all');
    j := public.task_list(jsonb_build_object('scope', 'mine'), 1, 0);
    log := log || extensions.ok(jsonb_array_length(j->'rows') <= 1, 'الترقيم: limit يُحترم');
    select count(*) into n from public.tasks where assigned_to = admin_u and archived_at is null;
    log := log || extensions.is((j->>'total')::int, n, 'total = عدّ مهامي غير المؤرشفة');

    -- ================= الانحدار: الجماعي وإعادة التواصل =================
    select c.id, e.user_id into cli, cli_owner
      from public.clients c join public.employees e on e.id = c.owner_id
     where c.deleted_at is null and e.user_id is not null and e.status = 'active'
     limit 1;
    if cli is not null then
      select succeeded into n from public.bulk_create_tasks(array[cli], 'اختبار جماعي V2', null, 'متوسطة');
      log := log || extensions.is(n, 1, 'bulk_create_tasks يعمل (بلا تاريخ = اليوم)');
      select count(*) into n from public.tasks
       where client_id = cli and title = 'اختبار جماعي V2' and task_source = 'crm' and task_type = 'follow_up'
         and created_source = 'bulk' and assigned_to = cli_owner and due_date = public.baghdad_today();
      log := log || extensions.is(n, 1, 'الجماعي: crm/follow_up لمالك العميل');
    end if;

    select o.id into opp from public.opportunities o where o.deleted_at is null limit 1;
    if opp is not null then
      -- دالة داخلية (لا تُنادى من المتصفح): تُستدعى كما تستدعيها close_opportunity_lost
      execute 'reset role';
      ta := public.crm_upsert_recontact_task(null, opp, null, public.baghdad_today() + 3, null);
      execute 'set local role authenticated';
      select count(*) into n from public.tasks where id = ta and task_source = 'crm' and task_type = 'follow_up' and entity_type = 'opportunity';
      log := log || extensions.is(n, 1, 'إعادة التواصل: crm/follow_up مرتبطة بالفرصة');
    end if;

    -- ================= الانحدار: حارس الاستمارة =================
    execute 'reset role';
    select t.id, t.assigned_to into lost_t, lost_u
      from public.tasks t join public.profiles p on p.id = t.assigned_to
     where t.analysis_lost_sale_id is not null and t.status in ('جديدة', 'قيد التنفيذ') and p.role = 'employee'
     limit 1;
    execute 'set local role authenticated';
    if lost_t is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', lost_u, 'role', 'authenticated')::text, true);
      err := null;
      begin
        perform public.task_set_status(lost_t, 'منجزة');
      exception when others then err := sqlerrm; end;
      log := log || extensions.ok(err like '%استمارة%', 'الموظف لا يُنجز مهمة الاستمارة بيده (175)');
    end if;

    -- ================= وقائع CRM: مهامّ المبيعات وحدها =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    ta := (public.task_save(jsonb_build_object('title', 'تصميم بروشور', 'department_id', v_mkt, 'task_type', 'design'))->>'id')::uuid;
    perform public.task_set_status(ta, 'قيد التنفيذ');
    -- مهمة تسويق بلا مسار للاختبار: نزيل المسار كي تُنجز بلا موافقة
    perform public.task_save(jsonb_build_object('id', ta, 'requires_approval', false, 'workflow_id', null, 'workflow_step_id', null));
    perform public.task_set_status(ta, 'منجزة');
    execute 'reset role';
    select count(*) into n from public.crm_event_facts where source_table = 'tasks' and source_id = ta;
    log := log || extensions.is(n, 0, 'مهمة تسويق بلا عميل لا تدخل وقائع CRM');
    if cli is not null then
      select id into tb from public.tasks where client_id = cli and title = 'اختبار جماعي V2';
      update public.tasks set status = 'منجزة' where id = tb;
      select count(*) into n from public.crm_event_facts where source_table = 'tasks' and source_id = tb;
      log := log || extensions.is(n, 1, 'مهمة مرتبطة بعميل تدخل وقائع CRM');
    end if;

    -- ================= التكرار: مهمة واحدة لكل موعد =================
    insert into public.task_recurrences (title, assigned_to, frequency, start_on, created_by)
    values ('تكرار يومي للاختبار', plain_u, 'daily', public.baghdad_today(), admin_u)
    returning id into rec;
    perform public.task_generate_recurring(public.baghdad_today());
    update public.task_recurrences set next_run_on = public.baghdad_today() where id = rec;
    perform public.task_generate_recurring(public.baghdad_today());
    select count(*) into n from public.tasks where recurrence_id = rec;
    log := log || extensions.is(n, 1, 'تشغيلان لنفس اليوم = مهمة واحدة');
    select next_run_on into txt from public.task_recurrences where id = rec;
    log := log || extensions.is(txt, (public.baghdad_today() + 1)::text, 'الموعد التالي = غداً');
    log := log || extensions.is(public.task_recurrence_next('monthly', 1, null, 31, date '2026-01-31', null, date '2026-01-31'),
                                date '2026-02-28', 'الشهري ٣١ ← آخر فبراير');
    log := log || extensions.is(public.task_recurrence_next('weekly', 2, array[0], null, date '2026-10-04', null, date '2026-10-04'),
                                date '2026-10-18', 'أسبوعي كل أسبوعين يوم الأحد');

    -- ================= الأتمتة: حدث واحد = تشغيل واحد =================
    -- الكيان مشروع حقيقي: المفتاح الأجنبي (project_id) يُملأ منه ويجب أن يوجد
    select id into rule from public.task_automation_rules where code = 'campaign_launch';
    update public.task_automation_rules set is_active = true where id = rule;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    select id into tb from public.projects order by created_at limit 1;
    if tb is not null then
      n := public.task_emit_event('campaign.created', 'project', tb, jsonb_build_object('title', 'حملة اختبار'), 'test:campaign:1');
      m := public.task_emit_event('campaign.created', 'project', tb, jsonb_build_object('title', 'حملة اختبار'), 'test:campaign:1');
      select coalesce(max(error), '') into txt from public.task_automation_runs where rule_id = rule and event_key = 'test:campaign:1';
      log := log || extensions.ok(n = 1 and m = 0, 'نفس مفتاح الحدث مرتين = تشغيل واحد ' || txt);
      select count(*) into n from public.tasks t
        join public.task_automation_runs r on r.task_id = t.id
       where r.rule_id = rule and r.event_key = 'test:campaign:1' and t.task_source = 'automation' and t.project_id = tb;
      log := log || extensions.is(n, 1, 'الأتمتة أنشأت المهمة الرئيسية بمصدر automation');
      select count(*) into n from public.tasks t join public.task_automation_runs r on r.task_id = t.parent_task_id
       where r.rule_id = rule and r.event_key = 'test:campaign:1';
      log := log || extensions.is(n, 7, 'ومهام القالب السبع تحتها');
    end if;

    -- ================= التذكير =================
    j := public.tasks_daily_reminder();
    log := log || extensions.ok(j ? 'sent', 'tasks_daily_reminder يعمل');
    select count(*) into n from public.notifications
     where kind = 'مهمة' and title like 'مهام اليوم%' and body = ''
       and (created_at at time zone 'Asia/Baghdad')::date = public.baghdad_today();
    log := log || extensions.is(n, 0, 'لا تذكير فارغ');

    -- ================= الأمان =================
    perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    select count(*) into n from public.security_audit() a
     where a.object_name like 'task%' or a.object_name like '%task%';
    log := log || extensions.is(n, 0, 'security_audit: لا ملاحظة على جداول ودوال المهام');

    raise exception using errcode = 'RLBCK', message = 'تم';
  exception
    when sqlstate 'RLBCK' then null;
    when others then
      get stacked diagnostics txt = pg_exception_context;
      log := log || ('not ok - تعذّر إكمال اختبارات المهام: ' || sqlerrm || ' @ ' || left(txt, 400));
  end;

  begin reset role; exception when others then null; end;
  perform tests.act_as(null);

  foreach txt in array log loop
    i := i + 1;
    return query select i, case when txt like 'ok %' then 'ok' else 'not ok' end,
                        regexp_replace(txt, '^n?o[kt]? ?o?k? ?[0-9]* - ', '');
  end loop;
end $$;

comment on function tests.run_tasks_v2() is
  'اختبارات محرّك العمل V2 (189–193): الترحيل، RLS، الإسناد، الحارس، التزامن، الإنجاز/الإلغاء/الأرشفة، التبعيات، الموافقة، التعليقات، القوالب، التكرار، الأتمتة، الانحدار (الجماعي، إعادة التواصل، الاستمارة، وقائع CRM، التذكير). يُلغي أثره.';

revoke all on function tests.run_tasks_v2() from public;
grant execute on function tests.run_tasks_v2() to service_role;
