import Link from "next/link";
import {
  getDistributionAlerts,
  getOwnerLoad,
  getSlaSummary,
  getUnworkedLeads,
  SEVERITY_STYLE,
  fmt,
} from "@/lib/crm";

// ============================================================
// «ما يحتاج تدخّلاً في الـCRM» — كتلة لمدير المتابعة والمشرف (§40).
//
// تفصل ثلاثة أشياء كانت تُخلط في «أداء ضعيف»: حجم ما أُسنِد،
// وتركّز الإسناد، والعمل عليه (sql/073). فالموظف الذي يحمل ٦٢ ليداً
// مهملاً قد يكون ضحيّة دفعة مستوردة لا مقصّراً — والكتلة تقول ذلك
// بدل أن تتركه للانطباع.
//
// تُعرض فقط حين يوجد ما يستدعي الانتباه؛ لوحة خالية من التنبيهات
// لا تحتاج قسماً يقول «لا شيء».
// ============================================================
export default async function CrmAttention() {
  const [alerts, load, unworked, sla] = await Promise.all([
    getDistributionAlerts(),
    getOwnerLoad(),
    getUnworkedLeads(),
    getSlaSummary(),
  ]);

  const openBreaches = sla.reduce((s, r) => s + Number(r.still_open), 0);
  const overloaded = load.filter((o) => o.over_capacity);
  const silentOwners = load.filter(
    (o) => Number(o.open_leads) > 0 && (!o.last_activity || Date.now() - new Date(o.last_activity).getTime() > 7 * 86400000)
  );

  if (alerts.length === 0 && unworked.length === 0 && openBreaches === 0 && overloaded.length === 0) return null;

  // الأقدم أولاً — «أقدم ليد لم يُلمَس» هو الرقم الذي يُحرج
  const oldest = [...unworked].sort((a, b) => Number(b.days_since_assignment) - Number(a.days_since_assignment)).slice(0, 5);

  return (
    <section className="mb-6">
      <div className="glass-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-brand-900">الـCRM — ما يحتاج تدخّلاً</h2>
          <Link href="/dashboard/crm/distribution" className="text-sm text-brand-600 hover:underline">
            مركز التوزيع
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="ليدات لم يُعمل عليها" value={fmt(unworked.length)} href="/dashboard/crm/distribution" tone={unworked.length > 0 ? "red" : undefined} />
          <Stat label="خروق مستوى الخدمة" value={fmt(openBreaches)} href="/dashboard/crm/reports#sla" tone={openBreaches > 0 ? "red" : undefined} />
          <Stat label="موظفون فوق السعة" value={fmt(overloaded.length)} href="/dashboard/crm/distribution" tone={overloaded.length > 0 ? "amber" : undefined} />
          <Stat label="مالك صامت أسبوعاً" value={fmt(silentOwners.length)} href="/dashboard/crm/distribution" tone={silentOwners.length > 0 ? "amber" : undefined} />
        </div>

        {alerts.length > 0 && (
          <ul className="mt-4 space-y-2">
            {alerts.slice(0, 4).map((a, i) => (
              <li key={`${a.code}-${i}`} className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLE[a.severity]}`}>
                <b>{a.title}:</b> {a.detail}
                <span className="mt-1 block text-xs opacity-70">↳ {a.recommendation}</span>
              </li>
            ))}
          </ul>
        )}

        {oldest.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase text-gray-400">أقدم ما لم يُلمَس</p>
            <ul className="divide-y divide-gray-100 text-sm">
              {oldest.map((u) => (
                <li key={u.client_id} className="flex items-center justify-between py-1.5">
                  <Link href={`/dashboard/clients/${u.client_id}`} className="font-medium text-brand-700 hover:underline">
                    {u.client_name}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {u.owner_name ?? "بلا مالك"} · منذ {Math.round(Number(u.days_since_assignment))} يوماً
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: string; href: string; tone?: "red" | "amber" }) {
  const v = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-brand-900";
  return (
    <Link href={href} className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-brand-300">
      <p className={`text-xl font-bold ${v}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </Link>
  );
}
