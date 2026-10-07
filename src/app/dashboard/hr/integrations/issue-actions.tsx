"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// أداتا المدير العام في فحص التكامل (sql/167) — القرار في القاعدة
export default function IssueAction({ kind, employeeId }: { kind: string; employeeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const action =
    kind === "الدور لا يطابق المنصب"
      ? { label: "طبّق دور المنصب", rpc: "apply_position_role", confirm: "يُمنح الموظف دور منصبه وصلاحياته. متابعة؟" }
      : kind === "حساب دخول مفتوح"
        ? { label: "أغلق الحساب", rpc: "revoke_employee_access", confirm: "يُحظر دخول هذا الحساب نهائياً. متابعة؟" }
        : null;
  if (!action) return null;

  async function go() {
    if (!action || !confirm(action.confirm)) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc(action.rpc, { p_employee: employeeId });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button onClick={go} disabled={busy}
        className="whitespace-nowrap rounded-lg border border-brand-600 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
        {busy ? "…" : action.label}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
