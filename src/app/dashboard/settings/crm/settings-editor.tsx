"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CrmSetting } from "@/lib/crm";

// ============================================================
// محرّر القواعد الرقمية — صفّ لكل قاعدة، وحفظ لكل صفّ على حدة.
//
// الحدود (min/max) تأتي من القاعدة نفسها وتُفرض هنا قبل الإرسال،
// فلا يُدخل أحد «صمت أخضر = ٠ يوم» ويصير كل العملاء حُمراً.
// ============================================================
export default function SettingsEditor({ settings }: { settings: CrmSetting[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(settings.map((s) => [s.key, String(s.value)]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { kind: "ok" | "err"; text: string }>>({});

  async function save(s: CrmSetting) {
    const raw = values[s.key]?.trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) {
      return setMsg((m) => ({ ...m, [s.key]: { kind: "err", text: "أدخل رقماً." } }));
    }
    if (s.min_value !== null && n < Number(s.min_value)) {
      return setMsg((m) => ({ ...m, [s.key]: { kind: "err", text: `الحدّ الأدنى ${s.min_value}.` } }));
    }
    if (s.max_value !== null && n > Number(s.max_value)) {
      return setMsg((m) => ({ ...m, [s.key]: { kind: "err", text: `الحدّ الأعلى ${s.max_value}.` } }));
    }

    setBusy(s.key);
    const { error } = await supabase.from("crm_settings").update({ value: n }).eq("key", s.key);
    setBusy(null);
    if (error) return setMsg((m) => ({ ...m, [s.key]: { kind: "err", text: error.message } }));
    setMsg((m) => ({ ...m, [s.key]: { kind: "ok", text: "حُفظ." } }));
    router.refresh();
  }

  const isFlag = (s: CrmSetting) => s.min_value === 0 && s.max_value === 1 && s.unit === "عدد";

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <ul className="divide-y divide-gray-100">
        {settings.map((s) => {
          const changed = values[s.key] !== String(s.value);
          return (
            <li key={s.key} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
              <div>
                <p className="font-medium text-gray-800">{s.label}</p>
                {s.description && <p className="text-sm text-gray-500">{s.description}</p>}
                <p className="mt-0.5 text-xs text-gray-400" dir="ltr">
                  {s.key}
                  {s.min_value !== null && s.max_value !== null && ` · ${s.min_value}–${s.max_value}`}
                </p>
              </div>
              <div className="flex items-start gap-2">
                {isFlag(s) ? (
                  <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={values[s.key] === "1"}
                      onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.checked ? "1" : "0" }))}
                    />
                    مفعّل
                  </label>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      value={values[s.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                      className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      dir="ltr"
                    />
                    {s.unit && <span className="text-xs text-gray-500">{s.unit}</span>}
                  </div>
                )}
                <button
                  type="button"
                  disabled={!changed || busy === s.key}
                  onClick={() => save(s)}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  حفظ
                </button>
              </div>
              {msg[s.key] && (
                <p className={`text-xs md:col-span-2 ${msg[s.key].kind === "ok" ? "text-brand-700" : "text-red-700"}`}>
                  {msg[s.key].text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
