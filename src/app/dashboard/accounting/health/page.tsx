import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import AccTabs from "../acc-tabs";

type Issue = {
  severity: string;
  rank: number;
  check_code: string;
  title: string;
  detail: string;
  amount: number | null;
  ref_table: string;
  ref_id: string | null;
  ref_date: string | null;
  link: string | null;
};

const LEVELS: { rank: number; label: string; tone: string; dot: string }[] = [
  { rank: 1, label: "حرج", tone: "border-red-200 bg-red-50", dot: "bg-red-600" },
  { rank: 2, label: "عالٍ", tone: "border-orange-200 bg-orange-50", dot: "bg-orange-500" },
  { rank: 3, label: "متوسط", tone: "border-amber-200 bg-amber-50", dot: "bg-amber-400" },
  { rank: 4, label: "منخفض", tone: "border-gray-200 bg-gray-50", dot: "bg-gray-400" },
];

// ============================================================
// صحّة المحاسبة — كل مشكلة قائمة في الدفاتر بخطورتها (accounting_health — sql/114).
// التوازن وحده لا يكشف القيد اليتيم ولا الراتب المكرّر: هذه الصفحة
// تطابق الدفتر بمصادره. للقراءة فقط — الإصلاح من صفحة كل مشكلة.
// ============================================================
export default async function AccountingHealthPage() {
  if (!(await canManageFinance())) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounting_health");
  const issues = (data ?? []) as Issue[];

  // مجموعات: الخطورة ← الفحص ← الصفوف
  const byLevel = LEVELS.map((lv) => {
    const rows = issues.filter((i) => i.rank === lv.rank);
    const checks: [string, Issue[]][] = [];
    rows.forEach((r) => {
      const found = checks.find(([c]) => c === r.check_code);
      if (found) found[1].push(r);
      else checks.push([r.check_code, [r]]);
    });
    return { ...lv, count: rows.length, checks };
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">صحّة المحاسبة</h1>
        <p className="text-sm text-gray-500">
          مطابقة الدفتر بمصادره: قيود بلا مصدر، مصادر بلا قيد، ذمم لا تطابق صفقاتها، رواتب قد تتكرّر، فترات لم تُقفل.
        </p>
      </header>

      <AccTabs active="health" />

      <section className="space-y-5 p-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">تعذّر الفحص: {error.message}</div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {byLevel.map((lv) => (
            <a key={lv.rank} href={`#level-${lv.rank}`} className={`rounded-xl border p-4 ${lv.tone}`}>
              <span className="flex items-center gap-2 text-sm text-gray-600">
                <span className={`h-2.5 w-2.5 rounded-full ${lv.dot}`} />
                {lv.label}
              </span>
              <p className="mt-1 text-2xl font-bold text-gray-800">{lv.count}</p>
            </a>
          ))}
        </div>

        {!error && issues.length === 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center text-green-800">
            لا مشاكل قائمة.
          </div>
        )}

        {byLevel
          .filter((lv) => lv.count > 0)
          .map((lv) => (
            <div key={lv.rank} id={`level-${lv.rank}`} className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                <span className={`h-3 w-3 rounded-full ${lv.dot}`} />
                {lv.label} ({lv.count})
              </h2>
              {lv.checks.map(([code, rows]) => (
                <details key={code} open={lv.rank <= 2} className={`rounded-xl border bg-white shadow-sm`}>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="font-medium text-gray-800">
                      {rows[0].title}
                      <span className="ms-2 font-mono text-xs text-gray-400" dir="ltr">{code}</span>
                    </span>
                    <span className="text-sm text-gray-500">
                      {rows.length} ·{" "}
                      <span dir="ltr">
                        {formatPrice(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0))}
                      </span>
                    </span>
                  </summary>
                  <ul className="divide-y border-t text-sm">
                    {rows.map((r, idx) => (
                      <li key={`${r.ref_id ?? "x"}-${idx}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-gray-700">{r.detail}</p>
                          <p className="mt-0.5 text-xs text-gray-400" dir="ltr">
                            {r.ref_date ?? ""} {r.ref_table}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {r.amount !== null && (
                            <span className="font-medium text-gray-800" dir="ltr">
                              {formatPrice(Number(r.amount))}
                            </span>
                          )}
                          {r.link && (
                            <Link href={r.link} className="whitespace-nowrap text-brand-700 hover:underline">
                              افتح ←
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ))}
      </section>
    </main>
  );
}
