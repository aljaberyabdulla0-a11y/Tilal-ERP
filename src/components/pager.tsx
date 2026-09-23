import Link from "next/link";

// ============================================================
// ترقيم الصفحات (§62).
//
// يعرض **الإجمالي الحقيقي** لا عدد المعروض: «٦٧٤ عميلاً · صفحة ٢
// من ١٤». الفرق مهمّ — قائمةٌ تقول «٥٠ عميلاً» وهي تعرض صفحةً من
// ستّمئة تكذب على من يقرأها، وقد يبني عليها قراراً.
//
// والمُرشِّحات تُحمَل معها في الرابط: الانتقال إلى الصفحة التالية لا
// يُسقط بحثاً ولا مُرشِّحاً — وإلا عاد المستخدم إلى البداية كلما تصفّح.
// ============================================================
export default function Pager({
  total,
  page,
  pageSize,
  basePath,
  params,
  unit = "صفّاً",
}: {
  total: number;
  page: number;          // يبدأ من ١
  pageSize: number;
  basePath: string;
  params: Record<string, string>;   // المُرشِّحات الحالية بلا page
  unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (p: number) => {
    const q = new URLSearchParams(params);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // نوافذ الأرقام: الأولى، والأخيرة، وما حول الحالية — لا ستّون زرّاً
  const shown = Array.from(new Set([1, pages, page - 1, page, page + 1]))
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="تنقّل الصفحات">
      <p className="text-gray-500">
        الإجمالي <b className="text-gray-800">{total.toLocaleString("en-US")}</b> {unit}
        {pages > 1 && (
          <>
            {" · "}المعروض {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")}
            {" · "}صفحة {page} من {pages}
          </>
        )}
      </p>

      {pages > 1 && (
        <div className="flex items-center gap-1">
          {page > 1 && (
            <Link href={href(page - 1)} className="rounded border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600">
              السابقة
            </Link>
          )}
          {shown.map((p, i) => (
            <span key={p} className="flex items-center gap-1">
              {i > 0 && shown[i - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
              <Link
                href={href(p)}
                aria-current={p === page ? "page" : undefined}
                className={
                  p === page
                    ? "rounded bg-brand-600 px-3 py-1 font-semibold text-white"
                    : "rounded border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"
                }
              >
                {p}
              </Link>
            </span>
          ))}
          {page < pages && (
            <Link href={href(page + 1)} className="rounded border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600">
              التالية
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
