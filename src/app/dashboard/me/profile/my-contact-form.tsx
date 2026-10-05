"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Contact = {
  phone: string;
  email: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
};

const FIELDS: [keyof Contact, string, string, "ltr" | "rtl"][] = [
  ["phone", "الهاتف", "tel", "ltr"],
  ["email", "البريد الإلكتروني", "email", "ltr"],
  ["address", "العنوان", "text", "rtl"],
  ["emergency_contact_name", "جهة الطوارئ — الاسم", "text", "rtl"],
  ["emergency_contact_relation", "صلة القرابة", "text", "rtl"],
  ["emergency_contact_phone", "هاتف الطوارئ", "tel", "ltr"],
];

// بيانات التواصل التي يحدّثها الموظف بنفسه — update_my_profile() (sql/148)
// تقبل هذه الحقول الستة وحدها، فلا يمسّ راتباً ولا بنكاً ولا منصباً.
export default function MyContactForm({ initial }: { initial: Contact }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<Contact>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const { error } = await supabase.rpc("update_my_profile", { p: form });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "حُفظ ✓" });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold text-gray-800">بيانات التواصل</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FIELDS.map(([key, label, type, dir]) => (
          <label key={key} className="text-sm text-gray-600">
            {label}
            <input
              type={type}
              dir={dir}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
