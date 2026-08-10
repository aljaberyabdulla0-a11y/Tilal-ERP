"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChatPerson,
  ConversationRow,
  avatarColor,
  initials,
  timeAgo,
} from "@/lib/types";
import StartChat from "./start-chat";

// ============================================================
// هيكل المحادثات بأسلوب ماسنجر على سطح المكتب:
//
//   ┌───────────────┬──────────────────────────────┐
//   │ قائمة المحادثات │        المحادثة المفتوحة        │
//   └───────────────┴──────────────────────────────┘
//
// القائمة تبقى ثابتة ولا تُعاد بناؤها عند التنقّل بين المحادثات
// (لأنها في layout لا في page)، وتحدّث نفسها لحظياً عند وصول أي رسالة.
//
// على الجوّال لا تتّسع الشاشة لعمودين: تظهر القائمة وحدها، وعند فتح
// محادثة تحلّ محلّها — مثل تطبيق ماسنجر تماماً.
//
// ملاحظة: children هنا مكوّنات خادم تُمرَّر كـ ReactNode — الشيفرة
// العميلة تتحكّم بالتخطيط فقط ولا تعيد جلب بياناتها.
// ============================================================
export default function ChatShell({
  initialConversations,
  colleagues,
  isAdmin,
  notReady,
  children,
}: {
  initialConversations: ConversationRow[];
  colleagues: ChatPerson[];
  isAdmin: boolean;
  notReady: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<ConversationRow[]>(initialConversations);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);

  // المحادثة المفتوحة حالياً من المسار: /dashboard/chat/<id>
  const activeId = pathname.startsWith("/dashboard/chat/")
    ? pathname.split("/")[3] ?? null
    : null;

  const reload = useCallback(async () => {
    const { data } = await supabase.rpc("my_conversations");
    if (data) setRows(data as ConversationRow[]);
  }, [supabase]);

  // بعد فتح محادثة: عدّادها صار صفراً في القاعدة — نُحدّث القائمة
  useEffect(() => {
    setComposing(false);
    reload();
  }, [pathname, reload]);

  // بثّ لحظي لأي رسالة جديدة + تحديث دوري احتياطي
  useEffect(() => {
    const channel = supabase
      .channel(`chat-list-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => reload()
      )
      .subscribe();

    const timer = setInterval(reload, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, reload]);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? rows.filter((c) => (c.display_title ?? "").toLowerCase().includes(term))
    : rows;

  return (
    <div className="flex h-[calc(100vh-3.25rem)] overflow-hidden bg-white lg:h-screen">
      {/* ===== عمود القائمة ===== */}
      <aside
        className={`${
          activeId ? "hidden lg:flex" : "flex"
        } w-full shrink-0 flex-col border-l border-gray-200 bg-white lg:w-[340px]`}
      >
        {/* الرأس: العنوان + زر محادثة جديدة */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h1 className="text-2xl font-bold text-brand-900">المحادثات</h1>
          <button
            onClick={() => setComposing((v) => !v)}
            title="محادثة جديدة"
            aria-label="محادثة جديدة"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              composing
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-brand-700 hover:bg-brand-50"
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">
              {composing ? "close" : "edit_square"}
            </span>
          </button>
        </div>

        {/* البحث */}
        <div className="px-4 pb-3">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-gray-400">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في المحادثات"
              className="w-full rounded-full bg-gray-100 py-2 pr-10 pl-3 text-sm text-gray-700 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
        </div>

        {notReady && (
          <p className="mx-4 mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            لم تُفعَّل المحادثات بعد — شغّل <b dir="ltr">sql/030_chat.sql</b>.
          </p>
        )}

        {/* لوحة «محادثة جديدة» تنزلق فوق القائمة */}
        {composing ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <StartChat people={colleagues} isAdmin={isAdmin} />
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {filtered.length === 0 ? (
              <li className="px-3 py-10 text-center text-sm text-gray-400">
                {rows.length === 0
                  ? "لا توجد محادثات بعد — ابدأ واحدة من زر ✎ في الأعلى."
                  : "لا نتائج مطابقة."}
              </li>
            ) : (
              filtered.map((c) => {
                const active = c.id === activeId;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/chat/${c.id}`}
                      className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition ${
                        active ? "bg-brand-50" : "hover:bg-gray-100"
                      }`}
                    >
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                          c.is_announcement
                            ? "bg-brand-600 text-white"
                            : avatarColor(c.display_title)
                        }`}
                      >
                        {c.is_announcement ? (
                          <span className="material-symbols-outlined text-[22px]">
                            campaign
                          </span>
                        ) : c.kind === "group" ? (
                          <span className="material-symbols-outlined text-[22px]">
                            groups
                          </span>
                        ) : (
                          initials(c.display_title)
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate ${
                            c.unread > 0
                              ? "font-bold text-gray-900"
                              : "font-semibold text-gray-700"
                          }`}
                        >
                          {c.display_title}
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-[13px] ${
                            c.unread > 0
                              ? "font-semibold text-gray-800"
                              : "text-gray-400"
                          }`}
                        >
                          {c.last_message_text
                            ? `${c.last_sender_name ? c.last_sender_name + ": " : ""}${c.last_message_text}`
                            : "لا توجد رسائل بعد"}
                        </span>
                      </span>

                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[11px] text-gray-400">
                          {c.last_message_at ? timeAgo(c.last_message_at) : ""}
                        </span>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                            {c.unread > 99 ? "99+" : c.unread}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </aside>

      {/* ===== عمود المحادثة ===== */}
      <section
        className={`${
          activeId ? "flex" : "hidden lg:flex"
        } min-w-0 flex-1 flex-col bg-gray-50`}
      >
        {children}
      </section>
    </div>
  );
}
