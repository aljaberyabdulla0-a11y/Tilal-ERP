import { requireMktMoney } from "@/lib/marketing-guard";
import { PageHead } from "@/components/marketing/ui";
import Copilot from "./copilot";

// المساعد التسويقي — يسأل القاعدة بأدواتٍ للقراءة فقط، ويكتب محتوىً من
// حقائق المشروع وحدها. كل سؤال مسجَّل (mkt_ai_log).
export default async function CopilotPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktMoney();
  return (
    <>
      <PageHead title="المساعد التسويقي"
        sub="اسأله عن الأرقام فيقرؤها من القاعدة بصلاحيتك، أو اطلب منه نصّاً فيكتبه من حقائق المشروع وحدها. لا يكتب في النظام شيئاً." />
      <Copilot initial={searchParams.q ?? ""} />
    </>
  );
}
