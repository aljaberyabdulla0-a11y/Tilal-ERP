-- ============================================================
-- تلال ERP — تنبيهات المتابعة والتصعيد للإدارة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- القواعد الثلاث:
--   1) موعد المتابعة اليوم        → إشعار تذكير للموظف المسؤول.
--   2) الموعد فات ولم يتواصل      → إشعار «متابعة متأخرة» للموظف.
--   3) مضى أكثر من ٢٤ ساعة على الموعد ولم تتحدّث الحالة ولا حصل تواصل
--      → إشعار **تصعيد للإدارة** بكل المتأخرات.
--
-- الفحص يعمل تلقائياً كل يوم الساعة ٩ صباحاً بتوقيت بغداد عبر pg_cron،
-- ويقدر المدير يشغّله يدوياً من صفحة التقارير.
--
-- يتطلب: sql/022 (الإشعارات) و sql/026 (سجلّ التواصل). آمن لإعادة التشغيل.
-- ============================================================

create extension if not exists pg_cron;

-- ------------------------------------------------------------
-- اليوم بتوقيت بغداد (لا بتوقيت الخادم)
-- ------------------------------------------------------------
create or replace function public.baghdad_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Baghdad')::date;
$$;

-- ------------------------------------------------------------
-- المراحل المفتوحة = التي ما زالت تحتاج متابعة
-- ------------------------------------------------------------
create or replace function public.is_open_stage(stage text)
returns boolean language sql immutable as $$
  select coalesce(stage, 'ليد') not in ('بيع', 'فشل البيع');
$$;

-- ------------------------------------------------------------
-- الفحص اليومي
-- ------------------------------------------------------------
create or replace function public.crm_followup_scan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today        date := public.baghdad_today();
  due_today    int  := 0;
  overdue      int  := 0;
  escalated    int  := 0;
  admin_count  int  := 0;
  esc_lines    text := '';
  rec          record;
  target_user  uuid;
begin
  -- ===== 1 و 2: تذكير الموظف المسؤول =====
  for rec in
    select c.id, c.name, c.phone, c.stage, c.sales_employee, c.created_by,
           c.follow_up_date,
           (today - c.follow_up_date) as days_late,
           e.user_id as employee_user
      from public.clients c
      left join public.employees e
             on e.full_name = c.sales_employee
            and e.user_id is not null
     where c.follow_up_date is not null
       and c.follow_up_date <= today
       and public.is_open_stage(c.stage)
  loop
    -- من يتابع هذا العميل: الموظف المسند إليه، وإلا من أضافه
    target_user := coalesce(rec.employee_user, rec.created_by);

    if target_user is not null then
      -- إشعار واحد فقط لكل عميل في اليوم الواحد
      if not exists (
        select 1 from public.notifications n
         where n.entity_id = rec.id
           and n.kind = 'متابعة'
           and n.user_id = target_user
           and (n.created_at at time zone 'Asia/Baghdad')::date = today
      ) then
        insert into public.notifications (user_id, title, body, link, kind, entity_id)
        values (
          target_user,
          case when rec.days_late = 0
               then 'متابعة اليوم: ' || rec.name
               else 'متابعة متأخرة ' || rec.days_late || ' يوم: ' || rec.name end,
          'المرحلة «' || coalesce(rec.stage, 'ليد') || '»'
            || case when rec.phone is not null then ' — ' || rec.phone else '' end
            || ' — الموعد ' || rec.follow_up_date,
          '/dashboard/clients/' || rec.id,
          'متابعة',
          rec.id
        );
      end if;
    end if;

    if rec.days_late = 0 then
      due_today := due_today + 1;
    else
      overdue := overdue + 1;
    end if;
  end loop;

  -- ===== 3: تصعيد للإدارة =====
  -- الشرط: مضى أكثر من ٢٤ ساعة على الموعد، ولا تواصل بعده، ولا تغيّرت المرحلة.
  for rec in
    select c.id, c.name, c.stage, c.sales_employee, c.follow_up_date,
           (today - c.follow_up_date) as days_late
      from public.clients c
     where c.follow_up_date is not null
       and c.follow_up_date < today          -- فات الموعد بيوم فأكثر
       and public.is_open_stage(c.stage)
       and (c.last_contact_at is null
            or (c.last_contact_at at time zone 'Asia/Baghdad')::date < c.follow_up_date)
       and not exists (
         select 1 from public.client_activities a
          where a.client_id = c.id
            and a.activity_type = 'تغيير مرحلة'
            and (a.occurred_at at time zone 'Asia/Baghdad')::date >= c.follow_up_date
       )
     order by (today - c.follow_up_date) desc, c.name
  loop
    escalated := escalated + 1;
    if escalated <= 10 then
      esc_lines := esc_lines
        || case when esc_lines = '' then '' else ' • ' end
        || rec.name || ' (' || rec.days_late || ' يوم'
        || case when rec.sales_employee is not null
                then ' — ' || rec.sales_employee else '' end || ')';
    end if;
  end loop;

  if escalated > 0 then
    if escalated > 10 then
      esc_lines := esc_lines || ' • و' || (escalated - 10) || ' غيرهم';
    end if;

    insert into public.notifications (user_id, title, body, link, kind, entity_id)
    select p.id,
           '⚠️ ' || escalated || ' متابعة تأخّرت أكثر من ٢٤ ساعة بلا تحديث',
           esc_lines,
           '/dashboard/crm/reports',
           'تصعيد',
           null
      from public.profiles p
     where p.role = 'admin'
       -- تصعيد واحد في اليوم لكل مدير
       and not exists (
         select 1 from public.notifications n
          where n.user_id = p.id
            and n.kind = 'تصعيد'
            and (n.created_at at time zone 'Asia/Baghdad')::date = today
       );

    get diagnostics admin_count = row_count;
  end if;

  return jsonb_build_object(
    'ran_at',            now(),
    'today',             today,
    'due_today',         due_today,
    'overdue',           overdue,
    'escalated',         escalated,
    'admins_notified',   admin_count
  );
end; $$;

-- المدير وحده يشغّل الفحص يدوياً من الواجهة
revoke all on function public.crm_followup_scan() from public, anon, authenticated;

create or replace function public.run_crm_followup_scan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية متاحة للإدارة فقط.';
  end if;
  return public.crm_followup_scan();
end; $$;

grant execute on function public.run_crm_followup_scan() to authenticated;

-- ------------------------------------------------------------
-- الجدولة اليومية: ٩ صباحاً بتوقيت بغداد = ٦ صباحاً UTC
-- ------------------------------------------------------------
select cron.unschedule('crm-followup-scan')
 where exists (select 1 from cron.job where jobname = 'crm-followup-scan');

select cron.schedule(
  'crm-followup-scan',
  '0 6 * * *',
  $cron$ select public.crm_followup_scan(); $cron$
);

notify pgrst, 'reload schema';
