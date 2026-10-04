import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAudiences, getChannels, getMktProjects, getPeople } from "@/lib/marketing";
import RecordForm from "@/components/marketing/record-form";
import { PageHead } from "@/components/marketing/ui";
import { campaignFields } from "../fields";

export default async function NewCampaign() {
  await requireMktRead();
  if (!(await canWriteMarketing())) redirect("/dashboard/marketing/campaigns");
  const supabase = await createClient();
  const [projects, channels, people, audiences, { data: plans }] = await Promise.all([
    getMktProjects(), getChannels(), getPeople(), getAudiences(),
    supabase.from("mkt_plans").select("id, title").neq("status", "مؤرشفة").order("period_start", { ascending: false }),
  ]);

  return (
    <>
      <PageHead
        title="حملة جديدة"
        sub="تولد الحملة «مسودة». تُعتمد بطلب موافقة من صفحتها — ويرتفع الطلب إلى المدير إن تجاوزت الميزانية ١٠ ملايين."
      />
      <RecordForm
        table="crm_campaigns"
        fields={campaignFields({ projects, channels, people, audiences, plans: plans ?? [] })}
        initial={{ campaign_type: "توليد ليدات", mode: "رقمي" }}
        submitLabel="أنشئ الحملة"
        onSavedRedirectWithId="/dashboard/marketing/campaigns/"
      />
    </>
  );
}
