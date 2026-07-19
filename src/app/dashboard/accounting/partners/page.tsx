import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Partner,
  PartnerExpense,
  PartnerSettlement,
  formatPrice,
} from "@/lib/types";
import AddPartnerExpense from "./add-partner-expense";
import AddPartnerSettlement from "./add-partner-settlement";
import DeleteRowButton from "./delete-row-button";

// صفحة الشركاء والتصفية — تحسب من مدين لمن
export default async function PartnersPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: pData }, { data: eData }, { data: sData }] = await Promise.all([
    supabase.from("partners").select("*").order("created_at"),
    supabase.from("partner_expenses").select("*").order("expense_date", { ascending: false }),
    supabase.from("partner_settlements").select("*").order("settlement_date", { ascending: false }),
  ]);

  const partners = (pData ?? []) as Partner[];
  const expenses = (eData ?? []) as PartnerExpense[];
  const settlements = (sData ?? []) as PartnerSettlement[];

  const nameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? "—";

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  // حساب وضع كل شريك
  const stats = partners.map((p) => {
    const paid = expenses.filter((e) => e.paid_by === p.id).reduce((s, e) => s + e.amount, 0);
    const setFrom = settlements.filter((s) => s.from_partner === p.id).reduce((a, s) => a + s.amount, 0);
    const setTo = settlements.filter((s) => s.to_partner === p.id).reduce((a, s) => a + s.amount, 0);
    const contributed = paid + setFrom - setTo; // ما ساهم به فعلياً بعد التسويات
    const obligation = totalExpenses * (p.share_percent / 100); // حصته المستحقة
    const net = contributed - obligation; // موجب: دائن (له) | سالب: مدين (عليه)
    return { ...p, paid, contributed, obligation, net };
  });

  // خلاصة التصفية (بين شريكين)
  const creditor = stats.find((s) => s.net > 0.009);
  const debtor = stats.find((s) => s.net < -0.009);
  const settleAmount = creditor ? creditor.net : 0;

  const card = "glass-card p-6";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/accounting" className="text-sm text-gray-500 hover:text-brand-700">
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الشركاء والتصفية</h1>
      </header>

      <section className="space-y-6 p-6">
        {/* خلاصة التصفية */}
        <div
          className={`rounded-2xl border p-6 shadow-sm ${
            debtor && creditor ? "bg-amber-50" : "bg-green-50"
          }`}
        >
          <h3 className="mb-1 text-lg font-bold text-gray-800">خلاصة التصفية</h3>
          {debtor && creditor ? (
            <p className="text-gray-800">
              <b className="text-amber-700">{debtor.name}</b> مدين لـ{" "}
              <b className="text-green-700">{creditor.name}</b> بمبلغ{" "}
              <b className="text-xl" dir="ltr">{formatPrice(settleAmount)}</b> دينار.
            </p>
          ) : (
            <p className="text-green-700">✓ الحسابات متوازنة — لا مديونية بين الشركاء.</p>
          )}
        </div>

        {/* جدول أوضاع الشركاء */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-bold text-gray-800">أوضاع الشركاء</h3>
          <div className="mb-4 text-sm text-gray-500">
            إجمالي المصاريف المشتركة:{" "}
            <b className="text-gray-800" dir="ltr">{formatPrice(totalExpenses)}</b>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-right text-sm">
              <thead className="border-b text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">الشريك</th>
                  <th className="pb-2 font-medium">النسبة</th>
                  <th className="pb-2 font-medium">دفع فعلياً</th>
                  <th className="pb-2 font-medium">حصته (المستحقة)</th>
                  <th className="pb-2 font-medium">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium text-gray-800">{s.name}</td>
                    <td className="py-2.5 text-gray-600">{s.share_percent}%</td>
                    <td className="py-2.5 text-gray-800" dir="ltr">{formatPrice(s.paid)}</td>
                    <td className="py-2.5 text-gray-600" dir="ltr">{formatPrice(s.obligation)}</td>
                    <td className="py-2.5" dir="ltr">
                      <span className={s.net >= 0 ? "font-bold text-green-700" : "font-bold text-red-700"}>
                        {s.net >= 0 ? "+" : ""}{formatPrice(s.net)}
                      </span>
                      <span className="mr-2 text-xs text-gray-400">
                        {s.net > 0.009 ? "(له)" : s.net < -0.009 ? "(عليه)" : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            الرصيد الموجب (له) = دائن، والسالب (عليه) = مدين. يُحسب = ما دفعه − حصته من المصاريف، بعد خصم/إضافة التسويات.
          </p>
        </div>

        {/* المصاريف المشتركة */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-bold text-gray-800">المصاريف المشتركة</h3>
          <div className="mb-4">
            <AddPartnerExpense partners={partners} />
          </div>
          {expenses.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد مصاريف بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">التاريخ</th>
                    <th className="pb-2 font-medium">البيان</th>
                    <th className="pb-2 font-medium">من دفع</th>
                    <th className="pb-2 font-medium">المبلغ</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2.5 text-gray-600" dir="ltr">{e.expense_date}</td>
                      <td className="py-2.5 text-gray-800">{e.description}</td>
                      <td className="py-2.5 text-gray-600">{nameOf(e.paid_by)}</td>
                      <td className="py-2.5 font-medium text-gray-800" dir="ltr">{formatPrice(e.amount)}</td>
                      <td className="py-2.5 text-left">
                        <DeleteRowButton table="partner_expenses" id={e.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* التسويات */}
        <div className={card}>
          <h3 className="mb-1 text-lg font-bold text-gray-800">التسويات</h3>
          <p className="mb-3 text-xs text-gray-400">
            سجّل هنا دفعة من شريك لآخر لتصفية المديونية، فيُحدّث الرصيد تلقائياً.
          </p>
          <div className="mb-4">
            <AddPartnerSettlement
              partners={partners}
              suggested={
                debtor && creditor
                  ? { from: debtor.id, to: creditor.id, amount: settleAmount }
                  : undefined
              }
            />
          </div>
          {settlements.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد تسويات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">التاريخ</th>
                    <th className="pb-2 font-medium">من</th>
                    <th className="pb-2 font-medium">إلى</th>
                    <th className="pb-2 font-medium">المبلغ</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2.5 text-gray-600" dir="ltr">{s.settlement_date}</td>
                      <td className="py-2.5 text-gray-800">{nameOf(s.from_partner)}</td>
                      <td className="py-2.5 text-gray-800">{nameOf(s.to_partner)}</td>
                      <td className="py-2.5 font-medium text-gray-800" dir="ltr">{formatPrice(s.amount)}</td>
                      <td className="py-2.5 text-left">
                        <DeleteRowButton table="partner_settlements" id={s.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
