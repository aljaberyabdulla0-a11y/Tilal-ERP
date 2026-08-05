"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Client,
  PIPELINE_STAGES,
  PIPELINE_STAGE_COLORS,
  sinceColor,
  sinceLabel,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";

const todayStr = () => baghdadDate();

// لوحة المبيعات (Kanban) — سحب وإفلات بين المراحل + تحكّم بتاريخ المتابعة
export default function SalesBoard({ initial }: { initial: Client[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<Client[]>(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [editDateId, setEditDateId] = useState<string | null>(null);

  // تحريك عميل إلى مرحلة
  async function moveTo(id: string, stage: string) {
    const current = items.find((c) => c.id === id);
    if (!current || current.stage === stage) return;
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, stage } : c)));
    const { error } = await supabase.from("clients").update({ stage }).eq("id", id);
    if (error) alert("تعذّر النقل: " + error.message);
  }

  // تحديث تاريخ المتابعة
  async function setDate(id: string, date: string) {
    setItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, follow_up_date: date || null } : c))
    );
    setEditDateId(null);
    const { error } = await supabase
      .from("clients")
      .update({ follow_up_date: date || null })
      .eq("id", id);
    if (error) alert("تعذّر حفظ التاريخ: " + error.message);
  }

  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {PIPELINE_STAGES.map((stage) => {
        const cards = items.filter((c) => (c.stage ?? "ليد") === stage);
        return (
          <div
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStage(stage);
            }}
            onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
            onDrop={() => {
              if (dragId) moveTo(dragId, stage);
              setDragId(null);
              setOverStage(null);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-gray-50/70 ${
              overStage === stage ? "ring-2 ring-brand-400" : ""
            }`}
          >
            {/* رأس العمود */}
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  PIPELINE_STAGE_COLORS[stage] ?? "bg-gray-100 text-gray-700"
                }`}
              >
                {stage}
              </span>
              <span className="text-xs font-bold text-gray-400">{cards.length}</span>
            </div>

            {/* البطاقات */}
            <div className="flex-1 space-y-2 p-2" style={{ minHeight: 120 }}>
              {cards.map((c) => {
                const overdue =
                  c.follow_up_date &&
                  c.follow_up_date < todayStr() &&
                  stage !== "بيع" &&
                  stage !== "فشل البيع";
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab rounded-xl border bg-white p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                  >
                    <Link
                      href={`/dashboard/clients/${c.id}`}
                      className="font-bold text-brand-800 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                      {c.phone && <div dir="ltr" className="text-right">{c.phone}</div>}
                      <div>
                        {c.governorate || "—"}
                        {c.area ? ` - ${c.area}` : ""}
                      </div>
                    </div>

                    {/* موظف المبيعات + آخر تواصل */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.sales_employee && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
                          {c.sales_employee}
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-medium ${sinceColor(c.last_contact_at)}`}
                        title="آخر تواصل مسجّل"
                      >
                        ☎ {sinceLabel(c.last_contact_at)}
                      </span>
                    </div>

                    {/* تاريخ المتابعة + زر التحكم */}
                    <div className="mt-2 flex items-center justify-between border-t pt-2">
                      {editDateId === c.id ? (
                        <input
                          type="date"
                          autoFocus
                          dir="ltr"
                          defaultValue={c.follow_up_date ?? ""}
                          onChange={(e) => setDate(c.id, e.target.value)}
                          onBlur={() => setEditDateId(null)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                      ) : (
                        <span
                          className={`text-[11px] ${
                            overdue ? "font-bold text-red-600" : "text-gray-500"
                          }`}
                          dir="ltr"
                        >
                          {c.follow_up_date
                            ? `📅 ${c.follow_up_date}${overdue ? " (متأخر)" : ""}`
                            : "بدون تاريخ"}
                        </span>
                      )}
                      <button
                        onClick={() => setEditDateId(editDateId === c.id ? null : c.id)}
                        className="material-symbols-outlined text-lg text-gray-400 hover:text-brand-600"
                        title="تعديل تاريخ المتابعة"
                      >
                        edit_calendar
                      </button>
                    </div>
                  </div>
                );
              })}

              {cards.length === 0 && (
                <p className="py-6 text-center text-xs text-gray-300">أفلت هنا</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
