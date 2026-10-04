import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { getClientSalesHistory } from "@/lib/lost-sales";
import { lostDict, money, outcomeLabel, outcomeStyle, type Lang } from "@/lib/lost-sales-i18n";

// ============================================================
// «تاريخ المبيعات» في ملفّ العميل.
//
// العميل لا يصير «عميلاً خاسراً» لأن صفقةً خسرت: فرصة خاسرة، وأخرى
// رابحة، وثالثة مفتوحة — كلٌّ بنتيجته. والأرقام من
// crm_client_sales_history (141) لا من حساب هنا.
// ============================================================
export default async function SalesHistory({ clientId }: { clientId: string }) {
  const lang = getLocale() as Lang;
  const t = lostDict(lang);
  const h = await getClientSalesHistory(clientId);
  if (!h || h.total === 0) return null;

  const STAGE_STYLE: Record<string, string> = {
    won: "bg-green-100 text-green-700",
    lost: "bg-red-100 text-red-700",
    open: "bg-blue-100 text-blue-700",
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-bold text-gray-800">
        <span className="material-symbols-outlined text-[20px] text-brand-600">query_stats</span>
        {t.salesHistory}
      </h3>
      <p className="mb-4 text-xs text-gray-500">{t.salesHistoryHint}</p>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Num label={t.kTotal} value={h.total} />
        <Num label={t.kWon} value={h.won} tone="text-green-700" />
        <Num label={t.kLost} value={h.lost} tone="text-red-700" />
        <Num label={t.kOpen} value={h.open} tone="text-blue-700" />
        <Num label={t.kWonValue} value={money(h.won_value, lang)} small />
        <Num label={t.kLostValue} value={money(h.lost_value, lang)} small />
      </div>
      {h.recovered > 0 && (
        <p className="mt-2 text-xs text-emerald-700">
          {t.kRecovered}: {h.recovered} · {money(h.recovered_value, lang)}
        </p>
      )}

      <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
        {h.opportunities.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <Link href={`/dashboard/crm/opportunities/${o.id}`} className="font-medium text-gray-800 hover:text-brand-600">
              {o.title}
            </Link>
            <span className={`rounded px-2 py-0.5 text-xs ${STAGE_STYLE[o.stage_type] ?? "bg-gray-100"}`}>{tValue(o.stage_name, lang)}</span>
            {o.reactivated && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{outcomeLabel("reactivated", lang)}</span>}
            <span className="ms-auto text-xs text-gray-500">{money(o.value, lang)}</span>
          </li>
        ))}
      </ul>

      {h.losses.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-gray-600">{t.pastLossReasons}</p>
          <ul className="space-y-1.5">
            {h.losses.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-400" dir="ltr">{l.lost_at.slice(0, 10)}</span>
                <span className="font-semibold text-gray-800">
                  {l.category_code === "unanalysed"
                    ? t.kUnanalysed
                    : (lang === "en" ? l.category_name_en : l.category_name_ar)}
                </span>
                {(l.reason_name_ar || l.reason_name_en) && (
                  <span className="text-gray-600">— {lang === "en" ? l.reason_name_en : l.reason_name_ar}</span>
                )}
                {l.lost_stage_name && <span className="text-gray-400">· {tValue(l.lost_stage_name, lang)}</span>}
                {l.competitor && <span className="text-amber-700">· {l.competitor}</span>}
                <span className={`rounded px-1.5 py-0.5 ${outcomeStyle(l.outcome)}`}>{outcomeLabel(l.outcome, lang)}</span>
                <Link href={`/dashboard/crm/opportunities/${l.opportunity_id}?tab=lost`} className="ms-auto text-brand-600 hover:underline">
                  {t.open}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Num({ label, value, tone, small }: { label: string; value: number | string; tone?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2 text-center">
      <p className={`${small ? "text-sm" : "text-xl"} font-bold ${tone ?? "text-gray-800"}`}>{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  );
}
