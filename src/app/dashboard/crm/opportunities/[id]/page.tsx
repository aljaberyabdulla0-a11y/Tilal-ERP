import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { getOpportunityLosses, getLostChanges } from "@/lib/lost-sales";
import { lostDict, type Lang } from "@/lib/lost-sales-i18n";
import LostAnalysisPanel from "@/components/lost-sale/lost-analysis-panel";

// ============================================================
// صفحة «الفرصة» صارت تبويب «المسار» في ملفّ العميل (201).
//
// كل ما كان هنا — النظرة، والتسلسل، والمهامّ، وتحليل الخسارة — هناك،
// والموظف لا يغادر ملفّ عميله ليتابع. والرابط يبقى يعمل: إشعارٌ قديم
// أو مهمة «استمارة فشل البيع» (?tab=lost&analyse=) تقود إلى المسار نفسه
// في ملفّ عميله، والاستمارة تُفتح كما كانت.
//
// (222) إلا لمن خسر العميل ثم انتقلت بطاقته لغيره: لا يرى البطاقة
// (219) لكن الخسارة خسارته واستمارتها عنده — فتُعرض له هنا وحدها،
// بلا إعادة تنشيط ولا شيء من ملفّ العميل.
// ============================================================
export default async function OpportunityRedirect({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; analyse?: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase.from("opportunities").select("client_id, title").eq("id", params.id).maybeSingle();
  const opp = data as { client_id: string; title: string | null } | null;
  if (!opp?.client_id) notFound();

  const { data: card } = await supabase.from("clients").select("id").eq("id", opp.client_id).maybeSingle();
  if (card) {
    const q = new URLSearchParams({ tab: "journey", journey: params.id });
    if (searchParams.analyse) q.set("analyse", searchParams.analyse);
    redirect(`/dashboard/clients/${opp.client_id}?${q.toString()}#lost`);
  }

  const [losses, changes] = await Promise.all([getOpportunityLosses(params.id), getLostChanges(params.id)]);
  if (losses.length === 0) notFound();

  const lang = getLocale() as Lang;
  const t = lostDict(lang);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t.lostAnalysis}</h1>
        <p className="mt-1 text-sm text-gray-500">{opp.title ?? "—"}</p>
      </div>
      <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
        {lang === "en"
          ? "This client's card has moved to a colleague, but the loss is yours — complete its analysis here."
          : "بطاقة هذا العميل انتقلت لزميل، لكن الخسارة خسارتك — أكمل تحليلها من هنا."}
      </p>
      <LostAnalysisPanel
        opportunityId={params.id}
        losses={losses}
        changes={changes}
        canWrite
        isManager={false}
        isLostNow={false}
        autoAnalyse={searchParams.analyse ?? null}
      />
    </div>
  );
}
