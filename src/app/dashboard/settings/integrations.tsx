"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings } from "@/lib/types";

// ============================================================
// ضوابط التكامل بين وحدات النظام.
//
// الأتمتة التي لا تُطفأ تصير عبئاً حين يحتاج المدير إدخالاً
// استثنائياً بيده — فكل رابط له مفتاح، ونسبة العمولة رقم واحد
// يحكم كل الصفقات ما لم يكن للموظف نسبته الخاصة.
// ============================================================
export default function Integrations({
  settings,
}: {
  settings: CompanySettings | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [rate, setRate] = useState(settings?.commission_rate?.toString() ?? "0");
  const [autoInvoice, setAutoInvoice] = useState(
    settings?.auto_invoice_on_sale ?? true,
  );
  const [autoCommission, setAutoCommission] = useState(
    settings?.auto_commission_on_paid ?? true,
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setMsg("النسبة رقم بين صفر ومئة.");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({
        commission_rate: n,
        auto_invoice_on_sale: autoInvoice,
        auto_commission_on_paid: autoCommission,
      })
      .eq("id", 1);
    setSaving(false);

    if (error) setMsg("تعذّر الحفظ: " + error.message);
    else {
      setMsg("تم الحفظ ✓");
      router.refresh();
    }
  }

  const Toggle = ({
    on,
    set,
    title,
    body,
  }: {
    on: boolean;
    set: (v: boolean) => void;
    title: string;
    body: string;
  }) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4 transition hover:bg-gray-50">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => set(e.target.checked)}
        className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-800">{title}</span>
        <span className="block text-xs text-gray-500">{body}</span>
      </span>
    </label>
  );

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-bold text-gray-800">
        التكامل بين الوحدات
      </h2>
      <p className="mb-5 text-sm text-gray-500">
        ما يحدث في وحدة يظهر في الأخرى بلا إدخال ثانٍ. من هنا تتحكّم بما
        يُحتسب تلقائياً.
      </p>

      <div className="mb-5 max-w-xs">
        <label className="mb-1 block text-xs font-medium text-gray-600">
          نسبة عمولة الموظف من قيمة الفاتورة (%)
        </label>
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          type="number"
          min={0}
          max={100}
          step="0.1"
          dir="ltr"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-[11px] text-gray-500">
          صفر = لا عمولة تلقائية. ويمكن إعطاء موظف نسبةً تخصّه من صفحته، فتسبق
          نسبة الشركة.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Toggle
          on={autoInvoice}
          set={setAutoInvoice}
          title="البيع يُنشئ فاتورة للعميل"
          body="عند إتمام بيع وحدة تُصدر فاتورة بسعرها كاملاً. العربون يُسجَّل دفعةً عليها لا خصماً منها."
        />
        <Toggle
          on={autoCommission}
          set={setAutoCommission}
          title="سداد الفاتورة يستحقّ العمولة"
          body="عند اكتمال السداد تُسجَّل عمولة الموظف المسؤول وتدخل كشف راتبه القادم — لا عند إصدار الفاتورة، فالعمولة على مقبوض لا موعود."
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        {msg && (
          <span
            className={`text-sm ${
              msg.includes("✓") ? "text-green-600" : "text-red-600"
            }`}
          >
            {msg}
          </span>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-gray-50 p-4 text-xs text-gray-600">
        <b className="text-gray-800">روابط تعمل دائماً بلا مفتاح:</b> البيع يُغلق
        ملفّ العميل بمرحلة «بيع»، والدفعة تُعلم صاحب الصفقة، وشراء لوازم المكتب
        ودفعات الشركات الوسيطة تُرحَّل مصروفاً في المحاسبة، والحجز الذي انتهت
        مهلته يُنبَّه عليه صاحبه صباح كل يوم.
      </div>
    </section>
  );
}
