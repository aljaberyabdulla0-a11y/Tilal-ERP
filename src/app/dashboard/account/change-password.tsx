"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const cls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

// تغيير كلمة المرور للمستخدم الحالي
export default function ChangePassword() {
  const supabase = createClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setMsg(null);
    if (pw.length < 6) {
      setMsg({ ok: false, text: "كلمة المرور يجب أن تكون ٦ أحرف على الأقل." });
      return;
    }
    if (pw !== pw2) {
      setMsg({ ok: false, text: "كلمتا المرور غير متطابقتين." });
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);

    if (error) {
      setMsg({ ok: false, text: "تعذّر التغيير: " + error.message });
      return;
    }
    setPw("");
    setPw2("");
    setMsg({ ok: true, text: "تم تغيير كلمة المرور ✓" });
  }

  return (
    <div className="glass-card p-5">
      <h3 className="mb-1 text-lg font-bold text-gray-800">كلمة المرور</h3>
      <p className="mb-4 text-sm text-gray-500">
        اختر كلمة مرور جديدة لحسابك. ستحتاجها في الدخول القادم.
      </p>

      <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">كلمة المرور الجديدة</label>
          <input
            type="password"
            dir="ltr"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className={cls + " text-start"}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">تأكيد كلمة المرور</label>
          <input
            type="password"
            dir="ltr"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            className={cls + " text-start"}
            placeholder="••••••••"
          />
        </div>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-4 py-2.5 text-sm ${
            msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      <button
        onClick={save}
        disabled={busy}
        className="mt-4 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "جارٍ الحفظ..." : "تغيير كلمة المرور"}
      </button>
    </div>
  );
}
