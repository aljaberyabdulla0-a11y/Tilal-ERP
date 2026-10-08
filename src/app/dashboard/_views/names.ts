import { getMyEmployee } from "@/lib/hr";

// اسم المستخدم للتحية — من ملفّه الوظيفي إن وُجد، وإلا تحيةٌ بلا اسم
export async function getEmployeeName(): Promise<string | null> {
  try {
    return (await getMyEmployee())?.full_name ?? null;
  } catch {
    return null;
  }
}
