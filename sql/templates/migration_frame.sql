-- ════════════════════════════════════════════════════════════════════════
-- __NAME__
-- __TITLE__
--
-- إطار الهجرة (Q14 — 2026-11-26). لا تُعدِّل الرأس ولا الذيل يدوياً؛ يولّدهما staging/tools/new-migration.mjs.
--   • الملف كله معاملة واحدة صريحة (begin … commit): أي خطأ ⇒ لا تغيير ولا تسجيل.
--   • الرأس يرفض التشغيل إن كانت الهجرة مسجّلة (بالاسم أو بمفتاح التفرّد) ⇒ لا تطبيق مرتين ولا تسجيل مرتين.
--   • التسجيل في supabase_migrations.schema_migrations نفسه (سجلّ Supabase)، بمفتاح تفرّد 'tilal:<name>'
--     يفرضه القيد الفريد schema_migrations_idempotency_key_key.
--   • الذيل يتأكد من صفّ التسجيل قبل commit.
--   • يُطبَّق باللصق في SQL Editor أو بـ staging/run-sql.ps1. **لا يُرسل عبر apply_migration**
--     (الأداة تسجّل صفّها الخاص بعد التنفيذ ⇒ اسم مكرّر). إن لزم ذلك يوماً: احذف الرأس والذيل.
-- ════════════════════════════════════════════════════════════════════════
begin;

do $tilal_reg$
declare
  v_name constant text := '__NAME__';
  v_ts   timestamp;
begin
  if exists (select 1 from supabase_migrations.schema_migrations
              where name = v_name or idempotency_key = 'tilal:' || v_name) then
    raise exception 'MIGRATION_ALREADY_APPLIED: % مسجّلة في سجلّ الهجرات — لن تُطبَّق مرتين', v_name;
  end if;
  -- نسخة بصيغة سجلّ Supabase (UTC، 14 رقماً)، وأكبر من كل نسخة سابقة بثانية على الأقل
  v_ts := greatest(
    date_trunc('second', clock_timestamp() at time zone 'utc'),
    coalesce((select to_timestamp(max(version), 'YYYYMMDDHH24MISS')::timestamp + interval '1 second'
                from supabase_migrations.schema_migrations where version ~ '^\d{14}$'), '-infinity'::timestamp));
  insert into supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key)
  values (to_char(v_ts, 'YYYYMMDDHH24MISS'), v_name,
          array['-- applied from sql/' || v_name || '.sql; full text in git'],
          'sql-file:' || current_user, 'tilal:' || v_name);
end $tilal_reg$;

-- ═══ محتوى الهجرة ═══════════════════════════════════════════════════════

__BODY__

-- ═══ الذيل ══════════════════════════════════════════════════════════════
do $tilal_reg_end$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where idempotency_key = 'tilal:__NAME__') then
    raise exception 'MIGRATION_REGISTRATION_MISSING: __NAME__';
  end if;
end $tilal_reg_end$;

commit;
