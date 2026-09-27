import Link from "next/link";
import {
  type EngineRow, type MetricDef, compareValues, fmtDelta, fmtMetric, fmtNum, valueOf, dimKey,
} from "@/lib/report-engine";
import { bucketLabel, shortDate } from "@/lib/report-dates";
import {
  DIM_LABELS, dimValueLabel, type DimLabels, type GeneratedReport, type SectionResult,
} from "@/lib/crm-reporting";
import { toQuery, queryString, type ReportParams } from "@/lib/report-filters";
import TrendCharts from "./trend-charts";

// ============================================================
// عرض أقسام التقرير — كل رقم رابطٌ إلى الصفوف التي صنعته (§38 · §50).
//
// الرابط يحمل مُرشِّحات التقرير كما هي + المقياس + قيم أبعاد الخلية،
// فينزل crm_report_drill بنفس شرط المقياس ونفس النطاق — فعدد الصفوف
// هناك هو الرقم هنا، لا تقريبه.
// ============================================================

type Ctx = {
  params: ReportParams;
  labels: DimLabels;
  templateCode: string | null;
  today: string;
  print?: boolean;
};

export function drillHref(ctx: Ctx, metric: string, dims: Record<string, string | null> = {}, state?: "current" | "snapshot"): string {
  const q: Record<string, string> = { ...toQuery(ctx.params), metric };
  if (Object.keys(dims).length) q.cell = JSON.stringify(dims);
  if (state) q.state = state;
  if (ctx.templateCode) q.template = ctx.templateCode;
  return `/dashboard/crm/reports/drill${queryString(q)}`;
}

function stateFor(ctx: Ctx): "current" | "snapshot" {
  return ctx.params.range.to >= ctx.today ? "current" : "snapshot";
}

export default function ReportSections({ report, today, print }: { report: GeneratedReport; today: string; print?: boolean }) {
  const ctx: Ctx = { params: report.params, labels: report.labels, templateCode: report.template.code, today, print };
  return (
    <div className="space-y-6">
      {report.sections.map((s) => (
        <section key={s.def.key} className="break-inside-avoid rounded-lg border border-gray-200 bg-white" id={s.def.key}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-3">
            <h2 className="font-bold text-gray-800">{s.def.title}</h2>
            <SectionNote s={s} ctx={ctx} />
          </header>
          <div className="p-4">
            {s.error ? (
              <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                تعذّر حساب هذا القسم — لا يُعرض رقمٌ بدلاً منه: {s.error}
              </p>
            ) : (
              <SectionBody s={s} ctx={ctx} />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function SectionNote({ s, ctx }: { s: SectionResult; ctx: Ctx }) {
  if (s.type === "kpis" && s.stateAt) return <span className="text-xs text-gray-500">الحالة: {s.stateAt}</span>;
  if (s.type === "movement") return <span className="text-xs text-gray-500">الافتتاح: لقطة {s.openingDate} · الإقفال: {s.closingAt}</span>;
  if (s.type === "trend" && s.metrics.some((m) => m.source === "state")) return <span className="text-xs text-gray-500">من اللقطات اليومية — اليوم الجاري بلا لقطة بعد</span>;
  if ((s.type === "table" || s.type === "kpis") && ctx.params.compareRange) return <span className="text-xs text-gray-500">مقارنةً بـ {ctx.params.compareRange.from} ← {ctx.params.compareRange.to}</span>;
  return null;
}

function SectionBody({ s, ctx }: { s: SectionResult; ctx: Ctx }) {
  switch (s.type) {
    case "kpis": return <KpiGrid metrics={s.metrics} current={s.current} previous={s.previous} ctx={ctx} />;
    case "trend": return (
      <TrendCharts
        grain={s.grain}
        series={s.metrics.map((m) => ({
          code: m.code, name: m.name_ar, unit: m.unit,
          points: s.rows.map((r) => ({ key: r.dims[s.grain] ?? "", label: bucketLabel(s.grain, r.dims[s.grain] ?? ""), value: valueOf(r, m) })),
        }))}
        print={ctx.print}
      />
    );
    case "table": return <ReportTable s={s} ctx={ctx} />;
    case "matrix": return <MatrixTable s={s} ctx={ctx} />;
    case "funnel": return <FunnelView s={s} ctx={ctx} />;
    case "movement": return <MovementView s={s} />;
    case "insights": return <InsightsList s={s} />;
    case "campaign_costs": return <CampaignCosts s={s} />;
  }
}

// ===== المؤشّرات مع المقارنة (§23) =====
export function KpiGrid({ metrics, current, previous, ctx }: {
  metrics: MetricDef[]; current?: EngineRow; previous?: EngineRow; ctx: Ctx;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {metrics.map((m) => {
        const v = valueOf(current, m);
        const d = previous ? compareValues(v, valueOf(previous, m), m.good_direction) : null;
        const tone = d?.tone === "good" ? "text-brand-700" : d?.tone === "bad" ? "text-red-700" : "text-gray-500";
        return (
          <Link key={m.code} href={drillHref(ctx, m.code, {}, m.source === "state" ? stateFor(ctx) : undefined)}
                title={`${m.definition}\n${m.formula}`}
                className="group rounded-lg border border-gray-200 p-3 transition hover:border-brand-600">
            <p className="text-xs text-gray-600">{m.name_ar}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{fmtMetric(v, m.unit)}</p>
            {d && d.previous !== null && (
              <p className={`mt-0.5 text-xs tabular-nums ${tone}`} dir="ltr">
                {d.change === 0 ? "=" : fmtDelta(d, m.unit)}
                <span className="ms-1 text-gray-400">({fmtMetric(d.previous, m.unit)})</span>
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ===== الجدول =====
function ReportTable({ s, ctx }: { s: Extract<SectionResult, { type: "table" }>; ctx: Ctx }) {
  if (s.rows.length === 0) return <Empty />;
  const state = s.metrics.some((m) => m.source === "state") ? stateFor(ctx) : undefined;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            {s.dims.map((d) => <th key={d} className="px-3 py-2 font-medium">{DIM_LABELS[d] ?? d}</th>)}
            {s.metrics.map((m) => <th key={m.code} className="px-3 py-2 font-medium" title={m.definition}>{m.name_ar}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {s.rows.map((r) => (
            <tr key={dimKey(r.dims, s.dims)} className="hover:bg-gray-50">
              {s.dims.map((d) => (
                <td key={d} className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">
                  {d === "day" || d === "week" || d === "month" ? bucketLabel(d, r.dims[d] ?? "") : dimValueLabel(d, r.dims[d], ctx.labels)}
                </td>
              ))}
              {s.metrics.map((m) => {
                const v = valueOf(r, m);
                return (
                  <td key={m.code} className="px-3 py-2 tabular-nums text-gray-700">
                    {v === 0 || v === null ? <span className="text-gray-300">{fmtMetric(v, m.unit)}</span> : (
                      <Link href={drillHref(ctx, m.code, pick(r.dims, s.dims), m.source === "state" ? state : undefined)} className="hover:text-brand-700 hover:underline">
                        {fmtMetric(v, m.unit)}
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {s.total && (
          <tfoot className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold">
            <tr>
              <td colSpan={s.dims.length} className="px-3 py-2 text-gray-700">المجموع</td>
              {s.metrics.map((m) => <td key={m.code} className="px-3 py-2 tabular-nums">{fmtMetric(valueOf(s.total, m), m.unit)}</td>)}
            </tr>
            {s.previousTotal && (
              <tr className="text-xs font-normal text-gray-500">
                <td colSpan={s.dims.length} className="px-3 py-1">الفترة السابقة</td>
                {s.metrics.map((m) => {
                  const d = compareValues(valueOf(s.total, m), valueOf(s.previousTotal, m), m.good_direction);
                  return (
                    <td key={m.code} className={`px-3 py-1 tabular-nums ${d.tone === "good" ? "text-brand-700" : d.tone === "bad" ? "text-red-700" : ""}`} dir="ltr">
                      {fmtMetric(d.previous, m.unit)} {d.change ? `· ${fmtDelta(d, m.unit)}` : ""}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function pick(dims: Record<string, string | null>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, dims[k] ?? null]));
}

// ===== المصفوفة (§26 · §33) — تدرّج لون واحد بالقيمة =====
const HEAT = ["", "bg-brand-50", "bg-brand-100", "bg-brand-200", "bg-brand-300", "bg-brand-600 text-white"];

function heat(v: number | null, max: number): string {
  if (!v || max <= 0) return "";
  const r = v / max;
  return HEAT[r > 0.85 ? 5 : r > 0.6 ? 4 : r > 0.35 ? 3 : r > 0.15 ? 2 : 1];
}

function MatrixTable({ s, ctx }: { s: Extract<SectionResult, { type: "matrix" }>; ctx: Ctx }) {
  const { matrix: mx, rowDim, colDim, metric } = s;
  if (mx.rowKeys.length === 0) return <Empty />;
  const isTime = colDim === "day" || colDim === "week" || colDim === "month";
  const colLabel = (c: string) => isTime ? (colDim === "day" ? shortDate(c) : bucketLabel(colDim as "week" | "month", c)) : dimValueLabel(colDim, c === "∅" ? null : c, ctx.labels);
  const state = metric.source === "state" ? stateFor(ctx) : undefined;
  const cols = mx.colKeys.length || 1;
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-gray-500">{metric.name_ar} · {DIM_LABELS[rowDim]} × {DIM_LABELS[colDim]} — الأغمق أعلى. المجاميع من المحرّك لا من جمع الخلايا.</p>
      <table className="w-full border-separate border-spacing-0.5 text-center text-xs">
        <thead className="text-gray-500">
          <tr>
            <th className="sticky start-0 bg-white px-2 py-1 text-right font-medium">{DIM_LABELS[rowDim]}</th>
            {mx.colKeys.map((c) => <th key={c} className="whitespace-nowrap px-1.5 py-1 font-medium">{colLabel(c)}</th>)}
            <th className="px-2 py-1 font-semibold text-gray-700">المجموع</th>
            {isTime && <th className="px-2 py-1 font-medium">المتوسط</th>}
          </tr>
        </thead>
        <tbody>
          {mx.rowKeys.map((rk) => {
            const tot = mx.rowTotals.get(rk) ?? null;
            return (
              <tr key={rk}>
                <td className="sticky start-0 whitespace-nowrap bg-white px-2 py-1 text-right font-medium text-gray-800">
                  {dimValueLabel(rowDim, rk === "∅" ? null : rk, ctx.labels)}
                </td>
                {mx.colKeys.map((ck) => {
                  const v = mx.cells.get(`${rk}¦${ck}`) ?? null;
                  return (
                    <td key={ck} className={`rounded px-1.5 py-1 tabular-nums ${heat(v, mx.max)} ${v ? "" : "text-gray-300"}`}>
                      {v ? (
                        <Link href={drillHref(ctx, metric.code, { [rowDim]: rk === "∅" ? null : rk, [colDim]: ck === "∅" ? null : ck }, state)} className="block">
                          {fmtNum(v)}
                        </Link>
                      ) : "0"}
                    </td>
                  );
                })}
                <td className="px-2 py-1 font-semibold tabular-nums text-gray-900">{fmtMetric(tot, metric.unit)}</td>
                {isTime && <td className="px-2 py-1 tabular-nums text-gray-500">{tot !== null ? fmtNum(tot / cols, 1) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="sticky start-0 bg-white px-2 py-1 text-right text-gray-700">المجموع</td>
            {mx.colKeys.map((ck) => <td key={ck} className="px-1.5 py-1 tabular-nums text-gray-700">{fmtNum(mx.colTotals.get(ck) ?? 0)}</td>)}
            <td className="px-2 py-1 tabular-nums text-gray-900">{fmtMetric(mx.grand, metric.unit)}</td>
            {isTime && <td className="px-2 py-1 tabular-nums text-gray-500">{mx.grand !== null ? fmtNum(mx.grand / cols, 1) : "—"}</td>}
          </tr>
        </tfoot>
      </table>
      {isTime && <p className="mt-2 text-xs text-gray-400">الأهداف والإنجاز الشهري في «التنبؤ والأهداف» — الهدف يوضع للشهر لا لليوم (078).</p>}
    </div>
  );
}

// ===== القمع (§28) =====
function FunnelView({ s, ctx }: { s: Extract<SectionResult, { type: "funnel" }>; ctx: Ctx }) {
  const first = s.steps[0]?.value ?? 0;
  if (first === 0) return <Empty />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {ctx.params.basis === "lead_created"
          ? "ليدات المدة وإلى أين وصلت (بأيّ وقت). التحويل من الخطوة السابقة، والتسرّب ما سقط بينهما."
          : "ما حدث في المدة من كل خطوة — ليس بالضرورة للّيدات نفسها. للقمع الصارم اختر «حسب تاريخ إنشاء الليد»."}
      </p>
      {s.steps.map((st, i) => {
        const m = s.metrics[i];
        const prev = s.previous?.[i];
        const w = Math.max(2, (st.value / first) * 100);
        return (
          <div key={st.code}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <Link href={drillHref(ctx, st.code)} className="font-medium text-gray-800 hover:text-brand-700">{m?.name_ar ?? st.code}</Link>
              <span className="tabular-nums text-gray-600">
                <b className="text-gray-900">{fmtNum(st.value)}</b>
                {st.pctOfFirst !== null && <span className="ms-2 text-gray-500">{st.pctOfFirst}٪ من الأول</span>}
                {st.stepConversion !== null && <span className="ms-2 text-brand-700">↓ {st.stepConversion}٪</span>}
                {st.dropOff !== null && <span className="ms-2 text-red-700">تسرّب {st.dropOff}٪</span>}
                {prev && <span className="ms-2 text-xs text-gray-400">(سابقاً {fmtNum(prev.value)})</span>}
              </span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-gray-100">
              <div className="h-3 rounded-full bg-brand-600" style={{ width: `${w}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== حركة الأنابيب (§30) =====
function MovementView({ s }: { s: Extract<SectionResult, { type: "movement" }> }) {
  const mv = s.movement;
  const row = (label: string, v: number | null, sign: "" | "+" | "−" = "", strong = false) => (
    <tr className={strong ? "bg-gray-50 font-semibold" : ""}>
      <td className="px-3 py-2 text-gray-700">{label}</td>
      <td className="px-3 py-2 tabular-nums" dir="ltr">{v === null ? "لا لقطة" : `${sign}${fmtNum(v)}`}</td>
    </tr>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <table className="w-full text-right text-sm">
        <tbody className="divide-y divide-gray-100">
          {row("الأنابيب في البداية (فرص مفتوحة)", mv.openingCount, "", true)}
          {row("فرص جديدة", mv.newOpps, "+")}
          {row("أُعيد فتحها", mv.reopened, "+")}
          {row("تقدّم مرحلة (داخل الأنابيب)", mv.progressions)}
          {row("تراجع مرحلة (داخل الأنابيب)", mv.regressions)}
          {row("فوز (خرج)", mv.won, "−")}
          {row("خسارة (خرج)", mv.lost, "−")}
          {row("الأنابيب في النهاية", mv.closingCount, "", true)}
          {row("صافي الحركة", mv.netCount, mv.netCount !== null && mv.netCount > 0 ? "+" : "", true)}
        </tbody>
      </table>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">قيمة الأنابيب</p>
          <p className="mt-1 tabular-nums">{fmtNum(mv.openingValue)} ← {fmtNum(mv.closingValue)}
            <span className="ms-2 text-gray-500" dir="ltr">({mv.netValue !== null && mv.netValue > 0 ? "+" : ""}{fmtNum(mv.netValue)})</span></p>
        </div>
        {mv.unexplained !== null && mv.unexplained !== 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            فرقٌ لا تفسّره الأحداث: {mv.unexplained > 0 ? "+" : ""}{mv.unexplained} — فرصٌ حُذفت أو دُمجت أو أُنشئت بلا تاريخ مراحل.
            يُعرض كما هو ولا يُوزَّع على البنود.
          </p>
        )}
        <p className="text-xs text-gray-400">«انسحب» ليس مرحلة في هذا النظام — الانسحاب خسارةٌ بسببه في «لماذا نخسر».</p>
      </div>
    </div>
  );
}

function InsightsList({ s }: { s: Extract<SectionResult, { type: "insights" }> }) {
  const icon: Record<string, string> = { drop: "trending_down", spike: "trending_up", concentration: "pie_chart", risk: "warning", change: "compare_arrows", info: "info" };
  return (
    <ul className="space-y-2 text-sm">
      {s.insights.map((i, k) => (
        <li key={k} className="flex gap-2 text-gray-700">
          <span className={`material-symbols-outlined text-[18px] ${i.kind === "risk" || i.kind === "drop" ? "text-amber-700" : "text-gray-500"}`}>{icon[i.kind]}</span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

function CampaignCosts({ s }: { s: Extract<SectionResult, { type: "campaign_costs" }> }) {
  if (s.rows.length === 0) return <p className="text-sm text-gray-400">لا حملات بمصروف مسجَّل — الكلفة وCPL وCAC وROI تظهر حين يُسجَّل المصروف على الحملة.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>{["الحملة", "المصروف", "ليدات", "مؤهَّل", "فوز", "كلفة الليد", "كلفة المؤهَّل", "الاستحواذ", "العائد"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {s.rows.map((c) => (
            <tr key={c.campaign_id}>
              <td className="px-3 py-2 font-medium text-gray-800">{c.campaign_name}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.spent)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.leads)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.qualified)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.won)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.cost_per_lead)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.cost_per_qualified)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtNum(c.cac)}</td>
              <td className="px-3 py-2 tabular-nums">{c.roi_pct === null ? "—" : `${c.roi_pct}٪`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">من crm_campaign_performance (079) — تعريفها كما هو؛ المدى وحده يسري عليها.</p>
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-gray-400">لا بيانات في هذا المدى بهذه المُرشِّحات.</p>;
}
