import { redirect } from "next/navigation";

// سجلّ الحضور يسكن /dashboard/attendance — ويُدخل إليه من بطاقة
// «الدوام» داخل الموارد البشرية.
// نُبقي هذا المسار لتعمل الروابط القديمة والمحفوظة.
export default function HrAttendanceRedirect({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const query = searchParams.date ? `?date=${searchParams.date}` : "";
  redirect(`/dashboard/attendance${query}`);
}
