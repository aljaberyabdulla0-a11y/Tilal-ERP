import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamMembers } from "@/lib/projects";
import { AttendanceRules } from "@/lib/types";
import AttendanceTabs from "../attendance-tabs";
import AttendanceRulesPreview from "./preview";

// ============================================================
// قواعد خصم الدوام — المعاملات والمعاينة الصامتة (sql/060).
//
// تُشحن القواعد مطفأة. هذه الشاشة هي التي يراجع فيها المدير
// «ماذا كان سيُخصم» لشهر كامل قبل أن يشغّلها — والمعاينة تنادي
// نفس دالّة القاعدة التي يناديها بناء الكشف، فلا يفترق ما يُعرض
// عمّا يُكتب.
// ============================================================
export default async function AttendanceRulesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: settings }, members] = await Promise.all([
    supabase
      .from("company_settings")
      .select(
        "attendance_rules_enabled, attendance_effective_date, late_grace_minutes, late_hour_factor, late_absent_threshold_minutes, absence_deduction_days, late_daily_cap_days, early_leave_as_late"
      )
      .eq("id", 1)
      .maybeSingle(),
    getTeamMembers(),
  ]);

  const rules = (settings ?? {
    attendance_rules_enabled: false,
    attendance_effective_date: null,
    late_grace_minutes: 15,
    late_hour_factor: 1,
    late_absent_threshold_minutes: 120,
    absence_deduction_days: 1,
    late_daily_cap_days: 1,
    early_leave_as_late: true,
  }) as AttendanceRules;

  // المعفيّون من البصمة خارج الحساب أصلاً — لا نتعب المعاينة بهم
  const active = members.filter(
    (m) => m.status === "active" && !m.exempt_from_attendance
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/hr"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الموارد البشرية
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">قواعد خصم الدوام</h1>
          <p className="text-sm text-gray-500">
            المعاملات، ومعاينة ما سيُخصم قبل أن يُخصم.
          </p>
        </div>
      </header>

      <AttendanceTabs active="rules" />

      <section className="space-y-5 p-6">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-800">كيف يُحسب الخصم؟</b> قيمة اليوم = الراتب
          الساري في تاريخ ذلك اليوم ÷ ٣٠. وقيمة الساعة = قيمة اليوم ÷ ساعات
          الدوام، والدقيقة = الساعة ÷ ٦٠. ويوم الغياب يُخصم كاملاً، والتأخير
          بالدقيقة بعد مدّة السماح.
          <br />
          <b className="text-blue-800">مثال:</b> راتب ٧٥٠٬٠٠٠ ودوام ثماني ساعات
          → اليوم ٢٥٬٠٠٠ · الساعة ٣٬١٢٥ · الدقيقة ٥٢. فبصمةٌ في ٠٩:٢٠ (بسماح
          ١٥ دقيقة) تُكلّف ٢٠ دقيقة = ١٬٠٤٢ د.ع.
        </div>

        <AttendanceRulesPreview employees={active} rules={rules} />
      </section>
    </main>
  );
}
