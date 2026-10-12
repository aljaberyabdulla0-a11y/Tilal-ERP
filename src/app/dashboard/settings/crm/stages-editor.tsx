"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Stage } from "@/lib/crm";

// ============================================================
// مراحل خطّ المبيعات — تُضبط لا تُسمّى.
//
// الاسم مقفل: هو نفسه المخزَّن في clients.stage وopportunity_stage_history،
// وإعادة تسميته من هنا وحدها تكسر التاريخ والتقارير معاً (sql/070).
// ما يُضبط: الاحتمال، والمهلة، ووجوب التواصل، ووجوب السبب، والفعالية.
//
// النوع (201): مفتوحة · فوز · خسارة · «ختامية غير تجارية» (closed) —
// الأخيرة لا تُعدّ خسارة بيع ولا تدخل مقام معدّل الفوز. و«بالحجز»
// مرحلة لا يُنقل إليها يدوياً (is_manual = false). النوع لا يُغيَّر من
// هنا: تغييره يقلب معنى كل حدث سابق في التقارير — بهجرة لا بزرّ.
// ============================================================
type Draft = { probability: string; sla_hours: string; requires_activity: boolean; requires_reason: boolean; is_active: boolean };

const TYPE_LABEL: Record<string, string> = {
  open: "مفتوحة", won: "فوز", lost: "خسارة", closed: "ختامية غير تجارية",
};

function toDraft(s: Stage): Draft {
  return {
    probability: String(s.probability),
    sla_hours: s.sla_hours === null ? "" : String(s.sla_hours),
    requires_activity: s.requires_activity,
    requires_reason: s.requires_reason ?? false,
    is_active: s.is_active,
  };
}

export default function StagesEditor({ stages }: { stages: Stage[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    Object.fromEntries(stages.map((s) => [s.id, toDraft(s)]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function patch(id: string, p: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  }

  async function save(s: Stage) {
    const d = drafts[s.id];
    const prob = Number(d.probability);
    if (d.probability.trim() === "" || !Number.isFinite(prob) || prob < 0 || prob > 100) {
      return setErr("الاحتمال بين ٠ و١٠٠.");
    }
    const sla = d.sla_hours.trim() === "" ? null : Number(d.sla_hours);
    if (sla !== null && (!Number.isFinite(sla) || sla < 0)) {
      return setErr("المهلة رقم موجب بالساعات أو فارغ.");
    }

    setBusy(s.id);
    setErr(null);
    const { data, error } = await supabase
      .from("crm_stages")
      .update({
        probability: prob,
        sla_hours: sla,
        requires_activity: d.requires_activity,
        requires_reason: d.requires_reason,
        is_active: d.is_active,
      })
      .eq("id", s.id)
      .select("id");
    setBusy(null);
    if (error) return setErr(error.message);
    // RLS تمنع صمتاً: صفر صفوف = لم يُحفظ
    if (!data || data.length === 0) return setErr("لم يُحفظ — إعدادات المراحل للمدير وحده.");
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      {err && <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{err}</p>}
      <table className="w-full text-right text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">المرحلة</th>
            <th className="px-4 py-3 font-medium">النوع</th>
            <th className="px-4 py-3 font-medium">الاحتمال %</th>
            <th className="px-4 py-3 font-medium">المهلة (ساعة)</th>
            <th className="px-4 py-3 font-medium">يلزم تواصل</th>
            <th className="px-4 py-3 font-medium">يلزم سبب</th>
            <th className="px-4 py-3 font-medium">فعّالة</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {stages.map((s) => {
            const d = drafts[s.id];
            const orig = toDraft(s);
            const changed =
              d.probability !== orig.probability ||
              d.sla_hours !== orig.sla_hours ||
              d.requires_activity !== orig.requires_activity ||
              d.requires_reason !== orig.requires_reason ||
              d.is_active !== orig.is_active;
            return (
              <tr key={s.id} className={d.is_active ? "" : "opacity-60"}>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.color ?? "bg-gray-100 text-gray-700"}`}>
                    {s.name}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {TYPE_LABEL[s.stage_type] ?? s.stage_type}
                  {s.is_manual === false && <span className="ms-1 rounded bg-teal-50 px-1.5 text-[10px] text-teal-700">بالحجز</span>}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={d.probability}
                    onChange={(e) => patch(s.id, { probability: e.target.value })}
                    className="w-20 rounded border border-gray-300 px-2 py-1"
                    dir="ltr"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    value={d.sla_hours}
                    placeholder="بلا"
                    onChange={(e) => patch(s.id, { sla_hours: e.target.value })}
                    className="w-24 rounded border border-gray-300 px-2 py-1"
                    dir="ltr"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={d.requires_activity}
                    onChange={(e) => patch(s.id, { requires_activity: e.target.checked })}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={d.requires_reason}
                    onChange={(e) => patch(s.id, { requires_reason: e.target.checked })}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={d.is_active}
                    onChange={(e) => patch(s.id, { is_active: e.target.checked })}
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={!changed || busy === s.id}
                    onClick={() => save(s)}
                    className="rounded bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    حفظ
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
