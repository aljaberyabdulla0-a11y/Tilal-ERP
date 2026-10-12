import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { getStages, getProjectsLite, type ProjectLite } from "@/lib/crm";
import {
  getOpportunityDetail, getOpportunityExtras, getOpportunityLosses, getLostChanges,
  type OppTimelineItem,
} from "@/lib/lost-sales";
import { lostDict, money, outcomeLabel, type Lang } from "@/lib/lost-sales-i18n";
import { daysInStage } from "@/lib/crm-journey";
import LostAnalysisPanel from "@/components/lost-sale/lost-analysis-panel";
import SalesHistory from "@/components/lost-sale/sales-history";
import RelatedTasks from "@/components/tasks/related-tasks";
import NewJourney from "./new-journey";
import JourneyStage from "./journey-stage";

// ============================================================
// تبويب «المسار» في ملفّ العميل — رحلة البيع كاملة من البطاقة (201).
//
// كان كلّ هذا في صفحة «الفرصة» المستقلة: النظرة، والتسلسل، والمهامّ،
// وتحليل الخسارة. الآن هنا: الموظف لا يغادر ملفّ عميله ليتابع.
//   • المسار الحالي افتراضاً؛ ولعميلٍ بمسارين (شراء ثانٍ) اختيارٌ بينهما.
//   • التسلسل: كل انتقال بمصدره (مستخدم/حجز/نموذج/جماعي) وسببه.
//   • الخسائر وقائع مستقلة — الأولى تبقى «أُعيد تنشيطها» بعد الثانية.
// ============================================================

const SOURCE_LABEL: Record<string, string> = {
  created: "إنشاء", user: "يدوي", bulk: "جماعي", reservation: "حجز", lost_form: "نموذج الخسارة",
  reactivation: "إعادة تنشيط", merge: "دمج", system: "النظام", import: "استيراد",
  migration: "مستنتَج", legacy: "قبل 201",
};

const KIND_STYLE: Record<OppTimelineItem["kind"], string> = {
  created: "bg-gray-500", stage: "bg-indigo-500", lost: "bg-red-600",
  reactivated: "bg-amber-500", recovered: "bg-emerald-600", activity: "bg-brand-600",
};
const KIND_ICON: Record<OppTimelineItem["kind"], string> = {
  created: "add", stage: "swap_horiz", lost: "heart_broken",
  reactivated: "restart_alt", recovered: "verified", activity: "chat",
};

export default async function JourneyPanel({
  clientId,
  journeys,
  currentJourneyId,
  selectedJourneyId,
  analyse,
  canWrite,
  isManager,
  isAdmin,
  defaultProjectId,
}: {
  clientId: string;
  journeys: { id: string; project_name: string | null; stage_name: string; stage_type: string; created_at: string }[];
  currentJourneyId: string | null;
  selectedJourneyId?: string | null;
  analyse?: string | null;
  canWrite: boolean;
  isManager: boolean;
  isAdmin: boolean;
  defaultProjectId?: string | null;
}) {
  const lang = getLocale() as Lang;
  const t = lostDict(lang);

  const jid =
    (selectedJourneyId && journeys.some((j) => j.id === selectedJourneyId) ? selectedJourneyId : null) ??
    currentJourneyId ?? journeys[0]?.id ?? null;

  const projects: ProjectLite[] = canWrite ? await getProjectsLite() : [];

  if (!jid) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          لا مسار لهذا العميل بعد — يُنشأ تلقائياً عند أول نقل مرحلة.
        </p>
      </div>
    );
  }

  const [opp, extras, losses, changes, stages] = await Promise.all([
    getOpportunityDetail(jid),
    getOpportunityExtras(jid),
    getOpportunityLosses(jid),
    getLostChanges(jid),
    getStages(),
  ]);
  if (!opp) return <p className="text-sm text-gray-500">المسار غير متاح.</p>;

  const stageColor = stages.find((s) => s.id === opp.stage_id)?.color ?? "bg-gray-100 text-gray-700";
  const unit = extras.opp?.units as { unit_code: string; space_m2: number | null } | null;
  const enteredAt = extras.history.filter((h) => h.to_stage === opp.stage_name).at(-1)?.at ?? null;
  const age = daysInStage(enteredAt);

  // التسلسل: الانتقالات بمصادرها، والخسائر، والتنشيط، والتواصل المربوط — بترتيب وقوعها
  const timeline: (OppTimelineItem & { source?: string | null })[] = [
    ...extras.history.map((h) => ({
      at: h.at,
      kind: (h.from_stage === null ? "created" : "stage") as OppTimelineItem["kind"],
      title: h.from_stage === null
        ? `${lang === "en" ? "Entered" : "دخل"} ${tValue(h.to_stage, lang)}`
        : `${tValue(h.from_stage, lang)} ← ${tValue(h.to_stage, lang)}`,
      detail: [h.days_in_from !== null ? `${h.days_in_from} ${t.days}` : null, h.note].filter(Boolean).join(" · ") || null,
      actor: h.changed_by_name,
      source: h.change_source ?? null,
    })),
    ...losses.map((l) => ({
      at: l.lost_at, kind: "lost" as const,
      title: `${t.lossNo} ${l.loss_no}${l.lost_stage_name ? ` — ${lang === "en" ? "lost at" : "خُسرت في"} ${tValue(l.lost_stage_name, lang)}` : ""}`,
      detail: [lang === "en" ? l.category_name_en : l.category_name_ar, lang === "en" ? l.reason_name_en : l.reason_name_ar].filter(Boolean).join(" / ") || null,
      actor: l.lost_by_name,
    })),
    ...losses.filter((l) => l.reactivated_at).map((l) => ({
      at: l.reactivated_at as string,
      kind: (l.outcome === "recovered" ? "recovered" : "reactivated") as OppTimelineItem["kind"],
      title: outcomeLabel(l.outcome === "relost" ? "reactivated" : l.outcome, lang),
      detail: l.reactivation_note, actor: l.reactivated_by_name,
    })),
    ...extras.activities
      .filter((a) => !["تغيير مرحلة", "تحليل خسارة", "إعادة تنشيط"].includes(a.activity_type))
      .map((a) => ({ at: a.occurred_at, kind: "activity" as const, title: tValue(a.activity_type, lang), detail: a.summary, actor: a.actor_name })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const isCurrent = jid === currentJourneyId;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* أكثر من مسار: اختيار بينها — الحالي أولاً */}
      {journeys.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="مسارات العميل">
          {journeys.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/clients/${clientId}?tab=journey&journey=${j.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${j.id === jid ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              {j.project_name ?? "بلا مشروع"} · {tValue(j.stage_name, lang)}
              {j.id === currentJourneyId ? " (الحالي)" : ""}
            </Link>
          ))}
        </nav>
      )}

      {/* المسار: أين هو الآن ومنذ متى */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${stageColor}`}>{tValue(opp.stage_name, lang)}</span>
          {age !== null && <span className="text-sm text-gray-500">منذ {age} يوم في المرحلة</span>}
          {losses.some((l) => l.outcome === "recovered") && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{outcomeLabel("recovered", lang)}</span>
          )}
          {canWrite && !isCurrent && (
            <span className="ms-auto">
              <JourneyStage
                clientId={clientId}
                journeyId={jid}
                stageId={opp.stage_id}
                isAdmin={isAdmin}
                stages={stages.filter((s) => s.is_active || s.id === opp.stage_id)}
              />
            </span>
          )}
        </div>
        {isCurrent && (
          <p className="mt-2 text-xs text-gray-400">تُنقل مرحلة المسار الحالي من شريط الحالة أعلى الملفّ.</p>
        )}
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t.project} value={opp.project_name ?? "—"} />
          <Info label={t.unitInfo} value={unit ? `${unit.unit_code}${unit.space_m2 ? ` · ${unit.space_m2} m²` : ""}` : "—"} />
          <Info label={t.dealValue} value={money(opp.expected_value, lang)} />
          {opp.stage_type === "won" && (
            <Info label={lang === "en" ? "Tilal revenue (commission)" : "إيراد تلال (العمولة)"}
                  value={opp.won_value === null ? (lang === "en" ? "No commission recorded" : "لا عمولة مسجّلة") : money(opp.won_value, lang)} />
          )}
          <Info label={t.owner} value={opp.owner_name ?? "—"} />
          <Info label={t.source} value={opp.source_name ?? "—"} />
          <Info label={t.campaign} value={extras.opp?.crm_campaigns?.name ?? "—"} />
          <Info label={lang === "en" ? "Started" : "بدأ"} value={<span dir="ltr">{opp.created_at.slice(0, 10)}</span>} />
          <Info label={lang === "en" ? "Closed" : "أُغلق"} value={opp.closed_at ? <span dir="ltr">{opp.closed_at.slice(0, 10)}</span> : "—"} />
          <Info label={t.nextActionDate} value={opp.next_action_date ? <span dir="ltr">{opp.next_action_date}</span> : "—"} />
        </dl>
      </section>

      {/* تحليل الخسارة — وقائع مستقلة، والاستمارة تُفتح من هنا (مهامّ 175) */}
      {(losses.length > 0 || opp.stage_type === "lost") && (
        <section id="lost">
          <h3 className="mb-2 font-semibold text-gray-800">{t.lostAnalysis}</h3>
          <LostAnalysisPanel
            opportunityId={jid}
            losses={losses}
            changes={changes}
            canWrite={canWrite}
            isManager={isManager}
            isLostNow={opp.stage_type === "lost"}
            autoAnalyse={analyse ?? null}
          />
        </section>
      )}

      {/* التسلسل */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-800">{t.timeline}</h3>
        <ol className="space-y-0 border-s-2 border-gray-200 ps-5">
          {timeline.map((e, i) => (
            <li key={i} className="relative pb-5">
              <span className={`absolute -start-[29px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-white ${KIND_STYLE[e.kind]}`}>
                <span className="material-symbols-outlined text-[14px]">{KIND_ICON[e.kind]}</span>
              </span>
              <p className="text-sm font-semibold text-gray-800">
                {e.title}
                {"source" in e && e.source && (
                  <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                )}
              </p>
              {e.detail && <p className="text-sm text-gray-600">{e.detail}</p>}
              <p className="text-xs text-gray-400">
                <span dir="ltr">{e.at.slice(0, 16).replace("T", " ")}</span>{e.actor ? ` · ${e.actor}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <RelatedTasks entityType="opportunity" entityId={jid} variant="sales" />

      {/* تاريخ مبيعات العميل: كل مسار بنتيجته — العميل لا يُوسم «خاسراً» */}
      <SalesHistory clientId={clientId} />

      {canWrite && <NewJourney clientId={clientId} projects={projects} defaultProjectId={defaultProjectId} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  );
}
