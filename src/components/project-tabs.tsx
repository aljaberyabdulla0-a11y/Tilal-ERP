import Link from "next/link";

// ============================================================
// تبويبات المشاريع فوق قائمة العملاء ولوحة المسار (217).
//
// الموظف على أكثر من مشروع (216) وزبائن كل مشروع غير الآخر — فالفرز
// بالمشروع نقرةٌ ظاهرة لا خيارٌ في قائمة منسدلة. والعدد بجانب كلٍّ من
// نطاق السائل (crm_client_filter_options). تُخفى لمن له مشروع واحد.
//
// رابطٌ يُبقي بقيّة المُرشِّحات ويعود للصفحة الأولى.
// ============================================================
export default function ProjectTabs({
  base,
  params,
  projects,
  active,
}: {
  base: string;
  params: Record<string, string>;
  projects: { id: string; name: string; n: number }[];
  active: string | null;
}) {
  if (projects.length < 2) return null;

  const href = (project: string | null) => {
    const q = new URLSearchParams(params);
    q.delete("page");
    if (project) q.set("project", project);
    else q.delete("project");
    const s = q.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };

  const tab = (on: boolean) =>
    on
      ? "rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white"
      : "rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm text-gray-600 hover:border-brand-500 hover:text-brand-700";

  return (
    <nav aria-label="المشاريع" className="flex flex-wrap items-center gap-2">
      <span className="material-symbols-outlined text-[18px] text-gray-400">apartment</span>
      <Link href={href(null)} className={tab(!active)}>
        كل المشاريع
      </Link>
      {projects.map((p) => (
        <Link key={p.id} href={href(p.id)} className={tab(active === p.id)}>
          {p.name} <span className="opacity-70">({p.n})</span>
        </Link>
      ))}
    </nav>
  );
}
