import Link from "next/link";
import {
  getNextBestAction,
  getCustomerHealth,
  getMatchedUnits,
  getLeadScore,
  getClientOpportunities,
  TEMPERATURE_STYLE,
  scoreStyle,
  fmt,
} from "@/lib/crm";

// ============================================================
// «الرؤى» في ملف العميل — ما يضيفه الـCRM الجديد فوق البيانات.
//
// أربعة أشياء، بهذا الترتيب لأنه ترتيب القرار:
//   ١) ماذا أفعل الآن؟          الإجراء التالي بسببه
//   ٢) كم يساوي هذا العميل؟     الدرجة بأسبابها، والصحّة بمكوّناتها
//   ٣) ما صفقاته؟               الفرص المفتوحة والمغلقة
//   ٤) ما أعرضه عليه؟           الوحدات المطابقة بأسبابها
//
// كل رقم هنا يحمل تفسيره بجانبه. «٦٥» وحدها لا تُقنع الموظف بشيء؛
// «٦٥ = زار الموقع ١٥ + طلب عرضاً ٢٠ + …» تُقنعه وتُخبره ما ينقص.
//
// مكوّن خادم: يُستدعى من صفحة العميل ويقرأ بصلاحية القارئ نفسه،
// فلا يعرض لموظف ما لا تسمح به RLS على العميل.
// ============================================================
export default async function CrmInsights({ clientId }: { clientId: string }) {
  const [actions, health, units, score, opps] = await Promise.all([
    getNextBestAction(clientId),
    getCustomerHealth(clientId),
    getMatchedUnits(clientId, 5),
    getLeadScore(clientId),
    getClientOpportunities(clientId),
  ]);

  const nba = actions[0] ?? null;
  // لا هجرات بعد = لا شيء يُعرض، بلا ضجيج ولا صناديق فارغة
  if (!nba && !score && opps.length === 0 && health.length === 0) return null;

  const openOpps = opps.filter((o) => o.stage_type === "open");
  const closedOpps = opps.filter((o) => o.stage_type !== "open");

  return (
    <div className="space-y-4">
      {/* ===== ١) الإجراء التالي ===== */}
      {nba && (
        <div
          className={`rounded-2xl border p-4 ${
            nba.priority === 1
              ? "border-red-200 bg-red-50"
              : nba.priority === 2
                ? "border-amber-200 bg-amber-50"
                : "border-brand-200 bg-brand-50"
          }`}
        >
          <p className="text-xs font-medium text-gray-500">الإجراء التالي</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-gray-900">{nba.action}</p>
              <p className="text-sm text-gray-700">{nba.reason}</p>
            </div>
            <Link
              href={nba.link}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              نفّذ
            </Link>
          </div>
        </div>
      )}

      {/* ===== ٢) الدرجة والصحّة ===== */}
      {(score || health.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {score && (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500">درجة الليد</p>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    TEMPERATURE_STYLE[score.temperature] ?? "bg-gray-100 text-gray-500"
                  }`}
                >
                  {score.temperature}
                </span>
              </div>
              <p className={`mt-1 inline-block rounded-lg px-3 py-1 text-2xl font-bold ${scoreStyle(score.score)}`}>
                {score.score}
              </p>
              {/* الأسباب — هي ما يجعل الرقم قابلاً للتصديق والتحسين */}
              <ul className="mt-3 space-y-1 text-sm">
                {(score.reasons ?? []).map((r) => (
                  <li key={r.code} className="flex justify-between">
                    <span className="text-gray-700">{r.label}</span>
                    <span
                      className={r.points >= 0 ? "font-semibold text-brand-600" : "font-semibold text-red-600"}
                      dir="ltr"
                    >
                      {r.points > 0 ? `+${r.points}` : r.points}
                    </span>
                  </li>
                ))}
                {(score.reasons ?? []).length === 0 && (
                  <li className="text-gray-400">لا إشارات بعد — املأ الميزانية وسجّل التواصل.</li>
                )}
              </ul>
            </div>
          )}

          {health.length > 0 && (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">صحّة العلاقة</p>
              <ul className="mt-2 space-y-2">
                {health.map((h) => (
                  <li key={h.component}>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700">{h.component}</span>
                      <span className="font-semibold text-gray-800">{h.value}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-gray-100">
                      <div
                        className={`h-1.5 rounded ${
                          h.value >= 70 ? "bg-brand-500" : h.value >= 40 ? "bg-amber-400" : "bg-red-400"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, h.value))}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{h.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ===== ٣) الفرص ===== */}
      {opps.length > 0 && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">الفرص</p>
            <Link
              href={`/dashboard/crm/opportunities?client=${clientId}`}
              className="text-xs text-brand-600 hover:underline"
            >
              الكل
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-gray-100">
            {[...openOpps, ...closedOpps].map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    o.stage_type === "won"
                      ? "bg-green-100 text-green-700"
                      : o.stage_type === "lost"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {o.stage_name}
                </span>
                <span className="font-medium text-gray-800">
                  {o.project_name ?? "بلا مشروع"}
                </span>
                {o.expected_value !== null && (
                  <span className="text-gray-500">{fmt(o.expected_value)}</span>
                )}
                {o.stage_type === "open" && (
                  <span className="ms-auto text-xs text-gray-400">
                    {Math.round(Number(o.days_in_stage))} يوماً في المرحلة · {o.probability ?? 0}%
                  </span>
                )}
                {o.lost_reason && (
                  <span className="ms-auto text-xs text-red-600">{o.lost_reason}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ===== ٤) الوحدات المطابقة ===== */}
      {units.length > 0 && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm" id="units">
          <p className="text-xs font-medium text-gray-500">وحدات مرشَّحة له</p>
          <p className="text-xs text-gray-400">اقتراحٌ بأسبابه — القرار للموظف والعميل.</p>
          <ul className="mt-2 divide-y divide-gray-100">
            {units.map((u) => (
              <li key={u.unit_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link
                  href={`/dashboard/units/${u.unit_id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {u.project_name ?? "—"} / {u.unit_code ?? "—"}
                </Link>
                <span className="text-gray-500">
                  {u.unit_type ?? ""} {u.space_m2 ? `· ${u.space_m2}م²` : ""}{" "}
                  {u.price ? `· ${fmt(u.price)}` : ""}
                </span>
                <span className={`ms-auto rounded px-2 py-0.5 text-xs font-semibold ${scoreStyle(u.match_score)}`}>
                  {u.match_score}%
                </span>
                <span className="w-full text-xs text-gray-500">{u.reasons.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
