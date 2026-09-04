"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ADVANCE_STATUS_COLORS,
  ADVANCE_STATUS_HINTS,
  AdvanceSummary,
  formatPrice,
} from "@/lib/types";

// ============================================================
// سلف الموظف — الطلب والاعتماد والصرف والمتابعة.
//
// مكوّن واحد لطرفَي المعاملة: الموظف يطلب ويتابع، والمدير يعتمد
// ويصرف. والحالة بينهما واحدة، فلو فُصلا لصار لكل شاشة تفسيرها
// الخاص لـ«معتمدة».
//
// ⚠️ لا حساب هنا: المتبقّي وجدول الأقساط يأتيان محسوبَين من
// القاعدة. والقيود تكتبها الدوالّ — لا الشاشة.
// ============================================================
export default function AdvancesPanel({
  employeeId,
  advances,
  isAdmin,
  compact = false,
}: {
  employeeId: string;
  advances: AdvanceSummary[];
  isAdmin: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ amount: "", installments: "3", reason: "" });

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

  async function request() {
    const amount = Number(form.amount);
    const n = Number(form.installments);
    if (!amount || amount <= 0) return setErr("اكتب مبلغ السلفة.");
    if (!n || n < 1 || n > 36) return setErr("عدد الأقساط بين ١ و٣٦.");

    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("request_advance", {
      p_employee: employeeId,
      p_amount: amount,
      p_installments: n,
      p_reason: form.reason.trim() || null,
      p_start_period: null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setAsking(false);
    setForm({ amount: "", installments: "3", reason: "" });
    router.refresh();
  }

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  const open = advances.filter((a) => a.status === "مصروفة");
  const owed = open.reduce((s, a) => s + Number(a.remaining), 0);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold text-gray-800">
            <span className="material-symbols-outlined text-[20px] text-brand-600">
              payments
            </span>
            السلف
          </h3>
          {owed > 0 && (
            <p className="mt-0.5 text-xs text-gray-500">
              المتبقّي على {isAdmin ? "الموظف" : "ذمّتك"}:{" "}
              <b className="text-amber-700" dir="ltr">
                {formatPrice(owed)}
              </b>
            </p>
          )}
        </div>

        {!asking && (
          <button
            onClick={() => {
              setAsking(true);
              setErr(null);
            }}
            className="rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
          >
            {isAdmin ? "+ سلفة للموظف" : "+ طلب سلفة"}
          </button>
        )}
      </div>

      {asking && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                المبلغ (د.ع)
              </label>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                type="number" min={0} dir="ltr" autoFocus
                className={input + " w-full text-start"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                عدد الأقساط
              </label>
              <input
                value={form.installments}
                onChange={(e) => setForm({ ...form, installments: e.target.value })}
                type="number" min={1} max={36} dir="ltr"
                className={input + " w-full text-start"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                السبب (اختياري)
              </label>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className={input + " w-full"}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            القسط يُخصم من الراتب تلقائياً ابتداءً من الشهر القادم، ولا يُخصم
            أكثر من المتبقّي.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={request}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "جارٍ…" : "إرسال الطلب"}
            </button>
            <button
              onClick={() => setAsking(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {advances.length === 0 ? (
        <p className="text-sm text-gray-400">لا سلف.</p>
      ) : (
        <div className="space-y-2">
          {advances.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 p-3"
            >
              <div className="min-w-0">
                <p className="font-bold text-gray-800" dir="ltr">
                  {formatPrice(a.amount)}
                </p>
                <p className="truncate text-[11px] text-gray-500">
                  {a.installments} أقساط
                  {a.reason && ` · ${a.reason}`}
                  {a.next_due && ` · القسط القادم ${a.next_due}`}
                </p>
              </div>

              <span
                title={ADVANCE_STATUS_HINTS[a.status]}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  ADVANCE_STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {a.status}
              </span>

              {a.status === "مصروفة" && (
                <span className="text-xs text-gray-500">
                  سُدّد <b dir="ltr" className="text-green-700">{formatPrice(a.collected)}</b>
                  {" · "}المتبقّي{" "}
                  <b dir="ltr" className="text-amber-700">{formatPrice(a.remaining)}</b>
                </span>
              )}

              {isAdmin && (
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  {a.status === "معلّقة" && (
                    <>
                      <button
                        onClick={() =>
                          call("approve_advance", { p_id: a.id },
                            "اعتماد السلفة؟ سيُولَّد جدول أقساطها — ولا يخرج نقدٌ بعد.")
                        }
                        disabled={busy}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                      >
                        اعتماد
                      </button>
                      <button
                        onClick={() => {
                          const r = window.prompt("سبب الإلغاء:", "");
                          if (r && r.trim())
                            call("cancel_advance", { p_id: a.id, p_reason: r });
                        }}
                        disabled={busy}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                      >
                        رفض
                      </button>
                    </>
                  )}

                  {a.status === "معتمدة" && (
                    <button
                      onClick={() =>
                        call("disburse_advance", { p_id: a.id, p_method: "نقد", p_date: null },
                          "تسجيل صرف السلفة نقداً؟ سينقص الصندوق وتُقيَّد ذمّة على الموظف.")
                      }
                      disabled={busy}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                    >
                      صرف نقداً
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
      )}

      {!compact && (
        <p className="mt-3 text-[11px] text-gray-400">
          السلفة ذمّة على الموظف لا مصروف على الشركة: تُقيَّد على حساب «سلف
          الموظفين» عند الصرف، ويُسقطها كل قسط يُخصم من الراتب.
        </p>
      )}
    </div>
  );
}
