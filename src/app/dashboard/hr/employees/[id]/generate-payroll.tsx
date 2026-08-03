"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";

// توليد كشف راتب لموظف — يجمع الأساسي + البدلات + العمولات - الاستقطاعات
export default function GeneratePayroll({
  employeeId,
  baseSalary,
  commissionsTotal,
  deductionsTotal,
}: {
  employeeId: string;
  baseSalary: number;
  commissionsTotal: number;
  deductionsTotal: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [period, setPeriod] = useState(thisMonth);
  const [allowances, setAllowances] = useState("0");
  const [saving, setSaving] = useState(false);

  const net =
    baseSalary + (Number(allowances) || 0) + commissionsTotal - deductionsTotal;

  async function generate() {
    setSaving(true);
    // 1) إنشاء الكشف
    const { data, error } = await supabase
      .from("payrolls")
      .insert({
        employee_id: employeeId,
        period,
        basic: baseSalary,
        allowances: Number(allowances) || 0,
        commissions_total: commissionsTotal,
        deductions_total: deductionsTotal,
        net,
      })
      .select("id")
      .single();

    // 2) وسم العمولات والاستقطاعات غير المحتسبة بأنها ضُمّت لهذا الكشف
    //    حتى لا تتكرّر في كشف الشهر القادم
    if (!error && data?.id) {
      await Promise.all([
        supabase
          .from("commissions")
          .update({ payroll_id: data.id })
          .eq("employee_id", employeeId)
          .is("payroll_id", null),
        supabase
          .from("deductions")
          .update({ payroll_id: data.id })
          .eq("employee_id", employeeId)
          .is("payroll_id", null),
      ]);
    }

    setSaving(false);
    if (error) {
      alert("تعذّر التوليد: " + error.message);
      return;
    }
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">الشهر</label>
          <input
            type="month"
            dir="ltr"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={cls + " text-left"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">البدلات</label>
          <input
            type="number"
            min="0"
            dir="ltr"
            value={allowances}
            onChange={(e) => setAllowances(e.target.value)}
            className={cls + " w-28 text-left"}
          />
        </div>
        <div className="text-sm text-gray-600">
          الصافي المتوقّع:{" "}
          <b className="text-gray-800" dir="ltr">
            {formatPrice(net)}
          </b>
        </div>
        <button
          onClick={generate}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "..." : "توليد كشف الراتب"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        الأساسي {formatPrice(baseSalary)} + العمولات {formatPrice(commissionsTotal)} −
        الاستقطاعات {formatPrice(deductionsTotal)} + البدلات = الصافي
      </p>
      <p className="mt-1 text-xs text-gray-400">
        التوليد يسجّل الراتب كمستحق للموظف فقط — الصندوق ينقص عند الضغط على «دفع».
      </p>
    </div>
  );
}
