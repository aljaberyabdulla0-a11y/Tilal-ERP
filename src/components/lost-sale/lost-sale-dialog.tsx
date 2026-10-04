"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { lostDict, pick, money, type Lang } from "@/lib/lost-sales-i18n";
import type {
  LossCategory, LossReason, LossSource, CustomerPotential, RecoveryLevel, Competitor, CompetitorProject,
} from "@/lib/lost-sales";

// ============================================================
// «تحليل سبب فقدان فرصة البيع» — الباب الوحيد لإغلاق فرصة كخاسرة.
//
// القاعدة هي الحَكَم (close_opportunity_lost / update_lost_analysis
// في 140 تتحقّق من كل حقل)، والنموذج يُحسن الظنّ بها: يعرض ما ستطلبه
// قبل الإرسال — السبب الفرعي يتبع الفئة، و«أخرى» تطلب شرحاً، والمنافسة
// تفتح قسم المنافس، ومستوى الاسترجاع يقترح موعد إعادة التواصل بقاعدته.
//
// ما لا يُسأل عنه الموظف: المرحلة التي سقطت منها، والقيمة، والمالك،
// والمشروع، والحملة — تُلتقط من الفرصة نفسها لحظة الإغلاق.
// ============================================================

export type LostFormValues = {
  category_id: string;
  reason_id: string;
  loss_source: string;
  customer_potential: string;
  recovery_potential: string;
  recontact_required: boolean;
  recontact_date: string;
  recovery_reason: string;
  details: string;
  discount: string;
  competitor_id: string;
  competitor_project_id: string;
  competitor_name: string;
  competitor_price: string;
  competitor_price_per_m2: string;
  competitor_unit_m2: string;
  competitor_payment_plan: string;
  competitor_advantage: string;
  competitor_choice_reason: string;
  lost_value: string;
};

const EMPTY: LostFormValues = {
  category_id: "", reason_id: "", loss_source: "", customer_potential: "", recovery_potential: "",
  recontact_required: false, recontact_date: "", recovery_reason: "", details: "", discount: "",
  competitor_id: "", competitor_project_id: "", competitor_name: "", competitor_price: "",
  competitor_price_per_m2: "", competitor_unit_m2: "", competitor_payment_plan: "",
  competitor_advantage: "", competitor_choice_reason: "", lost_value: "",
};

type Lookups = {
  categories: LossCategory[];
  reasons: LossReason[];
  sources: LossSource[];
  potentials: CustomerPotential[];
  recovery: RecoveryLevel[];
  competitors: Competitor[];
  competitorProjects: CompetitorProject[];
};

type OppSummary = { stage_name: string; expected_value: number | null; owner_name: string | null; project_name: string | null; client_name: string };

function baghdadToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function LostSaleDialog({
  opportunityId,
  mode = "create",
  lossId,
  initial,
  canEditValue = false,
  needsEditReason = true,
  onClose,
  onDone,
}: {
  opportunityId: string;
  mode?: "create" | "edit";
  lossId?: string;
  initial?: Partial<LostFormValues>;
  canEditValue?: boolean;
  needsEditReason?: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const supabase = createClient();
  const { locale, dir } = useI18n();
  const lang = locale as Lang;
  const t = lostDict(lang);

  const [lk, setLk] = useState<Lookups | null>(null);
  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [v, setV] = useState<LostFormValues>({ ...EMPTY, ...initial });
  const [sourceTouched, setSourceTouched] = useState(Boolean(initial?.loss_source));
  const [showComp, setShowComp] = useState(Boolean(initial?.competitor_id || initial?.competitor_name));
  const [compMode, setCompMode] = useState<"list" | "other">(initial?.competitor_name && !initial?.competitor_id ? "other" : "list");
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, r, s, p, rec, comp, cp, o] = await Promise.all([
        supabase.from("crm_loss_categories").select("*").order("sort_order"),
        supabase.from("crm_lost_reasons").select("id, category_id, name, name_en, requires_note, is_other, is_active, sort_order").order("sort_order"),
        supabase.from("crm_loss_sources").select("*").order("sort_order"),
        supabase.from("crm_customer_potentials").select("*").order("sort_order"),
        supabase.from("crm_recovery_levels").select("*").order("sort_order"),
        supabase.from("mkt_competitors").select("id, name, name_en, is_active, projects, price_position").order("name"),
        supabase.from("mkt_competitor_projects").select("id, competitor_id, name, location, price_per_m2, payment_plan, is_active").order("name"),
        supabase.from("v_crm_opportunities").select("stage_name, expected_value, owner_name, project_name, client_name").eq("id", opportunityId).maybeSingle(),
      ]);
      if (!alive) return;
      if (c.error || r.error || s.error || p.error || rec.error) {
        setLoadErr(true);
        return;
      }
      setLk({
        categories: (c.data ?? []) as LossCategory[],
        reasons: (r.data ?? []) as LossReason[],
        sources: (s.data ?? []) as LossSource[],
        potentials: (p.data ?? []) as CustomerPotential[],
        recovery: (rec.data ?? []) as RecoveryLevel[],
        // المنافسون اختياريون: قراءةٌ فاشلة لا تُسقط النموذج
        competitors: (comp.data ?? []) as Competitor[],
        competitorProjects: (cp.data ?? []) as CompetitorProject[],
      });
      setOpp((o.data ?? null) as OppSummary | null);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId]);

  const set = <K extends keyof LostFormValues>(k: K, val: LostFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  const cat = lk?.categories.find((c) => c.id === v.category_id) ?? null;
  const reasons = useMemo(
    () => (lk?.reasons ?? []).filter((r) => r.category_id === v.category_id && (r.is_active || r.id === v.reason_id)),
    [lk, v.category_id, v.reason_id]
  );
  const reason = reasons.find((r) => r.id === v.reason_id) ?? null;
  const level = lk?.recovery.find((r) => r.code === v.recovery_potential) ?? null;
  const needsDetails = Boolean(reason?.is_other || reason?.requires_note || cat?.code === "other");
  const compRequired = Boolean(cat?.requires_competitor);
  const compVisible = compRequired || showComp;
  const compProjects = (lk?.competitorProjects ?? []).filter((p) => p.competitor_id === v.competitor_id && p.is_active);

  function chooseCategory(id: string) {
    const c = lk?.categories.find((x) => x.id === id);
    setV((x) => ({
      ...x,
      category_id: id,
      reason_id: "",
      // المصدر المقترح يتبع الفئة ما لم يختر الموظف غيره بنفسه
      loss_source: sourceTouched ? x.loss_source : c?.default_source ?? x.loss_source,
    }));
  }

  function chooseRecovery(code: string) {
    const lv = lk?.recovery.find((r) => r.code === code);
    setV((x) => {
      const required = lv?.allows_recontact ? lv.recontact_required : false;
      return {
        ...x,
        recovery_potential: code,
        recontact_required: required,
        recontact_date: required && lv?.recontact_days ? addDays(baghdadToday(), lv.recontact_days) : lv?.allows_recontact ? x.recontact_date : "",
      };
    });
  }

  function chooseCompetitorProject(id: string) {
    const p = lk?.competitorProjects.find((x) => x.id === id);
    setV((x) => ({
      ...x,
      competitor_project_id: id,
      competitor_price_per_m2: x.competitor_price_per_m2 || (p?.price_per_m2 != null ? String(p.price_per_m2) : ""),
      competitor_payment_plan: x.competitor_payment_plan || (p?.payment_plan ?? ""),
    }));
  }

  // نفس شروط القاعدة — الزرّ يُطفأ حتى تكتمل، والقاعدة تبقى الحَكَم
  const problems: string[] = [];
  if (!v.category_id) problems.push(t.category);
  if (!v.reason_id) problems.push(t.reason);
  if (!v.loss_source) problems.push(t.lossSource);
  if (!v.customer_potential) problems.push(t.customerPotential);
  if (!v.recovery_potential) problems.push(t.recovery);
  if (needsDetails && v.details.trim().length < 10) problems.push(t.details);
  if (compRequired && !(compMode === "list" ? v.competitor_id : v.competitor_name.trim())) problems.push(t.competitor);
  if (v.recontact_required && !v.recontact_date) problems.push(t.recontactDate);
  if (mode === "edit" && needsEditReason && !editReason.trim()) problems.push(t.editReason);

  async function submit() {
    if (problems.length > 0) return;
    setBusy(true);
    setErr(null);
    const useComp = compVisible;
    const payload: Record<string, unknown> = {
      category_id: v.category_id,
      reason_id: v.reason_id,
      loss_source: v.loss_source,
      customer_potential: v.customer_potential,
      recovery_potential: v.recovery_potential,
      recontact_required: level?.allows_recontact ? v.recontact_required : false,
      recontact_date: level?.allows_recontact && v.recontact_required ? v.recontact_date : null,
      recovery_reason: v.recovery_reason.trim() || null,
      details: v.details.trim() || null,
      discount: v.discount || null,
      competitor_id: useComp && compMode === "list" ? v.competitor_id || null : null,
      competitor_project_id: useComp && compMode === "list" ? v.competitor_project_id || null : null,
      competitor_name: useComp && compMode === "other" ? v.competitor_name.trim() || null : null,
      competitor_price: useComp ? v.competitor_price || null : null,
      competitor_price_per_m2: useComp ? v.competitor_price_per_m2 || null : null,
      competitor_unit_m2: useComp ? v.competitor_unit_m2 || null : null,
      competitor_payment_plan: useComp ? v.competitor_payment_plan.trim() || null : null,
      competitor_advantage: useComp ? v.competitor_advantage.trim() || null : null,
      competitor_choice_reason: useComp ? v.competitor_choice_reason.trim() || null : null,
    };
    if (mode === "edit" && canEditValue && v.lost_value) payload.lost_value = v.lost_value;

    const { error } =
      mode === "create"
        ? await supabase.rpc("close_opportunity_lost", { p_opportunity_id: opportunityId, p: payload })
        : await supabase.rpc("update_lost_analysis", { p_id: lossId, p: payload, p_reason: editReason.trim() || null });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone?.();
    onClose();
  }

  const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-semibold text-gray-600";

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lost-dialog-title"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}
    >
      <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white text-start shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b bg-red-50 px-5 py-4">
          <div>
            <h2 id="lost-dialog-title" className="flex items-center gap-2 text-lg font-bold text-red-800">
              <span className="material-symbols-outlined text-[22px]">heart_broken</span>
              {mode === "create" ? t.dialogTitle : t.dialogEditTitle}
            </h2>
            <p className="mt-1 text-xs text-red-900/70">{t.dialogIntro}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-gray-500 hover:bg-white/60" aria-label={t.cancel}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {loadErr && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t.loadError}</p>}
          {!lk && !loadErr && <p className="py-10 text-center text-sm text-gray-400">{t.loading}</p>}

          {lk && (
            <>
              {/* ما يُلتقط تلقائياً */}
              {opp && mode === "create" && (
                <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.autoCaptured}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Chip label={t.customer} value={opp.client_name} />
                    <Chip label={t.stageNow} value={opp.stage_name} strong />
                    <Chip label={t.dealValue} value={opp.expected_value ? money(opp.expected_value, lang) : "—"} />
                    <Chip label={t.project} value={opp.project_name ?? "—"} />
                    <Chip label={t.owner} value={opp.owner_name ?? "—"} />
                  </div>
                </section>
              )}

              {/* A — الفئة */}
              <section>
                <span className={label}>{t.category} <Req t={t} /></span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {lk.categories.filter((c) => c.is_active || c.id === v.category_id).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => chooseCategory(c.id)}
                      aria-pressed={v.category_id === c.id}
                      className={
                        v.category_id === c.id
                          ? "rounded-lg border-2 border-red-600 bg-red-50 px-3 py-2 text-start text-sm font-semibold text-red-800"
                          : "rounded-lg border border-gray-200 px-3 py-2 text-start text-sm text-gray-700 transition hover:border-red-300"
                      }
                    >
                      {pick(c, lang)}
                    </button>
                  ))}
                </div>
              </section>

              {/* B — السبب الفرعي ومصدر الخسارة */}
              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="lost-reason">{t.reason} <Req t={t} /></label>
                  <select id="lost-reason" value={v.reason_id} disabled={!v.category_id} onChange={(e) => set("reason_id", e.target.value)} className={input}>
                    <option value="">{t.choose}</option>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>{lang === "en" ? r.name_en || r.name : r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="lost-source">{t.lossSource} <Req t={t} /></label>
                  <select
                    id="lost-source"
                    value={v.loss_source}
                    onChange={(e) => { setSourceTouched(true); set("loss_source", e.target.value); }}
                    className={input}
                  >
                    <option value="">{t.choose}</option>
                    {lk.sources.filter((s) => s.is_active || s.code === v.loss_source).map((s) => (
                      <option key={s.code} value={s.code}>{pick(s, lang)}</option>
                    ))}
                  </select>
                </div>
              </section>

              {/* C — جودة العميل والاسترجاع */}
              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className={label}>{t.customerPotential} <Req t={t} /></span>
                  <Segmented
                    options={lk.potentials.filter((p) => p.is_active || p.code === v.customer_potential).map((p) => ({ value: p.code, label: pick(p, lang), title: pick(p, lang) }))}
                    value={v.customer_potential}
                    onChange={(x) => set("customer_potential", x)}
                  />
                </div>
                <div>
                  <span className={label}>{t.recovery} <Req t={t} /></span>
                  <Segmented
                    options={lk.recovery.filter((r) => r.is_active || r.code === v.recovery_potential).map((r) => ({ value: r.code, label: pick(r, lang) }))}
                    value={v.recovery_potential}
                    onChange={chooseRecovery}
                  />
                </div>
              </section>

              {level?.allows_recontact && (
                <section className="grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 sm:grid-cols-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-1">
                    <input
                      type="checkbox"
                      checked={v.recontact_required}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setV((x) => ({
                          ...x,
                          recontact_required: on,
                          recontact_date: on && !x.recontact_date ? addDays(baghdadToday(), level.recontact_days ?? 30) : x.recontact_date,
                        }));
                      }}
                    />
                    {t.recontactRequired}
                  </label>
                  {v.recontact_required && (
                    <div>
                      <label className={label} htmlFor="lost-rc-date">{t.recontactDate} <Req t={t} /></label>
                      <input id="lost-rc-date" type="date" min={addDays(baghdadToday(), 1)} value={v.recontact_date}
                             onChange={(e) => set("recontact_date", e.target.value)} className={input} dir="ltr" />
                    </div>
                  )}
                  <div className={v.recontact_required ? "" : "sm:col-span-2"}>
                    <label className={label} htmlFor="lost-rc-reason">{t.recoveryReason}</label>
                    <input id="lost-rc-reason" value={v.recovery_reason} onChange={(e) => set("recovery_reason", e.target.value)} className={input} />
                  </div>
                </section>
              )}

              {/* D — المنافس */}
              {!compRequired && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={showComp} onChange={(e) => setShowComp(e.target.checked)} />
                  {t.showCompetitor}
                </label>
              )}
              {compVisible && (
                <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <p className="flex items-center gap-1 text-sm font-semibold text-amber-900">
                    <span className="material-symbols-outlined text-[18px]">swords</span>
                    {t.competitorSection} {compRequired && <Req t={t} />}
                  </p>
                  <div className="flex gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="radio" checked={compMode === "list"} onChange={() => setCompMode("list")} /> {t.competitorPick}
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" checked={compMode === "other"} onChange={() => setCompMode("other")} /> {t.competitorOther}
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {compMode === "list" ? (
                      <>
                        <div>
                          <label className={label} htmlFor="lost-comp">{t.competitor}</label>
                          <select id="lost-comp" value={v.competitor_id}
                                  onChange={(e) => setV((x) => ({ ...x, competitor_id: e.target.value, competitor_project_id: "" }))} className={input}>
                            <option value="">{t.choose}</option>
                            {lk.competitors.filter((c) => c.is_active || c.id === v.competitor_id).map((c) => (
                              <option key={c.id} value={c.id}>{lang === "en" ? c.name_en || c.name : c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={label} htmlFor="lost-comp-proj">{t.competitorProject}</label>
                          <select id="lost-comp-proj" value={v.competitor_project_id} disabled={!v.competitor_id}
                                  onChange={(e) => chooseCompetitorProject(e.target.value)} className={input}>
                            <option value="">{t.choose}</option>
                            {compProjects.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}{p.price_per_m2 ? ` · ${money(p.price_per_m2, lang)}/m²` : ""}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : (
                      <div className="sm:col-span-2">
                        <label className={label} htmlFor="lost-comp-name">{t.competitor}</label>
                        <input id="lost-comp-name" value={v.competitor_name} onChange={(e) => set("competitor_name", e.target.value)} className={input} />
                      </div>
                    )}
                    <NumField id="lost-cp" label={t.competitorPrice} value={v.competitor_price} onChange={(x) => set("competitor_price", x)} cls={input} lcls={label} />
                    <NumField id="lost-cpm" label={t.competitorPriceM2} value={v.competitor_price_per_m2} onChange={(x) => set("competitor_price_per_m2", x)} cls={input} lcls={label} />
                    <NumField id="lost-cu" label={t.competitorUnit} value={v.competitor_unit_m2} onChange={(x) => set("competitor_unit_m2", x)} cls={input} lcls={label} />
                    <div>
                      <label className={label} htmlFor="lost-cplan">{t.competitorPlan}</label>
                      <input id="lost-cplan" value={v.competitor_payment_plan} onChange={(e) => set("competitor_payment_plan", e.target.value)} className={input} />
                    </div>
                    <div>
                      <label className={label} htmlFor="lost-cadv">{t.competitorAdvantage}</label>
                      <input id="lost-cadv" value={v.competitor_advantage} onChange={(e) => set("competitor_advantage", e.target.value)} className={input} />
                    </div>
                    <div>
                      <label className={label} htmlFor="lost-cwhy">{t.competitorChoice}</label>
                      <input id="lost-cwhy" value={v.competitor_choice_reason} onChange={(e) => set("competitor_choice_reason", e.target.value)} className={input} />
                    </div>
                  </div>
                </section>
              )}

              {/* E — التفاصيل والخصم */}
              <section className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="lost-details">
                    {t.details} {needsDetails && <Req t={t} />}
                  </label>
                  <textarea id="lost-details" rows={4} value={v.details} onChange={(e) => set("details", e.target.value)}
                            placeholder={t.detailsHint} className={input} />
                  {needsDetails && v.details.trim().length < 10 && (
                    <p className="mt-1 text-[11px] text-red-600">{t.detailsRequired}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <NumField id="lost-disc" label={t.discount} value={v.discount} onChange={(x) => set("discount", x)} cls={input} lcls={label} />
                  {mode === "edit" && canEditValue && (
                    <NumField id="lost-val" label={t.lostValue} value={v.lost_value} onChange={(x) => set("lost_value", x)} cls={input} lcls={label} />
                  )}
                </div>
              </section>

              {mode === "edit" && needsEditReason && (
                <section>
                  <label className={label} htmlFor="lost-edit-reason">{t.editReason} <Req t={t} /></label>
                  <input id="lost-edit-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} className={input} />
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t bg-gray-50 px-5 py-3">
          {err && <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          {lk && problems.length > 0 && (
            <p className="text-xs text-gray-500">{t.required}: {problems.join(" · ")}</p>
          )}
          <div className="ms-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
              {t.cancel}
            </button>
            <button type="button" onClick={submit} disabled={busy || !lk || problems.length > 0}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-50">
              {busy ? t.saving : mode === "create" ? t.save : t.saveEdit}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Req({ t }: { t: { required: string } }) {
  return <span className="text-red-600" title={t.required}>*</span>;
}

function Chip({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="rounded-lg border border-gray-200 bg-white px-2 py-1">
      <span className="text-gray-400">{label}: </span>
      <b className={strong ? "text-red-700" : "text-gray-800"}>{value}</b>
    </span>
  );
}

function Segmented({
  options, value, onChange, short,
}: { options: { value: string; label: string; title?: string }[]; value: string; onChange: (v: string) => void; short?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={
            value === o.value
              ? "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-500"
          }
        >
          {short ? o.value : o.label}
        </button>
      ))}
    </div>
  );
}

function NumField({
  id, label, value, onChange, cls, lcls,
}: { id: string; label: string; value: string; onChange: (v: string) => void; cls: string; lcls: string }) {
  return (
    <div>
      <label className={lcls} htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} inputMode="decimal" dir="ltr" value={value}
             onChange={(e) => onChange(e.target.value)} className={cls} />
    </div>
  );
}
