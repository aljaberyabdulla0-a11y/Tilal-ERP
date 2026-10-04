-- ============================================================
-- تلال ERP — 123: تاريخ إنهاء الخدمة يُختار ولا يُفرض
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- handover_employee (045) يكتب end_date = يوم الضغط على الزرّ دائماً.
-- فمن غادر يوم 25 وسُجّل خروجه يوم 4 من الشهر التالي تُحسب له
-- خدمةٌ لم يؤدّها: 119 يجزّئ الراتب حتى end_date، فيأخذ أيام
-- الشهر التالي، ويُبنى له كشفٌ كامل للشهر الذي غاب عنه.
--
-- ===== القاعدة =====
--
-- • p_end_date (اختياري، الافتراضي اليوم بتوقيت بغداد) — لا يكون:
--     - بعد اليوم: الإنهاء يغلق الحساب ويسلّم الملفات الآن، فلا
--       معنى لتاريخٍ لم يأتِ.
--     - قبل تاريخ المباشرة.
-- • كشوف الرواتب بعد التاريخ:
--     - مسوّدة لشهرٍ بعد شهر النهاية → تُحذف، وما رُبط بها يعود حرّاً (كـ 119).
--     - معتمد/مقفل لشهرٍ بعد شهر النهاية → يرفض الإنهاء: راتبٌ صُرف
--       عن شهرٍ لم يعمل فيه قرارٌ للمدير، لا يُمحى بصمت.
--     - مسوّدة شهر النهاية → يُجزَّأ بند الأساسي إن كان كما بناه
--       النظام (غير يدوي ولا معدَّل). المعدَّل يدوياً لا يُمسّ.
--
-- يتطلب: 045، 088، 119. آمن لإعادة التشغيل.
-- ============================================================


-- التوقيع يتغيّر: الدالة القديمة تُحذف وإلا بقيت نسختان بالاسم نفسه
drop function if exists public.handover_employee(uuid, uuid, text, boolean, boolean);

create or replace function public.handover_employee(
  p_from          uuid,
  p_to            uuid,
  p_note          text    default null,
  p_end_service   boolean default true,
  p_revoke_access boolean default true,
  p_end_date      date    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.employees%rowtype;
  t public.employees%rowtype;
  moved_clients uuid[];
  n_clients int := 0;
  n_tasks   int := 0;
  n_resv    int := 0;
  actor     text;
  v_today   date := (now() at time zone 'Asia/Baghdad')::date;
  v_end     date := coalesce(p_end_date, (now() at time zone 'Asia/Baghdad')::date);
  v_end_m   text := to_char(coalesce(p_end_date, (now() at time zone 'Asia/Baghdad')::date), 'YYYY-MM');
  pr        record;
  w         record;
  n_pr_del  int := 0;
  v_locked  text;
begin
  if not public.is_admin() then
    raise exception 'إنهاء الخدمة وتسليم الملفات للمدير وحده';
  end if;

  select * into f from public.employees where id = p_from;
  if not found then raise exception 'الموظف المُنهية خدمته غير موجود'; end if;

  select * into t from public.employees where id = p_to;
  if not found then raise exception 'الموظف المستلِم غير موجود'; end if;

  if p_from = p_to then
    raise exception 'لا يُسلّم الموظف إلى نفسه';
  end if;
  if t.status <> 'active' then
    raise exception 'المستلِم % غير نشط — اختر موظفاً على رأس عمله', t.full_name;
  end if;

  -- ===== تاريخ النهاية =====
  if p_end_service then
    if v_end > v_today then
      raise exception 'تاريخ إنهاء الخدمة (%) بعد اليوم — الإنهاء يسري فوراً، فسجّله يوم المغادرة', v_end;
    end if;
    if f.hire_date is not null and v_end < f.hire_date then
      raise exception 'تاريخ إنهاء الخدمة (%) قبل تاريخ مباشرة % (%)', v_end, f.full_name, f.hire_date;
    end if;

    select string_agg(p.period || ' ' || p.state, '، ' order by p.period) into v_locked
      from public.payrolls p
     where p.employee_id = p_from and p.period > v_end_m and p.state <> 'مسودة';
    if v_locked is not null then
      raise exception 'لـ % كشوف رواتب بعد تاريخ النهاية (%): % — أعِد فتحها أو اختر تاريخاً لاحقاً',
        f.full_name, v_end, v_locked;
    end if;
  end if;

  -- ===== العملاء =====
  -- ينتقل ما هو **باسمه**، أو ما أنشأه ولم يُسنَد لأحد. ولا تُمسّ
  -- ليدات الشركات الوسيطة: ملكها الشركة لا الموظف (sql/043).
  select array_agg(c.id) into moved_clients
  from public.clients c
  where c.broker_company_id is null
    and (
      public.name_key(c.sales_employee) = public.name_key(f.full_name)
      or (
        c.sales_employee is null
        and f.user_id is not null
        and c.created_by = f.user_id
      )
    );

  moved_clients := coalesce(moved_clients, '{}');
  n_clients := array_length(moved_clients, 1);
  n_clients := coalesce(n_clients, 0);

  if n_clients > 0 then
    update public.clients
       set sales_employee = t.full_name
     where id = any(moved_clients);

    -- أثر في ملفّ كل عميل: من يفتحه غداً يعرف لماذا تغيّر مسؤوله.
    -- نوعه «تسليم» فلا يُحتسب تواصلاً ولا يطلب موعد متابعة.
    insert into public.client_activities
      (client_id, activity_type, summary, actor_name, created_by, occurred_at)
    select
      id,
      'تسليم',
      'نُقل الملف من ' || f.full_name || ' إلى ' || t.full_name ||
        case when p_note is not null and btrim(p_note) <> ''
             then ' — ' || btrim(p_note) else '' end,
      t.full_name,
      auth.uid(),
      now()
    from unnest(moved_clients) as id;
  end if;

  -- ===== المهام المفتوحة =====
  -- المنجزة والملغاة تبقى له: هي سجلّ عمله لا عبء ينتقل.
  if f.user_id is not null and t.user_id is not null then
    update public.tasks
       set assigned_to      = t.user_id,
           assigned_to_name = t.full_name
     where assigned_to = f.user_id
       and status in ('جديدة', 'قيد التنفيذ');
    get diagnostics n_tasks = row_count;
  end if;

  -- ===== الحجوزات القائمة =====
  -- المكتملة والملغاة لا تُمسّ: عمولتها استُحقّت لصاحبها.
  update public.reservations
     set agent_id   = t.id,
         agent_name = t.full_name
   where agent_id = f.id
     and status = 'حجز';
  get diagnostics n_resv = row_count;

  -- ===== إنهاء الخدمة =====
  if p_end_service then
    update public.employees
       set status     = 'inactive',
           end_date   = v_end,
           end_reason = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_from;

    -- المشرف الخارج يترك مشاريعه بلا مشرف بدل أن تبقى معلّقة باسمه
    update public.projects set supervisor_id = null where supervisor_id = p_from;

    -- مسوّدات بعد شهر النهاية: لا خدمة فيها (المعتمد رُفض أعلاه)
    for pr in
      select id from public.payrolls
       where employee_id = p_from and period > v_end_m and state = 'مسودة'
    loop
      update public.commissions set payroll_id = null where payroll_id = pr.id;
      update public.deductions   set payroll_id = null where payroll_id = pr.id;
      update public.advance_installments set payroll_id = null
       where payroll_id = pr.id and status = 'مستحق';
      delete from public.notifications where kind = 'راتب' and entity_id = pr.id;
      delete from public.payrolls where id = pr.id;
      n_pr_del := n_pr_del + 1;
    end loop;

    -- مسوّدة شهر النهاية: الأساسي حتى يوم النهاية — إن كان كما بناه النظام
    if coalesce(f.base_salary, 0) > 0 then
      select * into w from public.service_window(p_from, v_end_m);
      update public.payroll_lines l
         set amount = round(f.base_salary * w.service_days / w.month_days),
             description = case when w.service_days < w.month_days
                             then 'الراتب الأساسي — ' || w.service_days || ' يوماً من ' || w.month_days ||
                                  ' (' || w.svc_from || ' ← ' || w.svc_to || ')'
                             else 'الراتب الأساسي' end
        from public.payrolls p
       where p.id = l.payroll_id
         and p.employee_id = p_from and p.period = v_end_m and p.state = 'مسودة'
         and l.category = 'راتب أساسي' and l.source_table = 'employees'
         and not l.manual and l.original_amount is null;
    end if;
  end if;

  -- ===== إغلاق الوصول =====
  -- تعطيل الحساب في auth لا في التطبيق وحده: إخفاء الشاشات لا يمنع
  -- من يملك رمزاً صالحاً من مناداة الواجهة مباشرة.
  if p_revoke_access and f.user_id is not null then
    update auth.users set banned_until = 'infinity' where id = f.user_id;
  end if;

  -- ===== إشعار المستلِم =====
  if t.user_id is not null then
    insert into public.notifications (user_id, title, body, link, kind)
    values (
      t.user_id,
      'استلمت ملفات ' || f.full_name,
      'انتقل إليك ' || n_clients || ' عميلاً و' || n_tasks || ' مهمة و' ||
        n_resv || ' حجزاً. تابعها حتى لا تتوقّف.',
      '/dashboard/clients',
      'تسليم'
    );
  end if;

  select coalesce(e.full_name, p.email) into actor
  from public.profiles p
  left join public.employees e on e.user_id = p.id
  where p.id = auth.uid();

  insert into public.employee_handovers (
    created_by, created_by_name, from_employee, from_name,
    to_employee, to_name, clients_moved, tasks_moved, reservations_moved,
    ended_service, revoked_access, note
  ) values (
    auth.uid(), actor, p_from, f.full_name,
    p_to, t.full_name, n_clients, n_tasks, n_resv,
    p_end_service, p_revoke_access and f.user_id is not null,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return jsonb_build_object(
    'clients', n_clients,
    'tasks', n_tasks,
    'reservations', n_resv,
    'from', f.full_name,
    'to', t.full_name,
    'revoked', p_revoke_access and f.user_id is not null,
    'end_date', case when p_end_service then v_end end,
    'payrolls_removed', n_pr_del
  );
end;
$$;

revoke all on function public.handover_employee(uuid, uuid, text, boolean, boolean, date) from public, anon;
grant execute on function public.handover_employee(uuid, uuid, text, boolean, boolean, date) to authenticated, service_role;

notify pgrst, 'reload schema';
