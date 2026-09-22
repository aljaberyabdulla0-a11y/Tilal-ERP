-- ============================================================
-- تلال ERP — 086: قيدان متناقضان يُعطّلان المهامّ منذ إنشائها
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما وُجد =====
--
-- على جدول `tasks` **قيدان** لكل عمود من عمودَي الأولوية والحالة:
--
--   tasks_priority_check   low | medium | high          ← إنجليزي قديم
--   tasks_priority_chk     عاجلة | متوسطة | عادية        ← عربي (031)
--
--   tasks_status_check     pending | in_progress | …     ← إنجليزي قديم
--   tasks_status_chk       جديدة | قيد التنفيذ | …       ← عربي (031)
--
-- وقيود CHECK تتراكم لا تتبادل: **كلاهما يجب أن يمرّ**. ولا قيمة
-- تُرضي «عاجلة» و«high» معاً. فكل إدراج في الجدول يُرفض — أيّاً كانت
-- القيمة.
--
-- والدليل في البيانات: **صفر مهامّ** في جدول عمره سنة. لا أحد أنشأ
-- مهمّة قطّ، ولا أحد اشتكى — لأن الرسالة التي تظهر
-- («violates check constraint») لا تُفهم، فيُظنّ عطلاً عابراً.
--
-- وأثره أوسع من الجدول: «مهامّي» في مساحة العمل اليومية، وبطاقة
-- المهامّ في لوحتَي المدير ومدير المتابعة، وتذكير المهامّ المجدول،
-- وفحص «ملفّات مغلقة ومهامّها مفتوحة» في لوحة الجودة — كلها تعمل
-- على جدول لا يقبل صفّاً.
--
-- ===== لماذا حدث =====
--
-- الجدول أُنشئ أولاً بمخطّط إنجليزي، ثم أُعيدت كتابته بالعربية في
-- 031. و`create table if not exists` لا يُعيد إنشاء جدول قائم، فبقيت
-- قيوده الأولى، وأُضيفت العربية بجانبها بـ `add constraint`. والملف
-- يُسقط العربي قبل إضافته (`drop constraint if exists … _chk`) ولا
-- يعرف شيئاً عن `… _check`.
--
-- ===== القرار =====
--
-- يُسقط الإنجليزي. العربي هو المستعمل في كل مكان بلا استثناء:
-- types.ts (TASK_STATUSES و TASK_PRIORITIES)، ومحفّزات 031 نفسها
-- (`if new.status = 'منجزة'`)، وفحص جودة البيانات في 077
-- (`status in ('جديدة', 'قيد التنفيذ')`).
--
-- ⚠️ لا بيانات تُفقد: الجدول فارغ — ولا يمكن أن يكون غير ذلك.
--
-- ===== وفحصٌ يمنع تكرارها =====
--
-- في آخر الملف فحصٌ يبحث عن كل عمود عليه قيدا CHECK بالنمطين
-- (`_check` و`_chk`) في كل جداول public، فلا تتكرّر العلّة في جدول
-- آخر صامتاً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) إسقاط القيود الإنجليزية
-- ------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks drop constraint if exists tasks_status_check;

-- والعربية تُعاد تثبيتاً (idempotent) كي يصحّ الملف على قاعدة نظيفة
alter table public.tasks drop constraint if exists tasks_status_chk;
alter table public.tasks add constraint tasks_status_chk
  check (status in ('جديدة', 'قيد التنفيذ', 'منجزة', 'ملغاة'));

alter table public.tasks drop constraint if exists tasks_priority_chk;
alter table public.tasks add constraint tasks_priority_chk
  check (priority in ('عاجلة', 'متوسطة', 'عادية'));

comment on column public.tasks.status is
  'جديدة | قيد التنفيذ | منجزة | ملغاة — يطابق TASK_STATUSES في types.ts.';
comment on column public.tasks.priority is
  'عاجلة | متوسطة | عادية — يطابق TASK_PRIORITIES في types.ts.';

-- ------------------------------------------------------------
-- 2) إثبات أن الجدول صار يقبل صفّاً
--    يُدرَج ويُلغى فوراً — الاختبار لا يترك بيانات.
-- ------------------------------------------------------------
do $$
declare tid uuid;
begin
  begin
    insert into public.tasks (title, priority, status, created_by_name)
    values ('فحص 086 — يُلغى فوراً', 'عاجلة', 'جديدة', 'النظام')
    returning id into tid;

    raise exception using errcode = 'RLBCK', message = 'ok';
  exception
    when sqlstate 'RLBCK' then
      raise notice 'المهامّ: الجدول صار يقبل الإدراج ✓';
    when others then
      raise warning 'المهامّ ما زالت مرفوضة: %', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- 3) فحصٌ عامّ: هل في جدول آخر قيدان متناقضان بنفس العلّة؟
-- ------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  raise notice '--- 086 فحص القيود المزدوجة ---';

  for r in
    select c.conrelid::regclass::text as tbl,
           a.attname                  as col,
           string_agg(c.conname, ' + ' order by c.conname) as constraints
      from pg_constraint c
      join unnest(c.conkey) k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      join pg_class     t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'c'
       and n.nspname = 'public'
       and array_length(c.conkey, 1) = 1
     group by c.conrelid, a.attname
    having count(*) > 1
  loop
    n := n + 1;
    raise warning 'عمودٌ عليه أكثر من قيد: %.% → %', r.tbl, r.col, r.constraints;
  end loop;

  if n = 0 then
    raise notice 'لا عمود عليه قيدان — العلّة لا تتكرّر.';
  else
    raise warning 'راجع ما سبق: قيدان على عمود واحد قد يتناقضان فيمنعان كل إدراج.';
  end if;
end $$;

notify pgrst, 'reload schema';
