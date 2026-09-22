import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getForecast, getTargetProgress, getForecastBy, fmt } from "@/lib/crm";
import CrmTabs from "../crm-tabs";
import TargetForm from "./target-form";

// ============================================================
// «الأهداف والتنبؤ»
//
// التنبؤ ثلاثة أرقام لا رقم واحد (sql/078):
//     مُغلق      ما بيع فعلاً                يقين
//     ملتزم      مفتوح ≥٧٠٪ وموعده قريب      ترجيح عالٍ
//     أفضل حالة  كل المفتوح موزوناً           سقف
//
// ورقمٌ واحد يُقدَّم للإدارة باسم «التنبؤ» يُقرأ كوعد. ثلاثة تُقرأ
// كمدى — وهو الصدق. وعمود «بتاريخ مُقدَّر» يقول كم فرصة دخلت بلا
// تاريخ إغلاق متوقَّع، فتُعرف متانة الرقم.
//
// والأهداف: المستهدَف والمُنجَز والفجوة و**الأنابيب المطلوبة** —
// كم فرصة يلزم فتحها لسدّ الفجوة بمعدّل الفوز الحالي. الأخير هو
// الرقم القابل للعمل؛ «تبقّى ٤ صفقات» لا يُعمَل به، و«يلزمك ١٦
// فرصة» يُعمَل به.
// ============================================================
export default async function ForecastPage({
  searchParams,
}: {
  searchParams: { period?: string; by?: string };
}) {
  const role = await getUserRole();
  if (role !== "admin" && role !== "followup_manager" && role !== "supervisor") {
    redirect("/dashboard/crm/today");
  }

  const periodType = ["شهري", "ربعي", "سنوي"].includes(searchParams.period ?? "")
    ? (searchParams.period as string)
    : "شهري";

  const today = baghdadDate();
  const monthStart = today.slice(0, 7) + "-01";

  const supabase = await createClient();
  const by = (["موظف", "مشروع", "مصدر", "فريق"].includes(searchParams.by ?? "")
    ? searchParams.by
    : "موظف") as "موظف" | "مشروع" | "مصدر" | "فريق";

  const [forecast, targets, byRows, { data: emps }, { data: projs }] = await Promise.all([
    getForecast(6),
    getTargetProgress(null, periodType),
    getForecastBy(by),
    supabase.from("employees").select("id, full_name").eq("status", "active").order("full_name"),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  const maxBest = Math.max(1, ...forecast.map((f) => Number(f.best_case_value)));

  return (
    <div>
      <CrmTabs active="forecast" />

      <div className="space-y-8 p-6">
        <header>
          <h1 className="text-xl font-bold text-brand-600">الأهداف والتنبؤ</h1>
          <p className="mt-1 text-sm text-gray-500">ثلاثة أرقام لا رقم واحد — لأن الرقم الواحد يُقرأ كوعد.</p>
        </header>

        {/* ===== التنبؤ ===== */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-bold text-gray-800">الأشهر الستة القادمة</h2>
          {forecast.length === 0 ? (
            <p className="mt-4 text-sm text-gray-400">التنبؤ غير متاح — شغّل الهجرة ٠٧٨.</p>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {forecast.map((f) => (
                  <div key={f.period}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-gray-700">{f.period.slice(0, 7)}</span>
                      <span className="text-xs text-gray-500">
                        {f.open_count} مفتوحة
                        {Number(f.undated_count) > 0 && <span className="text-amber-600"> · {f.undated_count} بتاريخ مُقدَّر</span>}
                      </span>
                    </div>
                    {/* ثلاثة أشرطة متراكبة: المُغلق داخل الملتزم داخل أفضل حالة */}
                    <div className="relative mt-1 h-5 rounded bg-gray-100">
                      <div className="absolute inset-y-0 start-0 rounded bg-gray-300" style={{ width: `${(Number(f.best_case_value) / maxBest) * 100}%` }} />
                      <div className="absolute inset-y-0 start-0 rounded bg-amber-400" style={{ width: `${(Number(f.commit_value) / maxBest) * 100}%` }} />
                      <div className="absolute inset-y-0 start-0 rounded bg-brand-600" style={{ width: `${(Number(f.closed_value) / maxBest) * 100}%` }} />
                    </div>
                    <div className="mt-1 flex gap-4 text-xs">
                      <span className="text-brand-700">مُغلق {fmt(f.closed_value)}</span>
                      <span className="text-amber-700">ملتزم {fmt(f.commit_value)}</span>
                      <span className="text-gray-500">أفضل حالة {fmt(f.best_case_value)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-gray-400">
                الترجيح بالاحتمال المُعلَن لكل مرحلة، لا بمعدّلات تاريخية — لا توجد دورات مكتملة كافية بعد. يُضاف التصحيح التاريخي حين تتوفّر.
              </p>
            </>
          )}
        </section>

        {/* ===== الأنابيب المفتوحة بالبُعد — من يحمل الرقم؟ (§20) ===== */}
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="font-bold text-gray-800">الأنابيب المفتوحة حسب {by}</h2>
              <p className="text-xs text-gray-500">القيمة الاسمية، والموزونة بالاحتمال، والملتزم (≥٧٠٪) — لكل {by} على حدة.</p>
            </div>
            <div className="flex gap-2 text-sm">
              {(["موظف", "مشروع", "مصدر", "فريق"] as const).map((d) => (
                <a
                  key={d}
                  href={`/dashboard/crm/forecast?period=${periodType}&by=${d}`}
                  className={by === d ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
                >
                  {d}
                </a>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{by}</th>
                  <th className="px-4 py-3 font-medium">فرص مفتوحة</th>
                  <th className="px-4 py-3 font-medium">القيمة</th>
                  <th className="px-4 py-3 font-medium">الموزونة</th>
                  <th className="px-4 py-3 font-medium">ملتزم</th>
                  <th className="px-4 py-3 font-medium">متوسط الاحتمال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byRows.map((r) => (
                  <tr key={r.dimension_id ?? r.dimension_name}>
                    <td className="px-4 py-2 font-medium text-gray-800">{r.dimension_name}</td>
                    <td className="px-4 py-2">{fmt(r.open_count)}</td>
                    <td className="px-4 py-2 text-gray-600">{fmt(r.pipeline_value)}</td>
                    <td className="px-4 py-2 text-gray-800">{fmt(r.weighted_value)}</td>
                    <td className="px-4 py-2 font-semibold text-amber-700">{fmt(r.commit_value)}</td>
                    <td className="px-4 py-2 text-gray-500">{r.avg_probability}%</td>
                  </tr>
                ))}
                {byRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">لا فرص مفتوحة — أو الهجرة ٠٧٨ لم تُشغَّل.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== الأهداف ===== */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-gray-800">الأهداف</h2>
            <div className="flex gap-2 text-sm">
              {["شهري", "ربعي", "سنوي"].map((p) => (
                <a
                  key={p}
                  href={`/dashboard/crm/forecast?period=${p}`}
                  className={periodType === p ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
                >
                  {p}
                </a>
              ))}
            </div>
          </div>

          {targets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400">
              لا أهداف {periodType}ة لهذه المدة.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">النطاق</th>
                    <th className="px-4 py-3 font-medium">المقياس</th>
                    <th className="px-4 py-3 font-medium">المستهدَف</th>
                    <th className="px-4 py-3 font-medium">المُنجَز</th>
                    <th className="px-4 py-3 font-medium">التقدّم</th>
                    <th className="px-4 py-3 font-medium">المتبقّي</th>
                    <th className="px-4 py-3 font-medium">أيام</th>
                    <th className="px-4 py-3 font-medium">الأنابيب المطلوبة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {targets.map((t) => (
                    <tr key={t.target_id} className={t.on_track ? "" : "bg-amber-50"}>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {t.scope_name}
                        <span className="ms-1 text-xs text-gray-400">{t.scope}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{t.metric}</td>
                      <td className="px-4 py-3 text-gray-800">{fmt(t.target_value)}</td>
                      <td className="px-4 py-3 font-semibold text-brand-700">{fmt(t.achieved)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 rounded bg-gray-100">
                            <div className={`h-2 rounded ${t.on_track ? "bg-brand-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, Number(t.achieved_pct))}%` }} />
                          </div>
                          <span className={t.on_track ? "text-gray-600" : "font-semibold text-amber-700"}>{t.achieved_pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{fmt(t.remaining)}</td>
                      <td className="px-4 py-3 text-gray-500">{t.days_left}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {fmt(t.pipeline_needed)}
                        <span className="ms-1 text-xs font-normal text-gray-400">(الآن {fmt(t.pipeline_open)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {role === "admin" && (
            <TargetForm
              employees={(emps ?? []) as { id: string; full_name: string }[]}
              projects={(projs ?? []) as { id: string; name: string }[]}
              defaultStart={monthStart}
            />
          )}
        </section>
      </div>
    </div>
  );
}
