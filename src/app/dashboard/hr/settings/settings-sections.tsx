"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { WEEKDAYS } from "@/lib/attendance";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const card = "rounded-2xl border bg-white p-5 shadow-sm";
const input = "w-full rounded border border-gray-300 px-2 py-1 text-xs";

function useSave() {
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

// ========== سياسات الإجازات ==========
export function LeavePolicies({ types, workflows }: { types: Row[]; workflows: Row[] }) {
  const { run, err, busy } = useSave();
  const leaveWfs = workflows.filter((w) => w.entity_type === "leave");

  function save(t: Row, patch: Row) {
    run((s) => s.from("leave_types").update(patch).eq("id", t.id));
  }
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">سياسات الإجازات</h3>
      <p className="mb-3 text-xs text-gray-500">تُحفظ كل خانة عند مغادرتها. الرصيد حركاتٌ في السجلّ؛ تغيير السياسة يسري على الطلبات الجديدة.</p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="border-b text-gray-500">
            <tr>
              <th className="py-2 text-start">النوع</th>
              <th>سنوياً</th><th>تراكم شهري</th><th>برصيد</th><th>تُخصم</th><th>تُرحَّل</th>
              <th>حدّ الترحيل</th><th>أقصى للطلب</th><th>إشعار مسبق</th><th>السلسلة</th><th>فعّال</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="py-2 font-medium text-gray-800">{t.name}</td>
                <td><input className={input} type="number" min="0" dir="ltr" defaultValue={t.annual_days ?? 0}
                  onBlur={(e) => Number(e.target.value) !== Number(t.annual_days) && save(t, { annual_days: Number(e.target.value) })} /></td>
                {(["accrues_monthly", "requires_balance", "deducts_salary", "carries_over"] as const).map((k) => (
                  <td key={k} className="text-center">
                    <input type="checkbox" disabled={busy} defaultChecked={t[k]} onChange={(e) => save(t, { [k]: e.target.checked })} />
                  </td>
                ))}
                <td><input className={input} type="number" min="0" dir="ltr" defaultValue={t.carry_over_max_days ?? ""}
                  onBlur={(e) => num(e.target.value) !== t.carry_over_max_days && save(t, { carry_over_max_days: num(e.target.value) })} /></td>
                <td><input className={input} type="number" min="1" dir="ltr" defaultValue={t.max_days_per_request ?? ""}
                  onBlur={(e) => num(e.target.value) !== t.max_days_per_request && save(t, { max_days_per_request: num(e.target.value) })} /></td>
                <td><input className={input} type="number" min="0" dir="ltr" defaultValue={t.min_notice_days ?? ""}
                  onBlur={(e) => num(e.target.value) !== t.min_notice_days && save(t, { min_notice_days: num(e.target.value) })} /></td>
                <td>
                  <select className={input} defaultValue={t.workflow_code ?? "leave"} onChange={(e) => save(t, { workflow_code: e.target.value })}>
                    {leaveWfs.map((w) => <option key={w.code} value={w.code}>{w.name_ar}</option>)}
                  </select>
                </td>
                <td className="text-center">
                  <input type="checkbox" disabled={busy} defaultChecked={t.active} onChange={(e) => save(t, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========== سلاسل الموافقة ==========
const KINDS = ["المدير المباشر", "مدير القسم", "HR", "المالية", "المدير العام", "دور", "شخص"];

export function Workflows({ workflows, steps, roles, canEdit }: { workflows: Row[]; steps: Row[]; roles: Row[]; canEdit: boolean }) {
  const { run, err, busy } = useSave();
  const [adding, setAdding] = useState<string | null>(null);
  const [f, setF] = useState({ label: "", kind: "المدير المباشر", role: "", min_days: "", min_amount: "" });

  async function addStep(code: string) {
    const next = Math.max(0, ...steps.filter((s) => s.workflow_code === code).map((s) => s.step_no)) + 1;
    const ok = await run((s) => s.from("approval_steps").insert({
      workflow_code: code, step_no: next, label: f.label || f.kind, approver_kind: f.kind,
      approver_role: f.kind === "دور" ? f.role || null : null,
      min_days: f.min_days ? Number(f.min_days) : null,
      min_amount: f.min_amount ? Number(f.min_amount) : null,
    }));
    if (ok) {
      setAdding(null);
      setF({ label: "", kind: "المدير المباشر", role: "", min_days: "", min_amount: "" });
    }
  }

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">سلاسل الموافقة</h3>
      <p className="mb-3 text-xs text-gray-500">
        خطوةٌ لا مُوافِق لها تُصعَّد إلى التالية، ونهاية السلسلة بلا مُوافِق ⇒ المدير. لا أحد يوافق على طلبه.
        {canEdit ? "" : " (التعديل للمدير)"}
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {workflows.map((w) => (
          <div key={w.code} className="rounded-xl border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-gray-800">{w.name_ar}</span>
              {canEdit && (
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" defaultChecked={w.active} disabled={busy}
                    onChange={(e) => run((s) => s.from("approval_workflows").update({ active: e.target.checked }).eq("code", w.code))} />
                  فعّالة
                </label>
              )}
            </div>
            <ol className="space-y-1 text-sm">
              {steps.filter((s) => s.workflow_code === w.code).map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[11px] text-brand-700">{s.step_no}</span>
                  <span>{s.label}</span>
                  <span className="text-[11px] text-gray-400">
                    {s.approver_kind}{s.approver_role ? `: ${roles.find((r) => r.code === s.approver_role)?.name_ar ?? s.approver_role}` : ""}
                    {s.min_days != null ? ` · من ${s.min_days} يوم` : ""}{s.min_amount != null ? ` · من مبلغ ${s.min_amount}` : ""}
                  </span>
                  {canEdit && (
                    <button disabled={busy} className="ms-auto text-[11px] text-gray-400 hover:text-red-600"
                      onClick={() => confirm("حذف الخطوة؟") && run((x) => x.from("approval_steps").delete().eq("id", s.id))}>حذف</button>
                  )}
                </li>
              ))}
            </ol>
            {canEdit && adding !== w.code && (
              <button onClick={() => setAdding(w.code)} className="mt-2 text-xs text-brand-700 hover:underline">+ خطوة</button>
            )}
            {canEdit && adding === w.code && (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded bg-gray-50 p-2">
                <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                {f.kind === "دور" ? (
                  <select className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                    <option value="">— الدور —</option>
                    {roles.map((r) => <option key={r.code} value={r.code}>{r.name_ar}</option>)}
                  </select>
                ) : (
                  <input className={input} placeholder="اسم الخطوة" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
                )}
                <input className={input} type="number" min="0" dir="ltr" placeholder="من أيام (اختياري)" value={f.min_days} onChange={(e) => setF({ ...f, min_days: e.target.value })} />
                <input className={input} type="number" min="0" dir="ltr" placeholder="من مبلغ (اختياري)" value={f.min_amount} onChange={(e) => setF({ ...f, min_amount: e.target.value })} />
                <button disabled={busy} onClick={() => addStep(w.code)} className="rounded bg-brand-600 py-1 text-xs text-white">إضافة</button>
                <button onClick={() => setAdding(null)} className="rounded border py-1 text-xs">إلغاء</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== الورديات ==========
export function Shifts({ shifts, assignments, employees }: { shifts: Row[]; assignments: Row[]; employees: Row[] }) {
  const { run, err, busy } = useSave();
  const [n, setN] = useState({ name: "", start: "", end: "", days: [0, 1, 2, 3, 4] as number[] });
  const [as, setAs] = useState({ employee: "", shift: "", start: "", end: "" });
  const name = (id: string, list: Row[], key: string) => list.find((x) => x.id === id)?.[key] ?? "—";

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">الورديات</h3>
      <p className="mb-3 text-xs text-gray-500">وردية الموظف تسبق دوامه الخاص ودوام الشركة — في البصمة والانصراف التلقائي وخصم الدوام.</p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <ul className="mb-3 space-y-1 text-sm">
            {shifts.map((s) => (
              <li key={s.id} className={`flex items-center gap-2 ${s.active ? "" : "opacity-50"}`}>
                <span className="font-medium">{s.name_ar}</span>
                <span className="text-xs text-gray-500" dir="ltr">{String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}</span>
                <span className="text-[11px] text-gray-400">{(s.work_days as number[]).map((d) => WEEKDAYS.find((w) => w.value === d)?.label).join("، ")}</span>
                <button disabled={busy} className="ms-auto text-[11px] text-gray-400 hover:text-gray-700"
                  onClick={() => run((x) => x.from("work_shifts").update({ active: !s.active }).eq("id", s.id))}>
                  {s.active ? "إيقاف" : "تفعيل"}
                </button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-2 rounded bg-gray-50 p-3">
            <input className={input} placeholder="اسم الوردية" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
            <input className={input} type="time" dir="ltr" value={n.start} onChange={(e) => setN({ ...n, start: e.target.value })} />
            <input className={input} type="time" dir="ltr" value={n.end} onChange={(e) => setN({ ...n, end: e.target.value })} />
            <div className="col-span-3 flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => (
                <button key={d.value} type="button"
                  onClick={() => setN({ ...n, days: n.days.includes(d.value) ? n.days.filter((x) => x !== d.value) : [...n.days, d.value].sort() })}
                  className={`rounded px-2 py-0.5 text-[11px] ${n.days.includes(d.value) ? "bg-brand-600 text-white" : "border text-gray-500"}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <button disabled={busy || !n.name || !n.start || !n.end} className="col-span-3 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
              onClick={async () => {
                if (await run((x) => x.from("work_shifts").insert({ name_ar: n.name, start_time: n.start, end_time: n.end, work_days: n.days })))
                  setN({ name: "", start: "", end: "", days: [0, 1, 2, 3, 4] });
              }}>
              + وردية
            </button>
          </div>
        </div>
        <div>
          <ul className="mb-3 max-h-56 space-y-1 overflow-y-auto text-sm">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span>{name(a.employee_id, employees, "full_name")}</span>
                <span className="text-xs text-gray-500">{name(a.shift_id, shifts, "name_ar")}</span>
                <span className="text-[11px] text-gray-400" dir="ltr">{a.start_date} → {a.end_date ?? "…"}</span>
                {!a.end_date && (
                  <button disabled={busy} className="ms-auto text-[11px] text-gray-400 hover:text-gray-700"
                    onClick={() => run((x) => x.from("employee_shifts").update({ end_date: new Date().toISOString().slice(0, 10) }).eq("id", a.id))}>
                    إنهاء اليوم
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 rounded bg-gray-50 p-3">
            <select className={input} value={as.employee} onChange={(e) => setAs({ ...as, employee: e.target.value })}>
              <option value="">— الموظف —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <select className={input} value={as.shift} onChange={(e) => setAs({ ...as, shift: e.target.value })}>
              <option value="">— الوردية —</option>
              {shifts.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
            </select>
            <input className={input} type="date" dir="ltr" value={as.start} onChange={(e) => setAs({ ...as, start: e.target.value })} />
            <input className={input} type="date" dir="ltr" value={as.end} onChange={(e) => setAs({ ...as, end: e.target.value })} />
            <button disabled={busy || !as.employee || !as.shift || !as.start} className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
              onClick={async () => {
                if (await run((x) => x.from("employee_shifts").insert({ employee_id: as.employee, shift_id: as.shift, start_date: as.start, end_date: as.end || null })))
                  setAs({ employee: "", shift: "", start: "", end: "" });
              }}>
              إسناد وردية
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== معاملات العمل الإضافي ==========
export function OvertimeFactors({ workday, offday, canEdit }: { workday: number | null; offday: number | null; canEdit: boolean }) {
  const { run, err, busy } = useSave();
  const [w, setW] = useState(workday?.toString() ?? "");
  const [o, setO] = useState(offday?.toString() ?? "");

  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">العمل الإضافي</h3>
      <p className="mb-3 text-xs text-gray-500">
        أجر الساعة الإضافية = (الراتب ÷ 30 ÷ ساعات الدوام) × المعامل. فارغٌ = لا يُحسب مبلغ حتى يُحدَّد.
        {canEdit ? "" : " (التعديل للمدير)"}
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          معامل يوم الدوام
          <input className={input} type="number" min="0.1" step="0.05" dir="ltr" disabled={!canEdit} value={w} onChange={(e) => setW(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          معامل يوم العطلة
          <input className={input} type="number" min="0.1" step="0.05" dir="ltr" disabled={!canEdit} value={o} onChange={(e) => setO(e.target.value)} />
        </label>
        {canEdit && (
          <button disabled={busy} className="rounded bg-brand-600 px-4 py-1.5 text-xs text-white disabled:opacity-40"
            onClick={() => run((s) => s.from("company_settings").update({
              overtime_factor_workday: w ? Number(w) : null, overtime_factor_offday: o ? Number(o) : null,
            }).eq("id", 1))}>
            حفظ
          </button>
        )}
      </div>
    </div>
  );
}

// ========== مكافأة نهاية الخدمة ==========
// القاعدة يضعها المالك: أيام راتب لكل سنة خدمة، وحدٌّ أدنى للخدمة. فارغ = لا مكافأة (sql/163).
export function EndOfService({ days, minYears }: { days: number | null; minYears: number | null }) {
  const { run, err, busy } = useSave();
  const [d, setD] = useState(days?.toString() ?? "");
  const [m, setM] = useState(minYears?.toString() ?? "");
  return (
    <div className={card}>
      <h3 className="mb-1 font-semibold text-gray-800">مكافأة نهاية الخدمة</h3>
      <p className="mb-3 text-xs text-gray-500">
        المكافأة = (الراتب ÷ 30) × الأيام لكل سنة × سنوات الخدمة. فارغٌ = لا تُحسب مكافأة في التسوية حتى تُحدَّد.
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          أيام لكل سنة خدمة
          <input className={input} type="number" min="0" step="0.5" dir="ltr" value={d} onChange={(e) => setD(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          الحدّ الأدنى للخدمة (سنوات)
          <input className={input} type="number" min="0" step="0.5" dir="ltr" value={m} onChange={(e) => setM(e.target.value)} />
        </label>
        <button disabled={busy} className="rounded bg-brand-600 px-4 py-1.5 text-xs text-white disabled:opacity-40"
          onClick={() => run((s) => s.from("company_settings").update({
            eos_days_per_year: d ? Number(d) : null, eos_min_years: m ? Number(m) : null,
          }).eq("id", 1))}>
          حفظ
        </button>
      </div>
    </div>
  );
}
