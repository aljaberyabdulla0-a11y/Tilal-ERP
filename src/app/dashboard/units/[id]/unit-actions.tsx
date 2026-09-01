"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { canReserve, canSell } from "@/lib/types";

// ============================================================
// أفعال الوحدة: حجز، بيع، إلغاء حجز، إيقاف ورفع إيقاف.
//
// الأزرار تظهر حسب الحالة (canReserve/canSell)، لكن الاعتماد ليس
// عليها: القاعدة تفرض نفس القواعد بمحفّزات، فحتى لو استُدعي
// الطلب مباشرة يُرفض (sql/044). الإخفاء راحةٌ لا حماية.
// ============================================================
export default function UnitActions({
  unitId,
  status,
  blockedReason,
  activeReservationId,
  isAdmin,
  canEdit,
  salePending = false,
}: {
  unitId: string;
  status: string;
  blockedReason: string | null;
  activeReservationId: string | null;
  isAdmin: boolean;
  canEdit: boolean;
  // طلب بيع معلّق: البتّ فيه من زرّ الطلب لا من هنا، فلا يبقى
  // للبيع بابان — أحدهما يترك الطلب معلّقاً بعد وقوع البيع.
  salePending?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");

  // العملاء يأتون بنطاق المستخدم — الموظف يرى عملاءه وحدهم
  useEffect(() => {
    if (!open) return;
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .limit(500)
      .then(({ data }) => setClients((data ?? []) as { id: string; name: string }[]));
  }, [open, supabase]);

  // مهلة افتراضية أسبوعان — رقم يُعدَّل لا يُفرض
  useEffect(() => {
    if (!open || expiry) return;
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setExpiry(d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" }));
  }, [open, expiry]);

  async function reserve() {
    setErr(null);
    if (!clientId) {
      setErr("اختر العميل.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("reservations").insert({
      unit_id: unitId,
      client_id: clientId,
      amount: amount ? Number(amount) : null,
      expiry_date: expiry || null,
      notes: notes.trim() || null,
      status: "حجز",
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOpen(false);
    setClientId("");
    setAmount("");
    setNotes("");
    router.refresh();
  }

  async function setReservationStatus(next: string) {
    if (!activeReservationId) return;
    const ask =
      next === "بيع مكتمل"
        ? "تأكيد البيع؟ ستصبح الوحدة مباعة ولا تقبل حجزاً جديداً."
        : "إلغاء الحجز؟ ستعود الوحدة متاحة.";
    if (!window.confirm(ask)) return;

    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("reservations")
      .update({ status: next })
      .eq("id", activeReservationId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  async function toggleBlock() {
    setErr(null);
    if (status === "موقوفة") {
      if (!window.confirm("رفع الإيقاف؟ ستعود الوحدة متاحة للحجز.")) return;
      setBusy(true);
      const { error } = await supabase
        .from("units")
        .update({ status: "متاحة", blocked_reason: null })
        .eq("id", unitId);
      setBusy(false);
      if (error) setErr(error.message);
      else router.refresh();
      return;
    }

    const reason = window.prompt("سبب الإيقاف:", blockedReason ?? "");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("units")
      .update({ status: "موقوفة", blocked_reason: reason.trim() })
      .eq("id", unitId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canReserve(status) && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            حجز الوحدة
          </button>
        )}

        {canSell(status) && activeReservationId && canEdit && (
          <>
            {!salePending && (
              <button
                onClick={() => setReservationStatus("بيع مكتمل")}
                disabled={busy}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                إتمام البيع
              </button>
            )}
            <button
              onClick={() => setReservationStatus("ملغى")}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              إلغاء الحجز
            </button>
          </>
        )}

        {isAdmin && status !== "مباعة" && (
          <button
            onClick={toggleBlock}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {status === "موقوفة" ? "رفع الإيقاف" : "إيقاف"}
          </button>
        )}
      </div>

      {err && !open && (
        <p className="w-full rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-brand-700">حجز الوحدة</h3>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              العميل *
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={input + " mb-3"}
            >
              <option value="">— اختر —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              مبلغ الحجز (د.ع)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min={0}
              dir="ltr"
              className={input + " mb-3"}
            />

            <label className="mb-1 block text-xs font-medium text-gray-600">
              تنتهي المهلة في
            </label>
            <input
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              type="date"
              className={input + " mb-1"}
            />
            <p className="mb-3 text-[11px] text-gray-500">
              بعد هذا التاريخ يظهر الحجز «انتهت المهلة» ليُتَّخذ فيه قرار.
            </p>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              ملاحظات
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={input + " mb-4"}
            />

            {err && (
              <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {err}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={reserve}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "جارٍ…" : "تأكيد الحجز"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
