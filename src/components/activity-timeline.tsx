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
import ActivityFields from "@/components/activity-fields";
import {
  ActivityFormState,
  activityFormFrom,
  buildActivityPayload,
} from "@/lib/activity-form";

// ============================================================
// الخط الزمني لسجلّ التواصل — الأحدث أولاً.
// يُستخدم في صفحة العميل (بلا اسم عميل) وفي السجلّ العام (مع اسمه).
// canManage (المدير) يتيح التعديل والحذف.
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ActivityFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEdit(a: ClientActivity) {
    setError(null);
    setEditingId(a.id);
    setForm(activityFormFrom(a));
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
    setError(null);
  }

  async function saveEdit(a: ClientActivity) {
    if (!form) return;
    setError(null);

    const result = buildActivityPayload(form);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setBusyId(a.id);
    const { error } = await supabase
      .from("client_activities")
      .update(result.payload)
      .eq("id", a.id);
    setBusyId(null);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    cancelEdit();
    router.refresh();
  }

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

        // ===== وضع التعديل (للمدير) =====
        if (editingId === a.id && form) {
          return (
            <li key={a.id} className="relative flex gap-3">
              <span
                className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.color}`}
              >
                <span className="material-symbols-outlined text-[20px]">edit</span>
              </span>

              <div className="min-w-0 flex-1 space-y-4 rounded-2xl border-2 border-brand-500 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">تعديل التواصل</span>
                  {showClient && a.clients && (
                    <span className="text-xs text-gray-500">{a.clients.name}</span>
                  )}
                </div>

                <ActivityFields value={form} onChange={setForm} showTypePicker />

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => saveEdit(a)}
                    disabled={busyId === a.id}
                    className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                  >
                    {busyId === a.id ? "جاري الحفظ..." : "حفظ التعديل"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={busyId === a.id}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={() => remove(a)}
                    disabled={busyId === a.id}
                    className="mr-auto text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    حذف السجلّ
                  </button>
                </div>
              </div>
            </li>
          );
        }

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

              <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                <span>{a.actor_name || "—"}</span>
                {canManage && !isSystem && (
                  <>
                    <button
                      onClick={() => startEdit(a)}
                      disabled={busyId === a.id}
                      className="mr-auto font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={busyId === a.id}
                      className="text-red-500 hover:underline disabled:opacity-50"
                    >
                      حذف
                    </button>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
