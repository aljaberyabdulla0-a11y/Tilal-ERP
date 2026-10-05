"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Department, Position, departmentLabel } from "@/lib/org-types";

// طلب توظيف جديد — مدير القسم لقسمه، وHR لأي قسم. الحالة والرقم والطالب
// تضعها القاعدة (stamp_job_requisition)، والقرار بعدها لـ HR ثم الإدارة.
export default function RequisitionForm({
  departments,
  allDepartments,
  positions,
}: {
  departments: Department[];
  allDepartments: Department[];
  positions: Position[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    department_id: departments[0]?.id ?? "",
    position_id: "",
    title: "",
    headcount: "1",
    reason: "توسّع",
    justification: "",
    salary_min: "",
    salary_max: "",
    needed_by: "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("job_requisitions").insert({
      department_id: f.department_id,
      position_id: f.position_id || null,
      title: f.title.trim(),
      headcount: Number(f.headcount) || 1,
      reason: f.reason,
      justification: f.justification.trim() || null,
      salary_min: f.salary_min ? Number(f.salary_min) : null,
      salary_max: f.salary_max ? Number(f.salary_max) : null,
      needed_by: f.needed_by || null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    setOpen(false);
    setF({ ...f, title: "", justification: "", salary_min: "", salary_max: "", needed_by: "", position_id: "" });
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        + طلب توظيف
      </button>
    );
  }

  const deptPositions = positions.filter((p) => p.department_id === f.department_id);

  return (
    <form onSubmit={save} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-gray-800">طلب توظيف جديد</h3>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>القسم *</label>
          <select className={input} required value={f.department_id}
            onChange={(e) => setF({ ...f, department_id: e.target.value, position_id: "" })}>
            {departments.map((d) => <option key={d.id} value={d.id}>{departmentLabel(d, allDepartments)}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>المنصب</label>
          <select className={input} value={f.position_id}
            onChange={(e) => {
              const p = positions.find((x) => x.id === e.target.value);
              setF({ ...f, position_id: e.target.value, title: f.title || p?.title_ar || "" });
            }}>
            <option value="">— منصب جديد / غير معرّف —</option>
            {deptPositions.map((p) => <option key={p.id} value={p.id}>{p.title_ar}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>المسمّى المطلوب *</label>
          <input className={input} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className={label}>العدد *</label>
          <input className={input} type="number" min="1" max="100" dir="ltr" required value={f.headcount}
            onChange={(e) => setF({ ...f, headcount: e.target.value })} />
        </div>
        <div>
          <label className={label}>السبب</label>
          <select className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {["توسّع", "بديل", "منصب جديد"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>مطلوب قبل</label>
          <input className={input} type="date" dir="ltr" value={f.needed_by} onChange={(e) => setF({ ...f, needed_by: e.target.value })} />
        </div>
        <div>
          <label className={label}>أدنى راتب مقترح (د.ع)</label>
          <input className={input} type="number" min="0" dir="ltr" value={f.salary_min} onChange={(e) => setF({ ...f, salary_min: e.target.value })} />
        </div>
        <div>
          <label className={label}>أعلى راتب مقترح (د.ع)</label>
          <input className={input} type="number" min="0" dir="ltr" value={f.salary_max} onChange={(e) => setF({ ...f, salary_max: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <label className={label}>المبرّر</label>
          <textarea className={input} rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "جاري الإرسال..." : "أرسل للموارد البشرية"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-gray-600">إلغاء</button>
      </div>
    </form>
  );
}
