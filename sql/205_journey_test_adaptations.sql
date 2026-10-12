-- ============================================================
-- تلال ERP — 205: تكييف اختبارين قديمين مع رحلة العميل (اختبارات فقط)
--
-- لا يمسّ بيانات ولا منطق أعمال — دوال tests.* وحدها.
--
-- 1) tests.run_reporting
--    أ) كان يُدخل صفّ «دخول أول» يدوياً للفرصة؛ والمسار صار يولد به
--       (201 — journey_created) فصار الدخول مكرّراً: initial,initial,…
--       يكتب الاختبار الانتقالين وحدهما الآن.
--    ب) عطلٌ أقدم من 201: ينقل الفرصة إلى الخسارة بتحديث مباشر، وهذا ممنوع
--       منذ 140 إلا بنموذج التحليل (require_lost_analysis). يرفع الاختبار
--       علَم النموذج tilal.lost_analysis كما تفعل close_opportunity_lost.
-- 2) tests.run_lost_card_sync
--    المساران يُنشآن في المعاملة نفسها فوقت إنشائهما واحد، و«الأحدث» يُحسم
--    بالمعرّف عشوائياً. المسار الثاني يُنشأ بعد الأول بثانية.
--
-- ⚠️ \r يُنزع من الطرفين (نصّ الموضع ونصّ الدالة) قبل المقارنة: الملف يصل
--    المحرّر بنهايات ويندوز (CRLF) أحياناً، والدوال في القاعدة بأيّهما.
-- ============================================================

do $p$
declare
  d  text;
  d2 text;
  a1 text := replace($a$    values (o1, null,    g_lead,  null,   'ليد',   (d1::text || ' 09:00' || bgd)::timestamptz),
           (o1, g_lead,  g_visit, 'ليد',  'زيارة', (d3::text || ' 10:00' || bgd)::timestamptz),$a$, E'\r', '');
  b1 text := replace($b$    values (o1, g_lead,  g_visit, 'ليد',  'زيارة', (d3::text || ' 10:00' || bgd)::timestamptz),$b$, E'\r', '');
  a2 text := replace($a$    update public.opportunities
       set stage_id = g_lost,$a$, E'\r', '');
  b2 text := replace($b$    perform set_config('tilal.lost_analysis', o1::text, true);
    update public.opportunities
       set stage_id = g_lost,$b$, E'\r', '');
  a3 text := replace($a$    insert into public.opportunities (client_id, stage_id, owner_id, project_id)
    values (cli2, g_neg, plain_emp, proj) returning id into opp2;$a$, E'\r', '');
  b3 text := replace($b$    insert into public.opportunities (client_id, stage_id, owner_id, project_id, created_at)
    values (cli2, g_neg, plain_emp, proj, now() + interval '1 second') returning id into opp2;$b$, E'\r', '');
begin
  d := replace(pg_get_functiondef('tests.run_reporting()'::regprocedure), E'\r', '');
  if position('tilal.lost_analysis' in d) = 0 then
    if position(a1 in d) = 0 or position(a2 in d) = 0 then
      raise exception '205: لم يُعثر على مواضع الترقيع في tests.run_reporting';
    end if;
    d2 := replace(replace(d, a1, b1), a2, b2);
    execute d2;
  end if;

  d := replace(pg_get_functiondef('tests.run_lost_card_sync()'::regprocedure), E'\r', '');
  if position($q$now() + interval '1 second'$q$ in d) = 0 then
    if position(a3 in d) = 0 then
      raise exception '205: لم يُعثر على موضع الترقيع في tests.run_lost_card_sync';
    end if;
    execute replace(d, a3, b3);
  end if;
end $p$;

do $$ begin raise notice '205: شغّل select * from tests.run_reporting(); و select * from tests.run_lost_card_sync();'; end $$;
