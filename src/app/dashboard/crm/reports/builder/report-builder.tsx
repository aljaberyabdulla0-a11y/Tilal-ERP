"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// منشئ التقارير (§21 · §77) — تقرير جديد بلا برمجة.
//
//   التقرير
//   ├── المدى الافتراضي والمقارنة وأساس التاريخ     (Date Logic · Comparison)
//   └── أقسام، لكلٍّ:
//       ├── العرض: مؤشّرات · اتجاه · جدول · مصفوفة · قمع · حركة · ملاحظات
//       ├── المقاييس من السجلّ (crm_metrics)          (Data Source · Metrics)
//       ├── الأبعاد                                    (Dimensions · Grouping)
//       ├── الترتيب                                    (Sorting)
//       └── الحالة: لقطة نهاية المدى أو الآن            (للمقاييس الحالية)
//
// والمُرشِّحات تُختار عند الفتح وتُحفظ «عرضاً» — إلا «نطاق التقرير»:
// مشروعٌ أو أكثر يُثبَّت في القالب نفسه فيصير «تقرير لامك» تقريراً
// عن لامك أينما فُتح (العرض والنزول والتصدير والمجدول)، ولا يُغيَّر
// من شريط المُرشِّحات. التعريف بيانات تُحفظ في crm_report_templates،
// والمحرّك نفسه يحسبها — لا صيغة هنا.
// ============================================================

export type BuilderMetric = { code: string; name_ar: string; category: string; source: "events" | "state"; definition: string };
type SectionType = "kpis" | "trend" | "table" | "matrix" | "funnel" | "movement" | "insights" | "campaign_costs";
type Section = { key: string; title: string; type: SectionType; metrics: string[]; group_by: string[]; sort?: string; state?: "snapshot" | "current" };
export type BuilderDraft = {
  id?: string;
  name: string;
  description: string;
  category: string;
  is_shared: boolean;
  audience: string[];
  default_range: string;
  compare: string;
  basis: string;
  // النطاق الثابت: المشاريع التي يخصّها التقرير — فارغ = كل ما في نطاق القارئ
  projects: string[];
  // كيف يُنسب العمل إلى المشروع: بفريقه (موظفو المشروع — 037) أو بمشروع الصفقة
  scopeBy: "team" | "project";
  // مفاتيح ثابتة أخرى جاءت مع قالب منسوخ — تُحفظ كما هي
  otherFilters: Record<string, string[]>;
  sections: Section[];
};

const TYPES: [SectionType, string][] = [
  ["kpis", "مؤشّرات مع مقارنة"], ["trend", "اتجاه زمني"], ["table", "جدول"], ["matrix", "مصفوفة"],
  ["funnel", "قمع"], ["movement", "حركة الأنابيب"], ["insights", "ملاحظات"], ["campaign_costs", "كلفة الحملات"],
];
const DIMS: [string, string][] = [
  ["employee", "الموظف"], ["project", "المشروع"], ["team", "الفريق"], ["source", "المصدر"], ["campaign", "الحملة"],
  ["stage", "المرحلة"], ["activity_type", "نوع التواصل"], ["result", "النتيجة"], ["direction", "الاتجاه"],
  ["event_type", "نوع الحدث"], ["lost_reason", "سبب الخسارة"], ["temperature", "الحرارة"], ["score_band", "شريحة الدرجة"],
  ["payment_method", "طريقة الدفع"], ["purpose", "غرض الشراء"], ["area", "المنطقة"], ["silence_bucket", "مدة الصمت"],
  ["day", "اليوم"], ["week", "الأسبوع"], ["month", "الشهر"],
];
const RANGES: [string, string][] = [
  ["today", "اليوم"], ["yesterday", "أمس"], ["last_7", "آخر ٧ أيام"], ["last_14", "آخر ١٤ يوماً"], ["last_30", "آخر ٣٠ يوماً"],
  ["this_week", "هذا الأسبوع"], ["last_week", "الأسبوع الماضي"], ["this_month", "هذا الشهر"], ["last_month", "الشهر الماضي"],
  ["this_quarter", "هذا الربع"], ["last_quarter", "الربع الماضي"], ["this_year", "هذه السنة"],
];
const ROLES: [string, string][] = [
  ["admin", "المدير"], ["followup_manager", "مدير المتابعة"], ["supervisor", "المشرف"], ["employee", "الموظف"],
  ["marketing", "التسويق"], ["viewer", "المُطالِع"], ["accountant", "المحاسب"],
];
const INPUT = "mt-1 block w-full rounded border border-gray-300 px-2 py-1.5";

export default function ReportBuilder({ metrics, projects, initial, canUpdate }: {
  metrics: BuilderMetric[]; projects: { id: string; name: string }[]; initial: BuilderDraft; canUpdate: boolean;
}) {
  const router = useRouter();
  const [d, setD] = useState<BuilderDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byCat = useMemo(() => {
    const m = new Map<string, BuilderMetric[]>();
    for (const x of metrics) m.set(x.category, [...(m.get(x.category) ?? []), x]);
    return Array.from(m.entries());
  }, [metrics]);
  const nameOf = useMemo(() => new Map(metrics.map((m) => [m.code, m.name_ar])), [metrics]);

  const setSec = (i: number, patch: Partial<Section>) =>
    setD((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => {
    const s = [...x.sections];
    const j = i + dir;
    if (j < 0 || j >= s.length) return x;
    [s[i], s[j]] = [s[j], s[i]];
    return { ...x, sections: s };
  });
  const add = (type: SectionType) => setD((x) => ({
    ...x, sections: [...x.sections, {
      key: `s${Date.now().toString(36)}`, title: TYPES.find((t) => t[0] === type)![1], type,
      metrics: type === "movement" || type === "insights" || type === "campaign_costs" ? [] : ["TOTAL_ACTIVITIES"],
      group_by: type === "table" ? ["employee"] : type === "trend" ? ["day"] : type === "matrix" ? ["employee", "day"] : [],
    }],
  }));

  function validate(): string | null {
    if (!d.name.trim()) return "اسمٌ للتقرير.";
    if (d.sections.length === 0) return "قسمٌ واحد على الأقل.";
    for (const s of d.sections) {
      if (["kpis", "trend", "table", "matrix", "funnel"].includes(s.type) && s.metrics.length === 0) return `«${s.title}»: اختر مقياساً.`;
      if (s.type === "table" && s.group_by.length === 0) return `«${s.title}»: الجدول يحتاج بُعداً.`;
      if (s.type === "matrix" && (s.group_by.length !== 2 || s.metrics.length !== 1)) return `«${s.title}»: المصفوفة بُعدان ومقياسٌ واحد.`;
      if (s.type === "funnel" && s.metrics.length < 2) return `«${s.title}»: القمع خطوتان على الأقل.`;
    }
    if (d.audience.length === 0) return "من يرى التقرير؟";
    return null;
  }

  async function save(asCopy: boolean) {
    const v = validate();
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    const fixed = { ...d.otherFilters, ...(d.projects.length ? { [d.scopeBy]: d.projects } : {}) };
    const definition = {
      default_range: d.default_range, compare: d.compare, basis: d.basis,
      ...(Object.keys(fixed).length ? { filters: fixed } : {}),
      sections: d.sections.map((s) => ({
        key: s.key, title: s.title.trim() || s.key, type: s.type,
        ...(s.metrics.length ? { metrics: s.metrics } : {}),
        ...(s.group_by.length ? { group_by: s.group_by } : {}),
        ...(s.sort ? { sort: s.sort } : {}),
        ...(s.state ? { state: s.state } : {}),
      })),
    };
    const row = { name: d.name.trim(), description: d.description.trim() || null, category: d.category.trim() || "مخصّص",
      is_shared: d.is_shared, audience: d.audience, definition };
    const supabase = createClient();
    const res = d.id && !asCopy
      ? await supabase.from("crm_report_templates").update(row).eq("id", d.id).select("id").single()
      : await supabase.from("crm_report_templates").insert(row).select("id").single();
    setBusy(false);
    if (res.error) return setErr(res.error.message);
    router.push(`/dashboard/crm/reports/view?template=${res.data.id}`);
    router.refresh();
  }

  async function remove() {
    if (!d.id || !confirm("حذف هذا التقرير؟ سجلّ تشغيله يبقى.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("crm_report_templates").delete().eq("id", d.id);
    if (error) return setErr(error.message);
    router.push("/dashboard/crm/reports");
    router.refresh();
  }

  return (
    <div className="space-y-5 text-sm">
      <section className="grid gap-3 rounded-lg border border-gray-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2"><span className="text-xs text-gray-500">اسم التقرير</span>
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={INPUT} placeholder="تقرير لامك الشهري" /></label>
        <label className="block"><span className="text-xs text-gray-500">الفئة</span>
          <input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} className={INPUT} /></label>
        <label className="flex items-end gap-2 pb-2 text-xs text-gray-700">
          <input type="checkbox" checked={d.is_shared} onChange={(e) => setD({ ...d, is_shared: e.target.checked })} /> مشترك مع الأدوار أدناه
        </label>
        <label className="block sm:col-span-2 lg:col-span-4"><span className="text-xs text-gray-500">الوصف</span>
          <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} className={INPUT} /></label>
        <label className="block"><span className="text-xs text-gray-500">المدى الافتراضي</span>
          <select value={d.default_range} onChange={(e) => setD({ ...d, default_range: e.target.value })} className={INPUT}>
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">المقارنة</span>
          <select value={d.compare} onChange={(e) => setD({ ...d, compare: e.target.value })} className={INPUT}>
            <option value="previous_period">بالفترة السابقة</option><option value="previous_year">بالسنة السابقة</option><option value="none">بلا</option></select></label>
        <label className="block"><span className="text-xs text-gray-500">أساس التاريخ</span>
          <select value={d.basis} onChange={(e) => setD({ ...d, basis: e.target.value })} className={INPUT}>
            <option value="event">تاريخ الحدث</option><option value="lead_created">تاريخ إنشاء الليد</option><option value="opp_created">تاريخ إنشاء الفرصة</option></select></label>
        <div><span className="text-xs text-gray-500">يراه</span>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {ROLES.map(([k, l]) => (
              <label key={k} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={d.audience.includes(k)}
                       onChange={(e) => setD({ ...d, audience: e.target.checked ? [...d.audience, k] : d.audience.filter((x) => x !== k) })} />{l}
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 sm:col-span-2 lg:col-span-4">
          «يراه» يحكم ظهور التقرير في القائمة؛ الأرقام داخله تحكمها صلاحية كلٍّ (الموظف يرى نشاطه وحده).
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-gray-800">نطاق التقرير — المشروع</h2>
          <span className="text-xs text-gray-500">
            {d.projects.length === 0 ? "كل المشاريع (يُختار المشروع عند الفتح)" : `تقرير خاصّ بـ ${d.projects.length === 1 ? "مشروع واحد" : `${d.projects.length} مشاريع`}`}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          اختر مشروعاً ليصير التقرير تقريرَه: يُفتح ويُصدَّر ويُرسَل مجدولاً عن هذا المشروع وحده، ولا يُغيَّر من شريط المُرشِّحات.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <label className="flex items-start gap-2">
            <input type="radio" checked={d.scopeBy === "team"} onChange={() => setD({ ...d, scopeBy: "team" })} className="mt-0.5" />
            <span><b>بفريق المشروع</b> (موصى به) — نشاط موظفي المشروع وعملاؤهم.
              <span className="block text-gray-400">هكذا تُنسب بياناتك اليوم: الموظف مُسنَد إلى مشروع، والعميل بلا مشروع.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={d.scopeBy === "project"} onChange={() => setD({ ...d, scopeBy: "project" })} className="mt-0.5" />
            <span><b>بمشروع الصفقة</b> — الفرص والعملاء المسجَّل عليهم المشروع نفسه.
              <span className="block text-gray-400">يُفيد حين يُسجَّل المشروع على الفرص؛ قليلٌ منها عليه مشروع اليوم.</span></span>
          </label>
        </div>
        <div className="mt-3 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded border border-gray-100 p-2 sm:grid-cols-3 lg:grid-cols-4">
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={d.projects.includes(p.id)}
                     onChange={(e) => {
                       const next = e.target.checked ? [...d.projects, p.id] : d.projects.filter((x) => x !== p.id);
                       // اسمٌ مقترح حين يكون التقرير بلا اسم بعد
                       const name = !d.name.trim() && next.length === 1 ? `تقرير ${p.name}` : d.name;
                       setD({ ...d, projects: next, name });
                     }} />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
          {projects.length === 0 && <p className="text-xs text-gray-400">لا مشاريع في نطاقك.</p>}
        </div>
        {d.projects.length > 0 && (
          <button type="button" onClick={() => setD({ ...d, projects: [] })} className="mt-2 text-xs text-gray-500 hover:underline">
            إلغاء التثبيت — كل المشاريع
          </button>
        )}
      </section>

      {d.sections.map((s, i) => {
        const dimsNeeded = s.type === "table" ? 2 : s.type === "matrix" ? 2 : s.type === "trend" ? 1 : 0;
        return (
          <section key={s.key} className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1"><span className="text-xs text-gray-500">عنوان القسم</span>
                <input value={s.title} onChange={(e) => setSec(i, { title: e.target.value })} className={INPUT} /></label>
              <label className="block"><span className="text-xs text-gray-500">العرض</span>
                <select value={s.type} onChange={(e) => setSec(i, { type: e.target.value as SectionType })} className={INPUT}>
                  {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <span className="flex gap-2 pb-2 text-xs">
                <button type="button" onClick={() => move(i, -1)} className="text-gray-500 hover:text-gray-800">▲</button>
                <button type="button" onClick={() => move(i, 1)} className="text-gray-500 hover:text-gray-800">▼</button>
                <button type="button" onClick={() => setD({ ...d, sections: d.sections.filter((_, j) => j !== i) })} className="text-red-700 hover:underline">حذف</button>
              </span>
            </div>

            {s.type !== "movement" && s.type !== "insights" && s.type !== "campaign_costs" && (
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <p className="text-xs text-gray-500">المقاييس {s.type === "funnel" ? "(بترتيب خطوات القمع)" : s.type === "matrix" ? "(واحد)" : ""}</p>
                  {s.metrics.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {s.metrics.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
                          {nameOf.get(c) ?? c}
                          <button type="button" aria-label="إزالة" onClick={() => setSec(i, { metrics: s.metrics.filter((x) => x !== c) })}>✕</button>
                        </span>
                      ))}
                    </p>
                  )}
                  <div className="mt-2 grid max-h-52 gap-2 overflow-y-auto rounded border border-gray-100 p-2 sm:grid-cols-2">
                    {byCat.map(([cat, list]) => (
                      <div key={cat}>
                        <p className="text-[11px] font-semibold text-gray-400">{cat}</p>
                        {list.map((m) => (
                          <label key={m.code} className="flex items-center gap-1 text-xs" title={m.definition}>
                            <input type="checkbox" checked={s.metrics.includes(m.code)}
                                   onChange={(e) => setSec(i, { metrics: e.target.checked
                                     ? (s.type === "matrix" ? [m.code] : [...s.metrics, m.code])
                                     : s.metrics.filter((x) => x !== m.code) })} />
                            {m.name_ar}{m.source === "state" && <span className="text-[10px] text-gray-400">(حالة)</span>}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {dimsNeeded > 0 && Array.from({ length: dimsNeeded }).map((_, k) => (
                    <label key={k} className="block"><span className="text-xs text-gray-500">
                      {s.type === "matrix" ? (k === 0 ? "الصفوف" : "الأعمدة") : s.type === "trend" ? "التجزئة" : k === 0 ? "البُعد" : "بُعد ثانٍ (اختياري)"}
                    </span>
                      <select value={s.group_by[k] ?? ""} className={INPUT}
                              onChange={(e) => {
                                const g = [...s.group_by];
                                if (e.target.value) g[k] = e.target.value; else g.splice(k, 1);
                                setSec(i, { group_by: g.filter(Boolean) });
                              }}>
                        {s.type === "table" && k === 1 && <option value="">—</option>}
                        {(s.type === "trend" ? DIMS.filter(([x]) => ["day", "week", "month"].includes(x)) : DIMS).map(([x, l]) => <option key={x} value={x}>{l}</option>)}
                      </select></label>
                  ))}
                  {s.type === "table" && (
                    <label className="block"><span className="text-xs text-gray-500">الترتيب</span>
                      <select value={s.sort ?? ""} onChange={(e) => setSec(i, { sort: e.target.value || undefined })} className={INPUT}>
                        <option value="">بالبُعد</option>
                        {s.metrics.map((c) => <option key={c} value={`-${c}`}>{nameOf.get(c)} ↓</option>)}
                        {s.metrics.map((c) => <option key={`+${c}`} value={c}>{nameOf.get(c)} ↑</option>)}
                      </select></label>
                  )}
                  {s.metrics.some((c) => metrics.find((m) => m.code === c)?.source === "state") && (
                    <p className="rounded bg-gray-50 p-2 text-[11px] text-gray-500">
                      المقاييس «الحالية» تُقرأ من لقطة نهاية المدى — أو من الآن إن كان المدى ينتهي اليوم.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">أضف قسماً:</span>
        {TYPES.map(([k, l]) => (
          <button key={k} type="button" onClick={() => add(k)} className="rounded-full border border-dashed border-gray-400 px-3 py-1 text-xs text-gray-700 hover:border-brand-600">+ {l}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {d.id && canUpdate && (
          <button type="button" disabled={busy} onClick={() => save(false)} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">حفظ وفتح</button>
        )}
        <button type="button" disabled={busy} onClick={() => save(true)}
                className={d.id && canUpdate ? "rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50" : "rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"}>
          {d.id ? "حفظ كنسخة جديدة" : "حفظ وفتح"}
        </button>
        {d.id && canUpdate && <button type="button" onClick={remove} className="ms-auto text-xs text-red-700 hover:underline">حذف التقرير</button>}
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}
