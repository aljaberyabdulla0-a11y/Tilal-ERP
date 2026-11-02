-- ============================================================
-- تلال ERP — 222: استمارة فشل البيع تبقى عند من خسر — النقل والدمج
--                 بين موظفَين على رأس عملهما لا يحمّلانها للمالك الجديد
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- تكملة 221: إنهاء الخدمة صار يُلغي استمارات المغادر. بقي النقل العادي:
--   محفّز نقل البطاقة (219) والدمج (219) ينقلان كل مهامها المفتوحة
--   للمالك الجديد، ومعها «استمارة فشل البيع» لخسارةٍ ليست له. اليوم:
--   دانية تحمل استمارة خسارة ندى.
--
-- الحلّ:
--   (١) نقل البطاقة والدمج لا ينقلان استمارةً يحملها صاحب خسارتها وهو
--       على رأس عمله. يملؤها من صفحة الفرصة (الواجهة: من لا يرى البطاقة
--       تُفتح له الاستمارة وحدها — قراءة الخسارة والفرصة له أصلاً بـ
--       «owner_id في نطاقي»، و update_lost_analysis تقبله مالكاً). روابط
--       مهام الاستمارة تمرّ بصفحة الفرصة، فتحوّل لملفّ العميل لمن يراه.
--   (٢) v_crm_lost_sales تربط البطاقة ربطاً اختيارياً: من لا يرى البطاقة
--       يرى خسارته (كان الربط الداخلي يخفيها عنه تحت security_invoker).
--   (٣) تصحيح: كل استمارة مفتوحة عند غير صاحب خسارتها، وصاحبها على رأس
--       عمله ← تعود له (دانية ← ندى).
--
-- ما لا يتغيّر: بقية مهام البطاقة تنتقل كما في 219، والبطاقة نفسها لا
--   يراها المالك السابق.
--
-- يتطلب: 219، 221. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) نقل البطاقة: الاستمارة تبقى عند صاحب خسارتها
-- ------------------------------------------------------------
do $patch$
declare
  f text := pg_get_functiondef('public.sync_open_opportunities_owner()'::regprocedure);
  old1 text := E'       and t.assigned_to = oe.user_id\n'
            || E'       and t.status in (''جديدة'', ''قيد التنفيذ'');\n';
  new1 text := E'       and t.assigned_to = oe.user_id\n'
            || E'       and t.status in (''جديدة'', ''قيد التنفيذ'')\n'
            || E'       -- (222) استمارة فشل البيع تبقى عند صاحب خسارتها ما دام على رأس عمله\n'
            || E'       and not exists (select 1 from public.crm_lost_sales l\n'
            || E'                         join public.employees le on le.id = l.owner_id\n'
            || E'                        where l.id = t.analysis_lost_sale_id\n'
            || E'                          and le.status = ''active'' and le.user_id = t.assigned_to);\n';
begin
  f := replace(f, chr(13), '');
  if strpos(f, '(222) استمارة فشل البيع') > 0 then
    raise notice '222: sync_open_opportunities_owner مُعدّلة سابقاً';
    return;
  end if;
  if (length(f) - length(replace(f, old1, ''))) / length(old1) <> 1 then
    raise exception '222: نصّ نقل المهام في sync_open_opportunities_owner غير موجود مرّة واحدة';
  end if;
  execute replace(f, old1, new1);
end $patch$;

-- ------------------------------------------------------------
-- 2) الدمج: كذلك
-- ------------------------------------------------------------
do $patch$
declare
  f text := pg_get_functiondef('public.merge_clients(uuid,uuid,text[])'::regprocedure);
  old1 text := E'       and t.assigned_to = pe.user_id\n'
            || E'       and t.status in (''جديدة'', ''قيد التنفيذ'');\n';
  new1 text := E'       and t.assigned_to = pe.user_id\n'
            || E'       and t.status in (''جديدة'', ''قيد التنفيذ'')\n'
            || E'       -- (222) استمارة فشل البيع تبقى عند صاحب خسارتها ما دام على رأس عمله\n'
            || E'       and not exists (select 1 from public.crm_lost_sales l\n'
            || E'                         join public.employees le on le.id = l.owner_id\n'
            || E'                        where l.id = t.analysis_lost_sale_id\n'
            || E'                          and le.status = ''active'' and le.user_id = t.assigned_to);\n';
begin
  f := replace(f, chr(13), '');
  if strpos(f, '(222) استمارة فشل البيع') > 0 then
    raise notice '222: merge_clients مُعدّلة سابقاً';
    return;
  end if;
  if (length(f) - length(replace(f, old1, ''))) / length(old1) <> 1 then
    raise exception '222: نصّ نقل المهام في merge_clients غير موجود مرّة واحدة';
  end if;
  execute replace(f, old1, new1);
end $patch$;

-- ------------------------------------------------------------
-- 3) v_crm_lost_sales: الخسارة تُقرأ وإن لم تُرَ البطاقة
-- ------------------------------------------------------------
-- كانت تربط البطاقة ربطاً داخلياً تحت security_invoker: من انتقلت بطاقته
-- لغيره لا يرى خسارته — لا في الاستمارة ولا في «لماذا نخسر؟». صفّ الخسارة
-- نفسه مقروء له بسياستها (owner_id في نطاقي)، والاسم يبقى فارغاً لمن لا
-- يرى البطاقة (عنوان الفرصة يكفي).
do $view$
declare
  d text := pg_get_viewdef('public.v_crm_lost_sales'::regclass);
  old1 text := ' JOIN clients c ON ((c.id = o.client_id)))';
  new1 text := ' LEFT JOIN clients c ON ((c.id = o.client_id)))';
begin
  if strpos(d, new1) > 0 then
    raise notice '222: v_crm_lost_sales مُعدّلة سابقاً';
    return;
  end if;
  if (length(d) - length(replace(d, old1, ''))) / length(old1) <> 1 then
    raise exception '222: ربط البطاقة في v_crm_lost_sales غير موجود مرّة واحدة';
  end if;
  execute 'create or replace view public.v_crm_lost_sales with (security_invoker = true) as '
          || replace(d, old1, new1);
end $view$;

-- ------------------------------------------------------------
-- 4) تصحيح: الاستمارة لصاحب خسارتها
-- ------------------------------------------------------------
do $fix$
declare n int;
begin
  perform set_config('tilal.lost_task_sync', 'on', true);
  update public.tasks t
     set assigned_to = lo.user_id, assigned_to_name = lo.full_name
    from public.crm_lost_sales l, public.employees lo
   where l.id = t.analysis_lost_sale_id
     and lo.id = l.owner_id and lo.status = 'active' and lo.user_id is not null
     and t.assigned_to is distinct from lo.user_id
     and t.status in ('جديدة', 'قيد التنفيذ');
  get diagnostics n = row_count;
  perform set_config('tilal.lost_task_sync', '', true);
  raise notice '222: % استمارة عادت لصاحب خسارتها', n;
end $fix$;

notify pgrst, 'reload schema';
