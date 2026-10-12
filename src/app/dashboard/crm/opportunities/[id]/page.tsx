import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// صفحة «الفرصة» صارت تبويب «المسار» في ملفّ العميل (201).
//
// كل ما كان هنا — النظرة، والتسلسل، والمهامّ، وتحليل الخسارة — هناك،
// والموظف لا يغادر ملفّ عميله ليتابع. والرابط يبقى يعمل: إشعارٌ قديم
// أو مهمة «استمارة فشل البيع» (?tab=lost&analyse=) تقود إلى المسار نفسه
// في ملفّ عميله، والاستمارة تُفتح كما كانت.
// ============================================================
export default async function OpportunityRedirect({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; analyse?: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase.from("opportunities").select("client_id").eq("id", params.id).maybeSingle();
  const clientId = (data as { client_id?: string } | null)?.client_id;
  if (!clientId) notFound();

  const q = new URLSearchParams({ tab: "journey", journey: params.id });
  if (searchParams.analyse) q.set("analyse", searchParams.analyse);
  redirect(`/dashboard/clients/${clientId}?${q.toString()}#lost`);
}
