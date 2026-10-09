-- ============================================================
-- 200 — التسويق: المزامنة المجدولة لمنصّات الإعلان (pg_net)
--
-- 126 تركت الجدولة معلّقة: pg_net غير مثبّت، فلا تنادي القاعدة دالّة
-- الحافة marketing-sync. هنا:
--
--   1) pg_net.
--   2) سرّ الجدولة في Vault (mkt_cron_secret) — يولَّد هنا ولا يُكتب في
--      أي ملف ولا في نصّ المهمة (cron.job مقروء لمن يقرأ القاعدة).
--   3) mkt_cron_secret_ok(p) لـ service_role وحده — بها تتحقّق الدالّة
--      من ترويسة x-cron-secret، فلا يلزم نسخ السرّ إلى أسرار الدوالّ
--      (MKT_CRON_SECRET يبقى مقبولاً إن ضُبط).
--   4) المهمة mkt-sync-hourly كل ساعة: الدالّة تزامن «كل ساعة» كل مرة،
--      و«يومي» إن مضى ٢٠ ساعة على آخر محاولة — فالتكرار يقرّره التكامل.
--
-- دالّة الحافة تُنشر بـ verify_jwt = false: المجدول لا يحمل JWT، والدالّة
-- تتحقّق بنفسها (السرّ للمجدول، can_write_marketing لجلسة المستخدم).
--
-- يتطلب: 126، pg_cron، supabase_vault. آمن لإعادة التشغيل.
-- ============================================================

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'mkt_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'mkt_cron_secret',
      'ترويسة x-cron-secret لنداء marketing-sync المجدول (200)');
  end if;
end $$;

create or replace function public.mkt_cron_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> ''
     and exists (select 1 from vault.decrypted_secrets
                  where name = 'mkt_cron_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.mkt_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.mkt_cron_secret_ok(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mkt-sync-hourly') then
    perform cron.unschedule('mkt-sync-hourly');
  end if;
  perform cron.schedule('mkt-sync-hourly', '20 * * * *', $job$
    select net.http_post(
      url     := 'https://edgblrqkushnznhmuxln.supabase.co/functions/v1/marketing-sync',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mkt_cron_secret')),
      body    := '{"mode":"scheduled"}'::jsonb,
      timeout_milliseconds := 300000)
  $job$);
end $$;

-- ------------------------------------------------------------
-- التحقّق
-- ------------------------------------------------------------
do $$
begin
  raise notice '--- 200 التسويق — المزامنة المجدولة ---';
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise warning 'pg_net غير مثبّت';
  end if;
  if not exists (select 1 from cron.job where jobname = 'mkt-sync-hourly') then
    raise warning 'المهمة mkt-sync-hourly لم تُجدول';
  end if;
  if not exists (select 1 from vault.secrets where name = 'mkt_cron_secret') then
    raise warning 'سرّ الجدولة غير موجود';
  end if;
end $$;
