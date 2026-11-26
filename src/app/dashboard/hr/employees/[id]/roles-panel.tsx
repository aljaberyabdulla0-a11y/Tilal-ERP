"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// الوظائف المتعددة والمسؤوليات التشغيلية (sql/228–229).
// كل كتابة عبر دوال الخادم (assign_position، assign_responsibility…) — الواجهة لا تقرّر شيئاً:
// الحمل فوق ١٠٠٪، التداخل، الرئيسي الواحد، والصلاحيات تُفرض في القاعدة وتصل رسالتها هنا.

export type PositionRow = {
  id: string; position_id: string; department_id: string | null; kind: "primary" | "additional" | "temporary";
  reports_to: string | null; start_date: string; end_date: string | null; status: string; workload_pct: number;
  grants_role_permissions: boolean; permissions_expire_on: string | null; ended_reason: string | null;
  positions: { title_ar: string } | null; departments: { name_ar: string } | null;
};
export type AssignmentRow = {
  id: string; responsibility_id: string; assignee_role: "lead" | "assistant"; supervisor_id: string | null;
  start_date: string; end_date: string | null; is_permanent: boolean; status: string; workload_pct: number;
  ended_reason: string | null; responsibility_catalog: { name_ar: string } | null;
};
type Opt = { id: string; label: string };

const KIND: Record<string, string> = { primary: "أساسية", additional: "إضافية", temporary: "مؤقتة" };
const STATUS: Record<string, string> = {
  active: "فعّال", ended: "منتهٍ", pending_approval: "بانتظار الموافقة", suspended: "موقوف", rejected: "مرفوض",
};

export default function RolesPanel({
  employeeId, positions, assignments, positionOptions, peopleOptions, responsibilityOptions, planned,
  canEdit, isAdmin,
}: {
  employeeId: string; positions: PositionRow[]; assignments: AssignmentRow[];
  positionOptions: Opt[]; peopleOptions: Opt[]; responsibilityOptions: Opt[]; planned: number;
  canEdit: boolean; isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pf, setPf] = useState({ position_id: "", kind: "additional", reports_to: "", start_date: "", end_date: "", workload_pct: "0", reason: "" });
  const [rf, setRf] = useState({ responsibility_id: "", assignee_role: "lead", supervisor_id: "", is_permanent: true, end_date: "", workload_pct: "0" });

  const nameOf = (id: string | null) => (id ? peopleOptions.find((p) => p.id === id)?.label ?? "—" : "—");

  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    router.refresh();
    return true;
  }
  const askReason = (q: string) => {
    const r = prompt(q);
    return r && r.trim() ? r.trim() : null;
  };

  const openPos = positions.filter((p) => p.status === "active" || p.status === "pending_approval");
  const closedPos = positions.filter((p) => !openPos.includes(p));
  const openRa = assignments.filter((a) => ["active", "suspended", "pending_approval"].includes(a.status));
  const closedRa = assignments.filter((a) => !openRa.includes(a));
  const load = Math.round(planned);
  const loadColor = load > 100 ? "bg-red-500" : load >= 90 ? "bg-amber-500" : load >= 60 ? "bg-green-500" : "bg-sky-400";
  const loadLabel = load > 100 ? "فوق الطاقة" : load >= 90 ? "مرتفع" : load >= 60 ? "متوازن" : "تحت الاستغلال";
  const input = "rounded border border-gray-300 px-2 py-1 text-xs";

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-800">الوظائف والمسؤوليات</h3>
        <div className="flex items-center gap-2 text-xs text-gray-600" title="مجموع نسب الوظائف والمسؤوليات الفعّالة اليوم">
          <span>الحمل المخطّط</span>
          <span className="h-2 w-28 overflow-hidden rounded bg-gray-100">
            <span className={`block h-2 ${loadColor}`} style={{ width: `${Math.min(load, 100)}%` }} />
          </span>
          <span className="font-semibold">{load}٪</span>
          <span className="text-gray-400">{loadLabel}</span>
        </div>
      </div>
      {err && <p className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}

      {/* ── الوظائف ── */}
      <h4 className="mb-2 text-sm font-semibold text-gray-700">الوظائف</h4>
      {openPos.length === 0 ? (
        <p className="mb-3 text-sm text-gray-400">لا وظيفة مسجّلة — اختر المنصب من «تعديل».</p>
      ) : (
        <ul className="mb-3 divide-y text-sm">
          {openPos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={`rounded px-1.5 text-xs ${p.kind === "primary" ? "bg-brand-50 text-brand-700" : "bg-gray-100"}`}>{KIND[p.kind]}</span>
              <span className="font-medium">{p.positions?.title_ar ?? "—"}</span>
              <span className="text-xs text-gray-500">{p.departments?.name_ar ?? ""}</span>
              <span className="text-xs text-gray-500">المدير: {nameOf(p.reports_to)}</span>
              <span className="text-xs" dir="ltr">{p.start_date}{p.end_date ? ` → ${p.end_date}` : ""}</span>
              <span className="text-xs font-semibold">{Number(p.workload_pct)}٪</span>
              {p.status !== "active" && <span className="text-xs text-amber-600">{STATUS[p.status]}</span>}
              {p.grants_role_permissions && (
                <span className="rounded bg-amber-50 px-1.5 text-[11px] text-amber-700" title="صلاحيات دور المنصب مفعّلة لهذا التعيين">
                  صلاحيات حتى {p.permissions_expire_on ?? "نهاية التعيين"}
                </span>
              )}
              {canEdit && (
                <span className="ms-auto flex gap-2 text-[11px]">
                  <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => {
                    const v = prompt("النسبة الجديدة من الحمل (0–100):", String(p.workload_pct));
                    if (v === null) return;
                    const reason = askReason("سبب التعديل:");
                    if (reason) rpc("update_position_assignment", { p_id: p.id, p: { workload_pct: Number(v) }, p_reason: reason });
                  }}>النسبة</button>
                  {p.kind !== "primary" && (
                    <>
                      <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => {
                        const reason = askReason("سبب جعلها الوظيفة الأساسية (تنتهي الأساسية الحالية):");
                        if (reason) rpc("set_primary_position", { p_id: p.id, p_reason: reason });
                      }}>اجعلها أساسية</button>
                      {isAdmin && (
                        <button disabled={busy} className="text-amber-700 hover:underline" onClick={() => {
                          const on = !p.grants_role_permissions;
                          const exp = on ? prompt("تنتهي الصلاحيات في (YYYY-MM-DD، فارغ = نهاية التعيين):", p.end_date ?? "") : null;
                          if (on && exp === null) return;
                          const reason = askReason(on ? "سبب منح صلاحيات دور هذا المنصب:" : "سبب سحب الصلاحيات:");
                          if (reason) rpc("set_position_permissions", { p_id: p.id, p_on: on, p_expire_on: exp || null, p_reason: reason });
                        }}>{p.grants_role_permissions ? "سحب الصلاحيات" : "منح صلاحيات الدور"}</button>
                      )}
                      <button disabled={busy} className="text-red-600 hover:underline" onClick={() => {
                        const reason = askReason("سبب إنهاء هذه الوظيفة:");
                        if (reason) rpc("end_position_assignment", { p_id: p.id, p_end_date: null, p_reason: reason });
                      }}>إنهاء</button>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mb-5 grid grid-cols-2 gap-2 rounded bg-gray-50 p-2 sm:grid-cols-7">
          <select className={`${input} sm:col-span-2`} value={pf.position_id} onChange={(e) => setPf({ ...pf, position_id: e.target.value })}>
            <option value="">— المنصب —</option>
            {positionOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className={input} value={pf.kind} onChange={(e) => setPf({ ...pf, kind: e.target.value })}>
            <option value="additional">إضافية</option>
            <option value="temporary">مؤقتة</option>
          </select>
          <select className={input} value={pf.reports_to} onChange={(e) => setPf({ ...pf, reports_to: e.target.value })}>
            <option value="">— المدير —</option>
            {peopleOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input className={input} type="date" title="البداية" value={pf.start_date} onChange={(e) => setPf({ ...pf, start_date: e.target.value })} />
          <input className={input} type="date" title="النهاية (إلزامية للمؤقتة)" value={pf.end_date} onChange={(e) => setPf({ ...pf, end_date: e.target.value })} />
          <input className={input} type="number" min={0} max={100} title="نسبة الحمل" value={pf.workload_pct} onChange={(e) => setPf({ ...pf, workload_pct: e.target.value })} />
          <input className={`${input} col-span-2 sm:col-span-5`} placeholder="سبب التعيين" value={pf.reason} onChange={(e) => setPf({ ...pf, reason: e.target.value })} />
          <button disabled={busy || !pf.position_id} className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
            onClick={async () => {
              const ok = await rpc("assign_position", { p: {
                employee_id: employeeId, position_id: pf.position_id, kind: pf.kind,
                reports_to: pf.reports_to || null, start_date: pf.start_date || null, end_date: pf.end_date || null,
                workload_pct: Number(pf.workload_pct || 0), reason: pf.reason || null,
              } });
              if (ok) setPf({ position_id: "", kind: "additional", reports_to: "", start_date: "", end_date: "", workload_pct: "0", reason: "" });
            }}>
            إضافة وظيفة
          </button>
        </div>
      )}

      {/* ── المسؤوليات ── */}
      <h4 className="mb-2 text-sm font-semibold text-gray-700">المسؤوليات التشغيلية</h4>
      {openRa.length === 0 ? (
        <p className="mb-3 text-sm text-gray-400">لا مسؤوليات تشغيلية.</p>
      ) : (
        <ul className="mb-3 divide-y text-sm">
          {openRa.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium">{a.responsibility_catalog?.name_ar ?? "—"}</span>
              <span className="rounded bg-gray-100 px-1.5 text-xs">{a.assignee_role === "lead" ? "مسؤول رئيسي" : "مساعد"}</span>
              <span className="text-xs text-gray-500">المشرف: {nameOf(a.supervisor_id)}</span>
              <span className="text-xs" dir="ltr">{a.start_date}{a.end_date ? ` → ${a.end_date}` : ""}</span>
              <span className="text-xs font-semibold">{Number(a.workload_pct)}٪</span>
              {a.status !== "active" && <span className="text-xs text-amber-600">{STATUS[a.status]}</span>}
              {canEdit && (
                <span className="ms-auto flex gap-2 text-[11px]">
                  <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => {
                    const v = prompt("النسبة الجديدة من الحمل (0–100):", String(a.workload_pct));
                    if (v === null) return;
                    const reason = askReason("سبب التعديل:");
                    if (reason) rpc("update_responsibility_assignment", { p_id: a.id, p: { workload_pct: Number(v) }, p_reason: reason });
                  }}>النسبة</button>
                  <button disabled={busy} className="text-brand-700 hover:underline" onClick={() => {
                    const reason = askReason(a.status === "suspended" ? "سبب إعادة التفعيل:" : "سبب الإيقاف المؤقت:");
                    if (reason) rpc("update_responsibility_assignment", {
                      p_id: a.id, p: { status: a.status === "suspended" ? "active" : "suspended" }, p_reason: reason,
                    });
                  }}>{a.status === "suspended" ? "تفعيل" : "إيقاف"}</button>
                  <button disabled={busy} className="text-red-600 hover:underline" onClick={() => {
                    const reason = askReason("سبب إنهاء التكليف:");
                    if (reason) rpc("end_responsibility_assignment", { p_id: a.id, p_end_date: null, p_reason: reason });
                  }}>إنهاء</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="grid grid-cols-2 gap-2 rounded bg-gray-50 p-2 sm:grid-cols-7">
          <select className={`${input} sm:col-span-2`} value={rf.responsibility_id} onChange={(e) => setRf({ ...rf, responsibility_id: e.target.value })}>
            <option value="">— المسؤولية (المفعّلة) —</option>
            {responsibilityOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className={input} value={rf.assignee_role} onChange={(e) => setRf({ ...rf, assignee_role: e.target.value })}>
            <option value="lead">مسؤول رئيسي</option>
            <option value="assistant">مساعد</option>
          </select>
          <select className={input} value={rf.supervisor_id} onChange={(e) => setRf({ ...rf, supervisor_id: e.target.value })}>
            <option value="">— المشرف —</option>
            {peopleOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={rf.is_permanent} onChange={(e) => setRf({ ...rf, is_permanent: e.target.checked })} /> دائم
          </label>
          <input className={input} type="date" disabled={rf.is_permanent} title="النهاية" value={rf.end_date} onChange={(e) => setRf({ ...rf, end_date: e.target.value })} />
          <input className={input} type="number" min={0} max={100} title="نسبة الحمل" value={rf.workload_pct} onChange={(e) => setRf({ ...rf, workload_pct: e.target.value })} />
          <button disabled={busy || !rf.responsibility_id} className="col-span-2 rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40 sm:col-span-7"
            onClick={async () => {
              const ok = await rpc("assign_responsibility", { p: {
                responsibility_id: rf.responsibility_id, employee_id: employeeId, assignee_role: rf.assignee_role,
                supervisor_id: rf.supervisor_id || null, is_permanent: rf.is_permanent,
                end_date: rf.is_permanent ? null : rf.end_date || null, workload_pct: Number(rf.workload_pct || 0),
              } });
              if (ok) setRf({ responsibility_id: "", assignee_role: "lead", supervisor_id: "", is_permanent: true, end_date: "", workload_pct: "0" });
            }}>
            تكليف بمسؤولية
          </button>
        </div>
      )}

      {(closedPos.length > 0 || closedRa.length > 0) && (
        <div className="mt-4">
          <button className="text-xs text-gray-500 hover:text-brand-700" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "إخفاء" : "عرض"} التاريخ الوظيفي ({closedPos.length + closedRa.length})
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y text-xs text-gray-500">
              {closedPos.map((p) => (
                <li key={p.id} className="py-1.5">
                  {KIND[p.kind]} · {p.positions?.title_ar} · <span dir="ltr">{p.start_date} → {p.end_date ?? "—"}</span>
                  {p.ended_reason ? ` · ${p.ended_reason}` : ""}
                </li>
              ))}
              {closedRa.map((a) => (
                <li key={a.id} className="py-1.5">
                  مسؤولية · {a.responsibility_catalog?.name_ar} · <span dir="ltr">{a.start_date} → {a.end_date ?? "—"}</span>
                  {a.ended_reason ? ` · ${a.ended_reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
