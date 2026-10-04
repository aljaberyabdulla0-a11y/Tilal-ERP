import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getLossLookups } from "@/lib/lost-sales";
import LostSettings from "./lost-settings";

// ============================================================
// إعدادات تحليل الخسارة (140) — للمدير وحده، كما تفرض RLS على القوائم.
// ============================================================
export default async function LostSettingsPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const lk = await getLossLookups();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/settings/crm" className="text-sm text-gray-500 hover:text-brand-700">
          ← إعدادات الـCRM
        </Link>
        <h1 className="text-xl font-bold text-brand-700">إعدادات تحليل الخسارة</h1>
      </header>
      <section className="p-6">
        <p className="mb-8 max-w-3xl text-sm text-gray-500">
          القوائم التي يختار منها الموظف عند إغلاق فرصة كخاسرة. الرموز ثابتة لأن التقارير والرؤى التلقائية تتعرّف بها
          على «السعر» و«المنافسة»؛ الأسماء تُعدَّل بحرّية. لا حذف — التعطيل يخفي العنصر ويُبقي تاريخه.
        </p>
        {lk.categories.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
            قوائم تحليل الخسارة غير متاحة — شغّل الهجرة ١٤٠ أولاً.
          </p>
        ) : (
          <LostSettings lk={lk} />
        )}
      </section>
    </main>
  );
}
