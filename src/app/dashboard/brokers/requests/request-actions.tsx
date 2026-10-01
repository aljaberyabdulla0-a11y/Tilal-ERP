"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrokerReservationRequest, isOpenBrokerRequest } from "@/lib/types";

// ============================================================
// أزرار متابعة طلب الحجز — مدير العلاقات المسؤول أو الإدارة.
//
// كل فعل دالّةٌ في القاعدة (sql/117) تتحقّق من الصلاحية وحالة الطلب،
// فالزرّ هنا راحةٌ لا حماية. «تأكيد الحجز» يُنشئ حجزاً حقيقياً، ومنه
// يمضي المسار المعتاد إلى طلب البيع.
// ============================================================
export default function RequestActions({ request }: { request: BrokerReservationRequest }) {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"idle" | "confirm" | "reject">("idle");
  const [deposit, setDeposit] = useState("");
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    setMode("idle");
    router.refresh();
    return true;
  }

  if (request.reservation_id) {
    return (
      <Link
        href={`/dashboard/reservations/${request.reservation_id}`}
        className="text-xs font-bold text-brand-700 hover:underline"
      >
        فتح الحجز ومتابعة البيع ←
      </Link>
    );
  }

  if (!isOpenBrokerRequest(request.status)) return null;

  const inputCls =
    "rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <div className="space-y-2">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {request.status === "معلّق" && (
            <button
              onClick={() => run("broker_request_take", { p_id: request.id })}
              disabled={busy}
              className="rounded-lg border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              استلام
            </button>
          )}
          <button
            onClick={() => setMode("confirm")}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            تأكيد الحجز
          </button>
          <button
            onClick={() => setMode("reject")}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            رفض
          </button>
        </div>
      )}

      {mode === "confirm" && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3">
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-gray-600">
              العربون (اختياري)
              <input
                type="number"
                min={0}
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className={inputCls + " mt-1 block w-36"}
                dir="ltr"
              />
            </label>
            <label className="text-xs text-gray-600">
              نهاية مهلة الحجز
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className={inputCls + " mt-1 block"}
                dir="ltr"
              />
            </label>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة للوسيط (اختياري)"
            className={inputCls + " w-full"}
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                run("broker_request_confirm", {
                  p_id: request.id,
                  p_deposit: deposit ? Number(deposit) : null,
                  p_expiry: expiry || null,
                  p_note: note || null,
                })
              }
              disabled={busy}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "جارٍ..." : "احجز الوحدة"}
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-gray-500">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2 rounded-xl bg-red-50 p-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="سبب الرفض — يصل للوسيط"
            className={inputCls + " w-full"}
          />
          <div className="flex gap-2">
            <button
              onClick={() => run("broker_request_reject", { p_id: request.id, p_reason: note })}
              disabled={busy || !note.trim()}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              رفض الطلب
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-gray-500">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
