-- ============================================================
-- تلال ERP — 219c: إكمال تصحيح 219 — الفشل الثاني لـ«ذو الفقار نوري»
-- انسخه والصقه في SQL Editor ← Run
--
-- 219 غيّرت owner_name إلى آية لكن stamp_lost_sale أعاد owner_id
-- لنرمين (يجمّد أبعاد يوم الخسارة). ويوم تلك الخسارة كانت الفرصة
-- لآية، فنتخطّى المحفّز لهذا الصفّ وحده. آمن لإعادة التشغيل.
-- ============================================================
alter table public.crm_lost_sales disable trigger trg_stamp_lost_sale;

update public.crm_lost_sales
   set owner_id = (select id from public.employees where full_name = 'اية عبدالحسين'),
       owner_name = 'اية عبدالحسين',
       updated_at = now()
 where id = '7a0c2eb3-7dd0-486d-a6f3-50fe4bc02142'
   and owner_id is distinct from (select id from public.employees where full_name = 'اية عبدالحسين');

alter table public.crm_lost_sales enable trigger trg_stamp_lost_sale;
