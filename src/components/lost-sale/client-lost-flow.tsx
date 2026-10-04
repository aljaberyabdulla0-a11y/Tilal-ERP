"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { lostDict, money, type Lang } from "@/lib/lost-sales-i18n";
import LostSaleDialog from "./lost-sale-dialog";

// ============================================================
// «فشل البيع» من بطاقة العميل (القائمة، الملف، لوحة الكانبان).
//
// الخسارة تُسجَّل على الفرصة لا على الشخص (072/140). فحين يختار
// الموظف «فشل البيع» للعميل نسأل: أيّ صفقة خُسرت؟
//   • فرصة مفتوحة واحدة  → نموذج التحليل مباشرة، والبطاقة تتبعها بالمرآة
//   • أكثر من فرصة       → يختار الصفقة أولاً
//   • لا فرصة مفتوحة     → onNoOpportunity: تغيير مرحلة البطاقة كما كان
// ============================================================
type OpenOpp = { id: string; project_name: string | null; stage_name: string; expected_value: number | null };

export default function ClientLostFlow({
  clientId,
  onClose,
  onDone,
  onNoOpportunity,
}: {
  clientId: string;
  onClose: () => void;
  onDone: () => void;
  onNoOpportunity: () => void;
}) {
  const supabase = createClient();
  const { locale, dir, v: tv } = useI18n();
  const lang = locale as Lang;
  const t = lostDict(lang);
  const [opps, setOpps] = useState<OpenOpp[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("v_crm_opportunities")
      .select("id, project_name, stage_name, expected_value")
      .eq("client_id", clientId)
      .eq("stage_type", "open")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as OpenOpp[];
        if (list.length === 0) {
          onNoOpportunity();
          return;
        }
        if (list.length === 1) setChosen(list[0].id);
        setOpps(list);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (chosen) {
    return <LostSaleDialog opportunityId={chosen} onClose={onClose} onDone={onDone} />;
  }
  if (!opps) return null;

  return (
    <div dir={dir} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 text-start shadow-xl">
        <h2 className="text-lg font-bold text-red-800">{t.dialogTitle}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {lang === "en" ? "This customer has several open opportunities — which one was lost?" : "للعميل أكثر من فرصة مفتوحة — أيّها خُسرت؟"}
        </p>
        <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {opps.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setChosen(o.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-red-50">
                <span className="font-medium text-gray-800">{o.project_name ?? t.noProject}</span>
                <span className="text-xs text-gray-500">{tv(o.stage_name)} · {money(o.expected_value, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
