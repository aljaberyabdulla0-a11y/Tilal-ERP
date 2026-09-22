"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ScoreRule } from "@/lib/crm";

// ============================================================
// قواعد التقييم — النقاط والعتبة والفعالية (sql/070 · 074).
//
// الرموز ثابتة: المحرّك في 074 يعرفها بأسمائها. ما يُضبط هو كم
// نقطة تساوي كل إشارة، وعتبتها إن كانت زمنية («تواصل خلال ٧ أيام»).
// الدرجة تُعاد كل صباح؛ ولمن لا ينتظر زرّ «أعد الحساب» في التقارير.
// ============================================================
export default function ScoreRulesEditor({ rules }: { rules: ScoreRule[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, { points: string; param: string; is_active: boolean }>>(
    Object.fromEntries(
      rules.map((r) => [r.code, { points: String(r.points), param: r.param === null ? "" : String(r.param), is_active: r.is_active }])
    )
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(r: ScoreRule) {
    const d = drafts[r.code];
    const points = Number(d.points);
    if (d.points.trim() === "" || !Number.isInteger(points) || Math.abs(points) > 100) {
      return setErr("النقاط عدد صحيح بين -١٠٠ و١٠٠.");
    }
    const param = d.param.trim() === "" ? null : Number(d.param);
    if (param !== null && !Number.isFinite(param)) return setErr("العتبة رقم أو فارغة.");

    setBusy(r.code);
    setErr(null);
    const { error } = await supabase
      .from("crm_score_rules")
      .update({ points, param, is_active: d.is_active })
      .eq("code", r.code);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      {err && <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{err}</p>}
      <table className="w-full text-right text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">الإشارة</th>
            <th className="px-4 py-3 font-medium">النقاط</th>
            <th className="px-4 py-3 font-medium">العتبة</th>
            <th className="px-4 py-3 font-medium">فعّالة</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rules.map((r) => {
            const d = drafts[r.code];
            const changed =
              d.points !== String(r.points) ||
              d.param !== (r.param === null ? "" : String(r.param)) ||
              d.is_active !== r.is_active;
            return (
              <tr key={r.code} className={d.is_active ? "" : "opacity-60"}>
                <td className="px-4 py-2">
                  <p className="font-medium text-gray-800">{r.label}</p>
                  <p className="text-xs text-gray-400" dir="ltr">{r.code}</p>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={d.points}
                    onChange={(e) => setDrafts((s) => ({ ...s, [r.code]: { ...s[r.code], points: e.target.value } }))}
                    className={`w-20 rounded border border-gray-300 px-2 py-1 font-semibold ${Number(d.points) < 0 ? "text-red-700" : "text-brand-700"}`}
                    dir="ltr"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={d.param}
                    placeholder="—"
                    onChange={(e) => setDrafts((s) => ({ ...s, [r.code]: { ...s[r.code], param: e.target.value } }))}
                    className="w-20 rounded border border-gray-300 px-2 py-1"
                    dir="ltr"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={d.is_active}
                    onChange={(e) => setDrafts((s) => ({ ...s, [r.code]: { ...s[r.code], is_active: e.target.checked } }))}
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={!changed || busy === r.code}
                    onClick={() => save(r)}
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
