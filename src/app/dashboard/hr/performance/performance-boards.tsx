"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Named = { id: string; full_name: string };

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

const card = "rounded-2xl border bg-white p-5 shadow-sm";
const input = "rounded border border-gray-300 px-2 py-1 text-xs";

function bar(pct: number | null) {
  if (pct == null) return <span className="text-[11px] text-gray-400">—</span>;
  const w = Math.min(pct, 150) / 1.5;
  const color = pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-gray-100"><span className={`block h-full ${color}`} style={{ width: `${w}%` }} /></span>
      <span className="text-xs font-medium">{pct}%</span>
    </span>
  );
}

// ========== الأهداف ==========
export function TargetsBoard({
  month, targets, kpis, employees, departments, isHr,
}: { month: string; targets: Row[]; kpis: Row[]; employees: Named[]; departments: { id: string; name_ar: string }[]; isHr: boolean }) {
  const { run, err, busy } = useRun();
  const [f, setF] = useState({ owner: "employee", employee: "", department: "", kpi: kpis[0]?.code ?? "", target: "", weight: "1" });
  const kpi = (c: string) => kpis.find((k) => k.code === c);
  const who = (t: Row) =>
    t.employee_id ? employees.find((e) => e.id === t.employee_id)?.full_name ?? "—"
      : departments.find((d) => d.id === t.department_id)?.name_ar ?? "—";

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">الأهداف — {month}</h3>
      <p className="mb-3 text-xs text-gray-500">
        الفعلي يُحسب من مصدر المؤشر (CRM، المهام، الدوام، التوظيف) أو يُدخله المدير للمؤشر اليدوي. لا يحدّد أحد هدفه ولا يُدخل فعليَّه.
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-gray-500">
            <tr>
              <th className="py-2 text-start font-medium">صاحب الهدف</th><th className="text-start font-medium">المؤشر</th>
              <th className="text-start font-medium">المصدر</th><th className="text-start font-medium">المستهدف</th>
              <th className="text-start font-medium">الفعلي</th><th className="text-start font-medium">الإنجاز</th><th />
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-gray-400">لا أهداف لهذا الشهر.</td></tr>}
            {targets.map((t) => {
              const k = kpi(t.kpi_code);
              return (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2">{who(t)}</td>
                  <td>{t.title}{t.weight !== 1 && <span className="ms-1 text-[11px] text-gray-400">× {t.weight}</span>}</td>
                  <td className="text-xs text-gray-500">{k?.source}{k?.good_direction === "أدنى" ? " · أدنى أفضل" : ""}</td>
                  <td dir="ltr" className="text-start">{t.target_value ?? "—"}</td>
                  <td dir="ltr" className="text-start">{t.actual_value ?? "—"}</td>
                  <td>{bar(t.achievement_pct)}</td>
                  <td className="whitespace-nowrap text-end text-xs">
                    {k?.source === "يدوي" ? (
                      <button disabled={busy} className="text-brand-700 hover:underline"
                        onClick={() => {
                          const v = prompt("الفعلي:", t.actual_value ?? "");
                          if (v !== null && v !== "") run((s) => s.rpc("set_target_actual", { p_target: t.id, p_value: Number(v) }));
                        }}>إدخال الفعلي</button>
                    ) : (
                      <button disabled={busy} className="text-brand-700 hover:underline"
                        onClick={() => run((s) => s.rpc("refresh_target_actual", { p_target: t.id }))}>تحديث</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-6">
        <select className={input} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
          <option value="employee">لموظف</option>
          {isHr && <option value="department">لقسم</option>}
        </select>
        {f.owner === "employee" ? (
          <select className={input} value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">— الموظف —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        ) : (
          <select className={input} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">— القسم —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
        )}
        <select className={`${input} sm:col-span-2`} value={f.kpi} onChange={(e) => setF({ ...f, kpi: e.target.value })}>
          {kpis.map((k) => <option key={k.code} value={k.code}>{k.name_ar} ({k.source})</option>)}
        </select>
        <input className={input} type="number" dir="ltr" placeholder="المستهدف" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <input className={input} type="number" min="0.1" step="0.1" dir="ltr" placeholder="الوزن" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />
        <button disabled={busy || !f.target || (f.owner === "employee" ? !f.employee : !f.department)}
          className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40 sm:col-span-6"
          onClick={async () => {
            const ok = await run((s) => s.from("employee_targets").insert({
              employee_id: f.owner === "employee" ? f.employee : null,
              department_id: f.owner === "department" ? f.department : null,
              kpi_code: f.kpi, period_start: `${month}-01`, target_value: Number(f.target), weight: Number(f.weight) || 1,
            }));
            if (ok) setF({ ...f, target: "" });
          }}>
          + هدف
        </button>
      </div>
    </div>
  );
}

// ========== المراجعات ==========
export function ReviewsBoard({
  reviews, employees, departments, settings, isHr,
}: { reviews: Row[]; employees: Named[]; departments: { id: string; name_ar: string }[]; settings: Row | null; isHr: boolean }) {
  const { run, err, busy } = useRun();
  const [c, setC] = useState({ cycle: "ربعي", start: "", end: "", department: "" });
  const name = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "—";

  function step(r: Row, stepName: string) {
    const score = prompt(`درجة ${stepName} (1–5):`);
    if (!score) return;
    const comments = prompt("ملاحظات:") ?? "";
    const reco = stepName !== "ذاتي" ? prompt("التوصية (لا شيء / مكافأة / ترقية / تدريب / خطة تحسين) — اختياري:") || null : null;
    run((s) => s.rpc("submit_review_step", {
      p_review: r.id, p_step: stepName, p_score: Number(score), p_comments: comments, p_recommendation: reco,
    }));
  }

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">مراجعات الأداء</h3>
      <p className="mb-3 text-xs text-gray-500">
        ذاتي ← المدير ← HR. النتيجة من 100 بأوزان: الأهداف {settings?.weight_targets ?? 50}٪ · المدير {settings?.weight_manager ?? 30}٪ ·
        الذاتي {settings?.weight_self ?? 10}٪ · HR {settings?.weight_hr ?? 10}٪ — والمكوّن الغائب يُعاد توزيع وزنه.
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}

      {isHr && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-5">
          <select className={input} value={c.cycle} onChange={(e) => setC({ ...c, cycle: e.target.value })}>
            {["شهري", "ربعي", "سنوي"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input className={input} type="date" dir="ltr" value={c.start} onChange={(e) => setC({ ...c, start: e.target.value })} />
          <input className={input} type="date" dir="ltr" value={c.end} onChange={(e) => setC({ ...c, end: e.target.value })} />
          <select className={input} value={c.department} onChange={(e) => setC({ ...c, department: e.target.value })}>
            <option value="">كل الموظفين</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
          <button disabled={busy || !c.start || !c.end} className="rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
            onClick={() => run((s) => s.rpc("open_review_cycle", {
              p_cycle: c.cycle, p_start: c.start, p_end: c.end, p_department: c.department || null, p_employee: null,
            }))}>
            فتح دورة تقييم
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-gray-500">
            <tr>
              <th className="py-2 text-start font-medium">الموظف</th><th className="text-start font-medium">الدورة</th>
              <th className="text-start font-medium">الذاتي / المدير / HR</th><th className="text-start font-medium">الأهداف</th>
              <th className="text-start font-medium">النتيجة</th><th className="text-start font-medium">الحالة</th><th />
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-gray-400">لا مراجعات.</td></tr>}
            {reviews.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2">{name(r.employee_id)}</td>
                <td className="text-xs text-gray-500">{r.cycle} · <span dir="ltr">{r.period_start} → {r.period_end}</span></td>
                <td>{r.self_score ?? "—"} / {r.manager_score ?? "—"} / {r.hr_score ?? "—"}</td>
                <td>{r.targets_pct != null ? `${r.targets_pct}%` : "—"}</td>
                <td className="font-bold">{r.final_score ?? "—"}{r.recommendation && r.recommendation !== "لا شيء" && <span className="ms-1 text-[11px] font-normal text-blue-600">{r.recommendation}</span>}</td>
                <td className="text-xs">{r.status}</td>
                <td className="whitespace-nowrap text-end text-xs">
                  {r.status === "تقييم المدير" && (
                    <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => step(r, "المدير")}>تقييم المدير</button>
                  )}
                  {r.status === "مراجعة HR" && isHr && (
                    <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => step(r, "HR")}>المراجعة النهائية</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
