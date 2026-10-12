-- ============================================================
-- تلال ERP — الرجوع عن 201–203 (رحلة العميل)
--
-- غير مرقَّم عمداً: لا يُشغَّل ضمن التسلسل. يُشغَّل يدوياً فقط إن تقرّر
-- الرجوع، وبعده تُعاد الواجهة إلى ما قبل الالتزام نفسه.
--
-- لا يحذف بيانات: الأعمدة الجديدة وصفوف «الدخول الأول» والمقاييس الجديدة
-- تبقى بلا ضرر (لا يقرؤها الكود القديم). المراحل الجديدة تُوقف لا تُحذف —
-- أي مسار نُقل إليها يبقى ظاهراً في تاريخه.
--
-- ⚠️ قبل التشغيل: لا يجوز أن يكون مسارٌ في «حجز» أو «غير مؤهّل» أو
--    «تعذّر الوصول» — البطاقة القديمة لا تعرفها. الفحص في (أ) يوقف الرجوع.
-- ============================================================

-- (أ) الحارس: لا رجوع والمسارات في المراحل الجديدة
do $$
declare n int;
begin
  select count(*) into n
    from public.opportunities o join public.crm_stages g on g.id = o.stage_id
   where o.deleted_at is null and g.name in ('حجز', 'غير مؤهّل', 'تعذّر الوصول');
  if n > 0 then
    raise exception 'الرجوع متوقّف: % مساراً في المراحل الجديدة — انقلها أولاً إلى مراحل 070.', n;
  end if;
end $$;

-- (ب) الحارس الجديد والمحفّزات الجديدة
drop trigger if exists trg_a0_guard_client_journey on public.clients;
drop trigger if exists trg_journey_created         on public.opportunities;
drop trigger if exists trg_journey_resync          on public.opportunities;
drop trigger if exists trg_journey_resync_del      on public.opportunities;

-- (ج) المحفّزات القديمة كما كانت (الدوال لم تُحذف في 201)
drop trigger if exists trg_mirror_client_stage on public.clients;
create trigger trg_mirror_client_stage
  after update of stage on public.clients
  for each row execute function public.mirror_client_stage_to_opportunity();

drop trigger if exists trg_client_stage_log on public.clients;
create trigger trg_client_stage_log
  after update of stage on public.clients
  for each row execute function public.log_client_stage_change();

drop trigger if exists trg_guard_client_lost_stage on public.clients;
create trigger trg_guard_client_lost_stage
  before update of stage on public.clients
  for each row execute function public.guard_client_lost_stage();

drop trigger if exists trg_close_client_on_sale on public.reservations;
create trigger trg_close_client_on_sale
  after insert or update of status on public.reservations
  for each row execute function public.close_client_stage_on_sale();

-- (د) المراحل الجديدة تُوقف، والترتيب القديم يعود
update public.crm_stages set is_active = false where name in ('حجز', 'غير مؤهّل', 'تعذّر الوصول');
update public.crm_stages set sort_order = 5 where name = 'بيع';
update public.crm_stages set sort_order = 6 where name = 'فشل البيع';

-- (هـ) bulk_set_stage بتوقيعه القديم (2 معاملات) — الواجهة القديمة تناديه هكذا.
--      ⚠️ النسخة القديمة كانت definer بلا فحص صلاحية؛ هذه تفحص الرؤية.
drop function if exists public.bulk_set_stage(uuid[], text, text);
create or replace function public.bulk_set_stage(p_client_ids uuid[], p_stage text)
returns table(succeeded integer, failed integer, first_error text)
language plpgsql security definer set search_path = public as $$
declare cid uuid; n_ok int := 0; n_bad int := 0; err text;
begin
  if array_length(p_client_ids, 1) > 500 then raise exception 'الحدّ ٥٠٠ صفّ في الدفعة الواحدة.'; end if;
  foreach cid in array p_client_ids loop
    begin
      if not public.crm_can_move_client(cid) then raise exception 'لا تملك هذا العميل.'; end if;
      update public.clients set stage = p_stage where id = cid and stage is distinct from p_stage;
      if found then n_ok := n_ok + 1; else n_bad := n_bad + 1; end if;
    exception when others then
      n_bad := n_bad + 1;
      if err is null then err := sqlerrm; end if;
    end;
  end loop;
  return query select n_ok, n_bad, err;
end $$;
revoke all on function public.bulk_set_stage(uuid[], text) from public, anon;
grant execute on function public.bulk_set_stage(uuid[], text) to authenticated;

-- (و) after_opportunity_stage_change / link_reservation_opportunity /
--     sync_opportunity_from_reservation / guard_opportunity_stage: نسخها
--     الجديدة متوافقة مع المحفّزات القديمة (تكتب السجلّ وتُزامن البطاقة)،
--     فتُترك. ومن أراد النسخ القديمة حرفياً: sql/072 و072b و140.

do $$ begin raise notice 'رجوع 201: تمّ. أعِد الواجهة إلى ما قبل التزام 201.'; end $$;
