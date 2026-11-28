"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type TeamRow = { id: string; code: string; name_ar: string; description: string | null; status: string;
  escalation_employee_id: string | null };
export type MemberRow = { id: string; team_id: string; employee_id: string; member_role: "leader" | "reviewer" | "member";
  specializations: { review_types?: string[] } | null; max_open_reviews: number; workload_pct: number;
  start_date: string; end_date: string | null; status: string; ended_reason: string | null };
export type TypeRow = { code: string; name_ar: string; is_active: boolean;
  contact_policy: Record<string, number>; sla_policy: Record<string, number | number[] | string> };
type Opt = { id: string; label: string };

const ROLE: Record<string, string> = { leader: "قائد", reviewer: "مراجع", member: "عضو" };
const TEAM_STATUS: Record<string, string> = { draft: "مسودة", active: "فعّال", suspended: "موقوف", archived: "مؤرشف" };
const M_STATUS: Record<string, string> = { active: "فعّال", suspended: "موقوف", ended: "منتهٍ", pending_approval: "بانتظار الموافقة" };

export default function TeamManager({ teams, members, employees, types, teamTypes }: {
  teams: TeamRow[]; members: MemberRow[]; employees: Opt[]; types: TypeRow[]; teamTypes: { team_id: string; review_type: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ employee_id: "", member_role: "member", max_open_reviews: "10", workload_pct: "0" });
  const [showHistory, setShowHistory] = useState(false);
  const team = teams[0];
  const cqc = types.find((t) => t.code === "customer_qc");
  const [cp, setCp] = useState(() => ({ ...(cqc?.contact_policy ?? {}) }));
  const [sla, setSla] = useState(() => ({ ...(cqc?.sla_policy ?? {}) }));

  if (!team) return <p className="text-sm text-gray-500">لا فريق مراجعة.</p>;
  const nameOf = (id: string | null) => employees.find((e) => e.id === id)?.label ?? "—";
  const mine = members.filter((m) => m.team_id === team.id);
  const open = mine.filter((m) => m.status !== "ended");
  const closed = mine.filter((m) => m.status === "ended");
  const leader = open.find((m) => m.member_role === "leader" && m.status === "active");
  const handled = teamTypes.filter((t) => t.team_id === team.id).map((t) => t.review_type);

  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }
  const reason = (q: string) => { const r = prompt(q); return r && r.trim() ? r.trim() : null; };
  const input = "rounded border border-gray-300 px-2 py-1 text-sm";
  const num = (v: unknown) => (v === undefined || v === null ? "" : String(v));

  return (
    <div className="space-y-6">
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-800">{team.name_ar}</h2>
          <span className={`rounded px-2 py-0.5 text-xs ${team.status === "active" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
            {TEAM_STATUS[team.status]}
          </span>
          <span className="text-xs text-gray-500">القائد: {leader ? nameOf(leader.employee_id) : "لم يُعيَّن"}</span>
          <span className="text-xs text-gray-500">يتولّى: {handled.map((c) => types.find((t) => t.code === c)?.name_ar ?? c).join("، ")}</span>
          <span className="ms-auto flex gap-2">
            {team.status !== "active" ? (
              <button disabled={busy} className="rounded bg-green-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                onClick={() => { const r = reason("سبب تفعيل الفريق:"); if (r) rpc("review_team_set_status", { p_team: team.id, p_status: "active", p_reason: r }); }}>
                تفعيل الفريق
              </button>
            ) : (
              <button disabled={busy} className="rounded border border-amber-500 px-3 py-1.5 text-xs text-amber-700"
                onClick={() => { const r = reason("سبب إيقاف الفريق:"); if (r) rpc("review_team_set_status", { p_team: team.id, p_status: "suspended", p_reason: r }); }}>
                إيقاف الفريق
              </button>
            )}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          الفريق مستقل في التقييم ورفع النتائج، وأعضاؤه يبقون تابعين إدارياً لأقسامهم الأصلية. لا يُفعَّل بلا قائد.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">مسار التصعيد عند غياب القائد:</span>
          <select className={input} value={team.escalation_employee_id ?? ""} disabled={busy}
            onChange={(e) => rpc("review_team_save", { p: { id: team.id, escalation_employee_id: e.target.value, reason: "مسار التصعيد" } })}>
            <option value="">المدير العام</option>
            {employees.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-800">الأعضاء</h3>
        {open.length === 0 ? <p className="text-sm text-gray-400">لا أعضاء — اختر القائد والأعضاء من أي قسم.</p> : (
          <ul className="divide-y text-sm">
            {open.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={`rounded px-1.5 text-xs ${m.member_role === "leader" ? "bg-brand-50 text-brand-700" : "bg-gray-100"}`}>{ROLE[m.member_role]}</span>
                <span className="font-medium">{nameOf(m.employee_id)}</span>
                <span className="text-xs text-gray-500">حتى {m.max_open_reviews} حالة مفتوحة</span>
                <span className="text-xs text-gray-500">{Number(m.workload_pct)}٪ من الحمل</span>
                <span className="text-xs" dir="ltr">منذ {m.start_date}</span>
                {m.status !== "active" && <span className="text-xs text-amber-600">{M_STATUS[m.status]}</span>}
                <span className="ms-auto flex gap-3 text-xs">
                  {m.member_role !== "leader" && (
                    <>
                      <button disabled={busy} className="text-brand-700 hover:underline"
                        onClick={() => { const r = reason("سبب تعيينه قائداً:"); if (r) rpc("team_set_leader", { p_team: team.id, p_employee: m.employee_id, p_reason: r, p_keep_old_as_member: true }); }}>
                        اجعله القائد
                      </button>
                      <button disabled={busy || m.status !== "active"} className="text-brand-700 hover:underline disabled:opacity-40"
                        onClick={() => { const r = reason("سبب تغيير الدور:"); if (r) rpc("team_change_member_role", { p_member: m.id, p_role: m.member_role === "member" ? "reviewer" : "member", p_reason: r }); }}>
                        {m.member_role === "member" ? "اجعله مراجعاً" : "اجعله عضواً"}
                      </button>
                    </>
                  )}
                  <button disabled={busy} className="text-amber-700 hover:underline"
                    onClick={() => { const r = reason(m.status === "suspended" ? "سبب الاستئناف:" : "سبب الإيقاف:"); if (r) rpc("team_set_member_status", { p_member: m.id, p_action: m.status === "suspended" ? "resume" : "suspend", p_reason: r }); }}>
                    {m.status === "suspended" ? "استئناف" : "إيقاف"}
                  </button>
                  <button disabled={busy} className="text-red-600 hover:underline"
                    onClick={() => { const r = reason("سبب إنهاء العضوية:"); if (r) rpc("team_set_member_status", { p_member: m.id, p_action: "end", p_reason: r }); }}>
                    إنهاء
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-gray-50 p-2 sm:grid-cols-6">
          <select className={`${input} sm:col-span-2`} value={add.employee_id} onChange={(e) => setAdd({ ...add, employee_id: e.target.value })}>
            <option value="">— الموظف (من أي قسم) —</option>
            {employees.filter((e) => !open.some((m) => m.employee_id === e.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className={input} value={add.member_role} onChange={(e) => setAdd({ ...add, member_role: e.target.value })}>
            <option value="member">عضو</option>
            <option value="reviewer">مراجع</option>
            {!leader && <option value="leader">قائد</option>}
          </select>
          <input className={input} type="number" min={1} max={200} title="أقصى حالات مفتوحة" value={add.max_open_reviews}
            onChange={(e) => setAdd({ ...add, max_open_reviews: e.target.value })} />
          <input className={input} type="number" min={0} max={100} title="نسبة الحمل" value={add.workload_pct}
            onChange={(e) => setAdd({ ...add, workload_pct: e.target.value })} />
          <button disabled={busy || !add.employee_id} className="rounded bg-brand-600 py-1 text-sm text-white disabled:opacity-40"
            onClick={async () => {
              const ok = await rpc("team_add_member", { p: {
                team_id: team.id, employee_id: add.employee_id, member_role: add.member_role,
                max_open_reviews: Number(add.max_open_reviews || 10), workload_pct: Number(add.workload_pct || 0),
                specializations: { review_types: handled },
              } });
              if (ok) setAdd({ employee_id: "", member_role: "member", max_open_reviews: "10", workload_pct: "0" });
            }}>
            إضافة
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          نسبة الحمل تُضاف إلى وظائف الموظف ومسؤولياته؛ إن تجاوز المجموع ١٠٠٪ تُرفض — خفّض نسبة أخرى أولاً.
        </p>

        {closed.length > 0 && (
          <div className="mt-3">
            <button className="text-xs text-gray-500 hover:text-brand-700" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? "إخفاء" : "عرض"} سجلّ العضوية ({closed.length})
            </button>
            {showHistory && (
              <ul className="mt-2 divide-y text-xs text-gray-500">
                {closed.map((m) => (
                  <li key={m.id} className="py-1.5">
                    {ROLE[m.member_role]} · {nameOf(m.employee_id)} · <span dir="ltr">{m.start_date} → {m.end_date}</span>
                    {m.ended_reason ? ` · ${m.ended_reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {cqc && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="mb-1 font-semibold text-gray-800">سياسة «لا يمكن الوصول» ومهلة المراجعة — {cqc.name_ar}</h3>
          <p className="mb-3 text-xs text-gray-500">لا تُغلق حالة «لا يمكن الوصول» قبل استيفاء كل الشروط. كل تعديل يُسجَّل بسببه.</p>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {[
              ["min_attempts", "عدد المحاولات"], ["min_distinct_days", "أيام مختلفة"],
              ["min_channels", "قنوات مختلفة"], ["min_hours_between", "ساعات بين المحاولات"],
            ].map(([k, label]) => (
              <label key={k} className="text-gray-600">{label}
                <input className={`${input} mt-1 w-full`} type="number" min={0} value={num(cp[k])}
                  onChange={(e) => setCp({ ...cp, [k]: Number(e.target.value) })} />
              </label>
            ))}
            {[
              ["review_hours", "مهلة المراجعة (ساعة)"], ["deferred_days", "المسار المؤجّل (يوم تقويمي)"],
              ["first_attempt_hours", "أول محاولة خلال (ساعة)"],
            ].map(([k, label]) => (
              <label key={k} className="text-gray-600">{label}
                <input className={`${input} mt-1 w-full`} type="number" min={1} value={num(sla[k])}
                  onChange={(e) => setSla({ ...sla, [k]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <button disabled={busy} className="mt-3 rounded bg-brand-600 px-4 py-1.5 text-sm text-white"
            onClick={() => { const r = reason("سبب تعديل السياسة:"); if (r) rpc("review_type_set_policy", { p_code: cqc.code, p_contact: { ...cp, retry_after_hours: cp.min_hours_between }, p_sla: sla, p_reason: r }); }}>
            حفظ السياسة
          </button>
        </div>
      )}
    </div>
  );
}
