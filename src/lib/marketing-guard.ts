import { redirect } from "next/navigation";
import { canReadMarketing, canReadMarketingMoney } from "@/lib/auth";

// حارس الصفحة — عرضٌ لا حماية (RLS تحمي). المحاسب يُعاد إلى شاشات المال.
export async function requireMktRead() {
  if (!(await canReadMarketing())) {
    redirect((await canReadMarketingMoney()) ? "/dashboard/marketing/expenses" : "/dashboard");
  }
}

export async function requireMktMoney() {
  if (!(await canReadMarketingMoney())) redirect("/dashboard");
}
