-- ============================================================
-- 045 — إنهاء خدمة موظف وتسليم ملفاته
--
-- المشكلة: خروج موظف يُجمّد عملاءه. ملفاتهم تبقى باسمه فلا يراها
-- أحد، ومتابعاتهم تتوقّف، ومهامّه المفتوحة تبقى مسندة لحساب لم
-- يعد يفتحه أحد. فيتوقّف العمل لا لعطل بل لغياب شخص.
--
-- الحل: عملية واحدة ذرّية تنقل كل ما يُتابَع إلى خَلَفه، وتُنهي
-- خدمته، وتغلق وصوله — أو ترفض كلها إن تعثّر جزء منها.
--
-- ما ينتقل:   العملاء المفتوحون، المهام غير المنجزة، الحجوزات القائمة.
-- ما لا ينتقل: سجلّ التواصل (من اتصل فعلاً لا يتغيّر)، والعمولات
--              والرواتب (استُحقّت له)، وليدات الشركات الوسيطة
--              (ليست ملكه أصلاً).
-- ============================================================

-- ============================================================
-- 1) أنشطة النظام مقابل أنشطة التواصل
--
-- سجلّ العميل فيه نوعان: تواصلٌ فعلي يقوم به موظف (مكالمة، زيارة)،
-- وحدثٌ يكتبه النظام (تغيير مرحلة، تسليم ملف). الثاني ليس تواصلاً،
-- فلا يُحتسب في عدّاد الاتصالات ولا يُطالَب بموعد متابعة.
--
-- كان الاستثناء مكتوباً بالاسم في موضعين ('تغيير مرحلة')، فصار
-- دالةً واحدة — وإلا لاحتاج كل نوع نظامي جديد تعديل موضعين وتذكّرهما.
-- ============================================================
create or replace function public.is_system_activity(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type in ('تغيير مرحلة', 'تسليم');
$$;

comment on function public.is_system_activity(text) is
  'أنشطة يكتبها النظام لا موظف — لا تُحتسب تواصلاً ولا تستلزم موعد متابعة.';

create or replace function public.enforce_activity_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  client_stage text;
begin
  -- ما يكتبه النظام لا يُطالَب بموعد متابعة
  if public.is_system_activity(new.activity_type) then
    return new;
  end if;

  select stage into client_stage
    from public.clients
   where id = new.client_id;

  if not public.is_open_stage(client_stage) then
    -- ملف مغلق: لا خطوة قادمة ولا موعد
    new.next_action := null;
    new.next_action_date := null;
    return new;
  end if;

  if new.next_action_date is null then
    raise exception
      'حدّد موعد المتابعة القادم — إلزامي ما دام ملف العميل مفتوحاً.';
  end if;

  return new;
end;
$$;

create or replace function public.refresh_client_contact(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients c
     set last_contact_at = sub.last_at,
         contact_count   = sub.cnt
    from (
      select max(occurred_at) as last_at, count(*)::int as cnt
        from public.client_activities
       where client_id = cid
         and not public.is_system_activity(activity_type)
    ) sub
   where c.id = cid;
end;
$$;

-- إصلاح أثر رجعي: التسليم لم يكن موجوداً، لكن إعادة الحساب تضمن
-- أن أي سجلّ نظامي قديم لا يُحتسب تواصلاً.
update public.clients c
   set last_contact_at = sub.last_at,
       contact_count   = coalesce(sub.cnt, 0)
  from (
    select client_id, max(occurred_at) as last_at, count(*)::int as cnt
      from public.client_activities
     where not public.is_system_activity(activity_type)
     group by client_id
  ) sub
 where c.id = sub.client_id;

-- ============================================================
-- 2) نهاية الخدمة
-- ============================================================
alter table public.employees
  add column if not exists end_date   date,
  add column if not exists end_reason text;

comment on column public.employees.end_date is
  'تاريخ إنهاء الخدمة — يبقى الموظف في الجدول لأن رواتبه وعمولاته تاريخ لا يُمحى.';

-- ============================================================
-- 3) سجلّ التسليم
--
-- من سلّم إلى من، وكم ملفاً انتقل، ومتى وبأمر مَن. سؤال «أين ذهب
-- عملاء فلان؟» يجب أن يكون له جواب بعد سنة.
-- ============================================================
create table if not exists public.employee_handovers (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  created_by_name    text,
  from_employee      uuid references public.employees(id) on delete set null,
  from_name          text not null,
  to_employee        uuid references public.employees(id) on delete set null,
  to_name            text not null,
  clients_moved      int  not null default 0,
  tasks_moved        int  not null default 0,
  reservations_moved int  not null default 0,
  ended_service      boolean not null default false,
  revoked_access     boolean not null default false,
  note               text
);

create index if not exists idx_handovers_from on public.employee_handovers(from_employee);
create index if not exists idx_handovers_to   on public.employee_handovers(to_employee);

alter table public.employee_handovers enable row level security;

-- التسليم قرار إداري: يقرأه المدير وحده، ولا يكتبه أحد مباشرة —
-- الدالة وحدها تكتبه فلا يوجد سجلّ بلا نقل حقيقي.
drop policy if exists "admin reads handovers" on public.employee_handovers;
create policy "admin reads handovers" on public.employee_handovers
  for select to authenticated
  using ((select public.is_admin()));

-- ============================================================
-- 4) العملية
--
-- كل شيء في استدعاء واحد فيكون ذرّياً: إما أن ينتقل كل شيء وتُغلق
-- الخدمة، أو لا يتغيّر شيء. التسليم على مراحل من الشاشة كان
-- سيترك النظام في منتصف الطريق إن انقطعت الشبكة.
-- ============================================================
create or replace function public.handover_employee(
  p_from          uuid,
  p_to            uuid,
  p_note          text    default null,
  p_end_service   boolean default true,
  p_revoke_access boolean default true
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
           end_date   = (now() at time zone 'Asia/Baghdad')::date,
           end_reason = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_from;

    -- المشرف الخارج يترك مشاريعه بلا مشرف بدل أن تبقى معلّقة باسمه
    update public.projects set supervisor_id = null where supervisor_id = p_from;
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
    'revoked', p_revoke_access and f.user_id is not null
  );
end;
$$;

revoke all on function public.handover_employee(uuid, uuid, text, boolean, boolean) from public;
grant execute on function public.handover_employee(uuid, uuid, text, boolean, boolean) to authenticated;

-- ============================================================
-- 5) التراجع
--
-- الخطأ في إنهاء خدمة وارد — رجل خرج ثم عاد، أو اسم اختير سهواً.
-- إعادة التفعيل تفتح الحساب وتعيد الحالة، ولا تعيد الملفات: تلك
-- عملية تسليم عكسية يقرّرها المدير صراحةً.
-- ============================================================
create or replace function public.reactivate_employee(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.employees%rowtype;
begin
  if not public.is_admin() then
    raise exception 'إعادة التفعيل للمدير وحده';
  end if;

  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;

  update public.employees
     set status = 'active', end_date = null, end_reason = null
   where id = p_employee;

  if e.user_id is not null then
    update auth.users set banned_until = null where id = e.user_id;
  end if;
end;
$$;

revoke all on function public.reactivate_employee(uuid) from public;
grant execute on function public.reactivate_employee(uuid) to authenticated;

-- ============================================================
-- 6) هل حسابي ما زال على رأس العمل؟
--
-- يقرأها الـ middleware ليمنع موظفاً أُنهيت خدمته من تصفّح النظام
-- بجلسة كانت مفتوحة قبل الإنهاء.
-- ============================================================
create or replace function public.my_account_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.employees e
    where e.user_id = auth.uid() and e.status <> 'active'
  );
$$;

grant execute on function public.my_account_active() to authenticated;
