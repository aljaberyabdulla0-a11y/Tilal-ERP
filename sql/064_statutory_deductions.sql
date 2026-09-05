-- ============================================================
-- تلال ERP — 064: الاستقطاعات القانونية (المرحلة ٥/أ)
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ⚠️ **يُشحن مطفأً وبلا شريحة واحدة.**
--    قال المالك: «لا تفترض نِسَب العراق من ذاكرتك — اطلب مني
--    الأرقام، وابنِ المحرّك بحيث تكون الشرائح بيانات لا كوداً».
--    فهذا المحرّك مبنيّ كاملاً، وجدول الشرائح **فارغ**، والمفتاحان
--    مطفآن. لا يُنتج بنداً واحداً حتى تُدخَل الأرقام وتُشغَّل.
--
-- ===== المبدأ المحاسبي =====
--
-- الضريبة والضمان **يُقتطعان من الموظف ولا يُنقصان المصروف**:
-- الشركة تحمّلت الراتب كاملاً، لكنها تحتجز جزءاً لتورّده لجهة
-- ثالثة. فالمصروف كما هو، والالتزام ينقسم:
--
--     مدين 5100 الرواتب        E
--        دائن 2300 مستحقات      E − ضريبة − ضمان − قسط سلفة
--        دائن 2310 ضريبة دخل    الضريبة
--        دائن 2320 ضمان اجتماعي حصّة الموظف
--        دائن 1360 سلف الموظفين قسط السلفة
--
-- وهو نفس منطق قسط السلفة في sql/062: ما يُنقص الالتزام يُفرد
-- بسطر دائن، وما يُنقص المصروف (الغياب) يُطرح من E.
--
-- ⚠️ حصّة **الشركة** في الضمان مصروفٌ إضافي عليها لا اقتطاع من
--    الموظف، وقيدها مختلف. لم تُبنَ هنا: تحتاج قرار المالك
--    (أتُطبَّق؟ وبأي نسبة؟ وعلى أي وعاء؟).
--
-- ===== الشرائح بيانات =====
--
-- payroll_tax_brackets: لكل نوع (ضريبة/ضمان) شرائح تصاعدية،
-- كل شريحة حدٌّ أدنى ونسبة. والحساب تصاعدي حقيقي: كل جزء من
-- الوعاء يُضرب بنسبة شريحته لا بنسبة الشريحة العليا وحدها.
--
-- ===== التراجع =====
--   payroll_tax_enabled = false و social_security_enabled = false
--   أو حذف الشرائح. والبنية تبقى بلا أثر.
--
-- طُبّق على القاعدة في 2026-09-05 عبر هجرة:
--   statutory_deductions
--
-- يتطلب: sql/062 (نمط فصل الالتزام عن المصروف).
-- آمن لإعادة التشغيل.
-- ============================================================

insert into public.accounts (code, name, type) values
  ('2310', 'ضريبة دخل مستحقة',   'liability'),
  ('2320', 'ضمان اجتماعي مستحق', 'liability')
on conflict (code) do nothing;

alter table public.company_settings
  add column if not exists payroll_tax_enabled      boolean not null default false,
  add column if not exists social_security_enabled  boolean not null default false,
  add column if not exists statutory_base           text not null default 'إجمالي'
    check (statutory_base in ('أساسي', 'إجمالي'));

comment on column public.company_settings.statutory_base is
  'وعاء الاستقطاع القانوني: «أساسي» = الراتب الأساسي وحده · «إجمالي» = الأساسي والبدلات (بلا عمولات).';
comment on column public.company_settings.payroll_tax_enabled is
  'مطفأ حتى تُدخَل شرائح الضريبة وتُراجَع بالمعاينة.';

create table if not exists public.payroll_tax_brackets (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('ضريبة', 'ضمان')),
  min_amount numeric not null default 0 check (min_amount >= 0),
  rate       numeric not null check (rate >= 0 and rate <= 100),
  note       text,
  constraint payroll_tax_brackets_uniq unique (kind, min_amount)
);

comment on table public.payroll_tax_brackets is
  'شرائح الاستقطاع القانوني — بيانات لا كود. تُدخَل من الشاشة، ويُحسب بها تصاعدياً (sql/064).';
comment on column public.payroll_tax_brackets.min_amount is
  'الحدّ الأدنى للشريحة. ما بين هذا الحدّ وحدّ الشريحة التالية يُضرب بنسبة هذه الشريحة.';

-- ------------------------------------------------------------
-- الحساب التصاعدي
-- ------------------------------------------------------------
-- كل جزء من الوعاء بنسبة شريحته. مثال بشرائح 0%→0 و 5%→500,000:
--   وعاء 800,000 ← أول 500,000 بصفر، والباقي 300,000 بـ5% = 15,000
create or replace function public.statutory_amount(p_kind text, p_base numeric)
returns numeric
language plpgsql stable security definer set search_path = public
as $fn$
declare b record; v_next numeric; v_slice numeric; v_total numeric := 0;
begin
  if coalesce(p_base, 0) <= 0 then return 0; end if;

  for b in select * from public.payroll_tax_brackets
            where kind = p_kind order by min_amount
  loop
    if p_base <= b.min_amount then exit; end if;

    select min(x.min_amount) into v_next from public.payroll_tax_brackets x
     where x.kind = p_kind and x.min_amount > b.min_amount;

    v_slice := least(p_base, coalesce(v_next, p_base)) - b.min_amount;
    if v_slice > 0 then
      v_total := v_total + v_slice * b.rate / 100.0;
    end if;
  end loop;

  return round(v_total);
end;
$fn$;

-- ------------------------------------------------------------
-- بنود الكشف
-- ------------------------------------------------------------
create or replace function public.statutory_deductions(p_employee uuid, p_period text)
returns table (category text, description text, amount numeric)
language plpgsql stable security definer set search_path = public
as $fn$
declare s public.company_settings%rowtype; emp public.employees%rowtype;
        v_base numeric; v_allow numeric; v_amt numeric; v_start date;
begin
  if not public.is_admin() then
    raise exception 'حساب الاستقطاعات القانونية للمدير';
  end if;

  select * into s from public.company_settings where id = 1;
  if s is null then return; end if;
  if not s.payroll_tax_enabled and not s.social_security_enabled then
    return;                       -- مطفأ: لا بند
  end if;

  select * into emp from public.employees where id = p_employee;
  if not found then return; end if;

  -- الوعاء بالراتب الساري في الفترة، لا بالراتب الحالي
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_base  := public.salary_at(p_employee, v_start);

  if s.statutory_base = 'إجمالي' then
    select coalesce(sum(l.amount), 0) into v_allow
      from public.payroll_lines l
      join public.payrolls p on p.id = l.payroll_id
     where p.employee_id = p_employee and p.period = p_period
       and l.kind = 'استحقاق' and l.category = 'بدل';
    v_base := v_base + coalesce(v_allow, 0);
  end if;

  if s.payroll_tax_enabled then
    v_amt := public.statutory_amount('ضريبة', v_base);
    if v_amt > 0 then
      category := 'ضريبة دخل';
      description := 'ضريبة دخل على وعاء ' || public.fmt_qty(v_base) || ' د.ع';
      amount := v_amt;
      return next;
    end if;
  end if;

  if s.social_security_enabled then
    v_amt := public.statutory_amount('ضمان', v_base);
    if v_amt > 0 then
      category := 'ضمان اجتماعي';
      description := 'ضمان اجتماعي — حصّة الموظف على ' || public.fmt_qty(v_base) || ' د.ع';
      amount := v_amt;
      return next;
    end if;
  end if;
end;
$fn$;

-- الفئتان الجديدتان
alter table public.payroll_lines drop constraint if exists payroll_lines_category_chk;
alter table public.payroll_lines add constraint payroll_lines_category_chk check (
  (kind = 'استحقاق' and category in
    ('راتب أساسي', 'بدل', 'عمولة', 'مكافأة', 'عمل إضافي', 'استحقاق آخر'))
  or
  (kind = 'استقطاع' and category in
    ('غياب', 'تأخير', 'انصراف مبكر', 'إجازة بلا راتب',
     'قسط سلفة', 'سلفة', 'ضريبة دخل', 'ضمان اجتماعي', 'استقطاع آخر'))
);

alter table public.payroll_tax_brackets enable row level security;
drop policy if exists "admin manages tax brackets" on public.payroll_tax_brackets;
create policy "admin manages tax brackets" on public.payroll_tax_brackets
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists trg_audit_payroll_tax_brackets on public.payroll_tax_brackets;
create trigger trg_audit_payroll_tax_brackets
  after insert or update or delete on public.payroll_tax_brackets
  for each row execute function public.audit_row();

revoke execute on function public.statutory_amount(text, numeric)  from public, anon;
revoke execute on function public.statutory_deductions(uuid, text)  from public, anon;
grant  execute on function public.statutory_deductions(uuid, text)  to authenticated;

notify pgrst, 'reload schema';
