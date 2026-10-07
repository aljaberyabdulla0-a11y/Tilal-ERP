import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr, isAdmin } from "@/lib/auth";
import HrTabs from "../hr-tabs";
import IssueAction from "./issue-actions";

export const dynamic = "force-dynamic";

type Issue = {
  kind: string;
  severity: "حرجة" | "عالية" | "متوسطة" | "منخفضة";
  employee_id: string | null;
  employee_name: string | null;
  detail: string;
  link: string | null;
};

const SEVERITY_STYLE: Record<Issue["severity"], string> = {
  "حرجة": "bg-red-100 text-red-700",
  "عالية": "bg-amber-100 text-amber-800",
  "متوسطة": "bg-blue-100 text-blue-700",
  "منخفضة": "bg-gray-100 text-gray-600",
};
const SEVERITY_ORDER: Issue["severity"][] = ["حرجة", "عالية", "متوسطة", "منخفضة"];

// فحص التكامل (sql/170) — ما تركه حدث HR معلّقاً في وحدة أخرى ويحتاج قراراً
export default async function IntegrationsPage() {
  if (!(await canManageHr())) redirect("/dashboard/me");
  const supabase = await createClient();
  const [{ data, error }, admin] = await Promise.all([supabase.rpc("integration_issues"), isAdmin()]);
  const issues = ((data ?? []) as Issue[]).sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.kind.localeCompare(b.kind, "ar"),
  );
  const counts = SEVERITY_ORDER.map((s) => ({ s, n: issues.filter((i) => i.severity === s).length }));

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">← HR</Link>
        <h1 className="text-xl font-bold text-brand-700">فحص التكامل</h1>
      </header>
      <HrTabs active="admin" manager={true} />

      <section className="space-y-4 p-6">
        <p className="text-sm text-gray-600">
          أحداث HR تسري تلقائياً إلى الوحدات الأخرى: تغيير الاسم يصل إلى العملاء والمهام والحجوزات،
          وتغيير المدير ينقل المراجعات المفتوحة، والخروج ينقل المرؤوسين ويُغلق التوزيع والورديات.
          ما يلي لا يصحّ حسمه آلياً — يحتاج قراراً.
        </p>

        <div className="flex flex-wrap gap-2">
          {counts.map(({ s, n }) => (
            <span key={s} className={`rounded-full px-3 py-1 text-sm font-semibold ${SEVERITY_STYLE[s]}`}>
              {s}: {n}
            </span>
          ))}
        </div>

        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error.message}</div>
        ) : issues.length === 0 ? (
          <div className="rounded-2xl bg-green-50 p-6 text-center text-green-800">لا شيء معلّق — التكامل سليم.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">الخطورة</th>
                  <th className="px-3 py-2 text-right font-semibold">النوع</th>
                  <th className="px-3 py-2 text-right font-semibold">الموظف / الجهة</th>
                  <th className="px-3 py-2 text-right font-semibold">التفصيل</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {issues.map((i, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[i.severity]}`}>
                        {i.severity}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{i.kind}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {i.employee_id ? (
                        <Link href={`/dashboard/hr/employees/${i.employee_id}`} className="text-brand-700 hover:underline">
                          {i.employee_name}
                        </Link>
                      ) : (
                        i.employee_name ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{i.detail}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {admin && i.employee_id && <IssueAction kind={i.kind} employeeId={i.employee_id} />}
                        {i.link && i.link !== "/dashboard/hr/integrations" && (
                          <Link href={i.link} className="whitespace-nowrap text-xs text-brand-700 hover:underline">فتح ←</Link>
                        )}
                      </div>
                    </td>
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
