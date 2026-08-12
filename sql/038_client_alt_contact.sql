-- ============================================================
-- تلال ERP — جهة اتصال بديلة للعميل
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- المطلوب (2026-08-12): كثير من العملاء يعطون رقم شخص آخر ينوب عنهم
-- في التواصل — قريب، زوج/زوجة، مدير أعمال، وكيل. نحتاج نحفظ اسمه
-- ورقمه وصفته.
--
-- **اختيارية بالكامل**: لا حقل منها إلزامي، وموظف المبيعات يقدر
-- يضيفها لاحقاً متى أعطاه العميل الرقم (سياسة update own clients
-- تسمح له بتعديل عملائه أصلاً — لا حاجة لصلاحية جديدة).
--
-- عمود واحد لكل معلومة بدل جدول مستقل: العميل له جهة اتصال بديلة
-- واحدة، والبحث والاستيراد والتصدير تبقى بسيطة. لو احتجنا أكثر من
-- واحدة يوماً ننقلها لجدول `client_contacts` بلا فقدان بيانات.
--
-- يتطلب: sql/001. آمن لإعادة التشغيل.
-- ============================================================

alter table public.clients add column if not exists alt_contact_name     text;
alter table public.clients add column if not exists alt_contact_phone    text;
alter table public.clients add column if not exists alt_contact_relation text;

comment on column public.clients.alt_contact_name is
  'اسم من ينوب عن العميل في التواصل (اختياري)';
comment on column public.clients.alt_contact_phone is
  'رقم من ينوب عن العميل — نفس صيغة هاتف العميل (اختياري)';
comment on column public.clients.alt_contact_relation is
  'صفته: قريب / زوج أو زوجة / مدير أعمال / وكيل / أخرى (اختياري)';

-- فهرس للبحث برقم البديل: حين يتصل القريب نريد الوصول للعميل بسرعة.
-- جزئي، فلا يشغل مساحة على العملاء الذين بلا جهة بديلة.
create index if not exists clients_alt_phone_idx
  on public.clients (alt_contact_phone)
  where alt_contact_phone is not null;

notify pgrst, 'reload schema';
