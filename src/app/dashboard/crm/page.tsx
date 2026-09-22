import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";

// الدخول إلى CRM يفتح مساحة العمل اليومية: الموظف يفتح الـCRM ليعمل
// لا ليتصفّح قوائم، و«يومي» تجيب «ماذا أفعل الآن؟».
export default async function CrmPage() {
  // التسويق والمُطالِع لا ليدات لهما، فـ«يومي» صفحةٌ فارغة بحقّهما
  const role = await getUserRole();
  if (role === "marketing" || role === "viewer") {
    redirect("/dashboard/crm/overview");
  }
  redirect("/dashboard/crm/today");
}
