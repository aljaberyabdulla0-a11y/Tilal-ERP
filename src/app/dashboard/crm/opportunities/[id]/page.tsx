import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canWriteCrm, getUserRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { getStages } from "@/lib/crm";
import {
  getOpportunityDetail, getOpportunityExtras, getOpportunityLosses, getLostChanges, type OppTimelineItem,
} from "@/lib/lost-sales";
import { lostDict, money, outcomeLabel, type Lang } from "@/lib/lost-sales-i18n";
import ClientTabs, { type ClientTab } from "@/app/dashboard/clients/[id]/client-tabs";
import OpportunityStage from "../opportunity-stage";
import LostAnalysisPanel from "@/components/lost-sale/lost-analysis-panel";

// ============================================================
// صفحة الفرصة — الصفقة ككيان (072)، وتحليل خسارتها جزءٌ أصيل منها.
//
// ثلاثة تبويبات: نظرة (ما هي الصفقة الآن)، التسلسل (كل ما جرى عليها
// بترتيبه: مراحل، خسائر، تنشيط، تواصل)، و«تحليل الخسارة» — يظهر لفرصة
// خاسرة أو لها خسارة سابقة، فالمسترجعة تبقى تحمل لماذا خُسرت أولاً.
// ============================================================
export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; analyse?: string };
}) {
  const role = await getUserRole();
  if (role === "marketing" || role === "broker" || role === "accountant") redirect("/dashboard/crm/overview");

  const lang = getLocale() as Lang;
  const t = lostDict(lang);

  const opp = await getOpportunityDetail(params.id);
  if (!opp) notFound();

  const [extras, losses, changes, stages, canWrite] = await Promise.all([
    getOpportunityExtras(opp.id),
    getOpportunityLosses(opp.id),
    getLostChanges(opp.id),
    getStages(),
    canWriteCrm(),
  ]);
  const isManager = role === "admin" || role === "followup_manager" || role === "supervisor";
  const stageColor = stages.find((s) => s.id === opp.stage_id)?.color ?? "bg-gray-100 text-gray-700";
  const unit = extras.opp?.units as { unit_code: string; space_m2: number | null; price: number | null; unit_type: string | null } | null;

  // التسلسل: المراحل والخسائر والتواصل المربوط بالفرصة — بترتيب وقوعها
  const timeline: OppTimelineItem[] = [
    { at: opp.created_at, kind: "created" as const, title: lang === "en" ? "Opportunity created" : "أُنشئت الفرصة", detail: null, actor: extras.opp?.created_by_name ?? null },
    ...extras.history.filter((h) => h.from_stage !== null).map((h) => ({
      at: h.at, kind: "stage" as const,
      title: `${tValue(h.from_stage, lang)} ← ${tValue(h.to_stage, lang)}`,
      detail: h.days_in_from !== null ? `${h.days_in_from} ${t.days}${h.note ? ` · ${h.note}` : ""}` : h.note,
      actor: h.changed_by_name,
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
      .filter((a) => a.activity_type !== "تغيير مرحلة" && a.activity_type !== "تحليل خسارة" && a.activity_type !== "إعادة تنشيط")
      .map((a) => ({ at: a.occurred_at, kind: "activity" as const, title: tValue(a.activity_type, lang), detail: a.summary, actor: a.actor_name })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const tabs: ClientTab[] = [
    {
      key: "overview",
      label: t.overview,
      icon: "dashboard",
      content: (
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="grid gap-x-8 gap-y-3 rounded-2xl bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label={t.customer} value={<Link href={`/dashboard/clients/${opp.client_id}`} className="text-brand-600 hover:underline">{opp.client_name}</Link>} />
            <Info label={t.project} value={opp.project_name ?? "—"} />
            <Info label={t.unitInfo} value={unit ? `${unit.unit_code}${unit.space_m2 ? ` · ${unit.space_m2} m²` : ""}` : "—"} />
            <Info label={t.dealValue} value={money(opp.stage_type === "won" ? opp.won_value ?? opp.expected_value : opp.expected_value, lang)} />
            <Info label={t.owner} value={opp.owner_name ?? "—"} />
            <Info label={t.source} value={opp.source_name ?? "—"} />
            <Info label={t.campaign} value={extras.opp?.crm_campaigns?.name ?? "—"} />
            <Info label={t.paymentPlan} value={extras.opp?.payment_method ?? "—"} />
            <Info label={lang === "en" ? "Probability" : "الاحتمال"} value={opp.probability !== null ? `${opp.probability}%` : "—"} />
            <Info label={lang === "en" ? "Created" : "أُنشئت"} value={<span dir="ltr">{opp.created_at.slice(0, 10)}</span>} />
            <Info label={lang === "en" ? "Closed" : "أُغلقت"} value={opp.closed_at ? <span dir="ltr">{opp.closed_at.slice(0, 10)}</span> : "—"} />
            <Info label={t.nextActionDate} value={opp.next_action_date ? <span dir="ltr">{opp.next_action_date}</span> : "—"} />
          </div>
          {canWrite && stages.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <span className="text-sm text-gray-600">{lang === "en" ? "Change stage" : "تغيير المرحلة"}</span>
              <OpportunityStage id={opp.id} stageId={opp.stage_id} stages={stages.filter((s) => s.is_active || s.id === opp.stage_id)} />
            </div>
          )}
          {extras.opp?.notes && (
            <p className="whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm text-gray-700 shadow-sm">{extras.opp.notes}</p>
          )}
        </div>
      ),
    },
    {
      key: "timeline",
      label: t.timeline,
      icon: "timeline",
      badge: timeline.length,
      content: (
        <ol className="mx-auto max-w-3xl space-y-0 border-s-2 border-gray-200 ps-5">
          {timeline.map((e, i) => (
            <li key={i} className="relative pb-5">
              <span className={`absolute -start-[29px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-white ${KIND_STYLE[e.kind]}`}>
                <span className="material-symbols-outlined text-[14px]">{KIND_ICON[e.kind]}</span>
              </span>
              <p className="text-sm font-semibold text-gray-800">{e.title}</p>
              {e.detail && <p className="text-sm text-gray-600">{e.detail}</p>}
              <p className="text-xs text-gray-400">
                <span dir="ltr">{e.at.slice(0, 16).replace("T", " ")}</span>{e.actor ? ` · ${e.actor}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ),
    },
  ];

  if (losses.length > 0 || opp.stage_type === "lost") {
    tabs.push({
      key: "lost",
      label: t.lostAnalysis,
      icon: "heart_broken",
      badge: losses.length,
      content: (
        <div className="mx-auto max-w-5xl">
          <LostAnalysisPanel
            opportunityId={opp.id}
            losses={losses}
            changes={changes}
            canWrite={canWrite}
            isManager={isManager}
            isLostNow={opp.stage_type === "lost"}
            autoAnalyse={searchParams.analyse ?? null}
          />
        </div>
      ),
    });
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/crm/opportunities" className="text-sm text-gray-500 hover:text-brand-700">
          {lang === "en" ? "← Opportunities" : "← الفرص"}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">{extras.opp?.title ?? opp.client_name}</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${stageColor}`}>{tValue(opp.stage_name, lang)}</span>
        {losses.some((l) => l.outcome === "recovered") && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{outcomeLabel("recovered", lang)}</span>
        )}
      </header>
      <ClientTabs initial={searchParams.tab ?? (opp.stage_type === "lost" ? "lost" : undefined)} tabs={tabs} />
    </main>
  );
}

const KIND_STYLE: Record<OppTimelineItem["kind"], string> = {
  created: "bg-gray-500",
  stage: "bg-indigo-500",
  lost: "bg-red-600",
  reactivated: "bg-amber-500",
  recovered: "bg-emerald-600",
  activity: "bg-brand-600",
};
const KIND_ICON: Record<OppTimelineItem["kind"], string> = {
  created: "add",
  stage: "swap_horiz",
  lost: "heart_broken",
  reactivated: "restart_alt",
  recovered: "verified",
  activity: "chat",
};

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-gray-800">{value}</p>
    </div>
  );
}
