"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AutoCheckoutResult = { closed: number; notified: number };

// عدد الأيام التي يرجع إليها الزر اليدوي. الجدولة الليلية تكفي لليوم نفسه،
// وهذا الزر لمن يريد إغلاق أيام سابقة بقيت مفتوحة (لو تعطّلت الجدولة).
const DAYS_BACK = 7;

// ============================================================
// إغلاق البصمات الناقصة يدوياً (للمدير).
// النظام يعمل هذا تلقائياً كل ليلة على بصمات اليوم، وهذا الزر
// لتشغيله الآن أو لتغطية أيام سابقة نسي فيها الموظفون الانصراف.
// ============================================================
export default function RunAutoCheckout() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        `سيُسجَّل الانصراف على نهاية الدوام لكل بصمة بلا انصراف خلال آخر ${DAYS_BACK} أيام. متابعة؟`
      )
    )
      return;

    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("run_auto_checkout", {
      p_days_back: DAYS_BACK,
    });
    setBusy(false);

    if (error) {
      setMsg("تعذّرت العملية: " + error.message);
      return;
    }
    const r = data as AutoCheckoutResult;
    setMsg(
      r.closed === 0
        ? "لا توجد بصمات ناقصة."
        : `أُغلقت ${r.closed} بصمة على نهاية الدوام، وأُشعر ${r.notified} موظفاً.`
    );
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={run}
        disabled={busy}
        title="يعمل تلقائياً كل ليلة — هذا الزر لتشغيله الآن أو لتغطية أيام سابقة"
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]">timer_off</span>
        {busy ? "جارٍ الإغلاق..." : "إغلاق البصمات الناقصة"}
      </button>

      {msg && (
        <p className="absolute left-0 top-11 z-20 w-72 rounded-xl border bg-white p-3 text-xs text-gray-700 shadow-lg">
          {msg}
          <button
            onClick={() => setMsg(null)}
            className="mr-2 font-medium text-brand-600 hover:underline"
          >
            إغلاق
          </button>
        </p>
      )}
    </div>
  );
}
