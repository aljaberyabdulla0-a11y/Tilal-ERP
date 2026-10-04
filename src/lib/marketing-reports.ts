import { createClient } from "@/lib/supabase/server";
import type { MktFilters } from "@/lib/marketing-filters";
import { getBreakdown, getBudgetStatus, getFunnel, getKpis, getTrend, type BreakdownRow } from "@/lib/marketing";
import { ATTRIBUTION_MODELS, BREAKDOWN_DIMS, fmt, fmtPct } from "@/lib/marketing-style";

// ============================================================
// سجلّ تقارير التسويق — تعريفٌ واحد للشاشة والتصدير.
//
// كل تقرير يُبنى هنا جدولاً (أعمدة + صفوف بقيمٍ خام)، والشاشة تعرضه
// والتصدير يكتبه — فما خرج في الملف هو ما رآه من صدّره، لا نسخةٌ
// موازية تفترق (نفس مبدأ تصدير الـCRM §١٨).
//
// ولا حساب هنا: الأرقام من دوالّ 125 كما هي. الترتيب والاختيار فقط.
// ============================================================

export type Col = { key: string; label: string; kind?: "money" | "num" | "pct" | "text" | "ratio" };
export type Report = { key: string; title: string; note?: string; columns: Col[]; rows: Record<string, unknown>[]; error: string | null };

type Def = { title: string; group: string; note?: string; build: (f: MktFilters) => Promise<Omit<Report, "key" | "title">> };

const DIM_COLS: Col[] = [
  { key: "label", label: "البُعد", kind: "text" },
  { key: "cost", label: "الكلفة", kind: "money" },
  { key: "leads", label: "ليدات", kind: "num" },
  { key: "qualified", label: "مؤهَّلون", kind: "num" },
  { key: "reservations", label: "حجوزات", kind: "num" },
  { key: "sales", label: "بيعات منسوبة", kind: "num" },
  { key: "sale_value", label: "قيمة البيع", kind: "money" },
  { key: "commission", label: "عمولة تلال", kind: "money" },
  { key: "cpl", label: "CPL", kind: "money" },
  { key: "cpql", label: "CPQL", kind: "money" },
  { key: "cac", label: "CAC", kind: "money" },
  { key: "roas", label: "ROAS", kind: "ratio" },
  { key: "roi", label: "ROI", kind: "pct" },
];

function dimReport(dim: string, opts: { sort?: keyof BreakdownRow; desc?: boolean; cols?: string[]; filter?: (r: BreakdownRow) => boolean } = {}) {
  return async (f: MktFilters) => {
    const r = await getBreakdown(dim, f);
    let rows = r.data.filter(opts.filter ?? (() => true));
    if (opts.sort) {
      const k = opts.sort;
      rows = [...rows].sort((a, b) => {
        const x = a[k] == null ? Number.POSITIVE_INFINITY : Number(a[k]);
        const y = b[k] == null ? Number.POSITIVE_INFINITY : Number(b[k]);
        return opts.desc ? (y === Infinity ? -1 : x === Infinity ? 1 : y - x) : x - y;
      });
    }
    const cols = [{ ...DIM_COLS[0], label: BREAKDOWN_DIMS[dim] ?? "البُعد" },
      ...DIM_COLS.slice(1).filter((c) => !opts.cols || opts.cols.includes(c.key))];
    return { columns: cols, rows: rows as unknown as Record<string, unknown>[], error: r.error };
  };
}

export const REPORTS: Record<string, Def> = {
  overview: { group: "عام", title: "نظرة التسويق", build: async (f) => {
    const k = await getKpis(f);
    const d = k.data;
    const rows = d ? [
      ["كلفة التسويق (مدفوع + مواد)", d.cost, "money"], ["منها مصروف إعلانات", d.ad_spend, "money"], ["ملتزم (معتمد غير مدفوع)", d.committed, "money"],
      ["مصروف المنصّات (ما تقوله)", d.platform_spend, "money"], ["فرق المطابقة (منصّة − مدفوع إعلانات)", d.recon_gap, "money"],
      ["ظهور", d.impressions, "num"], ["نقرات", d.clicks, "num"], ["CTR", d.ctr, "pct"], ["CPC", d.cpc, "money"], ["مسوح QR", d.scans, "num"], ["زيارات الصفحات", d.visitors, "num"],
      ["ليدات", d.leads, "num"], ["مؤهَّلون", d.qualified, "num"], ["حجوزات (فوج الليدات)", d.reservations, "num"],
      ["بيعات منسوبة", d.sales, "num"], ["قيمة البيع المنسوبة", d.sale_value, "money"], ["عمولة تلال المنسوبة", d.commission, "money"],
      ["CPL", d.cpl, "money"], ["CPQL", d.cpql, "money"], ["CPA", d.cpa, "money"], ["CAC", d.cac, "money"],
      ["ROAS", d.roas, "ratio"], ["ROI على العمولة", d.roi, "pct"], ["ROI على قيمة البيع", d.roi_value, "pct"],
      ["ليد ← مؤهَّل", d.lead_to_qualified, "pct"], ["ليد ← حجز", d.lead_to_reservation, "pct"], ["ليد ← بيع", d.lead_to_sale, "pct"],
    ].map(([label, value, kind]) => ({ label, value, kind })) : [];
    return { columns: [{ key: "label", label: "المؤشّر", kind: "text" }, { key: "value", label: "القيمة", kind: "text" }], rows, error: k.error };
  } },
  campaigns: { group: "الأداء", title: "أداء الحملات", build: dimReport("campaign") },
  channels: { group: "الأداء", title: "أداء القنوات", build: dimReport("channel") },
  projects: { group: "الأداء", title: "تسويق المشاريع", build: dimReport("project") },
  lead_generation: { group: "الليدات", title: "توليد الليدات (اتجاه)", build: async (f) => {
    const t = await getTrend(f.preset === "month" || f.preset === "last30" ? "day" : "week", f);
    return { columns: [{ key: "period", label: "الفترة", kind: "text" }, { key: "leads", label: "ليدات", kind: "num" }, { key: "qualified", label: "مؤهَّلون", kind: "num" },
      { key: "cost", label: "الكلفة", kind: "money" }, { key: "sales", label: "بيعات", kind: "num" }, { key: "commission", label: "عمولة", kind: "money" }],
      rows: t.data as unknown as Record<string, unknown>[], error: t.error };
  } },
  lead_quality: { group: "الليدات", title: "جودة الليدات بالقناة", note: "المؤهَّل والحجز من فوج ليدات المدة نفسها.",
    build: dimReport("channel", { cols: ["leads", "qualified", "reservations", "sales", "cpl", "cpql"] }) },
  lead_attribution: { group: "الإسناد", title: "إسناد الليدات والبيعات — مقارنة النماذج", note: "العمولة المنسوبة لكل قناة بكل نموذج. الفرق بين «أول لمسة» و«آخر لمسة» يقول من يبني الطلب ومن يُغلقه.",
    build: async (f) => {
      const models = Object.keys(ATTRIBUTION_MODELS);
      const all = await Promise.all(models.map((m) => getBreakdown("channel", { ...f, model: m })));
      const keys = new Map<string, Record<string, unknown>>();
      all.forEach((r, i) => r.data.forEach((row) => {
        const k = row.dim_key ?? "none";
        const x = keys.get(k) ?? { label: row.label };
        x[models[i]] = row.commission; x[`${models[i]}_sales`] = row.sales;
        keys.set(k, x);
      }));
      return { columns: [{ key: "label", label: "القناة", kind: "text" }, ...models.map((m) => ({ key: m, label: ATTRIBUTION_MODELS[m], kind: "money" as const }))],
        rows: Array.from(keys.values()), error: all.find((r) => r.error)?.error ?? null };
    } },
  sales_attribution: { group: "الإسناد", title: "إسناد البيعات بالحملة", build: dimReport("campaign", { cols: ["sales", "sale_value", "commission", "cost", "cac", "roi"], filter: (r) => Number(r.sales) > 0 }) },
  campaign_to_sale: { group: "الإسناد", title: "من الحملة إلى البيعة", note: "كل بيعة غير مفسوخة بتاريخ تأكيد مقدمتها، ونصيب كل حملة منها بالنموذج المختار. بلا أسماء عملاء.",
    build: async (f) => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("mkt_attributed_sales", { p_model: f.model, p_from: f.from, p_to: f.to });
      const [{ data: camps }, { data: projects }] = await Promise.all([
        supabase.from("crm_campaigns").select("id, name"), supabase.rpc("mkt_projects"),
      ]);
      const cn = new Map((camps ?? []).map((c) => [c.id, c.name]));
      const pn = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      const rows = ((data ?? []) as { sale_date: string; project_id: string; campaign_id: string | null; touch_type: string; weight: number; commission: number; deal_amount: number }[])
        .filter((r) => (!f.project || r.project_id === f.project) && (!f.campaign || r.campaign_id === f.campaign))
        .map((r) => ({ sale_date: r.sale_date, project: pn.get(r.project_id) ?? "—", campaign: r.campaign_id ? cn.get(r.campaign_id) ?? "—" : "غير منسوب",
          touch: r.touch_type, weight: r.weight, commission: Math.round(r.weight * r.commission), deal: Math.round(r.weight * r.deal_amount) }));
      return { columns: [{ key: "sale_date", label: "تاريخ البيع", kind: "text" }, { key: "project", label: "المشروع", kind: "text" }, { key: "campaign", label: "الحملة", kind: "text" },
        { key: "touch", label: "اللمسة", kind: "text" }, { key: "weight", label: "الوزن", kind: "ratio" }, { key: "commission", label: "العمولة المنسوبة", kind: "money" },
        { key: "deal", label: "قيمة البيع المنسوبة", kind: "money" }], rows, error: error?.message ?? null };
    } },
  content: { group: "المحتوى", title: "أداء المحتوى", build: dimReport("content", { cols: ["leads", "qualified", "sales", "commission"] }) },
  landing: { group: "المحتوى", title: "صفحات الهبوط", build: dimReport("landing", { cols: ["leads", "qualified", "reservations", "sales"] }) },
  influencers: { group: "الأداء", title: "أداء المؤثرين", build: dimReport("influencer") },
  offline: { group: "الأداء", title: "الميداني والفعاليات", build: dimReport("activity") },
  budget: { group: "المال", title: "الميزانيات", build: async (f) => {
    const b = await getBudgetStatus(f.from, f.to);
    return { columns: [{ key: "name", label: "الميزانية", kind: "text" }, { key: "scope_label", label: "النطاق", kind: "text" }, { key: "period_start", label: "من", kind: "text" },
      { key: "period_end", label: "إلى", kind: "text" }, { key: "status", label: "الحالة", kind: "text" }, { key: "planned", label: "المخطّط", kind: "money" },
      { key: "approved", label: "المعتمد", kind: "money" }, { key: "committed", label: "الملتزم", kind: "money" }, { key: "spent", label: "المصروف", kind: "money" },
      { key: "remaining", label: "المتبقّي", kind: "money" }, { key: "utilization_pct", label: "الاستهلاك", kind: "pct" }, { key: "alert_level", label: "التنبيه", kind: "text" }],
      rows: b.data as unknown as Record<string, unknown>[], error: b.error };
  } },
  expenses: { group: "المال", title: "المصروفات بالتصنيف", build: dimReport("category", { cols: ["cost"] }) },
  vendors: { group: "المال", title: "أداء الموردين", build: dimReport("vendor", { cols: ["cost"] }) },
  employees: { group: "الفريق", title: "أداء أصحاب الحملات", build: dimReport("employee") },
  months: { group: "عام", title: "شهراً بشهر", build: dimReport("month") },
  roi: { group: "الكفاءة", title: "العائد ROI بالحملة", build: dimReport("campaign", { sort: "roi", desc: true, cols: ["cost", "commission", "roi"] }) },
  roas: { group: "الكفاءة", title: "عائد الإعلان ROAS بالقناة", build: dimReport("channel", { sort: "roas", desc: true, cols: ["cost", "commission", "roas"] }) },
  cpl: { group: "الكفاءة", title: "كلفة الليد CPL بالقناة", build: dimReport("channel", { sort: "cpl", cols: ["cost", "leads", "cpl"] }) },
  cpql: { group: "الكفاءة", title: "كلفة المؤهَّل CPQL بالقناة", build: dimReport("channel", { sort: "cpql", cols: ["cost", "qualified", "cpql"] }) },
  cac: { group: "الكفاءة", title: "كلفة الاستحواذ CAC بالحملة", build: dimReport("campaign", { sort: "cac", cols: ["cost", "sales", "cac"] }) },
  project_roi: { group: "الكفاءة", title: "ربحية تسويق المشاريع", build: dimReport("project", { sort: "roi", desc: true, cols: ["cost", "sales", "sale_value", "commission", "roi"] }) },
  funnel: { group: "عام", title: "القمع", build: async (f) => {
    const r = await getFunnel(f);
    return { columns: [{ key: "label", label: "الخطوة", kind: "text" }, { key: "value", label: "العدد", kind: "num" }, { key: "from_previous", label: "من السابقة", kind: "pct" }, { key: "from_leads", label: "من الليدات", kind: "pct" }],
      rows: r.data as unknown as Record<string, unknown>[], error: r.error };
  } },
};

export async function buildReport(key: string, f: MktFilters): Promise<Report> {
  const def = REPORTS[key] ?? REPORTS.overview;
  const k = REPORTS[key] ? key : "overview";
  const r = await def.build(f);
  return { key: k, title: def.title, note: def.note, ...r };
}

export function cellText(v: unknown, kind: Col["kind"], rowKind?: string): string {
  const k = (rowKind as Col["kind"]) ?? kind;
  if (v === null || v === undefined || v === "") return "—";
  if (k === "pct") return fmtPct(v as number);
  if (k === "ratio") return `${fmt(v as number)}×`;
  if (k === "money" || k === "num") return fmt(v as number);
  return String(v);
}
