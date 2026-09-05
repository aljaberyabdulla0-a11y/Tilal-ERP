"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  MonthCloseRow,
  PAYROLL_STATE_COLORS,
  formatPrice,
} from "@/lib/types";

// ============================================================
// معالج إغلاق الشهر.
//
// ثلاث خطوات في شاشة: ابنِ الكشوف جميعاً، راجع الجدول والشاذّ
// فيه، ثم اعتمد دفعة واحدة.
//
// ⚠️ الاعتماد الجماعي يمرّ بـ approve_payroll لكل كشف — كل
// حرّاسها تعمل ولا يُختصر شيء. وما يفشل يظهر باسمه وسببه ولا
// يُوقف البقيّة.
// ============================================================
export default function CloseWizard({
  period,
  rows,
}: {
  period: string;
  rows: MonthCloseRow[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [month, setMonth] = useState(period);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  async function run(fn: "build_all_payrolls" | "approve_all_payrolls") {
    if (
      fn === "approve_all_payrolls" &&
      !window.confirm(
        `اعتماد كل مسوّدات ${month}؟ ستدخل دفاتر الشركة وتتجمّد أرقامها.`
      )
    )
      return;

    setBusy(true);
    setErr(null);
    setReport(null);
    const { data, error } = await supabase.rpc(fn, { p_period: month });
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    const d = data as {
      built?: number; skipped?: number; approved?: number; failed?: number;
      errors?: string[];
    };
    const done = d.built ?? d.approved ?? 0;
    const bad = d.skipped ?? d.failed ?? 0;
    setReport(
      `${fn === "build_all_payrolls" ? "بُني" : "اعتُمد"} ${done}` +
        (bad > 0 ? ` · تعذّر ${bad}:\n${(d.errors ?? []).join("\n")}` : "")
    );
    router.refresh();
  }

  const drafts = rows.filter((r) => r.state === "مسودة").length;
  const missing = rows.filter((r) => !r.payroll_id).length;
  const flagged = rows.filter((r) => r.flags.length > 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.net), 0);

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">الشهر</label>
          <input
            type="month" dir="ltr" value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={input + " text-start"}
          />
        </div>
        <Link
          href={`/dashboard/hr/month-close?period=${month}`}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
        >
          عرض
        </Link>

        <button
          onClick={() => run("build_all_payrolls")}
          disabled={busy}
          className="ms-auto flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          {busy ? "…" : `بناء كشوف ${month}`}
        </button>

        <button
          onClick={() => run("approve_all_payrolls")}
          disabled={busy || drafts === 0}
          title={drafts === 0 ? "لا مسوّدات لاعتمادها" : undefined}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
        >
          اعتماد {drafts > 0 ? `${drafts} مسوّدة` : "الكل"}
        </button>
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      {report && (
        <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          {report}
        </pre>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="glass-card border-s-4 border-s-brand-500 p-5">
          <span className="text-sm text-gray-500">موظفون</span>
          <p className="mt-1 text-2xl font-bold text-gray-800">{rows.length}</p>
        </div>
        <div className={`glass-card border-s-4 p-5 ${missing > 0 ? "border-s-amber-500" : "border-s-green-500"}`}>
          <span className="text-sm text-gray-500">بلا كشف</span>
          <p className={`mt-1 text-2xl font-bold ${missing > 0 ? "text-amber-700" : "text-green-700"}`}>{missing}</p>
        </div>
        <div className={`glass-card border-s-4 p-5 ${flagged.length > 0 ? "border-s-red-500" : "border-s-green-500"}`}>
          <span className="text-sm text-gray-500">يحتاج مراجعة</span>
          <p className={`mt-1 text-2xl font-bold ${flagged.length > 0 ? "text-red-700" : "text-green-700"}`}>
            {flagged.length}
          </p>
        </div>
        <div className="glass-card border-s-4 border-s-blue-500 p-5">
          <span className="text-sm text-gray-500">إجمالي الصافي</span>
          <p className="mt-1 text-2xl font-bold text-gray-800" dir="ltr">{formatPrice(totalNet)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full min-w-[860px] text-start text-sm">
          <thead className="border-b bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">الموظف</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">الأساسي</th>
              <th className="px-4 py-3 font-medium">عمولات</th>
              <th className="px-4 py-3 font-medium">استقطاعات</th>
              <th className="px-4 py-3 font-medium">الصافي</th>
              <th className="px-4 py-3 font-medium">مراجعة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.employee_id}
                className={`border-b last:border-0 ${r.flags.length > 0 ? "bg-amber-50/40" : "hover:bg-gray-50"}`}
              >
                <td className="px-4 py-3 font-medium text-gray-800">
                  {r.payroll_id ? (
                    <Link href={`/dashboard/hr/payroll/${r.payroll_id}`} className="text-brand-700 hover:underline">
                      {r.full_name}
                    </Link>
                  ) : (
                    r.full_name
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      PAYROLL_STATE_COLORS[r.state] ?? "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {r.state}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700" dir="ltr">{formatPrice(r.basic)}</td>
                <td className="px-4 py-3 text-green-700" dir="ltr">{formatPrice(r.commissions)}</td>
                <td className="px-4 py-3 text-red-700" dir="ltr">{formatPrice(r.deductions)}</td>
                <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">{formatPrice(r.net)}</td>
                <td className="px-4 py-3">
                  {r.flags.length === 0 ? (
                    <span className="text-xs text-green-600">✓ سليم</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
