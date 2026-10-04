import Link from "next/link";
import { requireMktRead } from "@/lib/marketing-guard";
import { searchMarketing } from "@/lib/marketing";
import { Card, PageHead, Unavailable } from "@/components/marketing/ui";

// البحث الشامل في القسم — حملات، محتوى، أنشطة، مؤثرون، موردون، روابط،
// صفحات، أصول، خطط، إعلانات. لا أشخاص: التسويق لا يتصفّح العملاء (092).
export default async function SearchPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const q = (searchParams.q ?? "").trim();
  const res = q.length >= 2 ? await searchMarketing(q) : { data: [], error: null };
  const groups = new Map<string, typeof res.data>();
  for (const r of res.data) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);

  return (
    <>
      <PageHead title="بحث في التسويق" sub="بالاسم أو الرمز (cmp-0001، act-0003) أو الوسم أو utm." />
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus placeholder="ابحث…" className="w-full max-w-lg rounded-lg border border-gray-300 px-3 py-2" />
        <button className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">ابحث</button>
      </form>
      <Unavailable error={res.error} />
      {q.length >= 2 && res.data.length === 0 && !res.error && <p className="text-sm text-gray-500">لا نتائج لـ«{q}».</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from(groups.entries()).map(([kind, rows]) => (
          <Card key={kind} title={`${kind} (${rows.length})`}>
            <ul className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="py-1.5">
                  <Link href={r.href} className="font-medium hover:text-brand-600">{r.title}</Link>
                  {r.subtitle && <span className="block text-xs text-gray-500" dir="auto">{r.subtitle}</span>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
