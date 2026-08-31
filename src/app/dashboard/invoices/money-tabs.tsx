"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Invoice,
  RESERVATION_STATUS_COLORS,
  Reservation,
  formatPrice,
  invoiceStatus,
  reservationExpired,
} from "@/lib/types";

// ============================================================
// المال الداخل قسمان لا قائمة واحدة.
//
// **مبالغ الحجز** عربونٌ مقبوض على وحدة لم تُبَع بعد — التزامٌ
// تردّه الشركة إن أُلغي الحجز، لا إيراد. و**الفواتير** ثمنٌ
// مستحقّ على بيع تمّ.
//
// خلطهما في جدول واحد كان سيجعل «المتبقي» بلا معنى: العربون لا
// متبقّي له، والفاتورة لها. ولذلك فُصلا هنا كما فُصلا في الدفاتر
// (حساب 2400 للعربونات، و4100 للإيراد).
// ============================================================
export default function MoneyTabs({
  invoices,
  deposits,
  isAdmin,
}: {
  invoices: Invoice[];
  deposits: Reservation[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<"invoices" | "deposits">("invoices");

  const invTotals = useMemo(() => {
    let total = 0;
    let paid = 0;
    for (const i of invoices) {
      total += Number(i.total_amount);
      paid += (i.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
    }
    return { total, paid, remaining: total - paid };
  }, [invoices]);

  const depTotals = useMemo(() => {
    let held = 0;      // حجوزات قائمة — مال في الصندوق مقابل التزام
    let converted = 0; // تحوّل إلى ثمن بيع
    for (const r of deposits) {
      const a = Number(r.amount ?? 0);
      if (r.status === "حجز") held += a;
      else if (r.status === "بيع مكتمل") converted += a;
    }
    return { held, converted };
  }, [deposits]);

  const tabBtn = (key: "invoices" | "deposits", label: string, n: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={
        tab === key
          ? "flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          : "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
      }
    >
      {label}
      <span
        className={
          tab === key
            ? "rounded-full bg-white/20 px-2 py-0.5 text-[11px]"
            : "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500"
        }
      >
        {n}
      </span>
    </button>
  );

  const tile = "glass-card border-s-4 p-4";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {tabBtn("invoices", "الفواتير", invoices.length)}
        {tabBtn("deposits", "مبالغ الحجز", deposits.length)}
      </div>

      {tab === "invoices" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className={tile + " border-s-brand-500"}>
              <span className="text-sm text-gray-500">إجمالي المفوتر</span>
              <p className="mt-1 text-xl font-bold text-gray-800" dir="ltr">
                {formatPrice(invTotals.total)}
              </p>
            </div>
            <div className={tile + " border-s-green-500"}>
              <span className="text-sm text-gray-500">المحصّل</span>
              <p className="mt-1 text-xl font-bold text-green-700" dir="ltr">
                {formatPrice(invTotals.paid)}
              </p>
            </div>
            <div
              className={
                tile +
                (invTotals.remaining > 0 ? " border-s-amber-500" : " border-s-gray-300")
              }
            >
              <span className="text-sm text-gray-500">المتبقي</span>
              <p
                className={`mt-1 text-xl font-bold ${
                  invTotals.remaining > 0 ? "text-amber-700" : "text-gray-500"
                }`}
                dir="ltr"
              >
                {formatPrice(invTotals.remaining)}
              </p>
            </div>
          </div>

          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
              لا توجد فواتير بعد. تُصدَر آلياً عند إتمام بيع وحدة، أو أضفها يدوياً.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-start text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">رقم الفاتورة</th>
                    <th className="px-4 py-3 text-start font-medium">العميل</th>
                    <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-start font-medium">الإجمالي</th>
                    <th className="px-4 py-3 text-start font-medium">المدفوع</th>
                    <th className="px-4 py-3 text-start font-medium">المتبقي</th>
                    <th className="px-4 py-3 text-start font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const paid = (inv.payments ?? []).reduce(
                      (s, p) => s + Number(p.amount),
                      0,
                    );
                    const remaining = Number(inv.total_amount) - paid;
                    const st = invoiceStatus(inv.total_amount, paid);
                    return (
                      <tr
                        key={inv.id}
                        className="border-b last:border-0 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/dashboard/invoices/${inv.id}`}
                            className="text-brand-700 hover:underline"
                            dir="ltr"
                          >
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-800">
                          {inv.clients?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600" dir="ltr">
                          {inv.issue_date}
                        </td>
                        <td className="px-4 py-3 text-gray-800" dir="ltr">
                          {formatPrice(inv.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-green-700" dir="ltr">
                          {formatPrice(paid)}
                        </td>
                        <td
                          className={
                            remaining > 0
                              ? "px-4 py-3 font-semibold text-amber-700"
                              : "px-4 py-3 text-gray-400"
                          }
                          dir="ltr"
                        >
                          {formatPrice(remaining)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}
                          >
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className={tile + " border-s-amber-500"}>
              <span className="text-sm text-gray-500">عربونات قائمة</span>
              <p className="mt-1 text-xl font-bold text-amber-700" dir="ltr">
                {formatPrice(depTotals.held)}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">
                مالٌ في الصندوق مقابل التزام — يُردّ إن أُلغي الحجز.
              </p>
            </div>
            <div className={tile + " border-s-green-500"}>
              <span className="text-sm text-gray-500">تحوّل إلى ثمن بيع</span>
              <p className="mt-1 text-xl font-bold text-green-700" dir="ltr">
                {formatPrice(depTotals.converted)}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">
                احتُسب دفعةً على فاتورة الوحدة.
              </p>
            </div>
          </div>

          {deposits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
              لا مبالغ حجز مسجّلة. تظهر هنا فور حجز وحدة بمبلغ.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
              <table className="w-full min-w-[860px] text-start text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">العميل</th>
                    <th className="px-4 py-3 text-start font-medium">الوحدة</th>
                    <th className="px-4 py-3 text-start font-medium">المبلغ</th>
                    <th className="px-4 py-3 text-start font-medium">تاريخ الحجز</th>
                    <th className="px-4 py-3 text-start font-medium">المهلة</th>
                    <th className="px-4 py-3 text-start font-medium">الموظف</th>
                    <th className="px-4 py-3 text-start font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((r) => {
                    const late = reservationExpired(r);
                    return (
                      <tr
                        key={r.id}
                        className={
                          late
                            ? "border-b bg-red-50/50 last:border-0"
                            : "border-b last:border-0 hover:bg-gray-50"
                        }
                      >
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {r.clients?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <Link
                            href={`/dashboard/units/${r.unit_id}`}
                            className="text-brand-700 hover:underline"
                          >
                            {r.units?.unit_code ?? "وحدة"}
                          </Link>
                          <span className="block text-[11px] text-gray-400">
                            {r.units?.project ?? ""}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 font-semibold text-gray-800"
                          dir="ltr"
                        >
                          {formatPrice(r.amount)}
                        </td>
                        <td className="px-4 py-3 text-gray-600" dir="ltr">
                          {r.reservation_date ?? "—"}
                        </td>
                        <td
                          className={
                            late
                              ? "px-4 py-3 font-semibold text-red-700"
                              : "px-4 py-3 text-gray-600"
                          }
                          dir="ltr"
                        >
                          {r.expiry_date ?? "—"}
                          {late && (
                            <span className="ms-1 text-[11px]">(انتهت)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {r.agent_name ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              RESERVATION_STATUS_COLORS[r.status] ??
                              "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
            <b className="text-gray-800">لماذا ليست فاتورة؟</b> العربون مقبوضٌ
            على وحدة لم تُبَع بعد، فهو التزامٌ على الشركة لا إيراداً — يُقيَّد
            على حساب «عربونات محجوزة». وحين يتمّ البيع تُصدر فاتورة بثمن الوحدة
            ويُحتسب العربون دفعةً عليها آلياً، فلا يُطالَب العميل بما دفعه.
            {isAdmin && " أُلغي الحجز؟ يُعكس القيد ويُردّ المبلغ."}
          </p>
        </>
      )}
    </div>
  );
}
