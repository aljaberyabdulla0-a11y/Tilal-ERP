"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// مكوّن تغيير دور مستخدم (يظهر في صفحة الإعدادات للمدير)
export default function RoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [role, setRole] = useState(currentRole);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // منع المدير من تغيير دور نفسه (حتى لا يقفل حسابه بالخطأ)
  if (isSelf) {
    return (
      <span className="text-xs text-gray-400">(أنت — لا يمكنك تغيير دورك)</span>
    );
  }

  async function changeRole(newRole: string) {
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);
    setSaving(false);

    if (error) {
      setMsg("خطأ: " + error.message);
      return;
    }
    setRole(newRole);
    setMsg("تم الحفظ ✓");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={(e) => changeRole(e.target.value)}
        disabled={saving}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      >
        <option value="employee">موظف</option>
        <option value="supervisor">مشرف</option>
        <option value="followup_manager">مدير المتابعة</option>
        <option value="admin">مدير</option>
      </select>
      {saving && <span className="text-xs text-gray-400">جاري الحفظ...</span>}
      {msg && !saving && <span className="text-xs text-green-600">{msg}</span>}
    </div>
  );
}
