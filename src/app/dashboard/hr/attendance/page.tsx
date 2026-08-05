import { redirect } from "next/navigation";

// سجل الحضور انتقل إلى قسم «الدوام» المستقل في الشريط الجانبي.
// نُبقي هذا المسار لتعمل الروابط القديمة والمحفوظة.
export default function HrAttendanceRedirect({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const query = searchParams.date ? `?date=${searchParams.date}` : "";
  redirect(`/dashboard/attendance${query}`);
}
