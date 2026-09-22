"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Client,
  PAYMENT_METHOD_COLORS,
  sinceColor,
  sinceLabel,
  type SilenceThresholds,
} from "@/lib/types";
import type { EmployeeLite } from "@/lib/crm";
import { TEMPERATURE_STYLE } from "@/lib/crm-style";
import type { StageLite } from "@/lib/crm-config";
import DeleteClientButton from "./delete-client-button";
import StageSelect from "@/components/stage-select";
import BulkActions from "./bulk-actions";

// ============================================================
// جدول العملاء مع الاختيار الجماعي (§47).
//
// صار مكوّن عميل لأجل الاختيار وحده — والعرض كما كان حرفياً.
//
// «اختر الكل» يختار **الصفحة المعروضة** لا كل ما في القاعدة. وهذا
// مقصود: مُرشِّحٌ في العنوان قد يُخفي ألفاً، و«الكل» التي تعني ما لا
// يُرى هي التي تُسنِد ثمانمئة ليد بالخطأ.
// ============================================================
export default function ClientsTable({
  clients,
  admin,
  canWrite,
  canAssign,
  stages,
  colors,
  silence,
  employees,
}: {
  clients: Client[];
  admin: boolean;
  canWrite: boolean;
  canAssign: boolean;
  stages: StageLite[];
  colors: Record<string, string>;
  silence: SilenceThresholds;
  employees: EmployeeLite[];
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const allOnPage = clients.map((c) => c.id);
  const allChecked = selected.length > 0 && selected.length === allOnPage.length;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected(allChecked ? [] : allOnPage);

  return (
    <>
      {canWrite && (
        <BulkActions
          selected={selected}
          onDone={() => setSelected([])}
          employees={employees}
          stages={stages}
          canAssign={canAssign}
        />
      )}

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full min-w-[1080px] text-start text-sm">
          <thead className="border-b bg-gray-50 text-gray-600">
            <tr>
              {canWrite && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="اختر كل الصفوف المعروضة"
                    title="يختار المعروض في هذه الصفحة فقط"
                  />
                </th>
              )}
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">الهاتف</th>
              <th className="px-4 py-3 font-medium">المحافظة</th>
              <th className="px-4 py-3 font-medium">المنطقة</th>
              <th className="px-4 py-3 font-medium">الغرض</th>
              <th className="px-4 py-3 font-medium">طريقة الدفع</th>
              <th className="px-4 py-3 font-medium">المصدر</th>
              <th className="px-4 py-3 font-medium">موظف المبيعات</th>
              <th className="px-4 py-3 font-medium">آخر تواصل</th>
              <th className="px-4 py-3 font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const picked = selected.includes(c.id);
              return (
                <tr
                  key={c.id}
                  className={`border-b last:border-0 ${picked ? "bg-brand-50" : "hover:bg-gray-50"}`}
                >
                  {canWrite && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggle(c.id)}
                        aria-label={`اختيار ${c.name}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/clients/${c.id}`} className="text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <StageSelect clientId={c.id} stage={c.stage} stages={stages} />
                    ) : (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${colors[c.stage ?? "ليد"] ?? "bg-gray-100 text-gray-700"}`}>
                        {c.stage ?? "ليد"}
                      </span>
                    )}
                    {c.lead_temperature && (
                      <span className={`ms-1 rounded px-1.5 py-0.5 text-[11px] ${TEMPERATURE_STYLE[c.lead_temperature] ?? ""}`}>
                        {c.lead_temperature}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {c.phone || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.governorate || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.area || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.purchase_purpose || "—"}</td>
                  <td className="px-4 py-3">
                    {c.payment_method ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          PAYMENT_METHOD_COLORS[c.payment_method] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {c.payment_method}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.source || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.sales_employee || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${sinceColor(c.last_contact_at, silence)}`}>
                      {sinceLabel(c.last_contact_at)}
                    </span>
                    {(c.contact_count ?? 0) > 0 && (
                      <span className="block text-xs text-gray-400">{c.contact_count} تواصل</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`/dashboard/clients/${c.id}`} className="me-3 text-sm text-brand-700 hover:underline">
                      عرض
                    </Link>
                    {admin && (
                      <>
                        <Link
                          href={`/dashboard/clients/${c.id}/edit`}
                          className="me-3 text-sm text-brand-700 hover:underline"
                        >
                          تعديل
                        </Link>
                        <DeleteClientButton id={c.id} name={c.name} />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
