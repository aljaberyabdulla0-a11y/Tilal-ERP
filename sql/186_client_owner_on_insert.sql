-- ============================================================
-- تلال ERP — 186: العميل الجديد يأخذ مالكه من اسم «موظف المبيعات»
--
-- العَرَض: تنبيه «ليدات بلا مالك» في لوحة التوزيع يعدّ مئات الليدات،
--   وعند فتحها يظهر لكل واحد اسم موظف المبيعات.
--
-- السبب: sync_client_owner() (071) يستنتج owner_id من النصّ
--   sales_employee في UPDATE فقط. في INSERT يدخل الفرع الأول
--   (tg_op = 'INSERT') ولا يفعل شيئاً ما دام owner_id فارغاً — ونموذج
--   العميل والاستيراد يرسلان الاسم وحده. فكل عميل أُضيف بعد ترحيل
--   071 (٢٠٢٦-٠٩-٢٢) بقي بلا مالك مفتاحي، ومعه فرصته (083 تنسخ
--   owner_id عند الإنشاء). الموظف يراه (RLS تطابق الاسم أيضاً)، لكن
--   كل ما يُبنى على owner_id لا يراه: حِمل التوزيع، التقارير، اللوحات.
--
-- الإصلاح:
--   1) في INSERT: إن جاء owner_id فارغاً والاسم موجوداً، نستنتجه بنفس
--      قاعدة UPDATE — تطابقٌ واحد لا لبس فيه، وإلا نترك المفتاح فارغاً.
--   2) ترحيل العملاء الحاليين بنفس القاعدة (يُكتب في client_assignments
--      بطريقة «ترحيل» عبر log_client_assignment).
--   3) الفرص المفتوحة بلا مالك تأخذ مالك عميلها.
-- ============================================================

create or replace function public.sync_client_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  emp_id   uuid;
  n_match  int;
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    -- المفتاح هو المرجع: النصّ يتبعه
    if new.owner_id is not null then
      select full_name into emp_name from public.employees where id = new.owner_id;
      if emp_name is not null then
        new.sales_employee := emp_name;
      end if;
      new.owner_assigned_at := coalesce(new.owner_assigned_at, now());

    elsif tg_op = 'INSERT'
          and new.sales_employee is not null and btrim(new.sales_employee) <> '' then
      -- إدخال بالاسم وحده (النموذج، الاستيراد): نستنتج المفتاح كما في UPDATE
      select count(*), (array_agg(e.id order by e.id))[1] into n_match, emp_id
        from public.employees e
       where public.name_key(e.full_name) = public.name_key(new.sales_employee);
      if n_match = 1 then
        new.owner_id := emp_id;
        new.owner_assigned_at := coalesce(new.owner_assigned_at, now());
      end if;
    end if;

  elsif new.sales_employee is distinct from old.sales_employee then
    -- النصّ وحده تغيّر: نستنتج المفتاح إن كان التطابق واحداً
    if new.sales_employee is null or btrim(new.sales_employee) = '' then
      new.owner_id := null;
    else
      -- min(uuid) غير موجودة في Postgres — أول عنصر من array_agg
      select count(*), (array_agg(e.id order by e.id))[1] into n_match, emp_id
        from public.employees e
       where public.name_key(e.full_name) = public.name_key(new.sales_employee);
      if n_match = 1 then
        new.owner_id := emp_id;
        new.owner_assigned_at := now();
      end if;
      -- تطابق صفر أو أكثر من واحد: نترك المفتاح كما هو ونُبقي النصّ.
      -- تقرير جودة البيانات يلتقط الحالة؛ لا نُخمّن هنا.
    end if;
  end if;

  return new;
end; $$;

-- ===== الترحيل: العملاء الذين بقوا بالاسم وحده =====
-- owner_assigned_at = تاريخ الإنشاء، لا اليوم: الإسناد الفعلي حصل يوم
-- أُضيف العميل، وإلا ظهرت دفعة «لم يُشتغَل عليها منذ إسنادها» مزيّفة.
with matched as (
  select c.id as client_id,
         (select (array_agg(e.id order by e.id))[1] from public.employees e
           where public.name_key(e.full_name) = public.name_key(c.sales_employee)) as emp_id,
         (select count(*) from public.employees e
           where public.name_key(e.full_name) = public.name_key(c.sales_employee)) as n
    from public.clients c
   where c.owner_id is null
     and c.sales_employee is not null
     and btrim(c.sales_employee) <> ''
)
update public.clients c
   set owner_id          = m.emp_id,
       owner_assigned_at = coalesce(c.owner_assigned_at, c.created_at)
  from matched m
 where c.id = m.client_id
   and m.n = 1;

-- ===== الفرص المفتوحة بلا مالك تأخذ مالك عميلها =====
update public.opportunities o
   set owner_id = c.owner_id
  from public.clients c
 where c.id = o.client_id
   and o.owner_id is null
   and o.closed_at is null
   and c.owner_id is not null;

-- ===== التحقّق =====
do $$
declare n_left int; n_open int; n_opp int;
begin
  select count(*) into n_left from public.clients
   where owner_id is null and sales_employee is not null and btrim(sales_employee) <> '';
  select count(*) into n_open from public.clients
   where owner_id is null and public.is_open_stage(stage);
  select count(*) into n_opp from public.opportunities o join public.clients c on c.id = o.client_id
   where o.owner_id is null and o.closed_at is null and c.owner_id is not null;
  raise notice '186: بلا مالك رغم وجود اسم: %   ليدات مفتوحة بلا مالك: %   فرص مفتوحة بلا مالك: %',
    n_left, n_open, n_opp;
end $$;
