import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { MonthCloseRow } from "@/lib/types";
import CloseWizard from "./close-wizard";

// ============================================================
// إغلاق الشهر — بناءٌ جماعي ثم مراجعة ثم اعتماد دفعة واحدة.
//
// كل الحساب في القاعدة: هذه الشاشة تعرض ما تُرجعه
// month_close_overview وتنادي الدوالّ الجماعية.
// ============================================================
export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const thisMonth = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" })
    .slice(0, 7);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.period ?? "")
    ? searchParams.period!
    : thisMonth;

  const supabase = await createClient();
  const { data } = await supabase.rpc("month_close_overview", { p_period: period });
  const rows = (data ?? []) as MonthCloseRow[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
          ← الموارد البشرية
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">إغلاق الشهر</h1>
          <p className="text-sm text-gray-500">
            ابنِ كشوف الجميع، راجع الشاذّ، ثم اعتمد دفعة واحدة.
          </p>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-800">الترتيب:</b> «بناء الكشوف» يُنشئ مسوّدةً
          لكل موظف على رأس العمل — ويُعيد حسابها إن كانت قائمة. ثم راجع عمود
          <b> المراجعة</b>: ما فيه شارة يحتاج نظرة قبل الاعتماد. ثم
          <b> «اعتماد»</b> يمرّ على المسوّدات واحدة واحدة بكل حرّاسها، وما يتعذّر
          يظهر باسمه وسببه ولا يوقف البقيّة.
          <br />
          <b className="text-blue-800">وبعد الاعتماد</b> تُقفل الفترة من{" "}
          <Link href="/dashboard/accounting/periods" className="font-semibold underline">
            الفترات المحاسبية
          </Link>{" "}
          فتتجمّد دفاتر الشهر.
        </div>

        <CloseWizard period={period} rows={rows} />
      </section>
    </main>
  );
}
