"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PROJECT_STATUS_COLORS,
  Project,
  TeamMember,
} from "@/lib/types";
import ProjectForm from "./project-form";

// ============================================================
// إدارة المشاريع (للمدير): إنشاء وتعديل وحذف، وإسناد الموظفين للمشاريع.
//
// الإسناد هو ما يفعّل نطاق المشرف: الموظف المُسند لمشروع يشرف عليه
// فلان تصير ليداته ومتابعاته مرئية لفلان. والموظف قد يُسند لأكثر من
// مشروع (sql/216)، وأحدها «الأساسي» (★) — عليه تُنسب ليداته في التقارير.
// ============================================================
export default function ProjectsManager({
  projects,
  employees,
}: {
  projects: Project[];
  employees: TeamMember[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyEmp, setBusyEmp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string | null) =>
    employees.find((e) => e.id === id)?.full_name ?? null;

  // كل مشاريع الموظف، والأساسي ضمنها حتى قبل تطبيق 216
  const projectsOf = (e: TeamMember) => {
    const ids = e.project_ids ?? [];
    return e.project_id && !ids.includes(e.project_id) ? [e.project_id, ...ids] : ids;
  };

  const membersOf = (projectId: string) =>
    employees.filter((e) => projectsOf(e).includes(projectId));

  const unassigned = employees.filter((e) => projectsOf(e).length === 0);

  // تضبط مجموعة مشاريع الموظف كاملةً (ذرّياً في القاعدة)
  async function saveProjects(e: TeamMember, projectIds: string[], primary?: string) {
    setBusyEmp(e.id);
    setError(null);
    const { error } = await supabase.rpc("set_employee_projects", {
      p_employee_id: e.id,
      p_project_ids: projectIds,
      p_primary: primary ?? e.project_id,
    });
    setBusyEmp(null);

    if (error) {
      setError("تعذّر الإسناد: " + error.message);
      return;
    }
    router.refresh();
  }

  function toggle(e: TeamMember, projectId: string) {
    const current = projectsOf(e);
    saveProjects(
      e,
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  async function removeProject(p: Project) {
    const members = membersOf(p.id).length;
    if (
      !confirm(
        members > 0
          ? `حذف «${p.name}»؟ سيُزال منه ${members} موظفاً (من ليس له مشروع آخر يبقى بلا مشروع)، ووحداته تصير مشتركة.`
          : `حذف «${p.name}»؟ وحداته تصير مشتركة يراها الجميع.`
      )
    )
      return;

    setError(null);
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) {
      setError("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {creating ? (
        <ProjectForm employees={employees} onDone={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + مشروع جديد
        </button>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          لا توجد مشاريع بعد. أنشئ مشروعاً وعيّن له مشرفاً، ثم أسند الموظفين إليه.
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((p) => {
            const members = membersOf(p.id);
            const supervisor = nameOf(p.supervisor_id);

            return editingId === p.id ? (
              <ProjectForm
                key={p.id}
                project={p}
                employees={employees}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div key={p.id} className="glass-card p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
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
                      {supervisor ? (
                        <>
                          المشرف: <b className="text-gray-700">{supervisor}</b>
                        </>
                      ) : (
                        <span className="text-amber-700">
                          بلا مشرف — مشروع مشترك يراه الجميع
                        </span>
                      )}
                      {(p.governorate || p.area) && (
                        <span className="text-gray-400">
                          {" · "}
                          {[p.governorate, p.area].filter(Boolean).join(" — ")}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* المخزون: الوحدات وهيكل المشروع وحالتها المالية */}
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                    >
                      المخزون
                    </Link>
                    <button
                      onClick={() => setEditingId(p.id)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => removeProject(p)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50"
                    >
                      حذف
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <span className="text-xs font-medium text-gray-500">
                    الموظفون على هذا المشروع ({members.length})
                  </span>
                  {members.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-400">
                      لا أحد بعد — أسند موظفاً من القائمة في الأسفل.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {members.map((m) => (
                        <span
                          key={m.id}
                          className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-gray-700 shadow-sm"
                        >
                          {m.full_name}
                          {m.id === p.supervisor_id && (
                            <b className="text-brand-700">(مشرف)</b>
                          )}
                          {projectsOf(m).length > 1 && m.project_id !== p.id && (
                            <span className="text-gray-400" title="هذا مشروع إضافي له">
                              (إضافي)
                            </span>
                          )}
                          <button
                            onClick={() => toggle(m, p.id)}
                            disabled={busyEmp === m.id}
                            title="إزالة من المشروع"
                            className="text-gray-400 transition hover:text-red-600 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* إسناد الموظفين */}
      <div className="glass-card p-5">
        <h3 className="text-lg font-bold text-gray-800">إسناد الموظفين للمشاريع</h3>
        <p className="mb-4 text-sm text-gray-500">
          اضغط على المشروع لإسناده أو إزالته — يمكن إسناد الموظف لأكثر من مشروع،
          فيراه مشرف كلٍّ منها. النجمة ★ تحدّد مشروعه الأساسي الذي تُنسب إليه
          ليداته في التقارير. الموظف بلا مشروع يبقى يرى عملاءه هو فقط، ولا يظهر
          لأي مشرف.
          {unassigned.length > 0 && (
            <b className="text-amber-700">
              {" "}
              حالياً {unassigned.length} موظفاً بلا مشروع.
            </b>
          )}
        </p>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[560px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">الموظف</th>
                <th className="px-4 py-2.5 font-medium">المسمّى</th>
                <th className="px-4 py-2.5 font-medium">المشاريع</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const mine = projectsOf(e);
                const busy = busyEmp === e.id;
                return (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {e.full_name}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {e.job_title || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className={`flex flex-wrap gap-1.5 ${busy ? "opacity-50" : ""}`}>
                        {projects.map((p) => {
                          const on = mine.includes(p.id);
                          const primary = on && e.project_id === p.id;
                          return (
                            <span
                              key={p.id}
                              className={`flex items-center overflow-hidden rounded-full border text-xs transition ${
                                on
                                  ? "border-brand-500 bg-brand-50 text-brand-700"
                                  : "border-gray-300 bg-white text-gray-500"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggle(e, p.id)}
                                disabled={busy}
                                title={on ? "إزالة من المشروع" : "إسناد للمشروع"}
                                className="px-2.5 py-1 hover:bg-black/5 disabled:cursor-wait"
                              >
                                {on ? "✓ " : "+ "}
                                {p.name}
                              </button>
                              {on && mine.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => !primary && saveProjects(e, mine, p.id)}
                                  disabled={busy || primary}
                                  title={primary ? "المشروع الأساسي" : "اجعله المشروع الأساسي"}
                                  className={`border-s border-brand-200 px-1.5 py-1 ${
                                    primary ? "text-amber-500" : "text-gray-300 hover:text-amber-500"
                                  }`}
                                >
                                  ★
                                </button>
                              )}
                            </span>
                          );
                        })}
                        {mine.length === 0 && (
                          <span className="py-1 text-xs text-gray-400">— بلا مشروع —</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
