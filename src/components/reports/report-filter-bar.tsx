import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProjectsLite, getSources, getEmployeesLite, getStages, getLostReasons, getCampaigns } from "@/lib/crm";
import { PRESETS, QUICK_PRESETS, COMPARE_LABELS, type CompareMode } from "@/lib/report-dates";
import {
  BASIS_LABELS, FILTER_LABELS, NONE_VALUE, activeFilterCount, queryString, toQuery,
  type DateBasis, type FilterKey, type ReportParams,
} from "@/lib/report-filters";
import { SILENCE_ORDER } from "@/lib/crm-reporting";
import { PAYMENT_METHODS, PURCHASE_PURPOSES } from "@/lib/types";

// ============================================================
// شريط مُرشِّحات التقارير (§17 · §18 · §60 · §61).
//
// ===== نموذج GET بخانات اختيار — بلا JavaScript =====
//
// الاختيار المتعدّد قائمةٌ منسدلة من <details> وخانات اختيار باسم
// واحد (name="project") — يرسلها المتصفّح مكرّرةً (?project=a&project=b)
// ويقرؤها parseReportParams. فيعمل الشريط قبل تحميل أي شيء، والرابط
// الناتج يُشارَك ويُحفظ عرضاً كما هو.
//
// الصفّ الأول: المدى، المشروع، الموظف، الفريق، المصدر، المرحلة، نوع
// التواصل — ثم «مزيد» لما يُسأل أقلّ. والمدى أولاً لأنه ما يُلمَس أولاً.
// ============================================================

type Opt = { value: string; label: string };

export default async function ReportFilterBar({
  basePath,
  params,
  defaults,
  extra,
  showBasis = true,
}: {
  basePath: string;
  params: ReportParams;
  defaults?: { preset?: ReportParams["preset"]; compare?: CompareMode; basis?: DateBasis };
  extra?: Record<string, string>;
  showBasis?: boolean;
}) {
  const supabase = await createClient();
  const [projects, sources, employees, stages, lostReasons, campaigns, actTypes] = await Promise.all([
    getProjectsLite(), getSources(), getEmployeesLite(), getStages(), getLostReasons(), getCampaigns(),
    supabase.from("crm_activity_types").select("name, is_active, is_system").order("sort_order"),
  ]);

  const opts: Partial<Record<FilterKey, Opt[]>> = {
    project: [{ value: NONE_VALUE, label: "بلا مشروع" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    employee: employees.map((e) => ({ value: e.id, label: e.full_name })),
    team: projects.map((p) => ({ value: p.id, label: p.name })),
    source: [{ value: NONE_VALUE, label: "بلا مصدر" }, ...sources.map((s) => ({ value: s.id, label: s.name }))],
    stage: stages.map((s) => ({ value: s.id, label: s.name })),
    activity_type: ((actTypes.data ?? []) as { name: string; is_system: boolean }[])
      .filter((t) => !t.is_system).map((t) => ({ value: t.name, label: t.name })),
    campaign: campaigns.map((c) => ({ value: c.id, label: c.name })),
    lost_reason: lostReasons.map((r) => ({ value: r.id, label: r.name })),
    result: ["تم التواصل", "لم يرد", "مهتم", "غير مهتم", "مؤجل", "تم الاتفاق"].map((v) => ({ value: v, label: v })),
    direction: ["صادر", "وارد"].map((v) => ({ value: v, label: v })),
    stage_type: [{ value: "open", label: "مفتوحة" }, { value: "won", label: "فائزة" }, { value: "lost", label: "خاسرة" }],
    temperature: ["ساخن", "دافئ", "بارد", "خامل"].map((v) => ({ value: v, label: v })),
    score_band: ["70+", "40–69", "<40", "بلا درجة"].map((v) => ({ value: v, label: v })),
    silence_bucket: SILENCE_ORDER.map((v) => ({ value: v, label: v })),
    payment_method: PAYMENT_METHODS.map((v) => ({ value: v, label: v })),
    purpose: PURCHASE_PURPOSES.map((v) => ({ value: v, label: v })),
  };

  const primary: FilterKey[] = ["project", "employee", "team", "source", "stage", "activity_type"];
  const more: FilterKey[] = ["campaign", "result", "direction", "stage_type", "temperature", "score_band",
    "silence_bucket", "lost_reason", "payment_method", "purpose"];
  const moreCount = more.filter((k) => params.filters[k]?.length).length
    + (params.scoreMin !== null ? 1 : 0) + (params.scoreMax !== null ? 1 : 0)
    + (["area", "building", "floor"] as FilterKey[]).filter((k) => params.filters[k]?.length).length;

  const q = toQuery(params, defaults);
  const hrefWith = (patch: Record<string, string | null>) => {
    const next: Record<string, string> = { ...(extra ?? {}), ...q };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if ("range" in patch || "days" in patch) {
      if (patch.range !== undefined) { delete next.from; delete next.to; delete next.days; if (patch.range) next.range = patch.range; }
    }
    return `${basePath}${queryString(next)}`;
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 print:hidden">
      {/* المدى — اختصارات سريعة (§61) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {QUICK_PRESETS.map((p) => (
          <Link
            key={p}
            href={hrefWith({ range: p })}
            className={params.preset === p
              ? "rounded-full bg-brand-600 px-3 py-1 text-white"
              : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
          >
            {PRESETS.find((x) => x.key === p)?.label}
          </Link>
        ))}
        <span className="ms-auto rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">
          {params.range.label} · {params.range.from === params.range.to ? params.range.from : `${params.range.from} ← ${params.range.to}`}
          {params.compareRange && <span className="text-brand-600"> · مقابل {params.compareRange.from} ← {params.compareRange.to}</span>}
        </span>
      </div>

      <form method="get" action={basePath} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3 text-sm">
        {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

        <label className="block">
          <span className="text-xs text-gray-500">المدى</span>
          <select name="range" defaultValue={params.preset === "custom" || params.preset === "last_n" ? "" : params.preset}
                  className="mt-1 block rounded border border-gray-300 px-2 py-1.5">
            <option value="">— مخصّص —</option>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">أو آخر (يوم)</span>
          <input type="number" name="days" min={1} max={1100} defaultValue={params.n ?? ""} placeholder="١٧"
                 className="mt-1 block w-20 rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">من</span>
          <input type="date" name="from" defaultValue={params.preset === "custom" ? params.range.from : ""}
                 className="mt-1 block rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">إلى</span>
          <input type="date" name="to" defaultValue={params.preset === "custom" ? params.range.to : ""}
                 className="mt-1 block rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">المقارنة</span>
          <select name="compare" defaultValue={params.compare} className="mt-1 block rounded border border-gray-300 px-2 py-1.5">
            {(Object.keys(COMPARE_LABELS) as CompareMode[]).map((k) => <option key={k} value={k}>{COMPARE_LABELS[k]}</option>)}
          </select>
        </label>
        {showBasis && (
          <label className="block">
            <span className="text-xs text-gray-500">أساس التاريخ</span>
            <select name="basis" defaultValue={params.basis} className="mt-1 block rounded border border-gray-300 px-2 py-1.5">
              {(Object.keys(BASIS_LABELS) as DateBasis[]).map((k) => <option key={k} value={k}>{BASIS_LABELS[k]}</option>)}
            </select>
          </label>
        )}

        {primary.map((k) => <MultiSelect key={k} name={k} label={FILTER_LABELS[k]} options={opts[k] ?? []} selected={params.filters[k] ?? []} />)}

        <details className="relative">
          <summary className="mt-5 cursor-pointer list-none rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-brand-600">
            مزيد{moreCount > 0 && <span className="ms-1 rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{moreCount}</span>}
          </summary>
          <div className="absolute end-0 z-30 mt-1 grid w-[min(90vw,36rem)] grid-cols-2 gap-3 rounded-lg border bg-white p-3 shadow-lg">
            {more.map((k) => <MultiSelect key={k} name={k} label={FILTER_LABELS[k]} options={opts[k] ?? []} selected={params.filters[k] ?? []} inline />)}
            {(["area", "building", "floor"] as FilterKey[]).map((k) => (
              <label key={k} className="block text-xs">
                <span className="text-gray-500">{FILTER_LABELS[k]} (بفواصل)</span>
                <input name={k} defaultValue={(params.filters[k] ?? []).join(",")} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1" />
              </label>
            ))}
            <label className="block text-xs">
              <span className="text-gray-500">الدرجة من</span>
              <input type="number" name="score_min" min={0} max={100} defaultValue={params.scoreMin ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1" dir="ltr" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500">إلى</span>
              <input type="number" name="score_max" min={0} max={100} defaultValue={params.scoreMax ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1" dir="ltr" />
            </label>
          </div>
        </details>

        <button type="submit" className="mt-5 rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700">طبّق</button>
        {activeFilterCount(params) + (Object.keys(q).length ? 1 : 0) > 0 && (
          <Link href={`${basePath}${queryString(extra ?? {})}`} className="mt-5 px-2 py-1.5 text-gray-500 hover:text-gray-700">إعادة الضبط</Link>
        )}
      </form>
    </section>
  );
}

function MultiSelect({ name, label, options, selected, inline }: {
  name: string; label: string; options: Opt[]; selected: string[]; inline?: boolean;
}) {
  const chosen = options.filter((o) => selected.includes(o.value));
  const summary = chosen.length === 0 ? "الكل" : chosen.length === 1 ? chosen[0].label : `${chosen.length} مختارة`;
  const list = (
    <div className="max-h-56 space-y-1 overflow-y-auto">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-gray-50">
          <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
      {options.length === 0 && <p className="px-1 text-xs text-gray-400">لا خيارات</p>}
    </div>
  );
  if (inline) {
    return (
      <div className="text-xs">
        <p className="mb-1 text-gray-500">{label} <span className="text-gray-400">({summary})</span></p>
        <div className="rounded border border-gray-200 p-1">{list}</div>
      </div>
    );
  }
  return (
    <details className="relative">
      <summary className="list-none">
        <span className="block text-xs text-gray-500">{label}</span>
        <span className={`mt-1 block max-w-[10rem] cursor-pointer truncate rounded border px-2 py-1.5 ${chosen.length ? "border-brand-600 bg-brand-50 text-brand-800" : "border-gray-300 text-gray-700"}`}>
          {summary} ▾
        </span>
      </summary>
      <div className="absolute start-0 z-30 mt-1 w-60 rounded-lg border bg-white p-2 shadow-lg">{list}</div>
    </details>
  );
}
