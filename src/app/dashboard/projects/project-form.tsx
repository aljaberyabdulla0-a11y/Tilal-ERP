"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  IRAQ_GOVERNORATES,
  PROJECT_STATUSES,
  Project,
  TeamMember,
} from "@/lib/types";

const cls =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

// ============================================================
// إنشاء أو تعديل مشروع، وتعيين المشرف المسؤول عنه.
// المشرف هو من سيرى ليدات كل من يعمل على هذا المشروع ويتابعهم.
// ============================================================
export default function ProjectForm({
  project,
  employees,
  onDone,
}: {
  project?: Project;
  employees: TeamMember[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const editing = Boolean(project);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: project?.name ?? "",
    governorate: project?.governorate ?? "",
    area: project?.area ?? "",
    status: project?.status ?? PROJECT_STATUSES[0],
    supervisor_id: project?.supervisor_id ?? "",
    description: project?.description ?? "",
  });

  function update(f: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [f]: v }));
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError("اكتب اسم المشروع.");
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      governorate: form.governorate || null,
      area: form.area.trim() || null,
      status: form.status,
      supervisor_id: form.supervisor_id || null,
      description: form.description.trim() || null,
    };

    const { error } = editing
      ? await supabase.from("projects").update(payload).eq("id", project!.id)
      : await supabase.from("projects").insert(payload);

    setSaving(false);

    if (error) {
      setError(
        error.message.includes("duplicate") || error.message.includes("unique")
          ? "يوجد مشروع بنفس الاسم."
          : "تعذّر الحفظ: " + error.message
      );
      return;
    }

    onDone?.();
    router.refresh();
  }

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-lg font-bold text-gray-800">
        {editing ? `تعديل: ${project!.name}` : "مشروع جديد"}
      </h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">اسم المشروع *</label>
          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="مثلاً: مجمع الفرقان السكني"
            className={cls + " w-full"}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">
            المشرف المسؤول
          </label>
          <select
            value={form.supervisor_id}
            onChange={(e) => update("supervisor_id", e.target.value)}
            className={cls + " w-full"}
          >
            <option value="">بلا مشرف (مشروع مشترك)</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">الحالة</label>
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className={cls + " w-full"}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">المحافظة</label>
          <select
            value={form.governorate}
            onChange={(e) => update("governorate", e.target.value)}
            className={cls + " w-full"}
          >
            <option value="">—</option>
            {IRAQ_GOVERNORATES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">المنطقة</label>
          <input
            value={form.area}
            onChange={(e) => update("area", e.target.value)}
            className={cls + " w-full"}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">وصف مختصر</label>
          <input
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className={cls + " w-full"}
          />
        </div>
      </div>

      <p className="mt-3 rounded-xl bg-blue-50 px-4 py-2.5 text-xs text-gray-700">
        المشرف المسؤول يرى ليدات كل من يعمل على هذا المشروع ويتابعهم، ويوافق على
        إجازاتهم. <b>ولا يرى رواتبهم ولا محاسبة الشركة.</b> المشروع بلا مشرف يبقى
        مشتركاً يراه الجميع.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : editing ? "حفظ التعديل" : "إنشاء المشروع"}
        </button>
        {onDone && (
          <button
            onClick={onDone}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            إلغاء
          </button>
        )}
      </div>
    </div>
  );
}
