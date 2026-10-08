import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import type { RawParams } from "@/lib/dashboard/period";
import ExecutiveDashboard from "./_views/executive";
import SupervisorDashboard from "./_views/supervisor";
import MarketingDashboard from "./_views/marketing";
import ViewerDashboard from "./_views/viewer";
import EmployeeDashboard from "./_views/employee";
import FollowupDashboard from "./_views/followup";
import BrokerDashboard from "./_views/broker";
import RmDashboard from "./_views/rm";

// ============================================================
// /dashboard — موزّع: لكل دور لوحته.
//
//   admin                 → التنفيذية (نظام تشغيل الإدارة)
//   supervisor            → لوحة الفريق            (كانت لوحة الموظف — M1)
//   marketing             → لوحة التسويق           (كانت لوحة الموظف — M2)
//   viewer                → نظرة قراءة فقط          (كانت لوحة الموظف — M2)
//   followup_manager      → المتابعة التشغيلية
//   relationship_manager  → الشركات تحت مظلته
//   broker                → المهل والطلبات والعمولات
//   accountant · hr       → بوابة عملهما مباشرة (انظر أدناه)
//   employee وغيره        → مساحة العمل الشخصية
//
// ⚠️ اختيار اللوحة عرضٌ لا صلاحية: كل رقم في كل لوحة تقيّده سياسات
//    القاعدة (RLS ودوال can_*)، فلو فُتحت لوحةٌ لغير دورها لما رأى
//    فيها إلا ما يُسمح له به.
// ============================================================
export default async function DashboardPage({ searchParams }: { searchParams: RawParams }) {
  const role = await getUserRole();

  switch (role) {
    case "admin": return <ExecutiveDashboard searchParams={searchParams} />;
    case "supervisor": return <SupervisorDashboard searchParams={searchParams} />;
    case "marketing": return <MarketingDashboard searchParams={searchParams} />;
    case "viewer": return <ViewerDashboard searchParams={searchParams} />;
    case "followup_manager": return <FollowupDashboard />;
    case "relationship_manager": return <RmDashboard />;
    case "broker": return <BrokerDashboard />;
  }

  // ============================================================
  // المحاسب والموارد البشرية: لا لوحةَ ثالثةً تُبنى لهما.
  //
  // اللوحة التنفيذية عن سوق الشركة — عملاء ووحدات ومبيعات — وليس
  // فيها ما يخصّهما، ولوحة الموظف عن ليداته ومتابعاته ولا ليد
  // لهما. فيُفتح كلٌّ على بوابة عمله رأساً: المال أو الأفراد
  // (sql/068). وبوابتهما الشخصية (بصمة وإجازة وقسيمة) في
  // /dashboard/me كبقيّة الموظفين.
  // ============================================================
  if (role === "accountant") redirect("/dashboard/finance");
  if (role === "hr") redirect("/dashboard/hr");

  return <EmployeeDashboard />;
}
