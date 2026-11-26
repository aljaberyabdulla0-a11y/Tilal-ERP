-- ════════════════════════════════════════════════════════════════════════
-- Tilal ERP — تهيئة مشروع STAGING (الخطوة 0). يُشغَّل مرة واحدة على مشروع staging الفارغ فقط.
-- ينشئ علامة البيئة التي تفحصها كل سكربتات staging قبل أي كتابة، والامتدادات اللازمة.
-- حماية: يرفض العمل إن وجد أي أثر لقاعدة فيها بيانات (الإنتاج).
-- ════════════════════════════════════════════════════════════════════════
do $g$
begin
  if to_regclass('public.clients') is not null then
    raise exception 'STOP: public.clients exists — this is not an empty staging project. Bootstrap runs once, before the schema restore.';
  end if;
  if exists (select 1 from auth.users limit 1) then
    raise exception 'STOP: auth.users is not empty — refusing to mark this database as staging.';
  end if;
end $g$;

create schema if not exists staging_meta;
create table if not exists staging_meta.environment (
  name        text primary key check (name = 'staging'),
  created_at  timestamptz not null default now(),
  source_note text
);
insert into staging_meta.environment (name, source_note)
values ('staging', 'Tilal ERP staging. Structure from production schema dump; data synthetic only.')
on conflict do nothing;
revoke all on schema staging_meta from anon, authenticated;

-- الامتدادات كما في الإنتاج (inventory.json). pgcrypto وuuid-ossp وpg_stat_statements وsupabase_vault مفعّلة افتراضياً.
-- المخطّطات مطابقة للإنتاج (2026-11-26): pg_trgm في public (فهارس trigram تشير إليه)، والبقية في extensions.
create extension if not exists pg_trgm  with schema public;
create extension if not exists pgtap    with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net   with schema extensions;
-- ملاحظة: لا تُنشأ أي مهمة cron هنا. مهام الإنتاج (23) لا تُنسخ؛ الاختبارات تستدعي دوال المسح مباشرة.

-- سجلّ هجرات Supabase: يُنشئه Supabase عند أول هجرة عبر CLI/اللوحة، وقد لا يوجد في مشروع جديد.
-- البنية مطابقة للإنتاج حرفياً (2026-11-26) كي تُختبر آلية التسجيل (Q14) على staging كما ستعمل في الإنتاج.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version         text primary key,
  statements      text[],
  name            text,
  created_by      text,
  idempotency_key text unique,
  rollback        text[]
);
-- مثل الإنتاج: القيد الفريد باسم schema_migrations_idempotency_key_key
do $g$ begin
  if not exists (select 1 from pg_constraint where conname = 'schema_migrations_idempotency_key_key') then
    raise exception 'supabase_migrations.schema_migrations exists with a different structure — compare with production before continuing';
  end if;
end $g$;

-- دالة الحارس لاستعمال الهجرات والاختبارات على staging
create or replace function staging_meta.assert_staging() returns void
language plpgsql as $$
begin
  if coalesce((select name from staging_meta.environment limit 1), '') <> 'staging' then
    raise exception 'STOP: not a staging database';
  end if;
end $$;

select 'staging marker ready' as result, (select name from staging_meta.environment) as env;
