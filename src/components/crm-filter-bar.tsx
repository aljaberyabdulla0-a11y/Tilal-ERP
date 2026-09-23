import Link from "next/link";
import { getProjectsLite, getSources, getEmployeesLite } from "@/lib/crm";
import { DAY_CHOICES, type ParsedCrmFilters } from "@/lib/crm-filters";

// ============================================================
// شريط المُرشِّحات الموحّد (§44).
//
// ===== لماذا نموذج GET لا حالة في المتصفّح =====
//
// المُرشِّح في الرابط يعني ثلاثة أشياء مجّاناً: يُشارَك كما هو،
// ويُحفَظ في «العروض المحفوظة» (§46)، ويعود بزرّ الرجوع. وحالةٌ في
// المتصفّح لا تفعل شيئاً من ذلك.
//
// وبلا JavaScript أصلاً: `<form method="get">` وزرّ. الشريط يعمل
// قبل أن يُحمَّل شيء.
//
// ===== المدى الزمني: اختصارات ثم صراحة =====
//
// أربعة أزرار لما يُسأل يومياً (٧/٣٠/٩٠/سنة)، وحقلا تاريخ لمن أراد
// مدىً بعينه. والصريح يغلب: من كتب تاريخين قصدهما.
// ============================================================
export default async function CrmFilterBar({
  basePath,
  parsed,
  extra,
}: {
  basePath: string;
  parsed: ParsedCrmFilters;
  /** مُرشِّحات تخصّ لوحةً بعينها تُحمَل في الرابط كما هي */
  extra?: Record<string, string>;
}) {
  const [projects, sources, employees] = await Promise.all([
    getProjectsLite(),
    getSources(),
    getEmployeesLite(),
  ]);

  const { params, days, labels } = parsed;
  const all = { ...params, ...(extra ?? {}) };

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(all);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    // المدى الصريح وعدد الأيام لا يجتمعان
    if (patch.days) {
      q.delete("from");
      q.delete("to");
    }
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 text-sm">
        {/* ما يخصّ اللوحة يُحمَل كما هو كي لا يسقط عند الإرسال */}
        {Object.entries(extra ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        <label className="block">
          <span className="text-xs text-gray-500">من</span>
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="mt-1 block rounded border border-gray-300 px-2 py-1.5"
            dir="ltr"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">إلى</span>
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="mt-1 block rounded border border-gray-300 px-2 py-1.5"
            dir="ltr"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-500">الموظف</span>
          <select
            name="owner"
            defaultValue={params.owner ?? ""}
            className="mt-1 block rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">الكل</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-gray-500">المشروع</span>
          <select
            name="project"
            defaultValue={params.project ?? ""}
            className="mt-1 block rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">الكل</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-gray-500">المصدر</span>
          <select
            name="source"
            defaultValue={params.source ?? ""}
            className="mt-1 block rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">الكل</option>
            {sources.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          طبّق
        </button>

        {labels.length > 0 && (
          <Link href={basePath} className="px-2 py-2 text-sm text-gray-500 hover:text-gray-700">
            مسح
          </Link>
        )}
      </form>

      {/* اختصارات المدى — روابط لا حقول، فتُنقر بلا إرسال نموذج */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
        <span className="text-xs text-gray-500">المدى:</span>
        {DAY_CHOICES.map((d) => (
          <Link
            key={d}
            href={href({ days: d === 30 ? null : String(d) })}
            className={
              days === d
                ? "rounded-full bg-brand-600 px-3 py-1 text-white"
                : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"
            }
          >
            {d === 365 ? "سنة" : `${d} يوماً`}
          </Link>
        ))}

        {labels.length > 0 && (
          <span className="ms-auto flex flex-wrap gap-2">
            {labels.map((l) => (
              <span key={l} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-800">
                {l}
              </span>
            ))}
          </span>
        )}
      </div>
    </section>
  );
}
