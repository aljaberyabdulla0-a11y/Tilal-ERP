"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProjectLite } from "@/lib/crm";

// ============================================================
// «مسار شراء إضافي» (crm_start_journey — 201).
//
// لكل عميل مسارٌ افتراضي يولد معه ويُدار من بطاقته؛ لا يُنشئ الموظف
// «فرصة» ليتابع. هذا الزرّ لنيّة شراءٍ **مستقلة** فقط: اشترى ويريد
// وحدة ثانية، أو يفاوض على مشروع آخر بالتوازي. والقاعدة ترفض مساراً
// ثانياً مفتوحاً على المشروع نفسه — المتابعة اليومية على المسار القائم.
// ============================================================
export default function NewJourney({
  clientId,
  projects,
  defaultProjectId,
}: {
  clientId: string;
  projects: ProjectLite[];
  defaultProjectId?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setErr(null);
    if (note.trim().length < 5) return setErr("اكتب سبب فتح مسار مستقل (٥ أحرف على الأقل).");
    setBusy(true);
    const { error } = await supabase.rpc("crm_start_journey", {
      p_client_id: clientId,
      p_note: note.trim(),
      p_project_id: projectId || null,
      p_unit_id: null,
      p_stage: null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(true);
    setNote("");
    router.refresh();
  }

  return (
    <details id="new-journey" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">
        مسار شراء إضافي
        <span className="ms-2 text-xs font-normal text-gray-400">لنيّة شراء مستقلة فقط — المتابعة اليومية على المسار الحالي</span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-gray-600">المشروع</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
          >
            <option value="">— بلا مشروع —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-gray-600">لماذا مسار مستقل؟</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="مثال: اشترى شقة في المرحلة الأولى ويريد محلاً تجارياً في مشروع آخر"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {done && <p className="mt-2 text-sm text-green-700">فُتح المسار — صار مسار العميل الحالي.</p>}
      <div className="mt-3 text-end">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "يفتح…" : "افتح المسار"}
        </button>
      </div>
    </details>
  );
}
