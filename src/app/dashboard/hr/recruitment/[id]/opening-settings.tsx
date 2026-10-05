"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { JobOpening } from "@/lib/recruitment";

// إعدادات الوظيفة: مدير التوظيف (يرى المرشحين ويُنبَّه بالتعيين)، الحالة، المتطلبات
export default function OpeningSettings({
  opening,
  people,
}: {
  opening: JobOpening;
  people: { id: string; full_name: string; employee_code: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    hiring_manager_id: opening.hiring_manager_id ?? "",
    status: opening.status,
    closes_at: opening.closes_at ?? "",
    requirements: opening.requirements ?? "",
    description: opening.description ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("job_openings")
      .update({
        hiring_manager_id: f.hiring_manager_id || null,
        status: f.status,
        closes_at: f.closes_at || null,
        requirements: f.requirements.trim() || null,
        description: f.description.trim() || null,
      })
      .eq("id", opening.id);
    setSaving(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const manager = people.find((p) => p.id === opening.hiring_manager_id);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-600">
          مدير التوظيف: <span className="font-medium text-gray-800">{manager?.full_name ?? "—"}</span>
          {opening.requirements && <p className="mt-1 whitespace-pre-line text-xs text-gray-500">{opening.requirements}</p>}
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="rounded-lg border px-3 py-1.5 text-sm text-brand-700 hover:bg-gray-50">
            إعدادات الوظيفة
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={save} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700 sm:col-span-3">{err}</p>}
          <label className="text-xs text-gray-600">
            مدير التوظيف
            <select className={input} value={f.hiring_manager_id} onChange={(e) => setF({ ...f, hiring_manager_id: e.target.value })}>
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            الحالة
            <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {["مفتوحة", "معلّقة", "مغلقة"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            يُغلق التقديم في
            <input className={input} type="date" dir="ltr" value={f.closes_at} onChange={(e) => setF({ ...f, closes_at: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600 sm:col-span-3">
            الوصف
            <textarea className={input} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600 sm:col-span-3">
            المتطلبات
            <textarea className={input} rows={3} value={f.requirements} onChange={(e) => setF({ ...f, requirements: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">حفظ</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-gray-600">إلغاء</button>
          </div>
        </form>
      )}
    </div>
  );
}
