"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrokerRequestDetail, RM_RECOMMENDATIONS, isOpenBrokerRequest } from "@/lib/types";

// ============================================================
// أفعال طلب الحجز (sql/128) — المراجعة منفصلة عن القرار:
//   • الـRM: استلام، توصية، سؤال الوسيط، ملاحظة داخلية.
//   • المشرف/المدير: الموافقة (= حجزٌ ذرّي في دالّة واحدة) أو الرفض بسبب.
// كل زرّ دالّةٌ في القاعدة تفحص الصلاحية والحالة بنفسها — الإخفاء هنا راحة
// لا حماية.
// ============================================================
type Mode = "idle" | "review" | "ask" | "note" | "approve" | "reject";

export default function RequestActions({ d }: { d: BrokerRequestDetail }) {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState("");
  const [rec, setRec] = useState<string>(RM_RECOMMENDATIONS[0]);
  const [price, setPrice] = useState(String(d.requested_price ?? d.unit_price ?? ""));
  const [deposit, setDeposit] = useState("");
  const [expiry, setExpiry] = useState("");
  const [internal, setInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpenBrokerRequest(d.status)) return null;

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMode("idle");
    setText("");
    router.refresh();
  }

  const open = (m: Mode) => {
    setError(null);
    setText("");
    setMode(m);
  };

  const btn = "rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50";
  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
  const noReview = d.can_approve && !d.rm_reviewed_at && d.rm_id;

  return (
    <div className="space-y-3">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {d.can_handle && d.status === "معلّق" && (
            <button disabled={busy} onClick={() => run("broker_request_take", { p_id: d.id })}
              className={btn + " border border-brand-600 text-brand-700 hover:bg-brand-50"}>
              استلام الطلب
            </button>
          )}
          {d.can_review && d.status !== "بحاجة لمعلومات" && (
            <button onClick={() => open("review")} className={btn + " border border-brand-600 text-brand-700 hover:bg-brand-50"}>
              {d.rm_reviewed_at ? "تعديل التوصية" : "مراجعة وتوصية"}
            </button>
          )}
          {d.can_handle && d.status !== "بحاجة لمعلومات" && (
            <button onClick={() => open("ask")} className={btn + " border border-purple-500 text-purple-700 hover:bg-purple-50"}>
              طلب معلومات من الوسيط
            </button>
          )}
          {d.can_handle && (
            <button onClick={() => open("note")} className={btn + " text-gray-600 hover:bg-gray-100"}>
              ملاحظة
            </button>
          )}
          {d.can_approve && (
            <>
              <button onClick={() => open("approve")} className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"}>
                موافقة وحجز الوحدة
              </button>
              <button onClick={() => open("reject")} className={btn + " bg-red-50 text-red-700 hover:bg-red-100"}>
                رفض
              </button>
            </>
          )}
          {!d.can_approve && d.can_review && (
            <p className="w-full text-xs text-gray-500">
              القرار النهائي لمشرف المشروع ({d.supervisor_name ?? "—"}) — توصيتك تصله مع الطلب.
            </p>
          )}
        </div>
      )}

      {mode === "review" && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-4">
          <div className="flex flex-wrap gap-2">
            {RM_RECOMMENDATIONS.map((r) => (
              <label key={r} className={`cursor-pointer rounded-full px-3 py-1.5 text-sm ${rec === r ? "bg-brand-600 text-white" : "bg-white text-gray-600"}`}>
                <input type="radio" className="hidden" checked={rec === r} onChange={() => setRec(r)} />
                {r}
              </label>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={inputCls}
            placeholder={rec === "أوصي بالرفض" ? "سبب التوصية بالرفض (إلزامي)" : "ملاحظة المراجعة للمشرف (لا يراها الوسيط)"} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run("broker_request_review", { p_id: d.id, p_recommendation: rec, p_note: text || null })}
              className={btn + " bg-brand-600 text-white hover:bg-brand-700"}>
              {busy ? "..." : "إرسال للمشرف"}
            </button>
            <button onClick={() => setMode("idle")} className={btn + " text-gray-500"}>إلغاء</button>
          </div>
        </div>
      )}

      {mode === "ask" && (
        <div className="space-y-2 rounded-xl bg-purple-50 p-4">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={inputCls}
            placeholder="ما الذي تحتاج معرفته؟ يصل الوسيط إشعاراً ويجيب من طلباته" />
          <div className="flex gap-2">
            <button disabled={busy || !text.trim()} onClick={() => run("broker_request_ask_info", { p_id: d.id, p_question: text })}
              className={btn + " bg-purple-600 text-white hover:bg-purple-700"}>
              {busy ? "..." : "إرسال السؤال"}
            </button>
            <button onClick={() => setMode("idle")} className={btn + " text-gray-500"}>إلغاء</button>
          </div>
        </div>
      )}

      {mode === "note" && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-4">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={inputCls} placeholder="ملاحظة على الخطّ الزمني" />
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            داخلية (لا يراها الوسيط)
          </label>
          <div className="flex gap-2">
            <button disabled={busy || !text.trim()} onClick={() => run("broker_request_add_note", { p_id: d.id, p_note: text, p_internal: internal })}
              className={btn + " bg-brand-600 text-white hover:bg-brand-700"}>
              {busy ? "..." : "حفظ"}
            </button>
            <button onClick={() => setMode("idle")} className={btn + " text-gray-500"}>إلغاء</button>
          </div>
        </div>
      )}

      {mode === "approve" && (
        <div className="space-y-3 rounded-xl bg-emerald-50 p-4">
          {noReview && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              لم يراجعه مدير العلاقات بعد — يجوز لك القرار دون توصيته.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs text-gray-600">
              سعر البيع المعتمد
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls + " mt-1"} dir="ltr" />
            </label>
            <label className="text-xs text-gray-600">
              العربون (اختياري)
              <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} className={inputCls + " mt-1"} dir="ltr" />
            </label>
            <label className="text-xs text-gray-600">
              نهاية مهلة الحجز
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls + " mt-1"} dir="ltr" />
            </label>
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="ملاحظة للوسيط (اختياري)" />
          <p className="text-[11px] text-gray-500">
            الموافقة تُنشئ الحجز في الخطوة نفسها: إن تغيّرت حالة الوحدة لحظتها رُفض كل شيء ولم يُكتب شيء.
          </p>
          <div className="flex gap-2">
            <button disabled={busy}
              onClick={() => run("approve_broker_reservation_request", {
                p_id: d.id,
                p_price: price ? Number(price) : null,
                p_deposit: deposit ? Number(deposit) : null,
                p_expiry: expiry || null,
                p_note: text || null,
              })}
              className={btn + " bg-emerald-600 text-white hover:bg-emerald-700"}>
              {busy ? "..." : "اعتماد الحجز"}
            </button>
            <button onClick={() => setMode("idle")} className={btn + " text-gray-500"}>إلغاء</button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2 rounded-xl bg-red-50 p-4">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={inputCls}
            placeholder="سبب الرفض — إلزامي، ويصل الوسيط" />
          <div className="flex gap-2">
            <button disabled={busy || !text.trim()} onClick={() => run("broker_request_reject", { p_id: d.id, p_reason: text })}
              className={btn + " bg-red-600 text-white hover:bg-red-700"}>
              {busy ? "..." : "رفض الطلب"}
            </button>
            <button onClick={() => setMode("idle")} className={btn + " text-gray-500"}>إلغاء</button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
