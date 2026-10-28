import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CrmTabs from "../../crm-tabs";
import LeadImporter from "./lead-importer";

// ============================================================
// استيراد Lead Sheet (218): رفع ← مطابقة الأعمدة ← معاينة ← حفظ على دفعات.
//
// يختلف عن «استيراد العملاء» (/dashboard/clients/import) عمداً: ذاك يُدخل
// بطاقات بقالب النظام ويرفض المكرّر. هذا يُدخل **ليدات** من ملف المنصّة كما
// هو إلى الدفتر: المكرّر يُربط بعميله، والرقم الفاسد يبقى ظاهراً في قائمة
// الأخطاء، وإعادة الملف أو استئناف دفعة انقطعت لا تُنشئ شيئاً مرتين.
// ============================================================
export default async function LeadImportPage() {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_import_leads");
  if (allowed !== true) redirect("/dashboard/crm/leads/capture");

  const [{ data: campaigns }, { data: projects }] = await Promise.all([
    supabase.from("crm_campaigns").select("id, name, project_id").order("name"),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  return (
    <div>
      <CrmTabs active="leads" />
      <div className="space-y-4 p-6">
        <header>
          <h1 className="text-xl font-bold text-brand-600">استيراد Lead Sheet</h1>
          <p className="mt-1 text-sm text-gray-500">
            ملف ليدات من Meta أو أي منصّة (.xlsx أو .csv). الملف يُقرأ ويُعرض قبل أي حفظ.
          </p>
          <Link href="/dashboard/crm/leads?tab=batches" className="mt-2 inline-block text-sm text-brand-600 hover:underline">← الدفعات السابقة</Link>
        </header>
        <LeadImporter
          campaigns={(campaigns ?? []) as { id: string; name: string; project_id: string | null }[]}
          projects={(projects ?? []) as { id: string; name: string }[]}
        />
      </div>
    </div>
  );
}
