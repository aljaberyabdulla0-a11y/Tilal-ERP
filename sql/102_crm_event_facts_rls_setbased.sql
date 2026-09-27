-- ============================================================
-- تلال ERP — 102: سياسة قراءة الأحداث — مرة لكل استعلام لا لكل صفّ
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== ما قيس =====
--
-- مؤشّرات ٣٠ يوماً (تواصل، عملاء فريدون، ليدات، فوز) على القاعدة الحيّة:
--
--     المدير            ~٤٠ms     (يتجاوز RLS)
--     المشرف / الموظف   ٢٫٤–٥٫٤ ثانية
--
-- واللوحة ~٢٠ استعلاماً = دقيقة لمشرف. والسبب في سياسة 096:
--
--     … or (client_id is not null and public.can_see_client(client_id))
--
-- دالةٌ تُستدعى **لكل حدث** (~٥٠٠٠)، وكل استدعاء يُعيد حساب نطاق
-- السائل (my_scope_employees، my_scope_name_keys) من جديد.
--
-- ===== الإصلاح — نفس التعريف، مرة واحدة =====
--
-- crm_my_visible_clients() تُرجع **مجموعة** العملاء الذين يقرؤهم السائل
-- — بصلاحيته (invoker)، أي بسياسة «read own clients» نفسها. والسياسة
-- هنا تسأل «هل العميل في المجموعة؟» — استعلامٌ فرعي غير مرتبط يُحسب
-- مرة ويُبحث فيه بالتجزئة.
--
-- ⚠️ المحاولة الأولى لفّت can_see_client على كل عميل (definer) — ثانية
--    كاملة: الدالة ~١ms للاستدعاء × ٩٠٠ عميل. وسياسة clients نفسها
--    تعطي نفس المجموعة في ٦ms لأنها مبنية على مجموعات (my_scope_* مرة).
--    و094 يقرّر أن can_see_client مرآةٌ لشروط «read own clients» — فهي
--    نفس النطاق، بلا تعريف ثانٍ.
--
-- القياس بعدها (مشرفون وموظف، القاعدة الحيّة ٢٠٢٦-٠٩-٢٧):
--     مؤشّرات ٣٠ يوماً        ١٢–٤٣ms   (كانت ٢٤٠٠–٥٤٠٠)
--     الموظف × اليوم ١٤ يوماً  ١٠–١٧ms
--     «الحالة الآن» بالموظف   ~٩٠٠ms   ← سياسة opportunities (095) تستدعي
--                              can_see_client لكل فرصة خارج النطاق.
--                              تعديلها قرارٌ مستقل: الصيغة المجموعية توسّع
--                              رؤية الوسيط للفرص. موثّق في CRM_ARCHITECTURE §٢٠.
--
-- يتطلب: 096. آمن لإعادة التشغيل.
-- ============================================================

create or replace function public.crm_my_visible_clients()
returns table (id uuid) language sql stable set search_path = public as $$
  select c.id from public.clients c;
$$;

comment on function public.crm_my_visible_clients() is
  'العملاء الذين يقرؤهم السائل — بسياسة "read own clients" نفسها (security invoker)، مجموعةً تُحسب مرة للاستعلام (102).';

revoke all on function public.crm_my_visible_clients() from public, anon;
grant execute on function public.crm_my_visible_clients() to authenticated, service_role;

drop policy if exists "read event facts" on public.crm_event_facts;
create policy "read event facts" on public.crm_event_facts
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or employee_id in (select s.id from public.my_scope_employees() s)
    or owner_id    in (select s.id from public.my_scope_employees() s)
    or ((select public.is_accountant())
        and (event_type in ('reservation', 'sale_completed', 'reservation_cancelled')
             or (event_type = 'stage_change' and to_stage_type = 'won')))
    or client_id in (select v.id from public.crm_my_visible_clients() v)
  );

notify pgrst, 'reload schema';
