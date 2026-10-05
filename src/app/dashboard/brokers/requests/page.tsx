import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers } from "@/lib/auth";
import { getTeamMembers } from "@/lib/projects";
import {
  getBrokerCompanies,
  getBrokerRequests,
  getMyBrokerScope,
  getSupervisorBrokerDashboard,
} from "@/lib/brokers";
import {
  BROKER_REQUEST_COLORS,
  BROKER_REQUEST_GROUPS,
  BrokerReservationRequest,
  RESERVATION_STATUS_COLORS,
  formatPrice,
  isOpenBrokerRequest,
} from "@/lib/types";
import BrokersTabs from "../brokers-tabs";

// ============================================================
// طلبات الحجز من الوسطاء (sql/128) — شاشة واحدة لثلاثة:
//   • مدير العلاقات: طلبات شركاته (يستلم، يراجع، يوصي، يسأل).
//   • مشرف المشروع: **كل** طلبات مشاريعه أيّاً كان الـRM، ويقرّر.
//   • المدير: الكل.
// القاعدة تُرجع لكلٍّ نطاقه — لا فلترة بالدور هنا. والمرشّحات في الرابط
// فتُشارك وتُحفظ.
//
// المفتوح الأقدم أولاً: الطلب المفتوح يقفل الوحدة عن السوق، فكل ساعة
// تأخير وحدةٌ محجوبة.
// ============================================================
type SP = Record<string, string | undefined>;

export default async function BrokerRequestsPage({ searchParams }: { searchParams: SP }) {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [requests, members, companies, scope, supDash] = await Promise.all([
    getBrokerRequests(),
    getTeamMembers(),
    getBrokerCompanies(),
    getMyBrokerScope(),
    getSupervisorBrokerDashboard(),
  ]);

  const group = searchParams.group ?? "pending";
  const f = {
    project: searchParams.project ?? "",
    rm: searchParams.rm ?? "",
    company: searchParams.company ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
    q: (searchParams.q ?? "").trim(),
    minPrice: Number(searchParams.min ?? "") || 0,
    maxPrice: Number(searchParams.max ?? "") || 0,
  };

  const rmName = (id: string | null) => members.find((m) => m.id === id)?.full_name ?? null;
  const priceOf = (r: BrokerReservationRequest) => Number(r.requested_price ?? r.unit_price ?? 0);

  // المرشّحات (غير المجموعة) — تُطبَّق قبل العدّ فتطابق الأرقامُ ما يُعرض
  const filtered = requests.filter((r) => {
    if (f.project && r.project_id !== f.project) return false;
    if (f.rm && r.rm_id !== f.rm) return false;
    if (f.company && r.company_id !== f.company) return false;
    const day = r.created_at.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.q) {
      const hay = `${r.client_name ?? r.clients?.name ?? ""} ${r.client_phone ?? ""} ${r.unit_code ?? ""}`;
      if (!hay.includes(f.q)) return false;
    }
    if (f.minPrice && priceOf(r) < f.minPrice) return false;
    if (f.maxPrice && priceOf(r) > f.maxPrice) return false;
    return true;
  });

  const groupDef = BROKER_REQUEST_GROUPS.find((g) => g.key === group) ?? BROKER_REQUEST_GROUPS[0];
  const shown = filtered
    .filter((r) => (groupDef.statuses as string[]).includes(r.status))
    .sort((a, b) =>
      isOpenBrokerRequest(a.status)
        ? a.created_at.localeCompare(b.created_at)
        : (b.status_changed_at ?? b.created_at).localeCompare(a.status_changed_at ?? a.created_at)
    );

  const countOf = (statuses: string[]) => filtered.filter((r) => statuses.includes(r.status)).length;

  // المفتوح لكل مدير علاقات — أين يتراكم العمل
  const openByRm = new Map<string, number>();
  filtered
    .filter((r) => isOpenBrokerRequest(r.status))
    .forEach((r) => openByRm.set(r.rm_id ?? "", (openByRm.get(r.rm_id ?? "") ?? 0) + 1));

  const projects = Array.from(
    new Map(requests.filter((r) => r.project_id).map((r) => [r.project_id as string, r.projects?.name ?? "مشروع"])).entries()
  );
  const rms = Array.from(new Set(requests.map((r) => r.rm_id).filter(Boolean) as string[]));

  const age = (iso: string) => {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 36e5);
    return h < 24 ? `منذ ${h} ساعة` : `منذ ${Math.floor(h / 24)} يوم`;
  };

  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    Object.entries({ ...searchParams, ...patch }).forEach(([k, v]) => v && p.set(k, v));
    return `?${p.toString()}`;
  };

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">طلبات الحجز من الوسطاء</h1>
          <p className="text-xs text-gray-500">
            {scope.admin
              ? "كل المشاريع"
              : scope.supervisor && scope.rm
              ? "طلبات مشاريعك وشركاتك"
              : scope.supervisor
              ? "كل طلبات مشاريعك — القرار لك"
              : "طلبات شركاتك — تراجعها وتوصي، والقرار لمشرف المشروع"}
          </p>
        </div>
      </header>

      <BrokersTabs active="requests" />

      <section className="space-y-5 p-6">
        {/* لوحة المشرف: لكل مشروع */}
        {supDash.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {supDash.map((p) => (
              <Link
                key={p.project_id}
                href={qs({ project: p.project_id, group: "supervisor" })}
                className={`glass-card border-s-4 p-4 transition hover:shadow-md ${
                  p.pending_approval ? "border-s-orange-500" : "border-s-emerald-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <b className="text-gray-800">{p.project_name}</b>
                  {p.oldest_open_hours != null && (
                    <span className="text-xs text-gray-500">أقدم مفتوح: {Math.round(p.oldest_open_hours)} س</span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { l: "بانتظارك", v: p.pending_approval, c: "text-orange-700" },
                    { l: "مفتوحة", v: p.open_requests, c: "text-gray-800" },
                    { l: "حُجزت اليوم", v: p.approved_today, c: "text-emerald-700" },
                    { l: "رُفضت اليوم", v: p.rejected_today, c: "text-red-700" },
                  ].map((k) => (
                    <div key={k.l} className="rounded-lg bg-gray-50 p-2">
                      <span className={`block text-lg font-bold ${k.c}`}>{k.v}</span>
                      <span className="text-gray-500">{k.l}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  الوحدات: {p.units_available} متاحة · {p.units_requested} عليها طلب · {p.units_reserved} محجوزة ·{" "}
                  {p.units_sold} مباعة — صفقات الوسطاء: {p.reservations} حجز، {p.sales} بيع
                </p>
              </Link>
            ))}
          </div>
        )}

        {/* المرشّحات */}
        <form className="glass-card flex flex-wrap items-end gap-2 p-4" method="get">
          <input type="hidden" name="group" value={group} />
          {projects.length > 1 && (
            <select name="project" defaultValue={f.project} className={inputCls}>
              <option value="">كل المشاريع</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          {rms.length > 1 && (
            <select name="rm" defaultValue={f.rm} className={inputCls}>
              <option value="">كل مدراء العلاقات</option>
              {rms.map((id) => (
                <option key={id} value={id}>{rmName(id) ?? "—"}</option>
              ))}
            </select>
          )}
          <select name="company" defaultValue={f.company} className={inputCls}>
            <option value="">كل الشركات</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input name="q" defaultValue={f.q} placeholder="العميل أو الوحدة" className={inputCls} />
          <label className="text-xs text-gray-500">
            من
            <input type="date" name="from" defaultValue={f.from} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <label className="text-xs text-gray-500">
            إلى
            <input type="date" name="to" defaultValue={f.to} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <input name="min" type="number" defaultValue={searchParams.min ?? ""} placeholder="أدنى سعر" className={inputCls + " w-32"} dir="ltr" />
          <input name="max" type="number" defaultValue={searchParams.max ?? ""} placeholder="أعلى سعر" className={inputCls + " w-32"} dir="ltr" />
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            تصفية
          </button>
          <Link href="/dashboard/brokers/requests" className="px-2 py-2 text-sm text-gray-500 hover:text-brand-700">
            مسح
          </Link>
        </form>

        {/* المفتوح لكل RM */}
        {openByRm.size > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="py-1 text-gray-500">المفتوح لكل مدير علاقات:</span>
            {Array.from(openByRm.entries()).map(([id, n]) => (
              <Link
                key={id || "none"}
                href={qs({ rm: id || undefined })}
                className="rounded-full bg-white px-3 py-1 font-semibold text-gray-700 shadow-sm hover:bg-brand-50"
              >
                {rmName(id || null) ?? "بلا مدير علاقات"}: {n}
              </Link>
            ))}
          </div>
        )}

        {/* المجموعات */}
        <nav className="flex flex-wrap gap-2">
          {BROKER_REQUEST_GROUPS.map((g) => {
            const n = countOf(g.statuses);
            return (
              <Link
                key={g.key}
                href={qs({ group: g.key })}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  g.key === groupDef.key ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-brand-50"
                }`}
              >
                {g.label} ({n})
              </Link>
            );
          })}
        </nav>

        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            لا طلبات هنا.
          </p>
        ) : (
          <div className="space-y-3">
            {shown.map((r) => (
              <Link
                key={r.id}
                href={`/dashboard/brokers/requests/${r.id}`}
                className="glass-card block p-5 transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-800">
                      الوحدة {r.unit_code ?? "—"}
                      <span className="ms-2 text-sm font-normal text-gray-500">{r.projects?.name ?? ""}</span>
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                      <b className="text-brand-700">{r.broker_companies?.name ?? "شركة"}</b>
                      {" · العميل "}
                      {r.client_name ?? r.clients?.name ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {r.requested_by_name ?? "الوسيط"} · {age(r.created_at)}
                      {" · "}
                      <span dir="ltr">{formatPrice(Number(r.unit_price ?? 0))}</span>
                      {r.requested_price && Number(r.requested_price) !== Number(r.unit_price) && (
                        <>
                          {" ← مطلوب "}
                          <span dir="ltr" className="font-semibold text-amber-700">
                            {formatPrice(Number(r.requested_price))}
                          </span>
                        </>
                      )}
                      {" · الـRM: "}
                      {rmName(r.rm_id) ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${BROKER_REQUEST_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                    {r.rm_recommendation && isOpenBrokerRequest(r.status) && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          r.rm_recommendation === "أوصي بالرفض"
                            ? "bg-red-50 text-red-700"
                            : r.rm_recommendation === "أوصي بالموافقة"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.rm_recommendation}
                      </span>
                    )}
                    {r.reservation_status && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          RESERVATION_STATUS_COLORS[r.reservation_status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        الحجز: {r.reservation_status}
                      </span>
                    )}
                    {r.expires_at && isOpenBrokerRequest(r.status) && (
                      <span className="text-[11px] text-gray-400">
                        ينتهي {new Date(r.expires_at).toLocaleString("ar", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" })}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
