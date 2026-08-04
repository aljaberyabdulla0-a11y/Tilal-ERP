"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppNotification, NOTIFICATION_ICONS, timeAgo } from "@/lib/types";

// ============================================================
// جرس الإشعارات — يظهر في الشريط الجانبي وفي شريط الجوّال.
// يجلب آخر الإشعارات، ويستقبل الجديد لحظياً (Realtime)،
// ومعه تحديث دوري كل 30 ثانية كخطة احتياطية.
// ============================================================
// pin = الحافة التي تُثبَّت عليها القائمة المنسدلة حتى لا تخرج خارج الشاشة
export default function NotificationBell({
  pin = "right",
}: {
  pin?: "right" | "left";
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.is_read).length;

  // جلب آخر 15 إشعاراً (حماية الصفوف تضمن أنها إشعارات المستخدم الحالي فقط)
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15);
    if (data) setItems(data as AppNotification[]);
  }, [supabase]);

  useEffect(() => {
    load();

    // وصول لحظي للإشعارات الجديدة
    // (اسم قناة فريد لكل نسخة من الجرس — الشريط الجانبي وشريط الجوّال)
    const channel = supabase
      .channel(`notifications-bell-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => load()
      )
      .subscribe();

    // خطة احتياطية إن لم يعمل البثّ اللحظي
    const timer = setInterval(load, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, load]);

  // إغلاق القائمة عند الضغط خارجها
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    const ids = items.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
    router.refresh();
  }

  async function openItem(n: AppNotification) {
    setOpen(false);
    if (!n.is_read) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    }
    if (n.link) router.push(n.link);
    else router.refresh();
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="الإشعارات"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 left-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-12 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl ${
            pin === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-2.5">
            <span className="text-sm font-semibold text-gray-700">الإشعارات</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                لا توجد إشعارات.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 border-b px-4 py-3 text-right transition last:border-0 hover:bg-gray-50 ${
                    n.is_read ? "bg-white" : "bg-brand-50/60"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined mt-0.5 text-[20px] ${
                      n.is_read ? "text-gray-400" : "text-brand-600"
                    }`}
                  >
                    {NOTIFICATION_ICONS[n.kind] ?? "notifications"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-800">
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block text-xs text-gray-500">{n.body}</span>
                    )}
                    <span className="mt-1 block text-[11px] text-gray-400">
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                  )}
                </button>
              ))
            )}
          </div>

          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block border-t bg-gray-50 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-gray-100"
          >
            عرض كل الإشعارات
          </Link>
        </div>
      )}
    </div>
  );
}
