-- ============================================================
-- تلال ERP — 218: مركز استقبال الليدات — كل ليد يُسجَّل أولاً
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ============================================================
-- المشكلة — من الكود لا من الانطباع
--
-- البوّابة موجودة منذ 079 (crm_lead_intake → intake_lead) ويدخلها
-- مصدران فقط: Meta (meta-leads) والنموذج العام (/f/). أما الطريق الذي
-- تمرّ منه أغلب الليدات فعلاً — موظفٌ يقرأ رسالة أو ملفّ Excel ثم
-- يفتح «إضافة عميل» — فيكتب في clients مباشرة ولا يترك أثراً في
-- البوّابة. والنتيجة:
--
--   • لا سجلّ واحد لـ«ما وصل»؛ فلا مطابقة بين ما أبلغت عنه المنصّة
--     وما دخل النظام. الليد الذي لم يُدخَل لا يُرى أصلاً.
--   • الاستيراد يرفض المكرّر رفضاً (لا يربطه)، فعميلٌ عاد من حملة
--     جديدة يضيع إسناده لها.
--   • meta-leads يبتلع الخطأ ويُرجع 200 (كي لا يعيد Meta الإرسال)
--     ويكتب سطراً في mkt_event_errors — والليد نفسه لا يُعاد جلبه.
--   • intake_lead إن فشل الإدخال في clients يرمي الاستثناء ويبقى
--     الصفّ «جديد» إلى الأبد: process_lead_intake غير مجدولة.
--   • auto_assign_client يُسند لموظف في إجازة معتمدة، ولا يحترم سقف
--     الحِمل، وليس آمناً عند وصول ليدين في اللحظة نفسها.
--   • مهلة أول تواصل تُفحص مرة يومياً (075) — ليد الصباح يُكتشف
--     تأخّره صباح الغد.
--
-- ============================================================
-- المبدأ الحاكم
--
--     crm_lead_intake هو دفتر الوارد. كل ليد — من أي باب دخل —
--     له فيه صفّ: إمّا محوَّل إلى عميل، أو مربوط بعميل قائم، أو في
--     قائمة أخطاء ظاهرة تنتظر قراراً. لا رابع.
--
-- ولا جدول ليدات ثانٍ: البطاقة (clients) تبقى السجلّ الموحّد للعميل،
-- والدفتر يحفظ كل «وصول» له من كل مصدر — فيبقى لعميلٍ واحد تاريخُ
-- مصادر متعدّدة بلا بطاقات مكرّرة.
--
-- ============================================================
-- ما يضيفه
--
--   1) أعمدة الدفتر: البريد، القناة، الحملة والمشروع بالمفتاح، معرّفات
--      الاستمارة والإعلان، نصّ الرسالة، المحاولات والخطأ، المعالجة
--      اليدوية؛ وحالتان: «بانتظار الجلب» و«خطأ».
--   2) lead_import_batches — دفعات استيراد Lead Sheets.
--   3) crm_assignment_availability — إيقاف استلام الليدات مؤقتاً.
--   4) إعدادات قابلة للضبط (crm_settings) بلا أرقام في الكود.
--   5) intake_lead v2 — لا يرمي أبداً: الفشل يصير «خطأ» يُعاد.
--   6) دفتر البطاقات: كل عميل يُنشأ خارج البوّابة يُسجَّل فيها
--      (محفّز) + تعبئة التاريخ.
--   7) lead_capture — الإدخال المركزي لرسائل السوشيال والهاتف.
--   8) lead_import_* — استيراد آمن عند الإعادة.
--   9) lead_intake_resolve — تصحيح / إعادة / إهمال بسبب.
--  10) scan_lead_intake — كل ١٥ دقيقة: إعادة، تنبيه غير الموزَّع،
--      تنبيه الأخطاء، تراكم الموظف، فجوة المطابقة.
--  11) lead_hub_summary / lead_hub_breakdown — اللوحة الرقابية.
--
-- ⚠️ يمسّ دوالّ قائمة (منسوخة حرفياً مع التغيير المعلَّم «218»):
--    assign_client (071)، guard_client_owner (104)، auto_assign_client
--    (073)، crm_assignment_candidates (216)، intake_lead (079).
--    والعَلَم tilal.system_assign — مثل tilal.merging — تضعه دوالّ
--    definer وحدها، ولا تصل إليه PostgREST.
--
-- يتطلب: 071 073 075 079 104 124 195 200 211 212 216 217.
-- آمن لإعادة التشغيل. لا يحذف ولا يعدّل بيانات قائمة إلا بإضافة
-- صفوف الدفتر للبطاقات القديمة (provider = 'legacy').
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة الدفتر
-- ------------------------------------------------------------
alter table public.crm_lead_intake
  add column if not exists email         text,
  add column if not exists email_key     text generated always as (lower(nullif(btrim(email), ''))) stored,
  add column if not exists channel       text,          -- facebook | instagram | messenger | instagram_dm | whatsapp | phone | walk_in | …
  add column if not exists campaign_id   uuid references public.crm_campaigns(id) on delete set null,
  add column if not exists project_id    uuid references public.projects(id) on delete set null,
  add column if not exists form_ref      text,          -- معرّف الاستمارة عند المنصّة
  add column if not exists ad_ref        text,          -- معرّف الإعلان عند المنصّة
  add column if not exists message       text,          -- نصّ الرسالة / الطلب بالقدر اللازم للعمل
  add column if not exists batch_id      uuid,
  add column if not exists captured_by   uuid references auth.users(id) on delete set null,
  add column if not exists assign_to     uuid references public.employees(id) on delete set null,
  add column if not exists attempts      int not null default 0,
  add column if not exists last_error    text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists dup_reason    text,
  add column if not exists alerted_at    timestamptz,
  add column if not exists resolved_at   timestamptz,
  add column if not exists resolved_by   uuid references auth.users(id) on delete set null,
  add column if not exists resolution    text;

-- قيد الحالة: يُحذف أيّاً كان اسمه (أُنشئ مضمَّناً في 079) ثم يُعاد
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.crm_lead_intake'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.crm_lead_intake drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.crm_lead_intake add constraint crm_lead_intake_status_check
  check (status in ('بانتظار الجلب', 'جديد', 'مُحوَّل', 'مكرّر', 'مرفوض', 'خطأ'));

comment on column public.crm_lead_intake.status is
  'بانتظار الجلب = وصل الحدث ولم تُجلب تفاصيله بعد (Meta). خطأ = فشلت المعالجة وتُعاد تلقائياً. '
  'مرفوض = لا يصلح عميلاً (بلا رقم صالح) وينتظر تصحيحاً أو إهمالاً بسبب. 218';

create index if not exists crm_lead_intake_client_idx   on public.crm_lead_intake (client_id);
create index if not exists crm_lead_intake_batch_idx    on public.crm_lead_intake (batch_id) where batch_id is not null;
create index if not exists crm_lead_intake_email_idx    on public.crm_lead_intake (email_key) where email_key is not null;
create index if not exists crm_lead_intake_received_idx on public.crm_lead_intake (received_at desc);
create index if not exists crm_lead_intake_queue_idx
  on public.crm_lead_intake (status, next_retry_at)
  where status in ('بانتظار الجلب', 'جديد', 'خطأ', 'مرفوض');

-- ------------------------------------------------------------
-- 2) دفعات استيراد Lead Sheets
--
-- لا يُعاد استعمال crm_import_runs (089): ذاك سجلّ بطاقات بعد الحفظ
-- بلا ربط صفّ بصفّ. هنا كل صفّ من الملف صفٌّ في الدفتر يحمل batch_id،
-- فالأرقام تُحسب من الدفتر نفسه ولا تُكتب مرتين.
-- ------------------------------------------------------------
create table if not exists public.lead_import_batches (
  id           uuid primary key default gen_random_uuid(),
  file_name    text,
  file_hash    text,
  campaign_id  uuid references public.crm_campaigns(id) on delete set null,
  project_id   uuid references public.projects(id) on delete set null,
  channel      text,
  mapping      jsonb,
  rows_sent    int not null default 0,     -- صفوف أُرسلت للحفظ (مع الإعادات)
  rows_already int not null default 0,     -- سبق تسجيلها (إعادة ملف أو ليد وصل بالويبهوك)
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_lead_intake_batch_fk') then
    alter table public.crm_lead_intake add constraint crm_lead_intake_batch_fk
      foreign key (batch_id) references public.lead_import_batches(id) on delete set null;
  end if;
end $$;

comment on table public.lead_import_batches is
  'دفعة Lead Sheet. الأرقام (جديد/مكرّر/مرفوض/خطأ) تُحسب من crm_lead_intake.batch_id. 218';

-- ------------------------------------------------------------
-- 3) التوافر — «أوقف عنّي الليدات» بلا تعديل قواعد التوزيع
-- ------------------------------------------------------------
create table if not exists public.crm_assignment_availability (
  employee_id  uuid primary key references public.employees(id) on delete cascade,
  paused       boolean not null default true,
  paused_until timestamptz,
  reason       text,
  updated_by   uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now()
);

alter table public.crm_assignment_rules
  add column if not exists match_campaign_id uuid references public.crm_campaigns(id) on delete cascade;

-- ------------------------------------------------------------
-- 4) الإعدادات — تُضبط من مركز الإعدادات (070) لا من الكود
-- ------------------------------------------------------------
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('lead_unassigned_alert_minutes', '30', 'مهلة ليد بلا توزيع',
   'ليد دخل النظام ولم يُسنَد لموظف خلال هذه المدة يُنبَّه به الموزّعون (المدير، مدير المتابعة، مشرف المشروع).', 'دقيقة', 5, 1440),
  ('lead_intake_max_attempts', '6', 'محاولات إعادة معالجة الليد',
   'بعدها يبقى الليد في قائمة الأخطاء ويُنبَّه به المدير ومدير التسويق.', 'عدد', 1, 20),
  ('lead_assign_respect_cap', '1', 'احترام سقف الحِمل في التوزيع التلقائي',
   '1 = لا يُسنَد ليد لموظف بلغ «الحدّ الأعلى لليدات المفتوحة». 0 = السقف للتنبيه فقط.', 'عدد', 0, 1),
  ('lead_backlog_alert_count', '15', 'حدّ تراكم الليدات غير المتّصَل بها',
   'موظف لديه هذا العدد من الليدات تجاوزت مهلة أول تواصل يُنبَّه به مشرفه ومدير المتابعة مرة يومياً.', 'عدد', 1, 500),
  ('lead_gap_alert_percent', '10', 'حدّ فجوة المطابقة',
   'إذا زاد ما أبلغت عنه المنصّة عن الواصل للنظام بهذه النسبة ليوم أمس يُنبَّه مدير التسويق.', 'نسبة', 1, 100)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 5) ختم الدفتر: الحملة والمشروع بالمفتاح، والقناة
--
-- الاسم يبدأ بـ trg_z ليعمل بعد trg_mkt_intake_resolve (124) الذي
-- يترجم رمز الحملة (utm_campaign) إلى اسمها.
-- ------------------------------------------------------------
create or replace function public.lead_intake_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.campaign_id is null and nullif(btrim(coalesce(new.campaign_ref, '')), '') is not null then
      select id into new.campaign_id from public.crm_campaigns
       where name = btrim(new.campaign_ref) order by created_at limit 1;
    end if;
    if new.campaign_id is not null then
      -- intake_lead يطابق الحملة بالاسم منذ 079: نُبقي الاسم صحيحاً
      select name into new.campaign_ref from public.crm_campaigns where id = new.campaign_id;
      if new.project_id is null then
        select project_id into new.project_id from public.crm_campaigns where id = new.campaign_id;
      end if;
    end if;
    new.channel := coalesce(nullif(btrim(new.channel), ''),
                            nullif(lower(coalesce(new.raw->'utm'->>'utm_source', '')), ''),
                            case new.provider when 'meta' then 'facebook' when 'landing' then 'landing'
                                              when 'website' then 'website' when 'whatsapp' then 'whatsapp' end);
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.alerted_at := null;   -- حالة جديدة = تنبيه جديد إن لزم
    end if;
  exception when others then
    insert into public.mkt_event_errors (source, message, context)
    values ('lead_intake_stamp', sqlerrm, jsonb_build_object('intake', new.id));
  end;
  return new;
end $$;

drop trigger if exists trg_z_lead_intake_stamp on public.crm_lead_intake;
create trigger trg_z_lead_intake_stamp
  before insert or update of campaign_ref, campaign_id, raw, channel, status on public.crm_lead_intake
  for each row execute function public.lead_intake_stamp();

-- ليد Meta يُحفظ أولاً «بانتظار الجلب» ثم تُملأ حمولته: المترجم (124)
-- يجب أن يعمل حين تصل الحمولة لا عند الإدخال وحده
drop trigger if exists trg_mkt_intake_resolve_upd on public.crm_lead_intake;
create trigger trg_mkt_intake_resolve_upd
  before update of raw on public.crm_lead_intake
  for each row when (old.status in ('بانتظار الجلب', 'خطأ'))
  execute function public.mkt_intake_resolve();

-- ------------------------------------------------------------
-- 6) الإسناد الآلي من داخل البوّابة
--
-- intake_lead يُستدعى من موظف تسويق يسجّل ليداً (lead_capture) — وهو
-- لا يملك نقل الملكية. فالتوزيع بالقواعد كان سيرفضه guard_client_owner
-- و assign_client. العَلَم tilal.system_assign يضعه intake_lead وحده
-- حول نداء التوزيع، كما يضع merge_clients العَلَم tilal.merging.
-- ------------------------------------------------------------
create or replace function public.guard_client_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;

  -- 218: توزيع البوّابة بالقواعد
  if current_setting('tilal.system_assign', true) = 'on' then
    return new;
  end if;

  if auth.uid() is null
     or public.is_admin()
     or public.is_followup_manager()
     or (public.is_supervisor()
         and (old.owner_id is null or old.owner_id in (select s.id from public.my_scope_employees() s))
         and (new.owner_id is null or new.owner_id in (select s.id from public.my_scope_employees() s)))
  then
    return new;
  end if;

  raise exception 'نقل ملكية العميل من صلاحية الإدارة والمشرف ومدير المتابعة.';
end; $$;

create or replace function public.assign_client(
  p_client_id uuid,
  p_owner_id  uuid,
  p_reason    text default null,
  p_method    text default 'يدوي'
) returns void language plpgsql security definer set search_path = public as $$
declare
  cur_owner uuid;
  ok        boolean;
begin
  select owner_id into cur_owner from public.clients where id = p_client_id;
  if not found then
    raise exception 'العميل غير موجود.';
  end if;

  ok := auth.uid() is null
        or current_setting('tilal.system_assign', true) = 'on'   -- 218
        or public.is_admin()
        or public.is_followup_manager()
        or (public.is_supervisor()
            and (cur_owner is null or cur_owner in (select s.id from public.my_scope_employees() s))
            and (p_owner_id is null or p_owner_id in (select s.id from public.my_scope_employees() s)));

  if not ok then
    raise exception 'لا تملك صلاحية نقل ملكية هذا العميل.';
  end if;

  if p_owner_id is not null
     and not exists (select 1 from public.employees where id = p_owner_id) then
    raise exception 'الموظف المستلِم غير موجود.';
  end if;

  if cur_owner is not distinct from p_owner_id then
    return;
  end if;

  update public.clients
     set owner_id = p_owner_id,
         owner_assigned_at = now()
   where id = p_client_id;

  update public.client_assignments
     set reason = coalesce(p_reason, reason),
         method = p_method
   where id = (select id from public.client_assignments
                where client_id = p_client_id order by at desc limit 1);
end; $$;

-- المرشّحون (216) + لا إجازة معتمدة اليوم + لا إيقاف يدوي + سقف الحِمل
create or replace function public.crm_assignment_candidates(p_rule_id uuid)
returns table (employee_id uuid, full_name text, open_leads bigint)
language sql stable security definer set search_path = public as $$
  with rule as (
    select * from public.crm_assignment_rules where id = p_rule_id
  ),
  cfg as (
    select public.crm_setting_int('max_open_leads_per_owner', 150) as cap,
           public.crm_setting_int('lead_assign_respect_cap', 1)    as use_cap
  ),
  k as (
    select e.id,
           e.full_name,
           count(c.id) filter (where public.is_open_stage(c.stage)) as open_leads
      from public.employees e
      cross join rule r
      left join public.clients c
             on c.owner_id = e.id and c.deleted_at is null and c.merged_into is null
     where e.user_id is not null
       and e.status = 'active'
       and e.end_date is null
       and (r.target_owner_id is null or e.id = r.target_owner_id)
       and (r.target_team_id  is null
            or e.project_id = r.target_team_id
            or exists (select 1 from public.employee_projects ep
                        where ep.employee_id = e.id and ep.project_id = r.target_team_id))
       -- 218: من في إجازة معتمدة اليوم لا يستلم
       and not exists (select 1 from public.leaves l
                        where l.employee_id = e.id and l.status = 'موافق عليها'
                          and public.baghdad_today() between l.start_date and l.end_date)
       -- 218: إيقاف يدوي من شاشة التوزيع
       and not exists (select 1 from public.crm_assignment_availability a
                        where a.employee_id = e.id and a.paused
                          and (a.paused_until is null or a.paused_until > now()))
     group by e.id, e.full_name
  )
  select k.id, k.full_name, k.open_leads
    from k cross join cfg
   where cfg.use_cap = 0 or k.open_leads < cfg.cap
   order by k.full_name;
$$;

-- إسناد ليد واحد — 218: يمرّ على القواعد بالأولوية حتى يجد مرشّحاً
-- (قاعدة «ثابت» لموظف في إجازة تُسلِّم للتالية بدل أن تُسند له)،
-- يطابق الحملة، ويقفل مؤشّر الدور كي لا يأخذ ليدان متزامنان الموظف نفسه.
create or replace function public.auto_assign_client(p_client_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c     public.clients%rowtype;
  r     public.crm_assignment_rules%rowtype;
  v_src uuid;
  pick  uuid;
  last  uuid;
begin
  select * into c from public.clients where id = p_client_id;
  if c.id is null then
    raise exception 'العميل غير موجود.';
  end if;

  select s.id into v_src from public.crm_sources s where s.name = btrim(c.source) limit 1;

  for r in
    select * from public.crm_assignment_rules ar
     where ar.is_active
       and (ar.match_source_id   is null or ar.match_source_id   = v_src)
       and (ar.match_project_id  is null or ar.match_project_id  = c.project_id)
       and (ar.match_campaign_id is null or ar.match_campaign_id = c.campaign_id)
       and (ar.match_governorate is null
            or public.name_key(ar.match_governorate) = public.name_key(c.governorate))
     order by ar.priority, ar.created_at
  loop
    perform pg_advisory_xact_lock(hashtext('crm_assign:' || r.id::text));
    pick := null;

    if r.strategy = 'ثابت' then
      select k.employee_id into pick
        from public.crm_assignment_candidates(r.id) k
       where k.employee_id = r.target_owner_id;

    elsif r.strategy = 'الأقل حِملاً' then
      select k.employee_id into pick
        from public.crm_assignment_candidates(r.id) k
       order by k.open_leads asc, k.full_name
       limit 1;

    else  -- دوري
      select last_owner_id into last from public.crm_assignment_pointer where rule_id = r.id;

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

    exit when pick is not null;
  end loop;

  if pick is null then
    return null;
  end if;

  perform public.assign_client(p_client_id, pick,
                               'توزيع تلقائي بالقاعدة: ' || r.name,
                               'توزيع تلقائي');
  return pick;
end; $$;

-- ------------------------------------------------------------
-- 7) مستلمو التنبيهات
-- ------------------------------------------------------------
-- الموزّعون: المدير ومدير المتابعة ومشرف المشروع
create or replace function public.lead_distributor_users(p_project uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p where p.role in ('admin', 'followup_manager')
  union
  select s.user_id from public.projects t
    join public.employees s on s.id = t.supervisor_id
   where t.id = p_project and s.user_id is not null;
$$;

-- أصحاب التكامل: المدير ومدير التسويق
create or replace function public.lead_intake_admin_users()
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p where p.role = 'admin'
  union
  select e.user_id from public.mkt_team t
    join public.employees e on e.id = t.employee_id
   where t.mkt_role = 'مدير التسويق' and t.is_active and e.status = 'active' and e.user_id is not null;
$$;

create or replace function public.lead_notify_owner(p_client uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select e.user_id into v_user from public.clients c join public.employees e on e.id = c.owner_id
   where c.id = p_client;
  if v_user is not null then
    insert into public.notifications
      (user_id, title, body, link, kind, category, entity_type, entity_id, priority)
    values (v_user, p_title, p_body, '/dashboard/clients/' || p_client, 'عام', 'leads', 'client', p_client, 'عالية');
  end if;
end $$;

-- ------------------------------------------------------------
-- 8) intake_lead v2
--
-- ما بقي من 079: الرفض بلا رقم صالح، الربط بالعميل القائم مع نشاط
-- «عاد عبر…» بموعد اليوم، الإدخال كـ«ليد» ثم التوزيع ثم الدرجة.
-- الجديد (218):
--   • كل شيء داخل كتلة استثناء: الفشل ⇒ «خطأ» + موعد إعادة. لا يضيع.
--   • التكرار بالبريد أيضاً (عبر دفتر سابق)، والمدموج لا يُطابَق.
--   • الحملة والمشروع والمالك المطلوب (تسجيل الموظف لنفسه) تصل للبطاقة.
--   • عميلٌ عائد مالكه غير متاح (انتهت خدمته/موقوف) يُعاد توزيعه.
--   • إشعار لصاحب الليد: جديد مُسند، أو عميل عائد.
-- ------------------------------------------------------------
create or replace function public.intake_lead(p_intake_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  it        public.crm_lead_intake%rowtype;
  dup_id    uuid;
  v_dup_why text;
  s_id      uuid;
  camp_id   uuid;
  new_id    uuid;
  v_owner   uuid;
  v_label   text;
begin
  select * into it from public.crm_lead_intake where id = p_intake_id for update;
  if it.id is null then
    raise exception 'صفّ الاستقبال غير موجود.';
  end if;
  if it.status <> 'جديد' then
    return it.client_id;   -- عولج سابقاً
  end if;

  v_label := coalesce(it.channel, it.provider)
             || coalesce(' — حملة ' || it.campaign_ref, '');

  begin
    -- (أ) التكرار: الهاتف ثم البريد
    if it.phone_key is not null then
      select id into dup_id from public.clients
       where deleted_at is null and merged_into is null
         and (phone_key = it.phone_key or alt_phone_key = it.phone_key)
       order by created_at
       limit 1;
      if dup_id is not null then v_dup_why := 'نفس الهاتف'; end if;
    end if;
    if dup_id is null and it.email_key is not null then
      select i.client_id into dup_id
        from public.crm_lead_intake i
        join public.clients c on c.id = i.client_id
       where i.email_key = it.email_key and i.id <> it.id
         and c.deleted_at is null and c.merged_into is null
       order by i.received_at
       limit 1;
      if dup_id is not null then v_dup_why := 'نفس البريد'; end if;
    end if;

    -- (ب) لا رقم صالح ولا مطابقة: يُرفض ولا يلوّث العملاء — وينتظر تصحيحاً
    if dup_id is null and it.phone_key is null then
      update public.crm_lead_intake
         set status = 'مرفوض', processed_at = now(),
             reject_reason = case when nullif(btrim(coalesce(it.phone, '')), '') is null
                                  then 'بلا رقم هاتف'
                                  else 'رقم هاتف غير صالح: ' || it.phone end
       where id = p_intake_id;
      return null;
    end if;

    select id into s_id from public.crm_sources where name = btrim(coalesce(it.source_ref, ''));
    camp_id := coalesce(it.campaign_id,
                        (select id from public.crm_campaigns where name = btrim(coalesce(it.campaign_ref, '')) limit 1));

    -- (ج) عميل قائم: آخر لمسة + نشاط بموعد اليوم + مالك متاح
    if dup_id is not null then
      update public.clients
         set latest_source_id = coalesce(s_id, latest_source_id),
             campaign_id      = coalesce(campaign_id, camp_id)
       where id = dup_id;

      -- ⚠️ بموعد متابعة اليوم: enforce_activity_followup (028)
      insert into public.client_activities
        (client_id, activity_type, summary, actor_name, next_action, next_action_date)
      values (dup_id, 'ملاحظة',
              'عاد عبر ' || v_label || coalesce(E'\n' || left(it.message, 500), ''),
              'النظام', 'عميل عائد — تواصل اليوم', public.baghdad_today());

      select owner_id into v_owner from public.clients where id = dup_id;
      if v_owner is null or not exists (
           select 1 from public.employees e
            where e.id = v_owner and e.status = 'active' and e.end_date is null and e.user_id is not null) then
        perform set_config('tilal.system_assign', 'on', true);
        perform public.auto_assign_client(dup_id);
        perform set_config('tilal.system_assign', 'off', true);
      end if;

      perform public.lead_notify_owner(dup_id, 'عميل عائد',
        'تواصل من جديد عبر ' || v_label || ' — تواصل اليوم.');

      update public.crm_lead_intake
         set status = 'مكرّر', client_id = dup_id, dup_reason = v_dup_why,
             campaign_id = coalesce(campaign_id, camp_id), processed_at = now()
       where id = p_intake_id;
      return dup_id;
    end if;

    -- (د) عميل جديد — الدفتر يكتب نفسه هنا، فمحفّز البطاقات يتنحّى
    perform set_config('tilal.intake', 'on', true);
    insert into public.clients
      (name, phone, source, original_source_id, latest_source_id, campaign_id, project_id, owner_id,
       medium, content, first_touch_at, stage, notes)
    values
      (coalesce(nullif(btrim(it.name), ''), 'ليد من ' || coalesce(it.channel, it.provider)),
       it.phone, it.source_ref, s_id, s_id, camp_id, it.project_id, it.assign_to,
       it.medium, it.content, it.received_at, 'ليد',
       'استُقبل عبر ' || v_label
         || coalesce(E'\nالبريد: ' || it.email, '')
         || coalesce(E'\n' || left(it.message, 1000), ''))
    returning id into new_id;
    perform set_config('tilal.intake', 'off', true);

    if it.assign_to is null then
      perform set_config('tilal.system_assign', 'on', true);
      perform public.auto_assign_client(new_id);
      perform set_config('tilal.system_assign', 'off', true);
    end if;

    update public.crm_lead_intake
       set status = 'مُحوَّل', client_id = new_id, campaign_id = coalesce(campaign_id, camp_id),
           processed_at = now(), last_error = null
     where id = p_intake_id;

    if it.assign_to is null then
      perform public.lead_notify_owner(new_id, 'ليد جديد مُسنَد إليك',
        coalesce(nullif(btrim(it.name), ''), 'ليد') || ' — ' || v_label);
    end if;

    perform public.refresh_lead_scores(new_id);
    return new_id;

  exception when others then
    -- كل ما سبق تراجع؛ الصفّ يبقى ظاهراً ويُعاد بمهلة متصاعدة
    update public.crm_lead_intake
       set status = 'خطأ',
           attempts = attempts + 1,
           last_error = left(sqlerrm, 1000),
           next_retry_at = now() + make_interval(mins => (5 * power(2, least(attempts, 7)))::int)
     where id = p_intake_id;
    return null;
  end;
end $$;

-- ------------------------------------------------------------
-- 9) دفتر البطاقات — لا ليد خارج الدفتر
--
-- عميلٌ أُنشئ من «إضافة عميل» أو الاستيراد القديم أو بوّابة الوسطاء
-- يُسجَّل وصوله هنا (مُحوَّل، مربوط ببطاقته). لا يمسّ الإدخال: أيّ
-- خطأ يُكتب في mkt_event_errors ولا يُسقط حفظ العميل.
-- ------------------------------------------------------------
create or replace function public.lead_ledger_from_card()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tilal.intake', true), '') = 'on' then
    return null;
  end if;
  begin
    insert into public.crm_lead_intake
      (provider, external_id, received_at, raw, name, phone, status, client_id, processed_at,
       campaign_id, project_id, source_ref, medium, content, captured_by)
    values
      (case when new.broker_company_id is not null then 'broker' else 'card' end,
       'client:' || new.id, new.created_at, jsonb_build_object('origin', 'card'),
       new.name, new.phone, 'مُحوَّل', new.id, now(),
       new.campaign_id, new.project_id, new.source, new.medium, new.content, auth.uid())
    on conflict (provider, external_id) do nothing;
  exception when others then
    insert into public.mkt_event_errors (source, message, context)
    values ('lead_ledger_from_card', sqlerrm, jsonb_build_object('client', new.id));
  end;
  return null;
end $$;

drop trigger if exists trg_lead_ledger_from_card on public.clients;
create trigger trg_lead_ledger_from_card
  after insert on public.clients
  for each row execute function public.lead_ledger_from_card();

-- التعبئة: كل بطاقة قائمة بلا صفّ في الدفتر تأخذ صفّاً «legacy».
-- التاريخ = الأقدم من تاريخ الإدخال وتاريخ الإنشاء (كما في mkt_lead_facts).
insert into public.crm_lead_intake
  (provider, external_id, received_at, raw, name, phone, status, client_id, processed_at,
   campaign_id, project_id, source_ref, reject_reason, dup_reason)
select 'legacy', 'client:' || c.id,
       least(c.created_at, coalesce(c.entry_date::timestamp at time zone 'Asia/Baghdad', c.created_at)),
       jsonb_build_object('origin', 'backfill_218'),
       c.name, c.phone,
       case when c.deleted_at is not null then 'مرفوض'
            when c.merged_into is not null then 'مكرّر'
            else 'مُحوَّل' end,
       coalesce(c.merged_into, c.id), c.created_at,
       c.campaign_id, c.project_id, c.source,
       case when c.deleted_at is not null then 'بطاقة محذوفة' end,
       case when c.merged_into is not null then 'دُمجت في بطاقة أخرى' end
  from public.clients c
 where not exists (select 1 from public.crm_lead_intake i where i.client_id = c.id)
   and not exists (select 1 from public.crm_lead_intake i where i.external_id = 'client:' || c.id);

-- صفوف legacy المحذوفة لا تُعدّ أخطاء تنتظر قراراً
update public.crm_lead_intake
   set resolved_at = now(), resolution = 'تاريخي — قبل 218'
 where provider = 'legacy' and status = 'مرفوض' and resolved_at is null;

-- ------------------------------------------------------------
-- 10) الصلاحيات المساعدة
-- ------------------------------------------------------------
create or replace function public.can_view_lead_hub()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_followup_manager() or public.can_read_marketing();
$$;

create or replace function public.can_manage_lead_intake()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_followup_manager() or public.is_marketing_manager();
$$;

create or replace function public.can_import_leads()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_followup_manager() or public.can_write_marketing();
$$;

-- ------------------------------------------------------------
-- 11) lead_capture — القناة المركزية لما لا تكامل له
--
-- من يقرأ رسائل الصفحة أو واتساب أو يردّ على الهاتف يسجّل الليد هنا
-- لحظة وصوله؛ النظام يطابقه ويوزّعه ويبدأ عدّاد أول تواصل. p_request_id
-- يولّده المتصفّح مرة لكل نموذج: النقر مرتين أو إعادة الإرسال لا يُنشئ
-- صفّين.
-- ------------------------------------------------------------
create or replace function public.lead_capture(
  p_name         text,
  p_phone        text,
  p_channel      text,
  p_campaign_id  uuid    default null,
  p_project_id   uuid    default null,
  p_message      text    default null,
  p_email        text    default null,
  p_assign_to_me boolean default false,
  p_request_id   uuid    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := public.my_employee_id();
  v_role  text := public.my_role();
  v_ext   text := 'capture:' || coalesce(p_request_id, gen_random_uuid())::text;
  v_id    uuid;
  it      public.crm_lead_intake%rowtype;
  v_owner text;
begin
  if auth.uid() is null then
    raise exception 'سجّل الدخول أولاً.';
  end if;
  if coalesce(v_role, '') in ('viewer', 'broker')
     or not (public.is_admin() or public.is_followup_manager() or public.can_write_marketing() or v_me is not null) then
    raise exception 'لا تملك صلاحية تسجيل ليد.';
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is null and nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'اكتب الاسم أو الرقم على الأقل.';
  end if;
  if nullif(btrim(coalesce(p_channel, '')), '') is null then
    raise exception 'حدّد القناة التي وصل منها الليد.';
  end if;
  if p_assign_to_me and v_me is null then
    raise exception 'حسابك غير مربوط بملفّ موظف — لا يمكن إسناد الليد لك.';
  end if;

  insert into public.crm_lead_intake
    (provider, external_id, received_at, raw, name, phone, email, channel,
     campaign_id, project_id, message, captured_by, assign_to)
  values
    ('manual', v_ext, now(),
     jsonb_build_object('origin', 'capture', 'utm', jsonb_build_object('utm_source', lower(btrim(p_channel)))),
     nullif(btrim(p_name), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), lower(btrim(p_channel)),
     p_campaign_id, p_project_id, left(nullif(btrim(p_message), ''), 2000), auth.uid(),
     case when p_assign_to_me then v_me end)
  on conflict (provider, external_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.crm_lead_intake where provider = 'manual' and external_id = v_ext;
  else
    perform public.intake_lead(v_id);
  end if;

  select * into it from public.crm_lead_intake where id = v_id;
  select e.full_name into v_owner
    from public.clients c join public.employees e on e.id = c.owner_id
   where c.id = it.client_id;

  return jsonb_build_object(
    'intake_id', it.id, 'status', it.status, 'client_id', it.client_id, 'owner', v_owner,
    'reason', coalesce(it.reject_reason, it.dup_reason, it.last_error));
end $$;

-- ------------------------------------------------------------
-- 12) استيراد Lead Sheets
--
-- مفتاح عدم التكرار لكل صفّ:
--   • للملف معرّف ليد Meta («id» / «l:123…») ⇒ provider meta بنفس
--     المفتاح الذي يكتبه الويبهوك. ليدٌ وصل بالويبهوك ثم جاء في
--     الملف = «سبق تسجيله» لا ليد ثانٍ — وهذا هو جسر المطابقة.
--   • وإلا ⇒ provider sheet بمفتاح من (الهاتف، الاسم، الحملة، الوقت).
-- فإعادة رفع الملف نفسه أو إعادة دفعة انقطعت لا تُنشئ شيئاً جديداً.
-- ------------------------------------------------------------
-- stable لا immutable: تحويل النصّ إلى timestamptz يتبع إعداد المنطقة الزمنية
create or replace function public.lead_try_ts(p text)
returns timestamptz language plpgsql stable as $$
begin
  if nullif(btrim(coalesce(p, '')), '') is null then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function public.lead_import_begin(
  p_file_name text, p_file_hash text, p_campaign_id uuid, p_project_id uuid,
  p_channel text, p_mapping jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_import_leads() then
    raise exception 'استيراد الليدات للإدارة ومدير المتابعة وفريق التسويق.';
  end if;
  insert into public.lead_import_batches (file_name, file_hash, campaign_id, project_id, channel, mapping, created_by)
  values (left(p_file_name, 255), left(p_file_hash, 128), p_campaign_id, p_project_id,
          nullif(lower(btrim(coalesce(p_channel, ''))), ''), p_mapping, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- p_rows: [{name, phone, email, campaign, campaign_code, ad, form, platform, created_time, external_id, message}]
create or replace function public.lead_import_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b      public.lead_import_batches%rowtype;
  r      jsonb;
  v_ext  text;
  v_prov text;
  v_id   uuid;
  v_st   text;
  v_ts   timestamptz;
  n_sent int := 0; n_new int := 0; n_dup int := 0; n_rej int := 0; n_err int := 0; n_skip int := 0;
begin
  if not public.can_import_leads() then
    raise exception 'استيراد الليدات للإدارة ومدير المتابعة وفريق التسويق.';
  end if;
  select * into b from public.lead_import_batches where id = p_batch;
  if b.id is null then
    raise exception 'دفعة الاستيراد غير موجودة.';
  end if;
  if b.created_by is distinct from auth.uid() and not public.is_admin() then
    raise exception 'هذه الدفعة لمستخدم آخر.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'أرسل الصفوف مصفوفةً لا تزيد على 100 صف في الطلب.';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    n_sent := n_sent + 1;
    v_ts := coalesce(public.lead_try_ts(r->>'created_time'), now());
    v_ext := nullif(btrim(coalesce(r->>'external_id', '')), '');
    if v_ext is not null and v_ext ~* '^l:' then
      v_ext := substr(v_ext, 3);
    end if;

    if v_ext is not null and v_ext ~ '^[0-9]{8,}$' then
      v_prov := 'meta';
    else
      v_prov := 'sheet';
      v_ext := md5(concat_ws('|',
                 coalesce(public.normalize_iraqi_phone(r->>'phone'), lower(btrim(coalesce(r->>'phone', '')))),
                 lower(btrim(coalesce(r->>'name', ''))),
                 lower(btrim(coalesce(r->>'campaign', r->>'campaign_code', b.campaign_id::text, ''))),
                 coalesce(v_ext, r->>'created_time', '')));
    end if;

    v_id := null;
    insert into public.crm_lead_intake
      (provider, external_id, received_at, raw, name, phone, email, channel, campaign_ref,
       campaign_id, project_id, form_ref, ad_ref, message, batch_id, captured_by)
    values
      (v_prov, v_ext, v_ts,
       jsonb_build_object('origin', 'sheet', 'row', r,
                          'utm', jsonb_strip_nulls(jsonb_build_object(
                                   'utm_source', lower(coalesce(nullif(r->>'platform', ''), b.channel)),
                                   'utm_campaign', nullif(r->>'campaign_code', '')))),
       nullif(btrim(r->>'name'), ''), nullif(btrim(r->>'phone'), ''), nullif(btrim(r->>'email'), ''),
       lower(coalesce(nullif(btrim(r->>'platform'), ''), b.channel)),
       -- حملة الدفعة (اختيار المستخدم صراحةً) تغلب؛ وإلا فحملة الصفّ باسمها أو رمزها
       case when b.campaign_id is null then nullif(btrim(r->>'campaign'), '') end,
       b.campaign_id,
       b.project_id, nullif(r->>'form', ''), nullif(r->>'ad', ''),
       left(nullif(btrim(r->>'message'), ''), 2000), b.id, auth.uid())
    on conflict (provider, external_id) do nothing
    returning id into v_id;

    if v_id is null then
      n_skip := n_skip + 1;
      continue;
    end if;

    perform public.intake_lead(v_id);
    select status into v_st from public.crm_lead_intake where id = v_id;
    if    v_st = 'مُحوَّل' then n_new := n_new + 1;
    elsif v_st = 'مكرّر'  then n_dup := n_dup + 1;
    elsif v_st = 'مرفوض'  then n_rej := n_rej + 1;
    else  n_err := n_err + 1;
    end if;
  end loop;

  update public.lead_import_batches
     set rows_sent = rows_sent + n_sent, rows_already = rows_already + n_skip, finished_at = now()
   where id = b.id;

  return jsonb_build_object('sent', n_sent, 'created', n_new, 'linked', n_dup,
                            'rejected', n_rej, 'errors', n_err, 'already', n_skip);
end $$;

-- فحص المعاينة: هل الرقم لعميل قائم؟ هل معرّف Meta وصل سابقاً؟
-- لا يُرجع اسماً ولا مالكاً — نعم/لا فقط.
create or replace function public.lead_import_precheck(p_phones text[], p_meta_ids text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_import_leads() then
    raise exception 'غير مصرّح.';
  end if;
  return jsonb_build_object(
    'existing_phones', coalesce((
      select jsonb_agg(distinct k) from unnest(p_phones) k
       where exists (select 1 from public.clients c
                      where c.deleted_at is null and c.merged_into is null
                        and (c.phone_key = k or c.alt_phone_key = k))), '[]'::jsonb),
    'received_ids', coalesce((
      select jsonb_agg(distinct i.external_id) from public.crm_lead_intake i
       where i.provider = 'meta' and i.external_id = any(p_meta_ids)), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------
-- 13) معالجة قائمة الأخطاء يدوياً
--   fix     صحّح الهاتف (والاسم) ثم أعد المعالجة
--   retry   أعد المحاولة الآن
--   dismiss أهمِل بسبب مكتوب — يبقى الصفّ ويُعدّ «مُعالَجاً»
-- ------------------------------------------------------------
create or replace function public.lead_intake_resolve(
  p_id uuid, p_action text, p_phone text default null, p_name text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare it public.crm_lead_intake%rowtype;
begin
  if not public.can_manage_lead_intake() then
    raise exception 'معالجة قائمة الأخطاء للمدير ومدير المتابعة ومدير التسويق.';
  end if;
  select * into it from public.crm_lead_intake where id = p_id for update;
  if it.id is null then raise exception 'الصفّ غير موجود.'; end if;
  if it.status not in ('مرفوض', 'خطأ', 'بانتظار الجلب') then
    raise exception 'الصفّ عولج (%).', it.status;
  end if;

  if p_action = 'dismiss' then
    if nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'اكتب سبب الإهمال — يبقى في السجلّ.';
    end if;
    update public.crm_lead_intake
       set resolved_at = now(), resolved_by = auth.uid(), resolution = 'مُهمَل: ' || btrim(p_note)
     where id = p_id;

  elsif p_action in ('fix', 'retry') then
    if p_action = 'fix' then
      if nullif(btrim(coalesce(p_phone, '')), '') is null then
        raise exception 'اكتب الرقم الصحيح.';
      end if;
      update public.crm_lead_intake
         set phone = btrim(p_phone), name = coalesce(nullif(btrim(p_name), ''), name)
       where id = p_id;
    end if;

    if it.provider = 'meta' and it.phone is null and p_action = 'retry' then
      -- التفاصيل لم تُجلب: دالّة الحافة تعيد الجلب في دورتها التالية
      update public.crm_lead_intake
         set status = 'خطأ', attempts = 0, next_retry_at = now(), resolved_at = null
       where id = p_id;
    else
      update public.crm_lead_intake
         set status = 'جديد', reject_reason = null, resolved_at = null,
             resolution = 'أُعيدت المعالجة يدوياً'
       where id = p_id;
      perform public.intake_lead(p_id);
    end if;
  else
    raise exception 'إجراء غير معروف: %', p_action;
  end if;

  select * into it from public.crm_lead_intake where id = p_id;
  return jsonb_build_object('status', it.status, 'client_id', it.client_id,
                            'reason', coalesce(it.reject_reason, it.dup_reason, it.last_error));
end $$;

-- ------------------------------------------------------------
-- 14) إيقاف موظف عن الاستلام
-- ------------------------------------------------------------
create or replace function public.set_assignment_pause(
  p_employee uuid, p_paused boolean, p_until timestamptz default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_followup_manager()
          or (public.is_supervisor() and p_employee in (select s.id from public.my_scope_employees() s))
          or p_employee = public.my_employee_id()) then
    raise exception 'لا تملك إيقاف هذا الموظف عن الاستلام.';
  end if;
  insert into public.crm_assignment_availability (employee_id, paused, paused_until, reason, updated_by, updated_at)
  values (p_employee, p_paused, p_until, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), now())
  on conflict (employee_id) do update
    set paused = excluded.paused, paused_until = excluded.paused_until, reason = excluded.reason,
        updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ------------------------------------------------------------
-- 15) الفحص الدوري — كل ١٥ دقيقة
-- ------------------------------------------------------------
create or replace function public.scan_lead_intake()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max  int := public.crm_setting_int('lead_intake_max_attempts', 6);
  v_wait int := public.crm_setting_int('lead_unassigned_alert_minutes', 30);
  v_bl   int := public.crm_setting_int('lead_backlog_alert_count', 15);
  v_fc   int := public.crm_setting_int('first_contact_sla_hours', 24);
  v_gap  int := public.crm_setting_int('lead_gap_alert_percent', 10);
  n_retry int := 0; n_unassigned int := 0; n_err int := 0; n_backlog int := 0; n_gap int := 0;
  r record;
  v_yday date := public.baghdad_today() - 1;
  v_pl bigint; v_rc bigint;
begin
  -- (أ) إعادة: «خطأ» له رقم (فشل داخل القاعدة)، و«جديد» عالق
  --     (المتّصل انقطع قبل intake_lead). ليد Meta بلا تفاصيل تعيده دالّة الحافة.
  for r in
    select id from public.crm_lead_intake
     where (status = 'خطأ' and phone is not null and attempts < v_max
            and coalesce(next_retry_at, now()) <= now())
        or (status = 'جديد' and received_at < now() - interval '5 minutes')
     order by received_at
     limit 200
  loop
    update public.crm_lead_intake set status = 'جديد' where id = r.id and status = 'خطأ';
    perform public.intake_lead(r.id);
    n_retry := n_retry + 1;
  end loop;

  -- (ب) دخل ولم يُوزَّع ضمن المهلة — تنبيه واحد مجمَّع لكل مشروع
  --     (لا CTE معدِّلة داخل FOR: الحلقة مؤشّر، فالختم داخلها)
  for r in
    select c.project_id, array_agg(i.id) as ids, count(*) as n
      from public.crm_lead_intake i
      join public.clients c on c.id = i.client_id
     where i.status in ('مُحوَّل', 'مكرّر') and i.alerted_at is null
       and i.provider <> 'legacy'
       and c.owner_id is null and c.deleted_at is null and c.merged_into is null
       and c.broker_company_id is null
       and i.received_at < now() - make_interval(mins => v_wait)
     group by c.project_id
  loop
    update public.crm_lead_intake set alerted_at = now() where id = any(r.ids);
    insert into public.notifications (user_id, title, body, link, kind, category, entity_type, priority)
    select u.user_id, 'ليدات بانتظار التوزيع',
           r.n || ' ليد دخل النظام منذ أكثر من ' || v_wait || ' دقيقة بلا مسؤول'
             || coalesce(' — مشروع ' || (select name from public.projects where id = r.project_id), ''),
           '/dashboard/crm/leads?tab=queue', 'عام', 'leads', 'lead_intake', 'حرجة'
      from public.lead_distributor_users(r.project_id) u;
    n_unassigned := n_unassigned + r.n;
  end loop;

  -- (ج) أخطاء استنفدت محاولاتها، أو «بانتظار الجلب» عالق ساعة
  with due as (
    select id from public.crm_lead_intake
     where alerted_at is null and resolved_at is null
       and ((status = 'خطأ' and attempts >= v_max)
            or (status = 'بانتظار الجلب' and received_at < now() - interval '1 hour')
            or (status = 'خطأ' and provider = 'meta' and phone is null and received_at < now() - interval '1 hour'))
  ), marked as (
    update public.crm_lead_intake i set alerted_at = now() from due where i.id = due.id returning 1
  )
  select count(*) into n_err from marked;
  if n_err > 0 then
    insert into public.notifications (user_id, title, body, link, kind, category, entity_type, priority)
    select u.user_id, 'فشل استقبال ليدات',
           n_err || ' ليد لم تكتمل معالجته بعد إعادة المحاولة — افتح قائمة الأخطاء.',
           '/dashboard/crm/leads?tab=errors', 'عام', 'leads', 'lead_intake', 'حرجة'
      from public.lead_intake_admin_users() u;
  end if;

  -- (د) تراكم عند موظف: ليدات تجاوزت مهلة أول تواصل — مرة يومياً
  for r in
    select c.owner_id, e.full_name, e.project_id, count(*) as n
      from public.clients c
      join public.employees e on e.id = c.owner_id
     where c.deleted_at is null and c.merged_into is null
       and public.is_open_stage(c.stage) and c.last_contact_at is null
       and coalesce(c.owner_assigned_at, c.created_at) < now() - make_interval(hours => v_fc)
     group by c.owner_id, e.full_name, e.project_id
    having count(*) >= v_bl
  loop
    if not exists (select 1 from public.notifications
                    where category = 'leads_backlog' and entity_id = r.owner_id
                      and created_at > now() - interval '20 hours') then
      insert into public.notifications (user_id, title, body, link, kind, category, entity_type, entity_id, priority)
      select u.user_id, 'ليدات متراكمة بلا تواصل',
             r.full_name || ': ' || r.n || ' ليد تجاوزت مهلة أول تواصل (' || v_fc || ' ساعة).',
             '/dashboard/crm/distribution?owner=' || r.owner_id || '&act=unworked',
             'عام', 'leads_backlog', 'employee', r.owner_id, 'عالية'
        from public.lead_distributor_users(r.project_id) u;
      n_backlog := n_backlog + 1;
    end if;
  end loop;

  -- (هـ) فجوة المطابقة لأمس: ما أبلغت عنه المنصّة مقابل ما وصل من Meta
  select coalesce(sum(d.leads), 0) into v_pl
    from public.mkt_metrics_daily d
   where d.metric_date = v_yday
     and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب');
  select count(*) into v_rc
    from public.crm_lead_intake i
   where i.provider = 'meta' and (i.received_at at time zone 'Asia/Baghdad')::date = v_yday;
  if v_pl > 0 and v_pl - v_rc > greatest(1, v_pl * v_gap / 100.0)
     and not exists (select 1 from public.notifications
                      where category = 'leads_gap' and created_at > now() - interval '20 hours') then
    insert into public.notifications (user_id, title, body, link, kind, category, entity_type, priority)
    select u.user_id, 'فجوة مطابقة الليدات',
           'أبلغت Meta عن ' || v_pl || ' ليد أمس ووصل منها إلى النظام ' || v_rc
             || '. راجع الويبهوك واشتراك الصفحة، أو استورد ملف الليدات.',
           '/dashboard/crm/leads?tab=reconcile', 'عام', 'leads_gap', 'lead_intake', 'عالية'
      from public.lead_intake_admin_users() u;
    n_gap := 1;
  end if;

  return jsonb_build_object('retried', n_retry, 'unassigned_alerted', n_unassigned,
                            'errors_alerted', n_err, 'backlog_alerts', n_backlog, 'gap_alert', n_gap);
end $$;

-- ------------------------------------------------------------
-- 16) اللوحة الرقابية
--
-- الأول تواصل = أول نشاط من نوع يُعدّ تواصلاً (crm_activity_types
-- .counts_as_contact) بعد وصول الليد. «ملاحظة» النظام لا تُعدّ.
-- ------------------------------------------------------------
create or replace function public.lead_hub_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_fc  int := public.crm_setting_int('first_contact_sla_hours', 24);
  v_today date := public.baghdad_today();
  v jsonb;
begin
  if not public.can_view_lead_hub() then
    raise exception 'غير مصرّح.';
  end if;

  with w as (
    select i.*, c.owner_id, c.stage as c_stage,
           (select min(a.created_at) from public.client_activities a
              join public.crm_activity_types t on t.name = a.activity_type and t.counts_as_contact
             where a.client_id = i.client_id and a.created_at >= i.received_at) as first_at
      from public.crm_lead_intake i
      left join public.clients c on c.id = i.client_id
     where (i.received_at at time zone 'Asia/Baghdad')::date between p_from and p_to
       and i.provider <> 'legacy'
  ), agg as (
    select count(*) as received,
           count(*) filter (where status = 'مُحوَّل')       as created,
           count(*) filter (where status = 'مكرّر')         as linked,
           count(*) filter (where status = 'مرفوض')         as rejected,
           count(*) filter (where status in ('خطأ', 'بانتظار الجلب', 'جديد')) as pending,
           count(*) filter (where status in ('مُحوَّل', 'مكرّر') and owner_id is not null) as assigned,
           count(*) filter (where status in ('مُحوَّل', 'مكرّر') and first_at is not null) as contacted,
           count(*) filter (where first_at is not null and first_at <= received_at + make_interval(hours => v_fc)) as in_sla,
           round(avg(extract(epoch from first_at - received_at) / 60.0) filter (where first_at is not null)) as avg_first_min,
           round((percentile_cont(0.5) within group (order by extract(epoch from first_at - received_at) / 60.0)
                  filter (where first_at is not null))::numeric) as median_first_min,
           count(*) filter (where status = 'مُحوَّل' and exists (select 1 from public.reservations r where r.client_id = w.client_id)) as reserved,
           count(*) filter (where status = 'مُحوَّل' and exists (select 1 from public.sale_commissions sc
                                                                where sc.client_id = w.client_id and sc.reversed_at is null)) as sold
      from w
  )
  select to_jsonb(agg) into v from agg;

  v := v || jsonb_build_object(
    'sla_hours', v_fc,
    'by_provider', coalesce((
      select jsonb_object_agg(provider, n) from (
        select provider, count(*) n from public.crm_lead_intake
         where (received_at at time zone 'Asia/Baghdad')::date between p_from and p_to and provider <> 'legacy'
         group by provider) x), '{}'::jsonb),
    'today', (select count(*) from public.crm_lead_intake
               where provider <> 'legacy' and (received_at at time zone 'Asia/Baghdad')::date = v_today),
    'week',  (select count(*) from public.crm_lead_intake
               where provider <> 'legacy' and (received_at at time zone 'Asia/Baghdad')::date > v_today - 7),
    'month', (select count(*) from public.crm_lead_intake
               where provider <> 'legacy' and (received_at at time zone 'Asia/Baghdad')::date >= date_trunc('month', v_today)::date),
    -- الطوابير الحيّة (لا تتقيّد بالفترة: ما ينتظر الآن)
    'q_errors',   (select count(*) from public.crm_lead_intake
                    where status in ('خطأ', 'بانتظار الجلب') and resolved_at is null),
    'q_rejected', (select count(*) from public.crm_lead_intake
                    where status = 'مرفوض' and resolved_at is null),
    'q_unassigned', (select count(*) from public.clients c
                      where c.owner_id is null and c.deleted_at is null and c.merged_into is null
                        and c.broker_company_id is null and public.is_open_stage(c.stage)),
    'q_no_contact', (select count(*) from public.clients c
                      where c.owner_id is not null and c.deleted_at is null and c.merged_into is null
                        and public.is_open_stage(c.stage) and c.last_contact_at is null),
    'q_overdue',  (select count(*) from public.clients c
                    where c.owner_id is not null and c.deleted_at is null and c.merged_into is null
                      and public.is_open_stage(c.stage) and c.last_contact_at is null
                      and coalesce(c.owner_assigned_at, c.created_at) < now() - make_interval(hours => v_fc)),
    'q_followup_late', (select count(*) from public.clients c
                         where c.deleted_at is null and c.merged_into is null
                           and public.is_open_stage(c.stage) and c.follow_up_date < v_today),
    -- اكتمال المصادر: هل الباب موصول؟ متى وصل منه آخر ليد؟
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('provider', provider, 'last_at', last_at, 'n_30d', n30) order by last_at desc)
        from (select provider, max(received_at) last_at,
                     count(*) filter (where received_at > now() - interval '30 days') n30
                from public.crm_lead_intake where provider <> 'legacy' group by provider) s), '[]'::jsonb),
    'meta_connected', exists (select 1 from public.mkt_integrations
                               where provider = 'meta' and is_active),
    'meta_last_sync', (select max(last_sync_at) from public.mkt_integrations where provider = 'meta'));
  return v;
end $$;

-- التفصيل: حملة | مصدر | قناة | موظف | مشروع — بالأعمدة نفسها
create or replace function public.lead_hub_breakdown(p_from date, p_to date, p_dim text default 'campaign')
returns table (
  k text, label text, received bigint, created bigint, linked bigint, rejected bigint, pending bigint,
  unassigned bigint, contacted bigint, in_sla bigint, avg_first_min numeric,
  reserved bigint, sold bigint, platform_leads bigint
)
language sql stable security definer set search_path = public as $$
  with cfg as (select public.crm_setting_int('first_contact_sla_hours', 24) as h),
  w as (
    select i.*, c.owner_id,
           (select min(a.created_at) from public.client_activities a
              join public.crm_activity_types t on t.name = a.activity_type and t.counts_as_contact
             where a.client_id = i.client_id and a.created_at >= i.received_at) as first_at
      from public.crm_lead_intake i
      left join public.clients c on c.id = i.client_id
     where public.can_view_lead_hub()
       and (i.received_at at time zone 'Asia/Baghdad')::date between p_from and p_to
       and i.provider <> 'legacy'
  ),
  g as (
    select case p_dim when 'provider' then w.provider
                      when 'channel'  then w.channel
                      when 'owner'    then w.owner_id::text
                      when 'project'  then w.project_id::text
                      else w.campaign_id::text end as k,
           count(*) as received,
           count(*) filter (where status = 'مُحوَّل') as created,
           count(*) filter (where status = 'مكرّر')  as linked,
           count(*) filter (where status = 'مرفوض')  as rejected,
           count(*) filter (where status in ('خطأ', 'بانتظار الجلب', 'جديد')) as pending,
           count(*) filter (where status in ('مُحوَّل', 'مكرّر') and owner_id is null) as unassigned,
           count(*) filter (where first_at is not null) as contacted,
           count(*) filter (where first_at is not null and first_at <= received_at + make_interval(hours => cfg.h)) as in_sla,
           round(avg(extract(epoch from first_at - received_at) / 60.0) filter (where first_at is not null)) as avg_first_min,
           count(*) filter (where status = 'مُحوَّل' and exists (select 1 from public.reservations r where r.client_id = w.client_id)) as reserved,
           count(*) filter (where status = 'مُحوَّل' and exists (select 1 from public.sale_commissions sc
                                                                where sc.client_id = w.client_id and sc.reversed_at is null)) as sold
      from w cross join cfg
     group by 1
  ),
  pl as (
    select d.campaign_id::text as k, sum(d.leads)::bigint as n
      from public.mkt_metrics_daily d
     where p_dim = 'campaign' and public.can_view_lead_hub()
       and d.metric_date between p_from and p_to
       and d.entity_type in ('إعلان', 'محتوى', 'مؤثر', 'نشاط', 'صفحة هبوط', 'حساب')
     group by 1
  )
  select coalesce(g.k, pl.k),
         case p_dim
           when 'campaign' then (select name from public.crm_campaigns where id::text = coalesce(g.k, pl.k))
           when 'owner'    then (select full_name from public.employees where id::text = g.k)
           when 'project'  then (select name from public.projects where id::text = g.k)
           else g.k end,
         coalesce(g.received, 0), coalesce(g.created, 0), coalesce(g.linked, 0), coalesce(g.rejected, 0),
         coalesce(g.pending, 0), coalesce(g.unassigned, 0), coalesce(g.contacted, 0), coalesce(g.in_sla, 0),
         g.avg_first_min, coalesce(g.reserved, 0), coalesce(g.sold, 0), pl.n
    from g full join pl on pl.k = g.k
   order by coalesce(g.received, 0) desc;
$$;

-- ------------------------------------------------------------
-- 17) الصلاحيات (RLS)
-- ------------------------------------------------------------
-- الدفتر: المدير ومدير المتابعة (079) + مدير التسويق + صفوف العملاء
-- الذين يراهم المستخدم (مصادر بطاقته). بالمجموعة لا بالصفّ (211).
drop policy if exists "read intake marketing manager" on public.crm_lead_intake;
create policy "read intake marketing manager" on public.crm_lead_intake
  for select to authenticated
  using ((select public.is_marketing_manager()));

drop policy if exists "read intake of visible clients" on public.crm_lead_intake;
create policy "read intake of visible clients" on public.crm_lead_intake
  for select to authenticated
  using (client_id in (select public.my_visible_client_ids()));

alter table public.lead_import_batches enable row level security;
drop policy if exists "read lead batches" on public.lead_import_batches;
create policy "read lead batches" on public.lead_import_batches
  for select to authenticated
  using ((select public.can_import_leads()));

alter table public.crm_assignment_availability enable row level security;
drop policy if exists "read availability" on public.crm_assignment_availability;
create policy "read availability" on public.crm_assignment_availability
  for select to authenticated using (true);

drop trigger if exists trg_audit_lead_batches on public.lead_import_batches;
create trigger trg_audit_lead_batches
  after insert or update or delete on public.lead_import_batches
  for each row execute function public.audit_row();

drop trigger if exists trg_audit_assignment_availability on public.crm_assignment_availability;
create trigger trg_audit_assignment_availability
  after insert or update or delete on public.crm_assignment_availability
  for each row execute function public.audit_row();

-- ------------------------------------------------------------
-- 18) المنح
-- ------------------------------------------------------------
revoke all on function public.lead_intake_stamp()        from public, anon, authenticated;
revoke all on function public.lead_ledger_from_card()    from public, anon, authenticated;
revoke all on function public.lead_distributor_users(uuid) from public, anon, authenticated;
revoke all on function public.lead_intake_admin_users()  from public, anon, authenticated;
revoke all on function public.lead_notify_owner(uuid, text, text) from public, anon, authenticated;
revoke all on function public.scan_lead_intake()         from public, anon, authenticated;
revoke all on function public.lead_capture(text, text, text, uuid, uuid, text, text, boolean, uuid) from public, anon;
revoke all on function public.lead_import_begin(text, text, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.lead_import_rows(uuid, jsonb) from public, anon;
revoke all on function public.lead_import_precheck(text[], text[]) from public, anon;
revoke all on function public.lead_intake_resolve(uuid, text, text, text, text) from public, anon;
revoke all on function public.set_assignment_pause(uuid, boolean, timestamptz, text) from public, anon;
revoke all on function public.lead_hub_summary(date, date) from public, anon;
revoke all on function public.lead_hub_breakdown(date, date, text) from public, anon;

grant execute on function public.can_view_lead_hub()      to authenticated, service_role;
grant execute on function public.can_manage_lead_intake() to authenticated, service_role;
grant execute on function public.can_import_leads()       to authenticated, service_role;
grant execute on function public.lead_try_ts(text)        to authenticated, service_role;
grant execute on function public.lead_capture(text, text, text, uuid, uuid, text, text, boolean, uuid) to authenticated;
grant execute on function public.lead_import_begin(text, text, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.lead_import_rows(uuid, jsonb) to authenticated;
grant execute on function public.lead_import_precheck(text[], text[]) to authenticated;
grant execute on function public.lead_intake_resolve(uuid, text, text, text, text) to authenticated;
grant execute on function public.set_assignment_pause(uuid, boolean, timestamptz, text) to authenticated;
grant execute on function public.lead_hub_summary(date, date) to authenticated;
grant execute on function public.lead_hub_breakdown(date, date, text) to authenticated;
grant execute on function public.scan_lead_intake() to service_role;
grant execute on function public.crm_assignment_candidates(uuid) to authenticated, service_role;
grant execute on function public.auto_assign_client(uuid)        to authenticated, service_role;
grant execute on function public.assign_client(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.intake_lead(uuid)               to authenticated, service_role;

-- ------------------------------------------------------------
-- 19) الجدولة
--   lead-intake-scan   كل ١٥ دقيقة
--   crm-sla-scan       كان يومياً (075) ⇒ كل ساعة من ٨ صباحاً إلى ١٠ مساءً
--                      بتوقيت بغداد (05–19 UTC) — لا تنبيهات ليلية
--   meta-leads-retry   كل ١٥ دقيقة: إعادة جلب ما فشل + مسح الاستمارات
--                      (يحتاج نشر meta-leads الجديدة — بدونه يُرجع 401 بلا أثر)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lead-intake-scan') then
    perform cron.unschedule('lead-intake-scan');
  end if;
  perform cron.schedule('lead-intake-scan', '*/15 * * * *', $job$ select public.scan_lead_intake(); $job$);

  if exists (select 1 from cron.job where jobname = 'crm-sla-scan') then
    perform cron.unschedule('crm-sla-scan');
  end if;
  perform cron.schedule('crm-sla-scan', '5 5-19 * * *', $job$ select public.run_crm_sla_scan(); $job$);

  if exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from vault.secrets where name = 'mkt_cron_secret') then
    if exists (select 1 from cron.job where jobname = 'meta-leads-retry') then
      perform cron.unschedule('meta-leads-retry');
    end if;
    perform cron.schedule('meta-leads-retry', '7,22,37,52 * * * *', $job$
      select net.http_post(
        url     := 'https://edgblrqkushnznhmuxln.supabase.co/functions/v1/meta-leads',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mkt_cron_secret')),
        body    := '{"mode":"retry"}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;

alter table public.mkt_integrations add column if not exists lead_sweep_at timestamptz;
comment on column public.mkt_integrations.lead_sweep_at is
  'آخر مسح لاستمارات الصفحة (meta-leads retry): كل ليد أحدث منه لم يصل بالويبهوك يُسجَّل. 218';

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 20) التحقّق
-- ------------------------------------------------------------
do $$
declare n_cards int; n_ledger int; n_missing int;
begin
  raise notice '--- 218 مركز استقبال الليدات ---';
  select count(*) into n_cards from public.clients;
  select count(distinct client_id) into n_ledger from public.crm_lead_intake where client_id is not null;
  select count(*) into n_missing from public.clients c
   where not exists (select 1 from public.crm_lead_intake i where i.client_id = c.id or i.external_id = 'client:' || c.id)
     and not exists (select 1 from public.crm_lead_intake i where i.client_id = c.merged_into);
  raise notice 'بطاقات: %، مربوطة بالدفتر: %، بلا صفّ: %', n_cards, n_ledger, n_missing;
  if n_missing > 0 then
    raise warning '% بطاقة بلا صفّ في الدفتر', n_missing;
  end if;
  if not exists (select 1 from cron.job where jobname = 'lead-intake-scan') then
    raise warning 'lead-intake-scan لم تُجدول';
  end if;
end $$;
