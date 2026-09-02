"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PAYROLL_DEDUCTION_CATEGORIES,
  PAYROLL_EARNING_CATEGORIES,
  PAYROLL_LINE_ICONS,
  PAYROLL_STATE_COLORS,
  PAYROLL_STATE_HINTS,
  Payroll,
  PayrollLine,
  formatPrice,
  sumLines,
} from "@/lib/types";

// ============================================================
// تفاصيل كشف الراتب: بنوده، وما يُضاف إليه، وقرار اعتماده.
//
// مكوّن واحد لثلاث حالات لأن الكشف واحد وإنما تتبدّل حرّيتك فيه:
//   مسودة : تُضاف البنود وتُحذف، ويُعتمد.
//   معتمد : يُقرأ ويُدفع، ويُعاد فتحه ما لم يُدفع منه شيء.
//   مقفل  : يُقرأ لا غير.
//
// الأزرار تتبع الحالة، والقاعدة تفرض الشيء نفسه بحرّاس (sql/051)
// — فالإخفاء راحةٌ لا حماية.
// ============================================================
export default function PayrollDetail({
  payroll,
  lines,
  paid,
  canManage,
}: {
  payroll: Payroll;
  lines: PayrollLine[];
  paid: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<"استحقاق" | "استقطاع" | null>(null);
  const [form, setForm] = useState({ category: "", description: "", amount: "" });

  const draft = payroll.state === "مسودة";
  const locked = payroll.state === "مقفل";

  const earnings = lines.filter((l) => l.kind === "استحقاق");
  const deductions = lines.filter((l) => l.kind === "استقطاع");
  const gross = sumLines(lines, "استحقاق");
  const totalDed = sumLines(lines, "استقطاع");

  async function call(fn: string, args: Record<string, unknown>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  async function addLine() {
    if (!form.category) {
      setErr("اختر نوع البند.");
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setErr("اكتب مبلغاً أكبر من صفر.");
      return;
    }

    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("add_payroll_line", {
      p_payroll: payroll.id,
      p_kind: adding,
      p_category: form.category,
      p_description: form.description.trim() || null,
      p_amount: amount,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setAdding(null);
    setForm({ category: "", description: "", amount: "" });
    router.refresh();
  }

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // صفّ بند واحد
  function Line({ l }: { l: PayrollLine }) {
    const minus = l.kind === "استقطاع";
    return (
      <div className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-0">
        <span
          className={`material-symbols-outlined text-[18px] ${
            minus ? "text-red-400" : "text-green-500"
          }`}
        >
          {PAYROLL_LINE_ICONS[l.category] ?? "circle"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800">
            {l.description || l.category}
          </span>
          <span className="block text-[11px] text-gray-400">
            {l.category}
            {l.manual && l.created_by_name && ` · أضافه ${l.created_by_name}`}
          </span>
        </span>

        <span
          className={`shrink-0 text-sm font-semibold ${
            minus ? "text-red-700" : "text-gray-800"
          }`}
          dir="ltr"
        >
          {minus ? "−" : "+"} {formatPrice(l.amount)}
        </span>

        {draft && canManage && (
          <button
            onClick={() =>
              call("remove_payroll_line", { p_line: l.id }, "حذف هذا البند؟")
            }
            disabled={busy}
            title="حذف البند"
            aria-label="حذف البند"
            className="shrink-0 rounded p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      {/* ===== الترويسة: الشهر والحالة والقرار ===== */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <span className="text-xs text-gray-400">كشف شهر</span>
          <p className="text-lg font-bold text-gray-800" dir="ltr">
            {payroll.period}
          </p>
        </div>

        <span
          title={PAYROLL_STATE_HINTS[payroll.state]}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            PAYROLL_STATE_COLORS[payroll.state] ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {payroll.state}
        </span>

        {!draft && (
          <span className="text-xs text-gray-400">
            المدفوع <b dir="ltr" className="text-green-700">{formatPrice(paid)}</b>
          </span>
        )}

        {canManage && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {draft && (
              <button
                onClick={() =>
                  call(
                    "approve_payroll",
                    { p_id: payroll.id },
                    "اعتماد الكشف؟ سيدخل دفاتر الشركة كدَين مستحق، وتتجمّد أرقامه."
                  )
                }
                disabled={busy}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                اعتماد الكشف
              </button>
            )}

            {payroll.state === "معتمد" && paid === 0 && (
              <button
                onClick={() =>
                  call(
                    "reopen_payroll",
                    { p_id: payroll.id },
                    "إعادة الكشف مسوّدة؟ سيُسحب قيده من الدفاتر ليُعاد حسابه."
                  )
                }
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                إعادة فتح
              </button>
            )}

            {payroll.state === "معتمد" && (
              <button
                onClick={() =>
                  call(
                    "lock_payroll",
                    { p_id: payroll.id },
                    "إقفال الكشف نهائياً؟ لن يُعدَّل ولن يُعاد فتحه بعدها."
                  )
                }
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                إقفال
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== البنود ===== */}
      <div className="grid grid-cols-1 gap-x-8 px-5 py-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-gray-500">
            <span>الاستحقاقات</span>
            <b dir="ltr" className="text-green-700">{formatPrice(gross)}</b>
          </h4>
          {earnings.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">لا استحقاقات.</p>
          ) : (
            earnings.map((l) => <Line key={l.id} l={l} />)
          )}
          {draft && canManage && (
            <button
              onClick={() => {
                setAdding("استحقاق");
                setForm({ category: "بدل", description: "", amount: "" });
                setErr(null);
              }}
              className="mt-2 text-xs font-medium text-brand-600 hover:underline"
            >
              + إضافة بدل أو مكافأة
            </button>
          )}
        </div>

        <div className="mt-6 md:mt-0">
          <h4 className="mb-1 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-gray-500">
            <span>الاستقطاعات</span>
            <b dir="ltr" className="text-red-700">{formatPrice(totalDed)}</b>
          </h4>
          {deductions.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">لا استقطاعات.</p>
          ) : (
            deductions.map((l) => <Line key={l.id} l={l} />)
          )}
          {draft && canManage && (
            <button
              onClick={() => {
                setAdding("استقطاع");
                setForm({ category: "استقطاع آخر", description: "", amount: "" });
                setErr(null);
              }}
              className="mt-2 text-xs font-medium text-brand-600 hover:underline"
            >
              + إضافة استقطاع
            </button>
          )}
        </div>
      </div>

      {/* ===== نموذج البند اليدوي ===== */}
      {adding && (
        <div className="mx-5 mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">
            {adding === "استحقاق" ? "إضافة استحقاق" : "إضافة استقطاع"}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={input}
            >
              {(adding === "استحقاق"
                ? PAYROLL_EARNING_CATEGORIES
                : PAYROLL_DEDUCTION_CATEGORIES
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="الوصف (اختياري)"
              className={input}
            />
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              type="number"
              min={0}
              dir="ltr"
              placeholder="المبلغ"
              className={input + " text-start"}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={addLine}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "جارٍ…" : "إضافة"}
            </button>
            <button
              onClick={() => setAdding(null)}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* ===== الصافي ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-4">
        <span className="text-sm text-gray-500">
          {formatPrice(gross)} <span className="text-gray-400">−</span>{" "}
          {formatPrice(totalDed)} =
        </span>
        <span className="text-xl font-bold text-gray-800" dir="ltr">
          {formatPrice(payroll.net)} د.ع
        </span>
      </div>

      {locked && (
        <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-400">
          هذا الكشف مقفل — سجلٌّ تاريخي لا يُعدَّل.
        </p>
      )}

      {err && (
        <p className="border-t border-gray-100 bg-red-50 px-5 py-2.5 text-xs text-red-700">
          {err}
        </p>
      )}
    </div>
  );
}
