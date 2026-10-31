-- ============================================================
-- تلال ERP — 219: البطاقة عند من هي عنده — النقل والدمج لا يُبقيانها
--                 عند الموظف السابق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- الطلب (2026-10-31): «من تندمج بطاقتين أو نحوّل زبون من موظف إلى
--   موظف آخر يظل يظهر للشخص الأول — مثل زبون انتقل من نرمين وصار عند
--   آية وبعده يطلع عند نرمين».
--
-- السبب (قيس على الحيّة):
--   (أ) النقل: قاعدة الرؤية فيها «من أنشأ البطاقة يراها» (created_by)
--       بلا شرط. نرمين أنشأت «ذو الفقار نوري» ثم نقله المشرف لآية
--       (2026-10-22) فبقيت تراها وتعدّلها. ٦٦ بطاقة اليوم يراها منشئها
--       الموظف وهي عند غيره (نوران ٣١، لندا ٢٠ لندى من الترحيل، منار ١٤…).
--   (ب) الدمج (169): من خسر الملكية يُسجَّل «مشاهِداً» (client_watchers)
--       فيبقى يرى الباقية. ٦ صفوف اليوم، ومعها مهمّتان مفتوحتان عند
--       الموظفة السابقة على بطاقتين ليستا لها.
--   (ج) وكشفت الحالة نفسها ثغرة ثالثة: فرصة أُغلقت «فشل بيع» عند نرمين
--       ثم نُقلت البطاقة لآية وأعاد المشرف فتح الفرصة — فبقيت الفرصة
--       المفتوحة لنرمين (187 تنقل المفتوحة عند نقل البطاقة فقط، والفرصة
--       كانت مغلقة لحظتها). عملت عليها آية وأغلقتها «فشل بيع» اليوم،
--       فسُجّل الفشل الثاني على نرمين.
--
-- الحلّ:
--   (١) المنشئ وحده لا يكفي للرؤية: يرى بطاقته وهي بلا مالك، أو في
--       نصف الساعة الأولى من إنشائها — فإضافة عميلٍ باسم زميل تبقى
--       تعمل (النموذج يقرأ البطاقة بعد الإدخال، وقد يفتح شاشة الدمج).
--       بعدها يراها مالكها ومشرفه فقط. (owner_assigned_at لا يصلح
--       علامةً للنقل: نقلٌ يدوي في 10-25 و10-27 لم يحرّكه.)
--   (٢) client_watchers لا تُعطي رؤية بعد اليوم — تبقى سجلّاً لمن
--       كانت له بطاقة طُويت. والدمج ينقل مهام البطاقة المفتوحة عند
--       أصحاب البطاقتين السابقين إلى المالك النهائي.
--   (٣) نقل البطاقة ينقل مهامها المفتوحة من المالك السابق إلى الجديد
--       (كما تنقل 187 فرصها المفتوحة). المنجزة والملغاة تبقى سجلّ عمله.
--   (٤) إعادة فتح فرصة مغلقة تُعيدها لمالك البطاقة الحالي.
--   (٥) تصحيح البيانات: الفشل الثاني لـ«ذو الفقار نوري» لآية، ومهمّتا
--       ندى لمالكتي البطاقتين.
--
-- ما لا يتغيّر: الفرص المغلقة (فوز/فشل) تبقى لصاحبها الأصلي (187)،
--   وأنشطته السابقة تبقى محسوبة له في التقارير — تاريخ عمله لا البطاقة.
--
-- يتطلب: 169، 187، 211. آمن لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الرؤية: المالك ومشرفه — لا المنشئ بعد إنشائها ولا المشاهِد
-- ------------------------------------------------------------
create or replace function public.my_visible_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
   where not (select public.is_broker())
     and c.deleted_at is null
     and ((select public.is_admin())
       -- مدير التسويق: كل الليدات (212)
       or (select public.is_marketing_manager())
       -- منشئها: وهي بلا مالك أو ساعة إنشائها (219)
       or (c.created_by = (select auth.uid())
           and (c.owner_id is null or c.created_at > now() - interval '30 minutes'))
       -- أنا ومن أُشرف عليهم — بالمفتاح
       or c.owner_id in (select s.id from public.my_scope_employees() s)
       -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
       or (c.sales_employee is not null
           and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k)));
$$;

create or replace function public.can_see_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_broker()
     and exists (
    select 1 from public.clients c
     where c.id = cid
       and c.deleted_at is null
       and (
         public.is_admin()
         -- مدير التسويق: كل الليدات (212)
         or public.is_marketing_manager()
         -- منشئها: وهي بلا مالك أو ساعة إنشائها (219)
         or (c.created_by = auth.uid()
             and (c.owner_id is null or c.created_at > now() - interval '30 minutes'))
         -- أنا ومن أُشرف عليهم — بالمفتاح
         or (c.owner_id is not null
             and c.owner_id in (select s.id from public.my_scope_employees() s))
         -- وبالاسم، جسر التوافق للعملاء القدامى بلا owner_id
         or (c.sales_employee is not null
             and public.name_key(c.sales_employee) in (select k.name_key from public.my_scope_name_keys() k))
       )
  );
$$;

alter policy "read own clients" on public.clients using (
  ((deleted_at is null) and (select public.is_marketing_manager()))
  or ((deleted_at is null) and (
       (select public.is_admin())
    or (select public.is_followup_manager())
    or (select public.can_read_all_crm())
    -- منشئها: وهي بلا مالك أو ساعة إنشائها (219)
    or (created_by = (select auth.uid())
        and (owner_id is null or created_at > now() - interval '30 minutes'))
    or ((owner_id is not null) and (owner_id in (select s.id from public.my_scope_employees() s)))
    or ((sales_employee is not null)
        and (public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)))
    or ((broker_company_id is not null) and (broker_company_id = (select public.my_broker_company())))
    or ((broker_company_id is not null)
        and (broker_company_id in (select m.company_id from public.my_rm_companies() m)))))
);

alter policy "update own clients" on public.clients
  using (
    ((select public.is_marketing_manager()) and (not (select public.is_broker())))
    or ((select public.is_admin())
     or (created_by = (select auth.uid())
         and (owner_id is null or created_at > now() - interval '30 minutes'))
     or ((owner_id is not null) and (owner_id in (select s.id from public.my_scope_employees() s)))
     or ((sales_employee is not null)
         and (public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)))
     or ((broker_company_id is not null) and (broker_company_id = (select public.my_broker_company())))
     or ((broker_company_id is not null)
         and (broker_company_id in (select m.company_id from public.my_rm_companies() m)))))
  with check (
    ((select public.is_marketing_manager()) and (not (select public.is_broker())))
    or ((select public.is_admin())
     or (created_by = (select auth.uid())
         and (owner_id is null or created_at > now() - interval '30 minutes'))
     or ((owner_id is not null) and (owner_id in (select s.id from public.my_scope_employees() s)))
     or ((sales_employee is not null)
         and (public.name_key(sales_employee) in (select k.name_key from public.my_scope_name_keys() k)))
     or ((broker_company_id is not null) and (broker_company_id = (select public.my_broker_company())))
     or ((broker_company_id is not null)
         and (broker_company_id in (select m.company_id from public.my_rm_companies() m)))));

-- الفرص: منشئ الفرصة لا يراها بعد أن صارت لغيره — مالكها وبطاقتها يكفيان
alter policy "read opportunities" on public.opportunities using (
  (select public.is_admin())
  or (select public.is_followup_manager())
  or (select public.can_read_all_crm())
  or (created_by = (select auth.uid()) and owner_id is null)
  or ((owner_id is not null) and (owner_id in (select s.id from public.my_scope_employees() s)))
  or (client_id in (select public.my_visible_client_ids()))
);

comment on table public.client_watchers is
  'سجلّ: من كانت له بطاقة طُويت في هذه (169). لا يعطي رؤية منذ 219.';

-- ------------------------------------------------------------
-- 2) نقل البطاقة ينقل مهامها المفتوحة من المالك السابق إلى الجديد
-- ------------------------------------------------------------
create or replace function public.sync_open_opportunities_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.opportunities o
     set owner_id = new.owner_id, project_id = coalesce(o.project_id, public.crm_lead_project(new.id, new.owner_id))
   where o.client_id = new.id
     and o.closed_at is null
     and o.deleted_at is null
     and o.owner_id is distinct from new.owner_id;

  -- (219) ومهامها المفتوحة عند المالك السابق. المنجزة والملغاة سجلّ عمله.
  if old.owner_id is not null and new.owner_id is not null then
    update public.tasks t
       set assigned_to = ne.user_id, assigned_to_name = ne.full_name
      from public.employees oe, public.employees ne
     where oe.id = old.owner_id and ne.id = new.owner_id
       and oe.user_id is not null and ne.user_id is not null
       and t.client_id = new.id
       and t.assigned_to = oe.user_id
       and t.status in ('جديدة', 'قيد التنفيذ');
  end if;
  return null;
end $$;

-- ------------------------------------------------------------
-- 3) إعادة فتح فرصة مغلقة تُعيدها لمالك البطاقة الحالي
-- ------------------------------------------------------------
create or replace function public.prepare_opportunity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g     public.crm_stages%rowtype;
  cname text;
  pname text;
  ucode text;
  cur_owner uuid;
begin
  select * into g from public.crm_stages where id = new.stage_id;
  if g.id is null then
    raise exception 'المرحلة غير معروفة.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by_name := coalesce(public.my_employee_name(),
                                    public.display_name(auth.uid()));
    if new.owner_id is null then
      select owner_id into new.owner_id from public.clients where id = new.client_id;
    end if;
    -- 206: المسار يولد بمشروع ليده
    if new.project_id is null then
      new.project_id := public.crm_lead_project(new.client_id, new.owner_id);
    end if;
  end if;

  if new.title is null or btrim(new.title) = '' then
    select name into cname from public.clients where id = new.client_id;
    select name into pname from public.projects where id = new.project_id;
    select unit_code into ucode from public.units where id = new.unit_id;
    new.title := coalesce(nullif(btrim(cname), ''), 'فرصة')
                 || coalesce(' — ' || pname, '')
                 || coalesce(' / ' || ucode, '');
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
    if new.probability is not distinct from old.probability then
      new.probability := g.probability;
    end if;
  elsif tg_op = 'INSERT' and new.probability is null then
    new.probability := g.probability;
  end if;

  if g.stage_type in ('won', 'lost', 'closed') then
    new.closed_at := coalesce(new.closed_at, now());
    if g.stage_type = 'won' then
      new.won_value := new.won_value;  -- 209: الإيراد عمولة تلال (crm_journey_revenue) لا ثمن الوحدة
    end if;
    new.next_action      := null;
    new.next_action_date := null;
  else
    new.closed_at := null;
    new.won_value := null;
    -- (219) فُتحت من جديد: الفرصة المفتوحة لمالك بطاقتها (187)
    if tg_op = 'UPDATE' and old.closed_at is not null and new.deleted_at is null then
      select owner_id into cur_owner from public.clients where id = new.client_id;
      if cur_owner is not null then
        new.owner_id := cur_owner;
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end; $$;

-- ------------------------------------------------------------
-- 4) الدمج: لا «يراها أيضاً» — مهامها المفتوحة تنتقل للمالك النهائي
-- ------------------------------------------------------------
-- merge_clients الحيّة (169 + 210) بتعديلين نصّيين مُتحقَّق منهما.
do $patch$
declare
  f text := pg_get_functiondef('public.merge_clients(uuid,uuid,text[])'::regprocedure);
  old1 text := E'  get diagnostics n = row_count;\n  if n > 0 then moved := moved || jsonb_build_object(''يراها أيضاً'', n); end if;';
  new1 text := E'  -- (219) المشاهَدة سجلٌّ لا رؤية: مهام البطاقة المفتوحة عند أصحاب\n'
            || E'  -- البطاقتين السابقين تنتقل للمالك النهائي\n'
            || E'  if final_emp is not null then\n'
            || E'    update public.tasks t\n'
            || E'       set assigned_to = fe.user_id, assigned_to_name = fe.full_name\n'
            || E'      from public.employees fe, public.employees pe\n'
            || E'     where fe.id = final_emp and fe.user_id is not null\n'
            || E'       and pe.id = any(involved) and pe.id <> final_emp and pe.user_id is not null\n'
            || E'       and t.client_id = p_keep_id\n'
            || E'       and t.assigned_to = pe.user_id\n'
            || E'       and t.status in (''جديدة'', ''قيد التنفيذ'');\n'
            || E'    get diagnostics n = row_count;\n'
            || E'    if n > 0 then moved := moved || jsonb_build_object(''مهام للمالك'', n); end if;\n'
            || E'  end if;';
  old2 text := '''، وتبقى ترى البطاقة وتاريخها.''';
  new2 text := '''.''';
begin
  f := replace(f, chr(13), '');
  if strpos(f, '(219) المشاهَدة سجلٌّ لا رؤية') > 0 then
    raise notice '219: merge_clients مُعدّلة سابقاً';
    return;
  end if;
  if (length(f) - length(replace(f, old1, ''))) / length(old1) <> 1 then
    raise exception '219: نصّ «يراها أيضاً» في merge_clients غير موجود مرّة واحدة';
  end if;
  if (length(f) - length(replace(f, old2, ''))) / length(old2) <> 1 then
    raise exception '219: نصّ «وتبقى ترى البطاقة» في merge_clients غير موجود مرّة واحدة';
  end if;
  execute replace(replace(f, old1, new1), old2, new2);
end $patch$;

-- ------------------------------------------------------------
-- 5) تصحيح البيانات
-- ------------------------------------------------------------
do $fix$
declare
  v_aya uuid := (select id from public.employees where full_name = 'اية عبدالحسين');
  v_opp uuid := 'e1ce4388-013b-4d84-8dfa-5a0dff900674';   -- ذو الفقار نوري
  v_loss uuid := '7a0c2eb3-7dd0-486d-a6f3-50fe4bc02142';  -- فشله الثاني (2026-10-31، آية)
  n int;
begin
  -- (أ) أعاد خالد فتحها لآية (2026-10-22) وأغلقتها آية: الفرصة وفشلها الثاني لها.
  --     فشلها الأول (2026-10-18) يبقى لنرمين.
  if v_aya is not null then
    update public.opportunities set owner_id = v_aya where id = v_opp and owner_id is distinct from v_aya;
    -- stamp_lost_sale يجمّد owner_id («ما كان يوم الخسارة») — وهنا يوم
    -- الخسارة كانت لآية، فالتصحيح يتخطّاه لهذا الصفّ وحده
    alter table public.crm_lost_sales disable trigger trg_stamp_lost_sale;
    update public.crm_lost_sales
       set owner_id = v_aya, owner_name = 'اية عبدالحسين', updated_at = now()
     where id = v_loss and owner_id is distinct from v_aya;
    alter table public.crm_lost_sales enable trigger trg_stamp_lost_sale;
    -- حقائق التقارير: إعادة الفتح (18763) والفشل الثاني (21424)
    update public.crm_event_facts
       set employee_id = v_aya, updated_at = now()
     where opportunity_id = v_opp and id in (18763, 21424)
       and employee_id is distinct from v_aya;
    raise notice '219: «ذو الفقار نوري» — الفرصة وفشلها الثاني لآية';
  end if;

  -- (ب) مهام مفتوحة عند موظفٍ كانت له البطاقة (نُقلت منه أو طُويت بطاقته
  --     فيها) وليست له اليوم ← لمالكها.
  update public.tasks t
     set assigned_to = oe.user_id, assigned_to_name = oe.full_name
    from public.clients c, public.employees e, public.employees oe
   where c.id = t.client_id and c.deleted_at is null
     and oe.id = c.owner_id and oe.user_id is not null
     and e.user_id = t.assigned_to and e.id <> c.owner_id
     and t.status in ('جديدة', 'قيد التنفيذ')
     and (exists (select 1 from public.client_watchers w where w.client_id = c.id and w.employee_id = e.id)
          or exists (select 1 from public.client_assignments a where a.client_id = c.id and a.from_owner_id = e.id));
  get diagnostics n = row_count;
  raise notice '219: % مهمة مفتوحة انتقلت لمالك بطاقتها', n;
end $fix$;

notify pgrst, 'reload schema';
