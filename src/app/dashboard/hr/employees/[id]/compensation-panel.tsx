"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";

type Allowance = { id: string; name: string; amount: number; start_date: string; end_date: string | null; prorate: boolean };
type Bonus = { id: string; bonus_type: string; amount: number; reason: string; payable_period: string; status: string; payroll_id: string | null };
type Allocation = { id: string; project_id: string | null; role: string | null; allocation_pct: number; start_date: string; end_date: string | null };

const STATUS_STYLE: Record<string, string> = {
  "قيد الموافقة": "bg-amber-100 text-amber-700",
  "معتمد": "bg-green-100 text-green-700",
  "مرفوض": "bg-red-100 text-red-700",
  "ملغى": "bg-gray-200 text-gray-600",
};

// التعويضات (sql/157–158): البدلات الثابتة، المكافآت (تمرّ بسلسلة موافقة)،
// والتوزيع على المشاريع لتحليل الكلفة. المبالغ تُحسب في القاعدة عند بناء الكشف.
export default function CompensationPanel({
  employeeId,
  allowances,
  bonuses,
  allocations,
  projects,
  canEdit,
}: {
  employeeId: string;
  allowances: Allowance[];
  bonuses: Bonus[];
  allocations: Allocation[];
  projects: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [al, setAl] = useState({ name: "", amount: "", start: "", end: "", prorate: true });
  const [bn, setBn] = useState({ type: "أداء", amount: "", reason: "", period: "" });
  const [pa, setPa] = useState({ project: "", pct: "", role: "", start: "", end: "" });
  const today = new Date().toISOString().slice(0, 10);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    router.refresh();
    return true;
  }

  const input = "rounded border border-gray-300 px-2 py-1 text-xs";
  const pname = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? "—" : "عام / الشركة");
  const allocated = allocations
    .filter((a) => a.start_date <= today && (!a.end_date || a.end_date >= today))
    .reduce((s, a) => s + Number(a.allocation_pct), 0);

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold text-gray-800">التعويضات</h3>
      {err && <p className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* البدلات */}
        <section>
          <p className="mb-2 text-sm font-medium text-gray-700">البدلات الثابتة</p>
          <ul className="space-y-1 text-sm">
            {allowances.length === 0 && <li className="text-xs text-gray-400">لا بدلات.</li>}
            {allowances.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-center gap-2 ${a.end_date && a.end_date < today ? "opacity-50" : ""}`}>
                <span>{a.name}</span>
                <span className="font-medium" dir="ltr">{formatPrice(a.amount)}</span>
                <span className="text-[11px] text-gray-400" dir="ltr">{a.start_date} → {a.end_date ?? "…"}</span>
                {canEdit && !a.end_date && (
                  <button disabled={busy} className="ms-auto text-[11px] text-gray-400 hover:text-red-600"
                    onClick={() => run(() => supabase.from("employee_allowances").update({ end_date: today }).eq("id", a.id))}>
                    إيقاف
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded bg-gray-50 p-2">
              <input className={input} placeholder="الاسم (سكن، نقل…)" value={al.name} onChange={(e) => setAl({ ...al, name: e.target.value })} />
              <input className={input} type="number" min="0" dir="ltr" placeholder="المبلغ الشهري" value={al.amount} onChange={(e) => setAl({ ...al, amount: e.target.value })} />
              <input className={input} type="date" dir="ltr" value={al.start} onChange={(e) => setAl({ ...al, start: e.target.value })} />
              <input className={input} type="date" dir="ltr" value={al.end} onChange={(e) => setAl({ ...al, end: e.target.value })} />
              <label className="col-span-2 flex items-center gap-1 text-[11px] text-gray-600">
                <input type="checkbox" checked={al.prorate} onChange={(e) => setAl({ ...al, prorate: e.target.checked })} />
                يُجزَّأ بأيام الشهر
              </label>
              <button disabled={busy || !al.name || !al.amount || !al.start}
                className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
                onClick={async () => {
                  if (await run(() => supabase.from("employee_allowances").insert({
                    employee_id: employeeId, name: al.name.trim(), amount: Number(al.amount),
                    start_date: al.start, end_date: al.end || null, prorate: al.prorate,
                  }))) setAl({ name: "", amount: "", start: "", end: "", prorate: true });
                }}>
                + بدل
              </button>
            </div>
          )}
        </section>

        {/* المكافآت */}
        <section>
          <p className="mb-2 text-sm font-medium text-gray-700">المكافآت</p>
          <ul className="space-y-1 text-sm">
            {bonuses.length === 0 && <li className="text-xs text-gray-400">لا مكافآت.</li>}
            {bonuses.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2">
                <span>{b.bonus_type}</span>
                <span className="font-medium" dir="ltr">{formatPrice(b.amount)}</span>
                <span className="text-[11px] text-gray-400" dir="ltr">{b.payable_period}</span>
                <span className={`rounded px-1.5 text-[11px] ${STATUS_STYLE[b.status] ?? "bg-gray-100"}`}>{b.status}</span>
                {b.payroll_id && <span className="text-[11px] text-green-600">في الكشف</span>}
                <span className="w-full text-[11px] text-gray-500">{b.reason}</span>
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded bg-gray-50 p-2">
              <select className={input} value={bn.type} onChange={(e) => setBn({ ...bn, type: e.target.value })}>
                {["أداء", "سنوية", "مكافأة خاصة", "أخرى"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className={input} type="number" min="0" dir="ltr" placeholder="المبلغ" value={bn.amount} onChange={(e) => setBn({ ...bn, amount: e.target.value })} />
              <input className={input} type="month" dir="ltr" value={bn.period} onChange={(e) => setBn({ ...bn, period: e.target.value })} />
              <input className={input} placeholder="السبب" value={bn.reason} onChange={(e) => setBn({ ...bn, reason: e.target.value })} />
              <button disabled={busy || !bn.amount || !bn.period || !bn.reason}
                className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
                onClick={async () => {
                  if (await run(() => supabase.rpc("propose_bonus", {
                    p_employee: employeeId, p_amount: Number(bn.amount), p_reason: bn.reason,
                    p_period: bn.period, p_type: bn.type,
                  }))) setBn({ type: "أداء", amount: "", reason: "", period: "" });
                }}>
                اقتراح مكافأة — للموافقة
              </button>
            </div>
          )}
        </section>

        {/* التوزيع على المشاريع */}
        <section>
          <p className="mb-2 text-sm font-medium text-gray-700">
            التوزيع على المشاريع <span className="text-xs text-gray-400">(اليوم {allocated}٪)</span>
          </p>
          <ul className="space-y-1 text-sm">
            {allocations.length === 0 && <li className="text-xs text-gray-400">لا توزيع — كلفته على مشروع كشفه.</li>}
            {allocations.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-center gap-2 ${a.end_date && a.end_date < today ? "opacity-50" : ""}`}>
                <span>{pname(a.project_id)}</span>
                <span className="font-medium">{a.allocation_pct}٪</span>
                {a.role && <span className="text-[11px] text-gray-500">{a.role}</span>}
                <span className="text-[11px] text-gray-400" dir="ltr">{a.start_date} → {a.end_date ?? "…"}</span>
                {canEdit && !a.end_date && (
                  <button disabled={busy} className="ms-auto text-[11px] text-gray-400 hover:text-red-600"
                    onClick={() => run(() => supabase.from("employee_project_allocations").update({ end_date: today }).eq("id", a.id))}>
                    إنهاء
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded bg-gray-50 p-2">
              <select className={input} value={pa.project} onChange={(e) => setPa({ ...pa, project: e.target.value })}>
                <option value="">عام / الشركة</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className={input} type="number" min="1" max="100" dir="ltr" placeholder="النسبة ٪" value={pa.pct} onChange={(e) => setPa({ ...pa, pct: e.target.value })} />
              <input className={input} type="date" dir="ltr" value={pa.start} onChange={(e) => setPa({ ...pa, start: e.target.value })} />
              <input className={input} placeholder="الدور (اختياري)" value={pa.role} onChange={(e) => setPa({ ...pa, role: e.target.value })} />
              <button disabled={busy || !pa.pct || !pa.start}
                className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
                onClick={async () => {
                  if (await run(() => supabase.from("employee_project_allocations").insert({
                    employee_id: employeeId, project_id: pa.project || null, allocation_pct: Number(pa.pct),
                    role: pa.role || null, start_date: pa.start,
                  }))) setPa({ project: "", pct: "", role: "", start: "", end: "" });
                }}>
                + توزيع
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
