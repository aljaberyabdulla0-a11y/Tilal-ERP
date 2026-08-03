-- ============================================================
-- تلال ERP — تصفير البيانات التجريبية (المحاسبة + الفواتير)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ تحذير: الحذف نهائي ولا يمكن التراجع عنه.
--
-- يُحذف:
--   • الحركات المالية (cash_moves) وكل قيود اليومية وسطورها
--   • كشوف الرواتب ودفعاتها + العمولات + الاستقطاعات
--   • الفواتير ودفعاتها (ويعود ترقيم الفواتير إلى INV-0001)
--   • تسويات الشركاء
--
-- يبقى كما هو (لا يُمسّ):
--   • حسابات الدخول والصلاحيات (auth.users, profiles)
--   • شجرة الحسابات (accounts) والشركاء (عبدالله وأحمد)
--   • العملاء والوحدات العقارية والحجوزات
--   • ملفات الموظفين والحضور والإجازات
--
-- ملاحظة: حذف الصفوف يُشغّل المحفّزات التي تحذف القيود المرتبطة تلقائياً،
--         ثم نحذف ما تبقّى من قيود يدوية في الخطوة الأخيرة.
-- ============================================================

begin;

-- 1) الرواتب (الدفعات أولاً ثم الكشوف)
delete from public.payroll_payments;
delete from public.payrolls;

-- 2) العمولات والاستقطاعات
delete from public.commissions;
delete from public.deductions;

-- 3) الفواتير (الدفعات أولاً ثم الفواتير)
delete from public.payments;
delete from public.invoices;

-- 4) الحركات المالية المبسّطة
delete from public.cash_moves;

-- 5) تسويات الشركاء
delete from public.partner_settlements;

-- 6) أي قيود يومية متبقّية (يدوية أو يتيمة) — السطور تُحذف تلقائياً بالتتابع
delete from public.journal_lines;
delete from public.journal_entries;

-- 7) إرجاع ترقيم الفواتير إلى البداية (أول فاتورة جديدة = INV-0001)
alter sequence public.invoice_seq restart with 1;

commit;

-- ------------------------------------------------------------
-- تحقّق: المفروض كل الأرقام تحت = 0
-- ------------------------------------------------------------
select 'الحركات المالية'   as "الجدول", count(*) as "عدد الصفوف" from public.cash_moves
union all select 'قيود اليومية',    count(*) from public.journal_entries
union all select 'سطور القيود',     count(*) from public.journal_lines
union all select 'كشوف الرواتب',    count(*) from public.payrolls
union all select 'دفعات الرواتب',   count(*) from public.payroll_payments
union all select 'العمولات',        count(*) from public.commissions
union all select 'الاستقطاعات',     count(*) from public.deductions
union all select 'الفواتير',        count(*) from public.invoices
union all select 'دفعات الفواتير',  count(*) from public.payments
union all select 'تسويات الشركاء',  count(*) from public.partner_settlements;

-- ------------------------------------------------------------
-- تحقّق: هذي المفروض تبقى موجودة (أرقامها أكبر من صفر)
-- ------------------------------------------------------------
select 'شجرة الحسابات'  as "بقي كما هو", count(*) as "عدد الصفوف" from public.accounts
union all select 'الشركاء',   count(*) from public.partners
union all select 'العملاء',   count(*) from public.clients
union all select 'الوحدات',   count(*) from public.units
union all select 'الموظفون',  count(*) from public.employees;
