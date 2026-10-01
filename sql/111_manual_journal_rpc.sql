-- ============================================================
-- تلال ERP — 111: القيد اليدوي ذرّياً، وعكسه
-- انسخ هذا الملف كاملاً والصقه في: Supabase ← SQL Editor ← New query ← Run
--
-- ===== لماذا =====
--
-- entry-form.tsx كان يكتب رأس القيد ثم سطوره في طلبين، ويحاول حذف
-- الرأس إن فشلت السطور. انقطاعٌ بين الطلبين يترك قيداً بلا سطور،
-- والتوازن مفحوص في المتصفّح وحده. منذ 108 لا يكتب المتصفّح في
-- دفتر القيود مباشرة، فهذه الدالّة هي الطريق الوحيد للقيد اليدوي.
--
-- ===== ما يضيفه =====
--
--   post_manual_entry(date, description, reference, lines jsonb, arm)
--     المدير أو المحاسب. كل شيء في معاملة واحدة: ينجح كاملاً أو
--     لا يُكتب شيء. يرفض:
--       • أقلّ من سطرين، أو سطراً بلا حساب أو بلا مبلغ
--       • سطراً مديناً ودائناً معاً، أو قيمة سالبة
--       • حساباً غير موجود أو غير نشط (4100 و2400 منذ 109)
--       • قيداً غير متوازن (ويعيد فحصه محفّز 108 عند الـ commit)
--       • تاريخاً في فترة مقفلة (حارس 063)
--     السطر: {"account_code":"1100","debit":100,"credit":0,"note":"…"}
--     أو account_id بدل الكود. المبالغ تُقرَّب لخانتين.
--
--   reverse_journal_entry(id, date, reason)
--     يعكس قيداً يدوياً بقيدٍ مقابل (المدين دائن والدائن مدين) بتاريخ
--     اليوم أو المُعطى — والأصل يبقى. القيد الآلي لا يُعكس من هنا:
--     يُعكس من مصدره (فسخ البيع، إعادة فتح الكشف، حذف الحركة…) كي
--     لا ينفصل عن صفّه. القيد يُعكس مرّة واحدة.
--
--   journal_entries.reversal_of — القيد الذي يعكسه هذا القيد.
--
-- يتطلب: 063، 068، 108. آمن لإعادة التشغيل.
-- ============================================================

alter table public.journal_entries
  add column if not exists reversal_of uuid references public.journal_entries(id) on delete restrict;

comment on column public.journal_entries.reversal_of is
  'القيد الذي يعكسه هذا القيد (sql/111). الأصل لا يُحذف ما دام له عاكس.';

create unique index if not exists journal_entries_reversal_once
  on public.journal_entries (reversal_of) where reversal_of is not null;


create or replace function public.post_manual_entry(
  p_date        date,
  p_description text,
  p_reference   text  default null,
  p_lines       jsonb default '[]'::jsonb,
  p_arm         text  default 'إداري عام'
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_entry uuid;
  l       jsonb;
  v_acc   public.accounts%rowtype;
  v_d     numeric; v_c numeric;
  v_td    numeric := 0; v_tc numeric := 0;
  v_n     int := 0;
  i       int := 0;
begin
  if not public.can_manage_finance() then
    raise exception 'القيد اليدوي للمدير أو المحاسب';
  end if;
  if p_date is null then
    raise exception 'تاريخ القيد مطلوب';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'اكتب بيان القيد';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'القيد يحتاج سطرين على الأقل';
  end if;

  insert into public.journal_entries
    (entry_date, description, reference, arm, source, created_by)
  values (p_date, btrim(p_description),
          coalesce(nullif(btrim(coalesce(p_reference, '')), ''), 'MANUAL'),
          coalesce(nullif(btrim(coalesce(p_arm, '')), ''), 'إداري عام'),
          null, auth.uid())
  returning id into v_entry;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_d := round(coalesce(nullif(l->>'debit',  '')::numeric, 0), 2);
    v_c := round(coalesce(nullif(l->>'credit', '')::numeric, 0), 2);

    if v_d < 0 or v_c < 0 then
      raise exception 'السطر %: المبلغ لا يكون سالباً', i;
    end if;
    if v_d > 0 and v_c > 0 then
      raise exception 'السطر %: مدين أو دائن — لا الاثنان', i;
    end if;
    if v_d = 0 and v_c = 0 then
      raise exception 'السطر %: بلا مبلغ', i;
    end if;

    v_acc := null;
    if nullif(l->>'account_id', '') is not null then
      select * into v_acc from public.accounts where id = (l->>'account_id')::uuid;
    elsif nullif(l->>'account_code', '') is not null then
      select * into v_acc from public.accounts where code = l->>'account_code';
    end if;
    if v_acc.id is null then
      raise exception 'السطر %: الحساب غير موجود', i;
    end if;
    if not v_acc.is_active then
      raise exception 'السطر %: الحساب % — % غير نشط', i, v_acc.code, v_acc.name;
    end if;

    insert into public.journal_lines (entry_id, account_id, debit, credit, line_note)
    values (v_entry, v_acc.id, v_d, v_c, nullif(btrim(coalesce(l->>'note', '')), ''));

    v_td := v_td + v_d;
    v_tc := v_tc + v_c;
    v_n  := v_n + 1;
  end loop;

  if v_td <> v_tc then
    raise exception 'القيد غير متوازن: المدين % والدائن %', v_td, v_tc;
  end if;

  return v_entry;
end;
$fn$;

comment on function public.post_manual_entry(date, text, text, jsonb, text) is
  'القيد اليدوي ذرّياً: يفحص الحساب والطرف والتوازن ويكتب الرأس والسطور معاً أو لا شيء (sql/111).';


create or replace function public.reverse_journal_entry(
  p_id     uuid,
  p_date   date default null,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  e       public.journal_entries%rowtype;
  v_entry uuid;
begin
  if not public.can_manage_finance() then
    raise exception 'عكس القيود للمدير أو المحاسب';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب العكس';
  end if;

  select * into e from public.journal_entries where id = p_id;
  if not found then raise exception 'القيد غير موجود'; end if;
  if e.source is not null then
    raise exception 'قيد آلي من % — يُعكس من مصدره لا من دفتر القيود', e.source;
  end if;
  if e.reversal_of is not null then
    raise exception 'هذا قيدٌ عاكس — لا يُعكس';
  end if;
  if exists (select 1 from public.journal_entries where reversal_of = p_id) then
    raise exception 'القيد معكوسٌ سلفاً';
  end if;

  insert into public.journal_entries
    (entry_date, description, reference, arm, source, created_by, reversal_of)
  values (coalesce(p_date, (now() at time zone 'Asia/Baghdad')::date),
          'عكس: ' || e.description || ' — ' || btrim(p_reason),
          'REV', e.arm, null, auth.uid(), p_id)
  returning id into v_entry;

  insert into public.journal_lines (entry_id, account_id, debit, credit, line_note)
  select v_entry, l.account_id, l.credit, l.debit, l.line_note
    from public.journal_lines l where l.entry_id = p_id;

  return v_entry;
end;
$fn$;

comment on function public.reverse_journal_entry(uuid, date, text) is
  'يعكس قيداً يدوياً بقيدٍ مقابل ويُبقي الأصل. القيد الآلي يُعكس من مصدره (sql/111).';

revoke execute on function public.post_manual_entry(date, text, text, jsonb, text) from public, anon;
revoke execute on function public.reverse_journal_entry(uuid, date, text)          from public, anon;
grant  execute on function public.post_manual_entry(date, text, text, jsonb, text) to authenticated;
grant  execute on function public.reverse_journal_entry(uuid, date, text)          to authenticated;

notify pgrst, 'reload schema';
