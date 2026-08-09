"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChatPerson, avatarColor, initials } from "@/lib/types";

// ============================================================
// بدء محادثة: تضغط على اسم الزميل فتُفتح المحادثة معه مباشرة.
// إن كانت محادثتكما موجودة من قبل تُفتح هي نفسها (لا تتكرر).
//
// للمدير زرّان إضافيان:
//   • إعلان لكل الموظفين — قناة يكتب فيها المدير ويقرأها الجميع.
//   • مجموعة جديدة — يختار عدة موظفين ويسمّي المجموعة.
// ============================================================
export default function StartChat({
  people,
  isAdmin,
}: {
  people: ChatPerson[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // إنشاء مجموعة
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const filtered = people.filter((p) =>
    (p.name + " " + (p.email ?? "")).toLowerCase().includes(search.trim().toLowerCase())
  );

  async function openDirect(userId: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("get_or_create_direct", {
      other_user: userId,
    });
    setBusy(false);
    if (error) {
      setError("تعذّر فتح المحادثة: " + error.message);
      return;
    }
    router.push(`/dashboard/chat/${data}`);
  }

  async function openAnnouncements() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("ensure_announcement_channel");
    setBusy(false);
    if (error) {
      setError("تعذّر فتح قناة الإعلانات: " + error.message);
      return;
    }
    router.push(`/dashboard/chat/${data}`);
  }

  async function createGroup() {
    if (!groupTitle.trim()) {
      setError("اكتب اسماً للمجموعة.");
      return;
    }
    if (picked.length === 0) {
      setError("اختر عضواً واحداً على الأقل.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("create_group_conversation", {
      group_title: groupTitle.trim(),
      member_ids: picked,
    });
    setBusy(false);
    if (error) {
      setError("تعذّر إنشاء المجموعة: " + error.message);
      return;
    }
    router.push(`/dashboard/chat/${data}`);
  }

  function togglePick(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <section className="glass-card p-5">
      <h2 className="mb-3 text-lg font-bold text-brand-900">محادثة جديدة</h2>

      {isAdmin && (
        <div className="mb-4 space-y-2">
          <button
            onClick={openAnnouncements}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-xl bg-brand-600 p-3 text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            <span className="material-symbols-outlined">campaign</span>
            <span className="font-semibold">إعلان لكل الموظفين</span>
          </button>

          <button
            onClick={() => setGroupOpen((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl bg-gray-50 p-3 text-gray-700 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <span className="material-symbols-outlined text-brand-600">group_add</span>
            <span className="font-medium">مجموعة جديدة</span>
          </button>
        </div>
      )}

      {groupOpen && (
        <div className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <input
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            placeholder="اسم المجموعة (مثال: فريق المبيعات)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {people.map((p) => (
              <label
                key={p.user_id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white"
              >
                <input
                  type="checkbox"
                  checked={picked.includes(p.user_id)}
                  onChange={() => togglePick(p.user_id)}
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="text-gray-700">{p.name}</span>
              </label>
            ))}
          </div>
          <button
            onClick={createGroup}
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            إنشاء المجموعة
          </button>
        </div>
      )}

      {/* البحث عن زميل */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ابحث عن زميل..."
        className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="max-h-[420px] space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">لا يوجد زملاء مطابقون.</p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.user_id}
              onClick={() => openDirect(p.user_id)}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-right transition hover:bg-brand-50 disabled:opacity-50"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${avatarColor(
                  p.name
                )}`}
              >
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">
                  {p.name}
                </span>
                <span className="block truncate text-[11px] text-gray-400" dir="ltr">
                  {p.email}
                </span>
              </span>
              {p.role === "admin" && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                  مدير
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
