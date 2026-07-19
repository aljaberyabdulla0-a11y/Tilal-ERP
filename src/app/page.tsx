import { redirect } from "next/navigation";

// الصفحة الرئيسية — توجّه مباشرة للوحة التحكم
// (الـ middleware يتكفل بإرسال غير المسجلين لصفحة الدخول)
export default function HomePage() {
  redirect("/dashboard");
}
