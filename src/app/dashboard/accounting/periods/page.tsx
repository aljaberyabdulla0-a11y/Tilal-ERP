import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { AccountingPeriod } from "@/lib/types";
import AccTabs from "../acc-tabs";
import PeriodsManager from "./periods-manager";

// ============================================================
// الفترات المحاسبية — إقفال الشهر يجمّد دفاتره (sql/063).
//
// الشهر المقفل لا يقبل قيداً ولا حذفاً، ولا من دوالّ النظام نفسها:
// الحارس محفّزٌ على journal_entries و journal_lines، ودوالّ
// repost_* تتجاوز RLS ولا تتجاوز المحفّزات.
// ============================================================
export default async function AccountingPeriodsPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.rpc("periods_overview", { p_months: 12 });
  const periods = (data ?? []) as AccountingPeriod[];

  const locked = periods.filter((p) => p.status !== "مفتوح").length;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/finance"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المالية
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">الفترات المحاسبية</h1>
          <p className="text-sm text-gray-500">
            إقفال الشهر يجمّد دفاتره فلا تتغيّر أرقامٌ عُرضت.
          </p>
        </div>
      </header>

      <AccTabs active="periods" />

      <section className="space-y-5 p-6">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-800">ماذا يعني الإقفال؟</b> لا يُكتب في الشهر
          المقفل قيدٌ ولا يُحذف — <b>ولا من دوالّ النظام نفسها</b>. فاعتماد كشف
          راتبٍ شهرُه مقفل يفشل، وحذف حركة نقدية فيه يفشل، وإعادة ترحيل قيدٍ
          قديم تفشل.
          <br />
          <b className="text-blue-800">وللتصحيح بعد الإقفال طريقان:</b> أن تفتح
          الشهر بسببٍ مكتوب يُسجَّل في سجلّ التدقيق، أو — وهو الأصحّ محاسبياً —
          أن تسجّل قيد التصحيح في الشهر الحالي.
          {locked > 0 && (
            <>
              <br />
              <b className="text-blue-800">الحالة:</b> {locked} من آخر اثني عشر
              شهراً مقفلة.
            </>
          )}
        </div>

        <PeriodsManager periods={periods} />

        <p className="text-xs text-gray-400">
          الشهر الذي لا صفَّ له هنا مفتوحٌ افتراضاً — فلا تحتاج القاعدة صفّاً
          لكل شهر مضى.
        </p>
      </section>
    </main>
  );
}
