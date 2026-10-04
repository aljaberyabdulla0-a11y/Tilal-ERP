"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import {
  lostDict, money, milestoneLabel, outcomeLabel, outcomeStyle, reviewLabel, reviewStyle,
  basisLabel, fieldLabel, type Lang,
} from "@/lib/lost-sales-i18n";
import type { LostSaleRow, LostChange } from "@/lib/lost-sales";
import LostSaleDialog, { type LostFormValues } from "./lost-sale-dialog";
import ReactivateDialog from "./reactivate-dialog";

// ============================================================
// تبويب «تحليل الخسارة» في صفحة الفرصة.
//
// كل خسارة بطاقة — الأحدث أولاً. فرصةٌ خُسرت ثم نُشّطت ثم رُبحت تُظهر
// خسارتها الأولى «استُرجعت» بسببها وتاريخها: هكذا نعرف ما استرجعناه.
//
// الأزرار تظهر لمن يُحتمل أن يملكها، والقاعدة تقرّر: الموظف يعدّل
// خسارته خلال المهلة، والمشرف فريقه دائماً، والمراجعة للمشرف وحده.
// ============================================================

function toForm(l: LostSaleRow): Partial<LostFormValues> {
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  return {
    category_id: s(l.category_id), reason_id: s(l.reason_id), loss_source: s(l.loss_source),
    customer_potential: s(l.customer_potential), recovery_potential: s(l.recovery_potential),
    recontact_required: l.recontact_required, recontact_date: s(l.recontact_date),
    recovery_reason: s(l.recovery_reason), details: s(l.details), discount: s(l.discount),
    competitor_id: s(l.competitor_id), competitor_project_id: s(l.competitor_project_id),
    competitor_name: s(l.competitor_name), competitor_price: s(l.competitor_price),
    competitor_price_per_m2: s(l.competitor_price_per_m2), competitor_unit_m2: s(l.competitor_unit_m2),
    competitor_payment_plan: s(l.competitor_payment_plan), competitor_advantage: s(l.competitor_advantage),
    competitor_choice_reason: s(l.competitor_choice_reason), lost_value: s(l.lost_value),
  };
}

export default function LostAnalysisPanel({
  opportunityId,
  losses,
  changes,
  canWrite,
  isManager,
  isLostNow,
}: {
  opportunityId: string;
  losses: LostSaleRow[];
  changes: LostChange[];
  canWrite: boolean;
  isManager: boolean;
  isLostNow: boolean;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const lang = locale as Lang;
  const t = lostDict(lang);
  const [editing, setEditing] = useState<LostSaleRow | null>(null);
  const [reactivating, setReactivating] = useState(false);

  const name = (ar: string | null, en: string | null) => (lang === "en" ? en || ar : ar || en) ?? "—";

  if (losses.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">{t.empty}</p>;
  }

  return (
    <div className="space-y-5">
      {isLostNow && canWrite && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setReactivating(true)}
                  className="flex items-center gap-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
            {t.reactivate}
          </button>
        </div>
      )}

      {losses.map((l) => (
        <article key={l.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-4 py-3">
            <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-bold text-white">{t.lossNo} {l.loss_no}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${outcomeStyle(l.outcome)}`}>{outcomeLabel(l.outcome, lang)}</span>
            {!l.needs_analysis && (
              <span className={`rounded px-2 py-0.5 text-xs ${reviewStyle(l.review_status)}`}>{reviewLabel(l.review_status, lang)}</span>
            )}
            <span className="text-sm text-gray-600" dir="ltr">{l.lost_at.slice(0, 10)}</span>
            {l.lost_stage_name && (
              <span className="text-sm text-gray-700">
                {lang === "en" ? "Lost at " : "خُسرت في «"}<b>{l.lost_stage_name}</b>{lang === "en" ? " stage" : "»"}
              </span>
            )}
            <div className="ms-auto flex gap-2">
              {canWrite && l.needs_analysis && (
                <button type="button" onClick={() => setEditing(l)}
                        className="rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800">{t.analyse}</button>
              )}
              {canWrite && !l.needs_analysis && (l.outcome === "lost" || isManager) && (
                <button type="button" onClick={() => setEditing(l)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:border-brand-500">{t.edit}</button>
              )}
            </div>
          </header>

          {l.needs_analysis && (
            <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">{t.needsAnalysis}</p>
          )}

          <div className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t.category} value={name(l.category_name_ar, l.category_name_en)} strong />
            <Field label={t.reason} value={name(l.reason_name_ar, l.reason_name_en)} strong />
            <Field label={t.lossSource} value={name(l.loss_source_name_ar, l.loss_source_name_en)} />
            <Field label={t.customerPotential} value={name(l.customer_potential_name_ar, l.customer_potential_name_en)} />
            <Field label={t.recovery} value={name(l.recovery_name_ar, l.recovery_name_en)} />
            <Field label={t.recontactDate} value={l.recontact_required ? <span dir="ltr">{l.recontact_date}</span> : "—"} />
            <Field label={t.lostValue.replace(/ \(.*\)/, "")}
                   value={<>{money(l.lost_value, lang)} <span className="text-xs text-gray-400">({basisLabel(l.value_basis, lang)})</span></>} strong />
            <Field label={t.discount} value={money(l.discount, lang)} />
            <Field label={t.milestone} value={milestoneLabel(l.furthest_milestone, lang)} />
            <Field label={t.owner} value={l.owner_name ?? "—"} />
            <Field label={t.manager} value={l.manager_name ?? "—"} />
            <Field label={t.lostBy} value={l.lost_by_name ?? "—"} />
            <Field label={t.project} value={[l.project_name, l.unit_code].filter(Boolean).join(" / ") || "—"} />
            <Field label={t.area} value={l.area_m2 ? `${money(l.area_m2, lang)} m²` : "—"} />
            <Field label={t.pricePerM2} value={money(l.price_per_m2, lang)} />
            <Field label={t.paymentPlan} value={l.payment_plan ?? "—"} />
            <Field label={t.expectedRevenue} value={money(l.expected_revenue, lang)} />
            <Field label={t.expectedCommission} value={money(l.expected_commission, lang)} />
            <Field label={t.source} value={l.source_name ?? "—"} />
            <Field label={t.campaign} value={l.campaign_name ?? "—"} />
            <Field label={t.daysInPipeline} value={l.days_in_pipeline ?? "—"} />
          </div>

          {(l.competitor_display_name || l.competitor_price_per_m2) && (
            <div className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
              <p className="mb-2 font-semibold text-amber-900">{t.competitorSection}</p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                <Field label={t.competitor} value={l.competitor_display_name ?? "—"} strong />
                <Field label={t.competitorProject} value={l.competitor_project_name ?? "—"} />
                <Field label={t.competitorPriceM2}
                       value={l.competitor_price_per_m2
                         ? <>{money(l.competitor_price_per_m2, lang)}{l.price_per_m2 ? <span className="text-xs text-gray-500"> · {lang === "en" ? "ours" : "عندنا"} {money(l.price_per_m2, lang)}</span> : null}</>
                         : "—"} />
                <Field label={t.competitorPrice} value={money(l.competitor_price, lang)} />
                <Field label={t.competitorUnit} value={l.competitor_unit_m2 ? `${l.competitor_unit_m2} m²` : "—"} />
                <Field label={t.competitorPlan} value={l.competitor_payment_plan ?? "—"} />
                <Field label={t.competitorAdvantage} value={l.competitor_advantage ?? "—"} />
                <Field label={t.competitorChoice} value={l.competitor_choice_reason ?? "—"} />
              </div>
            </div>
          )}

          <div className="mx-4 mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label={t.contacts} value={l.contacts_count} />
            <Stat label={t.meetings} value={l.meetings_count} />
            <Stat label={t.visits} value={l.visits_count} />
            <Stat label={t.offers} value={l.offers_count} />
          </div>

          {(l.details || l.recovery_reason) && (
            <div className="mx-4 mb-4 space-y-2 text-sm">
              {l.details && (
                <div>
                  <p className="text-xs text-gray-500">{t.details}</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-gray-800">{l.details}</p>
                </div>
              )}
              {l.recovery_reason && (
                <p className="text-xs text-gray-600"><b>{t.recoveryReason}</b> {l.recovery_reason}</p>
              )}
            </div>
          )}

          {(l.reactivated_at || l.review_note) && (
            <div className="mx-4 mb-4 space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
              {l.reactivated_at && (
                <p>
                  <b>{outcomeLabel(l.outcome, lang)}</b> · <span dir="ltr">{l.reactivated_at.slice(0, 10)}</span> · {l.reactivated_by_name}
                  {l.reactivation_note && <> — {l.reactivation_note}</>}
                  {l.recovered_value ? <> · {money(l.recovered_value, lang)}</> : null}
                </p>
              )}
              {l.review_note && (
                <p><b>{t.review}:</b> {l.review_note} — {l.reviewed_by_name}</p>
              )}
            </div>
          )}

          {isManager && !l.needs_analysis && <ReviewBar lossId={l.id} onDone={() => router.refresh()} t={t} />}
        </article>
      ))}

      {/* سجلّ التعديلات — لا تغيير بلا أثر */}
      <section className="rounded-2xl border border-gray-200 bg-white">
        <h3 className="border-b px-4 py-3 font-semibold text-gray-800">{t.changes}</h3>
        {changes.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400">{t.noChanges}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <tbody className="divide-y divide-gray-100">
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500" dir="ltr">{c.changed_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-2 font-medium text-gray-700">{c.changed_by_name}</td>
                    <td className="px-4 py-2 text-gray-800">{fieldLabel(c.field, lang)}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-red-700 line-through" title={c.old_value ?? ""}>{c.field === "__deleted" ? "—" : c.old_value ?? "—"}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-emerald-700" title={c.new_value ?? ""}>{c.new_value ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{c.edit_reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <LostSaleDialog
          opportunityId={opportunityId}
          mode="edit"
          lossId={editing.id}
          initial={toForm(editing)}
          canEditValue={isManager}
          needsEditReason={!editing.needs_analysis}
          onClose={() => setEditing(null)}
          onDone={() => router.refresh()}
        />
      )}
      {reactivating && (
        <ReactivateDialog opportunityId={opportunityId} onClose={() => setReactivating(false)} onDone={() => router.refresh()} />
      )}
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={strong ? "font-semibold text-gray-900" : "text-gray-800"}>{value ?? "—"}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-center">
      <p className="text-lg font-bold text-gray-800">{value ?? 0}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  );
}

function ReviewBar({ lossId, onDone, t }: { lossId: string; onDone: () => void; t: ReturnType<typeof lostDict> }) {
  const supabase = createClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function review(status: "confirmed" | "disputed") {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("review_lost_sale", { p_id: lossId, p_status: status, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setNote("");
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-gray-50 px-4 py-3">
      <span className="text-xs font-semibold text-gray-600">{t.review}</span>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.reviewNote}
             className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <button type="button" disabled={busy} onClick={() => review("confirmed")}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t.confirm}</button>
      <button type="button" disabled={busy || !note.trim()} onClick={() => review("disputed")}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">{t.dispute}</button>
      {err && <p className="w-full text-xs text-red-700">{err}</p>}
    </div>
  );
}
