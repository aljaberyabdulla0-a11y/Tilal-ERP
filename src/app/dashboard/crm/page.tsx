import { redirect } from "next/navigation";

// الدخول إلى CRM يفتح أول تبويب (العملاء)
export default function CrmPage() {
  redirect("/dashboard/clients");
}
