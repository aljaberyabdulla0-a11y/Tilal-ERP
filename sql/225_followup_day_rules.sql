-- ============================================================
-- تلال ERP — 225: قواعد يوم المتابعة
--   (1) سقف يومي: لا أكثر من 30 متابعة للموظف في اليوم الواحد
--   (2) لا متابعة يوم الجمعة — عطلة
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- لماذا: المتابعات تتراكم في أيام بعينها (وصل يومٌ إلى 39 متابعة لموظف
-- واحد) فلا يبقى للموظف وقت لليدات والزبائن الجدد. بالسقف «يمتلئ» اليوم
-- عند 30 فيُجبَر الموظف على توزيع متابعاته على الأيام التالية.
--
-- أين يُفرض: موعد المتابعة الفعلي عمود واحد — clients.follow_up_date —
-- وكل الطرق تصبّ فيه (تسجيل تواصل، لوحة المبيعات، إعادة التنشيط). فمحفّز
-- واحد على clients يغطّيها جميعاً، ولا يمكن تجاوزه من الواجهة.
--
-- ما الذي يُفحص: **تغيير** الموعد فقط. نقل عميل لموظف آخر، أو تعديل
-- أي حقل آخر، أو الدمج — لا يُفحص، فلا تتعطّل عملية بسبب موعد قديم.
-- السقف على **مالك العميل** (owner_id): لو حدّد المشرف أو المدير موعداً
-- لعميل موظف، يُحسب على يوم ذلك الموظف.
--
-- السقف إعداد (crm_settings: followup_daily_cap) يغيّره المدير من
-- صفحة إعدادات الـCRM بلا ترحيل جديد.
--
-- يتطلب: 029 (clear_followup_when_closed) و 070 (crm_settings) و 211.
-- آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الإعداد: السقف اليومي
-- ------------------------------------------------------------
insert into public.crm_settings (key, value, label, description, unit, min_value, max_value) values
  ('followup_daily_cap', '30', 'الحدّ الأعلى للمتابعات في اليوم',
   'عدد المتابعات التي تُحدَّد للموظف في اليوم الواحد. عند بلوغه «يمتلئ» اليوم ويختار الموظف يوماً آخر.',
   'عدد', 1, 500)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2) دوال مساعدة
-- ------------------------------------------------------------

-- يوم العطلة: الجمعة (dow = 5). التاريخ بلا منطقة زمنية فلا التباس.
create or replace function public.is_followup_day_off(p_date date)
returns boolean language sql immutable as $$
  select extract(dow from p_date)::int = 5;
$$;

create or replace function public.followup_daily_cap()
returns int language sql stable security definer set search_path = public as $$
  select greatest(public.crm_setting_int('followup_daily_cap', 30), 1);
$$;

-- عدد متابعات الموظف في يوم — عدا عميلٍ بعينه (الذي نغيّر موعده الآن).
-- لا حاجة لفحص المرحلة: الملف المغلق يُمسح موعده دائماً (029).
create or replace function public.followup_day_count(p_owner uuid, p_date date, p_except uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.clients c
   where c.owner_id = p_owner
     and c.follow_up_date = p_date
     and c.deleted_at is null
     and c.id is distinct from p_except;
$$;

-- أقرب يوم متاح للموظف ابتداءً من تاريخ: ليس جمعة وليس ممتلئاً.
create or replace function public.followup_next_free_day(p_owner uuid, p_from date, p_except uuid default null)
returns date language sql stable security definer set search_path = public as $$
  select g.d::date
    from generate_series(p_from::timestamp, (p_from + 120)::timestamp, interval '1 day') as g(d)
   where not public.is_followup_day_off(g.d::date)
     and (p_owner is null
          or public.followup_day_count(p_owner, g.d::date, p_except) < public.followup_daily_cap())
   order by g.d
   limit 1;
$$;

create or replace function public.ar_day_name(p_date date)
returns text language sql immutable as $$
  select (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])
         [extract(dow from p_date)::int + 1];
$$;

-- دوال داخلية: تُستدعى من المحفّز ومن followup_day_status فقط
revoke all on function public.followup_day_count(uuid, date, uuid)     from public, anon, authenticated;
revoke all on function public.followup_next_free_day(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.followup_daily_cap()                     from public, anon;
grant execute on function public.followup_daily_cap()        to authenticated, service_role;
grant execute on function public.is_followup_day_off(date)   to authenticated, service_role;
grant execute on function public.ar_day_name(date)           to authenticated, service_role;

create index if not exists clients_owner_followup_idx
  on public.clients (owner_id, follow_up_date)
  where follow_up_date is not null;

-- ------------------------------------------------------------
-- 3) مواعيد قادمة واقعة في جمعة ← تُنقل إلى السبت
--    (قبل إنشاء المحفّز: تصحيح بيانات لا يخضع للسقف)
-- ------------------------------------------------------------
update public.clients
   set follow_up_date = follow_up_date + 1
 where follow_up_date >= public.baghdad_today()
   and public.is_followup_day_off(follow_up_date);

-- ------------------------------------------------------------
-- 4) المحفّز على clients
-- ------------------------------------------------------------
create or replace function public.enforce_followup_day_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap   int;
  v_count int;
  v_free  date;
  v_owner text;
begin
  -- الدمج ينقل المواعيد كما هي (104)
  if current_setting('tilal.merging', true) = 'on' then
    return new;
  end if;

  if new.follow_up_date is null then
    return new;
  end if;

  -- نفحص تغيير الموعد فقط
  if tg_op = 'UPDATE' and new.follow_up_date is not distinct from old.follow_up_date then
    return new;
  end if;

  -- ملف مغلق: موعده يُمسح في محفّز 029 — لا شيء نفحصه
  if not public.is_open_stage(new.stage) then
    return new;
  end if;

  -- (أ) الجمعة عطلة
  if public.is_followup_day_off(new.follow_up_date) then
    v_free := public.followup_next_free_day(new.owner_id, new.follow_up_date + 1, new.id);
    raise exception
      'لا يمكن تحديد موعد متابعة يوم الجمعة (%) لأنه عطلة. أقرب يوم متاح: % %.',
      new.follow_up_date, public.ar_day_name(v_free), v_free
      using errcode = 'P0001';
  end if;

  -- (ب) السقف اليومي على مالك العميل
  if new.owner_id is not null then
    -- قفل على (الموظف، اليوم): حفظان متزامنان لا يتجاوزان السقف معاً
    perform pg_advisory_xact_lock(
      hashtextextended(new.owner_id::text || '|' || new.follow_up_date::text, 225));

    v_cap   := public.followup_daily_cap();
    v_count := public.followup_day_count(new.owner_id, new.follow_up_date, new.id);

    if v_count >= v_cap then
      v_free := public.followup_next_free_day(new.owner_id, new.follow_up_date + 1, new.id);
      select e.full_name into v_owner from public.employees e where e.id = new.owner_id;
      raise exception
        'يوم % % ممتلئ: % متابعة من أصل % للموظف «%». اختر يوماً آخر — أقرب يوم متاح: % %.',
        public.ar_day_name(new.follow_up_date), new.follow_up_date,
        v_count, v_cap, coalesce(v_owner, '—'),
        public.ar_day_name(v_free), v_free
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end; $$;

-- الاسم بـ zz: يعمل بعد محفّزات before الأخرى (ختم المالك والمرحلة)
drop trigger if exists trg_zz_followup_day_rules on public.clients;
create trigger trg_zz_followup_day_rules
  before insert or update on public.clients
  for each row execute function public.enforce_followup_day_rules();

-- ------------------------------------------------------------
-- 5) تعديل سجلّ تواصل قديم لا يعيد فرض موعده القديم على العميل
--
-- كان أي تعديل (حتى للملخّص فقط) ينسخ next_action_date إلى العميل —
-- فيرجع موعد العميل إلى الوراء، ومع قواعد 225 قد يُرفض التعديل بسبب
-- يوم ممتلئ لم يقصده أحد. الآن: يُنسخ عند الإضافة أو عند تغيير الموعد.
-- ------------------------------------------------------------
create or replace function public.after_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('tilal.merging', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_client_contact(old.client_id);
    return old;
  end if;

  perform public.refresh_client_contact(new.client_id);

  if new.next_action_date is not null
     and (tg_op = 'INSERT'
          or new.next_action_date is distinct from old.next_action_date
          or new.client_id is distinct from old.client_id) then
    update public.clients
       set follow_up_date = new.next_action_date
     where id = new.client_id;
  end if;

  return new;
end; $$;

-- ------------------------------------------------------------
-- 6) حالة اليوم للواجهة — تُعرض تحت حقل الموعد قبل الحفظ
--    {day_off, count, cap, full, next_free, next_free_day}
--    count لا يشمل العميل نفسه. null = العميل ليس ضمن ما يراه المستخدم.
-- ------------------------------------------------------------
create or replace function public.followup_day_status(p_client uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_cap   int := public.followup_daily_cap();
  v_count int := 0;
  v_off   boolean;
  v_full  boolean;
  v_free  date;
begin
  if p_client is null or p_date is null then
    return null;
  end if;

  if not (public.is_admin()
          or p_client in (select public.my_visible_client_ids())) then
    return null;
  end if;

  select c.owner_id into v_owner from public.clients c where c.id = p_client;

  v_off := public.is_followup_day_off(p_date);
  if v_owner is not null then
    v_count := public.followup_day_count(v_owner, p_date, p_client);
  end if;
  v_full := v_count >= v_cap;

  if v_off or v_full then
    v_free := public.followup_next_free_day(v_owner, p_date + 1, p_client);
  end if;

  return jsonb_build_object(
    'day_off',       v_off,
    'count',         v_count,
    'cap',           v_cap,
    'full',          v_full,
    'next_free',     v_free,
    'next_free_day', case when v_free is not null then public.ar_day_name(v_free) end
  );
end; $$;

revoke all on function public.followup_day_status(uuid, date) from public, anon;
grant execute on function public.followup_day_status(uuid, date) to authenticated, service_role;

notify pgrst, 'reload schema';
