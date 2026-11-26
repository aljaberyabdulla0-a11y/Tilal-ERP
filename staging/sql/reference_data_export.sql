-- ════════════════════════════════════════════════════════════════════════
-- Tilal ERP — تصدير بيانات الإعداد المرجعية فقط (قراءة فقط)
-- يُشغَّل على الإنتاج عبر psql من 1-export-from-production.ps1 (الاتصال مفروض read-only).
-- الناتج ملف SQL يُدرج في staging: صفوف جداول الإعداد في القائمة البيضاء أدناه فقط.
--
-- ما يُحذف من كل صفّ قبل التصدير (لا يخرج من الإنتاج أصلاً):
--   • كل عمود مفتاح أجنبي يشير إلى جدول خارج القائمة (المستخدمون، الموظفون، العملاء، المشاريع، خطط العمولة…)
--   • كل عمود اسمه ينتهي بـ _by أو _by_name، و actor_name
--   • أعمدة محدّدة يدوياً: موقع المكتب، نطاقات الرواتب
-- ما لا يُصدَّر إطلاقاً: العملاء، الموظفون، الحسابات، الرواتب، القيود، الإشعارات، السجلّ،
--   أسرار التكامل (mkt_integration_secrets / mkt_integrations)، المشاريع والوحدات، كل ما يخص أشخاصاً.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin transaction read only;

\qecho '-- Tilal ERP reference data for STAGING. Generated read-only from production. Contains no personal data.'
\qecho 'do $g$ begin if coalesce((select name from staging_meta.environment limit 1), '''') <> ''staging'' then raise exception ''STOP: not a staging database''; end if; end $g$;'
\qecho 'begin;'
\qecho 'set local session_replication_role = replica;'

with allow(ord, t, extra_strip) as (values
  ( 1, 'app_modules',                  '{}'::text[]),
  ( 2, 'roles',                        '{}'),
  ( 3, 'role_permissions',             '{}'),
  ( 4, 'approval_workflows',           '{}'),
  ( 5, 'approval_steps',               '{}'),
  ( 6, 'branches',                     '{}'),
  ( 7, 'departments',                  '{}'),
  ( 8, 'employment_types',             '{}'),
  ( 9, 'job_grades',                   '{salary_min,salary_max}'),
  (10, 'positions',                    '{}'),
  (11, 'employment_status_transitions','{}'),
  (12, 'crm_stages',                   '{}'),
  (13, 'crm_stage_transitions',        '{}'),
  (14, 'crm_sources',                  '{}'),
  (15, 'crm_activity_types',           '{}'),
  (16, 'crm_loss_sources',             '{}'),
  (17, 'crm_loss_categories',          '{}'),
  (18, 'crm_lost_reasons',             '{}'),
  (19, 'crm_recovery_levels',          '{}'),
  (20, 'crm_customer_potentials',      '{}'),
  (21, 'crm_settings',                 '{}'),
  (22, 'crm_sla_rules',                '{}'),
  (23, 'crm_score_rules',              '{}'),
  (24, 'crm_metrics',                  '{}'),
  (25, 'crm_report_templates',         '{}'),
  (26, 'task_workspaces',              '{}'),
  (27, 'task_sources',                 '{}'),
  (28, 'task_types',                   '{}'),
  (29, 'task_entity_types',            '{}'),
  (30, 'task_workflows',               '{}'),
  (31, 'task_workflow_steps',          '{}'),
  (32, 'task_templates',               '{}'),
  (33, 'task_template_items',          '{}'),
  (34, 'task_automation_rules',        '{}'),
  (35, 'department_task_settings',     '{}'),
  (36, 'kpi_definitions',              '{}'),
  (37, 'performance_settings',         '{}'),
  (38, 'leave_types',                  '{}'),
  (39, 'clearance_templates',          '{}'),
  (40, 'onboarding_templates',         '{}'),
  (41, 'employee_document_types',      '{}'),
  (42, 'accounts',                     '{}'),
  (43, 'expense_categories',           '{}'),
  (44, 'hr_account_map',               '{}'),
  (45, 'payroll_tax_brackets',         '{}'),
  (46, 'unit_types',                   '{}'),
  (47, 'work_shifts',                  '{}'),
  (48, 'company_settings',             '{office_name,office_lat,office_lng}'),
  (49, 'mkt_approval_rules',           '{}'),
  (50, 'mkt_automation_rules',         '{}')
),
cols as (
  select a.ord, a.t,
         -- الأعمدة التي تُحذف
         array(
           select distinct x from (
             select unnest(a.extra_strip) x
             union
             select at.attname::text
               from pg_constraint k
               join pg_attribute at on at.attrelid = k.conrelid and at.attnum = any (k.conkey)
              where k.conrelid = ('public.' || a.t)::regclass and k.contype = 'f'
                and k.confrelid not in (select ('public.' || t)::regclass from allow)
             union
             select attname::text from pg_attribute
              where attrelid = ('public.' || a.t)::regclass and attnum > 0 and not attisdropped
                and (attname ~ '_by$' or attname ~ '_by_name$' or attname = 'actor_name')
           ) s
         ) as strip
    from allow a
)
select format(
  $g$select format('insert into public.%%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%%I, %%L::jsonb) on conflict do nothing;', %L, %L, coalesce(jsonb_agg(to_jsonb(r) - %L::text[]), '[]'::jsonb)) from public.%I r$g$,
  ins.list, ins.list, c.t, c.t, c.strip::text, c.t)
  from cols c
  cross join lateral (
    select string_agg(quote_ident(attname), ', ' order by attnum) as list
      from pg_attribute
     where attrelid = ('public.' || c.t)::regclass and attnum > 0 and not attisdropped
       and attgenerated = '' and not (attname::text = any (c.strip))
  ) ins
 order by c.ord
\gexec

\qecho 'commit;'
commit;
