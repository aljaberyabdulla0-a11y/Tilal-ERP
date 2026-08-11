"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PROJECT_STATUS_COLORS,
  Project,
  TeamMember,
} from "@/lib/types";
import ProjectForm from "./project-form";

// ============================================================
// إدارة المشاريع (للمدير): إنشاء وتعديل وحذف، وإسناد كل موظف لمشروع.
//
// الإسناد هو ما يفعّل نطاق المشرف: الموظف الذي project_id عنده يساوي
// مشروعاً يشرف عليه فلان، تصير ليداته ومتابعاته مرئية لفلان.
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

  const membersOf = (projectId: string) =>
    employees.filter((e) => e.project_id === projectId);

  const unassigned = employees.filter((e) => !e.project_id);

  async function assign(employeeId: string, projectId: string) {
    setBusyEmp(employeeId);
    setError(null);
    const { error } = await supabase
      .from("employees")
      .update({ project_id: projectId || null })
      .eq("id", employeeId);
    setBusyEmp(null);

    if (error) {
      setError("تعذّر الإسناد: " + error.message);
      return;
    }
    router.refresh();
  }

  async function removeProject(p: Project) {
    const members = membersOf(p.id).length;
    if (
      !confirm(
        members > 0
          ? `حذف «${p.name}»؟ سيبقى ${members} موظفاً بلا مشروع، ووحداته تصير مشتركة.`
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

  const selectCls =
    "rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none";

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
                          <button
                            onClick={() => assign(m.id, "")}
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
          كل موظف يُسند لمشروع واحد. الموظف بلا مشروع يبقى يرى عملاءه هو فقط،
          ولا يظهر لأي مشرف.
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
                <th className="px-4 py-2.5 font-medium">المشروع</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {e.full_name}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {e.job_title || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={e.project_id ?? ""}
                      onChange={(ev) => assign(e.id, ev.target.value)}
                      disabled={busyEmp === e.id}
                      className={selectCls + " disabled:opacity-50"}
                    >
                      <option value="">— بلا مشروع —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
