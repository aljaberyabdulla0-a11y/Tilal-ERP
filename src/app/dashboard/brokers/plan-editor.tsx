"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CommissionPlan,
  PLAN_BASES,
  PLAN_FORMULAS,
  PLAN_FORMULA_HINTS,
  PLAN_PAYABLE_RULES,
  PLAN_PERIODS,
  PlanBasis,
  PlanRecipientType,
  planPeriodKey,
  planTiersLabel,
} from "@/lib/types";

type Row = { from: string; unit_type: string; rate: string; fixed: string };

// ============================================================
// محرّر خطة عمولة (sql/129) — لمشروع ونوع مستفيد، أو خاصّة لشركة.
//
// الحفظ دالّةٌ واحدة ذرّية (save_commission_plan): تتحقّق وتستبدل الشرائح
// في معاملة — لا حذف ثم إدراج من المتصفح كما كان 117. خطةٌ عليها عمولات
// لا تتغيّر صيغتها ولا أساسها ولا فترتها: «خطة جديدة» تحلّ محلّها
// للمبيعات الجديدة، والقديمة تبقى لعمولاتها.
// ============================================================
export default function PlanEditor({
  projectId,
  recipientType,
  companyId = null,
  plan,
  unitTypes,
  canEdit,
  emptyHint,
}: {
  projectId: string;
  recipientType: PlanRecipientType;
  companyId?: string | null;
  plan: CommissionPlan | null;
  unitTypes: string[];
  canEdit: boolean;
  emptyHint?: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const tiers = plan?.commission_plan_tiers ?? [];
  const [editing, setEditing] = useState(false);
  const [asNew, setAsNew] = useState(false);
  const [formula, setFormula] = useState(plan?.formula ?? "شرائح رجعية");
  const [basis, setBasis] = useState<PlanBasis>(plan?.basis ?? "عدد الوحدات");
  const [period, setPeriod] = useState(plan?.period ?? "شهري");
  const [payable, setPayable] = useState(plan?.payable_rule ?? "بعد تحصيل عمولة تلال");
  const [name, setName] = useState(plan?.name ?? "");
  const [rows, setRows] = useState<Row[]>(
    tiers.length
      ? tiers.map((t) => ({
          from: String(basis === "قيمة المبيعات" ? t.min_value ?? 0 : t.min_units ?? 1),
          unit_type: t.unit_type ?? "",
          rate: t.rate != null ? String(t.rate) : "",
          fixed: t.fixed_amount != null ? String(t.fixed_amount) : "",
        }))
      : [{ from: "1", unit_type: "", rate: "", fixed: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const isBroker = recipientType === "وسيط";

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  function startNew() {
    setAsNew(true);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const value = basis === "قيمة المبيعات";
    const payloadTiers = rows
      .filter((r) => r.from.trim() || r.rate.trim() || r.fixed.trim())
      .map((r) => ({
        [value ? "min_value" : "min_units"]: Number(r.from),
        unit_type: r.unit_type || null,
        rate: r.rate.trim() ? Number(r.rate) : null,
        fixed_amount: r.fixed.trim() ? Number(r.fixed) : null,
      }));

    setBusy(true);
    const { error } = await supabase.rpc("save_commission_plan", {
      p_plan: {
        id: asNew ? null : plan?.id ?? null,
        project_id: projectId,
        recipient_type: recipientType,
        company_id: companyId,
        formula,
        basis,
        period,
        payable_rule: payable,
        name: name.trim() || null,
      },
      p_tiers: payloadTiers,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(false);
    setAsNew(false);
    setNote("حُفظت الخطة. العمولات المستحقّة لا تتغيّر حتى تُعيد حسابها أو تدخل الفترةَ صفقةٌ جديدة.");
    router.refresh();
  }

  async function recalc() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("recalc_commission_plan", {
      p_plan: plan.id,
      p_period: planPeriodKey(plan.period),
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNote(`أُعيد حساب ${data ?? 0} دلو للفترة الجارية (${planPeriodKey(plan.period)}).`);
    router.refresh();
  }

  async function toggle() {
    if (!plan) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_commission_plan_active", { p_id: plan.id, p_active: !plan.is_active });
    setBusy(false);
    if (error) setError(error.message);
    router.refresh();
  }

  const cls = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

  if (!editing) {
    return (
      <div className="text-sm">
        {plan ? (
          <>
            <p className="text-gray-700">
              <b>{plan.name ?? plan.formula}</b>
              <span className="ms-2 text-xs text-gray-500">
                {plan.formula} · {plan.basis} · {plan.period}
                {isBroker && ` · الصرف ${plan.payable_rule}`}
                {!plan.is_active && " · موقوفة"}
              </span>
            </p>
            <p className="mt-1 text-gray-600">{planTiersLabel(plan, tiers)}</p>
          </>
        ) : (
          <p className="text-amber-700">{emptyHint ?? "لا خطة"}</p>
        )}
        {canEdit && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <button onClick={() => setEditing(true)} className="font-semibold text-brand-700 hover:underline">
              {plan ? "تعديل الشرائح" : "تعريف خطة"}
            </button>
            {plan && (
              <>
                <button onClick={startNew} className="font-semibold text-brand-700 hover:underline">
                  خطة جديدة تحلّ محلّها
                </button>
                <button onClick={recalc} disabled={busy} className="font-semibold text-gray-600 hover:underline">
                  أعد حساب الفترة الجارية
                </button>
                <button onClick={toggle} disabled={busy} className="text-gray-500 hover:underline">
                  {plan.is_active ? "إيقاف" : "تفعيل"}
                </button>
              </>
            )}
          </div>
        )}
        {note && <p className="mt-2 text-xs text-emerald-700">{note}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const structural = Boolean(plan) && !asNew;

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      {asNew && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
          خطة جديدة: تسري على المبيعات القادمة، والخطة الحالية تُوقَف وتبقى عمولاتها عليها.
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الخطة (اختياري)" className={cls} />
        <label className="text-xs text-gray-500">
          الصيغة
          <select value={formula} onChange={(e) => setFormula(e.target.value as typeof formula)} className={cls + " mt-1 w-full"} disabled={structural}>
            {PLAN_FORMULAS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          الأساس
          <select value={basis} onChange={(e) => setBasis(e.target.value as PlanBasis)} className={cls + " mt-1 w-full"} disabled={structural}>
            {PLAN_BASES.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          الفترة
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className={cls + " mt-1 w-full"} disabled={structural}>
            {PLAN_PERIODS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        {isBroker && (
          <label className="text-xs text-gray-500">
            متى تُصرف
            <select value={payable} onChange={(e) => setPayable(e.target.value as typeof payable)} className={cls + " mt-1 w-full"}>
              {PLAN_PAYABLE_RULES.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-gray-500">
        {PLAN_FORMULA_HINTS[formula]}
        {structural && " — الصيغة والأساس والفترة لا تتغيّر لخطةٍ قائمة؛ استعمل «خطة جديدة»."}
      </p>

      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 text-start">{basis === "قيمة المبيعات" ? "من قيمة (د.ع)" : "من الوحدة"}</th>
            <th className="py-1 text-start">نوع الوحدة</th>
            <th className="py-1 text-start">النسبة ٪</th>
            <th className="py-1 text-start">مبلغ ثابت/وحدة</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pe-2">
                <input type="number" value={r.from} onChange={(e) => setRow(i, { from: e.target.value })} className={cls + " w-full"} dir="ltr" />
              </td>
              <td className="py-1 pe-2">
                <select value={r.unit_type} onChange={(e) => setRow(i, { unit_type: e.target.value })} className={cls + " w-full"}>
                  <option value="">كل الأنواع</option>
                  {unitTypes.map((u) => <option key={u}>{u}</option>)}
                </select>
              </td>
              <td className="py-1 pe-2">
                <input type="number" step="0.0001" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} className={cls + " w-full"} dir="ltr" />
              </td>
              <td className="py-1 pe-2">
                <input type="number" value={r.fixed} onChange={(e) => setRow(i, { fixed: e.target.value })} className={cls + " w-full"} dir="ltr" />
              </td>
              <td className="py-1">
                <button onClick={() => setRows((p) => p.filter((_, k) => k !== i))} className="text-xs text-red-500">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => setRows((p) => [...p, { from: "", unit_type: "", rate: "", fixed: "" }])}
        className="text-xs font-semibold text-brand-700 hover:underline"
      >
        + شريحة
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "..." : "حفظ"}
        </button>
        <button onClick={() => { setEditing(false); setAsNew(false); }} className="px-3 py-1.5 text-sm text-gray-500">
          إلغاء
        </button>
      </div>
    </div>
  );
}
