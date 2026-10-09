# دليل المطوّر — قسم التسويق

> المعمارية والقرارات في [MARKETING_ARCHITECTURE.md](MARKETING_ARCHITECTURE.md). هنا: أين كل شيء، وكيف يُضاف، وما لا يُكسر.

---

## ١. الخريطة

```
sql/
  121_marketing_core.sql        الفريق، الحرّاس، القنوات، الخطط، توسيع crm_campaigns، المحتوى، الأصول،
                                الإعلانات، المؤثرون، الميداني، المهامّ، الموافقات، الموردون، RLS، التدقيق
  122_marketing_finance.sql     الميزانيات، المصروفات ← cash_moves، المشتريات والمواد
  (123_end_service_date.sql     — ليست من القسم: HR)
  124_marketing_tracking.sql    الصفحات، الروابط و QR، النقرات، اللمسات، المقاييس، الإسناد، دوالّ anon
  125_marketing_analytics.sql   المؤشّرات والتفصيل والقمع والاتجاه والتنبؤ والجودة والبحث والتقويم
  126_marketing_automation.sql  الأتمتة، التكاملات و Vault، سجلّ المساعد، المهمّة المجدولة
  127_marketing_tests.sql       tests.run_marketing()

src/lib/
  marketing.ts            الوصول (للخادم) — نقلٌ بلا حساب
  marketing-style.ts      الثوابت (عميل وخادم) — مرايا قيود CHECK
  marketing-filters.ts    من الرابط إلى معاملات 125 (خالص، مختبَر)
  marketing-reports.ts    سجلّ التقارير الـ٢٦ — الشاشة والتصدير
  marketing-guard.ts      حارس الصفحة (عرض)
  marketing-ai-tools.ts   أدوات المساعد (قراءة فقط)
  metrics-csv.ts          قراءة CSV المقاييس (خالص، مختبَر)
  supabase/anon.ts        عميل الزائر لـ /r و /f
src/components/marketing/  record-form · rpc-form · actions · ui · table · charts · metric-entry · client-touchpoints
src/app/dashboard/marketing/…   ٣١ صفحة
src/app/r/[code]/route.ts       التتبّع
src/app/f/[slug]/               صفحة الهبوط
src/app/api/marketing/          export · copilot
supabase/functions/marketing-sync/   موصّل Meta
```

---

## ٢. التطبيق والتحقّق

```bash
# بالترتيب — كلٌّ آمن لإعادة التشغيل
sql/121 → 122 → (123 مستقلّة) → 124 → 125 → 126 → 127
```

ثم من محرّر SQL:

```sql
select * from tests.run_marketing();          -- كلها ok
select public.mkt_run_automation('يدوي');     -- خطأ صلاحية من المحرّر (لا auth.uid) — طبيعي
select count(*) from public.mkt_channels;     -- 30
select jobname, schedule from cron.job where jobname = 'mkt-automation-scan';
```

والواجهة **بعد** تطبيق الهجرات (قاعدة المشروع: لا نشر لواجهةٍ قبل هجرتها). الواجهة تتحمّل غياب الهجرات — تعرض «غير متاح» — لكن الكتابة تفشل.

**متغيّرات البيئة:**

| المتغيّر | أين | لماذا |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel (خادم) | المساعد. بدونه يقول «غير مفعّل» ولا يسقط شيء |
| `META_APP_SECRET`، `META_VERIFY_TOKEN` | أسرار دوالّ الحافة | ويبهوك ليدات ميتا (`meta-leads`) |
| (لا شيء للمجدول) | Vault: `mkt_cron_secret` (200) | المزامنة المجدولة — يولَّد في الهجرة. `MKT_CRON_SECRET` اختياري |

```bash
supabase functions deploy marketing-sync --no-verify-jwt
supabase functions deploy meta-leads --no-verify-jwt
supabase secrets set META_APP_SECRET=… META_VERIFY_TOKEN=…
```

---

## ٣. القواعد التي لا تُكسر

1. **لا قيد من React.** المال يمرّ بـ `mkt_pay_expense` ← `cash_moves` ← محفّز 018. لا حساب جديد.
2. **لا حساب في الواجهة.** رقمٌ جديد = عمودٌ في دالّة 125 (أو دالّة جديدة)، والواجهة تعرضه.
3. **الإيراد عمولة تلال.** `sale_commissions.company_amount`. قيمة البيع عمودٌ آخر باسمه.
4. **القسمة على صفر NULL.** «—» في الواجهة.
5. **الاعتماد بالدالّة.** حالةٌ معتمدة تُكتب فقط تحت العَلَم `tilal.mkt_approval` من `mkt_apply_approval_state`. لا تضف طريقاً ثانياً.
6. **المحفّز لا يُسقط كتابة أصلية.** محفّزات البوّابة (124) في كتلة `exception` تكتب إلى `mkt_event_errors`.
7. **دوالّ التحليل definer بفحصٍ داخلها** (`can_read_marketing_money()`) — لأن التسويق لا يقرأ `sale_commissions`. وتُرجع مجاميع لا أشخاص.
8. **الثوابت مرايا.** قائمة في `marketing-style.ts` = قيد CHECK. `marketing-style.test.ts` يقرأ SQL ويقارن.

---

## ٤. كيف أضيف…

### مقياساً إلى المؤشّرات
في `mkt_kpis` (125) أضف المفتاح إلى `jsonb_build_object` (السقف ١٠٠ معامل — اليوم ٧٨)، ثم الحقل في نوع `Kpis` (`marketing.ts`)، ثم العرض. وإن صار هدفاً: أضفه إلى قيد `metric_code` (121) وإلى `METRIC_LABELS` — الاختبار يمسك النسيان.

### بُعداً للتفصيل
في `mkt_breakdown` (125): القائمة المغلقة في أوّل الدالّة، ثم فرع `case p_dim` في كل CTE يحمله (كلفة، ليدات، بيعات، مقاييس)، ثم فرع التسمية. ثم `BREAKDOWN_DIMS` و`DIMS` في `marketing-ai-tools.ts`.

### نوعاً يُعتمد
- قيد `entity_type` في `mkt_approval_rules` و`mkt_approvals`.
- فرعٌ في `mkt_entity_info` (العنوان والمبلغ والرابط) و`mkt_apply_approval_state` (الحالات الثلاث).
- قواعد بذرة بعتباتها.
- حارسٌ على جدوله يرفض الحالة المعتمدة بلا العَلَم.

### قاعدة أتمتة
- قيمة في قيد `trigger_kind` (126) وصفّ بذرة.
- فرعٌ في `mkt_run_automation` يمرّ بـ `mkt_fire_alert` **بمفتاح عدم تكرار** يتضمّن ما يجعل الحدث جديداً (التاريخ، المستوى) — لا مفتاحاً يومياً لحدثٍ مستمرّ.

### موصّلاً لمنصّة
في `supabase/functions/marketing-sync/index.ts`: فرعٌ في `syncOne` لـ `provider`، يُنشئ `mkt_ad_objects` (upsert على `account_id,level,external_id`) ويرسل الصفوف إلى `mkt_import_metrics` بالمصدر «مزامنة». وعلِّم `ready: true` في `INTEGRATION_PROVIDERS`. الأخطاء الدائمة (رمز منتهٍ، صلاحية) `PermanentError` كي لا تُعاد.

### أداةً للمساعد
في `marketing-ai-tools.ts`: تعريفٌ في `AI_TOOLS` (اسم، وصفٌ يقول متى تُستعمل، مخطّط) وفرعٌ في `runAiTool` **يفحص كل معامل** (uuid، تاريخ، قائمة مغلقة) قبل النداء. قراءة فقط — لا أداة تكتب.

### جدولاً فيه `client_id`
اللمسات تتبع الدمج بمحفّز `merged_into` (124 `mkt_follow_merge`) لا بإضافتها إلى `merge_clients`. جدولٌ جديد بـ `client_id` يحتاج أحد الأمرين.

---

## ٥. الواجهة — المكوّنات

| المكوّن | الاستعمال |
|---|---|
| `RecordForm` | إدخال/تعديل صفّ بمواصفات حقول. `fixed` لقيمٍ مفروضة، `returnsId={false}` للجداول بمفتاح مركّب، `onSavedRedirectWithId` لفتح السجلّ بعد إنشائه. يعرض رسالة الحارس كما هي، ويقول «لم يُحفظ شيء» حين تمنع RLS صمتاً |
| `RpcForm` | نموذجٌ لدالّة — أسماء الحقول = معاملات `p_…` |
| `RpcButton` | زرّ دالّة، بتأكيد أو بسؤال نصٍّ (سبب الرفض) |
| `FieldSelect` · `ToggleField` | تغيير عمود واحد — الحالة غالباً، والحارس يحكم |
| `MktFilterBar` | المُرشِّحات الموحّدة (from/to/project/campaign/channel/model) — `<form method="get">` |
| `Tile` · `Card` · `Badge` · `SimpleTable` | العرض |
| `HBars` · `Columns` · `FunnelBars` | رسومٌ بسلسلة واحدة ولون واحد، تلميح مرور، بلا محورين |

الصفحة تبدأ بـ `requireMktRead()` (أو `requireMktMoney()` لشاشات المال التي يدخلها المحاسب).

---

## ٦. الاختبار

```bash
npm test                 # vitest — الخالص والمرايا
npx tsc --noEmit
npm run build
```

```sql
select * from tests.run_marketing();
```

`tests.run_marketing()` بنمط 115: معاملة فرعية تُلغى، تواريخ مال في فبراير ٢٠٢٠، أدوار مؤقّتة داخل المعاملة. أضف الاختبار قبل الاستثناء `RLBCK`. ولاختبار RLS: `set local role authenticated` ثم `reset role` — الدالّة `security invoker` لهذا.

**اختبر بغير المدير:** المدير يتجاوز RLS ويُخفي أخطاء الصلاحية والأداء (درس 096–102).

---

## ٧. ما بقي — بالأولوية

| البند | لماذا لم يُبنَ |
|---|---|
| موصّلات Google/TikTok/LinkedIn/YouTube/GA | لا حسابات ولا مفاتيح للاختبار؛ الإطار جاهز والـCSV يغطّي |
| ويبهوك ليدات Meta الفورية | يحتاج تطبيق Meta بمراجعة صلاحيات `leads_retrieval` |
| إرسال البريد/الرسائل/واتساب من القسم | لا مزوّد مختار؛ الأتمتة تُشعر داخلياً |
| السحب والإفلات في التقويم | تغيير موعد النشر يمرّ بحارس المحتوى — يبقى من صفحته |
| حماية الحافة للصفحتين العامّتين | Turnstile أو Vercel Firewall عند أول إساءة |
| عرضٌ مادّي للمقاييس | عند العتبة في MARKETING_ARCHITECTURE §١٢ |
| بيانات تجريبية | المشروع لا يستعمل بذوراً، والقاعدة واحدة هي الإنتاج — البيانات التجريبية تعيش داخل `tests.run_marketing()` وتُلغى |
