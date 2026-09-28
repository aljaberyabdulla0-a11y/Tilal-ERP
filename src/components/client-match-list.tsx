import Link from "next/link";
import type { ReactNode } from "react";
import type { ClientMatch } from "@/lib/crm";

// ============================================================
// قائمة «هذا الشخص موجود» — تُعرض في نموذج الإضافة وفي صفحة العميل.
//
// بلا حالة ولا استدعاء: الأفعال تأتي من الأب (actions)، لأن ما
// يُفعل يختلف — في النموذج «أضف إلى هذه البطاقة»، وفي الصفحة
// «قارن وادمج».
//
// بطاقةٌ لا تراها تُعرض باسمها ومالكها بلا رابط ولا رقم (sql/104):
// يكفي أن تعرف أنها موجودة وعند من.
// ============================================================

const MATCH_STYLE: Record<string, string> = {
  مؤكّد: "bg-red-100 text-red-800",
  محتمل: "bg-amber-100 text-amber-800",
  مرشّح: "bg-gray-100 text-gray-600",
};

const MATCH_LABEL: Record<string, string> = {
  هاتف: "الرقم نفسه",
  "هاتف بديل": "رقم بديل مطابق",
  اسم: "اسم مشابه",
};

export default function ClientMatchList({
  matches,
  actions,
}: {
  matches: ClientMatch[];
  actions?: (m: ClientMatch) => ReactNode;
}) {
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {matches.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MATCH_STYLE[m.match_type] ?? MATCH_STYLE["مرشّح"]}`}>
            {MATCH_LABEL[m.match_on] ?? m.match_on}
          </span>
          <div className="min-w-0 flex-1">
            {m.can_view ? (
              <Link href={`/dashboard/clients/${m.id}`} target="_blank" className="font-medium text-brand-700 hover:underline">
                {m.name}
              </Link>
            ) : (
              <span className="font-medium text-gray-800">{m.name}</span>
            )}
            <p className="text-xs text-gray-500">
              {m.phone && (
                <span dir="ltr" className="me-2">
                  {m.phone}
                </span>
              )}
              {m.stage ?? "ليد"}
              {m.owner_name && <> · عند {m.owner_name}</>}
              {" · "}منذ {m.created_at.slice(0, 10)}
              {!m.can_view && <> · ليست ضمن عملائك</>}
            </p>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions(m)}</div>}
        </li>
      ))}
    </ul>
  );
}
