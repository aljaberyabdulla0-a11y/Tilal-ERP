import Link from "next/link";
import { getOpportunities, countOpportunities, getStages, TEMPERATURE_STYLE, fmt, type OpportunityRow } from "@/lib/crm";

const BOARD_LIMIT = 500;
import { canWriteCrm, getUserRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import CrmTabs from "../crm-tabs";
import OpportunityStage from "./opportunity-stage";

// ============================================================
// «الفرص» — خطّ الأنابيب بالصفقات لا بالأشخاص.
//
// عرضان بنفس البيانات:
//   • الأعمدة (الافتراضي): كل مرحلة عمود، فيظهر بنظرة أين يتكدّس
//     الخطّ. الأعمدة لا تُسحب — تغيير المرحلة من القائمة داخل
//     البطاقة، وهو ما يمرّ بحارس القاعدة (سبب الفشل إلزامي).
//   • القائمة: للفرز والبحث حين تكثر الصفقات.
//
// المُرشِّحات في العنوان (?type=open|won|lost&client=…) لا في
// حالة العميل، فالرابط قابل للمشاركة والحفظ.
// ============================================================
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: { type?: string; client?: string; view?: string };
}) {
  const type = (["open", "won", "lost"].includes(searchParams.type ?? "")
    ? searchParams.type
    : null) as "open" | "won" | "lost" | null;
  const view = searchParams.view === "list" ? "list" : "board";

  // من لا يكتب يرى المرحلة شارةً لا قائمة: RLS تمنعه صمتاً، وقائمةٌ
  // تُغلق بلا أثر أسوأ من شارة تقول الحقيقة.
  // التسويق لا يتصفّح الصفقات فرداً فرداً (092) — عمله القنوات
  if ((await getUserRole()) === "marketing") redirect("/dashboard/crm/overview");

  const [all, stages, canWrite, totalCount] = await Promise.all([
    getOpportunities({ stageType: type, limit: BOARD_LIMIT }),
    getStages(),
    canWriteCrm(),
    countOpportunities(type),
  ]);
  // القطع يُعلَن: من يخطّط على «٥٠٠ فرصة» وهي ألف يبني على نصف الصورة
  const truncated = totalCount > all.length;
  const opps = searchParams.client ? all.filter((o) => o.client_id === searchParams.client) : all;

  const visibleStages = stages.filter(
    (s) => s.is_active && (type === null ? true : s.stage_type === type)
  );
  const totalValue = opps.reduce((s, o) => s + Number(o.expected_value ?? 0), 0);
  const weighted = opps.reduce((s, o) => s + Number(o.weighted_value ?? 0), 0);

  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { type: searchParams.type ?? null, client: searchParams.client ?? null, view: searchParams.view ?? null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/dashboard/crm/opportunities${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <CrmTabs active="opportunities" />

      <div className="space-y-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">الفرص</h1>
            <p className="mt-1 text-sm text-gray-500">
              {opps.length} فرصة · القيمة {fmt(totalValue)} · الموزونة {fmt(weighted)}
            </p>
            {truncated && (
              <p className="mt-1 text-xs text-amber-700">
                معروضٌ {all.length} من {fmt(totalCount)} — اللوحة تُقطع عند {BOARD_LIMIT}.
                ضيّق بالمُرشِّحات أعلاه لترى ما يعنيك كاملاً.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Filter href={qs({ type: null })} on={type === null} label="الكل" />
            <Filter href={qs({ type: "open" })} on={type === "open"} label="مفتوحة" />
            <Filter href={qs({ type: "won" })} on={type === "won"} label="فائزة" />
            <Filter href={qs({ type: "lost" })} on={type === "lost"} label="خاسرة" />
            <span className="mx-1 border-s border-gray-300" />
            <Filter href={qs({ view: null })} on={view === "board"} label="أعمدة" />
            <Filter href={qs({ view: "list" })} on={view === "list"} label="قائمة" />
          </div>
        </header>

        {stages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
            جدول المراحل غير متاح — شغّل الهجرة ٠٧٠.
          </p>
        ) : view === "board" ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {visibleStages.map((s) => {
              const col = opps.filter((o) => o.stage_id === s.id);
              const colValue = col.reduce((a, o) => a + Number(o.expected_value ?? 0), 0);
              return (
                <div key={s.id} className="w-72 shrink-0">
                  <div className={`rounded-t-lg px-3 py-2 ${s.color ?? "bg-gray-100 text-gray-700"}`}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs opacity-80">{col.length}</span>
                    </div>
                    <p className="text-xs opacity-70">
                      {fmt(colValue)} · {s.probability}%
                    </p>
                  </div>
                  <div className="min-h-[200px] space-y-2 rounded-b-lg border border-t-0 border-gray-200 bg-gray-50 p-2">
                    {col.map((o) => (
                      <Card key={o.id} o={o} stages={stages} canWrite={canWrite} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">العميل</th>
                  <th className="px-4 py-3 font-medium">المشروع</th>
                  <th className="px-4 py-3 font-medium">المرحلة</th>
                  <th className="px-4 py-3 font-medium">القيمة</th>
                  <th className="px-4 py-3 font-medium">الاحتمال</th>
                  <th className="px-4 py-3 font-medium">المالك</th>
                  <th className="px-4 py-3 font-medium">في المرحلة</th>
                  <th className="px-4 py-3 font-medium">صامت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {opps.map((o) => (
                  <tr key={o.id} className={o.is_overdue ? "bg-red-50" : ""}>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/clients/${o.client_id}`} className="font-medium text-brand-600 hover:underline">
                        {o.client_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{o.project_name ?? "—"}</td>
                    <td className="px-4 py-2">
                      {canWrite ? (
                        <OpportunityStage id={o.id} stageId={o.stage_id} stages={stages} />
                      ) : (
                        <StageBadge stages={stages} stageId={o.stage_id} />
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-800">{fmt(o.expected_value)}</td>
                    <td className="px-4 py-2 text-gray-500">{o.probability ?? "—"}%</td>
                    <td className="px-4 py-2 text-gray-600">{o.owner_name ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{Math.round(Number(o.days_in_stage))} يوماً</td>
                    <td className={`px-4 py-2 ${Number(o.days_silent) > 14 ? "text-red-600" : "text-gray-500"}`}>
                      {Math.round(Number(o.days_silent))} يوماً
                    </td>
                  </tr>
                ))}
                {opps.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">لا فرص بهذا المُرشِّح.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Filter({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={on ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
    >
      {label}
    </Link>
  );
}

function StageBadge({ stages, stageId }: { stages: { id: string; name: string; color?: string | null }[]; stageId: string }) {
  const s = stages.find((x) => x.id === stageId);
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${s?.color ?? "bg-gray-100 text-gray-700"}`}>
      {s?.name ?? "—"}
    </span>
  );
}

function Card({ o, stages, canWrite }: { o: OpportunityRow; stages: { id: string; name: string; stage_type: string; required_fields: string[]; color?: string | null }[]; canWrite: boolean }) {
  const silent = Math.round(Number(o.days_silent));
  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${o.is_overdue ? "border-red-300" : "border-gray-200"}`}>
      <Link href={`/dashboard/clients/${o.client_id}`} className="font-medium text-gray-800 hover:text-brand-600">
        {o.client_name}
      </Link>
      <p className="text-xs text-gray-500">{o.project_name ?? "بلا مشروع"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {o.expected_value !== null && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{fmt(o.expected_value)}</span>}
        {o.lead_temperature && (
          <span className={`rounded px-1.5 py-0.5 ${TEMPERATURE_STYLE[o.lead_temperature] ?? ""}`}>{o.lead_temperature}</span>
        )}
        <span className={silent > 14 ? "text-red-600" : "text-gray-400"}>صامت {silent}ي</span>
      </div>
      <div className="mt-2">
        {canWrite ? (
          <OpportunityStage id={o.id} stageId={o.stage_id} stages={stages} compact />
        ) : (
          <StageBadge stages={stages} stageId={o.stage_id} />
        )}
      </div>
      {o.owner_name && <p className="mt-1 text-xs text-gray-400">{o.owner_name}</p>}
    </div>
  );
}
