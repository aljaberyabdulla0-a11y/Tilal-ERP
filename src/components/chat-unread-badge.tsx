"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// شارة الرسائل غير المقروءة بجانب رابط «المحادثات».
// تُحدَّث لحظياً عند وصول رسالة، وكل 30 ثانية كخطة احتياطية،
// وعند التنقّل بين الصفحات (بعد قراءة محادثة يعود العدّاد للصفر).
// ============================================================
export default function ChatUnreadBadge() {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("chat_unread_count");
    if (!error) setCount(Number(data ?? 0));
  }, [supabase]);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`chat-badge-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => load()
      )
      .subscribe();

    const timer = setInterval(load, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, load, pathname]);

  if (count <= 0) return null;

  return (
    <span className="ms-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
