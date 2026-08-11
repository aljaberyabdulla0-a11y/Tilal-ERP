"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings } from "@/lib/types";
import { WEEKDAYS } from "@/lib/attendance";

// ============================================================
// أوقات الدوام الرسمية — منها يعرف النظام منو تأخّر ومنو غايب.
// ============================================================
export default function WorkHours({ settings }: { settings: CompanySettings | null }) {
  const router = useRouter();
  const supabase = createClient();

  const [start, setStart] = useState((settings?.work_start_time ?? "09:00:00").slice(0, 5));
  const [end, setEnd] = useState((settings?.work_end_time ?? "17:00:00").slice(0, 5));
  const [grace, setGrace] = useState(String(settings?.late_grace_minutes ?? 15));
  const [days, setDays] = useState<number[]>(settings?.work_days ?? [0, 1, 2, 3, 4]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggleDay(value: number) {
    setDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort()
    );
  }

  async function save() {
    setMsg(null);

    const graceNum = Number(grace);
    if (!start || !end) {
      setMsg({ kind: "err", text: "حدّد وقت البداية والنهاية." });
      return;
    }
    if (end <= start) {
      setMsg({ kind: "err", text: "وقت نهاية الدوام يجب أن يكون بعد البداية." });
      return;
    }
    if (!Number.isFinite(graceNum) || graceNum < 0 || graceNum > 240) {
      setMsg({ kind: "err", text: "سماح التأخير بين 0 و 240 دقيقة." });
      return;
    }
    if (days.length === 0) {
      setMsg({ kind: "err", text: "اختر يوم دوام واحد على الأقل." });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({
        work_start_time: start,
        work_end_time: end,
        late_grace_minutes: graceNum,
        work_days: days,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);

    if (error) {
      setMsg({ kind: "err", text: "تعذّر الحفظ: " + error.message });
      return;
    }
    setMsg({ kind: "ok", text: "تم حفظ أوقات الدوام." });
    router.refresh();
  }

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-sm font-medium text-gray-700";

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-gray-800">أوقات الدوام الرسمية</h3>
      <p className="mt-1 text-sm text-gray-500">
        منها يحسب النظام التأخير والغياب في{" "}
        <b>قسم الدوام</b>. الموظف الذي يبصم بعد وقت البداية + مدة السماح يُعدّ متأخراً،
        ومن لا يبصم في يوم دوام (وما عنده إجازة معتمدة) يُعدّ غائباً.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>بداية الدوام</label>
          <input
            type="time"
            dir="ltr"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={input + " w-full text-start"}
          />
        </div>
        <div>
          <label className={label}>نهاية الدوام</label>
          <input
            type="time"
            dir="ltr"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={input + " w-full text-start"}
          />
        </div>
        <div>
          <label className={label}>سماح التأخير (دقيقة)</label>
          <input
            type="number"
            min={0}
            max={240}
            dir="ltr"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
            className={input + " w-full text-start"}
          />
        </div>
      </div>

      <div className="mt-5">
        <label className={label}>أيام الدوام</label>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={
                days.includes(d.value)
                  ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-50"
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          الأيام غير المختارة تُعتبر عطلة أسبوعية ولا يُحتسب فيها غياب.
        </p>
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            msg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="mt-5 rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "جاري الحفظ..." : "حفظ أوقات الدوام"}
      </button>
    </div>
  );
}
