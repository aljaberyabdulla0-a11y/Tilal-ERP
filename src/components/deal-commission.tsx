"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Reservation, SaleCommission, formatPrice } from "@/lib/types";

// ============================================================
// المقدمة وعمولة الصفقة — مسار المال الحقيقي في نموذج الوساطة.
//
// تلال وسيط لا بائع: ثمن الوحدة لا يمرّ بصندوقها، والعربون يذهب
// للمطوّر. فالمال الوحيد الذي يخصّ دفاتر تلال هو **عمولتها**،
// ونقطة استحقاقها الوحيدة هي **تأكيد المقدمة** (sql/056).
//
// خطوتان لا ثالثة لهما:
//   ١) تأكيد المقدمة  → تُستحقّ عمولة تلال (مدين 1250 / دائن 4200)
//                        وعمولة الموظف   (مدين 5500 / دائن 2300)
//   ٢) تحصيلها من المطوّر → مدين 1100 / دائن 1250
//      وعندها فقط تدخل عمولة الموظف كشف راتبه.
//
// كلتاهما بدالّة في القاعدة تفحص الصلاحية وتكتب القيد — لا حساب
// هنا ولا كتابة في الدفاتر من المتصفّح.
// ============================================================
export default function DealCommission({
  reservation,
  saleCommission,
  canManage,
  isAdmin,
}: {
  reservation: Reservation;
  saleCommission: SaleCommission | null;
  canManage: boolean;   // المدير أو مشرف المشروع — يؤكّد المقدمة
  isAdmin: boolean;     // المدير وحده — يسجّل التحصيل
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");

  const r = reservation;
  const sc = saleCommission;
  const confirmed = Boolean(r.down_payment_confirmed_at);
  const collected = Boolean(sc?.collected_at);

  // الصفقة غير المكتملة لا مقدمة لها بعد
  if (r.status !== "بيع مكتمل") return null;

  async function confirmDownPayment() {
    const n = Number(amount);
    if (!n || n <= 0) {
      setErr("اكتب مبلغ المقدمة.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("confirm_down_payment", {
      p_res: r.id,
      p_amount: n,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setAsking(false);
    setAmount("");
    router.refresh();
  }

  async function collect() {
    if (
      !window.confirm(
        "تسجيل تحصيل عمولة الشركة من المطوّر؟ سيدخل المبلغ الصندوق، وتصير عمولة الموظف جاهزة لكشف راتبه."
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("collect_company_commission", {
      p_res: r.id,
      p_date: null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // خطوة واحدة في الشريط الزمني
  function Step({
    n,
    title,
    done,
    children,
  }: {
    n: number;
    title: string;
    done: boolean;
    children: React.ReactNode;
  }) {
    return (
      <div className="flex gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800">{title}</p>
          <div className="mt-1 text-sm text-gray-600">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-1.5 font-semibold text-gray-800">
        <span className="material-symbols-outlined text-[20px] text-brand-600">
          percent
        </span>
        المقدمة وعمولة الصفقة
      </h3>
      <p className="mb-4 text-xs text-gray-400">
        ثمن الوحدة لا يمرّ بصندوق تلال، والعربون يذهب للمطوّر. الذي يخصّ
        دفاترنا هو <b>عمولتنا</b> — وتُستحقّ عند تأكيد المقدمة.
      </p>

      {!sc && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          لا سجلّ عمولة لهذه الصفقة — تحقّق من أن للمشروع نسبة عمولة محدَّدة،
          ومن أن للوحدة سعراً.
        </p>
      )}

      <div className="space-y-4">
        {/* العربون — معلومة لا قيد */}
        {r.amount !== null && (
          <div className="flex items-baseline justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-xs text-gray-500">
              العربون <span className="text-gray-400">(متابعة فقط — بلا قيد)</span>
            </span>
            <b className="text-sm text-gray-700" dir="ltr">
              {formatPrice(r.amount)}
            </b>
          </div>
        )}

        <Step n={1} title="تأكيد المقدمة" done={confirmed}>
          {confirmed ? (
            <>
              <b dir="ltr" className="text-gray-800">
                {formatPrice(r.down_payment_amount)}
              </b>{" "}
              <span className="text-xs text-gray-400" dir="ltr">
                {r.down_payment_confirmed_at?.slice(0, 10)}
              </span>
              {sc && (
                <p className="mt-1 text-xs text-gray-500">
                  استُحقّت عمولة الشركة{" "}
                  <b dir="ltr">{formatPrice(sc.company_amount)}</b> بنسبة{" "}
                  {sc.company_rate}٪
                  {sc.employee_amount > 0 && (
                    <>
                      {" "}
                      · وعمولة الموظف{" "}
                      <b dir="ltr">{formatPrice(sc.employee_amount)}</b>
                    </>
                  )}
                </p>
              )}
            </>
          ) : canManage ? (
            asking ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min={0}
                  dir="ltr"
                  autoFocus
                  placeholder="مبلغ المقدمة"
                  className={input + " w-40 text-start"}
                />
                <button
                  onClick={confirmDownPayment}
                  disabled={busy}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? "جارٍ…" : "تأكيد"}
                </button>
                <button
                  onClick={() => setAsking(false)}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAsking(true);
                  setErr(null);
                }}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                تأكيد المقدمة
              </button>
            )
          ) : (
            <span className="text-xs text-gray-400">بانتظار الإدارة.</span>
          )}
        </Step>

        <Step n={2} title="تحصيل عمولتنا من المطوّر" done={collected}>
          {collected ? (
            <>
              <b dir="ltr" className="text-green-700">
                {formatPrice(sc?.company_amount ?? null)}
              </b>{" "}
              دخلت الصندوق{" "}
              <span className="text-xs text-gray-400" dir="ltr">
                {sc?.collected_at}
              </span>
              <p className="mt-1 text-xs text-green-700">
                ✓ وعمولة الموظف صارت جاهزة لكشف راتبه.
              </p>
            </>
          ) : !confirmed ? (
            <span className="text-xs text-gray-400">
              أكّد المقدمة أولاً — العمولة لم تُستحقّ بعد.
            </span>
          ) : isAdmin ? (
            <button
              onClick={collect}
              disabled={busy}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              تسجيل التحصيل
            </button>
          ) : (
            <span className="text-xs text-gray-400">للمدير.</span>
          )}
        </Step>
      </div>

      {err && (
        <p className="mt-4 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
      )}
    </div>
  );
}
