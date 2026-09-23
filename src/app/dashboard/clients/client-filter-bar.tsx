import Link from "next/link";
import { IRAQ_GOVERNORATES, PAYMENT_METHODS, PURCHASE_PURPOSES } from "@/lib/types";
import {
  CONTACT_OPTIONS,
  FOLLOWUP_OPTIONS,
  QUALITY_OPTIONS,
  NO_OWNER,
  type ParsedClientFilters,
} from "@/lib/client-list-filters";

// ============================================================
// شريط مُرشِّحات قائمة العملاء.
//
// نموذج GET بلا JavaScript، كشريط التقارير (crm-filter-bar): المُرشِّح
// في الرابط فيُشارَك كما هو، ويُحفَظ في «العروض المحفوظة»، ويعود بزرّ
// الرجوع — ويعمل قبل أن يُحمَّل شيء.
//
// صفّان: ما يُسأل كل يوم ظاهر (الموظف، المرحلة، المتابعة، آخر تواصل،
// المصدر، التاريخ)، والباقي تحت «فلاتر إضافية» — ويبقى مفتوحاً إن
// كان فيه مُرشِّح فعّال، كي لا يختفي سبب قِصَر القائمة.
// ============================================================

const BASE = "/dashboard/clients";

const field = "mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm";

function Select({
  label,
  name,
  value,
  options,
  allLabel = "الكل",
}: {
  label: string;
  name: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs text-gray-500">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={field}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const entries = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));
const plain = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

export default function ClientFilterBar({
  parsed,
  owners,
  stages,
  sources,
  temperatures,
  tags,
}: {
  parsed: ParsedClientFilters;
  owners: { id: string; full_name: string }[];
  stages: string[];
  sources: string[];
  temperatures: string[];
  tags: { id: string; name: string }[];
}) {
  const { params, chips, secondaryActive } = parsed;

  // رابطٌ يُغيّر مفتاحاً ويُبقي البقيّة — ويعود للصفحة الأولى دائماً،
  // فالصفحة الخامسة من قائمة أقصر قد لا تكون موجودة.
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    q.delete("page");
    const s = q.toString();
    return `${BASE}${s ? `?${s}` : ""}`;
  };

  // الموظف لا يُعرض لمن لا يرى غير نفسه — قائمةٌ من اسم واحد ضجيج
  const showOwner = owners.length > 1;

  // اختصارات ما يُسأل كل صباح — نقرة بدل ثلاث
  const presets: { label: string; patch: Record<string, string | null> }[] = [
    { label: "متابعات اليوم", patch: { followup: "today" } },
    { label: "متابعات متأخرة", patch: { followup: "overdue" } },
    { label: "لم يُتواصل معهم", patch: { contact: "never" } },
    { label: "صامتون +١٤ يوماً", patch: { contact: "over14" } },
  ];

  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <form method="get" action={BASE} className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {showOwner && (
            <Select
              label="الموظف"
              name="owner"
              value={params.owner}
              options={[
                ...owners.map((o) => ({ value: o.id, label: o.full_name })),
                { value: NO_OWNER, label: "— بلا موظف —" },
              ]}
            />
          )}
          <Select label="المرحلة" name="stage" value={params.stage} options={plain(stages)} />
          <Select label="المتابعة" name="followup" value={params.followup} options={entries(FOLLOWUP_OPTIONS)} />
          <Select label="آخر تواصل" name="contact" value={params.contact} options={entries(CONTACT_OPTIONS)} />
          <Select label="المصدر" name="source" value={params.source} options={plain(sources)} />
          <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1 lg:col-span-1">
            <label className="block min-w-0">
              <span className="text-xs text-gray-500">أُضيف من</span>
              <input type="date" name="from" defaultValue={params.from ?? ""} className={field} dir="ltr" />
            </label>
            <label className="block min-w-0">
              <span className="text-xs text-gray-500">إلى</span>
              <input type="date" name="to" defaultValue={params.to ?? ""} className={field} dir="ltr" />
            </label>
          </div>
        </div>

        <details open={secondaryActive} className="rounded-lg border border-dashed border-gray-200 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm text-gray-600">فلاتر إضافية</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Select label="الحرارة" name="temperature" value={params.temperature} options={plain(temperatures)} />
            <Select
              label="الوسم"
              name="tag"
              value={params.tag}
              options={tags.map((t) => ({ value: t.id, label: t.name }))}
            />
            <Select label="طريقة الدفع" name="payment" value={params.payment} options={plain(PAYMENT_METHODS)} />
            <Select label="الغرض" name="purpose" value={params.purpose} options={plain(PURCHASE_PURPOSES)} />
            <Select label="المحافظة" name="governorate" value={params.governorate} options={plain(IRAQ_GOVERNORATES)} />
            <label className="block min-w-0">
              <span className="text-xs text-gray-500">المنطقة</span>
              <input type="text" name="area" defaultValue={params.area ?? ""} placeholder="مثلاً: المنصور" className={field} />
            </label>
            <Select
              label="بيانات ناقصة"
              name="filter"
              value={params.filter}
              options={entries(QUALITY_OPTIONS)}
              allLabel="—"
            />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            طبّق
          </button>
          {chips.length > 0 && (
            <Link href={BASE} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
              مسح الكل
            </Link>
          )}
          <span className="ms-auto flex flex-wrap gap-2">
            {presets.map((p) => {
              const active = Object.entries(p.patch).every(([k, v]) => params[k] === v);
              return (
                <Link
                  key={p.label}
                  href={href(active ? Object.fromEntries(Object.keys(p.patch).map((k) => [k, null])) : p.patch)}
                  className={
                    active
                      ? "rounded-full bg-brand-600 px-3 py-1 text-xs text-white"
                      : "rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-brand-600"
                  }
                >
                  {p.label}
                </Link>
              );
            })}
          </span>
        </div>
      </form>

      {/* المُرشِّحات الفعّالة — كلٌّ يُزال وحده بنقرة */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="text-gray-500">مُرشَّح:</span>
          {chips.map((c) => (
            <Link
              key={c.key}
              href={href({ [c.key]: null })}
              className="group flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-brand-800 hover:bg-brand-100"
              title="إزالة هذا المُرشِّح"
            >
              {c.label}
              <span className="material-symbols-outlined text-[14px] opacity-60 group-hover:opacity-100">close</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
