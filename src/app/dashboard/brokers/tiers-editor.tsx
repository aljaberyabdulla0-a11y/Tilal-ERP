"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrokerCommissionTier, currentPeriod, tiersLabel } from "@/lib/types";

type Row = { min_units: string; rate: string };

// ============================================================
// محرّر شرائح العمولة — لمشروع (companyId فارغ) أو لشركة في مشروع.
//
// الحفظ يستبدل شرائح هذا النطاق كاملةً: يحذفها ثم يُدرج الجديدة. ثم
// يعرض إعادة حساب عمولات الشهر الحالي، لأن الشرائح الجديدة لا تمسّ
// عمولةً مستحقّة حتى يُعاد حسابها (أو تدخل الشهرَ صفقةٌ جديدة).
// ============================================================
export default function TiersEditor({
  projectId,
  companyId,
  tiers,
  canEdit,
  emptyHint,
}: {
  projectId: string;
  companyId: string | null;
  tiers: BrokerCommissionTier[];
  canEdit: boolean;
  emptyHint?: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const sorted = [...tiers].sort((a, b) => a.min_units - b.min_units);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(
    sorted.length
      ? sorted.map((t) => ({ min_units: String(t.min_units), rate: String(t.rate) }))
      : [{ min_units: "1", rate: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setError(null);
    const parsed = rows
      .filter((r) => r.min_units.trim() || r.rate.trim())
      .map((r) => ({ min_units: Number(r.min_units), rate: Number(r.rate) }));

    if (parsed.some((r) => !Number.isInteger(r.min_units) || r.min_units < 1)) {
      setError("«من الوحدة» عدد صحيح يبدأ من ١.");
      return;
    }
    if (parsed.some((r) => !Number.isFinite(r.rate) || r.rate < 0 || r.rate > 100)) {
      setError("النسبة بين ٠ و ١٠٠.");
      return;
    }
    if (new Set(parsed.map((r) => r.min_units)).size !== parsed.length) {
      setError("لا تتكرّر بداية شريحتين.");
      return;
    }
    if (parsed.length && !parsed.some((r) => r.min_units === 1)) {
      setError("ابدأ بشريحة «من الوحدة ١» — وإلا كانت أولى صفقات الشهر بلا نسبة.");
      return;
    }

    setBusy(true);
    let del = supabase.from("broker_commission_tiers").delete().eq("project_id", projectId);
    del = companyId ? del.eq("company_id", companyId) : del.is("company_id", null);
    const { error: delError } = await del;
    if (delError) {
      setBusy(false);
      setError("تعذّر الحفظ: " + delError.message);
      return;
    }

    if (parsed.length) {
      const { error: insError } = await supabase.from("broker_commission_tiers").insert(
        parsed.map((r) => ({ project_id: projectId, company_id: companyId, ...r }))
      );
      if (insError) {
        setBusy(false);
        setError("حُذفت الشرائح القديمة وتعذّر حفظ الجديدة: " + insError.message);
        return;
      }
    }

    setBusy(false);
    setEditing(false);
    setSaved(true);
    router.refresh();
  }

  async function recalc() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("recalc_broker_commissions", {
      p_company: companyId,
      p_project: projectId,
      p_period: currentPeriod(),
    });
    setBusy(false);
    if (error) {
      setError("تعذّرت إعادة الحساب: " + error.message);
      return;
    }
    setSaved(false);
    router.refresh();
  }

  const inputCls =
    "w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

  if (!editing) {
    return (
      <div className="text-sm">
        <span className={sorted.length ? "text-gray-700" : "text-amber-700"} dir="rtl">
          {sorted.length ? tiersLabel(sorted) : emptyHint ?? "لا شرائح — العمولة صفر"}
        </span>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="ms-3 text-xs font-semibold text-brand-700 hover:underline"
          >
            {sorted.length ? "تعديل" : "تعريف الشرائح"}
          </button>
        )}
        {saved && canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            حُفظت الشرائح. عمولات هذا الشهر المستحقّة سلفاً لم تتغيّر بعد.
            <button
              onClick={recalc}
              disabled={busy}
              className="font-bold underline disabled:opacity-50"
            >
              أعد حساب عمولات الشهر
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-gray-50 p-3">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">من الوحدة</span>
          <input
            type="number"
            min={1}
            value={r.min_units}
            onChange={(e) => setRow(i, { min_units: e.target.value })}
            className={inputCls}
            dir="ltr"
          />
          <span className="text-gray-500">في الشهر ←</span>
          <input
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={r.rate}
            onChange={(e) => setRow(i, { rate: e.target.value })}
            className={inputCls}
            dir="ltr"
          />
          <span className="text-gray-500">٪</span>
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            className="text-xs text-red-600 hover:underline"
          >
            حذف
          </button>
        </div>
      ))}
      <p className="text-xs text-gray-400">
        بأثر رجعي: حين تبلغ الشركة شريحةً تصير كل صفقاتها في المشروع ذلك
        الشهر بنسبتها. والعدّاد يبدأ من الصفر أول كل شهر.
        {companyId && " شرائح الشركة الخاصة تحلّ محلّ شرائح المشروع كلّها. احذفها كلها لتعود لشرائح المشروع."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const last = rows[rows.length - 1];
            const next = last ? Number(last.min_units || 0) + 5 : 1;
            setRows((prev) => [...prev, { min_units: String(next), rate: "" }]);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-white"
        >
          + شريحة
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "جارٍ الحفظ..." : "حفظ"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-white"
        >
          إلغاء
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
