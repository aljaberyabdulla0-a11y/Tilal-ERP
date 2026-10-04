import { requireMktRead } from "@/lib/marketing-guard";
import { getDataQuality } from "@/lib/marketing";
import { fmt } from "@/lib/marketing-style";
import { Card, PageHead, Unavailable } from "@/components/marketing/ui";

// ============================================================
// جودة بيانات التسويق — ما يجعل الأرقام تكذب إن تُرك.
//
// ليدٌ بلا مصدر يصير «غير منسوب» في كل تقرير، ومصروفٌ بلا حملة يرفع
// كلفة الشركة ولا يرفع كلفة أيّ حملة، ورمز QR مطبوع يقود إلى صفحة
// متوقفة يهدر اللوحة كلها. لكلٍّ هنا عدده وسببه وما يُفعل به.
// ============================================================
const SEV: Record<string, string> = {
  "عالٍ": "border-red-300 bg-red-50", "متوسط": "border-amber-300 bg-amber-50", "منخفض": "border-gray-200 bg-white",
};

export default async function QualityPage() {
  await requireMktRead();
  const q = await getDataQuality();
  const issues = q.data.filter((r) => Number(r.n) > 0);
  const clean = q.data.filter((r) => Number(r.n) === 0);

  return (
    <>
      <PageHead title="جودة بيانات التسويق" sub="فحصٌ حيّ — كل رقم يُحسب الآن من الجداول." />
      <Unavailable error={q.error} />
      {issues.length === 0 && !q.error && <p className="rounded-lg bg-brand-50 p-4 text-brand-800">لا مشكلات. كل الفحوص سليمة.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {issues.map((r) => (
          <section key={r.code} className={`rounded-lg border p-4 ${SEV[r.severity] ?? ""}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-gray-800">{r.label}</p>
              <span className="text-2xl font-bold tabular-nums">{fmt(r.n)}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{r.hint}</p>
            {Array.isArray(r.sample) && r.sample.length > 0 && (
              <details className="mt-2 text-xs text-gray-500">
                <summary className="cursor-pointer">أمثلة</summary>
                <ul className="mt-1 space-y-0.5">
                  {(r.sample as unknown[]).slice(0, 10).map((s, i) => (
                    <li key={i} dir="auto">{typeof s === "object" && s ? Object.values(s as Record<string, unknown>).map((x) => String(x ?? "—")).join(" · ") : String(s)}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>
      {clean.length > 0 && (
        <Card title="سليمة">
          <ul className="flex flex-wrap gap-2 text-xs text-gray-600">{clean.map((r) => <li key={r.code} className="rounded-full bg-brand-50 px-2 py-1 text-brand-700">✓ {r.label}</li>)}</ul>
        </Card>
      )}
    </>
  );
}
