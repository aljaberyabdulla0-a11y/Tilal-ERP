-- ============================================================
-- تلال ERP — 177: مهمة الاستمارة لمن يستطيع ملأها فعلاً
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
-- ثم شغّل الاختبارات (178):  select * from tests.run_lost_analysis_tasks();
--
-- ============================================================
-- المشكلة (ظهرت بعد تطبيق 175)
--
-- ٢٠ مهمة ذهبت إلى مشرفة فريق موظفة تركت العمل. لكن عملاء تلك الموظفة
-- أُعيد إسنادهم إلى موظف آخر في فريق آخر، والفرصة بقيت تحمل المالك
-- القديم. فالمشرفة لا ترى العميل، فلا ترى الخسارة (v_crm_lost_sales
-- يربط العميل)، فلا يظهر زرّ «حلّل» — مهمةٌ لا تُنجَز.
--
-- وثغرة ثانية في الموضع نفسه: update_lost_analysis تقبل «صاحب» الخسارة
-- بمالكها المجمَّد أو بمن أغلقها فقط. فلو ذهبت المهمة إلى مالك العميل
-- الحالي لرُفض حفظه.
--
-- ============================================================
-- الحلّ
--
--   1) المسؤول: مالك الفرصة على رأس عمله ← **مالك العميل الحالي** على
--      رأس عمله ← من نقل البطاقة ← مشرف الفريق يوم الخسارة.
--   2) update_lost_analysis: صاحب مهمة الاستمارة المفتوحة يملأها — المهمة
--      هي الإذن. (السطر الوحيد المتغيّر في الدالة عن نسختها الحيّة.)
--   3) المهام المفتوحة تُنقل إلى مسؤولها الجديد، بإشعار واحد لكل مستلم.
--
-- يتطلب: 140، 175. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) المسؤول
-- ------------------------------------------------------------
create or replace function public.crm_lost_analysis_assignee(p_lost uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.user_id from public.employees e
      where e.id = l.owner_id and e.status = 'active' and e.user_id is not null),
    -- عميلٌ أُعيد إسناده بعد رحيل مالك الفرصة: مالكه الآن هو من يراه
    (select e.user_id from public.employees e
       join public.opportunities o on o.id = l.opportunity_id
       join public.clients c on c.id = o.client_id
      where e.id = c.owner_id and e.status = 'active' and e.user_id is not null),
    (select e.user_id from public.employees e
      where e.user_id = l.lost_by and e.status = 'active'
      order by e.created_at limit 1),
    (select e.user_id from public.employees e
      where e.id = l.manager_id and e.status = 'active' and e.user_id is not null))
  from public.crm_lost_sales l
  where l.id = p_lost;
$$;

revoke all on function public.crm_lost_analysis_assignee(uuid) from public, anon, authenticated;
grant execute on function public.crm_lost_analysis_assignee(uuid) to service_role;

-- ------------------------------------------------------------
-- 2) صاحب المهمة يملأ الاستمارة
--    النسخة الحيّة (140) حرفياً، والتغيير في سطر own وحده.
-- ------------------------------------------------------------
create or replace function public.update_lost_analysis(p_id uuid, p jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l  public.crm_lost_sales%rowtype;
  vp jsonb;
  manager boolean;
  own boolean;
  edit_days int := public.crm_setting_int('lost_edit_days', 7);
  v_task uuid;
  v_value numeric;
begin
  select * into l from public.crm_lost_sales where id = p_id for update;
  if l.id is null then
    raise exception 'تحليل الخسارة غير موجود.';
  end if;

  manager := public.crm_can_manage_lost(l.owner_id);
  own := l.lost_by = auth.uid()
         or (l.owner_id is not null and l.owner_id = public.my_employee_id())
         -- مهمة «استمارة فشل البيع» المفتوحة له (175/177) هي الإذن
         or exists (select 1 from public.tasks t
                     where t.analysis_lost_sale_id = l.id and t.assigned_to = auth.uid()
                       and t.status in ('جديدة', 'قيد التنفيذ'));

  if not manager then
    if not own or not public.crm_can_edit_opportunity(l.opportunity_id) then
      raise exception 'لا صلاحية لك على تحليل هذه الخسارة.';
    end if;
    if l.outcome <> 'lost' then
      raise exception 'الفرصة أُعيد تنشيطها — تحليل خسارتها السابقة يعدّله المشرف وحده.';
    end if;
    -- المُرحَّل غير المحلَّل يُكمله صاحبه في أي وقت؛ وغيره خلال المهلة
    if l.category_id is not null and l.lost_at < now() - make_interval(days => edit_days) then
      raise exception 'انتهت مهلة تعديلك (% أيام). اطلب التعديل من مشرفك.', edit_days;
    end if;
  end if;

  if l.category_id is not null and coalesce(btrim(p_reason), '') = '' then
    raise exception 'اكتب سبب التعديل — يُحفظ في سجلّ التحليل.';
  end if;

  vp := public.crm_validate_lost_payload(p);

  -- القيمة الخاسرة: المشرف وحده يصحّحها، وتصير «يدوية»
  v_value := l.lost_value;
  if manager and nullif(p->>'lost_value', '') is not null
     and (p->>'lost_value')::numeric is distinct from l.lost_value then
    v_value := (p->>'lost_value')::numeric;
    if v_value < 0 then raise exception 'القيمة لا تكون سالبة.'; end if;
  end if;

  -- مهمة إعادة التواصل تتبع الموعد
  v_task := l.recontact_task_id;
  if (vp->>'recontact_required')::boolean and l.outcome = 'lost' then
    v_task := public.crm_upsert_recontact_task(
      l.recontact_task_id, l.opportunity_id, l.owner_id, (vp->>'recontact_date')::date,
      'السبب: ' || (vp->>'category_name') || ' — ' || (vp->>'reason_name'));
  elsif l.recontact_task_id is not null then
    update public.tasks set status = 'ملغاة'
     where id = l.recontact_task_id and status in ('جديدة', 'قيد التنفيذ');
  end if;

  perform set_config('tilal.lost_edit_reason', coalesce(nullif(btrim(p_reason), ''), 'إكمال تحليل مُرحَّل'), true);
  update public.crm_lost_sales
     set category_id        = (vp->>'category_id')::uuid,
         reason_id          = (vp->>'reason_id')::uuid,
         loss_source        = vp->>'loss_source',
         customer_potential = vp->>'customer_potential',
         recovery_potential = vp->>'recovery_potential',
         recontact_required = (vp->>'recontact_required')::boolean,
         recontact_date     = (vp->>'recontact_date')::date,
         recovery_reason    = vp->>'recovery_reason',
         details            = vp->>'details',
         discount           = (vp->>'discount')::numeric,
         lost_value         = v_value,
         value_basis        = case when v_value is distinct from l.lost_value then 'manual' else value_basis end,
         competitor_id            = (vp->>'competitor_id')::uuid,
         competitor_project_id    = (vp->>'competitor_project_id')::uuid,
         competitor_name          = vp->>'competitor_name',
         competitor_price         = (vp->>'competitor_price')::numeric,
         competitor_price_per_m2  = (vp->>'competitor_price_per_m2')::numeric,
         competitor_unit_m2       = (vp->>'competitor_unit_m2')::numeric,
         competitor_payment_plan  = vp->>'competitor_payment_plan',
         competitor_advantage     = vp->>'competitor_advantage',
         competitor_choice_reason = vp->>'competitor_choice_reason',
         recontact_task_id  = case when (vp->>'recontact_required')::boolean then v_task else recontact_task_id end,
         -- تحليلٌ تغيّر بعد المراجعة يعود للمراجعة
         review_status      = case when manager then review_status else 'pending' end
   where id = l.id;
  perform set_config('tilal.lost_edit_reason', '', true);

  -- السبب على الفرصة يتبع (096 يصحّح حدث الخسارة في التقارير)
  if l.outcome = 'lost' then
    update public.opportunities
       set lost_reason_id = (vp->>'reason_id')::uuid,
           lost_note = left(coalesce(vp->>'details', vp->>'reason_name'), 2000)
     where id = l.opportunity_id
       and (lost_reason_id is distinct from (vp->>'reason_id')::uuid
            or lost_note is distinct from left(coalesce(vp->>'details', vp->>'reason_name'), 2000));
  end if;
end $$;

revoke all on function public.update_lost_analysis(uuid, jsonb, text) from public, anon;
grant execute on function public.update_lost_analysis(uuid, jsonb, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3) نقل المهام المفتوحة إلى مسؤولها الجديد
--    (الحارس 175 لا يمنع تغيير المُسنَد إليه — يمنع الإنجاز وفكّ الربط)
-- ------------------------------------------------------------
do $$
declare
  n int;
begin
  create temp table _moved on commit drop as
  select t.id, public.crm_lost_analysis_assignee(t.analysis_lost_sale_id) as nxt
    from public.tasks t
   where t.analysis_lost_sale_id is not null
     and t.status in ('جديدة', 'قيد التنفيذ');
  delete from _moved m using public.tasks t
   where t.id = m.id and (m.nxt is null or m.nxt = t.assigned_to);

  update public.tasks t set assigned_to = m.nxt from _moved m where t.id = m.id;
  get diagnostics n = row_count;

  insert into public.notifications (user_id, title, body, link, kind)
  select m.nxt,
         'فرص خاسرة تنتظر استمارة فشل البيع',
         'أُسندت إليك ' || count(*) || ' فرصة من عملائك خُسرت دون تسجيل السبب. املأ استمارة كلٍّ منها من زرّ «املأ الاستمارة» في المهمة.',
         '/dashboard/tasks',
         'مهمة'
    from _moved m
   group by m.nxt;

  raise notice 'تسوية 177: % مهمة نُقلت إلى مسؤولها الجديد', n;
end $$;

notify pgrst, 'reload schema';
