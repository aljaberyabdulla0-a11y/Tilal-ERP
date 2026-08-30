import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin, isSupervisor } from "@/lib/auth";
import { getProjects, getTeamMembers } from "@/lib/projects";
import { PROJECT_STATUS_COLORS } from "@/lib/types";
import ProjectsManager from "./projects-manager";

// ============================================================
// المشاريع (للمدير) — وحدة التقسيم في النظام كله.
// المشروع له مشرف مسؤول وموظفون يعملون عليه، وعلى هذا التقسيم
// تُبنى رؤية الليدات والمتابعات والحضور.
// ============================================================
export default async function ProjectsPage() {
  const admin = await isAdmin();
  // المشرف يدخل ليدير مخزون مشروعه — لكنه لا يُنشئ مشاريع ولا يحذفها
  const supervisor = admin ? false : await isSupervisor();
  if (!admin && !supervisor) redirect("/dashboard");

  const [projects, employees] = await Promise.all([
    getProjects(),
    getTeamMembers(),
  ]);

  if (supervisor) {
    return (
      <main className="min-h-screen bg-gray-50">
        <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">مشاريعي</h1>
            <p className="text-sm text-gray-500">
              افتح المشروع لتدير وحداته وحجوزاته.
            </p>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.length === 0 ? (
            <p className="text-sm text-gray-400">لا مشاريع في نطاقك.</p>
          ) : (
            projects.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/projects/${p.id}`}
                className="glass-card p-5 transition hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-800">{p.name}</h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      PROJECT_STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {[p.governorate, p.area].filter(Boolean).join(" — ") || "—"}
                </p>
              </Link>
            ))
          )}
        </section>
      </main>
    );
  }

  const active = employees.filter((e) => e.status === "active");
  const supervised = projects.filter((p) => p.supervisor_id).length;
  const assigned = active.filter((e) => e.project_id).length;

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">المشاريع</h1>
            <p className="text-sm text-gray-500">
              قسّم موظفيك على المشاريع، وعيّن لكل مشروع مشرفاً يتابع فريقه.
            </p>
          </div>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">المشاريع</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{projects.length}</p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">لها مشرف</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{supervised}</p>
          </div>
          <div
            className={
              kpi +
              (assigned === active.length ? " border-s-green-500" : " border-s-amber-500")
            }
          >
            <span className="text-sm text-gray-500">موظفون مُسندون</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                assigned === active.length ? "text-green-700" : "text-amber-700"
              }`}
            >
              {assigned} / {active.length}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
          <b className="text-blue-800">كيف يعمل التقسيم؟</b> تُنشئ مشروعاً وتختار له
          مشرفاً، ثم تُسند الموظفين إليه. عندها يرى المشرف <b>ليدات كل من على مشروعه
          ومتابعاتهم وحضورهم</b>، ويوافق على إجازاتهم — ولا يرى رواتبهم ولا محاسبة
          الشركة. لتحويل موظف إلى مشرف غيّر دوره من{" "}
          <Link href="/dashboard/settings" className="font-semibold underline">
            صفحة الإعدادات
          </Link>
          .
        </div>

        <ProjectsManager projects={projects} employees={active} />
      </section>
    </main>
  );
}
