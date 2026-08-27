"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrokerCompany } from "@/lib/types";

// ============================================================
// تصرّفات الإدارة في ليد الوساطة: إسناده لشركة، أو سحبه إلى تلال،
// أو تمديد مهلته.
//
// الثلاثة محميّة في القاعدة بمحفّز `guard_broker_assignment` — الشركة
// ومدير العلاقات لا يستطيعان أياً منها مهما فعلا بالواجهة. وإعادة
// الإسناد تُصفّر المهلة إلى ٣٠ يوماً كاملة من جديد.
// ============================================================
export default function LeadActions({
  clientId,
  companies,
  currentCompanyId,
  canExtend,
}: {
  clientId: string;
  companies: BrokerCompany[];
  currentCompanyId?: string | null;
  canExtend?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(patch: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;

    setBusy(true);
    setError(null);
    const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }
    setCompanyId("");
    router.refresh();
  }

  // تمديد أسبوع من اليوم — استثناء إداري موثَّق لا تصرّف من الشركة
  function extendWeek() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const iso = d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
    run(
      { broker_deadline: iso },
      "تمديد مهلة هذا الليد أسبوعاً من اليوم؟"
    );
  }

  const selectCls =
    "rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none";

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={busy}
          className={selectCls}
        >
          <option value="">— أسند لشركة —</option>
          {companies
            .filter((c) => c.is_active && c.id !== currentCompanyId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>

        <button
          onClick={() =>
            run(
              { broker_company_id: companyId },
              "إسناد الليد لهذه الشركة؟ تبدأ مهلة ٣٠ يوماً جديدة."
            )
          }
          disabled={busy || !companyId}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          إسناد
        </button>

        {currentCompanyId && (
          <button
            onClick={() =>
              run(
                { broker_company_id: null },
                "سحب الليد من الشركة وإعادته إلى تلال؟"
              )
            }
            disabled={busy}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            سحب لتلال
          </button>
        )}

        {canExtend && currentCompanyId && (
          <button
            onClick={extendWeek}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
          >
            تمديد أسبوع
          </button>
        )}
      </div>

      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
