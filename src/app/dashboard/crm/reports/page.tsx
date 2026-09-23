import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { getMySupervisedProjects } from "@/lib/projects";
import {
  getCrmKpis,
  getFunnel,
  getSourcePerformance,
  getTeamPerformance,
  getLostAnalysis,
  getVelocity,
  getStageDurations,
  getAttribution,
  getSlaSummary,
  getCampaignPerformance,
  fmt,
} from "@/lib/crm";
import TrendStrip from "@/components/trend-strip";
import CrmFilterBar from "@/components/crm-filter-bar";
import { parseCrmFilters, type CrmSearchParams } from "@/lib/crm-filters";
import CrmTabs from "../crm-tabs";
import RunFollowupScan from "./run-scan";
import RefreshScores from "./refresh-scores";

// ============================================================
// «التقارير» — أُعيد بناؤها كاملةً على طبقة القاعدة (sql/076).
//
// ما تغيّر جوهرياً عن النسخة السابقة:
//
//   • لا حساب في الصفحة. كانت تجلب ٥٠٠٠ عميل وتحسب القمع والمصادر
//     والفريق في TypeScript (crm-reports.ts). الآن كل رقم يأتي من
//     دالة واحدة في القاعدة، فلا يمكن أن يتناقض تقريران.
//
//   • «معدّل الإغلاق» صار تعريفاً واحداً: فائزة ÷ (فائزة + خاسرة).
//     كان يُحسب في جدول المصادر على الإجمالي — فظهر «١٪» لمصدر
//     نصفُ ليداته ما زال مفتوحاً.
//
//   • أداء الفريق يعرض «ما أُعطي» قبل «ما أُنجز»، ومعه متوسط درجة
//     الليدات المستلَمة. من استلم ليدات ضعيفة لا يُقارَن بمن استلم
//     ساخنة — والجدول الذي يُخفي ذلك يكذب بالحذف.
//
//   • أقسام جديدة: لماذا نخسر، سرعة المبيعات، الزمن في المراحل،
//     الإسناد بأول لمسة وآخرها، وخروق مستوى الخدمة.
//
// المُرشِّح الزمني في العنوان (?days=30) ويسري على كل الأقسام معاً.
// ============================================================
export default async function CrmReportsPage({
  searchParams,
}: {
  searchParams: CrmSearchParams;
}) {
  const role = await getUserRole();
  const READERS = ["admin", "followup_manager", "supervisor", "marketing", "viewer"];
  if (!READERS.includes(role)) {
    redirect("/dashboard/clients");
  }

  // مفردات المُرشِّحات واحدة عبر اللوحات (§44) — تنتقل في الرابط
  const parsed = await parseCrmFilters(searchParams);
  const f = parsed.filters;
  const days = parsed.days ?? 30;

  const [kpis, funnel, sources, team, lost, velocity, durations, attribution, sla, campaigns] =
    await Promise.all([
      getCrmKpis(f),
      getFunnel(f),
      getSourcePerformance(f),
      getTeamPerformance(f),
      getLostAnalysis(f),
      getVelocity(f),
      getStageDurations(),
      getAttribution(),
      getSlaSummary(),
      getCampaignPerformance(f),
    ]);

  // المشرف يرى اتجاه فريق مشروعه لا الشركة (095). بقية الأقسام تحصرها
  // RLS في نطاقه أصلاً، أما الشريط فيقرأ لقطات — ولقطة الشركة ممنوعة عليه.
  let trendTeam: { id: string; name: string } | null = null;
  if (role === "supervisor") {
    const mine = await getMySupervisedProjects();
    trendTeam = mine.find((p) => p.id === f.teamId) ?? mine[0] ?? null;
  }

  const maxReached = Math.max(1, ...funnel.map((x) => Number(x.reached)));

  return (
    <div>
      <CrmTabs active="reports" />

      <div className="space-y-8 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">تقارير المبيعات</h1>
            <p className="mt-1 text-sm text-gray-500">
              تعريف واحد لكل رقم — محسوب في القاعدة لا في الصفحة.
            </p>
          </div>
          {role === "admin" && (
            <div className="flex items-center gap-2 text-sm">
              <RunFollowupScan />
              <RefreshScores />
            </div>
          )}
        </header>

        {/* شريط المُرشِّحات الموحّد — نفس المفردات في كل لوحة (§44) */}
        <CrmFilterBar basePath="/dashboard/crm/reports" parsed={parsed} />

        {/* ===== الاتجاه — الرقم مع مساره (§55) ===== */}
        {role !== "supervisor" ? (
          <TrendStrip days={Math.min(days, 90)} />
        ) : trendTeam ? (
          <TrendStrip days={Math.min(days, 90)} scope="فريق" scopeId={trendTeam.id} scopeName={trendTeam.name} />
        ) : null}

        {/* ===== المؤشّرات ===== */}
        {kpis && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="ليدات جديدة" value={fmt(kpis.leads)} />
            <Stat label="فرص" value={fmt(kpis.opportunities)} />
            <Stat label="فوز" value={fmt(kpis.won_count)} tone="brand" />
            <Stat label="خسارة" value={fmt(kpis.lost_count)} tone="red" />
            <Stat label="التحويل" value={`${kpis.conversion_rate}%`} />
            <Stat label="قيمة الفوز" value={fmt(kpis.won_value)} />
            <Stat label="الأنابيب" value={fmt(kpis.pipeline_value)} />
            <Stat label="الموزونة" value={fmt(kpis.weighted_pipeline)} />
            <Stat label="متوسط الصفقة" value={fmt(kpis.avg_deal_value)} />
            <Stat label="دورة البيع" value={`${kpis.avg_sales_cycle}ي`} sub={`وسيط ${kpis.median_sales_cycle}`} />
            <Stat label="تواصل" value={fmt(kpis.activities)} />
            <Stat label="ساخنة الآن" value={fmt(kpis.hot_count)} tone="brand" />
          </section>
        )}

        {/* ===== سرعة المبيعات ===== */}
        {velocity && (
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="font-bold text-gray-800">سرعة المبيعات</h2>
            <p className="text-xs text-gray-500">
              الفرص المفتوحة × متوسط الصفقة × معدّل الفوز ÷ طول الدورة = قيمة متوقّعة في اليوم
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="فرص مفتوحة" value={fmt(velocity.qualified_opps)} />
              <Stat label="معدّل الفوز" value={`${velocity.win_rate}%`} />
              <Stat label="طول الدورة" value={`${velocity.avg_cycle_days}ي`} />
              <Stat label="شهرياً" value={fmt(velocity.velocity_per_month)} tone="brand" sub={`${fmt(velocity.velocity_per_week)} أسبوعياً`} />
            </div>
            {Number(velocity.avg_cycle_days) === 0 && (
              <p className="mt-2 text-xs text-gray-400">صفرٌ لأن لا دورة مكتملة بعد في المدة — جوابٌ صادق لا عطل.</p>
            )}
          </section>
        )}

        {/* ===== القمع + الزمن في المراحل ===== */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="font-bold text-gray-800">قمع المبيعات</h2>
            <ul className="mt-4 space-y-3">
              {funnel.map((s) => (
                <li key={s.stage_name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700">{s.stage_name}</span>
                    <span className="text-gray-500">
                      {s.reached} · {s.reached_pct}%
                      {s.step_conversion !== null && <span className="ms-2 text-gray-400">↓ {s.step_conversion}%</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-gray-100">
                    <div className="h-2 rounded bg-brand-500" style={{ width: `${(Number(s.reached) / maxReached) * 100}%` }} />
                  </div>
                </li>
              ))}
              {funnel.length === 0 && <Empty />}
            </ul>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="font-bold text-gray-800">الزمن في كل مرحلة</h2>
            <p className="text-xs text-gray-500">أين يعلق الخطّ — مرتّب بالأطول</p>
            <table className="mt-3 w-full text-right text-sm">
              <thead className="text-xs text-gray-500">
                <tr><th className="py-2">المرحلة</th><th>انتقالات</th><th>متوسط</th><th>وسيط</th><th>P90</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {durations.map((d) => (
                  <tr key={d.stage_name}>
                    <td className="py-2 font-medium text-gray-700">{d.stage_name}</td>
                    <td className="text-gray-500">{d.transitions}</td>
                    <td className="text-gray-800">{d.avg_days}ي</td>
                    <td className="text-gray-800">{d.median_days}ي</td>
                    <td className={Number(d.p90_days) > 30 ? "text-red-600" : "text-gray-500"}>{d.p90_days}ي</td>
                  </tr>
                ))}
                {durations.length === 0 && <tr><td colSpan={5}><Empty /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== أداء الفريق ===== */}
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-bold text-gray-800">أداء الفريق</h2>
            <p className="text-xs text-gray-500">ما أُعطي ← ما عُمل ← النتيجة. لا يُقرأ الثالث بلا الأول.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">استلم</th>
                  <th className="px-4 py-3 font-medium">متوسط الدرجة</th>
                  <th className="px-4 py-3 font-medium">عمل عليها</th>
                  <th className="px-4 py-3 font-medium">لم يُشتغَل</th>
                  <th className="px-4 py-3 font-medium">تواصل</th>
                  <th className="px-4 py-3 font-medium">فرص</th>
                  <th className="px-4 py-3 font-medium">فوز</th>
                  <th className="px-4 py-3 font-medium">خسارة</th>
                  <th className="px-4 py-3 font-medium">التحويل</th>
                  <th className="px-4 py-3 font-medium">القيمة</th>
                  <th className="px-4 py-3 font-medium">متأخر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {team.map((r) => (
                  <tr key={r.owner_id}>
                    <td className="px-4 py-2 font-medium text-gray-800">{r.owner_name}</td>
                    <td className="px-4 py-2 text-gray-600">{r.leads_received}</td>
                    <td className="px-4 py-2 text-gray-500">{r.avg_lead_score}</td>
                    <td className="px-4 py-2 text-gray-600">{r.leads_worked} <span className="text-xs text-gray-400">({r.contact_rate}%)</span></td>
                    <td className={`px-4 py-2 ${Number(r.unworked) > 0 ? "text-amber-700" : "text-gray-400"}`}>{r.unworked || "—"}</td>
                    <td className="px-4 py-2 text-gray-600">{r.activities}</td>
                    <td className="px-4 py-2 text-gray-600">{r.opportunities}</td>
                    <td className="px-4 py-2 font-semibold text-brand-600">{r.won}</td>
                    <td className="px-4 py-2 text-red-600">{r.lost || "—"}</td>
                    <td className="px-4 py-2 text-gray-800">{r.conversion_rate}%</td>
                    <td className="px-4 py-2 text-gray-800">{fmt(r.won_value)}</td>
                    <td className={`px-4 py-2 ${Number(r.overdue) > 0 ? "text-red-600" : "text-gray-400"}`}>{r.overdue || "—"}</td>
                  </tr>
                ))}
                {team.length === 0 && <tr><td colSpan={12}><Empty /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== المصادر + الإسناد ===== */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="font-bold text-gray-800">مصادر العملاء</h2>
              <p className="text-xs text-gray-500">مرتّبة بالمبيعات لا بعدد الليدات — العمود الأخير يُموَّل.</p>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">المصدر</th>
                  <th className="px-4 py-2 font-medium">ليدات</th>
                  <th className="px-4 py-2 font-medium">مؤهَّل</th>
                  <th className="px-4 py-2 font-medium">فوز</th>
                  <th className="px-4 py-2 font-medium">التحويل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sources.map((s) => (
                  <tr key={s.source_name}>
                    <td className="px-4 py-2 font-medium text-gray-700">{s.source_name}</td>
                    <td className="px-4 py-2 text-gray-600">{s.leads}</td>
                    <td className="px-4 py-2 text-gray-600">{s.qualified}</td>
                    <td className="px-4 py-2 font-semibold text-brand-600">{s.won}</td>
                    <td className="px-4 py-2 text-gray-800">{s.conversion_rate}%</td>
                  </tr>
                ))}
                {sources.length === 0 && <tr><td colSpan={5}><Empty /></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="font-bold text-gray-800">أول لمسة مقابل آخرها</h2>
              <p className="text-xs text-gray-500">قناةٌ أولُها كبير وآخرها صغير تبني الطلب ولا تُغلقه.</p>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">المصدر</th>
                  <th className="px-4 py-2 font-medium">أول لمسة</th>
                  <th className="px-4 py-2 font-medium">آخر لمسة</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attribution.map((a) => (
                  <tr key={a.source_name}>
                    <td className="px-4 py-2 font-medium text-gray-700">{a.source_name}</td>
                    <td className="px-4 py-2 text-gray-600">{a.first_touch_leads} <span className="text-xs text-brand-600">({a.first_touch_won} فوز)</span></td>
                    <td className="px-4 py-2 text-gray-600">{a.last_touch_leads} <span className="text-xs text-brand-600">({a.last_touch_won} فوز)</span></td>
                    <td className="px-4 py-2 text-xs text-amber-700">{a.builds_demand ? "يبني الطلب" : ""}</td>
                  </tr>
                ))}
                {attribution.length === 0 && <tr><td colSpan={4}><Empty /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== لماذا نخسر + مستوى الخدمة ===== */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white" id="lost">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="font-bold text-gray-800">لماذا نخسر</h2>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">السبب</th>
                  <th className="px-4 py-2 font-medium">عدد</th>
                  <th className="px-4 py-2 font-medium">حصّة</th>
                  <th className="px-4 py-2 font-medium">قيمة</th>
                  <th className="px-4 py-2 font-medium">أبعد مرحلة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lost.map((l) => (
                  <tr key={l.lost_reason}>
                    <td className="px-4 py-2 font-medium text-gray-700">
                      {l.lost_reason}
                      <span className="ms-1 text-xs text-gray-400">{l.category}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{l.lost_count}</td>
                    <td className="px-4 py-2 text-gray-600">{l.share_pct}%</td>
                    <td className="px-4 py-2 text-gray-600">{fmt(l.lost_value)}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{l.avg_stage_reached ?? "—"}</td>
                  </tr>
                ))}
                {lost.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">لا خسائر في المدة — أو بلا سبب مسجَّل.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white" id="sla">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="font-bold text-gray-800">مستوى الخدمة</h2>
              <p className="text-xs text-gray-500">الخرق واقعة تُسجَّل وتُغلَق — لا رسالة تُنسى.</p>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">القاعدة</th>
                  <th className="px-4 py-2 font-medium">خروق</th>
                  <th className="px-4 py-2 font-medium">مفتوح</th>
                  <th className="px-4 py-2 font-medium">للمشرف</th>
                  <th className="px-4 py-2 font-medium">للإدارة</th>
                  <th className="px-4 py-2 font-medium">زمن المعالجة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sla.map((s) => (
                  <tr key={s.rule_code}>
                    <td className="px-4 py-2 font-medium text-gray-700">{s.rule_label}</td>
                    <td className="px-4 py-2 text-gray-600">{s.breaches}</td>
                    <td className={`px-4 py-2 ${Number(s.still_open) > 0 ? "font-semibold text-red-600" : "text-gray-400"}`}>{s.still_open}</td>
                    <td className="px-4 py-2 text-gray-600">{s.escalated_l2}</td>
                    <td className="px-4 py-2 text-gray-600">{s.escalated_l3}</td>
                    <td className="px-4 py-2 text-gray-500">{s.avg_resolution_hours !== null ? `${s.avg_resolution_hours} ساعة` : "—"}</td>
                  </tr>
                ))}
                {sla.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">لا خروق مسجَّلة.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== الحملات — الكلفة والعائد لا الليدات وحدها (§29) ===== */}
        {campaigns.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white" id="campaigns">
            <div className="border-b px-5 py-4">
              <h2 className="font-bold text-gray-800">الحملات</h2>
              <p className="text-xs text-gray-500">
                كلفة الليد وكلفة المؤهَّل وكلفة الاستحواذ — تُحسب من المصروف المسجَّل على الحملة، والإيراد عمولة تلال لا ثمن الوحدة.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">الحملة</th>
                    <th className="px-4 py-3 font-medium">الوسيط</th>
                    <th className="px-4 py-3 font-medium">المصروف</th>
                    <th className="px-4 py-3 font-medium">ليدات</th>
                    <th className="px-4 py-3 font-medium">مؤهَّل</th>
                    <th className="px-4 py-3 font-medium">فرص</th>
                    <th className="px-4 py-3 font-medium">فوز</th>
                    <th className="px-4 py-3 font-medium">كلفة الليد</th>
                    <th className="px-4 py-3 font-medium">الاستحواذ</th>
                    <th className="px-4 py-3 font-medium">العائد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {campaigns.map((c) => (
                    <tr key={c.campaign_id}>
                      <td className="px-4 py-2 font-medium text-gray-800">{c.campaign_name}</td>
                      <td className="px-4 py-2 text-gray-500">{c.medium ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">{fmt(c.spent)}{c.budget ? <span className="text-xs text-gray-400"> / {fmt(c.budget)}</span> : null}</td>
                      <td className="px-4 py-2">{fmt(c.leads)}</td>
                      <td className="px-4 py-2">{fmt(c.qualified)}</td>
                      <td className="px-4 py-2">{fmt(c.opportunities)}</td>
                      <td className="px-4 py-2 font-semibold text-brand-700">{fmt(c.won)}</td>
                      <td className="px-4 py-2 text-gray-600">{fmt(c.cost_per_lead)}</td>
                      <td className="px-4 py-2 text-gray-600">{fmt(c.cac)}</td>
                      <td className={`px-4 py-2 font-semibold ${c.roi_pct === null ? "text-gray-400" : Number(c.roi_pct) >= 0 ? "text-brand-700" : "text-red-600"}`}>
                        {c.roi_pct === null ? "—" : `${c.roi_pct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="text-xs text-gray-500">
          التنبيهات تُفحص تلقائياً كل يوم ٩ صباحاً بتوقيت بغداد، ومستوى الخدمة ٨ صباحاً، والدرجات ٦ صباحاً، واللقطة اليومية ١١ مساءً.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "brand" | "red" }) {
  const v = tone === "brand" ? "text-brand-700" : tone === "red" ? "text-red-700" : "text-gray-800";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className={`text-lg font-bold ${v}`}>{value}</p>
      <p className="text-xs text-gray-600">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Empty() {
  return <p className="px-4 py-6 text-center text-sm text-gray-400">لا بيانات — أو الهجرات لم تُشغَّل.</p>;
}
