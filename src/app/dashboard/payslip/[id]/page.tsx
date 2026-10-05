import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/types";
import PrintButton from "./print-button";

type SlipLine = { category: string; description: string | null; amount: number };
type Slip = {
  company: string | null;
  period: string;
  state: string;
  status: string | null;
  employee: {
    name: string; code: string; position: string | null; department: string | null;
    hire_date: string | null; bank: string | null; iban_tail: string | null;
  };
  earnings: SlipLine[];
  deductions: SlipLine[];
  totals: { basic: number; allowances: number; commissions: number; gross: number;
            deductions: number; net: number; paid: number; remaining: number };
  approved_at: string | null;
};

// قسيمة الراتب (sql/158). salary_slip() تقرّر من يراها: الموظف قسائمه
// المعتمدة وحدها، وHR والمالية الكل. «PDF» = اطبع ← احفظ PDF من المتصفح.
export default async function PayslipPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("salary_slip", { p_payroll: params.id });

  if (error || !data) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-600">{error?.message ?? "القسيمة غير متاحة"}</p>
          <Link href="/dashboard/me/salary" className="mt-3 inline-block text-sm text-brand-700 hover:underline">← رواتبي</Link>
        </div>
      </main>
    );
  }
  const s = data as Slip;
  const row = (l: SlipLine, i: number) => (
    <tr key={i} className="border-b border-gray-100 last:border-0">
      <td className="py-1.5">
        <span className="text-gray-800">{l.description || l.category}</span>
        {l.description && <span className="block text-[11px] text-gray-400">{l.category}</span>}
      </td>
      <td className="py-1.5 text-end font-medium" dir="ltr">{formatPrice(l.amount)}</td>
    </tr>
  );

  return (
    <main className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/dashboard/me/salary" className="text-sm text-gray-500 hover:text-brand-700">← رجوع</Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-lg font-bold text-brand-700">{s.company ?? "تلال"}</p>
            <h1 className="text-xl font-bold text-gray-900">قسيمة راتب — {s.period}</h1>
          </div>
          <div className="text-end text-sm">
            <p className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${s.state === "مسودة" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              {s.state}{s.status ? ` · ${s.status}` : ""}
            </p>
            {s.approved_at && <p className="mt-1 text-xs text-gray-500" dir="ltr">{s.approved_at.slice(0, 10)}</p>}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 border-b py-4 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-500">الموظف</dt><dd className="font-medium">{s.employee.name}</dd></div>
          <div><dt className="text-gray-500">الرقم الوظيفي</dt><dd className="font-mono" dir="ltr">{s.employee.code}</dd></div>
          <div><dt className="text-gray-500">المنصب</dt><dd>{s.employee.position ?? "—"}</dd></div>
          <div><dt className="text-gray-500">القسم</dt><dd>{s.employee.department ?? "—"}</dd></div>
          <div><dt className="text-gray-500">تاريخ المباشرة</dt><dd dir="ltr">{s.employee.hire_date ?? "—"}</dd></div>
          <div>
            <dt className="text-gray-500">الحساب</dt>
            <dd>{s.employee.bank ?? "—"}{s.employee.iban_tail ? <span dir="ltr"> ••••{s.employee.iban_tail}</span> : ""}</dd>
          </div>
        </dl>

        <div className="grid grid-cols-1 gap-6 py-4 sm:grid-cols-2">
          <section>
            <h2 className="mb-2 font-semibold text-green-700">الاستحقاقات</h2>
            <table className="w-full text-sm"><tbody>{s.earnings.map(row)}</tbody></table>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-red-700">الاستقطاعات</h2>
            {s.deductions.length === 0 ? (
              <p className="text-sm text-gray-400">لا استقطاعات.</p>
            ) : (
              <table className="w-full text-sm"><tbody>{s.deductions.map(row)}</tbody></table>
            )}
          </section>
        </div>

        <footer className="grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
          <div><p className="text-gray-500">الإجمالي</p><p className="font-semibold" dir="ltr">{formatPrice(s.totals.gross)}</p></div>
          <div><p className="text-gray-500">الاستقطاعات</p><p className="font-semibold text-red-700" dir="ltr">{formatPrice(s.totals.deductions)}</p></div>
          <div><p className="text-gray-500">الصافي</p><p className="text-lg font-bold text-brand-700" dir="ltr">{formatPrice(s.totals.net)}</p></div>
          <div>
            <p className="text-gray-500">المدفوع / المتبقّي</p>
            <p className="font-semibold" dir="ltr">{formatPrice(s.totals.paid)} / {formatPrice(s.totals.remaining)}</p>
          </div>
        </footer>
        <p className="mt-6 text-center text-[11px] text-gray-400">قسيمة صادرة من نظام تلال — الأرقام من القاعدة لا من المتصفح.</p>
      </article>
    </main>
  );
}
