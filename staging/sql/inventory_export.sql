-- Tilal ERP — جرد قراءة فقط لبناء staging والتحقق منه. أسماء فقط، لا محتوى ولا أوامر cron.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin transaction read only;
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'tables', (select jsonb_agg(jsonb_build_object('name', 'public.' || c.relname) order by c.relname)
               from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'views', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('v', 'm')),
  'functions_public', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace),
  'functions_tests', (select count(*) from pg_proc where pronamespace = to_regnamespace('tests')),
  'policies', (select count(*) from pg_policies where schemaname = 'public'),
  'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
  'extensions', (select jsonb_agg(extname || ' ' || extversion order by extname) from pg_extension),
  'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit,
                                                   'allowed_mime_types', allowed_mime_types) order by id) from storage.buckets),
  'cron_job_names', (select jsonb_agg(jobname order by jobname) from cron.job),
  'auth_users_triggers', (select jsonb_agg(tgname order by tgname) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal)
));
commit;
