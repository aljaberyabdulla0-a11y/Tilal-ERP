import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import CrmTabs from "../../crm-tabs";
import CaptureForm from "./capture-form";

// ============================================================
// «تسجيل ليد» — القناة المركزية لما لا تكامل مباشراً له (218).
//
// من يقرأ رسائل ماسنجر وإنستغرام وواتساب، أو يردّ على اتصال، يسجّل الليد
// هنا لحظة وصوله: النظام يطابقه بعملائه، ويوزّعه بالقواعد، ويبدأ عدّاد
// أول تواصل. الليد الذي يبقى في صندوق الرسائل لا يراه أحد.
// ============================================================
export default async function CapturePage() {
  const role = await getUserRole();
  if (role === "viewer" || role === "broker") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: campaigns }, { data: projects }, { data: me }, { data: canView }] = await Promise.all([
    supabase.from("crm_campaigns").select("id, name, project_id").eq("is_active", true).order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase.rpc("my_employee_id"),
    supabase.rpc("can_view_lead_hub"),
  ]);

  return (
    <div>
      <CrmTabs active="leads" />
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <header>
          <h1 className="text-xl font-bold text-brand-600">تسجيل ليد</h1>
          <p className="mt-1 text-sm text-gray-500">
            سجّله لحظة وصوله — قبل الردّ عليه. إن كان العميل موجوداً يُربط ببطاقته ويُنبَّه صاحبها، وإلا يُنشأ ويُوزَّع.
          </p>
          {canView === true && (
            <Link href="/dashboard/crm/leads" className="mt-2 inline-block text-sm text-brand-600 hover:underline">← مركز الليدات</Link>
          )}
        </header>
        <CaptureForm
          campaigns={(campaigns ?? []) as { id: string; name: string; project_id: string | null }[]}
          projects={(projects ?? []) as { id: string; name: string }[]}
          // موظف المبيعات يسجّل ليده لنفسه عادةً؛ التسويق يتركه للتوزيع
          canSelfAssign={!!me}
          selfAssignDefault={!!me && (role === "employee" || role === "supervisor")}
        />
      </div>
    </div>
  );
}
