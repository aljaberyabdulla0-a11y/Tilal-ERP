"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  AppNotification,
  NOTIFICATION_ICONS,
  NOTIFICATION_PRIORITY_ORDER,
  NOTIFICATION_PRIORITY_STYLE,
  NOTIFICATION_CATEGORY_LABELS,
  timeAgo,
} from "@/lib/types";

// قائمة الإشعارات الكاملة — فتح، تعليم كمقروء، حذف.
//
// الترتيب (sql/075): غير المقروء أولاً، ثم بالأولوية (حرجة ← منخفضة)،
// ثم بالأحدث — فلا يغرق «تصعيد للإدارة» تحت عشرين إشعار مهمة عادية.
// والتصنيف مُرشِّح في العنوان (?category=sla).
export default function NotificationList({
  items,
  category = null,
}: {
  items: AppNotification[];
  category?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [list, setList] = useState(items);

  const unread = list.filter((n) => !n.is_read).length;
  const sorted = [...list].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    const pa = NOTIFICATION_PRIORITY_ORDER[a.priority ?? "عادية"] ?? 2;
    const pb = NOTIFICATION_PRIORITY_ORDER[b.priority ?? "عادية"] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.created_at < b.created_at ? 1 : -1;
  });
  // التصنيفات الموجودة فعلاً في القائمة — لا نعرض مُرشِّحاً لتصنيف فارغ
  const categories = Array.from(new Set(items.map((n) => n.category).filter(Boolean) as string[]));

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
        {category ? (
          <>لا إشعارات في هذا التصنيف. <Link href="/dashboard/notifications" className="text-brand-600 underline">الكل</Link></>
        ) : "لا توجد إشعارات."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(categories.length > 0 || category) && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/dashboard/notifications"
            className={!category ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
          >
            الكل
          </Link>
          {Array.from(new Set([...(category ? [category] : []), ...categories])).map((c) => (
            <Link
              key={c}
              href={`/dashboard/notifications?category=${encodeURIComponent(c)}`}
              className={category === c ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-600"}
            >
              {NOTIFICATION_CATEGORY_LABELS[c] ?? c}
            </Link>
          ))}
        </div>
      )}
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
        {sorted.map((n) => (
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
              className="min-w-0 flex-1 text-start"
              disabled={!n.link}
            >
              <span className="block font-semibold text-gray-800">
                {n.title}
                {n.priority && NOTIFICATION_PRIORITY_STYLE[n.priority] && (
                  <span className={`ms-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${NOTIFICATION_PRIORITY_STYLE[n.priority]}`}>
                    {n.priority}
                  </span>
                )}
              </span>
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
