import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Finding = { severity: "حرجة" | "عالية" | "متوسطة" | "منخفضة"; check_name: string; object_name: string; detail: string };

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  "حرجة": "bg-red-100 text-red-700",
  "عالية": "bg-amber-100 text-amber-800",
  "متوسطة": "bg-blue-100 text-blue-700",
  "منخفضة": "bg-gray-100 text-gray-600",
};
const ORDER: Finding["severity"][] = ["حرجة", "عالية", "متوسطة", "منخفضة"];

// الفحص الأمني الدوري (sql/173) — للمدير العام. يعيد ما راجعه تدقيق
// المرحلة 10: RLS، صلاحيات الزائر، دوال definer، السياسات المفتوحة،
// الحاويات العامة، سياسات HR خارج المصفوفة، حسابات الخارجين.
export default async function SecurityAuditPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("security_audit");
  const rows = ((data ?? []) as Finding[]).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-brand-700">← الإعدادات</Link>
        <h1 className="text-xl font-bold text-brand-700">الفحص الأمني</h1>
      </header>
      <section className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          {ORDER.map((s) => (
            <span key={s} className={`rounded-full px-3 py-1 text-sm font-semibold ${SEVERITY_STYLE[s]}`}>
              {s}: {rows.filter((r) => r.severity === s).length}
            </span>
          ))}
        </div>
        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error.message}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl bg-green-50 p-6 text-center text-green-800">لا ملاحظات — الإعداد الأمني سليم.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">الخطورة</th>
                  <th className="px-3 py-2 text-right font-semibold">الفحص</th>
                  <th className="px-3 py-2 text-right font-semibold">الكائن</th>
                  <th className="px-3 py-2 text-right font-semibold">التفصيل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[r.severity]}`}>{r.severity}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{r.check_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700" dir="ltr">{r.object_name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
