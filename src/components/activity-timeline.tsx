"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_OUTCOME_COLORS,
  ClientActivity,
  activityMeta,
} from "@/lib/types";
import { baghdadDateLabel, baghdadTime } from "@/lib/time";

// ============================================================
// الخط الزمني لسجلّ التواصل — الأحدث أولاً.
// يُستخدم في صفحة العميل (بلا اسم عميل) وفي السجلّ العام (مع اسمه).
// ============================================================
export default function ActivityTimeline({
  activities,
  showClient = false,
  canManage = false,
}: {
  activities: ClientActivity[];
  showClient?: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(a: ClientActivity) {
    if (!confirm("حذف هذا التواصل من السجلّ؟")) return;
    setBusyId(a.id);
    const { error } = await supabase
      .from("client_activities")
      .delete()
      .eq("id", a.id);
    setBusyId(null);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  if (activities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
        لا يوجد تواصل مسجّل بعد.
      </div>
    );
  }

  return (
    <ol className="relative space-y-3">
      {activities.map((a, i) => {
        const meta = activityMeta(a.activity_type);
        const isSystem = a.activity_type === "تغيير مرحلة";

        return (
          <li key={a.id} className="relative flex gap-3">
            {/* الخط الرأسي الواصل */}
            {i < activities.length - 1 && (
              <span className="absolute right-[19px] top-11 h-[calc(100%-1rem)] w-px bg-gray-200" />
            )}

            {/* الأيقونة */}
            <span
              className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.color}`}
            >
              <span className="material-symbols-outlined text-[20px]">{meta.icon}</span>
            </span>

            {/* البطاقة */}
            <div
              className={`min-w-0 flex-1 rounded-2xl border p-4 ${
                isSystem ? "border-gray-100 bg-gray-50/70" : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-gray-800">{a.activity_type}</span>

                {a.direction && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {a.direction === "صادر" ? "منّا للعميل" : "من العميل"}
                  </span>
                )}

                {a.outcome && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      ACTIVITY_OUTCOME_COLORS[a.outcome] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {a.outcome}
                  </span>
                )}

                {a.duration_min != null && (
                  <span className="text-[11px] text-gray-500">{a.duration_min} دقيقة</span>
                )}

                {showClient && a.clients && (
                  <Link
                    href={`/dashboard/clients/${a.client_id}`}
                    className="text-[11px] font-medium text-brand-700 hover:underline"
                  >
                    {a.clients.name}
                  </Link>
                )}

                <span className="mr-auto whitespace-nowrap text-[11px] text-gray-400" dir="rtl">
                  {baghdadDateLabel(a.occurred_at)} ·{" "}
                  <span dir="ltr">{baghdadTime(a.occurred_at)}</span>
                </span>
              </div>

              {a.summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{a.summary}</p>
              )}

              {(a.next_action || a.next_action_date) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span className="material-symbols-outlined text-[16px]">event_upcoming</span>
                  <span>
                    {a.next_action || "متابعة"}
                    {a.next_action_date && (
                      <b className="mr-1" dir="ltr">
                        {a.next_action_date}
                      </b>
                    )}
                  </span>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                <span>{a.actor_name || "—"}</span>
                {canManage && !isSystem && (
                  <button
                    onClick={() => remove(a)}
                    disabled={busyId === a.id}
                    className="mr-auto text-red-500 hover:underline disabled:opacity-50"
                  >
                    حذف
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
