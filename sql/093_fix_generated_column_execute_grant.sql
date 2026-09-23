-- ============================================================
-- تلال ERP — 093: صلاحية تنفيذ ناقصة عطّلت كل كتابة على العملاء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما حدث =====
--
-- الموظف يحفظ تأهيل عميل فيظهر:
--
--     permission denied for function normalize_iraqi_phone
--
-- والسبب أن 071 أنشأت عمودين **محسوبين مخزَّنين** على clients:
--
--     phone_key     generated always as (normalize_iraqi_phone(phone))
--     alt_phone_key generated always as (normalize_iraqi_phone(alt_contact_phone))
--
-- وPostgres يُعيد حساب العمود المخزَّن في **كل** كتابة على الصفّ —
-- لا حين يتغيّر مصدره فقط. فكل update على clients يستدعي الدالة
-- بصلاحية المستخدم، لا بصلاحية مالك القاعدة.
--
-- و 071 لم تمنح تنفيذها لأحد.
--
-- ===== لماذا لم يظهر قبل الآن =====
--
-- الهجرات تعمل بحساب المالك (postgres) الذي يملك كل شيء. والاختبارات
-- كذلك: `tests.make_client` تُدرج بحساب المالك. فلم يرَ أحدٌ العطل
-- حتى فتح أول موظف الشاشة وضغط «حفظ».
--
-- وهي ثغرة في **تصميم الاختبارات** قبل أن تكون ثغرة في الهجرة:
-- اختبارٌ يكتب بحساب المالك لا يختبر ما يفعله التطبيق. عُولجت
-- بـ tests.run_write_paths() التي تكتب بدور authenticated فعلاً.
--
-- ===== الأثر =====
--
-- أوسع من الشاشة التي ظهر فيها: **كل** كتابة على clients كانت تفشل
-- — تغيير المرحلة، وتسجيل التواصل (محفّزه يُحدِّث last_contact_at)،
-- والاستيراد، والإسناد، والوسم. لأن جميعها تمرّ بالصفّ نفسه.
--
-- ===== لماذا غابت أصلاً =====
--
-- sql/053 و054 ضبطا الصلاحيات الافتراضية فمنعا PUBLIC من تنفيذ
-- الدوال الجديدة — وهو الصواب. لكنه يعني أن **كل** دالة تُنشأ بعدهما
-- تحتاج منحاً صريحاً، و071 منحت دوالها كلها إلا هذه: لأنها لا
-- تُستدعى من التطبيق مباشرةً، بل من داخل تعريف عمود — فلم تخطر
-- على البال عند كتابة قائمة المنح.
--
-- يتطلب: 071. آمن لإعادة التشغيل.
-- ============================================================

grant execute on function public.normalize_iraqi_phone(text) to authenticated, service_role;

comment on function public.normalize_iraqi_phone(text) is
  'مفتاح الهاتف العراقي الموحّد (9647XXXXXXXXX). NULL لما لا يطابق الشكل. '
  '⚠️ تُستدعى من عمودين محسوبين على clients، فتنفيذها لازم لكل من يكتب صفّ عميل (093).';

-- ------------------------------------------------------------
-- فحصٌ دائم يمنع تكرار العلّة
--
-- كل دالة يستدعيها عمود محسوب أو قيد أو فهرس تحتاج تنفيذاً لمن
-- يكتب الصفّ. وغيابه لا يظهر في هجرة ولا في اختبار يعمل بحساب
-- المالك — يظهر عند أول مستخدم حقيقي.
--
-- تُستدعى من tests.run_write_paths() فتُفحص في كل دفعة.
-- ------------------------------------------------------------
create or replace function public.check_write_path_grants()
returns table (function_name text, used_in text, missing_for text)
language sql stable security definer set search_path = public as $$
  with used as (
    select distinct p.oid, p.proname::text as nm, 'عمود محسوب'::text as where_used
      from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      join pg_class t on t.oid = d.adrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_proc p on pg_get_expr(d.adbin, d.adrelid) like '%' || p.proname || '(%'
     where n.nspname = 'public' and a.attgenerated <> ''
       and p.pronamespace = 'public'::regnamespace
    union
    select distinct p.oid, p.proname::text, 'قيد check'
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_proc p on pg_get_constraintdef(c.oid) like '%' || p.proname || '(%'
     where n.nspname = 'public' and c.contype = 'c'
       and p.pronamespace = 'public'::regnamespace
    union
    select distinct p.oid, p.proname::text, 'فهرس'
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_proc p on pg_get_indexdef(i.indexrelid) like '%' || p.proname || '(%'
     where n.nspname = 'public' and p.pronamespace = 'public'::regnamespace
  )
  select nm, where_used, 'authenticated'
    from used
   where not has_function_privilege('authenticated', oid, 'EXECUTE')
   order by nm;
$$;

comment on function public.check_write_path_grants() is
  'دوالّ في مسار الكتابة (عمود محسوب/قيد/فهرس) بلا تنفيذ لـauthenticated. '
  'يجب أن تُرجِع صفراً — وإلا فكل كتابة على ذلك الجدول تفشل (093).';

revoke all on function public.check_write_path_grants() from public;
grant execute on function public.check_write_path_grants() to authenticated, service_role;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  raise notice '--- 093 صلاحيات مسار الكتابة ---';
  for r in select * from public.check_write_path_grants() loop
    n := n + 1;
    raise warning 'بلا تنفيذ: %() في % — كل كتابة تمرّ به تفشل.',
      r.function_name, r.used_in;
  end loop;

  if n = 0 then
    raise notice 'كل دوالّ مسار الكتابة ممنوحة — لا كتابة تفشل بسبب صلاحية.';
  end if;
end $$;

notify pgrst, 'reload schema';
