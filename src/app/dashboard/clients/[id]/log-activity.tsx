"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACTIVITY_TYPES, activityMeta } from "@/lib/types";
import ActivityFields from "@/components/activity-fields";
import {
  ActivityFormState,
  buildActivityPayload,
  newActivityForm,
} from "@/lib/activity-form";

// ============================================================
// تسجيل تواصل مع العميل.
// الاستخدام المقصود: اضغط نوع التواصل (مكالمة/واتساب/اجتماع...) فيفتح
// نموذج مختصر مملوء بوقت الآن، تكتب ملخّصاً وتحدّد موعد المتابعة وتحفظ.
// ============================================================
export type OpenOpportunity = { id: string; title: string };

export default function LogActivity({
  clientId,
  stage,
  opportunities = [],
}: {
  clientId: string;
  stage?: string | null;
  // الفرص المفتوحة للعميل (sql/072): التواصل يُنسب إلى صفقته فيُحدَّث
  // «آخر نشاط» و«الخطوة القادمة» عليها بمحفّز. فرصة واحدة = تُختار
  // تلقائياً؛ أكثر = يختار الموظف؛ لا شيء = لا يظهر الحقل.
  opportunities?: OpenOpportunity[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState<ActivityFormState | null>(null);
  const [opportunityId, setOpportunityId] = useState<string>(
    opportunities.length === 1 ? opportunities[0].id : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(selected: string) {
    setError(null);
    setForm(newActivityForm(selected));
  }

  function close() {
    setForm(null);
    setError(null);
  }

  async function save() {
    if (!form) return;
    setError(null);

    const result = buildActivityPayload(form, stage);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("client_activities").insert({
      client_id: clientId,
      created_by: user?.id ?? null,
      ...(opportunityId ? { opportunity_id: opportunityId } : {}),
      ...result.payload,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    close();
    router.refresh();
  }

  const meta = form ? activityMeta(form.activity_type) : null;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="mb-3 font-semibold text-gray-800">تسجيل تواصل</h3>

      {/* أزرار سريعة */}
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => open(t.key)}
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
              form?.activity_type === t.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.key}
          </button>
        ))}
      </div>

      {/* النموذج المختصر */}
      {form && meta && (
        <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.color}`}
            >
              <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
            </span>
            <span className="font-semibold text-gray-800">{form.activity_type}</span>
          </div>

          <ActivityFields value={form} onChange={setForm} stage={stage} />

          {opportunities.length > 1 && (
            <label className="block">
              <span className="text-sm text-gray-600">على أي فرصة؟</span>
              <select
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">— العميل عموماً —</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "جاري الحفظ..." : "حفظ التواصل"}
            </button>
            <button
              onClick={close}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
