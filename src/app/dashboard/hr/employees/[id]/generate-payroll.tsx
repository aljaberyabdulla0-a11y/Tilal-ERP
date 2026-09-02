"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// بناء كشف الراتب.
//
// كان هذا المكوّن يحسب الراتب بنفسه: يجمع الأساسي والبدلات
// والعمولات ويطرح الاستقطاعات في جافاسكربت ثم يُدخل الصفّ جاهزاً.
// وكان وحده في النظام يفعل ذلك — بقيّته تضع الحساب في القاعدة.
//
// صار ينادي `build_payroll` ولا يحسب شيئاً (sql/051). الفرق ليس
// شكلياً: الدالة تبني **بنوداً** لا أربعة أرقام، وترفض كشفاً
// ثانياً لنفس الشهر، وترفض كشفاً لمن انتهت خدمته، وتضمّ العمولات
// والاستقطاعات المعلّقة وتَسِمها فلا تتكرّر في الشهر القادم.
//
// وإعادة الضغط على الزرّ **تُعيد الحساب** ولا تُنشئ كشفاً ثانياً —
// ما دام الكشف مسوّدة.
// ============================================================
export default function GeneratePayroll({
  employeeId,
  draftPeriods,
}: {
  employeeId: string;
  // الشهور التي للموظف فيها مسوّدة — يتغيّر بها نصّ الزرّ حتى لا
  // يخشى المستخدم أنه يُنشئ كشفاً مكرّراً.
  //
  // ⚠️ قائمةٌ لا دالّة عمداً: ما يُمرَّر من صفحة الخادم إلى مكوّن
  //    المتصفّح يجب أن يكون **بيانات** تُنقل عبر الشبكة. تمرير
  //    دالّة هنا كان يُسقط الصفحة كلها عند التشغيل، ولا يكشفه
  //    البناء لأنه خطأ نقلٍ لا خطأ أنواع.
  draftPeriods: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  // الشهر الحالي بتوقيت بغداد لا بتوقيت جهاز المستخدم
  const thisMonth = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" })
    .slice(0, 7);

  const [period, setPeriod] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rebuilding = draftPeriods.includes(period);

  async function build() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("build_payroll", {
      p_employee: employeeId,
      p_period: period,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">الشهر</label>
          <input
            type="month"
            dir="ltr"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={cls + " text-start"}
          />
        </div>

        <button
          onClick={build}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">
            {rebuilding ? "refresh" : "receipt_long"}
          </span>
          {busy
            ? "جارٍ الحساب…"
            : rebuilding
            ? "إعادة حساب المسوّدة"
            : "بناء مسوّدة الكشف"}
        </button>
      </div>

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
      )}

      <p className="mt-2 text-xs text-gray-400">
        يُبنى الكشف <b>مسوّدة</b>: الأساسي من ملفّ الموظف، وكل عمولة واستقطاع
        لم يدخل كشفاً بعد — بنداً بنداً. ولا يدخل دفاتر الشركة حتى تعتمده.
      </p>
    </div>
  );
}
