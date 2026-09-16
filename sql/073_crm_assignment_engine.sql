-- ============================================================
-- تلال ERP — 073: محرّك الإسناد وإعادة التوزيع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة — من البيانات لا من الكتب
--
-- في تقارير أيلول ٢٠٢٦: ٦٢ عميلاً «مهملاً»، كلهم صامتون منذ خمسين
-- يوماً، كلهم في مرحلة «اتصال»، وكلهم باسم موظفة واحدة.
--
-- والنظام اليوم يعرض ذلك تحت عنوان «أداء الفريق» في عمود اسمه
-- «بلا تواصل». أي أنه يقول للإدارة: **هذه الموظفة مقصّرة**.
--
-- وهذا استنتاج خاطئ من بيانات صحيحة. النمط — دفعة واحدة، بتاريخ
-- واحد، بمرحلة واحدة، لمالك واحد — نمطُ **استيراد أُسنِد جملةً ولم
-- يُوزَّع**، لا نمط موظفة تتكاسل عن ليداتها.
--
-- والفرق بين القراءتين ليس تفصيلاً: الأولى تُنهي خدمة موظفة،
-- والثانية تُعيد توزيع ليدات.
--
-- ============================================================
-- المبدأ الحاكم
--
--     لا يُقاس الأداء قبل فصل «ما لم يُعطَ» عن «ما أُهمِل».
--
-- ولذلك يفصل هذا الملف ثلاثة أشياء كانت مخلوطة في رقم واحد:
--
--     حجم المُسنَد    ← كم ليداً أُعطي؟        (ليس أداءً)
--     تركّز الإسناد   ← هل أُغرِق بها دفعة؟    (خلل توزيع)
--     العمل عليها     ← ماذا فعل بما أُعطي؟    (هذا الأداء)
--
-- ============================================================
-- ما يضيفه
--
--   1) crm_assignment_rules — قواعد التوزيع (دوري، مشروع، مصدر، منطقة)
--   2) auto_assign_client()  — إسناد ليد واحد حسب القواعد
--   3) crm_owner_load()      — حِمل كل موظف وتشخيصه
--   4) crm_unworked_leads()  — الليدات التي لم يُشتغَل عليها أصلاً
--   5) crm_distribution_alerts() — تنبيهات التركّز والإغراق والخمول
--   6) redistribute_leads()  — إعادة توزيع جماعية بأثر كامل
--
-- ⚠️ التوزيع التلقائي **لا يُربط بأي محفّز في هذا الملف**. الدوال
--    جاهزة وتُستدعى من الواجهة بقرار. إسنادٌ يعمل وحده في الخلفية
--    قبل أن تراه الإدارة تعمل مرة واحدة يصنع فوضى لا يمكن تتبّعها.
--
-- يتطلب: sql/070 و sql/071 (owner_id و client_assignments و assign_client).
-- الملف آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) قواعد التوزيع
-- ------------------------------------------------------------
create table if not exists public.crm_assignment_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  strategy    text not null default 'دوري'
              check (strategy in ('دوري','الأقل حِملاً','ثابت')),
  -- شروط الانطباق: فارغ = ينطبق على الكل
  match_source_id uuid references public.crm_sources(id) on delete cascade,
  match_project_id uuid references public.projects(id)   on delete cascade,
  match_governorate text,
  -- المستفيدون
  target_team_id  uuid references public.teams(id)     on delete cascade,
  target_owner_id uuid references public.employees(id) on delete cascade,
  priority   int not null default 100,   -- الأصغر يُفحص أولاً
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint crm_assignment_rules_fixed_needs_owner check (
    strategy <> 'ثابت' or target_owner_id is not null
  )
);

comment on table public.crm_assignment_rules is
  'قواعد توزيع الليدات. لا تعمل تلقائياً — تُستدعى من الواجهة بقرار (073).';

create index if not exists crm_assignment_rules_prio_idx
  on public.crm_assignment_rules (priority) where is_active;

-- المؤشّر الدوري: أين وقف الدور في آخر توزيع
create table if not exists public.crm_assignment_pointer (
  rule_id     uuid primary key references public.crm_assignment_rules(id) on delete cascade,
  last_owner_id uuid references public.employees(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) المرشّحون لاستلام ليد
--
-- شرطان: على رأس العمل، وله حساب مستخدم. موظفٌ بلا حساب لا يستطيع
-- فتح النظام أصلاً، وإسناد ليد إليه إخفاءٌ له لا توزيع.
-- ------------------------------------------------------------
create or replace function public.crm_assignment_candidates(p_rule_id uuid)
returns table (employee_id uuid, full_name text, open_leads bigint)
language sql stable security definer set search_path = public as $$
  with rule as (
    select * from public.crm_assignment_rules where id = p_rule_id
  )
  select e.id,
         e.full_name,
         count(c.id) filter (where public.is_open_stage(c.stage)) as open_leads
    from public.employees e
    cross join rule r
    left join public.clients c on c.owner_id = e.id
   where e.user_id is not null
     -- ⚠️ القيمة 'active' بالإنجليزية — هو الاصطلاح في employees.status
     --    منذ sql/012 (وعليه تعمل sql/061). لا تكتبها بالعربية.
     and e.status = 'active'
     and e.end_date is null          -- من أُنهيت خدمته لا يستلم ليداً
     and (r.target_owner_id is null or e.id = r.target_owner_id)
     and (r.target_team_id  is null or e.team_id = r.target_team_id)
   group by e.id, e.full_name
   order by e.full_name;
$$;

-- ------------------------------------------------------------
-- 3) إسناد ليد واحد حسب القواعد
--
-- تُرجِع معرّف الموظف المُسنَد إليه، أو NULL إن لم تنطبق قاعدة.
-- NULL جوابٌ صحيح: ليدٌ لا قاعدة له يبقى بلا مالك ويظهر في لوحة
-- التوزيع — أفضل من إسناده عشوائياً لأول اسم في الجدول.
-- ------------------------------------------------------------
create or replace function public.auto_assign_client(p_client_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c     public.clients%rowtype;
  r     public.crm_assignment_rules%rowtype;
  pick  uuid;
  last  uuid;
begin
  select * into c from public.clients where id = p_client_id;
  if c.id is null then
    raise exception 'العميل غير موجود.';
  end if;

  -- أول قاعدة منطبقة حسب الأولوية. الشروط الفارغة تنطبق على الكل،
  -- فقاعدةٌ بلا شروط تصلح شبكة أمان في آخر الأولويات.
  select * into r
    from public.crm_assignment_rules ar
   where ar.is_active
     and (ar.match_source_id is null
          or ar.match_source_id = (select s.id from public.crm_sources s
                                    where s.name = btrim(c.source)))
     and (ar.match_project_id is null or ar.match_project_id = c.project_id)
     and (ar.match_governorate is null
          or public.name_key(ar.match_governorate) = public.name_key(c.governorate))
   order by ar.priority, ar.created_at
   limit 1;

  if r.id is null then
    return null;
  end if;

  if r.strategy = 'ثابت' then
    pick := r.target_owner_id;

  elsif r.strategy = 'الأقل حِملاً' then
    select k.employee_id into pick
      from public.crm_assignment_candidates(r.id) k
     order by k.open_leads asc, k.full_name
     limit 1;

  else  -- دوري
    select last_owner_id into last from public.crm_assignment_pointer where rule_id = r.id;

    -- أول من يلي صاحب الدور السابق أبجدياً، وإلا فالأول من القائمة
    select k.employee_id into pick
      from public.crm_assignment_candidates(r.id) k
     where last is null
        or k.full_name > (select full_name from public.employees where id = last)
     order by k.full_name
     limit 1;

    if pick is null then
      select k.employee_id into pick
        from public.crm_assignment_candidates(r.id) k
       order by k.full_name
       limit 1;
    end if;

    if pick is not null then
      insert into public.crm_assignment_pointer (rule_id, last_owner_id)
      values (r.id, pick)
      on conflict (rule_id) do update
        set last_owner_id = excluded.last_owner_id, updated_at = now();
    end if;
  end if;

  if pick is null then
    return null;
  end if;

  perform public.assign_client(p_client_id, pick,
                               'توزيع تلقائي بالقاعدة: ' || r.name,
                               'توزيع تلقائي');
  return pick;
end; $$;

-- ------------------------------------------------------------
-- 4) حِمل كل موظف — الرقم الذي يفصل التوزيع عن الأداء
--
-- الأعمدة مرتّبة عمداً: ما أُعطي أولاً، ثم ما عُمل عليه، ثم النِسب.
-- من يقرأ الجدول يرى المُدخَل قبل المُخرَج فلا يحكم على الثاني وحده.
-- ------------------------------------------------------------
create or replace function public.crm_owner_load()
returns table (
  owner_id      uuid,
  owner_name    text,
  total_leads   bigint,
  open_leads    bigint,
  won_leads     bigint,
  lost_leads    bigint,
  never_contacted bigint,   -- أُسنِد ولم يُسجَّل عليه تواصل قطّ
  unworked      bigint,     -- مضت مهلة العمل بلا تواصل
  neglected     bigint,     -- مفتوح وصامت فوق حدّ الإهمال
  overdue       bigint,     -- فات موعد متابعته
  last_activity timestamptz,
  over_capacity boolean
)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select public.crm_setting_int('neglected_days', 14)          as neglect_days,
           public.crm_setting_int('unworked_lead_days', 3)       as unworked_days,
           public.crm_setting_int('max_open_leads_per_owner',150) as cap
  )
  select e.id,
         e.full_name,
         count(c.id),
         count(c.id) filter (where public.is_open_stage(c.stage)),
         count(c.id) filter (where c.stage = 'بيع'),
         count(c.id) filter (where c.stage = 'فشل البيع'),
         count(c.id) filter (where c.last_contact_at is null
                               and public.is_open_stage(c.stage)),
         count(c.id) filter (where c.last_contact_at is null
                               and public.is_open_stage(c.stage)
                               and coalesce(c.owner_assigned_at, c.created_at)
                                   < now() - (cfg.unworked_days || ' days')::interval),
         count(c.id) filter (where public.is_open_stage(c.stage)
                               and coalesce(c.last_contact_at, c.created_at)
                                   < now() - (cfg.neglect_days || ' days')::interval),
         count(c.id) filter (where public.is_open_stage(c.stage)
                               and c.follow_up_date < public.baghdad_today()),
         max(c.last_contact_at),
         count(c.id) filter (where public.is_open_stage(c.stage)) > cfg.cap
    from public.employees e
    cross join cfg
    left join public.clients c on c.owner_id = e.id
   where e.user_id is not null
   group by e.id, e.full_name, cfg.cap
  having count(c.id) > 0
   order by count(c.id) filter (where public.is_open_stage(c.stage)) desc;
$$;

comment on function public.crm_owner_load() is
  'حِمل كل موظف. «ما أُعطي» قبل «ما عُمل» — الترتيب مقصود كي لا يُقرأ الثاني وحده.';

-- ------------------------------------------------------------
-- 5) الليدات التي لم يُشتغَل عليها
--    مُسنَدة، مفتوحة، ومضت مهلة العمل بلا تواصل واحد.
-- ------------------------------------------------------------
create or replace function public.crm_unworked_leads(p_owner_id uuid default null)
returns table (
  client_id     uuid,
  client_name   text,
  phone         text,
  stage         text,
  source        text,
  owner_id      uuid,
  owner_name    text,
  assigned_at   timestamptz,
  days_since_assignment int,
  days_silent   int
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone, c.stage, c.source,
         c.owner_id, e.full_name,
         coalesce(c.owner_assigned_at, c.created_at),
         extract(day from now() - coalesce(c.owner_assigned_at, c.created_at))::int,
         extract(day from now() - coalesce(c.last_contact_at, c.created_at))::int
    from public.clients c
    left join public.employees e on e.id = c.owner_id
   where public.is_open_stage(c.stage)
     and c.last_contact_at is null
     and coalesce(c.owner_assigned_at, c.created_at)
         < now() - (public.crm_setting_int('unworked_lead_days', 3) || ' days')::interval
     and (p_owner_id is null or c.owner_id = p_owner_id)
     and (public.is_admin() or public.is_followup_manager() or public.can_see_client(c.id))
   order by coalesce(c.owner_assigned_at, c.created_at);
$$;

-- ------------------------------------------------------------
-- 6) تنبيهات التوزيع — الكشف عن الشذوذ قبل الحكم (§56 و§57)
--
-- كل تنبيه يحمل سببه ورقمه وتوصيته. لا تنبيه بلا تفسير: «الأداء
-- ضعيف» جملةٌ تُتلف سمعة، و«٦٢ ليداً أُسنِدت في يوم واحد ولم
-- يُفتَح منها شيء» جملةٌ تُصلح عملية.
-- ------------------------------------------------------------
create or replace function public.crm_distribution_alerts()
returns table (
  severity   text,      -- عالٍ | متوسط | منخفض
  code       text,
  title      text,
  detail     text,
  subject_id uuid,
  metric     numeric,
  recommendation text
)
language plpgsql stable security definer set search_path = public as $$
declare
  cap        int := public.crm_setting_int('max_open_leads_per_owner', 150);
  total_open bigint;
  r          record;
begin
  if not (public.is_admin() or public.is_followup_manager() or public.is_supervisor()) then
    return;   -- لوحة إدارية: لا تُعرض للموظف
  end if;

  select count(*) into total_open from public.clients where public.is_open_stage(stage);

  -- (أ) تجاوز الطاقة
  for r in select * from public.crm_owner_load() where over_capacity loop
    return query select
      'عالٍ', 'over_capacity',
      'تجاوز طاقة الموظف',
      format('«%s» يملك %s ليداً مفتوحاً والحدّ %s.', r.owner_name, r.open_leads, cap),
      r.owner_id, r.open_leads::numeric,
      'أعد توزيع الفائض على الفريق قبل قياس أدائه.';
  end loop;

  -- (ب) تركّز الإسناد: ثلث الليدات المفتوحة أو أكثر عند شخص واحد
  for r in select * from public.crm_owner_load() loop
    if total_open > 0 and r.open_leads::numeric / total_open >= 0.33 then
      return query select
        'عالٍ', 'owner_concentration',
        'تركّز إسناد',
        format('«%s» يملك %s%% من الليدات المفتوحة (%s من %s).',
               r.owner_name, round(r.open_leads * 100.0 / total_open),
               r.open_leads, total_open),
        r.owner_id, round(r.open_leads * 100.0 / total_open),
        'تركّز التوزيع لا يُقرأ كأداء — راجع طريقة إسناد الدفعات المستوردة.';
    end if;
  end loop;

  -- (ج) دفعة غير مُشتغَلة: نصف ما أُسنِد لم يُفتح أصلاً
  for r in select * from public.crm_owner_load() where unworked > 0 loop
    if r.open_leads > 0 and r.unworked::numeric / r.open_leads >= 0.5 then
      return query select
        'عالٍ', 'unworked_batch',
        'دفعة لم يُشتغَل عليها',
        format('«%s»: %s من %s ليداً مفتوحاً بلا تواصل واحد منذ إسنادها.',
               r.owner_name, r.unworked, r.open_leads),
        r.owner_id, r.unworked::numeric,
        'افحص إن كانت دفعة مستوردة أُسنِدت جملةً قبل أن تُعدّ تقصيراً.';
    end if;
  end loop;

  -- (د) موظف بلا نشاط
  for r in select * from public.crm_owner_load()
            where last_activity is null or last_activity < now() - interval '14 days' loop
    return query select
      'متوسط', 'inactive_owner',
      'موظف بلا نشاط مسجَّل',
      format('«%s» لم يسجّل تواصلاً منذ %s.',
             r.owner_name,
             coalesce(to_char(r.last_activity, 'YYYY-MM-DD'), 'الإطلاق')),
      r.owner_id, extract(day from now() - coalesce(r.last_activity, now()))::numeric,
      'تحقّق من الإجازة أو تسليم العهدة قبل أي قراءة أخرى.';
  end loop;

  -- (هـ) ليدات مفتوحة بلا مالك — لا يراها أحد ولا يحاسَب عليها أحد
  if exists (select 1 from public.clients
              where owner_id is null and public.is_open_stage(stage)) then
    return query select
      'عالٍ', 'ownerless_leads',
      'ليدات بلا مالك',
      format('%s ليداً مفتوحاً بلا مالك — لا يظهر في متابعة أحد.',
             (select count(*) from public.clients
               where owner_id is null and public.is_open_stage(stage))),
      null::uuid,
      (select count(*) from public.clients
        where owner_id is null and public.is_open_stage(stage))::numeric,
      'وزّعها من لوحة التوزيع — بقاؤها بلا مالك خسارةٌ صامتة.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 7) إعادة التوزيع الجماعية
--
-- ⚠️ كل نقل يمرّ بـ assign_client() لا بـ UPDATE مباشر — فيخضع
--    لفحص الصلاحية ويُكتب في client_assignments بسببه. لا نقل
--    جماعي بلا أثر فردي لكل ليد.
--
-- p_only_unworked = true (الافتراضي): لا تُنقل إلا الليدات التي لم
-- يُشتغَل عليها. سحبُ ليد بدأ صاحبه فعلاً في العمل عليه يُضيّع علاقة
-- بُنيت ويُربك العميل.
-- ------------------------------------------------------------
create or replace function public.redistribute_leads(
  p_from_owner_id uuid,
  p_to_owner_ids  uuid[],
  p_limit         int default 50,
  p_only_unworked boolean default true,
  p_reason        text default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  c        record;
  i        int := 0;
  n        int := array_length(p_to_owner_ids, 1);
  target   uuid;
begin
  if not (auth.uid() is null or public.is_admin() or public.is_followup_manager()) then
    raise exception 'إعادة التوزيع من صلاحية الإدارة ومدير المتابعة.';
  end if;
  if n is null or n = 0 then
    raise exception 'حدّد موظفاً واحداً على الأقل لاستلام الليدات.';
  end if;

  for c in
    select cl.id
      from public.clients cl
     where cl.owner_id is not distinct from p_from_owner_id
       and public.is_open_stage(cl.stage)
       and (not p_only_unworked or cl.last_contact_at is null)
     order by coalesce(cl.owner_assigned_at, cl.created_at)
     limit greatest(p_limit, 0)
  loop
    target := p_to_owner_ids[(i % n) + 1];
    perform public.assign_client(
      c.id, target,
      coalesce(p_reason, 'إعادة توزيع جماعية'),
      'إعادة توزيع');
    i := i + 1;
  end loop;

  return i;
end; $$;

-- ------------------------------------------------------------
-- 8) الصلاحيات
-- ------------------------------------------------------------
alter table public.crm_assignment_rules   enable row level security;
alter table public.crm_assignment_pointer enable row level security;

drop policy if exists "read assignment rules" on public.crm_assignment_rules;
create policy "read assignment rules" on public.crm_assignment_rules
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager()));

drop policy if exists "admin writes assignment rules" on public.crm_assignment_rules;
create policy "admin writes assignment rules" on public.crm_assignment_rules
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read assignment pointer" on public.crm_assignment_pointer;
create policy "read assignment pointer" on public.crm_assignment_pointer
  for select to authenticated using ((select public.is_admin()));

revoke all on function public.crm_assignment_candidates(uuid) from public;
revoke all on function public.auto_assign_client(uuid)        from public;
revoke all on function public.crm_owner_load()                from public;
revoke all on function public.crm_unworked_leads(uuid)        from public;
revoke all on function public.crm_distribution_alerts()       from public;
revoke all on function public.redistribute_leads(uuid, uuid[], int, boolean, text) from public;

grant execute on function public.crm_assignment_candidates(uuid) to authenticated, service_role;
grant execute on function public.auto_assign_client(uuid)        to authenticated, service_role;
grant execute on function public.crm_owner_load()                to authenticated, service_role;
grant execute on function public.crm_unworked_leads(uuid)        to authenticated, service_role;
grant execute on function public.crm_distribution_alerts()       to authenticated, service_role;
grant execute on function public.redistribute_leads(uuid, uuid[], int, boolean, text)
  to authenticated, service_role;

drop trigger if exists trg_audit_assignment_rules on public.crm_assignment_rules;
create trigger trg_audit_assignment_rules
  after insert or update or delete on public.crm_assignment_rules
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 9) التحقّق — يشخّص بياناتك الآن
-- ------------------------------------------------------------
do $$
declare
  r record;
  n_alerts int := 0;
begin
  raise notice '--- 073 محرّك الإسناد ---';
  raise notice 'حِمل الموظفين:';
  for r in select * from public.crm_owner_load() limit 10 loop
    raise notice '  % — مفتوح % | بلا تواصل قطّ % | مهمل % | متأخر %',
      r.owner_name, r.open_leads, r.never_contacted, r.neglected, r.overdue;
  end loop;

  raise notice 'التنبيهات:';
  for r in select * from public.crm_distribution_alerts() loop
    n_alerts := n_alerts + 1;
    raise notice '  [%] % — %', r.severity, r.title, r.detail;
    raise notice '        ↳ %', r.recommendation;
  end loop;

  if n_alerts = 0 then
    raise notice '  لا شذوذ في التوزيع.';
  end if;
end $$;

notify pgrst, 'reload schema';
