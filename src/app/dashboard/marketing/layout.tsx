import { redirect } from "next/navigation";
import { canReadMarketing, getUserRole } from "@/lib/auth";
import MktNav from "./mkt-nav";

// ============================================================
// قسم التسويق — الحارس والتنقّل.
//
// يدخله: المدير، والتسويق، والمُطالِع، وأعضاء فريق التسويق (mkt_team)،
// والمحاسب (لشاشات المال وحدها: المصروفات والميزانيات والمؤشّرات —
// يدفع المصروف ويطابق الكلفة). والحارس هنا عرضٌ فقط: RLS ودوالّ 121–126
// هي التي تمنع.
// ============================================================
const ACCOUNTANT_PATHS = ["/dashboard/marketing/expenses", "/dashboard/marketing/budget", "/dashboard/marketing/analytics"];

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [read, role] = await Promise.all([canReadMarketing(), getUserRole()]);
  const accountant = role === "accountant";
  if (!read && !accountant) redirect("/dashboard");

  return (
    <div>
      <MktNav accountantOnly={accountant && !read} accountantPaths={ACCOUNTANT_PATHS} />
      <div className="space-y-6 p-4 sm:p-6">{children}</div>
    </div>
  );
}
