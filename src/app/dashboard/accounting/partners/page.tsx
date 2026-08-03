import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getPartnersState } from "@/lib/money";
import { formatPrice } from "@/lib/types";
import AccTabs from "../acc-tabs";
import AddPartnerSettlement from "./add-partner-settlement";
import DeleteRowButton from "./delete-row-button";

// ============================================================
// الشركاء والتصفية — يجيب على سؤال: مين دفع أكثر، ومين مدين لمين.
// كل الأرقام تُشتق من الحركات المالية المسجّلة، فلا إدخال مزدوج.
// ============================================================
export default async function PartnersPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const { partners, moves, settlements, positions, pool, creditor, debtor, settleAmount } =
    await getPartnersState();

  const nameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? "—";
  const card = "glass-card p-6";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">الشركاء والتصفية</h1>
        <Link
          href="/dashboard/accounting/moves/new?dir=صرف"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + سجّل مصروف دفعه شريك
        </Link>
      </header>

      <AccTabs active="partners" />

      <section className="space-y-6 p-6">
        {/* خلاصة التصفية */}
        <div
          className={`rounded-2xl border p-6 shadow-sm ${
            debtor && creditor ? "bg-amber-50" : "bg-green-50"
          }`}
        >
          <h3 className="mb-1 text-lg font-bold text-gray-800">خلاصة التصفية</h3>
          {debtor && creditor ? (
            <>
              <p className="text-gray-800">
                <b className="text-amber-700">{debtor.name}</b> مدين لـ{" "}
                <b className="text-green-700">{creditor.name}</b> بمبلغ{" "}
                <b className="text-xl" dir="ltr">
                  {formatPrice(settleAmount)}
                </b>{" "}
                دينار.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                إذا دفع {debtor.name} هذا المبلغ إلى {creditor.name}، تتساوى حصصكم بالضبط.
                سجّله في «التسويات» بالأسفل.
              </p>
            </>
          ) : (
            <p className="text-green-700">✓ الحسابات متوازنة — لا مديونية بين الشركاء.</p>
          )}
        </div>

        {/* أوضاع الشركاء */}
        <div className={card}>
          <h3 className="mb-1 text-lg font-bold text-gray-800">أوضاع الشركاء</h3>
          <p className="mb-4 text-sm text-gray-500">
            مجموع ما موّله الشركاء من حساباتهم الخاصة:{" "}
            <b className="text-gray-800" dir="ltr">
              {formatPrice(pool)}
            </b>{" "}
            دينار
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="border-b text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">الشريك</th>
                  <th className="pb-2 font-medium">النسبة</th>
                  <th className="pb-2 font-medium">دفع من جيبه</th>
                  <th className="pb-2 font-medium">أودع بالصندوق</th>
                  <th className="pb-2 font-medium">استرجع</th>
                  <th className="pb-2 font-medium">تسويات</th>
                  <th className="pb-2 font-medium">حصته المستحقة</th>
                  <th className="pb-2 font-medium">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium text-gray-800">{p.name}</td>
                    <td className="py-2.5 text-gray-600">{p.share_percent}%</td>
                    <td className="py-2.5 text-gray-800" dir="ltr">
                      {formatPrice(p.fromPocket)}
                    </td>
                    <td className="py-2.5 text-gray-800" dir="ltr">
                      {formatPrice(p.deposits)}
                    </td>
                    <td className="py-2.5 text-gray-500" dir="ltr">
                      {formatPrice(p.refunds)}
                    </td>
                    <td className="py-2.5 text-gray-500" dir="ltr">
                      {formatPrice(p.settledOut - p.settledIn)}
                    </td>
                    <td className="py-2.5 text-gray-600" dir="ltr">
                      {formatPrice(p.obligation)}
                    </td>
                    <td className="py-2.5" dir="ltr">
                      <span
                        className={
                          p.net >= 0 ? "font-bold text-green-700" : "font-bold text-red-700"
                        }
                      >
                        {p.net >= 0 ? "+" : ""}
                        {formatPrice(p.net)}
                      </span>
                      <span className="mr-2 text-xs text-gray-400">
                        {p.net > 0.009 ? "(له)" : p.net < -0.009 ? "(عليه)" : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
            <b className="text-gray-700">كيف يُحسب الرصيد؟</b> ما ساهم به الشريك (ما دفعه من
            جيبه + ما أودعه − ما استرجعه ± التسويات) ناقص حصته المستحقة (نسبته من مجموع تمويل
            الشركاء). الموجب يعني «له عند الشركة» (دائن)، والسالب «عليه» (مدين). المصاريف التي
            تدفعها الشركة من صندوقها لا تؤثر على هذه الحسبة لأنها من مال مشترك أصلاً.
          </div>
        </div>

        {/* حركات الشركاء */}
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">حركات الشركاء</h3>
            <Link
              href="/dashboard/accounting/moves"
              className="text-sm text-brand-700 hover:underline"
            >
              كل الحركات ←
            </Link>
          </div>
          {moves.length === 0 ? (
            <p className="text-sm text-gray-400">
              لا توجد حركات مرتبطة بالشركاء بعد. سجّل مصروفاً واختر اسم الشريك الذي دفعه من
              جيبه.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">التاريخ</th>
                    <th className="pb-2 font-medium">البيان</th>
                    <th className="pb-2 font-medium">النوع</th>
                    <th className="pb-2 font-medium">الشريك</th>
                    <th className="pb-2 font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => {
                    const kind =
                      m.account_code === "2500"
                        ? m.direction === "قبض"
                          ? "إيداع في الصندوق"
                          : "استرجاع من الشركة"
                        : "دفع من جيبه";
                    return (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2.5 text-gray-600" dir="ltr">
                          {m.move_date}
                        </td>
                        <td className="py-2.5 text-gray-800">{m.description}</td>
                        <td className="py-2.5 text-gray-500">{kind}</td>
                        <td className="py-2.5 text-gray-800">
                          {nameOf(m.partner_id ?? "")}
                        </td>
                        <td className="py-2.5 font-medium text-gray-800" dir="ltr">
                          {formatPrice(Number(m.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* التسويات */}
        <div className={card}>
          <h3 className="mb-1 text-lg font-bold text-gray-800">التسويات</h3>
          <p className="mb-3 text-xs text-gray-400">
            دفعة شخصية من شريك لآخر لتصفية المديونية (خارج صندوق الشركة). النظام يحدّث الرصيد
            فوراً.
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
                      <td className="py-2.5 text-gray-600" dir="ltr">
                        {s.settlement_date}
                      </td>
                      <td className="py-2.5 text-gray-800">{nameOf(s.from_partner)}</td>
                      <td className="py-2.5 text-gray-800">{nameOf(s.to_partner)}</td>
                      <td className="py-2.5 font-medium text-gray-800" dir="ltr">
                        {formatPrice(s.amount)}
                      </td>
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
