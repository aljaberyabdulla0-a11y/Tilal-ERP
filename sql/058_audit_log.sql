-- ============================================================
-- تلال ERP — 058: سجلّ التدقيق
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- مسحوبة إلى الأمام من المرحلة ٤/ب لأنها **شرطٌ** للمرحلة ١:
-- معاملات خصم الدوام تُغيَّر من شاشة، واشتُرط أن يُسجَّل كل تغيير
-- فيها بقيمته قبل وبعد ومن غيّرها ومتى.
--
-- ===== المشكلة =====
--
-- النظام يسجّل أحداث الوحدات العقارية بدقّة (unit_events)، ويسجّل
-- تسليم الموظفين (employee_handovers)، ولا يسجّل شيئاً عن المال:
-- تغيير راتب، تعديل عمولة، حذف كشف، خصمٌ يُضاف — كلها بلا أثر.
--
-- ===== المبدأ =====
--
-- محفّزٌ واحد عام يُركَّب على الجداول الحسّاسة. يُكتب من القاعدة
-- فلا يُلفَّق سطرٌ فيه ولا يُنسى تسجيلٌ لأن شاشةً سهت.
--
-- ⚠️ ولا أحد يملك الحذف — ولا المدير. الجدول عليه سياسة قراءة
--    للمدير وحدها، ولا سياسة insert ولا update ولا delete إطلاقاً.
--    والمحفّزات تكتب فيه بصلاحية المالك متجاوزةً RLS.
--    سجلٌّ يُحذف منه ليس سجلّ تدقيق.
--
-- ⚠️ يخزّن الصفّ كاملاً jsonb — ومنه الرواتب. ولذلك القراءة
--    للمدير فقط، تماماً كجدول employees نفسه.
--
-- ===== التراجع =====
--   حذف المحفّزات الاثني عشر ثم:
--   drop function public.audit_row(); drop table public.audit_log;
--
-- طُبّق على القاعدة في 2026-09-04 عبر هجرة:
--   audit_log
--
-- آمن لإعادة التشغيل.
-- ============================================================

create table if not exists public.audit_log (
  id             bigserial primary key,
  table_name     text not null,
  record_id      uuid,
  operation      text not null check (operation in ('INSERT','UPDATE','DELETE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  actor          uuid,
  actor_name     text,
  at             timestamptz not null default now()
);

create index if not exists audit_log_table_record on public.audit_log (table_name, record_id, at desc);
create index if not exists audit_log_at          on public.audit_log (at desc);
create index if not exists audit_log_actor       on public.audit_log (actor, at desc);

comment on table public.audit_log is
  'سجلّ تدقيق المال والصلاحيات. تكتبه المحفّزات وحدها، ولا يملك أحد الحذف منه — ولا المدير (sql/058).';
comment on column public.audit_log.changed_fields is
  'الأعمدة التي تغيّرت فعلاً في UPDATE — تُغني عن مقارنة صفّين كاملين بالعين.';

-- ------------------------------------------------------------
-- المحفّز العام
-- ------------------------------------------------------------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_fields text[];
  v_id     uuid;
  v_who    text;
  k        text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    -- الأعمدة التي تغيّرت فعلاً
    select array_agg(key order by key) into v_fields
      from jsonb_each(v_new) e(key, val)
     where v_old -> e.key is distinct from e.val;

    -- تحديثٌ لم يغيّر شيئاً لا يُسجَّل: يملأ السجلّ بلا فائدة
    if v_fields is null or array_length(v_fields, 1) is null then
      return null;
    end if;
  end if;

  -- المعرّف: أغلب جداولنا id من نوع uuid، وبعضها (audit_log نفسه) لا
  k := coalesce(v_new ->> 'id', v_old ->> 'id');
  begin
    v_id := k::uuid;
  exception when others then
    v_id := null;
  end;

  if auth.uid() is not null then
    select coalesce(e.full_name, p.email) into v_who
      from public.profiles p
      left join public.employees e on e.user_id = p.id
     where p.id = auth.uid();
  end if;

  insert into public.audit_log
    (table_name, record_id, operation, old_data, new_data, changed_fields, actor, actor_name)
  values (tg_table_name, v_id, tg_op, v_old, v_new, v_fields, auth.uid(),
          coalesce(v_who, 'النظام'));

  return null;   -- AFTER trigger
end;
$fn$;

-- ------------------------------------------------------------
-- تركيبه على الجداول الحسّاسة
-- ------------------------------------------------------------
-- company_settings ضمنها عمداً: فيها معاملات خصم الدوام، واشتُرط
-- تسجيل كل تغيير فيها.
do $do$
declare t text;
begin
  foreach t in array array[
    'payrolls', 'payroll_lines', 'payroll_payments',
    'commissions', 'deductions', 'employees', 'employee_salary_history',
    'journal_entries', 'payments', 'invoices', 'sale_commissions',
    'company_settings'
  ] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.audit_row()', t);
  end loop;
end $do$;

-- ------------------------------------------------------------
-- الصلاحيات: قراءة للمدير، ولا كتابة ولا حذف لأحد
-- ------------------------------------------------------------
alter table public.audit_log enable row level security;

drop policy if exists "admin reads audit log" on public.audit_log;
create policy "admin reads audit log" on public.audit_log
  for select to authenticated
  using ((select public.is_admin()));

-- لا سياسة insert/update/delete عمداً: المحفّزات تكتب بصلاحية
-- المالك، وما عداها ممنوع — فلا يُحذف سطر ولا يُعدَّل.

revoke insert, update, delete on public.audit_log from authenticated, anon;

notify pgrst, 'reload schema';
