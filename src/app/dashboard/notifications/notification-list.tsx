"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppNotification, NOTIFICATION_ICONS, timeAgo } from "@/lib/types";

// قائمة الإشعارات الكاملة — فتح، تعليم كمقروء، حذف
export default function NotificationList({ items }: { items: AppNotification[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [list, setList] = useState(items);

  const unread = list.filter((n) => !n.is_read).length;

  async function markAllRead() {
    const ids = list.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    setList((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
    router.refresh();
  }

  async function openItem(n: AppNotification) {
    if (!n.is_read) {
      setList((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    }
    if (n.link) router.push(n.link);
  }

  async function remove(id: string) {
    setList((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
    router.refresh();
  }

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
        لا توجد إشعارات.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {unread > 0 ? `لديك ${unread} إشعار غير مقروء` : "كل الإشعارات مقروءة"}
        </p>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
          >
            تعليم الكل كمقروء
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        {list.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 border-b px-4 py-4 last:border-0 ${
              n.is_read ? "bg-white" : "bg-brand-50/60"
            }`}
          >
            <span
              className={`material-symbols-outlined mt-0.5 ${
                n.is_read ? "text-gray-400" : "text-brand-600"
              }`}
            >
              {NOTIFICATION_ICONS[n.kind] ?? "notifications"}
            </span>

            <button
              onClick={() => openItem(n)}
              className="min-w-0 flex-1 text-right"
              disabled={!n.link}
            >
              <span className="block font-semibold text-gray-800">{n.title}</span>
              {n.body && <span className="mt-1 block text-sm text-gray-600">{n.body}</span>}
              <span className="mt-1 block text-xs text-gray-400">
                {timeAgo(n.created_at)}
              </span>
            </button>

            <button
              onClick={() => remove(n.id)}
              aria-label="حذف الإشعار"
              className="material-symbols-outlined text-[20px] text-gray-300 transition hover:text-red-600"
            >
              close
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
