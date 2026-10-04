"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";
import { fmt } from "@/lib/marketing-style";

// «ادفع» — للمالية. يشرح قبل الدفع ما سيُكتب في الدفتر (كما يفعل نموذج
// الحركات): من أين يخرج المال وعلى أيّ حساب يقع.
export default function PayExpense({
  id, code, amount, partners, arms,
}: { id: string; code: string; amount: number; partners: { id: string; name: string }[]; arms: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("نقد");
  const [partner, setPartner] = useState("");
  const [arm, setArm] = useState(arms[0]);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    setErr(null);
    setBusy(true);
    const { error } = await createClient().rpc("mkt_pay_expense", {
      p_id: id, p_method: method, p_partner: partner || null, p_arm: arm, p_date: date || null,
    });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-brand-600 bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700">
        ادفع
      </button>
    );
  }
  const from = partner ? `جاري الشريك (2500) — دفعه ${partners.find((p) => p.id === partner)?.name} من جيبه` : method === "بنك" ? "البنك (1200)" : "الصندوق (1100)";
  return (
    <div className="w-72 rounded-lg border border-brand-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-gray-800">دفع {code} — {fmt(amount)} د.ع</p>
      <div className="grid grid-cols-2 gap-2">
        <label>الطريقة<select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-0.5 w-full rounded border px-1 py-1"><option>نقد</option><option>بنك</option></select></label>
        <label>الذراع<select value={arm} onChange={(e) => setArm(e.target.value)} className="mt-0.5 w-full rounded border px-1 py-1">{arms.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="col-span-2">دفعه شريك من جيبه؟<select value={partner} onChange={(e) => setPartner(e.target.value)} className="mt-0.5 w-full rounded border px-1 py-1"><option value="">لا — الشركة</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="col-span-2">تاريخ الدفع<input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="mt-0.5 w-full rounded border px-1 py-1" /></label>
      </div>
      <p className="mt-2 rounded bg-gray-50 p-2 text-gray-600">سيُكتب قيد: مدين 5700 «تسويق» / دائن {from}.</p>
      {err && <p className="mt-2 text-red-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={pay} className="rounded bg-brand-600 px-3 py-1 font-semibold text-white disabled:opacity-50">{busy ? "…" : "ادفع"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-1">إلغاء</button>
      </div>
    </div>
  );
}
