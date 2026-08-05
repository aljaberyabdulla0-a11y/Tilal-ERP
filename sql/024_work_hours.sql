-- ============================================================
-- تلال ERP — أوقات الدوام الرسمية
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- بدون أوقات رسمية ما نقدر نعرف: منو تأخّر، منو انصرف بدري، ومنو غايب
-- في يوم دوام. هنا نضيفها لإعدادات الشركة، ويضبطها المدير من صفحة الإعدادات.
--
-- يتطلب: sql/021 (جدول company_settings). الملف آمن لإعادة التشغيل.
-- ============================================================

alter table public.company_settings
  add column if not exists work_start_time     time    not null default '09:00',
  add column if not exists work_end_time       time    not null default '17:00',
  add column if not exists late_grace_minutes  integer not null default 15,
  -- أيام الدوام: 0=الأحد ... 6=السبت. الافتراضي الأحد→الخميس
  add column if not exists work_days           integer[] not null default '{0,1,2,3,4}';

-- حراسة بسيطة على القيم
alter table public.company_settings drop constraint if exists company_settings_hours_chk;
alter table public.company_settings add constraint company_settings_hours_chk
  check (work_end_time > work_start_time and late_grace_minutes between 0 and 240);

-- الفهرس الموجود attendance_employee_day_uidx يخدم الاستعلام بالموظف،
-- وهذا يخدم استعلام «كل الموظفين في يوم/شهر معيّن».
create index if not exists attendance_work_date_idx on public.attendance (work_date);

notify pgrst, 'reload schema';
