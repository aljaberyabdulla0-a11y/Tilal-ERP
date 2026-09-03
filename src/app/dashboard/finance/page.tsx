import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, isAdmin } from "@/lib/auth";
import { getMoneyOverview } from "@/lib/money";
import { Invoice, Payment, formatPrice } from "@/lib/types";

// ============================================================
// المالية — بوابة واحدة لثلاثة أبواب: الفواتير والعمولات والمحاسبة.
//
// كانت الثلاثة بنوداً منفصلة في القائمة الجانبية، وقائمةٌ من اثني
// عشر بنداً لا تُقرأ بالنظر بل بالبحث. جُمعت تحت بندٍ واحد لأنها
// شيءٌ واحد في ذهن من يفتحها: مال الشركة — ما لها وما عليها.
//
// والبوابة ليست ثلاثة روابط: كل باب يحمل رقمه الحيّ، فيُعرف من
// الشاشة الأولى أين المشكلة قبل الدخول إلى أيّها.
//
// ⚠️ الأبواب تتبع الدور لا القائمة: المشرف يرى الفواتير وحدها،
//    والمحاسبة والعمولات للمدير — كما كانت السياسة قبل الجمع.
//    لا صلاحية جديدة تُفتح هنا ولا واحدة تُغلق.
// ============================================================
export default async function FinanceHome() {
  const [admin, team] = await Promise.all([isAdmin(), canSeeTeam()]);
  if (!admin && !team) redirect("/dashboard");

  const supabase = await createClient();

  // ===== أرقام الفواتير: المتبقّي على العملاء =====
  const [{ data: invData }, { data: payData }] = await Promise.all([
    supabase.from("invoices").select("id, total_amount"),
    supabase.from("payments").select("invoice_id, amount"),
  ]);

  const invoices = (invData ?? []) as Pick<Invoice, "id" | "total_amount">[];
  const payments = (payData ?? []) as Pick<Payment, "invoice_id" | "amount">[];

  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    paidByInvoice.set(
      p.invoice_id,
      (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount)
    );
  }

  let unpaidCount = 0;
  let unpaidAmount = 0;
  for (const inv of invoices) {
    const remaining =
      Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0);
    if (remaining > 0.01) {
      unpaidCount++;
      unpaidAmount += remaining;
    }
  }

  // ===== أرقام العمولات والمحاسبة (للمدير وحده) =====
  let pendingCommissions = 0;
  let uncollectedCompany = 0;
  let cash = 0;
  let payrollDue = 0;

  if (admin) {
    const [{ data: comms }, { data: sales }, money] = await Promise.all([
      supabase.from("commissions").select("amount").is("payroll_id", null),
      supabase
        .from("sale_commissions")
        .select("company_amount")
        .is("collected_at", null),
      getMoneyOverview(),
    ]);

    pendingCommissions = (comms ?? []).reduce(
      (s: number, c: { amount: number }) => s + Number(c.amount),
      0
    );
    uncollectedCompany = (sales ?? []).reduce(
      (s: number, c: { company_amount: number }) => s + Number(c.company_amount),
      0
    );
    cash = money.cash;
    payrollDue = money.payrollDue;
  }

  type Door = {
    href: string;
    title: string;
    desc: string;
    icon: string;
    stats: { label: string; value: string; tone?: string }[];
  };

  const doors: Door[] = [
    {
      href: "/dashboard/invoices",
      title: "الفواتير",
      desc: "فواتير العملاء وتحصيلها، ومبالغ الحجز.",
      icon: "receipt_long",
      stats: [
        {
          label: "فواتير لم تُسدَّد",
          value: String(unpaidCount),
          tone: unpaidCount > 0 ? "text-amber-700" : "text-green-700",
        },
        {
          label: "المتبقّي على العملاء",
          value: formatPrice(unpaidAmount),
          tone: unpaidAmount > 0 ? "text-amber-700" : "text-green-700",
        },
      ],
    },
    ...(admin
      ? [
          {
            href: "/dashboard/commissions",
            title: "العمولات",
            desc: "نسبة كل مشروع بشرائحها، وقاعدة كل موظف، وما استُحقّ.",
            icon: "percent",
            stats: [
              {
                label: "مستحقّة للموظفين ولم تدخل كشفاً",
                value: formatPrice(pendingCommissions),
                tone: pendingCommissions > 0 ? "text-amber-700" : "text-gray-600",
              },
              {
                label: "لنا عند المطوّرين ولم تُحصَّل",
                value: formatPrice(uncollectedCompany),
                tone: uncollectedCompany > 0 ? "text-brand-700" : "text-gray-600",
              },
            ],
          },
          {
            href: "/dashboard/accounting",
            title: "المحاسبة",
            desc: "الصندوق والبنك، والقيود، والتقارير المالية.",
            icon: "account_balance_wallet",
            stats: [
              {
                label: "الموجود الآن (صندوق + بنك)",
                value: formatPrice(cash),
                tone: cash >= 0 ? "text-brand-700" : "text-red-700",
              },
              {
                label: "رواتب وعمولات مستحقة علينا",
                value: formatPrice(payrollDue),
                tone: payrollDue > 0 ? "text-red-700" : "text-green-700",
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← لوحة التحكم
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">المالية</h1>
          <p className="text-sm text-gray-500">
            {admin
              ? "مال الشركة كلّه من مكان واحد — ما لها وما عليها."
              : "فواتير عملاء مشروعك وتحصيلها."}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-3">
        {doors.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="group flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                <span className="material-symbols-outlined text-[22px]">
                  {d.icon}
                </span>
              </span>
              <h2 className="text-lg font-bold text-gray-800 group-hover:text-brand-700">
                {d.title}
              </h2>
            </div>

            <p className="mt-3 text-sm text-gray-500">{d.desc}</p>

            {/* الرقم الحيّ: يُعرف من الشاشة الأولى أين المشكلة */}
            <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
              {d.stats.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-gray-500">{s.label}</span>
                  <b
                    className={`shrink-0 text-sm font-bold ${s.tone ?? "text-gray-800"}`}
                    dir="ltr"
                  >
                    {s.value}
                  </b>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
