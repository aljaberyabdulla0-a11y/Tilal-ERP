import { redirect } from "next/navigation";

// ============================================================
// «الفرص» لم تعد شاشة مستقلة (201): لكل عميل مسارٌ افتراضي يُدار من
// بطاقته، ولوحة الأعمدة هي «مسار العملاء». الروابط القديمة تبقى تعمل:
//   ?type=open       ← لوحة المسار (المفتوحة كاملة)
//   ?type=won|lost   ← قائمة العملاء بمرحلة «بيع» / «فشل البيع»
//   ?client=…        ← ملفّ العميل، تبويب المسار
// ============================================================
export default function OpportunitiesRedirect({
  searchParams,
}: {
  searchParams: { type?: string; client?: string };
}) {
  if (searchParams.client) redirect(`/dashboard/clients/${searchParams.client}?tab=journey`);
  if (searchParams.type === "won") redirect(`/dashboard/clients?stage=${encodeURIComponent("بيع")}`);
  if (searchParams.type === "lost") redirect(`/dashboard/clients?stage=${encodeURIComponent("فشل البيع")}`);
  redirect("/dashboard/clients/board");
}
