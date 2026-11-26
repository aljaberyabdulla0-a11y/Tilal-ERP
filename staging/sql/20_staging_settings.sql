-- ════════════════════════════════════════════════════════════════════════
-- Tilal ERP — إعدادات خاصة بـ STAGING بعد الاستعادة (الخطوة 4)
-- الدلاء (فارغة)، وموقع مكتب وهمي، ولا cron. لا شيء هنا مأخوذ من الإنتاج.
-- ════════════════════════════════════════════════════════════════════════
select staging_meta.assert_staging();

-- الدلاء الستة كما في الإنتاج (كلها خاصة) — بلا ملفات
insert into storage.buckets (id, name, public) values
  ('client-documents',  'client-documents',  false),
  ('marketing-assets',  'marketing-assets',  false),
  ('employee-documents','employee-documents',false),
  ('recruitment',       'recruitment',       false),
  ('expense-receipts',  'expense-receipts',  false),
  ('task-attachments',  'task-attachments',  false)
on conflict (id) do nothing;
-- حدّ ٢٥ م.ب لمرفقات المهام كما في 189
update storage.buckets set file_size_limit = 26214400 where id = 'task-attachments' and file_size_limit is null;

-- موقع مكتب وهمي (وسط بغداد التقريبي) — حُذف موقع الإنتاج عند التصدير
update public.company_settings
   set office_name = 'مكتب staging', office_lat = 33.3152, office_lng = 44.3661, geofence_enabled = false;

-- لا مهام cron على staging: الاختبارات تستدعي دوال المسح مباشرة
select count(*) as cron_jobs_on_staging from cron.job;
