"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  AccountingPeriod,
  PERIOD_STATUS_COLORS,
  PERIOD_STATUS_HINTS,
  formatPrice,
} from "@/lib/types";

// ============================================================
// إقفال الشهور المحاسبية.
//
// القفل يُفرض في القاعدة بمحفّزات، لا هنا. هذه الشاشة تعرض الحالة
// وتنادي الدوالّ — وكل ما تمنعه القاعدة تمنعه ولو نُوديت الـAPI
// مباشرةً.
// ============================================================
export default function PeriodsManager({
  periods,
}: {
  periods: AccountingPeriod[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(fn: string, args: Record<string, unknown>, period: string) {
    setBusy(period);
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-start text-sm">
          <thead className="border-b bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">الشهر</th>
              <th className="px-4 py-3 font-medium">القيود</th>
              <th className="px-4 py-3 font-medium">حركة المدين</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">أقفلها</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const locked = p.status === "مقفل";
              const archived = p.status === "مؤرشف";
              const working = busy === p.period;
              return (
                <tr key={p.period} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800" dir="ltr">
                    {p.period}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.entries}</td>
                  <td className="px-4 py-3 text-gray-700" dir="ltr">
                    {formatPrice(p.total_debit)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={PERIOD_STATUS_HINTS[p.status]}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        PERIOD_STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.draft_payrolls > 0 && (
                      <span
                        title="الإقفال يشترط اعتماد كشوف الرواتب أو حذفها"
                        className="ms-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700"
                      >
                        {p.draft_payrolls} كشف مسوّدة
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {p.closed_by_name ?? "—"}
                    {p.closed_at && (
                      <span className="block text-gray-400" dir="ltr">
                        {p.closed_at.slice(0, 10)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {archived ? (
                      <span className="text-xs text-gray-400">نهائي</span>
                    ) : locked ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            const r = window.prompt(
                              `سبب إعادة فتح ${p.period}؟ (يُسجَّل في سجلّ التدقيق)`,
                              ""
                            );
                            if (r && r.trim())
                              call("reopen_period", { p_period: p.period, p_reason: r }, p.period);
                          }}
                          disabled={working}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                        >
                          إعادة فتح
                        </button>
                        <button
                          onClick={() =>
                            window.confirm(
                              `أرشفة ${p.period} نهائياً؟ لن تُفتح بعدها أبداً.`
                            ) && call("archive_period", { p_period: p.period }, p.period)
                          }
                          disabled={working}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 disabled:opacity-50"
                        >
                          أرشفة
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() =>
                          window.confirm(
                            `إقفال ${p.period}؟ لن يُكتب فيه قيد ولا يُحذف — ولا حتى من دوالّ النظام.`
                          ) &&
                          call("close_period", { p_period: p.period, p_note: null }, p.period)
                        }
                        disabled={working || p.draft_payrolls > 0}
                        title={
                          p.draft_payrolls > 0
                            ? "اعتمد كشوف الرواتب المسوّدة أو احذفها أولاً"
                            : undefined
                        }
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
                      >
                        {working ? "…" : "إقفال"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
