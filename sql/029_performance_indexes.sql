-- ============================================================
-- تلال ERP — فهارس الأداء
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- جدولا الإجازات والحجوزات كانا بلا أي فهرس غير المفتاح الأساسي،
-- فكل استعلام يمسح الجدول كاملاً. الأثر بسيط اليوم لصغر البيانات،
-- لكنه يتضاعف مع نمو السجلات — وهذه الفهارس رخيصة.
--
-- الملف آمن لإعادة التشغيل.
-- ============================================================

-- الإجازات: تُستعلم بالموظف، وبالحالة مع مدى التواريخ (صفحات الدوام)
create index if not exists leaves_employee_idx
  on public.leaves (employee_id, start_date desc);

create index if not exists leaves_status_range_idx
  on public.leaves (status, start_date, end_date);

-- الحجوزات: تُستعلم بمن أنشأها وبالعميل وبالوحدة
create index if not exists reservations_created_by_idx
  on public.reservations (created_by);

create index if not exists reservations_client_idx
  on public.reservations (client_id);

create index if not exists reservations_unit_idx
  on public.reservations (unit_id);

-- سجلّ التواصل: نستعلم أيضاً بمن سجّله (تقارير أداء الفريق)
create index if not exists client_activities_created_by_idx
  on public.client_activities (created_by);

-- الرواتب والعمولات والاستقطاعات: كلها تُستعلم بالموظف
create index if not exists payrolls_employee_idx    on public.payrolls (employee_id);
create index if not exists commissions_employee_idx on public.commissions (employee_id);
create index if not exists deductions_employee_idx  on public.deductions (employee_id);

analyze public.leaves;
analyze public.reservations;
analyze public.client_activities;
analyze public.clients;

notify pgrst, 'reload schema';
