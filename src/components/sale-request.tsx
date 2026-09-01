"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// طلب تحويل حجز إلى بيع — وقرار الإدارة فيه.
//
// مكوّن واحد لطرفَي المعاملة عمداً: الموظف يرفع، والإدارة تبتّ،
// والحالة بينهما واحدة. لو فُصلا لصار لكل شاشة تفسيرها الخاص
// لـ«معلّق» ولاختلفا يوماً.
//
// كل شيء يمرّ بدالتين في القاعدة (sql/050) لا بتعديل مباشر على
// صفّ الحجز — لأن الموظف لا يملك تعديل الحجوزات أصلاً، وهذا
// المقصود: لو ملك، لكتب «بيع مكتمل» بنفسه وصار الطلب زينة.
// ============================================================
export default function SaleRequest({
  reservationId,
  status,
  requestStatus,
  requestNote,
  rejectReason,
  canDecide,
  canRequest,
}: {
  reservationId: string;
  status: string;                       // حالة الحجز نفسه
  requestStatus: string | null;         // حالة الطلب: معلّق | مقبول | مرفوض
  requestNote: string | null;
  rejectReason: string | null;
  canDecide: boolean;                   // الإدارة: المدير ومشرف المشروع
  canRequest: boolean;                  // صاحب الصفقة
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const pending = requestStatus === "معلّق";
  const rejected = requestStatus === "مرفوض";

  async function submit() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("request_unit_sale", {
      p_res: reservationId,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setAsking(false);
    setNote("");
    router.refresh();
  }

  async function decide(approve: boolean) {
    let reason: string | null = null;
    if (approve) {
      if (!window.confirm("الموافقة على البيع؟ ستصبح الوحدة مباعة وتُفتح فاتورتها."))
        return;
    } else {
      // السبب مطلوب في القاعدة أيضاً — الموظف يحتاج يعرف ماذا يصحّح
      reason = window.prompt("سبب الرفض:", "");
      if (!reason || !reason.trim()) return;
    }

    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("decide_unit_sale", {
      p_res: reservationId,
      p_approve: approve,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  // حجزٌ انتهى أمره (بيع أو إلغاء) لا طلب عليه
  if (status !== "حجز") return null;

  const box = "w-full rounded-lg bg-red-50 p-2 text-xs text-red-700";

  // ===== طلب معلّق =====
  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          <span className="material-symbols-outlined text-[16px]">pending_actions</span>
          {canDecide ? "طلب بيع بانتظار قرارك" : "طلب البيع بانتظار موافقة الإدارة"}
        </span>

        {requestNote && (
          <span className="text-xs text-gray-500">«{requestNote}»</span>
        )}

        {canDecide && (
          <>
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              موافقة على البيع
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              رفض
            </button>
          </>
        )}

        {err && <p className={box}>{err}</p>}
      </div>
    );
  }

  // من لا يملك الصفقة لا يرى زرّ الطلب — يبقى الرفض ظاهراً لصاحبه
  if (!canRequest) return null;

  // ===== نموذج الطلب =====
  if (asking) {
    return (
      <div className="w-full rounded-xl border border-brand-200 bg-brand-50/40 p-3">
        <label className="mb-1 block text-xs font-medium text-gray-600">
          ملاحظة للإدارة (اختيارية)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
          placeholder="مثلاً: العميل دفع كامل المبلغ نقداً"
          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {err && <p className={box + " mb-2"}>{err}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "جارٍ الإرسال…" : "إرسال الطلب"}
          </button>
          <button
            onClick={() => setAsking(false)}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  // ===== زرّ الطلب (وسبب الرفض السابق إن وُجد) =====
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setAsking(true)}
        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
      >
        <span className="material-symbols-outlined text-[18px]">handshake</span>
        {rejected ? "إعادة طلب البيع" : "طلب تحويلها إلى بيع"}
      </button>

      {rejected && rejectReason && (
        <span className="rounded-full bg-red-100 px-3 py-1 text-xs text-red-700">
          رُفض سابقاً: {rejectReason}
        </span>
      )}

      {err && <p className={box}>{err}</p>}
    </div>
  );
}
