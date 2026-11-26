-- ════════════════════════════════════════════════════════════════════════
-- 227_ops_foundation
-- أساس: سبب التغيير ومصدره في سجلّ التدقيق، ووحدات المصفوفة الجديدة
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
  v_name constant text := '227_ops_foundation';
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

-- 227 — أساس تعدد الوظائف والمسؤوليات وفريق الجودة
-- (1) سجلّ التدقيق يحمل سبب التغيير ومصدره  (2) وحدات المصفوفة الجديدة وصلاحياتها الأولية
-- إضافي بالكامل: لا يغيّر سلوك أي جدول أو سياسة قائمة. المرجع: docs/MULTI_ROLE_OPERATIONS_DESIGN.md §٤-٥، §٦-٤

-- ── 1) سبب التغيير ومصدره ─────────────────────────────────────
alter table public.audit_log add column if not exists reason text;
alter table public.audit_log add column if not exists source text;
comment on column public.audit_log.reason is 'سبب التغيير — من tilal.audit_reason (227)';
comment on column public.audit_log.source is 'مصدر العملية (الدالة/الشاشة/النظام) — من tilal.audit_source (227)';

-- نفس النصّ الحيّ (058) + العمودان الجديدان. الفارغ يبقى null.
create or replace function public.audit_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old jsonb; v_new jsonb; v_fields text[]; v_id uuid; v_who text; k text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select array_agg(key order by key) into v_fields
      from jsonb_each(v_new) e(key, val)
     where v_old -> e.key is distinct from e.val;
    if v_fields is null or array_length(v_fields, 1) is null then
      return null;
    end if;
  end if;

  k := coalesce(v_new ->> 'id', v_old ->> 'id');
  begin
    v_id := k::uuid;
  exception when others then
    v_id := null;
  end;

  if auth.uid() is not null then
    select coalesce(e.full_name, p.email) into v_who
      from public.profiles p
      left join public.employees e on e.user_id = p.id
     where p.id = auth.uid();
  end if;

  insert into public.audit_log
    (table_name, record_id, operation, old_data, new_data, changed_fields, actor, actor_name, reason, source)
  values (tg_table_name, v_id, tg_op, v_old, v_new, v_fields, auth.uid(),
          coalesce(v_who, 'النظام'),
          nullif(current_setting('tilal.audit_reason', true), ''),
          nullif(current_setting('tilal.audit_source', true), ''));

  return null;
end;
$function$;

-- تضبطه دوال الكتابة قبل التغيير؛ يسري حتى نهاية المعاملة
create or replace function public.tilal_audit_context(p_reason text, p_source text default null)
returns void language plpgsql set search_path = public as $$
begin
  perform set_config('tilal.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('tilal.audit_source', coalesce(p_source, ''), true);
end $$;
revoke all on function public.tilal_audit_context(text, text) from public, anon, authenticated;

-- ── 2) وحدات المصفوفة الجديدة (مفروضة: لا سلوك قديم يُكسر) ───────────
insert into public.app_modules (code, name_ar, area, enforced, sort_order, note) values
  ('positions_assign',      'تعيين الوظائف',          'HR',      true, 60, '227 — الوظائف الأساسية والإضافية والمؤقتة'),
  ('responsibilities',      'مكتبة المسؤوليات',        'HR',      true, 61, '227 — تعريف المسؤوليات التشغيلية'),
  ('responsibility_assign', 'تكليف المسؤوليات',        'HR',      true, 62, '227 — إسناد المسؤوليات للموظفين'),
  ('review_teams',          'فرق المراجعة',            'الإدارة', true, 63, '227 — فريق ضبط الجودة وأعضاؤه'),
  ('quality_control',       'ضبط الجودة',              'الإدارة', true, 64, '227 — مراجعات الجودة'),
  ('permission_grants',     'المنح المباشر للصلاحيات', 'الإدارة', true, 65, '227 — للمدير العام فقط'),
  ('workload',              'الحمل الوظيفي',           'HR',      true, 66, '227 — المخطّط والفعلي'),
  ('allowances',            'البدلات والمخصصات',       'HR',      true, 67, '227 — بدلات الوظائف والمسؤوليات')
on conflict (code) do nothing;

-- الصلاحيات الأولية. الإدارة (is_admin) تمرّ دائماً من has_permission، والصفوف هنا للتوثيق وللمصفوفة.
insert into public.role_permissions (role_code, module, actions, scope)
select r.role_code, m.module, m.actions, r.scope
  from (values
    -- الإدارة العليا: كل شيء
    ('admin', 'all'), ('general_manager', 'all')
  ) r(role_code, scope)
  cross join (values
    ('positions_assign',      array['create','read','update','delete','approve','manage','export']),
    ('responsibilities',      array['create','read','update','delete','manage','export']),
    ('responsibility_assign', array['create','read','update','delete','approve','manage','export']),
    ('review_teams',          array['create','read','update','delete','manage']),
    ('quality_control',       array['create','read','update','approve','manage','export']),
    ('permission_grants',     array['create','read','update','delete','manage']),
    ('workload',              array['read','approve','export']),
    ('allowances',            array['create','read','update','approve','export','view_financial'])
  ) m(module, actions)
on conflict (role_code, module) do nothing;

insert into public.role_permissions (role_code, module, actions, scope) values
  -- HR: يدير الوظائف والمكتبة والتكليف والبدلات (بلا اعتماد البدل — المستوى الأول فقط)، ويقرأ الجودة
  ('hr_manager', 'positions_assign',      array['create','read','update','export'], 'all'),
  ('hr_manager', 'responsibilities',      array['create','read','update','export'], 'all'),
  ('hr_manager', 'responsibility_assign', array['create','read','update','export'], 'all'),
  ('hr_manager', 'review_teams',          array['read'], 'all'),
  ('hr_manager', 'quality_control',       array['read'], 'all'),
  ('hr_manager', 'workload',              array['read','export'], 'all'),
  ('hr_manager', 'allowances',            array['create','read','update','view_financial'], 'all'),
  ('hr',         'positions_assign',      array['create','read','update','export'], 'all'),
  ('hr',         'responsibilities',      array['create','read','update','export'], 'all'),
  ('hr',         'responsibility_assign', array['create','read','update','export'], 'all'),
  ('hr',         'workload',              array['read','export'], 'all'),
  ('hr',         'allowances',            array['create','read','update','view_financial'], 'all'),
  ('hr_officer', 'positions_assign',      array['read'], 'all'),
  ('hr_officer', 'responsibilities',      array['read'], 'all'),
  ('hr_officer', 'responsibility_assign', array['read'], 'all'),
  ('hr_officer', 'workload',              array['read'], 'all'),
  -- مدراء الأقسام: يقرؤون نطاقهم، ويكلّفون بمسؤوليات قسمهم المستفيد
  ('sales_manager',      'positions_assign',      array['read'], 'team'),
  ('sales_manager',      'responsibility_assign', array['create','read','update'], 'department'),
  ('sales_manager',      'workload',              array['read'], 'team'),
  ('marketing_manager',  'positions_assign',      array['read'], 'department'),
  ('marketing_manager',  'responsibility_assign', array['create','read','update'], 'department'),
  ('marketing_manager',  'workload',              array['read'], 'department'),
  ('operations_manager', 'positions_assign',      array['read'], 'department'),
  ('operations_manager', 'responsibility_assign', array['create','read','update'], 'department'),
  ('operations_manager', 'workload',              array['read'], 'department'),
  ('finance_manager',    'positions_assign',      array['read'], 'department'),
  ('finance_manager',    'responsibility_assign', array['create','read','update'], 'department'),
  ('finance_manager',    'workload',              array['read'], 'department'),
  ('finance_manager',    'allowances',            array['read','view_financial'], 'all'),
  ('crm_manager',        'positions_assign',      array['read'], 'team'),
  ('crm_manager',        'workload',              array['read'], 'team'),
  ('project_manager',    'positions_assign',      array['read'], 'team'),
  ('project_manager',    'workload',              array['read'], 'team'),
  ('supervisor',         'positions_assign',      array['read'], 'team'),
  ('supervisor',         'workload',              array['read'], 'team'),
  ('accountant',         'allowances',            array['read','view_financial'], 'all')
on conflict (role_code, module) do nothing;

-- كل موظف: يقرأ وظائفه وتكليفاته وحمله وبدلاته
insert into public.role_permissions (role_code, module, actions, scope)
select r, m, array['read'], 'own'
  from unnest(array['employee','sales_employee','marketing_employee','crm_employee','marketing',
                    'relationship_manager','followup_manager','viewer']) r
 cross join unnest(array['positions_assign','responsibility_assign','workload','allowances']) m
 where exists (select 1 from public.roles where code = r)
on conflict (role_code, module) do nothing;

-- ═══ الذيل ══════════════════════════════════════════════════════════════
do $tilal_reg_end$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where idempotency_key = 'tilal:227_ops_foundation') then
    raise exception 'MIGRATION_REGISTRATION_MISSING: 227_ops_foundation';
  end if;
end $tilal_reg_end$;

commit;
