-- ============================================================
-- تلال ERP — لوحة المبيعات (Sales Pipeline / Kanban)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- نضيف للعميل: مرحلة المبيعات (stage) وتاريخ المتابعة (follow_up_date)،
-- ونسمح للموظفين بتحريك المراحل (تحديث العميل).
-- ============================================================

alter table public.clients add column if not exists stage text not null default 'ليد';
alter table public.clients add column if not exists follow_up_date date;

-- السماح لكل مسجّل بتحديث العملاء (لتحريك البطاقات في لوحة المبيعات)
-- الحذف يبقى للمدراء فقط.
drop policy if exists "admins can update clients"        on public.clients;
drop policy if exists "authenticated can update clients" on public.clients;
create policy "authenticated can update clients"
  on public.clients for update to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
