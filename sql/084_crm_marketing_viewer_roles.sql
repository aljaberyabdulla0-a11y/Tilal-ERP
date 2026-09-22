-- ============================================================
-- تلال ERP — 084: دورا التسويق والمُطالِع
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- المتطلّبات (§50) تطلب ثمانية أدوار. سبعة منها موجودة، والثامن
-- «Finance» موجودٌ باسمه العربي: `accountant`. فلا يُضاف دور ثانٍ
-- بنفس العمل — دوران يفعلان الشيء نفسه يفترقان مع الوقت، فتُمنح
-- صلاحية لأحدهما وتُنسى للآخر، ولا أحد يعرف أيّهما الصحيح.
--
--     Finance        = accountant (sql/068)
--     Sales          = employee
--     Manager        = admin
--     الناقص فعلاً   = marketing و viewer
--
-- ===== ما يفعلانه =====
--
-- **التسويق** يحتاج أن يرى أثر قنواته حتى البيع: أي مصدر يجيب
-- ليدات، وأيّها يجيب مؤهَّلين، وأيّها يجيب صفقات. وتقارير المصدر
-- والحملة والإسناد كلها بـ security_invoker (076) — أي تُنفَّذ
-- بصلاحية السائل. فلو لم يرَ التسويقُ العملاءَ لعادت تقاريره أصفاراً
-- لا أخطاء، وهو أسوأ: رقمٌ كاذب لا رسالة منع.
--
-- فيقرأ العملاء والفرص، **ولا يكتب فيهما حرفاً**: لا إنشاء، ولا
-- تعديل، ولا إسناد، ولا حذف، ولا تصدير. ويكتب ما هو عمله وحده:
-- الحملات ومصروفها، وبوّابة الليدات الواردة.
--
-- **المُطالِع** يقرأ ولا يكتب شيئاً البتّة. للإدارة العليا والمراجعة
-- والمدقّق الخارجي: يرى الأرقام ولا يمسّ سجلاً.
--
-- ⚠️ كلاهما يرى بيانات شخصية (أسماء وأرقام). الحدّ هنا حدُّ **كتابة**
--    لا حدُّ خصوصية. حجب الأرقام عن التسويق مع إبقاء تقاريره صحيحة
--    يحتاج عرضاً مُقنَّعاً (masked view) — مرحلة مستقلة، وذكرها هنا
--    أصدق من الصمت عنها.
--
-- ===== المبدأ =====
--
--     لا سياسة كتابة جديدة. الإضافة كلها قراءة.
--
-- كل ما يلي يوسّع `using` على القراءة، ولا يلمس `with check` على
-- الكتابة إلا في الحملات والبوّابة — حيث التسويق هو صاحب العمل.
--
-- يتطلب: 070–083. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الدوران في قيد الأدوار
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles add constraint profiles_role_chk
  check (role in ('admin', 'accountant', 'hr', 'supervisor', 'followup_manager',
                  'relationship_manager', 'broker', 'marketing', 'viewer', 'employee'));

comment on column public.profiles.role is
  'الدور. finance = accountant (sql/068) فلا دور باسم finance. marketing وviewer قراءة فقط على الـCRM (084).';

-- ------------------------------------------------------------
-- 2) دوال الفحص — نقطة واحدة تقابلها auth.ts حرفياً
-- ------------------------------------------------------------
create or replace function public.is_marketing()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'marketing');
$$;

create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'viewer');
$$;

-- من يقرأ الـCRM كلّه بلا أن يكتب فيه. تُستدعى من كل سياسة قراءة
-- أدناه، فتوسيع القائمة لاحقاً يتمّ في مكان واحد.
create or replace function public.can_read_all_crm()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_marketing() or public.is_viewer();
$$;

comment on function public.can_read_all_crm() is
  'قراءة شاملة بلا كتابة: التسويق والمُطالِع. أي دور قراءة جديد يُضاف هنا وحده.';

revoke all on function public.is_marketing()     from public;
revoke all on function public.is_viewer()        from public;
revoke all on function public.can_read_all_crm() from public;
grant execute on function public.is_marketing()     to authenticated, service_role;
grant execute on function public.is_viewer()        to authenticated, service_role;
grant execute on function public.can_read_all_crm() to authenticated, service_role;

-- ------------------------------------------------------------
-- 3) القراءة — العملاء
--    الشروط القائمة كما هي حرفياً، ويُضاف شرط واحد بـ or.
-- ------------------------------------------------------------
drop policy if exists "read own clients" on public.clients;
create policy "read own clients" on public.clients
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select public.is_admin())
      or (select public.is_followup_manager())
      or (select public.can_read_all_crm())          -- ← الجديد
      or created_by = (select auth.uid())
      or (owner_id is not null
          and owner_id in (select s.id from public.my_scope_employees() s))
      or (sales_employee is not null
          and public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
      or (broker_company_id is not null
          and broker_company_id = (select public.my_broker_company()))
      or (broker_company_id is not null
          and broker_company_id in (select m.company_id from public.my_rm_companies() m))
    )
  );

-- ⚠️ سياسات الكتابة على clients لا تُمَسّ: التسويق والمُطالِع خارجها
--    بحكم عدم ذكرهما فيها. الصمت هنا هو المنع.

-- ------------------------------------------------------------
-- 4) القراءة — الفرص وتاريخها والاهتمامات
-- ------------------------------------------------------------
drop policy if exists "read opportunities" on public.opportunities;
create policy "read opportunities" on public.opportunities
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or created_by = (select auth.uid())
    or (owner_id is not null and owner_id in (select s.id from public.my_scope_employees() s))
    or public.can_see_client(client_id)
  );

drop policy if exists "read opp history" on public.opportunity_stage_history;
create policy "read opp history" on public.opportunity_stage_history
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or exists (select 1 from public.opportunities o
                where o.id = opportunity_id and public.can_see_client(o.client_id))
  );

drop policy if exists "read interests" on public.client_interests;
create policy "read interests" on public.client_interests
  for select to authenticated
  using ((select public.is_admin())
         or (select public.can_read_all_crm())
         or public.can_see_client(client_id));

-- ------------------------------------------------------------
-- 5) القراءة — التواصل والدرجات واللقطات والأهداف
-- ------------------------------------------------------------
drop policy if exists "read client activities" on public.client_activities;
create policy "read client activities" on public.client_activities
  for select to authenticated
  using (
    (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or (select public.can_see_client(client_id))
    or (select public.can_see_broker_lead(client_id))
  );

drop policy if exists "read lead scores" on public.crm_lead_scores;
create policy "read lead scores" on public.crm_lead_scores
  for select to authenticated
  using ((select public.is_admin())
         or (select public.can_read_all_crm())
         or public.can_see_client(client_id));

drop policy if exists "read snapshots" on public.crm_snapshots;
create policy "read snapshots" on public.crm_snapshots
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or (select public.is_supervisor()) or (select public.can_read_all_crm()));

drop policy if exists "read forecast snapshots" on public.crm_forecast_snapshots;
create policy "read forecast snapshots" on public.crm_forecast_snapshots
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or (select public.is_supervisor()) or (select public.can_read_all_crm()));

drop policy if exists "read targets" on public.sales_targets;
create policy "read targets" on public.sales_targets
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    or (scope = 'شركة')
    or (scope = 'موظف' and scope_id in (select s.id from public.my_scope_employees() s))
    or (scope = 'فريق' and scope_id in (select t.id from public.my_supervised_projects() t))
  );

-- ------------------------------------------------------------
-- 6) الكتابة الوحيدة المضافة — الحملات والبوّابة للتسويق
--
-- وهو عمله لا عملُ غيره: من يصرف على القناة يُسجّل مصروفها.
-- ------------------------------------------------------------
drop policy if exists "admin writes campaigns" on public.crm_campaigns;
create policy "admin writes campaigns" on public.crm_campaigns
  for all to authenticated
  using ((select public.is_admin()) or (select public.is_marketing()))
  with check ((select public.is_admin()) or (select public.is_marketing()));

drop policy if exists "read intake" on public.crm_lead_intake;
create policy "read intake" on public.crm_lead_intake
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_followup_manager())
         or (select public.is_marketing()));

drop policy if exists "admin writes intake" on public.crm_lead_intake;
create policy "admin writes intake" on public.crm_lead_intake
  for all to authenticated
  using ((select public.is_admin()) or (select public.is_marketing()))
  with check ((select public.is_admin()) or (select public.is_marketing()));

-- ⚠️ المصادر تبقى للمدير وحده: تغيير قائمة المصادر يغيّر تصنيف كل
--    التقارير التاريخية، وهو قرار إداري لا تسويقي.

-- ------------------------------------------------------------
-- 7) الوحدات والمشاريع — للقراءة فقط، وللمُطالِع والتسويق
--    تقرير «الطلب على المشروع» يحتاجهما.
-- ------------------------------------------------------------
-- ⚠️ الشكل الأصلي محفوظ حرفياً: الوسيط مستثنىً أولاً بـ case (sql/043)،
--    ثم الشروط القائمة كما هي، ويُضاف شرط واحد. لا تُبسَّط الـcase —
--    هي التي تمنع شركة وسيطة من رؤية مخزون تلال كلّه.
drop policy if exists "read units in scope" on public.units;
create policy "read units in scope" on public.units
  for select to authenticated
  using (
    case
      when (select public.is_broker()) then false
      else (
        (select public.is_admin())
        or (select public.can_read_all_crm())          -- ← الجديد
        or project_id is null
        or project_id in (select m.id from public.my_project_ids() m(id))
        or exists (select 1 from public.projects p
                    where p.id = units.project_id and p.supervisor_id is null)
      )
    end
  );


-- ------------------------------------------------------------
-- 9) اختبارات الدورين — tests.run_roles()
--
-- ⚠️ security invoker عمداً لا definer: اختبار RLS يحتاج تبديل الدور
--    إلى authenticated بـ set local role، وهو ممنوع داخل definer.
--
-- وكشفت هذه الاختبارات سلوكاً يجب أن يعرفه من يبني واجهة:
--
--     RLS تمنع التعديل **صمتاً** — صفر صفوف بلا خطأ.
--
-- فتحديثٌ من غير مالك لا يُثير استثناءً؛ يُصيب صفر صفوف ويعود
-- بنجاح. ومن يعرض زرّ حفظ لمن لا يملك يُظهر له «حُفظ» ولم يُحفظ
-- شيء. لذلك تُخفى أزرار الكتابة عن الدورين في كل شاشة — لا لأن
-- إظهارها ثغرة أمنية بل لأنه كذب على المستخدم.
--
-- (الإدراج يختلف: with check يرفضه بـ 42501 فعلاً.)
--
-- تعريف الدالة في القاعدة — تُشغَّل بـ:  select * from tests.run_roles();
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- 8) التحقّق — يقول ما يراه كل دور فعلاً
-- ------------------------------------------------------------
do $$
declare r record;
begin
  raise notice '--- 084 دورا التسويق والمُطالِع ---';
  raise notice 'القيد يقبل: marketing و viewer.';
  raise notice 'finance = accountant — لا دور باسم finance عمداً.';

  for r in select role, count(*) n from public.profiles group by role order by role loop
    raise notice '  % — % حساباً', r.role, r.n;
  end loop;

  raise notice 'لتعيين دور: update profiles set role = ''marketing'' where email = ''…'';';
end $$;

notify pgrst, 'reload schema';
