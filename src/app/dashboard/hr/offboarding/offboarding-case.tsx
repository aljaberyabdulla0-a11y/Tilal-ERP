"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";

type Item = { id: string; department: string; title: string; auto_rule: string | null; status: string;
  completed_by_name: string | null; note: string | null };

function useRun() {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: (s: ReturnType<typeof createClient>) => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    const { error } = await fn(supabase);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    router.refresh();
    return true;
  }
  return { run, err, busy };
}

const STATUS_STYLE: Record<string, string> = {
  "قيد الموافقة": "bg-amber-100 text-amber-700",
  "معتمد": "bg-blue-100 text-blue-700",
  "مكتمل": "bg-gray-200 text-gray-700",
  "مرفوض": "bg-red-100 text-red-700",
  "ملغى": "bg-gray-200 text-gray-500",
};

export function NewTermination({ employees }: { employees: { id: string; full_name: string }[] }) {
  const { run, err, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ employee: "", type: "إنهاء خدمة", day: "", reason: "", successor: "" });
  const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm";
  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">+ طلب إنهاء خدمة</button>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-5">
      {err && <p className="rounded bg-red-50 p-2 text-xs text-red-700 sm:col-span-5">{err}</p>}
      <select className={input} value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
        <option value="">— الموظف —</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
      </select>
      <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
        {["إنهاء خدمة", "استقالة", "انتهاء عقد", "إنهاء خلال التجربة"].map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <input className={input} type="date" dir="ltr" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
      <select className={input} value={f.successor} onChange={(e) => setF({ ...f, successor: e.target.value })}>
        <option value="">— الخَلَف (لاحقاً) —</option>
        {employees.filter((e) => e.id !== f.employee).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
      </select>
      <input className={input} placeholder="السبب" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      <div className="flex gap-2 sm:col-span-5">
        <button disabled={busy || !f.employee || !f.day || !f.reason} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
          onClick={async () => {
            if (await run((s) => s.rpc("submit_termination", {
              p_employee: f.employee, p_type: f.type, p_last_day: f.day, p_reason: f.reason, p_successor: f.successor || null,
            }))) setOpen(false);
          }}>
          إرسال للموافقة
        </button>
        <button onClick={() => setOpen(false)} className="rounded border px-4 py-1.5 text-sm">إلغاء</button>
      </div>
    </div>
  );
}

export default function OffboardingCase({
  term, name, successorName, items, preview, candidates, isHr, isFinance, isAdmin,
}: {
  term: { id: string; term_type: string; last_working_day: string; reason: string; status: string; successor_id: string | null };
  name: string;
  successorName: string | null;
  items: Item[];
  preview: Record<string, unknown> | null;
  candidates: { id: string; full_name: string }[];
  isHr: boolean;
  isFinance: boolean;
  isAdmin: boolean;
}) {
  const { run, err, busy } = useRun();
  const pending = items.filter((i) => i.status === "معلّقة").length;
  // بند السلف يُسوّيه الإكمال نفسه بتعجيل الأقساط للكشف الأخير — لا يمنع الزرّ
  const blocking = items.filter((i) => i.status === "معلّقة" && i.auto_rule !== "advances").length;
  const num = (k: string) => Number((preview?.[k] as number | string | undefined) ?? 0);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-800">{name} <span className="text-sm font-normal text-gray-500">— {term.term_type}</span></p>
          <p className="text-xs text-gray-500">آخر يوم <span dir="ltr">{term.last_working_day}</span> · {term.reason}</p>
          <p className="mt-1 text-xs text-gray-500">
            الخَلَف: {successorName ?? <span className="text-amber-600">لم يُحدَّد</span>}
            {isHr && ["قيد الموافقة", "معتمد"].includes(term.status) && (
              <select disabled={busy} defaultValue="" className="ms-2 rounded border px-1 py-0.5 text-xs"
                onChange={(e) => e.target.value && run((s) => s.rpc("set_termination_successor", { p_id: term.id, p_successor: e.target.value }))}>
                <option value="">تغيير…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            )}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[term.status] ?? "bg-gray-100"}`}>{term.status}</span>
      </div>
      {err && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}

      {items.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-gray-700">إخلاء الطرف <span className="text-xs text-gray-400">({items.length - pending}/{items.length})</span></p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {items.map((i) => {
              const mine = isHr || (i.department === "المالية" && isFinance);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${i.status === "معلّقة" ? "bg-amber-400" : "bg-green-500"}`} />
                  <span className={i.status === "معلّقة" ? "" : "text-gray-400"}>{i.title}</span>
                  <span className="text-[11px] text-gray-400">{i.department}</span>
                  {i.auto_rule && i.status === "معلّقة" && <span className="text-[11px] text-blue-600">تلقائي</span>}
                  {i.status === "معلّقة" && !i.auto_rule && mine && term.status === "معتمد" && (
                    <button disabled={busy} className="ms-auto text-[11px] text-green-700 hover:underline"
                      onClick={() => run((s) => s.rpc("complete_clearance_item", { p_item: i.id, p_status: "منجزة", p_note: null }))}>
                      ✓ أُنجز
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm">
          <p className="mb-2 font-medium text-gray-700">{term.status === "مكتمل" ? "التسوية النهائية" : "معاينة التسوية"} — {String(preview.service_years ?? "")} سنة خدمة</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <span>راتب الشهر الأخير ({String(preview.final_basic_days ?? "")} يوماً): <b dir="ltr">{formatPrice(num("final_basic"))}</b></span>
            <span>عمولات معلّقة: <b dir="ltr">{formatPrice(num("pending_commissions"))}</b></span>
            <span>رصيد الإجازة: <b dir="ltr">{formatPrice(num("leave_total"))}</b></span>
            <span>مكافأة نهاية الخدمة: <b dir="ltr">{formatPrice(num("gratuity"))}</b></span>
            <span className="text-red-700">سلف متبقية: <b dir="ltr">{formatPrice(num("advances_remaining"))}</b></span>
            <span>صافٍ تقديري: <b dir="ltr">{formatPrice(num("estimated_net"))}</b></span>
          </div>
          {Boolean(preview.gratuity_note) && <p className="mt-2 text-xs text-amber-700">{String(preview.gratuity_note)}</p>}
          {num("unpaid_payrolls") > 0 && <p className="mt-1 text-xs text-gray-500">كشوف معتمدة غير مدفوعة: {formatPrice(num("unpaid_payrolls"))}</p>}
          {num("unpaid_expenses") > 0 && <p className="mt-1 text-xs text-gray-500">مصروفات معتمدة بانتظار الدفع: {formatPrice(num("unpaid_expenses"))}</p>}
        </div>
      )}

      {term.status === "معتمد" && isAdmin && (
        <button disabled={busy || blocking > 0 || !term.successor_id}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          title={blocking > 0 ? "أكمل إخلاء الطرف أولاً" : !term.successor_id ? "حدّد الخَلَف أولاً" : ""}
          onClick={() => confirm("إكمال إنهاء الخدمة؟ يُسلَّم الملف، ويُغلق الحساب، ويُبنى الكشف الأخير.") &&
            run((s) => s.rpc("complete_termination", { p_termination: term.id }))}>
          إكمال إنهاء الخدمة
        </button>
      )}
    </div>
  );
}
