import { redirect } from "next/navigation";

// الدخول إلى CRM يفتح مساحة العمل اليومية: الموظف يفتح الـCRM ليعمل
// لا ليتصفّح قوائم، و«يومي» تجيب «ماذا أفعل الآن؟».
export default function CrmPage() {
  redirect("/dashboard/crm/today");
}
